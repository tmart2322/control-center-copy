/** Domain 03: the 700 LLM calls (plus the rolled-up first-scan calls), tied to runs, jobs and chat messages. */
import { ref, rng, sha } from '../../lib/kit';
import { HAIKU, MIN, SONNET, atMs, callCost, iso, mtDay, r6, skillVersion, tms, CONN, type Tok } from './ops-lib';
import type { RunX } from './ops-facts';
import type { JobT } from './ops-jobs';

export type CallStatus = 'ok' | 'error' | 'refused' | 'timeout' | 'budget_blocked';
export interface CallT {
  key: string; purpose: string; model: string; skill: string | null; skillVer: string | null; startMs: number; latencyMs: number; status: CallStatus; errCode?: string; tok: Tok;
  jobKey?: string; runKey?: string; chatMsgKey?: string; budget: 'daily' | 'first_scan'; trigger: string; modelReason: string; outcome: string; seed: string;
  estimated?: boolean; rolled?: boolean; cost: number; id?: number; fixed?: boolean;
}
const R = rng('ops-calls');
const D0 = tms('2026-11-12T21:34:00.000Z'); // the audit (D0) shipped with 1.3.0: before it trigger / model_reason / content_hash / outcome are NULL
export const D0_MS = D0;
const ver: Record<string, string> = { 'scan-slack': '1.7.0', 'scan-gmail': '3', 'scan-calendar': '2', 'scan-drive': '1', 'scan-gemini-notes': '3', 'scan-org62': '1.7.0', 'scan-claude-sessions': '2', 'triage-slack': '1.4.0', 'check-completion': '1.3.0', 'settle-item': '1.5.0', 'chat-assistant': '10', 'readin-ask': '2', 'readin-meeting': '2', 'enrich-capture': '2', 'read-lookup': '1', 'detect-identity': '1', 'vdp-company-identity': '1.0.0', 'brief-channel': '2', 'brief-opportunity': '1', 'nba-reply': '1', 'nba-nudge': '1', 'nba-log-activity': '2', 'nba-update-vdp': '2', 'nba-schedule': '1', 'nba-review-deliverable': '2', 'draft-slack': '1', 'draft-email': '1', 'scan-watch': '2' };
const rint = (a: number, b: number) => R.int(a, b);

function tokens(profile: 'scan' | 'triage' | 'judge' | 'draft' | 'chat' | 'readin' | 'nba' | 'small' | 'brief', scale = 1): Tok {
  const s = (a: number, b: number) => Math.round(rint(a, b) * scale);
  switch (profile) {
    case 'scan': return { in: s(14_000, 40_000), cr: s(90_000, 380_000), cw: s(15_000, 60_000), out: s(4_000, 14_000) };
    case 'triage': return { in: s(6_000, 18_000), cr: s(20_000, 90_000), cw: s(4_000, 12_000), out: s(1_500, 4_000) };
    case 'judge': return { in: s(5_000, 14_000), cr: s(20_000, 60_000), cw: s(2_000, 8_000), out: s(600, 2_200) };
    case 'draft': return { in: s(9_000, 22_000), cr: s(60_000, 200_000), cw: s(8_000, 30_000), out: s(600, 2_500) };
    case 'chat': return { in: s(7_000, 20_000), cr: s(40_000, 160_000), cw: s(5_000, 25_000), out: s(500, 2_400) };
    case 'readin': return { in: s(18_000, 60_000), cr: s(150_000, 500_000), cw: s(25_000, 90_000), out: s(3_000, 9_000) };
    case 'nba': return { in: s(7_000, 18_000), cr: s(40_000, 140_000), cw: s(6_000, 22_000), out: s(500, 2_000) };
    case 'brief': return { in: s(12_000, 40_000), cr: s(30_000, 120_000), cw: s(8_000, 30_000), out: s(1_800, 5_000) };
    default: return { in: s(2_500, 9_000), cr: s(8_000, 40_000), cw: s(1_500, 6_000), out: s(200, 1_100) };
  }
}
const latencyFor = (model: string, purpose: string, out: number) => (model === SONNET ? rint(5_000, 22_000) + Math.round(out / 60) : purpose === 'scan_extract' ? rint(18_000, 85_000) : rint(2_500, 14_000));

export function buildCalls(runs: RunX[], jobs: JobT[], jobId: (k: string) => number | undefined): CallT[] {
  const calls: CallT[] = [];
  let cn = 0;
  const push = (o: Partial<CallT> & Pick<CallT, 'purpose' | 'model' | 'skill' | 'startMs' | 'tok'>) => {
    const status = o.status ?? 'ok';
    const c: CallT = { key: `c-${++cn}`, latencyMs: o.latencyMs ?? latencyFor(o.model, o.purpose, o.tok.out), status, budget: 'daily', trigger: 'schedule', modelReason: 'default', outcome: 'items:0', seed: `${cn}`, cost: 0, skillVer: o.skill ? (ver[o.skill] ?? '1') : null, ...o } as CallT;
    if (status === 'budget_blocked') { c.tok = { in: 0, out: 0, cr: 0, cw: 0 }; c.latencyMs = rint(4, 30); }
    if (o.startMs < D0) { c.trigger = ''; c.modelReason = ''; c.outcome = ''; }
    calls.push(c);
    return c;
  };
  const trigOf = (r: RunX) => (r.budget === 'first_scan' ? 'first_scan' : r.mode === 'backfill' ? 'backfill' : r.trigger === 'hook' ? 'file_watch' : r.trigger === 'startup_catchup' ? 'catch_up' : r.trigger === 'reconcile' ? 'catch_up' : r.trigger);

  // ── per scan run ───────────────────────────────────────────────────────────────────────────────
  const jobByRun = new Map(jobs.filter((j) => j.runKey).map((j) => [j.runKey!, j]));
  for (const r of runs) {
    if (r.conn === 'vdp') continue;
    const def = CONN[r.conn]; const skill = def.skill!;
    const jk = jobByRun.get(r.key)?.key;
    const big = r.mode === 'backfill' ? 3.2 : r.pmode === 'head' && r.f.seen > 60 ? 1.8 : 1;
    const failedAuth = r.status === 'failed' && r.err?.cls === 'auth';
    if (failedAuth) continue;
    let n = r.mode === 'reconcile' ? 1 : r.mode === 'backfill' ? rint(3, 4) : r.conn === 'slack' ? rint(2, 3) : r.conn === 'gemini-notes' ? rint(2, 3) : r.conn === 'drive' || r.conn === 'org62' || r.conn === 'claude' ? rint(1, 3) : r.conn === 'calendar' ? (R.chance(0.4) ? 2 : 1) : rint(1, 2);
    if (r.status === 'failed' && r.err?.cls === 'rate_limited') n = 1;
    if (r.status === 'cancelled') n = 1;
    const span = Math.max(10_000, r.endMs - r.startMs - 4000);
    const plan: Array<{ purpose: string; skillKey: string; model: string; profile: any; scale: number }> = [];
    for (let i = 0; i < n; i++) plan.push({ purpose: 'scan_extract', skillKey: skill, model: HAIKU, profile: 'scan', scale: big * (0.7 + R.next() * 0.7) * Math.min(1.6, 0.6 + r.f.seen / 80) });
    if (r.conn === 'slack' && r.f.nw > 0 && r.status === 'succeeded' && R.chance(0.55)) plan.push({ purpose: 'classify', skillKey: 'triage-slack', model: HAIKU, profile: 'triage', scale: 0.7 + r.f.nw / 20 });
    if (r.conn !== 'gemini-notes' && r.status === 'succeeded' && r.f.cands > 0 && R.chance(0.7)) plan.push({ purpose: 'commitment_extract', skillKey: skill, model: HAIKU, profile: 'judge', scale: 1.1 });
    if (r.conn === 'gemini-notes' && r.f.nw > 0) { plan.push({ purpose: 'commitment_extract', skillKey: skill, model: HAIKU, profile: 'judge', scale: 1.4 }); if (R.chance(0.6)) plan.push({ purpose: 'summarize', skillKey: skill, model: HAIKU, profile: 'brief', scale: 0.8 }); }
    plan.forEach((p, i) => {
      const t0 = r.startMs + 2000 + Math.round((span * i) / plan.length);
      const lat = Math.round((span / plan.length) * (0.7 + R.next() * 0.25));
      const isLast = i === plan.length - 1;
      let status: CallStatus = 'ok'; let errCode: string | undefined;
      let tok = tokens(p.profile, p.scale);
      let outcome = p.purpose === 'classify' ? `verdicts:${rint(2, 9)}` : `items:${Math.max(0, r.f.nw + r.f.upd)}`;
      if (isLast && r.status === 'failed') {
        const c = r.err!.cause;
        if (r.err!.cls === 'rate_limited') { status = 'error'; errCode = 'rate_limit'; tok = { in: rint(3000, 9000), cr: rint(0, 40_000), cw: rint(1000, 4000), out: rint(80, 400) }; outcome = 'error'; }
        else if (c === 'timeout') { status = 'timeout'; errCode = 'timeout'; outcome = 'timeout'; }
        else if (c === 'cost_cap') { status = 'error'; errCode = 'aborted'; outcome = 'cost_cap'; }
        else { status = 'error'; errCode = c === 'max_turns' ? 'transient' : 'mcp_failed'; outcome = 'error'; }
      }
      if (isLast && r.status === 'cancelled') { status = 'error'; errCode = 'cancelled'; outcome = 'cancelled'; }
      if (isLast && r.status === 'partial') { status = 'error'; errCode = 'transient'; outcome = 'partial'; }
      const c = push({ purpose: p.purpose, model: p.model, skill: p.skillKey, startMs: t0, tok, latencyMs: status === 'timeout' ? Math.min(lat, 300_000) : lat, status, errCode, runKey: r.key, jobKey: jk, budget: r.budget, trigger: trigOf(r), outcome, modelReason: 'default', rolled: r.rolled });
      if (r.story === 'slack-backfill-cap' || r.err?.cause === 'cost_cap') c.fixed = true;
    });
  }

  // ── jobs that call the model ────────────────────────────────────────────────────────────────────
  const jt = (kind: string) => jobs.filter((j) => j.kind === kind && j.status !== 'queued');
  let esc = 0;
  for (const j of jt('completion.check')) {
    if (j.status === 'dead') continue;
    const n = rint(2, 4);
    for (let i = 0; i < n; i++) {
      const stronger = j.finishedMs! > D0 && esc < 12 && i === n - 1 && R.chance(0.6);
      if (stronger) esc++;
      push({ purpose: 'done_match', model: stronger ? SONNET : HAIKU, skill: 'check-completion', startMs: j.startedMs! + 2000 + i * rint(3000, 9000), tok: tokens('judge', stronger ? 1.4 : 1), jobKey: j.key, trigger: j.payload.trigger === 'hook' ? 'file_watch' : 'schedule', modelReason: stronger ? 'escalation:unclear' : 'default', outcome: R.pick(['verdict:done', 'verdict:open', 'verdict:waiting', 'verdict:unclear']), } as any);
    }
  }
  for (const j of jt('settle.check')) {
    if (j.result?.status === 'deferred_budget') {
      const c = push({ purpose: 'other', model: HAIKU, skill: 'settle-item', startMs: j.startedMs! + 1200, tok: tokens('small'), jobKey: j.key, status: 'budget_blocked', errCode: 'cost_cap', trigger: 'interval', outcome: 'blocked:hard_cap' }); c.fixed = true; continue;
    }
    if (j.result?.status === 'nothing_to_do') continue;
    const n = rint(1, 3);
    for (let i = 0; i < n; i++) {
      const stronger = j.finishedMs! > D0 && R.chance(0.2);
      push({ purpose: 'other', model: stronger ? SONNET : HAIKU, skill: 'settle-item', startMs: j.startedMs! + 3000 + i * rint(5000, 20_000), tok: tokens('judge', stronger ? 1.8 : 1.2), jobKey: j.key, trigger: j.payload.trigger, modelReason: stronger ? 'escalation:unclear' : 'default', outcome: R.pick(['verdict:done', 'verdict:open', 'status_only', 'ready']) });
    }
  }
  for (const j of jt('activity.suggest')) for (let i = 0; i < rint(1, 3); i++) push({ purpose: 'classify', model: HAIKU, skill: 'nba-log-activity', startMs: j.startedMs! + 1500 + i * 6000, tok: tokens('judge', 0.8), jobKey: j.key, trigger: j.payload.trigger, outcome: `suggestions:${rint(1, 4)}` });
  const nbaSkills: Array<[string, string]> = [['nba-reply', SONNET], ['nba-nudge', HAIKU], ['nba-log-activity', HAIKU], ['nba-update-vdp', SONNET], ['nba-schedule', HAIKU], ['nba-review-deliverable', SONNET]];
  for (const j of jt('nba.generate')) {
    if (j.status === 'dead') { push({ purpose: 'nba_generate', model: SONNET, skill: 'nba-reply', startMs: j.startedMs! + 3000, tok: tokens('nba'), jobKey: j.key, status: 'timeout', errCode: 'timeout', latencyMs: 300_000, outcome: 'timeout' }); continue; }
    const [skill, model] = R.pick(nbaSkills);
    for (let i = 0; i < rint(2, 4); i++) push({ purpose: 'nba_generate', model: i === 0 ? model : R.chance(0.5) ? model : HAIKU, skill, startMs: j.startedMs! + 1500 + i * rint(4000, 12_000), tok: tokens('nba', model === SONNET ? 1.2 : 0.8), jobKey: j.key, trigger: j.payload.trigger, outcome: R.pick(['ready', 'nothing_new', 'ready', 'draft']) });
  }
  for (const j of jt('readin')) for (let i = 0; i < rint(1, 3); i++) push({ purpose: 'other', model: SONNET, skill: R.chance(0.7) ? 'readin-ask' : 'readin-meeting', startMs: j.startedMs! + 4000 + i * rint(20_000, 50_000), tok: tokens('readin'), jobKey: j.key, trigger: j.payload.trigger, modelReason: j.payload.trigger === 'direct_ask' ? 'policy:direct_ask' : 'default', outcome: 'ready' });
  for (const j of jt('enrich')) { push({ purpose: 'enrich', model: HAIKU, skill: 'enrich-capture', startMs: j.startedMs! + 1500, tok: tokens('small', 1.6), jobKey: j.key, trigger: 'manual', outcome: 'intents:2' }); push({ purpose: 'enrich', model: SONNET, skill: 'enrich-capture', startMs: j.startedMs! + 6000, tok: tokens('nba', 0.8), jobKey: j.key, trigger: 'manual', modelReason: 'default', outcome: 'rank:3' }); }
  for (const j of jt('vdp.identity')) for (let i = 0; i < rint(1, 2); i++) push({ purpose: 'resolve_entity', model: HAIKU, skill: 'vdp-company-identity', startMs: j.startedMs! + 2000 + i * 5000, tok: tokens('judge', 0.9), jobKey: j.key, trigger: 'candidate', outcome: R.pick(['parent', 'subsidiary', 'unsure']) });
  for (const j of jt('brief.generate')) if ((j.result?.briefs ?? 0) > 0) for (let i = 0; i < Math.min(2, j.result!.briefs); i++) push({ purpose: 'summarize', model: i === 0 ? HAIKU : SONNET, skill: i === 0 ? 'brief-channel' : 'brief-opportunity', startMs: j.startedMs! + 3000 + i * 20_000, tok: tokens('brief', i ? 1.1 : 1), jobKey: j.key, trigger: 'schedule', outcome: `highlights:${rint(2, 6)}` });
  for (const j of [...jt('vdp.specialist_aes'), ...jt('accounts.hierarchy')]) if (R.chance(0.7)) push({ purpose: 'other', model: HAIKU, skill: 'read-lookup', startMs: j.startedMs! + 2000, tok: tokens('small'), jobKey: j.key, trigger: 'schedule', outcome: `rows:${rint(8, 24)}` });
  for (const j of jt('missed_opps.sweep')) if (R.chance(0.45)) push({ purpose: 'other', model: HAIKU, skill: 'read-lookup', startMs: j.startedMs! + 2000, tok: tokens('small'), jobKey: j.key, trigger: 'schedule', outcome: `rows:${rint(10, 30)}` });

  // calls refused by the hard cap on 2026-11-10 (12:42 - 13:08 MT): the job asked, the budget said no
  const skillOfKind: Record<string, string> = { 'scan.slack': 'scan-slack', 'scan.gmail': 'scan-gmail', 'scan.org62': 'scan-org62', 'scan.claude_sessions': 'scan-claude-sessions', 'scan.drive': 'scan-drive', 'scan.calendar': 'scan-calendar', 'scan.gemini_notes': 'scan-gemini-notes' };
  for (const j of jobs.filter((x) => x.tag === 'paused').slice(0, 6)) {
    const c = push({ purpose: 'scan_extract', model: HAIKU, skill: skillOfKind[j.kind] ?? 'scan-slack', startMs: j.startedMs! + 300, tok: tokens('small'), jobKey: j.key, status: 'budget_blocked', errCode: 'cost_cap', trigger: 'schedule', outcome: 'blocked:hard_cap' });
    c.fixed = true;
  }

  // ── hand-placed story calls ─────────────────────────────────────────────────────────────────────
  // chat (14): the owner asks the assistant things; each is the model call behind one assistant message
  const chatTimes: Array<[number, string, string]> = [
    [-12, '15:44', 'chat: reweight priorities (policy v2)'], [-12, '15:49', 'chat: reweight priorities (policy v2)'], [-12, '15:58', 'chat: apply policy v2'], [-9, '16:20', 'chat: log last week'],
    [-6, '10:15', 'chat: identity merge question'], [-6, '10:19', 'chat: identity merge answer'], [-4, '09:05', 'chat: why were some Slack items late on 11-12'],
    [-2, '13:10', 'chat: Saltmere blueprint outline'], [-2, '13:16', 'chat: Saltmere blueprint outline'], [-1, '07:48', 'chat: plan the day'], [-1, '07:52', 'chat: plan the day'], [0, '08:44', 'chat: what is due this week'], [0, '08:47', 'chat: what is due this week'], [0, '08:51', 'chat: what is due this week'],
  ];
  chatTimes.forEach(([d, hh, note], i) => {
    const key = `llm-chat-${String(i + 1).padStart(2, '0')}`;
    const startMs = atMs(d, hh) + rint(0, 40) * 1000;
    push({ purpose: 'chat', model: SONNET, skill: 'chat-assistant', startMs, tok: tokens('chat', 1 + R.next() * 0.8), chatMsgKey: key, trigger: 'user_message', outcome: 'answered', modelReason: i === 12 ? 'user_asked' : 'default', latencyMs: rint(9_000, 38_000) });
    chatNotes.push({ key, note, at: iso(startMs) });
  });
  // identity merge (storyline 10) at 2026-11-12 10:18-10:20 MT
  for (let i = 0; i < 3; i++) push({ purpose: 'merge_check', model: HAIKU, skill: 'detect-identity', startMs: atMs(-6, '10:16') + i * 40_000, tok: tokens('small', 1.4), trigger: 'manual', outcome: i === 2 ? 'same_person' : 'likely_same' });
  for (let i = 0; i < 3; i++) push({ purpose: 'merge_check', model: HAIKU, skill: 'detect-identity', startMs: atMs(R.pick([-20, -14, -3]), '11:30') + i * 40_000, tok: tokens('small', 1.2), trigger: 'candidate', outcome: R.pick(['different', 'unsure', 'different']) });
  for (let i = 0; i < 6; i++) push({ purpose: 'priority_explain', model: HAIKU, skill: null, startMs: atMs(-R.int(0, 12), '07:35') + rint(0, 40) * MIN, tok: tokens('small', 1.2), trigger: 'priority_run', outcome: 'explained' });

  // draft_generate (40): drafts the owner/engine wrote (domain 05 points its drafts.llm_call_id at these)
  const nbaJobs = jt('nba.generate').filter((j) => j.status === 'succeeded');
  for (let i = 0; i < 40; i++) {
    const tied = i < 16 ? nbaJobs[i % nbaJobs.length]! : undefined;
    const d = tied ? 0 : R.pick([-25, -22, -20, -19, -16, -15, -14, -13, -12, -11, -10, -9, -7, -6, -5, -4, -3, -2, -1]);
    const t0 = tied ? tied.startedMs! + 14_000 + i * 700 : atMs(d, '08:10') + rint(0, 8 * 60) * MIN;
    const email = R.chance(0.35);
    push({ purpose: 'draft_generate', model: SONNET, skill: email ? 'draft-email' : 'draft-slack', startMs: t0, tok: tokens('draft', email ? 1.3 : 0.9), jobKey: tied?.key, trigger: tied ? 'nba' : R.pick(['user_clicked', 'user_clicked', 'reevaluate']), outcome: R.pick(['ready', 'ready', 'ready', 'edited_hint']), modelReason: 'default' });
  }
  // a few failures among drafts and chat
  const refusedIdx = calls.findIndex((c) => c.purpose === 'draft_generate' && c.startMs > D0);
  if (refusedIdx >= 0) { const c = calls[refusedIdx]!; c.status = 'refused'; c.errCode = 'refusal'; c.tok.out = 40; c.outcome = 'refused'; }
  // retained first-scan calls: the rolled-up days keep every sixth call whole (something still points at it)
  let rn = 0;
  for (const c of [...calls].sort((x, y) => x.startMs - y.startMs)) if (c.rolled && rn++ % 6 === 0) c.rolled = false;
  const live = () => calls.filter((c) => !c.rolled).length;
  // read-lookup top-up / trim to land on exactly 700 individual rows
  const target = 700;
  const protectedP = new Set(['chat', 'merge_check', 'priority_explain']);
  while (live() < target) {
    const d = R.pick([-27, -25, -24, -21, -20, -18, -17, -15, -13, -12, -11, -10, -7, -6, -5, -4, -3, -2, -1]);
    push({ purpose: 'other', model: HAIKU, skill: 'read-lookup', startMs: atMs(d, '08:00') + rint(0, 9 * 60) * MIN, tok: tokens('small'), trigger: R.pick(['direct_ask', 'schedule']), outcome: `rows:${rint(1, 20)}` });
  }
  if (live() > target) {
    const droppable = R.shuffle(calls.filter((c) => !c.rolled && !c.fixed && !protectedP.has(c.purpose) && !c.runKey && c.purpose !== 'draft_generate' && c.status === 'ok'));
    let over = live() - target;
    while (over > 0 && droppable.length) { const x = droppable.pop()!; calls.splice(calls.indexOf(x), 1); over--; }
    if (over > 0) throw new Error(`llm calls over target by ${over}`);
  }
  // keep retained first-scan calls: rolled ones do not become llm_calls rows
  void jobId; void sha; void ref; void skillVersion; void r6; void mtDay;
  return calls;
}
export const chatNotes: Array<{ key: string; note: string; at: string }> = [];

/** Scale the token counts of `set` so their summed cost lands on `target` (k bounded). */
export function scaleTo(set: CallT[], target: number, maxK = 3): void {
  if (!set.length) return;
  const orig = set.map((c) => ({ ...c.tok }));
  const total = (k: number) => set.reduce((sum, c, i) => sum + callCost(c.model, { in: Math.round(orig[i]!.in * k), out: Math.round(orig[i]!.out * k), cr: Math.round(orig[i]!.cr * k), cw: Math.round(orig[i]!.cw * k) }), 0);
  let lo = 0.05; let hi = 60;
  for (let i = 0; i < 44; i++) { const mid = (lo + hi) / 2; if (total(mid) < target) lo = mid; else hi = mid; }
  const k = Math.max(0.3, Math.min(maxK, (lo + hi) / 2));
  set.forEach((c, i) => { c.tok = { in: Math.round(orig[i]!.in * k), out: Math.round(orig[i]!.out * k), cr: Math.round(orig[i]!.cr * k), cw: Math.round(orig[i]!.cw * k) }; });
}
/** Calibrate the daily-budget calls starting in [from, to) to a day total; calls marked `fixed` keep their cost. */
export function calibrate(calls: CallT[], from: number, to: number, target: number, maxK = 3): void {
  const all = calls.filter((c) => c.budget === 'daily' && c.startMs >= from && c.startMs < to && c.status !== 'budget_blocked');
  const fixedSum = all.filter((c) => c.fixed).reduce((s, c) => s + callCost(c.model, c.tok), 0);
  scaleTo(all.filter((c) => !c.fixed), Math.max(0.05, target - fixedSum), maxK);
}
