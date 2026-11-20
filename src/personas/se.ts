/**
 * Solutions Engineer (the app's original user). This preset reproduces what the app did before personas, exactly:
 * every source, the five Org62 scopes, the six Log & fix rules, Solutions Events with an SE task type, 250 h a
 * quarter. No hour caps (2026-11-14: "grounded in truth"). Specialist Forecast comments are available, not preconfigured.
 */
import { SE_TASK_TYPES } from '@/engines/activity/taxonomy';

import type { PersonaDefinition } from './types';

export const SE_PERSONA: PersonaDefinition = {
  id: 'se',
  label: 'Solutions Engineer',
  summary: 'Customer meetings and demos logged as Solutions Events, deal contributions, VDPs',
  preamble: 'one Salesforce Solutions Engineer (SE)',
  status: 'ready',
  levels: {
    ic: { label: 'SE', priorityTemplate: 'se_ic' },
    manager: { label: 'SE manager', priorityTemplate: 'se_manager' },
  },
  features: { vdp: true, activityLogging: true, dealContributions: true, missedOpps: true },
  connectors: ['slack', 'org62', 'gmail', 'calendar', 'drive', 'gemini_notes', 'claude_sessions', 'trainings', 'watch', 'vdp'],
  org62Scopes: ['opps', 'events', 'dcs', 'book', 'missed_opps'],
  org62Book: 'team_member',
  // 2026-11-13 audit C2: canvas_waiting last (DCs and use cases that ride on the next canvas by themselves)
  gapRules: ['connector_auth', 'quarter_log', 'org62_unlogged', 'missed_dc', 'needs_input', 'expenses', 'vdp_open', 'canvas_waiting'],
  logging: { recordType: { field: 'Name', value: 'Solutions Event' }, taskTypeRequired: true, hoursTargetH: 250, overlaps: 'log_all_accepted', taskTypes: SE_TASK_TYPES, internalActivity: true },
  duties: [
    { id: 'se.reply', text: 'Answer customers, my AEs and my manager, and keep the promises I make', cadence: 'daily' },
    { id: 'se.prep', text: 'Prepare customer meetings: demos, decks, POCs, workshops, sizing and architecture', cadence: 'as_needed' },
    { id: 'se.log', text: 'Log customer meetings and the work around them in Org62 as Solutions Events, toward the quarter’s hours target', cadence: 'weekly', feature: 'activityLogging' },
    { id: 'se.dc', text: 'Claim a Deal Contribution on every opportunity I really helped with', cadence: 'as_needed', feature: 'dealContributions' },
    { id: 'se.missed', text: 'Catch opportunities I worked on with no Deal Contribution yet', cadence: 'weekly', feature: 'missedOpps' },
    { id: 'se.vdp', text: 'Keep each engaged opportunity’s VDP current: use cases, assets and owners', cadence: 'weekly', feature: 'vdp' },
    { id: 'se.sfr', text: 'Keep SE comments and the solutions judgement current on Specialist Forecasts', cadence: 'weekly', feature: 'solutionsJudgement' },
  ],
  rules: [
    { id: 'promises', text: 'Anything I say I will do is a task', enabled: true },
    { id: 'direct_asks', text: 'Direct asks of me from customers, my AE or my manager are tasks', enabled: true },
    { id: 'meeting_actions', text: 'Action items assigned to me in meeting notes are tasks', enabled: true },
    { id: 'solutions_events', text: 'Customer meetings and the work around them (demos, POCs, workshops, sizing, architecture) are logged in Org62 as Solutions Events', enabled: true, feature: 'activityLogging' },
    { id: 'dc_strong_evidence', text: 'Claim a Deal Contribution only with strong evidence: a deck, demo, model or estimate built for that opportunity, or hours logged on it', enabled: true, feature: 'dealContributions' },
    { id: 'vdp_current', text: 'An engaged opportunity has a VDP with its use cases, assets and owners filled in', enabled: true, feature: 'vdp' },
  ],
  thresholds: [{ key: 'missedOppMinAmountUsd', label: 'Missed opps: smallest deal to check', unit: 'usd', default: 10_000, min: 0, feature: 'missedOpps' }],
};
