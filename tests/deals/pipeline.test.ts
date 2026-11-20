/**
 * Deals summary and pipeline by fiscal quarter (src/server/deals/pipeline.ts, src/lib/pipeline-filter.ts), the pure
 * parts: quarter bucketing on the fiscal boundaries (FY starts 1 February, in the profile timezone), forecast-category
 * and stage grouping, whose deals count (SE: team or DC; AE: the Specialist Forecasts I own), closed / won handling,
 * the amount field, the attention rules, and every summary number equal to the list it links to. Placeholders only.
 */
import { describe, expect, it } from 'vitest';

import { EMPTY_FORECAST_PENDING, type DealsPipeline, type Opportunity, type SpecialistForecast } from '../../src/contract';
import { matchesPipe, pipeFilterOf, pipeHref, pipeRows, sumOf, type PipeFilter } from '../../src/lib/pipeline-filter';
import { personaOf } from '../../src/personas';
import { buildDealsPipeline, forecastCategoryOf, pipelineBasisOf, pipelineQuarters, quarterLabelOf, stageGroupOf, type PipelineInput } from '../../src/server/deals/pipeline';

const TZ = 'America/Denver';
/** Wed 2026-11-11 09:00 Denver: Q4 FY27 (1 Nov 2026 – 31 Jan 2027). */
const NOW = new Date('2026-11-11T16:00:00Z');
const ACCOUNTS = [
  { id: 'acc_1', name: 'Placeholder Co' },
  { id: 'acc_2', name: 'Example Corp' },
];

function opp(id: string, x: Partial<Opportunity> = {}): Opportunity {
  return {
    id,
    accountId: 'acc_1',
    name: `Opp ${id}`,
    stage: 'Discovery',
    amount: 100_000,
    closeDate: '2026-12-15',
    isOpen: true,
    isMine: true,
    dcAssigned: false,
    vdpLinked: false,
    hoursQtd: 0,
    nextStep: 'A next step',
    nextStepRead: true,
    products: [],
    owner: null,
    org62Url: null,
    myDc: null,
    forecastCategory: 'Pipeline',
    isWon: false,
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...x,
  };
}

let n = 0;
function sfr(x: Partial<SpecialistForecast> = {}): SpecialistForecast {
  n += 1;
  return {
    id: `00000000-0000-4000-c000-${String(n).padStart(12, '0')}`,
    org62Id: `placeholder-sfr-${String(n).padStart(2, '0')}`,
    name: `SF-${n}`,
    url: null,
    org62OpportunityId: null,
    opportunityId: `opp_${n}`,
    accountId: 'acc_2',
    opportunityName: `Placeholder deal ${n}`,
    accountName: 'Example Corp',
    oppStage: null,
    oppNextStep: 'Order form',
    oppCloseDate: null,
    notes: null,
    prevNotes: null,
    mgrNotes: null,
    dealRole: 'Lead',
    judgement: 'IN',
    forecastStatus: 'Pipeline',
    amount: 200_000,
    stage: '03 - Validating Benefits & Value',
    closeDate: '2026-12-20',
    fiscalQuarter: 'FY27 Q4',
    ownerOrg62Id: null,
    lastModifiedAt: null,
    notesUpdatedAt: null,
    syncedAt: '2026-11-11T14:00:00.000Z',
    goneAt: null,
    pending: EMPTY_FORECAST_PENDING,
    ...x,
  };
}

const build = (x: Partial<PipelineInput>): DealsPipeline => buildDealsPipeline({ now: NOW, timezone: TZ, basis: 'team_or_dc', opps: [], accounts: ACCOUNTS, ...x });
const seg = (p: DealsPipeline, quarter: string, key: string) => p.quarters.find((q) => q.label === quarter)!.segments.find((s) => s.key === key)!;
const ids = (p: DealsPipeline, f: PipeFilter) => pipeRows(p.rows, f, p.today).map((r) => r.id);

describe('fiscal quarters (FY starts 1 February)', () => {
  it('the chart shows the previous quarter, this one and the next 3, with their bounds', () => {
    expect(pipelineQuarters('2026-11-11')).toEqual([
      { label: 'Q3 FY27', start: '2026-08-01', end: '2026-10-31', role: 'previous' },
      { label: 'Q4 FY27', start: '2026-11-01', end: '2027-01-31', role: 'current' },
      { label: 'Q1 FY28', start: '2027-02-01', end: '2027-04-30', role: 'next' },
      { label: 'Q2 FY28', start: '2027-05-01', end: '2027-07-31', role: 'next' },
      { label: 'Q3 FY28', start: '2027-08-01', end: '2027-10-31', role: 'next' },
    ]);
    // on the boundary days
    expect(pipelineQuarters('2027-01-31')[1]!.label).toBe('Q4 FY27');
    expect(pipelineQuarters('2027-02-01').map((q) => q.label)).toEqual(['Q4 FY27', 'Q1 FY28', 'Q2 FY28', 'Q3 FY28', 'Q4 FY28']);
  });

  it('a deal lands in the quarter of its close date, on either side of each boundary', () => {
    const p = build({
      opps: [
        opp('o_oct31', { closeDate: '2026-10-31', isOpen: false, isWon: true }),
        opp('o_nov01', { closeDate: '2026-11-01' }),
        opp('o_jan31', { closeDate: '2027-01-31' }),
        opp('o_feb01', { closeDate: '2027-02-01' }),
      ],
    });
    expect(Object.fromEntries(p.rows.map((r) => [r.id, r.quarter]))).toEqual({ o_oct31: 'Q3 FY27', o_nov01: 'Q4 FY27', o_jan31: 'Q4 FY27', o_feb01: 'Q1 FY28' });
    expect(seg(p, 'Q4 FY27', 'pipeline')).toMatchObject({ amount: 200_000, count: 2 });
    expect(seg(p, 'Q1 FY28', 'pipeline')).toMatchObject({ amount: 100_000, count: 1 });
    expect(seg(p, 'Q3 FY27', 'won')).toMatchObject({ amount: 100_000, count: 1 });
  });

  it('today is the profile timezone’s day: 1 Nov 05:00 UTC is still 31 Oct in Denver (Q3)', () => {
    const p = buildDealsPipeline({ now: new Date('2026-11-01T05:00:00Z'), timezone: TZ, basis: 'team_or_dc', opps: [], accounts: [] });
    expect(p.today).toBe('2026-10-31');
    expect(p.currentQuarter).toBe('Q3 FY27');
    expect(buildDealsPipeline({ now: new Date('2026-11-01T05:00:00Z'), timezone: 'UTC', basis: 'team_or_dc', opps: [], accounts: [] }).currentQuarter).toBe('Q4 FY27');
  });

  it('a Specialist Forecast’s FiscalQuarter__c wins over its close date', () => {
    expect(quarterLabelOf('FY27 Q4')).toBe('Q4 FY27');
    expect(quarterLabelOf('Q1 FY28')).toBe('Q1 FY28');
    expect(quarterLabelOf('next quarter')).toBeNull();
    const p = build({ basis: 'specialist_forecast', forecasts: [sfr({ fiscalQuarter: 'FY28 Q1', closeDate: '2027-01-20' }), sfr({ fiscalQuarter: null, closeDate: '2027-01-20' })] });
    expect(p.rows.map((r) => r.quarter).sort()).toEqual(['Q1 FY28', 'Q4 FY27']);
  });
});

describe('segments: forecast category, else stage groups', () => {
  it('reads ForecastCategoryName and ForecastStatus__c spellings', () => {
    expect(['Commit', 'Best Case', 'best case', 'Pipeline', 'Omitted', 'Closed Won', 'Closed Lost', 'Closed', null, 'Upside'].map(forecastCategoryOf)).toEqual(['commit', 'best_case', 'best_case', 'pipeline', 'omitted', 'won', 'lost', 'closed', null, null]);
  });

  it('groups open opps by forecast category; one without a category counts as Pipeline and says so', () => {
    const p = build({ opps: [opp('c', { forecastCategory: 'Commit', amount: 500_000 }), opp('b', { forecastCategory: 'Best Case', amount: 300_000 }), opp('p', { forecastCategory: 'Pipeline' }), opp('x', { forecastCategory: null, amount: 50_000 })] });
    expect(p.categoryBasis).toBe('forecast');
    expect(p.segments.map((s) => [s.key, s.label, s.tier])).toEqual([
      ['won', 'Won', 0],
      ['commit', 'Commit', 1],
      ['best_case', 'Best case', 2],
      ['pipeline', 'Pipeline', 3],
    ]);
    expect(p.summary.thisQuarter.segments).toEqual([
      { key: 'commit', amount: 500_000, count: 1 },
      { key: 'best_case', amount: 300_000, count: 1 },
      { key: 'pipeline', amount: 150_000, count: 2 },
    ]);
    expect(p.rows.find((r) => r.id === 'x')).toMatchObject({ category: 'pipeline', categoryFrom: 'default' });
    expect(p.notes).toContain('1 open opp carries no forecast category: counted as Pipeline.');
  });

  it('with no forecast category on any opp, groups by stage (numbered Org62 stages by number, plain names by words)', () => {
    expect(['01 - Identifying an Opportunity', '02 - Determining Problem, Impact, Ideal', '03 - Validating Benefits & Value', '04 - Confirming Value With Power', '05 - Negotiating $$ & Mutual Plan', '06 - Finalizing Closure'].map(stageGroupOf)).toEqual(['early', 'early', 'mid', 'mid', 'late', 'late']);
    expect(['Prospecting', 'Discovery', 'Qualification', 'Solution Design', 'Technical Validation', 'Proposal', 'Negotiation', null].map(stageGroupOf)).toEqual(['early', 'early', 'early', 'mid', 'mid', 'mid', 'late', 'early']);
    const p = build({ opps: [opp('n', { forecastCategory: null, stage: 'Negotiation' }), opp('d', { forecastCategory: null, stage: 'Discovery' })] });
    expect(p.categoryBasis).toBe('stage');
    expect(p.segments.map((s) => s.key)).toEqual(['won', 'late', 'mid', 'early']);
    // same close date and amount: the id breaks the tie
    expect(p.rows.map((r) => [r.id, r.category, r.categoryFrom])).toEqual([
      ['d', 'early', 'stage'],
      ['n', 'late', 'stage'],
    ]);
    expect(p.notes).toContain('No forecast category was read on your opps, so they are grouped by stage.');
  });

  it('an omitted opp is open but out of the pipeline, and is noted', () => {
    const p = build({ opps: [opp('om', { forecastCategory: 'Omitted' }), opp('p')] });
    expect(p.summary.open).toEqual({ amount: 100_000, count: 1 });
    expect(p.quarters[1]!.total).toEqual({ amount: 100_000, count: 1 });
    expect(p.notes).toContain('1 omitted opp is left out of the pipeline.');
  });
});

describe('whose deals', () => {
  it('the AE counts Specialist Forecasts; everyone else (and an AE without the feature) counts opps', () => {
    expect(pipelineBasisOf(personaOf({}))).toBe('team_or_dc');
    expect(pipelineBasisOf(personaOf({ persona: { version: 1, id: 'ae', level: null, rules: {}, customRules: [], thresholds: {}, features: {}, connectors: {} } }))).toBe('specialist_forecast');
    expect(pipelineBasisOf(personaOf({ persona: { version: 1, id: 'ae', level: null, rules: {}, customRules: [], thresholds: {}, features: { specialistForecast: false }, connectors: {} } }))).toBe('team_or_dc');
  });

  it('SE: on the opp team or holding my DC; hours or an account match alone do not make an opp mine', () => {
    const p = build({
      opps: [
        opp('team', { isMine: true }),
        opp('dc', { isMine: false, dcAssigned: true, myDc: { split: 50, role: 'AI + Data Architect', org62DcId: 'placeholder-dc-1', lastSeenAt: null } }),
        opp('both', { isMine: true, dcAssigned: true }),
        opp('hours', { isMine: false, dcAssigned: false, hoursQtd: 6 }),
        opp('other', { isMine: false, dcAssigned: false }),
      ],
    });
    expect(Object.fromEntries(p.rows.map((r) => [r.id, r.via]))).toEqual({ team: 'team', dc: 'dc', both: 'team_dc' });
    expect(p.rows.find((r) => r.id === 'dc')!.dcSplit).toBe(50);
    expect(p.rows.find((r) => r.id === 'team')!.accountName).toBe('Placeholder Co');
  });

  it('AE: the Specialist Forecasts I own, never the opps; a record gone from the read counts only for a past quarter', () => {
    const p = build({
      basis: 'specialist_forecast',
      opps: [opp('core', { amount: 9_000_000 })],
      forecasts: [
        sfr({ forecastStatus: 'Commit', amount: 400_000 }),
        // Flex splits 50/50 into two records: each is my half
        sfr({ name: 'SF-2 (Flex 50%)', amount: 75_000, forecastStatus: 'Best Case' }),
        sfr({ forecastStatus: 'Closed Lost', amount: 999 }),
        sfr({ goneAt: '2026-11-10T00:00:00.000Z', amount: 777 }),
        sfr({ goneAt: '2026-11-02T00:00:00.000Z', forecastStatus: 'Closed Won', fiscalQuarter: 'FY27 Q3', closeDate: '2026-10-20', amount: 120_000 }),
      ],
    });
    expect(p.basis).toBe('specialist_forecast');
    expect(p.rows.every((r) => r.via === 'forecast' && r.forecastId === r.id)).toBe(true);
    expect(p.summary.open).toEqual({ amount: 475_000, count: 2 });
    expect(seg(p, 'Q4 FY27', 'commit').amount).toBe(400_000);
    expect(seg(p, 'Q3 FY27', 'won')).toMatchObject({ amount: 120_000, count: 1 });
    expect(p.notes[0]).toMatch(/read for this quarter and next/);
  });
});

describe('closed and won', () => {
  it('won this quarter, won last quarter on the previous bar, older wins and lost deals left out', () => {
    const p = build({
      opps: [
        opp('won_now', { isOpen: false, isWon: true, closeDate: '2026-11-05', amount: 250_000, forecastCategory: 'Closed' }),
        opp('won_prev', { isOpen: false, isWon: true, closeDate: '2026-09-15', amount: 80_000 }),
        opp('won_old', { isOpen: false, isWon: true, closeDate: '2026-03-01' }),
        opp('won_stage', { isOpen: false, isWon: false, stage: 'Closed Won', closeDate: '2026-11-03', amount: 20_000 }),
        opp('lost', { isOpen: false, isWon: false, stage: 'Closed Lost', closeDate: '2026-11-04' }),
        opp('open_prev', { closeDate: '2026-10-15' }),
      ],
    });
    expect(p.rows.map((r) => r.id).sort()).toEqual(['open_prev', 'won_now', 'won_prev', 'won_stage']);
    expect(p.summary.wonThisQuarter).toEqual({ amount: 270_000, count: 2 });
    expect(seg(p, 'Q4 FY27', 'won')).toMatchObject({ amount: 270_000, count: 2 });
    // the previous quarter shows its wins only: an open deal dated there is past close, not charted
    expect(p.quarters[0]!.segments.filter((s) => s.amount > 0)).toEqual([{ key: 'won', amount: 80_000, count: 1 }]);
    expect(p.rows.find((r) => r.id === 'open_prev')!.attention).toEqual(['past_close']);
    expect(p.notes).toContain('1 open opp is dated before Q4 FY27 (close date passed): in Needs attention, not on the chart.');
    // won deals are never open pipeline
    expect(ids(p, { scope: 'open' })).toEqual(['open_prev']);
  });
});

describe('amount field', () => {
  it('SE sums Opportunity.Amount at 100%; AE sums ForecastAmount__c (ACV); a missing amount counts, adding $0', () => {
    const se = build({ opps: [opp('a', { amount: 1_234_567.891 }), opp('b', { amount: null })] });
    expect(se.amountField).toEqual({ field: 'Opportunity.Amount', label: 'Opp amount' });
    expect(se.summary.open).toEqual({ amount: 1_234_567.89, count: 2 });
    expect(se.notes).toContain('1 open opp has no amount read yet: counted, adding $0.');
    const ae = build({ basis: 'specialist_forecast', forecasts: [sfr({ amount: 60_000 })] });
    expect(ae.amountField).toEqual({ field: 'SpecialistForecast__c.ForecastAmount__c', label: 'Forecast amount (ACV)' });
    expect(ae.summary.open.amount).toBe(60_000);
  });
});

describe('needs attention and closing soon', () => {
  it('past close while open; no next step only on a deal closing this quarter, and only when next steps are read', () => {
    const p = build({
      opps: [
        opp('past', { closeDate: '2026-11-09' }),
        opp('nostep_q', { nextStep: null, closeDate: '2026-12-01' }),
        opp('nostep_later', { nextStep: '  ', closeDate: '2027-03-01' }),
        opp('fine', { closeDate: '2026-11-20' }),
      ],
    });
    expect(p.nextStepRead).toBe(true);
    expect(Object.fromEntries(p.rows.map((r) => [r.id, r.attention]))).toEqual({ past: ['past_close'], nostep_q: ['no_next_step'], nostep_later: [], fine: [] });
    expect(p.summary.attention).toEqual({ amount: 200_000, count: 2, pastClose: 1, noNextStep: 1 });
    const none = build({ opps: [opp('a', { nextStep: null }), opp('b', { nextStep: null })] });
    expect(none.nextStepRead).toBe(false);
    expect(none.summary.attention.count).toBe(0);
  });

  it('an opp no read with NextStep has seen (only the daily book read, or a DC row) is not flagged for a missing one', () => {
    const p = build({ opps: [opp('read', { nextStep: 'Order form' }), opp('book_only', { nextStep: null, nextStepRead: false, closeDate: '2026-12-01' }), opp('none', { nextStep: null, closeDate: '2026-12-02' })] });
    expect(Object.fromEntries(p.rows.map((r) => [r.id, r.attention]))).toEqual({ read: [], book_only: [], none: ['no_next_step'] });
    expect(p.notes).toContain('1 opp this quarter has no next step read yet: not flagged for one.');
  });

  it('closing soon: open deals closing today through 30 days out', () => {
    const p = build({ opps: [opp('today', { closeDate: '2026-11-11' }), opp('d30', { closeDate: '2026-12-11' }), opp('d31', { closeDate: '2026-12-12' }), opp('past', { closeDate: '2026-11-10' }), opp('none', { closeDate: null })] });
    expect(ids(p, { scope: 'soon' }).sort()).toEqual(['d30', 'today']);
    expect(p.summary.closingSoon).toEqual({ amount: 200_000, count: 2, days: 30 });
    expect(p.notes).toContain('1 open opp has no close date, so no quarter: counted in open pipeline only.');
  });
});

describe('every number is the length of the list it links to', () => {
  it('summary and chart segments equal their filters over the rows', () => {
    const p = build({
      opps: [
        opp('c', { forecastCategory: 'Commit', closeDate: '2026-11-30', amount: 500_000 }),
        opp('b', { forecastCategory: 'Best Case', closeDate: '2027-02-10', nextStep: null }),
        opp('w', { isOpen: false, isWon: true, closeDate: '2026-11-02' }),
        opp('p', { closeDate: '2026-11-08' }),
      ],
    });
    const T = p.today;
    expect(p.summary.open).toEqual(sumOf(pipeRows(p.rows, { scope: 'open' }, T)));
    expect(p.summary.closingSoon.count).toBe(pipeRows(p.rows, { scope: 'soon' }, T).length);
    expect(p.summary.attention.count).toBe(pipeRows(p.rows, { scope: 'attention' }, T).length);
    expect(p.summary.wonThisQuarter).toEqual(sumOf(pipeRows(p.rows, { scope: 'quarter', quarter: p.currentQuarter, cat: 'won' }, T)));
    for (const q of p.quarters.filter((x) => x.role !== 'previous'))
      for (const s of q.segments) expect([q.label, s.key, s.amount, s.count]).toEqual([q.label, s.key, ...Object.values(sumOf(pipeRows(p.rows, { scope: 'quarter', quarter: q.label, cat: s.key }, T)))]);
    expect(matchesPipe(p.rows.find((r) => r.id === 'w')!, { scope: 'quarter', quarter: 'Q4 FY27', cat: null }, T)).toBe(true);
  });

  it('the filter round-trips through the Deals URL', () => {
    const fs: PipeFilter[] = [{ scope: 'open' }, { scope: 'soon' }, { scope: 'attention' }, { scope: 'quarter', quarter: 'Q4 FY27', cat: 'best_case' }, { scope: 'quarter', quarter: 'Q1 FY28', cat: null }];
    for (const f of fs) expect(pipeFilterOf(new URL(pipeHref(f), 'http://x').searchParams)).toEqual(f);
    expect(pipeHref({ scope: 'quarter', quarter: 'Q4 FY27', cat: 'won' })).toBe('/deals?pipe=quarter&q=Q4%20FY27&cat=won');
    expect(pipeFilterOf(new URLSearchParams('pipe=quarter'))).toBeNull();
    expect(pipeFilterOf(new URLSearchParams('pipe=quarter&q=Q4%20FY27&cat=bogus'))).toEqual({ scope: 'quarter', quarter: 'Q4 FY27', cat: null });
    expect(pipeFilterOf(new URLSearchParams('opp=o1'))).toBeNull();
  });
});
