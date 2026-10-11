/** S07 backdrop and S08 "Every product, again": the opening's own choreography at constant G0 size (MOTION_SYSTEM 5.13). */
import { registerFrame, intro, type DiscSpec } from "./director";
import { camera } from "./geometry";
import { G1, slotCam } from "./frames-shared";
import { easeSmooth, easeSymmetric } from "../motion/ease";
import { clamp } from "../lib/math";
import { windowed } from "../motion/progress";
import { scenarioPlan } from "../model/plans";
import { deskResult } from "../state/scenes";
import { siteLabels } from "./labels";
import { blend } from "./director";
import { heroKeys, siteRank } from "./frames-journey";
import { pan } from "./pan";

registerFrame("evidence", ({ p, L, net, solutions, W, H }) => {
  const plan = scenarioPlan(net, solutions, "optimized");
  if (!plan) return null;
  const e = easeSymmetric(windowed(p, 0, 0.08));
  const cam = camera(slotCam("sites:disc", L, 0.96, G1(L)), G1(L), e);
  return { discs: [{ A: plan, mix: 0, cam, open: 1, squareAlpha: 0.5 }], opacity: 0.15 + 0.1 * (1 - e), glow: 0.4, sig: `evidence|${e.toFixed(3)}|${W}x${H}` };
});

const echo = { at: -1, armed: true };
const CLOSE_MS = 1200, HOLD = 300, OPEN_MS = 1000;
export const echoState = () => ({ ...echo });

registerFrame("closing", ({ now, p, L, net, solutions, W, H }) => {
  const mine = deskResult.get().plan;
  const plan = mine && mine.status !== "Infeasible" && mine.routesOut.length ? mine : scenarioPlan(net, solutions, "optimized");
  if (!plan) return null;
  const e = easeSymmetric(windowed(p, 0, 0.35));
  const panX = L.cls === "M" ? pan.value(now) * e : 0;
  const cam = camera(slotCam("sites:disc", L, 0.96, G1(L)), { ...L.G0, cx: L.G0.cx + panX }, e);
  if (p >= 0.7 && echo.armed) { echo.at = now; echo.armed = false; }
  if (p < 0.68) { echo.armed = true; echo.at = -1; }
  const t = echo.at < 0 ? -1 : now - echo.at;
  const order = siteRank(net).filter((f) => plan.open.includes(f));
  const hk = plan.hero ? heroKeys(net, plan) : null;
  const heroRank = hk ? order.indexOf(hk.site) : 0;
  const maxD = Math.max(1, ...order.map((_, i) => Math.abs(i - heroRank)));
  let open = (col: number) => { void col; return 1; };
  let busy = false;
  if (t >= 0) {
    const closeEnd = CLOSE_MS, openStart = CLOSE_MS + HOLD;
    open = (col) => {
      if (t < closeEnd) return 1 - easeSymmetric(clamp(t / CLOSE_MS));
      if (t < openStart) return 0;
      const i = order.indexOf(col);
      const start = openStart + (i < 0 ? 0 : (700 * Math.abs(i - heroRank)) / maxD);
      return easeSymmetric(clamp((t - start) / OPEN_MS));
    };
    busy = t < openStart + 700 + OPEN_MS + 100;
  }
  const disc: DiscSpec = {
    A: plan, mix: 0, cam, open,
    outline: (m) => (hk && (m.key === hk.inKey || m.key === hk.outKey) ? 1 * e : 0),
  };
  const b = blend(net, disc);
  const R = cam.R * Math.sqrt(plan.demandTons / 2589781);
  const glow = (t >= 0 && busy ? easeSmooth(clamp((t - 2400) / 400)) : 1) * e;
  const labels = e >= 0.99 && (!busy || t > 2400) ? siteLabels(net, b, cam.cx, cam.cy, R, { minCol: L.cls === "M" ? 44 : 0 }) : [];
  void intro;
  const pkgX = hk ? cam.cx + ((b.colX0[hk.site]! + b.colX1[hk.site]!) / 2) * R : 0;
  const size = L.cls === "D" ? 16 : 12;
  const extra = hk && e > 0.5 ? (ctx: CanvasRenderingContext2D) => {
    ctx.globalAlpha = e;
    ctx.fillStyle = "#FF4C25"; ctx.fillRect(pkgX - size / 2, cam.cy - size / 2, size, size);
    ctx.strokeStyle = "#FFE6C8"; ctx.lineWidth = 1; ctx.strokeRect(pkgX - size / 2 + 0.5, cam.cy - size / 2 + 0.5, size - 1, size - 1);
    ctx.globalAlpha = 1;
  } : undefined;
  return { discs: [disc], bloom: glow, glow, labels, busy, extra, glowKey: busy ? `t${Math.round(t / 50)}` : `rest|${e.toFixed(3)}|${plan.id}`, sig: `closing|${p.toFixed(4)}|${t < 0 ? "x" : Math.floor(t / 16)}|${plan.id}|${panX.toFixed(1)}|${W}x${H}` };
});
