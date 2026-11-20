'use client';
/**
 * Modal base: portal + backdrop + focus trap + Esc + focus restore + a modal key scope.
 * Used by Dialog, the command palette and the cheat sheet. Modals are for short, blocking moments
 * only (UI-SPEC §2); records open in the docked right panel (or the non-modal SideSheet).
 * v2: L3 `surface-overlay` panel, `rounded-xl`, a scrim token (navy 40 % light, black 64 % dark).
 */
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useKeyBinding, useKeyScope } from '@/client/keyboard/KeyboardProvider';
import { cn } from './cn';
import { Portal } from './Portal';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Element to focus on open (else [data-autofocus], else the first focusable). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Where the panel sits. */
  position?: 'center' | 'top';
  className?: string;
  backdropClassName?: string;
  labelledBy?: string;
  describedBy?: string;
  role?: 'dialog' | 'alertdialog';
  /** Close on backdrop click (default true; confirms may disable while busy). */
  dismissable?: boolean;
}

export function Overlay({
  open,
  onClose,
  children,
  initialFocusRef,
  position = 'center',
  className,
  backdropClassName,
  labelledBy,
  describedBy,
  role = 'dialog',
  dismissable = true,
}: OverlayProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const scope = `overlay${useId()}`;

  useKeyScope(scope, { active: open, modal: true });
  useKeyBinding('escape', () => (dismissable ? onClose() : undefined), { scope, enabled: open, allowInInput: true });

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    let f = 0;
    let tries = 0;
    const focus = () => {
      const panel = panelRef.current;
      if (!panel) {
        if (tries++ < 30) f = requestAnimationFrame(focus); // portal mounts a frame later
        return;
      }
      const target = initialFocusRef?.current ?? panel.querySelector<HTMLElement>('[data-autofocus]') ?? panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
      target.focus({ preventScroll: true });
    };
    f = requestAnimationFrame(focus);
    return () => {
      cancelAnimationFrame(f);
      const el = restoreRef.current;
      if (el && document.contains(el)) requestAnimationFrame(() => el.focus({ preventScroll: true }));
    };
  }, [open, initialFocusRef]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const els = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!els.length) return;
    const first = els[0]!;
    const last = els[els.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;
  return (
    <Portal>
      <div className={cn('fixed inset-0 z-[70] flex justify-center', position === 'center' ? 'items-center' : 'items-start pt-[12vh]')}>
        <div aria-hidden className={cn('absolute inset-0 bg-scrim', backdropClassName)} onMouseDown={() => dismissable && onClose()} />
        <div
          ref={panelRef}
          role={role}
          aria-modal="true"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className={cn('relative max-h-[80vh] overflow-hidden rounded-xl bg-surface-overlay text-fg shadow-modal focus:outline-none', className)}
        >
          {children}
        </div>
      </div>
    </Portal>
  );
}
