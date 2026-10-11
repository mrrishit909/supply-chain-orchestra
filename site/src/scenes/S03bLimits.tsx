import { useEffect, useRef, useSyncExternalStore } from "react";
import { Track } from "../scroll/Track";
import { HonestyChip } from "../components/HonestyChip";
import { Radio } from "../components/Radio";
import { ArtifactStatus, SceneErrors } from "../components/StateUI";
import { useArtifact } from "../data/useArtifact";
import { useNear } from "../scroll/useNear";
import { CORE_SPECS, MODEL, useCore } from "./data";
import { Slot } from "./Slot";
import { DockHit } from "../components/DockHit";
import { Inspector } from "../components/Inspector";
import { DockStill } from "../components/DockStill";
import { useMotion } from "../scroll/hooks";
import { PRICE_BIN } from "./price";
import { limits } from "../state/scenes";
import { getSolver, requestSolve, startSolver, subscribeSolver, retrySolver } from "../state/solver";
import { useActiveScene } from "../scroll/hooks";
import { sceneIndex } from "../app/scenes";
import { scenarioPlan } from "../model/plans";
import { fullParams, r4 } from "../model/lp";
import { fixed, int, musd } from "../model/format";
import { upperDuals } from "./copy-limits";
import { PRICE_STEPS } from "../dock/draw";
import { fact } from "../data/copy";
import type { ArtifactSpec } from "../data/loader";
import type { SceneDef } from "../app/scenes";

export function S03bLimits({ def }: { def: SceneDef }) {
  const core = useCore();
  const active = useActiveScene();
  const nearMe = useNear(def.id);
  const [ms, mRetry] = useArtifact(MODEL, nearMe);
  const st = useSyncExternalStore(limits.subscribe, limits.get);
  const sv = useSyncExternalStore(subscribeSolver, getSolver);
  const motion = useMotion();
  const warmed = useRef(false);
  const reached = active ? sceneIndex(active) >= sceneIndex(def.id) : false;
  useEffect(() => { if (reached) startSolver(); }, [reached]);
  const model = ms.status === "ready" ? ms.data : null;
  const net = core?.net;
  const opt = core && net ? scenarioPlan(net, core.sol, "optimized") : null;
  // the warm-up solve: the optimized params once, then the published hash and objective are compared
  useEffect(() => {
    if (!model || !net || !opt || sv.status !== "ready" || warmed.current) return;
    warmed.current = true;
    limits.set({ check: { ...limits.get().check, state: "warming", solving: true } });
    void requestSolve(net, model, fullParams(model, opt.params), (r) => {
      if ("error" in r) { limits.set({ check: { state: "error", ms: 0, hashOk: null, objOk: null, error: r.error, solving: false } }); return; }
      const objOk = Math.abs((r.plan.objective ?? 0) - (opt.objective ?? 1)) <= 1e-6 * Math.abs(opt.objective ?? 1);
      limits.set({ check: { state: r.sha === opt.lpSha && objOk ? "ok" : "mismatch", ms: r.plan.ms ?? 0, hashOk: r.sha === opt.lpSha, objOk, error: null, solving: false } });
    });
  }, [model, net, opt, sv.status]);
  useEffect(() => {
    if (sv.status === "error" || sv.status === "disabled") limits.set({ check: { state: "fallback", ms: 0, hashOk: null, objOk: null, error: sv.error, solving: false } });
  }, [sv.status, sv.error]);
  // the capacity toggle: a live solve of capacity x1.05 / x1.10 on the whole network
  const setCap = (cap: 1 | 1.05 | 1.1) => {
    limits.set({ cap, live: null });
    if (cap === 1 || !model || !net || !opt || sv.status !== "ready") return;
    limits.set({ check: { ...limits.get().check, solving: true } });
    void requestSolve(net, model, fullParams(model, { ...opt.params, capacity_scale: cap }), (r) => {
      if ("error" in r) { limits.set({ check: { ...limits.get().check, solving: false, error: r.error } }); return; }
      if (limits.get().cap === cap) limits.set({ live: r.plan, check: { ...limits.get().check, solving: false, ms: r.plan.ms ?? 0, error: null } });
    });
  };
  const sc = core?.sol.scenarios.find((s) => s.id === "optimized");
  const binding = sc?.binding ?? [];
  const site = binding.find((b) => b.group === "capacity");
  const check = st.check;
  const fd = site?.fd_check?.find((c) => c.pct === 5) ?? null;
  const live = st.live;
  const dualPred = site && net && site.shadow_usd_per_unit !== null ? site.shadow_usd_per_unit * (st.cap - 1) * r4(net.sites[10]!.capacity_units) : null;
  const found = live && opt ? (opt.objective ?? 0) - (live.objective ?? 0) : null;
  const changed = live && opt ? JSON.stringify(live.open) !== JSON.stringify(opt.open) : false;
  const text = core && net && sc ? upperDuals(core.sol.duals_note) : "";
  return (
    <Track id={def.id} height={def.track} landing={def.landing} className={`scene scene--grid scene-${def.id}`} label="Limits: what binds">
      <SceneErrors id={def.id} specs={[...CORE_SPECS, MODEL] as ArtifactSpec<unknown>[]} />
      <div className="slot-wrap"><Slot scene={def.id} name="disc" />{net ? <DockHit net={net} scene={def.id} label="The dock with the binding site lit; hover a bar for its route" /> : null}</div>
      <div className="scene-text">
        <p className="scene-kicker">WHAT BINDS · THREE STEPS · THEN CHECK THE CLAIM IN YOUR BROWSER</p>
        <h2 id={`${def.id}-title`} tabIndex={-1} data-scene-heading className="scene-statement">{def.title}</h2>
      </div>
      <div className="scene-panel">
        {core && net && sc ? (
          <>
            <ol className="steps" aria-label="What binds">
              {[0, 1, 2].map((i) => (
                <li key={i} className={st.step === i ? "is-on" : ""}>
                  {i === 0 && site ? <span>S10 {net.sites[10]!.short_name.toUpperCase()} · CAPACITY BINDS · +1 UNIT SAVES <b className="derived tnum">{site.shadow_usd_per_unit} USD / YR</b></span> : null}
                  {i === 1 ? <span>P0 {net.plants[0]!.short_name.toUpperCase()} SHIPS ALL IT CAN MAKE · ONE MORE TON SAVES {binding.filter((b) => b.id.startsWith("P0/")).map((b) => `${fixed(b.shadow_usd_per_unit ?? 0, 2)} (${b.id.split("/")[1] === "ambient" ? "PACKAGED" : b.id.split("/")[1] === "cold" ? "COLD" : "BULKY"})`).join(", ")} USD</span> : null}
                  {i === 2 ? <PriceLine core={core} /> : null}
                </li>
              ))}
            </ol>
            <p className="readout-line readout-line--derived">{text} · SMALL CHANGES ONLY</p>
            <div className="check" aria-live="polite">
              <ArtifactStatus file="model.json" state={ms} retry={mRetry} empty="UNAVAILABLE">
                {() => (
                  <>
                    {check.state === "warming" || sv.status === "loading" ? (
                      <p className="state-line">WARMING UP THE BROWSER SOLVER{sv.total ? ` · ${Math.min(99, Math.floor((sv.loaded / sv.total) * 100))}%` : ""}</p>
                    ) : null}
                    {check.state === "ok" ? <p className="readout-line"><span className="status status--ok">OPTIMAL</span> · SOLVED IN BROWSER · HiGHS · LP HASH MATCHES PYTHON <span className="ok">✓</span> · OBJECTIVE MATCHES <span className="ok">✓</span> · <span className="tnum">{fixed(check.ms, 0)}</span> MS</p> : null}
                    {check.state === "mismatch" ? <p className="state-line state-line--error">BROWSER RESULT DID NOT MATCH THE PUBLISHED HASH OR OBJECTIVE</p> : null}
                    {check.state === "fallback" ? (
                      <div className="state-error">
                        <p className="state-line state-line--error">BROWSER SOLVER UNAVAILABLE{sv.error ? ` (${sv.error})` : ""}</p>
                        {sv.status === "error" ? <button type="button" className="btn-square" onClick={retrySolver}>RETRY</button> : null}
                      </div>
                    ) : null}
                    {check.state === "error" ? <p className="state-line state-line--error">COULD NOT SOLVE ({check.error})</p> : null}
                    <Radio label="CAPACITY" value={String(st.cap) as "1" | "1.05" | "1.1"} options={["1", "1.05", "1.1"] as const} render={(v) => `x${Number(v).toFixed(2)}`}
                      onChange={(v) => setCap(Number(v) as 1 | 1.05 | 1.1)}
                      disabled={(v) => (v !== "1" && check.state !== "ok" && check.state !== "fallback" ? "THE BROWSER SOLVER IS NOT READY" : v === "1.1" && check.state === "fallback" ? "NOT PUBLISHED: ONLY +1% AND +5% OF S10 ARE" : null)} />
                    {st.cap > 1 && check.state === "fallback" && fd && st.cap === 1.05 ? (
                      <p className="readout-line">PRECOMPUTED · PYTHON HiGHS · S10 ALONE +5%, OPEN SET FIXED: THE DUAL PREDICTED <span className="tnum">{int(fd.predicted_saving_usd)}</span> USD SAVED · THE SOLVER FOUND <span className="tnum">{int(fd.solved_saving_usd)}</span> USD</p>
                    ) : null}
                    {st.cap > 1 && live && found !== null && dualPred !== null ? (
                      <>
                        <p className="readout-line">SOLVED IN BROWSER · HiGHS · ALL SITES x{st.cap.toFixed(2)} · THE DUAL PREDICTED <span className="tnum">{int(dualPred)}</span> USD SAVED · THE SOLVER FOUND <span className="tnum">{int(found)}</span> USD ({musd(live.objective ?? 0)} M USD / YR)</p>
                        {changed ? <p className="readout-line status--warn">THE OPEN SET CHANGED: THE DUAL NO LONGER APPLIES</p> : null}
                      </>
                    ) : null}
                    {check.solving ? <p className="state-line" role="status">SOLVING IN BROWSER · HiGHS</p> : null}
                  </>
                )}
              </ArtifactStatus>
            </div>
            <div className="sites-tags"><HonestyChip tag="DERIVED" detail="CONDITIONAL ON THE OPEN SET" /><HonestyChip tag="SIMULATED" detail="SYNTHETIC COSTS" /></div>
            <p className="sr-only">{fact(core.facts, "parity_vectors_run")} parity vectors.</p>
          </>
        ) : null}
      </div>
      {net && opt ? <Inspector scene={def.id} net={net} plan={opt} pub={sc ?? null} /> : null}
      {!motion && net && opt && core ? (
        <div className="sites-stills">
          {[0, 1, 2].map((i) => (
            <figure key={i} className="sites-still">
              <DockStill net={net} refTons={opt.demandTons} label={["A full site", "A drained plant", "What a ton costs where"][i]!} className="sites-still__dock"
                spec={{
                  A: opt, mix: 0,
                  alpha: i === 0 ? (m) => (m.site === 10 ? 1 : 0.5) : i === 1 ? (m) => (m.kind === "in" && m.ref === 0 ? 1 : 0.3) : undefined,
                  outline: i === 0 ? (m) => (m.site === 10 ? 0.9 : 0) : undefined,
                  price: i === 2 ? PRICE_BIN(core.facts, core.sol) : undefined, priceMix: i === 2 ? 1 : 0,
                }} />
              <figcaption className="readout-line">{["S10 OKLAHOMA CITY IS FULL", "P0 FORT WORTH SHIPS ALL IT CAN MAKE", "DEMAND PRICE STEPS (DERIVED)"][i]}</figcaption>
            </figure>
          ))}
        </div>
      ) : null}
    </Track>
  );
}

function PriceLine({ core }: { core: NonNullable<ReturnType<typeof useCore>> }) {
  const sc = core.sol.scenarios.find((s) => s.id === "optimized")!;
  const pr = sc.demand_price_usd_ton!;
  let lo = { i: 0, v: Infinity }, hi = { i: 0, v: -Infinity };
  pr.forEach((r, i) => { if (r[0]! < lo.v) lo = { i, v: r[0]! }; if (r[0]! > hi.v) hi = { i, v: r[0]! }; });
  const nm = (i: number) => core.net.demand_nodes[i]!.short_name.toUpperCase();
  return (
    <span>
      WHAT A TON COSTS WHERE · CHEAPEST: {nm(lo.i)} <b className="derived tnum">{fixed(lo.v, 0)}</b> · DEAREST: {nm(hi.i)} <b className="derived tnum">{fixed(hi.v, 0)}</b> USD / T (PACKAGED)
      <span className="price-legend" role="img" aria-label="Demand price steps, dim to bright">{PRICE_STEPS.map((s, k) => <i key={k} style={{ opacity: s }} />)}</span>
    </span>
  );
}
