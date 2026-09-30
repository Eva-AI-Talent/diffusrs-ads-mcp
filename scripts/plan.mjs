#!/usr/bin/env node
// plan.mjs — turn a script into a clip plan with timings and a PRICE QUOTE, before any credit is spent.
//
//   node scripts/plan.mjs <slug> <VIDEO> [--model seedance-2-5] [--res 480p|720p] [--rooms 1]
//   node scripts/plan.mjs --text "line one. line two." [--model …]
//
// Implements diffusr's own timing arithmetic so the plan matches what the render will actually do:
//   · a line takes  words ÷ 3  seconds
//   · a take/clip = the sum of its lines + 1s, rounded up, minimum 4s
//   · ≤30s and ONE room  → ONE take (seedance-2-5 goes to 30s)
//   · longer, or >1 room → one clip per line (4–10s each), joined with hard jump cuts
//
// The quote is an ESTIMATE from the published per-second rates. It is NOT authoritative: always call the make
// tool with dry_run:true for the real figure, and show the user that number before spending. 1 credit = $0.01.

import { existsSync, readFileSync } from 'node:fs';

const A = process.argv.slice(2);
const val = (f, d = null) => { const i = A.indexOf(f); return i !== -1 && A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : d; };
const pos = A.filter((a, i) => !a.startsWith('--') && !(i > 0 && A[i - 1].startsWith('--')));

// Published rates (credits/second, approximate) + limits, from the diffusr model list. Re-check with dry_run.
const MODELS = {
  'seedance-2-mini':   { rate: 10.21, maxSec: 15, maxRefs: 9,  maxAudio: 3  },
  'seedance-2-0-fast': { rate: 16.33, maxSec: 15, maxRefs: 9,  maxAudio: 3  },
  'seedance-2-0':      { rate: 20.41, maxSec: 15, maxRefs: 9,  maxAudio: 3  },
  'seedance-2-5':      { rate: 31.20, maxSec: 30, maxRefs: 30, maxAudio: 10 },
};
const RES_FACTOR = { '480p': 0.45, '720p': 1 };   // "480p is under half the price of 720p" — approximate

const model = val('--model', 'seedance-2-5');
const res = val('--res', '720p');
const rooms = Number(val('--rooms', 1)) || 1;
if (!MODELS[model]) { console.error(`✗ unknown model "${model}". One of: ${Object.keys(MODELS).join(', ')}`); process.exit(1); }
if (!RES_FACTOR[res]) { console.error(`✗ --res must be 480p or 720p`); process.exit(1); }
const M = MODELS[model];

// ── get the lines ───────────────────────────────────────────────────────────────────────────────────────────
let lines = [];
let label = 'ad-hoc';
const text = val('--text');
if (text) {
  lines = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
} else {
  const [slug, video] = pos;
  if (!slug || !video) { console.error('usage: node scripts/plan.mjs <slug> <VIDEO> [--model …] [--res …] [--rooms N]\n   or: node scripts/plan.mjs --text "…"'); process.exit(1); }
  const f = `briefs/${slug}/scripts/${video}.md`;
  if (!existsSync(f)) { console.error(`✗ no script at ${f} — write it first (see the adkit-brief skill, stage: script).`); process.exit(1); }
  label = `${slug}/${video}`;
  // Spoken lines only: skip headings, blank lines, italic TODO notes and bullet metadata.
  lines = readFileSync(f, 'utf8').split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('_') && !l.startsWith('- ') && !l.startsWith('>'))
    .flatMap((l) => l.replace(/^\*\*[^*]+\*\*:?\s*/, '').split(/(?<=[.!?])\s+/))  // strip "**HOOK:** " labels
    .map((s) => s.trim()).filter(Boolean);
}
if (!lines.length) { console.error('✗ no spoken lines found.'); process.exit(1); }

// ── timing: words ÷ 3, clip = sum + 1s, ceil, min 4 ─────────────────────────────────────────────────────────
const words = (s) => s.split(/\s+/).filter(Boolean).length;
const lineSec = (s) => words(s) / 3;
const clipSec = (secs) => Math.max(4, Math.ceil(secs.reduce((a, b) => a + b, 0) + 1));

const totalLineSec = lines.reduce((a, l) => a + lineSec(l), 0);
const oneTakeSec = clipSec(lines.map(lineSec));
const fitsOneTake = oneTakeSec <= Math.min(30, M.maxSec) && rooms === 1;

const plan = [];
if (fitsOneTake) {
  let t = 0;
  const cuts = lines.map((l) => { t += lineSec(l); return t; });
  const scale = oneTakeSec / (cuts[cuts.length - 1] || 1);
  plan.push({
    kind: 'take', n: 1, seconds: oneTakeSec,
    beats: lines.map((l, i) => ({
      from: i === 0 ? 0 : Math.round(cuts[i - 1] * scale),
      to: Math.round(cuts[i] * scale),
      line: l,
    })),
  });
} else {
  lines.forEach((l, i) => {
    const s = Math.min(10, clipSec([lineSec(l)]));   // one clip per line, 4–10s
    plan.push({ kind: 'clip', n: i + 1, seconds: s, beats: [{ from: 0, to: s, line: l }] });
  });
}

const totalSec = plan.reduce((a, p) => a + p.seconds, 0);
const credits = totalSec * M.rate * RES_FACTOR[res];
const usd = credits / 100;

// ── report ──────────────────────────────────────────────────────────────────────────────────────────────────
console.log(`\nPLAN — ${label}`);
console.log(`  model ${model} · ${res} · ${rooms} room(s) · ${lines.length} spoken line(s) · ${totalLineSec.toFixed(1)}s of speech\n`);
console.log(fitsOneTake
  ? `  ► ONE TAKE of ${totalSec}s — every line in a single continuous performance (best consistency).`
  : `  ► ${plan.length} CLIPS, one per line, joined with hard jump cuts.\n`
    + `    ${rooms > 1 ? `Reason: ${rooms} rooms — a take cannot change room.` : `Reason: ${oneTakeSec}s exceeds the ${Math.min(30, M.maxSec)}s take limit.`}\n`
    + `    Clip 1 renders FIRST and alone; its voice + 2 clean frames then keep every later clip on the same\n`
    + `    person, voice and room. A clip in a DIFFERENT room gets that room's picture and NO frames.`);
console.log('');
for (const p of plan) {
  console.log(`  ${p.kind === 'take' ? 'Take' : `Clip ${p.n}`} — ${p.seconds}s`);
  for (const b of p.beats) console.log(`    ${String(b.from).padStart(2)}s-${String(b.to).padStart(2)}s  "${b.line}"`);
}
console.log(`\n  refs available: ${M.maxRefs} pictures · ${M.maxAudio} voice clips  (1–8 subjects render most reliably)`);
console.log(`\n  ESTIMATE  ${totalSec}s × ${M.rate}/s${res === '480p' ? ' × ~0.45 (480p)' : ''} ≈ ${Math.round(credits)} credits ≈ $${usd.toFixed(2)}`);
if (res === '720p') {
  const draft = totalSec * M.rate * RES_FACTOR['480p'];
  console.log(`            a 480p draft first would be ≈ ${Math.round(draft)} credits ≈ $${(draft / 100).toFixed(2)}`);
}
console.log(`\n  ⚠ ESTIMATE ONLY. Call each make tool with dry_run:true for the real figure, show the user that`);
console.log(`    number, and get an explicit yes before spending.\n`);
