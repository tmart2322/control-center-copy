/**
 * The spotlight tour's rules, pure so they are tested (src/guide/__tests__/tour.test.ts): which marks a run shows,
 * how Next / Back / Skip move and what each records as seen, what a key press does, the focus trap's wrap, and the
 * geometry of the cutout and the step card. CoachMarks.tsx runs it; SpotlightTour.tsx draws it.
 *
 * Seen rules: Next (and Done) records the step it leaves, so a tour cut short resumes at the first step not seen yet.
 * Skip (the link or Esc) records the page's whole set. A mark whose anchor is missing is skipped and stays unseen.
 */
import type { GuideSettings } from '@/contract';
import { computePosition, type Rect, type Side } from '@/ui/floating';
import { unseen } from './seen';

// ─── Which steps ───────────────────────────────────────────────────────────────────────────────────────────────

/** What a run would show, in order: the unseen marks (every mark, for a replay from "?"). */
export function tourQueue<T extends { id: string }>(marks: readonly T[], seen: GuideSettings['seen'], local: ReadonlySet<string>, replay: boolean): T[] {
  return replay ? [...marks] : unseen(marks, seen, local);
}

/** The run's steps: the queued marks whose anchor is on the page (another persona's or an empty state's are not). */
export function tourSteps<T extends { id: string }>(queue: readonly T[], present: (mark: T) => boolean): T[] {
  return queue.filter((m) => present(m));
}

/** Two looks found the same steps: the page has settled, so the count ("Step 1 of 3") holds. */
export function sameSteps(a: readonly { id: string; selector?: string }[] | null, b: readonly { id: string; selector?: string }[]): boolean {
  return !!a && a.length === b.length && a.every((m, i) => m.id === b[i]!.id && m.selector === b[i]!.selector);
}

/**
 * A run's steps when a step may name fallbacks (an item's tip: the first ready draft, else any draft, else the
 * list): each step on the first of its selectors the page shows, in order; a step with none of them is left out.
 */
export function resolveSteps<T extends { id: string; selector: string; fallback?: readonly string[] }>(queue: readonly T[], present: (selector: string) => boolean): T[] {
  const out: T[] = [];
  for (const s of queue) {
    const sel = [s.selector, ...(s.fallback ?? [])].find((x) => present(x));
    if (sel) out.push(sel === s.selector ? s : { ...s, selector: sel });
  }
  return out;
}

export interface LookState {
  /** Steps found on this look. */
  found: number;
  /** Steps asked for. */
  queued: number;
  /** How many looks in a row before this one found the same steps. */
  agreed: number;
  /** Looks so far, this one excluded. */
  tries: number;
  maxTries: number;
  /** Asked for (Getting started, "?"), not a first visit. */
  requested: boolean;
}

/**
 * Start on this look? A first-visit tour starts once two looks agree (the page has settled) or the looks run out. A
 * requested one starts as soon as every step is there, else once three looks agree: it usually follows a navigation,
 * and a page still loading must not cut it short. Nothing found: keep looking.
 */
export function readyToStart(s: LookState): boolean {
  if (s.found === 0) return false;
  if (s.tries >= s.maxTries) return true;
  if (s.requested) return s.found >= s.queued || s.agreed >= 2;
  return s.agreed >= 1;
}

/**
 * What a run's end records besides the steps: a page tour that ran to its end (Done on the last step) writes the
 * page's toured key, so its Getting started item ticks even when a step's element was missing. An item's tip records
 * nothing (it is ticked from real state).
 */
export function finishRecord(move: TourMove, ended: boolean, kind: 'page' | 'item', doneKey: string): string[] {
  return kind === 'page' && ended && move === 'next' ? [doneKey] : [];
}

export interface AutoStart {
  /** Not automation, or `?coach=1`. */
  enabled: boolean;
  /** "Show this page's tips again" asked for this page. */
  replay: boolean;
  personaReady: boolean;
  /** settings.guide.seen has loaded. */
  seenReady: boolean;
  /** The "?" popover is open. */
  paused: boolean;
  /** A tour already ran on this visit to the page (a later anchor waits for the next visit, or "?"). */
  ranThisVisit: boolean;
  /** Health has answered (or failed), so whether a first scan runs is known. */
  scanKnown: boolean;
  /** The first scan is still filling in (the banner is up). */
  scanFilling: boolean;
}

/**
 * Whether to look for a tour now. The first scan defers it: while it fills in, pages are half-empty and the banner
 * is the thing to read, so the tour waits until it is done. A replay from "?" is a request and runs anyway.
 */
export function mayStart(s: AutoStart): boolean {
  if (!s.personaReady || !s.seenReady || s.paused) return false;
  if (s.replay) return true;
  return s.enabled && !s.ranThisVisit && s.scanKnown && !s.scanFilling;
}

// ─── Moving through a run ──────────────────────────────────────────────────────────────────────────────────────

export interface TourRun {
  /** Mark ids, in order. */
  steps: readonly string[];
  index: number;
}

export type TourMove = 'next' | 'back' | 'skip';

/**
 * From step `from`, the next step in `dir` whose anchor is still there: 'end' past the last one; at the start, Back
 * stays where it is.
 */
export function stepTo(count: number, from: number, dir: 1 | -1, present: (index: number) => boolean): number | 'end' {
  for (let i = from + dir; i >= 0 && i < count; i += dir) if (present(i)) return i;
  return dir === 1 ? 'end' : from;
}

/**
 * One move. Returns the run after it (null: the tour is over) and the ids to record as seen: Next records the step it
 * leaves (Done is Next on the last step), Back records nothing, Skip records the page's whole set.
 */
export function moveTour(run: TourRun, move: TourMove, pageIds: readonly string[], present: (id: string) => boolean = () => true): { run: TourRun | null; record: string[] } {
  if (move === 'skip') return { run: null, record: [...new Set([...run.steps, ...pageIds])] };
  const at = (i: number) => present(run.steps[i]!);
  if (move === 'back') {
    const to = stepTo(run.steps.length, run.index, -1, at);
    return { run: to === run.index ? run : { ...run, index: to as number }, record: [] };
  }
  const record = [run.steps[run.index]!];
  const to = stepTo(run.steps.length, run.index, 1, at);
  return { run: to === 'end' ? null : { ...run, index: to }, record };
}

/** "Step 2 of 4"; a one-step tour is just a tip. */
export function stepLabel(index: number, count: number): string {
  return count > 1 ? `Step ${index + 1} of ${count}` : 'Tip';
}

/** The primary button: Next, then Done on the last step. */
export function primaryLabel(index: number, count: number): 'Next' | 'Done' {
  return index >= count - 1 ? 'Done' : 'Next';
}

// ─── Keys and focus ────────────────────────────────────────────────────────────────────────────────────────────

export interface TourKey {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

/**
 * What a key does while the tour is up: → or Enter is Next, ← is Back, Esc skips. Enter on a focused button or
 * link is left to that control (Enter on Back goes back). Modified keys are not the tour's.
 */
export function tourKeyAction(e: TourKey, ctx: { onControl: boolean }): TourMove | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  switch (e.key) {
    case 'ArrowRight':
      return 'next';
    case 'ArrowLeft':
      return 'back';
    case 'Enter':
      return ctx.onControl ? null : 'next';
    case 'Escape':
    case 'Esc':
      return 'skip';
    default:
      return null;
  }
}

/** The focus trap's Tab: the index to focus among `count` controls (`current` -1: focus is outside the card). */
export function trapTab(count: number, current: number, shift: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return shift ? count - 1 : 0;
  return shift ? (current - 1 + count) % count : (current + 1) % count;
}

// ─── Geometry ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface Viewport {
  width: number;
  height: number;
}

/** Room around the element inside the cutout. */
export const CUTOUT_PAD = 8;
/** Space between the cutout and the card (the arrow sits in it). */
export const CARD_GAP = 16;
/** The card keeps this far from the viewport's edges. */
export const EDGE = 12;

/** The cutout: the element plus padding, kept inside the viewport (null when it is off screen). */
export function cutoutRect(r: Rect, vp: Viewport, pad = CUTOUT_PAD, inset = 4): Rect | null {
  const top = Math.max(inset, r.top - pad);
  const left = Math.max(inset, r.left - pad);
  const bottom = Math.min(vp.height - inset, r.top + r.height + pad);
  const right = Math.min(vp.width - inset, r.left + r.width + pad);
  if (bottom - top < 1 || right - left < 1) return null;
  return { top, left, width: right - left, height: bottom - top };
}

/**
 * The cutout's corner radius: concentric with the element's own (its radius plus the padding), so a card stays a card
 * and a round button stays round. `raw` is the computed border-top-left-radius ("16px", "50%", "9999px", "16px 8px").
 */
export function cutoutRadius(raw: string, width: number, height: number, pad = CUTOUT_PAD): number {
  const first = (raw || '').trim().split(/\s+/)[0] ?? '';
  const n = parseFloat(first);
  const own = Number.isFinite(n) ? (first.endsWith('%') ? (n / 100) * Math.min(width, height) : n) : 0;
  const r = Math.max(0, Math.min(own, Math.min(width, height) / 2)) + pad;
  return Math.min(r, Math.min(width + 2 * pad, height + 2 * pad) / 2);
}

/** Scroll the element in first: it is not fully inside `view` (its panel's visible box), with a margin. */
export function needsScroll(r: Rect, view: Rect, margin = 24): boolean {
  return r.top < view.top + margin || r.top + r.height > view.top + view.height - margin;
}

/**
 * How far to scroll the panel (`view` is its visible box) so the element sits in its middle, or with its top near
 * the panel's top when it is taller than the panel.
 */
export function scrollDelta(r: Rect, view: Rect, margin = 24): number {
  if (r.height + 2 * margin <= view.height) return Math.round(r.top + r.height / 2 - (view.top + view.height / 2));
  return Math.round(r.top - view.top - margin);
}

export interface CardPlacement {
  top: number;
  left: number;
  /** The card's side of the cutout; null when no side has room and the card sits over the page. */
  side: Side | null;
  /** The arrow's offset along the card edge that faces the cutout (px from the card's left or top). */
  arrow: number | null;
}

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
const PERPENDICULAR: Record<Side, [Side, Side]> = { top: ['right', 'left'], bottom: ['right', 'left'], left: ['bottom', 'top'], right: ['bottom', 'top'] };

function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

/** Keep the arrow on the straight part of the card's edge (clear of the corner radius). */
const ARROW_INSET = 22;

function arrowOffset(side: Side, box: Rect, cut: Rect): number {
  const horizontal = side === 'top' || side === 'bottom';
  const len = horizontal ? box.width : box.height;
  const centre = horizontal ? cut.left + cut.width / 2 - box.left : cut.top + cut.height / 2 - box.top;
  return Math.round(Math.min(Math.max(centre, ARROW_INSET), Math.max(ARROW_INSET, len - ARROW_INSET)));
}

/**
 * Place the card next to the cutout: the mark's side first, then the opposite one, then the two perpendicular
 * sides (floating.ts places, flips and shifts it inside the viewport). The first side where the card fits without
 * covering the cutout wins. A cutout too big for any side (a whole list) gets the card over its far end, no arrow.
 */
export function placeCard(cut: Rect, size: { width: number; height: number }, preferred: Side, vp: Viewport, gap = CARD_GAP, edge = EDGE): CardPlacement {
  const order: Side[] = [preferred, OPPOSITE[preferred], ...PERPENDICULAR[preferred]];
  for (const side of order) {
    const p = computePosition(cut, size, side, vp, gap, edge);
    if (p.side !== side) continue;
    const box = { top: p.top, left: p.left, width: size.width, height: size.height };
    if (intersects(box, cut)) continue;
    return { top: p.top, left: p.left, side, arrow: arrowOffset(side, box, cut) };
  }
  const centreY = cut.top + cut.height / 2;
  const top = centreY < vp.height / 2 ? vp.height - size.height - edge * 2 : edge * 2;
  const left = cut.left + cut.width / 2 - size.width / 2;
  return {
    top: Math.max(edge, Math.min(top, vp.height - size.height - edge)),
    left: Math.max(edge, Math.min(left, vp.width - size.width - edge)),
    side: null,
    arrow: null,
  };
}
