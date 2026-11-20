'use client';
/**
 * Lists, v2 (DESIGN-V2 "quiet actions, loud selection"; mockup `.row`): rows over cards, hairline dividers,
 * a 3 px edge bar for meaning (red / amber / blue now), `bg-selected` selection and an inset focus ring.
 *
 * Quiet actions, loud selection:
 * - `primaryAction` is the row's verb ("Send draft"). It renders as quiet link-colour text, and becomes the one filled
 *   button only when the row is `selected` (or `emphasized`, the #1 item while nothing else is selected).
 * - `inPanel`: the row is open in the right panel, whose footer holds the filled button, so the verb stays quiet.
 * - `secondaryActions` (alias `actions`): snooze / done / not now, shown on hover, keyboard focus or selection.
 */
import { forwardRef, type HTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { Button, type ButtonSize } from './Button';
import { cn } from './cn';
import { Icon } from './Icon';
import { PRIORITY_BAR, type Priority } from './tones';

export interface ListContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** aria-label for the list region. */
  label?: string;
  /** Scroll inside the container (sticky header stays). */
  scroll?: boolean;
  /** boxed (default): one bordered L1 container · plain: rows sit directly on the panel, rounded on hover/selection. */
  variant?: 'boxed' | 'plain';
}

export const ListContainer = forwardRef<HTMLDivElement, ListContainerProps>(function ListContainer({ label, scroll, variant = 'boxed', className, children, ...rest }, ref) {
  return (
    <div
      ref={ref}
      role="list"
      aria-label={label}
      data-variant={variant}
      className={cn(
        'group/list relative',
        variant === 'boxed' ? 'overflow-hidden rounded-lg border border-line bg-surface' : 'flex flex-col',
        scroll && 'cc-scroll overflow-y-auto',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

export interface ListHeaderProps {
  children?: ReactNode;
  /** Right side (counts, "View all 37", sort). */
  trailing?: ReactNode;
  className?: string;
  /** Column-header grid: pass the same template as the rows. */
  columns?: string;
}

/** Sticky header row: 14 px bold muted labels on surface-muted (sentence case). */
export function ListHeader({ children, trailing, className, columns }: ListHeaderProps) {
  return (
    <div
      role="presentation"
      style={columns ? { gridTemplateColumns: columns } : undefined}
      className={cn(
        'sticky top-0 z-[1] h-10 items-center gap-3 border-b border-line bg-surface-muted px-4 text-caption font-bold text-muted compact:h-8',
        columns ? 'grid' : 'flex',
        className,
      )}
    >
      {children}
      {trailing ? <div className="ml-auto flex items-center gap-2 font-normal">{trailing}</div> : null}
    </div>
  );
}

export interface ListGroupHeaderProps {
  label: string;
  count?: number;
  collapsed?: boolean;
  onToggle?: () => void;
  trailing?: ReactNode;
}

/** Collapsible group header: a sentence-case label with a muted count ("Do now  4"). */
export function ListGroupHeader({ label, count, collapsed, onToggle, trailing }: ListGroupHeaderProps) {
  const inner = (
    <>
      {onToggle ? <Icon name={collapsed ? 'chevronright' : 'chevrondown'} size="xs" className="text-muted" /> : null}
      <span className="text-body font-bold text-fg-heading">{label}</span>
      {count !== undefined ? <span className="text-body text-muted tabular-nums">{count}</span> : null}
    </>
  );
  return (
    <div className="flex h-11 items-center gap-2 border-b border-line bg-surface px-4 compact:h-9">
      {onToggle ? (
        <button type="button" aria-expanded={!collapsed} onClick={onToggle} className="-ml-1 inline-flex items-center gap-2 rounded-sm px-1 focus-visible:outline-none focus-visible:shadow-focus">
          {inner}
        </button>
      ) : (
        inner
      )}
      {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
    </div>
  );
}

// ── Row verb ────────────────────────────────────────────────────────────────────────────────

export interface ListRowAction {
  label: string;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  icon?: string;
  /** Key hint shown only while filled (the selected row's key). */
  kbd?: string;
  loading?: boolean;
  disabled?: boolean;
  title?: string;
}

export interface RowVerbProps {
  action: ListRowAction;
  /** Filled accent (the selected / #1 item). Otherwise quiet link-colour text. */
  filled?: boolean;
  size?: ButtonSize;
  className?: string;
}

/** A row's own verb: quiet text by default, the one filled button when its row is selected. Usable on cards too. */
export function RowVerb({ action, filled, size = 'xs', className }: RowVerbProps) {
  return (
    <Button
      variant={filled ? 'primary' : 'quiet'}
      size={size}
      icon={action.icon}
      kbd={filled ? action.kbd : undefined}
      loading={action.loading}
      disabled={action.disabled}
      title={action.title}
      data-row-verb={filled ? 'filled' : 'quiet'}
      onClick={(e) => {
        e.stopPropagation();
        action.onClick?.(e);
      }}
      className={className}
    >
      {action.label}
    </Button>
  );
}

// ── ListRow ─────────────────────────────────────────────────────────────────────────────────

export interface ListRowProps extends HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  priority?: Priority;
  /** Two-line row height. */
  tall?: boolean;
  /** Hover/focus/selection actions, right-aligned (snooze, done, not now). Alias of `secondaryActions`. */
  actions?: ReactNode;
  /** Snooze / done / not now: hidden until the row is hovered, focused or selected. */
  secondaryActions?: ReactNode;
  /** The row's verb: quiet text, filled only when the row is selected or emphasized (and not open in the panel). */
  primaryAction?: ListRowAction;
  /** The #1 item: its verb is filled even when unselected. Pass false once another row is selected. */
  emphasized?: boolean;
  /** Open in the right panel: the panel footer owns the filled button, so this row's verb stays quiet. */
  inPanel?: boolean;
  /** Dashed "suggested / pending" treatment. */
  dashed?: boolean;
}

export const ListRow = forwardRef<HTMLDivElement, ListRowProps>(function ListRow(
  { selected, priority, tall, actions, secondaryActions, primaryAction, emphasized, inPanel, dashed, className, children, ...rest },
  ref,
) {
  const secondary = secondaryActions ?? actions;
  const filled = Boolean((selected || emphasized) && !inPanel);
  return (
    <div
      ref={ref}
      role="listitem"
      data-selected={selected ? '' : undefined}
      data-emphasized={emphasized ? '' : undefined}
      data-in-panel={inPanel ? '' : undefined}
      className={cn(
        'group/row relative flex items-center gap-3 border-b border-line px-4 text-body last:border-b-0 outline-none',
        'group-data-[variant=plain]/list:rounded-md group-data-[variant=plain]/list:px-3',
        tall ? 'min-h-(--row-h-2) py-2' : 'h-(--row-h)',
        'focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)]',
        selected ? 'bg-selected' : 'hover:bg-surface-muted data-[active]:bg-selected',
        dashed && 'before:pointer-events-none before:absolute before:inset-[3px] before:rounded-sm before:border before:border-dashed before:border-line-strong',
        priority && 'pl-5 group-data-[variant=plain]/list:pl-5',
        className,
      )}
      {...rest}
    >
      {priority ? <span aria-hidden className={cn('absolute inset-y-2 left-1.5 w-[3px] rounded-full', PRIORITY_BAR[priority])} /> : null}
      {children}
      {secondary || primaryAction ? (
        <div className="relative ml-auto flex shrink-0 items-center gap-1">
          {secondary ? (
            // Overlays the row's trailing content (mockup `.hover-acts`) instead of reserving space, on the row's own fill.
            <div
              data-row-secondary=""
              className={cn(
                'absolute top-1/2 right-full z-[1] mr-1 -translate-y-1/2 items-center gap-0.5 rounded-md p-0.5',
                selected ? 'flex bg-selected' : 'hidden bg-surface-muted group-hover/row:flex group-focus-within/row:flex group-data-[active]/row:flex group-data-[active]/row:bg-selected',
              )}
            >
              {secondary}
            </div>
          ) : null}
          {primaryAction ? <RowVerb action={primaryAction} filled={filled} /> : null}
        </div>
      ) : null}
    </div>
  );
});
