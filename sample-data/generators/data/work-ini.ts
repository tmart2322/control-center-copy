/** Domain 04: initiatives, initiative links, work item links and relations. */
import { OWNER, ref, sha, uid } from '../../lib/kit';
import type { Row } from '../../lib/kit';
import type { Built } from './work-core';
import { iniOf } from './work-core';
import { DELIVS } from './work-deliv';
import { assetId, calId, calRow, exId, llmNear, mt, plus, ms, wiId, wiKey } from './work-lib';

type LinkT = ['p' | 'a' | 'c' | 'ch' | 'o' | 'r' | 's', string, 'stakeholder' | 'asset' | 'working_session' | 'milestone_meeting' | 'channel' | 'related_opportunity' | 'repo', 'connector' | 'rule' | 'llm' | 'user' | 'chat', number];
interface Ini { key: string; title: string; purpose: string; summary: string | null; status: 'proposed' | 'active' | 'paused' | 'completed' | 'abandoned'; a?: string; o?: string; ev?: string; target?: string; by: 'user' | 'engine' | 'chat' | 'system'; conf: number; created: string; links: LinkT[]; archived?: string }

export const INIS: Ini[] = [
  { key: 'hv-blueprint', title: 'Saltmere POC: solution blueprint and demo for the architecture board', purpose: 'Get the member services POC through the board go/no-go: blueprint by Friday 11/20, demo with the denied-claim handoff, identity and security answers in writing.', summary: 'The blueprint is the gating item (board packet closes 11/24, board moved to Dec 1). Sections 1-5 and 9 are drafted; rollout plan, the architecture diagram and the IdP group mapping are open. The demo script has the denied-claim scene and the demo org is being loaded with the scrubbed export.', status: 'active', a: 'saltmere', o: 'saltmere-data360-poc', ev: 'hv-dryrun', target: '11-20 17:00', by: 'engine', conf: 0.92, created: '11-10 13:40',
    links: [['p', 'hv-marisol', 'stakeholder', 'llm', 0.95], ['p', 'hv-priyanka', 'stakeholder', 'llm', 0.95], ['p', 'hv-soojin', 'stakeholder', 'llm', 0.93], ['p', 'ae-harbor', 'stakeholder', 'rule', 0.9], ['p', 'spec-gustavo', 'stakeholder', 'rule', 0.9], ['a', 'hv-blueprint', 'asset', 'connector', 1], ['a', 'hv-success', 'asset', 'connector', 1], ['a', 'hv-demo-script', 'asset', 'llm', 0.9], ['a', 'hv-demo-org', 'asset', 'llm', 0.7],
      ['c', 'hv-dryrun', 'milestone_meeting', 'rule', 0.9], ['c', 'hv-sync-p1', 'working_session', 'rule', 0.85], ['c', 'focus-hv-blueprint-p2', 'working_session', 'user', 1], ['ch', 'saltmere-poc', 'channel', 'rule', 1], ['ch', 'saltmere-team', 'channel', 'rule', 1], ['o', 'saltmere-data360-poc', 'related_opportunity', 'rule', 1], ['r', 'saltmere-poc-demo', 'repo', 'rule', 0.9], ['s', 'cs-03', 'working_session', 'connector', 0.8], ['s', 'cs-04', 'working_session', 'connector', 0.8], ['s', 'cs-08', 'working_session', 'connector', 0.85], ['s', 'cs-11', 'working_session', 'connector', 0.7]] },
  { key: 'hv-security', title: 'Saltmere vendor security review (due 11/24)', purpose: 'Answer the vendor security questionnaire (SOC summary, POC data isolation, residency addendum) without blocking the blueprint.', summary: 'Questionnaire arrived 11/17; the sheet cannot be read yet (permission denied). Walkthrough with Soo-jin is booked for 11/25.', status: 'active', a: 'saltmere', o: 'saltmere-data360-poc', ev: 'hv-security', target: '11-24 12:00', by: 'engine', conf: 0.8, created: '11-18 08:12',
    links: [['p', 'hv-soojin', 'stakeholder', 'llm', 0.9], ['p', 'hv-priyanka', 'stakeholder', 'llm', 0.7], ['a', 'hv-sec-q', 'asset', 'connector', 1], ['c', 'hv-security', 'milestone_meeting', 'rule', 0.9], ['ch', 'saltmere-poc', 'channel', 'rule', 1]] },
  { key: 'hv-exec-readout', title: 'Saltmere executive readout (Dec 3, 10:00 MT)', purpose: 'Prepare the December readout for Priyanka\'s leadership, including the CIO preview Gareth asked for.', summary: 'Outline done; Theo is drafting the deck. The 30-minute CIO preview still needs a slot.', status: 'active', a: 'saltmere', o: 'saltmere-data360-poc', target: '12-03 10:00', by: 'engine', conf: 0.72, created: '11-06 19:45',
    links: [['p', 'hv-priyanka', 'stakeholder', 'llm', 0.9], ['p', 'hv-gareth', 'stakeholder', 'llm', 0.85], ['p', 'dir-beatrix', 'stakeholder', 'rule', 0.7], ['a', 'hv-exec-deck', 'asset', 'connector', 0.9], ['a', 'hv-talk', 'asset', 'connector', 0.9], ['c', 'hv-execprep', 'milestone_meeting', 'rule', 0.8], ['c', 'hv-readout-outline', 'working_session', 'rule', 0.8]] },
  { key: 'to-demo', title: 'Elderglen Outdoors: order-status demo to unblock the renewal', purpose: 'Brendan wants to see split-shipment tracking before signing the $780k renewal plus Agentforce expansion; target signature before 11/30.', summary: 'Deal desk approval cleared 11/17. Nadia is waiting on a confirmed time (Brendan prefers Thursday morning). The OMS sandbox is live (read-only, refunds not exposed); the deck has split shipments, partial refunds and the OMS slide.', status: 'active', a: 'elderglen-outdoors', o: 'elderglen-outdoors-renewal-expansion', ev: 'to-demo', target: '11-19 10:00', by: 'engine', conf: 0.9, created: '11-09 15:55',
    links: [['p', 'to-brendan', 'stakeholder', 'llm', 0.95], ['p', 'to-meiling', 'stakeholder', 'llm', 0.9], ['p', 'ae-commercial', 'stakeholder', 'rule', 0.9], ['a', 'to-demo', 'asset', 'connector', 1], ['a', 'to-oms', 'asset', 'llm', 0.8], ['a', 'to-faq', 'asset', 'llm', 0.7], ['c', 'to-demo', 'milestone_meeting', 'rule', 0.9], ['c', 'to-demoprep', 'working_session', 'rule', 0.9], ['ch', 'elderglen-outdoors-deal', 'channel', 'rule', 1], ['o', 'elderglen-outdoors-renewal-expansion', 'related_opportunity', 'rule', 1], ['r', 'shared-demo-kit', 'repo', 'rule', 0.8], ['s', 'cs-07', 'working_session', 'connector', 0.85]] },
  { key: 'cc-onsite', title: 'Cascadia County onsite workshop (Nov 23-24)', purpose: 'Two-day onsite for the citizen services assistant: agenda, travel, badges and the county CIO readout on day 2.', summary: 'Travel is booked (flight and hotel confirmations arrived 11/17); agenda has three revisions, still missing the Tuesday county CIO slot. Samir asked for a second SE; Gustavo is available.', status: 'active', a: 'cascadia', o: 'cascadia-citizen-assistant', ev: 'cc-onsite1', target: '11-23 08:00', by: 'engine', conf: 0.9, created: '11-05 14:10',
    links: [['p', 'cc-samir', 'stakeholder', 'llm', 0.95], ['p', 'cc-noor', 'stakeholder', 'llm', 0.7], ['p', 'cc-dolores', 'stakeholder', 'llm', 0.7], ['a', 'cc-agenda', 'asset', 'connector', 1], ['a', 'cc-logistics', 'asset', 'llm', 0.8], ['c', 'cc-onsite1', 'milestone_meeting', 'rule', 1], ['c', 'cc-onsite2', 'milestone_meeting', 'rule', 1], ['c', 'cc-prep', 'working_session', 'rule', 0.9], ['ch', 'cascadia-onsite', 'channel', 'rule', 1], ['o', 'cascadia-citizen-assistant', 'related_opportunity', 'rule', 1]] },
  { key: 'ns-recovery', title: 'Halvergate route exceptions: recover a quiet deal', purpose: 'Close date passed, no customer reply since 10/25, budget freeze rumored. Nadia asked for a light value recap.', summary: 'Two nudges unanswered; the value recap draft exists but has not been sent. The engine suggests asking whether to keep chasing (gone quiet).', status: 'active', a: 'halvergate', o: 'halvergate-route-exceptions-agent', by: 'engine', conf: 0.78, created: '10-28 15:30',
    links: [['p', 'ns-anjali', 'stakeholder', 'llm', 0.95], ['p', 'ae-commercial', 'stakeholder', 'rule', 0.9], ['a', 'ns-proposal', 'asset', 'connector', 1], ['a', 'ns-recap', 'asset', 'connector', 0.9], ['c', 'ns-checkin', 'milestone_meeting', 'rule', 0.8], ['ch', 'halvergate-freight', 'channel', 'rule', 1], ['o', 'halvergate-route-exceptions-agent', 'related_opportunity', 'rule', 1]] },
  { key: 'pc-order', title: 'Oakhallow claims triage agent: order form to signature', purpose: 'Get the technical addendum (section 3, support and service levels) agreed so Oakhallow legal can send the order form.', summary: 'Section 3 redline went to Valentina on 11/17; legal then asked for severity 2 response times in the body and proposes signing next week. Order form call is today 14:30.', status: 'active', a: 'oakhallow', o: 'oakhallow-claims-agent', ev: 'pc-order', target: '11-18 14:30', by: 'engine', conf: 0.88, created: '11-12 10:55',
    links: [['p', 'pc-valentina', 'stakeholder', 'llm', 0.95], ['p', 'pc-corwin', 'stakeholder', 'llm', 0.8], ['p', 'ae-harbor', 'stakeholder', 'rule', 0.9], ['a', 'pc-order-form', 'asset', 'connector', 1], ['c', 'pc-order', 'milestone_meeting', 'rule', 1], ['o', 'oakhallow-claims-agent', 'related_opportunity', 'rule', 1]] },
  { key: 'aw-phases', title: 'Yarrowdale data foundation: phases for the budget review', purpose: 'Give Constance a non-technical phases view and make the Behavioral Health trust domain explicit before the budget review.', summary: 'The one-pager went to Constance and Lars; the proposal has the BH trust domain and Gustavo\'s Phase 2 buffer. Left: intro call with the data team.', status: 'active', a: 'yarrowdale', o: 'yarrowdale-enterprise-data', by: 'engine', conf: 0.82, created: '11-04 08:20',
    links: [['p', 'aw-constance', 'stakeholder', 'llm', 0.9], ['p', 'aw-lars', 'stakeholder', 'llm', 0.95], ['p', 'spec-gustavo', 'stakeholder', 'rule', 0.9], ['a', 'aw-proposal', 'asset', 'connector', 1], ['a', 'aw-arch', 'asset', 'llm', 0.7], ['c', 'aw-arch-p5', 'working_session', 'rule', 0.7], ['ch', 'yarrowdale-team', 'channel', 'rule', 0.9], ['o', 'yarrowdale-enterprise-data', 'related_opportunity', 'rule', 1]] },
  { key: 'qp-arch', title: 'Ferrowpay fraud agent: architecture session with the analysts (Thu 2pm)', purpose: 'Start from the fraud analyst workflow, use the real cases the analysts bring, and finish the summary prompts for the demo.', summary: 'Session agreed for Thursday 14:00 (Theo confirmed 11/17). Linnea\'s dry run is today 13:00. Case summary prompts session is paused waiting for a format choice.', status: 'active', a: 'ferrowpay', o: 'ferrowpay-fraud-agent', ev: 'qp-arch-session', target: '11-19 14:00', by: 'engine', conf: 0.86, created: '11-16 21:30',
    links: [['p', 'qp-folasade', 'stakeholder', 'llm', 0.95], ['p', 'qp-renata', 'stakeholder', 'llm', 0.8], ['p', 'se-linnea', 'stakeholder', 'rule', 0.85], ['a', 'qp-arch', 'asset', 'connector', 1], ['a', 'qp-demo', 'asset', 'llm', 0.8], ['c', 'qp-arch-session', 'milestone_meeting', 'rule', 1], ['c', 'qp-dry', 'working_session', 'rule', 0.9], ['ch', 'ferrowpay-pursuit', 'channel', 'rule', 1], ['r', 'ferrowpay-fraud-agent', 'repo', 'rule', 0.95], ['s', 'cs-05', 'working_session', 'connector', 0.7], ['s', 'cs-06', 'working_session', 'connector', 0.9]] },
  { key: 'bw-dc', title: 'Harrowgate maintenance agent: get credit for the demos', purpose: 'Two demos and the plant dashboards were mine but I am not on the opportunity team; claim a deal contribution.', summary: null, status: 'proposed', a: 'harrowgate', o: 'harrowgate-maintenance-agent', by: 'engine', conf: 0.6, created: '11-13 08:10',
    links: [['p', 'ae-commercial', 'stakeholder', 'llm', 0.8], ['p', 'bw-zainab', 'stakeholder', 'llm', 0.8], ['a', 'bw-demo', 'asset', 'connector', 1], ['c', 'bw-demo1', 'milestone_meeting', 'rule', 1], ['c', 'bw-demo2', 'milestone_meeting', 'rule', 1], ['s', 'cs-01', 'working_session', 'connector', 0.8], ['s', 'cs-02', 'working_session', 'connector', 0.8], ['o', 'harrowgate-maintenance-agent', 'related_opportunity', 'rule', 1]] },
  { key: 'admin-q4', title: 'Q4 admin: weekly logging, training and VDP hygiene', purpose: 'Recurring obligations from the team pack: weekly Org62 log, mandatory training, monthly VDP review, quarter deadline.', summary: 'Weekly logs are current through 11/13. Privacy refresh is at 40% and due Saturday.', status: 'active', by: 'system', conf: 1, created: '10-19 06:30',
    links: [['a', 'se-weeklylog', 'asset', 'llm', 0.8], ['a', 'se-privacy', 'asset', 'connector', 0.9], ['c', 'weekly-log-p2', 'working_session', 'rule', 0.9], ['c', 'training-hold', 'working_session', 'rule', 0.9]] },
  { key: 'lg-discovery', title: 'Voltmere: time-to-restore discovery', purpose: 'Watched account; Linnea runs the discovery. Not my work.', summary: null, status: 'abandoned', a: 'voltmere', o: 'voltmere-outage-insights', by: 'engine', conf: 0.5, created: '11-02 10:00', archived: '11-13 11:10',
    links: [['p', 'lg-petra', 'stakeholder', 'llm', 0.8], ['o', 'voltmere-outage-insights', 'related_opportunity', 'rule', 1]] },
];

export function buildInitiatives(built: Built[]): { initiatives: Row[]; links: Row[] } {
  const initiatives: Row[] = []; const links: Row[] = [];
  for (const i of INIS) {
    const id = uid('initiatives', i.key);
    const members = built.filter((b) => iniOf(b.spec) === i.key);
    const created = mt(i.created);
    const sumAt = i.summary ? plus(mt('11-18 08:56'), 0, 0) : null;
    initiatives.push({
      id, owner_user_id: OWNER, title: i.title, purpose: i.purpose, background_summary: i.summary, summary_generated_at: sumAt, summary_inputs_hash: i.summary ? sha(members.map((m) => m.key + m.row.updated_at).join('|')) : null,
      summary_llm_call_id: i.summary ? llmNear('summarize', 'brief-opportunity', sumAt!, 24 * 60 * 20) : null, status: i.status, account_id: i.a ? uid('accounts', i.a) : null, opportunity_id: i.o ? uid('opportunities', i.o) : null,
      target_event_id: i.ev ? calId(i.ev) : null, target_at: i.target ? mt(i.target) : null, created_by: i.by, confidence: i.conf, user_locked_fields: [], version: 1 + (i.status === 'active' ? 2 : 0),
      completed_at: null, archived_at: i.archived ? mt(i.archived) : null, created_at: created, updated_at: i.archived ? mt(i.archived) : members.length ? members.map((m) => m.row.updated_at as string).reduce((a, b2) => (ms(a) > ms(b2) ? a : b2)) : created,
    });
    for (const [t, key, role, method, conf] of i.links) {
      const r: Row = { id: uid('initiative_links', `${i.key}:${t}:${key}`), initiative_id: id, person_id: null, asset_id: null, claude_session_id: null, calendar_event_id: null, channel_id: null, opportunity_id: null, repo_id: null, role, method, confidence: conf, user_verdict: null, created_at: plus(created, 2, 5) };
      if (t === 'p') r.person_id = uid('people', key); else if (t === 'a') r.asset_id = assetId(key); else if (t === 'c') r.calendar_event_id = calId(key); else if (t === 'ch') r.channel_id = uid('channels', key); else if (t === 'o') r.opportunity_id = uid('opportunities', key); else if (t === 'r') r.repo_id = uid('repos', key);
      else r.claude_session_id = ref('claude_sessions', key, `Claude session ${key} (CAST-sources claude_sessions list); linked to initiative ${i.key} and to work items`);
      if (['hv-blueprint', 'to-demo'].includes(i.key) && t === 'a' && key === (i.key === 'hv-blueprint' ? 'hv-demo-script' : 'to-oms')) r.user_verdict = 'confirmed';
      links.push(r);
    }
  }
  return { initiatives, links };
}

// ── work item links ──────────────────────────────────────────────────────────────────────────────
const MORE_PEOPLE: Record<number, string[]> = { 3: ['hv-marisol', 'hv-soojin', 'spec-gustavo', 'ae-harbor'], 31: ['to-brendan', 'to-meiling'], 60: ['ae-harbor', 'pc-corwin'], 53: ['cc-noor', 'spec-gustavo'], 32: ['to-meiling', 'ae-commercial'], 66: ['se-linnea', 'qp-renata'], 49: ['se-tariq', 'bw-zainab'], 8: ['ae-commercial'], 42: ['ae-commercial'], 21: ['mgr'], 75: ['spec-gustavo', 'ae-harbor'], 76: ['spec-gustavo'], 54: ['hv-mari-dup'], 101: ['hv-marisol'], 41: [], 18: ['hv-priyanka'] };
const SESSIONS: Record<number, string[]> = { 20: ['cs-04', 'cs-11'], 25: ['cs-04'], 16: ['cs-08'], 3: ['cs-08'], 32: ['cs-07'], 50: ['cs-02'], 49: ['cs-01', 'cs-02'], 47: ['cs-01'], 73: ['cs-06'], 66: ['cs-05', 'cs-06'], 15: ['cs-11'] };
const REPOS: Record<number, string[]> = { 20: ['saltmere-poc-demo'], 25: ['saltmere-poc-demo'], 16: ['saltmere-poc-demo'], 32: ['shared-demo-kit'], 50: ['shared-demo-kit'], 73: ['ferrowpay-fraud-agent'], 66: ['ferrowpay-fraud-agent'], 49: ['shared-demo-kit'] };
export function buildLinks(built: Built[]): Row[] {
  const out: Row[] = [];
  const seen = new Set<string>();
  const add = (n: number, kind: 'person_id' | 'asset_id' | 'claude_session_id' | 'calendar_event_id' | 'repo_id' | 'tool_run_id', val: string, role: string, conf: number, ex: string, verdict: string | null = null) => {
    const k = `${n}|${kind}|${val}|${role}`; if (seen.has(k)) return; seen.add(k);
    const b = built.find((x) => x.spec.n === n)!;
    out.push({ id: uid('work_item_links', k), work_item_id: b.id, person_id: null, asset_id: null, claude_session_id: null, calendar_event_id: null, repo_id: null, tool_run_id: null, [kind]: val, role, confidence: conf, extractor_id: exId(ex), user_verdict: verdict, created_at: plus(b.created, 2, 30) });
  };
  for (const b of built) {
    const s = b.spec;
    if (s.cp) add(s.n, 'person_id', uid('people', s.cp), 'stakeholder', s.cp === 'hv-mari-dup' ? 0.6 : 0.92, s.og === 'manual' ? 'user-manual:1' : 'link-resolver:1');
    for (const p of MORE_PEOPLE[s.n] ?? []) add(s.n, 'person_id', uid('people', p), 'stakeholder', 0.8, 'link-resolver:1');
    if (s.n === 54) add(s.n, 'person_id', uid('people', 'hv-marisol'), 'stakeholder', 0.97, 'identity-detect:1', 'confirmed');
    for (const sess of SESSIONS[s.n] ?? []) add(s.n, 'claude_session_id', ref('claude_sessions', sess, `Claude session ${sess} (CAST-sources claude_sessions list) linked to work items as a working session`), 'working_session', 0.85, 'scan-claude-sessions:2');
    for (const r of REPOS[s.n] ?? []) add(s.n, 'repo_id', uid('repos', r), 'related', 0.8, 'link-resolver:1');
    if (s.deadlineEvent) {
      const ev = calRow(s.deadlineEvent);
      add(s.n, 'calendar_event_id', calId(s.deadlineEvent), String(ev.event_type) === 'focus_time' || String(ev.title).startsWith('Prep') ? 'prep_for' : 'related', 0.85, 'scan-calendar:2');
    }
    if (s.k === 'missed_meeting_followup' || s.n === 59) { const e = s.ev![0]![0].replace('cal:', ''); add(s.n, 'calendar_event_id', calId(e), 'missed_meeting', 0.9, 'scan-calendar:2'); }
    if (s.n === 51) { add(s.n, 'calendar_event_id', calId('cc-travel-out'), 'related', 0.85, 'scan-calendar:2'); add(s.n, 'calendar_event_id', calId('cc-travel-back'), 'related', 0.85, 'scan-calendar:2'); add(s.n, 'calendar_event_id', calId('cc-onsite1'), 'prep_for', 0.8, 'scan-calendar:2'); }
    if (s.n === 53) { add(s.n, 'calendar_event_id', calId('cc-onsite1'), 'prep_for', 0.9, 'scan-calendar:2'); add(s.n, 'calendar_event_id', calId('cc-prep'), 'prep_for', 0.85, 'scan-calendar:2'); }
    if (s.n === 29) add(s.n, 'calendar_event_id', calId('focus-hv-blueprint-p2'), 'related', 0.7, 'scan-calendar:2');
    if (s.n === 21) { add(s.n, 'calendar_event_id', calId('training-hold'), 'prep_for', 0.9, 'scan-calendar:2'); add(s.n, 'asset_id', assetId('se-privacy'), 'related', 0.8, 'scan-drive:1'); }
    if (s.n === 90) add(s.n, 'calendar_event_id', calId('weekly-log-p2'), 'prep_for', 0.9, 'scan-calendar:2');
    if (s.n === 93) add(s.n, 'calendar_event_id', calId('se-sync-p0'), 'prep_for', 0.9, 'scan-calendar:2');
    if (s.n === 61) add(s.n, 'calendar_event_id', calId('pc-order'), 'prep_for', 0.9, 'scan-calendar:2');
    if (s.n === 105) add(s.n, 'calendar_event_id', calId('to-demoprep'), 'prep_for', 0.85, 'scan-calendar:2');
    if (s.n === 66) { add(s.n, 'calendar_event_id', calId('qp-arch-session'), 'prep_for', 0.95, 'scan-calendar:2'); add(s.n, 'calendar_event_id', calId('qp-dry'), 'working_session', 0.8, 'scan-calendar:2'); }
    if (s.n === 33) add(s.n, 'calendar_event_id', calId('hv-pricing'), 'prep_for', 0.9, 'scan-calendar:2');
    if (s.n === 48 || s.n === 102) add(s.n, 'calendar_event_id', calId('bw-demo2'), 'prep_for', 0.9, 'scan-calendar:2');
    if (s.n === 47) add(s.n, 'calendar_event_id', calId('bw-demo1'), 'prep_for', 0.9, 'scan-calendar:2');
  }
  for (const d of DELIVS) if (d.tag) add(d.n, 'asset_id', assetId(d.tag), 'deliverable', 0.95, 'scan-drive:1');
  // a few assets that are context for a work item
  add(7, 'asset_id', assetId('hv-sizing'), 'related', 0.8, 'link-resolver:1'); add(9, 'asset_id', assetId('se-flex'), 'deliverable', 0.8, 'link-resolver:1'); add(8, 'asset_id', assetId('ns-proposal'), 'related', 0.9, 'scan-drive:1'); add(91, 'asset_id', assetId('se-zerocopy'), 'deliverable', 0.9, 'link-resolver:1'); add(36, 'asset_id', assetId('to-faq'), 'deliverable', 0.75, 'link-resolver:1');
  add(27, 'asset_id', assetId('hv-blueprint'), 'related', 0.7, 'link-resolver:1'); add(27, 'asset_id', assetId('hv-success'), 'related', 0.7, 'link-resolver:1'); add(72, 'asset_id', assetId('qp-arch'), 'deliverable', 0.8, 'link-resolver:1'); add(37, 'asset_id', assetId('to-demo'), 'deliverable', 0.8, 'link-resolver:1');
  add(77, 'asset_id', assetId('aw-proposal'), 'deliverable', 0.9, 'scan-drive:1'); add(75, 'asset_id', assetId('aw-proposal'), 'related', 0.7, 'link-resolver:1'); add(83, 'asset_id', assetId('se-planning'), 'deliverable', 0.85, 'link-resolver:1'); add(84, 'asset_id', assetId('se-weeklylog'), 'related', 0.6, 'link-resolver:1');
  return out;
}

// ── relations ────────────────────────────────────────────────────────────────────────────────────
const REL: Array<[number, number, 'blocks' | 'related' | 'duplicate_of' | 'follow_up_of', 'engine' | 'user' | 'chat']> = [
  [11, 6, 'duplicate_of', 'engine'], [12, 3, 'duplicate_of', 'engine'], [76, 75, 'duplicate_of', 'engine'], [101, 54, 'duplicate_of', 'engine'],
  [15, 3, 'blocks', 'engine'], [39, 3, 'blocks', 'engine'], [99, 3, 'blocks', 'engine'], [6, 3, 'blocks', 'engine'], [13, 3, 'related', 'engine'], [14, 3, 'related', 'engine'], [18, 3, 'related', 'engine'], [29, 3, 'related', 'engine'], [15, 29, 'blocks', 'user'],
  [20, 16, 'blocks', 'engine'], [25, 20, 'blocks', 'engine'], [11, 4, 'follow_up_of', 'engine'], [14, 24, 'follow_up_of', 'engine'], [75, 79, 'follow_up_of', 'engine'],
  [105, 32, 'blocks', 'engine'], [34, 105, 'blocks', 'engine'], [32, 31, 'blocks', 'engine'], [36, 35, 'follow_up_of', 'engine'],
  [42, 8, 'follow_up_of', 'engine'], [44, 8, 'related', 'engine'], [43, 8, 'related', 'engine'], [49, 48, 'related', 'engine'], [50, 48, 'blocks', 'engine'], [47, 49, 'related', 'engine'], [102, 48, 'related', 'engine'], [46, 48, 'follow_up_of', 'engine'],
  [51, 53, 'related', 'engine'], [52, 51, 'follow_up_of', 'engine'], [55, 53, 'blocks', 'engine'], [56, 53, 'related', 'engine'], [58, 53, 'blocks', 'engine'],
  [61, 60, 'related', 'engine'], [64, 61, 'follow_up_of', 'engine'], [66, 65, 'follow_up_of', 'engine'], [73, 66, 'blocks', 'engine'], [103, 66, 'blocks', 'engine'], [68, 67, 'related', 'engine'],
  [77, 88, 'related', 'engine'], [78, 77, 'related', 'engine'], [22, 23, 'related', 'engine'], [28, 23, 'related', 'engine'], [19, 100, 'related', 'engine'], [10, 4, 'related', 'engine'],
];
export function buildRelations(built: Built[]): Row[] {
  const idOf = new Map(built.map((b) => [b.spec.n, b]));
  return REL.map(([f, t, kind, by]) => {
    const a = idOf.get(f)!; const b = idOf.get(t)!;
    const at = plus(ms(a.created) > ms(b.created) ? a.created : b.created, 3, 20);
    return { id: uid('work_item_relations', `${wiKey(f)}>${wiKey(t)}:${kind}`), from_work_item_id: a.id, to_work_item_id: b.id, kind, created_by: by, created_at: at };
  });
}
export { wiId };
