/** Change sets (the unit of undo), audit events and content revisions (section 15; R-UI-18). */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstz, createdAt, ownerUserId, textArray } from './columns';
import {
  actorKind,
  changeSetKind,
  auditOp,
} from './enums';
import { users } from './core';

/**
 * One logical change (a click, an autosave burst, an engine pass, a chat tool call): the unit
 * of undo (toast, ⌘Z) and of per-entity history. Open while coalescing; closed = immutable.
 */
export const changeSets = pgTable(
  'change_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    kind: changeSetKind('kind').notNull(),
    actorKind: actorKind('actor_kind').notNull(),
    /** Engine key+version, chat tool call id, or UI action name. */
    actorRef: text('actor_ref'),
    /** Browser tab / chat thread that owns an autosave burst. */
    editorSessionId: text('editor_session_id'),
    /** Primary entity, for the Undo toast and history views. */
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    summary: text('summary').notNull(),
    undoable: boolean('undoable').notNull().default(true),
    /** Autosave bursts keep absorbing writes until this time (~30 s idle). */
    coalesceUntil: tstz('coalesce_until'),
    closedAt: tstz('closed_at'),
    undoOfChangeSetId: uuid('undo_of_change_set_id').references((): AnyPgColumn => changeSets.id, {
      onDelete: 'set null',
    }),
    /** Rollback: restore the entity to its state as of this time. */
    rollbackToAt: tstz('rollback_to_at'),
    undoneAt: tstz('undone_at'),
    undoneByChangeSetId: uuid('undone_by_change_set_id').references((): AnyPgColumn => changeSets.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index('change_sets_owner_created_idx').on(t.ownerUserId, t.createdAt.desc()),
    /** ⌘Z stack: newest undoable, not-yet-undone change by this user. */
    index('change_sets_undo_stack_idx')
      .on(t.ownerUserId, t.actorKind, t.createdAt.desc())
      .where(sql`${t.undoable} AND ${t.undoneAt} IS NULL`),
    index('change_sets_entity_idx').on(t.entityType, t.entityId, t.createdAt.desc()),
    uniqueIndex('change_sets_open_burst_uidx')
      .on(t.editorSessionId, t.entityType, t.entityId)
      .where(sql`${t.kind} = 'autosave_burst' AND ${t.closedAt} IS NULL`),
    check('change_sets_undo_chk', sql`${t.kind} NOT IN ('undo', 'redo') OR ${t.undoOfChangeSetId} IS NOT NULL`),
    check('change_sets_rollback_chk', sql`${t.kind} <> 'rollback' OR ${t.rollbackToAt} IS NOT NULL`),
  ],
);

/**
 * Coalesced revisions of long-form content (TipTap docs, descriptions, manual notes): one row
 * per editor burst (~30 s), not per keystroke. Audit rows reference these instead of copying
 * large documents.
 */
export const contentRevisions = pgTable(
  'content_revisions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ownerUserId: ownerUserId(),
    /** Root table name: 'drafts', 'work_items', 'source_items' (manual notes), 'activity_entries'. */
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    field: text('field').notNull(),
    revision: integer('revision').notNull(),
    docJson: jsonb('doc_json').$type<Record<string, unknown>>(),
    text: text('text'),
    contentHash: text('content_hash').notNull(),
    actorKind: actorKind('actor_kind').notNull(),
    editorSessionId: text('editor_session_id'),
    changeSetId: uuid('change_set_id').references(() => changeSets.id, { onDelete: 'set null' }),
    startedAt: tstz('started_at').notNull().defaultNow(),
    lastSavedAt: tstz('last_saved_at').notNull().defaultNow(),
    saveCount: integer('save_count').notNull().default(1),
    closedAt: tstz('closed_at'),
  },
  (t) => [
    uniqueIndex('content_revisions_entity_field_revision_uidx').on(t.entityType, t.entityId, t.field, t.revision),
    index('content_revisions_entity_saved_idx').on(t.entityType, t.entityId, t.lastSavedAt.desc()),
    uniqueIndex('content_revisions_open_burst_uidx')
      .on(t.entityType, t.entityId, t.field, t.editorSessionId)
      .where(sql`${t.closedAt} IS NULL`),
    check('content_revisions_payload_chk', sql`num_nonnulls(${t.docJson}, ${t.text}) = 1`),
  ],
);

/**
 * Every backend change to curated tables, by any actor (user, engine, chat, connector), written
 * by a trigger (0002_extras.sql) from the `cc.change_set_id` / `cc.actor_*` GUCs. One row per
 * (change set, table, row): repeated writes inside an open change set coalesce (before = first
 * image, after = latest). Immutable once the change set closes.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    changeSetId: uuid('change_set_id')
      .notNull()
      .references(() => changeSets.id, { onDelete: 'restrict' }),
    actorKind: actorKind('actor_kind').notNull(),
    actorRef: text('actor_ref'),
    tableName: text('table_name').notNull(),
    rowId: text('row_id').notNull(),
    /** Root aggregate for history views (evidence row -> its work item). */
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    op: auditOp('op').notNull(),
    changedFields: textArray('changed_fields'),
    /** Inverse/undo payload: the row image before the change set touched it. */
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    coalescedCount: integer('coalesced_count').notNull().default(1),
    /** Outbound decisions (tenet: Audit everything outbound). */
    destination: text('destination'),
    payloadHash: text('payload_hash'),
    createdAt: createdAt(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('audit_events_change_set_row_uidx').on(t.changeSetId, t.tableName, t.rowId),
    index('audit_events_entity_idx').on(t.entityType, t.entityId, t.createdAt.desc()),
    index('audit_events_row_idx').on(t.tableName, t.rowId, t.createdAt.desc()),
    index('audit_events_owner_created_idx').on(t.ownerUserId, t.createdAt.desc()),
  ],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type ChangeSet = typeof changeSets.$inferSelect;
