import { registerFrame } from "./director";
import { camera } from "./geometry";
import { G1, slotCam } from "./frames-shared";
import { easeSymmetric } from "../motion/ease";
import { windowed } from "../motion/progress";
import { scenarioPlan } from "../model/plans";

/** S02: the disc holds at G1 as the deck's backdrop at 20%; in the last 15% it moves to G2 and brightens (VISUAL_DESIGN 3.4). */
registerFrame("real", ({ p, L, net, solutions, W, H }) => {
  const plan = scenarioPlan(net, solutions, "optimized");
  if (!plan) return null;
  const e = easeSymmetric(windowed(p, 0.85, 1));
  const cam = camera(G1(L), slotCam("sites:disc", L, 1, G1(L)), e);
  const opacity = 0.2 + 0.8 * e;
  return { discs: [{ A: plan, mix: 0, cam, open: 1, squareAlpha: 0.7 }], opacity, glow: 0.6, sig: `real|${e.toFixed(3)}|${W}x${H}` };
});
