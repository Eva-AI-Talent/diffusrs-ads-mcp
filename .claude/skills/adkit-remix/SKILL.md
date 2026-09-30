---
name: adkit-remix
description: >-
  Cut many NEW ads out of footage that already exists — no new renders, no new credits. Reads the clips you have,
  classifies every usable window into a beat role (PROBLEM / PRODUCT / ACTION / PROOF / PERSON), then assembles
  those windows into genuinely different formats, each with its own copy, supers and audio treatment. Use when
  someone wants "more variations", "recut what we already have", "another ten from the same footage", or wants
  more out of a finished shoot. Always sends a plan for approval before building. NOT for generating new footage
  (that is adkit-brief).
---

# adkit-remix — many ads out of footage you already paid for

A finished set is 4–6 videos and 15–20 scene clips. That library can carry **15–30 more ads** if you stop
treating a clip as "scene 3 of V1" and start treating it as **a beat you can borrow**.

**This is the cheapest stage in the kit: it spends no credits at all.** Every variation costs only edit time.
When someone wants more volume, reach for this before rendering anything new.

> **Scope note.** Ported from a production pipeline, and it is a REBUILD rather than a copy. What came across:
> the method (beat roles, the availability ceiling, composites, format variety, the mute test, the approval
> gate), all 18 formats, both look packs, narration and the house super spec. What did not: the original's
> renderer. There, supers are editor nodes with keyframed slides; here they are burned with ffmpeg and fade in.
> The structure is the same, the motion is simpler. Anything referencing a specific brand's copy, colours or
> voice belongs to that brand and is not here.

---

## How this gets used

The user says something like *"turn these into new variations"* or *"get me another ten out of this footage"*.
They should not have to name formats or edit styles — **you recommend those.** The flow:

```bash
node scripts/remix.mjs <slug> --dir <clips-dir> --sheets   # 1. inventory + contact sheets
#    ↑ then LOOK at the sheets and fill in each shot's role + inPoint in remix/shots.json
node scripts/slate.mjs <slug>                              # 2. what the footage can build + a proposed slate
```

`slate.mjs` reads what you classified, works out **which of the 18 formats this library can actually carry**,
and proposes a spread across length, spine and audio mode — with a look pack per cut. Nothing is spent.

Then show the user the slate, in plain language: *"your footage can carry these nine; here's the spread I'd
pick and why."* Let them cut it down, swap things, or ask for more. **Only once they approve** do you write the
beat lists and build.

If a format they want isn't buildable, say what's missing (`node scripts/slate.mjs <slug> --all` lists every
format with the exact shortfall — e.g. `PERSON 2/3`) rather than quietly substituting another.

### The brand's own look
Two files, and they do different jobs. **`brand.json` is measured** — wordmark, accent, palette, fonts — and is
applied automatically. **`brand.md` is judged** — register, claim style, what the brand would never do — and is
filled in with the user; nothing applies it for you. Use it when writing supers and end-card copy, so a blunt
trade brand does not get soft lifestyle lines.

`scripts/product.mjs` reads the brand's site and writes `briefs/<slug>/brand.json` — wordmark, accent (preferring
`theme-color`, else the most-used *actual colour* in the CSS: saturated, not near-black or near-white), a dark
tone and the top of the palette. A branded cut inherits it automatically.

Precedence: **what the cut says › what the site says › the pack's default.** So you never retype the brand, and an
explicit choice on a cut always wins.

⚠️ It is a READ of the site, not a verdict. Show it to the user before a branded cut inherits it — a nav
highlight is not always the brand colour, and a site with no `theme-color` and a muted palette may give nothing
usable. If it looks wrong, set `accent`/`wordmark` on the cut.

### The two look packs
Any beat list can be built in either — **running the same cut in both packs is two genuinely different ads for
one build**, and it is the cheapest variation available.

| pack | reads as | use for |
|---|---|---|
| **Organic** | a creator's own post | the default; native in-feed, best for cold traffic and testimonials |
| **On-brand** | a paid DTC ad | when the brand must be unmissable — retargeting, offer-led cuts, anything with a price |

On-brand needs the brand's accent colour and wordmark. Ask for them rather than guessing.

## 🚦 THE APPROVAL GATE — a plan first, ALWAYS

**Never build a batch before the user has seen and approved a plan.** A wrong read of the strategy wastes an
hour of building. Build the plan with:

```bash
node scripts/storyboard.mjs <slug>          # → briefs/<slug>/remix/_plan/plan.html
```

One self-contained page, one card per cut: format, length, audio mode, look pack, then a beat strip showing the
**real first frame of every shot at its real in-point** with its duration, the supers verbatim, and the narration
line per beat. Show it to the user and get a yes.

**The frames come from the actual source at the actual in-point, so the plan cannot flatter a shot that does not
exist.** That is the whole reason to show it rather than describe it: a description is a guess, a frame is
evidence. Never describe a shot you have not looked at.

It also flags, while fixing is still free, what the build would refuse anyway: a beat outrunning its shot's
availability, a missing source, a beat with **no super** (which says nothing on mute).

Read the **mute list** at the bottom of each card aloud with the video off. If the supers alone do not sell the
product, the copy is not finished.

If they ask for "as many as possible", propose the whole slate in ONE plan — they approve the spread, not each
cut one at a time.

---

## 1. Inventory and prep

```bash
node scripts/remix.mjs <slug> --dir <clips-dir>          # inventory + contact sheets + a shot-library stub
```

⚠️ **Prep every source to CFR30 with gapless audio and regular keyframes first** (see `adkit-edit` §1). A
scene-cut GOP throws decode errors in the editor, and a near-30 `avg_frame_rate` silently drops the tail audio.

⚠️ **Sources are often 720×1280, not 1080×1920.** Scale up BEFORE any crop or composite, or the crop is wider
than the frame and plain beats won't concat with composite beats.

## 2. Classify every window into a beat role

This is what makes shot-picking intelligent rather than random. A product library almost always decomposes into
five roles:

| role | what it is | what it's for |
|---|---|---|
| **PROBLEM** | the mess, the before | hooks; the "that's me" mirror |
| **PRODUCT** | the pack held, label readable | the SHIFT beat and every CTA |
| **ACTION** | applying, using | proof-in-progress; the middle third |
| **PROOF** | the clean reveal, the after | the payoff |
| **PERSON** | face to camera, talking | testimonial, native-audio cuts |

**Build the map in this order:**

1. **Read the scripts you already have** — each scene's written description gives you the role for free. Cheapest
   signal; do it first.
2. **Sample frames and LOOK.** A description tells you what a scene is *about*, not where inside it the usable
   window sits. `remix.mjs` builds a numbered contact sheet per clip. **Count the columns carefully** — misreading
   a tile grid costs a wrong in-point and a rebuild.
3. **Pin the in-point to the frame where the beat actually reads** — the pack raised and the label square, the
   hands up, the dirt visibly lifting. Not the scene start.
4. **Record availability** = `clip duration − in-point`. This is the hard ceiling on any beat using that shot.
5. **Check the audio of the window** before planning a native-audio cut. A "washing hands" window usually has
   someone *talking over it*, which decides whether a process/ASMR cut is possible at all. Find that out at
   planning time, not after the build.

### Composites are free variations
A 2×2 of four 9:16 cells **is** 9:16 — nothing is cropped. Stacked halves, a full-width band plus two cells, and
a **progressive split** (full → 2-up → 3-up → 4-up) is a whole format on its own. A composite is bounded by its
**shortest** member, and renders silent — so any cut using one lays its own bed.

## 3. Vary the STRUCTURE, not just the shot order

The 18 formats live in `lib/remix-formats.mjs` — each is a **grammar over beat roles**, not a fixed shot list,
which is why one library yields all of them. `slate.mjs` picks from them for you; read them directly when you
want to hand-pick or explain a choice.

Twenty cuts that are all "problem → use → clean → pack" is one ad twenty times. Make the slate span:

- **different openings** — grid, single face, extreme close, end-state-first, an on-screen question
- **different spines** — list, Q&A cycle, timer, reverse chronology, roll call, comparison
- **different audio modes** — bed-only, native voices, ambient/process
- **different lengths** — a 6–8s loop, several 12–18s, one or two 25–35s

Aim for a slate where **no two cuts share both a format and an audio mode**.

Every variation must still land **the core benefit and the price/CTA**. The argument stays the same; the order,
framing and proof shown are what change.

## 4. Copy — casual, and legible on mute

**The mute test is the hard rule.** Most of the feed watches without sound:

- **Every beat carries a super.** A beat with no super says nothing on mute. If a beat needs to breathe, hold the
  previous super across it rather than going bare.
- **The supers alone must make the whole argument** — problem, product, mechanism, price. Read the super list top
  to bottom with the video off; if it doesn't sell, the copy isn't done.
- **The first super is a SECOND hook**, distinct from any spoken line.
- **Name the brand in the supers**, not only in speech — a mute viewer never hears it.

Voice: casual spoken English, contractions, short sentences, no marketing register.

Mechanics that bite: text measured by one tool and rendered by another will **wrap and overflow** — size down
with slack rather than fitting exactly. Condensed caps sit high in their box and need nudging back down. And
elements that all arrive together read templated — **stagger and alternate** the direction line to line.

## 5. Edit styles

| style | beats | transitions | audio | use for |
|---|---|---|---|---|
| **ORGANIC** (default) | 1.5–3s | whips on subject changes | bed or native | the house look |
| **SNAP** | 0.6–1.2s | hard cuts | bed + a tick per cut | lists, racks, countdowns |
| **GRID** | 2.5–4s | hard cuts | bed | composites, progressive splits |
| **KINETIC** | 1–2s | whip + a static punch-in per beat | bed + SFX | hands-only, product detail |
| **DOC** | 4–10s | hard cuts | native voices | testimonials |

**Whips are frame-averaged pans, not a crossfade** — an eased pan across a side-by-side canvas sampled at a high
sub-frame rate then averaged, so the blur comes from real motion. Sub-sampling too coarsely reads as discrete
ghosts. A sub-frame xfade silently collapses the whole concat chain.

**Punch-ins are delivered BY THE CUT** — a static reframe on the next beat, never an animated scale.

## 6. Audio modes

| mode | source track | bed | notes |
|---|---|---|---|
| `bed` | dropped | music low | picture-only cuts |
| `native` | kept, normalised | music well under it | testimonials; their own voices |
| `ambient` | kept | faint | process/ASMR — check the window isn't full of speech |

⚠️ **Never duck with `sidechaincompress`.** It truncates the bed — it emitted 9.8s of a 12.6s track, a different
length each run, with both inputs padded. Compute the duck from the known line times as a gain envelope instead.

⚠️ **A transition between two audio-carrying beats must carry audio too.** A whip built with `-an` punches a hole
in exactly the voice a native cut exists to showcase — cross-fade the audio across it.

## 6b. Writing the supers — the two that are not optional

**Every cut gets a super on the OPENING beat and a super on the CTA.** The first second is where a scroll is
won; the last is where the click is. `build-cut.mjs` warns when either is missing.

### The opening super

Two lines. About **this video**, not the category — "Hands wrecked at work" is the video, "Skin protection" is
a brochure. Casual and concrete, the way a person types, not the way a brand writes.

Three shapes that work, and why:

| shape | example | why it works |
|---|---|---|
| the comparison question | `This WATCH is better`<br>`than the WHOOP?` | names a thing the viewer already has an opinion about |
| the corrective promise | `How to ACTUALLY`<br>`Lose Weight` | "actually" implies everything else they tried was wrong |
| the specific result | `How i went from 215 LBS`<br>`to 176 LBS in 3 WEEKS` | numbers are checkable; adjectives are not |

Rules, each of which is a way these go wrong:

- **CAPS one to three words, never a whole line.** The caps ARE the emphasis; capitalising everything removes it.
- **Numbers beat adjectives.** `3 WEEKS` survives a scroll; `fast` does not.
- **A question is allowed**, and usually outperforms a claim — it does not have to be defended.
- **No brand name in the opening** unless the brand *is* the hook (a comparison, a name people know).
- **Lowercase and loose punctuation are fine** — `How i went from` reads as a person. Over-polished copy reads
  as an ad, and gets treated like one.
- **Two lines, roughly ≤28 characters each.** Longer and the pill spans the frame and the type shrinks.

### The CTA super

Same shape, one job. The arrow does the pointing:

```
Learn more about        Get your
<product> Here ⬇️        <product> Here ⬇️
```

Put the product name in — this is the one super where naming it is the point. Set `"cta": true` on it so it
sits in the CTA position rather than the opening one.

### Jump cuts — one or two, on the emphasis

A jump cut is a hard cut to a tighter framing on the same shot. It stops a talking beat going static, and it
costs nothing.

```json
{ "shot": "clip-2", "seconds": 3.0, "jump": { "at": 1.4, "scale": 1.25 } }
```

- **Place it on the word that matters** — the number, the turn, the claim. `at` is seconds into the beat. On
  the midpoint it reads as a glitch; on the emphasis it reads as an edit.
- **One or two per cut.** More and it stops being punctuation.
- **A beat under ~1.2s cannot carry one** — both halves flash. The builder skips it and says so.
- Read the script for where the emphasis actually falls. If the line is "I went from 215 to *176*", the jump
  lands on 176 — not halfway through the sentence.

## 7. Build — flat base, then the supers on top

1. **Each cut renders to ONE flat mp4** — picture plus the complete audio bed — via ffmpeg.
2. **The supers ride over that single video clip**, either burned in or as editable nodes.

A multi-segment editor timeline drops audio at segment boundaries on export. One clip, one audio track, no
boundaries.

```bash
node scripts/build-cut.mjs <slug> <cut>            # finished file, supers burned in
node scripts/build-cut.mjs <slug> <cut> --ds       # same cut, supers left EDITABLE
node scripts/ds-build.mjs  <slug> <cut>            # → a Diffusion Studio project (the default edit)
node scripts/ds-build.mjs  <slug> <cut> --vox      # → the explainer edit (needs an authored window plan)
node scripts/ds-export.mjs <slug> <cut>            # render it, and verify the render is not a cached one
```

Reach for `--ds` whenever the user will want to move a line, change a word, or retime a super — that is most of
the time. The full rules, and the cache traps that make a stale export look like a success, are in `adkit-edit`.

## 8. QA every cut

```bash
node scripts/qa.mjs <slug> <CUT> --file <the exported mp4>
```

Check the export, not the timeline. And look at the frames — a wrong in-point shows up as a beat that doesn't
read, which no transcript will catch.
