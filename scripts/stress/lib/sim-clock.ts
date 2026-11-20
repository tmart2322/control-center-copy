/**
 * Simulated clock for the stress driver: simulated now = real now + offset. Time keeps flowing at real speed
 * (so leases, heartbeats and LLM run durations behave normally) and the driver jumps it forward (idle
 * fast-forward, lid closed, PTO). The same offset is mirrored into the scenario database, where
 * `stress.now()` shadows `pg_catalog.now()` through the search path, so the job queue's `run_at <= now()`,
 * leases, backoff and the reaper all see the SAME simulated time as the scanner (no mixed real/fake time).
 */
import { sql } from 'drizzle-orm';

import type { Db } from '../../../src/db/client';
import type { Clock } from '../../../src/scanner/runtime/clock';

export const CLOCK_SCHEMA_SQL = `
create schema if not exists stress;
create table if not exists stress.clock (id int primary key default 1 check (id = 1), offset_ms bigint not null default 0);
insert into stress.clock (id, offset_ms) values (1, 0) on conflict (id) do nothing;
create or replace function stress.now() returns timestamptz language sql stable as
  $$ select pg_catalog.now() + make_interval(secs => coalesce((select offset_ms from stress.clock where id = 1), 0) / 1000.0) $$;
-- Column defaults bind now() to pg_catalog.now() when the migration creates the table, so the search path never
-- reaches them: created_at, first_seen_at, status_changed_at… were REAL time while every query saw simulated time
-- (found by CMP-1: the completion pass orders by arrival). Point every now() default at the simulated clock.
do $do$
declare r record;
begin
  for r in select c.relname, a.attname, pg_get_expr(d.adbin, d.adrelid) as expr
             from pg_attrdef d
             join pg_class c on c.oid = d.adrelid
             join pg_namespace n on n.oid = c.relnamespace
             join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
            where n.nspname = 'public' and pg_get_expr(d.adbin, d.adrelid) ~ '(^|[^.a-z_])now\\(\\)|pg_catalog\\.now\\(\\)'
  loop
    execute format('alter table public.%I alter column %I set default %s', r.relname, r.attname,
                   regexp_replace(r.expr, '(pg_catalog\\.)?now\\(\\)', 'stress.now()', 'g'));
  end loop;
end
$do$;
`;

export class SimClock implements Clock {
  private offsetMs: number;
  private listeners: Array<(offsetMs: number) => Promise<void> | void> = [];

  constructor(start: string | Date | number, private readonly realNow: () => number = Date.now) {
    const t = typeof start === 'number' ? start : new Date(start).getTime();
    this.offsetMs = t - this.realNow();
  }

  now(): Date {
    return new Date(this.realNow() + this.offsetMs);
  }

  nowMs(): number {
    return this.realNow() + this.offsetMs;
  }

  get offset(): number {
    return this.offsetMs;
  }

  /** Real sleep (time flows); the simulated clock advances with it. */
  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const t = setTimeout(resolve, Math.min(ms, 1000));
      signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
    });
  }

  onChange(fn: (offsetMs: number) => Promise<void> | void): void {
    this.listeners.push(fn);
  }

  /** Jump forward (never backward: cursors and leases assume monotonic time). */
  async jump(ms: number): Promise<void> {
    if (ms < 0) throw new Error('SimClock never goes backward');
    this.offsetMs += ms;
    for (const l of this.listeners) await l(this.offsetMs);
  }

  async jumpTo(t: string | Date | number): Promise<void> {
    const target = typeof t === 'number' ? t : new Date(t).getTime();
    const d = target - this.nowMs();
    if (d > 0) await this.jump(d);
  }

  /** Bind to a scenario DB: every jump updates `stress.clock`. */
  async bindDb(db: Db): Promise<void> {
    const push = async (off: number) => {
      await db.execute(sql`update stress.clock set offset_ms = ${Math.round(off)} where id = 1`);
    };
    await push(this.offsetMs);
    this.onChange(push);
  }

  /** Child processes: adopt the offset the parent wrote. */
  static async fromDb(db: Db): Promise<SimClock> {
    const r = await db.execute<{ o: string }>(sql`select offset_ms as o from stress.clock where id = 1`);
    const c = new SimClock(Date.now());
    c.offsetMs = Number(r.rows[0]?.o ?? 0);
    return c;
  }

  /** Re-read the DB offset (a child following a parent's jumps). */
  async syncFromDb(db: Db): Promise<boolean> {
    const r = await db.execute<{ o: string }>(sql`select offset_ms as o from stress.clock where id = 1`);
    const o = Number(r.rows[0]?.o ?? this.offsetMs);
    const changed = o !== this.offsetMs;
    this.offsetMs = o;
    return changed;
  }
}
