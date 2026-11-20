/**
 * OS-notification triggers (D-22, UI-SPEC §9) through OPS' Notifier (src/ops/notify.ts: dedupe per transition,
 * rate limit, quiet hours). The worker calls these on transitions only:
 *   waiting_on_you    a Claude session flipped to "waiting"           (resolved when it stops waiting)
 *   failed_top3       a run for a Top-3 work item failed / dead-lettered
 *   connector_broken  a connector went auth_required / error          (resolved when healthy again)
 */
import { sql } from 'drizzle-orm';

import type { Db } from '@/db/client';
import type { NotifyOutcome, NotifyRequest } from '@/ops/notify';
import { CONNECTOR_META, type HealthChange } from '@/scanner/store-db';

export interface NotifierLike {
  notify(req: NotifyRequest): Promise<NotifyOutcome>;
  resolve(r: Pick<NotifyRequest, 'kind' | 'entityId' | 'transition'>): void;
}

/** Notifications are off (tests, live checks): records what would have been sent. */
export class NullNotifier implements NotifierLike {
  readonly sent: NotifyRequest[] = [];
  readonly resolved: Array<Pick<NotifyRequest, 'kind' | 'entityId' | 'transition'>> = [];
  async notify(req: NotifyRequest): Promise<NotifyOutcome> {
    this.sent.push(req);
    return { sent: false, key: `${req.kind}:${req.entityId}:${req.transition}`, reason: 'opted_out' };
  }
  resolve(r: Pick<NotifyRequest, 'kind' | 'entityId' | 'transition'>): void {
    this.resolved.push(r);
  }
}

export function connectorHealthNotifier(n: NotifierLike): (e: HealthChange) => Promise<void> {
  return async (e) => {
    const label = CONNECTOR_META[e.connector]?.label ?? e.connector;
    if (e.to === 'auth_required' || e.to === 'error') {
      await n.notify({
        kind: 'connector_broken',
        entityId: e.connector,
        transition: e.to,
        title: e.to === 'auth_required' ? `${label} needs re-auth` : `${label} is not responding`,
        body: e.probe.reauth?.instructions ?? 'Open Health to fix it.',
        url: `/health#${e.connector}`,
      });
    } else if (e.to === 'healthy') {
      n.resolve({ kind: 'connector_broken', entityId: e.connector, transition: 'auth_required' });
      n.resolve({ kind: 'connector_broken', entityId: e.connector, transition: 'error' });
    }
  };
}

/** After a claude_sessions scan: sessions whose status changed in this run (W1 bumps last_scan_run_id on change). */
export async function notifyClaudeSessions(db: Db, userId: string, runId: string, n: NotifierLike): Promise<{ waiting: number; failedTop3: number }> {
  const rows = await db.execute<{ session: string; title: string | null; status: string | null; tag: string | null; top3: boolean }>(sql`
    select si.external_id as session, si.title, si.meta->>'status' as status, si.meta->'ccTag'->>'id' as tag,
           exists (select 1 from work_items w where w.owner_user_id = si.owner_user_id and w.id::text = si.meta->'ccTag'->>'id'
                     and w.priority_lane = 'top3' and w.status not in ('done', 'dismissed', 'merged')) as top3
      from source_items si
     where si.owner_user_id = ${userId} and si.kind = 'claude_session' and si.last_scan_run_id = ${runId}`);
  let waiting = 0;
  let failedTop3 = 0;
  for (const r of rows.rows) {
    if (r.status === 'waiting') {
      waiting++;
      await n.notify({ kind: 'waiting_on_you', entityId: r.session, transition: 'waiting', title: 'Claude is waiting on you', body: r.title ?? 'A session needs your input', url: '/agents' });
    } else {
      n.resolve({ kind: 'waiting_on_you', entityId: r.session, transition: 'waiting' });
    }
    if (r.status === 'errored' && r.top3) {
      failedTop3++;
      await n.notify({ kind: 'failed_top3', entityId: r.tag!, transition: 'failed', title: 'A Top 3 task hit an error', body: r.title ?? 'Claude session errored', url: `/work/${r.tag}` });
    }
  }
  return { waiting, failedTop3 };
}

/** A dead-lettered job for a Top-3 work item. */
export async function notifyDeadTop3(db: Db, workItemId: string | undefined, kind: string, n: NotifierLike): Promise<boolean> {
  if (!workItemId) return false;
  const r = await db.execute<{ title: string }>(sql`
    select title from work_items where id::text = ${workItemId} and priority_lane = 'top3' and status not in ('done', 'dismissed', 'merged')`);
  if (!r.rows[0]) return false;
  await n.notify({ kind: 'failed_top3', entityId: workItemId, transition: `dead:${kind}`, title: 'A Top 3 task needs attention', body: r.rows[0].title, url: `/work/${workItemId}` });
  return true;
}
