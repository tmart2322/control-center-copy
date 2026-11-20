/** Domain 03: connector health checks and status flips, auth events, re-auth attempts, app events, notifications. */
import { rng, uid, type Row } from '../../lib/kit';
import { CONN, HOUR, MIN, NOW_MS, atMs, hex, iso, tms, type ConnKey } from './ops-lib';
import type { RunX } from './ops-facts';
import type { JobT } from './ops-jobs';
import type { RunOut } from './ops-trace';

const R = rng('ops-health');
const OWNER = uid('users', 'owner');
type St = 'healthy' | 'degraded' | 'stale' | 'auth_required' | 'error';
export interface Flip { conn: ConnKey; atMs: number; from: St; to: St; cls: string | null; msg: string | null }
export interface BudgetFacts { alerts: Array<{ day: string; atMs: number; usd: number; limit: number }>; blockMs: number; raiseMs: number; blockUsd: number; raiseCs: string }

const wiU = (n: number) => uid('work_items', `wi-${String(n).padStart(3, '0')}`);
const CODE_OF = (cls: string) => (cls === 'config' ? 'bug' : cls === 'unknown' ? 'transient' : cls);

export function buildHealth(ctx: { runs: RunX[]; runOf: Map<string, RunOut>; jobs: JobT[]; jobId: (k: string) => number; budget: BudgetFacts; coreConn: Array<Record<string, any>>; csOfJob?: (k: string) => string | null }) {
  const { runs, runOf, jobs, jobId, budget } = ctx;
  const checks: Array<Row & { _t: number; id: number }> = []; const stripT = (x: Array<Row & { _t: number }>) => x.map(({ _t, ...rest }) => rest as Row); const flips: Flip[] = [];
  let hid = 0;
  const probeOf = (c: ConnKey) => CONN[c].probe;
  const chk = (conn: ConnKey, atMsv: number, ok: boolean, status: St, code: string | null, msg: string | null, lat: number | null) => {
    checks.push({ id: 0, connector_id: CONN[conn].id, checked_at: iso(atMsv), ok, status, probe: probeOf(conn), latency_ms: lat, error_code: code, error_message: msg, _t: atMsv });
  };
  const lat = (c: ConnKey) => (c === 'org62' ? R.int(320, 2400) : c === 'slack' ? R.int(380, 1500) : c === 'claude' ? R.int(8, 60) : R.int(140, 950));

  // ── state machine over runs, per connector ──────────────────────────────────────────────────────
  for (const conn of Object.keys(CONN) as ConnKey[]) {
    let st: St = 'healthy'; let cf = 0; let lastCls: string | null = null; let lastMsg: string | null = null;
    const rs = runs.filter((r) => r.conn === conn && r.mode !== 'reconcile').sort((a, b) => a.endMs - b.endMs);
    for (const r of rs) {
      if (r.status === 'cancelled') continue;
      const t = r.endMs;
      if (r.status === 'failed') {
        const cls = r.err!.cls; lastCls = cls; lastMsg = r.err!.msg; cf += 1;
        let next: St = st;
        if (cls === 'auth') next = 'auth_required';
        else if (cf >= 4) next = 'error';
        else if (cf >= 2 && st !== 'auth_required') next = st === 'error' ? 'error' : 'degraded';
        if (next !== st) { flips.push({ conn, atMs: t, from: st, to: next, cls, msg: lastMsg }); st = next; }
        if (st !== 'healthy') chk(conn, t + 500, false, st, CODE_OF(cls), lastMsg!.slice(0, 160), cls === 'transient' && r.err!.cause === 'timeout' ? null : lat(conn));
      } else {
        if (st !== 'healthy') {
          // dense probing while unhealthy: every 10 min between the last failure and the recovery
          const lastFail = checks.filter((c) => c.connector_id === CONN[conn].id && c._t < t).slice(-1)[0];
          for (let p = (lastFail?._t ?? t - 30 * MIN) + 10 * MIN; p < t - 2 * MIN && p < (lastFail?._t ?? 0) + 90 * MIN; p += 10 * MIN) chk(conn, p, false, st, CODE_OF(lastCls ?? 'transient'), (lastMsg ?? '').slice(0, 160), lat(conn));
          flips.push({ conn, atMs: t, from: st, to: 'healthy', cls: null, msg: null });
          chk(conn, t + 800, true, 'healthy', null, null, lat(conn)); st = 'healthy';
        }
        cf = 0;
      }
    }
    if (conn === 'slack') {
      // right now: still degraded after two 429s
      chk('slack', tms('2026-11-18T15:45:00.000Z'), false, 'degraded', 'rate_limited', 'Slack: rate limited (429), backing off', null);
    }
  }
  // stale → healthy flips from the core connector rows (the app slept; first scan after waking put them back)
  for (const row of ctx.coreConn) {
    const conn = (Object.keys(CONN) as ConnKey[]).find((k) => CONN[k].id === row.id)!;
    if (conn === 'slack') continue;
    const t = tms(row.status_changed_at);
    if (flips.some((f) => f.conn === conn && Math.abs(f.atMs - t) < 30 * MIN)) continue;
    chk(conn, t - 7 * MIN, false, 'stale', 'transient', `no successful scan for ${R.int(14, 21)}h (stale after ${CONN[conn].staleS / 3600 >= 1 ? CONN[conn].staleS / 3600 + 'h' : '15m'})`, null);
    chk(conn, t, true, 'healthy', null, null, lat(conn));
    flips.push({ conn, atMs: t, from: 'stale', to: 'healthy', cls: null, msg: null });
  }
  // baseline probes: ~3 a day per connector while the laptop is awake, only while healthy
  const unhealthy = (conn: ConnKey, t: number) => { let st: St = 'healthy'; for (const f of flips.filter((x) => x.conn === conn).sort((a, b) => a.atMs - b.atMs)) { if (f.atMs <= t) st = f.to; else break; } return st !== 'healthy'; };
  for (const conn of Object.keys(CONN) as ConnKey[]) {
    for (let d = -30; d <= 0; d++) {
      const wk = new Date(Date.UTC(2026, 10, 18 + d)).getUTCDay(); const weekend = wk === 0 || wk === 6;
      const n = weekend ? (R.chance(0.4) ? 1 : 0) : 3;
      for (let i = 0; i < n; i++) {
        const t = atMs(d, '07:20') + Math.round(((i + 0.3 + R.next() * 0.4) / 3) * 9.5 * HOUR);
        if (t > tms('2026-11-18T15:45:00.000Z') || unhealthy(conn, t) || checks.some((c) => c.connector_id === CONN[conn].id && Math.abs(c._t - t) < 8 * MIN)) continue;
        chk(conn, t, true, 'healthy', null, null, lat(conn));
      }
    }
    // the most recent probe of the day (connectors.updated_at = 15:45)
    if (conn !== 'slack') chk(conn, tms('2026-11-18T15:45:00.000Z') + R.int(0, 40) * 1000, true, 'healthy', null, null, lat(conn));
  }
  checks.sort((a, b) => a._t - b._t);
  checks.forEach((c, i) => { c.id = i + 1; });
  flips.sort((a, b) => a.atMs - b.atMs);

  // ── re-auth attempts and auth events ────────────────────────────────────────────────────────────
  const ra = (key: string) => uid('reauth_attempts', key);
  const reauthJobOf = (story: string) => jobs.find((j) => j.kind === 'connector.reauth' && j.runKey && runs.find((r) => r.key === j.runKey)?.story === story)!;
  const jVdp1104 = reauthJobOf('vdp-auth-1104'); const jDrive = reauthJobOf('drive-auth'); const jVdpToday = reauthJobOf('today-vdp');
  const deadVdp = jobs.find((j) => j.key === 'job-reauth-vdp-dead')!;
  const reauth: Row[] = [
    { id: ra('vdp-1104'), connector_id: CONN.vdp.id, method: 'refresh_script', status: 'succeeded', requested_by: 'user', requested_at: '2026-11-04T18:12:10.000Z', started_at: '2026-11-04T18:12:12.000Z', finished_at: '2026-11-04T18:34:50.000Z', job_id: jobId(jVdp1104.key), user_instruction: null, error_code: null },
    { id: ra('drive-1114'), connector_id: CONN.drive.id, method: 'manual_instructions', status: 'succeeded', requested_by: 'user', requested_at: '2026-11-14T21:34:00.000Z', started_at: '2026-11-14T21:34:10.000Z', finished_at: '2026-11-14T21:54:30.000Z', job_id: jobId(jDrive.key), user_instruction: 'Reconnect Google Drive in the connector settings and approve read access.', error_code: null },
    { id: ra('vdp-0-first'), connector_id: CONN.vdp.id, method: 'refresh_script', status: 'failed', requested_by: 'user', requested_at: '2026-11-18T15:13:20.000Z', started_at: '2026-11-18T15:13:25.000Z', finished_at: '2026-11-18T15:22:00.000Z', job_id: jobId(deadVdp.key), user_instruction: null, error_code: 'mfa_not_completed' },
    { id: ra('vdp-0-retry'), connector_id: CONN.vdp.id, method: 'refresh_script', status: 'succeeded', requested_by: 'user', requested_at: '2026-11-18T15:24:05.000Z', started_at: '2026-11-18T15:24:08.000Z', finished_at: '2026-11-18T15:29:50.000Z', job_id: jobId(jVdpToday.key), user_instruction: null, error_code: null },
  ];
  const ae = (conn: ConnKey, kind: string, t: string, actor: string, att: string | null, exp: string | null, detail: string): Row & { _t: number } => ({ id: 0, connector_id: CONN[conn].id, kind, occurred_at: t, actor_kind: actor, reauth_attempt_id: att ? ra(att) : null, expires_at: exp, detail, _t: tms(t) });
  const authEvents: Array<Row & { _t: number }> = [
    ae('vdp', 'expired', '2026-11-04T18:11:20.000Z', 'system', null, null, 'scan failed with 401: the Okta proxy session cookie expired'),
    ae('vdp', 'reauth_requested', '2026-11-04T18:12:10.000Z', 'user', 'vdp-1104', null, 'Run refresh clicked in Health'),
    ae('vdp', 'mfa_required', '2026-11-04T18:12:40.000Z', 'system', 'vdp-1104', null, 'the refresh script is waiting for the Okta MFA prompt'),
    ae('vdp', 'reauth_succeeded', '2026-11-04T18:34:50.000Z', 'system', 'vdp-1104', null, 'refresh script exited 0; probe passed'),
    ae('vdp', 'refreshed', '2026-11-04T18:34:51.000Z', 'system', 'vdp-1104', '2026-11-04T19:52:50.000Z', 'new session cookie stored (not shown); expiry read from the cookie'),
    ae('gmail-work', 'expiring_soon', '2026-11-15T20:00:00.000Z', 'system', null, '2026-11-16T14:00:00.000Z', 'Google grant refresh is due within 24 hours (the app was closed for most of the weekend)'),
    ae('gmail-work', 'refreshed', '2026-11-16T14:02:00.000Z', 'system', null, null, 'grant refreshed automatically on wake; no sign-in needed'),
    ae('drive', 'expired', '2026-11-14T21:10:00.000Z', 'system', null, null, 'scan failed with 401 invalid_grant: sign-in required'),
    ae('drive', 'reauth_requested', '2026-11-14T21:34:00.000Z', 'user', 'drive-1114', null, 'Reconnect Drive clicked in Health (manual instructions shown)'),
    ae('drive', 'reauth_succeeded', '2026-11-14T21:54:30.000Z', 'system', 'drive-1114', null, 'connector reconnected; probe passed'),
    ae('drive', 'refreshed', '2026-11-14T21:54:31.000Z', 'system', 'drive-1114', null, 'read access re-approved'),
    ae('vdp', 'expiring_soon', '2026-11-18T14:55:00.000Z', 'system', null, '2026-11-18T15:25:00.000Z', 'session cookie expires within 30 minutes'),
    ae('vdp', 'expired', '2026-11-18T15:12:00.000Z', 'system', null, null, 'scan failed with 401: the Okta proxy session cookie expired'),
    ae('vdp', 'reauth_requested', '2026-11-18T15:13:20.000Z', 'user', 'vdp-0-first', null, 'Run refresh clicked in Health'),
    ae('vdp', 'mfa_required', '2026-11-18T15:13:40.000Z', 'system', 'vdp-0-first', null, 'the refresh script is waiting for the Okta MFA prompt'),
    ae('vdp', 'reauth_failed', '2026-11-18T15:22:00.000Z', 'system', 'vdp-0-first', null, 'MFA was not completed within 8 minutes; the re-auth job gave up (5 attempts)'),
    ae('vdp', 'reauth_requested', '2026-11-18T15:24:05.000Z', 'user', 'vdp-0-retry', null, 'Run refresh clicked again'),
    ae('vdp', 'reauth_succeeded', '2026-11-18T15:29:50.000Z', 'system', 'vdp-0-retry', null, 'refresh script exited 0; probe passed'),
    ae('vdp', 'refreshed', '2026-11-18T15:30:00.000Z', 'system', 'vdp-0-retry', '2026-11-18T16:48:00.000Z', 'new session cookie stored (not shown); expiry read from the cookie'),
  ];
  authEvents.sort((a, b) => a._t - b._t).forEach((e, i) => { e.id = i + 1; });

  // ── app events ─────────────────────────────────────────────────────────────────────────────────
  const ev: Array<Row & { key: string }> = [];
  const sidOf = (r: RunX) => `${CONN[r.conn].scanKind}:${r.scope ?? 'reconcile'}`;
  const comp = (c: ConnKey) => `scanner.${CONN[c].scanKind}`;
  const fp: Record<string, number> = {};
  // (1) failed scan runs grouped per (scope, cause) until the next success
  const runsSorted = [...runs].sort((a, b) => a.endMs - b.endMs);
  interface Grp { cls: string; cause: string; runs: RunX[]; code: string; resolvedMs: number | null }
  const open = new Map<string, Grp>(); const done: Grp[] = [];
  for (const r of runsSorted) {
    if (r.mode === 'reconcile') continue;
    const sid = sidOf(r);
    if (r.status === 'failed') {
      const cls = r.err!.cls; const cause = r.err!.cause; const code = cause === 'cost_cap' ? 'cost_cap' : 'scan_run_failed';
      const k = `${sid}|${code}|${cause}`;
      const g = open.get(k) ?? { cls, cause, runs: [], code, resolvedMs: null };
      g.runs.push(r); open.set(k, g);
    } else if (r.status === 'succeeded') {
      for (const [k, g] of [...open]) if (k.startsWith(sid + '|')) { g.resolvedMs = r.endMs + 400; done.push(g); open.delete(k); }
    }
  }
  const groups = [...done, ...open.values()];
  groups.forEach((g, gi) => {
    const first = g.runs[0]!; const last = g.runs[g.runs.length - 1]!; const sid = sidOf(first);
    const cls = g.cls === 'config' ? 'validation' : g.cls;
    const what = g.code === 'cost_cap' ? 'stopped at its cost cap' : `failed (${g.cause})`;
    const label = CONN[first.conn].label;
    const msg = `${label} ${sid.slice(CONN[first.conn].scanKind.length + 1)}: ${what}`.slice(0, 200);
    const action = g.cls === 'auth' ? 'Re-auth the connector' : 'npm run scan:trace -- <runId>';
    ev.push({ key: `fail-${gi}`, owner_user_id: OWNER, severity: g.cls === 'transient' || g.cls === 'rate_limited' ? 'warn' : 'error', component: comp(first.conn), code: g.code, error_class: cls, message: msg, connector_id: CONN[first.conn].id, job_id: null, scan_run_id: runOf.get(last.key)!.id,
      entity_type: 'scope', entity_id: sid, detail: { runId: runOf.get(last.key)!.id, cause: g.cause, errorClass: g.cls, error: last.err!.msg.slice(0, 160), suggestedAction: action }, fingerprint: `${comp(first.conn)}|${g.code}|${sid}|${g.cause}`, occurrence_count: g.runs.length,
      first_occurred_at: iso(first.endMs), last_occurred_at: iso(last.endMs), seen_at: g.resolvedMs && R.chance(0.5) ? iso(Math.min(last.endMs + R.int(10, 240) * MIN, NOW_MS - MIN)) : null, acknowledged_at: null, resolved_at: g.resolvedMs ? iso(g.resolvedMs) : null, _fk: first.conn });
    void fp;
  });
  // (2) flips
  flips.forEach((f, i) => {
    const code = f.to === 'healthy' ? 'connector_healthy' : f.to === 'degraded' ? 'connector_degraded' : f.to === 'error' ? 'connector_error' : f.to === 'auth_required' ? 'connector_auth_required' : null;
    if (!code) return;
    const label = CONN[f.conn].label;
    const fm = (f.msg ?? 'repeated failures').replace(/^[A-Za-z0-9 ()]+: /, '').slice(0, 110);
    const msg = f.to === 'healthy' ? `${label} is healthy again` : f.to === 'degraded' ? `${label} degraded: ${fm}` : f.to === 'error' ? `${label} is failing: ${fm}` : `${label} needs re-auth`;
    const next = f.to === 'healthy' ? undefined : flips.slice(i + 1).find((x) => x.conn === f.conn && x.to === 'healthy');
    const resolved = f.to === 'healthy' ? f.atMs : next ? next.atMs : null;
    ev.push({ key: `flip-${i}`, owner_user_id: OWNER, severity: f.to === 'healthy' ? 'info' : f.to === 'degraded' ? 'warn' : 'error', component: `connector.${CONN[f.conn].scanKind}`, code, error_class: f.to === 'healthy' ? null : f.cls === 'config' ? 'validation' : f.cls === 'auth' ? 'auth' : f.cls === 'rate_limited' ? 'rate_limited' : 'transient',
      message: msg, connector_id: CONN[f.conn].id, job_id: null, scan_run_id: null, entity_type: null, entity_id: null, detail: { from: f.from, to: f.to }, fingerprint: `connector.${CONN[f.conn].scanKind}|${code}|${CONN[f.conn].id}`, occurrence_count: 1,
      first_occurred_at: iso(f.atMs), last_occurred_at: iso(f.atMs), seen_at: f.to === 'healthy' || (resolved && R.chance(0.6)) ? iso(f.atMs + R.int(1, 30) * MIN) : null, acknowledged_at: null, resolved_at: resolved ? iso(resolved) : null, _flip: f });
  });
  // (3) hard cap pauses (2026-11-10) and (4) dead letters
  const pausedJobs = jobs.filter((j) => j.tag === 'paused');
  pausedJobs.forEach((j, i) => {
    const sid = `${j.payload.connector}:${j.payload.scope}`;
    ev.push({ key: `cap-${i}`, owner_user_id: OWNER, severity: 'warn', component: `scanner.${j.payload.connector}`, code: 'budget_hard_cap', error_class: 'budget', message: `${j.payload.connector} ${j.payload.scope}: paused at the daily LLM hard cap; resumes tomorrow`.slice(0, 200), connector_id: null, job_id: jobId(j.key), scan_run_id: null, entity_type: 'scope', entity_id: sid,
      detail: { todayUsd: Math.round(budget.blockUsd * 100) / 100 + (i ? 0.01 * i : 0), suggestedAction: 'Raise the hard cap in Settings, or wait for the next budget day' }, fingerprint: `scanner.${j.payload.connector}|budget_hard_cap|${sid}`, occurrence_count: 1 + (i < 3 ? 1 : 0), first_occurred_at: iso(j.startedMs!), last_occurred_at: iso(j.startedMs! + (i < 3 ? 12 * MIN : 0)), seen_at: iso(budget.raiseMs - 4 * MIN), acknowledged_at: null, resolved_at: iso(budget.raiseMs + 90_000) });
  });
  const dead = jobs.filter((j) => j.status === 'dead');
  dead.forEach((j) => {
    ev.push({ key: `dead-${j.key}`, owner_user_id: OWNER, severity: 'error', component: 'worker.queue', code: 'job_dead_lettered', error_class: j.lastErrClass === 'rate_limited' ? 'rate_limited' : 'transient', message: `${j.kind} dead after ${j.attempts} attempts (${(j.deadReason ?? '').replace('attempts exhausted: ', '')})`.slice(0, 200), connector_id: j.kind.startsWith('scan.') ? CONN[(Object.keys(CONN) as ConnKey[]).find((k) => CONN[k].scanKind === j.kind.slice(5))!]?.id ?? null : j.kind === 'connector.reauth' ? CONN.vdp.id : null, job_id: jobId(j.key), scan_run_id: null, entity_type: 'job', entity_id: String(jobId(j.key)),
      detail: { code: j.lastErrCode ?? 'unknown', kind: j.kind }, fingerprint: `worker.queue|job_dead_lettered|${j.kind}|${jobId(j.key)}`, occurrence_count: 1, first_occurred_at: iso(j.deadMs!), last_occurred_at: iso(j.deadMs!), seen_at: j.key === 'job-dead-5' ? null : iso(j.deadMs! + 20 * MIN), acknowledged_at: null, resolved_at: j.key === 'job-dead-5' ? null : j.key === 'job-reauth-vdp-dead' ? '2026-11-18T15:30:30.000Z' : iso(j.deadMs! + R.int(1, 6) * HOUR) });
  });
  // (5) reconcile: missed items, coverage gaps, skill upgrades
  const wantItems = new Set<number>();
  while (wantItems.size < 62) wantItems.add(R.int(1, 92));
  [...wantItems].sort((a, b) => a - b).forEach((w, i) => {
    const t = Math.min(atMs(-R.int(0, 24), '07:00') + R.int(0, 3 * 60) * MIN, NOW_MS - 3 * HOUR); const hRes = R.int(1, 30); const resolved = R.chance(0.7) && t + hRes * HOUR < NOW_MS - 10 * MIN;
    ev.push({ key: `miss-${w}`, owner_user_id: OWNER, severity: 'warn', component: 'reconcile', code: 'reconcile_missed_item', error_class: null, message: 'Reconcile found a source item that should have produced a work item', connector_id: null, job_id: null, scan_run_id: null, entity_type: null, entity_id: null, detail: { workItemId: wiU(w) }, fingerprint: `reconcile|reconcile_missed_item|${wiU(w)}`, occurrence_count: R.chance(0.2) ? 2 : 1, first_occurred_at: iso(t), last_occurred_at: iso(t + (i % 5 === 0 ? 2 * HOUR : 0)), seen_at: R.chance(0.6) ? iso(t + HOUR) : null, acknowledged_at: R.chance(0.2) ? iso(t + 2.5 * HOUR) : null, resolved_at: resolved ? iso(t + hRes * HOUR) : null });
  });
  const recRuns = runs.filter((r) => r.mode === 'reconcile');
  const rGap = recRuns.find((r) => r.reconcilePass === 'coverage_gaps' && r.startMs > atMs(-7, '00:00'))!;
  ev.push({ key: 'gap-1', owner_user_id: OWNER, severity: 'warn', component: 'reconcile', code: 'reconcile_coverage_gap', error_class: null, message: 'Slack inbox: a gap in coverage after the rate-limit window (2026-11-12 08:20 to 10:12 MT)', connector_id: CONN.slack.id, job_id: null, scan_run_id: runOf.get(rGap.key)!.id, entity_type: 'scope', entity_id: 'slack:inbox', detail: { gap: { from: '2026-11-12T15:05:00.000Z', to: '2026-11-12T17:12:00.000Z' } }, fingerprint: 'reconcile|reconcile_coverage_gap|slack:inbox|2026-11-12', occurrence_count: 1, first_occurred_at: '2026-11-12T17:30:30.000Z', last_occurred_at: '2026-11-12T17:30:30.000Z', seen_at: '2026-11-12T19:00:00.000Z', acknowledged_at: null, resolved_at: iso(rGap.endMs + 5000) });
  const rGap0 = recRuns.find((r) => r.reconcilePass === 'coverage_gaps' && r.startMs < atMs(-7, '00:00'))!;
  ev.push({ key: 'gap-0', owner_user_id: OWNER, severity: 'warn', component: 'reconcile', code: 'reconcile_coverage_gap', error_class: null, message: 'Slack inbox: one hour of coverage missing after the first-scan windows', connector_id: CONN.slack.id, job_id: null, scan_run_id: runOf.get(rGap0.key)!.id, entity_type: 'scope', entity_id: 'slack:inbox', detail: { gap: { from: '2026-10-21T20:10:00.000Z', to: '2026-10-21T21:10:00.000Z' } }, fingerprint: 'reconcile|reconcile_coverage_gap|slack:inbox|2026-10-21', occurrence_count: 1, first_occurred_at: iso(rGap0.startMs + 20_000), last_occurred_at: iso(rGap0.startMs + 20_000), seen_at: null, acknowledged_at: null, resolved_at: iso(rGap0.endMs + 2000) });
  const rUp = recRuns.find((r) => r.reconcilePass === 'skill_upgrade')!;
  for (const [i, sc] of ['inbox', 'channel:' + 'C0SMPL001'].entries()) {
    ev.push({ key: `up-${i}`, owner_user_id: OWNER, severity: 'warn', component: 'reconcile', code: 'reconcile_skill_upgrade', error_class: null, message: `Slack ${sc}: scan-slack 1.6.0 to 1.7.0, items re-linked with the newer skill`, connector_id: CONN.slack.id, job_id: null, scan_run_id: runOf.get(rUp.key)!.id, entity_type: 'scope', entity_id: `slack:${sc}`, detail: { actions: R.int(3, 11), gap: { from: '2026-11-06T15:00:00.000Z', to: '2026-11-12T21:30:00.000Z' } }, fingerprint: `reconcile|reconcile_skill_upgrade|slack:${sc}|1.7.0`, occurrence_count: 1, first_occurred_at: iso(rUp.startMs + 30_000), last_occurred_at: iso(rUp.startMs + 30_000), seen_at: null, acknowledged_at: null, resolved_at: iso(rUp.endMs + 3000) });
  }
  ev.sort((a, b) => tms(a.first_occurred_at as string) - tms(b.first_occurred_at as string));
  const evId = new Map<string, number>();
  ev.forEach((e, i) => { e.id = i + 1; evId.set(e.key, i + 1); });

  // ── notifications ──────────────────────────────────────────────────────────────────────────────
  const notifs: Row[] = [];
  const nk = (key: string, o: Partial<Row>) => {
    const created = tms(o.created_at as string);
    notifs.push({ id: uid('notifications', key), owner_user_id: OWNER, severity: 'error', body: null, entity_type: null, entity_id: null, connector_id: null, app_event_id: null, job_id: null, change_set_id: null, action_route: null, action_kind: null, status: 'resolved', seen_at: iso(created + 4 * MIN), snoozed_until: null, acknowledged_at: null, resolved_at: null, resolved_by: null, expires_at: null, os_notified_at: iso(created + 3000), updated_at: o.resolved_at ?? o.created_at, ...o });
  };
  flips.forEach((f, i) => {
    if (f.to === 'degraded' || f.to === 'error' || f.to === 'auth_required') {
      const rec = flips.slice(i + 1).find((x) => x.conn === f.conn && x.to === 'healthy');
      const isAuth = f.to === 'auth_required';
      if (f.from === 'degraded' || f.from === 'error') return; // same episode as the notification already raised
      const label = CONN[f.conn].label;
      const live = !rec;
      nk(`conn-${f.conn}-${f.atMs}`, { kind: isAuth ? 'connector_auth_required' : 'connector_degraded', severity: isAuth ? 'error' : 'warn', title: isAuth ? `${label} needs you to sign in again` : `${label} is having trouble`, body: isAuth ? 'Scans are paused until the connector is re-authorised. Your drafts and work items are unaffected.' : `${f.msg ?? 'Repeated scan failures'}. The app keeps retrying; items from ${label} may be a little behind.`.slice(0, 300), entity_type: 'connector', entity_id: CONN[f.conn].id, connector_id: CONN[f.conn].id, app_event_id: evId.get(`flip-${i}`) ?? null, action_route: `/settings/health#${CONN[f.conn].scanKind}`, action_kind: isAuth ? 'reauth' : null,
        dedupe_key: `connector:${CONN[f.conn].id}:${isAuth ? 'auth' : 'degraded'}:${iso(f.atMs).slice(0, 10)}`, status: live ? 'open' : 'resolved', created_at: iso(f.atMs + 1000), resolved_at: rec ? iso(rec.atMs + 2000) : null, resolved_by: rec ? 'system' : null, seen_at: live ? null : iso(f.atMs + 6 * MIN) });
    }
  });
  dead.forEach((j) => {
    const open = j.key === 'job-dead-5';
    nk(`dead-${j.key}`, { kind: 'job_dead_lettered', title: `${j.kind} gave up after ${j.attempts} attempts`, body: `${j.lastErr ?? 'The job kept failing'}. Retry it from Health once the cause is gone.`.slice(0, 300), entity_type: 'job', entity_id: String(jobId(j.key)), job_id: jobId(j.key), app_event_id: evId.get(`dead-${j.key}`) ?? null, connector_id: j.kind === 'connector.reauth' ? CONN.vdp.id : null, action_route: '/settings/health#jobs', action_kind: 'retry_job', dedupe_key: `job:${jobId(j.key)}:dead`, status: open ? 'open' : 'resolved', created_at: iso(j.deadMs! + 1500), seen_at: open ? null : iso(j.deadMs! + 30 * MIN), resolved_at: open ? null : j.key === 'job-reauth-vdp-dead' ? '2026-11-18T15:30:30.000Z' : iso(j.deadMs! + 5 * HOUR), resolved_by: open ? null : 'system' });
  });
  for (const a of budget.alerts) {
    nk(`budget-alert-${a.day}`, { kind: 'budget_alert', severity: 'warn', title: `LLM spend is at 80% of today's budget`, body: `$${a.usd.toFixed(2)} of $${a.limit.toFixed(2)} used (${a.day}). Heavy Slack backfill reads are the main cost.`, action_route: '/settings/spend', action_kind: null, dedupe_key: `budget:alert:${a.day}`, status: 'resolved', created_at: iso(a.atMs), resolved_at: iso(atMs(Math.round((tms(a.day + 'T12:00:00Z') - tms('2026-11-18T12:00:00Z')) / 86_400_000) + 1, '00:05')), resolved_by: 'system' });
  }
  nk('budget-blocked-1110', { kind: 'budget_blocked', severity: 'error', title: 'Scanning paused at the daily hard cap ($25.00)', body: 'New model calls are refused until tomorrow or until you raise the cap in Settings. Nothing was lost: paused scans resume where they stopped.', action_route: '/settings/spend', action_kind: 'raise_budget', dedupe_key: 'budget:blocked:2026-11-10', status: 'resolved', created_at: iso(budget.blockMs + 1000), resolved_at: iso(budget.raiseMs + 60_000), resolved_by: 'user', change_set_id: budget.raiseCs, app_event_id: evId.get('cap-0') ?? null });
  void NOW_MS; void hex;
  return { checks: stripT(checks), authEvents: stripT(authEvents), reauth, appEvents: ev.map(({ key, _fk, _flip, ...rest }: any) => rest as Row), notifs, flips, evId };
}
