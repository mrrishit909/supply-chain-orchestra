import { useRef, useState, useSyncExternalStore } from "react";
import { Track } from "../scroll/Track";
import { HonestyChip } from "../components/HonestyChip";
import { Radio } from "../components/Radio";
import { SceneErrors } from "../components/StateUI";
import { Tooltip } from "../components/Tooltip";
import { Inspector } from "../components/Inspector";
import { MapStill } from "../components/MapStill";
import { CORE_SPECS, useCore } from "./data";
import { Slot } from "./Slot";
import { inspector, openPick, unfold } from "../state/scenes";
import { useMotion, useProgress } from "../scroll/hooks";
import { fact, sourceWord, statusWord } from "../data/copy";
import { fixed, int, musd } from "../model/format";
import { scenarioPlan } from "../model/plans";
import { pickStrand, unfoldView, follow } from "./frames-unfold";
import { pickDock } from "./director";
import { COMMODITY_NAME } from "../dock/draw";
import { jumpTo } from "../scroll/engine";
import { useViewport } from "./useViewport";
import type { ArtifactSpec } from "../data/loader";
import type { SceneDef } from "../app/scenes";

export function S04Unfold({ def }: { def: SceneDef }) {
  const core = useCore();
  const st = useSyncExternalStore(unfold.subscribe, unfold.get);
  useSyncExternalStore(inspector.subscribe, inspector.get);
  const motion = useMotion();
  const [verdict, setVerdict] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const hit = useRef<HTMLDivElement>(null);
  const vp = useViewport();
  useProgress(def.id, (p) => { setVerdict((o) => (o === p >= 0.92 ? o : p >= 0.92)); });
  const net = core?.net;
  const leg = core && net ? scenarioPlan(net, core.sol, "legacy") : null;
  const opt = core && net ? scenarioPlan(net, core.sol, "optimized") : null;
  const plan = st.design === "legacy" ? leg : opt;
  const e = unfoldView.e;
  const unit = st.t > 0.5 ? "WIDTH = TONS · GREAT-CIRCLE x 1.2 · NOT ROADS" : "AREA = TONS";
  const text = (m: { rk: "in" | "out"; site: number; end: number; commodity: number; tons: number }) => {
    const from = m.rk === "in" ? net!.plants[m.end]!.short_name : net!.sites[m.site]!.short_name;
    const to = m.rk === "in" ? net!.sites[m.site]!.short_name : net!.demand_nodes[m.end]!.short_name;
    return `${from} → ${to} · ${COMMODITY_NAME[m.commodity]} · ${int(m.tons)} T / YR`.toUpperCase();
  };
  const probe = (cx: number, cy: number) => {
    if (!net || !hit.current) return null;
    if (e >= 0.99) {
      const s = pickStrand(cx, cy);
      return s ? { rk: s.kind as "in" | "out", site: s.site, end: s.end, commodity: s.commodity, tons: s.tons } : null;
    }
    if (st.t < 0.002) {
      const d = pickDock(cx, cy);
      if (!d || d.moving || d.meta.kind === "un") return null;
      return d.meta.kind === "in" ? { rk: "in" as const, site: d.meta.site, end: d.meta.ref, commodity: d.meta.commodity, tons: d.tons } : { rk: "out" as const, site: d.meta.site, end: d.meta.end, commodity: d.meta.commodity, tons: d.tons };
    }
    return null;
  };
  const sorted = unfoldView.strands.slice().sort((a, b) => b.tons - a.tons);
  const kidx = useRef(0);
  return (
    <Track id={def.id} height={def.track} landing={def.landing} className={`scene scene--grid scene-${def.id}`} label="Unfold: the dock becomes a map">
      <SceneErrors id={def.id} specs={CORE_SPECS as ArtifactSpec<unknown>[]} />
      <div className="slot-wrap">
        <Slot scene={def.id} name="map" />
        <div ref={hit} className="hit" role="application" tabIndex={0} aria-label="Map of lanes. Left and Right move between lanes, Enter opens the lane inspector."
          onPointerMove={(ev) => {
            const m = probe(ev.clientX, ev.clientY);
            setTip(m ? { x: ev.clientX, y: ev.clientY, text: text(m) } : null);
          }}
          onPointerLeave={() => setTip(null)}
          onClick={(ev) => { const m = probe(ev.clientX, ev.clientY); if (m) openPick(def.id, { kind: "route", ...m }); }}
          onKeyDown={(ev) => {
            if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
              ev.preventDefault();
              kidx.current = Math.max(0, Math.min(sorted.length - 1, kidx.current + (ev.key === "ArrowRight" ? 1 : -1)));
              const s = sorted[kidx.current];
              if (s) { const r = hit.current!.getBoundingClientRect(); setTip({ x: r.left + 20, y: r.top + 20, text: text({ rk: s.kind as "in" | "out", site: s.site, end: s.end, commodity: s.commodity, tons: s.tons }) }); }
            } else if (ev.key === "Enter") {
              const s = sorted[kidx.current];
              if (s) openPick(def.id, { kind: "route", rk: s.kind as "in" | "out", site: s.site, end: s.end, commodity: s.commodity });
            } else if (ev.key === "Escape") setTip(null);
          }} />
      </div>
      <Tooltip x={tip?.x ?? 0} y={tip?.y ?? 0} visible={!!tip} id="map-tip">{tip?.text}</Tooltip>
      <div className="scene-text">
        <p className="scene-kicker">LEGACY TO OPTIMIZED · THE SAME CITIES, THE SAME FREIGHT</p>
        <h2 id={`${def.id}-title`} tabIndex={-1} data-scene-heading className="scene-statement">{def.title}</h2>
      </div>
      <div className="scene-panel">
        {core && leg && opt && plan ? (
          <>
            <Radio label="DESIGN" value={st.design} options={["legacy", "optimized"] as const} render={(v) => v.toUpperCase()} onChange={(v) => unfold.set({ design: v })} asSelect={vp.cls === "M"} />
            <p className="readout-line tnum" data-ledger>
              {st.design === "legacy"
                ? `LEGACY · ${leg.open.length} SITES · ${musd(leg.objective ?? 0)} M USD / YR`
                : `OPTIMIZED · ${opt.open.length} SITES · ${musd(opt.objective ?? 0)} M · SAVES ${musd(fact(core.facts, "saving_vs_legacy_usd"))} M (${fixed(fact(core.facts, "saving_vs_legacy_pct"), 2)}%)`}
            </p>
            <p className="readout-line readout-line--derived tnum">
              IN {fixed(fact(core.facts, "haul_in_mi_legacy"), 0)} → {fixed(fact(core.facts, "haul_in_mi_optimized"), 0)} MI · OUT {fixed(fact(core.facts, "haul_out_mi_legacy"), 0)} → {fixed(fact(core.facts, "haul_out_mi_optimized"), 0)} MI · TONS-WEIGHTED, GREAT-CIRCLE x 1.2
            </p>
            <p className="readout-line readout-line--muted">{statusWord(plan)} · {sourceWord(plan)}</p>
            <p className="enc-label" data-enc>{unit}</p>
            <div className="sites-tags"><HonestyChip tag="SIMULATED" detail="FLOWS" /><HonestyChip tag="SYNTHETIC" detail="COSTS" /><HonestyChip tag="DERIVED" detail="HAULS" /></div>
            {verdict || !motion ? (
              <div className="verdict">
                <p className="verdict__t">Two more sites, shorter trips, {fixed(fact(core.facts, "saving_vs_legacy_pct"), 2)}% less.</p>
                <p className="readout-line readout-line--muted">THE SAVING IS A PROPERTY OF SYNTHETIC COSTS, NOT A FORECAST.</p>
              </div>
            ) : null}
            <details className="data-table">
              <summary className="text-btn">→ DATA TABLE FOR THIS DESIGN</summary>
              <div className="data-table__scroll">
                <table>
                  <thead><tr><th>FROM</th><th>TO</th><th>COMMODITY</th><th>TONS / YR</th><th>MILES</th></tr></thead>
                  <tbody>
                    {plan.routesIn.map(([p, f, k, t], i) => <tr key={`i${i}`}><td>{core.net.plants[p]!.short_name}</td><td>{core.net.sites[f]!.short_name}</td><td>{COMMODITY_NAME[k]}</td><td>{int(t)}</td><td>{fixed(core.net.in_road_mi[p]![f]!, 1)}</td></tr>)}
                    {plan.routesOut.map(([a, k, t], i) => <tr key={`o${i}`}><td>{core.net.sites[core.net.out_arcs.site[a]!]!.short_name}</td><td>{core.net.demand_nodes[core.net.out_arcs.demand[a]!]!.short_name}</td><td>{COMMODITY_NAME[k]}</td><td>{int(t)}</td><td>{fixed(core.net.out_arcs.road_mi[a]!, 1)}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </details>
            {follow.active ? <button type="button" className="btn-square" onClick={() => { follow.active = false; }}>STOP THE PACKAGE · SPEED IS NOT TRANSIT TIME: THE MODEL HAS NO TIME</button> : null}
            {!motion && net ? (
              <div className="strip" aria-label="Three frames of the unfold: dock, mid-flight, map">
                {[0, 0.5, 1].map((t) => <MapStill key={t} net={net} plan={opt} t={t} label={`Unfold frame at ${t}`} className="strip__still" />)}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {core && net ? <Inspector scene={def.id} net={net} plan={plan} pub={core.sol.scenarios.find((s) => s.id === st.design)} canFollow /> : null}
      <button type="button" className="sr-only" onClick={() => jumpTo(def.id, 0.62)}>Jump to the map</button>
    </Track>
  );
}
