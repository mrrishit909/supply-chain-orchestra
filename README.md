# 07 Supply Chain Orchestra: Every Product Has a Journey

A SYNTHETIC two-echelon supply network anchored to real US cities (Census population and coordinates), solved as a capacitated facility-location +
multi-commodity-flow MILP. The Python reference (HiGHS via highspy) and the browser (HiGHS-wasm, highs@1.15.3) solve the identical LP text; infeasible
scenarios are explained by an elastic constraint relaxation; a seeded Monte Carlo compares a legacy footprint with the optimized one under outages and demand shocks.

The repository holds the data and engine phases (01-13) and the static site in `site/` (React 18, Vite, TypeScript strict, Canvas2D, HiGHS-wasm in a worker). The site
draws one invented year of freight as a disc cut by a dock (area = tons), re-solves the MILP in the browser on THE DESK and explains infeasibility by constraint relaxation.

## Run
```
uv sync
uv run python -m pipelines.run_all        # download Census files (if absent), build, solve, Monte Carlo, write + validate artifacts (~20 s)
uv run pytest                              # 74 tests incl. slow ones (~60 s)
cd tests/parity && npm ci && node build_lp.mjs --report ../../artifacts/evidence/parity_report.json   # HiGHS-wasm parity
```

## Layout
`pipelines/` ingest, clean, contracts (schemas), publish, validate; `analytics/` network generator, MILP builder/solver, scenario packaging, Monte Carlo;
`tests/` pytest and the node parity harness; `data/contracts/` JSON Schemas; `docs/` see PROBLEM, DATA_SOURCES, DATA_CONTRACTS, METHODOLOGY, ARCHITECTURE, TESTING, LIMITATIONS, DEPLOYMENT.

Data: U.S. Census Bureau PEP 2025 and Gazetteer 2026. This product uses Census Bureau data but is not endorsed or certified by the Census Bureau.
Everything else (network, costs, outputs) is SYNTHETIC and says so in every artifact.

## Site
```
cd site && npm ci
npm run build && node tests/serve.mjs      # production preview on http://localhost:4371/supply-chain-orchestra/
npm test                                    # Vitest incl. LP parity of all 41 vectors (hash + HiGHS-wasm objective)
npx playwright test --workers 1             # e2e gate: QA_LESSONS L1-L22, solver states, RETRY for every artifact
node tests/evidence-harness.mjs --base-url http://localhost:4371/supply-chain-orchestra/
```
Honesty tags: network and costs SYNTHETIC, solver outputs SIMULATED, Census places OBSERVED, hauls and shadow prices DERIVED.

## Code licence status

No code licence has been selected for this repository. It is public so the work can be viewed; public visibility does not itself grant any right to copy, modify, redistribute or reuse the code, text or design. All rights are reserved by the author until a licence file is added. Third-party data keeps its own licence and attribution terms, listed in `docs/DATA_SOURCES.md`.
