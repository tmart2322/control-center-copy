/**
 * D-65: the Time ↔ Org62 round trip (docs/EDGE-CASES.md TL-01 … TL-45), one scenario per row, through the engine
 * (verifyReadback), the week projection (planWeek), the canvas preflight, the one count map, the Time derivations and
 * the mock DataSource. The Postgres paths (the moves written, the constraint, the read-back job, concurrent passes)
 * are in ./roundtrip-db.test.ts. Placeholders only: ACME / Globex, 001XX / 006XX ids, example.com.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { routes, Seed, type ActivityEntry, type Draft, type RouteKey, type RouteOutput } from '@/contract';
import {
  CANCELLED_HELD_FLAG,
  CANCELLED_LOGGED_FLAG,
  countBucketOf,
  countsAsLogged,
  DECLINED_HELD_FLAG,
  DEFAULT_EVIDENCE_CONFIG,
  DELETED_IN_ORG62,
  DUPLICATE_MARKER,
  LEFT_OUT_FLAG,
  LOG_AGAIN_FLAG,
  MANUAL_LOG_NOTE,
  needsRelog,
  NOT_IN_ORG62_FLAG,
  org62CheckOf,
  ORG62_CHECK_PREFIX,
  parseWorkOrder,
  RELATED_TO_EMPTY_FLAG,
  RESCHEDULED_MARKER,
  START_DIFFERS_MARKER,
  verifyReadback,
  type ActivityConfig,
} from '@/engines/activity';
import { eventRow, renderWorkOrder } from '@/engines/activity/slackbot';
import { EVENT_READBACK_BATCH, readbackSoql } from '@/jobs/handlers/org62-readback';
import { canvasActionFor, canvasInputOf } from '@/lib/canvas/payload';
import { canvasRowsOf, preflightCanvas, registerCanvasRowCheck, type PreflightActivity } from '@/lib/canvas/preflight';
import { org62RowToRaw } from '@/llm/org62-rec';
import { UC_HEADER } from '@/engines/activity/use-cases';
import { planWeek, type FixedEntry, type WeekEvent, type WeekInput, type WeekOrg62Event } from '@/projections/activity';
import { Matcher, type MatchOpp } from '@/projections/matching';
import { org62Spec, ORG62_EVENTS_CATCH_UP_MS } from '@/scanner/runtime/connectors';
import { quarterTotals } from '@/server/datasource/activity-log';
import { quarterLoggedH } from '@/server/datasource/db/quarter';
import { logCanvasesOf } from '@/server/datasource/log-canvases';
import { MockDataSource } from '@/server/datasource/mock';
import { resolvedEntry } from '@/server/time/relog';
import { timeWeekBounds, weekTotals } from '@/server/time/week';
import { READBACK_BADGE, readbackState } from '@/components/time/derive';
import { needsYou, weekSuggested } from '@/components/time/path-derive';
import { loadSkill } from '@/llm/skill-loader';
import { planResume } from '@/scanner/runtime/resume-planner';

import { ACCT_ACME, ACCT_GLOBEX, ME, OPP_ACME, OPP_GLOBEX, RULES, TZ } from '../projections/fixtures';

// ---------------------------------------------------------------------------------------------------------------
// fixtures: ACME (two opps on one account) and Globex; the week of Mon 2026-11-02 in America/Denver (UTC-7)
// ---------------------------------------------------------------------------------------------------------------

const OPP_ACME_B = '006XX0000000009AAA';
const accounts = [
  { id: 'a-acme', name: 'ACME Corporation', org62AccountId: ACCT_ACME, aliases: [] },
  { id: 'a-globex', name: 'Globex Inc.', org62AccountId: ACCT_GLOBEX, aliases: [] },
];
const opps: MatchOpp[] = [
  { id: 'o-acme', accountId: 'a-acme', org62OpportunityId: OPP_ACME, name: 'ACME - Data 360 Expansion', isClosed: false, onMyTeam: true, myDc: true },
  { id: 'o-acme-b', accountId: 'a-acme', org62OpportunityId: OPP_ACME_B, name: 'ACME - Agent Pilot', isClosed: false, onMyTeam: true, myDc: true },
  { id: 'o-globex', accountId: 'a-globex', org62OpportunityId: OPP_GLOBEX, name: 'Globex - Agent Rollout', isClosed: false, onMyTeam: true, myDc: true },
];
const matcher = new Matcher(accounts, opps, RULES);
const FROM = '2026-11-02T07:00:00.000Z';
const TO = '2026-11-09T07:00:00.000Z';
const NOW = '2026-11-07T18:00:00.000Z';
/** Wed 2026-11-04, `HH:MM` Denver → UTC. */
const at = (hm: string, day = '2026-11-04') => {
  const [h, m] = hm.split(':').map(Number) as [number, number];
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + ((h + 7) * 60 + m) * 60_000).toISOString();
};

const cfg = (o: Partial<ActivityConfig> = {}): ActivityConfig => ({
  timezone: TZ,
  ownerId: ME.org62UserId!,
  recordTypeId: '',
  lightningHost: '',
  workday: { start: '07:30', end: '17:30' },
  hoursTarget: 250,
  liveFrom: '1970-01-01',
  evidence: DEFAULT_EVIDENCE_CONFIG,
  quarters: [],
  internalActivity: true,
  ...o,
});

const ev = (id: string, p: Partial<WeekEvent> = {}): WeekEvent => ({
  rowId: `row-${id}`,
  calendarId: 'primary',
  externalEventId: id,
  title: 'ACME discovery',
  startsAt: at('09:00'),
  endsAt: at('10:00'),
  isAllDay: false,
  eventType: 'default',
  cancelled: false,
  myResponse: 'accepted',
  iAmOrganizer: false,
  attendance: 'attended',
  attendeeDomains: ['acme.example'],
  recurring: false,
  hasNotes: false,
  url: null,
  accountId: 'a-acme',
  oppOrg62Id: OPP_ACME,
  ...p,
});

const o62 = (id: string, p: Partial<WeekOrg62Event> = {}): WeekOrg62Event => ({
  rowId: `r62-${id}`,
  org62EventId: id,
  recordTypeName: 'Solutions Event',
  subject: 'ACME discovery',
  startsAt: at('09:00'),
  endsAt: at('10:00'),
  durationField: 1,
  seTaskTypeName: 'Customer Discovery',
  meetingTypeName: null,
  whatOrg62Id: OPP_ACME,
  ownerId: ME.org62UserId,
  whatName: null,
  ...p,
});

const key = (e: Pick<WeekEvent, 'calendarId' | 'externalEventId' | 'startsAt'>) => `cal|${e.calendarId}|${e.externalEventId}|${e.startsAt}`;
const fixed = (rowId: string, dedupeKey: string, status: string, p: Partial<FixedEntry> = {}): FixedEntry => ({
  rowId,
  dedupeKey,
  subject: 'ACME discovery',
  startsAt: dedupeKey.split('|')[3] ?? at('09:00'),
  endsAt: new Date(Date.parse(dedupeKey.split('|')[3] ?? at('09:00')) + 3_600_000).toISOString(),
  durationHours: 1,
  seTaskType: 'Customer Discovery',
  whatOrg62Id: OPP_ACME,
  meetingType: null,
  status,
  operation: 'create',
  targetOrg62EventId: null,
  flags: [],
  ...p,
});

const accountOf = (id: string) => {
  const o = matcher.oppByOrg62(id);
  return o?.accountId ? (matcher.accounts.get(o.accountId)?.org62AccountId ?? null) : null;
};
const input = (p: Partial<WeekInput> = {}, o: Partial<ActivityConfig> = {}): WeekInput => ({
  now: NOW,
  from: FROM,
  to: TO,
  cfg: cfg(o),
  mappings: matcher.mappings({ internalDomains: RULES.internal, partnerDomains: RULES.partner, ignoreDomains: RULES.ignore }),
  events: [],
  sessions: [],
  drive: [],
  slack: [],
  org62: [],
  fixed: [],
  fixedBlocks: [],
  names: (id) => {
    const opp = opps.find((x) => x.org62OpportunityId === id);
    if (opp) return { name: opp.name, mine: true };
    const a = accounts.find((x) => x.org62AccountId === id);
    return a ? { name: a.name } : null;
  },
  accountOf,
  ...p,
});
const keys = (p: ReturnType<typeof planWeek>) => p.entries.map((e) => [e.dedupeKey, e.status]);

// ---------------------------------------------------------------------------------------------------------------
// Manual Org62 Events
// ---------------------------------------------------------------------------------------------------------------

describe('manual Org62 Events', () => {
  it('TL-01 manual Event with another subject and the same start (±5 min): the proposal closes as its twin', () => {
    const p = planWeek(input({ events: [ev('e1')], org62: [o62('00UXX01', { subject: 'Customer time', startsAt: at('09:03'), endsAt: at('10:03') })] }));
    expect(keys(p)).toEqual([['org62|00UXX01', 'logged']]);
  });

  it('TL-02 start more than 5 min off, a short subject shifted, or a timezone shift: the same Related To or account, the same day, ≥ 50% overlap is a twin', () => {
    // 20 min late, another subject, the same opp
    const late = planWeek(input({ events: [ev('e1')], org62: [o62('00UXX02', { subject: 'Call', startsAt: at('09:20'), endsAt: at('10:20') })] }));
    expect(keys(late)).toEqual([['org62|00UXX02', 'logged']]);
    // a one-word subject shifted 30 min, on the account's other opp (the same account)
    const shifted = planWeek(input({ events: [ev('e1', { title: 'Sync' })], org62: [o62('00UXX03', { subject: 'ACME', startsAt: at('09:30'), endsAt: at('10:30'), whatOrg62Id: OPP_ACME_B })] }));
    expect(keys(shifted)).toEqual([['org62|00UXX03', 'logged']]);
    // 09:00 local typed as 09:00 UTC (a shift of exactly the UTC offset), the same opp and length
    const tz = planWeek(input({ events: [ev('e1')], org62: [o62('00UXX04', { subject: 'Discovery', startsAt: '2026-11-04T09:00:00.000Z', endsAt: '2026-11-04T10:00:00.000Z' })] }));
    expect(keys(tz)).toEqual([['org62|00UXX04', 'logged']]);
    // another customer's Event that overlaps by half is not a twin; nor is the same opp under half
    const other = planWeek(input({ events: [ev('e1')], org62: [o62('00UXX05', { subject: 'Globex build', startsAt: at('08:30'), endsAt: at('09:30'), whatOrg62Id: OPP_GLOBEX })] }));
    expect(keys(other)).toEqual([
      ['org62|00UXX05', 'logged'],
      [key(ev('e1')), 'proposed'],
    ]);
    const little = planWeek(input({ events: [ev('e1')], org62: [o62('00UXX06', { subject: 'Wrap-up', startsAt: at('09:45'), endsAt: at('10:45') })] }));
    expect(little.entries.map((e) => e.dedupeKey)).toContain(key(ev('e1')));
  });

  it('TL-03 one Event covering two meetings closes every meeting it fully covers', () => {
    const a = ev('e1', { title: 'ACME architecture', startsAt: at('09:00'), endsAt: at('10:00') });
    const b = ev('e2', { title: 'ACME roadmap', startsAt: at('10:00'), endsAt: at('11:00') });
    const one = o62('00UXX07', { subject: 'ACME architecture + roadmap', startsAt: at('09:00'), endsAt: at('11:00'), durationField: 2 });
    const p = planWeek(input({ events: [a, b], org62: [one] }));
    expect(keys(p)).toEqual([['org62|00UXX07', 'logged']]);
    expect(p.entries[0]!.reason).toMatch(/ACME architecture.*ACME roadmap/);
    // an approved row of the second meeting closes too (covered, never logged twice)
    const mine = planWeek(input({ events: [a, b], org62: [one], fixed: [fixed('mine-b', key(b), 'approved', { subject: 'ACME roadmap' })] }));
    expect(mine.covers).toEqual([{ rowId: 'mine-b', org62EventRowId: 'r62-00UXX07', flag: expect.stringContaining('Logged in Org62 inside') }]);
    // a meeting double-booked over the matched one is not "covered": it logs (D-18)
    const dbl = ev('e3', { title: 'ACME exec check-in', startsAt: at('09:15'), endsAt: at('09:45') });
    const p2 = planWeek(input({ events: [a, dbl], org62: [o62('00UXX08', { subject: 'ACME architecture', startsAt: at('09:00'), endsAt: at('10:00') })] }));
    expect(p2.entries.find((e) => e.dedupeKey === key(dbl))?.status).toBe('proposed');
  });

  it('TL-04 two Events for one meeting: both stay logged; the second is flagged "possible duplicate in Org62"', () => {
    const p = planWeek(input({ events: [ev('e1')], org62: [o62('00UXX09'), o62('00UXX10', { subject: 'ACME disco', startsAt: at('09:05'), endsAt: at('10:00'), durationField: 0.75 })] }));
    const rows = p.entries.filter((e) => e.dedupeKey.startsWith('org62|'));
    expect(rows.map((e) => [e.dedupeKey, e.status])).toEqual([
      ['org62|00UXX09', 'logged'],
      ['org62|00UXX10', 'logged'],
    ]);
    expect(rows[0]!.flags.some((f) => f.startsWith(DUPLICATE_MARKER))).toBe(false);
    expect(rows[1]!.flags.find((f) => f.startsWith(DUPLICATE_MARKER))).toMatch(/'ACME discovery' 09:00–10:00 is the same slot/);
    expect(p.entries.some((e) => e.excludedReason === 'overlap')).toBe(false);
  });

  it('TL-05 approved row, then logged manually with another subject and start: paired by slot; the row closes (Org62\'s values) and never goes on a canvas', () => {
    const e1 = ev('e1');
    const p = planWeek(input({ events: [e1], fixed: [fixed('mine-1', key(e1), 'approved')], org62: [o62('00UXX11', { subject: 'ACME call', startsAt: at('09:15'), endsAt: at('10:15'), durationField: 1 })] }));
    expect(p.moves).toEqual([{ rowId: 'mine-1', status: 'verified', org62EventRowId: 'r62-00UXX11', issues: [], adopt: expect.objectContaining({ note: expect.stringContaining(MANUAL_LOG_NOTE), startsAt: at('09:15'), endsAt: at('10:15'), subject: 'ACME call' }) }]);
    // the Event is the row's: no second logged row of it, no proposal beside it
    expect(p.entries.filter((e) => e.status !== 'excluded')).toEqual([]);
  });

  it('TL-06 row held on a staged canvas, then logged manually: the read-back closes it, and Apply\'s preflight drops it', () => {
    const e1 = ev('e1');
    const p = planWeek(input({ events: [e1], fixed: [fixed('mine-1', key(e1), 'approved')], org62: [o62('00UXX12', { subject: 'ACME call', startsAt: at('09:10'), endsAt: at('10:10') })], held: new Set(['mine-1']) }));
    expect(p.moves[0]).toMatchObject({ rowId: 'mine-1', status: 'verified' });
    const canvas = canvasOf([row('mine-1'), row('mine-2', { subject: 'Globex build', start: at('13:00'), end: at('14:00'), whatOrg62Id: OPP_GLOBEX })]);
    const pf = preflightCanvas(canvas, ctxOf({ 'mine-1': { status: 'verified' }, 'mine-2': {} }));
    expect(pf).toMatchObject({ changed: true, empty: false, dropped: [{ kind: 'event', ref: 'mine-1', reason: 'in Org62 already' }] });
    expect(pf.input.eventIds).toEqual(['mine-2']);
    expect(pf.input.hours).toBe(1);
    expect(pf.input.title).toBe('Activity log · Nov 4 · 1 row');
    expect(pf.input.markdown).toContain('# ADD (1 rows · 1.00 h of activities)');
    expect(pf.input.markdown).toMatch(/\n\|1\|Event\|Globex build\|/);
    expect(pf.input.markdown).not.toContain('CC#mine-1');
    // nothing left: refused
    expect(preflightCanvas(canvas, ctxOf({ 'mine-1': { status: 'verified' }, 'mine-2': { status: 'dismissed' } }))).toMatchObject({ changed: true, empty: true });
  });

  it('TL-07 overlapping meeting logged manually while another is approved in the app: the Org62 Event stays logged (D-18 rule 1)', () => {
    const e1 = ev('e1');
    const p = planWeek(input({ events: [e1], fixed: [fixed('mine-1', key(e1), 'approved')], org62: [o62('00UXX13', { subject: 'Globex prep', startsAt: at('09:30'), endsAt: at('10:30'), whatOrg62Id: OPP_GLOBEX, seTaskTypeName: 'Solution Creation' })] }));
    const g = p.entries.find((e) => e.dedupeKey === 'org62|00UXX13')!;
    expect(g.status).toBe('logged');
    expect(g.flags).toContain("overlaps 'ACME discovery' 09:30–10:00 (both log)");
    expect(p.moves).toEqual([]);
  });

  it('TL-08 a customer task type with Related To empty is flagged "Related To empty"', () => {
    const p = planWeek(input({ org62: [o62('00UXX14', { whatOrg62Id: null, seTaskTypeName: 'Customer Discovery' }), o62('00UXX15', { whatOrg62Id: null, seTaskTypeName: 'Asset Creation', startsAt: at('13:00'), endsAt: at('14:00') })] }));
    expect(p.entries.find((e) => e.dedupeKey === 'org62|00UXX14')!.flags).toContain(RELATED_TO_EMPTY_FLAG);
    // internal work with Related To empty is right as it is (D-64)
    expect(p.entries.find((e) => e.dedupeKey === 'org62|00UXX15')!.flags).not.toContain(RELATED_TO_EMPTY_FLAG);
    expect(org62CheckOf({ status: 'logged', issues: [RELATED_TO_EMPTY_FLAG] })).toBe('related_to_empty');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// App-logged Events edited or deleted in Org62
// ---------------------------------------------------------------------------------------------------------------

describe('app-logged Events edited or deleted in Org62', () => {
  const e1 = ev('e1');
  const verified = (p: Partial<FixedEntry> = {}) => fixed('mine-1', key(e1), 'verified', { org62EventRowId: 'r62-00UXX20', ...p });

  it('TL-11 duration, start or end edited in Org62: adopted, and written once (no rewrite on every pass)', () => {
    const edited = o62('00UXX20', { startsAt: at('09:00'), endsAt: at('10:30'), durationField: 1.5 });
    const p = planWeek(input({ events: [e1], org62: [edited], fixed: [verified()] }));
    expect(p.moves).toEqual([{ rowId: 'mine-1', status: 'verified', org62EventRowId: 'r62-00UXX20', issues: [], adopt: expect.objectContaining({ durationHours: 1.5, endsAt: at('10:30'), note: expect.stringContaining('Duration__c 1 → 1.5') }) }]);
    // the next pass, with the row as adopted: nothing to write
    const again = planWeek(input({ events: [e1], org62: [edited], fixed: [verified({ durationHours: 1.5, endsAt: at('10:30') })] }));
    expect(again.moves).toEqual([]);
    expect(again.flagMoves).toEqual([]);
  });

  it('TL-12 subject and start edited in Org62: matched by org62_event_row_id, adopted, not counted twice', () => {
    const moved = o62('00UXX20', { subject: 'ACME discovery (moved)', startsAt: at('14:00'), endsAt: at('15:00') });
    const p = planWeek(input({ events: [e1], org62: [moved], fixed: [verified()] }));
    expect(p.moves).toEqual([{ rowId: 'mine-1', status: 'verified', org62EventRowId: 'r62-00UXX20', issues: [], adopt: expect.objectContaining({ subject: 'ACME discovery (moved)', startsAt: at('14:00'), endsAt: at('15:00') }) }]);
    expect(p.entries.some((e) => e.dedupeKey === 'org62|00UXX20')).toBe(false);
    // and an Event a row of another pass is tied to is that row's: never a second row here
    const elsewhere = planWeek(input({ org62: [moved], linkedElsewhere: new Set(['00UXX20']) }));
    expect(elsewhere.entries).toEqual([]);
  });

  it('TL-13 Related To cleared in Org62: the row adopts no WhatId (what_kind none: the db test writes it)', () => {
    const p = planWeek(input({ events: [e1], org62: [o62('00UXX20', { whatOrg62Id: null })], fixed: [verified()] }));
    expect(p.moves[0]!.adopt).toMatchObject({ whatOrg62Id: null });
  });

  it('TL-14 app-logged Event deleted in Org62: "Deleted in Org62", with Log again / Leave out', () => {
    const gone: ActivityEntry = entry({ id: 'row-gone', status: 'verify_failed', issues: [`${ORG62_CHECK_PREFIX}${DELETED_IN_ORG62}`] });
    expect(org62CheckOf(gone)).toBe('deleted');
    expect(needsRelog(gone)).toBe(true);
    expect(countBucketOf(gone)).toBe('none');
    expect(READBACK_BADGE[readbackState(gone, NOW)!]).toBe('Deleted in Org62');
    expect(needsYou([gone]).groups.map((g) => [g.kind, g.title])).toEqual([['org62', 'Not in Org62']]);
    expect(resolvedEntry(gone, 'log_again')).toMatchObject({ status: 'approved', issues: [LOG_AGAIN_FLAG] });
    expect(resolvedEntry(gone, 'leave_out')).toMatchObject({ status: 'dismissed', excludedReason: 'dismissed', issues: [LEFT_OUT_FLAG] });
    // a row that is in Org62 offers neither
    expect(() => resolvedEntry(entry({ status: 'verified' }), 'log_again')).toThrow(/Only a row/);
  });

  it('TL-15 verify_failed, then fixed in Org62: back to verified, and counted in logged hours', () => {
    const p = planWeek(input({ events: [e1], org62: [o62('00UXX20')], fixed: [fixed('mine-1', key(e1), 'verify_failed', { org62EventRowId: 'r62-00UXX20' })] }));
    expect(p.moves).toEqual([{ rowId: 'mine-1', status: 'verified', org62EventRowId: 'r62-00UXX20', issues: [] }]);
    expect(countsAsLogged({ status: 'verified' })).toBe(true);
    // still different: stays verify_failed, and is in Org62 (counted), never "missing"
    const still = planWeek(input({ events: [e1], org62: [o62('00UXX20', { durationField: 2 })], fixed: [fixed('mine-1', key(e1), 'verify_failed', { org62EventRowId: 'r62-00UXX20' })] }));
    expect(still.moves[0]).toMatchObject({ status: 'verify_failed', issues: ['Duration__c: expected 1, Org62 has 2'] });
    expect(countBucketOf({ status: 'verify_failed', issues: ['Org62 check: Duration__c: expected 1, Org62 has 2'] })).toBe('logged');
  });

  it('TL-16 AE persona (Sales Events, no task type): verifies; blank and null are the same', () => {
    const ae = { recordTypeName: 'Sales Events', taskTypeRequired: false };
    const p = planWeek(input({ events: [e1], org62: [o62('00UXX21', { recordTypeName: 'Sales Events', seTaskTypeName: null })], fixed: [fixed('mine-1', key(e1), 'synced_to_canvas', { seTaskType: null })] }, ae));
    expect(p.moves).toEqual([{ rowId: 'mine-1', status: 'verified', org62EventRowId: 'r62-00UXX21', issues: [] }]);
    const rb = verifyReadback([eng({ seTaskType: '' })], [{ ...o62('00UXX22'), seTaskTypeName: null }], { now: NOW, taskTypeRequired: false });
    expect(rb.items[0]!.status).toBe('verified');
    // the SE still compares (normalized)
    expect(verifyReadback([eng({ seTaskType: '' })], [{ ...o62('00UXX22'), seTaskTypeName: null }], { now: NOW }).items[0]!.status).toBe('verified');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Canvas outcomes
// ---------------------------------------------------------------------------------------------------------------

describe('canvas outcomes', () => {
  const e1 = ev('e1');

  it('TL-20 canvas applied partially: the missing rows show "Not in Org62" on Time, with Log again', () => {
    // Org62 shows a later Event of mine (the canvas ran), but none for this row
    const p = planWeek(input({ events: [e1], fixed: [fixed('mine-1', key(e1), 'synced_to_canvas')], org62: [o62('00UXX30', { subject: 'Globex build', startsAt: at('15:00', '2026-11-06'), endsAt: at('16:00', '2026-11-06'), whatOrg62Id: OPP_GLOBEX })] }));
    expect(p.flagMoves).toEqual([{ rowId: 'mine-1', remove: [], add: [NOT_IN_ORG62_FLAG] }]);
    const row = entry({ id: 'mine-1', status: 'synced_to_canvas', issues: [NOT_IN_ORG62_FLAG] });
    expect(org62CheckOf(row)).toBe('not_in_org62');
    expect(READBACK_BADGE[readbackState(row, NOW)!]).toBe('Not in Org62');
    expect(countBucketOf(row)).toBe('none');
    expect(needsYou([row]).groups[0]).toMatchObject({ kind: 'org62', ids: ['mine-1'] });
    // found later: the flag goes
    const found = planWeek(input({ events: [e1], fixed: [fixed('mine-1', key(e1), 'synced_to_canvas', { flags: [NOT_IN_ORG62_FLAG] })], org62: [o62('00UXX31', { ccKey: 'mine-1' })] }));
    expect(found.flagMoves).toEqual([{ rowId: 'mine-1', remove: [NOT_IN_ORG62_FLAG], add: [] }]);
    expect(found.moves[0]).toMatchObject({ status: 'verified' });
  });

  it('TL-21 Slackbot creates a duplicate, or the canvas is executed twice: one verifies, the other is flagged a duplicate', () => {
    const p = planWeek(input({ events: [e1], fixed: [fixed('mine-1', key(e1), 'synced_to_canvas')], org62: [o62('00UXX32', { ccKey: 'mine-1' }), o62('00UXX33', { ccKey: 'mine-1' })] }));
    expect(p.moves).toEqual([{ rowId: 'mine-1', status: 'verified', org62EventRowId: 'r62-00UXX32', issues: [] }]);
    const dup = p.entries.find((e) => e.dedupeKey === 'org62|00UXX33')!;
    expect(dup.status).toBe('logged');
    expect(dup.flags.some((f) => f.startsWith(DUPLICATE_MARKER))).toBe(true);
  });

  it('TL-22 Slackbot shifts times (UTC as local): joined on CC#, the row verifies; a start more than 5 min off is flagged', () => {
    const shifted = o62('00UXX34', { ccKey: 'mine-1', startsAt: '2026-11-04T09:00:00.000Z', endsAt: '2026-11-04T10:00:00.000Z' });
    const p = planWeek(input({ events: [e1], fixed: [fixed('mine-1', key(e1), 'synced_to_canvas')], org62: [shifted] }));
    expect(p.moves).toEqual([{ rowId: 'mine-1', status: 'verified', org62EventRowId: 'r62-00UXX34', issues: [] }]);
    expect(p.flagMoves).toEqual([{ rowId: 'mine-1', remove: [], add: [expect.stringContaining(`${START_DIFFERS_MARKER} by 420 min`)] }]);
    // no second row of it, and once verified the shifted start is never adopted over the meeting's
    expect(p.entries.some((e) => e.dedupeKey === 'org62|00UXX34')).toBe(false);
    const next = planWeek(input({ events: [e1], fixed: [fixed('mine-1', key(e1), 'verified', { org62EventRowId: 'r62-00UXX34', flags: [p.flagMoves[0]!.add[0]!] })], org62: [shifted] }));
    expect(next.moves).toEqual([]);
  });

  it('TL-23 the CC# key: Description is read back (SOQL), the join is on CC#<uuid>, and canvas-parse accepts a UUID', () => {
    const id = '3f2c1a9e-7b4d-4e21-9c0a-5d6e7f8a9b0c';
    expect(readbackSoql('Event', ['00UXX0000000E01AAA'])).toContain(', Description, ');
    expect(EVENT_READBACK_BATCH).toBe(25);
    const skill = loadSkill('skills/scan-org62.md');
    expect(skill.versionTag).toBe('scan-org62@1.7.0');
    expect(skill.body).toMatch(/IsChild, Description, CreatedDate, SystemModstamp FROM Event WHERE OwnerId/);
    const raw = org62RowToRaw({ attributes: { type: 'Event' }, Id: '00UXX0000000E01AAA', Subject: 'ACME discovery', StartDateTime: '2026-11-04T16:00:00.000+0000', EndDateTime: '2026-11-04T17:00:00.000+0000', Duration__c: 1, RecordType: { Name: 'Solutions Event' }, Description: `CC#${id} | calendar 2026-11-04 | CF: external attendees (acme.example)`, SystemModstamp: '2026-11-04T18:00:00.000+0000' })!;
    expect((raw.payload as Record<string, unknown>).ccKey).toBe(id);
    expect(JSON.stringify(raw)).not.toContain('external attendees'); // the key only, never the Description text
    const md = renderWorkOrder({ ownerName: 'PERSON_ME', ownerOrg62Id: '005XX0000000OWNAAA', recordTypeId: '012XX0000000RTYAAA', generatedAt: NOW, events: [eventRow({ id, subject: 'ACME discovery', start: at('09:00'), end: at('10:00'), durationH: 1, taskType: 'Customer Discovery', whatOrg62Id: OPP_ACME, origin: 'calendar' })], updates: [], sourceLabel: 'Control Center' });
    expect(parseWorkOrder(md).adds[0]).toMatchObject({ kind: 'event', ref: id });
    // the read-back joins on it, whatever the subject and start
    const p = planWeek(input({ events: [e1], fixed: [{ ...fixed(id, key(e1), 'synced_to_canvas') }], org62: [o62('00UXX35', { ccKey: id, subject: 'Something else', startsAt: at('11:00'), endsAt: at('12:00') })] }));
    expect(p.moves[0]).toMatchObject({ rowId: id, status: 'verified', org62EventRowId: 'r62-00UXX35' });
  });

  it('TL-24 canvas never applied, rows later declined or cancelled: preflight at Apply drops them (and refuses when nothing is left)', () => {
    const canvas = canvasOf([row('mine-1'), row('mine-2', { subject: 'Globex build', start: at('13:00'), end: at('14:00'), whatOrg62Id: OPP_GLOBEX })]);
    const pf = preflightCanvas(canvas, ctxOf({ 'mine-1': { flags: [DECLINED_HELD_FLAG] }, 'mine-2': { flags: [CANCELLED_HELD_FLAG] } }));
    expect(pf).toMatchObject({ changed: true, empty: true });
    expect(pf.dropped.map((d) => d.reason)).toEqual(['you declined the meeting', 'the meeting was cancelled']);
  });

  it('TL-25 rows edited after staging, or edited at all while held: unstaged by the preflight (the next canvas takes them)', () => {
    const canvas = canvasOf([row('mine-1'), row('mine-2', { subject: 'Globex build', start: at('13:00'), end: at('14:00'), whatOrg62Id: OPP_GLOBEX })]);
    // the hours changed after staging
    expect(preflightCanvas(canvas, ctxOf({ 'mine-1': { durationH: 1.5, endsAt: at('10:30') }, 'mine-2': {} })).dropped).toEqual([{ kind: 'event', ref: 'mine-1', label: 'ACME discovery', reason: 'changed after staging; it goes on the next canvas' }]);
    // the opp changed
    expect(preflightCanvas(canvas, ctxOf({ 'mine-1': { whatId: OPP_ACME_B }, 'mine-2': {} })).dropped.map((d) => d.ref)).toEqual(['mine-1']);
    // any edit (a description): unstaged
    expect(preflightCanvas(canvas, { ...ctxOf({ 'mine-1': {}, 'mine-2': {} }), unstage: new Set(['mine-2']) }).dropped).toEqual([{ kind: 'event', ref: 'mine-2', label: 'Globex build', reason: 'edited after staging; it goes on the next canvas' }]);
    // unchanged rows: the canvas goes as it is
    expect(preflightCanvas(canvas, ctxOf({ 'mine-1': {}, 'mine-2': {} }))).toMatchObject({ changed: false, empty: false });
  });

  it('the preflight is a per-row-kind registry: a kind with no check is kept; another lane registers its own (DC, Use_Case__c)', () => {
    const md = `${canvasOf([row('mine-1')]).markdown.replace('# UPDATE (0 rows)', '|2|Deal_Contribution__c|ACME - Data 360 Expansion||||006XX0000000001AAA||ADD DC|\n\n# UPDATE (0 rows)')}`;
    const rows = canvasRowsOf(md);
    expect(rows.map((r) => r.kind)).toEqual(['event', 'dc']);
    const base = { ...canvasOf([row('mine-1')]), markdown: md };
    expect(preflightCanvas(base, ctxOf({ 'mine-1': { status: 'verified' } })).input.markdown).toContain('|1|Deal_Contribution__c|');
    registerCanvasRowCheck('other_object__c', () => 'no longer wanted');
    const other = { ...base, markdown: md.replace('# UPDATE (0 rows)', '|3|Other_Object__c|A record|||||||\n\n# UPDATE (0 rows)') };
    expect(preflightCanvas(other, ctxOf({ 'mine-1': {} })).dropped.map((d) => [d.kind, d.reason])).toEqual([['other_object__c', 'no longer wanted']]);
    registerCanvasRowCheck('other_object__c', () => null);
  });

  it('D-68 DC rows in the same preflight: a DC that landed in Org62 drops out; a change written against a split Org62 no longer shows is refused', () => {
    const add = `|2|Deal_Contribution__c|ACME - Data 360 Expansion|||Solution Engineer|100|${OPP_ACME}||Claim: my DC|`;
    const change = '|1|Deal_Contribution__c|a0BXX0000000D01AAA|Split_Percentage__c|100|50|Split to 100%|';
    const md = canvasOf([row('mine-1')]).markdown.replace('# UPDATE (0 rows)', `${add}\n\n# UPDATE (1 rows)`).concat(`\n${change}`);
    const dcLive = { myDcs: [{ org62DcId: 'a0BXX0000000D02AAA', org62OpportunityId: OPP_ACME, split: 50 }, { org62DcId: 'a0BXX0000000D01AAA', org62OpportunityId: '006XX0000000009AAA', split: 75 }] };
    const pf = preflightCanvas({ ...canvasOf([row('mine-1')]), markdown: md }, { ...ctxOf({ 'mine-1': {} }), dcLive });
    expect(pf.dropped.map((d) => [d.kind, d.reason.slice(0, 40)])).toEqual([
      ['dc', 'Org62 already has your DC on ACME - Data'],
      ['update:Deal_Contribution__c', 'refused, Org62 holds another value: Org6'],
    ]);
    expect(pf.input.eventIds).toEqual(['mine-1']);
    // without the live state (a check that cannot know), the rows stay
    expect(preflightCanvas({ ...canvasOf([row('mine-1')]), markdown: md }, ctxOf({ 'mine-1': {} })).changed).toBe(false);
  });

  it('D-67 Use_Case__c rows: a use case created in Org62 since, or withdrawn from VDP, drops out at Apply; one still waiting goes', () => {
    const uc = (n: number, name: string, key: string) => `|${n}|Use_Case__c|${name}|${OPP_ACME}|${ACCT_ACME}|Data 360|D360 Custom||U01 - Not Started||||Source: VDP CC-UC#${key}|`;
    const md = canvasOf([row('mine-1')])
      .markdown.replace('# UPDATE (0 rows)', ['# USE CASES (3 rows)', '', UC_HEADER, '|---|---|---|---|---|---|---|---|---|---|---|---|---|', uc(1, 'Churn agent', 'uc-1'), uc(2, 'Service agent', 'uc-2'), uc(3, 'Sales agent', 'uc-3'), '', '# UPDATE (1 rows · 1 use-case fix)'].join('\n'))
      .concat('\n|1|Use_Case__c|a0YXX0000000U01AAA|Stage__c|U03 - Scoping|U01 - Not Started|Churn agent: VDP phase changed|');
    const state: Record<string, { state: string; fields: string[] }> = { 'uc-1': { state: 'in_org62', fields: [] }, 'uc-2': { state: 'in_canvas', fields: [] } };
    const pf = preflightCanvas({ ...canvasOf([row('mine-1')]), markdown: md }, { ...ctxOf({ 'mine-1': {} }), useCase: (k: string) => state[k] ?? null, useCaseRecord: () => ({ state: 'in_org62', fields: [] }) });
    expect(pf.dropped.map((d) => [d.kind, d.ref, d.reason])).toEqual([
      ['use_case__c', 'uc-1', 'created in Org62 already'],
      ['use_case__c', 'uc-3', 'withdrawn from VDP'],
      ['update:Use_Case__c', 'a0YXX0000000U01AAA', 'Org62 has it already'],
    ]);
    expect(pf.empty).toBe(false);
    expect(pf.input.markdown).toContain('# USE CASES (1 row)');
    expect(pf.input.markdown).toMatch(/\n\|1\|Use_Case__c\|Service agent\|/);
    expect(pf.input.markdown).toMatch(/# UPDATE \(0 rows\)\n/);
    expect(pf.input.eventIds).toEqual(['mine-1']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Calendar changes
// ---------------------------------------------------------------------------------------------------------------

describe('calendar changes', () => {
  it('TL-31 meeting cancelled after approve or stage: the same as declined', () => {
    const e1 = ev('e1', { cancelled: true });
    const free = planWeek(input({ events: [e1], fixed: [fixed('mine-1', key(e1), 'approved')] }));
    expect(free.declined).toEqual([{ rowId: 'mine-1', action: 'remove' }]);
    const held = planWeek(input({ events: [e1], fixed: [fixed('mine-1', key(e1), 'approved')], held: new Set(['mine-1']) }));
    expect(held.declined).toEqual([{ rowId: 'mine-1', action: 'flag', flag: CANCELLED_HELD_FLAG }]);
    const logged = planWeek(input({ events: [e1], fixed: [fixed('mine-1', key(e1), 'synced_to_canvas')] }));
    expect(logged.declined).toEqual([{ rowId: 'mine-1', action: 'flag', flag: CANCELLED_LOGGED_FLAG }]);
    // and the held row is dropped from its canvas at Apply
    expect(preflightCanvas(canvasOf([row('mine-1')]), ctxOf({ 'mine-1': { flags: [CANCELLED_HELD_FLAG] } }))).toMatchObject({ changed: true, empty: true });
  });

  it('TL-32 meeting rescheduled after approve or log: re-keyed by event id, the row moves; no stale approved row and no new proposal', () => {
    const before = ev('e1');
    const after = ev('e1', { startsAt: at('14:00'), endsAt: at('15:30') });
    const p = planWeek(input({ events: [after], fixed: [fixed('mine-1', key(before), 'approved')] }));
    expect(p.rekeys).toEqual([{ rowId: 'mine-1', dedupeKey: key(after), startsAt: at('14:00'), endsAt: at('15:30'), durationHours: 1.5 }]);
    expect(p.entries.some((e) => e.dedupeKey === key(after))).toBe(false);
    // hours the user set stay theirs (the row moves, its length does not)
    const edited = planWeek(input({ events: [after], fixed: [fixed('mine-1', key(before), 'approved', { durationHours: 0.5, endsAt: at('09:30'), lockedFields: ['duration_hours'] })] }));
    expect(edited.rekeys[0]).toMatchObject({ startsAt: at('14:00'), endsAt: at('14:30'), durationHours: 0.5 });
    // logged already: it stays where Org62 has it, flagged; its new time opens no proposal
    const logged = planWeek(input({ events: [after], fixed: [fixed('mine-1', key(before), 'verified')] }));
    expect(logged.rekeys).toEqual([]);
    expect(logged.flagMoves).toEqual([{ rowId: 'mine-1', remove: [], add: [expect.stringContaining(`${RESCHEDULED_MARKER} to 2026-11-04 14:00`)] }]);
    expect(logged.entries.some((e) => e.dedupeKey === key(after))).toBe(false);
  });

  it('TL-34 week boundaries: Time reads weeks in the profile TZ, the same as the projections', () => {
    // Sunday 20:00 in Denver is Monday 03:00 UTC: still the week of Mon 2026-11-02
    const sun = new Date('2026-11-09T03:00:00.000Z');
    expect(timeWeekBounds(undefined, sun, TZ)).toEqual({ start: '2026-11-02', end: '2026-11-08', from: Date.parse(FROM), to: Date.parse(TO) });
    // a week across the DST change (2026-11-01 02:00 MDT → MST): Monday 00:00 local each side
    const dst = timeWeekBounds('2026-10-28', sun, TZ);
    expect(new Date(dst.from).toISOString()).toBe('2026-10-26T06:00:00.000Z');
    expect(new Date(dst.to).toISOString()).toBe('2026-11-02T07:00:00.000Z');
    // Tokyo's Monday starts 15:00 UTC on Sunday
    expect(new Date(timeWeekBounds('2026-11-04', sun, 'Asia/Tokyo').from).toISOString()).toBe('2026-11-01T15:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Counts, personas, failures
// ---------------------------------------------------------------------------------------------------------------

describe('counts, personas, failures', () => {
  it('TL-41 a legacy record-type Event closes the proposal but is not counted until re-created', () => {
    const p = planWeek(input({ events: [ev('e1')], org62: [o62('00UXX40', { recordTypeName: 'Sales Engineer Events' })] }));
    expect(keys(p)).toEqual([['org62|00UXX40', 'logged']]);
    const row = p.entries[0]!;
    expect(row.flags.some((f) => f.includes('(legacy, locked)'))).toBe(true);
    const e = entry({ status: 'logged', issues: row.flags, durationH: 1 });
    expect(countBucketOf(e)).toBe('none');
    expect(weekTotals([e]).loggedH).toBe(0);
    expect(quarterLoggedH([{ ...e, date: '2026-11-04' }], { start: '2026-11-01', end: '2027-01-31' })).toBe(0);
  });

  it('TL-43 worker down for more than 14 days: org62:events catches up a quarter and more; other scopes keep 14 days', () => {
    const spec = org62Spec();
    expect(spec.maxBackfillMsFor?.('events')).toBe(ORG62_EVENTS_CATCH_UP_MS);
    expect(spec.maxBackfillMsFor?.('opps')).toBeUndefined();
    const now = new Date('2026-11-12T12:00:00.000Z');
    const from = new Date(now.getTime() - 40 * 86_400_000).toISOString();
    const long = planResume({ now, gaps: [{ from, to: now.toISOString() }], chunkMs: 7 * 86_400_000, maxBackfillMs: spec.maxBackfillMsFor!('events') });
    expect(long.find((w) => w.mode === 'backfill')!.window.from).toBe(from);
    const short = planResume({ now, gaps: [{ from, to: now.toISOString() }], chunkMs: 7 * 86_400_000 });
    expect(short.find((w) => w.mode === 'backfill')!.window.from).toBe(new Date(now.getTime() - 14 * 86_400_000).toISOString());
  });

  it('TL-45 one status → count map across Time, quarter totals, receipts and Home', () => {
    const rows: ActivityEntry[] = [
      entry({ id: 'v', status: 'verified', durationH: 1 }),
      entry({ id: 'l', status: 'logged', durationH: 1 }),
      entry({ id: 'd', status: 'verify_failed', durationH: 1, issues: ['Org62 check: Duration__c: expected 1, Org62 has 2'] }),
      entry({ id: 'x', status: 'verify_failed', durationH: 1, issues: [`${ORG62_CHECK_PREFIX}${DELETED_IN_ORG62}`] }),
      entry({ id: 'n', status: 'synced_to_canvas', durationH: 1, issues: [NOT_IN_ORG62_FLAG] }),
      entry({ id: 'w', status: 'synced_to_canvas', durationH: 1 }),
      entry({ id: 'g', status: 'logged', durationH: 1, issues: ['Org62 record type is Sales Engineer Events (legacy, locked): re-create as a Solutions Event to count'] }),
    ];
    // Time's week
    expect(weekTotals(rows)).toMatchObject({ loggedH: 3, approvedH: 1, needsReview: 3 });
    // the quarter totals (Ledger) and the current quarter (Time header)
    const q = quarterTotals(rows, { meta: { quarter: { label: 'Q4 FY27', loggedH: 0, targetH: 250, due: '2027-01-30T00:00:00.000Z' } } as never, now: new Date(NOW), tz: TZ });
    expect(q.find((x) => x.current)!.loggedH).toBe(3);
    expect(quarterLoggedH(rows, { start: '2026-11-01', end: '2027-01-31' })).toBe(3);
    // the canvas receipts: in Org62 / on its way / not in Org62
    const draft = { ...canvasDraft(rows.map((r) => r.id)), status: 'sent' as const };
    expect(logCanvasesOf([draft], rows, new Date(NOW))[0]!.org62).toEqual({ logged: 4, waiting: 1, missing: 2 });
    // the week's "where they are now": counted in Org62, or needs you
    const s = weekSuggested(rows, { needs: needsYou(rows), readyIds: [], stages: [] } as never);
    expect(s.parts.find((x) => x.id === 'org62')).toMatchObject({ rows: 4 });
    expect(s.parts.find((x) => x.id === 'needs')).toMatchObject({ rows: 2 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The mock DataSource: Apply's preflight, an edit that unstages, Log again / Leave out
// ---------------------------------------------------------------------------------------------------------------

describe('the mock DataSource round trip', () => {
  const seed = Seed.parse(JSON.parse(readFileSync(path.resolve(__dirname, '../../src/mock/seed.example.json'), 'utf8')));
  const fast = { enrichMs: 1e8, stepMs: 5, chatTokenMs: 0, verifyMs: 1e8, reevalMs: 1e8 };
  const made: MockDataSource[] = [];
  const fresh = () => {
    const ds = new MockDataSource({ seed: structuredClone(seed), delays: fast, autoplay: false, clockMode: 'seed' });
    made.push(ds);
    return ds;
  };
  afterEach(() => {
    for (const d of made.splice(0)) d.dispose();
  });
  async function call<K extends RouteKey>(ds: MockDataSource, k: K, inp: unknown): Promise<RouteOutput<K>> {
    const def = routes[k] as { body?: { parse: (v: unknown) => unknown }; response: (typeof routes)[K]['response'] };
    const parsed = inp as Record<string, unknown>;
    const out = await (ds[k as keyof MockDataSource] as (i: unknown) => Promise<unknown>).call(ds, { ...(def.body ? { body: def.body.parse(parsed.body ?? {}) } : {}), ...(parsed.params ? { params: parsed.params } : {}), ...(parsed.query ? { query: parsed.query } : {}) });
    const r = def.response.safeParse(out);
    if (!r.success) throw new Error(`${k} response failed the contract: ${JSON.stringify(r.error.issues.slice(0, 3))}`);
    return r.data as RouteOutput<K>;
  }
  /** Two ended approved rows of mine (placeholders), staged on one canvas item. */
  async function staged(ds: MockDataSource) {
    const base = ds.store.get('activity', 'ac_tue_sow')!;
    put(ds, 'activity', { ...base, id: 'ac_rt_b', description: 'Globex follow-up', start: '2026-11-03T15:00:00.000Z', end: '2026-11-03T16:00:00.000Z', date: '2026-11-03' });
    const b = await call(ds, 'stageLogBatch', { body: {} });
    const id = b.entity.draftIds[0]!;
    const d = ds.store.get('drafts', id)!;
    expect(canvasInputOf(d.destination as never).eventIds).toEqual(expect.arrayContaining(['ac_tue_sow', 'ac_rt_b']));
    return id;
  }
  const preview = (ds: MockDataSource, id: string) => call(ds, 'previewDraft', { params: { id }, body: { mode: 'send' } });

  it('TL-06 a held row logged by hand before Apply: Apply re-renders the canvas without it and refuses; nothing is sent', async () => {
    const ds = fresh();
    const id = await staged(ds);
    put(ds, 'activity', { ...ds.store.get('activity', 'ac_tue_sow')!, status: 'verified' });
    const p = await preview(ds, id);
    const err = await call(ds, 'dispatchDraft', { params: { id }, body: { ifVersion: p.version, mode: 'send', confirmToken: p.confirmToken } }).catch((e: unknown) => e as Error);
    expect((err as Error).message).toMatch(/The canvas changed since you staged it: 1 row left out: '.*' \(in Org62 already\)\. Review it and Apply again; nothing was sent/);
    const d = ds.store.get('drafts', id)!;
    expect(d.status).toBe('ready');
    const i = canvasInputOf(d.destination as never);
    expect(i.eventIds).toContain('ac_rt_b');
    expect(i.eventIds).not.toContain('ac_tue_sow');
    expect(i.markdown).not.toContain('CC#ac_tue_sow');
    expect(d.attempts).toEqual([]);
    // the re-rendered item Applies (dry run here) as it is now
    const p2 = await preview(ds, id);
    const ok = await call(ds, 'dispatchDraft', { params: { id }, body: { ifVersion: p2.version, mode: 'send', confirmToken: p2.confirmToken } });
    expect(ok.dryRun).toBe(true);
  });

  it('TL-24 every meeting row of a canvas cancelled before Apply: they drop out (the item is discarded when nothing else is on it), and Apply is refused', async () => {
    const ds = fresh();
    const id = await staged(ds);
    const held = canvasInputOf(ds.store.get('drafts', id)!.destination as never).eventIds;
    for (const rid of held) put(ds, 'activity', { ...ds.store.get('activity', rid)!, issues: [CANCELLED_HELD_FLAG] });
    const p = await preview(ds, id);
    const err = await call(ds, 'dispatchDraft', { params: { id }, body: { ifVersion: p.version, mode: 'send', confirmToken: p.confirmToken } }).catch((e: unknown) => e as Error);
    expect((err as Error).message).toMatch(new RegExp(`^(Nothing left to log on this canvas|The canvas changed since you staged it): ${held.length} rows left out: .*\\(the meeting was cancelled\\)`));
    const d = ds.store.get('drafts', id)!;
    // the seed's other rows on it (VDP use cases, D-67) still go; with none, the item is discarded
    const left = canvasRowsOf(canvasInputOf(d.destination as never).markdown);
    expect(left.some((r) => r.kind === 'event')).toBe(false);
    if (left.length) expect(d.status).toBe('ready');
    else expect(d).toMatchObject({ status: 'discarded', rejectedReason: expect.stringMatching(/^Nothing left to log: /) });
    expect(d.attempts).toEqual([]);
  });

  it('TL-25 an edit to a held row unstages it: the canvas item is re-rendered without it, and the row goes on the next batch', async () => {
    const ds = fresh();
    const id = await staged(ds);
    const row = ds.store.get('activity', 'ac_rt_b')!;
    await call(ds, 'patchActivity', { params: { id: row.id }, body: { ifVersion: row.version, patch: { description: 'Globex follow-up (notes)' } } });
    const i = canvasInputOf(ds.store.get('drafts', id)!.destination as never);
    expect(i.eventIds).toContain('ac_tue_sow');
    expect(i.eventIds).not.toContain('ac_rt_b');
    // the next batch takes it, as edited
    const b = await call(ds, 'stageLogBatch', { body: {} });
    expect(canvasInputOf(ds.store.get('drafts', b.entity.draftIds[0]!)!.destination as never).markdown).toContain('Globex follow-up (notes)');
  });

  it('TL-14 / TL-20 Log again puts a row that is not in Org62 back on the next canvas; Leave out dismisses it', async () => {
    const ds = fresh();
    const synced = ds.store.get('activity', 'ac_tue_globex')!;
    put(ds, 'activity', { ...synced, issues: [NOT_IN_ORG62_FLAG] });
    // a sent canvas listed it: without Log again no batch takes it again
    const sent = { ...canvasDraft(['ac_tue_globex']), status: 'sent' as const };
    put(ds, 'drafts', sent);
    const week = await call(ds, 'getTime', { query: { week: synced.date } });
    expect(week.entries.find((e) => e.id === synced.id)!.issues).toContain(NOT_IN_ORG62_FLAG);
    const cur = ds.store.get('activity', synced.id)!;
    const again = await call(ds, 'resolveActivity', { params: { id: synced.id }, body: { ifVersion: cur.version, action: 'log_again' } });
    expect(again.entity).toMatchObject({ status: 'approved', issues: [LOG_AGAIN_FLAG] });
    const b = await call(ds, 'stageLogBatch', { body: {} });
    expect(b.entity.draftIds.some((d) => canvasInputOf(ds.store.get('drafts', d)!.destination as never).eventIds.includes(synced.id))).toBe(true);
    // Leave out on another one
    const del = ds.store.get('activity', 'ac_wed_umbrella')!;
    put(ds, 'activity', { ...del, issues: [`${ORG62_CHECK_PREFIX}${DELETED_IN_ORG62}`] });
    const out = await call(ds, 'resolveActivity', { params: { id: del.id }, body: { ifVersion: ds.store.get('activity', del.id)!.version, action: 'leave_out' } });
    expect(out.entity).toMatchObject({ status: 'dismissed', excludedReason: 'dismissed', issues: [LEFT_OUT_FLAG] });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------

function entry(p: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 'row-1',
    version: 1,
    date: '2026-11-04',
    start: at('09:00'),
    end: at('10:00'),
    durationH: 1,
    taskType: 'Customer Discovery',
    oppId: 'o-acme',
    oppName: 'ACME - Data 360 Expansion',
    accountName: 'ACME Corporation',
    meetingType: 'CF',
    description: 'ACME discovery',
    status: 'proposed',
    confidence: 'likely',
    sources: [],
    userLockedFields: [],
    issues: [],
    updatedAt: NOW,
    fromOrg62: false,
    excludedReason: null,
    loggedAt: null,
    verifiedAt: null,
    internal: false,
    dismissSource: null,
    logNote: null,
    logNoteBasis: null,
    why: null,
    suggestion: null,
    ...p,
  };
}

function eng(p: Partial<Parameters<typeof verifyReadback>[0][number]> = {}): Parameters<typeof verifyReadback>[0][number] {
  return {
    dedupeKey: 'k1',
    origin: 'calendar',
    operation: 'create',
    targetOrg62EventId: null,
    subject: 'ACME discovery',
    startsAt: at('09:00'),
    endsAt: at('10:00'),
    durationHours: 1,
    seTaskType: 'Customer Discovery',
    meetingType: '',
    whatKind: 'opportunity',
    whatOrg62Id: OPP_ACME,
    whatName: null,
    customerFacing: true,
    customerRelated: true,
    description: '',
    confidence: 'High',
    reason: '',
    flags: [],
    evidenceIds: [],
    evidence: '',
    status: 'synced_to_canvas',
    excludedReason: null,
    userLockedFields: [],
    ...p,
  };
}

type Row = { id: string; subject: string; start: string; end: string; durationH: number; taskType: string; whatOrg62Id: string };
const row = (id: string, p: Partial<Row> = {}): Row => ({ id, subject: 'ACME discovery', start: at('09:00'), end: at('10:00'), durationH: 1, taskType: 'Customer Discovery', whatOrg62Id: OPP_ACME, ...p });

/** One logging canvas of these rows, as a batch stages it. */
function canvasOf(rows: Row[]) {
  const events = rows.map((r) => eventRow({ ...r, origin: 'calendar' }));
  const md = renderWorkOrder({ ownerName: 'PERSON_ME', ownerOrg62Id: '005XX0000000OWNAAA', recordTypeId: '012XX0000000RTYAAA', generatedAt: NOW, events, updates: [], sourceLabel: 'Control Center · Nov 4' });
  return { title: `Activity log · Nov 4 · ${rows.length} rows`, markdown: md, eventIds: rows.map((r) => r.id), hours: rows.reduce((s, r) => s + r.durationH, 0), updates: 0, updateIds: [], part: 1, parts: 1 };
}

/** Write a row or a draft into the mock store (as the app would have it). */
const put = (ds: MockDataSource, col: 'activity' | 'drafts', v: unknown) => (ds.store as unknown as { _set: (c: string, x: unknown) => void })._set(col, v);

function canvasDraft(ids: string[]): Draft {
  const dest = canvasActionFor({ ...canvasOf(ids.map((id) => row(id))), eventIds: ids });
  return { id: 'dr_rt_canvas', version: 1, workItemId: null, nbaId: null, destination: dest, mode: 'send' as const, doc: { type: 'doc', content: [] }, plainText: '', rendered: { slackMrkdwn: '', emailHtml: '', plain: '' }, userTouched: false, userLockedFields: [], status: 'ready' as const, threadContext: [], createdAt: NOW, updatedAt: NOW, savedAt: null, scheduledFor: null, attempts: [{ id: 'at1', at: NOW, mode: 'send' as const, dryRun: false, outcome: 'delivered' as const, detail: null }], verification: null, rejectedReason: null, resultUrl: null } as unknown as Draft;
}

/** The preflight's state: each row approved and as staged, unless overridden. */
function ctxOf(over: Record<string, Partial<PreflightActivity>>) {
  return {
    activity: (id: string): PreflightActivity | null => {
      if (!(id in over)) return null;
      const r = row(id, id === 'mine-2' ? { subject: 'Globex build', start: at('13:00'), end: at('14:00'), whatOrg62Id: OPP_GLOBEX } : {});
      return { status: 'approved', startsAt: r.start, endsAt: r.end, durationH: r.durationH, taskType: r.taskType, whatId: r.whatOrg62Id, flags: [], ...over[id] };
    },
    taskTypeRequired: true,
  };
}
