/**
 * Places from calendar text: is a location physical, which city and time zone it names. Pure, no network.
 *
 * Used by onsite detection (onsite.ts) to say where a trip is and which clock its onsite hours follow. The tables
 * are deliberately small (US states, the busiest airports, a few big cities): a place we cannot read gives no city
 * and the trip falls back to the profile time zone, which is the old behaviour.
 */

/** Dominant IANA zone per US state (split states use the zone most of their people live in). */
const STATE_TZ: Readonly<Record<string, string>> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago', CA: 'America/Los_Angeles',
  CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York', DC: 'America/New_York', FL: 'America/New_York',
  GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis',
  IA: 'America/Chicago', KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago', NV: 'America/Los_Angeles', NH: 'America/New_York',
  NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago',
  OH: 'America/New_York', OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', UT: 'America/Denver',
  VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York', WI: 'America/Chicago',
  WY: 'America/Denver',
};

/** IATA code → [city, zone] for the airports flights in a calendar most often name. */
const AIRPORTS: Readonly<Record<string, readonly [string, string]>> = {
  ATL: ['Atlanta', 'America/New_York'], AUS: ['Austin', 'America/Chicago'], BNA: ['Nashville', 'America/Chicago'],
  BOS: ['Boston', 'America/New_York'], BWI: ['Baltimore', 'America/New_York'], CLE: ['Cleveland', 'America/New_York'],
  CLT: ['Charlotte', 'America/New_York'], CMH: ['Columbus', 'America/New_York'], CVG: ['Cincinnati', 'America/New_York'],
  DCA: ['Washington', 'America/New_York'], DEN: ['Denver', 'America/Denver'], DFW: ['Dallas', 'America/Chicago'],
  DAL: ['Dallas', 'America/Chicago'], DTW: ['Detroit', 'America/Detroit'], EWR: ['Newark', 'America/New_York'],
  FLL: ['Fort Lauderdale', 'America/New_York'], HNL: ['Honolulu', 'Pacific/Honolulu'], IAD: ['Washington', 'America/New_York'],
  IAH: ['Houston', 'America/Chicago'], HOU: ['Houston', 'America/Chicago'], IND: ['Indianapolis', 'America/Indiana/Indianapolis'],
  JFK: ['New York', 'America/New_York'], LGA: ['New York', 'America/New_York'], LAS: ['Las Vegas', 'America/Los_Angeles'],
  LAX: ['Los Angeles', 'America/Los_Angeles'], MCI: ['Kansas City', 'America/Chicago'], MCO: ['Orlando', 'America/New_York'],
  MDW: ['Chicago', 'America/Chicago'], ORD: ['Chicago', 'America/Chicago'], MIA: ['Miami', 'America/New_York'],
  MKE: ['Milwaukee', 'America/Chicago'], MSP: ['Minneapolis', 'America/Chicago'], MSY: ['New Orleans', 'America/Chicago'],
  OAK: ['Oakland', 'America/Los_Angeles'], PDX: ['Portland', 'America/Los_Angeles'], PHL: ['Philadelphia', 'America/New_York'],
  PHX: ['Phoenix', 'America/Phoenix'], PIT: ['Pittsburgh', 'America/New_York'], RDU: ['Raleigh', 'America/New_York'],
  SAN: ['San Diego', 'America/Los_Angeles'], SAT: ['San Antonio', 'America/Chicago'], SEA: ['Seattle', 'America/Los_Angeles'],
  SFO: ['San Francisco', 'America/Los_Angeles'], SJC: ['San Jose', 'America/Los_Angeles'], SLC: ['Salt Lake City', 'America/Denver'],
  SMF: ['Sacramento', 'America/Los_Angeles'], STL: ['St. Louis', 'America/Chicago'], TPA: ['Tampa', 'America/New_York'],
  YYZ: ['Toronto', 'America/Toronto'], YVR: ['Vancouver', 'America/Vancouver'], YUL: ['Montreal', 'America/Toronto'],
  MEX: ['Mexico City', 'America/Mexico_City'], LHR: ['London', 'Europe/London'], CDG: ['Paris', 'Europe/Paris'],
  FRA: ['Frankfurt', 'Europe/Berlin'], AMS: ['Amsterdam', 'Europe/Amsterdam'], DUB: ['Dublin', 'Europe/Dublin'],
  MUC: ['Munich', 'Europe/Berlin'], ZRH: ['Zurich', 'Europe/Zurich'], MAD: ['Madrid', 'Europe/Madrid'],
  NRT: ['Tokyo', 'Asia/Tokyo'], HND: ['Tokyo', 'Asia/Tokyo'], SIN: ['Singapore', 'Asia/Singapore'],
  SYD: ['Sydney', 'Australia/Sydney'], BLR: ['Bengaluru', 'Asia/Kolkata'], HYD: ['Hyderabad', 'Asia/Kolkata'],
};

/** Big cities by name (lower case) → zone, for titles like "Flight to Atlanta" and office room names. */
const CITY_TZ: ReadonlyMap<string, string> = new Map(
  [
    ...Object.values(AIRPORTS).map(([c, tz]) => [c.toLowerCase(), tz] as const),
    ['san francisco', 'America/Los_Angeles'], ['indianapolis', 'America/Indiana/Indianapolis'], ['bellevue', 'America/Los_Angeles'],
    ['salt lake', 'America/Denver'], ['boulder', 'America/Denver'], ['new york city', 'America/New_York'], ['nyc', 'America/New_York'],
  ] as const,
);

const VIRTUAL = /\b(zoom|teams|microsoft teams|webex|google meet|meet\.google|hangouts|chime|bluejeans|gotomeeting|https?:\/\/|online|virtual|remote|tbd)\b/i;
/** A street address: a house number then words, or a "City, ST 12345" tail. */
const STREET = /\b\d{1,6}\s+[A-Za-z0-9.' -]+?\b(st|street|rd|road|ave|avenue|blvd|boulevard|pkwy|parkway|dr|drive|way|ln|lane|ct|court|pl|place|hwy|highway|cir|circle|ter|terrace|sq|square|plaza|pike|row)\b/i;
const CITY_STATE_ZIP = /,\s*([A-Za-z][A-Za-z .'-]*?)\s*,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/;
/** Google room resources: "City-Building-Floor-Room (seats)". */
const ROOM = /^\s*([A-Za-z][A-Za-z .]+?)-[A-Za-z0-9 ]+-\d+-[A-Z]?\d+/;
const AIRPORT_CODE = /\b([A-Z]{3})\b(?!.*\b[A-Z]{3}\b)/;

export interface Place {
  city: string | null;
  timezone: string | null;
  /** How the place was read: an address, an airport code, a room name or a city word. */
  via: 'address' | 'airport' | 'room' | 'city' | null;
}

const NO_PLACE: Place = { city: null, timezone: null, via: null };

/** A location someone has to be at: a street address or a meeting room, not only a video link. */
export function isPhysicalLocation(location: string | null | undefined): boolean {
  const s = (location ?? '').trim();
  if (!s) return false;
  if (STREET.test(s) || CITY_STATE_ZIP.test(s) || ROOM.test(s)) return true;
  return false;
}

export function isVirtualOnly(location: string | null | undefined): boolean {
  const s = (location ?? '').trim();
  return !!s && VIRTUAL.test(s) && !isPhysicalLocation(s);
}

export function airport(code: string): { city: string; timezone: string } | null {
  const a = AIRPORTS[code.toUpperCase()];
  return a ? { city: a[0], timezone: a[1] } : null;
}

export function cityTimezone(city: string | null | undefined): string | null {
  return city ? (CITY_TZ.get(city.trim().toLowerCase()) ?? null) : null;
}

/** The city and zone a location names: an address (state zone), then an airport code, then a room name. */
export function placeOf(location: string | null | undefined): Place {
  const s = (location ?? '').trim();
  if (!s) return NO_PLACE;
  const csz = CITY_STATE_ZIP.exec(s);
  if (csz) {
    const city = csz[1]!.trim();
    return { city, timezone: cityTimezone(city) ?? STATE_TZ[csz[2]!] ?? null, via: 'address' };
  }
  const code = AIRPORT_CODE.exec(s)?.[1];
  const ap = code ? airport(code) : null;
  if (ap) return { city: ap.city, timezone: ap.timezone, via: 'airport' };
  const room = ROOM.exec(s);
  if (room) {
    const city = room[1]!.trim();
    return { city, timezone: cityTimezone(city), via: 'room' };
  }
  const tz = cityTimezone(s);
  if (tz) return { city: s, timezone: tz, via: 'city' };
  return NO_PLACE;
}

/** A flight title's destination: "Flight to Boston (UA 100)" → Boston (and its zone when we know the city). */
export function flightDestination(title: string): Place {
  const m = /\bflight\s+to\s+([^()\-–,]+?)(?:\s+international airport|\s+airport)?\s*(?:\(|$|-|–|,)/i.exec(title);
  if (!m) return NO_PLACE;
  const city = m[1]!.trim();
  const code = /^[A-Z]{3}$/.test(city) ? airport(city) : null;
  if (code) return { city: code.city, timezone: code.timezone, via: 'airport' };
  return { city, timezone: cityTimezone(city), via: 'city' };
}
