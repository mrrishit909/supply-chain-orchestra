/** Published plans, built once per artifact object (scenarios by id; sweep records by series and k). */
import { planFromScenario, planFromSweep, sweepRecord, type Plan } from "./plan";
import type { Network, Solutions, Sweep } from "./types";

const scen = new WeakMap<Solutions, Map<string, Plan>>();
export function scenarioPlan(net: Network, s: Solutions, id: string): Plan | null {
  let m = scen.get(s);
  if (!m) { m = new Map(); scen.set(s, m); }
  let p = m.get(id);
  if (!p) {
    const sc = s.scenarios.find((x) => x.id === id);
    if (!sc) return null;
    p = planFromScenario(net, sc);
    m.set(id, p);
  }
  return p;
}
const swp = new WeakMap<Sweep, Map<string, Plan>>();
export function sweepPlan(net: Network, sw: Sweep, series: "limit" | "exactly", k: number, relaxed = false): Plan | null {
  let m = swp.get(sw);
  if (!m) { m = new Map(); swp.set(sw, m); }
  const key = `${series}|${k}|${relaxed}`;
  let p = m.get(key);
  if (!p) {
    const rec = sweepRecord(sw, series, k);
    if (!rec || (relaxed && !rec.relaxed)) return null;
    p = planFromSweep(net, rec, relaxed);
    m.set(key, p);
  }
  return p;
}
