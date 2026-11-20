/**
 * ORG62 lane (pure, placeholders only): the daily book read as the source of truth for "my book", Event times and
 * Meeting_Type__c from the payload, the deals engine over the stored Org62 data (Deals ▸ Missed), and the quarter
 * total counting only the current fiscal quarter.
 */
import { describe, expect, it } from 'vitest';

import { fiscalLockRules, isMissedCandidate, missedOpps, type MissedEvidence } from '@/projections/missed';
import { projectOrg62 } from '@/projections/org62';
import { currentQuarter, fiscalQuarterAt, fiscalQuarterBounds, quarterLoggedH, quarterTotal } from '@/server/datasource/db/quarter';

import { ACCT_ACME, ACCT_GLOBEX, OPP_ACME, OPP_GLOBEX, org62Item } from './fixtures';

const OPP_ACME_3 = '006XX0000000004AAA';
const OPP_INITECH = '006XX0000000007AAA';
const ACCT_INITECH = '001XX0000000003AAA';
const OPP_GLOBEX_2 = '006XX0000000008AAA';
const STAMP = '2026-11-06T13:00:00.000Z';
const ME = { org62UserId: '005XX0000000001AAA', name: 'Ada Example' };
const NO_EVIDENCE: MissedEvidence = { calendar: [], drive: [], sessions: [] };

const book = (oppId: string, name: string, acct: [string, string], o: { stamp?: string; role?: string; amount?: number } = {}) => ({
  ...org62Item(`Book:${oppId}`, {
    title: name,
    // lean, as the skill records it: no payload, everything in the excerpt
    body: `book_at=${o.stamp ?? STAMP}; stage=Discovery; close=2027-01-20; amount=${o.amount ?? 150000}; team_role=${o.role ?? 'Solution Engineer'}`,
    accountHints: [acct[0], acct[1]],
    oppHints: [oppId],
  }),
  occurredAt: '2026-09-01T10:00:00.000Z', // unchanged for months: the windowed scans never see it
});
const run = (rows: number, complete = true, stamp = STAMP) => ({ ...org62Item(`BookRun:run-${stamp}`, { title: 'Book read', body: `book_at=${stamp}; rows=${rows}; complete=${complete}` }), occurredAt: stamp });
const bookDc = (dcId: string, oppId: string, stamp = STAMP) => ({ ...org62Item(`BookDc:${dcId}`, { title: 'DC', body: `book_at=${stamp}; role=AI + Data Architect; split=50`, oppHints: [oppId] }), occurredAt: '2026-08-01T10:00:00.000Z' });
const oldTeam = (oppId: string, name: string, acct: [string, string]) =>
  org62Item(`Opportunity:${oppId}@2026-10-01T10:00:00.000+0000`, { title: name, meta: { Id: oppId, StageName: 'Discovery', Amount: 60000, IsClosed: false }, body: 'stage=Discovery; team_role=Solution Engineer', accountHints: [acct[0], acct[1]], oppHints: [oppId] });

describe('the daily book read (scan-org62 §6 `book`)', () => {
  it('brings in open team opps the windowed scans never reach, with their accounts', () => {
    const b = projectOrg62([book(OPP_ACME, 'ACME - Data 360 Expansion', [ACCT_ACME, 'ACME Corporation']), book(OPP_ACME_3, 'ACME - Agentforce Pilot', [ACCT_ACME, 'ACME Corporation']), run(2)]);
    expect(b.bookRead).toEqual({ at: STAMP, expected: 2, seen: 2, authoritative: true });
    expect(b.accounts.map((a) => [a.name, a.via])).toEqual([['ACME Corporation', ['opp_team']]]);
    expect(b.opps.map((o) => [o.org62OpportunityId, o.onMyTeam, o.inBook, o.myTeamRole, o.amount, o.leftBookAt])).toEqual([
      [OPP_ACME, true, true, 'Solution Engineer', 150000, null],
      [OPP_ACME_3, true, true, 'Solution Engineer', 150000, null],
    ]);
  });

  it('marks an opp I was on the team of that the complete read no longer lists (kept, never dropped)', () => {
    const b = projectOrg62([oldTeam(OPP_INITECH, 'Initech - Pilot', [ACCT_INITECH, 'Initech']), book(OPP_ACME, 'ACME - Data 360 Expansion', [ACCT_ACME, 'ACME Corporation']), run(1)]);
    expect(b.opps.find((o) => o.org62OpportunityId === OPP_INITECH)).toMatchObject({ onMyTeam: false, inBook: false, leftBookAt: STAMP, myTeamRole: 'Solution Engineer' });
    expect(b.accounts.map((a) => a.org62AccountId)).toEqual([ACCT_ACME]);
  });

  it('a team row newer than the read still counts (added since); an older stamp is not in the book', () => {
    const later = org62Item(`OpportunityTeamMember:${OPP_INITECH}@2026-11-06T15:00:00.000+0000`, { title: 'Initech - Pilot', meta: { TeamMemberRole: 'Solution Engineer' }, accountHints: [ACCT_INITECH, 'Initech'], oppHints: [OPP_INITECH] });
    const b = projectOrg62([later, book(OPP_ACME, 'ACME - Data 360 Expansion', [ACCT_ACME, 'ACME Corporation'], { stamp: '2026-11-05T13:00:00.000Z' }), run(1, true, '2026-11-05T13:00:00.000Z'), run(0)]);
    expect(b.opps.find((o) => o.org62OpportunityId === OPP_INITECH)).toMatchObject({ onMyTeam: true, leftBookAt: null });
    // the newest complete read (0 rows) no longer lists ACME's opp: it left
    expect(b.opps.find((o) => o.org62OpportunityId === OPP_ACME)).toMatchObject({ onMyTeam: false, inBook: false, leftBookAt: STAMP });
  });

  it('a team row whose opp closed: the excerpt flag or a numbered "Closed" stage closes it (it is no open opp of mine)', () => {
    const flagged = org62Item(`OpportunityTeamMember:${OPP_INITECH}@2026-11-05T15:00:00.000+0000`, { title: 'Initech - Pilot', body: 'stage=Negotiation; closed=true; won=true; team_role=Solution Engineer', accountHints: [ACCT_INITECH, 'Initech'], oppHints: [OPP_INITECH] });
    expect(projectOrg62([flagged, run(0)]).opps[0]).toMatchObject({ isClosed: true, isWon: true, onMyTeam: true, leftBookAt: null });
    const numbered = org62Item(`OpportunityTeamMember:${OPP_INITECH}@2026-11-05T15:00:00.000+0000`, { title: 'Initech - Pilot', body: 'stage=08 - Closed; team_role=Solution Engineer', accountHints: [ACCT_INITECH, 'Initech'], oppHints: [OPP_INITECH] });
    expect(projectOrg62([numbered]).opps[0]).toMatchObject({ isClosed: true, isWon: false });
  });

  it('"no role" spellings are no role; the read says an open opp on my account is not mine, whatever older rows said', () => {
    const accountRow = org62Item(`Opportunity:${OPP_ACME_3}@2026-11-06T10:00:00.000+0000`, { title: 'ACME - Agentforce Pilot', meta: { StageName: '02 Negotiate', IsClosed: false }, body: 'stage=02 Negotiate; team_role=none (account match)', accountHints: [ACCT_ACME, 'ACME Corporation'], oppHints: [OPP_ACME_3] });
    expect(projectOrg62([accountRow]).opps[0]).toMatchObject({ myTeamRole: null, onMyTeam: false, notInBookAt: null });
    const b = projectOrg62([accountRow, book(OPP_ACME, 'ACME - Data 360 Expansion', [ACCT_ACME, 'ACME Corporation']), run(1)]);
    expect(b.opps.find((o) => o.org62OpportunityId === OPP_ACME_3)).toMatchObject({ onMyTeam: false, notInBookAt: STAMP, leftBookAt: null });
    expect(b.opps.find((o) => o.org62OpportunityId === OPP_ACME)).toMatchObject({ onMyTeam: true, notInBookAt: null });
  });

  it('an incomplete read (or one whose rows did not all arrive) only adds, never marks', () => {
    for (const items of [
      [oldTeam(OPP_INITECH, 'Initech - Pilot', [ACCT_INITECH, 'Initech']), book(OPP_ACME, 'ACME - Data 360 Expansion', [ACCT_ACME, 'ACME Corporation']), run(1, false)],
      [oldTeam(OPP_INITECH, 'Initech - Pilot', [ACCT_INITECH, 'Initech']), book(OPP_ACME, 'ACME - Data 360 Expansion', [ACCT_ACME, 'ACME Corporation']), run(2)],
    ]) {
      const b = projectOrg62(items);
      expect(b.opps.find((o) => o.org62OpportunityId === OPP_INITECH)).toMatchObject({ onMyTeam: true, leftBookAt: null });
      expect(b.opps.find((o) => o.org62OpportunityId === OPP_ACME)).toMatchObject({ onMyTeam: true });
    }
  });

  it('my DCs: the read lists every DC of mine on open opps, so one it no longer returns was removed', () => {
    const oldDc = org62Item(`Deal_Contribution__c:a0XXX000000001AAA@2026-08-01T10:00:00.000+0000`, { title: 'DC', meta: { Opportunity__c: OPP_ACME_3, Opportunity_Role__c: 'AI + Data Architect', Split_Percentage__c: 100 }, oppHints: [OPP_ACME_3] });
    const items = [book(OPP_ACME, 'ACME - Data 360 Expansion', [ACCT_ACME, 'ACME Corporation']), book(OPP_ACME_3, 'ACME - Agentforce Pilot', [ACCT_ACME, 'ACME Corporation']), bookDc('a0XXX000000002AAA', OPP_ACME), oldDc, run(2)];
    const b = projectOrg62(items);
    expect(b.opps.find((o) => o.org62OpportunityId === OPP_ACME)).toMatchObject({ myDc: true, myDcRole: 'AI + Data Architect', myDcSplit: 50 });
    expect(b.opps.find((o) => o.org62OpportunityId === OPP_ACME_3)).toMatchObject({ myDc: false });
    // without an authoritative read the old DC still counts
    expect(projectOrg62(items.slice(0, 4)).opps.find((o) => o.org62OpportunityId === OPP_ACME_3)).toMatchObject({ myDc: true });
  });

  it('D-58: a DC alone is not "on my team" (the read decides membership), and each DC carries when it was last read', () => {
    // I hold a DC on an open Initech opp the book read does not list as a team opp
    const items = [book(OPP_ACME, 'ACME - Data 360 Expansion', [ACCT_ACME, 'ACME Corporation']), bookDc('a0XXX000000003AAA', OPP_INITECH), run(1)];
    const b = projectOrg62(items);
    const dcOnly = b.opps.find((o) => o.org62OpportunityId === OPP_INITECH)!;
    expect(dcOnly).toMatchObject({ myDc: true, myDcSplit: 50, myDcRole: 'AI + Data Architect', onMyTeam: false, teamKnown: true, notInBookAt: null, leftBookAt: null });
    expect(b.opps.find((o) => o.org62OpportunityId === OPP_ACME)).toMatchObject({ onMyTeam: true, teamKnown: true, myDc: false });
    expect(b.dcs).toEqual([expect.objectContaining({ org62DcId: 'a0XXX000000003AAA', org62OpportunityId: OPP_INITECH, splitPercent: 50, role: 'AI + Data Architect', seenAt: STAMP })]);
    // no complete read: membership is not decided here (a stored "on my team" only turns on)
    expect(projectOrg62(items.slice(0, 2)).opps.find((o) => o.org62OpportunityId === OPP_INITECH)).toMatchObject({ onMyTeam: false, teamKnown: false });
  });
});

describe('Org62 Events: times and Meeting_Type__c from the payload', () => {
  it('places an Event whose times are only in the payload (Salesforce datetime form), with its meeting type and CreatedDate', () => {
    const e = org62Item('Event:00UXX000000005AAA@2026-10-15T21:00:00.000+0000', { title: 'ACME workshop', meta: { StartDateTime: '2026-10-14T16:00:00.000+0000', EndDateTime: '2026-10-14T17:30:00.000+0000', Duration__c: null, SE_Task_Type__c: 'Workshop', Meeting_Type__c: 'Data Cloud Workshop', RecordTypeName: 'Solutions Event', WhatId: OPP_ACME, CreatedDate: '2026-10-15T20:00:00.000+0000' }, body: 'type=Workshop; hrs=1.5' });
    const b = projectOrg62([e]);
    expect(b.eventsWithoutStart).toBe(0);
    expect(b.events).toEqual([
      expect.objectContaining({ startsAt: '2026-10-14T16:00:00.000Z', endsAt: '2026-10-14T17:30:00.000Z', durationField: 1.5, meetingTypeName: 'Data Cloud Workshop', org62CreatedAt: '2026-10-15T20:00:00.000Z', whatOrg62Id: OPP_ACME }),
    ]);
  });

  it('reads the excerpt keys too (start, end, meeting_type, created)', () => {
    const e = org62Item('Event:00UXX000000006AAA@2026-11-02T21:00:00.000+0000', { title: 'Globex POC build', body: 'type=Proof of Concept; meeting_type=POC; start=2026-11-02T16:00:00.000+0000; end=2026-11-02T18:00:00.000+0000; created=2026-11-02T21:00:00.000+0000', oppHints: [OPP_GLOBEX] });
    expect(projectOrg62([e]).events[0]).toMatchObject({ startsAt: '2026-11-02T16:00:00.000Z', endsAt: '2026-11-02T18:00:00.000Z', meetingTypeName: 'POC', org62CreatedAt: '2026-11-02T21:00:00.000Z' });
  });
});

describe('missed opportunities: the deals engine over the stored Org62 data', () => {
  const sweep = (oppId: string, name: string, o: { signal?: string; hours?: number; others?: string; won?: boolean; amount?: number } = {}) =>
    org62Item(`MissedOpp:${oppId}`, {
      title: name,
      meta: { Id: oppId, AccountId: ACCT_GLOBEX, AccountName: 'Globex Inc.', StageName: o.won ? 'Closed Won' : 'Proposal', Amount: o.amount ?? 180000, CloseDate: '2026-12-31', IsClosed: !!o.won, IsWon: !!o.won, signal: o.signal ?? 'd360', hours: o.hours ?? 0, d360Amount: 120000, products: ['Data 360 Profiles'] },
      body: `tier=claim; signal=${o.signal ?? 'd360'}; hours=${o.hours ?? 0}; other_architect_dc=${o.others ?? 'none'}`,
      accountHints: [ACCT_GLOBEX, 'Globex Inc.'],
      oppHints: [oppId],
    });
  const globexDc = org62Item(`Deal_Contribution__c:a0XXX000000003AAA@2026-11-01T10:00:00.000+0000`, { title: 'DC on Globex - Agent Rollout', meta: { Opportunity__c: OPP_GLOBEX, Opportunity_Role__c: 'AI + Data Architect', Split_Percentage__c: 100 }, accountHints: [ACCT_GLOBEX, 'Globex Inc.'], oppHints: [OPP_GLOBEX] });
  const input = (items: ReturnType<typeof org62Item>[], evidence = NO_EVIDENCE) => ({ book: projectOrg62(items), me: ME, evidence, today: '2026-11-06', quarter: { start: '2026-11-01', end: '2027-01-31' } });

  it('Claim: a swept D360 opp with 3.5 h of my logged time; the evidence lines say why', () => {
    const r = missedOpps(input([globexDc, sweep(OPP_GLOBEX_2, 'Globex - Data Cloud Expansion', { hours: 3.5 })]));
    expect(r.findings.map((f) => [f.opportunityId, f.tier, f.verdict, f.evidenceStrength, f.myOrg62Hours])).toEqual([[OPP_GLOBEX_2.slice(0, 15), 'strong_evidence_no_dc', 'claim', 'strong', 3.5]]);
    expect(r.lines.get(OPP_GLOBEX_2.slice(0, 15))).toEqual(['D360 product line', 'Your account, no DC from you', 'Org62 event 3.5h (linked to this opp)', 'DC lock on 2027-02-10']);
    // claiming is a draft for the user (the Slackbot prompt); nothing here writes to Org62
    expect(r.findings[0]!.actions.map((a) => a.kind)).toEqual(['claim', 'dismiss']);
  });

  it('a split, not a second 100%: another architect already holds the role', () => {
    const r = missedOpps(input([globexDc, sweep(OPP_GLOBEX_2, 'Globex - Data Cloud Expansion', { hours: 2, others: 'Sam Placeholder 100%' })]));
    expect(r.findings[0]).toMatchObject({ otherArchitectDcCount: 1, suggestedSplit: 50 });
    expect(r.otherDcs.get(OPP_GLOBEX_2.slice(0, 15))).toEqual(['Sam Placeholder 100%']);
    expect(r.lines.get(OPP_GLOBEX_2.slice(0, 15))!.some((l) => l.startsWith('Split, not a second 100%'))).toBe(true);
  });

  it('Check: closed won on a core account with no evidence; skip (no evidence, open) writes nothing', () => {
    const won = missedOpps(input([globexDc, sweep(OPP_GLOBEX_2, 'Globex - Data Cloud Expansion', { won: true })]));
    expect(won.findings.map((f) => [f.tier, f.verdict])).toEqual([['won_no_dc', 'check']]);
    const open = missedOpps(input([globexDc, sweep(OPP_GLOBEX_2, 'Globex - Data Cloud Expansion')]));
    expect(open.findings).toEqual([]);
  });

  it('only opps whose "no DC from me" is known: swept, or in the complete book without my DC', () => {
    const items = [
      book(OPP_ACME, 'ACME - Data Cloud Expansion', [ACCT_ACME, 'ACME Corporation']),
      run(1),
      // another opp on my account the windowed scan saw: its DCs were never read whole → context only
      org62Item(`Opportunity:${OPP_ACME_3}@2026-11-02T10:00:00.000+0000`, { title: 'ACME - Data 360 Rollout', meta: { Id: OPP_ACME_3, StageName: 'Discovery', Amount: 90000, CloseDate: '2027-02-15', IsClosed: false }, accountHints: [ACCT_ACME, 'ACME Corporation'], oppHints: [OPP_ACME_3] }),
      org62Item('Event:00UXX000000007AAA@2026-11-03T21:00:00.000+0000', { title: 'ACME expansion demo', meta: { StartDateTime: '2026-11-03T16:00:00.000+0000', EndDateTime: '2026-11-03T17:00:00.000+0000', Duration__c: 1, WhatId: OPP_ACME }, oppHints: [OPP_ACME] }),
      org62Item('Event:00UXX000000008AAA@2026-11-03T21:00:00.000+0000', { title: 'ACME rollout prep', meta: { StartDateTime: '2026-11-04T16:00:00.000+0000', EndDateTime: '2026-11-04T18:00:00.000+0000', Duration__c: 2, WhatId: OPP_ACME_3 }, oppHints: [OPP_ACME_3] }),
    ];
    const b = projectOrg62(items);
    expect(b.opps.map((o) => [o.org62OpportunityId, isMissedCandidate(o)])).toEqual([
      [OPP_ACME, true],
      [OPP_ACME_3, false],
    ]);
    const r = missedOpps(input(items));
    expect(r.findings.map((f) => [f.opportunityId, f.verdict])).toEqual([[OPP_ACME.slice(0, 15), 'claim']]);
    expect(r.lines.get(OPP_ACME.slice(0, 15))).toContain('On your opp team (Solution Engineer), no DC from you');
  });

  it('my DC settles it: no finding, and the opp is "covered" (a claimed finding resolves)', () => {
    const items = [book(OPP_ACME, 'ACME - Data Cloud Expansion', [ACCT_ACME, 'ACME Corporation']), bookDc('a0XXX000000002AAA', OPP_ACME), run(1)];
    const r = missedOpps(input(items));
    expect(r.findings).toEqual([]);
    expect([...r.covered]).toEqual([OPP_ACME.slice(0, 15)]);
  });

  it('weak calendar evidence alone is a Check; an unaccepted invite is ignored', () => {
    const items = [book(OPP_ACME, 'ACME - Data Cloud Expansion', [ACCT_ACME, 'ACME Corporation']), run(1)];
    const cal = (owned: boolean): MissedEvidence => ({ calendar: [{ id: 'e1', title: 'ACME expansion sync', at: '2026-11-03T16:00:00.000Z', oppOrg62Id: OPP_ACME, accountOrg62Id: ACCT_ACME, owned, recurring: false, internalOnly: false }], drive: [], sessions: [] });
    expect(missedOpps(input(items, cal(true))).findings.map((f) => f.verdict)).toEqual(['check']);
    expect(missedOpps(input(items, cal(false))).findings).toEqual([]);
  });

  it('DC lock rules follow the fiscal quarters (locked on the 10th day of the next quarter)', () => {
    const rules = fiscalLockRules('2026-11-06', 1);
    expect(rules).toEqual([
      { closeFrom: '2026-08-01', closeTo: '2026-10-31', deadline: '2026-11-10' },
      { closeFrom: '2026-11-01', closeTo: '2027-01-31', deadline: '2027-02-10' },
      { closeFrom: '2027-02-01', closeTo: '2027-04-30', deadline: '2027-05-10' },
    ]);
    expect(fiscalLockRules('2027-01-15', 0)).toEqual([{ closeFrom: '2026-11-01', closeTo: '2027-01-31', deadline: '2027-02-10' }]);
  });
});

describe('the quarter total (Time, Today): this fiscal quarter only', () => {
  const META = { quarter: { label: 'Q4 FY27', targetH: 250, due: '2027-02-01T00:30:00.000Z', loggedH: 0 } };
  const rows = [
    { status: 'logged', date: '2026-10-31', durationH: 4 }, // Q3 FY27
    { status: 'logged', date: '2026-11-01', durationH: 1.5 },
    { status: 'verified', date: '2027-01-31', durationH: 2 },
    { status: 'approved', date: '2026-11-03', durationH: 3 },
    { status: 'logged', date: '2027-02-01', durationH: 5 }, // Q1 FY28
  ] as const;

  it('the fiscal year starts on 1 February (FY27 = Feb 2026 to Jan 2027)', () => {
    expect(fiscalQuarterBounds('Q4 FY27')).toEqual({ start: '2026-11-01', end: '2027-01-31' });
    expect(fiscalQuarterBounds('Q1 FY27')).toEqual({ start: '2026-02-01', end: '2026-04-30' });
    expect(fiscalQuarterAt(new Date('2026-11-06T16:00:00Z'), 'America/Denver').label).toBe('Q4 FY27');
    expect(fiscalQuarterAt(new Date('2027-02-01T06:59:00Z'), 'America/Denver').label).toBe('Q4 FY27'); // still 31 Jan in Denver
    expect(fiscalQuarterAt(new Date('2026-01-31T12:00:00Z'), 'America/Denver').label).toBe('Q4 FY26');
  });

  it('counts only logged / verified rows of the quarter', () => {
    expect(quarterLoggedH(rows, { start: '2026-11-01', end: '2027-01-31' })).toBe(3.5);
    expect(quarterTotal(META, rows, new Date('2026-11-06T16:00:00Z'), 'America/Denver')).toMatchObject({ loggedH: 3.5, q: { label: 'Q4 FY27' } });
  });

  it('after a rollover the stored label is stale: the current quarter counts, without the old base hours', () => {
    const q = currentQuarter({ quarter: { ...META.quarter, loggedH: 9.5 } }, new Date('2027-02-03T16:00:00Z'), 'America/Denver', '17:30');
    expect(q).toMatchObject({ label: 'Q1 FY28', start: '2027-02-01', end: '2027-04-30', baseH: 0, targetH: 250 });
    expect(quarterTotal({ quarter: { ...META.quarter, loggedH: 9.5 } }, rows, new Date('2027-02-03T16:00:00Z'), 'America/Denver').loggedH).toBe(5);
  });
});
