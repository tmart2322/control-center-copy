'use client';
/**
 * Shelves: "pull forward" style rows (DESIGN-V2; mockup today.html Fit-ins and "Pull forward if you have
 * time"; UI-SPEC §4.3 for behaviour).
 *
 *   ~15m   ▌ Title · faint source/account ··············· quiet verb (filled when selected)
 *   due Fri ▌ why / hint, one muted line                  hover: snooze · renegotiate · let go
 *
 * Fit-ins: trainings and few-minute items ("fits your 11:30 gap"). Promises: background "said by me" items
 * with their age (amber once 30 days old). Pull forward: work that isn't due today, offered only when the
 * day has room. Oldest first.
 */
import type { ShelfEntry, WorkItem } from '@/contract';
import type { ReactNode } from 'react';
import { Button, cn } from '@/ui';
import { EDGE_BG, StatusBadge, useClock, type Indicator } from './lib';
import { shortDue } from './lib/time';
import { hm } from './lib/v2';

export interface ShelfRowProps {
  entry: ShelfEntry;
  highlighted?: boolean;
  onAction?: (entry: ShelfEntry) => void;
  onOpen?: (item: WorkItem) => void;
  onHover?: (itemId: string | null) => void;
  /** Promises only: Renegotiate (drafts "can I get this to you by…?") and Let go (needs a reason). */
  onRenegotiate?: (entry: ShelfEntry) => void;
  onLetGo?: (entry: ShelfEntry) => void;
  /** v2: the selected row (its verb is filled). */
  selected?: boolean;
  /** v2: hover action to snooze the item. */
  onSnooze?: (entry: ShelfEntry) => void;
  /** v2: override the left "when" column (top line bold, bottom line muted). */
  when?: { top: string; bottom?: string };
}

const faintTag = (item: WorkItem) => item.refs.account?.label ?? item.refs.initiative?.label ?? (item.kind === 'training' ? item.training?.provider ?? 'Training' : item.sources[0]?.label.split(' · ')[0] ?? null);

function RowShell({
  entry,
  highlighted,
  selected,
  onOpen,
  onHover,
  edge,
  when,
  badge,
  actions,
  hover,
}: ShelfRowProps & { edge: Indicator; when: { top: string; bottom?: string }; badge?: ReactNode; actions: ReactNode; hover?: ReactNode }) {
  const it = entry.item;
  const tag = faintTag(it);
  return (
    <div
      role="row"
      tabIndex={0}
      data-row
      data-item-id={it.id}
      data-selected={selected || undefined}
      aria-selected={selected || undefined}
      onMouseEnter={() => onHover?.(it.id)}
      onMouseLeave={() => onHover?.(null)}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('button,a')) onOpen?.(it);
      }}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && e.key === 'Enter') onOpen?.(it);
      }}
      className={cn(
        'group/shelf @container relative grid cursor-default grid-cols-[4.75rem_3px_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-0.5 rounded-md px-3 py-2.5',
        'border-b border-line last:border-b-0 focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)] focus-visible:outline-none',
        selected ? 'bg-selected' : highlighted ? 'bg-surface-muted' : 'hover:bg-surface-muted',
      )}
    >
      <div className="row-span-2 flex flex-col self-start pt-0.5">
        <b className="whitespace-nowrap text-body font-bold text-fg-heading tabular-nums">{when.top}</b>
        {when.bottom ? <span className="whitespace-nowrap text-caption text-muted tabular-nums">{when.bottom}</span> : null}
      </div>
      <span aria-hidden className={cn('row-span-2 h-full min-h-10 w-[3px] self-stretch rounded-full', EDGE_BG[selected && edge !== 'danger' ? 'now' : edge])} />
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="truncate text-body font-bold text-fg-heading" title={it.title}>
          {it.title}
        </span>
        {badge}
        {tag ? <span className="hidden min-w-0 shrink truncate text-body text-faint @sm:inline">{tag}</span> : null}
      </div>
      <div className="relative flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {hover ? (
          <span className={cn('absolute right-full top-1/2 -translate-y-1/2 items-center gap-0.5 rounded-sm pl-3 pr-1', selected ? 'flex bg-selected' : 'hidden bg-surface-muted group-focus-within/shelf:flex group-hover/shelf:flex')}>{hover}</span>
        ) : null}
        {actions}
      </div>
      <p className="col-span-2 col-start-3 min-w-0 truncate text-caption text-muted" title={entry.hint}>
        {entry.hint}
      </p>
    </div>
  );
}

function Verb({ entry, selected, onAction }: { entry: ShelfEntry; selected?: boolean; onAction?: (e: ShelfEntry) => void }) {
  return (
    <Button size="sm" variant={selected ? 'primary' : 'ghost'} onClick={() => onAction?.(entry)} data-row-verb={selected ? 'filled' : 'quiet'}>
      {entry.action.label}
    </Button>
  );
}

export function FitInRow(props: ShelfRowProps) {
  const { entry, onAction, onSnooze, selected } = props;
  const { now, tz } = useClock();
  const it = entry.item;
  const t = it.training;
  const mins = t?.minutes ?? it.effort.youMin;
  const due = it.due ?? (t?.dueDate ? `${t.dueDate}T12:00:00Z` : null);
  const when = props.when ?? { top: `~${hm(mins)}`, bottom: due ? `due ${shortDue(due, now, tz)}` : 'any time' };
  return (
    <RowShell
      {...props}
      edge={t?.overdue ? 'danger' : 'none'}
      when={when}
      badge={t?.overdue ? <StatusBadge tone="danger" icon="clock">Overdue</StatusBadge> : null}
      hover={
        onSnooze ? (
          <Button size="sm" variant="ghost" onClick={() => onSnooze(entry)}>
            Snooze
          </Button>
        ) : null
      }
      actions={<Verb entry={entry} selected={selected} onAction={onAction} />}
    />
  );
}

export function PromiseRow(props: ShelfRowProps) {
  const { entry, onAction, onRenegotiate, onLetGo, onSnooze, selected } = props;
  const it = entry.item;
  const who = it.counterparty?.name?.split(' ')[0];
  const stale = it.ageDays >= 30;
  // The when column carries your hands-on time; the age rides on the badge once the promise goes stale.
  const when = props.when ?? { top: `~${hm(it.effort.youMin)}`, bottom: who ? `to ${who}` : stale ? 'promised' : `${it.ageDays}d ago` };
  return (
    <RowShell
      {...props}
      edge={stale ? 'warning' : 'none'}
      when={when}
      badge={stale ? <StatusBadge tone="warning" icon="clock">{`${it.ageDays} d`}</StatusBadge> : null}
      hover={
        <>
          {onRenegotiate ? (
            <Button size="sm" variant="ghost" onClick={() => onRenegotiate(entry)}>
              Renegotiate
            </Button>
          ) : null}
          {onLetGo ? (
            <Button size="sm" variant="ghost" onClick={() => onLetGo(entry)}>
              Let go
            </Button>
          ) : null}
          {onSnooze ? (
            <Button size="sm" variant="ghost" onClick={() => onSnooze(entry)}>
              Snooze
            </Button>
          ) : null}
        </>
      }
      actions={<Verb entry={entry} selected={selected} onAction={onAction} />}
    />
  );
}

export interface ShelfProps {
  /** v2 adds `pull_forward`: work not due today, offered when the day has room. */
  kind: 'fit_ins' | 'promises' | 'pull_forward';
  entries: ShelfEntry[];
  /** Rows shown (the rest sit behind "See all N →"). */
  max?: number;
  total?: number;
  highlightedItemId?: string | null;
  /** v2: the selected row. */
  selectedItemId?: string | null;
  onOpenAll?(kind: 'fit_ins' | 'promises' | 'pull_forward'): void;
  rowProps?: Omit<ShelfRowProps, 'entry' | 'highlighted' | 'selected'>;
  className?: string;
  /** v2: header text overrides ("Fit-ins" · "today, a few minutes each"). */
  title?: string;
  subtitle?: ReactNode;
}

const TITLE: Record<ShelfProps['kind'], { title: string; sub: string; empty: string }> = {
  fit_ins: { title: 'Fit-ins', sub: 'today, a few minutes each', empty: 'No fit-ins today.' },
  promises: { title: 'Promises', sub: 'things you said you would', empty: 'No open promises.' },
  pull_forward: { title: 'Pull forward if you have time', sub: 'not due today', empty: 'Nothing to pull forward.' },
};

export function Shelf({ kind, entries, max = 2, total, highlightedItemId, selectedItemId, onOpenAll, rowProps, className, title, subtitle }: ShelfProps) {
  useClock();
  const sorted = kind === 'pull_forward' ? entries : [...entries].sort((a, b) => b.item.ageDays - a.item.ageDays);
  const shown = sorted.slice(0, max);
  const count = total ?? entries.length;
  const Row = kind === 'promises' ? PromiseRow : FitInRow;
  const t = TITLE[kind];
  return (
    <section className={cn('@container', className)} aria-label={title ?? t.title}>
      <div className="flex items-baseline gap-3 px-1 pb-1">
        <h3 className="shrink-0 whitespace-nowrap text-body-lg font-bold text-fg-heading">{title ?? t.title}</h3>
        <span className="min-w-0 truncate text-caption text-muted tabular-nums">{subtitle ?? (count > shown.length ? `${count} · ${t.sub}` : t.sub)}</span>
        {count > shown.length ? (
          <button type="button" onClick={() => onOpenAll?.(kind)} className="ml-auto whitespace-nowrap text-caption font-bold text-link hover:underline">
            See all {count} →
          </button>
        ) : null}
      </div>
      {shown.length ? (
        <div role="grid" aria-label={title ?? t.title} className="flex flex-col">
          {shown.map((e) => (
            <Row key={e.item.id} entry={e} highlighted={highlightedItemId === e.item.id} selected={selectedItemId === e.item.id} {...rowProps} />
          ))}
        </div>
      ) : (
        <p className="px-1 py-2 text-caption text-faint">{t.empty}</p>
      )}
    </section>
  );
}
