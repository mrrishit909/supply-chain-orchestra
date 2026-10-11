/**
 * The MILP's LP text, a straight port of tests/parity/build_lp.mjs (itself a port of analytics/milp.py::Model.lp_text).
 * Same rounding (r4, half up), same number format, same column and row order, so the browser solves the very text
 * Python solved and the SHA-256 matches. Pure: runs on the main thread (hash, build) and in Vitest (Node).
 */
import type { Model, Network, Params } from "./types";

export const r4 = (x: number) => Math.floor(x * 1e4 + 0.5) / 1e4;
export const fmt = (v: number) => {
  const s = v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" || s === "" ? "0" : s;
};

/** Slider values carry float error (0.5 + 18 * 0.05); the LP text and preset matching use the step's decimals. */
export function quantize(v: number, step: number) {
  const dec = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  return Number(v.toFixed(dec));
}

export function fullParams(model: Model, p: Partial<Params> = {}): Params {
  const out = { ...model.defaults, ...p } as Params;
  out.closed_sites = [...out.closed_sites].sort((a, b) => a - b);
  out.closed_lanes = [...out.closed_lanes].sort((a, b) => a - b);
  return out;
}

/** The visitor's slider values snapped to their step (controls only; published vectors keep their exact values). */
export function snapControls(model: Model, p: Params): Params {
  const out = { ...p };
  for (const c of model.controls) {
    if (c.kind !== "range" || c.step === null) continue;
    const key = c.id as keyof Params;
    const v = out[key];
    if (typeof v === "number") (out as unknown as Record<string, number>)[key] = quantize(v, c.step);
  }
  return out;
}

export const sameParams = (a: Params, b: Params) =>
  a.capacity_scale === b.capacity_scale && a.demand_scale === b.demand_scale && a.fixed_cost_scale === b.fixed_cost_scale &&
  a.freight_scale === b.freight_scale && a.max_open_sites === b.max_open_sites && a.open_exactly === b.open_exactly && a.relax === b.relax &&
  JSON.stringify([...a.closed_sites].sort((x, y) => x - y)) === JSON.stringify([...b.closed_sites].sort((x, y) => x - y)) &&
  JSON.stringify([...a.closed_lanes].sort((x, y) => x - y)) === JSON.stringify([...b.closed_lanes].sort((x, y) => x - y)) &&
  JSON.stringify(a.fixed_open ?? null) === JSON.stringify(b.fixed_open ?? null);

/**
 * `continuous` drops the Binary section and bounds z to 0..1: the LP with the open set fixed through `fixed_open`,
 * whose row duals are the DERIVED shadow prices (milp.py::fixed_design_duals).
 */
export function buildLp(net: Network, model: Model, pIn: Partial<Params>, opts: { continuous?: boolean } = {}): string {
  const p = { ...model.defaults, ...pIn } as Params;
  const F = net.sites.length, Dn = net.demand_nodes.length, P = net.plants.length, K = net.commodities.length;
  const oa = net.out_arcs, A = oa.site.length, cm = net.commodities;
  const PEN = model.penalties;
  const w = cm.map((c) => c.capacity_units_per_ton);
  const dem = net.demand_nodes.map((n) => n.demand_tons.map((t) => r4(t * p.demand_scale)));
  const fixed = net.sites.map((s) => r4(s.fixed_cost_usd_yr * p.fixed_cost_scale));
  const cap = net.sites.map((s) => r4(s.capacity_units * p.capacity_scale));
  const sup = net.plants.map((pl) => pl.supply_tons.map(Number));
  const tOut = (a: number, k: number) => r4(cm[k]!.rate_out_usd_ton_mi * oa.road_mi[a]! * p.freight_scale);
  const tIn = (pp: number, f: number, k: number) => r4(cm[k]!.rate_in_usd_ton_mi * net.in_road_mi[pp]![f]! * p.freight_scale);
  const hand = cm.map((c) => r4(c.handling_usd_ton));
  const ofD: number[][] = Array.from({ length: Dn }, () => []);
  const ofS: number[][] = Array.from({ length: F }, () => []);
  for (let a = 0; a < A; a++) { ofD[oa.demand[a]!]!.push(a); ofS[oa.site[a]!]!.push(a); }
  const rl = p.relax;
  const obj: string[] = [];
  const push = (n: string, v: number) => { if (v !== 0) obj.push(`${fmt(v)} ${n}`); };
  for (let f = 0; f < F; f++) push(`z${f}`, fixed[f]!);
  for (let a = 0; a < A; a++) for (let k = 0; k < K; k++) push(`x${a}_${k}`, tOut(a, k) + hand[k]!);
  for (let pp = 0; pp < P; pp++) for (let f = 0; f < F; f++) for (let k = 0; k < K; k++) push(`y${pp}_${f}_${k}`, tIn(pp, f, k));
  if (rl) {
    for (let d = 0; d < Dn; d++) for (let k = 0; k < K; k++) push(`u${d}_${k}`, PEN.unmet_usd_ton);
    for (let f = 0; f < F; f++) push(`so${f}`, PEN.capacity_usd_unit);
    for (let pp = 0; pp < P; pp++) for (let k = 0; k < K; k++) push(`sp${pp}_${k}`, PEN.supply_usd_ton);
    push("sm", PEN.open_sites_usd_site);
  }
  const out = ["\\ Supply Chain Orchestra MILP (generated); layout in model.json", "Minimize", " obj: " + obj.join(" + "), "Subject To"];
  type Term = [string, number];
  const row = (name: string, terms: Term[], sense: string, rhs: number) =>
    out.push(` ${name}: ` + terms.map(([n, c]) => `${c >= 0 ? "+" : "-"} ${fmt(Math.abs(c))} ${n}`).join(" ") + ` ${sense} ${fmt(rhs)}`);
  for (let d = 0; d < Dn; d++) for (let k = 0; k < K; k++) row(`dem${d}_${k}`, [...ofD[d]!.map((a): Term => [`x${a}_${k}`, 1]), ...(rl ? [[`u${d}_${k}`, 1] as Term] : [])], "=", dem[d]![k]!);
  for (let f = 0; f < F; f++) for (let k = 0; k < K; k++) row(`flw${f}_${k}`, [...Array.from({ length: P }, (_, pp): Term => [`y${pp}_${f}_${k}`, 1]), ...ofS[f]!.map((a): Term => [`x${a}_${k}`, -1])], "=", 0);
  for (let f = 0; f < F; f++) {
    const t: Term[] = [];
    for (const a of ofS[f]!) for (let k = 0; k < K; k++) t.push([`x${a}_${k}`, w[k]!]);
    t.push([`z${f}`, -cap[f]!]);
    if (rl) t.push([`so${f}`, -1]);
    row(`cap${f}`, t, "<=", 0);
  }
  for (let pp = 0; pp < P; pp++) for (let k = 0; k < K; k++) row(`sup${pp}_${k}`, [...Array.from({ length: F }, (_, f): Term => [`y${pp}_${f}_${k}`, 1]), ...(rl ? [[`sp${pp}_${k}`, -1] as Term] : [])], "<=", sup[pp]![k]!);
  for (let a = 0; a < A; a++) for (let k = 0; k < K; k++) row(`lnk${a}_${k}`, [[`x${a}_${k}`, 1], [`z${oa.site[a]!}`, -dem[oa.demand[a]!]![k]!]], "<=", 0);
  row("mxo", [...Array.from({ length: F }, (_, f): Term => [`z${f}`, 1]), ...(rl ? [["sm", -1] as Term] : [])], p.open_exactly ? "=" : "<=", p.max_open_sites);
  for (const f of [...p.closed_sites].sort((a, b) => a - b)) row(`cls${f}`, [[`z${f}`, 1]], "=", 0);
  if (p.fixed_open !== null && p.fixed_open !== undefined) {
    const fo = new Set(p.fixed_open);
    for (let f = 0; f < F; f++) row(`fix${f}`, [[`z${f}`, 1]], "=", fo.has(f) ? 1 : 0);
  }
  out.push("Bounds");
  for (const a of [...p.closed_lanes].sort((x, y) => x - y)) for (let k = 0; k < K; k++) out.push(` x${a}_${k} = 0`);
  if (opts.continuous) {
    for (let f = 0; f < F; f++) out.push(` 0 <= z${f} <= 1`);
    out.push("End");
  } else {
    out.push("Binary", " " + Array.from({ length: F }, (_, f) => `z${f}`).join(" "), "End");
  }
  return out.join("\n") + "\n";
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
