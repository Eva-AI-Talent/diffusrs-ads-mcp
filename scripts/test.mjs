#!/usr/bin/env node
// test.mjs — the package's self-test. Run it before shipping, and after any change.
//
//   node scripts/test.mjs
//
// Exercises every gate and every piece of deterministic logic WITHOUT spending a credit or touching the
// network (except nothing — all fixtures are local/synthetic). Exits non-zero on the first real failure.
//
// What it deliberately proves, because each of these has a failure mode that hides:
//   · the template gate REFUSES when nothing fits, instead of picking the nearest
//   · the reference gate REFUSES without the product, and RESETS approval when a sheet changes
//   · QA without a transcription key reads as NOT VERIFIED, never as a pass
//   · assembly orders clips NUMERICALLY (clip-10 last, not second) and re-encodes
//   · the shipping gate CATCHES a planted credential/endpoint, not just passes on clean input

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const WS = 'briefs/__selftest';
let pass = 0, fail = 0;
const results = [];

const run = (args, opts = {}) => {
  try {
    const out = execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
};

function check(name, fn) {
  try {
    const why = fn();
    if (why) { fail++; results.push(`  ✗ ${name}\n      ${why}`); }
    else { pass++; results.push(`  ✓ ${name}`); }
  } catch (e) {
    fail++; results.push(`  ✗ ${name}\n      threw: ${String(e.message).slice(0, 200)}`);
  }
}

const have = (bin) => { try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };

rmSync(WS, { recursive: true, force: true });
console.log('\nadkit self-test\n');

// ── state machine ───────────────────────────────────────────────────────────────────────────────────────────
check('brief init scaffolds a workspace', () => {
  const r = run(['brief.mjs', 'init', '__selftest', '--angle', 'x']);
  if (r.code !== 0) return r.out;
  if (!existsSync(`${WS}/state.json`)) return 'no state.json';
  if (!existsSync(`${WS}/progress.md`)) return 'no progress.md';
});

check('brief init REFUSES a flag in the slug position', () => {
  const r = run(['brief.mjs', 'init', '--client']);
  if (r.code === 0) return 'accepted a flag as the slug';
  if (!/derive it from/i.test(r.out)) return 'did not explain how to fix it';
  if (existsSync('briefs/--client')) return 'scaffolded briefs/--client';
});

check('brief set/persona update state and regenerate progress', () => {
  run(['brief.mjs', 'persona', '__selftest', 'mia', 'status=generated', 'room=kitchen']);
  run(['brief.mjs', 'set', '__selftest', 'V1', 'title=T', 'template=tpl-talking-head']);
  const st = JSON.parse(readFileSync(`${WS}/state.json`, 'utf8'));
  if (st.personas?.mia?.room !== 'kitchen') return 'persona not stored';
  if (st.videos?.V1?.template !== 'tpl-talking-head') return 'video not stored';
  if (!/mia/.test(readFileSync(`${WS}/progress.md`, 'utf8'))) return 'progress.md not regenerated';
});

// ── template-first gate ─────────────────────────────────────────────────────────────────────────────────────
check('template gate matches an obvious talking head', () => {
  const r = run(['scripts/match-template.mjs', 'a creator confesses to her phone camera about her cracked hands']);
  if (r.code !== 0) return `exit ${r.code}: ${r.out}`;
  if (!/tpl-talking-head/.test(r.out)) return 'did not pick the talking-head template';
});

check('template gate REFUSES (exit 3) when nothing fits', () => {
  const r = run(['scripts/match-template.mjs', 'an interpretive dance about quarterly tax filings underwater']);
  if (r.code !== 3) return `expected exit 3, got ${r.code}`;
  if (!/NO TEMPLATE MATCH/.test(r.out)) return 'did not say it found no match';
  if (!/approval/i.test(r.out)) return 'did not demand approval before a from-scratch build';
});

check('template gate REFUSES a HYBRID rather than picking the nearest', () => {
  const r = run(['scripts/match-template.mjs', 'a claymation noir western musical about tax law']);
  if (r.code !== 3) return `expected exit 3, got ${r.code} — it picked the nearest template for a hybrid`;
  if (!/HYBRID REQUEST/.test(r.out)) return 'did not identify it as a hybrid';
});

check('template gate still matches a PLAIN request (no over-triggering)', () => {
  const r = run(['scripts/match-template.mjs', 'explain our product in handmade clay stop motion']);
  if (r.code !== 0) return `refused a legitimate single-style request (exit ${r.code})`;
  if (!/tpl-animation-clay/.test(r.out)) return 'did not match claymation';
});

// ── planner ─────────────────────────────────────────────────────────────────────────────────────────────────
check('planner puts a short single-room script in ONE take', () => {
  const r = run(['scripts/plan.mjs', '--text', 'One two three four five six. Seven eight nine ten.']);
  if (r.code !== 0) return r.out;
  if (!/ONE TAKE/.test(r.out)) return 'did not choose a single take';
});

check('planner splits to clips when there are two rooms', () => {
  const r = run(['scripts/plan.mjs', '--text', 'One two three four five six. Seven eight nine ten.', '--rooms', '2']);
  if (!/CLIPS/.test(r.out)) return 'did not split into clips';
  if (!/2 rooms/.test(r.out)) return 'did not give the room reason';
});

check('planner prices 480p below 720p and labels the estimate', () => {
  const cheap = run(['scripts/plan.mjs', '--text', 'One two three four five six.', '--res', '480p']).out;
  const dear = run(['scripts/plan.mjs', '--text', 'One two three four five six.', '--res', '720p']).out;
  const n = (s) => Number((s.match(/≈ (\d+) credits/) || [])[1] || 0);
  if (!(n(cheap) < n(dear))) return `480p (${n(cheap)}) not cheaper than 720p (${n(dear)})`;
  if (!/ESTIMATE ONLY/.test(cheap)) return 'did not label the figure as an estimate';
});

// ── reference gate ──────────────────────────────────────────────────────────────────────────────────────────
const png = `${WS}/assets/fake.png`;
check('reference gate REFUSES to approve with nothing locked', () => {
  const r = run(['scripts/refs.mjs', '__selftest', 'V1', '--approve']);
  if (r.code === 0) return 'approved an empty reference set';
  if (!/cannot approve/i.test(r.out)) return 'did not explain the refusal';
});

check('reference gate approves once character + product are locked', () => {
  mkdirSync(`${WS}/assets`, { recursive: true });
  writeFileSync(png, Buffer.alloc(20000, 7));                       // >12KB so it passes the thumbnail check
  const st = JSON.parse(readFileSync(`${WS}/state.json`, 'utf8'));
  st.assets = { product: png };
  writeFileSync(`${WS}/state.json`, JSON.stringify(st, null, 2));
  run(['scripts/refs.mjs', '__selftest', 'V1', '--add', 'character', png, '--desc', 'mia']);
  run(['scripts/refs.mjs', '__selftest', 'V1', '--add', 'prop', png, '--desc', 'product']);
  const r = run(['scripts/refs.mjs', '__selftest', 'V1', '--approve']);
  if (r.code !== 0) return r.out;
  const c = run(['scripts/refs.mjs', '__selftest', 'V1', '--check']);
  if (c.code !== 0) return `--check failed after approval: ${c.out}`;
});

check('adding a sheet RESETS approval (no reference slips past review)', () => {
  run(['scripts/refs.mjs', '__selftest', 'V1', '--add', 'env', png, '--desc', 'garage']);
  const r = run(['scripts/refs.mjs', '__selftest', 'V1', '--check']);
  if (r.code === 0) return 'still render-ready after a new sheet was added';
});

// ── QA honesty ──────────────────────────────────────────────────────────────────────────────────────────────
check('QA without a key reports NOT VERIFIED, never a pass', () => {
  mkdirSync(`${WS}/scripts`, { recursive: true });
  writeFileSync(`${WS}/scripts/V1.md`, '# V1\n\nHello there friend.\n');
  const env = { ...process.env }; delete env.OPENAI_API_KEY;
  const r = run(['scripts/qa.mjs', '__selftest', 'V1', '--file', png], { env });
  if (r.code === 0) return 'exited 0 — that reads as a pass';
  if (!/NOT VERIFIED/.test(r.out)) return 'did not say it was unverified';
  if (!/NOT a pass/i.test(r.out)) return 'did not state plainly that this is not a pass';
});

// ── assembly (needs ffmpeg) ─────────────────────────────────────────────────────────────────────────────────
if (have('ffmpeg') && have('ffprobe')) {
  check('assembly joins clips in NUMERIC order and re-encodes', () => {
    const d = `${WS}/renders/V1`;
    mkdirSync(d, { recursive: true });
    const mk = (name, sec, silent) => execFileSync('ffmpeg', silent
      ? ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=320x180:duration=${sec}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `${d}/${name}`]
      : ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=320x180:duration=${sec}`, '-f', 'lavfi', '-i', `sine=frequency=400:duration=${sec}`,
        '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', `${d}/${name}`]);
    mk('clip-1.mp4', 1, false); mk('clip-2.mp4', 1, false); mk('clip-10.mp4', 1, true);
    const r = run(['scripts/assemble.mjs', '__selftest', 'V1']);
    if (r.code !== 0) return r.out;
    const lines = r.out.split('\n').filter((l) => /clip-\d+\.mp4/.test(l));
    const order = lines.map((l) => (l.match(/clip-(\d+)/) || [])[1]);
    if (order.join(',') !== '1,2,10') return `wrong order: ${order.join(',')} (clip-10 must be last)`;
    if (!/silent/.test(r.out)) return 'did not handle the silent clip';
    if (!existsSync(`${WS}/delivery/V1.mp4`)) return 'no output file';
    const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${WS}/delivery/V1.mp4`], { encoding: 'utf8' }).trim());
    if (!(dur > 2.5 && dur < 4)) return `joined duration ${dur}s, expected ~3s`;
  });
} else {
  results.push('  – assembly (skipped: ffmpeg not installed)');
}

// ── the gates must be UNWAIVABLE in the skill text ──────────────────────────────────────────────────────────
// Each of these was found COMPLIANT or AMBIGUOUS by a cold audit: a user could talk the agent past the gate with
// a plain instruction. A rule that folds when someone asks nicely is not a rule, so the wording is asserted here.
check('skill gates carry anti-waiver wording', () => {
  // collapse whitespace first — the skill is hard-wrapped, so a phrase can straddle a line break and a naive
  // regex reports a missing rule that is actually there. (It did, for the QA clause.)
  const sk = readFileSync('.claude/skills/adkit-brief/SKILL.md', 'utf8').replace(/\s+/g, ' ');
  const need = [
    ['mcp-precondition', /if it is not connected, stop and say so/i],
    ['renderer-exclusivity', /do not use them for this work/i],
    ['spend', /blanket yes is not per-call consent/i],
    ['claims', /holds even when the user dictates/i],
    ['references', /not approval/i],
    ['product photo', /is not a photo/i],
    ['format', /not approval of a specific build/i],
    ['QA', /never report a step as done when it was skipped/i],
  ];
  const missing = need.filter(([, re]) => !re.test(sk)).map(([n]) => n);
  if (missing.length) return `gate(s) with no anti-waiver clause: ${missing.join(', ')}`;
});

check('spend ledger reports an empty ledger as a skipped gate', () => {
  const r = run(['scripts/spend.mjs', '__selftest']);
  if (r.code !== 0) return r.out;
  if (!/nothing logged/.test(r.out)) return 'did not flag an empty ledger';
  if (!/gate was skipped/.test(r.out)) return 'an empty ledger must say the gate was skipped, not just be empty';
});

check('storyboard gate flags a beat that outruns its shot', () => {
  // The gate exists to catch this while it is still free to change. A storyboard that renders a doomed plan
  // prettily is worse than none — it launders a problem as an approval.
  const R = `${WS}/remix`;
  mkdirSync(`${R}/cuts`, { recursive: true });
  const shot = { name: 'tiny', file: `${WS}/renders/V1/clip-1.mp4`, duration: 1.0, role: 'ACTION', inPoint: 0.5 };
  writeFileSync(`${R}/shots.json`, JSON.stringify({ slug: '__selftest', shots: [shot] }, null, 2));
  writeFileSync(`${R}/cuts/x.json`, JSON.stringify({ id: 'x', beats: [{ shot: 'tiny', seconds: 5 }] }, null, 2));
  const r = run(['scripts/storyboard.mjs', '__selftest', 'x']);
  if (!/problem\(s\) flagged/.test(r.out)) return 'did not flag the over-long beat or the missing super';
  if (!existsSync(`${R}/_plan/plan.html`)) return 'no plan.html written';
});

// ── shipped docs must describe the shipped code ─────────────────────────────────────────────────────────────
// This has now drifted twice: the README documented only half the kit, and the remix skill claimed VO and the
// style packs were "deliberately NOT here" months after both were added. A doc that describes the package
// wrongly is worse than no doc — the reader trusts it. These are the mechanical parts of that check.
check('every shipped script is documented', () => {
  // The command table lives in the reference now; the README is the walkthrough. A script that exists and is
  // written down nowhere is a script nobody will ever run.
  const docs = readFileSync('README.md', 'utf8') + readFileSync('docs/REFERENCE.md', 'utf8');
  const missing = readdirSync('scripts').filter((f) => /\.mjs$/.test(f) && !docs.includes(f));
  if (missing.length) return `documented nowhere: ${missing.join(', ')}`;
});

check('the README and the reference point at each other, and both exist', () => {
  // Two docs that do not cross-link become two docs that disagree. This is the third doc-drift guard in this
  // file, and it is here because the first two both caught something real.
  const readme = readFileSync('README.md', 'utf8');
  if (!existsSync('docs/REFERENCE.md')) return 'docs/REFERENCE.md is gone but the README links to it';
  if (!/docs\/REFERENCE\.md/.test(readme)) return 'the README no longer points at the reference';
  if (!/README\.md/.test(readFileSync('docs/REFERENCE.md', 'utf8'))) return 'the reference does not point back';
  if (existsSync('docs/GUIDE.md')) return 'docs/GUIDE.md is back — the README is meant to BE the guide';
});

check('no shipped doc claims a feature is absent that ships', () => {
  const claims = [
    // [what a doc might claim is missing, the file that proves it is not]
    [/generated-VO stage \(it needs|VO.*deliberately NOT here|no narration/i, 'scripts/vo.mjs'],
    [/style-pack system with\s+pinned brand tokens.*NOT|no style packs/i, 'styles/organic.json'],
    [/does not recommend|no slate/i, 'scripts/slate.mjs'],
  ];
  const docs = ['README.md', '.claude/skills/adkit-remix/SKILL.md', '.claude/skills/adkit-brief/SKILL.md']
    .filter(existsSync).map((f) => [f, readFileSync(f, 'utf8').replace(/\s+/g, ' ')]);
  for (const [re, proof] of claims) {
    if (!existsSync(proof)) continue;
    for (const [name, body] of docs) if (re.test(body)) return `${name} says a feature is missing, but ${proof} ships`;
  }
});

// ── style packs (loaded by RUNTIME PATH, so the import checker cannot see them) ─────────────────────────────
check('both style packs exist and carry their font + tokens', () => {
  for (const id of ['organic', 'slab']) {
    const f = `styles/${id}.json`;
    if (!existsSync(f)) return `${f} missing — build-cut.mjs loads it at runtime and would fail`;
    const p = JSON.parse(readFileSync(f, 'utf8'));
    if (!p.font?.file) return `${f} has no font.file — the pack IS the look`;
    if (!p.colors || !p.layout) return `${f} is missing colors/layout tokens`;
  }
});

// ── the Diffusion Studio editor ─────────────────────────────────────────────────────────────────────────────
// These run WITHOUT dapi: they test the refusals and the id hashing, which is where the expensive mistakes are.
// (An actual export needs the app, so it is a manual step — see docs/ACCEPTANCE.md.)
const dsFixture = (over = {}) => {
  const dir = 'briefs/__dstest/remix/out';
  mkdirSync(dir, { recursive: true });
  mkdirSync('briefs/__dstest/remix/cuts', { recursive: true });
  const mp4 = resolve(`${dir}/x.mp4`);
  if (!existsSync(mp4)) {
    try {
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=1080x1920:d=2:r=30',
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-shortest', mp4], { stdio: 'ignore' });
    } catch { return null; }
  }
  writeFileSync(`${dir}/x.edit.json`, JSON.stringify({
    cut: 'x', name: 'fixture', base: mp4, pack: 'organic', accent: '#A8D62E', wordmark: 'FIXTURE',
    supersBurned: false, supers: [{ line1: 'One', line2: 'Two', cta: false, t: [0, 1.5] }], endcard: null,
    ...over,
  }));
  return dir;
};

check('the editor REFUSES a base whose supers are burned in', () => {
  if (!dsFixture({ supersBurned: true })) return null;               // no ffmpeg here; the build gate covers it
  const r = run(['scripts/ds-build.mjs', '__dstest', 'x']);
  if (r.code === 0) return 'built an edit over burned supers — every line would print twice';
  if (!/--ds/.test(r.out)) return 'refused without telling the user how to rebuild';
});

check('the editor builds a project whose ids are CONTENT-hashed', () => {
  if (!dsFixture()) return null;
  const r1 = run(['scripts/ds-build.mjs', '__dstest', 'x']);
  if (r1.code !== 0) return r1.out;
  const a = JSON.parse(readFileSync('briefs/__dstest/edit/x/.ds.json', 'utf8')).scene;
  // change ONLY the super text: dapi caches an export per projectId, so this must produce a different id
  dsFixture({ supers: [{ line1: 'Changed', line2: 'Two', cta: false, t: [0, 1.5] }] });
  const r2 = run(['scripts/ds-build.mjs', '__dstest', 'x']);
  if (r2.code !== 0) return r2.out;
  const b = JSON.parse(readFileSync('briefs/__dstest/edit/x/.ds.json', 'utf8')).scene;
  if (a === b) return 'the scene id did not change when the supers did — dapi would re-serve the old render';
  const tsx = readFileSync('briefs/__dstest/edit/x/index.tsx', 'utf8');
  if (!/workarea=\{\[0, /.test(tsx)) return 'no workarea declared — an export covers the workarea';
  if ((tsx.match(/<video /g) || []).length !== 1) return 'the A-roll must be ONE clip or dapi drops audio at the joins';
});

check('the explainer edit REFUSES to invent a window plan', () => {
  if (!dsFixture()) return null;
  rmSync('briefs/__dstest/remix/cuts/x.vox.json', { force: true });
  const r = run(['scripts/ds-vox.mjs', '__dstest', 'x']);
  if (r.code === 0) return 'built an explainer edit with no authored plan';
  if (!/authored/i.test(r.out)) return 'refused without saying the plan has to be authored';
});

check('the edit skill ASKS about supers and look, with defaults', () => {
  // The user asked for this behaviour by name, so it is asserted rather than left to prose drifting away.
  const sk = readFileSync('.claude/skills/adkit-edit/SKILL.md', 'utf8').replace(/\s+/g, ' ');
  const need = [
    ['asks before building', /ask both of these in one message/i],
    ['supers default yes', /Default: yes/i],
    ['organic is the default look', /Organic\W{0,4}\(default\)/i],
    ['branded offered', /Branded/],
    ['vox offered', /Vox motion graphics/i],
    ['peg offered', /Follow a peg/i],
    ["doesn't re-ask what was said", /Do not ask what they have already told you/i],
  ];
  const missing = need.filter(([, re]) => !re.test(sk)).map(([n]) => n);
  if (missing.length) return `the edit skill no longer: ${missing.join(', ')}`;
});

check('the editor offers every look the skill promises', () => {
  if (!dsFixture()) return null;
  const r = run(['scripts/ds-build.mjs', '__dstest', 'x', '--pack', 'branded']);
  if (r.code !== 0) return `--pack branded failed: ${r.out.slice(0, 200)}`;
  const bad = run(['scripts/ds-build.mjs', '__dstest', 'x', '--pack', 'nope']);
  if (bad.code === 0) return 'accepted an unknown pack instead of listing the real ones';
  const vox = run(['scripts/ds-build.mjs', '__dstest', 'x', '--pack', 'vox']);
  if (vox.code === 0 || !/--vox/.test(vox.out)) return 'asking for vox as a pack should point at --vox';
});

check('--no-supers actually draws no supers', () => {
  if (!dsFixture()) return null;
  const r = run(['scripts/ds-build.mjs', '__dstest', 'x', '--no-supers']);
  if (r.code !== 0) return r.out;
  const tsx = readFileSync('briefs/__dstest/edit/x/index.tsx', 'utf8');
  if (/id="st0_0"/.test(tsx)) return 'a super node was written even though supers were turned off';
  if (!/supers OFF/.test(r.out)) return 'did not say supers were off';
});

check('peg-style REFUSES to invent a peg, and never claims a font was measured', () => {
  const r = run(['scripts/peg-style.mjs', '__dstest', 'no-such-peg']);
  if (r.code === 0) return 'accepted a peg that does not exist';
  const src = readFileSync('scripts/peg_style.py', 'utf8');
  if (!/not recoverable from pixels/.test(src)) return 'the measurement no longer admits it cannot read a typeface';
  const sk = readFileSync('.claude/skills/adkit-edit/SKILL.md', 'utf8').replace(/\s+/g, ' ');
  if (!/Never tell them it matched the peg/i.test(sk)) return 'the skill no longer forbids claiming a peg match';
});

check('setup explains WHY each key matters, and refuses an unknown one', () => {
  const r = run(['scripts/setup.mjs']);
  if (r.code !== 0) return r.out;
  // "optional" tells somebody nothing. The consequence is the useful part.
  for (const [what, re] of [['the QA consequence', /NOT VERIFIED/], ['where to get a key', /platform\.openai\.com/],
                            ['the music scope caveat', /music_generation/], ['diffusr is not a key', /NOT a key/]]) {
    if (!re.test(r.out)) return `setup no longer states ${what}`;
  }
  const bad = run(['scripts/setup.mjs', '--set', 'SOME_OTHER_KEY=x']);
  if (bad.code === 0) return 'wrote a key this kit does not use';
});

check('.env is picked up, and the shell still wins over it', () => {
  const keep = existsSync('.env') ? readFileSync('.env', 'utf8') : null;
  try {
    writeFileSync('.env', 'ELEVENLABS_API_KEY=from-dot-env\n');
    const r = run(['-e', "import('./lib/env.mjs').then(()=>console.log(process.env.ELEVENLABS_API_KEY))"]);
    if (!/from-dot-env/.test(r.out)) return `.env was not loaded: ${r.out.slice(0, 120)}`;
    const w = run(['-e', "import('./lib/env.mjs').then(()=>console.log(process.env.ELEVENLABS_API_KEY))"],
      { env: { ...process.env, ELEVENLABS_API_KEY: 'from-shell' } });
    if (!/from-shell/.test(w.out)) return 'a stale .env overrode a key set in the shell';
  } finally {
    if (keep === null) rmSync('.env', { force: true }); else writeFileSync('.env', keep);
  }
});

check('the cut builder knows slide transitions, not just whip', () => {
  const src = readFileSync('scripts/build-cut.mjs', 'utf8');
  for (const k of ['whip', 'slide', 'slideup']) {
    if (!new RegExp(`\\b${k}:\\s*\\{`).test(src)) return `no "${k}" transition in the builder`;
  }
  if (!/swipe:/.test(src)) return 'a slide has no sound of its own';
  // Every transition must carry the audio under it, or it punches a hole in the voice.
  if (!/carries the audio|CARRIES AUDIO/i.test(src)) return 'the audio-carrying rule is no longer stated';
});

check('the edit skill asks about transitions, SFX and music too', () => {
  const sk = readFileSync('.claude/skills/adkit-edit/SKILL.md', 'utf8').replace(/\s+/g, ' ');
  const need = [
    ['transitions', /\*\*transitions\*\*/i], ['slide named', /slide/], ['SFX', /\*\*SFX\*\*/],
    ['a bell', /bell/], ['music', /\*\*music\*\*/], ['music needs a key', /ELEVENLABS_API_KEY/],
    ['hard cuts are the default', /hard cuts/i],
    ['warns against a transition on every beat', /transition on every beat reads as amateur/i],
  ];
  const missing = need.filter(([, re]) => !re.test(sk)).map(([n]) => n);
  if (missing.length) return `the edit skill no longer covers: ${missing.join(', ')}`;
});

check('the brief skill walks a first-timer in', () => {
  const sk = readFileSync('.claude/skills/adkit-brief/SKILL.md', 'utf8').replace(/\s+/g, ' ');
  const need = [
    ['detects a fresh project', /holds nothing but .?_template/i],
    ['runs setup', /scripts\/setup\.mjs/],
    ['explains the QA consequence', /UNVERIFIED/],
    ['asks what we are selling', /What are we selling/i],
    ['asks for the angle', /What should this ad say/i],
    ['recommends a format unasked', /recommend one — do not ask again/i],
    ['does not front-load', /Do not front-load/i],
    ['mentions recutting existing footage', /adkit-remix/],
  ];
  const missing = need.filter(([, re]) => !re.test(sk)).map(([n]) => n);
  if (missing.length) return `first-run onboarding no longer: ${missing.join(', ')}`;
});

check('organic supers are WHITE with black text, on every line', () => {
  const pack = JSON.parse(readFileSync('styles/organic.json', 'utf8'));
  const fills = pack.colors.line_fills;
  if (!fills) return 'organic no longer states its line fills, so the code decides the look again';
  if (fills.some((f) => f.toUpperCase() !== '#FFFFFF')) return `a coloured super line is back: ${fills.join(', ')}`;
  if (pack.colors.ink.toUpperCase() !== '#111111') return 'organic ink is no longer black';
  // ...and the builder must READ that rather than hard-coding a pair.
  if (!/C\.line_fills/.test(readFileSync('scripts/ds-build.mjs', 'utf8'))) return 'ds-build ignores line_fills';
  if (!/line_fills/.test(readFileSync('scripts/build-cut.mjs', 'utf8'))) return 'build-cut ignores line_fills';
});

check('an arrow in a CTA never renders as a tofu box', () => {
  // The obvious character for "tap here" has no glyph in the house fonts. Both renderers must substitute, and
  // must substitute the SAME way, or the burned cut and the edited one disagree.
  const r = run(['-e', "import('./lib/ds-nodes.mjs').then(m=>console.log(m.jsxText('Here \u2b07\ufe0f')))"]);
  if (!/Here \u2193/.test(r.out)) return `the editor path did not substitute: ${JSON.stringify(r.out)}`;
  const py = readFileSync('scripts/render_super.py', 'utf8');
  if (!/glyph_fixer/.test(py)) return 'the burned path no longer checks for missing glyphs';
  if (!/BEFORE measuring/.test(py)) return 'glyphs are fixed after the pills are sized, so the widths are wrong';
});

check('the builder supports jump cuts, and refuses one that cannot work', () => {
  const src = readFileSync('scripts/build-cut.mjs', 'utf8');
  if (!/const J = b\.jump/.test(src)) return 'no jump-cut support in the builder';
  if (!/secs >= 1\.2/.test(src)) return 'a beat too short for a jump is no longer guarded — both halves flash';
  if (!/opening beat/i.test(src)) return 'the opening-super check is gone';
  if (!/CTA super and no end card/i.test(src)) return 'the CTA check is gone';
});

check('the skills carry the super COPY formula, not just the treatment', () => {
  const rm = readFileSync('.claude/skills/adkit-remix/SKILL.md', 'utf8').replace(/\s+/g, ' ');
  const ed = readFileSync('.claude/skills/adkit-edit/SKILL.md', 'utf8').replace(/\s+/g, ' ');
  const need = [
    ['the opening+CTA rule', /super on the OPENING beat and a super on the CTA/i, rm],
    ['a worked example', /How i went from 215 LBS/, rm],
    ['caps guidance', /CAPS one to three words/i, rm],
    ['numbers over adjectives', /Numbers beat adjectives/i, rm],
    ['the CTA shape', /Here \u2b07/, rm],
    ['jump cuts on the emphasis', /Place it on the word that matters/i, rm],
    ['one or two only', /One or two per cut/i, rm],
    ['the edit skill repeats the shape', /How to ACTUALLY/, ed],
    ['the edit skill states white-on-black', /every line white with black text/i, ed],
  ];
  const missing = need.filter(([, re, body]) => !re.test(body)).map(([n]) => n);
  if (missing.length) return `missing from the skills: ${missing.join(', ')}`;
});

check('the README covers every use case, and stays true', () => {
  // A guide is the one file nobody re-reads after writing it, so it rots first — and a wrong guide is worse
  // than none, because the reader believes it. These are the claims it makes that the code has to keep.
  const flat = readFileSync('README.md', 'utf8').replace(/\s+/g, ' ');
  const need = [
    ['a make-an-ad section', /Make an ad from a product link/i],
    ['a recut section', /footage you already have/i],
    ['an editing section', /Change how a cut looks/i],
    ['a peg section', /Copy the look of an ad/i],
    ['an audio section', /Voiceover, music, sound effects/i],
    ['a QA section', /Check it before you post/i],
    ['a cost section', /What it costs/i],
    ['troubleshooting', /## Troubleshooting/],
    ['all four looks', /Vox motion graphics/],
    ['organic is white on black', /white supers, black text/i],
    ['the two default supers', /one on the opening beat, one on the CTA/i],
    ['QA never claims a pass', /never tell you it passed/i],
    ['per-call approval', /per call/i],
    ['the MCP states table', /doesn.t list diffusr/i],
  ];
  const missing = need.filter(([, re]) => !re.test(flat)).map(([n]) => n);
  if (missing.length) return `the guide no longer covers: ${missing.join(', ')}`;
  // A number in prose is a promise that rots; the self-test count is the one that kept changing.
  if (/\b\d+ checks\b/.test(flat)) return 'the README hardcodes a test count, which will drift';
});

check('tighten.mjs cuts on silence, never on a word time', () => {
  const src = readFileSync('scripts/tighten.mjs', 'utf8');
  for (const [what, re2] of [
    ['the relative threshold', /mean - 12/],
    ['the threshold sweep', /\[db, db \+ 4, db \+ 8/],
    ['the acoustic-silence rule', /never on a transcript word time/i],
    ['the pre-cut safety check', /margin < 12/],
    ['gapless prep', /aresample=async=1:first_pts=0/],
    ['CFR 30', /-fps_mode.{0,3}, 'cfr'/],
    ['stderr capture', /const measure = /],
  ]) if (!re2.test(src)) return `tighten.mjs lost ${what}`;
  const r = run(['scripts/tighten.mjs', 'no-such-file.mp4']);
  if (r.code === 0) return 'accepted a file that does not exist';
});

check('the edit skill still carries the media-prep rules remix points at', () => {
  // adkit-remix says "see adkit-edit §1" for the transcode. A rewrite of the edit skill silently broke that
  // cross-reference once already; this is why the check exists.
  const ed = readFileSync('.claude/skills/adkit-edit/SKILL.md', 'utf8');
  if (!/^## 1\. Prep the source/m.test(ed)) return 'adkit-edit §1 is no longer the prep section remix links to';
  for (const [what, re2] of [
    ['the VFR tail-audio symptom', /variable frame rate/i],
    ['the keyframe symptom', /keyframes 3.6s apart|Decoding error/i],
    ['the word-time rule', /never on a transcript word time/i],
    ['the relative-threshold rule', /relative to the file's own noise floor/i],
    ['the source-not-a-cut warning', /SOURCE footage, not a finished cut/i],
  ]) if (!re2.test(ed)) return `adkit-edit §1 lost ${what}`;
  const rm = readFileSync('.claude/skills/adkit-remix/SKILL.md', 'utf8');
  if (/adkit-edit. .1\b/.test(rm) && !/^## 1\. Prep/m.test(ed)) return 'remix points at a section that moved';
});

check('the vox pack exists and carries all three faces', () => {
  const f = 'styles/vox.json';
  if (!existsSync(f)) return `${f} missing — ds-vox.mjs loads it at runtime`;
  const p = JSON.parse(readFileSync(f, 'utf8'));
  for (const role of ['font', 'serif', 'hand']) {
    if (!p[role]?.file) return `${f}: no ${role}.file`;
    if (!p[role]?.install) return `${f}: ${role} has no install line — a lead cannot guess where to get it`;
  }
  if (!p.layout?.cap_y) return `${f}: captions have no per-mode height, so they sit under the cards`;
});

// ── shipping gate ───────────────────────────────────────────────────────────────────────────────────────────
check('shipping gate passes on the clean package', () => {
  const r = run(['scripts/check-no-direct-api.mjs']);
  if (r.code !== 0) return r.out;
});

check('shipping gate CATCHES a planted endpoint + credential', () => {
  const leak = 'lib/__leak_selftest.mjs';
  mkdirSync('lib', { recursive: true });
  // Assembled at runtime so the forbidden literals never appear in this file — otherwise the gate would flag
  // its own test. Keeping the gate exemption-free (only the checker exempts itself) means no hole to exploit.
  const host = ['api', 'higgsfield', 'ai'].join('.');
  const keyName = ['ARK', 'API', 'KEY'].join('_');
  writeFileSync(leak, `const u="https://${host}/x"; const k=process.env.${keyName};\n`);
  const r = run(['scripts/check-no-direct-api.mjs']);
  rmSync(leak, { force: true });
  if (r.code === 0) return 'did not catch the planted leak — the gate is not protecting anything';
  if (!/Higgsfield endpoint/.test(r.out)) return 'caught something, but not the endpoint';
});

// ── report ──────────────────────────────────────────────────────────────────────────────────────────────────
rmSync(WS, { recursive: true, force: true });
rmSync('briefs/__dstest', { recursive: true, force: true });   // the editor fixture — never leave it lying about
console.log(results.join('\n'));
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
