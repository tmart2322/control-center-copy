/** Domain 03: the 160 scan runs (explicit story runs + a seeded fill), ordered by start time. */
import { rng } from '../../lib/kit';
import { CONN, DAY, HOUR, MIN, NOW_MS, atMs, dowOf, errText, isWeekdayOff, mtDay, slackScope, SLACK_CHANNELS, tms, type ConnKey, type ErrClass } from './ops-lib';

export type RunStatus = 'succeeded' | 'partial' | 'failed' | 'cancelled';
export type PMode = 'incremental' | 'head' | 'backfill' | 'continuation' | 'manual' | 'retry' | 'targeted';
export interface RunT {
  key: string;
  conn: ConnKey;
  scope: string | null; // bare scope ('inbox', 'channel:C0SMPL001'); null for reconcile runs
  mode: 'incremental' | 'backfill' | 'reconcile';
  pmode: PMode;
  trigger: 'schedule' | 'startup_catchup' | 'manual' | 'chat' | 'hook' | 'reconcile';
  startMs: number;
  durMs: number;
  status: RunStatus;
  err?: { cls: ErrClass; msg: string; cause: string };
  budget: 'daily' | 'first_scan';
  retryOfKey?: string;
  rolled: boolean; // its LLM calls were rolled up into llm_call_days (first-scan days)
  finishPin?: number;
  costCap: number;
  story?: string;
  reconcilePass?: string;
}

const R = rng('ops-runs');
const FIRST_SCAN_END = atMs(-27, '00:00'); // 2026-10-21 00:00 MT: calls before this are rolled up
let seq = 0;
const k = (p: string) => `${p}-${String(++seq).padStart(3, '0')}`;

interface Opt { pmode?: PMode; trigger?: RunT['trigger']; status?: RunStatus; err?: RunT['err']; budget?: 'first_scan'; dur?: number; cap?: number; story?: string; pin?: number; mode?: RunT['mode']; retryOf?: string; recPass?: string }
function mk(conn: ConnKey, scope: string | null, startMs: number, o: Opt = {}): RunT {
  const mode = o.mode ?? (o.pmode === 'backfill' ? 'backfill' : 'incremental');
  const trigger = o.trigger ?? (mode === 'backfill' ? 'startup_catchup' : mode === 'reconcile' ? 'reconcile' : conn === 'claude' ? 'hook' : 'schedule');
  const durBase: Record<ConnKey, [number, number]> = { slack: [90, 400], 'gmail-work': [60, 220], 'gmail-shared': [50, 160], drive: [80, 300], calendar: [30, 110], 'gemini-notes': [60, 220], org62: [60, 280], claude: [40, 180], vdp: [15, 55] };
  const [lo, hi] = durBase[conn];
  let dur = o.dur ?? R.int(lo, hi) * 1000;
  if (mode === 'backfill' && !o.dur) dur *= 3;
  const status = o.status ?? 'succeeded';
  return {
    key: k('run'), conn, scope, mode, pmode: o.pmode ?? (mode === 'reconcile' ? 'incremental' : trigger === 'manual' ? 'manual' : 'incremental'), trigger, startMs, durMs: dur, status, err: o.err,
    budget: o.budget ?? 'daily', rolled: startMs < FIRST_SCAN_END && startMs > atMs(-31, '00:00') && !!o.budget, finishPin: o.pin, costCap: o.cap ?? (mode === 'backfill' ? 2.5 : 0.6), story: o.story, retryOfKey: o.retryOf, reconcilePass: o.recPass,
  };
}
const A = (off: number, hhmm: string) => atMs(off, hhmm);
const err = (cls: ErrClass, sk: string, i = 0) => errText(cls, sk, i);

export function planRuns(): RunT[] {
  const runs: RunT[] = [];
  const push = (r: RunT) => { runs.push(r); return r; };
  const FS = { budget: 'first_scan' as const, trigger: 'startup_catchup' as const };

  // ── first scan: 24h head chunks, then older chunks (10-19 .. 10-21) ─────────────────────────────
  const first: Array<[number, string, ConnKey, string, PMode, boolean?]> = [
    [-30, '07:41', 'gmail-work', 'inbox', 'head'], [-30, '07:44', 'slack', 'inbox', 'head'], [-30, '07:52', 'calendar', 'primary', 'head'], [-30, '08:02', 'drive', 'tracked', 'head'],
    [-30, '08:10', 'org62', 'opps', 'head'], [-30, '08:25', 'gemini-notes', 'poll', 'head'], [-30, '08:31', 'claude', 'all', 'head'], [-30, '09:05', 'gmail-work', 'sent', 'head'],
    [-30, '09:40', 'slack', slackScope(1), 'backfill'], [-30, '10:10', 'org62', 'events', 'backfill'], [-30, '10:50', 'gmail-work', 'inbox', 'backfill'], [-30, '11:30', 'slack', slackScope(3), 'backfill'],
    [-29, '07:50', 'slack', slackScope(4), 'backfill'], [-29, '08:20', 'gmail-shared', 'inbox', 'backfill'], [-29, '08:55', 'drive', 'tracked', 'backfill'], [-29, '09:40', 'org62', 'dcs', 'backfill'],
    [-29, '10:30', 'slack', slackScope(2), 'backfill'], [-29, '11:15', 'gmail-work', 'inbox', 'backfill'], [-29, '13:05', 'calendar', 'primary', 'backfill'], [-29, '14:20', 'gemini-notes', 'poll', 'backfill'],
    [-28, '07:55', 'slack', slackScope(5), 'backfill'], [-28, '08:40', 'org62', 'book', 'backfill'], [-28, '09:30', 'slack', slackScope(6), 'backfill'], [-28, '11:00', 'gmail-work', 'sent', 'backfill'],
    [-28, '13:20', 'slack', slackScope(7), 'backfill'], [-28, '14:45', 'claude', 'all', 'backfill'],
  ];
  for (const [off, hh, c, s, pm] of first) {
    const head = pm === 'head';
    push(mk(c, s, A(off, hh), { pmode: pm, budget: 'first_scan', trigger: 'startup_catchup', mode: head ? 'incremental' : 'backfill', story: 'first-scan', cap: head ? 0.8 : 2.0 }));
  }

  // ── VDP cookie lapse 2026-11-04 and the manual rescan after re-auth ─────────────────────────────
  const v1 = push(mk('vdp', 'mine', A(-14, '11:11:20'), { status: 'failed', err: err('auth', 'vdp'), dur: 40_000, story: 'vdp-auth-1104' }));
  push(mk('vdp', 'mine', A(-14, '11:36'), { pmode: 'manual', trigger: 'manual', story: 'vdp-auth-1104', dur: 30_000, retryOf: v1.key }));
  // ── Org62 rate limit 2026-11-05 ─────────────────────────────────────────────────────────────────
  const o1 = push(mk('org62', 'events', A(-13, '10:20'), { status: 'failed', err: err('rate_limited', 'org62'), dur: 55_000, story: 'org62-429' }));
  push(mk('org62', 'events', A(-13, '10:27'), { pmode: 'retry', story: 'org62-429', retryOf: o1.key }));

  // ── Slack deep backfill 2026-11-09 / 11-10 (daily budget; hard cap hit 11-10 12:41) ─────────────
  for (const [hh, ch] of [['14:05', 1], ['14:25', 3], ['14:50', 4], ['15:15', 2], ['15:40', 5], ['16:05', 6], ['16:30', 14]] as Array<[string, number]>) {
    push(mk('slack', slackScope(ch), A(-9, hh), { pmode: 'backfill', story: 'slack-backfill', dur: R.int(380, 760) * 1000 }));
  }
  const cap = (hh: string, ch: number) => push(mk('slack', slackScope(ch), A(-8, hh), { pmode: 'backfill', status: 'failed', err: err('config', 'slack'), story: 'slack-backfill-cap', dur: R.int(520, 840) * 1000 }));
  push(mk('slack', slackScope(1), A(-8, '07:35'), { pmode: 'backfill', story: 'slack-backfill', dur: 640_000 }));
  push(mk('slack', slackScope(3), A(-8, '08:05'), { pmode: 'backfill', story: 'slack-backfill', dur: 590_000 }));
  const c4 = cap('08:40', 4); const c5 = cap('09:20', 5); const c1 = cap('10:05', 1);
  push(mk('slack', slackScope(6), A(-8, '10:50'), { pmode: 'backfill', story: 'slack-backfill', dur: 610_000 }));
  push(mk('slack', slackScope(2), A(-8, '11:30'), { pmode: 'backfill', story: 'slack-backfill', dur: 700_000 }));
  const c14 = cap('12:15', 14);
  // after the raise at 13:12 the capped windows are split and retried
  push(mk('slack', slackScope(4), A(-8, '13:20'), { pmode: 'backfill', story: 'slack-backfill-retry', retryOf: c4.key, dur: 500_000, cap: 2.5 }));
  push(mk('slack', slackScope(5), A(-8, '13:50'), { pmode: 'backfill', story: 'slack-backfill-retry', retryOf: c5.key, dur: 460_000 }));
  push(mk('slack', slackScope(1), A(-8, '14:20'), { pmode: 'backfill', story: 'slack-backfill-retry', retryOf: c1.key, dur: 540_000 }));
  push(mk('slack', slackScope(14), A(-8, '15:00'), { pmode: 'backfill', story: 'slack-backfill-retry', retryOf: c14.key, dur: 420_000 }));
  push(mk('slack', slackScope(3), A(-8, '15:40'), { pmode: 'backfill', story: 'slack-backfill', dur: 380_000 }));

  // ── Slack rate-limit episode 2026-11-12 (degraded 08:35, error 09:05, healthy 10:12) ───────────
  push(mk('slack', 'inbox', A(-6, '08:05'), { story: 'slack-429-ep1' }));
  let prev: RunT | undefined;
  for (const hh of ['08:20', '08:35', '08:50', '09:05']) prev = push(mk('slack', 'inbox', A(-6, hh), { status: 'failed', err: err('rate_limited', 'slack'), dur: 38_000, story: 'slack-429-ep1', retryOf: prev?.key }));
  push(mk('slack', 'inbox', A(-6, '10:12'), { pmode: 'manual', trigger: 'manual', story: 'slack-429-ep1', retryOf: prev?.key }));
  push(mk('slack', null, A(-6, '11:30'), { mode: 'reconcile', trigger: 'reconcile', recPass: 'coverage_gaps', story: 'slack-429-ep1', dur: 190_000 }));

  // ── Drive auth error 2026-11-14 14:10 MT, reconnect, manual rescan ──────────────────────────────
  const d1 = push(mk('drive', 'tracked', A(-4, '14:09:20'), { status: 'failed', err: err('auth', 'drive'), dur: 40_000, pin: tms('2026-11-14T21:10:00.000Z'), story: 'drive-auth' }));
  push(mk('drive', 'tracked', A(-4, '14:55'), { pmode: 'manual', trigger: 'manual', story: 'drive-auth', retryOf: d1.key }));

  // ── reconcile runs ──────────────────────────────────────────────────────────────────────────────
  for (const [off, hh, c, pass] of [[-23, '06:52', 'slack', 'coverage_gaps'], [-16, '06:50', 'gmail-work', 'unlinked'], [-9, '06:55', 'slack', 'stale_active'], [-5, '07:20', 'slack', 'skill_upgrade'], [-2, '06:58', 'gmail-work', 'unlinked'], [-1, '07:02', 'org62', 'stale_active']] as Array<[number, string, ConnKey, string]>) {
    push(mk(c, null, A(off, hh), { mode: 'reconcile', trigger: 'reconcile', recPass: pass, dur: R.int(90, 260) * 1000, story: 'reconcile' }));
  }

  // ── today (2026-11-18, MST): Slack degraded, VDP re-auth, last-success pins per connector ───────
  push(mk('slack', 'inbox', A(0, '08:26:30'), { story: 'today-slack', dur: 90_000, pin: tms('2026-11-18T15:30:00.000Z') }));
  const s1 = push(mk('slack', 'inbox', A(0, '08:35:00'), { status: 'failed', err: err('rate_limited', 'slack'), dur: 30_000, story: 'today-slack', pin: tms('2026-11-18T15:35:30.000Z') }));
  push(mk('slack', 'inbox', A(0, '08:40:20'), { status: 'failed', err: err('rate_limited', 'slack'), dur: 40_000, story: 'today-slack', pin: tms('2026-11-18T15:41:00.000Z'), retryOf: s1.key }));
  const vf = push(mk('vdp', 'mine', A(0, '08:11:40'), { status: 'failed', err: err('auth', 'vdp'), dur: 20_000, pin: tms('2026-11-18T15:12:00.000Z'), story: 'today-vdp' }));
  push(mk('vdp', 'mine', A(0, '08:29:20'), { pmode: 'manual', trigger: 'manual', dur: 40_000, pin: tms('2026-11-18T15:30:00.000Z'), story: 'today-vdp', retryOf: vf.key }));
  for (const [c, s, fin] of [['org62', 'opps', '15:50:00'], ['gmail-work', 'inbox', '15:51:00'], ['claude', 'all', '15:51:00'], ['gmail-shared', 'inbox', '15:52:00'], ['drive', 'tracked', '15:53:00'], ['calendar', 'primary', '15:54:00'], ['gemini-notes', 'poll', '15:55:00']] as Array<[ConnKey, string, string]>) {
    const f = tms(`2026-11-18T${fin}.000Z`);
    const dur = R.int(50, 170) * 1000;
    push(mk(c, s, f - dur, { dur, pin: f, story: 'today-last' }));
  }

  // ── fill: seeded random runs (with designated failures, each retried once) ──────────────────────
  const retryFails: Array<[ConnKey, ErrClass]> = [
    ['org62', 'transient'], ['org62', 'transient'], ['org62', 'transient'], ['drive', 'transient'], ['drive', 'transient'], ['drive', 'transient'], ['gmail-work', 'transient'], ['gmail-work', 'transient'],
    ['gmail-work', 'unknown'], ['gmail-shared', 'transient'], ['calendar', 'transient'], ['gemini-notes', 'transient'], ['gemini-notes', 'unknown'], ['claude', 'transient'], ['slack', 'transient'], ['slack', 'transient'], ['vdp', 'transient'],
  ];
  const cancelled = 4; const partial = 2;
  const M = 160 - runs.length - retryFails.length;
  const dayW: Array<[number, number]> = [];
  for (let off = -27; off <= 0; off++) {
    if (off === -9 || off === -8) { dayW.push([off, 0.5]); continue; }
    const base = isWeekdayOff(off) ? 1 : 0.18;
    const ramp = 0.65 + 0.35 * ((off + 27) / 27);
    dayW.push([off, base * ramp * (off === 0 ? 0.55 : 1)]);
  }
  const connW: Array<[ConnKey, number]> = [['slack', 22], ['claude', 18], ['org62', 14], ['drive', 10], ['gmail-work', 9], ['gmail-shared', 4], ['calendar', 8], ['gemini-notes', 6], ['vdp', 4]];
  const orgScopes: Array<[string, number]> = [['opps', 35], ['events', 25], ['dcs', 12], ['book', 12], ['missed_opps', 16]];
  const chW: Array<[string, number]> = SLACK_CHANNELS.map((c) => [slackScope(c.n), c.w]);
  const fill: RunT[] = [];
  for (let i = 0; i < M; i++) {
    const off = R.weighted(dayW);
    const wk = isWeekdayOff(off);
    let t: number;
    if (wk) {
      const evening = R.chance(0.1);
      const m = evening ? R.int(17 * 60 + 30, 21 * 60 + 30) : R.int(7 * 60 + 40, 17 * 60 + 20);
      t = atMs(off, '00:00') + m * MIN + R.int(0, 59) * 1000;
    } else t = atMs(off, '00:00') + R.int(9 * 60, 14 * 60) * MIN + R.int(0, 59) * 1000;
    if (off === 0) t = atMs(0, '06:45') + R.int(0, 100) * MIN; // before 08:25 MT
    const conn = R.weighted(connW);
    const scope = conn === 'slack' ? (R.chance(0.42) ? 'inbox' : R.weighted(chW)) : conn === 'org62' ? R.weighted(orgScopes) : conn === 'gmail-work' ? (R.chance(0.7) ? 'inbox' : 'sent') : conn === 'gmail-shared' ? 'inbox' : conn === 'calendar' ? 'primary' : conn === 'drive' ? 'tracked' : conn === 'gemini-notes' ? 'poll' : conn === 'claude' ? 'all' : 'mine';
    fill.push(mk(conn, scope, t, { pmode: R.chance(0.45) ? 'head' : 'incremental', trigger: R.chance(0.03) && conn !== 'claude' ? 'manual' : undefined, story: 'fill' }));
  }
  // designate failures: random fill slots of the right connector, then insert a retry shortly after
  const used = new Set<RunT>();
  const pick = (c: ConnKey) => { const pool = fill.filter((f) => f.conn === c && !used.has(f) && (c !== 'drive' || f.startMs < A(-4, '13:00'))); const x = pool.length ? R.pick(pool) : R.pick(fill.filter((f) => !used.has(f))); used.add(x); return x; };
  const retries: RunT[] = [];
  for (const [c, cls] of retryFails) {
    const f = pick(c);
    const sk = CONN[f.conn].scanKind;
    f.status = 'failed'; f.err = errText(cls, sk, R.int(0, 3)); f.durMs = f.err.cause === 'timeout' ? (sk === 'slack' ? 900_000 : 600_000) : Math.min(f.durMs, 120_000); f.story = 'fill-failed';
    const delay = R.pick([60, 120, 240, 300]) * 1000;
    retries.push(mk(f.conn, f.scope, f.startMs + f.durMs + delay, { pmode: 'retry', trigger: f.trigger, story: 'fill-retry', retryOf: f.key }));
  }
  for (let i = 0; i < cancelled; i++) {
    const f = R.pick(fill.filter((x) => !used.has(x) && x.conn !== 'vdp')); used.add(f);
    f.status = 'cancelled'; f.err = { cls: 'transient', msg: i % 2 ? 'cancelled: superseded by a manual rescan of the same scope' : 'cancelled: worker shutting down (SIGTERM)', cause: 'cancelled' }; f.durMs = R.int(8, 60) * 1000; f.story = 'fill-cancelled';
  }
  for (let i = 0; i < partial; i++) {
    const f = R.pick(fill.filter((x) => !used.has(x) && (x.conn === 'slack' || x.conn === 'gmail-work'))); used.add(f);
    f.status = 'partial'; f.err = { cls: 'transient', msg: 'one pass ended without cc_finish; kept the items it had recorded (max_turns 30 reached)', cause: 'max_turns' }; f.story = 'fill-partial';
  }
  runs.push(...fill, ...retries);
  // keep every connector's final run at its pinned time: drop fill runs for a pinned connector after it (except a retry of a later failure)
  const lastPin = new Map<ConnKey, number>();
  for (const r of runs) if (r.finishPin && r.story !== 'drive-auth') lastPin.set(r.conn, Math.max(lastPin.get(r.conn) ?? 0, r.finishPin));
  for (const r of runs) {
    const pin = lastPin.get(r.conn);
    if (pin && !r.finishPin && r.startMs + r.durMs > pin - 2 * MIN) r.startMs = pin - 2 * MIN - r.durMs - R.int(1, 20) * MIN; // slide earlier
  }
  for (const r of runs) if (r.finishPin) r.startMs = r.finishPin - r.durMs;
  runs.sort((a, b) => a.startMs - b.startMs);
  void DAY; void HOUR; void NOW_MS; void dowOf; void mtDay;
  return runs;
}
