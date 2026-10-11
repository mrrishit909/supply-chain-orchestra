# 07 Supply Chain Orchestra: Every Product Has a Journey

A SYNTHETIC two-echelon supply network anchored to real US cities (Census population and coordinates), solved as a capacitated facility-location +
multi-commodity-flow MILP. The Python reference (HiGHS via highspy) and the browser (HiGHS-wasm, highs@1.15.3) solve the identical LP text; infeasible
scenarios are explained by an elastic constraint relaxation; a seeded Monte Carlo compares a legacy footprint with the optimized one under outages and demand shocks.

This repository currently holds the data and engine phases (01-13): problem, sources, contracts, generator, optimization, validation and the versioned JSON artifacts in
`site/public/data/`. The static site (React/Vite) is built from those artifacts in later phases.

## Run
```
uv sync
uv run python -m pipelines.run_all        # download Census files (if absent), build, solve, Monte Carlo, write + validate artifacts (~20 s)
uv run pytest                              # 59 tests incl. slow ones (~50 s)
cd tests/parity && npm ci && node build_lp.mjs --report ../../artifacts/evidence/parity_report.json   # HiGHS-wasm parity
```

## Layout
`pipelines/` ingest, clean, contracts (schemas), publish, validate; `analytics/` network generator, MILP builder/solver, scenario packaging, Monte Carlo;
`tests/` pytest and the node parity harness; `data/contracts/` JSON Schemas; `docs/` see PROBLEM, DATA_SOURCES, DATA_CONTRACTS, METHODOLOGY, ARCHITECTURE, TESTING, LIMITATIONS, DEPLOYMENT.

Data: U.S. Census Bureau PEP 2025 and Gazetteer 2026. This product uses Census Bureau data but is not endorsed or certified by the Census Bureau.
Everything else (network, costs, outputs) is SYNTHETIC and says so in every artifact.
