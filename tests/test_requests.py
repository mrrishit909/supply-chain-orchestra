"""P07-DATA-002: DR-1 .. DR-10."""
import json
import math
import re

import numpy as np
import pytest

from analytics import words as W
from analytics.milp import DEFAULT_PARAMS, Model, solve
from analytics.network import albers, short_name
from analytics.scenarios import hauls, hero, journeys
from pipelines.common import ROOT, r4
from tests.conftest import load


# ---- DR-1 sweep
def test_sweep_series_shape_and_semantics(net, sols):
    sw = {s["id"]: s["records"] for s in load("sweep")["series"]}
    assert set(sw) == {"limit", "exactly"} and all([r["k"] for r in v] == list(range(1, 15)) for v in sw.values())
    lim, ex = sw["limit"], sw["exactly"]
    for r in ex:
        assert r["params"]["open_exactly"] and r["params"]["max_open_sites"] == r["k"]
        if r["status"] == "Optimal":
            assert len(r["open_sites"]) == r["k"]
    opt = sols["optimized"]
    for r in lim[7:]:  # the limit stops binding at the optimum's 8 sites
        assert r["status"] == "Optimal" and abs(r["objective_usd"] - opt["objective_usd"]) <= 0.02
    feas = [r["objective_usd"] for r in lim if r["status"] == "Optimal"]
    assert feas == sorted(feas, reverse=True)
    e = {r["k"]: r["objective_usd"] for r in ex if r["status"] == "Optimal"}
    assert min(e, key=e.get) == 8 and e[9] > e[8] < e[7]          # the exactly-k strip has its minimum at the optimum
    for series in (lim, ex):
        for r in series:
            if r["status"] == "Infeasible":
                rr = r["relaxed"]
                assert rr and rr["status"] == "Optimal" and rr["relaxation"]["words"] and rr["params"]["relax"]
                assert r["objective_usd"] is None and r["routes_out"] == []
            else:
                assert r["relaxed"] is None


def test_sweep_records_balance_and_hauls_from_routes(net):
    for s in load("sweep")["series"]:
        for r in s["records"]:
            if r["status"] != "Optimal":
                continue
            h = hauls(net, r["routes_out"], r["routes_in"])
            assert abs(h["haul_in_mi"] - r["haul_in_mi"]) < 1e-6 and abs(h["haul_out_mi"] - r["haul_out_mi"]) < 1e-6
            c = r["components"]
            assert abs(c["fixed_usd"] + c["inbound_transport_usd"] + c["outbound_transport_usd"] + c["handling_usd"] - r["objective_usd"]) <= 1.0
            out = np.zeros((14, 100, 3))
            for a, k, t in r["routes_out"]:
                out[net["out_arcs"]["site"][int(a)], net["out_arcs"]["demand"][int(a)], int(k)] += t
            dem = np.array([n["demand_tons"] for n in net["demand_nodes"]], float)
            assert np.abs(out.sum(axis=0) - dem).max() <= 0.02


def test_open_exactly_row_in_both_builders(net, tmp_path):
    t = Model(net, {"max_open_sites": 6, "open_exactly": True}).lp_text()
    assert re.search(r"^ mxo: .* = 6$", t, re.M) and not re.search(r"^ mxo: .* <= ", t, re.M)
    t2 = Model(net, {"max_open_sites": 6}).lp_text()
    assert re.search(r"^ mxo: .* <= 6$", t2, re.M)
    js = (ROOT / "tests/parity/build_lp.mjs").read_text()
    assert "p.open_exactly ? '=' : '<='" in js
    vs = {v["id"]: v for v in load("solver_test_vectors")["vectors"]}
    assert {"sweep:exactly:01", "sweep:exactly:14", "sweep:limit:01:relaxed", "sweep:exactly:02:relaxed"} <= set(vs)
    assert vs["sweep:exactly:01"]["expected"]["status"] == "Infeasible" and vs["sweep:exactly:02:relaxed"]["expected"]["status"] == "Optimal"


def test_parity_report_covers_every_vector_and_matches_facts():
    rep = json.loads((ROOT / "artifacts/evidence/parity_report.json").read_text())
    vec = load("solver_test_vectors")["vectors"]
    assert [r["id"] for r in rep["vectors"]] == [v["id"] for v in vec]
    assert rep["summary"]["failures"] == 0 and all(r["hashOk"] and r["statusOk"] and r["objOk"] for r in rep["vectors"])
    f = {x["id"]: x["value"] for x in load("facts")["facts"]}
    assert f["parity_vectors_run"] == len(vec) and f["parity_failures"] == 0
    assert f["parity_wasm_ms_median"] == rep["summary"]["wasm_ms_median"] and f["parity_wasm_ms_max"] == rep["summary"]["wasm_ms_max"]


# ---- DR-2
def test_defaults_and_presets_use_14(net, model_art):
    assert model_art["defaults"]["max_open_sites"] == 14 and DEFAULT_PARAMS["max_open_sites"] == 14 and model_art["defaults"]["open_exactly"] is False
    ctl = next(c for c in model_art["controls"] if c["id"] == "max_open_sites")
    assert ctl["default"] == 14 == ctl["max"]
    for p in model_art["presets"]:
        if p["id"] != "lean_sites" and p["id"] != "infeasible_sites" and p["id"] != "relaxed_sites":
            assert p["params"]["max_open_sites"] == 14, p["id"]
    sols = {s["id"]: s for s in load("solutions")["scenarios"]}
    assert all(sols[p["id"]]["params"] == p["params"] for p in model_art["presets"])


# ---- DR-3
def test_tags_follow_the_ruling():
    s = load("solutions")["tags"]
    assert s["scenarios"] == s["routes"] == "SYNTHETIC/SIMULATED" and s["duals"] == "DERIVED"
    f = {x["id"]: x["tag"] for x in load("facts")["facts"]}
    for i in ("optimized_cost_usd", "saving_vs_legacy_usd", "saving_vs_legacy_pct", "optimized_open_sites"):
        assert f[i] == "SYNTHETIC/SIMULATED"
    assert load("network")["tags"]["place_fields"] == "OBSERVED" and load("model")["tags"]["formulation"] == "SYNTHETIC"


# ---- DR-4
def test_journeys_reproduce_routes_and_hero_rule(net, sols):
    for sid, s in sols.items():
        if s["status"] != "Optimal":
            assert s["journeys"] == [] and s["hero"] is None
            continue
        assert s["journeys"] == journeys(net, s["routes_out"], s["routes_in"])
        oa = net["out_arcs"]
        out = {}
        for a, k, t in s["routes_out"]:
            out[(oa["site"][int(a)], oa["demand"][int(a)], int(k))] = t
        agg = {}
        for p, f, d, k, t in s["journeys"]:
            agg[(f, d, k)] = agg.get((f, d, k), 0) + t
        assert max(abs(agg.get(key, 0) - t) for key, t in out.items()) <= 0.01
        assert s["hero"] == hero(net, s["journeys"])
    h = sols["optimized"]["hero"]
    assert (h["plant"], h["site"], h["node"], h["tons"]) == (0, 3, 6, 19857.0) and h["in_mi"] >= 100 and h["out_mi"] >= 100
    # independent re-derivation of the hero
    cands = [(t, -p, -f, -d) for p, f, d, k, t in sols["optimized"]["journeys"] if k == 0 and net["in_road_mi"][p][f] >= 100
             and dict(zip(zip(net["out_arcs"]["site"], net["out_arcs"]["demand"]), net["out_arcs"]["road_mi"]))[(f, d)] >= 100]
    assert max(cands)[0] == h["tons"]


# ---- DR-5
def test_projection_constants_and_points(net):
    pr = net["projection"]
    assert pr["name"] == "albers_conic_equal_area" and pr["parallels"] == [29.5, 45.5] and pr["origin"] == [37.5, -96.0] and pr["earth_radius"] == 1
    assert albers(37.5, -96.0) == (0.0, 0.0)
    for g in net["demand_nodes"] + net["sites"] + net["plants"]:
        assert (g["x"], g["y"]) == albers(g["lat"], g["lon"])
    # independent formula (d3 geoAlbers with y up): scale 1, rotate to origin
    p1, p2, p0, l0 = map(math.radians, (29.5, 45.5, 37.5, -96.0))
    n = (math.sin(p1) + math.sin(p2)) / 2
    c = math.cos(p1) ** 2 + 2 * n * math.sin(p1)
    la, lo = map(math.radians, (41.837045, -87.684939))
    rho, rho0 = math.sqrt(c - 2 * n * math.sin(la)) / n, math.sqrt(c - 2 * n * math.sin(p0)) / n
    x, y = rho * math.sin(n * (lo - l0)), rho0 - rho * math.cos(n * (lo - l0))
    assert albers(41.837045, -87.684939) == (round(x, 6), round(y, 6))
    xs = [g["x"] for g in net["demand_nodes"]]; assert min(xs) < 0 < max(xs)


def test_short_names():
    assert short_name("Fort Worth city") == "Fort Worth" and short_name("Lexington-Fayette urban county") == "Lexington-Fayette" and short_name("X city (balance)") == "X"


# ---- DR-6
def test_mc_detail_is_consistent():
    r = load("robustness")
    d, n = r["draws"], r["config"]["draws"]
    assert all(len(d[k]) == n for k in d)
    for i in range(n):
        assert len(d["failed_sites"][i]) == d["sites_down"][i]
        assert (d["epicentre"][i] is not None) == bool(d["regional_event"][i])
    for design in r["designs"]:
        res = r["results"][design["id"]]
        for i in range(n):
            assert len(res["delivered_by_site"][i]) == len(design["open_sites"])
            assert abs(sum(res["delivered_by_site"][i]) + res["unmet_tons"][i] - d["demand_tons"][i]) <= 0.6
            for pos, f in enumerate(design["open_sites"]):
                if f in d["failed_sites"][i]:
                    assert res["delivered_by_site"][i][pos] == 0
        assert abs(sum(1 for s in res["service_level"] if s >= 0.9999) - next(x["value"] for x in load("facts")["facts"] if x["id"] == f"mc_full_service_{design['id']}")) == 0
    f = {x["id"]: x["value"] for x in load("facts")["facts"]}
    assert (f["mc_full_service_legacy"], f["mc_full_service_optimized"]) == (176, 319)
    for c in r["site_criticality"]:
        assert len(c["delivered_by_site"]) == 8 and abs(sum(c["delivered_by_site"]) + c["unmet_tons"] - 2589781) <= 1.0


# ---- DR-7
def test_facts_additions_match_sources(net, sols):
    f = {x["id"]: x["value"] for x in load("facts")["facts"]}
    for sid in ("optimized", "legacy"):
        h = hauls(net, sols[sid]["routes_out"], sols[sid]["routes_in"])
        assert f[f"haul_in_mi_{sid}"] == h["haul_in_mi"] and f[f"haul_out_mi_{sid}"] == h["haul_out_mi"]
    assert round(f["haul_in_mi_optimized"], 1) == 576.1 and round(f["haul_out_mi_optimized"], 1) == 203.8 and round(f["haul_in_mi_legacy"], 1) == 686.2 and round(f["haul_out_mi_legacy"], 1) == 244.0
    assert f["plant_supply_total_tons"] == 3237227 and f["demand_over_supply"] == 0.8
    assert (f["hero_plant"], f["hero_site"], f["hero_node"], f["hero_tons"]) == ("Fort Worth", "Houston", "San Antonio", 19857.0)
    assert abs(f["cost_per_ton_usd_optimized"] - sols["optimized"]["objective_usd"] / sols["optimized"]["total_demand_tons"]) < 1e-3
    assert f["optimized_lp_sha256_prefix"] == sols["optimized"]["lp_text_sha256"][:12]
    b = load("facts")["demand_price_bins"]
    pr = np.array(sols["optimized"]["demand_price_usd_ton"])
    for k, c in enumerate(b["commodities"]):
        assert c["edges"] == sorted(c["edges"]) and c["edges"][0] == round(pr[:, k].min(), 2) and c["edges"][-1] == round(pr[:, k].max(), 2)


# ---- DR-8
def test_words_are_template_renderings_and_examples_agree(net, sols, model_art):
    rw = model_art["relaxation_words"]
    assert rw["templates"] == W.TEMPLATES
    base = float(sum(sum(d["demand_tons"]) for d in net["demand_nodes"]))
    assert abs(base * 1.0 - 2589781) < 1
    for e in rw["examples"]:
        assert e["sentence"] == rw["templates"][e["family"]].format(**e["fields"])
        assert e["sentence"] in sols[e["scenario"]]["relaxation"]["words"]
    assert any(e["family"] == f for e in rw["examples"] for f in ("supply", "capacity", "unmet", "open_sites"))
    assert {e["family"] for e in rw["examples"]} == set(rw["order"])
    assert sols["relaxed_supply"]["relaxation"]["words"] == ["THE PLANTS WOULD HAVE TO MAKE 388,466 T MORE THAN THEY CAN (15% OF DEMAND): FORT WORTH 208,459 T, BOSTON 180,007 T."]
    for s in sols.values():
        if s["relaxation"]:
            assert s["relaxation"]["words"] == W.words(s["relaxation"], net, base, s["params"]["max_open_sites"])
            assert chr(0x2014) not in "".join(s["relaxation"]["words"])
    assert sols["optimized"]["relaxation"] is None


# ---- DR-9
def test_browser_contract(model_art):
    b = model_art["solver"]["browser"]
    assert b["time_limit_s"] == 10 and b["extra_status_strings"] == ["Time limit reached"] and b["warmup_preset"] == "optimized"
    assert any(p["id"] == b["warmup_preset"] for p in model_art["presets"]) and "GAP UNKNOWN" in b["time_limit_rule"]


# ---- DR-10
def test_finite_difference_checks(net, sols):
    rows = [b for b in sols["optimized"]["binding"] if b["group"] in ("capacity", "plant_supply")]
    assert rows
    for b in rows:
        assert [c["pct"] for c in b["fd_check"]] == [1, 5]
        c1, c5 = b["fd_check"]
        assert 0 <= c1["solved_saving_usd"] <= c1["predicted_saving_usd"] + 1 and 0 <= c5["solved_saving_usd"]  # a dual is a local slope: cost is convex in the right-hand side
        assert c5["delta"] > c1["delta"] > 0 and c5["solved_saving_usd"] <= c5["predicted_saving_usd"] + 1  # cost is convex in the right-hand side
    assert any(abs(b["fd_check"][0]["predicted_saving_usd"] - b["fd_check"][0]["solved_saving_usd"]) <= 0.01 * b["fd_check"][0]["predicted_saving_usd"] + 1 for b in rows)
    assert any(c["open_set_changed"] for b in rows for c in b["fd_check"])  # documented: a large enough change reopens the set
