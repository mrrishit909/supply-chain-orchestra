import { useRef } from "react";
import { pan } from "../scenes/pan";
import { layout } from "../scenes/geometry";
import { useViewport } from "../scenes/useViewport";

/** Phone-only pan band over the dock plus two 44 px arrow squares at its ends (SVG icons: the arrows are not in the font subset). */
export function DockPan({ label, active = true }: { label: string; active?: boolean }) {
  const vp = useViewport();
  const start = useRef<{ x: number; v: number } | null>(null);
  if (vp.cls !== "M" || !active) return null;
  const L = layout(vp.w, vp.h);
  const R = L.G0.R, limit = R * 0.72;
  const top = L.G0.cy - 24;
  return (
    <>
      <div className="dock-pan" role="group" aria-label={label} style={{ top, height: 48 }}
        onPointerDown={(e) => { start.current = { x: e.clientX, v: pan.value(performance.now()) }; (e.target as Element).setPointerCapture?.(e.pointerId); }}
        onPointerMove={(e) => { if (start.current) pan.drag(start.current.v + (e.clientX - start.current.x), limit); }}
        onPointerUp={() => { start.current = null; }} onPointerCancel={() => { start.current = null; }} />
      {([-1, 1] as const).map((d) => (
        <button key={d} type="button" className={`pan-arrow pan-arrow--${d < 0 ? "l" : "r"}`} aria-label={d < 0 ? "Pan the dock west" : "Pan the dock east"} onClick={() => pan.nudge(d === -1 ? 1 : -1, R, limit)}>
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d={d < 0 ? "M8 1 L3 6 L8 11" : "M4 1 L9 6 L4 11"} fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
        </button>
      ))}
    </>
  );
}
