import { registerFrame, blend, type DiscSpec } from "./director";
import { PlanTransition } from "./transition";
import { slotCam } from "./frames-shared";
import { limits } from "../state/scenes";
import { scenarioPlan } from "../model/plans";
import { stepState } from "../motion/progress";
import { Tween } from "../motion/tween";
import { DUR, easeSmooth } from "../motion/ease";
import { siteLabels } from "./labels";
import { getStore } from "../data/loader";
import { FACTS } from "../data/artifacts";
import { int } from "../model/format";
import { siteUnits } from "../model/plan";
import { r4 } from "../model/lp";

export const LIMIT_THRESH = [0.4, 0.68];
export const SITE_FULL = 10;
let st = 0, lastP = -1;
const tr = new PlanTransition();
const priceTw = new Tween(0, DUR.fast, easeSmooth);
const dimTw = new Tween(1, DUR.standard, easeSmooth);

export function priceBin(edges: number[], v: number) {
  let b = 0;
  for (let i = 1; i < edges.length - 1; i++) if (v >= edges[i]!) b = i;
  return Math.min(4, b);
}

registerFrame("limits", ({ now, p, L, net, solutions, W, H }) => {
  const opt = scenarioPlan(net, solutions, "optimized");
  if (!opt) return null;
  if (p !== lastP) { lastP = p; st = stepState(st, p, LIMIT_THRESH, 0.02); if (limits.get().step !== st) limits.set({ step: st }); }
  const { step, live, cap } = limits.get();
  const plan = cap > 1 && live ? live : opt;
  tr.set(plan, now, DUR.card);
  const busy1 = tr.update(now);
  priceTw.retarget(step === 2 ? 1 : 0, now, DUR.fast);
  const busy2 = priceTw.update(now);
  const A = tr.A ?? plan, B = tr.mix < 1 ? tr.B : null;
  const cam = slotCam("limits:disc", L, 0.96);
  const fs = getStore(FACTS).state;
  const bins = fs.status === "ready" ? fs.data.demand_price_bins.commodities : null;
  const sc = solutions.scenarios.find((s) => s.id === "optimized")!;
  const price = sc.demand_price_usd_ton;
  const base: DiscSpec = { A, B, mix: tr.mix, cam, open: 1 };
  const b = blend(net, base);
  const ol = tr.outline(now);
  const disc: DiscSpec = {
    ...base,
    alpha: (m) => (step === 0 ? (m.site === SITE_FULL ? 1 : 0.5) : step === 1 ? (m.kind === "in" && m.ref === 0 ? 1 : 0.3) : 1),
    outline: (m, i) => {
      if (step === 0 && m.site === SITE_FULL) return 0.9;
      if (ol > 0 && b.B && b.B.tons[i]! > 0 && b.A.tons[i]! === 0) return ol;
      return 0;
    },
    price: bins && price ? (m) => (m.kind === "out" ? priceBin(bins[m.commodity]!.edges, price[m.end]![m.commodity]!) : -1) : undefined,
    priceMix: priceTw.value,
    squareKind: (f, isOpen) => (step === 0 && f === SITE_FULL && isOpen ? "full" : isOpen ? "open" : "closed"),
  };
  void dimTw;
  const R = cam.R * Math.sqrt(plan.demandTons / 2589781);
  const labels = siteLabels(net, b, cam.cx, cam.cy, R, { minCol: L.cls === "M" ? 36 : 0 });
  if (step === 0) {
    const units = siteUnits(net, plan.routesOut)[SITE_FULL] ?? 0;
    const capU = r4(net.sites[SITE_FULL]!.capacity_units * plan.params.capacity_scale);
    const x = cam.cx + ((b.colX0[SITE_FULL]! + b.colX1[SITE_FULL]!) / 2) * R;
    labels.push({ key: "full", text: `FULL · ${int(units)} OF ${int(capU)} UNITS`, x, y: cam.cy + 4 + 10 + 40, cls: "dock-caption" });
  }
  return { discs: [disc], glow: busy1 ? 0.4 : 1, glowKey: busy1 ? "t" : `${plan.id}|${step}`, busy: busy1 || busy2, labels, sig: `limits|${plan.id}|${step}|${tr.mix.toFixed(3)}|${priceTw.value.toFixed(3)}|${ol.toFixed(2)}|${W}x${H}` };
});
