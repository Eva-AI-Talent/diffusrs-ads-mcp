#!/usr/bin/env node
// bgm.mjs — generate a music bed for a cut. OPTIONAL: needs ELEVENLABS_API_KEY.
//
//   node scripts/bgm.mjs <slug> <cut-id> [--seconds 20] [--prompt "…"] [--dry]
//
// Writes briefs/<slug>/remix/bgm/<cut-id>.mp3 and points the cut file's `bgm` at it.
//
// WHY THIS AND NOT SFX: music is what a music model is for. UI sounds are NOT — asking a speech/audio engine for
// a "click" or a "ping" returns a ~1.4-second TONE, which is useless as a cut marker. build-cut.mjs synthesises
// click/pop/bell/whoosh from oscillators instead. Use this for the BED only.
//
// LENGTH: generate to the CUT's length (build the picture first, then ask for that many seconds) so the bed does
// not need looping or a hard fade at an arbitrary point. build-cut trims and fades whatever it is given.
//
// ⚠️ If you supply a composition plan, section durations must be RESPECTED — a section shorter than its content
// silently drops material rather than compressing it. Prefer a plain prompt plus a length unless you need
// section control.

import '../lib/env.mjs';        // keys come from .env as well as the shell
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const A = process.argv.slice(2);
const has = (f) => A.includes(f);
const val = (f, d = null) => { const i = A.indexOf(f); return i !== -1 && A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : d; };
const pos = A.filter((a, i) => !a.startsWith('--') && !(i > 0 && A[i - 1].startsWith('--')));
const [slug, cutId] = pos;
if (!slug || !cutId) { console.error('usage: node scripts/bgm.mjs <slug> <cut-id> [--seconds N] [--prompt "…"] [--dry]'); process.exit(1); }

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error('✗ ELEVENLABS_API_KEY is not set — the music bed is an OPTIONAL stage.\n'
    + '  Supply your own track instead: put its path in the cut file\'s "bgm" field.\n'
    + '  (A licensed track you already use is usually the better answer anyway.)');
  process.exit(4);
}

const cutFile = `briefs/${slug}/remix/cuts/${cutId}.json`;
if (!existsSync(cutFile)) { console.error(`✗ no cut file at ${cutFile}`); process.exit(1); }
const cut = JSON.parse(readFileSync(cutFile, 'utf8'));

// Length: the cut's own duration if it has been built, else the sum of its beats (+ end card).
const built = `briefs/${slug}/remix/out/${cutId}.mp4`;
let seconds = Number(val('--seconds', 0)) || 0;
if (!seconds && existsSync(built)) {
  try { seconds = Math.ceil(Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', built], { encoding: 'utf8' }).trim())); } catch {}
}
if (!seconds) {
  seconds = Math.ceil((cut.beats || []).reduce((a, b) => a + (Number(b.seconds) || 0), 0)
    + (cut.endCard ? (Number(cut.endCard.seconds) || 2.5) : 0));
}
seconds = Math.max(10, Math.min(300, seconds + 1));   // a second of tail so the fade has somewhere to go

// A default that suits a UGC product cut: present but never competing with a voice.
const prompt = val('--prompt',
  cut.bgmPrompt
  || `Upbeat modern advertising bed for a short social video, ${cut.style === 'SNAP' ? 'fast and punchy' : 'confident and warm'}, `
   + 'light percussion and a simple hook, no vocals, no lyrics, sits under a voiceover, clean loopable ending');

console.log(`\nBGM for ${slug}/${cutId}`);
console.log(`  ${seconds}s · "${prompt.slice(0, 90)}${prompt.length > 90 ? '…' : ''}"`);
if (has('--dry')) { console.log('\n  [dry] nothing generated.\n'); process.exit(0); }

const outDir = `briefs/${slug}/remix/bgm`;
mkdirSync(outDir, { recursive: true });
const out = `${outDir}/${cutId}.mp3`;

const body = { prompt, music_length_ms: seconds * 1000 };
const r = await fetch('https://api.elevenlabs.io/v1/music', {
  method: 'POST',
  headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
if (!r.ok) {
  const txt = (await r.text()).slice(0, 300);
  console.error(`\n✗ music generation failed — ${r.status}: ${txt}`);
  console.error('  If the endpoint or plan does not support music, supply your own track in the cut\'s "bgm" field.');
  process.exit(1);
}
writeFileSync(out, Buffer.from(await r.arrayBuffer()));

let got = 0;
try { got = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).trim()) || 0; } catch {}
cut.bgm = out;
writeFileSync(cutFile, JSON.stringify(cut, null, 2));

console.log(`\n✓ ${out}  —  ${got.toFixed(1)}s (asked for ${seconds}s)`);
if (got && Math.abs(got - seconds) > 2) console.log(`  ⚠ came back ${got.toFixed(1)}s rather than ${seconds}s — build-cut will trim and fade it to the picture.`);
console.log(`  the cut file now points at it. Rebuild:  node scripts/build-cut.mjs ${slug} ${cutId}\n`);
