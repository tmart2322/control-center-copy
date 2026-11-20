/**
 * History (B-081): the pure composer both DataSources share. It turns stored records into the calendar summary
 * (GET /history) and one day's record (GET /history/:day). No I/O and no clock: callers pass the collections, the
 * closures their log knows about, the profile time zone and `now`.
 *
 * What counts (docs/TENETS.md, the Time page's rules):
 *   finished   a work item's close: the record's own (state done, doneAt) plus earlier closes from the log
 *              (work_item_transitions in db, the audit trail in the mock) that were not undone; an undone close
 *              never shows, and a close the item has since been reopened from shows as "reopened since"
 *   hours      activity rows of that day that are not dismissed or upcoming: human hours only. Agent time is a
 *              background lane (run minutes), and focus / Drive / Slack blocks not in the log are signals, shown
 *              and never counted, so overlapping signals are never double-counted
 *   meetings   calendar events that start that day, not cancelled or declined; "held" = attended or in progress
 *   sent       draft dispatch attempts that day; a dry run is a dry run (rendered, nothing left)
 *   runs       agent runs (Claude sessions, app runs, tool-run mirrors) whose run overlaps the day
 *   org62      activity rows synced to the canvas, logged, verified or failing read-back, by when that happened
 *   arrived    work items created that day
 * Days are local days in the profile zone (DST-safe via Intl, src/engines/home/time.ts).
 */
import type {
  Account,
  ActivityEntry,
  AgentRun,
  CalendarEvent,
  Draft,
  HistoryArrival,
  HistoryClosedBy,
  HistoryDay,
  HistoryDaySummary,
  HistoryFinished,
  HistoryHoursGroup,
  HistoryMeeting,
  HistoryMonth,
  HistoryOrg62,
  HistoryRun,
  HistorySend,
  HistoryTime,
  HistoryTotals,
  OnsiteDay,
  Resolution,
  TimelineBlock,
  WorkItemRecord,
} from '@/contract';
import { atLocal, dayKey, longDate } from '@/engines/home/time';
import { actionApp } from '@/lib/actions';

export type HistoryTimeBlock = TimelineBlock & { lane: 'meetings' | 'focus' | 'claude' | 'drive' | 'slack' };

/** A close the log knows about (not undone). The record's current close is read from the record itself. */
export interface HistoryClosure {
  itemId: string;
  at: string;
  by: HistoryClosedBy;
}

export interface HistorySources {
  timezone: string;
  now: Date;
  workItems: WorkItemRecord[];
  accounts: Pick<Account, 'id' | 'name'>[];
  activity: ActivityEntry[];
  timeBlocks: HistoryTimeBlock[];
  events: CalendarEvent[];
  drafts: Draft[];
  agentRuns: AgentRun[];
  /** Closes from the log (db: work_item_transitions to done, not undone; mock: the audit trail). */
  pastClosures: HistoryClosure[];
  /** When an activity row reached the canvas / Org62 (db: the stamp columns). Absent: the row's updatedAt. */
  org62At?: Map<string, string>;
  /** The days' onsite chips (onsite lane; db: the projections' week records). */
  onsite?: OnsiteDay[];
}

/** History's groups with no account (last on ties): no account yet, and internal-only work (D-64). */
const QUIET_GROUP = new Set(['No account', 'Internal']);
const MIN_MS = 60_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

// ── Days ────────────────────────────────────────────────────────────────────────────────────

const ymd = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};
const parts = (day: string) => day.split('-').map(Number) as [number, number, number];

export function addDay(day: string, n: number): string {
  const [y, m, d] = parts(day);
  return ymd(y, m, d + n);
}

/** Local midnight of `day` and of the day after (epoch ms), in `tz`. */
export function dayWindow(day: string, tz: string): { from: number; to: number } {
  const [y, m, d] = parts(day);
  const next = parts(addDay(day, 1));
  return { from: atLocal(y, m, d, 0, 0, tz), to: atLocal(next[0], next[1], next[2], 0, 0, tz) };
}

/** 0 = Monday … 6 = Sunday. */
const isoWeekday = (day: string) => {
  const [y, m, d] = parts(day);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
};

export function monthOf(day: string): string {
  return day.slice(0, 7);
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The month grid: Monday on or before the 1st → Sunday on or after the last day. */
export function monthGrid(month: string): { first: string; last: string; gridStart: string; gridEnd: string } {
  const first = `${month}-01`;
  const last = addDay(`${shiftMonth(month, 1)}-01`, -1);
  return { first, last, gridStart: addDay(first, -isoWeekday(first)), gridEnd: addDay(last, 6 - isoWeekday(last)) };
}

function daysFrom(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 400; d = addDay(d, 1)) out.push(d);
  return out;
}

const ms = (iso: string) => Date.parse(iso);
const round2 = (h: number) => Math.round(h * 100) / 100;
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ── Facts ───────────────────────────────────────────────────────────────────────────────────
// Every section is computed once per request over the whole window, then bucketed by local day.

const HUMAN_EXCLUDED = new Set(['dismissed', 'upcoming']);
const LOGGED = new Set(['logged', 'verified']);
const APPROVED = new Set(['approved', 'synced_to_canvas']);
const ORG62 = new Set(['synced_to_canvas', 'logged', 'verified', 'verify_failed']);
const LIVE_RUN = new Set(['queued', 'running', 'waiting_on_you']);

/** Close reasons the verbs write from the resolution itself ("Marked done by you", "Handed off → Kim"): the label says it already. */
const GENERATED_REASON = /^(Marked done by you|Done by you|Confirmed done|Handed off( → .+)?|Done by .+|Not needed|Duplicate|Declined|Superseded)$/;

const byOf = (doneBy: WorkItemRecord['doneBy']): HistoryClosedBy => (doneBy === 'user' ? 'you' : doneBy === 'engine' ? 'engine' : doneBy === 'chat' ? 'chat' : 'other');

function resolutionLabel(res: Resolution | null, personName: string | undefined): string | null {
  switch (res) {
    case 'handed_off':
      return personName ? `Handed off → ${personName}` : 'Handed off';
    case 'done_by_other':
      return personName ? `Done by ${personName}` : 'Done by someone else';
    case 'not_needed':
      return 'Not needed';
    case 'duplicate':
      return 'Duplicate';
    case 'declined':
      return 'Declined';
    case 'superseded':
      return 'Superseded';
    default:
      return null;
  }
}

function closeLabel(by: HistoryClosedBy, res: Resolution | null, personName: string | undefined): string {
  const r = resolutionLabel(res, personName);
  if (by === 'engine') return r ? `Closed for you · ${r}` : 'Closed for you';
  if (by === 'chat') return r ? `Closed from chat · ${r}` : 'Closed from chat';
  if (r) return r;
  return by === 'you' ? 'Done by you' : 'Closed';
}

interface Facts {
  finished: HistoryFinished[];
  activity: ActivityEntry[];
  blocks: HistoryTimeBlock[];
  meetings: HistoryMeeting[];
  sent: HistorySend[];
  runs: Array<HistoryRun & { endMs: number }>;
  org62: HistoryOrg62[];
  arrived: HistoryArrival[];
}

function collect(src: HistorySources, from: number, to: number): Facts {
  const tz = src.timezone;
  const nowMs = src.now.getTime();
  const inWin = (iso: string | null | undefined) => !!iso && ms(iso) >= from && ms(iso) < to;
  const accountName = new Map(src.accounts.map((a) => [a.id, a.name]));
  const items = new Map(src.workItems.map((w) => [w.id, w]));

  // finished: the record's current close, then earlier closes from the log (deduped per item and local day)
  const finished = new Map<string, HistoryFinished>();
  const put = (f: HistoryFinished) => {
    const key = `${f.itemId}|${dayKey(ms(f.at), tz)}`;
    const cur = finished.get(key);
    // the record's own close wins over a log close; between two of a kind, the later one
    if (!cur || (cur.reopenedSince && !f.reopenedSince) || (cur.reopenedSince === f.reopenedSince && ms(f.at) > ms(cur.at))) finished.set(key, f);
  };
  for (const w of src.workItems) {
    if (w.state !== 'done' || !w.doneAt || !inWin(w.doneAt)) continue;
    const by = byOf(w.doneBy);
    put({
      itemId: w.id,
      title: w.title,
      kind: w.kind,
      at: w.doneAt,
      by,
      resolution: w.resolution,
      label: closeLabel(by, w.resolution, w.resolutionDetail?.personName),
      why: w.closedReason && (by === 'engine' || !GENERATED_REASON.test(w.closedReason)) ? w.closedReason : null,
      accountId: w.accountId,
      accountName: w.accountId ? (accountName.get(w.accountId) ?? null) : null,
      reopenedSince: false,
    });
  }
  for (const c of src.pastClosures) {
    const w = items.get(c.itemId);
    if (!w || !inWin(c.at)) continue;
    const current = w.state === 'done' && w.doneAt ? w.doneAt : null;
    if (current && ms(current) === ms(c.at)) continue; // the record's own close, already listed
    if (current && dayKey(ms(current), tz) === dayKey(ms(c.at), tz)) continue; // closed again the same day: one row
    // still done but closed later (a reopen in between), or open again now: either way reopened since
    put({
      itemId: w.id,
      title: w.title,
      kind: w.kind,
      at: new Date(ms(c.at)).toISOString(),
      by: c.by,
      resolution: null,
      label: closeLabel(c.by, null, undefined),
      why: null,
      accountId: w.accountId,
      accountName: w.accountId ? (accountName.get(w.accountId) ?? null) : null,
      reopenedSince: true,
    });
  }

  // hours: activity rows by their local day (the row's `date`), human only
  const activity = src.activity.filter((a) => {
    const { from: f, to: t } = dayWindow(a.date, tz);
    return f < to && t > from;
  });
  const blocks = src.timeBlocks.filter((b) => ms(b.start) < to && ms(b.end) > from);

  const meetings: HistoryMeeting[] = src.events
    .filter((e) => inWin(e.start) && e.attendance !== 'cancelled' && e.attendance !== 'declined')
    .map((e) => ({
      id: e.id,
      title: e.title,
      start: e.start,
      end: e.end,
      attendance: e.attendance,
      held: e.attendance === 'attended' || e.attendance === 'in_progress',
      isCustomerFacing: e.isCustomerFacing,
      accountId: e.accountId,
      accountName: e.accountId ? (accountName.get(e.accountId) ?? null) : null,
    }));

  const sent: HistorySend[] = [];
  for (const d of src.drafts) {
    const last = d.attempts.length ? d.attempts.reduce((a, b) => (ms(b.at) >= ms(a.at) ? b : a)) : null;
    for (const a of d.attempts) {
      if (!inWin(a.at)) continue;
      const item = d.workItemId ? items.get(d.workItemId) : undefined;
      const dest = d.destination.kind === 'slack' ? d.destination.channelName : d.destination.kind === 'action' ? `${actionApp(d.destination.action)} · ${d.destination.target.label}` : `Email · ${d.destination.subject}`;
      const app = d.destination.kind === 'slack' ? 'Slack' : d.destination.kind === 'action' ? actionApp(d.destination.action) : 'Gmail';
      const outcome: HistorySend['outcome'] = a.dryRun || a.outcome === 'rendered' ? 'dry_run' : a.outcome;
      const verification = a === last && d.verification ? d.verification.state : null;
      const label =
        outcome === 'dry_run'
          ? 'Dry run · nothing was sent'
          : outcome === 'sent'
            ? verification === 'verified'
              ? `Sent · verified in ${app}`
              : verification === 'failed'
                ? `Sent · read-back failed`
                : 'Sent'
            : outcome === 'staged'
              ? `Saved as a ${app} draft`
              : outcome === 'failed'
                ? 'Failed · nothing was sent'
                : 'Not confirmed yet';
      sent.push({
        draftId: d.id,
        attemptId: a.id,
        at: a.at,
        title: item?.title ?? dest,
        destination: dest,
        channel: d.destination.kind,
        mode: a.mode,
        dryRun: outcome === 'dry_run',
        outcome,
        label,
        verification,
        workItemId: d.workItemId,
      });
    }
  }

  const runs: Facts['runs'] = [];
  for (const r of src.agentRuns) {
    if (!r.startedAt) continue; // queued, never ran
    const start = ms(r.startedAt);
    const endMs = Math.max(start, r.finishedAt ? ms(r.finishedAt) : LIVE_RUN.has(r.state) ? Math.max(nowMs, ms(r.updatedAt)) : ms(r.updatedAt));
    if (!(start < to && endMs >= from)) continue;
    runs.push({
      id: r.id,
      kind: r.kind,
      toolRunId: r.toolRunId,
      title: r.title,
      state: r.state,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      agentMin: 0,
      scheduled: r.scheduled,
      workItemId: r.workItemId,
      endMs,
    });
  }

  const org62: HistoryOrg62[] = [];
  for (const a of src.activity) {
    if (!ORG62.has(a.status)) continue;
    const at = src.org62At?.get(a.id) ?? a.updatedAt;
    if (!inWin(at)) continue;
    org62.push({
      activityId: a.id,
      at: new Date(ms(at)).toISOString(),
      status: a.status,
      label: a.status === 'synced_to_canvas' ? 'Synced to the work-order canvas' : a.status === 'logged' ? 'Logged in Org62' : a.status === 'verified' ? 'Verified in Org62' : 'Org62 read-back failed',
      description: a.description,
      workDay: a.date,
      durationH: a.durationH,
      accountName: a.accountName,
    });
  }

  const arrived: HistoryArrival[] = src.workItems
    .filter((w) => inWin(w.createdAt))
    .map((w) => ({
      itemId: w.id,
      title: w.title,
      kind: w.kind,
      state: w.state,
      at: w.createdAt,
      source: w.sources[0]?.kind ?? null,
      accountId: w.accountId,
      accountName: w.accountId ? (accountName.get(w.accountId) ?? null) : null,
    }));

  return { finished: [...finished.values()], activity, blocks, meetings, sent, runs, org62, arrived };
}

// ── Per-day buckets ─────────────────────────────────────────────────────────────────────────

const overlapMin = (aFrom: number, aTo: number, bFrom: number, bTo: number) => Math.max(0, Math.min(aTo, bTo) - Math.max(aFrom, bFrom)) / MIN_MS;

function emptySummary(day: string, inMonth: boolean, today: string): HistoryDaySummary {
  return { day, inMonth, isToday: day === today, future: day > today, finished: 0, yourH: 0, meetings: 0, sent: 0, dryRuns: 0, agentRuns: 0, org62: 0, arrived: 0, active: false };
}

function summarize(f: Facts, days: string[], tz: string, today: string, inMonth: (d: string) => boolean): HistoryDaySummary[] {
  const by = new Map(days.map((d) => [d, emptySummary(d, inMonth(d), today)]));
  const at = (iso: string) => by.get(dayKey(ms(iso), tz));
  for (const x of f.finished) {
    const c = at(x.at);
    if (c) c.finished++;
  }
  for (const a of f.activity) {
    const s = by.get(a.date);
    if (s && !HUMAN_EXCLUDED.has(a.status)) s.yourH += a.durationH;
  }
  for (const m of f.meetings) {
    const c = m.held ? at(m.start) : undefined;
    if (c) c.meetings++;
  }
  for (const s of f.sent) {
    const c = at(s.at);
    if (!c) continue;
    if (s.outcome === 'dry_run') c.dryRuns++;
    else if (s.outcome === 'sent' || s.outcome === 'staged') c.sent++;
  }
  for (const r of f.runs) {
    // a run counts on every day it ran in
    for (let d = dayKey(ms(r.startedAt), tz), n = 0; d <= dayKey(r.endMs, tz) && n < 62; d = addDay(d, 1), n++) {
      const c = by.get(d);
      if (c) c.agentRuns++;
    }
  }
  for (const o of f.org62) {
    const c = at(o.at);
    if (c) c.org62++;
  }
  for (const a of f.arrived) {
    const c = at(a.at);
    if (c) c.arrived++;
  }
  for (const s of by.values()) {
    s.yourH = round2(s.yourH);
    s.active = s.finished + s.meetings + s.sent + s.dryRuns + s.agentRuns + s.org62 + s.arrived > 0 || s.yourH > 0;
  }
  return days.map((d) => by.get(d)!);
}

function totalsOf(days: HistoryDaySummary[]): HistoryTotals {
  const own = days.filter((d) => d.inMonth);
  const sum = (k: keyof Pick<HistoryDaySummary, 'finished' | 'yourH' | 'meetings' | 'sent' | 'dryRuns' | 'agentRuns' | 'org62' | 'arrived'>) => own.reduce((s, d) => s + d[k], 0);
  return {
    finished: sum('finished'),
    yourH: round2(sum('yourH')),
    meetings: sum('meetings'),
    sent: sum('sent'),
    dryRuns: sum('dryRuns'),
    agentRuns: sum('agentRuns'),
    org62: sum('org62'),
    arrived: sum('arrived'),
    activeDays: own.filter((d) => d.active).length,
  };
}

// ── Public ──────────────────────────────────────────────────────────────────────────────────

export function todayIn(now: Date, tz: string): string {
  return dayKey(now.getTime(), tz);
}

/** GET /history?month: one summary per day of the month grid. */
export function composeHistoryMonth(src: HistorySources, month?: string): HistoryMonth {
  const tz = src.timezone;
  const today = todayIn(src.now, tz);
  const m = month ?? monthOf(today);
  const g = monthGrid(m);
  const from = dayWindow(g.gridStart, tz).from;
  const to = dayWindow(g.gridEnd, tz).to;
  const days = summarize(collect(src, from, to), daysFrom(g.gridStart, g.gridEnd), tz, today, (d) => d >= g.first && d <= g.last);
  const next = shiftMonth(m, 1);
  const [y, mm] = m.split('-').map(Number) as [number, number];
  return {
    month: m,
    label: `${MONTHS[mm - 1]} ${y}`,
    timezone: tz,
    today,
    gridStart: g.gridStart,
    gridEnd: g.gridEnd,
    prevMonth: shiftMonth(m, -1),
    nextMonth: `${next}-01` > today ? null : next,
    days,
    totals: totalsOf(days),
  };
}

/** GET /history/:day: everything that was done on one local day. */
export function composeHistoryDay(src: HistorySources, day: string): HistoryDay {
  const tz = src.timezone;
  const today = todayIn(src.now, tz);
  const { from, to } = dayWindow(day, tz);
  const f = collect(src, from, to);
  const [summary] = summarize(f, [day], tz, today, () => true);

  const mine = f.activity.filter((a) => a.date === day);
  const counted = mine.filter((a) => !HUMAN_EXCLUDED.has(a.status));
  const sumH = (rows: ActivityEntry[]) => round2(rows.reduce((s, a) => s + a.durationH, 0));
  const groups = new Map<string, HistoryHoursGroup>();
  for (const a of counted) {
    // D-64: internal-only work has no account by design: its own group
    const label = a.accountName ?? (a.internal ? 'Internal' : 'No account');
    const g = groups.get(label) ?? { label, hours: 0, cfH: 0, crH: 0 };
    g.hours += a.durationH;
    if (a.meetingType === 'CF') g.cfH += a.durationH;
    if (a.meetingType === 'CR') g.crH += a.durationH;
    groups.set(label, g);
  }
  const signal = (lane: HistoryTimeBlock['lane'], unloggedOnly: boolean) =>
    Math.round(f.blocks.filter((b) => b.lane === lane && (!unloggedOnly || !b.activityId)).reduce((s, b) => s + overlapMin(ms(b.start), ms(b.end), from, to), 0));
  const runs = f.runs
    .map(({ endMs, ...r }) => ({ ...r, agentMin: Math.round(overlapMin(ms(r.startedAt), endMs, from, to)) }))
    .sort((a, b) => byText(a.startedAt, b.startedAt) || byText(a.title, b.title));
  const time: HistoryTime = {
    yourH: sumH(counted),
    cfH: sumH(counted.filter((a) => a.meetingType === 'CF')),
    crH: sumH(counted.filter((a) => a.meetingType === 'CR')),
    unmarkedH: sumH(counted.filter((a) => !a.meetingType)),
    loggedH: sumH(counted.filter((a) => LOGGED.has(a.status))),
    approvedH: sumH(counted.filter((a) => APPROVED.has(a.status))),
    toReviewH: sumH(counted.filter((a) => !LOGGED.has(a.status) && !APPROVED.has(a.status))),
    byAccount: [...groups.values()]
      .map((g) => ({ ...g, hours: round2(g.hours), cfH: round2(g.cfH), crH: round2(g.crH) }))
      .sort((a, b) => b.hours - a.hours || (QUIET_GROUP.has(a.label) ? 1 : QUIET_GROUP.has(b.label) ? -1 : byText(a.label, b.label))),
    entries: mine
      .map((a) => ({ id: a.id, start: a.start, end: a.end, durationH: a.durationH, description: a.description, status: a.status, meetingType: a.meetingType, taskType: a.taskType, accountName: a.accountName, oppName: a.oppName }))
      .sort((a, b) => byText(a.start, b.start) || byText(a.description, b.description)),
    signals: { focusMin: signal('focus', true), driveMin: signal('drive', true), slackMin: signal('slack', true) },
    agentMin: runs.reduce((s, r) => s + r.agentMin, 0),
  };

  return {
    day,
    label: longDate(from + 12 * 3_600_000, tz),
    timezone: tz,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    isToday: day === today,
    future: day > today,
    prevDay: addDay(day, -1),
    nextDay: addDay(day, 1) > today ? null : addDay(day, 1),
    summary: summary!,
    finished: f.finished.sort((a, b) => byText(a.at, b.at) || byText(a.title, b.title)),
    time,
    meetings: f.meetings.sort((a, b) => byText(a.start, b.start) || byText(a.title, b.title)),
    sent: f.sent.sort((a, b) => byText(a.at, b.at) || byText(a.title, b.title)),
    runs,
    org62: f.org62.sort((a, b) => byText(a.at, b.at) || byText(a.description, b.description)),
    arrived: f.arrived.sort((a, b) => byText(a.at, b.at) || byText(a.title, b.title)),
    onsite: src.onsite?.find((d) => d.day === day) ?? null,
  };
}
