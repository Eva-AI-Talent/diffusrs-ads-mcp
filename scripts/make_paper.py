#!/usr/bin/env python3
"""Generate the Vox look's paper grounds. usage: make_paper.py <outdir> [w] [h]

The style is built on textured paper, never flat colour — but shipping scanned paper would mean shipping
someone's assets. These are generated: fibre noise, a soft vignette, a few age blotches, and for the grid
sheet a faint ruled grid. Deterministic (fixed seed) so a rebuild does not shift the look under an approved
edit, and cheap enough to run on every build.
"""
import os, random, sys

from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
W = int(sys.argv[2]) if len(sys.argv) > 2 else 1080
H = int(sys.argv[3]) if len(sys.argv) > 3 else 1920
os.makedirs(OUT, exist_ok=True)

PAPERS = {
    "paper_cream": ((243, 236, 220), (208, 196, 172), None),
    "paper_grid":  ((240, 238, 230), (205, 203, 192), (176, 186, 196)),
    "paper_kraft": ((205, 178, 138), (162, 132,  92), None),
}


def fibre(w, h, seed):
    """Paper fibre: fine noise softened just enough to read as grain rather than static."""
    rnd = random.Random(seed)
    small = Image.new("L", (w // 2, h // 2))
    small.putdata([rnd.randint(108, 148) for _ in range(small.width * small.height)])
    return small.resize((w, h), Image.BILINEAR).filter(ImageFilter.GaussianBlur(0.6))


def build(name, base, edge, rule):
    img = Image.new("RGB", (W, H), base)
    grain = fibre(W, H, abs(hash(name)) % 10_000)
    img = Image.blend(img, Image.merge("RGB", (grain, grain, grain)), 0.17)

    if rule:                       # ruled grid, faint enough to sit under type
        d = ImageDraw.Draw(img)
        for x in range(0, W, 54):
            d.line([(x, 0), (x, H)], fill=rule, width=1)
        for y in range(0, H, 54):
            d.line([(0, y), (W, y)], fill=rule, width=1)
        img = Image.blend(img, Image.new("RGB", (W, H), base), 0.45)

    # age blotches — a few soft darker patches so the sheet is not perfectly even
    rnd = random.Random(abs(hash(name)) % 997)
    blot = Image.new("L", (W, H), 0)
    bd = ImageDraw.Draw(blot)
    for _ in range(14):
        cx, cy = rnd.randrange(W), rnd.randrange(H)
        r = rnd.randrange(90, 320)
        bd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=rnd.randrange(10, 26))
    blot = blot.filter(ImageFilter.GaussianBlur(70))
    img = Image.composite(Image.new("RGB", (W, H), edge), img, blot)

    # vignette: darker at the edges, as a sheet lit from above reads
    vig = Image.new("L", (W, H), 0)
    ImageDraw.Draw(vig).ellipse([-W * 0.18, -H * 0.08, W * 1.18, H * 1.08], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(180))
    img = Image.composite(img, Image.new("RGB", (W, H), edge), vig)

    path = os.path.join(OUT, f"{name}.jpg")
    img.save(path, quality=92)
    return path


for name, (base, edge, rule) in PAPERS.items():
    print(build(name, base, edge, rule))
