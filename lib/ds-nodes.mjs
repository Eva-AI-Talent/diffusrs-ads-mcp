// ds-nodes.mjs — the JSX nodes a Diffusion Studio project is made of.
//
// Shared by scripts/ds-build.mjs (the default edit) and scripts/ds-vox.mjs (the Vox option). Everything here
// emits a STRING of JSX, because a dapi project is a file the user then hand-edits in the app — so the output
// has to be literal, readable nodes with stable ids, not a runtime-generated tree they cannot drag.
//
// Two rules earned the hard way and enforced below:
//   · MEASURE text with the real font. A box sized by guessing at character widths WRAPS, and the second line
//     then overlaps the first. PIL reads the font's own metrics; `measure()` folds in letterSpacing too, or
//     every pill comes out that much too wide.
//   · dapi centres text on the font's EM box. Condensed faces sit high in that box, which reads as the text
//     hugging the top of its container — `vnudge()` pushes it back down.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

export const W = 1080, H = 1920;

export const expand = (p) => (p || '').replace(/^~/, homedir());

// ── measurement ─────────────────────────────────────────────────────────────────────────────────────────────
// One python call per build, not one per line: spawning PIL 40 times is most of a build's wall clock.
const cache = new Map();
export function measure(lines, fontFile, size, tracking = 0) {
  const want = [...new Set(lines)].filter((l) => !cache.has(`${fontFile}|${size}|${l}`));
  if (want.length) {
    let got = null;
    try {
      const out = execFileSync('python3', [new URL('../scripts/textw.py', import.meta.url).pathname],
        { input: JSON.stringify({ font: expand(fontFile), size, lines: want }), encoding: 'utf8' });
      got = JSON.parse(out);
    } catch { got = null; }
    want.forEach((l, i) => cache.set(`${fontFile}|${size}|${l}`, got ? got[i] : Math.round(l.length * size * 0.52)));
  }
  return lines.map((l) => {
    const w = cache.get(`${fontFile}|${size}|${l}`);
    // PIL under-measures a colour emoji's advance by ~20px; pad so a pill can never clip one.
    const emoji = [...l].filter((ch) => ch.codePointAt(0) > 0x2000).length;
    return Math.max(1, w + tracking * Math.max(0, l.length - 1) + emoji * 10);
  });
}

/** Shrink until the longest line fits its box. A line wider than its container wraps and collides with the next. */
export function fitSize(lines, maxw, base, fontFile, padx = 0, min = 40) {
  let size = base;
  while (size > min && Math.max(...measure(lines, fontFile, size)) + padx * 2 > maxw) size -= 2;
  return size;
}

/** dapi centres on the EM box; caps in a condensed face sit ~14% above that centre. */
export const vnudge = (size, factor = 0.14) => Math.round(size * factor);

// ── escaping ────────────────────────────────────────────────────────────────────────────────────────────────
// The text lands inside a JSX string literal, so a double quote would end it early. Swapping to a typographic
// quote keeps the glyph rather than dropping it.
// A CTA line reasonably ends in an arrow, and the obvious character is the emoji one — which the house
// fonts have no glyph for. In the burned path that renders as a hollow TOFU BOX; here it depends on
// whatever the app falls back to, which is worse, because the two paths then disagree. Map them to
// characters the fonts DO have, so a super looks the same however it was made.
// (scripts/render_super.py does the same thing, by probing the font rather than by table.)
const GLYPH_SUBS = [[/[\u2b07\u25bc\u25be\u{1f447}]/gu, '\u2193'],
                    [/[\u27a1\u25b6\u{1f449}]/gu, '\u2192'],
                    [/\ufe0f/g, '']];
export const safeGlyphs = (t) => GLYPH_SUBS.reduce((v, [re, to]) => v.replace(re, to), String(t));

export const jsxText = (t) => safeGlyphs(t).replace(/"/g, '”');
export const jsxAttr = (t) => String(t).replace(/"/g, '”');

// ── primitives ──────────────────────────────────────────────────────────────────────────────────────────────
const n = (v) => (Number.isFinite(v) ? (Number.isInteger(v) ? v : Number(v.toFixed(3))) : 0);

export function rect({ x, y, w, h, fill, id, t0, t1, radius = 0, children = '' }) {
  return `          <rect x={${n(x)}} y={${n(y)}} width={${n(w)}} height={${n(h)}} fill="${fill}" `
    + `cornerRadius={${n(radius)}} start={${n(t0)}} end={${n(t1)}} id="${id}"`
    + (children ? `>${children}</rect>` : ' />');
}

export function text({ x, y, w, h, body, size, color, id, t0, t1, font, weight = 700, align = 'center',
                       tracking = 0, children = '' }) {
  return `          <text x={${n(x)}} y={${n(y)}} width={${n(w)}} height={${n(h)}} `
    + `fontFamily="${jsxAttr(font)}" fontWeight={${weight}} fontSize={${n(size)}} letterSpacing={${n(tracking)}} `
    + `color="${color}" textAlign="${align}" textBaseline="middle" start={${n(t0)}} end={${n(t1)}} id="${id}">`
    + `{"${jsxText(body)}"}${children}</text>`;
}

export function image({ src, x, y, w, h, id, t0, t1, children = '' }) {
  return `          <image src="${jsxAttr(src)}" x={${n(x)}} y={${n(y)}} width={${n(w)}} height={${n(h)}} `
    + `start={${n(t0)}} end={${n(t1)}} id="${id}"` + (children ? `>${children}</image>` : ' />');
}

export function video({ src, x = 0, y = 0, w = W, h = H, id, t0, t1, sourceIn = 0, volume = null, children = '' }) {
  return `          <video src="${jsxAttr(src)}" x={${n(x)}} y={${n(y)}} width={${n(w)}} height={${n(h)}} `
    + `start={${n(t0)}} end={${n(t1)}} sourceIn={${n(sourceIn)}} id="${id}"`
    + (volume !== null ? ` volume={${n(volume)}}` : '')
    + (children ? `>${children}</video>` : ' />');
}

// ── motion ──────────────────────────────────────────────────────────────────────────────────────────────────
export const fadeIn = (d = 0.20) => `<animation type="fade" phase="in" duration={${d}} />`;
export const blurIn = (d = 0.28) => `<animation type="blur" phase="in" duration={${d}} />`;

/**
 * A keyframed slide. Elements that all fade in together read flat and templated; arriving from different
 * directions on slightly different beats is what makes a card look authored.
 */
export function slide(prop, from, to, { dur = 0.52, delay = 0, ease = 'easeOut', id = 'k' } = {}) {
  const mid = delay ? `<keyframe time={${n(delay)}} value={${n(from)}} easing="${ease}" id="${id}b" />` : '';
  return `<keyframeTrack property="${prop}" id="${id}t">`
    + `<keyframe time={0} value={${n(from)}} easing="${ease}" id="${id}a" />${mid}`
    + `<keyframe time={${n(delay + dur)}} value={${n(to)}} easing="${ease}" id="${id}c" /></keyframeTrack>`;
}

// ── captions (base-ve-diffusion §5: white bold, ONE soft shadow, no stroke) ──────────────────────────────────
// Phrase-grouped upstream. Each node clamps to the next one's start so two never flash at once.
export function captionNodes(caps, total, { font, size = 54, y = 0.775, color = '#ffffff', blur = 18 } = {}) {
  const out = [];
  const widths = measure(caps.map((c) => c.text || ''), font, size, -1);
  caps.forEach((c, i) => {
    const t0 = c.t[0];
    let t1 = Math.min(c.t[1], total);
    if (caps[i + 1]) t1 = Math.min(t1, caps[i + 1].t[0] - 0.03);
    if (t1 - t0 < 0.05 || !String(c.text || '').trim()) return;
    const w = Math.min(1000, widths[i] + 40);
    out.push(text({
      x: (W - w) / 2, y: Math.round(H * y), w, h: Math.round(size * 1.6), body: c.text, size, color,
      id: `cap${i}`, t0, t1, font, tracking: -1,
      children: `<shadow color="#000000" blur={${blur}} offsetX={0} offsetY={3} />`,
    }));
  });
  return out;
}
