/// <reference lib="webworker" />
/**
 * The HiGHS solver worker (MOTION_SYSTEM 9.1). Loads highs@1.15.3 with real byte progress (the wasm is fetched here with
 * a stream reader and handed to Emscripten through instantiateWasm), then answers solve requests with LP text built on
 * the main thread: status, objective and the non-zero columns by name. Latest wins. Every failure is posted, never swallowed.
 */
import highsLoader from "highs";
import wasmUrl from "highs/runtime?url";

declare const self: DedicatedWorkerGlobalScope;
type Highs = { solve(lp: string, o?: Record<string, unknown>): { Status: string; ObjectiveValue: number; Columns: Record<string, { Primal: number }>; Rows: { Name?: string; Dual: number }[] } };

export type ToWorker =
  | { type: "init" }
  | { type: "solve"; id: number; text: string; options: Record<string, unknown> }
  | { type: "duals"; id: number; text: string };
export type FromWorker =
  | { type: "progress"; loaded: number; total: number | null }
  | { type: "ready"; version: string; loadMs: number }
  | { type: "result"; id: number; status: string; objective: number | null; columns: Record<string, number>; ms: number }
  | { type: "duals"; id: number; duals: Record<string, number> }
  | { type: "error"; where: "load" | "solve"; id?: number; message: string };

const post = (m: FromWorker) => self.postMessage(m);
let highs: Highs | null = null;
let ready: Promise<void> | null = null;
const queue: ToWorker[] = [];

async function load() {
  const t0 = performance.now();
  const res = await fetch(wasmUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length"));
  const total = !res.headers.get("content-encoding") && len > 0 ? len : __HIGHS_WASM_BYTES__ || null;
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const reader = res.body!.getReader();
  post({ type: "progress", loaded, total });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    post({ type: "progress", loaded, total });
  }
  const bin = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) { bin.set(c, o); o += c.byteLength; }
  // instantiate from the bytes already streamed: this Emscripten build ignores `wasmBinary` and would fetch the file twice
  const mod = (await highsLoader({
    instantiateWasm: (imports: WebAssembly.Imports, receive: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) => {
      void WebAssembly.instantiate(bin, imports).then((r) => receive(r.instance, r.module));
      return {};
    },
  } as never)) as unknown as Highs & { version?: { string: string } };
  highs = mod;
  post({ type: "ready", version: mod.version?.string ?? "1.15.3", loadMs: performance.now() - t0 });
}

function run(m: ToWorker) {
  if (m.type === "solve") {
    try {
      const t0 = performance.now();
      const s = highs!.solve(m.text, m.options);
      const ms = performance.now() - t0;
      const columns: Record<string, number> = {};
      for (const [k, v] of Object.entries(s.Columns)) if (v.Primal !== 0) columns[k] = v.Primal;
      post({ type: "result", id: m.id, status: s.Status, objective: Number.isFinite(s.ObjectiveValue) ? s.ObjectiveValue : null, columns, ms });
    } catch (e) { post({ type: "error", where: "solve", id: m.id, message: (e as Error).message }); }
  } else if (m.type === "duals") {
    try {
      const s = highs!.solve(m.text, { output_flag: false, threads: 1, random_seed: 0 });
      const duals: Record<string, number> = {};
      if (s.Status === "Optimal") for (const r of s.Rows) if (r.Name) duals[r.Name] = r.Dual;
      post({ type: "duals", id: m.id, duals });
    } catch (e) { post({ type: "error", where: "solve", id: m.id, message: (e as Error).message }); }
  }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === "init") {
    ready = load().catch((err: Error) => post({ type: "error", where: "load", message: err.message.toUpperCase() }));
    return;
  }
  if (!ready) return;
  queue.push(m);
  void ready.then(() => {
    if (!highs) return;
    // latest wins: only the newest pending solve runs; duals requests are answered in order
    const solves = queue.filter((q) => q.type === "solve");
    const keep = solves.at(-1);
    for (const q of queue.splice(0)) if (q.type === "duals" || q === keep) run(q);
  });
};
