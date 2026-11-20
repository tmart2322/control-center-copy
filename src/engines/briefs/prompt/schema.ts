import { z } from 'zod';

/** DATA-MODEL `highlight_reason_kind`. */
export const HIGHLIGHT_REASON_KINDS = [
  'my_account',
  'my_opportunity',
  'my_initiative',
  'mentions_me',
  'my_interest',
  'policy_rule',
  'stakeholder',
  'keyword',
  'similar_to_promoted',
  'org62_change',
] as const;

/** Prompt-facing levels; the DB enum is `highlight_level` (must_read / worth_a_look / fyi). */
export const LEVEL_TO_DB = { high: 'must_read', medium: 'worth_a_look' } as const;

export const highlightSchema = z.object({
  title: z.string().min(3).max(90),
  body: z.string().min(3).max(320),
  level: z.enum(['high', 'medium']),
  reasons: z
    .array(
      z.object({
        kind: z.enum(HIGHLIGHT_REASON_KINDS),
        featureKey: z.string().min(3),
        explanation: z.string().min(3).max(160),
      }),
    )
    .min(1)
    .max(4),
  evidenceIds: z.array(z.string()).min(1),
  suggestedAction: z.enum(['promote', 'task', 'ignore']),
  topicKey: z.string().min(2),
  entity: z.object({
    accountId: z.string().nullable(),
    opportunityId: z.string().nullable(),
    initiativeId: z.string().nullable(),
  }),
});

export const briefOutputSchema = z.object({
  summary: z.string().min(3).max(1400),
  nothingNew: z.boolean(),
  highlights: z.array(highlightSchema).max(8),
  everythingElse: z
    .array(z.object({ threadRef: z.string(), gist: z.string().max(180), evidenceIds: z.array(z.string()).default([]) }))
    .max(15)
    .default([]),
  coverageNote: z.string().max(240).nullable().default(null),
});

export type BriefOutput = z.infer<typeof briefOutputSchema>;
export type BriefHighlight = z.infer<typeof highlightSchema>;
