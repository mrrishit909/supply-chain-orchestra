"""Constructed shortfalls: the strict model is infeasible and the elastic relaxation names exactly what had to give."""
import numpy as np

from analytics.scenarios import package


def test_supply_shortfall_is_explained_exactly(net, sols):
    assert sols["infeasible_supply"]["status"] == "Infeasible"
    r = sols["relaxed_supply"]["relaxation"]
    short = sum(max(0.0, 1.4 * sum(n["demand_tons"][k] for n in net["demand_nodes"]) - sum(p["supply_tons"][k] for p in net["plants"])) for k in range(3))
    assert abs(sum(x["tons"] for x in r["supply_overshoot"]) - short) <= 0.01 * short
    assert not r["unmet_demand"] and not r["capacity_overshoot"] and r["open_sites_excess"] == 0
    assert "plant supply" in r["summary"]


def test_capacity_shortfall_is_explained_exactly(net, sols):
    assert sols["infeasible_capacity"]["status"] == "Infeasible"
    r = sols["relaxed_capacity"]["relaxation"]
    w = [c["capacity_units_per_ton"] for c in net["commodities"]]
    need = sum(n["demand_tons"][k] * w[k] for n in net["demand_nodes"] for k in range(3))
    have = 0.3 * sum(s["capacity_units"] for s in net["sites"])
    assert abs(sum(x["units"] for x in r["capacity_overshoot"]) - (need - have)) <= 0.01 * (need - have)
    assert r["capacity_overshoot"] and all(0 < x["pct_of_capacity"] for x in r["capacity_overshoot"])


def test_open_site_limit_is_explained(sols):
    assert sols["infeasible_sites"]["status"] == "Infeasible"
    r = sols["relaxed_sites"]["relaxation"]
    assert r["open_sites_excess"] >= 1 and len(sols["relaxed_sites"]["open_sites"]) == 2 + round(r["open_sites_excess"])


def test_relaxed_feasible_instance_reports_nothing(net):
    s = package(net, "t", "t", "t", "relaxed", {"relax": True})
    r = s["relaxation"]
    assert s["status"] == "Optimal" and r["total_penalty_usd"] == 0 and r["summary"] == "No constraint had to be relaxed."
    assert s["objective_usd"] == package(net, "o", "o", "o", "design", {})["objective_usd"]


def test_strict_infeasible_has_no_solution_fields(sols):
    for sid in ("infeasible_supply", "infeasible_capacity", "infeasible_sites"):
        s = sols[sid]
        assert s["objective_usd"] is None and s["routes_out"] == [] and s["relaxation"] is None and s["service_level"] is None


def test_storm_unserved_demand_matches_service_level(sols):
    s = sols["storm_legacy"]
    assert s["unmet_tons"] > 0 and abs(s["service_level"] - (1 - s["unmet_tons"] / s["total_demand_tons"])) <= 1e-5
    assert sum(u["tons"] for u in s["relaxation"]["unmet_demand"]) > 0
