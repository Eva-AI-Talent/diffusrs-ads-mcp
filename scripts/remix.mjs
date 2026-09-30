#!/usr/bin/env node
// remix.mjs — inventory a clip library so it can be recut into new ads, spending no credits.
//
//   node scripts/remix.mjs <slug> --dir <clips-dir> [--prep] [--sheets] [--fps 1]
//
//   --prep    normalise every source to CFR30 / gapless audio / regular keyframes (required before editing)
//   --sheets  build a numbered contact sheet per clip, so you can SEE where each beat actually starts
//
// Writes briefs/<slug>/remix/shots.json — the shot library stub you fill in with in-points and beat roles.
//
// Why the contact sheets matter: a scene description tells you what a clip is ABOUT, not where inside it the
// usable window sits. Pin the in-point to the frame where the beat reads — the pack raised and the label square,
// the hands up — not the clip start. `availability = duration − inPoint` is the hard ceiling for any beat using
// that shot, and planning past it is the usual cause of a rebuild.

import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const A = process.argv.slice(2);
const has = (f) => A.includes(f);
const val = (f, d = null) => { const i = A.indexOf(f); return i !== -1 && A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : d; };
const pos = A.filter((a, i) => !a.startsWith('--') && !(i > 0 && A[i - 1].startsWith('--')));
const slug = pos[0];
if (!slug) { console.error('usage: node scripts/remix.mjs <slug> --dir <clips-dir> [--prep] [--sheets]'); process.exit(1); }

for (const bin of ['ffmpeg', 'ffprobe']) {
  try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); }
  catch { console.error(`✗ ${bin} is required. brew install ffmpeg`); process.exit(1); }
}

const src = val('--dir', `briefs/${slug}/renders`);
if (!existsSync(src)) { console.error(`✗ no clips directory at ${src}`); process.exit(1); }

// collect clips (recursively — renders are usually one folder per video)
const clips = [];
const walk = (d) => {
  for (const n of readdirSync(d, { withFileTypes: true })) {
    const f = `${d}/${n.name}`;
    if (n.isDirectory()) walk(f);
    else if (/\.(mp4|mov|mkv|webm)$/i.test(n.name) && !/^\./.test(n.name)) clips.push(f);
  }
};
walk(src);
if (!clips.length) { console.error(`✗ no clips found under ${src}`); process.exit(1); }

const out = `briefs/${slug}/remix`;
mkdirSync(out, { recursive: true });

const probe = (f, entries) => {
  try { return execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', entries, '-of', 'default=nw=1', f], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};

console.log(`\nremix inventory — ${clips.length} clip(s) under ${src}\n`);
const shots = [];
for (const f of clips) {
  const info = probe(f, 'stream=width,height,avg_frame_rate,r_frame_rate,codec_name');
  const get = (k) => (info.match(new RegExp(`${k}=(.+)`)) || [])[1] || '';
  const durS = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim();
  const dur = Number(durS) || 0;
  const w = Number(get('width')), h = Number(get('height'));
  const afr = get('avg_frame_rate');
  // A near-30 but not-exactly-30 avg_frame_rate behaves like VFR in an editor and silently drops tail audio.
  const cfr30 = afr === '30/1';
  const small = h && h < 1920;
  const name = f.split('/').pop().replace(/\.[^.]+$/, '');

  console.log(`  ${name.padEnd(24)} ${String(dur.toFixed(1)).padStart(5)}s  ${w}x${h}  ${afr}`
    + `${cfr30 ? '' : '  ⚠ not CFR30'}${small ? '  ⚠ below 1080x1920' : ''}`);

  shots.push({
    name, file: f, duration: Number(dur.toFixed(2)),
    width: w, height: h, avg_frame_rate: afr, cfr30, needsUpscale: small,
    role: null,          // PROBLEM | PRODUCT | ACTION | PROOF | PERSON  ← fill in after looking at the sheet
    inPoint: null,       // seconds — the frame where the beat actually READS, not the clip start
    availability: null,  // duration − inPoint; the hard ceiling for any beat using this shot
    hasSpeech: null,     // check before planning an ambient/process cut
    notes: '',
  });
}

// ── optional: normalise for editing ─────────────────────────────────────────────────────────────────────────
if (has('--prep')) {
  const prepped = `${out}/prepped`;
  mkdirSync(prepped, { recursive: true });
  console.log(`\nprepping → ${prepped}/ (CFR30, gapless audio, 1s keyframes)`);
  for (const s of shots) {
    const o = `${prepped}/${s.name}.mp4`;
    const vf = s.needsUpscale
      ? 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p'
      : 'fps=30,format=yuv420p';
    try {
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', s.file, '-vf', vf,
        '-fps_mode', 'cfr', '-r', '30', '-video_track_timescale', '30000',
        '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-profile:v', 'high', '-level', '4.0',
        '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
        '-af', 'aresample=async=1:first_pts=0', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart', o]);
      s.prepped = o;
      console.log(`  ✓ ${s.name}${s.needsUpscale ? ' (upscaled to 1080x1920)' : ''}`);
    } catch (e) { console.error(`  ✗ ${s.name}: ${String(e.message).slice(0, 110)}`); }
  }
}

// ── optional: contact sheets you actually look at ───────────────────────────────────────────────────────────
if (has('--sheets')) {
  const sheets = `${out}/sheets`;
  mkdirSync(sheets, { recursive: true });
  const fps = val('--fps', '1');
  console.log(`\ncontact sheets → ${sheets}/  (${fps} frame/s, second-numbered, 6 per row)`);
  for (const s of shots) {
    const o = `${sheets}/${s.name}.png`;
    try {
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', s.prepped || s.file,
        '-vf', `fps=${fps},scale=180:-1,drawtext=text='%{eif\\:n\\:d}s':x=5:y=5:fontsize=20:fontcolor=yellow:box=1:boxcolor=black,tile=6x4`,
        '-frames:v', '1', o]);
      console.log(`  ✓ ${s.name}.png`);
    } catch (e) { console.error(`  ✗ ${s.name}: ${String(e.message).slice(0, 110)}`); }
  }
  console.log('\n  ⚠ LOOK at each sheet and COUNT THE COLUMNS carefully — 6 per row. Misreading the grid gives a');
  console.log('    wrong in-point, which is only obvious after the cut is built.');
}

// ── the shot library stub ───────────────────────────────────────────────────────────────────────────────────
const sf = `${out}/shots.json`;
if (existsSync(sf)) {
  // don't clobber in-points someone has already pinned
  const prev = JSON.parse(readFileSync(sf, 'utf8'));
  const byName = Object.fromEntries((prev.shots || []).map((s) => [s.name, s]));
  for (const s of shots) {
    const p = byName[s.name];
    if (p) { s.role = p.role ?? s.role; s.inPoint = p.inPoint ?? s.inPoint; s.hasSpeech = p.hasSpeech ?? s.hasSpeech; s.notes = p.notes || s.notes; }
  }
  // ONE CLIP CONTAINS SEVERAL USABLE WINDOWS. A 13s scene commonly yields a wash-start, a wash-mid and an
  // end — each its own beat with its own in-point. Those extra windows are added by hand (or by an importer)
  // and are NOT regenerated from the file list, so a re-run must KEEP them or a whole afternoon of pinning
  // in-points is silently erased.
  const fileSet = new Set(shots.map((s) => s.file));
  const kept = (prev.shots || []).filter((p) => !shots.some((s) => s.name === p.name) && fileSet.has(p.file));
  if (kept.length) shots.push(...kept);
  console.log(`\n  (merged with the existing shots.json — pinned in-points kept${kept.length ? `, ${kept.length} hand-added window(s) preserved` : ''})`);
}
for (const s of shots) if (s.inPoint != null) s.availability = Number((s.duration - s.inPoint).toFixed(2));
writeFileSync(sf, JSON.stringify({ slug, source: src, built: new Date().toISOString(), shots }, null, 2));

const unpinned = shots.filter((s) => !s.role || s.inPoint == null).length;
console.log(`\n✓ ${sf}  —  ${shots.length} shot(s), ${unpinned} still to classify`);
console.log('  Next: look at the sheets, then set each shot\'s `role` (PROBLEM/PRODUCT/ACTION/PROOF/PERSON)');
console.log('  and `inPoint` (the second where the beat READS). Re-run to recompute availability.');
console.log('  Then plan the slate — vary opening, spine, audio mode and length — and get it approved BEFORE building.\n');
