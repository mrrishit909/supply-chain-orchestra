"""Site-count sweep (DR-1): k = 1..F as (a) a limit `max_open_sites = k` and (b) exactly k open sites (`open_exactly`). Infeasible k also carries a relaxed record."""
from __future__ import annotations

from analytics.scenarios import hauls, package

KEYS = ["params", "status", "objective_usd", "components", "open_sites", "routes_out", "routes_in", "lp_text_sha256"]


def record(net: dict, params: dict) -> dict:
    s = package(net, "sweep", "sweep", "", "sweep", params)
    r = {k: s[k] for k in KEYS}
    if s["status"] == "Optimal":
        h = hauls(net, s["routes_out"], s["routes_in"])
        r.update(h, cost_per_ton_usd=round(s["objective_usd"] / s["total_demand_tons"], 4))
    else:
        r.update(haul_in_mi=None, haul_out_mi=None, cost_per_ton_usd=None)
    r["relaxation"] = s["relaxation"]
    r["service_level"] = s["service_level"]
    return r


def run(net: dict) -> list[dict]:
    F = len(net["sites"])
    out = []
    for sid, label, ex in (("limit", "At most k sites open (max_open_sites = k)", False), ("exactly", "Exactly k sites open (open_exactly)", True)):
        recs = []
        for k in range(1, F + 1):
            p = {"max_open_sites": k, "open_exactly": ex}
            r = record(net, p)
            rec = {"k": k, **{x: r[x] for x in ("params", "status", "objective_usd", "components", "open_sites", "routes_out", "routes_in", "lp_text_sha256", "haul_in_mi", "haul_out_mi", "cost_per_ton_usd")}, "relaxed": None}
            if r["status"] != "Optimal":
                rr = record(net, {**p, "relax": True})
                rec["relaxed"] = {x: rr[x] for x in ("params", "status", "objective_usd", "components", "open_sites", "routes_out", "routes_in", "lp_text_sha256", "haul_in_mi", "haul_out_mi", "cost_per_ton_usd", "relaxation", "service_level")}
            recs.append(rec)
        out.append({"id": sid, "label": label, "records": recs})
    return out
