import { useSyncExternalStore, type KeyboardEvent } from "react";
import { Track } from "../scroll/Track";
import { HonestyChip } from "../components/HonestyChip";
import { ArtifactStatus, SceneErrors } from "../components/StateUI";
import { useArtifact } from "../data/useArtifact";
import { useNear } from "../scroll/useNear";
import { CORE_SPECS, SWEEP, useCore } from "./data";
import { Slot } from "./Slot";
import { sites } from "../state/scenes";
import { jumpTo } from "../scroll/engine";
import { useMotion } from "../scroll/hooks";
import { useTweened } from "../motion/useTweened";
import { musd, fixed, int } from "../model/format";
import { statusWord, sourceWord } from "../data/copy";
import { sweepPlan } from "../model/plans";
import { pForK } from "./frames-sites";
import type { ArtifactSpec } from "../data/loader";
import type { SceneDef } from "../app/scenes";
import type { Sweep } from "../model/types";

function Num({ v, d = 1, scale = 1e6 }: { v: number; d?: number; scale?: number }) {
  const t = useTweened(v);
  return <>{fixed(t / scale, d)}</>;
}

const bestK = (sw: Sweep) => {
  const r = sw.series.find((s) => s.id === "exactly")!.records.filter((x) => x.objective_usd !== null);
  return r.reduce((a, b) => (b.objective_usd! < a.objective_usd! ? b : a)).k;
};

export function S03aSites({ def }: { def: SceneDef }) {
  const core = useCore();
  const near = useNear(def.id);
  const [ss, retry] = useArtifact(SWEEP, near);
  const st = useSyncExternalStore(sites.subscribe, sites.get);
  const motion = useMotion();
  const sw = ss.status === "ready" ? ss.data : null;
  const net = core?.net;
  const plan = sw && net ? sweepPlan(net, sw, "exactly", st.k, st.relaxed && st.k <= 4) : null;
  const strict = sw && net ? sweepPlan(net, sw, "exactly", st.k, false) : null;
  const infeasible = strict?.status === "Infeasible";
  const set = (k: number) => {
    const kk = Math.max(1, Math.min(14, k));
    jumpTo(def.id, pForK(kk));
    sites.set({ k: kk, relaxed: false });
  };
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (d) { e.preventDefault(); set(st.k + d); }
  };
  const comp = plan?.components;
  const best = sw ? bestK(sw) : null;
  const exact = sw ? sw.series.find((s) => s.id === "exactly")!.records : [];
  const maxObj = Math.max(...exact.filter((r) => r.objective_usd).map((r) => r.objective_usd!), 1);
  const minObj = Math.min(...exact.filter((r) => r.objective_usd).map((r) => r.objective_usd!), maxObj);
  return (
    <Track id={def.id} height={def.track} landing={def.landing} className={`scene scene--grid scene-${def.id}`} label="Sites: open a site, shorten a trip">
      <SceneErrors id={def.id} specs={[...CORE_SPECS, SWEEP] as ArtifactSpec<unknown>[]} />
      <Slot scene={def.id} name="disc" />
      <div className="scene-text">
        <p className="scene-kicker">EXACTLY K SITES OPEN · FIXED COST AGAINST MILES · ONE REAL SOLVE PER STEP</p>
        <h2 id={`${def.id}-title`} tabIndex={-1} data-scene-heading className="scene-statement">{def.title}</h2>
      </div>
      <div className="scene-panel">
        <ArtifactStatus file="sweep.json" state={ss} retry={retry} empty="NO SWEEP PUBLISHED">
          {() => (
            <>
              <div className="stepper" role="group" aria-label="Sites open">
                <span className="stepper__label">EXACTLY {st.k} SITES OPEN</span>
                <div className="stepper__row">
                  <button type="button" className="btn-square stepper__btn" aria-label="One site fewer" disabled={st.k <= 1} onClick={() => set(st.k - 1)}>−</button>
                  <span role="spinbutton" tabIndex={0} aria-valuemin={1} aria-valuemax={14} aria-valuenow={st.k} aria-label="Sites open" className="stepper__val tnum" onKeyDown={onKey}>{st.k}</span>
                  <button type="button" className="btn-square stepper__btn" aria-label="One site more" disabled={st.k >= 14} onClick={() => set(st.k + 1)}>+</button>
                  <button type="button" className="btn-square" onClick={() => set(14)}>RESET</button>
                </div>
              </div>
              {infeasible ? (
                <div className="sites-infeasible">
                  <p className="readout-line"><span className="status status--error">INFEASIBLE</span> · SIMULATED · {sourceWord(strict!)}</p>
                  <p className="readout-line readout-line--muted">NO PLAN OPENS EXACTLY {st.k} OF 14 SITES AND HOLDS THE DEMAND.</p>
                  {st.relaxed && plan?.relaxation ? <p className="readout-line">{plan.relaxation.words.join(" ")}</p> : null}
                  <button type="button" className="btn-square" aria-pressed={st.relaxed} onClick={() => sites.set({ relaxed: !st.relaxed })}>{st.relaxed ? "HIDE THE RELAXED PLAN" : "RELAX TO SEE WHY"}</button>
                </div>
              ) : plan && comp ? (
                <div className="sites-ledger tnum">
                  <p className="readout-line"><span className="status status--ok">{statusWord(plan)}</span> · {sourceWord(plan)}</p>
                  <dl className="ledger-dl">
                    <div><dt>FIXED</dt><dd><Num v={comp.fixed_usd} /></dd></div>
                    <div><dt>INBOUND</dt><dd><Num v={comp.inbound_transport_usd} /></dd></div>
                    <div><dt>OUTBOUND</dt><dd><Num v={comp.outbound_transport_usd} /></dd></div>
                    <div><dt>HANDLING</dt><dd><Num v={comp.handling_usd} /></dd></div>
                    <div className="ledger-total"><dt>TOTAL</dt><dd><Num v={plan.objective ?? 0} /></dd></div>
                  </dl>
                  <p className="readout-line readout-line--muted">M USD / YR · SYNTHETIC COSTS · {plan.open.length} SITES OPEN</p>
                  <p className="readout-line readout-line--derived">AVERAGE TON TRAVELS {fixed(plan.haulIn ?? 0, 0)} MI IN, {fixed(plan.haulOut ?? 0, 0)} MI OUT · GREAT-CIRCLE x 1.2</p>
                </div>
              ) : null}
              <div className="coststrip" role="group" aria-label="Total cost for each number of open sites">
                {exact.map((r) => {
                  const h = r.objective_usd ? 10 + (30 * (r.objective_usd - minObj + (maxObj - minObj) * 0.1)) / ((maxObj - minObj) * 1.1 || 1) : 40;
                  return (
                    <button key={r.k} type="button" className={`tick ${r.k === st.k ? "is-on" : ""} ${r.objective_usd ? "" : "is-infeasible"}`} style={{ height: h }}
                      aria-label={`${r.k} sites: ${r.objective_usd ? `${musd(r.objective_usd)} million USD` : "infeasible"}`} aria-pressed={r.k === st.k} onClick={() => set(r.k)} />
                  );
                })}
              </div>
              <p className="readout-line readout-line--muted">TOTAL COST FOR EACH K · LOWEST AT {best}</p>
              <p className="sites-note">THE MODEL'S OWN CONTROL IS AN UPPER LIMIT; ABOVE {best} IT STOPS BINDING. THIS STEPS EXACTLY K OPEN SO BOTH SIDES OF THE OPTIMUM SHOW. TRY IT AS A LIMIT AT THE DESK.</p>
            </>
          )}
        </ArtifactStatus>
        <div className="sites-tags"><HonestyChip tag="SIMULATED" detail="SYNTHETIC COSTS" /><HonestyChip tag="DERIVED" detail="HAULS" /></div>
      </div>
      {!motion ? <p className="sr-only">Reduced motion: use the stepper to choose k.</p> : null}
    </Track>
  );
}
void int;
