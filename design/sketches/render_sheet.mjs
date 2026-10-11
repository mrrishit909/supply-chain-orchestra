// Rasterizes the P07 sketches with Playwright Chromium; compose_sheet.py then builds distinctness-sheet.png.
// Run from the project root with a sibling project's Playwright:
//   NODE_PATH=../03-climate-signal-observatory/site/node_modules node design/sketches/render_sheet.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = path.dirname(new URL(import.meta.url).pathname);
const svgs = fs.readdirSync(here).filter((f) => f.endsWith('.svg'));
const browser = await chromium.launch();
const page = await browser.newPage();
for (const f of svgs) {
  const head = fs.readFileSync(path.join(here, f), 'utf8').slice(0, 300);
  const [, w, h] = head.match(/width="(\d+)" height="(\d+)"/);
  await page.setViewportSize({ width: +w, height: +h });
  await page.goto('file://' + path.join(here, f));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(here, f.replace(/\.svg$/, '.png')) });
}
await browser.close();
console.log('rendered', svgs);
