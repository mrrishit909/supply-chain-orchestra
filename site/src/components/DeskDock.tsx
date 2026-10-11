import { useEffect, useRef } from "react";
import { addFrame } from "../motion/loop";
import { PlanTransition } from "../scenes/transition";
import { blend, discRadius, renderDisc, type DiscSpec, type DockPick, type Blend } from "../scenes/director";
import { drawNeededDisc } from "../dock/draw";
import { fitCanvas } from "../graphics/canvas";
import { siteLabels } from "../scenes/labels";
import { DUR } from "../motion/ease";
import { BASE_TONS } from "../dock/layout";
import { useLatest } from "../scroll/hooks";
import { useState } from "react";
import type { LabelSpec } from "../scenes/director";
import type { Network } from "../model/types";
import type { Plan } from "../model/plan";

/** THE DESK's disc: its own in-flow canvas (not the stage canvas), same painter, keyed re-partition (800 ms) on every new plan. */
export function DeskDock({ net, plan, dim, refTons, highlight, hlKey, onPick, onHover, label }: {
  net: Network; plan: Plan; dim: boolean; refTons: number; hlKey: string;
  highlight: ((m: { site: number; end: number; kind: string }) => number) | null;
  onPick: (p: DockPick | null) => void; onHover: (p: DockPick | null, x: number, y: number) => void; label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tr = useRef(new PlanTransition());
  const last = useRef<{ b: Blend; cam: { cx: number; cy: number; R: number }; R: number; plan: Plan; mixed: boolean } | null>(null);
  const props = useLatest({ plan, dim, highlight, net, refTons, hlKey });
  const [labels, setLabels] = useState<LabelSpec[]>([]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let sig = "";
    const off = addFrame((now) => {
      const { plan: pl, dim: dm, highlight: hl, net: n, refTons: rt, hlKey: hk } = props.current;
      if (!c.clientWidth || !c.clientHeight) return;
      tr.current.set(pl, now, DUR.card);
      const busy = tr.current.update(now);
      const s = `${pl.id}|${pl.objective}|${tr.current.mix.toFixed(3)}|${dm}|${c.clientWidth}x${c.clientHeight}|${hk}`;
      if (!busy && s === sig) return;
      sig = s;
      const { ctx, width, height } = fitCanvas(c);
      ctx.clearRect(0, 0, width, height);
      const cx = width / 2, cy = height / 2;
      const base = (Math.min(width, height) / 2) * 0.94;
      const cam = { cx, cy, R: base / Math.sqrt(rt / BASE_TONS) };
      const A = tr.current.A ?? pl, B = tr.current.mix < 1 ? tr.current.B : null;
      const infeasible = pl.status === "Infeasible";
      const spec: DiscSpec = {
        A: infeasible && !B ? { ...pl } : A, B, mix: tr.current.mix, cam, open: infeasible ? 0 : 1, opacity: dm ? 0.6 : 1, needed: infeasible ? 1 : 0,
        alpha: hl ? (m) => hl(m) : undefined,
      };
      if (infeasible) {
        const R = cam.R * Math.sqrt(pl.demandTons / BASE_TONS);
        drawNeededDisc(ctx, cx, cy, R, width < 400 ? 1.5 : 2, 1);
        last.current = null;
        setLabels([]);
        return;
      }
      const { b, R } = renderDisc(ctx, n, spec, now, width < 400 ? 1.5 : 2);
      last.current = { b, cam, R, plan: pl, mixed: !!B };
      if (!busy) setLabels(siteLabels(n, b, cx, cy, R, { minCol: width < 400 ? 40 : 0, gap: 6 }));
      void discRadius; void blend;
    }, 110);
    return off;
  }, [props]);
  const pickAt = (clientX: number, clientY: number): DockPick | null => {
    const c = ref.current, l = last.current;
    if (!c || !l) return null;
    const r = c.getBoundingClientRect();
    const px = clientX - r.left, py = clientY - r.top;
    const x = (px - l.cam.cx) / l.R, y = (py - l.cam.cy) / l.R;
    if (Math.abs(x) >= 1 || Math.abs(y) < 0.004 || Math.abs(y) > Math.sqrt(1 - x * x)) return null;
    const half = y < 0 ? 0 : 1;
    const u = l.b.u;
    for (let i = 0; i < u.keys.length; i++) {
      const m = u.keys[i]!;
      if (m.half !== half || x < l.b.x0[i]! || x >= l.b.x1[i]!) continue;
      const tons = l.b.A.tons[i]!;
      if (tons > 0) return { meta: m, tons, disc: 0, plan: l.plan, moving: l.mixed };
    }
    return null;
  };
  return (
    <div className="desk-dock">
      <canvas ref={ref} className="still desk-canvas" role="img" aria-label={label} tabIndex={0}
        onPointerMove={(e) => onHover(pickAt(e.clientX, e.clientY), e.clientX, e.clientY)} onPointerLeave={() => onHover(null, 0, 0)}
        onClick={(e) => onPick(pickAt(e.clientX, e.clientY))}
        onKeyDown={(e) => { if (e.key === "Escape") onPick(null); }} />
      {labels.map((m) => (
        <span key={m.key} className="dock-label" style={{ transform: `translate(${m.x}px, ${m.y}px) translateX(-50%)` }}>{m.text}</span>
      ))}
    </div>
  );
}
