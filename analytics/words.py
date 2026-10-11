"""Relaxation explanation sentences: fixed templates per constraint family, filled from the relaxation report (DR-8).

The client renders the same sentences from the same `fields`: `template.format(**fields)` with the formatting rules in `RULES`.
"""
from __future__ import annotations

import math

TEMPLATES = {
    "supply": "THE PLANTS WOULD HAVE TO MAKE {total} T MORE THAN THEY CAN ({pct}% OF DEMAND): {list}.",
    "capacity": "{count} {sites_word} WOULD HAVE TO HANDLE {units} UNITS MORE THAN THEY CAN; WORST: {worst} BY {worst_pct}%.",
    "unmet": "{tons} T OF DEMAND WOULD GO UNSERVED AT {count} {cities_word}; WORST: {worst} {worst_tons} T.",
    "open_sites": "{n} {sites_word} MORE THAN THE LIMIT OF {limit} WOULD HAVE TO OPEN.",
}
ORDER = ["supply", "capacity", "unmet", "open_sites"]
RULES = ["Integers are rounded half up (floor(x + 0.5)) and written with comma thousands separators.",
         "Names are the network short_name in upper case; plants in the list are ordered by tons descending, then plant index; the worst site/city is the largest percentage/tons, then the lowest index.",
         "pct = total supply overshoot / baseline demand (demand_scale 1.0) x 100, integer. worst_pct is the site's overshoot as a percentage of its (scaled) capacity, integer.",
         "sites_word is SITE when the count is 1, else SITES; cities_word is CITY when 1, else CITIES.",
         "Families with nothing to report are skipped; sentences follow the order supply, capacity, unmet, open_sites."]


def n0(x: float) -> str:
    return f"{math.floor(x + 0.5):,}"


def families(rel: dict, net: dict, base_demand_tons: float, limit: int) -> list[tuple[str, dict]]:
    out = []
    nm = lambda g: g["short_name"].upper()
    sup = {}
    for r in rel["supply_overshoot"]:
        sup[r["plant"]] = sup.get(r["plant"], 0.0) + r["tons"]
    sup = {p: t for p, t in sup.items() if math.floor(t + 0.5) > 0}
    if sup:
        order = sorted(sup, key=lambda p: (-sup[p], p))
        out.append(("supply", {"total": n0(sum(sup.values())), "pct": n0(100 * sum(sup.values()) / base_demand_tons),
                               "list": ", ".join(f"{nm(net['plants'][p])} {n0(sup[p])} T" for p in order)}))
    cap = rel["capacity_overshoot"]
    if cap:
        w = sorted(cap, key=lambda r: (-r["pct_of_capacity"], r["site"]))[0]
        out.append(("capacity", {"count": str(len(cap)), "sites_word": "SITE" if len(cap) == 1 else "SITES", "units": n0(sum(r["units"] for r in cap)),
                                 "worst": nm(net["sites"][w["site"]]), "worst_pct": n0(w["pct_of_capacity"])}))
    um = {}
    for r in rel["unmet_demand"]:
        um[r["demand"]] = um.get(r["demand"], 0.0) + r["tons"]
    if um:
        w = sorted(um, key=lambda d: (-um[d], d))[0]
        out.append(("unmet", {"tons": n0(sum(um.values())), "count": str(len(um)), "cities_word": "CITY" if len(um) == 1 else "CITIES", "worst": nm(net["demand_nodes"][w]), "worst_tons": n0(um[w])}))
    if rel["open_sites_excess"] > 0.0005:
        n = math.floor(rel["open_sites_excess"] + 0.5)
        out.append(("open_sites", {"n": str(n), "sites_word": "SITE" if n == 1 else "SITES", "limit": str(limit)}))
    return out


def render(family: str, fields: dict) -> str:
    return TEMPLATES[family].format(**fields)


def words(rel: dict, net: dict, base_demand_tons: float, limit: int) -> list[str]:
    return [render(f, v) for f, v in families(rel, net, base_demand_tons, limit)]
