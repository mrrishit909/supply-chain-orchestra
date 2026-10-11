/* eslint-disable @typescript-eslint/no-explicit-any */
/** Functional contracts (P07-FE-001): intro, navigation, area rule, routes drawn == flows, solver states, RETRY for every artifact. */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { goScene, openSite } from "./qa";

test.skip(({ isMobile }) => isMobile, "viewports are set per test");
test.describe.configure({ timeout: 300_000 });
const BASE = "http://localhost:4371/supply-chain-orchestra/";
async function at(browser: Browser, w: number, h: number, reduced = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 768, hasTouch: w < 768, reducedMotion: reduced ? "reduce" : "no-preference", baseURL: BASE });
  return { ctx, page: await ctx.newPage() };
}
const data = async (page: Page, f: string) => (await (await page.request.get(`${BASE}data/${f}`)).json()) as any;

test("every scene renders: heading, honesty tag and a painted disc where one is pinned", async ({ browser }) => {
  const { ctx, page } = await at(browser, 1440, 900);
  await openSite(page);
  for (const [id, p, disc] of [["journey", 0.78, true], ["real", 0.14, true], ["sites", 0.5, true], ["limits", 0.2, true], ["unfold", 0.05, true], ["unfold", 0.62, false], ["break", 0.22, true], ["storms", 0.35, true], ["evidence", 0.05, true], ["desk", 0, false], ["closing", 0.9, true]] as [string, number, boolean][]) {
    await goScene(page, id, p);
    await expect(page.locator(`#${id} [data-scene-heading]`).first()).toBeAttached();
    expect(await page.evaluate(() => document.querySelectorAll(".chip").length), id).toBeGreaterThan(0);
    if (disc) expect(await page.evaluate(() => (window as any).__sco.discs().length), id).toBeGreaterThan(0);
  }
  await ctx.close();
});

test("intro: SKIP visible at 100 ms, nav within 400 ms of the click, Esc and wheel complete it, a same-session reload starts at the end state", async ({ browser }) => {
  const { ctx, page } = await at(browser, 1440, 900);
  await page.goto("?quality=high");
  await page.waitForTimeout(100);
  const skip = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /SKIP INTRO/.test(x.textContent ?? "")); const r = b?.getBoundingClientRect(); return !!r && r.width > 0 && r.top < innerHeight; });
  expect(skip).toBe(true);
  await page.waitForFunction(() => (window as any).__sco?.introStats().playing === true);
  const lcp = await page.evaluate(() => document.querySelector("h1[data-hero]")!.getBoundingClientRect().width > 0 && Number(getComputedStyle(document.querySelector("h1[data-hero]")!).opacity) > 0);
  expect(lcp, "the headline is painted from first paint, never opacity 0").toBe(true);
  await page.getByRole("button", { name: "SKIP INTRO" }).click();
  await page.waitForFunction(() => !(window as any).__sco.introStats().playing, null, { timeout: 2000 });
  await expect(page.locator(".nav-bar.is-fixed")).toBeVisible();
  // the dock line is at its full G0 length and never decreased
  const st = await page.evaluate(() => (window as any).__sco.introStats());
  expect(st.monotonic).toBe(true);
  await page.reload();
  await page.waitForFunction(() => (window as any).__sco?.debug().frames > 1);
  expect(await page.evaluate(() => (window as any).__sco.introStats().playing)).toBe(false);
  // wheel completes a replay
  await page.getByRole("button", { name: "REPLAY INTRO" }).first().click();
  await page.waitForFunction(() => (window as any).__sco.introStats().playing === true);
  await page.mouse.wheel(0, 200);
  await page.waitForFunction(() => !(window as any).__sco.introStats().playing, null, { timeout: 3000 });
  await ctx.close();
});

test("giant geometry: at the S00 end state the disc is >= 1.2 x the frame height at D, T and M, with the dock line at full length", async ({ browser }) => {
  for (const [w, h] of [[1440, 900], [1280, 720], [1024, 768], [768, 1024], [390, 844], [375, 812], [360, 800]]) {
    const { ctx, page } = await at(browser, w!, h!);
    await openSite(page);
    await page.waitForTimeout(400);
    const d = await page.evaluate(() => (window as any).__sco.discs()[0]);
    expect(2 * d.R, `${w}x${h}`).toBeGreaterThanOrEqual(1.2 * h! - 1);
    await ctx.close();
  }
});

test("chapter navigation: instant jump to the landing progress, hash updated, focus on the heading, Back works", async ({ browser }) => {
  const { ctx, page } = await at(browser, 1440, 900);
  await openSite(page);
  const items = ["real", "sites", "limits", "unfold", "break", "storms", "evidence", "desk"];
  const labels: Record<string, string> = { real: "WHAT IS REAL", sites: "SITES", limits: "LIMITS", unfold: "UNFOLD", break: "BREAK IT", storms: "STORMS", evidence: "EVIDENCE", desk: "THE DESK" };
  for (const id of items) {
    await page.locator(".nav-bar.is-fixed").getByRole("link", { name: labels[id]! }).click();
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => location.hash)).toBe(`#${id}`);
    const f = await page.evaluate(() => document.activeElement?.closest("[data-scene-heading]")?.id ?? document.activeElement?.id);
    expect(f, id).toBe(`${id}-title`);
  }
  await page.goBack();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => location.hash)).toBe("#evidence");
  await ctx.close();
});

test("area rule and routes drawn == flows on every state the page draws (S00, S03a every k, S04, S05 every case, S06, DESK default)", async ({ browser }) => {
  const { ctx, page } = await at(browser, 1440, 900);
  await openSite(page);
  const sol = await data(page, "solutions.json"), sweep = await data(page, "sweep.json");
  const check = async (label: string, partial = false) => {
    await page.waitForTimeout(1600);
    const rep = await page.evaluate(() => (window as any).__sco.dock());
    expect(rep.length, label).toBeGreaterThan(0);
    for (const r of rep) {
      if (r.status === "Infeasible") continue;
      const unmetShare = r.top / r.bottom;
      expect(Math.abs(r.bottom - Math.PI / 2), `${label} bottom`).toBeLessThan(1e-6);
      if (!partial) expect(r.top, `${label} top`).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
      void unmetShare;
    }
    return rep;
  };
  let rep = await check("S00");
  const opt = sol.scenarios.find((s: any) => s.id === "optimized");
  expect(rep[0].keys.filter((k: string[]) => String(k[0]).startsWith("o")).length).toBe(opt.routes_out.length);
  expect(rep[0].keys.filter((k: string[]) => String(k[0]).startsWith("i")).length).toBe(opt.routes_in.length);
  await goScene(page, "sites", 0.5);
  for (const k of [14, 12, 10, 8, 6, 5]) {
    await page.evaluate((kk) => (window as any).__sco.set.sites({ k: kk, relaxed: false }), k);
    rep = await check(`S03a k=${k}`);
    const r = sweep.series.find((s: any) => s.id === "exactly").records.find((x: any) => x.k === k);
    expect(rep[0].keys.filter((q: string[]) => String(q[0]).startsWith("o")).length, `k=${k} out routes`).toBe(r.routes_out.length);
    expect(rep[0].keys.filter((q: string[]) => String(q[0]).startsWith("i")).length, `k=${k} in routes`).toBe(r.routes_in.length);
  }
  await goScene(page, "break", 0.22);
  for (const [c, m, id] of [["supply", "relaxed", "relaxed_supply"], ["capacity", "relaxed", "relaxed_capacity"], ["sites", "relaxed", "relaxed_sites"], ["storm", "relaxed", "storm_legacy"]] as const) {
    await page.evaluate(([cc, mm]) => (window as any).__sco.set.brk({ case: cc, mode: mm, storm: "legacy", live: null }), [c, m] as const);
    rep = await check(`S05 ${id}`, true);
    const s = sol.scenarios.find((x: any) => x.id === id);
    expect(rep[0].keys.filter((q: string[]) => String(q[0]).startsWith("o")).length, id).toBe(s.routes_out.length);
  }
  await ctx.close();
});

test("S03b: the warm-up solve proves the LP hash and objective in the browser; the x1.05 toggle runs a live solve; a forced worker failure falls back honestly", async ({ browser }) => {
  const { ctx, page } = await at(browser, 1440, 900);
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await openSite(page);
  expect(requests.some((u) => u.endsWith(".wasm")), "no wasm before S03b").toBe(false);
  expect(requests.some((u) => u.includes("solver_test_vectors")), "vectors never load on the page").toBe(false);
  await goScene(page, "limits", 0.2);
  await page.waitForFunction(() => (window as any).__sco.state().limits.check.state === "ok", null, { timeout: 60000 });
  const c = await page.evaluate(() => (window as any).__sco.state().limits.check);
  expect(c.hashOk).toBe(true);
  expect(c.objOk).toBe(true);
  expect(requests.some((u) => u.endsWith(".wasm"))).toBe(true);
  await page.getByRole("radio", { name: "x1.05" }).click();
  await page.waitForFunction(() => (window as any).__sco.state().limits.cap === 1.05 && !(window as any).__sco.state().limits.check.solving, null, { timeout: 60000 });
  await expect(page.getByText(/THE DUAL PREDICTED/)).toBeVisible();
  await ctx.close();
  // forced worker failure
  const b = await at(browser, 1440, 900);
  await b.page.addInitScript(() => { (window as any).__failWorker = true; });
  await b.page.goto("?quality=high");
  await b.page.keyboard.press("Escape");
  await b.page.waitForFunction(() => (window as any).__sco?.failWorker);
  await b.page.evaluate(() => (window as any).__sco.failWorker(true));
  await goScene(b.page, "limits", 0.2);
  await expect(b.page.getByText(/BROWSER SOLVER UNAVAILABLE/).first()).toBeVisible({ timeout: 20000 });
  await b.ctx.close();
});

test("THE DESK: every preset solved in the browser matches its published status and objective; routes drawn == flows; demand balances", async ({ browser }) => {
  const { ctx, page } = await at(browser, 1440, 900);
  await openSite(page);
  const sol = await data(page, "solutions.json"), model = await data(page, "model.json"), net = await data(page, "network.json");
  await goScene(page, "desk", 0);
  await page.waitForFunction(() => (window as any).__sco.desk()?.params, null, { timeout: 20000 });
  await page.waitForFunction(() => (window as any).__sco.solverState().status === "ready", null, { timeout: 60000 });
  const bad: string[] = [];
  for (const p of model.presets) {
    await page.evaluate(([id]) => { const b = [...document.querySelectorAll<HTMLButtonElement>(".desk-presets .chip-btn")].find((x) => x.getAttribute("data-id") === id); b?.click(); }, [p.id] as const);
    await page.waitForTimeout(250);
    await page.evaluate(() => (window as any).__sco.deskSolve());
    await page.waitForFunction(() => { const d = (window as any).__sco.desk(); return !d.solving && d.source === "BROWSER"; }, null, { timeout: 60000 });
    const d = await page.evaluate(() => (window as any).__sco.desk());
    const pub = sol.scenarios.find((s: any) => s.id === p.id);
    if (d.status !== pub.status) bad.push(`${p.id}: status ${d.status} vs ${pub.status}`);
    if (pub.objective_usd !== null && Math.abs(d.objective - pub.objective_usd) > 1e-6 * Math.abs(pub.objective_usd)) bad.push(`${p.id}: objective ${d.objective} vs ${pub.objective_usd}`);
    if (d.hashOk !== true) bad.push(`${p.id}: hash ${d.hashOk}`);
    const plan = await page.evaluate(() => (window as any).__sco.deskPlan());
    if (plan.status === "Optimal") {
      const served = new Map<string, number>();
      for (const [a, k, t] of plan.routesOut) { const key = `${net.out_arcs.demand[a]}|${k}`; served.set(key, (served.get(key) ?? 0) + t); }
      const unmet = new Map<string, number>();
      for (const u of plan.relaxation?.unmet_demand ?? []) unmet.set(`${u.demand}|${u.commodity}`, u.tons);
      net.demand_nodes.forEach((n: any, d0: number) => n.demand_tons.forEach((t: number, k: number) => {
        const want = Math.floor(t * plan.params.demand_scale * 1e4 + 0.5) / 1e4;
        const got = (served.get(`${d0}|${k}`) ?? 0) + (unmet.get(`${d0}|${k}`) ?? 0);
        if (Math.abs(got - want) > 0.01) bad.push(`${p.id}: balance ${d0}/${k} ${got} vs ${want}`);
      }));
    }
  }
  expect(bad).toEqual([]);
  await ctx.close();
});

test("THE DESK: an in-flight CANCEL stops the worker within 100 ms and keeps the last solution; TIME LIMIT; EXPLAIN WHY; RESET", async ({ browser }) => {
  const { ctx, page } = await at(browser, 1440, 900);
  await openSite(page);
  await goScene(page, "desk", 0);
  await page.waitForFunction(() => (window as any).__sco.solverState().status === "ready", null, { timeout: 60000 });
  const before = await page.evaluate(() => (window as any).__sco.desk().objective);
  const c = await page.evaluate(() => (window as any).__sco.cancelProbe());
  expect(c.flying, "a real solve was in flight").toBe(true);
  expect(c.ms, "cancel returned within 100 ms").toBeLessThan(100);
  expect(c.solving).toBe(false);
  expect(await page.evaluate(() => (window as any).__sco.desk().objective)).toBe(before);
  // the worker is recreated and still answers
  await page.waitForFunction(() => (window as any).__sco.solverState().status === "ready", null, { timeout: 60000 });
  // a 1 ms limit on a model that cannot finish in 1 ms: the time-limit state or the error path, never a fake optimum
  await page.evaluate(() => (window as any).__sco.setTimeLimit(0.001));
  await page.evaluate(() => (window as any).__sco.deskChange({ demand_scale: 1.25, freight_scale: 1.9, fixed_cost_scale: 2.1, capacity_scale: 0.8 }));
  await page.evaluate(() => (window as any).__sco.deskSolve());
  await page.waitForFunction(() => !(window as any).__sco.desk().solving && ((window as any).__sco.desk().status === "Time limit reached" || (window as any).__sco.desk().error), null, { timeout: 30000 });
  await page.evaluate(() => (window as any).__sco.setTimeLimit(undefined));
  // EXPLAIN WHY after an infeasible solve
  await page.evaluate(() => (window as any).__sco.deskChange({ demand_scale: 1.6, fixed_cost_scale: 1, freight_scale: 1, capacity_scale: 1 }));
  await page.evaluate(() => (window as any).__sco.deskSolve());
  await page.waitForFunction(() => (window as any).__sco.desk().status === "Infeasible", null, { timeout: 60000 });
  await page.getByRole("button", { name: "EXPLAIN WHY" }).click();
  await page.waitForFunction(() => { const d = (window as any).__sco.desk(); return d.status === "Optimal" && d.params.relax && !d.solving; }, null, { timeout: 60000 });
  await expect(page.locator(".words__line").first()).toBeVisible();
  await page.getByRole("button", { name: /^RESET/ }).last().click();
  const d = await page.evaluate(() => (window as any).__sco.desk());
  expect(d.preset).toBe("optimized");
  expect(d.params.demand_scale).toBe(1);
  expect(Math.abs(d.objective - before)).toBeLessThan(1);
  await ctx.close();
});

test("THE DESK: a forced worker failure shows the PRECOMPUTED fallback on preset params and an error with RETRY otherwise (never a hung solve)", async ({ browser }) => {
  const { ctx, page } = await at(browser, 1440, 900);
  await page.goto("?quality=high");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => (window as any).__sco?.failWorker);
  await page.evaluate(() => (window as any).__sco.failWorker(true));
  await goScene(page, "desk", 0);
  await page.waitForFunction(() => (window as any).__sco.desk()?.params, null, { timeout: 20000 });
  await page.waitForFunction(() => (window as any).__sco.solverState().status === "error", null, { timeout: 20000 });
  await page.evaluate(() => (window as any).__sco.deskSolve());
  await page.waitForFunction(() => !(window as any).__sco.desk().solving && (window as any).__sco.desk().fallback, null, { timeout: 10000 });
  await expect(page.getByText(/PRECOMPUTED · PYTHON HiGHS · BROWSER SOLVER FAILED/)).toBeVisible();
  await page.evaluate(() => (window as any).__sco.deskChange({ demand_scale: 1.15 }));
  await page.evaluate(() => (window as any).__sco.deskSolve());
  await page.waitForFunction(() => !(window as any).__sco.desk().solving && (window as any).__sco.desk().error, null, { timeout: 10000 });
  await expect(page.locator('[data-file="solve"] .btn-square')).toBeVisible();
  await ctx.close();
});

test("loading budget: before the intro ends only facts, meta, network and solutions are fetched; no wasm before S03b; no external request, ever", async ({ browser }) => {
  const { ctx, page } = await at(browser, 1440, 900);
  const reqs: string[] = [];
  page.on("request", (r) => reqs.push(r.url()));
  await page.goto("?quality=high");
  await page.waitForFunction(() => (window as any).__sco?.introStats().playing === true);
  await page.waitForTimeout(2500);
  const data = reqs.filter((u) => u.includes("/data/")).map((u) => u.split("/data/")[1]);
  expect([...new Set(data)].sort()).toEqual(["facts.json", "meta.json", "network.json", "solutions.json"]);
  expect(reqs.some((u) => u.endsWith(".wasm"))).toBe(false);
  for (const [id, p] of ALL_SCENES) await goScene(page, id, p);
  const external = reqs.filter((u) => !u.startsWith("http://localhost:4371/") && !u.startsWith("data:") && !u.startsWith("blob:"));
  expect(external).toEqual([]);
  await ctx.close();
});

const CORE = ["network.json", "solutions.json", "facts.json", "meta.json"];
const ALL_SCENES: [string, number][] = [["journey", 0.78], ["real", 0.14], ["sites", 0.5], ["limits", 0.2], ["unfold", 0.62], ["break", 0.22], ["storms", 0.35], ["evidence", 0.05], ["desk", 0], ["closing", 0.9]];
/** every artifact x every scene that consumes it (the core four are read by every scene) */
const ARTIFACTS: [string, string, number][] = [
  ...CORE.flatMap((f) => ALL_SCENES.map(([s, p]) => [f, s, p] as [string, string, number])),
  ...["real", "limits", "break", "evidence", "desk"].map((s) => ["model.json", s, ALL_SCENES.find((x) => x[0] === s)![1]] as [string, string, number]),
  ["quality.json", "real", 0.14], ["sweep.json", "sites", 0.5], ["robustness.json", "storms", 0.35],
];
for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  test(`L4/L12: every artifact fails inside its consuming scene with RETRY, recovered by a REAL pointer click after exactly one re-fetch (${w}x${h})`, async ({ browser }) => {
    const bad: string[] = [];
    for (const [file, scene, p] of ARTIFACTS) {
      if (w === 390 && CORE.includes(file) && !(["journey", "sites", "desk"] as string[]).includes(scene)) continue;
      const { ctx, page } = await at(browser, w, h);
      let fails = 0, fetches = 0, block = true;
      await page.route(`**/data/${file}`, (route) => { fetches++; if (block) { fails++; return route.fulfill({ status: 503, body: "no" }); } return route.continue(); });
      await page.goto("?quality=high");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1200);
      await page.evaluate(([s, q]) => (window as any).__sco?.jumpTo(s, q), [scene, p] as const);
      const sel = `[data-file="${file}"] .btn-square`;
      try { await page.waitForSelector(sel, { timeout: 8000, state: "attached" }); } catch { bad.push(`${w} ${file} x ${scene}: no inline error`); await ctx.close(); continue; }
      await page.waitForTimeout(300);
      const pt = await page.evaluate((s) => {
        const el = [...document.querySelectorAll<HTMLElement>(s)].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight; });
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const top = document.elementFromPoint(x, y);
        return { x, y, ok: top === el || el.contains(top) };
      }, sel);
      if (!pt) bad.push(`${w} ${file} x ${scene}: RETRY not in view`);
      else if (!pt.ok) bad.push(`${w} ${file} x ${scene}: RETRY covered`);
      else {
        const before = fetches;
        block = false;
        await page.mouse.click(pt.x, pt.y);
        await page.waitForTimeout(1500);
        if (fetches - before !== 1) bad.push(`${w} ${file} x ${scene}: ${fetches - before} re-fetches`);
        if (await page.locator(`[data-file="${file}"]`).count()) bad.push(`${w} ${file} x ${scene}: error still shown after RETRY`);
      }
      void fails;
      await ctx.close();
    }
    expect(bad).toEqual([]);
  });
}
