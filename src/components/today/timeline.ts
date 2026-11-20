/**
 * Day timeline geometry (pure). Today v2: a real day at true proportions over working hours, not a spine.
 *
 * - Main lane: meetings you attend, your planned work (dashed), one "pull forward" suggestion, open gaps.
 * - Side lane (right ~36 %): what doesn't need you: declined meetings and background agent runs. Main-lane
 *   blocks that overlap a side-lane block narrow to make room ("narrow").
 * - Overlapping main-lane blocks share the width in columns.
 * - Gaps are free time from now on; each may carry one fit-in hint that fits inside it.
 * Everything is in minutes since local midnight in the profile timezone.
 */
import type { CalendarEvent } from '@/contract';
import { packColumns } from '@/components/domain/lib/lanes';
import { minuteOfDay, sameLocalDay } from './time';

export interface WorkIn {
  id: string;
  itemId: string | null;
  start: string;
  end: string;
  label: string;
}

export interface AgentIn {
  id: string;
  itemId: string;
  start: string;
  minutes: number;
  label: string;
}

export interface HintIn {
  key: string;
  title: string;
  minutes: number;
}

export interface SuggestionIn {
  key: string;
  itemId: string | null;
  title: string;
  minutes: number;
}

export interface LayoutInput {
  nowIso: string;
  tz?: string;
  /** Working hours (minutes since midnight). */
  workStart: number;
  workEnd: number;
  events: CalendarEvent[];
  work: WorkIn[];
  agent: AgentIn[];
  hints: HintIn[];
  suggestion: SuggestionIn | null;
}

export interface Placed {
  s: number;
  e: number;
  /** Column inside the main lane when main-lane blocks overlap. */
  col: number;
  cols: number;
  /** Shares its time with a side-lane block, so it leaves the side lane free. */
  narrow: boolean;
}

export type TLBlock =
  | ({ type: 'meeting'; id: string; event: CalendarEvent; side: boolean; live: number | null } & Placed)
  | ({ type: 'work'; id: string; itemId: string | null; label: string } & Placed)
  | ({ type: 'agent'; id: string; itemId: string; label: string; side: true } & Placed)
  | ({ type: 'suggest'; id: string; key: string; itemId: string | null; title: string; minutes: number } & Placed)
  | ({ type: 'gap'; id: string; minutes: number; hintKey: string | null; hintTitle: string | null; tail: boolean } & Placed);

export interface HourMark {
  min: number;
  label: string | null;
  half: boolean;
}

export interface DayLayout {
  start: number;
  end: number;
  now: number;
  /** Working hours (the parts of the window outside them are shaded). */
  workStart: number;
  workEnd: number;
  hours: HourMark[];
  blocks: TLBlock[];
  /** hint key → the gap start it was placed in (fit-in rows say where they fit). */
  hintAt: Map<string, number>;
  /** Where the suggestion (and "Pull in") would land, or null when nothing fits. */
  suggestionAt: number | null;
}

const MIN_GAP = 10;
const SIDE_STATES = new Set(['declined', 'cancelled']);
/** Side lane: declined and cancelled, plus tentative and unanswered invites (shown, never blocking time). */
export const isSideEvent = (ev: Pick<CalendarEvent, 'attendance' | 'myResponse'>) => SIDE_STATES.has(ev.attendance) || ev.myResponse === 'tentative' || ev.myResponse === 'needs_action';

type Interval = { s: number; e: number };

function overlaps(a: Interval, b: Interval): boolean {
  return a.s < b.e && b.s < a.e;
}

/** Free intervals of [from, to] minus `busy` (any order, may overlap). */
export function freeIntervals(from: number, to: number, busy: Interval[]): Interval[] {
  const sorted = busy.filter((b) => b.e > from && b.s < to).sort((a, b) => a.s - b.s);
  const out: Interval[] = [];
  let cur = from;
  for (const b of sorted) {
    if (b.s > cur) out.push({ s: cur, e: Math.min(b.s, to) });
    cur = Math.max(cur, b.e);
    if (cur >= to) break;
  }
  if (cur < to) out.push({ s: cur, e: to });
  return out.filter((x) => x.e - x.s > 0);
}

const floorTo = (m: number, step: number) => Math.floor(m / step) * step;
const ceilTo = (m: number, step: number) => Math.ceil(m / step) * step;

/**
 * The window: from the first hour with something in it (never before working hours just because it's early), to the
 * end of working hours or the last block, whichever is later. A block before working hours (an early call) pulls
 * the start back to its hour, so nothing you have today is clipped.
 */
export function dayBounds(input: Pick<LayoutInput, 'nowIso' | 'tz' | 'workStart' | 'workEnd' | 'events' | 'work'>): { start: number; end: number; now: number } {
  const { nowIso, tz } = input;
  const now = minuteOfDay(nowIso, tz);
  const todays = input.events.filter((e) => sameLocalDay(e.start, nowIso, tz) && !isSideEvent(e));
  const work = input.work.filter((w) => sameLocalDay(w.start, nowIso, tz));
  const blockStarts = [...todays.map((e) => minuteOfDay(e.start, tz)), ...work.map((w) => minuteOfDay(w.start, tz))];
  const firsts = [now, ...blockStarts];
  const early = blockStarts.length ? floorTo(Math.min(...blockStarts), 60) : Infinity;
  const start = Math.min(Math.max(floorTo(input.workStart, 30), floorTo(Math.min(...firsts), 60)), early);
  const lastEnd = (iso: string, startIso: string) => (sameLocalDay(iso, startIso, tz) ? minuteOfDay(iso, tz) : 24 * 60);
  const lasts = [input.workEnd, ...todays.map((e) => lastEnd(e.end, e.start)), ...work.map((w) => lastEnd(w.end, w.start))];
  const end = Math.min(24 * 60, ceilTo(Math.max(...lasts), 30));
  return { start: Math.min(start, end - 60), end, now };
}

function hourMarks(start: number, end: number): HourMark[] {
  const out: HourMark[] = [];
  for (let m = ceilTo(start, 30); m <= end; m += 30) {
    const full = m % 60 === 0;
    out.push({ min: m, half: !full, label: full || m === end ? label(m) : null });
  }
  return out;
}

const label = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function layoutDay(input: LayoutInput): DayLayout {
  const { tz, nowIso } = input;
  const { start, end, now } = dayBounds(input);
  const clamp = (m: number) => Math.max(start, Math.min(end, m));
  const span = (s: string, e: string) => {
    const sm = sameLocalDay(s, nowIso, tz) ? minuteOfDay(s, tz) : -1;
    const em = sameLocalDay(e, nowIso, tz) ? minuteOfDay(e, tz) : 24 * 60;
    return { s: clamp(sm < 0 ? 0 : sm), e: clamp(em) };
  };

  const blocks: TLBlock[] = [];
  const base = { col: 0, cols: 1, narrow: false };

  for (const ev of input.events) {
    if (!sameLocalDay(ev.start, nowIso, tz)) continue;
    const { s, e } = span(ev.start, ev.end);
    if (e <= s) continue;
    const side = isSideEvent(ev);
    const live = !side && s <= now && now < e ? (now - s) / (e - s) : null;
    blocks.push({ type: 'meeting', id: ev.id, event: ev, side, live, s, e, ...base });
  }
  for (const w of input.work) {
    if (!sameLocalDay(w.start, nowIso, tz)) continue;
    const { s, e } = span(w.start, w.end);
    if (e <= s) continue;
    blocks.push({ type: 'work', id: w.id, itemId: w.itemId, label: w.label, s, e, ...base });
  }
  for (const a of input.agent) {
    if (!sameLocalDay(a.start, nowIso, tz)) continue;
    const s = clamp(minuteOfDay(a.start, tz));
    const e = clamp(s + Math.max(5, a.minutes));
    if (e <= s) continue;
    blocks.push({ type: 'agent', id: a.id, itemId: a.itemId, label: a.label, side: true, s, e, ...base });
  }

  const isSide = (b: TLBlock) => (b.type === 'meeting' && b.side) || b.type === 'agent';
  const busyMain = () => blocks.filter((b) => !isSide(b) && b.type !== 'gap').map((b) => ({ s: b.s, e: b.e }));

  // The suggestion goes where "Pull in" would put it: the largest open gap that fits (earliest on a tie).
  let suggestionAt: number | null = null;
  const from = Math.max(now, start);
  if (input.suggestion) {
    // At least 25 minutes tall so the block stays readable next to the gap label below it.
    const need = Math.max(25, input.suggestion.minutes);
    const fits = freeIntervals(from, end, busyMain())
      .map((g) => ({ ...g, s: ceilTo(g.s, 5) }))
      .filter((g) => g.e - g.s >= need)
      .sort((a, b) => b.e - b.s - (a.e - a.s) || a.s - b.s);
    const g = fits[0];
    if (g) {
      suggestionAt = g.s;
      const sg = input.suggestion;
      blocks.push({ type: 'suggest', id: `suggest:${sg.key}`, key: sg.key, itemId: sg.itemId, title: sg.title, minutes: sg.minutes, s: g.s, e: g.s + need, ...base });
    }
  }

  // Gaps from now on, each with at most one hint that fits.
  const hintAt = new Map<string, number>();
  const used = new Set<string>();
  for (const g of freeIntervals(from, end, busyMain())) {
    const minutes = g.e - g.s;
    if (minutes < MIN_GAP) continue;
    const hint = input.hints.find((h) => !used.has(h.key) && h.minutes <= minutes) ?? null;
    if (hint) {
      used.add(hint.key);
      hintAt.set(hint.key, g.s);
    }
    blocks.push({ type: 'gap', id: `gap:${g.s}`, minutes, hintKey: hint?.key ?? null, hintTitle: hint?.title ?? null, tail: g.e === end && minutes >= 60, s: g.s, e: g.e, ...base });
  }

  // Side lane narrows whatever shares its time.
  const side = blocks.filter(isSide);
  for (const b of blocks) if (!isSide(b) && side.some((x) => overlaps(x, b))) b.narrow = true;
  packColumns(blocks.filter((b) => !isSide(b) && b.type !== 'gap'));
  packColumns(blocks.filter((b) => isSide(b)));

  return { start, end, now: clamp(now), workStart: input.workStart, workEnd: input.workEnd, hours: hourMarks(start, end), blocks, hintAt, suggestionAt };
}

// ── Zoom ────────────────────────────────────────────────────────────────────────────────────
// Zoom is a multiple of the fitted day: 1 shows the whole window in the pane, 8 makes a 10-minute block ~8×
// taller. Buttons and keys step through ZOOM_LEVELS; Ctrl/⌘ + scroll and a trackpad pinch zoom smoothly.

export const ZOOM_LEVELS = [1, 1.5, 2, 3, 4, 6, 8] as const;
export const ZOOM_MIN = ZOOM_LEVELS[0];
export const ZOOM_MAX = ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!;

export function clampZoom(z: unknown): number {
  const n = typeof z === 'number' && Number.isFinite(z) ? z : 1;
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) * 100) / 100;
}

/** The next level up (dir 1) or down (dir -1) from wherever a pinch left the zoom. */
export function stepZoom(z: number, dir: 1 | -1): number {
  const cur = clampZoom(z);
  if (dir > 0) return ZOOM_LEVELS.find((l) => l > cur + 0.01) ?? ZOOM_MAX;
  return [...ZOOM_LEVELS].reverse().find((l) => l < cur - 0.01) ?? ZOOM_MIN;
}

/**
 * Ctrl/⌘ + wheel or a pinch (Chrome reports a pinch as a ctrl wheel). Exponential, so the same gesture feels
 * the same at every level; one mouse-wheel notch is about ×1.6, a pinch tick a few percent. Snaps to 1 near fit on the way out.
 */
export function wheelZoom(z: number, deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const d = Math.max(-60, Math.min(60, px));
  const cur = clampZoom(z);
  const next = clampZoom(cur * Math.exp(-d / 120));
  // Snap to fit only on the way out: a slow pinch from Fit must still be able to leave it.
  return next < cur && next < 1.04 ? 1 : next;
}

/** "Fit" · "1.5×" · "3×". */
export function zoomLabel(z: number): string {
  const c = clampZoom(z);
  return c <= 1 ? 'Fit' : `${Number.isInteger(c) ? c : c.toFixed(1).replace(/\.0$/, '')}×`;
}

export interface ZoomViewport {
  /** The day window (minutes since midnight). */
  start: number;
  end: number;
  /** Now in minutes, or null when it isn't on the grid (the day is over or hasn't started). */
  now: number | null;
  /** The scroll pane: visible height, padding around the grid, and the scrollTop before the change. */
  viewportH: number;
  padTop: number;
  padBottom: number;
  scrollTop: number;
}

/** Grid height in px at a zoom: the pane's inner height times the zoom. */
export function gridHeightAt(v: Pick<ZoomViewport, 'viewportH' | 'padTop' | 'padBottom'>, zoom: number): number {
  return Math.max(1, v.viewportH - v.padTop - v.padBottom) * clampZoom(zoom);
}

/**
 * The scrollTop after zooming from `from` to `to`, keeping one minute at the same height on screen. That minute is
 * now whenever now is on the grid (where it is, or the top third of the pane if it had scrolled out of view), so a
 * zoom never loses now; otherwise the pointer (wheel / pinch), else the middle of the pane.
 */
export function zoomScroll(v: ZoomViewport, from: number, to: number, pointerY?: number): number {
  const span = Math.max(1, v.end - v.start);
  const pxFrom = gridHeightAt(v, from) / span;
  const pxTo = gridHeightAt(v, to) / span;
  let anchorMin: number;
  let anchorY: number;
  if (v.now !== null && v.now >= v.start && v.now <= v.end) {
    anchorMin = v.now;
    const y = v.padTop + (v.now - v.start) * pxFrom - v.scrollTop;
    anchorY = y >= 0 && y <= v.viewportH ? y : v.viewportH / 3;
  } else {
    anchorY = Math.max(0, Math.min(v.viewportH, pointerY ?? v.viewportH / 2));
    anchorMin = v.start + (v.scrollTop + anchorY - v.padTop) / pxFrom;
  }
  const total = v.padTop + gridHeightAt(v, to) + v.padBottom;
  const next = v.padTop + (anchorMin - v.start) * pxTo - anchorY;
  return Math.round(Math.max(0, Math.min(total - v.viewportH, next)));
}

// ── Pixel layout: labels that never collide ─────────────────────────────────────────────────
// Positions are true to time. A block too short for a label may grow into free space below it (up to GROW_PX)
// but never into the next block it shares a column with, so short blocks never stack. Each block then gets the
// label it has room for: two lines, one line, or none (its title is the tooltip and a click opens Details).
// A gap's label sits in the part of the gap that no grown block covers, or collapses to its tooltip.

/** One text line (20 px) plus the block's border. */
export const LINE_PX = 22;
/** Title line + meta line. */
export const FULL_PX = 46;
/** How tall a short block grows when there's free space under it (the old fixed min-height). */
export const GROW_PX = 28;
/** A gap label: one caption line plus a little padding. */
export const GAP_LABEL_PX = 22;
/** Below this, a block keeps its true height but stays clickable. */
export const MIN_BLOCK_PX = 6;

export type LabelTier = 'full' | 'line' | 'none';

export interface BlockBox {
  top: number;
  height: number;
  tier: LabelTier;
  /** Horizontal extent in % of the track (same math as the rendered lane). */
  left: number;
  right: number;
}

export interface GapBox {
  /** The visible part of the gap (below any block that grew into it). */
  top: number;
  height: number;
  /** Room for the label; otherwise it collapses to the gap's tooltip. */
  label: boolean;
  left: number;
  right: number;
}

export interface GridMark {
  min: number;
  kind: 'hour' | 'half' | 'quarter';
  label: string | null;
}

export interface PixelLayout {
  pxPerMin: number;
  height: number;
  boxes: Map<string, BlockBox>;
  gaps: Map<string, GapBox>;
  marks: GridMark[];
}

export const isSideBlock = (b: TLBlock) => (b.type === 'meeting' && b.side) || b.type === 'agent';

/** Horizontal extent of a block in % of the track: the main lane, narrowed beside the side lane (right 36 %). */
export function laneExtent(b: TLBlock): { left: number; right: number } {
  if (isSideBlock(b)) {
    const w = 36 / b.cols;
    return { left: 64 + b.col * w, right: 64 + (b.col + 1) * w };
  }
  const w = (b.narrow ? 62 : 100) / b.cols;
  return { left: b.col * w, right: (b.col + 1) * w };
}

const sharesX = (a: { left: number; right: number }, b: { left: number; right: number }) => a.left < b.right - 0.01 && b.left < a.right - 0.01;

/** Grid lines and their labels for a scale: quarter hours appear once they're ≥ 30 px apart, labels never crowd. */
export function gridMarks(start: number, end: number, now: number | null, pxPerMin: number): GridMark[] {
  const step = pxPerMin * 15 >= 30 ? 15 : 30;
  const labelEvery = pxPerMin * 15 >= 44 ? 15 : pxPerMin * 30 >= 44 ? 30 : 60;
  const out: GridMark[] = [];
  let lastLabelY = -Infinity;
  for (let m = ceilTo(start, step); m <= end; m += step) {
    const kind: GridMark['kind'] = m % 60 === 0 ? 'hour' : m % 30 === 0 ? 'half' : 'quarter';
    const y = (m - start) * pxPerMin;
    const wants = m % labelEvery === 0 || m === end;
    const nearNow = now !== null && Math.abs(m - now) * pxPerMin < LINE_PX;
    const ok = wants && !nearNow && y - lastLabelY >= LINE_PX;
    if (ok) lastLabelY = y;
    out.push({ min: m, kind, label: ok ? label(m) : null });
  }
  return out;
}

/** Pixel boxes for every block and gap at `pxPerMin`. Pure; the renderer only reads it. */
export function pixelLayout(layout: Pick<DayLayout, 'start' | 'end' | 'now' | 'blocks'>, pxPerMin: number, opts: { nowOnGrid?: boolean; gapLabelPx?: number } = {}): PixelLayout {
  const px = Math.max(0.01, pxPerMin);
  const labelPx = opts.gapLabelPx ?? GAP_LABEL_PX;
  const height = (layout.end - layout.start) * px;
  const solid = layout.blocks.filter((b) => b.type !== 'gap');
  const boxes = new Map<string, BlockBox>();
  for (const b of solid) {
    const x = laneExtent(b);
    const top = (b.s - layout.start) * px;
    const trueH = (b.e - b.s) * px;
    // Free space below: up to the next block that starts at or after this one in the same horizontal band.
    let room = height - top;
    for (const o of solid) {
      if (o === b || o.s < b.s || !sharesX(x, laneExtent(o))) continue;
      room = Math.min(room, (o.s - b.s) * px);
    }
    const h = Math.max(trueH, Math.min(GROW_PX, room), Math.min(MIN_BLOCK_PX, room));
    boxes.set(b.id, { top, height: h, tier: h >= FULL_PX ? 'full' : h >= LINE_PX ? 'line' : 'none', ...x });
  }
  const gaps = new Map<string, GapBox>();
  for (const g of layout.blocks) {
    if (g.type !== 'gap') continue;
    const x = laneExtent(g);
    const top0 = (g.s - layout.start) * px;
    const bottom = (g.e - layout.start) * px;
    let top = top0;
    for (const o of solid) {
      if (o.s >= g.e || !sharesX(x, laneExtent(o))) continue;
      const box = boxes.get(o.id)!;
      if (box.top < bottom) top = Math.max(top, Math.min(bottom, box.top + box.height));
    }
    gaps.set(g.id, { top, height: bottom - top, label: bottom - top >= labelPx, ...x });
  }
  const now = opts.nowOnGrid === false ? null : layout.now;
  return { pxPerMin: px, height, boxes, gaps, marks: gridMarks(layout.start, layout.end, now, px) };
}
