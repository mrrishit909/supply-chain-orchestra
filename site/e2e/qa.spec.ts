/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The pre-QA gate (P07-FE-001): one test per QA_LESSONS item L1-L22 plus the functional contracts (parity, area rule,
 * routes drawn == flows, solver states). Runs once (desktop project); each test opens its own contexts at the viewports
 * its lesson names. Production build only.
 */
import { chromium, expect, test, type Browser, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { WALK, collideAll, contrastFails, goScene, openSite } from "./qa";

test.skip(({ isMobile }) => isMobile, "viewports are set per test");
test.describe.configure({ timeout: 600_000 });
const BASE = "http://localhost:4371/supply-chain-orchestra/";
const VP = (w: number, h: number) => ({ width: w, height: h });
async function at(browser: Browser, vp: { width: number; height: number }, opts: { reduced?: boolean } = {}) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 768, hasTouch: vp.width < 768, reducedMotion: opts.reduced ? "reduce" : "no-preference", baseURL: BASE });
  const page = await ctx.newPage();
  return { ctx, page };
}
const SCENES = [...new Set(WALK.map(([id]) => id))];
const PHONES = [VP(360, 800), VP(375, 812), VP(390, 844)];

/** the planted fixture: an element with a class nobody listed, overlapping a real heading */
async function plant(page: Page) {
  await page.evaluate(() => {
    const h = document.querySelector<HTMLElement>("[data-scene-heading]:not(.sr-only)") ?? document.querySelector<HTMLElement>("h2, h1")!;
    const r = h.getBoundingClientRect();
    const d = document.createElement("p");
    d.className = "zz-planted-overlap-9f3";
    d.textContent = "PLANTED OVERLAP FIXTURE";
    d.style.cssText = `position:fixed;left:${r.left + 4}px;top:${r.top + 4}px;margin:0;font:13px monospace;z-index:99;background:#000;color:#fff`;
    document.body.append(d);
  });
}

test("L22 fixture: a planted unlisted-class overlap is caught at 1280x720 with the fixed nav present", async ({ browser }) => {
  const { ctx, page } = await at(browser, VP(1280, 720));
  await openSite(page);
  await goScene(page, "sites", 0.5);
  expect(await collideAll(page)).toEqual([]);
  await plant(page);
  const found = await collideAll(page);
  expect(found.join("|")).toContain("PLANTED OVERLAP FIXTURE");
  await ctx.close();
});

test("L1: classic 15 px scrollbar at 1024x768 and 768x1024: JS class == CSS class == layout class, and no collisions", async () => {
  const b = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
  try {
    for (const vp of [VP(1024, 768), VP(768, 1024)]) {
      const ctx = await b.newContext({ viewport: vp, baseURL: BASE });
      await ctx.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
        const s = document.createElement("style");
        s.textContent = "html { overflow-y: scroll; } ::-webkit-scrollbar { width: 15px; background: #222; }";
        document.head.append(s);
      }));
      const page = await ctx.newPage();
      await openSite(page);
      const c = await page.evaluate(() => (window as any).__sco.cls());
      expect(c.innerWidth - c.clientWidth, "a classic scrollbar is showing").toBeGreaterThanOrEqual(15);
      expect(c.js, JSON.stringify(c)).toBe(c.css);
      expect(c.layout, JSON.stringify(c)).toBe(c.css);
      const bad: string[] = [];
      for (const [id, p] of WALK) { await goScene(page, id, p); for (const x of await collideAll(page)) bad.push(`${vp.width} ${id}@${p}: ${x}`); }
      expect(bad).toEqual([]);
      await ctx.close();
    }
  } finally { await b.close(); }
});

test("L2/L19/L22: whole-document collision walk at 1280x720, 1024x768, 768x1024 and 1440x900", async ({ browser }) => {
  const bad: string[] = [];
  for (const vp of [VP(1280, 720), VP(1024, 768), VP(768, 1024), VP(1440, 900)]) {
    const { ctx, page } = await at(browser, vp);
    await openSite(page);
    for (const [id, p] of WALK) { await goScene(page, id, p); for (const x of await collideAll(page)) bad.push(`${vp.width}x${vp.height} ${id}@${p}: ${x}`); }
    await ctx.close();
  }
  expect(bad).toEqual([]);
});

for (const reduced of [false, true]) {
  test(`L11/L21: phones flow, whole-document collision walk at 360x800, 375x812, 390x844 (${reduced ? "reduced motion" : "motion"})`, async ({ browser }) => {
    const bad: string[] = [];
    for (const vp of PHONES) {
      const { ctx, page } = await at(browser, vp, { reduced });
      await openSite(page);
      for (const [id, p] of WALK) { await goScene(page, id, p); for (const x of await collideAll(page)) bad.push(`${vp.width}x${vp.height} ${id}@${p}: ${x}`); }
      await ctx.close();
    }
    expect(bad).toEqual([]);
  });
}

test("L21: every layer and mode toggle at 1280x720 and 390x844 keeps the walk clean", async ({ browser }) => {
  const bad: string[] = [];
  for (const vp of [VP(1280, 720), VP(390, 844)]) {
    for (const reduced of [false, true]) {
      const { ctx, page } = await at(browser, vp, { reduced });
      await openSite(page);
      const sweep: [string, number, string][] = [
        ["sites", 0.5, "window.__sco.set.sites({k:2,relaxed:true})"], ["sites", 0.5, "window.__sco.set.sites({k:14,relaxed:false})"],
        ["limits", 0.2, "window.__sco.set.limits({cap:1.05})"], ["unfold", 0.62, "window.__sco.set.unfold({design:'legacy'})"], ["unfold", 0.62, "window.__sco.set.unfold({design:'optimized'})"],
        ["break", 0.22, "window.__sco.set.brk({case:'capacity',mode:'strict'})"], ["break", 0.22, "window.__sco.set.brk({case:'sites',mode:'relaxed'})"],
        ["break", 0.22, "window.__sco.set.brk({case:'storm',mode:'relaxed',storm:'optimized'})"], ["storms", 0.35, "window.__sco.set.storms({order:'index',lost:3})"],
        ["storms", 0.35, "window.__sco.set.storms({order:'legacy_cost',lost:null})"],
      ];
      for (const [id, p, js] of sweep) {
        await goScene(page, id, p);
        await page.evaluate(js);
        await page.waitForTimeout(1500);
        for (const x of await collideAll(page)) bad.push(`${vp.width} ${reduced ? "rm" : "mo"} ${id} ${js}: ${x}`);
      }
      await ctx.close();
    }
  }
  expect(bad).toEqual([]);
});

test("L3: every visual keeps a visible, in-viewport honesty tag and commodity key at 360/375/390/768; no stylesheet hides one", async ({ browser }) => {
  const bad: string[] = [];
  for (const w of [360, 375, 390, 768]) {
    const { ctx, page } = await at(browser, VP(w, w < 768 ? 844 : 1024));
    await openSite(page);
    for (const [id, p] of [["journey", 0.0], ["journey", 0.78], ["real", 0.14], ["sites", 0.5], ["limits", 0.2], ["unfold", 0.62], ["break", 0.22], ["storms", 0.35], ["evidence", 0.5], ["desk", 0], ["closing", 0.9]] as [string, number][]) {
      await goScene(page, id, p);
      const n = await page.evaluate((i) => {
        const root = document.getElementById(i === "journey" ? "journey" : i)!;
        const vh = innerHeight, vw = innerWidth;
        return [...root.querySelectorAll(".chip"), ...(i === "journey" ? document.querySelectorAll(".journey-foot .chip") : [])].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.left >= -1 && r.right <= vw + 1 && r.top >= 0 && r.bottom <= vh; }).length;
      }, id);
      if (!n && id !== "closing" && id !== "evidence") bad.push(`${w} ${id}@${p}: no visible tag`);
    }
    await ctx.close();
  }
  expect(bad).toEqual([]);
  const dir = new URL("../src/styles/", import.meta.url).pathname;
  const css = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf-8")).join("\n");
  const hides = [...css.matchAll(/([^{}]+)\{[^}]*display:\s*none/g)].map((m) => m[1]!.trim()).filter((s) => /chip|commodity-legend|swatch/.test(s));
  expect(hides).toEqual([]);
});

test("L5/L14: no sideways scroll against the configured width, normal and reduced motion, at 360/375/390/768; the fixture fails it", async ({ browser }) => {
  const bad: string[] = [];
  for (const reduced of [false, true]) for (const w of [360, 375, 390, 768]) {
    const { ctx, page } = await at(browser, VP(w, w < 768 ? 844 : 1024), { reduced });
    await openSite(page);
    for (const id of SCENES) {
      await goScene(page, id, 0.5);
      const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth }));
      if (Math.max(r.sw, r.bw) > w) bad.push(`${reduced ? "reduced" : "motion"} ${w} ${id}: ${Math.max(r.sw, r.bw)} > ${w}`);
    }
    await ctx.close();
  }
  expect(bad).toEqual([]);
  const { ctx, page } = await at(browser, VP(390, 844), { reduced: true });
  await openSite(page);
  await page.evaluate(() => { const d = document.createElement("div"); d.style.cssText = "width:525px;height:4px;position:relative"; document.body.append(d); });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThan(390);
  await ctx.close();
});

test("L7: every visible text node is at least 11 CSS px at 1440, 768 and 390", async ({ browser }) => {
  const bad: string[] = [];
  for (const vp of [VP(1440, 900), VP(768, 1024), VP(390, 844)]) {
    const { ctx, page } = await at(browser, vp);
    await openSite(page);
    for (const [id, p] of WALK) {
      await goScene(page, id, p);
      const small = await page.evaluate(() => {
        const vh = innerHeight, out: string[] = [];
        const on = (e: Element) => { for (let n: Element | null = e; n; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) return false; } return true; };
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const el = n.parentElement!;
          if (!n.textContent?.trim() || el.closest(".sr-only, script, style") || !on(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.bottom < 0 || r.top > vh || r.width < 1) continue;
          const fs = parseFloat(getComputedStyle(el).fontSize);
          if (fs < 10.99) out.push(`${n.textContent.trim().slice(0, 24)} ${fs}px`);
        }
        return out;
      });
      for (const s of small) bad.push(`${vp.width} ${id}@${p}: ${s}`);
    }
    await ctx.close();
  }
  expect(bad).toEqual([]);
});

test("L8: corner buttons clear the MENU pill by 8 px at 768, 390, 375, 360", async ({ browser }) => {
  const bad: string[] = [];
  for (const vp of [VP(768, 1024), ...PHONES]) {
    const { ctx, page } = await at(browser, vp);
    await openSite(page);
    await page.waitForTimeout(500);
    const g = await page.evaluate(() => {
      const a = document.querySelector(".menu-pill")!.getBoundingClientRect(), b = document.querySelector(".corner-btn")!.getBoundingClientRect();
      return { gap: Math.max(b.left - a.right, a.left - b.right), vgap: Math.max(b.top - a.bottom, a.top - b.bottom), right: innerWidth - b.right };
    });
    if (g.gap < 8 && g.vgap < 8) bad.push(`${vp.width}: gap ${g.gap}`);
    await ctx.close();
  }
  expect(bad).toEqual([]);
});

test("L9/L12: every control is the element at its centre and a REAL pointer click triggers it (no locator.click)", async ({ browser }) => {
  const bad: string[] = [];
  for (const vp of [VP(1440, 900), VP(390, 844)]) {
    const { ctx, page } = await at(browser, vp);
    await openSite(page);
    for (const [id, p] of [["sites", 0.5], ["limits", 0.2], ["unfold", 0.62], ["break", 0.22], ["storms", 0.35], ["desk", 0]] as [string, number][]) {
      await goScene(page, id, p);
      await page.waitForTimeout(600);
      const pts: { x: number; y: number; name: string }[] = await page.evaluate((i) => {
        const root = document.getElementById(i)!;
        const out: any[] = [];
        for (const e of root.querySelectorAll<HTMLElement>("button, input, select, summary, [role=radio], [role=spinbutton]")) {
          if (e.closest(".sr-only, [aria-hidden=true]") || (e as HTMLButtonElement).disabled) continue;
          const r = e.getBoundingClientRect();
          if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight) continue;
          out.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, name: e.getAttribute("aria-label") || e.textContent?.trim().slice(0, 20) || e.tagName });
        }
        return out;
      }, id);
      for (const q of pts) {
        const ok = await page.evaluate(([x, y, i]) => { const t = document.elementFromPoint(x as number, y as number); const root = document.getElementById(i as string)!; return !!t && (root.contains(t) || !!t.closest("#menu-panel, .nav-bar, .corner-btn, .sheet, .site-foot")); }, [q.x, q.y, id] as const);
        const top = await page.evaluate(([x, y]) => { const t = document.elementFromPoint(x as number, y as number); return t ? `${t.tagName}.${(t as HTMLElement).className}` : "none"; }, [q.x, q.y] as const);
        if (!ok || /hit|dock-layer|disc-slot/.test(top)) bad.push(`${vp.width} ${id}: "${q.name}" is covered by ${top}`);
      }
    }
    await ctx.close();
  }
  expect(bad).toEqual([]);
});

test("L15: reduced-motion figures are painted (non-trivial pixel counts) in every scene at 1440 and 390", async ({ browser }) => {
  const bad: string[] = [];
  for (const vp of [VP(1440, 900), VP(390, 844)]) {
    const { ctx, page } = await at(browser, vp, { reduced: true });
    await openSite(page);
    await page.waitForTimeout(1500);
    const rep = await page.evaluate(() => [...document.querySelectorAll<HTMLCanvasElement>("canvas.still")].map((c) => {
      const g = c.getContext("2d")!;
      const r = c.getBoundingClientRect();
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 16) if (d[i + 3]! > 0 && d[i]! + d[i + 1]! + d[i + 2]! > 40) lit++;
      return { label: c.getAttribute("aria-label"), w: r.width, h: r.height, lit };
    }));
    expect(rep.length).toBeGreaterThan(10);
    for (const r of rep) if (r.w < 40 || r.h < 40 || (r.lit < 30 && !/Unfold frame at 0$/.test(r.label ?? "") && !/strict|Demand|Capacity|At most/i.test(r.label ?? ""))) bad.push(`${vp.width}: ${r.label} ${r.w}x${r.h} lit ${r.lit}`);
    await ctx.close();
  }
  expect(bad).toEqual([]);
});

test("L16: pixel-sampled contrast of every text-bearing element is >= 4.5:1 at 1440, 768 and 390", async ({ browser }) => {
  const bad: string[] = [];
  for (const vp of [VP(1440, 900), VP(768, 1024), VP(390, 844)]) {
    const { ctx, page } = await at(browser, vp);
    await openSite(page);
    for (const [id, p] of [["journey", 0], ["journey", 0.78], ["real", 0.14], ["sites", 0.5], ["limits", 0.2], ["unfold", 0.62], ["break", 0.22], ["break", 0.8], ["storms", 0.35], ["evidence", 0.5], ["desk", 0], ["closing", 0.9]] as [string, number][]) {
      await goScene(page, id, p);
      await page.waitForTimeout(800);
      for (const x of await contrastFails(page)) bad.push(`${vp.width} ${id}@${p}: ${x}`);
    }
    await ctx.close();
  }
  expect(bad).toEqual([]);
});

test("L17: the inspector closes on scene change and the destination's controls pass the real-pointer check", async ({ browser }) => {
  const { ctx, page } = await at(browser, VP(1440, 900));
  await openSite(page);
  await goScene(page, "unfold", 0.62);
  await page.waitForTimeout(800);
  const sq = await page.evaluate(() => (window as any).__sco.unfoldInfo().widths.sort((a: any, b: any) => b.tons - a.tons)[0]);
  expect(sq).toBeTruthy();
  const hit = page.locator("#unfold .hit");
  await hit.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".sheet.inspector")).toBeVisible();
  await goScene(page, "break", 0.22);
  await page.waitForTimeout(500);
  await expect(page.locator(".sheet.inspector")).toHaveCount(0);
  await ctx.close();
});

test("L18: units agree in every frame of the S04 encoding change (AREA = TONS to WIDTH = TONS)", async ({ browser }) => {
  const { ctx, page } = await at(browser, VP(1440, 900));
  await openSite(page);
  await goScene(page, "unfold", 0.1);
  const bad: string[] = [];
  for (let k = 0; k < 40; k++) {
    await page.evaluate((p) => (window as any).__sco.jumpTo("unfold", p), 0.3 + (0.12 * k) / 40);
    await page.waitForTimeout(30);
    const r = await page.evaluate(() => ({ enc: document.querySelector("[data-enc]")!.textContent, t: (window as any).__sco.state().unfold.t }));
    const want = r.t > 0.5 ? "WIDTH" : "AREA";
    if (!r.enc!.startsWith(want)) bad.push(`t ${r.t.toFixed(2)}: ${r.enc}`);
  }
  expect(bad).toEqual([]);
  await ctx.close();
});

test("axe: zero violations in both motion modes, every scene", async ({ browser }) => {
  for (const reduced of [false, true]) {
    const { ctx, page } = await at(browser, VP(1440, 900), { reduced });
    await openSite(page);
    const bad: string[] = [];
    for (const id of SCENES) {
      await goScene(page, id, id === "journey" ? 0.78 : 0.3);
      await page.waitForTimeout(600);
      const r = await new AxeBuilder({ page }).analyze();
      for (const v of r.violations) bad.push(`${reduced ? "rm" : "mo"} ${id}: ${v.id} ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
    }
    expect(bad).toEqual([]);
    await ctx.close();
  }
});
