import { registerFrame, blend, type DiscSpec, type Frame } from "./director";
import { PlanTransition } from "./transition";
import { slotCam } from "./frames-shared";
import { camera } from "./geometry";
import { sites } from "../state/scenes";
import { getStore } from "../data/loader";
import { SWEEP } from "../data/artifacts";
import { scenarioPlan, sweepPlan } from "../model/plans";
import { stepState, windowed } from "../motion/progress";
import { easeSymmetric } from "../motion/ease";
import { siteLabels } from "./labels";
import { DUR } from "../motion/ease";

/** Scroll p 0.06-0.94 steps exactly-k from 14 down to 3 (12 steps, hysteresis +-0.02). */
export const K_THRESH = Array.from({ length: 11 }, (_, i) => 0.06 + (0.88 * (i + 1)) / 12);
export const kAt = (state: number) => 14 - state;
export const pForK = (k: number) => 0.06 + (0.88 * (14 - Math.max(3, k) + 0.5)) / 12;

const tr = new PlanTransition();
let state = 0;
let lastP = -1;
export const sitesTransition = tr;

registerFrame("sites", ({ now, p, L, net, solutions, W, H }) => {
  const opt = scenarioPlan(net, solutions, "optimized");
  const sw = getStore(SWEEP).state;
  if (!opt) return null;
  // scroll steps k; the stepper sets it directly and the next scroll move takes over again
  if (p !== lastP) {
    lastP = p;
    if (p >= 0.06 && p <= 0.94) {
      state = stepState(state, p, K_THRESH, 0.02);
      const k = kAt(state);
      if (sites.get().k !== k) sites.set({ k, relaxed: false });
    }
  }
  const { k, relaxed } = sites.get();
  const swp = sw.status === "ready" ? sw.data : null;
  let plan = opt;
  if (swp) plan = sweepPlan(net, swp, "exactly", k, relaxed && k <= 4) ?? opt;
  if (p > 0.94 && swp) plan = opt;
  // S02 hand-over: the disc is already at G2 with the whole optimum
  tr.set(plan, now, DUR.scene);
  const busy = tr.update(now);
  const A = tr.A ?? plan, B = tr.mix < 1 ? tr.B : null;
  const cam = slotCam("sites:disc", L, 0.96);
  const base: DiscSpec = { A, B, mix: tr.mix, cam, open: 1 };
  const b = blend(net, base);
  const ol = tr.outline(now);
  const shown = B ?? A;
  const infeasible = shown.status === "Infeasible";
  const disc: DiscSpec = {
    ...base,
    outline: ol > 0 && b.B ? (_m, i) => (b.B!.tons[i]! > 0 && b.A.tons[i]! === 0 ? ol : 0) : undefined,
    needed: infeasible && !busy ? 1 : infeasible ? tr.mix : B && B.status !== "Infeasible" && A.status === "Infeasible" ? 1 - tr.mix : 0,
    squareAlpha: 1,
  };
  const R = cam.R * Math.sqrt(plan.demandTons / 2589781);
  const labels = infeasible ? [] : siteLabels(net, b, cam.cx, cam.cy, R, { minCol: L.cls === "M" ? 36 : 0 });
  const f: Frame = {
    discs: [disc], glow: busy ? 0.4 : 1, labels, busy, glowKey: busy ? "t" : `${plan.id}|${k}`,
    sig: `sites|${plan.id}|${k}|${tr.mix.toFixed(3)}|${ol.toFixed(2)}|${W}x${H}|${relaxed}`,
  };
  void camera; void windowed; void easeSymmetric;
  return f;
});
