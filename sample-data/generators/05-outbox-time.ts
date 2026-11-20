/** Domain 05 (outbox, time logging, Claude sessions): drafts and their delivery history, activity entries and time blocks, logging canvases,
 *  deal contributions and missed-opportunity findings, landings, Claude sessions and tool runs.
 *  Run: npx tsx sample-data/generators/05-outbox-time.ts (after 01-04). Writes sample-data/tables/*.json and sample-data/CAST-outbox.md. */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { OWNER, SAMPLE_DIR, flushRefs, readTable, reservedFor, sha, uid, writeTable } from '../lib/kit';
import type { Row } from '../lib/kit';
import { buildBlocks } from './data/outbox-blocks';
import { buildDraft, siId } from './data/outbox-build';
import type { Att, DSpec } from './data/outbox-build';
import { EXTRA, FEEDBACK, HANDOFFS, RESERVED } from './data/outbox-drafts-a';
import { HOLD_DRAFTS, ORG62_BATCHES, VDP_DRAFTS } from './data/outbox-drafts-b';
import { buildCanvases } from './data/outbox-deals';
import { calendarOf, entrySpecs, entrySpecs2, mkEntry, org62Row, verifiedAtOf } from './data/outbox-activity';
import type { ES } from './data/outbox-activity';
import { buildDeals } from './data/outbox-landings';
import { buildSessions, buildTools } from './data/outbox-sessions';
import { ACCT_KEYS, T, acctSf, mtLabel, oppSf, plusMin } from './data/outbox-lib';
import { writeCastOutbox } from './data/outbox-cast';

const warnings: string[] = [];
const warn = (m: string) => { warnings.push(m); };

// ── sessions, tools ──────────────────────────────────────────────────────────────────────────────
const sb = buildSessions();
const tools = buildTools(sb);

// ── activity entries ─────────────────────────────────────────────────────────────────────────────
const specs: ES[] = [...entrySpecs(), ...entrySpecs2()];
const keys = new Set<string>();
for (const s of specs) { if (keys.has(s.key)) throw new Error(`duplicate entry key ${s.key}`); keys.add(s.key); }
const built = specs.map((s) => ({ s, ...mkEntry(s) }));
const E: Record<string, Row> = {}; for (const b of built) E[b.s.key] = b.row;
// verified_at only where the spec asked for it; logged_at from the Org62 create time

// reserved activity entries
for (const r of reservedFor('activity_entries')) if (!E[String(r.key)]) warn(`reserved activity entry ${r.key} missing`);
for (const r of reservedFor('activity_entries')) if (E[String(r.key)] && E[String(r.key)]!.id !== uid('activity_entries', r.key)) warn(`reserved activity entry id mismatch ${r.key}`);

// ── time blocks and their links ──────────────────────────────────────────────────────────────────
const forceCal = new Set<string>();
for (const b of built) if (b.s.ev) { const c = calendarOf(org62Row(b.s.ev)); if (c) forceCal.add(c.id as string); }
const handEvidence = ['act-hand-o62-12', 'act-hand-o62-44'];
const extra = built.filter((b) => b.s.origin === 'manual' || b.s.origin === 'build_estimate' || handEvidence.includes(b.s.key)).map((b) => ({ tag: b.s.key, source: (b.s.origin === 'build_estimate' ? 'estimate' : 'manual') as 'manual' | 'estimate', start: b.startIso, end: b.endIso, opp: b.s.opp, asset: b.s.docKey }));
const bb = buildBlocks(sb, forceCal, extra);
const blockById = new Map(bb.blocks.map((b) => [b.id as string, b]));
const links: Row[] = []; const linked = new Set<string>();
const mins = (a: string, b: string) => Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 60000);
const pinned = new Set(['nba-wi090-week-1116', 'dc-harrowgate-maintenance-agent', 'ops-ae-3']);
for (const b of built) {
  const s = b.s;
  if (['excluded', 'dismissed', 'dropped', 'upcoming'].includes(s.status) || (s.op && s.op !== 'create') || s.origin === 'duration_backfill' || s.origin === 'legacy_recreate') continue;
  let cand: string[] = [];
  if (s.ev) { const c = calendarOf(org62Row(s.ev)); if (c) cand = bb.byCal.get(c.id as string) ?? []; }
  else if (s.tag) cand = bb.byCal.get(uid('calendar_events', s.tag)) ?? [];
  if (s.sessionKey) for (let i = 1; i <= 6; i++) cand = cand.concat(bb.byTag.get(`seg:${s.sessionKey}:${i}`) ?? []);
  if (s.docKey) { const asset = uid('assets', s.docKey); cand = cand.concat(bb.blocks.filter((x) => x.asset_id === asset).map((x) => x.id as string)); }
  if (s.origin === 'manual' || s.origin === 'build_estimate' || handEvidence.includes(s.key)) cand = cand.concat(bb.byTag.get(`x:${s.key}`) ?? []);
  const calendarBased = s.origin === 'calendar' || s.origin === 'chat' && !!s.tag;
  const fit = (blk: Row) => (calendarBased ? mins(blk.starts_at as string, blk.ends_at as string) : mins(String(blk.starts_at) > b.startIso ? (blk.starts_at as string) : b.startIso, String(blk.ends_at) < b.endIso ? (blk.ends_at as string) : b.endIso));
  let remaining = Number(b.row.duration_hours) * 60; let got = 0;
  const take = (ids: string[], counted: boolean) => {
    for (const id of ids) {
      const blk = blockById.get(id)!; if (!!blk.counts_as_human_hours !== counted) continue;
      const alloc = Math.min(Math.round(fit(blk)), Math.round(remaining));
      if (alloc <= 0) continue;
      const k = `${b.row.id}|${id}`; if (linked.has(k)) continue; linked.add(k);
      links.push({ activity_entry_id: b.row.id, time_block_id: id, allocated_minutes: alloc }); remaining -= alloc; got += alloc;
    }
  };
  take(cand, true);
  // the policy "log all accepted" keeps an overlapped meeting loggable: it points at the overlay block
  if (calendarBased && got < Number(b.row.duration_hours) * 30) take(cand, false);
  // evidence, estimates and manual rows are logged for the engaged time the blocks allow
  if (!calendarBased && !pinned.has(s.key) && got > 0) {
    const h = Math.max(0.25, Math.round(got / 15) * 0.25);
    if (h !== Number(b.row.duration_hours)) { b.row.duration_hours = h; b.row.ends_at = plusMin(b.startIso, h * 60); }
  }
}

// ── canvases ─────────────────────────────────────────────────────────────────────────────────────
const csRows = readTable('change_sets');
const changeSetOf = (key: string) => (csRows.find((c) => c.entity_id === uid('activity_entries', key) && c.kind === 'user_edit')?.id as string) ?? null;
const cv = buildCanvases(E, changeSetOf);

// ── drafts ───────────────────────────────────────────────────────────────────────────────────────
const nbaIds = new Set(readTable('next_best_actions').map((r) => r.id as string));
const nbaRow = (k: string) => readTable('next_best_actions').find((r) => r.id === uid('next_best_actions', k))!;
const revs = readTable('content_revisions').filter((r) => r.entity_type === 'drafts');
const lastRev = (key: string) => revs.filter((r) => r.entity_id === uid('drafts', key)).sort((a, b) => (b.revision as number) - (a.revision as number))[0]!;
const org62Drafts: DSpec[] = ORG62_BATCHES.map((b) => {
  const evs = b.events.map((n) => org62Row(`o62-${String(n).padStart(2, '0')}`));
  const hours = evs.reduce((a, e) => a + (e.duration_field == null ? 1 : Number(e.duration_field)), 0);
  const seen = plusMin(evs.map((e) => e.org62_created_at as string).sort().pop()!, 1.5);
  const payload = { action: 'org62.event_batch', kind: 'activity_batch', target: { label: b.label, url: null }, text: null,
    changes: evs.map((e) => ({ label: String(e.subject), before: null, after: `${e.duration_field ?? '(no duration)'} h, ${e.se_task_type_name}` })),
    input: { rows: evs.map((e) => ({ Subject: e.subject, StartDateTime: e.starts_at, EndDateTime: e.ends_at, Duration__c: e.duration_field == null ? '' : String(e.duration_field), SE_Task_Type__c: e.se_task_type_name, Meeting_Type__c: e.meeting_type_name ?? '', Opportunity__c: e.what_org62_id })), hours, csv: false } };
  return { key: b.key, kind: 'org62_activity_batch', status: 'verified', created: b.created, wi: b.wi, nba: b.nba, title: `Log ${b.label}`, payload, docJson: null, text: `${b.label}: ${hours.toFixed(2)} h`, model: null, voice: false, ap: b.ap, apm: 'click', handoff: b.handoff, handoffUrl: b.url, mode: 'handoff',
    vf: mtLabel(seen), policy: 'org62_activity_batch:all', level: 'L2_stage', vers: [{ at: mtLabel(seen), method: 'org62_soql', status: 'matched', diff: `${b.events.length} of ${b.events.length} events found by subject and start` }] } as DSpec;
});

const all: DSpec[] = [...RESERVED, ...EXTRA, ...FEEDBACK, ...HANDOFFS, ...VDP_DRAFTS, ...HOLD_DRAFTS, ...org62Drafts, ...cv.drafts];
const keySet = new Set<string>(); for (const d of all) { if (keySet.has(d.key)) throw new Error(`duplicate draft key ${d.key}`); keySet.add(d.key); }
// reserved drafts: bodies come from the NBA the draft was made from, or from the last content revision
for (const d of RESERVED) {
  const nba = nbaRow(d.nba!);
  const rev = revs.some((r) => r.entity_id === uid('drafts', d.key)) ? lastRev(d.key) : null;
  const pd = (nba.payload as { draft?: { doc?: Record<string, unknown>; destination?: { subject?: string } } }).draft;
  if (rev) { d.docJson = rev.doc_json as Record<string, unknown>; d.revDocs = revs.filter((r) => r.entity_id === uid('drafts', d.key)).sort((a, b) => (a.revision as number) - (b.revision as number)).map((r) => r.doc_json as Record<string, unknown>); }
  else if (pd?.doc) d.docJson = pd.doc; else throw new Error(`no body for ${d.key}`);
  if (pd?.destination?.subject && !d.subject) d.subject = pd.destination.subject;
}
for (const d of all) if (d.nba && !nbaIds.has(uid('next_best_actions', d.nba))) throw new Error(`draft ${d.key} points at missing NBA ${d.nba}`);
// the two revision-backed drafts must equal their last revision exactly
for (const k of ['rev-elderglen-demo-reply', 'rev-saltmere-blueprint-email']) { const d = all.find((x) => x.key === k)!; if (sha(JSON.stringify(d.docJson)) !== lastRev(k).content_hash) throw new Error(`revision hash mismatch ${k}`); }
for (const r of reservedFor('drafts')) if (!keySet.has(String(r.key))) throw new Error(`reserved draft ${r.key} not built`);

const seq = { att: 0 };
const bd = all.map((d) => buildDraft(d, seq));
// a draft cannot belong to a work item the app created later (items from the backfills appear after the drafts the user wrote by hand)
const wiCreated = new Map(readTable('work_items').map((w) => [w.id as string, w.created_at as string]));
const reservedKeys = new Set(RESERVED.map((r) => r.key));
for (const b of bd) { const w = b.draft.work_item_id as string | null; if (w && !reservedKeys.has(String(b.draft.idempotency_key).replace(/^cc-/, '').replace(/-v\d+$/, '')) && String(b.draft.created_at) < (wiCreated.get(w) ?? '')) b.draft.work_item_id = null; }
// sequential ids ordered by time for attempts and verifications
const attemptRows = bd.flatMap((b) => b.attempts).sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
const attemptMap = new Map<number, number>(); attemptRows.forEach((r, i) => { attemptMap.set(r.id as number, i + 1); r.id = i + 1; });
const verRows = bd.flatMap((b) => b.verifications).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
verRows.forEach((r, i) => { r.id = i + 1; if (r.send_attempt_id != null) r.send_attempt_id = attemptMap.get(r.send_attempt_id as number) ?? null; });
const draftRows = bd.map((b) => b.draft).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
const DID = (k: string) => uid('drafts', k);

// ── deals, findings, landings ────────────────────────────────────────────────────────────────────
const D = buildDeals();
const onN = new Map(readTable('opportunities').map((r) => [r.id as string, String(r.name)]));
void onN;
const ocase = new Map(readTable('org62_use_cases').map((r) => [r.vdp_use_case_id as string, r]));
const ucRows = readTable('use_cases');
const ev = (e: Row) => ({ Subject: e.subject, StartDateTime: e.starts_at, EndDateTime: e.ends_at });
const evRemote = (e: Row) => { const o = e.org62_event_row_id ? readTable('org62_events').find((x) => x.id === e.org62_event_row_id) : null; return o ? { Subject: String(o.subject), StartDateTime: String(o.starts_at), EndDateTime: String(o.ends_at), Duration__c: o.duration_field == null ? null : Number(o.duration_field).toFixed(1), SE_Task_Type__c: String(o.se_task_type_name), Meeting_Type__c: (o.meeting_type_name as string) ?? null, Opportunity__c: (o.what_org62_id as string) ?? null } : null; };
const acctKeyOf = (id: unknown) => ACCT_KEYS.find((k) => uid('accounts', k) === id);
const createFields = (e: Row, evKey?: string) => ({ ...ev(e), Duration__c: Number(e.duration_hours).toFixed(1), SE_Task_Type__c: evKey ? String(org62Row(evKey).se_task_type_name) : null, Meeting_Type__c: evKey ? (org62Row(evKey).meeting_type_name as string | null) : null, Opportunity__c: e.what_org62_id, Account__c: acctKeyOf(e.account_id) ? acctSf(acctKeyOf(e.account_id)!) : null, Description: e.description });
// 1. activity events
const entryLanding = new Map<string, string>();
for (const b of built) {
  const s = b.s; const e = b.row;
  if (!e.org62_event_row_id) continue;
  const o = org62Row(s.ev!);
  const missing = s.key === 'act-o62-22'; const differs = s.key === 'ops-ae-2' || s.key === 'act-hand-o62-18';
  const lid = D.L('activity_event', e.id as string, 'org62', { external_id: o.org62_event_id as string, state: missing ? 'missing' : differs ? 'differs' : 'verified', remote_values: missing ? null : evRemote(e), verified_at: missing ? null : (e.verified_at as string | null) ?? verifiedAtOf(s.ev!), last_read_at: missing ? T('11-16 09:40') : (o.last_seen_at as string), created_at: e.created_at, updated_at: missing ? T('11-16 09:40') : (o.last_seen_at as string) });
  entryLanding.set(s.key, lid);
  const viaCanvas = [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 45].some((n) => `act-o62-${n}` === s.key);
  D.W(lid, `event:${e.id}`, { op: 'create', after: createFields(e, s.ev), state: 'verified', origin: viaCanvas ? 'canvas' : 'backfill', draft_id: viaCanvas ? DID('cv-batch-1113') : null, sent_at: viaCanvas ? T('11-13 09:30') : (o.org62_created_at as string), verified_at: (e.verified_at as string | null) ?? verifiedAtOf(s.ev!), created_at: viaCanvas ? T('11-13 09:28') : (o.org62_created_at as string) });
}
// duration fixes and the duplicate delete wait on the second canvas
for (const [base, ev18, id18] of [['act-hand-o62-18', 'o62-18', 'bf-o62-18'], ['ops-ae-2', 'o62-30', 'bf-o62-30']] as const) {
  const o = org62Row(ev18); void id18;
  D.W(entryLanding.get(base)!, `upd:Event:${o.org62_event_id}:Duration__c`, { op: 'update', before: { Duration__c: '' }, after: { Duration__c: Number(E[id18]!.duration_hours).toFixed(1) }, state: 'staged', origin: 'canvas', draft_id: DID('cv-dc-1114'), reason: 'Org62 holds no duration for this event', created_at: T('11-14 09:19') });
}
D.W(entryLanding.get('act-o62-45')!, `del:Event:${org62Row('o62-45').org62_event_id}`, { op: 'delete', before: evRemote(E['act-o62-45']!), after: {}, state: 'staged', origin: 'canvas', draft_id: DID('cv-dc-1114'), reason: 'Duplicate of the event logged by hand on 11-06', created_at: T('11-14 09:19') });
// the Harrowgate evidence row is staged on the DC canvas; the week of 11/16 and the re-create are proposed on the next canvas
const dcL = D.L('activity_event', E['dc-harrowgate-maintenance-agent']!.id as string, 'org62', { state: 'staged', created_at: T('11-14 09:19'), updated_at: T('11-14 09:20') });
D.W(dcL, `event:${E['dc-harrowgate-maintenance-agent']!.id}`, { op: 'create', after: { ...ev(E['dc-harrowgate-maintenance-agent']!), Duration__c: '1.8', SE_Task_Type__c: 'Solution Creation', Opportunity__c: oppSf('harrowgate-maintenance-agent'), Description: E['dc-harrowgate-maintenance-agent']!.description }, state: 'staged', origin: 'canvas', draft_id: DID('cv-dc-1114'), created_at: T('11-14 09:19') });
for (const k of cv.keys.week1116) {
  const e = E[k]!; const l = D.L('activity_event', e.id as string, 'org62', { state: 'not_sent', created_at: e.created_at, updated_at: T('11-18 08:20') });
  const tt = readTable('se_task_types').find((r) => r.id === e.se_task_type_id)!;
  D.W(l, `event:${e.id}`, { op: 'create', after: { ...ev(e), Duration__c: Number(e.duration_hours).toFixed(2).replace(/0$/, ''), SE_Task_Type__c: String(tt.name), Opportunity__c: e.what_org62_id, Description: e.description }, state: 'proposed', origin: 'canvas', draft_id: DID('cv-batch-1116'), created_at: T('11-16 16:49:30') });
}
// 2. deal contributions
const r1 = D.reqs.find((r) => r.id === uid('deal_contribution_requests', 'dcr-oakhallow-pilot'))!; const r2 = D.reqs.find((r) => r.id === uid('deal_contribution_requests', 'dcr-ferrowpay-pilot'))!; const r3 = D.reqs.find((r) => r.id === uid('deal_contribution_requests', 'dcr-harrowgate'))!;
for (const [r, dc, role, split, opp] of [[r1, 'dc-2', 'AI + Data Architect', '50', 'oakhallow-agentforce-pilot'], [r2, 'dc-3', 'Solution Architect', '33', 'ferrowpay-risk-score-pilot']] as const) {
  const dcRow = D.dcs.find((x) => x.id === uid('deal_contributions', dc))!;
  const l = D.L('deal_contribution', r.id as string, 'org62', { external_id: dcRow.org62_dc_id as string, state: 'verified', remote_values: { Opportunity_Role__c: role, Split_Percentage__c: split }, verified_at: T('10-25 13:05'), last_read_at: T('11-18 06:41'), created_at: T('10-24 12:02'), updated_at: T('11-18 06:41') });
  D.W(l, `dc:${oppSf(opp)}`, { op: 'create', after: { Opportunity__c: oppSf(opp), Opportunity_Role__c: role, Split_Percentage__c: split, Comments__c: String(r.comment) }, state: 'verified', origin: 'canvas', draft_id: DID('cv-work-1024'), sent_at: T('10-24 12:02:12'), verified_at: T('10-25 13:05'), created_at: T('10-24 12:02') });
}
const l3 = D.L('deal_contribution', r3.id as string, 'org62', { state: 'staged', created_at: T('11-14 09:19'), updated_at: T('11-14 09:20') });
D.W(l3, `dc:${oppSf('harrowgate-maintenance-agent')}`, { op: 'create', after: { Opportunity__c: oppSf('harrowgate-maintenance-agent'), Opportunity_Role__c: 'AI + Data Architect', Split_Percentage__c: '40', Comments__c: String(r3.comment) }, state: 'staged', origin: 'canvas', draft_id: DID('cv-dc-1114'), created_at: T('11-14 09:19') });
for (const dc of D.dcs.filter((x) => x.id === uid('deal_contributions', 'dc-1') || x.id === uid('deal_contributions', 'dc-5'))) {
  D.L('deal_contribution', dc.id as string, 'org62', { external_id: dc.org62_dc_id as string, state: 'verified', remote_values: { Opportunity_Role__c: String(dc.role), Split_Percentage__c: String(dc.split_percent) }, verified_at: T('10-22 12:30'), last_read_at: T('11-18 06:41'), created_at: T('10-22 12:20'), updated_at: T('11-18 06:41') });
}
// 3. use cases (both destinations) and VDP assets
const ucByVdp = new Map(ucRows.map((r) => [r.vdp_use_case_id as string, r]));
const DRIFT = new Set(['vdp-uc-smpl-007']);
const ucLanding = new Map<string, string>();
for (const [vid, u] of ucByVdp) {
  const o = ocase.get(vid); if (!o) continue;
  const oL = D.L('use_case', u.id as string, 'org62', { external_id: o.org62_use_case_id as string, state: 'verified', remote_values: { Account__c: String(o.org62_account_id), Go_Live_Date__c: (o.go_live_date as string | null) ?? null, Opportunity__c: String(o.org62_opportunity_id), Product__c: String(o.product), Stage__c: String(o.stage), Use_Case_Name__c: String(o.name) }, verified_at: o.last_seen_at as string, last_read_at: o.last_seen_at as string, created_at: o.first_seen_at as string, updated_at: o.last_seen_at as string });
  void oL;
  const track = String(o.product) === 'Data 360' ? 'data360' : 'agentforce';
  const vL = D.L('use_case', u.id as string, 'vdp', { external_id: vid, state: DRIFT.has(vid) ? 'differs' : 'verified', remote_values: { title: String(u.title), track, execution_phase: DRIFT.has(vid) ? 'In Development' : null, execution_target_date: DRIFT.has(vid) ? null : ((o.go_live_date as string | null) ?? null) }, verified_at: DRIFT.has(vid) ? null : T('11-18 06:45'), last_read_at: T('11-18 06:45'), created_at: o.first_seen_at as string, updated_at: T('11-18 06:45') });
  ucLanding.set(vid, vL);
}
const vw = (vid: string, draft: string, rowKey: string, o: Partial<Row>) => D.W(ucLanding.get(vid)!, rowKey, { draft_id: DID(draft), origin: 'vdp', ...o });
vw('vdp-uc-smpl-003', 'v-hv-uc-create', 'uc:vdp-uc-smpl-003', { op: 'create', after: { title: 'Unified Member Profile', track: 'data360', execution_target_date: '2027-02-01' }, state: 'verified', sent_at: T('11-09 16:40:12'), verified_at: T('11-09 16:52'), created_at: T('11-09 16:30') });
vw('vdp-uc-smpl-005', 'v-qp-golive', 'uc:vdp-uc-smpl-005', { op: 'update', before: { execution_target_date: null }, after: { execution_target_date: '2027-04-30', execution_phase: 'Scoped' }, state: 'verified', sent_at: T('11-14 11:20:09'), verified_at: T('11-14 11:35'), created_at: T('11-14 11:10') });
vw('vdp-uc-smpl-007', 'v-pc-golive', 'uc:vdp-uc-smpl-007', { op: 'update', before: { execution_target_date: null, execution_phase: 'Scoped' }, after: { execution_target_date: '2026-12-15', execution_phase: 'In Development' }, state: 'sent', sent_at: T('11-16 10:45:14'), reason: 'Read-back: VDP kept the phase but not the date', created_at: T('11-16 10:30') });
vw('vdp-uc-smpl-003', 'v-hv-title', 'uc:vdp-uc-smpl-003:title', { op: 'update', before: { title: 'Unified Profile' }, after: { title: 'Unified Member Profile' }, state: 'staged', created_at: T('11-15 14:36') });
vw('vdp-uc-smpl-008', 'v-to-deck', 'uc:vdp-uc-smpl-008', { op: 'update', before: { execution_target_date: null }, after: { execution_target_date: '2027-01-15' }, state: 'staged', created_at: T('11-10 10:25:35') });
vw('vdp-uc-smpl-004', 'v-aw-uc-title', 'uc:vdp-uc-smpl-004', { op: 'update', before: { title: 'Patient Data Foundation' }, after: { title: 'Enterprise Patient Data Foundation' }, state: 'removed', created_at: T('11-02 07:10') });
const cands = readTable('vdp_asset_candidates');
for (const c of cands.filter((x) => ['in_vdp', 'added'].includes(String(x.status)))) {
  D.L('asset', String(c.asset_key), 'vdp', { external_id: String(c.asset_key), state: c.status === 'added' ? 'sent' : 'verified', remote_values: { title: String(c.title), type: String(c.kind), url: String(c.url) }, verified_at: c.status === 'added' ? null : T('11-18 06:45'), last_read_at: T('11-18 06:45'), created_at: T('10-27 08:00'), updated_at: T('11-18 06:45') });
}
for (const [asset, draft, title, kind, url] of [['drive:1smpltodemo', 'v-to-deck', 'Elderglen Outdoors Agentforce Order Status Demo', 'deck', 'https://slides.example.com/presentation/d/1smpltodemo/edit'], ['drive:1smplqparch', 'v-qp-arch-deck', 'Ferrowpay Fraud Agent Architecture', 'deck', 'https://slides.example.com/presentation/d/1smplqparch/edit'], ['drive:1smplhvblueprint', 'v-hv-owners-assets', 'Saltmere POC Solution Blueprint', 'doc', 'https://docs.example.com/document/d/1smplhvblueprint/edit'], ['drive:1smplhvsuccess', 'v-hv-owners-assets', 'Saltmere POC Success Criteria', 'doc', 'https://docs.example.com/document/d/1smplhvsuccess/edit'], ['drive:1smplhvdemoscript', 'v-hv-owners-assets', 'Saltmere Member Services Demo Script', 'doc', 'https://docs.example.com/document/d/1smplhvdemoscript/edit']] as const) {
  const l = D.L('asset', asset, 'vdp', { state: 'not_sent', created_at: T('11-10 10:25'), updated_at: T('11-18 08:21') });
  D.W(l, `asset:${asset}`, { op: 'create', after: { title, type: kind, url }, state: 'staged', origin: 'vdp', draft_id: DID(draft), created_at: T('11-18 08:20:40') });
}

// ── write ────────────────────────────────────────────────────────────────────────────────────────
const entryRows = built.map((b) => b.row);
const tr = tools.runs;
for (const r of reservedFor('claude_sessions')) if (!sb.byKey.has(String(r.key))) throw new Error(`reserved claude session ${r.key} missing`);
for (const r of reservedFor('tool_runs')) if (!tr.some((x) => x.id === uid('tool_runs', r.key))) throw new Error(`reserved tool run ${r.key} missing`);

writeTable('drafts', draftRows);
writeTable('draft_recipients', bd.flatMap((b) => b.recipients));
writeTable('draft_renditions', bd.flatMap((b) => b.renditions).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))));
writeTable('draft_send_attempts', attemptRows);
writeTable('draft_verifications', verRows);
writeTable('activity_entries', entryRows.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at))));
writeTable('time_blocks', bb.blocks);
writeTable('activity_entry_time_blocks', links);
writeTable('canvases', cv.canvases);
writeTable('canvas_sync_runs', cv.runs.sort((a, b) => String(a.started_at).localeCompare(String(b.started_at))));
writeTable('canvas_lines', cv.lines);
writeTable('record_landings', D.landings);
writeTable('landing_writes', D.writes);
writeTable('deal_contributions', D.dcs);
writeTable('deal_contribution_requests', D.reqs);
writeTable('missed_opp_sweeps', D.sweeps);
writeTable('missed_opp_findings', D.findings);
writeTable('claude_sessions', sb.sessions.sort((a, b) => String(a.started_at).localeCompare(String(b.started_at))));
writeTable('claude_session_segments', sb.segments);
writeTable('tool_adapters', tools.adapters);
writeTable('tool_runs', tr);
writeTable('tool_run_outputs', tools.outputs);

writeFileSync(path.join(SAMPLE_DIR, 'CAST-outbox.md'), writeCastOutbox({ drafts: all, draftRows, built, sb, tools, cv, D, bb, links, attemptRows, verRows }));
flushRefs('outbox');
if (warnings.length) console.log('WARNINGS\n' + warnings.join('\n'));
void acctSf; void plusMin; void siId; void sha; void (null as unknown as Att);
