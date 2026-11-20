/**
 * Calendar source items → calendar events (+ attendees).
 *
 * Input: the Calendar fetcher's items (`cal:<eventId>`, payload in `meta`: start/end/allDay, responses, myResponse,
 * attendance verdict, attachments) and its cancellation markers (`cal:<eventId>:cancelled`). Items the scanner agent
 * echoed without the fetcher payload (no start/end) are ignored: the fetcher's row is the authority.
 *
 * What the pages count as "a meeting I attend" (Today, free time, the Time grid) is decided on read by
 * `isAttendedMeeting` in store/entities.ts; this mapper stores the facts (my response, solo / all-day, the
 * fetcher's attendance verdict) faithfully.
 */
import { addDays, isNonMeetingTitle, zonedToMs } from '@/engines/activity';

import type { DomainRules, EventType, Me, ProjectedAttendee, ProjectedEvent, ResponseStatus, SourceRow } from './types';
import { arr, bool, domainClass, domainOf, localDay, obj, str } from './util';

const OOO_TITLE = /\b(ooo|out of office|vacation|pto|holiday|day off)\b/i;
const FOCUS_TITLE = /\b(focus time|focus block|deep work)\b/i;
const WORKING_LOCATION = /^(home|office|working (from|location)\b)/i;
/** Recurring instance ids end with _YYYYMMDDTHHMMSSZ (or _YYYYMMDD for all-day). */
const INSTANCE_SUFFIX = /^(.+)_(\d{8}(T\d{6}Z?)?)$/;

export function responseOf(v: unknown): ResponseStatus {
  switch (str(v)?.toLowerCase()) {
    case 'accepted':
      return 'accepted';
    case 'declined':
      return 'declined';
    case 'tentative':
      return 'tentative';
    case 'needsaction':
    case 'needs_action':
      return 'needs_action';
    default:
      return 'none';
  }
}

export function eventTypeOf(title: string, allDay: boolean): EventType {
  if (OOO_TITLE.test(title)) return 'out_of_office';
  if (FOCUS_TITLE.test(title)) return 'focus_time';
  if (allDay && WORKING_LOCATION.test(title)) return 'working_location';
  return 'default';
}

/**
 * The fetcher's attendance verdict → the db enum (`uncertain` and not-yet-ended stay unknown).
 *
 * `n/a` is re-read when it came from the old title rule: until the onsite lane, any title with the word "flight"
 * was "not a meeting", so a customer dinner at a restaurant called "… Flight Club" (with guests and an address)
 * never showed. A timed event with other people whose title is not a non-meeting title is a meeting again: my
 * response decides, the way the fetcher decides for meetings (declined or unanswered → missed, organizer → attended).
 */
function attendanceOf(v: unknown, ended: boolean, reread?: { title: string; allDay: boolean; others: number; myResponse: ResponseStatus; iAmOrganizer: boolean }): ProjectedEvent['attendance'] {
  const a = str(v);
  if (a === 'n/a' && reread && !reread.allDay && reread.others > 0 && !isNonMeetingTitle(reread.title)) {
    if (!ended) return 'unknown';
    if (reread.myResponse === 'declined') return 'missed';
    if (reread.myResponse === 'accepted' || reread.iAmOrganizer) return 'attended';
    if (reread.myResponse === 'tentative') return 'unknown';
    return 'missed';
  }
  if (a === 'n/a') return 'not_applicable';
  if (!ended) return 'unknown';
  if (a === 'attended') return 'attended';
  if (a === 'missed') return 'missed';
  return 'unknown';
}

export const isCancellationItem = (si: SourceRow) => si.dedupeKey.endsWith(':cancelled') || str(si.meta.status) === 'cancelled';

/** The calendar (scope) and event id of a calendar item; null for rows that are not the fetcher's. */
export function calendarKey(si: SourceRow): { calendarId: string; externalEventId: string } | null {
  if (si.source !== 'calendar' || si.kind !== 'calendar_event') return null;
  const eventId = str(si.meta.eventId) ?? (si.dedupeKey.startsWith('cal:') ? si.externalId : null);
  if (!eventId) return null;
  const scope = str(si.externalContainerId);
  return { calendarId: scope && !scope.includes(':') ? scope : 'primary', externalEventId: eventId };
}

export function projectCalendarEvent(si: SourceRow, me: Pick<Me, 'email' | 'timezone'>, rules: DomainRules): ProjectedEvent | null {
  const key = calendarKey(si);
  if (!key || isCancellationItem(si)) return null;
  const m = si.meta;
  const start = str(m.start);
  const end = str(m.end);
  if (!start || !end || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) return null;
  const meEmail = me.email.toLowerCase();
  const allDay = bool(m.allDay) === true;
  const title = si.title ?? '';
  const organizer = str(m.organizerEmail)?.toLowerCase() ?? null;
  const iAmOrganizer = bool(m.iAmOrganizer) === true || organizer === meEmail;

  // Attendee list: the fetcher's `responses` (me, organizer, first 15) carry responses; `participants` has every
  // attendee's email (up to 50) for the domain picture.
  const attendees = new Map<string, ProjectedAttendee>();
  for (const r of arr(m.responses)) {
    const o = obj(r);
    const email = str(o?.email)?.toLowerCase();
    if (!o || !email || attendees.has(email)) continue;
    const domain = domainOf(email);
    const cls = domainClass(domain, rules);
    attendees.set(email, {
      email,
      responseStatus: responseOf(o.response),
      isOrganizer: bool(o.organizer) === true || email === organizer,
      isOptional: bool(o.optional) === true,
      isSelf: email === meEmail,
      isExternal: cls === 'external' || cls === 'partner',
      domain,
    });
  }
  const allEmails = new Set<string>(attendees.keys());
  for (const p of arr(m.participants)) {
    const email = str(obj(p)?.email)?.toLowerCase();
    if (email) allEmails.add(email);
  }
  const others = [...allEmails].filter((e) => e !== meEmail);
  const domains = [...new Set(others.map(domainOf).filter((d): d is string => !!d && domainClass(d, rules) !== 'ignore'))].sort();
  const externalDomains = domains.filter((d) => domainClass(d, rules) === 'external');
  const people = others.filter((e) => domainClass(domainOf(e), rules) !== 'ignore');

  // My response: the fetcher's (from my attendee row); I own events I organize, and solo blocks I created.
  let myResponse = responseOf(m.myResponse ?? attendees.get(meEmail)?.responseStatus);
  if (myResponse === 'none' && iAmOrganizer) myResponse = 'accepted';

  const ended = bool(m.ended) === true || Date.parse(end) <= Date.parse(si.changedAt);
  const recurring = INSTANCE_SUFFIX.exec(key.externalEventId);
  const attachments = arr(m.attachments)
    .map((a) => obj(a))
    .filter((a): a is Record<string, unknown> => !!a)
    .map((a) => ({ title: str(a.title) ?? '', fileId: str(a.fileId), mimeType: str(a.mimeType) }));

  // All-day events are dates: the calendar hands them over as UTC midnight, which is the evening before in the
  // Americas. They are stored at local midnight of their first date to local midnight after their last.
  const fromDay = start.slice(0, 10);
  const toDay = end.slice(0, 10) > fromDay ? end.slice(0, 10) : addDays(fromDay, 1);
  const startsAt = allDay ? new Date(zonedToMs(fromDay, '00:00', me.timezone)).toISOString() : new Date(start).toISOString();
  const endsAt = allDay ? new Date(zonedToMs(toDay, '00:00', me.timezone)).toISOString() : new Date(Math.max(Date.parse(end), Date.parse(start))).toISOString();

  return {
    calendarId: key.calendarId,
    externalEventId: key.externalEventId,
    recurringEventId: recurring ? recurring[1]! : null,
    sourceItemId: si.id,
    title,
    startsAt,
    endsAt,
    localDay: allDay ? fromDay : localDay(start, me.timezone),
    isAllDay: allDay,
    eventType: eventTypeOf(title, allDay),
    status: 'confirmed',
    myResponse,
    iAmOrganizer,
    attendance: attendanceOf(m.attendance, ended, { title, allDay, others: people.length, myResponse, iAmOrganizer }),
    hasExternalAttendees: externalDomains.length > 0,
    externalDomains,
    attendeeDomains: domains,
    otherAttendeeCount: people.length,
    conferenceUrl: str(m.meetingLink),
    htmlLink: si.url,
    location: str(m.location),
    attendees: [...attendees.values()],
    attachments,
    geminiNotesDocId: str(m.geminiNotesDocId),
    ended,
  };
}

/**
 * The newest state per event from all of its items: the fetcher row and, when the event vanished while still in the
 * future, its cancellation marker. A marker newer than the row wins (the event was cancelled); a row refreshed after
 * the marker wins (it came back).
 */
export function resolveCalendarItems(items: SourceRow[]): Map<string, { event: SourceRow | null; cancelled: SourceRow | null }> {
  const out = new Map<string, { event: SourceRow | null; cancelled: SourceRow | null }>();
  for (const si of items) {
    const key = calendarKey(si);
    if (!key) continue;
    const k = `${key.calendarId}\u0000${key.externalEventId}`;
    const cur = out.get(k) ?? { event: null, cancelled: null };
    if (isCancellationItem(si)) {
      if (!cur.cancelled || si.changedAt > cur.cancelled.changedAt) cur.cancelled = si;
    } else if (str(si.meta.start) && str(si.meta.end)) {
      if (!cur.event || si.changedAt > cur.event.changedAt) cur.event = si;
    }
    out.set(k, cur);
  }
  return out;
}

/** Cancelled (a marker newer than the event row) or deleted upstream (the row's deleted_upstream_at). */
export const isGone = (r: { event: SourceRow | null; cancelled: SourceRow | null }): boolean =>
  !!r.event?.deletedUpstreamAt || (!!r.cancelled && (!r.event || Date.parse(r.cancelled.changedAt) >= Date.parse(r.event.changedAt)));
