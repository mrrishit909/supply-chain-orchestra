/**
 * THE DESK store (VISUAL_DESIGN 3.4): one store holds params, preset, solution, source, status and selection; the disc,
 * the map, the ledger, the status line, the explanation and the inspector all derive from it.
 */
import { store } from "./store";
import type { Plan } from "../model/plan";
import type { Params } from "../model/types";
import type { Pick } from "./scenes";

export interface DeskState {
  params: Params | null;
  /** the published preset whose params equal `params` exactly, if any */
  preset: string | null;
  plan: Plan | null;
  /** previous plan kept at 60% while a solve is in flight */
  solving: boolean;
  error: string | null;
  fallback: string | null;
  note: string | null;
  seq: number;
  selection: Pick;
  resetFlash: boolean;
  duals: Record<string, number> | null;
  /** hash check of a live solve against its matching preset */
  hashOk: boolean | null;
  timeLimit: number | undefined;
}
export const desk = store<DeskState>({ params: null, preset: null, plan: null, solving: false, error: null, fallback: null, note: null, seq: 0, selection: null, resetFlash: false, duals: null, hashOk: null, timeLimit: undefined });
