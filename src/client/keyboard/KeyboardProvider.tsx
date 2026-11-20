'use client';
/**
 * React bindings for the KeyManager: one window keydown listener for the whole app.
 *
 *   useKeyBinding('g h', () => navigate('/'), { description: 'Go to Home' });
 *   useKeyBinding(['j', 'down'], next, { scope: 'list:work' });
 *   useKeyScope('list:work', { active: listHasFocus });
 *   useKeyScope('dialog', { active: open, modal: true });   // hides everything beneath it
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { detectMac } from './keymap';
import { KeyManager, type BindingOptions } from './manager';

const KeyboardContext = createContext<KeyManager | null>(null);

export function KeyboardProvider({ children }: { children: ReactNode }) {
  const [manager] = useState(() => new KeyManager({ isMac: detectMac() }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const r = manager.handle(e);
      if (r.handled && (r.pending || r.binding?.preventDefault !== false)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [manager]);

  return <KeyboardContext.Provider value={manager}>{children}</KeyboardContext.Provider>;
}

/** The app's KeyManager, or null outside the provider (bindings then no-op). */
export function useKeyManager(): KeyManager | null {
  return useContext(KeyboardContext);
}

export interface UseKeyBindingOptions extends BindingOptions {
  /** Register only while true. Default true. */
  enabled?: boolean;
}

/** Bind one or more key specs to a handler while the component is mounted (and `enabled`). */
export function useKeyBinding(spec: string | string[], handler: (e: KeyboardEvent) => void | boolean, opts: UseKeyBindingOptions = {}) {
  const manager = useKeyManager();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  const specs = Array.isArray(spec) ? spec : [spec];
  const key = specs.join('|');
  const { enabled = true, scope, allowInInput, preventDefault, description, group } = opts;
  useEffect(() => {
    if (!manager || !enabled) return;
    const offs = key.split('|').map((s) => manager.register(s, (e) => ref.current(e as KeyboardEvent), { scope, allowInInput, preventDefault, description, group }));
    return () => offs.forEach((off) => off());
  }, [manager, key, enabled, scope, allowInInput, preventDefault, description, group]);
}

/** Push a key scope while `active`. Modal scopes block every scope beneath them, including global. */
export function useKeyScope(id: string, opts: { active?: boolean; modal?: boolean } = {}) {
  const manager = useKeyManager();
  const { active = true, modal = false } = opts;
  useEffect(() => {
    if (!manager || !active) return;
    return manager.pushScope(id, { modal });
  }, [manager, id, active, modal]);
}

/** Re-render on manager changes (bindings/scopes/pending chord). */
export function useKeyManagerState<T>(select: (m: KeyManager) => T): T | null {
  const manager = useKeyManager();
  const subscribe = useMemo(() => (fn: () => void) => manager?.subscribe(fn) ?? (() => {}), [manager]);
  return useSyncExternalStore(
    subscribe,
    () => (manager ? select(manager) : null),
    () => null,
  );
}

/** True on macOS (⌘) — for rendering shortcuts. SSR assumes mac (the target machine). */
export function useIsMac(): boolean {
  return useKeyManager()?.isMac ?? true;
}
