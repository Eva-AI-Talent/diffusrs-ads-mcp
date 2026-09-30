#!/usr/bin/env node
// spend.mjs — the ledger the spend gate was missing.
//
//   node scripts/spend.mjs <slug> --quote 153 --for "V1 480p draft"   # log an APPROVED quote, before the call
//   node scripts/spend.mjs <slug> --total                             # what this brief has cost
//   node scripts/spend.mjs <slug> --budget 2000                       # set a ceiling in credits
//
// Every other gate leaves a trace: the reference gate has an attestation, QA has a report. The spend gate had
// none — so nobody could tell afterwards whether each call was quoted and agreed, or whether one "yes" early on
// got stretched across a dozen renders. A ledger makes that visible without getting in the way.
//
// It cannot ENFORCE anything — the agent calls the render tool directly. What it gives you is an auditable list:
// what was quoted, for what, and when. If the ledger is thin and the bill is not, you know the gate was skipped.
//
// 1 credit = $0.01.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const A = process.argv.slice(2);
const has = (f) => A.includes(f);
const val = (f, d = null) => { const i = A.indexOf(f); return i !== -1 && A[i + 1] != null && !A[i + 1].startsWith('--') ? A[i + 1] : d; };
const slug = A.find((a) => !a.startsWith('--') && !(A[A.indexOf(a) - 1] || '').startsWith('--'));
if (!slug) { console.error('usage: node scripts/spend.mjs <slug> [--quote N --for "what"] [--total] [--budget N]'); process.exit(1); }

const dir = `briefs/${slug}`;
if (!existsSync(dir)) { console.error(`✗ no brief at ${dir}`); process.exit(1); }
const f = `${dir}/spend.json`;
const led = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { slug, budget: null, entries: [] };

if (has('--budget')) {
  led.budget = Number(val('--budget', 0)) || null;
  writeFileSync(f, JSON.stringify(led, null, 2));
  console.log(`✓ budget for ${slug}: ${led.budget} credits ($${(led.budget / 100).toFixed(2)})`);
  process.exit(0);
}

if (has('--quote')) {
  const credits = Number(val('--quote', 0));
  if (!credits) { console.error('✗ --quote needs a number of credits (the dry_run figure, not an estimate)'); process.exit(1); }
  const what = val('--for', '(unlabelled)');
  led.entries.push({ at: new Date().toISOString(), credits, for: what });
  writeFileSync(f, JSON.stringify(led, null, 2));

  const total = led.entries.reduce((a, e) => a + e.credits, 0);
  console.log(`✓ logged ${credits} credits ($${(credits / 100).toFixed(2)}) — ${what}`);
  console.log(`  brief total: ${total} credits ($${(total / 100).toFixed(2)}) over ${led.entries.length} call(s)`);
  if (led.budget && total > led.budget) {
    console.log(`\n  ⚠ OVER BUDGET — ${total} of ${led.budget} credits. Tell the user before the next call;`);
    console.log('    a ceiling they set is not yours to quietly pass.');
  }
  process.exit(0);
}

// default / --total
const total = led.entries.reduce((a, e) => a + e.credits, 0);
console.log(`\nSPEND — ${slug}`);
if (!led.entries.length) {
  console.log('\n  nothing logged.');
  console.log('  If renders HAVE happened, the spend gate was skipped — every approved quote should be logged');
  console.log('  here before the call. That is the only way to tell afterwards that each one was agreed.\n');
  process.exit(0);
}
console.log('');
for (const e of led.entries) {
  console.log(`  ${e.at.slice(0, 16).replace('T', ' ')}  ${String(e.credits).padStart(6)} cr  $${(e.credits / 100).toFixed(2).padStart(6)}  ${e.for}`);
}
console.log(`\n  ${led.entries.length} call(s) · ${total} credits · $${(total / 100).toFixed(2)}`
  + (led.budget ? ` · budget ${led.budget} (${Math.round((total / led.budget) * 100)}%)` : ''));
if (led.budget && total > led.budget) console.log('  ⚠ OVER BUDGET.');
console.log('');
