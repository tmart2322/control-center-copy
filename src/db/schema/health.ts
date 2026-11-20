/** App event/error log, persistent notifications and the degradation view (section 15b; R-UI-19). */
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  pgView,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstz, createdAt, updatedAt, ownerUserId } from './columns';
import {
  sourceSystem,
  actorKind,
  connectorStatus,
  errorClass,
  severity,
  notificationKind,
  notificationStatus,
} from './enums';
import { users } from './core';
import { connectors } from './connectors';
import { scanRuns } from './scanning';
import { jobs } from './jobs';
import { changeSets } from './audit';

/** App event/error log: ids, codes and timings only, never bodies or tokens. */
export const appEvents = pgTable(
  'app_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    severity: severity('severity').notNull(),
    /** 'worker.scheduler', 'connector.gmail', 'engine.priority', 'outbox.slack', 'web.api', ... */
    component: text('component').notNull(),
    code: text('code').notNull(),
    errorClass: errorClass('error_class'),
    message: text('message').notNull(),
    connectorId: uuid('connector_id').references(() => connectors.id, { onDelete: 'set null' }),
    jobId: bigint('job_id', { mode: 'number' }).references(() => jobs.id, { onDelete: 'set null' }),
    scanRunId: uuid('scan_run_id').references(() => scanRuns.id, { onDelete: 'set null' }),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    /** Structured context (ids, counts, durations). Zod-validated; no free text from sources. */
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    /** component|code|entity: repeats bump occurrence_count instead of adding rows. */
    fingerprint: text('fingerprint').notNull(),
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    firstOccurredAt: tstz('first_occurred_at').notNull().defaultNow(),
    lastOccurredAt: tstz('last_occurred_at').notNull().defaultNow(),
    seenAt: tstz('seen_at'),
    acknowledgedAt: tstz('acknowledged_at'),
    resolvedAt: tstz('resolved_at'),
  },
  (t) => [
    uniqueIndex('app_events_open_fingerprint_uidx').on(t.fingerprint).where(sql`${t.resolvedAt} IS NULL`),
    index('app_events_owner_unacked_idx')
      .on(t.ownerUserId, t.severity, t.lastOccurredAt.desc())
      .where(sql`${t.acknowledgedAt} IS NULL AND ${t.resolvedAt} IS NULL`),
    index('app_events_component_idx').on(t.component, t.lastOccurredAt.desc()),
    index('app_events_entity_idx').on(t.entityType, t.entityId),
  ],
);

/** Anything that must persist until acted on (never toast-only). */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    kind: notificationKind('kind').notNull(),
    severity: severity('severity').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    connectorId: uuid('connector_id').references(() => connectors.id, { onDelete: 'cascade' }),
    appEventId: bigint('app_event_id', { mode: 'number' }).references(() => appEvents.id, { onDelete: 'set null' }),
    jobId: bigint('job_id', { mode: 'number' }).references(() => jobs.id, { onDelete: 'set null' }),
    changeSetId: uuid('change_set_id').references(() => changeSets.id, { onDelete: 'set null' }),
    /** In-app route for the primary action ('/settings/health#gmail'). */
    actionRoute: text('action_route'),
    /** 'reauth', 'retry_job', 'open_draft', 'undo', ... */
    actionKind: text('action_kind'),
    /** One live notification per issue (e.g. 'connector:<id>:auth'). */
    dedupeKey: text('dedupe_key').notNull(),
    status: notificationStatus('status').notNull().default('open'),
    seenAt: tstz('seen_at'),
    snoozedUntil: tstz('snoozed_until'),
    acknowledgedAt: tstz('acknowledged_at'),
    resolvedAt: tstz('resolved_at'),
    resolvedBy: actorKind('resolved_by'),
    expiresAt: tstz('expires_at'),
    osNotifiedAt: tstz('os_notified_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('notifications_live_dedupe_uidx')
      .on(t.ownerUserId, t.dedupeKey)
      .where(sql`${t.status} IN ('open', 'seen', 'snoozed')`),
    index('notifications_owner_live_idx')
      .on(t.ownerUserId, t.severity, t.createdAt.desc())
      .where(sql`${t.status} IN ('open', 'seen', 'snoozed')`),
    check('notifications_snooze_chk', sql`${t.status} <> 'snoozed' OR ${t.snoozedUntil} IS NOT NULL`),
  ],
);

/**
 * Derived: open work items whose state may be stale because a connector they depend on is
 * unhealthy or stale. Defined in 0002_extras.sql; declared here for typed reads.
 */
export const workItemDegradations = pgView('work_item_degradations', {
  workItemId: uuid('work_item_id').notNull(),
  ownerUserId: uuid('owner_user_id').notNull(),
  connectorId: uuid('connector_id').notNull(),
  connectorKind: sourceSystem('connector_kind').notNull(),
  connectorStatus: connectorStatus('connector_status').notNull(),
  dependency: text('dependency').notNull(),
  statusReason: text('status_reason'),
  degradedSince: tstz('degraded_since'),
}).existing();
