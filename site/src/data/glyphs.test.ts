/** The self-hosted font subset covers every character the page renders (QA L6 kept the fonts under 70 KB). */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SUBSET = new Set<number>([...Array.from({ length: 0x7f - 0x20 }, (_, i) => 0x20 + i), 0xa0, 0xb0, 0xb1, 0xb5, 0xb7, 0xd7, 0x394, 0x2019, 0x2026, 0x2192, 0x2212, 0x2500, 0x2501, 0x2508, 0x254c, 0x25a8, 0x2713, 0x2717]);
const root = fileURLToPath(new URL("..", import.meta.url));
function* walk(d: string): Generator<string> {
  for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (!/test$/.test(f)) yield* walk(p); } else if (/\.(ts|tsx|css)$/.test(f) && !/\.test\./.test(f)) yield p; }
}
describe("fonts", () => {
  it("every non-ASCII character in the source strings is in the font subset, and no em or en dash exists", () => {
    const missing = new Set<string>();
    for (const f of walk(root)) {
      const txt = readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const ch of txt) { const c = ch.codePointAt(0)!; if (c > 0x7e && !SUBSET.has(c)) missing.add(`${ch} U+${c.toString(16)} in ${f.split("/src/")[1]}`); if (c === 0x2014 || c === 0x2015) missing.add(`dash in ${f}`); }
    }
    expect([...missing]).toEqual([]);
  });
  it("the two font files total at most 70 KB", () => {
    const d = join(root, "assets/fonts");
    const total = readdirSync(d).reduce((a, f) => a + statSync(join(d, f)).size, 0);
    expect(total).toBeLessThanOrEqual(70 * 1024);
  });
});
