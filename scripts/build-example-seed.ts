/**
 * Generates src/mock/seed.example.json: committed PLACEHOLDER data only (ACME, Globex, Initech, Umbrella,
 * Hooli; Dana, Marcus, …). No real customers. Run: `npm run seed:example`.
 *
 * The seed's "now" is Thu 2026-11-05 09:02 MT (America/Denver); the mock rebases every date onto today on load.
 * The real fixture lives outside the repo (SEED lane): ~/Library/Application Support/control-center/fixtures/seed.json
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Destination, Seed, type SeedInput } from '../src/contract';
import { docFromText, plainText, renderAll } from '../src/server/datasource/mock/render';
import { dismissSourceOf } from '../src/engines/activity/internal';
import { DELETED_IN_ORG62, NOT_IN_ORG62_FLAG, ORG62_CHECK_PREFIX } from '../src/engines/activity/org62-check';
import { templateNote, type NoteFacts } from '../src/engines/activity/note';

type In = SeedInput;
type WI = In['workItems'][number];
type DraftIn = In['drafts'][number];
type NbaIn = In['nbas'][number];

// ---------------------------------------------------------------------------
// time helpers (Mountain Time: MST = UTC-7 in November)
// ---------------------------------------------------------------------------
const BASE = { y: 2026, m: 10, d: 5 }; // month is 0-based
/** Instant on day `off` (0 = Thu Nov 5) at local HH:MM MT. */
const t = (off: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(BASE.y, BASE.m, BASE.d + off, h + 7, m)).toISOString();
};
const day = (off: number) => t(off, '12:00').slice(0, 10);
const NOW = t(0, '09:02');

// ---------------------------------------------------------------------------
// people / accounts / opps
// ---------------------------------------------------------------------------
const me = { id: 'p_me', name: 'Jordan Lee', email: 'jordan.lee@example.com' };
const P = {
  priya: { id: 'p_priya', name: 'Priya Shah', role: 'Manager', isManager: true },
  dana: { id: 'p_dana', name: 'Dana Reyes', role: 'ACME · Director of Data', isExternal: true },
  raj: { id: 'p_raj', name: 'Raj Mehta', role: 'AE · ACME' },
  marcus: { id: 'p_marcus', name: 'Marcus Webb', role: 'Globex · VP Platform', isExternal: true },
  elena: { id: 'p_elena', name: 'Elena Cruz', role: 'AE · Globex' },
  peter: { id: 'p_peter', name: 'Peter Gibbons', role: 'Initech · Data Lead', isExternal: true },
  alice: { id: 'p_alice', name: 'Alice Abernathy', role: 'Umbrella · Chief Architect', isExternal: true },
  nora: { id: 'p_nora', name: 'Nora Patel', role: 'Hooli · Head of AI', isExternal: true },
  leo: { id: 'p_leo', name: 'Leo Park', role: 'PM · Nimbus Context Engine' },
  ravi: { id: 'p_ravi', name: 'Ravi Menon', role: 'SE · Beacon' },
  kim: { id: 'p_kim', name: 'Kim Tran', role: 'SE · peer' },
};

const people: In['people'] = [
  { ...P.priya, email: 'priya.shah@example.com', slackHandle: 'U0PRIYA', accountId: null },
  { ...P.dana, email: 'dana.reyes@acme.example', slackHandle: 'U0DANA', accountId: 'acc_acme' },
  { ...P.raj, email: 'raj.mehta@example.com', slackHandle: 'U0RAJ', accountId: null },
  { ...P.marcus, email: 'marcus.webb@globex.example', accountId: 'acc_globex' },
  { ...P.elena, email: 'elena.cruz@example.com', slackHandle: 'U0ELENA', accountId: null },
  { ...P.peter, email: 'peter.gibbons@initech.example', accountId: 'acc_initech' },
  { ...P.alice, email: 'alice@umbrella.example', accountId: 'acc_umbrella' },
  { ...P.nora, email: 'nora.patel@hooli.example', slackHandle: 'U0NORA', accountId: 'acc_hooli' },
  { ...P.leo, email: 'leo.park@example.com', slackHandle: 'U0LEO', accountId: null },
  { ...P.ravi, email: 'ravi.menon@example.com', slackHandle: 'U0RAVI', accountId: null },
  { ...P.kim, email: 'kim.tran@example.com', slackHandle: 'U0KIM', accountId: null },
];

/** A placeholder Org62 record link (fake 001XX… / 006XX… ids on a `.test` host). */
const org62Link = (object: 'Account' | 'Opportunity', id: string) => `https://org62.example.test/lightning/r/${object}/${id}/view`;

const accounts: In['accounts'] = [
  { id: 'acc_acme', name: 'ACME Corp', industry: 'Manufacturing', dcStatus: 'assigned', vdpStatus: 'linked', hoursQtd: 41.5, team: [P.raj], notes: 'Phase 1 live since August; Phase 2 is headless.', org62Url: org62Link('Account', '001XX0000SEED01AAA') },
  { id: 'acc_globex', name: 'Globex', industry: 'Financial Services', dcStatus: 'partial', vdpStatus: 'linked', hoursQtd: 28, team: [P.elena], org62Url: org62Link('Account', '001XX0000SEED02AAA') },
  { id: 'acc_initech', name: 'Initech', industry: 'Software', dcStatus: 'assigned', vdpStatus: 'none', hoursQtd: 6.5, team: [], org62Url: org62Link('Account', '001XX0000SEED03AAA') },
  { id: 'acc_umbrella', name: 'Umbrella Health', industry: 'Healthcare', dcStatus: 'partial', vdpStatus: 'stale', hoursQtd: 19.25, team: [] },
  { id: 'acc_hooli', name: 'Hooli', industry: 'Technology', dcStatus: 'assigned', vdpStatus: 'none', hoursQtd: 12, team: [] },
  // D-69 company identity (src/mock/vdp.ts gives them their Org62 parents and VDP's companies): a " - org/product" child
  // of Globex (one company with it), a subsidiary brand under a parent outside my book (kept separate), a child whose
  // name matches two VDP companies (Needs you), and one you mapped with Change… (Soylent Corporation)
  { id: 'acc_globex_mc', name: 'Globex - Marketing Cloud', industry: 'Financial Services', dcStatus: 'assigned', vdpStatus: 'none', hoursQtd: 0, team: [], org62Url: org62Link('Account', '001XX0000SEED06AAA') },
  { id: 'acc_nexus', name: 'Nexus Care', industry: 'Healthcare', dcStatus: 'assigned', vdpStatus: 'none', hoursQtd: 0, team: [], org62Url: org62Link('Account', '001XX0000SEED07AAA') },
  { id: 'acc_cyberdyne', name: 'Cyberdyne Systems - Robotics', industry: 'Manufacturing', dcStatus: 'assigned', vdpStatus: 'none', hoursQtd: 0, team: [], org62Url: org62Link('Account', '001XX0000SEED08AAA') },
  { id: 'acc_soylent', name: 'Soylent Foods', industry: 'Consumer Goods', dcStatus: 'assigned', vdpStatus: 'none', hoursQtd: 0, team: [], org62Url: org62Link('Account', '001XX0000SEED09AAA') },
];

/**
 * My DC on an opp as the Org62 scans read it (D-63: an open opp where it is 100% belongs in my VDPs; 50% creates
 * nothing). Placeholder Deal_Contribution__c ids.
 */
const dc = (n: number, split: number) => ({ split, role: 'AI + Data Architect', org62DcId: `a0XXSEEDDC${String(n).padStart(4, '0')}AAA`, lastSeenAt: t(-1, '06:00') });

const opp = (o: Partial<In['opps'][number]> & Pick<In['opps'][number], 'id' | 'accountId' | 'name' | 'stage' | 'amount' | 'closeDate'>): In['opps'][number] => ({
  isOpen: true,
  isMine: true,
  dcAssigned: true,
  vdpLinked: false,
  hoursQtd: 0,
  nextStep: null,
  products: ['Data 360'],
  owner: null,
  org62Url: null,
  updatedAt: t(-1, '17:00'),
  ...o,
});

// Org62 opp ids are the placeholders the mock already shows for these opps (src/mock/org62-opps.ts mockOrg62IdFor)
const opps: In['opps'] = [
  opp({ id: 'opp_acme_p2', accountId: 'acc_acme', name: 'ACME · Headless Phase 2', stage: 'Solution Design', amount: 850_000, closeDate: day(40), vdpLinked: true, hoursQtd: 30, nextStep: 'Phase 2 demo today 13:00', products: ['Data 360', 'Agentforce'], owner: P.raj, forecastCategory: 'Best Case', org62Url: org62Link('Opportunity', '006XXoppacmep20AAA'), myDc: dc(1, 100) }),
  opp({ id: 'opp_acme_af', accountId: 'acc_acme', name: 'ACME · Agentforce Service', stage: 'Discovery', amount: 320_000, closeDate: day(86), hoursQtd: 11.5, owner: P.raj, products: ['Agentforce'], forecastCategory: 'Pipeline', org62Url: org62Link('Opportunity', '006XXoppacmeaf0AAA'), myDc: dc(2, 100) }),
  opp({ id: 'opp_globex_d360', accountId: 'acc_globex', name: 'Globex · Data 360 Expansion', stage: 'Negotiation', amount: 1_200_000, closeDate: day(23), vdpLinked: true, hoursQtd: 22, nextStep: 'Revised SOW pricing to Marcus', owner: P.elena, forecastCategory: 'Commit', org62Url: org62Link('Opportunity', '006XXoppglobexdAAA'), myDc: dc(3, 100) }),
  opp({ id: 'opp_globex_renew', accountId: 'acc_globex', name: 'Globex · Renewal FY27', stage: 'Proposal', amount: 400_000, closeDate: day(71), isMine: false, dcAssigned: false, owner: P.elena, forecastCategory: 'Best Case' }),
  opp({ id: 'opp_initech_pilot', accountId: 'acc_initech', name: 'Initech · D360 Pilot', stage: 'Qualification', amount: 150_000, closeDate: day(45), hoursQtd: 6.5, forecastCategory: 'Pipeline', org62Url: org62Link('Opportunity', '006XXoppinitechAAA'), myDc: dc(4, 100) }),
  opp({ id: 'opp_umbrella_c360', accountId: 'acc_umbrella', name: 'Umbrella · Patient 360', stage: 'Technical Validation', amount: 640_000, closeDate: day(30), vdpLinked: true, hoursQtd: 15, forecastCategory: 'Best Case', myDc: dc(5, 50) }),
  opp({ id: 'opp_umbrella_af', accountId: 'acc_umbrella', name: 'Umbrella · Agentforce Care', stage: 'Discovery', amount: 280_000, closeDate: day(115), dcAssigned: false, hoursQtd: 4.25, products: ['Agentforce'] }),
  opp({ id: 'opp_hooli_nce', accountId: 'acc_hooli', name: 'Hooli · Nimbus Context Engine', stage: 'Solution Design', amount: 500_000, closeDate: day(66), hoursQtd: 12, products: ['Agentforce', 'Data 360'], forecastCategory: 'Pipeline' }),
  opp({ id: 'opp_hooli_data', accountId: 'acc_hooli', name: 'Hooli · Data Cloud Add-on', stage: 'Prospecting', amount: 90_000, closeDate: day(130), isMine: false, dcAssigned: false, forecastCategory: 'Pipeline' }),
  // D-69: one open 100%-DC opp each, so each needs a VDP company; closing after next quarter, so the Specialist
  // Forecast checks (this and next quarter) don't count them
  opp({ id: 'opp_globex_mc', accountId: 'acc_globex_mc', name: 'Globex MC · Data 360 Activation', stage: 'Discovery', amount: 210_000, closeDate: day(200), forecastCategory: 'Pipeline', org62Url: org62Link('Opportunity', '006XXoppglobmcdAAA'), myDc: dc(6, 100) }),
  opp({ id: 'opp_nexus', accountId: 'acc_nexus', name: 'Nexus Care · Member 360', stage: 'Qualification', amount: 180_000, closeDate: day(210), forecastCategory: 'Pipeline', org62Url: org62Link('Opportunity', '006XXoppnexuscdAAA'), myDc: dc(7, 100) }),
  opp({ id: 'opp_cyberdyne', accountId: 'acc_cyberdyne', name: 'Cyberdyne · Agentforce Ops', stage: 'Discovery', amount: 260_000, closeDate: day(220), products: ['Agentforce'], forecastCategory: 'Pipeline', org62Url: org62Link('Opportunity', '006XXoppcyberdyAAA'), myDc: dc(8, 100) }),
  opp({ id: 'opp_soylent', accountId: 'acc_soylent', name: 'Soylent · Data 360 Pilot', stage: 'Qualification', amount: 120_000, closeDate: day(230), forecastCategory: 'Pipeline', org62Url: org62Link('Opportunity', '006XXoppsoylentAAA'), myDc: dc(9, 100) }),
];

const missedOpps: In['missedOpps'] = [
  { id: 'mo_globex_renew', verdict: 'claim', oppId: 'opp_globex_renew', oppName: 'Globex · Renewal FY27', accountName: 'Globex', amount: 400_000, stage: 'Proposal', closeDate: day(71), evidence: ['Data 360 product line', 'Your account, no DC on this opp', 'You attended 2 meetings on it'], otherDcs: [], status: 'new', foundAt: t(0, '02:00') },
  { id: 'mo_hooli_data', verdict: 'claim', oppId: 'opp_hooli_data', oppName: 'Hooli · Data Cloud Add-on', accountName: 'Hooli', amount: 90_000, stage: 'Prospecting', closeDate: day(130), evidence: ['Data Cloud SKU', 'Your account', 'Slack channel you work in (#hooli-data-cloud, 4 messages)'], otherDcs: [], status: 'new', foundAt: t(0, '02:00') },
  { id: 'mo_initech_tab', verdict: 'check', oppId: null, oppName: 'Initech · Tableau Next', accountName: 'Initech', amount: 120_000, stage: 'Discovery', closeDate: day(90), evidence: ['Mentions Data 360 in next steps', 'Another SE holds a DC'], otherDcs: ['Kim Tran'], status: 'new', foundAt: t(0, '02:00') },
  { id: 'mo_umbrella_mc', verdict: 'check', oppId: null, oppName: 'Umbrella · Marketing Cloud D360 seats', accountName: 'Umbrella Health', amount: 60_000, stage: 'Prospecting', closeDate: day(150), evidence: ['D360 seats line item'], otherDcs: [], status: 'dismissed', dismissReason: 'Marketing SE owns it', foundAt: t(-7, '02:00') },
];

// ---------------------------------------------------------------------------
// assets / initiatives
// ---------------------------------------------------------------------------
const asset = (a: Partial<In['assets'][number]> & Pick<In['assets'][number], 'id' | 'kind' | 'title'>): In['assets'][number] => ({ source: 'drive', updatedAt: t(-1, '16:00'), updatedBy: me.name, url: `https://docs.example.com/${a.id}`, ...a });
const assets: In['assets'] = [
  asset({ id: 'as_acme_deck', kind: 'slides', title: 'ACME Phase 2 demo deck', initiativeId: 'ini_acme_p2', accountId: 'acc_acme' }),
  asset({ id: 'as_acme_onepager', kind: 'doc', title: 'ACME architecture one-pager', initiativeId: 'ini_acme_p2', accountId: 'acc_acme', updatedAt: t(-2, '11:00') }),
  asset({ id: 'as_acme_recap', kind: 'slides', title: 'ACME Phase 1 recap slides', initiativeId: 'ini_acme_p2', accountId: 'acc_acme', updatedAt: t(-1, '15:50') }),
  asset({ id: 'as_acme_org', kind: 'demo_org', title: 'acme-phase2 demo org', source: 'manual', url: 'https://acme-phase2.example.my.site.com', initiativeId: 'ini_acme_p2', accountId: 'acc_acme' }),
  asset({ id: 'as_globex_sow', kind: 'doc', title: 'Globex SOW v3 (pricing)', initiativeId: 'ini_globex', accountId: 'acc_globex', updatedBy: 'Elena Cruz' }),
  asset({ id: 'as_globex_est', kind: 'sheet', title: 'Globex D360 consumption estimate', initiativeId: 'ini_globex', accountId: 'acc_globex' }),
  asset({ id: 'as_umbrella_deck', kind: 'slides', title: 'Umbrella architecture review deck', accountId: 'acc_umbrella', updatedAt: t(-3, '10:00') }),
  asset({ id: 'as_hooli_plan', kind: 'doc', title: 'Hooli NCE evaluation plan', initiativeId: 'ini_hooli', accountId: 'acc_hooli', updatedAt: t(0, '08:40') }),
  asset({ id: 'as_hooli_refarch', kind: 'pdf', title: 'Hooli NCE reference architecture', initiativeId: 'ini_hooli', accountId: 'acc_hooli' }),
  asset({ id: 'as_nce_questions', kind: 'doc', title: 'NCE open questions (team)', updatedBy: 'Kim Tran' }),
  asset({ id: 'as_nce_session', kind: 'claude_session', title: 'NCE gaps notes', source: 'claude', url: 'claude://code/continue?session=mock-nce-gaps', updatedAt: t(-1, '12:30') }),
];

const initiatives: In['initiatives'] = [
  {
    id: 'ini_acme_p2',
    version: 1,
    title: 'ACME Headless Phase 2 demo',
    purpose: 'Win the Phase 2 technical decision: headless Data 360 + Agentforce on ACME’s own portal.',
    summary: 'Dana’s team wants to see agent answers grounded in their unified profiles, rendered in their React portal. Today’s 13:00 demo is the technical gate before Raj sends pricing.',
    status: 'active',
    accountId: 'acc_acme',
    oppId: 'opp_acme_p2',
    targetEventId: 'ev_acme_demo',
    people: [P.dana, P.raj],
    assetIds: ['as_acme_deck', 'as_acme_onepager', 'as_acme_recap', 'as_acme_org'],
    timeline: [
      { at: t(-3, '10:00'), label: 'Discovery workshop with Dana’s team', source: { kind: 'calendar', label: 'Calendar · ACME workshop' } },
      { at: t(-1, '16:00'), label: 'Phase 1 recap slides updated', source: { kind: 'drive', label: 'Drive · recap slides' } },
      { at: t(0, '07:55'), label: 'Dana asked to confirm demo scope', source: { kind: 'slack', label: '#acme-ext · thread' } },
    ],
    createdAt: t(-20, '09:00'),
    updatedAt: t(0, '07:55'),
  },
  {
    id: 'ini_globex',
    version: 1,
    title: 'Globex Data 360 expansion close',
    purpose: 'Close the $1.2M expansion this month: pricing, DPA and consumption estimate.',
    summary: 'Negotiation stage. Marcus needs revised SOW pricing and a consumption estimate; legal is reviewing the DPA.',
    status: 'active',
    accountId: 'acc_globex',
    oppId: 'opp_globex_d360',
    people: [P.marcus, P.elena],
    assetIds: ['as_globex_sow', 'as_globex_est'],
    timeline: [{ at: t(0, '08:30'), label: 'Missed the pricing sync (2 takeaways)', source: { kind: 'gemini', label: 'Gemini notes · pricing sync' } }],
    createdAt: t(-30, '09:00'),
    updatedAt: t(0, '08:35'),
  },
  {
    id: 'ini_hooli',
    version: 1,
    title: 'Hooli Nimbus Context Engine evaluation',
    purpose: 'Get Hooli to a scoped NCE evaluation with success criteria by end of month.',
    summary: 'Nora’s team is comparing NCE with a home-grown retrieval layer. They want a reference architecture and an evaluation plan.',
    status: 'active',
    accountId: 'acc_hooli',
    oppId: 'opp_hooli_nce',
    targetEventId: 'ev_hooli',
    people: [P.nora, P.leo],
    assetIds: ['as_hooli_plan', 'as_hooli_refarch'],
    createdAt: t(-10, '09:00'),
    updatedAt: t(0, '08:40'),
  },
];

// ---------------------------------------------------------------------------
// calendar
// ---------------------------------------------------------------------------
const cal = (e: Partial<In['calendar']['events'][number]> & Pick<In['calendar']['events'][number], 'id' | 'title' | 'start' | 'end'>): In['calendar']['events'][number] => ({
  attendance: 'upcoming',
  source: { kind: 'calendar', label: 'Google Calendar', externalId: e.id },
  ...e,
});
// Invite details (placeholders): who sent it, each guest's answer, the agenda as plain text, attached files.
const mine = { name: me.name, personId: null, isMe: true, isExternal: false };
const sentBy = (p: { id: string; name: string; isExternal?: boolean }) => ({ name: p.name, personId: p.id, isMe: false, isExternal: !!p.isExternal });
const events: In['calendar']['events'] = [
  // earlier this week (Time page)
  cal({ id: 'ev_mon_acme', title: 'ACME discovery workshop', start: t(-3, '10:00'), end: t(-3, '12:00'), attendance: 'attended', isCustomerFacing: true, accountId: 'acc_acme', oppId: 'opp_acme_p2' }),
  cal({ id: 'ev_tue_globex', title: 'Globex exec briefing', start: t(-2, '14:00'), end: t(-2, '15:00'), attendance: 'attended', isCustomerFacing: true, accountId: 'acc_globex', oppId: 'opp_globex_d360' }),
  cal({ id: 'ev_wed_umbrella', title: 'Umbrella technical deep dive', start: t(-1, '09:00'), end: t(-1, '10:30'), attendance: 'attended', isCustomerFacing: true, accountId: 'acc_umbrella', oppId: 'opp_umbrella_c360' }),
  cal({ id: 'ev_wed_hooli', title: 'Hooli onsite', start: t(-1, '13:00'), end: t(-1, '17:00'), attendance: 'attended', isCustomerFacing: true, accountId: 'acc_hooli', oppId: 'opp_hooli_nce', location: 'Hooli HQ' }),
  // today
  cal({ id: 'ev_standup', title: 'SE team stand-up', start: t(0, '08:00'), end: t(0, '08:30'), attendance: 'attended', attendees: [{ ...P.priya, response: 'accepted', organizer: true }, { ...P.kim, response: 'accepted', optional: true }], organizer: sentBy(P.priya), agenda: 'Round the room: yesterday, today, blockers.' }),
  cal({ id: 'ev_globex_pricing', title: 'Globex pricing sync', start: t(0, '08:30'), end: t(0, '09:00'), attendance: 'missed', isCustomerFacing: true, accountId: 'acc_globex', oppId: 'opp_globex_d360', attendees: [P.marcus, P.elena], takeaways: { count: 2, workItemIds: ['w_globex_discount', 'w_globex_estimate'], notesUrl: 'https://docs.example.com/gemini-globex-pricing' } }),
  cal({ id: 'ev_priya_1on1', title: '1:1 with Priya', start: t(0, '09:30'), end: t(0, '10:00'), attendees: [{ ...P.priya, response: 'accepted', organizer: true }], organizer: sentBy(P.priya), agenda: 'Q4 forecast notes\nTraining plan for next quarter', prep: { ready: true, label: 'prep ready ›', workItemId: 'w_priya_forecast' } }),
  cal({ id: 'ev_initech', title: 'Initech discovery call', start: t(0, '10:30'), end: t(0, '11:30'), isCustomerFacing: true, accountId: 'acc_initech', oppId: 'opp_initech_pilot', attendees: [{ ...P.peter, response: 'accepted' }], organizer: mine, agenda: 'Goals for the pilot\nCurrent data landscape and sources\nTimeline and decision process', meetingUrl: 'https://meet.example.com/initech', prep: { ready: false, label: 'prep: 20m ›', workItemId: 'w_initech_prep' } }),
  cal({ id: 'ev_lunch_nce', title: 'Lunch & learn: Nimbus Context Engine', start: t(0, '12:00'), end: t(0, '12:30'), attendees: [{ ...P.leo, response: 'accepted', organizer: true }], organizer: sentBy(P.leo), agenda: 'A 20-minute tour of the context engine, then Q&A. Slides: https://docs.example.com/nce-lunch-learn', meetingUrl: 'https://meet.example.com/nce-lunch' }),
  cal({
    id: 'ev_acme_demo',
    title: 'ACME Phase 2 demo',
    start: t(0, '13:00'),
    end: t(0, '14:00'),
    isCustomerFacing: true,
    accountId: 'acc_acme',
    oppId: 'opp_acme_p2',
    attendees: [{ ...P.dana, response: 'accepted', organizer: true }, { ...P.raj, response: 'tentative' }],
    organizer: sentBy(P.dana),
    agenda: 'Goal: the Phase 2 portal end to end, on ACME data\n• Headless portal walkthrough (15 min)\n• Service-agent handoff: Phase 3, scope only\n• Next steps and pilot timeline\n\nDemo script: https://docs.example.com/acme-demo-script',
    attachments: [{ title: 'ACME Phase 2 demo script', url: 'https://docs.example.com/acme-demo-script', kind: 'doc' }],
    meetingUrl: 'https://meet.example.com/acme',
    prep: { ready: false, label: 'demo org building ›', workItemId: 'w_acme_build' },
  }),
  cal({ id: 'ev_umbrella', title: 'Umbrella architecture review', start: t(0, '14:30'), end: t(0, '15:00'), isCustomerFacing: true, accountId: 'acc_umbrella', oppId: 'opp_umbrella_c360', attendees: [{ ...P.alice, response: 'needs_action' }], organizer: mine, agenda: 'Walk through the target architecture: FHIR ingestion and the HIPAA controls Alice asked about.', attachments: [{ title: 'Umbrella architecture review deck', url: 'https://docs.example.com/as_umbrella_deck', kind: 'deck' }], prep: { ready: false, label: 'deck needs updates ›', workItemId: 'w_umbrella_deck' } }),
  cal({ id: 'ev_hooli', title: 'Hooli NCE scoping', start: t(0, '15:30'), end: t(0, '16:00'), isCustomerFacing: true, accountId: 'acc_hooli', oppId: 'opp_hooli_nce', attendees: [{ ...P.nora, response: 'tentative', organizer: true }], organizer: sentBy(P.nora), agenda: 'Scope the NCE evaluation: success criteria, data sets, timeline.', prep: { ready: false, label: 'talk track ›', workItemId: 'w_hooli_talktrack' } }),
  cal({ id: 'ev_retro', title: 'SE team retro', start: t(0, '16:30'), end: t(0, '17:00'), attendance: 'declined', attendees: [P.priya] }),
  // D-64: an internal session (no customer, no account: internal-only activity), and a meeting I declined (never on Time)
  cal({ id: 'ev_mon_cert', title: 'Data Cloud certification study group', start: t(-3, '15:00'), end: t(-3, '16:00'), attendance: 'attended', attendees: [{ ...P.kim, response: 'accepted', organizer: true }], organizer: sentBy(P.kim) }),
  cal({ id: 'ev_tue_declined', title: 'Partner office hours', start: t(-2, '11:00'), end: t(-2, '12:00'), attendance: 'declined', attendees: [{ ...P.leo, response: 'accepted', organizer: true }], organizer: sentBy(P.leo) }),
  // tomorrow
  cal({ id: 'ev_fri_globex', title: 'Globex legal + DPA review', start: t(1, '10:00'), end: t(1, '11:00'), isCustomerFacing: true, accountId: 'acc_globex', oppId: 'opp_globex_d360' }),
];

const slots: In['calendar']['slots'] = [
  { id: 'sl_kickoff', kind: 'work', start: t(0, '09:05'), end: t(0, '09:25'), label: '09:05 ▶ Kick off ACME demo-org build', workItemId: 'w_acme_build' },
  { id: 'sl_gap_1000', kind: 'gap', start: t(0, '10:00'), end: t(0, '10:30'), label: '10:00 30m gap: fits Reply to Dana', workItemId: 'w_dana_reply' },
  { id: 'sl_gap_1130', kind: 'gap', start: t(0, '11:30'), end: t(0, '12:00'), label: '11:30 30m gap: fits Training', workItemId: 'w_training_af' },
  { id: 'sl_prep_1230', kind: 'work', start: t(0, '12:30'), end: t(0, '13:00'), label: '12:30 ▶ Final ACME demo run-through', workItemId: 'w_acme_build' },
  { id: 'sl_gap_1400', kind: 'gap', start: t(0, '14:00'), end: t(0, '14:30'), label: '14:00 30m gap', workItemId: null },
  { id: 'sl_focus_1700', kind: 'focus', start: t(0, '17:00'), end: t(0, '18:00'), label: '17:00 Focus: Globex SOW', workItemId: 'w_globex_sow' },
];

// ---------------------------------------------------------------------------
// work items
// ---------------------------------------------------------------------------
/** Dana's 07:55 ask in #acme-ext, as Slack stores it (mrkdwn): w_dana_reply's origin evidence and dr_dana's thread. */
const DANA_ASK = 'Are we still showing the *service-agent handoff* today? <@U0RAJ> said pricing might move, see <https://example.com/acme/phase-2|the Phase 2 plan> :eyes:\n• Agenda for 13:00\n• `demo-env` access for _the whole team_';

const src = {
  acmeExt: { kind: 'slack' as const, label: '#acme-ext · thread', url: 'https://example.slack.com/archives/C0ACME/p1', externalId: 'C0ACME:1730822100.0001' },
  globexMail: { kind: 'gmail' as const, label: 'Gmail · Marcus Webb', url: 'https://mail.example.com/#inbox/globex1' },
  gemini: { kind: 'gemini' as const, label: 'Gemini notes · Globex pricing sync', url: 'https://docs.example.com/gemini-globex-pricing' },
  priyaDm: { kind: 'slack' as const, label: 'DM · Priya Shah', url: 'https://example.slack.com/archives/D0PRIYA' },
  drive: (label: string) => ({ kind: 'drive' as const, label: `Drive · ${label}` }),
  cal: (label: string) => ({ kind: 'calendar' as const, label: `Calendar · ${label}` }),
  org62: (label: string) => ({ kind: 'org62' as const, label: `Org62 · ${label}` }),
  claude: (label: string) => ({ kind: 'claude' as const, label: `Claude · ${label}` }),
  vdp: { kind: 'vdp' as const, label: 'VDP · Globex D360 expansion' },
  trailhead: { kind: 'gmail' as const, label: 'Gmail · Field Readiness' },
  manual: { kind: 'manual' as const, label: 'Quick capture' },
  hooliExt: { kind: 'slack' as const, label: '#hooli-ext', url: 'https://example.slack.com/archives/C0HOOLI' },
};

const w = (x: Partial<WI> & Pick<WI, 'id' | 'kind' | 'state' | 'title' | 'why'>): WI => ({
  version: 1,
  purpose: null,
  initiativeId: null,
  accountId: null,
  oppId: null,
  confidence: 'likely',
  sources: [],
  effort: { youMin: 15, agentMin: 0 },
  startBy: null,
  due: null,
  createdAt: t(-1, '10:00'),
  updatedAt: t(0, '07:00'),
  ageDays: 1,
  rank: null,
  rankReasons: [],
  owner: { id: me.id, name: me.name },
  ...x,
});

const workItems: WI[] = [
  // ---- ACME Phase 2
  w({ id: 'w_acme_build', kind: 'task', state: 'in_progress', title: 'Kick off the ACME Phase 2 demo-org build', purpose: 'For: ACME Phase 2 demo today 13:00', initiativeId: 'ini_acme_p2', accountId: 'acc_acme', oppId: 'opp_acme_p2', servesEventId: 'ev_acme_demo', confidence: 'sure', why: 'The org build takes ~1h40m and the demo is at 13:00', whyDetail: 'Lead time beats effort: the agent needs ~100 minutes to load profiles and wire the headless portal, so it has to start before your 09:30 1:1.', sources: [src.cal('ACME Phase 2 demo'), src.claude('acme-phase2 build')], effort: { youMin: 10, agentMin: 100 }, startBy: t(0, '09:15'), due: t(0, '12:30'), ageDays: 2, signals: { customerFacing: true, fromManager: false, boost: 4 }, nbaId: 'nba_acme_build', runIds: ['run_acme_build'], assetIds: ['as_acme_org'], people: [P.dana, P.raj] }),
  w({ id: 'w_dana_reply', kind: 'ask', state: 'open', title: 'Reply to Dana: confirm today’s demo scope', purpose: 'For: ACME Phase 2 demo today 13:00', initiativeId: 'ini_acme_p2', accountId: 'acc_acme', oppId: 'opp_acme_p2', servesEventId: 'ev_acme_demo', why: 'Dana asked in #acme-ext; scope changed after Tuesday’s call', whyDetail: 'Dana asked at 07:55 whether the demo still covers the service-agent handoff. Tuesday’s call moved the handoff to Phase 3, so the scope needs confirming before 11:00.', sources: [src.acmeExt, src.cal('ACME workshop')], effort: { youMin: 5, agentMin: 0 }, due: t(0, '11:00'), createdAt: t(0, '07:55'), ageDays: 0, signals: { customerFacing: true, fromManager: false, boost: 3 }, nbaId: 'nba_dana', counterparty: P.dana, people: [P.dana], newEvidenceCount: 1 }),
  w({ id: 'w_acme_onepager', kind: 'commitment', state: 'open', title: 'Email ACME the architecture one-pager', purpose: 'Said by you in #acme-ext on Tuesday', initiativeId: 'ini_acme_p2', accountId: 'acc_acme', oppId: 'opp_acme_p2', why: 'You said "I’ll email the one-pager tomorrow" in #acme-ext', sources: [src.acmeExt, { kind: 'gmail', label: 'Gmail · draft to Dana' }], effort: { youMin: 5, agentMin: 0 }, due: t(0, '17:00'), createdAt: t(-2, '15:10'), ageDays: 2, signals: { customerFacing: true, fromManager: false, boost: 0 }, nbaId: 'nba_onepager', assetIds: ['as_acme_onepager'], counterparty: P.dana }),
  w({ id: 'w_acme_recap', kind: 'deliverable', state: 'done', title: 'Update the ACME Phase 1 recap slides', purpose: 'For: ACME Phase 2 demo (opening section)', initiativeId: 'ini_acme_p2', accountId: 'acc_acme', oppId: 'opp_acme_p2', confidence: 'sure', why: 'Raj asked for refreshed Phase 1 metrics', sources: [src.drive('Phase 1 recap slides'), { kind: 'slack', label: 'DM · Raj Mehta' }], effort: { youMin: 45, agentMin: 0 }, doneAt: t(-1, '16:05'), doneBy: 'user', closedReason: 'Marked done by you', resolution: 'done_by_me', resolutionDetail: { inferred: false }, createdAt: t(-4, '11:00'), ageDays: 4, assetIds: ['as_acme_recap'], deliverable: { assetId: 'as_acme_recap', fileName: 'ACME Phase 1 recap slides', mimeKind: 'slides', url: 'https://docs.example.com/as_acme_recap', lastEditedAt: t(-1, '15:50'), lastEditedBy: me.name, changedSinceCreated: true, diffSummary: 'Metrics slide and timeline updated', judgment: { verdict: 'complete', summary: 'Both requested updates made', requested: 2, made: 2 } } }),
  w({ id: 'w_acme_refresh', kind: 'task', state: 'reopened', title: 'Fix the ACME demo-data refresh job', purpose: 'For: ACME Phase 2 demo today 13:00', initiativeId: 'ini_acme_p2', accountId: 'acc_acme', why: 'Dana reported the nightly refresh failed again', sources: [src.acmeExt], effort: { youMin: 20, agentMin: 30 }, createdAt: t(-5, '10:00'), ageDays: 5, signals: { customerFacing: true, fromManager: false, boost: -2 }, reopened: { reason: 'Dana: the refresh failed again last night', at: t(0, '06:50'), from: src.acmeExt } }),
  // ---- Globex
  w({ id: 'w_globex_sow', kind: 'ask', state: 'open', title: 'Send Marcus the revised SOW pricing', purpose: 'For: Globex D360 expansion close (Negotiation)', initiativeId: 'ini_globex', accountId: 'acc_globex', oppId: 'opp_globex_d360', why: 'Marcus asked by email; pricing was the main topic of the sync you missed', sources: [src.globexMail, src.gemini], effort: { youMin: 15, agentMin: 0 }, due: t(0, '17:00'), createdAt: t(0, '08:45'), ageDays: 0, signals: { customerFacing: true, fromManager: false, boost: 2 }, nbaId: 'nba_globex_sow', counterparty: P.marcus, people: [P.marcus, P.elena], assetIds: ['as_globex_sow'] }),
  w({ id: 'w_globex_discount', kind: 'follow_up', state: 'suggested', title: 'Confirm the discount approval path with Elena', purpose: 'Takeaway from the Globex pricing sync (missed)', initiativeId: 'ini_globex', accountId: 'acc_globex', oppId: 'opp_globex_d360', servesEventId: 'ev_globex_pricing', confidence: 'likely', why: 'Gemini notes: "Jordan to confirm who approves the 18% discount"', sources: [src.gemini], effort: { youMin: 10, agentMin: 0 }, createdAt: t(0, '09:00'), ageDays: 0, signals: { customerFacing: false, fromManager: false, boost: 0 } }),
  w({ id: 'w_globex_estimate', kind: 'follow_up', state: 'open', title: 'Share the D360 consumption estimate with Globex', purpose: 'Takeaway from the Globex pricing sync (missed)', initiativeId: 'ini_globex', accountId: 'acc_globex', oppId: 'opp_globex_d360', confidence: 'likely', why: 'Gemini notes: "Jordan to send consumption estimate by Friday"', sources: [src.gemini, src.drive('consumption estimate')], effort: { youMin: 10, agentMin: 15 }, due: t(1, '12:00'), createdAt: t(0, '09:00'), ageDays: 0, signals: { customerFacing: true, fromManager: false, boost: 0 }, nbaId: 'nba_globex_estimate', assetIds: ['as_globex_est'] }),
  w({ id: 'w_globex_legal', kind: 'task', state: 'waiting_on_others', title: 'Globex legal review of the DPA', purpose: 'For: Globex D360 expansion close', initiativeId: 'ini_globex', accountId: 'acc_globex', oppId: 'opp_globex_d360', why: 'You sent the DPA redlines; Marcus is chasing legal', sources: [src.globexMail], effort: { youMin: 5, agentMin: 0 }, createdAt: t(-6, '11:00'), ageDays: 6, waiting: { on: 'others', reason: 'Waiting on Marcus (Globex legal)', who: P.marcus, since: t(-6, '11:00') }, nbaId: 'nba_globex_nudge', counterparty: P.marcus }),
  w({ id: 'w_vdp_globex', kind: 'task', state: 'open', title: 'Update the VDP for the Globex expansion', purpose: 'Keep the value plan current before the close', initiativeId: 'ini_globex', accountId: 'acc_globex', oppId: 'opp_globex_d360', why: 'VDP last updated 3 weeks ago; stage moved to Negotiation', sources: [src.vdp, src.org62('Globex · Data 360 Expansion')], effort: { youMin: 20, agentMin: 10 }, due: t(2, '17:00'), createdAt: t(-3, '09:00'), ageDays: 3, stale: { connectorId: 'vdp', reason: 'VDP needs re-auth: the value plan may be out of date', since: t(0, '07:12') } }),
  w({ id: 'w_travel_globex', kind: 'travel', state: 'open', title: 'Book travel for the Globex onsite (Nov 18)', purpose: 'For: Globex executive onsite', accountId: 'acc_globex', why: 'Elena confirmed the onsite date', sources: [{ kind: 'slack', label: 'DM · Elena Cruz' }], effort: { youMin: 20, agentMin: 0 }, due: t(5, '17:00'), createdAt: t(-1, '14:00'), signals: { customerFacing: false, fromManager: false, boost: -1 } }),
  // ---- Initech
  w({ id: 'w_initech_prep', kind: 'task', state: 'open', title: 'Prep Initech discovery questions', purpose: 'For: Initech discovery call today 10:30', accountId: 'acc_initech', oppId: 'opp_initech_pilot', servesEventId: 'ev_initech', why: 'First discovery call; no questions drafted yet', sources: [src.cal('Initech discovery call')], effort: { youMin: 20, agentMin: 5 }, startBy: t(0, '10:05'), createdAt: t(-2, '09:00'), ageDays: 2, signals: { customerFacing: true, fromManager: false, boost: 0 }, nbaId: 'nba_initech_prep' }),
  w({ id: 'w_initech_inventory', kind: 'ask', state: 'waiting_on_others', title: 'Initech data-source inventory', purpose: 'For: Initech D360 pilot scoping', accountId: 'acc_initech', oppId: 'opp_initech_pilot', why: 'Peter promised the inventory after the intro call', sources: [{ kind: 'gmail', label: 'Gmail · Peter Gibbons' }], createdAt: t(-3, '15:00'), ageDays: 3, waiting: { on: 'others', reason: 'Waiting on Peter for the inventory', who: P.peter, since: t(-3, '15:00') }, counterparty: P.peter }),
  w({ id: 'w_initech_rfp', kind: 'task', state: 'snoozed', title: 'Review the Initech RFP draft', purpose: 'For: Initech D360 pilot', accountId: 'acc_initech', oppId: 'opp_initech_pilot', why: 'Procurement shared a draft RFP', sources: [{ kind: 'gmail', label: 'Gmail · Initech procurement' }], effort: { youMin: 45, agentMin: 0 }, createdAt: t(-2, '10:00'), ageDays: 2, snoozedUntil: t(1, '09:00'), snoozedFrom: 'open' }),
  // ---- Umbrella
  w({ id: 'w_umbrella_deck', kind: 'deliverable', state: 'open', title: 'Update the Umbrella architecture review deck', purpose: 'For: Umbrella architecture review today 14:30', accountId: 'acc_umbrella', oppId: 'opp_umbrella_c360', servesEventId: 'ev_umbrella', why: 'Alice asked for the FHIR ingestion slide and HIPAA controls', sources: [src.drive('Umbrella architecture review deck'), { kind: 'gmail', label: 'Gmail · Alice Abernathy' }], effort: { youMin: 40, agentMin: 0 }, startBy: t(0, '13:50'), createdAt: t(-1, '11:00'), signals: { customerFacing: true, fromManager: false, boost: 0 }, nbaId: 'nba_umbrella_deck', assetIds: ['as_umbrella_deck'], deliverable: { assetId: 'as_umbrella_deck', fileName: 'Umbrella architecture review deck', mimeKind: 'slides', url: 'https://docs.example.com/as_umbrella_deck', lastEditedAt: t(-3, '10:00'), lastEditedBy: me.name, changedSinceCreated: false, diffSummary: null, judgment: { verdict: 'not_started', summary: '0 of 2 requested updates made', requested: 2, made: 0 } } }),
  w({ id: 'w_umbrella_dataset', kind: 'task', state: 'waiting_on_me', title: 'Build the Umbrella Patient 360 demo dataset', purpose: 'For: Umbrella technical validation', accountId: 'acc_umbrella', oppId: 'opp_umbrella_c360', why: 'The dataset run is paused on a question for you', sources: [src.claude('dataset build')], effort: { youMin: 5, agentMin: 40 }, createdAt: t(-1, '10:40'), signals: { customerFacing: true, fromManager: false, boost: 0 }, waiting: { on: 'me', reason: 'Run asked: synthetic data or the sample CSV?', since: t(0, '08:20'), runId: 'run_umbrella_data' }, runIds: ['run_umbrella_data'], nbaId: 'nba_umbrella_data' }),
  w({ id: 'w_umbrella_hipaa', kind: 'commitment', state: 'done', title: 'Send Umbrella the HIPAA FAQ link', purpose: 'Said by you in the deep dive', accountId: 'acc_umbrella', oppId: 'opp_umbrella_c360', confidence: 'sure', why: 'You promised the FAQ link during Wednesday’s deep dive', sources: [{ kind: 'gmail', label: 'Gmail · sent to Alice' }], doneAt: t(0, '07:40'), doneBy: 'engine', closedReason: 'You sent it by email at 07:38', resolution: 'done_by_me', resolutionDetail: { inferred: true, evidenceIds: ['ev_hipaa_sent'] }, createdAt: t(-1, '10:20'), counterparty: P.alice }),
  w({ id: 'w_umbrella_fhir', kind: 'ask', state: 'suggested', title: 'Look into Umbrella’s FHIR connector question', purpose: null, accountId: 'acc_umbrella', confidence: 'guess', why: 'Alice mentioned FHIR R4 in a thread you were cc’d on', sources: [{ kind: 'gmail', label: 'Gmail · cc thread' }], createdAt: t(0, '06:30'), ageDays: 0 }),
  // ---- Hooli
  w({ id: 'w_hooli_talktrack', kind: 'task', state: 'open', title: 'Generate the talk track for Hooli NCE scoping', purpose: 'For: Hooli NCE scoping today 15:30', initiativeId: 'ini_hooli', accountId: 'acc_hooli', oppId: 'opp_hooli_nce', servesEventId: 'ev_hooli', why: 'Scoping call with Nora; the talk-track tool can draft it from the eval plan', sources: [src.cal('Hooli NCE scoping'), src.drive('Hooli NCE evaluation plan')], effort: { youMin: 10, agentMin: 20 }, startBy: t(0, '14:00'), createdAt: t(-1, '17:30'), signals: { customerFacing: true, fromManager: false, boost: 0 }, nbaId: 'nba_hooli_talktrack' }),
  w({ id: 'w_hooli_plan', kind: 'deliverable', state: 'in_progress', title: 'Draft the Hooli NCE evaluation plan', purpose: 'For: Hooli NCE evaluation', initiativeId: 'ini_hooli', accountId: 'acc_hooli', oppId: 'opp_hooli_nce', why: 'You started the doc this morning (Drive edits)', sources: [src.drive('Hooli NCE evaluation plan')], effort: { youMin: 60, agentMin: 0 }, due: t(2, '17:00'), createdAt: t(-1, '17:00'), signals: { customerFacing: true, fromManager: false, boost: -1 }, assetIds: ['as_hooli_plan'], deliverable: { assetId: 'as_hooli_plan', fileName: 'Hooli NCE evaluation plan', mimeKind: 'doc', url: 'https://docs.example.com/as_hooli_plan', lastEditedAt: t(0, '08:40'), lastEditedBy: me.name, changedSinceCreated: true, diffSummary: 'Added success criteria; timeline section empty', judgment: { verdict: 'partial', summary: '2 of 3 requested sections drafted', requested: 3, made: 2 } } }),
  w({ id: 'w_hooli_refarch', kind: 'task', state: 'likely_done', title: 'Send Hooli the NCE reference architecture', purpose: 'For: Hooli NCE evaluation', initiativeId: 'ini_hooli', accountId: 'acc_hooli', oppId: 'opp_hooli_nce', why: 'Nora asked for it at the onsite', sources: [src.hooliExt], effort: { youMin: 5, agentMin: 0 }, createdAt: t(-1, '16:30'), likelyDone: { reason: 'Found the PDF shared in #hooli-ext at 08:12', evidenceId: 'ev_hooli_refarch_done' }, assetIds: ['as_hooli_refarch'] }),
  w({ id: 'w_hooli_pricing', kind: 'commitment', state: 'suggested', title: 'Send Hooli the pricing calculator', purpose: null, accountId: 'acc_hooli', confidence: 'guess', why: 'Possible promise at the onsite ("we can share a calculator")', sources: [{ kind: 'gemini', label: 'Gemini notes · Hooli onsite' }], createdAt: t(-1, '17:10') }),
  // ---- internal / manager / trainings
  w({ id: 'w_priya_forecast', kind: 'ask', state: 'open', title: 'Send Priya the Q4 forecast notes', purpose: 'For: 1:1 with Priya at 09:30', servesEventId: 'ev_priya_1on1', confidence: 'sure', why: 'Priya asked for notes before your 1:1', sources: [src.priyaDm], effort: { youMin: 10, agentMin: 0 }, due: t(0, '09:30'), createdAt: t(-1, '18:10'), signals: { customerFacing: false, fromManager: true, boost: 0 }, nbaId: 'nba_priya', counterparty: P.priya, userLockedFields: ['title', 'due'] }),
  w({ id: 'w_training_af', kind: 'training', state: 'open', title: 'Complete the Agentforce Specialist refresher', purpose: 'Required: Field Readiness Q4', confidence: 'sure', why: 'Overdue since Monday; 25 minutes', sources: [src.trailhead], effort: { youMin: 25, agentMin: 0 }, due: t(-3, '17:00'), createdAt: t(-20, '09:00'), ageDays: 20, training: { course: 'Agentforce Specialist refresher', provider: 'Trailhead', minutes: 25, dueDate: day(-3), overdue: true, url: 'https://trailhead.example.com/af-refresher' } }),
  w({ id: 'w_training_sec', kind: 'training', state: 'open', title: 'Annual security & privacy training', purpose: 'Required: CLO compliance', confidence: 'sure', why: 'Due Monday; 30 minutes', sources: [{ kind: 'gmail', label: 'Gmail · CLO compliance' }], effort: { youMin: 30, agentMin: 0 }, due: t(4, '17:00'), createdAt: t(-14, '09:00'), ageDays: 14, training: { course: 'Annual security & privacy', provider: 'CLO', minutes: 30, dueDate: day(4), overdue: false } }),
  w({ id: 'w_nce_capture', kind: 'task', state: 'open', title: 'Talk to product about NCE gaps + the team’s open questions', purpose: 'Captured after yesterday’s onsite', confidence: 'sure', why: 'Captured by you', sources: [src.manual], effort: { youMin: 15, agentMin: 0 }, createdAt: t(-1, '17:45'), ageDays: 1, signals: { customerFacing: false, fromManager: false, boost: 0 }, userLockedFields: ['title'], nbaId: 'nba_nce', people: [P.leo], enrichment: { status: 'done', startedAt: t(-1, '17:45'), chips: [
    { id: 'chip_1', kind: 'claude_session', label: 'Claude session ‘NCE gaps notes’ (Nov 4)', reason: 'Mentions "NCE gaps"', ref: { type: 'asset', id: 'as_nce_session', label: 'NCE gaps notes' }, url: 'claude://code/continue?session=mock-nce-gaps', status: 'accepted' },
    { id: 'chip_2', kind: 'asset', label: 'Doc ‘NCE open questions (team)’ (Drive)', reason: 'Title matches "open questions"', ref: { type: 'asset', id: 'as_nce_questions', label: 'NCE open questions (team)' }, status: 'suggested' },
    { id: 'chip_3', kind: 'slack_thread', label: 'Slack thread in #se-team', reason: 'Kim asked about NCE limits', status: 'suggested' },
  ] }, assetIds: ['as_nce_session', 'as_nce_questions'] }),
  w({ id: 'w_log_hooli', kind: 'task', state: 'open', title: 'Log yesterday’s Hooli onsite (4h) in Org62', purpose: 'Q4 activity log', accountId: 'acc_hooli', oppId: 'opp_hooli_nce', why: 'Onsite on your calendar; no Org62 event yet', sources: [src.cal('Hooli onsite'), src.org62('activity')], effort: { youMin: 3, agentMin: 0 }, due: t(1, '12:00'), createdAt: t(-1, '17:05'), nbaId: 'nba_log_hooli' }),
  w({ id: 'w_acme_sso', kind: 'ask', state: 'done', title: 'Answer Dana’s SSO question', purpose: 'For: ACME Phase 2', initiativeId: 'ini_acme_p2', accountId: 'acc_acme', why: 'Dana asked whether the portal supports their IdP', sources: [src.acmeExt], doneAt: t(0, '08:15'), doneBy: 'engine', closedReason: 'You answered in #acme-ext at 08:14', resolution: 'done_by_me', resolutionDetail: { inferred: true, evidenceIds: ['ev_sso_answered'] }, createdAt: t(-1, '09:30'), counterparty: P.dana }),
  // ---- R-UI-22: resolutions, hand-offs, loop-back
  w({ id: 'w_acme_ssodoc', kind: 'task', state: 'done', title: 'Send ACME the SSO setup doc', purpose: 'For: ACME Phase 2', initiativeId: 'ini_acme_p2', accountId: 'acc_acme', why: 'Dana’s admin needs the IdP steps', sources: [src.acmeExt], doneAt: t(0, '08:25'), doneBy: 'engine', closedReason: 'Raj posted the doc in #acme-ext at 08:22', resolution: 'done_by_other', resolutionDetail: { personId: 'p_raj', personName: 'Raj Mehta', inferred: true, evidenceIds: ['ev_ssodoc_raj'] }, createdAt: t(-1, '09:40'), counterparty: P.dana }),
  w({ id: 'w_initech_security', kind: 'ask', state: 'done', title: 'Fill in the Initech security questionnaire', purpose: 'For: Initech D360 pilot', accountId: 'acc_initech', oppId: 'opp_initech_pilot', why: 'Procurement sent a 60-question security form', sources: [{ kind: 'gmail', label: 'Gmail · Initech procurement' }], effort: { youMin: 90, agentMin: 0 }, doneAt: t(-1, '11:00'), doneBy: 'user', closedReason: 'Handed off → Kim Tran', resolution: 'handed_off', resolutionDetail: { personId: 'p_kim', personName: 'Kim Tran', note: 'Kim owns security reviews this quarter', inferred: false }, involvement: 'watcher', owner: { id: 'p_kim', name: 'Kim Tran' }, createdAt: t(-3, '10:00'), ageDays: 3, counterparty: P.peter }),
  w({ id: 'w_umbrella_dq', kind: 'task', state: 'done', title: 'Run the Umbrella data-quality check', purpose: 'For: Umbrella technical validation', accountId: 'acc_umbrella', oppId: 'opp_umbrella_c360', why: 'Alice asked for a profile-completeness check', sources: [{ kind: 'gmail', label: 'Gmail · Alice Abernathy' }], effort: { youMin: 30, agentMin: 30 }, doneAt: t(-2, '15:00'), doneBy: 'user', closedReason: 'Handed off → Ravi Menon', resolution: 'handed_off', resolutionDetail: { personId: 'p_ravi', personName: 'Ravi Menon', inferred: false }, involvement: 'not_involved', owner: { id: 'p_ravi', name: 'Ravi Menon' }, createdAt: t(-4, '10:00'), ageDays: 4 }),
  w({ id: 'w_acme_ratelimit', kind: 'ask', state: 'reopened', title: 'Answer ACME’s API rate-limit question', purpose: 'For: ACME Phase 2 demo', initiativeId: 'ini_acme_p2', accountId: 'acc_acme', oppId: 'opp_acme_p2', why: 'Dana asked you directly in #acme-ext', sources: [src.acmeExt], effort: { youMin: 10, agentMin: 0 }, createdAt: t(-2, '10:00'), ageDays: 2, signals: { customerFacing: true, fromManager: false, boost: -1 }, involvement: 'owner', loopedBackIn: { at: t(0, '08:05'), byPersonName: 'Dana Reyes', evidenceId: 'ev_ratelimit_ask' }, reopened: { reason: 'Looped back in: Dana Reyes asked you directly', at: t(0, '08:05'), from: src.acmeExt }, counterparty: P.dana, newEvidenceCount: 1 }),
  w({ id: 'w_random', kind: 'ask', state: 'dismissed', title: 'Join #random-announcements', why: 'Bot invite', sources: [{ kind: 'slack', label: 'Slackbot' }], dismissed: { reason: 'not_mine', at: t(-1, '12:00') }, resolution: 'declined', resolutionDetail: { inferred: false, note: 'Not mine' }, involvement: 'not_involved' }),
  // ---- background promises
  w({ id: 'w_promise_beacon', kind: 'commitment', state: 'open', isBackground: true, title: 'Package the Beacon app for Ravi', purpose: 'Promised to Ravi in August', why: 'You said you would package it up "in the next few weeks"', sources: [{ kind: 'slack', label: 'DM · Ravi Menon' }], effort: { youMin: 15, agentMin: 90 }, createdAt: t(-70, '11:00'), ageDays: 70, nbaId: 'nba_beacon', counterparty: P.ravi }),
  w({ id: 'w_promise_nce', kind: 'commitment', state: 'open', isBackground: true, title: 'Write up the NCE gaps for the product team', purpose: 'Promised to Leo in October', why: 'You offered a written summary after the NCE roadmap call', sources: [{ kind: 'slack', label: 'DM · Leo Park' }], effort: { youMin: 30, agentMin: 30 }, createdAt: t(-34, '11:00'), ageDays: 34, counterparty: P.leo }),
  w({ id: 'w_promise_reset', kind: 'commitment', state: 'open', isBackground: true, title: 'Share the demo-org reset script with the SE team', purpose: 'Promised in #se-team', why: 'Kim asked; you said "I’ll clean it up and share"', sources: [{ kind: 'slack', label: '#se-team' }], effort: { youMin: 20, agentMin: 20 }, createdAt: t(-21, '11:00'), ageDays: 21, counterparty: P.kim }),
];

// ---------------------------------------------------------------------------
// evidence
// ---------------------------------------------------------------------------
let evN = 0;
const ev = (workItemId: string, role: In['evidence'][number]['role'], source: In['evidence'][number]['source'], at: string, summary: string, extra: Partial<In['evidence'][number]> = {}): In['evidence'][number] => ({ id: `ev_${++evN}`, workItemId, role, source, at, summary, ...extra });
const evidence: In['evidence'] = [
  ev('w_acme_build', 'origin', src.cal('ACME Phase 2 demo'), t(-2, '09:00'), 'Demo scheduled; needs a Phase 2 org'),
  ev('w_acme_build', 'progress', src.claude('acme-phase2 build'), t(0, '08:55'), 'Session started loading 5k unified profiles'),
  ev('w_dana_reply', 'origin', src.acmeExt, t(0, '07:55'), 'Dana: "Are we still showing the service-agent handoff today?"', { author: 'Dana Reyes', isNew: true, snippet: DANA_ASK }),
  ev('w_dana_reply', 'context', src.cal('ACME workshop'), t(-2, '16:00'), 'Tuesday call moved the handoff to Phase 3'),
  ev('w_acme_onepager', 'origin', src.acmeExt, t(-2, '15:10'), 'You: "I’ll email the one-pager tomorrow"', { author: me.name }),
  ev('w_acme_recap', 'completion', src.drive('Phase 1 recap slides'), t(-1, '15:50'), 'Metrics slide and timeline updated'),
  ev('w_acme_refresh', 'contradiction', src.acmeExt, t(0, '06:50'), 'Dana: refresh failed again last night', { isNew: true }),
  ev('w_globex_sow', 'origin', src.globexMail, t(0, '08:45'), 'Marcus: "Can you send the revised pricing today?"', { author: 'Marcus Webb' }),
  ev('w_globex_sow', 'context', src.gemini, t(0, '09:00'), 'Pricing sync notes: 18% discount pending approval'),
  ev('w_globex_discount', 'origin', src.gemini, t(0, '09:00'), 'Action item assigned to you in the notes'),
  ev('w_globex_estimate', 'origin', src.gemini, t(0, '09:00'), 'Action item: send consumption estimate by Friday'),
  ev('w_globex_legal', 'progress', src.globexMail, t(-6, '11:00'), 'You sent DPA redlines to Marcus', { author: me.name, snippet: 'Hi Marcus,\n\nAttached are our DPA redlines. The main open point is the data-retention clause in section 4; the rest are wording fixes.\n\nCould legal confirm by Friday?\n\nThanks,\nJordan' }),
  ev('w_vdp_globex', 'context', src.org62('Globex · Data 360 Expansion'), t(-1, '17:00'), 'Stage moved to Negotiation'),
  ev('w_initech_prep', 'origin', src.cal('Initech discovery call'), t(-2, '09:00'), 'Discovery call booked by Peter'),
  ev('w_umbrella_deck', 'origin', { kind: 'gmail', label: 'Gmail · Alice Abernathy' }, t(-1, '11:00'), 'Alice: add the FHIR ingestion slide and HIPAA controls'),
  ev('w_umbrella_dataset', 'progress', src.claude('dataset build'), t(0, '08:20'), 'Run paused: synthetic data or the sample CSV?'),
  ev('w_hooli_plan', 'progress', src.drive('Hooli NCE evaluation plan'), t(0, '08:40'), 'Added success criteria section'),
  { id: 'ev_hooli_refarch_done', workItemId: 'w_hooli_refarch', role: 'completion', source: src.hooliExt, at: t(0, '08:12'), summary: 'Reference architecture PDF shared in #hooli-ext', confidence: 'likely', isNew: true },
  ev('w_priya_forecast', 'origin', src.priyaDm, t(-1, '18:10'), 'Priya: "Can you send forecast notes before our 1:1?"', { author: 'Priya Shah' }),
  { id: 'ev_sso_answered', workItemId: 'w_acme_sso', role: 'completion', source: src.acmeExt, at: t(0, '08:14'), summary: 'You answered Dana in #acme-ext' },
  { id: 'ev_hipaa_sent', workItemId: 'w_umbrella_hipaa', role: 'completion', source: { kind: 'gmail', label: 'Gmail · sent to Alice' }, at: t(0, '07:38'), summary: 'You sent the HIPAA FAQ link' },
  { id: 'ev_ssodoc_raj', workItemId: 'w_acme_ssodoc', role: 'completion', source: src.acmeExt, at: t(0, '08:22'), summary: 'Raj posted the SSO setup doc', author: 'Raj Mehta' },
  { id: 'ev_ratelimit_ask', workItemId: 'w_acme_ratelimit', role: 'origin', source: src.acmeExt, at: t(0, '08:05'), summary: 'Dana: "@Jordan can you confirm the API rate limits?"', author: 'Dana Reyes', isNew: true },
  ev('w_acme_ratelimit', 'context', src.acmeExt, t(-2, '10:30'), 'Handed off → Kim Tran'),
  ev('w_initech_security', 'progress', { kind: 'slack', label: 'DM · Kim Tran' }, t(-1, '11:00'), 'Kim took over the questionnaire'),
  ev('w_promise_beacon', 'origin', { kind: 'slack', label: 'DM · Ravi Menon' }, t(-70, '11:00'), 'You: "I’ll package it up in the next few weeks"'),
  ev('w_nce_capture', 'origin', src.manual, t(-1, '17:45'), 'Captured by you'),
  ev('w_log_hooli', 'origin', src.cal('Hooli onsite'), t(-1, '17:05'), 'Onsite ended; no activity logged'),
];

// ---------------------------------------------------------------------------
// drafts + NBAs
// ---------------------------------------------------------------------------
const slackDest = (channelId: string, channelName: string, target: 'thread' | 'channel' | 'dm' = 'thread', threadTs: string | null = null) => ({ kind: 'slack' as const, target, channelId, channelName, threadTs });
const emailDest = (to: { name: string; email: string }[], subject: string, target: 'reply' | 'reply_all' | 'new' = 'reply', cc: { name: string; email: string }[] = []) => ({ kind: 'email' as const, target, to, cc, subject, threadId: target === 'new' ? null : 'thr_example', inReplyTo: null });

const draft = (d: Omit<DraftIn, 'doc' | 'plainText' | 'rendered' | 'createdAt' | 'updatedAt' | 'version' | 'mode' | 'userTouched'> & { text: string; version?: number; mode?: 'draft' | 'send'; userTouched?: boolean; createdAt?: string; updatedAt?: string }): DraftIn => {
  const { text, ...rest } = d;
  const doc = docFromText(text);
  return {
    version: 1,
    mode: 'draft',
    userTouched: false,
    createdAt: t(0, '08:00'),
    updatedAt: t(0, '08:00'),
    ...rest,
    doc,
    plainText: plainText(doc),
    rendered: renderAll(Destination.parse(rest.destination), doc),
  };
};

const drafts: DraftIn[] = [
  draft({ id: 'dr_dana', workItemId: 'w_dana_reply', nbaId: 'nba_dana', destination: slackDest('C0ACME', '#acme-ext', 'thread', '1730822100.0001'), status: 'drafting', text: 'Hi Dana, confirmed for today at 13:00. Scope:\n- Unified profiles grounding the agent answers\n- Headless rendering in your React portal\n- Service-agent handoff moves to Phase 3, as agreed on Tuesday\n\nRaj will follow up with pricing after the demo.', threadContext: [
    { id: 'tm1', author: P.dana, at: t(-2, '16:30'), text: 'Thanks both. Let’s keep *Phase 2* focused.' },
    { id: 'tm2', author: { id: me.id, name: me.name }, at: t(-2, '16:40'), text: 'Agreed. I’ll send the one-pager tomorrow.', isMe: true },
    // Slack mrkdwn, as Slack sends it: the Outbox's "Replying to" renders it rich (mention by name, link, list, code)
    { id: 'tm3', author: P.dana, at: t(0, '07:55'), text: DANA_ASK },
  ] }),
  draft({ id: 'dr_globex_sow', workItemId: 'w_globex_sow', nbaId: 'nba_globex_sow', destination: emailDest([{ name: 'Marcus Webb', email: 'marcus.webb@globex.example' }], 'Re: Revised SOW pricing', 'reply_all', [{ name: 'Elena Cruz', email: 'elena.cruz@example.com' }]), status: 'drafting', userTouched: true, version: 3, updatedAt: t(0, '08:58'), savedAt: t(0, '08:58'), userLockedFields: ['doc'], text: 'Hi Marcus,\n\nAttached is the revised SOW with the updated Data 360 pricing. The main change is the consumption tier, which now matches the volumes from your team’s estimate.\n\nElena will confirm the discount approval today.\n\nBest,\nJordan' }),
  draft({ id: 'dr_onepager', workItemId: 'w_acme_onepager', nbaId: 'nba_onepager', destination: emailDest([{ name: 'Dana Reyes', email: 'dana.reyes@acme.example' }], 'ACME Phase 2: architecture one-pager', 'new'), status: 'drafting', text: 'Hi Dana,\n\nAs promised, here is the Phase 2 architecture one-pager. It covers the headless data flow and where the agent grounding happens.\n\nSee you at 13:00.\n\nJordan' }),
  draft({ id: 'dr_priya', workItemId: 'w_priya_forecast', nbaId: 'nba_priya', destination: slackDest('D0PRIYA', '@Priya Shah', 'dm'), status: 'drafting', userTouched: true, version: 2, savedAt: t(0, '08:50'), userLockedFields: ['doc'], text: 'Q4 forecast notes for our 1:1:\n- Globex D360 expansion: commit, pricing out today\n- ACME Phase 2: best case, demo at 13:00\n- Umbrella Patient 360: technical validation this week' }),
  draft({ id: 'dr_nce', workItemId: 'w_nce_capture', nbaId: 'nba_nce', destination: slackDest('U0LEO', '@Leo Park', 'dm'), status: 'drafting', text: 'Hi Leo, after yesterday’s Hooli onsite I have a list of NCE gaps plus the team’s open questions (doc linked). Do you have 20 minutes this week to go through them?' }),
  // Outbox groups
  draft({ id: 'dr_nudge_globex', workItemId: 'w_globex_legal', nbaId: 'nba_globex_nudge', destination: emailDest([{ name: 'Marcus Webb', email: 'marcus.webb@globex.example' }], 'Re: DPA redlines', 'reply'), status: 'ready', createdAt: t(0, '07:30'), updatedAt: t(0, '07:30'), text: 'Hi Marcus, checking in on the DPA review. Is there anything legal needs from us to wrap it up this week?\n\nThanks,\nJordan' }),
  draft({ id: 'dr_chat_initech', workItemId: 'w_initech_inventory', nbaId: null, destination: slackDest('C0INITECH', '#initech-ext', 'channel'), status: 'ready', createdAt: t(0, '08:05'), updatedAt: t(0, '08:05'), text: 'Hi Peter, a quick reminder about the data-source inventory. A rough list is fine for today’s call.' }),
  draft({ id: 'dr_sched_hooli', workItemId: 'w_hooli_plan', nbaId: null, destination: slackDest('C0HOOLI', '#hooli-ext', 'channel'), status: 'scheduled', scheduledFor: t(0, '16:30'), createdAt: t(0, '08:30'), updatedAt: t(0, '08:30'), text: 'Thanks for the time today, Nora. I’ll share the evaluation plan by Monday.' }),
  draft({ id: 'dr_sent_umbrella', workItemId: 'w_umbrella_hipaa', nbaId: null, destination: emailDest([{ name: 'Alice Abernathy', email: 'alice@umbrella.example' }], 'HIPAA FAQ', 'new'), status: 'verified', mode: 'send', createdAt: t(0, '07:30'), updatedAt: t(0, '07:39'), attempts: [{ id: 'att_1', at: t(0, '07:38'), mode: 'send', dryRun: false, outcome: 'sent' }], verification: { state: 'verified', at: t(0, '07:39'), detail: 'Verified in Gmail ✓' }, text: 'Hi Alice, here is the HIPAA FAQ link we discussed: https://example.com/hipaa-faq' }),
  draft({ id: 'dr_sent_sso', workItemId: 'w_acme_sso', nbaId: null, destination: slackDest('C0ACME', '#acme-ext', 'thread', '1730700000.0002'), status: 'sent', mode: 'send', createdAt: t(0, '08:10'), updatedAt: t(0, '08:14'), attempts: [{ id: 'att_2', at: t(0, '08:14'), mode: 'send', dryRun: false, outcome: 'sent' }], verification: { state: 'unverified', at: null, detail: 'Read-back pending' }, text: 'Yes: the portal supports SAML and OIDC, so your Okta tenant works as-is.' }),
  draft({ id: 'dr_failed_globex', workItemId: 'w_globex_estimate', nbaId: null, destination: emailDest([{ name: 'Marcus Webb', email: 'marcus.webb@globex.example' }], 'D360 consumption estimate', 'new'), status: 'failed', mode: 'draft', createdAt: t(-1, '17:20'), updatedAt: t(-1, '17:21'), attempts: [{ id: 'att_3', at: t(-1, '17:21'), mode: 'draft', dryRun: false, outcome: 'failed', detail: 'Gmail API 503: backendError' }], text: 'Hi Marcus, attached is the D360 consumption estimate for the expansion scope.' }),
];

const nba = (n: Partial<NbaIn> & Pick<NbaIn, 'id' | 'workItemId' | 'verb' | 'primaryLabel' | 'title' | 'why'>): NbaIn => ({
  version: 1,
  confidence: 'likely',
  sources: [],
  status: 'ready',
  generatedAt: t(0, '08:00'),
  model: 'sonnet',
  versions: [{ version: 1, at: t(0, '08:00'), reason: 'Generated', diffSummary: null }],
  ...n,
});
const REPO = '/Users/example/Projects/control-center';
const claudeNew = (q: string) => `claude://code/new?folder=${encodeURIComponent(REPO)}&q=${encodeURIComponent(q)}`;

const nbas: NbaIn[] = [
  nba({ id: 'nba_acme_build', workItemId: 'w_acme_build', verb: 'start_in_claude', primaryLabel: 'Open in Claude', confidence: 'sure', title: 'Kick off the demo-org build in Claude', why: 'Build is ~1h40m of agent time; demo at 13:00', sources: [src.cal('ACME Phase 2 demo')], runId: 'run_acme_build', claudeLaunch: { url: claudeNew('Build the ACME Phase 2 demo org [cc:w_acme_build]'), folder: REPO, promptPreview: 'Build the ACME Phase 2 demo org: load unified profiles, wire the headless portal… [cc:w_acme_build]' } }),
  nba({ id: 'nba_dana', workItemId: 'w_dana_reply', verb: 'send', primaryLabel: 'Send', title: 'Reply to Dana: confirm today’s demo scope', why: 'Dana asked in #acme-ext; scope changed after Tuesday’s call', sources: [src.acmeExt], draftId: 'dr_dana' }),
  nba({ id: 'nba_globex_sow', workItemId: 'w_globex_sow', verb: 'send', primaryLabel: 'Send', title: 'Reply-all to Marcus with the revised SOW', why: 'Marcus asked for pricing today', sources: [src.globexMail, src.gemini], draftId: 'dr_globex_sow', version: 2, versions: [{ version: 1, at: t(0, '08:46'), reason: 'Generated', diffSummary: null }, { version: 2, at: t(0, '09:00'), reason: 'Gemini notes arrived', diffSummary: 'Mentions the discount approval' }], update: { at: t(0, '09:00'), reason: 'Gemini notes: discount approval is with Elena', kind: 'revised', diffSummary: '+ Elena will confirm the discount approval today.', source: src.gemini } }),
  nba({ id: 'nba_onepager', workItemId: 'w_acme_onepager', verb: 'send', primaryLabel: 'Send', confidence: 'sure', title: 'Email Dana the one-pager', why: 'You promised it on Tuesday', sources: [src.acmeExt], draftId: 'dr_onepager' }),
  nba({ id: 'nba_priya', workItemId: 'w_priya_forecast', verb: 'send', primaryLabel: 'Send', confidence: 'sure', title: 'DM Priya your forecast notes', why: 'Asked before your 09:30 1:1', sources: [src.priyaDm], draftId: 'dr_priya' }),
  nba({ id: 'nba_nce', workItemId: 'w_nce_capture', verb: 'send', primaryLabel: 'Send', title: 'Message Leo about NCE gaps', why: 'Found your notes session and the team doc', sources: [src.manual], draftId: 'dr_nce' }),
  nba({ id: 'nba_globex_estimate', workItemId: 'w_globex_estimate', verb: 'run_tool', primaryLabel: 'Run Estimator', title: 'Refresh the consumption estimate with the D360/AF estimator', why: 'The last estimate predates the volume change', sources: [src.gemini], toolAdapterId: 'afd360-estimator', toolInputs: { account: 'Globex', scenario: 'expansion' } }),
  nba({ id: 'nba_globex_nudge', workItemId: 'w_globex_legal', verb: 'nudge', primaryLabel: 'Approve nudge', title: 'Nudge Marcus on the DPA', why: 'No reply in 6 days; close is in 3 weeks', sources: [src.globexMail], draftId: 'dr_nudge_globex' }),
  nba({ id: 'nba_initech_prep', workItemId: 'w_initech_prep', verb: 'review', primaryLabel: 'Review questions', confidence: 'guess', title: 'Draft discovery questions for Initech', why: 'Call at 10:30; nothing prepared', sources: [src.cal('Initech discovery call')], alternatives: [
    { verb: 'run_tool', label: 'Run Talk Track', reason: 'Generate a question bank from the pilot scope' },
    { verb: 'review', label: 'Reuse Globex list', reason: 'Similar discovery last month' },
    { verb: 'wait', label: 'Wait for inventory', reason: 'Peter may send the data-source list first' },
  ] }),
  nba({ id: 'nba_umbrella_deck', workItemId: 'w_umbrella_deck', verb: 'review', primaryLabel: 'Open deck', title: 'Add the FHIR slide and HIPAA controls', why: '0 of 2 requested updates made; review at 14:30', sources: [src.drive('Umbrella architecture review deck')] }),
  nba({ id: 'nba_umbrella_data', workItemId: 'w_umbrella_dataset', verb: 'answer', primaryLabel: 'Answer', confidence: 'sure', title: 'Answer the dataset run: synthetic or sample CSV?', why: 'The run is paused on your choice', sources: [src.claude('dataset build')], runId: 'run_umbrella_data' }),
  nba({ id: 'nba_hooli_talktrack', workItemId: 'w_hooli_talktrack', verb: 'run_tool', primaryLabel: 'Run Talk Track', title: 'Generate the Hooli scoping talk track', why: 'Talk Track can build it from the evaluation plan', sources: [src.drive('Hooli NCE evaluation plan')], toolAdapterId: 'talk-track', toolInputs: { customer: 'Hooli', name: 'Hooli NCE scoping', eventId: 'ev_hooli' } }),
  nba({ id: 'nba_log_hooli', workItemId: 'w_log_hooli', verb: 'log', primaryLabel: 'Log 4h', confidence: 'sure', title: 'Log the Hooli onsite: 4h, Solution Design, CF', why: 'Calendar shows 13:00–17:00 at Hooli HQ', sources: [src.cal('Hooli onsite')] }),
  nba({ id: 'nba_beacon', workItemId: 'w_promise_beacon', verb: 'start_in_claude', primaryLabel: 'Kick off', title: 'Kick off packaging the Beacon app in the background', why: 'Promised 70 days ago; ~90 min of agent time', sources: [{ kind: 'slack', label: 'DM · Ravi Menon' }], claudeLaunch: { url: claudeNew('Package the Beacon app for Ravi [cc:w_promise_beacon]'), folder: REPO, promptPreview: 'Package the Beacon app for Ravi… [cc:w_promise_beacon]' } }),
];

const proposals: In['proposals'] = [
  { id: 'prop_priya_due', entity: { type: 'work_item', id: 'w_priya_forecast', label: 'Send Priya the Q4 forecast notes' }, changes: [{ field: 'due', label: 'Due', before: t(0, '09:30'), after: t(0, '09:15') }], reason: 'Priya moved your 1:1 earlier? Her DM says "15 min before"', source: src.priyaDm, createdAt: t(0, '08:52'), status: 'pending', actor: 'engine', baseVersion: 1 },
];

// ---------------------------------------------------------------------------
// agents and tools
// ---------------------------------------------------------------------------
const run = (r: Partial<In['agentRuns'][number]> & Pick<In['agentRuns'][number], 'id' | 'kind' | 'title' | 'state' | 'lastEvent'>): In['agentRuns'][number] => ({ workItemId: null, startedAt: t(0, '08:00'), updatedAt: t(0, '08:50'), ...r });
const agentRuns: In['agentRuns'] = [
  run({ id: 'run_acme_build', kind: 'claude_session', title: 'ACME Phase 2 demo-org build', workItemId: 'w_acme_build', state: 'running', startedAt: t(0, '08:52'), updatedAt: t(0, '09:01'), lastEvent: 'Loading 5k unified profiles (2/6 steps)', deepLink: 'claude://code/continue?session=mock-acme-build', sessionId: 'mock-acme-build', cwd: '/Users/example/Projects/acme-demo', bgAgents: 2, progress: { done: 2, total: 6, label: 'Loading profiles' } }),
  run({ id: 'run_umbrella_data', kind: 'app_run', title: 'Umbrella demo dataset', workItemId: 'w_umbrella_dataset', state: 'waiting_on_you', startedAt: t(0, '08:05'), updatedAt: t(0, '08:20'), lastEvent: 'Paused: needs a data source choice', waiting: { reason: 'input needed', question: 'Use synthetic patients or the sample CSV Alice sent?', choices: ['Synthetic (5k patients)', 'Alice’s sample CSV'], since: t(0, '08:20') } }),
  run({ id: 'run_beacon', kind: 'claude_session', title: 'Package Beacon app', workItemId: 'w_promise_beacon', state: 'queued', startedAt: null, updatedAt: t(0, '08:40'), lastEvent: 'Queued: starts after the ACME build', deepLink: claudeNew('Package the Beacon app for Ravi [cc:w_promise_beacon]') }),
  run({ id: 'run_hooli_research', kind: 'claude_session', title: 'Hooli NCE competitive research', workItemId: 'w_hooli_plan', state: 'done_review', startedAt: t(-1, '18:00'), updatedAt: t(-1, '18:40'), finishedAt: t(-1, '18:40'), lastEvent: 'Finished · 6-page comparison ready for review', deepLink: 'claude://code/continue?session=mock-hooli-research', sessionId: 'mock-hooli-research', resultUrl: 'https://docs.example.com/hooli-research', costUsd: 0.42 }),
  run({ id: 'run_talktrack_acme', kind: 'tool_run', title: 'Talk Track: ACME Phase 1 review', workItemId: 'w_acme_recap', state: 'done', startedAt: t(-3, '15:00'), updatedAt: t(-3, '15:06'), finishedAt: t(-3, '15:06'), lastEvent: 'Succeeded · 9 segments', toolRunId: 'tr_talktrack_acme', resultUrl: 'http://localhost:4320/#/talk-tracks/tr_talktrack_acme' }),
  run({ id: 'run_estimator_fail', kind: 'tool_run', title: 'Estimator: Globex expansion', workItemId: 'w_globex_estimate', state: 'failed', startedAt: t(-1, '17:00'), updatedAt: t(-1, '17:02'), finishedAt: t(-1, '17:02'), lastEvent: 'Failed: CLI exited 1 (missing rate card)', toolRunId: 'tr_estimator_fail', error: 'afd360-estimator: rate card for FY27 not found' }),
  run({ id: 'run_initech_sketch', kind: 'claude_session', title: 'Initech data-model sketch', workItemId: null, state: 'stale', startedAt: t(0, '07:10'), updatedAt: t(0, '08:10'), lastEvent: 'No progress for 52 min', deepLink: 'claude://code/continue?session=mock-initech', sessionId: 'mock-initech' }),
  run({ id: 'run_autopilot', kind: 'claude_session', title: 'Activity autopilot (scheduled)', workItemId: null, state: 'done', startedAt: t(0, '06:00'), updatedAt: t(0, '06:07'), finishedAt: t(0, '06:07'), lastEvent: 'Proposed 4 activity rows', scheduled: true, sessionId: 'mock-autopilot', deepLink: 'claude://code/continue?session=mock-autopilot' }),
];

const toolAdapters: In['toolAdapters'] = [
  {
    manifest: {
      id: 'talk-track',
      name: 'Talk Track',
      description: 'Generate a talk track (slides + live demo) for an event',
      version: 1,
      kind: 'http',
      capabilities: ['generate-talk-track'],
      match: { taskTypes: ['demo-prep', 'presentation'], keywords: ['talk track', 'demo'] },
      input: {
        schema: { type: 'object', required: ['customer', 'name'], properties: { customer: { type: 'string', title: 'Customer' }, name: { type: 'string', title: 'Talk track name' }, eventId: { type: 'string', title: 'Event' } } },
        prefill: { customer: '{{task.account.name}}', name: '{{event.title}}' },
      },
      launch: { http: { baseUrl: 'http://localhost:4320', steps: [{ id: 'create', method: 'POST', path: '/api/talk-tracks', body: { name: '{{in.name}}', customer: '{{in.customer}}' }, save: { trackId: '$.id' } }, { id: 'gen', method: 'POST', path: '/api/talk-tracks/{{trackId}}/generate', save: { jobId: '$.jobId' } }] } },
      lifecycle: { start: { cwd: '~/Projects/talk-track', argv: ['npm', 'start'], env: { PORT: '4320' }, readyUrl: 'http://localhost:4320/api/talk-tracks', readyTimeoutSec: 30 }, stopAfterIdleMin: null },
      progress: { type: 'ndjson', http: { path: '/api/talk-tracks/{{trackId}}/jobs/{{jobId}}/stream' } },
      output: { kind: 'link', link: { url: 'http://localhost:4320/#/talk-tracks/{{trackId}}', label: 'Open talk track' } },
      health: { type: 'http', http: { url: 'http://localhost:4320/api/talk-tracks', expectStatus: 200, timeoutMs: 1500 }, intervalSec: 60, onFail: 'offer-start' },
      safety: { network: 'localhost-only', writes: ['~/Projects/talk-track/talk-tracks'], requiresApproval: true, dataClass: 'customer' },
    },
    health: { state: 'ok', checkedAt: t(0, '09:00') },
    recentRunIds: ['tr_talktrack_acme'],
  },
  {
    manifest: {
      id: 'pulse-footprint',
      name: 'Pulse Footprint',
      description: 'Org footprint and usage pulse for an account (slides export)',
      version: 1,
      kind: 'http',
      capabilities: ['org-footprint'],
      match: { taskTypes: ['account-review'], keywords: ['footprint', 'pulse', 'usage'] },
      input: { schema: { type: 'object', required: ['orgId'], properties: { orgId: { type: 'string', title: 'Org' }, format: { type: 'string', enum: ['pptx', 'link'] } } }, prefill: {} },
      launch: { http: { baseUrl: 'http://localhost:4318', steps: [{ id: 'run', method: 'POST', path: '/api/orgs/{{in.orgId}}/footprint' }] } },
      lifecycle: { start: { cwd: '~/Projects/footprint-app', argv: ['npm', 'run', 'dev'], env: { PORT: '4318' }, readyUrl: 'http://localhost:4318/api/orgs' } },
      progress: { type: 'sse', http: { path: '/api/orgs/{{in.orgId}}/footprint/stream' } },
      output: { kind: 'both', link: { url: 'http://localhost:4318/orgs/{{in.orgId}}', label: 'Open footprint' }, artifacts: [{ path: '/pptx?download=1', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'footprint.pptx' }] },
      health: { type: 'http', http: { url: 'http://localhost:4318/api/orgs', expectStatus: 200 }, intervalSec: 60, onFail: 'offer-start' },
      safety: { network: 'localhost-only', writes: [], requiresApproval: true, dataClass: 'customer' },
    },
    health: { state: 'down', checkedAt: t(0, '09:00'), message: 'Connection refused on :4318 (not running)' },
    recentRunIds: [],
  },
  {
    manifest: {
      id: 'afd360-estimator',
      name: 'D360/AF Estimator',
      description: 'Defensible Data 360 + Agentforce consumption estimate',
      version: 1,
      kind: 'cli',
      capabilities: ['consumption-estimate'],
      match: { taskTypes: ['pricing'], keywords: ['estimate', 'consumption', 'credits'] },
      input: { schema: { type: 'object', required: ['account'], properties: { account: { type: 'string', title: 'Account' }, scenario: { type: 'string', title: 'Scenario' }, format: { type: 'string', enum: ['xlsx', 'md'] } } }, prefill: { account: '{{task.account.name}}' } },
      launch: { cli: { cwd: '~/.claude/skills/afd360-estimator', argv: ['python3', 'scripts/cli.py', 'export', '{{in.estimatePath}}', '--format', '{{in.format}}'], timeoutSec: 300 } },
      progress: { type: 'exit-code' },
      output: { kind: 'artifact', artifacts: [{ path: '{{runDir}}/out.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'estimate.xlsx', revealable: true }] },
      health: { type: 'file', intervalSec: 300 },
      safety: { network: 'none', writes: ['~/Projects/afd360-estimates'], requiresApproval: false, dataClass: 'customer' },
    },
    health: { state: 'ok', checkedAt: t(0, '08:55') },
    recentRunIds: ['tr_estimator_fail'],
  },
];

const toolRuns: In['toolRuns'] = [
  { id: 'tr_talktrack_acme', adapterId: 'talk-track', workItemId: 'w_acme_recap', inputs: { customer: 'ACME Corp', name: 'ACME Phase 1 review' }, status: 'succeeded', progress: { done: 9, total: 9, label: 'Done' }, linkUrl: 'http://localhost:4320/#/talk-tracks/tr_talktrack_acme', linkLabel: 'Open talk track', startedAt: t(-3, '15:00'), finishedAt: t(-3, '15:06'), agentRunId: 'run_talktrack_acme' },
  { id: 'tr_estimator_fail', adapterId: 'afd360-estimator', workItemId: 'w_globex_estimate', inputs: { account: 'Globex', scenario: 'expansion' }, status: 'failed', startedAt: t(-1, '17:00'), finishedAt: t(-1, '17:02'), error: 'rate card for FY27 not found', agentRunId: 'run_estimator_fail' },
];

// ---------------------------------------------------------------------------
// time / activity
// ---------------------------------------------------------------------------
const act = (a: Partial<In['activity'][number]> & Pick<In['activity'][number], 'id' | 'date' | 'start' | 'end' | 'durationH' | 'description' | 'status'>): In['activity'][number] => ({ version: 1, taskType: 'Solution Design', oppId: null, meetingType: 'CF', updatedAt: t(0, '06:07'), confidence: 'likely', ...a });
const activity: In['activity'] = [
  act({ id: 'ac_mon_acme', date: day(-3), start: t(-3, '10:00'), end: t(-3, '12:00'), durationH: 2, taskType: 'Discovery', oppId: 'opp_acme_p2', oppName: 'ACME · Headless Phase 2', accountName: 'ACME Corp', description: 'ACME discovery workshop', status: 'verified', sources: [{ kind: 'calendar', label: 'Calendar · ACME workshop', externalId: 'ev_mon_acme' }], updatedAt: t(-2, '09:00') }),
  act({ id: 'ac_mon_prep', date: day(-3), start: t(-3, '08:30'), end: t(-3, '09:30'), durationH: 1, taskType: 'Demo Prep', oppId: 'opp_acme_p2', oppName: 'ACME · Headless Phase 2', accountName: 'ACME Corp', meetingType: 'CR', description: 'Workshop prep', status: 'logged', updatedAt: t(-2, '09:00') }),
  // D-65: not in Org62 after all: a canvas ran without this row (TL-20), and an Event deleted in Org62 (TL-14). Both
  // sit in Time ▸ Needs you ▸ Not in Org62, with Log again / Leave out
  act({ id: 'ac_mon_globex_arch', date: day(-3), start: t(-3, '13:00'), end: t(-3, '14:00'), durationH: 1, taskType: 'Solution Design', oppId: 'opp_globex_d360', oppName: 'Globex · Data 360 Expansion', accountName: 'Globex', description: 'Globex architecture call', status: 'synced_to_canvas', issues: [NOT_IN_ORG62_FLAG], sources: [{ kind: 'calendar', label: 'Calendar · Globex architecture call', externalId: 'ev_mon_globex_arch' }], updatedAt: t(-2, '09:00') }),
  act({ id: 'ac_mon_acme_review', date: day(-3), start: t(-3, '14:30'), end: t(-3, '15:00'), durationH: 0.5, taskType: 'Discovery', oppId: 'opp_acme_p2', oppName: 'ACME · Headless Phase 2', accountName: 'ACME Corp', description: 'ACME architecture review', status: 'verify_failed', issues: [`${ORG62_CHECK_PREFIX}${DELETED_IN_ORG62}`], sources: [{ kind: 'calendar', label: 'Calendar · ACME architecture review', externalId: 'ev_mon_acme_review' }], updatedAt: t(-2, '09:00') }),
  act({ id: 'ac_tue_globex', date: day(-2), start: t(-2, '14:00'), end: t(-2, '15:00'), durationH: 1, taskType: 'Executive Briefing', oppId: 'opp_globex_d360', oppName: 'Globex · Data 360 Expansion', accountName: 'Globex', description: 'Globex exec briefing', status: 'synced_to_canvas', sources: [{ kind: 'calendar', label: 'Calendar · Globex exec briefing', externalId: 'ev_tue_globex' }] }),
  act({ id: 'ac_tue_sow', date: day(-2), start: t(-2, '15:30'), end: t(-2, '16:30'), durationH: 1, taskType: 'Proposal', oppId: 'opp_globex_d360', oppName: 'Globex · Data 360 Expansion', accountName: 'Globex', meetingType: 'CR', description: 'SOW pricing model', status: 'approved', sources: [{ kind: 'drive', label: 'Drive · Globex SOW v3' }] }),
  act({ id: 'ac_wed_umbrella', date: day(-1), start: t(-1, '09:00'), end: t(-1, '10:30'), durationH: 1.5, taskType: 'Technical Deep Dive', oppId: 'opp_umbrella_c360', oppName: 'Umbrella · Patient 360', accountName: 'Umbrella Health', description: 'Umbrella technical deep dive', status: 'verify_failed', issues: ['Org62 shows 1h; you logged 1.5h'], sources: [{ kind: 'calendar', label: 'Calendar · Umbrella deep dive', externalId: 'ev_wed_umbrella' }] }),
  act({ id: 'ac_wed_hooli', date: day(-1), start: t(-1, '13:00'), end: t(-1, '17:00'), durationH: 4, taskType: null, oppId: null, accountName: 'Hooli', description: 'Hooli onsite', status: 'needs_input', issues: ['Needs an opp (WhatId) and a task type'], confidence: 'sure', sources: [{ kind: 'calendar', label: 'Calendar · Hooli onsite', externalId: 'ev_wed_hooli' }] }),
  // Rows the engine could not place (Needs you ▸ No opportunity), with its own canvas-grammar notes: the UI says them in
  // plain English, and suggests the opp where the rules can (a Slack channel's name, an attendee's domain); the Claude
  // row has nothing to go on (the cheap model's pass suggests one live)
  act({ id: 'ac_tue_slack_initech', date: day(-2), start: t(-2, '11:15'), end: t(-2, '12:00'), durationH: 0.75, taskType: 'Solution Design', oppId: null, meetingType: 'CR', description: 'Slack: Snowflake data share thread', status: 'needs_input', confidence: 'guess', why: 'estimated from evidence (guess)', issues: ['NEEDS WhatId: which account/opp was this for? write `=> 006…` or `=> skip`', 'GUESS: hours estimated from evidence; adjust with `=> 1.5h`'], sources: [{ kind: 'slack', label: 'Slack · #initech-pilot', url: 'https://example.slack.com/archives/C0EXAMPLE01/p1700000000000100' }] }),
  act({ id: 'ac_wed_roadmap', date: day(-1), start: t(-1, '08:00'), end: t(-1, '09:00'), durationH: 1, taskType: 'Customer Discovery', oppId: null, meetingType: 'CF', description: 'Data 360 roadmap call', status: 'needs_input', why: 'external meeting, no keyword', issues: ['CF forced: external attendee (globex.example); Neither type -> Customer Discovery, review', 'NEEDS WhatId: pick an opp from candidates'], sources: [{ kind: 'calendar', label: 'Calendar · Data 360 roadmap call', externalId: 'ev_wed_roadmap' }] }),
  act({ id: 'ac_mon_claude_model', date: day(-3), start: t(-3, '16:00'), end: t(-3, '17:30'), durationH: 1.5, taskType: 'Solution Creation', oppId: null, meetingType: 'CR', description: 'Claude: member data model draft', status: 'needs_input', confidence: 'guess', why: 'estimated from evidence (guess)', issues: ['NEEDS WhatId: which account/opp was this for? write `=> 006…` or `=> skip`', 'GUESS: hours estimated from evidence; adjust with `=> 1.5h`'], sources: [{ kind: 'claude', label: 'Claude · Member data model draft' }] }),
  act({ id: 'ac_wed_nce', date: day(-1), start: t(-1, '17:30'), end: t(-1, '18:30'), durationH: 1, taskType: 'Solution Design', oppId: 'opp_hooli_nce', oppName: 'Hooli · Nimbus Context Engine', accountName: 'Hooli', meetingType: 'CR', description: 'NCE evaluation plan draft', status: 'proposed', sources: [{ kind: 'drive', label: 'Drive · Hooli NCE evaluation plan' }] }),
  act({ id: 'ac_wed_internal', date: day(-1), start: t(-1, '11:00'), end: t(-1, '11:30'), durationH: 0.5, taskType: null, meetingType: null, description: 'SE enablement sync (internal)', status: 'dismissed' }),
  act({ id: 'ac_thu_standup', date: day(0), start: t(0, '08:00'), end: t(0, '08:30'), durationH: 0.5, taskType: null, meetingType: null, description: 'SE team stand-up (internal)', status: 'dismissed' }),
  act({ id: 'ac_thu_acme', date: day(0), start: t(0, '13:00'), end: t(0, '14:00'), durationH: 1, taskType: 'Demo', oppId: 'opp_acme_p2', oppName: 'ACME · Headless Phase 2', accountName: 'ACME Corp', description: 'ACME Phase 2 demo', status: 'upcoming', sources: [{ kind: 'calendar', label: 'Calendar · ACME Phase 2 demo', externalId: 'ev_acme_demo' }] }),
  // D-64: internal-only work (no opp, no account, no customer): Time ▸ Log it ▸ Internal (no opportunity)
  internalAct({ id: 'ac_mon_cert', date: day(-3), start: t(-3, '15:00'), end: t(-3, '16:00'), durationH: 1, taskType: 'Personal Development', description: 'Data Cloud certification study group', key: `cal|primary|cert_study_${day(-3).replace(/-/g, '')}T220000Z|${t(-3, '15:00')}`, sources: [{ kind: 'calendar', label: 'Calendar · Data Cloud certification study group', externalId: 'ev_mon_cert' }] }),
  internalAct({ id: 'ac_tue_repo', date: day(-2), start: t(-2, '17:00'), end: t(-2, '18:30'), durationH: 1.5, taskType: 'Asset Creation', description: 'demo-kit: internal asset build', key: `wb|${day(-2)}|repo:demo-kit`, issues: ['GUESS: hours estimated from evidence; adjust with `=> 1.5h`'], sources: [{ kind: 'claude', label: 'Claude · Demo kit portal build' }] }),
  internalAct({ id: 'ac_wed_docs', date: day(-1), start: t(-1, '10:30'), end: t(-1, '11:00'), durationH: 0.5, taskType: 'Asset Creation', description: '2 Drive docs: internal asset build', key: `wb|${day(-1)}|docs:unmapped`, issues: ['GUESS: hours estimated from evidence; adjust with `=> 1.5h`'], sources: [{ kind: 'drive', label: 'Drive · Demo script template' }, { kind: 'drive', label: 'Drive · Estimator skill notes' }] }),
].map(withNote);

/**
 * D-66: each row's Org62 Description note, made by the same template the projection uses (placeholder companies and
 * `.example` domains only). One verified row carries a meeting-notes summary (the cheap model's, basis `summary`).
 */
function withNote(a: In['activity'][number]): In['activity'][number] {
  if (a.id === 'ac_mon_acme') {
    return { ...a, logNote: 'Discovery workshop with the ACME Corp commerce team on the Phase 2 headless storefront: mapped their order and profile sources. Next step: Send the Phase 2 architecture draft.', logNoteBasis: 'summary' };
  }
  const srcs = a.sources ?? [];
  const calendar = srcs.some((x) => x.kind === 'calendar') || !srcs.length;
  const labels = (kind: string, prefix: string) => srcs.filter((x) => x.kind === kind).map((x) => x.label.replace(prefix, ''));
  const kind: NoteFacts['kind'] = !calendar ? 'work' : /onsite/i.test(a.description) ? 'onsite' : 'meeting';
  const customer = a.internal ? null : (a.accountName ?? null);
  const repo = a.id === 'ac_tue_repo' ? ['demo-kit'] : [];
  const facts: NoteFacts = {
    kind,
    subject: a.description,
    taskType: a.taskType ?? null,
    internal: !!a.internal,
    customer,
    externalDomains: calendar && a.meetingType === 'CF' && customer ? [`${customer.split(' ')[0]!.toLowerCase()}.example`] : [],
    sessions: labels('claude', 'Claude · '),
    docs: labels('drive', 'Drive · '),
    repos: repo,
  };
  return { ...a, logNote: templateNote(facts), logNoteBasis: 'template' };
}

/** An internal row (D-64): the fields the db derives it from, and the source its dedupe key names (Dismiss all from …). */
function internalAct(a: Omit<Parameters<typeof act>[0], 'status'> & { key: string }): In['activity'][number] {
  const { key, ...rest } = a;
  return act({ ...rest, status: 'proposed', oppId: null, oppName: null, accountName: null, meetingType: null, confidence: 'guess', internal: true, dismissSource: dismissSourceOf(key, a.description) });
}

const timeBlocks: In['timeBlocks'] = [
  { id: 'tb_c1', lane: 'claude', start: t(-3, '13:00'), end: t(-3, '15:00'), label: 'Claude · ACME data model' },
  { id: 'tb_c2', lane: 'claude', start: t(-1, '18:00'), end: t(-1, '18:40'), label: 'Claude · Hooli research' },
  { id: 'tb_c3', lane: 'claude', start: t(0, '08:52'), end: t(0, '09:02'), label: 'Claude · ACME build (running)' },
  { id: 'tb_d1', lane: 'drive', start: t(-2, '15:30'), end: t(-2, '16:20'), label: 'Globex SOW v3' },
  { id: 'tb_d2', lane: 'drive', start: t(-1, '17:30'), end: t(-1, '18:20'), label: 'Hooli NCE evaluation plan' },
  { id: 'tb_d3', lane: 'drive', start: t(0, '08:35'), end: t(0, '08:40'), label: 'Hooli NCE evaluation plan' },
  { id: 'tb_s1', lane: 'slack', start: t(-2, '16:30'), end: t(-2, '16:45'), label: '#acme-ext' },
  { id: 'tb_s2', lane: 'slack', start: t(0, '08:10'), end: t(0, '08:20'), label: '#acme-ext, #hooli-ext' },
  { id: 'tb_f1', lane: 'focus', start: t(-2, '09:00'), end: t(-2, '11:00'), label: 'Focus: Umbrella deck' },
];

// ---------------------------------------------------------------------------
// briefs / watches
// ---------------------------------------------------------------------------
const briefs: In['briefs'] = [
  {
    id: 'brief_team',
    kind: 'channel',
    title: '#team-updates',
    subscriptionId: 'watch_team',
    period: { from: t(-1, '07:30'), to: t(0, '07:30') },
    through: t(0, '07:30'),
    sources: [{ kind: 'slack', label: '#team-updates' }],
    summary: 'Busy day in #team-updates: the FY27 D360 rate card landed, two SEs compared zero-copy patterns for Snowflake, and product confirmed NCE GA timing. Most of it is reference material; two items touch your deals.',
    unread: true,
    status: 'ready',
    highlights: [
      { id: 'hl_ratecard', version: 1, briefId: 'brief_team', title: 'FY27 D360 rate card published', summary: 'New consumption tiers; affects the Globex estimate you owe Friday.', relevance: 'high', reasons: ['Globex D360 expansion (Negotiation, $1.2M)', 'Open task: share the consumption estimate'], sources: [{ kind: 'slack', label: '#team-updates · pinned' }], status: 'new', at: t(-1, '15:10') },
      { id: 'hl_nce_ga', version: 1, briefId: 'brief_team', title: 'NCE GA moved to February', summary: 'Product confirmed the GA date; Hooli’s evaluation timeline may need a note.', relevance: 'high', reasons: ['Hooli Nimbus Context Engine evaluation', 'Policy: customer-facing first'], sources: [{ kind: 'slack', label: '#team-updates · thread' }], status: 'new', at: t(-1, '11:40') },
      { id: 'hl_zerocopy', version: 1, briefId: 'brief_team', title: 'Zero-copy Snowflake pattern write-up', summary: 'Kim shared a pattern doc that matches Initech’s stack.', relevance: 'medium', reasons: ['Initech D360 pilot (Snowflake)'], sources: [{ kind: 'slack', label: '#team-updates · Kim Tran' }], status: 'seen', at: t(-1, '10:05') },
    ],
    everythingElse: [
      { thread: 'Office hours schedule', items: [{ at: t(-1, '09:00'), author: 'Kim Tran', text: 'Office hours move to Thursdays.' }] },
      { thread: 'Demo org quotas', items: [{ at: t(-1, '13:20'), author: 'SE Ops', text: 'Quotas reset Monday.' }, { at: t(-1, '13:30'), author: 'Kim Tran', text: 'Thanks!' }] },
    ],
    generatedAt: t(0, '07:31'),
  },
  {
    id: 'brief_opp_globex',
    kind: 'opp',
    title: 'Globex · Data 360 Expansion',
    oppId: 'opp_globex_d360',
    accountId: 'acc_globex',
    period: { from: t(-1, '07:30'), to: t(0, '07:30') },
    through: t(0, '07:30'),
    sources: [{ kind: 'org62', label: 'Org62 · opportunity' }, { kind: 'gmail', label: 'Gmail · 3 threads' }, { kind: 'slack', label: '#globex-deal' }],
    summary: 'Stage moved to **Negotiation** and the close date held at month end. Marcus asked for revised pricing; legal still has the DPA. Elena flagged an 18% discount that needs approval.',
    unread: true,
    status: 'ready',
    highlights: [
      { id: 'hl_globex_discount', version: 1, briefId: 'brief_opp_globex', title: '18% discount needs approval', summary: 'Elena raised it in #globex-deal; it blocks the SOW.', relevance: 'high', reasons: ['Your SOW reply is due today', 'Deal value $1.2M'], sources: [{ kind: 'slack', label: '#globex-deal' }], status: 'new', at: t(-1, '16:45') },
      { id: 'hl_globex_stage', version: 1, briefId: 'brief_opp_globex', title: 'Stage → Negotiation', summary: 'Org62 stage change by Elena.', relevance: 'medium', reasons: ['Your VDP should reflect the stage'], sources: [{ kind: 'org62', label: 'Org62 · field history' }], status: 'new', at: t(-1, '17:00') },
    ],
    everythingElse: [],
    generatedAt: t(0, '07:32'),
  },
  {
    id: 'brief_opp_acme',
    kind: 'opp',
    title: 'ACME · Headless Phase 2',
    oppId: 'opp_acme_p2',
    accountId: 'acc_acme',
    period: { from: t(-1, '07:30'), to: t(0, '07:30') },
    through: t(0, '07:30'),
    sources: [{ kind: 'slack', label: '#acme-ext' }, { kind: 'org62', label: 'Org62 · opportunity' }],
    summary: 'Quiet day. Dana asked about SSO (answered) and the demo scope (open). No Org62 changes.',
    unread: false,
    status: 'ready',
    highlights: [{ id: 'hl_acme_sso', version: 2, briefId: 'brief_opp_acme', title: 'Dana asked about SSO', summary: 'You answered in-thread.', relevance: 'medium', reasons: ['ACME Phase 2 demo today'], sources: [{ kind: 'slack', label: '#acme-ext' }], status: 'promoted', promotedWorkItemId: 'w_acme_sso', at: t(-1, '09:30') }],
    everythingElse: [{ thread: '#acme-ext general', items: [{ at: t(-1, '12:00'), author: 'Raj Mehta', text: 'Pricing goes out after the demo.' }] }],
    generatedAt: t(0, '07:33'),
  },
];

const watches: In['watches'] = [
  { id: 'watch_team', version: 1, targetKind: 'channel', target: 'C0TEAMUPD', label: '#team-updates', cadence: 'daily_0730', style: 'brief', enabled: true, createdAt: t(-40, '09:00'), updatedAt: t(-40, '09:00') },
  { id: 'watch_nce', version: 2, targetKind: 'search', target: '"nimbus context engine" OR NCE', label: 'Search: Nimbus Context Engine', cadence: 'every_4h', style: 'detailed', enabled: true, createdAt: t(-12, '09:00'), updatedAt: t(-5, '09:00') },
];

// ---------------------------------------------------------------------------
// health
// ---------------------------------------------------------------------------
const conn = (c: Partial<In['connectors'][number]> & Pick<In['connectors'][number], 'id' | 'label' | 'source' | 'state'>): In['connectors'][number] => ({ since: t(0, '06:00'), lastSuccessAt: t(0, '09:01'), cursor: { label: `${c.label} through 09:01`, at: t(0, '09:01') }, ...c });
const google = { kind: 'in_app' as const, label: 'Reconnect Google', command: 'devbar mcpgw connectors connect google-workspace-readonly' };
const connectors: In['connectors'] = [
  conn({ id: 'slack', label: 'Slack', source: 'slack', state: 'ok', itemsToday: 42, reauth: { kind: 'terminal_command', label: 'Re-auth Slack', command: 'claude mcp login slack', instructions: 'Or in any Claude session: /mcp → slack → Authenticate' }, affects: ['today', 'items', 'briefs'] }),
  conn({ id: 'gmail', label: 'Gmail', source: 'gmail', state: 'ok', itemsToday: 18, reauth: google, affects: ['today', 'items', 'outbox'] }),
  conn({ id: 'calendar', label: 'Calendar', source: 'calendar', state: 'ok', itemsToday: 9, reauth: google, affects: ['today', 'calendar', 'time'] }),
  conn({ id: 'drive', label: 'Drive', source: 'drive', state: 'catching_up', catchUpPct: 60, lastSuccessAt: t(0, '08:30'), cursor: { label: 'Drive through 08:30', at: t(0, '08:30') }, backlog: 14, itemsToday: 6, reauth: google, affects: ['items'] }),
  conn({ id: 'gemini', label: 'Gemini notes', source: 'gemini', state: 'ok', itemsToday: 2, reauth: google }),
  conn({ id: 'org62', label: 'Org62', source: 'org62', state: 'degraded', since: t(0, '08:40'), lastSuccessAt: t(0, '08:10'), cursor: { label: 'Org62 through 08:10', at: t(0, '08:10') }, lastError: { class: 'rate_limited', message: 'REQUEST_LIMIT_EXCEEDED (retrying with backoff)', at: t(0, '08:58'), count: 3 }, reauth: { kind: 'terminal_command', label: 'Re-auth Org62', command: 'claude mcp login Org62-Sobject-Read' }, affects: ['deals'] }),
  conn({ id: 'vdp', label: 'VDP', source: 'vdp', state: 'auth_needed', since: t(0, '07:12'), lastSuccessAt: t(-1, '18:00'), cursor: { label: 'VDP through yesterday 18:00', at: t(-1, '18:00') }, lastError: { class: 'auth', message: 'Okta needs MFA; silent refresh skipped', at: t(0, '07:12'), count: 1 }, impact: 'Value plans may be out of date', reauth: { kind: 'refresh_script', label: 'Re-auth VDP', command: 'python3 ~/.claude/scripts/refresh_vdp_fir_cookie.py', instructions: 'Opens a browser for Okta MFA (up to 5 minutes)' }, affects: ['deals', 'items'] }),
  conn({ id: 'claude', label: 'Claude sessions', source: 'claude', state: 'ok', itemsToday: 7, reauth: null }),
];

const scan = (s: Partial<In['scanRuns'][number]> & Pick<In['scanRuns'][number], 'id' | 'connectorId' | 'scope' | 'status' | 'startedAt'>): In['scanRuns'][number] => ({ kind: 'poll', windowStart: s.startedAt, windowEnd: s.startedAt, endedAt: s.startedAt, itemsSeen: 0, itemsNew: 0, itemsChanged: 0, costUsd: 0, model: null, ...s });
const scanRuns: In['scanRuns'] = [
  scan({ id: 'scan_1', connectorId: 'slack', scope: 'dms_to_me', status: 'ok', startedAt: t(0, '09:01'), itemsSeen: 4, itemsNew: 1, costUsd: 0.003, model: 'haiku' }),
  scan({ id: 'scan_2', connectorId: 'slack', scope: 'mentions', status: 'ok', startedAt: t(0, '09:01'), itemsSeen: 2, costUsd: 0.002, model: 'haiku' }),
  scan({ id: 'scan_3', connectorId: 'gmail', scope: 'inbox', status: 'ok', startedAt: t(0, '09:00'), itemsSeen: 11, itemsNew: 2, itemsChanged: 1 }),
  scan({ id: 'scan_4', connectorId: 'calendar', scope: 'primary', status: 'ok', startedAt: t(0, '09:00'), itemsSeen: 9 }),
  scan({ id: 'scan_5', connectorId: 'drive', scope: 'tracked files', kind: 'backfill', status: 'running', startedAt: t(0, '08:30'), endedAt: null, itemsSeen: 21 }),
  scan({ id: 'scan_6', connectorId: 'org62', scope: 'my opps', status: 'transient_failed', startedAt: t(0, '08:58'), error: 'REQUEST_LIMIT_EXCEEDED', model: 'haiku', costUsd: 0.001 }),
  scan({ id: 'scan_7', connectorId: 'org62', scope: 'my opps', status: 'partial', startedAt: t(0, '08:10'), itemsSeen: 9, itemsChanged: 1, model: 'haiku', costUsd: 0.004 }),
  scan({ id: 'scan_8', connectorId: 'vdp', scope: 'my VDPs', status: 'auth_failed', startedAt: t(0, '07:12'), error: 'Unexpected content type: text/html' }),
  scan({ id: 'scan_9', connectorId: 'gemini', scope: 'meeting notes', status: 'ok', startedAt: t(0, '09:00'), itemsSeen: 1, itemsNew: 1 }),
  scan({ id: 'scan_10', connectorId: 'slack', scope: '#team-updates', kind: 'head', status: 'ok', startedAt: t(0, '07:30'), windowStart: t(-1, '07:30'), windowEnd: t(0, '07:30'), itemsSeen: 63, itemsNew: 63, costUsd: 0.02, model: 'haiku' }),
];

const job = (j: Partial<In['jobs'][number]> & Pick<In['jobs'][number], 'id' | 'type' | 'status'>): In['jobs'][number] => ({ attempts: 1, maxAttempts: 5, runAt: t(0, '09:00'), ...j });
const jobs: In['jobs'] = [
  job({ id: 'job_1', type: 'reevaluate', status: 'running', dedupeKey: 'reeval:work_item:w_dana_reply', generation: 3, startedAt: t(0, '09:01'), entity: { type: 'work_item', id: 'w_dana_reply', label: 'Reply to Dana' } }),
  job({ id: 'job_2', type: 'scan.slack', status: 'queued', runAt: t(0, '09:02'), attempts: 0 }),
  job({ id: 'job_3', type: 'scan.org62', status: 'retrying', attempts: 3, runAt: t(0, '09:04'), error: 'REQUEST_LIMIT_EXCEEDED' }),
  job({ id: 'job_4', type: 'nba.generate', status: 'dead', attempts: 5, runAt: t(0, '06:30'), finishedAt: t(0, '06:45'), error: 'LLM output failed schema validation (missing destination)', entity: { type: 'work_item', id: 'w_travel_globex', label: 'Book travel for the Globex onsite' } }),
  job({ id: 'job_5', type: 'brief.generate', status: 'succeeded', runAt: t(0, '07:30'), startedAt: t(0, '07:30'), finishedAt: t(0, '07:33') }),
  job({ id: 'job_6', type: 'reevaluate', status: 'cancelled', dedupeKey: 'reeval:work_item:w_globex_sow', generation: 1, runAt: t(0, '08:46'), error: 'Superseded by generation 2' }),
  job({ id: 'job_7', type: 'scan.drive', status: 'running', startedAt: t(0, '08:30') }),
];

const eventLog: In['eventLog'] = [
  { id: 'evt_1', at: t(0, '07:12'), level: 'error', source: 'vdp', code: 'auth_needed', message: 'VDP cookie lapsed; Okta needs MFA', count: 1, lastSeenAt: t(0, '07:12'), suggestedAction: 'Re-auth VDP' },
  { id: 'evt_2', at: t(0, '08:40'), level: 'warn', source: 'org62', code: 'rate_limited', message: 'REQUEST_LIMIT_EXCEEDED; backing off', count: 3, lastSeenAt: t(0, '08:58') },
  { id: 'evt_3', at: t(0, '06:45'), level: 'error', source: 'worker', code: 'job_dead_lettered', message: 'nba.generate dead after 5 attempts (schema validation)', count: 1, lastSeenAt: t(0, '06:45'), suggestedAction: 'Retry from Jobs' },
  { id: 'evt_4', at: t(-1, '22:10'), level: 'warn', source: 'claude', code: 'parse_drift', message: 'Transcript parse error rate 1.4% (> 1%)', count: 12, lastSeenAt: t(0, '08:00') },
  { id: 'evt_5', at: t(0, '07:33'), level: 'info', source: 'briefs', code: 'brief_ready', message: '3 briefs generated', count: 1, lastSeenAt: t(0, '07:33'), acknowledged: true, acknowledgedAt: t(0, '07:40') },
  { id: 'evt_6', at: t(-1, '17:21'), level: 'error', source: 'gmail', code: 'send_failed', message: 'Draft push failed: Gmail API 503 backendError', count: 1, lastSeenAt: t(-1, '17:21'), suggestedAction: 'Retry from Outbox' },
];

const spend: In['spend'] = {
  today: { usd: 1.12, softBudgetUsd: 5, hardCapUsd: 15, pct: 22 },
  state: 'ok',
  last7d: [-6, -5, -4, -3, -2, -1, 0].map((o, i) => ({ day: day(o), usd: [0.4, 0.2, 1.6, 1.4, 1.9, 1.3, 1.12][i] })),
  byScanner: [{ name: 'slack', usd: 0.21 }, { name: 'org62', usd: 0.08 }, { name: 'briefs', usd: 0.18 }, { name: 'nba', usd: 0.52 }, { name: 'chat', usd: 0.13 }],
  byModel: [{ model: 'haiku', usd: 0.34 }, { model: 'sonnet', usd: 0.78 }],
};

// ---------------------------------------------------------------------------
// settings / policy
// ---------------------------------------------------------------------------
const rules: In['settings']['policy']['rules'] = [
  { id: 'r_customer', text: 'Customer-facing beats internal', enabled: true, when: { customerFacing: true }, boost: 1.5 },
  { id: 'r_manager', text: 'My manager’s asks within 24 h', enabled: true, when: { fromManager: true, dueWithinH: 24 }, boost: 2 },
  { id: 'r_training', text: 'Never rank trainings above customer prep', enabled: true, when: { kinds: ['training'] }, boost: -3 },
  { id: 'r_travel', text: 'Travel can wait unless it is this week', enabled: true, when: { kinds: ['travel'] }, boost: -1 },
  { id: 'r_drive', text: 'Deliverables with Drive activity get a nudge', enabled: false, when: { kinds: ['deliverable'], sources: ['drive'] }, boost: 1 },
];
const weightsV3 = { customer_facing: 3, meeting_proximity: 3, due_urgency: 2.5, manager_ask: 2, deal_value: 1.5, lead_time: 2, age: 0.5, effort_fit: 1 };
const policy = { id: 'pol_jordan', version: 3, name: 'SE IC (tuned)', role: 'se_ic' as const, weights: weightsV3, rules, updatedAt: t(-7, '10:00'), note: 'Lead time weighted up after the ACME build was late' };
const policyVersions: In['policyVersions'] = [
  { version: 1, at: t(-30, '09:00'), by: 'system', note: 'SE IC starter pack', policy: { ...policy, version: 1, weights: { ...weightsV3, lead_time: 1, manager_ask: 1.5 }, rules: rules.slice(0, 3), updatedAt: t(-30, '09:00'), note: 'SE IC starter pack' } },
  { version: 2, at: t(-14, '09:00'), by: 'user', note: 'Manager asks matter more', policy: { ...policy, version: 2, weights: { ...weightsV3, lead_time: 1 }, rules: rules.slice(0, 4), updatedAt: t(-14, '09:00'), note: 'Manager asks matter more' } },
  { version: 3, at: t(-7, '10:00'), by: 'chat', note: policy.note, policy },
];

const settings: In['settings'] = {
  profile: { version: 1, name: me.name, email: me.email, role: 'se_ic', timezone: 'America/Denver', workingHours: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] }, managerName: P.priya.name },
  policy,
  agentBehavior: {
    version: 2,
    voice: { samples: ['Hi Dana, confirmed for Thursday. Scope below.', 'Quick one: can you send the inventory before our call?'], style: 'Crisp, friendly, no filler; bullets for scope' },
    autonomy: { slack_reply: 'L1', email_reply: 'L1', canvas_rewrite: 'L4', tool_launch: 'L2', claude_session: 'L2', activity_log: 'L3' },
    taskCapture: ['Anything I say I will do', 'Direct asks from customers or my manager', 'Action items assigned to me in meeting notes'],
    watchedSources: ['#team-updates', '#acme-ext', '#globex-deal', '#hooli-ext'],
    drafting: { tone: 'crisp', length: 'short', signoff: 'Jordan' },
  },
  sending: { version: 1, defaultMode: 'draft', dryRun: true, verifyReadback: true, undoWindowSec: 10 },
  budgets: { version: 1, softUsd: 5, hardUsd: 15, alertPct: 80 },
  display: { version: 1, density: 'comfortable', theme: 'lightning', shortcutsEnabled: true, scheme: 'dark', textSize: 16 },
};

// ---------------------------------------------------------------------------
// chat
// ---------------------------------------------------------------------------
const chatThreads: In['chatThreads'] = [
  {
    thread: { id: 'thread_today', title: 'Today', isDefault: true, createdAt: t(0, '07:00'), updatedAt: t(0, '08:59'), messageCount: 3, lastMessagePreview: 'Moved the Globex SOW reply up.' },
    messages: [
      {
        id: 'msg_brief',
        threadId: 'thread_today',
        role: 'assistant',
        at: t(0, '07:00'),
        isMorningBrief: true,
        text: '**Good morning.** Seven meetings today; the big one is the **ACME Phase 2 demo at 13:00**.\n\n1. **Kick off the ACME demo-org build** first: it needs ~1h40m of agent time.\n2. **Reply to Dana** about demo scope (5 min, before 11:00).\n3. **Send Marcus the revised SOW pricing**: you missed the 08:30 pricing sync; I turned its 2 takeaways into tasks.\n\nOvernight I closed 2 items for you and VDP needs re-auth. Briefs: #team-updates has 2 items worth a look.',
        parts: [
          { type: 'resource', resource: { kind: 'brief', id: 'brief_team', label: '#team-updates brief', href: '/briefs?id=brief_team' } },
          { type: 'resource', resource: { kind: 'brief', id: 'brief_opp_globex', label: 'Globex opp brief', href: '/briefs?id=brief_opp_globex' } },
        ],
      },
      { id: 'msg_u1', threadId: 'thread_today', role: 'user', at: t(0, '08:58'), text: 'Globex pricing is more urgent than the one-pager.' },
      { id: 'msg_a1', threadId: 'thread_today', role: 'assistant', at: t(0, '08:59'), text: 'Moved the Globex SOW reply up. The one-pager stays due by 17:00.', parts: [{ type: 'tool', id: 'tool_seed_1', name: 'priority.move', summary: 'Moved "Send Marcus the revised SOW pricing" to #3', ok: true }] },
    ],
  },
  {
    thread: { id: 'thread_hooli', title: 'Hooli NCE scoping', isDefault: false, createdAt: t(-1, '17:50'), updatedAt: t(-1, '18:00'), messageCount: 2, lastMessagePreview: 'Started a research session.' },
    messages: [
      { id: 'msg_h1', threadId: 'thread_hooli', role: 'user', at: t(-1, '17:50'), text: 'Find what we know about Hooli’s retrieval layer.' },
      { id: 'msg_h2', threadId: 'thread_hooli', role: 'assistant', at: t(-1, '18:00'), text: 'Started a research session; it will compare their retrieval layer with NCE.', parts: [{ type: 'resource', resource: { kind: 'agent_run', id: 'run_hooli_research', label: 'Hooli NCE competitive research', href: '/agents?run=run_hooli_research' } }] },
    ],
  },
];

const mappings: In['mappings'] = [
  { id: 'map_falcon', question: 'Is #proj-falcon ACME or Globex?', subject: { type: 'triage_mapping', id: 'C0FALCON', label: '#proj-falcon' }, choices: [{ id: 'c_acme', label: 'ACME Corp', ref: { type: 'account', id: 'acc_acme', label: 'ACME Corp' } }, { id: 'c_globex', label: 'Globex', ref: { type: 'account', id: 'acc_globex', label: 'Globex' } }, { id: 'c_neither', label: 'Neither (internal)', ref: null }], source: { kind: 'slack', label: '#proj-falcon' }, createdAt: t(0, '07:20'), status: 'open' },
  { id: 'map_phase2', question: 'Which opp does "Phase 2 sync" belong to?', subject: { type: 'calendar_event', id: 'ev_phase2_sync', label: 'Phase 2 sync (Fri)' }, choices: [{ id: 'c_p2', label: 'ACME · Headless Phase 2', ref: { type: 'opportunity', id: 'opp_acme_p2', label: 'ACME · Headless Phase 2' } }, { id: 'c_af', label: 'ACME · Agentforce Service', ref: { type: 'opportunity', id: 'opp_acme_af', label: 'ACME · Agentforce Service' } }], source: { kind: 'calendar', label: 'Calendar · Phase 2 sync' }, createdAt: t(0, '06:10'), status: 'open' },
];

// Display-only overnight history (feeds "Since you left").
const audit: In['audit'] = [
  { id: 'aud_hist_1', at: t(0, '07:12'), actor: 'connector', action: 'connector.fail', summary: 'VDP needs re-auth', entity: { type: 'connector', id: 'vdp', label: 'VDP' }, changes: [{ field: 'state', before: 'ok', after: 'auth_needed' }], undoable: false },
  { id: 'aud_hist_2', at: t(0, '07:33'), actor: 'engine', action: 'brief.generate', summary: '3 briefs ready (2 worth a look)', entity: { type: 'brief', id: 'brief_team', label: '#team-updates' }, changes: [], undoable: false },
  { id: 'aud_hist_3', at: t(0, '06:50'), actor: 'engine', action: 'item.reopen', summary: 'Reopened: Fix the ACME demo-data refresh job', entity: { type: 'work_item', id: 'w_acme_refresh', label: 'Fix the ACME demo-data refresh job' }, changes: [{ field: 'state', before: 'done', after: 'reopened' }], undoable: false },
  { id: 'aud_hist_4', at: t(0, '09:00'), actor: 'engine', action: 'nba.revise', summary: 'Globex SOW reply updated from Gemini notes', entity: { type: 'nba', id: 'nba_globex_sow', label: 'Reply-all to Marcus' }, changes: [], undoable: false },
  { id: 'aud_hist_5', at: t(0, '08:20'), actor: 'engine', action: 'run.waiting_on_you', summary: 'Umbrella dataset run needs you', entity: { type: 'agent_run', id: 'run_umbrella_data', label: 'Umbrella demo dataset' }, changes: [], undoable: false },
];

// ---------------------------------------------------------------------------
// scenario (UI-SPEC §15)
// ---------------------------------------------------------------------------
const scenario: In['scenario'] = [
  { id: 'slack-reply-updates-draft', at: 20, label: 'A Slack reply updates NBA #2’s draft', exercises: 'Update strip', actions: [{ op: 'nba_update', nbaId: 'nba_dana', reason: 'Dana replied: "please include pricing next steps"', appendText: 'Raj will share pricing next steps right after the demo.', source: { kind: 'slack', label: '#acme-ext · Dana Reyes' } }] },
  { id: 'session-goes-waiting', at: 40, label: 'The Claude session for card #1 goes waiting', exercises: 'Rail lane + promotion', actions: [{ op: 'run_state', runId: 'run_acme_build', state: 'waiting_on_you', lastEvent: 'Asked: which org alias?', waiting: { reason: 'input needed', question: 'Deploy to acme-phase2 or acme-phase2-backup?' } }] },
  { id: 'email-closes-commitment', at: 60, label: 'An email you sent auto-closes a commitment', exercises: 'Closed for you', actions: [{ op: 'close_item', itemId: 'w_acme_onepager', reason: 'You emailed Dana the one-pager at 09:03', evidence: { kind: 'gmail', label: 'Gmail · sent to Dana Reyes' } }] },
  { id: 'deck-edit-moves-deliverable', at: 80, label: 'A deck edit moves a deliverable to in progress', exercises: 'Drive signal', actions: [{ op: 'engine_patch', itemId: 'w_umbrella_deck', patch: {}, state: 'in_progress', reason: 'You added the FHIR ingestion slide', evidence: { kind: 'drive', label: 'Drive · Umbrella deck edited by you' } }] },
  { id: 'gmail-breaks', at: 100, label: 'The Gmail connector breaks', exercises: 'Banner, stale marks, health dot', actions: [{ op: 'connector_state', connectorId: 'gmail', state: 'auth_needed', error: 'invalid_grant: token expired', impact: 'Email items after 09:04 may be missing' }] },
  { id: 'requirements-reopen-task', at: 120, label: 'New requirements reopen a done task', exercises: 'Reopened', actions: [{ op: 'reopen', itemId: 'w_acme_recap', reason: 'Raj: add the Phase 1 adoption numbers', source: { kind: 'slack', label: 'DM · Raj Mehta' } }] },
  { id: 'rerank-available', at: 140, label: 'A re-rank becomes available', exercises: 'Pill', actions: [{ op: 'rerank_ready', itemId: 'w_initech_prep', boost: 12, reason: 'Peter moved the Initech call to 10:00' }] },
  { id: 'looped-back-in', at: 160, label: 'A handed-off item gets a direct ask', exercises: 'Looped back in (R-UI-22)', actions: [{ op: 'loop_back', itemId: 'w_initech_security', byPersonName: 'Peter Gibbons', reason: 'Peter: "Jordan, can you answer Q14 on data residency yourself?"', source: { kind: 'gmail', label: 'Gmail · Peter Gibbons' } }] },
];

// ---------------------------------------------------------------------------
const seedInput: In = {
  meta: {
    schemaVersion: 1,
    label: 'placeholder example (ACME, Globex, Initech, Umbrella, Hooli)',
    asOf: NOW,
    lastActiveAt: t(-1, '18:40'),
    timezone: 'America/Denver',
    user: me,
    quarter: { label: 'Q4 FY27', targetH: 60, due: t(1, '12:00'), loggedH: 9.5 },
    canvas: { label: 'Work-order canvas', lastSyncedAt: t(-1, '17:30'), rowsChangedSince: 0 },
  },
  people,
  accounts,
  opps,
  missedOpps,
  initiatives,
  workItems,
  evidence,
  nbas,
  drafts,
  proposals,
  assets,
  calendar: { events, slots },
  agentRuns,
  toolAdapters,
  toolRuns,
  activity,
  timeBlocks,
  briefs,
  watches,
  connectors,
  scanRuns,
  jobs,
  eventLog,
  spend,
  settings,
  policyVersions,
  chatThreads,
  mappings,
  audit,
  scenario,
};

const parsed = Seed.safeParse(seedInput);
if (!parsed.success) {
  console.error(parsed.error.issues.slice(0, 20));
  process.exit(1);
}
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/mock/seed.example.json');
writeFileSync(out, JSON.stringify(parsed.data, null, 2) + '\n');
console.log(`wrote ${out} (${parsed.data.workItems.length} work items, ${parsed.data.calendar.events.length} events, ${parsed.data.agentRuns.length} runs)`);
