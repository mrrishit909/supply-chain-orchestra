# Methodology (phases 05-12)

## Network generator (`analytics/network.py`, seed 20261011)
All rules are deterministic given the seed; `quality.json` records the executed checks and `network.json.constants` the parameters.
1. **Demand nodes**: the 100 largest contiguous-US places by PEP 2025 population that join to the Gazetteer (63.8 M people, 30.2 percent of the usable population).
2. **Candidate sites (14)**: from the 60 largest places by population-weighted farthest-point selection (score = distance to the nearest chosen site times sqrt(population); the first pick is a seeded draw among the 5 largest). Sites are sorted by host population, S00 is the largest.
3. **Plants (3)**: plain farthest-point selection from the 30 largest places (first pick seeded). Plants ship all three commodities with supply = 1.25 x demand split 40/35/25.
4. **Commodities**: packaged goods (14 t per 1000 people), cold chain (4), bulky goods (22), with per ton-mile rates (in: 0.12/0.20/0.09, out: 0.35/0.60/0.25 USD), handling (9/22/14 USD per ton) and capacity use (1.0/1.6/0.8 units per ton). All SYNTHETIC. Node demand = population x rate x lognormal(0, 0.12) noise, whole tons.
5. **Site capacity** proportional to sqrt(host population), total = 2.4 x total weighted demand. **Fixed cost** = 20 M USD x land index, index = 0.8 + 0.8 x normalised log population + N(0, 0.06) noise (bigger metros cost more).
6. **Arcs**: each demand node can be served by its 5 nearest candidate sites (500 out-arcs); every plant connects to every site. Distance = haversine x 1.2 circuity, 0.1 mi.
7. **Calibration remark**: the fixed cost and rate levels were tuned (by looking at the solver's open-site count) so the optimum opens a handful of sites rather than all or one. That makes the case interesting, not the numbers real; see LIMITATIONS.

## Model (`analytics/milp.py`; formulation in `model.json`)
1,640 columns (14 binaries), 1,866 rows, 7,780 non-zeros for the strict model. Per-arc linking rows tighten the relaxation (the LP bound is 0.28 percent below the optimum) and were measured faster than the aggregate capacity row alone.
Solver options (published): `mip_rel_gap 0`, `mip_abs_gap 1e-6`, `threads 1`, `random_seed 0`. The model goes through LP text and `readModel`, the same path as the browser.

## Infeasibility explanation (elastic relaxation)
With `relax = true` four slack families are added with per-unit penalties that exceed any feasible marginal cost of the same quantity (unmet demand 6000 USD/t, plant supply 3500 USD/t, site capacity 2500 USD/unit, extra open site 30 M USD). A slack is therefore positive only when the strict model cannot be satisfied, and the relaxation prefers the cheapest violation. The report lists every slack above 0.0005 by constraint family. Tests prove the report is exact on constructed shortfalls: demand x1.4 gives a plant-supply overshoot of 388,466 t = 0.15 x demand; capacity x0.3 gives a capacity overshoot equal to weighted demand minus 30 percent of capacity; an open-site limit of 2 reports the extra sites needed.
Caveat: the split of a given total violation across rows can differ between alternative optima; status, objective and group totals are what is compared in parity.

## Duals and binding constraints
Binaries are fixed at the MILP optimum and the LP is re-solved. Row duals are therefore **conditional on that open set**, valid for small right-hand-side changes only. `shadow_usd_per_unit` = -dual of a capacity or supply row (USD saved per extra unit); `demand_price_usd_ton` = dual of the demand row (cost to serve one more ton at that node and commodity). Strong duality (fixed-design LP objective = MILP objective) and a finite-difference check of a capacity shadow price are tests. The open-site limit is an integer constraint and has no LP dual (`shadow_usd_per_unit` null).

## Monte Carlo (`analytics/robustness.py`, seed 20261012, 500 draws)
Each draw: independent site outages (6 percent), with probability 35 percent a regional event (epicentre = random demand node, sites within 350 mi fail with probability 0.8, demand within 300 mi +25 percent), independent lane outages (2 percent per out-arc), lognormal demand shocks (global sd 0.10, commodity 0.08, node 0.10). Two fixed designs are evaluated on the same draws (common random numbers): the legacy footprint (the six largest-city sites) and the optimized open set. Flows are re-optimised by an LP with unmet-demand slack; capacity and supply are firm. Cost excludes the penalty; adjusted cost adds 1500 USD per unserved ton (a SYNTHETIC lost-sales charge). Metrics: mean, sd, quantiles, CVaR95, service level, share of draws with full service, mean regret against the undisrupted case, a histogram, and a single-site-loss ranking for the optimized design.
The Monte Carlo is not run in the browser (not part of parity); the site shows the precomputed result tagged SYNTHETIC/SIMULATED.

## Results on this synthetic instance (all SYNTHETIC)
| | Legacy (6 sites) | Optimized (8 sites) |
|---|---|---|
| Undisrupted annual cost | 588.0 M USD | 563.6 M USD (4.15 percent lower) |
| Disrupted mean adjusted cost | 794 M | 669 M |
| Disrupted CVaR95 adjusted cost | 1,731 M | 1,361 M |
| Mean service level | 0.949 | 0.981 |
| Share of draws with full service | 35 percent | 64 percent |
The optimized set is not designed for disruption; it is more robust here mostly because it opens two more sites. S00 (New York) is the most critical single site: losing it adds 185 M USD of adjusted cost.
