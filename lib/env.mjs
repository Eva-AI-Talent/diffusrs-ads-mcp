// env.mjs — load .env, so a key set once keeps working.
//
// Without this the kit reads process.env only, which means every new terminal silently loses the keys and QA
// quietly reports "not verified" for a reason that has nothing to do with the video. Importing this at the top
// of anything that needs a key makes `.env` the single place they live.
//
// .env is gitignored and is never packaged. It is read, never written to by anything but scripts/setup.mjs.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve('.env');
if (existsSync(file)) {
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    // A key already exported in the shell WINS — otherwise a stale .env silently overrides what someone just set.
    if (!process.env[key]) process.env[key] = v;
  }
}
