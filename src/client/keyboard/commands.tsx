'use client';
/**
 * Command registry behind the ⌘K palette. Any lane registers commands while mounted:
 *
 *   useCommands([
 *     { id: 'work.filter.mine', title: 'Filter: asked of me', group: 'Work', shortcut: 'f m', run: () => … },
 *   ]);
 *
 *   // The focused card/row/sheet registers its actions; the palette lists them FIRST.
 *   useFocusedCommands({ label: 'Reply to Dana: confirm scope' }, [
 *     { id: 'item.done', title: 'Mark done', shortcut: 'd', run: done },
 *     { id: 'item.snooze', title: 'Snooze…', shortcut: 's', run: snooze },
 *   ]);
 *
 * Commands only appear in the palette; bind their keys separately with useKeyBinding (the
 * `shortcut` field is the label the palette shows, so it teaches the key).
 */
import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

export interface CommandIcon {
  set: 'utility' | 'standard' | 'doctype';
  name: string;
}

export interface Command {
  id: string;
  title: string;
  /** Palette heading. Built-ins: "Go to", "Create", "View", "Help", "Dev". */
  group?: string;
  subtitle?: string;
  /** Key spec shown beside the command ("g h", "mod+enter", "d"). */
  shortcut?: string;
  /** Synonyms for fuzzy matching ("archive" finds Done). */
  keywords?: string[];
  icon?: CommandIcon;
  disabled?: boolean;
  /** Ordering inside its group (lower first). */
  order?: number;
  run: () => unknown;
}

export interface FocusedContext {
  label: string;
  kind?: string;
}

interface Snapshot {
  commands: Command[];
  focused: { context: FocusedContext; commands: Command[] } | null;
}

export class CommandStore {
  private sources = new Map<string, Command[]>();
  private focusedStack: Array<{ source: string; context: FocusedContext; commands: Command[] }> = [];
  private listeners = new Set<() => void>();
  private snapshot: Snapshot = { commands: [], focused: null };

  set(source: string, commands: Command[]) {
    this.sources.set(source, commands);
    this.rebuild();
  }

  remove(source: string) {
    this.sources.delete(source);
    this.focusedStack = this.focusedStack.filter((f) => f.source !== source);
    this.rebuild();
  }

  setFocused(source: string, context: FocusedContext | null, commands: Command[]) {
    this.focusedStack = this.focusedStack.filter((f) => f.source !== source);
    if (context) this.focusedStack.push({ source, context, commands });
    this.rebuild();
  }

  private rebuild() {
    const all: Command[] = [];
    const seen = new Set<string>();
    // Later registrations override earlier ones with the same id.
    for (const list of [...this.sources.values()].reverse()) {
      for (const c of list) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        all.push(c);
      }
    }
    const top = this.focusedStack.at(-1) ?? null;
    this.snapshot = { commands: all, focused: top ? { context: top.context, commands: top.commands } : null };
    for (const l of this.listeners) l();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;
}

const EMPTY: Snapshot = { commands: [], focused: null };
const CommandContext = createContext<CommandStore | null>(null);

export function CommandRegistryProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new CommandStore());
  return <CommandContext.Provider value={store}>{children}</CommandContext.Provider>;
}

export function useCommandStore(): CommandStore | null {
  return useContext(CommandContext);
}

/**
 * Register commands while mounted. Pass a fresh array each render if you like: the latest
 * `run` closures are used, and registration only churns when ids/titles/shortcuts change.
 */
export function useCommands(commands: Command[], opts: { enabled?: boolean } = {}) {
  const store = useCommandStore();
  const source = useId();
  const latest = useRef(commands);
  useEffect(() => {
    latest.current = commands;
  });
  const signature = commands.map((c) => `${c.id}\u0000${c.title}\u0000${c.shortcut ?? ''}\u0000${c.group ?? ''}\u0000${c.disabled ? 1 : 0}\u0000${c.subtitle ?? ''}`).join('\u0001');
  const enabled = opts.enabled ?? true;
  useEffect(() => {
    if (!store) return;
    if (!enabled) {
      store.remove(source);
      return;
    }
    store.set(
      source,
      latest.current.map((c) => ({ ...c, run: () => (latest.current.find((x) => x.id === c.id) ?? c).run() })),
    );
    return () => store.remove(source);
  }, [store, source, signature, enabled]);
}

/** The focused item's actions, listed first in ⌘K under the item's label. Pass null to clear. */
export function useFocusedCommands(context: FocusedContext | null, commands: Command[]) {
  const store = useCommandStore();
  const source = useId();
  const latest = useRef(commands);
  useEffect(() => {
    latest.current = commands;
  });
  const signature = context ? `${context.label}\u0000${commands.map((c) => `${c.id}:${c.title}:${c.shortcut ?? ''}:${c.disabled ? 1 : 0}`).join('|')}` : '';
  useEffect(() => {
    if (!store) return;
    if (!signature || !context) {
      store.setFocused(source, null, []);
      return;
    }
    store.setFocused(
      source,
      context,
      latest.current.map((c) => ({ ...c, run: () => (latest.current.find((x) => x.id === c.id) ?? c).run() })),
    );
    return () => store.setFocused(source, null, []);
    // context is captured via signature
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, source, signature]);
}

export function useCommandSnapshot(): Snapshot {
  const store = useCommandStore();
  return useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getSnapshot ?? emptySnapshot, emptySnapshot);
}

function noopSubscribe() {
  return () => {};
}
function emptySnapshot() {
  return EMPTY;
}
