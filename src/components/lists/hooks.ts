'use client';
/**
 * Shared hooks for the list pages: the domain clock, URL-synced filters (200 ms debounce, the VDP
 * pattern), stable ordering under live updates, and the page's "focus the next row after I act" helper.
 */
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useKeyBinding } from '@/client/keyboard';
import { useNow, useTimeZone } from '@/ui';
import { useLiveList, type LiveList, type LiveListOptions } from './live-list';

/** The app's "now" (server clock) and profile timezone for <DomainClock>. Minute resolution is plenty. */
export function usePageClock(): { now: string; tz: string | undefined } {
  const now = useNow(30_000);
  const tz = useTimeZone();
  return { now: now.toISOString(), tz };
}

/** URL params the shell's docked panel owns (PanelUrlSync). Filters never drop them. */
const PANEL_PARAMS = ['panel', 'item'] as const;

export interface UseUrlFiltersOptions<F> {
  parse: (p: URLSearchParams) => F;
  serialize: (f: F) => string;
  debounceMs?: number;
}

/**
 * Filters that live in the URL. `value` updates instantly (inputs stay responsive); `committed` and the
 * URL follow after the debounce, and `committed` is what queries use. `immediate` skips the debounce
 * (tabs, grouping). External URL changes (back/forward, links) are adopted.
 */
export function useUrlFilters<F>({ parse, serialize, debounceMs = 200 }: UseUrlFiltersOptions<F>) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const spString = sp.toString();
  const [value, setValue] = useState<F>(() => parse(new URLSearchParams(spString)));
  const [committed, setCommitted] = useState<F>(value);
  const latest = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWritten = useRef(serialize(value));
  const fns = useRef({ parse, serialize });
  fns.current = { parse, serialize };

  const commit = useCallback(
    (next: F) => {
      const qs = fns.current.serialize(next);
      lastWritten.current = qs;
      setCommitted(next);
      // Native replaceState (Next syncs useSearchParams with it): no RSC round-trip per keystroke, and the
      // URL is updated the moment the debounce fires. The docked panel's own params (?panel=details&item=…)
      // belong to the shell and survive a filter change.
      const out = new URLSearchParams(qs);
      const current = new URLSearchParams(window.location.search);
      for (const k of PANEL_PARAMS) {
        const v = current.get(k);
        if (v !== null && !out.has(k)) out.set(k, v);
      }
      const full = out.toString();
      window.history.replaceState(window.history.state, '', full ? `${pathname}?${full}` : pathname);
    },
    [pathname],
  );

  const update = useCallback(
    (patch: Partial<F> | ((f: F) => F), opts: { immediate?: boolean } = {}) => {
      const next = typeof patch === 'function' ? patch(latest.current) : { ...latest.current, ...patch };
      latest.current = next;
      setValue(next);
      if (timer.current) clearTimeout(timer.current);
      if (opts.immediate) commit(next);
      else timer.current = setTimeout(() => commit(latest.current), debounceMs);
    },
    [commit, debounceMs],
  );

  // Adopt URL changes we didn't make (back/forward, a link with filters).
  useEffect(() => {
    const incoming = fns.current.parse(new URLSearchParams(spString));
    const incomingQs = fns.current.serialize(incoming);
    if (incomingQs === lastWritten.current || timer.current) return;
    lastWritten.current = incomingQs;
    latest.current = incoming;
    setValue(incoming);
    setCommitted(incoming);
  }, [spString]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { value, committed, update, pending: value !== committed };
}

export type { LiveList as StableList, LiveListOptions } from './live-list';

/**
 * Live updates never reorder rows under the cursor (UI-SPEC §10). The shared live-list pattern (src/components/lists/
 * live-list.ts, docs/UX.md "Live updates"): stable order, arrivals at their natural place (or behind the "N new ·
 * Show" pill), rows that left elsewhere fade out in place, Undo puts a row back where it was.
 * `hold` (placeholder data while a new query loads) freezes the order so stale rows are never mistaken for new.
 */
export function useStableList<T extends { id: string }>(data: T[] | undefined, resetKey: string, hold = false, opts: Omit<LiveListOptions, 'frozen'> = {}): LiveList<T> {
  return useLiveList(data, resetKey, { ...opts, frozen: hold });
}

/** Focus a row/card by its `data-item-id` after the DOM settles (used after an action removes the focused row). */
export function focusItemSoon(root: HTMLElement | null | undefined, id: string | null | undefined) {
  if (!id) return;
  let tries = 0;
  const go = () => {
    const el = (root ?? document).querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`);
    if (el) el.focus({ preventScroll: false });
    else if (tries++ < 10) requestAnimationFrame(go);
  };
  requestAnimationFrame(go);
}

/** The neighbour to land on when `id` leaves the list: the next row, else the previous. */
export function neighbourOf(ids: string[], id: string): string | null {
  const i = ids.indexOf(id);
  if (i < 0) return null;
  return ids[i + 1] ?? ids[i - 1] ?? null;
}

/** Invalidate every query under the given live topics. */
export function useInvalidate() {
  const qc = useQueryClient();
  return useCallback((...topics: string[]) => Promise.all(topics.map((t) => qc.invalidateQueries({ queryKey: [t] }))), [qc]);
}

/** True when the key's target is something that handles Enter / Space itself (a button, link, field, tab…). */
export function isSelfHandling(target: EventTarget | null, except?: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const el = target.closest('button,a[href],input,textarea,select,summary,[role=tab],[role=radio],[role=checkbox],[role=menuitem],[role=menuitemradio],[contenteditable=true]');
  if (!el) return false;
  return except ? !el.closest(except) : true;
}

/**
 * Enter / ⇧Enter / Space for a list, without stealing them from controls inside a row. useListKeys binds
 * Enter at window level and calls preventDefault, which would cancel the click on a focused "Accept" or
 * "Approve" button. These bindings step aside (return false) when the key belongs to a control.
 */
export function useOpenKeys(opts: {
  scope: string;
  enabled: boolean;
  activeId: string | null;
  onOpen?: (id: string) => void;
  onOpenPage?: (id: string) => void;
  onExpand?: (id: string) => void;
  /** Selector of controls that should still open the item (e.g. a Briefs list row's own button). */
  allowIn?: string;
}) {
  const { scope, enabled, activeId, allowIn } = opts;
  const run = (fn?: (id: string) => void) => (e: KeyboardEvent) => {
    if (!fn || !activeId || isSelfHandling(e.target, allowIn)) return false;
    fn(activeId);
  };
  useKeyBinding('enter', run(opts.onOpen), { scope, enabled: enabled && !!opts.onOpen });
  useKeyBinding('shift+enter', run(opts.onOpenPage), { scope, enabled: enabled && !!opts.onOpenPage });
  useKeyBinding('space', run(opts.onExpand), { scope, enabled: enabled && !!opts.onExpand });
}
