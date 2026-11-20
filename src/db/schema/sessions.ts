/** Claude sessions and their segments (section 11; R-UI-1 waiting-on-me). */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstz, createdAt, updatedAt, ownerUserId, confidence, usd } from './columns';
import {
  linkMethod,
  claudeEntrypoint,
  claudeSessionStatus,
  waitingOnMeReason,
  titleSource,
  launchMode,
} from './enums';
import { connectors } from './connectors';
import { sourceItems } from './sources';
import { accounts, opportunities, repos } from './entities';
import { workItems } from './work';
import { nextBestActions } from './nba';
import { jobs } from './jobs';

export const claudeSessions = pgTable(
  'claude_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    connectorId: uuid('connector_id').references(() => connectors.id, { onDelete: 'set null' }),
    /** Transcript UUID; null while an app-launched session has not been discovered yet. */
    sessionExternalId: text('session_external_id'),
    desktopSessionId: text('desktop_session_id'),
    entrypoint: claudeEntrypoint('entrypoint').notNull().default('unknown'),
    status: claudeSessionStatus('status').notNull().default('running'),
    waitingReason: waitingOnMeReason('waiting_reason'),
    waitingDetail: text('waiting_detail'),
    waitingSince: tstz('waiting_since'),
    transcriptPath: text('transcript_path'),
    cwd: text('cwd'),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'set null' }),
    gitBranch: text('git_branch'),
    planSlug: text('plan_slug'),
    title: text('title'),
    titleSource: titleSource('title_source'),
    /** away_summary / desktop postTurnSummary / Haiku digest (redacted, derived). */
    summary: text('summary'),
    summaryUpdatedAt: tstz('summary_updated_at'),
    startedAt: tstz('started_at'),
    lastActivityAt: tstz('last_activity_at'),
    endedAt: tstz('ended_at'),
    activeMs: bigint('active_ms', { mode: 'number' }).notNull().default(0),
    humanMs: bigint('human_ms', { mode: 'number' }).notNull().default(0),
    backgroundMs: bigint('background_ms', { mode: 'number' }).notNull().default(0),
    promptCount: integer('prompt_count').notNull().default(0),
    filesChangedCount: integer('files_changed_count').notNull().default(0),
    linesAdded: integer('lines_added').notNull().default(0),
    linesRemoved: integer('lines_removed').notNull().default(0),
    costUsd: usd('cost_usd'),
    primaryModel: text('primary_model'),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    opportunityId: uuid('opportunity_id').references(() => opportunities.id, { onDelete: 'set null' }),
    mappingMethod: linkMethod('mapping_method'),
    mappingConfidence: confidence('mapping_confidence'),
    mappingLocked: boolean('mapping_locked').notNull().default(false),
    sourceItemId: uuid('source_item_id').references(() => sourceItems.id, { onDelete: 'set null' }),
    // Sessions the app launched itself (R-UI-8, B-029)
    launchedByApp: boolean('launched_by_app').notNull().default(false),
    launchMode: launchMode('launch_mode'),
    launchWorkItemId: uuid('launch_work_item_id').references(() => workItems.id, { onDelete: 'set null' }),
    launchNbaId: uuid('launch_nba_id').references((): AnyPgColumn => nextBestActions.id, { onDelete: 'set null' }),
    launchPrompt: text('launch_prompt'),
    launchJobId: bigint('launch_job_id', { mode: 'number' }).references((): AnyPgColumn => jobs.id, {
      onDelete: 'set null',
    }),
    launchRequestedAt: tstz('launch_requested_at'),
    /** From ~/.claude/sessions/<pid>.json (live registry). */
    livePid: integer('live_pid'),
    liveStatusAt: tstz('live_status_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('claude_sessions_owner_external_uidx')
      .on(t.ownerUserId, t.sessionExternalId)
      .where(sql`${t.sessionExternalId} IS NOT NULL`),
    index('claude_sessions_owner_status_idx').on(t.ownerUserId, t.status, t.lastActivityAt.desc()),
    index('claude_sessions_repo_idx').on(t.repoId),
    index('claude_sessions_launch_work_item_idx').on(t.launchWorkItemId),
    check('claude_sessions_waiting_chk', sql`${t.status} <> 'waiting_on_me' OR ${t.waitingReason} IS NOT NULL`),
    check('claude_sessions_launch_chk', sql`NOT ${t.launchedByApp} OR ${t.launchMode} IS NOT NULL`),
  ],
);

/** Work segments (split on >30 min gaps): the unit the time engine turns into blocks. */
export const claudeSessionSegments = pgTable(
  'claude_session_segments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    claudeSessionId: uuid('claude_session_id')
      .notNull()
      .references(() => claudeSessions.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    startedAt: tstz('started_at').notNull(),
    endedAt: tstz('ended_at').notNull(),
    activeMs: bigint('active_ms', { mode: 'number' }).notNull().default(0),
    /** Prompt-window proxy for human attention. */
    humanMs: bigint('human_ms', { mode: 'number' }).notNull().default(0),
    /** Model working time (turn_duration); never human hours. */
    backgroundMs: bigint('background_ms', { mode: 'number' }).notNull().default(0),
    promptCount: integer('prompt_count').notNull().default(0),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    opportunityId: uuid('opportunity_id').references(() => opportunities.id, { onDelete: 'set null' }),
    mappingMethod: linkMethod('mapping_method'),
    mappingConfidence: confidence('mapping_confidence'),
  },
  (t) => [
    uniqueIndex('claude_session_segments_session_ordinal_uidx').on(t.claudeSessionId, t.ordinal),
    check('claude_session_segments_range_chk', sql`${t.endedAt} >= ${t.startedAt}`),
  ],
);

export type ClaudeSession = typeof claudeSessions.$inferSelect;
