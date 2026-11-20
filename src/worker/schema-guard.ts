/**
 * The worker claims jobs only on the schema it was built for (audit 2026-11-13, lane E: E1).
 *
 * Its bundled journal (the code the process started with) is compared with the database's applied migrations
 * (src/db/migration-state.ts). Anything but `match` (behind, ahead, a migration drizzle skipped, nothing applied):
 *  - at startup it waits before touching anything else, beating its heartbeat as `blocked`, and checks again every
 *    30 s. It never exits on it, so launchd's KeepAlive doesn't turn a pending migration into a crash loop;
 *  - while running, the runtime holds its claims and hooks (WorkerRuntime.hold) until the two agree again;
 *  - it logs why once per change, and keeps one open Health event (`app_events` worker|schema_mismatch, which
 *    Health ▸ Needs you shows) until they agree, when the event resolves itself.
 * `npm run update` stops the worker while it migrates, so the guard only bites when someone migrates by hand or runs
 * a worker from an older checkout.
 */
import { sql } from 'drizzle-orm';

import type { Db } from '@/db/client';
import { bundledJournal, compareSchema, describeSchema, readAppliedMigrations, SCHEMA_EVENT_FINGERPRINT, type JournalEntry, type SchemaState } from '@/db/migration-state';

export { SCHEMA_EVENT_FINGERPRINT };
export const SCHEMA_CHECK_MS = 30_000;

export interface SchemaGuardOptions {
  db: Db;
  log: (msg: string, detail?: Record<string, unknown>) => void;
  /** The build's journal; default the one this process imported. */
  journal?: JournalEntry[];
  /** The applied migrations' journal times; default the database's. */
  readApplied?: () => Promise<number[]>;
  /** The user the Health event belongs to (Health lists that user's events). */
  ownerUserId?: () => Promise<string | null>;
}

export class SchemaGuard {
  private lastSig: string | null = null;
  private readonly journal: JournalEntry[];
  last: SchemaState | null = null;

  constructor(private readonly o: SchemaGuardOptions) {
    this.journal = o.journal ?? bundledJournal();
  }

  /** Compare now. A failed read is not a verdict (null): the caller keeps what it was doing and asks again later. */
  async check(): Promise<SchemaState | null> {
    let applied: number[];
    try {
      applied = await (this.o.readApplied ?? (() => readAppliedMigrations(this.o.db)))();
    } catch (err) {
      this.o.log('schema check failed; asking again later', { code: (err as { code?: string }).code ?? (err as Error).name });
      return null;
    }
    const s = compareSchema(this.journal, applied);
    this.last = s;
    const sig = s.state === 'match' ? 'match' : `${s.state}:${s.applied}:${s.pending.length}:${s.skipped.join(',')}:${s.unknown}`;
    if (sig !== this.lastSig) {
      const first = this.lastSig === null;
      this.lastSig = sig;
      if (s.state === 'match') {
        if (!first) this.o.log('database schema matches this build again; claiming jobs', { migration: s.applied });
        await this.resolveEvent();
      } else {
        const d = describeSchema(s);
        this.o.log('waiting: the database schema differs from this build; no jobs are claimed until they match', { state: s.state, bundled: s.bundled, applied: s.applied, pending: s.pending.length, skipped: s.skipped, unknown: s.unknown, fix: d.fix });
        await this.openEvent(s);
      }
    }
    return s;
  }

  /**
   * Startup: return once the schema matches (true), or false when `stopping()` turns true first. Beats `onBlocked`
   * every `beatMs` while it waits (the heartbeat must stay fresh, or doctor reports the worker dead).
   */
  async waitForMatch(o: { stopping: () => boolean; onBlocked: (s: SchemaState | null) => void; sleep?: (ms: number) => Promise<void>; intervalMs?: number; beatMs?: number }): Promise<boolean> {
    const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.()));
    const interval = o.intervalMs ?? SCHEMA_CHECK_MS;
    const beat = Math.min(o.beatMs ?? 15_000, interval);
    for (;;) {
      if (o.stopping()) return false;
      const s = await this.check();
      if (s?.state === 'match') return true;
      o.onBlocked(s);
      for (let waited = 0; waited < interval; waited += beat) {
        if (o.stopping()) return false;
        await sleep(beat);
        o.onBlocked(this.last);
      }
    }
  }

  private async openEvent(s: SchemaState): Promise<void> {
    const d = describeSchema(s);
    const owner = await (this.o.ownerUserId?.() ?? Promise.resolve(null)).catch(() => null);
    const message = `The worker is waiting: ${d.text}. It claims no jobs until they match.`.slice(0, 300);
    const detail = { state: s.state, bundled: s.bundled, applied: s.applied, pending: s.pending.length, skipped: s.skipped, unknown: s.unknown, suggestedAction: d.fix };
    // A best effort: a database with no tables at all has no app_events either (the log line above still says it).
    await this.o.db
      .execute(sql`
        insert into app_events (owner_user_id, severity, component, code, error_class, message, detail, fingerprint)
        values (${owner}, 'error', 'worker', 'schema_mismatch', 'validation', ${message}, ${JSON.stringify(detail)}::jsonb, ${SCHEMA_EVENT_FINGERPRINT})
        on conflict (fingerprint) where resolved_at is null
        do update set occurrence_count = app_events.occurrence_count + 1, last_occurred_at = now(), message = excluded.message,
                      detail = excluded.detail, owner_user_id = coalesce(excluded.owner_user_id, app_events.owner_user_id)`)
      .catch((err: unknown) => this.o.log('recording the schema event failed', { code: (err as { code?: string }).code ?? (err as Error).name }));
  }

  private async resolveEvent(): Promise<void> {
    await this.o.db
      .execute(sql`update app_events set resolved_at = now() where fingerprint = ${SCHEMA_EVENT_FINGERPRINT} and resolved_at is null`)
      .catch(() => undefined);
  }
}

/** The user Health will show the event to, read-only (the worker resolves and creates its user only once the schema matches). */
export async function guardOwner(db: Db, email: string | undefined): Promise<string | null> {
  const r = await db.execute<{ id: string }>(sql`
    select id from users where is_active ${email ? sql`and lower(email) = ${email.toLowerCase()}` : sql``} order by created_at limit 1`);
  return r.rows[0]?.id ?? null;
}
