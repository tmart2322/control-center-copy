/**
 * "Publish on every change-set commit by default": the commit hook (`onChangeSetCommitted`, src/db/changeset.ts)
 * turns each committed change set into small `{topic, ids, reason}` LiveEvents and NOTIFYs them on `cc_live`.
 *
 * - Change sets with audit rows: one event per topic of the touched root entities, plus `audit` (the ⌘Z stack).
 * - Change sets without audit rows (scanner ingest, scan runs, health probes): a throttled `scans` (scanner actors)
 *   or `jobs` (system actors) event, at most one per `throttleMs` per topic.
 * Install once per process (worker and web). Returns the uninstall function.
 */
import { sql } from 'drizzle-orm';

import type { LiveTopic } from '@/contract';
import { onChangeSetCommitted, type CommittedChangeSet } from '@/db/changeset';
import { getDb, type Db } from '@/db/client';

import type { PgEventBus } from './pg-bus';
import { eventsForChanges, type ChangeRow } from './topics';

export interface PublisherOptions {
  bus: PgEventBus;
  db?: Db;
  throttleMs?: number;
  /** Skip change sets entirely (e.g. retention bookkeeping). */
  skip?: (cs: CommittedChangeSet) => boolean;
}

export function installChangeSetPublisher(opts: PublisherOptions): () => void {
  const db = opts.db ?? getDb();
  const throttleMs = opts.throttleMs ?? 2000;
  const lastQuiet = new Map<LiveTopic, number>();
  const quiet = (topic: LiveTopic, reason: string, cs: string) => {
    const t = Date.now();
    if (t - (lastQuiet.get(topic) ?? 0) < throttleMs) return;
    lastQuiet.set(topic, t);
    opts.bus.publishChangeSet(cs, [{ topic, ids: [], reason }]);
  };
  return onChangeSetCommitted((cs) => {
    if (opts.skip?.(cs)) return;
    opts.bus.expectChangeSet(cs.id); // drop the cc_change fallback for this change set right away
    void (async () => {
      const res = await db.execute<{ entity_type: string; entity_id: string; op: ChangeRow['op']; table_name: string }>(sql`
        select entity_type, entity_id, op, table_name from audit_events where change_set_id = ${cs.id} limit 500`);
      const rows = res.rows.map((r) => ({ entityType: r.entity_type, entityId: r.entity_id, op: r.op, table: r.table_name }));
      if (!rows.length) {
        if (cs.actor.kind === 'connector') quiet('scans', `${cs.actor.ref ?? 'scanner'}.progress`, cs.id);
        else if (cs.actor.kind === 'system' && cs.actor.ref !== 'retention') quiet('jobs', `${cs.actor.ref ?? 'system'}.progress`, cs.id);
        return;
      }
      const events = eventsForChanges(rows);
      if (cs.kind !== 'autosave_burst') events.push({ topic: 'audit', ids: [cs.id], reason: `changeset.${cs.kind}` });
      opts.bus.publishChangeSet(cs.id, events);
    })().catch(() => undefined);
  });
}
