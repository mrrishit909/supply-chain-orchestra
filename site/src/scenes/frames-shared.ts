import { camOfRoom, fallbackG1, roomOf, type Cam, type Layout } from "./geometry";

/** The camera of a scene's measured disc slot, or `fallback` before the DOM exists. */
export function slotCam(key: string, L: Layout, fit = 1, fallback?: Cam): Cam {
  const r = roomOf(key);
  return r ? camOfRoom(r, fit) : fallback ?? fallbackG1(L);
}
export const G1 = (L: Layout) => slotCam("journey:disc", L);
