/** Priority runs, scores, rule hits and day-plan steps (section 8; R-UI-4, R-UI-16). */
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstz, ownerUserId, scorePart } from './columns';
import {
  priorityTrigger,
  priorityLane,
  planStepMode,
} from './enums';
import { priorityPolicies, priorityPolicyRules } from './settings';
import { calendarEvents } from './calendar';
import { workItems } from './work';

export const priorityRuns = pgTable(
  'priority_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ownerUserId: ownerUserId(),
    trigger: priorityTrigger('trigger').notNull(),
    engineVersion: text('engine_version').notNull(),
    /**
     * The user's policy version this run applied (R-UI-16). Cascade (INTEGRATE-1, migration 0006): a
     * policy version row is only ever deleted by undoing the change set that created it, and the rankings
     * computed under it are derived engine output (unaudited, B5) that goes with it.
     */
    policyId: uuid('policy_id')
      .notNull()
      .references(() => priorityPolicies.id, { onDelete: 'cascade' }),
    startedAt: tstz('started_at').notNull().defaultNow(),
    finishedAt: tstz('finished_at'),
    itemsConsidered: integer('items_considered').notNull().default(0),
    itemsChanged: integer('items_changed').notNull().default(0),
    /** Free focus minutes left today after meetings (calendar-aware). */
    availableFocusMinutes: integer('available_focus_minutes'),
    nextMeetingAt: tstz('next_meeting_at'),
  },
  (t) => [index('priority_runs_owner_finished_idx').on(t.ownerUserId, t.finishedAt.desc())],
);

/** One row per (run, item) whose inputs changed; components are explicit columns (tenet: Legible). */
export const priorityScores = pgTable(
  'priority_scores',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: bigint('run_id', { mode: 'number' })
      .notNull()
      .references(() => priorityRuns.id, { onDelete: 'cascade' }),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    /** Denormalized from the run so a score row explains itself in that policy's terms (cascade: see the run). */
    policyId: uuid('policy_id')
      .notNull()
      .references(() => priorityPolicies.id, { onDelete: 'cascade' }),
    total: numeric('total', { precision: 8, scale: 3, mode: 'number' }).notNull(),
    deadlineProximity: scorePart('deadline_proximity'),
    calendarPressure: scorePart('calendar_pressure'),
    leadTime: scorePart('lead_time'),
    effortFit: scorePart('effort_fit'),
    stakeholderImportance: scorePart('stakeholder_importance'),
    dealValue: scorePart('deal_value'),
    commitmentWeight: scorePart('commitment_weight'),
    staleness: scorePart('staleness'),
    /** DC/logging comp-linked boost, mandatory trainings. */
    obligationBoost: scorePart('obligation_boost'),
    userAdjustment: scorePart('user_adjustment'),
    penalty: scorePart('penalty'),
    lane: priorityLane('lane').notNull(),
    rank: integer('rank'),
    /** deadline - lead time - buffer: the "kick off the long build first" signal. */
    latestStartAt: tstz('latest_start_at'),
    slackMinutes: integer('slack_minutes'),
    inputsHash: text('inputs_hash').notNull(),
    explanation: text('explanation').notNull(),
    computedAt: tstz('computed_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('priority_scores_run_item_uidx').on(t.runId, t.workItemId),
    index('priority_scores_item_computed_idx').on(t.workItemId, t.computedAt.desc()),
  ],
);

/** Which policy rules fired for a score, with the user-facing explanation. */
export const priorityScoreRuleHits = pgTable(
  'priority_score_rule_hits',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    scoreId: bigint('score_id', { mode: 'number' })
      .notNull()
      .references(() => priorityScores.id, { onDelete: 'cascade' }),
    /** Cascade with the rule's policy version (see priority_runs.policy_id). */
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => priorityPolicyRules.id, { onDelete: 'cascade' }),
    effect: numeric('effect', { precision: 7, scale: 3, mode: 'number' }),
    explanation: text('explanation').notNull(),
  },
  (t) => [uniqueIndex('priority_score_rule_hits_score_rule_uidx').on(t.scoreId, t.ruleId)],
);

export const priorityPlanSteps = pgTable(
  'priority_plan_steps',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: bigint('run_id', { mode: 'number' })
      .notNull()
      .references(() => priorityRuns.id, { onDelete: 'cascade' }),
    ordinal: smallint('ordinal').notNull(),
    workItemId: uuid('work_item_id').references(() => workItems.id, { onDelete: 'cascade' }),
    calendarEventId: uuid('calendar_event_id').references(() => calendarEvents.id, { onDelete: 'cascade' }),
    mode: planStepMode('mode').notNull(),
    plannedStartAt: tstz('planned_start_at'),
    plannedEndAt: tstz('planned_end_at'),
    reason: text('reason').notNull(),
  },
  (t) => [
    uniqueIndex('priority_plan_steps_run_ordinal_uidx').on(t.runId, t.ordinal),
    check('priority_plan_steps_target_chk', sql`num_nonnulls(${t.workItemId}, ${t.calendarEventId}) >= 1`),
  ],
);
