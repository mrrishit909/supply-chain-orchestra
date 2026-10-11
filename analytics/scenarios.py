"""Solve a parameter set and package the result as a published scenario (routes, components, duals, binding constraints, relaxation report)."""
from __future__ import annotations

import hashlib

from analytics import words as W
from analytics.milp import PENALTY, Model, breakdown, lp_bound, solve

FLOW_DP = 3
TOL = 1e-6


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def routes(m: Model, x: dict) -> tuple[list, list]:
    oa = m.net["out_arcs"]
    ro = [[a, k, round(x[f"x{a}_{k}"], FLOW_DP)] for a in range(m.n_arc) for k in range(m.K) if x[f"x{a}_{k}"] >= 0.0005]
    ri = [[pp, f, k, round(x[f"y{pp}_{f}_{k}"], FLOW_DP)] for pp in range(m.P) for f in range(m.F) for k in range(m.K) if x[f"y{pp}_{f}_{k}"] >= 0.0005]
    return ro, ri


def relaxation_report(m: Model, x: dict) -> dict:
    """Which elastic slacks were forced above zero, and by how much (the infeasibility explanation)."""
    unmet = [{"demand": d, "commodity": k, "tons": round(x[f"u{d}_{k}"], 3)} for d in range(m.D) for k in range(m.K) if x[f"u{d}_{k}"] > 5e-4]
    cap = [{"site": f, "units": round(x[f"so{f}"], 3), "pct_of_capacity": round(100 * x[f"so{f}"] / m.cap[f], 2) if m.cap[f] > 0 else 0.0} for f in range(m.F) if x[f"so{f}"] > 5e-4]
    sup = [{"plant": pp, "commodity": k, "tons": round(x[f"sp{pp}_{k}"], 3)} for pp in range(m.P) for k in range(m.K) if x[f"sp{pp}_{k}"] > 5e-4]
    sm = round(x["sm"], 3) if x["sm"] > 5e-4 else 0.0
    bits = []
    if sm:
        bits.append(f"open-site limit exceeded by {sm:g} site(s)")
    if cap:
        bits.append(f"{len(cap)} site capacity row(s) exceeded by {sum(c['units'] for c in cap):,.0f} units in total")
    if sup:
        bits.append(f"plant supply exceeded by {sum(s['tons'] for s in sup):,.0f} t across {len(sup)} plant/commodity row(s)")
    if unmet:
        bits.append(f"{sum(u['tons'] for u in unmet):,.0f} t of demand left unserved at {len({u['demand'] for u in unmet})} node(s)")
    bd = breakdown(m, x)["penalties_usd"]
    rep = {"total_penalty_usd": round(sum(bd.values()), 2), "unmet_demand": unmet, "capacity_overshoot": cap, "supply_overshoot": sup, "open_sites_excess": sm,
           "summary": "; ".join(bits) if bits else "No constraint had to be relaxed."}
    base = float(sum(n["demand_tons"][k] for n in m.net["demand_nodes"] for k in range(m.K)))
    rep["words"] = W.words(rep, m.net, base, int(m.p["max_open_sites"]))
    return rep


def binding(m: Model, x: dict, duals: dict | None) -> list:
    out = []
    for f in range(m.F):
        if round(x[f"z{f}"]) != 1 or m.cap[f] <= 0:
            continue
        used = sum(m.w[k] * x[f"x{a}_{k}"] for a in m.arcs_of_site[f] for k in range(m.K))
        slack = m.cap[f] - used  # negative when the elastic overshoot is used; that is reported in `relaxation`
        if slack <= 1e-6 * max(1.0, m.cap[f]):
            out.append({"group": "capacity", "id": f"S{f:02d}", "slack": round(max(slack, 0.0), 4), "shadow_usd_per_unit": round(-duals["row_dual"][f"cap{f}"], 4) if duals else None, "unit": "throughput unit"})
    for pp in range(m.P):
        for k in range(m.K):
            used = sum(x[f"y{pp}_{f}_{k}"] for f in range(m.F))
            slack = m.sup[pp][k] - used
            if slack <= 1e-6 * max(1.0, m.sup[pp][k]):
                out.append({"group": "plant_supply", "id": f"P{pp}/{m.net['commodities'][k]['id']}", "slack": round(max(slack, 0.0), 4),
                            "shadow_usd_per_unit": round(-duals["row_dual"][f"sup{pp}_{k}"], 4) if duals else None, "unit": "ton"})
    if sum(round(x[f"z{f}"]) for f in range(m.F)) >= m.p["max_open_sites"]:
        out.append({"group": "open_sites", "id": "max_open_sites", "slack": 0.0, "shadow_usd_per_unit": None, "unit": "site"})
    out.sort(key=lambda b: (-(b["shadow_usd_per_unit"] or 0.0), b["id"]))
    return out


def package(net: dict, sid: str, label: str, desc: str, kind: str, params: dict | None) -> dict:
    m = Model(net, params)
    text = m.lp_text()
    total = float(sum(m.dem[d][k] for d in range(m.D) for k in range(m.K)))
    base = {"id": sid, "label": label, "description": desc, "kind": kind, "params": m.p, "lp_text_sha256": sha(text), "total_demand_tons": round(total, 3)}
    r = solve(m, text, with_duals=not m.p["relax"])
    if r["status"] != "Optimal":
        return {**base, "status": r["status"], "journeys": [], "hero": None, "objective_usd": None, "components": None, "open_sites": [], "mip_gap": None, "mip_nodes": None, "lp_relaxation_bound_usd": None,
                "service_level": None, "unmet_tons": None, "routes_out": [], "routes_in": [], "site_use": [], "demand_price_usd_ton": None, "binding": [], "relaxation": None}
    x = r["x"]
    opened = [f for f in range(m.F) if round(x[f"z{f}"]) == 1]
    ro, ri = routes(m, x)
    unmet = sum(x[f"u{d}_{k}"] for d in range(m.D) for k in range(m.K)) if m.p["relax"] else 0.0
    use = []
    for f in opened:
        u = sum(m.w[k] * x[f"x{a}_{k}"] for a in m.arcs_of_site[f] for k in range(m.K))
        use.append({"site": f, "units": round(u, 3), "capacity_units": m.cap[f], "utilization": round(u / m.cap[f], 4) if m.cap[f] > 0 else 0.0})
    duals = r.get("duals")
    price = [[round(duals["row_dual"][f"dem{d}_{k}"], 2) for k in range(m.K)] for d in range(m.D)] if duals else None
    jr = journeys(net, ro, ri)
    return {**base, "status": "Optimal", "journeys": jr, "hero": hero(net, jr), "objective_usd": round(r["objective"], 2), "components": breakdown(m, x), "open_sites": opened, "mip_gap": r["mip_gap"], "mip_nodes": r["nodes"],
            "lp_relaxation_bound_usd": round(lp_bound(text), 2), "service_level": round(1 - unmet / total, 6), "unmet_tons": round(unmet, 3), "routes_out": ro, "routes_in": ri,
            "site_use": use, "demand_price_usd_ton": price, "binding": binding(m, x, duals), "relaxation": relaxation_report(m, x) if m.p["relax"] else None}


def hauls(net: dict, ro: list, ri: list) -> dict:
    """Tons-weighted mean road-equivalent miles of the inbound (plant to site) and outbound (site to node) legs."""
    oa = net["out_arcs"]
    ti = sum(t for *_, t in ri) or 1.0
    to = sum(t for *_, t in ro) or 1.0
    return {"haul_in_mi": round(sum(t * net["in_road_mi"][int(p)][int(f)] for p, f, k, t in ri) / ti, 3),
            "haul_out_mi": round(sum(t * oa["road_mi"][int(a)] for a, k, t in ro) / to, 3)}


def journeys(net: dict, ro: list, ri: list) -> list:
    """[plant, site, node, commodity, tons]: the outbound tons of commodity k from site f are attributed to plants in proportion to f's inbound of k.
    Computed from the published (3-decimal) route lists so the artifact alone reproduces it."""
    oa = net["out_arcs"]
    inflow: dict = {}
    for p, f, k, t in ri:
        inflow.setdefault((int(f), int(k)), []).append((int(p), t))
    out = []
    for f in range(len(net["sites"])):
        for k in range(3):
            ins = inflow.get((f, k))
            if not ins:
                continue
            tot = sum(t for _, t in ins)
            for a, kk, t in ro:
                if int(kk) == k and oa["site"][int(a)] == f:
                    for p, ti in sorted(ins):
                        v = round(t * ti / tot, 3)
                        if v >= 0.0005:
                            out.append([p, f, oa["demand"][int(a)], k, v])
    return out


def hero(net: dict, jr: list) -> dict | None:
    """The largest packaged-goods journey with both legs at least 100 road-equivalent miles (ties: lowest plant, site, node)."""
    oa = net["out_arcs"]
    mi = {(oa["site"][a], oa["demand"][a]): oa["road_mi"][a] for a in range(len(oa["site"]))}
    best = None
    for p, f, d, k, t in jr:
        if k != 0:
            continue
        a, b = net["in_road_mi"][p][f], mi[(f, d)]
        if a >= 100 and b >= 100 and (best is None or t > best["tons"] or (t == best["tons"] and (p, f, d) < (best["plant"], best["site"], best["node"]))):
            best = {"plant": p, "site": f, "node": d, "commodity": 0, "tons": t, "in_mi": a, "out_mi": b}
    return best


def fd_checks(net: dict, sol: dict) -> None:
    """DR-10: for each binding capacity / supply row, raise the right-hand side by 1% and 5%, re-solve with the open set fixed (`solved_saving_usd`), and report
    the dual's prediction (`predicted_saving_usd`). `open_set_changed` says whether the free MILP would open a different set at that right-hand side."""
    base = sol["objective_usd"]
    for b in sol["binding"]:
        b["fd_check"] = []
        if b["group"] not in ("capacity", "plant_supply") or b["shadow_usd_per_unit"] is None:
            b["fd_check"] = None
            continue
        for pct in (1, 5):
            def perturbed(params):
                m = Model(net, params)
                if b["group"] == "capacity":
                    f = int(b["id"][1:]); delta = m.cap[f] * pct / 100; m.cap[f] += delta
                else:
                    pp, cid = b["id"][1:].split("/"); pp = int(pp); k = [c["id"] for c in net["commodities"]].index(cid); delta = m.sup[pp][k] * pct / 100; m.sup[pp][k] += delta
                return m, delta
            m, delta = perturbed({"fixed_open": sol["open_sites"]})
            fixed_obj = solve(m)["objective"]
            m2, _ = perturbed({})
            free = solve(m2)
            b["fd_check"].append({"pct": pct, "delta": round(delta, 3), "predicted_saving_usd": round(b["shadow_usd_per_unit"] * delta, 2), "solved_saving_usd": round(base - fixed_obj, 2),
                                  "open_set_changed": sorted(f for f in range(m2.F) if round(free["x"][f"z{f}"]) == 1) != sorted(sol["open_sites"])})
