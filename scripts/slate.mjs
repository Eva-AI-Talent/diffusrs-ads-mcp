#!/usr/bin/env node
// slate.mjs — RECOMMEND a slate of new ads from footage you already have.
//
//   node scripts/slate.mjs <slug>                    # what this library can build, and a proposed slate
//   node scripts/slate.mjs <slug> --all              # every format, including the ones that don't fit yet
//   node scripts/slate.mjs <slug> --count 10         # aim for N cuts
//   node scripts/slate.mjs <slug> --speech-over-action   # action windows have talking over them
//
// Reads briefs/<slug>/remix/shots.json (built by remix.mjs, with roles + in-points filled in) and works out
// which formats the footage can ACTUALLY carry — then proposes a spread across length, spine and audio mode.
//
// This is a recommendation, not a plan. Show it to the user, let them cut it down or swap things, and only
// then write the beat lists. Nothing renders and nothing is spent here.

import { existsSync, readFileSync } from 'node:fs';
import { FORMATS, PACKS, ROLES, feasible, proposeSlate } from '../lib/remix-formats.mjs';

const A = process.argv.slice(2);
const has = (f) => A.includes(f);
const val = (f, d = null) => { const i = A.indexOf(f); return i !== -1 && A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : d; };
const slug = A.find((a) => !a.startsWith('--'));
if (!slug) { console.error('usage: node scripts/slate.mjs <slug> [--all] [--count N] [--speech-over-action]'); process.exit(1); }

const sf = `briefs/${slug}/remix/shots.json`;
if (!existsSync(sf)) {
  console.error(`✗ no shot library at ${sf}\n  Build it first:  node scripts/remix.mjs ${slug} --dir <clips-dir> --sheets`);
  process.exit(1);
}
const lib = JSON.parse(readFileSync(sf, 'utf8'));
const shots = lib.shots || [];

// role counts — only shots that have BOTH a role and a pinned in-point are usable
const usable = shots.filter((s) => s.role && s.inPoint != null);
const counts = Object.fromEntries(ROLES.map((r) => [r, usable.filter((s) => s.role === r).length]));
const unclassified = shots.length - usable.length;

console.log(`\nSLATE — ${slug}`);
console.log(`  ${shots.length} shot(s) inventoried · ${usable.length} classified with an in-point`
  + `${unclassified ? ` · ⚠ ${unclassified} still unclassified` : ''}`);
console.log(`  roles: ${ROLES.map((r) => `${r} ${counts[r]}`).join(' · ')}\n`);

if (!usable.length) {
  console.log('  Nothing is classified yet, so nothing can be recommended honestly.');
  console.log(`  Look at the contact sheets in briefs/${slug}/remix/sheets/, then set each shot's`);
  console.log('  `role` (PROBLEM/PRODUCT/ACTION/PROOF/PERSON) and `inPoint` in shots.json, and re-run.\n');
  process.exit(2);
}

const opts = { silentAction: !has('--speech-over-action') };
const all = feasible(counts, opts);
const ok = all.filter((f) => f.ok);
const no = all.filter((f) => !f.ok);

if (has('--all') || !ok.length) {
  console.log(`  BUILDABLE NOW (${ok.length}/${FORMATS.length})`);
  for (const f of ok) console.log(`    ✓ ${f.name.padEnd(24)} ${f.style.padEnd(8)} ${f.sec[0]}–${f.sec[1]}s`);
  console.log(`\n  NEEDS MORE FOOTAGE (${no.length})`);
  for (const f of no) console.log(`    · ${f.name.padEnd(24)} ${(f.blocked || 'missing ' + f.missing.join(', ')).slice(0, 70)}`);
  console.log('');
}

if (!ok.length) {
  console.log('  ⛔ No format is buildable from what is classified. Classify more shots, or shoot the gap.\n');
  process.exit(3);
}

const want = Number(val('--count', 0)) || 0;
let slate = proposeSlate(counts, opts);
if (want && slate.length > want) slate = slate.slice(0, want);

console.log(`  RECOMMENDED SLATE — ${slate.length} cut(s), no two sharing a format and an audio mode\n`);
for (const [i, f] of slate.entries()) {
  const pack = PACKS.find((p) => p.id === f.pack);
  console.log(`  ${String(i + 1).padStart(2)}. ${f.name}  ·  ${f.style}  ·  ${f.sec[0]}–${f.sec[1]}s  ·  audio: ${f.audio}  ·  look: ${pack.name}`);
  console.log(`      ${f.grammar}`);
  console.log(`      ${f.why}`);
  if (f.note) console.log(`      ⚠ ${f.note}`);
  if (f.perPerson) console.log(`      ↳ run this ONCE PER PERSON — each is a near-free extra cut that tests which face performs.`);
  console.log('');
}

const totalSec = slate.reduce((a, f) => a + (f.sec[0] + f.sec[1]) / 2, 0);
console.log(`  ≈ ${Math.round(totalSec)}s of finished ad across ${slate.length} cuts — and ZERO render credits:`);
console.log('    every one of these is cut from footage that already exists.\n');
console.log('  LOOK PACKS');
for (const p of PACKS) console.log(`    ${p.name.padEnd(12)} reads as ${p.reads} — ${p.use}${p.needsBrandTokens ? ' (needs the brand\'s colour/wordmark)' : ''}`);
console.log('\n  Cheapest extra variations: re-run the best performers in the OTHER look pack, and make a');
console.log('  speech / no-speech version of each — same picture, different ad to the algorithm.\n');
console.log('  NEXT: show this to the user and let them cut it down or swap things. Only once they approve do you');
console.log('  write the beat lists (shot → what it shows → duration) and build. Never build an unapproved slate.\n');
