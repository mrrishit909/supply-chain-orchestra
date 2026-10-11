/**
 * The map and the unfold (VISUAL_DESIGN "The map", MOTION_SYSTEM 5.7). Every dock bar has a 25 point centreline: in the
 * dock it is the vertical through its slot centre from the seam to the chord end; on the map it is the lane's
 * great-circle path, site end first, offset sideways for its commodity strand. P_i(t) = mix(dock_i, map_i, e(t)) and
 * the width goes from slot width to strand width, so the same parameter drives the camera and the flight.
 */
import { albers, greatCircle } from "./project";
import { chord, type Placed, type Union } from "../dock/layout";
import { COMMODITY } from "../dock/draw";
import type { Network } from "../model/types";

export const N_PTS = 25;
export interface MapView { x: number; y: number; w: number; h: number; s: number; ox: number; oy: number; x0: number; y1: number }

/** Fit the network's projected bounding box into a rect (equal scale, centred). */
export function fitMap(net: Network, rect: { x: number; y: number; w: number; h: number }, pad = 14): MapView {
  const pts = [...net.demand_nodes, ...net.sites, ...net.plants];
  const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
  const s = Math.min((rect.w - 2 * pad) / (x1 - x0), (rect.h - 2 * pad) / (y1 - y0));
  const ox = rect.x + (rect.w - (x1 - x0) * s) / 2, oy = rect.y + (rect.h - (y1 - y0) * s) / 2;
  return { ...rect, s, ox, oy, x0, y1 };
}
export const toPx = (v: MapView, x: number, y: number): [number, number] => [v.ox + (x - v.x0) * v.s, v.oy + (v.y1 - y) * v.s];
/** Strand scale (px per t/yr): D 1px per 20,000 t, T 1 per 26,000, M 1 per 40,000 (VISUAL_DESIGN "The map"). */
export const pxPerTon = (cls: "D" | "T" | "M") => 1 / (cls === "D" ? 20000 : cls === "T" ? 26000 : 40000);

// lane paths in projected unit coordinates, site end first (cached per network)
const laneCache = new WeakMap<Network, Map<string, [number, number][]>>();
export function lanePath(net: Network, kind: "in" | "out", site: number, end: number): [number, number][] {
  let m = laneCache.get(net);
  if (!m) { m = new Map(); laneCache.set(net, m); }
  const key = `${kind}${site}_${end}`;
  let p = m.get(key);
  if (!p) {
    const proj = albers(net);
    const s = net.sites[site]!;
    const o = kind === "in" ? net.plants[end]! : net.demand_nodes[end]!;
    const g = greatCircle([s.lat, s.lon], [o.lat, o.lon], N_PTS - 1);
    p = g.map(([la, lo]) => proj(la, lo));
    m.set(key, p);
  }
  return p;
}

export interface StrandGeom {
  /** index into the union */
  i: number;
  kind: "in" | "out" | "un"; site: number; end: number; commodity: number; tons: number;
  dock: Float32Array; map: Float32Array; wDock: number; wMap: number;
  /** half 0 = above the dock */
  half: 0 | 1;
}

export interface UnfoldInput {
  net: Network; u: Union; p: Placed; x0: ArrayLike<number>; x1: ArrayLike<number>;
  cx: number; cy: number; R: number; seam: number; view: MapView; ppt: number;
}

/** Strand geometry of every bar of a placement at its (blended) slots; map side offsets lane strands side by side. */
export function strands(g: UnfoldInput): StrandGeom[] {
  const { net, u, p, view } = g;
  // lane totals for sideways offsets (commodity order within a lane)
  const lane = new Map<string, number>();
  for (let i = 0; i < u.keys.length; i++) {
    const m = u.keys[i]!;
    if (m.kind === "un" || p.tons[i]! <= 0) continue;
    const key = `${m.kind}|${m.site}|${m.end}`;
    lane.set(key, (lane.get(key) ?? 0) + p.tons[i]! * g.ppt);
  }
  const cum = new Map<string, number>();
  const out: StrandGeom[] = [];
  for (let i = 0; i < u.keys.length; i++) {
    const m = u.keys[i]!;
    const tons = p.tons[i]!;
    if (tons <= 0 || m.kind === "un") continue;
    const x0 = g.x0[i]!, x1 = g.x1[i]!;
    const xc = (x0 + x1) / 2;
    const sgn = m.half === 0 ? -1 : 1;
    const dock = new Float32Array(N_PTS * 2);
    const yEnd = chord(xc) * g.R;
    for (let j = 0; j < N_PTS; j++) {
      dock[2 * j] = g.cx + xc * g.R;
      dock[2 * j + 1] = g.cy + sgn * (g.seam + ((yEnd - g.seam) * j) / (N_PTS - 1));
    }
    const path = lanePath(net, m.kind as "in" | "out", m.site, m.end);
    const key = `${m.kind}|${m.site}|${m.end}`;
    const w = tons * g.ppt;
    const before = cum.get(key) ?? 0;
    cum.set(key, before + w);
    const off = before + w / 2 - (lane.get(key) ?? w) / 2;
    const map = new Float32Array(N_PTS * 2);
    const a = toPx(view, path[0]![0], path[0]![1]), b = toPx(view, path[N_PTS - 1]![0], path[N_PTS - 1]![1]);
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    // "left of the direction of travel": inbound travels plant to site (reverse of the path), outbound site to city
    const dir = m.kind === "in" ? -1 : 1;
    const nx = (-dy / len) * dir, ny = (dx / len) * dir;
    for (let j = 0; j < N_PTS; j++) {
      const q = toPx(view, path[j]![0], path[j]![1]);
      map[2 * j] = q[0] + nx * off;
      map[2 * j + 1] = q[1] + ny * off;
    }
    out.push({ i, kind: m.kind, site: m.site, end: m.end, commodity: m.commodity, tons, dock, map, wDock: Math.max(0, (x1 - x0) * g.R), wMap: w, half: m.half });
  }
  return out;
}

const hex = (c: string, a: number) => {
  const n = parseInt(c.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const TINT = ["#FFB49A", "#FFE6C8", "#E8805E"];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Draw the strands at unfold parameter e (0 dock, 1 map); `alpha` multiplies everything (map comparison crossfades). */
export function drawStrands(ctx: CanvasRenderingContext2D, S: StrandGeom[], e: number, alpha: number, opts: { dim?: (s: StrandGeom) => number; outline?: (s: StrandGeom) => number } = {}) {
  ctx.lineCap = "butt"; ctx.lineJoin = "round";
  for (const s of S) {
    const a = alpha * (opts.dim ? opts.dim(s) : 1);
    if (a <= 0.003) continue;
    const w = lerp(s.wDock, s.wMap, e);
    // a strand under 0.6 px is drawn 0.6 px wide at proportionally less opacity (area stays true)
    const wd = Math.max(0.6, w), al = w < 0.6 ? a * (w / 0.6) : a;
    ctx.beginPath();
    const X = (j: number) => lerp(s.dock[2 * j]!, s.map[2 * j]!, e), Y = (j: number) => lerp(s.dock[2 * j + 1]!, s.map[2 * j + 1]!, e);
    ctx.moveTo(X(0), Y(0));
    for (let j = 1; j < N_PTS; j++) ctx.lineTo(X(j), Y(j));
    const col = COMMODITY[s.commodity]!, tint = TINT[s.commodity]!;
    const g = ctx.createLinearGradient(X(0), Y(0), X(N_PTS - 1), Y(N_PTS - 1));
    const a0 = s.kind === "in" ? 1 : lerp(1, 0.45, e), a2 = s.kind === "in" ? lerp(0.1, 0.45, e) : lerp(0.1, 1, e);
    g.addColorStop(0, hex(e < 0.5 ? tint : col, a0));
    g.addColorStop(0.5, hex(col, lerp(0.5, 0.72, e)));
    g.addColorStop(1, hex(col, a2));
    ctx.strokeStyle = g;
    ctx.globalAlpha = al;
    ctx.lineWidth = wd;
    ctx.stroke();
    const ol = opts.outline?.(s) ?? 0;
    if (ol > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * ol})`; ctx.lineWidth = wd + 2; ctx.globalAlpha = a * 0.6;
      ctx.globalCompositeOperation = "destination-over";
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    }
  }
  ctx.globalAlpha = 1;
}

/** Cities (white, area ~ population), candidate arcs (violet 25%), closed sites, sites, plants. `a` is the fade-in. */
export function drawMapBase(ctx: CanvasRenderingContext2D, net: Network, view: MapView, a: number, opts: { open: Set<number>; util: Map<number, number>; cls: "D" | "T" | "M"; e: number; fromSites?: Map<number, [number, number]> }) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  // candidate arcs: every demand node to its 5 nearest sites (the options the solver chose from)
  const oa = net.out_arcs;
  ctx.strokeStyle = "rgba(180,140,255,0.25)"; ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let k = 0; k < oa.site.length; k++) {
    const path = lanePath(net, "out", oa.site[k]!, oa.demand[k]!);
    for (let j = 0; j < path.length; j += 2) {
      const [x, y] = toPx(view, path[j]![0], path[j]![1]);
      if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    const [lx, ly] = toPx(view, path[N_PTS - 1]![0], path[N_PTS - 1]![1]);
    ctx.lineTo(lx, ly);
  }
  ctx.stroke();
  const k = opts.cls === "D" ? 1 : opts.cls === "T" ? 0.85 : 0.7;
  ctx.fillStyle = "#fff";
  for (const n of net.demand_nodes) {
    const [x, y] = toPx(view, n.x, n.y);
    ctx.beginPath(); ctx.arc(x, y, (0.9 + 3.2 * Math.sqrt(n.pop2025 / 8.6e6)) * k, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export function drawMapNodes(ctx: CanvasRenderingContext2D, net: Network, view: MapView, a: number, opts: { open: Set<number>; util: Map<number, number>; cls: "D" | "T" | "M"; dock?: Map<number, [number, number]>; e: number; plantsA: number; fullSite?: number | null }) {
  const cap = Math.max(...net.sites.map((s) => s.capacity_units));
  const k = opts.cls === "D" ? 1 : opts.cls === "T" ? 0.85 : 0.7;
  ctx.save();
  net.sites.forEach((s, f) => {
    const [mx, my] = toPx(view, s.x, s.y);
    const d = opts.dock?.get(f);
    const x = d ? lerp(d[0], mx, opts.e) : mx, y = d ? lerp(d[1], my, opts.e) : my;
    const side = (6 + 14 * Math.sqrt(s.capacity_units / cap)) * k;
    const open = opts.open.has(f);
    ctx.globalAlpha = open ? Math.max(a, d ? 1 : 0) : a * 0.35;
    if (open && d && opts.e < 1) { /* open sites fly from the dock */ }
    ctx.strokeStyle = "#B48CFF"; ctx.lineWidth = 1.2;
    ctx.fillStyle = "#000";
    ctx.fillRect(x - side / 2, y - side / 2, side, side);
    if (open) {
      const u = Math.min(1, opts.util.get(f) ?? 0);
      ctx.fillStyle = "#FF4C25";
      const h = side * u;
      ctx.globalAlpha = Math.max(a, d ? 1 : 0) * Math.min(1, opts.e * 2);
      ctx.fillRect(x - side / 2 + 1, y + side / 2 - h, side - 2, Math.max(0, h - 1));
      ctx.globalAlpha = Math.max(a, d ? 1 : 0);
    }
    ctx.strokeRect(x - side / 2, y - side / 2, side, side);
  });
  ctx.globalAlpha = a * opts.plantsA;
  ctx.strokeStyle = "#B48CFF"; ctx.fillStyle = "#000"; ctx.lineWidth = 1.2;
  for (const p of net.plants) {
    const [x, y] = toPx(view, p.x, p.y);
    const r = 9 * k;
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
