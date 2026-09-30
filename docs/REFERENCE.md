# Reference

Every stage as a command, and the guarantees behind them. **[The README](../README.md) is the walkthrough** —
start there if you just want to make something.

---

## Workflow A — make a new ad

Just ask:

> "Make me a UGC ad for https://example.com/product — the angle is that people waste money on the cheap
> version first. Here's a competitor ad that's working: «link»"

Claude picks up the `adkit-brief` skill and runs the stages. Or drive them yourself:

```bash
node brief.mjs init myproduct --product "https://…" --angle "…"
node scripts/product.mjs myproduct        # copy, offer, the REAL product image, brand.json
node scripts/peg.mjs "«reference ad url»" --slug myproduct
node scripts/match-template.mjs "«your idea»"      # which of the 22 styles fits
node scripts/plan.mjs myproduct V1 --res 480p      # timings + a price estimate
# …Claude renders through diffusr, quoting before each call…
node scripts/assemble.mjs myproduct V1             # join, one loudness, clean cuts
node scripts/qa.mjs myproduct V1                   # does it say the script?
```

**Render a 480p draft first.** It is under half the price of 720p.

## Workflow B — many ads from footage you already have

This spends **nothing**. A finished shoot of 4–6 videos usually carries 15–30 more ads.

> "Turn what we've already shot into more variations"

```bash
node scripts/remix.mjs myproduct --dir «your clips» --sheets   # inventory + contact sheets
#   ↑ look at the sheets, then set each shot's role + inPoint in remix/shots.json
node scripts/slate.mjs myproduct                                # ← it RECOMMENDS a slate
node scripts/storyboard.mjs myproduct                           # ← the plan you approve, with real frames
node scripts/build-cut.mjs myproduct c01 --ds                   # build it FOR the editor
node scripts/ds-build.mjs  myproduct c01                        # open it up in Diffusion Studio
node scripts/ds-export.mjs myproduct c01                        # render it, and prove the render matches
```

`slate.mjs` works out which of **18 formats** your footage can actually carry, and proposes a spread across
length, structure and audio — telling you what it *cannot* build and why (`PROBLEM 3/4`). You approve, then build.

**Optional on a cut:** narration (`vo.mjs`), a music bed (`bgm.mjs`, or your own track), SFX, an end card.

### The looks
**The same cut in two packs is two genuinely different ads for one build**, and the look is picked at edit
time — see *Editing in Diffusion Studio* below for all four.

| pack | reads as | use for |
|---|---|---|
| **organic** | a creator's own post | the default; native in-feed, cold traffic, testimonials. White supers, black text |
| **slab** | a paid DTC ad | when the brand must be unmissable — retargeting, offers, anything with a price |

Colours and wordmark come from `brand.json`, read off the brand's own site. What a cut specifies always wins.

### Editing in Diffusion Studio

Every cut can be finished in **Diffusion Studio** — the kit's editor. Build the cut with `--ds` and the supers
stop being burned into the picture: they arrive in the project as **native nodes you can drag, retime and
retype in the app**. That is the whole point; a burned-in super needs a rebuild to move a word.

```bash
node scripts/build-cut.mjs myproduct c01 --ds      # clean base + the timing of every super
node scripts/ds-build.mjs  myproduct c01           # the house edit          ← default
node scripts/ds-build.mjs  myproduct c01 --vox     # the explainer edit      ← option
node scripts/ds-export.mjs myproduct c01           # render, and verify the render
```

Ask for an edit and Claude asks you two things first: **supers?** (yes by default) and **which look?**

| look | what you get | needs |
|---|---|---|
| **Organic** *(default)* | the cut + supers, captions and end card as editable nodes — every line **white with black text** | nothing extra |
| **Branded** | the same, in your site's own colours and wordmark | `brand.json` (product.mjs writes it) |
| **Vox motion graphics** | an explainer re-cut — paper cards, a split, a lower-third face band, the speaker on the card | a window plan you approve |
| **Follow a peg** | a treatment read off a reference ad you supply | a peg video |

```bash
node scripts/ds-build.mjs myproduct c01 --pack branded     # or --vox, or --pack styles/_derived/<name>.json
node scripts/ds-build.mjs myproduct c01 --no-supers        # same cut, no on-screen headlines
```

The look is a flag at edit time, so seeing the same cut in a second style costs one command, not a rebuild.

Every cut gets **two supers by default** — one on the opening beat, one on the CTA — and they are written
about *this video*, not the category:

```
This WATCH is better        How to ACTUALLY        How i went from 215 LBS
than the WHOOP?             Lose Weight            to 176 LBS in 3 WEEKS
```

…closing with `Learn more about / <product> Here ↓`. CAPS one to three words, numbers over adjectives, a
question over a claim. It also places **one or two jump cuts** on the emphasis in the script — a hard cut to a
tighter framing on the same shot, which is what stops a talking beat going static.

It also asks what you want **on top**: **transitions** (`whip` — a fast blurred snap; `slide` / `slideup` — a
deliberate eased push; hard cuts by default), **SFX** (clicks, pops, a notification bell, chimes, whooshes) and
**music** (generated with ElevenLabs, or a track you supply). Every transition carries its own sound and the
audio underneath it — a silent one punches a hole in the voice.

**Following a peg is not automatic, on purpose.** `peg-style.mjs` pulls a contact sheet and a pack scaffold;
Claude reads the treatment off the frames and fills the pack in. A pixel heuristic was built for this and it
could not reliably tell a caption bar from a t-shirt — so it reports its own confidence and defers to your
eyes. The typeface is never measured; nothing in the pixels carries a font name.

The explainer look wants Oswald, Playfair Display and Caveat (all free from Google Fonts — it names them and
stops if they are missing). Its paper is generated and its foley is synthesised, so nothing is downloaded. The
speaker-on-the-card shot uses `rembg` when you have it (`pip3 install rembg onnxruntime`); without it she goes
on the card as a framed inset instead, and the build tells you which one it used.

`ds-export.mjs` measures the exported file against the project's own timeline and **refuses to call it a
success unless they match** — because dapi caches a render per project id, and a stale id serves the previous
video into your new filename without ever erroring.

**No Diffusion Studio?** Drop `--ds` and `build-cut.mjs` alone gives you the finished video, supers and all.

---

---

## How it protects the work

- **A style, not a guess.** Every idea matches a real template, or it stops and asks. Hybrids nothing covers are
  refused rather than approximated.
- **The real product image is the source of truth**, passed wherever the product appears — so the label stays
  right instead of being re-imagined each shot.
- **References are locked first.** The creator, the room and the product are pinned to approved pictures before
  anything renders; a wrong reference would otherwise spoil every clip made from it.
- **The room travels with the person** — each room gets its own picture of the creator, rather than a separate
  backdrop that gets overruled.
- **Clips stay consistent.** Longer videos carry clip 1's voice and frames into the rest.
- **One loudness, clean joins, re-encoded** — no volume jump, no glitch at the cut.

## What it will not do

- Spend credits without showing the price and getting a yes — **per call**, not once per brief.
- Write a claim your product page does not support, **even if you dictate the words**.
- Log in, click through an age gate, or work around a block to fetch a reference ad. It will ask you to
  screen-record it instead.
- Render a product from prose because no photo exists.
- Report a step as done when it was skipped. If QA cannot run it says **unverified** — never "passed".

---

---

## Commands

| Command | Does |
|---|---|
| `brief.mjs init\|status\|set` | the workspace; `state.json` is the record |
| `scripts/product.mjs` | product context, images, brand tokens from the site |
| `scripts/peg.mjs` | pull a reference ad (`--file` ingests a screen recording) |
| `scripts/adlib.mjs` | Meta Ad Library, public pages only |
| `scripts/match-template.mjs` | which style fits, or refuse |
| `scripts/plan.mjs` | clip plan, timings, price estimate |
| `scripts/refs.mjs` | reference sheets + the render gate |
| `scripts/assemble.mjs` | join clips into the final cut |
| `scripts/qa.mjs` | does the video say the script? |
| `scripts/remix.mjs` | inventory footage for recutting |
| `scripts/slate.mjs` | **recommend** a slate of new ads |
| `scripts/storyboard.mjs` | the approval plan — real frames, supers, mute read |
| `scripts/tighten.mjs` | prep a source (CFR30, gapless) and cut the dead air out of it |
| `scripts/build-cut.mjs` | build an approved cut (`--ds` leaves the supers editable) |
| `scripts/ds-build.mjs` | the **Diffusion Studio edit** — supers, captions and end card as native nodes |
| `scripts/ds-vox.mjs` | the **explainer edit** — cards, split, face band, cutout (`ds-build.mjs --vox`) |
| `scripts/ds-export.mjs` | render a dapi project, and verify it is not a cached one |
| `scripts/peg-style.mjs` | start a look from a reference ad — a contact sheet plus a pack to edit |
| `scripts/setup.mjs` | what the kit needs, what each key buys, and what breaks without it |
| `scripts/vo.mjs` · `scripts/bgm.mjs` | narration · music bed |
| `scripts/spend.mjs` | what this brief has cost |
| `scripts/verify.mjs` | is this machine ready? |
| `scripts/test.mjs` | self-test (no renders, no cost) |
| `scripts/check-no-direct-api.mjs` | proves this package can reach **no renderer but diffusr**, and carries no keys |
| `scripts/pack.mjs` | rebuild the zip (only needed if you modify the kit) |

Costs are credits; **1 credit = $0.01**. A short 480p draft is usually a dollar or two.

Don't take the "renders only through diffusr" claim on trust — check it yourself:

```bash
node scripts/check-no-direct-api.mjs
```

It greps every shipped file for any other model API, any private endpoint and anything shaped like a credential,
and fails loudly if it finds one. There is deliberately no other model client in this package.

---

---

## Testing it

| | proves |
|---|---|
| `node scripts/verify.mjs --plan` | the **scripts** work — gates, timings, renders, packaging |
| [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md) | the **skill** works — Claude picks it up and refuses when it should |

The second matters more. A skill that never triggers, or that skips the price gate when asked nicely, is broken
even when every script passes. Part 2 of the acceptance test — the refusals — matters more than Part 1.
