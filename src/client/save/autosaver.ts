/**
 * Autosave engine (pure; no React). UI-SPEC §8 default for low-stakes private edits:
 * ~1 s debounce after the last change, plus flush on blur and on navigation.
 *
 * - Saves never overlap: a change during an in-flight save is queued and saved right after.
 * - A failed save keeps the pending value; `retry()` (or the next change) tries again.
 * - The initial value counts as saved, so mounting never triggers a write.
 */

export type AutosaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface AutosaveSnapshot {
  state: AutosaveState;
  /** ms epoch of the last successful save. */
  savedAt: number | null;
  error: string | null;
}

export interface AutosaverOptions<T> {
  save: (value: T) => Promise<unknown>;
  debounceMs?: number;
  isEqual?: (a: T, b: T) => boolean;
  onChange?: (s: AutosaveSnapshot) => void;
  now?: () => number;
}

export class Autosaver<T> {
  private saved: T;
  private pending: { value: T } | null = null;
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private snap: AutosaveSnapshot = { state: 'idle', savedAt: null, error: null };
  private readonly debounceMs: number;
  private readonly isEqual: (a: T, b: T) => boolean;
  private readonly now: () => number;

  constructor(
    initial: T,
    private opts: AutosaverOptions<T>,
  ) {
    this.saved = initial;
    this.debounceMs = opts.debounceMs ?? 1000;
    this.isEqual = opts.isEqual ?? Object.is;
    this.now = opts.now ?? Date.now;
  }

  get snapshot(): AutosaveSnapshot {
    return this.snap;
  }

  /** Swap the save function (React re-renders pass a fresh closure). */
  setSave(save: (value: T) => Promise<unknown>) {
    this.opts = { ...this.opts, save };
  }

  /** The value changed locally. */
  update(value: T) {
    if (!this.inFlight && this.isEqual(value, this.saved)) {
      this.pending = null;
      this.clearTimer();
      if (this.snap.state === 'dirty' || this.snap.state === 'error') this.set({ state: this.snap.savedAt ? 'saved' : 'idle', error: null });
      return;
    }
    this.pending = { value };
    if (this.snap.state !== 'saving') this.set({ state: 'dirty', error: null });
    this.clearTimer();
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  /** The server value changed underneath (e.g. after a rebase): treat it as saved. */
  reset(value: T) {
    this.saved = value;
    this.pending = null;
    this.clearTimer();
  }

  /** Save now (blur, navigation, unmount). Resolves when nothing is pending. */
  async flush(): Promise<void> {
    this.clearTimer();
    if (this.inFlight || !this.pending) return;
    const { value } = this.pending;
    if (this.isEqual(value, this.saved)) {
      this.pending = null;
      return;
    }
    this.inFlight = true;
    this.set({ state: 'saving', error: null });
    try {
      await this.opts.save(value);
      this.saved = value;
      if (this.pending && this.isEqual(this.pending.value, value)) this.pending = null;
      this.inFlight = false;
      this.set({ state: 'saved', savedAt: this.now(), error: null });
      if (this.pending) await this.flush();
    } catch (err) {
      this.inFlight = false;
      this.set({ state: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  retry(): Promise<void> {
    return this.flush();
  }

  /** Stop the debounce timer (unmount). Call flush() first to keep pending edits. */
  dispose() {
    this.clearTimer();
  }

  hasPending(): boolean {
    return Boolean(this.pending) || this.inFlight;
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private set(patch: Partial<AutosaveSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.opts.onChange?.(this.snap);
  }
}
