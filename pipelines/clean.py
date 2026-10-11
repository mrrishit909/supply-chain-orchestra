"""Join Census Gazetteer 2026 places to PEP sub-est2025 (SUMLEV 162) on GEOID with every drop counted."""
from __future__ import annotations

import polars as pl

from pipelines.common import RAW

EXCLUDED_STATES = {"AK": "Alaska", "HI": "Hawaii", "PR": "Puerto Rico"}  # contiguous US only: great-circle is a poor proxy across water


def load_places() -> tuple[pl.DataFrame, dict]:
    g = pl.read_csv(RAW / "2026_Gaz_place_national.txt", separator="|", infer_schema_length=0).rename(lambda c: c.strip())
    p = pl.read_csv(RAW / "sub-est2025.csv", infer_schema_length=0, encoding="latin1")
    led: dict = {"gazetteer_rows": g.height, "pep_rows_all_sumlev": p.height}
    p = p.filter(pl.col("SUMLEV") == "162")
    led["pep_sumlev162_rows"] = p.height
    p = p.with_columns((pl.col("STATE") + pl.col("PLACE")).alias("GEOID"))
    led["pep_geoid_unique"] = p["GEOID"].n_unique()
    j = p.join(g, on="GEOID", how="full", coalesce=True, suffix="_gaz")
    led["pep_unmatched_to_gazetteer"] = j.filter(pl.col("USPS").is_null()).height
    led["gazetteer_unmatched_to_pep"] = j.filter(pl.col("SUMLEV").is_null()).height
    led["gazetteer_unmatched_by_funcstat"] = {k: v for k, v in j.filter(pl.col("SUMLEV").is_null())["FUNCSTAT_gaz"].value_counts().sort("FUNCSTAT_gaz").iter_rows()}
    j = j.filter(pl.col("USPS").is_not_null() & pl.col("SUMLEV").is_not_null())
    led["joined"] = j.height
    led["dropped_not_active_either_file"] = j.filter((pl.col("FUNCSTAT") != "A") | (pl.col("FUNCSTAT_gaz") != "A")).height
    j = j.filter((pl.col("FUNCSTAT") == "A") & (pl.col("FUNCSTAT_gaz") == "A"))
    led["active_joined"] = j.height
    led["dropped_non_contiguous"] = j.filter(pl.col("USPS").is_in(list(EXCLUDED_STATES))).height
    j = j.filter(~pl.col("USPS").is_in(list(EXCLUDED_STATES)))
    j = j.with_columns(pl.col("POPESTIMATE2025").cast(pl.Int64), pl.col("INTPTLAT").cast(pl.Float64), pl.col("INTPTLONG").cast(pl.Float64))
    led["dropped_zero_pop"] = j.filter(pl.col("POPESTIMATE2025") <= 0).height
    j = j.filter(pl.col("POPESTIMATE2025") > 0)
    led["usable_places"] = j.height
    led["usable_population_sum"] = int(j["POPESTIMATE2025"].sum())
    out = j.select(pl.col("GEOID").alias("geoid"), pl.col("NAME").alias("name"), pl.col("USPS").alias("state"), pl.col("POPESTIMATE2025").alias("pop2025"),
                   pl.col("INTPTLAT").alias("lat"), pl.col("INTPTLONG").alias("lon")).sort(["pop2025", "geoid"], descending=[True, False])
    return out, led
