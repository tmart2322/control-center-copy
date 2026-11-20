/**
 * History (B-081), mock side: the store's collections plus the closes the audit trail knows about, handed to the
 * shared composer (src/server/history/compose.ts). The db side reads the same facts from Postgres (db/history.ts).
 *
 * A close in the audit trail is an entry on a work item whose changes set `state` to done, that was not undone
 * and is not itself an undo (an undo that restores a close leaves the record done, so the record covers it).
 */
import type { Actor, AuditEntry } from '@/contract';
import { type HistoryClosure, type HistorySources } from '@/server/history/compose';
import type { MockAuditLog, Store } from './store';

const byActor = (a: Actor): HistoryClosure['by'] => (a === 'user' ? 'you' : a === 'engine' || a === 'scenario' ? 'engine' : a === 'chat' ? 'chat' : 'other');

export function auditClosures(entries: readonly AuditEntry[]): HistoryClosure[] {
  return entries
    .filter((e) => e.entity.type === 'work_item' && !e.undoneAt && !e.undoOf && e.action !== 'undo' && e.changes.some((c) => c.field === 'state' && c.after === 'done'))
    .map((e) => ({ itemId: e.entity.id, at: e.at, by: byActor(e.actor) }));
}

export function mockHistorySources(store: Store, audit: MockAuditLog, now: Date): HistorySources {
  return {
    timezone: store.settings().profile.timezone,
    now,
    workItems: store.all('workItems'),
    accounts: store.all('accounts'),
    activity: store.all('activity'),
    timeBlocks: store.all('timeBlocks'),
    events: store.all('events'),
    drafts: store.all('drafts'),
    agentRuns: store.all('agentRuns'),
    pastClosures: auditClosures(audit.entries),
  };
}
