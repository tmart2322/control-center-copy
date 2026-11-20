#!/usr/bin/env node
// Contrast check for the v2 tokens (brief 14 §3.3, pairs from §6.3). No dependencies.
//
//   npm run contrast                 → checks src/styles/brand.css, prints failures + a summary, exits 1 on any failure
//   node scripts/contrast.mjs [file] [--table]   (--table prints every pair in both themes)
//
// It reads every `--color-*` token: `light-dark(#light, #dark)`, a plain `#hex` (both themes) or `var(--color-x)`
// (an alias, resolved). Each pair is checked in dark AND light against a WCAG 2 ratio minimum (the compliance
// bar) and, where the brief gives one, an APCA |Lc| minimum (the readability bar). Tokens with alpha (#rrggbbaa)
// can't be measured without their backdrop, so they must not appear in a pair.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) ?? 'src/styles/brand.css';
const showTable = args.includes('--table');
const css = readFileSync(file, 'utf8');

// ── Parse tokens ────────────────────────────────────────────────────────────────────────────
const raw = {};
for (const [, name, val] of css.matchAll(/--color-([\w-]+):\s*([^;]+);/g)) raw[name] = val.trim();

const HEX = '#[0-9a-f]{3,8}';
function resolve(name, seen = new Set()) {
  const val = raw[name];
  if (val === undefined) return null;
  if (seen.has(name)) throw new Error(`alias cycle at --color-${name}`);
  seen.add(name);
  const alias = val.match(/^var\(\s*--color-([\w-]+)\s*\)$/);
  if (alias) return resolve(alias[1], seen);
  const ld = val.match(new RegExp(`^light-dark\\(\\s*(${HEX})\\s*,\\s*(${HEX})\\s*\\)$`, 'i'));
  if (ld) return { light: ld[1].toLowerCase(), dark: ld[2].toLowerCase() };
  const solid = val.match(new RegExp(`^(${HEX})$`, 'i'));
  if (solid) return { light: solid[1].toLowerCase(), dark: solid[1].toLowerCase() };
  return null; // not a measurable colour (e.g. `initial`)
}

// ── Colour math: WCAG 2 relative luminance + APCA-W3 0.0.98G-4g ─────────────────────────────
function rgb(h) {
  let s = h.slice(1);
  if (s.length === 3 || s.length === 4) s = [...s].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
const hasAlpha = (h) => h.length === 5 || h.length === 9;
const lum = (h) =>
  rgb(h)
    .map((c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
function wcag(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function apca(text, bg) {
  const Y = (h) => rgb(h).reduce((s, c, i) => s + (c / 255) ** 2.4 * [0.2126729, 0.7151522, 0.072175][i], 0);
  const clamp = (y) => (y > 0.022 ? y : y + (0.022 - y) ** 1.414);
  const [yt, yb] = [clamp(Y(text)), clamp(Y(bg))];
  if (Math.abs(yb - yt) < 0.0005) return 0;
  const s = yb > yt ? (yb ** 0.56 - yt ** 0.57) * 1.14 : (yb ** 0.65 - yt ** 0.62) * 1.14;
  return Math.abs(s) < 0.1 ? 0 : Math.abs(s) * 100 - 2.7;
}

// ── Pairs: [foreground, background, WCAG min, APCA min, why] ───────────────────────────────
// Text rows use 4.5:1 or more; 3:1 rows are non-text (dots, borders, focus; WCAG 1.4.11), APCA 0 = not checked.
const on = (fg, bgs, w, lc, why) => bgs.map((bg) => [fg, bg, w, lc, why]);
const SURFACES = ['bg', 'surface', 'surface-raised', 'surface-overlay'];
const STATUS = ['danger', 'warning', 'success', 'info', 'ai'];
const CATEGORICAL = ['cloud', 'indigo', 'purple', 'pink', 'coral', 'gold', 'green', 'teal'];

const PAIRS = [
  // Text tiers (§3.1: fg ≥ 7:1 and Lc ≥ 87 on the surfaces body text sits on)
  ...on('fg-heading', ['bg', 'surface', 'surface-raised'], 7, 90, 'headings'),
  ...on('fg', ['bg', 'surface', 'surface-raised', 'surface-muted', 'surface-input'], 7, 87, 'body text'),
  ...on('fg', ['surface-overlay', 'selected', 'surface-sunken'], 7, 75, 'body text on L3 / selected / badge'),
  ...on('muted', [...SURFACES, 'surface-muted', 'surface-sunken', 'surface-input', 'selected'], 4.5, 60, 'secondary text'),
  ...on('faint', ['bg', 'surface', 'surface-raised', 'surface-muted', 'surface-input'], 4.5, 45, 'tertiary text (never on surface-sunken)'),
  ['faint', 'surface-overlay', 4.5, 40, 'tertiary text on L3 (§3.1 spot-readable floor, Lc 40)'],
  ...on('link', [...SURFACES, 'surface-muted', 'selected'], 4.5, 60, 'links, quiet buttons'),
  // Fills and their labels
  ['on-accent', 'accent', 4.5, 60, 'primary button (bold label)'],
  ['on-accent', 'accent-hover', 4.5, 60, 'primary button hover'],
  ['white', 'brand-600', 4.5, 60, 'compat: bg-brand-600 text-white'],
  ['on-inverse', 'surface-inverse', 4.5, 75, 'tooltip'],
  // Non-text (1.4.11) and focus (2.4.13: 2 px ring ≥ 3:1 on every surface)
  ...on('focus', [...SURFACES, 'selected'], 3, 0, 'focus ring'),
  ...on('line-input', ['bg', 'surface', 'surface-raised', 'surface-input'], 3, 0, 'input / toggle border'),
  ...on('accent', ['bg', 'surface', 'surface-raised'], 3, 0, 'accent fill edge, selection mark'),
  // Status + AI: tint badge, text on surfaces, dots, solid fills
  ...STATUS.flatMap((t) => [
    [`${t}-700`, `${t}-50`, 4.5, 60, `${t} badge text`],
    ['fg', `${t}-50`, 7, 75, `${t} banner title`],
    ['muted', `${t}-50`, 4.5, 60, `${t} banner body`],
    ...on(`${t}-700`, SURFACES, 4.5, 60, `${t} text`),
    ...on(`${t}-500`, ['bg', 'surface', 'surface-raised'], 3, 0, `${t} dot / bar / icon`),
    [t === 'warning' ? 'on-warning' : 'on-solid', `${t}-600`, 4.5, 60, `${t} solid fill`],
  ]),
  // Categorical (charts, labels): tag text on own tint, dots on surfaces
  ...CATEGORICAL.flatMap((t) => [
    [`${t}-700`, `${t}-50`, 4.5, 60, `${t} tag`],
    [`${t}-700`, 'surface-raised', 4.5, 60, `${t} text`],
    ...on(`${t}-500`, ['bg', 'surface'], 3, 0, `${t} dot / chart mark`),
  ]),
  // v1 compat ramps that stay in use (brand tints, links)
  ...on('brand-700', ['bg', 'surface', 'brand-50'], 4.5, 60, 'compat: brand text'),
  ['brand-800', 'brand-50', 4.5, 60, 'compat: brand tint text'],
  ['brand-900', 'brand-100', 4.5, 60, 'compat: brand-100 chip text'],
  ['source-700', 'source-50', 4.5, 60, 'compat: source tint text'],
];

// ── Run ─────────────────────────────────────────────────────────────────────────────────────
const failures = [];
const rows = [];
for (const [f, b, wMin, lcMin, why] of PAIRS) {
  const tf = resolve(f);
  const tb = resolve(b);
  if (!tf || !tb) {
    failures.push(`missing token: ${!tf ? `--color-${f}` : `--color-${b}`} (pair ${f} / ${b}, ${why})`);
    continue;
  }
  const cells = [];
  for (const theme of ['dark', 'light']) {
    const [cf, cb] = [tf[theme], tb[theme]];
    if (hasAlpha(cf) || hasAlpha(cb)) {
      failures.push(`${theme.padEnd(5)} ${f} / ${b}: has alpha, can't be measured without its backdrop`);
      cells.push(`${theme} alpha ✗`);
      continue;
    }
    const w = wcag(cf, cb);
    const lc = apca(cf, cb);
    const badW = w < wMin;
    const badLc = lcMin > 0 && lc < lcMin;
    if (badW || badLc) {
      const why2 = [badW ? `${w.toFixed(2)}:1 < ${wMin}:1` : null, badLc ? `Lc ${lc.toFixed(1)} < ${lcMin}` : null].filter(Boolean).join(', ');
      failures.push(`${theme.padEnd(5)} ${`${f} / ${b}`.padEnd(32)} ${why2}   (${cf} on ${cb}; ${why})`);
    }
    cells.push(`${theme} ${w.toFixed(2).padStart(5)}:1 Lc ${lc.toFixed(0).padStart(3)}${badW || badLc ? ' ✗' : '  '}`);
  }
  rows.push(`${`${f} / ${b}`.padEnd(34)} ${cells.join('   ')}   min ${wMin}:1${lcMin ? ` Lc ${lcMin}` : ''}`);
}

if (showTable) console.log(rows.join('\n') + '\n');
if (failures.length) {
  console.error(`contrast: ${failures.length} failure(s) in ${file}`);
  for (const line of failures) console.error(`  ✗ ${line}`);
  process.exit(1);
}
console.log(`contrast: all ${PAIRS.length} pairs pass in dark and light (${file})`);
