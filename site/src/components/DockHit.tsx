import { useState } from "react";
import { Tooltip } from "./Tooltip";
import { pickDock } from "../scenes/director";
import { openPick } from "../state/scenes";
import { COMMODITY_NAME } from "../dock/draw";
import { int } from "../model/format";
import type { Network } from "../model/types";

/**
 * Pointer layer over a dock slot (interaction 9): hover names the bar, a click opens the journey inspector. It covers the
 * disc slot only (never a control), keeps vertical pans native on touch, and is silent while a bar is moving.
 */
export function DockHit({ net, scene, label }: { net: Network; scene: string; label: string }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const probe = (x: number, y: number) => {
    const d = pickDock(x, y);
    if (!d || d.moving || d.meta.kind === "un") return null;
    const m = d.meta;
    const from = m.kind === "in" ? net.plants[m.ref]!.short_name : net.sites[m.site]!.short_name;
    const to = m.kind === "in" ? net.sites[m.site]!.short_name : net.demand_nodes[m.end]!.short_name;
    return { d, text: `${from} → ${to} · ${COMMODITY_NAME[m.commodity]} · ${int(d.tons)} T / YR`.toUpperCase() };
  };
  return (
    <>
      <div className="hit" role="img" aria-label={label}
        onPointerMove={(e) => { const r = probe(e.clientX, e.clientY); setTip(r ? { x: e.clientX, y: e.clientY, text: r.text } : null); }}
        onPointerLeave={() => setTip(null)}
        onClick={(e) => {
          const r = probe(e.clientX, e.clientY);
          if (!r) return;
          const m = r.d.meta;
          openPick(scene, m.kind === "in" ? { kind: "route", rk: "in", site: m.site, end: m.ref, commodity: m.commodity } : { kind: "route", rk: "out", site: m.site, end: m.end, commodity: m.commodity });
        }} />
      <Tooltip x={tip?.x ?? 0} y={tip?.y ?? 0} visible={!!tip}>{tip?.text}</Tooltip>
    </>
  );
}
