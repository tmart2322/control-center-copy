/** Domain 04: next_best_actions rows from the specs. Payloads follow the NBA output contract (src/engines/nba/prompt/schema.ts). */
import { OWNER, ref, sha, uid } from '../../lib/kit';
import type { Row } from '../../lib/kit';
import type { Built } from './work-core';
import { NBAS } from './work-nba-specs';
import type { NbaSpec } from './work-nba-specs';
import { R, ms, mt, plus, siId, wiId, wiKey } from './work-lib';

const doc = (paras: string[]) => ({ type: 'doc', content: paras.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) });
const CONF = { sure: 0.92, likely: 0.74, guess: 0.46 } as const;
const SKILL: Record<string, string> = { reply: 'nba-reply', send_email: 'nba-send-email', draft_doc: 'nba-send-email', start_claude_session: 'nba-start-claude-session', run_tool: 'nba-run-tool', log_activity: 'nba-log-activity', update_vdp: 'nba-update-vdp', schedule: 'nba-schedule', nudge: 'nba-nudge', confirm_done: 'nba-common', review_deliverable: 'nba-review-deliverable' };
const SKILL_VERSION: Record<string, string> = { 'nba-reply': '3', 'nba-send-email': '2', 'nba-start-claude-session': '2', 'nba-run-tool': '1', 'nba-log-activity': '2', 'nba-update-vdp': '2', 'nba-schedule': '2', 'nba-nudge': '2', 'nba-common': '4', 'nba-review-deliverable': '2' };
const dayMt = (s: string) => mt(s);

export interface NbaOut { rows: Row[]; toolRuns: Map<number, string[]>; refs: Array<{ n: number; v: number; kind: string; key: string }> }
export function buildNbas(built: Built[]): NbaOut {
  const rows: Row[] = []; const refs: NbaOut['refs'] = []; const toolRuns = new Map<number, string[]>();
  const byItem = new Map<number, NbaSpec[]>();
  for (const s of NBAS) { if (!byItem.has(s.n)) byItem.set(s.n, []); byItem.get(s.n)!.push(s); }
  const idOf = (n: number, v: number) => uid('next_best_actions', `${wiKey(n)}:v${v}`);
  for (const [n, specs] of byItem) {
    specs.sort((a, b) => a.v - b.v);
    const b = built.find((x) => x.spec.n === n)!;
    const times: string[] = [];
    specs.forEach((sp, i) => {
      let at = plus(mt(sp.at), 0, R(`${wiKey(n)}:nba${sp.v}`).int(2, 40));
      if (ms(at) < ms(b.created) + 60_000) at = plus(b.created, 2, R(`${wiKey(n)}:nbc${sp.v}`).int(5, 50));
      if (i > 0 && ms(at) <= ms(times[i - 1]!)) at = plus(times[i - 1]!, 1, 5);
      if (ms(at) > ms(mt('11-18 08:59:00'))) at = mt('11-18 08:59:00');
      times.push(at);
    });
    specs.forEach((sp, i) => {
      const at = times[i]!; const next = times[i + 1] ?? null;
      const skill = SKILL[sp.type]!;
      const r = R(`${wiKey(n)}:p${sp.v}`);
      const id = idOf(n, sp.v);
      const srcIds = sp.srcs.map((x) => siId(x));
      const failed = sp.st === 'failed';
      const readyAt = failed ? null : plus(at, 0, r.int(6, 40));
      // ── payload
      const payload: Record<string, unknown> = { verb: sp.type, title: sp.title, why: sp.why, confidence: sp.conf };
      payload.alternatives = [];
      payload.draft = null; payload.plan = null;
      if (sp.dest && sp.paras) payload.draft = { destination: { channel: sp.dest.channel, label: sp.dest.label, targetId: null, threadRef: sp.dest.thread ?? null, subject: sp.dest.subject ?? null, to: sp.dest.to ?? null, cc: sp.dest.cc ?? null }, doc: doc(sp.paras) };
      else if (sp.paras) payload.draft = { destination: null, doc: doc(sp.paras) };
      if (sp.sess) {
        payload.plan = { kind: 'claude_session', folder: `/Users/rafael/Projects/${sp.sess.folder}`, prompt: `[cc:${b.id}] ${sp.sess.goal}. Work from the context pack; stop and ask when a success criterion cannot be met.`, successCriteria: sp.sess.ok, contextPack: sp.sess.ctx.map(([label, refv]) => ({ label, ref: refv })), background: sp.sess.bg, checkpoints: sp.sess.bg ? ['After the first scenario runs'] : [] };
      }
      if (sp.tool) payload.plan = { kind: 'tool_run', toolId: sp.tool.toolId, inputs: sp.tool.inputs, missingInputs: sp.tool.missing ?? [], expectedOutput: sp.tool.out, background: sp.tool.bg };
      if (sp.act) payload.plan = { kind: 'activity_rows', rows: sp.act.rows.map(([subject, seTaskType, hours, opp, counts, cf], j) => ({ blockId: `blk-${wiKey(n)}-${j + 1}`, date: at.slice(0, 10), start: at.slice(0, 10) + 'T09:00', end: at.slice(0, 10) + 'T' + String(9 + Math.floor(hours)).padStart(2, '0') + ':00', subject, seTaskType, customerFacing: cf, counts, relatedTo: { type: opp ? 'opportunity' : 'catch_all', id: opp || undefined, name: opp || 'Internal' }, description: subject, evidenceIds: srcIds.length ? [srcIds[0]!] : [b.id], confidence: sp.conf })), skipped: [], handoff: sp.act.handoff ?? 'activity_editor', totalHours: sp.act.total };
      if (sp.vdp) payload.plan = { kind: 'vdp_patch', vdp: { accountName: sp.vdp.account, url: `https://vdp.example/records/${sp.vdp.slug}` }, changes: sp.vdp.changes.map(([section, field, op, value]) => ({ section, field, op, value, evidenceIds: srcIds.length ? [srcIds[0]!] : [b.id] })), followUps: sp.vdp.follow ?? [] };
      if (sp.sched) payload.plan = { kind: 'calendar_hold', title: sp.sched.title, durationMin: sp.sched.min, attendees: sp.sched.who, candidateSlots: sp.sched.slots.map(([a, bb, why]) => ({ start: dayMt(a).replace('.000Z', 'Z'), end: dayMt(bb).replace('.000Z', 'Z'), why })), hold: sp.sched.hold, notes: sp.sched.notes ?? '' };
      if (sp.rev) payload.plan = { kind: 'deliverable_review', file: { id: uid('assets', sp.rev.assetTag), title: sp.rev.assetTitle }, checklist: sp.rev.checklist.map(([requested, status, evidence]) => ({ requested, status, evidence, evidenceIds: [] })), verdict: sp.rev.verdict, nextStep: sp.rev.next };
      if (sp.type === 'confirm_done') payload.proposal = { status: 'done', reason: sp.why };
      payload.effort = { youMin: sp.you, agentMin: sp.agent };
      payload.startBy = { at: sp.startBy?.[0] ? mt(sp.startBy[0]) : null, reasoning: sp.startBy?.[1] ?? 'No time pressure in the inputs' };
      payload.sources = srcIds;
      payload.asks = (sp.asks ?? []).map(([question, to, blocking]) => ({ question, to, blocking }));
      payload.completeness = sp.comp;
      if (sp.upd) payload.update = { summary: sp.upd.summary, triggeredBy: sp.upd.trig.map((x) => siId(x)), diff: sp.upd.diff.map(([field, before, after]) => ({ field, before, after })), draftPolicy: sp.upd.policy, proposal: sp.upd.proposal ? { doc: doc(sp.upd.proposal), rationale: 'Offered as a proposal because the draft was edited by you.' } : null };
      else payload.update = null;
      if (failed) { payload.error = { code: 'timeout', message: 'nba.generate exceeded its 300 s timeout; attempts exhausted' }; }
      // ── diff (RFC 6902 against the previous version's payload)
      const prev = i > 0 ? specs[i - 1]! : null;
      const diff = prev && !failed ? [{ op: 'replace', path: '/title', value: sp.title }, { op: 'replace', path: '/why', value: sp.why }, ...(sp.dest && sp.paras ? [{ op: 'replace', path: '/draft/doc', value: doc(sp.paras) }] : []), ...(sp.rev ? [{ op: 'replace', path: '/plan/checklist', value: (payload.plan as any).checklist }] : []), { op: 'replace', path: '/completeness', value: sp.comp }] : null;
      // ── references into later domains
      let draftId: string | null = null; let toolRunId: string | null = null; let sessionId: string | null = null; let activityId: string | null = null;
      if (sp.draft) { draftId = ref('drafts', sp.draft, `Draft created from NBA ${wiKey(n)}:v${sp.v} (${sp.type}); drafts.work_item_id = ${wiKey(n)}, drafts.nba_id = ${wiKey(n)}:v${sp.v}`); refs.push({ n, v: sp.v, kind: 'drafts', key: sp.draft }); }
      if (sp.tool) { toolRunId = ref('tool_runs', sp.tool.key, `Tool run ${sp.tool.toolId} started from NBA ${wiKey(n)}:v${sp.v}; status ${sp.st === 'executing' ? 'running' : 'waiting for inputs'}`); refs.push({ n, v: sp.v, kind: 'tool_runs', key: sp.tool.key }); toolRuns.set(n, [...(toolRuns.get(n) ?? []), sp.tool.key]); }
      if (sp.sess?.key) { sessionId = ref('claude_sessions', sp.sess.key, `Claude session ${sp.sess.key} linked from NBA ${wiKey(n)}:v${sp.v} (CAST-sources claude_sessions list)`); refs.push({ n, v: sp.v, kind: 'claude_sessions', key: sp.sess.key }); }
      if (sp.act) { activityId = ref('activity_entries', sp.act.key, `Proposed activity entry (or batch anchor) behind NBA ${wiKey(n)}:v${sp.v} (log_activity); status proposed or logged`); refs.push({ n, v: sp.v, kind: 'activity_entries', key: sp.act.key }); }
      const accepted = sp.acc ? mt(sp.acc) : null; const completed = sp.done ? mt(sp.done) : null;
      const dismissed = sp.dis ? mt(sp.dis[0]) : null;
      let updatedAt = [at, readyAt, accepted, completed, dismissed].filter(Boolean).reduce((a, c) => (ms(a as string) > ms(c as string) ? a : c)) as string;
      if (sp.st === 'superseded' && next) updatedAt = ms(next) > ms(updatedAt) ? next : updatedAt;
      const gen = Math.max(1, (b.row.reeval_generation as number) - (sp.st === 'stale' ? 3 : i === specs.length - 1 ? 0 : 2 + (specs.length - 1 - i)));
      rows.push({
        id, owner_user_id: OWNER, work_item_id: b.id, nba_version: sp.v, work_item_generation: gen, version: accepted ? 2 + (sp.draft ? 1 : 0) : 1, status: sp.st, type: sp.type, title: sp.title, rationale: sp.why, payload, completeness: failed ? 0 : sp.comp, confidence: failed ? null : CONF[sp.conf] + r.int(-3, 3) / 100,
        model: failed ? 'claude-sonnet-5-5' : (sp.tier ?? 'sonnet') === 'none' ? null : (sp.tier ?? 'sonnet') === 'haiku' ? 'claude-haiku-5-5' : 'claude-sonnet-5-5', model_tier: sp.tier ?? 'sonnet', llm_call_id: sp.llm ?? null, prompt_version: `${skill}@${SKILL_VERSION[skill]}`,
        inputs_hash: sha(`${b.id}|${sp.v}|${sp.srcs.join(',')}|${at}`), supersedes_id: prev ? idOf(n, prev.v) : null, supersede_reason: prev ? (sp.sup ?? 'work_item_changed') : null, trigger_source_item_id: sp.trig ? siId(sp.trig) : (srcIds[0] ?? null), diff_summary: prev ? (sp.dsum ?? 'Inputs changed since the previous version.') : (failed ? sp.dsum ?? null : null),
        diff, draft_id: draftId, tool_run_id: toolRunId, claude_session_id: sessionId, activity_entry_id: activityId, ready_at: readyAt, accepted_at: accepted, completed_at: completed, dismissed_at: dismissed, dismiss_reason: sp.dis?.[1] ?? null, created_at: at, updated_at: updatedAt,
      });
    });
    // a failed version has no supersede relation to a later one in spirit, but the chain stays linear
    const last = rows[rows.length - 1]!;
    b.row.current_nba_id = last.id;
  }
  // a superseded version must have a successor: keep the chain honest
  return { rows, toolRuns, refs };
}
export { wiId };
