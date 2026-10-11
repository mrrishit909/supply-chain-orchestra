import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "lenis/dist/lenis.css";
import "./styles/app.css";
import "./styles/scenes.css";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { App } from "./app/App";
import { getProgress, jumpTo, startEngine } from "./scroll/engine";
import { debug, intro, introTime, quality } from "./scenes/director";
import { currentClass } from "./graphics/canvas";
import { layout } from "./scenes/geometry";

// Test and evidence hook (sco = Supply Chain Orchestra): the same instant-jump path the nav uses.
Object.assign(window, {
  __sco: {
    jumpTo, getProgress,
    quality: () => ({ tier: quality.tier, median: quality.median }),
    /** freeze the S00 clock at t ms (evidence frames); -1 releases it */
    freeze: (t: number) => { intro.frozen = t; if (t >= 0) intro.playing = true; },
    introT: () => introTime(performance.now()),
    introStats: () => ({ playing: intro.playing, monotonic: intro.monotonic, minLine: intro.minLine, lineAt: intro.lineAt, G0: layout(document.documentElement.clientWidth, innerHeight).G0 }),
    debug: () => ({ frames: debug.frames, scene: debug.scene, sig: debug.sig, discs: debug.discs.map((d) => ({ ...d })), line: [...debug.line], tier: debug.tier }),
    discs: () => debug.discs.map((d) => ({ ...d })),
    marks: () => debug.labels.map((l) => ({ ...l })),
    cls: () => ({ js: currentClass(), css: getComputedStyle(document.documentElement).getPropertyValue("--vp-class").trim(), layout: layout(document.documentElement.clientWidth, innerHeight).cls, clientWidth: document.documentElement.clientWidth, innerWidth }),
  },
});

startEngine();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
