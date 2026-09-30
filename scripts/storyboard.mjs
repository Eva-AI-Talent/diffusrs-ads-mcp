#!/usr/bin/env node
// storyboard.mjs — THE APPROVAL GATE. Build this and show it BEFORE anything renders or gets built.
//
//   node scripts/storyboard.mjs <slug> [cut-id …]      # all cuts, or the ones you name
//
// Writes briefs/<slug>/remix/_plan/plan.html — one self-contained page, no server, no assets to lose.
//
// One card per cut: format, length, audio mode, look pack — then a beat strip showing the REAL FIRST FRAME of
// every shot at its REAL in-point, with its duration, the supers verbatim in order, and the narration line per
// beat.
//
// The frames are pulled from the actual source at the actual in-point, so **the storyboard cannot flatter a shot
// that does not exist** — which is the entire point of showing it before spending time on a build. A described
// shot is a guess; a frame is evidence.
//
// It also prints the MUTE READ: the supers alone, in order. Most of the feed watches without sound, so if that
// list doesn't sell the product on its own, the copy isn't finished.
//
// And it flags what the build would refuse anyway — a beat outrunning its shot's availability, a missing file, a
// beat with no super — so those are caught while they are still cheap to fix.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const A = process.argv.slice(2);
const slug = A.find((a) => !a.startsWith('--'));
if (!slug) { console.error('usage: node scripts/storyboard.mjs <slug> [cut-id …]'); process.exit(1); }
const only = A.slice(A.indexOf(slug) + 1).filter((a) => !a.startsWith('--'));

const R = `briefs/${slug}/remix`;
if (!existsSync(`${R}/shots.json`)) { console.error(`✗ no shot library at ${R}/shots.json — run remix.mjs first`); process.exit(1); }
const lib = JSON.parse(readFileSync(`${R}/shots.json`, 'utf8'));
const byName = Object.fromEntries((lib.shots || []).map((s) => [s.name, s]));

const cutsDir = `${R}/cuts`;
if (!existsSync(cutsDir)) { console.error(`✗ no cuts at ${cutsDir}`); process.exit(1); }
const cutFiles = readdirSync(cutsDir).filter((f) => f.endsWith('.json') && !f.endsWith('.vo.json'))
  .filter((f) => !only.length || only.includes(f.replace('.json', '')));
if (!cutFiles.length) { console.error('✗ no matching cut files'); process.exit(1); }

const OUT = `${R}/_plan`;
mkdirSync(`${OUT}/frames`, { recursive: true });

const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const srcOf = (n) => { const s = byName[n]; return s && s.prepped && existsSync(s.prepped) ? s.prepped : s?.file; };

// the REAL first frame, at the REAL in-point, with the punch-in applied so the card shows the actual crop
function frameFor(name, punch) {
  const s = byName[name];
  if (!s) return null;
  const f = srcOf(name);
  if (!f || !existsSync(f)) return null;
  const png = `${OUT}/frames/${name}${punch > 1 ? `-p${punch}` : ''}.jpg`;
  if (!existsSync(png)) {
    let vf = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920';
    if (punch > 1) vf += `,crop=iw/${punch}:ih/${punch},scale=1080:1920`;
    vf += ',scale=220:-1';
    try { execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(s.inPoint ?? 0), '-i', f, '-frames:v', '1', '-vf', vf, '-q:v', '4', png]); }
    catch { return null; }
  }
  try { return `data:image/jpeg;base64,${readFileSync(png).toString('base64')}`; } catch { return null; }
}

const cards = [];
let problems = 0;

for (const cf of cutFiles.sort()) {
  const cut = JSON.parse(readFileSync(`${cutsDir}/${cf}`, 'utf8'));
  const id = cut.id || cf.replace('.json', '');
  const vm = `${R}/vo/${id}/lines.json`;
  const vo = existsSync(vm) ? (JSON.parse(readFileSync(vm, 'utf8')).lines || []) : [];
  const beats = cut.beats || [];
  const supers = [];
  const strip = [];

  beats.forEach((b, i) => {
    const names = Array.isArray(b.shot) ? b.shot : [b.shot];
    const layout = b.layout || 'full';
    const punch = Number(b.punch) || 1;
    const img = frameFor(names[0], punch);
    const warn = [];
    for (const n of names) {
      const s = byName[n];
      if (!s) { warn.push(`unknown shot "${n}"`); continue; }
      if (s.inPoint == null) { warn.push(`"${n}" has no in-point`); continue; }
      const avail = (s.duration ?? 0) - s.inPoint;
      // the ceiling the build enforces — catch it here, while it is still free to change
      if (Number(b.seconds) > avail + 0.05) warn.push(`wants ${b.seconds}s of "${n}", only ${avail.toFixed(2)}s available`);
    }
    if (!img) warn.push('no frame — source missing?');
    if (!b.super) warn.push('no super — this beat says nothing on mute');
    if (warn.length) problems += warn.length;
    if (b.super) supers.push([b.super.line1, b.super.line2].filter(Boolean).join(' / '));
    const line = vo.find((l) => (l.beat ?? 0) === i + 1);
    strip.push({ i: i + 1, img, seconds: b.seconds, layout, punch, names, sup: b.super, warn, line: line?.text || null });
  });

  const total = beats.reduce((a, b) => a + Number(b.seconds || 0), 0) + (cut.endCard ? Number(cut.endCard.seconds || 2.5) : 0);
  cards.push({ id, cut, strip, supers, total });
}

const html = `<!doctype html><meta charset="utf-8"><title>Plan — ${esc(slug)}</title>
<style>
 :root{--bg:#0e0f0e;--card:#161816;--ink:#e9eae6;--mut:#8e918b;--acc:#A8D62E;--warn:#ff6b6b}
 *{box-sizing:border-box} body{margin:0;padding:28px;background:var(--bg);color:var(--ink);
   font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
 h1{font-size:20px;margin:0 0 4px} .sub{color:var(--mut);margin-bottom:24px}
 .card{background:var(--card);border-radius:12px;padding:20px;margin-bottom:22px}
 .hd{display:flex;gap:14px;align-items:baseline;flex-wrap:wrap;margin-bottom:14px}
 .hd b{font-size:17px} .tag{color:var(--mut);font-size:13px}
 .strip{display:flex;gap:12px;overflow-x:auto;padding-bottom:6px}
 .beat{min-width:160px;max-width:160px}
 .beat img{width:100%;border-radius:8px;display:block;background:#000}
 .noimg{width:100%;aspect-ratio:9/16;border-radius:8px;background:#222;display:flex;align-items:center;
   justify-content:center;color:var(--warn);font-size:12px;text-align:center;padding:8px}
 .meta{font-size:12px;color:var(--mut);margin-top:6px}
 .sup{font-size:13px;margin-top:5px}.sup b{color:#fff}.sup i{color:var(--acc);font-style:normal}
 .vo{font-size:12px;color:#c3c6c0;margin-top:5px;font-style:italic}
 .warn{color:var(--warn);font-size:12px;margin-top:5px}
 .mute{margin-top:16px;padding:14px;border-left:3px solid var(--acc);background:#1b1d1a;border-radius:0 8px 8px 0}
 .mute h4{margin:0 0 6px;font-size:13px;color:var(--acc);text-transform:uppercase;letter-spacing:.06em}
 .mute ol{margin:0;padding-left:20px} .mute li{margin:2px 0}
 .bad{color:var(--warn);font-weight:600}
</style>
<h1>Plan — ${esc(slug)}</h1>
<div class="sub">${cards.length} cut(s) · every frame is the REAL shot at its REAL in-point${problems ? ` · <span class="bad">${problems} problem(s) to fix before building</span>` : ' · no problems found'}</div>
${cards.map((c) => `
<div class="card">
  <div class="hd">
    <b>${esc(c.id)}</b>
    <span class="tag">${esc(c.cut.name || '')}</span>
    <span class="tag">${esc(c.cut.style || 'ORGANIC')} · ${c.total.toFixed(1)}s · audio ${esc(c.cut.audio || 'bed')} · look ${esc(c.cut.pack || 'organic')}</span>
  </div>
  <div class="strip">
    ${c.strip.map((b) => `<div class="beat">
      ${b.img ? `<img src="${b.img}">` : '<div class="noimg">no frame</div>'}
      <div class="meta">${b.i}. ${b.seconds}s · ${esc(b.layout)}${b.punch > 1 ? ` · punch ×${b.punch}` : ''}<br>${esc(b.names.join(' + '))}</div>
      ${b.sup ? `<div class="sup"><b>${esc(b.sup.line1 || '')}</b><br><i>${esc(b.sup.line2 || '')}</i></div>` : ''}
      ${b.line ? `<div class="vo">“${esc(b.line)}”</div>` : ''}
      ${b.warn.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join('')}
    </div>`).join('')}
    ${c.cut.endCard ? `<div class="beat"><div class="noimg" style="color:var(--acc)">END CARD<br>${c.cut.endCard.seconds || 2.5}s</div>
      <div class="sup"><b>${esc([].concat(c.cut.endCard.headline || []).join(' '))}</b><br><i>${esc(c.cut.endCard.button || '')}</i></div></div>` : ''}
  </div>
  <div class="mute">
    <h4>Mute read — the supers alone, in order</h4>
    <ol>${c.supers.map((s) => `<li>${esc(s)}</li>`).join('') || '<li class="bad">no supers at all — this cut says nothing on mute</li>'}</ol>
  </div>
</div>`).join('')}
`;

const out = `${OUT}/plan.html`;
writeFileSync(out, html);

console.log(`\n✓ ${out}  —  ${cards.length} cut(s), ${cards.reduce((a, c) => a + c.strip.length, 0)} beat(s)`);
if (problems) {
  console.log(`  ⚠ ${problems} problem(s) flagged — fix them before building; each is something the build would refuse anyway.`);
}
console.log('\n  SHOW THIS TO THE USER AND GET A YES BEFORE BUILDING ANYTHING.');
console.log('  Read the mute list aloud with the video off — if it does not sell, the copy is not finished.\n');
