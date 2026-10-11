/**
 * The Cross-Dock layout (VISUAL_DESIGN section 0, MOTION_SYSTEM 4): one disc cut by a dock line. Above the dock, one
 * bar per (plant, commodity) inbound route; below, one bar per (city, commodity) outbound route, in columns by site
 * longitude. A bar's slot [x0, x1] (unit disc, -1..1) carries its tons as exact area: tons = (A(x1) - A(x0)) * 2T / pi.
 *
 * Every plan is placed on the same canonical key order (all 14 sites by longitude, then plant or city by longitude,
 * then commodity), with absent keys at zero width. Two placements over one union of keys therefore blend slot edge by
 * slot edge and stay gapless, and bars that appear or vanish grow or shrink in place (MOTION_SYSTEM 4).
 */
import type { Plan } from "../model/plan";
import { siteUnits } from "../model/plan";
import type { Network } from "../model/types";
import { r4 } from "../model/lp";

/** Area under the chord curve of the unit disc from -1 to x. */
export const areaTo = (x: number) => 0.5 * (x * Math.sqrt(Math.max(0, 1 - x * x)) + Math.asin(Math.max(-1, Math.min(1, x)))) + Math.PI / 4;
/** x at which the half-disc area (fraction u of pi/2) is reached. */
export function xOfU(u: number): number {
  if (u <= 0) return -1;
  if (u >= 1) return 1;
  const target = u * (Math.PI / 2);
  let lo = -1, hi = 1, x = 2 * u - 1;
  for (let i = 0; i < 60; i++) {
    const f = areaTo(x) - target;
    if (Math.abs(f) < 1e-15) return x;
    if (f < 0) lo = x; else hi = x;
    const d = Math.sqrt(Math.max(1e-12, 1 - x * x));
    const nx = x - f / d;
    x = nx > lo && nx < hi ? nx : (lo + hi) / 2;
  }
  return x;
}
export const chord = (x: number) => Math.sqrt(Math.max(0, 1 - x * x));

export type Half = 0 | 1; // 0 = above the dock (inbound), 1 = below (outbound and unserved)
export interface BarMeta {
  key: string; half: Half; site: number; commodity: number;
  /** "in": plant to site; "out": site to city; "un": unmet demand (UNSERVED column) */
  kind: "in" | "out" | "un";
  /** plant index (in), arc index (out) or demand-node index (un) */
  ref: number;
  /** demand node (out, un) or plant (in) */
  end: number;
}
export interface Union { keys: BarMeta[]; index: Map<string, number>; F: number }

function siteOrder(net: Network) {
  return net.sites.map((s, i) => ({ i, lon: s.lon })).sort((a, b) => a.lon - b.lon || a.i - b.i).map((s) => s.i);
}

/** The canonical bar universe of one or more plans, in drawing order (top bars first, then bottom bars, unserved last). */
export function unionOf(net: Network, plans: Plan[]): Union {
  const oa = net.out_arcs;
  const seen = new Map<string, BarMeta>();
  for (const p of plans) {
    for (const [pl, f, k] of p.routesIn) { const key = `i${pl}_${f}_${k}`; if (!seen.has(key)) seen.set(key, { key, half: 0, site: f, commodity: k, kind: "in", ref: pl, end: pl }); }
    for (const [a, k] of p.routesOut) { const key = `o${a}_${k}`; if (!seen.has(key)) seen.set(key, { key, half: 1, site: oa.site[a]!, commodity: k, kind: "out", ref: a, end: oa.demand[a]! }); }
    for (const u of p.relaxation?.unmet_demand ?? []) { const key = `u${u.demand}_${u.commodity}`; if (!seen.has(key)) seen.set(key, { key, half: 1, site: -1, commodity: u.commodity, kind: "un", ref: u.demand, end: u.demand }); }
  }
  const order = siteOrder(net);
  const rank = new Map(order.map((f, r) => [f, r] as const));
  const lonP = (p: number) => net.plants[p]!.lon;
  const lonD = (d: number) => net.demand_nodes[d]!.lon;
  const arr = [...seen.values()].sort((a, b) => {
    if (a.half !== b.half) return a.half - b.half;
    const ra = a.kind === "un" ? 99 : rank.get(a.site)!, rb = b.kind === "un" ? 99 : rank.get(b.site)!;
    if (ra !== rb) return ra - rb;
    const la = a.kind === "in" ? lonP(a.end) : lonD(a.end), lb = b.kind === "in" ? lonP(b.end) : lonD(b.end);
    return la - lb || a.end - b.end || a.commodity - b.commodity;
  });
  return { keys: arr, index: new Map(arr.map((m, i) => [m.key, i] as const)), F: net.sites.length };
}

export interface Placed {
  /** slot edges in unit-disc x, aligned to union.keys */
  x0: Float64Array; x1: Float64Array;
  /** tons per bar (0 when absent) */
  tons: Float64Array;
  /** rim-end hatch share per bar (slack / bar tons) */
  hatch: Float64Array;
  /** 1 when the bar's left (2) / right (4) edge is a column edge */
  edge: Uint8Array;
  /** per site (F entries) and the UNSERVED column (index F): [x0, x1] */
  colX0: Float64Array; colX1: Float64Array;
  /** per site tons through it */
  colTons: Float64Array;
  /** total tons of the plan's disc (bottom half = top half area), and unmet tons */
  total: number; unmet: number;
  /** Σ top and Σ bottom tons actually placed (the area rule's two sides) */
  topTons: number; bottomTons: number;
}

/**
 * Place a plan on a union. Column widths come from the bottom (outbound plus unserved) tons, the demand that was
 * served; the top bars of a column are scaled by (outbound / inbound) so both halves fill the same x-range. The
 * 3-decimal rounding of published routes makes that factor 1 +- 1e-9.
 */
export function place(net: Network, u: Union, plan: Plan): Placed {
  const n = u.keys.length, F = u.F;
  const tons = new Float64Array(n), hatch = new Float64Array(n);
  const oa = net.out_arcs;
  const inFlow = new Float64Array(F), outFlow = new Float64Array(F);
  const inTons = new Map<string, number>(), outTons = new Map<string, number>(), unTons = new Map<string, number>();
  for (const [p, f, k, t] of plan.routesIn) { inTons.set(`i${p}_${f}_${k}`, t); inFlow[f]! += t; }
  for (const [a, k, t] of plan.routesOut) { outTons.set(`o${a}_${k}`, t); outFlow[oa.site[a]!]! += t; }
  let unmet = 0;
  for (const r of plan.relaxation?.unmet_demand ?? []) { unTons.set(`u${r.demand}_${r.commodity}`, r.tons); unmet += r.tons; }
  const scale = new Float64Array(F);
  for (let f = 0; f < F; f++) scale[f] = inFlow[f]! > 0 ? outFlow[f]! / inFlow[f]! : 1;
  u.keys.forEach((m, i) => {
    if (m.kind === "in") tons[i] = (inTons.get(m.key) ?? 0) * scale[m.site]!;
    else if (m.kind === "out") tons[i] = outTons.get(m.key) ?? 0;
    else tons[i] = unTons.get(m.key) ?? 0;
  });
  // the disc's basis: everything demanded (served plus unserved) is the bottom half; an infeasible plan has no bars
  let bottom = 0, top = 0;
  u.keys.forEach((m, i) => { if (m.half === 0) top += tons[i]!; else bottom += tons[i]!; });
  const total = bottom;
  const x0 = new Float64Array(n), x1 = new Float64Array(n), edge = new Uint8Array(n);
  const colX0 = new Float64Array(F + 1), colX1 = new Float64Array(F + 1), colTons = new Float64Array(F + 1);
  const order = siteOrder(net);
  for (let f = 0; f < F; f++) colTons[f] = outFlow[f]!;
  colTons[F] = unmet;
  for (const half of [0, 1] as Half[]) {
    let cum = 0;
    let lastSite = -2, lastIdx = -1;
    const norm = total > 0 ? 1 / total : 0;
    for (let i = 0; i < n; i++) {
      const m = u.keys[i]!;
      if (m.half !== half) continue;
      const a = cum * norm;
      cum += tons[i]!;
      x0[i] = xOfU(a); x1[i] = xOfU(cum * norm);
      if (tons[i]! > 0) {
        const s = m.kind === "un" ? F : m.site;
        if (s !== lastSite) { edge[i]! |= 2; if (lastIdx >= 0) edge[lastIdx]! |= 4; }
        lastSite = s; lastIdx = i;
      }
    }
    if (lastIdx >= 0) edge[lastIdx]! |= 4;
  }
  // column extents from the bottom boundaries in canonical site order (closed sites sit at zero width between columns)
  {
    let cum = 0;
    const norm = total > 0 ? 1 / total : 0;
    for (const f of order) { colX0[f] = xOfU(cum * norm); cum += colTons[f]!; colX1[f] = xOfU(cum * norm); }
    colX0[F] = xOfU(cum * norm); cum += unmet; colX1[F] = xOfU(cum * norm);
  }
  // slack hatches: supply overshoot on top bars, capacity overshoot on every bar of an over-capacity column, unserved bars fully
  const rel = plan.relaxation;
  if (rel) {
    const supOver = new Map<string, number>();
    for (const s of rel.supply_overshoot) supOver.set(`${s.plant}_${s.commodity}`, s.tons);
    const planted = new Map<string, number>();
    for (const [p, , k, t] of plan.routesIn) planted.set(`${p}_${k}`, (planted.get(`${p}_${k}`) ?? 0) + t);
    const capOver = new Map<number, number>();
    const units = siteUnits(net, plan.routesOut);
    for (const c of rel.capacity_overshoot) capOver.set(c.site, units[c.site]! > 0 ? c.units / units[c.site]! : 0);
    u.keys.forEach((m, i) => {
      if (tons[i] === 0) return;
      if (m.kind === "un") { hatch[i] = 1; return; }
      let h = 0;
      if (m.kind === "in") {
        const so = supOver.get(`${m.ref}_${m.commodity}`);
        if (so) h = Math.max(h, Math.min(1, so / (planted.get(`${m.ref}_${m.commodity}`) ?? 1)));
      }
      const co = capOver.get(m.site);
      if (co) h = Math.max(h, Math.min(1, co));
      hatch[i] = h;
    });
  }
  return { x0, x1, tons, hatch, edge, colX0, colX1, colTons, total, unmet, topTons: top, bottomTons: bottom };
}

/** Height (unit disc) of the inner edge of a rim-end hatch band so that its area is `share` of the slot's area (closed form, bisection). */
export function hatchHeight(x0: number, x1: number, share: number): number {
  if (x1 <= x0 || share <= 0) return 0;
  const want = share * (areaTo(x1) - areaTo(x0));
  const over = (h: number) => {
    const xh = Math.sqrt(Math.max(0, 1 - h * h));
    const a = Math.max(x0, -xh), b = Math.min(x1, xh);
    return b > a ? areaTo(b) - areaTo(a) - h * (b - a) : 0;
  };
  let lo = 0, hi = Math.max(chord(x0), chord(x1));
  if (x0 < 0 && x1 > 0) hi = 1;
  for (let i = 0; i < 48; i++) { const mid = (lo + hi) / 2; if (over(mid) > want) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** Sum of slot areas (unit disc) of a key subset: the test hook of the area rule. */
export const slotArea = (p: Placed, i: number) => areaTo(p.x1[i]!) - areaTo(p.x0[i]!);

/** Radius of a plan's disc at a camera: baseline tons are R0, a bigger or smaller disc scales by sqrt(tons) (constant k). */
export const BASE_TONS = 2589781;
export const radiusFor = (R0: number, tons: number) => R0 * Math.sqrt(Math.max(tons, 1) / BASE_TONS);

/** The seam's open sites' x centres and their canonical longitude order, for squares and labels. */
export function siteCentres(net: Network, p: Placed) {
  return net.sites.map((_, f) => ({ f, x: (p.colX0[f]! + p.colX1[f]!) / 2, w: p.colX1[f]! - p.colX0[f]!, tons: p.colTons[f]! }));
}
export { r4 };
