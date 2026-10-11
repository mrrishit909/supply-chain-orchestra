import { beforeAll, describe, expect, it } from "vitest";
import highsLoader from "highs";
import { fullParams } from "./lp";
import { baseDemandTons, bindingFromPlan, hauls, hero, journeys, planFromScenario, planFromSweep, renderWord, wordFamilies, words } from "./plan";
import { fixedDesignDuals, solvePlan, type HighsLike } from "./solve";
import { fact, model, net, solutions, sweep } from "../test/data";

let highs: HighsLike;
beforeAll(async () => { highs = (await highsLoader()) as unknown as HighsLike; });
const optimal = solutions.scenarios.filter((s) => s.status === "Optimal");

describe("published scenarios", () => {
  it("DR-4 journeys and hero are reproduced from the 3-decimal routes for every scenario", () => {
    for (const s of optimal) {
      const j = journeys(net, s.routes_out, s.routes_in);
      expect(j.length, s.id).toBe(s.journeys.length);
      expect(j, s.id).toEqual(s.journeys);
      expect(hero(net, j), s.id).toEqual(s.hero);
    }
  });
  it("hauls and demand balance recomputed from the routes match the artifact", () => {
    for (const s of optimal) {
      const h = hauls(net, s.routes_out, s.routes_in);
      const key = s.id === "optimized" || s.id === "legacy" ? s.id : s.id;
      const hin = fact("haul_in_mi_" + key);
      if (hin !== undefined) expect(h.haulIn).toBeCloseTo(hin, 2);
      // demand balance per (node, commodity): served + unmet = demand (0.01 t)
      const served = new Map<string, number>();
      for (const [a, k, t] of s.routes_out) { const d = net.out_arcs.demand[a]!; served.set(`${d}|${k}`, (served.get(`${d}|${k}`) ?? 0) + t); }
      const unmet = new Map<string, number>();
      for (const u of s.relaxation?.unmet_demand ?? []) unmet.set(`${u.demand}|${u.commodity}`, u.tons);
      net.demand_nodes.forEach((n, d) => n.demand_tons.forEach((t, k) => {
        const want = Math.floor(t * s.params.demand_scale * 1e4 + 0.5) / 1e4;
        const got = (served.get(`${d}|${k}`) ?? 0) + (unmet.get(`${d}|${k}`) ?? 0);
        expect(Math.abs(got - want), `${s.id} ${d}/${k}`).toBeLessThan(0.01);
      }));
    }
  });
  it("objective recomputed from the drawn routes matches the solution (1e-5 relative)", () => {
    for (const s of optimal.filter((x) => !x.params.relax)) {
      const c = s.components!;
      const comp = c.fixed_usd + c.inbound_transport_usd + c.outbound_transport_usd + c.handling_usd;
      expect(Math.abs(comp - s.objective_usd!) / s.objective_usd!, s.id).toBeLessThan(1e-5);
      // from routes alone
      let tin = 0, tout = 0, hand = 0;
      for (const [p, f, k, t] of s.routes_in) tin += Math.floor(net.commodities[k]!.rate_in_usd_ton_mi * net.in_road_mi[p]![f]! * s.params.freight_scale * 1e4 + 0.5) / 1e4 * t;
      for (const [a, k, t] of s.routes_out) { tout += Math.floor(net.commodities[k]!.rate_out_usd_ton_mi * net.out_arcs.road_mi[a]! * s.params.freight_scale * 1e4 + 0.5) / 1e4 * t; hand += net.commodities[k]!.handling_usd_ton * t; }
      const fixed = s.open_sites.reduce((a, f) => a + Math.floor(net.sites[f]!.fixed_cost_usd_yr * s.params.fixed_cost_scale * 1e4 + 0.5) / 1e4, 0);
      expect(Math.abs(fixed + tin + tout + hand - s.objective_usd!) / s.objective_usd!, s.id).toBeLessThan(1e-5);
    }
  });
  it("DR-8: words are re-rendered from the relaxation report, for every relaxed scenario and sweep record", () => {
    const base = baseDemandTons(net);
    for (const s of solutions.scenarios.filter((x) => x.relaxation)) {
      expect(words(s.relaxation!, net, base, s.params.max_open_sites, model.relaxation_words.templates), s.id).toEqual(s.relaxation!.words);
    }
    for (const ser of sweep.series) for (const r of ser.records) if (r.relaxed) {
      expect(words(r.relaxed.relaxation, net, base, r.relaxed.params.max_open_sites), `${ser.id} ${r.k}`).toEqual(r.relaxed.relaxation.words);
    }
    for (const e of model.relaxation_words.examples) {
      const sc = solutions.scenarios.find((s) => s.id === e.scenario)!;
      const fam = wordFamilies(sc.relaxation!, net, base, sc.params.max_open_sites).find(([f]) => f === e.family)!;
      expect(fam[1]).toEqual(e.fields);
      expect(renderWord(e.family, e.fields, model.relaxation_words.templates)).toBe(e.sentence);
    }
  });
  it("sweep records carry the strict infeasibility of k = 1..4 and the relaxed words", () => {
    for (const ser of sweep.series) for (const r of ser.records) {
      if (r.k <= 4) { expect(r.status).toBe("Infeasible"); expect(r.relaxed).not.toBeNull(); }
      else expect(r.status).toBe("Optimal");
    }
  });
});

describe("live decode (HiGHS-wasm in Node)", () => {
  it("re-solving each non-relaxed preset reproduces status, objective, open set and components", async () => {
    for (const p of model.presets) {
      const pub = solutions.scenarios.find((s) => s.id === p.id)!;
      if (pub.status !== "Optimal" || pub.params.relax) continue;
      const { plan } = await solvePlan(highs, net, model, fullParams(model, p.params), 60);
      expect(plan.status).toBe("Optimal");
      expect(Math.abs(plan.objective! - pub.objective_usd!) / pub.objective_usd!, p.id).toBeLessThan(1e-6);
      expect(plan.open, p.id).toEqual(pub.open_sites);
      const c = plan.components!, pc = pub.components!;
      expect(Math.abs(c.fixed_usd - pc.fixed_usd)).toBeLessThan(1);
      expect(Math.abs(c.inbound_transport_usd - pc.inbound_transport_usd) / pc.inbound_transport_usd, p.id).toBeLessThan(1e-5);
      const pl = planFromScenario(net, pub);
      expect(Math.abs(plan.routesOut.reduce((a, r) => a + r[2], 0) - pl.routesOut.reduce((a, r) => a + r[2], 0))).toBeLessThan(0.5);
    }
  }, 300_000);
  it("relaxed presets give the published words (primal), status and objective", async () => {
    for (const p of model.presets) {
      const pub = solutions.scenarios.find((s) => s.id === p.id)!;
      if (!pub.relaxation) continue;
      const { plan } = await solvePlan(highs, net, model, fullParams(model, p.params), 60);
      expect(plan.status).toBe("Optimal");
      expect(Math.abs(plan.objective! - pub.objective_usd!) / pub.objective_usd!, p.id).toBeLessThan(1e-6);
      expect(plan.relaxation!.words, p.id).toEqual(pub.relaxation.words);
    }
  }, 300_000);
  it("shadow prices from the fixed-design LP equal the published duals (sign included)", () => {
    const pub = solutions.scenarios.find((s) => s.id === "optimized")!;
    const params = fullParams(model, pub.params);
    const duals = fixedDesignDuals(highs, net, model, params, pub.open_sites);
    const live = bindingFromPlan(net, planFromScenario(net, pub), duals);
    for (const b of pub.binding.filter((x) => x.shadow_usd_per_unit !== null)) {
      const l = live.find((x) => x.id === b.id)!;
      expect(l, b.id).toBeTruthy();
      expect(l.shadow_usd_per_unit!, b.id).toBeCloseTo(b.shadow_usd_per_unit!, 2);
    }
  });
  it("sweep plans: exactly-k open sets have k sites", () => {
    for (const r of sweep.series[1]!.records.filter((x) => x.k >= 5)) expect(planFromSweep(net, r, false).open.length).toBe(r.k);
  });
});
