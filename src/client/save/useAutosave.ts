'use client';
/**
 * useAutosave(value, save, { debounceMs: 1000 }): the autosave model for drafts, notes, task fields
 * and activity rows (UI-SPEC §8). Saves ~1 s after typing stops, on blur, on route change, when
 * the tab hides, and on unmount. Spread `bind` on the field for blur-saves; render
 * `<InlineStatus {...status} />` beside it.
 *
 *   const [title, setTitle] = useState(item.title);
 *   const patch = useOptimisticMutation({ route: 'patchItem' });
 *   const autosave = useAutosave(title, (v) =>
 *     patch.mutateAsync({ params: { id: item.id }, body: { ifVersion: patch.versionOf(item.id) ?? item.version, patch: { title: v } } }));
 *   <input value={title} onChange={(e) => setTitle(e.target.value)} {...autosave.bind} />
 *   <InlineStatus {...autosave.status} />
 */
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { InlineStatusProps } from '@/ui/states';
import { Autosaver, type AutosaveSnapshot } from './autosaver';

export interface UseAutosaveOptions<T> {
  debounceMs?: number;
  isEqual?: (a: T, b: T) => boolean;
  /** Pause saving (e.g. while a conflict is shown). */
  enabled?: boolean;
}

export interface UseAutosaveResult {
  state: AutosaveSnapshot['state'];
  savedAt: number | null;
  error: string | null;
  flush: () => Promise<void>;
  retry: () => Promise<void>;
  /** Treat `value` as the saved baseline (after taking the server's value). */
  reset: (value: unknown) => void;
  bind: { onBlur: () => void };
  status: InlineStatusProps;
}

export function useAutosave<T>(value: T, save: (value: T) => Promise<unknown>, opts: UseAutosaveOptions<T> = {}): UseAutosaveResult {
  const { debounceMs = 1000, isEqual, enabled = true } = opts;
  const [snap, setSnap] = useState<AutosaveSnapshot>({ state: 'idle', savedAt: null, error: null });
  const saverRef = useRef<Autosaver<T> | null>(null);
  if (!saverRef.current) saverRef.current = new Autosaver<T>(value, { save, debounceMs, isEqual, onChange: setSnap });
  const saver = saverRef.current;

  useEffect(() => {
    saver.setSave(save);
  });

  useEffect(() => {
    if (enabled) saver.update(value);
  }, [saver, value, enabled]);

  // Flush on navigation.
  const pathname = usePathname();
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      void saver.flush();
    }
  }, [pathname, saver]);

  // Flush when the tab hides or the page unloads, and on unmount.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void saver.flush();
    };
    const onUnload = () => void saver.flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onUnload);
      void saver.flush().finally(() => saver.dispose());
    };
  }, [saver]);

  const flush = useCallback(() => saver.flush(), [saver]);
  const retry = useCallback(() => saver.retry(), [saver]);
  const reset = useCallback((v: unknown) => saver.reset(v as T), [saver]);

  return {
    ...snap,
    flush,
    retry,
    reset,
    bind: { onBlur: () => void saver.flush() },
    status: { state: snap.state, savedAt: snap.savedAt, error: snap.error, onRetry: () => void saver.retry() },
  };
}
