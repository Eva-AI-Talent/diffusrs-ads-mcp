#!/usr/bin/env node
// peg.mjs — pull a reference ad ("peg") so we can script against it: the clip, its transcript, and a structured
// analysis stub. Uses yt-dlp, never a browser.
//
//   node scripts/peg.mjs <url> [--slug <brief>] [--novideo]
//   node scripts/peg.mjs --file <local.mp4> [--slug <brief>]     # a screen-recording the user made
//
// Handles TikTok, YouTube, Instagram Reels and Facebook Reels. A **Meta Ad Library** link
// (facebook.com/ads/library/?id=…) is the one yt-dlp cannot read — its single-ad deep link renders an age gate
// with no <video> in the DOM — so it is handed off to scripts/adlib.mjs, which reads the advertiser's PUBLIC
// logged-out grid view.
//
// ETHICS — non-negotiable, inherited from the house rules:
//   · never log in   · never click through an age gate   · never evade a bot challenge (repeated blocks → abort)
//   · public logged-out pages only
//   · if a peg cannot be fetched, SAY SO. Then ask the user to SCREEN-RECORD the ad (play it, record the
//     screen, save the file into briefs/<slug>/pegs/) and ingest that with --file. NEVER pretend a peg was read,
//     and never work around the block to get it.
//
// Writes into briefs/<slug>/pegs/<id>/ (or ./pegs/<id>/ with no --slug):
//   <id>.<ext>            the clip
//   <id>.transcript.txt   captions if the platform has them, else a transcription, else an honest placeholder
//   <id>.meta.json        title / uploader / duration / url
//   <id>.peg.md           the analysis stub the agent fills in (hook, beats, format signals)

import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { scoreTemplates } from './match-template.mjs';

const A = process.argv.slice(2);
const has = (f) => A.includes(f);
const val = (f, d = null) => { const i = A.indexOf(f); return i !== -1 && A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : d; };
const url = A.find((a) => /^https?:\/\//.test(a));
const slug = val('--slug');

const localFile = val('--file');

// ── a SCREEN-RECORDING the user made (the fallback whenever an ad cannot be fetched) ────────────────────────
// This is how a gated, private or region-blocked ad still becomes a usable peg: the user plays it, records the
// screen, and we ingest that file exactly as if it had been downloaded. Same artefacts, same template match.
if (localFile) {
  if (!existsSync(localFile)) { console.error(`✗ no such file: ${localFile}`); process.exit(1); }
  const id = localFile.split('/').pop().replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-');
  const dir = slug ? `briefs/${slug}/pegs/${id}` : `pegs/${id}`;
  mkdirSync(dir, { recursive: true });
  const base = `${dir}/${id}`;
  let seconds = null;
  try { seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', localFile], { encoding: 'utf8' }).trim()) || null; } catch {}

  let transcript = '(no transcript — set OPENAI_API_KEY to transcribe the recording)';
  let tSource = 'none';
  if (process.env.OPENAI_API_KEY) {
    try {
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', localFile, '-vn', '-ac', '1', '-ar', '16000', `${base}.mp3`]);
      const fd = new FormData();
      fd.append('file', new Blob([readFileSync(`${base}.mp3`)], { type: 'audio/mpeg' }), 'a.mp3');
      fd.append('model', 'gpt-4o-transcribe');
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions',
        { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: fd });
      if (r.ok) { transcript = (await r.json()).text; tSource = 'transcribed from the recording'; }
      else console.error(`  ⚠ transcription returned ${r.status}`);
    } catch (e) { console.error(`  ⚠ transcription failed: ${String(e.message).slice(0, 120)}`); }
  }

  writeFileSync(`${base}.transcript.txt`, `# screen recording — ${id}\n# ${seconds ? seconds.toFixed(1) + 's' : '?'} · source: user screen-recording\n# transcript source: ${tSource}\n\n${transcript}\n`);
  writeFileSync(`${base}.meta.json`, JSON.stringify({ id, source: 'screen-recording', file: localFile, duration_sec: seconds, transcriptSource: tSource, fetched: new Date().toISOString() }, null, 2));

  const ranked = scoreTemplates(transcript);
  const sug = ranked[0] || null;
  writeFileSync(`${base}.peg.md`, `# Peg analysis — screen recording ${id}\n\nSource: a recording the user made (the ad could not be fetched directly)\nLength: ${seconds ? seconds.toFixed(1) + 's' : 'unknown'} · transcript: ${tSource}\n\n## Hook (first ~3s)\n_TODO: quote the opening line verbatim and name why it earns the next three seconds._\n\n## Beats\n_TODO: HOOK → STORY → TURN → PROOF → CTA with rough timings._\n\n## Format signals\n_TODO: on-camera or faceless? one person or two? handheld selfie or propped? real or animated?\ncaptions/supers? b-roll cutaways? what the camera does._\n\n## Template match\n${sug ? `Suggested: **${sug.title}** (score ${sug.score}) → \`diffusr://templates/${sug.uri}\`` : '**No template matched** — from-scratch build. Say so and get approval before spending.'}\n\n## What we take vs what we change\n_TODO: mine the hook angle and structure; do NOT clone._\n`);

  if (slug && existsSync(`briefs/${slug}/state.json`)) {
    const sp2 = `briefs/${slug}/state.json`;
    const st2 = JSON.parse(readFileSync(sp2, 'utf8'));
    st2.pegs = (st2.pegs || []).filter((x) => x.id !== id);
    st2.pegs.push({ url: null, id, dir, title: `screen recording ${id}`, status: 'fetched', source: 'screen-recording', template: sug?.uri || null });
    writeFileSync(sp2, JSON.stringify(st2, null, 2));
    console.log(`  ↳ registered on brief "${slug}"`);
  }
  console.log(`\n✓ peg ${id} (screen recording)${seconds ? ` — ${seconds.toFixed(1)}s` : ''}`);
  console.log(`   transcript: ${base}.transcript.txt  (${tSource})`);
  console.log(`   analysis:   ${base}.peg.md  ← fill this in before scripting`);
  if (sug) console.log(`\n   template → ${sug.title}  (diffusr://templates/${sug.uri})`);
  console.log('');
  process.exit(0);
}

if (!url) {
  console.error('usage: node scripts/peg.mjs <url> [--slug <brief>] [--novideo]');
  console.error('   or: node scripts/peg.mjs --file <local.mp4> [--slug <brief>]   (a recording the user made)');
  process.exit(1);
}

// ── Meta Ad Library → hand off (yt-dlp cannot read it) ──────────────────────────────────────────────────────
if (/facebook\.com\/ads\/library/i.test(url)) {
  const brand = val('--brand');
  console.log('→ Meta Ad Library link: yt-dlp cannot read these (the single-ad deep link age-gates).');
  if (!brand) {
    console.error('\n✗ This needs the ADVERTISER NAME — the public grid view is keyed by the advertiser page, not the ad.\n'
      + `  run: node scripts/adlib.mjs "${url}" --brand "<Advertiser Name>"${slug ? ` --slug ${slug}` : ''}\n`
      + '  If the advertiser is gated account-wide (common for health/pharma), adlib will report 0 downloadable.\n'
      + '  THEN: ask the user to SCREEN-RECORD the ad (play it, record the screen) and drop the file in\n'
      + '  briefs/<slug>/pegs/ — we ingest that instead. Do NOT proceed as if the peg were read.');
    process.exit(2);
  }
  const r = spawnSync(process.execPath, [new URL('adlib.mjs', import.meta.url).pathname, ...A], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

// ── yt-dlp present? ─────────────────────────────────────────────────────────────────────────────────────────
const yt = (args, opts = {}) => execFileSync('yt-dlp', args, {
  encoding: 'utf8',
  stdio: opts.quiet ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'pipe', 'inherit'],
  ...opts,
});
try { yt(['--version'], { quiet: true }); }
catch {
  console.error('✗ yt-dlp is not installed. Install it, then re-run:\n'
    + '    brew install yt-dlp        (macOS)\n'
    + '    pipx install yt-dlp        (any platform)');
  process.exit(1);
}

// ── metadata ────────────────────────────────────────────────────────────────────────────────────────────────
let info;
try { info = JSON.parse(yt(['-j', '--no-warnings', url], { quiet: true })); }
catch (e) {
  console.error('✗ yt-dlp could not read that URL:', String(e.message).slice(0, 200));
  console.error('  Private, region-blocked or login-walled? Do NOT work around it. Ask the user to SCREEN-RECORD');
  console.error('  the ad instead (play it, record the screen), save it into briefs/<slug>/pegs/, and ingest that.');
  process.exit(1);
}

const id = String(info.id || Date.now());
const dir = slug ? `briefs/${slug}/pegs/${id}` : `pegs/${id}`;
mkdirSync(dir, { recursive: true });
const base = `${dir}/${id}`;
const dur = info.duration ? `${Math.round(info.duration)}s` : 'unknown length';

// ── the clip ────────────────────────────────────────────────────────────────────────────────────────────────
if (!has('--novideo')) {
  try { yt(['-f', 'mp4/bestvideo*+bestaudio/best', '--no-warnings', '-o', `${base}.%(ext)s`, url]); }
  catch (e) { console.error('  ⚠ video download failed:', String(e.message).slice(0, 140)); }
}

// ── transcript: captions first (free), else audio → transcription (needs OPENAI_API_KEY), else be honest ────
const srtText = () => {
  // Prefer the ORIGINAL English track. yt-dlp can also hand back auto-TRANSLATED variants (en-de, en-es…), and
  // picking one of those silently gives you a round-tripped translation instead of what was actually said.
  const cands = readdirSync(dir).filter((n) => n.startsWith(id) && /\.(srt|vtt)$/.test(n));
  const rank = (n) => (/\.en\.(srt|vtt)$/.test(n) ? 0 : /\.en-orig\./.test(n) ? 1 : /\.en-en\./.test(n) ? 2 : 9);
  const f = cands.sort((a, b) => rank(a) - rank(b))[0];
  if (!f) return null;
  return readFileSync(`${dir}/${f}`, 'utf8')
    .replace(/^\d+\s*$/gm, '')                                    // cue numbers
    .replace(/^[\d:.,\->\s]+$/gm, '')                             // timestamps
    .replace(/<[^>]+>/g, '')                                      // vtt inline tags
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((l, i, a) => l !== a[i - 1])                          // de-dupe rolling captions
    .join(' ');
};

let transcript = null;
let transcriptSource = null;
try {
  yt(['--skip-download', '--write-auto-subs', '--write-subs', '--sub-langs', 'en,en-orig',
    '--convert-subs', 'srt', '-o', `${base}.%(ext)s`, url], { quiet: true });
  transcript = srtText();
  if (transcript) transcriptSource = 'platform captions';
} catch {}

if (!transcript) {
  try {
    yt(['-x', '--audio-format', 'mp3', '--no-warnings', '-o', `${base}.%(ext)s`, url], { quiet: true });
    const mp3 = `${base}.mp3`;
    if (existsSync(mp3) && process.env.OPENAI_API_KEY) {
      const fd = new FormData();
      fd.append('file', new Blob([readFileSync(mp3)], { type: 'audio/mpeg' }), `${id}.mp3`);
      fd.append('model', 'gpt-4o-transcribe');
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: fd,
      });
      if (r.ok) { transcript = (await r.json()).text; transcriptSource = 'transcribed from audio'; }
      else console.error('  ⚠ transcription failed:', r.status, (await r.text()).slice(0, 120));
    } else if (existsSync(mp3)) {
      console.error('  ⚠ no captions and no OPENAI_API_KEY set — skipping transcription.');
    }
  } catch (e) { console.error('  ⚠ transcription step failed:', String(e.message).slice(0, 120)); }
}
if (!transcript) { transcript = '(no transcript — captions unavailable and audio was not transcribed)'; transcriptSource = 'none'; }

// ── write artefacts ─────────────────────────────────────────────────────────────────────────────────────────
writeFileSync(`${base}.transcript.txt`,
  `# ${info.title || id}\n# ${info.uploader || info.channel || 'unknown'} · ${dur} · ${url}\n# transcript source: ${transcriptSource}\n\n${transcript}\n`);
writeFileSync(`${base}.meta.json`, JSON.stringify({
  id, url, title: info.title || null, uploader: info.uploader || info.channel || null,
  duration_sec: info.duration ?? null, width: info.width ?? null, height: info.height ?? null,
  vertical: info.width && info.height ? info.height > info.width : null,
  transcriptSource, fetched: new Date().toISOString(),
}, null, 2));

// ── template suggestion (the TEMPLATE-FIRST rule starts here) ───────────────────────────────────────────────
const ranked = scoreTemplates(`${info.title || ''} ${transcript}`);
const suggestion = ranked.length ? ranked[0] : null;

writeFileSync(`${base}.peg.md`, `# Peg analysis — ${info.title || id}

Source: ${url}
Creator: ${info.uploader || info.channel || 'unknown'} · ${dur} · ${info.width}x${info.height}${info.width && info.height && info.height > info.width ? ' (vertical)' : ''}
Transcript: ${transcriptSource}

## Hook (first ~3s — what earns the next three seconds)
_TODO: quote the opening line verbatim and name what makes it work (claim / confession / question)._

## Beats
_TODO: list the structure as it actually plays — HOOK → STORY → TURN → PROOF → CTA, with rough timings._

## Format signals
_TODO: on-camera or faceless? one person or two? handheld selfie or propped? real or animated?
captions/supers? b-roll cutaways? what the camera does._

## Template match
${suggestion ? `Suggested: **${suggestion.title}** (score ${suggestion.score}) → \`diffusr://templates/${suggestion.uri}\`
Matched on: ${suggestion.hits.join(', ')}` : '**No template matched** — this would be a from-scratch build. Say so and get approval before spending.'}

## What we take vs what we change
_TODO: mine the hook angle and structure; do NOT clone. State the angle, offer and audience for OUR version._
`);

// ── register on the brief ───────────────────────────────────────────────────────────────────────────────────
if (slug && existsSync(`briefs/${slug}/state.json`)) {
  const sp = `briefs/${slug}/state.json`;
  const st = JSON.parse(readFileSync(sp, 'utf8'));
  st.pegs = (st.pegs || []).filter((p) => (p.url || p) !== url);
  st.pegs.push({ url, id, dir, title: info.title || null, status: 'fetched', template: suggestion?.uri || null });
  writeFileSync(sp, JSON.stringify(st, null, 2));
  spawnSync(process.execPath, ['brief.mjs', 'status', slug], { stdio: 'ignore' });
  console.log(`  ↳ registered on brief "${slug}"`);
}

const clip = readdirSync(dir).find((n) => n.startsWith(id) && /\.(mp4|mkv|webm)$/.test(n));
console.log(`\n✓ peg ${id} — ${info.title || '(untitled)'}`);
console.log(`   ${info.uploader || info.channel || 'unknown'} · ${dur}${clip ? `\n   clip:       ${dir}/${clip}` : ''}`);
console.log(`   transcript: ${base}.transcript.txt  (${transcriptSource})`);
console.log(`   analysis:   ${base}.peg.md  ← fill this in before scripting`);
if (suggestion) console.log(`\n   template → ${suggestion.title}  (diffusr://templates/${suggestion.uri})`);
else console.log('\n   ⛔ no template match — from-scratch build, needs approval before spending.');
console.log('\n─── transcript ───');
console.log(transcript.length > 3000 ? transcript.slice(0, 3000) + '\n…[truncated — full text in the file]' : transcript);
