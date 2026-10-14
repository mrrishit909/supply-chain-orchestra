# Data sources: Supply Chain Orchestra

Verified 2026-10-10/11 from this machine (curl, downloads into `data/raw`, SHA-256 in `data/manifests/census_extract.json`). Raw files are gitignored and
re-created by `uv run python -m pipelines.ingest` (or `pipelines.run_all`).

| Id | Source | URL | Vintage | Bytes | SHA-256 (first 12) | Use | Tag |
|---|---|---|---|---|---|---|---|
| gazetteer | U.S. Census Bureau, Gazetteer Files 2026, places | https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2026_Gazetteer/2026_Gaz_place_national.zip | 2026 (8 Sep 2026) | 1,214,650 | af678e2d9908 | internal-point latitude/longitude, GEOID, FUNCSTAT | OBSERVED |
| pep | U.S. Census Bureau, Population Estimates Program, sub-est2025 (cities and towns) | https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025.csv | Vintage 2025 (14 May 2026) | 7,464,556 | e3508f520146 | July 1 2025 population estimate, SUMLEV 162 | OBSERVED |

## Join
`GEOID` (7 digits) = PEP `STATE` + `PLACE`. Both files are filtered to active places (FUNCSTAT = A in both), Alaska, Hawaii and Puerto Rico are excluded
(great-circle distance is a poor proxy across water and the network is a contiguous-US ground network), zero-population rows dropped. Every drop is counted
in `quality.json` (`join_ledger`). The PEP place file has no census-designated places (CDPs) in most states, so about 12,800 Gazetteer rows (mostly FUNCSTAT S) have
no population match; that is a property of the sources, not a defect, and is reported, not hidden.

## Caveats recorded
- **Internal point.** INTPTLAT/INTPTLONG is a point inside the place boundary chosen by the Census Bureau. It is not a city hall, a population centroid, a
  warehouse or a port. Distances between places are therefore approximate to within the size of a city.
- **Population estimates** of small places carry wide uncertainty; the 100 largest places used here are large enough that this does not matter for the demand shape.
- **Attribution.** "Source: U.S. Census Bureau, Population Estimates Program (PEP) 2025 and Gazetteer Files 2026. This product uses Census Bureau data but is not
  endorsed or certified by the Census Bureau." The wording follows the Census Bureau Data API terms (https://www.census.gov/data/developers/about/terms-of-service.html):
  do not falsely represent the content as the Bureau's. These two files are downloaded files, not API calls; the API terms are used as the conservative attribution
  standard. The public-domain statement on census.gov/about/policies/copyright.html returned HTTP 404 from this machine, so this project does **not** claim public
  domain, it only attributes and does not imply endorsement.
- **Derived aggregates.** The synthetic network does not identify any individual or entity.

## Freight cost (no source)
No public freight-rate series with a verifiable licence was found (P07 research, `~/data-frontier/research/P07-sources.md`). Cost per ton-mile, handling cost, fixed
site cost and land index are **SYNTHETIC parameters** in `analytics/network.py` and listed in `network.json` (`commodities`, `constants`). They are not calibrated to
any observed rate and results must not be read as freight prices.

## FAF5 (Freight Analysis Framework): skipped
Recorded failure: the BTS pages (`bts.gov/faf`, `bts.gov/faf/faf5`, the FAF5 User Guide PDF) returned HTTP 403 to curl and WebFetch on 2026-10-10, so the licence text
could not be read directly. The ORNL landing page loads but its download listing was empty and the data zip name was unconfirmed. FAF5 also has no rate field. It is
therefore **not used**; no FAF5 number appears in any artifact.

## Not used
Open-Meteo, commercial geocoders, any road-routing service, Census API (no key needed or used).

## Frontend assets (P07-FE-001)
- **Fonts.** Newsreader (opsz axis kept, wght 400) and JetBrains Mono (wght 400), SIL OFL 1.1, from `@fontsource-variable`, subset to Latin plus the glyphs the page renders (`site/scripts/subset-fonts.py`, `src/data/glyphs.test.ts` scans every source string against the subset). 39.8 KB total; only the display face is preloaded.
- **highs@1.15.3** (HiGHS-wasm, MIT) from npm, loaded in a module worker only from S03b or THE DESK.
- **No external request** at runtime (tested): no CDN, no tiles, no analytics. The favicon and every figure are original.
