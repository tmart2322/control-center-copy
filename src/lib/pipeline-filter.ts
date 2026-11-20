/**
 * The Deals pipeline filters (pure): which deals a summary number or a chart segment counts, shared by the server
 * (src/server/deals/pipeline.ts sums with them) and the Deals list the number links to, so a tile's count is always
 * the length of the list it opens (tenet: Trustworthy).
 *
 *   open        open deals in the pipeline (omitted ones left out)
 *   soon        open deals closing in the next CLOSING_SOON_DAYS days (today included)
 *   attention   open deals whose close date passed, or closing this quarter with no next step
 *   quarter     one fiscal quarter's deals, optionally one segment (`cat`): won ones, or open ones in that category
 *
 * The URL form (`/deals?pipe=…`) round-trips through pipeFilterOf / pipeHref.
 */
import type { PipelineCategory, PipelineRow, PipeSum } from '@/contract';
import { PipelineCategory as PipelineCategorySchema } from '@/contract';

export const CLOSING_SOON_DAYS = 30;

export type PipeFilter = { scope: 'open' } | { scope: 'soon' } | { scope: 'attention' } | { scope: 'quarter'; quarter: string; cat: PipelineCategory | null };

type Row = Pick<PipelineRow, 'isOpen' | 'isWon' | 'category' | 'closeDate' | 'quarter' | 'attention' | 'amount'>;

/** Open and counted in the pipeline (an omitted deal is open but out of the forecast). */
export const inPipe = (r: Pick<PipelineRow, 'isOpen' | 'category'>): boolean => r.isOpen && r.category !== 'omitted';

/** YYYY-MM-DD + n days. */
export function plusDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function matchesPipe(r: Row, f: PipeFilter, today: string): boolean {
  switch (f.scope) {
    case 'open':
      return inPipe(r);
    case 'soon':
      return inPipe(r) && !!r.closeDate && r.closeDate >= today && r.closeDate <= plusDays(today, CLOSING_SOON_DAYS);
    case 'attention':
      return inPipe(r) && r.attention.length > 0;
    case 'quarter':
      if (r.quarter !== f.quarter) return false;
      if (f.cat === 'won') return r.isWon;
      if (f.cat) return inPipe(r) && r.category === f.cat;
      return r.isWon || inPipe(r);
  }
}

export function pipeRows<R extends Row>(rows: readonly R[], f: PipeFilter, today: string): R[] {
  return rows.filter((r) => matchesPipe(r, f, today));
}

/** The sum (amounts at 100%; a deal with no amount counts, adding nothing) and the count. */
export function sumOf(rows: ReadonlyArray<Pick<PipelineRow, 'amount'>>): PipeSum {
  return { amount: Math.round(rows.reduce((s, r) => s + (r.amount ?? 0), 0) * 100) / 100, count: rows.length };
}

interface Params {
  get(name: string): string | null;
}

/** What a `/deals?pipe=…` URL asks the list to show; null = no filter (the accounts list). */
export function pipeFilterOf(sp: Params | null | undefined): PipeFilter | null {
  const v = sp?.get('pipe')?.trim();
  if (!v) return null;
  if (v === 'open' || v === 'soon' || v === 'attention') return { scope: v };
  if (v === 'quarter') {
    const quarter = sp?.get('q')?.trim();
    if (!quarter) return null;
    const c = PipelineCategorySchema.safeParse(sp?.get('cat')?.trim());
    return { scope: 'quarter', quarter, cat: c.success ? c.data : null };
  }
  return null;
}

/** The Deals URL that shows a filter (`/deals` itself for none). */
export function pipeHref(f: PipeFilter | null): string {
  if (!f) return '/deals';
  if (f.scope !== 'quarter') return `/deals?pipe=${f.scope}`;
  return `/deals?pipe=quarter&q=${encodeURIComponent(f.quarter)}${f.cat ? `&cat=${f.cat}` : ''}`;
}

export function samePipe(a: PipeFilter | null, b: PipeFilter | null): boolean {
  return pipeHref(a) === pipeHref(b);
}
