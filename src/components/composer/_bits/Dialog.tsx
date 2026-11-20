'use client';
/**
 * Stand-in for `@/ui` Dialog: a short blocking confirm (UI-SPEC §2: modals only for capture and confirms).
 * Portal + backdrop + focus trap. Esc and the backdrop call onClose. Focus returns to the opener on close.
 * The element marked `data-autofocus` (or `initialFocusRef`) gets focus on open; for confirms that's Cancel.
 */
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  size?: 'md' | 'lg';
  /** Extra keydown handling inside the dialog (e.g. ⌘↵). */
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  className?: string;
  /** Render inline instead of in a portal with a backdrop (kit gallery specimens). */
  inline?: boolean;
}

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Dialog({ open, onClose, title, description, children, footer, initialFocusRef, size = 'md', onKeyDown, className, inline }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || inline) return;
    const opener = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const target = initialFocusRef?.current ?? panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    }, 0);
    return () => {
      clearTimeout(t);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open, inline, initialFocusRef]);

  if (!open) return null;

  const keydown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const els = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
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

  const body = (
    <div
      ref={panel}
      role="dialog"
      aria-modal={inline ? undefined : true}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onKeyDown={keydown}
      className={cx(
        'flex max-h-[calc(100vh-4rem)] w-full flex-col rounded-xl bg-surface shadow-modal',
        size === 'lg' ? 'max-w-[44rem]' : 'max-w-[32rem]',
        className,
      )}
    >
      <div className="px-5 pt-5 pb-3">
        <h2 id={titleId} className="text-title text-fg-heading">
          {title}
        </h2>
        {description ? (
          <p id={descId} className="mt-1 text-body text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
      {footer ? <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
    </div>
  );

  if (inline) return body;
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-8">
      <div aria-hidden className="absolute inset-0 bg-ink-900/40" onMouseDown={onClose} />
      <div className="relative flex w-full justify-center">{body}</div>
    </div>,
    document.body,
  );
}
