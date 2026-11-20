/** Domain 03: scan_run_events (decision trail), scan_ledger_entries (coverage) and scan_cursors per run. */
import { readTable, rng, sha, slackChannel, slackDm, slackTs, uid, type Row } from '../../lib/kit';
import { CONN, HOUR, MIN, hex, iso, r4, skillVersion } from './ops-lib';
import type { RunX } from './ops-facts';

const R = rng('ops-trace');
const SI = (readTable('source_items') as Array<Record<string, any>>).map((x) => ({ id: x.id as string, conn: x.connector_id as string, t: Date.parse(x.first_seen_at as string) })).sort((a, b) => a.t - b.t);
/** Real source items (domain 02) of a connector seen closest to an instant. */
const itemsNear = (connId: string, t: number, k: number) => {
  const pool = SI.filter((x) => x.conn === connId); const src = pool.length ? pool : SI;
  return [...src].sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t)).slice(0, k).map((x) => x.id);
};
const si = (n?: number) => uid('source_items', `si-${String(n ?? R.int(1, 683)).padStart(3, '0')}`);
const wiU = (n?: number) => uid('work_items', `wi-${String(n ?? R.int(1, 92)).padStart(3, '0')}`);

export interface RunOut { id: string; cost: number; inTok: number; outTok: number; jobId: number | null; calls: number }
const SLACK_TOOLS: Array<[string, (r: RunX) => Record<string, any>]> = [
  ['slack_search_public_and_private', (r) => ({ q: 'to:me', sort: 'timestamp', limit: 50, response_format: 'concise' })],
  ['slack_read_channel', (r) => ({ channel_id: r.scope?.startsWith('channel:') ? r.scope.slice(8) : slackChannel(1), limit: 100, response_format: 'concise' })],
  ['slack_read_thread', (r) => ({ channel_id: r.scope?.startsWith('channel:') ? r.scope.slice(8) : slackChannel(3), message_ts: slackTs(iso(r.winTo - 3 * HOUR), R.int(0, 50)), limit: 50 })],
  ['slack_search_users', () => ({ query: 'smpl', limit: 5 })],
];

export function buildTrace(runs: RunX[], runOf: Map<string, RunOut>): { events: Row[]; ledger: Row[]; cursors: Row[] } {
  const events: Row[] = []; const ledger: Row[] = [];
  let eid = 0; let lid = 0;
  const retried = new Set(runs.filter((x) => x.retryOfKey).map((x) => x.retryOfKey));
  for (const r of runs) {
    const out = runOf.get(r.key)!;
    const sk = CONN[r.conn].scanKind;
    const scopeId = r.scope ? `${sk}:${r.scope}` : sk;
    const ok = r.status === 'succeeded' || r.status === 'partial';
    const dur = r.endMs - r.startMs;
    const evs: Array<{ kind: string; payload: Record<string, any>; src?: string; wi?: string }> = [];
    const f = r.f;
    evs.push({ kind: 'plan', payload: { attempt: r.attempt, budget: r.budget, chunkMin: r.mode === 'backfill' ? 10080 : 15, connector: sk, costCapUsd: r.costCap, cursorAt: r.cursorBeforeAt ? iso(r.cursorBeforeAt) : null, jobBudget: r.budget === 'first_scan' ? 'first_scan' : null, jobId: out.jobId, kind: r.mode === 'reconcile' ? 'reconcile' : 'scan', maxTurns: 30, mode: r.mode === 'reconcile' ? 'reconcile' : r.pmode, model: CONN[r.conn].tier === 'none' ? 'none' : 'claude-haiku-5-5', overBudget: false, scope: r.scope ?? 'reconcile', skillVersion: skillVersion(CONN[r.conn].skill, CONN[r.conn].ver), trigger: r.trigger, vars: sk === 'slack' && r.scope?.startsWith('channel:') ? { channel: { id: r.scope.slice(8) } } : sk === 'drive' ? { maxItems: '60' } : null, window: { from: iso(r.winFrom), to: iso(r.winTo) }, windowMin: Math.round((r.winTo - r.winFrom) / MIN) } });
    const fetchers = ['gmail', 'calendar', 'drive', 'gemini_notes', 'claude_sessions', 'vdp'];
    if (fetchers.includes(sk) && (ok || r.err?.cls !== 'auth')) evs.push({ kind: 'prefetch', payload: { agent: false, complete: ok, coverage: Math.max(1, Math.round(f.seen / 4)), deferred: false, items: f.seen, limit: 200, ms: R.int(300, 4200), nextCursorAt: iso(r.winTo), recordOnly: sk === 'vdp' } });
    const nTools = sk === 'slack' ? (ok ? R.int(1, 3) : r.err?.cls === 'rate_limited' ? 2 : 1) : sk === 'org62' ? 1 : 0;
    for (let i = 0; i < nTools; i++) {
      const [tool, argf] = sk === 'slack' ? (r.scope === 'inbox' ? SLACK_TOOLS[i % 2 === 0 ? 0 : 2]! : SLACK_TOOLS[i % 3 === 2 ? 2 : 1]!) : ['soqlQuery', () => ({ query: `SOQL ${r.scope ?? 'opps'} (ids only)`, limit: 200 })] as any;
      const failTool = !ok && i === nTools - 1 && r.err?.cls === 'rate_limited';
      evs.push({ kind: 'tool_call', payload: { args: argf(r), count: failTool ? 0 : R.int(1, 40), error: failTool ? 'ratelimited (HTTP 429, retry-after 62s)' : null, ms: failTool ? R.int(120, 400) : R.int(280, 2600), pass: i === nTools - 1 && sk === 'slack' && f.nw > 4 ? 'triage' : 'scan', server: sk === 'org62' ? 'Org62-Sobject-Read' : sk, size: failTool ? 0 : R.int(1_800, 62_000), tool } });
    }
    if (ok || r.err?.cause === 'cost_cap') {
      const toks = Math.round((out.inTok + 1) / Math.max(1, out.calls));
      evs.push({ kind: 'prompt', payload: { dataChars: R.int(14_000, 120_000), headroom: Math.max(1000, 180_000 - toks), limit: 180_000, model: 'claude-haiku-5-5', pass: 'scan', proseChars: R.int(6_000, 11_000), tokens: Math.min(179_000, toks) } });
      evs.push({ kind: 'rec', payload: { changed: f.upd, dup: Math.max(0, f.unch >> 2), new: f.nw, parsed: f.seen, query: r.scope ?? 'reconcile', recorded: f.nw + f.upd, tool: sk === 'slack' ? 'cc_record_source_items' : 'cc_record_source_items' } });
      const ids = itemsNear(CONN[r.conn].id, r.endMs, Math.min(3, f.nw));
      if (f.nw + f.upd > 0) evs.push({ kind: 'recorded', payload: { changed: f.upd, ids, n: f.nw + f.upd, new: f.nw, newIds: ids }, src: ids[0] });
    }
    if (ok && sk === 'slack' && f.nw > 0 && R.chance(0.4)) {
      const e = itemsNear(CONN[r.conn].id, r.endMs, 1)[0] ?? si();
      evs.push({ kind: 'verdict', payload: { acted: [R.pick(['link', 'propose', 'ignore'])], batch: 1, escalate: R.chance(0.1), final: true, ok: true, pass: 'triage', ref: e, v: R.pick(['ask', 'fyi', 'noise', 'commitment']), why: R.pick(['direct_ask_to_me', 'bot_post', 'status_update', 'thread_i_started', 'channel_ask']) }, src: e });
    }
    if (ok && f.links > 0 && R.chance(0.4)) {
      const e = itemsNear(CONN[r.conn].id, r.endMs, 2)[1] ?? si(); const w = wiU();
      evs.push({ kind: 'link', payload: { confidence: R.pick(['high', 'high', 'medium']), evidenceId: e, reason: R.pick(['same_thread', 'named_in_message', 'same_account_deliverable', 'reply_to_my_message']), role: R.pick(['context', 'ask', 'update']) }, src: e, wi: w });
    }
    if (ok || r.err?.cause === 'cost_cap') {
      evs.push({ kind: 'spend', payload: { budget: r.budget, costUsd: out.cost, jobId: out.jobId, model: 'claude-haiku-5-5', models: ['claude-haiku-5-5'], parts: out.calls, purpose: 'scan_extract' } });
      if (ok && R.chance(0.22)) evs.push({ kind: 'pass', payload: { cacheReadTokens: R.int(60_000, 300_000), cacheWriteTokens: R.int(10_000, 50_000), complete: true, contentHash: hex(r.key + 'pass', 16), costUsd: out.cost, counts: { changed: f.upd, coverage: Math.max(1, f.seen >> 3), linked: f.links, new: f.nw, proposed: f.cands, recorded: f.nw + f.upd, unlinked: f.unlinked }, error: null, errorClass: null, finished: true, inputTokens: out.inTok, mode: r.mode === 'reconcile' ? 'relink' : 'scan', model: 'claude-haiku-5-5', ms: dur, ok: true, outputTokens: out.outTok, pass: 'scan', rec: { calls: R.int(1, 4), dup: 0, errors: 0, parsed: f.seen, recorded: f.nw + f.upd }, turns: f.turns } });
    }
    if (ok) {
      evs.push({ kind: 'coverage', payload: { kinds: [kindFor(r)], n: Math.max(1, f.seen >> 3), notes: r.status === 'partial' ? ['stopped before the last window'] : [], refs: [r.scope ?? 'reconcile'] } });
      evs.push({ kind: 'commit', payload: { coverage: Math.max(1, f.seen >> 3), cursorAt: iso(r.cursorAfterAt ?? r.winTo), touched: f.nw + f.upd } });
      evs.push({ kind: 'outcome', payload: { complete: r.status === 'succeeded', continues: r.mode === 'backfill' && r.status === 'succeeded' && R.chance(0.5), costUsd: out.cost, cursorAt: iso(r.cursorAfterAt ?? r.winTo), detail: r.status === 'partial' ? 'partial: max_turns' : 'ok', disallowedTool: null, followUps: [], ms: dur, stalled: false, stats: { changed: f.upd, costUsd: out.cost, fetched: f.seen, inputTokens: out.inTok, linked: f.links, new: f.nw, outputTokens: out.outTok, proposed: f.cands, turns: f.turns, unlinked: f.unlinked }, status: r.status === 'partial' ? 'partial' : 'succeeded', touched: f.nw + f.upd } });
    } else if (r.status === 'failed') {
      if (r.err!.cause === 'cost_cap') evs.push({ kind: 'cost_cap', payload: { capUsd: r.costCap, spentUsd: out.cost, pass: 'scan' } });
      if (retried.has(r.key)) evs.push({ kind: 'retry', payload: { attempt: r.attempt + 1, class: r.err!.cls, retryInSec: R.pick([60, 120, 300]) } });
      evs.push({ kind: 'failed', payload: { code: r.err!.cause, error: r.err!.msg.slice(0, 160), errorClass: r.err!.cls === 'config' ? 'config' : r.err!.cls } });
    } else {
      evs.push({ kind: 'failed', payload: { code: 'cancelled', error: r.err!.msg.slice(0, 160), errorClass: 'transient' } });
    }
    evs.forEach((e, i) => {
      events.push({ id: ++eid, run_id: out.id, seq: i + 1, ts: iso(r.startMs + Math.round(((i + 1) / (evs.length + 1)) * Math.max(1000, dur))), kind: e.kind, payload: e.payload, source_item_id: e.src ?? null, work_item_id: e.wi ?? null });
    });
    // ── ledger ─────────────────────────────────────────────────────────────────────────────────
    const entries = ledgerFor(r);
    const outcomeOf = (i: number) => (ok ? (r.status === 'partial' && i === entries.length - 1 ? 'truncated' : 'complete') : r.status === 'cancelled' ? 'skipped' : i === entries.length - 1 ? 'error' : 'complete');
    const keep = ok ? entries : entries.slice(0, Math.min(entries.length, r.status === 'failed' ? (f.seen ? 2 : 1) : 1));
    let remainSeen = f.seen; let remainNew = f.nw;
    keep.forEach((e, i) => {
      const last = i === keep.length - 1;
      const cnt = ok ? (last ? remainSeen : Math.min(remainSeen, Math.max(1, Math.round(f.seen / keep.length)))) : 0;
      const nw = ok ? (last ? remainNew : Math.min(remainNew, Math.round(f.nw / keep.length))) : 0;
      remainSeen -= cnt; remainNew -= nw;
      ledger.push({
        id: ++lid, scan_run_id: out.id, connector_id: CONN[r.conn].id, scope: scopeId, object_kind: e.kind, object_external_id: e.id, covered_from: iso(r.winFrom), covered_to: iso(ok || i < keep.length - 1 ? r.winTo : r.winFrom + Math.round((r.winTo - r.winFrom) * 0.4)),
        start_token: e.t0, end_token: e.t1, item_count: cnt, new_item_count: Math.min(nw, cnt), result_hash: ok ? hex(`${r.key}|${e.id}|${cnt}`, 16) : null, outcome: outcomeOf(i), created_at: iso(r.endMs + 150),
      });
    });
  }
  // ── cursors: one per (connector, scope) from the last advancing run ─────────────────────────────
  const cursors: Row[] = [];
  const byKey = new Map<string, RunX[]>();
  for (const r of runs) if (r.mode !== 'reconcile' && (r.status === 'succeeded' || r.status === 'partial')) { const k = `${r.conn}|${r.scope}`; byKey.set(k, [...(byKey.get(k) ?? []), r]); }
  for (const [k, rs] of byKey) {
    const inc = rs.filter((x) => x.mode !== 'backfill');
    const last = (inc.length ? inc : rs)[(inc.length ? inc : rs).length - 1]!;
    const first = rs[0]!;
    const conn = last.conn; const sk = CONN[conn].scanKind;
    const low = Math.min(...rs.map((x) => x.winFrom));
    const hi = Math.max(...rs.map((x) => x.cursorAfterAt ?? 0), last.cursorAfterAt ?? 0);
    cursors.push({ id: uid('scan_cursors', k), owner_user_id: OWNER_ID, connector_id: CONN[conn].id, scope: `${sk}:${last.scope}`, cursor_kind: 'composite', cursor_value: last.cursorValue, cursor_json: { at: iso(hi), value: last.cursorValue, turns: last.f.turns, unlinked: last.f.unlinked }, high_watermark_at: iso(hi), low_watermark_at: iso(low), status: 'active', last_run_id: runOf.get(last.key)!.id, last_advanced_at: iso(last.endMs), created_at: iso(first.startMs), updated_at: iso(last.endMs) });
  }
  void sha; void slackDm; void r4;
  return { events, ledger, cursors };
}
const OWNER_ID = uid('users', 'owner');

function kindFor(r: RunX): string {
  switch (CONN[r.conn].scanKind) {
    case 'slack': return r.scope === 'inbox' ? 'search_query' : 'channel_history';
    case 'gmail': return 'mailbox_page';
    case 'calendar': return 'calendar_range';
    case 'drive': return 'file';
    case 'gemini_notes': return 'transcript_file';
    case 'org62': return 'soql_query';
    case 'claude_sessions': return 'file';
    default: return 'vdp_list';
  }
}

interface Ent { kind: string; id: string; t0: string | null; t1: string | null }
function ledgerFor(r: RunX): Ent[] {
  const sk = CONN[r.conn].scanKind; const e: Ent[] = [];
  const ts0 = slackTs(iso(r.winFrom), 0); const ts1 = slackTs(iso(r.winTo), 0);
  const n = Math.max(1, r.f.seen);
  if (sk === 'slack') {
    if (r.scope === 'inbox' || r.scope === null) {
      e.push({ kind: 'search_query', id: hex('q:to:me:' + r.key), t0: ts0, t1: ts1 }, { kind: 'search_query', id: hex('q:mentions:' + r.key), t0: ts0, t1: ts1 });
      if (R.chance(0.5)) e.push({ kind: 'dm', id: slackDm(R.int(1, 3)), t0: ts0, t1: ts1 });
      for (let i = 0; i < R.int(2, 5); i++) e.push({ kind: 'thread', id: `${slackChannel(R.int(1, 7))}:${slackTs(iso(r.winTo - R.int(1, 40) * MIN), R.int(0, 99))}`, t0: null, t1: null });
    } else {
      const parts = r.mode === 'backfill' ? R.int(3, 5) : 1;
      for (let i = 0; i < parts; i++) e.push({ kind: 'channel_history', id: r.scope!.slice(8), t0: slackTs(iso(r.winFrom + ((r.winTo - r.winFrom) * i) / parts), i), t1: slackTs(iso(r.winFrom + ((r.winTo - r.winFrom) * (i + 1)) / parts), i) });
      for (let i = 0; i < Math.min(5, Math.max(1, Math.round(r.f.links))); i++) e.push({ kind: 'thread', id: `${r.scope!.slice(8)}:${slackTs(iso(r.winTo - R.int(1, 90) * MIN), R.int(0, 99))}`, t0: null, t1: null });
    }
  } else if (sk === 'gmail') {
    for (let i = 0; i < Math.max(2, Math.round(n / 8)); i++) e.push({ kind: 'mailbox_page', id: `smpl-page-${hex(r.key + i, 6)}`, t0: i ? `smpl-page-${hex(r.key + (i - 1), 6)}` : null, t1: `smpl-page-${hex(r.key + i, 6)}` });
    e.push({ kind: 'search_query', id: hex('gq:' + (r.scope ?? '') + r.key), t0: null, t1: null });
    for (let i = 0; i < Math.min(5, Math.max(1, Math.round(r.f.nw))); i++) e.push({ kind: 'thread', id: `smpl-thread-${hex(r.key + 't' + i, 8)}`, t0: null, t1: null });
  } else if (sk === 'calendar') {
    const days = Math.max(1, Math.min(6, Math.round((r.winTo - r.winFrom) / (24 * HOUR)) + 1));
    for (let i = 0; i < days; i++) e.push({ kind: 'calendar_range', id: `smpl-cal-primary:${iso(r.winTo + i * 24 * HOUR).slice(0, 10)}`, t0: iso(r.winTo + i * 24 * HOUR).slice(0, 10), t1: iso(r.winTo + (i + 1) * 24 * HOUR).slice(0, 10) });
  } else if (sk === 'drive') {
    e.push({ kind: 'search_query', id: hex('dq:' + r.key), t0: null, t1: null });
    for (let i = 0; i < Math.min(18, Math.max(4, Math.round(n / 2))); i++) e.push({ kind: 'file', id: `smpl-file-${hex(r.key + i, 10)}`, t0: null, t1: null });
  } else if (sk === 'gemini_notes') {
    for (let i = 0; i < Math.max(1, r.f.seen); i++) e.push({ kind: 'transcript_file', id: `smpl-notes-${hex(r.key + i, 10)}`, t0: '0', t1: String(R.int(18_000, 96_000)) });
  } else if (sk === 'org62') {
    for (let i = 0; i < R.int(3, 6); i++) e.push({ kind: 'soql_query', id: hex(`soql:${r.scope}:${i}`, 12), t0: iso(r.winFrom), t1: iso(r.winTo) });
  } else if (sk === 'claude_sessions') {
    for (let i = 0; i < Math.min(16, Math.max(3, Math.round(n / 2))); i++) e.push({ kind: 'file', id: `claude:file:smpl-session-${hex(r.key + i, 8)}.jsonl`, t0: '0', t1: String(R.int(8_000, 480_000)) });
  } else e.push({ kind: 'vdp_list', id: 'mine', t0: null, t1: null });
  if (r.mode === 'reconcile') return e.slice(0, 4);
  return e.slice(0, 22);
}
void skillVersion;
