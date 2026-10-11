import { useCallback, useEffect, useState } from "react";
import { addFrame } from "../motion/loop";
import { Reveal } from "../motion/reveal";
import { motionEnabled } from "../state/motion";
import { INTRO_MS, intro, introTime } from "../scenes/director";
import { getStore } from "../data/loader";
import { NETWORK, SOLUTIONS } from "../data/artifacts";
import { s00, s00Line1, s00Source } from "../data/copy";
import { scenarioPlan } from "../model/plans";

const KEY = "sco.intro";
const seen = () => { try { return sessionStorage.getItem(KEY) === "done"; } catch { return false; } };
const markSeen = () => { try { sessionStorage.setItem(KEY, "done"); } catch { /* storage blocked: plays again next load */ } };

/**
 * S00 "The Dock Opens" clock (MOTION_SYSTEM 5.1). The dock timeline lives in the director; this drives the DOM from the
 * same clock: corner labels (200-500ms), the headline sharpening (3600ms, 80ms stagger, 350ms per word), the nav (4200ms).
 * SKIP, Esc and any wheel / touch / key scroll complete it in 350ms; scroll is never locked. Once per session;
 * reduced motion renders the end state on the first frame.
 */
export function useIntro() {
  const [playing, setPlaying] = useState(() => motionEnabled() && !seen());
  const [navIn, setNavIn] = useState(() => !playing);
  const [run, setRun] = useState(0);

  const complete = useCallback(() => {
    if (!intro.playing || intro.completeFrom >= 0 || intro.frozen >= 0) return;
    const now = performance.now();
    intro.completeFrom = introTime(now);
    intro.completeAt = now;
    setNavIn(true);
  }, []);

  useEffect(() => {
    const h = document.querySelector<HTMLElement>("h1[data-hero]");
    const reveal = h ? new Reveal(h) : null;
    const a = document.querySelector<HTMLElement>("[data-intro-a]");
    const b = document.querySelector<HTMLElement>("[data-intro-b]");
    const corners = document.querySelectorAll<HTMLElement>("[data-intro-corner]");
    const ns = getStore(NETWORK), ss = getStore(SOLUTIONS);
    const bind = () => {
      if (ns.state.status !== "ready" || ss.state.status !== "ready") return;
      const p = scenarioPlan(ns.state.data, ss.state.data, "optimized");
      if (!p) return;
      if (a) a.textContent = s00Line1(p, ns.state.data);
      if (b) b.textContent = `${s00Source(p)} · ${s00.line2}`;
    };
    bind();
    const u1 = ns.subscribe(bind), u2 = ss.subscribe(bind);
    const unsub = () => { u1(); u2(); };
    if (!playing) {
      intro.playing = false;
      reveal?.set(1);
      corners.forEach((c) => (c.style.opacity = ""));
      return unsub;
    }
    Object.assign(intro, { playing: true, start: 0, completeFrom: -1, completeAt: 0, minLine: Infinity, lastLine: 0, monotonic: true, lineAt: -1 });
    reveal?.set(0);
    let navShown = false;
    const off = addFrame((now) => {
      const t = introTime(now);
      const c = String(Math.max(0, Math.min(1, (t - 200) / 300)));
      corners.forEach((el) => (el.style.opacity = c));
      reveal?.timed(t - 3600, 350, 80);
      if (!navShown && t >= 4200) { navShown = true; setNavIn(true); }
      if (t >= INTRO_MS && intro.frozen < 0) {
        off();
        intro.playing = false;
        reveal?.set(1);
        markSeen();
        setPlaying(false);
      }
    }, 20);
    const onKey = (e: KeyboardEvent) => {
      if (["Escape", "ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "End", "Home"].includes(e.key)) complete();
    };
    addEventListener("wheel", complete, { passive: true });
    addEventListener("sco:jump", complete);
    addEventListener("touchmove", complete, { passive: true });
    addEventListener("keydown", onKey);
    return () => {
      off(); unsub();
      removeEventListener("wheel", complete);
      removeEventListener("sco:jump", complete);
      removeEventListener("touchmove", complete);
      removeEventListener("keydown", onKey);
    };
  }, [playing, run, complete]);

  const replay = useCallback(() => {
    scrollTo(0, 0);
    if (!motionEnabled()) return; // the 0ms version is the end state
    setNavIn(false);
    setPlaying(true);
    setRun((r) => r + 1);
  }, []);

  return { playing, navIn, skip: complete, replay };
}
