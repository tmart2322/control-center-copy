/**
 * Toast queue (pure; no React). UI-SPEC §9 rules it enforces:
 * - one channel per event: a `key` replaces an earlier toast for the same event instead of stacking;
 * - never a storm: at most MAX_TOASTS visible, the oldest drops first;
 * - toasts are for reversible things you just did (with Undo). Anything that needs action must also
 *   persist elsewhere (inline, rail, banner). That's the caller's job;
 * - errors stay (2026-11-13 audit C6): a `tone: 'error'` toast is sticky until dismissed unless the caller sets a
 *   duration, and the storm rule drops the oldest non-error first, so a failure never vanishes under newer news.
 */

export const MAX_TOASTS = 3;
export const TOAST_MS = 6000;
export const TOAST_SHORT_MS = 4800;

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export type ToastUndo =
  /** Universal undo: POST /audit/:id/undo. */
  | { auditId: string; label?: string }
  /** Local undo (no server change to reverse). */
  | { run: () => unknown | Promise<unknown>; label?: string };

export interface ToastSpec {
  /** Replace any visible toast with the same key (one channel per event). */
  key?: string;
  title: string;
  body?: string;
  tone?: ToastTone;
  /** ms; null = sticky until dismissed. Default 6000, and sticky for `tone: 'error'`. */
  durationMs?: number | null;
  undo?: ToastUndo;
  action?: { label: string; href?: string; onClick?: () => void };
}

export type ToastPhase = 'idle' | 'undoing' | 'undone' | 'undo_failed';

export interface ToastItem extends ToastSpec {
  id: string;
  createdAt: number;
  phase: ToastPhase;
  /** Bumps whenever the toast is replaced/updated, so timers restart. */
  rev: number;
  error?: string;
}

type Listener = () => void;

export class ToastStore {
  private items: ToastItem[] = [];
  private listeners = new Set<Listener>();
  private seq = 0;
  constructor(private readonly max = MAX_TOASTS) {}

  push(input: ToastSpec): string {
    const spec = withErrorDefaults(input);
    const existing = spec.key ? this.items.find((t) => t.key === spec.key) : undefined;
    if (existing) {
      // a replacement that is no longer an error gets the normal duration back (unless it says otherwise)
      const durationMs = 'durationMs' in input ? spec.durationMs : spec.tone === 'error' ? null : undefined;
      this.items = this.items.map((t) => (t.id === existing.id ? { ...t, ...spec, durationMs, phase: 'idle', error: undefined, rev: t.rev + 1, createdAt: Date.now() } : t));
      this.emit();
      return existing.id;
    }
    const id = `t${++this.seq}`;
    this.items = [...this.items, { ...spec, id, createdAt: Date.now(), phase: 'idle', rev: 0 }];
    while (this.items.length > this.max) this.items = dropOldest(this.items);
    this.emit();
    return id;
  }

  update(id: string, patch: Partial<Omit<ToastItem, 'id'>>, opts: { restartTimer?: boolean } = {}) {
    let changed = false;
    this.items = this.items.map((t) => {
      if (t.id !== id) return t;
      changed = true;
      return { ...t, ...patch, rev: opts.restartTimer ? t.rev + 1 : t.rev };
    });
    if (changed) this.emit();
  }

  dismiss(id: string) {
    const before = this.items.length;
    this.items = this.items.filter((t) => t.id !== id);
    if (this.items.length !== before) this.emit();
  }

  /** Dismiss the toast with this key, if one shows. */
  dismissKey(key: string) {
    const t = this.items.find((x) => x.key === key);
    if (t) this.dismiss(t.id);
  }

  clear() {
    this.items = [];
    this.emit();
  }

  /** The newest toast that still offers Undo (for `z` / ⌘Z). */
  latestUndoable(): ToastItem | undefined {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const t = this.items[i]!;
      if (t.undo && t.phase === 'idle') return t;
    }
    return undefined;
  }

  get(id: string): ToastItem | undefined {
    return this.items.find((t) => t.id === id);
  }

  getSnapshot = (): ToastItem[] => this.items;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit() {
    for (const l of this.listeners) l();
  }
}

/** An error toast without an explicit duration stays until dismissed (2026-11-13 audit C6). */
export function withErrorDefaults(spec: ToastSpec): ToastSpec {
  return spec.tone === 'error' && !('durationMs' in spec && spec.durationMs !== undefined) ? { ...spec, durationMs: null } : spec;
}

/** The storm rule: the oldest toast leaves first, but an error only once nothing else is left to drop. */
function dropOldest(items: ToastItem[]): ToastItem[] {
  const i = items.findIndex((t) => t.tone !== 'error');
  return i >= 0 ? [...items.slice(0, i), ...items.slice(i + 1)] : items.slice(1);
}

/** App-wide singleton. Toasts are pushed from client events only. */
export const toastStore = new ToastStore();

/** Show a toast. Returns its id. */
export function toast(spec: ToastSpec): string {
  return toastStore.push(spec);
}
