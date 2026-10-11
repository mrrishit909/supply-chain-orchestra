import { useEffect, useRef } from "react";
import { setRoom } from "./geometry";

/**
 * The box the stage canvas draws a disc (or map) into: CSS places it per composition class, this reports its box in
 * stage pixels as `<scene>:<name>`. Renders nothing visible; `display: none` clears the room.
 */
export function Slot({ scene, name = "disc", className = "" }: { scene: string; name?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const key = `${scene}:${name}`;
    const stage = el.closest(".stage") as HTMLElement | null;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (!stage || r.height < 1 || getComputedStyle(el).display === "none") return setRoom(key, null);
      const s = stage.getBoundingClientRect();
      setRoom(key, { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height });
    };
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    const watch = () => { ro?.observe(el); if (el.parentElement) { ro?.observe(el.parentElement); for (const c of el.parentElement.children) ro?.observe(c); } };
    watch();
    const mo = el.parentElement && typeof MutationObserver === "function" ? new MutationObserver(() => { watch(); measure(); }) : null;
    if (el.parentElement) mo?.observe(el.parentElement, { childList: true });
    addEventListener("resize", measure);
    document.fonts?.ready.then(measure);
    return () => { ro?.disconnect(); mo?.disconnect(); removeEventListener("resize", measure); setRoom(key, null); };
  }, [scene, name]);
  return <div ref={ref} className={`disc-slot disc-slot--${name} ${className}`} aria-hidden="true" data-slot={`${scene}:${name}`} />;
}
