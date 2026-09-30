#!/usr/bin/env node
// assemble.mjs — join the rendered clips into the finished video.
//
//   node scripts/assemble.mjs <slug> <VIDEO> [--dir <clips dir>] [--out <file>] [--lufs -14]
//
// Two things this gets right, both of which bite if you do it by hand:
//   1. ONE LOUDNESS. Each clip is generated separately, so their levels drift. Every clip is normalised to the
//      same target before joining, or the cut audibly jumps.
//   2. RE-ENCODE, NEVER STREAM-COPY. Concatenating with `-c copy` across separately-encoded clips produces a
//      visible glitch at each join (mismatched GOP/timebase). Re-encoding costs seconds and removes the class
//      of bug entirely.
//
// Clips are joined in NUMERIC order (clip-1, clip-2, … clip-10) — not lexical, which would put clip-10 second.

import { existsSync, readdirSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const A = process.argv.slice(2);
const val = (f, d = null) => { const i = A.indexOf(f); return i !== -1 && A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : d; };
const pos = A.filter((a, i) => !a.startsWith('--') && !(i > 0 && A[i - 1].startsWith('--')));
const [slug, video] = pos;
if (!slug || !video) { console.error('usage: node scripts/assemble.mjs <slug> <VIDEO> [--dir <clips>] [--out <file>] [--lufs -14]'); process.exit(1); }

for (const bin of ['ffmpeg', 'ffprobe']) {
  try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); }
  catch { console.error(`✗ ${bin} is not installed. Install ffmpeg (brew install ffmpeg) and re-run.`); process.exit(1); }
}

const dir = val('--dir', `briefs/${slug}/renders/${video}`);
if (!existsSync(dir)) { console.error(`✗ no clips directory at ${dir}`); process.exit(1); }

// numeric-aware ordering
const clips = readdirSync(dir)
  .filter((n) => /\.(mp4|mov|webm|mkv)$/i.test(n) && !/^joined|^final/i.test(n))
  .map((n) => ({ n, k: Number((n.match(/(\d+)/) || [])[1] ?? 0) }))
  .sort((a, b) => a.k - b.k || a.n.localeCompare(b.n))
  .map((x) => `${dir}/${x.n}`);

if (!clips.length) { console.error(`✗ no clips found in ${dir}`); process.exit(1); }

const LUFS = val('--lufs', '-14');
const outDir = `briefs/${slug}/delivery`;
mkdirSync(outDir, { recursive: true });
const out = val('--out', `${outDir}/${video}.mp4`);
const tmp = `${dir}/.assemble`;
mkdirSync(tmp, { recursive: true });

const dur = (f) => {
  try { return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim()) || 0; }
  catch { return 0; }
};
const hasAudio = (f) => {
  try { return !!execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim(); }
  catch { return false; }
};

console.log(`\nassembling ${clips.length} clip(s) → ${out}\n`);
const levelled = [];
clips.forEach((f, i) => {
  const d = dur(f);
  const a = hasAudio(f);
  const o = `${tmp}/lvl-${String(i + 1).padStart(3, '0')}.mp4`;
  // Normalise loudness; a silent clip gets a generated silent track so the concat keeps a uniform stream layout.
  const args = a
    ? ['-y', '-v', 'error', '-i', f, '-af', `loudnorm=I=${LUFS}:TP=-1.5:LRA=11`, '-ar', '48000', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', o]
    : ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-i', f, '-shortest', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', o];
  execFileSync('ffmpeg', args);
  levelled.push(o);
  console.log(`  ${String(i + 1).padStart(2)}. ${f.split('/').pop().padEnd(28)} ${d ? d.toFixed(1) + 's' : '?'}${a ? '' : '  (silent — added a silent track)'}`);
});

// RE-ENCODE the concat. Stream-copying separately-encoded clips glitches at every join.
// Absolute paths throughout: counting '../' from a nested temp dir is fragile and silently breaks when the
// clips directory moves. -safe 0 is what allows absolute paths in the concat list.
const list = `${tmp}/list.txt`;
writeFileSync(list, levelled.map((f) => `file '${resolve(f).replace(/'/g, "'\\''")}'`).join('\n') + '\n');
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', resolve(list),
  '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', resolve(out)]);

if (!existsSync(out)) { console.error('✗ concat produced no file'); process.exit(1); }
const total = dur(out);
const expected = clips.reduce((a, f) => a + dur(f), 0);
rmSync(tmp, { recursive: true, force: true });

console.log(`\n✓ ${out}  —  ${total.toFixed(1)}s, ${Math.round(readFileSync(out).length / 1024)}KB`);
if (expected && Math.abs(total - expected) > 0.5) {
  console.log(`  ⚠ expected ~${expected.toFixed(1)}s from the parts but got ${total.toFixed(1)}s — check for a truncated clip.`);
}
console.log('  (one loudness, hard cuts, re-encoded — no stream-copy glitch at the joins)\n');
