/** Team pack, taxonomy, picklists, fiscal calendar, policies and other config content for domain 01. */
import { sha } from '../../lib/kit';

export const TASK_TYPES: Array<{ name: string; cr: boolean; cf: boolean; bucket: 'pre_sale' | 'post_sale' | 'enablement' | 'neither' | 'pto'; mt?: boolean }> = [
  ...['Customer Discovery', 'Customer Presentation', 'Marketing Support', 'Workshop', 'Consumption Estimation', 'POC', 'Partner Support', 'BVS - Business Case', 'BVS - Proposal', 'Business Value Assessment'].map((n) => ({ name: n, cr: true, cf: true, bucket: 'pre_sale' as const, mt: n === 'Workshop' || n === 'POC' })),
  ...['Post Sale Consumption Activation', 'Post Sale Adoption Support', 'Red Account Support', 'Post Sale Technical Product Support'].map((n) => ({ name: n, cr: true, cf: true, bucket: 'post_sale' as const })),
  ...['Account Planning', 'RFx', 'Dry Run', 'Solution Creation', 'Travel', 'BVS - Value Hypothesis'].map((n) => ({ name: n, cr: true, cf: false, bucket: 'pre_sale' as const })),
  ...['Mentorship', 'Personal Development', 'Sales Enablement'].map((n) => ({ name: n, cr: false, cf: false, bucket: 'enablement' as const })),
  ...['Admin', 'Asset Creation', 'V2MOM Initiatives', 'Wellness', 'Localization'].map((n) => ({ name: n, cr: false, cf: false, bucket: 'neither' as const })),
];
export const CF_SWAP: Record<string, string> = { 'Account Planning': 'Customer Discovery', RFx: 'Customer Presentation', 'Dry Run': 'Customer Presentation', 'Solution Creation': 'Workshop', 'BVS - Value Hypothesis': 'Business Value Assessment', Travel: 'Customer Presentation' };
export const INTERNAL_DOWNGRADE: Record<string, string> = { 'Customer Presentation': 'Dry Run', 'Customer Discovery': 'Account Planning', Workshop: 'Solution Creation', POC: 'Solution Creation' };
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const STAGES = ['Prospecting', 'Qualification', 'Discovery', 'Solution Design', 'Technical Validation', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'];
export const PICKLISTS: Array<[string, string[]]> = [
  ['Meeting_Type__c', ['CF', 'CR', 'Data Cloud Workshop', 'Proof of Concept']],
  ['StageName', STAGES],
  ['ForecastCategoryName', ['Omitted', 'Pipeline', 'Best Case', 'Commit', 'Closed']],
  ['Type', ['New Business', 'Upsell', 'Renewal']],
  ['Deal_Contribution_Role__c', ['AI + Data Architect', 'Solution Architect', 'Demo Engineer', 'Technical Lead']],
  ['Use_Case_Stage__c', ['U01 - Not Started', 'U02 - Scoped', 'U03 - In Development', 'U04 - Live']],
  ['Product__c', ['Data 360', 'Agentforce', 'Service Cloud', 'Marketing Cloud']],
];

export const FISCAL = [
  { fy: 2026, q: 4, start: '2025-11-01', end: '2026-01-31', deadline: '2026-02-06T17:00:00-07:00', assumed: false, note: 'Closed; logging deadline passed.' },
  { fy: 2027, q: 1, start: '2026-02-01', end: '2026-04-30', deadline: '2026-05-07T17:00:00-07:00', assumed: false, note: null },
  { fy: 2027, q: 2, start: '2026-05-01', end: '2026-07-31', deadline: '2026-08-06T17:00:00-07:00', assumed: false, note: null },
  { fy: 2027, q: 3, start: '2026-08-01', end: '2026-10-31', deadline: '2026-11-05T17:00:00-07:00', assumed: false, note: 'Passed 13 days ago.' },
  { fy: 2027, q: 4, start: '2026-11-01', end: '2027-01-31', deadline: '2027-02-05T17:00:00-07:00', assumed: true, note: 'Assumed: the team has not published this quarter\'s deadline yet; using the usual 5 days after quarter end.' },
  { fy: 2028, q: 1, start: '2027-02-01', end: '2027-04-30', deadline: null, assumed: true, note: 'Not published.' },
];

export const TEAM_PACK_RAW = (hash: string) => ({
  slug: 'se-core', version: '1', name: 'Solutions Engineering Team Pack', contentHash: hash,
  description: 'Task-type taxonomy, Meeting_Type picklist, fiscal calendar and standing team rules for the SE team.',
  sections: ['taskTypes', 'cfSwap', 'internalDowngrade', 'picklists', 'fiscalPeriods', 'teamRules'],
});
export const packHash = () => sha(JSON.stringify({ TASK_TYPES, CF_SWAP, INTERNAL_DOWNGRADE })).slice(0, 32);

// ---- priority policy content ----
export const W_V1 = { dl: 1.5, cal: 1.2, lead: 1, eff: 0.8, stake: 1.5, deal: 1, commit: 1.5, stale: 0.6, oblig: 2 };
export const W_V2 = { dl: 1.8, cal: 1.4, lead: 1, eff: 0.8, stake: 1.8, deal: 1.2, commit: 2, stale: 0.6, oblig: 2 };
export const W_V3 = { dl: 2, cal: 1.5, lead: 1.2, eff: 0.8, stake: 2, deal: 1.4, commit: 2.2, stale: 0.7, oblig: 3 };

export type RuleDef = { key: string; label: string; expl: string; kind: 'boost' | 'penalty' | 'sla' | 'lane_floor' | 'lane_cap' | 'never_above' | 'exclude'; cond: Record<string, unknown>; other?: Record<string, unknown>; value?: number; lane?: string; sla?: number; enabled?: boolean };
export const RULES_BASE: RuleDef[] = [
  { key: 'r_customer', label: 'Customer-facing beats internal', expl: 'Ranked up: your rule "customer-facing beats internal".', kind: 'boost', cond: { customerFacing: true }, value: 2 },
  { key: 'r_manager', label: 'My manager\'s asks within 24h', expl: 'Ranked up: your rule "my manager\'s asks within 24h".', kind: 'boost', cond: { fromManager: true, dueWithinH: 24 }, value: 3 },
  { key: 'r_admin', label: 'Admin chores sink', expl: 'Ranked down: your rule "admin chores sink".', kind: 'penalty', cond: { kinds: ['task'], customerFacing: false }, value: -1 },
];
export const RULES_V3_EXTRA: RuleDef[] = [
  { key: 'r_mgr_sla', label: 'Manager asks answered within 24 hours', expl: 'SLA: asks from my manager are due within 24 hours.', kind: 'sla', cond: { all: [{ field: 'from_manager', eq: true }] }, sla: 24 },
  { key: 'r_blueprint_floor', label: 'Customer deliverables due this week sit in Now', expl: 'Floor: a customer deliverable due within 72 hours is never below Now.', kind: 'lane_floor', cond: { all: [{ field: 'customer_facing', eq: true }, { field: 'due_within_hours', lte: 72 }] }, lane: 'now' },
  { key: 'r_training_cap', label: 'Optional training never beats customer prep', expl: 'Never above: optional training stays below customer prep.', kind: 'never_above', cond: { all: [{ field: 'is_training', eq: true }, { field: 'mandatory_training', eq: false }] }, other: { all: [{ field: 'is_customer_prep', eq: true }] } },
  { key: 'r_noise_exclude', label: 'Hide FYI-only low importance items', expl: 'Hidden: low-importance items that need no action.', kind: 'exclude', cond: { all: [{ field: 'importance', eq: 'low' }, { field: 'kind', ne: 'commitment' }] } },
];

// ---- task capture rules ----
export const CAPTURE_RULES = [
  { key: 'promises', label: 'Anything I say I will do is a task', expl: 'Commitments made by me in Slack, email and meeting notes become tasks.', scope: null, cond: { all: [{ field: 'said_by_me', eq: true }, { field: 'has_commitment_verb', eq: true }] }, action: 'auto_accept', min: 0.8, target: 'commitment' },
  { key: 'direct_asks', label: 'Direct asks of me are tasks', expl: 'Customers, my AEs and my manager asking me directly.', scope: null, cond: { all: [{ field: 'addressed_to_me', eq: true }, { field: 'is_request', eq: true }] }, action: 'auto_accept', min: 0.75, target: 'ask' },
  { key: 'meeting_actions', label: 'Action items assigned to me in meeting notes', expl: 'Gemini notes action items with my name.', scope: 'gemini_notes', cond: { all: [{ field: 'assignee_is_me', eq: true }] }, action: 'auto_accept', min: 0.7, target: 'task' },
  { key: 'channel_asks', label: 'Asks to a whole channel go to Triage', expl: '@channel and @here asks are decided by me.', scope: 'slack', cond: { all: [{ field: 'mentions_channel', eq: true }] }, action: 'triage', min: null, target: 'ask' },
  { key: 'mandatory_training', label: 'Mandatory training emails are training items', expl: 'Training platform emails marked mandatory with a due date.', scope: 'gmail', cond: { all: [{ field: 'sender_kind', eq: 'training_platform' }, { field: 'mandatory', eq: true }] }, action: 'auto_accept', min: 0.85, target: 'training' },
  { key: 'newsletters', label: 'Newsletters and bot posts are never tasks', expl: 'Digest senders and bot users are ignored for capture.', scope: null, cond: { any: [{ field: 'is_bulk', eq: true }, { field: 'is_bot', eq: true }] }, action: 'ignore', min: null, target: null },
  { key: 'travel_bookings', label: 'Travel confirmations become travel items', expl: 'Flight and hotel confirmations attach to the customer trip.', scope: 'gmail', cond: { all: [{ field: 'sender_kind', eq: 'travel' }] }, action: 'triage', min: null, target: 'travel' },
];

export const INTERESTS: Array<[string, string, number, string]> = [
  ['product', 'Data 360', 3, 'role_template'], ['product', 'Agentforce', 3, 'role_template'], ['skill', 'solution architecture', 2, 'user'], ['skill', 'demo engineering', 2, 'user'],
  ['topic', 'healthcare payer interoperability', 2, 'user'], ['topic', 'retrieval-augmented generation', 2, 'learned'], ['topic', 'identity resolution', 1.5, 'learned'],
  ['keyword', 'blueprint', 2, 'user'], ['keyword', 'POC', 2, 'user'], ['keyword', 'consumption estimate', 1.5, 'learned'], ['keyword', 'security review', 1, 'learned'], ['product', 'Slack', 0.5, 'learned'],
];
