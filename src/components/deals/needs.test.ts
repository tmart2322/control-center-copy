import { describe, expect, it } from 'vitest';
import type { AccountDetail, AccountRow, MissedOpp, Opportunity } from '@/contract';
import { dealsNeeds } from '@/engines/deals/needs';
import { personaOf } from '@/personas';
import { accountKey, accountNeed, accountWords, ALL_DEALS_FEATURES, claimEvidenceOf, dealsFeaturesOf, groupNeeds, missedForAccount, needsEmptyLine, noAccountsLine, type DealsFeatures, type NeedRow } from './needs';

const acct = (o: Partial<AccountRow>): AccountRow =>
  ({ id: 'a1', name: 'ACME', industry: null, dcStatus: 'assigned', vdpStatus: 'linked', hoursQtd: 0, team: [], org62Url: null, notes: '', myDcs: [], openOpps: 1, openTasks: 0, pipelineAmount: 100_000, nextCloseDate: '2027-06-01', ...o }) as AccountRow;
const missed = (o: Partial<MissedOpp>): MissedOpp =>
  ({ id: 'm1', verdict: 'claim', oppId: null, oppName: 'ACME phase 2', accountName: 'ACME Corporation', amount: 500_000, stage: '02 - Determining', closeDate: '2027-01-01', evidence: ['Slack strong'], otherDcs: [], status: 'new', dismissReason: null, claimedWorkItemId: null, dcRequestId: null, foundAt: '2026-11-01T00:00:00.000Z', ...o }) as MissedOpp;
const opp = (o: Partial<Opportunity>): Opportunity =>
  ({ id: 'o1', accountId: 'a1', name: 'ACME expansion', stage: '03 - Validating', amount: 200_000, closeDate: '2026-11-12', isOpen: true, isMine: true, dcAssigned: false, vdpLinked: false, hoursQtd: 0, products: [], owner: null, nextStep: null, org62Url: 'https://org62.example.com/o1', myDc: null, ...o }) as Opportunity;

const TODAY = '2026-11-05';
const NOW = '2026-11-05T17:00:00.000Z';

/** The server's rows (src/engines/deals/needs.ts): what getDeals returns and DealsView renders. */
/** Chase reads the requests handed to Slackbot (DC-06), keyed to the opp's account: here, every opp named `req*`. */
const chaseOf = (opps: Opportunity[]) => opps.filter((o) => o.id.startsWith('req')).map((o) => ({ oppId: o.id, oppName: o.name, since: '2026-11-01T00:00:00.000Z' }));
const needsOf = (accounts: AccountRow[], opps: Opportunity[], m: MissedOpp[] = [], f: DealsFeatures = ALL_DEALS_FEATURES) => dealsNeeds({ accounts, opps, missed: m, requestedOppIds: new Set(chaseOf(opps).map((c) => c.oppId)), chase: chaseOf(opps), decisions: [], today: TODAY, now: NOW, features: f });
const detail = (opps: Opportunity[], m: MissedOpp[] = [], f: DealsFeatures = ALL_DEALS_FEATURES): AccountDetail =>
  ({ account: acct({}), opps, missed: m, items: [], briefs: [], initiatives: [], assets: [], runs: [], needs: needsOf([acct({ nextCloseDate: opps.map((o) => o.closeDate).filter(Boolean).sort()[0] ?? null })], opps, m, f) }) as unknown as AccountDetail;

describe('deals: what needs you', () => {
  it('matches Org62 legal names to account names', () => {
    expect(accountKey('Globex Management Company LLC')).toBe('globex');
    expect(accountKey('Initech Inc.')).toBe('initech');
    expect(missedForAccount([missed({})], 'ACME').map((m) => m.id)).toEqual(['m1']);
  });

  it('a DC gap names the opp and claims it in place on the account page', () => {
    const rows = needsOf([acct({ dcStatus: 'none', hoursQtd: 2 })], [opp({ hoursQtd: 2, closeDate: '2027-06-01' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ section: 'fix', tone: 'warning', badge: 'No DC', title: 'ACME: no DC on ACME expansion', verb: { label: 'Claim DC', href: '/deals/a1?claim=o1' }, claimOppId: 'o1' });
    expect(rows[0]!.why).toBe("1 opp you're on with no DC: ACME expansion · 2h QTD");
    expect(rows[0]!.resolve).toMatchObject({ rule: 'dc_gap', subjectIds: ['o1'], snooze: false, reasons: ['Not my deal', 'Already covered by a teammate', 'Too small', 'Other'] });
  });

  it('says my DC (split, role) on the account row', () => {
    expect(accountWords(acct({ myDcs: [{ oppId: 'o1', oppName: 'ACME expansion', split: 100, role: 'AI + Data Architect' }] }))).toBe('Your DC: 100% · AI + Data Architect · VDP linked');
    expect(accountWords(acct({ dcStatus: 'partial', openOpps: 3, myDcs: [{ oppId: 'o1', oppName: 'A', split: 100, role: null }, { oppId: 'o2', oppName: 'B', split: 50, role: null }] }))).toBe('DC partial · Your DCs on 2 opps: 100%, 50% · VDP linked');
  });

  it('puts close dates in Think ahead: amber within 14 days, red once passed, nothing past 45 days', () => {
    const rows = needsOf([acct({ id: 'soon', nextCloseDate: '2026-11-15' }), acct({ id: 'late', nextCloseDate: '2026-11-01' }), acct({ id: 'far', nextCloseDate: '2027-03-01' })], []);
    expect(rows.map((r) => [r.accountId, r.tone])).toEqual([
      ['late', 'danger'],
      ['soon', 'warning'],
    ]);
    expect(rows[0]!.resolve).toMatchObject({ rule: 'deals_ahead', subjectIds: ['late'], snooze: true, baseline: { nextCloseDate: '2026-11-01' } });
  });

  it('drops empty sections and keeps verb names', () => {
    const groups = groupNeeds(needsOf([acct({ dcStatus: 'requested' })], [opp({ id: 'req1', isMine: false, closeDate: '2027-06-01' })]));
    expect(groups.map((g) => g.title)).toEqual(['Chase']);
  });
});

// ── Personas (D-55) ─────────────────────────────────────────────────────────────────────────

const SE = dealsFeaturesOf(personaOf({ persona: { id: 'se' } }));
const AE = dealsFeaturesOf(personaOf({ persona: { id: 'ae' } }));
/** Every word a row puts on screen. */
const words = (rows: NeedRow[]) => rows.flatMap((r) => [r.title, r.why, r.badge ?? '', r.verb.label, r.verb.href]).join(' | ');
const book = [
  acct({ id: 'gap', name: 'ACME', dcStatus: 'none', hoursQtd: 10.5, nextCloseDate: '2027-06-01' }),
  acct({ id: 'part', name: 'Initech', dcStatus: 'partial', openOpps: 2, myDcs: [{ oppId: 'p1', oppName: 'Initech pilot', split: 100, role: null }] }),
  acct({ id: 'req', name: 'Globex', dcStatus: 'requested', nextCloseDate: '2026-11-15' }),
  acct({ id: 'late', name: 'Umbrella', nextCloseDate: '2026-11-01' }),
];
const bookOpps = [
  opp({ id: 'g1', accountId: 'gap', name: 'ACME expansion', hoursQtd: 10.5, closeDate: '2027-06-01' }),
  opp({ id: 'p1', accountId: 'part', name: 'Initech pilot', dcAssigned: true, myDc: { split: 100, role: null, org62DcId: 'a0X1', lastSeenAt: null } }),
  opp({ id: 'p2', accountId: 'part', name: 'Initech rollout', isMine: false, hoursQtd: 3 }),
  // a DC request on it went to Slackbot and isn't in Org62 yet (Chase)
  opp({ id: 'req1', accountId: 'req', name: 'Globex renewal', isMine: false, closeDate: '2026-11-15' }),
];

describe('deals: what needs you, per persona', () => {
  it('reads the SE as every Deals feature on (exactly the defaults) and the AE as none of them', () => {
    expect(SE).toEqual(ALL_DEALS_FEATURES);
    expect(AE).toEqual({ dc: false, vdp: false, missed: false });
    // still loading: everything gated stays hidden
    expect(dealsFeaturesOf(null)).toEqual({ dc: false, vdp: false, missed: false });
    // an AE who activates the sweep and deal contributions gets them
    expect(dealsFeaturesOf(personaOf({ persona: { id: 'ae', features: { missedOpps: true, dealContributions: true } } }))).toEqual({ dc: true, vdp: false, missed: true });
  });

  it('leaves the SE exactly as the defaults: the default options are the SE', () => {
    const before = needsOf(book, bookOpps);
    expect(needsOf(book, bookOpps, [], SE)).toEqual(before);
    expect(before.map((r) => r.id).sort()).toEqual(['ahead:late', 'ahead:req', 'chase:req', 'fix:gap', 'fix:part']);
    // a partial account's gap names the opp with my hours (not every opp), and its badge says DC partial
    expect(before.find((r) => r.id === 'fix:part')).toMatchObject({ badge: 'DC partial', why: '1 opp with your hours and no DC: Initech rollout · 3h QTD', opps: [{ oppId: 'p2', reasons: ['hours'], onTeam: false }] });
    expect(accountWords(acct({}))).toBe('DC assigned · VDP linked');
    expect(accountWords(acct({}), SE)).toBe('DC assigned · VDP linked');
    expect(needsEmptyLine()).toBe('Every account you work has your DC, and nothing closes in the next 45 days. Missed opportunities are swept after each Org62 scan.');
    expect(noAccountsLine(SE)).toBe('Accounts appear when Org62 shows you on an opportunity team or a DC. The next scan will pick them up.');
    expect(accountNeed(detail([opp({})]), [], TODAY, SE)).toEqual(accountNeed(detail([opp({})]), [], TODAY));
    // the account page claims the specific opp in place (never "Nothing to claim" in Missed), with Not needed
    expect(accountNeed(detail([opp({})]), [], TODAY)).toMatchObject({ label: 'Claim DC', href: '/deals/a1?claim=o1', claimOppId: 'o1', resolve: { rule: 'dc_gap', subjectIds: ['o1'] } });
  });

  it('gives an AE no DC rows, no Missed links and no DC or VDP words', () => {
    const rows = needsOf(book, bookOpps, [missed({})], AE);
    expect(rows.map((r) => r.id)).toEqual(['ahead:late', 'ahead:req']);
    expect(groupNeeds(rows).map((g) => g.title)).toEqual(['Think ahead']);
    const text = words(rows);
    expect(text).not.toMatch(/\bDC\b|VDP|Missed|\/deals\/missed/);
    expect(accountWords(acct({ dcStatus: 'none', vdpStatus: 'stale' }), AE)).toBe('');
    expect(needsEmptyLine(AE)).not.toMatch(/\bDC\b|VDP|Missed/);
    expect(noAccountsLine(AE)).not.toMatch(/\bDC\b/);
  });

  it('gives an AE an account need only for a close coming up, never a DC or a missed opp', () => {
    expect(accountNeed(detail([opp({ closeDate: '2027-06-01' })], [missed({})], AE), [missed({ id: 'm2' })], TODAY, AE)).toBeNull();
    const soon = accountNeed(detail([opp({})], [missed({})], AE), [missed({})], TODAY, AE);
    expect(soon).toMatchObject({ label: 'Open the opp', href: 'https://org62.example.com/o1', resolve: { rule: 'deals_ahead', snooze: true } });
    expect(soon!.why).toMatch(/^ACME expansion closes /);
  });

  it('keeps DC rows but never counts the sweep when only the sweep is off', () => {
    const f: DealsFeatures = { dc: true, vdp: true, missed: false };
    const onTeam = needsOf([acct({ id: 'gap', dcStatus: 'none', hoursQtd: 10.5 })], [opp({ id: 'g1', accountId: 'gap', hoursQtd: 10.5 })], [missed({})], f);
    expect(onTeam.filter((r) => r.section === 'fix')).toHaveLength(1);
    expect(words(onTeam)).not.toMatch(/Missed|\/deals\/missed|sweep/);
    // an opp only the sweep's Claim finding points at: a gap with the sweep, nothing without it
    const sweepOnly = [opp({ id: 'x1', accountId: 'a1', isMine: false })];
    expect(needsOf([acct({})], sweepOnly, [missed({ oppId: 'x1' })]).find((r) => r.section === 'fix')?.opps[0]).toMatchObject({ oppId: 'x1', reasons: ['sweep'], evidence: ['Slack strong'] });
    expect(needsOf([acct({})], sweepOnly, [missed({ oppId: 'x1' })], f).filter((r) => r.section === 'fix')).toEqual([]);
    expect(accountNeed(detail([opp({ closeDate: '2027-06-01' })], [], f), [missed({})], TODAY, f)).toMatchObject({ label: 'Claim DC', why: "1 opp you're on with no DC: ACME expansion", href: '/deals/a1?claim=o1', claimOppId: 'o1' });
    expect(needsEmptyLine(f)).toBe('Every account you work has your DC, and nothing closes in the next 45 days.');
  });

  it('drops only the VDP words when VDP is off', () => {
    expect(accountWords(acct({ dcStatus: 'requested' }), { dc: true, vdp: false, missed: true })).toBe('DC requested');
    expect(accountWords(acct({ openOpps: 0 }), SE)).toBe('');
  });

  it("the claim form's evidence line: hours, the team, the sweep (strong evidence only)", () => {
    const d = detail([opp({ id: 'h1', isMine: false, hoursQtd: 2.5 })]);
    expect(claimEvidenceOf(d, d.opps[0]!)).toBe('You logged 2.5h on it this quarter · Not on the opp team');
    expect(claimEvidenceOf(detail([]), opp({ hoursQtd: 0 }))).toBe("You're on the opp team");
  });
});
