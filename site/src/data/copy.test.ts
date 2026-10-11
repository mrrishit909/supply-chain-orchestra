/** L10: every sentence with a number or a universal claim is bound to the artifact that states it. */
import { describe, expect, it } from "vitest";
import { fact, s00Line1, s01, statusWord } from "./copy";
import { ledgerLines } from "../scenes/S02Real";
import { planFromScenario } from "../model/plan";
import { facts, meta, net, quality, solutions } from "../test/data";

describe("copy parity", () => {
  const opt = planFromScenario(net, solutions.scenarios.find((s) => s.id === "optimized")!);
  it("S00 status line: open sites, site count and objective come from the optimized record", () => {
    const l = s00Line1(opt, net);
    expect(l).toContain(`${opt.open.length} OF ${net.sites.length} SITES OPEN`);
    expect(l).toContain(`${(opt.objective! / 1e6).toFixed(1)} M USD / YR`);
    expect(l).toContain(statusWord(opt));
  });
  it("S01 cards: tons, cities and people are the artifacts' numbers", () => {
    const [a, b] = s01.cards(facts, opt, net);
    expect(a!.body).toContain(Math.round(fact(facts, "total_demand_tons")).toLocaleString("en-US"));
    expect(b!.body).toContain(`${fact(facts, "demand_nodes")} PLACES`);
    expect(b!.body).toContain((net.demand_nodes.reduce((x, n) => x + n.pop2025, 0) / 1e6).toFixed(1));
    expect(Math.round(quality.selection.demand_population / 1e5)).toBe(Math.round(net.demand_nodes.reduce((x, n) => x + n.pop2025, 0) / 1e5));
  });
  it("S02 join ledger: every subtraction is the previous count minus its stated drop (no wrong check mark)", () => {
    const rows = ledgerLines(quality);
    expect(rows.filter((r) => r.ok === false)).toEqual([]);
    expect(rows.filter((r) => r.ok === true)).toHaveLength(3);
    expect(rows.at(-1)!.text).toBe(`${quality.selection.demand_nodes} LARGEST`);
  });
  it("facts used in the headline copy exist and agree with the solution", () => {
    expect(fact(facts, "optimized_cost_usd")).toBeCloseTo(opt.objective!, 0);
    expect(fact(facts, "optimized_open_sites")).toBe(opt.open.length);
    expect(fact(facts, "legacy_cost_usd") - fact(facts, "optimized_cost_usd")).toBeCloseTo(fact(facts, "saving_vs_legacy_usd"), 0);
    expect(fact(facts, "saving_vs_legacy_pct")).toBeCloseTo((100 * fact(facts, "saving_vs_legacy_usd")) / fact(facts, "legacy_cost_usd"), 1);
  });
  it("no U+2014 or U+2015 anywhere in the shipped copy or data strings", () => {
    const all = JSON.stringify([meta, facts]);
    expect(/[—―]/.test(all)).toBe(false);
  });
});
