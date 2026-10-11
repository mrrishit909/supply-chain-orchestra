import { describe, expect, it } from "vitest";
import { fitMap, lanePath, N_PTS, pxPerTon, strands, toPx } from "./unfold";
import { place, unionOf, chord } from "../dock/layout";
import { planFromScenario } from "../model/plan";
import { net, solutions } from "../test/data";

describe("the unfold (motion test 10)", () => {
  const plan = planFromScenario(net, solutions.scenarios.find((s) => s.id === "optimized")!);
  const u = unionOf(net, [plan]);
  const p = place(net, u, plan);
  const cam = { cx: 700, cy: 450, R: 360 };
  const view = fitMap(net, { x: 560, y: 130, w: 820, h: 610 }, 14);
  const ppt = pxPerTon("D");
  const S = strands({ net, u, p, x0: p.x0, x1: p.x1, cx: cam.cx, cy: cam.cy, R: cam.R, seam: 2, view, ppt });
  it("the strand set equals the route set (count and keys)", () => {
    expect(S.length).toBe(plan.routesIn.length + plan.routesOut.length);
    const keys = new Set(S.map((s) => `${s.kind}|${s.site}|${s.end}|${s.commodity}`));
    for (const [pp, f, k] of plan.routesIn) expect(keys.has(`in|${f}|${pp}|${k}`)).toBe(true);
    for (const [a, k] of plan.routesOut) expect(keys.has(`out|${net.out_arcs.site[a]}|${net.out_arcs.demand[a]}|${k}`)).toBe(true);
  });
  it("at e = 0 every centreline sits on its slot axis within 1 px; at e = 1 on the projected great-circle", () => {
    for (const s of S) {
      const m = u.keys[s.i]!;
      const xc = (p.x0[s.i]! + p.x1[s.i]!) / 2;
      expect(Math.abs(s.dock[0]! - (cam.cx + xc * cam.R))).toBeLessThan(1);
      expect(Math.abs(s.dock[2 * (N_PTS - 1)]! - (cam.cx + xc * cam.R))).toBeLessThan(1);
      const yEnd = cam.cy + (m.half === 0 ? -1 : 1) * chord(xc) * cam.R;
      expect(Math.abs(s.dock[2 * (N_PTS - 1) + 1]! - yEnd)).toBeLessThan(1);
    }
    // a lane's strands are laid side by side symmetric about the great-circle: their width-weighted mean is the projected path
    const lanes = new Map<string, typeof S>();
    for (const s of S) { const k = `${s.kind}|${s.site}|${s.end}`; (lanes.get(k) ?? lanes.set(k, []).get(k)!).push(s); }
    expect(lanes.size).toBeGreaterThan(100);
    for (const [, list] of [...lanes].slice(0, 60)) {
      const w = list.reduce((a, q) => a + q.wMap, 0);
      const mx = list.reduce((a, q) => a + q.map[0]! * q.wMap, 0) / w, my = list.reduce((a, q) => a + q.map[1]! * q.wMap, 0) / w;
      const path = lanePath(net, list[0]!.kind as "in" | "out", list[0]!.site, list[0]!.end);
      const [x, y] = toPx(view, path[0]![0], path[0]![1]);
      expect(Math.abs(mx - x)).toBeLessThan(1);
      expect(Math.abs(my - y)).toBeLessThan(1);
    }
  });
  it("strand widths equal tons x the viewport scale; dock widths equal slot widths", () => {
    for (const s of S) {
      expect(s.wMap).toBeCloseTo(s.tons * ppt, 9);
      expect(s.wDock).toBeCloseTo((p.x1[s.i]! - p.x0[s.i]!) * cam.R, 6);
    }
  });
});
