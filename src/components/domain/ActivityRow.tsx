'use client';
/**
 * ActivityRow (Time, UI-SPEC §12, R-UI-6): one editable activity-log row.
 * when (date · start–end) · hours · description · opportunity (WhatId) · SE task type · CF/CR · status (with the
 * row's warning, its sources and the autosave state as quiet lines). Autosave per row (§8): the row calls onChange
 * with a patch on change/blur and the parent debounces, saves optimistically and renders <InlineStatus> into
 * `statusSlot`. Times are shown and edited in the profile timezone.
 *
 * Layout (docs/ui/time-redesign.md): the grid follows the width of the list it sits in (`ACTIVITY_ROWS`, a
 * container): one line when wide, two or three when narrow; descriptions and opportunity names wrap to two lines
 * with the full text as the tooltip. Nothing is cut off and nothing scrolls sideways. Calm fields; colour only where
 * the row needs you (a missing opportunity is amber, a failed verify red, a proposal violet).
 */
import type { ActivityEntry, SourceRef } from '@/contract';
import { isOverlapInfo } from '@/engines/activity/overlap-flags';
import { plainIssue, plainIssues } from '@/lib/time-issues';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn, Combobox, Icon } from '@/ui';
import { SourceChip, StatusBadge, TONE_TO_BADGE, useClock } from './lib';
import { clock, zonedIso } from './lib/time';
import { ACTIVITY_META } from './vocab';
import g from './activity-row.module.css';

export type ActivityPatch = Partial<Pick<ActivityEntry, 'date' | 'start' | 'end' | 'durationH' | 'taskType' | 'oppId' | 'meetingType' | 'description' | 'internal'>>;

/** The row grid (./activity-row.module.css): one, two or three lines by the width of the list it sits in. */
export const ACTIVITY_COLS = g.grid;
/** Put on the list (table) that holds the rows: the container the row grid follows. */
export const ACTIVITY_ROWS = g.rows;
/** Grid areas, for rows that render their own cells (the Ledger's read-only rows). */
export const ACTIVITY_AREA = { when: g.when, hours: g.hours, desc: g.desc, opp: g.opp, type: g.type, cfcr: g.cfcr, status: g.status } as const;

export interface ActivityRowProps {
  entry: ActivityEntry;
  /** SE task-type vocabulary (team pack). The current value is always kept. */
  taskTypes?: string[];
  /**
   * D-55: the persona's Events need an SE task type (the SE's Solutions Events; default). Without (an AE's Sales
   * Events) an empty type is calm "Not needed", never the amber "needs you".
   */
  taskTypeRequired?: boolean;
  /** Opportunities to map to (WhatId), when no `oppField` is given: a local type-to-filter combobox. */
  opps?: Array<{ id: string; label: string }>;
  /**
   * The Opportunity field itself (Time: OppPicker, ranked for the row with an Org62 search). Gets the field's look
   * (calm, or the amber "needs opp" pair) and whether the row is editable.
   */
  oppField?: (p: { className: string; disabled: boolean }) => ReactNode;
  /** Autosave status ("Saved · 2s ago" / "Saving…" / "Couldn't save · Retry"): FE-1a InlineStatus. */
  statusSlot?: ReactNode;
  readOnly?: boolean;
  className?: string;
  onChange?: (patch: ActivityPatch, entry: ActivityEntry) => void;
  onOpenSource?: (s: SourceRef, entry: ActivityEntry) => void;
}

/** A field's look without a width (cn only joins classes, so a width added after `w-full` would lose to it). */
const FIELD_BOX = 'h-9 min-w-0 rounded-md border bg-transparent px-2 text-body hover:border-line focus:border-accent focus:bg-surface-input focus:outline-none disabled:hover:border-transparent';
const FIELD = `${FIELD_BOX} w-full`;
/** The calm field colours; a field that needs you swaps in the warning pair instead (one class per property). */
const CALM = 'border-transparent text-fg';
const NO_PICKER = '[&::-webkit-calendar-picker-indicator]:hidden';
const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

export function ActivityRowHeader({ className }: { className?: string }) {
  return (
    <div role="row" className={cn(g.grid, g.head, 'min-h-10 border-b border-line bg-surface-muted px-4 py-2 text-caption font-bold text-muted', className)}>
      <span className={cn(g.when, 'px-1.5')}>When</span>
      <span className={cn(g.hours, 'px-1.5 text-right')}>Hours</span>
      <span className={cn(g.desc, 'px-1.5')}>
        Description<span className={g.narrowOnly}> · opportunity</span>
      </span>
      <span className={cn(g.opp, g.wideOnly, 'px-1.5')}>Opportunity</span>
      <span className={cn(g.type, g.wideOnly, 'px-1.5')}>Task type</span>
      <span className={cn(g.cfcr, g.wideOnly)}>CF / CR</span>
      <span className={g.status}>Status</span>
    </div>
  );
}

/**
 * The one status column: a word, coloured only when the row needs you (amber needs input, red failed) or the app
 * proposed it (violet, no box); done rows are a muted word with a green check; the rest plain text.
 */
export function ActivityStatusWord({ status, label }: { status: ActivityEntry['status']; label?: string }) {
  const meta = ACTIVITY_META[status];
  const text = label ?? meta.label;
  if (meta.tone === 'warn' || meta.tone === 'risk')
    return (
      <StatusBadge tone={TONE_TO_BADGE[meta.tone]} icon="warning">
        {text}
      </StatusBadge>
    );
  if (meta.tone === 'ai')
    return (
      <span className="inline-flex items-center gap-1 text-caption font-bold whitespace-nowrap text-ai-700">
        <span aria-hidden>✦</span>
        {text}
      </span>
    );
  if (meta.tone === 'ok')
    return (
      <span className="inline-flex items-center gap-1 text-caption whitespace-nowrap text-fg">
        <Icon name="check" size="xs" className="text-success-700" />
        {text}
      </span>
    );
  return <span className={cn('text-caption whitespace-nowrap', meta.tone === 'brand' ? 'text-fg' : 'text-muted')}>{text}</span>;
}

function fromEntry(e: ActivityEntry, tz?: string) {
  return { date: e.date, start: clock(e.start, tz), end: clock(e.end, tz), durationH: String(e.durationH), description: e.description };
}

/** The fallback Opportunity field: the given opps, filtered by what you type (the Time page passes OppPicker instead). */
function LocalOppField({ entry, opps, className, disabled, onPick }: { entry: ActivityEntry; opps: Array<{ id: string; label: string }>; className: string; disabled: boolean; onPick: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const options = [
    ...opps.filter((o) => words.every((w) => o.label.toLowerCase().includes(w))).map((o) => ({ key: o.id, label: o.label })),
    ...(entry.oppId && !words.length ? [{ key: '', label: 'No opportunity', group: 'Other' }] : []),
  ];
  return (
    <Combobox
      label="Opportunity"
      value={entry.oppId ? (entry.oppName ?? entry.oppId) : 'Needs opp…'}
      title={entry.accountName ?? undefined}
      disabled={disabled}
      triggerClassName={className}
      options={options}
      query={q}
      onQueryChange={setQ}
      selectedKey={entry.oppId}
      onPick={(o) => onPick(o.key || null)}
      placeholder="Find an opportunity"
      empty="No opportunity matches."
    />
  );
}

export function ActivityRow({ entry, taskTypes = [], taskTypeRequired = true, opps = [], oppField, statusSlot, readOnly, className, onChange, onOpenSource }: ActivityRowProps) {
  const { tz } = useClock();
  const [base, setBase] = useState(`${entry.id}@${entry.version}`);
  const [d, setD] = useState(() => fromEntry(entry, tz));
  if (base !== `${entry.id}@${entry.version}`) {
    setBase(`${entry.id}@${entry.version}`);
    setD(fromEntry(entry, tz));
  }
  // "overlaps '<other>' 12:30–13:00 (both log)" is information (D-18 amended): muted, never a warning
  const notes = entry.issues.filter(isOverlapInfo);
  const warnings = entry.issues.filter((i) => !isOverlapInfo(i));
  const locked = new Set(entry.userLockedFields);
  const types = entry.taskType && !taskTypes.includes(entry.taskType) ? [entry.taskType, ...taskTypes] : taskTypes;
  const oppList = entry.oppId && !opps.some((o) => o.id === entry.oppId) ? [{ id: entry.oppId, label: entry.oppName ?? entry.oppId }, ...opps] : opps;
  const emit = (p: ActivityPatch) => onChange?.(p, entry);
  // D-64: internal-only work has no opportunity by design
  const needsOpp = !entry.oppId && !entry.internal;
  const disabled = !!readOnly || entry.status === 'logged' || entry.status === 'verified';
  // the opportunity wraps to two lines (OppPicker), so its field grows with it
  const oppClass = cn(FIELD, 'h-auto min-h-9 py-1', needsOpp ? 'border-dashed border-warning-500 text-warning-700' : CALM);

  const commitTimes = () => {
    if (!HHMM.test(d.start) || !HHMM.test(d.end) || !d.date) {
      setD(fromEntry(entry, tz));
      return;
    }
    const start = zonedIso(d.date, d.start, tz);
    const end = zonedIso(d.date, d.end, tz);
    if (start !== entry.start || end !== entry.end || d.date !== entry.date) {
      const hours = Math.max(0, Math.round(((Date.parse(end) - Date.parse(start)) / 3_600_000) * 4) / 4);
      setD((x) => ({ ...x, durationH: String(hours) }));
      emit({ date: d.date, start, end, durationH: hours });
    }
  };

  return (
    <div role="row" data-row className={cn(ACTIVITY_COLS, 'min-h-12 border-b border-line px-4 py-1.5 last:border-b-0 hover:bg-surface-muted', className)}>
      <span className={cn(g.when, 'flex min-w-0 items-center')}>
        <input type="date" aria-label="Date" disabled={disabled} value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} onBlur={commitTimes} className={cn(FIELD_BOX, CALM, NO_PICKER, 'w-[6.75rem] shrink-0 text-muted tabular-nums')} />
        <input inputMode="numeric" aria-label="Start (24 h)" placeholder="hh:mm" disabled={disabled} value={d.start} onChange={(e) => setD({ ...d, start: e.target.value })} onBlur={commitTimes} className={cn(FIELD_BOX, CALM, 'w-[3.75rem] shrink-0 px-1 text-center tabular-nums')} />
        <span className="text-faint">–</span>
        <input inputMode="numeric" aria-label="End (24 h)" placeholder="hh:mm" disabled={disabled} value={d.end} onChange={(e) => setD({ ...d, end: e.target.value })} onBlur={commitTimes} className={cn(FIELD_BOX, CALM, 'w-[3.75rem] shrink-0 px-1 text-center tabular-nums')} />
      </span>
      <input
        type="number"
        aria-label="Hours"
        step={0.25}
        min={0}
        disabled={disabled}
        value={d.durationH}
        onChange={(e) => setD({ ...d, durationH: e.target.value })}
        onBlur={() => {
          const v = Math.round(Number(d.durationH) * 4) / 4;
          if (Number.isFinite(v) && v !== entry.durationH) emit({ durationH: v });
        }}
        className={cn(g.hours, FIELD, CALM, 'text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none', locked.has('durationH') && 'font-bold')}
      />
      <span className={cn(g.desc, 'min-w-0')}>
        <DescriptionField value={d.description} disabled={disabled} onChange={(v) => setD({ ...d, description: v })} onCommit={() => d.description !== entry.description && emit({ description: d.description })} />
      </span>
      <span className={cn(g.opp, 'min-w-0')}>
        {oppField ? oppField({ className: oppClass, disabled }) : <LocalOppField entry={entry} opps={oppList} className={oppClass} disabled={disabled} onPick={(id) => emit({ oppId: id })} />}
      </span>
      <select
        aria-label="Task type"
        disabled={disabled}
        value={entry.taskType ?? ''}
        onChange={(e) => emit({ taskType: e.target.value || null })}
        title={taskTypeRequired ? (entry.taskType ?? undefined) : 'Your role logs Events with no task type'}
        className={cn(g.type, FIELD, 'max-w-[16rem]', entry.taskType ? CALM : taskTypeRequired ? 'border-transparent text-warning-700' : 'border-transparent text-faint')}
      >
        <option value="">{taskTypeRequired ? 'Choose type…' : 'Not needed'}</option>
        {types.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {/* two quiet words; only the chosen one is filled (no box around the pair) */}
      <span className={cn(g.cfcr, 'inline-flex h-8 items-center gap-0.5')} role="radiogroup" aria-label="Customer-facing or customer-related">
        {(['CF', 'CR'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={entry.meetingType === m}
            disabled={disabled}
            title={m === 'CF' ? 'Customer-facing' : 'Customer-related (internal prep)'}
            onClick={() => emit({ meetingType: m })}
            className={cn('h-7 rounded-sm px-2 text-caption font-bold focus-visible:outline-none focus-visible:shadow-focus', entry.meetingType === m ? 'border border-line-strong bg-selected text-fg-heading' : 'text-muted hover:bg-surface-muted hover:text-fg')}
          >
            {m}
          </button>
        ))}
      </span>
      <span className={cn(g.status, 'flex min-w-0 flex-col items-start gap-0.5 py-0.5')}>
        <ActivityStatusWord status={entry.status} />
        {warnings.length ? (
          <span className="flex min-w-0 max-w-full items-start gap-1 self-stretch text-caption text-warning-700" title={plainIssues(entry).join(' · ')}>
            <Icon name="warning" size="xs" className="mt-0.5 shrink-0" />
            <span className="line-clamp-2 min-w-0 break-words [overflow-wrap:anywhere]">{plainIssue(warnings[0]!, entry) ?? warnings[0]}</span>
          </span>
        ) : notes.length ? (
          <span className="line-clamp-2 max-w-full self-stretch text-caption break-words text-muted" title={notes.join(' · ')} data-testid="activity-overlap-note">
            {notes[0]}
          </span>
        ) : null}
        {/* quiet metadata: where it came from, and the save state */}
        <span className="flex min-w-0 items-center gap-1 text-caption text-muted">
          {entry.sources.slice(0, 2).map((s, i) => (
            <SourceChip key={`${s.kind}:${i}`} source={s} compact onOpen={onOpenSource ? (src) => onOpenSource(src, entry) : undefined} />
          ))}
          <span className="min-w-0 truncate">{statusSlot}</span>
        </span>
      </span>
    </div>
  );
}

/**
 * The description: wraps to two lines (the full text is the tooltip, and a fade says there is more), and grows to
 * six while you edit it. Enter saves, like the one-line field it replaces; it never adds a line break.
 */
function DescriptionField({ value, disabled, onChange, onCommit }: { value: string; disabled: boolean; onChange: (v: string) => void; onCommit: () => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const cs = getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight) || 24;
      const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
      const chrome = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) + border;
      el.style.height = 'auto';
      const want = el.scrollHeight + border;
      if (!want) return; // not laid out (jsdom, hidden): keep the CSS height
      const max = (open ? 6 : 2) * lh + chrome;
      el.style.height = `${Math.min(want, max)}px`;
      setClipped(!open && want > max + 1);
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === w) return;
      w = el.clientWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, open]);
  return (
    <textarea
      ref={ref}
      aria-label="Description"
      rows={1}
      disabled={disabled}
      value={value}
      title={value || undefined}
      data-clipped={clipped ? '' : undefined}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))}
      onFocus={() => setOpen(true)}
      onBlur={() => {
        setOpen(false);
        onCommit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className={cn(FIELD, CALM, 'block h-9 resize-none overflow-hidden py-1.5 leading-6 break-words', 'data-[clipped]:[mask-image:linear-gradient(to_bottom,black_55%,transparent)]', 'focus:overflow-y-auto')}
    />
  );
}
