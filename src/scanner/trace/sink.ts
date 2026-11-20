/**
 * The database trace sink: buffers events and writes them to `scan_run_events` in the background, in batches.
 *
 * Never on a run's path: `write` only pushes to an in-memory buffer (bounded; the oldest events are dropped when the
 * database is unreachable for long). A failed batch is retried row by row once (one bad row, e.g. a run id another
 * database owns, does not drop its neighbours), then dropped. Failures are logged at most once a minute, with a code.
 */
import { sql } from 'drizzle-orm';

import type { Db } from '../../db/client';
import { setTraceSink } from './emit';
import type { TraceEvent, TraceSink } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DbTraceSinkOptions {
  /** Flush this often (ms). Default 500. */
  flushMs?: number;
  /** Rows per insert. Default 200. */
  batch?: number;
  /** Buffer cap; the oldest events are dropped beyond it. Default 20 000. */
  maxBuffer?: number;
  log?: (msg: string, detail?: Record<string, unknown>) => void;
}

export class DbTraceSink implements TraceSink {
  private buf: TraceEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private lastLogAt = 0;
  dropped = 0;
  written = 0;

  constructor(
    private readonly db: Db,
    private readonly o: DbTraceSinkOptions = {},
  ) {}

  write(e: TraceEvent): void {
    if (!UUID.test(e.runId)) return;
    this.buf.push(e);
    const max = this.o.maxBuffer ?? 20_000;
    if (this.buf.length > max) {
      this.dropped += this.buf.length - max;
      this.buf.splice(0, this.buf.length - max);
    }
    if (this.buf.length >= (this.o.batch ?? 200)) void this.flush();
    else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.o.flushMs ?? 500);
      this.timer.unref?.();
    }
  }

  /** Write everything buffered so far (serialized with any write in flight). Never throws. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const next = this.writing.then(() => this.drain());
    this.writing = next.catch(() => undefined);
    return this.writing;
  }

  private async drain(): Promise<void> {
    while (this.buf.length) {
      const rows = this.buf.splice(0, this.o.batch ?? 200);
      try {
        await this.insert(rows);
        this.written += rows.length;
      } catch {
        for (const r of rows) {
          try {
            await this.insert([r]);
            this.written += 1;
          } catch (err) {
            this.dropped += 1;
            this.note(err);
          }
        }
      }
    }
  }

  private async insert(rows: TraceEvent[]): Promise<void> {
    const values = sql.join(
      rows.map((r) => sql`(${r.runId}::uuid, ${r.seq}, ${r.ts}::timestamptz, ${r.kind}, ${JSON.stringify(r.payload)}::jsonb, ${r.sourceItemId && UUID.test(r.sourceItemId) ? r.sourceItemId : null}::uuid, ${r.workItemId && UUID.test(r.workItemId) ? r.workItemId : null}::uuid)`),
      sql`, `,
    );
    await this.db.execute(sql`
      insert into scan_run_events (run_id, seq, ts, kind, payload, source_item_id, work_item_id)
      values ${values}
      on conflict (run_id, seq) do nothing`);
  }

  private note(err: unknown) {
    const now = Date.now();
    if (now - this.lastLogAt < 60_000) return;
    this.lastLogAt = now;
    const code = (err as { code?: string }).code ?? (err as Error)?.name ?? 'error';
    this.o.log?.('trace write failed (events dropped; runs unaffected)', { code, dropped: this.dropped });
  }
}

/** Install the database sink for this process (the worker). Returns it, so shutdown can flush it. */
export function installDbTraceSink(db: Db, o: DbTraceSinkOptions = {}): DbTraceSink {
  const s = new DbTraceSink(db, o);
  setTraceSink(s);
  return s;
}
