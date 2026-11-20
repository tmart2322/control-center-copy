/**
 * The Deals summary's and chart's words and shapes (pipeline-words.ts): full amounts for the tooltip, the list title
 * per filter, whose deals and which amount, a row's line and where it opens, and the chart's data (the topmost
 * segment carries the rounded end). Placeholders only.
 */
import { describe, expect, it } from 'vitest';
import type { DealsPipeline, PipelineRow } from '@/contract';
import { buildDealsPipeline } from '@/server/deals/pipeline';
import { categoryWords, chartData, chartLabel, dealNoun, fmtAmountFull, niceMax, pipeFilterTitle, pipeRowHref, pipeRowWhy, scopeLine } from './pipeline-words';

const p: DealsPipeline = buildDealsPipeline({
  now: new Date('2026-11-11T16:00:00Z'),
  timezone: 'America/Denver',
  basis: 'team_or_dc',
  accounts: [{ id: 'acc_1', name: 'Placeholder Co' }],
  opps: [
    { id: 'o1', accountId: 'acc_1', name: 'Placeholder · Expansion', stage: '05 - Negotiating $$ & Mutual Plan', amount: 1_200_000, closeDate: '2026-12-01', isOpen: true, isMine: true, dcAssigned: false, vdpLinked: false, hoursQtd: 0, nextStep: 'Pricing call', nextStepRead: true, products: [], owner: null, org62Url: null, myDc: null, forecastCategory: 'Commit', isWon: false, updatedAt: '2026-11-01T00:00:00.000Z' },
    { id: 'o2', accountId: 'acc_1', name: 'Placeholder · Pilot', stage: 'Discovery', amount: 90_000, closeDate: '2027-02-15', isOpen: true, isMine: true, dcAssigned: false, vdpLinked: false, hoursQtd: 0, nextStep: null, nextStepRead: true, products: [], owner: null, org62Url: null, myDc: null, forecastCategory: null, isWon: false, updatedAt: '2026-11-01T00:00:00.000Z' },
  ],
});
const row = (id: string) => p.rows.find((r) => r.id === id)! as PipelineRow;

describe('pipeline words', () => {
  it('full amounts for the tooltip; deals counted as opps (SE) or deals (AE)', () => {
    expect(fmtAmountFull(1_234_567.8)).toBe('$1,234,568');
    expect(fmtAmountFull(null)).toBe('—');
    expect(dealNoun(p, 1)).toBe('1 opp');
    expect(dealNoun({ basis: 'specialist_forecast' }, 3)).toBe('3 deals');
  });

  it('names each filter and says whose deals and which amount', () => {
    expect(pipeFilterTitle({ scope: 'open' }, p)).toBe('Open pipeline');
    expect(pipeFilterTitle({ scope: 'soon' }, p)).toBe('Closing in 30 days');
    expect(pipeFilterTitle({ scope: 'attention' }, p)).toBe('Needs attention');
    expect(pipeFilterTitle({ scope: 'quarter', quarter: 'Q4 FY27', cat: 'best_case' }, p)).toBe('Q4 FY27 · Best case');
    expect(pipeFilterTitle({ scope: 'quarter', quarter: 'Q1 FY28', cat: null }, p)).toBe('Q1 FY28');
    expect(scopeLine(p)).toBe('Your opps (on the team or holding your DC), counted at 100% of the opp amount');
    expect(scopeLine({ basis: 'specialist_forecast', amountField: { field: 'SpecialistForecast__c.ForecastAmount__c', label: 'Forecast amount (ACV)' } })).toBe('Your Specialist Forecasts, at their forecast amount (ACV)');
  });

  it('a row reads account · stage · category · next step, and opens its account page with the opp open', () => {
    expect(pipeRowWhy(row('o1'), p)).toBe('Placeholder Co · Negotiating $$ & Mutual Plan · Commit · Next: Pricing call');
    expect(categoryWords(row('o2'), p)).toBe('Pipeline (no forecast category)');
    expect(pipeRowHref(row('o1'))).toBe('/deals/acc_1?opp=o1');
    expect(pipeRowHref({ accountId: null, oppId: 'o9' })).toBeNull();
  });

  it('chart data: one datum per quarter, segment amounts under their keys, the topmost segment with an amount', () => {
    const d = chartData(p);
    expect(d.map((x) => x.label)).toEqual(['Q3 FY27', 'Q4 FY27', 'Q1 FY28', 'Q2 FY28', 'Q3 FY28']);
    expect(d[1]).toMatchObject({ role: 'current', total: 1_200_000, count: 1, top: 'commit', commit: 1_200_000, pipeline: 0 });
    expect(d[2]).toMatchObject({ top: 'pipeline', pipeline: 90_000 });
    expect(d[0]!.top).toBeNull();
    expect(chartLabel(p)).toContain('Q4 FY27: $1.2M, 1 opp');
  });

  it('the axis tops out at a round amount just above the tallest bar', () => {
    expect([3_607_200, 1_296_000, 90_000, 1_000_000, 0].map(niceMax)).toEqual([4_000_000, 1_500_000, 100_000, 1_000_000, 1]);
  });
});
