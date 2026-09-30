#!/usr/bin/env python3
"""Cut the speaker out of a folder of frames, in place. usage: matte.py <frames-dir>

u2net_human_seg, not the default model: on a person the general model leaves halo and eats hair, and the
difference is obvious once the cutout sits on a light card.

Rembg is the slow pole (about half a second a frame), so this reports progress and is safe to re-run — a frame
that already has an alpha channel is left alone.
"""
import glob, os, sys

d = sys.argv[1] if len(sys.argv) > 1 else "."
frames = sorted(glob.glob(os.path.join(d, "*.png")))
if not frames:
    print("no frames to matte", file=sys.stderr)
    sys.exit(1)

try:
    from rembg import new_session, remove
    from PIL import Image
except ImportError:
    print("rembg is not installed (pip3 install rembg onnxruntime)", file=sys.stderr)
    sys.exit(1)

session = new_session("u2net_human_seg")
for i, f in enumerate(frames):
    try:
        im = Image.open(f)
        if im.mode == "RGBA" and im.getchannel("A").getextrema()[0] < 255:
            continue                                  # already matted; a re-run should be cheap
        remove(im.convert("RGB"), session=session).save(f)
    except Exception as e:                            # one bad frame must not lose the whole pass
        print(f"\n  frame {os.path.basename(f)}: {e}", file=sys.stderr)
    if i % 10 == 0:
        print(f"\r  matting {i + 1}/{len(frames)}", end="", file=sys.stderr, flush=True)
print(f"\r  matted {len(frames)} frames        ", file=sys.stderr)
