#!/usr/bin/env python3
"""Measure how a reference ad draws its supers. usage: peg_style.py <frames-dir> > tokens.json

Measured, not eyeballed — the same method the house packs were matched with: find the band the supers occupy,
read its fill and ink off the actual pixels, and derive the size from the glyph extent.

What it CANNOT do, and says so in the output: identify a typeface. Nothing in the pixels carries a font name,
so `font_family` is always null here and the caller has to choose one. A tool that guessed "Inter" and stayed
quiet about it would be worse than one that admits the gap.
"""
import glob, json, os, sys

try:
    import numpy as np
    from PIL import Image
except ImportError:
    print(json.dumps({"error": "needs numpy and Pillow: pip3 install numpy pillow"}))
    sys.exit(1)

d = sys.argv[1] if len(sys.argv) > 1 else "."
files = sorted(glob.glob(os.path.join(d, "*.png")))
if not files:
    print(json.dumps({"error": f"no frames in {d}"}))
    sys.exit(1)

frames = [np.asarray(Image.open(f).convert("RGB"), dtype=np.int16) for f in files]
H, W = frames[0].shape[:2]

SOLID_TOL = 10          # how close two pixels must be to count as the same flat fill
MIN_RUN = 0.18          # a fill narrower than this fraction of the width is not a super background
MIN_PRESENCE = 0.25     # a band has to appear in this fraction of frames to be the super band


def solid_runs(row):
    """Longest run of near-identical pixels that looks like a caption BAR -> (length, colour, start, end).

    "Flat" alone is not enough and this is the whole difficulty: a sky, a wall and a full-bleed end card are
    all perfectly flat and would each be read as a giant super band. What separates a bar from a background is
    that a bar is INSET (it has left and right edges inside the frame) and CONTRASTS with whatever sits beside
    it on the same row. Both conditions, or the detector finds a caption in every establishing shot.
    """
    diff = np.abs(np.diff(row.astype(np.int16), axis=0)).max(axis=1)
    breaks = np.flatnonzero(diff > SOLID_TOL)
    edges = np.concatenate(([0], breaks + 1, [len(row)]))
    w = len(row)
    best = (0, None, 0, 0)
    for a, b in zip(edges[:-1], edges[1:]):
        if b - a <= best[0] or b - a > w * 0.95:
            continue
        if a <= 2 or b >= w - 2:                  # touches an edge: a background, not a bar
            continue
        col = row[a:b].mean(axis=0)
        outside = np.concatenate((row[max(0, a - 6):a], row[b:min(w, b + 6)]))
        if len(outside) == 0 or np.abs(outside.mean(axis=0) - col).max() < 40:
            continue                              # blends into what is beside it: not a bar
        best = (b - a, col, a, b)
    return best


# ── 1. which rows carry a flat, wide fill, and how often ────────────────────────────────────────────────────
hits = np.zeros(H, dtype=np.int32)
fills, spans = [[] for _ in range(H)], [[] for _ in range(H)]
for fr in frames:
    for y in range(0, H, 2):                       # every other row: the band is tens of rows tall
        ln, col, a, b = solid_runs(fr[y])
        if ln >= MIN_RUN * W:
            hits[y] += 1
            fills[y].append(col)
            spans[y].append((a, b))

need = max(1, int(len(frames) * MIN_PRESENCE))
rows = np.flatnonzero(hits >= need)

# ── 2. group them into bands, keep the one that is most consistently present ────────────────────────────────
bands = []
if len(rows):
    start = prev = rows[0]
    for y in rows[1:]:
        if y - prev > 8:
            bands.append((start, prev)); start = y
        prev = y
    bands.append((start, prev))
# a band has to be tall enough to hold type, and not be the whole frame (that is a letterbox or a card)
bands = [(a, b) for a, b in bands if 24 <= (b - a) <= H * 0.45]

out = {"width": W, "height": H, "frames": len(frames), "font_family": None,
       "font_family_note": "not recoverable from pixels — the caller must choose a typeface"}

if not bands:
    # No flat fill anywhere: the supers are most likely bare type, usually white with a dark outline.
    bright = np.stack([((fr.mean(axis=2) > 225).sum(axis=1)) for fr in frames]).mean(axis=0)
    if bright.max() < W * 0.02:
        out["error"] = "no supers found — no flat caption band and no consistent bright type"
        print(json.dumps(out)); sys.exit(0)
    lo = int(np.argmax(bright)); hi = lo
    while lo > 0 and bright[lo - 1] > bright.max() * 0.25: lo -= 1
    while hi < H - 1 and bright[hi + 1] > bright.max() * 0.25: hi += 1
    out.update({"box": "none", "ink": "#FFFFFF", "stroke": "#000000",
                "band": [int(lo), int(hi)], "pos_pct": round((lo + hi) / 2 / H, 4),
                "estimated": {"cap_px": int(hi - lo), "font_px": int(round((hi - lo) / 0.80)),
                              "why": "bare type: size inferred from the bright-pixel extent, so it is a starting point, not a match"}})
    print(json.dumps(out)); sys.exit(0)

# ── 2a. grow each band to the bar's REAL extent ─────────────────────────────────────────────────────────────
# Step 1 only finds rows that are flat all the way across — which, in a caption bar, means the blank strip
# above and below the words. The rows holding the glyphs are not flat, so they are missing, and a band that
# stops short of its own type reads as having none. So take each band's fill and x-span and grow it while the
# row is still MOSTLY that fill: interrupted by letters is exactly what we are looking for.
def grow(a0, b0):
    sp = np.array([s for y in range(a0, b0 + 1) for s in spans[y]])
    fl = np.array([c for y in range(a0, b0 + 1) for c in fills[y]])
    if not len(sp):
        return a0, b0, None, 0, 0
    x0, x1 = int(np.median(sp[:, 0])), int(np.median(sp[:, 1]))
    col = np.median(fl, axis=0)
    if x1 - x0 < 40:
        return a0, b0, col, x0, x1

    span = x1 - x0

    def still_bar(y):
        """Is row y still inside the bar? Not "mostly the fill" — a row through the middle of bold type is
        less than half fill, so that test stops at the blank strip and the band never reaches its own words.
        The signature of a bar row is that the fill still REACHES BOTH ENDS of the span with the letters
        punched out of the middle."""
        for fr in frames:                        # any frame may be the one with the bar up at this row
            m = np.abs(fr[y, x0:x1] - col).max(axis=1) <= 26
            if m.mean() < 0.20:
                continue
            idx = np.flatnonzero(m)
            if idx[0] < span * 0.15 and idx[-1] > span * 0.85:
                return True
        return False

    a1, b1 = a0, b0
    while a1 > 0 and still_bar(a1 - 1):
        a1 -= 1
    while b1 < H - 1 and still_bar(b1 + 1):
        b1 += 1
    return a1, b1, col, x0, x1

grown = []
for a0, b0 in bands:
    a1, b1, col, x0, x1 = grow(a0, b0)
    if col is not None and 24 <= (b1 - a1) <= H * 0.45:
        grown.append((a1, b1, col, x0, x1))
bands = [(a1, b1) for a1, b1, _, _, _ in grown]
GROWN = {(a1, b1): (col, x0, x1) for a1, b1, col, x0, x1 in grown}

# ── 2b. of the candidate bands, keep the one that actually contains TYPE ────────────────────────────────────
# Being an inset, contrasting bar is still not proof: a shirt, a doorframe and a table edge all qualify. What
# only a caption has is LETTERFORMS — scanning across the bar crosses many ink/fill boundaries per row, where
# a flat object crosses almost none. Scoring on that, rather than on how tall or how present a band is, is
# what stops the detector confidently reporting somebody's t-shirt as the house super style.
def typeness(a, b):
    got = GROWN.get((a, b))
    if not got:
        return 0.0, 0
    _, x0, x1 = got
    if x1 - x0 < 40:
        return 0.0, 0
    per_frame = []
    for fr in frames:
        patch = fr[a:b + 1, x0:x1]
        crossings = (np.abs(np.diff(patch.astype(np.int16), axis=1)).max(axis=2) > 60).sum(axis=1)
        per_frame.append(float(np.median(crossings)))
    return float(np.median(per_frame)), x1 - x0

# A hard cutoff here was brittle: the same clip sampled at 20 frames and at 24 sat either side of it, which is
# no basis for telling somebody their reference ad has no supers. Score everything, take the best, and report
# CONFIDENCE — a weak winner is still more useful than a refusal, as long as it is labelled weak.
scored = sorted(((typeness(a0, b0)[0] * (hits[a0:b0 + 1].max() / len(frames)), a0, b0, typeness(a0, b0)[0])
                 for a0, b0 in bands), reverse=True)
if not scored:
    out["error"] = "no caption-shaped bar found — this peg may carry no supers"
    print(json.dumps(out)); sys.exit(0)
_, a, b, typescore = scored[0]
out["typeness"] = round(typescore, 1)
out["confidence"] = "high" if typescore >= 6 else "medium" if typescore >= 3 else "low"
if out["confidence"] == "low":
    out["confidence_note"] = ("the strongest candidate has few letterform edges — it may be an object in the "
                              "shot rather than a caption. Look at the proof before trusting it.")

# ── 3. read the fill, the ink, and the geometry off the band ────────────────────────────────────────────────
fill, x0, x1 = GROWN[(a, b)]
# NOTE: x0/x1 sit INSIDE the bar (they come from the flat-run medians). Widening them to the bar's true edges
# was tried and made things worse — the fill tolerance runs past the edge into a bright background, which then
# poisons both the ink colour and the glyph extent. Staying inside keeps those two honest, at the cost of the
# corner radius and the horizontal padding, which are reported as estimates below rather than as measurements.

# ink = whatever sits inside the band and is NOT the fill
ink_px = []
for fr in frames:
    patch = fr[a:b + 1, x0:x1]
    mask = np.abs(patch - fill).max(axis=2) > 60
    if mask.sum() > 50:
        ink_px.append(patch[mask])
ink = np.median(np.concatenate(ink_px), axis=0) if ink_px else np.array([17, 17, 17])

# Cap height from the rows the ink actually occupies. The threshold matters: at 2% of the span the softened
# pixels along the bar's own top and bottom edge count as "ink", and the answer comes back as the height of
# the whole bar — which then doubles the font size. Ask for a real line's worth of ink instead, and ignore the
# bar's outer few rows entirely.
inset = max(2, int((b - a) * 0.08))
rowsize = []
for fr in frames:
    patch = fr[a + inset:b + 1 - inset, x0:x1]
    if patch.size == 0:
        continue
    mask = np.abs(patch - fill).max(axis=2) > 60
    occupied = np.flatnonzero(mask.sum(axis=1) > (x1 - x0) * 0.06)
    if len(occupied) > 4:
        rowsize.append(occupied[-1] - occupied[0])
cap = int(np.median(rowsize)) if rowsize else int((b - a) * 0.55)

# Corner radius: how much narrower the fill is at the bar's top row than across its middle. Measured on the
# fill itself rather than via the generic run finder, which can lock onto something else in the frame.
def fill_width(y):
    best = 0
    for fr in frames:
        m = np.flatnonzero(np.abs(fr[y, x0:x1] - fill).max(axis=1) <= 30)
        if len(m) > 4:
            best = max(best, int(m[-1] - m[0]))
    return best

mid_w = fill_width((a + b) // 2)
top_w = max(fill_width(a + 1), fill_width(b - 1))
radius = max(0, int(round((mid_w - top_w) / 2))) if mid_w else 0

hexed = lambda c: "#%02X%02X%02X" % tuple(int(max(0, min(255, v))) for v in c)
# Two tiers, deliberately. WHERE the supers sit and WHAT COLOUR they are come out reliably and are reported as
# measurements. Size, corner radius and padding do not: they are inferred from a glyph extent that antialiasing
# inflates and from a span that stops inside the bar. Reporting those with the same confidence as the position
# would be the kind of quiet guess the rest of this kit exists to avoid, so they are labelled as estimates and
# the caller is expected to put them in front of a human.
out.update({
    "box": "pill",
    "fill": hexed(fill),
    "ink": hexed(ink),
    "band": [int(a), int(b)],
    "row_px": int(b - a),
    "pos_pct": round((a + b) / 2 / H, 4),
    "presence": round(float(hits[a:b + 1].max()) / len(frames), 2),
    "estimated": {
        "font_px": int(round(cap / 0.80)),
        "radius_px": min(radius, int((b - a) / 2)),
        "padx_px": max(0, int(round((x1 - x0) * 0.07))),
        "cap_px": cap,
        "why": "inferred from the glyph extent and an inner span — antialiasing inflates both. Check against the proof image and adjust; the position and the colours are the reliable part.",
    },
})
print(json.dumps(out))
