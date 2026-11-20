/** Tool adapters (the plugin seam), runs and outputs (section 16; R-UI-13). */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstz, createdAt, updatedAt, ownerUserId, textArray } from './columns';
import {
  toolAdapterKind,
  toolRunStatus,
  toolOutputKind,
} from './enums';
import { assets } from './entities';
import { workItems } from './work';
import { nextBestActions } from './nba';
import { claudeSessions } from './sessions';
import { jobs } from './jobs';

export const toolAdapters = pgTable(
  'tool_adapters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    /** 'talk_track', 'pulse_footprint', 'afd360_estimator', ... */
    key: text('key').notNull(),
    name: text('name').notNull(),
    kind: toolAdapterKind('kind').notNull(),
    baseUrl: text('base_url'),
    healthPath: text('health_path'),
    launchCommand: text('launch_command'),
    /** e.g. ['talk_track.generate', 'talk_track.open']. */
    capabilities: textArray('capabilities'),
    /** JSON Schema of accepted inputs, per capability. */
    inputSchema: jsonb('input_schema').$type<Record<string, unknown>>().notNull().default({}),
    version: text('version'),
    enabled: boolean('enabled').notNull().default(true),
    lastHealthAt: tstz('last_health_at'),
    lastHealthOk: boolean('last_health_ok'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('tool_adapters_owner_key_uidx').on(t.ownerUserId, t.key)],
);

export const toolRuns = pgTable(
  'tool_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    adapterId: uuid('adapter_id')
      .notNull()
      .references(() => toolAdapters.id, { onDelete: 'restrict' }),
    capability: text('capability').notNull(),
    workItemId: uuid('work_item_id').references(() => workItems.id, { onDelete: 'set null' }),
    nbaId: uuid('nba_id').references(() => nextBestActions.id, { onDelete: 'set null' }),
    status: toolRunStatus('status').notNull().default('queued'),
    input: jsonb('input').$type<Record<string, unknown>>().notNull(),
    externalRunId: text('external_run_id'),
    jobId: bigint('job_id', { mode: 'number' }).references(() => jobs.id, { onDelete: 'set null' }),
    claudeSessionId: uuid('claude_session_id').references(() => claudeSessions.id, { onDelete: 'set null' }),
    outputSummary: text('output_summary'),
    startedAt: tstz('started_at'),
    finishedAt: tstz('finished_at'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tool_runs_owner_status_idx').on(t.ownerUserId, t.status),
    index('tool_runs_work_item_idx').on(t.workItemId),
  ],
);

export const toolRunOutputs = pgTable(
  'tool_run_outputs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    toolRunId: uuid('tool_run_id')
      .notNull()
      .references(() => toolRuns.id, { onDelete: 'cascade' }),
    kind: toolOutputKind('kind').notNull(),
    label: text('label').notNull(),
    url: text('url'),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    localPath: text('local_path'),
    createdAt: createdAt(),
  },
  (t) => [
    index('tool_run_outputs_run_idx').on(t.toolRunId),
    check('tool_run_outputs_target_chk', sql`num_nonnulls(${t.url}, ${t.assetId}, ${t.localPath}) >= 1`),
  ],
);
