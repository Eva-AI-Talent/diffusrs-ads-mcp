#!/usr/bin/env python3
"""Measure rendered text width with the real font. stdin {font,size,lines} -> stdout [w,...].

The whole point is the font's OWN metrics: a box sized by guessing at character widths wraps, and the
wrapped line overlaps the one under it. Falls back to an estimate rather than failing the build, so a
missing font degrades to a slightly loose pill instead of no edit at all.
"""
import json, os, sys

req = json.load(sys.stdin)
lines = req.get("lines", [])
size = int(req.get("size", 66))
want = os.path.expanduser(req.get("font", "") or "")

CANDIDATES = [want,
              os.path.expanduser("~/Library/Fonts/CapCutSansText-Bold.otf"),
              "/Library/Fonts/CapCutSansText-Bold.otf",
              "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
              "/System/Library/Fonts/Helvetica.ttc"]

font = None
try:
    from PIL import ImageFont
    for path in CANDIDATES:
        if path and os.path.exists(path):
            try:
                font = ImageFont.truetype(path, size)
                break
            except Exception:
                continue
except Exception:
    font = None

if font is None:
    json.dump([max(1, int(len(l) * size * 0.52)) for l in lines], sys.stdout)
else:
    json.dump([max(1, int(font.getbbox(l)[2])) for l in lines], sys.stdout)
