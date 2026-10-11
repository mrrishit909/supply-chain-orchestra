/** Site-name labels on the dock: 11px mono under the seam, collision-free (two rows, then dropped), thin columns unlabelled on phones. */
import type { Blend } from "./director";
import type { LabelSpec } from "./director";
import type { Network } from "../model/types";

const CHAR_W = 6.7; // JetBrains Mono at 11px with 0.04em tracking
export function siteLabels(net: Network, b: Blend, cx: number, cy: number, R: number, opts: { alpha?: number; minCol?: number; only?: (f: number) => boolean; gap?: number } = {}): LabelSpec[] {
  const out: LabelSpec[] = [];
  const cand = net.sites.map((s, f) => ({ f, name: s.short_name.toUpperCase(), x: cx + ((b.colX0[f]! + b.colX1[f]!) / 2) * R, w: (b.colX1[f]! - b.colX0[f]!) * R, tons: b.colTons[f]! }))
    .filter((c) => c.tons > 0 && (!opts.only || opts.only(c.f)) && c.w >= (opts.minCol ?? 0))
    .sort((a, b2) => b2.tons - a.tons);
  const rows: [number, number][][] = [[], []];
  const gap = opts.gap ?? 10;
  for (const c of cand) {
    const half = (c.name.length * CHAR_W + 10) / 2;
    const vw = document.documentElement.clientWidth;
    if (c.x + half < 0 || c.x - half > vw) continue;
    const px = Math.max(half + 4, Math.min(vw - half - 4, c.x));
    const l = px - half, r = px + half;
    for (let row = 0; row < 2; row++) {
      if (rows[row]!.every(([a, z]) => r + 6 < a || l - 6 > z)) {
        rows[row]!.push([l, r]);
        out.push({ key: `site${c.f}`, text: c.name, x: px, y: cy + 4 + gap + row * 20, alpha: opts.alpha ?? 1, cls: "dock-label--site" });
        break;
      }
    }
  }
  return out;
}
