# diffusr adkit

Make ads with Claude Code. Two things it does:

1. **Make a new ad** — from a product link, a reference ad and an angle, to a finished video.
2. **Turn footage you already have into many more ads** — no new renders, no credits. Usually the better deal.

You drive it by **talking to Claude Code** in this folder. Every command below exists and you can run it, but
you never have to — say what you want and it runs them. Each section leads with the sentence to say.

---

# Start here

Open this folder in Claude Code and paste this:

> **Set this kit up. Check what's installed, install anything missing, explain what each key is for and what
> breaks without it, then tell me what I can and can't do yet.**

That's the whole setup. Claude runs the checks, installs what it can, and tells you plainly where you stand.
You do not need to read the rest of this section unless something goes wrong.

When it's done, start your first ad with:

> **Make me an ad for «your product URL» — the angle is «one line about who it's for».**

---

## Setup, if you'd rather do it by hand

**1. Install the tools.** Two commands covers everything:

```bash
brew install ffmpeg yt-dlp
pip3 install pillow numpy
```

| | what it's for |
|---|---|
| `ffmpeg` | every cut, every frame, all the audio work — **required** |
| `pillow` | supers, measured with the font's real metrics — **required** |
| `yt-dlp` | pulling a reference ad from a link |
| `numpy` | reading a look off a reference ad |

**2. Install a font.** The default look needs **CapCut Sans Text Bold**, which ships with CapCut — installing
CapCut is the easy route. Cut-building **stops** without it, because the pack *is* the look, not a preference.
If you'd rather not, point `font.file` in `styles/organic.json` at any bold sans you already have.

**3. Connect the diffusr MCP** — only needed to *render* something new.

| State | What you see | Fix |
|---|---|---|
| not configured | `/mcp` does not list diffusr | `claude mcp add --transport http diffusr https://app.diffusr.ai/api/mcp` |
| configured, not approved | Claude Code asks whether to trust the server | restart Claude Code **in this folder** and approve it |
| approved, not signed in | diffusr is listed but its tools fail | run `/mcp` and sign in |

This folder ships `.mcp.json` with diffusr already wired, so for most people it's the middle row.

**4. Keys** — both optional, both worth having:

```bash
node scripts/setup.mjs                              # what each one buys, and what breaks without it
node scripts/setup.mjs --set OPENAI_API_KEY=sk-…    # writes .env, gitignored, never packaged
```

| Key | What it buys | Without it |
|---|---|---|
| `OPENAI_API_KEY` | QA — transcribes the finished video and checks it against the script | QA reports **UNVERIFIED**, never a pass. You lose the check, not the honesty. |
| `ELEVENLABS_API_KEY` | narration and a generated music bed | the footage's own audio, or your own track — both first-class |

**Optional extras**, each unlocking exactly one thing: `pip3 install rembg onnxruntime` (the speaker cut out
onto a card, in the explainer look) · `npm i -D playwright` (Meta Ad Library links specifically) ·
Diffusion Studio (editing a cut in an app instead of taking the rendered file) · Oswald, Playfair and Caveat
from fonts.google.com (the explainer look's type).

**Check it:**

```bash
node scripts/verify.mjs          # ready / blocked / broken
node scripts/test.mjs            # the full self-test — no renders, no cost
```

`verify.mjs` marks a missing pack font **broken**, because nothing builds until it's resolved. Everything else
is amber, and it tells you what you lose.

---

## Where things land

Each product gets a folder under `briefs/`. You rarely need to touch it, but knowing the shape helps:

```
briefs/<slug>/
  state.json          the record of what's been done — the source of truth, not chat history
  brand.json          colours + wordmark, read off the product's own site
  scripts/            the script for each video
  references/         the locked reference pictures — creator, room, product
  renders/            raw clips as they come back from diffusr
  storyboards/        the approval plan you sign off before anything renders
  delivery/<id>.mp4   the finished ad
  qa/<id>.md          the QA report
  remix/              everything for recutting footage you already have
    shots.json          what each clip is, and where the good bit starts
    cuts/<id>.json      one cut — the beats, supers, audio
    out/<id>.mp4        the built cut
  edit/<id>/          a Diffusion Studio project, if you edit there
```

---

# The eight things you'll do

| | |
|---|---|
| [1](#1-make-an-ad-from-a-product-link) | Make an ad from a product link |
| [2](#2-make-several-versions) | Make several versions |
| [3](#3-turn-footage-you-already-have-into-more-ads) | Turn footage you already have into more ads |
| [4](#4-change-how-a-cut-looks) | Change how a cut looks |
| [5](#5-copy-the-look-of-an-ad-youve-seen) | Copy the look of an ad you've seen |
| [6](#6-tighten-a-raw-take) | Tighten a raw take |
| [7](#7-voiceover-music-sound-effects) | Add voiceover, music, sound effects |
| [8](#8-check-it-before-you-post-it) | Check it before you post it |

---

## 1. Make an ad from a product link

**Say this:**

> Make me an ad for revoglov.com — for tradies whose hands get wrecked by grease.

A URL and one line about who it's for is enough. You don't need to know the format vocabulary.

**What happens**

1. **It reads the product page** — the copy, the offer, the price, and the real product photo. That photo
   matters more than it sounds: it's passed as a reference everywhere the product appears, so the label stays
   right instead of being re-imagined in every shot.
2. **It picks a format and tells you why.** If your idea matches nothing it knows, it **stops and says so**
   rather than approximating. That's deliberate — a hybrid nothing covers renders as a mess.
3. **It shows you a storyboard** — real frames, the supers in place, the timings, and a price. This is the
   approval gate. Nothing has been spent yet.
4. **It locks the references** — the creator, the room, the product, each pinned to a picture you approve.
   A wrong reference would otherwise spoil every clip made from it, so this happens *before* rendering.
5. **It renders, quoting each call**, and you approve each one.
6. **It assembles** — joins the clips, one loudness across the whole thing, re-encoded joins so there's no
   glitch at the cut — and QAs the result.

**You'll be asked:** the format (it recommends one), the reference pictures, and the price before every call.
Nothing else.

**You get:** `briefs/<slug>/delivery/<id>.mp4`, plus the QA report and the storyboard you approved.

**Worth knowing**

- **Render a 480p draft first.** Under half the price of 720p, and a draft tells you whether the idea works.
- Approval is **per call**, not once per project. You can stop at any point.
- It won't write a claim your product page doesn't support — **even if you dictate the words**.

---

## 2. Make several versions

**Say this:**

> Give me three versions of that — different hooks.

**What happens**

The hook is the first two seconds, and it's the variable worth testing. It keeps the body and the CTA, and
writes three different openings. Three files, same cut underneath.

**Worth knowing**

- **Ask for variations after one version is right.** Three versions of a weak idea is three weak ads.
- Hooks are the cheapest thing to vary and the most likely to change performance. Varying the body costs more
  and usually tells you less.
- If you want variations of the *look* rather than the words, that's [§4](#4-change-how-a-cut-looks) — and
  it's free, because no rendering is involved.

---

## 3. Turn footage you already have into more ads

**This spends nothing.** A shoot of 4–6 videos normally carries 15–30 more ads. If you have footage, start
here rather than with [§1](#1-make-an-ad-from-a-product-link).

**Say this:**

> I've got a folder of clips — turn them into more ads.

**What happens**

1. **It inventories your clips** and builds contact sheets so you can see everything at once.
2. **You tell it what each shot is** — the problem, the product, the reaction, the proof — and where the good
   part starts. This is the only step that needs you, and ten minutes here is what makes the rest work. It
   lands in `remix/shots.json`.
3. **It recommends a slate** — which of **18 formats** your footage can actually carry, spread across length,
   structure and audio. It also tells you what it *can't* build and why.
4. **You approve**, and it builds every cut.

**You get:** `briefs/<slug>/remix/out/<id>.mp4` for each cut, and a `cuts/<id>.json` you can edit and rebuild.

**Worth knowing**

- **It will tell you a format is impossible.** That's the feature. A format needing a reaction shot you didn't
  film can't be conjured out of the clips you did.
- Every cut is rebuildable from its `cuts/<id>.json` in seconds — change a super, change a timing, rebuild.
- This path needs **no diffusr connection and no credits**. It runs entirely on your machine.

---

## 4. Change how a cut looks

**Say this:**

> Edit it.

**What happens**

It asks two things, and one optional:

**1. Supers?** — the big on-screen lines. **Yes by default**, and by default there are two: **one on the
opening beat, one on the CTA**. The first second is where a scroll is won; the last is where the click is.

**2. Which look?**

| look | reads as | needs |
|---|---|---|
| **Organic** *(default)* | a creator's own post — **white supers, black text** | nothing |
| **Branded** | a paid DTC ad, in your site's own colours and wordmark | `brand.json` |
| **Vox motion graphics** | an explainer — paper cards, a split screen, a lower-third face band | a window plan you approve |
| **Follow a peg** | a reference ad you supply | [§5](#5-copy-the-look-of-an-ad-youve-seen) |

**3. Anything on top?**

| | options | default |
|---|---|---|
| transitions | `whip` (a fast blurred snap), `slide` / `slideup` (a deliberate eased push) | hard cuts |
| SFX | click, pop, bell, chime, whoosh, swipe | none beyond the sound each transition carries |
| music | generated, or a track you supply | none |

Say **"just go"** and you get Organic, with supers, hard cuts, no music.

**Worth knowing**

- **The look is picked at edit time, not baked in.** Seeing the same cut as Branded costs one command, not a
  rebuild — so ask for both and compare. This is free.
- **A transition on every beat reads as amateur.** They're punctuation. Two or three placed well test better,
  and it'll say so once before building what you asked for.
- **If you have Diffusion Studio**, every super, caption and end-card line arrives as a **node you can drag,
  retime and retype in the app** — that's the point of editing there. Without it, the cut is still a finished,
  deliverable video.

### The super copy

It writes them about **your video**, not your category — "Hands wrecked at work", not "Skin protection". Three
shapes that work:

```
This WATCH is better        How to ACTUALLY        How i went from 215 LBS
than the WHOOP?             Lose Weight            to 176 LBS in 3 WEEKS
```

…closing with `Learn more about / <product> Here ↓` or `Get your / <product> Here ↓`.

The rules, each of which is a way these go wrong: **CAPS one to three words, never a whole line** (the caps
*are* the emphasis; capitalising everything removes it). **Numbers beat adjectives** — `3 WEEKS` survives a
scroll, `fast` doesn't. **A question beats a claim**, because it doesn't have to be defended. **Lowercase and
loose punctuation are fine** — over-polished copy reads as an ad and gets treated like one.

Want different copy? Just say so: *"make the opening super about the 3-week thing"*.

### Jump cuts

It places **one or two** — a hard cut to a tighter framing on the same shot, landing on the emphasis in the
line. It's what stops a talking beat going static. On the midpoint it reads as a glitch; on the emphasis it
reads as an edit. Ask for more, or none.

---

## 5. Copy the look of an ad you've seen

**Say this:**

> Make it look like this ad — «link», or a screen recording.

**What happens**

1. It pulls the ad and lays out a **contact sheet** of frames.
2. It **reads the treatment off the frames** — where the supers sit, whether there's a bar behind them, the
   colours, roughly the size — and writes them into a look pack.
3. It builds your cut with that pack and shows you both, side by side.

**Two limits, stated up front**

- **It won't claim it matched.** A pixel measurement can't reliably tell a caption bar from a t-shirt — this
  was built, tuned over several passes, and still returned the brown of someone's shirt as the super colour.
  So it reports its own confidence, and when that's low it says so and works from the frames instead.
- **The typeface can't be read from pixels at all.** Nothing in an image carries a font name. It picks one
  that feels right and tells you it picked.

**So you judge it.** If it's off, say what's off — *"the text is bigger and lower"* — and it adjusts. Iterating
on the numbers is the intended workflow; re-measuring wouldn't get smarter.

---

## 6. Tighten a raw take

For **source footage** — a long take with pauses in it. Not a finished cut.

**Say this:**

> Cut the dead air out of this.

**What happens**

1. **It preps the file** — H.264, constant frame rate 30, gapless audio, keyframes every second — and proves
   the audio gaps are gone rather than trusting the flag. This matters more than it sounds: variable-frame-rate
   footage, straight off a phone, makes an editor drop about a second of audio near the clip's tail **at render
   only**. It plays fine right up until you export.
2. **It measures the clip's own noise floor** and works down from it.
3. **It removes the pauses**, leaving about 0.15s of each — speech with every gap removed reads frantic.
4. **Before cutting, it checks every region it's about to remove is 12 dB or more under the peak**, and
   refuses if one isn't.

**Two rules behind it**

- **Cut on the acoustic silence, never a transcript word time.** Word timestamps drift by up to 0.6s, so a cut
  placed on one lands mid-word or mid-pause.
- **The threshold is relative, never fixed.** A room whose tone sits at −25 dB has nothing below a fixed −30 dB
  gate — so a fixed gate "finds no dead air" while the pauses sit plainly in the waveform.

```bash
node scripts/tighten.mjs <file> --dry     # what it would cut, and how much
node scripts/tighten.mjs <file>           # do it
```

⚠️ **Not for a finished cut** — run it on an assembled ad and it will happily remove the deliberate silence
under your end card.

---

## 7. Voiceover, music, sound effects

**Say this:**

> Add a voiceover · Put some music under it · Add a click when the text lands

| | needs | without it |
|---|---|---|
| **narration** | `ELEVENLABS_API_KEY` | use the footage's own audio |
| **music** | the same key, with the `music_generation` scope | drop it your own track — just as good |
| **SFX** | nothing | — |
| **transitions** | nothing | — |

**Worth knowing**

- **Sound effects are synthesised, not fetched.** Asking a speech engine for a "click" returns a 1.4-second
  tone, which is useless as a cut marker — so clicks, pops and bells are generated from oscillators.
- **Music is generated to the cut's real length**, after the picture exists, so it never has to be looped or
  faded off at an arbitrary point.
- **Every transition already carries its own sound** — a whoosh on a whip, a softer swipe on a slide — **and
  the audio underneath it.** A silent transition between two talking beats punches a hole in the voice. So
  "SFX" means the extra ones: a click on a super landing, a bell on the offer.
- If the key is missing or lacks the music scope, it says so and asks for a track. It won't quietly ship silent.

---

## 8. Check it before you post it

**Say this:**

> QA it.

**What happens**

It transcribes the finished video and checks it against the script — dropped words, garbled words, wrong
product, anything the render got wrong that you'd only notice on the fifth watch.

**You get:** `briefs/<slug>/qa/<id>.md`.

**Worth knowing**

- **If it can't check, it says UNVERIFIED. It will never tell you it passed.** That needs `OPENAI_API_KEY`.
- **QA the exported file, not the timeline.** An edit can drop a word the raw render said perfectly.
- Delivery is gated on QA — that's deliberate, and you can override it by saying so.

---

# What it costs

- **Only new renders cost money.** Recutting your own footage, every edit, every look change: free.
- Costs are diffusr credits — **1 credit = $0.01**.
- A short 480p draft is usually **a dollar or two**.
- **You're quoted before every call and approve each one** — **per call**, not once per project.

```bash
node scripts/spend.mjs <slug>     # what this brief has cost
```

Start at 480p. Move to 720p once the idea is proven.

---

# Troubleshooting

**"The diffusr MCP isn't connected"** — three states, three fixes; see the table in Setup above. You only need
it to **render**. Recutting footage and editing work without it.

**A build stopped over a font** — the look *is* the font, so it won't silently substitute one. Install CapCut
(which ships CapCut Sans Text Bold), or point `styles/organic.json` at any bold sans you have.

**An export came back wrong, or didn't appear** — Diffusion Studio often serves a project once per launch, then
goes quiet. The kit refuses to call that a success: it checks the file was actually written and matches the
project. Quit and reopen the app, then export again. **Never interrupt a running export** — it leaves the app
unable to read its own files until restarted.

**Everything is slow** — check `df -h /System/Volumes/Data` and your load. Video work needs disk and CPU; below
about 1.5GB free, ffmpeg starts failing in ways that look like other problems.

**It refused to do something** — check this list before assuming it's broken. Each is deliberate:

- won't write a claim your product page doesn't support, **even if you dictate the words**
- won't render a product from a description when no photo exists
- won't bypass an age gate or a block to fetch a reference ad — it'll ask you to screen-record it
- won't approximate a format when none fits
- won't report a step as done when it was skipped

Several of these you can override by taking responsibility for the call — say so and it proceeds. The ones
about claims and about reporting are not negotiable, and that's what makes the rest of it trustworthy.

**Something else**

```bash
node scripts/verify.mjs      # is this machine ready?
node scripts/setup.mjs       # what each key buys and what breaks without it
node scripts/test.mjs        # the full self-test — no renders, no cost
```

---

# The short version

```
Open Claude Code here.  Paste the setup prompt.  Say what you want to make.
Approve the plan.  Approve the price.
```

Everything above is detail you can ignore until you need it.

---

## Reference

The command for every stage, the look packs, the guarantees and how to verify them:
**[docs/REFERENCE.md](docs/REFERENCE.md)**.
