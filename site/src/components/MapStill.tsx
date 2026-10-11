import { useEffect, useRef } from "react";
import { fitMap, pxPerTon, strands, drawStrands, drawMapBase, drawMapNodes } from "../map/unfold";
import { blend } from "../scenes/director";
import { fitCanvas } from "../graphics/canvas";
import { siteUnits } from "../model/plan";
import { r4 } from "../model/lp";
import type { Plan } from "../model/plan";
import type { Network } from "../model/types";
import { currentClass } from "../graphics/canvas";

/** A static frame of the unfold (reduced motion, MOTION_SYSTEM 8): t = 0 dock, 0.5 mid-flight, 1 the map. */
export function MapStill({ net, plan, t, label, className = "" }: { net: Network; plan: Plan; t: number; label: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const paint = () => {
      if (!c.clientWidth || !c.clientHeight) return;
      const { ctx, width, height } = fitCanvas(c);
      ctx.clearRect(0, 0, width, height);
      const cls = currentClass();
      const view = fitMap(net, { x: 0, y: 0, w: width, h: height }, 10);
      const cam = { cx: width / 2, cy: height / 2, R: (Math.min(width, height) / 2) * 0.94 };
      const bl = blend(net, { A: plan, mix: 0, cam });
      const R = cam.R * Math.sqrt(plan.demandTons / 2589781);
      const S = strands({ net, u: bl.u, p: bl.A, x0: bl.x0, x1: bl.x1, cx: cam.cx, cy: cam.cy, R, seam: 2, view, ppt: pxPerTon(cls) });
      const units = siteUnits(net, plan.routesOut);
      const util = new Map(net.sites.map((s, f) => [f, units[f]! / Math.max(1, r4(s.capacity_units))] as const));
      const open = new Set(plan.open);
      const dock = new Map(net.sites.map((_, f) => [f, [cam.cx + ((bl.colX0[f]! + bl.colX1[f]!) / 2) * R, cam.cy] as [number, number]] as const));
      drawMapBase(ctx, net, view, t >= 1 ? 1 : 0, { open, util, cls, e: t });
      drawStrands(ctx, S, t, 1);
      drawMapNodes(ctx, net, view, Math.max(t >= 1 ? 1 : 0, t), { open, util, cls, dock, e: t, plantsA: t >= 0.5 ? 1 : 0 });
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(c);
    return () => ro.disconnect();
  }, [net, plan, t]);
  return <canvas ref={ref} className={`still ${className}`} role="img" aria-label={label} />;
}
