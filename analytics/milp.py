"""Capacitated facility location + multi-commodity flow MILP (two echelons: plants -> candidate sites -> demand nodes), HiGHS.

The LP text is built from plain published arrays by `build_model`; the browser rebuilds the identical text (same row/column order, same
rounding rule, same number formatting) and `lp_text_sha256` proves it. Columns are always mapped back by NAME, never by index.

Model (indices: z site f, x out-arc a for commodity k, y plant p -> site f for commodity k):
  min   sum_f F_f z_f  +  sum_{a,k} (T_out[a,k] + H_k) x[a,k]  +  sum_{p,f,k} T_in[p,f,k] y[p,f,k]   (+ penalties on slacks when relaxed)
  dem[d,k]  sum_{a in arcs(d)} x[a,k] (+ u[d,k]) = demand[d,k]
  flw[f,k]  sum_p y[p,f,k] - sum_{a in arcs(f)} x[a,k] = 0
  cap[f]    sum_k w_k sum_{a in arcs(f)} x[a,k] - Cap_f z_f (- so_f) <= 0
  sup[p,k]  sum_f y[p,f,k] (- sp[p,k]) <= Supply[p,k]
  mxo       sum_f z_f (- sm) <= max_open_sites
  cls[f]    z_f = 0 for closed sites;  fix[f]  z_f = 0|1 when a design is locked;  Bounds: x[a,k] = 0 on closed lanes
"""
from __future__ import annotations

import tempfile
from pathlib import Path

import highspy
import numpy as np

from pipelines.common import fmt, r4

K_NAMES = ["ambient", "cold", "bulk"]
HIGHS_VERSION = highspy.Highs().version()
INF = highspy.kHighsInf
OPTIONS = {"mip_rel_gap": 0.0, "mip_abs_gap": 1e-6, "threads": 1, "random_seed": 0, "output_flag": False, "time_limit": 60.0}
PENALTY = {"unmet_usd_ton": 6000.0, "capacity_usd_unit": 2500.0, "supply_usd_ton": 3500.0, "open_sites_usd_site": 30_000_000.0}
LINK_ARCS = True  # per-arc linking x[a,k] <= demand[d,k] z[f]: a tighter relaxation, measured faster than the aggregate capacity row alone
DEFAULT_PARAMS = {"demand_scale": 1.0, "freight_scale": 1.0, "fixed_cost_scale": 1.0, "capacity_scale": 1.0, "max_open_sites": 20,
                  "closed_sites": [], "closed_lanes": [], "fixed_open": None, "relax": False}


def full_params(p: dict | None = None) -> dict:
    out = {**DEFAULT_PARAMS, **(p or {})}
    out["closed_sites"] = sorted(out["closed_sites"]); out["closed_lanes"] = sorted(out["closed_lanes"])
    if out["fixed_open"] is not None:
        out["fixed_open"] = sorted(out["fixed_open"])
    return out


class Model:
    """Everything needed to build the LP text and to interpret a solution. Arrays follow the published column/row order."""

    def __init__(self, net: dict, params: dict | None = None, link: bool | None = None):
        self.net, self.p = net, full_params(params)
        self.link = LINK_ARCS if link is None else link
        p, K = self.p, len(net["commodities"])
        self.F, self.D, self.P, self.K = len(net["sites"]), len(net["demand_nodes"]), len(net["plants"]), K
        oa = net["out_arcs"]
        self.n_arc = len(oa["site"])
        cm = net["commodities"]
        self.w = [c["capacity_units_per_ton"] for c in cm]
        self.dem = [[r4(net["demand_nodes"][d]["demand_tons"][k] * p["demand_scale"]) for k in range(K)] for d in range(self.D)]
        self.fixed = [r4(s["fixed_cost_usd_yr"] * p["fixed_cost_scale"]) for s in net["sites"]]
        self.cap = [r4(s["capacity_units"] * p["capacity_scale"]) for s in net["sites"]]
        self.sup = [[float(v) for v in pl["supply_tons"]] for pl in net["plants"]]
        self.t_out = [[r4(cm[k]["rate_out_usd_ton_mi"] * oa["road_mi"][a] * p["freight_scale"]) for k in range(K)] for a in range(self.n_arc)]
        self.hand = [r4(c["handling_usd_ton"]) for c in cm]
        self.t_in = [[[r4(cm[k]["rate_in_usd_ton_mi"] * net["in_road_mi"][pp][f] * p["freight_scale"]) for k in range(K)] for f in range(self.F)] for pp in range(self.P)]
        self.arcs_of_demand = [[] for _ in range(self.D)]
        self.arcs_of_site = [[] for _ in range(self.F)]
        for a in range(self.n_arc):
            self.arcs_of_demand[oa["demand"][a]].append(a); self.arcs_of_site[oa["site"][a]].append(a)
        self.closed_lane = set(p["closed_lanes"])

    # ---- column names in published order
    def cols(self) -> list[str]:
        c = [f"z{f}" for f in range(self.F)]
        c += [f"x{a}_{k}" for a in range(self.n_arc) for k in range(self.K)]
        c += [f"y{pp}_{f}_{k}" for pp in range(self.P) for f in range(self.F) for k in range(self.K)]
        if self.p["relax"]:
            c += [f"u{d}_{k}" for d in range(self.D) for k in range(self.K)] + [f"so{f}" for f in range(self.F)] + [f"sp{pp}_{k}" for pp in range(self.P) for k in range(self.K)] + ["sm"]
        return c

    def obj_coeffs(self) -> dict[str, float]:
        o = {f"z{f}": self.fixed[f] for f in range(self.F)}
        oa = self.net["out_arcs"]
        for a in range(self.n_arc):
            for k in range(self.K):
                o[f"x{a}_{k}"] = self.t_out[a][k] + self.hand[k]
        for pp in range(self.P):
            for f in range(self.F):
                for k in range(self.K):
                    o[f"y{pp}_{f}_{k}"] = self.t_in[pp][f][k]
        if self.p["relax"]:
            for d in range(self.D):
                for k in range(self.K):
                    o[f"u{d}_{k}"] = PENALTY["unmet_usd_ton"]
            for f in range(self.F):
                o[f"so{f}"] = PENALTY["capacity_usd_unit"]
            for pp in range(self.P):
                for k in range(self.K):
                    o[f"sp{pp}_{k}"] = PENALTY["supply_usd_ton"]
            o["sm"] = PENALTY["open_sites_usd_site"]
        return o

    def rows(self) -> list[tuple[str, list[tuple[str, float]], str, float]]:
        """(name, terms, sense, rhs) in published order."""
        R, rl = [], self.p["relax"]
        for d in range(self.D):
            for k in range(self.K):
                t = [(f"x{a}_{k}", 1.0) for a in self.arcs_of_demand[d]] + ([(f"u{d}_{k}", 1.0)] if rl else [])
                R.append((f"dem{d}_{k}", t, "=", self.dem[d][k]))
        for f in range(self.F):
            for k in range(self.K):
                t = [(f"y{pp}_{f}_{k}", 1.0) for pp in range(self.P)] + [(f"x{a}_{k}", -1.0) for a in self.arcs_of_site[f]]
                R.append((f"flw{f}_{k}", t, "=", 0.0))
        for f in range(self.F):
            t = [(f"x{a}_{k}", self.w[k]) for a in self.arcs_of_site[f] for k in range(self.K)] + [(f"z{f}", -self.cap[f])] + ([(f"so{f}", -1.0)] if rl else [])
            R.append((f"cap{f}", t, "<=", 0.0))
        for pp in range(self.P):
            for k in range(self.K):
                t = [(f"y{pp}_{f}_{k}", 1.0) for f in range(self.F)] + ([(f"sp{pp}_{k}", -1.0)] if rl else [])
                R.append((f"sup{pp}_{k}", t, "<=", self.sup[pp][k]))
        if self.link:
            oa = self.net["out_arcs"]
            for a in range(self.n_arc):
                for k in range(self.K):
                    R.append((f"lnk{a}_{k}", [(f"x{a}_{k}", 1.0), (f"z{oa['site'][a]}", -self.dem[oa['demand'][a]][k])], "<=", 0.0))
        R.append(("mxo", [(f"z{f}", 1.0) for f in range(self.F)] + ([("sm", -1.0)] if rl else []), "<=", float(self.p["max_open_sites"])))
        for f in self.p["closed_sites"]:
            R.append((f"cls{f}", [(f"z{f}", 1.0)], "=", 0.0))
        if self.p["fixed_open"] is not None:
            fo = set(self.p["fixed_open"])
            for f in range(self.F):
                R.append((f"fix{f}", [(f"z{f}", 1.0)], "=", 1.0 if f in fo else 0.0))
        return R

    def lp_text(self) -> str:
        oc = self.obj_coeffs()
        out = ["\\ Supply Chain Orchestra MILP (generated); layout in model.json", "Minimize", " obj: " + " + ".join(f"{fmt(v)} {n}" for n, v in oc.items() if v != 0), "Subject To"]
        for name, terms, sense, rhs in self.rows():
            body = " ".join(f"{'+' if c >= 0 else '-'} {fmt(abs(c))} {n}" for n, c in terms)
            out.append(f" {name}: {body} {sense} {fmt(rhs)}")
        out.append("Bounds")
        for a in sorted(self.closed_lane):
            for k in range(self.K):
                out.append(f" x{a}_{k} = 0")
        out.append("Binary")
        out.append(" " + " ".join(f"z{f}" for f in range(self.F)))
        out.append("End")
        return "\n".join(out) + "\n"


def _highs(text: str, fix_z: dict[int, float] | None = None):
    h = highspy.Highs()
    for k, v in OPTIONS.items():
        h.setOptionValue(k, v)
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / "m.lp"
        f.write_text(text)
        h.readModel(str(f))
    return h


def solve(m: Model, text: str | None = None, with_duals: bool = False) -> dict:
    """Solve the MILP from its LP text (the same path the browser takes). Returns status, objective and named solution."""
    text = text or m.lp_text()
    h = _highs(text)
    h.run()
    st = h.modelStatusToString(h.getModelStatus())
    lp = h.getLp()
    names = list(lp.col_names_)
    res: dict = {"status": st, "objective": None, "x": None, "names": names, "mip_gap": None, "highs": h}
    if st != "Optimal":
        return res
    info = h.getInfo()
    sol = h.getSolution()
    res["objective"] = float(info.objective_function_value)
    res["x"] = dict(zip(names, (float(v) for v in sol.col_value)))
    res["mip_gap"] = float(info.mip_gap)
    res["nodes"] = int(info.mip_node_count)
    if with_duals:
        res["duals"] = fixed_design_duals(m, text, res["x"])
    return res


def fixed_design_duals(m: Model, text: str, x: dict) -> dict:
    """LP with the binaries fixed at the MILP optimum: row duals/slacks are CONDITIONAL on that design (valid for small rhs changes only)."""
    h = _highs(text)
    lp = h.getLp()
    names = list(lp.col_names_)
    for j, n in enumerate(names):
        if n.startswith("z") and n[1:].isdigit():
            v = float(round(x[n]))
            h.changeColBounds(j, v, v)
            h.changeColIntegrality(j, highspy.HighsVarType.kContinuous)
    h.run()
    sol = h.getSolution()
    rn = list(h.getLp().row_names_)
    return {"obj": float(h.getInfo().objective_function_value), "row_dual": dict(zip(rn, (float(v) for v in sol.row_dual))), "row_value": dict(zip(rn, (float(v) for v in sol.row_value)))}


def breakdown(m: Model, x: dict) -> dict:
    """Objective components recomputed from the solution with the same (rounded) coefficients."""
    fixed = sum(m.fixed[f] * round(x[f"z{f}"]) for f in range(m.F))
    tout = sum(m.t_out[a][k] * x[f"x{a}_{k}"] for a in range(m.n_arc) for k in range(m.K))
    hand = sum(m.hand[k] * x[f"x{a}_{k}"] for a in range(m.n_arc) for k in range(m.K))
    tin = sum(m.t_in[pp][f][k] * x[f"y{pp}_{f}_{k}"] for pp in range(m.P) for f in range(m.F) for k in range(m.K))
    pen = {"unmet_demand": 0.0, "capacity_overshoot": 0.0, "supply_overshoot": 0.0, "open_sites_excess": 0.0}
    if m.p["relax"]:
        pen["unmet_demand"] = PENALTY["unmet_usd_ton"] * sum(x[f"u{d}_{k}"] for d in range(m.D) for k in range(m.K))
        pen["capacity_overshoot"] = PENALTY["capacity_usd_unit"] * sum(x[f"so{f}"] for f in range(m.F))
        pen["supply_overshoot"] = PENALTY["supply_usd_ton"] * sum(x[f"sp{pp}_{k}"] for pp in range(m.P) for k in range(m.K))
        pen["open_sites_excess"] = PENALTY["open_sites_usd_site"] * x["sm"]
    return {"fixed_usd": fixed, "inbound_transport_usd": tin, "outbound_transport_usd": tout, "handling_usd": hand, "penalties_usd": pen}


def lp_bound(text: str) -> float:
    """Objective of the LP relaxation (integrality dropped): a lower bound on the MILP optimum."""
    h = _highs(text)
    n = h.getNumCol()
    h.changeColsIntegrality(n, np.arange(n, dtype=np.int32), np.array([highspy.HighsVarType.kContinuous] * n))
    h.run()
    return float(h.getInfo().objective_function_value)
