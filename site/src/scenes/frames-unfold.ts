import { registerFrame, blend, seamHalf, type Frame } from "./director";
import { PlanTransition } from "./transition";
import { slotCam } from "./frames-shared";
import { roomOf } from "./geometry";
import { unfold } from "../state/scenes";
import { scenarioPlan } from "../model/plans";
import { stepState, windowed } from "../motion/progress";
import { DUR, easeSymmetric } from "../motion/ease";
import { drawMapBase, drawMapNodes, drawStrands, fitMap, pxPerTon, strands, N_PTS, type MapView, type StrandGeom } from "../map/unfold";
import { siteUnits } from "../model/plan";
import { r4 } from "../model/lp";
import { siteLabels } from "./labels";
import { currentClass } from "../graphics/canvas";
import { chord } from "../dock/layout";
import type { Network } from "../model/types";

export const UNFOLD_THRESH = [0.1, 0.7, 0.85];
const DESIGNS = ["legacy", "optimized", "legacy", "optimized"] as const;
const tr = new PlanTransition();
const unfoldPrev = { S: [] as StrandGeom[], plan: "" };
const landed = { at: -1, prev: null as Set<string> | null };
let st = 0, lastP = -1;
export const unfoldView = { t: 0, e: 0, strands: [] as StrandGeom[], view: null as MapView | null, plan: "", count: 0 };
/** FOLLOW ONE PACKAGE: the one place a package travels (interaction 9). */
export const follow = { active: false, start: 0, inKey: "", outKey: "", site: -1, plant: -1, city: -1, inMi: 0, outMi: 0, commodity: 0 };

export const unfoldT = (p: number) => easeSymmetric(windowed(p, 0.18, 0.55)) * (1 - easeSymmetric(windowed(p, 0.94, 1)));

registerFrame("unfold", ({ now, p, L, net, solutions, W, H }) => {
  if (p !== lastP) {
    lastP = p;
    const ns = stepState(st, p, UNFOLD_THRESH, 0.02);
    if (ns !== st) { st = ns; unfold.set({ design: DESIGNS[st]! }); }
  }
  const design = unfold.get().design;
  const plan = scenarioPlan(net, solutions, design);
  if (!plan) return null;
  const t = unfoldT(p);
  tr.set(plan, now, t < 0.01 ? DUR.scene : DUR.fast);
  const busy = tr.update(now);
  const A = tr.A ?? plan, B = tr.mix < 1 ? tr.B : null;
  const mapRoom = roomOf("unfold:map");
  const cam = slotCam("unfold:map", L, 0.95);
  const seam = seamHalf();
  unfold.set({ t });
  if (t < 0.002 || !mapRoom) {
    const b = blend(net, { A, B, mix: tr.mix, cam });
    const ol = tr.outline(now);
    const R = cam.R * Math.sqrt(plan.demandTons / 2589781);
    const f: Frame = {
      discs: [{ A, B, mix: tr.mix, cam, open: 1, outline: ol > 0 && b.B ? (_m, i) => (b.B!.tons[i]! > 0 && b.A.tons[i]! === 0 ? ol : 0) : undefined }],
      glow: busy ? 0.4 : 1, glowKey: busy ? "t" : plan.id, busy, labels: siteLabels(net, b, cam.cx, cam.cy, R, { minCol: L.cls === "M" ? 36 : 0 }),
      sig: `unfold|${plan.id}|${tr.mix.toFixed(3)}|${ol.toFixed(2)}|${W}x${H}`,
    };
    unfoldView.t = 0; unfoldView.e = 0;
    return f;
  }
  const cls = currentClass();
  const view = fitMap(net, mapRoom, 14);
  const cityA = windowed(p, 0.55, 0.62) * (1 - windowed(p, 0.94, 0.97));
  const ppt = pxPerTon(cls);
  const draws: { S: StrandGeom[]; alpha: number; plan: typeof plan }[] = [];
  const layers = t >= 0.999 && B ? [{ pl: A, al: 1 - tr.mix }, { pl: B, al: tr.mix }] : [{ pl: B ?? A, al: 1 }];
  for (const { pl, al } of layers) {
    const bl = blend(net, { A: pl, mix: 0, cam });
    const R = cam.R * Math.sqrt(pl.demandTons / 2589781);
    const S = strands({ net, u: bl.u, p: bl.A, x0: bl.x0, x1: bl.x1, cx: cam.cx, cy: cam.cy, R, seam, view, ppt });
    draws.push({ S, alpha: al, plan: pl });
  }
  const shown = (draws[draws.length - 1]!).plan;
  const e = t;
  const dockPos = new Map<number, [number, number]>();
  {
    const bl = blend(net, { A: shown, mix: 0, cam });
    const R = cam.R * Math.sqrt(shown.demandTons / 2589781);
    net.sites.forEach((_, f) => dockPos.set(f, [cam.cx + ((bl.colX0[f]! + bl.colX1[f]!) / 2) * R, cam.cy]));
  }
  const util = new Map<number, number>();
  const units = siteUnits(net, shown.routesOut);
  net.sites.forEach((s, f) => util.set(f, units[f]! / Math.max(1, r4(s.capacity_units))));
  const ol = tr.outline(now);
  unfoldView.t = t; unfoldView.e = e; unfoldView.view = view; unfoldView.strands = draws[draws.length - 1]!.S; unfoldView.plan = shown.id; unfoldView.count = unfoldView.strands.length;
  const openSet = new Set(shown.open);
  // lanes that exist in only one design keep a white outline for 2 s after the comparison lands
  const key = (s: StrandGeom) => `${s.kind}|${s.site}|${s.end}|${s.commodity}`;
  const prevKeys = new Set(unfoldPrev.S.map(key));
  const curKeys = new Set(draws[draws.length - 1]!.S.map(key));
  if (tr.mix >= 1 && unfoldPrev.plan && unfoldPrev.plan !== shown.id && landed.at < 0) { landed.at = now; landed.prev = prevKeys; }
  if (unfoldPrev.plan !== shown.id && tr.mix < 1) { landed.at = -1; }
  const changed = (s: StrandGeom) => (ol > 0 && landed.prev && !landed.prev.has(key(s)) ? ol : 0);
  void curKeys;
  const f: Frame = {
    discs: [],
    glow: 0,
    busy: busy || t < 1 || follow.active,
    sig: `unfoldmap|${shown.id}|${t.toFixed(4)}|${cityA.toFixed(3)}|${tr.mix.toFixed(3)}|${ol.toFixed(2)}|${follow.active ? Math.floor(now / 16) : 0}|${W}x${H}`,
    custom: (ctx) => {
      drawMapBase(ctx, net, view, cityA, { open: openSet, util, cls, e });
      for (const d of draws) drawStrands(ctx, d.S, e, d.alpha, { outline: changed });
      drawMapNodes(ctx, net, view, Math.max(cityA, e), { open: openSet, util, cls, dock: dockPos, e, plantsA: windowed(e, 0.5, 1) });
      if (follow.active) drawFollow(ctx, net, draws[draws.length - 1]!.S, now);
    },
  };
  if (unfoldPrev.plan !== shown.id && tr.mix >= 1) { unfoldPrev.S = draws[draws.length - 1]!.S; unfoldPrev.plan = shown.id; }
  void chord; void N_PTS;
  return f;
});

/** One orange 12px square runs the inbound strand, pauses at the site for 400 ms, runs the outbound strand, and stays at the city. */
function drawFollow(ctx: CanvasRenderingContext2D, net: Network, S: StrandGeom[], now: number) {
  void net;
  const inS = S.find((s) => s.kind === "in" && s.site === follow.site && s.end === follow.plant && s.commodity === follow.commodity);
  const outS = S.find((s) => s.kind === "out" && s.site === follow.site && s.end === follow.city && s.commodity === follow.commodity);
  if (!inS || !outS) return;
  const d1 = Math.max(300, (follow.inMi / 1000) * 1600), d2 = Math.max(300, (follow.outMi / 1000) * 1600);
  const t = now - follow.start;
  const at = (s: StrandGeom, u: number, reverse: boolean): [number, number] => {
    const f = Math.min(1, Math.max(0, u));
    const x = reverse ? 1 - f : f;
    const j = Math.min(N_PTS - 2, Math.floor(x * (N_PTS - 1))), r = x * (N_PTS - 1) - j;
    return [s.map[2 * j]! * (1 - r) + s.map[2 * j + 2]! * r, s.map[2 * j + 1]! * (1 - r) + s.map[2 * j + 3]! * r];
  };
  let pos: [number, number];
  if (t < d1) pos = at(inS, t / d1, true);
  else if (t < d1 + 400) pos = at(inS, 1, true);
  else if (t < d1 + 400 + d2) pos = at(outS, (t - d1 - 400) / d2, false);
  else pos = at(outS, 1, false);
  ctx.fillStyle = "#FF4C25"; ctx.strokeStyle = "#FFE6C8"; ctx.lineWidth = 1;
  ctx.fillRect(pos[0] - 6, pos[1] - 6, 12, 12); ctx.strokeRect(pos[0] - 5.5, pos[1] - 5.5, 11, 11);
}

/** Pointer picking on the map at rest: the strand under (x, y) in viewport px, or null. */
export function pickStrand(x: number, y: number): StrandGeom | null {
  if (unfoldView.e < 0.99) return null;
  let best: StrandGeom | null = null, bd = Infinity;
  for (const s of unfoldView.strands) {
    for (let j = 0; j < N_PTS - 1; j++) {
      const ax = s.map[2 * j]!, ay = s.map[2 * j + 1]!, bx = s.map[2 * j + 2]!, by = s.map[2 * j + 3]!;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      const d = Math.hypot(x - (ax + u * dx), y - (ay + u * dy)) - Math.max(1.5, s.wMap / 2);
      if (d < bd) { bd = d; best = s; }
    }
  }
  return bd <= 4 ? best : null;
}
