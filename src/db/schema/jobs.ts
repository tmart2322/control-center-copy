/** Postgres job queue (FOR UPDATE SKIP LOCKED), schedules and worker heartbeats (section 13; R-BE-4). */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstz, createdAt, updatedAt, ownerUserId } from './columns';
import {
  jobStatus,
  errorClass,
  catchUpPolicy,
} from './enums';
import { connectors } from './connectors';

export const jobs = pgTable(
  'jobs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ownerUserId: ownerUserId(),
    queue: text('queue').notNull().default('default'),
    /** e.g. 'scan.slack.dm', 'nba.generate', 'outbox.send', 'retention.purge'. */
    kind: text('kind').notNull(),
    /** Kind-specific args (zod per kind). */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    status: jobStatus('status').notNull().default('queued'),
    priority: smallint('priority').notNull().default(0),
    /** Visible-at time; retries push it out by the backoff. */
    runAt: tstz('run_at').notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    /** delay = min(max, base * 2^(attempts-1)) + jitter. */
    backoffBaseSeconds: integer('backoff_base_seconds').notNull().default(30),
    backoffMaxSeconds: integer('backoff_max_seconds').notNull().default(3600),
    /** Max run time before the lease is considered lost. */
    timeoutSeconds: integer('timeout_seconds').notNull().default(600),
    lastErrorClass: errorClass('last_error_class'),
    lastFailedAt: tstz('last_failed_at'),
    /** Dead-letter: exhausted attempts or a non-retryable error class. */
    deadAt: tstz('dead_at'),
    deadReason: text('dead_reason'),
    lockedBy: text('locked_by'),
    lockedAt: tstz('locked_at'),
    /** Reclaimable after this (worker died / laptop slept). */
    leaseExpiresAt: tstz('lease_expires_at'),
    heartbeatAt: tstz('heartbeat_at'),
    startedAt: tstz('started_at'),
    finishedAt: tstz('finished_at'),
    /**
     * Coalescing key ('scan:slack:dm', 'reeval:work_item:<id>'). At most one *queued* job per
     * key (bursts merge into it); a key never runs twice concurrently (dequeue skips it).
     */
    dedupeKey: text('dedupe_key'),
    /** Entity generation this job was enqueued for (e.g. work_items.reeval_generation). */
    generation: bigint('generation', { mode: 'number' }),
    /** true: a newer job cancels a running one with the same key (re-eval); false: it waits (scans). */
    supersedesRunning: boolean('supersedes_running').notNull().default(false),
    /** Cooperative cancel: the worker polls/LISTENs and aborts via AbortController. */
    cancelRequestedAt: tstz('cancel_requested_at'),
    cancelReason: text('cancel_reason'),
    supersededById: bigint('superseded_by_id', { mode: 'number' }).references((): AnyPgColumn => jobs.id, {
      onDelete: 'set null',
    }),
    /** Exactly-once enqueue (e.g. 'send:<draftId>:<contentHash>'). */
    idempotencyKey: text('idempotency_key'),
    scheduleId: uuid('schedule_id').references((): AnyPgColumn => jobSchedules.id, { onDelete: 'set null' }),
    parentJobId: bigint('parent_job_id', { mode: 'number' }).references((): AnyPgColumn => jobs.id, {
      onDelete: 'set null',
    }),
    correlationId: uuid('correlation_id'),
    lastErrorCode: text('last_error_code'),
    lastError: text('last_error'),
    result: jsonb('result').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('jobs_dequeue_idx')
      .on(t.queue, t.priority.desc(), t.runAt, t.id)
      .where(sql`${t.status} = 'queued'`),
    index('jobs_lease_idx').on(t.leaseExpiresAt).where(sql`${t.status} = 'running'`),
    uniqueIndex('jobs_dedupe_queued_uidx').on(t.dedupeKey).where(sql`${t.status} = 'queued'`),
    index('jobs_dedupe_running_idx').on(t.dedupeKey).where(sql`${t.status} = 'running'`),
    uniqueIndex('jobs_idempotency_uidx').on(t.idempotencyKey),
    index('jobs_owner_kind_created_idx').on(t.ownerUserId, t.kind, t.createdAt.desc()),
    index('jobs_dead_letter_idx').on(t.ownerUserId, t.deadAt.desc()).where(sql`${t.status} = 'dead'`),
    check('jobs_attempts_chk', sql`${t.attempts} >= 0 AND ${t.attempts} <= ${t.maxAttempts}`),
    check(
      'jobs_running_lease_chk',
      sql`${t.status} <> 'running' OR (${t.lockedBy} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL)`,
    ),
    check('jobs_dead_chk', sql`(${t.status} = 'dead') = (${t.deadAt} IS NOT NULL)`),
    check('jobs_backoff_chk', sql`${t.backoffBaseSeconds} > 0 AND ${t.backoffMaxSeconds} >= ${t.backoffBaseSeconds}`),
  ],
);

export const jobSchedules = pgTable(
  'job_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    key: text('key').notNull(),
    kind: text('kind').notNull(),
    queue: text('queue').notNull().default('default'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    intervalSeconds: integer('interval_seconds'),
    cronExpr: text('cron_expr'),
    timezone: text('timezone').notNull().default('America/Denver'),
    jitterSeconds: integer('jitter_seconds').notNull().default(0),
    catchUp: catchUpPolicy('catch_up').notNull().default('backfill_window'),
    priority: smallint('priority').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    /** Auto-paused while the connector is auth_required (D-39). */
    connectorId: uuid('connector_id').references(() => connectors.id, { onDelete: 'cascade' }),
    pausedReason: text('paused_reason'),
    nextRunAt: tstz('next_run_at').notNull(),
    lastEnqueuedAt: tstz('last_enqueued_at'),
    lastJobId: bigint('last_job_id', { mode: 'number' }).references((): AnyPgColumn => jobs.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('job_schedules_owner_key_uidx').on(t.ownerUserId, t.key),
    index('job_schedules_due_idx').on(t.nextRunAt).where(sql`${t.enabled} AND ${t.pausedReason} IS NULL`),
    check('job_schedules_cadence_chk', sql`num_nonnulls(${t.intervalSeconds}, ${t.cronExpr}) = 1`),
  ],
);

/** Heartbeats: the gap between last beat and next boot is "the app was closed". */
export const workerInstances = pgTable(
  'worker_instances',
  {
    /** host:pid:boot-uuid */
    id: text('id').primaryKey(),
    role: text('role').notNull(),
    hostname: text('hostname').notNull(),
    pid: integer('pid').notNull(),
    appVersion: text('app_version').notNull(),
    startedAt: tstz('started_at').notNull().defaultNow(),
    lastBeatAt: tstz('last_beat_at').notNull().defaultNow(),
    stoppedAt: tstz('stopped_at'),
    stopReason: text('stop_reason'),
  },
  (t) => [index('worker_instances_last_beat_idx').on(t.lastBeatAt.desc())],
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
