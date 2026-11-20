'use client';
/**
 * Short, blocking confirm (v2: L3 surface, `rounded-xl p-6 shadow-modal`, 22 px title). Cancel is focused by
 * default so Enter never fires the risky action by accident. Use only at the border (sends,
 * dry-run off) or for destructive moments; everything else is undoable instead.
 */
import { useId, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import { Overlay } from './Overlay';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void | Promise<unknown>;
  /** danger = destructive confirm (red). */
  tone?: 'primary' | 'danger';
  busy?: boolean;
  /** Key hint on the confirm button (e.g. "mod+enter"). */
  confirmKbd?: string;
  width?: number;
}

export function Dialog({ open, onClose, title, description, children, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, tone = 'primary', busy, confirmKbd, width = 440 }: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  return (
    <Overlay open={open} onClose={() => !busy && onClose()} initialFocusRef={cancelRef} labelledBy={titleId} describedBy={description ? descId : undefined} role="alertdialog" dismissable={!busy} className="p-6">
      <div style={{ width }} className="max-w-[90vw]">
        <h2 id={titleId} className="text-title text-fg-heading">
          {title}
        </h2>
        {description ? (
          <div id={descId} className="mt-2 max-w-[68ch] text-body text-muted">
            {description}
          </div>
        ) : null}
        {children ? <div className="mt-4">{children}</div> : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button ref={cancelRef} variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          {onConfirm ? (
            <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={() => void onConfirm()} loading={busy} kbd={confirmKbd}>
              {confirmLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </Overlay>
  );
}
