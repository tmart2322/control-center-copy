/**
 * Draft autosave (UI-SPEC §8, §10): ~1 s debounce + blur + navigation, `PATCH /drafts/:id` with `ifVersion`.
 *
 * - Optimistic: `onOptimistic` patches caches before the request; a failure calls `onRollback` with the last
 *   server-confirmed draft (other views revert) while the editor keeps the unsaved text with "Couldn't save · Retry".
 * - 409: if the server's doc/destination still equal what our edits were based on (e.g. only status changed),
 *   rebase silently and retry. Otherwise surface `conflict` → "Changed elsewhere: keep yours / take theirs".
 * - Remote updates (live refetch): adopt when clean; rebase when the change doesn't touch our fields; conflict otherwise.
 *
 * Framework-free with injected I/O + timers; `useDraftAutosave` wraps it.
 */
import type { DispatchMode, Destination, Draft, MutationResult, PatchDraftRequest, TipTapDoc } from '@/contract';
import { normalizeDoc, stableStringify } from '@/lib/compose';
import { destinationKey } from './destination';

export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

export interface AutosaveState {
  status: AutosaveStatus;
  savedAt: string | null;
  /** Client clock (epoch ms) of the last save in this session, for "Saved · 2s ago" (the mock clock can differ). */
  savedLocalAt: number | null;
  error: { code: string; message: string } | null;
  /** Server draft that conflicts with our unsaved edits ("take theirs" adopts it). */
  conflict: Draft | null;
  dirty: boolean;
  baseVersion: number;
  /** Becomes true on the first local edit (server also sets `userTouched`). */
  touched: boolean;
}

export interface LocalEdit {
  doc?: TipTapDoc;
  destination?: Destination;
  mode?: DispatchMode;
}

export interface AutosaveDeps {
  patch: (body: PatchDraftRequest) => Promise<MutationResult<Draft>>;
  /** Cache write before the request (optimistic). */
  onOptimistic?: (draft: Draft) => void;
  /** Cache write after success (server entity). */
  onSaved?: (draft: Draft) => void;
  /** Cache restore after a failure (last server-confirmed draft). */
  onRollback?: (draft: Draft) => void;
  /** The editor must show this server draft (remote change while clean, or "take theirs"). */
  onAdopt?: (draft: Draft, reason: 'remote' | 'theirs') => void;
  debounceMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  now?: () => Date;
}

const docKey = (d: unknown) => stableStringify(normalizeDoc(d as TipTapDoc));

export class DraftAutosave {
  private deps: AutosaveDeps;
  private server: Draft;
  private pending: LocalEdit = {};
  /** The local view (server + pending). */
  private local: Draft;
  private timer: unknown = null;
  private inflight: Promise<boolean> | null = null;
  /** A server draft that arrived while our save was in flight; replayed once it lands. */
  private deferredRemote: Draft | null = null;
  private listeners = new Set<(s: AutosaveState) => void>();
  private state: AutosaveState;

  constructor(initial: Draft, deps: AutosaveDeps) {
    this.deps = deps;
    this.server = initial;
    this.local = initial;
    this.state = {
      status: initial.savedAt ? 'saved' : 'idle',
      savedAt: initial.savedAt,
      savedLocalAt: null,
      error: null,
      conflict: null,
      dirty: false,
      baseVersion: initial.version,
      touched: initial.userTouched,
    };
  }

  setDeps(deps: AutosaveDeps): void {
    this.deps = deps;
  }

  getState = (): AutosaveState => this.state;
  getLocal = (): Draft => this.local;
  getServer = (): Draft => this.server;

  subscribe = (fn: (s: AutosaveState) => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<AutosaveState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  private get debounce(): number {
    return this.deps.debounceMs ?? 1000;
  }

  private schedule(): void {
    this.cancelTimer();
    const set = this.deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.timer = set(() => {
      this.timer = null;
      void this.flush();
    }, this.debounce);
  }

  private cancelTimer(): void {
    if (this.timer != null) {
      (this.deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
      this.timer = null;
    }
  }

  /** A local edit (typing, destination switch, mode toggle). Debounced. */
  edit(change: LocalEdit): void {
    const sameDoc = change.doc && docKey(change.doc) === docKey(this.local.doc);
    const sameDest = change.destination && destinationKey(change.destination) === destinationKey(this.local.destination);
    const sameMode = change.mode && change.mode === this.local.mode;
    const effective: LocalEdit = {
      ...(change.doc && !sameDoc ? { doc: change.doc } : {}),
      ...(change.destination && !sameDest ? { destination: change.destination } : {}),
      ...(change.mode && !sameMode ? { mode: change.mode } : {}),
    };
    if (!Object.keys(effective).length) return;
    this.pending = { ...this.pending, ...effective };
    this.local = { ...this.local, ...effective, userTouched: true };
    this.deps.onOptimistic?.(this.local);
    this.set({ dirty: true, touched: true, status: this.state.status === 'conflict' ? 'conflict' : this.state.status === 'error' ? 'error' : 'dirty' });
    if (this.state.status !== 'conflict') this.schedule();
  }

  /** Save now (blur, navigation, before send). Resolves true when nothing is left unsaved. */
  async flush(): Promise<boolean> {
    this.cancelTimer();
    if (this.inflight) {
      while (this.inflight) await this.inflight;
      if (!this.state.dirty) return this.state.status !== 'error';
    }
    if (this.state.status === 'conflict') return false;
    if (!this.state.dirty) return this.state.status !== 'error';
    const attempt = this.saveOnce();
    this.inflight = attempt.then((r) => r.ok);
    const r = await attempt;
    this.inflight = null;
    if (r.rebase) return this.flush();
    const deferred = this.deferredRemote;
    this.deferredRemote = null;
    if (deferred) this.remote(deferred);
    if (r.ok && this.state.dirty) this.schedule();
    return r.ok;
  }

  private async saveOnce(): Promise<{ ok: boolean; rebase?: boolean }> {
    const body: PatchDraftRequest = { ifVersion: this.state.baseVersion, ...this.pending };
    const sent = this.pending;
    this.pending = {};
    this.set({ status: 'saving', error: null });
    try {
      const res = await this.deps.patch(body);
      this.server = res.entity;
      const stillPending = Object.keys(this.pending).length > 0;
      this.local = { ...res.entity, ...this.pending, userTouched: true };
      this.deps.onSaved?.(stillPending ? this.local : res.entity);
      this.set({
        status: stillPending ? 'dirty' : 'saved',
        savedAt: res.entity.savedAt ?? (this.deps.now?.() ?? new Date()).toISOString(),
        savedLocalAt: (this.deps.now?.() ?? new Date()).getTime(),
        baseVersion: res.entity.version,
        dirty: stillPending,
        error: null,
      });
      return { ok: true };
    } catch (err) {
      // Put the unsent fields back under anything typed since.
      this.pending = { ...sent, ...this.pending };
      const e = err as { code?: string; message?: string; current?: unknown; details?: { current?: unknown } };
      const current = (e.current ?? e.details?.current) as Draft | undefined;
      if (e.code === 'conflict' && current) {
        if (!this.touchesConflictingFields(current)) {
          // Only fields we didn't touch changed: rebase onto the server version and re-apply our intent.
          this.server = current;
          this.set({ baseVersion: current.version, status: 'dirty', dirty: true });
          return { ok: false, rebase: true };
        }
        this.deps.onRollback?.(this.server);
        this.cancelTimer();
        this.set({ status: 'conflict', conflict: current, dirty: true });
        return { ok: false };
      }
      this.deps.onRollback?.(this.server);
      this.set({ status: 'error', error: { code: e.code ?? 'unknown', message: e.message ?? 'Save failed' }, dirty: true });
      return { ok: false };
    }
  }

  /** The PATCH body that would save what's pending now (page-hide keepalive flush). Null when clean. */
  pendingBody(): PatchDraftRequest | null {
    if (!this.state.dirty || this.state.status === 'conflict' || !Object.keys(this.pending).length) return null;
    return { ifVersion: this.state.baseVersion, ...this.pending };
  }

  /** "Retry" on the inline status. */
  retry(): Promise<boolean> {
    if (this.state.status === 'error') this.set({ status: 'dirty' });
    return this.flush();
  }

  private touchesConflictingFields(current: Draft): boolean {
    if (this.pending.doc && docKey(current.doc) !== docKey(this.server.doc)) return true;
    if (this.pending.destination && destinationKey(current.destination) !== destinationKey(this.server.destination)) return true;
    if (this.pending.mode && current.mode !== this.server.mode) return true;
    return false;
  }

  /** "Keep yours": overwrite the server with the local version (based on theirs). */
  keepMine(): Promise<boolean> {
    const current = this.state.conflict;
    if (!current) return Promise.resolve(false);
    this.server = current;
    // Re-send every field that differs from theirs, not only what changed since the last save.
    const pending: LocalEdit = { ...this.pending };
    if (docKey(this.local.doc) !== docKey(current.doc)) pending.doc = this.local.doc;
    if (destinationKey(this.local.destination) !== destinationKey(current.destination)) pending.destination = this.local.destination;
    this.pending = pending;
    this.set({ conflict: null, baseVersion: current.version, status: 'dirty', dirty: true });
    return this.flush();
  }

  /** "Take theirs": drop local edits and show the server version. */
  takeTheirs(): void {
    const current = this.state.conflict;
    if (!current) return;
    this.cancelTimer();
    this.pending = {};
    this.server = current;
    this.local = current;
    this.deps.onSaved?.(current);
    this.deps.onAdopt?.(current, 'theirs');
    this.set({ conflict: null, baseVersion: current.version, status: 'saved', dirty: false, savedAt: current.savedAt, touched: current.userTouched });
  }

  /** A server draft arrived (live refetch, dispatch result, proposal apply). */
  remote(next: Draft): void {
    if (next.id !== this.server.id || next.version <= this.state.baseVersion) return;
    if (this.inflight) {
      // Our save is landing. Re-check this one afterwards (it may be someone else's newer version).
      if (!this.deferredRemote || next.version > this.deferredRemote.version) this.deferredRemote = next;
      return;
    }
    if (this.state.status === 'conflict') {
      this.set({ conflict: next });
      return;
    }
    if (!this.state.dirty) {
      const docChanged = docKey(next.doc) !== docKey(this.local.doc) || destinationKey(next.destination) !== destinationKey(this.local.destination);
      this.server = next;
      this.local = next;
      this.set({ baseVersion: next.version, touched: next.userTouched || this.state.touched });
      if (docChanged) this.deps.onAdopt?.(next, 'remote');
      return;
    }
    if (!this.touchesConflictingFields(next)) {
      this.server = next;
      this.local = { ...next, ...this.pending, userTouched: true };
      this.set({ baseVersion: next.version });
      return;
    }
    this.cancelTimer();
    this.set({ status: 'conflict', conflict: next });
  }

  dispose(): void {
    this.cancelTimer();
    this.listeners.clear();
  }
}
