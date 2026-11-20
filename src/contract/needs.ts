/**
 * Needs you: one mechanism to resolve or set aside every "needs you" row (Deals ▸ Log & fix, Think ahead and
 * Waiting, the account page's need, the account panel, Home ▸ Log & fix). Nothing a rule raises is left stranded in
 * the UI: each row says how it can be set aside (`NeedResolve`), and the choice is stored as a decision per subject.
 *
 *   snooze       hidden until `until` (Snooze 1 week, Not now): the row comes back by itself.
 *   not_needed   hidden with a reason ("Not my deal", "Too small", …) until something material changes, as the rule
 *                says (a DC gap: I join the opp team, or log 2 h more on it; a Home row: a new subject appears).
 *
 * A decision is keyed by (rule, subjectId): one per opp for a DC gap, one per account for Think ahead and Waiting, one
 * per Home row. Every decision is one audited, undoable change set; the Assistant reads them (listNeedDecisions)
 * and stages them (decideNeed, clearNeedDecision) like any other change.
 */
import { z } from 'zod';
import { Id, IsoDateTime } from './common';

/**
 * The rule a decision belongs to: `dc_gap` (subject: the opp), `deals_ahead` and `deals_chase` (subject: the
 * account), `home:<gap rule>` (subject: the Home row id, e.g. `home:missed_dc` / `gap:missed_dc`).
 */
export const NeedRule = z.string().trim().min(2).max(60).regex(/^[a-z_]+(?::[a-z0-9_]+)?$/, 'a rule id: dc_gap, deals_ahead, deals_chase or home:<rule>');
export type NeedRule = z.infer<typeof NeedRule>;

export const NeedDecisionKind = z.enum(['snooze', 'not_needed']);
export type NeedDecisionKind = z.infer<typeof NeedDecisionKind>;

/** What a rule compares against when it decides a dismissed row has changed enough to come back. */
export const NeedBaseline = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));
export type NeedBaseline = z.infer<typeof NeedBaseline>;

export const NeedDecision = z.object({
  rule: NeedRule,
  subjectId: Id,
  kind: NeedDecisionKind,
  /** Snooze: when the row comes back. */
  until: IsoDateTime.nullable().default(null),
  /** Not needed: why ("Not my deal", "Already covered by a teammate", "Too small", "Other"). */
  reason: z.string().nullable().default(null),
  /** What the row was about when it was set aside ("ACME – Data 360 Expansion"), for the list and the Assistant. */
  label: z.string().nullable().default(null),
  /** The rule's facts at decision time (a DC gap: on the team, hours this quarter). */
  baseline: NeedBaseline.default({}),
  decidedAt: IsoDateTime,
});
export type NeedDecision = z.infer<typeof NeedDecision>;

export const NeedDecisionsPayload = z.object({ decisions: z.array(NeedDecision) });
export type NeedDecisionsPayload = z.infer<typeof NeedDecisionsPayload>;

/** How a row can be set aside: the rule, its subjects, Snooze and/or Not needed (with the reasons offered). */
export const NeedResolve = z.object({
  rule: NeedRule,
  /** One decision per subject (a DC gap row on an account: one per opp it names). */
  subjectIds: z.array(Id).min(1),
  /** Snooze 1 week (Deals) / Not now (Home). */
  snooze: z.boolean(),
  /** Not needed, with these reasons (empty: not offered; the row is real outstanding work). */
  reasons: z.array(z.string()),
  /** The facts a Not needed is compared against later (sent back with the decision). */
  baseline: NeedBaseline.default({}),
  /** What the subjects are, in words ("CUSTOMER_1 – Renewal"). */
  label: z.string().nullable().default(null),
});
export type NeedResolve = z.infer<typeof NeedResolve>;

export const DecideNeedRequest = z
  .object({
    rule: NeedRule,
    subjectIds: z.array(Id).min(1),
    kind: NeedDecisionKind,
    /** Snooze: ISO instant it comes back (default: a week from now). */
    until: IsoDateTime.optional(),
    /** Not needed: the reason (required). */
    reason: z.string().trim().min(2).max(200).optional(),
    label: z.string().trim().max(200).optional(),
    /** The row's `resolve.baseline` (a DC gap's is read on the server). */
    baseline: NeedBaseline.optional(),
  })
  .refine((b) => b.kind !== 'not_needed' || !!b.reason, { message: 'Not needed takes a reason', path: ['reason'] });
export type DecideNeedRequest = z.infer<typeof DecideNeedRequest>;

/** Bring rows back: drop the decisions on these subjects (Undo does the same for the last decision). */
export const ClearNeedRequest = z.object({ rule: NeedRule, subjectIds: z.array(Id).min(1) });
export type ClearNeedRequest = z.infer<typeof ClearNeedRequest>;

/** The reasons a DC gap's Not needed offers (Deals ▸ Log & fix, the account page, the account panel). */
export const DC_GAP_REASONS = ['Not my deal', 'Already covered by a teammate', 'Too small', 'Other'] as const;
/** The reasons a Think ahead or Waiting row's Not needed offers. */
export const DEALS_ROW_REASONS = ['Already handled', 'Not my deal', 'Other'] as const;
/** The reasons a Home Log & fix row's Not needed offers (rules that can be "not needed": a missed-opp claim, a deal role, a missing forecast). */
export const HOME_GAP_REASONS = ['Not mine', 'Already handled', 'Not needed for this deal', 'Other'] as const;

/** A week from `now` (Snooze 1 week). */
export const SNOOZE_MS = 7 * 24 * 3_600_000;
