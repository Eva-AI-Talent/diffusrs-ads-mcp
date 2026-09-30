#!/usr/bin/env node
// match-template.mjs — THE TEMPLATE-FIRST GATE.
//
// House rule: an idea/peg/script must resolve to an EXISTING diffusr template. Only when nothing fits do we build
// a video from scratch — and that has to be a deliberate, stated decision, never a silent default.
//
//   node scripts/match-template.mjs --list
//   node scripts/match-template.mjs "grandma explains our app through a garage portal"
//   node scripts/match-template.mjs --peg briefs/<slug>/pegs/<id>.md
//
// Scores the description against the template catalogue and prints ranked candidates. A clear winner → use it
// (read its full recipe from the MCP: diffusr://templates/<uri>). No candidate over the floor → STOP and tell the
// user this is a from-scratch build, and get approval before spending.
//
// The catalogue below is PUBLIC MCP metadata (names/titles/descriptions as the server lists them) — it is only an
// index for routing. The recipe text itself is never copied here: it is fetched from diffusr at runtime, which is
// both why the look stays server-side and why this file carries no prompt content.
// Refresh it with: node scripts/match-template.mjs --refresh-hint   (prints how to re-sync from the MCP listing)

const CATALOG = [
  // uri suffix, title, blurb, routing keywords
  ['tpl-talking-head', 'Talking Head', 'One creator, a phone, and your script — said to camera.',
    ['talking head', 'ugc', 'creator', 'selfie', 'to camera', 'testimonial', 'review', 'confession', 'confesses',
     'monologue', 'spokesperson', 'influencer', 'phone camera', 'front camera', 'her phone', 'his phone', 'on camera',
     'talks to', 'speaks to', 'story time', 'vlog', 'hook', 'script', 'says']],
  ['tpl-podcast', 'Podcast', 'Two hosts, one studio, one take — a polished viral podcast clip.',
    ['podcast', 'two hosts', 'interview', 'conversation', 'dialogue', 'guest', 'clip', 'studio', 'mic', 'two people']],
  ['claymation-explainers', 'Claymation Explainers', 'Your product, explained in handmade clay.',
    ['explainer', 'explain', 'how it works', 'clay explainer', 'process', 'educational']],
  ['portal-grandma', 'Portal Grandma', 'Suburban garage portals, deadpan grandma, anxious grandkid.',
    ['grandma', 'portal', 'garage', 'deadpan', 'grandkid', 'skit', 'absurd']],
  ['tpl-animation-clay', 'Claymation', 'Handmade stop-motion clay, fingerprints and all.',
    ['clay', 'claymation', 'stop motion', 'plasticine', 'handmade']],
  ['tpl-animation-lego', 'LEGO', 'Minifigures and brick sets, shot on a tabletop.',
    ['lego', 'brick', 'minifig', 'minifigure', 'toy']],
  ['tpl-animation-glossy', 'Pixar', 'Polished animated-feature 3D with warm cinematic light.',
    ['pixar', '3d animation', 'animated feature', 'cgi', 'glossy', 'disney']],
  ['tpl-animation-lowpoly-ps1', 'PS1', 'Janky late-90s game — crude polygons, smeared photo textures.',
    ['ps1', 'playstation', 'low poly retro', 'n64', '90s game', 'janky', 'retro game']],
  ['tpl-animation-low-poly', 'Low-poly', 'Faceted geometric 3D, clean and modern.',
    ['low poly', 'faceted', 'geometric', 'polygonal']],
  ['tpl-animation-visdev-sunlit', 'Visdev Sunlit', 'Matte hand-painted daylight, soft haze, real form.',
    ['visdev', 'sunlit', 'hand painted', 'painterly', 'daylight', 'matte painting', 'storybook']],
  ['tpl-animation-gouache-nocturne', 'Gouache Nocturne', 'Hand-painted night scenes lit by one warm lamp.',
    ['gouache', 'nocturne', 'night', 'painted night', 'lamp lit', 'moody painting']],
  ['tpl-animation-80s-cartoon', '80s Cartoon', 'Saturday-morning cel animation on a fuzzy 80s TV.',
    ['80s cartoon', 'saturday morning', 'cel', 'retro cartoon', 'vhs cartoon']],
  ['tpl-animation-anime-shinkai', 'Anime', 'Makoto Shinkai skies — painted photoreal backgrounds, cel-shaded people.',
    ['anime', 'shinkai', 'manga', 'japanese animation', 'cel shaded']],
  ['tpl-animation-zackd', 'Zack D Films', 'Stiff uncanny 3D on a bright cyan grid stage.',
    ['zack d', 'zackd', 'uncanny', 'cyan grid', 'creepy fact', 'horror fact']],
  ['tpl-animation-fern', 'Fern', 'Near-dark, desaturated, one shaft of light.',
    ['fern', 'dark', 'desaturated', 'shaft of light', 'somber', 'bleak']],
  ['tpl-animation-sausage-party', 'Sausage Party', 'Your product with a face, arms and an attitude.',
    ['mascot', 'product with a face', 'talking product', 'sausage party', 'anthropomorphic', 'character product']],
  ['tpl-animation-rick-and-morty', 'Rick and Morty', 'Hand-drawn adult cartoon, flat colour, slightly sci-fi.',
    ['rick and morty', 'adult cartoon', 'hand drawn', 'sci fi cartoon', 'flat colour']],
  ['tpl-animation-styl', 'Spider-Verse', 'Cel-shaded 3D with halftone and bold ink lines.',
    ['spider verse', 'spiderverse', 'halftone', 'comic book', 'ink lines', 'graphic novel']],
  ['tpl-animation-bighead', 'Big-head', 'Chunky big-head characters on pastel gradients.',
    ['big head', 'bighead', 'chunky', 'pastel', 'cute character']],
  ['tpl-animation-barbie', 'Barbie', 'Glossy plastic dolls in ordinary real places.',
    ['barbie', 'doll', 'plastic', 'toy people']],
  ['tpl-animation-vox', 'Vox', 'Torn-paper collage with an editorial feel.',
    ['vox', 'paper collage', 'torn paper', 'editorial', 'explainer collage', 'cutout']],
  ['tpl-animation-crochet', 'Crochet', 'Soft yarn characters on a cozy felt set.',
    ['crochet', 'yarn', 'knit', 'felt', 'cozy', 'amigurumi']],
];

const SCORE_FLOOR = 2;

// STYLE MODIFIERS that no template owns. A request naming several of these is a HYBRID — "claymation noir
// western musical" is not the claymation template, however loudly the word "claymation" scores. Keyword matching
// alone happily returns the nearest template with full confidence, which is exactly the silent-nearest-pick the
// format rule exists to prevent. So: count the distinct style ideas in the request, and if the winning template
// accounts for only one of several, stop and ask rather than assert.
const MODIFIERS = [
  'noir', 'western', 'musical', 'cyberpunk', 'steampunk', 'vaporwave', 'gothic', 'horror', 'documentary',
  'silent film', 'film noir', 'surreal', 'psychedelic', 'brutalist', 'baroque', 'renaissance', 'medieval',
  'retro', 'vintage', 'futuristic', 'dystopian', 'mockumentary', 'sitcom', 'telenovela', 'opera', 'ballet',
  'claymation', 'anime', 'pixar', 'lego', 'crochet', 'barbie', 'collage', 'low poly', 'cel',
];
export function styleSignals(text) {
  const t = norm(text);
  return [...new Set(MODIFIERS.filter((m) => t.includes(m)))];
}   // below this, treat as NO MATCH → from-scratch, which needs explicit approval

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');

export function scoreTemplates(text) {
  const t = norm(text);
  return CATALOG
    .map(([uri, title, blurb, keys]) => {
      let score = 0;
      const hits = [];
      for (const k of keys) {
        if (t.includes(k)) { score += k.includes(' ') ? 3 : 2; hits.push(k); }   // multi-word hits are stronger signal
      }
      // a title mentioned outright is decisive
      if (t.includes(norm(title))) { score += 4; hits.push(`title:${title}`); }
      return { uri, title, blurb, score, hits };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

if (process.argv[1] && process.argv[1].endsWith('match-template.mjs')) {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    console.log(`\ndiffusr templates (${CATALOG.length}) — read a recipe with: diffusr://templates/<uri>\n`);
    for (const [uri, title, blurb] of CATALOG) console.log(`  ${title.padEnd(22)} ${uri.padEnd(34)} ${blurb}`);
    console.log('\nTEMPLATE-FIRST RULE: match one of these, or STOP and get approval for a from-scratch build.\n');
    process.exit(0);
  }
  if (args.includes('--refresh-hint')) {
    console.log('Re-sync the catalogue from the live MCP listing, then update CATALOG above:');
    console.log('  ListMcpResourcesTool(server="diffusr")  → every diffusr://templates/... uri + title + description');
    process.exit(0);
  }
  let text = args.filter((a) => !a.startsWith('--')).join(' ');
  const pegIdx = args.indexOf('--peg');
  if (pegIdx !== -1 && args[pegIdx + 1]) {
    const { readFileSync } = await import('node:fs');
    try { text += ' ' + readFileSync(args[pegIdx + 1], 'utf8'); }
    catch (e) { console.error(`could not read peg file: ${e.message}`); process.exit(1); }
  }
  if (!text.trim()) {
    console.error('usage: node scripts/match-template.mjs "<idea / peg / script description>" | --peg <file> | --list');
    process.exit(1);
  }
  const ranked = scoreTemplates(text);
  if (!ranked.length || ranked[0].score < SCORE_FLOOR) {
    console.log('\n⛔ NO TEMPLATE MATCH.');
    console.log('   This is a FROM-SCRATCH build. Per the template-first rule: tell the user no existing diffusr');
    console.log('   template fits, say what you would build instead, and get approval BEFORE spending credits.');
    console.log('   Do not silently pick the nearest template.\n');
    if (ranked.length) console.log(`   (weak signals: ${ranked.slice(0, 3).map((r) => `${r.title}=${r.score}`).join(', ')})\n`);
    process.exit(3);
  }
  const top = ranked[0];
  const runnerUp = ranked[1];
  // a hybrid request: several distinct style ideas, of which the winner covers one
  const signals = styleSignals(text);
  const covered = signals.filter((sg) => top.hits.some((h) => h.toLowerCase().includes(sg)) || norm(top.title).includes(sg));
  if (signals.length > 1 && covered.length < signals.length) {
    console.log(`\n⛔ HYBRID REQUEST — no single template covers this.`);
    console.log(`   style ideas named: ${signals.join(' + ')}`);
    console.log(`   closest template: ${top.title} — which only covers "${covered[0] || 'part of it'}".`);
    console.log('   Per the format rule: say plainly that nothing fits, describe what you would build instead,');
    console.log('   and get approval BEFORE spending. Do NOT quietly build the closest one.\n');
    process.exit(3);
  }
  const decisive = !runnerUp || top.score >= runnerUp.score * 1.5;
  console.log(`\n${decisive ? '✅ MATCH' : '⚠ AMBIGUOUS — confirm with the user'}: ${top.title}  (score ${top.score})`);
  console.log(`   recipe: diffusr://templates/${top.uri}`);
  console.log(`   ${top.blurb}`);
  console.log(`   matched on: ${top.hits.join(', ')}`);
  if (ranked.length > 1) {
    console.log('\n   other candidates:');
    for (const r of ranked.slice(1, 4)) console.log(`     ${r.title.padEnd(22)} ${String(r.score).padStart(2)}  ${r.uri}`);
  }
  console.log('\n   NEXT: read that recipe from the MCP and follow it step by step. Keep its wording verbatim —');
  console.log('   that text is the look. Replace only the ALL-CAPS parts.\n');
}
