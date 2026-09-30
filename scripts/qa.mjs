#!/usr/bin/env node
// qa.mjs — check a render against its script before anyone sees it.
//
//   node scripts/qa.mjs <slug> <VIDEO> [--file <mp4>] [--strict]
//
// The failure this catches: the model drops, slurs or substitutes words, and the clip still LOOKS fine. You
// only notice after it ships. So transcribe what was actually said and diff it against the script.
//
// Needs ffmpeg, and OPENAI_API_KEY for the transcription. Without the key it reports honestly that speech was
// NOT verified rather than passing the video silently — a QA step that can't run must never look like a pass.
//
// Uses gpt-4o-transcribe: whisper-1 quietly drops words, which is the very fault we are looking for.

import '../lib/env.mjs';        // keys come from .env as well as the shell
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const A = process.argv.slice(2);
const has = (f) => A.includes(f);
const val = (f, d = null) => { const i = A.indexOf(f); return i !== -1 && A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : d; };
const pos = A.filter((a, i) => !a.startsWith('--') && !(i > 0 && A[i - 1].startsWith('--')));
const [slug, video] = pos;
if (!slug || !video) { console.error('usage: node scripts/qa.mjs <slug> <VIDEO> [--file <mp4>] [--strict]'); process.exit(1); }

// ── locate the render ───────────────────────────────────────────────────────────────────────────────────────
let file = val('--file');
if (!file) {
  const cands = [`briefs/${slug}/delivery/${video}.mp4`, `briefs/${slug}/renders/${video}`];
  if (existsSync(cands[0])) file = cands[0];
  else if (existsSync(cands[1])) {
    const c = readdirSync(cands[1]).filter((n) => /\.(mp4|mov|webm|mkv)$/i.test(n))
      .map((n) => ({ n, k: Number((n.match(/(\d+)/) || [])[1] ?? 0) })).sort((a, b) => a.k - b.k);
    if (c.length === 1) file = `${cands[1]}/${c[0].n}`;
    else if (c.length > 1) { console.error(`✗ ${c.length} clips in ${cands[1]} — assemble them first, or pass --file.`); process.exit(1); }
  }
}
if (!file || !existsSync(file)) { console.error(`✗ no render found. Pass --file <mp4>.`); process.exit(1); }

// ── the script it should be saying ──────────────────────────────────────────────────────────────────────────
const sf = `briefs/${slug}/scripts/${video}.md`;
if (!existsSync(sf)) { console.error(`✗ no script at ${sf} — nothing to check against.`); process.exit(1); }
const expected = readFileSync(sf, 'utf8').split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#') && !l.startsWith('_') && !l.startsWith('- ') && !l.startsWith('>'))
  .map((l) => l.replace(/^\*\*[^*]+\*\*:?\s*/, ''))
  .join(' ');

// ── transcribe what was actually said ───────────────────────────────────────────────────────────────────────
mkdirSync(`briefs/${slug}/qa`, { recursive: true });
const report = (verdict, lines, exitCode) => {
  const out = `# QA — ${slug}/${video}\n\nFile: ${file}\nVerdict: ${verdict}\n\n${lines.join('\n')}\n`;
  writeFileSync(`briefs/${slug}/qa/${video}.md`, out);
  console.log(`\n${verdict}\n`);
  for (const l of lines) console.log(l);
  console.log(`\n  report: briefs/${slug}/qa/${video}.md\n`);
  process.exit(exitCode);
};

if (!process.env.OPENAI_API_KEY) {
  report('⚠ NOT VERIFIED — speech was not checked', [
    '  OPENAI_API_KEY is not set, so the spoken audio could not be transcribed.',
    '  This is NOT a pass. Either set the key and re-run, or watch the clip yourself and confirm every',
    '  line is said in full before you ship it.',
    '',
    '  Still worth checking by eye: is the product label correct? does the face match the reference?',
    '  does the room stay the same? any warping on the hands or mouth?',
  ], 2);
}

const mp3 = `briefs/${slug}/qa/${video}.mp3`;
try { execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', mp3]); }
catch (e) { console.error(`✗ could not extract audio: ${String(e.message).slice(0, 140)}`); process.exit(1); }

// ── transcribe in SHORT OVERLAPPING WINDOWS, not one shot ───────────────────────────────────────────────────
// A single whole-file pass silently drops the tail: a 12s cut with music and SFX came back missing its last
// line entirely, and the QA reported a 60% failure on a video whose audio was perfect. Transcribing the same
// window on its own returned the line word for word. So: short windows with an overlap, stitched — the same
// reason forced alignment uses short primed windows rather than one long pass.
const WIN = 8, OVER = 1.5;
const total = (() => { try { return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3], { encoding: 'utf8' }).trim()) || 0; } catch { return 0; } })();
const windows = [];
for (let t = 0; t < Math.max(total, 1); t += (WIN - OVER)) windows.push(t);

const transcribe = async (file) => {
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(file)], { type: 'audio/mpeg' }), 'a.mp3');
  fd.append('model', 'gpt-4o-transcribe');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions',
    { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: fd });
  if (!r.ok) { console.error(`✗ transcription returned ${r.status}: ${(await r.text()).slice(0, 160)}`); process.exit(1); }
  return (await r.json()).text || '';
};

const pieces = [];
for (const [i, t] of windows.entries()) {
  const w = `${mp3.replace(/\.mp3$/, '')}-w${i}.mp3`;
  try { execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(t), '-t', String(WIN), '-i', mp3, '-ac', '1', '-ar', '16000', w]); }
  catch { continue; }
  pieces.push(await transcribe(w));
  try { execFileSync('rm', ['-f', w]); } catch {}
}

// stitch, dropping the repeated words the overlap produces
const norm0 = (x) => x.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
let said = '';
for (const p of pieces) {
  const pw = norm0(p).split(' ').filter(Boolean);
  const sw = norm0(said).split(' ').filter(Boolean);
  let best = 0;
  for (let k = Math.min(12, pw.length, sw.length); k > 0; k--) {
    if (sw.slice(-k).join(' ') === pw.slice(0, k).join(' ')) { best = k; break; }
  }
  said = (said ? said + ' ' : '') + p.split(/\s+/).slice(best).join(' ');
}
said = said.trim();

// ── diff: which scripted words never got said ───────────────────────────────────────────────────────────────
// The BRAND is normalised out of the comparison on both sides. No recogniser spells a brand the way the label
// does — "RevoGLOV" comes back as "RevoGlove" — and failing a perfectly good take over that trains people to
// ignore the gate. Pronunciation of the brand is checked by EAR, not by this diff.
const brandName = (() => {
  for (const f of [`briefs/${slug}/brand.json`, `briefs/${slug}/state.json`]) {
    try { const j = JSON.parse(readFileSync(f, 'utf8')); const b = j.wordmark || j.product?.name; if (b) return String(b).split(/[-|–—]/)[0].trim(); } catch {}
  }
  return null;
})();
const norm = (s) => {
  let t = s.toLowerCase();
  if (brandName) t = t.split(brandName.toLowerCase()).join(' ');
  return t.replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
};
const wantW = norm(expected).split(' ').filter(Boolean);
const gotW = norm(said).split(' ').filter(Boolean);

// walk the spoken words in order, consuming matches — order-aware, so a repeat elsewhere can't mask a drop
const gotPool = [...gotW];
const missing = [];
for (const w of wantW) {
  const i = gotPool.indexOf(w);
  if (i === -1) missing.push(w);
  else gotPool.splice(0, i + 1);
}
const extra = gotPool.filter((w) => !wantW.includes(w));
const coverage = wantW.length ? ((wantW.length - missing.length) / wantW.length) * 100 : 100;

const lines = [
  `  script  (${wantW.length} words): ${expected}`,
  `  spoken  (${gotW.length} words): ${said.trim()}`,
  '',
  `  coverage: ${coverage.toFixed(1)}% of scripted words spoken, in order`,
  missing.length ? `  ⛔ MISSING (${missing.length}): ${missing.join(', ')}` : '  ✅ no scripted words missing',
  extra.length ? `  ⚠ extra/substituted words heard: ${extra.slice(0, 20).join(', ')}` : '',
  '',
  '  Still check by eye — transcription cannot see these:',
  '   · is the product label exactly right (shape, text, colour)?',
  '   · does the face match the reference still, in every clip?',
  '   · does the room stay the same, or drift between clips?',
  '   · warping on hands or mouth? extra fingers? a third hand?',
].filter(Boolean);

const threshold = has('--strict') ? 100 : 95;
if (coverage < threshold) {
  lines.push('', `  A missing word is usually a scene that needs ONE re-render — not a rebuild of the whole video.`);
  report(`⛔ FAIL — ${coverage.toFixed(1)}% coverage (threshold ${threshold}%)`, lines, 1);
}
report(`✅ PASS — ${coverage.toFixed(1)}% coverage`, lines, 0);
