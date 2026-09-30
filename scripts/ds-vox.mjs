#!/usr/bin/env node
// ds-vox.mjs — the VOX EDIT option: an explainer motion-graphics re-cut of a finished video, in Diffusion Studio.
//
//   node scripts/ds-vox.mjs <slug> <cut-id> [--captions] [--open]
//   (or:  node scripts/ds-build.mjs <slug> <cut-id> --vox)
//
// Reads  briefs/<slug>/remix/out/<cut-id>.edit.json   (the base video — build-cut.mjs --ds)
//        briefs/<slug>/remix/cuts/<cut-id>.vox.json   (the WINDOW PLAN — what the edit shows, second by second)
// Writes briefs/<slug>/edit/<cut-id>-vox/
//
// WHAT THE LOOK IS. The default edit (ds-build.mjs) lays supers over a video. This one keeps cutting AWAY from
// the video: the same voice runs underneath while the frame moves between the talking head, full-screen paper
// cards, a split, a lower-third face band, and the speaker shrunk onto the card. That is the whole format —
// the rhythm of layout changes, roughly every 1.6-2.1s, is what makes it read as an explainer.
//
// THE WINDOW PLAN is authored, not inferred, because which line deserves a card is a judgement about the
// script. Every window declares a mode:
//   A  full A-roll                         — keep several, or it stops reading as a person talking
//   F  full paper card, voice only
//   S  split: card on top, A-roll below
//   P  card with the speaker as a lower-third face BAND underneath
//   G  the speaker cut out and shrunk onto the card
// {"windows":[{"t":[0,1.8],"mode":"A"},
//             {"t":[1.8,4.0],"mode":"F","card":{"kind":"stamp","lines":["IT'S LEGAL.","IT'S REGULATED."]}},
//             {"t":[4.0,7.2],"mode":"P","card":{"kind":"checklist","title":"THREE THINGS","items":["a","b","c"]}},
//             {"t":[7.2,9.4],"mode":"S","card":{"kind":"counter","number":"10,000","label":"procedures"}},
//             {"t":[9.4,12.0],"mode":"G","card":{"kind":"page","lines":["...","..."]}}],
//  "punch":[{"t":[3.0,4.0],"scale":1.15}], "facePct":0.42}
//
// CROPS ARE BAKED, NOT MASKED. dapi's <rect mask> does not clip a video, so the band and the split are real
// cropped files cut with ffmpeg and placed as their own clips — encoded WITHOUT audio, or the voice plays twice.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { W, H, measure, fitSize, vnudge, rect, text, image, video, fadeIn, blurIn, slide, captionNodes, expand }
  from '../lib/ds-nodes.mjs';

const A = process.argv.slice(2);
const has = (f) => A.includes(f);
const pos = A.filter((a) => !a.startsWith('--'));
const [slug, cutId] = pos;
if (!slug || !cutId) { console.error('usage: node scripts/ds-vox.mjs <slug> <cut-id> [--captions] [--open]'); process.exit(1); }

const editFile = `briefs/${slug}/remix/out/${cutId}.edit.json`;
const voxFile = `briefs/${slug}/remix/cuts/${cutId}.vox.json`;   // authored input, so it lives with the cut
if (!existsSync(editFile)) {
  console.error(`\n⛔ no edit manifest at ${editFile}`);
  console.error(`   Build the base for the editor first:  node scripts/build-cut.mjs ${slug} ${cutId} --ds\n`);
  process.exit(1);
}
const M = JSON.parse(readFileSync(editFile, 'utf8'));
if (!existsSync(M.base)) { console.error(`✗ base video missing: ${M.base}`); process.exit(1); }

if (!existsSync(voxFile)) {
  console.error(`\n⛔ the Vox edit needs a WINDOW PLAN at ${voxFile} — and it has to be authored, not guessed.`);
  console.error('   Which line earns a card, and which stays on the speaker, is a judgement about the script.');
  console.error('   Write one window per beat of the voice. The shape is at the top of this file; the shortest');
  console.error('   useful plan is:\n');
  console.error('     {"windows":[{"t":[0,2.0],"mode":"A"},');
  console.error('                 {"t":[2.0,5.0],"mode":"F","card":{"kind":"stamp","lines":["ONE LINE"]}},');
  console.error('                 {"t":[5.0,8.0],"mode":"A"}]}\n');
  process.exit(1);
}
const V = JSON.parse(readFileSync(voxFile, 'utf8'));
const windows = V.windows || [];
if (!windows.length) { console.error('⛔ the window plan has no windows.'); process.exit(1); }

// ── the pack ────────────────────────────────────────────────────────────────────────────────────────────────
const P = JSON.parse(readFileSync(new URL('../styles/vox.json', import.meta.url).pathname, 'utf8'));
const L = P.layout, C = P.colors;
const FACES = { label: P.font, serif: P.serif, hand: P.hand };
for (const [role, f] of Object.entries(FACES)) {
  if (!existsSync(expand(f.file))) {
    console.error(`\n⛔ the vox pack needs ${f.family} (${role}) at ${expand(f.file)}`);
    console.error(`   ${f.install}`);
    console.error('   dapi renders by font NAME, so it has to be installed for the app, not just measured here.\n');
    process.exit(1);
  }
}
const LABEL = P.font.family, LABEL_F = expand(P.font.file);
const SERIF = P.serif.family, SERIF_F = expand(P.serif.file);
const HAND = P.hand.family, HAND_F = expand(P.hand.file);
// The brand's accent normally wins — this is an ad, not an art piece. But this look puts its accent on PAPER,
// and a pale brand colour (a lime, a pastel) simply disappears there: the checklist title rendered invisible
// the first time. So the brand accent is used when it can be seen against the paper, and the pack's own is
// used when it cannot — and we say which, rather than quietly shipping an unreadable card.
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(String(hex).replace('#', '').slice(i - 1, i + 1), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const wanted = V.accent || M.accent || C.accent;
const RED = contrast(wanted, C.paper) >= 3 ? wanted : C.accent;
if (RED !== wanted) {
  console.log(`  · ${wanted} is too pale on paper (contrast ${contrast(wanted, C.paper).toFixed(1)}:1) — using the`);
  console.log(`    look's own ${C.accent} for marks and labels so they can actually be read.`);
}
const MARGIN = L.margin;
const FACE_PCT = Number(V.facePct ?? L.face_pct);

const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args]);
// x264 refuses an odd width or height, and it says so as a wall of encoder noise rather than a clear error.
// Every baked crop goes through this.
const even = (v) => Math.max(2, Math.round(v / 2) * 2);
// Measure the scene by the VIDEO track, frame-snapped — NOT by `format=duration`. An encode's audio commonly
// runs a frame or two past its last video frame, and format=duration reports the longer of the two; declare
// that and dapi schedules a span with no picture in it, which `check` reports as black frames at the tail.
const dur = (f) => {
  const raw = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim();
  const v = Number(raw) || Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim()) || 0;
  return Math.floor(v * 30 + 1e-6) / 30;
};

// ── project ─────────────────────────────────────────────────────────────────────────────────────────────────
const proj = resolve(`briefs/${slug}/edit/${cutId}-vox`);
mkdirSync(`${proj}/assets/tex`, { recursive: true });
mkdirSync(`${proj}/assets/sfx`, { recursive: true });

const h = createHash('md5');
h.update(readFileSync(M.base));
h.update(JSON.stringify([V, RED, has('--captions')]));
h.update(readFileSync(new URL(import.meta.url).pathname));
const tag = h.digest('hex').slice(0, 8);

// Every baked asset carries the build's tag. Sweep the ones from an older tag: left behind they are dead
// weight, and a later read of the folder cannot tell which belongs to the current project.
const TAGGED = /^(base|band|split|inset|punch)_/;
for (const old of readdirSync(`${proj}/assets`)) {
  if (TAGGED.test(old) && !old.includes(tag.slice(0, 4)) && !old.includes(tag)) {
    rmSync(`${proj}/assets/${old}`, { recursive: true, force: true });
  }
}
const local = `${proj}/assets/base_${tag}.mp4`;
if (!existsSync(local)) copyFileSync(M.base, local);
const TOTAL = dur(local);

const last = windows[windows.length - 1].t[1];
if (last > TOTAL + 0.5) {
  console.error(`\n⛔ the plan runs to ${last.toFixed(1)}s but the video is ${TOTAL.toFixed(1)}s.`);
  console.error('   Trim the plan, or lengthen the cut — a window past the end renders as a frozen card.\n');
  process.exit(1);
}
// A plan that never returns to the speaker stops being an explainer and becomes a slideshow with a voiceover.
const aTime = windows.filter((w) => (w.mode || 'A') === 'A').reduce((a, w) => a + (w.t[1] - w.t[0]), 0);
if (aTime < TOTAL * 0.18) {
  console.log(`  ⚠ only ${(aTime / TOTAL * 100).toFixed(0)}% of the cut stays on the speaker. Keep some full`);
  console.log('    A-roll windows — a wall of cards reads as a slideshow, not an explainer.');
}

// ── paper grounds (generated, deterministic) ────────────────────────────────────────────────────────────────
if (!existsSync(`${proj}/assets/tex/paper_cream.jpg`)) {
  try { execFileSync('python3', [new URL('./make_paper.py', import.meta.url).pathname, `${proj}/assets/tex`], { stdio: 'ignore' }); }
  catch { console.error('⛔ could not generate the paper grounds (needs python3 + Pillow: pip3 install pillow)'); process.exit(1); }
}
const PAPER = ['paper_cream', 'paper_grid', 'paper_kraft'];

// ── foley, synthesised ──────────────────────────────────────────────────────────────────────────────────────
// Asking a speech engine for "paper rustle" returns a spoken phrase; asking for "stamp" returns a tone. These
// are oscillators and filtered noise, which is instant, free, and ships nothing that belongs to anyone.
// Deliberately NO tonal pings — the plink/bell kit was tried on this format and rejected.
const FOLEY = {
  rustle: 'anoisesrc=d=0.42:c=pink:a=0.55,highpass=f=1400,lowpass=f=8000,volume=0.45,afade=t=in:st=0:d=0.05,afade=t=out:st=0.14:d=0.28',
  stamp:  'anoisesrc=d=0.22:c=brown:a=0.9,lowpass=f=900,volume=0.85,afade=t=out:st=0.03:d=0.19',
  tick:   'anoisesrc=d=0.10:c=white:a=0.5,highpass=f=2600,lowpass=f=9000,volume=0.5,afade=t=out:st=0.01:d=0.09',
  whoosh: 'anoisesrc=d=0.34:c=pink:a=0.6,highpass=f=500,lowpass=f=5000,volume=0.5,afade=t=in:st=0:d=0.12,afade=t=out:st=0.14:d=0.20',
};
const foleyFile = (kind) => {
  const f = `${proj}/assets/sfx/${kind}.wav`;
  if (!existsSync(f)) ff(['-f', 'lavfi', '-i', FOLEY[kind], '-ac', '2', '-ar', '48000', f]);
  return `assets/sfx/${kind}.wav`;
};

// ── baked crops ─────────────────────────────────────────────────────────────────────────────────────────────
// -an on every one: these sit on top of the base clip, which already carries the voice.
const bake = (name, t0, t1, vf) => {
  const rel = `assets/${name}.mp4`;
  const abs = `${proj}/${rel}`;
  if (!existsSync(abs)) {
    ff(['-ss', String(t0), '-t', String(Math.max(0.1, t1 - t0)), '-i', local, '-an', '-vf', `${vf},fps=30,setsar=1`,
      '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
      '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-movflags', '+faststart', abs]);
  }
  return rel;
};

// The band keeps the face at ~1.3x inside a 1080x640 strip; the split keeps it a little under half way down a
// 1080x960 one. Both are derived from where the face sits in the frame, which the plan states (facePct).
const bandCrop = () => {
  const ch = even(492), cw = even(831);
  const cy = Math.min(Math.max(0, Math.round(H * FACE_PCT - ch * 0.46)), H - ch);
  const cx = Math.round((W - cw) / 2);
  return `crop=${cw}:${ch}:${cx}:${cy},scale=${W}:${L.band_h}`;
};
const splitCrop = () => {
  const cy = Math.min(Math.max(0, Math.round(H * FACE_PCT - L.split_h * 0.47)), H - L.split_h);
  return `crop=${W}:${L.split_h}:0:${cy}`;
};

// ── the cutout (G) ──────────────────────────────────────────────────────────────────────────────────────────
// rembg gives a real matte. Without it, the speaker goes onto the card as a framed INSET instead — which is a
// device this style already uses, so the fallback is a different shot, not a broken one. Never silently.
const hasRembg = (() => {
  const r = spawnSync('python3', ['-c', 'import rembg'], { stdio: 'ignore' });
  return r.status === 0;
})();
let warnedCutout = false;

// ── cards ───────────────────────────────────────────────────────────────────────────────────────────────────
const paperFor = (i) => `assets/tex/${PAPER[i % PAPER.length]}.jpg`;
const ease = P.motion.ease, FADE = P.motion.fade, STAG = P.motion.stagger;

function cardNodes(card, i, t0, t1, box) {
  // box = {x, y, w, h} the card's type may occupy
  if (!card) return [];
  const out = [];
  const kind = card.kind || 'page';
  const cx = box.x + box.w / 2;

  if (kind === 'page' || kind === 'stamp') {
    const lines = [].concat(card.lines || []).filter(Boolean).map((t) => (kind === 'stamp' ? String(t).toUpperCase() : String(t)));
    const font = kind === 'stamp' ? LABEL : SERIF;
    const file = kind === 'stamp' ? LABEL_F : SERIF_F;
    const size = fitSize(lines, box.w - 40, Math.min(L.headline, Math.round(box.h / (lines.length + 0.6))), file);
    // A stamp carries a rule under each line, so it needs looser leading than a plain page — at 1.22x there is
    // simply nowhere for the rule to go and it lands across the descenders.
    const row = Math.round(size * (kind === 'stamp' ? 1.55 : 1.22));
    // The text node is nudged DOWN inside its box (dapi centres on the EM box, and caps sit above that
    // centre), so the rule has to be measured from the nudged position — not from the box. Measuring from the
    // box is what kept putting the rule through the descenders.
    const nudge = vnudge(size, kind === 'stamp' ? 0.12 : 0.04);
    let y = Math.round(box.y + (box.h - row * lines.length) / 2);
    lines.forEach((ln, k) => {
      const ts = Math.min(t0 + k * STAG, t1 - 0.3);
      out.push(text({ x: box.x, y: y + k * row + nudge, w: box.w, h: row,
        body: ln, size, color: kind === 'stamp' ? C.ink : C.ink, font, id: `c${i}l${k}`, t0: ts, t1,
        children: fadeIn(FADE) + slide('y', y + k * row + 26, y + k * row, { dur: ease * 0.5, id: `c${i}y${k}` }) }));
      if (kind === 'stamp') {
        const w = Math.min(box.w, measure([ln], file, size)[0] + 24);
        // In the GAP the looser leading opens up: clear of the descenders above and of the line below.
        out.push(rect({ x: cx - w / 2, y: y + k * row + nudge + Math.round(size * 1.18), w, h: Math.max(6, Math.round(size * 0.09)), fill: RED, id: `c${i}r${k}`,
          t0: ts + 0.08, t1, children: fadeIn(0.16) + slide('width', 0, w, { dur: 0.34, id: `c${i}w${k}` }) }));
      }
    });
    return out;
  }

  if (kind === 'checklist') {
    const items = [].concat(card.items || []).filter(Boolean);
    if (card.title) {
      out.push(text({ x: box.x, y: box.y + vnudge(L.label, 0.12), w: box.w, h: Math.round(L.label * 1.4),
        body: String(card.title).toUpperCase(), size: L.label, color: RED, font: LABEL, id: `c${i}t`,
        t0, t1, tracking: 3, children: fadeIn(FADE) }));
    }
    const top = box.y + (card.title ? Math.round(L.label * 1.9) : 0);
    const size = fitSize(items, box.w - 110, Math.min(64, Math.round((box.h - (top - box.y)) / (items.length + 0.4))), SERIF_F);
    const row = Math.round(size * 1.62);
    items.forEach((it, k) => {
      const ts = Math.min(t0 + 0.25 + k * (STAG * 1.6), t1 - 0.3);
      const y = top + k * row;
      out.push(text({ x: box.x, y: y + vnudge(size, 0.06), w: 70, h: row, body: '✓', size: Math.round(size * 1.05),
        color: RED, font: LABEL, id: `c${i}k${k}`, t0: ts + 0.14, t1, align: 'left', children: fadeIn(0.18) }));
      out.push(text({ x: box.x + 88, y: y + vnudge(size, 0.04), w: box.w - 88, h: row, body: it, size,
        color: C.ink, font: SERIF, id: `c${i}i${k}`, t0: ts, t1, align: 'left',
        children: fadeIn(FADE) + slide('x', box.x + 88 - 30, box.x + 88, { dur: 0.36, id: `c${i}x${k}` }) }));
    });
    return out;
  }

  if (kind === 'counter') {
    const num = String(card.number || '');
    const size = fitSize([num], box.w - 40, Math.min(240, Math.round(box.h * 0.55)), SERIF_F);
    const y = Math.round(box.y + box.h * 0.22);
    out.push(text({ x: box.x, y, w: box.w, h: Math.round(size * 1.2), body: num, size, color: C.ink, font: SERIF,
      id: `c${i}n`, t0, t1, children: fadeIn(FADE) + slide('y', y + 34, y, { dur: ease * 0.6, id: `c${i}ny` }) }));
    if (card.label) {
      const ly = y + Math.round(size * 1.24);
      out.push(rect({ x: cx - 90, y: ly - 22, w: 180, h: 8, fill: RED, id: `c${i}b`, t0: t0 + 0.18, t1,
        children: fadeIn(0.16) + slide('width', 0, 180, { dur: 0.32, id: `c${i}bw` }) }));
      out.push(text({ x: box.x, y: ly + vnudge(L.label, 0.12), w: box.w, h: Math.round(L.label * 1.5),
        body: String(card.label).toUpperCase(), size: L.label, color: C.sub, font: LABEL, id: `c${i}lb`,
        t0: t0 + 0.24, t1, tracking: 4, children: fadeIn(FADE) }));
    }
    return out;
  }

  if (kind === 'tag') {
    const body = String(card.text || '');
    const size = Math.min(72, L.headline);
    const w = Math.min(box.w, measure([body], SERIF_F, size)[0] + 96);
    const rh = Math.round(size * 1.7);
    const x = cx - w / 2, y = Math.round(box.y + (box.h - rh) / 2);
    out.push(rect({ x, y, w, h: rh, fill: RED, id: `c${i}tg`, t0, t1,
      children: fadeIn(0.18) + slide('x', x - 60, x, { dur: 0.36, id: `c${i}tx` }) }));
    out.push(text({ x, y: y + vnudge(size, 0.04), w, h: rh, body, size, color: C.white, font: SERIF,
      id: `c${i}tt`, t0: t0 + 0.04, t1, children: fadeIn(0.18) + slide('x', x - 60, x, { dur: 0.36, id: `c${i}ty` }) }));
    return out;
  }

  console.log(`  ⚠ window ${i + 1}: unknown card kind "${kind}" — drawn as a page.`);
  return cardNodes({ ...card, kind: 'page', lines: card.lines || [card.text] }, i, t0, t1, box);
}

// ── build the timeline ──────────────────────────────────────────────────────────────────────────────────────
const gfx = [];          // everything laid over the A-roll
const audio = [];        // foley nodes
const capWindows = [];   // mode per span, so captions can dodge whatever is on screen

windows.forEach((w, i) => {
  const mode = w.mode || 'A';
  const t0 = w.t[0], t1 = Math.min(w.t[1], TOTAL);
  if (t1 <= t0) return;
  capWindows.push({ t: [t0, t1], mode });
  if (mode === 'A') return;                                   // the base shows through untouched

  const pap = paperFor(i);
  const enter = fadeIn(FADE);

  if (mode === 'F' || mode === 'G' || mode === 'P') {
    gfx.push(image({ src: pap, x: 0, y: 0, w: W, h: H, id: `pg${i}`, t0, t1, children: enter }));
  } else if (mode === 'S') {
    gfx.push(image({ src: pap, x: 0, y: 0, w: W, h: H - L.split_h, id: `pg${i}`, t0, t1, children: enter }));
  }

  // the picture that survives the window
  if (mode === 'S') {
    const src = bake(`split_${i}_${tag.slice(0, 4)}`, t0, t1, splitCrop());
    gfx.push(video({ src, x: 0, y: H - L.split_h, w: W, h: L.split_h, id: `sp${i}`, t0, t1, sourceIn: 0 }));
  } else if (mode === 'P') {
    const src = bake(`band_${i}_${tag.slice(0, 4)}`, t0, t1, bandCrop());
    gfx.push(video({ src, x: 0, y: H - L.band_h, w: W, h: L.band_h, id: `bd${i}`, t0, t1, sourceIn: 0,
      children: slide('y', H, H - L.band_h, { dur: 0.42, id: `bdy${i}` }) }));
  } else if (mode === 'G') {
    if (hasRembg) {
      const frames = `${proj}/assets/cut${i}`;
      if (!existsSync(frames)) {
        mkdirSync(frames, { recursive: true });
        ff(['-ss', String(t0), '-t', String(t1 - t0), '-i', local, '-vf', 'fps=30,scale=720:-2', `${frames}/f_%05d.png`]);
        const r = spawnSync('python3', [new URL('./matte.py', import.meta.url).pathname, frames], { stdio: 'inherit' });
        if (r.status !== 0) { console.log(`  ⚠ matte failed for window ${i + 1} — using the framed inset instead.`); rmSync(frames, { recursive: true, force: true }); }
      }
      if (existsSync(frames)) {
        const cw = Math.round(W * 0.66), ch = Math.round(H * 0.66);
        gfx.push(video({ src: `assets/cut${i}`, x: Math.round((W - cw) / 2), y: H - ch, w: cw, h: ch,
          id: `ct${i}`, t0, t1, sourceIn: 0, children: slide('y', H - ch + 40, H - ch, { dur: 0.5, id: `cty${i}` }) }));
      }
    }
    if (!hasRembg || !existsSync(`${proj}/assets/cut${i}`)) {
      if (!warnedCutout) {
        console.log('  · no rembg, so a G window puts the speaker on the card as a FRAMED INSET rather than a cutout.');
        console.log('    For the real cutout: pip3 install rembg onnxruntime  (then rebuild).');
        warnedCutout = true;
      }
      const iw = even(W * 0.52), ih = even(iw * H / W);
      // Bake at FULL frame size and let the node scale it down. A 562px-wide encode decoded to BLACK in the
      // app while byte-identical settings at 1080 played fine — an odd-sized frame is not worth the risk, and
      // the app resamples on the way to the canvas anyway.
      const src = bake(`inset_${i}_${tag.slice(0, 4)}`, t0, t1, `scale=${W}:${H}`);
      const ix = W - MARGIN - iw, iy = H - MARGIN - ih;
      gfx.push(rect({ x: ix - 14, y: iy - 14, w: iw + 28, h: ih + 28, fill: C.white, id: `if${i}`, t0, t1,
        children: enter + slide('y', iy + 30, iy - 14, { dur: 0.46, id: `ify${i}` }) }));
      gfx.push(video({ src, x: ix, y: iy, w: iw, h: ih, id: `in${i}`, t0, t1, sourceIn: 0,
        children: slide('y', iy + 44, iy, { dur: 0.46, id: `iny${i}` }) }));
    }
  }

  // where the card's type may live, per mode
  const box = mode === 'S' ? { x: MARGIN, y: MARGIN, w: W - MARGIN * 2, h: H - L.split_h - MARGIN * 2 }
    : mode === 'P' ? { x: MARGIN, y: MARGIN, w: W - MARGIN * 2, h: H - L.band_h - MARGIN * 2 }
    : mode === 'G' ? { x: MARGIN, y: MARGIN, w: W - MARGIN * 2, h: Math.round(H * 0.44) }
    : { x: MARGIN, y: Math.round(H * 0.18), w: W - MARGIN * 2, h: Math.round(H * 0.56) };
  gfx.push(...cardNodes(w.card, i, t0, t1, box));

  // foley on the layout change — the sound of the page turning, never a tonal ping
  const kind = w.sfx || (w.card?.kind === 'stamp' ? 'stamp' : w.card?.kind === 'checklist' ? 'tick' : 'rustle');
  if (FOLEY[kind]) {
    audio.push(`          <audio src="${foleyFile(kind)}" start={${t0.toFixed(2)}} end={${Math.min(t1, t0 + 0.6).toFixed(2)}} volume={-12} id="fx${i}" />`);
  }
});

// punch-ins — a static reframe, baked, never an animated scale
(V.punch || []).forEach((p, i) => {
  const t0 = p.t[0], t1 = Math.min(p.t[1], TOTAL);
  const s = Number(p.scale) || 1.15;
  if (t1 <= t0 || s <= 1) return;
  // Keep the face in the tighter frame: crop around where it sits, clamped inside the picture.
  const cw = even(W / s), ch = even(H / s);
  const cx = even((W - cw) / 2);
  const cy = even(Math.min(Math.max(0, H * FACE_PCT - ch * 0.42), H - ch));
  const src = bake(`punch_${i}_${tag.slice(0, 4)}`, t0, t1, `crop=${cw}:${ch}:${cx}:${cy},scale=${W}:${H}`);
  gfx.unshift(video({ src, x: 0, y: 0, w: W, h: H, id: `pi${i}`, t0, t1, sourceIn: 0 }));
});

// ── captions — red pill, and they move so they never sit under whatever the window put there ────────────────
let caps = [];
if (has('--captions')) {
  const capFile = `briefs/${slug}/remix/out/${cutId}.captions.json`;
  if (!existsSync(capFile)) {
    console.log(`  ⚠ --captions asked for but no ${capFile} — captions layer left empty.`);
  } else {
    const list = JSON.parse(readFileSync(capFile, 'utf8'));
    const size = L.caption;
    const widths = measure(list.map((c) => String(c.text || '').toUpperCase()), LABEL_F, size, 1);
    list.forEach((c, i) => {
      const t0 = c.t[0];
      let t1 = Math.min(c.t[1], TOTAL);
      if (list[i + 1]) t1 = Math.min(t1, list[i + 1].t[0] - 0.03);
      const body = String(c.text || '').trim().toUpperCase();
      if (t1 - t0 < 0.05 || !body) return;
      const win = capWindows.find((w) => t0 >= w.t[0] && t0 < w.t[1]);
      const yPct = L.cap_y[win?.mode || 'A'] ?? L.cap_y.A;
      const w = Math.min(W - 80, widths[i] + 56);
      const rh = Math.round(size * 1.6);
      const x = Math.round((W - w) / 2), y = Math.round(H * yPct);
      caps.push(rect({ x, y, w, h: rh, fill: RED, radius: 6, id: `cb${i}`, t0, t1 }));
      caps.push(text({ x, y: y + vnudge(size, 0.12), w, h: rh, body, size, color: C.white, font: LABEL,
        id: `cp${i}`, t0, t1, tracking: 1 }));
    });
  }
}

// ── write ───────────────────────────────────────────────────────────────────────────────────────────────────
const sceneId = 'vx' + cutId.replace(/[^a-z0-9]/gi, '').slice(0, 12) + tag.slice(0, 4);
const tsx = `export default function Project() {
  return (
    <stage background="#000000" camera={[0.3, 0, 0, 0.3, 120, 60]} id="stg${sceneId}">
      <scene name="${slug}-${cutId}-vox" width={${W}} height={${H}} fill="black" active id="${sceneId}" workarea={[0, ${TOTAL.toFixed(3)}]} timeline={[0, ${TOTAL.toFixed(2)}, 10]}>
        <sequence name="A-roll" id="aroll">
${video({ src: `assets/base_${tag}.mp4`, id: 'base', t0: 0, t1: TOTAL, sourceIn: 0 })}
        </sequence>
        <sequence name="Graphics" id="gfxseq">
${gfx.join('\n')}
        </sequence>
        <sequence name="Captions" id="capseq">
${caps.join('\n')}
        </sequence>
        <sequence name="Foley" id="fxseq">
${audio.join('\n')}
        </sequence>
      </scene>
    </stage>
  );
}
`;
writeFileSync(`${proj}/index.tsx`, tsx);
writeFileSync(`${proj}/package.json`, JSON.stringify({
  name: `${slug}-${cutId}-vox`,
  projectId: createHash('md5').update(`${slug}${cutId}vox${tag}`).digest('hex').slice(0, 21),
  displayName: `${slug} · ${M.name || cutId} · vox`,
  private: true, type: 'module', main: 'index.tsx',
  scripts: { open: 'diffusion open .', check: 'diffusion check', export: 'diffusion export' },
  devDependencies: { '@diffusionstudio/jsx': 'latest', 'solid-js': '^1.9.10' },
  diffusion: { export: { vox: {
    format: 'mp4',
    video: { enabled: true, codec: 'avc', bitrate: 16000000, fps: 30, resolution: 1080 },
    audio: { enabled: true, codec: 'aac', sampleRate: 48000, bitrate: 192000 },
  } } },
}, null, 2));
writeFileSync(`${proj}/tsconfig.json`, JSON.stringify({
  compilerOptions: { target: 'ES2022', lib: ['ES2022', 'DOM'], module: 'ESNext', moduleResolution: 'bundler',
    jsx: 'preserve', jsxImportSource: '@diffusionstudio/jsx', strict: true, noEmit: true, skipLibCheck: true },
  include: ['**/*.ts', '**/*.tsx'],
}, null, 2));
for (const junk of ['assets.yml', 'cache']) rmSync(`${proj}/${junk}`, { recursive: true, force: true });
writeFileSync(`${proj}/.ds.json`, JSON.stringify({ proj, scene: sceneId, dur: TOTAL, cut: `${cutId}-vox`, slug }, null, 2));

const byMode = windows.reduce((m, w) => ({ ...m, [w.mode || 'A']: (m[w.mode || 'A'] || 0) + 1 }), {});
console.log(`\n✓ vox project  ${proj}`);
console.log(`  scene ${sceneId} · ${TOTAL.toFixed(2)}s · ${windows.length} windows (${Object.entries(byMode).map(([k, n]) => `${n}×${k}`).join(' ')})`
  + `${caps.length ? ` · ${caps.length / 2} captions` : ''}`);
console.log(`  cards, band and split are native nodes — retime and retype them in the app.\n`);
console.log(`  open it:   dapi open ${JSON.stringify(proj)}`);
console.log(`  export it: node scripts/ds-export.mjs ${slug} ${cutId}-vox\n`);

if (has('--open')) {
  try { execFileSync('dapi', ['open', proj], { stdio: 'inherit' }); }
  catch { console.log('  (dapi not on PATH — open the folder from Diffusion Studio instead)'); }
}
