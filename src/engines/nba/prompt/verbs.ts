import type { PersonaFeature } from '../../../contract/persona';
import type { ResolvedPersona } from '../../../personas/types';
import { NBA_VERBS, type NbaVerb } from './types';
import type { NbaPlan } from './schema';

export const MODELS = {
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
} as const;
export type ModelTier = keyof typeof MODELS;

export interface VerbSpec {
  verb: NbaVerb;
  skill: string; // skills/<skill>.md
  tier: ModelTier;
  /** What the NBA must carry when it is ready (unless a blocking ask makes it needs_input). */
  output: 'draft' | 'plan' | 'plan_and_optional_draft';
  planKind?: NbaPlan['kind'];
  /** Draft style skill appended to the system prompt. */
  draftStyle?: 'slack' | 'email' | 'by_destination';
  /** Card primary action label (UI-SPEC §5.1). */
  primary: string;
  maxOutputTokens: number;
  /** User-message token budget for context (truncation kicks in above it). */
  contextBudgetTokens: number;
  /** DATA-MODEL `nba_type` the orchestrator maps to (review_deliverable is missing there). */
  nbaType: string;
}

export const VERB_SPECS: Record<NbaVerb, VerbSpec> = {
  reply: {
    verb: 'reply',
    skill: 'nba-reply',
    tier: 'sonnet',
    output: 'draft',
    draftStyle: 'by_destination',
    primary: 'Send',
    maxOutputTokens: 3000,
    contextBudgetTokens: 7000,
    nbaType: 'reply',
  },
  send_email: {
    verb: 'send_email',
    skill: 'nba-send-email',
    tier: 'sonnet',
    output: 'draft',
    draftStyle: 'email',
    primary: 'Send',
    maxOutputTokens: 3500,
    contextBudgetTokens: 7000,
    nbaType: 'send_email',
  },
  start_claude_session: {
    verb: 'start_claude_session',
    skill: 'nba-start-claude-session',
    tier: 'sonnet',
    output: 'plan',
    planKind: 'claude_session',
    primary: 'Start in Claude',
    maxOutputTokens: 5000,
    contextBudgetTokens: 8000,
    nbaType: 'start_claude_session',
  },
  run_tool: {
    verb: 'run_tool',
    skill: 'nba-run-tool',
    tier: 'sonnet',
    output: 'plan',
    planKind: 'tool_run',
    primary: 'Run tool',
    maxOutputTokens: 2500,
    contextBudgetTokens: 6000,
    nbaType: 'run_tool',
  },
  log_activity: {
    verb: 'log_activity',
    skill: 'nba-log-activity',
    tier: 'haiku',
    output: 'plan',
    planKind: 'activity_rows',
    primary: 'Log',
    maxOutputTokens: 4000,
    contextBudgetTokens: 7000,
    nbaType: 'log_activity',
  },
  update_vdp: {
    verb: 'update_vdp',
    skill: 'nba-update-vdp',
    tier: 'sonnet',
    output: 'plan',
    planKind: 'vdp_patch',
    primary: 'Review update',
    maxOutputTokens: 4000,
    contextBudgetTokens: 7000,
    nbaType: 'update_vdp',
  },
  nudge: {
    verb: 'nudge',
    skill: 'nba-nudge',
    tier: 'haiku',
    output: 'draft',
    draftStyle: 'by_destination',
    primary: 'Send',
    maxOutputTokens: 1500,
    contextBudgetTokens: 4000,
    nbaType: 'nudge',
  },
  schedule: {
    verb: 'schedule',
    skill: 'nba-schedule',
    tier: 'haiku',
    output: 'plan_and_optional_draft',
    planKind: 'calendar_hold',
    draftStyle: 'by_destination',
    primary: 'Schedule',
    maxOutputTokens: 2000,
    contextBudgetTokens: 4500,
    nbaType: 'schedule',
  },
  review_deliverable: {
    verb: 'review_deliverable',
    skill: 'nba-review-deliverable',
    tier: 'sonnet',
    output: 'plan_and_optional_draft',
    planKind: 'deliverable_review',
    draftStyle: 'by_destination',
    primary: 'Review',
    maxOutputTokens: 3500,
    contextBudgetTokens: 7000,
    nbaType: 'confirm_done',
  },
};

export function modelFor(verb: NbaVerb, override?: ModelTier): string {
  return MODELS[override ?? VERB_SPECS[verb].tier];
}

/**
 * D-55: NBA verbs that belong to a persona feature. Inactive means no daily surface: no `update_vdp` NBA without VDP,
 * no `log_activity` NBA without activity logging. Every other verb is every persona's.
 */
export const NBA_VERB_FEATURES: Readonly<Partial<Record<NbaVerb, PersonaFeature>>> = { update_vdp: 'vdp', log_activity: 'activityLogging' };

export function nbaVerbAllowed(verb: NbaVerb, persona: Pick<ResolvedPersona, 'features'> | null | undefined): boolean {
  const f = NBA_VERB_FEATURES[verb];
  return !f || !persona || persona.features[f] === true;
}

/** The verbs this persona can be offered, in NBA_VERBS order. */
export function nbaVerbsFor(persona: Pick<ResolvedPersona, 'features'> | null | undefined): NbaVerb[] {
  return NBA_VERBS.filter((v) => nbaVerbAllowed(v, persona));
}
