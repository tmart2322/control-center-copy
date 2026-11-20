/**
 * The Time page for one week: time blocks (meetings, hands-on and agent Claude time, Drive edits, Slack bursts) and
 * activity entries (the engine's proposals plus what Org62 already has), from the week's projected rows. Pure.
 *
 *  1. Evidence → `proposeActivity` (src/engines/activity): blocks with overlap resolution (tenet: Hours are human
 *     hours: meetings win, agent time counts only as the engaged-time model's share), meeting classification, solo
 *     work as engaged time from my own actions (prompts, Slack and email sent, Drive edits; engaged.ts). No caps.
 *     Never hands-off here: approval stays the user's (tenet: Nothing leaves without approval).
 *  2. Read-back (`verifyReadback`): an Org62 Event that matches a row the user approved moves that row to logged /
 *     verified / verify_failed. An Org62 Event that matches a proposal replaces it (the proposal is "already in
 *     Org62"); every other Org62 Event of the week is its own `logged` row. So SE activity already in Org62 shows as
 *     logged, once.
 *  3. Overlaps between rows, by `cfg.overlaps` (D-18 amended). `count_once`: counted rows never overlap: rows the user
 *     owns first, then Org62's, then meetings, then evidence guesses; a later row that would overlap is excluded as
 *     `overlap`, with the reason. `log_all_accepted` (default): the same, except that an accepted meeting and an onsite
 *     frame log even where they overlap other rows (an accepted meeting always logs; an onsite day logs in full); only
 *     a twin (the same row, or an Org62 Event of the same slot) stands in for them. Estimates still yield to them.
 *     The database's exclusion constraint covers non-calendar rows only (migration 0013).
 *  4. D-64: internal-only work (the engine's `internal` rows) has no WhatId, CF / CR off and its internal type. A row
 *     whose source a "Dismiss all from …" rule covers (`dismissRules`: one repo, unmapped Drive docs, a recurring
 *     series) is written `dismissed` with the rule's flag, and never takes time from a row that logs. A meeting I
 *     declined has no row: a row the projection owns simply goes; one I own goes too (`declined`: remove), unless it is
 *     handed off (on a canvas, or in Org62) or waits in a canvas item, which is flagged and never deleted from Org62.
 *  5. D-66: every row the app proposes carries its Org62 Description note (`logNote`): the cheap model's over the
 *     meeting's notes where `activity.notes` made one, else the template over the row's own evidence (the meeting's
 *     title and attendee domains, the sessions, docs and channels, the opp's VDP use case, the notes' next step).
 */
import {
  type ActivityConfig,
  type ActivityEntry as EngineEntry,
  type ActivityMappings,
  type CalendarEvidence,
  type ClaudeEvidence,
  type DriveEvidence,
  type EmailSentEvidence,
  type OnsiteDay,
  type OnsiteOverrides,
  type Org62EventRow,
  type SlackBurstEvidence,
  type SlackMessageEvidence,
  type TimeBlock as EngineBlock,
  type Trip,
  accountByKey,
  addDays,
  CANCELLED_HELD_FLAG,
  CANCELLED_LOGGED_FLAG,
  CANCELLED_MARKER,
  coveredFlag,
  DUPLICATE_MARKER,
  duplicateFlag,
  isRoundTripFlag,
  legacyFlag,
  localDay as localDayMs,
  localHm,
  MANUAL_LOG_NOTE,
  normSubject,
  NOT_IN_ORG62_FLAG,
  overlapInfo,
  RELATED_TO_EMPTY_FLAG,
  RESCHEDULED_MARKER,
  rescheduledFlag,
  sameRelatedTo,
  START_DIFFERS_MARKER,
  DECLINED_HELD_FLAG,
  DECLINED_LOGGED_FLAG,
  DECLINED_MARKER,
  dismissRuleFlag,
  dismissSourceOf,
  isInternalTaskType,
  isRuleDismissal,
  seriesKeyOf,
  finalizeStatus,
  NOT_ON_TEAM_FLAG,
  NOT_ON_TEAM_MARKER,
  overlapModeOf,
  isCF,
  isCR,
  pickUseCase,
  proposeActivity,
  templateNote,
  type NoteFacts,
  type UseCaseOption,
  roundQuarter,
  verifyReadback,
} from '@/engines/activity';

import { driveFileLink, org62RecordUrl } from './links';
import type { SlackMessage } from './types';
import { id15, localDay } from './util';

export const ENGINE_VERSION = 'projections@1';
/** Activity dedupe-key prefixes the projections own (the engine's `cal|` / `wb|` / `onsite|`, and Org62 read-back rows). */
export const OWNED_ACTIVITY_PREFIXES = ['cal|', 'wb|', 'onsite|', 'org62|'];
/** Statuses an owned row may be rewritten or removed in. Anything else (approved and later, dismissed) is the user's. */
export const ENGINE_STATUSES = new Set(['upcoming', 'needs_input', 'proposed', 'excluded', 'dropped', 'logged']);

export interface WeekEvent {
  rowId: string;
  calendarId: string;
  externalEventId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  isAllDay: boolean;
  eventType: string;
  cancelled: boolean;
  myResponse: string;
  iAmOrganizer: boolean;
  attendance: string;
  attendeeDomains: string[];
  recurring: boolean;
  hasNotes: boolean;
  url: string | null;
  accountId: string | null;
  /** The opp the resolver (or the user's mapping) picked for this meeting. */
  oppOrg62Id: string | null;
  /** Where it is (street address, room, airport): onsite days read it. */
  location?: string | null;
  /** All-day events: their first local date and the day after the last (exclusive). */
  allDayFrom?: string | null;
  allDayTo?: string | null;
}

export interface WeekSession {
  rowId: string;
  title: string;
  /** Deep link to the session (Desktop continue link). */
  url?: string | null;
  repoKey: string;
  startedAt: string | null;
  lastActivityAt: string;
  lastHumanPromptAt: string | null;
  /** The account the session is mapped to (claude_sessions.account_id: the resolver over repo, cwd, title; the user's). */
  accountId?: string | null;
  /**
   * Every human prompt with the end of Claude's turn after it (the scanner's `humanTurns`, 2026-11-14). Absent (a
   * session not re-read since): only its first prompt and its latest are known.
   */
  turns?: { at: string; runEndsAt: string }[] | null;
}

/**
 * A session's evidence inside [from, to): its human prompts in the window (each an own action, with Claude's run after
 * it, engaged.ts), else the first and latest prompt we saw; agent time is the last ≤ 4 h before its latest activity,
 * shown as leverage only. Clipped to the window.
 */
export function sessionInWindow(s: WeekSession, from: number, to: number): ClaudeEvidence | null {
  const last = Math.min(Date.parse(s.lastActivityAt), to - 1000);
  const start = s.startedAt ? Date.parse(s.startedAt) : last;
  if (Number.isNaN(last) || last < from || start >= to) return null;
  const inWin = (x: string | null | undefined): x is string => !!x && Date.parse(x) >= from && Date.parse(x) < to;
  const turns = s.turns?.length ? s.turns.filter((t) => inWin(t.at)) : null;
  const prompts = turns ? [] : [s.startedAt, s.lastHumanPromptAt].filter(inWin);
  const bgStart = Math.max(start, last - 4 * 60 * MIN, from);
  return {
    sessionId: s.rowId,
    repoKey: s.repoKey,
    title: s.title,
    accountKey: s.accountId ?? null,
    ...(turns ? { turns } : {}),
    promptTimes: [...new Set(prompts)],
    backgroundSegments: last - bgStart >= MIN ? [{ startsAt: new Date(bgStart).toISOString(), endsAt: new Date(last).toISOString() }] : [],
  };
}

/** An email I sent (Gmail): the recipients' domains only, never addresses. */
export interface WeekEmail {
  id: string;
  subject: string | null;
  domains: string[];
  at: string;
}

export interface WeekDriveEdit {
  fileId: string;
  title: string;
  at: string;
  url?: string | null;
}

export interface WeekOrg62Event extends Org62EventRow {
  rowId: string;
  whatName: string | null;
}

/** A row the user owns (approved and later, or with locked fields): fixed in place, only read-back moves it. */
export interface FixedEntry {
  rowId: string;
  dedupeKey: string;
  subject: string;
  startsAt: string;
  endsAt: string;
  durationHours: number;
  seTaskType: string | null;
  whatOrg62Id: string | null;
  meetingType: string | null;
  status: string;
  operation: 'create' | 'update' | 'delete';
  targetOrg62EventId: string | null;
  /** Why an `excluded` row is excluded; an `overlap` the engine decided is not the user's dismissal (it can come back). */
  excludedReason?: string | null;
  /** Its flags (a declined meeting's flag is added once). */
  flags?: string[];
  /** D-65: the Org62 Event row it is tied to (logged, verified): the read-back pairs on it first (TL-12). */
  org62EventRowId?: string | null;
  /** The columns the user edited (`user_locked_fields`): a rescheduled meeting's row keeps an edited length (TL-32). */
  lockedFields?: readonly string[];
}

export interface DesiredEntry {
  dedupeKey: string;
  origin: 'calendar' | 'evidence' | 'manual';
  subject: string;
  description: string;
  startsAt: string;
  endsAt: string;
  durationHours: number;
  seTaskType: string | null;
  /** Contract CF / CR (customer facing / related). */
  meetingType: 'CF' | 'CR' | null;
  customerFacing: boolean;
  customerRelated: boolean;
  whatKind: 'opportunity' | 'account' | 'none';
  whatOrg62Id: string | null;
  whatName: string | null;
  confidence: 'sure' | 'likely' | 'guess';
  reason: string;
  flags: string[];
  /** `dismissed`: a "Dismiss all from …" rule covers its source (D-64; the user's status from then on). */
  status: 'upcoming' | 'needs_input' | 'proposed' | 'excluded' | 'logged' | 'dismissed';
  excludedReason: 'neither_type' | 'overlap' | 'ooo' | 'placeholder' | 'cap_trimmed' | 'duplicate' | null;
  org62EventRowId: string | null;
  sources: { kind: 'calendar' | 'org62' | 'claude' | 'drive' | 'slack'; label: string; url?: string; externalId?: string; at?: string }[];
  /** false when you were there in person (onsite days, customer dinners, travel). */
  remote: boolean;
  /** D-64: internal-only work: no WhatId, CF / CR off, an internal task type. */
  internal?: boolean;
  /**
   * D-66: the note the Org62 Description carries (before its CC# key): the cheap model's over the meeting notes when
   * the `activity.notes` job made one, else the template over the row's evidence. Null on Org62's own rows.
   */
  logNote: string | null;
  logNoteBasis: 'template' | 'summary' | null;
}

/**
 * D-64: a row I own whose meeting I declined. `remove`: it never reached a canvas or Org62, so it goes (a declined
 * meeting never shows on Time). `flag`: it is handed off (or waits in a canvas item): it stays, flagged; the app never
 * deletes an Org62 Event.
 */
export interface DeclinedMove {
  rowId: string;
  action: 'remove' | 'flag';
  flag?: string;
}

/** A row the user touched (locked fields) that the engine had excluded only for an overlap and now logs again. */
export interface ReviveMove {
  rowId: string;
  status: 'upcoming' | 'needs_input' | 'proposed';
  flags: string[];
  /** `rule`: a row a "Dismiss all from …" rule had set aside, whose rule is gone (D-64: Undo, Remove). */
  kind?: 'overlap' | 'rule';
}

export interface ReadbackMove {
  rowId: string;
  status: 'logged' | 'verified' | 'verify_failed';
  org62EventRowId: string;
  issues: string[];
  /**
   * The user edited an already-verified Event in Org62 (opp, task type, meeting type): Org62 is the record, so the row
   * takes its values and stays verified, instead of a stale opp in the app or a verify_failed that re-issues the old one.
   */
  adopt?: {
    whatOrg62Id: string | null;
    seTaskType: string | null;
    meetingType: string | null;
    note: string;
    /** D-65 (TL-11, TL-12): Org62's hours, start, end and subject, only where they differ from the row. */
    durationHours?: number;
    startsAt?: string;
    endsAt?: string;
    subject?: string;
  };
}

/** D-65 (TL-32): a row whose meeting moved in Calendar follows it: its key (the event id, the new start) and times. */
export interface RekeyMove {
  rowId: string;
  dedupeKey: string;
  startsAt: string;
  endsAt: string;
  durationHours: number;
}

/** D-65 (TL-03): an approved row one Org62 Event already covers (with another meeting): closed, never logged twice. */
export interface CoverMove {
  rowId: string;
  org62EventRowId: string;
  flag: string;
}

/** D-65: the round-trip flags of a user's row (Not in Org62, the start Slackbot moved, a reschedule after hand-off). */
export interface FlagMove {
  rowId: string;
  remove: string[];
  add: string[];
}

export interface DesiredBlock {
  dedupeKey: string;
  source: EngineBlock['source'];
  startsAt: string;
  endsAt: string;
  localDay: string;
  attention: EngineBlock['attention'];
  countsAsHumanHours: boolean;
  precedence: number;
  isOverlay: boolean;
  accountId: string | null;
  calendarEventId: string | null;
  label: string;
}

export interface WeekInput {
  now: string;
  /** Org62 Events that start before this (the fiscal quarter's start) get no logged row of their own. */
  loggedFrom?: string;
  /** The window [from, to) the plan is for (a local week). Evidence outside it belongs to another pass. */
  from: string;
  to: string;
  cfg: ActivityConfig;
  mappings: ActivityMappings;
  events: WeekEvent[];
  sessions: WeekSession[];
  drive: WeekDriveEdit[];
  slack: SlackMessage[];
  /** Emails I sent (each an own action for solo work). */
  emails?: WeekEmail[];
  org62: WeekOrg62Event[];
  fixed: FixedEntry[];
  /** Counted time blocks the projections do not own (manual blocks): projected blocks never double-count them. */
  fixedBlocks: { startsAt: string; endsAt: string }[];
  /**
   * Org62 opp / account id → display names. `mine` (opps): I'm on its team or hold a DC on it; false holds a row the
   * resolver put on it for the user (NOT_ON_TEAM_FLAG). Absent: unknown, nothing is held.
   */
  names: (org62Id: string) => { name: string; mine?: boolean } | null;
  /** Events of the days around the week (hotels, flights, onsite markers): onsite detection only. */
  context?: WeekEvent[];
  /** The user's onsite corrections (day chips, Mark trip). */
  onsiteOverrides?: OnsiteOverrides;
  /** D-64: the sources the user dismissed all rows of (`repo:<name>`, `docs:unmapped`, `series:<calendar>|<id>`). */
  dismissRules?: readonly { key: string; label: string }[];
  /** Rows of mine that wait in a canvas item not applied yet (a declined meeting's row there is flagged, not removed). */
  held?: ReadonlySet<string>;
  /** D-65 (TL-02): an Org62 opp id → its Org62 account id (the slot rule's "same account"). */
  accountOf?: (org62Id: string) => string | null;
  /** D-65 (TL-12): Org62 Events an app row outside this pass is tied to: that row's, never mirrored or matched here. */
  linkedElsewhere?: ReadonlySet<string>;
  /**
   * D-66: a meeting's notes, by calendar event row id: the cheap model's note when the `activity.notes` job made one,
   * and the next step they give (the first to-do the scanner took from them). Absent: no notes.
   */
  meetingNotes?: (eventRowId: string) => { summary: string | null; nextStep: string | null } | null;
  /** D-66: an opp's VDP use cases (the VDP mirror), by Org62 opp id. */
  useCases?: (oppOrg62Id: string) => readonly UseCaseOption[];
}

export interface WeekPlan {
  entries: DesiredEntry[];
  /**
   * The engine's proposals for rows the user already owns (approved and later, or edited) and their continuations
   * (`#2` …): never written, the user's row stands. The re-derive (rederive.ts) compares their hours with the row's:
   * a row in Org62 whose hours would change is an update candidate, never edited in place.
   */
  shadowed: { dedupeKey: string; baseKey: string; durationHours: number; reason: string; evidence: string }[];
  moves: ReadbackMove[];
  /** Overlap-excluded rows the user owns (edited) that log again: status and flags only, their fields stay theirs. */
  revives: ReviveMove[];
  blocks: DesiredBlock[];
  humanHours: number;
  leverageHours: number;
  /** The week's onsite days (detected, confirmed, not onsite) and the trips around them. */
  onsite: OnsiteDay[];
  trips: Trip[];
  /** D-64: rows I own whose meeting I declined (removed, or flagged when handed off); D-65: cancelled ones too. */
  declined: DeclinedMove[];
  /** D-65 (TL-32): rows whose meeting was rescheduled, re-keyed to the meeting's new time. */
  rekeys: RekeyMove[];
  /** D-65 (TL-03): approved rows an Org62 Event already covers. */
  covers: CoverMove[];
  /** D-65: round-trip flags on the user's rows. */
  flagMoves: FlagMove[];
}

const MIN = 60_000;
/** The stored event type; flights, hotel stays and markers are the engine's call (event-kinds.ts, eventKind). */
const kindOf = (e: WeekEvent): CalendarEvidence['kind'] =>
  e.eventType === 'out_of_office' ? 'ooo' : e.eventType === 'focus_time' ? 'focus' : e.eventType === 'working_location' ? 'working_location' : 'default';

function selfResponse(e: WeekEvent): CalendarEvidence['selfResponse'] {
  if (e.myResponse === 'accepted' || e.myResponse === 'declined' || e.myResponse === 'tentative') return e.myResponse;
  return e.iAmOrganizer ? 'accepted' : 'needsAction';
}

const confOf = (c: EngineEntry['confidence']): DesiredEntry['confidence'] => (c === 'High' ? 'sure' : c === 'Medium' ? 'likely' : 'guess');
const cfcr = (type: string | null): { meetingType: DesiredEntry['meetingType']; cf: boolean; cr: boolean } => {
  const t = type ?? '';
  const cf = isCF(t);
  const cr = isCR(t);
  return { meetingType: cf ? 'CF' : cr ? 'CR' : null, cf, cr };
};

/** My Slack messages, one own action each (engaged.ts). The id is the one a burst of one message has. */
export function slackActions(msgs: readonly SlackMessage[]): SlackMessageEvidence[] {
  return msgs.map((m) => ({ id: `${m.channelId}|${m.at}`, channelId: m.channelId, channelName: m.channelName ?? null, at: m.at }));
}

/** My Slack messages → bursts: one per channel run with ≤ 10 min between messages (block labels; legacy evidence). */
export function slackBursts(msgs: SlackMessage[]): SlackBurstEvidence[] {
  const by = new Map<string, SlackMessage[]>();
  for (const m of msgs) by.set(m.channelId, [...(by.get(m.channelId) ?? []), m]);
  const out: SlackBurstEvidence[] = [];
  for (const [channelId, list] of [...by].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = list.sort((a, b) => a.at.localeCompare(b.at));
    let run: SlackMessage[] = [];
    const flush = () => {
      if (!run.length) return;
      const s = Date.parse(run[0]!.at) - 2 * MIN;
      const e = Date.parse(run[run.length - 1]!.at) + 3 * MIN;
      out.push({ id: `${channelId}|${run[0]!.at}`, channelId, startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString(), messageCount: run.length });
      run = [];
    };
    for (const m of sorted) {
      const prev = run[run.length - 1];
      if (prev && Date.parse(m.at) - Date.parse(prev.at) > 10 * MIN) flush();
      run.push(m);
    }
    flush();
  }
  return out;
}

export function toEvidence(e: WeekEvent): CalendarEvidence {
  return {
    id: `${e.calendarId}|${e.externalEventId}`,
    summary: e.title,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    allDay: e.isAllDay,
    kind: kindOf(e),
    selfResponse: selfResponse(e),
    organizerSelf: e.iAmOrganizer,
    recurring: e.recurring,
    attendeeDomains: e.attendeeDomains,
    attended: e.attendance === 'missed' ? false : undefined,
    hasGeminiNotes: e.hasNotes,
    deleted: e.cancelled,
    location: e.location ?? null,
    ...(e.isAllDay && e.allDayFrom ? { allDayFrom: e.allDayFrom, ...(e.allDayTo ? { allDayTo: e.allDayTo } : {}) } : {}),
    accountKey: e.accountId,
    oppWhatId: e.oppOrg62Id,
  };
}

/** The local days of a window [from, to) in `tz`. */
function daysIn(from: string, to: string, tz: string): string[] {
  const out: string[] = [];
  const last = localDay(new Date(Date.parse(to) - 1).toISOString(), tz);
  for (let d = localDay(from, tz); d <= last && out.length < 40; d = addDays(d, 1)) out.push(d);
  return out;
}

export function planWeek(input: WeekInput): WeekPlan {
  const { cfg } = input;
  const evById = new Map<string, WeekEvent>();
  const calendar: CalendarEvidence[] = input.events.map((e) => {
    const ev = toEvidence(e);
    evById.set(ev.id, e);
    return ev;
  });
  const context = (input.context ?? []).map(toEvidence);
  for (const e of input.context ?? []) if (!evById.has(`${e.calendarId}|${e.externalEventId}`)) evById.set(`${e.calendarId}|${e.externalEventId}`, e);
  const drive: DriveEvidence[] = input.drive.map((d) => ({ fileId: d.fileId, title: d.title, editedAt: d.at }));
  const slack = slackBursts(input.slack);
  const slackMessages = slackActions(input.slack);
  const emails: EmailSentEvidence[] = (input.emails ?? []).map((e) => ({ id: e.id, subject: e.subject, domains: e.domains, at: e.at }));
  const from = Date.parse(input.from);
  const to = Date.parse(input.to);
  const claude = input.sessions.map((s) => sessionInWindow(s, from, to)).filter((x): x is ClaudeEvidence => !!x);
  const org62: Org62EventRow[] = input.org62.map(({ rowId: _r, whatName: _w, ...r }) => r);

  // The user's rows are reserved: travel fills only time nobody owns, and so do onsite frames, except around the user's
  // meeting rows when every accepted meeting logs (D-18 amended). Rows the user dismissed never win an overlap.
  const DEAD = ['excluded', 'dismissed', 'dropped'];
  const reserved = input.fixed
    .filter((f) => f.operation === 'create' && !DEAD.includes(f.status))
    .map((f) => ({ startsAt: f.startsAt, endsAt: f.endsAt, meeting: isMeetingKey(f.dedupeKey, f.seTaskType) }));
  // a row the engine excluded only for an overlap is no dismissal, even once the user edited it: it may log again
  const revivable = new Map(input.fixed.filter((f) => f.status === 'excluded' && f.excludedReason === 'overlap').map((f) => [f.dedupeKey, f]));
  const notLogging = input.fixed.filter((f) => DEAD.includes(f.status) && !revivable.has(f.dedupeKey)).map((f) => f.dedupeKey);
  // D-64: the meetings of a series the user dismissed all of never log, so they never take time from one that does
  const rules = new Map((input.dismissRules ?? []).map((r) => [r.key, r.label] as const));
  for (const e of input.events) {
    const series = seriesKeyOf(e.calendarId, e.externalEventId);
    if (series && rules.has(series)) notLogging.push(`cal|${e.calendarId}|${e.externalEventId}|${e.startsAt}`);
  }
  // Solo work never counts again what the user's rows and Org62 already hold, except the user's own solo-work rows (and
  // their Events): the new estimate of the same work replaces those (the re-derive's update candidates, rederive.ts).
  const soloRow = (k: string) => k.startsWith('wb|');
  const soloEventRows = new Set(input.fixed.filter((f) => soloRow(f.dedupeKey) && f.org62EventRowId).map((f) => f.org62EventRowId!));
  const yieldTo = [
    ...input.fixed.filter((f) => f.operation === 'create' && !DEAD.includes(f.status) && !soloRow(f.dedupeKey)).map((f) => ({ startsAt: f.startsAt, endsAt: f.endsAt })),
    ...input.org62.filter((r) => !soloEventRows.has(r.rowId) && !(r.ccKey && input.fixed.some((f) => soloRow(f.dedupeKey) && f.rowId === r.ccKey))).map((r) => ({ startsAt: r.startsAt, endsAt: r.endsAt })),
  ];
  const plan = proposeActivity({
    now: input.now,
    cfg,
    mappings: input.mappings,
    evidence: { calendar, claude, drive, slack: [], slackMessages, emails, git: [] },
    org62Events: org62,
    handsOff: false,
    calendarContext: context,
    onsiteDays: daysIn(input.from, input.to, cfg.timezone),
    onsiteOverrides: input.onsiteOverrides,
    reserved,
    notLogging,
    yieldTo,
  });

  // Per-meeting opp: the resolver's (or the user's mapping) wins over the engine's account-level default, except on a
  // trip, where every row logs to the trip's one account and opp (onsite lane, root cause 6).
  // An opp I'm not on the team of (no DC either) holds the row for the user (needs_input: "Check and approve"); one
  // that is mine clears the engine's not-on-team flag. The status is settled again from the new flags.
  const proposals = plan.entries.map((e) => {
    if (e.origin !== 'calendar' || e.tripKey) return e;
    const ev = evById.get(e.evidenceIds[0] ?? '');
    if (!ev?.oppOrg62Id || e.whatKind === 'none' || id15(e.whatOrg62Id) === id15(ev.oppOrg62Id)) return e;
    const n = input.names(ev.oppOrg62Id);
    const flags = e.flags.filter((f) => !/WhatId = account fallback|NEEDS WhatId/.test(f) && !(n?.mine === true && f.includes(NOT_ON_TEAM_MARKER)));
    if (n?.mine === false && !flags.some((f) => f.includes(NOT_ON_TEAM_MARKER))) flags.push(NOT_ON_TEAM_FLAG);
    return finalizeStatus({ ...e, whatKind: 'opportunity' as const, whatOrg62Id: ev.oppOrg62Id, whatName: n?.name ?? e.whatName, flags }, Date.parse(input.now));
  });

  // ---- D-65 (TL-32): a meeting rescheduled after I approved (or dismissed) its row: the row moves with it, re-keyed by
  // the event id (the dedupe key carries the start), so no stale row stays and no new proposal opens. A row handed off
  // already stays where Org62 has it, flagged; its new time opens no proposal either.
  const tz = cfg.timezone;
  const fixedKeys = new Set(input.fixed.map((f) => f.dedupeKey));
  // a solo-work row the user owns stands for that day's bucket: the engine's proposal of it and its continuations
  // (`#2` …) are never written; the re-derive compares their hours with the row's (update candidates)
  const baseOf = (k: string) => k.replace(/#\d+$/, '');
  const shadowed: WeekPlan['shadowed'] = proposals
    // solo work, and travel (its buffers changed 2026-11-14)
    .filter((p) => (p.origin === 'evidence' || p.seTaskType === 'Travel') && fixedKeys.has(baseOf(p.dedupeKey)) && input.fixed.some((f) => f.dedupeKey === baseOf(p.dedupeKey) && !DEAD.includes(f.status)))
    .map((p) => ({ dedupeKey: p.dedupeKey, baseKey: baseOf(p.dedupeKey), durationHours: p.durationHours, reason: p.reason, evidence: p.evidence }));
  const shadowedKeys = new Set(shadowed.map((x) => x.dedupeKey));
  const byIdentity = new Map<string, WeekEvent>();
  for (const e of [...(input.context ?? []), ...input.events]) byIdentity.set(`${e.calendarId}|${e.externalEventId}`, e);
  const suppressed = new Set<string>();
  const rekeys: RekeyMove[] = [];
  const rescheduled = new Map<string, string[]>();
  for (const f of input.fixed) {
    const k = calKeyOf(f.dedupeKey);
    if (!k || !isMeetingKey(f.dedupeKey, f.seTaskType)) continue;
    const ev = byIdentity.get(`${k.calendarId}|${k.eventId}`);
    if (!ev || ev.cancelled || ev.isAllDay || Date.parse(ev.startsAt) === Date.parse(k.startsAt)) continue;
    const key = `cal|${k.calendarId}|${k.eventId}|${ev.startsAt}`;
    if (fixedKeys.has(key)) continue; // the user has a row at the new time already
    suppressed.add(key);
    if (['synced_to_canvas', 'logged', 'verified', 'verify_failed'].includes(f.status)) {
      rescheduled.set(f.rowId, [rescheduledFlag(localDayMs(Date.parse(ev.startsAt), tz), localHm(Date.parse(ev.startsAt), tz))]);
      continue;
    }
    // the row follows its meeting: its new start and end; a row whose start, end or hours you edited keeps its own
    // length and shifts by as much as the meeting did
    const span = Date.parse(f.endsAt) - Date.parse(f.startsAt);
    const edited = (f.lockedFields ?? []).some((c) => c === 'starts_at' || c === 'ends_at' || c === 'duration_hours');
    const follow = !edited && Date.parse(f.startsAt) === Date.parse(k.startsAt);
    const startsAt = follow ? ev.startsAt : new Date(Date.parse(f.startsAt) + Date.parse(ev.startsAt) - Date.parse(k.startsAt)).toISOString();
    rekeys.push({
      rowId: f.rowId,
      dedupeKey: key,
      startsAt,
      endsAt: follow ? ev.endsAt : new Date(Date.parse(startsAt) + span).toISOString(),
      durationHours: follow ? roundQuarter((Date.parse(ev.endsAt) - Date.parse(ev.startsAt)) / 3_600_000) : f.durationHours,
    });
  }

  // ---- read-back: fixed rows and proposals compete for each Org62 Event (D-65: the link first, then the CC# key,
  // Subject + Start, fuzzy, the slot, a tz shift). A proposal of a meeting the user owns a row of is that row: it never
  // takes the Event from it (TL-05). An Event an app row of another pass is tied to is that row's (TL-12).
  const asEngine = (f: FixedEntry): EngineEntry => ({
    dedupeKey: `fixed:${f.rowId}`,
    origin: 'manual',
    operation: f.operation,
    targetOrg62EventId: f.targetOrg62EventId,
    subject: f.subject,
    startsAt: f.startsAt,
    endsAt: f.endsAt,
    durationHours: f.durationHours,
    seTaskType: f.seTaskType,
    meetingType: f.meetingType ?? '',
    whatKind: 'none',
    whatOrg62Id: f.whatOrg62Id,
    whatName: null,
    customerFacing: false,
    customerRelated: false,
    description: '',
    confidence: 'High',
    reason: '',
    flags: [],
    evidenceIds: [],
    evidence: '',
    status: (f.status as EngineEntry['status']) ?? 'approved',
    excludedReason: null,
    userLockedFields: [],
  });
  const elsewhere = input.linkedElsewhere ?? new Set<string>();
  const org62Here = org62.filter((r) => !elsewhere.has(r.org62EventId));
  const org62ByRowId = new Map(input.org62.map((r) => [r.rowId, r]));
  const links = new Map<string, string>();
  const ccKeys = new Map<string, string>();
  for (const f of input.fixed) {
    const linked = f.org62EventRowId ? org62ByRowId.get(f.org62EventRowId) : undefined;
    if (linked) links.set(`fixed:${f.rowId}`, linked.org62EventId);
    ccKeys.set(`fixed:${f.rowId}`, f.rowId);
  }
  const accountOf = input.accountOf;
  const rb = verifyReadback([...input.fixed.map(asEngine), ...proposals.filter((p) => !fixedKeys.has(p.dedupeKey) && !suppressed.has(p.dedupeKey))], org62Here, {
    now: input.now,
    ownerId: cfg.ownerId || undefined,
    ...(cfg.recordTypeName ? { recordTypeName: cfg.recordTypeName } : {}),
    ...(cfg.taskTypeRequired === false ? { taskTypeRequired: false } : {}),
    links,
    ccKeys,
    ...(accountOf ? { accountOf } : {}),
    timezone: tz,
  });
  const itemOf = new Map(rb.items.map((i) => [i.dedupeKey, i]));
  const matchOf = new Map(rb.items.filter((i) => i.org62EventId).map((i) => [i.dedupeKey, i]));
  const org62ById = new Map(input.org62.map((r) => [r.org62EventId, r]));
  const claimed = new Map<string, string>(); // org62 event id → dedupeKey of the row that represents it
  const typed = cfg.taskTypeRequired !== false;
  const rt = cfg.recordTypeName ?? 'Solutions Event';

  const moves: ReadbackMove[] = [];
  const covers: CoverMove[] = [];
  const roundTrip = new Map<string, string[]>(); // fixed row id → the round-trip flags it should carry now
  for (const f of input.fixed) {
    const item = itemOf.get(`fixed:${f.rowId}`);
    const want: string[] = [];
    roundTrip.set(f.rowId, want);
    if (!item) continue;
    if (!item.org62EventId) {
      // TL-20: on a canvas that ran (Org62 shows later Events of mine), and still no Event: "Not in Org62"
      if (f.status === 'synced_to_canvas' && item.status === 'missing') want.push(NOT_IN_ORG62_FLAG);
      continue;
    }
    const r = org62ById.get(item.org62EventId)!;
    claimed.set(item.org62EventId, f.dedupeKey);
    const verifiedOnce = f.status === 'verified' && f.operation === 'create';
    // TL-22: the start Slackbot moved is flagged at the first verification, and stays flagged while it differs; a
    // verified row whose start moves later was edited in Org62 (TL-12: adopted below, never flagged)
    const shifted = (f.flags ?? []).some((x) => x.startsWith(START_DIFFERS_MARKER));
    if (!verifiedOnce || shifted) want.push(...item.notes);
    const found = item.status === 'verified' || item.status === 'verify_failed' || item.status === 'logged';
    if (!found) continue; // a legacy record type: it closes nothing for the user's row (re-create to count, TL-41)
    if (verifiedOnce) {
      // TL-10 / TL-11 / TL-12 / TL-13: verified once, different now: edited in Org62. Org62 wins, and only a real
      // difference writes (never a rewrite on every pass). A start Slackbot moved stays flagged, never adopted (TL-22).
      const keepTimes = shifted;
      const diff = adoptDiff(f, r, { typed, keepTimes });
      if (diff.length) moves.push({ rowId: f.rowId, status: 'verified', org62EventRowId: r.rowId, issues: [], adopt: adoptOf(f, r, `Updated from Org62 (edited there): ${diff.join('; ')}`.slice(0, 300), keepTimes) });
      continue;
    }
    if (f.status === 'approved' && item.matchedBy !== 'link' && item.matchedBy !== 'cc_key') {
      // TL-05: an approved row the user then logged by hand (another subject or start): Org62 is the record. The row
      // takes its values and is verified, so it never goes on a canvas (nor does the canvas item holding it, TL-06).
      const diff = item.status === 'logged' ? [] : adoptDiff(f, r, { typed, keepTimes: false });
      moves.push({ rowId: f.rowId, status: item.status === 'logged' ? 'logged' : 'verified', org62EventRowId: r.rowId, issues: item.status === 'logged' ? item.issues : [], ...(diff.length ? { adopt: adoptOf(f, r, `${MANUAL_LOG_NOTE}: ${diff.join('; ')}`.slice(0, 300), false) } : {}) });
      continue;
    }
    if (['approved', 'synced_to_canvas', 'logged', 'verify_failed'].includes(f.status)) {
      // TL-15: verify_failed moves on too (fixed in Org62 → verified); an unchanged verify_failed rewrites only its issue
      if (f.status !== item.status || f.status === 'verify_failed') moves.push({ rowId: f.rowId, status: item.status as ReadbackMove['status'], org62EventRowId: r.rowId, issues: item.issues });
    }
  }

  const entries: DesiredEntry[] = [];
  const replacedBy = new Map<string, EngineEntry[]>(); // org62 event id → the proposals it closes
  const open: EngineEntry[] = [];
  for (const e of proposals) {
    if (suppressed.has(e.dedupeKey)) continue; // TL-32: a rescheduled meeting's new time: the user's row is it
    if (shadowedKeys.has(e.dedupeKey) && !fixedKeys.has(e.dedupeKey)) continue; // a continuation of a solo-work row the user owns
    const m = matchOf.get(e.dedupeKey);
    if (m?.org62EventId && !claimed.has(m.org62EventId)) {
      replacedBy.set(m.org62EventId, [...(replacedBy.get(m.org62EventId) ?? []), e]);
      continue;
    }
    open.push(e);
  }
  // TL-03: one Event that covers two meetings closes every one it fully covers (the same Related To; never a meeting
  // double-booked over the one it was matched to: those both log, D-18)
  const representedBy = (id: string): { startsAt: string; endsAt: string }[] => [
    ...(replacedBy.get(id) ?? []),
    ...input.fixed.filter((f) => claimed.get(id) === f.dedupeKey),
  ];
  const coverOf = (x: { startsAt: string; endsAt: string; whatOrg62Id: string | null; accountKey?: string | null }): WeekOrg62Event | null => {
    const s = Date.parse(x.startsAt);
    const en = Date.parse(x.endsAt);
    for (const r of input.org62) {
      // an Event a canvas made (its CC# key) is that one row's: it never stands in for another meeting
      if (elsewhere.has(r.org62EventId) || r.recordTypeName !== rt || r.ccKey) continue;
      const rs = Date.parse(r.startsAt);
      const re = Date.parse(r.endsAt);
      if (!(rs <= s + MIN && en <= re + MIN && re - rs >= en - s + 15 * MIN)) continue;
      if (!sameRelatedTo(x.whatOrg62Id, r.whatOrg62Id, accountOf)) continue;
      if (representedBy(r.org62EventId).some((o) => Date.parse(o.startsAt) < en && s < Date.parse(o.endsAt))) continue;
      return r;
    }
    return null;
  };
  for (const e of open) {
    // a proposal of a meeting the user owns a row of is that row (its cover, if any, is the row's: below)
    const r = e.status === 'excluded' || fixedKeys.has(e.dedupeKey) ? null : coverOf(e);
    if (r && (claimed.has(r.org62EventId) || replacedBy.has(r.org62EventId))) {
      replacedBy.set(r.org62EventId, [...(replacedBy.get(r.org62EventId) ?? []), e]);
      continue;
    }
    entries.push(fromProposal(e, evById, input));
  }
  for (const f of input.fixed) {
    if (f.status !== 'approved' || f.operation !== 'create' || moves.some((mv) => mv.rowId === f.rowId) || itemOf.get(`fixed:${f.rowId}`)?.org62EventId) continue;
    if (Date.parse(f.startsAt) < from || Date.parse(f.startsAt) >= to) continue;
    const r = coverOf(f);
    if (r && (claimed.has(r.org62EventId) || replacedBy.has(r.org62EventId))) covers.push({ rowId: f.rowId, org62EventRowId: r.rowId, flag: coveredFlag(r.subject ?? '(no subject)') });
  }

  const mirrors: DesiredEntry[] = [];
  for (const r of input.org62) {
    if (claimed.has(r.org62EventId) || elsewhere.has(r.org62EventId)) continue;
    // Logged rows are this quarter's (the pages total every logged row as the quarter's hours); older Org62
    // Events still match proposals (those stay "already in Org62") and count toward the caps.
    if (input.loggedFrom && Date.parse(r.startsAt) < Date.parse(input.loggedFrom)) continue;
    const m = fromOrg62(r, replacedBy.get(r.org62EventId), evById, input);
    mirrors.push(m);
    entries.push(m);
  }
  // TL-04 / TL-21: a second Event in a slot another Event already logs stays logged (never hidden) and is flagged
  // "possible duplicate in Org62". The Events the user's rows are tied to come first, then by start.
  const canon = [
    ...input.org62.filter((r) => claimed.has(r.org62EventId) && !elsewhere.has(r.org62EventId)),
    ...mirrors.map((m) => org62ByRowId.get(m.org62EventRowId!)!).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.org62EventId.localeCompare(b.org62EventId)),
  ];
  for (const m of mirrors) {
    const r = org62ByRowId.get(m.org62EventRowId!)!;
    const i = canon.indexOf(r);
    const twin = canon.slice(0, i).find((o) => o.recordTypeName === r.recordTypeName && isTwinEvent(o, r, tz, accountOf));
    if (twin) m.flags.push(duplicateFlag(twin.subject ?? '(no subject)', Date.parse(twin.startsAt), Date.parse(twin.endsAt), tz));
  }

  // ---- D-64: rows whose source a "Dismiss all from …" rule covers are written dismissed, with the rule's flag
  for (const e of entries) {
    if (e.status === 'excluded' || e.status === 'logged') continue;
    const src = dismissSourceOf(e.dedupeKey, e.subject);
    const label = src ? rules.get(src.key) : undefined;
    if (label === undefined) continue;
    e.status = 'dismissed';
    e.excludedReason = null;
    e.flags.push(dismissRuleFlag(label));
  }

  // ---- overlaps between rows: user-owned, then Org62, then meetings, then evidence guesses (D-18 amended: by mode).
  // D-65: a real Org62 record is never hidden: an Org62 row logs in either mode, and one that overlaps another row
  // only says so (TL-07); estimates and meetings still yield to it as before.
  const logAll = overlapModeOf(cfg) === 'log_all_accepted';
  const rank = (e: DesiredEntry) => (e.status === 'logged' ? 0 : e.origin === 'calendar' ? 1 : 2);
  const taken: { s: number; e: number; label: string; key: string; org62: boolean }[] = input.fixed
    .filter((f) => f.operation === 'create' && !DEAD.includes(f.status))
    .map((f) => ({ s: Date.parse(f.startsAt), e: Date.parse(f.endsAt), label: f.subject, key: f.dedupeKey, org62: false }));
  const dead = new Set(notLogging);
  for (const e of [...entries].sort((a, b) => rank(a) - rank(b) || a.startsAt.localeCompare(b.startsAt) || a.dedupeKey.localeCompare(b.dedupeKey))) {
    // excluded, dismissed by a rule, or the proposal behind a row the user dismissed (theirs stands; never written)
    if (e.status === 'excluded' || e.status === 'dismissed' || dead.has(e.dedupeKey)) continue;
    const s = Date.parse(e.startsAt);
    const en = Date.parse(e.endsAt);
    const over = (t: (typeof taken)[number]) => t.s < en && s < t.e;
    if (e.status === 'logged' && e.dedupeKey.startsWith('org62|')) {
      const hit = e.flags.some((f) => f.startsWith(DUPLICATE_MARKER)) ? undefined : taken.find(over);
      if (hit) e.flags.push(overlapInfo(hit.label, Math.max(s, hit.s), Math.min(en, hit.e), tz));
      taken.push({ s, e: en, label: e.subject, key: e.dedupeKey, org62: true });
      continue;
    }
    // an accepted meeting (or an onsite frame) logs over other rows; only its twin stands in for it: the user's row of
    // the same key, or (a meeting) an Org62 Event of the same slot that the read-back could not match by subject
    const meeting = isMeetingKey(e.dedupeKey, e.seTaskType) && e.status !== 'logged';
    const frame = e.dedupeKey.startsWith('onsite|');
    const hit =
      logAll && (meeting || frame)
        ? taken.find((t) => t.key === e.dedupeKey || (meeting && t.org62 && over(t) && Math.abs(t.s - s) <= 5 * MIN))
        : taken.find(over);
    if (hit) {
      e.status = 'excluded';
      e.excludedReason = 'overlap';
      e.flags.push(`overlaps '${hit.label}': hours are human hours, counted once`);
      continue;
    }
    taken.push({ s, e: en, label: e.subject, key: e.dedupeKey, org62: false });
  }

  // ---- D-64: a meeting I declined has no row. The projection's own rows simply drop (no proposal); mine go too, unless
  // handed off or waiting in a canvas item: flagged, never deleted from Org62. D-65 (TL-31): a meeting cancelled before it
  // happened (the calendar's `cancelled`) the same way.
  const declinedKeys = input.events
    .filter((e) => e.myResponse === 'declined' && !e.isAllDay && !e.cancelled)
    .map((e) => `cal|${e.calendarId}|${e.externalEventId}|${e.startsAt}`);
  const isDeclined = (k: string) => declinedKeys.some((d) => k === d || k.startsWith(`${d}@`) || k.startsWith(`${d}#`));
  const cancelledIds = new Set([...input.events.filter((e) => e.cancelled && !e.isAllDay).map((e) => `cal|${e.calendarId}|${e.externalEventId}|`)]);
  const isCancelled = (k: string) => {
    const c = calKeyOf(k);
    return !!c && cancelledIds.has(`cal|${c.calendarId}|${c.eventId}|`);
  };
  const HANDED = ['synced_to_canvas', 'logged', 'verified', 'verify_failed'];
  // an Org62 Event of a meeting I declined (logged before I declined) stays logged, and says so
  // (the same subject, starting within 5 min: never a guess on another meeting of the slot)
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');
  const declinedAt = input.events.filter((e) => e.myResponse === 'declined' && !e.isAllDay && !e.cancelled).map((e) => ({ t: Date.parse(e.startsAt), title: norm(e.title) }));
  for (const e of entries)
    if (e.status === 'logged' && e.dedupeKey.startsWith('org62|') && declinedAt.some((d) => Math.abs(d.t - Date.parse(e.startsAt)) <= 5 * MIN && d.title === norm(e.subject)) && !e.flags.includes(DECLINED_LOGGED_FLAG)) e.flags.push(DECLINED_LOGGED_FLAG);
  const declined: DeclinedMove[] = [];
  for (const f of input.fixed) {
    const dec = isDeclined(f.dedupeKey);
    const can = !dec && isCancelled(f.dedupeKey);
    if ((!dec && !can) || Date.parse(f.startsAt) < from || Date.parse(f.startsAt) >= to) continue;
    // handed off already, or the read-back just found it in Org62
    const handed = HANDED.includes(f.status) || moves.some((mv) => mv.rowId === f.rowId);
    const held = !handed && !!input.held?.has(f.rowId);
    const marker = dec ? DECLINED_MARKER : CANCELLED_MARKER;
    if (!handed && !held) declined.push({ rowId: f.rowId, action: 'remove' });
    else if (!(f.flags ?? []).some((x) => x.startsWith(marker))) declined.push({ rowId: f.rowId, action: 'flag', flag: dec ? (handed ? DECLINED_LOGGED_FLAG : DECLINED_HELD_FLAG) : handed ? CANCELLED_LOGGED_FLAG : CANCELLED_HELD_FLAG });
  }

  // round-trip flags (Not in Org62, the start Slackbot moved, a reschedule after hand-off) on the user's rows: only a
  // change writes
  const flagMoves: FlagMove[] = [];
  for (const f of input.fixed) {
    const want = [...(roundTrip.get(f.rowId) ?? []), ...(rescheduled.get(f.rowId) ?? [])];
    const cur = (f.flags ?? []).filter((x) => isRoundTripFlag(x) || x.startsWith(RESCHEDULED_MARKER));
    const keepResched = cur.filter((x) => x.startsWith(RESCHEDULED_MARKER) && !rescheduled.has(f.rowId));
    const next = [...want, ...keepResched];
    if (next.length === cur.length && next.every((x) => cur.includes(x))) continue;
    flagMoves.push({ rowId: f.rowId, remove: cur.filter((x) => !next.includes(x)), add: next.filter((x) => !cur.includes(x)) });
  }

  // a row a rule had set aside whose rule is gone (Undo, Remove) logs again as the engine now proposes it
  const ruleGone = new Map(
    input.fixed
      .filter((f) => f.status === 'dismissed' && isRuleDismissal(f.flags) && !rules.has(dismissSourceOf(f.dedupeKey, f.subject)?.key ?? ''))
      .map((f) => [f.dedupeKey, f] as const),
  );
  const revives: ReviveMove[] = entries.flatMap((e): ReviveMove[] => {
    if (e.status !== 'upcoming' && e.status !== 'needs_input' && e.status !== 'proposed') return [];
    const f = revivable.get(e.dedupeKey);
    if (f) return [{ rowId: f.rowId, status: e.status, flags: [...e.flags] }];
    const g = ruleGone.get(e.dedupeKey);
    return g ? [{ rowId: g.rowId, status: e.status, flags: [...e.flags], kind: 'rule' }] : [];
  });

  // ---- blocks: labels from their evidence; never double-count a block the projections do not own
  const label = blockLabeler(input, evById, slack, plan.onsite);
  const fixedIv = input.fixedBlocks.map((b) => ({ s: Date.parse(b.startsAt), e: Date.parse(b.endsAt) }));
  const blocks: DesiredBlock[] = plan.blocks.map((b) => {
    const clash = b.countsAsHumanHours && fixedIv.some((f) => f.s < Date.parse(b.endsAt) && Date.parse(b.startsAt) < f.e);
    const ev = b.source === 'calendar' || b.source === 'travel' ? evById.get(b.evidenceIds[0] ?? '') : undefined;
    return {
      dedupeKey: b.dedupeKey,
      source: b.source,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      localDay: b.localDay,
      attention: b.attention,
      countsAsHumanHours: b.countsAsHumanHours && !clash,
      precedence: b.precedence,
      isOverlay: b.isOverlay || clash,
      accountId: b.accountKey,
      calendarEventId: ev?.rowId ?? null,
      label: label(b),
    };
  });

  const inWin = (iso: string) => Date.parse(iso) >= from && Date.parse(iso) < to;
  return {
    entries: dropExcludedTwins(entries)
      .filter((e) => inWin(e.startsAt))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.dedupeKey.localeCompare(b.dedupeKey)),
    shadowed: shadowed.filter((x) => inWin(input.fixed.find((f) => f.dedupeKey === x.baseKey)?.startsAt ?? '')),
    moves,
    revives,
    blocks: blocks.filter((b) => inWin(b.startsAt)),
    humanHours: plan.humanHours,
    leverageHours: plan.leverageHours,
    onsite: plan.onsite,
    trips: plan.trips,
    declined,
    rekeys,
    covers,
    flagMoves,
  };
}

/** A calendar meeting's row (the engine's `cal|` key; travel shares the prefix and is not one). */
const isMeetingKey = (dedupeKey: string, seTaskType: string | null): boolean => dedupeKey.startsWith('cal|') && seTaskType !== 'Travel';

/** `cal|<calendar>|<event id>|<start>` (a meeting's key; travel pieces carry a suffix and are not one). */
export function calKeyOf(key: string): { calendarId: string; eventId: string; startsAt: string } | null {
  const m = /^cal\|([^|]+)\|([^|]+)\|([^|@#]+)$/.exec(key);
  return m ? { calendarId: m[1]!, eventId: m[2]!, startsAt: m[3]! } : null;
}

const blankOf = (v: string | null | undefined): string => (v ?? '').trim();

/** What an Org62 Event says differently from the user's row (D-65: only a real difference is adopted, TL-11). */
function adoptDiff(f: FixedEntry, r: WeekOrg62Event, o: { typed: boolean; keepTimes: boolean }): string[] {
  const d: string[] = [];
  if (id15(f.whatOrg62Id) !== id15(r.whatOrg62Id)) d.push(`WhatId ${f.whatOrg62Id ?? '(none)'} → ${r.whatOrg62Id ?? '(none)'}`);
  if (o.typed && blankOf(f.seTaskType) !== blankOf(r.seTaskTypeName)) d.push(`SE_Task_Type__c ${blankOf(f.seTaskType) || '(blank)'} → ${blankOf(r.seTaskTypeName) || '(blank)'}`);
  const h = r.durationField === null ? null : roundQuarter(r.durationField);
  if (h !== null && h > 0 && Math.abs(h - f.durationHours) > 1e-6) d.push(`Duration__c ${f.durationHours} → ${h}`);
  if (!o.keepTimes && Math.abs(Date.parse(r.startsAt) - Date.parse(f.startsAt)) > MIN) d.push(`start ${f.startsAt.slice(11, 16)} → ${r.startsAt.slice(11, 16)} UTC`);
  if (!o.keepTimes && Math.abs(Date.parse(r.endsAt) - Date.parse(f.endsAt)) > MIN) d.push(`end ${f.endsAt.slice(11, 16)} → ${r.endsAt.slice(11, 16)} UTC`);
  if (normSubject(r.subject) && normSubject(r.subject) !== normSubject(f.subject)) d.push('Subject');
  return d;
}

/** Org62's values for the user's row (the fields that differ; opp, type and meeting type always). */
function adoptOf(f: FixedEntry, r: WeekOrg62Event, note: string, keepTimes: boolean): NonNullable<ReadbackMove['adopt']> {
  const h = r.durationField === null ? null : roundQuarter(r.durationField);
  return {
    whatOrg62Id: r.whatOrg62Id,
    seTaskType: r.seTaskTypeName ?? null,
    meetingType: r.meetingTypeName ?? null,
    note,
    ...(h !== null && h > 0 && Math.abs(h - f.durationHours) > 1e-6 ? { durationHours: h } : {}),
    ...(!keepTimes && Math.abs(Date.parse(r.startsAt) - Date.parse(f.startsAt)) > MIN ? { startsAt: r.startsAt } : {}),
    ...(!keepTimes && Math.abs(Date.parse(r.endsAt) - Date.parse(f.endsAt)) > MIN ? { endsAt: r.endsAt } : {}),
    ...(r.subject && normSubject(r.subject) !== normSubject(f.subject) ? { subject: r.subject } : {}),
  };
}

/**
 * TL-04 / TL-21: two Org62 Events of one slot: the same CC# key (a canvas run twice, a Slackbot duplicate), or
 * overlapping on the same start (±5 min) or by half, with the same Related To or the same subject.
 */
function isTwinEvent(a: Org62EventRow, b: Org62EventRow, tz: string, accountOf?: (id: string) => string | null): boolean {
  if (a.ccKey && b.ccKey) return a.ccKey === b.ccKey;
  const as = Date.parse(a.startsAt);
  const ae = Date.parse(a.endsAt);
  const bs = Date.parse(b.startsAt);
  const be = Date.parse(b.endsAt);
  const ov = Math.min(ae, be) - Math.max(as, bs);
  if (ov <= 0) return false;
  const shorter = Math.max(MIN, Math.min(ae - as, be - bs));
  const slot = Math.abs(as - bs) <= 5 * MIN || (ov / shorter >= 0.5 && localDayMs(as, tz) === localDayMs(bs, tz));
  return slot && (sameRelatedTo(a.whatOrg62Id, b.whatOrg62Id, accountOf) || (!!normSubject(a.subject) && normSubject(a.subject) === normSubject(b.subject)));
}

/** A meeting the engine excluded (e.g. Admin) that the user logged in Org62 anyway is that Org62 row: drop the twin. */
function dropExcludedTwins(entries: DesiredEntry[]): DesiredEntry[] {
  const logged = entries.filter((e) => e.status === 'logged');
  return entries.filter((e) => {
    if (e.status !== 'excluded' || e.origin !== 'calendar') return true;
    const s = Date.parse(e.startsAt);
    return !logged.some((l) => Math.abs(Date.parse(l.startsAt) - s) <= 5 * MIN && Date.parse(l.startsAt) < Date.parse(e.endsAt));
  });
}

function fromProposal(e: EngineEntry, evById: Map<string, WeekEvent>, input: WeekInput): DesiredEntry {
  const ev = e.origin === 'calendar' ? evById.get(e.evidenceIds[0] ?? '') : undefined;
  const t = cfcr(e.seTaskType);
  const status: DesiredEntry['status'] = e.status === 'upcoming' || e.status === 'needs_input' || e.status === 'proposed' || e.status === 'excluded' ? e.status : 'proposed';
  const sources: DesiredEntry['sources'] = [];
  if (ev) sources.push({ kind: 'calendar', label: 'Google Calendar', externalId: ev.externalEventId, ...(ev.url ? { url: ev.url } : {}), at: ev.startsAt });
  const kindLabels: string[] = [];
  if (e.origin === 'evidence') {
    // an email I sent has no source kind of its own here (its row shows it in the evidence line): not counted as Slack
    const emailIds = new Set((input.emails ?? []).map((m) => m.id));
    const kinds = new Set(e.evidenceIds.filter((id) => !emailIds.has(id)).map((id) => (input.sessions.some((s) => s.rowId === id) ? 'claude' : input.drive.some((d) => d.fileId === id) ? 'drive' : 'slack')));
    for (const k of [...kinds].sort()) kindLabels.push(k === 'claude' ? 'Claude sessions' : k === 'drive' ? 'Drive edits' : 'Slack');
    // Each piece of evidence links to its original: a session, a file, a Slack burst's first message (provenance).
    sources.push(...evidenceSources(e.evidenceIds, input));
  }
  // The engine names an unmapped bucket by its doc count; a bucket of Slack bursts alone would read "0 unmapped doc(s)".
  const subject = e.subject.replace(/^0 unmapped doc\(s\)(?=:)/, `Unmapped ${(kindLabels.length ? kindLabels : sources.map((s) => s.label)).join(' + ') || 'work'}`);
  return {
    dedupeKey: e.dedupeKey,
    origin: e.origin === 'calendar' ? 'calendar' : 'evidence',
    subject,
    description: e.evidence ? `${subject} · ${e.evidence}` : subject,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    durationHours: e.durationHours,
    seTaskType: e.seTaskType,
    // D-64: internal-only work is neither customer-facing nor customer-related, whatever its type counts as (Travel)
    meetingType: e.internal ? null : t.meetingType,
    customerFacing: e.internal ? false : e.customerFacing,
    customerRelated: e.internal ? false : e.customerRelated || t.cr,
    whatKind: e.whatKind === 'opportunity' || e.whatKind === 'account' ? e.whatKind : 'none',
    whatOrg62Id: e.whatOrg62Id,
    whatName: e.whatName,
    confidence: confOf(e.confidence),
    reason: e.reason,
    flags: [...e.flags],
    status,
    excludedReason: status === 'excluded' ? (e.excludedReason ?? 'neither_type') : null,
    org62EventRowId: null,
    sources,
    remote: e.remote ?? true,
    ...(e.internal ? { internal: true } : {}),
    ...noteOf(e, ev, input),
  };
}

/** The row's evidence as note facts (D-66): titles, channels, attendee domains and names; never message text. */
export function noteFactsOf(e: EngineEntry, ev: WeekEvent | undefined, input: WeekInput): NoteFacts {
  const internal = !!e.internal;
  const customer = internal ? null : e.whatName ? e.whatName.split(' - ')[0]!.trim() || null : null;
  const kind: NoteFacts['kind'] = e.origin === 'evidence' || e.origin === 'build_estimate' ? 'work' : e.dedupeKey.startsWith('onsite|') ? 'onsite' : e.seTaskType === 'Travel' ? 'travel' : 'meeting';
  const ids = new Set(e.evidenceIds);
  const sessions = kind === 'work' ? input.sessions.filter((x) => ids.has(x.rowId)).map((x) => x.title) : [];
  const docs = kind === 'work' ? input.drive.filter((d) => ids.has(d.fileId)).map((d) => d.title) : [];
  const channels = kind === 'work' ? [...new Set(input.slack.filter((m) => ids.has(`${m.channelId}|${m.at}`)).map((m) => m.channelName).filter((c): c is string => !!c))] : [];
  const repo = /\|repo:([^#]+)/.exec(e.dedupeKey)?.[1];
  // a meeting's own notes only (an onsite frame's first signal may be a meeting: its notes are not the day's)
  const notes = kind === 'meeting' && ev && input.meetingNotes ? input.meetingNotes(ev.rowId) : null;
  const uses = e.whatOrg62Id && !internal && input.useCases ? input.useCases(e.whatOrg62Id) : [];
  const useCase = uses.length ? pickUseCase(uses, [e.subject, ...sessions, ...docs].join(' ')) : null;
  return {
    kind,
    subject: kind === 'meeting' || kind === 'travel' ? (ev?.title ?? e.subject) : e.subject,
    taskType: e.seTaskType,
    internal,
    customer,
    externalDomains: ev?.attendeeDomains ?? [],
    useCase,
    nextStep: notes?.nextStep ?? null,
    sessions,
    docs,
    channels,
    repos: repo ? [repo] : [],
    city: kind === 'onsite' ? (/\(([^)]+)\)\s*$/.exec(e.subject)?.[1] ?? null) : null,
  };
}

/** D-66: the cheap model's note over the meeting notes when there is one, else the template. */
function noteOf(e: EngineEntry, ev: WeekEvent | undefined, input: WeekInput): Pick<DesiredEntry, 'logNote' | 'logNoteBasis'> {
  const facts = noteFactsOf(e, ev, input);
  const summary = facts.kind === 'meeting' && e.dedupeKey.startsWith('cal|') && ev && input.meetingNotes ? input.meetingNotes(ev.rowId)?.summary : null;
  if (summary) return { logNote: summary, logNoteBasis: 'summary' };
  return { logNote: templateNote(facts), logNoteBasis: 'template' };
}

function fromOrg62(r: WeekOrg62Event, replacedAll: EngineEntry[] | undefined, evById: Map<string, WeekEvent>, input: WeekInput): DesiredEntry {
  const replaced = replacedAll?.[0];
  const hours = roundQuarter(r.durationField ?? (Date.parse(r.endsAt) - Date.parse(r.startsAt)) / 3_600_000);
  const t = cfcr(r.seTaskTypeName);
  const ev = replaced?.origin === 'calendar' ? evById.get(replaced.evidenceIds[0] ?? '') : undefined;
  const flags: string[] = [];
  if (r.durationField === null) flags.push('Duration__c is blank in Org62; backfill it');
  // D-55: the persona's record type (an SE's Solutions Event, an AE's Sales Events); a task type only where it is needed
  const rt = input.cfg.recordTypeName ?? 'Solutions Event';
  // TL-41: a legacy record type closes the proposal it matches but is not counted until re-created (the count map)
  if (r.recordTypeName !== rt) flags.push(legacyFlag(r.recordTypeName, rt));
  if (!r.seTaskTypeName && input.cfg.taskTypeRequired !== false) flags.push('SE_Task_Type__c is blank in Org62');
  const what = r.whatOrg62Id;
  // D-64: an Event logged with Related To empty and an internal type is internal-only work (CF / CR off)
  const internal = !what && isInternalTaskType(r.seTaskTypeName);
  // TL-08: a customer task type logged with Related To empty: say so (it counts, but against no opportunity)
  if (!what && !internal && r.seTaskTypeName && r.recordTypeName === rt) flags.push(RELATED_TO_EMPTY_FLAG);
  const eventUrl = org62RecordUrl('Event', r.org62EventId);
  const sources: DesiredEntry['sources'] = [{ kind: 'org62', label: `Org62 · ${rt}`, externalId: r.org62EventId, ...(eventUrl ? { url: eventUrl } : {}), at: r.startsAt }];
  if (ev) sources.push({ kind: 'calendar', label: 'Google Calendar', externalId: ev.externalEventId, ...(ev.url ? { url: ev.url } : {}), at: ev.startsAt });
  const end = hours > 0 ? new Date(Date.parse(r.startsAt) + hours * 3_600_000).toISOString() : r.endsAt;
  return {
    dedupeKey: `org62|${r.org62EventId}`,
    origin: 'manual',
    subject: r.subject ?? '(no subject)',
    description: r.subject ?? '(no subject)',
    startsAt: r.startsAt,
    endsAt: end,
    durationHours: hours,
    seTaskType: r.seTaskTypeName,
    meetingType: internal ? null : t.meetingType,
    customerFacing: internal ? false : t.cf,
    customerRelated: internal ? false : t.cr,
    whatKind: what?.startsWith('006') ? 'opportunity' : what?.startsWith('001') ? 'account' : 'none',
    whatOrg62Id: what,
    whatName: r.whatName ?? (what ? (input.names(what)?.name ?? null) : null),
    confidence: 'sure',
    reason: replacedAll?.length ? `already in Org62 (matched ${replacedAll.map((x) => `'${x.subject}'`).join(', ')})` : 'logged in Org62',
    flags,
    status: 'logged',
    excludedReason: null,
    org62EventRowId: r.rowId,
    sources,
    remote: replaced?.remote ?? true,
    ...(internal ? { internal: true } : {}),
    // Org62's own Description is not read: the app has no note for it
    logNote: null,
    logNoteBasis: null,
  };
}

/** At most this many linked sources per evidence row (the rest is in the description's counts). */
const MAX_EVIDENCE_SOURCES = 8;

/**
 * An evidence entry's sources, one per piece of evidence, each with its link: a Claude session (continue link), a
 * Drive file (editor link), a Slack burst (its first message's permalink).
 */
function evidenceSources(ids: string[], input: WeekInput): DesiredEntry['sources'] {
  const out: DesiredEntry['sources'] = [];
  const sessions = new Map(input.sessions.map((x) => [x.rowId, x]));
  const files = new Map(input.drive.map((d) => [d.fileId, d]));
  let bursts: Map<string, SlackMessage> | undefined;
  for (const id of ids) {
    if (out.length >= MAX_EVIDENCE_SOURCES) break;
    const sess = sessions.get(id);
    if (sess) {
      out.push({ kind: 'claude', label: `Claude · ${sess.title}`, externalId: sess.rowId, ...(sess.url ? { url: sess.url } : {}), ...(sess.lastActivityAt ? { at: sess.lastActivityAt } : {}) });
      continue;
    }
    const file = files.get(id);
    if (file) {
      out.push({ kind: 'drive', label: `Drive · ${file.title}`, externalId: file.fileId, url: file.url ?? driveFileLink(file.fileId), at: file.at });
      continue;
    }
    // A Slack burst id is `<channelId>|<first message at>` (slackBursts).
    bursts ??= new Map(input.slack.map((m) => [`${m.channelId}|${m.at}`, m]));
    const first = bursts.get(id);
    if (first) out.push({ kind: 'slack', label: first.channelName ? `Slack · #${first.channelName}` : 'Slack', externalId: first.externalId ?? id, ...(first.url ? { url: first.url } : {}), at: first.at });
  }
  return out;
}

function blockLabeler(input: WeekInput, evById: Map<string, WeekEvent>, slack: SlackBurstEvidence[], onsite: OnsiteDay[]) {
  const sessions = new Map(input.sessions.map((s) => [s.rowId, s]));
  const files = new Map(input.drive.map((d) => [d.fileId, d.title]));
  const bursts = new Map(slack.map((b) => [b.id, b]));
  const days = new Map(onsite.map((d) => [d.day, d]));
  return (b: EngineBlock): string => {
    const ids = b.evidenceIds;
    if (b.source === 'onsite') {
      const d = days.get(b.localDay);
      const who = d?.whatName ?? accountByKey(input.mappings, b.accountKey)?.whatName ?? null;
      return `Onsite${who ? ` · ${who.split(' - ')[0]}` : ''}${d?.city ? ` (${d.city})` : ''}`;
    }
    if (b.source === 'travel') return `Travel · ${evById.get(ids[0] ?? '')?.title ?? 'flight'}`;
    if (b.source === 'calendar') return evById.get(ids[0] ?? '')?.title ?? 'Meeting';
    if (b.source === 'claude_hands_on' || b.source === 'claude_background') {
      const titles = ids.map((i) => sessions.get(i)?.title).filter((t): t is string => !!t);
      const head = b.repoKey ? `${b.repoKey}` : 'Claude';
      return titles.length === 1 ? `${head} · ${titles[0]}` : `${head} · ${titles.length} sessions`;
    }
    if (b.source === 'doc_edit') {
      const t = ids.map((i) => files.get(i) ?? i);
      return t.length === 1 ? `Edited ${t[0]}` : `Edited ${t.length} files`;
    }
    if (b.source === 'slack_burst') {
      const x = bursts.get(ids[0] ?? '');
      const n = ids.length > 1 || !x?.messageCount ? ids.length : x.messageCount;
      return n ? `${n} Slack message${n === 1 ? '' : 's'}` : 'Slack';
    }
    if (b.source === 'estimate') return `${ids.length} email${ids.length === 1 ? '' : 's'} sent`;
    return b.source;
  };
}

/** The local days [Mon, Sun] of the week containing `iso` in `tz`. */
export function weekOf(iso: string, tz: string): { start: string; end: string } {
  const day = localDay(iso, tz);
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d);
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  const mon = new Date(t - dow * 86_400_000).toISOString().slice(0, 10);
  const sun = new Date(t + (6 - dow) * 86_400_000).toISOString().slice(0, 10);
  return { start: mon, end: sun };
}
