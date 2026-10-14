# Deployment

The site is static (Vite `dist/`), base path `/supply-chain-orchestra/` (repo slug from `EXECUTION_STATE.json`; there is no `portfolio/07-*/project.json` yet, so the slug is the one open question).

1. `cd site && npm ci && npm run build` (tsc strict, then Vite). The build emits `dist/data/*.json` from `site/public/data/` and one worker chunk plus `highs.wasm` (about 1.2 MB, loaded only from S03b or THE DESK).
2. Serve `dist/` as is. `.wasm` must be `application/wasm` (GitHub Pages does this). No server-side rewrite: a missing artifact is a real 404 (`appType: "mpa"`) and the page shows its inline RETRY.
3. Local production preview for QA: `node tests/serve.mjs` (port 4371, restarts itself if killed).
4. Before publishing: `uv run pytest`, `npm run typecheck && npm run lint && npm test`, `npx playwright test --workers 1`, the evidence harness and Lighthouse x3 (`tests/run-lighthouse.sh`).
5. Publishing (public repo, Pages, case study) is done by the release step, not by the frontend task.

External links used by S08 (`src/config.ts`): the repo, `docs/METHODOLOGY.md`; both are verified at release.
