'use client';
/**
 * Activity (was Time; docs/ui/time-redesign.md, D-70). Two main tabs, Org62 and VDP (./views.ts), each with sub-tabs
 * that say what they do: Org62 ▸ Log it (?view=week, the SE's default), Needs you (?view=needs, with its count), Weeks
 * (?view=weeks), Ledger (?view=log: ActivityLogView.tsx), Use cases (?view=usecases: ./UseCasesView.tsx) and Forecast
 * (?view=forecast, the AE's default); VDP ▸ Changes (?view=vdp) and My VDPs (?view=vdp&sub=mine) (VdpView.tsx, D-52,
 * D-60). VDP, Use cases and Forecast are persona features (D-55): without one its tab is hidden and its link says it is
 * available to activate (Settings ▸ Role & rules). The page is /activity; /time (any query) redirects here.
 *
 * Each tab is one job, and no week is shown where it does not matter:
 *   Log it     only logging: the quarter header (in Org62 against the target, what waits, pace, where a canvas's hours
 *              went), Ready to log (rows, use cases and Event updates; one filled button), Logging runs (each canvas
 *              its own item, its writes one click deeper), Internal rows, Use cases in Org62.
 *   Needs you  only what needs you, across the quarter: the rows grouped by what is missing (inline and bulk fixes,
 *              the app's suggestions), and the use cases with a question.
 *   Weeks      what the app found, week by week: a week picker (the quarter's weeks and the one before, each with the
 *              hours found and how much is in Org62; the arrows step), Suggested, onsite days, Week at a glance, then
 *              the week's rows (the editable table: j/k, Enter, Esc). `?week=` opens that week.
 *
 * GET /time?week · GET /time/log · PATCH /activity/:id · POST /time/log/batches (Log to Slackbot: new canvas items,
 * applied here in the draft panel, D-47 / D-52). ⌘↵ runs Log it's current step.
 */
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ActivityEntry, TimeWeek } from '@/contract';
import { usePersona } from '@/client/persona';
import { loggingProfile } from '@/engines/activity/persona';
import { useApi } from '@/client/hooks';
import { useCommands } from '@/client/keyboard';
import { clearChatContext, setChatContext } from '@/components/chat';
import { ContextHead, ContextPage, Pane, SectionHead, useContextKeys, useDetails } from '@/components/deals/context-frame';
import { useContextPanels } from '@/components/deals/register-panels';
import { DomainClock } from '@/components/domain';
import { usePromptWording } from '@/components/domain/ResultLinks';
import { dayLabel } from '@/components/domain/lib/time';
import { FeatureInactive } from '@/components/shell/FeatureInactive';
import { Button, cn, EmptyState, IconButton, PanelBoundary, PanelError, Skeleton, Tabs, useNow, usePanelState, useTimeZone } from '@/ui';
import { featureActive } from '@/personas/gates';
import { ActivityLogView } from './ActivityLogView';
import { ActivityTable } from './ActivityTable';
import { DEFAULT_WORK, fmtH, hhmmToMin, loggingGap, q4Range, quarterRowsOf, shiftWeek, type QuarterRows } from './derive';
import { InternalRows } from './InternalRows';
import { NeedsYou } from './NeedsYou';
import { logPath, mondayOf, quarterTruth, rowsWord, weekSuggested } from './path-derive';
import { LogIt, useConfirmCopied, useDcPending, useUcPending, useWorkOrderCanvasUrl } from './Q4Log';
import { UseCaseSync } from './UseCaseSync';
import { UseCaseQuestions, UseCasesView } from './UseCasesView';
import { QuarterHeader } from './QuarterHeader';
import { SuggestedWeek } from './SuggestedWeek';
import { TimeBodySkeleton } from './TimeSkeleton';
import { VdpView } from './VdpView';
import { ForecastView } from './ForecastView'; // lane A
import { areaTabsFor, hrefForArea, hrefForVdpSub, hrefForView, hrefForWeek, timeAreaOf, timeTabsFor, timeViewAccess, timeViewOf, VDP_SUBS, vdpSubOf, type TimeArea, type TimeView, type VdpSub } from './views';
import { pickerRange, weekGroups, type WeekGroup } from './weeks-derive';
import { timeBadges } from './badges';
import { navigate } from '@/components/shell/router';

const SCOPE = 'page:time';

/**
 * The rows the path works on: the fiscal quarter so far and at least the last 3 weeks, from GET /time/log (the whole
 * activity log, not three week payloads), with this week's payload on top (deduped by id). The log also carries the
 * current quarter's verified hours (its quarter totals ignore the range).
 */
function useQuarterRows(current: TimeWeek | undefined): QuarterRows {
  const range = current ? q4Range(current) : null;
  const log = useApi('getActivityLog', { query: range ?? {} }, { enabled: !!range, staleTime: 60_000 });
  return useMemo(() => quarterRowsOf({ log: log.data, logFailed: log.isError, week: current }), [log.data, log.isError, current]);
}

export { TIME_VIEWS } from './views';

/**
 * The two main tabs (Org62 · VDP, the second while the persona has VDP) and the sub-tabs of the one selected: Org62's
 * Log it · Needs you (its count) · Weeks · Ledger · Use cases · Forecast, VDP's Changes · My VDPs. A gated view's tab
 * stays hidden even when its link is open (then no tab is selected). Weeks keeps the week shown.
 */
export function TimeTabs({ view, sub, needsCount }: { view: TimeView; sub?: VdpSub; needsCount?: number }) {
  const persona = usePersona();
  const params = useSearchParams();
  // D-60: every badge points at what it counts: the sidebar's Activity number is the sum of these (./badges.ts)
  const today = useApi('getToday'); // live: the today topic (the sidebar's query keeps the safety net)
  const b = timeBadges(today.data?.navCounts);
  const n = (x: number) => (x > 0 ? x : undefined);
  const area = timeAreaOf(view);
  const areas = areaTabsFor(persona).map((t) => ({ ...t, count: n(t.value === 'vdp' ? b.vdp : b.time) }));
  const subCount: Partial<Record<TimeView, number | undefined>> = { week: n(b.log), forecast: n(b.forecast), needs: needsCount || undefined };
  const subs = timeTabsFor(persona).map((t) => ({ ...t, count: subCount[t.value] }));
  const vdpSubs = VDP_SUBS.map((t) => ({ ...t, count: t.value === 'changes' ? n(b.changes) : undefined }));
  const goView = (v: TimeView) => {
    const week = params.get('week');
    navigate(v === 'weeks' ? hrefForWeek(week) : hrefForView(v, persona));
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {areas.length > 1 ? <Tabs<TimeArea> label="Org62 or VDP" idBase="time-area" size="md" value={area} onChange={(a) => navigate(hrefForArea(a, persona))} tabs={areas} /> : null}
      {area === 'vdp' ? (
        <Tabs<VdpSub> label="VDP views" idBase="vdp-sub" variant="line" value={sub ?? 'changes'} onChange={(s) => navigate(hrefForVdpSub(s))} tabs={vdpSubs} />
      ) : (
        <Tabs<TimeView> label="Org62 views" idBase="time-view" variant="line" value={view} onChange={goView} tabs={subs} />
      )}
    </div>
  );
}

/** The tabs for a view that has no count of its own (Ledger, Forecast, a gated view). */
function ViewTabs({ view }: { view: TimeView }) {
  return <TimeTabs view={view} sub={vdpSubOf(useSearchParams().get('sub'))} />;
}

/**
 * D-52: `/activity?draft=<id>` (the Outbox's pointer, the Assistant's links, the Today rail) opens that admin item in
 * the docked panel, on a fresh load or an in-app navigation, then drops the param so a reload doesn't reopen it.
 */
function useDraftParam() {
  const params = useSearchParams();
  const pathname = usePathname();
  const { open } = useDetails();
  const draft = params.get('draft');
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!draft || handled.current === draft) return;
    handled.current = draft;
    open({ kind: 'draft', id: draft });
    const url = new URL(window.location.href);
    url.searchParams.delete('draft');
    window.history.replaceState(window.history.state, '', `${pathname}${url.search}`);
  }, [draft, open, pathname]);
}

export function TimePage() {
  useContextPanels();
  useDraftParam();
  const params = useSearchParams();
  const persona = usePersona();
  // no ?view= (or an unknown one): the persona's default (Forecast for an AE, else Log it); a ?week= opens Weeks
  const view = timeViewOf(params.get('view'), persona, params.get('week'));
  const tz = useTimeZone();
  const now = useNow().toISOString();
  if (view === 'log')
    return (
      <DomainClock now={now} tz={tz}>
        <ActivityLogView now={now} tz={tz} tabs={<ViewTabs view="log" />} />
      </DomainClock>
    );
  if (view === 'forecast')
    return (
      <DomainClock now={now} tz={tz}>
        <GatedView view="forecast">
          <ForecastView tabs={<ViewTabs view="forecast" />} />
        </GatedView>
      </DomainClock>
    );
  if (view === 'vdp') {
    const sub = vdpSubOf(params.get('sub'));
    return (
      <DomainClock now={now} tz={tz}>
        <GatedView view="vdp">
          <VdpView sub={sub} tabs={<TimeTabs view="vdp" sub={sub} />} />
        </GatedView>
      </DomainClock>
    );
  }
  if (view === 'usecases')
    return (
      <DomainClock now={now} tz={tz}>
        <GatedView view="usecases">
          <UseCasesView tabs={<ViewTabs view="usecases" />} />
        </GatedView>
      </DomainClock>
    );
  if (view === 'weeks') return <WeeksView />;
  return <QuarterView view={view === 'needs' ? 'needs' : 'week'} />;
}

/**
 * A view that belongs to a persona feature: the view once the persona has it; a neutral frame while the persona loads
 * (no VDP words for someone without VDP); otherwise that the feature is available to activate.
 */
function GatedView({ view, children }: { view: TimeView; children: ReactNode }) {
  const access = timeViewAccess(view, usePersona());
  if (access.state === 'show') return <>{children}</>;
  return (
    <ContextPage label="Activity">
      <ContextHead title="Activity" tabs={<ViewTabs view={view} />} sentence={access.state === 'loading' ? 'Loading…' : undefined} />
      {access.state === 'loading' ? <Skeleton variant="block" className="h-96 w-full" /> : <FeatureInactive feature={access.feature} icon="clock" />}
    </ContextPage>
  );
}

/** "Solutions Events" (SE), "Sales Events" (AE): the Org62 Events the persona logs. */
const loggedEventsLabel = (p: ReturnType<typeof usePersona>) => {
  const n = loggingProfile(p).recordTypeName;
  return n.endsWith('s') ? n : `${n}s`;
};

/** A numbered step of the path: its number, a verb-named title, a count and one muted line; no box. */
function PathSection({ id, n, title, count, sub, testId, children }: { id: string; n?: number; title: string; count?: string; sub?: ReactNode; testId?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} data-testid={testId} className="flex min-w-0 scroll-mt-4 flex-col gap-3 border-t border-line pt-5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        {n ? (
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-sunken text-caption font-bold text-fg tabular-nums" aria-hidden>
            {n}
          </span>
        ) : null}
        <h2 id={`${id}-h`} className="text-lead font-bold text-fg-heading">
          {title}
        </h2>
        {count ? <span className="text-body text-muted tabular-nums">{count}</span> : null}
        {sub ? <span className="min-w-0 text-caption text-muted">{sub}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** Where a count jumps: Needs you, Log it, or Weeks (the week's rows). */
const JUMP: Record<string, string> = { needs: 'time-needs', ready: 'time-logit', apply: 'time-logit', tell: 'time-logit', way: 'time-logit', internal: 'time-internal', rows: 'time-rows' };

/**
 * The quarter path both Log it and Needs you work on: this week's payload (its canvases, the quarter), the quarter's
 * rows, and from them the path (needs you, the steps), the header's numbers and the logging gap.
 */
function useQuarterPath() {
  const wording = usePromptWording();
  const tz = useTimeZone();
  const now = useNow().toISOString();
  const cur = useApi('getTime', { query: { week: undefined } });
  const settings = useApi('getSettings');
  const { rows, verifiedH, loaded } = useQuarterRows(cur.data);
  const [copiedFor, markCopied] = useConfirmCopied();
  const dcPending = useDcPending();
  const ucPending = useUcPending();
  const approveComplete = settings.data?.time?.logging?.approveComplete ?? true;
  const path = useMemo(
    // 2026-11-13 audit C2: the path waits for the DC and use-case counts (null while they load): no "Nothing ready" flash.
    // 2026-11-16: and for the quarter's rows: on this week's alone, Log it said "Log this row" for a few seconds while
    // 71 rows were ready (its button logs every ready row).
    () => (cur.data && loaded && dcPending !== null && ucPending !== null ? logPath({ rows, week: cur.data, nowIso: now, tz, confirmCopiedFor: copiedFor, dcPending, ucPending, taskTypeRequired: wording.taskType, approveComplete, recordTypeName: wording.recordTypeName }) : null),
    [cur.data, loaded, rows, now, tz, copiedFor, dcPending, ucPending, wording.taskType, wording.recordTypeName, approveComplete],
  );
  const truth = useMemo(() => (cur.data && path ? quarterTruth({ rows, week: cur.data, nowIso: now, tz }, path, verifiedH) : null), [cur.data, path, rows, now, tz, verifiedH]);
  // 2026-11-13 audit C3: approved hours Org62 has not confirmed, over the quarter's rows (not only this week's)
  const gap = useMemo(() => (cur.data && loaded ? loggingGap({ entries: rows, org62: cur.data.org62, canvas: cur.data.canvas }, now) : null), [cur.data, loaded, rows, now]);
  return { cur, rows, path, truth, gap, dcPending, ucPending, markCopied, wording, tz, now };
}

/** Open a row in the docked panel; "show it" opens Weeks on the row's week with the row highlighted. */
function useRowNav(rows: readonly ActivityEntry[]) {
  const { open: openDetails } = useDetails();
  const byId = useMemo(() => new Map(rows.map((e) => [e.id, e] as const)), [rows]);
  const openRow = useCallback(
    (id: string) => {
      const e = byId.get(id);
      openDetails({ kind: 'activity_entry', id, label: e?.description || 'Activity row' });
    },
    [byId, openDetails],
  );
  const showRows = useCallback(
    (list: string[]) => {
      const e = list.map((id) => byId.get(id)).find(Boolean);
      if (!e) return;
      navigate(`${hrefForWeek(mondayOf(e.date))}&row=${encodeURIComponent(e.id)}`);
    },
    [byId],
  );
  return { openRow, showRows };
}

/**
 * Log it (?view=week) and Needs you (?view=needs): the quarter path, no week. Log it: the quarter header, the Log it
 * steps (one primary button) with a link to what waits under Needs you, Internal rows and Use cases in Org62. Needs
 * you: the rows that can't log yet (inline and bulk fixes) and the use cases with a question.
 */
function QuarterView({ view }: { view: 'week' | 'needs' }) {
  const persona = usePersona();
  const health = useApi('getHealth');
  const { cur, rows, path, truth, gap, dcPending, ucPending, markCopied, wording, tz, now } = useQuarterPath();
  const { openRow, showRows } = useRowNav(rows);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dryRun = health.data?.dryRun ?? true;
  const vdpOn = featureActive(persona, 'vdp');
  const ucs = useApi('getUseCaseLandings', undefined, { enabled: vdpOn });
  const ucQuestions = (ucs.data?.items ?? []).filter((x) => x.question);

  // a count's jump: scroll to its section on this tab, else open the tab that has it (Needs you, Log it or Weeks)
  const jump = useCallback(
    (to: string) => {
      const id = JUMP[to] ?? 'time-logit';
      const el = document.getElementById(id);
      if (el) return el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      navigate(id === 'time-rows' ? hrefForWeek(null) : hrefForView(id === 'time-needs' ? 'needs' : 'week', persona));
    },
    [persona],
  );

  const canvasUrl = useWorkOrderCanvasUrl();
  useCommands([
    ...(canvasUrl ? [{ id: 'time.canvas', title: 'Open the work-order canvas', group: 'Activity', run: () => window.open(canvasUrl, '_blank', 'noreferrer') }] : []),
    { id: 'time.needs', title: 'Activity: rows that need you', group: 'Activity', run: () => navigate(hrefForView('needs', persona)) },
    { id: 'time.weeks', title: 'Activity: this week’s rows', group: 'Activity', run: () => navigate(hrefForWeek(null)) },
  ]);
  useEffect(() => () => clearChatContext({ kind: 'activity_entry', id: 'time' }), []);
  useEffect(() => {
    if (cur.data) setChatContext({ kind: 'activity_entry', id: 'time', label: `Activity · ${cur.data.quarter.label}` });
  }, [cur.data]);

  const needsN = path?.needs.ids.length ?? 0;
  const next = path?.current?.step;
  const quarter = cur.data?.quarter.label ?? null;
  const sentence = path
    ? view === 'week'
      ? `${quarter ?? 'This quarter'} · ${needsN ? `${rowsWord(needsN)} ${needsN === 1 ? 'needs' : 'need'} you` : 'nothing needs you'}${next ? ` · next: ${next.id === 'confirm' ? 'tell Slackbot' : next.verb}` : ''}`
      : `${quarter ?? 'This quarter'} · ${needsN ? `${rowsWord(needsN)} · ${fmtH(path.needs.hours)}` : 'no rows wait on you'}${ucQuestions.length ? ` · ${ucQuestions.length === 1 ? '1 use case' : `${ucQuestions.length} use cases`}` : ''}`
    : 'Loading the quarter…';
  const tabs = <TimeTabs view={view} needsCount={needsN + ucQuestions.length || undefined} />;

  return (
    <DomainClock now={now} tz={tz}>
      <ContextPage label="Activity" className="cc-scroll overflow-y-auto [scrollbar-gutter:stable]">
        <ContextHead title="Activity" tabs={tabs} sentence={sentence} />
        <div ref={rootRef} className="flex min-w-0 shrink-0 flex-col gap-6">
          <PanelBoundary name="time">
            {view === 'week' ? (
              <>
                {truth && cur.data ? <QuarterHeader truth={truth} due={cur.data.quarter.due} now={now} tz={tz} onJump={jump} gap={gap} onShowGap={showRows} queued={{ dcs: dcPending ?? 0, useCases: ucPending ?? 0 }} /> : <Skeleton variant="block" className="h-44 w-full" />}
                <PathSection
                  id="time-logit"
                  title="Log it"
                  sub={
                    needsN && path ? (
                      <button type="button" className="font-bold text-link hover:underline" onClick={() => jump('needs')} data-testid="time-needs-link">
                        {`${fmtH(path.needs.hours)} more waiting on you →`}
                      </button>
                    ) : (
                      'Log what is ready to Slackbot, then follow each run: Apply → Tell Slackbot → In Org62'
                    )
                  }
                  testId="time-logit"
                >
                  {path && cur.data ? <LogIt path={path} week={cur.data} rows={rows} now={now} tz={tz} dryRun={dryRun} onShow={showRows} onOpen={openRow} onNeeds={() => jump('needs')} markCopied={markCopied} scope={SCOPE} /> : <Skeleton variant="block" className="h-40 w-full" />}
                  {/* D-64: internal-only work the app suggests, quiet: Log or Dismiss (never counted as needing you) */}
                  {path?.internal.rows.length ? <InternalRows group={path.internal} tz={tz} onOpen={openRow} onShow={showRows} /> : null}
                  {/* D-67: use cases only you can settle on the Org62 side (VDP-side ones are items in Activity ▸ VDP) */}
                  <UseCaseSync />
                </PathSection>
              </>
            ) : (
              <>
                <PathSection
                  id="time-needs"
                  title="Needs you"
                  count={path && needsN ? `${rowsWord(needsN)} · ${fmtH(path.needs.hours)}` : undefined}
                  sub={needsN ? 'These can’t log until you settle what each one says is missing. Accept the suggestion, or pick it yourself; fixed rows move to Log it.' : 'No row waits on you: every row can log'}
                  testId="time-needs"
                >
                  {path ? <NeedsYou needs={path.needs} tz={tz} taskTypeRequired={wording.taskType} taskTypes={wording.taskTypes} internalActivity={wording.internal} onOpen={openRow} onShow={showRows} /> : <Skeleton variant="block" className="h-24 w-full" />}
                </PathSection>
                {/* D-70: use cases with a question (the opp it goes on, a name, an account, a value to pick) */}
                {vdpOn && ucQuestions.length ? (
                  <PathSection id="time-needs-ucs" title="Use cases" count={`${ucQuestions.length}`} sub="Answer these and they move to Log it ▸ Ready to log." testId="time-needs-ucs">
                    <UseCaseQuestions items={ucQuestions} />
                  </PathSection>
                ) : null}
              </>
            )}
          </PanelBoundary>
        </div>
      </ContextPage>
    </DomainClock>
  );
}

/** The week picker: the quarter's weeks and the one before, each with the hours found and how much is in Org62. */
function WeekPicker({ groups, value, onPick }: { groups: WeekGroup[]; value: string; onPick: (monday: string) => void }) {
  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // the picked week in view, once the weeks are there (a ?week= link may open an early one)
    scroller.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [value, groups.length]);
  if (!groups.length) return <Skeleton variant="block" className="h-16 w-full" />;
  return (
    <div ref={scroller} role="radiogroup" aria-label="Week" data-testid="weeks-picker" className="cc-scroll flex min-w-0 gap-4 overflow-x-auto pb-1">
      {groups.map((g) => (
        <div key={g.quarter} className="flex shrink-0 flex-col gap-1.5" role="group" aria-label={g.quarter}>
          <span className="text-caption font-bold text-muted">{g.quarter}</span>
          <div className="flex gap-1.5">
            {g.weeks.map((w) => {
              const on = w.monday === value;
              return (
                <button
                  key={w.monday}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-week={w.monday}
                  onClick={() => onPick(w.monday)}
                  title={`Week of ${w.label}: ${fmtH(w.hours)} found, ${fmtH(w.loggedH)} in Org62`}
                  className={cn('flex shrink-0 flex-col gap-1 rounded-lg border px-2.5 py-1.5 text-left', w.current ? 'w-32' : 'w-28', 'transition-colors focus-visible:outline-none focus-visible:shadow-focus', on ? 'border-accent bg-selected' : 'border-line bg-surface hover:bg-surface-muted')}
                >
                  <span className="flex min-w-0 items-baseline gap-1">
                    <span className="text-caption font-bold whitespace-nowrap text-fg-heading">{w.label}</span>
                    {w.current ? <span className="text-caption whitespace-nowrap text-muted">this week</span> : null}
                  </span>
                  <span className="text-caption text-muted tabular-nums">{w.hours ? `${w.loggedH} / ${fmtH(w.hours)}` : '—'}</span>
                  <span className="block h-1 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
                    <i className="block h-full rounded-full bg-accent" style={{ width: `${w.pct}%` }} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Weeks (?view=weeks): what the app found, week by week. The picker on top (any week; the arrows step), then the
 * week's Suggested (what the app proposed and where it is now, onsite days, Week at a glance) and the week's rows.
 */
function WeeksView() {
  const persona = usePersona();
  const params = useSearchParams();
  const pathname = usePathname();
  const weekParam = params.get('week') ?? undefined;
  const rowParam = params.get('row');
  const tz = useTimeZone();
  const now = useNow().toISOString();
  const { open: openDetails } = useDetails();
  const q = useApi('getTime', { query: { week: weekParam } });
  const { cur, path } = useQuarterPath();
  const settings = useApi('getSettings');
  const wh = settings.data?.profile.workingHours;
  const work = useMemo(() => ({ start: hhmmToMin(wh?.start, DEFAULT_WORK.start), end: hhmmToMin(wh?.end, DEFAULT_WORK.end), days: wh?.days }), [wh?.start, wh?.end, wh?.days]);
  const range = cur.data ? pickerRange(cur.data.quarter.label, cur.data.weekEnd) : null;
  const pickerLog = useApi('getActivityLog', { query: range ?? {} }, { enabled: !!range, staleTime: 60_000 });
  const groups = useMemo(() => (cur.data ? weekGroups(pickerLog.data, cur.data.quarter.label, cur.data.weekStart) : []), [pickerLog.data, cur.data]);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const week = q.data;
  const state = usePanelState('time.page', { loading: q.isLoading, error: q.data ? null : q.error, empty: !!week && week.entries.length === 0 && week.timeline.every((l) => l.blocks.length === 0) });
  const suggested = useMemo(() => (week && path ? weekSuggested(week.entries, path, cur.data?.logCanvases) : null), [week, path, cur.data?.logCanvases]);

  const goWeek = useCallback(
    (to: string | null) => {
      const sp = new URLSearchParams(params.toString());
      sp.set('view', 'weeks');
      sp.delete('row');
      if (to && to !== cur.data?.weekStart) sp.set('week', to);
      else sp.delete('week');
      navigate(`${pathname}?${sp}`, { replace: true });
    },
    [params, pathname, cur.data?.weekStart],
  );

  const ids = useMemo(() => (week ? [...week.entries].filter((e) => e.status !== 'dismissed').sort((a, b) => a.start.localeCompare(b.start)).map((e) => e.id) : []), [week]);
  const byId = useMemo(() => new Map((week?.entries ?? []).map((e) => [e.id, e] as const)), [week]);
  const openRow = useCallback(
    (id: string) => {
      const e = byId.get(id);
      if (!e) return;
      setSelected(id);
      openDetails({ kind: 'activity_entry', id, label: e.description || 'Activity row' });
    },
    [byId, openDetails],
  );
  const showRows = useCallback((list: string[]) => {
    const id = list[0];
    if (!id) return;
    setHighlight(id);
    setSelected(id);
    requestAnimationFrame(() => document.querySelector(`[data-activity-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    window.setTimeout(() => setHighlight(null), 2500);
  }, []);
  // ?row= (a "show it" from Log it, Needs you or a panel): the row lights up once its week is here
  const shownRow = useRef<string | null>(null);
  useEffect(() => {
    if (!rowParam || shownRow.current === rowParam || !byId.has(rowParam)) return;
    shownRow.current = rowParam;
    showRows([rowParam]);
  }, [rowParam, byId, showRows]);

  const jump = useCallback(
    (to: string) => {
      const id = JUMP[to] ?? 'time-logit';
      const el = document.getElementById(id);
      if (el) return el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      navigate(hrefForView(id === 'time-needs' ? 'needs' : 'week', persona));
    },
    [persona],
  );

  useContextKeys({ scope: SCOPE, rootRef, ids, selected: selected && ids.includes(selected) ? selected : null, setSelected, enabled: state === 'ready', onOpen: openRow });

  useCommands([
    { id: 'time.prev', title: 'Previous week', group: 'Activity', run: () => week && goWeek(shiftWeek(week.weekStart, -1)) },
    { id: 'time.next', title: 'Next week', group: 'Activity', run: () => week && goWeek(shiftWeek(week.weekStart, 1)) },
    { id: 'time.this', title: 'This week', group: 'Activity', run: () => goWeek(null) },
    { id: 'time.needs', title: 'Activity: rows that need you', group: 'Activity', run: () => navigate(hrefForView('needs', persona)) },
  ]);

  useEffect(() => () => clearChatContext({ kind: 'activity_entry', id: 'time' }), []);
  useEffect(() => {
    if (week) setChatContext({ kind: 'activity_entry', id: 'time', label: `Activity · week of ${week.weekStart}` });
  }, [week]);

  const isThisWeek = !weekParam || weekParam === cur.data?.weekStart;
  const weekRange = week ? `${dayLabel(`${week.weekStart}T12:00:00Z`, 'UTC')} to ${dayLabel(`${week.weekEnd}T12:00:00Z`, 'UTC')}` : null;
  const sentence = weekRange ? `${weekRange}${isThisWeek ? ' · this week' : ''} · ${rowsWord(ids.length)}` : 'Loading the week…';

  return (
    <DomainClock now={now} tz={tz}>
      <ContextPage label="Activity" className="cc-scroll overflow-y-auto [scrollbar-gutter:stable]">
        <ContextHead
          title="Activity"
          tabs={<TimeTabs view="weeks" />}
          sentence={sentence}
          actions={
            <div className="flex items-center gap-1">
              <IconButton icon="chevronleft" label="Previous week" onClick={() => week && goWeek(shiftWeek(week.weekStart, -1))} />
              <Button size="sm" variant="quiet" disabled={isThisWeek} onClick={() => goWeek(null)}>
                This week
              </Button>
              <IconButton icon="chevronright" label="Next week" onClick={() => week && goWeek(shiftWeek(week.weekStart, 1))} />
            </div>
          }
        />
        <div ref={rootRef} className="flex min-w-0 shrink-0 flex-col gap-6">
          <WeekPicker groups={groups} value={week?.weekStart ?? weekParam ?? cur.data?.weekStart ?? ''} onPick={(m) => goWeek(m)} />
          <PanelBoundary name="time">
            <PathSection id="time-suggested" title="What the app found" sub={weekRange ? `${weekRange} · from your calendar, onsite days, Drive, Slack and Claude sessions. It says where those rows are now; what needs you is under Needs you.` : undefined} testId="time-suggested">
              {state === 'error' ? (
                <PanelError title="Couldn't load this week" error={q.error ?? new Error('Forced error state')} onRetry={() => void q.refetch()} />
              ) : state === 'loading' || !week || !suggested ? (
                <TimeBodySkeleton />
              ) : state === 'empty' ? (
                <EmptyState icon="clock" title="Nothing found for this week" body="Meetings, Claude sessions, Drive edits and Slack bursts appear here as they are scanned." />
              ) : (
                <SuggestedWeek week={week} s={suggested} isThisWeek={isThisWeek} now={now} tz={tz} work={work} onOpenActivity={(id) => showRows([id])} onJump={jump} />
              )}
            </PathSection>

            {week && state === 'ready' ? (
              <section id="time-rows" aria-labelledby="time-rows-h" className="min-w-0 scroll-mt-4">
                <Pane aria-label="Activity log" head={<SectionHead id="time-rows-h" title={isThisWeek ? 'This week’s rows' : 'That week’s rows'} count={ids.length} sub={`Every row of the week, as it will be logged (Org62 ${loggedEventsLabel(persona)}). Change any field here and it saves (rows in Org62 are read only; an edit takes a row off a canvas waiting for Apply). Click a row for its details.`} />} scroll={false}>
                  <ActivityTable
                    entries={week.entries}
                    now={now}
                    tz={tz}
                    highlightId={highlight}
                    selectedId={selected}
                    onSelect={(e) => openRow(e.id)}
                    onFocusEntry={(e) => setChatContext(e ? { kind: 'activity_entry', id: e.id, label: e.description || 'Activity row' } : null)}
                  />
                </Pane>
              </section>
            ) : null}
          </PanelBoundary>
        </div>
      </ContextPage>
    </DomainClock>
  );
}
