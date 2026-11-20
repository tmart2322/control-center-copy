/**
 * Active chat turns, one per thread (BE-CHAT). A new message in a thread cancels the turn still running
 * there; Stop is the client aborting the POST /chat request (its signal). Process-wide (globalThis), so
 * every Next route bundle shares it.
 */
type Runs = Map<string, { ac: AbortController; turn: number }>;
const g = globalThis as { __ccChatRuns?: Runs; __ccChatTurnSeq?: number };
const runs = (): Runs => (g.__ccChatRuns ??= new Map());

export interface ChatRunHandle {
  /** Aborts when the request goes away, Stop is pressed, or a newer turn starts in the thread. */
  signal: AbortSignal;
  /** Why it was aborted, when it was. */
  reason(): 'superseded' | 'client' | null;
  end(): void;
}

export function beginChatRun(threadId: string, outer: AbortSignal): ChatRunHandle {
  const prev = runs().get(threadId);
  if (prev) prev.ac.abort('superseded');
  const ac = new AbortController();
  const turn = (g.__ccChatTurnSeq = (g.__ccChatTurnSeq ?? 0) + 1);
  runs().set(threadId, { ac, turn });
  const onOuter = () => ac.abort('client');
  if (outer.aborted) onOuter();
  else outer.addEventListener('abort', onOuter, { once: true });
  return {
    signal: ac.signal,
    reason: () => (ac.signal.aborted ? (ac.signal.reason === 'superseded' ? 'superseded' : 'client') : null),
    end() {
      outer.removeEventListener('abort', onOuter);
      const cur = runs().get(threadId);
      if (cur && cur.turn === turn) runs().delete(threadId);
    },
  };
}

/** Abort the running turn of a thread (tests, a future explicit Stop route). */
export function stopChatRun(threadId: string): boolean {
  const cur = runs().get(threadId);
  if (!cur) return false;
  cur.ac.abort('client');
  runs().delete(threadId);
  return true;
}
