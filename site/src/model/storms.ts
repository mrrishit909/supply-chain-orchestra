/** S06: per-draw plans from the seeded Monte Carlo (DR-6). Per-draw flows per city are not published, so a draw's disc
 * pools its served tons by site (one bar per surviving site) and shows unmet tons as the UNSERVED slot. */
import type { Plan } from "./plan";
import type { Network, Params, Robustness } from "./types";

export type Design = "legacy" | "optimized";
const cache = new WeakMap<Robustness, Map<string, Plan>>();
const PARAMS = { capacity_scale: 1, closed_lanes: [], closed_sites: [], demand_scale: 1, fixed_cost_scale: 1, fixed_open: null, freight_scale: 1, max_open_sites: 14, open_exactly: false, relax: false } as Params;

function pooled(net: Network, id: string, label: string, open: number[], delivered: number[], unmet: number, demandTons: number): Plan {
  const firstArc = (f: number) => net.out_arcs.site.findIndex((s) => s === f);
  const ro: Plan["routesOut"] = [], ri: Plan["routesIn"] = [];
  open.forEach((f, j) => {
    const t = Math.round((delivered[j] ?? 0) * 10) / 10;
    if (t > 0) { ro.push([firstArc(f), 0, t]); ri.push([0, f, 0, t]); }
  });
  return {
    id, label, status: "Optimal", relaxed: unmet > 0, objective: null, open: open.filter((_, j) => (delivered[j] ?? 0) > 0), routesIn: ri, routesOut: ro, demandTons,
    params: PARAMS, components: null,
    relaxation: unmet > 0 ? { capacity_overshoot: [], open_sites_excess: 0, supply_overshoot: [], unmet_demand: [{ demand: 0, commodity: 0, tons: unmet }], summary: "", total_penalty_usd: 0, words: [] } : null,
    journeys: [], hero: null, haulIn: null, haulOut: null, costPerTon: null, source: "PRECOMPUTED", lpSha: null, ms: null,
  };
}

export function drawPlan(net: Network, rb: Robustness, design: Design, idx: number): Plan {
  let m = cache.get(rb);
  if (!m) { m = new Map(); cache.set(rb, m); }
  const key = `${design}|${idx}`;
  let p = m.get(key);
  if (!p) {
    const d = rb.designs.find((x) => x.id === design)!;
    const r = rb.results[design];
    p = pooled(net, `mc|${design}|${idx}`, `${design} draw ${idx + 1}`, d.open_sites, r.delivered_by_site[idx]!, r.unmet_tons[idx]!, rb.draws.demand_tons[idx]!);
    m.set(key, p);
  }
  return p;
}
export function lostPlan(net: Network, rb: Robustness, site: number): Plan | null {
  const c = rb.site_criticality.find((x) => x.site === site);
  if (!c) return null;
  const d = rb.designs.find((x) => x.id === "optimized")!;
  const base = d.open_sites.length ? rb.draws.demand_tons.length && net.demand_nodes.reduce((a, n) => a + n.demand_tons.reduce((x, y) => x + y, 0), 0) : 0;
  return pooled(net, `mc|lost|${site}`, `optimized without ${net.sites[site]!.short_name}`, d.open_sites, c.delivered_by_site, c.unmet_tons, base || 1);
}
/** Draw indices in the order the scrub visits them. */
export function drawOrder(rb: Robustness, order: "legacy_cost" | "index"): number[] {
  const n = rb.draws.demand_tons.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  if (order === "legacy_cost") idx.sort((a, b) => rb.results.legacy.adjusted_cost_usd[a]! - rb.results.legacy.adjusted_cost_usd[b]! || a - b);
  return idx;
}
/** Full service = service level of at least 0.9999 (the rule behind the published share_full_service). */
export const fullService = (rb: Robustness, design: Design, i: number) => rb.results[design].service_level[i]! >= 0.9999;
export function tallies(rb: Robustness, order: number[], upto: number) {
  let a = 0, b = 0;
  for (let k = 0; k <= upto && k < order.length; k++) { if (fullService(rb, "legacy", order[k]!)) a++; if (fullService(rb, "optimized", order[k]!)) b++; }
  return { legacy: a, optimized: b };
}
/** The 25 highest adjusted-cost draws per design (the CVaR95 tail of 500). */
export function tail(rb: Robustness, design: Design): number[] {
  const n = rb.draws.demand_tons.length;
  const k = Math.round(n * 0.05);
  return Array.from({ length: n }, (_, i) => i).sort((a, b) => rb.results[design].adjusted_cost_usd[b]! - rb.results[design].adjusted_cost_usd[a]! || a - b).slice(0, k);
}
