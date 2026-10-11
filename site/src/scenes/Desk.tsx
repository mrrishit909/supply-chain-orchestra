import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Track } from "../scroll/Track";
import { HonestyChip } from "../components/HonestyChip";
import { ArtifactStatus, SceneErrors } from "../components/StateUI";
import { DeskDock } from "../components/DeskDock";
import { DeskMap, type StrandPick } from "../components/DeskMap";
import { Inspector } from "../components/Inspector";
import { Sheet } from "../components/Sheet";
import { Tooltip } from "../components/Tooltip";
import { WordsBlock } from "../components/WordsBlock";
import { useArtifact } from "../data/useArtifact";
import { useNear } from "../scroll/useNear";
import { CORE_SPECS, MODEL, useCore } from "./data";
import { desk } from "../state/desk";
import { deskResult, inspector, openPick } from "../state/scenes";
import { cancelSolve, getSolver, requestDuals, requestSolve, retrySolver, solveInFlight, startSolver, subscribeSolver } from "../state/solver";
import { useActiveScene } from "../scroll/hooks";
import { sceneIndex } from "../app/scenes";
import { bindingFromPlan, type Plan } from "../model/plan";
import { scenarioPlan } from "../model/plans";
import { fullParams, sameParams, snapControls } from "../model/lp";
import { fixed, musd, int } from "../model/format";
import { sourceWord, statusWord } from "../data/copy";
import { COMMODITY_NAME } from "../dock/draw";
import { useViewport } from "./useViewport";
import type { ArtifactSpec } from "../data/loader";
import type { SceneDef } from "../app/scenes";
import type { Control, Model, Params } from "../model/types";
import type { DockPick } from "./director";

const GROUPS: { id: string; label: string; kinds: string[] }[] = [
  { id: "design", label: "DESIGN", kinds: ["design"] }, { id: "stress", label: "STRESS", kinds: ["stress"] }, { id: "break", label: "BREAK", kinds: ["infeasible", "relaxed"] },
];

export function Desk({ def }: { def: SceneDef }) {
  const core = useCore();
  const active = useActiveScene();
  const nearMe = useNear(def.id);
  const [ms, mRetry] = useArtifact(MODEL, nearMe);
  const st = useSyncExternalStore(desk.subscribe, desk.get);
  const sv = useSyncExternalStore(subscribeSolver, getSolver);
  useSyncExternalStore(inspector.subscribe, inspector.get);
  const { cls } = useViewport();
  const [sheet, setSheet] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const net = core?.net;
  const model = ms.status === "ready" ? ms.data : null;
  const inDesk = active === def.id || active === "closing";
  useEffect(() => { setSheet(false); }, [active]);
  const deskReached = active ? sceneIndex(active) >= sceneIndex("limits") : false;
  const timer = useRef(0);
  const seqRef = useRef(0);

  // initial state: the optimized preset, PRECOMPUTED
  useEffect(() => {
    if (!core || !model || st.params) return;
    const plan = scenarioPlan(core.net, core.sol, model.solver.browser.warmup_preset)!;
    desk.set({ params: fullParams(model, plan.params), preset: plan.id, plan });
    deskResult.set({ plan });
  }, [core, model, st.params]);
  useEffect(() => { if (deskReached) startSolver(); }, [deskReached]);

  const presetOf = useCallback((p: Params) => model?.presets.find((x) => sameParams(fullParams(model, x.params), p))?.id ?? null, [model]);

  const applyPlan = useCallback((plan: Plan, extra: Partial<typeof st> = {}) => {
    desk.set({ plan, solving: false, error: null, fallback: null, seq: desk.get().seq + 1, ...extra });
    deskResult.set({ plan });
  }, []);

  const solve = useCallback((params: Params) => {
    if (!core || !model) return;
    const my = ++seqRef.current;
    const preset = presetOf(params);
    desk.set({ solving: true, error: null, note: null });
    void requestSolve(core.net, model, params, (r) => {
      if (my !== seqRef.current) return;
      if ("error" in r) {
        if (r.error === "CANCELLED") { desk.set({ solving: false, note: "SOLVE CANCELLED: SHOWING THE LAST SOLUTION" }); return; }
        const pub = preset ? scenarioPlan(core.net, core.sol, preset) : null;
        if (pub) { applyPlan(pub, { fallback: `PRECOMPUTED · PYTHON HiGHS · BROWSER SOLVER FAILED (${r.error})`, preset }); return; }
        desk.set({ solving: false, error: `COULD NOT SOLVE (${r.error})` });
        return;
      }
      const plan = r.plan;
      const pub = preset ? scenarioPlan(core.net, core.sol, preset) : null;
      if (plan.status !== "Optimal" && plan.status !== "Infeasible" && plan.objective === null) {
        desk.set({ solving: false, error: `COULD NOT SOLVE (${plan.status.toUpperCase()}${plan.status === "Time limit reached" ? ": NO PLAN FOUND IN TIME" : ""})` });
        return;
      }
      applyPlan(plan, { preset, hashOk: pub ? pub.lpSha === r.sha : null, duals: null });
      if (plan.status === "Optimal" && !params.relax) requestDuals(core.net, model, params, plan.open, (d) => { if (my === seqRef.current && d) desk.set({ duals: d }); });
    }, desk.get().timeLimit);
  }, [core, model, presetOf, applyPlan]);

  // control change: values update at once; D and T schedule a solve 300 ms after the last change, M waits for SOLVE
  const change = (patch: Partial<Params>) => {
    if (!model || !st.params) return;
    const next = snapControls(model, { ...st.params, ...patch });
    const preset = presetOf(next);
    desk.set({ params: next, preset, note: null });
    window.clearTimeout(timer.current);
    if (cls !== "M") {
      timer.current = window.setTimeout(() => {
        if (preset && core) { const pub = scenarioPlan(core.net, core.sol, preset); if (pub && sv.status !== "ready") { applyPlan(pub, { preset }); return; } }
        solve(next);
      }, 300);
    }
  };
  const pickPreset = (id: string) => {
    if (!model || !core) return;
    const pre = model.presets.find((p) => p.id === id)!;
    const params = fullParams(model, pre.params);
    const pub = scenarioPlan(core.net, core.sol, id);
    window.clearTimeout(timer.current);
    seqRef.current++;
    desk.set({ params, preset: id });
    if (pub) applyPlan(pub, { preset: id, hashOk: null, duals: null });
  };
  const reset = () => {
    if (!model || !core) return;
    window.clearTimeout(timer.current);
    seqRef.current++;
    const plan = scenarioPlan(core.net, core.sol, "optimized")!;
    desk.set({ params: fullParams(model, model.defaults), preset: "optimized", error: null, note: null, selection: null, resetFlash: true });
    applyPlan(plan, { preset: "optimized", hashOk: null, duals: null });
    window.setTimeout(() => desk.set({ resetFlash: false }), 1200);
  };
  const cancel = () => { seqRef.current++; cancelSolve(); desk.set({ solving: false }); };

  // test hooks (debug/e2e): the same paths the controls use
  useEffect(() => {
    Object.assign((window as unknown as { __sco: Record<string, unknown> }).__sco, {
      desk: () => { const d = desk.get(); return { params: d.params, preset: d.preset, status: d.plan?.status, source: d.plan?.source, objective: d.plan?.objective, solving: d.solving, error: d.error, fallback: d.fallback, open: d.plan?.open, routesOut: d.plan?.routesOut.length, hashOk: d.hashOk, seq: d.seq }; },
      deskChange: (p: Partial<Params>) => change(p),
      deskSolve: () => st.params && solve(st.params),
      deskPlan: () => desk.get().plan,
      setTimeLimit: (t: number | undefined) => desk.set({ timeLimit: t }),
      /** a real in-flight cancel: post a heavy solve, wait until the worker has it, cancel, report how long the cancel took */
      cancelProbe: async () => {
        const heavy = snapControls(model!, { ...st.params!, demand_scale: 1.35, fixed_cost_scale: 1.7, freight_scale: 1.4 });
        solve(heavy);
        for (let i = 0; i < 100 && !solveInFlight(); i++) await new Promise((r) => setTimeout(r, 20));
        const t0 = performance.now();
        const flying = solveInFlight();
        cancel();
        return { flying, ms: performance.now() - t0, solving: desk.get().solving, note: desk.get().note };
      },
    });
  });

  const plan = st.plan;
  const pen = plan?.components ? Object.values(plan.components.penalties_usd).reduce((a, b) => a + b, 0) : 0;
  const dualBinding = useMemo(() => (net && plan && plan.status === "Optimal" && !plan.relaxed ? bindingFromPlan(net, plan, st.duals) : []), [net, plan, st.duals]);
  const refTons = useMemo(() => (core ? Math.max(...core.sol.scenarios.map((s) => s.total_demand_tons), 1) : 2589781), [core]);
  const hl = st.selection;
  const hlKey = hl ? JSON.stringify(hl) : "";
  const barDim = useMemo(() => {
    if (!hl) return null;
    if (hl.kind === "site") return (m: { site: number }) => (m.site === hl.id ? 1 : 0.3);
    if (hl.kind === "city") return (m: { site: number; end: number; kind: string }) => (m.kind === "out" ? (m.end === hl.id ? 1 : 0.3) : 0.6);
    return (m: { site: number; end: number; kind: string }) => (hl.rk === m.kind && m.site === hl.site && m.end === hl.end ? 1 : 0.3);
  }, [hl]);
  const onDockPick = (d: DockPick | null) => {
    if (!d || d.meta.kind === "un") { desk.set({ selection: null }); return; }
    const sel = d.meta.kind === "in" ? { kind: "route" as const, rk: "in" as const, site: d.meta.site, end: d.meta.ref, commodity: d.meta.commodity } : { kind: "route" as const, rk: "out" as const, site: d.meta.site, end: d.meta.end, commodity: d.meta.commodity };
    desk.set({ selection: sel });
    openPick("desk", sel);
  };
  const onMapPick = (p: StrandPick | null) => {
    if (!p) { desk.set({ selection: null }); return; }
    const sel = { kind: "route" as const, rk: p.rk, site: p.site, end: p.end, commodity: p.commodity };
    desk.set({ selection: sel });
    openPick("desk", sel);
  };
  const tipOf = (m: { rk: string; site: number; end: number; commodity: number }, tons: number) => {
    const n = net!;
    const from = m.rk === "in" ? n.plants[m.end]!.short_name : n.sites[m.site]!.short_name;
    const to = m.rk === "in" ? n.sites[m.site]!.short_name : n.demand_nodes[m.end]!.short_name;
    return `${from} → ${to} · ${COMMODITY_NAME[m.commodity]} · ${int(tons)} T / YR`.toUpperCase();
  };
  const controls = model?.controls ?? [];
  const status = plan ? (
    <p className="readout-line tnum desk-status" role="status">
      {st.solving ? (
        <>SOLVING IN BROWSER · HiGHS · <Elapsed from={sv.solveStart} /> MS</>
      ) : (
        <>
          <span className={`status ${plan.status === "Infeasible" ? "status--error" : plan.status === "Time limit reached" || plan.relaxed ? "status--warn" : "status--ok"}`}>{statusWord(plan)}</span> · {st.fallback ?? sourceWord(plan)}
          {plan.ms ? <> · <span>{fixed(plan.ms, 0)}</span> MS</> : null}
          {plan.objective !== null ? <> · OBJECTIVE {musd(plan.objective)} M USD / YR</> : null}
          {pen > 0 ? <> · PENALTY {musd(pen)} M</> : null}
          {st.preset && plan.source === "BROWSER" ? <> · PARAMS MATCH PRESET {st.preset.toUpperCase()}{st.hashOk === true ? " · HASH ✓" : st.hashOk === false ? " · HASH ✗" : ""}</> : null}
          {plan.status === "Time limit reached" ? " · TIME LIMIT · BEST FOUND, NOT PROVEN OPTIMAL · GAP UNKNOWN" : null}
        </>
      )}
    </p>
  ) : null;

  const rail = (inSheet: boolean) => (
    <div className={`desk-rail ${inSheet ? "ctrl-sheet" : ""}`}>
      {controls.map((c) => <ControlRow key={c.id} c={c} params={st.params!} net={net!} onChange={change} stacked={inSheet} />)}
      <div className="desk-presets">
        <span className="seg-ctl__label">PRESETS</span>
        {GROUPS.map((g) => (
          <div key={g.id} className="desk-presets__group" role="group" aria-label={g.label}>
            <span className="desk-presets__name">{g.label}</span>
            {model!.presets.filter((p) => g.kinds.includes(p.kind)).map((p) => (
              <button key={p.id} type="button" data-id={p.id} className={`chip-btn ${st.preset === p.id ? "is-on" : ""}`} aria-pressed={st.preset === p.id} onClick={() => pickPreset(p.id)}>{p.label.toUpperCase()}</button>
            ))}
          </div>
        ))}
      </div>
      <div className={`desk-actions ${inSheet ? "is-sticky" : ""}`}>
        {st.solving ? <button type="button" className="btn-square" onClick={cancel}>CANCEL</button> : <button type="button" className="btn-square desk-solve" onClick={() => solve(st.params!)} disabled={sv.status === "loading" || sv.status === "disabled"} aria-disabled={sv.status === "loading" || sv.status === "disabled"}>SOLVE</button>}
        <button type="button" className="btn-square" onClick={reset} aria-live="polite">{st.resetFlash ? "RESET ✓" : "RESET"}</button>
      </div>
    </div>
  );

  return (
    <Track id={def.id} height="auto" landing={0} className={`scene scene-desk`} label="The desk: the free solver">
      <SceneErrors id={def.id} specs={[...CORE_SPECS, MODEL] as ArtifactSpec<unknown>[]} />
      <div className="desk">
        <div className="desk-head">
          <p className="scene-kicker">THE DESK · EVERY CHANGE IS A REAL SOLVE ON A SYNTHETIC NETWORK</p>
          <h2 id={`${def.id}-title`} tabIndex={-1} data-scene-heading className="desk-title">{def.title}</h2>
          {status}
          <div className="sites-tags"><HonestyChip tag="SIMULATED" detail={plan?.relaxed ? "RELAXED" : "ON A SYNTHETIC NETWORK"} /><HonestyChip tag="SYNTHETIC" detail="COSTS" /></div>
          {st.error ? (
            <div className="state-error" data-file="solve"><p className="state-line state-line--error">{st.error}</p><button type="button" className="btn-square" onClick={() => { if (sv.status === "error") retrySolver(); solve(st.params!); }}>RETRY</button></div>
          ) : null}
          {st.note ? <p className="readout-line readout-line--muted">{st.note}</p> : null}
          {sv.status === "loading" ? <p className="state-line">WARMING UP THE BROWSER SOLVER{sv.total ? ` · ${Math.min(99, Math.floor((sv.loaded / sv.total) * 100))}%` : ""}</p> : null}
          {sv.status === "error" ? <div className="state-error" data-file="highs.wasm"><p className="state-line state-line--error">BROWSER SOLVER UNAVAILABLE ({sv.error})</p><button type="button" className="btn-square" onClick={retrySolver}>RETRY</button></div> : null}
        </div>
        <ArtifactStatus file="model.json" state={ms} retry={mRetry} empty="UNAVAILABLE">
          {() => core && net && plan && st.params ? (
            <div className="desk-grid">
              {cls === "M" ? (
                <div className="desk-m-controls"><button type="button" className="btn-square" onClick={() => setSheet(true)}>CONTROLS</button><button type="button" className="btn-square desk-solve" onClick={() => solve(st.params!)} disabled={st.solving}>{st.solving ? "SOLVING" : "SOLVE"}</button></div>
              ) : <div className="desk-rail-wrap">{rail(false)}<p className="readout-line readout-line--muted">EVERY CHANGE IS A REAL SOLVE ON A SYNTHETIC NETWORK. NOTHING HERE IS ADVICE ABOUT A REAL SUPPLY CHAIN.</p></div>}
              <div className="desk-figs">
                <DeskDock net={net} plan={plan} dim={st.solving} refTons={refTons} hlKey={hlKey} highlight={barDim} onPick={onDockPick}
                  onHover={(d, x, y) => setTip(d && d.meta.kind !== "un" && !d.moving ? { x, y, text: tipOf(d.meta.kind === "in" ? { rk: "in", site: d.meta.site, end: d.meta.ref, commodity: d.meta.commodity } : { rk: "out", site: d.meta.site, end: d.meta.end, commodity: d.meta.commodity }, d.tons) } : null)}
                  label={`The dock for ${plan.label}: ${statusWord(plan)}`} />
                <DeskMap net={net} plan={plan} dim={st.solving} highlight={null} onPick={onMapPick}
                  onHover={(p, x, y) => setTip(p ? { x, y, text: tipOf(p, p.tons) } : null)} label={`The map for ${plan.label}: ribbon width is tons`} />
              </div>
              <div className="desk-explain">
                {plan.status === "Infeasible" ? (
                  <>
                    <p className="readout-line"><span className="status status--error">INFEASIBLE</span> · NO PLAN KEEPS EVERY PROMISE.</p>
                    <button type="button" className="btn-square" autoFocus onClick={() => change({ relax: true })}>EXPLAIN WHY</button>
                  </>
                ) : plan.relaxation ? (
                  <>
                    <WordsBlock words={plan.relaxation.words.length ? plan.relaxation.words : ["NO CONSTRAINT HAD TO BE RELAXED."]} k={`${plan.id}${plan.objective}`} />
                    <p className="readout-line readout-line--muted">{model!.penalties.note.toUpperCase()}</p>
                  </>
                ) : (
                  <ul className="binding" aria-label="Binding constraints">
                    {dualBinding.length === 0 ? <li>NO CONSTRAINT BINDS AT THIS OPTIMUM.</li> : dualBinding.map((b) => (
                      <li key={b.id}>{b.group === "open_sites" ? "AT THE SITE LIMIT" : b.group === "capacity" ? `${b.id} AT ITS CAPACITY` : `${b.id} FULLY SHIPPED`}{b.shadow_usd_per_unit !== null ? <> · ONE MORE {b.unit.toUpperCase()} SAVES <b className="derived tnum">{fixed(b.shadow_usd_per_unit, 2)} USD</b> (DERIVED, CONDITIONAL ON THE OPEN SET)</> : null}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </ArtifactStatus>
      </div>
      <Tooltip x={tip?.x ?? 0} y={tip?.y ?? 0} visible={!!tip}>{tip?.text}</Tooltip>
      <Sheet open={sheet && cls === "M"} onClose={() => setSheet(false)} title="CONTROLS" className="desk-sheet">{core && model && st.params ? rail(true) : null}</Sheet>
      {core && net ? <Inspector scene="desk" net={net} plan={plan} pub={plan ? core.sol.scenarios.find((s) => s.id === plan.id) : null} /> : null}
      <span className="sr-only" aria-live="polite">{inDesk ? "" : ""}</span>
    </Track>
  );
}

function Elapsed({ from }: { from: number }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setT(performance.now() - from), 50);
    return () => window.clearInterval(id);
  }, [from]);
  return <span className="tnum">{fixed(Math.max(0, t), 0)}</span>;
}

function ControlRow({ c, params, net, onChange, stacked }: { c: Control; params: Params; net: NonNullable<ReturnType<typeof useCore>>["net"]; onChange: (p: Partial<Params>) => void; stacked: boolean }) {
  const key = c.id as keyof Params;
  if (c.kind === "range") {
    const v = params[key] as number;
    const pct = ((v - c.min!) / (c.max! - c.min!)) * 100;
    return (
      <label className="slider" style={{ ["--fillpct" as string]: `${pct}%` }}>
        <span className="slider__head"><span>{c.label.toUpperCase()}</span><span className="tnum">{c.id === "max_open_sites" ? v : `x${fixed(v, 2)}`}</span></span>
        <input type="range" min={c.min!} max={c.max!} step={c.step!} value={v} aria-label={c.label} onChange={(e) => onChange({ [key]: Number(e.target.value) } as Partial<Params>)} />
      </label>
    );
  }
  if (c.kind === "multiselect") {
    const closed = new Set(params.closed_sites);
    const order = net.sites.map((s, f) => ({ f, lon: s.lon })).sort((a, b) => a.lon - b.lon).map((s) => s.f);
    return (
      <div className="closed-grid" role="group" aria-label="Closed sites">
        <span className="seg-ctl__label">{c.label.toUpperCase()}</span>
        <div className="closed-grid__row">
          {order.map((f) => (
            <button key={f} type="button" className={`closed-sq ${closed.has(f) ? "is-closed" : ""} ${stacked ? "is-tall" : ""}`} aria-pressed={closed.has(f)} aria-label={`${net.sites[f]!.short_name}: ${closed.has(f) ? "closed" : "available"}`} title={net.sites[f]!.short_name}
              onClick={() => { const n = new Set(closed); if (n.has(f)) n.delete(f); else n.add(f); onChange({ closed_sites: [...n].sort((a, b) => a - b) }); }}>
              {net.sites[f]!.id}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="seg-ctl" role="group" aria-label={c.label}>
      <span className="seg-ctl__label">{c.label.toUpperCase()}</span>
      <button type="button" className={`chip-btn ${params.relax ? "is-on" : ""}`} aria-pressed={params.relax} onClick={() => onChange({ relax: !params.relax })}>{params.relax ? "ON" : "OFF"}</button>
    </div>
  );
}
void (null as unknown as Model);
