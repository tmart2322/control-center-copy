/**
 * One logging batch → ONE canvas (2026-11-13 audit B1), as both DataSources stage it: the Event rows, the Duration__c
 * fixes, the pending Deal Contribution requests (D-58) and the VDP use cases (D-67) in one Slackbot work order.
 *
 *  - The only limit is Slack's own: a work order bigger than `CANVAS_MAX_BYTES` (UTF-8 bytes of markdown, src/lib/
 *    canvas/payload.ts) is split into parts of the WHOLE work order, in row order, each with the full rules ("part k of
 *    n"); never a DC-only or use-case-only canvas of its own.
 *  - DCs ride on a batch that has rows (Events, Event updates, use cases); a DC-only canvas only when asked
 *    (`dcOnly`: Log DCs now), and use cases never ride on that one. D-70: a use case is a row like any other: it
 *    logs on its own or with others (Log it ▸ Ready to log), so use cases alone make a canvas. With nothing ticked,
 *    every pending one goes: no per-batch count.
 *
 * Pure: the callers load the rows and stage one Outbox item per canvas.
 */
import { renderWorkOrder, type WorkOrderEvent, type WorkOrderInput, type WorkOrderUpdate } from '@/engines/activity/slackbot';
import { withUseCaseRows, type UseCaseCreate, type UseCaseUpdate } from '@/engines/activity/use-cases';
import { CANVAS_MAX_BYTES, fitsOneCanvas } from '@/lib/canvas/payload';
import { withDcAdds, type BatchCanvas, type DcAdd } from '@/server/deals/dc-requests';

export interface BatchRows {
  events: readonly WorkOrderEvent[];
  /** Field fixes on Org62 Events: Duration__c backfills and (D-70) approved Event updates. */
  updates: readonly WorkOrderUpdate[];
  dcs: readonly DcAdd[];
  ucCreates: readonly UseCaseCreate[];
  ucUpdates: readonly UseCaseUpdate[];
}

export interface BatchCanvasOptions {
  /** The batch's days ("Nov 3–Nov 12"), in the title; null: none (no Event rows). */
  span: string | null;
  /** Log DCs now: a canvas of the DC rows alone. */
  dcOnly?: boolean;
  /** UTF-8 bytes per canvas (tests split with a small one). */
  limit?: number;
}

export interface BatchCanvasResult {
  canvases: Array<BatchCanvas & { updateIds: string[] }>;
  /** Use-case rows on the canvases (creates + Stage / Go-Live fixes), and creates waiting for a batch with rows. */
  useCases: { rows: number; later: number };
  dcs: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The batch's days (YYYY-MM-DD, local) as the title says them: "Nov 3", "Nov 3–Nov 12"; null for none. */
export function batchSpan(days: readonly string[]): string | null {
  const d = [...days].sort();
  if (!d.length) return null;
  return d[0] === d.at(-1) ? fmtDay(d[0]!) : `${fmtDay(d[0]!)}–${fmtDay(d.at(-1)!)}`;
}

/** A canvas's title from what it carries ("Activity log · Nov 3–Nov 12 · 12 rows · 3 DCs · 20 use cases"). */
export function batchTitle(i: { span: string | null; rows: number; dcs: number; useCases: number; updates?: number; part?: number; parts?: number; dcOnly?: boolean }): string {
  // D-70: a canvas of use cases (or updates) alone names no rows
  const bits = i.dcOnly && !i.rows ? ['Deal Contributions'] : ['Activity log', ...(i.span ? [i.span] : []), ...(i.rows || !(i.useCases || i.updates) ? [plural(i.rows, 'row')] : [])];
  if (i.updates && !i.rows) bits.push(plural(i.updates, 'update'));
  if (i.dcs) bits.push(plural(i.dcs, 'DC'));
  if (i.useCases) bits.push(plural(i.useCases, 'use case'));
  return `${bits.join(' · ')}${(i.parts ?? 1) > 1 ? ` (part ${i.part} of ${i.parts})` : ''}`;
}

type Item = { e: WorkOrderEvent } | { u: WorkOrderUpdate } | { d: DcAdd } | { c: UseCaseCreate } | { x: UseCaseUpdate };

/** The work order of these rows, exactly as Slackbot gets it. */
export function renderBatch(base: Omit<WorkOrderInput, 'events' | 'updates'>, items: readonly Item[]): string {
  const events = items.flatMap((i) => ('e' in i ? [i.e] : []));
  const updates = items.flatMap((i) => ('u' in i ? [i.u] : []));
  const dcs = items.flatMap((i) => ('d' in i ? [i.d] : []));
  const creates = items.flatMap((i) => ('c' in i ? [i.c] : []));
  const fixes = items.flatMap((i) => ('x' in i ? [i.x] : []));
  return withUseCaseRows(withDcAdds(renderWorkOrder({ ...base, events, updates }), dcs, base.ownerOrg62Id), creates, fixes, base.ownerOrg62Id);
}

/**
 * Parts of the whole work order, each as big as fits `limit`: the longest prefix of the rows left that renders within
 * it (a binary search, so a 900 KB order renders O(log n) times, not once per row). A single row too big for any
 * canvas goes alone; its payload says it is too big and Apply refuses it.
 */
function partsOf(base: Omit<WorkOrderInput, 'events' | 'updates'>, items: readonly Item[], limit: number): Item[][] {
  if (fitsOneCanvas(renderBatch(base, items), limit)) return [[...items]];
  const parts: Item[][] = [];
  let at = 0;
  while (at < items.length) {
    let lo = 1;
    let hi = items.length - at;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fitsOneCanvas(renderBatch(base, items.slice(at, at + mid)), limit)) lo = mid;
      else hi = mid - 1;
    }
    parts.push(items.slice(at, at + lo));
    at += lo;
  }
  return parts;
}

export function batchCanvases(base: Omit<WorkOrderInput, 'events' | 'updates'>, rows: BatchRows, o: BatchCanvasOptions): BatchCanvasResult {
  const dcOnly = !!o.dcOnly;
  const events = dcOnly ? [] : rows.events;
  const updates = dcOnly ? [] : rows.updates;
  const creates = dcOnly ? [] : rows.ucCreates;
  const fixes = dcOnly ? [] : rows.ucUpdates;
  // D-70: use cases are rows; DCs wait for a batch with rows; a DC-only canvas only when asked (never with use cases)
  const hasRows = events.length > 0 || updates.length > 0 || creates.length > 0 || fixes.length > 0;
  if (!hasRows && !(dcOnly && rows.dcs.length)) return { canvases: [], useCases: { rows: 0, later: 0 }, dcs: 0 };
  const items: Item[] = [...events.map((e) => ({ e })), ...updates.map((u) => ({ u })), ...rows.dcs.map((d) => ({ d })), ...creates.map((c) => ({ c })), ...fixes.map((x) => ({ x }))];
  const parts = partsOf(base, items, o.limit ?? CANVAS_MAX_BYTES);
  const canvases = parts.map((p, k) => {
    const evs = p.flatMap((i) => ('e' in i ? [i.e] : []));
    const ups = p.flatMap((i) => ('u' in i ? [i.u] : []));
    const dcs = p.filter((i) => 'd' in i).length;
    const ucs = p.filter((i) => 'c' in i || 'x' in i).length;
    return {
      part: k + 1,
      parts: parts.length,
      title: batchTitle({ span: o.span, rows: evs.length, dcs, useCases: ucs, updates: ups.length, part: k + 1, parts: parts.length, dcOnly }),
      markdown: renderBatch(base, p),
      eventIds: evs.map((e) => e.ccId),
      hours: evs.reduce((s, e) => s + e.durationH, 0),
      updates: ups.length,
      updateIds: ups.map((u) => u.recordId),
    };
  });
  return { canvases, useCases: { rows: creates.length + fixes.length, later: 0 }, dcs: rows.dcs.length };
}

/**
 * D-70: what a batch takes (Log it's ticks): rows, use cases (their round-trip keys) and Event updates (their write
 * ids). Null: all of that kind. Any one given makes the selection exact (the kinds not given take none); none given:
 * everything ready.
 */
export interface BatchSelection {
  rows: ReadonlySet<string> | null;
  useCases: ReadonlySet<string> | null;
  updates: ReadonlySet<string> | null;
}

export function batchSelectionOf(b: { ids?: readonly string[]; useCases?: readonly string[]; updates?: readonly string[] }): BatchSelection {
  const any = !!(b.ids?.length || b.useCases?.length || b.updates?.length);
  if (!any) return { rows: null, useCases: null, updates: null };
  return { rows: new Set(b.ids ?? []), useCases: new Set(b.useCases ?? []), updates: new Set(b.updates ?? []) };
}
