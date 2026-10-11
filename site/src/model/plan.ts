/**
 * A Plan is one solved (or infeasible) network state in the form every view draws: routes, open set, status, relaxation.
 * It is built from a published scenario, a sweep record, or a live HiGHS solve; the dock, the map and the ledgers read only this.
 */
import { r4 } from "./lp";
import type { Binding, Components, Model, Network, Params, Relaxation, RouteIn, RouteOut, Scenario, Sweep, SweepRecord } from "./types";

export type Source = "PRECOMPUTED" | "BROWSER";
export interface Plan {
  id: string; label: string; status: string; relaxed: boolean; objective: number | null;
  open: number[]; routesIn: RouteIn[]; routesOut: RouteOut[]; demandTons: number; params: Params;
  components: Components | null; relaxation: Relaxation | null;
  journeys: [number, number, number, number, number][]; hero: Scenario["hero"];
  haulIn: number | null; haulOut: number | null; costPerTon: number | null;
  source: Source; lpSha: string | null; ms: number | null;
}

export const isFeasible = (p: Plan) => p.status === "Optimal" || p.status === "Time limit reached";

export function demandTons(net: Network, params: Params): number {
  let s = 0;
  for (const n of net.demand_nodes) for (const t of n.demand_tons) s += r4(t * params.demand_scale);
  return s;
}
export const baseDemandTons = (net: Network) => net.demand_nodes.reduce((a, n) => a + n.demand_tons.reduce((x, y) => x + y, 0), 0);

export function hauls(net: Network, ro: RouteOut[], ri: RouteIn[]) {
  const oa = net.out_arcs;
  const ti = ri.reduce((a, r) => a + r[3], 0) || 1, to = ro.reduce((a, r) => a + r[2], 0) || 1;
  const hin = ri.reduce((a, [p, f, , t]) => a + t * net.in_road_mi[p]![f]!, 0) / ti;
  const hout = ro.reduce((a, [arc, , t]) => a + t * oa.road_mi[arc]!, 0) / to;
  return { haulIn: Math.round(hin * 1000) / 1000, haulOut: Math.round(hout * 1000) / 1000 };
}

/** DR-4: outbound tons of commodity k from site f are attributed to plants in proportion to f's inbound of k (3-decimal routes). */
export function journeys(net: Network, ro: RouteOut[], ri: RouteIn[]): [number, number, number, number, number][] {
  const oa = net.out_arcs;
  const inflow = new Map<string, [number, number][]>();
  for (const [p, f, k, t] of ri) { const key = `${f}|${k}`; (inflow.get(key) ?? inflow.set(key, []).get(key)!).push([p, t]); }
  const bySite = new Map<string, RouteOut[]>();
  for (const r of ro) { const key = `${oa.site[r[0]]!}|${r[1]}`; (bySite.get(key) ?? bySite.set(key, []).get(key)!).push(r); }
  const out: [number, number, number, number, number][] = [];
  for (let f = 0; f < net.sites.length; f++) for (let k = 0; k < 3; k++) {
    const ins = inflow.get(`${f}|${k}`);
    if (!ins) continue;
    const tot = ins.reduce((a, [, t]) => a + t, 0);
    for (const [a, , t] of bySite.get(`${f}|${k}`) ?? []) {
      for (const [p, ti] of [...ins].sort((x, y) => x[0] - y[0] || x[1] - y[1])) {
        // Python round(x, 3): the products here are not at .5 ties, so Math.round on the scaled value agrees (tested for every scenario)
        const v = Math.round((t * ti / tot) * 1000) / 1000;
        if (v >= 0.0005) out.push([p, f, oa.demand[a]!, k, v]);
      }
    }
  }
  return out;
}

export function hero(net: Network, jr: Plan["journeys"]): Plan["hero"] {
  const oa = net.out_arcs;
  const mi = new Map<string, number>();
  for (let a = 0; a < oa.site.length; a++) mi.set(`${oa.site[a]!}|${oa.demand[a]!}`, oa.road_mi[a]!);
  let best: Plan["hero"] = null;
  for (const [p, f, d, k, t] of jr) {
    if (k !== 0) continue;
    const a = net.in_road_mi[p]![f]!, b = mi.get(`${f}|${d}`)!;
    if (a >= 100 && b >= 100 && (best === null || t > best.tons || (t === best.tons && (p < best.plant || (p === best.plant && (f < best.site || (f === best.site && d < best.node))))))) {
      best = { plant: p, site: f, node: d, commodity: 0, tons: t, in_mi: a, out_mi: b };
    }
  }
  return best;
}

export function planFromScenario(net: Network, s: Scenario): Plan {
  const h = s.status === "Optimal" ? hauls(net, s.routes_out, s.routes_in) : { haulIn: null, haulOut: null };
  const ft = s.routes_in.reduce((a, r) => a + r[3], 0);
  return {
    id: s.id, label: s.label, status: s.status, relaxed: s.params.relax, objective: s.objective_usd, open: s.open_sites,
    routesIn: s.routes_in, routesOut: s.routes_out, demandTons: s.total_demand_tons, params: s.params,
    components: s.components, relaxation: s.relaxation, journeys: s.journeys, hero: s.hero,
    haulIn: h.haulIn, haulOut: h.haulOut, costPerTon: s.objective_usd && ft ? Math.round((s.objective_usd / s.total_demand_tons) * 1e4) / 1e4 : null,
    source: "PRECOMPUTED", lpSha: s.lp_text_sha256, ms: null,
  };
}

export function planFromSweep(net: Network, rec: SweepRecord, relaxed: boolean): Plan {
  const r = relaxed && rec.relaxed ? rec.relaxed : null;
  const ro = r ? r.routes_out : rec.routes_out, ri = r ? r.routes_in : rec.routes_in;
  const feasible = !!r || rec.status === "Optimal";
  const jr = feasible ? journeys(net, ro, ri) : [];
  return {
    id: `sweep:${rec.params.open_exactly ? "exactly" : "limit"}:${rec.k}`, label: `K = ${rec.k}`, status: r ? "Optimal" : rec.status, relaxed: !!r,
    objective: r ? r.objective_usd : rec.objective_usd, open: r ? r.open_sites : rec.open_sites, routesIn: ri, routesOut: ro,
    demandTons: demandTons(net, rec.params), params: r ? r.params : rec.params, components: r ? r.components : rec.components,
    relaxation: r ? r.relaxation : null, journeys: jr, hero: feasible ? hero(net, jr) : null,
    haulIn: r ? r.haul_in_mi : rec.haul_in_mi, haulOut: r ? r.haul_out_mi : rec.haul_out_mi, costPerTon: r ? r.cost_per_ton_usd : rec.cost_per_ton_usd,
    source: "PRECOMPUTED", lpSha: r ? r.lp_text_sha256 : rec.lp_text_sha256, ms: null,
  };
}
export const sweepRecord = (sw: Sweep, series: "limit" | "exactly", k: number) => sw.series.find((s) => s.id === series)!.records.find((r) => r.k === k)!;

// ------------------------------------------------------------------ live solve decode
export interface Solved { status: string; objective: number | null; columns: Record<string, number>; ms: number }
const R3 = (x: number) => Math.round(x * 1000) / 1000;

export function planFromSolve(net: Network, model: Model, params: Params, s: Solved, lpSha: string | null, label = "YOUR SOLVE"): Plan {
  const ok = (s.status === "Optimal" || s.status === "Time limit reached") && s.objective !== null && Number.isFinite(s.objective);
  const base: Plan = {
    id: "live", label, status: s.status, relaxed: params.relax, objective: ok ? s.objective : null, open: [], routesIn: [], routesOut: [],
    demandTons: demandTons(net, params), params, components: null, relaxation: null, journeys: [], hero: null,
    haulIn: null, haulOut: null, costPerTon: null, source: "BROWSER", lpSha, ms: s.ms,
  };
  if (!ok) return base;
  const x = s.columns;
  const ro: RouteOut[] = [], ri: RouteIn[] = [];
  const unmet: Relaxation["unmet_demand"] = [], cap: Relaxation["capacity_overshoot"] = [], sup: Relaxation["supply_overshoot"] = [];
  let sm = 0;
  const open: number[] = [];
  const capScaled = net.sites.map((st) => r4(st.capacity_units * params.capacity_scale));
  for (const [name, v] of Object.entries(x)) {
    let m: RegExpExecArray | null;
    if ((m = /^x(\d+)_(\d+)$/.exec(name))) { if (v >= 0.0005) ro.push([Number(m[1]), Number(m[2]), R3(v)]); }
    else if ((m = /^y(\d+)_(\d+)_(\d+)$/.exec(name))) { if (v >= 0.0005) ri.push([Number(m[1]), Number(m[2]), Number(m[3]), R3(v)]); }
    else if ((m = /^z(\d+)$/.exec(name))) { if (Math.round(v) === 1) open.push(Number(m[1])); }
    else if ((m = /^u(\d+)_(\d+)$/.exec(name))) { if (v > 5e-4) unmet.push({ demand: Number(m[1]), commodity: Number(m[2]), tons: R3(v) }); }
    else if ((m = /^so(\d+)$/.exec(name))) { const f = Number(m[1]); if (v > 5e-4) cap.push({ site: f, units: R3(v), pct_of_capacity: capScaled[f]! > 0 ? Math.round(10000 * v / capScaled[f]!) / 100 : 0 }); }
    else if ((m = /^sp(\d+)_(\d+)$/.exec(name))) { if (v > 5e-4) sup.push({ plant: Number(m[1]), commodity: Number(m[2]), tons: R3(v) }); }
    else if (name === "sm") sm = v > 5e-4 ? R3(v) : 0;
  }
  ro.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  ri.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  open.sort((a, b) => a - b);
  unmet.sort((a, b) => a.demand - b.demand || a.commodity - b.commodity);
  cap.sort((a, b) => a.site - b.site);
  sup.sort((a, b) => a.plant - b.plant || a.commodity - b.commodity);
  const comp = components(net, model, params, x);
  const h = hauls(net, ro, ri);
  const jr = journeys(net, ro, ri);
  let relaxation: Relaxation | null = null;
  if (params.relax) {
    const rep = { unmet_demand: unmet, capacity_overshoot: cap, supply_overshoot: sup, open_sites_excess: sm, total_penalty_usd: Object.values(comp.penalties_usd).reduce((a, b) => a + b, 0), summary: "", words: [] as string[] };
    rep.words = words(rep, net, baseDemandTons(net), params.max_open_sites);
    relaxation = rep;
  }
  const total = base.demandTons;
  return { ...base, open, routesIn: ri, routesOut: ro, components: comp, relaxation, journeys: jr, hero: hero(net, jr), haulIn: h.haulIn, haulOut: h.haulOut, costPerTon: total ? s.objective! / total : null };
}

/** milp.py::breakdown: objective components recomputed from the solution with the same rounded coefficients. */
export function components(net: Network, model: Model, params: Params, x: Record<string, number>): Components {
  const cm = net.commodities, oa = net.out_arcs;
  const val = (n: string) => x[n] ?? 0;
  let fixed = 0, tout = 0, hand = 0, tin = 0;
  net.sites.forEach((s, f) => { fixed += r4(s.fixed_cost_usd_yr * params.fixed_cost_scale) * Math.round(val(`z${f}`)); });
  for (let a = 0; a < oa.site.length; a++) for (let k = 0; k < cm.length; k++) {
    const v = val(`x${a}_${k}`);
    if (!v) continue;
    tout += r4(cm[k]!.rate_out_usd_ton_mi * oa.road_mi[a]! * params.freight_scale) * v;
    hand += r4(cm[k]!.handling_usd_ton) * v;
  }
  for (let p = 0; p < net.plants.length; p++) for (let f = 0; f < net.sites.length; f++) for (let k = 0; k < cm.length; k++) {
    const v = val(`y${p}_${f}_${k}`);
    if (v) tin += r4(cm[k]!.rate_in_usd_ton_mi * net.in_road_mi[p]![f]! * params.freight_scale) * v;
  }
  const pen = { unmet_demand: 0, capacity_overshoot: 0, supply_overshoot: 0, open_sites_excess: 0 };
  if (params.relax) {
    const P = model.penalties;
    for (const [n, v] of Object.entries(x)) {
      if (n.startsWith("u")) pen.unmet_demand += P.unmet_usd_ton * v;
      else if (n.startsWith("so")) pen.capacity_overshoot += P.capacity_usd_unit * v;
      else if (n.startsWith("sp")) pen.supply_overshoot += P.supply_usd_ton * v;
      else if (n === "sm") pen.open_sites_excess += P.open_sites_usd_site * v;
    }
  }
  return { fixed_usd: fixed, inbound_transport_usd: tin, outbound_transport_usd: tout, handling_usd: hand, penalties_usd: pen };
}

// ------------------------------------------------------------------ DR-8 words (analytics/words.py)
const n0 = (x: number) => Math.floor(x + 0.5).toLocaleString("en-US");
export const WORD_TEMPLATES: Record<string, string> = {
  supply: "THE PLANTS WOULD HAVE TO MAKE {total} T MORE THAN THEY CAN ({pct}% OF DEMAND): {list}.",
  capacity: "{count} {sites_word} WOULD HAVE TO HANDLE {units} UNITS MORE THAN THEY CAN; WORST: {worst} BY {worst_pct}%.",
  unmet: "{tons} T OF DEMAND WOULD GO UNSERVED AT {count} {cities_word}; WORST: {worst} {worst_tons} T.",
  open_sites: "{n} {sites_word} MORE THAN THE LIMIT OF {limit} WOULD HAVE TO OPEN.",
};
export function wordFamilies(rel: Pick<Relaxation, "supply_overshoot" | "capacity_overshoot" | "unmet_demand" | "open_sites_excess">, net: Network, baseDemand: number, limit: number): [string, Record<string, string>][] {
  const out: [string, Record<string, string>][] = [];
  const nm = (g: { short_name: string }) => g.short_name.toUpperCase();
  const sup = new Map<number, number>();
  for (const r of rel.supply_overshoot) sup.set(r.plant, (sup.get(r.plant) ?? 0) + r.tons);
  for (const [p, t] of [...sup]) if (Math.floor(t + 0.5) <= 0) sup.delete(p);
  if (sup.size) {
    const total = [...sup.values()].reduce((a, b) => a + b, 0);
    const order = [...sup.keys()].sort((a, b) => sup.get(b)! - sup.get(a)! || a - b);
    out.push(["supply", { total: n0(total), pct: n0(100 * total / baseDemand), list: order.map((p) => `${nm(net.plants[p]!)} ${n0(sup.get(p)!)} T`).join(", ") }]);
  }
  const cap = rel.capacity_overshoot;
  if (cap.length) {
    const w = [...cap].sort((a, b) => b.pct_of_capacity - a.pct_of_capacity || a.site - b.site)[0]!;
    out.push(["capacity", { count: String(cap.length), sites_word: cap.length === 1 ? "SITE" : "SITES", units: n0(cap.reduce((a, r) => a + r.units, 0)), worst: nm(net.sites[w.site]!), worst_pct: n0(w.pct_of_capacity) }]);
  }
  const um = new Map<number, number>();
  for (const r of rel.unmet_demand) um.set(r.demand, (um.get(r.demand) ?? 0) + r.tons);
  if (um.size) {
    const w = [...um.keys()].sort((a, b) => um.get(b)! - um.get(a)! || a - b)[0]!;
    out.push(["unmet", { tons: n0([...um.values()].reduce((a, b) => a + b, 0)), count: String(um.size), cities_word: um.size === 1 ? "CITY" : "CITIES", worst: nm(net.demand_nodes[w]!), worst_tons: n0(um.get(w)!) }]);
  }
  if (rel.open_sites_excess > 0.0005) {
    const n = Math.floor(rel.open_sites_excess + 0.5);
    out.push(["open_sites", { n: String(n), sites_word: n === 1 ? "SITE" : "SITES", limit: String(limit) }]);
  }
  return out;
}
export const renderWord = (family: string, fields: Record<string, string>, templates: Record<string, string> = WORD_TEMPLATES) =>
  templates[family]!.replace(/\{(\w+)\}/g, (_, k: string) => fields[k] ?? "");
export const words = (rel: Parameters<typeof wordFamilies>[0], net: Network, baseDemand: number, limit: number, templates?: Record<string, string>) =>
  wordFamilies(rel, net, baseDemand, limit).map(([f, v]) => renderWord(f, v, templates));

// ------------------------------------------------------------------ per-site facts
export function siteUnits(net: Network, ro: RouteOut[]) {
  const u = new Array<number>(net.sites.length).fill(0);
  for (const [a, k, t] of ro) { const f = net.out_arcs.site[a]!; u[f] = u[f]! + net.commodities[k]!.capacity_units_per_ton * t; }
  return u;
}

/** Binding rows read from the primal (a full site, a drained plant, the site limit); shadow prices only where `duals` is given. */
export function bindingFromPlan(net: Network, plan: Plan, duals: Record<string, number> | null): Binding[] {
  const out: Binding[] = [];
  const u = siteUnits(net, plan.routesOut);
  for (const f of plan.open) {
    const cap = r4(net.sites[f]!.capacity_units * plan.params.capacity_scale);
    const slack = cap - u[f]!;
    if (cap > 0 && slack <= 1e-6 * Math.max(1, cap)) out.push({ group: "capacity", id: net.sites[f]!.id, slack: Math.max(slack, 0), shadow_usd_per_unit: duals ? -(duals[`cap${f}`] ?? 0) : null, unit: "throughput unit" });
  }
  const used = new Map<string, number>();
  for (const [p, , k, t] of plan.routesIn) used.set(`${p}|${k}`, (used.get(`${p}|${k}`) ?? 0) + t);
  net.plants.forEach((pl, p) => net.commodities.forEach((c, k) => {
    const s = pl.supply_tons[k]!;
    const slack = s - (used.get(`${p}|${k}`) ?? 0);
    if (slack <= 1e-6 * Math.max(1, s)) out.push({ group: "plant_supply", id: `${pl.id}/${c.id}`, slack: Math.max(slack, 0), shadow_usd_per_unit: duals ? -(duals[`sup${p}_${k}`] ?? 0) : null, unit: "ton" });
  }));
  if (plan.open.length >= plan.params.max_open_sites) out.push({ group: "open_sites", id: "max_open_sites", slack: 0, shadow_usd_per_unit: null, unit: "site" });
  return out;
}
