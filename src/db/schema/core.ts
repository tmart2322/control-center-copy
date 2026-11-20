/** Identity and team pack (DATA-MODEL §3.1 section 1): users and the shared team-pack vocabularies. */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstz, createdAt, updatedAt, bindUsersId } from './columns';
import {
  teamRuleKind,
  taskTypeBucket,
} from './enums';
import { roleTemplates } from './settings';
import { people } from './entities';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  timezone: text('timezone').notNull().default('America/Denver'),
  /** The user's own row in `people` (drives from_me detection via person_identities). */
  personId: uuid('person_id').references((): AnyPgColumn => people.id, { onDelete: 'set null' }),
  teamPackId: uuid('team_pack_id').references((): AnyPgColumn => teamPacks.id, { onDelete: 'set null' }),
  /** Role starting point (SE IC, SE manager, ...) the user's policies were seeded from (R-UI-16). */
  roleTemplateId: uuid('role_template_id').references((): AnyPgColumn => roleTemplates.id, {
    onDelete: 'set null',
  }),
  /** Used by policy rules such as "my manager's asks within 24h". */
  managerPersonId: uuid('manager_person_id').references((): AnyPgColumn => people.id, { onDelete: 'set null' }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

bindUsersId(() => users.id);

/** Versioned team pack directory (team-packs/<slug>/), loaded at startup. */
export const teamPacks = pgTable(
  'team_packs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    version: text('version').notNull(),
    name: text('name').notNull(),
    sourcePath: text('source_path').notNull(),
    contentHash: text('content_hash').notNull(),
    /** Raw pack for settings not yet normalized (Slackbot skill names, doc links). */
    raw: jsonb('raw').$type<Record<string, unknown>>().notNull().default({}),
    loadedAt: tstz('loaded_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('team_packs_slug_version_uidx').on(t.slug, t.version)],
);

/** SE_Task_Type__c values, verbatim from the team's task-type canvas via the team pack. */
export const seTaskTypes = pgTable(
  'se_task_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamPackId: uuid('team_pack_id')
      .notNull()
      .references(() => teamPacks.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    countsCustomerRelated: boolean('counts_customer_related').notNull(),
    countsCustomerFacing: boolean('counts_customer_facing').notNull(),
    bucket: taskTypeBucket('bucket').notNull(),
    /** Type to use when an external attendee is present (CF swap). */
    externalSwapToId: uuid('external_swap_to_id').references((): AnyPgColumn => seTaskTypes.id, {
      onDelete: 'set null',
    }),
    /** Type to use when a CF type turns out to be internal-only. */
    internalDowngradeToId: uuid('internal_downgrade_to_id').references((): AnyPgColumn => seTaskTypes.id, {
      onDelete: 'set null',
    }),
    requiresMeetingType: boolean('requires_meeting_type').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    ordinal: integer('ordinal').notNull().default(0),
  },
  (t) => [uniqueIndex('se_task_types_pack_name_uidx').on(t.teamPackId, t.name)],
);

/** Other Org62 picklists the payload needs (Meeting_Type__c, ProductCategory__c). */
export const org62PicklistValues = pgTable(
  'org62_picklist_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamPackId: uuid('team_pack_id')
      .notNull()
      .references(() => teamPacks.id, { onDelete: 'cascade' }),
    field: text('field').notNull(),
    value: text('value').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ordinal: integer('ordinal').notNull().default(0),
  },
  (t) => [uniqueIndex('org62_picklist_values_pack_field_value_uidx').on(t.teamPackId, t.field, t.value)],
);

/** Fiscal calendar + logging deadlines + hours targets (team pack). */
export const fiscalPeriods = pgTable(
  'fiscal_periods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamPackId: uuid('team_pack_id')
      .notNull()
      .references(() => teamPacks.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    fiscalYear: smallint('fiscal_year').notNull(),
    fiscalQuarter: smallint('fiscal_quarter').notNull(),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    loggingDeadlineAt: tstz('logging_deadline_at'),
    deadlineAssumed: boolean('deadline_assumed').notNull().default(false),
    deadlineNote: text('deadline_note'),
    hoursTarget: numeric('hours_target', { precision: 6, scale: 2, mode: 'number' }),
  },
  (t) => [
    uniqueIndex('fiscal_periods_pack_fy_q_uidx').on(t.teamPackId, t.fiscalYear, t.fiscalQuarter),
    check('fiscal_periods_quarter_chk', sql`${t.fiscalQuarter} BETWEEN 1 AND 4`),
    check('fiscal_periods_range_chk', sql`${t.endsOn} >= ${t.startsOn}`),
  ],
);

/** Team-pack rules that generate system work items ("Friday logging", "DC per engaged opp"). */
export const teamRules = pgTable(
  'team_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamPackId: uuid('team_pack_id')
      .notNull()
      .references(() => teamPacks.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    kind: teamRuleKind('kind').notNull(),
    /** RRULE or cron, interpreted in the user's timezone. */
    schedule: text('schedule'),
    /** Rule-specific parameters (zod-validated per kind). */
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => [uniqueIndex('team_rules_pack_key_uidx').on(t.teamPackId, t.key)],
);

export type User = typeof users.$inferSelect;
