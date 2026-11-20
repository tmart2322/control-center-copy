/**
 * Per-user priority policy (R-UI-16): versioned weights plus declarative, self-explaining rules.
 * Mirrors `priority_policies` (one weight per `priority_scores` component, `top3_size`) and
 * `priority_policy_rules` (rule_key, label, explanation, kind, condition DSL, effect_*, sla_hours).
 * `tuning` holds the engine thresholds that are versioned with the policy (a change re-ranks).
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Predicate DSL over work-item features: {all:[{field:'customer_facing',eq:true}]}
// ---------------------------------------------------------------------------

export const FEATURE_KEYS = [
  'kind',
  'status',
  'importance',
  'source',
  'customer_facing',
  'from_manager',
  'serves_meeting',
  'serves_external_meeting',
  'is_customer_prep',
  'is_training',
  'mandatory_training',
  'has_due',
  /** Hours until the item's own due date (negative = overdue; null = no due date). */
  'due_within_hours',
  /** Hours until the meeting it serves starts (null = serves none). */
  'meeting_within_hours',
  'age_days',
  'you_min',
  'agent_min',
  'stakeholder_tier',
  'has_opp',
  'account_id',
  'opp_id',
  'initiative_id',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

const Primitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type Primitive = z.infer<typeof Primitive>;

export const FieldPredicateSchema = z
  .object({
    field: z.enum(FEATURE_KEYS),
    eq: Primitive.optional(),
    ne: Primitive.optional(),
    in: z.array(Primitive).optional(),
    gte: z.number().optional(),
    lte: z.number().optional(),
    exists: z.boolean().optional(),
  })
  .strict();
export type FieldPredicate = z.infer<typeof FieldPredicateSchema>;

export type Predicate = FieldPredicate | { all: Predicate[] } | { any: Predicate[] } | { not: Predicate };

export const PredicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    FieldPredicateSchema,
    z.object({ all: z.array(PredicateSchema) }).strict(),
    z.object({ any: z.array(PredicateSchema) }).strict(),
    z.object({ not: PredicateSchema }).strict(),
  ]),
);

export type FeatureValues = Record<FeatureKey, Primitive>;

export function evalPredicate(p: Predicate, f: FeatureValues): boolean {
  if ('all' in p) return p.all.every((q) => evalPredicate(q, f));
  if ('any' in p) return p.any.some((q) => evalPredicate(q, f));
  if ('not' in p) return !evalPredicate(p.not, f);
  const v = f[p.field];
  if (p.exists !== undefined && (v !== null && v !== undefined) !== p.exists) return false;
  if (p.eq !== undefined && v !== p.eq) return false;
  if (p.ne !== undefined && v === p.ne) return false;
  if (p.in !== undefined && !p.in.includes(v)) return false;
  if (p.gte !== undefined && !(typeof v === 'number' && v >= p.gte)) return false;
  if (p.lte !== undefined && !(typeof v === 'number' && v <= p.lte)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

const Weight = z.number().min(0).max(10);

/** One weight per `priority_scores` component (`priority_policies.weight_*`). */
export const PolicyWeightsSchema = z
  .object({
    deadlineProximity: Weight,
    calendarPressure: Weight,
    leadTime: Weight,
    effortFit: Weight,
    stakeholderImportance: Weight,
    dealValue: Weight,
    commitment: Weight,
    staleness: Weight,
    obligation: Weight,
  })
  .strict();
export type PolicyWeights = z.infer<typeof PolicyWeightsSchema>;

const Lane = z.enum(['top3', 'now', 'next', 'later', 'background', 'hidden']);

export const PolicyRuleSchema = z
  .object({
    /** Stable across versions (`rule_key`), so diffs and explanations can follow a rule. */
    ruleKey: z.string().min(1),
    label: z.string().min(1),
    /** Rendered into "why": "Ranked up: your rule 'my manager's asks within 24h'". */
    explanation: z.string().min(1),
    kind: z.enum(['boost', 'penalty', 'sla', 'lane_floor', 'lane_cap', 'never_above', 'exclude']),
    condition: PredicateSchema,
    otherCondition: PredicateSchema.optional(),
    effectValue: z.number().min(-100).max(100).optional(),
    effectLane: Lane.optional(),
    slaHours: z.number().positive().optional(),
    enabled: z.boolean().default(true),
  })
  .strict()
  .superRefine((r, ctx) => {
    if ((r.kind === 'boost' || r.kind === 'penalty') && r.effectValue === undefined)
      ctx.addIssue({ code: 'custom', message: `${r.ruleKey}: ${r.kind} needs effectValue` });
    if (r.kind === 'sla' && r.slaHours === undefined) ctx.addIssue({ code: 'custom', message: `${r.ruleKey}: sla needs slaHours` });
    if ((r.kind === 'lane_floor' || r.kind === 'lane_cap') && r.effectLane === undefined)
      ctx.addIssue({ code: 'custom', message: `${r.ruleKey}: ${r.kind} needs effectLane` });
    if (r.kind === 'never_above' && r.otherCondition === undefined)
      ctx.addIssue({ code: 'custom', message: `${r.ruleKey}: never_above needs otherCondition` });
  });
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export const PolicyTuningSchema = z
  .object({
    /** Minutes of slack kept before a deadline ("deadline − lead − effort − buffer"). */
    bufferMin: z.number().min(0).max(240),
    /** Planning horizon in local days, today included (today + 3). */
    horizonDays: z.number().int().min(1).max(14),
    /** Items due within this many days (and not today) go to `next`. */
    nextDays: z.number().int().min(1).max(14),
    /** Pre-emption: "now late unless started" when start-by is within this many minutes. */
    preemptGraceMin: z.number().min(0).max(60),
    background: z
      .object({
        /** A commitment this old with no near deadline and a low score is a background promise. */
        afterDays: z.number().min(1),
        /** "Low priority" = total below this. */
        maxScore: z.number(),
      })
      .strict(),
    fitIn: z
      .object({
        maxYouMin: z.number().min(1).max(120),
        /** A training is promoted into the Top 3 only when due within this many hours (brief 08 §2.12). */
        promoteWithinHours: z.number().min(0),
        /** Non-training fit-ins must score at least this ("high priority"). */
        minScore: z.number(),
      })
      .strict(),
    sequencing: z
      .object({
        /** Kick-off-first applies to agent runs at least this long… */
        minAgentMin: z.number().min(0),
        /** …that serve a deadline within this many hours (R-UI-4). */
        horizonHours: z.number().min(1),
      })
      .strict(),
  })
  .strict();
export type PolicyTuning = z.infer<typeof PolicyTuningSchema>;

export const PriorityPolicySchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().min(1),
    name: z.string(),
    role: z.enum(['se_ic', 'se_manager', 'ae', 'custom']),
    weights: PolicyWeightsSchema,
    rules: z.array(PolicyRuleSchema),
    top3Size: z.number().int().min(1).max(5),
    tuning: PolicyTuningSchema,
    /** Why this version exists ("Raised manager asks to 24h SLA, per chat 11/05"). */
    changeSummary: z.string().default(''),
  })
  .strict()
  .superRefine((p, ctx) => {
    const seen = new Set<string>();
    for (const r of p.rules) {
      if (seen.has(r.ruleKey)) ctx.addIssue({ code: 'custom', message: `duplicate ruleKey ${r.ruleKey}` });
      seen.add(r.ruleKey);
    }
  });
export type PriorityPolicy = z.infer<typeof PriorityPolicySchema>;

/** Validate a policy from Settings, chat or a role template (zod at the boundary). */
export function parsePolicy(input: unknown): PriorityPolicy {
  return PriorityPolicySchema.parse(input);
}

// ---------------------------------------------------------------------------
// Defaults and role starting points
// ---------------------------------------------------------------------------

export const DEFAULT_TUNING: PolicyTuning = {
  bufferMin: 15,
  horizonDays: 4,
  nextDays: 3,
  preemptGraceMin: 5,
  background: { afterDays: 21, maxScore: 30 },
  fitIn: { maxYouMin: 30, promoteWithinHours: 48, minScore: 20 },
  sequencing: { minAgentMin: 30, horizonHours: 24 },
};

export const SE_IC_WEIGHTS: PolicyWeights = {
  deadlineProximity: 3,
  calendarPressure: 3,
  leadTime: 2,
  effortFit: 0.5,
  stakeholderImportance: 1.5,
  dealValue: 1,
  commitment: 1,
  staleness: 0.5,
  obligation: 1.5,
};

/** The four rules named in R-UI-16 plus the R-UI-2 training floor. */
export const RULE_CUSTOMER_FACING: PolicyRule = {
  ruleKey: 'customer_facing_over_internal',
  label: 'Customer-facing beats internal',
  explanation: "Ranked up: your rule 'customer-facing beats internal'",
  kind: 'boost',
  condition: { field: 'customer_facing', eq: true },
  effectValue: 12,
  enabled: true,
};

export const RULE_MANAGER_ASKS: PolicyRule = {
  ruleKey: 'manager_asks_within_24h',
  label: "My manager's asks within 24h",
  explanation: "Due within 24h of the ask: your rule 'my manager's asks within 24h'",
  kind: 'sla',
  condition: { field: 'from_manager', eq: true },
  slaHours: 24,
  effectValue: 8,
  enabled: true,
};

export const RULE_TRAININGS_BELOW_CUSTOMER_PREP: PolicyRule = {
  ruleKey: 'never_rank_trainings_above_customer_prep',
  label: 'Never rank trainings above customer prep',
  explanation: "Kept below customer prep: your rule 'never rank trainings above customer prep'",
  kind: 'never_above',
  condition: { field: 'is_training', eq: true },
  otherCondition: { field: 'is_customer_prep', eq: true },
  enabled: true,
};

export const RULE_EXTERNAL_ATTENDEES: PolicyRule = {
  ruleKey: 'external_attendee_boost',
  label: 'Prep for meetings with external attendees',
  explanation: "Ranked up: your rule 'prep for meetings with external attendees'",
  kind: 'boost',
  condition: { field: 'serves_external_meeting', eq: true },
  effectValue: 6,
  enabled: true,
};

export const RULE_MANDATORY_TRAININGS_TODAY: PolicyRule = {
  ruleKey: 'mandatory_trainings_today',
  label: "Trainings I'm behind on: recommend today",
  explanation: "Recommended today: your rule 'trainings I'm behind on'",
  kind: 'lane_floor',
  condition: {
    all: [
      { field: 'mandatory_training', eq: true },
      { field: 'due_within_hours', lte: 168 },
    ],
  },
  effectLane: 'now',
  enabled: true,
};

/** Role starting point: SE IC (Tristan). Copied into a per-user v1 on adoption, then diverges. */
export const SE_IC_POLICY: PriorityPolicy = {
  id: 'role:se_ic@1',
  version: 1,
  name: 'SE IC',
  role: 'se_ic',
  weights: SE_IC_WEIGHTS,
  rules: [
    RULE_CUSTOMER_FACING,
    RULE_MANAGER_ASKS,
    RULE_TRAININGS_BELOW_CUSTOMER_PREP,
    RULE_EXTERNAL_ATTENDEES,
    RULE_MANDATORY_TRAININGS_TODAY,
  ],
  top3Size: 3,
  tuning: DEFAULT_TUNING,
  changeSummary: 'Role template: SE IC',
};

/** Role starting point: SE manager. Team asks and deal value weigh more; customer prep less. */
export const SE_MANAGER_POLICY: PriorityPolicy = {
  id: 'role:se_manager@1',
  version: 1,
  name: 'SE manager',
  role: 'se_manager',
  weights: { ...SE_IC_WEIGHTS, stakeholderImportance: 2.5, dealValue: 2, leadTime: 1, obligation: 1 },
  rules: [
    { ...RULE_CUSTOMER_FACING, effectValue: 6 },
    {
      ruleKey: 'leader_asks_within_8h',
      label: "My leader's asks within 8h",
      explanation: "Due within 8h of the ask: your rule 'my leader's asks within 8h'",
      kind: 'sla',
      condition: { field: 'stakeholder_tier', eq: 'leader' },
      slaHours: 8,
      effectValue: 10,
      enabled: true,
    },
    {
      ruleKey: 'team_asks_within_24h',
      label: "My team's asks within 24h",
      explanation: "Due within 24h of the ask: your rule 'my team's asks within 24h'",
      kind: 'sla',
      condition: { all: [{ field: 'kind', eq: 'ask' }, { field: 'stakeholder_tier', in: ['teammate', 'ae'] }] },
      slaHours: 24,
      enabled: true,
    },
    RULE_TRAININGS_BELOW_CUSTOMER_PREP,
    RULE_MANDATORY_TRAININGS_TODAY,
  ],
  top3Size: 3,
  tuning: DEFAULT_TUNING,
  changeSummary: 'Role template: SE manager',
};

/**
 * Role starting point: Data 360 Specialist AE (D-55). Customer-facing work and deal value weigh more than for an SE
 * (forecast deals are the job); manager and RVP asks keep the 24h SLA; trainings never outrank customer work.
 */
export const AE_POLICY: PriorityPolicy = {
  id: 'role:ae@1',
  version: 1,
  name: 'Specialist AE',
  role: 'ae',
  weights: { ...SE_IC_WEIGHTS, dealValue: 2, stakeholderImportance: 2 },
  rules: [RULE_CUSTOMER_FACING, RULE_MANAGER_ASKS, RULE_TRAININGS_BELOW_CUSTOMER_PREP, RULE_EXTERNAL_ATTENDEES, RULE_MANDATORY_TRAININGS_TODAY],
  top3Size: 3,
  tuning: DEFAULT_TUNING,
  changeSummary: 'Role template: Specialist AE',
};

export const ROLE_POLICIES = { se_ic: SE_IC_POLICY, se_manager: SE_MANAGER_POLICY, ae: AE_POLICY } as const;
