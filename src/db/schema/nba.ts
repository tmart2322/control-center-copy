/** Versioned next best actions and provenance links (section 9; R-UI-5). */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstz, createdAt, updatedAt, ownerUserId, confidence } from './columns';
import {
  modelTier,
  nbaType,
  nbaStatus,
  supersedeReason,
  provenanceRole,
} from './enums';
import { sourceItems, extractors } from './sources';
import { workItems } from './work';
import { drafts } from './drafts';
import { claudeSessions } from './sessions';
import { activityEntries } from './activity';
import { missedOppFindings } from './deals';
import { llmCalls } from './llm';
import { chatMessages } from './chat';
import { toolRuns } from './tools';
import { briefs, briefHighlights } from './briefs';

export const nextBestActions = pgTable(
  'next_best_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    /** Position in the supersede chain (1, 2, 3 ...). */
    nbaVersion: integer('nba_version').notNull(),
    /** Item reeval_generation this version was computed from; lower than the item = stale. */
    workItemGeneration: bigint('work_item_generation', { mode: 'number' }).notNull().default(0),
    /** Optimistic concurrency (R-UI-20). */
    version: integer('version').notNull().default(1),
    status: nbaStatus('status').notNull().default('generating'),
    type: nbaType('type').notNull(),
    title: text('title').notNull(),
    rationale: text('rationale'),
    /** Type-specific payload (zod per nba_type): tool inputs, session prompt, slots, ... */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    /** 0-100: how ready-to-go this is (R-UI-9 "mostly filled in"). */
    completeness: smallint('completeness').notNull().default(0),
    confidence: confidence(),
    model: text('model'),
    modelTier: modelTier('model_tier').notNull().default('none'),
    llmCallId: bigint('llm_call_id', { mode: 'number' }).references((): AnyPgColumn => llmCalls.id, {
      onDelete: 'set null',
    }),
    promptVersion: text('prompt_version'),
    /** Hash of every input; same hash = no regeneration. */
    inputsHash: text('inputs_hash').notNull(),
    supersedesId: uuid('supersedes_id').references((): AnyPgColumn => nextBestActions.id, { onDelete: 'set null' }),
    supersedeReason: supersedeReason('supersede_reason'),
    triggerSourceItemId: uuid('trigger_source_item_id').references(() => sourceItems.id, { onDelete: 'set null' }),
    diffSummary: text('diff_summary'),
    /** RFC 6902 patch from the previous version's payload. */
    diff: jsonb('diff').$type<unknown[]>(),
    draftId: uuid('draft_id').references((): AnyPgColumn => drafts.id, { onDelete: 'set null' }),
    toolRunId: uuid('tool_run_id').references((): AnyPgColumn => toolRuns.id, { onDelete: 'set null' }),
    claudeSessionId: uuid('claude_session_id').references((): AnyPgColumn => claudeSessions.id, {
      onDelete: 'set null',
    }),
    activityEntryId: uuid('activity_entry_id').references((): AnyPgColumn => activityEntries.id, {
      onDelete: 'set null',
    }),
    readyAt: tstz('ready_at'),
    acceptedAt: tstz('accepted_at'),
    completedAt: tstz('completed_at'),
    dismissedAt: tstz('dismissed_at'),
    dismissReason: text('dismiss_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('next_best_actions_item_version_uidx').on(t.workItemId, t.nbaVersion),
    uniqueIndex('next_best_actions_one_live_uidx')
      .on(t.workItemId)
      .where(sql`${t.status} IN ('ready', 'needs_input', 'stale', 'accepted', 'executing')`),
    index('next_best_actions_owner_status_idx').on(t.ownerUserId, t.status),
    check('next_best_actions_completeness_chk', sql`${t.completeness} BETWEEN 0 AND 100`),
    check('next_best_actions_version_chain_chk', sql`(${t.nbaVersion} = 1) = (${t.supersedesId} IS NULL)`),
  ],
);

/** Which source items an NBA, draft, activity entry, tool run, finding, chat answer, brief or highlight rests on. */
export const provenanceLinks = pgTable(
  'provenance_links',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sourceItemId: uuid('source_item_id')
      .notNull()
      .references(() => sourceItems.id, { onDelete: 'cascade' }),
    nbaId: uuid('nba_id').references(() => nextBestActions.id, { onDelete: 'cascade' }),
    draftId: uuid('draft_id').references((): AnyPgColumn => drafts.id, { onDelete: 'cascade' }),
    activityEntryId: uuid('activity_entry_id').references((): AnyPgColumn => activityEntries.id, {
      onDelete: 'cascade',
    }),
    toolRunId: uuid('tool_run_id').references((): AnyPgColumn => toolRuns.id, { onDelete: 'cascade' }),
    missedOppFindingId: uuid('missed_opp_finding_id'),
    chatMessageId: uuid('chat_message_id').references((): AnyPgColumn => chatMessages.id, { onDelete: 'cascade' }),
    /** Brief coverage (R-UI-21): items the brief summarized. */
    briefId: uuid('brief_id').references((): AnyPgColumn => briefs.id, { onDelete: 'cascade' }),
    /** Evidence behind a highlight. */
    briefHighlightId: uuid('brief_highlight_id').references((): AnyPgColumn => briefHighlights.id, {
      onDelete: 'cascade',
    }),
    role: provenanceRole('role').notNull(),
    extractorId: uuid('extractor_id').references(() => extractors.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'provenance_links_missed_opp_finding_id_fk',
      columns: [t.missedOppFindingId],
      foreignColumns: [missedOppFindings.id],
    }).onDelete('cascade'),
    check(
      'provenance_links_one_target_chk',
      sql`num_nonnulls(${t.nbaId}, ${t.draftId}, ${t.activityEntryId}, ${t.toolRunId}, ${t.missedOppFindingId}, ${t.chatMessageId}, ${t.briefId}, ${t.briefHighlightId}) = 1`,
    ),
    unique('provenance_links_target_uq')
      .on(
        t.sourceItemId,
        t.role,
        t.nbaId,
        t.draftId,
        t.activityEntryId,
        t.toolRunId,
        t.missedOppFindingId,
        t.chatMessageId,
        t.briefId,
        t.briefHighlightId,
      )
      .nullsNotDistinct(),
    index('provenance_links_nba_idx').on(t.nbaId).where(sql`${t.nbaId} IS NOT NULL`),
    index('provenance_links_draft_idx').on(t.draftId).where(sql`${t.draftId} IS NOT NULL`),
    index('provenance_links_activity_idx').on(t.activityEntryId).where(sql`${t.activityEntryId} IS NOT NULL`),
    index('provenance_links_finding_idx').on(t.missedOppFindingId).where(sql`${t.missedOppFindingId} IS NOT NULL`),
    index('provenance_links_brief_idx').on(t.briefId).where(sql`${t.briefId} IS NOT NULL`),
    index('provenance_links_highlight_idx').on(t.briefHighlightId).where(sql`${t.briefHighlightId} IS NOT NULL`),
    index('provenance_links_source_item_idx').on(t.sourceItemId),
  ],
);

export type NextBestAction = typeof nextBestActions.$inferSelect;
