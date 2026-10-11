import type { Page } from "@playwright/test";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Scenes and the progress points every QA walk visits (landing points plus the states that carry the most text). */
export const WALK: [string, number][] = [
  ["journey", 0.0], ["journey", 0.78], ["real", 0.14], ["real", 0.36], ["real", 0.58], ["real", 0.8], ["sites", 0.2], ["sites", 0.5], ["sites", 0.9], ["limits", 0.2], ["limits", 0.5], ["limits", 0.8],
  ["unfold", 0.05], ["unfold", 0.36], ["unfold", 0.62], ["unfold", 0.95], ["break", 0.12], ["break", 0.22], ["break", 0.45], ["break", 0.8], ["storms", 0.35], ["storms", 0.78], ["storms", 0.92],
  ["evidence", 0.05], ["evidence", 0.5], ["evidence", 0.95], ["desk", 0], ["closing", 0.9],
];

export async function openSite(page: Page, query = "?quality=high") {
  await page.goto(query);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => ((window as any).__sco && !(window as any).__sco.introStats().playing && (window as any).__sco.debug().frames > 1) || document.documentElement.dataset.motion === "off");
}
export async function goScene(page: Page, id: string, p: number) {
  await page.evaluate(([i, q]) => (window as any).__sco.jumpTo(i, q), [id, p] as const);
  await page.waitForTimeout(id === "desk" ? 900 : id === "closing" ? 1500 : 700);
}

/**
 * L2 collisions in the scene on screen: every visible text run, chip and control against every other (DOM vs DOM),
 * and text without an opaque backing against the drawn rose's disc. Returns readable descriptions.
 */
export function collisions(page: Page, id: string, debug = false) {
  return page.evaluate(([sid, dbg]) => {
    const vw = innerWidth, vh = innerHeight;
    const scope = sid === "desk" ? document.getElementById(sid)! : document.getElementById(sid)!.querySelector(".stage")!;
    const roots = [scope, ...document.querySelectorAll(".nav-bar.is-fixed, .nav-pill.is-fixed, .corner-btn")];
    const eff = (e: Element) => { let o = 1; for (let n: Element | null = e; n; n = n.parentElement) { const cs = getComputedStyle(n); o *= Number(cs.opacity); if (cs.visibility === "hidden" || cs.display === "none") return 0; } return o; };
    const backed = (e: Element) => { for (let n: Element | null = e; n && n !== scope; n = n.parentElement) { const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(n).backgroundColor); if (m) { const a = m[1]!.split(",").map(Number); if ((a[3] ?? 1) >= 0.7) return true; } } return false; };
    type B = { el: Element; r: DOMRect; name: string; backed: boolean };
    const boxes: B[] = [];
    const seen = new Set<Element>();
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement!;
        if (!n.textContent?.trim() || eff(el) < 0.05 || el.closest("svg, .sr-only, [aria-hidden=true] .wr, details:not([open]) :not(summary)")) continue;
        // a story deck scrolls cards past the viewport by design: only the centred card is read
        const card = el.closest(".story-card");
        if (card) { const cr = card.getBoundingClientRect(); if (!(cr.left < vw / 2 && cr.right > vw / 2)) continue; }
        const hit = el.closest("button, a, label, select, .chip, [role=radio], [role=tab]");
        const ctl = hit ?? el;
        if (seen.has(ctl)) continue;
        seen.add(ctl);
        const rg = document.createRange(); rg.selectNodeContents(n);
        // ellipsised or clipped text: its box, not the full run; glyph boxes are inset 20% vertically (line boxes touch by design)
        const clipped = getComputedStyle(el).overflow === "hidden" || getComputedStyle(el).textOverflow === "ellipsis";
        const run = !hit && !clipped;
        // a control or chip is its full painted box; a bare text run is its glyph band
        const rects = run ? [...rg.getClientRects()].map((r) => new DOMRect(r.left, r.top + r.height * 0.2, r.width, r.height * 0.6)) : [ctl.getBoundingClientRect()];
        for (const r of rects) if (r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < vh) boxes.push({ el: ctl, r, name: (ctl.textContent ?? "").trim().slice(0, 32), backed: backed(ctl) });
      }
    }
    for (const c of root2controls()) { if (!seen.has(c) && eff(c) > 0.05) { const r = c.getBoundingClientRect(); if (r.width > 1 && r.bottom > 0 && r.top < vh) boxes.push({ el: c, r, name: c.getAttribute("aria-label") ?? c.tagName, backed: true }); } }
    // L19: every interactive element is a box too (icon buttons, sliders, focusable hit areas), found from the DOM
    function root2controls() { return [...scope.querySelectorAll("button, a[href], input, select, textarea, [role=button], [role=radio], [role=tab], [role=slider]")].filter((e) => !e.matches(".hit")); }
    // QA L13: what the canvases drew (hour labels, skyline, week axis and labels) against every DOM text box
    const marks: { name: string; x: number; y: number; w: number; h: number }[] = (window as any).__sco.marks();
    if (dbg) return boxes.map((b) => `${b.name} ${Math.round(b.r.left)}..${Math.round(b.r.right)} ${Math.round(b.r.top)}-${Math.round(b.r.bottom)}`);
    // a scene in normal flow (CTRL, every scene under reduced motion) scrolls under the fixed nav like any page
    const flow = sid === "desk" || getComputedStyle(scope).position !== "sticky";
    const out: string[] = [];
    const inter = (a: DOMRect, b: DOMRect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i]!;
      if (a.r.left < -1 || a.r.right > vw + 1) out.push(`offscreen "${a.name}" (${Math.round(a.r.left)}..${Math.round(a.r.right)})`);
      for (let j = i + 1; j < boxes.length; j++) {
        const b = boxes[j]!;
        if (a.el.contains(b.el) || b.el.contains(a.el) || a.el === b.el) continue;
        const isNav = (e: Element) => !!e.closest(".nav-bar, .nav-pill, .corner-btn");
        if (flow && isNav(a.el) !== isNav(b.el)) continue;
        if (inter(a.r, b.r) > 4) out.push(`"${a.name}" x "${b.name}"`);
      }
    }
    for (const b of boxes) for (const m of marks) {
      const r = new DOMRect(m.x, m.y, m.w, m.h);
      if (r.bottom < 0 || r.top > vh) continue;
      if (inter(b.r, r) > 4) out.push(`"${b.name}" x canvas ${m.name}`);
    }
    // text over a drawn disc: only text without an opaque backing counts (the S00 headline and S08 paragraph sit under their own scrims)
    const discs: { cx: number; cy: number; R: number }[] = (window as any).__sco.discs();
    if (sid !== "journey" && sid !== "closing") for (const b of boxes) {
      if (b.backed || b.el.closest(".nav-bar, .nav-pill, .corner-btn, .dock-label, .site-foot")) continue;
      for (const d of discs) {
        const nx = Math.max(b.r.left, Math.min(d.cx, b.r.right)), ny = Math.max(b.r.top, Math.min(d.cy, b.r.bottom));
        if (Math.hypot(nx - d.cx, ny - d.cy) < d.R * 0.98) out.push(`"${b.name}" over the disc`);
      }
    }
    return [...new Set(out)];
  }, [id, debug] as const);
}

/**
 * L16/L19: pixel-sampled text contrast for every visible text-bearing element (built from the DOM, no selector list).
 * The page is captured once with all text made transparent; each element's backdrop is sampled from that frame and
 * its own text colour (alpha and ancestor opacity applied) is composited over it. Returns elements whose 10th-percentile
 * contrast is under 4.5:1 (3:1 for large text), as readable descriptions.
 */
export async function contrastFails(page: Page) {
  const items: { i: number; name: string; pts: [number, number][]; rgba: number[]; large: boolean }[] = await page.evaluate(() => {
    const out: any[] = [];
    const seen = new Set<Element>();
    const vw = innerWidth, vh = innerHeight;
    const eff = (e: Element) => { let o = 1; for (let n: Element | null = e; n; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === "none" || cs.visibility === "hidden") return 0; o *= Number(cs.opacity); } return o; };
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const el = n.parentElement!;
      if (!n.textContent?.trim() || seen.has(el) || el.closest("svg, canvas, .sr-only, script, style, [aria-hidden=true] .wr")) continue;
      seen.add(el);
      const o = eff(el);
      if (o < 0.6) continue; // mid-transition or deliberately dimmed backdrops are not read as text
      const rg = document.createRange(); rg.selectNodeContents(n);
      const rs = [...rg.getClientRects()].filter((r) => r.width > 2 && r.height > 2);
      if (!rs.length) continue;
      const r = rs.reduce((a, b) => new DOMRect(Math.min(a.left, b.left), Math.min(a.top, b.top), Math.max(a.right, b.right) - Math.min(a.left, b.left), Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top)));
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
      if (el.closest("details:not([open])") && !el.closest("summary")) continue; // collapsed content is not shown
      if (el.closest("[aria-disabled=true], :disabled")) continue; // disabled controls are exempt (WCAG 1.4.3)
      // covered text (scrolled under a fixed bar, behind a card) is not read here; only what is on top is
      const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
      const mine = (x: number, y: number) => { const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t) || t.contains(el)); };
      if (!mine(cx, cy)) continue;
      // only the backdrop points where this text is on top (a fixed bar may cover part of a scrolled line)
      const pts: [number, number][] = [];
      const step = Math.max(2, Math.sqrt((r.width * r.height) / 160));
      for (let y = Math.max(0, r.top) + 1; y < Math.min(vh, r.bottom); y += step) for (let x = Math.max(0, r.left) + 1; x < Math.min(vw, r.right); x += step) if (mine(x, y)) pts.push([x, y]);
      if (pts.length < 4) continue;
      const cs = getComputedStyle(el);
      const m = cs.color.match(/[\d.]+/g)!.map(Number);
      const fs = parseFloat(cs.fontSize), fw = Number(cs.fontWeight) || 400;
      out.push({ i: out.length, name: (n.textContent ?? "").trim().slice(0, 28), pts, rgba: [m[0]!, m[1]!, m[2]!, (m[3] ?? 1) * o], large: fs >= 24 || (fs >= 18.66 && fw >= 700) });
    }
    return out;
  });
  await page.evaluate(() => { const s = document.createElement("style"); s.id = "cc-hide"; s.textContent = "*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; }"; document.head.append(s); });
  await page.waitForTimeout(60);
  const png = (await page.screenshot()).toString("base64");
  await page.evaluate(() => document.getElementById("cc-hide")?.remove());
  return page.evaluate(async ([b64, list]) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext("2d")!; g.drawImage(img, 0, 0);
    const k = img.width / innerWidth;
    const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = (c: number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
    const bad: string[] = [];
    for (const it of list) {
      const rs: number[] = [];
      for (const [x, y] of it.pts) {
        const d = g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data;
        const bg = [d[0]!, d[1]!, d[2]!], a = it.rgba[3]!;
        const fg = [0, 1, 2].map((j) => it.rgba[j]! * a + bg[j]! * (1 - a));
        const l1 = lum(fg), l2 = lum(bg);
        rs.push((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05));
      }
      rs.sort((x, y) => x - y);
      const p10 = rs[Math.floor(rs.length * 0.1)] ?? 21;
      if (p10 < (it.large ? 3 : 4.5)) bad.push(`"${it.name}" ${p10.toFixed(2)}:1`);
    }
    return bad;
  }, [png, items] as const);
}

/**
 * L19 (ported from the QA pass-3 probe artifacts/evidence/qa-3/probes/collide.mjs): one box list built from the whole
 * DOM (every visible text run, every interactive element or chip, fixed nav / pill / corner buttons included as they
 * are) plus the canvas marks. Pairs overlapping > 4 px^2 are defects unless they are flowing content scrolling under a
 * fixed element that has an opaque backing (normal page scrolling). Returns readable defect strings.
 */
export function collideAll(page: Page) {
  return page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const effOp = (e: Element) => { let o = 1; for (let n: Element | null = e; n; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === "none" || cs.visibility === "hidden") return 0; o *= +cs.opacity; } return o; };
    const fixedAnc = (e: Element) => { for (let n: Element | null = e; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).position === "fixed") return n; return null; };
    const pinned = (e: Element) => { for (let n: Element | null = e; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).position === "sticky") return true; return false; };
    const backed = (e: Element) => { for (let n: Element | null = e; n && n !== document.body; n = n.parentElement) { const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(n).backgroundColor); if (m) { const a = m[1]!.split(",").map(Number); if ((a[3] ?? 1) >= 0.85) return true; } if (getComputedStyle(n).position === "fixed") break; } return false; };
    type Owner = Element | { mark: true };
    const isMark = (o: Owner): o is { mark: true } => "mark" in o;
    const boxes: { owner: Owner; r: { l: number; t: number; r: number; b: number }; name: string }[] = [];
    // a scroll container or overflow:hidden ancestor clips what its content paints: only the visible part can collide
    const clipTo = (el: Element, r: { l: number; t: number; r: number; b: number }) => {
      for (let n: Element | null = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
        if (cs.position === "sticky" && n.classList.contains("stage")) continue;
        const b = n.getBoundingClientRect();
        if (cs.overflowX !== "visible") { r.l = Math.max(r.l, b.left); r.r = Math.min(r.r, b.right); }
        if (cs.overflowY !== "visible") { r.t = Math.max(r.t, b.top); r.b = Math.min(r.b, b.bottom); }
      }
      return r.r > r.l && r.b > r.t;
    };
    const add = (owner: Owner, r: DOMRect, name: string) => {
      if (!(r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw)) return;
      const box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
      if (!isMark(owner) && !clipTo(owner, box)) return;
      boxes.push({ owner, r: box, name });
    };
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const el = n.parentElement; if (!el || !n.textContent?.trim() || el.closest(".sr-only, [aria-hidden=true], details:not([open]) :not(summary), title, script, style")) continue;
      if (effOp(el) < 0.3) continue;
      const card = el.closest(".story-card"); if (card) { const cr = card.getBoundingClientRect(); if (!(cr.left < vw / 2 && cr.right > vw / 2)) continue; }
      const ctl = el.closest("button, a, label, select, summary, [role=button], [role=radio], [role=tab], [class*=chip]");
      if (ctl) { add(ctl, ctl.getBoundingClientRect(), (ctl.textContent || "").trim().slice(0, 28)); continue; }
      const rg = document.createRange(); rg.selectNodeContents(n);
      if (getComputedStyle(el).overflow === "hidden") { add(el, el.getBoundingClientRect(), n.textContent.trim().slice(0, 28)); continue; }
      for (const q of rg.getClientRects()) add(el, new DOMRect(q.left, q.top + q.height * 0.2, q.width, q.height * 0.6), n.textContent.trim().slice(0, 28));
    }
    for (const c of document.querySelectorAll("button, a[href], input, select, summary, [role=button], [role=radio], [role=tab], [role=switch], [role=slider], [tabindex]:not([tabindex='-1']), [class*=chip]")) {
      if (effOp(c) < 0.3 || c.closest("[aria-hidden=true]")) continue;
      const q = c.getBoundingClientRect();
      if (!(c.textContent || "").trim() && q.width * q.height > 20000) continue; // figure hit areas: L9 checks them
      add(c, q, c.getAttribute("aria-label") || (c.textContent || "").trim().slice(0, 28) || c.tagName);
    }
    const markOwner = { mark: true as const };
    for (const m of (window as any).__sco?.marks?.() ?? []) add(markOwner, new DOMRect(m.x, m.y, m.w, m.h), "canvas " + m.name);
    const out: string[] = [];
    const seen = new Set<string>();
    // L13: text without an opaque backing over a painted disc is a collision (the disc is canvas, so the DOM boxes cannot see it)
    const dbg = (window as any).__sco?.debug?.() ?? {};
    if (dbg.scene && dbg.scene !== "journey" && dbg.scene !== "closing") {
      for (const b of boxes) {
        if (isMark(b.owner) || backed(b.owner) || b.owner.closest(".nav-bar, .nav-pill, .corner-btn, .site-foot, .sheet, .tooltip, .hit")) continue;
        for (const d of (window as any).__sco.discs() as { cx: number; cy: number; R: number }[]) {
          const nx = Math.max(b.r.l, Math.min(d.cx, b.r.r)), ny = Math.max(b.r.t, Math.min(d.cy, b.r.b));
          if (Math.hypot(nx - d.cx, ny - d.cy) < d.R * 0.98) { const k = `disc|${b.name}`; if (!seen.has(k)) { seen.add(k); out.push(`over-disc: "${b.name}"`); } }
        }
      }
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!, b = boxes[j]!;
      if (a.owner === b.owner || (isMark(a.owner) && isMark(b.owner))) continue;
      if (!isMark(a.owner) && !isMark(b.owner) && (a.owner.contains(b.owner) || b.owner.contains(a.owner))) continue;
      const w = Math.min(a.r.r, b.r.r) - Math.max(a.r.l, b.r.l), h = Math.min(a.r.b, b.r.b) - Math.max(a.r.t, b.r.t);
      if (w <= 0 || h <= 0 || w * h <= 4) continue;
      const fa = isMark(a.owner) ? null : fixedAnc(a.owner), fb = isMark(b.owner) ? null : fixedAnc(b.owner);
      let cls: string;
      if (fa && fb) cls = fa === fb ? "fixed-internal" : "fixed-vs-fixed";
      else if (fa || fb) { const f = fa ? a : b, o = fa ? b : a; cls = !isMark(o.owner) && pinned(o.owner) ? "fixed-over-pinned" : backed(f.owner as Element) ? "flow-under-fixed" : "flow-under-fixed-unbacked"; }
      else cls = (!isMark(a.owner) && pinned(a.owner)) || (!isMark(b.owner) && pinned(b.owner)) ? "pinned" : "flow";
      if (cls === "flow-under-fixed" || cls === "fixed-internal") continue;
      const key = `${cls}|${a.name}|${b.name}`; if (seen.has(key)) continue; seen.add(key);
      out.push(`${cls}: "${a.name}" x "${b.name}"`);
    }
    return out;
  });
}
