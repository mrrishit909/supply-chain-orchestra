"""P07 design sketches for "The Cross-Dock", rendered from the real artifacts in site/public/data.

The disc: area = 2 x tons through the network (top half inbound, bottom half outbound; equal by
flow conservation). One vertical column per open site, west to east; a column's half-area is the
site's throughput. Top of a column: one bar per plant. Bottom: one bar per city served. The black
line through the middle is the dock. Constant tons per px^2 across scenarios, so R grows with sqrt(tons).

Run from the project root:  python3 design/sketches/render_dock_sketch.py
then rasterize:  NODE_PATH=../03-climate-signal-observatory/site/node_modules node design/sketches/render_sheet.mjs
"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from render_lens_sketch import (chrome_d, net, scrim, sol, svg_head)  # noqa: E402  (importing also re-renders the lens sketches)

nodes, sites, plants = net["demand_nodes"], net["sites"], net["plants"]
COL_GAP, BAR_GAP, DOCK = 5.0, 1.2, 9.0  # px of ink between columns, bars, and the dock band height


def half_area_left(x, R):
    """Area of the upper half-disc (radius R, centre 0) left of x."""
    x = max(-R, min(R, x))
    return 0.5 * (x * math.sqrt(R * R - x * x) + R * R * math.asin(x / R)) + R * R * math.pi / 4


def x_for_area(a, R):
    lo, hi = -R, R
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if half_area_left(mid, R) < a else (lo, mid)
    return (lo + hi) / 2


def flows(scn):
    """Per open site: inbound tons by plant and outbound tons by city (commodities summed)."""
    inb, out = {}, {}
    for p, f, k, t in scn["routes_in"]:
        inb.setdefault(f, {}).setdefault((p, k), 0.0)
        inb[f][(p, k)] += t
    for a, k, t in scn["routes_out"]:
        f, d = net["out_arcs"]["site"][a], net["out_arcs"]["demand"][a]
        out.setdefault(f, {}).setdefault((d, k), 0.0)
        out[f][(d, k)] += t
    return inb, out


def bar_path(cx, cy, R, xa, xb, top, inset):
    xa, xb = xa + inset, xb - inset
    if xb <= xa:
        return None
    n = max(2, int((xb - xa) / 2))
    sgn = -1 if top else 1
    y_dock = cy + sgn * DOCK / 2
    pts = [(xa, y_dock)]
    for i in range(n + 1):
        x = xa + (xb - xa) * i / n
        h = math.sqrt(max(0.0, R * R - (x - cx) ** 2))
        pts.append((x, cy + sgn * max(DOCK / 2, h)))
    pts.append((xb, y_dock))
    return "M" + " L".join(f"{x:.2f},{y:.2f}" for x, y in pts) + " Z"


def dock(scn, cx, cy, tons_per_px2, palette="orange", hero=None, unmet=None):
    inb, out = flows(scn)
    open_f = sorted(out, key=lambda f: sites[f]["lon"])
    total = sum(sum(v.values()) for v in out.values()) + (sum(unmet.values()) if unmet else 0)
    R = math.sqrt(2 * total / tons_per_px2 / math.pi)
    half = math.pi * R * R / 2
    top_c, bot_c = ("#FF7A1F", "#FFC48F") if palette == "orange" else ("#690DE2", "#B48CFF")
    cols_k = ("#FF4C25", "#FFB26B", "#A8301A") if palette == "orange" else ("#9A6BFF", "#D2B8FF", "#690DE2")
    kd = "".join(f'<linearGradient id="t{k}" gradientUnits="userSpaceOnUse" x1="0" y1="{cy - R}" x2="0" y2="{cy}">'
                 f'<stop offset="0" stop-color="{c}" stop-opacity=".3"/><stop offset=".55" stop-color="{c}" stop-opacity=".5"/><stop offset="1" stop-color="{c}"/></linearGradient>'
                 f'<linearGradient id="b{k}" gradientUnits="userSpaceOnUse" x1="0" y1="{cy}" x2="0" y2="{cy + R}">'
                 f'<stop offset="0" stop-color="{c}"/><stop offset=".45" stop-color="{c}" stop-opacity=".5"/><stop offset="1" stop-color="{c}" stop-opacity=".3"/></linearGradient>'
                 for k, c in enumerate(cols_k))
    defs = (f'<defs>{kd}<linearGradient id="gt" gradientUnits="userSpaceOnUse" x1="0" y1="{cy - R}" x2="0" y2="{cy}">'
            f'<stop offset="0" stop-color="{top_c}" stop-opacity=".55"/><stop offset="1" stop-color="{bot_c}"/></linearGradient>'
            f'<linearGradient id="gb" gradientUnits="userSpaceOnUse" x1="0" y1="{cy}" x2="0" y2="{cy + R}">'
            f'<stop offset="0" stop-color="{bot_c}"/><stop offset="1" stop-color="#FF4C25" stop-opacity=".8"/></linearGradient>'
            '<pattern id="hz" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
            '<line x1="0" y1="0" x2="0" y2="6" stroke="#FF4C25" stroke-width="1.4"/></pattern></defs>')
    g, labels = [defs], []
    acc = 0.0
    cols = [(f, sum(out[f].values())) for f in open_f] + ([("unmet", sum(unmet.values()))] if unmet else [])
    for f, t_f in cols:
        xa = cx - R + x_for_area(acc / total * half, R) + R
        acc_end = acc + t_f
        xb = cx - R + x_for_area(acc_end / total * half, R) + R
        # top: plants (west to east); bottom: cities (west to east)
        for top, parts in ((True, inb.get(f, {}) if f != "unmet" else {}), (False, out.get(f, unmet if f == "unmet" else {}))):
            items = sorted(parts.items(), key=lambda kv: ((plants if top else nodes)[kv[0][0]]["lon"], kv[0][1]))
            a2 = acc
            for i, (key, t) in enumerate(items):
                x1 = cx - R + x_for_area(a2 / total * half, R) + R
                x2 = cx - R + x_for_area((a2 + t) / total * half, R) + R
                inset = (COL_GAP / 2 if i == 0 else BAR_GAP / 2, COL_GAP / 2 if i == len(items) - 1 else BAR_GAP / 2)
                d = bar_path(cx, cy, R, x1 + inset[0], x2 - inset[1], top, 0)
                if d:
                    if f == "unmet":
                        g.append(f'<path d="{d}" fill="url(#hz)" stroke="#FF4C25" stroke-width=".8"/>')
                    else:
                        hot = hero and hero[0] == f and key == ((hero[1], 0) if top else (hero[2], 0))
                        g.append(f'<path d="{d}" fill="url(#{"t" if top else "b"}{key[1]})"/>')
                        if hot:
                            g.append(f'<path d="{d}" fill="none" stroke="#fff" stroke-width="2"/>')
                a2 += t
        if f == "unmet":
            g.append(f'<path d="{bar_path(cx, cy, R, xa + COL_GAP / 2, xb - COL_GAP / 2, True, 0)}" fill="none" stroke="#FF4C25" stroke-dasharray="3 3" stroke-width=".8"/>')
        labels.append((f, (xa + xb) / 2, t_f))
        acc = acc_end
    return "".join(g), R, labels


def site_labels(labels, cy, size=11, min_w=40):
    out = []
    for f, x, t in labels:
        if f != "unmet":
            out.append(f'<rect x="{x - 4:.1f}" y="{cy - 4:.1f}" width="8" height="8" fill="#B48CFF"/>')
    for f, x, t in labels:
        name = "UNSERVED" if f == "unmet" else sites[f]["name"].replace(" city", "").upper()
        out.append(f'<text class="m" x="{x:.1f}" y="{cy - 9:.1f}" font-size="{size}" text-anchor="middle" '
                   f'style="paint-order:stroke;stroke:#000;stroke-width:4px">{name}</text>')
    return "".join(out)


opt, leg, storm = sol["optimized"], sol["legacy"], sol["storm_legacy"]
T = opt["total_demand_tons"]
W, H = 1440, 900
RIGHT = ("OPTIMAL · 8 OF 14 SITES OPEN · 563.6 M USD / YR",
         "TOP: PLANTS IN · BOTTOM: CITIES OUT · AREA = TONS / YR")
CHIP = "SIMULATED · SYNTHETIC NETWORK · OBSERVED PLACES"

# hero journey: Fort Worth plant (P0) -> Oklahoma City site (S10, capacity binding) -> its largest city
inb, out = flows(opt)
# DR-4 rule: the largest packaged-goods journey with both legs >= 100 mi (proportional split at the site):
# Fort Worth plant -> Houston site -> San Antonio, 19,857 t/yr
hero_city = 6
HERO = (3, 0, hero_city)

for palette in ("orange", "violet"):
    R_D = 580  # G0 D
    tpp = 2 * T / (math.pi * R_D * R_D)
    body, R, labels = dock(opt, 900, 450, tpp, palette, hero=HERO)
    hx = [x for f, x, t in labels if f == 3][0]
    svg = svg_head(W, H) + body + site_labels(labels, 450)
    svg += f'<rect x="{hx - 9:.1f}" y="441" width="18" height="18" fill="#FF4C25" stroke="#fff" stroke-width="1.5"/>'
    svg += f'<text class="m" x="{hx + 16:.1f}" y="478" font-size="12" style="paint-order:stroke;stroke:#000;stroke-width:4px">1 PACKAGE · FORT WORTH → HOUSTON → SAN ANTONIO</text>'
    svg += scrim(0, 700, 560, 900) + chrome_d(W, H, ["Every product", "has a journey."], 92, 96, 660, CHIP, RIGHT)
    (HERE / f"dock-s00-d{'' if palette == 'orange' else '-violet'}.svg").write_text(svg + "</svg>")

# M G0: R 540 (diameter 1.28 x 844), centre (195, 400); only the middle columns are in frame
Wm, Hm = 390, 844
tpp_m = 2 * T / (math.pi * 510 * 510)
body, R, labels = dock(opt, 195, 270, tpp_m, hero=HERO)
svg = svg_head(Wm, Hm) + body + site_labels(labels, 270, 10)
svg += scrim(0, Wm, 470, 740, horizontal=False)
svg += "".join(f'<text class="s" x="16" y="{575 + i * 42}" font-size="40">{t}</text>' for i, t in enumerate(["Every product", "has a journey."]))
svg += '<text class="m" x="16" y="30" font-size="11">SUPPLY CHAIN ORCHESTRA</text>'
svg += '<text class="m" x="374" y="30" font-size="11" text-anchor="end">OPTIMAL · 8 OF 14</text>'
svg += '<rect x="16" y="666" width="300" height="22" fill="#ffffff1a"/><text class="m" x="24" y="681" font-size="11">SIMULATED · AREA = TONS / YR</text>'
svg += '<rect x="115" y="796" width="160" height="32" fill="#fff"/><text class="m" x="195" y="817" font-size="12" text-anchor="middle" style="fill:#000">= MENU · JOURNEY</text>'
(HERE / "dock-s00-m.svg").write_text(svg + "</svg>")

# S05 D: the Gulf storm on the legacy footprint, relaxed: unserved demand has nothing above it
R_S = 330
tpp_s = 2 * T / (math.pi * R_S * R_S)
unmet = {}
for u in storm["relaxation"]["unmet_demand"]:
    unmet[(u["demand"], u["commodity"])] = u["tons"]
body, R, labels = dock(storm, 1000, 470, tpp_s, unmet=unmet)
svg = svg_head(W, H) + body + site_labels(labels, 470, 10)
svg += chrome_d(W, H, ["Where it breaks,", "it says so."], 64, 96, 170,
                "SIMULATED · RELAXED · STATUS OPTIMAL (ELASTIC)",
                ("GULF STORM ON THE LEGACY FOOTPRINT · HOUSTON CLOSED",
                 storm["relaxation"]["summary"].upper()))
svg += ('<text class="m" x="96" y="330" font-size="15">451,124 T OF DEMAND HAS NO SITE TO COME FROM.</text>'
        '<text class="m" x="96" y="352" font-size="15">15 CITIES · SHOWN HATCHED, WITH NOTHING ABOVE THEM.</text>'
        '<text class="m" x="96" y="374" font-size="15" fill-opacity=".5">FROM THE ELASTIC RELAXATION (UNMET DEMAND 6,000 USD / T)</text>')
(HERE / "dock-s05-d.svg").write_text(svg + "</svg>")
print("wrote dock sketches; hero city:", nodes[hero_city]["name"], "R_storm", round(R))
