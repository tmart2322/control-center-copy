/** Domain 04 core builder: work_items, work_item_evidence, work_item_transitions from the roster specs. */
import { OWNER, ref, uid } from '../../lib/kit';
import type { Row } from '../../lib/kit';
import { ITEMS_A } from './work-items-a';
import { ITEMS_B } from './work-items-b';
import { ITEMS_C } from './work-items-c';
import type { By, ItemSpec, Status, Step, StepOpts } from './work-types';
import { NOW_ISO, R, calId, csId, csNear, csSourceRef, evOccurredAt, evSeenAt, evTarget, exId, llmNear, ms, mt, plus, siRow, wiId, wiKey } from './work-lib';

import { EXTRA } from './work-items-x';
export const SPECS: ItemSpec[] = [...ITEMS_A, ...ITEMS_B, ...ITEMS_C].sort((a, b) => a.n - b.n).map((s) => {
  const extra = (EXTRA[s.n] ?? []).filter((e) => !(s.ev ?? []).some((x) => x[0] === e[0] && x[1] === e[1]));
  return extra.length ? { ...s, ev: [...(s.ev ?? []), ...extra] } : s;
});
const INI_OVERRIDE: Record<number, string> = { 19: 'hv-exec-readout', 22: 'hv-exec-readout', 23: 'hv-exec-readout', 28: 'hv-exec-readout', 99: 'hv-blueprint', 17: 'aw-phases', 75: 'aw-phases', 76: 'aw-phases', 77: 'aw-phases', 78: 'aw-phases', 88: 'aw-phases', 49: 'bw-dc', 50: 'bw-dc', 45: 'lg-discovery', 65: 'qp-arch', 83: 'admin-q4', 84: 'admin-q4' };
export const iniOf = (s: ItemSpec) => INI_OVERRIDE[s.n] ?? s.ini ?? null;

export interface RStep { from: Status | null; to: Status; at: string; by: By | 'N'; why: string; opts: StepOpts; effective: boolean; trId?: number; evIdx?: number; idx: number }
export interface Built {
  spec: ItemSpec; id: string; key: string; created: string; evIds: string[]; evTimes: string[]; evRefs: string[]; steps: RStep[]; row: Row; status: Status;
}

const SRC_SKILL: Record<string, string> = { slack: 'scan-slack', gmail: 'scan-gmail', gemini_notes: 'scan-gemini-notes', drive: 'scan-drive', calendar: 'scan-calendar', claude: 'scan-claude-sessions', org62: 'scan-org62', vdp: 'scan-org62' };
const SRC_EX: Record<string, string> = { slack: 'scan-slack:1.7.0', gmail: 'scan-gmail:3', gemini_notes: 'scan-gemini-notes:3', drive: 'scan-drive:1', calendar: 'scan-calendar:2', claude: 'scan-claude-sessions:2', org62: 'scan-org62:1.7.0', vdp: 'scan-org62:1.7.0' };
export function srcOf(refKey: string): string {
  if (refKey.startsWith('si-')) return String(siRow(refKey).source);
  if (refKey.startsWith('cal')) return 'calendar';
  if (refKey.startsWith('o62:')) return 'org62';
  return 'drive';
}
export const skillOfSource = (s: string) => SRC_SKILL[s] ?? 'scan-slack';
export const extractorOfSource = (s: string) => SRC_EX[s] ?? 'scan-slack:1.7.0';

const ENGINE_REF: Record<string, [string, string]> = { C: ['engine.completion@1.3.0', 'engine.completion@'], S: ['engine.settle@1.5.0', 'engine.settle@'], R: ['engine.reeval@2', 'engine.reeval@'] };

function jitterSec(key: string, lo: number, hi: number) { return R(key).int(lo, hi); }
const capAt = (iso: string, secBeforeNow: number) => (ms(iso) > ms(NOW_ISO) - secBeforeNow * 1000 ? new Date(ms(NOW_ISO) - secBeforeNow * 1000).toISOString() : iso);

export function buildCore() {
  const built: Built[] = [];
  const evidence: Row[] = [];
  const trans: Row[] = [];
  const warnings: string[] = [];

  for (const s of SPECS) {
    const key = wiKey(s.n);
    const id = wiId(s.n);
    const evs = s.ev ?? [];
    // ── creation time
    let created: string;
    if (s.at) created = plus(mt(s.at), 0, jitterSec(key + 'c', 3, 55));
    else if (evs.length) created = plus(evSeenAt(evs[0]![0]), jitterSec(key + 'cm', 2, 7), jitterSec(key + 'cs', 0, 59));
    else throw new Error(`${key}: no creation time`);
    created = capAt(created, 150);
    // ── evidence rows
    const evIds: string[] = []; const evTimes: string[] = []; const evRefs: string[] = [];
    evs.forEach(([refKey, role, conf, why], i) => {
      const seen = evSeenAt(refKey);
      let t = i === 0 && !s.at ? created : plus(Math.max(ms(seen), ms(created)) === ms(created) ? created : seen, 0, jitterSec(`${key}:e${i}`, 8, 170));
      if (ms(t) < ms(created)) t = plus(created, 0, jitterSec(`${key}:e${i}x`, 8, 90));
      t = capAt(t, 40); if (ms(t) < ms(created)) t = created;
      const eid = uid('work_item_evidence', `${key}:${i}`);
      evIds.push(eid); evTimes.push(t); evRefs.push(refKey);
      const source = srcOf(refKey);
      const completion = role === 'completion' || role === 'contradiction';
      const stepBy = (s.steps ?? []).find((st) => st[4]?.ev === i)?.[2];
      const exKey = completion ? (stepBy === 'S' ? 'settle-item:1.5.0' : 'check-completion:1.3.0') : extractorOfSource(source);
      const purpose = (s.k === 'commitment' || s.og === 'said_by_me' || s.og === 'meeting_next_step') ? 'commitment_extract' : 'scan_extract';
      const llm = completion
        ? (stepBy === 'S' ? llmNear('other', 'settle-item', t, 240) : llmNear('done_match', 'check-completion', t, 240))
        : llmNear(purpose, skillOfSource(source), t, 240) ?? llmNear('scan_extract', skillOfSource(source), t, 360);
      const defaultWhy: Record<string, string> = { origin: 'The message this item was created from.', progress: 'Shows work toward the item.', completion: 'Shows the outcome the title asks for.', context: 'Related context for the item.', contradiction: 'Suggests the item is not finished.' };
      evidence.push({
        id: eid, work_item_id: id, ...evTarget(refKey), deliverable_judgment_id: null, role, confidence: conf, extractor_id: exId(exKey), llm_call_id: llm, rationale: why ?? defaultWhy[role],
        user_verdict: null, created_by: completion ? 'engine' : 'connector', created_at: t, updated_at: t,
      });
    });
    // ── transitions
    const steps: RStep[] = [];
    const initStatus: Status = s.init ?? ((s.steps?.length ?? 0) === 0 ? s.st : 'open');
    const firstSource = evs.length ? srcOf(evs[0]![0]) : 'manual';
    const creator: [string, string | null] = s.og === 'manual' ? ['user', 'ui.create'] : s.og === 'chat' ? ['chat', 'chat:tool:chat_create_work_item'] : s.og === 'system_rule' && !evs.some((e) => e[0].startsWith('si-18')) && s.k !== 'training' ? ['system', 'scheduler'] : ['connector', null];
    const csCreate = creator[0] === 'connector' ? csNear(csSourceRef(firstSource), created, 300) : null;
    let creatorRef = creator[1];
    if (creator[0] === 'connector') creatorRef = `scan:${firstSource === 'gemini_notes' ? 'gemini_notes' : firstSource === 'claude' ? 'claude_sessions' : firstSource}:${firstSource === 'slack' ? 'inbox@1.7.0' : 'inbox@3'}`;
    steps.push({ from: null, to: initStatus, at: created, by: 'N', why: s.og === 'manual' ? 'Added by hand' : s.og === 'system_rule' ? 'Created by a team rule' : s.og === 'missed_opp_scan' ? 'Found by the missed-opportunity scan' : s.og === 'reconcile' ? 'Found by a reconcile pass' : `Created from ${firstSource === 'gemini_notes' ? 'meeting notes' : firstSource === 'claude' ? 'a Claude session' : firstSource === 'calendar' ? 'a calendar event' : firstSource}`, opts: { cs: undefined }, effective: true, idx: 0, evIdx: evs.length ? 0 : undefined });
    (steps[0] as any).creator = creator[0]; (steps[0] as any).creatorRef = creatorRef; (steps[0] as any).csId = csCreate;
    let prevT = created; let status: Status = initStatus; let idx = 1;
    for (const [to, when, by, why, opts = {}] of s.steps ?? []) {
      let t: string;
      if (when.startsWith('@')) { const e = +when.slice(1); t = plus(evTimes[e]!, 1, jitterSec(`${key}:s${idx}`, 5, 50)); }
      else if (when.startsWith('+')) t = plus(prevT, +when.slice(1, -1));
      else t = when.length > 11 ? mt(when) : plus(mt(when), 0, jitterSec(`${key}:s${idx}`, 2, 50));
      t = capAt(t, 25);
      if (ms(t) <= ms(prevT)) { warnings.push(`${key} step ${idx} (${to}) at ${t} not after ${prevT}`); t = plus(prevT, 1, jitterSec(`${key}:sf${idx}`, 5, 40)); }
      const effective = !opts.undoneAt;
      steps.push({ from: status, to, at: t, by, why, opts, effective, idx, evIdx: opts.ev });
      if (effective) status = to;
      prevT = t; idx++;
    }
    if (status !== s.st) throw new Error(`${key}: steps end in ${status} but spec says ${s.st}`);
    // engine-created asks and promises start as a suggestion when the extractor was not sure; a second signal opens them
    const autoOpen = !s.init && ['asked_of_me', 'said_by_me', 'meeting_next_step'].includes(s.og) && evs.length > 0 && evs[0]![2] <= 0.9 && !['suggested', 'dismissed', 'merged'].includes(s.st) && steps[0]!.to === 'open' && R(key + 'ao').chance(0.7);
    if (autoOpen) {
      const next = steps[1] ? ms(steps[1].at) : ms(NOW_ISO);
      const gap = next - ms(created);
      if (gap > 40 * 60_000) {
        const openAt = plus(created, Math.min(35, Math.floor(gap / 120_000)), jitterSec(key + 'oa', 3, 50));
        steps[0]!.to = 'suggested';
        steps.splice(1, 0, { from: 'suggested', to: 'open', at: openAt, by: 'R', why: 'A second message in the same conversation confirmed this is a real ask.', opts: {}, effective: true, idx: 1 });
        steps.forEach((x, i) => { x.idx = i; });
        if (steps[2]) steps[2].from = 'open';
      }
    }

    // ── the work item row
    const lastEff = [...steps].reverse().find((x) => x.effective)!;
    const doneStep = [...steps].reverse().find((x) => x.effective && x.to === 'done');
    const resStep = [...steps].reverse().find((x) => x.effective && ['done', 'dismissed', 'merged'].includes(x.to) && x.opts.res);
    const reopens = steps.filter((x) => x.opts.reopen);
    const res = ['done', 'dismissed', 'merged'].includes(s.st) ? resStep?.opts.res : undefined;
    const lastT = steps[steps.length - 1]!.at;
    const lastEvT = evTimes.length ? evTimes.reduce((a, b) => (ms(a) > ms(b) ? a : b)) : created;
    const updated = ms(lastT) > ms(lastEvT) ? lastT : lastEvT;
    const due = s.due ? mt(s.due) : null;
    const lead = s.eff != null && due ? s.eff + 30 + R(key + 'ld').int(0, 6) * 15 : null;
    const seenAt = (s.st === 'done' || s.st === 'dismissed' || s.st === 'merged') ? (lastEff.by === 'U' || lastEff.by === 'H' ? lastEff.at : null) : (ms(created) < ms(mt('11-17 17:00')) && !s.fresh ? mt('11-17 16:48') : null);
    const unseen = seenAt ? evTimes.filter((t) => ms(t) > ms(seenAt)).length : (s.st === 'done' || s.st === 'dismissed' || s.st === 'merged' ? 0 : evTimes.length);
    const cl = s.cl ?? ['manual_only'];
    const row: Row = {
      id, owner_user_id: OWNER, kind: s.k, origin: s.og, status: s.st, status_changed_at: lastEff.at, status_reason: lastEff.why, title: s.title, purpose: s.purpose ?? null, description: null,
      initiative_id: iniOf(s) ? uid('initiatives', iniOf(s)!) : null, account_id: s.a ? uid('accounts', s.a) : null, opportunity_id: s.o ? uid('opportunities', s.o) : null,
      counterparty_person_id: s.cp ? uid('people', s.cp) : null, parent_id: s.parent ? wiId(s.parent) : null, merged_into_id: s.mergedInto ? wiId(s.mergedInto) : null,
      due_at: due, due_kind: due ? (s.dk ?? 'inferred') : null, deadline_event_id: s.deadlineEvent ? calId(s.deadlineEvent) : null,
      effort_minutes: s.eff ?? null, lead_time_minutes: lead, effort_source: s.effSrc ?? (s.og === 'manual' ? 'user' : R(key + 'es').chance(0.3) ? 'llm' : 'default'), backgroundable: [20, 25, 73, 91].includes(s.n),
      importance: s.imp ?? (s.st === 'dismissed' ? 'low' : 'normal'), confidence: s.conf ?? (evs.length ? evs[0]![2] : null),
      closure_kind: cl[0], closure_target: null, closure_params: null, auto_close_allowed: cl[3] ?? false,
      snoozed_until: s.st === 'snoozed' && s.snooze ? mt(s.snooze[0]) : null, snoozed_from_status: s.st === 'snoozed' && s.snooze ? s.snooze[1] : null,
      waiting_reason: ['waiting_on_me', 'waiting_on_others'].includes(s.st) && s.wait ? s.wait[0] : null, waiting_since: ['waiting_on_me', 'waiting_on_others'].includes(s.st) && s.wait ? plus(mt(s.wait[1]), 0, 12) : null,
      likely_done_at: s.st === 'likely_done' && s.likely ? (s.likely[0].startsWith('@') ? plus(evTimes[+s.likely[0].slice(1)]!, 2, 20) : plus(mt(s.likely[0]), 0, 20)) : null, likely_done_confidence: s.st === 'likely_done' && s.likely ? s.likely[1] : null,
      done_at: s.st === 'done' && doneStep ? doneStep.at : null, done_by: s.st === 'done' && doneStep ? ({ C: 'engine', S: 'engine', R: 'engine', U: 'user', H: 'chat', Y: 'system', K: 'connector', N: 'system' } as const)[doneStep.by] : null,
      reopened_count: reopens.length, last_reopened_at: reopens.length ? reopens[reopens.length - 1]!.at : null,
      seen_by_user_at: seenAt, last_new_info_at: evTimes.length ? lastEvT : null, unseen_evidence_count: unseen, reeval_generation: evs.length + steps.length + R(key + 'g').int(0, 4),
      priority_score: null, priority_lane: null, priority_rank: null, priority_score_id: null, priority_computed_at: null, current_nba_id: null,
      created_by_extractor_id: exId(s.og === 'manual' ? 'user-manual:1' : s.og === 'chat' ? 'chat-assistant:1' : s.og === 'system_rule' ? (s.k === 'training' ? 'scan-trainings:1' : 'team-rules:1') : s.og === 'missed_opp_scan' ? 'missed-opp-sweep:1' : s.og === 'reconcile' ? 'reconcile-slack:1' : evs.length ? extractorOfSource(firstSource) : 'user-manual:1'),
      user_locked_fields: s.lock ?? [], version: s.ver ?? Math.min(7, 1 + steps.length - 1 + (s.lock ? 1 : 0) + (reopens.length)), created_at: created, updated_at: updated,
      resolution: res?.r ?? null, resolution_person_id: res?.person ? uid('people', res.person) : null, resolution_work_item_id: res?.wi ? wiId(res.wi) : null, resolution_note: res?.note ?? (res ? (resStep!.why) : null),
      resolution_inferred: res ? (res.inferred ?? (resStep!.by === 'C' || resStep!.by === 'S' || resStep!.by === 'R')) : false, resolution_evidence_id: res?.ev != null ? evIds[res.ev]! : null,
      owner_person_id: s.ownerPerson ? uid('people', s.ownerPerson) : s.n === 82 ? uid('people', 'ae-harbor') : uid('people', 'owner'), involvement: s.inv ?? 'owner',
    };
    if (s.st === 'done' && res?.r === 'done_by_other') row.resolution_person_id = res.person ? uid('people', res.person) : null;
    built.push({ spec: s, id, key, created, evIds, evTimes, evRefs, steps, row, status });
  }

  // closure target/params need the finished ids (reply_in_thread derives from the origin item)
  for (const b of built) {
    const s = b.spec; const cl = s.cl ?? ['manual_only'];
    const [kind, target, params] = cl;
    const origin = s.ev?.[0]?.[0];
    const o: Record<string, unknown> = { ...(params ?? {}) };
    let tgt: string | null = null;
    if (kind === 'reply_in_thread' || kind === 'email_sent') {
      const r = origin && origin.startsWith('si-') ? siRow(origin) : null;
      const meta = (r?.meta ?? {}) as Record<string, any>;
      if (r) {
        tgt = String(meta.threadRef ?? r.external_parent_id ?? r.external_id);
        o.channel = r.source === 'slack' ? 'slack' : 'email'; o.afterAt = r.occurred_at; o.from = 'me';
      }
    } else if (kind === 'asset_delivered') { const tag = (target ?? '').replace('asset:', ''); tgt = `asset:${tag}`; o.assetId = uid('assets', tag); o.sinceAt = b.created; }
    else if (kind === 'deliverable_judged') { tgt = target ?? null; o.deliverableId = uid('work_item_deliverables', (target ?? '').replace('deliverable:', '')); o.assetId = uid('assets', String(o.asset)); delete o.asset; }
    else if (kind === 'claude_session_completed') { tgt = target ?? null; if (target?.startsWith('session:')) o.sessionId = ref('claude_sessions', target.slice(8), 'Claude session the work item closes on (claude_session_completed); keys cs-NN as in CAST-sources'); else o.repo = target?.replace('repo:', ''); }
    else if (kind === 'org62_readback') { tgt = target ?? null; }
    else if (kind === 'vdp_readback') { tgt = target ?? null; o.vdpSlug = (target ?? '').replace('vdp:', ''); }
    else if (kind === 'training_completed') { tgt = target ?? null; }
    else if (kind === 'llm_match') { tgt = origin ? `source:${origin}` : null; o.askedBy = s.cp ?? null; }
    b.row.closure_target = tgt;
    b.row.closure_params = kind === 'manual_only' ? null : o;
  }

  // transitions rows (ids assigned after sorting)
  const pending: Array<{ b: Built; st: RStep; row: Row }> = [];
  for (const b of built) {
    for (const st of b.steps) {
      let actorKind: string; let actorRef: string | null; let cs: string | null = null;
      if (st.by === 'N') { actorKind = (st as any).creator; actorRef = (st as any).creatorRef; cs = (st as any).csId ?? null; }
      else if (st.by === 'C' || st.by === 'S' || st.by === 'R') { actorKind = 'engine'; actorRef = ENGINE_REF[st.by]![0]; cs = st.opts.cs ? csId(st.opts.cs) : csNear(ENGINE_REF[st.by]![1], st.at, 90); }
      else if (st.by === 'U') { actorKind = 'user'; actorRef = st.opts.undoneCs ? 'ui.edit' : 'ui.edit'; cs = st.opts.cs ? csId(st.opts.cs) : null; }
      else if (st.by === 'H') { actorKind = 'chat'; actorRef = 'chat:tool:chat_propose_changes'; cs = st.opts.cs ? csId(st.opts.cs) : csNear('chat:tool', st.at, 30); }
      else if (st.by === 'Y') { actorKind = 'system'; actorRef = 'scheduler'; }
      else { actorKind = 'connector'; actorRef = 'scan:slack:inbox@1.7.0'; cs = csNear('scan:slack:', st.at, 90); }
      pending.push({ b, st, row: {
        work_item_id: b.id, from_status: st.from, to_status: st.to, actor_kind: actorKind, actor_ref: actorRef, reason: st.why, evidence_id: st.evIdx != null ? b.evIds[st.evIdx] ?? null : null, change_set_id: cs, occurred_at: st.at,
        undone_at: st.opts.undoneAt ? plus(mt(st.opts.undoneAt), 0, 0) : null, undone_by_change_set_id: st.opts.undoneCs ? csId(st.opts.undoneCs) : null,
      } });
    }
  }
  pending.sort((a, b) => ms(a.row.occurred_at as string) - ms(b.row.occurred_at as string) || a.b.spec.n - b.b.spec.n);
  pending.forEach((p, i) => { p.row.id = i + 1; p.st.trId = i + 1; trans.push({ id: i + 1, ...p.row }); });
  return { built, evidence, trans, warnings };
}
export { NOW_ISO };
