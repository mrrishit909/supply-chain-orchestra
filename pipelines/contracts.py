"""JSON Schemas (draft 2020-12) for every published artifact, generated into data/contracts/*.schema.json.

    uv run python -m pipelines.contracts
"""
from __future__ import annotations

import json

from pipelines.common import CONTRACTS

TAG = {"type": "string", "pattern": "^(OBSERVED|DERIVED|PREDICTED|SIMULATED|SYNTHETIC)(/(OBSERVED|DERIVED|PREDICTED|SIMULATED|SYNTHETIC))*$"}
S, I, N, B = {"type": "string"}, {"type": "integer"}, {"type": "number"}, {"type": "boolean"}
NN = {"type": ["number", "null"]}


def obj(props: dict, required: list[str] | None = None, extra: bool = False) -> dict:
    return {"type": "object", "properties": props, "required": list(props) if required is None else required, "additionalProperties": extra}


def arr(item: dict, lo: int | None = None, hi: int | None = None) -> dict:
    a: dict = {"type": "array", "items": item}
    if lo is not None:
        a["minItems"] = lo
    if hi is not None:
        a["maxItems"] = hi
    return a


def top(title: str, props: dict, required: list[str] | None = None) -> dict:
    p = {"schema_version": {"const": "v1"}, "generated_at": S, "tags": {"type": "object", "additionalProperties": TAG, "minProperties": 1}, **props}
    r = ["schema_version", "generated_at", "tags"] + (list(props) if required is None else required)
    return {"$schema": "https://json-schema.org/draft/2020-12/schema", "title": title, "type": "object", "properties": p, "required": r, "additionalProperties": False}


PARAMS = obj({"demand_scale": N, "freight_scale": N, "fixed_cost_scale": N, "capacity_scale": N, "max_open_sites": I,
              "closed_sites": arr(I), "closed_lanes": arr(I), "fixed_open": {"type": ["array", "null"], "items": I}, "relax": B})
COMPONENTS = obj({"fixed_usd": N, "inbound_transport_usd": N, "outbound_transport_usd": N, "handling_usd": N,
                  "penalties_usd": obj({"unmet_demand": N, "capacity_overshoot": N, "supply_overshoot": N, "open_sites_excess": N})})
STATUS = {"enum": ["Optimal", "Infeasible"]}
SUMMARY = obj({"mean": N, "sd": N, "p05": N, "p50": N, "p95": N, "p99": N, "cvar95": N, "min": N, "max": N})


def schemas() -> dict[str, dict]:
    out: dict[str, dict] = {}
    out["meta"] = top("Meta", {
        "project": S, "tagline": S, "seed": I,
        "sources": arr(obj({"id": S, "name": S, "url": S, "vintage": S, "retrieved_at_utc": S, "sha256": S, "bytes": I, "use": S, "tag": TAG})),
        "attribution": S, "licence_note": S, "limitations": arr(S, 1),
        "sizes": obj({"demand_nodes": I, "candidate_sites": I, "plants": I, "commodities": I, "out_arcs": I, "columns": I, "rows": I, "binaries": I}),
        "artifacts": obj({"files": arr(S, 1)}),
    })
    out["quality"] = top("Quality", {
        "join_ledger": obj({"gazetteer_rows": I, "pep_rows_all_sumlev": I, "pep_sumlev162_rows": I, "pep_geoid_unique": I, "pep_unmatched_to_gazetteer": I,
                            "gazetteer_unmatched_to_pep": I, "gazetteer_unmatched_by_funcstat": {"type": "object", "additionalProperties": I}, "joined": I,
                            "dropped_not_active_either_file": I, "active_joined": I, "dropped_non_contiguous": I, "dropped_zero_pop": I, "usable_places": I, "usable_population_sum": I}),
        "selection": obj({"demand_nodes": I, "demand_population": I, "share_of_usable_population": N, "excluded_states": arr(S), "internal_point_note": S}),
        "checks": arr(obj({"id": S, "description": S, "result": {"enum": ["PASS", "FAIL"]}, "value": {"type": ["number", "string", "boolean"]}}), 1),
    })
    place = {"id": S, "geoid": S, "name": S, "state": S, "lat": N, "lon": N, "pop2025": I}
    out["network"] = top("Network", {
        "units": obj({"distance": S, "demand": S, "capacity": S, "cost": S, "population": S}),
        "commodities": arr(obj({"id": S, "label": S, "tons_per_1000_pop": N, "rate_in_usd_ton_mi": N, "rate_out_usd_ton_mi": N, "handling_usd_ton": N, "capacity_units_per_ton": N}), 3, 3),
        "demand_nodes": arr(obj({**place, "demand_tons": arr(I, 3, 3)})),
        "sites": arr(obj({**place, "land_index": N, "fixed_cost_usd_yr": N, "capacity_units": I})),
        "plants": arr(obj({**place, "supply_tons": arr(I, 3, 3)})),
        "out_arcs": obj({"site": arr(I), "demand": arr(I), "road_mi": arr(N)}),
        "in_road_mi": arr(arr(N)),
        "constants": obj({"circuity": N, "earth_radius_mi": N, "nearest_sites_per_demand_node": I, "seed": I, "noise_sd": N, "capacity_headroom": N, "supply_headroom": N,
                          "plant_shares": arr(N), "fixed_base_usd_yr": N, "site_pool": I, "plant_pool": I}),
    })
    out["model"] = top("Model", {
        "formulation": obj({"summary": S, "objective": S, "variables": arr(S), "constraints": arr(S), "relaxation": arr(S)}),
        "lp_format": obj({"rounding_rule": S, "number_format": S, "column_order": arr(S), "row_order": arr(S), "names": S, "sections": S, "note": S}),
        "solver": obj({"options": {"type": "object"}, "highs_python": S, "highs_browser": S, "status_strings": obj({"optimal": S, "infeasible": S}), "browser_note": S}),
        "penalties": obj({"unmet_usd_ton": N, "capacity_usd_unit": N, "supply_usd_ton": N, "open_sites_usd_site": N, "note": S}),
        "defaults": PARAMS,
        "controls": arr(obj({"id": S, "label": S, "unit": S, "kind": {"enum": ["range", "toggle", "multiselect"]}, "min": NN, "max": NN, "step": NN, "default": {}, "param_path": S,
                             "options": {"type": ["array", "null"]}}, ["id", "label", "unit", "kind", "default", "param_path"]), 1),
        "presets": arr(obj({"id": S, "label": S, "description": S, "kind": {"enum": ["design", "stress", "infeasible", "relaxed"]}, "params": PARAMS}), 1),
        "sizes": obj({"columns": I, "rows": I, "binaries": I, "nonzeros": I}),
    })
    route_out = arr({"type": "array", "items": N, "minItems": 3, "maxItems": 3})  # [arc index, commodity, tons]
    route_in = arr({"type": "array", "items": N, "minItems": 4, "maxItems": 4})   # [plant, site, commodity, tons]
    relax = obj({"total_penalty_usd": N, "unmet_demand": arr(obj({"demand": I, "commodity": I, "tons": N})), "capacity_overshoot": arr(obj({"site": I, "units": N, "pct_of_capacity": N})),
                 "supply_overshoot": arr(obj({"plant": I, "commodity": I, "tons": N})), "open_sites_excess": N, "summary": S})
    scen = obj({
        "id": S, "label": S, "description": S, "kind": S, "params": PARAMS, "status": STATUS, "objective_usd": NN, "lp_text_sha256": S, "components": {"anyOf": [COMPONENTS, {"type": "null"}]},
        "open_sites": arr(I), "mip_gap": NN, "mip_nodes": {"type": ["integer", "null"]}, "lp_relaxation_bound_usd": NN, "service_level": NN, "unmet_tons": NN, "total_demand_tons": N,
        "routes_out": route_out, "routes_in": route_in,
        "site_use": arr(obj({"site": I, "units": N, "capacity_units": N, "utilization": N})),
        "demand_price_usd_ton": {"type": ["array", "null"], "items": arr(N, 3, 3)},
        "binding": arr(obj({"group": {"enum": ["capacity", "plant_supply", "open_sites"]}, "id": S, "slack": N, "shadow_usd_per_unit": NN, "unit": S})),
        "relaxation": {"anyOf": [relax, {"type": "null"}]},
    })
    out["solutions"] = top("Solutions", {"flow_precision": S, "duals_note": S, "scenarios": arr(scen, 1)})
    hist = obj({"edges": arr(N), "counts": arr(I)})
    des = lambda extra=None: obj({"cost_usd": arr(N), "service_level": arr(N), "adjusted_cost_usd": arr(N), **(extra or {})})
    out["robustness"] = top("Robustness", {
        "config": obj({"draws": I, "seed": I, "p_site_outage": N, "p_regional_event": N, "regional_radius_mi": N, "p_site_in_region": N, "p_lane_outage": N,
                       "demand_global_sd": N, "demand_commodity_sd": N, "demand_node_sd": N, "regional_surge": N, "surge_radius_mi": N, "lost_sales_usd_ton": N, "note": S}),
        "designs": arr(obj({"id": S, "label": S, "open_sites": arr(I), "undisrupted_cost_usd": N, "undisrupted_service_level": N}), 2, 3),
        "draws": obj({"sites_down": arr(I), "lanes_down": arr(I), "regional_event": arr(I), "demand_multiplier": arr(N)}),
        "results": {"type": "object", "additionalProperties": des()},
        "summary": {"type": "object", "additionalProperties": obj({"cost": SUMMARY, "service_level": SUMMARY, "adjusted_cost": SUMMARY, "share_full_service": N, "mean_regret_vs_undisrupted_usd": N})},
        "histograms": {"type": "object", "additionalProperties": obj({"cost": hist, "service_level": hist})},
        "site_criticality": arr(obj({"site": I, "delta_cost_usd": N, "service_level": N, "unmet_tons": N})),
        "storm_exemplar": obj({"epicenter": S, "radius_mi": N, "closed_sites": arr(I)}),
    })
    vec = obj({
        "id": S, "kind": {"enum": ["preset", "random", "infeasible", "relaxed", "closure"]}, "params": PARAMS, "lp_text_sha256": S,
        "expected": obj({"status": STATUS, "objective_usd": NN, "components": {"anyOf": [COMPONENTS, {"type": "null"}]}, "open_sites": arr(I), "unmet_tons": NN, "relaxed_groups": arr(S)}),
    })
    out["solver_test_vectors"] = top("Solver test vectors", {
        "note": S, "parity_keys": arr(S, 3), "tolerance_rel": N, "tolerance_abs_usd": N, "solver_options": {"type": "object"},
        "lp_text": S, "lp_text_vector_id": S, "vectors": arr(vec, 1),
    })
    out["facts"] = top("Facts", {"facts": arr(obj({"id": S, "label": S, "value": {"type": ["number", "string"]}, "unit": S, "tag": TAG, "source": S}), 1)})
    return out


def main() -> None:
    CONTRACTS.mkdir(parents=True, exist_ok=True)
    for name, sch in schemas().items():
        (CONTRACTS / f"{name}.schema.json").write_text(json.dumps(sch, indent=1, sort_keys=True) + "\n")
        print("wrote", name)


if __name__ == "__main__":
    main()
