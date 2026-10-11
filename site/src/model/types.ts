/** Published artifact shapes (docs/DATA_CONTRACTS.md). Guards are the trust boundary: they check the fields the site reads. */
export interface Commodity { id: string; label: string; capacity_units_per_ton: number; handling_usd_ton: number; rate_in_usd_ton_mi: number; rate_out_usd_ton_mi: number; tons_per_1000_pop: number }
export interface Place { id: string; name: string; short_name: string; state: string; lat: number; lon: number; x: number; y: number; pop2025: number }
export interface DemandNode extends Place { geoid: string; demand_tons: number[] }
export interface Site extends Place { geoid: string; capacity_units: number; fixed_cost_usd_yr: number; land_index: number }
export interface Plant extends Place { geoid: string; supply_tons: number[] }
export interface Network {
  commodities: Commodity[]; demand_nodes: DemandNode[]; sites: Site[]; plants: Plant[];
  out_arcs: { demand: number[]; site: number[]; road_mi: number[] };
  in_road_mi: number[][];
  constants: Record<string, number | number[]>;
  projection: { name: string; parallels: [number, number]; origin: [number, number]; earth_radius: number };
}
export interface Params {
  capacity_scale: number; closed_lanes: number[]; closed_sites: number[]; demand_scale: number; fixed_cost_scale: number;
  fixed_open: number[] | null; freight_scale: number; max_open_sites: number; open_exactly: boolean; relax: boolean;
}
export interface Control {
  id: string; kind: "range" | "multiselect" | "toggle"; label: string; unit: string; default: number | boolean | number[];
  min: number | null; max: number | null; step: number | null; options: string[] | null; param_path: string;
}
export interface Preset { id: string; kind: string; label: string; description: string; params: Params }
export interface WordsExample { family: string; fields: Record<string, string>; scenario: string; sentence: string }
export interface Model {
  controls: Control[]; defaults: Params; presets: Preset[];
  penalties: { capacity_usd_unit: number; open_sites_usd_site: number; supply_usd_ton: number; unmet_usd_ton: number; note: string };
  relaxation_words: { examples: WordsExample[]; order: string[]; rules: string[]; templates: Record<string, string> };
  solver: {
    options: Record<string, number | boolean>;
    browser: { extra_status_strings: string[]; time_limit_rule: string; time_limit_s: number; warmup_preset: string };
    highs_browser: string; highs_python: string; status_strings: { infeasible: string; optimal: string };
  };
  sizes: { binaries: number; columns: number; nonzeros: number; rows: number };
  formulation: { summary: string };
}
export interface Components {
  fixed_usd: number; handling_usd: number; inbound_transport_usd: number; outbound_transport_usd: number;
  penalties_usd: { capacity_overshoot: number; open_sites_excess: number; supply_overshoot: number; unmet_demand: number };
}
export interface Relaxation {
  capacity_overshoot: { site: number; units: number; pct_of_capacity: number }[];
  open_sites_excess: number;
  supply_overshoot: { commodity: number; plant: number; tons: number }[];
  unmet_demand: { commodity: number; demand: number; tons: number }[];
  summary: string; total_penalty_usd: number; words: string[];
}
export interface FdCheck { delta: number; open_set_changed: boolean; pct: number; predicted_saving_usd: number; solved_saving_usd: number }
export interface Binding { group: string; id: string; shadow_usd_per_unit: number | null; slack: number; unit: string; fd_check?: FdCheck[] | null }
export type RouteOut = [number, number, number];
export type RouteIn = [number, number, number, number];
export interface Scenario {
  id: string; kind: string; label: string; description: string; status: string; params: Params;
  objective_usd: number | null; components: Components | null; open_sites: number[];
  routes_in: RouteIn[]; routes_out: RouteOut[]; journeys: [number, number, number, number, number][];
  hero: { plant: number; site: number; node: number; commodity: number; tons: number; in_mi: number; out_mi: number } | null;
  binding: Binding[]; relaxation: Relaxation | null; lp_text_sha256: string; lp_relaxation_bound_usd: number | null;
  mip_gap: number | null; mip_nodes: number | null; service_level: number | null; unmet_tons: number | null; total_demand_tons: number;
  site_use: { site: number; units: number; capacity_units: number; utilization: number }[];
  demand_price_usd_ton: number[][] | null;
}
export interface Solutions { scenarios: Scenario[]; duals_note: string; flow_precision: string; journeys_note: string; tags: Record<string, string> }
export interface SweepRecord {
  k: number; status: string; objective_usd: number | null; components: Components | null; open_sites: number[];
  routes_in: RouteIn[]; routes_out: RouteOut[]; lp_text_sha256: string; params: Params;
  haul_in_mi: number | null; haul_out_mi: number | null; cost_per_ton_usd: number | null;
  relaxed: null | { objective_usd: number; components: Components; open_sites: number[]; routes_in: RouteIn[]; routes_out: RouteOut[]; relaxation: Relaxation; haul_in_mi: number; haul_out_mi: number; cost_per_ton_usd: number; params: Params; lp_text_sha256: string };
}
export interface Sweep { series: { id: string; label: string; records: SweepRecord[] }[]; note: string }
export interface McStats { cvar95: number; max: number; mean: number; min: number; p05: number; p50: number; p95: number; p99: number; sd: number }
export interface Robustness {
  config: { draws: number; seed: number; note: string; lost_sales_usd_ton: number } & Record<string, number | string>;
  designs: { id: string; label: string; open_sites: number[]; undisrupted_cost_usd: number; undisrupted_service_level: number }[];
  draws: { demand_multiplier: number[]; demand_tons: number[]; epicentre: (number | null)[]; failed_sites: number[][]; lanes_down: number[]; regional_event: number[]; sites_down: number[] };
  results: Record<"legacy" | "optimized", { adjusted_cost_usd: number[]; cost_usd: number[]; delivered_by_site: number[][]; service_level: number[]; unmet_tons: number[] }>;
  site_criticality: { delivered_by_site: number[]; delta_cost_usd: number; service_level: number; site: number; unmet_tons: number }[];
  storm_exemplar: { closed_sites: number[]; epicenter: string; radius_mi: number };
  summary: Record<"legacy" | "optimized", { adjusted_cost: McStats; cost: McStats; service_level: McStats; share_full_service: number; mean_regret_vs_undisrupted_usd: number }>;
}
export interface Fact { id: string; label: string; value: number | string; tag: string; unit?: string; source?: string }
export interface Facts { facts: Fact[]; demand_price_bins: { commodities: { id: string; edges: number[] }[]; tag: string; unit: string } }
export interface Meta {
  attribution: string; licence_note: string; limitations: string[]; seed: number; tagline: string; project: string;
  sources: { id: string; name: string; tag: string; url: string; vintage: string; retrieved_at_utc: string; use: string; bytes: number; sha256: string }[];
  sizes: Record<string, number>;
}
export interface Quality {
  join_ledger: Record<string, number | Record<string, number>>;
  selection: { demand_nodes: number; demand_population: number; share_of_usable_population: number; internal_point_note: string; excluded_states: string[] };
  checks: { id: string; description: string; result: string }[];
}

const obj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): v is unknown[] => Array.isArray(v);
export const isNetwork = (v: unknown): v is Network => obj(v) && arr(v.demand_nodes) && arr(v.sites) && arr(v.plants) && arr(v.commodities) && obj(v.out_arcs) && arr(v.in_road_mi) && obj(v.projection);
export const isModel = (v: unknown): v is Model => obj(v) && arr(v.controls) && arr(v.presets) && obj(v.penalties) && obj(v.defaults) && obj(v.solver) && obj(v.relaxation_words);
export const isSolutions = (v: unknown): v is Solutions => obj(v) && arr(v.scenarios) && v.scenarios.length > 0 && typeof v.duals_note === "string";
export const isSweep = (v: unknown): v is Sweep => obj(v) && arr(v.series) && v.series.length === 2;
export const isRobustness = (v: unknown): v is Robustness => obj(v) && obj(v.draws) && obj(v.results) && arr(v.designs) && obj(v.summary) && arr(v.site_criticality);
export const isFacts = (v: unknown): v is Facts => obj(v) && arr(v.facts) && obj(v.demand_price_bins);
export const isMeta = (v: unknown): v is Meta => obj(v) && typeof v.attribution === "string" && arr(v.limitations) && typeof v.licence_note === "string";
export const isQuality = (v: unknown): v is Quality => obj(v) && obj(v.join_ledger) && obj(v.selection);
