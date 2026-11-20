/**
 * D-60: queue VDP autopilot (`vdp.autopilot`) after each VDP read and every 30 minutes, only while Settings ▸ Sending ▸
 * VDP autopilot is on. A read is "new" when the mirror's newest `last_seen_at` is after the last run. The job's dedupe
 * key keeps a single run queued; the `vdp` queue runs one job at a time.
 */
import { sql } from 'drizzle-orm';

import type { Db, DbHandle } from '@/db/client';
import { DbDataSource } from '@/server/datasource/db';
import { enqueueJob } from '@/db/queue';
import { ledgerOf, VDP_AUTOPILOT_KV } from '@/engines/vdp/autopilot';
import { VDP_AUTOPILOT_JOB } from '@/jobs/handlers/vdp-autopilot';
import { VDP_AES_JOB } from '@/jobs/handlers/vdp-specialist-aes';
import { HIERARCHY_JOB } from '@/jobs/handlers/account-hierarchy';
import { pendingIdentityUnits, VDP_IDENTITY_JOB } from '@/jobs/handlers/vdp-identity';
import { sendingOf } from '@/outbox/settings';
import { loadSettingsSections } from '@/server/datasource/db/store/settings';
import { VDP_ASSETS_QUEUE } from '@/server/datasource/db/store/vdp-candidates';

export const VDP_AUTOPILOT_EVERY_MS = 30 * 60_000;

/** Is a run due? On, and a VDP read newer than the last run, or the last run 30 minutes ago (or never). */
export function autopilotDue(o: { on: boolean; lastReadAt: string | null; lastRunAt: string | null; now: Date }): boolean {
  if (!o.on) return false;
  if (!o.lastRunAt) return true;
  if (o.lastReadAt && o.lastReadAt > o.lastRunAt) return true;
  return o.now.getTime() - Date.parse(o.lastRunAt) >= VDP_AUTOPILOT_EVERY_MS;
}

/**
 * D-60: after each VDP read (whether autopilot is on or not), withdraw the staged VDP changes whose item VDP now has
 * ("Withdrawn: VDP already has this"), so no badge counts a change with nothing left to do.
 */
export function vdpWithdrawHook(handle: DbHandle, userId: string, log: (msg: string, f?: Record<string, unknown>) => void, deps: { everyMs?: number } = {}) {
  let lastRead: string | null = null;
  return {
    name: 'vdp.withdraw',
    everyMs: deps.everyMs ?? 5 * 60_000,
    run: async () => {
      try {
        const r = await handle.db.execute<{ last: Date | string | null }>(sql`select max(last_seen_at) as last from vdp_records where owner_user_id = ${userId}`);
        const last = r.rows[0]?.last ? new Date(r.rows[0].last).toISOString() : null;
        if (!last || last === lastRead) return;
        lastRead = last;
        const ids = await new DbDataSource({ handle, userId }).withdrawGoneVdpDrafts();
        if (ids.length) log('vdp.withdraw: withdrew staged VDP changes VDP already has', { drafts: ids.length });
      } catch (err) {
        log('vdp.withdraw: could not check staged VDP changes', { code: (err as Error).name });
      }
    },
  };
}

/**
 * D-63: after an Org62 read finishes, queue `vdp.specialist_aes` (who each VDP's AE is). The job itself reads only the
 * opps its cache has not covered, unless the cache is older than 20 hours; the daily 06:50 run refreshes it all.
 */
export function vdpAesHook(db: Db, userId: string, log: (msg: string, f?: Record<string, unknown>) => void, deps: { everyMs?: number } = {}) {
  let lastRun: string | null = null;
  return {
    name: 'vdp.specialist_aes',
    everyMs: deps.everyMs ?? 5 * 60_000,
    run: async () => {
      try {
        const r = await db.execute<{ last: Date | string | null }>(sql`
          select max(sr.finished_at) as last from scan_runs sr join connectors c on c.id = sr.connector_id
           where sr.owner_user_id = ${userId} and c.kind = 'org62' and sr.status in ('succeeded', 'partial')`);
        const last = r.rows[0]?.last ? new Date(r.rows[0].last).toISOString() : null;
        if (!last || last === lastRun) return;
        const j = await db.execute<{ last: Date | string | null }>(sql`select max(created_at) as last from jobs where owner_user_id = ${userId} and kind = ${VDP_AES_JOB}`);
        const jobAt = j.rows[0]?.last ? new Date(j.rows[0].last).toISOString() : null;
        lastRun = last;
        if (jobAt && jobAt > last) return;
        const q = await enqueueJob(db, { ownerUserId: userId, kind: VDP_AES_JOB, queue: VDP_ASSETS_QUEUE, payload: { trigger: 'org62_read' }, dedupeKey: `vdp.specialist_aes:${userId}`, maxAttempts: 2, timeoutSeconds: 600 });
        if (q.inserted) log('vdp.specialist_aes: queued after an Org62 read', { jobId: q.id });
      } catch (err) {
        log('vdp.specialist_aes: could not queue a read', { code: (err as Error).name });
      }
    },
  };
}

/**
 * D-69: after an Org62 read finishes, queue `accounts.hierarchy` (the parents of my accounts, up to five levels). The
 * job reads only the ids not read yet unless the stored hierarchy is older than 20 hours; 06:55 refreshes it all.
 */
export function vdpHierarchyHook(db: Db, userId: string, log: (msg: string, f?: Record<string, unknown>) => void, deps: { everyMs?: number } = {}) {
  let lastRun: string | null = null;
  return {
    name: 'accounts.hierarchy',
    everyMs: deps.everyMs ?? 5 * 60_000,
    run: async () => {
      try {
        const r = await db.execute<{ last: Date | string | null }>(sql`
          select max(sr.finished_at) as last from scan_runs sr join connectors c on c.id = sr.connector_id
           where sr.owner_user_id = ${userId} and c.kind = 'org62' and sr.status in ('succeeded', 'partial')`);
        const last = r.rows[0]?.last ? new Date(r.rows[0].last).toISOString() : null;
        if (!last || last === lastRun) return;
        const j = await db.execute<{ last: Date | string | null }>(sql`select max(created_at) as last from jobs where owner_user_id = ${userId} and kind = ${HIERARCHY_JOB}`);
        const jobAt = j.rows[0]?.last ? new Date(j.rows[0].last).toISOString() : null;
        lastRun = last;
        if (jobAt && jobAt > last) return;
        const q = await enqueueJob(db, { ownerUserId: userId, kind: HIERARCHY_JOB, queue: VDP_ASSETS_QUEUE, payload: { trigger: 'org62_read' }, dedupeKey: `accounts.hierarchy:${userId}`, maxAttempts: 2, timeoutSeconds: 600 });
        if (q.inserted) log('accounts.hierarchy: queued after an Org62 read', { jobId: q.id });
      } catch (err) {
        log('accounts.hierarchy: could not queue a read', { code: (err as Error).name });
      }
    },
  };
}

/**
 * D-69: after a VDP read or a hierarchy read, queue `vdp.identity` when a company identity is ambiguous and its unit
 * has no judgment for its current inputs (the job itself is capped per run and by today's budget).
 */
export function vdpIdentityHook(db: Db, userId: string, log: (msg: string, f?: Record<string, unknown>) => void, deps: { everyMs?: number; handle?: DbHandle } = {}) {
  let seen: string | null = null;
  return {
    name: 'vdp.identity',
    everyMs: deps.everyMs ?? 5 * 60_000,
    run: async () => {
      try {
        const r = await db.execute<{ vdp: Date | string | null; kv: Date | string | null }>(sql`
          select (select max(last_seen_at) from vdp_records where owner_user_id = ${userId}) as vdp,
                 (select max(updated_at) from user_settings where owner_user_id = ${userId} and key in ('cc.org62.account_hierarchy', 'cc.vdp.identity')) as kv`);
        const stamp = `${r.rows[0]?.vdp ? new Date(r.rows[0].vdp).toISOString() : ''}|${r.rows[0]?.kv ? new Date(r.rows[0].kv).toISOString() : ''}`;
        if (stamp === '|' || stamp === seen) return;
        seen = stamp;
        const { pending } = await pendingIdentityUnits(db, userId, deps.handle ?? null);
        if (!pending.length) return;
        const q = await enqueueJob(db, { ownerUserId: userId, kind: VDP_IDENTITY_JOB, queue: VDP_ASSETS_QUEUE, payload: { units: pending.length }, dedupeKey: `vdp.identity:${userId}`, maxAttempts: 1, timeoutSeconds: 600 });
        if (q.inserted) log('vdp.identity: queued for ambiguous companies', { jobId: q.id, units: pending.length });
      } catch (err) {
        log('vdp.identity: could not queue a judgment', { code: (err as Error).name });
      }
    },
  };
}

export function vdpAutopilotHook(db: Db, userId: string, log: (msg: string, f?: Record<string, unknown>) => void, deps: { everyMs?: number; now?: () => Date } = {}) {
  return {
    name: 'vdp.autopilot',
    everyMs: deps.everyMs ?? 60_000,
    run: async () => {
      try {
        const sections = await loadSettingsSections({ db, userId });
        const on = sendingOf(sections.sending).channels.vdp.autopilot;
        if (!on) return;
        // the last run: its newest job (an idle run writes no ledger), else the ledger's own stamp
        const kv = await db.execute<{ value: unknown }>(sql`select value from user_settings where owner_user_id = ${userId} and key = ${VDP_AUTOPILOT_KV}`);
        const ledger = ledgerOf(kv.rows[0]?.value);
        const j = await db.execute<{ last: Date | string | null }>(sql`select max(created_at) as last from jobs where owner_user_id = ${userId} and kind = ${VDP_AUTOPILOT_JOB}`);
        const jobAt = j.rows[0]?.last ? new Date(j.rows[0].last).toISOString() : null;
        const lastRunAt = [jobAt, ledger.lastRunAt].filter((x): x is string => !!x).sort().at(-1) ?? null;
        const r = await db.execute<{ last: Date | string | null }>(sql`select max(last_seen_at) as last from vdp_records where owner_user_id = ${userId}`);
        const last = r.rows[0]?.last ? new Date(r.rows[0].last).toISOString() : null;
        const now = (deps.now ?? (() => new Date()))();
        if (!autopilotDue({ on, lastReadAt: last, lastRunAt, now })) return;
        const q = await enqueueJob(db, { ownerUserId: userId, kind: VDP_AUTOPILOT_JOB, queue: VDP_ASSETS_QUEUE, payload: { trigger: last && lastRunAt && last > lastRunAt ? 'vdp_read' : 'interval' }, dedupeKey: `vdp.autopilot:${userId}`, maxAttempts: 1, timeoutSeconds: 900 });
        if (q.inserted) log('vdp.autopilot: queued a run', { jobId: q.id });
      } catch (err) {
        log('vdp.autopilot: could not queue a run', { code: (err as Error).name });
      }
    },
  };
}
