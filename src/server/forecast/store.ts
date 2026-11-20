/**
 * `specialist_forecasts` in Postgres: the mirror upsert (`forecast.sync`), the reads both the web and the worker use,
 * the local review state (`pending`) and the sync / draft job state. The upsert is idempotent: one row per
 * (owner, Org62 Id), the same read twice changes nothing, and it never touches `pending`.
 */
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';

import { EMPTY_FORECAST_PENDING, ForecastPending, type ForecastSyncState, type SpecialistForecast } from '@/contract';
import type { Db, DbOrTx } from '@/db/client';
import { accounts, opportunities, specialistForecasts } from '@/db/schema';
import { id15, type ForecastCheckInput } from '@/engines/forecast';
import { org62RecordUrl } from '@/projections/links';
import type { Org62Sfr } from './soql';

export const FORECAST_QUEUE = 'forecast';
export const FORECAST_SYNC_JOB = 'forecast.sync';
export const FORECAST_DRAFT_JOB = 'forecast.draft';
export const forecastDraftDedupeKey = (recordId: string) => `${FORECAST_DRAFT_JOB}:${recordId}`;
/** "I created it, check now": a `forecast.sync` of ONE opp (payload `scope: 'opp'`), and the full read after it. */
export const FORECAST_CHECK_SCOPE = 'opp';
export const forecastCheckDedupeKey = (opportunityId: string) => `${FORECAST_SYNC_JOB}:opp:${opportunityId}`;
export const forecastFollowUpDedupeKey = (userId: string) => `${FORECAST_SYNC_JOB}:followup:${userId}`;

type Row = typeof specialistForecasts.$inferSelect;
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const day = (d: string | Date | null | undefined) => (d ? (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)) : null);

export function pendingOf(v: unknown): ForecastPending {
  const r = ForecastPending.safeParse(v ?? {});
  return r.success ? r.data : EMPTY_FORECAST_PENDING;
}

export function recordOf(r: Row): SpecialistForecast {
  return {
    id: r.id,
    org62Id: r.org62Id,
    name: r.name,
    url: r.url,
    org62OpportunityId: r.org62OpportunityId,
    opportunityId: r.opportunityId,
    accountId: r.accountId,
    opportunityName: r.opportunityName,
    accountName: r.accountName,
    oppStage: r.oppStage,
    oppNextStep: r.oppNextStep,
    oppCloseDate: day(r.oppCloseDate),
    notes: r.notes,
    prevNotes: r.prevNotes,
    mgrNotes: r.mgrNotes,
    dealRole: r.dealRole,
    judgement: r.judgement,
    forecastStatus: r.forecastStatus,
    amount: r.amount === null ? null : Number(r.amount),
    stage: r.stage,
    closeDate: day(r.closeDate),
    fiscalQuarter: r.fiscalQuarter,
    ownerOrg62Id: r.ownerOrg62Id,
    lastModifiedAt: iso(r.lastModifiedAt),
    notesUpdatedAt: iso(r.notesUpdatedAt),
    syncedAt: iso(r.syncedAt)!,
    goneAt: iso(r.goneAt),
    pending: pendingOf(r.pending),
  };
}

export async function loadForecastRecords(db: DbOrTx, userId: string): Promise<SpecialistForecast[]> {
  const rows = await db.select().from(specialistForecasts).where(eq(specialistForecasts.ownerUserId, userId)).orderBy(specialistForecasts.org62Id);
  return rows.map(recordOf);
}

export async function loadForecastRecord(db: DbOrTx, userId: string, id: string): Promise<SpecialistForecast | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [r] = await db.select().from(specialistForecasts).where(and(eq(specialistForecasts.ownerUserId, userId), eq(specialistForecasts.id, id)));
  return r ? recordOf(r) : null;
}

export async function savePending(db: DbOrTx, userId: string, id: string, pending: ForecastPending): Promise<void> {
  await db
    .update(specialistForecasts)
    .set({ pending: pending as unknown as Record<string, unknown> })
    .where(and(eq(specialistForecasts.ownerUserId, userId), eq(specialistForecasts.id, id)));
}

/** My Org62 user id (onboarding ▸ Sources stores it as the `org62_user` identity), or null. */
export async function ownerOrg62Of(db: DbOrTx, userId: string): Promise<{ name: string; org62Id: string } | null> {
  const r = await db.execute<{ name: string | null; external_id: string | null }>(sql`
    select u.display_name as name, pi.external_id
      from users u left join person_identities pi on pi.person_id = u.person_id and pi.system = 'org62_user'
     where u.id = ${userId} limit 1`);
  const x = r.rows[0];
  return x?.external_id ? { name: x.name ?? 'me', org62Id: x.external_id } : null;
}

export interface MirrorWrite {
  rows: Org62Sfr[];
  /** Record Id → newest ForecastNotes__c change; null = the history read failed (keep what the mirror had). */
  history: Map<string, string> | null;
  /** Every page was read: records no longer listed are marked gone. */
  complete: boolean;
  readAt: string;
}

export interface MirrorResult {
  inserted: number;
  updated: number;
  gone: number;
  linked: number;
}

/** The local opp and account each record belongs to (by Org62 id; 15-character compare). */
async function links(db: DbOrTx, userId: string) {
  const opps = await db.select({ id: opportunities.id, accountId: opportunities.accountId, org62: opportunities.org62OpportunityId }).from(opportunities).where(eq(opportunities.ownerUserId, userId));
  const accs = await db.select({ id: accounts.id, org62: accounts.org62AccountId }).from(accounts).where(eq(accounts.ownerUserId, userId));
  const oppBy = new Map(opps.filter((o) => o.org62 && !o.org62.startsWith('cc:')).map((o) => [id15(o.org62), o] as const));
  const accBy = new Map(accs.filter((a) => a.org62).map((a) => [id15(a.org62), a.id] as const));
  return (r: Org62Sfr) => {
    const o = r.org62OpportunityId ? oppBy.get(id15(r.org62OpportunityId)) : undefined;
    const accountId = o?.accountId ?? (r.org62AccountId ? (accBy.get(id15(r.org62AccountId)) ?? null) : null);
    return { opportunityId: o?.id ?? null, accountId };
  };
}

/** Upsert one read into the mirror (idempotent; `pending` untouched; the previous note kept when the note changed). */
export async function saveForecastMirror(db: Db, userId: string, w: MirrorWrite): Promise<MirrorResult> {
  const link = await links(db, userId);
  const readAt = new Date(w.readAt);
  const existing = new Set((await db.select({ id: specialistForecasts.org62Id }).from(specialistForecasts).where(eq(specialistForecasts.ownerUserId, userId))).map((r) => r.id));
  let inserted = 0;
  let linked = 0;
  const seen: string[] = [];
  for (const r of w.rows) {
    const l = link(r);
    if (l.opportunityId) linked += 1;
    seen.push(r.org62Id);
    const values = {
      ownerUserId: userId,
      org62Id: r.org62Id,
      name: r.name,
      url: org62RecordUrl('SpecialistForecast__c', r.org62Id),
      org62OpportunityId: r.org62OpportunityId,
      opportunityId: l.opportunityId,
      accountId: l.accountId,
      opportunityName: r.opportunityName,
      accountName: r.accountName,
      oppStage: r.oppStage,
      oppNextStep: r.oppNextStep,
      oppCloseDate: r.oppCloseDate,
      notes: r.notes,
      mgrNotes: r.mgrNotes,
      dealRole: r.dealRole,
      judgement: r.judgement,
      forecastStatus: r.forecastStatus,
      amount: r.amount,
      stage: r.stage,
      closeDate: r.closeDate,
      fiscalQuarter: r.fiscalQuarter,
      ownerOrg62Id: r.ownerOrg62Id,
      lastModifiedAt: r.lastModifiedAt ? new Date(r.lastModifiedAt) : null,
      notesUpdatedAt: w.history ? (w.history.get(r.org62Id) ? new Date(w.history.get(r.org62Id)!) : null) : null,
      syncedAt: readAt,
      goneAt: null,
    };
    if (!existing.has(r.org62Id)) inserted += 1;
    const t = specialistForecasts;
    await db
      .insert(t)
      .values(values)
      .onConflictDoUpdate({
        target: [t.ownerUserId, t.org62Id],
        set: {
          name: values.name,
          url: values.url,
          org62OpportunityId: values.org62OpportunityId,
          opportunityId: values.opportunityId,
          accountId: values.accountId,
          opportunityName: values.opportunityName,
          accountName: values.accountName,
          oppStage: values.oppStage,
          oppNextStep: values.oppNextStep,
          oppCloseDate: values.oppCloseDate,
          // the note before this read's, when it changed (History keeps no long-text values)
          prevNotes: sql`case when ${t.notes} is distinct from excluded.notes then ${t.notes} else ${t.prevNotes} end`,
          notes: values.notes,
          mgrNotes: values.mgrNotes,
          dealRole: values.dealRole,
          judgement: values.judgement,
          forecastStatus: values.forecastStatus,
          amount: values.amount,
          stage: values.stage,
          closeDate: values.closeDate,
          fiscalQuarter: values.fiscalQuarter,
          ownerOrg62Id: values.ownerOrg62Id,
          lastModifiedAt: values.lastModifiedAt,
          notesUpdatedAt: w.history ? values.notesUpdatedAt : sql`${t.notesUpdatedAt}`,
          syncedAt: readAt,
          goneAt: null,
        },
      });
  }
  let gone = 0;
  if (w.complete) {
    const where = and(eq(specialistForecasts.ownerUserId, userId), isNull(specialistForecasts.goneAt), seen.length ? notInArray(specialistForecasts.org62Id, seen) : sql`true`);
    const res = await db.update(specialistForecasts).set({ goneAt: readAt }).where(where).returning({ id: specialistForecasts.id });
    gone = res.length;
  }
  return { inserted, updated: w.rows.length - inserted, gone, linked };
}

/**
 * The latest full `forecast.sync` job and the last one that finished well. One-opp checks ("I created it, check
 * now") are not full reads: they never set "Syncing…" or the last read. A full read scheduled for later (the one after
 * a check) is `nextAt`, not "queued".
 */
export async function forecastSyncState(db: DbOrTx, userId: string): Promise<ForecastSyncState> {
  const full = sql`coalesce(payload->>'scope', '') <> ${FORECAST_CHECK_SCOPE}`;
  const r = await db.execute<{ status: string; finished_at: Date | string | null; result: Record<string, unknown> | null; last_error_code: string | null; ok_at: Date | string | null; next_at: Date | string | null; n: string }>(sql`
    select j.status, j.finished_at, j.result, j.last_error_code,
           (select max(finished_at) from jobs k where k.owner_user_id = ${userId} and k.kind = ${FORECAST_SYNC_JOB} and k.status = 'succeeded'
              and coalesce(k.result->>'skipped', '') = '' and coalesce(k.payload->>'scope', '') <> ${FORECAST_CHECK_SCOPE}) as ok_at,
           (select min(run_at) from jobs f where f.owner_user_id = ${userId} and f.kind = ${FORECAST_SYNC_JOB} and f.status = 'queued' and f.run_at > now()
              and coalesce(f.payload->>'scope', '') <> ${FORECAST_CHECK_SCOPE}) as next_at,
           (select count(*) from specialist_forecasts s where s.owner_user_id = ${userId} and s.gone_at is null) as n
      from jobs j where j.owner_user_id = ${userId} and j.kind = ${FORECAST_SYNC_JOB} and ${full} and not (j.status = 'queued' and j.run_at > now())
     order by j.created_at desc, j.id desc limit 1`);
  const x = r.rows[0];
  const nextAt = x ? iso(x.next_at) : iso((await db.execute<{ at: Date | string | null }>(sql`select min(run_at) as at from jobs where owner_user_id = ${userId} and kind = ${FORECAST_SYNC_JOB} and status = 'queued' and run_at > now() and ${full}`)).rows[0]?.at);
  const records = x ? Number(x.n) : Number((await db.execute<{ n: string }>(sql`select count(*) as n from specialist_forecasts where owner_user_id = ${userId} and gone_at is null`)).rows[0]?.n ?? 0);
  if (!x) return { status: 'never', lastAt: null, note: null, records, nextAt };
  const lastAt = iso(x.ok_at);
  const res = x.result ?? {};
  const note = typeof res.note === 'string' ? res.note : null;
  if (x.status === 'queued' || x.status === 'running') return { status: x.status, lastAt, note: null, records, nextAt };
  if (x.status === 'succeeded') return { status: typeof res.skipped === 'string' ? 'skipped' : res.partial ? 'partial' : 'ok', lastAt, note, records, nextAt };
  return { status: 'failed', lastAt, note: x.last_error_code ? `The last read did not finish (${x.last_error_code})` : 'The last read did not finish', records, nextAt };
}

/** "I created it, check now" checks of the last 24 hours, the latest per opp (counts and codes only, never names). */
export async function forecastChecks(db: DbOrTx, userId: string): Promise<ForecastCheckInput[]> {
  const r = await db.execute<{ opp: string | null; status: string; created_at: Date | string; finished_at: Date | string | null; result: Record<string, unknown> | null; last_error_code: string | null }>(sql`
    select distinct on (payload->>'opportunityId') payload->>'opportunityId' as opp, status, created_at, finished_at, result, last_error_code
      from jobs
     where owner_user_id = ${userId} and kind = ${FORECAST_SYNC_JOB} and payload->>'scope' = ${FORECAST_CHECK_SCOPE}
       and created_at > now() - interval '24 hours'
     order by payload->>'opportunityId', created_at desc, id desc`);
  return r.rows
    .filter((x): x is typeof x & { opp: string } => !!x.opp)
    .map((x) => {
      const res = x.result ?? {};
      const skipped = x.status === 'succeeded' && typeof res.skipped === 'string';
      const status: ForecastCheckInput['status'] = x.status === 'queued' || x.status === 'running' ? x.status : x.status === 'succeeded' ? (skipped ? 'skipped' : 'succeeded') : 'failed';
      const note = skipped ? (typeof res.note === 'string' ? res.note : 'The check could not run') : status === 'failed' ? (x.last_error_code ? `The read did not finish (${x.last_error_code})` : 'The read did not finish') : null;
      return { opportunityId: x.opp, status, askedAt: iso(x.created_at)!, finishedAt: iso(x.finished_at), note };
    });
}

/** Record ids with a draft run queued or running. */
export async function runningDraftIds(db: DbOrTx, userId: string): Promise<string[]> {
  const r = await db.execute<{ id: string | null }>(sql`
    select distinct payload->>'recordId' as id from jobs
     where owner_user_id = ${userId} and kind = ${FORECAST_DRAFT_JOB} and status in ('queued', 'running')`);
  return r.rows.map((x) => x.id).filter((x): x is string => !!x);
}
