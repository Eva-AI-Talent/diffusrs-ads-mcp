#!/usr/bin/env python3
"""render_super.py — draw a super as a transparent PNG, measured properly.

    python3 scripts/render_super.py '<json>' out.png

ffmpeg's drawtext/drawbox cannot do this: it has no rounded corners, and box sizing guesses at text width from a
character count. Here the width comes from the FONT'S OWN METRICS, so a pill is exactly as wide as its line.

THE HOUSE SUPER (organic default), locked to the CapCut peg:
  · PER-LINE pills — each pill is proportionate to THAT line's text. NOT one uniform box: a uniform box was
    tried and rejected, because the narrow line then floats in a too-wide pill.
  · ROW 94 with OV 20 overlap, so the two lines CONNECT with no gap between them.
  · Draw order is bottom-line-first, so the upper (wider) pill covers the lower pill's top corners and the two
    read as one shape rather than two stacked cards.
  · cornerRadius 18 — lightly rounded. Not 24-30, which reads as a bubble.
  · Font CapCut Sans Text Bold at 66, ink #111111, centred, NO shadow.

Input JSON: {lines, font, size, padx, row, ov, radius, fills[], ink, width, align}
"""
import json, sys
from PIL import Image, ImageDraw, ImageFont

# ── missing glyphs ──────────────────────────────────────────────────────────────────────────────────────────
# A CTA line very reasonably ends in an arrow, and the obvious character to reach for is the emoji one. CapCut
# Sans has no glyph for it, so it renders as a hollow TOFU BOX — which looks like a bug in the ad, in the one
# super whose whole job is to be clicked. Substitute to a character the font actually has rather than shipping
# a box. Detected, not assumed: a codepoint in the private-use area is guaranteed absent, so anything that
# renders identically to it is absent too.
SUBS = {"\u2b07": "\u2193", "\u25bc": "\u2193", "\u25be": "\u2193", "\U0001f447": "\u2193",
        "\u27a1": "\u2192", "\u25b6": "\u2192", "\U0001f449": "\u2192"}


def glyph_fixer(font):
    """Returns a function that makes a line safe for THIS font."""
    def ink(ch):
        m = font.getmask(ch)
        return (m.size, bytes(m)) if m.size[0] else None
    missing = ink("\ue000")                       # private use: nothing sane maps it

    def fix(line):
        out = []
        for ch in line:
            if ch == "\ufe0f":                    # the variation selector never draws anything
                continue
            if ink(ch) == missing and ch.strip():
                sub = SUBS.get(ch)
                if sub and ink(sub) != missing:
                    out.append(sub)
                # a missing character with no sensible stand-in is dropped: a box is worse than a gap
                continue
            out.append(ch)
        return "".join(out)
    return fix


def main():
    cfg = json.loads(sys.argv[1])
    out = sys.argv[2]

    lines = [l for l in cfg["lines"] if l]
    if not lines:
        Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(out); return

    size   = int(cfg.get("size", 66))
    padx   = int(cfg.get("padx", 34))
    row    = int(cfg.get("row", 94))
    ov     = int(cfg.get("ov", 20))
    radius = int(cfg.get("radius", 18))
    ink    = cfg.get("ink", "#111111")
    fills  = cfg.get("fills") or ["#FFFFFF", "#A8D62E"]
    canvasW = int(cfg.get("width", 1080))

    try:
        font = ImageFont.truetype(cfg["font"], size)
    except Exception as e:
        print(f"font load failed: {e}", file=sys.stderr); sys.exit(2)

    # Swap anything this font cannot draw BEFORE measuring — a tofu box is a different width to its
    # replacement, so fixing the text after the pills are sized leaves them wrong.
    fix = glyph_fixer(font)
    lines = [fix(l) for l in lines]

    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    def tw(t):
        b = probe.textbbox((0, 0), t, font=font)
        return b[2] - b[0]

    # each pill is sized to ITS OWN line
    widths = [int(tw(t)) + 2 * padx for t in lines]
    step   = row - ov                       # the overlap is what makes them connect
    canvasH = row + step * (len(lines) - 1)
    img = Image.new("RGBA", (canvasW, canvasH), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    boxes = []
    for i, t in enumerate(lines):
        w = widths[i]
        x = (canvasW - w) // 2
        y = i * step
        boxes.append((x, y, w, fills[i % len(fills)], t))

    # BOTTOM LINE FIRST: the upper pill then draws over the lower pill's top corners, so the stack reads as one
    # shape. Drawing top-down instead leaves a visible seam where the corners meet.
    bar = cfg.get("bar")            # slab: an accent bar down the left edge of each panel
    barw = int(cfg.get("bar_w", 8))
    for x, y, w, fill, _ in reversed(boxes):
        if radius > 0:
            d.rounded_rectangle([x, y, x + w, y + row], radius=radius, fill=fill)
        else:
            d.rectangle([x, y, x + w, y + row], fill=fill)
        if bar:
            d.rectangle([x, y, x + barw, y + row], fill=bar)

    for x, y, w, _, t in boxes:
        b = probe.textbbox((0, 0), t, font=font)
        tx = x + (w - (b[2] - b[0])) // 2 - b[0]
        ty = y + (row - (b[3] - b[1])) // 2 - b[1]
        d.text((tx, ty), t, font=font, fill=ink)

    img.save(out)
    print(json.dumps({"w": canvasW, "h": canvasH, "widths": widths}))

if __name__ == "__main__":
    main()
