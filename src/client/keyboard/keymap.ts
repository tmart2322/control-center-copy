/**
 * Pure key-combo grammar (no DOM, no React) so it can be unit tested.
 *
 * Spec strings:
 *   "mod+k"        ⌘K on macOS, Ctrl+K elsewhere
 *   "shift+enter"  ⇧↵
 *   "g h"          a chord: press g, then h (within CHORD_TIMEOUT_MS)
 *   "?" "[" "]"    symbols ignore Shift (they are typed with it on most layouts)
 *   "alt+1" "meta+z" "ctrl+z"
 */

export const CHORD_TIMEOUT_MS = 1200;

export interface Combo {
  key: string;
  mod: boolean;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export type KeySequence = Combo[];

/** The subset of KeyboardEvent the matcher reads (tests pass plain objects). */
export interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: unknown;
  isComposing?: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  ' ': 'space',
  spacebar: 'space',
  esc: 'escape',
  return: 'enter',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  del: 'delete',
  cmd: 'meta',
  command: 'meta',
  option: 'alt',
  control: 'ctrl',
};

const MODIFIER_KEYS = new Set(['meta', 'ctrl', 'shift', 'alt', 'os', 'capslock', 'fn']);

export function normalizeKey(key: string): string {
  const k = key.length === 1 ? key.toLowerCase() : key.toLowerCase();
  return KEY_ALIASES[k] ?? k;
}

export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(normalizeKey(key));
}

/** A printable symbol (not a letter/digit/named key): Shift is ignored when matching it. */
function isSymbol(key: string): boolean {
  return key.length === 1 && !/[a-z0-9]/.test(key);
}

export function parseCombo(spec: string): Combo {
  const raw = spec.trim();
  // "+" alone (or "mod++") means the plus key.
  const parts = raw === '+' ? ['+'] : raw.split('+').map((p, i, arr) => (p === '' && i === arr.length - 1 ? '+' : p)).filter(Boolean);
  const combo: Combo = { key: '', mod: false, meta: false, ctrl: false, shift: false, alt: false };
  for (const part of parts) {
    const p = normalizeKey(part);
    if (p === 'mod') combo.mod = true;
    else if (p === 'meta') combo.meta = true;
    else if (p === 'ctrl') combo.ctrl = true;
    else if (p === 'shift') combo.shift = true;
    else if (p === 'alt') combo.alt = true;
    else combo.key = p;
  }
  if (!combo.key) throw new Error(`Key spec "${spec}" has no key`);
  return combo;
}

export function parseSequence(spec: string): KeySequence {
  return spec
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(parseCombo);
}

export function comboMatches(combo: Combo, e: KeyLike, isMac: boolean): boolean {
  const key = normalizeKey(e.key);
  if (key !== combo.key) return false;
  const wantMeta = combo.meta || (combo.mod && isMac);
  const wantCtrl = combo.ctrl || (combo.mod && !isMac);
  if (Boolean(e.metaKey) !== wantMeta) return false;
  if (Boolean(e.ctrlKey) !== wantCtrl) return false;
  if (Boolean(e.altKey) !== combo.alt) return false;
  if (!isSymbol(combo.key) && Boolean(e.shiftKey) !== combo.shift) return false;
  return true;
}

/** True when a key press should be left to a text field (never fire single-key shortcuts there). */
export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: string; isContentEditable?: boolean; getAttribute?: (n: string) => string | null; closest?: (s: string) => unknown; type?: string };
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? '').toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = (el.type ?? 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  const role = el.getAttribute?.('role');
  if (role === 'textbox' || role === 'combobox' || role === 'searchbox') return true;
  // Opt-out region: anything inside [data-keys="off"] keeps its keys.
  if (typeof el.closest === 'function' && el.closest('[data-keys="off"]')) return true;
  return false;
}

/** Does this combo carry a command modifier (so it may fire inside inputs, like ⌘K)? */
export function hasCommandModifier(c: Combo): boolean {
  return c.mod || c.meta || c.ctrl || c.alt;
}

const KEY_GLYPHS: Record<string, string> = {
  enter: '↵',
  escape: 'Esc',
  space: 'Space',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  backspace: '⌫',
  delete: '⌦',
  tab: 'Tab',
};

/** One combo → its display keys, e.g. "mod+shift+c" → ["⌘", "⇧", "C"] (mac) or ["Ctrl", "Shift", "C"]. */
export function comboKeys(spec: string, isMac = true): string[] {
  const c = parseCombo(spec);
  const keys: string[] = [];
  if (c.ctrl) keys.push(isMac ? '⌃' : 'Ctrl');
  if (c.alt) keys.push(isMac ? '⌥' : 'Alt');
  if (c.shift) keys.push(isMac ? '⇧' : 'Shift');
  if (c.mod || c.meta) keys.push(isMac ? '⌘' : c.meta ? 'Win' : 'Ctrl');
  keys.push(KEY_GLYPHS[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key[0]!.toUpperCase() + c.key.slice(1)));
  return keys;
}

/** A full sequence → groups of display keys, e.g. "g h" → [["G"], ["H"]]. */
export function sequenceKeys(spec: string, isMac = true): string[][] {
  return spec
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => comboKeys(s, isMac));
}

/** Plain-text label for tooltips and aria: "⌘K", "G then H". */
export function formatShortcut(spec: string, isMac = true): string {
  const groups = sequenceKeys(spec, isMac);
  return groups.map((g) => (isMac ? g.join('') : g.join('+'))).join(' then ');
}

export function detectMac(): boolean {
  // Server render (Node has a global `navigator` too) assumes macOS, the target machine.
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return true;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '';
  return /mac|iphone|ipad/i.test(platform) || /Mac OS X/.test(navigator.userAgent);
}
