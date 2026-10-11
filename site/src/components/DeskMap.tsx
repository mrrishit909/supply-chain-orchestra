import { useEffect, useRef } from "react";
import { fitMap, pxPerTon, strands, drawStrands, drawMapBase, drawMapNodes, N_PTS, type StrandGeom } from "../map/unfold";
import { blend } from "../scenes/director";
import { fitCanvas, currentClass } from "../graphics/canvas";
import { siteUnits } from "../model/plan";
import { r4 } from "../model/lp";
import type { Plan } from "../model/plan";
import type { Network } from "../model/types";

export interface StrandPick { rk: "in" | "out"; site: number; end: number; commodity: number; tons: number }

/** The DESK's map: the same plan as the disc, drawn as ribbons (width = tons); hover lights a lane, a click selects it. */
export function DeskMap({ net, plan, dim, highlight, onPick, onHover, label }: {
  net: Network; plan: Plan; dim: boolean; highlight: ((s: { kind: string; site: number; end: number }) => number) | null;
  onPick: (p: StrandPick | null) => void; onHover: (p: StrandPick | null, x: number, y: number) => void; label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const geo = useRef<StrandGeom[]>([]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const paint = () => {
      if (!c.clientWidth || !c.clientHeight) return;
      const { ctx, width, height } = fitCanvas(c);
      ctx.clearRect(0, 0, width, height);
      const cls = currentClass();
      const view = fitMap(net, { x: 0, y: 0, w: width, h: height }, 12);
      ctx.globalAlpha = dim ? 0.6 : 1;
      const open = new Set(plan.open);
      const units = siteUnits(net, plan.routesOut);
      const util = new Map(net.sites.map((s, f) => [f, units[f]! / Math.max(1, r4(s.capacity_units * plan.params.capacity_scale))] as const));
      drawMapBase(ctx, net, view, 1, { open, util, cls, e: 1 });
      if (plan.status !== "Infeasible") {
        const cam = { cx: width / 2, cy: height / 2, R: 100 };
        const bl = blend(net, { A: plan, mix: 0, cam });
        const S = strands({ net, u: bl.u, p: bl.A, x0: bl.x0, x1: bl.x1, cx: cam.cx, cy: cam.cy, R: cam.R * Math.sqrt(plan.demandTons / 2589781), seam: 2, view, ppt: pxPerTon(cls) });
        geo.current = S;
        drawStrands(ctx, S, 1, 1, {});
        if (highlight) { /* highlight handled by dimming below */ }
      } else geo.current = [];
      drawMapNodes(ctx, net, view, 1, { open, util, cls, e: 1, plantsA: 1 });
      ctx.globalAlpha = 1;
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(c);
    return () => ro.disconnect();
  }, [net, plan, dim, highlight]);
  const pick = (clientX: number, clientY: number): StrandPick | null => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return null;
    const x = clientX - r.left, y = clientY - r.top;
    let best: StrandGeom | null = null, bd = Infinity;
    for (const s of geo.current) for (let j = 0; j < N_PTS - 1; j++) {
      const ax = s.map[2 * j]!, ay = s.map[2 * j + 1]!, bx = s.map[2 * j + 2]!, by = s.map[2 * j + 3]!;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      const d = Math.hypot(x - (ax + u * dx), y - (ay + u * dy)) - Math.max(1.5, s.wMap / 2);
      if (d < bd) { bd = d; best = s; }
    }
    return best && bd <= 4 ? { rk: best.kind as "in" | "out", site: best.site, end: best.end, commodity: best.commodity, tons: best.tons } : null;
  };
  return (
    <canvas ref={ref} className="still desk-map" role="img" aria-label={label}
      onPointerMove={(e) => onHover(pick(e.clientX, e.clientY), e.clientX, e.clientY)} onPointerLeave={() => onHover(null, 0, 0)} onClick={(e) => onPick(pick(e.clientX, e.clientY))} />
  );
}
