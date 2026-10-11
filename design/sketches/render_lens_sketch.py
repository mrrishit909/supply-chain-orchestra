"""P07 design sketches for "The Lens", rendered from the real artifacts in site/public/data.

Writes SVGs next to this file; render_sheet.mjs rasterizes them, compose_sheet.py builds the
distinctness sheet. Run from the project root:
    python3 design/sketches/render_lens_sketch.py
Pure stdlib. Projection: conic equal-area (Albers), parallels 29.5/45.5, origin 37.5N 96W
(the constants proposed in DR-5). Lanes are great-circle paths sampled at 24 points; road
distance in the data is great-circle x 1.2, never a road.
"""
import json
import math
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE / "../../site/public/data"
net = json.loads((DATA / "network.json").read_text())
sol = {s["id"]: s for s in json.loads((DATA / "solutions.json").read_text())["scenarios"]}
FONTS = HERE / "../../../03-climate-signal-observatory/site/node_modules/@fontsource-variable"

ORANGE, VIOLET, WHITE = "#FF4C25", "#B48CFF", "#FFFFFF"
TON_PX = 1 / 9000  # D ribbon width: 1 px per 9,000 t/yr (outbound and inbound share one scale)

# ---- projection -------------------------------------------------------------------------
P1, P2, P0, L0 = map(math.radians, (29.5, 45.5, 37.5, -96.0))
N_ = (math.sin(P1) + math.sin(P2)) / 2
C_ = math.cos(P1) ** 2 + 2 * N_ * math.sin(P1)
R0 = math.sqrt(C_ - 2 * N_ * math.sin(P0)) / N_


def albers(lat, lon):
    rho = math.sqrt(C_ - 2 * N_ * math.sin(math.radians(lat))) / N_
    th = N_ * (math.radians(lon) - L0)
    return rho * math.sin(th), -(R0 - rho * math.cos(th))  # y down


def gc(a, b, n=24):
    (la1, lo1), (la2, lo2) = [(math.radians(p[0]), math.radians(p[1])) for p in (a, b)]
    v1 = (math.cos(la1) * math.cos(lo1), math.cos(la1) * math.sin(lo1), math.sin(la1))
    v2 = (math.cos(la2) * math.cos(lo2), math.cos(la2) * math.sin(lo2), math.sin(la2))
    om = math.acos(max(-1, min(1, sum(i * j for i, j in zip(v1, v2)))))
    if om < 1e-9:
        return [a, b]
    out = []
    for i in range(n + 1):
        t = i / n
        s1, s2 = math.sin((1 - t) * om) / math.sin(om), math.sin(t * om) / math.sin(om)
        x, y, z = (s1 * p + s2 * q for p, q in zip(v1, v2))
        out.append((math.degrees(math.atan2(z, math.hypot(x, y))), math.degrees(math.atan2(y, x))))
    return out


nodes, sites, plants = net["demand_nodes"], net["sites"], net["plants"]
allpts = [albers(p["lat"], p["lon"]) for p in nodes + sites + plants]
X0, X1 = min(p[0] for p in allpts), max(p[0] for p in allpts)
Y0, Y1 = min(p[1] for p in allpts), max(p[1] for p in allpts)


def camera(cx, cy, width):
    """Map the network bbox centre to (cx, cy) with the bbox width = width px."""
    k = width / (X1 - X0)
    mx, my = (X0 + X1) / 2, (Y0 + Y1) / 2
    return lambda lat, lon: ((albers(lat, lon)[0] - mx) * k + cx, (albers(lat, lon)[1] - my) * k + cy)


def lanes(scn):
    """One ribbon per lane (commodities summed): routes drawn == solution flows."""
    out = {}
    for a, k, t in scn["routes_out"]:
        f, d = net["out_arcs"]["site"][a], net["out_arcs"]["demand"][a]
        out.setdefault(("o", f, d), 0.0)
        out[("o", f, d)] += t
    for p, f, k, t in scn["routes_in"]:
        out.setdefault(("i", p, f), 0.0)
        out[("i", p, f)] += t
    return out


def ends(key):
    kind, a, b = key
    if kind == "o":
        s, d = sites[a], nodes[b]
    else:
        s, d = plants[a], sites[b]
    return (s["lat"], s["lon"]), (d["lat"], d["lon"])


def path_d(pts):
    return "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)


def svg_head(w, h):
    nr = (FONTS / "newsreader/files/newsreader-latin-wght-normal.woff2").resolve()
    jb = (FONTS / "jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2").resolve()
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
            f'<style>@font-face{{font-family:NR;src:url("file://{nr}")}}@font-face{{font-family:JB;src:url("file://{jb}")}}'
            '.s{font-family:NR,Georgia,serif;fill:#fff}.m{font-family:JB,monospace;fill:#fff;letter-spacing:.04em}</style>'
            f'<rect width="{w}" height="{h}" fill="#000"/>')


def network_layer(proj, scn, lit, ton_px, ref=None):
    """lit=True: inside the lens. lit=False: the dim reference outside the lens."""
    g = []
    a_op = 0.30 if lit else 0.10
    for a in range(len(net["out_arcs"]["site"])):  # all 500 candidate arcs: the solver's options
        s, d = sites[net["out_arcs"]["site"][a]], nodes[net["out_arcs"]["demand"][a]]
        g.append(f'<path d="{path_d([proj(*q) for q in gc((s["lat"], s["lon"]), (d["lat"], d["lon"]), 8)])}" '
                 f'stroke="{VIOLET}" stroke-opacity="{a_op}" stroke-width="0.6" fill="none"/>')
    for i, (key, t) in enumerate(sorted(lanes(scn).items(), key=lambda kv: kv[1])):
        a, b = ends(key)
        pts = [proj(*q) for q in gc(a, b)]
        if math.dist(pts[0], pts[-1]) < 1:
            continue  # a site in the same place as its city: delivered at the door (vessel fill shows it)
        w = max(0.6, t * ton_px)
        op = (0.95 if lit else 0.16) * min(1.0, t * ton_px / 0.6)  # area-true below the 0.6px floor
        gid = f"rg{'L' if lit else 'D'}{i}{id(scn) % 997}"
        g.append(f'<defs><linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="{pts[0][0]:.1f}" y1="{pts[0][1]:.1f}" '
                 f'x2="{pts[-1][0]:.1f}" y2="{pts[-1][1]:.1f}"><stop offset="0" stop-color="#FF7A1F" stop-opacity=".45"/>'
                 f'<stop offset="1" stop-color="{ORANGE if lit else "#FF4C25"}"/></linearGradient></defs>'
                 f'<path d="{path_d(pts)}" stroke="url(#{gid})" stroke-opacity="{op:.3f}" stroke-width="{w:.2f}" '
                 'fill="none" stroke-linecap="butt"/>')
    use = {u["site"]: u for u in scn["site_use"]}
    for f, s in enumerate(sites):  # vessel squares: outer area = capacity, inner = throughput
        x, y = proj(s["lat"], s["lon"])
        side = math.sqrt(s["capacity_units"]) * (0.020 if lit else 0.016)
        o = 1.0 if lit else 0.35
        g.append(f'<rect x="{x - side / 2:.1f}" y="{y - side / 2:.1f}" width="{side:.1f}" height="{side:.1f}" '
                 f'fill="#000" stroke="{VIOLET}" stroke-opacity="{o}" stroke-width="1"/>')
        if f in use:
            fs = side * math.sqrt(use[f]["utilization"])
            g.append(f'<rect x="{x - fs / 2:.1f}" y="{y - fs / 2:.1f}" width="{fs:.1f}" height="{fs:.1f}" '
                     f'fill="{ORANGE}" fill-opacity="{o}"/>')
    for p in plants:
        x, y = proj(p["lat"], p["lon"])
        r = 9 if lit else 7
        g.append(f'<rect x="{x - r:.1f}" y="{y - r:.1f}" width="{2 * r}" height="{2 * r}" transform="rotate(45 {x:.1f} {y:.1f})" '
                 f'fill="#000" stroke="{VIOLET}" stroke-opacity="{1 if lit else .35}" stroke-width="1.2"/>')
    for d in nodes:
        x, y = proj(d["lat"], d["lon"])
        r = 0.9 + 3.2 * math.sqrt(d["pop2025"] / 8.6e6)
        g.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="{WHITE}" fill-opacity="{0.95 if lit else 0.35}"/>')
    return "".join(g)


def lens(proj, scn_in, scn_out, c, R, w, h, ton_px, extra="", feather=0.06, out_proj=None, out_ton_px=None):
    cx, cy = c
    return (f'<defs><clipPath id="lc"><circle cx="{cx}" cy="{cy}" r="{R}"/></clipPath>'
            f'<radialGradient id="lf" gradientUnits="userSpaceOnUse" cx="{cx}" cy="{cy}" r="{R}">'
            f'<stop offset="{1 - feather}" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>'
            f'<mask id="lm"><rect width="{w}" height="{h}" fill="url(#lf)"/></mask>'
            '<filter id="bl" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7"/></filter></defs>'
            f'<g>{network_layer(out_proj or proj, scn_out, False, out_ton_px or ton_px)}</g>'
            f'<circle cx="{cx}" cy="{cy}" r="{R}" fill="#000"/>'  # the lens replaces, never overlays, the outside
            f'<g mask="url(#lm)" clip-path="url(#lc)"><circle cx="{cx}" cy="{cy}" r="{R}" fill="#05030A"/>'
            f'<g filter="url(#bl)" opacity=".55">{network_layer(proj, scn_in, True, ton_px)}</g>'
            f'{network_layer(proj, scn_in, True, ton_px)}{extra}</g>')


def chrome_d(w, h, title_lines, size, x, y0, chip, right):
    t = "".join(f'<text class="s" x="{x}" y="{y0 + i * size * 1.02:.0f}" font-size="{size}">{ln}</text>'
                for i, ln in enumerate(title_lines))
    return (t + f'<text class="m" x="{x}" y="34" font-size="13">SUPPLY CHAIN ORCHESTRA</text>'
            f'<text class="m" x="{w - 32}" y="34" font-size="13" text-anchor="end">{right[0]}</text>'
            f'<text class="m" x="{w - 32}" y="54" font-size="13" text-anchor="end" fill-opacity=".5">{right[1]}</text>'
            f'<rect x="{x}" y="{h - 118}" width="{len(chip) * 7.9 + 16:.0f}" height="26" fill="#ffffff1a"/>'
            f'<text class="m" x="{x + 8}" y="{h - 100}" font-size="13">{chip}</text>')


def scrim(x0, x1, y0, y1, horizontal=True):
    gid = f"sc{x0}{y0}"
    grad = ('x1="0" y1="0" x2="1" y2="0"' if horizontal else 'x1="0" y1="0" x2="0" y2="1"')
    stops = ('<stop offset="0" stop-color="#000" stop-opacity=".92"/><stop offset=".6" stop-color="#000" stop-opacity=".7"/>'
             '<stop offset="1" stop-color="#000" stop-opacity="0"/>') if horizontal else (
             '<stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset=".25" stop-color="#000" stop-opacity=".9"/>'
             '<stop offset=".8" stop-color="#000" stop-opacity=".9"/><stop offset="1" stop-color="#000" stop-opacity="0"/>')
    return (f'<defs><linearGradient id="{gid}" {grad}>{stops}</linearGradient></defs>'
            f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" fill="url(#{gid})"/>')


def write(name, body):
    (HERE / name).write_text(body + "</svg>")
    print("wrote", name)


opt, leg = sol["optimized"], sol["legacy"]
RIGHT = ("OPTIMAL · 8 OF 14 SITES OPEN · 563.6 M USD / YR",
         "100 REAL PLACES · SYNTHETIC NETWORK · GREAT-CIRCLE x 1.2, NOT ROADS")
CHIP = "SIMULATED · SYNTHETIC NETWORK · OBSERVED PLACES"

# G0 D: the lens is giant (diameter 1.38 x frame height), centre right, cropped top, bottom and right.
W, H = 1440, 900
proj = camera(820, 430, 1240)
body = svg_head(W, H) + lens(proj, opt, opt, (930, 455), 620, W, H, TON_PX)
body += scrim(0, 760, 560, 900) + chrome_d(W, H, ["Every product", "has a journey."], 92, 96, 660, CHIP, RIGHT)
write("lens-s00-d.svg", body)

# S00 t = 0 D: same giant lens, magnification x24 on the hero package (Fort Worth plant to Oklahoma City site).
P0, S10 = plants[0], sites[10]
hx, hy = proj(P0["lat"], P0["lon"])
sx, sy = proj(S10["lat"], S10["lon"])
mx, my = hx + 0.55 * (sx - hx), hy + 0.55 * (sy - hy)
M = 24.0


def proj_mag(lat, lon):
    x, y = proj(lat, lon)
    return (930 + (x - mx) * M, 455 + (y - my) * M)


pkg = '<rect x="906" y="431" width="48" height="48" fill="#FF4C25"/><rect x="906" y="431" width="48" height="48" fill="none" stroke="#FFB26B" stroke-opacity=".6"/>'
# the outside reference stays at x1; only the lens interior is magnified
body = svg_head(W, H) + lens(proj_mag, opt, opt, (930, 455), 620, W, H, TON_PX * M / 6, extra=pkg, out_proj=proj, out_ton_px=TON_PX)
body += '<text class="m" x="1012" y="452" font-size="13">1 PACKAGE · FORT WORTH TO OKLAHOMA CITY</text>'
body += '<text class="m" x="1012" y="472" font-size="13" fill-opacity=".5">LENS x24 · DISTANCES INSIDE THE LENS ARE MAGNIFIED</text>'
body += scrim(0, 760, 560, 900) + chrome_d(W, H, ["Every product", "has a journey."], 92, 96, 660, CHIP, RIGHT)
write("lens-s00-t0-d.svg", body)

# S04 comparator D: outside = legacy footprint (dim), inside = optimized; lens on the change.
proj4 = camera(860, 440, 1180)
body = svg_head(W, H) + lens(proj4, opt, leg, (980, 470), 560, W, H, TON_PX)
body += chrome_d(W, H, ["Same cities.", "Two footprints."], 64, 96, 150,
                 "SIMULATED · INSIDE: OPTIMIZED (8 SITES) · OUTSIDE: LEGACY (6)",
                 ("LEGACY 588.0 M → OPTIMIZED 563.6 M USD / YR", "SAVING 4.15% · SYNTHETIC COSTS"))
write("lens-s04-d.svg", body)

# G0 M 390x844: lens on top, the bottom arc visible above the MENU pill.
Wm, Hm = 390, 844
projm = camera(190, 330, 560)
body = svg_head(Wm, Hm) + lens(projm, opt, opt, (215, 330), 410, Wm, Hm, TON_PX * 0.45)
body += scrim(0, Wm, 520, 760, horizontal=False)
body += ''.join(f'<text class="s" x="16" y="{588 + i * 42}" font-size="40">{t}</text>' for i, t in enumerate(["Every product", "has a journey."]))
body += '<text class="m" x="16" y="30" font-size="11">SUPPLY CHAIN ORCHESTRA</text>'
body += '<text class="m" x="374" y="30" font-size="11" text-anchor="end">OPTIMAL · 8 OF 14</text>'
body += '<rect x="16" y="686" width="300" height="22" fill="#ffffff1a"/><text class="m" x="24" y="701" font-size="11">SIMULATED · SYNTHETIC NETWORK</text>'
body += '<rect x="115" y="790" width="160" height="32" fill="#fff"/><text class="m" x="195" y="811" font-size="12" text-anchor="middle" fill="#000" style="fill:#000">= MENU · JOURNEY</text>'
write("lens-s00-m.svg", body)
