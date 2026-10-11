/**
 * Camera states (VISUAL_DESIGN 3.3). G0 (the giant opening and closing disc) is a table per composition class,
 * scaled so the disc stays >= 1.2 x the frame height (criterion 19). Every other state is the measured box of a
 * scene's own `.disc-slot` element (CSS decides the composition per class, so phone flow, compact desktop and the
 * 1280x720 short desktop need no second table); the table values below are only the fallback before the DOM exists.
 */
import { currentClass, viewportClass, type ViewportClass } from "../graphics/canvas";

export interface Cam { cx: number; cy: number; R: number }
export interface Layout { cls: ViewportClass; compact: boolean; W: number; H: number; G0: Cam; s: number }

/** D at 1024-1279 wide or up to 820 tall: the deliberate compact composition (QA L2), one query shared with the CSS. */
export const COMPACT_QUERY = "(min-width: 1024px) and (max-width: 1279px), (min-width: 1024px) and (max-height: 820px)";
export const isCompact = () => typeof matchMedia === "function" && matchMedia(COMPACT_QUERY).matches;

const REF = { D: [1440, 900], T: [768, 1024], M: [390, 844] } as const;
export function layout(vw: number, vh: number, force?: ViewportClass): Layout {
  const cls = force ?? (typeof matchMedia === "function" ? currentClass() : viewportClass(vw));
  const [W, H] = REF[cls];
  const s = Math.min(vw / W, vh / H);
  const ox = (vw - W * s) / 2, oy = (vh - H * s) / 2;
  const compact = cls === "D" && !force && isCompact();
  let G0: Cam;
  if (cls === "D" && compact) {
    // text column 48-420 on the left, the disc anchored right: diameter 1.24 x frame height
    G0 = { cx: vw - 120, cy: vh / 2, R: 0.62 * vh };
  } else if (cls === "D") {
    const sh = vh / H;
    G0 = { cx: vw - 540 * sh, cy: vh / 2, R: 580 * sh };
  } else if (cls === "T") {
    G0 = { cx: ox + 300 * s, cy: oy + 400 * s, R: 640 * s };
  } else {
    G0 = { cx: ox + 195 * s, cy: oy + 270 * s, R: 510 * s };
  }
  return { cls, compact, W: vw, H: vh, G0, s };
}

/** Fallback G1 (S01 end, S02 backdrop) when the scene's slot is not measured yet. */
export function fallbackG1(L: Layout): Cam {
  const { W, H, cls } = L;
  if (cls === "D") return L.compact ? { cx: W - 190, cy: H * 0.5, R: 0.3 * H } : { cx: W - 380 * (H / 900), cy: H * 0.5, R: 330 * (H / 900) };
  if (cls === "T") return { cx: W / 2, cy: H * 0.7, R: 260 * L.s };
  return { cx: W / 2, cy: H * 0.76, R: 180 * L.s };
}

/** Camera move between two states: centre linear, radius in log space (MOTION_SYSTEM 5.3). */
export function camera(a: Cam, b: Cam, t: number): Cam {
  return { cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t, R: Math.exp(Math.log(a.R) + (Math.log(b.R) - Math.log(a.R)) * t) };
}

// ------------------------------------------------------------------ measured slots (stage pixels)
export interface Room { x: number; y: number; w: number; h: number }
const rooms = new Map<string, Room>();
let roomsVer = 0;
const subs = new Set<() => void>();
export const roomsVersion = () => roomsVer;
export const subscribeRooms = (fn: () => void) => { subs.add(fn); return () => void subs.delete(fn); };
export function setRoom(key: string, r: Room | null) {
  const o = rooms.get(key);
  if (r ? o && Math.abs(o.x - r.x) < 0.5 && Math.abs(o.y - r.y) < 0.5 && Math.abs(o.w - r.w) < 0.5 && Math.abs(o.h - r.h) < 0.5 : !o) return;
  if (r) rooms.set(key, r); else rooms.delete(key);
  roomsVer++;
  subs.forEach((f) => f());
}
export const roomOf = (key: string) => rooms.get(key) ?? null;
/** The disc that fills a slot (R for the baseline tons); `fit` < 1 leaves air for the largest scenario disc. */
export const camOfRoom = (r: Room, fit = 1): Cam => ({ cx: r.x + r.w / 2, cy: r.y + r.h / 2, R: (Math.min(r.w, r.h) / 2) * fit });
