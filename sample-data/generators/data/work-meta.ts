/** Domain 04: extractors, extraction candidates, change proposals, reopen decisions, initiatives, links and relations. */
import { OWNER, ref, reservedFor, sha, uid } from '../../lib/kit';
import type { Row } from '../../lib/kit';
import type { Built } from './work-core';
import { extractorOfSource, iniOf, srcOf } from './work-core';
import { calId, csId, csNear, exId, llmNear, ms, mt, plus, siId, siRow, wiId, wiKey, assetId, R } from './work-lib';

// ── extractors ───────────────────────────────────────────────────────────────────────────────────
interface Ex { key: string; kind: 'parser' | 'rule' | 'llm' | 'user' | 'chat'; tier: 'none' | 'haiku' | 'sonnet' | 'opus'; skill?: string; desc: string }
const EXTRACTORS: Ex[] = [
  { key: 'link-resolver:1', kind: 'llm', tier: 'haiku', skill: 'link-resolver', desc: 'LLM link resolver behind every source_item_links row with method llm.' },
  { key: 'scan-slack:1.7.0', kind: 'llm', tier: 'haiku', skill: 'scan-slack', desc: 'Slack scanner: proposes work items, links evidence, reports coverage.' },
  { key: 'scan-gmail:3', kind: 'llm', tier: 'haiku', skill: 'scan-gmail', desc: 'Gmail scanner (inbox and sent): asks of me, promises by me, unlinked mail.' },
  { key: 'scan-gemini-notes:3', kind: 'llm', tier: 'haiku', skill: 'scan-gemini-notes', desc: 'Meeting notes scanner: summaries and next steps assigned to me.' },
  { key: 'scan-drive:1', kind: 'llm', tier: 'haiku', skill: 'scan-drive', desc: 'Drive scanner: revisions, asset snapshots and diffs, deliverable progress.' },
  { key: 'scan-calendar:2', kind: 'llm', tier: 'haiku', skill: 'scan-calendar', desc: 'Calendar scanner: meetings, prep, missed meetings, travel holds.' },
  { key: 'scan-claude-sessions:2', kind: 'llm', tier: 'haiku', skill: 'scan-claude-sessions', desc: 'Claude session scanner: work done and promises made inside sessions.' },
  { key: 'scan-org62:1.7.0', kind: 'llm', tier: 'haiku', skill: 'scan-org62', desc: 'Org62 scanner: events, opportunity changes, deal contribution gaps.' },
  { key: 'scan-trainings:1', kind: 'llm', tier: 'haiku', skill: 'scan-trainings', desc: 'Mandatory training emails and learning platform reminders.' },
  { key: 'check-completion:1.3.0', kind: 'llm', tier: 'haiku', skill: 'check-completion', desc: 'Completion pass: is this item finished given the new messages?' },
  { key: 'check-completion:1.3.0-sonnet', kind: 'llm', tier: 'sonnet', skill: 'check-completion', desc: 'Escalation of the completion pass for unclear cases.' },
  { key: 'settle-item:1.5.0', kind: 'llm', tier: 'haiku', skill: 'settle-item', desc: 'Settle pass: does this item still need me now?' },
  { key: 'deliverable-requirements:1', kind: 'llm', tier: 'sonnet', skill: 'nba-review-deliverable', desc: 'Extracts the requested changes of a deliverable from the asks around it.' },
  { key: 'gemini-next-steps:1', kind: 'parser', tier: 'none', desc: 'Parses the "Suggested next steps" checklist of Gemini notes and keeps the lines assigned to me.' },
  { key: 'team-rules:1', kind: 'rule', tier: 'none', desc: 'Team pack rules that generate work: weekly log, VDP review, missed-DC sweep, quarter deadline.' },
  { key: 'user-manual:1', kind: 'user', tier: 'none', desc: 'Items and links typed or confirmed by the user in the app.' },
  { key: 'chat-assistant:1', kind: 'chat', tier: 'sonnet', skill: 'chat-assistant', desc: 'Assistant chat tool calls that create or change items.' },
  { key: 'missed-opp-sweep:1', kind: 'llm', tier: 'haiku', skill: 'scan-org62', desc: 'Finds opportunities I worked on without being on the team.' },
  { key: 'reconcile-slack:1', kind: 'llm', tier: 'haiku', skill: 'scan-slack', desc: 'Reconcile pass over coverage gaps and stale active items.' },
  { key: 'meeting-matcher:1', kind: 'rule', tier: 'none', desc: 'Matches calendar events to opportunities (title tokens, attendees, meeting-to-opp rules).' },
  { key: 'identity-detect:1', kind: 'llm', tier: 'haiku', skill: 'detect-identity', desc: 'Detects people who appear under two identities.' },
  { key: 'initiative-grouper:1', kind: 'llm', tier: 'haiku', skill: 'scan-slack', desc: 'Groups related work items into an initiative.' },
];
export function buildExtractors(): Row[] {
  const rows = EXTRACTORS.map((e) => {
    const [key, version] = [e.key.slice(0, e.key.lastIndexOf(':')), e.key.slice(e.key.lastIndexOf(':') + 1)];
    return { id: uid('extractors', e.key), key, version, kind: e.kind, model_tier: e.tier, model: e.tier === 'haiku' ? 'claude-haiku-5-5' : e.tier === 'sonnet' ? 'claude-sonnet-5-5' : null, skill_key: e.skill ?? null, prompt_hash: e.skill ? sha(`skills/${e.skill}.md@${version}`) : null, description: e.desc, created_at: plus(mt('10-18 15:10'), 0, 0) } as Row;
  });
  // any other reserved extractor key becomes a row too
  for (const r of reservedFor('extractors')) {
    const k = String(r.key);
    if (!rows.some((x) => x.id === uid('extractors', k))) rows.push({ id: uid('extractors', k), key: k.split(':')[0]!, version: k.split(':')[1] ?? '1', kind: 'llm', model_tier: 'haiku', model: 'claude-haiku-5-5', skill_key: null, prompt_hash: null, description: r.note, created_at: mt('10-18 15:10') });
  }
  return rows;
}
export const EXTRACTOR_KEYS = EXTRACTORS.map((e) => e.key);

// ── extraction candidates ────────────────────────────────────────────────────────────────────────
export function buildCandidates(built: Built[]): { rows: Row[]; byItem: Map<number, string> } {
  const rows: Row[] = []; const byItem = new Map<number, string>();
  const titleOf = new Map(built.map((b) => [b.spec.n, b]));
  const kindOk: Record<string, string> = { task: 'task', commitment: 'commitment', ask: 'ask', training: 'training', background_promise: 'background_promise', travel: 'travel', missed_meeting_followup: 'missed_meeting_followup' };
  const ordCount = new Map<string, number>();
  const nextOrd = (si: string, ex: string) => { const k = `${si}|${ex}`; const n = ordCount.get(k) ?? 0; ordCount.set(k, n + 1); return n; };
  const push = (r: Row) => { rows.push(r); };
  for (const b of built) {
    const s = b.spec;
    if (!['asked_of_me', 'said_by_me', 'meeting_next_step', 'reconcile'].includes(s.og)) continue;
    const o = s.ev?.[0]; if (!o || !o[0].startsWith('si-')) continue;
    const source = String(siRow(o[0]).source);
    const exKey = source === 'gemini_notes' ? 'gemini-next-steps:1' : extractorOfSource(source);
    const ord = nextOrd(o[0], exKey);
    const created = b.created;
    const needsTriage = s.init === 'suggested' && (o[2] < 0.5);
    const id = uid('extraction_candidates', `${wiKey(s.n)}:0`);
    byItem.set(s.n, id);
    const dueText = s.due ? (source === 'gemini_notes' ? (s.title.length % 2 ? 'next week' : 'Friday') : null) : null;
    push({
      id, owner_user_id: OWNER, source_item_id: siId(o[0]), extractor_id: exId(exKey), ordinal: ord, proposed_kind: kindOk[s.k] ?? 'task', proposed_title: s.title.length > 110 ? s.title.slice(0, 107) + '...' : s.title,
      proposed_due_at: s.due ? mt(s.due) : null, due_text: dueText, assignee_text: s.og === 'said_by_me' ? 'me' : source === 'gemini_notes' ? 'Rafael Okonkwo' : 'Rafael', assigned_to_me: true, shared_assignment: s.n === 75 || s.n === 76,
      counterparty_person_id: s.cp ? uid('people', s.cp) : null, confidence: o[2], decision: needsTriage ? 'needs_triage' : 'created', work_item_id: b.id, merge_score: null, merge_rationale: null,
      llm_call_id: llmNear(s.k === 'commitment' ? 'commitment_extract' : 'scan_extract', source === 'gemini_notes' ? 'scan-gemini-notes' : `scan-${source}`, created, 240), decided_at: created, decided_by: 'engine', created_at: plus(created, -1, 0), updated_at: created,
    });
  }
  // candidates that merged into an existing item instead of creating one
  const merged: Array<[string, string, number, number, string, number]> = [
    ['si-275', 'Share blueprint outline (next Wednesday)', 3, 0.81, 'Same deliverable as the blueprint commitment: both are the Saltmere solution blueprint for Priyanka.', 0],
    ['si-673', 'Confirm IdP groups to permission sets mapping in writing (before Thursday)', 6, 0.91, 'Same ask as Soo-jin\'s Slack message of 11/16.', 0],
    ['si-533', 'Schedule the order status demo (this week)', 31, 0.88, 'The open ask from Nadia is the same demo.', 0],
    ['si-506', 'Propose architecture session times (Monday)', 65, 0.7, 'Same Ferrowpay architecture session scheduling.', 0],
    ['si-648', 'Send the section 3 redline (tomorrow)', 60, 0.93, 'Same addendum section 3 redline.', 0],
    ['si-174', 'Add top 5 pursuits to the planning doc (Friday)', 83, 0.9, 'Same ask Hana sent by email and Slack.', 0],
    ['si-498', 'Complete the privacy refresh training (before 11/21)', 21, 0.95, 'The mandatory training item already exists.', 0],
    ['si-326', 'Finish privacy training (before Saturday)', 21, 0.94, 'Same mandatory training.', 1],
    ['si-525', 'Review the logging canvas draft (Friday)', 84, 0.9, 'Same review Hana asked for in Slack.', 0],
    ['si-466', 'Update the agenda doc (tomorrow)', 53, 0.86, 'Same Cascadia agenda deliverable.', 0],
    ['si-319', 'Join the pricing call with Priyanka after the sync (today)', 33, 0.8, 'The pricing walkthrough ask is already tracked.', 1],
  ];
  for (const [si, title, into, score, why, ord] of merged) {
    const b = titleOf.get(into)!;
    const t = plus(siRow(si).first_seen_at as string, 6, 10);
    push({
      id: uid('extraction_candidates', `merge:${si}:${into}`), owner_user_id: OWNER, source_item_id: siId(si), extractor_id: exId('gemini-next-steps:1'), ordinal: nextOrd(si, 'gemini-next-steps:1') + ord * 0, proposed_kind: 'commitment', proposed_title: title, proposed_due_at: null, due_text: null,
      assignee_text: 'Rafael Okonkwo', assigned_to_me: true, shared_assignment: false, counterparty_person_id: null, confidence: 0.85, decision: 'merged', work_item_id: b.id, merge_score: score, merge_rationale: why,
      llm_call_id: llmNear('scan_extract', 'scan-gemini-notes', t, 600), decided_at: ms(t) > ms(b.created) ? t : plus(b.created, 2, 0), decided_by: 'engine', created_at: plus(t, -1, 0), updated_at: t,
    });
  }
  // proposals the user rejected or that have not been decided yet
  const extra: Array<[string, string, string, number, 'pending' | 'rejected' | 'needs_triage', string | null, string]> = [
    ['si-075', 'Propose the member key strategy for identity resolution (next Tuesday)', 'commitment', 0.7, 'rejected', 'user', 'Already covered in the data model workshop write-up.'],
    ['si-694', 'Tell Brendan that refunds are not exposed in the OMS sandbox', 'task', 0.46, 'pending', null, ''],
    ['si-684', 'Tailor the Tuesday readout for the county CIO', 'task', 0.58, 'pending', null, ''],
    ['si-662', 'Add a 20% buffer to the Yarrowdale Phase 2 sizing', 'task', 0.52, 'rejected', 'engine', 'Gustavo already changed the proposal.'],
    ['si-709', 'Reply to the Learning Platform reminder', 'task', 0.3, 'rejected', 'engine', 'Reminder, not an ask.'],
    ['si-713', 'Update Voltmere close date in my notes', 'task', 0.22, 'pending', null, ''],
  ];
  extra.forEach(([si, title, kind, conf, decision, by, note], i) => {
    const r = siRow(si); const t = plus(r.first_seen_at as string, 4, 10 + i);
    push({
      id: uid('extraction_candidates', `extra:${si}`), owner_user_id: OWNER, source_item_id: siId(si), extractor_id: exId(String(r.source) === 'gemini_notes' ? 'gemini-next-steps:1' : extractorOfSource(String(r.source))), ordinal: nextOrd(si, String(r.source) === 'gemini_notes' ? 'gemini-next-steps:1' : extractorOfSource(String(r.source))), proposed_kind: kind, proposed_title: title,
      proposed_due_at: null, due_text: null, assignee_text: 'Rafael', assigned_to_me: true, shared_assignment: false, counterparty_person_id: null, confidence: conf, decision: decision === 'needs_triage' ? 'needs_triage' : decision, work_item_id: null,
      merge_score: null, merge_rationale: note || null, llm_call_id: llmNear('scan_extract', `scan-${r.source === 'gemini_notes' ? 'gemini-notes' : r.source}`, t, 600), decided_at: decision === 'pending' ? null : t, decided_by: decision === 'pending' ? null : by, created_at: t, updated_at: t,
    });
  });
  return { rows, byItem };
}

// ── change proposals ─────────────────────────────────────────────────────────────────────────────
export function buildProposals(b: (n: number) => Built): Row[] {
  const rows: Row[] = [];
  const p = (key: string, o: { n: number; field: string; group?: string; cur: unknown; prop: unknown; reason: string; si?: string; ev?: number; ex?: string; at: string; conf?: number; status: string; decided?: string; by?: string; cs?: number; sup?: string; baseV?: number }) => {
    const item = b(o.n);
    rows.push({
      id: uid('change_proposals', key), owner_user_id: OWNER, entity_type: 'work_items', entity_id: item.id, field: o.field, group_id: uid('change_proposals', `group:${o.group ?? key}`), current_value: o.cur ?? null, proposed_value: o.prop, reason: o.reason,
      source_item_id: o.si ? siId(o.si) : null, evidence_id: o.ev != null ? item.evIds[o.ev] ?? null : null, extractor_id: o.ex ? exId(o.ex) : null, llm_call_id: llmNear('done_match', 'check-completion', o.at, 600) ?? null, confidence: o.conf ?? null,
      base_version: o.baseV ?? (item.row.version as number), status: o.status, decided_at: o.decided ? mt(o.decided) : null, decided_by: o.by ?? null, applied_change_set_id: o.cs ? csId(o.cs) : null, superseded_by_id: o.sup ? uid('change_proposals', o.sup) : null, created_at: o.at,
    });
  };
  p('wi088-due', { n: 88, field: 'due_at', cur: '2026-11-10T22:59:35.763Z', prop: '2026-11-08T22:59:35.763Z', reason: 'You asked chat to pull the trust domain write-up forward to the weekend.', at: mt('11-06 15:50:19'), status: 'accepted', decided: '11-06 15:59:35', by: 'chat', cs: 238, conf: 0.9, baseV: 3 });
  p('wi015-due', { n: 15, field: 'due_at', cur: '2026-11-20T20:17:05.241Z', prop: '2026-11-18T20:17:05.241Z', reason: 'Chat moved the sections 6 and 7 deadline to Wednesday so Thursday stays free for review.', at: mt('11-16 13:17:05'), status: 'accepted', decided: '11-16 13:17:05', by: 'chat', cs: 442, conf: 0.9, baseV: 3 });
  p('wi075-status', { n: 75, field: 'status', cur: 'open', prop: 'done', reason: 'You told chat the one-page phases view went to Constance.', at: mt('11-17 07:52:49'), status: 'accepted', decided: '11-17 07:52:49', by: 'chat', cs: 461, conf: 0.95, baseV: 3 });
  p('wi054-snooze', { n: 54, field: 'snoozed_until', cur: null, prop: '2026-11-13T17:20:16.565Z', reason: 'You asked chat to snooze it until the export baseline lands.', at: mt('11-12 10:20:16'), status: 'accepted', decided: '11-12 10:20:16', by: 'chat', cs: 376, conf: 0.9, baseV: 3 });
  p('wi008-dismiss', { n: 8, field: 'status', group: 'wi008-quiet', cur: 'waiting_on_others', prop: 'dismissed', reason: 'No reply for 24 days after two nudges (gone_quiet is set to ask in your closing settings). Close it, or keep chasing?', si: 'si-415', at: mt('11-18 08:58:30'), status: 'pending', conf: 0.66, ex: 'settle-item:1.5.0' });
  p('wi008-resolution', { n: 8, field: 'resolution', group: 'wi008-quiet', cur: null, prop: 'not_needed', reason: 'Proposed together with the status change above.', si: 'si-415', at: mt('11-18 08:58:30'), status: 'pending', conf: 0.66, ex: 'settle-item:1.5.0' });
  p('wi060-due-old', { n: 60, field: 'due_at', cur: '2026-11-16T19:00:00.000Z', prop: '2026-11-18T21:30:00.000Z', reason: 'Theo says legal needs the sign-off before the Wednesday call.', si: 'si-652', ev: 3, at: mt('11-18 08:52:10'), status: 'superseded', decided: '11-18 08:53:40', by: 'system', conf: 0.7, sup: 'wi060-due-new', ex: 'check-completion:1.3.0' });
  p('wi060-due-new', { n: 60, field: 'due_at', group: 'wi060-reopen', cur: '2026-11-18T21:30:00.000Z', prop: '2026-11-25T23:59:00.000Z', reason: 'Valentina proposes signing next week after legal adds severity 2 wording.', si: 'si-695', ev: 7, at: mt('11-18 08:53:40'), status: 'pending', conf: 0.74, ex: 'check-completion:1.3.0' });
  p('wi060-purpose', { n: 60, field: 'purpose', group: 'wi060-reopen', cur: 'Theo: the order form is blocked on my sign-off; Valentina\'s legal now also wants severity 2 response times in the addendum body.', prop: 'Propose severity 2 response-time wording for section 3; legal wants it in the addendum body before signing.', reason: 'The ask changed from review to proposing wording.', si: 'si-695', ev: 7, at: mt('11-18 08:53:40'), status: 'pending', conf: 0.7, ex: 'check-completion:1.3.0' });
  p('wi051-done', { n: 51, field: 'status', cur: 'likely_done', prop: 'done', reason: 'Flight and hotel confirmations match the trip; mark done and let the expense report be its own item.', si: 'si-692', ev: 4, at: mt('11-18 08:58:50'), status: 'pending', conf: 0.82, ex: 'check-completion:1.3.0' });
  p('wi044-dismiss', { n: 44, field: 'status', cur: 'open', prop: 'dismissed', reason: 'Missed meeting follow-up older than 3 days with no new messages.', at: mt('11-13 07:10'), status: 'rejected', decided: '11-13 08:20', by: 'user', conf: 0.5, ex: 'settle-item:1.5.0', baseV: 1 });
  p('wi018-importance', { n: 18, field: 'importance', cur: 'normal', prop: 'high', reason: 'Priyanka and Theo both mention the deadline; the questionnaire gates the board.', si: 'si-678', ev: 1, at: mt('11-18 08:09:20'), status: 'pending', conf: 0.6, ex: 'settle-item:1.5.0' });
  p('wi062-expired', { n: 62, field: 'due_at', cur: '2026-11-16T22:00:00.000Z', prop: '2026-11-20T22:00:00.000Z', reason: 'Corwin asked for a weekly digest, so the due date repeats on Fridays.', at: mt('11-14 09:30'), status: 'expired', decided: '11-16 09:00', by: 'system', conf: 0.4, ex: 'check-completion:1.3.0', baseV: 1 });
  return rows;
}

// ── reopen decisions ─────────────────────────────────────────────────────────────────────────────
export function buildReopens(b: (n: number) => Built): Row[] {
  const out: Row[] = [];
  const cs = (iso: string) => csNear('engine.reeval@', iso, 600) ?? csNear('engine.completion@', iso, 1440) ?? csId(1);
  const add = (key: string, o: { done: number; si: string; ev?: number; outcome: 'reopened' | 'new_sibling' | 'attached_as_context' | 'ignored'; rule: string; why: string; newN?: number; tr?: number; conf?: number; person?: string; at?: string }) => {
    const item = b(o.done);
    const trig = siRow(o.si);
    const at = o.at ?? plus(trig.first_seen_at as string, 3, 40);
    out.push({
      id: uid('reopen_decisions', key), owner_user_id: OWNER, done_work_item_id: item.id, trigger_source_item_id: siId(o.si), trigger_evidence_id: o.ev != null ? item.evIds[o.ev] ?? null : null, outcome: o.outcome, rule_key: o.rule, explanation: o.why,
      new_work_item_id: o.newN ? wiId(o.newN) : null, initiative_id: iniOf(item.spec) ? uid('initiatives', iniOf(item.spec)!) : null, transition_id: o.tr ?? null, confidence: o.conf ?? 0.8, decided_by: 'engine', change_set_id: cs(at), undone_at: null, undone_by_change_set_id: null,
      created_at: at, trigger_person_id: o.person ? uid('people', o.person) : null,
    });
  };
  const reopenStep = b(60).steps.find((s) => s.opts.reopen)!;
  add('pc-addendum-reopen', { done: 60, si: 'si-695', ev: 7, outcome: 'reopened', rule: 'counterparty_followup_same_thread', why: 'Valentina answered in the redline thread about five hours after the item closed (the reply reached the app this morning) and asked for more wording on the same section. Same person, same section: reopened instead of creating a second item.', tr: reopenStep.trId, conf: 0.91, person: 'pc-valentina', at: reopenStep.at });
  add('aw-lars-new-ask', { done: 79, si: 'si-416', outcome: 'new_sibling', rule: 'new_ask_same_conversation', why: 'The follow-ups were answered on 11/02. Constance\'s one-page phases request is a new, different ask for the same account, so it became its own item.', newN: 75, conf: 0.84, person: 'aw-constance', at: b(75).created });
  add('hv-soojin-new-ask', { done: 4, si: 'si-585', outcome: 'new_sibling', rule: 'new_ask_same_conversation', why: 'The identity answer was settled on 10/31. SAML attribute mapping is a new question from the same person.', newN: 11, conf: 0.76, person: 'hv-soojin', at: b(11).created });
  add('hv-marisol-status-sibling', { done: 24, si: 'si-651', ev: 3, outcome: 'attached_as_context', rule: 'new_ask_same_conversation', why: 'The week 3 reply was done; Marisol\'s week 4 request belongs to the weekly status commitment that already exists.', conf: 0.88, person: 'hv-marisol', at: b(14).created });
  add('cc-badges-context', { done: 56, si: 'si-684', ev: 5, outcome: 'attached_as_context', rule: 'related_update_no_new_ask', why: 'The final attendee list is information about the same registration, not a new request.', conf: 0.7, person: 'ae-commercial' });
  add('pc-topics-context', { done: 63, si: 'si-628', ev: 2, outcome: 'attached_as_context', rule: 'related_update_no_new_ask', why: 'Gustavo points to the sanitized topic instructions; useful context, nothing left to do.', conf: 0.65, person: 'spec-gustavo' });
  add('bw-tariq-ignored', { done: 47, si: 'si-184', outcome: 'ignored', rule: 'acknowledgement_only', why: 'Tariq thanks me for covering the demo. A thank-you does not reopen finished work.', conf: 0.9, person: 'se-tariq' });
  return out;
}
