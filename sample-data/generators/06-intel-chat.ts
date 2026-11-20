/**
 * Domain 06: briefs, watches, relevance learning, chat, provenance links and reconcile findings.
 * Tables: briefs, brief_highlights, brief_highlight_reasons, brief_scan_runs, watch_subscriptions, relevance_feedback,
 * relevance_weights, chat_threads, chat_messages, chat_tool_calls, provenance_links, reconcile_findings.
 * Reads domains 01 to 04 (JSON). Points at domain 05 rows only with `ref()` keys that already sit in sample-data/reservations.
 * Also writes sample-data/CAST-intel.md.  Run: npx tsx sample-data/generators/06-intel-chat.ts
 */
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OWNER, SAMPLE_DIR, at, flushRefs, ref, reservedFor, rng, sha, uid, writeTable, type Row } from '../lib/kit';
import { BRIEFS, WATCHES, type HighlightSpec, type ReasonSpec } from './data/intel-briefs';
import { buildThreads, type ToolSpec } from './data/intel-chat';
import { buildReconcile } from './data/intel-recon';
import { T, acct, changeSet, channel, connector, evidenceOf, initiative, job, keyOfSi, llm, mt, must, nba, nbaId, opp, person, round, ruleId, si, siId, snapshotsOf, wi, wiId, wiTitle } from './data/intel-lib';

// ── globals the chat module reads (earlier domains' JSON) ──────────────────────────────────────────
const wiKey = new Map<string, number>();
for (let i = 1; i <= T('work_items').length; i++) wiKey.set(wiId(i), i);
(globalThis as any).__scanRuns = T('scan_runs');
(globalThis as any).__prioScores = T('priority_scores');
(globalThis as any).__wiKey = wiKey;
(globalThis as any).__openDueThisWeek = T('work_items').filter((w) => ['open', 'in_progress', 'waiting_on_me', 'likely_done', 'waiting_on_others'].includes(String(w.status)) && w.due_at && String(w.due_at) <= '2026-11-22T06:59:59.000Z').length;

// "@-13|07:30" placeholders from the data modules → ISO
const R = (s: string): string => {
  if (!s.startsWith('@')) return s;
  const [off, hhmm] = s.slice(1).split('|');
  return at(Number(off), hhmm!);
};
const plus = (iso: string, ms: number) => new Date(new Date(iso).getTime() + ms).toISOString();
const R_ = rng('intel-06');
const sched = T('job_schedules').find((s) => s.key === 'brief.generate')!;
const csRow = (n: number) => T('change_sets').find((c) => c.id === changeSet(n))!;

// ── feature key resolution ────────────────────────────────────────────────────────────────────────
function featureKey(f: string): string {
  const m = /^(person|account|opp):@(.+)$/.exec(f);
  if (!m) return f;
  const [, kind, key] = m;
  return `${kind}:${kind === 'person' ? person(key!) : kind === 'account' ? acct(key!) : opp(key!)}`;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// watches, briefs, highlights, reasons, feedback, weights
// ═════════════════════════════════════════════════════════════════════════════════════════════════
const briefId = (k: string) => uid('briefs', k);
const watchId = (k: string) => uid('watch_subscriptions', k);
const lastBriefEnd = new Map<string, string>();
for (const b of BRIEFS) lastBriefEnd.set(b.key, R(b.end));

const watchRows: Row[] = WATCHES.map((w) => {
  const base: Row = {
    id: watchId(w.key), owner_user_id: OWNER, scope_kind: w.scope,
    channel_id: null, opportunity_id: null, account_id: null, person_id: null, initiative_id: null, search_query: null,
  };
  if (w.scope === 'account') base.account_id = acct(w.target);
  if (w.scope === 'opportunity') base.opportunity_id = opp(w.target);
  if (w.scope === 'person') base.person_id = person(w.target);
  if (w.scope === 'channel') base.channel_id = channel(w.target);
  if (w.scope === 'search_query') base.search_query = w.target;
  const lastEnd = w.lastBrief ? lastBriefEnd.get(w.lastBrief)! : null;
  return {
    ...base, source_systems: w.sources ?? [], label: w.label, cadence: w.cadence, style: w.style, detail_level: w.detail,
    max_highlights: w.max, min_relevance: w.minRel, auto_managed: w.auto, enabled: w.enabled,
    schedule_id: w.scheduled ? sched.id : null,
    // the window cursor advances even on weeks with no brief (the search watch had two empty windows)
    last_period_end: w.key === 'q-prior-auth' ? at(-5, '07:30') : lastEnd,
    last_brief_id: w.lastBrief ? briefId(w.lastBrief) : null,
    version: w.key === 'acct-voltmere' ? 3 : w.enabled ? 2 : 4,
    created_at: R(w.created), updated_at: R(w.updated),
  };
});

const scanRunIdsOf = (items: string[], windowStart: string, windowEnd: string, extraKinds: string[]): string[] => {
  const ids = new Set<string>();
  for (const k of items) {
    const r = si(k);
    if (r.first_scan_run_id) ids.add(String(r.first_scan_run_id));
    if (r.last_scan_run_id) ids.add(String(r.last_scan_run_id));
  }
  const kindOf = new Map(T('connectors').map((c) => [String(c.id), String(c.kind)]));
  for (const kind of extraKinds) {
    const runs = T('scan_runs').filter((r) => kindOf.get(String(r.connector_id)) === kind && r.status === 'succeeded' && r.mode !== 'reconcile' && String(r.started_at) >= windowStart && String(r.started_at) <= windowEnd);
    for (const r of runs.slice(-2)) ids.add(String(r.id));
  }
  return [...ids];
};

const briefRows: Row[] = [];
const briefScanRunRows: Row[] = [];
const highlightRows: Row[] = [];
const reasonRows: Row[] = [];
const feedbackRows: Row[] = [];
const hlMeta: Array<{ key: string; id: string; brief: string; spec: HighlightSpec; generatedAt: string; sub: string; features: string[]; llm: number }> = [];
let reasonId = 0;
let fbId = 0;

for (const b of BRIEFS) {
  const call = llm(b.llm);
  const w = WATCHES.find((x) => x.key === b.watch)!;
  const start = R(b.start);
  const end = R(b.end);
  const generatedAt = plus(String(call.finished_at), 2_000);
  const snaps = b.opp ? snapshotsOf(b.opp) : [];
  const jobId = call.job_id as number;
  const seenAt = b.key === 'weekly-voltmere-1118' ? String(csRow(487).closed_at) : b.seenAt ? R(b.seenAt) : null;
  briefRows.push({
    id: briefId(b.key), owner_user_id: OWNER, subscription_id: watchId(b.watch), period_start: start, period_end: end, status: 'ready',
    summary: b.summary,
    from_opportunity_snapshot_id: b.snaps ? String(snaps[b.snaps[0]]!.id) : null,
    to_opportunity_snapshot_id: b.snaps ? String(snaps[b.snaps[1]]!.id) : null,
    source_item_count: b.items.length, highlight_count: b.highlights.length, nothing_new: !!b.nothingNew,
    coverage_complete: b.coverage ? false : true, coverage_note: b.coverage?.note ?? null,
    model: call.model, model_tier: call.model_tier, llm_call_id: b.llm, cost_usd: call.cost_usd, input_tokens: call.input_tokens, output_tokens: call.output_tokens,
    inputs_hash: sha([b.key, ...b.items.map(siId)].join('|')), job_id: jobId,
    generated_at: generatedAt, seen_at: seenAt, created_at: plus(String(call.started_at), -3_000),
  });
  for (const rid of scanRunIdsOf(b.items, start, end, b.nothingNew ? ['drive', 'gmail', 'slack'] : [])) briefScanRunRows.push({ brief_id: briefId(b.key), scan_run_id: rid });

  b.highlights.forEach((h, i) => {
    const id = uid('brief_highlights', h.key);
    const seen = h.status === 'new' ? null : plus(generatedAt, (h.seenAfterMin ?? 30) * 60_000);
    let promotedAt: string | null = null;
    let promotedWi: string | null = null;
    if (h.promote) { promotedAt = String(wi(h.promote.wi).created_at); promotedWi = wiId(h.promote.wi); }
    const dismissedAt = h.dismiss ? R(h.dismiss.at) : null;
    const updated = promotedAt ?? dismissedAt ?? seen ?? generatedAt;
    const features = h.reasons.map((r) => featureKey(r.feature));
    highlightRows.push({
      id, owner_user_id: OWNER, brief_id: briefId(b.key), ordinal: i + 1, title: h.title, body: h.body, relevance_score: h.score, level: h.level,
      account_id: h.account ? acct(h.account) : null, opportunity_id: h.opp ? opp(h.opp) : null, initiative_id: h.initiative ? initiative(h.initiative) : null,
      topic_key: h.topic ?? topicFor(h),
      status: h.status, seen_at: seen, promoted_at: promotedAt, promoted_work_item_id: promotedWi, dismissed_at: dismissedAt, dismiss_reason: h.dismiss?.reason ?? null,
      extractor_id: null, llm_call_id: b.llm, version: h.status === 'new' ? 1 : h.status === 'seen' ? 2 : 3, created_at: generatedAt, updated_at: updated,
    });
    h.reasons.forEach((r: ReasonSpec) => {
      reasonRows.push({
        id: ++reasonId, highlight_id: id, kind: r.kind, feature_key: featureKey(r.feature),
        policy_rule_id: r.rule ? ruleId(r.rule[0], r.rule[1]) : null, weight: r.weight, explanation: r.explanation,
      });
    });
    hlMeta.push({ key: h.key, id, brief: b.key, spec: h, generatedAt, sub: watchId(b.watch), features, llm: b.llm });
    for (const f of h.feedback ?? []) {
      feedbackRows.push({
        id: ++fbId, owner_user_id: OWNER, highlight_id: id, subscription_id: watchId(b.watch), kind: f.kind, feature_keys: features,
        change_set_id: f.changeSet ? changeSet(f.changeSet) : null,
        created_at: f.kind === 'promoted_to_triage' || f.kind === 'promoted_to_work_item' ? promotedAt! : R(f.at),
      });
    }
  });
  void w;
}

function topicFor(h: HighlightSpec): string {
  const k = h.evidence[0]!;
  const r = si(k);
  const m = (r.meta ?? {}) as any;
  if (h.opp && r.source === 'org62') return `opp:${opp(h.opp)}:${h.level === 'must_read' ? 'CloseDate' : 'Stage'}`;
  if (r.source === 'slack') return String(m.threadRef ?? `slack:${m.channelId}:${m.ts}`);
  if (r.source === 'gmail') return String(m.threadRef ?? `gmail:${r.external_id}`);
  if (r.source === 'drive') return `drive:${m.fileId}`;
  return `${r.source}:${r.external_id}`;
}
// explicit topic strings in the spec that name an opportunity key are rewritten to the opportunity id
for (const row of highlightRows) {
  const m = /^opp:([a-z0-9-]+):(\w+)$/.exec(String(row.topic_key));
  if (m && !/^[0-9a-f]{8}-/.test(m[1]!)) row.topic_key = `opp:${opp(m[1]!)}:${m[2]}`;
}

// relevance weights learned from the feedback rows
const wAgg = new Map<string, { pos: number; neg: number; score: number; at: string }>();
for (const f of feedbackRows) {
  const delta = f.kind === 'dismissed_not_relevant' ? -1 : f.kind === 'marked_useful' ? 1 : f.kind === 'opened' ? 0.25 : 1.5;
  for (const k of f.feature_keys as string[]) {
    const a = wAgg.get(k) ?? { pos: 0, neg: 0, score: 0, at: '' };
    if (delta < 0) a.neg++; else a.pos++;
    a.score += delta;
    if (String(f.created_at) > a.at) a.at = String(f.created_at);
    wAgg.set(k, a);
  }
}
const weightRows: Row[] = [...wAgg.entries()].sort().map(([k, a]) => ({
  owner_user_id: OWNER, feature_key: k, weight: round(Math.max(-1, Math.min(1, a.score / (a.pos + a.neg + 2))), 3), positive_count: a.pos, negative_count: a.neg, updated_at: a.at,
}));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// chat
// ═════════════════════════════════════════════════════════════════════════════════════════════════
const threads = buildThreads();
const threadRows: Row[] = [];
const msgRows: Row[] = [];
const toolRows: Row[] = [];
const msgMeta = new Map<string, { id: string; at: string; turnKey: string }>();
const draftRefOut: Array<{ key: string; id: string }> = [];
const csClosed = (n: number) => String(csRow(n).closed_at);
const csCreated = (n: number) => String(csRow(n).created_at);
const reserved = new Set(reservedFor('chat_messages').filter((r) => r.by === 'ops').map((r) => String(r.key)));
let propN = 0;

for (const th of threads) {
  let seq = 0;
  const threadId = uid('chat_threads', th.key);
  const firstAt: string[] = [];
  let lastAssistant = '';
  for (const t of th.turns) {
    const call = t.llm ? llm(t.llm) : null;
    if (call && !reserved.has(t.key)) throw new Error(`chat message ${t.key} is not reserved`);
    const assistantAt = call ? String(call.finished_at) : R(t.assistantAt!);
    const userAt = call ? plus(String(call.started_at), -(6 + (R_.int(0, 30)) + R_.int(0, 9)) * 1000) : R(t.userAt);
    firstAt.push(userAt);
    lastAssistant = assistantAt;
    const userId = uid('chat_messages', `${t.key}:u`);
    const asstId = uid('chat_messages', t.key);
    msgMeta.set(t.key, { id: asstId, at: assistantAt, turnKey: t.key });
    const ctx = (t.ctx ?? []).map((c) => ({ id: c.type === 'person' && !/^[0-9a-f]{8}-/.test(c.id) ? person(c.id) : c.id, label: c.label, type: c.type, via: c.via }));
    msgRows.push({ id: userId, thread_id: threadId, seq: ++seq, role: 'user', content: t.user, content_blocks: [{ context: ctx, isMorningBrief: false, parts: [] }], model: null, llm_call_id: null, created_at: userAt });

    // tool calls and their parts
    const parts: unknown[] = [];
    t.tools.forEach((tool: ToolSpec, i) => {
      const useId = `toolu_smpl_${t.key.replace(/[^a-z0-9]/g, '')}_${i + 1}`;
      const cs = tool.cs ? csRow(tool.cs) : null;
      const confirm = !!tool.mutation && tool.name !== 'chat_draft';
      let started: string; let finished: string;
      if (tool.at) [started, finished] = tool.at;
      else if (cs) { started = assistantAt; finished = String(cs.closed_at); }
      else if (tool.name === 'chat_app_change') { started = assistantAt; finished = '2026-11-12T17:20:00.000Z'; }
      else {
        const baseStart = call ? new Date(String(call.started_at)).getTime() + 3_000 + i * 2_500 : new Date(assistantAt).getTime() - 20_000 + i * 2_500;
        started = new Date(baseStart).toISOString();
        finished = new Date(baseStart + 500 + R_.int(0, 1800)).toISOString();
      }
      let output = tool.output;
      if (tool.refDraft) {
        const did = ref('drafts', tool.refDraft, 'chat draft card: the Outbox draft chat_draft created (domain 05 owns the row)');
        draftRefOut.push({ key: tool.refDraft, id: did });
        output = { ...(tool.output as object), draftId: did };
      }
      if (tool.entryRefs) {
        const ids = tool.entryRefs.map((k) => ref('activity_entries', k, 'row the chat logging batch staged (domain 05 owns the row)'));
        output = { ...(tool.output as object), entryIds: ids };
      }
      toolRows.push({
        id: uid('chat_tool_calls', `${t.key}:${i + 1}`), message_id: asstId, tool_use_id: useId, tool_name: tool.name, input: tool.input, output: output ?? null,
        is_mutation: !!tool.mutation, requires_confirmation: confirm, status: tool.status ?? 'succeeded', change_set_id: tool.cs ? changeSet(tool.cs) : null,
        job_id: null, started_at: started, finished_at: finished, error_code: tool.error ?? null,
      });
      parts.push({ type: 'tool', id: useId, name: tool.name, summary: tool.summary, ok: (tool.status ?? 'succeeded') === 'succeeded', args: JSON.stringify(tool.input).slice(0, 600), result: tool.summary });
      if (tool.proposal) {
        const pid = `prop-smpl-${String(++propN).padStart(4, '0')}`;
        parts.push({
          type: 'proposal', summary: tool.proposal.summary, status: tool.proposal.status === 'applied' ? 'applied' : 'pending', changes: tool.proposal.changesRaw,
          proposal: { id: pid, entity: tool.proposal.entity, changes: tool.proposal.changes, reason: tool.proposal.reason, source: null, createdAt: assistantAt, status: tool.proposal.status === 'applied' ? 'applied' : 'pending', actor: 'chat', baseVersion: null, textDiff: null, resolvedAt: tool.proposal.status === 'applied' ? (cs ? String(cs.closed_at) : finished) : null },
        });
      }
      if (tool.refDraft) {
        const did = draftRefOut[draftRefOut.length - 1]!.id;
        const body = String((tool.input as any).body);
        parts.push({ type: 'resource', resource: { kind: 'draft', id: did, label: 'Slack reply to Hana', href: `/outbox?draft=${did}` }, card: { kind: 'draft', draft: { draftId: did, channel: 'slack', to: String((tool.input as any).to), subject: null, threadRef: null, workItemId: wiId(30), status: 'ready', preview: body.slice(0, 120), href: `/outbox?draft=${did}` } } });
      }
    });
    msgRows.push({ id: asstId, thread_id: threadId, seq: ++seq, role: 'assistant', content: t.assistant, content_blocks: [{ context: [], isMorningBrief: false, parts }], model: call ? String(call.model) : 'claude-sonnet-5-5', llm_call_id: t.llm ?? null, created_at: assistantAt });
  }
  threadRows.push({
    id: threadId, owner_user_id: OWNER, title: th.title, scope: th.scope, work_item_id: th.wi ? wiId(th.wi) : null, account_id: th.acct ? acct(th.acct) : null,
    opportunity_id: th.opp ? opp(th.opp) : null, sdk_session_id: th.sdk, model: 'claude-sonnet-5-5', last_message_at: lastAssistant,
    archived_at: th.key === 'first-week' ? at(-20, '09:12') : null, created_at: firstAt[0]!, updated_at: th.key === 'first-week' ? at(-20, '09:12') : lastAssistant,
  });
}
// thread T4 was renamed by chat at 09:05:50 on Sat 11-14: updated_at follows that tool call
const late = threadRows.find((r) => r.id === uid('chat_threads', 'late-slack'))!;
late.updated_at = csClosed(406);
// the brief-refresh tool reports the real brief it looked at
{
  const b2 = briefRows.find((r) => r.id === briefId('weekly-voltmere-1118'))!;
  for (const tr of toolRows) if (tr.tool_name === 'chat_brief_refresh') tr.output = { ...(tr.output as object), briefId: b2.id, briefGeneratedAt: b2.generated_at, subscriptionId: b2.subscription_id };
}
// every reserved message exists exactly once
for (const r of reservedFor('chat_messages')) if (r.by === 'ops' && !msgMeta.has(String(r.key))) throw new Error(`reserved chat message ${r.key} not built`);

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// reconcile findings (domain 03/02/04 facts)
// ═════════════════════════════════════════════════════════════════════════════════════════════════
const reconcileRows = buildReconcile(OWNER);

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// provenance links
// ═════════════════════════════════════════════════════════════════════════════════════════════════
type Target = Partial<Record<'nba_id' | 'draft_id' | 'activity_entry_id' | 'tool_run_id' | 'missed_opp_finding_id' | 'chat_message_id' | 'brief_id' | 'brief_highlight_id', string>>;
const provRows: Row[] = [];
const provSeen = new Set<string>();
let provId = 0;
const warns: string[] = [];
function link(siKey: string, target: Target, role: 'trigger' | 'context' | 'quoted' | 'basis', at_: string, extractorId: string | null = null, strict = false): void {
  const sid = siId(siKey);
  const seenAt = String(si(siKey).first_seen_at);
  if (seenAt > at_) {
    if (strict) { warns.push(`${siKey} first seen ${seenAt} after ${at_}`); return; }
    at_ = seenAt;
  }
  const dedupe = JSON.stringify([sid, role, target]);
  if (provSeen.has(dedupe)) return;
  provSeen.add(dedupe);
  const row: Row = { id: ++provId, source_item_id: sid, nba_id: null, draft_id: null, activity_entry_id: null, tool_run_id: null, missed_opp_finding_id: null, chat_message_id: null, brief_id: null, brief_highlight_id: null, role, extractor_id: extractorId, created_at: at_ };
  Object.assign(row, target);
  provRows.push(row);
}
const keyOf = (id: unknown) => keyOfSi(String(id));

// (a) briefs: every item the brief read (coverage) as context
for (const b of BRIEFS) for (const k of b.items) link(k, { brief_id: briefId(b.key) }, 'context', plus(String(llm(b.llm).finished_at), 2_000), null, true);
// (b) highlights: the quoted item and its basis
for (const h of hlMeta) h.spec.evidence.forEach((k, i) => link(k, { brief_highlight_id: h.id }, i === 0 ? 'quoted' : 'basis', h.generatedAt, null, true));
// (c) next best actions: the trigger plus the work item's first piece of evidence
const nbaRows = T('next_best_actions').filter((n) => ['ready', 'completed', 'needs_input', 'executing', 'stale'].includes(String(n.status)) && n.trigger_source_item_id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
const nbaPick = [...nbaRows.filter((_, i) => i % 4 === 0)].slice(0, 9);
const inv = new Map(T('source_items').map((r) => [String(r.id), keyOf(r.id)]));
for (const n of nbaPick) {
  const trig = inv.get(String(n.trigger_source_item_id))!;
  link(trig, { nba_id: String(n.id) }, 'trigger', String(n.created_at));
  const ctx = evidenceOf(wiKey.get(String(n.work_item_id))!).map(keyOf).find((k) => k !== trig);
  if (ctx) link(ctx, { nba_id: String(n.id) }, 'context', String(n.created_at));
}
// (d)/(e)/(f) reserved domain-05 rows, by their NBA (notes name it) or their Org62 event
const resv = (['drafts', 'activity_entries', 'tool_runs'] as const).flatMap((tb) => reservedFor(tb).filter((r) => r.by !== 'intel').map((r) => ({ ...r, tb })));
const nbaOfNote = (note: string) => /NBA (wi-\d+:v\d+)/.exec(note)?.[1];
const seenKey = new Set<string>();
let draftN = 0; let actN = 0;
const o62Items = new Map<string, string>();
for (const r of T('source_items')) { const cc = (r.meta as any)?.ccKey; if (cc) o62Items.set(String(cc), keyOf(r.id)); }
for (const r of resv) {
  const table = r.tb;
  const k = `${table}:${r.key}`;
  if (seenKey.has(k)) continue;
  seenKey.add(k);
  const key = String(r.key);
  const nk = nbaOfNote(r.note) ?? (key === 'rev-saltmere-blueprint-email' ? 'wi-003:v3' : key === 'rev-elderglen-demo-reply' ? 'wi-031:v2' : undefined);
  const mk = (): Target => (table === 'drafts' ? { draft_id: ref('drafts', key, 'provenance target') } : table === 'activity_entries' ? { activity_entry_id: ref('activity_entries', key, 'provenance target') } : { tool_run_id: ref('tool_runs', key, 'provenance target') });
  if (table === 'activity_entries' && key.startsWith('act-o62-')) {
    if (actN++ >= 8) continue;
    const target = mk();
    const item = o62Items.get(uid('activity_entries', key));
    if (item) link(item, target, 'basis', String(si(item).first_seen_at));
    continue;
  }
  if (!nk) continue;
  if (table === 'drafts' && draftN++ >= 8) continue;
  const target = mk();
  const n = nba(nk);
  const trig = n.trigger_source_item_id ? inv.get(String(n.trigger_source_item_id)) : undefined;
  const w = wiKey.get(String(n.work_item_id))!;
  const ev = evidenceOf(w).map(keyOf).filter((x) => x !== trig);
  const t0 = String(n.created_at);
  if (trig) link(trig, target, 'trigger', t0);
  ev.slice(0, table === 'tool_runs' ? 2 : 1).forEach((x) => link(x, target, 'context', t0));
}
// (g) chat messages: quoted items and the evidence behind the cited work items
const chatEvidence: Record<string, number[]> = {
  'llm-chat-02': [39], 'llm-chat-03': [88], 'llm-chat-04': [87], 'llm-chat-06': [54], 'llm-chat-08': [3, 15], 'llm-chat-09': [15],
  'llm-chat-11': [75], 'llm-chat-12': [3, 60], 'llm-chat-13': [60, 31], 'llm-chat-14': [30],
};
for (const th of threads) for (const t of th.turns) {
  const mm = msgMeta.get(t.key)!;
  for (const q of t.quotes ?? []) link(q, { chat_message_id: mm.id }, 'quoted', mm.at, null, true);
  for (const n of chatEvidence[t.key] ?? []) evidenceOf(n).map(keyOf).slice(0, 2).forEach((k) => link(k, { chat_message_id: mm.id }, 'context', mm.at, null, true));
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// write
// ═════════════════════════════════════════════════════════════════════════════════════════════════
writeTable('watch_subscriptions', watchRows);
writeTable('briefs', briefRows);
writeTable('brief_scan_runs', briefScanRunRows);
writeTable('brief_highlights', highlightRows);
writeTable('brief_highlight_reasons', reasonRows);
writeTable('relevance_feedback', feedbackRows);
writeTable('relevance_weights', weightRows);
writeTable('chat_threads', threadRows);
writeTable('chat_messages', msgRows);
writeTable('chat_tool_calls', toolRows);
writeTable('provenance_links', provRows);
writeTable('reconcile_findings', reconcileRows);

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// CAST-intel.md
// ═════════════════════════════════════════════════════════════════════════════════════════════════
const hh = (iso: string) => { const m = mt(iso); return `${m.md} ${m.time}`; };
const lines: string[] = [];
lines.push('# CAST-intel: domain 06 (briefs, watches, chat, provenance, reconcile)', '', 'Generated by `sample-data/generators/06-intel-chat.ts`. Row ids are `uid(\'<table>\', \'<key>\')`; the keys below are exact. Times are MT. Domain 05 rows are referenced only through the keys already in `sample-data/reservations/*.json`.', '');
lines.push('## Watches (6; 3 enabled)', '', '| key | scope / target | cadence, style | enabled | brief |', '|---|---|---|---|---|');
for (const w of WATCHES) lines.push(`| \`${w.key}\` | ${w.scope}: ${w.target} | ${w.cadence}, ${w.style}${w.auto ? ', auto-managed' : ''} | ${w.enabled} | ${w.lastBrief ?? '-'} |`);
lines.push('', 'Enabled: Voltmere account (weekly), Contoso account (weekly), search "prior authorization automation" (weekly, Slack+Gmail). Disabled: the Halvergate opp brief watch (user paused it Nov 13 10:40, after the close date passed), Petra Novak (person; one nothing-new brief), #contoso-marketplace (channel, covered by the account watch). All use schedule `brief.generate` (07:30 MT).', '');
lines.push('## Briefs (' + BRIEFS.length + ') and highlights (' + highlightRows.length + ')', '', 'Each brief is tied to the brief.generate job and the brief-channel / brief-opportunity llm_call of that morning (' + BRIEFS.map((b) => `${b.key}: job ${llm(b.llm).job_id}, llm ${b.llm}`).join('; ') + '). Brief cost and tokens equal the llm call; items first seen after a brief was generated are never attached to it.', '');
for (const b of BRIEFS) {
  lines.push(`### \`${b.key}\`: ${WATCHES.find((w) => w.key === b.watch)!.label}`, `Period ${hh(R(b.start))} to ${hh(R(b.end))}, llm ${b.llm}, ${b.items.length} source items${b.nothingNew ? ', nothing new' : ''}${b.coverage ? ', coverage incomplete (Slack rate limit)' : ''}. ${b.summary.slice(0, 220)}...`);
  for (const h of b.highlights) lines.push(`- **${h.level}** (${h.score}) ${h.title} [${h.status}${h.promote ? ' -> wi-' + String(h.promote.wi).padStart(3, '0') : ''}] ${h.account ?? ''}${h.opp ? ' / ' + h.opp : ''}; reasons: ${h.reasons.map((r) => r.kind).join(', ')}`);
  lines.push('');
}
lines.push('## Relevance learning', '', `${feedbackRows.length} feedback rows (opened, marked_useful, dismissed_not_relevant x${feedbackRows.filter((f) => f.kind === 'dismissed_not_relevant').length}, promoted_to_triage / promoted_to_work_item x2). The Nov 12 08:25 dismissal of \`ops-bh-1\` uses change set 365. ${weightRows.length} learned weights; weight = (opened 0.25 + useful 1 + promoted 1.5 - dismissed 1) / (events + 2), clamped to [-1, 1].`, '');
lines.push('## Chat threads (' + threadRows.length + ', ' + msgRows.length + ' messages, ' + toolRows.length + ' tool calls)', '', 'Assistant messages `llm-chat-01..14` (reserved by domain 03) are produced by llm_calls 284, 285, 286, 355, 518, 522, 577, 622, 623, 643, 644, 676, 677, 693. Thread `first-week` (Oct 19 to 21, archived) has no llm_call ids because those days were rolled up in llm_call_days. Tool names match the chat change sets of domain 03 (`actor_ref`).', '');
for (const th of threads) {
  const first = th.turns[0]!;
  lines.push(`### \`${th.key}\`: ${th.title} (${th.scope})`);
  for (const t of th.turns.slice(0, th.key === 'first-week' ? 3 : 6)) lines.push(`- Asked (${t.key}): ${t.user.slice(0, 140)} Answered: ${t.assistant.slice(0, 160).replace(/\n/g, ' ')}... Tools: ${t.tools.map((x) => x.name + (x.cs ? ` (cs ${x.cs})` : '')).join(', ') || 'none'}`);
  void first;
  lines.push('');
}
lines.push('## Reconcile findings (' + reconcileRows.length + ')', '', Object.entries(reconcileRows.reduce((m: Record<string, number>, r) => { const k = `${r.kind}/${r.status}`; m[k] = (m[k] ?? 0) + 1; return m; }, {})).map(([k, n]) => `${k} ${n}`).join(' · '), '', 'Coverage gaps use the real scan runs: runs 35, 121 (Slack), 135 (Drive), 70 (VDP), 72 (Org62), 66 (Gemini), 149 (VDP today, ignored), 153 (Slack today, `rescan_queued` with job 485). Missed items follow the stale_active pass (runs 79, 121, 137); unlinked items are real gmail/slack items with no evidence; deleted_upstream covers si-357 (Org62 Event deleted), si-369 (Slack), si-465 (calendar).', '');
lines.push('## Provenance links (' + provRows.length + ')', '', Object.entries(provRows.reduce((m: Record<string, number>, r) => { const t = ['nba_id', 'draft_id', 'activity_entry_id', 'tool_run_id', 'chat_message_id', 'brief_id', 'brief_highlight_id'].find((k) => r[k]) ?? '?'; const k = `${t.replace('_id', '')}/${r.role}`; m[k] = (m[k] ?? 0) + 1; return m; }, {})).map(([k, n]) => `${k} ${n}`).join(' · '), '', 'Roles: `trigger` (the item that started an NBA/draft), `context`, `quoted` (the item a highlight or chat answer quotes), `basis` (evidence behind a highlight or an Org62 landing). No missed_opp_finding links: domain 05 reserved no key for them.', '');
lines.push('## Notes for later domains', '', '- `chat_log_batch` (thread `blueprint`) stages `nba-wi003-focus-log`; the draft card in thread `due-week` points at `wi030-reply-hana`; `chat_log_batch` in thread `logging` quotes "11 rows, 15.5 h" for the week of 11/02 (no domain 05 table is read for that number).', '- Watched highlights promoted: `co-tobias` -> wi-041 (Nov 17 14:36, triage), `ns-technical-angle` -> wi-043 (Nov 7 10:24).', '');
writeFileSync(path.join(SAMPLE_DIR, 'CAST-intel.md'), lines.join('\n'));
console.log('wrote CAST-intel.md');

if (warns.length) { console.log('FIRST-SEEN WARNINGS:\n' + warns.join('\n')); }
flushRefs('intel');
void readFileSync; void must; void nbaId; void job; void connector; void wiTitle; void initiative;
