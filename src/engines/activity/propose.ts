/**
 * Blocks -> proposed Solutions Event entries (create operations), plus the hands-off policy:
 * rules, go-live guard, approval. Port of pipeline.desired_drafts + blocks.build + autoplan.
 * No hour caps (2026-11-14, the owner's direction: "grounded in truth"): the only bound is what the signals show, and
 * overlapping time is never counted twice (a meeting and solo work at the same moment count once).
 * Pure: the caller supplies `now`, evidence, mappings and the Org62 read-back mirror.
 */
import { buildTimeBlocks, ENGAGED_SOURCES, humanHours, isAttendedMeeting, leverageHours } from './blocks';
import { accountByKey, classifyMeeting, heldNotOnTeam, NOT_ON_TEAM_MARKER, type MeetingDraft } from './classify';
import { newEntry, stripWhatIfNeither } from './entry';
import { internalWorkType, isInternalTaskType, personalBlockOf } from './internal';
import { type BuildEstimate, buildEstimateEntries } from './estimates';
import { isDinnerTitle, isFlightTitle, isHotelTitle, isMarkerEvent } from './event-kinds';
import { airportBuffers, DEFAULT_ONSITE_CONFIG, detectOnsite, type FlightGroup, type OnsiteDay, type OnsiteOverrides, type Trip } from './onsite';
import { isOverlapInfo, overlapInfo } from './overlap-flags';
import { placeAcross } from './placement';
import { isPhysicalLocation } from './places';
import { defaultMeetingType, isCF, isNeither, roundQuarter } from './taxonomy';
import { HOUR, type Interval, MIN, addDays, localDay, localHm, subtractIntervals, toMs, toIsoSec, unionIntervals, zonedToMs } from './time';
import {
  overlapModeOf,
  type ActivityConfig,
  type ActivityEntry,
  type ActivityMappings,
  type CalendarEvidence,
  type EvidenceBundle,
  type OverlapMode,
  type Org62EventRow,
  type RejectedProposal,
  type TimeBlock,
} from './types';

export interface AutoplanRule {
  match: string; // regex on subject (case-insensitive)
  date?: string; // local date prefix
  whatId?: string;
  whatName?: string;
  type?: string;
  hours?: number;
  action?: 'dismiss';
  why?: string;
}

export interface ProposeInput {
  /** ISO "now": decides upcoming vs past. */
  now: string;
  cfg: ActivityConfig;
  mappings: ActivityMappings;
  evidence: EvidenceBundle;
  builds?: readonly BuildEstimate[];
  org62Events?: readonly Org62EventRow[];
  rules?: readonly AutoplanRule[];
  /** Raw evidence entries on/before this local day are superseded by curated builds. */
  evidenceSupersededUntil?: string;
  /** Hands-off mode (memory): approve everything proposable with approval_method = autonomy_policy. */
  handsOff?: boolean;
  /** Calendar context around the window (hotels, flights, markers of neighbouring days) for onsite detection only. */
  calendarContext?: readonly CalendarEvidence[];
  /** The local days to decide onsite for (default: the days the window's calendar covers). */
  onsiteDays?: string[];
  /** The user's onsite corrections (Settings-free: the Time and History day chips). */
  onsiteOverrides?: OnsiteOverrides;
  /**
   * Counted time the caller owns (the user's rows): travel never overlaps it, nor do onsite frames, except (overlaps
   * `log_all_accepted`) where the row is a meeting (`meeting: true`): the onsite day keeps its span around a meeting.
   */
  reserved?: readonly { startsAt: string; endsAt: string; meeting?: boolean }[];
  /**
   * Dedupe keys of rows that will not log whatever the engine proposes (the user dismissed or excluded them): they
   * never make another row lose an overlap (D-18 amended).
   */
  notLogging?: readonly string[];
  /**
   * Counted time solo work must not count again, though the engine makes no row of it: the user's own rows and Org62
   * Events, except the user's own solo-work rows (and their Events), which the new estimate of the same work replaces.
   */
  yieldTo?: readonly { startsAt: string; endsAt: string }[];
}

export interface ActivityPlan {
  blocks: TimeBlock[];
  entries: ActivityEntry[];
  rejected: RejectedProposal[];
  /** Counted human hours across all blocks vs agent time shown separately (D-17). */
  humanHours: number;
  leverageHours: number;
  /** Onsite days decided for the window (detected, confirmed or marked not onsite), with the signals they used. */
  onsite: OnsiteDay[];
  trips: Trip[];
}

// An opp I'm not on (NOT_ON_TEAM_MARKER) holds the row too: the user checks and approves it on Time (Needs you).
const NEEDS_INPUT_MARKERS = ['NEEDS WhatId', 'OOO', 'placeholder', 'optional:', 'calendar hold', NOT_ON_TEAM_MARKER];

const whatKindOf = (id: string): ActivityEntry['whatKind'] => (!id ? 'none' : id.startsWith('006') ? 'opportunity' : id.startsWith('001') ? 'account' : 'none');

// ------------------------------------------------------------------ meetings

function meetingEntry(ev: CalendarEvidence, d: MeetingDraft): ActivityEntry {
  const flags = [...d.flags];
  const exactMin = (toMs(ev.endsAt) - toMs(ev.startsAt)) / MIN;
  const diff = Math.abs(d.hours * 60 - exactMin);
  if (diff > 5) flags.push(`Duration__c ${d.hours} h differs from End-Start by ${Math.round(diff)} min`); // D-40
  return newEntry({
    dedupeKey: `cal|${ev.id}|${ev.startsAt}`,
    origin: 'calendar',
    subject: d.subject,
    startsAt: ev.startsAt,
    endsAt: ev.endsAt,
    durationHours: d.hours,
    seTaskType: d.seTaskType,
    meetingType: d.meetingType,
    whatKind: whatKindOf(d.whatId),
    whatOrg62Id: d.whatId || null,
    whatName: d.whatName || null,
    accountKey: d.accountKey,
    customerFacing: d.cf,
    customerRelated: d.cf,
    extDomains: d.extDomains,
    confidence: d.confidence,
    reason: d.reason,
    flags,
    evidence: d.evidence,
    evidenceIds: [ev.id],
    ...(d.internal ? { internal: true } : {}),
  });
}

/** Flights with no trip account, next to a multi-hour customer meeting, become Travel on that account (flagged). */
function linkTravel(flight: CalendarEvidence, items: { ev: CalendarEvidence; d: MeetingDraft }[], mappings: ActivityMappings): { accountKey: string; whatId: string; whatName: string; subject: string } | null {
  const meets = items.filter((x) => x.d.accountKey && x.d.cf && x.d.hours >= 2);
  const fs = toMs(flight.startsAt);
  for (const m of meets) {
    const ms = toMs(m.ev.startsAt);
    const me = toMs(m.ev.endsAt);
    const near = (ms - fs >= 0 && ms - fs <= 48 * HOUR) || (fs - me >= 0 && fs - me <= 48 * HOUR);
    if (!near) continue;
    const acct = accountByKey(mappings, m.d.accountKey);
    return { accountKey: m.d.accountKey!, whatId: acct?.whatId ?? m.d.whatId, whatName: m.d.whatName, subject: m.d.subject };
  }
  return null;
}

/** What the engine itself says an event is (flight, hotel, marker), whatever the caller guessed. */
export function eventKind(ev: CalendarEvidence, tz: string): CalendarEvidence['kind'] {
  if (ev.kind === 'ooo' || ev.kind === 'focus' || ev.kind === 'working_location') return ev.kind;
  if (!ev.allDay && isFlightTitle(ev.summary)) return 'flight';
  if (isHotelTitle(ev.summary) && (ev.allDay || (toMs(ev.endsAt) - toMs(ev.startsAt)) / HOUR >= 12)) return 'hotel';
  if (!ev.allDay && isMarkerEvent(ev, tz)) return 'marker';
  return 'default';
}

interface MeetingCtx {
  onsiteByDay: Map<string, OnsiteDay>;
  /** Meetings that will not log: they never win (or lose) an overlap. */
  notLogging: ReadonlySet<string>;
  mode: OverlapMode;
}

type MeetingItem = { ev: CalendarEvidence; d: MeetingDraft };
const meetingKey = (ev: Pick<CalendarEvidence, 'id' | 'startsAt'>): string => `cal|${ev.id}|${ev.startsAt}`;

/**
 * The accepted, attended meetings of the window, classified (markers, unanswered and unattended invites are rejected).
 * A personal block (lunch, an appointment, a focus or "BLOCK" hold of my own) is no meeting: rejected, its key added to
 * `personal` so it never claims time; the work I did in it counts from my own actions, like any solo time.
 */
function classifyMeetings(evidence: EvidenceBundle, mappings: ActivityMappings, cfg: ActivityConfig, rejected: RejectedProposal[], dinnersCustomerFacing: boolean, personal: Set<string>): MeetingItem[] {
  const internalActivity = cfg.internalActivity === true;
  const items: MeetingItem[] = [];
  for (const ev of evidence.calendar) {
    if (ev.deleted || ev.allDay || ev.kind === 'ooo' || ev.kind === 'focus' || ev.kind === 'flight' || ev.kind === 'hotel' || ev.kind === 'working_location') continue;
    const key = `cal|${ev.id}|${ev.startsAt}`;
    if (ev.kind === 'marker') {
      const h = Math.round((toMs(ev.endsAt) - toMs(ev.startsAt)) / HOUR);
      rejected.push({ dedupeKey: key, subject: ev.summary, startsAt: ev.startsAt, hours: 0, reason: 'placeholder', note: `a ${h} h block marks the day(s), it is not a meeting` });
      continue;
    }
    // a meeting I declined never logs, also one I organize (an instance of my own series I declined, D-64)
    if ((ev.selfResponse !== 'accepted' && !ev.organizerSelf) || ev.selfResponse === 'declined') {
      rejected.push({ dedupeKey: key, subject: ev.summary, startsAt: ev.startsAt, hours: 0, reason: 'not_accepted', note: `invite is ${ev.selfResponse}` });
      continue;
    }
    if (ev.attended === false) {
      rejected.push({ dedupeKey: key, subject: ev.summary, startsAt: ev.startsAt, hours: 0, reason: 'not_attended', note: 'accepted but not attended' });
      continue;
    }
    const block = personalBlockOf(ev, mappings);
    if (block) {
      personal.add(key);
      rejected.push({ dedupeKey: key, subject: ev.summary, startsAt: ev.startsAt, hours: 0, reason: 'personal', note: block });
      continue;
    }
    items.push({ ev, d: classifyMeeting(ev, mappings, localDay(toMs(ev.startsAt), cfg.timezone), { dinnersCustomerFacing, internalActivity }) });
  }
  return items;
}

/** The first rule that matches a subject on a day dismisses it (applyRules, decided before the overlaps are). */
function ruleDismisses(subject: string, day: string, rules: readonly AutoplanRule[]): boolean {
  for (const r of rules) {
    if (!new RegExp(r.match, 'i').test(subject)) continue;
    if (r.date && !day.startsWith(r.date)) continue;
    return r.action === 'dismiss';
  }
  return false;
}

/**
 * Meetings that will not log, whatever they overlap: rounds to 0 h, Neither CF nor CR (Admin), a `skip` mapping, a
 * dismiss rule, or a row the user dismissed. They never make another row lose an overlap (D-18 amended).
 */
function notLoggingKeys(items: readonly MeetingItem[], rules: readonly AutoplanRule[], userKeys: readonly string[], tz: string): Set<string> {
  const out = new Set(userKeys);
  for (const { ev, d } of items) if (d.hours <= 0 || d.skipReason || ruleDismisses(d.subject, localDay(toMs(ev.startsAt), tz), rules)) out.add(meetingKey(ev));
  return out;
}

function meetingEntries(
  items: readonly MeetingItem[],
  evidence: EvidenceBundle,
  blocks: readonly TimeBlock[],
  mappings: ActivityMappings,
  cfg: ActivityConfig,
  rejected: RejectedProposal[],
  ctx: MeetingCtx,
): ActivityEntry[] {
  const lostKeys = new Set(blocks.filter((b) => b.isOverlay && b.attention === 'meeting' && b.source === 'calendar').map((b) => b.dedupeKey.split('~overlay')[0]!));
  const counted = blocks.filter((b) => !b.isOverlay && b.attention === 'meeting' && b.source === 'calendar');
  const oooList = evidence.calendar.filter((e) => e.kind === 'ooo' && !e.deleted && (toMs(e.endsAt) - toMs(e.startsAt)) / MIN < 1440);
  // log_all_accepted: every accepted meeting that logs keeps its row; the ones it overlaps are named on it
  const logging = items.filter(({ ev }) => !ctx.notLogging.has(meetingKey(ev)));

  const out: ActivityEntry[] = [];
  for (const { ev, d } of items) {
    const key = meetingKey(ev);
    if (d.hours <= 0) {
      rejected.push({ dedupeKey: key, subject: ev.summary, startsAt: ev.startsAt, hours: d.hours, reason: 'below_minimum', note: 'rounds to 0 h' });
      continue;
    }
    // On an onsite day, the trip's meetings log to the trip's account and opp (one for the whole trip), in person.
    const od = ctx.onsiteByDay.get(localDay(toMs(ev.startsAt), cfg.timezone));
    let tripKey: string | null = null;
    let remote = true;
    if (od && od.status !== 'not_onsite' && od.accountKey) {
      const external = d.extDomains.length > 0;
      const unnamed = !d.accountKey && external && isPhysicalLocation(ev.location);
      if (d.accountKey === od.accountKey || unnamed) {
        if (unnamed) d.flags.push('account from your onsite trip; confirm');
        const acct = accountByKey(mappings, od.accountKey);
        Object.assign(d, { accountKey: od.accountKey, whatId: od.whatId ?? acct?.whatId ?? '', whatName: od.whatName ?? acct?.whatName ?? '' });
        d.flags = d.flags.filter((f) => !/^NEEDS WhatId|^WhatId = account fallback/.test(f) || !od.whatId);
        tripKey = od.tripKey ?? `day|${od.day}`;
        remote = false;
      } else if (isPhysicalLocation(ev.location) && external) {
        remote = false;
      }
    } else if (isPhysicalLocation(ev.location) && d.extDomains.length > 0) {
      remote = false;
    }
    if (isDinnerTitle(ev.summary) && d.extDomains.length > 0) remote = false;
    let e = meetingEntry(ev, d);
    e.remote = remote;
    e.tripKey = tripKey;
    e = stripWhatIfNeither(e);
    const s = toMs(ev.startsAt);
    const en = toMs(ev.endsAt);
    for (const o of oooList)
      if (toMs(o.startsAt) < en && s < toMs(o.endsAt)) {
        e.flags.push(`overlaps OOO '${o.summary}' (${localHm(toMs(o.startsAt), cfg.timezone)}); trim or drop`);
        break;
      }
    if (d.skipReason) {
      e.status = 'excluded';
      e.excludedReason = 'neither_type';
      e.flags.push(d.skipReason);
    } else if (ctx.notLogging.has(key)) {
      // a dismiss rule or the user's dismissal decides this row; it neither wins nor loses an overlap
    } else if (ctx.mode === 'log_all_accepted') {
      for (const o of logging) {
        if (o.ev === ev) continue;
        const from = Math.max(s, toMs(o.ev.startsAt));
        const to = Math.min(en, toMs(o.ev.endsAt));
        if (to - from >= MIN) e.flags.push(overlapInfo(o.ev.summary, from, to, cfg.timezone));
      }
    } else if (lostKeys.has(key)) {
      const winner = counted.find((b) => b.dedupeKey !== key && toMs(b.startsAt) < en && s < toMs(b.endsAt));
      e.status = 'excluded';
      e.excludedReason = 'overlap';
      e.flags.push(`double-booked${winner ? ` with ${winner.evidenceIds[0]}` : ''}: hours are human hours, counted once`);
    }
    out.push(e);
  }
  return out;
}

// ------------------------------------------------------------------ travel and onsite frames

/** Split an interval at local midnight: nothing is ever overnight. */
export function splitAtMidnight(x: Interval, tz: string): Interval[] {
  const out: Interval[] = [];
  let s = x.start;
  for (let i = 0; i < 8 && s < x.end; i++) {
    const next = zonedToMs(addDays(localDay(s, tz), 1), '00:00', tz);
    const e = Math.min(x.end, next);
    out.push({ start: s, end: e });
    s = e;
  }
  return out;
}

interface TravelItem {
  flight: FlightGroup;
  ev: CalendarEvidence;
  trip: Trip | null;
  pieces: { key: string; iv: Interval }[];
}

/**
 * Each flight (duplicates merged) plus the airport buffers (Settings ▸ Time: 120 min before it, 60 min after it by
 * default), split at midnight, minus reserved time.
 */
function travelPlan(flights: FlightGroup[], trips: Trip[], cal: readonly CalendarEvidence[], cfg: ActivityConfig, reserved: Interval[]): TravelItem[] {
  const buf = airportBuffers(cfg.onsite ?? DEFAULT_ONSITE_CONFIG);
  const byId = new Map(cal.map((e) => [e.id, e]));
  const out: TravelItem[] = [];
  for (const f of flights) {
    const ev = byId.get(f.keepId);
    if (!ev) continue;
    const trip = trips.find((t) => t.flightIds.includes(f.keepId)) ?? trips.find((t) => f.arr >= t.presence.start - 12 * HOUR && f.dep <= t.presence.end + 12 * HOUR) ?? null;
    const base = `cal|${ev.id}|${ev.startsAt}`;
    const free = subtractIntervals(splitAtMidnight({ start: f.dep - buf.beforeMin * MIN, end: f.arr + buf.afterMin * MIN }, cfg.timezone), reserved).filter((x) => x.end - x.start >= MIN);
    out.push({ flight: f, ev, trip, pieces: free.map((iv, i) => ({ key: i === 0 ? base : `${base}@${toIsoSec(iv.start)}`, iv })) });
  }
  return out;
}

function travelEntries(items: TravelItem[], blocks: readonly TimeBlock[], meetings: { ev: CalendarEvidence; d: MeetingDraft }[], mappings: ActivityMappings, rejected: RejectedProposal[]): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  for (const t of items) {
    for (const id of t.flight.ids.filter((x) => x !== t.flight.keepId))
      rejected.push({ dedupeKey: `cal|${id}|${t.ev.startsAt}`, subject: t.flight.title, startsAt: t.ev.startsAt, hours: 0, reason: 'duplicate', note: `same flight as ${t.flight.keepId}: counted once` });
    const trip = t.trip?.accountKey ? t.trip : null;
    const linked = trip ? null : linkTravel(t.ev, meetings, mappings);
    const pieces = blocks.filter((b) => b.source === 'travel' && b.countsAsHumanHours && t.pieces.some((p) => b.dedupeKey === p.key || b.dedupeKey.startsWith(`${p.key}#`)));
    for (const b of pieces) {
      const hours = roundQuarter((toMs(b.endsAt) - toMs(b.startsAt)) / HOUR);
      if (hours <= 0) continue;
      const whatId = trip?.whatId ?? linked?.whatId ?? '';
      const customer = !!(trip || linked);
      const flags: string[] = [];
      if (t.flight.ids.length > 1) flags.push(`in your calendar ${t.flight.ids.length} times: counted once`);
      if (linked) flags.push('travel linked to a customer meeting; confirm');
      // A flight is always Travel (2026-11-14; Org62 precedent: Travel with Related To empty is common): on the trip's
      // opp when the trip is a customer's, else internal Travel with no opp (D-64).
      const e = newEntry({
        dedupeKey: b.dedupeKey,
        origin: 'calendar',
        subject: t.flight.title,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        durationHours: hours,
        seTaskType: 'Travel',
        whatKind: whatKindOf(whatId),
        whatOrg62Id: whatId || null,
        whatName: trip?.whatName ?? linked?.whatName ?? null,
        accountKey: trip?.accountKey ?? linked?.accountKey ?? null,
        customerFacing: false,
        customerRelated: customer,
        confidence: trip ? (trip.marked ? 'High' : 'Medium') : linked ? 'Low' : 'Medium',
        reason: trip
          ? `travel for your trip${t.trip?.city ? ` to ${t.trip.city}` : ''} (flight plus the airport buffers)`
          : linked
            ? `travel for '${linked.subject}'`
            : 'internal: a flight with no customer trip (Travel, no opp; flight plus the airport buffers)',
        evidence: '',
        evidenceIds: t.flight.ids,
        flags,
        ...(customer ? {} : { internal: true }),
      });
      e.remote = false;
      e.tripKey = trip?.key ?? null;
      out.push(e);
    }
  }
  return out;
}

/** The day's onsite type: the most-hours customer-facing type of its sessions, else Customer Discovery. */
function frameType(day: string, meetings: readonly ActivityEntry[], tz: string): string {
  const by = new Map<string, number>();
  for (const m of meetings) {
    if (m.status === 'excluded' || !m.tripKey || !m.seTaskType || !isCF(m.seTaskType) || localDay(toMs(m.startsAt), tz) !== day) continue;
    by.set(m.seTaskType, (by.get(m.seTaskType) ?? 0) + m.durationHours);
  }
  return [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'Customer Discovery';
}

type FramePiece = { dedupeKey: string; startsAt: string; endsAt: string };
type FrameInput = { key: string; iv: Interval; accountKey: string | null; evidenceIds: string[] };

/**
 * The pieces of each onsite day that log. `count_once`: what the counted blocks left (the gaps between sessions).
 * `log_all_accepted`: the whole frame (D-18 amended): meetings during it log as their own rows too; only travel (and
 * the user's own non-meeting rows, already out of `frames`) takes time out of it. Keys follow the blocks' naming.
 */
function framePieces(mode: OverlapMode, frames: readonly FrameInput[], blocks: readonly TimeBlock[], travel: readonly Interval[]): (day: string) => FramePiece[] {
  const mine = (day: string) => (k: string) => k === `onsite|${day}` || k.startsWith(`onsite|${day}#`);
  if (mode === 'count_once') return (day) => blocks.filter((b) => b.source === 'onsite' && b.countsAsHumanHours && mine(day)(b.dedupeKey));
  const all: FramePiece[] = [];
  for (const f of frames) {
    const free = subtractIntervals([f.iv], travel).filter((x) => x.end - x.start >= MIN);
    free.forEach((iv, i) => all.push({ dedupeKey: free.length === 1 ? f.key : `${f.key}#${i + 1}`, startsAt: toIsoSec(iv.start), endsAt: toIsoSec(iv.end) }));
  }
  return (day) => all.filter((p) => mine(day)(p.dedupeKey));
}

function frameEntries(days: OnsiteDay[], piecesOf: (day: string) => FramePiece[], meetings: readonly ActivityEntry[], mappings: ActivityMappings, cfg: ActivityConfig): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  const whole = overlapModeOf(cfg) === 'log_all_accepted';
  for (const d of days) {
    if (d.status === 'not_onsite' || !d.frame || d.signals.some((s) => s.kind === 'org62')) continue;
    const pieces = piecesOf(d.day);
    const acct = accountByKey(mappings, d.accountKey);
    const label = acct ? acct.whatName.split(' - ')[0]! : 'a customer';
    const type = frameType(d.day, meetings, cfg.timezone);
    const used = d.signals.filter((s) => s.used && s.kind !== 'flight').map((s) => s.label);
    for (const b of pieces) {
      const hours = roundQuarter((toMs(b.endsAt) - toMs(b.startsAt)) / HOUR);
      if (hours <= 0) continue;
      const flags: string[] = [];
      if (!d.whatId) flags.push('NEEDS WhatId: which account was this onsite for? Change account on the day chip');
      const e = newEntry({
        dedupeKey: b.dedupeKey,
        origin: 'calendar',
        subject: `Onsite: ${label}${d.city ? ` (${d.city})` : ''}`,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        durationHours: hours,
        seTaskType: type,
        meetingType: defaultMeetingType(type, null),
        whatKind: whatKindOf(d.whatId ?? ''),
        whatOrg62Id: d.whatId,
        whatName: d.whatName,
        accountKey: d.accountKey,
        customerFacing: isCF(type),
        customerRelated: true,
        confidence: d.status === 'confirmed' ? 'High' : 'Medium',
        reason: whole
          ? `onsite day${d.city ? ` in ${d.city}` : ''}: the whole day (${d.hoursLabel}); your meetings during it log too`
          : `onsite day${d.city ? ` in ${d.city}` : ''}: fills the time between your sessions (${d.hoursLabel})`,
        evidence: used.slice(0, 4).join(' · '),
        evidenceIds: d.signals.flatMap((s) => s.evidenceIds).slice(0, 12),
        flags,
      });
      e.remote = false;
      e.tripKey = d.tripKey ?? `day|${d.day}`;
      out.push(e);
    }
  }
  return out;
}

// ------------------------------------------------------------------ solo work (engaged time)

const ESTIMATE_RE = /estimat|consumption|calculator|flex|sizing|burn/;

/** What one day's engaged time in one bucket was made of (the row's evidence line). */
function engagedSummary(blocks: readonly TimeBlock[], ev: EvidenceBundle): string {
  const ids = new Set(blocks.flatMap((b) => b.evidenceIds));
  const within = (t: string) => blocks.some((b) => toMs(b.startsAt) <= toMs(t) && toMs(t) < toMs(b.endsAt));
  // distinct prompt times (a forked session repeats its parent's prompts)
  const prompts = new Set(ev.claude.filter((c) => ids.has(c.sessionId)).flatMap((c) => [...(c.turns ?? []).map((t) => toMs(t.at)), ...(c.promptTimes ?? []).map(toMs)].filter((t) => within(new Date(t).toISOString())))).size;
  const slack = (ev.slackMessages ?? []).filter((m) => ids.has(m.id)).length;
  const docs = new Set(ev.drive.filter((d) => ids.has(d.fileId)).map((d) => d.fileId)).size;
  const emails = (ev.emails ?? []).filter((m) => ids.has(m.id)).length;
  const bits = [
    prompts ? `${prompts} prompt${prompts === 1 ? '' : 's'}` : null,
    slack ? `${slack} Slack message${slack === 1 ? '' : 's'}` : null,
    docs ? `${docs} Drive edit${docs === 1 ? '' : 's'}` : null,
    emails ? `${emails} email${emails === 1 ? '' : 's'} sent` : null,
  ].filter(Boolean);
  return bits.length ? bits.join(', ') : 'your own actions';
}

/**
 * Engaged solo time → rows, one per local day and bucket (the account, else the repo, else unmapped Drive docs, else
 * unmapped Slack and email), its hours the day's engaged minutes in that bucket rounded once to 0.25 h (D-40). The row
 * sits in the day's free time from its first engaged minute (meetings, travel, onsite days, Org62 Events, the user's
 * rows and rows placed before it are busy), split into `#2`, `#3` … only where one free gap is too short. No caps: the
 * only bound is the signals (2026-11-14).
 */
function evidenceEntries(
  blocks: readonly TimeBlock[],
  mappings: ActivityMappings,
  cfg: ActivityConfig,
  evidence: EvidenceBundle,
  rejected: RejectedProposal[],
  busyByDay: Map<string, Interval[]>,
): ActivityEntry[] {
  const titles = new Map(evidence.drive.map((d) => [d.fileId, d.title]));
  const sessionTitles = new Map(evidence.claude.map((c) => [c.sessionId, c.title ?? '']));
  type G = { day: string; bucket: string; blocks: TimeBlock[] };
  const groups = new Map<string, G>();
  for (const b of blocks) {
    if (!b.countsAsHumanHours || !ENGAGED_SOURCES.has(b.source)) continue;
    const comms = b.source === 'slack_burst' || b.source === 'estimate';
    const bucket = b.accountKey ? `acct:${b.accountKey}` : b.repoKey ? `repo:${b.repoKey}` : comms ? 'comms:unmapped' : 'docs:unmapped';
    const k = `${b.localDay}|${bucket}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { day: b.localDay, bucket, blocks: [] }));
    g.blocks.push(b);
  }
  const out: ActivityEntry[] = [];
  const firstOf = (g: G) => g.blocks.reduce((m, b) => Math.min(m, toMs(b.startsAt)), Infinity);
  // the earliest work of the day is placed first, at its own time
  for (const g of [...groups.values()].sort((a, b) => a.day.localeCompare(b.day) || firstOf(a) - firstOf(b) || a.bucket.localeCompare(b.bucket))) {
    const ms = (b: TimeBlock) => toMs(b.endsAt) - toMs(b.startsAt);
    const hours = roundQuarter(g.blocks.reduce((s, b) => s + ms(b), 0) / HOUR);
    const key = `wb|${g.day}|${g.bucket}`;
    const first = firstOf(g);
    const acct = g.bucket.startsWith('acct:') ? accountByKey(mappings, g.bucket.slice(5)) : null;
    const repos = [...new Set(g.blocks.map((b) => b.repoKey).filter((x): x is string => !!x))].sort();
    const docTitles = [...new Set(g.blocks.flatMap((b) => b.evidenceIds.map((id) => titles.get(id)).filter((t): t is string => !!t)))].sort();
    const sessTitles = [...new Set(g.blocks.flatMap((b) => b.evidenceIds.map((id) => sessionTitles.get(id)).filter((t): t is string => !!t)))].sort();
    if (hours < cfg.evidence.minBlockH) {
      rejected.push({ dedupeKey: key, subject: g.bucket, startsAt: new Date(first).toISOString(), hours, reason: 'below_minimum', note: `under ${cfg.evidence.minBlockH} h` });
      continue;
    }
    const comms = g.bucket === 'comms:unmapped';
    const neither = !acct ? (repos.map((r) => mappings.neitherRepos[r]).find(Boolean) ?? null) : null;
    const text = [...repos, ...docTitles, ...sessTitles].join(' ').toLowerCase();
    let ttype = ESTIMATE_RE.test(text) ? 'Consumption Estimation' : 'Solution Creation';
    if (neither) ttype = neither;
    // D-64: work no account or opp matched is internal-only work. A repo or Drive docs: Asset Creation unless it names
    // learning or enablement (a repo mapped to an internal type keeps it); Slack and email that name no account: Admin
    // (internal coordination). A mapped repo, session, channel or doc keeps its account and opp (above).
    const internalType: { type: string; reason: string } | null =
      !acct && cfg.internalActivity && (!neither || isInternalTaskType(neither))
        ? neither && isInternalTaskType(neither)
          ? { type: neither, reason: `${repos[0] ?? 'repo'} mapped to ${neither}` }
          : comms
            ? { type: 'Admin', reason: 'Slack and email that name no account (internal coordination)' }
            : internalWorkType(text)
        : null;
    if (internalType) ttype = internalType.type;
    const kinds = new Set(g.blocks.map((b) => b.source));
    const commsLabel = kinds.has('slack_burst') && kinds.has('estimate') ? 'Slack and email' : kinds.has('estimate') ? 'Email' : 'Slack';
    const label = acct
      ? acct.whatName.split(' - ')[0]!
      : repos[0]
        ? repos[0]
        : comms
          ? internalType
            ? commsLabel
            : `Unmapped ${commsLabel}`
          : internalType
            ? docTitles.length === 1
              ? docTitles[0]!
              : `${docTitles.length} Drive docs`
            : `${docTitles.length} unmapped doc(s)`;
    const what = internalType
      ? comms
        ? 'internal coordination'
        : `internal ${internalType.type === 'Personal Development' ? 'learning' : internalType.type === 'Sales Enablement' ? 'enablement' : 'asset build'}`
      : ttype === 'Consumption Estimation'
        ? 'off-calendar estimate work'
        : 'off-calendar build/prep';
    const sources = [...new Set(g.blocks.map((b) => b.source))].sort();
    const evBits = [`engaged ${hours} h (${engagedSummary(g.blocks, evidence)}; ${sources.join(', ')})`];
    if (docTitles.length) evBits.push(`edited ${docTitles.length} doc(s): ${docTitles.slice(0, 3).join('; ')}`);
    const placed = placeAcross(g.day, hours, first, busyByDay.get(g.day) ?? [], cfg.timezone);
    if (placed.unplaced > 0)
      rejected.push({ dedupeKey: key, subject: `${label}: ${what}`, startsAt: new Date(first).toISOString(), hours: placed.unplaced, reason: 'duplicate', note: 'no free time left that day: the rest is already logged' });
    // a row that will not log (a Neither repo's work) takes no time from the rows after it
    if (internalType || !neither) busyByDay.set(g.day, [...(busyByDay.get(g.day) ?? []), ...placed.pieces]);
    const parts = placed.pieces.length;
    placed.pieces.forEach((iv, i) => {
      const flags = ['GUESS: hours estimated from evidence; adjust with `=> 1.5h`'];
      if (parts > 1) flags.push(`${hours} h that day, in ${parts} parts around your meetings (part ${i + 1})`);
      let e = newEntry({
        dedupeKey: i === 0 ? key : `${key}#${i + 1}`,
        origin: 'evidence',
        subject: `${label}: ${what}`,
        startsAt: toIsoSec(iv.start),
        endsAt: toIsoSec(iv.end),
        durationHours: roundQuarter((iv.end - iv.start) / HOUR),
        seTaskType: ttype,
        whatKind: acct ? whatKindOf(acct.whatId) : 'none',
        whatOrg62Id: acct?.whatId || null,
        whatName: acct?.whatName ?? null,
        accountKey: acct?.key ?? null,
        confidence: 'Low',
        reason: internalType
          ? `internal: ${internalType.reason}; no account or opp matched (engaged time from your own actions)`
          : 'engaged time from your own actions (prompts, Slack, Drive, email)',
        evidence: evBits.join(' · '),
        evidenceIds: [...new Set(g.blocks.flatMap((b) => b.evidenceIds))],
        flags,
        ...(internalType ? { internal: true } : {}),
      });
      if (internalType) {
        // complete: no WhatId by design, an internal type, so it never asks for an opp (it waits for your Log)
      } else if (neither) {
        e.status = 'excluded';
        e.excludedReason = 'neither_type';
        e.flags.push(`${repos[0] ?? 'evidence'}: '${neither}' work (demo org / tooling), Neither CF nor CR. Add \`=> 006…\` if it was for a deal`);
      } else if (!acct) {
        e.flags.push('NEEDS WhatId: which account/opp was this for? write `=> 006…` or `=> skip`');
      }
      e = stripWhatIfNeither(e);
      out.push(e);
    });
  }
  return out;
}

// ------------------------------------------------------------------ rules, status, approval

export function applyRules(entries: ActivityEntry[], rules: readonly AutoplanRule[], tz: string): ActivityEntry[] {
  return entries.map((e) => {
    if (e.status !== 'proposed' && e.status !== 'needs_input') return e;
    const day = localDay(toMs(e.startsAt), tz);
    for (const r of rules) {
      if (!new RegExp(r.match, 'i').test(e.subject)) continue;
      if (r.date && !day.startsWith(r.date)) continue;
      if (r.action === 'dismiss') return { ...e, status: 'dismissed', flags: [...e.flags, r.why ?? 'auto-dismissed'] };
      const n = { ...e, flags: [...e.flags, r.why ?? 'auto-resolved'] };
      if (r.whatId) Object.assign(n, { whatOrg62Id: r.whatId, whatKind: whatKindOf(r.whatId), whatName: r.whatName ?? n.whatName });
      if (r.type) Object.assign(n, { seTaskType: r.type, meetingType: defaultMeetingType(r.type, n.meetingType) });
      if (r.hours) {
        n.durationHours = roundQuarter(r.hours);
        n.endsAt = toIsoSec(toMs(n.startsAt) + n.durationHours * HOUR);
      }
      return stripWhatIfNeither(n);
    }
    return e;
  });
}

/** upcoming / needs_input / proposed for entries the engine still owns. */
export function finalizeStatus(e: ActivityEntry, now: number): ActivityEntry {
  if (e.status !== 'proposed' && e.status !== 'needs_input' && e.status !== 'upcoming') return e;
  let status: ActivityEntry['status'];
  const type = e.seTaskType ?? '';
  const flagged = e.flags.some((f) => !isOverlapInfo(f) && NEEDS_INPUT_MARKERS.some((m) => f.includes(m)));
  if (toMs(e.endsAt) > now) status = 'upcoming';
  else if ((!e.whatOrg62Id && type !== 'Travel' && !isNeither(type)) || flagged) status = 'needs_input';
  else status = 'proposed';
  return status === e.status ? e : { ...e, status };
}

/**
 * Hands-off approval (autoplan.approve_all). Neither-type rows approve only when they are builds. A row on an opp I'm
 * not on the team of is never approved here: only the user approves it (Time ▸ Needs you, "Check and approve").
 */
export function autoApprove(entries: readonly ActivityEntry[], nowIso: string): ActivityEntry[] {
  const now = toMs(nowIso);
  return entries.map((e) => {
    if ((e.status !== 'proposed' && e.status !== 'needs_input') || e.operation !== 'create' || toMs(e.endsAt) > now) return e;
    if (heldNotOnTeam(e.flags)) return e;
    // D-64: an internal row waits for the user's own Log (or Dismiss)
    if (e.internal) return e;
    const type = e.seTaskType ?? '';
    const neither = isNeither(type);
    if (neither && e.origin !== 'build_estimate') return e;
    if (!e.whatOrg62Id && type !== 'Travel' && !neither) return e;
    return { ...e, status: 'approved', approvedAt: nowIso, approvalMethod: 'autonomy_policy' };
  });
}

// ------------------------------------------------------------------ orchestrator

/** The local days a calendar covers (the onsite window when the caller names none). */
function daysOf(cal: readonly CalendarEvidence[], tz: string): string[] {
  const timed = cal.filter((e) => !e.allDay).map((e) => toMs(e.startsAt));
  if (!timed.length) return [];
  const out: string[] = [];
  for (let d = localDay(Math.min(...timed), tz); d <= localDay(Math.max(...timed), tz) && out.length < 62; d = addDays(d, 1)) out.push(d);
  return out;
}

export function proposeActivity(input: ProposeInput): ActivityPlan {
  const { cfg, mappings } = input;
  const tz = cfg.timezone;
  const now = toMs(input.now);
  const mode = overlapModeOf(cfg);
  const rejected: RejectedProposal[] = [];
  const onsiteCfg = cfg.onsite ?? DEFAULT_ONSITE_CONFIG;
  const norm = (e: CalendarEvidence): CalendarEvidence => ({ ...e, kind: eventKind(e, tz) });
  const evidence: EvidenceBundle = { ...input.evidence, calendar: input.evidence.calendar.map(norm) };
  const ids = new Set(evidence.calendar.map((e) => e.id));
  const context = [...evidence.calendar, ...(input.calendarContext ?? []).filter((e) => !ids.has(e.id)).map(norm)];

  // Onsite days and trips (onsite.ts), then travel and frames: both fill only time nobody else owns.
  const onsite = detectOnsite({ days: input.onsiteDays ?? daysOf(evidence.calendar, tz), tz, cfg: onsiteCfg, events: context, mappings, org62Events: input.org62Events, overrides: input.onsiteOverrides });
  const onsiteByDay = new Map(onsite.days.map((d) => [d.day, d]));
  const iv = (r: { startsAt: string; endsAt: string }): Interval => ({ start: toMs(r.startsAt), end: toMs(r.endsAt) });
  const reserved = unionIntervals([...(input.reserved ?? []), ...(input.org62Events ?? [])].map(iv));
  // The onsite day yields to travel and to the user's own rows; with overlaps `log_all_accepted` not to a meeting row
  // (the user's approved meeting, or an Org62 Event that is an accepted meeting's twin: same slot, within 5 min).
  const accepted = evidence.calendar.filter(isAttendedMeeting).map(iv);
  const meetingTwin = (r: Org62EventRow) => accepted.some((m) => Math.abs(m.start - toMs(r.startsAt)) <= 5 * MIN && m.start < toMs(r.endsAt) && toMs(r.startsAt) < m.end);
  const frameReserved =
    mode === 'count_once' ? reserved : unionIntervals([...(input.reserved ?? []).filter((r) => !r.meeting), ...(input.org62Events ?? []).filter((r) => !meetingTwin(r))].map(iv));
  const inWindow = new Set(evidence.calendar.map((e) => e.id));
  const travel = travelPlan(onsite.flights.filter((f) => inWindow.has(f.keepId)), onsite.trips, evidence.calendar, cfg, reserved);
  const frames: FrameInput[] = onsite.days
    .filter((d) => d.frame && d.status !== 'not_onsite' && !d.signals.some((s) => s.kind === 'org62'))
    .flatMap((d) => subtractIntervals([{ start: toMs(d.frame!.startsAt), end: toMs(d.frame!.endsAt) }], frameReserved).map((x, i) => ({ key: i === 0 ? `onsite|${d.day}` : `onsite|${d.day}#p${i + 1}`, iv: x, accountKey: d.accountKey, evidenceIds: d.signals.flatMap((s) => s.evidenceIds).slice(0, 12) })));

  // Meetings are classified first: the ones that will not log never claim time from a row that does (D-18 amended).
  const personal = new Set<string>();
  const items = classifyMeetings(evidence, mappings, cfg, rejected, onsiteCfg.dinnersCustomerFacing, personal);
  const notLogging = notLoggingKeys(items, input.rules ?? [], [...(input.notLogging ?? []), ...personal], tz);
  const blocks = buildTimeBlocks(evidence, mappings, cfg, {
    travel: travel.flatMap((t) => t.pieces.map((p) => ({ key: p.key, iv: p.iv, accountKey: t.trip?.accountKey ?? null, evidenceIds: t.flight.ids }))),
    frames,
    nonLogging: notLogging,
    notMeetings: personal,
    yieldTo: unionIntervals((input.yieldTo ?? []).map(iv)),
  });

  const meetings = [...meetingEntries(items, evidence, blocks, mappings, cfg, rejected, { onsiteByDay, notLogging, mode }), ...travelEntries(travel, blocks, items, mappings, rejected)];
  const travelIv = travel.flatMap((t) => t.pieces.map((p) => p.iv));
  meetings.push(...frameEntries(onsite.days, framePieces(mode, frames, blocks, travelIv), meetings, mappings, cfg));

  // Busy time that estimated work must not double-book.
  const busyByDay = new Map<string, Interval[]>();
  const addBusy = (startsAt: string, endsAt: string) => {
    const s = toMs(startsAt);
    const d = localDay(s, tz);
    busyByDay.set(d, [...(busyByDay.get(d) ?? []), { start: s, end: toMs(endsAt) }]);
  };
  for (const r of input.org62Events ?? []) addBusy(r.startsAt, r.endsAt);
  // the user's own rows (approved and later, edited): a solo-work row is never placed over one
  for (const r of input.reserved ?? []) addBusy(r.startsAt, r.endsAt);
  const userDead = new Set(input.notLogging ?? []);
  for (const m of meetings) if (m.status !== 'excluded' && !userDead.has(m.dedupeKey)) addBusy(m.startsAt, m.endsAt);
  for (const o of evidence.calendar) if (o.kind === 'ooo' && !o.deleted && (toMs(o.endsAt) - toMs(o.startsAt)) / MIN < 720) addBusy(o.startsAt, o.endsAt);

  let evid = evidenceEntries(blocks, mappings, cfg, evidence, rejected, busyByDay);
  // Go-live guard (memory): estimates before mid-September are never proposed.
  evid = evid.filter((e) => {
    const day = localDay(toMs(e.startsAt), tz);
    if (day < cfg.liveFrom) {
      rejected.push({ dedupeKey: e.dedupeKey, subject: e.subject, startsAt: e.startsAt, hours: e.durationHours, reason: 'before_go_live', note: `before go-live ${cfg.liveFrom}` });
      return false;
    }
    if (input.evidenceSupersededUntil && day <= input.evidenceSupersededUntil) {
      rejected.push({ dedupeKey: e.dedupeKey, subject: e.subject, startsAt: e.startsAt, hours: e.durationHours, reason: 'duplicate', note: 'superseded by curated build estimates' });
      return false;
    }
    return true;
  });

  const built = buildEstimateEntries(input.builds ?? [], { cfg, mappings, busyByDay });
  rejected.push(...built.rejected);

  let entries = [...meetings, ...evid, ...built.entries];
  entries = applyRules(entries, input.rules ?? [], tz);
  entries = entries.map((e) => finalizeStatus(e, now));
  if (input.handsOff) entries = autoApprove(entries, input.now);
  entries.sort((a, b) => toMs(a.startsAt) - toMs(b.startsAt) || a.dedupeKey.localeCompare(b.dedupeKey));
  return {
    blocks,
    entries,
    rejected,
    humanHours: humanHours(blocks),
    leverageHours: leverageHours(blocks),
    onsite: onsite.days,
    trips: onsite.trips,
  };
}

export { isAttendedMeeting };
