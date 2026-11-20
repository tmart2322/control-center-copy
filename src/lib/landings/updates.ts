/**
 * D-70: updates to Events already in Org62 (Duration, task type, opp…), as the re-derive proposes them
 * (`{activityEntryId, org62EventId, field, from, to, reason}`). Each is a write on the row's Org62 landing, `proposed`
 * until you approve it (or log it: a complete proposed update is approved with the batch, like a complete row), then
 * `approved` until the next canvas carries it in its UPDATE table as "update · Duration 2 h → 3 h". Pure.
 */
import type { ActivityEntry, EventUpdateCandidate, EventUpdateRow, PatchEventUpdateRequest } from '@/contract';
import type { WorkOrderUpdate } from '@/engines/activity/slackbot';

import { eventUpdateField, fieldDef, fieldValue } from './fields';
import { id15, keyOfLanding, landingKey, OPEN_WRITE, updateWriteKey, type LandingRow, type LandingStore, type StoreChanges, type WriteRow } from './model';

const empty = (): StoreChanges => ({ landings: { insert: [], update: [], remove: [] }, writes: { insert: [], update: [] }, useCases: { insert: [], update: [], remove: [] } });

export interface ProposeResult {
  changes: StoreChanges;
  proposed: string[];
  skipped: Array<{ activityEntryId: string; field: string; why: string }>;
}

/** Record the re-derive's candidates: one proposed write each, never twice the same update, a newer value replacing an older proposal. */
export function proposeEventUpdates(store: LandingStore, candidates: readonly EventUpdateCandidate[], o: { now: string; newId: () => string; activity: (id: string) => Pick<ActivityEntry, 'id'> | undefined }): ProposeResult {
  const ch = empty();
  const proposed: string[] = [];
  const skipped: ProposeResult['skipped'] = [];
  const landings = new Map(store.landings.map((l) => [keyOfLanding(l), l] as const));
  const writes = [...store.writes];
  for (const c of candidates) {
    const field = eventUpdateField(c.field);
    if (!field) {
      skipped.push({ activityEntryId: c.activityEntryId, field: c.field, why: `No canvas UPDATE row writes ${c.field}` });
      continue;
    }
    if (!o.activity(c.activityEntryId)) {
      skipped.push({ activityEntryId: c.activityEntryId, field, why: 'The row is not in Activity' });
      continue;
    }
    if (c.from.trim() === c.to.trim()) {
      skipped.push({ activityEntryId: c.activityEntryId, field, why: 'Nothing changes: from and to are the same' });
      continue;
    }
    const k = landingKey('activity_event', c.activityEntryId, 'org62');
    let l = landings.get(k);
    if (!l) {
      l = { id: o.newId(), recordKind: 'activity_event', recordId: c.activityEntryId, destination: 'org62', externalId: c.org62EventId, state: 'verified', remoteValues: null, verifiedAt: null, lastReadAt: null, createdAt: o.now, updatedAt: o.now };
      landings.set(k, l);
      ch.landings.insert.push(l);
    } else if (!l.externalId) {
      const next: LandingRow = { ...l, externalId: c.org62EventId, updatedAt: o.now };
      landings.set(k, next);
      const at = ch.landings.insert.findIndex((x) => x.id === l!.id);
      if (at >= 0) ch.landings.insert[at] = next;
      else ch.landings.update.push(next);
      l = next;
    }
    const rowKey = updateWriteKey('Event', c.org62EventId, field);
    const mine = writes.filter((w) => w.landingId === l!.id && w.rowKey === rowKey);
    // the same value is already on its way (or proposed, approved, dismissed): never twice
    if (mine.some((w) => (OPEN_WRITE.has(w.state) || w.state === 'staged' || w.state === 'sent' || w.state === 'dismissed') && (w.after[field] ?? '') === c.to)) {
      skipped.push({ activityEntryId: c.activityEntryId, field, why: 'The same update is already proposed or on its way' });
      continue;
    }
    // a newer value replaces an older one not on a canvas yet (it is proposed again)
    const open = mine.find((w) => OPEN_WRITE.has(w.state) && !w.draftId);
    if (open) {
      const next: WriteRow = { ...open, before: { [field]: c.from || null }, after: { [field]: c.to }, reason: c.reason, state: 'proposed', updatedAt: o.now };
      writes[writes.indexOf(open)] = next;
      const at = ch.writes.insert.findIndex((x) => x.id === open.id);
      if (at >= 0) ch.writes.insert[at] = next;
      else ch.writes.update.push(next);
      proposed.push(next.id);
      continue;
    }
    const w: WriteRow = { id: o.newId(), landingId: l.id, draftId: null, rowKey, op: 'update', before: { [field]: c.from || null }, after: { [field]: c.to }, state: 'proposed', origin: 'proposed', reason: c.reason, sentAt: null, verifiedAt: null, createdAt: o.now, updatedAt: o.now };
    writes.push(w);
    ch.writes.insert.push(w);
    proposed.push(w.id);
  }
  return { changes: ch, proposed, skipped };
}

/** Approve, dismiss or bring back one proposed update (only while no canvas carries it). */
export function patchEventUpdate(store: LandingStore, writeId: string, action: PatchEventUpdateRequest['action'], now: string): { changes: StoreChanges; before: WriteRow; after: WriteRow } | { error: 'not_found' | 'locked'; why: string } {
  const w = store.writes.find((x) => x.id === writeId && x.origin === 'proposed');
  if (!w) return { error: 'not_found', why: 'No such update' };
  if (w.draftId || !(OPEN_WRITE.has(w.state) || w.state === 'dismissed')) return { error: 'locked', why: `It is ${w.state} on a canvas: change it in the canvas review instead` };
  const state = action === 'approve' ? 'approved' : action === 'dismiss' ? 'dismissed' : 'proposed';
  const next: WriteRow = { ...w, state, updatedAt: now };
  const ch = empty();
  if (next.state !== w.state) ch.writes.update.push(next);
  return { changes: ch, before: w, after: next };
}

/** One Event update's field, as its write carries it. */
const fieldOf = (w: Pick<WriteRow, 'after'>) => Object.keys(w.after)[0] ?? '';

/** The Event updates a batch takes: the approved ones, and the proposed ones when a complete row is approved with the batch. */
export function eventUpdatesForBatch(store: LandingStore, o: { approveComplete: boolean; only?: ReadonlySet<string> | null; held?: ReadonlySet<string> }): Array<WorkOrderUpdate & { writeId: string }> {
  const landing = new Map(store.landings.map((l) => [l.id, l] as const));
  const out: Array<WorkOrderUpdate & { writeId: string }> = [];
  for (const w of [...store.writes].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    if (w.origin !== 'proposed' || w.draftId || !(w.state === 'approved' || (w.state === 'proposed' && o.approveComplete))) continue;
    if (o.only && !o.only.has(w.id)) continue;
    const l = landing.get(w.landingId);
    if (!l?.externalId) continue;
    const field = fieldOf(w);
    if (o.held?.has(updateWriteKey('Event', l.externalId, field))) continue;
    out.push({ writeId: w.id, recordId: l.externalId, field, newValue: w.after[field] ?? '', currentValue: w.before?.[field] ?? '(blank)', why: w.reason });
  }
  return out;
}

/** The Event updates Log it lists (proposed, approved, dismissed), newest first. */
export function eventUpdatesView(store: LandingStore, activity: (id: string) => Pick<ActivityEntry, 'description' | 'date'> | undefined): EventUpdateRow[] {
  const landing = new Map(store.landings.map((l) => [l.id, l] as const));
  const out: EventUpdateRow[] = [];
  for (const w of store.writes) {
    if (w.origin !== 'proposed' || w.draftId || !(OPEN_WRITE.has(w.state) || w.state === 'dismissed')) continue;
    const l = landing.get(w.landingId);
    if (!l) continue;
    const field = fieldOf(w);
    const e = activity(l.recordId);
    const from = w.before?.[field] ?? null;
    const to = w.after[field] ?? null;
    out.push({
      writeId: w.id,
      activityEntryId: l.recordId,
      org62EventId: l.externalId ?? '',
      label: e?.description || `Event ${id15(l.externalId)}`,
      date: e?.date ?? null,
      field,
      fieldLabel: fieldDef('activity_event', 'org62', field).label,
      from,
      to,
      summary: `update · ${fieldDef('activity_event', 'org62', field).label} ${fieldValue('activity_event', 'org62', field, from)} → ${fieldValue('activity_event', 'org62', field, to)}`,
      reason: w.reason,
      state: w.state as EventUpdateRow['state'],
      createdAt: w.createdAt,
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.label.localeCompare(b.label) || a.field.localeCompare(b.field));
}
