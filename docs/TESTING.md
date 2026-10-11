# Testing (data and engine phases)

`uv run pytest` runs 74 tests (about 60 s, executed 2026-10-11, all passed; `tests/test_requests.py` covers DR-1 to DR-10). Marked `slow`: generator-from-raw, Python re-solve of every parity vector, node/HiGHS-wasm vector run, byte-identical rerun.

| Area | Tests |
|---|---|
| Data | join ledger reconciles exactly (`gazetteer = joined + unmatched`, `usable = active - non-contiguous - zero-pop`); population-ordered unique GEOIDs, contiguous-US bounds; capacity and supply headroom as documented; arcs are the R nearest sites; distance = great-circle x 1.2 |
| Reproducibility | generator output identical on repeat and different for another seed; Monte Carlo draws seeded; full publish rerun is byte-identical to the committed artifacts |
| Model correctness (independent of the solver, from route lists + network.json only) | demand balance per node and commodity; flow conservation at sites; site capacity and plant supply respected; closed sites carry no flow; open-site limit; objective recomputed from routes equals the published objective (2e-5 relative); component sum equals objective |
| Routes == flows | re-solve from the published params and compare the route lists exactly (4 scenarios incl. a relaxed one) |
| Duals | strong duality of the fixed-design LP; sign of capacity/supply/demand duals; binding rows have zero slack; capacity shadow price equals a finite difference (+100 units) within 5 percent |
| Infeasibility | strict model Infeasible for supply, capacity and open-site shortfalls; relaxation totals equal the analytic shortfall (supply 0.15 x demand, capacity need minus 30 percent); a feasible instance relaxes nothing and has the same objective |
| Robustness | published shapes, mean consistency, CVaR >= p95, histograms count every draw, undisrupted equals the deterministic solutions, the evaluator restores state between runs, the first 12 draws reproduce |
| Browser parity | Python reproduces hash/status/objective for all 41 vectors; node + highs@1.15.3 reproduces the same (see below) |
| Contracts | every artifact validates; each under 400 KB gzip; schema files equal the generator; every artifact has valid tags; no U+2014/U+2015 in any tracked or untracked repo file |

## Executed browser-parity run (artifacts/evidence/parity_report.json)
`node tests/parity/build_lp.mjs` with Node v24.21.0 and npm highs@1.15.3 (HiGHS-wasm): 41 vectors, 0 failures (31 original plus 10 `open_exactly` / sweep vectors). The JavaScript builder produced a byte-identical LP text (SHA-256 match) for every vector, including the strict infeasible vectors (status `Infeasible`, including exactly-k) and the relaxed vectors (elastic slack, objective includes penalties); objectives match the Python reference within the 1e-6 relative tolerance.
Wasm solve time in Node on this machine (Apple laptop, 1 thread): median 58 ms, max 1,220 ms, default optimized network under 1 s. This is node's V8, not a browser tab, and excludes the Web Worker round trip and wasm download; the "under about 2 s" target holds on this measurement but must be re-measured in the real browser in the site phases. Python HiGHS solves the same default model in about 0.6 s.
Instance size was chosen with this measurement: an earlier 16-site, 6-arc variant had a 4.2 s worst case in wasm and was rejected.
