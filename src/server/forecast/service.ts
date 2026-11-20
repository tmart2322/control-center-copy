/**
 * What both DataSources do for Time ▸ Forecast, as pure steps over the view (src/engines/forecast/view.ts), so mock
 * and db cannot drift: edit / approve / discard a record's update, plan a draft run, and build the ONE canvas that
 * "Stage N notes" stages (its preview holds the one Apply). Nothing here writes anywhere.
 */
import type { ActionDestination, ForecastPayload, ForecastPending, ForecastRow, PatchForecastRequest, SpecialistForecast, StageForecastResult } from '@/contract';
import { forecastCanvasActionFor, packForecastRows, renderForecastWorkOrder, stageableUpdates, type ForecastWorkOrderRow } from '@/engines/forecast';
import { AppError } from '@/server/errors';

const LOCKED = new Set(['staged', 'handed_off']);

/** The record's pending state after one edit (409 while a canvas holds the note). */
export function patchedPending(rec: SpecialistForecast, row: ForecastRow, body: PatchForecastRequest, nowIso: string): ForecastPending {
  const next: ForecastPending = { ...rec.pending };
  const touchesNotes = body.notes !== undefined || body.notesState !== undefined || body.discardNotes;
  if (touchesNotes && LOCKED.has(row.notes.state)) {
    throw new AppError('conflict', row.notes.state === 'staged' ? 'This note is in a canvas waiting for Apply: reject that canvas item to change it' : 'This note was handed to Slackbot: Sync to see whether it landed, then edit it', { recordId: rec.id, state: row.notes.state }, false);
  }
  // the current pending note (a stale one, written against older Org62 notes, starts over)
  const cur = row.notes.text !== null && rec.pending.notes ? rec.pending.notes : null;
  if (body.discardNotes) next.notes = null;
  else if (body.notes !== undefined) {
    const text = body.notes.trim();
    const same = cur && cur.text === text;
    next.notes = {
      text,
      state: body.notesState ?? (same ? cur.state : 'drafted'),
      origin: cur ? (same ? cur.origin : cur.origin === 'model' ? 'edited' : cur.origin) : 'manual',
      at: same ? cur.at : nowIso,
      // a note that already landed is over: what you write now is next week's, against today's Org62 notes
      basedOnNotesAt: cur && row.notes.state !== 'landed' ? cur.basedOnNotesAt : rec.notesUpdatedAt,
      model: cur?.model ?? null,
      costUsd: cur?.costUsd ?? 0,
      sources: cur?.sources ?? [],
    };
  } else if (body.notesState !== undefined) {
    if (!cur) throw new AppError('validation', 'There is no draft to approve: draft the note or write one first', { recordId: rec.id }, false);
    next.notes = { ...cur, state: body.notesState };
  }
  if (body.dealRole !== undefined) {
    if (body.dealRole === null) next.dealRole = null;
    else {
      if (LOCKED.has(row.role.state)) throw new AppError('conflict', 'This Deal Role is in a canvas already', { recordId: rec.id, state: row.role.state }, false);
      if (!row.roleFix) throw new AppError('validation', 'Deal Role is already set on this record', { recordId: rec.id }, false);
      next.dealRole = { value: body.dealRole, state: 'approved', at: nowIso };
    }
  }
  next.draftError = body.notes !== undefined ? null : next.draftError;
  return next;
}

/** Which records a draft run should take ("Draft all": every queued record with nothing current to show). */
export function draftTargets(view: ForecastPayload, ids?: readonly string[]): { targets: string[]; skipped: Array<{ id: string; why: string }> } {
  const byId = new Map(view.rows.map((r) => [r.id, r] as const));
  const want = ids?.length ? [...new Set(ids)] : view.queue.notes;
  const targets: string[] = [];
  const skipped: Array<{ id: string; why: string }> = [];
  for (const id of want) {
    const r = byId.get(id);
    if (!r) {
      skipped.push({ id, why: 'not a Specialist Forecast of yours' });
      continue;
    }
    if (r.gone) skipped.push({ id, why: 'no longer in Org62 for this or next quarter' });
    else if (r.notes.state === 'drafting') skipped.push({ id, why: 'already drafting' });
    else if (LOCKED.has(r.notes.state)) skipped.push({ id, why: r.notes.state === 'staged' ? 'in a canvas waiting for Apply' : 'handed to Slackbot' });
    else if (!ids?.length && (r.notes.state === 'drafted' || r.notes.state === 'approved')) skipped.push({ id, why: 'has a draft already' });
    else targets.push(id);
  }
  return { targets, skipped };
}

export interface StagePlan {
  /** null: nothing to stage. */
  destination: ActionDestination | null;
  title: string | null;
  notes: number;
  roles: number;
  /** Record ids left for the next canvas. */
  deferred: string[];
  waiting: StageForecastResult['waiting'];
}

/** The ONE canvas "Stage N notes" creates: approved updates not held by a waiting canvas, in queue order. */
export function stagePlan(view: ForecastPayload, o: { ownerName: string; ownerOrg62Id: string; nowIso: string; sourceLabel: string; ids?: readonly string[] }): StagePlan {
  const held = view.rows.filter((r) => r.notes.state === 'staged' || r.role.state === 'staged');
  const waiting = { updates: held.filter((r) => r.notes.state === 'staged').length + held.filter((r) => r.role.state === 'staged').length, draftIds: [...new Set(held.flatMap((r) => [r.notes.draftId, r.role.draftId]).filter((x): x is string => !!x))] };
  const rows: ForecastWorkOrderRow[] = stageableUpdates(view, o.ids);
  if (!rows.length) return { destination: null, title: null, notes: 0, roles: 0, deferred: [], waiting };
  const base = { ownerName: o.ownerName, ownerOrg62Id: o.ownerOrg62Id, generatedAt: o.nowIso, sourceLabel: o.sourceLabel };
  const { take, deferred } = packForecastRows(base, rows);
  if (!take.length) return { destination: null, title: null, notes: 0, roles: 0, deferred: deferred.map((r) => r.recordId), waiting };
  const notes = take.filter((r) => r.notes).length;
  const roles = take.filter((r) => r.dealRole).length;
  const title = `Specialist Forecast · ${[notes ? `${notes} note${notes === 1 ? '' : 's'}` : null, roles ? `${roles} deal role${roles === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}`;
  const destination = forecastCanvasActionFor({ title, markdown: renderForecastWorkOrder({ ...base, rows: take }), rows: take });
  return { destination, title, notes, roles, deferred: deferred.map((r) => r.recordId), waiting };
}
