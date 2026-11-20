'use client';
/**
 * Time ▸ Ledger's overview (?view=log), over GET /time/ledger: reporting first, line items one click deeper.
 *
 *   QuarterPicker     the fiscal quarters oldest → newest (FY starts 1 Feb), each with its logged vs target, then All;
 *                     the current quarter is the default
 *   LedgerTracking    the quarter against its target as one segmented meter by the one count map (in Org62 · on its
 *                     way · suggested · needs input), what is verified, hours to go and the pace (the current quarter);
 *                     waiting on you (Time's quarter truth, the same numbers as Log it), excluded rows, earlier hours.
 *                     All quarters: each quarter's line, a click picks it
 *   LedgerBreakdowns  where the hours went: by account with its opportunities (internal and no-account lines of their
 *                     own), and by task type; hours, rows and share per line, a thin two-state bar (in Org62, not yet)
 *   LedgerChart       by week (or by quarter): one column per week, in Org62 at the baseline and not yet above it,
 *                     a tooltip per column, Chart / Table
 *
 * Every line and column is a button: it sets the rows list's filters (the drill-down below), and a second click
 * clears them. Color is state only: done (green, in Org62), waiting (neutral, not yet / on its way), the app's
 * suggestion (AI), needs you (amber); never a color per account. Validated with the dataviz palette script on both
 * surfaces (adjacent pairs pass CVD and normal-vision separation; the neutral is a deliberate state, not a hue);
 * every number is also text. Human hours only: agent time is never in these rows.
 */
import { useState, type ReactNode } from 'react';
import type { ActivityLogQuarter, TimeLedger, TimeLedgerSlice } from '@/contract';
import { StatusBadge } from '@/components/domain';
import { clock, dayLabel } from '@/components/domain/lib/time';
import { cn, SegmentedToggle, Tooltip } from '@/ui';
import { fmtH } from './derive';
import { INTERNAL_LABEL, isLaterWeek, isLineActive, lineBar, periodWords, quarterChoices, quarterTitle, shareText, shortOppName, TYPE_NONE_LABEL, UNASSIGNED_LABEL, ACCOUNT_NONE_LABEL, chartScale, type LedgerLine, type SliceFilters, type Tracking } from './ledger-derive';
import { rowsWord, type QuarterPart, type QuarterTruth } from './path-derive';

const r1 = (n: number) => Math.round(n * 10) / 10;
const LINK = 'rounded-sm font-bold text-link hover:underline focus-visible:outline-none focus-visible:shadow-focus';
const SWATCH: Record<'org62' | 'rest' | 'way' | 'suggested' | 'needs', string> = { org62: 'var(--ledger-org62)', rest: 'var(--ledger-rest)', way: 'var(--ledger-rest)', suggested: 'var(--ledger-suggested)', needs: 'var(--ledger-needs)' };

// ── The quarter picker ─────────────────────────────────────────────────────────────────────

export function QuarterPicker({ quarters, value, onPick }: { quarters: readonly ActivityLogQuarter[]; value: string | null; onPick: (v: string | null) => void }) {
  const choices = quarterChoices(quarters);
  return (
    <div role="radiogroup" aria-label="Quarter" data-testid="ledger-quarters" className="flex min-w-0 shrink-0 flex-wrap gap-2">
      {choices.map((c) => {
        const on = c.value === value || (c.value === null && value === quarters.find((q) => q.current)?.label);
        return (
          <button
            key={c.label}
            type="button"
            role="radio"
            aria-checked={on}
            data-quarter={c.value ?? 'current'}
            onClick={() => onPick(c.value)}
            className={cn('flex w-40 min-w-0 flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:shadow-focus', on ? 'border-accent bg-selected' : 'border-line bg-surface hover:bg-surface-muted')}
          >
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate text-body font-bold text-fg-heading">{c.label}</span>
              {c.current ? <span className="text-caption text-muted">now</span> : null}
            </span>
            <span className="text-caption text-muted tabular-nums">{c.sub}</span>
            {c.value !== 'all' ? (
              <span className="block h-1 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
                <i className="block h-full rounded-full bg-accent" style={{ width: `${c.pct}%` }} />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ── Tracking ───────────────────────────────────────────────────────────────────────────────

function SegmentMeter({ t }: { t: Tracking }) {
  const words = t.segments.map((s) => `${s.label} ${fmtH(s.hours)}`).join(', ');
  const target = t.targetH > 0 && t.scaleH > t.targetH ? (t.targetH / t.scaleH) * 100 : null;
  return (
    <div className="relative mt-3" role="img" aria-label={`${words}${t.targetH > 0 ? ` of a ${t.targetH} h target` : ''}`} data-testid="ledger-meter">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-sunken">
        {t.segments
          .filter((s) => s.pct > 0)
          .map((s, i) => (
            // a 2px surface gap between the states (never a border around a mark)
            <i key={s.id} data-segment={s.id} className={cn('h-full shrink-0', i > 0 && 'border-l-2 border-surface')} style={{ width: `${s.pct}%`, background: SWATCH[s.id] }} />
          ))}
      </div>
      {target !== null ? <span aria-hidden className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-fg" style={{ left: `${target}%` }} title={`Target ${t.targetH} h`} /> : null}
    </div>
  );
}

export interface LedgerTrackingProps {
  ledger: TimeLedger;
  quarter: ActivityLogQuarter | null;
  t: Tracking;
  /** Time's quarter truth over the quarter's rows (null while it loads, or for all quarters). */
  truth: QuarterTruth | null;
  tz?: string;
  /** A waiting part: where you act on it (Log it or Needs you), or its rows below (a past quarter). */
  onWaiting: (part: QuarterPart['id']) => void;
  /** Words of the waiting parts' action ("Open Log it", "Show them below"). */
  waitingVerb: string;
  onExcluded: () => void;
  onPickQuarter: (label: string) => void;
}

export function LedgerTracking({ ledger, quarter: q, t, truth, tz, onWaiting, waitingVerb, onExcluded, onPickQuarter }: LedgerTrackingProps) {
  const target = t.targetH > 0;
  const tot = ledger.totals;
  const all = ledger.quarter === 'all';
  return (
    <section aria-labelledby="ledger-track-h" data-testid="ledger-tracking" data-ledger="" className="@container/lt flex min-w-0 shrink-0 flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="grid min-w-0 gap-x-10 gap-y-5 @min-[52rem]/lt:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id="ledger-track-h" className="text-lead font-bold text-fg-heading">
              {quarterTitle(ledger)}
            </h2>
            {q?.current && q.due ? <DueBadge due={q.due} tone={truth?.tone ?? 'none'} tz={tz} /> : null}
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-2" data-testid="ledger-logged">
            <span className="text-heading font-bold text-fg-heading">{r1(t.loggedH)} h</span>
            <span className="text-body text-muted">{target ? `in Org62 of ${t.targetH} h` : all ? 'in Org62 across every quarter' : 'in Org62'}</span>
            {target ? <span className="ml-auto text-caption text-muted tabular-nums">{t.leftH > 0 ? `${t.leftH} h to go` : 'Target met'}</span> : null}
          </div>
          <SegmentMeter t={t} />
          <ul className="mt-3 grid min-w-0 gap-x-6 gap-y-2 @min-[30rem]/lt:grid-cols-2" aria-label="Where the quarter's hours stand" data-testid="ledger-states">
            {t.segments.map((s) => (
              <li key={s.id} className="flex min-w-0 items-start gap-2" data-state={s.id}>
                <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-sm" style={{ background: SWATCH[s.id] }} />
                <span className="min-w-0">
                  <span className="text-body text-fg">
                    <span className="font-bold tabular-nums">{fmtH(s.hours)}</span> {s.phrase}
                    {s.rows ? <span className="text-caption text-muted tabular-nums">{` · ${rowsWord(s.rows)}`}</span> : null}
                  </span>
                  <span className="block text-caption text-muted">{s.hint}</span>
                </span>
              </li>
            ))}
          </ul>
          {t.projectedH > t.loggedH ? (
            <p className="mt-3 text-caption text-muted tabular-nums" data-testid="ledger-projected">
              {`${fmtH(t.projectedH)}${target ? ` of ${t.targetH} h` : ''} if everything on its way, suggested and needing input lands`}
            </p>
          ) : null}
          {truth?.pace ? (
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted tabular-nums" data-pace={truth.pace.state} data-testid="ledger-pace">
              {truth.pace.state === 'behind' ? <StatusBadge tone="warning" icon="clock">{`${Math.abs(truth.pace.deltaH)} h behind pace`}</StatusBadge> : <span className="font-bold text-fg">{truth.pace.state === 'ahead' ? `${truth.pace.deltaH} h ahead of pace` : 'On pace'}</span>}
              <span>{`${truth.pace.expectedH} h expected by today · ${truth.pace.workdaysLeft} workdays left`}</span>
            </p>
          ) : null}
        </div>

        {all ? (
          <div className="min-w-0" data-testid="ledger-quarter-lines">
            <h3 className="text-caption font-bold text-muted">Each quarter</h3>
            <ul className="mt-1 flex flex-col gap-0.5" aria-label="Quarters">
              {[...ledger.quarters].map((x) => (
                <li key={x.label}>
                  <button type="button" onClick={() => onPickQuarter(x.label)} className="grid w-full grid-cols-[5.5rem_minmax(4rem,1fr)_8rem] items-center gap-3 rounded-md px-2 py-1 text-left hover:bg-surface-muted focus-visible:outline-none focus-visible:shadow-focus">
                    <span className="text-body font-bold text-fg-heading">{x.label}</span>
                    <span className="cx-meter" aria-hidden>
                      <i style={{ width: `${x.targetH > 0 ? Math.min(100, (x.loggedH / x.targetH) * 100) : 0}%` }} />
                    </span>
                    <span className="text-right text-caption text-muted tabular-nums">
                      {r1(x.loggedH)}
                      {x.targetH > 0 ? ` of ${x.targetH}` : ''} h{x.current ? ' · now' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="min-w-0" data-testid="ledger-waiting">
            <h3 className="text-caption font-bold text-muted">Waiting on you</h3>
            {!truth ? (
              <p className="mt-1 text-body text-muted">Counting…</p>
            ) : truth.waiting.rows ? (
              <>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-2 tabular-nums">
                  <span className="text-title font-bold text-fg-heading">{fmtH(truth.waiting.hours)}</span>
                  <span className="text-body text-muted">{rowsWord(truth.waiting.rows)}</span>
                </div>
                <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-caption tabular-nums" aria-label="Where they wait">
                  {truth.waiting.parts.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => onWaiting(p.id)} data-part={p.id} className={LINK} title={waitingVerb}>
                        {`${fmtH(p.hours)} ${p.label}`}
                      </button>
                      <span className="text-muted">{` · ${rowsWord(p.rows)}`}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-1 text-body text-fg">Nothing: every row of {ledger.quarter} is in Org62 or on its way.</p>
            )}
            {truth?.onItsWay.rows ? <p className="mt-1 text-caption text-muted tabular-nums">{`${fmtH(truth.onItsWay.hours)} on its way to Org62 · ${rowsWord(truth.onItsWay.rows)}`}</p> : null}
            <Notes tot={tot} onExcluded={onExcluded} />
          </div>
        )}
      </div>
      {all ? <Notes tot={tot} onExcluded={onExcluded} /> : null}
      <p className="text-caption text-faint">Human hours only; agent time never counts.</p>
    </section>
  );
}

function Notes({ tot, onExcluded }: { tot: TimeLedger['totals']; onExcluded: () => void }) {
  if (!tot.excludedRows && !tot.earlierH) return null;
  return (
    <ul className="mt-3 flex flex-col gap-1 text-caption text-muted tabular-nums">
      {tot.earlierH ? <li data-testid="ledger-earlier">{`In Org62 includes ${fmtH(tot.earlierH)} logged before the app's rows (not in the breakdowns)`}</li> : null}
      {tot.excludedRows ? (
        <li>
          {`${rowsWord(tot.excludedRows)} excluded, never logged (${fmtH(tot.excludedH)}) · `}
          <button type="button" className={LINK} onClick={onExcluded} data-testid="ledger-excluded">
            Show them
          </button>
        </li>
      ) : null}
    </ul>
  );
}

function DueBadge({ due, tone, tz }: { due: string; tone: QuarterTruth['tone']; tz?: string }) {
  const text = `Due ${dayLabel(due, tz)} ${clock(due, tz)}`;
  if (tone === 'none') return <span className="text-caption text-muted">{text}</span>;
  return (
    <StatusBadge tone={tone} icon="clock">
      {tone === 'danger' ? `Past due · ${text.replace(/^Due /, '')}` : text}
    </StatusBadge>
  );
}

// ── Breakdowns ─────────────────────────────────────────────────────────────────────────────

/** In Org62 · Not in Org62 yet: the one legend for the bars and columns. */
function BarLegend({ className }: { className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted', className)} aria-label="Legend">
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 rounded-sm" style={{ background: SWATCH.org62 }} />
        In Org62
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 rounded-sm" style={{ background: SWATCH.rest }} />
        Not in Org62 yet
      </li>
    </ul>
  );
}

function Bar({ x, maxH }: { x: { hours: number; loggedH: number }; maxH: number }) {
  const b = lineBar(x, maxH);
  return (
    <span className="flex h-2 min-w-0 items-center" aria-hidden>
      {b.org62 > 0 ? <i className={cn('h-full rounded-l-full', b.rest <= 0 && 'rounded-r-full')} style={{ width: `${b.org62}%`, background: SWATCH.org62 }} /> : null}
      {b.rest > 0 ? <i className={cn('h-full rounded-r-full', b.org62 > 0 ? 'border-l-2 border-surface' : 'rounded-l-full')} style={{ width: `${b.rest}%`, background: SWATCH.rest }} /> : null}
    </span>
  );
}

function LineButton({ label, x, maxH, level = 0, active, onClick, testId, title }: { label: ReactNode; x: TimeLedgerSlice; maxH: number; level?: 0 | 1; active: boolean; onClick: () => void; testId: string; title: string }) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        data-testid={testId}
        title={title}
        className={cn(
          'grid w-full grid-cols-[minmax(0,1.3fr)_minmax(3rem,1fr)_auto] items-center gap-3 rounded-md px-2 text-left focus-visible:outline-none focus-visible:shadow-focus',
          level === 0 ? 'py-1.5' : 'py-1',
          active ? 'bg-selected shadow-[inset_0_0_0_1px_var(--color-accent)]' : 'hover:bg-surface-muted',
        )}
      >
        <span className={cn('min-w-0 truncate', level === 0 ? 'text-body font-bold text-fg-heading' : 'pl-4 text-caption text-fg')}>{label}</span>
        <Bar x={x} maxH={maxH} />
        <span className="text-right whitespace-nowrap tabular-nums">
          <span className={cn('font-bold', level === 0 ? 'text-body text-fg' : 'text-caption text-fg')}>{fmtH(x.hours)}</span>
          <span className="text-caption text-muted">{` · ${rowsWord(x.rows)} · ${shareText(x.share)}`}</span>
        </span>
      </button>
    </li>
  );
}

const lineTitle = (name: string, x: TimeLedgerSlice) => `${name}: ${fmtH(x.hours)} (${fmtH(x.loggedH)} in Org62), ${rowsWord(x.rows)}, ${shareText(x.share)} of the hours · show its rows`;
const ACCOUNTS_SHOWN = 8;

export function LedgerBreakdowns({ ledger, slice, onLine, showTypes }: { ledger: TimeLedger; slice: SliceFilters; onLine: (l: LedgerLine) => void; showTypes: boolean }) {
  const [allAccounts, setAllAccounts] = useState(false);
  const accounts = allAccounts ? ledger.accounts : ledger.accounts.slice(0, ACCOUNTS_SHOWN);
  const hidden = ledger.accounts.length - accounts.length;
  const maxH = Math.max(0.01, ...ledger.accounts.map((a) => a.hours), ledger.internal.hours, ledger.unassigned.hours);
  const maxT = Math.max(0.01, ...ledger.types.map((x) => x.hours));
  const is = (l: LedgerLine) => isLineActive(l, slice);
  const other = [ledger.internal.rows ? ({ kind: 'internal' } as const) : null, ledger.unassigned.rows ? ({ kind: 'unassigned' } as const) : null].filter((x): x is { kind: 'internal' } | { kind: 'unassigned' } => !!x);
  const empty = !ledger.totals.rows;
  return (
    <section aria-labelledby="ledger-where-h" data-testid="ledger-breakdowns" data-ledger="" className="@container/lb flex min-w-0 shrink-0 flex-col rounded-lg border border-line bg-surface">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 px-5 pt-4 pb-2">
        <h2 id="ledger-where-h" className="text-lead font-bold text-fg-heading">
          Where the hours went
        </h2>
        <span className="text-caption text-muted tabular-nums">{empty ? 'No rows in this quarter yet' : `${fmtH(ledger.totals.hours)} · ${rowsWord(ledger.totals.rows)} · a line shows its rows below`}</span>
        <BarLegend className="ml-auto" />
      </div>
      {empty ? null : (
        <div className={cn('grid min-w-0 gap-x-10 gap-y-6 px-5 pb-5', showTypes && '@min-[64rem]/lb:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]')}>
          <div className="min-w-0">
            <h3 className="px-2 pb-1 text-caption font-bold text-muted">By account and opportunity</h3>
            <ul className="flex flex-col gap-0.5" aria-label="By account and opportunity" data-testid="ledger-accounts">
              {accounts.map((a) => {
                const name = a.name ?? ACCOUNT_NONE_LABEL;
                const l: LedgerLine = { kind: 'account', account: a.name };
                const opps = a.opps.length > 1 || a.opps[0]?.oppId !== null ? a.opps : [];
                return (
                  <li key={a.name ?? '\u0000'} className="flex flex-col gap-0.5">
                    <ul className="flex flex-col gap-0.5">
                      <LineButton label={name} x={a} maxH={maxH} active={is(l)} onClick={() => onLine(l)} testId="ledger-account" title={lineTitle(name, a)} />
                      {opps.map((o) => {
                        const ol: LedgerLine = { kind: 'opp', account: a.name, oppId: o.oppId };
                        const oname = o.oppId ? shortOppName(o.name, a.name) : 'No opportunity';
                        return <LineButton key={o.oppId ?? '\u0000'} label={oname} x={o} maxH={maxH} level={1} active={is(ol)} onClick={() => onLine(ol)} testId="ledger-opp" title={lineTitle(o.name, o)} />;
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
            {hidden > 0 ? (
              <button type="button" className={cn(LINK, 'mt-1 px-2 text-caption')} onClick={() => setAllAccounts(true)} data-testid="ledger-more-accounts">
                {`Show ${hidden} more ${hidden === 1 ? 'account' : 'accounts'}`}
              </button>
            ) : null}
            {other.length ? (
              <ul className="mt-2 flex flex-col gap-0.5 border-t border-line pt-2" aria-label="No customer">
                {other.map((l) => {
                  const x = l.kind === 'internal' ? ledger.internal : ledger.unassigned;
                  const name = l.kind === 'internal' ? INTERNAL_LABEL : UNASSIGNED_LABEL;
                  return <LineButton key={l.kind} label={name} x={x} maxH={maxH} active={is(l)} onClick={() => onLine(l)} testId={`ledger-${l.kind}`} title={lineTitle(name, x)} />;
                })}
              </ul>
            ) : null}
          </div>
          {showTypes ? (
            <div className="min-w-0">
              <h3 className="px-2 pb-1 text-caption font-bold text-muted">By task type</h3>
              <ul className="flex flex-col gap-0.5" aria-label="By task type" data-testid="ledger-types">
                {ledger.types.map((x) => {
                  const l: LedgerLine = { kind: 'type', type: x.type };
                  const name = x.type ?? TYPE_NONE_LABEL;
                  return <LineButton key={x.type ?? '\u0000'} label={name} x={x} maxH={maxT} active={is(l)} onClick={() => onLine(l)} testId="ledger-type" title={lineTitle(name, x)} />;
                })}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

// ── The chart ──────────────────────────────────────────────────────────────────────────────

export function LedgerChart({ ledger, slice, onLine, onPickQuarter, thisWeekEnd }: { ledger: TimeLedger; slice: SliceFilters; onLine: (l: LedgerLine) => void; onPickQuarter: (label: string) => void; thisWeekEnd: string }) {
  const [mode, setMode] = useState<'chart' | 'table'>('chart');
  const { kind, items } = ledger.periods;
  const scale = chartScale(Math.max(0, ...items.map((p) => p.hours)));
  const pick = (key: string) => (kind === 'week' ? onLine({ kind: 'week', week: key }) : onPickQuarter(key));
  const active = (key: string) => kind === 'week' && isLineActive({ kind: 'week', week: key }, slice);
  const later = (p: (typeof items)[number]) => kind === 'week' && isLaterWeek(p, thisWeekEnd);
  return (
    <section aria-labelledby="ledger-chart-h" data-testid="ledger-chart" data-ledger="" className="flex min-w-0 shrink-0 flex-col rounded-lg border border-line bg-surface">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 px-5 pt-4 pb-2">
        <h2 id="ledger-chart-h" className="text-lead font-bold text-fg-heading">
          {kind === 'week' ? 'By week' : 'By quarter'}
        </h2>
        <span className="text-caption text-muted">{kind === 'week' ? 'a week shows its rows below' : 'a quarter opens it'}</span>
        <BarLegend className="ml-auto" />
        <SegmentedToggle
          label="Chart or table"
          size="sm"
          options={[
            { value: 'chart', label: 'Chart' },
            { value: 'table', label: 'Table' },
          ]}
          value={mode}
          onChange={(v) => setMode(v as 'chart' | 'table')}
        />
      </div>
      {mode === 'chart' ? (
        <div className="min-w-0 px-5 pt-2 pb-4">
          <div className="relative h-44 min-w-0">
            {/* a recessive grid: hairlines at 0, the middle and the top, labelled in muted ink */}
            {scale.ticks.map((tk) => (
              <div key={tk} aria-hidden className="absolute inset-x-0 flex items-center gap-2" style={{ bottom: `${(tk / scale.top) * 100}%` }}>
                <span className="w-10 shrink-0 translate-y-1/2 text-right text-caption text-muted tabular-nums">{`${tk} h`}</span>
                <span className="h-px flex-1 translate-y-1/2 bg-line" />
              </div>
            ))}
            <ul className="absolute inset-y-0 right-0 left-12 flex items-stretch" aria-label={kind === 'week' ? 'Weeks' : 'Quarters'}>
              {items.map((p) => {
                const on = active(p.key);
                const off = later(p);
                const org62 = (Math.min(p.loggedH, p.hours) / scale.top) * 100;
                const rest = (Math.max(0, p.hours - p.loggedH) / scale.top) * 100;
                const words = periodWords(p, kind);
                return (
                  <li key={p.key} className="flex min-w-0 flex-1">
                    <Tooltip content={off ? `${words} (not started yet)` : words}>
                      <button
                        type="button"
                        disabled={off}
                        aria-pressed={kind === 'week' ? on : undefined}
                        aria-label={words}
                        data-period={p.key}
                        onClick={() => pick(p.key)}
                        className={cn('group flex h-full w-full min-w-0 flex-col items-center justify-end rounded-md focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-default', on ? 'bg-selected' : 'enabled:hover:bg-surface-muted')}
                      >
                        {/* not yet above, in Org62 at the baseline; a 2px surface gap between them, the data end rounded */}
                        {rest > 0 ? <span aria-hidden className={cn('w-full max-w-6 rounded-t-[4px]', org62 > 0 && 'border-b-2 border-surface')} style={{ height: `${rest}%`, background: SWATCH.rest }} /> : null}
                        {org62 > 0 ? <span aria-hidden className={cn('w-full max-w-6', rest > 0 ? '' : 'rounded-t-[4px]')} style={{ height: `${org62}%`, background: SWATCH.org62 }} /> : null}
                      </button>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          </div>
          <ul aria-hidden className="ml-12 flex">
            {items.map((p) => (
              <li key={p.key} className={cn('min-w-0 flex-1 truncate pt-1 text-center text-caption tabular-nums', active(p.key) ? 'font-bold text-fg-heading' : later(p) ? 'text-faint' : 'text-muted')}>
                {p.label}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="min-w-0 px-5 pb-4">
          <table className="w-full text-body tabular-nums" data-testid="ledger-chart-table">
            <thead>
              <tr className="text-left text-caption text-muted">
                <th className="py-1 font-normal">{kind === 'week' ? 'Week' : 'Quarter'}</th>
                <th className="py-1 text-right font-normal">Hours</th>
                <th className="py-1 text-right font-normal">In Org62</th>
                <th className="py-1 text-right font-normal">Rows</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.key} className={cn('border-t border-line', active(p.key) && 'bg-selected')}>
                  <td className="py-1">
                    {later(p) ? (
                      <span className="text-faint">{p.label}</span>
                    ) : (
                      <button type="button" className={LINK} onClick={() => pick(p.key)} aria-label={periodWords(p, kind)}>
                        {p.label}
                      </button>
                    )}
                  </td>
                  <td className="py-1 text-right">{fmtH(p.hours)}</td>
                  <td className="py-1 text-right">{fmtH(p.loggedH)}</td>
                  <td className="py-1 text-right">{p.rows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
