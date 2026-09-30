#!/usr/bin/env node
// vo.mjs — generate the narration for a cut. OPTIONAL: needs ELEVENLABS_API_KEY.
//
//   node scripts/vo.mjs <slug> <cut-id>              # generate every line, measure, gate
//   node scripts/vo.mjs <slug> <cut-id> --line 2     # re-roll one line
//   node scripts/vo.mjs <slug> <cut-id> --voices     # list the voices on the account
//
// THE COPY LIVES IN briefs/<slug>/remix/cuts/<cut-id>.vo.json — never inside this script.
// (Keeping lines only in an ad-hoc generator once lost them entirely; they had to be recovered by transcribing
// the wavs afterwards.)
//
// {
//   "voiceId": "…",                     // YOUR voice — see "pick a voice" below
//   "model": "eleven_v3",               // v3 is expressive; v2 holds any text but reads flat
//   "settings": { "stability": 0.5, "similarity_boost": 1.0, "style": 0.6, "use_speaker_boost": true },
//   "brand": "RevoGLOV",                // protected from the CAPS pass, and ignored when gating
//   "lines": [ { "beat": 1, "text": "My hands were wrecked every winter." } ]
// }
//
// ── PICK A VOICE: use a CLONE, not a library voice ──────────────────────────────────────────────────────────
// A library voice labelled "neutral" measures around 4.6 semitones of pitch range and NO setting fixes that —
// it reads flat however you tune it. v3's tags roughly double any voice's range, but **stability 0.0
// ("Creative") drags a library voice's accent** — it has turned Australian voices American. A CLONE carries its
// speaker's accent through v3 where a library voice does not. So: clone the voice you want, and run it at
// stability ~0.5. 4–7 semitones of spread is a normal expressive read.
//
// ── v3 RUNS LONG ────────────────────────────────────────────────────────────────────────────────────────────
// A tagged v3 read runs roughly 1.8× longer than the same line on v2. That WILL break beats that fitted before,
// so this script measures every line and prints the beat timings you need — re-time the cut from these numbers
// rather than assuming the plan still holds.

import '../lib/env.mjs';        // keys come from .env as well as the shell
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const A = process.argv.slice(2);
const has = (f) => A.includes(f);
const val = (f, d = null) => { const i = A.indexOf(f); return i !== -1 && A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : d; };
const pos = A.filter((a, i) => !a.startsWith('--') && !(i > 0 && A[i - 1].startsWith('--')));
const [slug, cutId] = pos;

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error('✗ ELEVENLABS_API_KEY is not set — VO is an OPTIONAL stage.\n'
    + '  Without it, use audio mode "native" (the clips\' own voices) or "bed" (music only).\n'
    + '  With it, clone the voice you want first — a library voice reads flat and no setting fixes that.');
  process.exit(4);
}
const EL = 'https://api.elevenlabs.io/v1';
const hdr = { 'xi-api-key': KEY };

if (has('--voices')) {
  const r = await fetch(`${EL}/voices`, { headers: hdr });
  if (!r.ok) { console.error(`✗ voices ${r.status}: ${(await r.text()).slice(0, 160)}`); process.exit(1); }
  const { voices } = await r.json();
  console.log(`\n${voices.length} voice(s):\n`);
  for (const v of voices) console.log(`  ${v.voice_id}  ${String(v.name).padEnd(24)} ${v.category || ''}`);
  console.log('\n  Prefer a CLONE (category "cloned"). A library voice reads flat through any settings.\n');
  process.exit(0);
}

if (!slug || !cutId) { console.error('usage: node scripts/vo.mjs <slug> <cut-id> [--line N] | --voices'); process.exit(1); }
const voFile = `briefs/${slug}/remix/cuts/${cutId}.vo.json`;
if (!existsSync(voFile)) { console.error(`✗ no VO copy at ${voFile} — write the lines there first (see the header for the shape).`); process.exit(1); }
const vo = JSON.parse(readFileSync(voFile, 'utf8'));
if (!vo.voiceId) { console.error('✗ no voiceId. Run --voices and pick a CLONE.'); process.exit(1); }

const outDir = `briefs/${slug}/remix/vo/${cutId}`;
mkdirSync(outDir, { recursive: true });

const model = vo.model || 'eleven_v3';
const settings = vo.settings || { stability: 0.5, similarity_boost: 1.0, style: 0.6, use_speaker_boost: true };
if (Number(settings.stability) === 0) {
  console.log('  ⚠ stability 0.0 drags a voice toward a generic accent — 0.5 holds it. Continuing as asked.');
}

// UGC markup: CAPS on an emphasis word + light inline tags. The BRAND is protected from the CAPS pass —
// a different capitalisation is a different SPELLING to the engine, and the spelling is the pronunciation.
const markup = (text, brand) => {
  if (vo.markup === false) return text;
  const guard = brand ? new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi') : null;
  const held = [];
  let t = brand ? text.replace(guard, (m) => { held.push(m); return `\u0000${held.length - 1}\u0000`; }) : text;
  t = t.replace(/\b(never|nothing|one|zero|instantly|actually|every)\b/gi, (m) => m.toUpperCase());
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)]);
};

const lines = vo.lines || [];
const only = Number(val('--line', 0)) || 0;
const results = [];

for (const [i, ln] of lines.entries()) {
  const n = i + 1;
  if (only && only !== n) continue;
  const file = `${outDir}/line-${String(n).padStart(2, '0')}.mp3`;
  const text = markup(ln.text, vo.brand);

  const r = await fetch(`${EL}/text-to-speech/${vo.voiceId}`, {
    method: 'POST',
    headers: { ...hdr, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: model, voice_settings: settings }),
  });
  if (!r.ok) { console.error(`✗ line ${n} — ${r.status}: ${(await r.text()).slice(0, 160)}`); process.exit(1); }
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));

  let secs = 0;
  try { secs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim()) || 0; } catch {}

  // GATE THE TAKE. Normalise numbers and the brand out of the comparison first: a recogniser writes
  // "twenty four ninety five" as "$24.95", and no recogniser spells a brand the way the label does.
  let verdict = 'not gated (no OPENAI_API_KEY)';
  if (process.env.OPENAI_API_KEY) {
    try {
      const fd = new FormData();
      fd.append('file', new Blob([readFileSync(file)], { type: 'audio/mpeg' }), 'a.mp3');
      fd.append('model', 'gpt-4o-transcribe');
      const tr = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: fd });
      if (tr.ok) {
        const said = (await tr.json()).text || '';
        const strip = (s) => s.toLowerCase()
          .replace(vo.brand ? new RegExp(vo.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : /$^/g, ' ')
          .replace(/[0-9$.,%]/g, ' ')
          .replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const want = strip(ln.text).split(' ').filter(Boolean);
        const got = strip(said);
        const missing = want.filter((w) => !got.includes(w));
        verdict = missing.length ? `⛔ MISMATCH — not said: ${missing.join(', ')}` : '✅ matches';
      } else verdict = `transcription ${tr.status}`;
    } catch (e) { verdict = `gate failed: ${String(e.message).slice(0, 60)}`; }
  }

  results.push({ beat: ln.beat ?? n, n, file, seconds: Number(secs.toFixed(2)), verdict, text: ln.text });
  console.log(`  ${String(n).padStart(2)}. ${secs.toFixed(2)}s  ${verdict}   "${ln.text.slice(0, 54)}${ln.text.length > 54 ? '…' : ''}"`);
}

const manifest = `${outDir}/lines.json`;
const prev = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : { lines: [] };
const merged = [...prev.lines.filter((p) => !results.some((r) => r.n === p.n)), ...results].sort((a, b) => a.n - b.n);
writeFileSync(manifest, JSON.stringify({ cutId, voiceId: vo.voiceId, model, settings, lines: merged }, null, 2));

const bad = merged.filter((l) => String(l.verdict).startsWith('⛔'));
const total = merged.reduce((a, l) => a + l.seconds, 0);
console.log(`\n  ${merged.length} line(s), ${total.toFixed(1)}s of narration → ${manifest}`);
if (bad.length) {
  console.log(`\n  ⛔ ${bad.length} line(s) did not say what was written — re-roll them:`);
  for (const b of bad) console.log(`     node scripts/vo.mjs ${slug} ${cutId} --line ${b.n}`);
  console.log('     If a line keeps failing on a brand name, the fix is the SPELLING, not the take —');
  console.log('     a separator inside the word ("Rev-oh-Glove") puts a real pause between syllables that reads');
  console.log('     as a stumble; closing it up ("Revvo-Glove") removes it. Measure, don\'t guess by ear.');
}
console.log('\n  RE-TIME THE BEATS from these durations — a tagged v3 read runs ~1.8× longer than v2, which breaks');
console.log('  beats that fitted before. Let a line OVERRUN its beat rather than stretching the beat to the line.\n');
for (const l of merged) console.log(`    beat ${l.beat} → ${l.seconds}s`);
console.log('');
