#!/usr/bin/env python3
"""Contact sheet of a peg's frames, for reading its super treatment BY EYE.

    peg_sheet.py <frames-dir> <out.png> [band_top band_bottom]

Why a sheet and not a verdict: a pixel heuristic cannot reliably tell a caption bar from a t-shirt, a
doorframe or a bright window — it was tried, and it confidently returned a shirt. Looking at the frames
settles it in a second. If a candidate band was measured, it is drawn on so it can be confirmed or rejected,
never assumed.
"""
import glob, os, sys

from PIL import Image, ImageDraw

frames_dir, out = sys.argv[1], sys.argv[2]
band = [int(sys.argv[3]), int(sys.argv[4])] if len(sys.argv) > 4 else None

files = sorted(glob.glob(os.path.join(frames_dir, "f_*.png")))
if not files:
    print("no frames", file=sys.stderr); sys.exit(1)

pick = files[:: max(1, len(files) // 12)][:12]
ims = []
for f in pick:
    im = Image.open(f).convert("RGB")
    if band:
        d = ImageDraw.Draw(im)
        d.rectangle([6, band[0], im.width - 6, band[1]], outline=(255, 45, 45), width=8)
    im.thumbnail((360, 640))
    ims.append(im)

cols = 4
rows = (len(ims) + cols - 1) // cols
cw, ch = max(i.width for i in ims), max(i.height for i in ims)
sheet = Image.new("RGB", (cols * cw + (cols + 1) * 10, rows * ch + (rows + 1) * 10), (16, 16, 18))
for k, im in enumerate(ims):
    r, c = divmod(k, cols)
    sheet.paste(im, (10 + c * (cw + 10), 10 + r * (ch + 10)))
sheet.save(out)
print(out)
