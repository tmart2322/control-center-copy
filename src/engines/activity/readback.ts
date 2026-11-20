/**
 * Org62 read-back verification: compare the mirrored Solutions Events against proposed rows.
 *
 *   verified     found and type, duration, WhatId, meeting type all match
 *   verify_failed found, but a field differs (re-issue as an update)
 *   logged       found, but Duration__c is blank so fields cannot be verified yet (backfill row)
 *   missing      expected in Org62, not found, while Org62 HAS later Solutions Events (Slackbot skipped it / failed)
 *   unconfirmed  expected in Org62, not found, and Org62 shows nothing at or after it ("not logged"):
 *                the read-back cannot confirm it. This is the 10/26 to 11/3 gap finding.
 *   pending      not due yet, or not approved yet (nothing is expected in Org62)
 *
 * How a row finds its Event (D-65, "the link beats heuristics"), one Event per row, best first:
 *   link           the row is already tied to this Event (`links`: its org62_event_row_id)
 *   cc_key         the Event's Description carries the row's `CC#<uuid>` (`ccKeys`; Slackbot writes it, TL-23)
 *   subject_start  the same Subject and Start
 *   fuzzy          the same start (±5 min), or overlapping with a similar subject
 *   slot           the same Related To (or account), the same local day, ≥ 50% overlap (TL-02)
 *   tz_shift       the same Related To and length, shifted by exactly the profile's UTC offset (TL-02: a time typed
 *                  in the wrong zone)
 * An Event whose CC# names a row in this pass pairs with that row only.
 *
 * Pure. The caller supplies the mirror and `now`.
 */
import { startDiffersFlag } from './org62-check';
import { defaultMeetingType, roundQuarter } from './taxonomy';
import { HOUR, MIN, localDay, toMs, utcOffsetMs } from './time';
import type { ActivityEntry, Org62EventRow } from './types';

export type ReadbackStatus = 'verified' | 'verify_failed' | 'logged' | 'missing' | 'unconfirmed' | 'pending';

export interface ReadbackItem {
  dedupeKey: string;
  status: ReadbackStatus;
  org62EventId: string | null;
  matchedBy: ReadbackMatch | null;
  issues: string[];
  /** Information that never fails the row (TL-22: the start differs on a CC# join). */
  notes: string[];
}

export type ReadbackMatch = 'link' | 'cc_key' | 'subject_start' | 'fuzzy' | 'slot' | 'tz_shift';

export interface LoggingGap {
  /** Start of the latest Solutions Event Org62 shows (null = none at all). */
  lastSolutionsEventAt: string | null;
  firstUnconfirmedStart: string;
  lastUnconfirmedEnd: string;
  entryKeys: string[];
  hours: number;
  /** Whole days between the last Org62 Solutions Event and `now`. */
  daysSilent: number | null;
  message: string;
}

export interface ReadbackResult {
  items: ReadbackItem[];
  byStatus: Record<ReadbackStatus, number>;
  gap: LoggingGap | null;
}

/** The work-order canvas writes "|" as "/" and collapses newlines, so compare through that. */
export const normSubject = (s: string | null | undefined): string => (s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim().toLowerCase();

const STOP = new Set(['sync', 'int', 'internal', 'meeting', 'call', 'the', 'and', 'with', 'for', 'salesforce', 'd360', 'data', '360', 'data360', 'weekly', 'prep', 'review', 'discussion', 'team', 'hold']);
const tokens = (s: string, extra: ReadonlySet<string> = new Set()): Set<string> => new Set((s.toLowerCase().match(/[a-z0-9&]+/g) ?? []).filter((t) => t.length > 2 && !STOP.has(t) && !extra.has(t)));

function fuzzyScore(e: ActivityEntry, r: Org62EventRow, extra: ReadonlySet<string>): number {
  const s = toMs(e.startsAt);
  const en = toMs(e.endsAt);
  const rs = toMs(r.startsAt);
  const re = toMs(r.endsAt);
  const overlap = Math.min(en, re) - Math.max(s, rs) > 0;
  const sameStart = Math.abs(rs - s) <= 5 * MIN;
  const a = tokens(e.subject, extra);
  const b = tokens(r.subject ?? '', extra);
  const common = [...a].filter((t) => b.has(t)).length;
  const sim = common / Math.max(1, Math.min(a.size, b.size));
  const sameDay = Math.abs(rs - s) <= 3 * HOUR;
  if (sameStart && overlap && (sim >= 0.2 || !a.size || !b.size)) return 1 + sim;
  if (overlap && sim >= 0.5 && common >= 1) return sim;
  if (sameDay && sim >= 0.6 && common >= 2) return sim;
  return 0;
}

const id15 = (id: string | null | undefined): string => (id ?? '').slice(0, 15);

export interface ReadbackOptions {
  now: string;
  ownerId?: string;
  /** Read-back cursor: Org62 was read through this time. Defaults to the latest Solutions Event start. */
  observedThrough?: string;
  /** Owner name tokens to ignore when fuzzy-matching subjects (e.g. the user's first name). */
  ignoreTokens?: readonly string[];
  /** D-55: the record type (Name) the persona logs with; absent: 'Solutions Event' (the SE's). */
  recordTypeName?: string;
  /** D-55: false when the persona's Events carry no SE task type (the AE's Sales Events): the type is not compared. */
  taskTypeRequired?: boolean;
  /** Entry dedupe key → the Org62 Event id the entry is already tied to (its org62_event_row_id). */
  links?: ReadonlyMap<string, string>;
  /** Entry dedupe key → the CC# key (the app row id) its canvas row carried. */
  ccKeys?: ReadonlyMap<string, string>;
  /** Org62 opp id → the Org62 account id it belongs to (the slot rule's "same account"). */
  accountOf?: (org62Id: string) => string | null;
  /** The profile timezone: the slot rule's local day, the tz-shift rule's offset, the notes' times. Default UTC. */
  timezone?: string;
}

/** Blank and null are the same value (an AE's Event has no task type: `null !== ''` failed every AE row, TL-16). */
const blank = (v: string | null | undefined): string => (v ?? '').trim();

interface Pair {
  sc: number;
  kind: ReadbackMatch;
  e: ActivityEntry;
  r: Org62EventRow;
}

/** The account a WhatId sits on: an account WhatId is its own; an opp's comes from `accountOf`. */
const accountKeyOf = (what: string | null | undefined, accountOf?: (id: string) => string | null): string => {
  if (!what) return '';
  if (what.startsWith('001')) return id15(what);
  return id15(accountOf?.(what) ?? null);
};

/** Two WhatIds share a Related To: the same one, or the same account (an opp → its account). Empty never does. */
export function sameRelatedTo(x: string | null | undefined, y: string | null | undefined, accountOf?: (id: string) => string | null): boolean {
  const a = id15(x);
  const b = id15(y);
  if (!a || !b) return false;
  if (a === b) return true;
  const ea = accountKeyOf(x, accountOf);
  return !!ea && ea === accountKeyOf(y, accountOf);
}
const sameWhat = (e: ActivityEntry, r: Org62EventRow, accountOf?: (id: string) => string | null): boolean => sameRelatedTo(e.whatOrg62Id, r.whatOrg62Id, accountOf);

/** TL-02: the same Related To or account, the same local day, overlapping by at least half of the shorter one. */
function slotScore(e: ActivityEntry, r: Org62EventRow, tz: string, accountOf?: (id: string) => string | null): number {
  const s = toMs(e.startsAt);
  const en = toMs(e.endsAt);
  const rs = toMs(r.startsAt);
  const re = toMs(r.endsAt);
  const ov = Math.min(en, re) - Math.max(s, rs);
  const shorter = Math.min(en - s, re - rs);
  if (ov <= 0 || shorter <= 0 || ov / shorter < 0.5) return 0;
  if (localDay(s, tz) !== localDay(rs, tz) || !sameWhat(e, r, accountOf)) return 0;
  return 0.5 + 0.4 * Math.min(1, ov / shorter);
}

/** TL-02: the same Related To and length, shifted by exactly the UTC offset (local time typed as UTC, or back). */
function tzShiftScore(e: ActivityEntry, r: Org62EventRow, tz: string): number {
  const s = toMs(e.startsAt);
  const rs = toMs(r.startsAt);
  const off = Math.abs(utcOffsetMs(s, tz));
  if (off < HOUR || !id15(e.whatOrg62Id) || id15(e.whatOrg62Id) !== id15(r.whatOrg62Id)) return 0;
  if (Math.abs(Math.abs(rs - s) - off) > 2 * MIN) return 0;
  const len = toMs(e.endsAt) - s;
  const rlen = toMs(r.endsAt) - rs;
  return Math.abs(len - rlen) <= 5 * MIN ? 0.3 : 0;
}

export function verifyReadback(entries: readonly ActivityEntry[], org62: readonly Org62EventRow[], opts: ReadbackOptions): ReadbackResult {
  const now = toMs(opts.now);
  const tz = opts.timezone ?? 'UTC';
  const extra = new Set((opts.ignoreTokens ?? []).map((t) => t.toLowerCase()));
  const mine = org62.filter((r) => !opts.ownerId || !r.ownerId || id15(r.ownerId) === id15(opts.ownerId));
  const rt = opts.recordTypeName ?? 'Solutions Event';
  const solutions = mine.filter((r) => r.recordTypeName === rt);
  const lastSolutions = solutions.reduce<number | null>((m, r) => (m === null ? toMs(r.startsAt) : Math.max(m, toMs(r.startsAt))), null);
  const observed = opts.observedThrough ? toMs(opts.observedThrough) : lastSolutions;

  const expectedStatuses = new Set(['approved', 'synced_to_canvas', 'logged', 'verified', 'verify_failed']);
  const considered = entries.filter((e) => e.operation === 'create' && !['excluded', 'dismissed', 'dropped'].includes(e.status));

  // One-to-one assignment, best score first: the link, the CC# key, exact Subject+Start, fuzzy, the slot, a tz shift.
  const replacedIds = new Set(entries.map((e) => e.targetOrg62EventId).filter((x): x is string => !!x));
  const pool = mine.filter((r) => !replacedIds.has(r.org62EventId));
  const keyed = new Set(considered.map((e) => opts.ccKeys?.get(e.dedupeKey)).filter((x): x is string => !!x));
  const pairs: Pair[] = [];
  for (const e of considered) {
    const link = opts.links?.get(e.dedupeKey);
    const cc = opts.ccKeys?.get(e.dedupeKey);
    for (const r of pool) {
      if (link && r.org62EventId === link) {
        pairs.push({ sc: 100, kind: 'link', e, r });
        continue;
      }
      // an Event whose CC# names a row of this pass belongs to that row only
      if (r.ccKey && keyed.has(r.ccKey)) {
        if (cc && r.ccKey === cc) pairs.push({ sc: 50, kind: 'cc_key', e, r });
        continue;
      }
      const exact = normSubject(e.subject) === normSubject(r.subject) && Math.abs(toMs(r.startsAt) - toMs(e.startsAt)) < MIN;
      if (exact) {
        pairs.push({ sc: 10, kind: 'subject_start', e, r });
        continue;
      }
      const fz = fuzzyScore(e, r, extra);
      const sl = slotScore(e, r, tz, opts.accountOf);
      if (fz || sl) pairs.push(fz >= sl ? { sc: fz, kind: 'fuzzy', e, r } : { sc: sl, kind: 'slot', e, r });
      else {
        const tzs = tzShiftScore(e, r, tz);
        if (tzs) pairs.push({ sc: tzs, kind: 'tz_shift', e, r });
      }
    }
  }
  pairs.sort((a, b) => b.sc - a.sc || a.e.dedupeKey.localeCompare(b.e.dedupeKey) || a.r.org62EventId.localeCompare(b.r.org62EventId));
  const usedE = new Set<string>();
  const usedR = new Set<string>();
  const match = new Map<string, { r: Org62EventRow; kind: ReadbackMatch }>();
  for (const p of pairs) {
    if (usedE.has(p.e.dedupeKey) || usedR.has(p.r.org62EventId)) continue;
    usedE.add(p.e.dedupeKey);
    usedR.add(p.r.org62EventId);
    match.set(p.e.dedupeKey, { r: p.r, kind: p.kind });
  }

  const typed = opts.taskTypeRequired !== false;
  const items: ReadbackItem[] = [];
  const unconfirmed: ActivityEntry[] = [];
  for (const e of considered) {
    const m = match.get(e.dedupeKey);
    const base = { dedupeKey: e.dedupeKey, org62EventId: m?.r.org62EventId ?? null, matchedBy: m?.kind ?? null, issues: [] as string[], notes: [] as string[] };
    if (m) {
      const r = m.r;
      if (r.recordTypeName !== rt) {
        // Legacy record type is locked: it can only be re-created, so this does not count as logged.
        items.push({ ...base, status: toMs(e.endsAt) <= now ? 'missing' : 'pending', issues: [`only a ${r.recordTypeName} Event exists (record type is locked); re-create as a ${rt}`] });
        continue;
      }
      // TL-22: joined on the link or the CC# key, a start Slackbot moved is information, never a failure
      const shift = Math.round(Math.abs(toMs(r.startsAt) - toMs(e.startsAt)) / MIN);
      const notes = (m.kind === 'link' || m.kind === 'cc_key') && shift > 5 ? [startDiffersFlag(shift, toMs(r.startsAt), tz)] : [];
      const issues: string[] = [];
      if (r.durationField === null) {
        items.push({ ...base, status: 'logged', issues: ['Duration__c is blank; backfill it'], notes });
        continue;
      }
      const type = blank(e.seTaskType);
      if (typed && blank(r.seTaskTypeName) !== type) issues.push(`SE_Task_Type__c: expected ${type || '(blank)'}, Org62 has ${blank(r.seTaskTypeName) || '(blank)'}`);
      if (Math.abs(roundQuarter(r.durationField) - e.durationHours) > 1e-6) issues.push(`Duration__c: expected ${e.durationHours}, Org62 has ${r.durationField}`);
      if (id15(r.whatOrg62Id) !== id15(e.whatOrg62Id)) issues.push(`WhatId: expected ${e.whatOrg62Id ?? '(none)'}, Org62 has ${r.whatOrg62Id ?? '(none)'}`);
      const wantMt = typed ? defaultMeetingType(type, e.meetingType) : '';
      if (wantMt && blank(r.meetingTypeName) !== wantMt) issues.push(`Meeting_Type__c: expected ${wantMt}, Org62 has ${blank(r.meetingTypeName) || '(blank)'}`);
      items.push({ ...base, status: issues.length ? 'verify_failed' : 'verified', issues, notes });
      continue;
    }
    const due = toMs(e.endsAt) <= now;
    if (!due || !expectedStatuses.has(e.status)) {
      items.push({ ...base, status: 'pending', issues: [] });
      continue;
    }
    // Expected in Org62 but not found.
    if (observed !== null && observed >= toMs(e.endsAt)) {
      items.push({ ...base, status: 'missing', issues: ['Org62 has later Solutions Events but not this one: Slackbot skipped or failed it'] });
    } else {
      items.push({ ...base, status: 'unconfirmed', issues: ['Not found in Org62 and the read-back shows nothing logged at or after it: not logged / unconfirmed'] });
      unconfirmed.push(e);
    }
  }

  const byStatus: Record<ReadbackStatus, number> = { verified: 0, verify_failed: 0, logged: 0, missing: 0, unconfirmed: 0, pending: 0 };
  for (const i of items) byStatus[i.status]++;

  let gap: LoggingGap | null = null;
  if (unconfirmed.length) {
    const starts = unconfirmed.map((e) => toMs(e.startsAt));
    const ends = unconfirmed.map((e) => toMs(e.endsAt));
    const hours = unconfirmed.reduce((s, e) => s + e.durationHours, 0);
    const days = lastSolutions === null ? null : Math.floor((now - lastSolutions) / (24 * HOUR));
    gap = {
      lastSolutionsEventAt: lastSolutions === null ? null : new Date(lastSolutions).toISOString(),
      firstUnconfirmedStart: new Date(Math.min(...starts)).toISOString(),
      lastUnconfirmedEnd: new Date(Math.max(...ends)).toISOString(),
      entryKeys: unconfirmed.map((e) => e.dedupeKey).sort(),
      hours: Math.round(hours * 100) / 100,
      daysSilent: days,
      message:
        `${unconfirmed.length} approved row(s), ${hours.toFixed(2)} h, are not confirmed in Org62` +
        (lastSolutions === null ? ': no Solutions Events were read back at all.' : `: the last Solutions Event Org62 shows is ${new Date(lastSolutions).toISOString().slice(0, 10)}.`) +
        ' Check that Slackbot ran the work order, or that the read-back window reaches them.',
    };
  }
  return { items, byStatus, gap };
}

/** Apply read-back results to entries: verified/verify_failed/logged move; unconfirmed/missing only flag. */
export function applyReadback(entries: readonly ActivityEntry[], result: ReadbackResult): ActivityEntry[] {
  const by = new Map(result.items.map((i) => [i.dedupeKey, i]));
  return entries.map((e) => {
    const i = by.get(e.dedupeKey);
    if (!i) return e;
    const n = { ...e, flags: [...e.flags] };
    if (i.org62EventId) n.org62EventId = i.org62EventId;
    if (i.status === 'verified' || i.status === 'verify_failed' || i.status === 'logged') n.status = i.status;
    if (i.status === 'missing' || i.status === 'unconfirmed') n.flags.push(...i.issues.map((x) => `read-back ${i.status}: ${x}`));
    return n;
  });
}
