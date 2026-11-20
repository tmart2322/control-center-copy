/**
 * The Deals summary and pipeline by fiscal quarter (pure): one function both DataSources call with what they already
 * read (the mirrored opps, my DCs on them, an AE's mirrored Specialist Forecasts), so the mock and Postgres answer the
 * same. No Org62 call: only mirrored fields are used.
 *
 * Whose deals (`basis`):
 *   team_or_dc            the SE (and any persona without the Specialist Forecast): opps I'm on the team of, or hold
 *                         a DC on. Amount = Opportunity.Amount at 100% (no ACV field is mirrored on the opp).
 *   specialist_forecast   the Specialist AE: the Specialist Forecasts I own (`specialist_forecasts`, this and next
 *                         quarter). Amount = ForecastAmount__c (my ACV; a Flex record is already my half).
 *
 * Segments (`categoryBasis`): the forecast category when it is read (ForecastCategoryName on the opp, ForecastStatus__c
 * on a Specialist Forecast; an open opp without one counts as Pipeline, and says so), else stage groups (early, mid,
 * late) when no opp of mine carries one. Won comes from IsWon (or a won stage / status); lost deals are left out.
 *
 * Quarters use the Salesforce fiscal calendar the app already knows (FY starts 1 February; Q4 FY27 = 1 Nov 2026 –
 * 31 Jan 2027: db/quarter.ts, activity-log.ts): the previous quarter (its wins, for context), this one, the next 3.
 * Every number is a filter over the rows (src/lib/pipeline-filter.ts), so the list it links to has the same count.
 */
import type { Account, DealsPipeline, DealsSummary, Opportunity, PipelineCategory, PipelineQuarter, PipelineRow, PipelineSegmentDef, SpecialistForecast } from '@/contract';
import { localDay } from '@/engines/activity/time';
import { CLOSING_SOON_DAYS, inPipe, pipeRows, plusDays, sumOf } from '@/lib/pipeline-filter';
import type { ResolvedPersona } from '@/personas/types';
import { fiscalQuarterOfDay } from '@/server/datasource/activity-log';
import { fiscalQuarterBounds } from '@/server/datasource/db/quarter';

export type PipelineBasis = DealsPipeline['basis'];

export const FORECAST_SEGMENTS: readonly PipelineSegmentDef[] = [
  { key: 'won', label: 'Won', tier: 0 },
  { key: 'commit', label: 'Commit', tier: 1 },
  { key: 'best_case', label: 'Best case', tier: 2 },
  { key: 'pipeline', label: 'Pipeline', tier: 3 },
];
export const STAGE_SEGMENTS: readonly PipelineSegmentDef[] = [
  { key: 'won', label: 'Won', tier: 0 },
  { key: 'late', label: 'Late stage', tier: 1 },
  { key: 'mid', label: 'Mid stage', tier: 2 },
  { key: 'early', label: 'Early stage', tier: 3 },
];

export const AMOUNT_FIELDS: Readonly<Record<PipelineBasis, DealsPipeline['amountField']>> = {
  team_or_dc: { field: 'Opportunity.Amount', label: 'Opp amount' },
  specialist_forecast: { field: 'SpecialistForecast__c.ForecastAmount__c', label: 'Forecast amount (ACV)' },
};

/** The Specialist AE counts the Specialist Forecasts they own; everyone else the opps they're on or hold a DC on. */
export function pipelineBasisOf(p: Pick<ResolvedPersona, 'id' | 'features'>): PipelineBasis {
  return p.id === 'ae' && p.features.specialistForecast ? 'specialist_forecast' : 'team_or_dc';
}

const WON_STAGE = /closed\s*-?\s*won|^won\b/i;
const CLOSED_STAGE = /\bclosed\b|\bdead\b|^(lost|duplicate)\b/i;

type Parsed = 'commit' | 'best_case' | 'pipeline' | 'omitted' | 'won' | 'lost' | 'closed' | null;

/** ForecastCategoryName / ForecastStatus__c → what it means here; null for nothing (or a value this doesn't know). */
export function forecastCategoryOf(v: string | null | undefined): Parsed {
  const s = (v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^commit/.test(s)) return 'commit';
  if (/^best/.test(s)) return 'best_case';
  if (/^pipe/.test(s)) return 'pipeline';
  if (/^omit/.test(s)) return 'omitted';
  if (/closed\s*-?\s*won|^won$/.test(s)) return 'won';
  if (/closed\s*-?\s*lost|^lost$/.test(s)) return 'lost';
  if (/^closed$/.test(s)) return 'closed';
  return null;
}

/** A stage → early / mid / late: numbered Org62 stages by number (1–2, 3–4, 5+), plain names by their words. */
export function stageGroupOf(stage: string | null | undefined): 'early' | 'mid' | 'late' {
  const m = /^\s*0?([1-9])\b/.exec(stage ?? '');
  if (m) {
    const n = Number(m[1]);
    return n >= 5 ? 'late' : n >= 3 ? 'mid' : 'early';
  }
  const s = stage ?? '';
  if (/negotiat|finali[sz]|contract|selected|verbal|commit|signature|procure|closing/i.test(s)) return 'late';
  if (/proposal|quote|validat|design|solution|technical|demo|evaluat|value|confirm|pilot|proof|\bpoc\b|review/i.test(s)) return 'mid';
  return 'early';
}

/** "FY27 Q4" (FiscalQuarter__c) → "Q4 FY27"; a "Q4 FY27" passes; anything else null. */
export function quarterLabelOf(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  const a = /^FY(\d{2})\s*Q([1-4])$/i.exec(s);
  if (a) return `Q${a[2]} FY${a[1]}`;
  const b = /^Q([1-4])\s+FY(\d{2})$/i.exec(s);
  return b ? `Q${b[1]} FY${b[2]}` : null;
}

/** The quarters the chart shows: the previous one, this one (today's), the next 3. */
export function pipelineQuarters(today: string): Array<{ label: string; start: string; end: string; role: PipelineQuarter['role'] }> {
  const cur = fiscalQuarterOfDay(today);
  const b = fiscalQuarterBounds(cur)!;
  const prev = fiscalQuarterOfDay(plusDays(b.start, -1));
  const out: Array<{ label: string; start: string; end: string; role: PipelineQuarter['role'] }> = [{ label: prev, ...fiscalQuarterBounds(prev)!, role: 'previous' }, { label: cur, ...b, role: 'current' }];
  for (let i = 0; i < 3; i++) {
    const n = fiscalQuarterOfDay(plusDays(out[out.length - 1]!.end, 1));
    out.push({ label: n, ...fiscalQuarterBounds(n)!, role: 'next' });
  }
  return out;
}

/** A deal before its segment is decided. */
interface RawDeal extends Omit<PipelineRow, 'category' | 'categoryFrom' | 'attention'> {
  parsed: Parsed;
  /** A read that carries the next step saw it (an empty one then means none, not unknown). */
  stepRead: boolean;
}

const quarterOf = (closeDate: string | null) => (closeDate ? fiscalQuarterOfDay(closeDate) : null);

/** My opps (team or DC) as deals; lost ones are left out. */
export function dealsFromOpps(opps: readonly Opportunity[], accountName: (id: string) => string | null): RawDeal[] {
  const out: RawDeal[] = [];
  for (const o of opps) {
    const dc = o.dcAssigned || !!o.myDc;
    if (!o.isMine && !dc) continue;
    const parsed = forecastCategoryOf(o.forecastCategory);
    const isWon = !o.isOpen && (o.isWon || parsed === 'won' || WON_STAGE.test(o.stage));
    if (!o.isOpen && !isWon) continue;
    out.push({
      id: o.id,
      oppId: o.id,
      forecastId: null,
      accountId: o.accountId || null,
      accountName: o.accountId ? accountName(o.accountId) : null,
      name: o.name,
      stage: o.stage || null,
      amount: o.amount,
      closeDate: o.closeDate,
      quarter: quarterOf(o.closeDate),
      forecastLabel: o.forecastCategory,
      isOpen: o.isOpen,
      isWon,
      nextStep: o.nextStep?.trim() || null,
      via: o.isMine && dc ? 'team_dc' : o.isMine ? 'team' : 'dc',
      dcSplit: o.myDc?.split ?? null,
      url: o.org62Url,
      parsed,
      stepRead: o.nextStepRead,
    });
  }
  return out;
}

/**
 * The Specialist Forecasts I own as deals. A record a complete read no longer lists (`goneAt`) counts only for a
 * past quarter (it left the read's window when the quarter ended); for this quarter or later it is no longer mine.
 */
export function dealsFromForecasts(records: readonly SpecialistForecast[], accountName: (id: string) => string | null, currentStart: string): RawDeal[] {
  const out: RawDeal[] = [];
  for (const r of records) {
    const closeDate = r.closeDate ?? r.oppCloseDate;
    const quarter = quarterLabelOf(r.fiscalQuarter) ?? quarterOf(closeDate);
    const qStart = quarter ? fiscalQuarterBounds(quarter)?.start : null;
    if (r.goneAt && (!qStart || qStart >= currentStart)) continue;
    const stage = r.stage ?? r.oppStage;
    const parsed = forecastCategoryOf(r.forecastStatus);
    const isWon = parsed === 'won' || WON_STAGE.test(stage ?? '');
    const lost = !isWon && (parsed === 'lost' || CLOSED_STAGE.test(stage ?? ''));
    if (lost) continue;
    out.push({
      id: r.id,
      oppId: r.opportunityId,
      forecastId: r.id,
      accountId: r.accountId,
      accountName: r.accountName ?? (r.accountId ? accountName(r.accountId) : null),
      name: r.opportunityName ?? r.name,
      stage,
      amount: r.amount,
      closeDate,
      quarter,
      forecastLabel: r.forecastStatus,
      isOpen: !isWon,
      isWon,
      nextStep: r.oppNextStep?.trim() || null,
      via: 'forecast',
      dcSplit: null,
      url: r.url,
      parsed,
      // forecast.sync reads the core opp's NextStep with every record
      stepRead: true,
    });
  }
  return out;
}

export interface PipelineInput {
  now: Date;
  timezone: string;
  basis: PipelineBasis;
  opps: readonly Opportunity[];
  accounts: ReadonlyArray<Pick<Account, 'id' | 'name'>>;
  /** The Specialist Forecasts I own (read for the AE basis only). */
  forecasts?: readonly SpecialistForecast[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildDealsPipeline(i: PipelineInput): DealsPipeline {
  const today = localDay(i.now.getTime(), i.timezone || 'UTC');
  const quarters = pipelineQuarters(today);
  const cur = quarters[1]!;
  const last = quarters[quarters.length - 1]!;
  const names = new Map(i.accounts.map((a) => [a.id, a.name]));
  const accountName = (id: string) => names.get(id) ?? null;
  const raw = i.basis === 'specialist_forecast' ? dealsFromForecasts(i.forecasts ?? [], accountName, cur.start) : dealsFromOpps(i.opps, accountName);

  // forecast categories when any open deal carries one (an AE's records always speak forecast status)
  const categoryBasis: DealsPipeline['categoryBasis'] = i.basis === 'specialist_forecast' || raw.some((r) => r.isOpen && (r.parsed === 'commit' || r.parsed === 'best_case' || r.parsed === 'pipeline' || r.parsed === 'omitted')) ? 'forecast' : 'stage';
  const segments = categoryBasis === 'forecast' ? FORECAST_SEGMENTS : STAGE_SEGMENTS;
  // next steps count only when some deal carries one (a read that never had them flags nothing), and only for a deal a
  // read that selects NextStep has seen (an opp only the daily book read saw has an unknown next step, not a missing one)
  const nextStepRead = raw.some((r) => r.isOpen && !!r.nextStep);
  const stepUnknown = raw.filter((r) => r.isOpen && !r.nextStep && !r.stepRead && r.quarter === cur.label).length;

  const rows: PipelineRow[] = [];
  for (const { parsed, stepRead, ...r } of raw) {
    // a won deal matters for the quarters on the chart only
    if (r.isWon && (!r.quarter || (fiscalQuarterBounds(r.quarter)?.start ?? '') < quarters[0]!.start)) continue;
    let category: PipelineCategory;
    let categoryFrom: PipelineRow['categoryFrom'];
    if (r.isWon) [category, categoryFrom] = ['won', 'forecast'];
    else if (categoryBasis === 'stage') [category, categoryFrom] = [stageGroupOf(r.stage), 'stage'];
    else if (parsed === 'commit' || parsed === 'best_case' || parsed === 'pipeline' || parsed === 'omitted') [category, categoryFrom] = [parsed, 'forecast'];
    else if (parsed === 'closed') [category, categoryFrom] = ['commit', 'forecast']; // "Closed" on an open opp: as sure as it gets
    else [category, categoryFrom] = ['pipeline', 'default'];
    const attention: PipelineRow['attention'] = [];
    if (r.isOpen && category !== 'omitted') {
      if (r.closeDate && r.closeDate < today) attention.push('past_close');
      if (nextStepRead && stepRead && !r.nextStep && r.quarter === cur.label) attention.push('no_next_step');
    }
    rows.push({ ...r, category, categoryFrom, attention });
  }
  rows.sort((a, b) => (a.closeDate ?? '9999').localeCompare(b.closeDate ?? '9999') || (b.amount ?? 0) - (a.amount ?? 0) || a.id.localeCompare(b.id));

  const qs: PipelineQuarter[] = quarters.map((q) => {
    const segs = segments.map((s) => ({ key: s.key, ...(q.role === 'previous' && s.key !== 'won' ? { amount: 0, count: 0 } : sumOf(pipeRows(rows, { scope: 'quarter', quarter: q.label, cat: s.key }, today))) }));
    return { ...q, segments: segs, total: { amount: Math.round(segs.reduce((s, x) => s + x.amount, 0) * 100) / 100, count: segs.reduce((s, x) => s + x.count, 0) } };
  });
  const curQ = qs[1]!;
  const attentionRows = pipeRows(rows, { scope: 'attention' }, today);
  const summary: DealsSummary = {
    open: sumOf(pipeRows(rows, { scope: 'open' }, today)),
    thisQuarter: { label: cur.label, segments: curQ.segments.filter((s) => s.key !== 'won') },
    wonThisQuarter: sumOf(pipeRows(rows, { scope: 'quarter', quarter: cur.label, cat: 'won' }, today)),
    closingSoon: { ...sumOf(pipeRows(rows, { scope: 'soon' }, today)), days: CLOSING_SOON_DAYS },
    attention: { ...sumOf(attentionRows), pastClose: attentionRows.filter((r) => r.attention.includes('past_close')).length, noNextStep: attentionRows.filter((r) => r.attention.includes('no_next_step')).length },
  };

  const open = rows.filter(inPipe);
  const deal = i.basis === 'specialist_forecast' ? 'deal' : 'opp';
  const notes: string[] = [];
  if (i.basis === 'specialist_forecast') notes.push('Specialist Forecasts are read for this quarter and next, so later quarters stay empty until the read reaches them.');
  if (categoryBasis === 'stage' && open.length) notes.push('No forecast category was read on your opps, so they are grouped by stage.');
  const defaulted = open.filter((r) => r.categoryFrom === 'default').length;
  if (defaulted) notes.push(`${plural(defaulted, `open ${deal}`)} ${defaulted === 1 ? 'carries' : 'carry'} no forecast category: counted as Pipeline.`);
  const noClose = open.filter((r) => !r.quarter).length;
  if (noClose) notes.push(`${plural(noClose, `open ${deal}`)} ${noClose === 1 ? 'has' : 'have'} no close date, so no quarter: counted in open pipeline only.`);
  const before = open.filter((r) => r.quarter && (fiscalQuarterBounds(r.quarter)?.start ?? '') < cur.start).length;
  if (before) notes.push(`${plural(before, `open ${deal}`)} ${before === 1 ? 'is' : 'are'} dated before ${cur.label} (close date passed): in Needs attention, not on the chart.`);
  const after = open.filter((r) => r.quarter && (fiscalQuarterBounds(r.quarter)?.start ?? '') > last.end).length;
  if (after) notes.push(`${plural(after, `open ${deal}`)} ${after === 1 ? 'closes' : 'close'} after ${last.label}: in open pipeline, not on the chart.`);
  const noAmount = open.filter((r) => r.amount === null).length;
  if (noAmount) notes.push(`${plural(noAmount, `open ${deal}`)} ${noAmount === 1 ? 'has' : 'have'} no amount read yet: counted, adding $0.`);
  const omitted = rows.filter((r) => r.isOpen && r.category === 'omitted').length;
  if (omitted) notes.push(`${plural(omitted, `omitted ${deal}`)} ${omitted === 1 ? 'is' : 'are'} left out of the pipeline.`);
  if (nextStepRead && stepUnknown) notes.push(`${plural(stepUnknown, `${deal} this quarter`, `${deal}s this quarter`)} ${stepUnknown === 1 ? 'has' : 'have'} no next step read yet: not flagged for one.`);

  return { basis: i.basis, amountField: AMOUNT_FIELDS[i.basis], categoryBasis, segments: [...segments], today, currentQuarter: cur.label, quarters: qs, summary, rows, nextStepRead, notes };
}
