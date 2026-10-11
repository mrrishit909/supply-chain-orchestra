"""Solve a parameter set and package the result as a published scenario (routes, components, duals, binding constraints, relaxation report)."""
from __future__ import annotations

import hashlib

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
    return {"total_penalty_usd": round(sum(bd.values()), 2), "unmet_demand": unmet, "capacity_overshoot": cap, "supply_overshoot": sup, "open_sites_excess": sm,
            "summary": "; ".join(bits) if bits else "No constraint had to be relaxed."}


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
        return {**base, "status": r["status"], "objective_usd": None, "components": None, "open_sites": [], "mip_gap": None, "mip_nodes": None, "lp_relaxation_bound_usd": None,
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
    return {**base, "status": "Optimal", "objective_usd": round(r["objective"], 2), "components": breakdown(m, x), "open_sites": opened, "mip_gap": r["mip_gap"], "mip_nodes": r["nodes"],
            "lp_relaxation_bound_usd": round(lp_bound(text), 2), "service_level": round(1 - unmet / total, 6), "unmet_tons": round(unmet, 3), "routes_out": ro, "routes_in": ri,
            "site_use": use, "demand_price_usd_ton": price, "binding": binding(m, x, duals), "relaxation": relaxation_report(m, x) if m.p["relax"] else None}
