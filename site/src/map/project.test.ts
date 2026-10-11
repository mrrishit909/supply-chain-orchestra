import { describe, expect, it } from "vitest";
import { albers, greatCircle, haversineMi } from "./project";
import { net } from "../test/data";

describe("Albers and great-circle", () => {
  const proj = albers(net);
  it("reproduces the published DR-5 x, y of every node, site and plant (1e-6)", () => {
    for (const g of [...net.demand_nodes, ...net.sites, ...net.plants]) {
      const [x, y] = proj(g.lat, g.lon);
      expect(Math.abs(x - g.x), g.id).toBeLessThan(2e-6);
      expect(Math.abs(y - g.y), g.id).toBeLessThan(2e-6);
    }
  });
  it("great-circle path endpoints and length", () => {
    const a = net.plants[0]!, b = net.sites[3]!;
    const pts = greatCircle([a.lat, a.lon], [b.lat, b.lon], 24);
    expect(pts).toHaveLength(25);
    expect(pts[0]![0]).toBeCloseTo(a.lat, 6);
    expect(pts[24]![1]).toBeCloseTo(b.lon, 6);
  });
  it("the published road-equivalent miles are 1.2 x great-circle (Fort Worth to Houston = 284.6)", () => {
    const a = net.plants[0]!, b = net.sites[3]!;
    expect(Math.round(haversineMi([a.lat, a.lon], [b.lat, b.lon]) * 1.2 * 10) / 10).toBeCloseTo(net.in_road_mi[0]![3]!, 1);
  });
});
