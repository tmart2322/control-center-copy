/** Domain 02: Org62 Solutions Events, opportunity snapshot history, VDP records, VDP asset candidates, Claude sessions. All invented. */

// ───────────── Org62 Solutions Events logged by the owner (storyline 7, 19) ─────────────
export type O62Ev = {
  n: number;
  subject: string;
  d: number;
  t: string;
  hours: number | null; // Duration__c (null = never filled in)
  mins: number; // actual event minutes
  task: string | null;
  meeting: string | null;
  opp?: string;
  acct?: string;
  logged: { d: number; t: string }; // when the Org62 row was created
  cc?: boolean; // landed by the app (carries a CC key)
  deleted?: { d: number; t: string };
  modified?: { d: number; t: string };
};
const E = (n: number, subject: string, d: number, t: string, hours: number | null, mins: number, task: string | null, meeting: string | null, opp: string | undefined, acct: string | undefined, logged: [number, string], o: Partial<O62Ev> = {}): O62Ev => ({ n, subject, d, t, hours, mins, task, meeting, opp, acct, logged: { d: logged[0], t: logged[1] }, ...o });
const HP = 'saltmere-data360-poc';
export const ORG62_EVENTS: O62Ev[] = [
  // week of 10-19 logged Fri 10-23 by hand
  E(1, 'Saltmere - POC kickoff', -30, '10:00', 1, 60, 'Customer Discovery', 'CF', HP, 'saltmere', [-26, '16:40']),
  E(2, 'Yarrowdale - data foundation kickoff', -30, '14:00', 1, 60, 'Customer Discovery', 'CF', 'yarrowdale-enterprise-data', 'yarrowdale', [-26, '16:42']),
  E(3, 'Elderglen Outdoors - renewal kickoff', -30, '11:00', 0.5, 30, 'Customer Discovery', 'CF', 'elderglen-outdoors-renewal-expansion', 'elderglen-outdoors', [-26, '16:44']),
  E(4, 'Saltmere - weekly sync', -29, '11:00', 0.75, 45, 'POC', 'Proof of Concept', HP, 'saltmere', [-26, '16:46']),
  E(5, 'Saltmere - data model workshop', -28, '13:00', 2, 120, 'Workshop', 'Data Cloud Workshop', HP, 'saltmere', [-26, '16:48']),
  E(6, 'Halvergate - proposal walkthrough', -28, '15:00', 1, 60, 'Customer Presentation', 'CF', 'halvergate-route-exceptions-agent', 'halvergate', [-26, '16:50']),
  E(7, 'Saltmere - weekly sync', -27, '11:00', 0.75, 45, 'POC', 'Proof of Concept', HP, 'saltmere', [-26, '16:52']),
  E(8, '1:1 with Hana', -27, '14:00', 0.5, 30, 'Mentorship', null, undefined, undefined, [-26, '16:54']),
  E(9, 'Oakhallow - pilot retro', -26, '13:00', 1, 60, 'Customer Discovery', 'CR', 'oakhallow-agentforce-pilot', 'oakhallow', [-26, '16:56']),
  // week of 10-26 logged Fri 10-30 (dentist half day)
  E(10, 'Yarrowdale - architecture review', -23, '13:00', 1, 60, 'Workshop', 'Data Cloud Workshop', 'yarrowdale-enterprise-data', 'yarrowdale', [-19, '09:30']),
  E(11, 'Saltmere - weekly sync', -22, '11:00', 0.75, 45, 'POC', 'Proof of Concept', HP, 'saltmere', [-19, '09:32']),
  E(12, 'Saltmere - identity design notes', -22, '14:00', 1.5, 90, 'Solution Creation', null, HP, 'saltmere', [-19, '09:34']),
  E(13, 'Harrowgate - demo prep', -21, '08:00', 1.5, 90, 'Solution Creation', null, 'harrowgate-maintenance-agent', 'harrowgate', [-19, '09:36']),
  E(14, 'Harrowgate - predictive maintenance demo', -21, '10:00', 1, 60, 'Customer Presentation', 'CF', 'harrowgate-maintenance-agent', 'harrowgate', [-19, '09:38']),
  E(15, 'Ferrowpay - pursuit sync', -21, '15:00', 0.5, 30, 'Customer Discovery', 'CF', 'ferrowpay-data360-foundation', 'ferrowpay', [-19, '09:40']),
  E(16, 'Elderglen Outdoors - renewal sync', -20, '15:00', 0.5, 30, 'Customer Discovery', 'CF', 'elderglen-outdoors-renewal-expansion', 'elderglen-outdoors', [-19, '09:42']),
  E(17, '1:1 with Hana', -20, '14:00', 0.5, 30, 'Mentorship', null, undefined, undefined, [-19, '09:44']),
  E(18, 'SE team sync', -21, '10:00', 1, 60, 'Admin', null, undefined, undefined, [-19, '09:46'], { hours: null }),
  // week of 11-02 logged Fri 11-06 (by hand and one landed from the app)
  E(19, 'Yarrowdale - architecture review', -16, '13:00', 1, 60, 'Workshop', 'Data Cloud Workshop', 'yarrowdale-enterprise-data', 'yarrowdale', [-12, '10:10']),
  E(20, 'Oakhallow - negotiation sync', -16, '15:30', 0.5, 30, 'Customer Discovery', 'CF', 'oakhallow-claims-agent', 'oakhallow', [-12, '10:12']),
  E(21, 'Saltmere - weekly sync', -15, '11:00', 0.75, 45, 'POC', 'Proof of Concept', HP, 'saltmere', [-12, '10:14']),
  E(22, 'Elderglen Home - validation working session', -15, '14:00', 1, 60, 'POC', 'Proof of Concept', 'elderglen-home-personalization', 'elderglen-home', [-12, '10:16'], { cc: true, deleted: { d: -2, t: '09:40' } }),
  E(23, 'Yarrowdale Medical Group - discovery', -14, '11:00', 1, 60, 'Customer Discovery', 'CF', 'yarrowdale-mg-patient-engagement', 'yarrowdale-mg', [-12, '10:18']),
  E(24, 'Elderglen - identity resolution discovery', -14, '14:00', 1, 60, 'Customer Discovery', 'CF', 'elderglen-enterprise-identity', 'elderglen', [-12, '10:20']),
  E(25, 'Ferrowpay - pursuit sync', -14, '15:00', 0.5, 30, 'Customer Discovery', 'CF', 'ferrowpay-data360-foundation', 'ferrowpay', [-12, '10:22']),
  E(26, 'Saltmere - weekly sync', -13, '11:00', 0.75, 45, 'POC', 'Proof of Concept', HP, 'saltmere', [-12, '10:24']),
  E(27, 'Saltmere - production pricing walkthrough', -13, '11:45', 0.5, 30, 'Customer Presentation', 'CF', HP, 'saltmere', [-12, '10:26']),
  E(28, 'Ferrowpay - proposal review', -13, '16:00', 1, 60, 'Customer Presentation', 'CF', 'ferrowpay-data360-foundation', 'ferrowpay', [-12, '10:28']),
  E(29, '1:1 with Hana', -13, '14:00', 0.5, 30, 'Mentorship', null, undefined, undefined, [-12, '10:30']),
  E(30, 'Elderglen Home - technical validation kickoff', -12, '10:30', 1, 60, 'POC', 'Proof of Concept', 'elderglen-home-personalization', 'elderglen-home', [-12, '10:32'], { hours: null }),
  E(31, 'Saltmere - executive readout prep', -12, '14:00', 0.75, 45, 'Account Planning', null, HP, 'saltmere', [-12, '14:50']),
  // week of 11-09 logged by the logging canvas batch on Fri 11-13
  E(32, 'Yarrowdale - architecture review', -9, '13:00', 1, 60, 'Workshop', 'Data Cloud Workshop', 'yarrowdale-enterprise-data', 'yarrowdale', [-5, '09:30'], { cc: true }),
  E(33, 'Saltmere - readout outline', -9, '15:00', 0.5, 60, 'Account Planning', null, HP, 'saltmere', [-5, '09:30'], { cc: true }),
  E(34, 'Oakhallow - negotiation sync', -9, '15:30', 0.5, 30, 'Customer Discovery', 'CF', 'oakhallow-claims-agent', 'oakhallow', [-5, '09:30'], { cc: true }),
  E(35, 'Cascadia - workshop agenda review', -8, '10:00', 0.5, 30, 'Customer Discovery', 'CF', 'cascadia-citizen-assistant', 'cascadia', [-5, '09:30'], { cc: true }),
  E(36, 'Saltmere - weekly sync', -8, '11:00', 0.75, 45, 'POC', 'Proof of Concept', HP, 'saltmere', [-5, '09:30'], { cc: true }),
  E(37, 'Harrowgate - plant managers demo', -8, '13:00', 1, 60, 'Customer Presentation', 'CF', 'harrowgate-maintenance-agent', 'harrowgate', [-5, '09:30'], { cc: true }),
  E(38, 'SE team sync', -7, '10:00', 1, 60, 'Admin', null, undefined, undefined, [-5, '09:30'], { cc: true }),
  E(39, 'Ferrowpay - pursuit sync', -7, '15:00', 0.5, 30, 'Customer Discovery', 'CF', 'ferrowpay-data360-foundation', 'ferrowpay', [-5, '09:30'], { cc: true }),
  E(40, 'Saltmere - weekly sync', -6, '11:00', 0.75, 45, 'POC', 'Proof of Concept', HP, 'saltmere', [-5, '09:30'], { cc: true }),
  E(41, 'Saltmere - claims status demo for contact-center leads', -6, '13:00', 0.75, 45, 'POC', 'Proof of Concept', HP, 'saltmere', [-5, '09:30'], { cc: true }),
  E(42, '1:1 with Hana', -6, '14:00', 0.5, 30, 'Mentorship', null, undefined, undefined, [-5, '09:30'], { cc: true }),
  E(43, 'Yarrowdale Behavioral Health - intake triage intro', -6, '16:00', 0.5, 30, 'Customer Discovery', 'CF', 'yarrowdale-bh-intake', 'yarrowdale-bh', [-5, '09:30'], { cc: true }),
  E(45, 'Saltmere - weekly sync', -13, '11:00', 0.75, 45, 'POC', 'Proof of Concept', HP, 'saltmere', [-5, '09:31'], { cc: true }), // twin of o62-26 (hand-logged 11-06): the app landed a second row
  E(44, 'Ferrowpay - architecture sizing notes', -5, '10:00', 1.25, 75, 'Consumption Estimation', null, 'ferrowpay-data360-foundation', 'ferrowpay', [-5, '09:34'], { modified: { d: -2, t: '11:00' } }),
];

// ───────────── Opportunity snapshots: content and history ─────────────
export type OppHist = { d: number; t?: string; stage?: string; amount?: number; close?: string; fc?: string; next?: string };
export const OPP_NEXT: Record<string, string> = {
  'saltmere-data360-poc': 'Blueprint due Fri 11/20; vendor security questionnaire due 11/24; architecture board 12/1.',
  'saltmere-claims-copilot': 'Hold until POC readout in December.',
  'saltmere-provider-directory': 'Scoping call with Odalys Crespo not yet scheduled.',
  'yarrowdale-enterprise-data': 'Phases one-pager to Constance; budget review pending; BH trust domain slide added.',
  'yarrowdale-platform-renewal': 'Renewal paper with Yarrowdale procurement; signature expected before 12/31.',
  'yarrowdale-mg-patient-engagement': 'Solution design workshop to be scheduled after the referral decision.',
  'yarrowdale-bh-intake': 'Waiting on Hugo for call volumes and clinical review constraints.',
  'elderglen-outdoors-renewal-expansion': 'Order status demo Thu 11/19 or Fri 11/20 for Brendan; sign renewal by 11/30.',
  'elderglen-outdoors-loyalty': 'Discovery questions sent to Kwame; no date yet.',
  'elderglen-home-personalization': 'Technical validation plan in progress; sample data from Dominic Fri.',
  'elderglen-enterprise-identity': 'Jasmine\'s team to nominate a data owner; cooling.',
  'halvergate-route-exceptions-agent': 'No response from Anjali since 10/25. Close date 11/12 at risk. Re-engage via ops.',
  'halvergate-dispatch-data': 'Parked behind the route exceptions decision.',
  'ferrowpay-fraud-agent': 'Architecture session with fraud analysts Thu 11/19 2pm.',
  'ferrowpay-data360-foundation': 'Procurement review; third-year uplift corrected to 5%.',
  'harrowgate-maintenance-agent': 'Zainab pushing for budget by month end; SE of record is Tariq.',
  'harrowgate-plant-data': 'Discovery with plant IT scheduled after the maintenance decision.',
  'cascadia-citizen-assistant': 'Onsite workshop 11/23-24 hosted by Samir.',
  'cascadia-permits-data': 'Permits data inventory received from Noor; review after onsite.',
  'oakhallow-claims-agent': 'Order form addendum section 3 in legal; sign next week.',
  'oakhallow-underwriting-assist': 'Early discovery; revisit after claims triage signs.',
  'voltmere-outage-insights': 'Close date moved to 2027-02-01; CDO joins December readout.',
  'voltmere-service-agent': 'Qualified; budget not confirmed.',
  'contoso-seller-agent': 'Proposal with Julien; language coverage question open.',
  'contoso-realtime-recs': 'Waiting on contractor access to catalog events sample.',
};
export const OPP_PRODUCTS: Record<string, { p: string[]; d360: number; flex: number }> = {
  'saltmere-data360-poc': { p: ['Data 360', 'Agentforce', 'Flex Credits'], d360: 0.45, flex: 0.35 },
  'yarrowdale-enterprise-data': { p: ['Data 360', 'Flex Credits'], d360: 0.7, flex: 0.2 },
  'elderglen-outdoors-renewal-expansion': { p: ['Data 360', 'Agentforce'], d360: 0.55, flex: 0.15 },
  'ferrowpay-fraud-agent': { p: ['Agentforce', 'Data 360', 'Flex Credits'], d360: 0.3, flex: 0.4 },
  'ferrowpay-data360-foundation': { p: ['Data 360', 'Flex Credits'], d360: 0.7, flex: 0.2 },
  'oakhallow-claims-agent': { p: ['Agentforce', 'Flex Credits'], d360: 0, flex: 0.6 },
  'harrowgate-maintenance-agent': { p: ['Agentforce', 'Data 360'], d360: 0.35, flex: 0.2 },
  'cascadia-citizen-assistant': { p: ['Agentforce', 'Data 360'], d360: 0.4, flex: 0.1 },
};
export const OPP_HISTORY: Record<string, OppHist[]> = {
  'saltmere-data360-poc': [
    { d: -30, stage: 'Solution Design', amount: 1_100_000, close: '2026-12-19', fc: 'Pipeline', next: 'Kickoff done; agree first journey and success criteria.' },
    { d: -22, stage: 'Solution Design', amount: 1_250_000, close: '2026-12-19', fc: 'Best Case', next: 'Blueprint outline after identity design; exec checkpoint at board.' },
    { d: -15, stage: 'Technical Validation', amount: 1_250_000, close: '2026-12-12', fc: 'Best Case', next: 'Board checkpoint 12/1; blueprint and demo required.' },
  ],
  'elderglen-outdoors-renewal-expansion': [
    { d: -30, stage: 'Proposal', amount: 640_000, close: '2026-11-30', fc: 'Commit', next: 'Send renewal paper with expansion option.' },
    { d: -23, stage: 'Negotiation', amount: 780_000, close: '2026-11-30', fc: 'Commit', next: 'Deal desk approval for expansion lines; Brendan wants demo.' },
  ],
  'halvergate-route-exceptions-agent': [
    { d: -30, stage: 'Proposal', amount: 520_000, close: '2026-10-31', fc: 'Best Case', next: 'Anjali reviewing with ops leadership.' },
    { d: -24, stage: 'Proposal', amount: 520_000, close: '2026-11-12', fc: 'Best Case', next: 'Ops summit this week; Anjali to revert.' },
  ],
  'yarrowdale-enterprise-data': [
    { d: -30, stage: 'Solution Design', amount: 1_600_000, close: '2026-12-28', fc: 'Pipeline', next: 'Architecture review series starts.' },
    { d: -16, stage: 'Proposal', amount: 1_850_000, close: '2026-12-28', fc: 'Best Case', next: 'Phases one-pager for Constance.' },
  ],
  'ferrowpay-data360-foundation': [
    { d: -30, stage: 'Solution Design', amount: 950_000, close: '2026-12-16', fc: 'Best Case', next: 'Mapping questions with Renata.' },
    { d: -13, stage: 'Proposal', amount: 1_100_000, close: '2026-12-16', fc: 'Commit', next: 'Proposal review with Folasade; procurement next.' },
  ],
  'oakhallow-claims-agent': [
    { d: -30, stage: 'Proposal', amount: 970_000, close: '2026-12-15', fc: 'Best Case', next: 'Pilot feedback in; draft order form.' },
    { d: -10, stage: 'Negotiation', amount: 970_000, close: '2026-12-08', fc: 'Commit', next: 'Order form with legal; technical addendum.' },
  ],
  'cascadia-citizen-assistant': [
    { d: -30, stage: 'Discovery', amount: 400_000, close: '2027-01-07', fc: 'Pipeline', next: 'Plan the onsite workshop.' },
    { d: -20, stage: 'Solution Design', amount: 460_000, close: '2027-01-07', fc: 'Pipeline', next: 'Onsite 11/23-24 confirmed with Samir.' },
  ],
  'harrowgate-maintenance-agent': [
    { d: -28, stage: 'Discovery', amount: 600_000, close: '2026-12-21', fc: 'Pipeline', next: 'Demo with Zainab scheduled.' },
    { d: -9, stage: 'Technical Validation', amount: 730_000, close: '2026-12-21', fc: 'Best Case', next: 'Plant managers demo 11/10; budget push by month end.' },
  ],
  'yarrowdale-mg-patient-engagement': [
    { d: -30, stage: 'Discovery', amount: 350_000, close: '2027-01-12', fc: 'Pipeline' },
    { d: -15, stage: 'Solution Design', amount: 420_000, close: '2027-01-12', fc: 'Pipeline', next: 'Solution design workshop to be scheduled.' },
  ],
  'elderglen-home-personalization': [
    { d: -30, stage: 'Solution Design', amount: 300_000, close: '2026-12-23', fc: 'Best Case' },
    { d: -12, stage: 'Technical Validation', amount: 360_000, close: '2026-12-23', fc: 'Best Case', next: 'Two-week validation plan.' },
  ],
  'contoso-seller-agent': [
    { d: -30, stage: 'Discovery', amount: 280_000, close: '2027-01-02', fc: 'Pipeline' },
    { d: -6, stage: 'Proposal', amount: 340_000, close: '2027-01-02', fc: 'Best Case', next: 'Proposal with Julien.' },
  ],
  'voltmere-outage-insights': [{ d: -30, stage: 'Discovery', amount: 600_000, close: '2027-01-15', fc: 'Pipeline', next: 'Outage schema review.' }],
};
/** Opp team member snapshots (opps where the owner is on the team) and Deal Contribution snapshots. */
export const TEAM_ITEMS: Array<{ opp: string; role: string; d: number }> = [
  { opp: 'saltmere-data360-poc', role: 'Solutions Engineer', d: -30 },
  { opp: 'yarrowdale-enterprise-data', role: 'Solutions Engineer', d: -30 },
  { opp: 'elderglen-outdoors-renewal-expansion', role: 'Solutions Engineer', d: -30 },
  { opp: 'ferrowpay-fraud-agent', role: 'Solutions Engineer', d: -28 },
  { opp: 'ferrowpay-data360-foundation', role: 'Solutions Engineer', d: -28 },
  { opp: 'oakhallow-claims-agent', role: 'Solutions Engineer', d: -27 },
  { opp: 'cascadia-citizen-assistant', role: 'Solutions Engineer', d: -20 },
  { opp: 'yarrowdale-mg-patient-engagement', role: 'Solution Engineer', d: -15 },
];
export const DC_ITEMS: Array<{ n: number; opp: string; role: string; split: number; d: number; won: boolean }> = [
  { n: 1, opp: 'saltmere-care-mgmt', role: 'AI + Data Architect', split: 40, d: -29, won: true },
  { n: 2, opp: 'oakhallow-agentforce-pilot', role: 'AI + Data Architect', split: 50, d: -24, won: true },
  { n: 3, opp: 'ferrowpay-risk-score-pilot', role: 'Solution Architect', split: 33, d: -24, won: true },
];

// ───────────── VDP records (storyline 1, 4, 16) ─────────────
export type VdpDef = {
  key: string;
  slug: string;
  company: string;
  opp?: string;
  acct: string;
  uc: Array<{ vdpId: string; name: string; ai: boolean; golive: string | null }>;
  assets: Array<{ tag: string; type: string; desc?: string }>;
  ae: boolean;
  ta: boolean;
  fy?: number;
  fq?: number;
  missing: string[];
  archived?: boolean;
  gone?: boolean;
  lastActDay: number;
  createdDay: number;
  stakeholders: string[];
  collaborators?: string[];
  gist: string;
  url?: string;
};
export const VDPS: VdpDef[] = [
  { key: 'hv-poc', slug: 'saltmere-health-plan-data-360-poc', company: 'Saltmere Health Plan', opp: 'saltmere-data360-poc', acct: 'saltmere', uc: [{ vdpId: 'vdp-uc-smpl-001', name: 'Member Services Virtual Agent', ai: true, golive: '2027-03-15' }, { vdpId: 'vdp-uc-smpl-002', name: 'Claims Status Lookup', ai: true, golive: null }, { vdpId: 'vdp-uc-smpl-003', name: 'Unified Member Profile', ai: false, golive: '2027-02-01' }], assets: [{ tag: 'hv-workshop-readout', type: 'doc' }, { tag: 'hv-arch', type: 'deck' }], ae: false, ta: true, missing: ['No account executive listed on the VDP', 'Fewer than 3 assets (has 2): blueprint, success criteria and demo script are not added', 'Use case "Claims Status Lookup" has no go-live date', 'No executive summary', 'Stakeholders have no roles'], lastActDay: -3, createdDay: -29, stakeholders: ['Marisol Quintero', 'Priyanka Deshmukh', 'Soo-jin Baek'], gist: 'Saltmere POC VDP: 3 use cases, 2 assets, no AE, missing assets and owners (storyline 1)' },
  { key: 'aw-ent', slug: 'yarrowdale-health-system-enterprise-data', company: 'Yarrowdale Health System', opp: 'yarrowdale-enterprise-data', acct: 'yarrowdale', uc: [{ vdpId: 'vdp-uc-smpl-004', name: 'Enterprise Patient Data Foundation', ai: false, golive: null }], assets: [{ tag: 'aw-arch', type: 'doc' }, { tag: 'aw-ehr', type: 'sheet' }], ae: true, ta: true, missing: ['Use case has no go-live date', 'No executive summary'], lastActDay: -4, createdDay: -27, stakeholders: ['Lars Nyberg', 'Constance Okeke'], gist: 'Yarrowdale parent VDP for the enterprise data foundation (family anchor)' },
  { key: 'qp-fraud', slug: 'ferrowpay-financial-fraud-agent', company: 'Ferrowpay Financial', opp: 'ferrowpay-fraud-agent', acct: 'ferrowpay', uc: [{ vdpId: 'vdp-uc-smpl-005', name: 'Fraud Case Triage', ai: true, golive: '2027-04-30' }], assets: [{ tag: 'qp-workflow', type: 'doc' }, { tag: 'qp-demo', type: 'deck' }], ae: true, ta: true, missing: ['Architecture deck not added'], lastActDay: -5, createdDay: -26, stakeholders: ['Folasade Adeyemi', 'Renata Vieira'], gist: 'Ferrowpay fraud agent VDP; architecture deck still to add' },
  { key: 'qp-d360', slug: 'ferrowpay-financial-data-360-foundation', company: 'Ferrowpay Financial', opp: 'ferrowpay-data360-foundation', acct: 'ferrowpay', uc: [{ vdpId: 'vdp-uc-smpl-006', name: 'Customer 360 for Risk', ai: false, golive: null }], assets: [{ tag: 'qp-risk', type: 'deck' }], ae: true, ta: true, missing: ['Use case has no go-live date', 'Fewer than 3 assets (has 1)'], lastActDay: -7, createdDay: -26, stakeholders: ['Folasade Adeyemi'], gist: 'Ferrowpay Data 360 foundation VDP; thin on assets' },
  { key: 'pc-claims', slug: 'oakhallow-mutual-claims-agent', company: 'Oakhallow Mutual Insurance', opp: 'oakhallow-claims-agent', acct: 'oakhallow', uc: [{ vdpId: 'vdp-uc-smpl-007', name: 'Claims Triage Agent', ai: true, golive: '2026-12-15' }], assets: [{ tag: 'pc-arch', type: 'deck' }], ae: true, ta: true, missing: ['Fewer than 3 assets (has 1)'], lastActDay: -2, createdDay: -25, stakeholders: ['Valentina Moretti', 'Corwin Aldridge'], gist: 'Oakhallow claims triage VDP (negotiation)' },
  { key: 'to-exp', slug: 'elderglen-outdoors-expansion', company: 'Elderglen Outdoors', opp: 'elderglen-outdoors-renewal-expansion', acct: 'elderglen-outdoors', uc: [{ vdpId: 'vdp-uc-smpl-008', name: 'Order Status Agent', ai: true, golive: null }], assets: [{ tag: 'to-mkt-case', type: 'deck' }, { tag: 'to-usage', type: 'sheet' }], ae: true, ta: true, missing: ['Use case has no go-live date', 'Demo deck not added'], lastActDay: -1, createdDay: -24, stakeholders: ['Brendan Hartigan', 'Mei-Ling Tran'], gist: 'Elderglen Outdoors expansion VDP; demo deck to add' },
  { key: 'cc-cit', slug: 'cascadia-county-citizen-assistant', company: 'Cascadia County Services', opp: 'cascadia-citizen-assistant', acct: 'cascadia', uc: [{ vdpId: 'vdp-uc-smpl-009', name: 'Citizen Services Assistant', ai: true, golive: '2027-06-01' }], assets: [{ tag: 'cc-concept', type: 'deck' }], ae: true, ta: true, missing: ['Fewer than 3 assets (has 1)'], lastActDay: -8, createdDay: -14, stakeholders: ['Samir Banerjee'], gist: 'Cascadia citizen assistant VDP; onsite workshop upcoming' },
  { key: 'pc-pilot', slug: 'oakhallow-mutual-agentforce-pilot', company: 'Oakhallow Mutual Insurance', opp: 'oakhallow-agentforce-pilot', acct: 'oakhallow', uc: [{ vdpId: 'vdp-uc-smpl-010', name: 'Policy FAQ Agent (pilot)', ai: true, golive: '2026-10-20' }], assets: [{ tag: 'pc-pilot', type: 'deck' }, { tag: 'pc-topics', type: 'doc' }, { tag: 'pc-pilot-rec', type: 'recording', desc: 'Go-live walkthrough (one of the rare recordings kept)' }], ae: true, ta: true, missing: [], lastActDay: -9, createdDay: -29, stakeholders: ['Corwin Aldridge', 'Valentina Moretti'], gist: 'Oakhallow pilot VDP: complete, live use case, one recording kept' },
  { key: 'aw-bh', slug: 'yarrowdale-health-system-intake-triage', company: 'Yarrowdale Health System', opp: 'yarrowdale-bh-intake', acct: 'yarrowdale-bh', uc: [], assets: [], ae: true, ta: true, missing: ['No use cases', 'No assets', 'Company identity unclear: filed under the parent, opp belongs to Behavioral Health'], lastActDay: -6, createdDay: -6, stakeholders: ['Hugo Lindahl'], gist: 'Yarrowdale BH intake VDP filed under the parent company (company-identity ambiguity, storyline 4)' },
  { key: 'th-pers', slug: 'elderglen-home-living-personalization-engine', company: 'Elderglen Home & Living', opp: 'elderglen-home-personalization', acct: 'elderglen-home', uc: [], assets: [{ tag: 'th-persona', type: 'doc' }], ae: true, ta: true, missing: ['No use cases'], lastActDay: -5, createdDay: -12, stakeholders: ['Dominic Vasquez'], gist: 'Elderglen Home personalization VDP: no use cases yet' },
  { key: 'hv-care', slug: 'saltmere-health-plan-care-management-foundation', company: 'Saltmere Health Plan', opp: 'saltmere-care-mgmt', acct: 'saltmere', uc: [], assets: [{ tag: 'hv-care-case', type: 'deck' }], ae: true, ta: true, missing: [], archived: true, fy: 26, fq: 4, lastActDay: -60, createdDay: -29, stakeholders: ['Marisol Quintero'], gist: 'Archived FY26 VDP for the won care management foundation (reference case)' },
  { key: 'bw-quality', slug: 'harrowgate-manufacturing-quality-insights', company: 'Harrowgate Manufacturing', opp: 'harrowgate-quality-insights', acct: 'harrowgate', uc: [], assets: [], ae: true, ta: true, missing: ['No use cases', 'No assets'], gone: true, fy: 26, fq: 2, lastActDay: -40, createdDay: -29, stakeholders: [], gist: 'Harrowgate quality VDP no longer listed by the VDP read (gone_at set, kept)' },
];

// ───────────── VDP asset candidates (storyline 16) ─────────────
export type Cand = { asset: string; acct: string; slug: string | null; status: 'unsure' | 'suggested' | 'added' | 'in_vdp' | 'dismissed'; conf: number; origin: 'matcher' | 'backfill' | 'chat'; why: string; kind?: string; day: number; title?: string; url?: string; key?: string; statusDay?: number };
const C = (asset: string, acct: string, slug: string | null, status: Cand['status'], conf: number, origin: Cand['origin'], why: string, day: number, o: Partial<Cand> = {}): Cand => ({ asset, acct, slug, status, conf, origin, why, day, ...o });
const HVS = 'saltmere-health-plan-data-360-poc';
export const CANDIDATES: Cand[] = [
  // Saltmere (storyline 1): VDP missing assets
  C('hv-workshop-readout', 'saltmere', HVS, 'in_vdp', 0.97, 'matcher', 'Workshop readout is already on the VDP.', -22),
  C('hv-arch', 'saltmere', HVS, 'in_vdp', 0.95, 'matcher', 'Architecture overview is already on the VDP.', -15),
  C('hv-blueprint', 'saltmere', HVS, 'suggested', 0.82, 'matcher', 'The solution blueprint is the main POC deliverable (final due 11/20); the VDP has no blueprint yet. Add once it is sent.', -13),
  C('hv-success', 'saltmere', HVS, 'suggested', 0.9, 'matcher', 'Success criteria for the POC, authored by the owner and shared with the customer in #saltmere-poc.', -12),
  C('hv-demo-script', 'saltmere', HVS, 'suggested', 0.75, 'matcher', 'Demo script for the member services agent; useful for reviewers of the VDP.', -6),
  C('hv-demo-org', 'saltmere', HVS, 'suggested', 0.8, 'backfill', 'Sandbox demo org for the POC, referenced in the weekly sync notes.', -3, { kind: 'demo' }),
  C('hv-journey', 'saltmere', HVS, 'added', 0.7, 'matcher', 'Customer-authored member journey map; handed off to be added to the VDP.', -20, { statusDay: -2 }),
  C('hv-kpi', 'saltmere', HVS, 'unsure', 0.55, 'matcher', 'Customer-authored KPI sheet; unsure whether the customer wants it on a shared VDP.', -12),
  C('hv-exec-deck', 'saltmere', HVS, 'unsure', 0.5, 'backfill', 'Executive readout is still a draft owned by the AE.', -4),
  C('hv-sizing', 'saltmere', HVS, 'unsure', 0.5, 'matcher', 'Consumption sizing sheet includes pricing assumptions; VDP is a shared repository.', -9),
  C('hv-rec-1103', 'saltmere', HVS, 'dismissed', 0.4, 'matcher', 'Weekly sync recording; recordings are rarely worth adding and this one is not a deliverable.', -15, { kind: 'recording' }),
  C('hv-talk', 'saltmere', HVS, 'dismissed', 0.45, 'backfill', 'Internal talk track, not for a shared repository.', -12),
  C('sc-2', 'saltmere', HVS, 'dismissed', 0.35, 'matcher', 'Copy of the architecture overview (duplicate of an asset already on the VDP).', -21),
  C('hv-sec-q', 'saltmere', HVS, 'dismissed', 0.3, 'matcher', 'Security questionnaire contains customer-confidential answers.', -1),
  C('hv-decisions-canvas', 'saltmere', HVS, 'suggested', 0.78, 'matcher', 'Slack canvas with the POC decision log shared in #saltmere-poc.', -10, { title: 'Saltmere POC decision log', kind: 'canvas', url: 'https://workspace.slack.example/docs/F0SMPL031', key: 'slack-canvas:F0SMPL031' }),
  // Yarrowdale family (storyline 4)
  C('aw-arch', 'yarrowdale', 'yarrowdale-health-system-enterprise-data', 'in_vdp', 0.9, 'matcher', 'Architecture review notes are on the VDP.', -16),
  C('aw-ehr', 'yarrowdale', 'yarrowdale-health-system-enterprise-data', 'in_vdp', 0.88, 'matcher', 'EHR instance inventory is on the VDP.', -23),
  C('aw-proposal', 'yarrowdale', 'yarrowdale-health-system-enterprise-data', 'suggested', 0.85, 'matcher', 'Phases proposal deck shared with Lars; the VDP has no proposal asset.', -2),
  C('aw-consump', 'yarrowdale', 'yarrowdale-health-system-enterprise-data', 'suggested', 0.6, 'backfill', 'Consumption estimate v1 by the specialist.', -7, { kind: 'sheet' }),
  C('aw-renewal', 'yarrowdale', 'yarrowdale-health-system-enterprise-data', 'dismissed', 0.3, 'matcher', 'Renewal summary belongs to a different opportunity the owner is not on.', -6),
  C('aw-bh-intake', 'yarrowdale-bh', null, 'unsure', 0.5, 'matcher', 'BH intake discovery notes; unsure whether this goes on the parent company VDP or a Behavioral Health one.', -11),
  C('aw-bh-canvas', 'yarrowdale-bh', null, 'unsure', 0.45, 'matcher', 'Slack canvas about BH identity handling; company identity unclear (parent vs Behavioral Health).', -6, { title: 'BH identity notes', kind: 'canvas', url: 'https://workspace.slack.example/docs/F0SMPL032', key: 'slack-canvas:F0SMPL032' }),
  C('aw-bh-link', 'yarrowdale-bh', null, 'unsure', 0.4, 'backfill', 'Link to a customer-hosted intake workflow diagram shared by email.', -9, { title: 'BH intake workflow diagram', kind: 'link', url: 'https://portal.yarrowdale-behavioral.example/intake/workflow', key: 'url:portal.yarrowdale-behavioral.example/intake/workflow' }),
  C('aw-mg-engage', 'yarrowdale-mg', null, 'suggested', 0.6, 'matcher', 'Patient engagement concept deck; the Medical Group has no VDP yet, the candidate waits for one.', -10),
  C('aw-mg-retro', 'yarrowdale-mg', null, 'dismissed', 0.25, 'matcher', 'Loss retro for the referral agent is internal.', -11),
  // Ferrowpay
  C('qp-workflow', 'ferrowpay', 'ferrowpay-financial-fraud-agent', 'in_vdp', 0.9, 'matcher', 'Analyst workflow notes are on the VDP.', -15),
  C('qp-demo', 'ferrowpay', 'ferrowpay-financial-fraud-agent', 'in_vdp', 0.88, 'matcher', 'Demo walkthrough is on the VDP.', -4),
  C('qp-risk', 'ferrowpay', 'ferrowpay-financial-data-360-foundation', 'in_vdp', 0.8, 'backfill', 'Risk scoring pilot readout, the reference for this foundation deal.', -42),
  C('qp-arch', 'ferrowpay', 'ferrowpay-financial-fraud-agent', 'suggested', 0.88, 'matcher', 'Architecture deck for the fraud agent; shared with the customer.', -5),
  C('qp-estimate', 'ferrowpay', 'ferrowpay-financial-data-360-foundation', 'unsure', 0.6, 'matcher', 'Consumption estimate includes pricing; unsure it belongs on the VDP.', -7),
  C('qp-schema', 'ferrowpay', 'ferrowpay-financial-data-360-foundation', 'unsure', 0.55, 'matcher', 'Customer-authored schema mapping document.', -13),
  C('qp-taxonomy', 'ferrowpay', 'ferrowpay-financial-fraud-agent', 'suggested', 0.7, 'matcher', 'Slack canvas with the fraud case taxonomy shared in #ferrowpay-pursuit.', -9, { title: 'Fraud case taxonomy', kind: 'canvas', url: 'https://workspace.slack.example/docs/F0SMPL033', key: 'slack-canvas:F0SMPL033' }),
  // Oakhallow
  C('pc-arch', 'oakhallow', 'oakhallow-mutual-claims-agent', 'in_vdp', 0.9, 'matcher', 'Claims triage architecture is on the VDP.', -17),
  C('pc-pilot', 'oakhallow', 'oakhallow-mutual-agentforce-pilot', 'in_vdp', 0.9, 'matcher', 'Pilot results readout is on the VDP.', -26),
  C('pc-topics', 'oakhallow', 'oakhallow-mutual-agentforce-pilot', 'in_vdp', 0.85, 'matcher', 'Topic definitions are on the VDP.', -24),
  C('pc-pilot-rec', 'oakhallow', 'oakhallow-mutual-agentforce-pilot', 'in_vdp', 0.7, 'backfill', 'Go-live walkthrough recording, kept on purpose.', -29, { kind: 'recording' }),
  C('pc-order-form', 'oakhallow', 'oakhallow-mutual-claims-agent', 'dismissed', 0.2, 'matcher', 'Order form addendum is contractual, not for the VDP.', -2),
  C('pc-results-link', 'oakhallow', 'oakhallow-mutual-claims-agent', 'suggested', 0.72, 'matcher', 'Pilot results deck link Corwin shared by email.', -9, { title: 'Pilot containment dashboard (customer)', kind: 'link', url: 'https://reports.oakhallowmutual.example/pilot/containment', key: 'url:reports.oakhallowmutual.example/pilot/containment' }),
  // Elderglen family
  C('to-mkt-case', 'elderglen-outdoors', 'elderglen-outdoors-expansion', 'in_vdp', 0.9, 'matcher', 'Case study from the marketing rollout is on the VDP.', -75),
  C('to-usage', 'elderglen-outdoors', 'elderglen-outdoors-expansion', 'in_vdp', 0.85, 'matcher', 'Usage trend sheet is on the VDP.', -16),
  C('to-demo', 'elderglen-outdoors', 'elderglen-outdoors-expansion', 'suggested', 0.9, 'matcher', 'Order status demo deck for the expansion; the VDP has no demo deck.', -1),
  C('to-oms', 'elderglen-outdoors', 'elderglen-outdoors-expansion', 'unsure', 0.55, 'backfill', 'Integration notes include customer sandbox details.', -1),
  C('to-renewal-order', 'elderglen-outdoors', 'elderglen-outdoors-expansion', 'dismissed', 0.2, 'matcher', 'Renewal order form summary is commercial.', -4),
  C('th-persona', 'elderglen-home', 'elderglen-home-living-personalization-engine', 'in_vdp', 0.9, 'matcher', 'Validation plan is on the VDP.', -5),
  C('th-loyalty', 'elderglen-home', 'elderglen-home-living-personalization-engine', 'unsure', 0.5, 'backfill', 'Post-mortem of a lost loyalty deal; unsure of value.', -19),
  C('tg-identity', 'elderglen', null, 'suggested', 0.7, 'matcher', 'Identity resolution brief for the parent group; no VDP for the group yet.', -13),
  // Cascadia
  C('cc-concept', 'cascadia', 'cascadia-county-citizen-assistant', 'in_vdp', 0.9, 'matcher', 'Concept deck is on the VDP.', -14),
  C('cc-agenda', 'cascadia', 'cascadia-county-citizen-assistant', 'suggested', 0.8, 'matcher', 'Workshop agenda shared with Samir.', -1),
  C('cc-permits', 'cascadia', 'cascadia-county-citizen-assistant', 'unsure', 0.6, 'matcher', 'Customer-authored permits data inventory sheet.', -21),
  C('cc-logistics', 'cascadia', 'cascadia-county-citizen-assistant', 'dismissed', 0.15, 'matcher', 'Logistics doc is not an asset.', -13),
  // Care management (archived VDP)
  C('hv-care-case', 'saltmere', 'saltmere-health-plan-care-management-foundation', 'in_vdp', 0.9, 'backfill', 'Case study for the won care management deal.', -60),
  // Harrowgate (storyline 5: demo work not on the opp team)
  C('bw-demo', 'harrowgate', null, 'suggested', 0.85, 'backfill', 'Deck the owner built for two demos; there is no VDP for this opportunity yet.', -9),
  C('bw-dash', 'harrowgate', null, 'suggested', 0.7, 'backfill', 'Plant dashboard walkthrough from the second demo.', -9),
  C('bw-rec', 'harrowgate', null, 'dismissed', 0.35, 'backfill', 'Recording of the plant managers demo; recordings are rare.', -8, { kind: 'recording' }),
  C('bw-sensors', 'harrowgate', null, 'unsure', 0.5, 'backfill', 'Customer-authored sensor inventory.', -20),
  C('bw-brief', 'harrowgate', null, 'dismissed', 0.2, 'backfill', 'Internal account brief from the AE.', -22),
  // Halvergate
  C('ns-proposal', 'halvergate', null, 'suggested', 0.75, 'backfill', 'Proposal deck; no VDP exists yet for this stalled opportunity.', -27),
  C('ns-ops', 'halvergate', null, 'unsure', 0.5, 'backfill', 'Dispatch discovery notes.', -28),
  C('ns-recap', 'halvergate', null, 'dismissed', 0.25, 'chat', 'Draft value recap, not a customer asset yet.', -5),
];

// ───────────── Claude sessions (storyline 11) ─────────────
export type CS = { key: string; repo: string; cwd: string; branch: string; title: string; d: number; start: string; end: string; prompts: number; status: 'idle' | 'done' | 'waiting'; files: string[]; acct?: string; opp?: string; summary: string; bg?: number; compactions?: number };
export const CLAUDE_SESSIONS: CS[] = [
  { key: 'cs-01', repo: 'shared-demo-kit', cwd: '/Users/rafael/Projects/shared-demo-kit', branch: 'harrowgate-demo', title: 'Build predictive maintenance agent demo', d: -22, start: '19:05', end: '21:30', prompts: 14, status: 'done', files: ['demos/maintenance/topics.yaml', 'demos/maintenance/sensors.csv', 'README.md'], acct: 'harrowgate', opp: 'harrowgate-maintenance-agent', summary: 'Built the failure prediction topic and a work order action over synthetic sensor data; deck exported for tomorrow.' },
  { key: 'cs-02', repo: 'shared-demo-kit', cwd: '/Users/rafael/Projects/shared-demo-kit', branch: 'harrowgate-demo', title: 'Plant dashboards for the second Harrowgate demo', d: -9, start: '19:30', end: '21:15', prompts: 9, status: 'done', files: ['demos/maintenance/dashboards.json'], acct: 'harrowgate', opp: 'harrowgate-maintenance-agent', summary: 'Added per-plant dashboard definitions and scaled the sample data to five plants.' },
  { key: 'cs-03', repo: 'saltmere-poc-demo', cwd: '/Users/rafael/Projects/saltmere-poc-demo', branch: 'main', title: 'Claims status topic and handoff flow', d: -7, start: '09:10', end: '11:45', prompts: 18, status: 'done', files: ['topics/claim_status.yaml', 'flows/handoff_case_summary.yaml', 'data/synthetic_members.csv'], acct: 'saltmere', opp: 'saltmere-data360-poc', summary: 'Implemented the claims status topic, the handoff flow with a case summary, and 40 synthetic members.', bg: 1 },
  { key: 'cs-04', repo: 'saltmere-poc-demo', cwd: '/Users/rafael/Projects/saltmere-poc-demo', branch: 'main', title: 'Synthetic member loader and org seeding script', d: -6, start: '08:15', end: '09:40', prompts: 7, status: 'done', files: ['scripts/seed_org.ts', 'data/synthetic_members.csv'], acct: 'saltmere', opp: 'saltmere-data360-poc', summary: 'Wrote the seeding script for the demo org and verified record counts.' },
  { key: 'cs-05', repo: 'ferrowpay-fraud-agent', cwd: '/Users/rafael/Projects/ferrowpay-fraud-agent', branch: 'main', title: 'Map transaction schema to DMOs', d: -13, start: '13:20', end: '15:10', prompts: 11, status: 'done', files: ['mapping/transactions.yaml', 'mapping/merchants.yaml'], acct: 'ferrowpay', opp: 'ferrowpay-fraud-agent', summary: 'Drafted DMO mappings for transactions and a self-referencing merchant hierarchy.' },
  { key: 'cs-06', repo: 'ferrowpay-fraud-agent', cwd: '/Users/rafael/Projects/ferrowpay-fraud-agent', branch: 'feat/case-summary', title: 'Fraud case summary prompts', d: -5, start: '16:00', end: '17:20', prompts: 8, status: 'idle', files: ['prompts/case_summary.md', 'tests/case_summary.test.ts'], acct: 'ferrowpay', opp: 'ferrowpay-fraud-agent', summary: 'Iterated the case summary prompt against ten synthetic cases; two still flaky.', compactions: 1 },
  { key: 'cs-07', repo: 'shared-demo-kit', cwd: '/Users/rafael/Projects/shared-demo-kit', branch: 'to-order-status', title: 'Order status skill against the OMS sandbox shape', d: -1, start: '14:30', end: '16:55', prompts: 12, status: 'idle', files: ['demos/order-status/skill.yaml', 'demos/order-status/mock_oms.json'], acct: 'elderglen-outdoors', opp: 'elderglen-outdoors-renewal-expansion', summary: 'Built the order status skill against a mock of the OMS shape; split shipment case works, partial refund hands off.', bg: 2 },
  { key: 'cs-08', repo: 'saltmere-poc-demo', cwd: '/Users/rafael/Projects/saltmere-poc-demo', branch: 'feat/denied-claim', title: 'Denied-claim scenario for the demo', d: 0, start: '07:55', end: '08:35', prompts: 5, status: 'waiting', files: ['topics/denied_claim.yaml'], acct: 'saltmere', opp: 'saltmere-data360-poc', summary: 'Started the denied-claim topic with plain-language explanation; waiting for the approved wording list.' },
  { key: 'cs-09', repo: 'se-notes', cwd: '/Users/rafael/Projects/se-notes', branch: 'main', title: 'Summarize weekly notes into the log tracker', d: -20, start: '16:30', end: '16:55', prompts: 3, status: 'done', files: ['weekly/2026-10-26.md'], summary: 'Condensed the week into time-log lines.' },
  { key: 'cs-10', repo: 'scratch', cwd: '/Users/rafael/Projects/scratch', branch: 'main', title: 'Try fuzzy match ruleset on sample addresses', d: -16, start: '11:20', end: '12:05', prompts: 6, status: 'done', files: ['fuzzy_test.py'], summary: 'Exploration of fuzzy matching on a sample address set; not customer related.' },
  { key: 'cs-11', repo: 'saltmere-poc-demo', cwd: '/Users/rafael/Projects/saltmere-poc-demo', branch: 'main', title: 'Refactor the demo org loader (weekend)', d: -4, start: '10:00', end: '11:30', prompts: 6, status: 'done', files: ['scripts/seed_org.ts'], acct: 'saltmere', opp: 'saltmere-data360-poc', summary: 'Weekend refactor of the loader to make it idempotent.' },
];
