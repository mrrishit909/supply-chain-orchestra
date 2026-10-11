import { registerFrame, blend, type DiscSpec, type LabelSpec } from "./director";
import { PlanTransition } from "./transition";
import { slotCam } from "./frames-shared";
import { brk, type BreakCase } from "../state/scenes";
import { scenarioPlan } from "../model/plans";
import { stepState } from "../motion/progress";
import { DUR, easeSmooth, easeSymmetric } from "../motion/ease";
import { Tween } from "../motion/tween";
import { clamp } from "../lib/math";
import { siteLabels } from "./labels";
import type { Plan } from "../model/plan";
import type { Network, Solutions } from "../model/types";

export const BREAK_THRESH = [0.17, 0.3, 0.39, 0.52, 0.61, 0.74, 0.86];
export const BREAK_STATES: { case: BreakCase; mode: "strict" | "relaxed"; storm?: "legacy" | "optimized" }[] = [
  { case: "supply", mode: "strict" }, { case: "supply", mode: "relaxed" }, { case: "capacity", mode: "strict" }, { case: "capacity", mode: "relaxed" },
  { case: "sites", mode: "strict" }, { case: "sites", mode: "relaxed" }, { case: "storm", mode: "relaxed", storm: "legacy" }, { case: "storm", mode: "relaxed", storm: "optimized" },
];
export const breakStateP = (i: number) => (i === 0 ? 0.1 : (BREAK_THRESH[i - 1]! + (BREAK_THRESH[i] ?? 1)) / 2 + (i === 7 ? 0.04 : 0));
export function breakId(c: BreakCase, mode: "strict" | "relaxed", storm: "legacy" | "optimized") {
  if (c === "storm") return storm === "legacy" ? "storm_legacy" : "storm_optimized";
  return `${mode === "strict" ? "infeasible" : "relaxed"}_${c}`;
}
export function breakPlan(net: Network, s: Solutions): Plan | null {
  const b = brk.get();
  if (b.live && b.live.params && b.live.id === "live") return b.live;
  return scenarioPlan(net, s, breakId(b.case, b.mode, b.storm));
}

const tr = new PlanTransition();
const openTw = new Tween(1, DUR.card, easeSymmetric);
const hatch = { t0: -1, plan: "" };
let st = 0, lastP = -1, shown: Plan | null = null;

registerFrame("break", ({ now, p, L, net, solutions, W, H }) => {
  if (p !== lastP) {
    lastP = p;
    const ns = stepState(st, p, BREAK_THRESH, 0.02);
    if (ns !== st) { st = ns; const s = BREAK_STATES[st]!; brk.set({ case: s.case, mode: s.mode, storm: s.storm ?? brk.get().storm, live: null }); }
  }
  const plan = breakPlan(net, solutions);
  if (!plan) return null;
  const infeasible = plan.status === "Infeasible";
  const cam = slotCam("break:disc", L, 0.8);
  if (!infeasible) {
    if (!shown || shown.status === "Infeasible" || openTw.target === 0) {
      // plan restored: bars open from the dock (800 ms), then the slack hatches fill from the dock outward (600 ms)
      shown = plan; tr.set(plan, now, 0); tr.A = tr.B = plan; tr.mix = 1;
      openTw.value = 0; openTw.retarget(1, now, DUR.card);
      hatch.t0 = now + DUR.card; hatch.plan = plan.id;
    } else if (tr.B !== plan) {
      tr.set(plan, now, DUR.scene);
      shown = plan;
      hatch.t0 = now + DUR.scene; hatch.plan = plan.id;
    }
  } else if (openTw.target !== 0) {
    openTw.retarget(0, now, DUR.panel);
  }
  const busy1 = tr.update(now), busy2 = openTw.update(now);
  const show = shown ?? plan;
  const A = tr.A ?? show, B = tr.mix < 1 ? tr.B : null;
  const o = openTw.value;
  const hf = hatch.t0 < 0 ? 1 : easeSmooth(clamp((now - hatch.t0) / DUR.panel));
  const needTons = infeasible ? plan.demandTons : 0;
  const disc: DiscSpec = {
    A, B, mix: tr.mix, cam, open: o, hatchFill: hf,
    needed: infeasible ? 1 - o : 0,
    squareKind: (_f, isOpen) => (isOpen && show.relaxation && show.relaxation.open_sites_excess > 0 ? "over" : isOpen ? "open" : "closed"),
    squareAlpha: infeasible ? 1 : 1,
  };
  // the needed disc has the area the infeasible demand would have; its radius follows the demand tons
  const dRef = infeasible && o <= 0.001 ? { ...disc, A: { ...show, demandTons: needTons } as Plan } : disc;
  const b = blend(net, dRef);
  const R = cam.R * Math.sqrt((infeasible && o <= 0.001 ? needTons : show.demandTons) / 2589781);
  const labels: LabelSpec[] = infeasible && o < 0.5 ? [] : siteLabels(net, b, cam.cx, cam.cy, R, { minCol: L.cls === "M" ? 36 : 0, alpha: o });
  const un = show.relaxation?.unmet_demand.length ? net.sites.length : -1;
  if (un >= 0 && o > 0.5) {
    const x = cam.cx + ((b.colX0[un]! + b.colX1[un]!) / 2) * R;
    labels.push({ key: "unserved", text: "UNSERVED", x, y: cam.cy + 16, cls: "dock-caption", alpha: o });
  }
  const ex = show.relaxation?.open_sites_excess ?? 0;
  if (ex > 0 && o > 0.5) labels.push({ key: "over", text: `+${Math.round(ex)} SITES OVER THE LIMIT`, x: cam.cx, y: cam.cy - 28, cls: "dock-caption", alpha: o });
  return {
    discs: [dRef], glow: busy1 || busy2 ? 0.3 : 1, glowKey: busy1 || busy2 ? "t" : `${show.id}|${infeasible}`, busy: busy1 || busy2 || hf < 1, labels,
    sig: `break|${plan.id}|${show.id}|${o.toFixed(3)}|${tr.mix.toFixed(3)}|${hf.toFixed(3)}|${W}x${H}`,
  };
});
export { easeSymmetric };
