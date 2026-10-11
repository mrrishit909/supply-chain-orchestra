import { describe, expect, it } from "vitest";
import { drawOrder, drawPlan, fullService, lostPlan, tail, tallies } from "./storms";
import { place, unionOf, slotArea } from "../dock/layout";
import { fact, net, robustness as rb } from "../test/data";

describe("S06 draws", () => {
  const n = rb.draws.demand_tons.length;
  it("the final tally equals the published full-service counts", () => {
    const o = drawOrder(rb, "legacy_cost");
    expect(o).toHaveLength(n);
    const t = tallies(rb, o, n - 1);
    expect(t.legacy).toBe(fact("mc_full_service_legacy"));
    expect(t.optimized).toBe(fact("mc_full_service_optimized"));
    expect(fullService(rb, "legacy", o[0]!)).toBeTypeOf("boolean");
  });
  it("the scrub order is by legacy adjusted cost, ascending", () => {
    const o = drawOrder(rb, "legacy_cost");
    for (let i = 1; i < n; i++) expect(rb.results.legacy.adjusted_cost_usd[o[i]!]!).toBeGreaterThanOrEqual(rb.results.legacy.adjusted_cost_usd[o[i - 1]!]!);
  });
  it("tail rows are exactly the 25 highest adjusted costs", () => {
    for (const d of ["legacy", "optimized"] as const) {
      const t = tail(rb, d);
      expect(t).toHaveLength(25);
      const cut = Math.min(...t.map((i) => rb.results[d].adjusted_cost_usd[i]!));
      const higher = rb.results[d].adjusted_cost_usd.filter((c) => c > cut).length;
      expect(higher).toBeLessThanOrEqual(24);
    }
  });
  it("disc areas equal the draw demand over k; the unserved slot equals the unmet tons", () => {
    for (const i of [0, 7, 100, 250, 499]) for (const d of ["legacy", "optimized"] as const) {
      const p = drawPlan(net, rb, d, i);
      const u = unionOf(net, [p]);
      const pl = place(net, u, p);
      let bot = 0;
      u.keys.forEach((m, k) => { if (m.half === 1) bot += pl.tons[k]!; });
      const served = rb.results[d].delivered_by_site[i]!.reduce((a, b) => a + b, 0);
      expect(Math.abs(bot - (served + rb.results[d].unmet_tons[i]!))).toBeLessThan(2);
      const un = u.keys.findIndex((m) => m.kind === "un");
      if (un >= 0) expect(Math.abs(slotArea(pl, un) * 2 * pl.total / Math.PI - rb.results[d].unmet_tons[i]!)).toBeLessThan(0.01);
      expect(Math.abs(p.demandTons - (served + rb.results[d].unmet_tons[i]!))).toBeLessThan(1.5);
    }
  });
  it("lose-one-site records exist for every open site of the optimized design", () => {
    for (const f of rb.designs.find((d) => d.id === "optimized")!.open_sites) expect(lostPlan(net, rb, f)).not.toBeNull();
  });
});
