/**
 * Post-pass 91: cross-domain causality fixes that only make sense once every domain has run (reads and rewrites
 * tables in place). Deterministic. Runs after 90-reconcile. Every block says which contradiction it removes.
 *
 *  A. audit/change sets of engine passes (completion, settle, priority, nba) are rebuilt on the real work-item timelines
 *  B. jobs that name a work item before it existed are re-pointed (or, before the first item exists, become plain checks)
 *  C. one change set that said "NDA ask done" on the privacy training now describes a real user-closed item
 *  D. the Elderglen Outdoors demo reply (storyline 2) is drafted after the Slack ask was first seen (11-18 morning)
 *  E. brief.generate job counters follow the watch subscriptions that existed and the calls that ran
 *  F. NBA plan rows for the weekly logging items follow the activity entries; NBA.draft_id follows drafts.nba_id
 *  G. small field alignments (waiting_since, activity audit images, draft/NBA vs llm call times, unseen reply targets)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SAMPLE_DIR, readTable, rng, uid, writeTable, type Row } from '../lib/kit';

const R = rng('consistency-91');
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const ms = (iso: unknown) => new Date(String(iso)).getTime();
const iso = (t: number) => new Date(t).toISOString();
/** 2026-11-18 08:06 MT (UTC-7) style helper: month, day, 'HH:MM[:SS]' → ISO */
const mt = (md: string, hhmm: string) => { const [m, d] = md.split('-').map(Number); const [h, mi, s] = hhmm.split(':').map(Number); return iso(Date.UTC(2026, m! - 1, d, h! + 7, mi ?? 0, s ?? 0)); };
const mtLocal = (t: unknown) => iso(ms(t) - 7 * HOUR).slice(0, 16); // 'YYYY-MM-DDTHH:MM'

const wi = readTable('work_items'); const wiNum = new Map(wi.map((w, i) => [String(w.id), i + 1])); const wiBy = new Map(wi.map((w) => [String(w.id), w]));
const wiId = (n: number) => String(wi[n - 1]!.id);
const trans = readTable('work_item_transitions'); const jobs = readTable('jobs'); const cs = readTable('change_sets'); let au = readTable('audit_events');
const nba = readTable('next_best_actions'); const drafts = readTable('drafts'); const calls = readTable('llm_calls');
const csBy = new Map(cs.map((c) => [String(c.id), c]));
const transBy = new Map<string, Row[]>();
for (const t of [...trans].sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)))) { const l = transBy.get(String(t.work_item_id)) ?? []; l.push(t); transBy.set(String(t.work_item_id), l); }

/** status of an item at time t (null = does not exist yet) */
function statusAt(id: string, t: number): string | null {
  const w = wiBy.get(id)!; if (ms(w.created_at) > t) return null;
  let s: string | null = null;
  for (const x of transBy.get(id) ?? []) { if (ms(x.occurred_at) <= t && !(x.undone_at && ms(x.undone_at) <= t)) s = String(x.to_status); }
  return s;
}
const OPEN = ['open', 'in_progress', 'waiting_on_me', 'waiting_on_others'];
const RANKED = ['open', 'in_progress', 'waiting_on_me'];
const eligible = (t: number, set: string[]) => wi.filter((w) => ms(w.created_at) <= t - MIN && set.includes(String(statusAt(String(w.id), t)))).map((w) => String(w.id));
const versionAt = (id: string, t: number) => 1 + (transBy.get(id) ?? []).filter((x) => ms(x.occurred_at) < t).length;
const lastTouched = (id: string, t: number) => { const prev = (transBy.get(id) ?? []).filter((x) => ms(x.occurred_at) < t).pop(); return prev ? ms(prev.occurred_at) : ms(wiBy.get(id)!.created_at); };

// ── B. jobs that name a work item that did not exist yet ───────────────────────────────────────────
const firstItemMs = Math.min(...wi.map((w) => ms(w.created_at)));
const nbaByWi = new Map<string, Row[]>(); for (const n of nba) { const l = nbaByWi.get(String(n.work_item_id)) ?? []; l.push(n); nbaByWi.set(String(n.work_item_id), l); }
const repointed = new Map<number, { from: string; to: string }>();
for (const j of jobs) {
  const p = (j.payload ?? {}) as Record<string, any>; const id = p.work_item_id as string | undefined; if (!id || !wiBy.has(id)) continue;
  const t = ms(j.created_at); if (ms(wiBy.get(id)!.created_at) <= t) continue;
  if (j.kind === 'reevaluate' && t < firstItemMs) {
    // before the first work item exists the scan can only queue a completion check for its run
    j.kind = 'completion.check'; j.queue = 'completion';
    j.payload = { connector: p.connector, run_id: p.run_id, trigger: 'schedule' };
    j.dedupe_key = `completion:${p.connector}`; j.generation = null; j.supersedes_running = false;
    if (j.status === 'cancelled') { j.cancel_reason = 'superseded by a newer completion check'; }
    j.result = j.status === 'succeeded' ? { watermark: iso(t - MIN), checked: 0, judged: 0, applied: { close: 0, ask_still_needed: 0, wait: 0, reopen: 0 }, escalated: 0, costUsd: 0, calls: 0 } : j.result ?? null;
    continue;
  }
  let pick: string | undefined;
  if (j.kind === 'nba.generate') {
    const near = nba.find((n) => Math.abs(ms(n.created_at) - ms(j.finished_at ?? j.created_at)) < 3 * MIN && wiBy.has(String(n.work_item_id)));
    if (near) pick = String(near.work_item_id);
  }
  if (!pick) { const pool = eligible(t, OPEN).filter((x) => x !== id); pick = pool.length ? pool[Math.floor(R.next() * pool.length)] : eligible(t, [...OPEN, 'suggested', 'snoozed', 'likely_done'])[0]; }
  if (!pick) continue;
  repointed.set(Number(j.id), { from: id, to: pick });
  j.payload = { ...p, work_item_id: pick };
  if (typeof j.dedupe_key === 'string' && j.dedupe_key.includes(id)) j.dedupe_key = String(j.dedupe_key).replace(id, pick);
  if (j.result && (j.result as any).workItemId) j.result = { ...(j.result as any), workItemId: pick };
}
writeTable('jobs', jobs);

// ── A. engine-pass change sets: rebuild their work_items audit rows on the item timelines ─────────────
const maxAuditId = () => au.reduce((m, a) => Math.max(m, Number(a.id)), 0);
const auByCs = new Map<string, Row[]>(); for (const a of au) { const l = auByCs.get(String(a.change_set_id)) ?? []; l.push(a); auByCs.set(String(a.change_set_id), l); }
const jobByKind = (kind: string) => jobs.filter((j) => j.kind === kind && j.status === 'succeeded');
const closeCountBy = new Map<string, number>();
const passes = cs.filter((c) => c.kind === 'engine_pass').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
const pruned = new Set<number>(); // audit ids dropped
const added: Row[] = [];
let nextId = maxAuditId();
const mkAudit = (c: Row, reuse: number[], id: string, before: Row, after: Row, createdAt: string, extra: Partial<Row> = {}): Row => {
  const rid = reuse.length ? reuse.shift()! : ++nextId;
  const keys = Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  return { id: rid, owner_user_id: c.owner_user_id, change_set_id: c.id, actor_kind: c.actor_kind, actor_ref: c.actor_ref, table_name: 'work_items', row_id: id, entity_type: 'work_item', entity_id: id, op: 'update', changed_fields: keys.sort(), before, after, coalesced_count: 1, destination: null, payload_hash: null, created_at: createdAt, updated_at: createdAt, ...extra };
};
const wiBase = (id: string) => ({ id, owner_user_id: wiBy.get(id)!.owner_user_id });
const sums = new Map<string, string>(); // change set id → new summary
const priorityRuns = readTable('priority_runs'); const scores = readTable('priority_scores');
const scoreBy = new Map<string, Map<string, Row>>(); for (const s of scores) { const m = scoreBy.get(String(s.run_id)) ?? new Map(); m.set(String(s.work_item_id), s); scoreBy.set(String(s.run_id), m); }
const runsSorted = [...priorityRuns].sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
let chosenUndoTarget: Row | null = null;

for (const c of passes) {
  const ref = String(c.actor_ref);
  const kind = ref.startsWith('engine.completion') ? 'completion' : ref.startsWith('engine.settle') ? 'settle' : ref.startsWith('engine.priority') ? 'priority' : ref.startsWith('engine.nba') ? 'nba' : null;
  if (!kind) continue;
  const old = auByCs.get(String(c.id)) ?? []; const oldWi = old.filter((a) => a.table_name === 'work_items');
  const reuse = oldWi.map((a) => Number(a.id)).sort((x, y) => x - y);
  const t = ms(c.created_at);
  const keep = old.filter((a) => a.table_name !== 'work_items');
  const rows: Row[] = [];
  const used = new Set<string>();
  const offset = (k: number) => iso(t + 150 + k * 90);

  if (kind === 'nba') {
    // the NBA pass row names the job's (repointed) work item
    const jb = jobs.find((j) => j.kind === 'nba.generate' && Math.abs(ms(j.finished_at) + 300 - t) < 5_000);
    const oldId = String(c.entity_id); const newId = jb ? String((jb.payload as any).work_item_id) : oldId;
    const realNba = (nbaByWi.get(newId) ?? []).filter((n) => Math.abs(ms(n.created_at) - t) < 6 * MIN).sort((a, b) => ms(a.created_at) - ms(b.created_at));
    const cur = realNba[realNba.length - 1];
    for (const a of old) {
      if (a.table_name === 'work_items') {
        const before = { ...(a.before as Row), id: newId, owner_user_id: wiBy.get(newId)!.owner_user_id }; const after = { ...(a.after as Row), id: newId, owner_user_id: wiBy.get(newId)!.owner_user_id };
        if (cur) { (after as any).current_nba_id = cur.id; }
        (before as any).updated_at = iso(Math.max(lastTouched(newId, t), ms(wiBy.get(newId)!.created_at)));
        a.row_id = newId; a.entity_id = newId; a.before = before; a.after = after;
      } else if (a.table_name === 'next_best_actions') {
        a.entity_id = newId; if (a.before) (a.before as any).work_item_id = newId;
        const prior = (nbaByWi.get(newId) ?? []).filter((n) => ms(n.created_at) < t - MIN).pop();
        if (prior) { a.row_id = prior.id; (a.before as any).id = prior.id; (a.before as any).created_at = prior.created_at; }
      }
    }
    c.entity_id = newId;
    continue;
  }

  if (kind === 'completion' || kind === 'settle') {
    const linkedAll = trans.filter((x) => x.change_set_id === c.id && String(x.actor_ref).startsWith(`engine.${kind}`) && ['done', 'likely_done', 'dismissed', 'waiting_on_others'].includes(String(x.to_status)));
    // a transition more than 15 minutes from its pass is not that pass's write
    for (const x of linkedAll) if (Math.abs(ms(x.occurred_at) - t) > 15 * MIN) x.change_set_id = null;
    const linked = linkedAll.filter((x) => x.change_set_id === c.id);
    let k = 0;
    for (const x of linked) {
      const id = String(x.work_item_id); const w = wiBy.get(id)!; used.add(id); const at = ms(x.occurred_at);
      const v = versionAt(id, at);
      const before: Row = { ...wiBase(id), status: x.from_status, status_changed_at: iso(lastTouched(id, at)), version: v, updated_at: iso(lastTouched(id, at)) };
      const after: Row = { ...wiBase(id), status: x.to_status, status_changed_at: iso(at), version: v + 1, updated_at: iso(at) };
      if (x.to_status === 'done') { Object.assign(before, { done_at: null, done_by: null, resolution: null }); Object.assign(after, { done_at: iso(at), done_by: 'engine', resolution: w.resolution ?? 'done_by_me' }); }
      rows.push(mkAudit(c, reuse, id, before, after, iso(Math.max(at, t + 100 + k * 90)))); k++;
    }
    const closed = linked.filter((x) => x.to_status === 'done').length;
    // markers: items the pass judged "probably finished" without changing their status
    const jb = jobs.find((j) => (j.kind === 'completion.check' || j.kind === 'settle.check') && Math.abs(ms(j.finished_at) + (kind === 'completion' ? 400 : 300) - t) < 5_000);
    const res = (jb?.result ?? {}) as any; const appl = (res.applied ?? {}) as any;
    const want = kind === 'completion' ? (appl.wait ?? 1) + (appl.ask_still_needed ?? 1) : Math.max(1, (res.changed ?? 2) - linked.length);
    const pool = eligible(t, OPEN).filter((x) => !used.has(x)).sort(() => R.next() - 0.5);
    const markers = Math.min(want, pool.length, 4);
    for (let q = 0; q < markers; q++) {
      const id = pool[q]!; const s = String(statusAt(id, t)); const v = versionAt(id, t);
      rows.push(mkAudit(c, reuse, id, { ...wiBase(id), status: s, likely_done_at: null, likely_done_confidence: null, version: v, updated_at: iso(lastTouched(id, t)) }, { ...wiBase(id), status: s, likely_done_at: iso(t), likely_done_confidence: R.pick([0.62, 0.71, 0.78]), version: v + 1, updated_at: iso(t) }, offset(k + q)));
    }
    if (kind === 'completion') {
      const mk = rows.length - linked.length; const waitN = Math.min(appl.wait ?? 0, mk); const stillN = mk - waitN;
      sums.set(String(c.id), `Completion pass: ${closed} closed, ${waitN} waiting, ${stillN} still needed`);
      if (jb) { appl.close = closed; appl.wait = waitN; appl.ask_still_needed = stillN; jb.result = { ...res, applied: appl }; }
    }
    else { sums.set(String(c.id), `Settle pass: ${rows.length} changed of ${Math.max(rows.length, res.judged ?? rows.length)} judged`); if (jb) { jb.result = { ...res, changed: rows.length, judged: Math.max(rows.length, res.judged ?? rows.length) }; } }
    if (!rows.length) { /* nothing eligible: the pass touched only settings */ }
    if (!chosenUndoTarget && kind === 'completion' && rows.length && !linked.length) chosenUndoTarget = c;
  } else if (kind === 'priority') {
    const day = iso(t - 7 * HOUR).slice(0, 10);
    const runIdx = runsSorted.findIndex((r) => iso(ms(r.started_at) - 7 * HOUR).slice(0, 10) === day && r.trigger !== 'chat' && r.trigger !== 'user_reprioritize');
    const run = runIdx >= 0 ? runsSorted[runIdx]! : null;
    const cur = run ? scoreBy.get(String(run.id)) : undefined; const prevRun = runIdx > 0 ? runsSorted[runIdx - 1]! : null; const prev = prevRun ? scoreBy.get(String(prevRun.id)) : undefined;
    const nT = run ? ms(run.finished_at ?? run.started_at) : t;
    const delta = nT - t; // align the change set with the run it records
    if (run) { c.created_at = iso(nT); c.closed_at = iso(nT + 3800); }
    const tt = run ? nT : t;
    if (cur && cur.size) {
      let q = 0;
      for (const [id, s] of cur) {
        if (rows.length >= 28) break; const pv = prev?.get(id);
        if (pv && pv.rank === s.rank && pv.lane === s.lane) continue;
        const v = versionAt(id, tt);
        rows.push(mkAudit(c, reuse, id, { ...wiBase(id), priority_rank: pv?.rank ?? null, priority_score: pv?.total ?? null, priority_lane: pv?.lane ?? null, updated_at: iso(lastTouched(id, tt)), version: v }, { ...wiBase(id), priority_rank: s.rank, priority_score: s.total, priority_lane: s.lane, priority_computed_at: iso(tt), updated_at: iso(tt), version: v + 1 }, iso(tt + 120 + q * 40))); q++;
      }
      sums.set(String(c.id), `Priority run: re-ranked ${cur.size} open items`);
    } else {
      const pool = eligible(tt, RANKED).sort(() => R.next() - 0.5);
      const k = Math.min(pool.length, Math.max(1, Math.min(Number(run?.items_changed ?? 12), 24)));
      for (let q = 0; q < k; q++) { const id = pool[q]!; const rk = R.int(1, Math.max(3, pool.length)); const v = versionAt(id, tt);
        rows.push(mkAudit(c, reuse, id, { ...wiBase(id), priority_rank: rk + R.int(1, 3), priority_score: R.int(20, 90) / 10, priority_lane: R.pick(['later', 'now', 'later']), updated_at: iso(lastTouched(id, tt)), version: v }, { ...wiBase(id), priority_rank: rk, priority_score: R.int(20, 95) / 10, priority_lane: R.pick(['top3', 'now', 'later']), priority_computed_at: iso(tt), updated_at: iso(tt), version: v + 1 }, iso(tt + 120 + q * 40))); }
      sums.set(String(c.id), `Priority run: re-ranked ${pool.length} open items`);
    }
    // the cc.meta image rides along with the run
    for (const a of keep) { for (const f of ['before', 'after', 'created_at', 'updated_at'] as const) { const s0 = JSON.stringify(a[f]); a[f] = JSON.parse(s0.replace(/"(2026-\d\d-\d\dT[\d:.]+Z)"/g, (_m, g) => `"${iso(ms(g) + delta)}"`)); } }
    c.entity_id = 'ranking';
  }
  if (rows.length) { const last = Math.max(...rows.map((r) => ms(r.created_at))); if (last + 500 > ms(c.closed_at)) c.closed_at = iso(last + 500); }
  const dropped = reuse; for (const id of dropped) pruned.add(id);
  for (const a of oldWi) if (!rows.some((r) => r.id === a.id)) pruned.add(Number(a.id));
  for (const r of rows) pruned.delete(Number(r.id));
  added.push(...rows);
  if (kind === 'completion' || kind === 'settle') { c.entity_id = rows[0] ? rows[0].row_id : c.entity_id; }
}
au = au.filter((a) => !pruned.has(Number(a.id)) || !(a.table_name === 'work_items' && csBy.get(String(a.change_set_id))?.kind === 'engine_pass' && /completion|settle|priority/.test(String(csBy.get(String(a.change_set_id))?.actor_ref))));
// rows replaced in place (same id) must not be duplicated
const addedIds = new Set(added.map((r) => Number(r.id)));
au = au.filter((a) => !(addedIds.has(Number(a.id)) && a.table_name === 'work_items' && /completion|settle|priority/.test(String(csBy.get(String(a.change_set_id))?.actor_ref ?? ''))));
au.push(...added);
for (const c of cs) { const s = sums.get(String(c.id)); if (s) c.summary = s; }

// the undone engine pass: first completion pass that marked items (the user cleared one marker 2 h later)
{
  const undo = cs.find((c) => c.kind === 'undo' && String(c.summary).startsWith('Undo: Completion pass'))!;
  const oldOrig = csBy.get(String(undo.undo_of_change_set_id))!; const tgt = chosenUndoTarget;
  if (tgt && tgt !== oldOrig) {
    oldOrig.undone_at = null; oldOrig.undone_by_change_set_id = null;
    const tt = ms(tgt.created_at); const ut = tt + 2 * HOUR + 17_300;
    const row = (au.filter((a) => a.change_set_id === tgt.id && a.table_name === 'work_items')[0])!;
    au = au.filter((a) => a.change_set_id !== undo.id);
    undo.undo_of_change_set_id = tgt.id; undo.summary = `Undo: ${tgt.summary}`.slice(0, 140); undo.entity_id = row.row_id; undo.created_at = iso(ut); undo.closed_at = iso(ut + 1800);
    tgt.undone_at = iso(ut); tgt.undone_by_change_set_id = undo.id;
    au.push({ id: ++nextId, owner_user_id: undo.owner_user_id, change_set_id: undo.id, actor_kind: 'user', actor_ref: undo.actor_ref, table_name: 'work_items', row_id: row.row_id, entity_type: 'work_item', entity_id: row.row_id, op: 'update', changed_fields: row.changed_fields, before: row.after, after: row.before, coalesced_count: 1, destination: null, payload_hash: null, created_at: iso(ut + 300), updated_at: iso(ut + 300) });
  }
}

// ── C. change set 174: "Marked the NDA ask done" described the privacy training; use a real user-closed item ────
{
  const c = cs[173]!; const id = wiId(100); const x = (transBy.get(id) ?? []).find((y) => y.actor_kind === 'user' && y.to_status === 'done')!;
  const at = ms(x.occurred_at); c.summary = 'Marked the proof-points ask done'; c.entity_id = id; c.created_at = iso(at - 1230); c.closed_at = iso(at + 1170); x.change_set_id = c.id;
  const a = au.find((y) => y.change_set_id === c.id)!; const v = versionAt(id, at);
  a.row_id = id; a.entity_id = id; a.created_at = iso(at - 0); a.updated_at = a.created_at;
  a.before = { ...wiBase(id), status: 'open', version: v, updated_at: iso(lastTouched(id, at)) };
  a.after = { ...wiBase(id), status: 'done', done_by: 'user', resolution: wiBy.get(id)!.resolution ?? 'done_by_me', version: v + 1, updated_at: iso(at) };
}

// ── D. storyline 2: the Elderglen Outdoors demo reply is drafted on the morning of 11-18, after the Slack ask was seen ──
{
  const w = wiBy.get(wiId(31))!; const dr = drafts.find((d) => d.idempotency_key === 'cc-rev-elderglen-demo-reply-v3')!;
  const n1 = nba.find((n) => n.work_item_id === w.id && n.nba_version === 1)!;
  const tN1 = mt('11-18', '08:06:20'), tCall = mt('11-18', '08:06:02'), tDr = mt('11-18', '08:06:40');
  const call = calls.find((c) => Number(c.id) === Number(dr.llm_call_id))!;
  const wasDay = String(call.budget_day); const dur = ms(call.finished_at) - ms(call.started_at);
  call.started_at = tCall; call.finished_at = iso(ms(tCall) + dur); call.budget_day = '2026-11-18';
  n1.llm_call_id = null; // the timed-out call 645 (dead job 451) was another item's NBA job
  const shift = (r: Row, f: string, to: string) => { if (r[f]) r[f] = to; };
  n1.created_at = tN1; shift(n1, 'ready_at', iso(ms(tN1) + 4_000)); if (n1.accepted_at) n1.accepted_at = mt('11-18', '08:09:10');
  dr.created_at = tDr;
  // revision bursts: the engine draft at 08:06, the user's two edits at 08:09 and 08:11
  const all = readTable('content_revisions');
  const rev = all.filter((r) => r.entity_id === dr.id).sort((a, b) => Number(a.revision) - Number(b.revision));
  const bursts = rev.map((r) => csBy.get(String(r.change_set_id))!);
  const newAt = [mt('11-18', '08:06:42'), mt('11-18', '08:10:20'), mt('11-18', '08:12:10')];
  rev.forEach((r, i) => {
    const old = ms(r.last_saved_at ?? r.started_at); const d = ms(newAt[i]!) - old; const b = bursts[i]!;
    for (const f of ['started_at', 'last_saved_at', 'closed_at']) if (r[f]) r[f] = iso(ms(r[f]) + d);
    for (const f of ['created_at', 'closed_at', 'coalesce_until']) if (b[f]) b[f] = iso(ms(b[f]) + d);
    for (const a of au.filter((y) => y.change_set_id === b.id)) { a.created_at = iso(ms(a.created_at) + d); a.updated_at = iso(ms(a.updated_at) + d); }
  });
  writeTable('content_revisions', all);
  // the item's own timeline: it turns waiting_on_me once the ask is seen and the draft is ready
  const t31 = (transBy.get(String(w.id)) ?? []).find((x) => x.to_status === 'waiting_on_me')!; const tW = mt('11-18', '08:12:30');
  t31.occurred_at = tW; w.status_changed_at = tW; w.waiting_since = tW; w.updated_at = String(w.updated_at) < tW ? tW : w.updated_at; w.last_new_info_at = String(w.last_new_info_at) < tW ? tW : w.last_new_info_at;
  void wasDay;
  // llm_budget_days: move the call between days (one call, its cost)
  const bd = readTable('llm_budget_days'); const d17 = bd.find((r) => r.day === '2026-11-17'); const d18 = bd.find((r) => r.day === '2026-11-18');
  if (d17 && d18 && wasDay === '2026-11-17') { const r6 = (x: number) => Math.round(x * 1e6) / 1e6; d17.spent_usd = r6(Number(d17.spent_usd) - Number(call.cost_usd)); d17.call_count = Number(d17.call_count) - 1; d18.spent_usd = r6(Number(d18.spent_usd) + Number(call.cost_usd)); d18.call_count = Number(d18.call_count) + 1; writeTable('llm_budget_days', bd); }
}

writeTable('work_item_transitions', trans);

// ── E. brief.generate counters follow the watches that existed and the summarize calls that ran ──────────────
{
  const ws = readTable('watch_subscriptions');
  // the first three watches were set up during the first-scan evening, before the first 07:30 brief
  const early = ws.filter((x) => ms(x.created_at) < ms(mt('10-20', '12:00'))).sort((a, b) => ms(a.created_at) - ms(b.created_at));
  early.forEach((x, i) => { x.created_at = mt('10-19', `16:${40 + i * 2}`); if (ms(x.updated_at) < ms(x.created_at)) x.updated_at = x.created_at; });
  const enabledAt = (t: number) => ws.filter((x) => ms(x.created_at) <= t && (x.enabled || ms(x.updated_at) > t)).length;
  for (const j of jobs.filter((x) => x.kind === 'brief.generate')) {
    const t = ms(j.finished_at ?? j.created_at); const res = j.result as any; if (!res?.counts) continue;
    const made = calls.filter((c) => Number(c.job_id) === Number(j.id) && c.purpose === 'summarize');
    const watches = enabledAt(t); const briefs = Math.min(made.length, watches);
    const due = Math.min(watches, Math.max(res.counts.due, briefs));
    j.result = { ...res, counts: { watches, due }, briefs, costUsd: Math.round(made.reduce((s, c) => s + Number(c.cost_usd), 0) * 1e6) / 1e6 };
  }
  writeTable('watch_subscriptions', ws); writeTable('jobs', jobs);
}

// ── F. NBA plan rows of the weekly logging items; NBA.draft_id from drafts.nba_id ──────────────────────────
{
  const ae = readTable('activity_entries'); const tt = readTable('se_task_types'); const typeName = new Map(tt.map((x) => [String(x.id), String(x.name)]));
  const slug = new Map<string, string>(); const src = readFileSync(path.join(SAMPLE_DIR, 'generators/data/core-deals.ts'), 'utf8');
  for (const m of src.matchAll(/\bO\('([a-z0-9-]+)'/g)) slug.set(uid('opportunities', m[1]!), m[1]!);
  for (const m of src.matchAll(/\{ key: '([a-z0-9-]+)', name:/g)) slug.set(uid('accounts', m[1]!), m[1]!);
  const rel = (e: Row) => e.opportunity_id ? { type: 'opportunity', id: slug.get(String(e.opportunity_id)) ?? String(e.opportunity_id), name: slug.get(String(e.opportunity_id)) ?? String(e.what_name) } : e.account_id ? { type: 'account', id: slug.get(String(e.account_id)) ?? String(e.account_id), name: String(e.what_name ?? slug.get(String(e.account_id))) } : { type: 'catch_all', name: 'Internal' };
  const counts = (e: Row) => (e.customer_facing && e.customer_related ? 'CF+CR' : e.customer_facing ? 'CF' : e.customer_related ? 'CR' : 'neither');
  const rebuild = (n: number, entries: Row[], shiftTo?: string) => {
    const nb = nba.find((x) => x.work_item_id === wiId(n) && x.nba_version === 1)!; const p = nb.payload as any; const evId = p.sources?.[0];
    entries = entries.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
    p.plan.rows = entries.map((e, i) => ({ blockId: `blk-wi-${String(n).padStart(3, '0')}-${i + 1}`, date: mtLocal(e.starts_at).slice(0, 10), start: mtLocal(e.starts_at), end: mtLocal(e.ends_at), subject: e.subject, seTaskType: typeName.get(String(e.se_task_type_id)) ?? 'Admin', customerFacing: !!e.customer_facing, counts: counts(e), relatedTo: rel(e), description: e.subject, evidenceIds: evId ? [evId] : [], confidence: p.confidence }));
    p.plan.totalHours = Math.round(entries.reduce((s, e) => s + Number(e.duration_hours), 0) * 100) / 100;
    if (shiftTo) { const d = ms(shiftTo) - ms(nb.created_at); for (const f of ['created_at', 'updated_at', 'ready_at', 'accepted_at', 'completed_at']) if (nb[f] && ms(nb[f]) >= ms(nb.created_at) - 1) { if (f === 'created_at') nb[f] = shiftTo; else if (ms(nb[f]) < ms(shiftTo)) nb[f] = iso(ms(nb[f]) + d); } return { nb, shiftTo }; }
    return { nb, shiftTo: undefined };
  };
  const w86 = ae.filter((e) => e.org62_event_row_id && e.logged_at && String(e.logged_at).startsWith('2026-10-30') && ms(e.starts_at) >= ms(mt('10-26', '00:00')) && ms(e.starts_at) < ms(mt('10-30', '00:00')));
  const r86 = rebuild(86, w86, mt('10-29', '15:40:05'));
  const canvasEntries = ae.filter((e) => e.synced_to_canvas_at && String(e.synced_to_canvas_at).startsWith('2026-11-13T16:28') && ['verified', 'logged'].includes(String(e.status)));
  const r89 = rebuild(89, canvasEntries, mt('11-12', '16:40:05'));
  for (const [n, r] of [[86, r86], [89, r89]] as Array<[number, { nb: Row; shiftTo?: string }]>) {
    const d = drafts.find((x) => x.nba_id === r.nb.id)!; if (d && r.shiftTo) { const dd = ms(r.shiftTo) + 3_000 - ms(d.created_at); for (const f of ['created_at', 'updated_at']) if (d[f] && ms(d[f]) < ms(r.shiftTo) + 3_000) d[f] = iso(ms(d[f]) + dd); if (ms(d.created_at) < ms(r.shiftTo)) d.created_at = iso(ms(r.shiftTo) + 3_000); }
    const t = n === 86 ? 'Log last week: ' + (r.nb.payload as any).plan.rows.length + ' events' : undefined; if (t) { (r.nb.payload as any).title = t; r.nb.title = t; }
  }
  // schedule / update-VDP NBAs whose calendar hold or VDP change draft was written in the same minutes
  for (const n of nba.filter((x) => ['schedule', 'update_vdp'].includes(String(x.type)) && !x.draft_id)) {
    const d = drafts.find((y) => y.work_item_id === n.work_item_id && !y.nba_id && ['calendar', 'vdp'].includes(String(y.channel)) && Math.abs(ms(y.created_at) - ms(n.created_at)) <= 15 * MIN);
    if (d) { d.nba_id = n.id; n.draft_id = d.id; }
  }
  for (const d of drafts) if (d.nba_id) { const n = nba.find((x) => x.id === d.nba_id); if (n && !n.draft_id) n.draft_id = d.id; }
}

// ── G. small alignments ────────────────────────────────────────────────────────────────────────────────────
{
  // wi-007: waiting since the estimate went out (draft sent 11-05), not since the user marked the item
  const w7 = wiBy.get(wiId(7))!; const sent = drafts.find((d) => d.work_item_id === w7.id && /sizing estimate/.test(String(d.title)) && d.sent_at); if (sent) w7.waiting_since = sent.sent_at;
  // activity audit images: the entries were already logged (rows 1, 2) or approved (row 3)
  const imgs = [uid('activity_entries', 'ops-ae-1'), uid('activity_entries', 'ops-ae-2'), uid('activity_entries', 'ops-ae-3')];
  for (const a of au.filter((x) => x.table_name === 'activity_entries' && imgs.includes(String(x.row_id)))) {
    const i = imgs.indexOf(String(a.row_id));
    if (i < 2) { (a.before as any).status = 'logged'; (a.after as any).status = 'logged'; }
    else { (a.after as any).status = 'approved'; }
  }
  // drafts / NBAs are created after the model call that wrote them
  const callBy = new Map(calls.map((c) => [Number(c.id), c])); const nbaBy = new Map(nba.map((n) => [String(n.id), n]));
  for (const n of nba) { const c = n.llm_call_id ? callBy.get(Number(n.llm_call_id)) : null; if (c && ms(c.finished_at) >= ms(n.created_at) && ms(c.started_at) - ms(n.created_at) < 10 * MIN) { const t = iso(ms(c.finished_at) + 1500); const d = ms(t) - ms(n.created_at); for (const f of ['created_at', 'ready_at']) if (n[f] && ms(n[f]) < ms(t)) n[f] = f === 'created_at' ? t : iso(ms(n[f]) + d); if (ms(n.updated_at) < ms(t)) n.updated_at = t; } }
  for (const d of drafts) {
    const c = d.llm_call_id ? callBy.get(Number(d.llm_call_id)) : null; const nb = d.nba_id ? nbaBy.get(String(d.nba_id)) : null;
    let floor = nb ? ms(nb.created_at) + 1000 : 0; if (c) floor = Math.max(floor, ms(c.finished_at) + 1000);
    if (floor && ms(d.created_at) < floor && floor - ms(d.created_at) < 12 * MIN) { d.created_at = iso(floor); if (ms(d.updated_at) < floor) d.updated_at = iso(floor); }
  }
  // replying to a message the app had not ingested yet: keep the thread target, drop the source-item pointer
  const si = readTable('source_items'); const siBy = new Map(si.map((s) => [String(s.id), s]));
  for (const d of drafts) { const s = d.in_reply_to_source_item_id ? siBy.get(String(d.in_reply_to_source_item_id)) : null; if (s && (ms(s.first_seen_at) > ms(d.created_at) || ms(s.occurred_at) > ms(d.created_at))) d.in_reply_to_source_item_id = null; }
  // activity entries whose time blocks sit outside the entry window
  const tb = readTable('time_blocks'); const atb = readTable('activity_entry_time_blocks'); const ae = readTable('activity_entries'); const tbBy = new Map(tb.map((b) => [String(b.id), b]));
  for (const e of ae) {
    const bl = atb.filter((x) => x.activity_entry_id === e.id).map((x) => tbBy.get(String(x.time_block_id))!).filter(Boolean); if (!bl.length) continue;
    if (bl.some((b) => ms(b.starts_at) >= ms(e.ends_at) || ms(b.ends_at) <= ms(e.starts_at))) {
      const s = Math.min(...bl.map((b) => ms(b.starts_at))); const en = Math.max(...bl.map((b) => ms(b.ends_at)));
      e.starts_at = iso(s); e.ends_at = iso(en);
      if (bl.length === 1) e.ends_at = iso(s + Math.round(Number(e.duration_hours) * 60) * MIN);
    }
  }
  writeTable('activity_entries', ae);
  writeTable('drafts', drafts); writeTable('next_best_actions', nba); writeTable('llm_calls', calls);
}

// non-engine rows that predate their item: chat/user rows are clamped to the item's creation; an autosave burst names an item that existed
for (const a of au.filter((x) => x.table_name === 'work_items')) {
  const w = wiBy.get(String(a.row_id)); if (!w || ms(a.created_at) >= ms(w.created_at)) continue;
  const c = csBy.get(String(a.change_set_id))!;
  if (ms(w.created_at) - ms(a.created_at) < 5_000) { a.created_at = w.created_at; a.updated_at = w.created_at; if (ms(c.closed_at) < ms(w.created_at)) c.closed_at = w.created_at; continue; }
  const t = ms(a.created_at); const pool = eligible(t, OPEN); const id = pool[Math.floor(R.next() * pool.length)]!;
  if (a.op === 'insert' || a.op === 'delete') { a.created_at = w.created_at; a.updated_at = w.created_at; if (ms(c.closed_at) < ms(w.created_at)) c.closed_at = iso(ms(w.created_at) + 800); continue; }
  a.row_id = id; a.entity_id = id; if (a.before) (a.before as any).id = id; if (a.after) (a.after as any).id = id; c.entity_id = id;
}
// ── H. rows derived from a source item cannot predate the moment the app first saw that item ─────────────────
{
  const si = readTable('source_items'); const siBy = new Map(si.map((x) => [String(x.id), x]));
  const bump = (r: Row, f: string, d: number) => { if (r[f]) r[f] = iso(ms(r[f]) + d); };
  const clamp = (table: string, col: string, cascade: string[]) => {
    const rows = readTable(table); let n = 0;
    for (const r of rows) {
      const x = r[col] ? siBy.get(String(r[col])) : null; const seen = x ? ms(x.first_seen_at) : 0;
      if (x && ms(r.created_at) < seen) { const d = seen + 2_000 - ms(r.created_at); r.created_at = iso(ms(r.created_at) + d); for (const f of cascade) if (r[f] && ms(r[f]) < ms(r.created_at)) r[f] = r.created_at; n++; }
    }
    if (n) writeTable(table, rows);
  };
  clamp('reopen_decisions', 'trigger_source_item_id', []);
  clamp('deliverable_requirements', 'requested_by_source_item_id', ['updated_at', 'last_judged_at']);
  clamp('time_blocks', 'source_item_id', ['updated_at']);
  clamp('claude_sessions', 'source_item_id', ['updated_at']);
  // the Claude segments hang off their session
  { const ss = readTable('claude_sessions'); const sb = new Map(ss.map((x) => [String(x.id), x])); const seg = readTable('claude_session_segments'); let n = 0;
    for (const g of seg) { const p = sb.get(String(g.session_id)); if (p && g.created_at && ms(g.created_at) < ms(p.created_at)) { g.created_at = p.created_at; if (g.updated_at && ms(g.updated_at) < ms(g.created_at)) g.updated_at = g.created_at; n++; } }
    if (n) writeTable('claude_session_segments', seg);
    const tb = readTable('time_blocks'); const gb = new Map(seg.map((x) => [String(x.id), x])); let m = 0;
    for (const b of tb) { const g = b.claude_session_segment_id ? gb.get(String(b.claude_session_segment_id)) : null; if (g && g.created_at && ms(b.created_at) < ms(g.created_at)) { b.created_at = g.created_at; if (ms(b.updated_at) < ms(b.created_at)) b.updated_at = b.created_at; m++; } }
    if (m) writeTable('time_blocks', tb); }
  // deal contributions snapshot first seen with their Org62 record
  { const dc = readTable('deal_contributions'); let n = 0; for (const r of dc) { const x = r.source_item_id ? siBy.get(String(r.source_item_id)) : null; if (x && ms(r.first_seen_at) < ms(x.first_seen_at)) { r.first_seen_at = x.first_seen_at; if (r.last_seen_at && ms(r.last_seen_at) < ms(r.first_seen_at)) r.last_seen_at = r.first_seen_at; n++; } } if (n) writeTable('deal_contributions', dc); }
  // an extraction candidate that became an existing item cites that item's origin evidence if the named message did not exist yet
  { const ec = readTable('extraction_candidates'); const ev = readTable('work_item_evidence'); let n = 0;
    for (const e of ec) { const x = siBy.get(String(e.source_item_id)); if (x && ms(x.first_seen_at) > ms(e.created_at) && e.work_item_id) { const o = ev.filter((v) => v.work_item_id === e.work_item_id && siBy.has(String(v.source_item_id)) && ms(siBy.get(String(v.source_item_id))!.first_seen_at) <= ms(e.created_at)).sort((a, b) => ms(a.created_at) - ms(b.created_at))[0]; if (o) { e.source_item_id = o.source_item_id; n++; } else { const w = wiBy.get(String(e.work_item_id)); const an = String(readTable('accounts').find((a) => a.id === w?.account_id)?.name ?? '\u0000').split(' ')[0]!; const g = si.filter((y) => y.kind === 'gemini_note' && String(y.title ?? y.body).includes(an) && ms(y.first_seen_at) <= ms(e.created_at)).sort((a, b) => ms(b.first_seen_at) - ms(a.first_seen_at))[0]; if (g) { e.source_item_id = g.id; n++; } } } }
    if (n) writeTable('extraction_candidates', ec); }
  // an NBA cannot be triggered by an item the app had not seen yet
  for (const n of nba) { const x = n.trigger_source_item_id ? siBy.get(String(n.trigger_source_item_id)) : null; if (x && ms(x.first_seen_at) > ms(n.created_at)) n.trigger_source_item_id = null; }
  writeTable('next_best_actions', nba);
}
writeTable('work_items', wi); writeTable('change_sets', cs);
au.sort((a, b) => Number(a.id) - Number(b.id)); writeTable('audit_events', au);

// ── CAST doc touch-ups for the facts this pass changes ─────────────────────────────────────────────────────
const patch = (file: string, pairs: Array<[RegExp | string, string]>) => { const f = path.join(SAMPLE_DIR, file); let s = readFileSync(f, 'utf8'); for (const [a, b] of pairs) s = s.replace(a, b); writeFileSync(f, s); };
patch('CAST-ops.md', [[/174 user_edit 11-01 14:05 work_item "Marked the NDA ask done"/, '174 user_edit 11-12 09:20 work_item "Marked the proof-points ask done"']]);
patch('CAST-work.md', [[/- Ops set 174 \([^\n]*\n/, '- Ops set 174 ("Marked the proof-points ask done", wi-100, 11/12) matches the user close in `work_item_transitions`. Engine-pass audit rows (completion, settle, priority, nba) follow the item timelines: no row before an item exists, closings only where a transition exists, status values from the timeline.\n']]);
{
  const u = cs.find((c) => c.kind === 'undo' && String(c.summary).startsWith('Undo: Completion pass'))!;
  const c649 = calls.find((c) => Number(c.id) === 649)!;
  const fmt = (t: unknown) => { const x = iso(ms(t) - 7 * HOUR); return `${x.slice(5, 7)}-${x.slice(8, 10)} ${x.slice(11, 16)}`; };
  patch('CAST-ops.md', [
    [/28 undo 10-19 09:48 work_item "Undo: Completion pass: 1 closed, 2 waiting, 1 still needed"/, `28 undo ${fmt(u.created_at)} work_item "${u.summary}"`],
    [/649@11-17 13:16/, `649@${fmt(c649.started_at)}`],
  ]);
}
console.log('91-consistency: done');
