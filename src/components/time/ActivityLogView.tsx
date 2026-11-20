'use client';
/**
 * Time ▸ Ledger (?view=log; docs/ui/time-redesign.md): a report first, the line items one click deeper (the owner,
 * 2026-11-14: "more reporting and high-level than line-items").
 *
 *   quarters    pick a fiscal quarter (FY starts 1 Feb; the current one is the default) or All
 *   tracking    in Org62 (verified by read-back) against the persona's target, on its way, suggested and needs input
 *               as one meter, hours to go and the pace; waiting on you (Time's quarter truth: the numbers Log it shows)
 *   where       by account with its opportunities (internal and no-account lines of their own), by task type, by week
 *   rows        the drill-down: every row of the quarter, or the rows behind the line you clicked. Search, quiet status
 *               toggles (each with its count; only a selected one is boxed), account, opportunity and type filters,
 *               then the rows grouped by week (week totals) and day (a light line linking to History), newest first,
 *               ending with "That's everything". Rows wrap to the pane's width (the shared row grid).
 *
 * GET /time/ledger (the overview, LedgerOverview.tsx) · GET /time/log (topic `time`: its `entries` are what Details
 * and the optimistic row patches find). Logged, verified and excluded rows are compact and read-only (an excluded row
 * says why); every other row is the autosaving ActivityRow. The page scrolls; the rows are virtualized inside their
 * pane, which fills the window once you are there. Keys: j/k move through the rows, Enter opens one in the docked
 * panel, / focuses search.
 */
import { keepPreviousData } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ActivityEntry, ActivityLog, ActivityLogStatus } from '@/contract';
import { usePersona } from '@/client/persona';
import { useApi } from '@/client/hooks';
import { useCommands, useKeyBinding } from '@/client/keyboard';
import { setChatContext } from '@/components/chat';
import { ContextHead, ContextPage, Pane, useContextKeys, useDetails } from '@/components/deals/context-frame';
import { ACTIVITY_AREA, ACTIVITY_COLS, ACTIVITY_META, ACTIVITY_ROWS, ActivityRowHeader, ActivityStatusWord, StatusBadge } from '@/components/domain';
import { SourceChip } from '@/components/domain/lib';
import { usePromptWording } from '@/components/domain/ResultLinks';
import { clock, dayLabel, ymd } from '@/components/domain/lib/time';
import { FilterChip, SearchField } from '@/components/lists/controls';
import { useUrlFilters } from '@/components/lists/hooks';
import { AppLink } from '@/components/shell/AppLink';
import { navigate } from '@/components/shell/router';
import { Button, cn, EmptyState, Icon, IconButton, PanelBoundary, PanelError, Skeleton, TONE_DOT, usePanelState } from '@/ui';
import { AutosaveRow } from './ActivityTable';
import { fmtH, q4Range, READBACK_BADGE, readbackState } from './derive';
import { ACCOUNT_NONE_LABEL, hasSlice, INTERNAL_LABEL, OPP_NONE_LABEL, quarterParam, quarterTitle, shownQuarter, sliceTitle, toggleLine, tracking, TYPE_NONE_LABEL, type LedgerLine, type SliceFilters } from './ledger-derive';
import { LedgerBreakdowns, LedgerChart, LedgerTracking, QuarterPicker } from './LedgerOverview';
import {
  activeLogFilterCount,
  ALL_QUARTERS,
  DEFAULT_LOG_FILTERS,
  EXCLUDED_REASON_LABEL,
  EXCLUDED_REASON_SHORT,
  EXCLUDED_WORD,
  historyHref,
  LOG_CHIPS,
  LOG_STATUS_LABEL,
  logItems,
  logQueryOf,
  parseLogFilters,
  serializeLogFilters,
  toggleStatus,
  weekEndOf,
  weekRangeLabel,
  type LogFilters,
  type LogItem,
} from './log-derive';
import { logPath, quarterTruth, rowsWord, type QuarterPart } from './path-derive';
import { useConfirmCopied } from './Q4Log';
import { hrefForView } from './views';

const SCOPE = 'page:time:log';

/** Estimated heights (px) before a row is measured. */
const EST: Record<LogItem['kind'], number> = { week: 44, day: 36, row: 40, end: 72 };
const EST_EDITABLE = 52;
const HEADER_H = 40;

/** The rows that are not in Org62 yet (a past quarter's "waiting on you" shows these below). */
const NOT_IN_ORG62: ActivityLogStatus[] = ['needs_input', 'proposed', 'approved', 'handed_off'];
const NO_SLICE: SliceFilters = { account: null, opp: null, type: null, week: null };

function chipTone(s: ActivityLogStatus) {
  if (s === 'handed_off') return ACTIVITY_META.synced_to_canvas.tone;
  if (s === 'excluded') return ACTIVITY_META.dismissed.tone;
  return ACTIVITY_META[s].tone;
}

// ── Filters (the pane's head) ──────────────────────────────────────────────────────────────

interface FilterBarProps {
  log: ActivityLog | undefined;
  value: LogFilters;
  update: (patch: Partial<LogFilters>, opts?: { immediate?: boolean }) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}

function FilterBar({ log, value, update, searchRef }: FilterBarProps) {
  const counts = log?.counts;
  const chips = counts && counts.upcoming > 0 ? [...LOG_CHIPS, 'upcoming' as const] : LOG_CHIPS;
  const accounts = (log?.facets.accounts ?? []).map((a) => ({ value: a.name, label: `${a.name} · ${a.rows}` }));
  const opps = (log?.facets.opps ?? []).filter((o) => !value.account || o.accountName === value.account).map((o) => ({ value: o.id, label: `${o.name} · ${o.rows}` }));
  const types = (log?.facets.types ?? []).map((t) => ({ value: t.name ?? 'none', label: `${t.name ?? TYPE_NONE_LABEL} · ${t.rows}` }));
  // a drill-down's special values (no account, no opportunity, internal) read as words, never as "none"
  if (value.account && !accounts.some((a) => a.value === value.account)) accounts.unshift({ value: value.account, label: value.account === 'none' ? ACCOUNT_NONE_LABEL : value.account });
  if (value.opp && !opps.some((o) => o.value === value.opp)) opps.unshift({ value: value.opp, label: value.opp === 'none' ? OPP_NONE_LABEL : value.opp === 'internal' ? INTERNAL_LABEL : value.opp });
  if (value.type && !types.some((t) => t.value === value.type)) types.unshift({ value: value.type, label: value.type === 'none' ? TYPE_NONE_LABEL : value.type });
  const n = activeLogFilterCount(value);
  return (
    <div className="flex min-w-0 flex-col gap-2 border-b border-line px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <SearchField ref={searchRef} aria-label="Search the log" placeholder="Search descriptions, types, opps, accounts" value={value.q} onChange={(e) => update({ q: e.target.value })} onClear={() => update({ q: '' }, { immediate: true })} className="w-80" />
        <FilterChip label="Account" value={value.account} options={accounts} anyLabel="Any account" onChange={(v) => update({ account: v, opp: null }, { immediate: true })} width={320} />
        <FilterChip label="Opportunity" value={value.opp} options={opps} anyLabel="Any opportunity" onChange={(v) => update({ opp: v }, { immediate: true })} width={360} />
        {types.length ? <FilterChip label="Type" value={value.type} options={types} anyLabel="Any type" onChange={(v) => update({ type: v }, { immediate: true })} width={280} /> : null}
        {value.week ? (
          <span className="inline-flex h-9 items-center gap-1 rounded-md border border-accent bg-selected pr-1 pl-3 text-body text-fg-heading" data-testid="log-week-chip">
            <span className="text-fg">Week</span>
            <span className="font-bold tabular-nums">{weekRangeLabel(value.week, weekEndOf(value.week))}</span>
            <IconButton icon="close" size="sm" label="Every week" onClick={() => update({ week: null }, { immediate: true })} />
          </span>
        ) : null}
        {n ? (
          <Button size="sm" variant="quiet" onClick={() => update({ ...DEFAULT_LOG_FILTERS, quarter: value.quarter }, { immediate: true })}>
            Clear {n === 1 ? 'filter' : `${n} filters`}
          </Button>
        ) : null}
      </div>
      <div role="group" aria-label="Status" className="flex min-w-0 flex-wrap items-center gap-1.5">
        {chips.map((s) => {
          const on = value.status.includes(s);
          const c = counts?.[s] ?? 0;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              data-status={s}
              onClick={() => update({ status: toggleStatus(value.status, s) }, { immediate: true })}
              className={cn(
                // quiet text toggles: only a selected one gets a fill and a line (fewer boxes on the screen)
                'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-caption transition-colors focus-visible:outline-none focus-visible:shadow-focus',
                on ? 'border-accent bg-selected font-bold text-fg-heading' : 'border-transparent text-fg hover:bg-surface-muted',
                !c && !on && 'text-muted',
              )}
            >
              <span aria-hidden className={cn('size-2 shrink-0 rounded-full', TONE_DOT[chipTone(s)])} />
              {LOG_STATUS_LABEL[s]}
              <span className="text-muted tabular-nums">{c}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Rows ───────────────────────────────────────────────────────────────────────────────────

/** A logged, verified or excluded row: the same columns as the editable row, as text, one line. */
function LogRow({ entry, now, tz, selected, highlight, onSelect }: { entry: ActivityEntry; now: string; tz?: string; selected: boolean; highlight: boolean; onSelect: (e: ActivityEntry) => void }) {
  const excluded = entry.status === 'dismissed';
  const reason = excluded ? EXCLUDED_REASON_LABEL[entry.excludedReason ?? 'dismissed'] : null;
  const rb = readbackState(entry, now);
  const stamp = entry.verifiedAt ? `Verified ${dayLabel(entry.verifiedAt, tz)}` : entry.loggedAt && !entry.fromOrg62 ? `Logged ${dayLabel(entry.loggedAt, tz)}` : entry.fromOrg62 ? 'From Org62' : '';
  const opp = entry.oppName ?? entry.accountName;
  const oppTitle = [entry.oppName, entry.accountName].filter(Boolean).join(' · ') || undefined;
  return (
    <div
      role="row"
      data-activity-id={entry.id}
      data-row-id={entry.id}
      data-compact=""
      data-status={entry.status}
      data-selected={selected ? '' : undefined}
      tabIndex={selected ? 0 : -1}
      aria-label={`${entry.date} ${entry.description || 'Activity row'}`}
      onClick={(ev) => {
        if ((ev.target as HTMLElement).closest('a,button')) return;
        onSelect(entry);
      }}
      className={cn(
        ACTIVITY_COLS,
        'min-h-11 cursor-default border-b border-line px-4 py-2 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)]',
        selected || highlight ? 'bg-selected' : 'hover:bg-surface-muted',
        highlight && 'shadow-[inset_0_0_0_1px_var(--color-accent)]',
        excluded && 'text-muted',
      )}
    >
      <span className={cn(ACTIVITY_AREA.when, 'flex min-w-0 items-baseline gap-3 px-2 tabular-nums')}>
        <span className="text-muted">{dayLabel(`${entry.date}T12:00:00Z`, 'UTC')}</span>
        <span>
          {clock(entry.start, tz)}–{clock(entry.end, tz)}
        </span>
      </span>
      <span className={cn(ACTIVITY_AREA.hours, 'px-2 text-right tabular-nums', excluded && 'line-through decoration-faint')}>{entry.durationH}</span>
      {/* description and opportunity wrap to two lines; the full text is the tooltip */}
      <span className={cn(ACTIVITY_AREA.desc, 'line-clamp-2 min-w-0 px-2 break-words', !excluded && 'text-fg')} title={[entry.description, ...entry.issues].filter(Boolean).join(' · ')}>
        {entry.description}
      </span>
      <span className={cn(ACTIVITY_AREA.opp, 'line-clamp-2 min-w-0 px-2 break-words')} title={oppTitle}>
        {/* D-64: internal-only work logs with Related To empty */}
        {opp ?? (entry.internal ? <span className="text-muted" data-testid="ledger-internal">Internal</span> : <span className="text-faint">No opp</span>)}
        {entry.oppName && entry.accountName && !entry.oppName.toLowerCase().includes(entry.accountName.toLowerCase()) ? <span className="text-muted"> · {entry.accountName}</span> : null}
      </span>
      <span className={cn(ACTIVITY_AREA.type, 'min-w-0 truncate px-2')} title={entry.taskType ?? undefined}>
        {entry.taskType ?? <span className="text-faint">No type</span>}
      </span>
      <span className={cn(ACTIVITY_AREA.cfcr, 'px-2 text-caption font-bold text-muted')}>{entry.meetingType ?? '–'}</span>
      <span className={cn(ACTIVITY_AREA.status, 'flex min-w-0 flex-col items-start gap-0.5')}>
        {excluded ? (
          // why it is not logged, in the status slot: the word, then the short reason (the full one on hover)
          <span className="flex min-w-0 flex-col text-caption leading-5" title={[reason, ...entry.issues].filter(Boolean).join(' · ')}>
            <span className="font-bold text-muted">{EXCLUDED_WORD[entry.excludedReason ?? 'dismissed']}</span>
            <span className="text-muted" data-testid="excluded-reason">
              {EXCLUDED_REASON_SHORT[entry.excludedReason ?? 'dismissed']}
            </span>
          </span>
        ) : rb ? (
          <StatusBadge tone={rb === 'missing' || rb === 'deleted' ? 'danger' : 'warning'} icon="warning">
            {READBACK_BADGE[rb]}
          </StatusBadge>
        ) : (
          <ActivityStatusWord status={entry.status} />
        )}
        {/* quiet metadata: where it came from, and when Org62 confirmed it */}
        <span className="flex min-w-0 items-center gap-1 text-caption text-muted" title={entry.loggedAt ? `Logged ${dayLabel(entry.loggedAt, tz)} ${clock(entry.loggedAt, tz)}` : undefined}>
          {entry.sources.slice(0, 2).map((s, i) => (
            <SourceChip key={`${s.kind}:${i}`} source={s} compact />
          ))}
          {stamp ? <span className="min-w-0 truncate">{stamp}</span> : null}
        </span>
      </span>
    </div>
  );
}

function WeekHead({ it }: { it: Extract<LogItem, { kind: 'week' }> }) {
  return (
    <div role="rowgroup" aria-label={`Week of ${weekRangeLabel(it.weekStart, it.weekEnd)}`} className="flex min-h-11 flex-wrap items-center gap-x-2 bg-surface-muted px-4 py-2">
      <span className="text-body font-bold text-fg-heading">Week of {weekRangeLabel(it.weekStart, it.weekEnd)}</span>
      <span className="text-body text-muted tabular-nums">{it.total.rows}</span>
      <span className="ml-auto text-caption text-muted tabular-nums">
        {fmtH(it.total.hours)} yours · <span className="font-bold text-fg">{fmtH(it.total.loggedH)} logged</span>
      </span>
    </div>
  );
}

function DayHead({ it }: { it: Extract<LogItem, { kind: 'day' }> }) {
  return (
    <div className="flex min-h-9 items-baseline gap-2 px-4 pt-3 pb-1">
      <AppLink href={historyHref(it.day)} className="inline-flex items-center gap-1 rounded-sm text-body font-bold text-fg-heading hover:underline focus-visible:outline-none focus-visible:shadow-focus" title="Open this day in History">
        {dayLabel(`${it.day}T12:00:00Z`, 'UTC')}
        <Icon name="chevronright" size="xs" className="text-muted" />
      </AppLink>
      <span className="text-caption text-muted tabular-nums">{it.rows === 1 ? '1 row' : `${it.rows} rows`}</span>
      <span className="ml-auto text-caption text-muted tabular-nums">{fmtH(it.hours)}</span>
    </div>
  );
}

// ── The view ───────────────────────────────────────────────────────────────────────────────

export interface ActivityLogViewProps {
  now: string;
  tz?: string;
  /** The page’s view switch (Log hours · Ledger · …), shown in the head. */
  tabs: ReactNode;
}

export function ActivityLogView({ now, tz, tabs }: ActivityLogViewProps) {
  const persona = usePersona();
  const wording = usePromptWording();
  const settings = useApi('getSettings');
  const approveComplete = settings.data?.time?.logging?.approveComplete ?? true;
  const { value, committed, update } = useUrlFilters<LogFilters>({ parse: parseLogFilters, serialize: serializeLogFilters });
  const thisWeekEnd = weekEndOf(ymd(now, tz));

  // the overview: one quarter (the current one by default) or every quarter
  const ledgerQ = useApi('getTimeLedger', { query: committed.quarter ? { quarter: committed.quarter } : {} }, { placeholderData: keepPreviousData, staleTime: 30_000 });
  const ledger = ledgerQ.data;
  const quarter = shownQuarter(ledger);
  const track = useMemo(() => (ledger ? tracking(ledger, quarter) : null), [ledger, quarter]);
  // the current quarter's days come with its ledger (no quarter in the URL); a label's are its own
  const fresh = ledger && !ledgerQ.isPlaceholderData ? ledger : undefined;
  const currentFrom = committed.quarter === null ? (fresh?.from ?? null) : null;
  const currentTo = committed.quarter === null ? (fresh?.to ?? null) : null;
  const query = useMemo(() => logQueryOf(committed, thisWeekEnd, currentFrom && currentTo ? { start: currentFrom, end: currentTo } : null), [committed, thisWeekEnd, currentFrom, currentTo]);
  const listReady = committed.quarter !== null || !!currentFrom;
  const q = useApi('getActivityLog', { query }, { enabled: listReady, placeholderData: keepPreviousData, staleTime: 30_000 });
  const log = q.data;

  // waiting on you: Time's quarter truth over the quarter's rows (the current quarter's are Log it's own, this week on top)
  const cur = useApi('getTime', { query: { week: undefined } });
  const isCurrent = !!quarter?.current;
  const trackQuery = quarter && (!isCurrent || cur.data) ? (isCurrent && cur.data ? q4Range(cur.data) : { from: quarter.start, to: quarter.end }) : null;
  const trackRows = useApi('getActivityLog', { query: trackQuery ?? {} }, { enabled: !!trackQuery, staleTime: 60_000 });
  const [copiedFor] = useConfirmCopied();
  const truth = useMemo(() => {
    if (!quarter || !cur.data || !trackRows.data || ledgerQ.isPlaceholderData) return null;
    const byId = new Map<string, ActivityEntry>();
    for (const e of trackRows.data.entries) byId.set(e.id, e);
    if (isCurrent) for (const e of cur.data.entries) byId.set(e.id, e);
    const week = { ...cur.data, quarter: { label: quarter.label, loggedH: quarter.loggedH, targetH: quarter.targetH, due: quarter.due } };
    const input = { rows: [...byId.values()], week, nowIso: now, tz, confirmCopiedFor: copiedFor, dcPending: 0, ucPending: 0, taskTypeRequired: wording.taskType, approveComplete };
    return quarterTruth(input, logPath({ ...input, recordTypeName: wording.recordTypeName }), quarter.verifiedH);
  }, [quarter, cur.data, trackRows.data, ledgerQ.isPlaceholderData, isCurrent, now, tz, copiedFor, wording.taskType, wording.recordTypeName, approveComplete]);

  const state = usePanelState('time.log', { loading: ledgerQ.isLoading, error: ledgerQ.data ? null : ledgerQ.error ?? q.error, empty: false });
  const { open: openDetails } = useDetails();
  const [selected, setSelected] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const items = useMemo(() => (log ? logItems(log) : []), [log]);
  const ids = useMemo(() => items.flatMap((it) => (it.kind === 'row' ? [it.entry.id] : [])), [items]);
  const indexOf = useMemo(() => new Map(items.map((it, i) => [it.key, i] as const)), [items]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => {
      const it = items[i];
      if (!it) return EST.row;
      return it.kind === 'row' && !it.compact ? EST_EDITABLE : EST[it.kind];
    },
    getItemKey: (i) => items[i]?.key ?? i,
    overscan: 12,
    // the column header is sticky inside the scroller: items start below it, and a jump lands below it too
    scrollMargin: HEADER_H,
    scrollPaddingStart: HEADER_H,
  });

  const openRow = useCallback(
    (id: string) => {
      const e = log?.entries.find((x) => x.id === id);
      if (!e) return;
      setSelected(id);
      openDetails({ kind: 'activity_entry', id, label: e.description || 'Activity row' });
    },
    [log, openDetails],
  );

  // j/k: keep the selection rendered (the list is virtualized), then focus it
  const select = useCallback(
    (id: string | null) => {
      setSelected(id);
      const i = id ? indexOf.get(id) : undefined;
      if (i !== undefined) virtualizer.scrollToIndex(i, { align: 'auto' });
    },
    [indexOf, virtualizer],
  );
  useContextKeys({ scope: SCOPE, rootRef, ids, selected: selected && ids.includes(selected) ? selected : null, setSelected: select, enabled: state === 'ready', onOpen: openRow });
  useKeyBinding(
    '/',
    () => {
      searchRef.current?.focus();
    },
    { scope: SCOPE },
  );

  // a new filter starts at the top of the rows
  const filterKey = serializeLogFilters(committed);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [filterKey]);

  const showRows = useCallback(() => requestAnimationFrame(() => document.getElementById('ledger-rows')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })), []);
  const slice: SliceFilters = { account: committed.account, opp: committed.opp, type: committed.type, week: committed.week };
  const onLine = (l: LedgerLine) => {
    const next = toggleLine(l, slice);
    update(next, { immediate: true });
    if (hasSlice(next)) showRows();
  };
  // a quarter: its overview and its rows (the slice belongs to the quarter it was picked in; the chips and search stay)
  const pickQuarter = (v: string | null) => update({ ...NO_SLICE, quarter: v }, { immediate: true });
  const onWaiting = (part: QuarterPart['id']) => {
    // the current quarter's waiting rows are acted on in Log it and Needs you; a past quarter's right here
    if (isCurrent) return navigate(hrefForView(part === 'needs' ? 'needs' : 'week', persona));
    update({ ...NO_SLICE, status: NOT_IN_ORG62 }, { immediate: true });
    showRows();
  };
  const onExcluded = () => {
    update({ ...NO_SLICE, status: ['excluded'] }, { immediate: true });
    showRows();
  };

  useCommands([
    { id: 'time.log.search', title: 'Search the activity log', group: 'Time', shortcut: '/', run: () => searchRef.current?.focus() },
    ...(ledger?.quarters ?? []).map((x) => ({ id: `time.log.q.${x.label}`, title: `Ledger: show ${x.label}`, group: 'Time', run: () => pickQuarter(quarterParam(x.label, ledger?.quarters ?? [])) })),
    { id: 'time.log.all', title: 'Ledger: every quarter', group: 'Time', run: () => pickQuarter(ALL_QUARTERS) },
  ]);

  const sentence = ledger && track ? `${quarterTitle(ledger)} · ${fmtH(track.loggedH)}${track.targetH > 0 ? ` of ${track.targetH} h` : ''} in Org62 · ${fmtH(ledger.totals.hours)} yours in ${rowsWord(ledger.totals.rows)}` : 'Loading the ledger…';
  const title = sliceTitle(slice, ledger);
  const vItems = virtualizer.getVirtualItems();
  const pickLabel = (label: string) => pickQuarter(quarterParam(label, ledger?.quarters ?? []));

  return (
    <ContextPage label="Time" className="cc-scroll overflow-y-auto [scrollbar-gutter:stable]">
      <ContextHead title="Time" sentence={sentence} tabs={tabs} />
      <div ref={rootRef} className="flex min-w-0 shrink-0 flex-col gap-5">
        <PanelBoundary name="time-log">
          {state === 'error' ? (
            <PanelError title="Couldn't load the ledger" error={ledgerQ.error ?? q.error ?? new Error('Forced error state')} onRetry={() => void Promise.all([ledgerQ.refetch(), q.refetch()])} />
          ) : !ledger || !track ? (
            <>
              <Skeleton variant="block" className="h-16 w-full shrink-0" />
              <Skeleton variant="block" className="h-52 w-full shrink-0" />
              <Skeleton variant="block" className="h-72 w-full shrink-0" />
            </>
          ) : (
            <>
              <QuarterPicker quarters={ledger.quarters} value={committed.quarter} onPick={(v) => (v === ALL_QUARTERS || v === null ? pickQuarter(v) : pickLabel(v))} />
              <div className={cn('flex min-w-0 flex-col gap-5 transition-opacity', ledgerQ.isPlaceholderData && 'opacity-60')} data-fetching={ledgerQ.isPlaceholderData ? '' : undefined}>
                <LedgerTracking ledger={ledger} quarter={quarter} t={track} truth={truth} tz={tz} onWaiting={onWaiting} waitingVerb={isCurrent ? 'Open it on Log it' : 'Show the rows not in Org62 yet, below'} onExcluded={onExcluded} onPickQuarter={pickLabel} />
                <LedgerBreakdowns ledger={ledger} slice={slice} onLine={onLine} showTypes={wording.taskType || ledger.types.some((x) => x.type !== null)} />
                <LedgerChart ledger={ledger} slice={slice} onLine={onLine} onPickQuarter={pickLabel} thisWeekEnd={thisWeekEnd} />
              </div>

              <section id="ledger-rows" aria-labelledby="ledger-rows-h" className="flex min-w-0 scroll-mt-4 flex-col gap-2" data-testid="ledger-rows">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 id="ledger-rows-h" className="min-w-0 text-lead font-bold text-fg-heading">
                    {title ? `Rows · ${title}` : 'Every row'}
                  </h2>
                  {log ? <span className="text-body text-muted tabular-nums">{`${rowsWord(log.total.rows)} · ${fmtH(log.total.hours)} yours · ${fmtH(log.total.loggedH)} in Org62`}</span> : null}
                  {title ? (
                    <Button size="sm" variant="quiet" onClick={() => update(NO_SLICE, { immediate: true })} data-testid="ledger-rows-all">
                      {committed.quarter === ALL_QUARTERS ? 'Every row' : `Every row in ${ledger.quarter}`}
                    </Button>
                  ) : null}
                </div>
                <Pane aria-label="Activity log" data-testid="activity-log" className="h-[calc(100dvh-9rem)] min-h-96 shrink-0" head={<FilterBar log={log} value={value} update={update} searchRef={searchRef} />} bodyRef={scrollRef} bodyClassName="overflow-x-hidden">
                  {!log ? (
                    <Skeleton variant="row" count={6} />
                  ) : log.entries.length === 0 ? (
                    <EmptyState
                      icon="clock"
                      title={activeLogFilterCount(committed) ? 'No rows match these filters' : 'Nothing in this quarter'}
                      body={activeLogFilterCount(committed) ? 'Clear a filter to see more of the log.' : 'Meetings, Claude sessions, Drive edits and Org62 Events appear here as they are scanned.'}
                      action={
                        activeLogFilterCount(committed) ? (
                          <Button size="sm" variant="secondary" onClick={() => update({ ...DEFAULT_LOG_FILTERS, quarter: committed.quarter }, { immediate: true })}>
                            Clear filters
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    <div role="table" aria-label="Activity log rows" aria-rowcount={ids.length} className={ACTIVITY_ROWS} data-fetching={q.isFetching ? '' : undefined}>
                      <ActivityRowHeader className="sticky top-0 z-[2]" />
                      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
                        {vItems.map((v) => {
                          const it = items[v.index];
                          if (!it) return null;
                          return (
                            <div key={v.key} data-index={v.index} ref={virtualizer.measureElement} className="absolute inset-x-0 top-0" style={{ transform: `translateY(${v.start - HEADER_H}px)` }}>
                              {it.kind === 'week' ? (
                                <WeekHead it={it} />
                              ) : it.kind === 'day' ? (
                                <DayHead it={it} />
                              ) : it.kind === 'row' ? (
                                it.compact ? (
                                  <LogRow entry={it.entry} now={now} tz={tz} selected={selected === it.entry.id} highlight={false} onSelect={(e) => openRow(e.id)} />
                                ) : (
                                  <AutosaveRow
                                    entry={it.entry}
                                    now={now}
                                    highlight={false}
                                    selected={selected === it.entry.id}
                                    onSelect={(e) => {
                                      openRow(e.id);
                                      setChatContext({ kind: 'activity_entry', id: e.id, label: e.description || 'Activity row' });
                                    }}
                                  />
                                )
                              ) : (
                                <p className="px-4 py-6 text-center text-caption text-muted" data-testid="log-end">
                                  That&apos;s everything · {it.rows} {it.rows === 1 ? 'row' : 'rows'}
                                  {committed.quarter === ALL_QUARTERS ? '' : ` in ${ledger.quarter}`}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </Pane>
              </section>
            </>
          )}
        </PanelBoundary>
      </div>
      <span className="sr-only" aria-live="polite">
        {log ? `${log.total.rows} rows` : ''}
      </span>
    </ContextPage>
  );
}
