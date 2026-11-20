/** Drive forward sampling and deliverables: snapshots, sections, diffs, requirements, judgments (5b + 7; R-UI-15). */
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
  jsonb,
  pgTable,
  type PgTableExtraConfigValue,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstz, createdAt, updatedAt, confidence, textArray } from './columns';
import {
  snapshotStatus,
  sectionKind,
  diffKind,
  deliverableKind,
  deliverableStatus,
  requirementStatus,
  judgmentVerdict,
} from './enums';
import { scanRuns } from './scanning';
import { sourceItems, extractors } from './sources';
import { people, assets } from './entities';
import { workItems } from './work';
import { llmCalls } from './llm';

/** One row per observed modifiedTime of a file. 1:1 with a drive_file_revision source item. */
export const assetSnapshots = pgTable(
  'asset_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    sourceItemId: uuid('source_item_id')
      .notNull()
      .references(() => sourceItems.id, { onDelete: 'cascade' }),
    scanRunId: uuid('scan_run_id').references(() => scanRuns.id, { onDelete: 'set null' }),
    sampledAt: tstz('sampled_at').notNull(),
    modifiedTime: tstz('modified_time').notNull(),
    lastModifyingPersonId: uuid('last_modifying_person_id').references(() => people.id, { onDelete: 'set null' }),
    /** Raw lastModifyingUser (email or display name) until resolved. */
    lastModifyingIdentity: text('last_modifying_identity'),
    modifiedByMe: boolean('modified_by_me').notNull().default(false),
    headRevisionId: text('head_revision_id'),
    driveVersion: bigint('drive_version', { mode: 'number' }),
    title: text('title'),
    /** Digest of the ordered section hashes. */
    contentHash: text('content_hash').notNull(),
    sectionCount: smallint('section_count').notNull().default(0),
    wordCount: integer('word_count').notNull().default(0),
    /** e.g. 'slides.read_presentation@1', 'docs.get_doc_as_markdown@2'. */
    extractor: text('extractor').notNull(),
    status: snapshotStatus('status').notNull().default('ok'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('asset_snapshots_asset_modified_uidx').on(t.assetId, t.modifiedTime),
    uniqueIndex('asset_snapshots_source_item_uidx').on(t.sourceItemId),
    index('asset_snapshots_asset_sampled_idx').on(t.assetId, t.sampledAt.desc()),
  ],
);

/** Per-slide / per-section digest. Text follows body retention; hashes are kept. */
export const assetSnapshotSections = pgTable(
  'asset_snapshot_sections',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    snapshotId: uuid('snapshot_id')
      .notNull()
      .references(() => assetSnapshots.id, { onDelete: 'cascade' }),
    ordinal: smallint('ordinal').notNull(),
    /** Slide objectId, heading anchor or tab id: stable across snapshots, so moves are detectable. */
    sectionKey: text('section_key').notNull(),
    kind: sectionKind('kind').notNull(),
    title: text('title'),
    contentHash: text('content_hash').notNull(),
    speakerNotesHash: text('speaker_notes_hash'),
    wordCount: integer('word_count').notNull().default(0),
    text: text('text'),
    textExpiresAt: tstz('text_expires_at'),
  },
  (t) => [
    uniqueIndex('asset_snapshot_sections_snapshot_ordinal_uidx').on(t.snapshotId, t.ordinal),
    index('asset_snapshot_sections_snapshot_key_idx').on(t.snapshotId, t.sectionKey),
    index('asset_snapshot_sections_text_expiry_idx').on(t.textExpiresAt).where(sql`${t.text} IS NOT NULL`),
  ],
);

/** Computed diff between two snapshots: consecutive, or baseline (item creation) -> latest. */
export const assetSnapshotDiffs = pgTable(
  'asset_snapshot_diffs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    fromSnapshotId: uuid('from_snapshot_id')
      .notNull()
      .references(() => assetSnapshots.id, { onDelete: 'cascade' }),
    toSnapshotId: uuid('to_snapshot_id')
      .notNull()
      .references(() => assetSnapshots.id, { onDelete: 'cascade' }),
    kind: diffKind('kind').notNull(),
    sectionsAdded: smallint('sections_added').notNull().default(0),
    sectionsRemoved: smallint('sections_removed').notNull().default(0),
    sectionsModified: smallint('sections_modified').notNull().default(0),
    sectionsMoved: smallint('sections_moved').notNull().default(0),
    wordsAdded: integer('words_added').notNull().default(0),
    wordsRemoved: integer('words_removed').notNull().default(0),
    changedSectionKeys: textArray('changed_section_keys'),
    modifiedByMeOnly: boolean('modified_by_me_only').notNull().default(false),
    modifierPersonIds: uuid('modifier_person_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** Deterministic or Haiku summary ("added pricing slide 7; edited title on 2"). */
    summary: text('summary'),
    /** [{sectionKey, change: added|removed|modified|moved, beforeHash, afterHash}] */
    changes: jsonb('changes').$type<unknown[]>().notNull().default([]),
    summaryLlmCallId: bigint('summary_llm_call_id', { mode: 'number' }).references((): AnyPgColumn => llmCalls.id, {
      onDelete: 'set null',
    }),
    computedAt: tstz('computed_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('asset_snapshot_diffs_from_to_uidx').on(t.fromSnapshotId, t.toSnapshotId),
    index('asset_snapshot_diffs_asset_computed_idx').on(t.assetId, t.computedAt.desc()),
    check('asset_snapshot_diffs_distinct_chk', sql`${t.fromSnapshotId} <> ${t.toSnapshotId}`),
  ],
);

/** Expected deliverable: the target file + the changes that were asked for (R-UI-15). */
export const workItemDeliverables = pgTable(
  'work_item_deliverables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    /** Null until the resolver finds the file ("the Acme deck"). */
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    /** Title / link text from the ask, used to resolve the file. */
    assetHint: text('asset_hint'),
    kind: deliverableKind('kind').notNull(),
    /** File state when the item was created: "what changed since" is diffed against this. */
    baselineSnapshotId: uuid('baseline_snapshot_id'),
    baselineAt: tstz('baseline_at').notNull(),
    status: deliverableStatus('status').notNull().default('file_unresolved'),
    latestJudgmentId: uuid('latest_judgment_id'),
    lastJudgedAt: tstz('last_judged_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: 'work_item_deliverables_latest_judgment_id_fk',
      columns: [t.latestJudgmentId],
      foreignColumns: [deliverableJudgments.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'work_item_deliverables_baseline_snapshot_id_fk',
      columns: [t.baselineSnapshotId],
      foreignColumns: [assetSnapshots.id],
    }).onDelete('set null'),
    uniqueIndex('work_item_deliverables_item_asset_uidx')
      .on(t.workItemId, t.assetId)
      .where(sql`${t.assetId} IS NOT NULL`),
    index('work_item_deliverables_asset_idx').on(t.assetId),
    check('work_item_deliverables_target_chk', sql`num_nonnulls(${t.assetId}, ${t.assetHint}) >= 1`),
    check(
      'work_item_deliverables_resolved_chk',
      sql`${t.assetId} IS NOT NULL OR ${t.status} IN ('file_unresolved', 'abandoned')`,
    ),
  ],
);

/** The requested changes, one per row, so the judge can check each against the diff. */
export const deliverableRequirements = pgTable(
  'deliverable_requirements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deliverableId: uuid('deliverable_id').notNull(),
    ordinal: smallint('ordinal').notNull(),
    description: text('description').notNull(),
    /** "slide 7", "pricing section". */
    sectionHint: text('section_hint'),
    requestedBySourceItemId: uuid('requested_by_source_item_id'),
    extractorId: uuid('extractor_id')
      .notNull()
      .references(() => extractors.id, { onDelete: 'restrict' }),
    status: requirementStatus('status').notNull().default('pending'),
    confidence: confidence(),
    matchedSectionKeys: textArray('matched_section_keys'),
    lastJudgedAt: tstz('last_judged_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'deliverable_requirements_requested_by_source_item_id_fk',
      columns: [t.requestedBySourceItemId],
      foreignColumns: [sourceItems.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'deliverable_requirements_deliverable_id_fk',
      columns: [t.deliverableId],
      foreignColumns: [workItemDeliverables.id],
    }).onDelete('cascade'),
    uniqueIndex('deliverable_requirements_deliverable_ordinal_uidx').on(t.deliverableId, t.ordinal),
  ],
);

/** Immutable record of each judge run (baseline -> latest diff vs requirements). */
export const deliverableJudgments = pgTable(
  'deliverable_judgments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deliverableId: uuid('deliverable_id').notNull(),
    diffId: uuid('diff_id').references(() => assetSnapshotDiffs.id, { onDelete: 'set null' }),
    snapshotId: uuid('snapshot_id').references(() => assetSnapshots.id, { onDelete: 'set null' }),
    verdict: judgmentVerdict('verdict').notNull(),
    confidence: confidence().notNull(),
    rationale: text('rationale'),
    /** [{requirementId, status, confidence, sectionKeys, rationale}]; current state lives on deliverable_requirements. */
    requirementVerdicts: jsonb('requirement_verdicts').$type<unknown[]>().notNull(),
    model: text('model'),
    llmCallId: bigint('llm_call_id', { mode: 'number' }).references((): AnyPgColumn => llmCalls.id, {
      onDelete: 'set null',
    }),
    judgedAt: tstz('judged_at').notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: 'deliverable_judgments_deliverable_id_fk',
      columns: [t.deliverableId],
      foreignColumns: [workItemDeliverables.id],
    }).onDelete('cascade'),
    index('deliverable_judgments_deliverable_judged_idx').on(t.deliverableId, t.judgedAt.desc()),
  ],
);
