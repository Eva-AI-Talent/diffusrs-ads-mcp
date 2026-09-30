#!/usr/bin/env node
// adlib.mjs — fetch a Meta Ad Library peg. OPTIONAL: needs Playwright (see below).
//
// WHY THIS EXISTS: yt-dlp cannot read a Meta Ad Library link, and the single-ad deep link
// (facebook.com/ads/library/?id=…) renders an AGE GATE with no <video> in the DOM. The advertiser's public GRID
// view (view_all_page_id=…) serves the SAME ad card with its player mounted, logged out. So: resolve the
// advertiser's page id → open the grid → find the card with that Library ID → read the <video> src the page
// itself uses → download it.
//
// ETHICS — non-negotiable:
//   · NEVER logs in            · NEVER clicks through the age gate     · NEVER evades a bot challenge (block → abort)
//   · polite pacing            · public logged-out pages only          · a FRESH browser profile, never your session
//   · if nothing is downloadable it SAYS SO and asks the user to SCREEN-RECORD the ad instead. It never
//     pretends a peg was read, and never works around the gate.
//   Whole health/pharma advertisers are often gated account-wide — that is a legitimate "no", not an obstacle.
//
//   node scripts/adlib.mjs <library-id|url> --brand "<Advertiser>" [--slug <brief>] [--novideo] [--frames]
//   node scripts/adlib.mjs --brand "<Advertiser>" --list          # what exists: id · started · gated? · player?
//   node scripts/adlib.mjs --brand "<Advertiser>" --all [--limit N]
//   node scripts/adlib.mjs <id> --page-id <fb page id>            # skip brand resolution
//
// SETUP (optional — only needed for Ad Library pegs):
//   npm i -D playwright        then either  npx playwright install chromium   (~300MB)
//                             or rely on an installed Google Chrome (auto-fallback, no download)

import '../lib/env.mjs';        // keys come from .env as well as the shell
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { scoreTemplates } from './match-template.mjs';

const A = process.argv.slice(2);
const has = (f) => A.includes(f);
const val = (f, d = null) => { const i = A.indexOf(f); return i !== -1 && A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : d; };

let BRAND = val('--brand');
const PAGE_ID = val('--page-id');
const SLUG = val('--slug');
const ALL = has('--all');
const LIMIT = Number(val('--limit', 0)) || 0;
// a bare number FOLLOWING a flag is that flag's value, not the positional ad id
const positional = A.filter((a, i) => !a.startsWith('--') && !(i > 0 && A[i - 1].startsWith('--')));
const wantId = (positional.find((a) => /^\d{5,}$/.test(a)) || (positional.find((a) => /ads\/library/.test(a)) || '').match(/[?&]id=(\d+)/)?.[1]) || null;

if (!wantId && !ALL && !has('--list')) {
  console.error('usage: node scripts/adlib.mjs <library-id|url> --brand "<Advertiser>" [--slug <brief>]\n'
    + '   or: node scripts/adlib.mjs --brand "<Advertiser>" --list | --all');
  process.exit(1);
}
// An ad ID alone is enough to TRY: the deep link usually names the advertiser and often mounts the player.
// Only a --list/--all run genuinely needs the advertiser up front, since there is no single ad to look at.
if (!BRAND && !PAGE_ID && !wantId) {
  console.error('✗ need --brand "<Advertiser Name>" (or --page-id <id>) to list or bulk-fetch — the public grid\n'
    + '  view is keyed by the ADVERTISER page. For ONE ad, just pass its id or URL and it will work it out.');
  process.exit(1);
}

// ── optional dependency ─────────────────────────────────────────────────────────────────────────────────────
let chromium;
try { ({ chromium } = await import('playwright')); }
catch {
  console.error('✗ Playwright is not installed — it is OPTIONAL and only needed for Meta Ad Library pegs.\n'
    + '    npm i -D playwright\n'
    + '    npx playwright install chromium     (~300MB; skip it if you have Google Chrome — we fall back to it)\n\n'
    + '  Or skip this entirely: ask the user for the ad\'s mp4 and drop it in briefs/<slug>/pegs/<id>/.');
  process.exit(4);
}

const LIB = 'https://www.facebook.com/ads/library/';
const GRID = (pid) => `${LIB}?active_status=active&ad_type=all&country=US&media_type=video&view_all_page_id=${pid}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = val('--out', SLUG ? `briefs/${SLUG}/pegs` : 'pegs');

// ── card scraper, evaluated in page context ─────────────────────────────────────────────────────────────────
const SCRAPE = () => {
  const cards = [];
  document.querySelectorAll('div').forEach((d) => {
    const t = d.innerText || '';
    if (!d.children.length || !/Library ID:\s*\d+/.test(t)) return;
    if (/Library ID:[\s\S]*Library ID:/.test(t)) return;            // a container, not a card
    if (!cards.some((c) => c.contains(d))) cards.push(d);
  });
  return cards.map((c) => {
    const t = c.innerText || '';
    const v = c.querySelector('video');
    return {
      id: (t.match(/Library ID:\s*(\d+)/) || [])[1] || null,
      started: (t.match(/Started running on ([^\n]+)/) || [])[1] || null,
      variants: +((t.match(/(\d+)\s+ads use this creative/) || [])[1] || 1),
      copy: t.split('\n').filter((l) => l.length > 40).slice(0, 4).join('\n').slice(0, 900),
      gated: /confirm your age|need to confirm/i.test(t),
      handle: (() => { const a = c.querySelector('a[href*="facebook.com/"]'); const h = a && a.getAttribute('href'); return h ? (h.match(/facebook\.com\/([^/?#]+)/) || [])[1] || null : null; })(),
      video: v ? (v.src || v.currentSrc || null) : null,
      poster: v ? (v.poster || null) : null,
    };
  }).filter((r) => r.id);
};

async function goto(page, url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try { await page.goto(url, { waitUntil: 'commit', timeout: 45000 }); return; }
    catch (e) { if (i === tries) throw e; await sleep(4000 * i); }
  }
}

// ── resolve the advertiser's page id (graphql filter options, DOM fallback) ──────────────────────────────────
async function resolvePageId(page, brand) {
  let found = null;
  const onResp = async (resp) => {
    if (found || !resp.url().includes('/api/graphql/')) return;
    try {
      const pages = (await resp.json())?.data?.ad_library_main?.dynamic_filter_options?.pages;
      if (!pages?.length) return;
      const want = brand.toLowerCase().replace(/[^a-z0-9]/g, '');
      const score = (p) => {
        const n = p.display_name.toLowerCase().replace(/[^a-z0-9]/g, '');
        // Canonical weights (docs/meta-ad-library-harvest.md): exact 100, prefix 70, contains 45.
        return n === want ? 100 : (n.startsWith(want) || want.startsWith(n)) ? 70 : n.includes(want) ? 45 : 0;
      };
      const best = pages.map((p) => ({ p, s: score(p) })).filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || b.p.count - a.p.count)[0];
      if (best) found = { id: best.p.key, name: best.p.display_name, score: best.s };
    } catch {}
  };
  page.on('response', onResp);
  await goto(page, `${LIB}?active_status=active&ad_type=all&country=US&media_type=video`
    + `&q=${encodeURIComponent(brand)}&search_type=keyword_unordered`);
  for (let i = 0; i < 12 && !found; i++) await sleep(1500);
  page.off('response', onResp);
  if (found) return found;
  const fromDom = await page.evaluate(() => {
    const h = [...document.querySelectorAll('a[href*="view_all_page_id="]')].map((a) => a.getAttribute('href'));
    return h.map((x) => (x.match(/view_all_page_id=(\d+)/) || [])[1]).filter(Boolean)[0] || null;
  }).catch(() => null);
  return fromDom ? { id: fromDom, name: '(from link)', score: 10 } : null;
}

// ── scroll the grid politely, collecting cards ──────────────────────────────────────────────────────────────
async function harvestGrid(page, pid, target) {
  await goto(page, GRID(pid));
  for (let t = 0; t < 16; t++) {
    const n = await page.evaluate(() => ((document.body?.innerText || '').match(/Library ID:/g) || []).length);
    if (n > 0) break;
    await sleep(1500);
  }
  await sleep(2000);
  const rows = new Map();
  let stagnant = 0;
  for (let i = 0; i < 40 && stagnant < 4; i++) {
    const batch = await page.evaluate(SCRAPE);
    const before = rows.size;
    for (const r of batch) if (!rows.has(r.id) || (!rows.get(r.id).video && r.video)) rows.set(r.id, r);
    if (target && rows.get(target)?.video) break;
    stagnant = rows.size > before ? 0 : stagnant + 1;
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.85));
    await sleep(1600);                                  // polite: let each card mount its player
  }
  for (const r of await page.evaluate(SCRAPE)) if (!rows.has(r.id) || (!rows.get(r.id).video && r.video)) rows.set(r.id, r);
  return [...rows.values()];
}

// ── download + transcribe + write the analysis stub ─────────────────────────────────────────────────────────
async function saveAd(rec, meta) {
  const dir = `${root}/${rec.id}`;
  mkdirSync(dir, { recursive: true });
  const base = `${dir}/${rec.id}`;
  writeFileSync(`${base}.meta.json`, JSON.stringify({ ...rec, ...meta, fetched: new Date().toISOString() }, null, 2) + '\n');
  if (has('--novideo') || !rec.video) return { dir, mp4: null };

  // Meta CDN links are signed and short-lived — fetch immediately.
  try { execFileSync('curl', ['-fsSL', '--max-time', '120', '-o', `${base}.mp4`, rec.video], { stdio: ['ignore', 'ignore', 'inherit'] }); }
  catch (e) { console.error(`  ✗ ${rec.id}: download failed — ${String(e.message).slice(0, 120)}`); return { dir, mp4: null }; }
  const size = existsSync(`${base}.mp4`) ? readFileSync(`${base}.mp4`).length : 0;
  if (size < 20480) {
    console.error(`  ✗ ${rec.id}: download too small (${size}B) — the signed URL probably expired. Re-run.`);
    return { dir, mp4: null };
  }

  let dur = null;
  try {
    dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', `${base}.mp4`],
      { encoding: 'utf8' }).trim()) || null;
  } catch {}

  if (has('--frames')) {
    mkdirSync(`${dir}/frames`, { recursive: true });
    try {
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `${base}.mp4`, '-vf', 'fps=1,scale=180:-1', `${dir}/frames/%03d.jpg`]);
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `${dir}/frames/%03d.jpg`, '-vf', 'tile=6x6', `${dir}/grid.jpg`]);
    } catch {}
  }

  // gpt-4o-transcribe, not whisper-1: whisper-1 quietly DROPS words, which corrupts a peg you script against.
  let transcript = '(no transcript — set OPENAI_API_KEY to transcribe)';
  if (process.env.OPENAI_API_KEY) {
    try {
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `${base}.mp4`, '-vn', '-ac', '1', '-ar', '16000', `${base}.mp3`]);
      const fd = new FormData();
      fd.append('file', new Blob([readFileSync(`${base}.mp3`)], { type: 'audio/mpeg' }), 'a.mp3');
      fd.append('model', 'gpt-4o-transcribe');
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions',
        { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: fd });
      transcript = r.ok ? (await r.json()).text : `(transcription returned ${r.status})`;
    } catch (e) { transcript = `(transcription failed: ${String(e.message).slice(0, 120)})`; }
  }

  writeFileSync(`${base}.transcript.txt`,
    `# Meta Ad Library ${rec.id} — ${meta.pageName || BRAND}\n# ${LIB}?id=${rec.id}\n`
    + `# started ${rec.started || '?'} · ${dur ? dur.toFixed(1) + 's' : '?'} · ${rec.variants} ad(s) use this creative\n\n`
    + `## Ad copy\n${rec.copy || '(none)'}\n\n## Spoken transcript\n${transcript}\n`);

  const ranked = scoreTemplates(`${rec.copy || ''} ${transcript}`);
  const sug = ranked[0] || null;
  writeFileSync(`${base}.peg.md`, `# Peg analysis — Meta Ad Library ${rec.id}

Advertiser: ${meta.pageName || BRAND} · started ${rec.started || '?'} · ${dur ? dur.toFixed(1) + 's' : '?'}
Source: ${LIB}?id=${rec.id}
${rec.variants > 1 ? `\n⚠ ${rec.variants} ads use this creative — it is a proven winner worth studying closely.\n` : ''}
## Hook (first ~3s)
_TODO: quote the opening line verbatim and name why it earns the next three seconds._

## Beats
_TODO: HOOK → STORY → TURN → PROOF → CTA with rough timings, as it actually plays._

## Format signals
_TODO: on-camera or faceless? one person or two? handheld selfie or propped? real or animated?
captions/supers? b-roll cutaways? what the camera does._

## Template match
${sug ? `Suggested: **${sug.title}** (score ${sug.score}) → \`diffusr://templates/${sug.uri}\`
Matched on: ${sug.hits.join(', ')}` : '**No template matched** — from-scratch build. Say so and get approval before spending.'}

## What we take vs what we change
_TODO: mine the hook angle and structure; do NOT clone. State the angle, offer and audience for OUR version._
`);

  if (SLUG && existsSync(`briefs/${SLUG}/state.json`)) {
    const sp = `briefs/${SLUG}/state.json`;
    const st = JSON.parse(readFileSync(sp, 'utf8'));
    st.pegs = (st.pegs || []).filter((p) => p.id !== rec.id);
    st.pegs.push({ url: `${LIB}?id=${rec.id}`, id: rec.id, dir, title: `${meta.pageName || BRAND} ad ${rec.id}`, status: 'fetched', template: sug?.uri || null });
    writeFileSync(sp, JSON.stringify(st, null, 2));
  }
  return { dir, mp4: `${base}.mp4`, dur, transcript, suggestion: sug };
}

// ── run: a FRESH, logged-out profile. Prefer bundled chromium, else the installed Chrome (no 300MB download) ─
async function launch() {
  const ch = process.env.ADLIB_CHANNEL;
  if (ch) return chromium.launch({ headless: true, channel: ch });
  try { return await chromium.launch({ headless: true }); }
  catch (e) {
    if (!/Executable doesn't exist|playwright install/i.test(String(e))) throw e;
    console.error('  (no bundled chromium — falling back to the installed Google Chrome)');
    return chromium.launch({ headless: true, channel: 'chrome' });
  }
}

// ── TRY THE DEEP LINK FIRST ─────────────────────────────────────────────────────────────────────────────────
// The single-ad page age-gates for SOME advertisers (health/pharma especially) — but not for most. When it does
// load, it carries the advertiser, the ad copy AND a mounted player, so the ad can be taken directly and the
// user never has to be asked "which advertiser runs this?". Only when it is gated, or has no player, do we need
// the advertiser in order to reach the public grid view. Asking first was needless friction.
async function tryDeepLink(page, adId) {
  await goto(page, `${LIB}?id=${adId}`);
  for (let i = 0; i < 10; i++) {
    const n = await page.evaluate(() => ((document.body?.innerText || '').match(/Library ID:/g) || []).length).catch(() => 0);
    if (n > 0) break;
    await sleep(1200);
  }
  await sleep(1500);
  return page.evaluate(() => {
    const body = document.body?.innerText || '';
    const card = [...document.querySelectorAll('div')].find((d) => /Library ID:\s*\d+/.test(d.innerText || '')
      && !/Library ID:[\s\S]*Library ID:/.test(d.innerText || ''));
    const t = card ? card.innerText : body;
    const handleLink = [...document.querySelectorAll('a[href*="facebook.com/"]')]
      .map((a) => a.getAttribute('href') || '')
      .find((h) => !/ads\/library|help|policies|business|login|l\.facebook/i.test(h));
    const v = document.querySelector('video');
    return {
      gated: /confirm your age|need to confirm/i.test(body),
      handle: handleLink ? (handleLink.match(/facebook\.com\/([^/?#]+)/) || [])[1] || null : null,
      started: (t.match(/Started running on ([^\n]+)/) || [])[1] || null,
      variants: +((t.match(/(\d+)\s+ads use this creative/) || [])[1] || 1),
      copy: t.split('\n').filter((l) => l.length > 40).slice(0, 4).join('\n').slice(0, 900),
      video: v ? (v.src || v.currentSrc || null) : null,
      poster: v ? (v.poster || null) : null,
    };
  }).catch(() => null);
}

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 }, locale: 'en-US' });
const page = await ctx.newPage();
try {
  // one specific ad, and no advertiser given → the deep link usually answers both questions itself
  if (wantId && !ALL && !has('--list')) {
    const d = await tryDeepLink(page, wantId);
    if (d && d.video) {
      const meta0 = { pageId: null, pageName: d.handle || BRAND || '(from the ad page)', brand: BRAND || d.handle || null, via: 'deep-link' };
      const out = await saveAd({ id: wantId, started: d.started, variants: d.variants, copy: d.copy, gated: d.gated, video: d.video, poster: d.poster, handle: d.handle }, meta0);
      console.log(`✓ ${wantId} → ${out.mp4 || out.dir}${out.dur ? ` (${out.dur.toFixed(1)}s)` : ''}   [advertiser: ${d.handle || '?'}]`);
      if (out.suggestion) console.log(`   template → ${out.suggestion.title}  (diffusr://templates/${out.suggestion.uri})`);
      await browser.close();
      process.exit(0);
    }
    if (d && !BRAND && !PAGE_ID) {
      if (d.handle) {
        console.log(`  (no player on the ad page${d.gated ? ' — age-gated' : ''}; advertiser looks like "${d.handle}" — trying the public grid)`);
        BRAND = d.handle;
      } else {
        console.error(`✗ that ad page exposed no player${d.gated ? ' (age-gated)' : ''} and no advertiser.`);
        console.error('  Pass --brand "<Advertiser Name>", or ask the user to screen-record the ad and ingest it with:');
        console.error(`    node scripts/peg.mjs --file <recording.mp4> --slug <slug>`);
        await browser.close();
        process.exit(3);
      }
    }
  }
  const hit = PAGE_ID ? { id: PAGE_ID, name: BRAND || '(given)' } : await resolvePageId(page, BRAND);
  if (!hit) throw new Error(`no Facebook page matched "${BRAND}" in the Ad Library — pass --page-id instead`);
  console.log(`page: ${hit.name} (${hit.id})`);
  await sleep(2500);
  const rows = await harvestGrid(page, hit.id, wantId);
  const meta = { pageId: hit.id, pageName: hit.name, brand: BRAND || hit.name };

  // A NAME MATCH CAN PICK THE WRONG ADVERTISER. In the reference harvest, 3 of 25 brands resolved to a
  // similarly-named page (Ritual→"Clare Ritual", Recess→"Recess Grove", Harry's→"Harry's at Hofheimer") and
  // their ads were downloaded before anyone noticed. Check the page name and the card handles against the
  // brand, and say so loudly rather than harvesting someone else's ads.
  if (BRAND && !PAGE_ID) {
    const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const want = norm(BRAND);
    const pageOk = norm(hit.name) === want || norm(hit.name).startsWith(want) || want.startsWith(norm(hit.name));
    const handles = [...new Set(rows.map((r) => r.handle).filter(Boolean))];
    const handleOk = handles.some((h) => norm(h).includes(want) || want.includes(norm(h)));
    if (!pageOk && !handleOk) {
      console.error(`\n  ⚠ PAGE MAY NOT BE "${BRAND}". Matched page: "${hit.name}"${handles.length ? ` · card handles: ${handles.slice(0, 4).join(', ')}` : ''}`);
      console.error('    A similar NAME is not the same advertiser. Confirm with the user, or pass --page-id, before');
      console.error('    treating these as the brand\'s ads.\n');
    }
  }

  if (has('--list')) {
    console.log(`\n${rows.length} active video card(s) — id · started · gated · player · variants`);
    for (const r of rows) {
      console.log(`  ${r.id}  ${String(r.started || '?').padEnd(14)}  ${r.gated ? 'GATED' : '  —  '}  ${r.video ? 'video' : '  —  '}  x${r.variants}`);
    }
    const dl = rows.filter((r) => r.video).length;
    const g = rows.filter((r) => r.gated).length;
    console.log(`\n  ${dl} downloadable · ${g} age-gated (NOT bypassed)\n`);
    if (dl === 0) {
      console.log('  ⛔ 0 downloadable. This advertiser is gated — that is a legitimate no, not an obstacle.');
      console.log('     Tell the user, and ask them to SCREEN-RECORD the ads they want used (play each ad,');
      console.log('     record the screen) and drop the files into briefs/<slug>/pegs/. We ingest those.');
      console.log('     Do NOT proceed as if the pegs were read.\n');
    }
    await browser.close();
    process.exit(dl === 0 ? 3 : 0);
  }

  const targets = ALL ? rows.filter((r) => r.video).slice(0, LIMIT || rows.length) : rows.filter((r) => r.id === wantId);
  if (!targets.length && !ALL) {
    console.error(`✗ Library ID ${wantId} not found among ${rows.length} active video card(s) on that page.`);
    const seen = rows.map((r) => r.id);
    if (seen.length) console.error(`  saw: ${seen.slice(0, 12).join(', ')}${seen.length > 12 ? '…' : ''}`);
    console.error('  → the ad may be inactive, image-only, or outside the US/video filter. Try --list to see what IS there.');
    process.exitCode = 2;
  } else if (!targets.length) {
    console.error(`✗ none of the ${rows.length} active video card(s) exposed a player (${rows.filter((r) => r.gated).length} age-gated).`);
    console.error('  We do not bypass the gate. Ask the user to SCREEN-RECORD the ads (play each, record the');
    console.error('  screen) into briefs/<slug>/pegs/ and we ingest those instead.');
    process.exitCode = 3;
  }

  for (const rec of targets) {
    if (rec.gated && !rec.video) {
      console.error(`  ⚠ ${rec.id}: age-gated on the grid too, no player mounted — NOT bypassing. Ask the user to screen-record this one.`);
      process.exitCode = 3;
      continue;
    }
    if (!rec.video) { console.error(`  ⚠ ${rec.id}: card has no <video> (image ad?)`); continue; }
    const out = await saveAd(rec, meta);
    console.log(`✓ ${rec.id} → ${out.mp4 || out.dir}${out.dur ? ` (${out.dur.toFixed(1)}s)` : ''}`);
    if (out.suggestion) console.log(`   template → ${out.suggestion.title}  (diffusr://templates/${out.suggestion.uri})`);
    else if (out.mp4) console.log('   ⛔ no template match — from-scratch build, needs approval before spending.');
    await sleep(1200);                                   // polite between downloads
  }
} catch (e) {
  console.error(`✗ ${String(e.message || e).slice(0, 200)}`);
  if (/403|challenge|blocked|captcha/i.test(String(e))) {
    console.error('  (blocked — stopping rather than working around it. Ask the user to screen-record the ads.)');
  }
  process.exitCode = 1;
} finally { await browser.close(); }
