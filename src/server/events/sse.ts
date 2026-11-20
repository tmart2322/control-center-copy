/**
 * SSE adapter for `GET /api/v1/events` when `CC_DATA=db` (BE-1b wires the route / DataSource selection).
 *
 * Two entry points:
 * - `dbLiveEvents({ signal })`: the AsyncIterable a DB DataSource returns from `events()`. The existing route
 *   handler (src/server/http.ts) adds the `hello` frame, heartbeats and contract validation.
 * - `liveEventsResponse(req)`: a complete SSE Response (hello, heartbeats, `Last-Event-ID` replay) for a route that
 *   bypasses the DataSource.
 * Both share one process-wide PgEventBus and install the change-set publisher once.
 */
import type { LiveEvent, LiveHello } from '@/contract';
import { getDb, type Db } from '@/db/client';

import { PgEventBus, type PgEventBusOptions } from './pg-bus';
import { installChangeSetPublisher } from './publisher';

let shared: { bus: PgEventBus; uninstall: () => void } | undefined;

/** The process-wide bus, started lazily, with the commit-hook publisher installed. */
export function getLiveEventBus(opts: PgEventBusOptions & { db?: Db } = {}): PgEventBus {
  if (!shared) {
    const bus = new PgEventBus(opts);
    const uninstall = installChangeSetPublisher({ bus, db: opts.db ?? getDb() });
    shared = { bus, uninstall };
    void bus.start().catch(() => undefined);
  }
  return shared.bus;
}

/** Stops the shared bus (graceful shutdown / tests). */
export async function closeLiveEventBus(): Promise<void> {
  const s = shared;
  shared = undefined;
  s?.uninstall();
  await s?.bus.stop();
}

/** For a DB DataSource: `events(i) { return dbLiveEvents(i); }` */
export function dbLiveEvents(i: { signal: AbortSignal; afterSeq?: number }): AsyncIterable<LiveEvent> {
  return getLiveEventBus().iterate(i.signal, { afterSeq: i.afterSeq });
}

const encoder = new TextEncoder();
const frame = (event: string, data: unknown, id?: number) =>
  encoder.encode(`${id !== undefined ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/** Full SSE response: `hello`, then `live` frames with `id: <seq>`, plus a `ping` heartbeat every 15 s. */
export function liveEventsResponse(req: Request, opts: { bus?: PgEventBus; heartbeatMs?: number } = {}): Response {
  const bus = opts.bus ?? getLiveEventBus();
  const lastId = Number(req.headers.get('last-event-id') ?? NaN);
  const signal = req.signal;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(hb);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const hb = setInterval(() => {
        // a named event, not a comment: the client's watchdog sees it (src/client/live.ts STALE_MS)
        if (!closed) controller.enqueue(frame('ping', { at: Date.now() }));
      }, opts.heartbeatMs ?? 15_000);
      signal.addEventListener('abort', close, { once: true });
      const hello: LiveHello = { at: new Date().toISOString(), seq: bus.recent.at(-1)?.seq ?? 0, dataSource: 'db' };
      controller.enqueue(frame('hello', hello));
      try {
        for await (const ev of bus.iterate(signal, { afterSeq: Number.isFinite(lastId) ? lastId : undefined })) {
          if (closed) break;
          controller.enqueue(frame('live', ev, ev.seq));
        }
      } finally {
        close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
