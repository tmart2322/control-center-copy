/**
 * What a calendar event is, from its title and shape: a flight, a hotel stay, an onsite marker, a customer dinner,
 * or a long "marker" block that is never a meeting. Pure; shared by the Calendar fetcher (attendance), the calendar
 * projection and the activity engine so all three agree.
 *
 * A flight is an airline flight number ("UA 100") or a title that starts "Flight to/from …", never the bare word:
 * a restaurant called "… Flight Club" is a dinner, not a flight (onsite lane, root cause 3).
 */
import { HOUR, localDay, toMs } from './time';

/** IATA airline codes seen on US business travel; a code plus 1–4 digits is a flight number. */
const FLIGHT_NUMBER = /\b(?:AA|AC|AF|AM|AS|AV|B6|BA|CM|CX|DL|EI|EK|F9|G4|HA|IB|JL|KL|LA|LH|LX|NH|NK|NZ|QF|QR|SQ|SY|TK|UA|VS|WN|WS)\s?\d{1,4}\b/;
const FLIGHT_LEAD = /^\s*(?:✈️?\s*)?flight\s+(?:to|from|home|back)\b/i;
const AIRLINE = /\b(?:united airlines|united flight|delta|american airlines|southwest|alaska airlines|jetblue|frontier airlines|spirit airlines|air canada|westjet|british airways|lufthansa)\b/i;
const PLANE = /✈/;

const HOTEL = /^\s*(?:stay at|hotel stay|check-?in:?\s)|\b(?:hotel|marriott|hilton|hyatt|sheraton|westin|embassy suites|hampton inn|courtyard by|doubletree|holiday inn|ritz-carlton|four seasons|kimpton|airbnb)\b/i;
const ONSITE = /\b(?:on-?site|in[- ]person|customer visit|site visit|onsite visit)\b/i;
const DINNER = /\b(?:dinner|happy hour|reception|customer lunch|team lunch with)\b/i;
const HOME_WORDS = /^\s*(?:home|office|remote|working from home|wfh)\s*$/i;

export const isFlightTitle = (title: string): boolean => FLIGHT_NUMBER.test(title) || FLIGHT_LEAD.test(title) || PLANE.test(title) || (AIRLINE.test(title) && /\bflight\b/i.test(title));
export const isHotelTitle = (title: string): boolean => HOTEL.test(title);
export const isOnsiteTitle = (title: string): boolean => ONSITE.test(title);
export const isDinnerTitle = (title: string): boolean => DINNER.test(title);
export const isHomeWord = (title: string): boolean => HOME_WORDS.test(title);

/** The flight number in a title ("UA 200"), normalized without the space; null when there is none. */
export function flightNumber(title: string): string | null {
  const m = FLIGHT_NUMBER.exec(title);
  return m ? m[0].replace(/\s+/g, '') : null;
}

/**
 * Titles of blocks that are not meetings even with a guest list (focus, holds, travel, hotel stays). The Calendar
 * fetcher uses it to mark attendance n/a. "flight" alone is not in it: only a real flight (isFlightTitle) is.
 */
const NON_MEETING_WORDS = /\b(focus time|focus block|busy|hold|block|travel|commute|lunch|ooo|out of office|stay at|hotel|reservation)\b/i;
export const isNonMeetingTitle = (title: string): boolean => NON_MEETING_WORDS.test(title) || isFlightTitle(title);

/** Hours an event spans. */
export const spanHours = (startsAt: string, endsAt: string): number => (toMs(endsAt) - toMs(startsAt)) / HOUR;

/** A timed event that ends on a later local day than it starts (an end at exactly midnight stays on its day). */
export function crossesMidnight(startsAt: string, endsAt: string, tz: string): boolean {
  const s = toMs(startsAt);
  const e = toMs(endsAt);
  if (e <= s) return false;
  return localDay(s, tz) !== localDay(e - 1, tz);
}

export const MARKER_MIN_H = 12;
export const ONSITE_MARKER_MIN_H = 8;

/**
 * A marker, never a meeting: a timed event of 12 h or more, or one that crosses local midnight, or an onsite-titled
 * block of 8 h or more. Markers say something about the day (an onsite, a trip); they never become a meeting row.
 * Flights are travel (a red-eye crosses midnight and is still a flight) and all-day events are not timed.
 */
export function isMarkerEvent(ev: { summary: string; startsAt: string; endsAt: string; allDay?: boolean }, tz: string): boolean {
  if (ev.allDay || isFlightTitle(ev.summary)) return false;
  const h = spanHours(ev.startsAt, ev.endsAt);
  if (h >= MARKER_MIN_H) return true;
  if (isOnsiteTitle(ev.summary) && h >= ONSITE_MARKER_MIN_H) return true;
  return crossesMidnight(ev.startsAt, ev.endsAt, tz);
}
