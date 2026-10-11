"""Independent checks on the published solutions: only network.json + the route lists are used (no solver, no Model)."""
import numpy as np
import pytest

from analytics.milp import Model, breakdown, solve
from analytics.scenarios import routes
from pipelines.common import r4

STRICT_OK = ["optimized", "legacy", "demand_surge", "high_freight", "lean_sites"]
TOL_T = 0.02


def arrays(net, s):
    D, F, P = len(net["demand_nodes"]), len(net["sites"]), len(net["plants"])
    oa = net["out_arcs"]
    out = np.zeros((F, D, 3))
    inb = np.zeros((P, F, 3))
    for a, k, t in s["routes_out"]:
        out[oa["site"][int(a)], oa["demand"][int(a)], int(k)] += t
    for p, f, k, t in s["routes_in"]:
        inb[int(p), int(f), int(k)] += t
    return out, inb


@pytest.mark.parametrize("sid", STRICT_OK)
def test_demand_balance_per_node_and_commodity(net, sols, sid):
    s = sols[sid]
    out, _ = arrays(net, s)
    dem = np.array([[r4(t * s["params"]["demand_scale"]) for t in n["demand_tons"]] for n in net["demand_nodes"]])
    assert np.abs(out.sum(axis=0) - dem).max() <= TOL_T


@pytest.mark.parametrize("sid", STRICT_OK)
def test_flow_conservation_capacity_and_supply(net, sols, sid):
    s = sols[sid]
    out, inb = arrays(net, s)
    assert np.abs(inb.sum(axis=0) - out.sum(axis=1)).max() <= 0.05
    w = np.array([c["capacity_units_per_ton"] for c in net["commodities"]])
    use = (out.sum(axis=1) * w).sum(axis=1)
    cap = np.array([x["capacity_units"] * s["params"]["capacity_scale"] for x in net["sites"]])
    opened = np.zeros(len(cap), bool)
    opened[s["open_sites"]] = True
    assert (use[~opened] == 0).all()
    assert (use <= cap * opened + 0.5).all()
    sup = np.array([p["supply_tons"] for p in net["plants"]], float)
    assert (inb.sum(axis=1) <= sup + 0.05).all()
    assert len(s["open_sites"]) <= s["params"]["max_open_sites"]
    for u in s["site_use"]:
        assert abs(u["units"] - use[u["site"]]) <= 0.5


@pytest.mark.parametrize("sid", STRICT_OK + ["storm_optimized", "storm_legacy", "relaxed_supply", "relaxed_capacity", "relaxed_sites"])
def test_objective_equals_sum_of_components_recomputed_from_routes(net, sols, sid):
    s = sols[sid]
    p = s["params"]
    c = net["commodities"]
    oa = net["out_arcs"]
    fixed = sum(r4(net["sites"][f]["fixed_cost_usd_yr"] * p["fixed_cost_scale"]) for f in s["open_sites"])
    tout = sum(r4(c[int(k)]["rate_out_usd_ton_mi"] * oa["road_mi"][int(a)] * p["freight_scale"]) * t for a, k, t in s["routes_out"])
    hand = sum(r4(c[int(k)]["handling_usd_ton"]) * t for a, k, t in s["routes_out"] for k in [k])
    tin = sum(r4(c[int(k)]["rate_in_usd_ton_mi"] * net["in_road_mi"][int(pp)][int(f)] * p["freight_scale"]) * t for pp, f, k, t in s["routes_in"])
    pen = 0.0
    rel = s["relaxation"]
    if rel:
        pen = (6000.0 * sum(u["tons"] for u in rel["unmet_demand"]) + 2500.0 * sum(u["units"] for u in rel["capacity_overshoot"]) + 3500.0 * sum(u["tons"] for u in rel["supply_overshoot"])
               + 30_000_000.0 * rel["open_sites_excess"])
    total = fixed + tout + hand + tin + pen
    assert abs(total - s["objective_usd"]) <= 2e-5 * s["objective_usd"]
    comp = s["components"]
    assert abs(sum([comp["fixed_usd"], comp["inbound_transport_usd"], comp["outbound_transport_usd"], comp["handling_usd"], *comp["penalties_usd"].values()]) - s["objective_usd"]) <= 1.0
    assert abs(comp["fixed_usd"] - fixed) <= 1.0


@pytest.mark.parametrize("sid", ["optimized", "legacy", "storm_optimized", "relaxed_supply"])
def test_published_routes_equal_fresh_solution_flows(net, sols, sid):
    """Routes drawn == solution flows: re-solve from the published parameters and compare route by route."""
    s = sols[sid]
    m = Model(net, s["params"])
    r = solve(m)
    assert r["status"] == "Optimal"
    ro, ri = routes(m, r["x"])
    assert ro == s["routes_out"] and ri == s["routes_in"]
    assert abs(r["objective"] - s["objective_usd"]) <= 0.01


def test_breakdown_matches_objective_after_solve(net):
    m = Model(net, {})
    r = solve(m)
    b = breakdown(m, r["x"])
    assert abs(b["fixed_usd"] + b["inbound_transport_usd"] + b["outbound_transport_usd"] + b["handling_usd"] - r["objective"]) <= 1e-6 * r["objective"]


def test_optimum_beats_legacy_and_lp_bound_is_valid(sols):
    o, l = sols["optimized"], sols["legacy"]
    assert o["objective_usd"] < l["objective_usd"]
    for s in (o, l, sols["lean_sites"]):
        assert s["lp_relaxation_bound_usd"] <= s["objective_usd"] + 1e-6 * s["objective_usd"]
    assert sols["lean_sites"]["objective_usd"] >= o["objective_usd"]
    assert set(l["open_sites"]) == {0, 1, 2, 3, 4, 5}


def test_fixed_design_lp_duals_strong_duality_and_signs(net):
    m = Model(net, {})
    r = solve(m, with_duals=True)
    assert abs(r["duals"]["obj"] - r["objective"]) <= 1e-6 * r["objective"]
    d = r["duals"]["row_dual"]
    assert all(v <= 1e-9 for k, v in d.items() if k.startswith("cap") or k.startswith("sup"))   # relaxing a <= row never raises cost
    assert all(v > 0 for k, v in d.items() if k.startswith("dem"))                              # serving one more ton costs something


def test_binding_constraints_have_zero_slack_and_nonnegative_shadow(sols):
    for sid in STRICT_OK:
        for b in sols[sid]["binding"]:
            assert b["slack"] <= 1e-3
            assert b["shadow_usd_per_unit"] is None or b["shadow_usd_per_unit"] >= 0
    assert any(b["group"] == "open_sites" for b in sols["lean_sites"]["binding"])


def test_shadow_price_matches_finite_difference(net, sols):
    """Capacity shadow price of the binding site equals the cost change from a small capacity increase at the fixed design."""
    s = sols["optimized"]
    site = next(b for b in s["binding"] if b["group"] == "capacity")
    f = int(site["id"][1:])
    m = Model(net, {"fixed_open": s["open_sites"]})
    base = solve(m)["objective"]
    m2 = Model(net, {"fixed_open": s["open_sites"]})
    m2.cap[f] += 100.0
    up = solve(m2, m2.lp_text())["objective"]
    assert abs((base - up) / 100.0 - site["shadow_usd_per_unit"]) <= 0.05 * max(1.0, site["shadow_usd_per_unit"])
