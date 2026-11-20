/** Domain 03: change_sets (500), audit_events (~1,500) and content_revisions. Core-pinned change set numbers come from domain 01's rows. */
import { OWNER, ref, rng, sha, uid, readTable, type Row } from '../../lib/kit';
import { CONN, DAY, HOUR, MIN, atMs, iso, tms, type ConnKey } from './ops-lib';
import type { RunX } from './ops-facts';
import type { JobT, WorkerT } from './ops-jobs';
import type { RunOut } from './ops-trace';
import type { Flip } from './ops-health';
import { CHAT_THREADS } from './ops-text';

const R = rng('ops-audit');
export interface Spec { table: string; rowId: string; etype: string; eid: string; op: 'insert' | 'update' | 'delete'; before: Row | null; after: Row | null; coalesced?: number; at?: number }
export interface CS {
  key: string; n?: number; kind: string; actor: string; actorRef: string; editor?: string; etype: string | null; eid: string | null; summary: string; undoable: boolean; createdMs: number; closedMs: number;
  coalesceUntil?: number; undoOf?: string; rollbackTo?: number; undoneMs?: number; undoneBy?: string; rows: Spec[];
}
const wiId = (n: number) => uid('work_items', `wi-${String(n).padStart(3, '0')}`);
const siId = (n: number) => uid('source_items', `si-${String(n).padStart(3, '0')}`);
const diff = (b: Row | null, a: Row | null): string[] => {
  const keys = new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})]);
  return [...keys].filter((k) => JSON.stringify(b?.[k]) !== JSON.stringify(a?.[k])).sort();
};
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const j = (x: unknown) => JSON.stringify(x);

export function buildAudit(ctx: { runs: RunX[]; runOf: Map<string, RunOut>; jobs: JobT[]; jobId: (k: string) => number; flips: Flip[]; workers: WorkerT[]; chatAt: string[] }) {
  const { runs, runOf, jobs, flips, workers } = ctx;
  const sets: CS[] = [];
  const add = (c: Omit<CS, 'rows'> & { rows?: Spec[] }) => { const x: CS = { rows: [], ...c } as CS; sets.push(x); return x; };

  // ── pinned: the change sets domain 01 points at ─────────────────────────────────────────────────
  const mapping = readTable('mapping_rules') as Row[]; const policies = readTable('priority_policies') as Row[]; const voices = readTable('voice_profiles') as Row[];
  const csOf = (id: unknown) => { for (const n of [2, 3, 22, 23, 40, 49, 64, 74, 83, 90, 96, 121, 131, 142, 167, 175, 188, 203]) if (uid('change_sets', n) === id) return n; return null; };
  const rowSpec = (table: string, r: Row, etype: string, op: 'insert' | 'update', before: Row | null = null): Spec => ({ table, rowId: r.id as string, etype, eid: r.id as string, op, before: op === 'insert' ? null : before, after: r });
  const pol = (v: number) => policies.find((p) => p.version === v)!; const voi = (v: number) => voices.find((p) => p.version === v)!;
  const retired = (row: Row, at: unknown) => ({ ...row, status: 'active', retired_at: null, ...(at ? {} : {}) });
  const pin = (n: number, c: Omit<CS, 'rows' | 'n'>, rows: Spec[]) => add({ ...c, n, rows });
  const T0 = tms('2026-10-18T15:10:00.000Z');
  pin(2, { key: 'pin-2', kind: 'system', actor: 'system', actorRef: 'onboarding', etype: 'policy', eid: pol(1).id as string, summary: 'Priority policy v1 from the SE (IC) role template', undoable: false, createdMs: T0, closedMs: T0 + 900 }, [rowSpec('priority_policies', pol(1), 'policy', 'insert')]);
  pin(3, { key: 'pin-3', kind: 'system', actor: 'system', actorRef: 'onboarding', etype: 'voice_profile', eid: voi(1).id as string, summary: 'Default SE voice profile v1', undoable: false, createdMs: T0 + 1500, closedMs: T0 + 2300 }, [rowSpec('voice_profiles', voi(1), 'voice_profile', 'insert')]);
  const v2 = tms(voi(2).created_at as string);
  pin(40, { key: 'pin-40', kind: 'engine_pass', actor: 'engine', actorRef: 'engine.voice-learn@1', etype: 'voice_profile', eid: voi(2).id as string, summary: 'Learned a voice profile from 96 sent messages', undoable: true, createdMs: v2, closedMs: v2 + 4200 }, [rowSpec('voice_profiles', { ...voi(1) }, 'voice_profile', 'update', { ...voi(1), status: 'active', retired_at: null }), rowSpec('voice_profiles', voi(2), 'voice_profile', 'insert')]);
  const v3 = tms(voi(3).created_at as string);
  pin(131, { key: 'pin-131', kind: 'user_edit', actor: 'user', actorRef: 'settings.voice.save', editor: 'tab-smpl-voice', etype: 'voice_profile', eid: voi(3).id as string, summary: 'Edited the voice profile by hand (v3)', undoable: true, createdMs: v3, closedMs: v3 + 3000 }, [rowSpec('voice_profiles', voi(2), 'voice_profile', 'update', { ...voi(2), status: 'active' }), rowSpec('voice_profiles', voi(3), 'voice_profile', 'insert')]);
  const p2 = tms(pol(2).created_at as string);
  pin(64, { key: 'pin-64', kind: 'chat_tool_call', actor: 'chat', actorRef: 'chat:tool:chat_update_priority_policy', editor: 'thread-smpl-policy', etype: 'policy', eid: pol(2).id as string, summary: 'Chat raised manager asks and deal value (policy v2)', undoable: true, createdMs: p2, closedMs: p2 + 2500 }, [rowSpec('priority_policies', pol(1), 'policy', 'update', { ...pol(1), status: 'active', retired_at: null }), rowSpec('priority_policies', pol(2), 'policy', 'insert')]);
  const p3 = tms(pol(3).created_at as string);
  pin(188, { key: 'pin-188', kind: 'user_edit', actor: 'user', actorRef: 'settings.priorities.save', editor: 'tab-smpl-prio', etype: 'policy', eid: pol(3).id as string, summary: 'Priority policy v3: 24h SLA for manager asks, Now floor for customer deliverables', undoable: true, createdMs: p3, closedMs: p3 + 3500 }, [rowSpec('priority_policies', pol(2), 'policy', 'update', { ...pol(2), status: 'active', retired_at: null }), rowSpec('priority_policies', pol(3), 'policy', 'insert')]);
  for (const m of mapping) {
    const n = csOf(m.created_from_change_set_id); if (!n) continue;
    const t = tms(m.created_at as string);
    const upd = n === 74;
    const before = upd ? { ...m, account_id: uid('accounts', 'yarrowdale'), source: 'seed', created_from_change_set_id: null, hit_count: 0 } : null;
    pin(n, { key: `pin-${n}`, kind: 'user_edit', actor: 'user', actorRef: `mapping.${m.kind}`, editor: 'tab-smpl-map', etype: 'mapping_rule', eid: m.id as string, summary: upd ? `Moved ${String(m.pattern)} from the parent account to its own account` : `Mapping rule: ${String(m.kind).replace(/_/g, ' ')} "${String(m.pattern)}"`.slice(0, 120), undoable: true, createdMs: t, closedMs: t + 2600 }, [rowSpec('mapping_rules', m, 'mapping_rule', upd ? 'update' : 'insert', before)]);
  }
  if (!sets.some((s) => s.n === 203)) throw new Error('pinned set 203 missing');

  // ── user edits of settings, tied to user_settings.updated_at ────────────────────────────────────
  const settings = readTable('user_settings') as Row[];
  const prev = (key: string, v: any): any => {
    const b = clone(v);
    if (typeof b.version === 'number') b.version -= 1;
    switch (key) {
      case 'settings.display': b.density = 'comfortable'; b.textSize = 15; break;
      case 'settings.sending': b.dryRun = true; break;
      case 'settings.budgets': b.raises = []; break;
      case 'settings.chat': b.dailyUsd = 2; if (b.messageUsd) b.messageUsd.sonnet = 0.15; break;
      case 'settings.closing': b.strictness = 'cautious'; break;
      case 'settings.time': if (b.logging) b.logging.mode = 'auto'; break;
      case 'settings.scanning': b.channelAsks = 'tasks'; break;
      case 'settings.persona': if (b.rules?.vdp_current) b.rules.vdp_current.enabled = false; break;
      case 'settings.feedback': b.postLive = false; break;
      case 'settings.guide': b.checklistDismissed = false; break;
      case 'settings.profile': if (b.workingHours) b.workingHours.end = '17:00'; break;
      case 'settings.agentBehavior': if (b.autonomy) b.autonomy.slack_reply = 'L0'; break;
    }
    return b;
  };
  const budgetRow = settings.find((s) => s.key === 'settings.budgets')!;
  const raiseMs = tms(budgetRow.updated_at as string);
  const raiseCs = add({ key: 'budget-raise', kind: 'user_edit', actor: 'user', actorRef: 'settings.budgets.raise', editor: 'tab-smpl-spend', etype: 'settings', eid: 'settings.budgets', summary: 'Raised the daily budget: soft $15 to $22, hard $25 to $32 ("Hit the cap during the Slack backfill; need it finished")', undoable: true, createdMs: raiseMs, closedMs: raiseMs + 2800, rows: [] });
  for (const s of settings.filter((x) => String(x.key).startsWith('settings.'))) {
    const after: Row = { ...s }; const before: Row = { ...s, value: prev(s.key as string, s.value), updated_at: iso(tms(s.updated_at as string) - R.int(2, 9) * DAY) };
    const spec: Spec = { table: 'user_settings', rowId: s.key as string, etype: 'settings', eid: s.key as string, op: 'update', before, after };
    if (s.key === 'settings.budgets') { raiseCs.rows.push(spec); continue; }
    const t = tms(s.updated_at as string);
    add({ key: `set-${s.key}`, kind: 'user_edit', actor: 'user', actorRef: `${s.key}.save`, editor: 'tab-smpl-settings', etype: 'settings', eid: s.key as string, summary: `Settings saved: ${String(s.key).replace('settings.', '')}`, undoable: true, createdMs: t, closedMs: t + 2200, rows: [spec] });
  }

  // ── connector change sets (one per scan commit; the connectors row, source items, opportunities) ───
  const conn = readTable('connectors') as Row[];
  const connState = new Map<ConnKey, Row>();
  for (const k of Object.keys(CONN) as ConnKey[]) {
    const row = clone(conn.find((c) => c.id === CONN[k].id)!);
    Object.assign(row, { status: 'healthy', status_reason: null, status_changed_at: row.created_at, last_success_at: null, last_error_at: null, last_error_code: null, consecutive_failures: 0, auth_expires_at: null, updated_at: row.created_at });
    connState.set(k, row);
  }
  const opps = readTable('opportunities') as Row[]; const oppStates = new Map<string, Row>();
  const okRuns = runs.filter((r) => r.status === 'succeeded' || r.status === 'partial');
  const flipsByConn = (c: ConnKey) => flips.filter((f) => f.conn === c).sort((a, b) => a.atMs - b.atMs);
  const events: Array<{ at: number; kind: 'ok' | 'fail' | 'flip' | 'refresh'; r?: RunX; f?: Flip; cs?: CS }> = [];
  for (const r of runs) if (r.status === 'failed') events.push({ at: r.endMs + 400, kind: 'fail', r }); else if (r.status !== 'cancelled') events.push({ at: r.endMs + 500, kind: 'ok', r });
  for (const f of flips) events.push({ at: f.atMs + 900, kind: 'flip', f });
  events.sort((a, b) => a.at - b.at);
  const contractClass = (c: string) => (c === 'config' ? 'bug' : c === 'unknown' ? 'transient' : c);
  // commits per ok run: more for backfills and bigger runs
  const weight = (r: RunX) => (r.mode === 'backfill' ? 3 : r.f.nw > 12 ? 3 : r.f.nw > 3 ? 2 : r.f.seen > 0 ? 1 : 1);
  const totalW = okRuns.reduce((s, r) => s + weight(r), 0);
  const nonConnector = 18 + 12 + 40 + 11 + 14 + 91; // pinned + settings + (other user) + chat + system + engine, see below
  void nonConnector; void totalW;
  const connectorSets: CS[] = [];
  const csBase = (r: RunX, idx: number, nCommits: number): Omit<CS, 'rows'> => {
    const sk = CONN[r.conn].scanKind; const t = r.endMs - Math.max(2000, Math.round(((nCommits - idx) / (nCommits + 1)) * Math.min(r.endMs - r.startMs, 120_000)));
    return { key: `conn-${r.key}-${idx}`, kind: 'connector_sync', actor: 'connector', actorRef: `scan:${sk}:${r.scope ?? 'reconcile'}@${CONN[r.conn].ver ?? '1'}`, etype: null, eid: null, summary: `${CONN[r.conn].label} ${r.scope ?? 'reconcile'}: ${r.f.nw} new, ${r.f.upd} updated`, undoable: false, createdMs: t, closedMs: t + R.int(300, 2600) };
  };
  const dcRead = settings.find((s) => s.key === 'cc.deals/dc-read')!;
  const isoOpp = (id: string) => oppStates.get(id) ?? (() => { const x = clone(opps.find((o) => o.id === id)!); oppStates.set(id, x); return x; })();
  // opportunity history: walk back from the current row for a handful of opportunities
  const oppPool = R.shuffle(opps.filter((o) => !o.is_closed)).slice(0, 22);
  const oppHist = new Map<string, Row[]>(); // newest last: [older..., current]
  const stages = ['Prospecting', 'Qualification', 'Discovery', 'Technical Validation', 'Proposal', 'Negotiation'];
  for (const o of oppPool) {
    const cur = clone(o); const hist: Row[] = [cur]; let st = clone(o);
    for (let i = 0; i < R.int(1, 3); i++) {
      const p = clone(st);
      const pick = R.int(0, 3);
      if (pick === 0 && p.amount) p.amount = Math.round(((p.amount as number) * R.pick([0.8, 0.9, 1.15])) / 5000) * 5000;
      else if (pick === 1) { const d = new Date(p.close_date as string); d.setUTCDate(d.getUTCDate() - R.pick([14, 21, 30])); p.close_date = d.toISOString().slice(0, 10); }
      else if (pick === 2) { const si = stages.indexOf(p.stage as string); if (si > 0) p.stage = stages[si - 1]; else p.forecast_category = 'Pipeline'; }
      else p.forecast_category = p.forecast_category === 'Commit' ? 'Best Case' : 'Pipeline';
      p.org62_modified_at = iso(tms(st.org62_modified_at as string) - R.int(1, 9) * DAY); p.updated_at = p.org62_modified_at;
      hist.unshift(p); st = p;
    }
    oppHist.set(o.id as string, hist);
  }
  const oppEvents: Array<{ id: string; i: number; at: number }> = [];
  for (const [id, h] of oppHist) for (let i = 1; i < h.length; i++) oppEvents.push({ id, i, at: tms(h[i]!.org62_modified_at as string) });

  // build the per-run connector sets in time order
  const perRun = new Map<string, CS[]>();
  const org62Runs = okRuns.filter((r) => r.conn === 'org62' && r.f.seen > 0).sort((a, b) => a.endMs - b.endMs);
  for (const r of okRuns) {
    const n = Math.max(1, Math.min(4, Math.round(weight(r) * (R.next() < 0.5 ? 1 : 0.7) + (r.f.nw > 0 ? 0.6 : 0))));
    const cs: CS[] = [];
    for (let i = 0; i < n; i++) cs.push({ ...(csBase(r, i, n) as any), rows: [] });
    perRun.set(r.key, cs); connectorSets.push(...cs);
  }
  void org62Runs;
  // rows: connectors (on the last commit of each run), source items, opportunities, dc-read
  const oppLeft = [...oppEvents].sort((a, b) => a.at - b.at);
  const cidx = new Map<string, number>();
  for (const e of events) {
    const k = e.r?.conn ?? e.f!.conn;
    const st = connState.get(k)!;
    const before = clone(st);
    if (e.kind === 'ok') {
      const r = e.r!; const cs = perRun.get(r.key)!; const last = cs[cs.length - 1]!;
      st.last_success_at = iso(r.endMs); st.consecutive_failures = 0; st.updated_at = iso(r.endMs + 500);
      if (k === 'vdp' && r.story === 'today-vdp') st.auth_expires_at = '2026-11-18T16:48:00.000Z';
      if (k === 'vdp' && r.story === 'vdp-auth-1104') st.auth_expires_at = '2026-11-04T19:52:50.000Z';
      last.rows.push({ table: 'connectors', rowId: CONN[k].id, etype: 'connector', eid: CONN[k].id, op: 'update', before, after: clone(st), coalesced: R.int(1, 3), at: tms(last.createdMs as any) });
      last.etype = 'connector'; last.eid = CONN[k].id;
      cs.forEach((c, ci) => {
        if (k === 'org62') {
          while (oppLeft.length && oppLeft[0]!.at <= c.createdMs && !c.rows.some((x) => x.table === 'opportunities' && x.rowId === oppLeft[0]!.id)) { const o = oppLeft.shift()!; const h = oppHist.get(o.id)!; c.rows.push({ table: 'opportunities', rowId: o.id, etype: 'opportunity', eid: o.id, op: 'update', before: h[o.i - 1]!, after: h[o.i]! }); }
          if (r.scope === 'dcs' && ci === 0) c.rows.push({ table: 'user_settings', rowId: 'cc.deals/dc-read', etype: 'settings', eid: 'cc.deals/dc-read', op: 'update', before: { ...dcRead, value: { at: iso(c.createdMs - DAY), complete: true }, updated_at: iso(c.createdMs - DAY) }, after: { ...dcRead, value: { at: iso(c.createdMs), complete: true }, updated_at: iso(c.createdMs) } });
        }
      });
    } else if (e.kind === 'fail') {
      const r = e.r!;
      st.last_error_at = iso(r.endMs); st.last_error_code = contractClass(r.err!.cls); st.consecutive_failures = (st.consecutive_failures as number) + 1; st.updated_at = iso(r.endMs + 400);
      connectorSets.push(add({ key: `connfail-${r.key}`, kind: 'connector_sync', actor: 'connector', actorRef: `scan:${CONN[k].scanKind}:${r.scope ?? 'reconcile'}@${CONN[k].ver ?? '1'}`, etype: 'connector', eid: CONN[k].id, summary: `${CONN[k].label} ${r.scope ?? ''}: scan failed (${r.err!.cause})`.replace('  ', ' '), undoable: false, createdMs: r.endMs + 300, closedMs: r.endMs + 900, rows: [{ table: 'connectors', rowId: CONN[k].id, etype: 'connector', eid: CONN[k].id, op: 'update', before, after: clone(st) }] }));
    } else {
      const f = e.f!;
      st.status = f.to; st.status_reason = f.to === 'healthy' ? null : f.cls === 'rate_limited' ? `${CONN[k].label}: rate limited (429), backing off` : (f.msg ?? 'repeated failures').slice(0, 120); st.status_changed_at = iso(f.atMs); st.updated_at = iso(f.atMs + 900);
      connectorSets.push(add({ key: `connflip-${f.conn}-${f.atMs}`, kind: 'connector_sync', actor: 'connector', actorRef: `health:${CONN[k].scanKind}`, etype: 'connector', eid: CONN[k].id, summary: `${CONN[k].label} status: ${f.from} to ${f.to}`, undoable: false, createdMs: f.atMs + 800, closedMs: f.atMs + 1500, rows: [{ table: 'connectors', rowId: CONN[k].id, etype: 'connector', eid: CONN[k].id, op: 'update', before, after: clone(st) }] }));
    }
    void cidx; void flipsByConn;
  }
  for (const c of connectorSets) { if (!sets.includes(c)) sets.push(c); }
  // calendar events and Drive assets the scans created (real rows from domain 02) ride on the nearest later commit of their connector
  const place = (rowsIn: Row[], connKey: ConnKey, table: string, etype: string, take: number, upd: number) => {
    const pool = connectorSets.filter((x) => x.actorRef.startsWith(`scan:${CONN[connKey].scanKind}:`) && x.key.startsWith('conn-')).sort((p, q) => p.createdMs - q.createdMs);
    const picked = R.shuffle(rowsIn).slice(0, take).sort((p, q) => tms(p.created_at as string) - tms(q.created_at as string));
    picked.forEach((row, i) => {
      const t = tms(row.created_at as string);
      let cs = pool.find((x) => x.createdMs >= t - 5 * MIN && !x.rows.some((y) => y.table === table && y.rowId === row.id)) ?? pool[pool.length - 1]!;
      if (cs.rows.some((y) => y.table === table && y.rowId === row.id)) cs = pool.find((x) => !x.rows.some((y) => y.table === table && y.rowId === row.id))!;
      cs.rows.push({ table, rowId: row.id as string, etype, eid: row.id as string, op: 'insert', before: null, after: row });
      if (i < upd) { // a later edit upstream: the scan updates the row again
        const later = pool.find((x) => x.createdMs > cs.createdMs + 2 * DAY && !x.rows.some((y) => y.table === table && y.rowId === row.id)); if (!later) return;
        const b: Row = { ...row, ...(table === 'calendar_events' ? { title: String(row.title).replace(/ \(.*\)$/, '') + ' (tentative)', updated_at: iso(cs.createdMs) } : { title: String(row.title) + ' (draft)', updated_at: iso(cs.createdMs), drive_version: Math.max(1, Number(row.drive_version ?? 2) - 3) }) };
        later.rows.push({ table, rowId: row.id as string, etype, eid: row.id as string, op: 'update', before: b, after: { ...row, updated_at: iso(later.createdMs) } });
      }
    });
  };
  place(readTable('calendar_events') as Row[], 'calendar', 'calendar_events', 'calendar_event', 138, 18);
  place(readTable('assets') as Row[], 'drive', 'assets', 'asset', 111, 10);
  // any opportunity change not yet attached rides on the nearest org62 commit
  for (const o of oppLeft) { const c = [...connectorSets].filter((x) => x.actorRef.startsWith('scan:org62')).sort((a, b) => Math.abs(a.createdMs - o.at) - Math.abs(b.createdMs - o.at))[0]!; const h = oppHist.get(o.id)!; if (!c.rows.some((x) => x.rowId === o.id)) c.rows.push({ table: 'opportunities', rowId: o.id, etype: 'opportunity', eid: o.id, op: 'update', before: h[o.i - 1]!, after: h[o.i]! }); }
  // org62 also finds two new opportunities
  for (const [i, o] of opps.filter((x) => !x.is_closed).slice(0, 0).entries()) void i, o;

  // ── engine passes ──────────────────────────────────────────────────────────────────────────────
  const eng = (key: string, ref_: string, t: number, dur: number, etype: string | null, eid: string | null, summary: string, undoable: boolean): CS => add({ key, kind: 'engine_pass', actor: 'engine', actorRef: ref_, etype, eid, summary, undoable, createdMs: t, closedMs: t + dur, rows: [] });
  const wiRow = (n: number, before: Row, after: Row): Spec => ({ table: 'work_items', rowId: wiId(n), etype: 'work_item', eid: wiId(n), op: 'update', before: { id: wiId(n), owner_user_id: OWNER, ...before }, after: { id: wiId(n), owner_user_id: OWNER, ...after }, coalesced: R.chance(0.2) ? R.int(2, 3) : 1 });
  for (const jb of jobs.filter((x) => x.kind === 'completion.check' && x.status === 'succeeded')) {
    const applied = (jb.result?.applied ?? {}) as Record<string, number>;
    const cs = eng(`eng-${jb.key}`, 'engine.completion@1.3.0', jb.finishedMs! + 400, 1400, 'work_item', null, `Completion pass: ${applied.close ?? 0} closed, ${applied.wait ?? 0} waiting, ${applied.ask_still_needed ?? 0} still needed`, true);
    const k = R.int(3, 8);
    for (let q = 0; q < k; q++) {
      const n = R.int(1, 92); const t = jb.finishedMs! + 400; const closing = q < Math.max(1, applied.close ?? 1);
      cs.rows.push(wiRow(n, closing ? { status: 'open', status_changed_at: iso(t - 3 * DAY), done_at: null, done_by: null, resolution: null, likely_done_at: iso(t - 2 * HOUR), version: 4, updated_at: iso(t - 2 * HOUR) } : { status: 'open', likely_done_at: null, likely_done_confidence: null, version: 3, updated_at: iso(t - DAY) },
        closing ? { status: 'done', status_changed_at: iso(t), done_at: iso(t), done_by: 'engine', resolution: R.pick(['done_by_me', 'done_by_other', 'not_needed']), likely_done_at: null, version: 5, updated_at: iso(t) } : { status: 'open', likely_done_at: iso(t), likely_done_confidence: R.pick([0.62, 0.71, 0.78]), version: 4, updated_at: iso(t) }));
    }
    cs.etype = 'work_item'; cs.eid = cs.rows[0]!.rowId;
  }
  const settleJobs = jobs.filter((x) => x.kind === 'settle.check' && x.status === 'succeeded' && (x.result?.changed ?? 0) > 0);
  for (const jb of settleJobs) {
    const cs = eng(`eng-${jb.key}`, 'engine.settle@1.5.0', jb.finishedMs! + 300, 1200, 'work_item', null, `Settle pass: ${jb.result!.changed} changed of ${jb.result!.judged} judged`, true);
    for (let q = 0; q < Math.max(2, jb.result!.changed + 1); q++) { const n = R.int(1, 92); const t = jb.finishedMs!; cs.rows.push(wiRow(n, { status: 'open', version: 2, updated_at: iso(t - 3 * DAY) }, { status: R.pick(['done', 'waiting_on_others', 'dismissed']), status_changed_at: iso(t), version: 3, updated_at: iso(t) })); }
    cs.eid = cs.rows[0]!.rowId;
  }
  // the daily priority run (weekday mornings after wake) re-ranks the open items and stamps cc.meta
  const metaRow = settings.find((s) => s.key === 'cc.meta')!;
  for (let d = -29; d <= 0; d++) {
    const dw = new Date(Date.UTC(2026, 10, 18 + d)).getUTCDay(); if (dw === 0 || dw === 6) continue;
    const t = d === 0 ? tms('2026-11-18T14:35:00.000Z') : atMs(d, '07:35') + R.int(0, 40) * MIN;
    const cs = eng(`eng-priority-${d}`, 'engine.priority@v3', t, 3800, 'work_items', 'ranking', `Priority run: re-ranked ${R.int(22, 46)} open items`, false);
    const seen = new Set<number>(); const k = R.int(19, 31);
    while (seen.size < k) seen.add(R.int(1, 92));
    for (const n of seen) { const rk = R.int(1, 40); cs.rows.push(wiRow(n, { priority_rank: rk + R.int(1, 3), priority_score: R.int(20, 90) / 10, priority_lane: R.pick(['later', 'now', 'later']), updated_at: iso(t - DAY) }, { priority_rank: rk, priority_score: R.int(20, 95) / 10, priority_lane: R.pick(['top3', 'now', 'later']), priority_computed_at: iso(t), updated_at: iso(t) })); }
    cs.rows.push({ table: 'user_settings', rowId: 'cc.meta', etype: 'settings', eid: 'cc.meta', op: 'update', before: { ...metaRow, value: { ...(metaRow.value as any), rankedAt: iso(t - DAY), policyRankVersion: d < -3 ? (d < -12 ? 1 : 2) : 3 }, updated_at: iso(t - DAY) }, after: { ...metaRow, value: { ...(metaRow.value as any), rankedAt: iso(t), policyRankVersion: d < -3 ? (d < -12 ? 1 : 2) : 3 }, updated_at: iso(t) } });
  }
  for (const jb of jobs.filter((x) => x.kind === 'nba.generate' && x.status === 'succeeded')) {
    const cs = eng(`eng-${jb.key}`, 'engine.nba@2', jb.finishedMs! + 300, 900, 'work_item', jb.payload.work_item_id, 'Next best action generated', false);
    cs.rows.push(wiRow(Number(String(jb.payload.work_item_id).length ? 1 : 1), { current_nba_id: null, updated_at: iso(jb.createdMs - DAY) }, { current_nba_id: uid('next_best_actions', `ops-nba-${jb.key}`), updated_at: iso(jb.finishedMs!) }));
    { const oid = uid('next_best_actions', `ops-old-${jb.key}`); cs.rows.push({ table: 'next_best_actions', rowId: oid, etype: 'work_item', eid: jb.payload.work_item_id, op: 'delete', before: { id: oid, work_item_id: jb.payload.work_item_id, verb: 'reply', created_at: iso(jb.createdMs - 3 * DAY) }, after: null }); }
    cs.rows[0]!.rowId = jb.payload.work_item_id; cs.rows[0]!.eid = jb.payload.work_item_id; cs.rows[0]!.before!.id = jb.payload.work_item_id; cs.rows[0]!.after!.id = jb.payload.work_item_id;
  }
  const hier = settings.find((s) => s.key === 'cc.org62.account_hierarchy')!;
  for (const jb of jobs.filter((x) => x.kind === 'accounts.hierarchy' && x.status === 'succeeded')) {
    const cs = eng(`eng-${jb.key}`, 'engine.hierarchy@1', jb.finishedMs! + 200, 700, 'settings', 'cc.org62.account_hierarchy', 'Refreshed the Org62 account hierarchy', false);
    const hv = hier.value as any;
    cs.rows.push({ table: 'user_settings', rowId: 'cc.org62.account_hierarchy', etype: 'settings', eid: 'cc.org62.account_hierarchy', op: 'update', before: { ...hier, value: { ...hv, readAt: iso(jb.finishedMs! - DAY) }, updated_at: iso(jb.finishedMs! - DAY) }, after: { ...hier, value: { ...hv, readAt: iso(jb.finishedMs!) }, updated_at: iso(jb.finishedMs!) } });
  }
  const engineNow = sets.filter((x) => x.kind === 'engine_pass').length;
  void engineNow;

  // engines stamp cc.meta (ranking / logging counters) after most passes; org62 commits refresh the cc.ext/opportunities stubs
  const metaVal = metaRow.value as any;
  for (const cs of sets.filter((x) => x.kind === 'engine_pass' && !x.key.startsWith('eng-priority') && x.rows.length)) {
    if (R.chance(0.8)) cs.rows.push({ table: 'user_settings', rowId: 'cc.meta', etype: 'settings', eid: 'cc.meta', op: 'update', before: { ...metaRow, value: { ...metaVal, canvas: { ...metaVal.canvas, rowsChangedSince: Math.max(0, (metaVal.canvas?.rowsChangedSince ?? 3) - 1) }, lastActiveAt: iso(cs.createdMs - 3 * HOUR) }, updated_at: iso(cs.createdMs - 3 * HOUR) }, after: { ...metaRow, value: { ...metaVal, lastActiveAt: iso(cs.createdMs - 2 * MIN) }, updated_at: iso(cs.createdMs) } });
  }
  const extKeys = settings.filter((s) => String(s.key).startsWith('cc.ext/opportunities/'));
  const org62Sets = sets.filter((x) => x.kind === 'connector_sync' && x.actorRef.startsWith('scan:org62:') && x.key.startsWith('conn-'));
  for (const s of extKeys) for (let i = 0; i < 4; i++) {
    const cs = R.pick(org62Sets); if (cs.rows.some((y) => y.rowId === s.key)) continue;
    const v = s.value as any;
    cs.rows.push({ table: 'user_settings', rowId: s.key as string, etype: 'settings', eid: s.key as string, op: 'update', before: { ...s, value: { ...v, nextStepRead: i % 2 === 0 ? !v.nextStepRead : v.nextStepRead, dcAssigned: i < 2 ? !v.dcAssigned : v.dcAssigned }, updated_at: iso(cs.createdMs - 2 * DAY) }, after: { ...s, value: { ...v, nextStepRead: true }, updated_at: iso(cs.createdMs) } });
  }

  // ── chat tool calls ────────────────────────────────────────────────────────────────────────────
  const chatDefs: Array<[string, string, string, string]> = [
    ['work_item', 'chat_propose_changes', 'Chat created a work item from a request', 'create'], ['work_item', 'chat_propose_changes', 'Chat moved a due date', 'due'], ['vdp', 'chat_vdp_update', 'Chat updated a VDP use case', 'vdp'], ['settings', 'chat_update_settings', 'Chat turned on the missed-DC sweep reminder', 'settings'],
    ['work_item', 'chat_propose_changes', 'Chat snoozed an item', 'snooze'], ['chat_thread', 'chat_rename_thread', 'Chat renamed the thread', 'thread'], ['activity_entry', 'chat_log_batch', 'Chat proposed a logging batch', 'log'], ['work_item', 'chat_propose_changes', 'Chat added a note to a work item', 'note'],
    ['connector', 'chat_rescan', 'Chat asked for a Slack rescan', 'rescan'], ['work_item', 'chat_propose_changes', 'Chat marked an ask done', 'done'], ['brief', 'chat_brief_refresh', 'Chat refreshed the Voltmere brief', 'brief'],
  ];
  const chatTimes = ctx.chatAt.map((x) => tms(x));
  chatDefs.forEach(([et, tool, summary, tag], i) => {
    const t = chatTimes[(i * 1 + 1) % chatTimes.length]! + 22_000 + i * 90_000 * 0; const thread = CHAT_THREADS[i % CHAT_THREADS.length]!;
    const cs = add({ key: `chat-${i}`, kind: 'chat_tool_call', actor: 'chat', actorRef: `chat:tool:${tool}#call-${i + 1}`, editor: thread, etype: et, eid: null, summary, undoable: et !== 'connector', createdMs: t, closedMs: t + 1900, rows: [] });
    if (tag === 'rescan') { cs.eid = CONN.slack.id; }
    else if (et === 'work_item') { const n = R.int(1, 92); cs.eid = wiId(n); cs.rows.push(tag === 'create' ? { table: 'work_items', rowId: wiId(n), etype: 'work_item', eid: wiId(n), op: 'insert', before: null, after: { id: wiId(n), owner_user_id: OWNER, kind: 'task', origin: 'asked_of_me', status: 'open', title: 'Prep the Saltmere data-flow diagram', created_at: iso(t), updated_at: iso(t) } } : wiRow(n, { due_at: iso(t + 4 * DAY), snoozed_until: null, version: 3, updated_at: iso(t - DAY) }, { due_at: iso(t + 2 * DAY), snoozed_until: tag === 'snooze' ? iso(t + DAY) : null, status: tag === 'done' ? 'done' : 'open', version: 4, updated_at: iso(t) })); }
    else if (et === 'settings') { const s = settings.find((x) => x.key === 'settings.closing')!; cs.eid = 'settings.closing'; cs.rows.push({ table: 'user_settings', rowId: 'settings.closing', etype: 'settings', eid: 'settings.closing', op: 'update', before: { ...s, value: { ...(s.value as any), askFirstChannels: [] }, updated_at: iso(t - 2 * DAY) }, after: { ...s, updated_at: iso(t) } }); }
    else cs.eid = `chat-${tag}-${i}`;
  });

  // ── system: schedule ticks at boots / catch-ups, migrations ────────────────────────────────────
  const sysSets: CS[] = [];
  for (const w of workers) sysSets.push(add({ key: `sys-boot-${w.id}`, kind: 'system', actor: 'system', actorRef: 'scheduler', etype: null, eid: null, summary: 'ensure maintenance schedules', undoable: false, createdMs: w.startMs + 6000, closedMs: w.startMs + 6800, rows: [] }));
  for (const [i, d] of [-22, -15, -9, -4, -2, -1].entries()) { const t = atMs(d, '06:45') + R.int(0, 30) * MIN; sysSets.push(add({ key: `sys-due-${i}`, kind: 'system', actor: 'system', actorRef: 'scheduler', etype: null, eid: null, summary: `schedules due: ${R.int(3, 6)}`, undoable: false, createdMs: t, closedMs: t + 1100, rows: [] })); }
  for (const [i, t] of ['2026-11-04T17:03:10.000Z', '2026-11-12T21:34:30.000Z'].entries()) sysSets.push(add({ key: `sys-mig-${i}`, kind: 'system', actor: 'system', actorRef: 'schema-guard', etype: null, eid: null, summary: i ? 'applied migration 0020 (llm_decisions, retention tables)' : 'applied migration 0018 (settle pass columns)', undoable: false, createdMs: tms(t), closedMs: tms(t) + 4000, rows: [] }));

  // ── user edits: work items, activity entries, opportunity watch, VDP, brief; autosave bursts; undo; rollback ───
  const userSets: CS[] = [];
  const u = (key: string, t: number, etype: string, eid: string, summary: string, rows: Spec[], undoable = true, kind = 'user_edit', extra: Partial<CS> = {}) => { const c = add({ key, kind, actor: 'user', actorRef: extra.actorRef ?? 'ui.edit', editor: 'tab-smpl-main', etype, eid, summary, undoable, createdMs: t, closedMs: t + 2400, rows, ...extra }); userSets.push(c); return c; };
  const edits: Array<[number, string, number, string, any, any, string]> = [
    [-24, '10:20', 8, 'Set the due date on the discovery follow-up', { due_at: null }, { due_at: iso(atMs(-20, '17:00')), due_kind: 'user' }, 'due'],
    [-17, '14:05', 21, 'Marked the NDA ask done', { status: 'open' }, { status: 'done', done_by: 'user', resolution: 'done_by_me' }, 'done'],
    [-13, '09:40', 33, 'Snoozed the pricing question until Monday', { status: 'open', snoozed_until: null }, { status: 'snoozed', snoozed_until: iso(atMs(-10, '08:00')) }, 'snooze'],
    [-8, '16:55', 12, 'Changed the title of the blueprint task', { title: 'Blueprint draft' }, { title: 'Saltmere solution blueprint v1' }, 'title'],
    [-5, '11:10', 45, 'Dismissed a suggested task (not mine)', { status: 'suggested' }, { status: 'dismissed', resolution: 'not_needed' }, 'dismiss'],
    [-2, '15:30', 3, 'Locked the due date on the blueprint', { user_locked_fields: [] }, { user_locked_fields: ['due_at'] }, 'lock'],
  ];
  for (const [d, hh, n, summary, b, a, tag] of edits) { const t = atMs(d, hh); u(`ued-${tag}`, t, 'work_item', wiId(n), summary, [wiRow(n, { ...b, version: 2, updated_at: iso(t - 3 * DAY) }, { ...a, version: 3, updated_at: iso(t) })]); }
  const act = [[-12, '13:20', 'Changed the task type of a logged meeting'], [-10, '10:05', 'Edited the duration of a calendar-derived entry'], [-3, '16:10', 'Approved a proposed entry']] as Array<[number, string, string]>;
  act.forEach(([d, hh, summary], i) => { const t = atMs(d, hh); const id = uid('activity_entries', `ops-ae-${i + 1}`); u(`uact-${i}`, t, 'activity_entry', id, summary, [{ table: 'activity_entries', rowId: id, etype: 'activity_entry', eid: id, op: 'update', before: { id, owner_user_id: OWNER, duration_hours: 1, status: 'proposed', version: 1, updated_at: iso(t - DAY) }, after: { id, owner_user_id: OWNER, duration_hours: i === 1 ? 1.5 : 1, status: i === 2 ? 'verified' : 'proposed', approval_method: i === 2 ? 'click' : null, version: 2, updated_at: iso(t) } }]); });
  const oppW = opps.find((o) => o.is_watched === false && !o.is_closed && !o.on_my_team)!;
  u('uwatch', atMs(-14, '10:50'), 'opportunity', oppW.id as string, 'Watched an opportunity outside my team', [{ table: 'opportunities', rowId: oppW.id as string, etype: 'opportunity', eid: oppW.id as string, op: 'update', before: { ...oppW, is_watched: false }, after: { ...oppW, is_watched: true } }]);
  u('uvdp', atMs(-3, '14:35'), 'vdp', uid('vdp_records', 'saltmere-health-plan-data-360-poc'), 'Edited a VDP use case title', [{ table: 'use_cases', rowId: uid('use_cases', 'hv-unified-profile'), etype: 'vdp', eid: uid('vdp_records', 'saltmere-health-plan-data-360-poc'), op: 'update', before: { id: uid('use_cases', 'hv-unified-profile'), title: 'Unified Profile', updated_at: iso(atMs(-9, '09:00')) }, after: { id: uid('use_cases', 'hv-unified-profile'), title: 'Unified Member Profile', updated_at: iso(atMs(-3, '14:35')) } }]);
  u('ubrief', atMs(-6, '08:25'), 'brief', uid('briefs', 'weekly-voltmere'), 'Marked a brief highlight as not relevant', [{ table: 'brief_highlights', rowId: uid('brief_highlights', 'ops-bh-1'), etype: 'brief', eid: uid('briefs', 'weekly-voltmere'), op: 'update', before: { id: uid('brief_highlights', 'ops-bh-1'), relevance_feedback: null }, after: { id: uid('brief_highlights', 'ops-bh-1'), relevance_feedback: 'not_relevant' } }]);
  u('umissed', atMs(-4, '09:15'), 'missed_opp', uid('missed_opp_findings', 'harrowgate-maintenance-agent'), 'Kept the missed-opportunity finding', [{ table: 'missed_opp_findings', rowId: uid('missed_opp_findings', 'harrowgate-maintenance-agent'), etype: 'missed_opp', eid: uid('missed_opp_findings', 'harrowgate-maintenance-agent'), op: 'update', before: { id: uid('missed_opp_findings', 'harrowgate-maintenance-agent'), status: 'open', user_locked: false }, after: { id: uid('missed_opp_findings', 'harrowgate-maintenance-agent'), status: 'open', user_locked: true } }]);
  // undo pairs (the undone sets are user edits and one auto-close)
  const autoClose = sets.find((x) => x.key.startsWith('eng-job-comp') && x.rows.length)!;
  const targets: CS[] = [sets.find((x) => x.key === 'ued-snooze')!, sets.find((x) => x.key === 'ued-title')!, sets.find((x) => x.key === 'ued-due')!, autoClose];
  targets.forEach((tg, i) => {
    const t = tg.closedMs + R.int(8, 40) * 1000 + (i === 3 ? 2 * HOUR : 0);
    const uc = add({ key: `undo-${i}`, kind: 'undo', actor: 'user', actorRef: i === 3 ? 'toast.undo' : 'shortcut.cmd-z', editor: 'tab-smpl-main', etype: tg.etype, eid: tg.eid, summary: `Undo: ${tg.summary}`.slice(0, 140), undoable: false, createdMs: t, closedMs: t + 1800, undoOf: tg.key, rows: tg.rows.slice(0, 1).map((rw) => ({ ...rw, op: 'update' as const, before: rw.after, after: rw.before, coalesced: 1 })) });
    tg.undoneMs = t; tg.undoneBy = uc.key; userSets.push(uc);
  });
  const rbT = atMs(-7, '12:40'); const rbN = 17;
  userSets.push(add({ key: 'rollback-1', kind: 'rollback', actor: 'user', actorRef: 'history.restore', editor: 'tab-smpl-main', etype: 'work_item', eid: wiId(rbN), summary: 'Restored a work item to its state of 2026-11-02 10:00', undoable: true, createdMs: rbT, closedMs: rbT + 2100, rollbackTo: atMs(-16, '10:00'), rows: [wiRow(rbN, { title: 'Intro call with the data team (renamed)', status: 'open', version: 6, updated_at: iso(rbT - 2 * DAY) }, { title: 'Intro call with the data team', status: 'open', version: 7, updated_at: iso(rbT) })] }));

  // ── autosave bursts + content revisions ─────────────────────────────────────────────────────────
  const rev: Row[] = []; let rid = 0;
  const doc = (paras: string[]) => ({ type: 'doc', content: paras.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) });
  const mkRev = (entityType: string, entityId: string, field: string, revn: number, body: { doc?: any; text?: string }, actor: string, session: string | null, csKey: string | null, started: number, saved: number, saves: number, closed: number | null) => {
    const content = body.doc ? j(body.doc) : body.text!;
    rev.push({ id: ++rid, owner_user_id: OWNER, entity_type: entityType, entity_id: entityId, field, revision: revn, doc_json: body.doc ?? null, text: body.doc ? null : body.text, content_hash: sha(content), actor_kind: actor, editor_session_id: session, change_set_id: csKey, started_at: iso(started), last_saved_at: iso(saved), save_count: saves, closed_at: closed ? iso(closed) : null, _cs: csKey });
  };
  interface DraftRev { entity: string; etype: string; field: 'doc_json' | 'description'; baseAt: number; versions: Array<{ at: number; by: 'engine' | 'user'; paras?: string[]; text?: string; saves: number }>; title: string }
  const draftElderglen = ref('drafts', 'rev-elderglen-demo-reply', 'the unapproved slack_reply draft answering the AE\'s demo ask in elderglen-outdoors-deal; doc_json MUST equal the last content_revisions row (field doc_json) for this draft, status ready, never sent');
  const draftHarbor = ref('drafts', 'rev-saltmere-blueprint-email', 'customer email to the Saltmere champion about the blueprint (due Friday); doc_json MUST equal the last content_revisions row (field doc_json) for this draft; edited by the user before approval');
  const revs: DraftRev[] = [
    { entity: draftElderglen, etype: 'drafts', field: 'doc_json', baseAt: atMs(-1, '14:22'), title: 'elderglen reply', versions: [
      { at: atMs(-1, '14:22'), by: 'engine', paras: ['Sure, happy to. I can walk Brendan and Meiling through the Agentforce order-status flow on Thursday. Does 2pm work, or is the morning better?', 'I will need the sandbox order feed enabled before then.'], saves: 1 },
      { at: atMs(-1, '16:41'), by: 'user', paras: ['Sure, happy to. I can walk Brendan and Meiling through the Agentforce order-status flow Thursday. 2pm MT work, or is the morning better?', 'Quick one: can your team enable the sandbox order feed before then? That is the only blocker I see.'], saves: 4 },
      { at: atMs(-1, '16:49'), by: 'user', paras: ['Sure, happy to. I can walk Brendan and Meiling through the Agentforce order-status flow Thursday. 2pm MT work, or is the morning better?', 'Quick one: can your team enable the sandbox order feed before then? That is the only blocker I see.', 'I will send a 20 minute agenda tonight.'], saves: 3 },
    ] },
    { entity: draftHarbor, etype: 'drafts', field: 'doc_json', baseAt: atMs(-3, '15:10'), title: 'saltmere email', versions: [
      { at: atMs(-3, '15:10'), by: 'engine', paras: ['Hi Marisol,', 'Attached is the draft solution blueprint for the member services POC. It covers the unified profile in Data 360, the Agentforce status lookup, and the open items on identity resolution.', 'Could you review it by Thursday so I can fold your feedback in before the Friday handoff?', 'Thanks,', 'Rafael'], saves: 1 },
      { at: atMs(-3, '17:02'), by: 'user', paras: ['Hi Marisol,', 'Here is the draft solution blueprint for the member services POC. It covers the unified profile in Data 360, the Agentforce status lookup, and the three open items on identity resolution.', 'Could you review it by end of day Thursday? I will fold your comments in before it goes to your leadership on Friday.', 'Thanks,', 'Rafael'], saves: 6 },
    ] },
  ];
  const wiRevs = [{ n: 7, field: 'description', versions: [{ at: atMs(-20, '10:30'), by: 'engine' as const, text: 'Customer asked for a sizing estimate for the unified profile workload. Source: Slack thread in the POC channel.', saves: 1 }, { at: atMs(-20, '16:12'), by: 'user' as const, text: 'Customer asked for a sizing estimate for the unified profile workload (about 4.2M member records, nightly refresh). Waiting on the claims volume numbers from their data team.', saves: 5 }, { at: atMs(-11, '09:30'), by: 'user' as const, text: 'Sizing estimate sent 11/05. Customer asked for a second scenario with real-time updates; needs a call with their data team.', saves: 3 }] },
    { n: 21, field: 'description', versions: [{ at: atMs(-9, '11:00'), by: 'engine' as const, text: 'Mandatory annual training reminder from the training portal. Due 11/21.', saves: 1 }, { at: atMs(-5, '13:45'), by: 'user' as const, text: 'Mandatory annual training reminder from the training portal. Due 11/21. Plan: finish the two modules Thursday morning.', saves: 2 }] }];
  for (const d of revs) {
    d.versions.forEach((v, i) => {
      const burst = v.by === 'user' ? add({ key: `burst-${d.title}-${i}`, kind: 'autosave_burst', actor: 'user', actorRef: 'editor.autosave', editor: `tab-smpl-${sha(d.title).slice(0, 6)}`, etype: 'draft', eid: d.entity, summary: `Edited the draft "${d.title}"`, undoable: true, createdMs: v.at - 3 * MIN, closedMs: v.at + 30_000, coalesceUntil: v.at + 30_000, rows: [] }) : add({ key: `burst-${d.title}-${i}`, kind: 'engine_pass', actor: 'engine', actorRef: d.title.startsWith('elderglen') ? 'engine.draft-slack@1' : 'engine.draft-email@1', etype: 'draft', eid: d.entity, summary: `Drafted "${d.title}"`, undoable: false, createdMs: v.at - 6000, closedMs: v.at + 1200, rows: [] });
      userSets.push(burst);
      mkRev('drafts', d.entity, d.field, i + 1, { doc: doc(v.paras!) }, v.by, v.by === 'engine' ? 'baseline' : burst.editor ?? null, burst.key, v.at - (v.by === 'user' ? 3 * MIN : 0), v.at, v.saves, v.at + 30_000);
    });
  }
  for (const w of wiRevs) {
    w.versions.forEach((v, i) => {
      const burst = add({ key: `burst-wi${w.n}-${i}`, kind: v.by === 'user' ? 'autosave_burst' : 'engine_pass', actor: v.by, actorRef: v.by === 'user' ? 'editor.autosave' : 'engine.reeval@2', editor: v.by === 'user' ? `tab-smpl-wi${w.n}` : undefined, etype: 'work_item', eid: wiId(w.n), summary: `Edited the description of a work item`, undoable: v.by === 'user', createdMs: v.at - 2 * MIN, closedMs: v.at + 30_000, coalesceUntil: v.by === 'user' ? v.at + 30_000 : undefined, rows: [wiRow(w.n, { description: i ? w.versions[i - 1]!.text! : null, version: i + 1, updated_at: iso(v.at - DAY) }, { description: v.text!, version: i + 2, updated_at: iso(v.at) })] });
      userSets.push(burst);
      mkRev('work_items', wiId(w.n), w.field, i + 1, { text: v.text! }, v.by, v.by === 'engine' ? 'baseline' : burst.editor ?? null, burst.key, v.at - 2 * MIN, v.at, v.saves, v.at + 30_000);
    });
  }
  // a few more autosave bursts on the same work items / activity notes, no revisions needed (older than the revision horizon)
  for (let i = 0; i < 3; i++) { const t = atMs(-R.int(2, 18), '15:20') + i * 7 * MIN; const n = R.int(1, 92); userSets.push(add({ key: `burst-extra-${i}`, kind: 'autosave_burst', actor: 'user', actorRef: 'editor.autosave', editor: `tab-smpl-x${i}`, etype: 'work_item', eid: wiId(n), summary: 'Edited the notes of a work item', undoable: true, createdMs: t, closedMs: t + 45_000, coalesceUntil: t + 30_000, rows: [wiRow(n, { notes: null, version: 2, updated_at: iso(t - DAY) }, { notes: 'Called the customer back; waiting on their security review.', version: 3, updated_at: iso(t + 20_000) })] })); }

  // ── schedule ticks for the system sets (job_schedules rows are domain 03's own; keys are stable) ───
  const schedKeys = ['backup.nightly', 'retention.scrub', 'missed_opps.sweep', 'brief.generate', 'forecast.sync', 'hygiene.sweep', 'org62.readback', 'vdp.specialist_aes', 'accounts.hierarchy', 'activity.sync'];
  for (const s of sysSets.filter((x) => x.summary.startsWith('schedules due'))) {
    const k = Number(s.summary.split(': ')[1]);
    for (const key of schedKeys.slice(0, k + 1).filter((x) => x !== 'activity.sync')) {
      const id = uid('job_schedules', key);
      s.rows.push({ table: 'job_schedules', rowId: id, etype: 'job_schedule', eid: id, op: 'update', before: { id, key, next_run_at: iso(s.createdMs - 2 * HOUR), last_enqueued_at: iso(s.createdMs - DAY), updated_at: iso(s.createdMs - DAY) }, after: { id, key, next_run_at: iso(s.createdMs + 20 * HOUR), last_enqueued_at: iso(s.createdMs), updated_at: iso(s.createdMs) } });
    }
    s.etype = 'job_schedule'; s.eid = s.rows[0]?.rowId ?? null;
  }

  // ── numbering: pinned keep their n; the rest are time-ordered into the free numbers ─────────────
  const free: number[] = []; const pinned = new Set(sets.filter((x) => x.n).map((x) => x.n!));
  for (let n = 1; n <= 500; n++) if (!pinned.has(n)) free.push(n);
  // fit to exactly the free numbers: drop bare connector commits, or add small ones
  const isCommit = (x: CS) => x.kind === 'connector_sync' && x.key.startsWith('conn-') && !x.rows.some((r) => r.table === 'connectors' || r.table === 'opportunities' || r.table === 'user_settings');
  let rest = sets.filter((x) => !x.n);
  while (rest.length > free.length) {
    const victims = rest.filter(isCommit); if (!victims.length) throw new Error(`too many change sets: ${rest.length} > ${free.length}`);
    const v = R.pick(victims); sets.splice(sets.indexOf(v), 1); rest = sets.filter((x) => !x.n);
  }
  let extra = 0;
  while (rest.length < free.length) {
    const r = R.pick(okRuns.filter((x) => x.f.nw > 0 && x.conn !== 'vdp' && x.conn !== 'claude'));
    const base = connectorSets.find((x) => x.key.startsWith(`conn-${r.key}-`))!;
    extra++;
    const t = base.createdMs - R.int(1, 20) * 1000;
    const c: CS = { ...base, key: `connx-${r.key}-${extra}`, createdMs: t, closedMs: t + 900, rows: [] };
    sets.push(c); rest = sets.filter((x) => !x.n);
  }
  rest = rest.sort((a, b) => a.createdMs - b.createdMs || a.key.localeCompare(b.key));
  return { sets, rest, free, rev, userSets, sysSets };
}
export const diffKeys = diff;
