'use client';
/**
 * WorkRow: the v2 list row (DESIGN-V2; mockup home-1-briefing section rows, UI-SPEC §5.2 for behaviour).
 *
 *   ▌ Title, 18 px bold ······································ start by / due · you ~20m · account
 *   ▌ [one status badge] why, one muted line ·················· quiet verb  (filled when selected)
 *                                                    hover / selection: ✓ done · ◔ snooze · ✎ edit · ↗ Open in Slack (origin source)
 *
 * The 3 px edge is the row's one color signal: accent = selected, red = late / blocked / overdue, amber =
 * tight or needs you, green = ready, violet = AI. Everything else stays the neutral hairline. Columns fold
 * with container queries, so the same row works in a 340 px Home column and a 1400 px list. `dense` keeps
 * a one-line 44 px row for long tables (Work), restyled to v2.
 *
 * WorkList (container + j/k focus movement) and WorkGroup (collapsible "Do now 4" header) live here too.
 */
import type { EntityRef, NbaVerb, SourceRef, WorkItem } from '@/contract';
import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Button, cn, Icon, StaleMark } from '@/ui';
import { AccountTag, EDGE_BG, itemIndicator, SourceChip, StartBy, StatusBadge, TONE_TO_BADGE, useClock, type Indicator } from './lib';
import { openInLabel, originSource } from './lib/source-link';
import { age, dur } from './lib/time';
import { hm, sentence } from './lib/v2';
import { leadTiming } from './derive';
import { StateGlyph } from './StateGlyph';
import { statePill, VERB_CHIP, VERB_LABEL } from './vocab';

export type WorkRowActionKey = 'done' | 'snooze' | 'edit' | 'open_source' | 'resolve' | 'select';

export interface WorkRowProps {
  item: WorkItem;
  /** The item's NBA verb (the row's quiet action); omit to hide it. */
  nbaVerb?: NbaVerb | null;
  selected?: boolean;
  /** Spine ↔ list hover link. */
  highlighted?: boolean;
  now?: string;
  className?: string;
  onOpen?: (item: WorkItem, mode: 'sheet' | 'page') => void;
  onAction?: (key: WorkRowActionKey, item: WorkItem) => void;
  /** The verb / ⌘↵. */
  onVerb?: (verb: NbaVerb, item: WorkItem) => void;
  onOpenSource?: (source: SourceRef, item: WorkItem) => void;
  onOpenEntity?: (ref: EntityRef) => void;
  onHover?: (itemId: string | null) => void;

  /** v2: one-line 44 px table row (long lists). Default: the two-line v2 row. */
  dense?: boolean;
  /** v2: #1 of its list: the verb is filled even when not selected. */
  emphasis?: boolean;
  /** v2: the item is open in the docked panel (the panel footer holds the filled action). */
  inPanel?: boolean;
  /** v2: the page knows the item is blocked (red edge + "Blocked" badge). */
  blocked?: boolean;
  /** Live updates (docs/UX.md): arrived ('new'), left elsewhere ('leaving'), or left while open in the panel ('gone'). */
  live?: 'new' | 'leaving' | 'gone';
  /** v2: override the edge indicator. */
  edge?: Indicator;
  /** v2: override the computed status badge (e.g. a "◷ 114 d" age badge). `null` hides it. */
  badge?: ReactNode;
  /** v2: override the why line (default: item.why). */
  why?: ReactNode;
  /** v2: override the verb's label (default: the NBA verb's label). */
  verbLabel?: string;
  /** LD-1: a second quiet verb beside the first (Looks done: "Not done"). */
  altVerb?: { label: string; title?: string; onClick: (item: WorkItem) => void };
  /** v2: an extra line under the title (a progress meter, a checklist). */
  extra?: ReactNode;
  /** v2: hide the meta column (timing · effort · account) even on wide containers. */
  hideMeta?: boolean;
  /** v2: a leading "when" column (Today's run of day: "08:35" over "in 13m"). */
  when?: { top: string; bottom?: string };
}

export function WorkRow(props: WorkRowProps) {
  const { item, nbaVerb, selected, highlighted, className, onOpen, onAction, onVerb, onOpenSource, onOpenEntity, onHover, dense, emphasis, inPanel, blocked, verbLabel, altVerb, extra, hideMeta, when } = props;
  const { now } = useClock({ now: props.now });
  const timing = leadTiming(item);
  const pill = item.state === 'open' || item.state === 'in_progress' ? null : statePill(item, { waitingAge: item.waiting ? age(item.waiting.since, now) : undefined });
  const openable = originSource(item.sources);
  const done = item.state === 'done' || item.state === 'dismissed';
  const ind = props.edge ?? itemIndicator(item, now, { selected, blocked });

  const act = (key: WorkRowActionKey) => onAction?.(key, item);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter' && mod) {
      if (nbaVerb) onVerb?.(nbaVerb, item);
    } else if (e.key === 'Enter') onOpen?.(item, e.shiftKey ? 'page' : 'sheet');
    else if (mod || e.altKey) return;
    else if (e.key === 'd') act('done');
    else if (e.key === 'D') act('resolve');
    else if (e.key === 's') act('snooze');
    else if (e.key === 'e') act('edit');
    else if (e.key === 'x') act('select');
    else if (e.key === 'o' && openable) onOpenSource?.(openable, item);
    else return;
    e.preventDefault();
  };

  const rowEvents = {
    role: 'row' as const,
    tabIndex: 0,
    'data-row': true,
    'data-item-id': item.id,
    'data-live': props.live,
    'data-selected': selected || undefined,
    'aria-selected': selected || undefined,
    onKeyDown,
    onClick: (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button,a')) return;
      onOpen?.(item, 'sheet');
    },
    onMouseEnter: () => onHover?.(item.id),
    onMouseLeave: () => onHover?.(null),
  };

  const filled = (selected || emphasis) && !inPanel;
  const verb = nbaVerb ? (
    <Button
      variant={filled ? 'primary' : 'ghost'}
      size={dense ? 'xs' : 'sm'}
      onClick={(e) => {
        e.stopPropagation();
        onVerb?.(nbaVerb, item);
      }}
      data-row-verb={filled ? 'filled' : 'quiet'}
    >
      {verbLabel ?? (dense ? VERB_CHIP[nbaVerb] : VERB_LABEL[nbaVerb])}
    </Button>
  ) : null;

  const alt = altVerb ? (
    <Button
      variant="ghost"
      size={dense ? 'xs' : 'sm'}
      title={altVerb.title}
      onClick={(e) => {
        e.stopPropagation();
        altVerb.onClick(item);
      }}
      data-row-verb="alt"
    >
      {altVerb.label}
    </Button>
  ) : null;

  const actionButtons = (
    <>
      <RowAction label="Done" k="d" icon="check" onClick={() => act('done')} />
      <RowAction label="Snooze" k="s" icon="clock" onClick={() => act('snooze')} />
      <RowAction label="Edit" k="e" icon="edit" onClick={() => act('edit')} />
      {openable && onOpenSource ? <RowAction label={openInLabel(openable.kind)} k="o" icon="new_window" onClick={() => onOpenSource(openable, item)} /> : null}
    </>
  );
  // Hover / focus: an overlay in the corner. Selected: the same actions sit inline beside the filled verb.
  const hoverActs = (
    <span
      data-row-actions="hover"
      className={cn(
        'absolute right-1.5 top-1.5 z-[1] items-center gap-0.5 rounded-sm p-0.5',
        selected && !dense ? 'hidden' : selected ? 'flex bg-selected' : 'hidden bg-surface-muted group-focus-within/row:flex group-hover/row:flex',
        dense && 'top-1/2 -translate-y-1/2',
      )}
    >
      {actionButtons}
    </span>
  );
  const inlineActs = selected ? (
    <span data-row-actions="inline" className="flex shrink-0 items-center gap-0.5">
      {actionButtons}
    </span>
  ) : null;

  const rowBg = selected ? 'bg-selected' : highlighted ? 'bg-surface-muted' : 'hover:bg-surface-muted';
  const focus = 'focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)] focus-visible:outline-none';
  const badgeNode =
    props.badge !== undefined ? (
      props.badge
    ) : blocked ? (
      <StatusBadge tone="danger" icon="ban">
        Blocked
      </StatusBadge>
    ) : pill ? (
      <StatusBadge tone={TONE_TO_BADGE[pill.tone]} dashed={pill.dashed}>
        {pill.label}
      </StatusBadge>
    ) : item.training?.overdue ? (
      <StatusBadge tone="danger" icon="clock">
        Overdue
      </StatusBadge>
    ) : null;

  // ── dense: one line, for long tables ────────────────────────────────────────────────────
  if (dense) {
    return (
      <div {...rowEvents} className={cn('group/row @container relative flex h-11 cursor-default items-center gap-3 border-b border-line pl-4 pr-3 text-body last:border-b-0', rowBg, focus, className)}>
        <span aria-hidden className={cn('absolute inset-y-1.5 left-1 w-[3px] rounded-full', EDGE_BG[ind])} />
        <StateGlyph state={item.state} size={16} />
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className={cn('truncate font-bold', done ? 'text-muted line-through decoration-line-strong' : 'text-fg-heading')} title={item.title}>
            {item.title}
          </span>
          {badgeNode}
          {item.stale ? <StaleMark reason={item.stale.reason} /> : null}
        </span>
        {item.refs.initiative ? (
          <span className="hidden max-w-48 shrink-0 @4xl:inline-flex">
            <AccountTag label={item.refs.initiative.label} title={item.purpose ?? item.refs.initiative.label} plain onOpen={onOpenEntity ? () => onOpenEntity(item.refs.initiative!) : undefined} />
          </span>
        ) : null}
        <span className="hidden shrink-0 items-center gap-0.5 @2xl:flex">
          {item.sources.slice(0, 3).map((s) => (
            <SourceChip key={`${s.kind}${s.label}`} source={s} compact onOpen={onOpenSource ? (src) => onOpenSource(src, item) : undefined} />
          ))}
        </span>
        <span className="hidden w-32 shrink-0 truncate text-caption text-muted @3xl:block" title={item.refs.account?.label}>
          {item.refs.account?.label ?? ''}
        </span>
        <span className="hidden w-20 shrink-0 text-right text-caption tabular-nums text-muted @lg:block" title={`you ${dur(item.effort.youMin)} · agent ${item.effort.agentMin ? dur(item.effort.agentMin) : '—'} in background`}>
          you {hm(item.effort.youMin)}
        </span>
        <span className="w-32 shrink-0 text-right">{timing ? <StartBy at={timing.at} kind={timing.kind} note={false} /> : <span className="text-caption text-faint">—</span>}</span>
        <span className="hidden shrink-0 justify-end gap-1 @xl:flex" style={{ minWidth: '6rem' }}>
          {alt}
          {verb}
        </span>
        <span className="w-2 shrink-0">{item.newEvidenceCount > 0 ? <span className="block size-2 rounded-full bg-accent" title={`${item.newEvidenceCount} new`} /> : null}</span>
        <span className="w-8 shrink-0 text-right text-caption tabular-nums text-faint">{age(item.createdAt, now)}</span>
        {hoverActs}
      </div>
    );
  }

  // ── v2 two-line row ──────────────────────────────────────────────────────────────────────
  const timingText = timing ? <StartBy at={timing.at} kind={timing.kind} note={false} /> : null;
  const meta = hideMeta ? null : (
    <span className="ml-auto hidden min-w-0 shrink-0 items-center gap-3 whitespace-nowrap pl-2 text-caption text-muted @xl:flex">
      {timingText}
      <span className="tabular-nums" title={item.effort.agentMin ? `agent ~${hm(item.effort.agentMin)} runs in the background` : undefined}>
        you ~{hm(item.effort.youMin)}
        {item.effort.agentMin ? <span className="text-ai-700"> · ✦</span> : null}
      </span>
      {item.refs.account ? <AccountTag label={item.refs.account.label} plain onOpen={onOpenEntity ? () => onOpenEntity(item.refs.account!) : undefined} /> : null}
    </span>
  );

  return (
    <div
      {...rowEvents}
      className={cn(
        'group/row @container relative grid cursor-default items-stretch rounded-md px-3 py-2.5',
        when ? 'grid-cols-[4.25rem_3px_minmax(0,1fr)] gap-x-3.5' : 'grid-cols-[3px_minmax(0,1fr)] gap-x-3',
        'border-b border-line last:border-b-0',
        rowBg,
        focus,
        className,
      )}
    >
      {when ? (
        <div className="flex flex-col pt-0.5">
          <b className="text-body-lg font-bold leading-7 text-fg-heading tabular-nums">{when.top}</b>
          {when.bottom ? <span className="whitespace-nowrap text-caption text-muted tabular-nums">{when.bottom}</span> : null}
        </div>
      ) : null}
      <span aria-hidden className={cn('min-h-10 w-[3px] rounded-full', EDGE_BG[ind])} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('min-w-0 truncate text-body-lg font-bold', done ? 'text-muted line-through decoration-line-strong' : 'text-fg-heading')} title={item.title}>
            {item.title}
          </span>
          {item.stale ? <StaleMark reason={item.stale.reason} /> : null}
          {item.newEvidenceCount > 0 ? <span className="size-1.5 shrink-0 rounded-full bg-muted" title={`${item.newEvidenceCount} new`} /> : null}
          {meta}
        </div>
        {extra ? <div className="min-w-0">{extra}</div> : null}
        <div className="flex min-h-8 min-w-0 items-center gap-2 text-body text-muted">
          {badgeNode ? <span className="flex min-w-0 shrink">{badgeNode}</span> : null}
          {timingText && !hideMeta ? <span className="min-w-0 shrink truncate @xl:hidden">{timingText}</span> : timingText ? <span className="min-w-0 shrink truncate">{timingText}</span> : null}
          <span className={cn('min-w-0 flex-1 truncate', item.reevaluating && 'cc-reeval px-1')} title={typeof props.why === 'string' ? props.why : item.why}>
            {props.why ?? item.why}
          </span>
          {inlineActs || verb || alt ? (
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {inlineActs}
              {alt}
              {verb}
            </span>
          ) : null}
        </div>
      </div>
      {hoverActs}
    </div>
  );
}

function RowAction({ label, k, icon, onClick }: { label: string; k: string; icon: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={`${label} (${k})`}
      aria-label={label}
      // ROW-1 (as LineRow): a mouse press must not move focus, or the selected row redraws its buttons and the click is lost
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="inline-grid size-7 place-items-center rounded-sm text-muted hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:shadow-focus"
    >
      <Icon name={icon} size="sm" />
    </button>
  );
}

/** List container. Default: a bordered panel; `bare` drops the box (rows inside a SectionColumn or pane). j/k (and ↑/↓) move focus between rows. */
export function WorkList({ children, className, label, bare }: { children: ReactNode; className?: string; label?: string; bare?: boolean }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { j: 1, ArrowDown: 1, k: -1, ArrowUp: -1 };
    const dir = keys[e.key];
    if (!dir || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement;
    if (!target.matches('[data-row]')) return;
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-row]'));
    const next = rows[rows.indexOf(target) + dir];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };
  return (
    <div role="grid" aria-label={label} onKeyDown={onKeyDown} className={cn('flex flex-col', bare ? 'min-w-0' : 'overflow-clip rounded-lg border border-line bg-surface p-1.5', className)}>
      {children}
    </div>
  );
}

export interface WorkGroupProps {
  label: string;
  count: number;
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onToggle?: (collapsed: boolean) => void;
  /** Right side of the header: a batch action or "See all 37 →". */
  action?: ReactNode;
  children: ReactNode;
}

/** Collapsible group: a verb-named, sentence-case header with a count ("Do now 4"), sticky in its scroller. */
export function WorkGroup({ label, count, collapsed: controlled, defaultCollapsed, onToggle, action, children }: WorkGroupProps) {
  const [inner, setInner] = useState(defaultCollapsed ?? false);
  const collapsed = controlled ?? inner;
  const toggle = () => {
    if (controlled === undefined) setInner(!collapsed);
    onToggle?.(!collapsed);
  };
  return (
    <section role="rowgroup">
      <div className="sticky top-0 z-10 flex h-11 items-center gap-2 border-b border-line bg-surface px-2">
        <button type="button" onClick={toggle} aria-expanded={!collapsed} className="inline-flex min-w-0 items-baseline gap-2 rounded-sm px-1 hover:text-fg focus-visible:outline-none focus-visible:shadow-focus">
          <Icon name={collapsed ? 'chevronright' : 'chevrondown'} size="xs" className="self-center text-faint" />
          <span className="truncate text-body-lg font-bold text-fg-heading">{sentence(label)}</span>
          <span className="text-body text-muted tabular-nums">{count}</span>
        </button>
        {action ? <span className="ml-auto text-caption font-bold">{action}</span> : null}
      </div>
      {collapsed ? null : children}
    </section>
  );
}


