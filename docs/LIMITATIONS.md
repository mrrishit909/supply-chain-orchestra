# Limitations

1. **The network is synthetic.** Only population and internal-point coordinates are observed. Sites, plants, capacities, volumes, rates, fixed costs and land indices are generator parameters, tuned so the optimum is non-trivial. No statement about any real company, lane or freight price follows.
2. **No freight-cost source.** Rates per ton-mile are assumptions. FAF5 was not used (BTS returned HTTP 403; licence text unverified; no rate field anyway).
3. **Great-circle distances x 1.2**, not road routes; no transit time, tolls, mode choice or congestion. Internal points are inside a city boundary, not facilities.
4. **Single period, static, no inventory or lead times.** Annual tons; flow conservation has no storage; no safety stock; fixed cost is annual.
5. **Contiguous US, top 100 places only.** 30.2 percent of usable population; small places, rural demand and Alaska/Hawaii/Puerto Rico are excluded.
6. **Sparse arcs.** A demand node can only be served by its 5 nearest candidate sites, which is why a regional outage can strand a node even when far-away capacity exists.
7. **Duals are conditional** on the optimal open set and valid for small changes only; the open-site limit has no dual.
8. **Relaxation penalties** are modelling devices; the split of a violation among rows can differ across alternative optima; the report is a diagnosis, not a recommendation.
9. **Monte Carlo evaluates fixed designs** (the design is not optimised against disruptions, flows are re-optimised with perfect information), independence and thresholds are assumptions, 500 draws gives noisy tails (CVaR95 uses the worst 25 draws).
10. **Legacy footprint is a rule** (six largest-city sites), not an observed network; the 4.15 percent saving is a property of the synthetic costs.
11. **Browser timing** was measured in Node with the same wasm build, not in a browser; a MIP can be slower on other instances: the browser must set a time limit and handle `Time limit reached` (status strings other than `Optimal`/`Infeasible` are not pinned).
12. **Census licence**: public-domain status unverified (census.gov copyright page 404); attribution given, no endorsement implied.

## Frontend limitations (P07-FE-001)
13. **highs-js returns no MIP gap.** A time-limited incumbent shows `GAP UNKNOWN`; only a solve whose params equal a preset could be compared with that preset's LP bound.
14. **Live shadow prices cost a second LP.** They are shown only for optimal, non-relaxed solves, tagged DERIVED and conditional on the open set; a relaxed solve shows binding rows from the primal without prices.
15. **Monte Carlo discs are pooled by site.** Per-draw flows per city and commodity are not published, so an S06 disc draws one bar per surviving site (all packaged-goods orange) plus the UNSERVED slot, and says so.
16. **S03b dual check differs from the published fallback.** The live toggle scales every site's capacity (the model has one capacity control) on a free MILP; the published `fd_check` fallback raises S10 alone with the open set fixed. The page labels which one it shows.
17. **Words for live relaxed solves** can differ from the published sentences when the optimum is not unique (DATA_CONTRACTS, unsupported item 4).
18. **A keyed re-partition retargeted mid-flight snaps to the nearer end** before restarting (no arbitrary intermediate plan exists to blend from).
19. **Reduced motion draws each scene's own stills** (S03a four docks, S03b three, S04 a three-frame strip, S05 eight, S06 five pairs); the live stepper, toggles and THE DESK work with instant updates.
20. **Frame pacing and Lighthouse were measured on one laptop** at the machine load recorded with each run, not on a phone.
