/** S00 intro "The Dock Opens" and S01 "Two decisions" (VISUAL_DESIGN 3.4, MOTION_SYSTEM 5.1). */
import { registerFrame, intro, introTime, INTRO_MS, debug, type DiscSpec, type Frame } from "./director";
import { easeSmooth, easeSymmetric } from "../motion/ease";
import { clamp } from "../lib/math";
import { windowed } from "../motion/progress";
import { camera, fallbackG1, roomOf, camOfRoom } from "./geometry";
import { pan } from "./pan";
import { scenarioPlan } from "../model/plans";
import { siteLabels } from "./labels";
import { blend } from "./director";
import type { Network } from "../model/types";
import type { Plan } from "../model/plan";

const T = { corners: 200, pkg: 300, line: 500, sites: 900, open: 1500, hero: 3300, glow: 3300, caption: 3500 };

export function heroKeys(net: Network, plan: Plan) {
  const h = plan.hero;
  if (!h) return null;
  const arc = net.out_arcs.site.findIndex((s, a) => s === h.site && net.out_arcs.demand[a] === h.node);
  return { site: h.site, inKey: `i${h.plant}_${h.site}_${h.commodity}`, outKey: `o${arc}_${h.commodity}` };
}
export const siteRank = (net: Network) => net.sites.map((s, f) => ({ f, lon: s.lon })).sort((a, b) => a.lon - b.lon || a.f - b.f).map((s) => s.f);

registerFrame("journey", ({ now, p, L, W, H, net, solutions }) => {
  const plan = scenarioPlan(net, solutions, "optimized");
  if (!plan) return null;
  const playing = intro.playing || intro.frozen >= 0;
  const t = playing ? introTime(now) : INTRO_MS;
  const hk = heroKeys(net, plan);
  const order = siteRank(net);
  const openSites = order.filter((f) => plan.open.includes(f));
  const heroRank = hk ? openSites.indexOf(hk.site) : 0;
  const maxD = Math.max(1, ...openSites.map((_, i) => Math.abs(i - heroRank)));
  const start = (f: number) => {
    const i = openSites.indexOf(f);
    return i < 0 ? 0 : T.open + (800 * Math.abs(i - heroRank)) / maxD;
  };
  const openOf = (f: number) => (playing ? easeSymmetric(clamp((t - start(f)) / 1000)) : 1);
  const e = easeSymmetric(windowed(p, 0, 0.4));
  const g1 = roomOf("journey:disc") ? camOfRoom(roomOf("journey:disc")!, 1) : fallbackG1(L);
  const panX = L.cls === "M" ? pan.value(now) * (1 - e) : 0;
  const cam = camera({ ...L.G0, cx: L.G0.cx + panX }, g1, e);
  const ordinal = new Map(openSites.map((f, i) => [f, i] as const));
  const disc: DiscSpec = {
    A: plan, mix: 0, cam,
    open: (col) => openOf(col),
    outline: (m) => (hk && (m.key === hk.inKey || m.key === hk.outKey) ? (playing ? easeSmooth(clamp((t - T.hero) / 200)) : 1) * (1 - e) : 0),
    squareKind: (f, isOpen) => (isOpen && (!playing || t >= T.sites + (ordinal.get(f) ?? 0) * 60) ? "open" : "closed"),
    squareAlpha: playing ? clamp((t - T.line) / 400) : 1,
  };
  const b = blend(net, disc);
  const R = cam.R * Math.sqrt(plan.demandTons / 2589781);
  const glow = playing ? easeSmooth(clamp((t - T.glow) / 400)) : 1;
  const labelA = (playing ? easeSmooth(clamp((t - T.hero) / 200)) : 1) * (1 - windowed(p, 0, 0.2));
  const labels = siteLabels(net, b, cam.cx, cam.cy, R, { alpha: labelA, minCol: L.cls === "M" ? 44 : 0 });
  // the hero package: one orange square on the dock at the hero's column; the caption names the path
  let pkg: { x: number; a: number; s: number } | null = null;
  if (hk) {
    const x = cam.cx + ((b.colX0[hk.site]! + b.colX1[hk.site]!) / 2) * R;
    const a = playing ? clamp((t - T.pkg) / 300) : 1;
    pkg = { x, a, s: 0.85 + 0.15 * a };
    const capA = (playing ? easeSmooth(clamp((t - T.caption) / 300)) : 1) * (1 - windowed(p, 0, 0.2));
    const h = plan.hero!;
    const text = `1 PACKAGE · ${net.plants[h.plant]!.short_name} → ${net.sites[h.site]!.short_name} → ${net.demand_nodes[h.node]!.short_name}`.toUpperCase();
    const w = text.length * 7.6 + 14;
    const fits = x + 16 + w < W - 8;
    labels.push({ key: "caption", text, x: fits ? x + 16 : Math.max(8, x - 16 - w), y: cam.cy - 8, align: "l", alpha: capA, cls: "dock-caption" });
  }
  // dock line: the seam shown once as a hairline at its full G0 length, then only an absence of light
  const hairA = playing ? 0.3 * clamp((t - T.line) / 400) * (1 - clamp((t - T.open) / 400)) : 0;
  const left = Math.max(0, cam.cx - R), right = Math.min(W, cam.cx + R);
  if (t >= T.line) {
    const len = right - left;
    if (e === 0) {
      intro.minLine = Math.min(intro.minLine, len);
      if (len < intro.lastLine - 1) intro.monotonic = false;
      intro.lastLine = len;
      intro.lineAt = intro.lineAt < 0 ? t : intro.lineAt;
    }
  }
  debug.line = [left, right];
  const size = L.cls === "D" ? 16 : 12;
  const frame: Frame = {
    discs: [disc], bloom: glow * (1 - e), glow: glow, labels,
    extra: (ctx) => {
      if (hairA > 0) { ctx.fillStyle = `rgba(255,230,200,${hairA})`; ctx.fillRect(left, cam.cy - 0.5, right - left, 1); }
      if (pkg) {
        const sz = (playing && t < T.pkg + 300 ? 18 * pkg.s : size) * 1;
        ctx.globalAlpha = pkg.a;
        ctx.fillStyle = "#FF4C25"; ctx.fillRect(pkg.x - sz / 2, cam.cy - sz / 2, sz, sz);
        ctx.strokeStyle = "#FFE6C8"; ctx.lineWidth = 1; ctx.strokeRect(pkg.x - sz / 2 + 0.5, cam.cy - sz / 2 + 0.5, sz - 1, sz - 1);
        ctx.globalAlpha = 1;
      }
    },
    busy: playing,
    glowKey: playing && t < T.glow + 400 ? `gl${Math.round(t / 40)}` : `rest|${e.toFixed(3)}`,
    sig: `journey|${t.toFixed(0)}|${p.toFixed(4)}|${panX.toFixed(1)}|${W}x${H}`,
  };
  return frame;
});
