/**
 * D-65: the state a logging canvas's preflight reads in the database (src/lib/canvas/preflight.ts): the activity rows
 * behind the canvas's CC# keys as they are now (with the WhatId a batch would write), and the Org62 Events its
 * Duration__c fixes target; the use-case plan (D-67) and my DCs and DC requests (D-68) when the canvas has such rows.
 * Reads only.
 */
import { sql } from 'drizzle-orm';

import type { Db, DbOrTx } from '@/db/client';
import { canvasInputOf, type CanvasActionInput } from '@/lib/canvas/payload';
import { canvasRowsOf, type CanvasPreflightContext, type PreflightActivity } from '@/lib/canvas/preflight';
import type { Draft } from '@/contract';

import { preflightUseCases } from '@/server/time/canvas-preflight';

import { loadDcLiveState } from './dc-requests';
import { loadUseCasePlan } from './use-cases';

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const textArr = (vals: readonly string[]) => sql`array[${sql.join(vals.map((v) => sql`${v}::text`), sql`, `)}]`;

export async function dbPreflightContext(db: DbOrTx, userId: string, inputs: readonly CanvasActionInput[], o: { taskTypeRequired: boolean; unstage?: ReadonlySet<string>; useCases?: boolean }): Promise<CanvasPreflightContext> {
  const rows = inputs.flatMap((i) => canvasRowsOf(i.markdown));
  const refs = [...new Set(rows.filter((r) => r.kind === 'event' && r.ref && uuidRe.test(r.ref)).map((r) => r.ref!))];
  const events = [...new Set(rows.filter((r) => r.kind === 'update:Event' && r.ref).map((r) => r.ref!))];
  const activity = new Map<string, PreflightActivity>();
  if (refs.length) {
    const r = await db.execute<{ id: string; status: string; starts_at: Date | string; ends_at: Date | string; duration_hours: string | number; task_type: string | null; what: string | null; flags: string[] | null }>(sql`
      select a.id::text as id, a.status::text as status, a.starts_at, a.ends_at, a.duration_hours, t.name as task_type, a.what_org62_id as what, a.flags
        from activity_entries a left join se_task_types t on t.id = a.se_task_type_id
       where a.owner_user_id = ${userId} and a.id::text = any(${textArr(refs)})`);
    for (const x of r.rows)
      activity.set(x.id, {
        status: x.status,
        startsAt: new Date(x.starts_at).toISOString(),
        endsAt: new Date(x.ends_at).toISOString(),
        durationH: Number(x.duration_hours),
        taskType: x.task_type,
        // the WhatId a batch writes (log-batch.ts): the row's, or empty for internal-only work
        whatId: x.what ?? '',
        flags: x.flags ?? [],
      });
  }
  const org62 = new Map<string, { durationField: number | null; deleted: boolean }>();
  if (events.length) {
    const r = await db.execute<{ id: string; d: string | number | null; deleted: Date | string | null }>(sql`
      select org62_event_id as id, duration_field as d, deleted_upstream_at as deleted from org62_events
       where owner_user_id = ${userId} and org62_event_id = any(${textArr(events)})`);
    for (const x of r.rows) org62.set(x.id, { durationField: x.d === null ? null : Number(x.d), deleted: !!x.deleted });
  }
  // D-67: where each use case stands now (the use-case plan); D-68: my DCs and the DC requests (DC-05). Read only when
  // the canvas carries such rows, and only from the database proper (Apply, the sweep), not inside an edit's write.
  const uc = o.useCases && rows.some((r) => r.kind === 'use_case__c' || r.kind === 'update:Use_Case__c') ? (await loadUseCasePlan(db as Db, userId)).plan : null;
  const dcLive = o.useCases && rows.some((r) => r.kind === 'dc' || r.kind === 'update:Deal_Contribution__c') ? await loadDcLiveState(db, userId) : null;
  return {
    activity: (id) => activity.get(id) ?? null,
    org62Event: (id) => org62.get(id) ?? null,
    taskTypeRequired: o.taskTypeRequired,
    ...(o.unstage ? { unstage: o.unstage } : {}),
    ...(uc ? preflightUseCases(uc.items) : {}),
    ...(dcLive ? { dcLive } : {}),
  };
}

/** The context for one canvas item. */
export const dbPreflightContextFor = (db: DbOrTx, userId: string, d: Pick<Draft, 'destination'>, o: { taskTypeRequired: boolean; unstage?: ReadonlySet<string>; useCases?: boolean }) => dbPreflightContext(db, userId, d.destination.kind === 'action' ? [canvasInputOf(d.destination)] : [], o);
