/**
 * The border (UI-SPEC §7, R-UI-18): explicit Send/Draft → server preview → confirm → 10 s undo window →
 * POST /drafts/:id/dispatch → outcome. A framework-free state machine with injected I/O and timers, so the
 * exact sequence (and that Undo never dispatches) is unit-tested. `useSendFlow` wraps it for React.
 *
 *   idle ──open(mode)──▶ previewing ──ok──▶ confirming ──confirm()──▶ countdown ──deadline──▶ dispatching
 *     ▲                     │ err               │ cancel()              │ undo()                  │
 *     │                     ▼                   ▼                       ▼                         ▼
 *     └──────────────── error(preview)        idle                  idle (undone)        done | error(dispatch)
 */
import type { ApiErrorCode, DispatchMode, DispatchResult, DraftPreview } from '@/contract';

export type SendPhase = 'idle' | 'previewing' | 'confirming' | 'countdown' | 'dispatching' | 'done' | 'error';
/** dry_run: rendered only (global dry-run) · staged: destination-side draft created · sent: posted. */
export type SendOutcome = 'dry_run' | 'staged' | 'sent';

export interface SendError {
  code: ApiErrorCode | 'unknown';
  message: string;
  retryable: boolean;
  stage: 'save' | 'preview' | 'dispatch';
  /**
   * BE-OUTBOX: the server asks for a fresh preview + confirm (`details.retry: 'reconfirm'`). Confirm tokens
   * are single-use, so a failed dispatch is never re-posted with the old token (that answers 409).
   */
  reconfirm?: boolean;
}

export interface SendState {
  phase: SendPhase;
  mode: DispatchMode;
  preview: DraftPreview | null;
  /** Countdown end, epoch ms (phase `countdown`). */
  deadline: number | null;
  undoMs: number;
  result: DispatchResult | null;
  outcome: SendOutcome | null;
  error: SendError | null;
  /** The last countdown was undone: nothing was sent. */
  undone: boolean;
  /** How many dispatch requests left this client (tests + "nothing was sent" assertions). */
  dispatches: number;
}

export interface SendFlowDeps {
  /** Make sure the latest edits are saved before previewing. Resolve false (or throw) when they aren't. */
  flush?: () => Promise<boolean>;
  preview: (mode: DispatchMode) => Promise<DraftPreview>;
  dispatch: (req: { ifVersion: number; mode: DispatchMode; confirmToken: string }) => Promise<DispatchResult>;
  /** Undo window (settings.sending.undoWindowSec × 1000). Read at confirm time. */
  undoMs: number | (() => number);
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

const INITIAL: SendState = {
  phase: 'idle',
  mode: 'draft',
  preview: null,
  deadline: null,
  undoMs: 10_000,
  result: null,
  outcome: null,
  error: null,
  undone: false,
  dispatches: 0,
};

interface ErrLike {
  code?: string;
  message?: string;
  retryable?: boolean;
  details?: unknown;
}

export function toSendError(err: unknown, stage: SendError['stage']): SendError {
  const e = (err ?? {}) as ErrLike;
  const code = (typeof e.code === 'string' ? e.code : 'unknown') as SendError['code'];
  const reconfirm = (e.details as { retry?: unknown } | undefined)?.retry === 'reconfirm';
  return { code, message: e.message ?? 'Unexpected error', retryable: e.retryable ?? code === 'upstream_unavailable', stage, ...(reconfirm ? { reconfirm } : {}) };
}

export function outcomeOf(r: DispatchResult): SendOutcome {
  if (r.dryRun || r.attempt.outcome === 'rendered') return 'dry_run';
  if (r.attempt.outcome === 'staged') return 'staged';
  return 'sent';
}

export class SendFlow {
  private state: SendState;
  private listeners = new Set<(s: SendState) => void>();
  private timer: unknown = null;
  private seq = 0;
  private deps: SendFlowDeps;

  constructor(deps: SendFlowDeps, initialMode: DispatchMode = 'draft') {
    this.deps = deps;
    this.state = { ...INITIAL, mode: initialMode };
  }

  /** Swap I/O (React re-renders pass fresh closures). */
  setDeps(deps: SendFlowDeps): void {
    this.deps = deps;
  }

  getState = (): SendState => this.state;

  subscribe = (fn: (s: SendState) => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<SendState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** True while the editor must stay locked (nothing may change between confirm and dispatch). */
  get locked(): boolean {
    return ['previewing', 'confirming', 'countdown', 'dispatching'].includes(this.state.phase);
  }

  /** Step 1: the user pressed Send / Push as draft. Saves, then asks the server for the exact payload. */
  async open(mode: DispatchMode): Promise<void> {
    if (this.locked) return;
    const run = ++this.seq;
    this.set({ phase: 'previewing', mode, preview: null, result: null, outcome: null, error: null, undone: false, deadline: null });
    try {
      if (this.deps.flush) {
        const ok = await this.deps.flush();
        if (run !== this.seq) return;
        if (!ok) {
          this.set({ phase: 'error', error: { code: 'upstream_unavailable', message: "Your latest edits aren't saved yet, so there's nothing safe to send. Retry the save first.", retryable: true, stage: 'save' } });
          return;
        }
      }
      const preview = await this.deps.preview(mode);
      if (run !== this.seq) return;
      this.set({ phase: 'confirming', preview });
    } catch (err) {
      if (run !== this.seq) return;
      this.set({ phase: 'error', error: toSendError(err, 'preview') });
    }
  }

  /** Close the confirm dialog without doing anything. */
  cancel(): void {
    if (this.state.phase !== 'confirming' && this.state.phase !== 'previewing') return;
    this.seq++;
    this.set({ phase: 'idle', preview: null });
  }

  /** Step 2: confirm. Starts the undo window; dispatch fires only when it runs out. */
  confirm(): void {
    if (this.state.phase !== 'confirming' || !this.state.preview) return;
    const undoMs = Math.max(0, typeof this.deps.undoMs === 'function' ? this.deps.undoMs() : this.deps.undoMs);
    const deadline = this.now() + undoMs;
    this.set({ phase: 'countdown', deadline, undoMs, undone: false });
    const set = this.deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const run = ++this.seq;
    this.timer = set(() => {
      this.timer = null;
      if (run === this.seq) void this.fire();
    }, undoMs);
  }

  /** Undo inside the window: cancels the timer. Nothing is dispatched. */
  undo(): void {
    if (this.state.phase !== 'countdown') return;
    this.clear();
    this.seq++;
    this.set({ phase: 'idle', deadline: null, preview: null, undone: true });
  }

  /**
   * Retry after an error. Always a fresh round: save → server preview → confirm (the dialog reopens). A
   * failed dispatch is never re-posted: confirm tokens are single-use (BE-OUTBOX answers 409 to a reused
   * one, and a failure comes back as `upstream_unavailable` with `details.retry: 'reconfirm'`).
   */
  async retry(): Promise<void> {
    const { phase, error, mode } = this.state;
    if (phase !== 'error' || !error) return;
    this.set({ phase: 'idle', error: null, preview: null });
    await this.open(mode);
  }

  /** Back to idle from done/error (e.g. after a dry run, or to edit again). */
  reset(): void {
    if (this.locked) return;
    this.seq++;
    this.set({ phase: 'idle', error: null, preview: null, deadline: null, undone: false });
  }

  dispose(): void {
    this.clear();
    this.seq++;
    this.listeners.clear();
  }

  private clear(): void {
    if (this.timer != null) {
      (this.deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
      this.timer = null;
    }
  }

  private async fire(): Promise<void> {
    const preview = this.state.preview;
    if (!preview) return;
    const run = this.seq;
    this.set({ phase: 'dispatching', deadline: null, dispatches: this.state.dispatches + 1, error: null });
    try {
      const result = await this.deps.dispatch({ ifVersion: preview.version, mode: preview.mode, confirmToken: preview.confirmToken });
      if (run !== this.seq) return;
      this.set({ phase: 'done', result, outcome: outcomeOf(result) });
    } catch (err) {
      if (run !== this.seq) return;
      const e = toSendError(err, 'dispatch');
      if (e.code === 'dry_run') {
        // The real backend refuses to leave the machine while dry-run is on: the payload was rendered only.
        this.set({ phase: 'done', outcome: 'dry_run', result: null });
        return;
      }
      if (e.code === 'conflict' || e.code === 'validation') {
        e.retryable = false;
        e.message = 'The draft changed after you confirmed, so nothing was sent. Review it and send again.';
      }
      // A dispatch is only ever retried through a new preview + confirm.
      e.reconfirm = true;
      this.set({ phase: 'error', error: e });
    }
  }
}
