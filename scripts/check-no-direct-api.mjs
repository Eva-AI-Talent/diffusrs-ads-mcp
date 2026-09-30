#!/usr/bin/env node
// check-no-direct-api.mjs — the shipping gate that makes "renders ONLY through diffusr" a verifiable property,
// not a promise. Run it before zipping; it exits non-zero if anything in the package could reach a model API
// directly, or carries a credential.
//
//   node scripts/check-no-direct-api.mjs
//
// Why this exists: the package goes to third parties. It must be impossible to point it at another renderer
// (Seedance/BytePlus direct, Higgsfield, fal, sync.so) and it must never ship a key. Grep is the honest test —
// if a hostname or key name is absent from every shipped file, it cannot be called.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
// 'internal' = our own planning/architecture notes. They discuss our infrastructure and strategy and are
// EXCLUDED FROM THE ZIP, so they are not scanned as shipped content. scripts/pack.mjs must exclude them too.
const SKIP_DIRS = new Set(['node_modules', '.git', 'output', 'renders', '.DS_Store', 'internal']);
const TEXT_EXT = new Set(['.mjs', '.js', '.ts', '.json', '.md', '.py', '.sh', '.yml', '.yaml', '.txt', '.env']);

// Forbidden: a direct route to any VIDEO RENDERER other than the diffusr MCP, or a credential of any kind.
// (TTS/transcription vendors are allowed — they are opt-in stages with the user's own key and render no video.)
const FORBIDDEN = [
  [/ark\.[a-z-]*\.?bytepluses\.com/i, 'BytePlus ModelArk endpoint — renders must go through the diffusr MCP'],
  [/\bARK_(API_KEY|ACCESS_KEY|SECRET_KEY)\b/, 'BytePlus credential name'],
  [/api\.higgsfield\.ai/i, 'Higgsfield endpoint'],
  [/\bHIGGSFIELD_[A-Z0-9_]*\b/, 'Higgsfield credential name'],
  [/\bfal\.(run|ai)\b/i, 'fal.ai endpoint'],
  [/\bFAL_KEY[A-Z_]*\b/, 'fal credential name'],
  [/api\.sync\.so/i, 'sync.so endpoint'],
  // NOT forbidden: ElevenLabs. The guarantee this gate enforces is that VIDEO RENDERING can only happen
  // through the diffusr MCP. ElevenLabs is text-to-speech, an explicitly sanctioned OPTIONAL stage (scripts/
  // vo.mjs) that the user opts into with their own key, and it renders no video. Listing it here blocked a
  // legitimate feature. The renderer restrictions below are the ones that carry the guarantee.
  [/\bseedance-worker\b/i, 'our private Cloud Run worker — leads produce locally'],
  [/creator-wrapped-\d+/i, 'our GCP project id'],
  [/\bCLOUD_WORKER_(URL|TOKEN)\b/, 'our private worker credential'],
  // Any literal that looks like a live secret. Deliberately narrow to avoid false alarms on prose.
  [/\bsk-[A-Za-z0-9]{20,}/, 'live OpenAI-style secret key'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{40,}/, 'live id:secret token pair'],
];

// This checker necessarily NAMES the forbidden things, so it must exempt itself.
const SELF = 'scripts/check-no-direct-api.mjs';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    // .env is the ONE file that is supposed to hold a key. It is gitignored and is not in the package's
    // include list, so it cannot ship — and failing the gate over it would mean a lead who set a key the way
    // we told them to could no longer run pack.mjs. The guarantee that matters is enforced on the STAGED tree
    // in pack.mjs, which is the thing that actually becomes the zip.
    else if (name === '.env' || name.startsWith('.env.')) continue;
    else if (TEXT_EXT.has(extname(name))) out.push(full);
  }
  return out;
}

const findings = [];
for (const file of walk(ROOT)) {
  const rel = file.slice(ROOT.length + 1);
  if (rel === SELF) continue;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  text.split('\n').forEach((line, i) => {
    for (const [re, why] of FORBIDDEN) {
      if (re.test(line)) findings.push({ rel, line: i + 1, why, snippet: line.trim().slice(0, 110) });
    }
  });
}

if (findings.length) {
  console.error(`\n⛔ NOT SHIPPABLE — ${findings.length} finding(s):\n`);
  for (const f of findings) console.error(`  ${f.rel}:${f.line}  ${f.why}\n      ${f.snippet}`);
  console.error('\nRemove these before zipping. Rendering goes through the diffusr MCP only, and no credential ships.\n');
  process.exit(1);
}
console.log('✅ shippable — no direct model-API route, no private endpoint, no credential in any shipped file.');
console.log('   Rendering can only happen through the diffusr MCP tools.');
