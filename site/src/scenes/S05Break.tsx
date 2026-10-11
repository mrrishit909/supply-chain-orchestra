import { useSyncExternalStore } from "react";
import { Track } from "../scroll/Track";
import { HonestyChip } from "../components/HonestyChip";
import { Radio } from "../components/Radio";
import { ArtifactStatus, SceneErrors } from "../components/StateUI";
import { DockStill } from "../components/DockStill";
import { useArtifact } from "../data/useArtifact";
import { useNear } from "../scroll/useNear";
import { CORE_SPECS, MODEL, useCore } from "./data";
import { Slot } from "./Slot";
import { DockHit } from "../components/DockHit";
import { Inspector } from "../components/Inspector";
import { brk, type BreakCase } from "../state/scenes";
import { breakId, breakPlan, BREAK_STATES } from "./frames-break";
import { WordsBlock } from "../components/WordsBlock";
import { getSolver, requestSolve, subscribeSolver, retrySolver } from "../state/solver";
import { useMotion } from "../scroll/hooks";
import { scenarioPlan } from "../model/plans";
import { fullParams } from "../model/lp";
import { sourceWord, statusWord } from "../data/copy";
import { fixed, musd } from "../model/format";
import { useViewport } from "./useViewport";
import type { ArtifactSpec } from "../data/loader";
import type { SceneDef } from "../app/scenes";
import { startSolver } from "../state/solver";

const CASES: { id: BreakCase; label: string }[] = [{ id: "supply", label: "SUPPLY" }, { id: "capacity", label: "CAPACITY" }, { id: "sites", label: "SITES" }, { id: "storm", label: "STORM" }];
const CASE_NOTE: Record<BreakCase, string> = { supply: "DEMAND x1.4", capacity: "SITE CAPACITY x0.3", sites: "AT MOST 2 SITES", storm: "A GULF STORM CLOSES HOUSTON" };

export function S05Break({ def }: { def: SceneDef }) {
  const core = useCore();
  const st = useSyncExternalStore(brk.subscribe, brk.get);
  const near = useNear(def.id);
  const [ms, mRetry] = useArtifact(MODEL, near);
  const sv = useSyncExternalStore(subscribeSolver, getSolver);
  const motion = useMotion();
  const vp = useViewport();
  const net = core?.net;
  const plan = core && net ? breakPlan(net, core.sol) : null;
  const pub = core && net ? scenarioPlan(net, core.sol, breakId(st.case, st.mode, st.storm)) : null;
  const model = ms.status === "ready" ? ms.data : null;
  const solveLive = () => {
    if (!model || !net || !pub) return;
    startSolver();
    brk.set({ live: null });
    const go = () => void requestSolve(net, model, fullParams(model, pub.params), (r) => {
      if ("error" in r) { liveMsg.set(`COULD NOT SOLVE (${r.error})`); return; }
      const cur = brk.get();
      if (breakId(cur.case, cur.mode, cur.storm) !== pub.id) return;
      const objOk = pub.objective === null ? r.plan.objective === null : Math.abs((r.plan.objective ?? 0) - pub.objective) <= 1e-6 * Math.abs(pub.objective);
      liveMsg.set(`SOLVED IN BROWSER · HiGHS · ${statusWord(r.plan)} · ${r.plan.status === pub.status && objOk ? "MATCHES THE PUBLISHED RECORD ✓" : "DIFFERS FROM THE PUBLISHED RECORD"}`);
      if (r.plan.status === "Optimal") brk.set({ live: { ...r.plan, label: pub.label } });
    });
    go();
  };
  const msg = useSyncExternalStore(live.subscribe, () => live.get().m);
  const p = plan;
  const comp = p?.components;
  const op = comp ? comp.fixed_usd + comp.inbound_transport_usd + comp.outbound_transport_usd + comp.handling_usd : 0;
  const pen = comp ? Object.values(comp.penalties_usd).reduce((a, b) => a + b, 0) : 0;
  const stateIdx = BREAK_STATES.findIndex((s) => s.case === st.case && s.mode === st.mode && (s.case !== "storm" || s.storm === st.storm));
  void stateIdx;
  return (
    <Track id={def.id} height={def.track} landing={def.landing} className={`scene scene--grid scene-${def.id}`} label="Break it: strict and relaxed">
      <SceneErrors id={def.id} specs={[...CORE_SPECS, MODEL] as ArtifactSpec<unknown>[]} />
      <div className="slot-wrap"><Slot scene={def.id} name="disc" />{net && p?.status !== "Infeasible" ? <DockHit net={net} scene={def.id} label="The dock; hover a bar for its route" /> : null}</div>
      <div className="scene-text">
        <p className="scene-kicker">STRICT HAS NO PLAN · RELAXED SAYS WHICH PROMISE BREAKS FIRST</p>
        <h2 id={`${def.id}-title`} tabIndex={-1} data-scene-heading className="scene-statement">{def.title}</h2>
      </div>
      <div className="scene-panel">
        {core && net && pub ? (
          <>
            <Radio label="CASE" value={st.case} options={CASES.map((c) => c.id)} render={(v) => CASES.find((c) => c.id === v)!.label} asSelect={vp.cls === "M"}
              onChange={(v) => { liveMsg.set(""); brk.set({ case: v, mode: v === "storm" ? "relaxed" : brk.get().mode, live: null }); }} />
            <Radio label="MODEL" value={st.mode} options={["strict", "relaxed"] as const} render={(v) => v.toUpperCase()}
              disabled={(v) => (st.case === "storm" && v === "strict" ? "THE STORM CASES ARE PUBLISHED ONLY AS RELAXED RECORDS" : null)}
              onChange={(v) => { liveMsg.set(""); brk.set({ mode: v, live: null }); }} />
            {st.case === "storm" ? <Radio label="HITS" value={st.storm} options={["legacy", "optimized"] as const} render={(v) => v.toUpperCase()} onChange={(v) => { liveMsg.set(""); brk.set({ storm: v, live: null }); }} /> : null}
            <p className="readout-line tnum">
              <span className={`status ${pub.status === "Infeasible" ? "status--error" : pub.relaxation ? "status--warn" : "status--ok"}`}>{p ? statusWord(p) : ""}</span> · {p ? sourceWord(p) : ""} · {CASE_NOTE[st.case]}
            </p>
            {p?.status === "Infeasible" ? (
              <>
                <p className="readout-line readout-line--muted">NO PLAN KEEPS EVERY PROMISE. THE DISC THAT {fixed(p.demandTons / 1e6, 2)} M T OF DEMAND WOULD NEED IS HATCHED.</p>
                <button type="button" className="btn-square" onClick={() => brk.set({ mode: "relaxed", live: null })}>RELAX TO SEE WHY</button>
              </>
            ) : p && comp ? (
              <>
                <WordsBlock words={p.relaxation?.words ?? []} k={p.id} />
                <p className="readout-line tnum">OPERATING {musd(op)} + PENALTY {musd(pen)} M USD / YR</p>
                <p className="readout-line readout-line--muted">{core.meta.limitations.length ? "" : ""}{modelNote(model?.penalties.note)}</p>
              </>
            ) : null}
            <ArtifactStatus file="model.json" state={ms} retry={mRetry} empty="UNAVAILABLE">
              {() => (
                <div className="live-row">
                  <button type="button" className="btn-square" disabled={sv.status === "loading" || sv.solving || sv.status === "disabled"} aria-disabled={sv.status === "loading" || sv.solving} onClick={solveLive}>
                    {sv.solving ? "SOLVING IN BROWSER" : "SOLVE THIS LIVE"}
                  </button>
                  {sv.status === "error" ? <button type="button" className="btn-square" onClick={retrySolver}>RETRY</button> : null}
                  {sv.status === "error" || sv.status === "disabled" ? <span className="state-line state-line--error">BROWSER SOLVER UNAVAILABLE · SHOWING PRECOMPUTED · PYTHON HiGHS</span> : null}
                  {msg ? <span className="readout-line">{msg}</span> : null}
                </div>
              )}
            </ArtifactStatus>
            <div className="sites-tags"><HonestyChip tag="SIMULATED" detail={pub.relaxation || pub.status === "Infeasible" ? "RELAXED" : "STRICT"} /><HonestyChip tag="SYNTHETIC" detail="PENALTIES ARE DEVICES" /></div>
          </>
        ) : null}
      </div>
      {net && plan ? <Inspector scene={def.id} net={net} plan={plan} /> : null}
      {!motion && core && net ? <BreakStills core={core} /> : null}
    </Track>
  );
}

import { store } from "../state/store";
const live = store({ m: "" });
const liveMsg = { set: (m: string) => live.set({ m }) };
const modelNote = (n?: string) => (n ? n.toUpperCase() : "");

function BreakStills({ core }: { core: NonNullable<ReturnType<typeof useCore>> }) {
  const ids = ["infeasible_supply", "relaxed_supply", "infeasible_capacity", "relaxed_capacity", "infeasible_sites", "relaxed_sites", "storm_legacy", "storm_optimized"];
  const ref = Math.max(...ids.map((i) => scenarioPlan(core.net, core.sol, i)!.demandTons));
  return (
    <div className="break-stills">
      {ids.map((id) => {
        const p = scenarioPlan(core.net, core.sol, id)!;
        return (
          <figure key={id} className="break-still">
            <DockStill net={core.net} className="break-still__dock" label={`${p.label}: ${statusWord(p)}`} refTons={ref} fit={0.9} spec={{ A: p, mix: 0, needed: p.status === "Infeasible" ? 1 : 0, open: p.status === "Infeasible" ? 0 : 1 }} />
            <figcaption>
              <span className="readout-line">{p.label.toUpperCase()} · {statusWord(p)} · {sourceWord(p)}</span>
              {p.relaxation?.words.map((w) => <span key={w} className="readout-line readout-line--muted">{w}</span>)}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
