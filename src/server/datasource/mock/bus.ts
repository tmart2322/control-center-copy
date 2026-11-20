import type { LiveEvent } from '@/contract';
import type { Clock, EventBus, LiveEventInput } from '@/server/ports';

/** In-process event bus feeding GET /api/v1/events. Keeps a short replay buffer for reconnects. */
export class MemoryEventBus implements EventBus {
  private seq = 0;
  private listeners = new Set<(e: LiveEvent) => void>();
  readonly recent: LiveEvent[] = [];

  constructor(private readonly clock: Clock) {}

  publish(input: LiveEventInput): LiveEvent {
    const event: LiveEvent = { ...input, seq: ++this.seq, at: input.at ?? this.clock.now().toISOString() };
    this.recent.push(event);
    if (this.recent.length > 200) this.recent.shift();
    for (const l of [...this.listeners]) {
      try {
        l(event);
      } catch (err) {
        console.error('[bus] listener failed', err);
      }
    }
    return event;
  }

  subscribe(listener: (e: LiveEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Async iterator over future events until the signal aborts. */
  iterate(signal: AbortSignal): AsyncIterable<LiveEvent> {
    const queue: LiveEvent[] = [];
    let wake: (() => void) | null = null;
    const unsubscribe = this.subscribe((e) => {
      queue.push(e);
      wake?.();
    });
    const done = new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
    return {
      [Symbol.asyncIterator]: async function* () {
        try {
          while (!signal.aborted) {
            if (queue.length === 0) {
              await Promise.race([new Promise<void>((r) => (wake = r)), done]);
              wake = null;
              continue;
            }
            yield queue.shift()!;
          }
        } finally {
          unsubscribe();
        }
      },
    };
  }
}
