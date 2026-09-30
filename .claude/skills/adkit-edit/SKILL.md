---
name: adkit-edit
description: >-
  Edit a cut in DIFFUSION STUDIO — the kit's editor. Two looks: the house edit (`ds-build.mjs`, the default:
  the finished picture as one clip with every super, caption and end-card element as a native, draggable node)
  and the explainer edit (`ds-build.mjs --vox`, an option: the cut keeps moving between the speaker, full-screen
  paper cards, a split, a lower-third face band and the speaker shrunk onto the card). Then `ds-export.mjs`
  renders it and proves the render matches the project. Use whenever someone wants a cut "edited", "captioned",
  "supered", turned into an explainer, or opened in Diffusion Studio. Needs the `dapi` CLI; without it,
  `build-cut.mjs` alone still produces a finished video.
---

# adkit-edit — Diffusion Studio is the editor

Every cut this kit builds can be finished in **Diffusion Studio** (the `dapi` CLI + its JSX editor). The point
is not "a nicer render" — it is that the supers, cards and captions arrive as **native nodes the user can drag,
retime and retype in the app**. A burned-in super cannot be moved without a rebuild, which defeats editing.

**Four looks. Organic is the default; the rest are asked for.** The look is a flag at EDIT time, so the same
cut renders in any of them without being rebuilt.

| look | what it is | needs |
|---|---|---|
| **Organic** *(default)* | the cut + house supers, captions, end card — reads as a creator's own post | the cut |
| **Branded** | the same, in the brand's own colours and wordmark, as a paid DTC ad | `brand.json` (product.mjs writes it) |
| **Vox motion graphics** | an explainer re-cut: paper cards, a split, a face band, the speaker on the card | an authored **window plan** |
| **Follow a peg** | a treatment read off a reference ad | a peg video, and your eyes (§3b) |

Do not offer the explainer look for a cut with nothing to explain. A wall of cards over a product demo reads as
a slideshow.

---

## 0. ASK FIRST — two questions, once, before you build anything

When someone says "edit it" / "can you edit this" / "make the edit", **ask both of these in one message** and
wait. Do not build on an assumption, and do not drip-feed the questions one turn at a time.

**1. Supers?** — the on-screen headline lines.
> **Default: yes**, and by default there are at least **two**: one on the opening beat and one on the CTA.
> Only skip on an explicit no.

Organic is **every line white with black text**. A coloured second line was tried and rejected — the accent
belongs on the CTA button and the end card, not in the headline.

The copy matters more than the treatment. Write about **this video**, not the category, and keep it casual and
concrete — the full formula is in `adkit-remix` §6b. The shape:

```
This WATCH is better        How to ACTUALLY        How i went from 215 LBS
than the WHOOP?             Lose Weight            to 176 LBS in 3 WEEKS
```

…and the CTA: `Learn more about / <product> Here ⬇️` or `Get your / <product> Here ⬇️`.

CAPS one to three words, never a whole line. Numbers beat adjectives. A question beats a claim.

**2. Which look?**

| | what it is | command |
|---|---|---|
| **Organic** *(default)* | reads as a creator's own post — white/accent pills, centred | `ds-build.mjs <slug> <cut>` |
| **Branded** | the paid-DTC treatment, using the brand tokens read off their own site | `ds-build.mjs <slug> <cut> --pack branded` |
| **Vox motion graphics** | an explainer re-cut: paper cards, a split, a face band, cutout | `ds-build.mjs <slug> <cut> --vox` |
| **Follow a peg** | match a reference ad's treatment | see §4b — it needs a look first, not a command |

**3. Anything on top?** — ask this as ONE line with the defaults stated, not as three more questions.

| | options | default | where it is set |
|---|---|---|---|
| **transitions** | `whip` (fast, blurred — a snap), `slide` / `slideup` (a deliberate eased push) | **hard cuts** | `"transition"` on a beat in the cut file |
| **SFX** | `click`, `pop`, `bell`, `chime`, `whoosh`, `swipe` | **none, beyond the sound every transition already carries** | `"sfx"` on a beat |
| **music** | generated, or a file they supply | **none** | `bgm.mjs`, or `"bgm"` on the cut |

Three things worth knowing so you can advise rather than just collect answers:

- **A transition on every beat reads as amateur.** They are punctuation — use one where the subject or the
  idea changes, and hard-cut the rest. If someone asks for "transitions everywhere", build it, but say once
  that two or three placed well usually tests better.
- **Every transition already carries its own sound** (a whoosh on a whip, a softer swipe on a slide) and
  **carries the audio under it** — a silent transition between two talking beats punches a hole in the voice.
  So "SFX" means the extra ones: a click on a super landing, a bell on the offer, a pop on a reveal.
- **Music needs `ELEVENLABS_API_KEY`**, and generated music needs that key to carry the `music_generation`
  scope. Without either, say so and ask for a track instead — do not quietly ship it silent.

```bash
node scripts/bgm.mjs <slug> <cut> --seconds <cut length>   # generate a bed, sized to the cut
```

Generate the bed **after** the picture, to the cut's real length: a bed built to a guessed length has to be
looped or hard-faded somewhere arbitrary.

**Do not ask what they have already told you.** "Edit it in the Vox style" answers question 2 — ask only about
supers. "Just captions, no big text on screen" answers question 1. Read the request before opening your mouth.

**Say what the defaults are when you ask**, so "just go" is a real answer:

> Two quick things, and one optional:
> 1. **Supers** (the big on-screen lines) — yes by default. Want them?
> 2. **Look** — **Organic** (creator-style, the default), **Branded** (your site's colours and wordmark),
>    **Vox motion graphics** (an explainer re-cut with cards and a split), or **follow a peg** if you have a
>    reference ad you want it to look like.
> 3. Anything on top? **Transitions** (a whip snap or a slide push — default is hard cuts), **SFX** (clicks,
>    pops, a notification bell), **music** (I can generate a bed, or drop me a track).
>
> Say "just go" and I'll do Organic, with supers, hard cuts, no music.

One more thing worth knowing while you ask: **the look is chosen at edit time, not baked in.** The same cut
renders in any pack without rebuilding, so "actually, show me branded too" costs one command, not a rebuild.
Offer that when they are undecided rather than making them pick blind.

---

## 0b. Prerequisite — check, do not assume

```bash
dapi --version
```

If `dapi` is missing: **say so plainly** and stop offering an edit. The flat cut at
`briefs/<slug>/remix/out/<cut>.mp4` is already a finished, deliverable video — say that too, so nobody thinks
the work is blocked. Do not half-build an edit, and do not silently fall back to burning supers when the user
asked for an editable one.

---

## 1. Prep the source, and cut the dead air

**Before anything else, if you are editing a raw take rather than clips that are already tight.**

```bash
node scripts/tighten.mjs <file>            # prep + remove the dead air
node scripts/tighten.mjs <file> --dry      # what it would cut, and how much
node scripts/tighten.mjs <file> --prep-only  # just make it editor-safe
```

### Prep is not optional

Every clip an editor touches must be **H.264, constant frame rate 30, gapless audio, regular keyframes**.
Skipping it produces failures that look like something else entirely:

| symptom | actual cause |
|---|---|
| about a second of audio missing near the clip's tail — **at render only**, it plays fine in ffprobe | variable frame rate / irregular PTS |
| `Decoding error`, black or missing frames on preview | keyframes 3–6s apart instead of every second |
| the editor stutters and drops audio on playback | HEVC / H.265 source |

`tighten.mjs` does this, and then **proves** the audio gaps are gone rather than assuming the flag worked.

### Cutting dead air — two rules, both learned the hard way

**Cut on the ACOUSTIC SILENCE, never on a transcript word time.** Word timestamps drift by up to ~0.6s, so a
cut placed on one lands mid-word — clipping the attack or the tail — or mid-pause, leaving a fragment of the
phrase you meant to remove. A region `silencedetect` returns is below threshold *by definition*, so cutting
inside it cannot remove anything audible.

**The threshold is relative to the file's own noise floor, never fixed.** A clip whose room tone sits at
−25 dB has no region below a fixed −30 dB gate. The gate then "finds nothing" and you conclude there is no
dead air — while the pauses are plainly visible in the waveform. `tighten.mjs` measures the file's mean and
sweeps up from 12 dB below it.

It also leaves ~0.15s of every pause behind. Speech with every gap removed reads frantic.

**Before it renders, it checks every region it is about to cut is 12 dB or more under the file's peak**, and
refuses if one is not. That is cheaper than re-transcribing and decisive: a region that quiet holds no audible
speech, whatever a transcript claims is in it.

⚠️ **This is for SOURCE footage, not a finished cut.** Run it on an assembled ad and it will happily remove the
deliberate silence under your end card.

**Then listen to it.** And QA the render, not the timeline — §7.

## 2. Build the base FOR the editor — `--ds` is not optional

```bash
node scripts/build-cut.mjs <slug> <cut> --ds
```

`--ds` changes two things:

- **supers are not burned in.** They are written to `out/<cut>.edit.json` with their times on the finished
  timeline (whips included), and the editor draws them as nodes.
- **the end card becomes a plain coloured tail.** Its headline, body, offer, button, price, trust line and
  product hero are drawn as nodes too. The tail still has to exist in the picture so the music bed and the
  loudness pass cover it.

Build without `--ds` and `ds-build.mjs` **refuses**, because drawing the supers again would print every line
twice — and that is not visible until the export comes back.

## 3. The house edit (default)

```bash
node scripts/ds-build.mjs <slug> <cut> [--captions] [--open]
```

Writes `briefs/<slug>/edit/<cut>/` — `index.tsx`, `package.json`, `tsconfig.json`, `assets/`.

**The A-roll is ONE `<video>` clip.** That is deliberate and it is the single most important structural rule
here: a multi-segment timeline drops audio at the segment joins when dapi exports it. One clip has no joins.
Every super, caption and end-card element sits in its own `<sequence>` on top.

The look comes from the cut's pack (`styles/organic.json` or `styles/slab.json`), so the nodes carry the same
tokens the burned build used — same font, same pill geometry, same accent. The organic pack's supers are
**per-line pills** (each sized to its own line, overlapping by 20, emitted bottom-line-first so the wider upper
pill hides the lower one's corners). A uniform box was tried on this look and rejected.

## 4. The explainer edit (option)

```bash
node scripts/ds-build.mjs <slug> <cut> --vox [--captions]
```

Needs `briefs/<slug>/remix/cuts/<cut>.vox.json` — a **window plan**, one window per beat of the voice:

```json
{"windows": [
  {"t": [0, 1.8],   "mode": "A"},
  {"t": [1.8, 4.0], "mode": "F", "card": {"kind": "stamp", "lines": ["IT'S LEGAL.", "IT'S REGULATED."]}},
  {"t": [4.0, 7.2], "mode": "P", "card": {"kind": "checklist", "title": "THREE THINGS", "items": ["…", "…", "…"]}},
  {"t": [7.2, 9.4], "mode": "S", "card": {"kind": "counter", "number": "10,000", "label": "procedures"}},
  {"t": [9.4, 12.0],"mode": "G", "card": {"kind": "page", "lines": ["…"]}}],
 "punch": [{"t": [3.0, 4.0], "scale": 1.15}],
 "facePct": 0.42}
```

**Author the plan — never generate one blind.** Which line earns a card and which stays on the speaker is a
judgement about the script, so read the script, propose the plan, and show it before building.

- **modes** — `A` full A-roll · `F` full paper card, voice only · `S` split (card above, A-roll below) ·
  `P` card with the speaker as a lower-third face band · `G` the speaker on the card
- **card kinds** — `page` (statement lines, serif) · `stamp` (caps that land one at a time with a red rule) ·
  `checklist` (title + ticked items) · `counter` (a big number + label) · `tag` (a red label)
- **`facePct`** is where the face sits down the frame (default 0.42). The band and split crops are derived from
  it — get it wrong and the band cuts the chin off.
- **change layout every ~1.6–2.1s.** That rhythm is the format. But **keep several `A` windows**: the builder
  warns below 18% A-roll, and it is right to.
- **crops are baked, not masked** — `<rect mask>` does not clip a video in dapi, so the band and the split are
  real cropped files, encoded **without audio** (the base clip already carries the voice).
- **paper is generated** (`scripts/make_paper.py`), foley is **synthesised** (`scripts/ds-vox.mjs`), and both
  ship nothing that belongs to anyone. No tonal pings — plinks and bells were tried on this look and rejected;
  it is paper, stamps and ticks.
- **the cutout (`G`)** uses `rembg` when it is installed (`pip3 install rembg onnxruntime`). Without it the
  speaker goes onto the card as a **framed inset** — a device this style already uses, so the fallback is a
  different shot, not a broken one. The builder says which one it used. Never claim a cutout you did not make.

## 4b. Following a peg

When they want the edit to look like a reference ad:

```bash
node scripts/peg-style.mjs <slug> <peg-video|peg-id> [--name <id>] [--family organic|slab]
```

It writes a **contact sheet** (`briefs/<slug>/remix/peg-sheet-<name>.png`) and a pack scaffold
(`styles/_derived/<name>.json`).

**Then LOOK at the sheet and set the tokens yourself.** This is not a formality — the script measures a
candidate band and reports its own confidence, and it is regularly wrong: a t-shirt, a doorframe and a bright
window are all flat, inset and contrasting, exactly like a caption bar. It was tuned over several passes and
still returned the brown of somebody's shirt as the super colour. So treat its numbers as a starting point and
the sheet as the evidence. If it says confidence LOW, ignore the numbers entirely.

Read off the sheet and write into the pack:

| token | what to look for |
|---|---|
| `layout.held` | how far down the frame the supers sit, as a fraction (eyeball against the frame edges) |
| `layout.box` | `"pill"` if there is a filled bar behind the type, `"none"` if it is bare type with an outline |
| `colors.fill` | the bar colour — and note if line 2 differs from line 1 |
| `colors.ink` | the type colour on the bar |
| `layout.size` | roughly, relative to the frame: a 1080-wide frame, type about a fifteenth of it, is ~72 |
| `layout.radius` | square corners are 0; lightly rounded is ~16–18; a capsule is half the row height |
| `font.family` | **you are choosing this, not reading it.** Say so. Match the feel — a geometric sans, a condensed caps face — and name what you picked |

Then build and **look again**:

```bash
node scripts/ds-build.mjs <slug> <cut> --pack styles/_derived/<name>.json
```

Iterate on the numbers in the pack file. Do not re-derive — the measurement will not have got smarter.

**Never tell them it matched the peg.** It is a treatment read off a reference by eye, with a typeface that was
guessed. Show them the two side by side and let them judge.

## 5. Export — and prove it

```bash
node scripts/ds-export.mjs <slug> <cut>          # the explainer: <cut>-vox
```

This opens the project, polls `dapi check` until the duration settles, exports, and then **measures the output
and refuses to report success unless it matches the project's own timeline**.

That check exists because of the failure it catches: **dapi caches an export per `projectId` and a composition
per `package.json` name.** A reused id serves the *previous* project's render into the new filename, with no
error — identical duration and size is the only tell. Both builders hash their ids over the base video, the
super data, the style, the assets **and the builder's own source**, so a restyle with unchanged data still
produces a new id. Never hand-edit an id to "fix" a stale export; rebuild.

Two more that have bitten:

- **`workarea` is what an export covers.** Both builders declare it. Without one the app falls back to a
  persisted range from whatever it loaded last.
- **A malformed `assets.yml` blocks the app's whole project loader** — every project then reports "No such
  node". Delete the file and re-open; `dapi logs` names it.

**Never interrupt a running export.** dapi serves a project's own assets over a local connection; killing an
export mid-flight leaves that connection broken, and then *every* project fails to export with
`network error` — while `dapi check` still reports it as perfectly healthy. The project is fine; the app is
not. Restart it. Do not go looking for a fault in the edit.

**One export per launch is common.** The app often serves a project once and then stops answering — `dapi
check` hangs, or `export` returns "successfully" having written nothing. `ds-export.mjs` fails fast and says so
rather than waiting, and it never treats a missing or stale file as a success.

If the bridge stops answering:

```bash
pkill -9 -f "Diffusion Studio"; sleep 8; open -a "Diffusion Studio" --args --disable-gpu-compositing
```

⚠️ **That force-quit takes down the app for everything else using it** — an edit the user has open with unsaved
changes, and any other session driving `dapi` on the same machine (they share one app instance). So the
exporter never does it on its own: pass `--restart` only for an unattended batch, and otherwise tell the user
what to run and let them decide when.

(`--disable-gpu-compositing` also fixes a **black preview canvas** where audio plays and overlays draw but the
video never appears. That is a Chromium compositing bug, not the edit — `dapi capture` and the export are fine.
Do not re-encode the source chasing it.)

## 6. Hand-edits beat rebuilds

Once the user has touched `index.tsx` in the app, **do not regenerate it** — that reverts their cut. Read the
current file and edit surgically, backing up first. The app also rewrites node ids and reorders attributes, so
anything that parses the file must not depend on the ids the builder wrote.

## 7. QA the export, not the timeline

```bash
node scripts/qa.mjs <slug> <cut> --file briefs/<slug>/remix/out/<cut>-edit.mp4
```

An edit can drop words the raw render said perfectly. QA the file you are actually shipping, and report what QA
says — including when it fails.
