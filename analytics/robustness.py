"""Seeded disruption Monte Carlo: site/lane outages, a correlated regional event and demand shocks, evaluated for fixed network designs.

A design (set of open sites) is fixed: it cannot be re-opened after a disruption. Flows are re-optimised by an LP with elastic unmet-demand slack
(capacity, supply and the open-site limit are held firm: their slacks are fixed to zero). Operating cost excludes the penalty; `adjusted cost` adds
a lost-sales charge per unserved ton (a SYNTHETIC parameter). Common random numbers: every design sees the same draws.
"""
from __future__ import annotations

import numpy as np
import highspy

from analytics.milp import PENALTY, Model, _highs
from analytics.network import road_mi
from pipelines.common import SEED, r4

CFG = {"draws": 500, "seed": SEED + 1, "p_site_outage": 0.06, "p_regional_event": 0.35, "regional_radius_mi": 350.0, "p_site_in_region": 0.8, "p_lane_outage": 0.02,
       "demand_global_sd": 0.10, "demand_commodity_sd": 0.08, "demand_node_sd": 0.10, "regional_surge": 0.25, "surge_radius_mi": 300.0, "lost_sales_usd_ton": 1500.0,
       "note": "Site outage: each site fails independently. Regional event: with probability p an epicentre demand node is drawn uniformly; sites within the radius fail with probability p_site_in_region and demand nodes within the surge radius rise by the surge. Lane outage: each out-arc closes independently (all commodities). Demand: lognormal global x commodity x node multipliers."}


def draws(net: dict, cfg: dict = CFG) -> list[dict]:
    rng = np.random.default_rng(cfg["seed"])
    F, D, K = len(net["sites"]), len(net["demand_nodes"]), len(net["commodities"])
    nA = len(net["out_arcs"]["site"])
    sites, dn = net["sites"], net["demand_nodes"]
    out = []
    for _ in range(cfg["draws"]):
        down = set(np.flatnonzero(rng.random(F) < cfg["p_site_outage"]).tolist())
        event = bool(rng.random() < cfg["p_regional_event"])
        epi = int(rng.integers(0, D))
        near_sites = {f for f in range(F) if road_mi(dn[epi]["lat"], dn[epi]["lon"], sites[f]["lat"], sites[f]["lon"]) <= cfg["regional_radius_mi"]}
        hit = rng.random(F) < cfg["p_site_in_region"]
        if event:
            down |= {f for f in near_sites if hit[f]}
        lanes = np.flatnonzero(rng.random(nA) < cfg["p_lane_outage"]).tolist()
        g = float(np.exp(rng.normal(0, cfg["demand_global_sd"])))
        ck = np.exp(rng.normal(0, cfg["demand_commodity_sd"], K))
        nd = np.exp(rng.normal(0, cfg["demand_node_sd"], (D, K)))
        mult = g * ck[None, :] * nd
        if event:
            for d in range(D):
                if road_mi(dn[epi]["lat"], dn[epi]["lon"], dn[d]["lat"], dn[d]["lon"]) <= cfg["surge_radius_mi"]:
                    mult[d, :] *= 1 + cfg["regional_surge"]
        out.append({"sites_down": sorted(down), "lanes_down": lanes, "event": event, "epi": epi if event else None, "mult": mult})
    return out


class Evaluator:
    """One persistent HiGHS LP per design; each evaluation edits bounds/rhs, solves, and restores."""

    def __init__(self, net: dict, design: list[int]):
        self.m = Model(net, {"fixed_open": design, "relax": True}, link=False)
        self.h = _highs(self.m.lp_text())
        lp = self.h.getLp()
        self.col = {n: j for j, n in enumerate(lp.col_names_)}
        self.row = {n: i for i, n in enumerate(lp.row_names_)}
        h = self.h
        for n, j in self.col.items():
            if n.startswith("so") or n.startswith("sp") or n == "sm":
                h.changeColBounds(j, 0.0, 0.0)
            if n.startswith("z"):
                h.changeColIntegrality(j, highspy.HighsVarType.kContinuous)
        self.design = set(design)
        self.sites = list(design)
        self.base_dem = [[self.m.dem[d][k] for k in range(self.m.K)] for d in range(self.m.D)]
        self.total = float(sum(map(sum, self.base_dem)))

    def run(self, sites_down=(), lanes_down=(), mult=None, lost_sales: float = CFG["lost_sales_usd_ton"]) -> dict:
        m, h = self.m, self.h
        for f in sites_down:
            if f in self.design:
                h.changeRowBounds(self.row[f"fix{f}"], 0.0, 0.0)
        for a in lanes_down:
            for k in range(m.K):
                h.changeColBounds(self.col[f"x{a}_{k}"], 0.0, 0.0)
        dem = 0.0
        for d in range(m.D):
            for k in range(m.K):
                v = r4(self.base_dem[d][k] * (1.0 if mult is None else float(mult[d][k])))
                dem += v
                h.changeRowBounds(self.row[f"dem{d}_{k}"], v, v)
        h.run()
        assert h.modelStatusToString(h.getModelStatus()) == "Optimal"
        sol = h.getSolution().col_value
        unmet = float(sum(sol[self.col[f"u{d}_{k}"]] for d in range(m.D) for k in range(m.K)))
        cost = float(h.getInfo().objective_function_value) - PENALTY["unmet_usd_ton"] * unmet
        deliv = [float(sum(sol[self.col[f"x{a}_{k}"]] for a in m.arcs_of_site[f] for k in range(m.K))) for f in self.sites]
        for f in sites_down:
            if f in self.design:
                h.changeRowBounds(self.row[f"fix{f}"], 1.0, 1.0)
        for a in lanes_down:
            for k in range(m.K):
                h.changeColBounds(self.col[f"x{a}_{k}"], 0.0, highspy.kHighsInf)
        r = {"cost": cost, "unmet": unmet, "service": 1.0 - unmet / dem, "adjusted": cost + lost_sales * unmet, "demand": dem, "delivered": deliv}
        return r


def summarize(a: np.ndarray, tail_high: bool = True) -> dict:
    s = np.sort(a)
    k = max(1, int(np.ceil(0.05 * len(s))))
    cvar = float(s[-k:].mean() if tail_high else s[:k].mean())
    q = lambda p: float(np.quantile(a, p))
    return {"mean": float(a.mean()), "sd": float(a.std(ddof=1)), "p05": q(0.05), "p50": q(0.5), "p95": q(0.95), "p99": q(0.99), "cvar95": cvar, "min": float(a.min()), "max": float(a.max())}


def hist(a: np.ndarray, lo: float, hi: float, bins: int = 20) -> dict:
    c, e = np.histogram(np.clip(a, lo, hi), bins=bins, range=(lo, hi))
    return {"edges": [float(v) for v in e], "counts": [int(v) for v in c]}


def run_mc(net: dict, designs: dict[str, list[int]], cfg: dict = CFG) -> dict:
    ds = draws(net, cfg)
    ev = {k: Evaluator(net, v) for k, v in designs.items()}
    res = {k: {"cost_usd": [], "service_level": [], "adjusted_cost_usd": [], "unmet_tons": [], "delivered_by_site": []} for k in designs}
    under = {k: ev[k].run() for k in designs}
    dem_tot: list = []
    for dr in ds:
        for k in designs:
            r = ev[k].run(dr["sites_down"], dr["lanes_down"], dr["mult"], cfg["lost_sales_usd_ton"])
            res[k]["cost_usd"].append(round(r["cost"], 2)); res[k]["service_level"].append(round(r["service"], 6)); res[k]["adjusted_cost_usd"].append(round(r["adjusted"], 2))
            res[k]["unmet_tons"].append(round(r["unmet"], 1)); res[k]["delivered_by_site"].append([round(v, 1) for v in r["delivered"]])
        dem_tot.append(round(r["demand"], 1))
    tot = ev[next(iter(designs))].total
    summ, hs = {}, {}
    allc = np.concatenate([np.array(res[k]["adjusted_cost_usd"]) for k in designs])
    lo, hi = float(np.floor(allc.min() / 1e6) * 1e6), float(np.ceil(allc.max() / 1e6) * 1e6)
    for k in designs:
        c, s, a = (np.array(res[k][n]) for n in ("cost_usd", "service_level", "adjusted_cost_usd"))
        summ[k] = {"cost": summarize(c), "service_level": summarize(s, tail_high=False), "adjusted_cost": summarize(a), "share_full_service": float((s >= 0.9999).mean()),
                   "mean_regret_vs_undisrupted_usd": float((a - under[k]["adjusted"]).mean())}
        hs[k] = {"cost": hist(a, lo, hi), "service_level": hist(s, 0.0, 1.0)}
    crit = []
    opt = designs.get("optimized")
    if opt is not None:
        for f in opt:
            r = ev["optimized"].run([f])
            crit.append({"site": f, "delta_cost_usd": round(r["adjusted"] - under["optimized"]["adjusted"], 2), "service_level": round(r["service"], 6), "unmet_tons": round(r["unmet"], 3), "delivered_by_site": [round(v, 1) for v in r["delivered"]]})
        crit.sort(key=lambda c: -c["delta_cost_usd"])
    return {"config": cfg, "results": res, "summary": summ, "histograms": hs, "undisrupted": {k: {"cost": round(under[k]["cost"], 2), "service": round(under[k]["service"], 6)} for k in designs},
            "draws": {"failed_sites": [d["sites_down"] for d in ds], "epicentre": [d["epi"] for d in ds], "demand_tons": dem_tot, "sites_down": [len(d["sites_down"]) for d in ds], "lanes_down": [len(d["lanes_down"]) for d in ds], "regional_event": [int(d["event"]) for d in ds],
                      "demand_multiplier": [round(float(np.sum(d["mult"] * np.array(ev[next(iter(designs))].base_dem)) / tot), 4) for d in ds]}, "site_criticality": crit}
