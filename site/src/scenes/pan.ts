import { Tween } from "../motion/tween";
import { DUR, easeSmooth } from "../motion/ease";

/**
 * The dock pan (phones, G0 states; interaction 1 and 11, MOTION_SYSTEM 5.3): a horizontal drag that starts on the dock
 * band moves the camera along x, never the page. The arrows move it one column. Fades to 0 as the disc leaves G0.
 */
const tw = new Tween(0, DUR.standard, easeSmooth);
export const pan = {
  /** current offset in px (read once per frame) */
  value(now: number) { tw.update(now); return tw.value; },
  get target() { return tw.target; },
  /** direct manipulation: follow the finger without easing */
  drag(x: number, limit: number) { tw.value = Math.max(-limit, Math.min(limit, x)); tw.retarget(tw.value, performance.now(), 0); },
  /** one column (about a quarter of the disc radius) with the standard ease */
  nudge(dir: -1 | 1, R: number, limit: number) { tw.retarget(Math.max(-limit, Math.min(limit, tw.target + dir * 0.28 * R)), performance.now(), DUR.standard); },
  reset() { tw.retarget(0, performance.now(), 0); },
};
