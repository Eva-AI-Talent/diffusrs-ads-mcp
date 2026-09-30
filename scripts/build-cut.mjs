#!/usr/bin/env node
// build-cut.mjs — turn an approved beat list into a finished cut. No credits: it only recombines footage.
//
//   node scripts/build-cut.mjs <slug> <cut-id> [--dry] [--no-supers]
//
// Reads  briefs/<slug>/remix/cuts/<cut-id>.json   (the beat list, authored after the slate is approved)
//        briefs/<slug>/remix/shots.json           (roles + in-points, from remix.mjs)
// Writes briefs/<slug>/remix/out/<cut-id>.mp4
//
// THE ARCHITECTURE: each cut renders to ONE flat mp4 — picture plus the complete audio bed. A multi-segment
// editor timeline drops audio at segment boundaries on export; one clip with one audio track has no boundaries.
//
// CUT FILE SHAPE
// {
//   "id": "c01", "name": "Short Loop", "style": "SNAP",
//   "audio": "bed" | "native" | "ambient" | "vo",   // vo → narration from scripts/vo.mjs
//   "pack":  "organic" | "branded",
//   "bgm":   "path/to/music.mp3",          // required for `bed`; optional bed under `native`/`ambient`
//   "accent": "#A8D62E",                    // look-pack accent; branded also takes "wordmark": "BRAND"
//   "beats": [
//     { "shot": "clip-3", "seconds": 2.0, "super": { "line1": "Hands wrecked", "line2": "every winter" } },
//     { "shot": ["a","b","c","d"], "layout": "quad", "seconds": 3.0, "super": {...} },
//     { "shot": "clip-7", "seconds": 2.0, "punch": 1.3, "transition": "whip" | "slide" | "slideup", "sfx": "click" },
//     { "shot": "clip-2", "seconds": 3.0, "jump": { "at": 1.4, "scale": 1.25 } }   // a jump cut ON the emphasis
//   ]
// }
//
// RULES IT ENFORCES (each of these is a real failure mode, not a style opinion):
//   · a beat may not outrun its shot's AVAILABILITY (duration − inPoint) — the usual cause of a rebuild
//   · a composite is bounded by its SHORTEST member, and renders SILENT, so the cut must lay its own bed
//   · a transition between two audio-carrying beats CARRIES AUDIO (a silent one punches a hole in the voice)
//   · the music duck is a COMPUTED GAIN ENVELOPE — never sidechaincompress, which truncates the bed
//   · everything is normalised to one size and one loudness, and re-encoded

import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const A = process.argv.slice(2);
const has = (f) => A.includes(f);
const pos = A.filter((a) => !a.startsWith('--'));
const [slug, cutId] = pos;
if (!slug || !cutId) { console.error('usage: node scripts/build-cut.mjs <slug> <cut-id> [--dry] [--no-supers] [--ds]'); process.exit(1); }

// --ds builds the base for the EDITOR rather than a finished file: no burned supers, and an end card that is
// a plain coloured tail. Diffusion Studio then draws every super and every end-card element as a native node,
// so they can be dragged, retimed and retyped in the app. Burn them here and none of that is possible.
const DS = has('--ds');

for (const bin of ['ffmpeg', 'ffprobe']) {
  try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); }
  catch { console.error(`✗ ${bin} is required. brew install ffmpeg`); process.exit(1); }
}

const R = `briefs/${slug}/remix`;
const cutFile = `${R}/cuts/${cutId}.json`;
if (!existsSync(cutFile)) { console.error(`✗ no cut file at ${cutFile}`); process.exit(1); }
if (!existsSync(`${R}/shots.json`)) { console.error(`✗ no shot library at ${R}/shots.json — run remix.mjs first`); process.exit(1); }

const cut = JSON.parse(readFileSync(cutFile, 'utf8'));
const lib = JSON.parse(readFileSync(`${R}/shots.json`, 'utf8'));
const byName = Object.fromEntries((lib.shots || []).map((s) => [s.name, s]));

const W = 1080, H = 1920, FPS = 30;

// ── transitions: a real PAN between two frames, never a crossfade (a sub-frame xfade collapses the concat) ───
// Three kinds, and the difference is the point:
//   whip     0.18s, frame-AVERAGED — the blur comes from real motion, so it reads as a camera snap
//   slide    0.32s, clean and eased — a deliberate push, the one that suits a listicle or a step sequence
//   slideup  the same push, vertically
// Every one of them CARRIES AUDIO. A silent transition between two talking beats punches a hole in the voice.
const TRANS = {
  whip:    { dur: 0.18, blur: true,  axis: 'x', sfx: 'whoosh' },
  slide:   { dur: 0.32, blur: false, axis: 'x', sfx: 'swipe' },
  slideup: { dur: 0.32, blur: false, axis: 'y', sfx: 'swipe' },
};
const SUB = 24;
const tmp = `${R}/.build-${cutId}`;
const outDir = `${R}/out`;
const out = `${outDir}/${cutId}.mp4`;
const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args]);
const dur = (f) => { try { return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim()) || 0; } catch { return 0; } };
const hasAudio = (f) => { try { return !!execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim(); } catch { return false; } };

// ── VALIDATE before touching ffmpeg ─────────────────────────────────────────────────────────────────────────
const problems = [];
const beats = cut.beats || [];
if (!beats.length) problems.push('the cut has no beats');

beats.forEach((b, i) => {
  const names = Array.isArray(b.shot) ? b.shot : [b.shot];
  const layout = b.layout || 'full';
  const want = Number(b.seconds) || 0;
  if (!want) problems.push(`beat ${i + 1}: no seconds`);
  if (layout === 'quad' && names.length !== 4) problems.push(`beat ${i + 1}: quad needs exactly 4 shots, got ${names.length}`);
  if (layout === 'split2' && names.length !== 2) problems.push(`beat ${i + 1}: split2 needs exactly 2 shots, got ${names.length}`);
  if (layout === 'split3' && names.length !== 3) problems.push(`beat ${i + 1}: split3 needs exactly 3 shots, got ${names.length}`);
  for (const n of names) {
    const s = byName[n];
    if (!s) { problems.push(`beat ${i + 1}: unknown shot "${n}"`); continue; }
    const src = s.prepped && existsSync(s.prepped) ? s.prepped : s.file;
    if (!existsSync(src)) { problems.push(`beat ${i + 1}: missing file for "${n}"`); continue; }
    if (s.inPoint == null) { problems.push(`beat ${i + 1}: "${n}" has no inPoint — pin it on the contact sheet first`); continue; }
    // THE AVAILABILITY CEILING. Planning past it is the usual cause of a rebuild.
    const avail = (s.duration ?? dur(src)) - s.inPoint;
    if (want > avail + 0.05) {
      problems.push(`beat ${i + 1}: wants ${want}s of "${n}" but only ${avail.toFixed(2)}s is available after its in-point (${s.inPoint}s)`);
    }
  }
});

const mode = cut.audio || 'bed';
if (!['bed', 'native', 'ambient', 'vo'].includes(mode)) problems.push(`unknown audio mode "${mode}"`);
// VO: generated separately (scripts/vo.mjs) so the takes can be gated and measured before anything is built.
let voLines = null;
if (mode === 'vo') {
  const vm = `${R}/vo/${cutId}/lines.json`;
  if (!existsSync(vm)) problems.push(`audio mode "vo" but no narration at ${vm} — run: node scripts/vo.mjs ${slug} ${cutId}`);
  else {
    voLines = JSON.parse(readFileSync(vm, 'utf8')).lines || [];
    const ungated = voLines.filter((l) => String(l.verdict || '').startsWith('⛔'));
    if (ungated.length) problems.push(`${ungated.length} VO line(s) did not say what was written — re-roll before building`);
    for (const l of voLines) if (!existsSync(l.file)) problems.push(`VO audio missing: ${l.file}`);
  }
}
if (mode === 'bed' && !cut.bgm) problems.push('audio mode "bed" needs a `bgm` file — the kit does not generate music, supply a track');
if (cut.bgm && !existsSync(cut.bgm)) problems.push(`bgm not found: ${cut.bgm}`);
// A composite renders silent, so a native/ambient cut whose beats are composites has no voice to keep.
if (mode !== 'bed' && beats.every((b) => (b.layout || 'full') !== 'full')) {
  problems.push(`audio mode "${mode}" but every beat is a composite — composites are silent, so there is no source audio. Use "bed", or make some beats full-frame.`);
}

if (problems.length) {
  console.error(`\n⛔ ${cutId} is not buildable — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`   • ${p}`);
  console.error('');
  process.exit(1);
}

const totalSec = beats.reduce((a, b) => a + Number(b.seconds), 0);
console.log(`\nBUILD ${cutId} — ${cut.name || ''} · ${cut.style || 'ORGANIC'} · audio:${mode} · look:${cut.pack || 'organic'}`);
console.log(`  ${beats.length} beat(s), ${totalSec.toFixed(1)}s`);
beats.forEach((b, i) => {
  const names = Array.isArray(b.shot) ? b.shot.join('+') : b.shot;
  console.log(`   ${String(i + 1).padStart(2)}. ${String(b.seconds).padStart(4)}s  ${(b.layout || 'full').padEnd(7)} ${names}`
    + `${b.punch ? `  punch ×${b.punch}` : ''}${b.jump ? `  jump ×${(typeof b.jump === 'object' ? b.jump.scale : b.jump) || 1.25}` : ''}${TRANS[b.transition] ? `  (${b.transition} in)` : ''}${b.super ? '  +super' : ''}`);
});
// ── the two supers every cut is supposed to have ────────────────────────────────────────────────────────────
// One on the OPENING beat, because a cut whose first second says nothing is a cut nobody watches, and one on
// the CTA. This warns rather than refuses: it is an authoring rule, and there are cuts that deliberately break
// it. But a cut that broke it by accident should hear about it before it renders, not after.
{
  const hasText = (sup) => !!(sup && (sup.line1 || sup.line2));
  const opening = hasText(beats[0]?.super);
  const cta = beats.some((b) => hasText(b.super) && b.super.cta) || !!cut.endCard;
  if (!opening) console.log('  ⚠ no super on the OPENING beat — the first second is where a scroll is won or lost.');
  if (!cta) console.log('  ⚠ no CTA super and no end card — nothing tells the viewer what to do.');
  if (opening && cta) console.log('  · opening super ✓   CTA ✓');
}

if (has('--dry')) { console.log('\n  [dry] nothing built.\n'); process.exit(0); }

rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
mkdirSync(outDir, { recursive: true });

// ── look packs — loaded from styles/<pack>.json, the SAME tokens the house packs use ───────────────────────
// The look is DATA, not code: font, colours, sizes, tracking and motion all come from the pack file, so a new
// brand in an existing look is a JSON edit. `accent`/`wordmark` on the cut override the pack's own.
//
// TRACKING is the subtle one: it must be applied AND folded into the width measurement. Emit letter-spacing
// without widening the measured text and every pill comes out that much too wide.
const packId = ({ branded: 'slab', slab: 'slab', organic: 'organic' })[cut.pack || 'organic'] || 'organic';
const packPath = new URL(`../styles/${packId}.json`, import.meta.url).pathname;
if (!existsSync(packPath)) { console.error(`✗ no style pack at ${packPath}`); process.exit(1); }
const P = JSON.parse(readFileSync(packPath, 'utf8'));
const isSlab = packId === 'slab';

const hx = (c) => '0x' + String(c).replace('#', '');
const fontFile = String(P.font.file).replace(/^~/, process.env.HOME || '~');
if (!existsSync(fontFile)) {
  console.error(`\n⛔ the ${P.name} pack needs ${P.font.family}: ${fontFile}`);
  console.error(`   ${P.font.install || 'Install it, or edit styles/' + packId + '.json to point at a font you have.'}`);
  console.error('   The pack IS the look — substituting a different font is not the same ad.\n');
  process.exit(1);
}
if (isSlab && !(cut.wordmark || P.wordmark)) {
  console.log('  ⚠ the slab pack expects a `wordmark` on the cut (it carries persistent brand chrome) — continuing without it.');
}

const L = P.layout, C = P.colors, MO = P.motion || {};

// ── brand tokens, read off the brand's own site by product.mjs ──────────────────────────────────────────────
// Precedence: what the CUT says  >  what the SITE says  >  the pack's own default. So a branded cut inherits the
// real brand without anyone retyping it, and an explicit choice on the cut always wins.
const brandFile = `briefs/${slug}/brand.json`;
const BRAND = existsSync(brandFile) ? JSON.parse(readFileSync(brandFile, 'utf8')) : {};
// A colour MEASURED from a website is a guess at the brand; a colour the client has SIGNED OFF is the brand.
// RevoGLOV's site renders #84CC16 while their approved ad accent is #A8D62E — measured would have overridden
// decided. When brand.json marks an accent locked, say so, and never let a scrape quietly replace it.
if (BRAND.accentLocked && BRAND.measuredAccent && BRAND.measuredAccent !== BRAND.accent) {
  console.log(`  · accent ${BRAND.accent} is LOCKED (the site measures ${BRAND.measuredAccent} — decided beats measured)`);
}
const accentSrc = cut.accent ? 'cut' : (BRAND.accent ? 'brand.json' : 'pack');
const accent = hx(cut.accent || BRAND.accent || C.accent);
if (!cut.wordmark && BRAND.wordmark) cut.wordmark = BRAND.wordmark;
if (BRAND.dark && !C.card) C.card = BRAND.dark;
if (accentSrc === 'brand.json') console.log(`  · brand: accent ${BRAND.accent} + wordmark "${BRAND.wordmark || '—'}" from ${brandFile}`);
const SIZE = isSlab ? L.headline : L.size;
const TRACK = Number(L.tracking || 0);
const charW = isSlab ? 0.42 : 0.52;            // DIN Condensed is much narrower than CapCut Sans

const esc = (t) => String(t).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '\u2019').replace(/%/g, '\\%');

// ── supers are rendered by PIL, not drawtext ────────────────────────────────────────────────────────────────
// drawtext cannot round a corner and sizes a box by guessing at character widths; PIL measures with the font's
// own metrics, so each pill is exactly as wide as its line. Returns an overlay filter fragment, or null.
let superSeq = 0;
const superOverlay = (sup, seconds) => {
  if (!sup || has('--no-supers') || DS) return null;
  const lines = [sup.line1, sup.line2].filter(Boolean).map((t) => (isSlab ? String(t).toUpperCase() : String(t)));
  if (!lines.length) return null;
  const png = `${tmp}/sup-${++superSeq}.png`;
  const cfg = isSlab
    ? { lines, font: fontFile, size: Math.round(L.headline * 0.62), padx: 30, row: 84, ov: 0, radius: 0,
        fills: [C.panel, C.panel], ink: C.sub, bar: cut.accent || C.accent, bar_w: 8, width: W }
    : { lines, font: fontFile, size: L.size, padx: L.padx, row: L.row, ov: L.overlap, radius: L.radius,
        fills: C.line_fills || [C.fill, cut.accent || C.accent], ink: C.ink, width: W };
  let meta;
  try { meta = JSON.parse(execFileSync('python3', [new URL('./render_super.py', import.meta.url).pathname, JSON.stringify(cfg), png], { encoding: 'utf8' }).trim()); }
  catch (e) { console.error(`  ⚠ super render failed: ${String(e.message).slice(0, 160)}`); return null; }
  const y = Math.round(H * (sup.cta ? (isSlab ? L.lower_third : L.cta_top) : (isSlab ? L.lower_third : L.held)));
  return { png, y, h: meta.h, seconds };
};

// ── SFX — SYNTHESISED, never fetched from a TTS ─────────────────────────────────────────────────────────────
// Asking a speech engine for "click" or "ping" returns a 1.4-second TONE, not a UI sound. These are built from
// oscillators and noise, which is both instant and free. Each sound hangs off the SUPER that triggers it, so it
// fires exactly when the line appears and stays in sync if a transition shifts the timeline.
const SFX = {
  click: `sine=frequency=2400:duration=0.05,volume=0.35,afade=t=out:st=0.008:d=0.042`,
  pop:   `sine=frequency=820:duration=0.16,volume=0.5,afade=t=out:st=0.02:d=0.14`,
  // Two tones a fifth apart with a fast decay — one sine reads as a test tone, not as a notification.
  bell:  `sine=frequency=1568:duration=0.7,volume=0.32,afade=t=out:st=0.04:d=0.66`,
  chime: `sine=frequency=1047:duration=0.8,volume=0.30,afade=t=out:st=0.06:d=0.74`,
  whoosh:`anoisesrc=d=0.26:c=pink:a=0.5,highpass=f=700,lowpass=f=5200,volume=0.5,afade=t=in:st=0:d=0.09,afade=t=out:st=0.10:d=0.16`,
  // softer and longer than a whip's whoosh — a slide is a deliberate move, not a snap
  swipe: `anoisesrc=d=0.34:c=pink:a=0.35,highpass=f=400,lowpass=f=3800,volume=0.4,afade=t=in:st=0:d=0.14,afade=t=out:st=0.16:d=0.18`,
};
const sfxEvents = [];                       // {at, kind} — filled during assembly, mixed at the end
const sfxFile = (kind) => {
  const f = `${tmp}/sfx-${kind}.wav`;
  if (!existsSync(f)) ff(['-f', 'lavfi', '-i', SFX[kind], '-ac', '2', '-ar', '48000', f]);
  return f;
};

// ── one beat → one normalised clip ──────────────────────────────────────────────────────────────────────────
const srcOf = (n) => { const s = byName[n]; return s.prepped && existsSync(s.prepped) ? s.prepped : s.file; };
const inOf = (n) => byName[n].inPoint;

const beatFiles = [];
beats.forEach((b, i) => {
  const o = `${tmp}/beat-${String(i + 1).padStart(3, '0')}.mp4`;
  const secs = Number(b.seconds);
  const names = Array.isArray(b.shot) ? b.shot : [b.shot];
  const layout = b.layout || 'full';
  // punch-in is a STATIC reframe delivered by the cut — never an animated scale
  const punch = Number(b.punch) || 1;
  const crop = punch > 1 ? `,crop=iw/${punch}:ih/${punch},scale=${W}:${H}` : '';
  const sup = superOverlay(b.super, secs);
  // the super is a PNG laid over the picture; it fades in rather than popping
  // -loop 1 -t: a PNG is ONE frame. Fed in raw it appears for a thirtieth of a second and looks like the super
  // never rendered at all. Loop it for the beat's length so it can also be faded.
  const supIn = sup ? ['-loop', '1', '-t', String(secs), '-i', sup.png] : [];
  const supFade = sup ? `[sup]format=rgba,fade=t=in:st=0.10:d=0.16:alpha=1[supf];` : '';
  const supOver = sup ? `[supf]overlay=0:${sup.y}` : '';

  if (layout === 'full') {
    // Keep the source audio only where the point IS the source: native voices, or the action's own sound.
    // In `vo` the narration REPLACES those voices — keeping both puts two people on top of each other, which
    // reads as a broken mix and buries the narration (QA caught exactly this: 30% of the script audible).
    const keepAudio = (mode === 'native' || mode === 'ambient') && hasAudio(srcOf(names[0]));

    // ── JUMP CUT ────────────────────────────────────────────────────────────────────────────────────────────
    // A hard cut to a tighter framing on the SAME shot, landing on a word that matters. It is the cheapest way
    // to stop a talking beat feeling static, and it is a cut — not a zoom. `"jump": 1.25` takes the default
    // placement; `"jump": {"at": 1.4, "scale": 1.3}` puts it on a specific moment, which is the point: it
    // should land on the emphasis, not the midpoint.
    const J = b.jump ? (typeof b.jump === 'object' ? b.jump : { scale: Number(b.jump) }) : null;
    const jScale = J ? (Number(J.scale) || 1.25) : 1;
    // Default placement is a little past halfway — far enough in that the first framing has registered.
    const jAt = J ? Math.min(Math.max(0.4, Number(J.at ?? secs * 0.55)), secs - 0.4) : 0;
    if (J && secs < 1.2) {
      console.log(`  ⚠ beat ${i + 1}: too short (${secs}s) for a jump cut — both halves would flash. Skipping it.`);
    }
    const doJump = J && secs >= 1.2;

    const seg = (out, ss, dur, scale) => {
      const c = scale > 1 ? `,crop=iw/${scale}:ih/${scale},scale=${W}:${H}` : '';
      const vf = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}${c},fps=${FPS},setsar=1[v]`;
      const ins2 = ['-ss', String(ss), '-t', String(dur), '-i', srcOf(names[0])];
      if (keepAudio) {
        ff([...ins2, '-filter_complex', vf, '-map', '[v]', '-map', '0:a', '-c:v', 'libx264', '-crf', '18',
          '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', out]);
      } else {
        ff([...ins2, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(dur),
          '-filter_complex', vf, '-map', '[v]', '-map', '1:a', '-c:v', 'libx264', '-crf', '18',
          '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out]);
      }
    };

    // The picture first, then the super over it. Two passes rather than one, because a jump cut is two renders
    // joined — and a super overlaid on each half would fade in twice, once at the cut.
    // The picture goes to a temp file ONLY when a super pass follows it. With --ds there is no super pass, so
    // it has to land on the beat's real output — writing it to a temp and never moving it left the beat
    // missing, and the failure surfaced two stages later as a transition that could not find its own input.
    const pic = sup ? `${tmp}/pic-${String(i + 1).padStart(3, '0')}.mp4` : o;
    if (doJump) {
      const a = `${tmp}/ja-${i}.mp4`, c2 = `${tmp}/jb-${i}.mp4`;
      seg(a, inOf(names[0]), jAt, punch);
      seg(c2, inOf(names[0]) + jAt, secs - jAt, punch * jScale);
      const jl = `${tmp}/jlist-${i}.txt`;
      writeFileSync(jl, `file '${resolve(a)}'\nfile '${resolve(c2)}'\n`);
      ff(['-f', 'concat', '-safe', '0', '-i', resolve(jl), '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-ar', '48000', resolve(pic)]);
    } else {
      seg(pic, inOf(names[0]), secs, punch);
    }
    if (sup) {
      ff(['-i', pic, '-loop', '1', '-t', String(secs), '-i', sup.png,
        '-filter_complex', `[1:v]format=rgba,fade=t=in:st=0.10:d=0.16:alpha=1[supf];[0:v][supf]overlay=0:${sup.y}[v]`,
        '-map', '[v]', '-map', '0:a', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-shortest', o]);
    }
  } else {
    // COMPOSITE — silent by definition. A 2×2 of 9:16 cells is still 9:16, so nothing is cropped away.
    const cellW = layout === 'quad' ? W / 2 : W;
    const cellH = layout === 'quad' ? H / 2 : (layout === 'split2' ? H / 2 : H / 3);
    const ins = [];
    names.forEach((n) => { ins.push('-ss', String(inOf(n)), '-t', String(secs), '-i', srcOf(n)); });
    const scaled = names.map((n, k) => `[${k}:v]scale=${cellW}:${cellH}:force_original_aspect_ratio=increase,crop=${cellW}:${cellH},fps=${FPS},setsar=1[c${k}]`).join(';');
    const stack = layout === 'quad'
      ? `[c0][c1]hstack[t];[c2][c3]hstack[b];[t][b]vstack[bg]`
      : layout === 'split2' ? `[c0][c1]vstack[bg]`
      : `[c0][c1][c2]vstack=inputs=3[bg]`;
    const si = names.length;                      // the super PNG's input index, when present
    const fc = sup
      ? `${scaled};${stack};[${si}:v]null[sup];${supFade}[bg]${supOver}[v]`
      : `${scaled};${stack};[bg]null[v]`;
    const aIdx = names.length + (sup ? 1 : 0);
    ff([...ins, ...supIn, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(secs),
      '-filter_complex', fc, '-map', '[v]', '-map', `${aIdx}:a`,
      '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', o]);
  }
  beatFiles.push({ file: o, transIn: i > 0 && TRANS[b.transition] ? b.transition : null, sfx: b.sfx || null, seconds: secs });
  process.stdout.write(`\r  built beat ${i + 1}/${beats.length}   `);
});
console.log('');

// ── END CARD ────────────────────────────────────────────────────────────────────────────────────────────────
// The layout IS the taste, and it is brand-agnostic — only the tokens change:
//   · a DARK card, not a white one; everything LEFT-ALIGNED off one margin, never centred
//   · wordmark top-left, tracked out
//   · a big headline auto-fitted to the width the PRODUCT leaves, so type and product never collide
//   · body copy a step down in a muted grey
//   · a TWO-TIER CTA — a dark offer pill with accent type, then a large accent button that is the thing to tap
//   · price, then a small tracked trust line
//   · the product hero right-aligned at its TRUE ASPECT (read from the file — a fixed box squashes it)
//   · every element fades AND slides in, staggered, alternating direction so nothing arrives as a block
if (cut.endCard) {
  const E = cut.endCard;
  const secs = Number(E.seconds) || 3.0;
  const o = `${tmp}/beat-999.mp4`;
  const M = isSlab ? L.margin : 56;
  const chromeY = isSlab ? L.chrome_y : 64;
  const card = hx(C.card || C.panel || '#0B0C0B');
  const ink = hx(C.ink);
  const white = hx(C.sub || '#FFFFFF');
  const body = hx(C.body || '#C3C6C0');
  const muted = hx(C.muted || '#8E918B');
  const chip = hx(C.chip || '#1C1F1B');
  const up = (t) => (isSlab ? String(t).toUpperCase() : String(t));

  // product dimensions from the FILE — never assumed
  let prodW = 0, prodH = 0;
  const prodPath = E.product && existsSync(E.product) ? E.product : null;
  const PROD_H = Math.round(H * 0.54);
  if (prodPath) {
    try {
      const d = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', prodPath], { encoding: 'utf8' }).trim().split(',');
      prodW = Math.round(PROD_H * (Number(d[0]) / Number(d[1]))); prodH = PROD_H;
    } catch { prodW = Math.round(PROD_H * 0.42); prodH = PROD_H; }
  }
  // the headline gets the width the product leaves it
  const avail = Math.max(360, W - M - prodW - M - 24);
  const fit = (lines, max, start) => { let sz = start; while (sz > 40 && Math.max(...lines.map((t) => up(t).length)) * sz * (isSlab ? 0.42 : 0.50) > max - (L.slack ?? 28)) sz -= 2; return sz; };

  const head = [].concat(E.headline || []).filter(Boolean);
  const bodyLines = [].concat(E.body || []).filter(Boolean);
  const hs = fit(head, avail, isSlab ? L.headline : 92);
  const hrow = Math.round(hs * 1.14);
  const vn = (sz) => (isSlab ? Math.round(sz * 0.14) : 0);

  const el = [];
  const fade = (t0) => `:alpha='min(1,max(0,(t-${t0})/0.34))'`;
  const txt = (x, y, t, sz, col, t0, track = 0) =>
    `drawtext=fontfile='${fontFile}':text='${esc(up(t))}':fontcolor=${col}:fontsize=${sz}:x=${x}:y=${y}${fade(t0)}`;
  // drawbox has no `alpha` — that is a drawtext option. A box is time-gated with `enable` and its opacity
  // baked into the colour; the text on top carries the fade.
  const box = (x, y, w, h, col, t0) => `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${col}:t=fill:enable='gte(t,${t0})'`;

  if (cut.wordmark) el.push(txt(M, chromeY, cut.wordmark, 54, white, 0.10));
  let y = Math.round(H * 0.27);
  head.forEach((t, i) => { el.push(txt(M, y + i * hrow + vn(hs), t, hs, white, 0.20 + i * 0.12)); });
  y += hrow * head.length + 34;
  bodyLines.forEach((t, i) => { el.push(txt(M, y + i * 50 + vn(38), t, 38, body, 0.46 + i * 0.08)); });
  y += 50 * bodyLines.length + (bodyLines.length ? 40 : 0);

  // secondary — the offer, as a dark pill with accent type
  if (E.offer) {
    const sz = 40, w = Math.round(up(E.offer).length * sz * (isSlab ? 0.44 : 0.52)) + 68;
    el.push(box(M, y, w, 74, `${chip}@0.98`, 0.62));
    el.push(txt(M + 34, y + Math.round((74 - sz) / 2) + vn(sz), E.offer, sz, accent, 0.62));
    y += 96;
  }
  // primary — the thing to tap
  // Not every font carries an arrow — DIN Condensed renders '→' as a missing-glyph box. Default to plain text
  // and warn rather than silently printing a tofu square in the primary CTA.
  const btnTxt = E.button || (P.button && P.button.text) || 'Shop now';
  const nonAscii = [...String(btnTxt)].filter((ch) => ch.codePointAt(0) > 0x2019);
  if (nonAscii.length) {
    console.log(`  ⚠ button text contains ${nonAscii.map((c) => JSON.stringify(c)).join(', ')} — `
      + `${P.font.family} may not have that glyph (it renders as an empty box). Check the frame, or use plain text.`);
  }
  const bs = isSlab ? 52 : (P.button?.size ?? 52);
  const bw = Math.round(up(btnTxt).length * bs * (isSlab ? 0.44 : 0.52)) + 110;
  el.push(box(M, y, bw, 104, `${accent}@0.98`, 0.74));
  el.push(txt(M + 55, y + Math.round((104 - bs) / 2) + vn(bs), btnTxt, bs, ink, 0.74));
  y += 128;
  if (E.price) { el.push(txt(M, y + vn(36), E.price, 36, white, 0.86)); y += 48; }
  if (E.trust) el.push(txt(M, y + vn(29), E.trust, 29, muted, 0.94));

  const ins = ['-f', 'lavfi', '-i', `color=c=${card}:s=${W}x${H}:d=${secs}:r=${FPS}`];
  if (DS) {
    // just the card ground. Its type and its product hero are nodes in the dapi project, laid over this tail —
    // which still has to EXIST here so the music bed and the loudness pass cover it.
    ff([...ins, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(secs),
      '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', o]);
  } else if (prodPath) {
    ins.push('-i', prodPath);
    const px = W - M - prodW, py = Math.round(H * 0.30);
    ff([...ins, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(secs),
      '-filter_complex', `[1:v]scale=${prodW}:${prodH}[pr];[0:v][pr]overlay=${px}:${py}:enable='gte(t,0.28)'[bgp];[bgp]${el.join(',')}[v]`,
      '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', o]);
  } else {
    ff([...ins, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(secs),
      '-vf', el.join(','), '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', o]);
  }
  beatFiles.push({ file: o, transIn: null, sfx: E.sfx || 'bell', seconds: secs });
  console.log(`  built end card (${secs}s · headline ${hs}px in ${avail}px${prodPath ? ` · product ${prodW}x${prodH}` : ''})`);
}

// (transitions are declared near the top — the plan print and the beat clock both read them)

const seq = [];
const startAt = [];                             // each beat's position on the FINISHED timeline (whips included)
let clock = 0;                                  // running timeline position, so every SFX lands where its super does
for (let i = 0; i < beatFiles.length; i++) {
  const b = beatFiles[i];
  const T = b.transIn ? TRANS[b.transIn] : null;
  if (T) {
    sfxEvents.push({ at: clock, kind: T.sfx });     // every transition gets its own sound, automatically
    clock += T.dur;
  }
  startAt[i] = clock;
  if (b.sfx && SFX[b.sfx]) sfxEvents.push({ at: clock + 0.10, kind: b.sfx });   // hangs off the super's entrance
  clock += b.seconds;
  if (T) {
    const prev = beatFiles[i - 1].file;
    const w = `${tmp}/trans-${String(i).padStart(3, '0')}.mp4`;
    const a = `${tmp}/wa-${i}.png`, c = `${tmp}/wb-${i}.png`;
    ff(['-sseof', '-0.06', '-i', prev, '-frames:v', '1', a]);
    ff(['-i', b.file, '-frames:v', '1', c]);
    const vert = T.axis === 'y';
    const stack = vert ? 'vstack' : 'hstack';
    // Position along the pan. A whip is linear — it is meant to feel thrown. A slide is eased out, because a
    // linear push reads as a slideshow wipe rather than a move somebody made.
    const p = `min(1,max(0,(t/${T.dur})))`;
    const prog = T.blur ? p : `(1-pow(1-${p},3))`;
    const crop = vert ? `crop=${W}:${H}:0:'(ih-${H})*${prog}'` : `crop=${W}:${H}:'(iw-${W})*${prog}':0`;
    // The blur comes from averaging real sub-frames of the motion, not from an opacity blend.
    const chain = T.blur
      ? `[0:v][1:v]${stack}[s];[s]fps=${FPS * SUB},${crop},tmix=frames=${SUB},fps=${FPS},setsar=1[v]`
      : `[0:v][1:v]${stack}[s];[s]fps=${FPS},${crop},setsar=1[v]`;
    ff(['-loop', '1', '-t', String(T.dur), '-i', a, '-loop', '1', '-t', String(T.dur), '-i', c,
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(T.dur),
      '-filter_complex', chain,
      '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', w]);
    seq.push(w);
  }
  seq.push(b.file);
}

// ── concat (re-encoded; stream-copy glitches at every join) ─────────────────────────────────────────────────
// Absolute paths throughout — relative entries resolve against ffmpeg's cwd, not the list's directory, which
// is a silent "No such file" the moment the build runs from anywhere but the temp dir. -safe 0 permits them.
const list = `${tmp}/list.txt`;
writeFileSync(list, seq.map((f) => `file '${resolve(f).replace(/'/g, "'\\''")}'`).join('\n') + '\n');
const picture = `${tmp}/picture.mp4`;
ff(['-f', 'concat', '-safe', '0', '-i', resolve(list), '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',
  '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', resolve(picture)]);

// ── audio ───────────────────────────────────────────────────────────────────────────────────────────────────
const vlen = dur(picture);
if (!cut.bgm) {
  ff(['-i', picture, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', '48000', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]);
} else {
  // Bed level by mode. Under voices the music sits well down — and the duck is a fixed level here, computed,
  // never sidechaincompress (which truncates the bed to a different length every run).
  const bedDb = mode === 'bed' ? -16 : (mode === 'native' || mode === 'vo' ? -34 : -28);
  const fc = `[1:a]aloop=loop=-1:size=2e9,atrim=0:${vlen},volume=${bedDb}dB,afade=t=out:st=${Math.max(0, vlen - 0.6)}:d=0.6[bed];`
    + (mode === 'bed'
      ? `[bed]loudnorm=I=-14:TP=-1.5:LRA=11[a]`
      : `[0:a][bed]amix=inputs=2:duration=first:dropout_transition=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]`);
  ff(['-i', picture, '-i', cut.bgm, '-filter_complex', fc, '-map', '0:v', '-map', '[a]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]);
}

// ── VO over the top ─────────────────────────────────────────────────────────────────────────────────────────
// Each line starts at its beat's start time. The music duck is a COMPUTED GAIN ENVELOPE over the known line
// spans — never sidechaincompress, which truncates the bed (it emitted 9.8s of a 12.6s track, a different
// length every run, with both inputs padded).
if (mode === 'vo' && voLines && voLines.length) {
  // A beat is where a line WANTS to start; it is not permission to talk over the previous line. A line that
  // overruns its beat pushes the next one later — narration is continuous, the beats are only visual anchors.
  // Without this, consecutive lines overlap and two voices play at once (QA measured 50% of the script audible).
  // The whip belongs BEFORE the beat it introduces, so it is added to the running clock ahead of that beat.
  const starts = [];
  let t = 0;
  const beatStart = beats.map((b, i) => { const T = beatFiles[i]?.transIn; if (T) t += TRANS[T].dur; const s0 = t; t += Number(b.seconds); return s0; });
  const ins = [];
  const parts = [];
  let prevEnd = 0;
  voLines.forEach((l, k) => {
    const bi = Math.max(0, Math.min(beats.length - 1, (l.beat ?? k + 1) - 1));
    const at = Math.max(beatStart[bi], prevEnd + 0.12);      // never start before the previous line has finished
    prevEnd = at + l.seconds;
    starts.push({ at, end: prevEnd });
    ins.push('-i', l.file);
    parts.push(`[${k + 1}:a]adelay=${Math.round(at * 1000)}|${Math.round(at * 1000)},apad[v${k}]`);
  });
  const vidLen = dur(out);
  if (prevEnd > vidLen + 0.1) {
    console.log(`  ⚠ narration runs ${prevEnd.toFixed(1)}s but the picture is ${vidLen.toFixed(1)}s — the tail will be cut.`);
    console.log('    Lengthen a beat or shorten a line; do not speed the read up.');
  }
  const mixIns = voLines.map((_, k) => `[v${k}]`).join('');
  // duck the existing track wherever a line is speaking
  const duck = starts.map((s) => `volume=enable='between(t,${(s.at - 0.15).toFixed(2)},${(s.end + 0.25).toFixed(2)})':volume=0.28`).join(',');
  const withVo = `${tmp}/withvo.mp4`;
  // normalize=0: amix otherwise divides every input by the input COUNT, so each narration line arrives at a
  // fraction of its level and the voice disappears under the bed. Levels are set deliberately instead.
  const fc = `${parts.join(';')};[0:a]${duck}[ducked];[ducked]${mixIns}`
    + `amix=inputs=${voLines.length + 1}:duration=first:dropout_transition=0:normalize=0,`
    + `alimiter=limit=0.95,loudnorm=I=-14:TP=-1.5:LRA=11[a]`;
  ff(['-i', out, ...ins, '-filter_complex', fc,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', withVo]);
  execFileSync('mv', [withVo, out]);
  const over = starts.filter((s, i) => s.end > beatStart[Math.min(beats.length - 1, (voLines[i].beat ?? i + 1))] + 0.4);
  if (over.length) console.log(`  · ${over.length} line(s) overrun their beat — that is fine and preferred; never stretch a beat to fit a line.`);
}

// ── mix the SFX in last, so they sit on top of bed and voice alike ──────────────────────────────────────────
if (sfxEvents.length) {
  const ins = [];
  const parts = [];
  sfxEvents.forEach((e, k) => {
    ins.push('-i', sfxFile(e.kind));
    parts.push(`[${k + 1}:a]adelay=${Math.round(e.at * 1000)}|${Math.round(e.at * 1000)}[s${k}]`);
  });
  const mix = sfxEvents.map((_, k) => `[s${k}]`).join('');
  const withSfx = `${tmp}/withsfx.mp4`;
  ff(['-i', out, ...ins, '-filter_complex',
    `${parts.join(';')};[0:a]${mix}amix=inputs=${sfxEvents.length + 1}:duration=first:dropout_transition=0,`
    + `alimiter=limit=0.95,loudnorm=I=-14:TP=-1.5:LRA=11[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', withSfx]);
  execFileSync('mv', [withSfx, out]);
  const counts = sfxEvents.reduce((m, e) => ({ ...m, [e.kind]: (m[e.kind] || 0) + 1 }), {});
  console.log(`  sfx: ${Object.entries(counts).map(([k, n]) => `${n}×${k}`).join(' · ')}`);
}

// ── the EDIT MANIFEST — what the editor needs that the video itself cannot carry ────────────────────────────
// Once the picture is flat, the timing of every super is gone. This records each one against the FINISHED
// timeline (whips included, which is why it is written from the same clock the SFX use), so the dapi project
// can place native nodes at exactly the moments the cut was designed around.
const editManifest = {
  cut: cutId,
  name: cut.name || cutId,
  base: resolve(out),
  pack: cut.pack || 'organic',
  accent: cut.accent || BRAND.accent || C.accent,
  wordmark: cut.wordmark || BRAND.wordmark || null,
  audio: mode,
  // If the supers are burned into the picture, say so loudly — drawing them again in the editor would print
  // every line twice, and that is not obvious until the export comes back.
  supersBurned: !DS && !has('--no-supers'),
  supers: beats.map((b, i) => (b.super && (b.super.line1 || b.super.line2)
    ? { line1: b.super.line1 || null, line2: b.super.line2 || null, cta: !!b.super.cta,
        t: [Number(startAt[i].toFixed(3)), Number((startAt[i] + Number(b.seconds)).toFixed(3))] }
    : null)).filter(Boolean),
  endcard: cut.endCard
    ? { t: [Number(startAt[beats.length].toFixed(3)),
            Number((startAt[beats.length] + (Number(cut.endCard.seconds) || 3.0)).toFixed(3))],
        headline: [].concat(cut.endCard.headline || []).filter(Boolean),
        body: [].concat(cut.endCard.body || []).filter(Boolean),
        offer: cut.endCard.offer || null,
        button: cut.endCard.button || null,
        price: cut.endCard.price || null,
        trust: cut.endCard.trust || null,
        product: cut.endCard.product && existsSync(cut.endCard.product) ? resolve(cut.endCard.product) : null }
    : null,
};
writeFileSync(`${outDir}/${cutId}.edit.json`, JSON.stringify(editManifest, null, 2));

rmSync(tmp, { recursive: true, force: true });
const fin = dur(out);
console.log(`\n✓ ${out}  —  ${fin.toFixed(1)}s`);
const expected = totalSec + beatFiles.reduce((a, b) => a + (b.transIn ? TRANS[b.transIn].dur : 0), 0) + (cut.endCard ? (Number(cut.endCard.seconds) || 2.5) : 0);
if (Math.abs(fin - expected) > 0.6) {
  console.log(`  ⚠ expected ~${expected.toFixed(1)}s (beats + whips + end card) — check for a truncated shot.`);
}
console.log(`  one loudness · re-encoded joins · ${DS ? 'supers as EDITABLE NODES' : has('--no-supers') ? 'supers OFF' : 'supers burned'} · ${mode} audio\n`);
if (DS) {
  console.log(`  edit it:  node scripts/ds-build.mjs ${slug} ${cutId}            (the house edit)`);
  console.log(`            node scripts/ds-build.mjs ${slug} ${cutId} --vox      (the explainer look)\n`);
} else {
  console.log(`  QA it:  node scripts/qa.mjs ${slug} ${cutId} --file ${out}`);
  console.log(`  To edit this in Diffusion Studio instead, rebuild with --ds (supers stay editable).\n`);
}
