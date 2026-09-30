#!/usr/bin/env node
// setup.mjs — what this kit needs, what each thing buys you, and what breaks without it.
//
//   node scripts/setup.mjs                          # what is set, what is missing, and why each matters
//   node scripts/setup.mjs --set OPENAI_API_KEY=sk-…   # write one into .env (gitignored, never packaged)
//
// Deliberately NOT interactive. A prompt that blocks on stdin is hostile inside an agent session and awkward
// in CI; this reports, and the skill does the asking in conversation where a question belongs.
//
// The point of this file is the WHY column. "Optional" tells someone nothing — they need to know that without
// a transcription key, QA cannot check the video says the script, so it will report UNVERIFIED rather than a
// pass. That is a real consequence, and it should be visible before they spend anything.

import './../lib/env.mjs';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const A = process.argv.slice(2);
const setArg = A.find((a) => a.startsWith('--set'));

const KEYS = [
  {
    key: 'OPENAI_API_KEY',
    need: 'strongly recommended',
    buys: 'QA — transcribes the finished video and checks it against the script; also transcribes reference ads that have no captions',
    without: 'QA reports NOT VERIFIED instead of a pass. It will never claim a video is fine when it could not check it, so you lose the check, not the honesty.',
    where: 'platform.openai.com → API keys',
  },
  {
    key: 'ELEVENLABS_API_KEY',
    need: 'only for voice or music',
    buys: 'narration on a cut (vo.mjs) and a generated music bed (bgm.mjs)',
    without: 'use the footage\'s own audio, or supply your own music file — both are first-class paths, not workarounds',
    where: 'elevenlabs.io → profile → API key. Music needs the `music_generation` scope; a key without it returns 401 on bgm only.',
  },
];

const state = (k) => {
  const v = process.env[k];
  if (!v) return { set: false };
  const fromFile = existsSync('.env') && new RegExp(`^${k}=`, 'm').test(readFileSync('.env', 'utf8'));
  return { set: true, where: fromFile ? '.env' : 'your shell', masked: `${v.slice(0, 6)}…${v.slice(-4)}` };
};

// ── --set ───────────────────────────────────────────────────────────────────────────────────────────────────
if (setArg) {
  const pair = setArg.includes('=') ? setArg.slice(setArg.indexOf('=') + 1) : A[A.indexOf(setArg) + 1];
  const eq = String(pair || '').indexOf('=');
  if (eq < 1) { console.error('usage: node scripts/setup.mjs --set KEY=value'); process.exit(1); }
  const k = pair.slice(0, eq).trim(), v = pair.slice(eq + 1).trim();
  if (!KEYS.some((x) => x.key === k)) {
    console.error(`\n⛔ "${k}" is not a key this kit uses. It wants: ${KEYS.map((x) => x.key).join(', ')}`);
    console.error('   Nothing else is needed — rendering goes through the diffusr MCP, which signs in separately.\n');
    process.exit(1);
  }
  let body = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
  if (new RegExp(`^${k}=`, 'm').test(body)) body = body.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`);
  else body += `${body && !body.endsWith('\n') ? '\n' : ''}${k}=${v}\n`;
  writeFileSync('.env', body);
  if (!existsSync('.gitignore') || !/^\.env$/m.test(readFileSync('.gitignore', 'utf8'))) appendFileSync('.gitignore', '\n.env\n');
  console.log(`\n✓ ${k} written to .env (gitignored, and never included in a package)\n`);
  process.exit(0);
}

// ── report ──────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\nADKIT SETUP — what it needs, and why\n');

const mcp = existsSync('.mcp.json') && (() => {
  try { return !!JSON.parse(readFileSync('.mcp.json', 'utf8')).mcpServers?.diffusr; } catch { return false; }
})();
console.log('  1. diffusr  — NOT a key. It signs in through Claude Code.');
console.log(`     ${mcp ? 'Already wired in .mcp.json' : 'MISSING from .mcp.json — run: claude mcp add --transport http diffusr https://app.diffusr.ai/api/mcp'}`);
console.log('     Restart Claude Code in this folder, approve the server, then /mcp to sign in.');
console.log('     Needed to RENDER anything new. Recutting footage you already have, and every edit, work without it.\n');

KEYS.forEach((k, i) => {
  const st = state(k.key);
  console.log(`  ${i + 2}. ${k.key}  (${k.need})`);
  console.log(`     ${st.set ? `✓ set — ${st.masked}, from ${st.where}` : '· not set'}`);
  console.log(`     buys you:  ${k.buys}`);
  console.log(`     without:   ${k.without}`);
  if (!st.set) console.log(`     get one:   ${k.where}`);
  console.log(`     set it:    node scripts/setup.mjs --set ${k.key}=…\n`);
});

const missing = KEYS.filter((k) => !state(k.key).set);
console.log(missing.length
  ? `  ${missing.length} of ${KEYS.length} not set. Nothing here blocks you from starting — the kit says what it\n`
    + '  cannot do rather than pretending. Add them when you want the stage they unlock.\n'
  : '  Everything set.\n');
console.log('  Check the machine itself:  node scripts/verify.mjs\n');
