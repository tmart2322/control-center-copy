'use client';
/**
 * LineRow: the v2 two-line row for list items that are not open work items (a Triage suggestion, a
 * missed-opp hit, a mapping question, an Outbox draft). Same anatomy and measurements as the domain
 * WorkRow, so the three list pages read as one system:
 *
 *   ▌ Title, 18 px bold ······································ meta (muted, folds on narrow rows)
 *   ▌ [one status badge] why, one muted line ·················· quiet verb (filled when selected)
 *                                                    hover / selection: the row's other actions
 *
 * The 3 px edge is the row's one colour signal (blue selected, red broken or late, amber at risk, green
 * ready, violet AI). `dashed` draws it dashed: suggestions and pending drafts look different from facts
 * and from things that have left. Keys live on the page (useListKeys); the row handles Enter itself.
 */
import { forwardRef, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { EDGE_BG, type Indicator } from '@/components/domain';
import { Button, cn, Icon, type ListRowAction } from '@/ui';

const EDGE_DASHED: Record<Indicator, string> = {
  now: 'border-accent',
  danger: 'border-danger-500',
  warning: 'border-warning-500',
  success: 'border-success-500',
  ai: 'border-ai-500',
  none: 'border-line-strong',
};

export interface LineRowAction {
  label: string;
  /** Single key shown in the tooltip ("e"). */
  k?: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  testId?: string;
}

export interface LineRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  rowId: string;
  title: string;
  /** Rendered in place of the plain title (keeps `title` for the tooltip and the accessible name). */
  titleNode?: ReactNode;
  why?: ReactNode;
  whyTitle?: string;
  badge?: ReactNode;
  /** Right side of the title line (timing · effort · account). Folds away on narrow rows. */
  meta?: ReactNode;
  edge?: Indicator;
  dashed?: boolean;
  /** The row's own verb: quiet text, the one filled button when selected or emphasised (and not in the panel). */
  verb?: ListRowAction | null;
  /** Other actions: an overlay on hover / focus, inline beside the verb when selected. */
  actions?: LineRowAction[];
  /** Custom trailing controls on the why line (mapping choices). Replaces the verb. */
  trailing?: ReactNode;
  /** Under the why line: an inline error, a dry-run result, a progress line. */
  extra?: ReactNode;
  selected?: boolean;
  emphasis?: boolean;
  inPanel?: boolean;
  /** Click or Enter: Details. ⇧Enter: the full page, when there is one. */
  onOpen?: (mode: 'details' | 'page') => void;
}

export const LineRow = forwardRef<HTMLDivElement, LineRowProps>(function LineRow(
  { rowId, title, titleNode, why, whyTitle, badge, meta, edge = 'none', dashed, verb, actions = [], trailing, extra, selected, emphasis, inPanel, onOpen, className, onKeyDown, onClick, ...rest },
  ref,
) {
  const filled = Boolean((selected || emphasis) && !inPanel);
  // Same precedence as itemIndicator(): broken stays red when selected; selection beats the rest.
  const ind: Indicator = edge === 'danger' ? 'danger' : selected ? 'now' : edge;

  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || e.target !== e.currentTarget) return;
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && onOpen) {
      e.preventDefault();
      onOpen(e.shiftKey ? 'page' : 'details');
    }
  };
  const click = (e: MouseEvent<HTMLDivElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || (e.target as HTMLElement).closest('button,a,input,label')) return;
    onOpen?.('details');
  };

  // ROW-1: a mouse press on a row button must not move focus. Focus selects the row, a selected row draws its buttons
  // in another place (hover toolbar → inline), React remounts the button between press and release, and the click is
  // lost: Reject, Edit and the verb did nothing on a row that wasn't selected yet. Keyboard focus is unaffected.
  const keepFocus = (e: MouseEvent<HTMLButtonElement>) => e.preventDefault();
  const buttons = actions.map((a) => (
    <button
      key={a.label}
      type="button"
      title={a.title ?? (a.k ? `${a.label} (${a.k})` : a.label)}
      aria-label={a.label}
      disabled={a.disabled}
      data-testid={a.testId}
      onMouseDown={keepFocus}
      onClick={(e) => {
        e.stopPropagation();
        a.onClick();
      }}
      className="inline-grid size-7 place-items-center rounded-sm text-muted hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <Icon name={a.icon} size="sm" />
    </button>
  ));

  const verbNode =
    verb && !trailing ? (
      <Button
        variant={filled ? 'primary' : 'quiet'}
        size="sm"
        icon={verb.icon}
        kbd={filled ? verb.kbd : undefined}
        loading={verb.loading}
        disabled={verb.disabled}
        title={verb.title}
        data-row-verb={filled ? 'filled' : 'quiet'}
        onMouseDown={keepFocus}
        onClick={(e) => {
          e.stopPropagation();
          verb.onClick?.(e);
        }}
      >
        {verb.label}
      </Button>
    ) : null;

  return (
    <div
      ref={ref}
      role="row"
      data-row=""
      data-item-id={rowId}
      data-selected={selected || undefined}
      aria-selected={selected || undefined}
      aria-label={title}
      onKeyDown={keys}
      onClick={click}
      className={cn(
        'group/row @container relative grid cursor-default grid-cols-[3px_minmax(0,1fr)] items-stretch gap-x-3 rounded-md border-b border-line px-3 py-2.5 last:border-b-0',
        selected ? 'bg-selected' : 'hover:bg-surface-muted',
        'focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)] focus-visible:outline-none',
        className,
      )}
      {...rest}
    >
      <span aria-hidden className={cn('min-h-10 w-[3px]', dashed ? cn('border-l-[3px] border-dashed', EDGE_DASHED[ind]) : cn('rounded-full', EDGE_BG[ind]))} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-body-lg font-bold text-fg-heading" title={title}>
            {titleNode ?? title}
          </span>
          {meta ? <span className="ml-auto hidden max-w-[50%] min-w-0 shrink items-center gap-3 overflow-hidden whitespace-nowrap pl-2 text-caption text-muted @3xl:flex">{meta}</span> : null}
        </div>
        <div className="flex min-h-8 min-w-0 items-center gap-2 text-body text-muted">
          {badge ? <span className="flex min-w-0 shrink">{badge}</span> : null}
          <span className="min-w-0 flex-1 truncate" title={whyTitle ?? (typeof why === 'string' ? why : undefined)}>
            {why}
          </span>
          {trailing ? (
            <span className="ml-auto flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
              {/* selected: the other actions (the source link) stay beside the custom controls, as beside a verb */}
              {selected && buttons.length ? (
                <span data-row-actions="inline" className="flex items-center gap-0.5">
                  {buttons}
                </span>
              ) : null}
              {trailing}
            </span>
          ) : selected && buttons.length ? (
            <span data-row-actions="inline" className="ml-auto flex shrink-0 items-center gap-0.5">
              {buttons}
              {verbNode}
            </span>
          ) : verbNode ? (
            <span className="ml-auto flex shrink-0 items-center gap-1">{verbNode}</span>
          ) : null}
        </div>
        {extra ? <div className="min-w-0">{extra}</div> : null}
      </div>
      {!selected && buttons.length ? (
        <span data-row-actions="hover" className="absolute top-1.5 right-1.5 z-[1] hidden items-center gap-0.5 rounded-sm bg-surface-muted p-0.5 group-focus-within/row:flex group-hover/row:flex">
          {buttons}
        </span>
      ) : null}
    </div>
  );
});
