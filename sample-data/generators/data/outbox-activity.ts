/** Activity entries (time logging, storylines 7, 19, 5): derived from Org62 events, the calendar and Claude/Drive evidence. */
import { OWNER, readTable, rng, uid } from '../../lib/kit';
import type { Row } from '../../lib/kit';
import { T, mtLabel, plusMin, oppSf, acctSf, acctOfOpp, sha } from './outbox-lib';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const CAL = 'rafael.okonkwo@example.com';

export type ES = {
  key: string; origin: 'calendar' | 'evidence' | 'build_estimate' | 'manual' | 'chat' | 'legacy_recreate' | 'duration_backfill';
  status: string; ev?: string; tag?: string; subject?: string; start?: string; end?: string; hours?: number; task?: string; mt?: string | null; opp?: string; acct?: string; desc?: string;
  cf?: boolean; cr?: boolean; remote?: boolean; conf?: number; reason?: string; flags?: string[]; excl?: string; created?: string; ap?: string; apm?: 'click' | 'keyboard' | 'chat_confirm';
  canvas?: string; logged?: string; verified?: string; issue?: string; op?: 'create' | 'update' | 'delete'; target?: string; locked?: string[]; ver?: number; seg?: string; docKey?: string; sessionKey?: string; blockKeys?: string[]; neverBlocks?: boolean;
};

const DESC: Array<[RegExp, string[]]> = [
  [/POC kickoff/, ['Kickoff with the Saltmere sponsors: scope, success criteria owners and the demo timeline.']],
  [/data foundation kickoff/, ['Kickoff for the enterprise data foundation: three phases, EHR landscape and who owns identity.']],
  [/renewal kickoff/, ['Renewal kickoff: usage story, expansion scope and what the AE needs from the SE.']],
  [/weekly sync/, ['Weekly sync: status of the claims-status scenario and open questions on identity.', 'Weekly sync: SSO groups, synthetic member set and the demo date.', 'Weekly sync: blueprint outline review and the contact-center export.', 'Weekly sync: demo feedback and blueprint dependencies.', 'Weekly sync: KPI baselines and the readout date.']],
  [/data model workshop/, ['Two-hour workshop on the member key, the unified profile and the first scenario.']],
  [/proposal walkthrough/, ['Walked the route exceptions proposal with the director of network planning.']],
  [/1:1 with Hana/, ['1:1 with my manager: pipeline coverage, blueprint week and development plan.']],
  [/pilot retro/, ['Retro on the Agentforce pilot with the sponsor and IT architecture; next steps for the claims agent.']],
  [/architecture review/, ['Architecture review with the customer data team: EHR instances, identity and consent boundaries.']],
  [/identity design notes/, ['Wrote up the member identity design: keys, match rules and the consent model.']],
  [/demo prep/, ['Prepared the predictive maintenance demo: sample plant data, topics and the deck.']],
  [/predictive maintenance demo/, ['Demoed the predictive maintenance agent to the reliability lead and plant engineers.']],
  [/pursuit sync/, ['Weekly pursuit sync with the AE and the fraud analytics lead.']],
  [/renewal sync/, ['Renewal sync with the VP of eCommerce: timing for the order-status demo.']],
  [/SE team sync/, ['SE team sync: pipeline coverage and shared kit updates.']],
  [/negotiation sync/, ['Negotiation sync: order form open items and technical sign-off on the addendum.']],
  [/validation working session/, ['Working session on personalization validation: placements, test dataset and success metrics.']],
  [/discovery/, ['Discovery with the practice operations team: patient access pain points and data sources.']],
  [/identity resolution discovery/, ['Discovery on enterprise identity resolution across the retail group brands.']],
  [/production pricing/, ['Walked the production consumption pricing for the unified profile with the VP.']],
  [/proposal review/, ['Reviewed the Data 360 foundation proposal and the consumption model with the customer.']],
  [/technical validation kickoff/, ['Kickoff of the technical validation: scope, environment access and weekly cadence.']],
  [/executive readout prep/, ['Prepared the executive readout storyline with the AE and the specialist.']],
  [/readout outline/, ['Outlined the December executive readout: story, proof points and the ask.']],
  [/workshop agenda review/, ['Reviewed the onsite workshop agenda with the county digital services manager.']],
  [/plant managers demo/, ['Demoed the maintenance agent and plant dashboards to the plant managers.']],
  [/claims status demo/, ['Claims status demo for the contact-center leads; captured the denied-claim request.']],
  [/intake triage intro/, ['Intro to the intake triage idea with the program lead and the Yarrowdale sponsor.']],
  [/architecture sizing notes/, ['Wrote up the consumption sizing assumptions for the fraud and foundation scope.']],
  [/claims status topic/, ['Built the claims status topic and the denied-claim handoff flow in the demo org with Claude.']],
  [/synthetic member loader/, ['Wrote the loader that seeds the demo org with synthetic members and checked the record counts.']],
  [/schema mapping to DMOs/, ['Mapped the transaction schema to DMOs, including the self-referencing merchant hierarchy.']],
  [/fraud case summary prompts/, ['Iterated the case summary prompt against ten synthetic fraud cases.']],
  [/loader refactor/, ['Refactored the demo org loader so it takes the scrubbed export in one run.']],
  [/blueprint section 6/, ['Drafted blueprint section 6 (data model) from the demo org metadata.']],
  [/denied-claim scenario/, ['Started the denied-claim topic with a plain-language explanation of the denial reason.']],
  [/order status skill/i, ['Built the order-status skill against a mock of the OMS shape; split shipments work, refunds hand off.']],
  [/demo build \(Elderglen\)|Prep: order status demo/, ['Built and rehearsed the order-status demo: split shipment and the partial refund handoff.']],
  [/maintenance demo build|maintenance agent topics/, ['Built the failure prediction topic and a work order action over synthetic sensor data.']],
  [/plant dashboards/, ['Added per-plant dashboard definitions and scaled the sample data to five plants.']],
  [/agenda draft|Prep: Cascadia onsite/, ['Drafted the two-day onsite workshop agenda and the data inventory block.']],
  [/demo script \(estimated/, ['Edited the member services demo script (time estimated from the document revisions).']],
  [/proposal slides \(estimated/, ['Edited the phases and trust-domain slides of the proposal (time estimated from the revisions).']],
  [/slides for the staff call/, ['Prepared three slides for the regional staff call: the problem, what the POC proves, what we need.']],
  [/value recap one-pager/, ['Wrote a one-page value recap for the route exceptions agent.']],
  [/blueprint writing|solution blueprint|Focus: finish and send blueprint|blueprint sections/, ['Wrote and revised blueprint sections: data model, rollout plan and the consumption model.']],
  [/Dry run/i, ['Dry run of the session with the SE team: timing, handoffs and the open questions.']],
  [/architecture session with fraud analysts|architecture session/i, ['Architecture session with the fraud analysts: a real case end to end, where the agent helps and where a person decides.']],
  [/order status demo/i, ['Order-status demo for the VP of eCommerce and the CRM platform lead.']],
  [/onsite workshop day/i, ['Onsite workshop with the county digital services team.']],
  [/Travel/i, ['Travel for the onsite workshop.']],
  [/Training/i, ['Mandatory training: Data Handling and Privacy Refresh.']],
  [/office hours/i, ['Data 360 office hours with the specialist.']],
  [/debrief/i, ['Debrief with the AE after the weekly sync: next steps and risks.']],
  [/referral/i, ['Decision call on the referral agent.']],
  [/demo prep/i, ['Prepared the predictive maintenance demo: sample plant data, topics and the deck.']],
];
export const descOf = (subject: string, i = 0) => { for (const [re, ds] of DESC) if (re.test(subject)) return ds[i % ds.length]!; return `${subject}.`; };

type Maps = { opp: Map<string, Row>; ttId: (n: string) => string; mtId: (m: string) => string; fp: (iso: string) => string; org62: Map<string, Row>; cal: Map<string, Row>; calByStart: Map<string, Row[]> };
let M: Maps | null = null;
function maps(): Maps {
  if (M) return M;
  const opp = new Map<string, Row>(); for (const r of readTable('opportunities')) opp.set(r.id as string, r);
  const fps = readTable('fiscal_periods').map((r) => ({ id: r.id as string, a: String(r.starts_on), b: String(r.ends_on) }));
  const org62 = new Map<string, Row>(); const oById = new Map(readTable('org62_events').map((r) => [r.id as string, r]));
  for (let i = 1; i <= 45; i++) { const k = `o62-${String(i).padStart(2, '0')}`; const r = oById.get(uid('org62_events', k)); if (r) org62.set(k, r); }
  const cal = new Map<string, Row>(); const calByStart = new Map<string, Row[]>();
  for (const r of readTable('calendar_events')) { cal.set(r.id as string, r); const a = calByStart.get(r.starts_at as string) ?? []; a.push(r); calByStart.set(r.starts_at as string, a); }
  M = { opp, ttId: (n) => uid('se_task_types', slug(n)), mtId: (m) => uid('org62_picklist_values', `Meeting_Type__c:${m}`), fp: (iso) => { const d = new Date(new Date(iso).getTime() - 7 * 3600_000).toISOString().slice(0, 10); const f = fps.find((x) => d >= x.a && d <= x.b); return f ? f.id : fps[0]!.id; }, org62, cal, calByStart };
  return M;
}
const ttFlags = (() => { const rows = readTable('se_task_types'); return (n: string) => { const r = rows.find((x) => x.name === n)!; return { cf: !!r.counts_customer_facing, cr: !!r.counts_customer_related }; }; })();
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
/** the calendar event that matches an Org62 event (same start; the best title overlap when several) */
export function calendarOf(o: Row): Row | null {
  const m = maps(); const c = (m.calByStart.get(o.starts_at as string) ?? []).filter((x) => x.event_type !== 'out_of_office' && x.status !== 'cancelled');
  if (!c.length) return null;
  const w = words(String(o.subject)); let best = c[0]!; let bs = -1;
  for (const x of c) { const sc = [...words(String(x.title))].filter((t) => w.has(t)).length; if (sc > bs) { bs = sc; best = x; } }
  return best;
}
const calByTag = (tag: string) => { const id = uid('calendar_events', tag); const r = maps().cal.get(id); if (!r) throw new Error(`calendar tag ${tag}`); return r; };

/** Builds one activity_entries row from a spec. Times come from the Org62 event, a calendar tag, or explicit stamps. */
export function mkEntry(s: ES): { row: Row; startIso: string; endIso: string } {
  const m = maps();
  const o = s.ev ? m.org62.get(s.ev) : undefined;
  const c = s.tag ? calByTag(s.tag) : o ? calendarOf(o) : null;
  const startIso = s.start ? T(s.start) : (o?.starts_at as string) ?? (c?.starts_at as string);
  let endIso = s.end ? T(s.end) : s.hours ? plusMin(startIso, s.hours * 60) : (o?.ends_at as string) ?? (c?.ends_at as string);
  const hours = s.hours ?? (o?.duration_field != null ? Number(o.duration_field) : Math.round(((new Date(endIso).getTime() - new Date(startIso).getTime()) / 3600_000) * 4) / 4) ?? 1;
  if (o && o.duration_field == null && !s.hours) { /* Org62 holds no duration for this event: the app keeps the calendar length */ }
  if (new Date(endIso).getTime() <= new Date(startIso).getTime()) endIso = plusMin(startIso, hours * 60);
  const task = s.task ?? String(o?.se_task_type_name ?? 'Admin');
  const mtv = s.mt !== undefined ? s.mt : (o?.meeting_type_name as string | null) ?? null;
  const oppKey = s.opp; const acctKey = s.acct ?? (oppKey ? acctOfOpp(oppKey) : undefined);
  const oppRow = oppKey ? m.opp.get(uid('opportunities', oppKey)) : o?.opportunity_id ? m.opp.get(o.opportunity_id as string) : undefined;
  const fl = ttFlags(task);
  const hasOpp = !!(oppKey || oppRow);
  const isCF = s.cf ?? (fl.cf && hasOpp);
  const isCR = s.cr ?? (isCF || (fl.cr && hasOpp));
  const subject = s.subject ?? String(o?.subject ?? c?.title);
  const status = s.status;
  const dedupe = s.origin === 'calendar' && c ? `cal|${c.calendar_id}|${c.external_event_id}|${startIso}${s.key === 'act-o62-45' ? '|r2' : ''}${s.op && s.op !== 'create' ? `|${s.op}` : ''}` : `${s.origin}|${sha(s.key).slice(0, 12)}|${startIso}`;
  const needsTask = ['approved', 'synced_to_canvas'].includes(status) && (s.op ?? 'create') === 'create';
  const approved = s.ap ? T(s.ap) : null;
  if (['approved', 'synced_to_canvas'].includes(status) && !approved) throw new Error(`entry ${s.key} needs ap`);
  const logged = s.logged ? T(s.logged) : o ? (o.org62_created_at as string) : null;
  const verified = s.verified ? T(s.verified) : null;
  const created = s.created ? T(s.created) : plusMin(startIso, 3 * 60);
  const stamps = [created, approved, logged, verified].filter(Boolean) as string[];
  const row: Row = {
    id: uid('activity_entries', s.key), owner_user_id: OWNER, dedupe_key: dedupe, origin: s.origin, operation: s.op ?? 'create', target_org62_event_id: s.target ?? (s.op && s.op !== 'create' ? null : null),
    subject, starts_at: startIso, ends_at: endIso, duration_hours: hours, se_task_type_id: m.ttId(task), meeting_type_id: mtv ? m.mtId(mtv) : null,
    what_kind: oppKey || oppRow ? 'opportunity' : acctKey ? 'account' : 'none', opportunity_id: oppRow ? oppRow.id : null, account_id: acctKey ? uid('accounts', acctKey) : null,
    what_org62_id: oppKey ? oppSf(oppKey) : acctKey ? acctSf(acctKey) : null, what_name: oppRow ? oppRow.name : acctKey ? acctKey : null,
    customer_facing: isCF, customer_related: isCR, remote: s.remote ?? true, description: s.desc ?? (status === 'upcoming' ? null : descOf(subject, hash3(s.key))), confidence: s.conf ?? (s.origin === 'calendar' ? 0.92 : 0.7),
    reason: s.reason ?? (s.origin === 'calendar' ? (status === 'upcoming' ? `Calendar event I have accepted${oppKey ? '; matched to the opportunity by rule' : ''}` : `Calendar event I attended${oppKey ? '; matched to the opportunity by rule' : ''}`) : null), flags: s.flags ?? [], status, excluded_reason: s.excl ?? null,
    approved_at: approved, approval_method: approved ? (s.apm ?? 'click') : null, synced_to_canvas_at: s.canvas ? T(s.canvas) : null, org62_event_row_id: o ? o.id : null,
    logged_at: logged && ['logged', 'verified', 'verify_failed'].includes(status) ? logged : null, verified_at: verified && ['verified'].includes(status) ? verified : null, verify_issue: s.issue ?? null,
    fiscal_period_id: m.fp(startIso), user_locked_fields: s.locked ?? [], version: s.ver ?? 1 + (approved ? 1 : 0), created_at: created, updated_at: stamps.reduce((a, b) => (a > b ? a : b)),
  };
  if (!needsTask && !row.se_task_type_id) throw new Error('task');
  return { row, startIso, endIso };
}
const hash3 = (k: string) => parseInt(sha(k).slice(0, 4), 16) % 5;

/** the readback that matches an Org62 event row: the scan that first saw it (never earlier than the log time) */
export const verifiedAtOf = (evKey: string) => { const o = maps().org62.get(evKey)!; const a = o.first_seen_at as string; const b = o.org62_created_at as string; return a > b ? a : b; };
export const org62Row = (evKey: string) => maps().org62.get(evKey)!;
void rng;

/** ── the specs ── */
const HAND_OPP: Record<string, string | null> = {};
void HAND_OPP;
const evOpp = (evKey: string): string | undefined => {
  const o = maps().org62.get(evKey)!; if (!o.opportunity_id) return undefined;
  const r = maps().opp.get(o.opportunity_id as string)!; return OPP_BY_ID(r.id as string);
};
let oppById: Map<string, string> | null = null;
function OPP_BY_ID(id: string): string | undefined {
  if (!oppById) { oppById = new Map(); for (const k of KEYS) oppById.set(uid('opportunities', k), k); }
  return oppById.get(id);
}
import { OPP_KEYS } from './outbox-lib';
const KEYS = OPP_KEYS;

const BATCH = [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 45];
const SPECIAL_KEY: Record<number, string> = { 10: 'nba-wi086-week-1026', 28: 'ops-ae-1', 30: 'ops-ae-2' };

export function entrySpecs(): ES[] {
  const out: ES[] = [];
  const evNo = (n: number) => `o62-${String(n).padStart(2, '0')}`;
  // 1. events logged by hand in Org62 (the app proposed them; the owner logged them in Org62; the read-back matched them)
  for (let n = 1; n <= 31; n++) {
    if (n === 22) continue;
    const ev = evNo(n); const key = SPECIAL_KEY[n] ?? `act-hand-o62-${String(n).padStart(2, '0')}`;
    const noDuration = n === 18 || n === 30;
    const spec: ES = { key, origin: 'calendar', status: noDuration ? 'verify_failed' : 'verified', ev, opp: evOpp(ev), verified: mtLabelToStamp(verifiedAtOf(ev)), logged: undefined };
    if (n === 18) { spec.hours = 1; spec.issue = 'Duration__c is empty on the Org62 event (00USMPL00000018AAA); the calendar says 1 h. An update is proposed on the next logging canvas.'; spec.task = 'Admin'; spec.mt = null; spec.opp = undefined; spec.cf = false; spec.cr = false; }
    if (n === 30) { spec.hours = 1.5; spec.issue = 'Duration__c is empty on the Org62 event (00USMPL00000030AAA); the meeting ran 90 minutes (duration edited on 11-08). An update is proposed on the next logging canvas.'; spec.locked = ['duration_hours']; spec.ver = 3; }
    if (n === 8 || n === 17 || n === 29) { spec.task = 'Mentorship'; spec.mt = null; spec.opp = undefined; spec.cf = false; spec.cr = false; spec.reason = 'Matched by the rule kw-1on1: a recurring 1:1 with my manager'; }
    if (n === 12 || n === 44) { spec.origin = 'evidence'; spec.reason = 'Drive edit session with no calendar event'; spec.remote = true; }
    if (n === 31) spec.reason = 'Calendar event, internal prep for a customer readout';
    out.push(spec);
  }
  out.push({ key: 'act-hand-o62-44', origin: 'evidence', status: 'verified', ev: evNo(44), opp: 'ferrowpay-data360-foundation', verified: mtLabelToStamp(verifiedAtOf(evNo(44))), reason: 'Drive edit session on the consumption estimate with no calendar event', hours: 1.25, start: '11-13 10:00' });
  // 2. the Elderglen Home session (logged through the hand-off links with the entry id; deleted in Org62 on 11-16)
  out.push({ key: 'act-o62-22', origin: 'calendar', status: 'verify_failed', ev: evNo(22), opp: 'elderglen-home-personalization', ap: '11-06 10:12', apm: 'click', canvas: '11-06 10:14', logged: undefined, issue: 'The Org62 event was deleted on 11-16 (read-back found it missing). A re-create is proposed on the next logging canvas.', ver: 3 });
  // 3. the 13 Nov canvas batch
  for (const n of BATCH) {
    const ev = evNo(n); const key = `act-o62-${n}`;
    const s: ES = { key, origin: 'calendar', status: n === 45 ? 'logged' : 'verified', ev, opp: evOpp(ev), ap: '11-13 09:20', apm: 'click', canvas: '11-13 09:28', verified: mtLabelToStamp(verifiedAtOf(ev)) };
    if (n === 38) { s.task = 'Admin'; s.mt = null; s.opp = undefined; s.cf = false; s.cr = false; }
    if (n === 42) { s.task = 'Mentorship'; s.mt = null; s.opp = undefined; s.cf = false; s.cr = false; s.reason = 'Matched by the rule kw-1on1: a recurring 1:1 with my manager'; }
    if (n === 45) { s.flags = ['possible_duplicate']; s.reason = 'Same subject and start as the event already in Org62 (00USMPL00000026AAA, logged by hand on 11-06)'; s.created = '11-12 16:10'; }
    if (n === 37) { s.flags = ['not_on_opp_team']; s.reason = 'Calendar event, attended; the opportunity is not on my team (see the missed-opportunity finding)'; }
    out.push(s);
  }
  return out;
}
const mtLabelToStamp = (iso: string) => mtLabel(iso) + ':' + iso.slice(17, 19);

/** every other entry: the week of 11/16, upcoming events, internal noise, Claude and Drive evidence, chat proposals, corrections */
export function entrySpecs2(): ES[] {
  const o: ES[] = [];
  const cal = (key: string, tag: string, status: string, p: Partial<ES> = {}) => o.push({ key, origin: 'calendar', status, tag, ...p });
  // the week of 11/16 (NBA wi-090: 12 events, 14.25 hours; the first two keys are the NBA anchors)
  cal('nba-wi003-focus-log', 'focus-hv-blueprint-m2', 'proposed', { origin: 'chat', task: 'Solution Creation', opp: 'saltmere-data360-poc', hours: 3, mt: null, created: '11-16 13:11:20', reason: 'Staged by the assistant in the blueprint chat thread (11-16 13:11); the focus block has a Drive edit session on the blueprint and is not logged yet', conf: 0.88 });
  cal('act-w-aw-arch-m2', 'aw-arch-m2', 'proposed', { task: 'Workshop', mt: 'Data Cloud Workshop', opp: 'yarrowdale-enterprise-data', hours: 1, created: '11-16 16:48:20' });
  cal('act-w-pc-sync-m2', 'pc-sync-m2', 'proposed', { task: 'Customer Discovery', mt: 'CF', opp: 'oakhallow-claims-agent', hours: 0.5, created: '11-16 16:48:20' });
  cal('act-w-hv-sync-m1', 'hv-sync-m1', 'proposed', { task: 'POC', mt: 'Proof of Concept', opp: 'saltmere-data360-poc', hours: 0.75, created: '11-17 12:10' });
  cal('act-w-hv-debrief-m1', 'hv-debrief-m1', 'proposed', { task: 'Account Planning', mt: null, opp: 'saltmere-data360-poc', hours: 0.25, created: '11-17 12:40', cf: false, cr: true });
  cal('act-w-to-demo-build', 'focus-to-demo-m1', 'proposed', { task: 'Solution Creation', mt: null, opp: 'elderglen-outdoors-renewal-expansion', hours: 2.5, created: '11-17 17:05' });
  o.push({ key: 'nba-wi090-week-1116', origin: 'evidence', status: 'proposed', subject: 'Saltmere - solution blueprint (evening session)', start: '11-17 18:50', end: '11-17 20:35', hours: 1.75, sessionKey: 'cs-31', locked: ['duration_hours'], task: 'Solution Creation', mt: null, opp: 'saltmere-data360-poc', created: '11-18 07:05', docKey: 'hv-blueprint', reason: 'Claude session cs-31 and Drive edits on the blueprint from 18:50 to 20:35 (evening)', conf: 0.8, flags: ['evening'] });
  cal('act-w-se-sync-p0', 'se-sync-p0', 'upcoming', { task: 'Admin', mt: null, hours: 1, created: '11-16 16:48:20', cf: false, cr: false });
  cal('act-w-qp-dry', 'qp-dry', 'upcoming', { task: 'Dry Run', mt: null, opp: 'ferrowpay-fraud-agent', hours: 1, created: '11-17 09:00', cf: false, cr: true });
  cal('act-w-pc-order', 'pc-order', 'upcoming', { task: 'Customer Discovery', mt: 'CF', opp: 'oakhallow-claims-agent', hours: 0.5, created: '11-17 09:00' });
  cal('act-w-qp-sync-p0', 'qp-sync-p0', 'upcoming', { task: 'Customer Discovery', mt: 'CF', opp: 'ferrowpay-data360-foundation', hours: 0.5, created: '11-16 16:48:20' });
  cal('act-w-to-demoprep', 'to-demoprep', 'upcoming', { task: 'Solution Creation', mt: null, opp: 'elderglen-outdoors-renewal-expansion', hours: 1.5, created: '11-17 17:05', cf: false, cr: true });
  // upcoming this week and next
  cal('up-hv-sync-p1', 'hv-sync-p1', 'upcoming', { task: 'POC', mt: 'Proof of Concept', opp: 'saltmere-data360-poc', hours: 0.75, created: '11-17 12:10' });
  cal('up-to-demo', 'to-demo', 'upcoming', { task: 'Customer Presentation', mt: 'CF', opp: 'elderglen-outdoors-renewal-expansion', hours: 1, created: '11-17 12:10', reason: 'Tentative: the demo has no confirmed time yet', flags: ['tentative'] });
  cal('up-to-sync-p1', 'to-sync-p1', 'upcoming', { task: 'Customer Discovery', mt: 'CF', opp: 'elderglen-outdoors-renewal-expansion', hours: 0.5, created: '11-12 16:00' });
  cal('up-qp-arch', 'qp-arch-session', 'upcoming', { task: 'Workshop', mt: 'Data Cloud Workshop', opp: 'ferrowpay-fraud-agent', hours: 1.5, created: '11-14 10:30' });
  cal('up-training', 'training-hold', 'upcoming', { task: 'Admin', mt: null, hours: 0.75, created: '11-13 13:41', cf: false, cr: false, reason: 'Mandatory training hold (Data Handling and Privacy Refresh)' });
  cal('up-hv-dryrun', 'hv-dryrun', 'upcoming', { task: 'Dry Run', mt: null, opp: 'saltmere-data360-poc', hours: 1, created: '11-17 12:10', cf: false, cr: true });
  cal('up-hv-focus-p2', 'focus-hv-blueprint-p2', 'upcoming', { task: 'Solution Creation', mt: null, opp: 'saltmere-data360-poc', hours: 2.5, created: '11-17 12:10', cf: false, cr: true });
  cal('up-cc-prep', 'cc-prep', 'upcoming', { task: 'Solution Creation', mt: null, opp: 'cascadia-citizen-assistant', hours: 2, created: '11-13 10:05', cf: false, cr: true });
  cal('up-cc-travel-out', 'cc-travel-out', 'upcoming', { task: 'Travel', mt: null, opp: 'cascadia-citizen-assistant', hours: 3.5, remote: false, created: '11-13 10:00', cf: false, cr: true, reason: 'Travel to the Cascadia onsite (calendar hold)' });
  cal('up-cc-onsite1', 'cc-onsite1', 'upcoming', { task: 'Workshop', mt: 'Data Cloud Workshop', opp: 'cascadia-citizen-assistant', hours: 8.5, remote: false, created: '11-10 11:00', reason: 'Onsite workshop day 1 (onsite hours 08:00-17:00 less lunch)' });
  cal('up-cc-onsite2', 'cc-onsite2', 'upcoming', { task: 'Workshop', mt: 'Data Cloud Workshop', opp: 'cascadia-citizen-assistant', hours: 8.5, remote: false, created: '11-10 11:00', reason: 'Onsite workshop day 2 (onsite hours 08:00-17:00 less lunch)' });
  cal('up-cc-travel-back', 'cc-travel-back', 'upcoming', { task: 'Travel', mt: null, opp: 'cascadia-citizen-assistant', hours: 5, remote: false, created: '11-13 10:00', cf: false, cr: true });
  // internal meetings the rules do not log (standups, pipeline reviews, lunch, staff call)
  for (const t of ['standup-m30', 'standup-m28', 'standup-m23', 'standup-m21', 'standup-m19', 'standup-m16', 'standup-m14', 'standup-m12', 'standup-m9', 'standup-m7', 'standup-m5', 'standup-m2', 'standup-p0'])
    cal(`ex-${t}`, t, 'excluded', { excl: 'neither_type', task: 'Admin', mt: null, hours: 0.25, cf: false, cr: false, reason: 'Internal standup: counts as neither customer facing nor customer related', conf: 0.95, created: '11-17 06:00', desc: 'SE team standup.' });
  for (const t of ['pipeline-review-m23', 'pipeline-review-m9']) cal(`ex-${t}`, t, 'excluded', { excl: 'neither_type', task: 'Admin', mt: null, hours: 0.5, cf: false, cr: false, reason: 'Internal pipeline review', conf: 0.95, desc: 'Pipeline review with the AEs and the SE team.' });
  cal('ex-pipeline-review-m2', 'pipeline-review-m2', 'excluded', { excl: 'overlap', task: 'Admin', mt: null, hours: 0.5, cf: false, cr: false, reason: 'Overlaps the blueprint focus block (09:00-12:00); the focus block wins', desc: 'Pipeline review with the AEs and the SE team.' });
  cal('ex-team-lunch', 'team-lunch', 'excluded', { excl: 'neither_type', task: 'Admin', mt: null, hours: 1, cf: false, cr: false, reason: 'Team lunch', desc: 'Team lunch.' });
  cal('ex-staff-call', 'staff-call', 'excluded', { excl: 'neither_type', task: 'Admin', mt: null, hours: 0.5, cf: false, cr: false, reason: 'Regional staff call (internal, listen only)', desc: 'Regional SE staff call.' });
  // dismissed by the user (rule dismissals and one-offs)
  cal('dis-q4-planning', 'q4-planning', 'dismissed', { task: 'Admin', mt: null, hours: 1.5, cf: false, cr: false, reason: 'Dismissed by the user: planning workshop belongs to the previous quarter close-out', desc: 'Q4 pursuit planning workshop.' });
  cal('dis-office-hours-1', 'office-hours-1', 'dismissed', { task: 'Sales Enablement', mt: null, hours: 1, cf: false, cr: false, reason: 'Dismissed by the user: tentative, only listened', desc: 'Data 360 office hours.' });
  // Claude and Drive evidence (engaged time only)
  const ev = (key: string, sessionKey: string, status: string, p: Partial<ES>) => o.push({ key, origin: 'evidence', status, sessionKey, ...p });
  ev('ev-cs01-bw-build', 'cs-01', 'proposed', { subject: 'Harrowgate - predictive maintenance demo build', start: '10-27 19:05', end: '10-27 21:35', hours: 2.5, task: 'Solution Creation', mt: null, opp: 'harrowgate-maintenance-agent', flags: ['not_on_opp_team', 'evening'], created: '10-28 06:00', reason: 'Claude session on the demo kit (14 prompts, 2h25m engaged); I am not on the opportunity team', conf: 0.74 });
  ev('dc-harrowgate-maintenance-agent', 'cs-02', 'synced_to_canvas', { subject: 'Harrowgate - plant dashboards for the second demo (claim evidence)', start: '11-09 19:30', end: '11-09 21:15', hours: 1.75, task: 'Solution Creation', mt: null, opp: 'harrowgate-maintenance-agent', flags: ['not_on_opp_team', 'dc_evidence'], ap: '11-14 09:18', canvas: '11-14 09:20', created: '11-10 06:00', reason: 'Evidence row for the deal-contribution claim: Claude session on the dashboards plus the Drive revisions of the demo deck', conf: 0.85, docKey: 'bw-demo' });
  ev('ev-cs03-claims-topic', 'cs-03', 'proposed', { subject: 'Saltmere - claims status topic and handoff flow', start: '11-11 09:10', end: '11-11 10:00', hours: 1, task: 'Solution Creation', mt: null, opp: 'saltmere-data360-poc', created: '11-12 06:00', reason: 'Claude session (18 prompts); trimmed to the part before the SE team sync at 10:00', conf: 0.8 });
  ev('ev-cs04-loader', 'cs-04', 'proposed', { subject: 'Saltmere - synthetic member loader and org seeding', start: '11-12 08:15', end: '11-12 09:45', hours: 1.5, task: 'Solution Creation', mt: null, opp: 'saltmere-data360-poc', created: '11-13 06:00', conf: 0.82 });
  ev('ev-cs05-mapping', 'cs-05', 'needs_input', { subject: 'Ferrowpay - transaction schema mapping to DMOs', start: '11-05 13:20', end: '11-05 15:10', hours: 1.75, task: 'Solution Creation', mt: null, opp: undefined, acct: 'ferrowpay', flags: ['two_opps_match'], created: '11-06 06:00', reason: 'Two open Ferrowpay opportunities match this work (Fraud Investigation Agent, Data 360 Foundation). Which one was it for?', conf: 0.5 });
  ev('ev-cs06-prompts', 'cs-06', 'proposed', { subject: 'Ferrowpay - fraud case summary prompts', start: '11-13 16:00', end: '11-13 17:20', hours: 1.25, task: 'Solution Creation', mt: null, opp: 'ferrowpay-fraud-agent', created: '11-14 06:00', conf: 0.81 });
  ev('ev-cs11-weekend', 'cs-11', 'proposed', { subject: 'Saltmere - demo org loader refactor (Saturday)', start: '11-14 10:00', end: '11-14 11:30', hours: 1.5, task: 'Solution Creation', mt: null, opp: 'saltmere-data360-poc', flags: ['weekend'], created: '11-15 06:00', conf: 0.82 });
  ev('ev-cs12-blueprint-s6', 'cs-12', 'proposed', { subject: 'Saltmere - blueprint section 6 draft (Sunday)', start: '11-15 14:16', end: '11-15 15:16', hours: 1, task: 'Solution Creation', mt: null, opp: 'saltmere-data360-poc', flags: ['weekend'], created: '11-16 06:00', conf: 0.83 });
  ev('ev-cs08-denied', 'cs-08', 'proposed', { subject: 'Saltmere - denied-claim scenario for the demo', start: '11-18 07:55', end: '11-18 08:40', hours: 0.75, task: 'Solution Creation', mt: null, opp: 'saltmere-data360-poc', created: '11-18 08:45', conf: 0.8 });
  ev('ev-cs07-os-skill', 'cs-07', 'dropped', { subject: 'Elderglen Outdoors - order status skill', start: '11-17 14:30', end: '11-17 16:55', hours: 2.5, task: 'Solution Creation', mt: null, opp: 'elderglen-outdoors-renewal-expansion', flags: ['overlaps_calendar'], created: '11-18 06:00', reason: 'Dropped: the calendar focus block "Focus: demo build (Elderglen)" already covers 14:30-17:00', conf: 0.7 });
  ev('ev-cs16-bw-evening', 'cs-16', 'dismissed', { subject: 'Harrowgate - maintenance agent topics (evening)', start: '10-26 19:40', end: '10-26 21:10', hours: 1.5, task: 'Solution Creation', mt: null, opp: 'harrowgate-maintenance-agent', flags: ['not_on_opp_team', 'evening'], created: '10-27 06:00', reason: 'Dismissed by the user: evening build for an opportunity outside my team' });
  ev('ev-cs09-notes', 'cs-09', 'dismissed', { subject: 'Weekly notes into the log tracker', start: '10-29 16:30', end: '10-29 16:55', hours: 0.5, task: 'Admin', mt: null, cf: false, cr: false, created: '10-30 06:00', reason: 'Dismissed by the rule "Docs I cannot map to an account"' });
  ev('ev-cs10-scratch', 'cs-10', 'dismissed', { subject: 'Fuzzy match ruleset on sample addresses', start: '11-02 11:20', end: '11-02 12:05', hours: 0.75, task: 'Admin', mt: null, cf: false, cr: false, created: '11-03 06:00', reason: 'Dismissed by the rule "Repo: scratch"' });
  ev('ev-cs19-gmail-fix', 'cs-19', 'dismissed', { subject: 'Control Center: Gmail scan fix', start: '11-14 09:30', end: '11-14 10:11', hours: 0.75, task: 'Admin', mt: null, cf: false, cr: false, created: '11-15 06:00', reason: 'Dismissed by the user: tooling work, not customer related' });
  ev('ev-cs15-log-lines', 'cs-15', 'dismissed', { subject: 'Weekly time-log lines from the calendar', start: '10-23 08:05', end: '10-23 08:29', hours: 0.5, task: 'Admin', mt: null, cf: false, cr: false, created: '10-24 06:00', reason: 'Dismissed by the rule "Repo: se-notes"' });
  ev('ops-ae-3', 'cs-26', 'approved', { subject: 'Cascadia - onsite workshop agenda draft', start: '11-10 08:50', end: '11-10 09:50', hours: 1, task: 'Solution Creation', mt: null, opp: 'cascadia-citizen-assistant', origin: 'evidence', ap: '11-15 16:10', created: '11-11 06:00', docKey: 'cc-agenda', reason: 'Drive edits on the onsite agenda before the 10:00 agenda review', conf: 0.86, sessionKey: undefined });
  o.push({ key: 'est-hv-demo-script', origin: 'build_estimate', status: 'proposed', subject: 'Saltmere - member services demo script (estimated build time)', start: '11-12 15:30', end: '11-12 16:00', hours: 0.5, task: 'Solution Creation', mt: null, opp: 'saltmere-data360-poc', docKey: 'hv-demo-script', created: '11-13 06:00', reason: 'Estimated from the Drive revision at 16:45 (no calendar block)', conf: 0.6, flags: ['estimated'] });
  o.push({ key: 'est-aw-proposal', origin: 'build_estimate', status: 'proposed', subject: 'Yarrowdale - data foundation proposal slides (estimated build time)', start: '11-09 16:15', end: '11-09 16:45', hours: 0.5, task: 'Solution Creation', mt: null, opp: 'yarrowdale-enterprise-data', docKey: 'aw-proposal', created: '11-10 06:00', reason: 'Estimated from the Drive revision at 17:30', conf: 0.6, flags: ['estimated'] });
  o.push({ key: 'canvas-batch-1113', origin: 'manual', status: 'proposed', subject: 'Weekly time logging: review and apply the 11/13 logging canvas', start: '11-13 09:05', end: '11-13 09:35', hours: 0.5, task: 'Admin', mt: null, cf: false, cr: false, created: '11-13 09:36', reason: 'Time spent reviewing the logging canvas for the week of 11/09 (anchor of the batch)', conf: 1, desc: 'Reviewed and applied the weekly logging canvas.' });
  // chat proposals (llm-chat-04 "log last week" on 11-09; "Chat proposed a logging batch" on 11-16)
  cal('chat-log-fri-blueprint', 'focus-hv-blueprint-m5', 'proposed', { origin: 'chat', task: 'Solution Creation', mt: null, opp: 'saltmere-data360-poc', hours: 4, created: '11-16 13:11', reason: 'Proposed by the assistant when asked to log last week', conf: 0.85 });
  cal('chat-log-bw-dash', 'focus-bw-dash-m9', 'proposed', { origin: 'chat', task: 'Solution Creation', mt: null, opp: 'harrowgate-maintenance-agent', hours: 1.5, flags: ['not_on_opp_team'], created: '11-09 16:20', reason: 'Proposed by the assistant when asked to log last week' });
  cal('chat-log-referral-call', 'aw-mg-decision', 'dismissed', { origin: 'chat', task: 'Customer Discovery', mt: 'CF', opp: 'yarrowdale-mg-referral', hours: 0.5, created: '11-09 16:20', reason: 'Dismissed by the user: the opportunity closed lost on 11-06' });
  cal('chat-log-office-hours', 'office-hours-2', 'proposed', { origin: 'chat', task: 'Sales Enablement', mt: null, hours: 1, cf: false, cr: false, created: '11-09 16:20', reason: 'Proposed by the assistant when asked to log last week', desc: 'Data 360 office hours with the specialist.' });
  o.push({ key: 'man-staff-slides', origin: 'manual', status: 'proposed', subject: 'Saltmere - slides for the staff call', start: '11-12 17:00', end: '11-12 18:00', hours: 1, task: 'Account Planning', mt: null, opp: 'saltmere-data360-poc', created: '11-12 18:05', cf: false, cr: true, reason: 'Added by hand on the Time page', conf: 1, locked: ['subject', 'duration_hours'] });
  o.push({ key: 'man-ns-recap', origin: 'manual', status: 'proposed', subject: 'Halvergate - value recap one-pager', start: '11-13 11:30', end: '11-13 12:15', hours: 0.75, task: 'Solution Creation', mt: null, opp: 'halvergate-route-exceptions-agent', docKey: 'ns-recap', created: '11-13 11:20', cf: false, cr: true, reason: 'Added by hand on the Time page', conf: 1 });
  // corrections: re-create after the Org62 deletion, duration backfills, the duplicate delete
  o.push({ key: 'recreate-th-validation', origin: 'legacy_recreate', status: 'proposed', subject: 'Elderglen Home - validation working session', start: '11-03 14:00', end: '11-03 15:00', hours: 1, task: 'POC', mt: 'Proof of Concept', opp: 'elderglen-home-personalization', created: '11-16 09:45', reason: 'Re-create: the Org62 event 00USMPL00000022AAA was deleted on 11-16', tag: 'th-valid' });
  o.push({ key: 'bf-o62-18', origin: 'duration_backfill', status: 'synced_to_canvas', op: 'update', target: '00USMPL00000018AAA', subject: 'SE team sync', start: '10-28 10:00', end: '10-28 11:00', hours: 1, task: 'Admin', mt: null, cf: false, cr: false, ap: '11-14 09:18', canvas: '11-14 09:20', created: '11-13 09:40', reason: 'Org62 holds no Duration__c for this event' });
  o.push({ key: 'bf-o62-30', origin: 'duration_backfill', status: 'synced_to_canvas', op: 'update', target: '00USMPL00000030AAA', subject: 'Elderglen Home - technical validation kickoff', start: '11-06 10:30', end: '11-06 12:00', hours: 1.5, task: 'POC', mt: 'Proof of Concept', opp: 'elderglen-home-personalization', ap: '11-14 09:18', canvas: '11-14 09:20', created: '11-13 09:40', reason: 'Org62 holds no Duration__c for this event' });
  o.push({ key: 'del-o62-45', origin: 'calendar', status: 'synced_to_canvas', op: 'delete', target: '00USMPL00000045AAA', subject: 'Saltmere - weekly sync', start: '11-05 11:00', end: '11-05 11:45', hours: 0.75, task: 'POC', mt: 'Proof of Concept', opp: 'saltmere-data360-poc', ap: '11-14 09:18', canvas: '11-14 09:20', created: '11-13 09:45', reason: 'Duplicate of the event logged by hand on 11-06 (00USMPL00000026AAA); delete the second one', flags: ['possible_duplicate'] });
  return o;
}
