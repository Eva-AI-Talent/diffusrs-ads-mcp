#!/usr/bin/env node
// ds-export.mjs — render a Diffusion Studio project to an mp4, and PROVE it rendered the right one.
//
//   node scripts/ds-export.mjs <slug> <cut-id> [--out path.mp4] [--timeout 900] [--restart]
//
// dapi runs one export at a time and it is slow, so this exports a single cut and blocks until it is done.
//
// THE CHECK THAT MATTERS. dapi caches an export per projectId. If an id is reused — or the app is still
// holding a previously-loaded composition — `dapi export` cheerfully writes the PREVIOUS project's render to
// the new filename. It does not error. The only tell is that the duration is wrong, which is why this refuses
// to report success until the measured duration matches the project's own timeline. A mismatch is reported as
// a cache hit and the recovery is printed, not swallowed.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, statSync, rmSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';

const A = process.argv.slice(2);
const val = (f, d) => { const i = A.indexOf(f); return i !== -1 && A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : d; };
const pos = A.filter((a) => !a.startsWith('--') && A[A.indexOf(a) - 1] !== '--out' && A[A.indexOf(a) - 1] !== '--timeout');
const [slug, cutId] = pos;
if (!slug || !cutId) { console.error('usage: node scripts/ds-export.mjs <slug> <cut-id> [--out path.mp4] [--restart]'); process.exit(1); }

try { execFileSync('dapi', ['--version'], { stdio: 'ignore' }); }
catch {
  console.error('\n⛔ `dapi` is not on PATH — Diffusion Studio is the editor for this kit.');
  console.error('   Install Diffusion Studio and its CLI, then re-run. To ship without an edit pass, the');
  console.error(`   flat cut at briefs/${slug}/remix/out/${cutId}.mp4 is already a finished video.\n`);
  process.exit(1);
}

const projDir = resolve(`briefs/${slug}/edit/${cutId}`);
const meta = `${projDir}/.ds.json`;
if (!existsSync(meta)) {
  console.error(`\n⛔ no dapi project at ${projDir}`);
  console.error(`   Build it first:  node scripts/ds-build.mjs ${slug} ${cutId}\n`);
  process.exit(1);
}
const P = JSON.parse(readFileSync(meta, 'utf8'));
const out = resolve(val('--out', `briefs/${slug}/remix/out/${cutId}-edit.mp4`));
const timeout = Number(val('--timeout', '900')) * 1000;
mkdirSync(dirname(out), { recursive: true });

// Two timeouts on purpose. An export legitimately takes minutes; `open` and `check` answer in seconds — and
// when the app has gone stale they answer NEVER, so giving them the export's budget means sitting for a
// quarter of an hour before finding out. Fail fast on the quick calls.
const CHAT = 90_000;
// killSignal SIGKILL, not the default SIGTERM: the dapi CLI is a wrapper around the app binary, and on SIGTERM
// it can survive and keep holding the app — which then blocks the NEXT dapi call, including one from somebody
// else's session. A timed-out call has to actually die.
const dapi = (args, opts = {}) => spawnSync('dapi', args,
  { cwd: projDir, encoding: 'utf8', killSignal: 'SIGKILL', timeout: args[0] === 'export' ? timeout : CHAT, ...opts });
const dur = (f) => { try { return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim()) || 0; } catch { return 0; } };
const wait = (ms) => execFileSync(process.execPath, ['-e', `setTimeout(()=>{}, ${ms})`]);

console.log(`\nEXPORT ${slug}/${cutId}  —  scene ${P.scene}, expecting ${P.dur.toFixed(2)}s`);

// The app's local asset connection can degrade after it has served a project: the next export comes back
// "successful" in a few seconds having written NOTHING, or floods `network error`. Restarting the app is the
// only fix — but restarting it means force-quitting an editor the user may have work open in, so this does
// NOT do that on its own. `--restart` opts in (use it for an unattended batch); otherwise it reports the
// failure and prints the two commands.
const RESTART = A.includes('--restart');
function restartApp() {
  // This force-quits the app for EVERYONE using it — any unsaved edit, and any other session driving dapi on
  // this machine, goes with it. That is why it never happens without --restart.
  console.log('  restarting Diffusion Studio (--restart) — this force-quits the app for anything else using it…');
  spawnSync('pkill', ['-9', '-f', 'Diffusion Studio']);
  wait(8000);
  spawnSync('open', ['-a', 'Diffusion Studio', '--args', '--disable-gpu-compositing']);
  wait(45000);
}

// 1) load it. The app must be holding THIS project before check or export mean anything.
console.log('  opening the project…');
const opened = dapi(['open', projDir]);
if (opened.status !== 0) {
  console.error(`\n⛔ dapi could not open the project.\n${(opened.stderr || opened.stdout || '').trim().slice(0, 400)}`);
  console.error('\n   The app bridge drops in automation. Recover with:');
  console.error('     pkill -9 -f "Diffusion Studio"; sleep 6; open -a "Diffusion Studio" --args --disable-gpu-compositing');
  console.error(`     sleep 45; dapi open ${JSON.stringify(projDir)}\n`);
  process.exit(1);
}

// 2) poll `check` until the duration settles. A transient wrong duration shows up right after a reload; the
//    value that matters is the one it holds, so read it twice the same before trusting it.
let reported = 0, stable = 0, lastIssues = [];
for (let i = 0; i < 20; i++) {
  wait(2000);
  const c = dapi(['check', P.scene]);
  // `check` answers with JSON: {stats:{duration},issues:[…]}. Parse it — a regex over the text would happily
  // read a number out of an issue message and compare the wrong thing.
  let d = 0, issues = [];
  try { const j = JSON.parse((c.stdout || '').trim()); d = Number(j?.stats?.duration) || 0; issues = j?.issues || []; }
  catch { d = 0; }
  if (/No such node/i.test(c.stdout || '')) {
    console.error(`\n⛔ the app does not have node "${P.scene}" — it is holding a different composition.`);
    console.error('   Re-open the folder, or restart the app, before exporting. Exporting now would write');
    console.error('   whatever it IS holding to this filename, without an error.\n');
    process.exit(1);
  }
  if (d && Math.abs(d - reported) < 0.05) { stable += 1; if (stable >= 2) break; } else { stable = 0; }
  if (d) { reported = d; lastIssues = issues; }
  if (c.status !== 0 && i > 6) {
    console.error(`\n⛔ dapi check failed on ${P.scene}:\n${(c.stderr || c.stdout || '').trim().slice(0, 400)}`);
    console.error('\n   "No such node" after an app restart is usually a malformed assets.yml in the project —');
    console.error('   delete it and re-open. `dapi logs` names the file and line.\n');
    process.exit(1);
  }
}
if (!reported) {
  console.error('\n⛔ the app never answered `dapi check` — it has stopped responding.');
  console.error('   It often serves a given project once per launch and then goes quiet. Quit it when you are');
  console.error('   ready (nothing is wrong with the project), then:');
  console.error('     pkill -9 -f "Diffusion Studio"; sleep 8; open -a "Diffusion Studio" --args --disable-gpu-compositing');
  console.error(`     sleep 45; node scripts/ds-export.mjs ${slug} ${cutId}`);
  console.error('   Or re-run with --restart to let this do it for you (it force-quits the app).\n');
  if (!RESTART) process.exit(1);
  restartApp();
  if (dapi(['open', projDir]).status !== 0) { console.error('⛔ still cannot open the project after a restart.\n'); process.exit(1); }
  wait(6000);
}
if (reported) {
  console.log(`  check: ${reported.toFixed(2)}s`);
  const errs = (lastIssues || []).filter((i) => i.severity === 'error');
  for (const i of errs) console.log(`  ⚠ ${i.code}: ${i.message}`);
  if (Math.abs(reported - P.dur) > 0.6) {
    console.error(`\n⛔ the app is holding a ${reported.toFixed(2)}s composition but this project is ${P.dur.toFixed(2)}s.`);
    console.error('   That is dapi serving another project from its cache — exporting now would write the WRONG video.');
    console.error('   Restart the app and re-open this folder before exporting:');
    console.error('     pkill -9 -f "Diffusion Studio"; sleep 6; open -a "Diffusion Studio" --args --disable-gpu-compositing');
    console.error(`     sleep 45; dapi open ${JSON.stringify(projDir)}\n`);
    process.exit(1);
  }
}

// 3) export
function attempt() {
  // Clear the target and any leftover .dstmp- temp from an interrupted run FIRST. dapi writes to a temp file
  // and renames it into place; with the destination already there it can come back reporting success while
  // leaving the old file untouched — which is how a "successful" export served a stale render byte-for-byte.
  // Removing the target also means the freshness check below cannot be fooled.
  rmSync(out, { force: true });
  for (const f of readdirSync(dirname(out))) {
    if (f.startsWith(`.dstmp-${basename(out)}`)) rmSync(`${dirname(out)}/${f}`, { force: true });
  }
  console.log('  exporting (this takes a while — dapi renders one at a time)…');
  const started = Date.now();
  const r = dapi(['export', P.scene, out]);
  const msg = (r.stderr || r.stdout || '').trim();
  if (!existsSync(out)) return { ok: false, why: msg || 'dapi reported success but wrote no file', started };
  const st2 = statSync(out);
  if (st2.mtimeMs < started - 1000) return { ok: false, why: 'the file on disk predates this export', started };
  if (st2.size < 200_000) return { ok: false, why: `only ${st2.size} bytes written`, started };
  return { ok: true, started };
}

let res = attempt();
if (!res.ok && RESTART) {
  console.log(`  ⚠ no export came back (${res.why}).`);
  restartApp();
  const re = dapi(['open', projDir]);
  if (re.status === 0) { wait(6000); res = attempt(); }
}
const t0 = res.started;
if (!res.ok) {
  const ex = { status: 1, stderr: res.why, stdout: '' };
  const msg = (ex.stderr || ex.stdout || '').trim();
  console.error(`\n⛔ no export was written${RESTART ? ', twice, with a restart in between' : ''}:\n  ${msg.slice(0, 600)}\n`);
  if (!RESTART) {
    // This is nearly always the app, not the project: it has already served this project once and its asset
    // connection is gone. Say so, and hand over the two commands — rather than force-quitting an editor the
    // user may have unsaved work in.
    console.error('   The app has usually just gone stale (it often exports a given project once per launch).');
    console.error('   Nothing is wrong with the project — quit the app when you are ready, then:');
    console.error('     pkill -9 -f "Diffusion Studio"; sleep 8; open -a "Diffusion Studio" --args --disable-gpu-compositing');
    console.error(`     sleep 45; node scripts/ds-export.mjs ${slug} ${cutId}`);
    console.error('   Or re-run with --restart to let this do it for you (it force-quits the app).\n');
  }
  if (/network error/i.test(msg)) {
    // Earned the hard way: the app serves a project's own assets over a local connection, and once that
    // breaks EVERY fetch fails — so a project that checks perfectly refuses to export. The usual cause is an
    // export that was interrupted. Restarting the app fixes it; nothing about the project needs changing, and
    // rebuilding it is wasted effort.
    console.error('   "network error" means the app could not read its OWN assets — it is in a bad state,');
    console.error('   not a bad project. It usually follows an INTERRUPTED export, so never kill one.');
    console.error('   Restart and re-open, then export again:');
    console.error('     pkill -9 -f "Diffusion Studio"; sleep 8; open -a "Diffusion Studio" --args --disable-gpu-compositing');
    console.error(`     sleep 45; dapi open ${JSON.stringify(projDir)}\n`);
  }
  process.exit(1);
}

// 4) prove it is this project's. Freshness was already established by attempt(); this is the content check —
// duration alone would pass a stale file, which is why both exist.
const d = dur(out);
const mb = statSync(out).size / 1048576;
console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)}s · ${d.toFixed(2)}s · ${mb.toFixed(1)}MB`);
if (Math.abs(d - P.dur) >= 0.6) {
  console.error(`\n⛔ the export does not match the project (${d.toFixed(2)}s vs ${P.dur.toFixed(2)}s expected).`);
  console.error('   Treat this as a cached render, not a near miss. Restart the app, re-open the folder, export again.\n');
  process.exit(1);
}
console.log(`\n✓ ${out}\n`);
console.log(`  QA it:  node scripts/qa.mjs ${slug} ${cutId} --file ${out}\n`);
