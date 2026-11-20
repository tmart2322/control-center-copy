/**
 * Words and shapes for the Deals summary, the pipeline chart and the deal list they filter (pure, tested in
 * ./pipeline-words.test.ts). The numbers themselves come from the payload (src/server/deals/pipeline.ts); the list
 * is the same filter over the same rows (src/lib/pipeline-filter.ts).
 */
import type { DealsPipeline, PipelineCategory, PipelineRow } from '@/contract';
import type { PipeFilter } from '@/lib/pipeline-filter';
import { fmtAmount } from './format';

/** 1234567.8 → "$1,234,568" (the tooltip's full value; the axis and tiles use fmtAmount's "$1.23M"). */
export function fmtAmountFull(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

/** "opp" for an SE's opps, "deal" for an AE's Specialist Forecasts. */
export function dealNoun(p: Pick<DealsPipeline, 'basis'>, n: number): string {
  const one = p.basis === 'specialist_forecast' ? 'deal' : 'opp';
  return `${n} ${n === 1 ? one : `${one}s`}`;
}

export function segmentLabel(p: Pick<DealsPipeline, 'segments'>, key: PipelineCategory): string {
  return p.segments.find((s) => s.key === key)?.label ?? (key === 'omitted' ? 'Omitted' : key);
}

/** The list's title for a filter ("Open pipeline", "Q4 FY27 · Best case"). */
export function pipeFilterTitle(f: PipeFilter, p: Pick<DealsPipeline, 'segments'>): string {
  switch (f.scope) {
    case 'open':
      return 'Open pipeline';
    case 'soon':
      return 'Closing in 30 days';
    case 'attention':
      return 'Needs attention';
    case 'quarter':
      return f.cat ? `${f.quarter} · ${segmentLabel(p, f.cat)}` : f.quarter;
  }
}

/** Whose deals and which amount, in a line (under the chart; tenet: Legible). */
export function scopeLine(p: Pick<DealsPipeline, 'basis' | 'amountField'>): string {
  return p.basis === 'specialist_forecast' ? `Your Specialist Forecasts, at their ${p.amountField.label.replace(/^F/, 'f')}` : 'Your opps (on the team or holding your DC), counted at 100% of the opp amount';
}

const stageShort = (s: string | null) => (s ? s.replace(/^\d+\s*-\s*/, '') : null);

/** "Pipeline (no forecast category)", "Late stage (by stage)", "Won". */
export function categoryWords(r: Pick<PipelineRow, 'isWon' | 'category' | 'categoryFrom'>, p: Pick<DealsPipeline, 'segments'>): string {
  if (r.isWon) return 'Won';
  if (r.categoryFrom === 'default') return 'Pipeline (no forecast category)';
  return segmentLabel(p, r.category);
}

/** The list row's muted line: account · stage · category · next step. */
export function pipeRowWhy(r: PipelineRow, p: Pick<DealsPipeline, 'segments'>): string {
  return [r.accountName, stageShort(r.stage), categoryWords(r, p), r.nextStep ? `Next: ${r.nextStep}` : null].filter(Boolean).join(' · ');
}

/** Where a deal row opens: its account page with the opp open (an opp loads with its account). */
export function pipeRowHref(r: Pick<PipelineRow, 'accountId' | 'oppId'>): string | null {
  return r.accountId && r.oppId ? `/deals/${encodeURIComponent(r.accountId)}?opp=${encodeURIComponent(r.oppId)}` : null;
}

export interface ChartDatum {
  label: string;
  role: DealsPipeline['quarters'][number]['role'];
  total: number;
  count: number;
  /** The topmost segment with an amount (it carries the rounded end). */
  top: PipelineCategory | null;
  amounts: Partial<Record<PipelineCategory, number>>;
  counts: Partial<Record<PipelineCategory, number>>;
  [key: string]: unknown;
}

/** One datum per quarter, each segment's amount under its key (recharts stacks by dataKey). */
export function chartData(p: Pick<DealsPipeline, 'quarters' | 'segments'>): ChartDatum[] {
  return p.quarters.map((q) => {
    const amounts: Partial<Record<PipelineCategory, number>> = {};
    const counts: Partial<Record<PipelineCategory, number>> = {};
    for (const s of q.segments) {
      amounts[s.key] = s.amount;
      counts[s.key] = s.count;
    }
    const top = [...p.segments].reverse().find((s) => (amounts[s.key] ?? 0) > 0)?.key ?? null;
    return { label: q.label, role: q.role, total: q.total.amount, count: q.total.count, top, amounts, counts, ...amounts };
  });
}

/** A round axis top a little above `v`: 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10ⁿ. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * p >= v)!;
  return step * p;
}

/** The chart's accessible name: what each bar holds, in words. */
export function chartLabel(p: Pick<DealsPipeline, 'quarters' | 'basis'>): string {
  return `Pipeline by fiscal quarter. ${p.quarters.map((q) => `${q.label}${q.role === 'previous' ? ' (won)' : ''}: ${fmtAmount(q.total.amount)}, ${dealNoun(p, q.total.count)}`).join('; ')}.`;
}
