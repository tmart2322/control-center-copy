/**
 * Global key manager: one keydown listener, scoped bindings, chords, focus-scope awareness.
 *
 * Scopes form a stack. 'global' is always at the bottom. A binding fires only when its scope is
 * active. Pushing a *modal* scope (dialog, palette, open menu) hides every scope beneath it,
 * including 'global', so `c` or `g h` never fire behind a dialog.
 *
 * Priority: the top-most scope wins; within a scope the most recently registered binding wins.
 * Single-key bindings never fire while focus is in a text field unless `allowInInput` is set.
 * A handler may return `false` to pass the key on to the next candidate.
 */
import { CHORD_TIMEOUT_MS, comboMatches, isEditableTarget, isModifierKey, parseSequence, type KeyLike, type KeySequence } from './keymap';

export const GLOBAL_SCOPE = 'global';

export interface BindingOptions {
  scope?: string;
  /** Fire even when focus is in an input/textarea/contenteditable. Default false. */
  allowInInput?: boolean;
  /** Call preventDefault when handled. Default true. */
  preventDefault?: boolean;
  /** Shown in the cheat sheet / palette. */
  description?: string;
  group?: string;
}

export interface Binding extends Required<Pick<BindingOptions, 'scope' | 'allowInInput' | 'preventDefault'>> {
  id: number;
  spec: string;
  sequence: KeySequence;
  handler: (e: KeyLike) => void | boolean;
  description?: string;
  group?: string;
}

interface ScopeEntry {
  token: number;
  id: string;
  modal: boolean;
}

interface Pending {
  candidates: Binding[];
  index: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface HandleResult {
  handled: boolean;
  /** A chord prefix was consumed and we're waiting for the next key. */
  pending: boolean;
  binding?: Binding;
}

export class KeyManager {
  private bindings = new Map<number, Binding>();
  private scopes: ScopeEntry[] = [];
  private pending: Pending | null = null;
  private seq = 0;
  private listeners = new Set<() => void>();
  readonly isMac: boolean;
  /** Visible chord prefix (e.g. "g") for a tiny on-screen hint. */
  pendingLabel: string | null = null;

  constructor(opts: { isMac?: boolean } = {}) {
    this.isMac = opts.isMac ?? true;
  }

  register(spec: string, handler: Binding['handler'], opts: BindingOptions = {}): () => void {
    const id = ++this.seq;
    const binding: Binding = {
      id,
      spec,
      sequence: parseSequence(spec),
      handler,
      scope: opts.scope ?? GLOBAL_SCOPE,
      allowInInput: opts.allowInInput ?? false,
      preventDefault: opts.preventDefault ?? true,
      description: opts.description,
      group: opts.group,
    };
    this.bindings.set(id, binding);
    this.emit();
    return () => {
      this.bindings.delete(id);
      this.emit();
    };
  }

  pushScope(id: string, opts: { modal?: boolean } = {}): () => void {
    const token = ++this.seq;
    this.scopes.push({ token, id, modal: Boolean(opts.modal) });
    this.resetPending();
    this.emit();
    return () => {
      this.scopes = this.scopes.filter((s) => s.token !== token);
      this.resetPending();
      this.emit();
    };
  }

  /** Active scope ids, top-most first. Stops at (and includes) the first modal scope. */
  activeScopes(): string[] {
    const out: string[] = [];
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const s = this.scopes[i]!;
      if (!out.includes(s.id)) out.push(s.id);
      if (s.modal) return out;
    }
    out.push(GLOBAL_SCOPE);
    return out;
  }

  isScopeActive(id: string): boolean {
    return this.activeScopes().includes(id);
  }

  hasModal(): boolean {
    return this.scopes.some((s) => s.modal);
  }

  listBindings(): Binding[] {
    return [...this.bindings.values()];
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  private resetPending() {
    if (this.pending?.timer) clearTimeout(this.pending.timer);
    this.pending = null;
    if (this.pendingLabel !== null) {
      this.pendingLabel = null;
      this.emit();
    }
  }

  /** Candidates ordered by priority: top scope first, newest binding first. */
  private candidates(editable: boolean): Binding[] {
    const scopes = this.activeScopes();
    const all = [...this.bindings.values()].filter((b) => scopes.includes(b.scope) && (!editable || b.allowInInput));
    return all.sort((a, b) => scopes.indexOf(a.scope) - scopes.indexOf(b.scope) || b.id - a.id);
  }

  private fire(b: Binding, e: KeyLike): boolean {
    return b.handler(e) !== false;
  }

  handle(e: KeyLike): HandleResult {
    if (e.isComposing || isModifierKey(e.key)) return { handled: false, pending: false };
    const editable = isEditableTarget(e.target);

    if (this.pending) {
      const { candidates, index } = this.pending;
      const next = candidates.filter((b) => b.sequence[index] && comboMatches(b.sequence[index]!, e, this.isMac));
      this.resetPending();
      if (next.length) {
        const complete = next.filter((b) => b.sequence.length === index + 1);
        for (const b of complete) if (this.fire(b, e)) return { handled: true, pending: false, binding: b };
        const longer = next.filter((b) => b.sequence.length > index + 1);
        if (longer.length) {
          this.startPending(longer, index + 1, e);
          return { handled: true, pending: true };
        }
      }
      // Fall through: treat this key as a fresh press.
    }

    const fresh = this.candidates(editable).filter((b) => comboMatches(b.sequence[0]!, e, this.isMac));
    if (!fresh.length) return { handled: false, pending: false };
    for (const b of fresh.filter((x) => x.sequence.length === 1)) {
      if (this.fire(b, e)) return { handled: true, pending: false, binding: b };
    }
    const chords = fresh.filter((b) => b.sequence.length > 1);
    if (chords.length) {
      this.startPending(chords, 1, e);
      return { handled: true, pending: true };
    }
    return { handled: false, pending: false };
  }

  private startPending(candidates: Binding[], index: number, e: KeyLike) {
    this.pending = {
      candidates,
      index,
      timer: typeof setTimeout === 'function' ? setTimeout(() => this.resetPending(), CHORD_TIMEOUT_MS) : null,
    };
    this.pendingLabel = (this.pendingLabel ? `${this.pendingLabel} ` : '') + e.key.toLowerCase();
    this.emit();
  }
}
