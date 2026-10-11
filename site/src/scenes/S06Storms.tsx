import { useSyncExternalStore, type KeyboardEvent } from "react";
import { Track } from "../scroll/Track";
import { HonestyChip } from "../components/HonestyChip";
import { Radio } from "../components/Radio";
import { ArtifactStatus, SceneErrors } from "../components/StateUI";
import { DockStill } from "../components/DockStill";
import { useArtifact } from "../data/useArtifact";
import { useNear } from "../scroll/useNear";
import { CORE_SPECS, ROBUSTNESS, useCore } from "./data";
import { Slot } from "./Slot";
import { storms } from "../state/scenes";
import { jumpTo } from "../scroll/engine";
import { useMotion } from "../scroll/hooks";
import { drawOrder, drawPlan, fullService, lostPlan, tail, tallies } from "../model/storms";
import { orderOf, posAt, maxTons } from "./frames-storms";
import { fixed, int, musd } from "../model/format";
import { fact } from "../data/copy";
import { useViewport } from "./useViewport";
import type { ArtifactSpec } from "../data/loader";
import type { SceneDef } from "../app/scenes";
import type { Robustness } from "../model/types";

const pForPos = (pos: number) => 0.05 + (0.65 * (pos + 0.5)) / 500;

export function S06Storms({ def }: { def: SceneDef }) {
  const core = useCore();
  const near = useNear(def.id);
  const [rs, retry] = useArtifact(ROBUSTNESS, near);
  const st = useSyncExternalStore(storms.subscribe, storms.get);
  const motion = useMotion();
  const vp = useViewport();
  const net = core?.net;
  const rb = rs.status === "ready" ? rs.data : null;
  const go = (pos: number) => {
    const q = Math.max(0, Math.min(499, pos));
    jumpTo(def.id, pForPos(q));
    storms.set({ draw: q, phase: "scrub", lost: null });
  };
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : e.key === "PageUp" ? 10 : e.key === "PageDown" ? -10 : 0;
    if (d) { e.preventDefault(); go(st.draw + d); }
  };
  const order = rb ? orderOf(rb, st.order) : [];
  const idx = order[Math.min(order.length - 1, st.draw)] ?? 0;
  const tal = rb ? tallies(rb, order, st.draw) : null;
  const line = rb && net ? drawLine(rb, net, idx) : "";
  const sum = rb?.summary;
  const optSites = rb?.designs.find((d) => d.id === "optimized")?.open_sites ?? [];
  const cap = (d: "legacy" | "optimized") => rb ? `SERVICE ${fixed(rb.results[d].service_level[idx]! , 4)} · COST ${musd(rb.results[d].cost_usd[idx]!)} M · WITH LOST SALES ${musd(rb.results[d].adjusted_cost_usd[idx]!)} M` : "";
  const crit = rb && st.lost !== null ? rb.site_criticality.find((c) => c.site === st.lost) : null;
  return (
    <Track id={def.id} height={def.track} landing={def.landing} className={`scene scene--grid scene--storms scene-${def.id}`} label="Storms: five hundred seeded draws">
      <SceneErrors id={def.id} specs={[...CORE_SPECS, ROBUSTNESS] as ArtifactSpec<unknown>[]} />
      <div className="storm-discs">
        <div className="storm-disc"><div className="slot-wrap"><Slot scene={def.id} name="a" /></div><p className="readout-line tnum storm-cap">LEGACY · {core ? "6" : ""} SITES</p></div>
        <div className="storm-disc"><div className="slot-wrap"><Slot scene={def.id} name="b" /></div><p className="readout-line tnum storm-cap">OPTIMIZED · {optSites.length} SITES{st.lost !== null && net ? ` · WITHOUT ${net.sites[st.lost]!.short_name.toUpperCase()}` : ""}</p></div>
      </div>
      <div className="scene-text">
        <p className="scene-kicker">500 SEEDED DRAWS · SEED {rb?.config.seed ?? "20261012"} · THE SAME STORMS FOR BOTH</p>
        <h2 id={`${def.id}-title`} tabIndex={-1} data-scene-heading className="scene-statement">{def.title}</h2>
      </div>
      <div className="scene-panel">
        <ArtifactStatus file="robustness.json" state={rs} retry={retry} empty="NO DRAWS PUBLISHED">
          {() => rb && net && core ? (
            <>
              <p className="readout-line tnum" aria-live="polite">{st.phase === "tail" ? `THE WORST 25 OF 500 DRAWS FOR EACH DESIGN (CVAR95)` : line}</p>
              {st.phase === "tail" && sum ? (
                <p className="readout-line tnum">CVAR95: LEGACY {musd(sum.legacy.adjusted_cost.cvar95, 0)} M · OPTIMIZED {musd(sum.optimized.adjusted_cost.cvar95, 0)} M USD / YR (WITH LOST SALES)</p>
              ) : (
                <>
                  <p className="readout-line tnum">LEGACY: {cap("legacy")}</p>
                  <p className="readout-line tnum">OPTIMIZED: {cap("optimized")}</p>
                </>
              )}
              {tal ? <p className="readout-line tnum">FULL SERVICE SO FAR: LEGACY {tal.legacy} · OPTIMIZED {tal.optimized} OF {st.draw + 1} DRAWS <span className="compact-hide">(ALL 500: {fact(core.facts, "mc_full_service_legacy")} AND {fact(core.facts, "mc_full_service_optimized")})</span></p> : null}
              <div className="storm-ctl">
                <div className="stepper" role="group" aria-label="Draw">
                  <span className="stepper__label">DRAW {st.draw + 1} OF 500 · NUMBER {idx + 1}</span>
                  <div className="stepper__row">
                    <button type="button" className="btn-square stepper__btn" aria-label="Previous draw" onClick={() => go(st.draw - 1)}>−</button>
                    <input className="stepper__field tnum" type="number" min={1} max={500} value={st.draw + 1} aria-label="Draw number" onChange={(e) => go(Number(e.target.value) - 1)} onKeyDown={onKey} />
                    <button type="button" className="btn-square stepper__btn" aria-label="Next draw" onClick={() => go(st.draw + 1)}>+</button>
                    <button type="button" className="btn-square" onClick={() => { storms.set({ order: "legacy_cost", lost: null }); go(0); }}>RESET</button>
                  </div>
                </div>
                <Radio label="ORDER" value={st.order} options={["legacy_cost", "index"] as const} render={(v) => (v === "index" ? "BY DRAW NUMBER" : "BY LEGACY COST")} onChange={(v) => storms.set({ order: v })} asSelect={vp.cls === "M"} />
                <label className="seg-ctl seg-ctl--select">
                  <span className="seg-ctl__label">LOSE ONE SITE</span>
                  <select value={st.lost ?? ""} onChange={(e) => storms.set({ lost: e.target.value === "" ? null : Number(e.target.value) })}>
                    <option value="">NONE: THE DRAW STANDS</option>
                    {optSites.map((f) => <option key={f} value={f}>{net.sites[f]!.short_name.toUpperCase()}</option>)}
                  </select>
                </label>
                {crit ? <p className="readout-line tnum">WITHOUT {net.sites[crit.site]!.short_name.toUpperCase()}: +{musd(crit.delta_cost_usd)} M USD / YR · {int(crit.unmet_tons)} T UNSERVED</p> : null}
              </div>
              <p className="readout-line readout-line--muted storm-note">PER-SITE TOTALS · CITIES AND COMMODITIES NOT SHOWN PER DRAW. {core.meta.limitations[2]!.toUpperCase()}</p>
              <div className="sites-tags"><HonestyChip tag="SIMULATED" detail="500 SEEDED DRAWS" /><HonestyChip tag="SYNTHETIC" detail="DISRUPTIONS" /></div>
            </>
          ) : null}
        </ArtifactStatus>
      </div>
      {!motion && rb && net ? <StormStills rb={rb} net={net} /> : null}
    </Track>
  );
}

function drawLine(rb: Robustness, net: NonNullable<ReturnType<typeof useCore>>["net"], i: number) {
  const down = rb.draws.failed_sites[i]!;
  const names = down.map((f) => net.sites[f]!.short_name.toUpperCase()).join(", ");
  const epi = rb.draws.epicentre[i];
  return `DRAW ${i + 1} OF ${rb.draws.demand_tons.length} · ${down.length} SITES DOWN${down.length ? ` (${names})` : ""} · ${rb.draws.lanes_down[i]} LANES DOWN · DEMAND x${fixed(rb.draws.demand_multiplier[i]!, 2)}${epi !== null && epi !== undefined ? `, REGIONAL EVENT NEAR ${net.demand_nodes[epi]!.short_name.toUpperCase()}` : ""}`;
}

function StormStills({ rb, net }: { rb: Robustness; net: NonNullable<ReturnType<typeof useCore>>["net"] }) {
  const o = drawOrder(rb, "legacy_cost");
  const hou = net.demand_nodes.findIndex((n) => n.short_name === "Houston");
  const storm = rb.draws.epicentre.findIndex((e) => e === hou);
  const onlyLegacy = o.filter((i) => rb.results.optimized.unmet_tons[i]! === 0 && rb.results.legacy.unmet_tons[i]! > 0).sort((a, b) => rb.results.legacy.unmet_tons[b]! - rb.results.legacy.unmet_tons[a]!)[0] ?? o[0]!;
  const picks: [string, number][] = [["BEST BY LEGACY COST", o[0]!], ["MEDIAN", o[250]!], ["WORST", o[499]!], ["GULF STORM", storm >= 0 ? storm : o[480]!], ["ONLY THE LEGACY FOOTPRINT FAILS", onlyLegacy]];
  const ref = maxTons(rb);
  return (
    <div className="storm-stills">
      {picks.map(([name, i]) => (
        <figure key={name} className="storm-still">
          <figcaption className="readout-line">{name} · {drawLine(rb, net, i)}</figcaption>
          <div className="storm-still__pair">
            {(["legacy", "optimized"] as const).map((d) => (
              <DockStill key={d} net={net} refTons={ref} fit={0.92} label={`${d} footprint, draw ${i + 1}`} spec={{ A: drawPlan(net, rb, d, i), mix: 0 }} labels={false}
                className="storm-still__dock" />
            ))}
          </div>
          <p className="readout-line readout-line--muted tnum">{fullService(rb, "legacy", i) ? "FULL SERVICE" : `${int(rb.results.legacy.unmet_tons[i]!)} T UNSERVED`} (LEGACY) · {fullService(rb, "optimized", i) ? "FULL SERVICE" : `${int(rb.results.optimized.unmet_tons[i]!)} T UNSERVED`} (OPTIMIZED)</p>
        </figure>
      ))}
      <p className="readout-line readout-line--muted">{tail(rb, "legacy").length} DRAWS IN EACH CVAR95 TAIL · {lostPlan(net, rb, 0) ? "LOSE-ONE-SITE RECORDS ARE LIVE ABOVE" : ""}</p>
    </div>
  );
}
void posAt;
