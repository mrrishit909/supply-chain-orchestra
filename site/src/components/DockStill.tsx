import { useEffect, useRef, useState } from "react";
import { renderDisc, type DiscSpec } from "../scenes/director";
import { useLatest } from "../scroll/hooks";
import { fitCanvas } from "../graphics/canvas";
import { BASE_TONS } from "../dock/layout";
import { siteLabels } from "../scenes/labels";
import { blend } from "../scenes/director";
import type { Network } from "../model/types";
import type { LabelSpec } from "../scenes/director";

/**
 * A static dock (reduced-motion frames, MOTION_SYSTEM 8; THE DESK's disc): its own canvas, sized to its CSS box, painted by
 * the same renderer as the live stage. `refTons` fixes the scale across a set of stills (one k for the whole set).
 */
export function DockStill({ net, spec, refTons, fit = 0.94, labels = true, className = "", label, extra }: {
  net: Network; spec: Omit<DiscSpec, "cam">; refTons?: number; fit?: number; labels?: boolean; className?: string; label: string;
  extra?: (ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number) => LabelSpec[] | void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const specRef = useLatest(spec);
  const extraRef = useLatest(extra);
  const [marks, setMarks] = useState<LabelSpec[]>([]);
  const key = `${spec.A.id}|${spec.B?.id ?? ""}|${spec.mix}|${spec.A.objective ?? ""}|${spec.A.open.join(",")}|${refTons ?? 0}|${spec.hatchFill ?? 1}|${spec.priceMix ?? 0}`;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const paint = () => {
      if (!c.clientWidth || !c.clientHeight) return;
      const { ctx, width, height } = fitCanvas(c);
      ctx.clearRect(0, 0, width, height);
      const sp = specRef.current;
      const cx = width / 2, cy = height / 2;
      const base = (Math.min(width, height) / 2) * fit;
      const maxTons = refTons ?? sp.A.demandTons;
      const R0 = base / Math.sqrt(maxTons / BASE_TONS);
      const d: DiscSpec = { ...sp, cam: { cx, cy, R: R0 } };
      const { R, b } = renderDisc(ctx, net, d, 0, width < 400 ? 1.5 : 2);
      const out: LabelSpec[] = [];
      if (labels) out.push(...siteLabels(net, blend(net, d), cx, cy, R, { minCol: width < 400 ? 40 : 0, gap: 6 }));
      const ex = extraRef.current?.(ctx, cx, cy, R);
      if (ex) out.push(...ex);
      void b;
      setMarks(out);
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(c);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, net, fit, labels]);
  return (
    <div className={`still-wrap ${className}`}>
      <canvas ref={ref} className="still" role="img" aria-label={label} />
      {marks.map((m) => (
        <span key={m.key} className={`dock-label ${m.cls ?? ""}`} style={{ transform: `translate(${m.x}px, ${m.y}px) translateX(${m.align === "l" ? 0 : m.align === "r" ? -100 : -50}%)`, opacity: m.alpha ?? 1 }}>{m.text}</span>
      ))}
    </div>
  );
}
