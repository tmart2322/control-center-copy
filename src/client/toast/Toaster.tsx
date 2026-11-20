'use client';
/**
 * Bottom-left toast stack (UI-SPEC §5.3/§9): at most 3, ~6 s each, paused on hover/focus.
 * Undo calls POST /audit/:id/undo through the typed client; the result becomes "Undone · Redo"
 * (undoing an undo is redo). `z` and ⌘Z undo the newest undoable toast. Every toast can be closed: the × (drawn
 * inline, so it shows even when the icon sprite has not loaded) or Escape while the toast has focus.
 */
import { AppLink } from '@/components/shell/AppLink';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/client/api';
import { useKeyBinding } from '@/client/keyboard/KeyboardProvider';
import { cn } from '@/ui/cn';
import { Icon } from '@/ui/Icon';
import { KbdHint } from '@/ui/Kbd';
import { Spinner } from '@/ui/Spinner';
import { TOAST_MS, TOAST_SHORT_MS, toastStore, type ToastItem, type ToastTone } from './store';

const TONE: Record<ToastTone, { box: string; icon: string; action: string }> = {
  info: { box: 'bg-ink-600 text-on-solid', icon: 'info', action: 'text-on-solid hover:bg-current/15' },
  success: { box: 'bg-success-600 text-on-solid', icon: 'success', action: 'text-on-solid hover:bg-current/15' },
  warning: { box: 'bg-warning-200 text-fg', icon: 'warning', action: 'text-fg hover:bg-black/10' },
  error: { box: 'bg-danger-600 text-on-solid', icon: 'error', action: 'text-on-solid hover:bg-current/15' },
};

/** Run a toast's Undo. Exported so ⌘Z and the kit can trigger it. */
export async function runToastUndo(id: string, invalidate: () => void) {
  const t = toastStore.get(id);
  if (!t?.undo || t.phase === 'undoing') return;
  toastStore.update(id, { phase: 'undoing', error: undefined });
  try {
    if ('auditId' in t.undo) {
      const res = await api('undoAudit', { params: { id: t.undo.auditId }, body: {} });
      invalidate();
      const base = t.title.replace(/^(Undone|Redone): /, '');
      const wasRedo = t.undo.label === 'Redo';
      toastStore.update(
        id,
        {
          phase: 'idle',
          tone: 'info',
          title: `${wasRedo ? 'Redone' : 'Undone'}: ${base}`,
          body: undefined,
          undo: res.auditId ? { auditId: res.auditId, label: wasRedo ? 'Undo' : 'Redo' } : undefined,
          durationMs: TOAST_SHORT_MS,
        },
        { restartTimer: true },
      );
    } else {
      await t.undo.run();
      invalidate();
      toastStore.update(id, { phase: 'undone', tone: 'info', title: `Undone: ${t.title}`, body: undefined, undo: undefined, durationMs: TOAST_SHORT_MS }, { restartTimer: true });
    }
  } catch (err) {
    const msg = err instanceof ApiError ? (err.code === 'conflict' ? 'It changed since; open its history to roll back' : err.message) : String(err);
    toastStore.update(id, { phase: 'undo_failed', tone: 'error', error: msg, durationMs: null }, { restartTimer: true });
  }
}

function ToastView({ t, onUndo }: { t: ToastItem; onUndo: (id: string) => void }) {
  const tone = TONE[t.tone ?? 'info'];
  const hovering = useRef(false);
  const remaining = useRef<number>(t.durationMs === undefined ? TOAST_MS : (t.durationMs ?? Infinity));
  const started = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barRef = useRef<HTMLSpanElement | null>(null);

  const start = useCallback(() => {
    if (!Number.isFinite(remaining.current)) return;
    started.current = Date.now();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => toastStore.dismiss(t.id), remaining.current);
    if (barRef.current) {
      barRef.current.style.animationPlayState = 'running';
    }
  }, [t.id]);

  const pause = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    remaining.current = Math.max(800, remaining.current - (Date.now() - started.current));
    if (barRef.current) barRef.current.style.animationPlayState = 'paused';
  }, []);

  useEffect(() => {
    remaining.current = t.durationMs === undefined ? TOAST_MS : (t.durationMs ?? Infinity);
    if (!hovering.current && t.phase !== 'undoing') start();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [t.rev, t.durationMs, t.phase, start]);

  const duration = t.durationMs === undefined ? TOAST_MS : t.durationMs;
  const failed = t.phase === 'undo_failed';
  return (
    <div
      role={t.tone === 'error' || failed ? 'alert' : 'status'}
      onMouseEnter={() => {
        hovering.current = true;
        pause();
      }}
      onMouseLeave={() => {
        hovering.current = false;
        start();
      }}
      onFocus={pause}
      onBlur={start}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        toastStore.dismiss(t.id);
      }}
      className={cn('pointer-events-auto relative flex w-[min(30rem,calc(100vw-2rem))] items-start gap-3 overflow-hidden rounded-lg py-2.5 pr-2 pl-3.5 text-body-lg shadow-pop', tone.box)}
    >
      <Icon name={failed ? 'error' : tone.icon} size="md" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 py-px">
        <p className="leading-5 font-bold">{t.title}</p>
        {t.body ? <p className="text-body whitespace-pre-line opacity-90">{t.body}</p> : null}
        {failed && t.error ? <p className="text-body opacity-90">Couldn&apos;t undo: {t.error}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {t.undo ? (
          <button
            type="button"
            onClick={() => onUndo(t.id)}
            disabled={t.phase === 'undoing'}
            className={cn('inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-body font-bold focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_currentColor]', tone.action)}
          >
            {t.phase === 'undoing' ? <Spinner size="xs" /> : null}
            {failed ? 'Retry' : (t.undo.label ?? 'Undo')}
            {!failed && t.phase !== 'undoing' ? <KbdHint combo="z" tone={t.tone === 'warning' ? 'default' : 'inverse'} /> : null}
          </button>
        ) : null}
        {t.action ? (
          t.action.href ? (
            <AppLink href={t.action.href} className={cn('inline-flex h-7 items-center rounded-full px-2.5 text-body font-bold no-underline hover:no-underline', tone.action)} onClick={() => toastStore.dismiss(t.id)}>
              {t.action.label}
            </AppLink>
          ) : (
            <button
              type="button"
              onClick={() => {
                t.action?.onClick?.();
                toastStore.dismiss(t.id);
              }}
              className={cn('inline-flex h-7 items-center rounded-full px-2.5 text-body font-bold', tone.action)}
            >
              {t.action.label}
            </button>
          )
        ) : null}
        <button type="button" aria-label="Dismiss" title="Dismiss (Esc)" data-testid="toast-dismiss" onClick={() => toastStore.dismiss(t.id)} className={cn('grid size-7 place-items-center rounded-full focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_currentColor]', tone.action)}>
          <CloseGlyph />
        </button>
      </div>
      {duration !== null && Number.isFinite(duration) ? (
        <span
          key={t.rev}
          ref={barRef}
          aria-hidden
          className="cc-toast-timer absolute inset-x-0 bottom-0 h-0.5 origin-left bg-current opacity-30"
          style={{ animationDuration: `${duration}ms` }}
        />
      ) : null}
    </div>
  );
}

export function Toaster() {
  const items = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, () => EMPTY);
  const qc = useQueryClient();
  const invalidate = useCallback(() => void qc.invalidateQueries(), [qc]);
  const onUndo = useCallback((id: string) => void runToastUndo(id, invalidate), [invalidate]);

  useKeyBinding(['z', 'mod+z'], () => {
    const t = toastStore.latestUndoable();
    if (!t) return false;
    onUndo(t.id);
  });

  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-[calc(var(--utility-h)+0.75rem)] left-3 z-[85] flex flex-col gap-2">
      {items.map((t) => (
        <ToastView key={t.id} t={t} onUndo={onUndo} />
      ))}
    </div>
  );
}

const EMPTY: ToastItem[] = [];

/** The ×, inline: a toast must stay closable even when /icons/utility.svg failed to load (a server restart mid-page). */
function CloseGlyph() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
    </svg>
  );
}
