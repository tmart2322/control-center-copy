'use client';
/**
 * Hover card: a rich, read-mostly card anchored to a trigger (a ribbon meeting, a spine block). It opens after a
 * short delay on mouse hover or keyboard focus, stays open while the pointer is over the card (so a link in it can
 * be clicked), and closes on leave, blur, Esc, or a click on the trigger. It never blocks the trigger's click: it
 * sits beside the trigger, never over it, and a click closes it at once and runs the trigger's own handler.
 *
 * `onIntent` fires the moment hover or focus starts (before the delay), so the card's data can be fetched early.
 * The trigger gets `aria-describedby` → the card while it is open. Surface: L2 `surface-raised` + `shadow-pop`, like
 * Popover (the inverse Tooltip is for one line). The child must accept ref + event props (a DOM element).
 */
import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState, type ReactElement, type ReactNode, type Ref } from 'react';
import { cn } from './cn';
import { useAnchoredPosition, type Placement } from './floating';
import { Portal } from './Portal';
import { mergeRefs } from './refs';

export interface HoverCardProps {
  /** Rendered only while open (a function defers the work until then). */
  content: ReactNode | (() => ReactNode);
  children: ReactElement;
  placement?: Placement;
  /** Hover / focus → open (ms). */
  openDelayMs?: number;
  /** Leave → close (ms), so the pointer can cross the gap into the card. */
  closeDelayMs?: number;
  /** Hover or focus started (before the delay): prefetch here. */
  onIntent?: () => void;
  disabled?: boolean;
  className?: string;
  /** The card's accessible name. */
  label?: string;
  width?: number | string;
  /** Force it open (kit, tests); hover / focus still work when undefined. */
  open?: boolean;
}

type ChildProps = {
  ref?: Ref<HTMLElement>;
  onMouseEnter?: (e: unknown) => void;
  onMouseLeave?: (e: unknown) => void;
  onFocus?: (e: unknown) => void;
  onBlur?: (e: unknown) => void;
  onClick?: (e: unknown) => void;
  'aria-describedby'?: string;
};

export function HoverCard({ content, children, placement = 'bottom-start', openDelayMs = 300, closeDelayMs = 150, onIntent, disabled, className, label, width = 320, open: forced }: HoverCardProps) {
  const [shown, setShown] = useState(false);
  const open = !disabled && (forced ?? shown);
  const anchorRef = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const pos = useAnchoredPosition(open, anchorRef, cardRef, placement, 8);

  const clear = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);
  const keep = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  const show = useCallback(() => {
    if (disabled) return;
    keep();
    onIntent?.();
    if (openTimer.current) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      setShown(true);
    }, openDelayMs);
  }, [disabled, keep, onIntent, openDelayMs]);
  const hideSoon = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setShown(false);
    }, closeDelayMs);
  }, [closeDelayMs]);
  const hideNow = useCallback(() => {
    clear();
    setShown(false);
  }, [clear]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hideNow();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hideNow]);
  useEffect(() => clear, [clear]);

  if (!isValidElement(children) || disabled) return children;
  const props = children.props as ChildProps;
  const chain =
    (theirs: ((e: unknown) => void) | undefined, ours: (e: unknown) => void) =>
    (e: unknown) => {
      ours(e);
      theirs?.(e);
    };

  return (
    <>
      {cloneElement(children as ReactElement<ChildProps>, {
        ref: mergeRefs(props.ref, (el: HTMLElement | null) => {
          anchorRef.current = el;
        }),
        onMouseEnter: chain(props.onMouseEnter, show),
        onMouseLeave: chain(props.onMouseLeave, hideSoon),
        onFocus: chain(props.onFocus, show),
        onBlur: chain(props.onBlur, (e) => {
          // focus moving into the card keeps it open
          const next = (e as { relatedTarget?: Node | null }).relatedTarget ?? null;
          if (next && cardRef.current?.contains(next)) return;
          hideNow();
        }),
        // a click belongs to the trigger: close at once, never in the way of what it opens
        onClick: chain(props.onClick, hideNow),
        'aria-describedby': open ? id : props['aria-describedby'],
      })}
      {open ? (
        <Portal>
          <div
            ref={cardRef}
            id={id}
            aria-label={label}
            data-hovercard=""
            onMouseEnter={keep}
            onMouseLeave={hideSoon}
            style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, maxWidth: 'calc(100vw - 16px)' }}
            className={cn('z-[85] rounded-lg bg-surface-raised p-3 text-body text-fg shadow-pop', className)}
          >
            {typeof content === 'function' ? content() : content}
          </div>
        </Portal>
      ) : null}
    </>
  );
}
