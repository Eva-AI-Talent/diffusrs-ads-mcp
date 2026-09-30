// remix-formats.mjs — the format catalogue as DATA, so a slate can be recommended from what the footage
// actually contains rather than guessed.
//
// Each format is a GRAMMAR OVER BEAT ROLES (PROBLEM / PRODUCT / ACTION / PROOF / PERSON), not a fixed shot list
// — which is why one library yields all of them. `needs` is the minimum count of each role for the format to be
// buildable; `distinct` means those windows should come from DIFFERENT people/scenes or the format collapses.
//
// Slate rule: two cuts that share a format AND an audio mode are one cut twice. Spread across `opening`,
// `spine`, `audio` and length.

export const ROLES = ['PROBLEM', 'PRODUCT', 'ACTION', 'PROOF', 'PERSON'];

// audio: 'bed' (source dropped, music) · 'native' (keep their voices) · 'ambient' (the action's own sound)
export const FORMATS = [
  {
    id: 'four-up-proof', name: 'Four-Up Proof', style: 'GRID', sec: [12, 16], proven: true,
    grammar: 'quad(PROBLEM ×4) → quad(ACTION ×4) → quad(PROOF ×4) → PRODUCT',
    needs: { PROBLEM: 4, ACTION: 4, PROOF: 4, PRODUCT: 1 }, distinct: ['PROBLEM', 'ACTION', 'PROOF'],
    opening: 'grid', spine: 'stages', audio: ['bed'],
    why: 'The grid IS the argument: it happened to four different people. Strongest cold-traffic opener — four faces beat one.',
    note: 'A 2×2 of 9:16 cells is still 9:16, nothing is cropped. Composites render silent, so it lays its own bed.',
  },
  {
    id: 'problem-rack', name: 'Problem Rack', style: 'SNAP', sec: [14, 18], proven: true,
    grammar: 'PROBLEM(a) → PROBLEM(b) → PROBLEM(c) → PROBLEM(d) → ACTION → PROOF → PRODUCT',
    needs: { PROBLEM: 4, ACTION: 1, PROOF: 1, PRODUCT: 1 }, distinct: ['PROBLEM'],
    opening: 'single', spine: 'list', audio: ['bed'],
    why: 'Rapid-fire list of what it removes, ~1.5s apiece, a whip between each.',
    note: 'Hold super line 1 and swap only line 2 — the stack stays put and reads as a mechanism, not four unrelated cards.',
  },
  {
    id: 'qa-cycle', name: 'Q&A Cycle', style: 'ORGANIC', sec: [20, 26], proven: true,
    grammar: '[PROBLEM → ACTION → ACTION → PROOF] × N → PRODUCT',
    needs: { PROBLEM: 2, ACTION: 4, PROOF: 2, PRODUCT: 1 }, distinct: ['PROBLEM'],
    opening: 'question', spine: 'cycle', audio: ['bed', 'native'],
    why: '"Cement? Got it." repeated per problem. The held answer super rides every beat except the question.',
    note: 'A spoken line must ask on the problem shot and answer over the action, or it finishes before the cycle starts. Let the line OVERRUN its beat rather than stretching the beat.',
  },
  {
    id: 'short-loop', name: 'Short Loop', style: 'SNAP', sec: [6, 9], proven: true,
    grammar: 'PROBLEM → ACTION → PROOF',
    needs: { PROBLEM: 1, ACTION: 1, PROOF: 1 }, distinct: [],
    opening: 'single', spine: 'linear', audio: ['bed'],
    why: 'Built to loop seamlessly — the last frame should sit comfortably before the first. Cheapest to produce, best cost-per-impression, ideal for retargeting.',
  },
  {
    id: 'progressive-split', name: 'Progressive Split', style: 'GRID', sec: [18, 24], proven: true,
    grammar: 'full → split2 → split3 → quad → PRODUCT',
    needs: { ACTION: 4, PRODUCT: 1 }, distinct: ['ACTION'],
    opening: 'single', spine: 'accumulation', audio: ['bed'],
    why: 'Starts on one person and adds a pane per beat. The accumulation does the "lots of people use this" work without a word.',
    note: 'Never leaves an empty cell. Supers slightly larger than house — the picture is busier.',
  },
  {
    id: 'reverse-reveal', name: 'Reverse Reveal', style: 'ORGANIC', sec: [13, 16], proven: true,
    grammar: 'PROOF → PROBLEM → ACTION → PROOF → PRODUCT',
    needs: { PROOF: 2, PROBLEM: 1, ACTION: 1, PRODUCT: 1 }, distinct: [],
    opening: 'end-state', spine: 'reverse', audio: ['bed', 'native'],
    why: 'Opens on the end state then rewinds — a tension loop in the structure rather than the copy.',
    note: 'The rewind beat wants a push-in on the detail. If the subject sits at the frame edges a centred crop cannot hold it — check framing before promising a zoom.',
  },
  {
    id: 'roll-call', name: 'Roll Call', style: 'SNAP', sec: [13, 16], proven: true,
    grammar: 'held question super + [PERSON → ACTION] × N → PRODUCT',
    needs: { PERSON: 3, ACTION: 3, PRODUCT: 1 }, distinct: ['PERSON'],
    opening: 'question', spine: 'roll-call', audio: ['bed', 'native'],
    why: '"Who uses it?" held across the whole cut while each person names themselves.',
    note: 'Short beats (~1.4s name / 1.8s action) or it drags.',
  },
  {
    id: 'timer-proof', name: 'Timer Proof', style: 'ORGANIC', sec: [11, 14], proven: true,
    grammar: 'ACTION@0:00 → ACTION@0:04 → PROOF@0:09 → PRODUCT',
    needs: { ACTION: 2, PROOF: 1, PRODUCT: 1 }, distinct: [],
    opening: 'single', spine: 'timer', audio: ['bed', 'ambient'],
    why: 'Real-time proof with the clock on screen.',
    note: 'Lead the timecode in the accent colour with the label under it, so the clock reads as the thing being counted. A tick bed needs a quiet drone under it — pure ticks leave the gaps dead.',
  },
  {
    id: 'testimonial-chain', name: 'Testimonial Chain', style: 'DOC', sec: [30, 35], proven: true,
    grammar: 'PERSON(a) → PERSON(b) → PERSON(c) → PERSON(d) → PRODUCT',
    needs: { PERSON: 3, PRODUCT: 1 }, distinct: ['PERSON'],
    opening: 'single', spine: 'chain', audio: ['native'],
    why: 'Native voices back to back, one held super, CTA at the end. The cut that converts warm traffic.',
    note: 'NO whips — a transition strips audio unless it cross-fades. If the last beat is a silent composite, ride the source audio down into it or the final speaker is cut off mid-phrase.',
  },
  {
    id: 'hero-receipts', name: 'Hero + Receipts', style: 'DOC', sec: [25, 28], proven: true,
    grammar: 'PERSON(hero) → ACTION(hero) → ACTION(other, muted) → ACTION(other, muted) → PERSON(hero) → PRODUCT',
    needs: { PERSON: 1, ACTION: 3, PRODUCT: 1 }, distinct: ['ACTION'],
    opening: 'single', spine: 'hero-evidence', audio: ['native'],
    why: 'One narrator, other people\'s footage as silent evidence under their names.',
    note: 'Label the muted cutaways with who they are — the labels do the attribution.',
  },
  {
    id: 'process-asmr', name: 'Process / ASMR', style: 'KINETIC', sec: [18, 22], proven: true,
    grammar: 'ACTION ×4 (different people) → PRODUCT',
    needs: { ACTION: 4, PRODUCT: 1 }, distinct: ['ACTION'],
    opening: 'extreme-close', spine: 'process', audio: ['ambient'],
    why: 'No talking, the action\'s own sound, one held super naming the mechanism.',
    note: 'CHECK FIRST: action windows usually have someone talking over them. If they do you cannot have the sound without the voice — accept the voices or lay a synthesised bed.',
    requiresSilentAction: true,
  },
  {
    id: 'split-compare', name: 'Split-Screen Compare', style: 'GRID', sec: [10, 14], proven: false,
    grammar: 'split2(PROBLEM | PROOF) held → PRODUCT',
    needs: { PROBLEM: 1, PROOF: 1, PRODUCT: 1 }, distinct: [],
    opening: 'grid', spine: 'comparison', audio: ['bed'],
    why: 'Before and after in one frame for the whole cut. Reads instantly on mute; the strongest thumbnail in the set.',
  },
  {
    id: 'countdown-list', name: 'Countdown List', style: 'SNAP', sec: [15, 20], proven: false,
    grammar: 'held "3 things…" + [PROOF|ACTION] ×3 numbered → PRODUCT',
    needs: { ACTION: 2, PROOF: 1, PRODUCT: 1 }, distinct: [],
    opening: 'question', spine: 'countdown', audio: ['bed'],
    why: 'Numbered supers create their own tension loop — the viewer stays for #1.',
  },
  {
    id: 'objection-killer', name: 'Objection Killer', style: 'ORGANIC', sec: [14, 18], proven: false,
    grammar: 'super(objection) → ACTION → PROOF → super(answered) → PRODUCT',
    needs: { ACTION: 1, PROOF: 1, PRODUCT: 1 }, distinct: [],
    opening: 'question', spine: 'objection', audio: ['bed', 'native'],
    why: 'Open on the objection as an on-screen question and answer it with footage only. Every scroll-stopper in the comments is a variation.',
  },
  {
    id: 'pov-hands', name: 'POV / Hands-Only', style: 'KINETIC', sec: [10, 14], proven: false,
    grammar: 'PRODUCT(close) → ACTION(hands) → PROOF(hands)',
    needs: { PRODUCT: 1, ACTION: 1, PROOF: 1 }, distinct: [],
    opening: 'extreme-close', spine: 'linear', audio: ['bed', 'ambient'],
    why: 'Faceless — travels across markets and people because nobody\'s face is in it.',
    note: 'Needs tight in-points; check the face is genuinely out of frame.',
  },
  {
    id: 'one-person-cutdown', name: 'One-Person Cut-Down', style: 'ORGANIC', sec: [12, 15], proven: false,
    grammar: 'PROBLEM → ACTION → PROOF → PRODUCT, all from ONE person',
    needs: { PROBLEM: 1, ACTION: 1, PROOF: 1, PRODUCT: 1 }, distinct: [],
    opening: 'single', spine: 'linear', audio: ['bed', 'native'],
    why: 'The plainest format — and the one to run PER PERSON. Four people = four cuts for almost no extra work, and they tell you which face performs.',
    perPerson: true,
  },
  {
    id: 'stat-card', name: 'Stat Card', style: 'SNAP', sec: [8, 12], proven: false,
    grammar: 'PROOF → PRODUCT, big number supers doing the talking',
    needs: { PROOF: 1, PRODUCT: 1 }, distinct: [],
    opening: 'end-state', spine: 'stat', audio: ['bed'],
    why: 'Pure mute-read. No speech at all.',
  },
  {
    id: 'question-ladder', name: 'Question Ladder', style: 'SNAP', sec: [12, 16], proven: false,
    grammar: 'super(Q1) → ACTION → super(Q2) → ACTION → super(Q3) → PROOF → PRODUCT',
    needs: { ACTION: 2, PROOF: 1, PRODUCT: 1 }, distinct: [],
    opening: 'question', spine: 'ladder', audio: ['bed'],
    why: 'Three escalating questions answered only by picture. A Q&A Cycle with no dialogue and faster rungs.',
  },
];

// LOOK PACKS — the same beat list in two packs is two genuinely different ads for one build.
export const PACKS = [
  {
    id: 'organic', name: 'Organic', reads: "a creator's own post",
    signature: 'centred pills, soft sans, one line white + one in the accent colour, blur-in per line',
    use: 'the default; feels native in-feed, best for cold traffic and anything testimonial',
  },
  {
    id: 'branded', name: 'On-brand', reads: 'a paid DTC ad',
    signature: 'condensed caps on dark slabs with an accent bar, persistent wordmark + offer badge, product end card',
    use: 'when the brand must be unmissable — retargeting, offer-led cuts, anything with a price',
    needsBrandTokens: true,
  },
];

// Which formats can this library actually build?
export function feasible(roleCounts, opts = {}) {
  const silentAction = opts.silentAction !== false;
  return FORMATS.map((f) => {
    const missing = [];
    for (const [role, n] of Object.entries(f.needs)) {
      const have = roleCounts[role] || 0;
      if (have < n) missing.push(`${role} ${have}/${n}`);
    }
    const blocked = f.requiresSilentAction && !silentAction
      ? 'action windows have speech over them — no clean ambient bed'
      : null;
    return { ...f, missing, blocked, ok: missing.length === 0 && !blocked };
  });
}

// A balanced slate: spread across length, spine and audio mode. Never two cuts sharing format AND audio.
export function proposeSlate(roleCounts, opts = {}) {
  const all = feasible(roleCounts, opts).filter((f) => f.ok);
  const bucket = (f) => (f.sec[1] <= 9 ? 'short' : f.sec[1] <= 16 ? 'mid' : f.sec[1] <= 24 ? 'long' : 'xlong');
  const target = { short: 2, mid: 8, long: 4, xlong: 2 };
  const picked = [];
  const usedSpines = new Set();

  // proven first, then spine variety, then the rest
  const order = [...all].sort((a, b) => (b.proven - a.proven) || (a.sec[0] - b.sec[0]));
  for (const pass of [1, 2]) {
    for (const f of order) {
      const b = bucket(f);
      if (picked.filter((p) => bucket(p) === b).length >= target[b]) continue;
      if (picked.some((p) => p.id === f.id)) continue;
      if (pass === 1 && usedSpines.has(f.spine)) continue;   // first pass: one per spine
      picked.push(f);
      usedSpines.add(f.spine);
    }
  }
  // Assign the audio mode to DIVERSIFY, not just to avoid duplicates. Picking each format's first listed mode
  // returns a slate that is technically varied and practically all-'bed' — which is one ad N times to the
  // algorithm. Give each format whichever of its allowed modes is least used so far.
  const used = { bed: 0, native: 0, ambient: 0 };
  // formats with only ONE possible mode go first, so they claim it before the flexible ones spread out
  const assignOrder = [...picked].sort((a, b) => a.audio.length - b.audio.length);
  const audioFor = new Map();
  for (const f of assignOrder) {
    const mode = [...f.audio].sort((x, y) => used[x] - used[y])[0];
    used[mode]++;
    audioFor.set(f.id, mode);
  }
  return picked.map((f, i) => ({ ...f, audio: audioFor.get(f.id), pack: i % 3 === 2 ? 'branded' : 'organic' }));
}
