#!/usr/bin/env node
// ds-build.mjs — turn a built cut into an EDITABLE Diffusion Studio project. This is the default editor.
//
//   node scripts/ds-build.mjs <slug> <cut-id> [--captions] [--vox] [--open]
//
// Reads  briefs/<slug>/remix/out/<cut-id>.edit.json   (written by build-cut.mjs --ds)
// Writes briefs/<slug>/edit/<cut-id>/{index.tsx,package.json,tsconfig.json,assets/}
//
// THE ARCHITECTURE (base-ve-diffusion §5). The A-roll is the finished picture as ONE <video> clip, and every
// super, caption and end-card element is a native dapi node on top of it. That combination is deliberate:
//   · one clip = no segment boundaries = dapi export keeps the whole audio track. A multi-segment timeline
//     drops audio at the joins, which is the single most common way a dapi export comes back wrong.
//   · native nodes = the user can drag, retime and retype every super in the app. Burned-in supers cannot be
//     touched without a rebuild, which is the whole reason to edit here rather than in ffmpeg.
//
// CACHE DEFEAT — read this before changing anything. dapi caches a composition by the package.json `name` and
// an export by `projectId`. Two projects sharing either one silently serve the FIRST one's render: `dapi check`
// reports the wrong duration and `dapi export` writes the wrong video, with an identical size/duration as the
// only tell. So both ids are hashed over EVERYTHING that can change the picture — the base video, the super
// data, the style pack, the product asset, AND this file's own source (layout lives in the code, so a restyle
// with unchanged data must still produce a new id). `workarea` is declared for the same family of reasons: an
// export covers the workarea, and without one the app falls back to a persisted range from another project.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { W, H, measure, fitSize, vnudge, rect, text, image, video, fadeIn, blurIn, slide, captionNodes, expand }
  from '../lib/ds-nodes.mjs';

const A = process.argv.slice(2);
const has = (f) => A.includes(f);
const val = (f, d) => { const i = A.indexOf(f); return i !== -1 && A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : d; };
const pos = A.filter((a, i) => !a.startsWith('--') && !String(A[i - 1] || '').startsWith('--'));
const [slug, cutId] = pos;
if (!slug || !cutId) {
  console.error('usage: node scripts/ds-build.mjs <slug> <cut-id> [--pack organic|branded|<path>] [--no-supers] [--captions] [--vox] [--open]');
  process.exit(1);
}

if (has('--vox')) {
  // The Vox look is a different edit, not a flag on this one — hand off rather than half-build it.
  const r = execFileSync(process.execPath, [new URL('./ds-vox.mjs', import.meta.url).pathname,
    ...A.filter((a) => a !== '--vox')], { stdio: 'inherit' });
  process.exit(0);
}

const editFile = `briefs/${slug}/remix/out/${cutId}.edit.json`;
if (!existsSync(editFile)) {
  console.error(`\n⛔ no edit manifest at ${editFile}`);
  console.error(`   Build the cut for the editor first:  node scripts/build-cut.mjs ${slug} ${cutId} --ds\n`);
  process.exit(1);
}
const M = JSON.parse(readFileSync(editFile, 'utf8'));
if (M.supersBurned) {
  console.error(`\n⛔ ${cutId} was built with its supers BURNED IN (no --ds).`);
  console.error('   Burned supers cannot be edited in the app, and drawing them again would double every line.');
  console.error(`   Rebuild:  node scripts/build-cut.mjs ${slug} ${cutId} --ds\n`);
  process.exit(1);
}
if (!existsSync(M.base)) { console.error(`✗ base video missing: ${M.base}`); process.exit(1); }

// ── the look pack ───────────────────────────────────────────────────────────────────────────────────────────
// The cut names a default pack, but the LOOK is now chosen at edit time, not baked in at build time — that is
// the point of the supers being nodes. `--pack` takes a shipped id, or a path to a pack derived from a peg
// (scripts/peg-style.mjs), so the same cut can be finished three different ways without rebuilding it.
const packArg = val('--pack', null);
const ALIAS = { branded: 'slab', slab: 'slab', organic: 'organic' };
let packId, packPath;
if (packArg && (packArg.endsWith('.json') || packArg.includes('/'))) {
  packId = basename(packArg).replace(/\.json$/, '');
  packPath = resolve(packArg);
  if (!existsSync(packPath)) { console.error(`\n⛔ no style pack at ${packPath}\n`); process.exit(1); }
} else {
  const want = packArg || M.pack || 'organic';
  if (want === 'vox') {
    console.error('\n⛔ the vox look is a different EDIT, not a pack on this one.');
    console.error(`   Run:  node scripts/ds-build.mjs ${slug} ${cutId} --vox\n`);
    process.exit(1);
  }
  packId = ALIAS[want];
  if (!packId) {
    console.error(`\n⛔ unknown pack "${want}". Shipped: organic (default), branded.`);
    console.error('   Or pass a path to a pack derived from a peg: --pack styles/_derived/<name>.json\n');
    process.exit(1);
  }
  packPath = new URL(`../styles/${packId}.json`, import.meta.url).pathname;
}
const P = JSON.parse(readFileSync(packPath, 'utf8'));
// A derived pack declares which shipped layout family it behaves like, so peg-derived looks get the right
// geometry rules rather than silently falling into the organic pill code.
const isSlab = (P.family || packId) === 'slab';
const L = P.layout, C = P.colors;
const FONT = P.font.family, FONT_FILE = expand(P.font.file);
if (!existsSync(FONT_FILE)) {
  console.error(`\n⛔ the ${P.name} pack needs ${FONT} at ${FONT_FILE}`);
  console.error(`   ${P.font.install || 'Install it, or point styles/' + packId + '.json at a font you have.'}`);
  console.error('   dapi renders with the font by NAME, so it must be installed for the app as well as measured here.\n');
  process.exit(1);
}
const ACCENT = M.accent || C.accent;
// Supers are ON unless the user said otherwise. Turning them off keeps the end card and the captions — it is
// "no on-screen headlines", not "no graphics at all". Declared here because the content hash reads it.
const SUPERS = !has('--no-supers');
const INK = C.ink;
const up = (t) => (isSlab ? String(t).toUpperCase() : String(t));

// Measure the scene by the VIDEO track, frame-snapped — NOT by `format=duration`. An encode's audio commonly
// runs a frame or two past its last video frame, and format=duration reports the longer of the two; declare
// that and dapi schedules a span with no picture in it, which `check` reports as black frames at the tail.
const dur = (f) => {
  const raw = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim();
  const v = Number(raw) || Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim()) || 0;
  return Math.floor(v * 30 + 1e-6) / 30;
};

// ── the project folder ──────────────────────────────────────────────────────────────────────────────────────
const proj = resolve(`briefs/${slug}/edit/${cutId}`);
mkdirSync(`${proj}/assets`, { recursive: true });

const h = createHash('md5');
h.update(readFileSync(M.base));
h.update(JSON.stringify([M.supers, M.endcard, M.button, packId, P, ACCENT, M.wordmark, has('--captions'), SUPERS]));
for (const a of [M.endcard?.product].filter(Boolean)) {
  try { h.update(String(statSync(a).mtimeMs)); } catch { /* an absent asset just does not contribute */ }
}
h.update(readFileSync(new URL(import.meta.url).pathname));      // layout lives in this file, so it must hash too
const tag = h.digest('hex').slice(0, 8);

// one base in assets/, named by the hash — a stale one left behind is what makes the app re-serve an old render
for (const old of readdirSync(`${proj}/assets`)) {
  if (old.startsWith('base') && old !== `base_${tag}.mp4`) rmSync(`${proj}/assets/${old}`, { force: true });
}
const local = `${proj}/assets/base_${tag}.mp4`;
if (!existsSync(local)) copyFileSync(M.base, local);

let product = null;
if (M.endcard?.product && existsSync(M.endcard.product)) {
  product = `${proj}/assets/product${M.endcard.product.slice(M.endcard.product.lastIndexOf('.'))}`;
  copyFileSync(M.endcard.product, product);
}

const baseDur = dur(local);
// The end card is drawn HERE, as nodes, over the plain card-coloured tail build-cut left for it. So the scene
// runs to the base's own length — the tail is already in the picture, only its type is ours to place.
const TOTAL = baseDur;
const sceneId = 'sc' + cutId.replace(/[^a-z0-9]/gi, '').slice(0, 12) + tag.slice(0, 4);

// ── supers ──────────────────────────────────────────────────────────────────────────────────────────────────
const nodes = [];

const row0 = (size) => Math.round(size * 1.28);   // line spacing when there is no pill to set it

// ORGANIC — the CapCut peg, locked. PER-LINE pills, each proportionate to its own line (a uniform box was
// tried and rejected), overlapping by 20 so the stack reads as one shape, and emitted BOTTOM LINE FIRST so the
// wider upper pill draws over the lower one's top corners and the seam disappears.
function organicSuper(sup, i) {
  const size = L.size, padx = L.padx, row = L.row, ov = L.overlap, rad = L.radius;
  const lines = [sup.line1, sup.line2].filter(Boolean).map(String);
  if (!lines.length) return [];
  const t0 = sup.t[0], t1 = Math.min(sup.t[1], TOTAL);
  if (t1 <= t0) return [];
  const widths = measure(lines, FONT_FILE, size, L.tracking || 0);
  // TWO SKINS, switched by the pack — not hard-coded. The pill is the house default; white type with a heavy
  // black outline and no bar is the other common treatment, and a peg-derived pack reaches for it whenever the
  // reference ad has no caption bar. Building only the pill would mean every peg came back looking like ours.
  if (L.box === 'none') {
    const strokeW = L.stroke || Math.max(8, Math.round(size * 0.2));
    const anim0 = fadeIn(P.motion?.fade ?? 0.14) + blurIn(P.motion?.blur ?? 0.22);
    const top0 = Math.round(H * (sup.cta ? L.cta_top : L.held));
    return lines.map((ln, k) => text({
      x: 0, y: top0 + k * row0(size), w: W, h: row0(size), body: ln, size,
      color: C.ink && L.box === 'none' ? (C.text || '#FFFFFF') : '#FFFFFF', font: FONT,
      id: `st${i}_${k}`, t0, t1, tracking: L.tracking || 0,
      children: `<stroke color="${C.stroke || '#000000'}" width={${strokeW}} join="round" />` + anim0,
    }));
  }
  // The pack's anchor is the TOP of the stack, not its centre — the same place the burned build put the
  // rendered pill, so an approved cut lands in the same spot when it moves into the editor.
  const top = Math.round(H * (sup.cta ? L.cta_top : L.held));
  // The pack decides, not this file. Organic is every line WHITE with black text; a coloured second line was
  // tried and rejected. The accent still earns its place on the CTA button and the end card.
  const fills = C.line_fills || [C.fill, ACCENT];
  const stagger = Math.min(P.motion?.stagger ?? 0.10, Math.max(0, (t1 - t0 - 0.25) / Math.max(1, lines.length - 1)));
  const anim = fadeIn(P.motion?.fade ?? 0.14) + blurIn(P.motion?.blur ?? 0.22);
  const rects = [], texts = [];
  lines.forEach((ln, k) => {
    const w = widths[k] + 2 * padx;
    const x = Math.round((W - w) / 2), y = top + k * (row - ov);
    const ts = t0 + k * stagger;
    rects.push(rect({ x, y, w, h: row, fill: fills[k % fills.length], radius: rad, id: `sr${i}_${k}`, t0: ts, t1, children: anim }));
    texts.push(text({ x, y, w, h: row, body: ln, size, color: INK, font: FONT, id: `st${i}_${k}`, t0: ts, t1,
      tracking: L.tracking || 0, children: anim }));
  });
  return [...rects.reverse(), ...texts];
}

// SLAB — the branded treatment: a left-placed lower third, a panel per line with an accent bar down its edge,
// lines arriving from alternating directions so the block never lands all at once.
const SLACK = L.slack ?? 28;   // dapi measures a hair wider than PIL; an exactly-measured box wraps
function slabSuper(sup, i) {
  const lines = [sup.line1, sup.line2].filter(Boolean).map((t) => up(t));
  if (!lines.length) return [];
  const t0 = sup.t[0], t1 = Math.min(sup.t[1], TOTAL);
  if (t1 <= t0) return [];
  const margin = L.margin, padx = 60;
  const size = fitSize(lines, W - margin * 2 - SLACK, L.headline, FONT_FILE, padx);
  const row = Math.round(size * 1.52);
  const tw = Math.max(...measure(lines, FONT_FILE, size)) + SLACK;
  const w = tw + padx * 2;
  const x = margin;
  const band = sup.cta ? L.upper_third : L.lower_third;
  const y = Math.round(H * band) - Math.round((row * lines.length) / 2);
  const out = [];
  lines.forEach((ln, k) => {
    const yy = y + k * row, d = k * 0.10;
    const dir = k % 2 === 0 ? -80 : 80;
    out.push(rect({ x, y: yy, w, h: row, fill: C.panel, id: `pb${i}_${k}`, t0: t0 + d, t1,
      children: fadeIn() + slide('x', x + dir, x, { dur: 0.46, id: `pbx${i}${k}` }) }));
    out.push(rect({ x, y: yy, w: 12, h: row, fill: ACCENT, id: `pl${i}_${k}`, t0: t0 + d, t1,
      children: fadeIn() + slide('x', x + dir, x, { dur: 0.46, id: `plx${i}${k}` }) }));
    out.push(text({ x: x + padx, y: yy + vnudge(size), w: tw, h: row, body: ln, size, color: C.sub || '#FFFFFF',
      font: FONT, id: `pt${i}_${k}`, t0: t0 + d, t1, align: 'left',
      children: fadeIn() + blurIn() + slide('x', x + padx + dir, x + padx, { dur: 0.46, id: `ptx${i}${k}` }) }));
  });
  return out;
}

// persistent chrome — only the branded look carries it
if (isSlab && M.wordmark && SUPERS) {
  const cy = L.chrome_y, endAt = M.endcard ? M.endcard.t[0] : TOTAL;
  nodes.push(text({ x: L.margin, y: cy + vnudge(50), w: 430, h: 58, body: up(M.wordmark), size: 50,
    color: '#FFFFFF', font: FONT, id: 'wm', t0: 0.12, t1: endAt, align: 'left', tracking: 3, children: fadeIn() }));
}

if (SUPERS) (M.supers || []).forEach((sup, i) => { nodes.push(...(isSlab ? slabSuper(sup, i) : organicSuper(sup, i))); });

// ── end card ────────────────────────────────────────────────────────────────────────────────────────────────
// The layout is the taste and it is brand-agnostic: everything left off one margin, a headline auto-fitted to
// the width the PRODUCT leaves it, a two-tier CTA, and the product at its TRUE aspect read from the file.
if (M.endcard) {
  const E = M.endcard;
  const t0 = E.t[0], t1 = Math.min(E.t[1], TOTAL);
  const margin = isSlab ? L.margin : 56;
  const chromeY = isSlab ? L.chrome_y : 64;
  const F = fadeIn(0.34);
  let prodW = 0, prodH = 0;
  if (product) {
    try {
      const d = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', product], { encoding: 'utf8' }).trim().split(',');
      prodH = Math.round(H * 0.54); prodW = Math.round(prodH * (Number(d[0]) / Number(d[1])));
    } catch { prodH = Math.round(H * 0.54); prodW = Math.round(prodH * 0.42); }
  }
  const avail = Math.max(360, W - margin - prodW - margin - 24);

  if (M.wordmark) {
    nodes.push(text({ x: margin, y: chromeY + vnudge(54), w: 460, h: 62, body: up(M.wordmark), size: 54,
      color: '#FFFFFF', font: FONT, id: 'ecwm', t0: t0 + 0.10, t1, align: 'left', tracking: 3,
      children: F + slide('y', chromeY - 34, chromeY, { dur: 0.46, id: 'ew' }) }));
  }
  const head = [].concat(E.headline || []).filter(Boolean).map(up);
  const hs = fitSize(head, avail - SLACK, isSlab ? L.headline : 92, FONT_FILE);
  const hrow = Math.round(hs * 1.14);
  let y = Math.round(H * 0.27);
  head.forEach((ln, k) => {
    nodes.push(text({ x: margin, y: y + k * hrow + vnudge(hs, isSlab ? 0.14 : 0), w: avail, h: hrow, body: ln,
      size: hs, color: C.sub || '#FFFFFF', font: FONT, id: `ech${k}`, t0: t0 + 0.20 + k * 0.12, t1, align: 'left',
      children: F + slide('y', y + k * hrow + 60, y + k * hrow, { dur: 0.52, id: `eh${k}` }) }));
  });
  y += hrow * head.length + 34;
  // Body copy is FITTED to the width the product leaves, not set at a fixed size in a fixed box. dapi wraps a
  // line too wide for its container, and with a fixed row height the wrapped half lands on top of the next
  // line — which is exactly how the first export came back.
  const bodyLines = [].concat(E.body || []).filter(Boolean).map(up);
  if (bodyLines.length) {
    const bsz = fitSize(bodyLines, avail - 12, 38, FONT_FILE, 0, 24);
    const brow = Math.round(bsz * 1.35);
    bodyLines.forEach((ln, k) => {
      nodes.push(text({ x: margin, y: y + k * brow + vnudge(bsz, isSlab ? 0.14 : 0), w: avail, h: brow, body: ln,
        size: bsz, color: C.body || '#C3C6C0', font: FONT, id: `ecb${k}`, t0: t0 + 0.46 + k * 0.08, t1, align: 'left',
        children: F + slide('x', margin - 50, margin, { dur: 0.46, id: `eb${k}` }) }));
    });
    y += brow * bodyLines.length + 40;
  }

  if (E.offer) {
    const sz = 40, w = measure([up(E.offer)], FONT_FILE, sz)[0] + 68;
    nodes.push(rect({ x: margin, y, w, h: 74, fill: C.chip || '#1C1F1B', radius: 12, id: 'ecp1', t0: t0 + 0.62, t1,
      children: F + slide('x', margin - 70, margin, { dur: 0.44, id: 'ea' }) }));
    nodes.push(text({ x: margin, y: y + vnudge(sz, isSlab ? 0.14 : 0), w, h: 74, body: up(E.offer), size: sz,
      color: ACCENT, font: FONT, id: 'ecp1t', t0: t0 + 0.62, t1,
      children: F + slide('x', margin - 70, margin, { dur: 0.44, id: 'eat' }) }));
    y += 96;
  }
  const btn = up(E.button || P.button?.text || 'Shop now');
  const bs = isSlab ? 52 : (P.button?.size ?? 52);
  const bw = measure([btn], FONT_FILE, bs)[0] + 110;
  nodes.push(rect({ x: margin, y, w: bw, h: 104, fill: ACCENT, radius: 16, id: 'ecp2', t0: t0 + 0.74, t1,
    children: F + slide('x', margin - 80, margin, { dur: 0.46, id: 'ec2' }) }));
  nodes.push(text({ x: margin, y: y + vnudge(bs, isSlab ? 0.14 : 0), w: bw, h: 104, body: btn, size: bs, color: INK,
    font: FONT, id: 'ecp2t', t0: t0 + 0.74, t1,
    children: F + slide('x', margin - 80, margin, { dur: 0.46, id: 'ec2t' }) }));
  y += 128;
  if (E.price) {
    nodes.push(text({ x: margin, y: y + vnudge(36, isSlab ? 0.14 : 0), w: 500, h: 44, body: up(E.price), size: 36,
      color: '#FFFFFF', font: FONT, id: 'ecpr', t0: t0 + 0.86, t1, align: 'left', children: F }));
    y += 48;
  }
  if (E.trust) {
    nodes.push(text({ x: margin, y: y + vnudge(29, isSlab ? 0.14 : 0), w: 560, h: 38, body: up(E.trust), size: 29,
      color: C.muted || '#8E918B', font: FONT, id: 'ecmk', t0: t0 + 0.94, t1, align: 'left', tracking: 1, children: F }));
  }
  if (product) {
    const px = W - margin - prodW, py = Math.round(H * 0.30);
    // a slow drift, so the hero is not a sticker
    const drift = `<keyframeTrack property="y" id="pkf">`
      + `<keyframe time={0} value={${py + 30}} easing="easeOut" id="pk0" />`
      + `<keyframe time={0.70} value={${py}} easing="easeOut" id="pk1" />`
      + `<keyframe time={3.0} value={${py - 28}} easing="easeInOut" id="pk2" /></keyframeTrack>`;
    nodes.push(image({ src: `assets/${basename(product)}`, x: px, y: py, w: prodW, h: prodH, id: 'ecprod',
      t0: t0 + 0.26, t1, children: fadeIn(0.55) + slide('x', px + 90, px, { dur: 0.62, id: 'pxs' }) + drift }));
  }
}

// ── captions (opt-in; verbatim, from the VO line list) ──────────────────────────────────────────────────────
let caps = [];
if (has('--captions')) {
  const capFile = `briefs/${slug}/remix/out/${cutId}.captions.json`;
  if (existsSync(capFile)) {
    caps = captionNodes(JSON.parse(readFileSync(capFile, 'utf8')), TOTAL, { font: FONT });
  } else {
    console.log(`  ⚠ --captions asked for but no ${capFile} — captions layer left empty.`);
  }
}

// ── write the project ───────────────────────────────────────────────────────────────────────────────────────
const tsx = `export default function Project() {
  return (
    <stage background="#000000" camera={[0.3, 0, 0, 0.3, 120, 60]} id="stg${sceneId}">
      <scene name="${slug}-${cutId}" width={${W}} height={${H}} fill="black" active id="${sceneId}" workarea={[0, ${TOTAL.toFixed(3)}]} timeline={[0, ${TOTAL.toFixed(2)}, 10]}>
        <sequence name="A-roll" id="aroll">
${video({ src: `assets/base_${tag}.mp4`, id: 'base', t0: 0, t1: TOTAL, sourceIn: 0 })}
        </sequence>
        <sequence name="Supers" id="supseq">
${nodes.join('\n')}
        </sequence>
        <sequence name="Captions" id="capseq">
${caps.join('\n')}
        </sequence>
      </scene>
    </stage>
  );
}
`;
writeFileSync(`${proj}/index.tsx`, tsx);

// UNIQUE name AND projectId — dapi keys its composition cache on the name and its export cache on the id.
writeFileSync(`${proj}/package.json`, JSON.stringify({
  name: `${slug}-${cutId}`,
  projectId: createHash('md5').update(`${slug}${cutId}${tag}`).digest('hex').slice(0, 21),
  displayName: `${slug} · ${M.name || cutId}`,
  private: true, type: 'module', main: 'index.tsx',
  scripts: { open: 'diffusion open .', check: 'diffusion check', export: 'diffusion export' },
  devDependencies: { '@diffusionstudio/jsx': 'latest', 'solid-js': '^1.9.10' },
  diffusion: { export: { [cutId.replace(/[^a-z0-9]/gi, '')]: {
    format: 'mp4',
    video: { enabled: true, codec: 'avc', bitrate: 16000000, fps: 30, resolution: 1080 },
    audio: { enabled: true, codec: 'aac', sampleRate: 48000, bitrate: 192000 },
  } } },
}, null, 2));

writeFileSync(`${proj}/tsconfig.json`, JSON.stringify({
  compilerOptions: {
    target: 'ES2022', lib: ['ES2022', 'DOM'], module: 'ESNext', moduleResolution: 'bundler',
    jsx: 'preserve', jsxImportSource: '@diffusionstudio/jsx', strict: true, noEmit: true, skipLibCheck: true,
  },
  include: ['**/*.ts', '**/*.tsx'],
}, null, 2));

// the app writes thumbnails and an assets index while we work; a half-written one blocks its whole loader
for (const junk of ['assets.yml', 'cache']) rmSync(`${proj}/${junk}`, { recursive: true, force: true });

console.log(`\n✓ dapi project  ${proj}`);
console.log(`  scene ${sceneId} · ${TOTAL.toFixed(2)}s · ${packId} · ${SUPERS ? `${(M.supers || []).length} super(s)` : 'supers OFF'}`
  + `${M.endcard ? ' + end card' : ''}${caps.length ? ` + ${caps.length} captions` : ''}`);
console.log(`  every super is a native node — drag, retime and retype them in the app.\n`);
console.log(`  open it:   dapi open ${JSON.stringify(proj)}`);
console.log(`  export it: node scripts/ds-export.mjs ${slug} ${cutId}\n`);

writeFileSync(`${proj}/.ds.json`, JSON.stringify({ proj, scene: sceneId, dur: TOTAL, cut: cutId, slug }, null, 2));

if (has('--open')) {
  try { execFileSync('dapi', ['open', proj], { stdio: 'inherit' }); }
  catch { console.log('  (dapi not on PATH — open the folder from Diffusion Studio instead)'); }
}
