'use client';
/**
 * Composer-local confirm shell for the border dialog (ConfirmSendDialog). The modal mechanics come from
 * `@/ui` Overlay (portal, backdrop, focus trap, Esc, focus restore and a modal key scope, so page
 * shortcuts like `d` or `c` never fire behind the confirm). What @/ui Dialog doesn't offer, and the
 * border confirm needs, lives here: a free-form footer (dry-run note + Cancel + Send), a wide size, ⌘↵
 * handling and an inline specimen mode for the kit gallery.
 */
import { useId, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Overlay } from '@/ui';
import { cx } from './cx';

export interface ConfirmFrameProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  size?: 'md' | 'lg';
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  className?: string;
  /** Render in place without a portal/backdrop (kit gallery specimens). */
  inline?: boolean;
}

export function ConfirmFrame({ open, onClose, title, description, children, footer, initialFocusRef, size = 'md', onKeyDown, className, inline }: ConfirmFrameProps) {
  const titleId = useId();
  const descId = useId();
  if (!open) return null;

  const body = (
    <div
      role={inline ? 'dialog' : undefined}
      aria-labelledby={inline ? titleId : undefined}
      onKeyDown={onKeyDown}
      className={cx('flex w-full flex-col', inline ? 'max-h-[calc(100vh-4rem)] rounded-xl bg-surface-overlay shadow-modal' : 'max-h-[80vh]', size === 'lg' ? 'max-w-[44rem]' : 'max-w-[32rem]', className)}
      style={inline ? undefined : { width: size === 'lg' ? '44rem' : '32rem' }}
    >
      <div className="px-6 pt-6 pb-4">
        <h2 id={titleId} className="text-title text-fg-heading">
          {title}
        </h2>
        {description ? (
          <p id={descId} className="mt-1.5 max-w-[68ch] text-body text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <div className="cc-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-5">{children}</div>
      {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4">{footer}</div> : null}
    </div>
  );

  if (inline) return body;
  return (
    <Overlay open={open} onClose={onClose} initialFocusRef={initialFocusRef} labelledBy={titleId} describedBy={description ? descId : undefined} role="dialog" className="flex max-w-[calc(100vw-4rem)] flex-col">
      {body}
    </Overlay>
  );
}
