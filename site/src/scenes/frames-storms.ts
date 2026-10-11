import { registerFrame, renderDisc, type DiscSpec, type Frame, type LabelSpec } from "./director";
import { PlanTransition } from "./transition";
import { slotCam } from "./frames-shared";
import { roomOf } from "./geometry";
import { storms } from "../state/scenes";
import { getStore } from "../data/loader";
import { ROBUSTNESS } from "../data/artifacts";
import { drawOrder, drawPlan, lostPlan, tail } from "../model/storms";
import { windowed, stepState } from "../motion/progress";
import { DUR } from "../motion/ease";
import { BASE_TONS } from "../dock/layout";
import type { Robustness } from "../model/types";

const trL = new PlanTransition(), trR = new PlanTransition();
let phaseState = 0, lastP = -1, lastPos = -1, lastAt = 0;
const ordCache = new WeakMap<Robustness, Map<string, number[]>>();
export function orderOf(rb: Robustness, o: "legacy_cost" | "index") {
  let m = ordCache.get(rb);
  if (!m) { m = new Map(); ordCache.set(rb, m); }
  let v = m.get(o);
  if (!v) { v = drawOrder(rb, o); m.set(o, v); }
  return v;
}
export const maxTons = (rb: Robustness) => Math.max(...rb.draws.demand_tons);
/** Scroll p 0.05-0.70 scrubs the 500 draws (integer positions, never between draws). */
export const posAt = (p: number, n = 500) => Math.min(n - 1, Math.max(0, Math.floor(windowed(p, 0.05, 0.7) * n)));
export const STORM_PHASE_T = [0.74, 0.86];

registerFrame("storms", ({ now, p, L, net, W, H }) => {
  const rs = getStore(ROBUSTNESS).state;
  const ra = roomOf("storms:a"), rb2 = roomOf("storms:b");
  if (rs.status !== "ready" || !ra || !rb2) return null;
  const rb = rs.data;
  if (p !== lastP) {
    lastP = p;
    phaseState = stepState(phaseState, p, STORM_PHASE_T, 0.02);
    const ph = (["scrub", "tail", "lose"] as const)[phaseState]!;
    const cur = storms.get();
    if (cur.phase !== ph) storms.set({ phase: ph, lost: ph === "lose" ? cur.lost ?? 0 : ph === "scrub" ? null : cur.lost });
    if (ph === "scrub") { const pos = posAt(p); if (pos !== cur.draw) storms.set({ draw: pos }); }
  }
  const st = storms.get();
  const order = orderOf(rb, st.order);
  const idx = order[Math.min(order.length - 1, st.draw)]!;
  const mt = maxTons(rb);
  const scale = Math.sqrt(mt / BASE_TONS);
  const camA = slotCam("storms:a", L, 0.94); camA.R /= scale;
  const camB = slotCam("storms:b", L, 0.94); camB.R /= scale;
  const rate = lastPos < 0 ? 0 : (Math.abs(st.draw - lastPos) * 1000) / Math.max(1, now - lastAt);
  if (st.draw !== lastPos) { lastPos = st.draw; lastAt = now; }
  const ms = rate > 10 ? 0 : DUR.standard;
  const pl = drawPlan(net, rb, "legacy", idx);
  const pr = st.lost !== null && st.phase === "lose" ? lostPlan(net, rb, st.lost) ?? drawPlan(net, rb, "optimized", idx) : st.lost !== null && storms.get().lost !== null && st.phase !== "tail" ? lostPlan(net, rb, st.lost) ?? drawPlan(net, rb, "optimized", idx) : drawPlan(net, rb, "optimized", idx);
  trL.set(pl, now, ms); trR.set(pr, now, st.lost !== null ? DUR.card : ms);
  const b1 = trL.update(now), b2 = trR.update(now);
  const tailOn = st.phase === "tail";
  const failed = new Set(rb.draws.failed_sites[idx] ?? []);
  const lostSite = st.lost;
  const specL: DiscSpec = { A: trL.A ?? pl, B: trL.mix < 1 ? trL.B : null, mix: trL.mix, cam: camA, open: 1, opacity: tailOn ? 0 : 1, squareKind: (f, isOpen) => (failed.has(f) && !isOpen ? "lost" : isOpen ? "open" : "closed") };
  const specR: DiscSpec = { A: trR.A ?? pr, B: trR.mix < 1 ? trR.B : null, mix: trR.mix, cam: camB, open: 1, opacity: tailOn ? 0 : 1, squareKind: (f, isOpen) => ((lostSite === f || (st.phase !== "lose" && failed.has(f))) && !isOpen ? "lost" : isOpen ? "open" : "closed") };
  const labels: LabelSpec[] = [];
  void labels;
  const f: Frame = {
    discs: tailOn ? [] : [specL, specR], glow: b1 || b2 ? 0.3 : 0.8, glowKey: b1 || b2 ? "t" : `${idx}|${st.lost}|${st.phase}`, busy: b1 || b2, labels,
    sig: `storms|${idx}|${st.phase}|${st.lost}|${trL.mix.toFixed(3)}|${trR.mix.toFixed(3)}|${W}x${H}`,
    extra: tailOn ? (ctx) => {
      // two groups of 25 miniatures inside the disc area: the worst 25 draws (CVaR95 tail) of each design, each a static rendering of its draw
      const x0 = Math.min(ra.x, rb2.x), x1 = Math.max(ra.x + ra.w, rb2.x + rb2.w), y0 = Math.min(ra.y, rb2.y), y1 = Math.max(ra.y + ra.h, rb2.y + rb2.h);
      const w = x1 - x0, hh = (y1 - y0) / 2 - 22;
      const cols = Math.max(5, Math.min(13, Math.round(Math.sqrt(25 * (w / Math.max(40, hh))))));
      const rowsN = Math.ceil(25 / cols);
      const cell = Math.min(w / cols, hh / rowsN);
      const r = (cell / 2) * 0.88;
      const gx = x0 + (w - cell * cols) / 2;
      (["legacy", "optimized"] as const).forEach((d, ri) => {
        const gy = y0 + ri * ((y1 - y0) / 2) + 20;
        tail(rb, d).forEach((di, k) => {
          const cx = gx + cell * ((k % cols) + 0.5), cy = gy + cell * (Math.floor(k / cols) + 0.5);
          const spec: DiscSpec = { A: drawPlan(net, rb, d, di), mix: 0, cam: { cx, cy, R: r / scale }, open: 1, squareAlpha: 0 };
          renderDisc(ctx, net, spec, 0, 0.6);
        });
      });
    } : undefined,
  };
  if (tailOn) {
    const y0 = Math.min(ra.y, rb2.y), y1 = Math.max(ra.y + ra.h, rb2.y + rb2.h), x0 = Math.min(ra.x, rb2.x);
    f.labels = [
      { key: "t0", text: "LEGACY · WORST 25 OF 500", x: x0, y: y0, align: "l", cls: "dock-caption" },
      { key: "t1", text: "OPTIMIZED · WORST 25 OF 500", x: x0, y: y0 + (y1 - y0) / 2, align: "l", cls: "dock-caption" },
    ];
  }
  return f;
});
