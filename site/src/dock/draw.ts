/**
 * Cross-Dock painter (Canvas2D). One call draws one disc: volumetric bars lit from the dock outward (never flat
 * swatches, VISUAL_DESIGN criterion 21), hairline gaps instead of drawn separators, hatched slack, dock squares.
 * Gradients are cached per (cy, R) for the 6 commodity x half combinations; no gradient is built per bar.
 */
import { chord, hatchHeight, type Union } from "./layout";

export type Ctx = CanvasRenderingContext2D;
export const COMMODITY = ["#FF4C25", "#FFB26B", "#A8301A"] as const;
export const COMMODITY_NAME = ["PACKAGED GOODS", "COLD CHAIN", "BULKY GOODS"] as const;
const TINT = ["#FFB49A", "#FFE6C8", "#E8805E"] as const;
export const VIOLET = "#B48CFF";
const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

/** Luminance steps for the S03b demand-price layer: 5 bins of one commodity colour, dim to bright. */
export const PRICE_STEPS = [0.28, 0.45, 0.62, 0.8, 1] as const;

export interface Paint {
  u: Union;
  x0: ArrayLike<number>; x1: ArrayLike<number>;
  hatch: ArrayLike<number>; edge: ArrayLike<number>;
  /** per-site column extents (F + 1 entries, the last is UNSERVED) and tons, for the dock squares */
  colX0: ArrayLike<number>; colX1: ArrayLike<number>; colTons: ArrayLike<number>;
  cx: number; cy: number; R: number;
  /** open factor 0..1 per bar (a column opens from the dock) */
  open: (i: number) => number;
  /** per-bar opacity multiplier (dims), default 1 */
  alpha?: (i: number) => number;
  /** 1 = white 1px outline at 45% (hero, changed) */
  outline?: (i: number) => number;
  /** demand-price bin per bar (-1: commodity colour), blended with `priceMix` */
  price?: (i: number) => number;
  priceMix?: number;
  /** hatch fill progress 0..1 (the slack grows from the dock outward) */
  hatchFill?: number;
  seam: number;
  /** squares on the dock: open (filled), closed (hollow), full (orange), lost (struck) */
  squares: { x: number; kind: "open" | "closed" | "full" | "lost" | "over" }[];
  squareAlpha?: number;
  /** hide the bars that are not in this set (map unfold draws them itself) */
  skip?: (i: number) => boolean;
  dpr?: number;
}

const gradCache = new WeakMap<Ctx, Map<string, CanvasGradient>>();
function gradient(ctx: Ctx, half: 0 | 1, k: number, cy: number, R: number): CanvasGradient {
  let m = gradCache.get(ctx);
  if (!m) { m = new Map(); gradCache.set(ctx, m); }
  const key = `${half}${k}|${Math.round(cy * 2)}|${Math.round(R * 2)}`;
  let g = m.get(key);
  if (!g) {
    if (m.size > 64) m.clear();
    const y1 = half === 0 ? cy - R : cy + R;
    g = ctx.createLinearGradient(0, cy, 0, y1);
    const c = COMMODITY[k]!, t = TINT[k]!;
    g.addColorStop(0, rgba(t, 0.12));
    g.addColorStop(0.014, rgba(t, 1));
    g.addColorStop(0.09, rgba(c, 0.95));
    g.addColorStop(0.38, rgba(c, 0.58));
    g.addColorStop(0.72, rgba(c, 0.26));
    g.addColorStop(1, rgba(c, 0.1));
    m.set(key, g);
  }
  return g;
}

let hatchPattern: CanvasPattern | null = null;
let hatchWhite: CanvasPattern | null = null;
function patterns(ctx: Ctx) {
  if (hatchPattern && hatchWhite) return;
  const mk = (color: string) => {
    const c = document.createElement("canvas");
    c.width = 6; c.height = 6;
    const g = c.getContext("2d")!;
    g.strokeStyle = color; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(-1, 7); g.lineTo(7, -1); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(5, 7); g.lineTo(7, 5); g.stroke();
    return ctx.createPattern(c, "repeat")!;
  };
  hatchPattern = mk("#FF4C25");
  hatchWhite = mk("rgba(255,255,255,0.12)");
}

/** Bar region path: slot [x0, x1] (px) between the seam and the circle, half 0 above the dock, 1 below. */
function barPath(ctx: Ctx, half: 0 | 1, px0: number, px1: number, cx: number, cy: number, R: number, seam: number, o: number) {
  const sgn = half === 0 ? -1 : 1;
  const w = px1 - px0;
  const ya = cy + sgn * seam;
  const top = (px: number) => {
    const u = (px - cx) / R;
    const c = Math.sqrt(Math.max(0, 1 - u * u)) * R;
    return seam + (c - seam) * o;
  };
  ctx.moveTo(px0, ya);
  ctx.lineTo(px0, cy + sgn * Math.max(seam, top(px0)));
  if (w > 4) {
    const n = Math.min(24, Math.ceil(w / 6));
    for (let s = 1; s < n; s++) { const px = px0 + (w * s) / n; ctx.lineTo(px, cy + sgn * Math.max(seam, top(px))); }
  }
  ctx.lineTo(px1, cy + sgn * Math.max(seam, top(px1)));
  ctx.lineTo(px1, ya);
  ctx.closePath();
}

/** Draw one dock. Returns the number of bars painted (tests). */
export function drawDock(ctx: Ctx, P: Paint): number {
  const { cx, cy, R, seam, u } = P;
  patterns(ctx);
  const n = u.keys.length;
  let painted = 0;
  const A = P.alpha, O = P.outline;
  for (let i = 0; i < n; i++) {
    const x0 = P.x0[i]!, x1 = P.x1[i]!;
    if (x1 - x0 < 1e-9) continue;
    if (P.skip?.(i)) continue;
    const o = P.open(i);
    if (o <= 0) continue;
    const m = u.keys[i]!;
    const half = m.half;
    let px0 = cx + x0 * R, px1 = cx + x1 * R;
    const w = px1 - px0;
    // hairline absences of light between bars, never drawn lines: 0.25 px each side, 0.8 px at column edges
    const e = P.edge[i]!;
    const gl = Math.min(e & 2 ? 0.8 : 0.25, w * 0.2), gr = Math.min(e & 4 ? 0.8 : 0.25, w * 0.2);
    px0 += gl; px1 -= gr;
    if (px1 <= px0) continue;
    const a = A ? A(i) : 1;
    if (a <= 0.003) continue;
    const share = P.hatch[i]!;
    ctx.beginPath();
    barPath(ctx, half, px0, px1, cx, cy, R, seam, o);
    ctx.globalAlpha = a;
    if (m.kind === "un") {
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.fillStyle = hatchPattern!;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,76,37,0.9)"; ctx.lineWidth = 0.8;
      ctx.stroke();
    } else {
      const pb = P.price ? P.price(i) : -1;
      ctx.fillStyle = gradient(ctx, half, m.commodity, cy, R);
      ctx.fill();
      if (pb >= 0 && (P.priceMix ?? 0) > 0) {
        // price layer: the commodity colour steps through 5 luminance bins, replacing the dock gradient in place
        const mix = P.priceMix!;
        const c = COMMODITY[m.commodity]!, st = PRICE_STEPS[Math.min(4, pb)]!;
        const g = ctx.createLinearGradient(0, cy, 0, half === 0 ? cy - R : cy + R);
        g.addColorStop(0, rgba(TINT[m.commodity]!, 0.5 * st));
        g.addColorStop(0.014, rgba(TINT[m.commodity]!, st));
        g.addColorStop(0.09, rgba(c, st));
        g.addColorStop(1, rgba(c, st * 0.5));
        ctx.fillStyle = "#000"; ctx.globalAlpha = a * mix; ctx.fill();
        ctx.fillStyle = g; ctx.fill();
        ctx.globalAlpha = a;
      }
      if (share > 0.0005) {
        // slack: the rim-end share of the bar is not a flow; it is drawn as hatch on black, area-true
        const hh = hatchHeight(x0, x1, share * (P.hatchFill ?? 1)) * R;
        if (hh > 0) {
          ctx.save();
          ctx.clip();
          ctx.beginPath();
          if (half === 0) ctx.rect(px0 - 1, cy - R - 2, px1 - px0 + 2, R + 2 - hh);
          else ctx.rect(px0 - 1, cy + hh, px1 - px0 + 2, R + 2 - hh);
          ctx.fillStyle = "#000"; ctx.globalAlpha = a; ctx.fill();
          ctx.fillStyle = hatchPattern!; ctx.fill();
          ctx.restore();
        }
      }
    }
    if (O) {
      const ol = O(i);
      if (ol > 0) {
        ctx.beginPath();
        barPath(ctx, half, px0, px1, cx, cy, R, seam, o);
        ctx.strokeStyle = `rgba(255,255,255,${0.45 * ol * a})`; ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    painted++;
  }
  ctx.globalAlpha = 1;
  // dock squares
  const sa = P.squareAlpha ?? 1;
  if (sa > 0) {
    for (const s of P.squares) {
      const px = cx + s.x * R;
      ctx.globalAlpha = sa;
      if (s.kind === "closed" || s.kind === "lost") {
        ctx.strokeStyle = VIOLET; ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(px) - 2, cy - 2, 4, 4);
        if (s.kind === "lost") { ctx.beginPath(); ctx.moveTo(px - 3, cy + 3); ctx.lineTo(px + 3, cy - 3); ctx.stroke(); }
      } else {
        ctx.fillStyle = s.kind === "full" ? "#FF4C25" : VIOLET;
        ctx.fillRect(Math.round(px) - 2.5, cy - 2.5, 5, 5);
        if (s.kind === "over") { ctx.fillStyle = hatchPattern!; ctx.fillRect(Math.round(px) - 2.5, cy - 2.5, 5, 5); }
      }
    }
    ctx.globalAlpha = 1;
  }
  return painted;
}

/** The strict-infeasible disc: the area the demand would need, as a 45 degree white hatch at 12% with no edge line. */
export function drawNeededDisc(ctx: Ctx, cx: number, cy: number, R: number, seam: number, alpha: number) {
  patterns(ctx);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = hatchWhite!;
  ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  ctx.fillStyle = "#000";
  ctx.fillRect(cx - R, cy - seam, 2 * R, 2 * seam);
  ctx.restore();
}

export { chord };
