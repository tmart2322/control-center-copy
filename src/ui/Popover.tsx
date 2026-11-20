'use client';
/**
 * Anchored, portaled popover (v2: L2 `surface-raised`, `rounded-lg`, `shadow-pop` = 1 px ring + deep shadow, so it
 * reads on dark without a border). Closes on Esc and outside click and returns
 * focus to its trigger. While open it pushes a modal key scope, so page shortcuts don't fire
 * behind it. Controlled (`open` + `onOpenChange`) or uncontrolled.
 */
import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactElement, type ReactNode, type Ref } from 'react';
import { useKeyBinding, useKeyScope } from '@/client/keyboard/KeyboardProvider';
import { cn } from './cn';
import { useAnchoredPosition, type Placement } from './floating';
import { Portal } from './Portal';
import { mergeRefs } from './refs';

export interface PopoverApi {
  close: () => void;
}

export interface PopoverProps {
  trigger: ReactElement;
  children: ReactNode | ((api: PopoverApi) => ReactNode);
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: Placement;
  offset?: number;
  width?: number | string;
  className?: string;
  /** ARIA role of the floating surface. */
  role?: 'dialog' | 'menu' | 'listbox';
  label?: string;
  /** Where focus goes on open: the first focusable, the panel itself, or nowhere. */
  initialFocus?: 'first' | 'panel' | 'none';
  /** Push a modal key scope while open (default true). */
  modalKeys?: boolean;
  style?: CSSProperties;
  /** pop: floating menu/popover · docked: utility-panel shape opening upward from the utility bar. */
  variant?: 'pop' | 'docked';
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Popover({
  trigger,
  children,
  open: openProp,
  onOpenChange,
  placement = 'bottom-start',
  offset = 6,
  width,
  className,
  role = 'dialog',
  label,
  initialFocus = 'first',
  modalKeys = true,
  style,
  variant = 'pop',
}: PopoverProps) {
  const [inner, setInner] = useState(false);
  const open = openProp ?? inner;
  const setOpen = useCallback(
    (v: boolean) => {
      if (openProp === undefined) setInner(v);
      onOpenChange?.(v);
    },
    [openProp, onOpenChange],
  );
  const anchorRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const id = useId();
  const pos = useAnchoredPosition(open, anchorRef, panelRef, placement, offset);

  const close = useCallback(() => {
    const hadFocus = panelRef.current?.contains(document.activeElement);
    setOpen(false);
    if (hadFocus) anchorRef.current?.focus();
  }, [setOpen]);

  useKeyScope(`popover${id}`, { active: open && modalKeys, modal: true });
  useKeyBinding('escape', () => close(), { scope: `popover${id}`, enabled: open, allowInInput: true });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open || initialFocus === 'none') return;
    let f = 0;
    let tries = 0;
    const focus = () => {
      const panel = panelRef.current;
      // Portaled: the panel can mount (and become visible) a frame or two after open.
      if (!panel || panel.style.visibility === 'hidden') {
        if (tries++ < 30) f = requestAnimationFrame(focus);
        return;
      }
      const target = initialFocus === 'first' ? (panel.querySelector<HTMLElement>('[data-autofocus]') ?? panel.querySelector<HTMLElement>(FOCUSABLE)) : panel;
      (target ?? panel).focus({ preventScroll: true });
    };
    f = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(f);
  }, [open, initialFocus]);

  if (!isValidElement(trigger)) return null;
  const tprops = trigger.props as { ref?: Ref<HTMLElement>; onClick?: (e: unknown) => void };

  return (
    <>
      {cloneElement(trigger as ReactElement<Record<string, unknown>>, {
        ref: mergeRefs(tprops.ref, (el: HTMLElement | null) => {
          anchorRef.current = el;
        }),
        onClick: (e: unknown) => {
          tprops.onClick?.(e);
          setOpen(!open);
        },
        'aria-expanded': open,
        'aria-haspopup': role === 'menu' ? 'menu' : role === 'listbox' ? 'listbox' : 'dialog',
        'aria-controls': open ? id : undefined,
      })}
      {open ? (
        <Portal>
          <div
            ref={panelRef}
            id={id}
            role={role}
            aria-label={label}
            tabIndex={-1}
            style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, visibility: pos ? 'visible' : 'hidden', ...style }}
            className={cn(
              'z-[80] bg-surface-raised text-body text-fg focus:outline-none',
              variant === 'pop' ? 'rounded-lg shadow-pop' : 'rounded-t-xl border border-b-0 border-line shadow-dock',
              className,
            )}
          >
            {typeof children === 'function' ? children({ close }) : children}
          </div>
        </Portal>
      ) : null}
    </>
  );
}
