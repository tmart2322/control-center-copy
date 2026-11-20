/**
 * Items 4, 5 (scan runs / ledger), 10 and the app_events / llm_call_days parts of item 8:
 *  - connector_health_checks: failing streaks per connector (mostly transient / rate limited) plus four short sign-in outages
 *  - reauth_attempts + connector_auth_events (+ app event and notification) for those outages
 *  - scan_runs.trigger: more `hook` runs (file watchers, push-driven connectors); job payloads follow
 *  - scan_ledger_entries: per-day calendar_range rows for the calendar scans
 *  - app_events: reconcile messages name the work item; llm_call_days: the Sonnet escalations of the first-scan days
 */
import { rng } from '../../lib/kit';
import { OWNER, ms, iso, plus, mt, MIN, DAY, readTable, writeTable, uid, type Row } from './realism-lib';

const CONNECTOR_NAME: Record<string, string> = { slack: 'Slack', gmail: 'Gmail', drive: 'Drive', calendar: 'Calendar', gemini_notes: 'Gemini notes', org62: 'Org62', claude: 'Claude sessions', vdp: 'VDP' };
const TRANSIENT = (n: string) => [`${n}: request timed out after 15s`, `${n}: connection reset by peer`, `${n}: 502 bad gateway from the MCP server`, `${n}: MCP server did not answer the probe`];

export function ops() {
  const R = rng('realism-ops');
  const conns = readTable('connectors'); const kind = new Map(conns.map((c) => [String(c.id), String(c.kind)]));
  const cByKind = (k: string, n = 0) => conns.filter((c) => c.kind === k)[n]!;
  let hc = readTable('connector_health_checks');
  const bad = hc.filter((h) => !h.ok).map((h) => ({ c: String(h.connector_id), t: ms(h.checked_at) }));
  const NOW_MS = ms(mt('11-18', '09:00'));
  const nearBad = (c: string, t: number) => bad.some((b) => b.c === c && Math.abs(b.t - t) < 4 * 3600_000);
  const probeOf = new Map<string, string>(); for (const h of hc) probeOf.set(String(h.connector_id), String(h.probe));

  // ── sign-in outages: 4 short auth_required streaks, each with a reauth attempt and auth events (item 10) ──
  type Out = { k: string; n: number; start: string; attempts: Array<{ method: string; status: string; req: string; started: string | null; fin: string | null; code: string | null; instr: string | null; ev: Array<[string, string, string]> }>; detail: string };
  const OUT: Out[] = [
    { k: 'gmail', n: 0, start: mt('10-27', '08:41'), detail: 'invalid_grant: the Google grant for the work mailbox expired',
      attempts: [{ method: 'mcp_oauth', status: 'succeeded', req: mt('10-27', '08:52'), started: mt('10-27', '08:52:05'), fin: mt('10-27', '09:15'), code: null, instr: null, ev: [['reauth_requested', mt('10-27', '08:52'), 'Reconnect Gmail clicked in Health'], ['reauth_succeeded', mt('10-27', '09:15'), 'OAuth consent completed; probe passed'], ['refreshed', mt('10-27', '09:15:01'), 'new grant stored (not shown)']] }] },
    { k: 'calendar', n: 0, start: mt('10-30', '07:48'), detail: '401 invalid_grant: sign-in required',
      attempts: [
        { method: 'devbar_login', status: 'failed', req: mt('10-30', '08:20'), started: mt('10-30', '08:20:04'), fin: mt('10-30', '08:21'), code: 'devbar_not_signed_in', instr: null, ev: [['reauth_requested', mt('10-30', '08:20'), 'Run login clicked in Health'], ['reauth_failed', mt('10-30', '08:21'), 'the login helper is not signed in on this machine']] },
        { method: 'manual_instructions', status: 'succeeded', req: mt('10-30', '08:34'), started: mt('10-30', '08:34:10'), fin: mt('10-30', '08:52'), code: null, instr: 'Reconnect Google Calendar in the connector settings and approve read access.', ev: [['reauth_requested', mt('10-30', '08:34'), 'Reconnect Calendar clicked in Health (manual instructions shown)'], ['reauth_succeeded', mt('10-30', '08:52'), 'connector reconnected; probe passed'], ['refreshed', mt('10-30', '08:52:01'), 'read access re-approved']] },
      ] },
    { k: 'gemini_notes', n: 0, start: mt('11-06', '13:50'), detail: 'the Drive grant that reads Gemini notes was revoked',
      attempts: [
        { method: 'mcp_oauth', status: 'cancelled', req: mt('11-06', '14:05'), started: mt('11-06', '14:05:03'), fin: mt('11-06', '14:09'), code: null, instr: null, ev: [['reauth_requested', mt('11-06', '14:05'), 'Reconnect clicked in Health'], ['reauth_failed', mt('11-06', '14:09'), 'consent window closed before approval (cancelled by the user)']] },
        { method: 'mcp_oauth', status: 'succeeded', req: mt('11-06', '15:30'), started: mt('11-06', '15:30:04'), fin: mt('11-06', '15:44'), code: null, instr: null, ev: [['reauth_requested', mt('11-06', '15:30'), 'Reconnect clicked in Health'], ['reauth_succeeded', mt('11-06', '15:44'), 'OAuth consent completed; probe passed'], ['refreshed', mt('11-06', '15:44:01'), 'new grant stored (not shown)']] },
      ] },
    { k: 'slack', n: 0, start: mt('11-09', '09:12'), detail: 'token_expired: the Slack session must be re-approved',
      attempts: [{ method: 'mcp_oauth', status: 'succeeded', req: mt('11-09', '09:40'), started: mt('11-09', '09:40:05'), fin: mt('11-09', '09:58'), code: null, instr: null, ev: [['reauth_requested', mt('11-09', '09:40'), 'Reconnect Slack clicked in Health'], ['reauth_succeeded', mt('11-09', '09:58'), 'OAuth consent completed; probe passed'], ['refreshed', mt('11-09', '09:58:01'), 'new session stored (not shown)']] }] },
  ];
  const authRows: Row[] = []; const reauth = readTable('reauth_attempts'); const events = readTable('connector_auth_events');
  let evId = events.reduce((m, e) => Math.max(m, Number(e.id)), 0);
  const appEv = readTable('app_events'); const notifs = readTable('notifications');
  const newApp: Row[] = []; const newNotif: Row[] = [];
  let oi = 0;
  for (const o of OUT) {
    const c = cByKind(o.k, o.n); const cid = String(c.id); const name = CONNECTOR_NAME[o.k]!;
    const done = ms(o.attempts[o.attempts.length - 1]!.fin);
    // health checks every ~10 minutes until the connector is back
    for (let t = ms(o.start) + 20_000; t < done; t += 9 * MIN + R.int(0, 120_000)) authRows.push({ connector_id: cid, checked_at: iso(t), ok: false, status: 'auth_required', probe: probeOf.get(cid), latency_ms: R.int(300, 900), error_code: 'auth', error_message: `${name}: ${o.detail}; sign-in required` });
    bad.push({ c: cid, t: ms(o.start) });
    evId++; events.push({ id: evId, connector_id: cid, kind: 'expired', occurred_at: o.start, actor_kind: 'system', reauth_attempt_id: null, expires_at: null, detail: `scan probe failed with 401: ${o.detail}` });
    for (const a of o.attempts) {
      const aid = uid('reauth_attempts', `real-${o.k}-${a.req}`);
      reauth.push({ id: aid, connector_id: cid, method: a.method, status: a.status, requested_by: 'user', requested_at: a.req, started_at: a.started, finished_at: a.fin, job_id: null, user_instruction: a.instr, error_code: a.code });
      for (const [kd, at, detail] of a.ev) { evId++; events.push({ id: evId, connector_id: cid, kind: kd, occurred_at: at, actor_kind: kd === 'reauth_requested' ? 'user' : 'system', reauth_attempt_id: aid, expires_at: null, detail }); }
    }
    const eid = 900 + oi; oi++;
    newApp.push({ owner_user_id: OWNER, severity: 'error', component: `connector.${o.k}`, code: 'connector_auth_required', error_class: 'auth', message: `${name} needs re-auth`, connector_id: cid, job_id: null, scan_run_id: null, entity_type: null, entity_id: null, detail: { from: 'healthy', to: 'auth_required' }, fingerprint: `connector.${o.k}|connector_auth_required|${cid}`, occurrence_count: 1, first_occurred_at: plus(o.start, 0.5), last_occurred_at: plus(o.start, 0.5), seen_at: null, acknowledged_at: null, resolved_at: plus(String(o.attempts[o.attempts.length - 1]!.fin), 1.5), id: eid });
    newNotif.push({ id: uid('notifications', `real-auth-${o.k}`), owner_user_id: OWNER, severity: 'error', body: 'Scans are paused until the connector is re-authorised. Your drafts and work items are unaffected.', entity_type: 'connector', entity_id: cid, connector_id: cid, app_event_id: eid, job_id: null, change_set_id: null, action_route: `/settings/health#${o.k}`, action_kind: 'reauth', status: 'resolved', seen_at: plus(o.start, 7), snoozed_until: null, acknowledged_at: null, resolved_at: plus(String(o.attempts[o.attempts.length - 1]!.fin), 1.5), resolved_by: 'system', expires_at: null, os_notified_at: plus(o.start, 0.7), updated_at: plus(String(o.attempts[o.attempts.length - 1]!.fin), 1.5), kind: 'connector_auth_required', title: `${name} needs you to sign in again`, dedupe_key: `connector:${cid}:auth:${o.start.slice(0, 10)}`, created_at: plus(o.start, 0.5) });
  }

  // ── transient / rate-limited failing streaks (item 4) ──
  const lastErr = new Map(conns.map((c) => [String(c.id), c.last_error_at ? ms(c.last_error_at) : NOW_MS - DAY]));
  const streakRows: Row[] = [];
  for (const c of conns) {
    const cid = String(c.id); const k = String(c.kind); const name = CONNECTOR_NAME[k]!;
    const mine = hc.filter((h) => h.connector_id === cid).sort((a, b) => String(a.checked_at).localeCompare(String(b.checked_at)));
    const limit = Math.min(lastErr.get(cid)!, NOW_MS - 2 * DAY);
    const wanted = k === 'slack' ? 6 : k === 'vdp' ? 4 : 5;
    let made = 0; let tries = 0;
    while (made < wanted && tries++ < 400) {
      const i = R.int(4, mine.length - 12); const row = mine[i]!; const t0 = ms(row.checked_at);
      if (t0 > limit || nearBad(cid, t0) || OUT.some((o) => Math.abs(ms(o.start) - t0) < 6 * 3600_000 && kind.get(cid) === o.k)) continue;
      const len = R.int(3, 8); const rl = (k === 'slack' || k === 'org62' || k === 'gmail') && R.chance(0.45);
      const seg = mine.slice(i, i + len); if (seg.some((s) => ms(s.checked_at) > limit || !s.ok)) continue;
      seg.forEach((s, j) => {
        const code = rl ? 'rate_limited' : (R.chance(0.04) ? 'bug' : 'transient');
        const status = j === 0 || j === len - 1 ? 'degraded' : 'error';
        s.ok = false; s.status = status; s.error_code = code; s.latency_ms = code === 'transient' && R.chance(0.5) ? 15000 : R.int(400, 2600);
        s.error_message = code === 'rate_limited' ? `${name}: rate limited (429), retry after ${R.pick([30, 45, 62, 90])}s` : code === 'bug' ? `${name}: unexpected response shape from the probe (${R.pick(['missing field', 'empty body'])})` : R.pick(TRANSIENT(name));
      });
      bad.push({ c: cid, t: t0 }); made++;
    }
  }
  // 'stale' rows from the old build keep their meaning; add the new auth rows and re-number ids by time
  hc = [...hc, ...authRows].sort((a, b) => ms(a.checked_at) - ms(b.checked_at));
  hc.forEach((h, i) => { h.id = i + 1; });
  void streakRows;
  writeTable('connector_health_checks', hc);
  writeTable('reauth_attempts', reauth.sort((a, b) => ms(a.requested_at) - ms(b.requested_at)));
  events.sort((a, b) => ms(a.occurred_at) - ms(b.occurred_at)); events.forEach((e, i) => { e.id = i + 1; });
  writeTable('connector_auth_events', events);

  // app events: add the sign-in outages, vary the reconcile message, re-number by time (notifications follow)
  const wi = new Map(readTable('work_items').map((w) => [String(w.id), w])); const acct = new Map(readTable('accounts').map((a) => [String(a.id), String(a.name)]));
  for (const a of appEv) if (a.code === 'reconcile_missed_item') {
    const w = wi.get(String((a.detail as any)?.workItemId)); if (!w) continue;
    const who = w.account_id ? acct.get(String(w.account_id)) : null; const ttl = String(w.title).replace(/^(Reply to|Send|Review|Confirm)\s+/i, '$1 ');
    a.message = R.pick([`Reconcile: "${ttl}"${who ? ` (${who})` : ''} had source evidence but no work item`, `Reconcile found an unlinked source item for "${ttl}"`, `Reconcile: a source item should have updated "${ttl}"`]);
  }
  const allApp = [...appEv, ...newApp].sort((a, b) => ms(a.first_occurred_at) - ms(b.first_occurred_at));
  const oldIdToNew = new Map<number, number>(); const newIdFor900 = new Map<number, number>();
  allApp.forEach((a, i) => { (Number(a.id) >= 900 ? newIdFor900 : oldIdToNew).set(Number(a.id), i + 1); });
  const allN = [...notifs, ...newNotif];
  for (const n of allN) if (n.app_event_id != null) { const v = Number(n.app_event_id); n.app_event_id = v >= 900 ? newIdFor900.get(v) : oldIdToNew.get(v) ?? n.app_event_id; }
  allApp.forEach((a, i) => { a.id = i + 1; });
  writeTable('app_events', allApp);
  allN.sort((a, b) => ms(a.created_at) - ms(b.created_at));
  writeTable('notifications', allN);

  // ── scan runs: hook triggers (item 5) ──
  const runs = readTable('scan_runs'); const jobs = readTable('jobs'); const jobBy = new Map(jobs.map((j) => [Number(j.id), j]));
  const HOOK_KINDS = new Set(['drive', 'calendar', 'gemini_notes']); let gmailLeft = 12; let slackLeft = 8; let hooks = 0;
  for (const r of runs) {
    if (r.trigger !== 'schedule') continue; const k = kind.get(String(r.connector_id))!;
    const flip = HOOK_KINDS.has(k) || (k === 'gmail' && gmailLeft-- > 0) || (k === 'slack' && slackLeft-- > 0);
    if (!flip) continue;
    r.trigger = 'hook'; hooks++;
    const j = r.job_id != null ? jobBy.get(Number(r.job_id)) : null;
    if (j && (j.payload as any)?.trigger === 'schedule') (j.payload as any).trigger = 'hook';
    if (j && (j.result as any)?.trigger === 'schedule') (j.result as any).trigger = 'hook';
  }
  writeTable('scan_runs', runs); writeTable('jobs', jobs);
  console.log(`  hook runs flipped: ${hooks}`);

  // ── ledger: per-day calendar ranges for the calendar scans ──
  const ledger = readTable('scan_ledger_entries'); let lid = ledger.reduce((m, l) => Math.max(m, Number(l.id)), 0);
  const cal = cByKind('calendar');
  const have = new Set(ledger.map((l) => `${l.scan_run_id}|${l.object_external_id}`));
  const adds: Row[] = [];
  for (const r of runs.filter((x) => x.connector_id === cal.id).sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)))) {
    const from = ms(r.window_start); const to = ms(r.window_end); const span = Math.max(1, Math.round((to - from) / DAY));
    const startDay = Math.floor(from / DAY) * DAY - (span > 3 ? 0 : 2 * DAY);
    const days = Math.min(60, span + 45);
    for (let d = 0; d < days; d++) {
      const dayIso = iso(startDay + d * DAY).slice(0, 10); const ext = `smpl-cal-primary:${dayIso}`;
      if (have.has(`${r.id}|${ext}`)) continue;
      const failed = r.status === 'failed' && d > 1;
      adds.push({ id: 0, scan_run_id: r.id, connector_id: r.connector_id, scope: r.scope, object_kind: 'calendar_range', object_external_id: ext, covered_from: r.window_start, covered_to: r.window_end, start_token: dayIso, end_token: iso(startDay + (d + 1) * DAY).slice(0, 10), item_count: R.int(2, 22), new_item_count: R.chance(0.25) ? R.int(1, 4) : 0, result_hash: Array.from({ length: 16 }, () => R.int(0, 15).toString(16)).join(''), outcome: failed ? 'error' : 'complete', created_at: plus(r.started_at, 1 + (d % 6) * 0.2) });
    }
  }
  const allL = [...ledger, ...adds].sort((a, b) => ms(a.created_at) - ms(b.created_at) || Number(a.id) - Number(b.id));
  void lid; allL.forEach((l, i) => { l.id = i + 1; });
  writeTable('scan_ledger_entries', allL);
  console.log(`  ledger calendar_range added: ${adds.length}`);

  // ── llm_call_days: the Sonnet escalations / a failed call of the three rolled-up first-scan days (item 8) ──
  const days = readTable('llm_call_days'); let did = days.reduce((m, d) => Math.max(m, Number(d.id)), 0);
  const mk = (day: string, purpose: string, skill: string, model: string, tier: string, reason: string, status: string, calls: number, inTok: number, outTok: number, cost: number): Row => ({ id: ++did, owner_user_id: OWNER, day, purpose, model, model_tier: tier, skill_key: skill, budget: 'first_scan', trigger: '', model_reason: reason, status, calls, input_tokens: inTok, output_tokens: outTok, cache_read_tokens: Math.round(inTok * 3.4), cache_write_tokens: Math.round(inTok * 0.25), cost_usd: cost, estimated_calls: 0, latency_ms_total: calls * (tier === 'sonnet' ? 14000 : 4200), first_at: `${day}T${tier === 'sonnet' ? '17' : '16'}:12:00.000Z`, last_at: `${day}T${tier === 'sonnet' ? '22' : '20'}:41:00.000Z`, rolled_up_at: '2026-11-13T13:44:44.378Z' });
  const extra: Row[] = [
    mk('2026-10-19', 'summarize', 'brief-opportunity', 'claude-sonnet-5-5', 'sonnet', 'default', 'ok', 2, 188400, 19800, 0.8123),
    mk('2026-10-19', 'scan_extract', 'scan-slack', 'claude-sonnet-5-5', 'sonnet', 'escalation:unclear', 'ok', 3, 96200, 8800, 0.4217),
    mk('2026-10-19', 'scan_extract', 'scan-gmail', 'claude-haiku-5-5', 'haiku', 'default', 'error', 1, 9100, 0, 0),
    mk('2026-10-20', 'scan_extract', 'scan-slack', 'claude-sonnet-5-5', 'sonnet', 'escalation:unclear', 'ok', 4, 131800, 12100, 0.5731),
    mk('2026-10-20', 'done_match', 'completion-check', 'claude-haiku-5-5', 'haiku', 'default', 'ok', 6, 41200, 2600, 0.0114),
    mk('2026-10-20', 'scan_extract', 'scan-org62', 'claude-haiku-5-5', 'haiku', 'default', 'timeout', 1, 12400, 0, 0),
    mk('2026-10-20', 'chat', 'assistant', 'claude-sonnet-5-5', 'sonnet', 'policy:direct_ask', 'ok', 2, 52300, 3900, 0.2144),
    mk('2026-10-21', 'scan_extract', 'scan-gmail', 'claude-sonnet-5-5', 'sonnet', 'escalation:unsure', 'ok', 2, 74800, 6400, 0.3398),
    mk('2026-10-21', 'classify', 'triage-slack', 'claude-haiku-5-5', 'haiku', 'default', 'ok', 5, 14200, 800, 0.0052),
    mk('2026-10-21', 'done_match', 'completion-check', 'claude-haiku-5-5', 'haiku', 'default', 'ok', 4, 27800, 1800, 0.0077),
  ];
  writeTable('llm_call_days', [...days, ...extra]);
}
