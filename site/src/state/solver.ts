/**
 * Main-thread client of the solver worker (MOTION_SYSTEM 9.1, 6.3).
 * - created lazily: S03b entry or a DESK deep link, never on the LCP path (VISUAL_DESIGN criterion 9)
 * - latest-wins: at most one solve in flight and one pending
 * - real states: idle | loading (byte %) | ready | error; RETRY re-creates the worker; after 2 failures preset-only
 * - CANCEL terminates the worker (highs.solve is synchronous inside it) and starts a fresh one
 */
import type { FromWorker, ToWorker } from "../workers/solver.worker";
import { buildLp, sha256 } from "../model/lp";
import { planFromSolve, type Plan } from "../model/plan";
import { solverOptions } from "../model/solve";
import type { Model, Network, Params } from "../model/types";

export interface SolverState {
  status: "idle" | "loading" | "ready" | "error" | "disabled";
  loaded: number; total: number | null; version: string; loadMs: number;
  error: string | null; attempt: number;
  /** a solve is in flight longer than 150ms (no flicker) */
  solving: boolean; solveStart: number;
}
export type SolveOut = { plan: Plan; text: string; sha: string } | { error: string };
let state: SolverState = { status: "idle", loaded: 0, total: null, version: "", loadMs: 0, error: null, attempt: 0, solving: false, solveStart: 0 };
const listeners = new Set<() => void>();
const set = (p: Partial<SolverState>) => { state = { ...state, ...p }; listeners.forEach((l) => l()); };
export const getSolver = () => state;
export const subscribeSolver = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };

let worker: Worker | null = null;
let nextId = 1;
type Pending = { id: number; kind: "solve" | "duals"; text: string; sha: string; net: Network; model: Model; params: Params; done: (r: SolveOut | { duals: Record<string, number> }) => void; timeLimit?: number };
let inflight: Pending | null = null;
let pending: Pending | null = null;
let solvingTimer = 0;
let failures = 0;
/** test hook: forces the next worker creation to fail (a forced worker failure) */
export const testHooks = { failWorker: false, timeLimit: undefined as number | undefined };

function fail(message: string) {
  failures++;
  worker?.terminate();
  worker = null;
  const err = { error: message };
  inflight?.done(err); pending?.done(err);
  inflight = pending = null;
  clearTimeout(solvingTimer);
  set({ status: failures >= 2 ? "disabled" : "error", error: message, solving: false });
}

function onMessage(e: MessageEvent<FromWorker>) {
  const m = e.data;
  if (m.type === "progress") set({ loaded: m.loaded, total: m.total });
  else if (m.type === "ready") { set({ status: "ready", version: m.version, loadMs: m.loadMs, error: null }); pump(); }
  else if (m.type === "result" && inflight && m.id === inflight.id) {
    const f = inflight;
    inflight = null;
    clearTimeout(solvingTimer);
    set({ solving: false });
    const plan = planFromSolve(f.net, f.model, f.params, { status: m.status, objective: m.objective, columns: m.columns, ms: m.ms }, f.sha);
    f.done({ plan, text: f.text, sha: f.sha });
    pump();
  } else if (m.type === "duals" && inflight && m.id === inflight.id) {
    const f = inflight; inflight = null; f.done({ duals: m.duals }); pump();
  } else if (m.type === "error" && m.where === "solve") {
    if (inflight && m.id === inflight.id) { const f = inflight; inflight = null; clearTimeout(solvingTimer); set({ solving: false }); f.done({ error: m.message.toUpperCase() }); }
    pump();
  } else if (m.type === "error") fail(`SOLVER LOAD FAILED (${m.message})`);
}

function create() {
  if (worker || state.status === "disabled") return;
  set({ status: "loading", loaded: 0, total: null, attempt: state.attempt + 1, error: null });
  if (testHooks.failWorker) { fail("WORKER COULD NOT START (forced)"); return; }
  try {
    worker = new Worker(new URL("../workers/solver.worker.ts", import.meta.url), { type: "module", name: "highs-solver" });
  } catch (e) { fail(`WORKER COULD NOT START (${(e as Error).message})`); return; }
  worker.onmessage = onMessage;
  worker.onerror = (e) => { e.preventDefault(); fail("WORKER COULD NOT LOAD"); };
  worker.postMessage({ type: "init" } satisfies ToWorker);
}

function pump() {
  if (!worker || state.status !== "ready" || inflight || !pending) return;
  const p = pending;
  pending = null;
  p.id = nextId++;
  inflight = p;
  if (p.kind === "solve") {
    set({ solveStart: performance.now() });
    solvingTimer = window.setTimeout(() => set({ solving: true }), 150);
    worker.postMessage({ type: "solve", id: p.id, text: p.text, options: solverOptions(p.model, p.timeLimit ?? testHooks.timeLimit) } satisfies ToWorker);
  } else worker.postMessage({ type: "duals", id: p.id, text: p.text } satisfies ToWorker);
}

/** Start loading the solver (idempotent). */
export function startSolver() { if (state.status === "idle") create(); }
export function retrySolver() { if (state.status === "error") { worker = null; create(); } }
export const solveInFlight = () => !!inflight;

/** CANCEL: terminate the worker, keep the caller's last result, start a fresh worker. Not a failure. */
export function cancelSolve() {
  if (!inflight || !worker) return false;
  const d = inflight.done;
  inflight = null; pending = null;
  clearTimeout(solvingTimer);
  worker.terminate();
  worker = null;
  set({ status: "idle", solving: false });
  d({ error: "CANCELLED" });
  create();
  return true;
}

/** Latest-wins solve of `params` (LP text built here, hashed here; the worker only runs HiGHS). */
export async function requestSolve(net: Network, model: Model, params: Params, done: (r: SolveOut) => void, timeLimit?: number) {
  const text = buildLp(net, model, params);
  const sha = await sha256(text);
  pending = { id: 0, kind: "solve", text, sha, net, model, params, done: done as Pending["done"], timeLimit };
  startSolver();
  pump();
}
/** Row duals of the fixed-open-set LP (DERIVED shadow prices). */
export async function requestDuals(net: Network, model: Model, params: Params, open: number[], done: (d: Record<string, number> | null) => void) {
  const text = buildLp(net, model, { ...params, fixed_open: open }, { continuous: true });
  // duals share the worker but not the solve queue slot: wait for the in-flight solve, then run
  const go = () => {
    if (state.status !== "ready" || inflight) { setTimeout(go, 60); return; }
    pending = { id: 0, kind: "duals", text, sha: "", net, model, params, done: (r) => done("duals" in r ? r.duals : null) };
    pump();
  };
  go();
}
