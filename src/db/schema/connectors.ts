/** Connectors, health checks, auth events and re-auth attempts (section 2; R-UI-12). */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstz, createdAt, updatedAt, ownerUserId, textArray } from './columns';
import {
  sourceSystem,
  actorKind,
  connectorTransport,
  connectorStatus,
  authEventKind,
  reauthMethod,
  reauthStatus,
} from './enums';
import { jobs } from './jobs';

export const connectors = pgTable(
  'connectors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    kind: sourceSystem('kind').notNull(),
    name: text('name').notNull(),
    transport: connectorTransport('transport').notNull(),
    /** Non-secret config only (profile name, watch scopes). Never tokens (invariant 3). */
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    /** MCP read-tool allowlist enforced by the client wrapper (invariant 2). */
    readToolAllowlist: textArray('read_tool_allowlist'),
    enabled: boolean('enabled').notNull().default(true),
    status: connectorStatus('status').notNull().default('healthy'),
    statusReason: text('status_reason'),
    statusChangedAt: tstz('status_changed_at').notNull().defaultNow(),
    lastSuccessAt: tstz('last_success_at'),
    lastErrorAt: tstz('last_error_at'),
    lastErrorCode: text('last_error_code'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    /** Health turns 'stale' when last_success_at is older than this. */
    staleAfterSeconds: integer('stale_after_seconds').notNull().default(3600),
    /** Known credential expiry (e.g. VDP Okta cookie ~1 h). No secret values. */
    authExpiresAt: tstz('auth_expires_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('connectors_owner_kind_name_uidx').on(t.ownerUserId, t.kind, t.name),
    index('connectors_owner_unhealthy_idx').on(t.ownerUserId).where(sql`${t.status} <> 'healthy'`),
  ],
);

export const connectorHealthChecks = pgTable(
  'connector_health_checks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    connectorId: uuid('connector_id')
      .notNull()
      .references(() => connectors.id, { onDelete: 'cascade' }),
    checkedAt: tstz('checked_at').notNull().defaultNow(),
    ok: boolean('ok').notNull(),
    status: connectorStatus('status').notNull(),
    probe: text('probe').notNull(),
    latencyMs: integer('latency_ms'),
    errorCode: text('error_code'),
    /** Redacted; never bodies or tokens. */
    errorMessage: text('error_message'),
  },
  (t) => [index('connector_health_checks_connector_checked_idx').on(t.connectorId, t.checkedAt.desc())],
);

export const reauthAttempts = pgTable(
  'reauth_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectorId: uuid('connector_id')
      .notNull()
      .references(() => connectors.id, { onDelete: 'cascade' }),
    method: reauthMethod('method').notNull(),
    status: reauthStatus('status').notNull().default('requested'),
    requestedBy: actorKind('requested_by').notNull(),
    requestedAt: tstz('requested_at').notNull().defaultNow(),
    startedAt: tstz('started_at'),
    finishedAt: tstz('finished_at'),
    jobId: bigint('job_id', { mode: 'number' }).references((): AnyPgColumn => jobs.id, { onDelete: 'set null' }),
    /** What the user must do (e.g. "complete Okta MFA in the opened window"). */
    userInstruction: text('user_instruction'),
    errorCode: text('error_code'),
  },
  (t) => [index('reauth_attempts_connector_requested_idx').on(t.connectorId, t.requestedAt.desc())],
);

export const connectorAuthEvents = pgTable(
  'connector_auth_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    connectorId: uuid('connector_id')
      .notNull()
      .references(() => connectors.id, { onDelete: 'cascade' }),
    kind: authEventKind('kind').notNull(),
    occurredAt: tstz('occurred_at').notNull().defaultNow(),
    actorKind: actorKind('actor_kind').notNull().default('system'),
    reauthAttemptId: uuid('reauth_attempt_id').references(() => reauthAttempts.id, { onDelete: 'set null' }),
    expiresAt: tstz('expires_at'),
    detail: text('detail'),
  },
  (t) => [index('connector_auth_events_connector_occurred_idx').on(t.connectorId, t.occurredAt.desc())],
);
