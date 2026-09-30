#!/usr/bin/env node
// pack.mjs — build the zip that goes to a lead.
//
//   node scripts/pack.mjs [--out dist/diffusr-adkit.zip]
//
// Refuses to build unless the shipping gate passes, so a credential or a direct model-API route can never ride
// along. Excludes anything internal: our planning docs, test briefs, renders, node_modules, git.
//
// What ships: the skill, the scripts, the empty brief template, the README. Nothing that names our
// infrastructure, and no prompt text — the look comes from diffusr's templates at runtime.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, cpSync, statSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i !== -1 && A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : d; };
const out = resolve(val('--out', 'dist/diffusr-adkit.zip'));

// 1) the gate — never package something that could reach another renderer or carry a key
console.log('running the shipping gate…');
try { execFileSync(process.execPath, ['scripts/check-no-direct-api.mjs'], { stdio: 'inherit' }); }
catch { console.error('\n⛔ refusing to pack — fix the findings above first.\n'); process.exit(1); }

// 2) what ships
const INCLUDE = ['.claude', 'scripts', 'lib', 'styles', 'docs', 'brief.mjs', 'package.json', 'README.md', '.gitignore', '.mcp.json'];
// `_derived` holds packs read off somebody's own pegs — brief-specific, and not ours to ship.
const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', 'internal', 'renders', 'delivery', 'pegs', 'assets', 'personas', '_derived']);

const missing = INCLUDE.filter((p) => !existsSync(p));
if (missing.length) { console.error(`\n⛔ missing from the package: ${missing.join(', ')}`); process.exit(1); }

const stage = resolve('dist/.stage/diffusr-adkit');
rmSync(resolve('dist/.stage'), { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

for (const p of INCLUDE) {
  cpSync(p, join(stage, p), {
    recursive: true,
    filter: (src) => {
      const parts = src.split('/');
      return !parts.some((seg) => EXCLUDE_DIRS.has(seg));
    },
  });
}
// only the EMPTY brief template ships — never a real or test brief
mkdirSync(join(stage, 'briefs/_template'), { recursive: true });
cpSync('briefs/_template/state.json', join(stage, 'briefs/_template/state.json'));

// 3) sanity: nothing internal slipped in
const walk = (d, acc = []) => {
  for (const n of readdirSync(d)) {
    const f = join(d, n);
    statSync(f).isDirectory() ? walk(f, acc) : acc.push(f);
  }
  return acc;
};
const files = walk(stage);
const leaked = files.filter((f) => /\/internal\/|\/briefs\/(?!_template)/.test(f));
if (leaked.length) {
  console.error('\n⛔ internal content in the staged package:\n  ' + leaked.join('\n  '));
  process.exit(1);
}

// 3a) run the credential gate against the STAGED tree, not just the repo. The repo-wide pass deliberately
//     skips .env (that file is where a key is meant to live); this pass is the one that proves the thing being
//     zipped carries nothing. If they ever disagree, this is the one to believe.
try { execFileSync(process.execPath, [resolve('scripts/check-no-direct-api.mjs')], { cwd: stage, stdio: 'pipe' }); }
catch (e) {
  console.error('\n⛔ the STAGED package failed the credential gate — something got in that the repo pass missed:');
  console.error(String(e.stdout || e.message));
  process.exit(1);
}

// 3b) every relative import must resolve INSIDE the package. A script that imports a directory we forgot to
//     ship produces a package that crashes on the lead's machine the first time they run it — which is exactly
//     what happened when lib/ was left out of INCLUDE. Checking the STAGED tree is the only honest test.
const unresolved = [];
for (const f of files.filter((x) => x.endsWith('.mjs'))) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:from|import)\s+['"](\.[^'"]+)['"]/g)) {
    const target = resolve(dirname(f), m[1]);
    if (!existsSync(target)) unresolved.push(`${f.slice(stage.length + 1)} → ${m[1]}`);
  }
}
if (unresolved.length) {
  console.error('\n⛔ the staged package has imports that do not resolve — it would crash for the user:\n  '
    + unresolved.join('\n  ') + '\n  Add the missing path to INCLUDE.');
  process.exit(1);
}

// 4) zip
mkdirSync(resolve('dist'), { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-q', '-r', out, 'diffusr-adkit'], { cwd: resolve('dist/.stage') });
rmSync(resolve('dist/.stage'), { recursive: true, force: true });

const kb = Math.round(statSync(out).size / 1024);
console.log(`\n✓ ${out}  (${kb}KB, ${files.length} files)`);
console.log('  contains: the skill, the scripts, an empty brief template, the README');
console.log('  excludes: internal docs, every real/test brief, renders, node_modules\n');
