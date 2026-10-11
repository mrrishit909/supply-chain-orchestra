/**
 * Dock director: ONE fixed Canvas2D (plus two quarter-resolution glow canvases) carries the Cross-Dock through the
 * scenes. Each frame it locates the scene that owns the viewport, asks that scene's registered builder for a Frame
 * (discs, camera, open factors, labels), and redraws only when the frame's signature changed. Stepped parts (intro
 * clock, re-partitions) live in the builders; scrubbed parts are pure functions of progress.
 */
import { addFrame } from "../motion/loop";
import { DUR, easePremium, easeSymmetric } from "../motion/ease";
import { clamp } from "../lib/math";
import { locate } from "../scroll/engine";
import { motionEnabled } from "../state/motion";
import { getStore } from "../data/loader";
import { NETWORK, SOLUTIONS } from "../data/artifacts";
import { SCENES } from "../app/scenes";
import { drawDock, drawNeededDisc, type Paint } from "../dock/draw";
import { place, unionOf, BASE_TONS, type BarMeta, type Placed, type Union } from "../dock/layout";
import type { Plan } from "../model/plan";
import type { Network, Solutions } from "../model/types";
import { layout, type Cam, type Layout } from "./geometry";
import { scenarioPlan } from "../model/plans";

export const INTRO_MS = 4600;
const SCENE_IDS = SCENES.map((s) => s.id);

// ------------------------------------------------------------------ quality tiers (MOTION_SYSTEM 9.2)
export type Tier = "high" | "low";
const forced = (() => {
  const m = /[?&]quality=(low|high)/.exec(typeof location === "undefined" ? "" : location.search);
  return m ? (m[1] as Tier) : null;
})();
export const quality = { tier: (forced ?? "high") as Tier, forced: !!forced, median: 0, samples: [] as number[] };

// ------------------------------------------------------------------ S00 intro clock
export const intro = { playing: false, start: 0, completeFrom: -1, completeAt: 0, frozen: -1, minLine: Infinity, lastLine: 0, monotonic: true, lineAt: -1, hairline: 0 };
/** Intro clock in ms (0..4600). SKIP / Esc / scroll compress the remainder into 350ms. */
export function introTime(now: number) {
  if (intro.frozen >= 0) return intro.frozen;
  if (!intro.playing) return INTRO_MS;
  if (!intro.start) intro.start = now;
  const t = now - intro.start;
  if (intro.completeFrom < 0) return Math.min(INTRO_MS, t);
  const k = easePremium(clamp((now - intro.completeAt) / DUR.standard));
  return intro.completeFrom + (INTRO_MS - intro.completeFrom) * k;
}

// ------------------------------------------------------------------ frame description
export interface DiscSpec {
  A: Plan; B?: Plan | null; mix: number;
  /** camera: R is the radius of a disc of BASE_TONS; the disc's own tons scale it by sqrt (constant k) */
  cam: Cam;
  /** open factor: one number for every column, or per site index (F = UNSERVED) */
  open?: number | ((col: number, m: BarMeta) => number);
  alpha?: (m: BarMeta, i: number) => number;
  outline?: (m: BarMeta, i: number) => number;
  price?: (m: BarMeta, i: number) => number;
  priceMix?: number;
  hatchFill?: number;
  /** a strict-infeasible plan draws the area its demand would need, as a hatch */
  needed?: number;
  /** extra opacity on the whole disc */
  opacity?: number;
  /** dock squares: per site kind override */
  squareKind?: (f: number, open: boolean) => "open" | "closed" | "full" | "lost" | "over";
  squareAlpha?: number;
  /** show closed candidates as hollow squares (default true) */
  closedSquares?: boolean;
  /** which sites show an open square in this frame (default: tons > 0) */
  hairline?: number;
  /** R override in px (a disc whose radius is not derived from tons: nothing uses it today) */
  Rpx?: number;
}
export interface LabelSpec { key: string; text: string; x: number; y: number; align?: "c" | "l" | "r"; alpha?: number; cls?: string }
export interface Frame {
  discs: DiscSpec[];
  /** CSS opacity of the whole canvas (S02 backdrop 20%, S07 15%) */
  opacity?: number;
  bloom?: number;
  glow?: number;
  labels?: LabelSpec[];
  /** extra marks painted after the discs (CSS px) */
  extra?: (ctx: CanvasRenderingContext2D) => void;
  /** replaces the dock/disc painting entirely (map scenes) */
  custom?: (ctx: CanvasRenderingContext2D, env: { W: number; H: number }) => void;
  busy?: boolean;
  /** the glow canvases are redrawn only when this changes (default: sig); transitions pass a constant */
  glowKey?: string;
  sig: string;
}
export interface FrameEnv { now: number; p: number; L: Layout; W: number; H: number; net: Network; solutions: Solutions; after: number }
const registry = new Map<string, (env: FrameEnv) => Frame | null>();
export const registerFrame = (id: string, fn: (env: FrameEnv) => Frame | null) => void registry.set(id, fn);

// ------------------------------------------------------------------ debug (test + evidence hooks)
export const debug = {
  frames: 0, scene: "", sig: "",
  /** the discs drawn in the last frame, viewport px */
  discs: [] as { cx: number; cy: number; R: number; tons: number; open: number }[],
  /** DOM label boxes (CSS px) the director placed, for collision hooks */
  labels: [] as { name: string; x: number; y: number; w: number; h: number }[],
  /** per drawn disc: sums of the area rule (unit disc), for tests */
  areas: [] as { top: number; bottom: number; total: number; unmet: number; bars: number }[],
  dockLine: 0, line: [0, 0] as [number, number],
  tier: "high" as Tier,
};

// ------------------------------------------------------------------ renderer state
let main: HTMLCanvasElement | null = null, glowC: HTMLCanvasElement | null = null, bloomC: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null, gctx: CanvasRenderingContext2D | null = null, bctx: CanvasRenderingContext2D | null = null;
let W = 0, H = 0, DPR = 1;
let L: Layout | null = null;
let lastSig = "";
let glowSig = "";
let labelHost: HTMLElement | null = null;
const unions = new Map<string, Union>();
const placedCache = new WeakMap<Union, WeakMap<Plan, Placed>>();
let planIds = new WeakMap<Plan, number>();
let planSeq = 0;
const pid = (p: Plan) => { let i = planIds.get(p); if (!i) { i = ++planSeq; planIds.set(p, i); } return i; };

function unionFor(net: Network, A: Plan, B?: Plan | null) {
  const key = `${pid(A)}|${B ? pid(B) : 0}`;
  let u = unions.get(key);
  if (!u) { if (unions.size > 80) unions.clear(); u = unionOf(net, B ? [A, B] : [A]); unions.set(key, u); }
  return u;
}
function placedFor(net: Network, u: Union, p: Plan) {
  let m = placedCache.get(u);
  if (!m) { m = new WeakMap(); placedCache.set(u, m); }
  let pl = m.get(p);
  if (!pl) { pl = place(net, u, p); m.set(p, pl); }
  return pl;
}

export interface Blend { u: Union; A: Placed; B: Placed | null; x0: Float64Array; x1: Float64Array; hatch: Float64Array; edge: Uint8Array; colX0: Float64Array; colX1: Float64Array; colTons: Float64Array; total: number }
const blendBufs = new Map<Union, Blend>();
/** The slot edges of a disc spec: placement of A, or the keyed blend of A and B at `mix` (the same slot edges bar by bar). */
export function blend(net: Network, d: DiscSpec): Blend {
  const u = unionFor(net, d.A, d.B);
  const A = placedFor(net, u, d.A), B = d.B ? placedFor(net, u, d.B) : null;
  let b = blendBufs.get(u);
  if (!b) {
    if (blendBufs.size > 40) blendBufs.clear();
    const n = u.keys.length, F = u.F + 1;
    b = { u, A, B, x0: new Float64Array(n), x1: new Float64Array(n), hatch: new Float64Array(n), edge: new Uint8Array(n), colX0: new Float64Array(F), colX1: new Float64Array(F), colTons: new Float64Array(F), total: 0 };
    blendBufs.set(u, b);
  }
  b.A = A; b.B = B;
  const e = B ? d.mix : 0;
  const n = u.keys.length;
  if (!B || e <= 0) {
    b.x0.set(A.x0); b.x1.set(A.x1); b.hatch.set(A.hatch); b.edge.set(A.edge); b.colX0.set(A.colX0); b.colX1.set(A.colX1); b.colTons.set(A.colTons); b.total = A.total;
  } else if (e >= 1) {
    b.x0.set(B.x0); b.x1.set(B.x1); b.hatch.set(B.hatch); b.edge.set(B.edge); b.colX0.set(B.colX0); b.colX1.set(B.colX1); b.colTons.set(B.colTons); b.total = B.total;
  } else {
    for (let i = 0; i < n; i++) {
      b.x0[i] = A.x0[i]! + (B.x0[i]! - A.x0[i]!) * e;
      b.x1[i] = A.x1[i]! + (B.x1[i]! - A.x1[i]!) * e;
      b.hatch[i] = A.hatch[i]! + (B.hatch[i]! - A.hatch[i]!) * e;
      b.edge[i] = e < 0.5 ? A.edge[i]! : B.edge[i]!;
    }
    for (let f = 0; f < u.F + 1; f++) {
      b.colX0[f] = A.colX0[f]! + (B.colX0[f]! - A.colX0[f]!) * e;
      b.colX1[f] = A.colX1[f]! + (B.colX1[f]! - A.colX1[f]!) * e;
      b.colTons[f] = e < 0.5 ? A.colTons[f]! : B.colTons[f]!;
    }
    b.total = Math.exp(Math.log(Math.max(1, A.total)) + (Math.log(Math.max(1, B.total)) - Math.log(Math.max(1, A.total))) * e);
  }
  return b;
}

/** Radius of a spec's disc in px: camera R for the baseline tons, scaled by the (blended) plan's tons. */
export function discRadius(d: DiscSpec) {
  if (d.Rpx) return d.Rpx;
  const a = d.A.demandTons, t = d.B ? Math.exp(Math.log(a) + (Math.log(d.B.demandTons) - Math.log(a)) * d.mix) : a;
  return d.cam.R * Math.sqrt(t / BASE_TONS);
}

function resize() {
  if (!main) return;
  W = document.documentElement.clientWidth; H = innerHeight;
  const cap = quality.tier === "low" ? 1 : W < 1024 ? 1.5 : 2;
  DPR = Math.min(devicePixelRatio || 1, cap);
  main.width = Math.round(W * DPR); main.height = Math.round(H * DPR);
  main.style.width = `${W}px`; main.style.height = `${H}px`;
  ctx = main.getContext("2d");
  for (const [c, k] of [[glowC, 0.25], [bloomC, 0.25]] as const) {
    if (!c) continue;
    c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
    c.style.width = `${W}px`; c.style.height = `${H}px`;
  }
  gctx = glowC?.getContext("2d") ?? null;
  bctx = bloomC?.getContext("2d") ?? null;
  L = layout(W, H);
  lastSig = ""; glowSig = "";
}

const SEAM = () => (W < 768 ? 3 : 4) / 2;
export const seamHalf = () => SEAM();

function paintOf(d: DiscSpec, b: Blend, R: number, now: number): Paint {
  const F = b.u.F;
  const open = d.open ?? 1;
  const colOpen = (site: number, m: BarMeta) => (typeof open === "function" ? open(site < 0 ? F : site, m) : open);
  const squares: Paint["squares"] = [];
  for (let f = 0; f < F; f++) {
    const x = (b.colX0[f]! + b.colX1[f]!) / 2;
    const isOpen = b.colTons[f]! > 0;
    if (!isOpen && d.closedSquares === false) continue;
    const kind = d.squareKind ? d.squareKind(f, isOpen) : isOpen ? "open" : "closed";
    squares.push({ x, kind });
  }
  void now;
  const keys = b.u.keys;
  return {
    u: b.u, x0: b.x0, x1: b.x1, hatch: b.hatch, edge: b.edge, colX0: b.colX0, colX1: b.colX1, colTons: b.colTons,
    cx: d.cam.cx, cy: d.cam.cy, R, seam: SEAM(),
    open: (i) => colOpen(keys[i]!.site, keys[i]!),
    alpha: d.alpha ? (i) => d.alpha!(keys[i]!, i) * (d.opacity ?? 1) : d.opacity !== undefined ? () => d.opacity! : undefined,
    outline: d.outline ? (i) => d.outline!(keys[i]!, i) : undefined,
    price: d.price ? (i) => d.price!(keys[i]!, i) : undefined,
    priceMix: d.priceMix, hatchFill: d.hatchFill, squares, squareAlpha: (d.squareAlpha ?? 1) * (d.opacity ?? 1),
  };
}

/** Paint one disc spec into any context (the live canvas and the reduced-motion stills share this). */
export function renderDisc(c: CanvasRenderingContext2D, net: Network, d: DiscSpec, now = 0, seam = SEAM()) {
  const b = blend(net, d);
  const R = discRadius(d);
  const paint = { ...paintOf(d, b, R, now), seam };
  if (d.needed && d.needed > 0) drawNeededDisc(c, d.cam.cx, d.cam.cy, R, seam, d.needed);
  const n = drawDock(c, paint);
  return { b, R, paint, n };
}

// ------------------------------------------------------------------ DOM labels (pooled spans over the canvas)
const pool: HTMLElement[] = [];
function placeLabels(list: LabelSpec[]) {
  if (!labelHost) return;
  debug.labels = [];
  for (let i = 0; i < list.length; i++) {
    let el = pool[i];
    if (!el) { el = document.createElement("span"); el.className = "dock-label"; labelHost.appendChild(el); pool[i] = el; }
    const l = list[i]!;
    if (el.textContent !== l.text) el.textContent = l.text;
    const cls = `dock-label ${l.cls ?? ""}`;
    if (el.className !== cls) el.className = cls;
    const tx = l.align === "l" ? 0 : l.align === "r" ? -100 : -50;
    el.style.transform = `translate(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px) translateX(${tx}%)`;
    el.style.opacity = String(l.alpha ?? 1);
    el.hidden = false;
    const w = el.offsetWidth, h = el.offsetHeight;
    const x0 = l.align === "l" ? l.x : l.align === "r" ? l.x - w : l.x - w / 2;
    if ((l.alpha ?? 1) > 0.3) debug.labels.push({ name: l.text, x: x0, y: l.y, w, h });
  }
  for (let i = list.length; i < pool.length; i++) pool[i]!.hidden = true;
}

let tmpC: HTMLCanvasElement | null = null;
function glowTmp(w: number, h: number) {
  if (!tmpC) tmpC = document.createElement("canvas");
  if (tmpC.width !== w || tmpC.height !== h) { tmpC.width = w; tmpC.height = h; }
  return tmpC;
}

// ------------------------------------------------------------------ the loop
let lastFrameAt = 0, frames60 = 0;
function tick(now: number) {
  if (!main || !ctx || !L) return;
  if (document.documentElement.clientWidth !== W || innerHeight !== H) resize();
  if (!motionEnabled()) return; // reduced motion draws each scene's own stills
  const ns = getStore(NETWORK).state, ss = getStore(SOLUTIONS).state;
  if (ns.status !== "ready" || ss.status !== "ready") return;
  const net = ns.data, solutions = ss.data;
  const loc = locate(SCENE_IDS);
  if (!loc) return;
  const build = registry.get(loc.id);
  const p = loc.p;
  const frame = build ? build({ now, p, L, W, H, net, solutions, after: loc.after }) : null;
  debug.scene = loc.id;
  if (!frame) { if (lastSig !== "none") { ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H); main.style.opacity = "0"; lastSig = "none"; } placeLabels([]); return; }
  // frame pacing tier: median of the first 60 frames after the intro
  if (!quality.forced && !intro.playing && quality.samples.length < 60 && lastFrameAt) {
    quality.samples.push(now - lastFrameAt);
    if (quality.samples.length === 60) {
      const s = [...quality.samples].sort((a, b) => a - b);
      quality.median = s[30]!;
      if (quality.median > (W < 768 ? 40 : 22)) { quality.tier = "low"; resize(); }
    }
  }
  lastFrameAt = now;
  debug.tier = quality.tier;
  const sig = `${frame.sig}|${W}x${H}|${frame.opacity ?? 1}`;
  if (sig === lastSig && !frame.busy) return;
  lastSig = sig;
  frames60++;
  debug.frames++;
  debug.sig = frame.sig;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  main.style.opacity = String(frame.opacity ?? 1);
  debug.discs = []; debug.areas = [];
  const paints: { d: DiscSpec; b: Blend; R: number; paint: Paint }[] = [];
  if (frame.custom) frame.custom(ctx, { W, H });
  for (const d of frame.discs) {
    const { b, R, paint, n } = renderDisc(ctx, net, d, now);
    paints.push({ d, b, R, paint });
    let top = 0, bottom = 0;
    b.u.keys.forEach((m, i) => { const a = (b.x1[i]! - b.x0[i]!); if (a > 0) { if (m.half === 0) top++; else bottom++; } });
    void top; void bottom;
    debug.discs.push({ cx: d.cam.cx, cy: d.cam.cy, R, tons: b.total, open: typeof d.open === "number" ? d.open : 1 });
    debug.areas.push({ top: 0, bottom: 0, total: b.total, unmet: b.colTons[b.u.F]!, bars: n });
  }
  frame.extra?.(ctx);
  // glow canvases: drawn once per settle (never per transition frame), quarter resolution
  const gl = frame.glow ?? 0, bl = frame.bloom ?? 0;
  if (glowC) glowC.style.opacity = quality.tier === "low" ? "0" : String(gl * 0.75 * (frame.opacity ?? 1));
  if (bloomC) bloomC.style.opacity = quality.tier === "low" ? "0" : String(bl * 0.2);
  if ((gl > 0 || bl > 0) && quality.tier === "high" && gctx && bctx) {
    const gs = `${frame.glowKey ?? frame.sig}|${W}|${H}`;
    if (gs !== glowSig) {
      glowSig = gs;
      gctx.setTransform(1, 0, 0, 1, 0, 0); gctx.clearRect(0, 0, glowC!.width, glowC!.height);
      bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.clearRect(0, 0, bloomC!.width, bloomC!.height);
      for (const { paint, R } of paints) {
        const band = 0.16 * R;
        gctx.save();
        gctx.setTransform(0.25, 0, 0, 0.25, 0, 0);
        // seam glow: the bars near the seam, faded out by 16% of R with a vertical mask (no visible clip edge)
        const layer = glowTmp(glowC!.width, glowC!.height);
        const lc = layer.getContext("2d")!;
        lc.setTransform(1, 0, 0, 1, 0, 0); lc.clearRect(0, 0, layer.width, layer.height);
        lc.setTransform(0.25, 0, 0, 0.25, 0, 0);
        drawDock(lc, { ...paint, squares: [] });
        lc.setTransform(0.25, 0, 0, 0.25, 0, 0);
        lc.globalCompositeOperation = "destination-in";
        const mg = lc.createLinearGradient(0, paint.cy - band, 0, paint.cy + band);
        mg.addColorStop(0, "rgba(0,0,0,0)"); mg.addColorStop(0.5, "rgba(0,0,0,1)"); mg.addColorStop(1, "rgba(0,0,0,0)");
        lc.fillStyle = mg; lc.fillRect(0, paint.cy - band, W, 2 * band);
        lc.globalCompositeOperation = "source-over";
        gctx.setTransform(1, 0, 0, 1, 0, 0);
        gctx.drawImage(layer, 0, 0);
        gctx.restore();
        if (bl > 0) {
          bctx.save();
          bctx.setTransform(0.25, 0, 0, 0.25, 0, 0);
          drawDock(bctx, { ...paint, squares: [] });
          bctx.restore();
        }
      }
    }
  }
  placeLabels(frame.labels ?? []);
}

export function startDirector(c: { main: HTMLCanvasElement; glow: HTMLCanvasElement; bloom: HTMLCanvasElement; labels: HTMLElement }) {
  main = c.main; glowC = c.glow; bloomC = c.bloom; labelHost = c.labels;
  resize();
  addFrame(tick, 100);
  addEventListener("resize", resize);
  return () => removeEventListener("resize", resize);
}

export const currentLayout = () => L;
export const stageSize = () => ({ W, H });
export { scenarioPlan, easeSymmetric };
