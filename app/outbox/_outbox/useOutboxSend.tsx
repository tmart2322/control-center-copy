'use client';
/**
 * Approve from the Outbox: the border (UI-SPEC §7, §8). Approve never sends. It asks the server for the
 * exact payload (POST /drafts/:id/preview), shows the composer's ConfirmSendDialog, and only after an
 * explicit Confirm starts the 10 s "Sending… Undo" window; dispatch fires when that runs out. In dry run
 * the dispatch only renders the payload and the result says so. All of that is the composer's SendFlow
 * state machine, so the Outbox and the composer cannot disagree about what "confirmed" means.
 *
 * "Approve all N" is a queue of the same flow, one draft at a time: each draft gets its own preview and its
 * own Confirm. Cancelling a confirm, undoing a countdown or any error stops the queue; nothing is batched
 * past the border. A failed dispatch retries through a fresh preview and confirm (confirm tokens are
 * single-use), never by re-posting the spent token.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Draft } from '@/contract';
import { api } from '@/client/api';
import { ConfirmSendDialog, SendCountdownToast, SendFlow, type SendState } from '@/components/composer';
import { channelName } from '@/components/composer/destination';
import { actionApp } from '@/lib/actions';

export interface OutboxQueue {
  /** 1-based position of the draft being approved. */
  index: number;
  total: number;
}

export interface OutboxSend {
  /** Open the confirm for this draft (preview first; nothing is sent). */
  approve: (draft: Draft) => void;
  /** Approve several, one preview + confirm each. */
  approveAll: (drafts: Draft[]) => void;
  /** Stop the queue after the current draft (the current confirm stays open until you answer it). */
  stopQueue: () => void;
  queue: OutboxQueue | null;
  state: SendState;
  /** The draft the flow is working on (for inline errors and results on the right row). */
  target: Draft | null;
  /** Retry after a failed preview / retryable dispatch (a fresh preview + confirm). */
  retry: () => void;
  /** Clear a finished or failed flow. */
  reset: () => void;
  /** Mount once: the confirm dialog and the floating undo countdown. */
  overlays: React.ReactNode;
}

export function useOutboxSend({ dryRun, undoSec, onDone }: { dryRun: boolean; undoSec: number; onDone?: (d: Draft, outcome: SendState['outcome']) => void }): OutboxSend {
  const targetRef = useRef<Draft | null>(null);
  const undoMsRef = useRef(undoSec * 1000);
  undoMsRef.current = undoSec * 1000;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const [target, setTarget] = useState<Draft | null>(null);
  const [flow] = useState(
    () =>
      new SendFlow({
        preview: (mode) => api('previewDraft', { params: { id: targetRef.current!.id }, body: { mode } }),
        dispatch: (req) => api('dispatchDraft', { params: { id: targetRef.current!.id }, body: req }),
        undoMs: () => undoMsRef.current,
      }),
  );
  const state = useSyncExternalStore(flow.subscribe, flow.getState, flow.getState);

  const approve = useCallback(
    (draft: Draft) => {
      if (flow.locked) return;
      targetRef.current = draft;
      setTarget(draft);
      void flow.open(draft.mode);
    },
    [flow],
  );

  // ---- the queue ----------------------------------------------------------------------------
  const rest = useRef<Draft[]>([]);
  const [queue, setQueue] = useState<OutboxQueue | null>(null);
  const queueRef = useRef<OutboxQueue | null>(null);
  queueRef.current = queue;
  const stopQueue = useCallback(() => {
    rest.current = [];
    setQueue(null);
  }, []);
  const approveAll = useCallback(
    (drafts: Draft[]) => {
      if (flow.locked || !drafts.length) return;
      rest.current = drafts.slice(1);
      setQueue(drafts.length > 1 ? { index: 1, total: drafts.length } : null);
      approve(drafts[0]!);
    },
    [approve, flow],
  );

  // Tell the page when a dispatch settles (once per completion), and move the queue along.
  const outcome = state.outcome;
  const prevPhase = useRef(state.phase);
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = state.phase;
    if (was === state.phase) return;
    const d = targetRef.current;
    if (state.phase === 'done' && d) doneRef.current?.(d, outcome);
    const q = queueRef.current;
    if (!q) return;
    if (state.phase === 'done') {
      const next = rest.current.shift();
      if (!next) return setQueue(null);
      setQueue({ index: q.index + 1, total: q.total });
      // Next tick: let the finished row show its result first.
      setTimeout(() => approve(next), 0);
    } else if (state.phase === 'idle' || state.phase === 'error') {
      // Cancelled, undone or failed: stop. Nothing else goes out without its own confirm.
      stopQueue();
    }
  }, [state.phase, outcome, approve, stopQueue]);

  const dest = target?.destination;
  const overlays = (
    <>
      {dest ? (
        <ConfirmSendDialog
          open={state.phase === 'previewing' || state.phase === 'confirming'}
          mode={state.mode}
          destination={dest}
          preview={state.preview}
          loading={state.phase === 'previewing'}
          dryRun={dryRun}
          undoSec={undoSec}
          onConfirm={() => flow.confirm()}
          onCancel={() => flow.cancel()}
        />
      ) : null}
      {state.phase === 'countdown' && state.deadline && dest ? (
        <SendCountdownToast
          variant="floating"
          deadline={state.deadline}
          durationMs={state.undoMs}
          dryRun={dryRun}
          label={dest.kind === 'action' ? `Applying to ${actionApp(dest.action)}: ${dest.target.label}` : state.mode === 'send' ? `Sending to ${dest.kind === 'slack' ? dest.channelName : 'email'}` : `Pushing ${channelName(dest)} draft`}
          onUndo={() => flow.undo()}
        />
      ) : null}
    </>
  );

  return { approve, approveAll, stopQueue, queue, state, target, retry: () => void flow.retry(), reset: () => flow.reset(), overlays };
}
