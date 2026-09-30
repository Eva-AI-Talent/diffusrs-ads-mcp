#!/usr/bin/env node
// verify.mjs — "can this machine run the kit, and what is actually proven?"
//
//   node scripts/verify.mjs            # check the environment + run the offline self-test
//   node scripts/verify.mjs --plan     # also print the manual steps, with their real cost
//
// Two different questions, kept apart on purpose:
//   1. WHAT IS INSTALLED — checkable here, instantly, for free.
//   2. WHAT IS PROVEN END-TO-END — needs a real render, a real scrape, a real API call. Those cost money or
//      need a service, so this script never runs them silently. It tells you the command and the price.
//
// A stage with a missing dependency is reported as BLOCKED, never as passing. A green run of the self-test does
// not mean the kit has produced a video — only that the deterministic parts behave.

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const has = (f) => process.argv.includes(f);
const rows = [];
const add = (state, name, detail) => rows.push({ state, name, detail });

const bin = (cmd, args = ['--version']) => {
  try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')[0].trim(); }
  catch { return null; }
};

// ── 1. the things the kit cannot work without ───────────────────────────────────────────────────────────────
const node = process.versions.node;
add(Number(node.split('.')[0]) >= 18 ? 'ok' : 'fail', 'Node 18+', `v${node}`);

const ff = bin('ffmpeg', ['-version']);
add(ff ? 'ok' : 'fail', 'ffmpeg', ff ? ff.split(' ').slice(0, 3).join(' ') : 'missing — brew install ffmpeg');
const fp = bin('ffprobe', ['-version']);
add(fp ? 'ok' : 'fail', 'ffprobe', fp ? 'present' : 'missing — comes with ffmpeg');

let pil = null;
try { pil = execFileSync('python3', ['-c', 'import PIL;print(PIL.__version__)'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
add(pil ? 'ok' : 'fail', 'python3 + Pillow', pil ? `PIL ${pil}` : 'missing — pip install pillow (supers are rendered with it)');

// ── 2. fonts: the pack IS the look, so a missing font is a real failure, not cosmetic ────────────────────────
// And grade it that way. build-cut.mjs EXITS on a missing pack font, so reporting the default one as merely
// "blocked (optional)" told people the machine was fine while nothing could be built — the exact kind of
// cheerful wrong answer this script exists to prevent. `organic` is the default look, so it is a hard fail;
// `slab` is opt-in, so its absence only closes that one look. Both carry the pack's own install line, which
// includes the escape hatch (point font.file at any bold sans).
for (const [id, label, severity] of [['organic', 'CapCut Sans Text Bold', 'fail'],
                                     ['slab', 'DIN Condensed Bold', 'blocked']]) {
  const f = `styles/${id}.json`;
  if (!existsSync(f)) { add('fail', `${id} pack`, 'styles file missing'); continue; }
  const p = JSON.parse(readFileSync(f, 'utf8'));
  const path = String(p.font.file).replace(/^~/, process.env.HOME || '~');
  const there = existsSync(path);
  add(there ? 'ok' : severity, `${id} font (${label})`,
    there ? path.replace(process.env.HOME || '', '~')
          : `not found: ${path} — build-cut.mjs stops without it. ${p.font.install || ''}`.trim());
}

// ── 3. optional stages — blocked, not failed ────────────────────────────────────────────────────────────────
const ytdlp = bin('yt-dlp');
add(ytdlp ? 'ok' : 'blocked', 'yt-dlp (pegs)', ytdlp || 'brew install yt-dlp — needed to pull reference ads');

let pw = false;
try { await import('playwright'); pw = true; } catch {}
add(pw ? 'ok' : 'blocked', 'playwright (Meta Ad Library)', pw ? 'installed' : 'npm i -D playwright — only for FB ad-library pegs');

add(process.env.ELEVENLABS_API_KEY ? 'ok' : 'blocked', 'ELEVENLABS_API_KEY', process.env.ELEVENLABS_API_KEY ? 'set (VO + music available)' : 'unset — VO and generated music unavailable; use native audio or your own track');
add(process.env.OPENAI_API_KEY ? 'ok' : 'blocked', 'OPENAI_API_KEY', process.env.OPENAI_API_KEY ? 'set (QA + peg transcription)' : 'unset — QA cannot verify speech, peg transcripts limited to captions');

// Diffusion Studio is the kit's EDITOR, not a nice-to-have — but a cut is still deliverable without it, so
// this reports what is actually lost rather than failing the machine.
const dapi = bin('dapi', ['--version']) || bin('dapi', ['--help']);
add(dapi ? 'ok' : 'blocked', 'dapi (the editor)',
  dapi ? 'present — ds-build.mjs / ds-export.mjs will work'
       : 'not installed — cuts still build and ship, but supers cannot be edited in the app');

// The explainer look names its fonts and stops without them, so say so here rather than at build time.
const VOX_FONTS = [['Oswald', '~/Library/Fonts/Oswald[wght].ttf'],
                   ['Playfair Display', '~/Library/Fonts/PlayfairDisplay[wght].ttf'],
                   ['Caveat', '~/Library/Fonts/Caveat[wght].ttf']];
const missingVox = VOX_FONTS.filter(([, f]) => !existsSync(f.replace(/^~/, process.env.HOME || '~'))).map(([n]) => n);
add(missingVox.length ? 'blocked' : 'ok', 'explainer-edit fonts',
  missingVox.length ? `missing ${missingVox.join(', ')} — free from fonts.google.com (the house edit does not need them)`
                    : 'Oswald · Playfair Display · Caveat');

// The one thing this script cannot check — and the one thing without which nothing renders. Flagged loudly so
// it is not mistaken for "fine": a brief started without it produces prep work that cannot be used.
const mcpWired = (() => {
  if (!existsSync('.mcp.json')) return false;
  try { const j = JSON.parse(readFileSync('.mcp.json', 'utf8')); return !!(j.mcpServers && j.mcpServers.diffusr); }
  catch (e) { console.error(`  (.mcp.json unreadable: ${e.message})`); return false; }   // don't silently call a broken read "not configured"
})();
// A script can only see the FILE. Whether the server was approved, and whether the sign-in is live, exist in
// the agent's session — so this reports what it actually knows and names the next step, rather than implying
// it has checked a connection it cannot reach. It is also not a `fail`: the remix and edit halves need none
// of it, and calling the whole kit broken over a sign-in would be wrong.
add(mcpWired ? 'manual' : 'fail', 'diffusr MCP',
  mcpWired
    ? 'wired in .mcp.json (a file check — this cannot see the live connection). Restart Claude Code here and '
      + 'approve the server, then /mcp to sign in. Needed for NEW renders only; remix + edit work without it.'
    : '.mcp.json missing diffusr — run: claude mcp add --transport http diffusr https://app.diffusr.ai/api/mcp');

// ── 4. the offline self-test ────────────────────────────────────────────────────────────────────────────────
let selftest = null;
try {
  const out = execFileSync(process.execPath, ['scripts/test.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  selftest = (out.match(/(\d+) passed, (\d+) failed/) || [])[0] || 'ran';
  add(/0 failed/.test(selftest) ? 'ok' : 'fail', 'self-test', selftest);
} catch (e) {
  const out = `${e.stdout || ''}${e.stderr || ''}`;
  selftest = (out.match(/(\d+) passed, (\d+) failed/) || [])[0] || 'failed to run';
  add('fail', 'self-test', selftest);
}

// ── report ──────────────────────────────────────────────────────────────────────────────────────────────────
const icon = { ok: '✅', blocked: '⏸ ', fail: '⛔', manual: '· ' };
console.log('\nADKIT VERIFY\n');
for (const r of rows) console.log(`  ${icon[r.state]} ${r.name.padEnd(32)} ${r.detail}`);

const fails = rows.filter((r) => r.state === 'fail');
const blocked = rows.filter((r) => r.state === 'blocked');
console.log(`\n  ${rows.filter((r) => r.state === 'ok').length} ready · ${blocked.length} blocked (optional) · ${fails.length} broken\n`);
if (fails.length) console.log('  ⛔ Fix the broken items first — the kit cannot run without them.\n');

if (!has('--plan')) { console.log('  Run with --plan for the end-to-end test walkthrough.\n'); process.exit(fails.length ? 1 : 0); }

// ── the manual walkthrough ──────────────────────────────────────────────────────────────────────────────────
console.log(`  END-TO-END TEST — what the self-test CANNOT prove
  ─────────────────────────────────────────────────────────────────────────────
  The self-test covers the deterministic parts: gates, planning maths, ordering,
  refusals, packaging. It never renders. These steps do, and each costs real money
  or needs a live service. Work down the list; stop at the first surprise.

  1. INGEST — free
       node brief.mjs init testbrand --product "<a product url>" --angle "…"
       node scripts/product.mjs testbrand
     Expect: name, copy, the REAL product image saved, and brand.json with the
     site's accent + wordmark. Open the image — is it the product, or a logo?

  2. PEG — free
       node scripts/peg.mjs "<a tiktok/yt/ig/fb-reel url>" --slug testbrand
     Expect: clip + transcript + a template suggestion.
     FB Ad Library instead: node scripts/adlib.mjs --brand "<Advertiser>" --list
     A gated advertiser reporting "0 downloadable" is CORRECT behaviour, not a bug.

  3. TEMPLATE GATE — free
       node scripts/match-template.mjs "<your idea in a sentence>"
     Expect a match, or exit 3 demanding approval. Try deliberate nonsense: it must refuse.

  4. FIRST RENDER — costs diffusr credits (~$1.50 for 11s at 480p)
     Ask Claude: "make a talking-head ad for testbrand". It will dry_run and quote
     before spending. Render at 480p FIRST — 720p is over twice the price.
     Expect: a persona still you approve, then a clip. Check the product label.

  5. ASSEMBLE — free
       node scripts/assemble.mjs testbrand V1
     Expect one loudness, clean joins, duration ≈ the sum of the parts.

  6. QA — needs OPENAI_API_KEY
       node scripts/qa.mjs testbrand V1
     Without the key it must say NOT VERIFIED and exit 2 — never a pass.

  7. REMIX — free, and the best value in the kit
       node scripts/remix.mjs testbrand --dir <your clips> --sheets
       # look at the sheets, set role + inPoint in remix/shots.json
       node scripts/slate.mjs testbrand
     Expect a slate spanning length, spine and audio mode, and formats it CANNOT
     build listed with the exact shortfall (e.g. "PROBLEM 3/4").

  8. BUILD A CUT — free
       node scripts/build-cut.mjs testbrand c01
     Expect: supers in the pack's real font, SFX, end card, brand accent from
     brand.json. Then LOOK at it — a contact sheet shows what a duration cannot:
       ffmpeg -i <out.mp4> -vf "fps=1.5,scale=190:-1,tile=6x3" -frames:v 1 sheet.png

  9. VO / MUSIC — needs ELEVENLABS_API_KEY, costs credits
       node scripts/vo.mjs testbrand c01 --voices     # pick a CLONE, not a library voice
       node scripts/bgm.mjs testbrand c01 --dry       # price/length first
     Every VO take is gated by transcription; a mismatch must demand a re-roll.

  10. SHIP — free
       node scripts/pack.mjs
     Refuses if anything could reach another renderer or carry a key.

  ─────────────────────────────────────────────────────────────────────────────
  Total cost to prove the whole chain: about $2-4 of diffusr credits, plus pennies
  of ElevenLabs. Do steps 1-3 and 7-8 first — they are free and cover most of it.
`);
process.exit(fails.length ? 1 : 0);
