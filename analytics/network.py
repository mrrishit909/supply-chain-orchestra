"""SYNTHETIC supply network generator, anchored on real Census places (population and internal-point coordinates are OBSERVED).

Rules (all documented in docs/DATA_CONTRACTS.md; every number below is a SYNTHETIC parameter unless stated):
  demand nodes   the D largest contiguous-US places by PEP 2025 population
  site pool      the top POOL places by population; candidate sites are chosen from it by population-weighted farthest-point selection
  plants         chosen from the top PLANT_POOL places by plain farthest-point selection (first pick seeded)
  site capacity  throughput units/year proportional to sqrt(population) of the host place, scaled so total capacity = CAP_HEADROOM x total weighted demand
  demand         tons/year = population/1000 * per-commodity rate * lognormal(0, 0.12) node noise (seeded), rounded to whole tons
  arcs           each demand node is linked to its R nearest candidate sites; every plant is linked to every site
  distance       great-circle (haversine, R = 3958.8 mi) times a circuity factor of 1.2, rounded to 0.1 mi. No road routing is performed.
"""
from __future__ import annotations

import math

import numpy as np
import polars as pl

from pipelines.common import SEED, r4

D, F, P, K, R = 100, 14, 3, 3, 5
POOL, PLANT_POOL = 60, 30
CIRCUITY = 1.2
EARTH_MI = 3958.8
NOISE_SD = 0.12
CAP_HEADROOM = 2.4   # total site capacity / total weighted demand
SUPPLY_HEADROOM = 1.25
PLANT_SHARES = [0.40, 0.35, 0.25]
FIXED_BASE_USD = 20e6          # per site per year before the land index
COMMODITIES = [
    {"id": "ambient", "label": "Packaged goods", "tons_per_1000_pop": 14.0, "rate_in_usd_ton_mi": 0.12, "rate_out_usd_ton_mi": 0.35, "handling_usd_ton": 9.0, "capacity_units_per_ton": 1.0},
    {"id": "cold", "label": "Cold chain", "tons_per_1000_pop": 4.0, "rate_in_usd_ton_mi": 0.20, "rate_out_usd_ton_mi": 0.60, "handling_usd_ton": 22.0, "capacity_units_per_ton": 1.6},
    {"id": "bulk", "label": "Bulky goods", "tons_per_1000_pop": 22.0, "rate_in_usd_ton_mi": 0.09, "rate_out_usd_ton_mi": 0.25, "handling_usd_ton": 14.0, "capacity_units_per_ton": 0.8},
]


def haversine_mi(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lon2 - lon1) / 2) ** 2
    return 2 * EARTH_MI * np.arcsin(np.sqrt(a))


def road_mi(lat1, lon1, lat2, lon2) -> float:
    return math.floor(float(haversine_mi(lat1, lon1, lat2, lon2)) * CIRCUITY * 10 + 0.5) / 10


def _farthest(pool: list[dict], n: int, first: int, weight_pop: bool) -> list[int]:
    chosen = [first]
    while len(chosen) < n:
        best, bi = -1.0, -1
        for i, c in enumerate(pool):
            if i in chosen:
                continue
            dm = min(road_mi(c["lat"], c["lon"], pool[j]["lat"], pool[j]["lon"]) for j in chosen)
            s = dm * (math.sqrt(c["pop2025"]) if weight_pop else 1.0)
            if s > best + 1e-9:
                best, bi = s, i
        chosen.append(bi)
    return chosen


def build_network(places: pl.DataFrame, seed: int = SEED) -> dict:
    rng = np.random.default_rng(seed)
    rows = places.head(max(D, POOL)).to_dicts()
    demand = rows[:D]
    pool = rows[:POOL]
    first_site = int(rng.integers(0, 5))
    site_idx = _farthest(pool, F, first_site, True)
    plant_pool = rows[:PLANT_POOL]
    first_plant = int(rng.integers(5, 15))
    plant_idx = _farthest(plant_pool, P, first_plant, False)

    tons = np.zeros((D, K))
    for k, c in enumerate(COMMODITIES):
        noise = rng.lognormal(0.0, NOISE_SD, D)
        tons[:, k] = [round(r["pop2025"] / 1000.0 * c["tons_per_1000_pop"] * float(noise[i])) for i, r in enumerate(demand)]
    w = [c["capacity_units_per_ton"] for c in COMMODITIES]
    total_units = float(sum(tons[:, k].sum() * w[k] for k in range(K)))

    sites_raw = sorted([pool[i] for i in site_idx], key=lambda r: (-r["pop2025"], r["geoid"]))
    pops = np.array([s["pop2025"] for s in sites_raw], float)
    lo, hi = math.log(pops.min()), math.log(pops.max())
    cap_units = CAP_HEADROOM * total_units * np.sqrt(pops) / np.sqrt(pops).sum()
    land = [round(0.8 + 0.8 * (math.log(p) - lo) / (hi - lo) + float(rng.normal(0, 0.06)), 3) for p in pops]
    sites = [{"id": f"S{f:02d}", "geoid": s["geoid"], "name": s["name"], "state": s["state"], "lat": s["lat"], "lon": s["lon"], "pop2025": s["pop2025"],
              "land_index": land[f], "fixed_cost_usd_yr": r4(FIXED_BASE_USD * land[f]), "capacity_units": round(float(cap_units[f]))} for f, s in enumerate(sites_raw)]

    plants_raw = sorted([plant_pool[i] for i in plant_idx], key=lambda r: (-r["pop2025"], r["geoid"]))
    plants = []
    for p, pr in enumerate(plants_raw):
        sup = [round(float(tons[:, k].sum()) * PLANT_SHARES[p] * SUPPLY_HEADROOM) for k in range(K)]
        plants.append({"id": f"P{p}", "geoid": pr["geoid"], "name": pr["name"], "state": pr["state"], "lat": pr["lat"], "lon": pr["lon"], "pop2025": pr["pop2025"], "supply_tons": sup})

    dem_nodes = [{"id": f"D{d:03d}", "geoid": r["geoid"], "name": r["name"], "state": r["state"], "lat": r["lat"], "lon": r["lon"], "pop2025": r["pop2025"],
                  "demand_tons": [int(v) for v in tons[d]]} for d, r in enumerate(demand)]

    out_site, out_dem, out_mi = [], [], []
    for d, dn in enumerate(dem_nodes):
        ds = sorted(((road_mi(dn["lat"], dn["lon"], s["lat"], s["lon"]), f) for f, s in enumerate(sites)))[:R]
        for dist, f in ds:
            out_site.append(f); out_dem.append(d); out_mi.append(dist)
    in_mi = [[road_mi(p["lat"], p["lon"], s["lat"], s["lon"]) for s in sites] for p in plants]
    return {"commodities": COMMODITIES, "demand_nodes": dem_nodes, "sites": sites, "plants": plants,
            "out_arcs": {"site": out_site, "demand": out_dem, "road_mi": out_mi}, "in_road_mi": in_mi,
            "constants": {"circuity": CIRCUITY, "earth_radius_mi": EARTH_MI, "nearest_sites_per_demand_node": R, "seed": seed, "noise_sd": NOISE_SD,
                          "capacity_headroom": CAP_HEADROOM, "supply_headroom": SUPPLY_HEADROOM, "plant_shares": PLANT_SHARES,
                          "fixed_base_usd_yr": FIXED_BASE_USD, "site_pool": POOL, "plant_pool": PLANT_POOL}}
