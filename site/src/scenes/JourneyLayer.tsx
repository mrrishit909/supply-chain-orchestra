import { createPortal } from "react-dom";
import { useState } from "react";
import { HonestyChip } from "../components/HonestyChip";
import { CommodityLegend } from "../components/Legend";
import { NotificationCard } from "../components/NotificationCard";
import { WordReveal } from "../components/WordReveal";
import { SceneErrors } from "../components/StateUI";
import { DockStill } from "../components/DockStill";
import type { ArtifactSpec } from "../data/loader";
import { useArtifact } from "../data/useArtifact";
import { FACTS, NETWORK, SOLUTIONS } from "../data/artifacts";
import { s00, s01 } from "../data/copy";
import { scenarioPlan } from "../model/plans";
import { easeSymmetric } from "../motion/ease";
import { windowed } from "../motion/progress";
import { currentClass } from "../graphics/canvas";
import { useMotion, useProgress } from "../scroll/hooks";
import { Slot } from "./Slot";
import { DockPan } from "../components/DockPan";
import { layout } from "./geometry";

const motionOn = () => document.documentElement.dataset.motion !== "off";

/** S00 / S01 layer (portal into the static hero): statement, cards, tags, legend, the reduced-motion still. */
export function JourneyLayer({ introPlaying }: { introPlaying: boolean }) {
  const [ns] = useArtifact(NETWORK);
  const [ss] = useArtifact(SOLUTIONS);
  const [fs] = useArtifact(FACTS);
  const motion = useMotion();
  const [cards, setCards] = useState(0);
  const [atTop, setAtTop] = useState(true);
  const plan = ns.status === "ready" && ss.status === "ready" ? scenarioPlan(ns.data, ss.data, "optimized") : null;
  useProgress("journey", (p) => {
    document.querySelector<HTMLElement>(".hero-scrim")?.style.setProperty("--scrim", String(1 - windowed(p, 0, 0.4)));
    const h = document.querySelector<HTMLElement>("h1[data-hero]");
    if (h) {
      const e = motionOn() ? easeSymmetric(windowed(p, 0, 0.4)) : 0;
      const cls = currentClass();
      const top = cls === "D" ? (layout(innerWidth, innerHeight).compact ? 64 : 96) : cls === "T" ? 84 : 56;
      const dy = (top - h.offsetTop) * e;
      h.style.transform = e > 0 ? `translateY(${dy.toFixed(1)}px) scale(${(1 - 0.52 * e).toFixed(4)})` : "";
    }
    document.querySelector<HTMLElement>(".intro-corner")?.style.setProperty("--corner", String(1 - windowed(p, 0.02, 0.12)));
    document.querySelector<HTMLElement>(".journey-foot")?.style.setProperty("opacity", String(1 - windowed(p, 0.02, 0.1)));
    if (motionOn()) document.querySelector<HTMLElement>(".s01-statement")?.style.setProperty("opacity", String(windowed(p, 0.3, 0.36)));
    setCards((o) => (p >= 0.6 ? o || Date.now() : 0));
    setAtTop((o) => (o === p < 0.1 ? o : p < 0.1));
  });
  const still = document.getElementById("journey-still");
  return (
    <>
      <SceneErrors id="journey" specs={[NETWORK, SOLUTIONS, FACTS] as ArtifactSpec<unknown>[]} />
      {!motion && plan && ns.status === "ready" && still ? createPortal(
        <DockStill className="journey-still" net={ns.data} label={s00.h1 + " The dock at its giant size."} fit={1.08} spec={{ A: plan, mix: 0 }} labels />, still,
      ) : null}
      <div className="s01">
        <Slot scene="journey" name="disc" />
        <WordReveal as="p" className="s01-statement" text={s01.statement} mode={motion ? { kind: "scrub", track: "journey", from: 0.35, to: 0.75 } : { kind: "value", t: 1 }} />
        {fs.status === "ready" && plan && ns.status === "ready" ? (
          <div className={`s01-cards ${cards || !motion ? "is-in" : ""}`}>
            {s01.cards(fs.data, plan, ns.data).map((c, i) => (
              <NotificationCard key={c.from} from={c.from} when={c.when} body={c.body} variant={i === 0 ? "dark" : "violet"} playKey={motion ? cards : 0}
                tag={<HonestyChip tag={c.tag} detail={c.tag === "SIMULATED" ? "SYNTHETIC COSTS" : "CENSUS PEP 2025"} />} />
            ))}
          </div>
        ) : null}
      </div>
      {motion ? <DockPan active={atTop} label="Pan the dock: drag along the dock line, or use the arrows" /> : null}
      <div className={`journey-foot ${introPlaying ? "is-waiting" : ""}`}>
        <div className="journey-foot__chips">
          <HonestyChip tag="SIMULATED" /><HonestyChip tag="SYNTHETIC" detail="NETWORK" /><HonestyChip tag="OBSERVED" detail="PLACES" />
        </div>
        <CommodityLegend />
      </div>
    </>
  );
}
