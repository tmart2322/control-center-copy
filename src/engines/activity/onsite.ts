/**
 * Onsite days and trips (lane "step 6"). Pure: the caller passes calendar evidence (the window plus a week of context
 * on each side), the account mappings, the Org62 mirror, the user's corrections and the Time settings.
 *
 * A trip is where you were and when: an outbound flight's arrival to the return flight's departure (connections
 * merged, duplicate flights merged), else a hotel stay's days, else a run of onsite-titled days. Its city and clock
 * come from the hotel address, then the airports, then the city words.
 *
 * An onsite day is decided per local day, signals highest priority first:
 *   1. your correction (a day, or a trip you marked);
 *   2. a logged Org62 Event that says onsite (or runs 6 h or more);
 *   3. an all-day or 8 h+ event titled onsite / on-site / in person / customer visit that maps to an account;
 *   4. customer meetings at a physical address with external invitees (inside a trip, or 4 h+ of them);
 *   5. a trip (hotel stay plus flights) that covers the day's onsite hours, once the trip has an account;
 *   6. the working-location event: lowest, it only names a city, and a stale one is listed as ignored.
 * Slack and email mentions may support a call, never make one (not read here).
 *
 * The frame is one block per day (never overnight: clamped to the local day), from the first to the last onsite
 * signal, defaulting to the onsite hours (08:00–17:00) in the trip's time zone. On the day you fly in it starts at your
 * first session (or when you land), on the day you fly home it ends at your last session (or when you leave for the
 * airport). Real sessions inside it keep their own rows; the frame only fills the gaps (tenet: Hours are human hours).
 */
import { accountByKey, resolveAccount } from './classify';
import { isDinnerTitle, isFlightTitle, isHomeWord, isHotelTitle, isMarkerEvent, isOnsiteTitle, flightNumber, spanHours, ONSITE_MARKER_MIN_H } from './event-kinds';
import { cityTimezone, flightDestination, isPhysicalLocation, placeOf, type Place } from './places';
import { isCF } from './taxonomy';
import { DAY, HOUR, MIN, addDays, localDay, localHm, toIsoSec, toMs, zonedToMs, type Interval } from './time';
import type { ActivityMappings, CalendarEvidence, Org62EventRow } from './types';

// ---------------------------------------------------------------- settings and corrections

export interface OnsiteConfig {
  /** Detect onsite days at all (corrections always apply). */
  enabled: boolean;
  /** Default onsite hours, "HH:MM", in the trip's time zone. */
  hours: { start: string; end: string };
  /**
   * Legacy (before 2026-11-14): one symmetric buffer before a flight and after landing. Read only when the two sides
   * below are absent (`airportBuffers`).
   */
  airportBufferMin?: number;
  /** Time before a flight's departure (getting to the airport, security, the gate), counted as Travel. Default 120. */
  airportBufferBeforeMin?: number;
  /** Time after landing (bags, getting to the hotel or home), counted as Travel. Default 60. */
  airportBufferAfterMin?: number;
  /** A customer dinner is customer-facing time (else it is not counted). */
  dinnersCustomerFacing: boolean;
}

/** 2026-11-14 (the owner's direction): 2 h before a flight, 1 h after it. */
export const DEFAULT_AIRPORT_BUFFER_BEFORE_MIN = 120;
export const DEFAULT_AIRPORT_BUFFER_AFTER_MIN = 60;
/** The old symmetric default: a saved `airportBufferMin` of 60 is read as "never changed". */
export const LEGACY_AIRPORT_BUFFER_MIN = 60;

export const DEFAULT_ONSITE_CONFIG: OnsiteConfig = {
  enabled: true,
  hours: { start: '08:00', end: '17:00' },
  airportBufferBeforeMin: DEFAULT_AIRPORT_BUFFER_BEFORE_MIN,
  airportBufferAfterMin: DEFAULT_AIRPORT_BUFFER_AFTER_MIN,
  dinnersCustomerFacing: true,
};

/**
 * The airport buffers, in minutes, before a flight and after it lands. The two sides win; absent, a legacy symmetric
 * `airportBufferMin` the user changed (anything but the old default 60) applies to both; else 120 before, 60 after.
 */
export function airportBuffers(cfg: Pick<OnsiteConfig, 'airportBufferMin' | 'airportBufferBeforeMin' | 'airportBufferAfterMin'> | null | undefined): { beforeMin: number; afterMin: number } {
  const legacy = cfg?.airportBufferMin;
  const custom = typeof legacy === 'number' && Number.isFinite(legacy) && legacy !== LEGACY_AIRPORT_BUFFER_MIN ? Math.max(0, legacy) : null;
  return {
    beforeMin: cfg?.airportBufferBeforeMin ?? custom ?? DEFAULT_AIRPORT_BUFFER_BEFORE_MIN,
    afterMin: cfg?.airportBufferAfterMin ?? custom ?? DEFAULT_AIRPORT_BUFFER_AFTER_MIN,
  };
}

/** A correction for one local day: Confirm (onsite, with what it showed), Not onsite, Change account, Adjust hours. */
export interface OnsiteDayOverride {
  day: string;
  onsite: boolean;
  accountKey?: string | null;
  /** The opp (006…) or account (001…) Org62 id the frame logs to. */
  whatId?: string | null;
  whatName?: string | null;
  /** "HH:MM" in the trip's zone; set by Adjust hours. */
  hours?: { start: string; end: string } | null;
  city?: string | null;
  timezone?: string | null;
  at: string;
}

/** "Mark trip": these local days [from, to] were a trip to this account. */
export interface OnsiteTripOverride {
  id: string;
  from: string;
  to: string;
  accountKey: string | null;
  whatId?: string | null;
  whatName?: string | null;
  city?: string | null;
  timezone?: string | null;
  at: string;
}

export interface OnsiteOverrides {
  days: OnsiteDayOverride[];
  trips: OnsiteTripOverride[];
}

export const NO_OVERRIDES: OnsiteOverrides = { days: [], trips: [] };

// ---------------------------------------------------------------- results

export type OnsiteSignalKind = 'correction' | 'org62' | 'onsite_event' | 'customer_meeting' | 'hotel_flight' | 'working_location' | 'flight';

export interface OnsiteSignal {
  kind: OnsiteSignalKind;
  label: string;
  /** false: seen, but it did not decide the day (a stale working location, a weaker signal). */
  used: boolean;
  evidenceIds: string[];
}

export interface Trip {
  key: string;
  /** Local days (profile zone) the trip covers, inclusive. */
  fromDay: string;
  toDay: string;
  /** When you were there: landing to leaving (the airport buffer is Travel, not presence). */
  presence: Interval;
  /** Landing / leaving instants when flights say so (null: the trip starts or ends with the day). */
  arrival: number | null;
  departure: number | null;
  city: string | null;
  timezone: string | null;
  accountKey: string | null;
  whatId: string | null;
  whatName: string | null;
  /** Kept flight evidence ids (duplicates merged), out then back. */
  flightIds: string[];
  hotelIds: string[];
  markerIds: string[];
  /** From a "Mark trip" correction. */
  marked: boolean;
}

export interface OnsiteDay {
  day: string;
  status: 'detected' | 'confirmed' | 'not_onsite';
  accountKey: string | null;
  whatId: string | null;
  whatName: string | null;
  city: string | null;
  /** The clock the onsite hours follow (the trip's, else the profile's). */
  timezone: string;
  frame: { startsAt: string; endsAt: string } | null;
  /** "08:00–17:00 EDT · default onsite hours" */
  hoursLabel: string;
  signals: OnsiteSignal[];
  tripKey: string | null;
  tripFrom: string | null;
  tripTo: string | null;
  locked: boolean;
}

export interface FlightGroup {
  /** The evidence id kept (a flight number, then the longest title). */
  keepId: string;
  ids: string[];
  dep: number;
  arr: number;
  title: string;
  number: string | null;
  origin: Place;
  dest: Place;
}

export interface OnsiteInput {
  /** The local days (profile zone) to decide, e.g. a week. */
  days: string[];
  tz: string;
  cfg: OnsiteConfig;
  /** Window events plus context around it (hotels, flights and markers of neighbouring days). */
  events: CalendarEvidence[];
  mappings: ActivityMappings;
  org62Events?: readonly Org62EventRow[];
  overrides?: OnsiteOverrides;
}

export interface OnsiteResult {
  days: OnsiteDay[];
  trips: Trip[];
  flights: FlightGroup[];
}

// ---------------------------------------------------------------- helpers

const live = (e: CalendarEvidence) => !e.deleted;
/** Meetings you said yes to (or own). Tentative ones never bound a frame: the frame covers them anyway. */
const accepted = (e: CalendarEvidence) => (e.selfResponse === 'accepted' || !!e.organizerSelf) && e.selfResponse !== 'declined';
const iv = (e: CalendarEvidence): Interval => ({ start: toMs(e.startsAt), end: toMs(e.endsAt) });

/** The local days an event covers: all-day by its dates, timed by the local days it touches. */
export function eventDays(e: CalendarEvidence, tz: string): string[] {
  const out: string[] = [];
  if (e.allDay) {
    const from = e.allDayFrom ?? localDay(toMs(e.startsAt), tz);
    const to = e.allDayTo ?? localDay(toMs(e.endsAt) - 1, tz);
    const last = e.allDayTo ? addDays(to, -1) : to;
    for (let d = from; d <= last && out.length < 60; d = addDays(d, 1)) out.push(d);
    return out;
  }
  const s = toMs(e.startsAt);
  const en = Math.max(s, toMs(e.endsAt) - 1);
  for (let d = localDay(s, tz); d <= localDay(en, tz) && out.length < 60; d = addDays(d, 1)) out.push(d);
  return out;
}

function tzAbbr(ms: number, tz: string): string {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(ms));
    return p.find((x) => x.type === 'timeZoneName')?.value ?? tz;
  } catch {
    return tz;
  }
}

/** The account an event names: the projection's (the user's mapping wins), else the title / domains. */
export function eventAccount(e: CalendarEvidence, m: ActivityMappings): string | null {
  return e.accountKey ?? resolveAccount(e.summary, e.attendeeDomains, m)?.key ?? null;
}

const externalOf = (e: CalendarEvidence, m: ActivityMappings) => {
  const skip = new Set([...m.internalDomains, ...m.partnerDomains, ...m.ignoreDomains]);
  return e.attendeeDomains.some((d) => !skip.has(d));
};

/** The flights, with duplicates (same departure and arrival within 10 minutes) merged into one. */
export function groupFlights(events: readonly CalendarEvidence[]): FlightGroup[] {
  const flights = events.filter((e) => live(e) && !e.allDay && (e.kind === 'flight' || isFlightTitle(e.summary)) && e.selfResponse !== 'declined').sort((a, b) => toMs(a.startsAt) - toMs(b.startsAt) || a.id.localeCompare(b.id));
  const groups: { evs: CalendarEvidence[]; dep: number; arr: number }[] = [];
  for (const f of flights) {
    const dep = toMs(f.startsAt);
    const arr = toMs(f.endsAt);
    const g = groups.find((x) => Math.abs(x.dep - dep) <= 10 * MIN && Math.abs(x.arr - arr) <= 10 * MIN);
    if (g) g.evs.push(f);
    else groups.push({ evs: [f], dep, arr });
  }
  return groups.map((g) => {
    const keep = [...g.evs].sort((a, b) => Number(!!flightNumber(b.summary)) - Number(!!flightNumber(a.summary)) || b.summary.length - a.summary.length || a.id.localeCompare(b.id))[0]!;
    const origin = g.evs.map((e) => placeOf(e.location)).find((p) => p.city) ?? { city: null, timezone: null, via: null };
    const dest = g.evs.map((e) => flightDestination(e.summary)).find((p) => p.city) ?? { city: null, timezone: null, via: null };
    return { keepId: keep.id, ids: g.evs.map((e) => e.id), dep: g.dep, arr: g.arr, title: keep.summary, number: flightNumber(keep.summary), origin, dest };
  });
}

const sameCity = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && (a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase()));

interface Journey {
  flights: FlightGroup[];
  dep: number;
  arr: number;
  origin: Place;
  dest: Place;
}

/** Connections (≤ 6 h on the ground, landing where the next leg leaves) are one journey. */
function journeys(flights: FlightGroup[]): Journey[] {
  const out: Journey[] = [];
  for (const f of flights) {
    const last = out[out.length - 1];
    if (last && f.dep - last.arr >= 0 && f.dep - last.arr <= 6 * HOUR && (sameCity(last.dest.city, f.origin.city) || !last.dest.city || !f.origin.city) && !sameCity(f.dest.city, last.origin.city)) {
      last.flights.push(f);
      last.arr = f.arr;
      last.dest = f.dest.city ? f.dest : last.dest;
      continue;
    }
    out.push({ flights: [f], dep: f.dep, arr: f.arr, origin: f.origin, dest: f.dest });
  }
  return out;
}

const isHotel = (e: CalendarEvidence, tz: string) => live(e) && (e.kind === 'hotel' || (isHotelTitle(e.summary) && (e.allDay || spanHours(e.startsAt, e.endsAt) >= 12 || eventDays(e, tz).length > 1)));
const isOnsiteMarker = (e: CalendarEvidence) => live(e) && e.selfResponse !== 'declined' && isOnsiteTitle(e.summary) && (e.allDay || spanHours(e.startsAt, e.endsAt) >= ONSITE_MARKER_MIN_H);
const isWorkingLocation = (e: CalendarEvidence) => live(e) && e.allDay && (e.kind === 'working_location' || (!!e.organizerSelf && e.attendeeDomains.length === 0 && (isHomeWord(e.summary) || !!cityTimezone(e.summary))));

/** A meeting someone attends in person at a customer: physical address, external invitees, not declined. */
function isPhysicalCustomerMeeting(e: CalendarEvidence, m: ActivityMappings, tz: string): boolean {
  if (!live(e) || e.allDay || !accepted(e) || e.attended === false) return false;
  if (isMarkerEvent(e, tz) || isFlightTitle(e.summary)) return false;
  return isPhysicalLocation(e.location) && externalOf(e, m);
}

// ---------------------------------------------------------------- trips

export function detectTrips(input: Pick<OnsiteInput, 'events' | 'tz' | 'mappings' | 'org62Events' | 'overrides'>, flights = groupFlights(input.events)): Trip[] {
  const { tz, mappings: m } = input;
  const events = input.events.filter(live);
  const hotels = events.filter((e) => isHotel(e, tz));
  const markers = events.filter(isOnsiteMarker);
  const trips: Trip[] = [];
  const dayStart = (day: string, z: string) => zonedToMs(day, '00:00', z);

  const mk = (p: Partial<Trip> & Pick<Trip, 'presence'>): Trip => ({
    key: '',
    fromDay: '',
    toDay: '',
    arrival: null,
    departure: null,
    city: null,
    timezone: null,
    accountKey: null,
    whatId: null,
    whatName: null,
    flightIds: [],
    hotelIds: [],
    markerIds: [],
    marked: false,
    ...p,
  });

  // 1. out and back journeys (≤ 14 days apart): you were there from landing to leaving
  const js = journeys(flights);
  const used = new Set<number>();
  for (let i = 0; i < js.length; i++) {
    if (used.has(i)) continue;
    const out = js[i]!;
    for (let j = i + 1; j < js.length; j++) {
      const back = js[j]!;
      if (back.dep <= out.arr || back.dep - out.arr > 14 * DAY) break;
      const cityOk = sameCity(back.origin.city, out.dest.city) || sameCity(back.dest.city, out.origin.city);
      const stayBetween = [...hotels, ...markers].some((h) => toMs(h.endsAt) > out.arr && toMs(h.startsAt) < back.dep);
      if (!cityOk && !stayBetween) continue;
      used.add(i).add(j);
      trips.push(
        mk({
          presence: { start: out.arr, end: back.dep },
          arrival: out.arr,
          departure: back.dep,
          city: out.dest.city ?? back.origin.city,
          timezone: back.origin.timezone ?? out.dest.timezone ?? cityTimezone(out.dest.city ?? back.origin.city),
          flightIds: [...out.flights, ...back.flights].map((f) => f.keepId),
        }),
      );
      break;
    }
  }

  // 2. hotel stays: inside a flight trip they name its city; on their own they are the trip
  for (const h of hotels) {
    const place = placeOf(h.location);
    const hi = h.allDay ? { start: dayStart(eventDays(h, tz)[0]!, place.timezone ?? tz), end: dayStart(addDays(eventDays(h, tz).slice(-1)[0]!, 1), place.timezone ?? tz) } : iv(h);
    const t = trips.find((x) => x.presence.start < hi.end && hi.start < x.presence.end);
    if (t) {
      t.hotelIds.push(h.id);
      if (place.city && (!t.city || place.via === 'address')) t.city = place.city;
      if (place.timezone) t.timezone = place.timezone;
      continue;
    }
    trips.push(mk({ presence: hi, city: place.city, timezone: place.timezone, hotelIds: [h.id] }));
  }

  // 3. onsite markers with no trip around them: a local onsite (no flights, no hotel)
  for (const mk2 of markers) {
    const mi = mk2.allDay ? { start: dayStart(eventDays(mk2, tz)[0]!, tz), end: dayStart(addDays(eventDays(mk2, tz).slice(-1)[0]!, 1), tz) } : iv(mk2);
    const t = trips.find((x) => x.presence.start < mi.end && mi.start < x.presence.end);
    if (t) {
      t.markerIds.push(mk2.id);
      continue;
    }
    trips.push(mk({ presence: mi, markerIds: [mk2.id] }));
  }

  // 4. "Mark trip" corrections: their days, their account; detected landing / leaving inside them are kept
  for (const o of input.overrides?.trips ?? []) {
    const z = o.timezone ?? tz;
    const pi = { start: dayStart(o.from, z), end: dayStart(addDays(o.to, 1), z) };
    const hits = trips.filter((x) => x.presence.start < pi.end && pi.start < x.presence.end);
    const arrival = hits.map((x) => x.arrival).find((a): a is number => a !== null && a >= pi.start && a < pi.end) ?? null;
    const departure = hits.map((x) => x.departure).find((a): a is number => a !== null && a >= pi.start && a < pi.end) ?? null;
    for (const x of hits) trips.splice(trips.indexOf(x), 1);
    trips.push(
      mk({
        presence: { start: arrival ?? pi.start, end: departure ?? pi.end },
        arrival,
        departure,
        city: o.city ?? hits.find((x) => x.city)?.city ?? null,
        timezone: o.timezone ?? hits.find((x) => x.timezone)?.timezone ?? null,
        accountKey: o.accountKey,
        whatId: o.whatId ?? null,
        whatName: o.whatName ?? null,
        flightIds: hits.flatMap((x) => x.flightIds),
        hotelIds: hits.flatMap((x) => x.hotelIds),
        markerIds: hits.flatMap((x) => x.markerIds),
        marked: true,
      }),
    );
  }

  // merge overlaps (two hotel bookings of one stay, a hotel next to a marker run)
  trips.sort((a, b) => a.presence.start - b.presence.start);
  const merged: Trip[] = [];
  for (const t of trips) {
    const last = merged[merged.length - 1];
    if (last && t.presence.start < last.presence.end && !(last.marked && t.marked)) {
      const keep = last.marked ? last : t.marked ? t : last;
      const other = keep === last ? t : last;
      Object.assign(keep, {
        presence: { start: Math.min(last.presence.start, t.presence.start), end: Math.max(last.presence.end, t.presence.end) },
        arrival: keep.arrival ?? other.arrival,
        departure: keep.departure ?? other.departure,
        city: keep.city ?? other.city,
        timezone: keep.timezone ?? other.timezone,
        flightIds: [...new Set([...last.flightIds, ...t.flightIds])],
        hotelIds: [...new Set([...last.hotelIds, ...t.hotelIds])],
        markerIds: [...new Set([...last.markerIds, ...t.markerIds])],
      });
      merged[merged.length - 1] = keep;
      continue;
    }
    merged.push(t);
  }

  for (const t of merged) {
    if (!t.city || !t.timezone) {
      const at = events
        .filter((e) => !e.allDay && accepted(e) && isPhysicalLocation(e.location) && toMs(e.startsAt) < t.presence.end && t.presence.start < toMs(e.endsAt))
        .map((e) => placeOf(e.location))
        .find((p) => p.city);
      if (at) {
        t.city ??= at.city;
        t.timezone ??= at.timezone;
      }
    }
    const z = t.timezone ?? tz;
    t.timezone = t.timezone ?? null;
    t.fromDay = localDay(t.presence.start, tz);
    t.toDay = localDay(Math.max(t.presence.start, t.presence.end - 1), tz);
    t.key = `trip|${localDay(t.presence.start, z)}`;
    if (!t.marked || !t.accountKey) tripAccount(t, events, m, input, tz);
  }
  return merged;
}

/**
 * One account and opp for the whole trip: a correction on any of its days, then a logged Org62 onsite Event, then
 * the onsite markers, then the customer meetings with the most hours.
 */
function tripAccount(t: Trip, events: CalendarEvidence[], m: ActivityMappings, input: Pick<OnsiteInput, 'org62Events' | 'overrides'>, tz: string) {
  const inTrip = (day: string) => day >= t.fromDay && day <= t.toDay;
  const dayFix = (input.overrides?.days ?? []).filter((o) => inTrip(o.day) && o.onsite && o.accountKey).sort((a, b) => b.at.localeCompare(a.at))[0];
  if (dayFix) return setAccount(t, m, dayFix.accountKey!, dayFix.whatId, dayFix.whatName);
  for (const r of input.org62Events ?? []) {
    if (!inTrip(localDay(toMs(r.startsAt), tz)) || !isOrg62Onsite(r)) continue;
    const a = m.accounts.find((x) => x.whatId && r.whatOrg62Id && x.whatId.slice(0, 15) === r.whatOrg62Id.slice(0, 15));
    if (a) return setAccount(t, m, a.key, r.whatOrg62Id, null);
  }
  // only what happened while you were there: a meeting at home before the flight out is not the trip's
  const during = (e: CalendarEvidence) => toMs(e.startsAt) < t.presence.end && t.presence.start < toMs(e.endsAt);
  const markers = events.filter((e) => t.markerIds.includes(e.id) || (isOnsiteMarker(e) && during(e)));
  const vote = new Map<string, { h: number; opp: Map<string, number> }>();
  const add = (acct: string, h: number, opp: string | null | undefined) => {
    const v = vote.get(acct) ?? { h: 0, opp: new Map() };
    v.h += h;
    if (opp) v.opp.set(opp, (v.opp.get(opp) ?? 0) + h);
    vote.set(acct, v);
  };
  for (const e of markers) {
    const a = eventAccount(e, m);
    if (a) add(a, 1000, e.oppWhatId);
  }
  if (!vote.size)
    for (const e of events) {
      if (e.allDay || !accepted(e) || e.attended === false || !externalOf(e, m) || isMarkerEvent(e, tz) || isFlightTitle(e.summary)) continue;
      if (!during(e)) continue;
      const a = eventAccount(e, m);
      if (a) add(a, spanHours(e.startsAt, e.endsAt), e.oppWhatId);
    }
  // opps named by the trip's meetings count toward the winner's opp too
  const best = [...vote.entries()].sort((a, b) => b[1].h - a[1].h || a[0].localeCompare(b[0]))[0];
  if (!best) return;
  for (const e of events) {
    if (e.allDay || !e.oppWhatId || !during(e) || eventAccount(e, m) !== best[0]) continue;
    best[1].opp.set(e.oppWhatId, (best[1].opp.get(e.oppWhatId) ?? 0) + spanHours(e.startsAt, e.endsAt));
  }
  const opp = [...best[1].opp.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  setAccount(t, m, best[0], opp, null);
}

function setAccount(t: Trip, m: ActivityMappings, key: string, whatId: string | null | undefined, whatName: string | null | undefined) {
  const a = accountByKey(m, key);
  t.accountKey = key;
  t.whatId = whatId || a?.whatId || null;
  t.whatName = whatName ?? (whatId && a?.whatId !== whatId ? null : (a?.whatName ?? null));
}

const ORG62_ONSITE = /\b(?:on-?site|in[- ]person|customer visit|site visit)\b/i;
/** A logged Solutions Event that says onsite, or a customer-facing one of 6 h or more. */
export const isOrg62Onsite = (r: Org62EventRow): boolean =>
  r.recordTypeName === 'Solutions Event' && (ORG62_ONSITE.test(r.subject ?? '') || (isCF(r.seTaskTypeName ?? '') && (r.durationField ?? (toMs(r.endsAt) - toMs(r.startsAt)) / HOUR) >= 6));

// ---------------------------------------------------------------- days

export function detectOnsite(input: OnsiteInput): OnsiteResult {
  const { tz, cfg, mappings: m } = input;
  const events = input.events.filter(live);
  const flights = groupFlights(events);
  const trips = detectTrips(input, flights);
  const overrides = input.overrides ?? NO_OVERRIDES;
  const dayFix = new Map<string, OnsiteDayOverride>();
  for (const o of [...overrides.days].sort((a, b) => a.at.localeCompare(b.at))) dayFix.set(o.day, o);
  const out: OnsiteDay[] = [];

  for (const day of input.days) {
    const fix = dayFix.get(day);
    const trip = trips.find((t) => day >= t.fromDay && day <= t.toDay) ?? null;
    const z = fix?.timezone ?? trip?.timezone ?? tz;
    const signals: OnsiteSignal[] = [];
    const onDay = (e: CalendarEvidence) => eventDays(e, tz).includes(day);

    // 2. a logged Org62 onsite Event
    const logged = (input.org62Events ?? []).filter((r) => localDay(toMs(r.startsAt), tz) === day && isOrg62Onsite(r));
    for (const r of logged) signals.push({ kind: 'org62', label: `Logged in Org62: ${r.subject ?? 'Solutions Event'}`, used: true, evidenceIds: [r.org62EventId] });
    // 3. onsite markers that map to an account
    const markers = events.filter((e) => isOnsiteMarker(e) && onDay(e));
    for (const e of markers) {
      const a = eventAccount(e, m);
      signals.push({ kind: 'onsite_event', label: `${e.allDay ? 'All-day' : `${Math.round(spanHours(e.startsAt, e.endsAt))} h`} event "${e.summary}"${a ? '' : ' (no account)'}`, used: !!a, evidenceIds: [e.id] });
    }
    // 4. in-person customer meetings
    const physical = events.filter((e) => onDay(e) && isPhysicalCustomerMeeting(e, m, tz));
    const physicalH = physical.reduce((s, e) => s + spanHours(e.startsAt, e.endsAt), 0);
    for (const e of physical) signals.push({ kind: 'customer_meeting', label: `In person: "${e.summary}" (${placeOf(e.location).city ?? 'a physical address'})`, used: !!trip || physicalH >= 4, evidenceIds: [e.id] });
    // 5. the trip
    const window = { start: zonedToMs(day, cfg.hours.start, z), end: zonedToMs(day, cfg.hours.end, z) };
    const tripCovers = !!trip && trip.presence.start < window.end && window.start < trip.presence.end;
    if (trip && (trip.hotelIds.length || trip.flightIds.length)) {
      const bits = [trip.hotelIds.length ? 'hotel stay' : null, trip.flightIds.length ? `${trip.flightIds.length} flight${trip.flightIds.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' + ');
      signals.push({ kind: 'hotel_flight', label: `Trip${trip.city ? ` to ${trip.city}` : ''}: ${bits} (${trip.fromDay} to ${trip.toDay})`, used: tripCovers, evidenceIds: [...trip.hotelIds, ...trip.flightIds] });
    }
    for (const f of flights.filter((x) => localDay(x.dep, tz) === day || localDay(x.arr, tz) === day))
      signals.push({ kind: 'flight', label: `${f.title}${f.ids.length > 1 ? ` (in your calendar ${f.ids.length} times, counted once)` : ''}`, used: true, evidenceIds: f.ids });
    // 6. the working location: names a city at most; a different one than the trip's is stale
    for (const e of events.filter((x) => isWorkingLocation(x) && onDay(x))) {
      const stale = !!trip?.city && !sameCity(e.summary, trip.city);
      signals.push({ kind: 'working_location', label: `Working location "${e.summary}"${stale ? ' (ignored: you were travelling)' : ''}`, used: false, evidenceIds: [e.id] });
    }

    const detected =
      cfg.enabled && (logged.length > 0 || markers.some((e) => !!eventAccount(e, m)) || (physical.length > 0 && (!!trip || physicalH >= 4)) || (tripCovers && !!trip?.accountKey));
    // A trip (hotel, flights) with no account says you were away, not who for: a question, never hours.
    if (!fix && !detected && cfg.enabled && tripCovers && trip && (trip.hotelIds.length || trip.flightIds.length)) {
      out.push({ day, status: 'detected', accountKey: null, whatId: null, whatName: null, city: trip.city, timezone: z, frame: null, hoursLabel: 'away on a trip: onsite? Pick the account to log onsite hours', signals, tripKey: trip.key, tripFrom: trip.fromDay, tripTo: trip.toDay, locked: false });
      continue;
    }
    if (!fix && !detected) continue;
    if (fix && !fix.onsite) {
      signals.unshift({ kind: 'correction', label: 'You marked this day: not onsite', used: true, evidenceIds: [] });
      out.push({ day, status: 'not_onsite', accountKey: null, whatId: null, whatName: null, city: trip?.city ?? null, timezone: z, frame: null, hoursLabel: '', signals, tripKey: trip?.key ?? null, tripFrom: trip?.fromDay ?? null, tripTo: trip?.toDay ?? null, locked: true });
      continue;
    }
    if (fix) signals.unshift({ kind: 'correction', label: fix.hours ? `You set the hours: ${fix.hours.start}–${fix.hours.end}` : fix.accountKey ? 'You confirmed this day (account set by you)' : 'You confirmed this day', used: true, evidenceIds: [] });
    else if (trip?.marked) signals.unshift({ kind: 'correction', label: `You marked this trip (${trip.fromDay} to ${trip.toDay})`, used: true, evidenceIds: [] });
    const mine = !!fix || !!trip?.marked;

    // the day's account: your correction, the trip's (one account for the trip), then the strongest signal
    let accountKey = fix?.accountKey ?? trip?.accountKey ?? null;
    let whatId = fix?.whatId ?? (fix?.accountKey ? null : trip?.whatId) ?? null;
    let whatName = fix?.whatName ?? (fix?.accountKey ? null : trip?.whatName) ?? null;
    if (!accountKey) {
      const a = markers.map((e) => eventAccount(e, m)).find(Boolean) ?? physical.map((e) => eventAccount(e, m)).find(Boolean) ?? null;
      accountKey = a;
    }
    if (accountKey && !whatId) {
      const a = accountByKey(m, accountKey);
      whatId = a?.whatId || null;
      whatName = a?.whatName ?? null;
    }

    const frame = logged.length ? frameOfLogged(logged) : fix?.hours ? clampDay({ start: zonedToMs(day, fix.hours.start, z), end: zonedToMs(day, fix.hours.end, z) }, day, tz) : frameFor(day, z, tz, cfg, events, m, trip, accountKey);
    const note = logged.length ? 'as logged in Org62' : fix?.hours ? 'your hours' : frame?.note ?? '';
    out.push({
      day,
      status: mine ? 'confirmed' : 'detected',
      accountKey,
      whatId,
      whatName,
      city: fix?.city ?? trip?.city ?? physical.map((e) => placeOf(e.location).city).find(Boolean) ?? null,
      timezone: z,
      frame: frame ? { startsAt: toIsoSec(frame.start), endsAt: toIsoSec(frame.end) } : null,
      hoursLabel: frame ? `${localHm(frame.start, z)}–${localHm(frame.end, z)} ${tzAbbr(frame.start, z)}${note ? ` · ${note}` : ''}` : 'no onsite hours this day',
      signals,
      tripKey: trip?.key ?? null,
      tripFrom: trip?.fromDay ?? null,
      tripTo: trip?.toDay ?? null,
      locked: mine,
    });
  }
  return { days: out, trips, flights };
}

function frameOfLogged(rows: Org62EventRow[]): Interval & { note: string } {
  return { start: Math.min(...rows.map((r) => toMs(r.startsAt))), end: Math.max(...rows.map((r) => toMs(r.endsAt))), note: 'as logged in Org62' };
}

/** Never overnight: the frame stays inside its local day (profile zone). */
function clampDay(x: Interval, day: string, tz: string): (Interval & { note: string }) | null {
  const lo = zonedToMs(day, '00:00', tz);
  const hi = zonedToMs(addDays(day, 1), '00:00', tz);
  const s = Math.max(x.start, lo);
  const e = Math.min(x.end, hi);
  return e - s >= 30 * MIN ? { start: s, end: e, note: '' } : null;
}

/** The sessions that bound a frame: customer meetings of the day (not dinners, flights or markers). */
export function onsiteSessions(day: string, tz: string, events: readonly CalendarEvidence[], m: ActivityMappings, accountKey: string | null): CalendarEvidence[] {
  return events.filter((e) => {
    if (!live(e) || e.allDay || !accepted(e) || e.attended === false || e.selfResponse === 'declined') return false;
    if (isMarkerEvent(e, tz) || isFlightTitle(e.summary) || isDinnerTitle(e.summary) || isHotelTitle(e.summary)) return false;
    if (localDay(toMs(e.startsAt), tz) !== day) return false;
    const a = eventAccount(e, m);
    return externalOf(e, m) || isPhysicalLocation(e.location) || (!!accountKey && a === accountKey);
  });
}

function frameFor(day: string, z: string, tz: string, cfg: OnsiteConfig, events: CalendarEvidence[], m: ActivityMappings, trip: Trip | null, accountKey: string | null): (Interval & { note: string }) | null {
  const def = { start: zonedToMs(day, cfg.hours.start, z), end: zonedToMs(day, cfg.hours.end, z) };
  const sessions = onsiteSessions(day, tz, events, m, accountKey).map(iv);
  const first = sessions.length ? Math.min(...sessions.map((s) => s.start)) : null;
  const last = sessions.length ? Math.max(...sessions.map((s) => s.end)) : null;
  const buf = airportBuffers(cfg);
  const arrivalToday = trip?.arrival != null && localDay(trip.arrival, tz) === day;
  const departureToday = trip?.departure != null && localDay(trip.departure, tz) === day;
  let start = first !== null ? Math.min(def.start, first) : def.start;
  let end = last !== null ? Math.max(def.end, last) : def.end;
  let note = 'default onsite hours';
  if (first !== null && (first < def.start || last! > def.end)) note = 'onsite hours and your sessions';
  if (arrivalToday) {
    const landed = trip!.arrival! + buf.afterMin * MIN;
    start = first !== null ? Math.max(landed, first) : Math.max(landed, def.start);
    note = first !== null ? 'from your first session (you flew in)' : 'from when you landed';
  }
  if (departureToday) {
    const leave = trip!.departure! - buf.beforeMin * MIN;
    end = last !== null ? Math.min(leave, last) : Math.min(leave, def.end);
    note = last !== null ? 'to your last session (you flew home)' : 'to when you left for the airport';
  }
  if (trip) {
    start = Math.max(start, trip.presence.start);
    end = Math.min(end, trip.presence.end);
  }
  const c = clampDay({ start, end }, day, tz);
  return c ? { ...c, note } : null;
}
