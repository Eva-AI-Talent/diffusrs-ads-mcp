#!/usr/bin/env node
// brief.mjs — the adkit's durable workspace + state machine. state.json is the source of truth, NOT chat history.
//
//   node brief.mjs init <slug> [--product <url>] [--peg <url>] [--angle "…"]
//   node brief.mjs status <slug>
//   node brief.mjs set <slug> <VIDEO> key=value ...      (e.g. stage=render template=tpl-talking-head)
//   node brief.mjs persona <slug> <key> key=value ...    (e.g. status=generated still=personas/mia.png)
//   node brief.mjs set-asset <slug> key=value ...        (e.g. product=assets/product.png)
//
// Every write regenerates progress.md from state.json so the two can never drift.
// No private dependencies: stdlib only, so this runs anywhere the zip is unpacked.

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';

const [cmd, slug, ...rest] = process.argv.slice(2);
const val = (f, d) => { const i = rest.indexOf(f); return i !== -1 && rest[i + 1] ? rest[i + 1] : d; };
const DIR = (s) => `briefs/${s}`;
const STATE = (s) => `${DIR(s)}/state.json`;
const load = (s) => JSON.parse(readFileSync(STATE(s), 'utf8'));
const coerce = (v) => (v === 'true' ? true : v === 'false' ? false : v === 'null' ? null : /^\d+$/.test(v) ? Number(v) : v);
const kv = (args) => Object.fromEntries(args.filter((a) => a.includes('=')).map((a) => { const i = a.indexOf('='); return [a.slice(0, i), coerce(a.slice(i + 1))]; }));

// The canonical stage order. A video moves left→right; gates block a stage until its prerequisite is attested.
const STAGE_ORDER = ['ideate', 'persona', 'script', 'storyboard', 'references', 'render', 'qa', 'edit', 'deliver'];

function save(s, st) {
  writeFileSync(STATE(s), JSON.stringify(st, null, 2));
  writeFileSync(`${DIR(s)}/progress.md`, renderProgress(st));
}

function renderProgress(st) {
  const vids = Object.entries(st.videos || {});
  const done = vids.filter(([, v]) => v.stage === 'deliver').length;
  let out = `# ${st.slug} — progress\n\n`;
  out += `Product \`${st.product?.name || st.slug}\` · ${vids.length} video(s) · **${done} delivered** · generated from state.json\n\n`;
  if (st.product?.url) out += `Product: ${st.product.url}\n`;
  if (st.angle) out += `Angle: ${st.angle}\n`;
  if ((st.pegs || []).length) out += `Pegs: ${st.pegs.map((p) => p.url || p).join(' · ')}\n`;
  out += `\n## Personas\n\n`;
  const ps = Object.entries(st.personas || {});
  out += ps.length ? ps.map(([k, p]) => `- **${k}** — ${p.status || 'planned'}${p.still ? ` · ${p.still}` : ''}${p.room ? ` · room: ${p.room}` : ''}`).join('\n') : '_none yet_';
  out += `\n\n## Videos\n\n| ID | Title | Template | Persona | Stage | Refs | Render | Final |\n|---|---|---|---|---|---|---|---|\n`;
  for (const [id, v] of vids) {
    out += `| ${id} | ${v.title || ''} | ${v.template || '—'} | ${v.persona || '—'} | ${v.stage || 'ideate'} `
      + `| ${v.referencesApproved ? '✅' : '—'} | ${v.render || '—'} | ${v.final || '—'} |\n`;
  }
  out += `\n_Stages: ${STAGE_ORDER.join(' → ')}_\n`;
  return out;
}

if (cmd === 'init') {
  // A flag in the slug position means no slug was given — derive it from the product/brand, never scaffold a
  // directory named after a flag.
  if (!slug || slug.startsWith('--')) {
    throw new Error('usage: init <slug> [--product <url>] [--peg <url>] [--angle "…"]\n'
      + '  No slug given. Derive it from the PRODUCT or brand name (lowercase, kebab-case), then re-run with it.');
  }
  mkdirSync(DIR(slug), { recursive: true });
  for (const sub of ['assets', 'personas', 'pegs', 'scripts', 'storyboards', 'references', 'renders', 'qa', 'edit', 'delivery']) {
    mkdirSync(`${DIR(slug)}/${sub}`, { recursive: true });
  }
  const tpl = 'briefs/_template/state.json';
  const st = existsSync(tpl) ? JSON.parse(readFileSync(tpl, 'utf8')) : {};
  st.slug = slug;
  st.created = new Date().toISOString().slice(0, 10);
  st.product = { url: val('--product', null), name: null, images: [] };
  st.angle = val('--angle', null);
  st.pegs = val('--peg', null) ? [{ url: val('--peg', null), status: 'pending' }] : [];
  st.personas = st.personas || {};
  st.videos = st.videos || {};
  st.stageOrder = STAGE_ORDER;
  save(slug, st);
  console.log(`✓ scaffolded ${DIR(slug)}/`);
  if (st.product.url) console.log(`  ↳ next: node scripts/product.mjs ${slug}   (pull context + product images)`);
  if (st.pegs.length) console.log(`  ↳ then: node scripts/peg.mjs ${slug}       (fetch + analyse the peg)`);
} else if (cmd === 'status') {
  const st = load(slug); save(slug, st);
  console.log(renderProgress(st));
} else if (cmd === 'set') {
  const [video, ...args] = rest;
  const st = load(slug);
  st.videos[video] = { ...(st.videos[video] || {}), ...kv(args) };
  save(slug, st);
  console.log(`✓ ${video}:`, JSON.stringify(st.videos[video]));
} else if (cmd === 'persona') {
  const [key, ...args] = rest;
  const st = load(slug);
  st.personas[key] = { ...(st.personas[key] || {}), ...kv(args) };
  save(slug, st);
  console.log(`✓ persona ${key}:`, JSON.stringify(st.personas[key]));
} else if (cmd === 'set-asset') {
  const st = load(slug);
  st.assets = { ...(st.assets || {}), ...kv(rest) };
  save(slug, st);
  console.log('✓ assets:', JSON.stringify(st.assets));
} else {
  console.log('usage: node brief.mjs <init|status|set|persona|set-asset> <slug> …  (see docs/DESIGN.md)');
}
