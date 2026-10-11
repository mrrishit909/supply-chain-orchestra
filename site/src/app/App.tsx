import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Nav } from "../components/Nav";
import { Track } from "../scroll/Track";
import { jumpTo, registerTrack, resolveInitialHash } from "../scroll/engine";
import { useActiveScene } from "../scroll/hooks";
import { NAV_ITEMS, SCENES, navActive, sceneIndex, type SceneDef } from "./scenes";
import { useIntro } from "./useIntro";
import { getStore } from "../data/loader";
import { FACTS, META, MODEL, NETWORK, QUALITY, SOLUTIONS } from "../data/artifacts";
import { startDirector } from "../scenes/director";
import { JourneyLayer } from "../scenes/JourneyLayer";
import { idle } from "../lib/math";
import "../scenes/frames-journey";
import "../scenes/frames-real";
import "../scenes/frames-sites";
import "../scenes/frames-limits";
import { S03bLimits } from "../scenes/S03bLimits";
import { S02Real } from "../scenes/S02Real";
import { S03aSites } from "../scenes/S03aSites";
import { SiteFoot } from "../components/SiteFoot";

function Placeholder({ s }: { s: SceneDef }) {
  return (
    <Track id={s.id} height={s.track} landing={s.landing} className={`scene scene-${s.id} scene--placeholder`}>
      <div className="placeholder">
        <p className="scene-kicker">{s.code} · {s.nav ?? "CLOSING"}</p>
        <h2 id={`${s.id}-title`} tabIndex={-1} data-scene-heading className="placeholder__title">{s.title}</h2>
      </div>
    </Track>
  );
}

const SCENE_COMPONENTS: Record<string, (p: { def: SceneDef }) => React.ReactNode> = { real: S02Real, sites: S03aSites, limits: S03bLimits };

/** App: the static S00/S01 track (index.html) plus the React scenes, the dock canvases and the nav. */
export function App() {
  const active = useActiveScene();
  const intro = useIntro();
  const main = useRef<HTMLCanvasElement>(null);
  const glow = useRef<HTMLCanvasElement>(null);
  const bloom = useRef<HTMLCanvasElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = document.getElementById("journey");
    return el ? registerTrack("journey", el, SCENES[0]!.landing) : undefined;
  }, []);
  useEffect(() => {
    // first paint needs facts, meta, network and the solutions (27.6 KB gz); nothing else (MOTION_SYSTEM 9.3)
    for (const a of [FACTS, META, NETWORK, SOLUTIONS]) getStore(a as never).prefetch();
    return startDirector({ main: main.current!, glow: glow.current!, bloom: bloom.current!, labels: labels.current! });
  }, []);
  useEffect(() => { resolveInitialHash(); }, []);
  useEffect(() => {
    if (intro.playing) return;
    idle(() => { for (const a of [MODEL, QUALITY]) getStore(a as never).prefetch(); });
  }, [intro.playing]);
  void active; void sceneIndex;
  const portal = document.getElementById("journey-portal");
  return (
    <>
      <canvas ref={bloom} className="dock-layer dock-layer--bloom" aria-hidden="true" />
      <canvas ref={main} className="dock-layer dock-layer--main" aria-hidden="true" />
      <canvas ref={glow} className="dock-layer dock-layer--glow" aria-hidden="true" />
      <div ref={labels} className="dock-labels" aria-hidden="true" />
      <Nav
        items={NAV_ITEMS}
        active={navActive(active)}
        onJump={(id) => jumpTo(id, undefined, { push: true, focus: true })}
        introPlaying={!intro.navIn}
        onSkip={intro.skip}
        onReplay={intro.replay}
      />
      <SiteFoot hidden={intro.playing} />
      {portal ? createPortal(<JourneyLayer introPlaying={intro.playing} />, portal) : null}
      {SCENES.slice(1).map((s) => {
        const C = SCENE_COMPONENTS[s.id];
        return C ? <C key={s.id} def={s} /> : <Placeholder key={s.id} s={s} />;
      })}
    </>
  );
}
