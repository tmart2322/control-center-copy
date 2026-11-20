/**
 * Work-list filters <-> URL (pure). The URL is the source of truth (deep links, back/forward, resume);
 * defaults are omitted so `/work` stays `/work`.
 */
import { SourceKind, WorkKind, WorkTab } from '@/contract';

/** `due`: the v2 verb sections (Do now · Do this week · Chase · Think ahead · Fit in), the default. */
export type WorkGrouping = 'initiative' | 'due';

export interface WorkFilters {
  tab: WorkTab;
  q: string;
  account: string | null;
  initiative: string | null;
  source: SourceKind | null;
  kind: WorkKind | null;
  group: WorkGrouping;
}

export const DEFAULT_FILTERS: WorkFilters = { tab: 'all_open', q: '', account: null, initiative: null, source: null, kind: null, group: 'due' };

type ParamsLike = { get(name: string): string | null };

export function parseWorkFilters(p: ParamsLike): WorkFilters {
  const tab = WorkTab.safeParse(p.get('tab'));
  const source = SourceKind.safeParse(p.get('source'));
  const kind = WorkKind.safeParse(p.get('kind'));
  return {
    tab: tab.success ? tab.data : DEFAULT_FILTERS.tab,
    q: p.get('q') ?? '',
    account: p.get('account') || null,
    initiative: p.get('initiative') || null,
    source: source.success ? source.data : null,
    kind: kind.success ? kind.data : null,
    group: p.get('group') === 'initiative' ? 'initiative' : 'due',
  };
}

/** Query string without the leading "?" (empty when everything is default). */
export function serializeWorkFilters(f: WorkFilters): string {
  const qs = new URLSearchParams();
  if (f.tab !== DEFAULT_FILTERS.tab) qs.set('tab', f.tab);
  if (f.q.trim()) qs.set('q', f.q);
  if (f.account) qs.set('account', f.account);
  if (f.initiative) qs.set('initiative', f.initiative);
  if (f.source) qs.set('source', f.source);
  if (f.kind) qs.set('kind', f.kind);
  if (f.group !== DEFAULT_FILTERS.group) qs.set('group', f.group);
  return qs.toString();
}

/** The `GET /items` query for these filters (grouping and tab-only state excluded where irrelevant). */
export function itemsQueryOf(f: WorkFilters): { tab: WorkTab; account?: string; initiative?: string; source?: SourceKind; kind?: WorkKind; q?: string } {
  return {
    tab: f.tab,
    ...(f.account ? { account: f.account } : {}),
    ...(f.initiative ? { initiative: f.initiative } : {}),
    ...(f.source ? { source: f.source } : {}),
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.q.trim() ? { q: f.q.trim() } : {}),
  };
}

/** Filters that narrow the list (everything except tab and grouping). */
export function activeFilterCount(f: WorkFilters): number {
  return [f.q.trim(), f.account, f.initiative, f.source, f.kind].filter(Boolean).length;
}

export function clearFilters(f: WorkFilters): WorkFilters {
  return { ...f, q: '', account: null, initiative: null, source: null, kind: null };
}
