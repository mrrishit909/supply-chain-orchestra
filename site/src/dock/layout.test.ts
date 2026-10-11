import { describe, expect, it } from "vitest";
import { areaTo, chord, hatchHeight, place, slotArea, unionOf, xOfU } from "./layout";
import { planFromScenario, planFromSweep, type Plan } from "../model/plan";
import { net, solutions, sweep } from "../test/data";

const plans: Plan[] = [
  ...solutions.scenarios.map((s) => planFromScenario(net, s)),
  ...sweep.series.flatMap((s) => s.records.flatMap((r) => [planFromSweep(net, r, false), ...(r.relaxed ? [planFromSweep(net, r, true)] : [])])),
].filter((p) => p.routesOut.length > 0);

describe("half-disc area function", () => {
  it("inverse matches forward at 10,000 points", () => {
    for (let i = 0; i <= 10000; i++) {
      const u = i / 10000;
      const x = xOfU(u);
      expect(Math.abs((areaTo(x) - areaTo(-1)) / (Math.PI / 2) - u)).toBeLessThan(1e-12);
    }
  });
});

describe("the area rule", () => {
  it("has plans to check", () => { expect(plans.length).toBeGreaterThan(30); });
  it("sum of top slot areas = sum of bottom slot areas = tons / k, columns equal their site's throughput (1e-9)", () => {
    for (const p of plans) {
      const u = unionOf(net, [p]);
      const pl = place(net, u, p);
      let top = 0, bot = 0;
      u.keys.forEach((m, i) => { if (m.half === 0) top += slotArea(pl, i); else bot += slotArea(pl, i); });
      expect(Math.abs(top - (Math.PI / 2) * ((pl.total - pl.unmet) / pl.total)), `${p.id} top`).toBeLessThan(1e-9);
      expect(Math.abs(bot - Math.PI / 2), `${p.id} bottom`).toBeLessThan(1e-9);
      for (let f = 0; f < net.sites.length; f++) {
        const colArea = areaTo(pl.colX1[f]!) - areaTo(pl.colX0[f]!);
        expect(Math.abs(colArea - (pl.colTons[f]! / pl.total) * (Math.PI / 2)), `${p.id} col ${f}`).toBeLessThan(1e-9);
      }
      // each bar's tons are its area x 2T / pi
      u.keys.forEach((m, i) => {
        if (m.half === 1) expect(Math.abs(slotArea(pl, i) * 2 * pl.total / Math.PI - pl.tons[i]!), `${p.id} ${m.key}`).toBeLessThan(1e-6 * Math.max(1, pl.total) / 1e3);
      });
    }
  });
  it("routes drawn == solution flows: the set of bars equals the set of routes, tons within 0.01 t", () => {
    for (const p of plans) {
      const u = unionOf(net, [p]);
      const pl = place(net, u, p);
      const drawnOut = new Map<string, number>(), drawnIn = new Map<string, number>();
      u.keys.forEach((m, i) => {
        if (pl.tons[i]! <= 0) return;
        if (m.kind === "out") drawnOut.set(m.key, pl.tons[i]!);
        if (m.kind === "in") drawnIn.set(m.key, pl.tons[i]!);
      });
      expect(drawnOut.size, p.id).toBe(p.routesOut.length);
      expect(drawnIn.size, p.id).toBe(p.routesIn.length);
      for (const [a, k, t] of p.routesOut) expect(drawnOut.get(`o${a}_${k}`)).toBe(t);
      // inbound bars are scaled by outflow/inflow per site (1 +- 1e-9 for published routes)
      for (const [pp, f, k, t] of p.routesIn) expect(Math.abs((drawnIn.get(`i${pp}_${f}_${k}`) ?? -1) - t), `${p.id} in`).toBeLessThan(0.01);
    }
  });
  it("hatch bands have exactly the slack's area", () => {
    for (const [x0, x1, s] of [[-0.3, -0.29, 0.42], [0.1, 0.12, 0.05], [0.7, 0.75, 0.9], [-1, -0.6, 0.5]] as const) {
      const h = hatchHeight(x0, x1, s);
      const N = 40000, dx = (x1 - x0) / N;
      let over = 0;
      for (let i = 0; i < N; i++) over += Math.max(0, chord(x0 + (i + 0.5) * dx) - h) * dx;
      expect(Math.abs(over / (areaTo(x1) - areaTo(x0)) - s)).toBeLessThan(2e-4);
    }
  });
  it("relaxed supply: hatched tons equal the supply overshoot; unserved bars are fully hatched", () => {
    const rs = plans.find((p) => p.id === "relaxed_supply")!;
    const u = unionOf(net, [rs]);
    const pl = place(net, u, rs);
    let hat = 0;
    u.keys.forEach((m, i) => { if (m.kind === "in") hat += pl.hatch[i]! * pl.tons[i]!; });
    expect(Math.abs(hat - rs.relaxation!.supply_overshoot.reduce((a, s) => a + s.tons, 0))).toBeLessThan(5);
    const st = plans.find((p) => p.id === "storm_legacy")!;
    const us = unionOf(net, [st]);
    const ps = place(net, us, st);
    let un = 0;
    us.keys.forEach((m, i) => { if (m.kind === "un") { expect(ps.hatch[i]).toBe(1); un += ps.tons[i]!; } });
    expect(Math.abs(un - st.relaxation!.unmet_demand.reduce((a, s) => a + s.tons, 0))).toBeLessThan(0.01);
  });
  it("blending two placements over a union keeps the partition gapless and ordered", () => {
    const a = plans.find((p) => p.id === "legacy")!, b = plans.find((p) => p.id === "optimized")!;
    const u = unionOf(net, [a, b]);
    const pa = place(net, u, a), pb = place(net, u, b);
    for (const e of [0, 0.25, 0.5, 0.9, 1]) {
      let prev = -1, prevHalf = -1;
      u.keys.forEach((m, i) => {
        if (m.half !== prevHalf) { prev = -1; prevHalf = m.half; }
        const x0 = pa.x0[i]! + (pb.x0[i]! - pa.x0[i]!) * e, x1 = pa.x1[i]! + (pb.x1[i]! - pa.x1[i]!) * e;
        expect(x1).toBeGreaterThanOrEqual(x0 - 1e-12);
        if (prev >= -1 && prev !== -1) expect(Math.abs(x0 - prev)).toBeLessThan(1e-9);
        prev = x1;
      });
    }
  });
});
