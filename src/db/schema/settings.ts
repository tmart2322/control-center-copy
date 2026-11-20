/** Per-user settings, autonomy, priority policy and agent behavior (sections 1 and 1b; R-UI-16). */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstz, createdAt, updatedAt, ownerUserId, confidence, textArray } from './columns';
import {
  sourceSystem,
  workItemKind,
  interestKind,
  configSource,
  policyStatus,
  policyRuleKind,
  captureAction,
  priorityLane,
  draftActionType,
  autonomyLevel,
} from './enums';
import { teamPacks } from './core';
import { changeSets } from './audit';

/** Misc user settings (quiet hours, caps like weekly 50 h / daily 11 h, UI prefs). */
export const userSettings = pgTable(
  'user_settings',
  {
    ownerUserId: ownerUserId(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.ownerUserId, t.key] })],
);

/** Autonomy ladder per action type. Raised only by the user (tenet: Nothing leaves without approval). */
export const autonomyPolicies = pgTable(
  'autonomy_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    actionType: draftActionType('action_type').notNull(),
    level: autonomyLevel('level').notNull().default('L1_draft'),
    /** Optional narrowing, e.g. a single canvas id for canvas_rewrite. */
    targetExternalId: text('target_external_id'),
    note: text('note'),
    setByUserAt: tstz('set_by_user_at').notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('autonomy_policies_owner_action_target_uq')
      .on(t.ownerUserId, t.actionType, t.targetExternalId)
      .nullsNotDistinct(),
  ],
);

/** Role starting points. Seeds are copied into per-user rows on adoption, then diverge. */
export const roleTemplates = pgTable(
  'role_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamPackId: uuid('team_pack_id').references(() => teamPacks.id, { onDelete: 'set null' }),
    /** 'se_ic', 'se_manager', ... */
    key: text('key').notNull(),
    version: text('version').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** Same shape as priority_policies + priority_policy_rules (zod). */
    priorityPolicySeed: jsonb('priority_policy_seed').$type<Record<string, unknown>>().notNull(),
    /** Capture rules, autonomy defaults, voice defaults, watch defaults (zod). */
    agentPreferenceSeed: jsonb('agent_preference_seed').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('role_templates_key_version_uidx').on(t.key, t.version)],
);

/** Versioned per-user priority policy. Exactly one active version per user. */
export const priorityPolicies = pgTable(
  'priority_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    version: integer('version').notNull(),
    status: policyStatus('status').notNull().default('draft'),
    basedOnPolicyId: uuid('based_on_policy_id').references((): AnyPgColumn => priorityPolicies.id, {
      onDelete: 'set null',
    }),
    roleTemplateId: uuid('role_template_id').references(() => roleTemplates.id, { onDelete: 'set null' }),
    // One weight per priority_scores component.
    weightDeadlineProximity: numeric('weight_deadline_proximity', { precision: 5, scale: 3, mode: 'number' }).notNull().default(1),
    weightCalendarPressure: numeric('weight_calendar_pressure', { precision: 5, scale: 3, mode: 'number' }).notNull().default(1),
    weightLeadTime: numeric('weight_lead_time', { precision: 5, scale: 3, mode: 'number' }).notNull().default(1),
    weightEffortFit: numeric('weight_effort_fit', { precision: 5, scale: 3, mode: 'number' }).notNull().default(1),
    weightStakeholderImportance: numeric('weight_stakeholder_importance', { precision: 5, scale: 3, mode: 'number' }).notNull().default(1),
    weightDealValue: numeric('weight_deal_value', { precision: 5, scale: 3, mode: 'number' }).notNull().default(1),
    weightCommitment: numeric('weight_commitment', { precision: 5, scale: 3, mode: 'number' }).notNull().default(1),
    weightStaleness: numeric('weight_staleness', { precision: 5, scale: 3, mode: 'number' }).notNull().default(1),
    weightObligation: numeric('weight_obligation', { precision: 5, scale: 3, mode: 'number' }).notNull().default(1),
    top3Size: smallint('top3_size').notNull().default(3),
    /** Why this version exists ("Raised manager asks to 24h SLA, per chat 11/05"). */
    changeSummary: text('change_summary').notNull(),
    source: configSource('source').notNull(),
    changeSetId: uuid('change_set_id').references((): AnyPgColumn => changeSets.id, { onDelete: 'set null' }),
    activatedAt: tstz('activated_at'),
    retiredAt: tstz('retired_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('priority_policies_owner_version_uidx').on(t.ownerUserId, t.version),
    uniqueIndex('priority_policies_owner_active_uidx').on(t.ownerUserId).where(sql`${t.status} = 'active'`),
    check('priority_policies_active_chk', sql`${t.status} <> 'active' OR ${t.activatedAt} IS NOT NULL`),
  ],
);

/** Declarative rules ("customer-facing > internal", "manager asks within 24h"), each self-explaining. */
export const priorityPolicyRules = pgTable(
  'priority_policy_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    policyId: uuid('policy_id')
      .notNull()
      .references(() => priorityPolicies.id, { onDelete: 'cascade' }),
    ordinal: smallint('ordinal').notNull(),
    /** Stable across versions, so diffs and explanations can follow a rule. */
    ruleKey: text('rule_key').notNull(),
    label: text('label').notNull(),
    /** Rendered into "why": "Ranked up: your rule 'my manager's asks within 24h'". */
    explanation: text('explanation').notNull(),
    kind: policyRuleKind('kind').notNull(),
    /** Predicate DSL over work-item features (zod): {all:[{field:'customer_facing',eq:true}]}. */
    condition: jsonb('condition').$type<Record<string, unknown>>().notNull(),
    /** never_above: the set this rule protects (e.g. customer prep). */
    otherCondition: jsonb('other_condition').$type<Record<string, unknown>>(),
    effectValue: numeric('effect_value', { precision: 7, scale: 3, mode: 'number' }),
    effectLane: priorityLane('effect_lane'),
    slaHours: integer('sla_hours'),
    enabled: boolean('enabled').notNull().default(true),
    source: configSource('source').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('priority_policy_rules_policy_key_uidx').on(t.policyId, t.ruleKey),
    uniqueIndex('priority_policy_rules_policy_ordinal_uidx').on(t.policyId, t.ordinal),
    check(
      'priority_policy_rules_effect_chk',
      sql`(${t.kind} NOT IN ('boost', 'penalty') OR ${t.effectValue} IS NOT NULL)
        AND (${t.kind} <> 'sla' OR ${t.slaHours} IS NOT NULL)
        AND (${t.kind} NOT IN ('lane_floor', 'lane_cap') OR ${t.effectLane} IS NOT NULL)
        AND (${t.kind} <> 'never_above' OR ${t.otherCondition} IS NOT NULL)`,
    ),
  ],
);

/** "What counts as a task" for this user (D-25/D-41 become editable rules). */
export const taskCaptureRules = pgTable(
  'task_capture_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    ruleKey: text('rule_key').notNull(),
    label: text('label').notNull(),
    explanation: text('explanation').notNull(),
    /** null = any source. */
    sourceScope: sourceSystem('source_scope'),
    condition: jsonb('condition').$type<Record<string, unknown>>().notNull(),
    action: captureAction('action').notNull(),
    /** auto_accept only above this extraction confidence. */
    minConfidence: confidence('min_confidence'),
    targetKind: workItemKind('target_kind'),
    ordinal: smallint('ordinal').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    source: configSource('source').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('task_capture_rules_owner_key_uidx').on(t.ownerUserId, t.ruleKey),
    index('task_capture_rules_owner_ordinal_idx').on(t.ownerUserId, t.ordinal).where(sql`${t.enabled}`),
  ],
);

/** Voice + drafting style, learned from sent messages and edited in Settings/chat. Versioned. */
export const voiceProfiles = pgTable(
  'voice_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    version: integer('version').notNull(),
    status: policyStatus('status').notNull().default('draft'),
    source: configSource('source').notNull(),
    tone: text('tone'),
    /** 1 casual … 5 formal */
    formality: smallint('formality').notNull().default(2),
    /** 1 terse … 5 thorough */
    verbosity: smallint('verbosity').notNull().default(2),
    /** 0 never … 3 often */
    emojiUse: smallint('emoji_use').notNull().default(1),
    greeting: text('greeting'),
    signoff: text('signoff'),
    phrasesToUse: textArray('phrases_to_use'),
    phrasesToAvoid: textArray('phrases_to_avoid'),
    /** Free-form drafting instructions the user can edit. */
    styleGuide: text('style_guide'),
    slackGuide: text('slack_guide'),
    emailGuide: text('email_guide'),
    learnedFromMessageCount: integer('learned_from_message_count').notNull().default(0),
    changeSummary: text('change_summary').notNull(),
    changeSetId: uuid('change_set_id').references((): AnyPgColumn => changeSets.id, { onDelete: 'set null' }),
    activatedAt: tstz('activated_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('voice_profiles_owner_version_uidx').on(t.ownerUserId, t.version),
    uniqueIndex('voice_profiles_owner_active_uidx').on(t.ownerUserId).where(sql`${t.status} = 'active'`),
    check(
      'voice_profiles_scales_chk',
      sql`${t.formality} BETWEEN 1 AND 5 AND ${t.verbosity} BETWEEN 1 AND 5 AND ${t.emojiUse} BETWEEN 0 AND 3`,
    ),
  ],
);

/** Skills / products / topics the user cares about (relevance input, R-UI-16/21). */
export const userInterests = pgTable(
  'user_interests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    kind: interestKind('kind').notNull(),
    value: text('value').notNull(),
    weight: numeric('weight', { precision: 5, scale: 3, mode: 'number' }).notNull().default(1),
    source: configSource('source').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('user_interests_owner_kind_value_uidx').on(t.ownerUserId, t.kind, sql`lower(value)`)],
);
