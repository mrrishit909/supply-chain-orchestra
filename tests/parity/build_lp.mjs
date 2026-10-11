// Reference browser-side implementation: rebuilds the LP text from network.json + model.json + vector.params ONLY,
// checks the SHA-256 against the Python reference, solves with highs@1.15.3 (HiGHS-wasm) and compares status and objective.
//   cd tests/parity && npm ci && node build_lp.mjs [--report ../../artifacts/evidence/parity_report.json]
import fs from 'node:fs';
import crypto from 'node:crypto';
import highs from 'highs';

const D = '../../site/public/data/';
const rd = (n) => JSON.parse(fs.readFileSync(D + n + '.json', 'utf8'));
const net = rd('network'), model = rd('model'), tv = rd('solver_test_vectors');

const r4 = (x) => Math.floor(x * 1e4 + 0.5) / 1e4;
const fmt = (v) => { const s = v.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''); return s === '-0' || s === '' ? '0' : s; };
const PEN = model.penalties;
const LINK = true;

export function buildLp(pIn) {
  const p = { ...model.defaults, ...pIn };
  const F = net.sites.length, Dn = net.demand_nodes.length, P = net.plants.length, K = net.commodities.length;
  const oa = net.out_arcs, A = oa.site.length, cm = net.commodities;
  const w = cm.map((c) => c.capacity_units_per_ton);
  const dem = net.demand_nodes.map((n) => n.demand_tons.map((t) => r4(t * p.demand_scale)));
  const fixed = net.sites.map((s) => r4(s.fixed_cost_usd_yr * p.fixed_cost_scale));
  const cap = net.sites.map((s) => r4(s.capacity_units * p.capacity_scale));
  const sup = net.plants.map((pl) => pl.supply_tons.map(Number));
  const tOut = (a, k) => r4(cm[k].rate_out_usd_ton_mi * oa.road_mi[a] * p.freight_scale);
  const tIn = (pp, f, k) => r4(cm[k].rate_in_usd_ton_mi * net.in_road_mi[pp][f] * p.freight_scale);
  const hand = cm.map((c) => r4(c.handling_usd_ton));
  const ofD = Array.from({ length: Dn }, () => []), ofS = Array.from({ length: F }, () => []);
  for (let a = 0; a < A; a++) { ofD[oa.demand[a]].push(a); ofS[oa.site[a]].push(a); }
  const rl = p.relax;
  const obj = [];
  const push = (n, v) => { if (v !== 0) obj.push(`${fmt(v)} ${n}`); };
  for (let f = 0; f < F; f++) push(`z${f}`, fixed[f]);
  for (let a = 0; a < A; a++) for (let k = 0; k < K; k++) push(`x${a}_${k}`, tOut(a, k) + hand[k]);
  for (let pp = 0; pp < P; pp++) for (let f = 0; f < F; f++) for (let k = 0; k < K; k++) push(`y${pp}_${f}_${k}`, tIn(pp, f, k));
  if (rl) {
    for (let d = 0; d < Dn; d++) for (let k = 0; k < K; k++) push(`u${d}_${k}`, PEN.unmet_usd_ton);
    for (let f = 0; f < F; f++) push(`so${f}`, PEN.capacity_usd_unit);
    for (let pp = 0; pp < P; pp++) for (let k = 0; k < K; k++) push(`sp${pp}_${k}`, PEN.supply_usd_ton);
    push('sm', PEN.open_sites_usd_site);
  }
  const out = ['\\ Supply Chain Orchestra MILP (generated); layout in model.json', 'Minimize', ' obj: ' + obj.join(' + '), 'Subject To'];
  const row = (name, terms, sense, rhs) => out.push(` ${name}: ` + terms.map(([n, c]) => `${c >= 0 ? '+' : '-'} ${fmt(Math.abs(c))} ${n}`).join(' ') + ` ${sense} ${fmt(rhs)}`);
  for (let d = 0; d < Dn; d++) for (let k = 0; k < K; k++) row(`dem${d}_${k}`, [...ofD[d].map((a) => [`x${a}_${k}`, 1]), ...(rl ? [[`u${d}_${k}`, 1]] : [])], '=', dem[d][k]);
  for (let f = 0; f < F; f++) for (let k = 0; k < K; k++) row(`flw${f}_${k}`, [...Array.from({ length: P }, (_, pp) => [`y${pp}_${f}_${k}`, 1]), ...ofS[f].map((a) => [`x${a}_${k}`, -1])], '=', 0);
  for (let f = 0; f < F; f++) {
    const t = [];
    for (const a of ofS[f]) for (let k = 0; k < K; k++) t.push([`x${a}_${k}`, w[k]]);
    t.push([`z${f}`, -cap[f]]); if (rl) t.push([`so${f}`, -1]);
    row(`cap${f}`, t, '<=', 0);
  }
  for (let pp = 0; pp < P; pp++) for (let k = 0; k < K; k++) row(`sup${pp}_${k}`, [...Array.from({ length: F }, (_, f) => [`y${pp}_${f}_${k}`, 1]), ...(rl ? [[`sp${pp}_${k}`, -1]] : [])], '<=', sup[pp][k]);
  if (LINK) for (let a = 0; a < A; a++) for (let k = 0; k < K; k++) row(`lnk${a}_${k}`, [[`x${a}_${k}`, 1], [`z${oa.site[a]}`, -dem[oa.demand[a]][k]]], '<=', 0);
  row('mxo', [...Array.from({ length: F }, (_, f) => [`z${f}`, 1]), ...(rl ? [['sm', -1]] : [])], p.open_exactly ? '=' : '<=', p.max_open_sites);
  for (const f of [...p.closed_sites].sort((a, b) => a - b)) row(`cls${f}`, [[`z${f}`, 1]], '=', 0);
  if (p.fixed_open !== null && p.fixed_open !== undefined) { const fo = new Set(p.fixed_open); for (let f = 0; f < F; f++) row(`fix${f}`, [[`z${f}`, 1]], '=', fo.has(f) ? 1 : 0); }
  out.push('Bounds');
  for (const a of [...p.closed_lanes].sort((x, y) => x - y)) for (let k = 0; k < K; k++) out.push(` x${a}_${k} = 0`);
  out.push('Binary', ' ' + Array.from({ length: F }, (_, f) => `z${f}`).join(' '), 'End');
  return out.join('\n') + '\n';
}

const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

async function main() {
  const H = await highs();
  const rep = [];
  let bad = 0;
  for (const v of tv.vectors) {
    const text = buildLp(v.params);
    const hashOk = sha(text) === v.lp_text_sha256;
    const t0 = performance.now();
    let st = 'error', ob = null;
    try { const r = H.solve(text, tv.solver_options); st = r.Status; ob = st === 'Optimal' ? r.ObjectiveValue : null; } catch (e) { st = 'error:' + e.message; }
    const ms = Math.round(performance.now() - t0);
    const e = v.expected;
    const statusOk = st === e.status;
    const objOk = e.objective_usd === null ? ob === null : ob !== null && Math.abs(ob - e.objective_usd) <= Math.max(tv.tolerance_abs_usd, tv.tolerance_rel * Math.abs(e.objective_usd));
    if (!(hashOk && statusOk && objOk)) bad++;
    rep.push({ id: v.id, hashOk, statusOk, objOk, status: st, objective: ob, expected_objective: e.objective_usd, wasm_ms: ms });
    console.log(`${hashOk && statusOk && objOk ? 'ok  ' : 'FAIL'} ${v.id.padEnd(28)} ${st.padEnd(10)} ${String(ms).padStart(6)} ms`);
  }
  const ms = rep.map((r) => r.wasm_ms).sort((a, b) => a - b);
  const summary = { vectors: rep.length, failures: bad, wasm_ms_median: ms[Math.floor(ms.length / 2)], wasm_ms_max: ms[ms.length - 1], node: process.version, highs_npm: '1.15.3' };
  console.log(summary);
  const i = process.argv.indexOf('--report');
  if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify({ summary, vectors: rep }, null, 1) + '\n');
  process.exit(bad ? 1 : 0);
}
if (process.argv[1] && process.argv[1].endsWith('build_lp.mjs')) main();
