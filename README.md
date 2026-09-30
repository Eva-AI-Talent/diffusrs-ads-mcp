# diffusr adkit

Make ads with Claude Code. Two things it does:

1. **Make a new ad** — from a product link, a reference ad and an angle, to a finished video.
2. **Turn footage you already have into many more ads** — no new renders, no credits. Usually the better deal.

New renders go through the **diffusr MCP**. You talk to Claude; it runs the pipeline, shows you the plan
before it makes anything, every picture before any video, and the price before every spend.

**You do not need it connected to start.** Only #1 renders. Recutting footage you already have (#2) and
editing any cut in Diffusion Studio run entirely on your own machine — no account, no sign-in, no credits.

You drive this by **talking to Claude Code** in this folder. The commands all exist and you can run them, but
you never have to — say what you want and it runs them. Each section below leads with the sentence to say.

---

## Setup

**1. Node 18+**, and — to render anything new — **connect the diffusr MCP**.

There are three states, and they need different fixes:

| State | What you see | Fix |
|---|---|---|
| not configured | `/mcp` does not list diffusr | `claude mcp add --transport http diffusr https://app.diffusr.ai/api/mcp` |
| configured, not approved | Claude Code asks whether to trust the server | restart Claude Code **in this folder** and approve it |
| approved, not signed in | diffusr is listed but its tools fail | run `/mcp` and sign in |

This folder ships `.mcp.json` with diffusr already wired, so for most people it is the middle row: open Claude
Code here, approve the server, then `/mcp` to sign in.

Connect it **before** asking for a new ad — if it's missing, Claude stops and tells you rather than doing prep
work you can't use. It will still offer the parts that don't need it, because those produce finished videos on
their own rather than half a render.

**2. Tools and libraries**

Required — nothing builds without these:

| Tool | For | Install |
|---|---|---|
| `ffmpeg` + `ffprobe` | every cut, every frame, all the audio work | `brew install ffmpeg` |
| `python3` + **Pillow** | supers, measured with the font's real metrics | `pip3 install pillow` |
| **CapCut Sans Text Bold** | the default look — **cut-building stops without it** | ships with CapCut; or point `styles/organic.json` at any bold sans |

Optional — each one unlocks exactly one thing, and the kit says so rather than failing oddly:

| Tool | Unlocks | Install |
|---|---|---|
| `yt-dlp` | pulling a reference ad from a link | `brew install yt-dlp` |
| **numpy** | reading a look off a reference ad (`peg-style.mjs`) | `pip3 install numpy` |
| **rembg** + onnxruntime | the speaker cut out onto a card, in the explainer look | `pip3 install rembg onnxruntime` |
| `playwright` | Meta **Ad Library** links specifically | `npm i -D playwright` |
| Diffusion Studio (`dapi`) | editing a cut — moving supers, the explainer look | see their docs |
| Oswald · Playfair · Caveat | the explainer look's type | free from fonts.google.com |

There are **no npm dependencies to install** — `playwright` is the only one, and only for Ad Library links.

**3. Keys** — run this and it tells you what each one buys and what breaks without it:

```bash
node scripts/setup.mjs
node scripts/setup.mjs --set OPENAI_API_KEY=sk-…    # writes .env, which is gitignored and never packaged
```

| Key | What it buys | Without it |
|---|---|---|
| `OPENAI_API_KEY` | QA — transcribes the finished video and checks it against the script | QA reports **UNVERIFIED**, never a pass. You lose the check, not the honesty. |
| `ELEVENLABS_API_KEY` | narration (`vo.mjs`) and a generated music bed (`bgm.mjs`) | the footage's own audio, or your own music file — both first-class |

Neither blocks you from starting. Claude asks for them on your first run and explains why, rather than letting
you find out when a stage quietly does nothing.

`verify.mjs` reports a missing pack font as **broken**, not as a warning, because nothing builds until it is
resolved. Everything else it marks amber, and tells you what you lose.

Check everything at once:

```bash
node scripts/verify.mjs          # ready / blocked / broken, plus the offline self-test
node scripts/verify.mjs --plan   # the end-to-end walkthrough, with real costs
```

---

---

## First run

Open Claude Code in this folder and say what you want to make. On a fresh project it walks you in: it shows
what's set up and what each missing key buys you, then asks three short questions —

> 1. **What are we selling?** A product link is enough.
> 2. **What should this ad say, and to whom?** One line.
> 3. **Anything to match?** A reference ad, or "you pick".

If you don't name a format, it recommends one and says why. You don't need to know the vocabulary to start.

---

## Find your thing

| I want to… | Go to |
|---|---|
| Make one ad from a product link | [1](#1-make-an-ad-from-a-product-link) |
| Make several versions of the same ad | [2](#2-make-several-versions) |
| Turn footage I already have into more ads | [3](#3-turn-footage-you-already-have-into-more-ads) |
| Change how a finished cut looks | [4](#4-change-how-a-cut-looks) |
| Make it look like an ad I've seen | [5](#5-copy-the-look-of-an-ad-youve-seen) |
| Add a voiceover, music, sound effects | [6](#6-voiceover-music-sound-effects) |
| Check it before I post it | [7](#7-check-it-before-you-post-it) |
| Understand what it costs | [8](#8-what-it-costs) |
| Fix something that went wrong | [Troubleshooting](#troubleshooting) |

---

## 1. Make an ad from a product link

> **"Make me an ad for revoglov.com — for tradies whose hands get wrecked by grease."**

That's enough. It reads the page for the copy, the offer and the real product photo, then:

1. **Picks a format** and tells you why. If nothing fits, it stops and says so rather than approximating.
2. **Shows you the plan** — shots, timings, and the price — before spending anything.
3. **Locks the references** — the creator, the room, the product — as approved pictures. This matters: a wrong
   reference spoils every clip made from it, so it fixes them before rendering, not after.
4. **Renders**, quoting each call. **You approve every spend.**
5. **Assembles** and QAs.

**Render a 480p draft first.** Under half the price of 720p, and a draft tells you whether the idea works.

**What you'll be asked:** the format (it recommends), the price (before every call), the reference pictures
(before any video). Nothing else.

---

## 2. Make several versions

> **"Give me three versions of that — different hooks."**

The hook is the first two seconds, and it's the variable worth testing. Same body, three openings, three files.

Ask for variations *after* one version is right. Three versions of a weak idea is three weak ads.

---

## 3. Turn footage you already have into more ads

**This spends nothing** and usually beats rendering something new. A shoot of 4–6 videos normally carries
15–30 more ads.

> **"I've got a folder of clips — turn them into more ads."**

1. It **inventories** your clips and builds contact sheets.
2. You **tell it what each shot is** — the problem, the product, the reaction, the proof — and where the good
   bit starts. This is the only part that needs you, and it's worth the ten minutes.
3. It **recommends a slate** — which of 18 formats your footage can actually carry, spread across length,
   structure and audio. It also says what it *can't* build and why.
4. You approve, it builds.

**It will tell you a format is impossible.** That's the feature. A format that needs a reaction shot you don't
have can't be faked out of the clips you do have.

---

## 4. Change how a cut looks

> **"Edit it."**

It asks two things, and one optional:

1. **Supers?** — the big on-screen lines. **Yes by default**, and by default there are two: one on the opening
   beat, one on the CTA.
2. **Which look?**

   | look | reads as |
   |---|---|
   | **Organic** *(default)* | a creator's own post — white supers, black text |
   | **Branded** | a paid DTC ad, in your site's own colours and wordmark |
   | **Vox motion graphics** | an explainer — paper cards, a split screen, a lower-third face band |
   | **Follow a peg** | a reference ad you supply ([§5](#5-copy-the-look-of-an-ad-youve-seen)) |

3. **Anything on top?** — transitions (a whip snap, or a slide push; hard cuts by default), SFX (clicks, pops,
   a notification bell), music.

Say **"just go"** and you get Organic, with supers, hard cuts, no music.

**The look is picked at edit time.** Seeing the same cut as Branded costs one command, not a rebuild — so ask
for both and compare.

**If you have Diffusion Studio installed**, every super, caption and end-card line arrives as a **node you can
drag, retime and retype in the app**. That's the point of editing there rather than burning text into the
picture. If you don't have it, the cut is still a finished, deliverable video.

### The supers

It writes them about **your video**, not your category — "Hands wrecked at work", not "Skin protection". The
shapes that work:

```
This WATCH is better        How to ACTUALLY        How i went from 215 LBS
than the WHOOP?             Lose Weight            to 176 LBS in 3 WEEKS
```

…closing with `Learn more about / <product> Here ↓`.

If you want different copy, just say it: **"make the opening super about the 3-week thing"**.

### Jump cuts

It places one or two — a hard cut to a tighter framing on the same shot, landing on the emphasis in the line.
It's what stops a talking beat going static. Ask for more or none.

---

## 5. Copy the look of an ad you've seen

> **"Make it look like this ad"** + a link, or a screen recording.

It pulls the ad, lays out a **contact sheet** of frames, and reads the treatment off it — where the supers sit,
whether there's a bar behind them, the colours, roughly the size.

**It won't claim it matched.** Two honest limits, stated up front:

- A pixel measurement can't reliably tell a caption bar from a t-shirt. It reports its own confidence, and when
  it's low it says so and defers to the frames.
- **The typeface can't be read from pixels at all.** Nothing in an image carries a font name. It picks one that
  feels right and tells you it picked.

So you'll see the two side by side and be asked to judge. If it's off, say what's off — "the text is bigger and
lower" — and it adjusts.

---

## 6. Voiceover, music, sound effects

> **"Add a voiceover"** · **"Put some music under it"** · **"Add a click when the text lands"**

| | needs | without it |
|---|---|---|
| **narration** | `ELEVENLABS_API_KEY` | use the footage's own audio |
| **music** | the same key, with the `music_generation` scope | drop it your own track — just as good |
| **SFX** | nothing | — |
| **transitions** | nothing | — |

Sound effects are **synthesised**, not fetched. (Asking a speech engine for a "click" returns a 1.4-second
tone, which is useless as a cut marker.)

**Music is generated to the cut's real length**, after the picture exists — so it never has to be looped or
faded off at an arbitrary point.

**Every transition already carries its own sound** and the audio underneath it. A silent transition between two
talking beats punches a hole in the voice.

---

## 6b. Tighten a raw take

> **"Cut the dead air out of this."**

```bash
node scripts/tighten.mjs <file> --dry     # what it would cut, and how much
node scripts/tighten.mjs <file>           # do it
```

It also **preps** the file — H.264, constant frame rate 30, gapless audio, regular keyframes. That matters more
than it sounds: variable-frame-rate footage (straight off a phone) makes an editor drop about a second of audio
near the clip's tail **at render only**, so it looks fine right up until you export.

Two things it will not do: cut on a transcript word time (those drift by up to 0.6s and land mid-word), and use
a fixed volume gate (a room with loud tone has nothing below it, so a fixed gate "finds no dead air" while the
pauses sit plainly in the waveform). It measures the clip's own noise floor, and **refuses to cut** if a region
it's about to remove is within 12 dB of speech level.

⚠️ For **source footage**, not a finished cut — run it on an assembled ad and it will remove the deliberate
silence under your end card.

---

## 7. Check it before you post it

> **"QA it."**

It transcribes the finished video and checks it against the script — dropped words, garbled words, wrong
product.

**If it can't check, it says UNVERIFIED. It will never tell you it passed.** That needs `OPENAI_API_KEY`; see
`node scripts/setup.mjs`.

QA the **exported file**, not the timeline. An edit can drop a word the raw render said perfectly.

---

## 8. What it costs

- **Only new renders cost money.** Recutting your own footage and every edit are free.
- Costs are diffusr credits: **1 credit = $0.01**.
- A short 480p draft is usually **a dollar or two**.
- **You're quoted before every call and you approve each one.** Not once per project — per call.
- `node scripts/spend.mjs <project>` shows what a project has cost.

Start at 480p. Go to 720p once the idea is proven.

---

## Troubleshooting

**"The diffusr MCP isn't connected"**
Three different states, three different fixes:

| What you see | Fix |
|---|---|
| `/mcp` doesn't list diffusr | `claude mcp add --transport http diffusr https://app.diffusr.ai/api/mcp` |
| Claude Code asks whether to trust the server | restart Claude Code **in this folder**, approve it |
| diffusr is listed but its tools fail | run `/mcp` and sign in |

You only need it to **render**. Recutting footage and editing work without it.

**"build-cut.mjs stops without it" (a font)**
The look *is* the font, so it won't silently substitute one. Install CapCut (which ships CapCut Sans Text
Bold), or point `styles/organic.json` at any bold sans you have.

**An export came back wrong, or didn't appear**
Diffusion Studio often serves a project once per launch, then goes quiet. The kit refuses to call that a
success — it checks the file was actually written and matches the project. Quit and reopen the app, then export
again. **Never interrupt a running export**: it leaves the app unable to read its own files until restarted.

**It refused to do something**
Check the list below before assuming it's broken. Each of these is deliberate:

- won't write a claim your product page doesn't support — **even if you dictate the words**
- won't render a product from a description when no photo exists
- won't bypass an age gate or a block to fetch a reference ad (it'll ask you to screen-record it)
- won't approximate a format when none fits
- won't report a step as done when it was skipped

If you disagree, say so — several of these you can override by taking responsibility for the call. The ones
about claims and about reporting are not negotiable, and that's what makes the rest of it trustworthy.

**Something else**

```bash
node scripts/verify.mjs      # is this machine ready? red items block, amber ones don't
node scripts/setup.mjs       # what each key buys and what breaks without it
node scripts/test.mjs        # the full self-test — no renders, no cost
```

---

---

## The short version

```
Open Claude Code here.  Say what you want to make.  Approve the plan.  Approve the price.
```

Everything else in this guide is detail you can ignore until you need it.

---

## Reference

The command for every stage, the look packs, the guarantees and how to verify them:
**[docs/REFERENCE.md](docs/REFERENCE.md)**.
