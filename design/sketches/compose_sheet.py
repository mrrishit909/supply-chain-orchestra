"""Composes distinctness-sheet.png at contact-sheet scale (ED #17: 240px-tall tiles).
Row 1: P01 real frame | P02 real S00 frame | P03 real S00 end frame | P04 S00 sketch
Row 2: P05 S00 sketch | P07 S00 D (real artifacts) | P07 S05 storm (real artifacts) | P07 discarded Lens
plus the P07 mobile S00 tile on the right.
Run from the project root: uv run --with pillow python design/sketches/compose_sheet.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).parent
PJ = HERE / "../../.."
tiles = [
    (PJ / "01-atlas-human-mobility/artifacts/evidence/stage-b3/1440x900/06-futures-a-busier.png", "P01 REAL FRAME: STROKED RING, NODES, CHORDS"),
    (PJ / "02-market-microstructure-lab/artifacts/evidence/stage-a/1440x900/00-s00-t1250.png", "P02 REAL FRAME: ELECTRIC ORB, S00"),
    (PJ / "03-climate-signal-observatory/artifacts/evidence/stage-a/1440x900/01-s00-t4600-end.png", "P03 REAL FRAME: GLOBE OF CELLS, S00 END"),
    (PJ / "04-pulse-energy-grid/design/sketches/rose-s00-d.png", "P04 SKETCH: THE DAY ROSE, S00"),
    (PJ / "05-economic-atlas/design/sketches/seed-s00-d.png", "P05 SKETCH: THE SEED HEAD, S00"),
    (HERE / "dock-s00-d.png", "P07 SKETCH: THE CROSS-DOCK, S00 (REAL ARTIFACTS)"),
    (HERE / "dock-s05-d.png", "P07 SKETCH: S05 STORM, RELAXED (REAL ARTIFACTS)"),
    (HERE / "lens-s00-d.png", "P07 DISCARDED: THE LENS (READS AS A MAP)"),
]
W, H, LAB = 384, 240, 18
sheet = Image.new("RGB", (4 * W + 5 * 8 + 132, 2 * (H + LAB) + 3 * 8), "#111")
d = ImageDraw.Draw(sheet)
for i, (p, label) in enumerate(tiles):
    x, y = 8 + (i % 4) * (W + 8), 8 + (i // 4) * (H + LAB + 8)
    sheet.paste(Image.open(p).convert("RGB").resize((W, H), Image.LANCZOS), (x, y + LAB))
    d.text((x + 2, y + 3), label, fill="#fff")
m = Image.open(HERE / "dock-s00-m.png").convert("RGB")
mh = 2 * (H + LAB) - LAB + 8
mw = round(m.width * mh / m.height)
x = 8 + 4 * (W + 8)
sheet.paste(m.resize((mw, mh), Image.LANCZOS), (x, 8 + LAB))
d.text((x + 2, 11), "P07 S00 M", fill="#fff")
sheet.save(HERE / "distinctness-sheet.png")
print("sheet", sheet.size)
