import { useMemo } from "react";
import { Track } from "../scroll/Track";
import { StoryDeck, type DeckCard } from "../components/StoryDeck";
import { HonestyChip } from "../components/HonestyChip";
import { SceneErrors, ArtifactStatus } from "../components/StateUI";
import { useArtifact } from "../data/useArtifact";
import { useNear } from "../scroll/useNear";
import { CORE_SPECS, MODEL, QUALITY, useCore } from "./data";
import { buildLp, fullParams, sha256 } from "../model/lp";
import { albers, greatCircle, haversineMi } from "../map/project";
import { int, fixed } from "../model/format";
import { fact } from "../data/copy";
import { useEffect, useState } from "react";
import type { ArtifactSpec } from "../data/loader";
import type { Network, Quality } from "../model/types";
import type { SceneDef } from "../app/scenes";
import { scenarioPlan } from "../model/plans";

/** The join ledger as a falling count: each line is the previous minus its stated drop; a wrong subtraction would print an X. */
export function ledgerLines(q: Quality) {
  const j = q.join_ledger as Record<string, number>;
  const rows: { text: string; ok: boolean | null }[] = [];
  const line = (label: string, v: number, check?: number) => rows.push({ text: `${int(v)} ${label}`, ok: check === undefined ? null : check === v });
  line("GAZETTEER ROWS", j.gazetteer_rows!);
  rows.push({ text: `−${int(j.gazetteer_unmatched_to_pep!)} NO PEP MATCH (MOSTLY CENSUS-DESIGNATED PLACES)`, ok: null });
  line("JOINED", j.joined!, j.gazetteer_rows! - j.gazetteer_unmatched_to_pep!);
  rows.push({ text: `−${int(j.dropped_not_active_either_file!)} NOT ACTIVE IN EITHER FILE`, ok: null });
  line("ACTIVE", j.active_joined!, j.joined! - j.dropped_not_active_either_file!);
  rows.push({ text: `−${int(j.dropped_non_contiguous!)} OUTSIDE THE CONTIGUOUS US`, ok: null });
  rows.push({ text: `−${int(j.dropped_zero_pop!)} ZERO POPULATION`, ok: null });
  line("USABLE", j.usable_places!, j.active_joined! - j.dropped_non_contiguous! - j.dropped_zero_pop!);
  rows.push({ text: `${q.selection.demand_nodes} LARGEST`, ok: null });
  return rows;
}

function JoinVisual({ q, net, active }: { q: Quality; net: Network; active: boolean }) {
  const proj = useMemo(() => albers(net), [net]);
  const pts = useMemo(() => {
    const p = net.demand_nodes.map((n) => { const [x, y] = proj(n.lat, n.lon); return { x, y, r: n.pop2025 }; });
    const x0 = Math.min(...p.map((a) => a.x)), x1 = Math.max(...p.map((a) => a.x)), y0 = Math.min(...p.map((a) => a.y)), y1 = Math.max(...p.map((a) => a.y));
    return { p, x0, x1, y0, y1 };
  }, [net, proj]);
  const rows = ledgerLines(q);
  const W = 300, H = 120, pad = 6;
  const s = Math.min((W - 2 * pad) / (pts.x1 - pts.x0), (H - 2 * pad) / (pts.y1 - pts.y0));
  return (
    <div className="join">
      <ol className={`ledger ${active ? "is-on" : ""}`}>
        {rows.map((r, i) => (
          <li key={i} style={{ ["--i" as string]: i } as React.CSSProperties}>
            {r.text}{r.ok === null ? null : r.ok ? <span className="ok"> ✓</span> : <span className="bad"> ✗</span>}
          </li>
        ))}
      </ol>
      <svg className="join-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`The ${net.demand_nodes.length} demand places in an equal-area projection, one white point each`}>
        {pts.p.map((a, i) => (
          <circle key={i} cx={pad + (a.x - pts.x0) * s} cy={H - pad - (a.y - pts.y0) * s} r={0.9 + 3.2 * Math.sqrt(a.r / 8.6e6) * 0.5} fill="#fff" />
        ))}
      </svg>
    </div>
  );
}

function RulesVisual({ net }: { net: Network }) {
  const c = net.constants as Record<string, number | number[]>;
  const lines = [
    `SITES: ${net.sites.length} FROM THE ${c.site_pool} LARGEST, FARTHEST-POINT, SEED ${c.seed}`,
    `PLANTS: ${net.plants.length}, SUPPLY ${fixed(c.supply_headroom as number, 2)} x DEMAND`,
    `DEMAND: POPULATION x RATE x NOISE (SD ${c.noise_sd})`,
    `CAPACITY: PROPORTIONAL TO DEMAND, ${c.capacity_headroom} x`,
    `FIXED COST: ${fixed((c.fixed_base_usd_yr as number) / 1e6, 0)} M x LAND INDEX`,
  ];
  return <ul className="rules">{lines.map((l, i) => <li key={i} style={{ ["--i" as string]: i } as React.CSSProperties}>{l}</li>)}</ul>;
}

function MilesVisual({ net }: { net: Network }) {
  const a = net.plants[0]!, b = net.sites[3]!;
  const proj = albers(net);
  const path = greatCircle([a.lat, a.lon], [b.lat, b.lon], 24).map(([la, lo]) => proj(la, lo));
  const gc = haversineMi([a.lat, a.lon], [b.lat, b.lon]);
  const x0 = Math.min(...path.map((q) => q[0])), x1 = Math.max(...path.map((q) => q[0])), y0 = Math.min(...path.map((q) => q[1])), y1 = Math.max(...path.map((q) => q[1]));
  const s = 60 / Math.max(x1 - x0, y1 - y0, 1e-6);
  const P = path.map(([x, y]) => `${(20 + (x - x0) * s).toFixed(1)},${(80 - (y - y0) * s).toFixed(1)}`);
  return (
    <div className="miles">
      <svg viewBox="0 0 200 100" role="img" aria-label={`Great-circle path from ${a.short_name} to ${b.short_name}`}>
        <polyline points={P.join(" ")} fill="none" stroke="#58B8E1" strokeWidth="1.4" strokeDasharray="200" className="miles-path" />
        <rect x={P[0]!.split(",")[0]} y={Number(P[0]!.split(",")[1]) - 3} width="6" height="6" fill="#B48CFF" transform="translate(-3 0)" />
        <rect x={P.at(-1)!.split(",")[0]} y={Number(P.at(-1)!.split(",")[1]) - 3} width="6" height="6" fill="#B48CFF" transform="translate(-3 0)" />
      </svg>
      <p className="miles-calc tnum">{a.short_name.toUpperCase()} TO {b.short_name.toUpperCase()}: {fixed(net.in_road_mi[0]![3]!, 1)} MI = {fixed(gc, 1)} GREAT-CIRCLE x 1.2</p>
      <p className="miles-strike">NO ROAD ROUTING</p>
    </div>
  );
}

function ModelVisual({ net, near }: { net: Network; near: boolean }) {
  const [ms, retry] = useArtifact(MODEL, near);
  const core = useCore();
  const [hash, setHash] = useState<string | null>(null);
  const model = ms.status === "ready" ? ms.data : null;
  useEffect(() => {
    if (!model) return;
    const p = fullParams(model, model.defaults);
    const text = buildLp(net, model, p);
    let live = true;
    void sha256(text).then((h) => live && setHash(h));
    return () => { live = false; };
  }, [model, net]);
  const plan = core ? scenarioPlan(net, core.sol, "optimized") : null;
  const text = model ? buildLp(net, model, fullParams(model, model.defaults)).split("\n").filter((l) => !l.startsWith("\\")).slice(0, 3).map((l) => l.slice(0, 44)) : [];
  const pub = plan?.lpSha ?? null;
  return (
    <div className="lphead">
      <ArtifactStatus file="model.json" state={ms} retry={retry} empty="UNAVAILABLE">
        {() => (
          <>
            <div className="lphead__pair">
              <div><p className="lphead__who">PYTHON · highspy 1.15.1</p><p className="lphead__sha tnum">SHA-256 {pub?.slice(0, 12) ?? "…"}</p></div>
              <div><p className="lphead__who">BROWSER · HiGHS-wasm 1.15.3</p><p className="lphead__sha tnum">SHA-256 {hash ? hash.slice(0, 12) : "…"}{hash && pub ? (hash === pub ? <span className="ok"> ✓</span> : <span className="bad"> ✗</span>) : null}</p></div>
            </div>
            <pre className="lphead__text">{text.join("\n")}</pre>
          </>
        )}
      </ArtifactStatus>
    </div>
  );
}

export function S02Real({ def }: { def: SceneDef }) {
  const core = useCore();
  const near = useNear(def.id);
  const [qs, qRetry] = useArtifact(QUALITY, near);
  const cards: DeckCard[] = [];
  if (core) {
    const { net, facts, meta } = core;
    const q = qs.status === "ready" ? qs.data : null;
    cards.push({
      variant: "dark", chip: "1 OF 4 · OBSERVED", title: "A hundred real places.",
      visual: (a: boolean) => (q ? <JoinVisual q={q} net={net} active={a} /> : <ArtifactStatus file="quality.json" state={qs} retry={qRetry} empty="UNAVAILABLE">{() => null}</ArtifactStatus>),
      body: <><p>THE ONLY OBSERVED NUMBERS ON THIS SITE: WHERE {fact(facts, "demand_nodes")} US CITIES ARE AND HOW MANY PEOPLE LIVE THERE.</p>
        <p className="card-fine">{q ? q.selection.internal_point_note.toUpperCase() : ""} {meta.licence_note.toUpperCase()}</p></>,
      tag: <HonestyChip tag="OBSERVED" detail="CENSUS PEP 2025" />,
    });
    cards.push({
      variant: "violet", chip: "2 OF 4 · SYNTHETIC", title: "Everything else is invented.", visual: <RulesVisual net={net} />,
      body: <p>SITES, PLANTS, CAPACITIES, VOLUMES AND COSTS COME FROM STATED RULES AND A FIXED SEED. NO REAL COMPANY, NO REAL FREIGHT PRICE.</p>,
      tag: <HonestyChip tag="SYNTHETIC" />,
    });
    cards.push({
      variant: "dark", chip: "3 OF 4 · DERIVED", title: "Miles, not roads.", visual: <MilesVisual net={net} />,
      body: <p>EVERY DISTANCE IS A GREAT-CIRCLE TIMES 1.2. THERE IS NO ROAD ROUTING AND NO TRANSIT TIME.</p>,
      tag: <HonestyChip tag="DERIVED" detail="GREAT-CIRCLE x 1.2" />,
    });
    cards.push({
      variant: "dark", chip: "4 OF 4 · SYNTHETIC", title: "One model, two solvers.", visual: <ModelVisual net={net} near={near} />,
      body: <><p>PYTHON AND YOUR BROWSER BUILD THE SAME LP TEXT, BYTE FOR BYTE, AND GET THE SAME ANSWER.</p>
        <p className="card-fine tnum">{fact(facts, "model_columns") ? `${int(fact(facts, "model_columns"))} COLUMNS · ${int(fact(facts, "model_rows"))} ROWS · ${meta.sizes.binaries ?? 14} YES/NO DECISIONS · ` : ""}{fact(facts, "parity_vectors_run")} VECTORS · {fact(facts, "parity_failures")} FAILURES · MEDIAN {fact(facts, "parity_wasm_ms_median")} MS IN WASM · HIGHSPY 1.15.1 · HIGHS-WASM 1.15.3 · MIP GAP 0</p></>,
      tag: <HonestyChip tag="SYNTHETIC" detail="PARITY CHECKED" />,
    });
  }
  return (
    <Track id={def.id} height={def.track} landing={def.landing} className={`scene scene-${def.id}`} label="What is real and what is invented">
      <SceneErrors id={def.id} specs={[...CORE_SPECS, QUALITY] as ArtifactSpec<unknown>[]} />
      <p className="scene-kicker real-kicker">WHAT IS REAL · WHAT IS INVENTED · AND HOW WE KNOW THE DIFFERENCE</p>
      <h2 id={`${def.id}-title`} tabIndex={-1} data-scene-heading className="sr-only">A hundred real places. Everything else is invented.</h2>
      {core ? <StoryDeck track={def.id} cards={cards} /> : null}
    </Track>
  );
}
