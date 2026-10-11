import { useState, useSyncExternalStore } from "react";
import { Track } from "../scroll/Track";
import { HonestyChip } from "../components/HonestyChip";
import { WordReveal } from "../components/WordReveal";
import { SceneErrors } from "../components/StateUI";
import { DockStill } from "../components/DockStill";
import { CORE_SPECS, useCore } from "./data";
import { deskResult } from "../state/scenes";
import { useMotion, useProgress } from "../scroll/hooks";
import { jumpTo } from "../scroll/engine";
import { scenarioPlan } from "../model/plans";
import { sourceWord, statusWord } from "../data/copy";
import { musd } from "../model/format";
import { LINKS } from "../config";
import { useViewport } from "./useViewport";
import type { ArtifactSpec } from "../data/loader";
import type { SceneDef } from "../app/scenes";

const PARA = "A hundred real cities, one invented network, one year of freight in balance. Change a cost and the network rearranges; break a promise and it tells you which. Every product has a journey, and every journey here is a solved one.";

export function S08Closing({ def, onReplay }: { def: SceneDef; onReplay: () => void }) {
  const core = useCore();
  const motion = useMotion();
  const vp = useViewport();
  const mine = useSyncExternalStore(deskResult.subscribe, deskResult.get).plan;
  const [ph, setPh] = useState({ caption: false, links: false });
  useProgress(def.id, (p) => setPh((o) => (o.caption === p >= 0.74 && o.links === p >= 0.8 ? o : { caption: p >= 0.74, links: p >= 0.8 })));
  const show = motion ? ph : { caption: true, links: true };
  const net = core?.net;
  const usable = mine && mine.status !== "Infeasible" && mine.routesOut.length ? mine : null;
  const plan = usable ?? (core && net ? scenarioPlan(net, core.sol, "optimized") : null);
  const yours = !!usable && usable.id !== "optimized" && usable.source === "BROWSER";
  return (
    <Track id={def.id} height={def.track} landing={def.landing} className={`scene scene-${def.id}`} label="Every product, again">
      <SceneErrors id={def.id} specs={CORE_SPECS as ArtifactSpec<unknown>[]} />
      <div className="close-scrim" aria-hidden="true" />
      {!motion && core && net && plan ? (
        <div className="close-still"><DockStill net={net} spec={{ A: plan, mix: 0 }} fit={1.05} label="The giant dock of the year's freight" /></div>
      ) : null}
      <div className="close-corners" aria-hidden="true"><p className="wordmark">SUPPLY CHAIN ORCHESTRA</p></div>
      <div className="close-text">
        <WordReveal as="h2" id={`${def.id}-title`} tabIndex={-1} data-scene-heading className="close-para" text={PARA}
          mode={motion ? { kind: "scrub", track: def.id, from: 0.35, to: 0.65 } : { kind: "value", t: 1 }} />
        <div className={`close-foot ${show.caption ? "is-in" : ""}`}>
          {plan ? (
            <p className="close-caption tnum" data-caption>
              {statusWord(plan)} · {yours ? "SOLVED IN BROWSER · HiGHS" : sourceWord(plan)} · {plan.open.length} SITES · {musd(plan.objective ?? 0)} M USD / YR{" "}
              <HonestyChip tag="SIMULATED" detail={yours ? "YOUR SOLVE" : "SYNTHETIC NETWORK"} className="chip--inline" />
            </p>
          ) : null}
          <ul className={`close-links ${show.links ? "is-in" : ""}`}>
            <li><button type="button" className="text-btn" onClick={() => jumpTo("desk", 0, { push: true, focus: true })}>→ OPEN THE DESK</button></li>
            <li><button type="button" className="text-btn" onClick={onReplay}>→ REPLAY THE INTRO</button></li>
            <li><a className="text-btn" href={LINKS.methodology} target="_blank" rel="noopener">→ READ THE METHODOLOGY</a></li>
            <li><a className="text-btn" href={LINKS.source} target="_blank" rel="noopener">→ SOURCE CODE</a></li>
          </ul>
          {core ? (
            vp.cls === "M" ? (
              <details className="close-credit-d"><summary className="text-btn">SOURCES, LIMITS AND LICENCE NOTE</summary><p className="close-credit">{core.meta.licence_note.toUpperCase()} {core.meta.limitations.join(" ").toUpperCase()}</p></details>
            ) : <p className="close-credit">{core.meta.licence_note.toUpperCase()} {core.meta.limitations.join(" ").toUpperCase()} · MADE BY RISHIT MATHUR</p>
          ) : null}
        </div>
      </div>
    </Track>
  );
}
