'use client';
/**
 * Forced panel states (dev toolbar → "Force each panel state"). Panels call
 *
 *   const state = usePanelState('today.now', { loading: q.isLoading, error: q.error, empty: !cards.length });
 *
 * and render the matching branch. The dev toolbar can force every panel (or one id) to
 * empty / loading / error to check that each state exists (UI-SPEC §16).
 */
import { useSyncExternalStore } from 'react';

export type ForcedPanelState = 'empty' | 'loading' | 'error';
export type PanelState = 'ready' | ForcedPanelState;

interface Store {
  all: ForcedPanelState | null;
  byId: Record<string, ForcedPanelState>;
}

let store: Store = { all: null, byId: {} };
const listeners = new Set<() => void>();
const KEY = 'cc:dev:panel-state';

function emit() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}

let hydrated = false;
function hydrate() {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) store = { all: null, byId: {}, ...(JSON.parse(raw) as Partial<Store>) };
  } catch {
    /* ignore */
  }
}

export function forcePanelState(state: ForcedPanelState | null, id?: string) {
  hydrate();
  if (id) {
    const byId = { ...store.byId };
    if (state) byId[id] = state;
    else delete byId[id];
    store = { ...store, byId };
  } else store = { ...store, all: state };
  emit();
}

export function getForcedPanelState(): Store {
  hydrate();
  return store;
}

function subscribe(fn: () => void) {
  hydrate();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const SERVER: Store = { all: null, byId: {} };

export function useForcedPanelStates(): Store {
  return useSyncExternalStore(subscribe, getForcedPanelState, () => SERVER);
}

/** Resolve a panel's state: a dev override wins, then error, loading, empty, ready. */
export function usePanelState(id: string, flags: { loading?: boolean; error?: unknown; empty?: boolean }): PanelState {
  const forced = useForcedPanelStates();
  const f = forced.byId[id] ?? forced.all;
  if (f) return f;
  if (flags.error) return 'error';
  if (flags.loading) return 'loading';
  if (flags.empty) return 'empty';
  return 'ready';
}
