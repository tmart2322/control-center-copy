/**
 * Domain 06: the watches, the eight briefs and their highlights (hand-written). Everything quotes real source items of
 * domain 02 (`si-NNN`), Org62 snapshots, scan runs and llm_calls of domain 03, and work items of domain 04.
 * Highlight reasons follow the brief-relevance rubric (kind + featureKey + weight + explanation).
 */

export type ReasonKind =
  | 'my_account' | 'my_opportunity' | 'my_initiative' | 'mentions_me' | 'my_interest'
  | 'policy_rule' | 'stakeholder' | 'keyword' | 'similar_to_promoted' | 'org62_change';

export interface ReasonSpec {
  kind: ReasonKind;
  /** feature key; `account:@voltmere` style placeholders are resolved by the generator (`@key` = uid of that row). */
  feature: string;
  weight: number;
  explanation: string;
  /** policy rule (policy version, rule key) for kind policy_rule. */
  rule?: [number, string];
}
export type Fb = 'opened' | 'marked_useful' | 'dismissed_not_relevant' | 'promoted_to_triage' | 'promoted_to_work_item';
export interface HighlightSpec {
  key: string;
  title: string;
  body: string;
  level: 'must_read' | 'worth_a_look' | 'fyi';
  score: number;
  account?: string;
  opp?: string;
  initiative?: string;
  /** source items the highlight rests on (provenance basis; the first is the quoted one) */
  evidence: string[];
  /** explicit topic key (default: the first evidence's thread/file ref) */
  topic?: string;
  status: 'new' | 'seen' | 'promoted' | 'dismissed';
  /** minutes after the brief was generated that the user first saw it */
  seenAfterMin?: number;
  dismiss?: { at: string; reason: string };
  promote?: { at: string; wi: number; kind: 'promoted_to_triage' | 'promoted_to_work_item' };
  reasons: ReasonSpec[];
  feedback?: Array<{ kind: Fb; at: string; changeSet?: number }>;
}

export interface WatchSpec {
  key: string;
  scope: 'account' | 'opportunity' | 'person' | 'channel' | 'search_query';
  target: string; // entity key, or the query text
  label: string;
  cadence: 'since_last' | 'daily' | 'weekly' | 'on_demand';
  style: 'digest' | 'narrative' | 'changes_only';
  detail: number;
  max: number;
  minRel: number;
  auto: boolean;
  enabled: boolean;
  sources?: string[];
  created: string; // ISO
  updated: string;
  lastBrief?: string; // brief key (last_brief_id)
  scheduled: boolean;
}

export interface BriefSpec {
  key: string;
  watch: string;
  start: string; // ISO period start
  end: string;
  llm: number; // llm_calls id
  summary: string;
  nothingNew?: boolean;
  coverage?: { complete: false; note: string };
  opp?: string; // opportunity key for from/to snapshots
  snaps?: [number, number]; // index into the opp's snapshots (oldest first): from, to
  items: string[]; // every source item the brief read (brief-level provenance)
  seenAt?: string;
  highlights: HighlightSpec[];
}

const T = (offset: number, hhmm: string) => `@${offset}|${hhmm}`; // resolved with at() by the generator
export { T };

export const WATCHES: WatchSpec[] = [
  {
    key: 'acct-voltmere', scope: 'account', target: 'voltmere', label: 'Voltmere Utilities (watched account)', cadence: 'weekly', style: 'digest',
    detail: 3, max: 5, minRel: 0.4, auto: false, enabled: true, created: T(-29, '10:14'), updated: T(0, '07:31'), lastBrief: 'weekly-voltmere-1118', scheduled: true,
  },
  {
    key: 'acct-contoso', scope: 'account', target: 'contoso', label: 'Contoso Marketplace (watched account)', cadence: 'weekly', style: 'digest',
    detail: 2, max: 4, minRel: 0.5, auto: false, enabled: true, created: T(-29, '10:16'), updated: T(-5, '07:31'), lastBrief: 'weekly-contoso', scheduled: true,
  },
  {
    key: 'q-prior-auth', scope: 'search_query', target: 'prior authorization automation', label: 'Prior authorization automation', cadence: 'weekly', style: 'changes_only',
    detail: 2, max: 4, minRel: 0.45, auto: false, enabled: true, sources: ['slack', 'gmail'], created: T(-26, '09:40'), updated: T(0, '07:31'), lastBrief: 'priorauth-1030', scheduled: true,
  },
  {
    key: 'opp-halvergate', scope: 'opportunity', target: 'halvergate-route-exceptions-agent', label: 'Halvergate: Route Exceptions Agent', cadence: 'since_last', style: 'narrative',
    detail: 3, max: 5, minRel: 0.4, auto: true, enabled: false, created: T(-29, '10:20'), updated: T(-5, '10:40'), lastBrief: 'halvergate-1113', scheduled: true,
  },
  {
    key: 'person-petra', scope: 'person', target: 'lg-petra', label: 'Petra Novak (Voltmere)', cadence: 'weekly', style: 'changes_only',
    detail: 2, max: 3, minRel: 0.5, auto: false, enabled: false, created: T(-27, '11:02'), updated: T(-4, '08:05'), lastBrief: 'petra-1114', scheduled: true,
  },
  {
    key: 'ch-contoso', scope: 'channel', target: 'contoso-marketplace', label: '#contoso-marketplace', cadence: 'daily', style: 'digest',
    detail: 2, max: 3, minRel: 0.6, auto: false, enabled: false, created: T(-20, '08:52'), updated: T(-19, '16:10'), scheduled: false,
  },
];

export const BRIEFS: BriefSpec[] = [
  // ── Voltmere, first weekly brief ───────────────────────────────────────────────────────────────
  {
    key: 'weekly-voltmere-1029', watch: 'acct-voltmere', start: T(-27, '07:30'), end: T(-20, '07:30'), llm: 146,
    summary:
      'Petra Novak edited the "Voltmere Outage Event Schema" document in Drive on Oct 25, the first concrete input from Voltmere\'s side for the outage insights opportunity. The only other mention is a teammate\'s standup line about a Voltmere discovery call after Ferrowpay dry-run prep.',
    items: ['si-117', 'si-088'],
    seenAt: T(-20, '08:44'),
    highlights: [
      {
        key: 'lg-schema', title: 'Petra edited Voltmere\'s outage event schema in Drive',
        body: 'The "Voltmere Outage Event Schema" doc was edited by Petra Novak on Oct 25. It is the input you need for the discovery call on outage insights; nothing is asked of you yet.',
        level: 'worth_a_look', score: 0.66, account: 'voltmere', opp: 'voltmere-outage-insights', evidence: ['si-117'], status: 'seen', seenAfterMin: 70,
        reasons: [
          { kind: 'stakeholder', feature: 'person:@lg-petra', weight: 0.3, explanation: 'Petra Novak is the contact you watch at Voltmere.' },
          { kind: 'my_interest', feature: 'interest:Data 360', weight: 0.2, explanation: 'An event schema is the input for a Data 360 data model.' },
        ],
        feedback: [{ kind: 'opened', at: T(-20, '08:45') }],
      },
      {
        key: 'lg-standup', title: 'Standup: Ferrowpay dry run prep, then a Voltmere discovery call',
        body: 'A #se-team standup line from a teammate mentions the Voltmere discovery call. Context only.',
        level: 'fyi', score: 0.35, account: 'voltmere', evidence: ['si-088'], status: 'seen', seenAfterMin: 72,
        reasons: [{ kind: 'keyword', feature: 'keyword:voltmere', weight: 0.2, explanation: 'Mentions a watched account by name in a team channel.' }],
      },
    ],
  },
  // ── Voltmere weekly, window ending Thu 11-12 ──────────────────────────────────────────────────
  {
    key: 'weekly-voltmere', watch: 'acct-voltmere', start: T(-13, '07:30'), end: T(-6, '07:30'), llm: 497,
    summary:
      'A quiet week on Voltmere Utilities, but one thing moved: Nadia confirmed that the CDO, Abdullahi Warsame, will join the December readout for outage insights, and Petra Novak\'s team has shared its outage event schema. Nadia\'s status email asks nothing of you unless Linnea needs a second SE. The Org62 record for the Customer Service Agent opportunity was re-read (Qualification, $240,000, budget not confirmed). A discovery session on outage insights ran on Nov 8; Petra wants to see time-to-restore trends in Data 360.',
    items: ['si-370', 'si-397', 'si-402', 'si-404', 'si-344'],
    seenAt: T(-6, '08:19'),
    highlights: [
      {
        key: 'lg-cdo-readout', title: 'Voltmere\'s CDO will join the December readout',
        body: 'Nadia says Abdullahi Warsame, Voltmere\'s Chief Data Officer, will attend the December readout for the outage insights opportunity. Linnea leads it; you only join if she asks for a second SE.',
        level: 'must_read', score: 0.88, account: 'voltmere', opp: 'voltmere-outage-insights', evidence: ['si-404', 'si-397'], status: 'seen', seenAfterMin: 49,
        reasons: [
          { kind: 'stakeholder', feature: 'person:@lg-abdullahi', weight: 0.45, explanation: 'Chief Data Officer at a watched account; an executive sponsor is joining a readout.' },
          { kind: 'keyword', feature: 'keyword:readout', weight: 0.2, explanation: 'Readouts are where you present the architecture; you follow the keyword.' },
          { kind: 'my_interest', feature: 'interest:Data 360', weight: 0.15, explanation: 'The opportunity is Outage Insights on Data 360, a product you follow.' },
        ],
        feedback: [{ kind: 'opened', at: T(-6, '08:21') }, { kind: 'marked_useful', at: T(-6, '08:23') }],
      },
      {
        key: 'lg-discovery', title: 'Discovery session held; Petra wants time-to-restore trends in Data 360',
        body: 'The outage insights discovery session ran on Nov 8. Petra\'s ask from the account channel is a view of time-to-restore trends; her team\'s outage event schema is already in Drive.',
        level: 'worth_a_look', score: 0.64, account: 'voltmere', opp: 'voltmere-outage-insights', evidence: ['si-402', 'si-236'], status: 'seen', seenAfterMin: 51,
        reasons: [
          { kind: 'my_interest', feature: 'interest:Data 360', weight: 0.2, explanation: 'Time-to-restore trends are a Data 360 calculated-insight use case.' },
          { kind: 'stakeholder', feature: 'person:@lg-petra', weight: 0.25, explanation: 'Petra Novak is the contact you watch at Voltmere.' },
        ],
        feedback: [{ kind: 'opened', at: T(-6, '08:22') }],
      },
      {
        key: 'ops-bh-1', title: 'Customer Service Agent opportunity is Qualification; budget not confirmed',
        body: 'The Org62 record for Voltmere Utilities - Customer Service Agent was re-read: Qualification, $240,000, close 2027-03-28. Next step: "Qualified; budget not confirmed." No field changed.',
        level: 'worth_a_look', score: 0.52, account: 'voltmere', opp: 'voltmere-service-agent', evidence: ['si-370'], status: 'dismissed', seenAfterMin: 49,
        dismiss: { at: T(-6, '08:25'), reason: 'Not relevant: nothing changed, and I only follow Outage Insights at Voltmere.' },
        reasons: [
          { kind: 'org62_change', feature: 'org62:Stage', weight: 0.3, explanation: 'Org62 snapshot refreshed for a watched opportunity.' },
          { kind: 'my_interest', feature: 'interest:Agentforce', weight: 0.22, explanation: 'A customer service agent is an Agentforce use case.' },
        ],
        feedback: [{ kind: 'dismissed_not_relevant', at: T(-6, '08:25'), changeSet: 365 }],
      },
      {
        key: 'lg-nadia-fyi', title: 'Nadia: no action from you unless Linnea needs a second SE',
        body: 'Nadia\'s "FYI: Voltmere outage insights status" email is addressed to you by name and says there is nothing to do for now.',
        level: 'fyi', score: 0.41, account: 'voltmere', opp: 'voltmere-outage-insights', evidence: ['si-397'], status: 'seen', seenAfterMin: 52,
        reasons: [{ kind: 'mentions_me', feature: 'person:@ae-commercial', weight: 0.3, explanation: 'Nadia addressed you by name; the AE on this account.' }],
        feedback: [{ kind: 'opened', at: T(-6, '08:24') }],
      },
      {
        key: 'lg-standup-mention', title: 'Standup: Voltmere discovery call after Ferrowpay dry run prep',
        body: 'A teammate\'s #se-team standup line mentions the Voltmere discovery call. Context only.',
        level: 'fyi', score: 0.36, account: 'voltmere', evidence: ['si-344'], status: 'seen', seenAfterMin: 55,
        reasons: [{ kind: 'keyword', feature: 'keyword:voltmere', weight: 0.2, explanation: 'Mentions a watched account by name in a team channel.' }],
      },
    ],
  },
  // ── Voltmere weekly, today's brief ────────────────────────────────────────────────────────────
  {
    key: 'weekly-voltmere-1118', watch: 'acct-voltmere', start: T(-6, '07:30'), end: T(0, '07:30'), llm: 661,
    summary:
      'Outage Insights moved: the close date was pushed from Jan 15 to Feb 1 and the Org62 next step now reads "CDO joins December readout." The Customer Service Agent opportunity is still qualified with the budget not confirmed (Nadia, Fri in the account channel). Nothing else from Petra Novak\'s side this week. An industry-news roundup on utility outage analytics also landed in #industry-news.',
    items: ['si-511', 'si-562', 'si-520'],
    seenAt: T(0, '08:45'),
    highlights: [
      {
        key: 'lg-closedate', title: 'Outage Insights close date moved from Jan 15 to Feb 1',
        body: 'Org62 now shows 2027-02-01 for Voltmere Utilities - Outage Insights on Data 360 (was 2027-01-15, a 17-day push). Stage is still Discovery at $600,000; the next step notes the CDO joining the December readout.',
        level: 'must_read', score: 0.84, account: 'voltmere', opp: 'voltmere-outage-insights', evidence: ['si-511'], topic: 'opp:voltmere-outage-insights:CloseDate', status: 'new',
        reasons: [
          { kind: 'org62_change', feature: 'org62:CloseDate', weight: 0.5, explanation: 'Close date pushed out by 17 days on a watched opportunity.' },
          { kind: 'my_interest', feature: 'interest:Data 360', weight: 0.2, explanation: 'Opportunity is Outage Insights on Data 360.' },
          { kind: 'stakeholder', feature: 'person:@lg-abdullahi', weight: 0.14, explanation: 'The next step names the CDO.' },
        ],
      },
      {
        key: 'lg-service-agent', title: 'Customer Service Agent: qualified, budget still unconfirmed',
        body: 'Nadia repeats in #voltmere-account that the Customer Service Agent opportunity is qualified but budget is not confirmed. Same facts as last week\'s brief.',
        level: 'worth_a_look', score: 0.46, account: 'voltmere', opp: 'voltmere-service-agent', evidence: ['si-562'], status: 'new',
        reasons: [
          { kind: 'my_interest', feature: 'interest:Agentforce', weight: 0.22, explanation: 'A customer service agent is an Agentforce use case.' },
          { kind: 'similar_to_promoted', feature: 'account:@voltmere', weight: -0.08, explanation: 'You dismissed the same topic on Nov 12, so its rank is lowered.' },
        ],
      },
      {
        key: 'lg-roundup', title: 'Roundup: utility outage analytics (industry news)',
        body: 'The #industry-news midweek roundup covers utility outage analytics and two analyst notes. Not about Voltmere by name.',
        level: 'fyi', score: 0.34, account: 'voltmere', evidence: ['si-520'], status: 'new',
        reasons: [{ kind: 'keyword', feature: 'keyword:outage', weight: 0.18, explanation: 'Mentions outage analytics, the topic of your watched opportunity.' }],
      },
    ],
  },
  // ── Contoso, first weekly brief ───────────────────────────────────────────────────────────────
  {
    key: 'weekly-contoso-1105', watch: 'acct-contoso', start: T(-20, '07:30'), end: T(-13, '07:30'), llm: 258,
    summary:
      'Nadia opened #contoso-marketplace on Oct 29 and welcomed Ngozi Eze\'s team; the channel covers the seller support agent and recommendations workstreams. Ngozi replied that seller support volume spikes ahead of the holiday sale, so timing matters. No Org62 or Drive activity from Contoso this week.',
    items: ['si-185', 'si-224'],
    seenAt: T(-13, '08:20'),
    highlights: [
      {
        key: 'co-timing', title: 'Contoso: seller support volume spikes ahead of the holiday sale, so timing matters',
        body: 'Ngozi Eze tells Nadia that seller support volume spikes ahead of the holiday sale and asks that the Seller Support Agent timeline respect it. The opportunity close date is 2027-01-02.',
        level: 'worth_a_look', score: 0.61, account: 'contoso', opp: 'contoso-seller-agent', evidence: ['si-224'], status: 'seen', seenAfterMin: 55,
        reasons: [
          { kind: 'stakeholder', feature: 'person:@cm-ngozi', weight: 0.3, explanation: 'Ngozi Eze is the director sponsoring the workstreams.' },
          { kind: 'my_interest', feature: 'interest:Agentforce', weight: 0.2, explanation: 'A seller support agent is an Agentforce use case.' },
        ],
        feedback: [{ kind: 'opened', at: T(-13, '08:22') }],
      },
      {
        key: 'co-welcome', title: 'Nadia opens #contoso-marketplace for the seller support and recommendations workstreams',
        body: 'The channel welcome names the two workstreams: the seller support agent and recommendations. Context only.',
        level: 'fyi', score: 0.37, account: 'contoso', evidence: ['si-185'], status: 'seen', seenAfterMin: 56,
        reasons: [{ kind: 'keyword', feature: 'keyword:contoso', weight: 0.2, explanation: 'A watched account opened a shared channel.' }],
      },
    ],
  },
  // ── Contoso weekly ─────────────────────────────────────────────────────────────────────────────
  {
    key: 'weekly-contoso', watch: 'acct-contoso', start: T(-12, '07:30'), end: T(-5, '07:30'), llm: 550,
    summary:
      'Nadia says in #contoso-marketplace that the Seller Support Agent proposal is with Julien Marchetti and invites questions there. An independent data consultant, Tobias Reinhardt, introduced himself as Ngozi Eze\'s contractor for the recommendations pipeline; Ngozi adds that he will need read access to the catalog events sample. Nothing else moved in the channel this week.',
    coverage: { complete: false, note: 'Slack was rate limited on Thu Nov 12 from 08:20 to 10:12 MT; #contoso-marketplace posts from that window may be missing. A coverage-gap finding was raised and resolved by the 11:30 reconcile run.' },
    items: ['si-529', 'si-373', 'si-374'],
    seenAt: T(-5, '09:12'),
    highlights: [
      {
        key: 'co-proposal-julien', title: 'The Seller Support Agent proposal is with Julien Marchetti',
        body: 'Nadia says the Seller Support Agent proposal is now with Julien Marchetti, Contoso\'s VP of Marketplace Product, and invites questions in the channel. Expect technical questions to land with you.',
        level: 'must_read', score: 0.82, account: 'contoso', opp: 'contoso-seller-agent', evidence: ['si-529'], topic: 'opp:contoso-seller-agent:StageName', status: 'seen', seenAfterMin: 102,
        reasons: [
          { kind: 'stakeholder', feature: 'person:@cm-julien', weight: 0.35, explanation: 'Julien Marchetti is the executive buyer at a watched account.' },
          { kind: 'my_interest', feature: 'interest:Agentforce', weight: 0.22, explanation: 'A seller support agent is an Agentforce use case.' },
        ],
        feedback: [{ kind: 'opened', at: T(-5, '09:14') }, { kind: 'marked_useful', at: T(-5, '09:16') }],
      },
      {
        key: 'co-tobias', title: 'Independent consultant Tobias Reinhardt joins #contoso-marketplace',
        body: 'Tobias introduced himself as a data consultant helping Ngozi Eze\'s team with the recommendations pipeline; Ngozi says he is joining as a contractor. He is not tied to a customer account in the app yet.',
        level: 'worth_a_look', score: 0.58, account: 'contoso', opp: 'contoso-realtime-recs', evidence: ['si-373'], status: 'promoted', seenAfterMin: 106,
        promote: { at: T(-1, '14:36'), wi: 41, kind: 'promoted_to_triage' },
        reasons: [
          { kind: 'stakeholder', feature: 'person:@ext-tobias', weight: 0.28, explanation: 'A new external person with no account in the app (identity to resolve).' },
          { kind: 'my_interest', feature: 'interest:identity resolution', weight: 0.14, explanation: 'You follow identity resolution; he works on the recommendations data pipeline.' },
        ],
        feedback: [{ kind: 'opened', at: T(-5, '09:17') }, { kind: 'promoted_to_triage', at: T(-1, '14:36') }],
      },
      {
        key: 'co-catalog-access', title: 'Tobias will need read access to the catalog events sample',
        body: 'Ngozi\'s message adds that the contractor needs read access to the catalog events sample before the recommendations work can continue.',
        level: 'worth_a_look', score: 0.5, account: 'contoso', opp: 'contoso-realtime-recs', evidence: ['si-374'], status: 'seen', seenAfterMin: 106,
        reasons: [{ kind: 'stakeholder', feature: 'person:@cm-ngozi', weight: 0.2, explanation: 'Ngozi Eze is the director sponsoring the recommendations workstream.' }],
      },
    ],
  },
  // ── Halvergate (the quiet deal), three briefs ───────────────────────────────────────────────────
  {
    key: 'halvergate-1030', watch: 'opp-halvergate', start: T(-26, '07:30'), end: T(-19, '07:30'), llm: 158, opp: 'halvergate-route-exceptions-agent', snaps: [0, 1],
    summary:
      'Org62: close date moved from Oct 31 to Nov 12 and the next step now reads "Ops summit this week; Anjali to revert." Anjali Rao replied on Sunday that Halvergate\'s ops summit is this week and she will come back afterward; Nadia relayed that the close date is still Nov 12. You added the integration diagram to the proposal deck on Oct 22, and the proposal walkthrough was logged to Org62 on Oct 23.',
    items: ['si-080', 'si-106', 'si-114', 'si-115', 'si-116'],
    seenAt: T(-19, '08:10'),
    highlights: [
      {
        key: 'ns-closedate', title: 'Route Exceptions Agent: close date moved from Oct 31 to Nov 12',
        body: 'Org62 shows the close date pushed 12 days to 2026-11-12 on the $520,000 proposal. Stage is still Proposal, forecast Best Case.',
        level: 'must_read', score: 0.9, account: 'halvergate', opp: 'halvergate-route-exceptions-agent', evidence: ['si-116'], topic: 'opp:halvergate-route-exceptions-agent:CloseDate', status: 'seen', seenAfterMin: 40,
        reasons: [
          { kind: 'my_opportunity', feature: 'opp:@halvergate-route-exceptions-agent', weight: 0.4, explanation: 'You are on the team for this opportunity.' },
          { kind: 'org62_change', feature: 'org62:CloseDate', weight: 0.4, explanation: 'Close date pushed out.' },
        ],
        feedback: [{ kind: 'opened', at: T(-19, '08:11') }],
      },
      {
        key: 'ns-anjali-reply', title: 'Anjali: ops summit this week, she will come back after',
        body: 'Anjali Rao thanked you for the integration diagram and said the ops summit is this week; she will respond afterward. Nadia relayed it in #halvergate-freight.',
        level: 'worth_a_look', score: 0.7, account: 'halvergate', opp: 'halvergate-route-exceptions-agent', evidence: ['si-114', 'si-115'], status: 'seen', seenAfterMin: 41,
        reasons: [
          { kind: 'stakeholder', feature: 'person:@ns-anjali', weight: 0.35, explanation: 'Your champion at Halvergate replied.' },
          { kind: 'my_opportunity', feature: 'opp:@halvergate-route-exceptions-agent', weight: 0.3, explanation: 'Direct reply on a deal you are on.' },
        ],
        feedback: [{ kind: 'opened', at: T(-19, '08:12') }],
      },
      {
        key: 'ns-diagram', title: 'Integration diagram added to the proposal; walkthrough logged',
        body: 'Your own edit to the Route Exceptions Agent Proposal deck (integration diagram) on Oct 22 and the proposal walkthrough Event logged to Org62 on Oct 23.',
        level: 'fyi', score: 0.38, account: 'halvergate', opp: 'halvergate-route-exceptions-agent', evidence: ['si-080', 'si-106'], status: 'seen', seenAfterMin: 44,
        reasons: [{ kind: 'my_account', feature: 'account:@halvergate', weight: 0.3, explanation: 'Your own activity on a deal in your book.' }],
      },
    ],
  },
  {
    key: 'halvergate-1111', watch: 'opp-halvergate', start: T(-19, '07:30'), end: T(-7, '07:30'), llm: 474, opp: 'halvergate-route-exceptions-agent', snaps: [2, 2],
    summary:
      'No Org62 changes in the window (Proposal, $520,000, close Nov 12). You nudged Anjali by email on Nov 2 and nothing came back; Nadia wrote on Nov 5 that Anjali "still isn\'t replying to me either" and relayed a rumor of a budget freeze on Walter Szymanski\'s side. She is trying another path through Halvergate\'s operations assistant and asked whether you have a technical angle for Walter. The Halvergate route exceptions check-in on Nov 9 passed without a meeting.',
    items: ['si-250', 'si-251', 'si-296', 'si-297', 'si-329', 'si-443'],
    seenAt: T(-7, '07:58'),
    highlights: [
      {
        key: 'ns-freeze', title: 'Rumored budget freeze on Walter\'s side; Nadia looking for another path through ops',
        body: 'Nadia flags a rumor of a budget freeze with Walter Szymanski, Halvergate\'s VP of Operations, and plans a call with his assistant to find another way in. Anjali is still silent and the close date is tomorrow.',
        level: 'must_read', score: 0.91, account: 'halvergate', opp: 'halvergate-route-exceptions-agent', evidence: ['si-296', 'si-297'], status: 'seen', seenAfterMin: 28,
        reasons: [
          { kind: 'my_opportunity', feature: 'opp:@halvergate-route-exceptions-agent', weight: 0.4, explanation: 'Budget risk on a deal you are on, close date tomorrow.' },
          { kind: 'stakeholder', feature: 'person:@ns-walter', weight: 0.3, explanation: 'Executive sponsor, VP of Operations.' },
          { kind: 'policy_rule', feature: 'rule:r_customer', weight: 0.2, explanation: 'Customer-facing deals rank above internal work.', rule: [2, 'r_customer'] },
        ],
        feedback: [{ kind: 'opened', at: T(-7, '07:59') }, { kind: 'marked_useful', at: T(-7, '08:01') }],
      },
      {
        key: 'ns-technical-angle', title: 'Nadia asks for a technical angle that would resonate with Walter',
        body: 'In her email Nadia asks you for a technical angle for Walter Szymanski. A reply would help her; the item "Reply to Nadia: find a path through ops at Halvergate" tracks it.',
        level: 'worth_a_look', score: 0.74, account: 'halvergate', opp: 'halvergate-route-exceptions-agent', evidence: ['si-297'], status: 'seen', seenAfterMin: 30,
        reasons: [
          { kind: 'mentions_me', feature: 'person:@ae-commercial', weight: 0.4, explanation: 'Nadia asks you directly.' },
          { kind: 'my_opportunity', feature: 'opp:@halvergate-route-exceptions-agent', weight: 0.25, explanation: 'On your deal team.' },
        ],
        feedback: [{ kind: 'opened', at: T(-7, '08:00') }],
      },
      {
        key: 'ns-nudge', title: 'Second nudge to Anjali by email; nothing back, and Nadia gets no reply either',
        body: 'You asked Anjali on Nov 2 whether the proposal landed with her leadership and offered a 30-minute call. #halvergate-freight notes "Nothing back" and, on Nov 5, "Anjali still isn\'t replying to me either."',
        level: 'worth_a_look', score: 0.6, account: 'halvergate', opp: 'halvergate-route-exceptions-agent', evidence: ['si-250', 'si-251', 'si-329'], status: 'seen', seenAfterMin: 31,
        reasons: [{ kind: 'stakeholder', feature: 'person:@ns-anjali', weight: 0.35, explanation: 'Champion has not replied in 17 days.' }],
      },
      {
        key: 'ns-missed-checkin', title: 'The Nov 9 route exceptions check-in passed without a meeting',
        body: 'The calendar entry "Halvergate route exceptions check-in" on Nov 9 did not happen; a follow-up item exists so you can offer new slots.',
        level: 'worth_a_look', score: 0.55, account: 'halvergate', opp: 'halvergate-route-exceptions-agent', evidence: ['si-443'], status: 'seen', seenAfterMin: 33,
        reasons: [{ kind: 'my_opportunity', feature: 'opp:@halvergate-route-exceptions-agent', weight: 0.3, explanation: 'A missed customer meeting on a deal you are on.' }],
      },
    ],
  },
  {
    key: 'halvergate-1113', watch: 'opp-halvergate', start: T(-7, '07:30'), end: T(-5, '07:30'), llm: 551, opp: 'halvergate-route-exceptions-agent', snaps: [2, 2],
    summary:
      'The Nov 12 close date has passed with the Org62 record unchanged: Proposal, $520,000, Best Case. Nadia said on Wednesday that the date is Nov 12 on paper and that it is realistically slipping; she will update Org62 once she has a signal. An internal close-date review is on the calendar for Friday 11:00.',
    items: ['si-493', 'si-565'],
    seenAt: T(-5, '08:40'),
    highlights: [
      {
        key: 'ns-closed-passed', title: 'Close date passed Nov 12 with Halvergate still at Proposal',
        body: 'Org62 still shows 2026-11-12 on a $520,000 proposal at Proposal, Best Case; Nadia says it is slipping and she will update Org62 when she has a signal from Halvergate.',
        level: 'must_read', score: 0.93, account: 'halvergate', opp: 'halvergate-route-exceptions-agent', evidence: ['si-493'], topic: 'opp:halvergate-route-exceptions-agent:CloseDate', status: 'seen', seenAfterMin: 70,
        reasons: [
          { kind: 'my_opportunity', feature: 'opp:@halvergate-route-exceptions-agent', weight: 0.45, explanation: 'Close date passed on a deal you are on.' },
          { kind: 'org62_change', feature: 'org62:CloseDate', weight: 0.35, explanation: 'The date passed with no stage movement.' },
          { kind: 'policy_rule', feature: 'rule:r_customer', weight: 0.2, explanation: 'Customer-facing, deal at risk.', rule: [2, 'r_customer'] },
        ],
        feedback: [{ kind: 'opened', at: T(-5, '08:41') }, { kind: 'marked_useful', at: T(-5, '08:43') }],
      },
      {
        key: 'ns-review', title: 'Internal Halvergate close-date review is on the calendar for Friday 11:00',
        body: 'The calendar has "Halvergate close-date review (internal)" on Fri Nov 13 at 11:00; bring a view on whether to re-engage through ops or move the date.',
        level: 'worth_a_look', score: 0.57, account: 'halvergate', opp: 'halvergate-route-exceptions-agent', evidence: ['si-565'], status: 'seen', seenAfterMin: 72,
        reasons: [
          { kind: 'my_opportunity', feature: 'opp:@halvergate-route-exceptions-agent', weight: 0.3, explanation: 'An internal meeting about your deal.' },
          { kind: 'similar_to_promoted', feature: 'account:@halvergate', weight: 0.2, explanation: 'Similar to the Nadia ask you followed up on for the same deal.' },
        ],
        feedback: [{ kind: 'opened', at: T(-5, '08:44') }],
      },
    ],
  },
  // ── Petra, nothing new ─────────────────────────────────────────────────────────────────────────
  {
    key: 'petra-1114', watch: 'person-petra', start: T(-11, '07:30'), end: T(-4, '07:30'), llm: 575, nothingNew: true,
    summary: 'Nothing new from Petra Novak in the window. The last thing from her side was the outage event schema document she edited on Oct 25.',
    items: [], seenAt: T(-4, '08:04'), highlights: [],
  },
  // ── Search query, weekly ───────────────────────────────────────────────────────────────────────
  {
    key: 'priorauth-1030', watch: 'q-prior-auth', start: T(-26, '07:30'), end: T(-19, '07:30'), llm: 157,
    summary:
      'One #industry-news post says healthcare payers are pushing for prior-authorization automation ahead of new rules. The Weekly Data and AI Digest repeats "payer automation rules" without detail. Nothing concerns a specific account.',
    items: ['si-123', 'si-082'],
    seenAt: T(-19, '08:30'),
    highlights: [
      {
        key: 'pa-payers', title: 'Healthcare payers push for prior-authorization automation ahead of new rules',
        body: 'An #industry-news post says payers are moving on prior-authorization automation before new rules take effect. Useful background for Saltmere conversations.',
        level: 'worth_a_look', score: 0.57, evidence: ['si-123'], status: 'seen', seenAfterMin: 60,
        reasons: [
          { kind: 'my_interest', feature: 'topic:healthcare payer interoperability', weight: 0.3, explanation: 'You follow payer interoperability; your hottest deal is a health plan.' },
          { kind: 'keyword', feature: 'keyword:prior authorization', weight: 0.2, explanation: 'Matches the search watch.' },
        ],
        feedback: [{ kind: 'opened', at: T(-19, '08:31') }, { kind: 'marked_useful', at: T(-19, '08:33') }],
      },
      {
        key: 'pa-digest-40', title: 'Weekly Data and AI Digest, issue 40: payer automation rules',
        body: 'The newsletter lists "payer automation rules" among the week\'s topics. No links to open.',
        level: 'fyi', score: 0.33, evidence: ['si-082'], status: 'dismissed', seenAfterMin: 61,
        dismiss: { at: T(-19, '08:35'), reason: 'Newsletter noise.' },
        reasons: [{ kind: 'keyword', feature: 'keyword:payer automation', weight: 0.14, explanation: 'Mentions payer automation.' }],
        feedback: [{ kind: 'dismissed_not_relevant', at: T(-19, '08:35') }],
      },
    ],
  },
];
