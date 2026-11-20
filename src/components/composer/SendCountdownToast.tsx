'use client';
/**
 * "Sending… Undo": the undo window between confirm and dispatch (brief 08 §2.4, 10 s by default).
 * `inline` takes the place of the send button (so Undo sits where you just clicked); `floating` is a
 * bottom-left toast for the Outbox. The bar drains as time runs out. Reused by the Outbox page.
 */
import { useEffect, useState } from 'react';
import { Icon, Kbd } from '@/ui';
import { cx } from './_bits';

export interface SendCountdownToastProps {
  /** Epoch ms when dispatch fires. */
  deadline: number;
  durationMs: number;
  /** "Sending to #acme-ext", "Pushing Slack draft". */
  label: string;
  dryRun?: boolean;
  onUndo: () => void;
  variant?: 'inline' | 'floating';
  /** Focus Undo on mount (Enter/Space then undoes). */
  autoFocusUndo?: boolean;
  now?: () => number;
  className?: string;
}

export function SendCountdownToast({ deadline, durationMs, label, dryRun, onUndo, variant = 'inline', autoFocusUndo = true, now = Date.now, className }: SendCountdownToastProps) {
  const [t, setT] = useState(() => now());
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setT(now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [now]);
  const remaining = Math.max(0, deadline - t);
  const secs = Math.ceil(remaining / 1000);
  const frac = durationMs > 0 ? remaining / durationMs : 0;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="send-countdown"
      className={cx(
        // Calm (DESIGN-V2): a raised neutral bar whose fill drains; the blue is the "now" indicator, Undo the action.
        'relative isolate flex items-center gap-3 overflow-hidden border border-line-strong bg-surface-raised text-fg',
        variant === 'floating' ? 'fixed bottom-6 left-6 z-50 h-14 min-w-96 rounded-lg px-4 text-body shadow-pop' : 'h-9 rounded-md pr-1 pl-3 text-body',
        className,
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 -z-10 bg-selected" style={{ width: `${frac * 100}%` }} />
      <Icon name={dryRun ? 'lock' : 'send'} size="sm" className="shrink-0 text-muted" />
      <span className="min-w-0 truncate">
        {label}
        {dryRun ? ' (dry run)' : ''} in <span className="font-bold tabular-nums">{secs}s</span>
      </span>
      <button
        type="button"
        autoFocus={autoFocusUndo}
        onClick={onUndo}
        data-testid="send-undo"
        className="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-caption font-bold text-link hover:bg-surface-muted focus-visible:shadow-focus focus-visible:outline-none"
      >
        <Icon name="undo" size="xs" />
        Undo
        <Kbd>⌘Z</Kbd>
      </button>
    </div>
  );
}
