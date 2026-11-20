'use client';
/**
 * Shell popovers driven by `useShell().utility` (capture, sources/sending/since, spend), so pages and
 * ⌘K can open them by id: `shell.setUtility('catchup')`. One popover can answer several ids (the
 * sidebar's status line opens Sources, Sending and Since you left together).
 *
 * UtilityItem is the v1 utility-bar button, kept for the primitives kit.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { IconButton } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { Icon } from '@/ui/Icon';
import { Popover } from '@/ui/Popover';
import type { Placement } from '@/ui/floating';
import { useShell, type UtilityId } from './ShellContext';

export interface UtilityItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string;
  children?: ReactNode;
  /** New-activity dot. */
  dot?: boolean;
  tone?: 'default' | 'loud' | 'quiet';
}

/** @deprecated v1 utility-bar button (kit specimens only). */
export const UtilityItem = forwardRef<HTMLButtonElement, UtilityItemProps>(function UtilityItem({ icon, children, dot, tone = 'default', className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'relative inline-flex h-full shrink-0 items-center gap-1.5 px-3 text-caption font-bold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)]',
        tone === 'loud' ? 'bg-warning-50 text-warning-700 hover:bg-warning-100' : 'text-muted hover:bg-surface-muted hover:text-fg',
        'aria-expanded:bg-selected aria-expanded:text-fg-heading',
        className,
      )}
      {...rest}
    >
      <span className="relative">
        <Icon name={icon} size="sm" />
        {dot ? <span aria-hidden className="absolute -top-0.5 -right-1 size-2 rounded-full bg-danger-600 ring-1 ring-surface" /> : null}
      </span>
      {children}
    </button>
  );
});

type OpenId = Exclude<UtilityId, null>;

export interface UtilityPanelProps {
  /** The id this popover answers to; the first is used when the trigger opens it. */
  id: OpenId | OpenId[];
  title: string;
  trigger: ReactElement;
  children: ReactNode | ((close: () => void, openedAs: OpenId) => ReactNode);
  width?: number;
  headerExtra?: ReactNode;
  placement?: Placement;
  offset?: number;
}

export function UtilityPanel({ id, title, trigger, children, width = 440, headerExtra, placement = 'right-end', offset = 8 }: UtilityPanelProps) {
  const shell = useShell();
  const ids = Array.isArray(id) ? id : [id];
  const openedAs = shell.utility && ids.includes(shell.utility) ? shell.utility : null;
  return (
    <Popover open={openedAs !== null} onOpenChange={(v) => shell.setUtility(v ? ids[0]! : null)} placement={placement} offset={offset} width={width} label={title} trigger={trigger}>
      {({ close }) => (
        <div className="flex max-h-[min(36rem,80vh)] flex-col">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line pr-2 pl-4">
            <h2 className="text-body font-bold text-fg-heading">{title}</h2>
            {headerExtra}
            <IconButton icon="close" label="Close" size="sm" className="ml-auto" onClick={close} />
          </div>
          <div className="cc-scroll min-h-0 flex-1 overflow-y-auto">{typeof children === 'function' ? children(close, openedAs ?? ids[0]!) : children}</div>
        </div>
      )}
    </Popover>
  );
}
