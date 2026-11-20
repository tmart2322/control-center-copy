/** Watch subscriptions, briefs, highlights and relevance tuning (section 17; R-UI-21). */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstz, createdAt, updatedAt, ownerUserId, confidence, usd, textArray } from './columns';
import {
  sourceSystem,
  modelTier,
  watchScopeKind,
  briefCadence,
  briefStyle,
  briefStatus,
  highlightLevel,
  highlightStatus,
  highlightReasonKind,
  relevanceFeedbackKind,
} from './enums';
import { priorityPolicyRules } from './settings';
import { scanRuns } from './scanning';
import { extractors } from './sources';
import { accounts, opportunities, opportunitySnapshots, people, channels } from './entities';
import { workItems, initiatives } from './work';
import { jobs, jobSchedules } from './jobs';
import { llmCalls } from './llm';
import { changeSets } from './audit';

/** What this user follows even when it isn't theirs. Opp briefs are auto-managed per open opp. */
export const watchSubscriptions = pgTable(
  'watch_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    scopeKind: watchScopeKind('scope_kind').notNull(),
    channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'cascade' }),
    opportunityId: uuid('opportunity_id').references(() => opportunities.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').references(() => people.id, { onDelete: 'cascade' }),
    initiativeId: uuid('initiative_id').references(() => initiatives.id, { onDelete: 'cascade' }),
    searchQuery: text('search_query'),
    /** For search_query scopes: which sources to search (empty = all). */
    sourceSystems: sourceSystem('source_systems')
      .array()
      .notNull()
      .default(sql`'{}'::source_system[]`),
    label: text('label').notNull(),
    cadence: briefCadence('cadence').notNull().default('daily'),
    style: briefStyle('style').notNull().default('digest'),
    /** 1 headline-only … 5 thorough */
    detailLevel: smallint('detail_level').notNull().default(2),
    maxHighlights: smallint('max_highlights').notNull().default(5),
    minRelevance: confidence('min_relevance').notNull().default(0.5),
    /** System-created (e.g. one per open opp I'm on); removed when the scope closes. */
    autoManaged: boolean('auto_managed').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    scheduleId: uuid('schedule_id').references(() => jobSchedules.id, { onDelete: 'set null' }),
    /** Window cursor: the next brief covers (last_period_end, now]. */
    lastPeriodEnd: tstz('last_period_end'),
    lastBriefId: uuid('last_brief_id').references((): AnyPgColumn => briefs.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'watch_subscriptions_scope_chk',
      sql`num_nonnulls(${t.channelId}, ${t.opportunityId}, ${t.accountId}, ${t.personId}, ${t.initiativeId}, ${t.searchQuery}) = 1
        AND (${t.scopeKind} <> 'channel' OR ${t.channelId} IS NOT NULL)
        AND (${t.scopeKind} <> 'opportunity' OR ${t.opportunityId} IS NOT NULL)
        AND (${t.scopeKind} <> 'account' OR ${t.accountId} IS NOT NULL)
        AND (${t.scopeKind} <> 'person' OR ${t.personId} IS NOT NULL)
        AND (${t.scopeKind} <> 'initiative' OR ${t.initiativeId} IS NOT NULL)
        AND (${t.scopeKind} <> 'search_query' OR ${t.searchQuery} IS NOT NULL)`,
    ),
    unique('watch_subscriptions_scope_uq')
      .on(t.ownerUserId, t.scopeKind, t.channelId, t.opportunityId, t.accountId, t.personId, t.initiativeId, t.searchQuery)
      .nullsNotDistinct(),
    index('watch_subscriptions_owner_enabled_idx').on(t.ownerUserId).where(sql`${t.enabled}`),
    check('watch_subscriptions_detail_chk', sql`${t.detailLevel} BETWEEN 1 AND 5`),
  ],
);

/** One generated brief per subscription per period. */
export const briefs = pgTable(
  'briefs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => watchSubscriptions.id, { onDelete: 'cascade' }),
    periodStart: tstz('period_start').notNull(),
    periodEnd: tstz('period_end').notNull(),
    status: briefStatus('status').notNull().default('generating'),
    /** Markdown body ("what happened"). Reading material only. */
    summary: text('summary'),
    /** Opp briefs: Org62 field changes are diffed between these snapshots. */
    fromOpportunitySnapshotId: uuid('from_opportunity_snapshot_id').references(() => opportunitySnapshots.id, {
      onDelete: 'set null',
    }),
    toOpportunitySnapshotId: uuid('to_opportunity_snapshot_id').references(() => opportunitySnapshots.id, {
      onDelete: 'set null',
    }),
    sourceItemCount: integer('source_item_count').notNull().default(0),
    highlightCount: smallint('highlight_count').notNull().default(0),
    /** Opp briefs say "nothing changed" explicitly rather than staying silent. */
    nothingNew: boolean('nothing_new').notNull().default(false),
    /** false when a needed connector was degraded or the ledger has gaps in the window. */
    coverageComplete: boolean('coverage_complete').notNull().default(true),
    coverageNote: text('coverage_note'),
    model: text('model'),
    modelTier: modelTier('model_tier').notNull().default('haiku'),
    llmCallId: bigint('llm_call_id', { mode: 'number' }).references((): AnyPgColumn => llmCalls.id, {
      onDelete: 'set null',
    }),
    /** Sum over all LLM calls for this brief (summary + relevance scoring). */
    costUsd: usd('cost_usd').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    inputsHash: text('inputs_hash'),
    jobId: bigint('job_id', { mode: 'number' }).references(() => jobs.id, { onDelete: 'set null' }),
    generatedAt: tstz('generated_at'),
    seenAt: tstz('seen_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('briefs_subscription_period_uidx').on(t.subscriptionId, t.periodStart, t.periodEnd),
    index('briefs_owner_generated_idx').on(t.ownerUserId, t.generatedAt.desc()),
    index('briefs_owner_unseen_idx')
      .on(t.ownerUserId, t.generatedAt.desc())
      .where(sql`${t.status} = 'ready' AND ${t.seenAt} IS NULL`),
    check('briefs_period_chk', sql`${t.periodEnd} > ${t.periodStart}`),
  ],
);

/** Coverage: which scan runs fed the brief (source items are in provenance_links.brief_id). */
export const briefScanRuns = pgTable(
  'brief_scan_runs',
  {
    briefId: uuid('brief_id')
      .notNull()
      .references(() => briefs.id, { onDelete: 'cascade' }),
    scanRunId: uuid('scan_run_id')
      .notNull()
      .references(() => scanRuns.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.briefId, t.scanRunId] }), index('brief_scan_runs_run_idx').on(t.scanRunId)],
);

/** "Worth a closer look for you": ranked, explained, promotable, dismissable. */
export const briefHighlights = pgTable(
  'brief_highlights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    briefId: uuid('brief_id')
      .notNull()
      .references(() => briefs.id, { onDelete: 'cascade' }),
    ordinal: smallint('ordinal').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    relevanceScore: confidence('relevance_score').notNull(),
    level: highlightLevel('level').notNull(),
    /** Subject entities, used for tuning and for pre-filling a promoted item. */
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    opportunityId: uuid('opportunity_id').references(() => opportunities.id, { onDelete: 'set null' }),
    initiativeId: uuid('initiative_id').references(() => initiatives.id, { onDelete: 'set null' }),
    /** Stable topic key (thread, doc, opp field) so the same thing isn't re-highlighted. */
    topicKey: text('topic_key').notNull(),
    status: highlightStatus('status').notNull().default('new'),
    seenAt: tstz('seen_at'),
    promotedAt: tstz('promoted_at'),
    /** Triage item (status suggested) or task (status open). */
    promotedWorkItemId: uuid('promoted_work_item_id').references(() => workItems.id, { onDelete: 'set null' }),
    dismissedAt: tstz('dismissed_at'),
    dismissReason: text('dismiss_reason'),
    extractorId: uuid('extractor_id').references(() => extractors.id, { onDelete: 'set null' }),
    llmCallId: bigint('llm_call_id', { mode: 'number' }).references((): AnyPgColumn => llmCalls.id, {
      onDelete: 'set null',
    }),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('brief_highlights_brief_ordinal_uidx').on(t.briefId, t.ordinal),
    index('brief_highlights_owner_new_idx')
      .on(t.ownerUserId, t.relevanceScore.desc())
      .where(sql`${t.status} = 'new'`),
    index('brief_highlights_owner_topic_idx').on(t.ownerUserId, t.topicKey),
    check('brief_highlights_promoted_chk', sql`(${t.status} = 'promoted') = (${t.promotedWorkItemId} IS NOT NULL)`),
  ],
);

/** Why it was highlighted, one reason per row (shown to the user, and the features tuning learns from). */
export const briefHighlightReasons = pgTable(
  'brief_highlight_reasons',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    highlightId: uuid('highlight_id')
      .notNull()
      .references(() => briefHighlights.id, { onDelete: 'cascade' }),
    kind: highlightReasonKind('kind').notNull(),
    /** e.g. 'account:<id>', 'interest:<id>', 'rule:<rule_key>', 'person:<id>', 'keyword:headless'. */
    featureKey: text('feature_key').notNull(),
    policyRuleId: uuid('policy_rule_id'),
    weight: numeric('weight', { precision: 6, scale: 3, mode: 'number' }).notNull(),
    explanation: text('explanation').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'brief_highlight_reasons_policy_rule_id_fk',
      columns: [t.policyRuleId],
      foreignColumns: [priorityPolicyRules.id],
    }).onDelete('set null'),
    uniqueIndex('brief_highlight_reasons_highlight_feature_uidx').on(t.highlightId, t.featureKey),
    index('brief_highlight_reasons_feature_idx').on(t.featureKey),
  ],
);

/** Raw feedback events: promote / dismiss / useful / opened. */
export const relevanceFeedback = pgTable(
  'relevance_feedback',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ownerUserId: ownerUserId(),
    highlightId: uuid('highlight_id')
      .notNull()
      .references(() => briefHighlights.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(() => watchSubscriptions.id, { onDelete: 'set null' }),
    kind: relevanceFeedbackKind('kind').notNull(),
    /** Feature keys of the highlight at feedback time (copied from its reasons). */
    featureKeys: textArray('feature_keys'),
    changeSetId: uuid('change_set_id').references(() => changeSets.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('relevance_feedback_owner_created_idx').on(t.ownerUserId, t.createdAt.desc())],
);

/** Tuned state: per-user learned weight per feature, recomputed from relevance_feedback. */
export const relevanceWeights = pgTable(
  'relevance_weights',
  {
    ownerUserId: ownerUserId(),
    featureKey: text('feature_key').notNull(),
    weight: numeric('weight', { precision: 6, scale: 3, mode: 'number' }).notNull().default(0),
    positiveCount: integer('positive_count').notNull().default(0),
    negativeCount: integer('negative_count').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.ownerUserId, t.featureKey] })],
);
