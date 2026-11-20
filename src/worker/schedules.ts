/**
 * Maintenance schedules over `job_schedules` (DATA-MODEL §4.5 "Schedules"). Scan cadence is NOT here: the BE-2a
 * ScannerRuntime plans scans itself (SCANNER.md §5: cadence, ×6 off-hours, adaptive backoff, budget pause,
 * resume = head first then backfill). These are the nightly jobs:
 *
 *   retention.scrub    03:15 local   run_once catch-up (a laptop asleep at 03:15 scrubs on wake)
 *   backup.nightly     02:30 local   run_once; the handler still checks backupDue()
 *   missed_opps.sweep  06:00 local   stub until BE-5 wires it (schedule disabled: paused_reason 'not_wired')
 *   brief.generate     07:30 local   run_once: watched-channel briefs (the Watches form's "Daily 7:30"); the handler
 *                                    briefs only the watches that are due, so a catch-up run never repeats a brief
 *   activity.sync      17:30 local   stub until BE-5
 *   hygiene.sweep      04:10 local   run_once: the dead-data sweep (HYG-1; the worker also queues one at start)
 *   org62.readback     06:40 local   run_once: re-read my logged Events and my DCs by Id (edits, deletions; HYG-1)
 *   vdp.specialist_aes 06:50 local   run_once: who each VDP's AE is, from my 100%-DC opps' Specialist Forecasts (D-63)
 *   accounts.hierarchy 06:55 local   run_once: the Org62 account hierarchy up to five levels, a full refresh (D-69)
 *
 * Catch-up policies: `run_once` enqueues one job however many runs were missed; `skip_missed` enqueues nothing
 * when the slot is more than one interval old; both then move next_run_at to the next local slot.
 */
import { sql } from 'drizzle-orm';

import { actors, withChangeSet } from '@/db/changeset';
import type { Db } from '@/db/client';
import { enqueueJob } from '@/db/queue';
import type { JobRegistry } from '@/jobs/registry';

export interface MaintenanceSchedule {
  key: string;
  kind: string;
  /** "HH:MM" in the user's time zone. */
  atLocal: string;
  catchUp: 'run_once' | 'skip_missed';
  payload?: Record<string, unknown>;
  priority?: number;
}

export const DEFAULT_MAINTENANCE: MaintenanceSchedule[] = [
  { key: 'backup.nightly', kind: 'backup.nightly', atLocal: '02:30', catchUp: 'run_once' },
  { key: 'retention.scrub', kind: 'retention.scrub', atLocal: '03:15', catchUp: 'run_once' },
  { key: 'missed_opps.sweep', kind: 'missed_opps.sweep', atLocal: '06:00', catchUp: 'run_once' },
  { key: 'brief.generate', kind: 'brief.generate', atLocal: '07:30', catchUp: 'run_once' },
  { key: 'activity.sync', kind: 'activity.sync', atLocal: '17:30', catchUp: 'run_once' },
  { key: 'forecast.sync', kind: 'forecast.sync', atLocal: '07:15', catchUp: 'run_once' }, // lane A: Specialist Forecasts (skips unless the persona feature is on)
  { key: 'hygiene.sweep', kind: 'hygiene.sweep', atLocal: '04:10', catchUp: 'run_once' }, // HYG-1: dead-data sweep (also at every worker start)
  { key: 'org62.readback', kind: 'org62.readback', atLocal: '06:40', catchUp: 'run_once' }, // HYG-1: re-read my logged Events and DCs by Id
  { key: 'vdp.specialist_aes', kind: 'vdp.specialist_aes', atLocal: '06:50', catchUp: 'run_once', payload: { trigger: 'daily' } }, // D-63: who each VDP's AE is (a full refresh)
  { key: 'accounts.hierarchy', kind: 'accounts.hierarchy', atLocal: '06:55', catchUp: 'run_once', payload: { trigger: 'daily' } }, // D-69: the Org62 account hierarchy (a full refresh)
];

function localParts(d: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second) };
}

/** The UTC instant of a local wall-clock time (two-pass offset correction handles DST). */
function zonedInstant(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): Date {
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    guess += Date.UTC(y, mo - 1, d, h, mi) - asUtc;
  }
  return new Date(guess);
}

/** Next occurrence of local "HH:MM" strictly after `after`. */
export function nextLocalTime(after: Date, hhmm: string, timeZone: string): Date {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const p = localParts(after, timeZone);
  for (let addDays = 0; addDays < 3; addDays++) {
    const base = new Date(Date.UTC(p.y, p.mo - 1, p.d + addDays));
    const t = zonedInstant(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), h, m, timeZone);
    if (t.getTime() > after.getTime()) return t;
  }
  return new Date(after.getTime() + 86_400_000);
}

const cron = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${m} ${h} * * *`;
};

/** Upsert the schedule rows. Unwired (stub) kinds stay disabled with paused_reason 'not_wired'. */
export async function ensureSchedules(db: Db, userId: string, registry: JobRegistry, timeZone: string, now: Date, specs = DEFAULT_MAINTENANCE): Promise<void> {
  await withChangeSet({ db, userId, actor: actors.system('scheduler'), reason: 'ensure maintenance schedules', undoable: false }, async (tx) => {
    for (const s of specs) {
      const def = registry.get(s.kind);
      if (!def) continue;
      const wired = def.wired;
      await tx.execute(sql`
        insert into job_schedules (owner_user_id, key, kind, queue, payload, cron_expr, timezone, catch_up, priority, enabled, paused_reason, next_run_at)
        values (${userId}, ${s.key}, ${s.kind}, ${def.queue}, ${JSON.stringify(s.payload ?? {})}::jsonb, ${cron(s.atLocal)}, ${timeZone},
                ${s.catchUp}, ${s.priority ?? 0}, ${wired}, ${wired ? null : 'not_wired'}, ${nextLocalTime(now, s.atLocal, timeZone).toISOString()}::timestamptz)
        on conflict (owner_user_id, key) do update set
          kind = excluded.kind, queue = excluded.queue, cron_expr = excluded.cron_expr, catch_up = excluded.catch_up,
          enabled = excluded.enabled,
          paused_reason = case when excluded.enabled then (case when job_schedules.paused_reason = 'not_wired' then null else job_schedules.paused_reason end)
                               else 'not_wired' end,
          timezone = excluded.timezone,
          next_run_at = case when job_schedules.timezone is distinct from excluded.timezone or job_schedules.cron_expr is distinct from excluded.cron_expr
                             then excluded.next_run_at else job_schedules.next_run_at end
        where job_schedules.kind is distinct from excluded.kind or job_schedules.queue is distinct from excluded.queue
           or job_schedules.cron_expr is distinct from excluded.cron_expr or job_schedules.catch_up is distinct from excluded.catch_up
           or job_schedules.enabled is distinct from excluded.enabled or job_schedules.timezone is distinct from excluded.timezone
           or (excluded.enabled and job_schedules.paused_reason = 'not_wired')`);
    }
  });
}

/** Enqueue due schedules (one job each, coalesced on `sched:<key>`) and move them to their next local slot. */
export async function tickSchedules(db: Db, userId: string, now: Date, specs = DEFAULT_MAINTENANCE): Promise<string[]> {
  const due = await db.execute<{ id: string; key: string; kind: string; queue: string; payload: Record<string, unknown>; timezone: string; catch_up: string; next_run_at: string; priority: number }>(sql`
    select id, key, kind, queue, payload, timezone, catch_up, next_run_at, priority from job_schedules
     where owner_user_id = ${userId} and enabled and paused_reason is null and next_run_at <= ${now.toISOString()}::timestamptz
     order by next_run_at limit 50`);
  if (!due.rows.length) return [];
  const enqueued: string[] = [];
  await withChangeSet({ db, userId, actor: actors.system('scheduler'), reason: `schedules due: ${due.rows.length}`, undoable: false }, async (tx) => {
    for (const s of due.rows) {
      const spec = specs.find((x) => x.key === s.key);
      const at = spec?.atLocal ?? '03:00';
      const overdueMs = now.getTime() - new Date(s.next_run_at).getTime();
      const skip = s.catch_up === 'skip_missed' && overdueMs > 86_400_000;
      let jobId: number | null = null;
      if (!skip) {
        const r = await enqueueJob(tx, {
          ownerUserId: userId,
          kind: s.kind,
          queue: s.queue,
          payload: { ...s.payload, scheduleKey: s.key, slot: new Date(s.next_run_at).toISOString() },
          dedupeKey: `sched:${s.key}`,
          scheduleId: s.id,
          priority: s.priority,
        });
        jobId = r.id;
        enqueued.push(s.key);
      }
      await tx.execute(sql`
        update job_schedules set next_run_at = ${nextLocalTime(now, at, s.timezone).toISOString()}::timestamptz,
               last_enqueued_at = case when ${jobId}::bigint is null then last_enqueued_at else ${now.toISOString()}::timestamptz end,
               last_job_id = coalesce(${jobId}::bigint, last_job_id)
         where id = ${s.id}`);
    }
  });
  return enqueued;
}
