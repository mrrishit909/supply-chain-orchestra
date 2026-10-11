/**
 * LP parity (task P07-FE-001): the TypeScript LP builder reproduces the Python reference LP text byte for byte
 * (SHA-256 equal for every published vector) and HiGHS-wasm 1.15.3 returns the same status and objective.
 */
import { describe, expect, it, beforeAll } from "vitest";
import highsLoader from "highs";
import { buildLp, fullParams, sha256 } from "./lp";
import { solveText, type HighsLike } from "./solve";
import { model, net, vectors } from "../test/data";

let highs: HighsLike;
beforeAll(async () => { highs = (await highsLoader()) as unknown as HighsLike; });

describe("LP text parity with the Python reference", () => {
  it("has the published vector set", () => {
    expect(vectors.vectors.length).toBeGreaterThanOrEqual(41);
  });
  it("every vector: browser LP text hash equals Python's", async () => {
    const bad: string[] = [];
    for (const v of vectors.vectors) {
      const h = await sha256(buildLp(net, model, fullParams(model, v.params)));
      if (h !== v.lp_text_sha256) bad.push(v.id);
    }
    expect(bad).toEqual([]);
  });
  it("every vector: HiGHS-wasm status and objective match (1e-6 relative)", async () => {
    const bad: string[] = [];
    for (const v of vectors.vectors) {
      const s = solveText(highs, model, buildLp(net, model, fullParams(model, v.params)), 60);
      const e = v.expected;
      const objOk = e.objective_usd === null ? s.objective === null : s.objective !== null && Math.abs(s.objective - e.objective_usd) <= Math.max(vectors.tolerance_abs_usd, vectors.tolerance_rel * Math.abs(e.objective_usd));
      if (s.status !== e.status || !objOk) bad.push(`${v.id}: ${s.status} ${s.objective} vs ${e.status} ${e.objective_usd}`);
    }
    expect(bad).toEqual([]);
  }, 300_000);
});
