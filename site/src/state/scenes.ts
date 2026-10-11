/** Scene state shared by the scene DOM (React) and the director (per frame). */
import { store } from "./store";
import type { Plan } from "../model/plan";

/** S03a: exactly k sites open (scroll steps it, the stepper sets it). */
export const sites = store({ k: 14, relaxed: false });
/** S03b: the live capacity check. */
export interface Check { state: "idle" | "warming" | "ok" | "mismatch" | "error" | "fallback"; ms: number; hashOk: boolean | null; objOk: boolean | null; error: string | null; solving: boolean }
export const limits = store({ step: 0, cap: 1 as 1 | 1.05 | 1.1, live: null as Plan | null, check: { state: "idle", ms: 0, hashOk: null, objOk: null, error: null, solving: false } as Check });
/** S04: LEGACY | OPTIMIZED. */
export const unfold = store({ design: "legacy" as "legacy" | "optimized", t: 0 });
/** S05: case and mode (and, for STORM, the design the storm hits). */
export type BreakCase = "supply" | "capacity" | "sites" | "storm";
export const brk = store({ case: "supply" as BreakCase, mode: "strict" as "strict" | "relaxed", storm: "legacy" as "legacy" | "optimized", live: null as Plan | null });
/** S06: draw (index into the order), order, lost site. */
export const storms = store({ draw: 0, order: "legacy_cost" as "legacy_cost" | "index", lost: null as number | null, phase: "scrub" as "scrub" | "tail" | "lose" });
/** Journey inspector: one open selection at a time (interaction 9). */
export type Pick = { kind: "route"; rk: "in" | "out"; site: number; end: number; commodity: number } | { kind: "site"; id: number } | { kind: "city"; id: number } | null;
export const inspector = store({ scene: null as string | null, pick: null as Pick });
export const openPick = (scene: string, pick: Pick) => inspector.set({ scene, pick });
export const closePick = () => inspector.set({ scene: null, pick: null });
/** the visitor's last DESK solution (S08 echoes it) */
export const deskResult = store({ plan: null as Plan | null });
