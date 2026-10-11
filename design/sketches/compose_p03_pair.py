"""P03 vs P07 watch-item check: real P03 S00 end frame next to the P07 S00 sketch, 240px tall,
in colour (row 1) and greyscale (row 2). Run: uv run --with pillow python design/sketches/compose_p03_pair.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

HERE = Path(__file__).parent
P03 = HERE / "../../../03-climate-signal-observatory/artifacts/evidence/stage-a/1440x900/01-s00-t4600-end.png"
tiles = [(P03, "P03 REAL S00 END"), (HERE / "dock-s00-d.png", "P07 S00 SKETCH")]
W, H, LAB = 384, 240, 18
sheet = Image.new("RGB", (2 * W + 3 * 8, 2 * (H + LAB) + 3 * 8), "#111")
d = ImageDraw.Draw(sheet)
for row, grey in enumerate((False, True)):
    for i, (p, label) in enumerate(tiles):
        im = Image.open(p).convert("RGB").resize((W, H), Image.LANCZOS)
        if grey:
            im = ImageOps.grayscale(im).convert("RGB")
        x, y = 8 + i * (W + 8), 8 + row * (H + LAB + 8)
        sheet.paste(im, (x, y + LAB))
        d.text((x + 2, y + 3), label + (" (GREYSCALE)" if grey else ""), fill="#fff")
sheet.save(HERE / "p03-p07-pair.png")
print("pair", sheet.size)
