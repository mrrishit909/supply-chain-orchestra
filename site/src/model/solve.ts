/**
 * One HiGHS solve through highs-js (legacy string API) and its decode to a Plan. Shared by the worker (columns only
 * cross the thread boundary) and by Node Vitest, so the page and the parity test run the same code.
 */
import { buildLp, sha256 } from "./lp";
import { planFromSolve, type Plan, type Solved } from "./plan";
import type { Model, Network, Params } from "./types";

export interface HighsLike {
  solve(lp: string, opts?: Record<string, unknown>): {
    Status: string; ObjectiveValue: number;
    Columns: Record<string, { Primal: number }>; Rows: { Name?: string; Dual: number }[];
  };
}

/** The published solver options (model.json), with the browser's time limit. */
export function solverOptions(model: Model, timeLimit?: number) {
  const o = { ...model.solver.options } as Record<string, unknown>;
  o.time_limit = timeLimit ?? model.solver.browser.time_limit_s;
  return o;
}

export function solveText(h: HighsLike, model: Model, text: string, timeLimit?: number): Solved {
  const t0 = performance.now();
  const s = h.solve(text, solverOptions(model, timeLimit));
  const ms = performance.now() - t0;
  const columns: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.Columns)) if (v.Primal !== 0) columns[k] = v.Primal;
  return { status: s.Status, objective: Number.isFinite(s.ObjectiveValue) ? s.ObjectiveValue : null, columns, ms };
}

export async function solvePlan(h: HighsLike, net: Network, model: Model, params: Params, timeLimit?: number): Promise<{ plan: Plan; text: string }> {
  const text = buildLp(net, model, params);
  const s = solveText(h, model, text, timeLimit);
  return { plan: planFromSolve(net, model, params, s, await sha256(text)), text };
}

/** Row duals of the LP with the open set fixed (DERIVED shadow prices, conditional on that set), by row name. */
export function fixedDesignDuals(h: HighsLike, net: Network, model: Model, params: Params, open: number[]): Record<string, number> {
  const text = buildLp(net, model, { ...params, fixed_open: open }, { continuous: true });
  const s = h.solve(text, { output_flag: false, threads: 1, random_seed: 0 });
  const out: Record<string, number> = {};
  if (s.Status !== "Optimal") return out;
  for (const r of s.Rows) if (r.Name) out[r.Name] = r.Dual;
  return out;
}
