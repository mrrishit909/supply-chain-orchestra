import { useState, useSyncExternalStore } from "react";
import { Track } from "../scroll/Track";
import { HonestyChip, type Honesty } from "../components/HonestyChip";
import { SceneErrors } from "../components/StateUI";
import { useArtifact } from "../data/useArtifact";
import { CORE_SPECS, MODEL, useCore } from "./data";
import { limits } from "../state/scenes";
import { useMotion, useProgress } from "../scroll/hooks";
import { stepState } from "../motion/progress";
import { jumpTo } from "../scroll/engine";
import { fact } from "../data/copy";
import { fixed, int } from "../model/format";
import { albers, greatCircle } from "../map/project";
import { COMMODITY_NAME } from "../dock/draw";
import { scenarioPlan } from "../model/plans";
import type { ArtifactSpec } from "../data/loader";
import type { SceneDef } from "../app/scenes";
import type { Network } from "../model/types";

const T = [0.14, 0.28, 0.42, 0.56, 0.7, 0.84];

function Path({ net }: { net: Network }) {
  const a = net.plants[0]!, b = net.sites[3]!;
  const proj = albers(net);
  const pts = greatCircle([a.lat, a.lon], [b.lat, b.lon], 24).map(([la, lo]) => proj(la, lo));
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), s = 90 / Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0, 1e-6);
  return (
    <svg viewBox="0 0 160 70" className="ev-path" role="img" aria-label="A great-circle path, times 1.2">
      <polyline points={pts.map(([x, y]) => `${(10 + (x - x0) * s).toFixed(1)},${(60 - (y - y0) * s).toFixed(1)}`).join(" ")} fill="none" stroke="#58B8E1" strokeWidth="1.4" />
      <text x="110" y="20" fill="#fff" fontSize="12" fontFamily="inherit">x 1.2</text>
    </svg>
  );
}

export function S07Evidence({ def }: { def: SceneDef }) {
  const core = useCore();
  const motion = useMotion();
  const [i, setI] = useState(0);
  const [ms] = useArtifact(MODEL, false);
  const lim = useSyncExternalStore(limits.subscribe, limits.get);
  useProgress(def.id, (p) => setI((o) => stepState(o, p, T, 0.02)));
  if (!core) return (
    <Track id={def.id} height={def.track} landing={def.landing} className={`scene scene-${def.id}`} label="Evidence">
      <SceneErrors id={def.id} specs={[...CORE_SPECS, MODEL] as ArtifactSpec<unknown>[]} />
      <h2 id={`${def.id}-title`} tabIndex={-1} data-scene-heading className="sr-only">{def.title}</h2>
    </Track>
  );
  const { net, facts, meta, sol } = core;
  const opt = scenarioPlan(net, sol, "optimized")!;
  const pen = ms.status === "ready" ? ms.data.penalties : null;
  const check = lim.check;
  const found = lim.live && opt.objective ? opt.objective - (lim.live.objective ?? 0) : null;
  const rows: { q: string; a: string; visual: React.ReactNode; tag: Honesty; detail?: string }[] = [
    { q: "IS THIS A REAL COMPANY?", a: `NO. THE ${fact(facts, "demand_nodes")} CITIES ARE REAL; EVERY SITE, PLANT, CAPACITY AND COST IS GENERATED (SEED ${meta.seed}).`, tag: "SYNTHETIC",
      visual: <ul className="ev-rules"><li>SITES: {net.sites.length} OF THE {String(net.constants.site_pool)} LARGEST</li><li>PLANTS: {net.plants.length}, SUPPLY {fixed(net.constants.supply_headroom as number, 2)} x DEMAND</li><li>COSTS: GENERATED, NO REAL RATES</li></ul> },
    { q: "ARE THESE REAL FREIGHT RATES?", a: "NO. NO PUBLIC RATE SERIES WITH A USABLE LICENCE WAS FOUND. THE RATES ARE ASSUMPTIONS.", tag: "SYNTHETIC",
      visual: <ul className="ev-rules">{net.commodities.map((c, k) => <li key={c.id}>{COMMODITY_NAME[k]}: {c.rate_out_usd_ton_mi} USD / T-MI OUT <span className="chip-assumed">ASSUMED</span></li>)}</ul> },
    { q: "ARE THOSE ROADS?", a: "NO. GREAT-CIRCLE MILES TIMES 1.2. NO ROADS, NO TRANSIT TIME.", tag: "DERIVED", visual: <Path net={net} /> },
    { q: "IS THE BROWSER REALLY SOLVING IT?", a: `YES. SAME LP TEXT, SAME HASH: ${fact(facts, "parity_vectors_run")} VECTORS, ${fact(facts, "parity_failures")} FAILURES. THIS PAGE CHECKED ITS OWN HASH AT S03B: ${check.state === "ok" ? "YES" : "NOT RUN IN THIS SESSION"}.`, tag: "SIMULATED",
      visual: <p className="readout-line tnum">PYTHON {String(opt.lpSha).slice(0, 12)} {check.state === "ok" ? <><span className="ok">✓</span> BROWSER {String(opt.lpSha).slice(0, 12)}</> : "· BROWSER: NOT RUN IN THIS SESSION"}</p> },
    { q: "WHAT DOES INFEASIBLE MEAN HERE?", a: "THERE IS NO PLAN THAT KEEPS EVERY PROMISE. THE RELAXATION BREAKS THE FEWEST, AND SAYS WHICH.", tag: "SYNTHETIC",
      visual: pen ? <ul className="ev-rules"><li>UNMET DEMAND: {int(pen.unmet_usd_ton)} USD / T</li><li>SUPPLY OVERSHOOT: {int(pen.supply_usd_ton)} USD / T</li><li>CAPACITY OVERSHOOT: {int(pen.capacity_usd_unit)} USD / UNIT</li><li>EXTRA SITE: {int(pen.open_sites_usd_site)} USD / SITE</li></ul> : <button type="button" className="text-btn" onClick={() => void 0}>PENALTIES LOAD WITH THE MODEL</button> },
    { q: "IS A SHADOW PRICE A PRICE?", a: sol.duals_note.toUpperCase(), tag: "DERIVED",
      visual: lim.cap > 1 && found !== null ? <p className="readout-line tnum">THE S03B CHECK (x{lim.cap.toFixed(2)}): THE SOLVER FOUND {int(found)} USD SAVED.</p> : <button type="button" className="text-btn" onClick={() => jumpTo("limits", 0.2, { focus: true })}>→ RUN THE CHECK AT S03B</button> },
    { q: "DOES THE CENSUS BUREAU STAND BEHIND THIS?", a: `NO. ${meta.attribution} ${meta.licence_note}`.toUpperCase(), tag: "OBSERVED",
      visual: <ul className="ev-rules">{meta.sources.map((s) => <li key={s.id}>{s.name.toUpperCase()} · {s.vintage} · SHA {s.sha256.slice(0, 8)}</li>)}</ul> },
  ];
  const shown = motion ? Math.min(i, 6) : 6;
  return (
    <Track id={def.id} height={def.track} landing={def.landing} className={`scene scene-${def.id}`} label="Evidence: how we know">
      <SceneErrors id={def.id} specs={[...CORE_SPECS, MODEL] as ArtifactSpec<unknown>[]} />
      <p className="scene-kicker ev-kicker">HOW WE KNOW · SEVEN OBJECTIONS, SEVEN ANSWERS</p>
      <h2 id={`${def.id}-title`} tabIndex={-1} data-scene-heading className="sr-only">{def.title}</h2>
      <ol className="ev-stack">
        {rows.map((r, k) => {
          const age = shown - k;
          if (motion && age < 0) return null;
          return (
            <li key={k} className={`ev-pair ${motion ? "" : "is-flat"}`} data-age={Math.min(age, 4)} style={motion ? ({ ["--age" as string]: Math.min(age, 4) } as React.CSSProperties) : undefined} aria-current={age === 0 ? "true" : undefined}>
              <p className="ev-q">{r.q}</p>
              <div className="ev-a">
                <p className="ev-a__text">{r.a}</p>
                <div className="ev-visual">{r.visual}</div>
                <HonestyChip tag={r.tag} onLight={r.tag !== "SIMULATED" ? true : false} className="ev-chip" />
              </div>
            </li>
          );
        })}
      </ol>
    </Track>
  );
}
