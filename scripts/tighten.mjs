#!/usr/bin/env node
// tighten.mjs — cut the dead air out of a clip, and prep it so an editor can actually play it.
//
//   node scripts/tighten.mjs <file> [--out <file>] [--min 0.28] [--keep 0.15] [--prep-only] [--dry]
//
// Two jobs, both of which have to happen before a long take is usable:
//
//   1. PREP — H.264, constant frame rate 30, gapless audio, regular keyframes. Skipping this produces failures
//      that look like something else entirely: variable frame rate makes an editor drop roughly a second of
//      audio near the clip's tail AT RENDER ONLY (the source plays fine in ffprobe, so it reads as a mystery),
//      and irregular keyframes throw decode errors on preview.
//
//   2. TIGHTEN — remove the silences, without ever clipping a word.
//
// ⚠️ THE RULE THAT MATTERS: cut on the ACOUSTIC SILENCE, never on a transcript word time. Word timestamps
// drift by up to ~0.6s, so a cut placed on one lands mid-word (clipping the attack or the tail) or mid-pause
// (leaving a fragment of the phrase you meant to remove). A region that silencedetect returns is below
// threshold BY DEFINITION, so cutting inside it cannot remove anything audible.
//
// ⚠️ AND THE THRESHOLD IS RELATIVE, never fixed. A clip whose room tone sits at −25 dB has no region below a
// fixed −30 dB gate, so a fixed gate "finds nothing" and you conclude there is no dead air — while the pauses
// are plainly visible in the waveform. This measures the file's own mean and works down from it.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, basename, extname } from 'node:path';
import { tmpdir } from 'node:os';

const A = process.argv.slice(2);
const has = (f) => A.includes(f);
const val = (f, d) => { const i = A.indexOf(f); return i !== -1 && A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : d; };
const pos = A.filter((a, i) => !a.startsWith('--') && !String(A[i - 1] || '').startsWith('--'));
const src = pos[0];
if (!src) {
  console.error('usage: node scripts/tighten.mjs <file> [--out <file>] [--min 0.28] [--keep 0.15] [--prep-only] [--dry]');
  process.exit(1);
}
if (!existsSync(src)) { console.error(`✗ no file at ${src}`); process.exit(1); }
for (const bin of ['ffmpeg', 'ffprobe']) {
  try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); }
  catch { console.error(`✗ ${bin} is required. brew install ffmpeg`); process.exit(1); }
}

const out = resolve(val('--out', `${dirname(src)}/${basename(src, extname(src))}-tight.mp4`));
const MIN_SIL = Number(val('--min', '0.28'));     // shorter than this is a breath, not dead air
const KEEP = Number(val('--keep', '0.15'));       // leave this much of every pause: speech with none reads frantic
const HEAD = 0.06, TAIL = 0.06;                   // pads INSIDE the silence, protecting the tail and the next attack
const tmp = `${tmpdir()}/adkit-tighten-${process.pid}`;
mkdirSync(tmp, { recursive: true });

const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { encoding: 'utf8' });
// volumedetect and silencedetect report on STDERR, and ffmpeg exits 0 — so execFileSync, which returns stdout
// and only exposes stderr when the process FAILS, hands back an empty string and the measurement reads as
// "this file has no audio". Every analysis call goes through here.
const measure = (args) => {
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  return `${r.stdout || ''}${r.stderr || ''}`;
};
const probe = (args) => execFileSync('ffprobe', ['-v', 'error', ...args], { encoding: 'utf8' }).trim();
const dur = (f) => Number(probe(['-show_entries', 'format=duration', '-of', 'csv=p=0', f])) || 0;

// ── 1. prep ─────────────────────────────────────────────────────────────────────────────────────────────────
// aresample=async=1:first_pts=0 is the important one. VFR-origin footage (an iPhone .MOV) carries dozens of
// tiny audio PTS gaps; decoding that audio for analysis silently COLLAPSES them, so the decoded timeline runs
// a second or two shorter than the container — and it accumulates. Analyse in one timeline and cut in another
// and the cuts drift later and later, slicing words out of the BACK HALF while the front looks perfect.
const prepped = `${tmp}/prep.mp4`;
console.log(`\nTIGHTEN ${basename(src)}  (${dur(src).toFixed(1)}s)`);
console.log('  prep: H.264 · CFR 30 · gapless audio · 1s keyframes');
if (!has('--dry')) {
  ff(['-i', resolve(src), '-vf', 'fps=30,format=yuv420p', '-fps_mode', 'cfr', '-r', '30',
    '-video_track_timescale', '30000', '-c:v', 'libx264', '-crf', '19', '-preset', 'medium',
    '-profile:v', 'high', '-level', '4.0', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
    '-af', 'aresample=async=1:first_pts=0', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', prepped]);
  // Prove the gaps are gone rather than assuming the flag worked.
  const gaps = probe(['-select_streams', 'a', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', prepped])
    .split('\n').map(Number).filter(Number.isFinite)
    .reduce((acc, t, i, arr) => acc + (i && t - arr[i - 1] > 0.05 ? 1 : 0), 0);
  console.log(`  audio gaps > 50ms: ${gaps}${gaps ? '  ⚠ analysis and cuts may disagree' : ' ✓'}`);
}

if (has('--prep-only')) {
  if (!has('--dry')) execFileSync('mv', [prepped, out]);
  console.log(`\n✓ ${out}  (prep only — no silences removed)\n`);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
}
const work = has('--dry') ? resolve(src) : prepped;

// ── 2. the threshold, measured from THIS file ───────────────────────────────────────────────────────────────
const vol = measure(['-i', work, '-af', 'volumedetect', '-vn', '-f', 'null', '-']);
const mean = Number((/mean_volume:\s*(-?[\d.]+)/.exec(vol) || [])[1]);
const peak = Number((/max_volume:\s*(-?[\d.]+)/.exec(vol) || [])[1]);
if (!Number.isFinite(mean)) { console.error('✗ could not measure the audio level — is there an audio track?'); process.exit(1); }

const silencesAt = (db) => {
  const o = measure(['-i', work, '-af', `silencedetect=noise=${db}dB:d=0.06`, '-vn', '-f', 'null', '-']);
  const spans = [];
  let start = null;
  for (const line of o.split('\n')) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    const e = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (s) start = Number(s[1]);
    if (e && start !== null) { spans.push([start, Number(e[1])]); start = null; }
  }
  return spans;
};

// Sweep UP from 12 dB below the mean. On a clip with loud room tone the first threshold finds nothing, and
// stopping there is how you conclude a clip has no dead air while staring at the pauses in its waveform.
let db = Math.round(mean - 12), spans = [];
for (const t of [db, db + 4, db + 8, Math.round(mean - 2)]) {
  spans = silencesAt(t).filter(([s, e]) => e - s >= MIN_SIL);
  if (spans.length) { db = t; break; }
}
console.log(`  level: mean ${mean.toFixed(1)} dB · peak ${peak.toFixed(1)} dB → gate ${db} dB`);
if (!spans.length) { console.log('\n  no dead air over the threshold. Nothing to tighten.\n'); rmSync(tmp, { recursive: true, force: true }); process.exit(0); }

// ── 3. what to remove ───────────────────────────────────────────────────────────────────────────────────────
// Cut INSIDE each silence, leaving KEEP of it behind: speech with every pause removed reads frantic, and the
// pads protect the decaying tail before it and the soft attack after it.
const total = dur(work);
const cuts = [];
for (const [s, e] of spans) {
  const a = s + HEAD, b = e - TAIL;
  if (b - a <= KEEP) continue;
  const mid = (a + b) / 2;
  cuts.push([mid - (b - a - KEEP) / 2, mid + (b - a - KEEP) / 2]);
}
const removed = cuts.reduce((x, [a, b]) => x + (b - a), 0);
console.log(`  ${spans.length} pause(s) over ${MIN_SIL}s · removing ${removed.toFixed(1)}s of ${total.toFixed(1)}s`);

if (has('--dry')) {
  cuts.slice(0, 12).forEach(([a, b]) => console.log(`    cut ${a.toFixed(2)}–${b.toFixed(2)}  (${(b - a).toFixed(2)}s)`));
  if (cuts.length > 12) console.log(`    …and ${cuts.length - 12} more`);
  console.log('\n  [dry] nothing written.\n');
  rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
}

// ── 4. prove every cut is actually silent, BEFORE rendering ─────────────────────────────────────────────────
// Cheaper than re-transcribing and decisive: a region that is 15–20 dB under the file's peak holds no audible
// speech, whatever a transcript claims is there. This catches a mis-tuned gate before it eats a word.
let loudest = -Infinity;
for (const [a, b] of cuts) {
  const o = measure(['-ss', String(a), '-t', String(b - a), '-i', work, '-af', 'volumedetect',
    '-vn', '-f', 'null', '-']);
  const m = Number((/max_volume:\s*(-?[\d.]+)/.exec(o) || [])[1]);
  if (Number.isFinite(m)) loudest = Math.max(loudest, m);
}
const margin = peak - loudest;
console.log(`  loudest cut region: ${loudest.toFixed(1)} dB — ${margin.toFixed(1)} dB under the peak`);
if (margin < 12) {
  console.error('\n⛔ one of the regions about to be removed is close to speech level. Refusing to cut.');
  console.error(`   Raise --min above ${MIN_SIL}s, or the gate is mis-tuned for this clip.\n`);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}

// ── 5. render the keeps — ONE pass ──────────────────────────────────────────────────────────────────────────
// Encoding each keep and then re-encoding the concat means every frame is compressed TWICE, and on a long take
// that is most of the runtime for no quality gained. trim/atrim + concat inside one filter graph does it in a
// single encode, and keeps the audio locked to its own video the whole way.
const keeps = [];
let at = 0;
for (const [a2, b2] of cuts) { if (a2 - at > 0.04) keeps.push([at, a2]); at = b2; }
if (total - at > 0.04) keeps.push([at, total]);

const fc = keeps.map(([a2, b2], i) =>
  `[0:v]trim=${a2}:${b2},setpts=PTS-STARTPTS[v${i}];[0:a]atrim=${a2}:${b2},asetpts=PTS-STARTPTS[a${i}]`).join(';');
const legs = keeps.map((_, i) => `[v${i}][a${i}]`).join('');
ff(['-i', work, '-filter_complex',
  `${fc};${legs}concat=n=${keeps.length}:v=1:a=1[vo][ao];[vo]fps=30,format=yuv420p[v];[ao]aresample=async=1:first_pts=0[a]`,
  '-map', '[v]', '-map', '[a]', '-fps_mode', 'cfr', '-r', '30', '-video_track_timescale', '30000',
  '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
  '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]);

rmSync(tmp, { recursive: true, force: true });
const fin = dur(out);
console.log(`\n✓ ${out}  —  ${fin.toFixed(1)}s (was ${total.toFixed(1)}s, ${(total - fin).toFixed(1)}s of dead air gone)`);
console.log('  CFR 30 · gapless · 1s keyframes — safe to drop straight into an editor.');
console.log('\n  Listen to it before you trust it. Then QA the render, not the timeline.\n');
