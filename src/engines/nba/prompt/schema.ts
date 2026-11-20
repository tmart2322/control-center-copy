import { z } from 'zod';
import { tipTapDocSchema } from './tiptap';
import { CONFIDENCE, NBA_VERBS } from './types';

/**
 * NBA output contract (one JSON object per call). The envelope is shared by every verb;
 * `draft` and `plan` vary by verb (see VERB_SPECS in ./verbs.ts).
 *
 * Validation happens in two layers:
 *  1. this zod schema (shape, lengths, enums);
 *  2. semantic checks in ./validate.ts against the input (sources exist, the user-touched draft is
 *     not overwritten, links were not invented, dates are supported, ...).
 * Nothing reaches the DB unless both pass (R-UI-19 "LLM output validated against a schema").
 */

export const verbSchema = z.enum(NBA_VERBS);
export const confidenceSchema = z.enum(CONFIDENCE);

const isoish = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/, 'expected an ISO-8601 date or datetime');

export const destinationOutSchema = z.object({
  channel: z.enum(['slack', 'email']),
  label: z.string().min(1).max(120),
  targetId: z.string().nullish(),
  threadRef: z.string().nullish(),
  subject: z.string().max(160).nullish(),
  to: z.array(z.string()).nullish(),
  cc: z.array(z.string()).nullish(),
});

export const draftSchema = z.object({
  destination: destinationOutSchema,
  doc: tipTapDocSchema,
});

// ---------- Plans, one shape per verb ----------

export const claudeSessionPlanSchema = z.object({
  kind: z.literal('claude_session'),
  /** Absolute repo path, or null when unknown (then an ask is required). */
  folder: z.string().nullable(),
  /** Context-packed prompt for claude://code/new. Must carry the [cc:<work_item_id>] tag. */
  prompt: z.string().min(40).max(14336),
  successCriteria: z.array(z.string().min(3)).min(1).max(8),
  contextPack: z.array(z.object({ label: z.string(), ref: z.string() })).max(20),
  /** True when it can run while the user does other things (kick off first). */
  background: z.boolean(),
  checkpoints: z.array(z.string()).max(6).default([]),
});

export const toolRunPlanSchema = z.object({
  kind: z.literal('tool_run'),
  toolId: z.string().min(1),
  inputs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])),
  missingInputs: z.array(z.string()).default([]),
  expectedOutput: z.string().min(3).max(300),
  background: z.boolean(),
});

export const activityRowSchema = z.object({
  blockId: z.string().min(1),
  date: isoish,
  start: isoish,
  end: isoish,
  subject: z.string().min(3).max(120),
  seTaskType: z.string().min(2),
  customerFacing: z.boolean(),
  counts: z.enum(['CF+CR', 'CR', 'neither']),
  relatedTo: z.object({
    type: z.enum(['opportunity', 'account', 'dsr', 'strategic_initiative', 'catch_all', 'unknown']),
    id: z.string().optional(),
    name: z.string(),
  }),
  description: z.string().max(400),
  evidenceIds: z.array(z.string()).min(1),
  confidence: confidenceSchema,
});

export const activityPlanSchema = z.object({
  kind: z.literal('activity_rows'),
  rows: z.array(activityRowSchema).max(40),
  skipped: z.array(z.object({ blockId: z.string(), reason: z.string() })).default([]),
  handoff: z.enum(['slackbot_skill', 'activity_editor', 'csv']),
  totalHours: z.number().min(0),
});

export const vdpPlanSchema = z.object({
  kind: z.literal('vdp_patch'),
  vdp: z.object({ id: z.string().optional(), url: z.string().optional(), accountName: z.string() }),
  changes: z
    .array(
      z.object({
        section: z.enum(['header', 'use_case', 'qualification', 'linkage', 'assets', 'dc_notes']),
        field: z.string().min(1),
        op: z.enum(['set', 'add', 'append']),
        value: z.string().min(1).max(1200),
        evidenceIds: z.array(z.string()).min(1),
      }),
    )
    .max(20),
  followUps: z.array(z.string()).max(6).default([]),
});

export const schedulePlanSchema = z.object({
  kind: z.literal('calendar_hold'),
  title: z.string().min(3).max(120),
  durationMin: z.number().int().min(5).max(480),
  attendees: z.array(z.string()).max(20),
  candidateSlots: z.array(z.object({ start: isoish, end: isoish, why: z.string().max(140) })).max(4),
  hold: z.enum(['private_focus', 'meeting_invite']),
  notes: z.string().max(400).default(''),
});

export const deliverableReviewPlanSchema = z.object({
  kind: z.literal('deliverable_review'),
  file: z.object({ id: z.string(), title: z.string(), url: z.string().optional() }),
  checklist: z
    .array(
      z.object({
        requested: z.string().min(2),
        status: z.enum(['made', 'partial', 'missing', 'unknown']),
        evidence: z.string().max(240),
        evidenceIds: z.array(z.string()).default([]),
      }),
    )
    .min(1)
    .max(20),
  verdict: z.enum(['likely_done', 'in_progress', 'not_started', 'unknown']),
  nextStep: z.string().min(3).max(240),
});

export const planSchema = z.discriminatedUnion('kind', [
  claudeSessionPlanSchema,
  toolRunPlanSchema,
  activityPlanSchema,
  vdpPlanSchema,
  schedulePlanSchema,
  deliverableReviewPlanSchema,
]);
export type NbaPlan = z.infer<typeof planSchema>;

// ---------- Envelope ----------

export const alternativeSchema = z.object({
  verb: verbSchema,
  title: z.string().min(3).max(90),
  why: z.string().min(3).max(140),
});

export const askSchema = z.object({
  question: z.string().min(5).max(240),
  /** Who can answer: "you", or a person's name. */
  to: z.string().min(1).max(80),
  blocking: z.boolean(),
});

export const diffEntrySchema = z.object({
  field: z.string().min(1),
  before: z.string().max(600),
  after: z.string().max(600),
});

export const updateSchema = z.object({
  /** One line: what changed and why ("Dana added pricing to scope → draft adds the pricing slide"). */
  summary: z.string().min(3).max(200),
  /** Evidence ids that caused the change (usually the isNew ones). */
  triggeredBy: z.array(z.string()),
  diff: z.array(diffEntrySchema).max(12),
  /**
   * replaced_untouched: the old draft was never edited, so the new draft replaces it.
   * proposal: the user edited the draft; `draft` is null and the change is offered as a proposal.
   * unchanged: the new evidence does not change the action.
   */
  draftPolicy: z.enum(['replaced_untouched', 'proposal', 'unchanged', 'no_draft']),
  proposal: z
    .object({
      doc: tipTapDocSchema,
      rationale: z.string().min(3).max(200),
    })
    .nullable()
    .default(null),
});

export const nbaOutputSchema = z.object({
  verb: verbSchema,
  /** Verb-first, ≤ 90 chars: "Reply to Dana: confirm Thursday demo scope". */
  title: z.string().min(3).max(90),
  /** ONE line, ≤ 140 chars. */
  why: z.string().min(3).max(140),
  confidence: confidenceSchema,
  alternatives: z.array(alternativeSchema).max(3).default([]),
  draft: draftSchema.nullable().default(null),
  plan: planSchema.nullable().default(null),
  effort: z.object({ youMin: z.number().int().min(0).max(600), agentMin: z.number().int().min(0).max(2880) }),
  /** Models sometimes return null for "no time pressure"; normalize instead of failing the call. */
  startBy: z.preprocess(
    (v) => (v === null || v === undefined ? { at: null, reasoning: 'No time pressure in the inputs' } : v),
    z.object({ at: isoish.nullable(), reasoning: z.string().min(3).max(280) }),
  ),
  sources: z.array(z.string().min(1)).min(1),
  asks: z.array(askSchema).max(5).default([]),
  /** 0-100: how ready-to-go this is (next_best_actions.completeness). */
  completeness: z.number().int().min(0).max(100),
  update: updateSchema.nullable().default(null),
});

export type NbaOutput = z.infer<typeof nbaOutputSchema>;
export type NbaDraft = z.infer<typeof draftSchema>;
export type NbaUpdate = z.infer<typeof updateSchema>;
