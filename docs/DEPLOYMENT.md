# Deployment (data side)

The site is static: copy `site/public/data/*.json` into the Pages build (Vite serves `public/` as is). Regenerate with `uv run python -m pipelines.run_all` (needs network only for the first download; raw files are gitignored). Before publishing run `uv run pytest` and `node tests/parity/build_lp.mjs`. GitHub repo creation, Pages workflow and the live-URL check belong to the later deploy phase and are not done here.
`.wasm` must be served as `application/wasm` (GitHub Pages does this); the highs wasm file is fetched by the worker.
