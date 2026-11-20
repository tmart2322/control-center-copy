/**
 * Date guard: a draft must not promise a date or deadline that the inputs don't support
 * (north star: Trustworthy). We find date-like phrases in the draft and look for support in
 * the input corpus (evidence, thread, calendar, due date). Unsupported phrases are reported;
 * the validator turns them into warnings and the evals into failures where it matters.
 */

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const WEEKDAY_SHORT = ['mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_SHORT = ['jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'];

const RELATIVE = ['today', 'tonight', 'tomorrow', 'eod', 'end of day', 'cob', 'this week', 'next week', 'end of week', 'eow', 'this afternoon', 'this morning', 'by monday', 'asap'];

export interface DatePhrase {
  phrase: string;
  kind: 'weekday' | 'month_day' | 'numeric' | 'relative';
  /** Normalized key used for support lookup, e.g. "thursday", "11-07", "tomorrow". */
  key: string;
}

const monthIndex = (m: string): number => {
  const s = m.toLowerCase().slice(0, 3);
  return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(s) + 1;
};

export function findDatePhrases(text: string): DatePhrase[] {
  const out: DatePhrase[] = [];
  const lower = text.toLowerCase();
  const wd = new RegExp(`\\b(${[...WEEKDAYS, ...WEEKDAY_SHORT].join('|')})\\b\\.?`, 'gi');
  for (const m of text.matchAll(wd)) {
    const w = (m[1] ?? '').toLowerCase();
    // "sun"/"sat"/"wed" as words are rare in drafts; "may" is handled as a month only with a day.
    const full = WEEKDAYS.find((d) => d.startsWith(w.slice(0, 3))) ?? w;
    out.push({ phrase: m[0], kind: 'weekday', key: full });
  }
  const md = new RegExp(`\\b(${[...MONTHS, ...MONTH_SHORT, 'may'].join('|')})\\.?\\s+(\\d{1,2})(st|nd|rd|th)?\\b`, 'gi');
  for (const m of text.matchAll(md)) {
    const mm = monthIndex(m[1] ?? '');
    out.push({ phrase: m[0], kind: 'month_day', key: `${String(mm).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}` });
  }
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.push({ phrase: m[0], kind: 'numeric', key: `${m[2]}-${m[3]}` });
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31) out.push({ phrase: m[0], kind: 'numeric', key: `${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}` });
  }
  for (const r of RELATIVE) {
    const re = new RegExp(`\\b${r.replace(/ /g, '\\s+')}\\b`, 'i');
    if (re.test(lower)) out.push({ phrase: r, kind: 'relative', key: r });
  }
  return out;
}

/** Support keys derived from ISO datetimes the inputs mention (due, calendar, slots). */
export function supportKeysForIso(iso: string, tz: string, nowIso: string): string[] {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return [];
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(d);
  const weekday = fmt({ weekday: 'long' }).toLowerCase();
  const mm = fmt({ month: '2-digit' });
  const dd = fmt({ day: '2-digit' });
  const keys = [weekday, `${mm}-${dd}`];
  const dayDiff = Math.round((startOfDay(d, tz) - startOfDay(new Date(nowIso), tz)) / 86_400_000);
  if (dayDiff === 0) keys.push('today', 'tonight', 'eod', 'end of day', 'cob', 'this afternoon', 'this morning');
  if (dayDiff === 1) keys.push('tomorrow');
  if (dayDiff >= 0 && dayDiff <= 6) keys.push('this week', 'end of week', 'eow');
  if (dayDiff >= 4 && dayDiff <= 13) keys.push('next week');
  return keys;
}

function startOfDay(d: Date, tz: string): number {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return new Date(`${s}T00:00:00Z`).getTime();
}

/** Keys that the free text of the inputs supports (someone already said "Thursday", "by EOD", "11/7"). */
export function supportKeysForText(corpus: string): Set<string> {
  return new Set(findDatePhrases(corpus).map((p) => p.key));
}

export function unsupportedDatePhrases(draftText: string, supported: Set<string>): DatePhrase[] {
  const seen = new Set<string>();
  return findDatePhrases(draftText).filter((p) => {
    if (supported.has(p.key)) return false;
    if (p.key === 'asap') return false; // not a date promise
    if (seen.has(p.key)) return false;
    seen.add(p.key);
    return true;
  });
}
