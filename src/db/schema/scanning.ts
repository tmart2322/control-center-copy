/** Scanner cursors, runs, coverage ledger and reconcile findings (section 3; R-BE-3, SCANNER.md §5). */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstzrange, tstz, createdAt, updatedAt, ownerUserId, usd } from './columns';
import {
  modelTier,
  cursorKind,
  cursorStatus,
  scanTrigger,
  scanMode,
  runStatus,
  ledgerObjectKind,
  ledgerOutcome,
  reconcileKind,
  reconcileStatus,
} from './enums';
import { connectors } from './connectors';
import { sourceItems } from './sources';
import { workItems } from './work';
import { jobs } from './jobs';
import { chatMessages } from './chat';

export const scanCursors = pgTable(
  'scan_cursors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    connectorId: uuid('connector_id')
      .notNull()
      .references(() => connectors.id, { onDelete: 'cascade' }),
    /** e.g. 'slack:dm', 'slack:channel:C0123', 'gmail:inbox', 'claude:file:<path>'. */
    scope: text('scope').notNull(),
    cursorKind: cursorKind('cursor_kind').notNull(),
    cursorValue: text('cursor_value'),
    /** Composite cursors only (e.g. {historyId, pageToken}). */
    cursorJson: jsonb('cursor_json').$type<Record<string, unknown>>(),
    /** Everything up to here is fully scanned. */
    highWatermarkAt: tstz('high_watermark_at'),
    /** Backfill floor: nothing older is expected. */
    lowWatermarkAt: tstz('low_watermark_at'),
    status: cursorStatus('status').notNull().default('active'),
    lastRunId: uuid('last_run_id').references((): AnyPgColumn => scanRuns.id, { onDelete: 'set null' }),
    lastAdvancedAt: tstz('last_advanced_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('scan_cursors_connector_scope_uidx').on(t.connectorId, t.scope)],
);

export const scanRuns = pgTable(
  'scan_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    connectorId: uuid('connector_id')
      .notNull()
      .references(() => connectors.id, { onDelete: 'cascade' }),
    /** Null when the run covers several scopes; the ledger has per-scope detail. */
    scope: text('scope'),
    trigger: scanTrigger('trigger').notNull(),
    mode: scanMode('mode').notNull(),
    status: runStatus('status').notNull().default('queued'),
    windowStart: tstz('window_start'),
    windowEnd: tstz('window_end'),
    jobId: bigint('job_id', { mode: 'number' }).references((): AnyPgColumn => jobs.id, { onDelete: 'set null' }),
    /** Prescriptive scanner skill (R-BE-2): key + version + content hash. */
    skillKey: text('skill_key'),
    skillVersion: text('skill_version'),
    modelTier: modelTier('model_tier').notNull().default('none'),
    cursorBefore: jsonb('cursor_before').$type<Record<string, unknown>>(),
    cursorAfter: jsonb('cursor_after').$type<Record<string, unknown>>(),
    itemsSeen: integer('items_seen').notNull().default(0),
    itemsNew: integer('items_new').notNull().default(0),
    itemsUpdated: integer('items_updated').notNull().default(0),
    itemsUnchanged: integer('items_unchanged').notNull().default(0),
    itemsSkipped: integer('items_skipped').notNull().default(0),
    linksCreated: integer('links_created').notNull().default(0),
    candidatesCreated: integer('candidates_created').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    /** Denormalized sum of llm_calls.cost_usd for this run. */
    costUsd: usd('cost_usd').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    startedAt: tstz('started_at'),
    finishedAt: tstz('finished_at'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: createdAt(),
  },
  (t) => [
    index('scan_runs_connector_started_idx').on(t.connectorId, t.startedAt.desc()),
    index('scan_runs_owner_started_idx').on(t.ownerUserId, t.startedAt.desc()),
  ],
);

/** What was scanned: object ids and time/token ranges, so misses can be reconciled. */
export const scanLedgerEntries = pgTable(
  'scan_ledger_entries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    scanRunId: uuid('scan_run_id')
      .notNull()
      .references(() => scanRuns.id, { onDelete: 'cascade' }),
    connectorId: uuid('connector_id')
      .notNull()
      .references(() => connectors.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(),
    objectKind: ledgerObjectKind('object_kind').notNull(),
    /** Channel id, thread ts, file path, SOQL hash, calendar id, ... */
    objectExternalId: text('object_external_id'),
    coveredFrom: tstz('covered_from'),
    coveredTo: tstz('covered_to'),
    covered: tstzrange('covered').generatedAlwaysAs(
      sql`CASE WHEN covered_from IS NOT NULL AND covered_to IS NOT NULL THEN tstzrange(covered_from, covered_to, '[)') END`,
    ),
    /** Provider-native range bounds (Slack ts, byte offsets, page tokens). */
    startToken: text('start_token'),
    endToken: text('end_token'),
    itemCount: integer('item_count').notNull().default(0),
    newItemCount: integer('new_item_count').notNull().default(0),
    /** Hash of the returned id set; a changed hash on re-scan means drift. */
    resultHash: text('result_hash'),
    outcome: ledgerOutcome('outcome').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('scan_ledger_entries_scope_from_idx').on(t.connectorId, t.scope, t.coveredFrom),
    index('scan_ledger_entries_object_idx').on(t.objectKind, t.objectExternalId),
    index('scan_ledger_entries_covered_gist_idx').using('gist', t.connectorId, t.scope, t.covered),
    index('scan_ledger_entries_run_idx').on(t.scanRunId),
    check(
      'scan_ledger_entries_range_chk',
      sql`${t.coveredFrom} IS NULL OR ${t.coveredTo} IS NULL OR ${t.coveredTo} >= ${t.coveredFrom}`,
    ),
  ],
);

export const reconcileFindings = pgTable(
  'reconcile_findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    connectorId: uuid('connector_id').references(() => connectors.id, { onDelete: 'cascade' }),
    scanRunId: uuid('scan_run_id').references(() => scanRuns.id, { onDelete: 'set null' }),
    kind: reconcileKind('kind').notNull(),
    scope: text('scope'),
    gapFrom: tstz('gap_from'),
    gapTo: tstz('gap_to'),
    sourceItemId: uuid('source_item_id').references((): AnyPgColumn => sourceItems.id, { onDelete: 'cascade' }),
    workItemId: uuid('work_item_id').references((): AnyPgColumn => workItems.id, { onDelete: 'cascade' }),
    /** Set when the chat reported "you missed X" (R-UI-10). */
    chatMessageId: uuid('chat_message_id').references((): AnyPgColumn => chatMessages.id, {
      onDelete: 'set null',
    }),
    detail: text('detail'),
    status: reconcileStatus('status').notNull().default('open'),
    resolutionJobId: bigint('resolution_job_id', { mode: 'number' }).references((): AnyPgColumn => jobs.id, {
      onDelete: 'set null',
    }),
    resolvedAt: tstz('resolved_at'),
    resolutionNote: text('resolution_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('reconcile_findings_owner_open_idx').on(t.ownerUserId, t.kind).where(sql`${t.status} = 'open'`),
    index('reconcile_findings_source_item_idx').on(t.sourceItemId),
  ],
);

/**
 * Decision trail of a scan run (AUDIT): what it planned, every tool call, what REC-1 recorded, each triage verdict and
 * why, what it proposed and linked (with the evidence ids), prompt size against the tripwire, retries, spend and the
 * outcome. Append-only, ordered by `seq` within a run. Ids, counts, codes and short reasons only: message text stays
 * in source_items (tenet: Local data, privacy-safe logs). Not audited (a log, not data). Retention: 30 days.
 */
export const scanRunEvents = pgTable(
  'scan_run_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => scanRuns.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    ts: tstz('ts').notNull().defaultNow(),
    /** plan | tool_call | rec | prefetch | prompt | triage_select | verdict | recorded | proposal | link | unlinked | spend | retry | cost_cap | tripwire | commit | outcome … */
    kind: text('kind').notNull(),
    /** Small, redacted: ids, counts, codes, durations, short reasons (≤ 160 chars). Never message text. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    /** Plain ids (no FK: a trace row never blocks or fails a write). */
    sourceItemId: uuid('source_item_id'),
    workItemId: uuid('work_item_id'),
  },
  (t) => [
    uniqueIndex('scan_run_events_run_seq_uidx').on(t.runId, t.seq),
    index('scan_run_events_source_item_idx').on(t.sourceItemId).where(sql`${t.sourceItemId} IS NOT NULL`),
    index('scan_run_events_work_item_idx').on(t.workItemId).where(sql`${t.workItemId} IS NOT NULL`),
    index('scan_run_events_ts_idx').on(t.ts),
    index('scan_run_events_kind_ts_idx').on(t.kind, t.ts.desc()),
  ],
);

export type ScanRun = typeof scanRuns.$inferSelect;
export type ScanRunEvent = typeof scanRunEvents.$inferSelect;
