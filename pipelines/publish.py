"""Build the network, solve scenarios, run the Monte Carlo and write the versioned artifacts to site/public/data/."""
from __future__ import annotations

import json
import time
from importlib import metadata

import numpy as np

from analytics import milp
from analytics.milp import DEFAULT_PARAMS, OPTIONS, PENALTY, Model, full_params, solve
from analytics.network import COMMODITIES, build_network, road_mi
from analytics import sweep as sweep_mod
from analytics import words as W
from analytics.robustness import run_mc
from analytics.scenarios import fd_checks, hauls, package, sha
from pipelines.clean import EXCLUDED_STATES, load_places
from pipelines.common import MANIFESTS, PUBLIC, ROOT, SEED, dumps

LEGACY = [0, 1, 2, 3, 4, 5]  # the six sites in the six largest host cities (sites are sorted by host population)
STORM_CENTER, STORM_RADIUS_MI = "Houston city", 350.0
TAGS_NET = {"place_fields": "OBSERVED", "road_mi": "DERIVED", "projection": "DERIVED", "xy": "DERIVED", "demand_tons": "SYNTHETIC", "sites": "SYNTHETIC", "plants": "SYNTHETIC", "costs": "SYNTHETIC"}
ATTR = ("Source: U.S. Census Bureau, Population Estimates Program (PEP) 2025 and Gazetteer Files 2026. This product uses Census Bureau data but is not endorsed or "
        "certified by the Census Bureau. Network, costs and all solver and Monte Carlo outputs are SYNTHETIC.")


def storm_sites(net: dict) -> list[int]:
    c = next(d for d in net["demand_nodes"] if d["name"] == STORM_CENTER)
    return [f for f, s in enumerate(net["sites"]) if road_mi(c["lat"], c["lon"], s["lat"], s["lon"]) <= STORM_RADIUS_MI]


def presets(net: dict, opt: list[int]) -> list[dict]:
    st = storm_sites(net)
    lo = sorted(set(LEGACY) - set(st))
    oo = sorted(set(opt) - set(st))
    P = lambda i, l, d, k, p: {"id": i, "label": l, "description": d, "kind": k, "params": full_params(p)}
    return [
        P("optimized", "Optimized network", "Minimum-cost open set and flows for the baseline synthetic network.", "design", {}),
        P("legacy", "Legacy footprint", f"Sites fixed to the six largest host cities (S00 to S05); flows re-optimised for that fixed footprint.", "design", {"fixed_open": LEGACY}),
        P("demand_surge", "Demand +18%", "All demand scaled by 1.18 (still inside plant supply headroom), network re-optimised.", "design", {"demand_scale": 1.18}),
        P("high_freight", "Freight rates x1.6", "All per ton-mile rates x1.6; the optimum opens more sites to shorten last-mile hauls.", "design", {"freight_scale": 1.6}),
        P("lean_sites", "At most 5 sites", "Open-site limit of 5.", "design", {"max_open_sites": 5}),
        P("storm_optimized", "Gulf storm on the optimized network", f"Sites within {STORM_RADIUS_MI:.0f} mi of {STORM_CENTER} closed; remaining optimized sites fixed; elastic relaxation shows what cannot be served.", "stress",
          {"fixed_open": oo, "closed_sites": st, "relax": True}),
        P("storm_legacy", "Gulf storm on the legacy footprint", "Same storm applied to the legacy footprint.", "stress", {"fixed_open": lo, "closed_sites": st, "relax": True}),
        P("infeasible_supply", "Demand +40% (strict)", "Demand x1.4 exceeds plant supply (headroom 1.25): the strict model is infeasible.", "infeasible", {"demand_scale": 1.4}),
        P("relaxed_supply", "Demand +40% (relaxed)", "Same instance with elastic slack: the report names the plant supply rows that must be exceeded.", "relaxed", {"demand_scale": 1.4, "relax": True}),
        P("infeasible_capacity", "Capacity x0.3 (strict)", "Site capacity scaled to 30%: total capacity is below demand, strict model infeasible.", "infeasible", {"capacity_scale": 0.3}),
        P("relaxed_capacity", "Capacity x0.3 (relaxed)", "Same instance relaxed: capacity overshoot per site is reported.", "relaxed", {"capacity_scale": 0.3, "relax": True}),
        P("infeasible_sites", "At most 2 sites (strict)", "Two sites cannot hold the demand: strict model infeasible.", "infeasible", {"max_open_sites": 2}),
        P("relaxed_sites", "At most 2 sites (relaxed)", "Same instance relaxed: the report says how many sites beyond the limit are needed.", "relaxed", {"max_open_sites": 2, "relax": True}),
    ]


def controls(net: dict) -> list[dict]:
    R = lambda i, l, u, lo, hi, st, d: {"id": i, "label": l, "unit": u, "kind": "range", "min": lo, "max": hi, "step": st, "default": d, "param_path": f"params.{i}", "options": None}
    return [R("demand_scale", "Demand multiplier", "x", 0.5, 1.6, 0.05, 1.0), R("freight_scale", "Freight rate multiplier", "x", 0.5, 3.0, 0.1, 1.0),
            R("fixed_cost_scale", "Site fixed-cost multiplier", "x", 0.25, 3.0, 0.05, 1.0), R("capacity_scale", "Site capacity multiplier", "x", 0.25, 1.5, 0.05, 1.0),
            R("max_open_sites", "Maximum open sites", "sites", 1, len(net["sites"]), 1, len(net["sites"])),
            {"id": "closed_sites", "label": "Closed sites (outage)", "unit": "", "kind": "multiselect", "min": None, "max": None, "step": None, "default": [], "param_path": "params.closed_sites",
             "options": [s["id"] for s in net["sites"]]},
            {"id": "relax", "label": "Explain infeasibility (elastic relaxation)", "unit": "", "kind": "toggle", "min": None, "max": None, "step": None, "default": False, "param_path": "params.relax", "options": None}]


def vectors(net: dict, pre: list[dict]) -> tuple[list[dict], str]:
    rng = np.random.default_rng(SEED + 2)
    F = len(net["sites"])
    items = [(f"preset:{p['id']}", "preset" if p["kind"] in ("design", "stress") else p["kind"], p["params"]) for p in pre]
    for i in range(14):
        prm = {"demand_scale": round(float(rng.uniform(0.6, 1.3)), 2), "freight_scale": round(float(rng.uniform(0.6, 2.2)), 2), "fixed_cost_scale": round(float(rng.uniform(0.3, 2.5)), 2),
               "capacity_scale": round(float(rng.uniform(0.45, 1.4)), 2), "max_open_sites": int(rng.integers(4, F + 1)), "relax": bool(i % 4 == 3)}
        items.append((f"random:{i:02d}", "random", prm))
    for i in range(4):
        cl = sorted(int(v) for v in rng.choice(F, size=int(rng.integers(1, 4)), replace=False))
        items.append((f"closure:{i:02d}", "closure", {"closed_sites": cl, "relax": i % 2 == 1, "demand_scale": round(float(rng.uniform(0.9, 1.15)), 2)}))
    for k in (1, 2, 4, 6, 8, 10, 12, 14):
        items.append((f"sweep:exactly:{k:02d}", "sweep", {"max_open_sites": k, "open_exactly": True}))
    items.append(("sweep:limit:01:relaxed", "sweep", {"max_open_sites": 1, "relax": True}))
    items.append(("sweep:exactly:02:relaxed", "sweep", {"max_open_sites": 2, "open_exactly": True, "relax": True}))
    out, text0 = [], ""
    for vid, kind, prm in items:
        m = Model(net, prm)
        text = m.lp_text()
        r = solve(m, text)
        if vid == "preset:optimized":
            text0 = text
        if r["status"] == "Optimal":
            from analytics.milp import breakdown
            x = r["x"]
            bd = breakdown(m, x)
            unmet = float(sum(x[f"u{d}_{k}"] for d in range(m.D) for k in range(m.K))) if m.p["relax"] else 0.0
            grp = []
            if m.p["relax"]:
                for nm, pre_ in (("unmet_demand", "u"), ("capacity_overshoot", "so"), ("supply_overshoot", "sp"), ("open_sites_excess", "sm")):
                    if any(v > 5e-4 for n_, v in x.items() if n_.startswith(pre_)):
                        grp.append(nm)
            exp = {"status": "Optimal", "objective_usd": round(r["objective"], 2), "components": bd, "open_sites": [f for f in range(F) if round(x[f"z{f}"]) == 1], "unmet_tons": round(unmet, 3), "relaxed_groups": sorted(set(grp))}
        else:
            exp = {"status": r["status"], "objective_usd": None, "components": None, "open_sites": [], "unmet_tons": None, "relaxed_groups": []}
        out.append({"id": vid, "kind": kind, "params": m.p, "lp_text_sha256": sha(text), "expected": exp})
    return out, text0


def relaxation_words(net: dict, by: dict) -> dict:
    base = float(sum(sum(d["demand_tons"]) for d in net["demand_nodes"]))
    ex = []
    for sid in ("relaxed_supply", "relaxed_capacity", "storm_legacy", "storm_optimized", "relaxed_sites"):
        s = by[sid]
        for fam, fields in W.families(s["relaxation"], net, base, int(s["params"]["max_open_sites"])):
            ex.append({"scenario": sid, "family": fam, "fields": fields, "sentence": W.render(fam, fields)})
    return {"templates": W.TEMPLATES, "order": W.ORDER, "rules": W.RULES, "examples": ex}


def main() -> None:
    t0 = time.time()
    man = json.loads((MANIFESTS / "census_extract.json").read_text())
    gen_at = max(v["fetched_at_utc"] for v in man.values())
    places, ledger = load_places()
    net = build_network(places)
    F, D = len(net["sites"]), len(net["demand_nodes"])
    base = package(net, "optimized", "Optimized network", "", "design", {})
    opt = base["open_sites"]
    pre = presets(net, opt)
    tm = {}
    sols = []
    for p in pre:
        t = time.time()
        sols.append(package(net, p["id"], p["label"], p["description"], p["kind"], p["params"]))
        tm[p["id"]] = round(time.time() - t, 2)
    fd_checks(net, next(s for s in sols if s["id"] == "optimized"))
    sw = sweep_mod.run(net)
    mc = run_mc(net, {"legacy": LEGACY, "optimized": opt})
    tm["monte_carlo"] = round(time.time() - t0, 1)
    vec, lp_text = vectors(net, pre)
    m0 = Model(net)
    cols, rows = m0.cols(), m0.rows()
    nnz = sum(len(r[1]) for r in rows)
    sizes = {"columns": len(cols), "rows": len(rows), "binaries": F, "nonzeros": nnz}
    by = {s["id"]: s for s in sols}
    S = {"schema_version": "v1", "generated_at": gen_at}
    by_pre = by
    tot_dem = float(sum(sum(d["demand_tons"]) for d in net["demand_nodes"]))

    # ---- quality
    sel_pop = sum(d["pop2025"] for d in net["demand_nodes"])
    oa = net["out_arcs"]
    checks = [
        ("arcs_per_demand_node", "Every demand node has exactly R candidate out-arcs", all(oa["demand"].count(d) == net["constants"]["nearest_sites_per_demand_node"] for d in range(D)), True),
        ("arcs_unique", "No duplicate (site, demand) out-arc", len(set(zip(oa["site"], oa["demand"]))) == len(oa["site"]), True),
        ("capacity_covers_demand", "Total candidate capacity / total weighted demand", round(sum(s["capacity_units"] for s in net["sites"]) / sum(d["demand_tons"][k] * COMMODITIES[k]["capacity_units_per_ton"] for d in net["demand_nodes"] for k in range(3)), 4), None),
        ("supply_covers_demand", "Total plant supply / total demand per commodity (min)", round(min(sum(p["supply_tons"][k] for p in net["plants"]) / sum(d["demand_tons"][k] for d in net["demand_nodes"]) for k in range(3)), 4), None),
        ("distinct_places", "Demand nodes, sites and plants reference real GEOIDs; sites are distinct", len({s["geoid"] for s in net["sites"]}) == F, True),
        ("nonnegative_distances", "All road-equivalent distances are non-negative (a plant may share a host city with a site: distance 0)", min(oa["road_mi"]) >= 0 and min(min(r) for r in net["in_road_mi"]) >= 0, True),
        ("gaz_pep_balance", "Joined rows = PEP SUMLEV 162 rows - unmatched PEP rows", ledger["joined"] == ledger["pep_sumlev162_rows"] - ledger["pep_unmatched_to_gazetteer"], True),
        ("population_sum", "Demand-node population sum (OBSERVED)", sel_pop, None),
    ]
    quality = {**S, "tags": {"join_ledger": "OBSERVED", "selection": "DERIVED", "checks": "DERIVED"}, "join_ledger": ledger,
               "selection": {"demand_nodes": D, "demand_population": sel_pop, "share_of_usable_population": round(sel_pop / ledger["usable_population_sum"], 4), "excluded_states": sorted(EXCLUDED_STATES),
                             "internal_point_note": "Coordinates are Census internal points inside each place boundary: not city halls, not population centroids, not warehouse locations."},
               "checks": [{"id": i, "description": d, "result": ("PASS" if (v is True or (ex is None)) else "FAIL"), "value": v if not isinstance(v, bool) else v} for i, d, v, ex in checks]}
    assert all(c["result"] == "PASS" for c in quality["checks"]), quality["checks"]

    # ---- network
    network = {**S, "tags": TAGS_NET, "units": {"distance": "road-equivalent miles = great-circle miles x 1.2 (no road routing)", "demand": "tons per year", "capacity": "throughput units per year (tons x capacity_units_per_ton)",
                                               "cost": "USD (fixed per year; rates per ton-mile; handling per ton)", "population": "persons, 1 July 2025 estimate"}, **net}

    # ---- model
    model = {**S, "tags": {"formulation": "SYNTHETIC", "solver": "SYNTHETIC", "controls": "SYNTHETIC"},
             "formulation": {"summary": "Two-echelon capacitated fixed-charge facility location with multi-commodity flow: plants ship to open candidate sites, sites ship to demand nodes, every demand node must receive its demand for every commodity.",
                             "objective": "min sum_f fixed_f z_f + sum_{a,k} (t_out[a,k] + handling_k) x[a,k] + sum_{p,f,k} t_in[p,f,k] y[p,f,k] (+ penalties on slack columns when relax = true)",
                             "variables": ["z[f] in {0,1}: site f open", "x[a,k] >= 0 tons of commodity k on out-arc a (site to demand node)", "y[p,f,k] >= 0 tons of commodity k from plant p to site f",
                                           "relaxed only: u[d,k] unmet tons, so[f] capacity overshoot units, sp[p,k] supply overshoot tons, sm open-site excess"],
                             "constraints": ["dem[d,k]: sum of x into node d for k (+ u[d,k]) = demand[d,k]", "flw[f,k]: sum_p y[p,f,k] - sum_{a out of f} x[a,k] = 0 (no inventory)",
                                             "cap[f]: sum_k w_k sum_{a out of f} x[a,k] - cap_f z_f (- so[f]) <= 0", "sup[p,k]: sum_f y[p,f,k] (- sp[p,k]) <= supply[p,k]",
                                             "lnk[a,k]: x[a,k] - demand[d(a),k] z[f(a)] <= 0 (tightening, does not change the optimum)", "mxo: sum_f z[f] (- sm) <= max_open_sites",
                                             "cls[f]: z[f] = 0 for closed sites; fix[f]: z[f] = 0|1 when a design is locked; closed lanes: x[a,k] = 0 in Bounds"],
                             "relaxation": [f"Elastic slack columns are added only when params.relax is true. Penalties per unit: unmet demand {PENALTY['unmet_usd_ton']:g} USD/t, capacity overshoot {PENALTY['capacity_usd_unit']:g} USD/unit, "
                                            f"plant supply overshoot {PENALTY['supply_usd_ton']:g} USD/t, extra open site {PENALTY['open_sites_usd_site']:g} USD/site.",
                                            "Each penalty exceeds any feasible marginal cost of the same quantity, so a slack is positive only when the strict model cannot be satisfied.",
                                            "The relaxation report lists every slack above 0.0005, grouped by constraint family. Individual slack amounts can split differently between alternative optima; the total penalty and status are what is compared."]},
             "lp_format": {"rounding_rule": "r4(x) = floor(x * 10000 + 0.5) / 10000", "number_format": "fixed 4 decimals, trailing zeros and dangling point stripped, -0 written 0, no exponent",
                           "column_order": ["z[f] by site", "x[a,k] by arc then commodity", "y[p,f,k] by plant, site, commodity", "relaxed only: u[d,k], so[f], sp[p,k], sm"],
                           "row_order": ["dem[d,k]", "flw[f,k]", "cap[f]", "sup[p,k]", "lnk[a,k]", "mxo", "cls[f] for closed sites", "fix[f] for all sites when fixed_open is set"],
                           "names": "z{f}, x{a}_{k}, y{p}_{f}_{k}, u{d}_{k}, so{f}, sp{p}_{k}, sm; rows dem{d}_{k}, flw{f}_{k}, cap{f}, sup{p}_{k}, lnk{a}_{k}, mxo, cls{f}, fix{f}",
                           "sections": "Minimize / Subject To / Bounds (closed lanes) / Binary (all z) / End; objective lists non-zero costs in column order",
                           "note": "HiGHS orders columns by first appearance in the file; always map solution values back by column name."},
             "solver": {"options": OPTIONS, "highs_python": f"highspy {metadata.version('highspy')} (HiGHS {milp.HIGHS_VERSION})", "highs_browser": "highs@1.15.3 (HiGHS-wasm)",
                        "status_strings": {"optimal": "Optimal", "infeasible": "Infeasible"},
                        "browser": {"time_limit_s": 10, "extra_status_strings": ["Time limit reached"], "warmup_preset": "optimized",
                                    "time_limit_rule": "Pass time_limit 10 to highs@1.15.3 in the worker. Measured with this build: on a time-out Status is 'Time limit reached'; ObjectiveValue is Infinity when no incumbent exists (take the error path) and the incumbent objective otherwise, with Columns holding the incumbent. highs-js returns no MIP gap, so the gap is NOT available from the solve: show 'GAP UNKNOWN' unless the params equal a preset, then (objective - lp_relaxation_bound_usd) / objective from that preset. A time-limited result is never labelled Optimal and never compared for parity."},
                        "browser_note": "Python executed here; the browser build is exercised by tests/parity (node, same wasm build). Solve time in the browser is machine-dependent and reported in docs/TESTING.md."},
             "penalties": {**PENALTY, "note": "Penalties are modelling devices for the relaxation, not costs; they are reported separately from operating cost."},
             "relaxation_words": relaxation_words(net, by_pre),
             "defaults": DEFAULT_PARAMS, "controls": controls(net), "presets": pre, "sizes": sizes}

    # ---- solutions
    solutions = {**S, "tags": {"scenarios": "SYNTHETIC/SIMULATED", "routes": "SYNTHETIC/SIMULATED", "journeys": "SYNTHETIC/SIMULATED", "duals": "DERIVED"},
                 "journeys_note": "journeys = [plant, site, node, commodity, tons]: outbound tons of commodity k from site f are attributed to plants in proportion to f's inbound tons of k (computed from the 3-decimal route lists, rows below 0.0005 t omitted). hero = the largest packaged-goods journey with both legs >= 100 road-equivalent miles (ties: lowest plant, site, node). Tons are rounded per row, so row sums match routes within 0.01 t per (site, node, commodity).", "flow_precision": "tons rounded to 3 decimals; flows below 0.0005 t omitted",
                 "duals_note": "Shadow prices and demand prices are row duals of the LP with the binaries fixed at the MILP optimum: they are conditional on that open set and valid only for small right-hand-side changes. Absent for relaxed scenarios.",
                 "scenarios": sols}

    # ---- robustness
    cfg = mc["config"]
    robustness = {**S, "tags": {"config": "SIMULATED", "draws": "SIMULATED", "results": "SYNTHETIC/SIMULATED", "summary": "SYNTHETIC/SIMULATED", "histograms": "SYNTHETIC/SIMULATED", "site_criticality": "SYNTHETIC"},
                  "config": cfg, "designs": [{"id": k, "label": "Legacy footprint" if k == "legacy" else "Optimized network", "open_sites": LEGACY if k == "legacy" else opt,
                                              "undisrupted_cost_usd": mc["undisrupted"][k]["cost"], "undisrupted_service_level": mc["undisrupted"][k]["service"]} for k in ("legacy", "optimized")],
                  "draws": mc["draws"], "results": mc["results"], "summary": mc["summary"], "histograms": mc["histograms"], "site_criticality": mc["site_criticality"],
                  "storm_exemplar": {"epicenter": STORM_CENTER, "radius_mi": STORM_RADIUS_MI, "closed_sites": storm_sites(net)}}

    sweep_art = {**S, "tags": {"series": "SYNTHETIC/SIMULATED", "hauls": "DERIVED"},
                 "note": "k = 1..14, other params default. Series 'limit' sets max_open_sites = k (flat above the optimum's 8 sites); series 'exactly' also sets open_exactly (the mxo row is =). Infeasible k carry a relaxed record (relax = true) with the elastic report and words. Hauls are tons-weighted road-equivalent miles of the inbound and outbound legs.",
                 "series": sw}

    # ---- vectors
    tv = {**S, "tags": {"vectors": "SYNTHETIC"},
          "note": "Rebuild the LP from network.json + model.json using vector.params, hash the text (SHA-256 of UTF-8) and compare, then solve with the options below. Compare status and objective_usd; components, open_sites and relaxed_groups are informative.",
          "parity_keys": ["lp_text_sha256", "status", "objective_usd"], "tolerance_rel": 1e-6, "tolerance_abs_usd": 1.0, "solver_options": OPTIONS, "lp_text": lp_text, "lp_text_vector_id": "preset:optimized", "vectors": vec}

    # ---- facts
    sv = by["legacy"]["objective_usd"] - by["optimized"]["objective_usd"]
    sm_ = mc["summary"]
    osol = by["optimized"]
    hero_ = osol["hero"]
    hn = lambda g: g["short_name"]
    prices = np.array(osol["demand_price_usd_ton"])
    bins = {"scenario": "optimized", "unit": "USD per ton", "tag": "DERIVED", "commodities": [{"id": c["id"], "edges": [round(float(v), 2) for v in np.quantile(prices[:, k], [0, .2, .4, .6, .8, 1])]} for k, c in enumerate(COMMODITIES)]}
    sup_tot = float(sum(sum(p["supply_tons"]) for p in net["plants"]))
    rep_f = ROOT / "artifacts/evidence/parity_report.json"
    facts = [("demand_nodes", "Demand nodes", D, "places", "OBSERVED", "network.json"), ("candidate_sites", "Candidate sites", F, "sites", "SYNTHETIC", "network.json"),
             ("total_demand_tons", "Total annual demand", round(tot_dem), "t/yr", "SYNTHETIC", "network.json"), ("optimized_cost_usd", "Optimized annual cost", by["optimized"]["objective_usd"], "USD/yr", "SYNTHETIC/SIMULATED", "solutions.json"),
             ("legacy_cost_usd", "Legacy footprint annual cost", by["legacy"]["objective_usd"], "USD/yr", "SYNTHETIC/SIMULATED", "solutions.json"), ("saving_vs_legacy_usd", "Saving of optimized vs legacy", round(sv, 2), "USD/yr", "SYNTHETIC/SIMULATED", "solutions.json"),
             ("saving_vs_legacy_pct", "Saving of optimized vs legacy", round(100 * sv / by["legacy"]["objective_usd"], 2), "%", "SYNTHETIC/SIMULATED", "solutions.json"), ("optimized_open_sites", "Sites opened by the optimum", len(opt), "sites", "SYNTHETIC/SIMULATED", "solutions.json"),
             ("lp_gap_pct", "LP relaxation bound below MILP optimum", round(100 * (1 - by["optimized"]["lp_relaxation_bound_usd"] / by["optimized"]["objective_usd"]), 3), "%", "SYNTHETIC/SIMULATED", "solutions.json"),
             ("mc_draws", "Monte Carlo draws", cfg["draws"], "draws", "SIMULATED", "robustness.json"), ("mc_service_mean_optimized", "Mean service level, optimized, disrupted", round(sm_["optimized"]["service_level"]["mean"], 4), "share", "SYNTHETIC/SIMULATED", "robustness.json"),
             ("mc_service_mean_legacy", "Mean service level, legacy, disrupted", round(sm_["legacy"]["service_level"]["mean"], 4), "share", "SYNTHETIC/SIMULATED", "robustness.json"),
             ("mc_cvar95_optimized_usd", "CVaR95 adjusted cost, optimized", round(sm_["optimized"]["adjusted_cost"]["cvar95"], 2), "USD/yr", "SYNTHETIC/SIMULATED", "robustness.json"),
             ("mc_cvar95_legacy_usd", "CVaR95 adjusted cost, legacy", round(sm_["legacy"]["adjusted_cost"]["cvar95"], 2), "USD/yr", "SYNTHETIC/SIMULATED", "robustness.json"),
             ("model_columns", "Model columns", sizes["columns"], "columns", "SYNTHETIC", "model.json"), ("model_rows", "Model rows", sizes["rows"], "rows", "SYNTHETIC", "model.json"),
             ("parity_vectors", "Browser parity vectors", len(vec), "vectors", "SYNTHETIC", "solver_test_vectors.json")]
    SS = "SYNTHETIC/SIMULATED"
    extra = []
    for sid, s in by.items():
        if s["status"] == "Optimal":
            h = hauls(net, s["routes_out"], s["routes_in"])
            extra += [(f"haul_in_mi_{sid}", f"Inbound haul, {sid}", h["haul_in_mi"], "road-equivalent mi (tons-weighted)", SS, "solutions.json"), (f"haul_out_mi_{sid}", f"Outbound haul, {sid}", h["haul_out_mi"], "road-equivalent mi (tons-weighted)", SS, "solutions.json")]
            if s["kind"] == "design":
                extra.append((f"cost_per_ton_usd_{sid}", f"Cost per ton, {sid}", round(s["objective_usd"] / s["total_demand_tons"], 4), "USD/t", SS, "solutions.json"))
    extra += [("plant_supply_total_tons", "Total plant supply", round(sup_tot), "t/yr", "SYNTHETIC", "network.json"), ("demand_over_supply", "Demand / plant supply", round(tot_dem / sup_tot, 4), "ratio", "SYNTHETIC", "network.json"),
              ("hero_plant", "Hero journey plant", hn(net["plants"][hero_["plant"]]), "", SS, "solutions.json"), ("hero_site", "Hero journey site", hn(net["sites"][hero_["site"]]), "", SS, "solutions.json"),
              ("hero_node", "Hero journey city", hn(net["demand_nodes"][hero_["node"]]), "", SS, "solutions.json"), ("hero_tons", "Hero journey tons", hero_["tons"], "t/yr", SS, "solutions.json"),
              ("hero_in_mi", "Hero inbound leg", hero_["in_mi"], "road-equivalent mi", "DERIVED", "network.json"), ("hero_out_mi", "Hero outbound leg", hero_["out_mi"], "road-equivalent mi", "DERIVED", "network.json"),
              ("mc_full_service_legacy", "Draws with full service, legacy", int(sum(1 for v in mc["results"]["legacy"]["service_level"] if v >= 0.9999)), "draws", SS, "robustness.json"),
              ("mc_full_service_optimized", "Draws with full service, optimized", int(sum(1 for v in mc["results"]["optimized"]["service_level"] if v >= 0.9999)), "draws", SS, "robustness.json"),
              ("optimized_lp_sha256_prefix", "LP text SHA-256 prefix, optimized", osol["lp_text_sha256"][:12], "", "SYNTHETIC", "solver_test_vectors.json")]
    if rep_f.exists():
        ps = json.loads(rep_f.read_text())["summary"]
        extra += [("parity_vectors_run", "Parity vectors run in HiGHS-wasm", ps["vectors"], "vectors", "SYNTHETIC", "artifacts/evidence/parity_report.json"), ("parity_failures", "Parity failures", ps["failures"], "vectors", "SYNTHETIC", "artifacts/evidence/parity_report.json"),
                  ("parity_wasm_ms_median", "HiGHS-wasm median solve (node)", ps["wasm_ms_median"], "ms", "SYNTHETIC", "artifacts/evidence/parity_report.json"), ("parity_wasm_ms_max", "HiGHS-wasm max solve (node)", ps["wasm_ms_max"], "ms", "SYNTHETIC", "artifacts/evidence/parity_report.json")]
    facts += extra
    facts_a = {**S, "tags": {"facts": "SYNTHETIC/SIMULATED", "demand_price_bins": "DERIVED"}, "demand_price_bins": bins, "facts": [{"id": i, "label": l, "value": v, "unit": u, "tag": t, "source": s} for i, l, v, u, t, s in facts]}

    names = ["meta", "quality", "network", "model", "solutions", "robustness", "sweep", "solver_test_vectors", "facts"]
    meta = {**S, "tags": {"sources": "OBSERVED", "sizes": "SYNTHETIC"}, "project": "07-supply-chain-orchestra", "tagline": "Every Product Has a Journey", "seed": SEED,
            "sources": [{"id": "gazetteer", "name": "U.S. Census Bureau, Gazetteer Files 2026, places", "url": man["gaz.zip"]["url"], "vintage": "2026", "retrieved_at_utc": man["gaz.zip"]["fetched_at_utc"], "sha256": man["gaz.zip"]["sha256"],
                         "bytes": man["gaz.zip"]["bytes"], "use": "internal-point coordinates, GEOID, FUNCSTAT", "tag": "OBSERVED"},
                        {"id": "pep", "name": "U.S. Census Bureau, Population Estimates Program, sub-est2025", "url": man["sub-est2025.csv"]["url"], "vintage": "Vintage 2025", "retrieved_at_utc": man["sub-est2025.csv"]["fetched_at_utc"],
                         "sha256": man["sub-est2025.csv"]["sha256"], "bytes": man["sub-est2025.csv"]["bytes"], "use": "2025 population estimate, SUMLEV 162", "tag": "OBSERVED"}],
            "attribution": ATTR, "licence_note": "Public-domain status of Census files was not verifiable (copyright page 404); attribution only, no endorsement implied. FAF5 not used (BTS 403).",
            "limitations": ["The network, costs and capacities are synthetic; results are not statements about any real supply chain.", "Distances are great-circle x 1.2, not road routes; internal points are not facilities.",
                            "Monte Carlo outcomes are SIMULATED, evaluated for fixed designs; the design is not optimised against disruptions.", "Duals are conditional on the optimal open set."],
            "sizes": {"demand_nodes": D, "candidate_sites": F, "plants": len(net["plants"]), "commodities": 3, "out_arcs": len(oa["site"]), "columns": sizes["columns"], "rows": sizes["rows"], "binaries": F},
            "artifacts": {"files": [f"{n}.json" for n in names]}}
    arts = {"meta": meta, "quality": quality, "network": network, "model": model, "solutions": solutions, "robustness": robustness, "sweep": sweep_art, "solver_test_vectors": tv, "facts": facts_a}
    PUBLIC.mkdir(parents=True, exist_ok=True)
    for n, a in arts.items():
        (PUBLIC / f"{n}.json").write_text(dumps(a) + "\n")
    tm["total"] = round(time.time() - t0, 1)
    (MANIFESTS / "runtime.json").write_text(json.dumps(tm, indent=1, sort_keys=True) + "\n")
    print("published", len(arts), "artifacts", tm["total"], "s")


if __name__ == "__main__":
    main()
