/**
 * History (B-081): a calendar of past days; one day shows what was done. Built from stored history only (work-item
 * transitions and the audit trail, activity entries, time blocks, calendar events, draft send attempts, agent and
 * tool runs). Nothing here is a snapshot of how a screen looked (B-082 won't do).
 *
 * Days are local days in `settings.profile.timezone`. Hours are human hours: activity entries that are not
 * dismissed or upcoming (the Time page's rule). Agent time is a background lane, reported apart and never yours.
 */
import { z } from 'zod';
import { AgentRunKind } from './agents';
import { Attendance } from './calendar';
import { ActivityStatus, DispatchMode, Id, IsoDate, IsoDateTime, RunState, SourceKind, WorkKind, WorkState } from './common';
import { OnsiteDay } from './time';
import { Resolution } from './work';

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const HistoryMonthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM');

/** GET /history?month=YYYY-MM (default: this month in the profile zone). */
export const HistoryMonthQuery = z.object({ month: HistoryMonthKey.optional() });
export type HistoryMonthQuery = z.infer<typeof HistoryMonthQuery>;

/** GET /history/:day (a local day, YYYY-MM-DD). */
export const HistoryDayParams = z.object({ day: IsoDate });
export type HistoryDayParams = z.infer<typeof HistoryDayParams>;

// ---------------------------------------------------------------------------
// Calendar (one cell per day)
// ---------------------------------------------------------------------------

/** The light per-day summary a calendar cell shows. Counts only what was done; a quiet day is all zeros. */
export const HistoryDaySummary = z.object({
  day: IsoDate,
  /** Inside the requested month (grid padding days are false). */
  inMonth: z.boolean(),
  isToday: z.boolean(),
  /** After today: nothing can have happened yet. */
  future: z.boolean(),
  /** Work items closed that day (not undone): by you, by the engine ("Closed for you") or from chat. */
  finished: z.number().int().min(0),
  /** Human hours in the activity log that day (not dismissed, not upcoming). Agent time never counts. */
  yourH: z.number().min(0),
  /** Meetings attended (or in progress) that day. */
  meetings: z.number().int().min(0),
  /** Messages that really left (sent, or staged as a draft in Slack or Gmail). */
  sent: z.number().int().min(0),
  /** Dispatches that were dry runs: rendered, nothing left the machine. */
  dryRuns: z.number().int().min(0),
  /** Claude sessions, app runs and tool runs that ran that day. */
  agentRuns: z.number().int().min(0),
  /** Activity rows synced to the canvas, logged or verified in Org62 that day. */
  org62: z.number().int().min(0),
  /** New work items that arrived that day. */
  arrived: z.number().int().min(0),
  /** Anything at all happened (false = a quiet day). */
  active: z.boolean(),
});
export type HistoryDaySummary = z.infer<typeof HistoryDaySummary>;

export const HistoryTotals = z.object({
  finished: z.number().int().min(0),
  yourH: z.number().min(0),
  meetings: z.number().int().min(0),
  sent: z.number().int().min(0),
  dryRuns: z.number().int().min(0),
  agentRuns: z.number().int().min(0),
  org62: z.number().int().min(0),
  arrived: z.number().int().min(0),
  /** Days in the month with anything in them. */
  activeDays: z.number().int().min(0),
});
export type HistoryTotals = z.infer<typeof HistoryTotals>;

export const HistoryMonth = z.object({
  /** YYYY-MM */
  month: HistoryMonthKey,
  /** "November 2026" */
  label: z.string(),
  timezone: z.string(),
  /** Today in the profile zone. */
  today: IsoDate,
  /** The grid: Monday on or before the 1st through the Sunday on or after the last day. */
  gridStart: IsoDate,
  gridEnd: IsoDate,
  prevMonth: HistoryMonthKey,
  /** Null when the next month is in the future. */
  nextMonth: HistoryMonthKey.nullable(),
  days: z.array(HistoryDaySummary),
  /** Totals over the month's own days (grid padding excluded). */
  totals: HistoryTotals,
});
export type HistoryMonth = z.infer<typeof HistoryMonth>;

// ---------------------------------------------------------------------------
// One day
// ---------------------------------------------------------------------------

/** Who or what closed an item. */
export const HistoryClosedBy = z.enum(['you', 'engine', 'chat', 'other']);
export type HistoryClosedBy = z.infer<typeof HistoryClosedBy>;

export const HistoryFinished = z.object({
  itemId: Id,
  title: z.string(),
  kind: WorkKind,
  /** When it was closed. */
  at: IsoDateTime,
  by: HistoryClosedBy,
  resolution: Resolution.nullable(),
  /** "Done by you", "Closed for you", "Handed off to Kim", "Done by Dana", "Not needed" … */
  label: z.string(),
  /** The close reason, when one was recorded ("Dana replied in thread"). */
  why: z.string().nullable(),
  accountId: Id.nullable(),
  accountName: z.string().nullable(),
  /** The item was reopened after this close (it is open again now). */
  reopenedSince: z.boolean(),
});
export type HistoryFinished = z.infer<typeof HistoryFinished>;

export const HistoryActivityRow = z.object({
  id: Id,
  start: IsoDateTime,
  end: IsoDateTime,
  durationH: z.number().min(0),
  description: z.string(),
  status: ActivityStatus,
  meetingType: z.enum(['CF', 'CR']).nullable(),
  taskType: z.string().nullable(),
  accountName: z.string().nullable(),
  oppName: z.string().nullable(),
});
export type HistoryActivityRow = z.infer<typeof HistoryActivityRow>;

export const HistoryHoursGroup = z.object({
  /** Account name, or "No account". */
  label: z.string(),
  hours: z.number().min(0),
  cfH: z.number().min(0),
  crH: z.number().min(0),
});
export type HistoryHoursGroup = z.infer<typeof HistoryHoursGroup>;

export const HistoryTime = z.object({
  /** Human hours: activity rows that are not dismissed or upcoming. */
  yourH: z.number().min(0),
  cfH: z.number().min(0),
  crH: z.number().min(0),
  /** Rows with no CF/CR yet. */
  unmarkedH: z.number().min(0),
  /** In Org62 (logged, verified) · approved (approved, synced to canvas) · to review (proposed, needs input, verify failed). */
  loggedH: z.number().min(0),
  approvedH: z.number().min(0),
  toReviewH: z.number().min(0),
  byAccount: z.array(HistoryHoursGroup),
  /** Every activity row whose day is this day (dismissed and upcoming rows included, flagged by status). */
  entries: z.array(HistoryActivityRow),
  /** Attention signals the time engine saw that are not in the log: shown, never counted. */
  signals: z.object({
    focusMin: z.number().int().min(0),
    driveMin: z.number().int().min(0),
    slackMin: z.number().int().min(0),
  }),
  /** Agent (Claude, app and tool run) minutes that day: a background lane, never your hours. */
  agentMin: z.number().int().min(0),
});
export type HistoryTime = z.infer<typeof HistoryTime>;

export const HistoryMeeting = z.object({
  id: Id,
  title: z.string(),
  start: IsoDateTime,
  end: IsoDateTime,
  attendance: Attendance,
  /** Attended or in progress. */
  held: z.boolean(),
  isCustomerFacing: z.boolean(),
  accountId: Id.nullable(),
  accountName: z.string().nullable(),
});
export type HistoryMeeting = z.infer<typeof HistoryMeeting>;

/** What one dispatch did. `dry_run`: rendered only, nothing left the machine. */
export const HistorySendOutcome = z.enum(['sent', 'staged', 'dry_run', 'failed', 'unconfirmed']);
export type HistorySendOutcome = z.infer<typeof HistorySendOutcome>;

export const HistorySend = z.object({
  draftId: Id,
  /** The dispatch attempt (Outbox approval). */
  attemptId: Id,
  at: IsoDateTime,
  /** The linked item's title, else the destination. */
  title: z.string(),
  /** "#acme-ext", "@Dana Reyes", "Email · Re: DPA redlines". */
  destination: z.string(),
  channel: z.enum(['slack', 'email', 'action']),
  mode: DispatchMode,
  dryRun: z.boolean(),
  outcome: HistorySendOutcome,
  /** "Sent · verified in Slack", "Dry run · nothing was sent", "Saved as a Gmail draft", "Failed" … */
  label: z.string(),
  verification: z.enum(['pending', 'verified', 'unverified', 'failed']).nullable(),
  workItemId: Id.nullable(),
});
export type HistorySend = z.infer<typeof HistorySend>;

export const HistoryRun = z.object({
  /** The AgentRun id (Claude sessions, app runs, and the Agents mirror of a tool run). */
  id: Id,
  kind: AgentRunKind,
  /** Tool runs open their own Details (`tool_run`). */
  toolRunId: Id.nullable(),
  title: z.string(),
  state: RunState,
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
  /** Minutes of this run inside the day (background, never yours). */
  agentMin: z.number().int().min(0),
  scheduled: z.boolean(),
  workItemId: Id.nullable(),
});
export type HistoryRun = z.infer<typeof HistoryRun>;

export const HistoryOrg62 = z.object({
  activityId: Id,
  at: IsoDateTime,
  status: ActivityStatus,
  /** "Synced to the work-order canvas", "Logged in Org62", "Verified in Org62", "Org62 read-back failed". */
  label: z.string(),
  description: z.string(),
  /** The day of the work itself (may be earlier than the day it was logged). */
  workDay: IsoDate,
  durationH: z.number().min(0),
  accountName: z.string().nullable(),
});
export type HistoryOrg62 = z.infer<typeof HistoryOrg62>;

export const HistoryArrival = z.object({
  itemId: Id,
  title: z.string(),
  kind: WorkKind,
  /** State now. */
  state: WorkState,
  at: IsoDateTime,
  source: SourceKind.nullable(),
  accountId: Id.nullable(),
  accountName: z.string().nullable(),
});
export type HistoryArrival = z.infer<typeof HistoryArrival>;

export const HistoryDay = z.object({
  day: IsoDate,
  /** "Tuesday 3 November" */
  label: z.string(),
  timezone: z.string(),
  /** The day's local midnight and the next one (instants). */
  from: IsoDateTime,
  to: IsoDateTime,
  isToday: z.boolean(),
  future: z.boolean(),
  prevDay: IsoDate,
  /** Null when the next day is in the future. */
  nextDay: IsoDate.nullable(),
  summary: HistoryDaySummary,
  finished: z.array(HistoryFinished),
  time: HistoryTime,
  meetings: z.array(HistoryMeeting),
  sent: z.array(HistorySend),
  runs: z.array(HistoryRun),
  org62: z.array(HistoryOrg62),
  arrived: z.array(HistoryArrival),
  /** The day's onsite chip (onsite lane, additive): null on a remote day. */
  onsite: OnsiteDay.nullable().default(null),
});
export type HistoryDay = z.infer<typeof HistoryDay>;
