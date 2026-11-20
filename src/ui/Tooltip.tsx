'use client';
/**
 * Tooltip on `surface-inverse` (v2: light on dark, navy on light; not the Lightning navy chip).
 * Hover or focus shows it after a short delay; Esc hides.
 * The child must accept ref + event props (a DOM element or a forwardRef component).
 */
import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState, type ReactElement, type ReactNode, type Ref } from 'react';
import { cn } from './cn';
import { useAnchoredPosition, type Placement } from './floating';
import { Portal } from './Portal';
import { mergeRefs } from './refs';

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: Placement;
  delayMs?: number;
  /** Render nothing extra when false/empty. */
  disabled?: boolean;
  className?: string;
  /** Force it open (kit, walkthroughs); hover/focus still work when undefined. */
  open?: boolean;
}

type ChildProps = {
  ref?: Ref<HTMLElement>;
  onMouseEnter?: (e: unknown) => void;
  onMouseLeave?: (e: unknown) => void;
  onFocus?: (e: unknown) => void;
  onBlur?: (e: unknown) => void;
  'aria-describedby'?: string;
};

export function Tooltip({ content, children, side = 'top', delayMs = 350, disabled, className, open: forced }: TooltipProps) {
  const [hovered, setOpen] = useState(false);
  const open = forced ?? hovered;
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const pos = useAnchoredPosition(open, anchorRef, tipRef, side, 6);

  const show = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delayMs);
  }, [delayMs]);
  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hide]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  if (!isValidElement(children) || disabled || content === null || content === undefined || content === '') return children;
  const props = children.props as ChildProps;
  const chain =
    (theirs: ((e: unknown) => void) | undefined, ours: () => void) =>
    (e: unknown) => {
      theirs?.(e);
      ours();
    };

  return (
    <>
      {cloneElement(children as ReactElement<ChildProps>, {
        ref: mergeRefs(props.ref, (el: HTMLElement | null) => {
          anchorRef.current = el;
        }),
        onMouseEnter: chain(props.onMouseEnter, show),
        onMouseLeave: chain(props.onMouseLeave, hide),
        onFocus: chain(props.onFocus, show),
        onBlur: chain(props.onBlur, hide),
        'aria-describedby': open ? id : props['aria-describedby'],
      })}
      {open ? (
        <Portal>
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className={cn(
              'pointer-events-none z-[90] max-w-xs rounded-md bg-surface-inverse px-2.5 py-1.5 text-caption text-on-inverse shadow-pop',
              className,
            )}
          >
            {content}
          </div>
        </Portal>
      ) : null}
    </>
  );
}
