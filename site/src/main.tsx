import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "lenis/dist/lenis.css";
import "./styles/app.css";
import "./styles/scenes.css";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { App } from "./app/App";
import { getProgress, jumpTo, startEngine } from "./scroll/engine";
import { debug, dockReport, intro, introTime, quality } from "./scenes/director";
import { brk, limits, sites, storms, unfold, inspector } from "./state/scenes";
import { unfoldView } from "./scenes/frames-unfold";
import { testHooks, getSolver } from "./state/solver";
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
    dock: () => dockReport(),
    unfoldInfo: () => ({ t: unfoldView.t, e: unfoldView.e, count: unfoldView.count, plan: unfoldView.plan, widths: unfoldView.strands.slice(0, 400).map((s) => ({ kind: s.kind, site: s.site, end: s.end, c: s.commodity, tons: s.tons, wMap: s.wMap, wDock: s.wDock, dock0: [s.dock[0], s.dock[1]], map0: [s.map[0], s.map[1]], dockN: [s.dock[48], s.dock[49]], mapN: [s.map[48], s.map[49]] })) }),
    set: {
      sites: (p: Partial<ReturnType<typeof sites.get>>) => sites.set(p),
      brk: (p: Partial<ReturnType<typeof brk.get>>) => brk.set(p),
      storms: (p: Partial<ReturnType<typeof storms.get>>) => storms.set(p),
      unfold: (p: Partial<ReturnType<typeof unfold.get>>) => unfold.set(p),
      limits: (p: Partial<ReturnType<typeof limits.get>>) => limits.set(p),
    },
    state: () => ({ sites: sites.get(), brk: { ...brk.get(), live: !!brk.get().live }, storms: storms.get(), unfold: unfold.get(), limits: { step: limits.get().step, cap: limits.get().cap, check: limits.get().check }, inspector: inspector.get() }),
    solverState: () => { const s = getSolver(); return { status: s.status, loaded: s.loaded, version: s.version, error: s.error, solving: s.solving }; },
    failWorker: (v: boolean) => { testHooks.failWorker = v; },
    marks: () => [] as { name: string; x: number; y: number; w: number; h: number }[],
    labelBoxes: () => debug.labels.map((l) => ({ ...l })),
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
