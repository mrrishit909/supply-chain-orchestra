import numpy as np
import pytest

from analytics.network import COMMODITIES, build_network
from pipelines.clean import load_places
from tests.conftest import load


def test_join_ledger_reconciles():
    L = load("quality")["join_ledger"]
    assert L["pep_sumlev162_rows"] == L["pep_geoid_unique"]
    assert L["joined"] == L["pep_sumlev162_rows"] - L["pep_unmatched_to_gazetteer"]
    assert L["usable_places"] == L["active_joined"] - L["dropped_non_contiguous"] - L["dropped_zero_pop"]
    assert L["gazetteer_rows"] == L["joined"] + L["gazetteer_unmatched_to_pep"]
    assert sum(L["gazetteer_unmatched_by_funcstat"].values()) == L["gazetteer_unmatched_to_pep"]
    assert all(c["result"] == "PASS" for c in load("quality")["checks"])


def test_network_basic_invariants(net):
    d = net["demand_nodes"]
    assert [x["pop2025"] for x in d] == sorted((x["pop2025"] for x in d), reverse=True)
    assert len({x["geoid"] for x in d}) == len(d) == 100
    assert all(24 < x["lat"] < 50 and -125 < x["lon"] < -66 for x in d + net["sites"] + net["plants"])
    assert all(x["state"] not in ("AK", "HI", "PR") for x in d)
    tons = np.array([x["demand_tons"] for x in d])
    assert (tons > 0).all()
    w = np.array([c["capacity_units_per_ton"] for c in COMMODITIES])
    assert abs(sum(s["capacity_units"] for s in net["sites"]) / float((tons * w).sum()) - net["constants"]["capacity_headroom"]) < 1e-3
    for k in range(3):
        assert abs(sum(p["supply_tons"][k] for p in net["plants"]) / tons[:, k].sum() - net["constants"]["supply_headroom"]) < 1e-3
    oa = net["out_arcs"]
    assert len(set(zip(oa["site"], oa["demand"]))) == len(oa["site"])
    # each demand node's arcs are its R nearest sites (distances non-decreasing within the node)
    for dd in range(100):
        ds = [m for m, x in zip(oa["road_mi"], oa["demand"]) if x == dd]
        assert ds == sorted(ds) and len(ds) == net["constants"]["nearest_sites_per_demand_node"]


@pytest.mark.slow
def test_generator_is_seeded_and_matches_published(raw_ready, net):
    if not raw_ready:
        pytest.skip("data/raw missing; run pipelines.ingest")
    places, _ = load_places()
    a, b = build_network(places), build_network(places)
    assert a == b
    assert a["sites"] == net["sites"] and a["out_arcs"] == net["out_arcs"] and a["demand_nodes"] == net["demand_nodes"]
    c = build_network(places, seed=1)
    assert c["sites"] != a["sites"] or c["demand_nodes"] != a["demand_nodes"]


def test_distance_rule_is_great_circle_times_circuity(net):
    from analytics.network import haversine_mi
    s, d = net["sites"], net["demand_nodes"]
    oa = net["out_arcs"]
    for a in (0, 7, 123, 400):
        gc = float(haversine_mi(s[oa["site"][a]]["lat"], s[oa["site"][a]]["lon"], d[oa["demand"][a]]["lat"], d[oa["demand"][a]]["lon"]))
        assert abs(oa["road_mi"][a] - gc * net["constants"]["circuity"]) <= 0.051
