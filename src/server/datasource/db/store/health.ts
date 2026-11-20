/**
 * Health: connectors, scan runs, jobs, the event log (app_events) and the spend projection.
 *
 * connectors: source → kind · label → name · state → status (+ override) · since → status_changed_at ·
 *   impact → status_reason · lastSuccessAt · lastError → last_error_at / last_error_code (class) /
 *   consecutive_failures (count) · reauth + affects → config (connector config jsonb).
 *   Ext: cursor label, backlog, itemsToday, catchUpPct, lastError message.
 * scan_runs: connector_id · scope · kind → trigger/mode · status (+ error_code for the failure class) ·
 *   window · started/finished · items seen/new/updated · cost_usd · model → model_tier · error_message.
 * jobs: type → kind · status ('retrying' = queued after a failure) · attempts/max_attempts · run_at ·
 *   started/finished · dedupe_key · generation · entity → payload.entity · error → last_error.
 * app_events: level → severity · source → component · code · message · count → occurrence_count ·
 *   at/lastSeenAt → first/last_occurred_at · acknowledgedAt → acknowledged_at · suggestedAction → detail.
 * Spend: a live database reads the LLM ledger (llm_calls, written by the scanner and chat); a seeded one
 *   keeps the projection under `cc.spend` (loadSpend).
 */
import { vdpRefreshCommand } from '@/contract';
import { reauthWithCommand } from '@/server/datasource/reauth-command';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';

import type { Connector, EventLogEntry, Job, ScanRun, SpendSummary } from '@/contract';
import { budgetsForDay, type BudgetDayOverride } from '@/contract';
import { appEvents, connectors, jobs, scanRuns, sourceItems } from '@/db/schema';
import { zonedToMs } from '@/engines/activity/time';

import { applyOverride, connStateFromDb, connStateToDb, jobStatusFromDb, jobStatusToDb, overrideIfLossy, scanKindFromDb, scanKindToDb, scanStatusFromDb, scanStatusToDb, sourceFromDb, sourceToDb, type DbConnectorStatus, type Override } from '../enums';
import { applyCatchUp, readCatchUpFile } from '../catch-up';
import { bigintFor, uuidFor } from '../ids';
import { extKey } from '../ext';
import { ext, iso, isoReq, localDay, orderedAt, toDate, updateRow, writeExt, writeKv, type ReadCtx, type WriteCtx } from './common';

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

interface ConnectorExt {
  state: Override<Connector['state'], DbConnectorStatus>;
  cursor: Connector['cursor'];
  backlog: number;
  itemsToday: number;
  catchUpPct: number;
  lastErrorMessage: string;
}

const TRANSPORT: Record<Connector['source'], 'mcp_http' | 'local_api' | 'local_files' | 'cli'> = {
  slack: 'mcp_http',
  gmail: 'cli',
  calendar: 'cli',
  drive: 'cli',
  gemini: 'cli',
  org62: 'mcp_http',
  vdp: 'mcp_http',
  claude: 'local_files',
  manual: 'local_api',
};

/**
 * Re-auth affordance per source (OPS.md "Re-auth"), for rows without one in config: the scanner registers its
 * connectors with only a display label, and Health still needs the button.
 */
export const DEFAULT_REAUTH: Partial<Record<Connector['source'], NonNullable<Connector['reauth']>>> = {
  slack: { kind: 'terminal_command', label: 'Re-auth Slack', command: 'claude mcp login slack', instructions: 'Or in any Claude session: /mcp → slack → Authenticate' },
  org62: { kind: 'terminal_command', label: 'Re-auth Org62', command: 'claude mcp login Org62-Sobject-Read', instructions: 'Or in any Claude session: /mcp → Org62-Sobject-Read → Authenticate' },
  gmail: { kind: 'in_app', label: 'Reconnect Google', command: 'devbar mcpgw connectors connect google-workspace-readonly', instructions: null },
  calendar: { kind: 'in_app', label: 'Reconnect Google', command: 'devbar mcpgw connectors connect google-workspace-readonly', instructions: null },
  drive: { kind: 'in_app', label: 'Reconnect Google', command: 'devbar mcpgw connectors connect google-workspace-readonly', instructions: null },
  gemini: { kind: 'in_app', label: 'Reconnect Google', command: 'devbar mcpgw connectors connect google-workspace-readonly', instructions: null },
  vdp: { kind: 'refresh_script', label: 'Re-auth VDP', command: vdpRefreshCommand(null), instructions: 'Needs the Salesforce network; MFA may open a window' },
};

type ErrorClass = NonNullable<Connector['lastError']>['class'];
const ERROR_CLASSES = new Set<string>(['auth', 'transient', 'rate_limited', 'bug', 'offline']);
/** connectors.last_error_code → the contract class. The scanner also writes `config` (a fix is needed) and `unknown`. */
export function errorClassFromDb(code: string): ErrorClass {
  if (ERROR_CLASSES.has(code)) return code as ErrorClass;
  return code === 'config' ? 'bug' : 'transient';
}

/** VDP's re-auth row with the configured refresh command (Settings ▸ Sources), else the default. */
export function reauthOf(source: Connector['source'], configured: Connector['reauth'] | undefined, vdpCommand: string | undefined): Connector['reauth'] {
  return reauthWithCommand(source, configured ?? DEFAULT_REAUTH[source] ?? null, vdpCommand);
}

export async function loadConnectors(rc: ReadCtx, opts: { vdpCommand?: string } = {}): Promise<Connector[]> {
  const rows = await rc.db.select().from(connectors).where(eq(connectors.ownerUserId, rc.userId)).orderBy(asc(connectors.createdAt), asc(connectors.id));
  // rows the scanner registered carry no ext record: items today come from the source items it wrote
  const bare = rows.filter((r) => !rc.kv.has(extKey('connectors', r.id))).map((r) => r.id);
  const today = new Map<string, number>();
  if (bare.length) {
    const midnight = new Date(zonedToMs(localDay(rc.now, rc.timezone), '00:00', rc.timezone));
    const res = await rc.db
      .select({ id: sourceItems.connectorId, n: sql<number>`count(*)::int` })
      .from(sourceItems)
      .where(and(eq(sourceItems.ownerUserId, rc.userId), gte(sourceItems.firstSeenAt, midnight), inArray(sourceItems.connectorId, bare)))
      .groupBy(sourceItems.connectorId);
    for (const r of res) if (r.id) today.set(r.id, Number(r.n));
  }
  const list = rows.map((r) => {
    const x = ext<ConnectorExt>(rc, 'connectors', r.id);
    const cfg = r.config as { reauth?: Connector['reauth']; affects?: string[]; label?: string };
    // the scanner registers its rows as (kind, name = connector id) with the display label in config (WIRE)
    const label = typeof cfg.label === 'string' && cfg.label ? cfg.label : r.name;
    const source = sourceFromDb(r.kind);
    return {
      id: r.id,
      label,
      source,
      state: applyOverride(r.status, connStateFromDb(r.status), x.state),
      since: isoReq(r.statusChangedAt),
      lastSuccessAt: iso(r.lastSuccessAt),
      cursor: x.cursor ?? { label, at: iso(r.lastSuccessAt) },
      backlog: x.backlog ?? 0,
      itemsToday: x.itemsToday ?? today.get(r.id) ?? 0,
      catchUpPct: x.catchUpPct ?? null,
      // STAT-1: the scanner writes its plain reason to status_reason; Settings reads lastError.message for broken connectors.
      lastError: r.lastErrorAt && r.lastErrorCode ? { class: errorClassFromDb(r.lastErrorCode), message: x.lastErrorMessage || r.statusReason || '', at: isoReq(r.lastErrorAt), count: r.consecutiveFailures } : null,
      impact: r.statusReason,
      reauth: reauthOf(source, cfg.reauth, opts.vdpCommand),
      affects: cfg.affects ?? [],
    };
  });
  // B-079: the worker's catch-up progress (a first scan, a wake backlog) over the healthy ones: Health, pulse, Today
  return applyCatchUp(list, rows.map((r) => [r.name, r.kind] as const), readCatchUpFile(), rc.now);
}

function connectorColumns(c: Connector) {
  return {
    kind: sourceToDb(c.source),
    name: c.label,
    status: connStateToDb(c.state),
    statusReason: c.impact,
    statusChangedAt: new Date(c.since),
    lastSuccessAt: toDate(c.lastSuccessAt),
    lastErrorAt: toDate(c.lastError?.at),
    lastErrorCode: c.lastError?.class ?? null,
    consecutiveFailures: c.lastError?.count ?? 0,
    config: { reauth: c.reauth, affects: c.affects } as Record<string, unknown>,
  };
}

function connectorExt(c: Connector): Record<string, unknown> {
  const status = connStateToDb(c.state);
  return {
    state: overrideIfLossy(c.state, status, connStateFromDb) ?? undefined,
    cursor: c.cursor,
    backlog: c.backlog || undefined,
    itemsToday: c.itemsToday || undefined,
    catchUpPct: c.catchUpPct ?? undefined,
    lastErrorMessage: c.lastError?.message,
  };
}

export async function insertConnector(w: WriteCtx, c: Connector, createdAt?: Date): Promise<string> {
  const id = uuidFor(c.id);
  await w.tx.insert(connectors).values({ id, ownerUserId: w.userId, transport: TRANSPORT[c.source], ...connectorColumns(c), ...(createdAt ? { createdAt } : {}) });
  await writeExt(w, 'connectors', id, connectorExt(c));
  return id;
}

export async function updateConnector(w: WriteCtx, cur: Connector, next: Connector) {
  const a = connectorColumns(cur);
  const b = connectorColumns(next);
  const patch: Record<string, unknown> = {};
  // never rename: the scanner finds its row by (kind, name), and the label it shows may live in config
  for (const k of Object.keys(b) as (keyof typeof b)[]) if (k !== 'name' && JSON.stringify(a[k]) !== JSON.stringify(b[k])) patch[k] = b[k];
  if (patch.config) {
    const [row] = await w.tx.select({ config: connectors.config }).from(connectors).where(eq(connectors.id, uuidFor(cur.id)));
    patch.config = { ...(row?.config ?? {}), ...b.config }; // keep keys the contract has no field for (label)
  }
  await updateRow(w, connectors, uuidFor(cur.id), patch, { bump: false });
  await writeExt(w, 'connectors', uuidFor(cur.id), connectorExt(next));
}

// ---------------------------------------------------------------------------
// Scan runs
// ---------------------------------------------------------------------------

export async function loadScanRuns(rc: Pick<ReadCtx, 'db' | 'userId'>): Promise<ScanRun[]> {
  const rows = await rc.db.select().from(scanRuns).where(eq(scanRuns.ownerUserId, rc.userId)).orderBy(desc(scanRuns.startedAt), asc(scanRuns.createdAt), asc(scanRuns.id));
  return rows.map((r) => ({
    id: r.id,
    connectorId: r.connectorId,
    scope: r.scope ?? 'default',
    kind: scanKindFromDb(r.trigger, r.mode),
    windowStart: isoReq(r.windowStart ?? r.createdAt),
    windowEnd: isoReq(r.windowEnd ?? r.createdAt),
    status: scanStatusFromDb(r.status, r.errorCode),
    startedAt: isoReq(r.startedAt ?? r.createdAt),
    endedAt: iso(r.finishedAt),
    itemsSeen: r.itemsSeen,
    itemsNew: r.itemsNew,
    itemsChanged: r.itemsUpdated,
    costUsd: r.costUsd,
    model: r.modelTier === 'none' ? null : r.modelTier,
    error: r.errorMessage,
  }));
}

export async function insertScanRun(w: WriteCtx, s: ScanRun, opts: { ordinal?: number } = {}): Promise<string> {
  const id = uuidFor(s.id);
  const k = scanKindToDb(s.kind);
  const st = scanStatusToDb(s.status);
  const tier = s.model === 'haiku' || s.model === 'sonnet' || s.model === 'opus' ? s.model : 'none';
  await w.tx.insert(scanRuns).values({
    id,
    ownerUserId: w.userId,
    connectorId: uuidFor(s.connectorId),
    scope: s.scope,
    trigger: k.trigger,
    mode: k.mode,
    status: st.status,
    errorCode: st.errorCode,
    windowStart: toDate(s.windowStart),
    windowEnd: toDate(s.windowEnd),
    startedAt: toDate(s.startedAt),
    finishedAt: toDate(s.endedAt),
    itemsSeen: s.itemsSeen,
    itemsNew: s.itemsNew,
    itemsUpdated: s.itemsChanged,
    costUsd: s.costUsd,
    modelTier: tier,
    errorMessage: s.error,
    createdAt: orderedAt(opts.ordinal, s.startedAt),
  });
  return id;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/** MIN-28: how many succeeded (and how many cancelled) jobs Health ▸ Jobs lists; `counts` keeps the full totals. */
export const JOBS_FINISHED_LIMIT = 50;

/**
 * Jobs, newest first. `finishedLimit` (Health ▸ Jobs, MIN-28) keeps queued, running, retrying and dead jobs whole
 * but only the latest `finishedLimit` succeeded and cancelled ones, plus each kind's newest of those (the connector
 * panel reads its source's last job). Without it (the read model: a retry, a manual scan) every job loads.
 */
export async function loadJobs(rc: Pick<ReadCtx, 'db' | 'userId'>, opts: { finishedLimit?: number } = {}): Promise<Job[]> {
  const mine = eq(jobs.ownerUserId, rc.userId);
  const where =
    opts.finishedLimit === undefined
      ? mine
      : and(
          mine,
          sql`${jobs.id} in (
            select x.id from (
              select j.id, j.status,
                     row_number() over (partition by j.status order by coalesce(j.finished_at, j.run_at) desc, j.id desc) as rs,
                     row_number() over (partition by j.status, j.kind order by coalesce(j.finished_at, j.run_at) desc, j.id desc) as rk
                from jobs j where j.owner_user_id = ${rc.userId}) x
             where x.status not in ('succeeded', 'cancelled') or x.rs <= ${opts.finishedLimit} or x.rk = 1)`,
        );
  // PERF-1: the columns Job maps, and of the payload (a scan job's whole spec) only the three fields it reads
  const rows = await rc.db
    .select({
      id: jobs.id,
      kind: jobs.kind,
      status: jobs.status,
      attempts: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
      lastFailedAt: jobs.lastFailedAt,
      runAt: jobs.runAt,
      startedAt: jobs.startedAt,
      finishedAt: jobs.finishedAt,
      dedupeKey: jobs.dedupeKey,
      generation: jobs.generation,
      lastError: jobs.lastError,
      payload: sql<{ entity?: Job['entity']; workItemId?: string; label?: string }>`jsonb_build_object('entity', ${jobs.payload} -> 'entity', 'workItemId', ${jobs.payload} -> 'workItemId', 'label', ${jobs.payload} -> 'label')`,
    })
    .from(jobs)
    .where(where)
    .orderBy(desc(jobs.runAt), asc(jobs.createdAt), asc(jobs.id));
  return rows.map((r) => {
    const p = r.payload;
    return {
      id: String(r.id),
      type: r.kind,
      status: jobStatusFromDb(r.status, r.attempts, r.lastFailedAt),
      attempts: r.attempts,
      maxAttempts: r.maxAttempts,
      runAt: isoReq(r.runAt),
      startedAt: iso(r.startedAt),
      finishedAt: iso(r.finishedAt),
      dedupeKey: r.dedupeKey,
      generation: r.generation,
      entity: p.entity ?? (p.workItemId ? { type: 'work_item', id: p.workItemId, label: p.label ?? p.workItemId } : null),
      error: r.lastError,
    };
  });
}

/** MIN-28: every job counted by its contract status (retrying = queued after a failure, as jobStatusFromDb). */
export async function countJobs(rc: Pick<ReadCtx, 'db' | 'userId'>): Promise<Record<Job['status'], number>> {
  const counts: Record<Job['status'], number> = { queued: 0, running: 0, retrying: 0, succeeded: 0, dead: 0, cancelled: 0 };
  const r = await rc.db.execute<{ s: Job['status']; n: number }>(sql`
    select case when status = 'queued' and attempts > 0 and last_failed_at is not null then 'retrying' else status::text end as s, count(*)::int as n
      from jobs where owner_user_id = ${rc.userId} group by 1`);
  for (const row of r.rows) if (row.s in counts) counts[row.s] = row.n;
  return counts;
}

/** `ordinal` keeps the seed's order among jobs that share a run_at (created_at is bookkeeping here). */
export async function insertJob(w: WriteCtx, j: Job, ordinal = 0): Promise<number> {
  const id = /^\d+$/.test(j.id) ? Number(j.id) : bigintFor(j.id);
  const status = jobStatusToDb(j.status);
  const failed = j.status === 'retrying' || j.status === 'dead' || (j.error !== null && j.status !== 'succeeded');
  await w.tx.insert(jobs).values({
    id,
    ownerUserId: w.userId,
    kind: j.type,
    payload: j.entity ? { entity: j.entity } : {},
    status,
    runAt: new Date(j.runAt),
    attempts: Math.min(j.attempts, j.maxAttempts),
    maxAttempts: j.maxAttempts,
    startedAt: toDate(j.startedAt),
    finishedAt: toDate(j.finishedAt),
    dedupeKey: j.dedupeKey,
    generation: j.generation,
    lastError: j.error,
    lastFailedAt: failed ? toDate(j.finishedAt ?? j.startedAt ?? j.runAt) : null,
    lastErrorClass: failed ? 'transient' : null,
    deadAt: status === 'dead' ? toDate(j.finishedAt ?? j.runAt) : null,
    deadReason: status === 'dead' ? (j.error ?? 'exhausted') : null,
    lockedBy: status === 'running' ? 'cc-seed' : null,
    lockedAt: status === 'running' ? toDate(j.startedAt ?? j.runAt) : null,
    leaseExpiresAt: status === 'running' ? new Date(Date.parse(j.startedAt ?? j.runAt) + 10 * 60_000) : null,
    createdAt: new Date(Date.parse(j.runAt) + ordinal),
  });
  return id;
}

/** Requeue (POST /jobs/:id/retry): queued now, attempts reset, error cleared. jobs is not audited. */
export async function requeueJob(w: WriteCtx, id: string) {
  await w.tx
    .update(jobs)
    .set({ status: 'queued', attempts: 0, lastError: null, lastFailedAt: null, lastErrorClass: null, deadAt: null, deadReason: null, finishedAt: null, runAt: w.now, lockedBy: null, lockedAt: null, leaseExpiresAt: null, cancelRequestedAt: null, updatedAt: w.now })
    .where(and(eq(jobs.id, Number(id)), eq(jobs.ownerUserId, w.userId)));
}

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

export async function loadEventLog(rc: ReadCtx): Promise<EventLogEntry[]> {
  const rows = await rc.db.select().from(appEvents).where(eq(appEvents.ownerUserId, rc.userId)).orderBy(desc(appEvents.lastOccurredAt), asc(appEvents.id));
  return rows.map((r) => {
    const d = r.detail as { suggestedAction?: string | null };
    return {
      id: String(r.id),
      at: isoReq(r.firstOccurredAt),
      level: r.severity === 'error' || r.severity === 'critical' ? 'error' : r.severity === 'warn' ? 'warn' : 'info',
      source: r.component,
      code: r.code,
      message: r.message,
      count: r.occurrenceCount,
      lastSeenAt: isoReq(r.lastOccurredAt),
      suggestedAction: d.suggestedAction ?? null,
      acknowledged: r.acknowledgedAt !== null,
      acknowledgedAt: iso(r.acknowledgedAt),
    };
  });
}

export async function insertEvent(w: WriteCtx, e: EventLogEntry, connectorIdByKind: Map<string, string>): Promise<number> {
  const id = /^\d+$/.test(e.id) ? Number(e.id) : bigintFor(e.id);
  await w.tx.insert(appEvents).values({
    id,
    ownerUserId: w.userId,
    severity: e.level,
    component: e.source,
    code: e.code,
    message: e.message,
    connectorId: connectorIdByKind.get(e.source) ?? null,
    detail: { suggestedAction: e.suggestedAction },
    fingerprint: `${e.source}:${e.code}:${id}`,
    occurrenceCount: e.count,
    firstOccurredAt: new Date(e.at),
    lastOccurredAt: new Date(e.lastSeenAt),
    acknowledgedAt: toDate(e.acknowledgedAt),
  });
  return id;
}

export async function ackEvent(w: WriteCtx, id: string) {
  await w.tx.update(appEvents).set({ acknowledgedAt: w.now, seenAt: w.now }).where(and(eq(appEvents.id, Number(id)), eq(appEvents.ownerUserId, w.userId)));
}

export async function eventsByIds(rc: Pick<ReadCtx, 'db' | 'userId'>, ids: number[]) {
  return rc.db.select().from(appEvents).where(and(eq(appEvents.ownerUserId, rc.userId), inArray(appEvents.id, ids)));
}

// ---------------------------------------------------------------------------
// Spend projection
// ---------------------------------------------------------------------------

export const SPEND_KEY = 'cc.spend';
export async function writeSpend(w: WriteCtx, s: SpendSummary) {
  await writeKv(w, SPEND_KEY, s);
}
export function readSpend(rc: { kv: Map<string, unknown> }): SpendSummary {
  return (rc.kv.get(SPEND_KEY) as SpendSummary | undefined) ?? { today: { usd: 0, softBudgetUsd: 0, hardCapUsd: 0, pct: 0 }, state: 'ok', last7d: [], byScanner: [], byModel: [] };
}

const DAY_MS = 86_400_000;
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
/** llm_calls purpose (+ skill) → the Health spend line ("slack", "gmail", "nba", "chat", "briefs", …). */
function spendLine(purpose: string, skill: string | null): string {
  if (purpose === 'scan_extract') return skill ? skill.replace(/^scan-/, '') : 'scanner';
  if (purpose === 'nba_generate') return 'nba';
  if (purpose === 'chat') return 'chat';
  if (skill?.startsWith('readin')) return 'readin';
  return skill ?? (purpose === 'summarize' ? 'briefs' : purpose);
}

/**
 * Health spend. A live (bootstrapped) database reads the LLM ledger, `llm_calls`, which the scanner and chat
 * write: today in the user's zone, the last 7 days, today by scanner and by model, against the Settings budgets.
 * BUD-1: the daily budget's spend only. The one-time first-scan spend is on Health's First scan card, never "of $5 today".
 * A seeded database keeps its `cc.spend` projection (parity with the mock; seeds carry no ledger).
 */
export async function loadSpend(rc: Pick<ReadCtx, 'db' | 'userId' | 'kv' | 'timezone' | 'now'>, budgets0: { softUsd: number; hardUsd: number; alertPct: number; today?: BudgetDayOverride | null }, seeded: boolean): Promise<SpendSummary> {
  const projection = rc.kv.get(SPEND_KEY) as SpendSummary | undefined;
  if (seeded && projection) return projection;
  const days = Array.from({ length: 7 }, (_, i) => localDay(new Date(rc.now.getTime() - (6 - i) * DAY_MS), rc.timezone));
  const today = days[6]!;
  const budgets = budgetsForDay(budgets0, today);
  const res = await rc.db.execute<{ day: string; purpose: string; skill: string | null; tier: string; model: string; usd: number }>(sql`
    select budget_day::text as day, purpose::text as purpose, skill_key as skill, model_tier::text as tier, model, sum(cost_usd)::float8 as usd
      from llm_calls
     where owner_user_id = ${rc.userId} and budget_day between ${days[0]}::date and ${today}::date and budget = 'daily'
     group by 1, 2, 3, 4, 5`);
  const byDay = new Map<string, number>();
  const byLine = new Map<string, number>();
  const byModel = new Map<string, number>();
  for (const r of res.rows) {
    const usd = Number(r.usd) || 0;
    byDay.set(r.day, (byDay.get(r.day) ?? 0) + usd);
    if (r.day !== today || usd <= 0) continue;
    const line = spendLine(r.purpose, r.skill);
    byLine.set(line, (byLine.get(line) ?? 0) + usd);
    const model = r.tier && r.tier !== 'none' ? r.tier : r.model;
    byModel.set(model, (byModel.get(model) ?? 0) + usd);
  }
  const usd = round4(byDay.get(today) ?? 0);
  const pct = budgets.softUsd > 0 ? Math.round((usd / budgets.softUsd) * 100) : 0;
  const sorted = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    today: { usd, softBudgetUsd: budgets.softUsd, hardCapUsd: budgets.hardUsd, pct },
    state: budgets.hardUsd > 0 && usd >= budgets.hardUsd ? 'capped' : pct >= budgets.alertPct ? 'soft_alert' : 'ok',
    last7d: days.map((day) => ({ day, usd: round4(byDay.get(day) ?? 0) })),
    byScanner: sorted(byLine).map(([name, v]) => ({ name, usd: round4(v) })),
    byModel: sorted(byModel).map(([model, v]) => ({ model, usd: round4(v) })),
  };
}

export { ext };
