/**
 * Items 1, 6, 7, 8 and 9 (work, calendar, chat, priority):
 *  - 1: the Elderglen reply draft points at the live NBA (wi-031 v2, ready); v1 stays superseded
 *  - 6: opportunity created_at before updated_at, landing_writes / time_blocks / work_item_relations never "after now"
 *  - 7: resolution superseded, origin reconcile, transitions out of likely_done and waiting_on_others, calendar needs_action,
 *       chat tool-call statuses (failed, rejected)
 *  - 8: priority rule-hit explanations name the item; chat tool-call statuses
 *  - 9: one more reopen decision (a reopened item with its done -> open -> done transitions)
 */
import { rng } from '../../lib/kit';
import { OWNER, ms, iso, plus, mt, NOW, MIN, HOUR, DAY, readTable, writeTable, uid, type Row } from './realism-lib';

export function work() {
  const R = rng('realism-work');
  const wi = readTable('work_items'); const wiN = (n: number) => wi[n - 1]!; const wiNo = new Map(wi.map((w, i) => [String(w.id), i + 1]));
  const trans = readTable('work_item_transitions'); let tid = trans.reduce((m, t) => Math.max(m, Number(t.id)), 0);
  const cs = readTable('change_sets');

  // ── 1. the draft's NBA ──
  const drafts = readTable('drafts'); const dr = drafts.find((d) => d.id === uid('drafts', 'rev-elderglen-demo-reply'))!; dr.nba_id = uid('next_best_actions', 'wi-031:v2'); writeTable('drafts', drafts);

  // ── 6. timestamp causality ──
  const opps = readTable('opportunities');
  for (const o of opps) if (String(o.created_at) > String(o.updated_at)) o.created_at = iso(ms(o.updated_at) - (30 + R.int(0, 150)) * DAY - R.int(0, 12) * HOUR);
  writeTable('opportunities', opps);
  const lw = readTable('landing_writes'); for (const l of lw) if (String(l.created_at) > String(l.updated_at)) l.updated_at = l.created_at; writeTable('landing_writes', lw);
  const tb = readTable('time_blocks');
  for (const b of tb) if (String(b.created_at) > NOW) {
    const planned = String(b.starts_at) > NOW; const c = planned ? mt('11-13', `${9 + R.int(0, 3)}:${R.pick(['05', '20', '40'])}`) : iso(Math.min(ms(b.ends_at), ms(NOW) - 4 * MIN));
    b.created_at = c; b.updated_at = c;
  }
  writeTable('time_blocks', tb);
  const rel = readTable('work_item_relations'); for (const r of rel) if (String(r.created_at) > NOW) r.created_at = iso(ms(NOW) - 70_000); writeTable('work_item_relations', rel);

  // ── 7. superseded + reconcile origins ──
  const w102 = wiN(102); w102.resolution = 'superseded'; w102.resolution_work_item_id = wiN(48).id; w102.resolution_person_id = null;
  w102.resolution_note = 'Superseded by the Slack ask to run the second demo on Tuesday 11/10: the session was scheduled there, so this separate scheduling item was not needed.'; w102.version = Number(w102.version) + 1; w102.updated_at = w102.done_at;
  // two items the reconcile pass created from a source item no scan had linked
  for (const n of [94, 95]) { const w = wiN(n); w.origin = 'reconcile'; }
  const tr = (n: number) => trans.filter((t) => t.work_item_id === wiN(n).id).sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
  for (const n of [94, 95]) { const first = tr(n)[0]!; first.actor_kind = 'engine'; first.actor_ref = 'engine.reconcile@1'; first.reason = 'Created by reconcile: a source item the scan had not linked'; }

  // ── 7. transitions out of likely_done / waiting_on_others (done items that took several steps) ──
  const engineCs = cs.filter((c) => c.kind === 'engine_pass').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const nearCs = (t: string) => { let best: Row | null = null; for (const c of engineCs) if (String(c.created_at) <= t) best = c; return best ? String(best.id) : null; };
  const add = (w: Row, from: string, to: string, at: string, reason: string, actor = 'engine', ref = 'engine.settle@1.5.0', ev: unknown = null) => {
    tid++; trans.push({ id: tid, work_item_id: w.id, from_status: from, to_status: to, actor_kind: actor, actor_ref: ref, reason, evidence_id: ev, change_set_id: null, occurred_at: at, undone_at: null, undone_by_change_set_id: null });
  };
  const LD: Array<[number, string]> = [[1, 'The document gained the success-criteria sections the commitment named; waiting one more scan to be sure.'], [23, 'The readout outline exists in Drive and was shared; the engine waited for the next edit before closing.'], [38, 'The validation plan doc matches the commitment; likely finished.'], [46, 'The deck was shared in the thread; waiting to see whether the recipient replied.'], [67, 'The mapping doc now has the merchant hierarchy section; likely finished.']];
  for (const [n, why] of LD) {
    const w = wiN(n); const list = tr(n); const T = list.find((t) => t.to_status === 'done' && t.from_status === 'open'); if (!T) continue;
    const prev = list.filter((t) => ms(t.occurred_at) < ms(T.occurred_at)).pop()!; const lt = Math.max(ms(prev.occurred_at) + 30 * MIN, ms(T.occurred_at) - 20 * HOUR);
    if (lt >= ms(T.occurred_at) - 10 * MIN) continue;
    add(w, 'open', 'likely_done', iso(lt), why, 'engine', String(T.actor_ref), T.evidence_id);
    T.from_status = 'likely_done'; T.reason = `Confirmed: ${String(T.reason).charAt(0).toLowerCase()}${String(T.reason).slice(1)}`;
    w.likely_done_at = iso(lt); w.likely_done_confidence = 0.8; w.version = Number(w.version) + 1;
  }
  const WO: Array<[number, string, string | null]> = [[33, 'Waiting for Priyanka to share the production volumes before the pricing walk-through.', null], [35, 'Waiting for Brendan to confirm which agent topics he wants covered.', 'reply'], [54, 'Waiting for Marisol to confirm the revised KPI baseline.', null], [104, 'Waiting for Linnea to pick a Friday slot for the dry run.', null], [19, 'Waiting for Beatrix to confirm the staff-call agenda before the slides are final.', null]];
  for (const [n, why, reply] of WO) {
    const w = wiN(n); const list = tr(n); const T = list.find((t) => (t.to_status === 'done') && (t.from_status === 'open' || t.from_status === 'likely_done')); if (!T) continue;
    const created = list[0]!; const span = ms(T.occurred_at) - ms(created.occurred_at); if (span < 3 * DAY) continue;
    const t1 = ms(created.occurred_at) + Math.round((span * 0.18) / HOUR) * HOUR; const mid = ms(created.occurred_at) + Math.round((span * 0.6) / HOUR) * HOUR;
    add(w, 'open', 'waiting_on_others', iso(t1), why, 'user', 'ui.edit');
    if (reply) { add(w, 'waiting_on_others', 'open', iso(mid), 'The reply arrived in the thread; back on my plate.', 'connector', 'scan:slack:inbox@3'); T.from_status = 'open'; }
    else T.from_status = 'waiting_on_others';
    w.version = Number(w.version) + 1;
  }
  // ── 9. a reopened item: wi-009 done 11-12, Priyanka asked for a change 11-13, done again 11-14 ──
  {
    const w = wiN(9); const t2 = mt('11-13', '08:20:11'); const t3 = mt('11-14', '11:05:42');
    add(w, 'done', 'open', t2, 'Priyanka replied in the same thread asking for the Flex Credits table to be added to the one-pager; reopened rather than a new item.', 'engine', 'engine.reeval@2');
    const reopenT = trans[trans.length - 1]!;
    add(w, 'open', 'done', t3, 'The updated one-pager was sent to Priyanka.', 'engine', 'engine.settle@1.5.0');
    w.reopened_count = 1; w.last_reopened_at = t2; w.done_at = t3; w.status_changed_at = t3; w.updated_at = t3; w.version = Number(w.version) + 2; w.last_new_info_at = t2;
    const src = readTable('source_items'); const links = readTable('source_item_links');
    const cand = src.filter((s) => (s.kind === 'email_message' || s.kind === 'slack_message') && String(s.occurred_at) > '2026-11-12T18:00:00.000Z' && String(s.occurred_at) < t2 && links.some((l) => l.source_item_id === s.id && l.account_id === w.account_id)).sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)))[0] ?? src.find((s) => s.kind === 'slack_message' && String(s.occurred_at) < t2)!;
    const rd = readTable('reopen_decisions');
    rd.push({ id: uid('reopen_decisions', 'real-wi-009'), owner_user_id: OWNER, done_work_item_id: w.id, trigger_source_item_id: cand.id, trigger_evidence_id: null, outcome: 'reopened', rule_key: 'counterparty_followup_same_thread', explanation: 'Priyanka answered in the thread of the one-pager I had just sent and asked for one more table. Same person, same document: reopened instead of creating a second item.', new_work_item_id: null, initiative_id: w.initiative_id ?? null, transition_id: Number(reopenT.id), confidence: 0.88, decided_by: 'engine', change_set_id: nearCs(t2), undone_at: null, undone_by_change_set_id: null, created_at: t2, trigger_person_id: w.counterparty_person_id ?? null });
    writeTable('reopen_decisions', rd);
  }
  // re-number transition ids by time; the reopen decisions follow
  const sorted = [...trans].sort((a, b) => ms(a.occurred_at) - ms(b.occurred_at) || Number(a.id) - Number(b.id)); const idMap = new Map<number, number>(); sorted.forEach((t, i) => { idMap.set(Number(t.id), i + 1); });
  const oldToNew = new Map<number, number>(); sorted.forEach((t, i) => oldToNew.set(Number(t.id), i + 1)); sorted.forEach((t, i) => { t.id = i + 1; });
  void idMap; void oldToNew; void nearCs; void wiNo;
  writeTable('work_item_transitions', sorted); writeTable('work_items', wi);
  const rd2 = readTable('reopen_decisions'); for (const r of rd2) if (r.transition_id != null) r.transition_id = oldToNew.get(Number(r.transition_id)) ?? null; writeTable('reopen_decisions', rd2);

  // ── 7. calendar: invitations I have not answered yet ──
  const ev = readTable('calendar_events'); const att = readTable('calendar_event_attendees'); const act = readTable('activity_entries');
  const used = new Set(act.map((a) => String(a.dedupe_key).split('|')[2]));
  const cand = ev.filter((e) => String(e.starts_at) > '2026-11-10T00:00:00.000Z' && e.status === 'confirmed' && !e.i_am_organizer && e.my_response === 'accepted' && !used.has(String(e.external_event_id)) && e.event_type === 'default').sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
  const pick = R.shuffle(cand).slice(0, 10);
  for (const e of pick) { e.my_response = 'needs_action'; for (const a of att) if (a.calendar_event_id === e.id && a.is_self) a.response_status = 'needs_action'; }
  writeTable('calendar_events', ev); writeTable('calendar_event_attendees', att);
  console.log(`  calendar my_response needs_action: ${pick.length}`);

  // ── 7/8. chat tool calls: failed reads (with the retry that succeeded) and one declined change ──
  const tc = readTable('chat_tool_calls');
  const reads = tc.filter((c) => c.tool_name === 'chat_app_read'); const failed: Row[] = [];
  for (const base of [reads[3], reads[9]]) { if (!base) continue; failed.push({ ...base, id: uid('chat_tool_calls', `real-failed-${base.id}`), tool_use_id: `${String(base.tool_use_id)}_try1`, output: null, status: 'failed', error_code: R.pick(['timeout', 'app_unavailable']), started_at: plus(base.started_at, -0.4), finished_at: plus(base.started_at, -0.1) }); }
  const declined = tc.find((c) => c.tool_name === 'chat_app_change' && !c.change_set_id);
  if (declined) { declined.status = 'rejected'; declined.output = { declined: true, note: 'You declined this change in the confirmation card.' }; declined.change_set_id = null; }
  writeTable('chat_tool_calls', [...tc, ...failed].sort((a, b) => String(a.started_at).localeCompare(String(b.started_at))));

  // ── 8. priority rule hits: say which item and why ──
  const scores = new Map(readTable('priority_scores').map((s) => [Number(s.id), s])); const rules = new Map(readTable('priority_policy_rules').map((r) => [String(r.id), r]));
  const acct = new Map(readTable('accounts').map((a) => [String(a.id), String(a.name)]));
  const hits = readTable('priority_score_rule_hits');
  for (const h of hits) {
    const s = scores.get(Number(h.score_id)); const w = s ? wi.find((x) => x.id === s.work_item_id) : null; const r = rules.get(String(h.rule_id)); if (!w || !r || !s) continue;
    const acc = w.account_id ? acct.get(String(w.account_id)) : null; const dueH = w.due_at ? Math.round((ms(w.due_at) - ms(s.computed_at)) / HOUR) : null;
    const t = String(w.title).length > 48 ? `${String(w.title).slice(0, 47)}…` : String(w.title); const eff = Number(h.effect);
    switch (r.rule_key) {
      case 'r_customer': h.explanation = `${acc ? `${acc}: ` : ''}customer-facing ${w.kind} "${t}" ranks above internal work (${eff > 0 ? '+' : ''}${eff}).`; break;
      case 'r_admin': h.explanation = `"${t}" is an internal ${w.kind}: ranked down by ${Math.abs(eff)}.`; break;
      case 'r_manager': case 'r_mgr_sla': h.explanation = `Asked by my manager${dueH != null ? ` and due in ${Math.max(dueH, 0)}h` : ''}: answer within 24 hours of the ask.`; break;
      case 'r_blueprint_floor': h.explanation = `${acc ?? 'Customer'} deliverable "${t}" is due ${dueH != null && dueH >= 0 ? `in ${dueH}h` : 'now'}: never below Now.`; break;
      case 'r_noise_exclude': h.explanation = `Low importance and not a commitment ("${t}"): hidden from the list.`; break;
      default: h.explanation = `${String(r.label)}: ${eff > 0 ? '+' : ''}${eff ?? 0}.`;
    }
  }
  writeTable('priority_score_rule_hits', hits);
}
