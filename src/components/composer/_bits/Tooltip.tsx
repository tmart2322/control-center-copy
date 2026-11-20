'use client';
/**
 * Navy Lightning tooltip (brief 12 §8.6) shown on hover and keyboard focus.
 * Wraps the trigger in a span, so it also works for disabled buttons (which swallow mouse events).
 */
import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { cx } from './cx';

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement<{ 'aria-describedby'?: string }>;
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  className?: string;
}

export function Tooltip({ content, children, side = 'top', align = 'center', className }: TooltipProps) {
  const id = useId();
  if (!content) return children;
  const trigger = isValidElement(children) ? cloneElement(children, { 'aria-describedby': id }) : children;
  return (
    <span className={cx('group/tt relative inline-flex', className)}>
      {trigger}
      <span
        role="tooltip"
        id={id}
        className={cx(
          'pointer-events-none absolute z-40 w-max max-w-64 rounded-md bg-surface-inverse px-2 py-1 text-caption text-on-inverse opacity-0 shadow-pop transition-opacity duration-(--dur-quick) group-hover/tt:opacity-100 group-focus-within/tt:opacity-100',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          align === 'center' ? 'left-1/2 -translate-x-1/2' : align === 'start' ? 'left-0' : 'right-0',
        )}
      >
        {content}
      </span>
    </span>
  );
}
