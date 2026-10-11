/**
 * Albers conic equal-area on the unit sphere (DR-5: parallels 29.5 and 45.5 N, origin 37.5 N 96 W) and great-circle
 * paths. x is east, y north; screen clients flip y. No d3-geo dependency.
 */
import type { Network } from "../model/types";

const D2R = Math.PI / 180;
export function albersFactory(par: [number, number] = [29.5, 45.5], origin: [number, number] = [37.5, -96]) {
  const p1 = par[0] * D2R, p2 = par[1] * D2R;
  const n = (Math.sin(p1) + Math.sin(p2)) / 2;
  const C = Math.cos(p1) ** 2 + 2 * n * Math.sin(p1);
  const rho0 = Math.sqrt(C - 2 * n * Math.sin(origin[0] * D2R)) / n;
  return (lat: number, lon: number): [number, number] => {
    const rho = Math.sqrt(C - 2 * n * Math.sin(lat * D2R)) / n;
    const th = n * (lon - origin[1]) * D2R;
    return [rho * Math.sin(th), rho0 - rho * Math.cos(th)];
  };
}
export const albers = (net: Network) => albersFactory(net.projection.parallels, net.projection.origin);

/** Points along the great-circle arc a to b (lat, lon in degrees), n + 1 samples, as (lat, lon). */
export function greatCircle(a: [number, number], b: [number, number], n: number): [number, number][] {
  const v = (lat: number, lon: number) => [Math.cos(lat * D2R) * Math.cos(lon * D2R), Math.cos(lat * D2R) * Math.sin(lon * D2R), Math.sin(lat * D2R)] as const;
  const A = v(a[0], a[1]), B = v(b[0], b[1]);
  const dot = Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
  const om = Math.acos(dot);
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let x: number, y: number, z: number;
    if (om < 1e-9) [x, y, z] = A;
    else {
      const s = Math.sin(om), w1 = Math.sin((1 - t) * om) / s, w2 = Math.sin(t * om) / s;
      x = w1 * A[0] + w2 * B[0]; y = w1 * A[1] + w2 * B[1]; z = w1 * A[2] + w2 * B[2];
    }
    out.push([Math.asin(Math.max(-1, Math.min(1, z))) / D2R, Math.atan2(y, x) / D2R]);
  }
  return out;
}
export function haversineMi(a: [number, number], b: [number, number], R = 3958.8) {
  const la = a[0] * D2R, lb = b[0] * D2R, dl = (b[1] - a[1]) * D2R, dp = lb - la;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
