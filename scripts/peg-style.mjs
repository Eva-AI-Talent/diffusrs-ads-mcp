#!/usr/bin/env node
// peg-style.mjs — start a super STYLE from a reference ad: a contact sheet to read it off, and a pack to edit.
//
//   node scripts/peg-style.mjs <slug> <peg-video|peg-id> [--name <id>] [--family organic|slab] [--font <file>]
//
// Writes styles/_derived/<name>.json                        — a pack, pre-filled with suggestions
//        briefs/<slug>/remix/peg-sheet-<name>.png           — 12 frames. READ THE TREATMENT OFF THIS.
//
// ⚠️ THIS DOES NOT AUTOMATICALLY MATCH A PEG, and the honest reason is worth keeping: a pixel heuristic cannot
// tell a caption bar from a t-shirt. It was built and tuned over several passes and it still returned, with
// confidence, the brown of somebody's shirt as the house super colour — and which answer you got depended on
// how many frames were sampled. A tool that is right most of the time about something you cannot easily check
// is worse than one that admits the gap.
//
// So the split is: this script does the part a script is good at — pulling frames, laying out a sheet, and
// measuring a CANDIDATE band as a starting point — and a pair of eyes does the part eyes are good at. Look at
// the sheet, correct the numbers in the pack, then render a cut with it and look again.
//
// What the measurement is worth: the POSITION of a band and its COLOURS come out reasonably. Size, radius and
// padding are inflated by antialiasing. The TYPEFACE is not in the pixels at all and is never measured.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { expand } from '../lib/ds-nodes.mjs';

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i !== -1 && A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : d; };
const pos = A.filter((a, i) => !a.startsWith('--') && !String(A[i - 1] || '').startsWith('--'));
const [slug, pegArg] = pos;
if (!slug || !pegArg) {
  console.error('usage: node scripts/peg-style.mjs <slug> <peg-video|peg-id> [--name <id>] [--family organic|slab]');
  process.exit(1);
}

// find the peg: a path, or an id under the brief's pegs/
let peg = pegArg;
if (!existsSync(peg)) {
  const dir = `briefs/${slug}/pegs/${pegArg}`;
  const found = existsSync(dir) ? readdirSync(dir).find((f) => /\.(mp4|mov|webm|mkv)$/i.test(f)) : null;
  if (found) peg = `${dir}/${found}`;
  else {
    const flat = existsSync(`briefs/${slug}/pegs`)
      ? readdirSync(`briefs/${slug}/pegs`).find((f) => f.startsWith(pegArg) && /\.(mp4|mov|webm|mkv)$/i.test(f)) : null;
    if (flat) peg = `briefs/${slug}/pegs/${flat}`;
  }
}
if (!existsSync(peg)) {
  console.error(`\n⛔ no peg video at "${pegArg}".`);
  console.error(`   Pull one first:  node scripts/peg.mjs "<url>" --slug ${slug}`);
  console.error('   Or pass a path to a file you already have.\n');
  process.exit(1);
}

for (const bin of ['ffmpeg', 'ffprobe']) {
  try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); }
  catch { console.error(`✗ ${bin} is required. brew install ffmpeg`); process.exit(1); }
}
try { execFileSync('python3', ['-c', 'import numpy, PIL'], { stdio: 'ignore' }); }
catch { console.error('\n⛔ this one needs numpy as well as Pillow:  pip3 install numpy pillow\n'); process.exit(1); }

const name = val('--name', basename(peg).replace(/\.[^.]+$/, '')).replace(/[^a-z0-9-]/gi, '-').toLowerCase();
const family = val('--family', 'organic');
if (!['organic', 'slab'].includes(family)) { console.error('⛔ --family must be organic or slab'); process.exit(1); }

// ── sample frames ───────────────────────────────────────────────────────────────────────────────────────────
// Across the WHOLE clip, not the first few seconds: supers usually arrive after the hook, and a sample that
// stops early finds nothing and reports the peg as having no supers.
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', peg], { encoding: 'utf8' }).trim()) || 0;
const FRAMES = 24;
const tmp = join(tmpdir(), `adkit-pegstyle-${name}`);   // frames are bulky; keep them out of the brief
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const fps = dur > 0 ? Math.max(0.2, FRAMES / dur) : 2;
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', peg, '-vf', `fps=${fps.toFixed(3)},scale=1080:-2`,
  '-frames:v', String(FRAMES), `${tmp}/f_%03d.png`]);
const n = readdirSync(tmp).length;
console.log(`\nPEG STYLE — ${basename(peg)}  (${dur.toFixed(1)}s, ${n} frames sampled)`);

// ── measure ─────────────────────────────────────────────────────────────────────────────────────────────────
let M;
try {
  M = JSON.parse(execFileSync('python3', [new URL('./peg_style.py', import.meta.url).pathname, tmp], { encoding: 'utf8' }));
} catch (e) {
  console.error(`\n⛔ measurement failed: ${String(e.message).slice(0, 200)}\n`); process.exit(1);
}
// A measurement that found nothing is not a dead end — the sheet is the deliverable either way.
if (M.error) console.log(`\n  (no candidate band measured: ${M.error})`);

const E = M.estimated || {};
const scale = 1080 / (M.width || 1080);
const px = (v) => Math.round((v || 0) * scale);
const CONF = M.confidence || 'none';
if (!M.error) {
  console.log(`\n  CANDIDATE BAND — confidence ${CONF.toUpperCase()}${CONF === 'low' ? ' (probably not a caption at all)' : ''}`);
  console.log(`    position      ${(M.pos_pct * 100).toFixed(1)}% down the frame`);
  console.log(`    background    ${M.box === 'pill' ? `a filled bar, ${M.fill}` : 'none — bare type'}`);
  console.log(`    ink           ${M.ink}`);
  console.log(`    present in    ${((M.presence || 0) * 100).toFixed(0)}% of sampled frames`);
  console.log(`    size / radius ~${px(E.font_px)}px / ~${px(E.radius_px)}px  — inflated by antialiasing, expect to lower these`);
  console.log(`    typeface      NOT measurable from pixels; defaulted to the ${family} pack's`);
}
// ── write the pack ──────────────────────────────────────────────────────────────────────────────────────────
const basePack = JSON.parse(readFileSync(new URL(`../styles/${family}.json`, import.meta.url).pathname, 'utf8'));
const fontFile = val('--font', basePack.font.file);
const pack = {
  name: `${name} (derived from a peg)`,
  family,
  note: `Measured from ${basename(peg)} on ${new Date().toISOString().slice(0, 10)}. Position and colours are `
      + 'measured; size, radius and padding are estimates; the typeface was CHOSEN, not measured. '
      + 'Look at the proof image before using this, and edit the numbers here rather than re-deriving.',
  font: { ...basePack.font, file: fontFile },
  colors: {
    ...basePack.colors,
    fill: M.box === 'pill' ? M.fill : basePack.colors.fill,
    ink: M.ink,
  },
  layout: {
    ...basePack.layout,
    size: px(E.font_px) || basePack.layout.size,
    radius: M.box === 'pill' ? (px(E.radius_px) || 0) : 0,
    padx: M.box === 'pill' ? (px(E.padx_px) || basePack.layout.padx) : basePack.layout.padx,
    held: Number(M.pos_pct.toFixed(4)),
    cta_top: Number(M.pos_pct.toFixed(4)),
    box: M.box,                       // "pill" or "none" — ds-build switches skins on this
    stroke: M.box === 'none' ? 14 : 0,
  },
  measured: M,
};
mkdirSync('styles/_derived', { recursive: true });
const packPath = `styles/_derived/${name}.json`;
writeFileSync(packPath, JSON.stringify(pack, null, 2));

// ── the sheet — the actual deliverable ──────────────────────────────────────────────────────────────────────
const sheet = `briefs/${slug}/remix/peg-sheet-${name}.png`;
try {
  const args = [new URL('./peg_sheet.py', import.meta.url).pathname, tmp, resolve(sheet)];
  if (!M.error && M.band) args.push(String(M.band[0]), String(M.band[1]));
  execFileSync('python3', args, { stdio: 'ignore' });
  console.log(`\n  SHEET → ${sheet}`);
  console.log('    Open it. Read off: where the supers sit, whether there is a filled bar and what colour,');
  console.log('    the ink colour, roughly how big the type is, and whether it is centred or left-aligned.');
  if (!M.error) console.log('    The red box is the CANDIDATE band — confirm it is actually a caption, or ignore it.');
} catch (e) {
  console.log(`\n  ⚠ could not build the contact sheet (${String(e.message).slice(0, 90)})`);
}

rmSync(tmp, { recursive: true, force: true });
console.log(`\n✓ ${packPath}`);
console.log(`\n  use it:  node scripts/ds-build.mjs ${slug} <cut> --pack ${packPath}`);
console.log('  Read the sheet, correct the numbers in that file, then build a cut with it and look again.\n');
