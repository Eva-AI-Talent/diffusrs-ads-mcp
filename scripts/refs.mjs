#!/usr/bin/env node
// refs.mjs — the reference-sheet ledger and the gate that stands in front of every render.
//
//   node scripts/refs.mjs <slug> <VIDEO>                                  # status: locked vs missing
//   node scripts/refs.mjs <slug> <VIDEO> --add character <file> --desc "Mia, kitchen"
//   node scripts/refs.mjs <slug> <VIDEO> --add prop <file> --desc "the bottle"
//   node scripts/refs.mjs <slug> <VIDEO> --add env <file> --desc "the garage (no person)"
//   node scripts/refs.mjs <slug> <VIDEO> --approve                        # AFTER the user has seen every picture
//   node scripts/refs.mjs <slug> <VIDEO> --check                          # exit 1 if not render-ready
//
// Why a gate: a wrong or missing reference costs EVERY clip made from it. Locking the key elements first — and
// showing the user each picture — is what keeps the face, the room and the product identical across the video.
//
// Note on rooms (see the adkit-brief skill §5): a person's picture carries their room, and a separate room
// picture does NOT override it. So an `env` sheet is for shots with NO person in them. A character sheet is
// registered per (person × room).

import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';

const A = process.argv.slice(2);
const has = (f) => A.includes(f);
const val = (f, d = null) => { const i = A.indexOf(f); return i !== -1 && A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : d; };
const pos = A.filter((a, i) => !a.startsWith('--') && !(i > 0 && A[i - 1].startsWith('--')));
const [slug, video] = pos;

if (!slug || !video) { console.error('usage: node scripts/refs.mjs <slug> <VIDEO> [--add <character|env|prop> <file> --desc "…"] [--approve] [--check]'); process.exit(1); }
const sp = `briefs/${slug}/state.json`;
if (!existsSync(sp)) { console.error(`✗ no brief at ${sp}`); process.exit(1); }

const st = JSON.parse(readFileSync(sp, 'utf8'));
st.videos = st.videos || {};
const v = st.videos[video] = st.videos[video] || {};
v.references = v.references || { characters: [], env: [], props: [] };
const R = v.references;
const save = () => writeFileSync(sp, JSON.stringify(st, null, 2));

// ── add a sheet ─────────────────────────────────────────────────────────────────────────────────────────────
if (has('--add')) {
  const i = A.indexOf('--add');
  const kind = A[i + 1];
  const file = A[i + 2];
  const desc = val('--desc', '');
  const bucket = { character: 'characters', characters: 'characters', env: 'env', room: 'env', prop: 'props', props: 'props', product: 'props' }[kind];
  if (!bucket) { console.error(`✗ --add needs a kind: character | env | prop  (got "${kind}")`); process.exit(1); }
  if (!file || !existsSync(file)) { console.error(`✗ file not found: ${file}`); process.exit(1); }
  const bytes = statSync(file).size;
  if (bytes < 12000) console.error(`  ⚠ ${file} is only ${Math.round(bytes / 1024)}KB — a thumbnail is refused as a reference (needs 300–6000px a side).`);
  R[bucket] = R[bucket].filter((x) => x.file !== file);
  R[bucket].push({ file, desc, bytes, added: new Date().toISOString() });
  v.referencesApproved = false;   // any new sheet invalidates a previous sign-off
  save();
  console.log(`✓ ${bucket}: ${file}${desc ? ` — ${desc}` : ''}`);
  console.log('  (approval reset — the user must see the updated set before rendering)');
  process.exit(0);
}

// ── what's missing ──────────────────────────────────────────────────────────────────────────────────────────
const problems = [];
const missingFiles = [];
for (const [bucket, items] of Object.entries(R)) {
  for (const it of items) if (!existsSync(it.file)) missingFiles.push(`${bucket}: ${it.file}`);
}
if (missingFiles.length) problems.push(`reference file(s) no longer on disk:\n     ${missingFiles.join('\n     ')}`);
if (!R.characters.length && !R.env.length) problems.push('no character or environment sheet — nothing locks who is on camera or where.');

// Product law: if the brief has a product image, a video that shows the product must carry it as a prop sheet.
const productImg = st.assets?.product || (st.product?.images || [])[0] || null;
const showsProduct = v.showsProduct !== false;   // default true — most ads show the product
if (showsProduct) {
  if (!productImg && !R.props.length) {
    problems.push('the product is shown but there is NO product image. Product law: the real product photo is the\n'
      + '     source of truth and must be passed as a reference. Ask the user for one.');
  } else if (productImg && !R.props.some((p) => p.file === productImg)) {
    problems.push(`the real product photo is not registered as a prop sheet:\n     node scripts/refs.mjs ${slug} ${video} --add prop ${productImg} --desc "the product"`);
  }
}

const total = R.characters.length + R.env.length + R.props.length;

// ── approve ─────────────────────────────────────────────────────────────────────────────────────────────────
if (has('--approve')) {
  if (problems.length) {
    console.error(`\n⛔ cannot approve — ${problems.length} problem(s):\n`);
    for (const p of problems) console.error(`   • ${p}`);
    console.error('');
    process.exit(1);
  }
  v.referencesApproved = true;
  v.referencesApprovedAt = new Date().toISOString();
  save();
  console.log(`✅ references approved for ${slug}/${video} — ${total} sheet(s) locked. Render may proceed.`);
  process.exit(0);
}

// ── check (render gate) ─────────────────────────────────────────────────────────────────────────────────────
if (has('--check')) {
  if (!v.referencesApproved || problems.length) {
    console.error(`⛔ NOT render-ready: ${problems.length ? problems.length + ' problem(s)' : 'references not approved'}.`);
    for (const p of problems) console.error(`   • ${p}`);
    if (!problems.length) console.error(`   • show the user every picture, then: node scripts/refs.mjs ${slug} ${video} --approve`);
    process.exit(1);
  }
  console.log('✅ render-ready.');
  process.exit(0);
}

// ── status ──────────────────────────────────────────────────────────────────────────────────────────────────
console.log(`\nREFERENCE SHEETS — ${slug}/${video}   ${v.referencesApproved ? '✅ approved' : '⏳ not approved'}\n`);
for (const [bucket, items] of Object.entries(R)) {
  console.log(`  ${bucket} (${items.length})`);
  if (!items.length) console.log('    —');
  for (const it of items) {
    console.log(`    ${existsSync(it.file) ? '·' : '✗'} ${it.file}${it.desc ? `  — ${it.desc}` : ''}`);
  }
}
if (problems.length) {
  console.log(`\n  ⛔ ${problems.length} problem(s) before this can be approved:`);
  for (const p of problems) console.log(`   • ${p}`);
} else if (!v.referencesApproved) {
  console.log('\n  Everything required is present. Show the user EVERY picture, then:');
  console.log(`    node scripts/refs.mjs ${slug} ${video} --approve`);
}
console.log('\n  Reminder: bind each reference in the prompt ("Image 1 is …"), pass them ALL, and never write a');
console.log('  name onto a picture. A person\'s picture carries their room — an env sheet is for person-less shots.\n');
