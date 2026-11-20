/**
 * The migrations this build ships against the ones the database applied (audit 2026-11-13, lane E: E1 and E5).
 *
 * Drizzle's migrator stores each applied migration's journal `when` as `drizzle.__drizzle_migrations.created_at`, and
 * applies a journal entry only when its `when` is newer than the last one applied. An entry merged later with an
 * older `when` is therefore skipped silently, and forever. `compareSchema` names that case along with the plain ones:
 *
 *   match    every journal entry is applied, and nothing the journal doesn't know
 *   empty    nothing applied yet (a database nobody migrated)
 *   behind   entries newer than the last applied one wait: npm run update (or npm run db:migrate)
 *   ahead    the database applied migrations this build doesn't ship: a newer version migrated it
 *   skipped  an entry isn't applied although a newer one is: drizzle will never apply it
 *
 * The worker refuses to claim jobs unless it is `match` (src/worker/schema-guard.ts); `npm run db:migrate` fails on
 * `skipped`; doctor reports all five. Tags and counts only.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { sql } from 'drizzle-orm';

import bundled from './migrations/meta/_journal.json';
import type { DbOrTx } from './client';

/** The worker's one open Health event while it waits for the schema (src/worker/schema-guard.ts; Health reads it). */
export const SCHEMA_EVENT_FINGERPRINT = 'worker|schema_mismatch';

export interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

export type SchemaStateKind = 'match' | 'empty' | 'behind' | 'ahead' | 'skipped';

export interface SchemaState {
  state: SchemaStateKind;
  /** The newest migration this build ships. */
  bundled: string | null;
  /** The newest applied migration this build knows; 'newer than this build' when the newest applied is unknown. */
  applied: string | null;
  /** Journal entries not applied yet (in journal order). */
  pending: string[];
  /** Journal entries drizzle will never apply: a newer one was applied before them. */
  skipped: string[];
  /** Applied migrations this build's journal doesn't have. */
  unknown: number;
}

const sortEntries = (entries: JournalEntry[]) => [...entries].sort((a, b) => a.idx - b.idx);

/** This build's journal (imported, so it is the one the process started with). */
export function bundledJournal(): JournalEntry[] {
  return sortEntries((bundled as { entries: JournalEntry[] }).entries);
}

/** A migrations folder's journal, read from disk (`npm run db:migrate` checks the folder it applied). */
export function readJournal(folder: string): JournalEntry[] {
  return sortEntries((JSON.parse(readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as { entries: JournalEntry[] }).entries);
}

export function compareSchema(entries: JournalEntry[], appliedWhens: readonly number[]): SchemaState {
  const journal = sortEntries(entries);
  const applied = new Set(appliedWhens.filter((w) => Number.isFinite(w)));
  const known = new Set(journal.map((e) => e.when));
  const last = applied.size ? Math.max(...applied) : null;
  const pendingEntries = journal.filter((e) => !applied.has(e.when));
  const skipped = last === null ? [] : pendingEntries.filter((e) => e.when <= last).map((e) => e.tag);
  const unknown = [...applied].filter((w) => !known.has(w)).length;
  const newestKnown = [...journal].reverse().find((e) => applied.has(e.when));
  const out: SchemaState = {
    state: 'match',
    bundled: journal.at(-1)?.tag ?? null,
    applied: last !== null && !known.has(last) ? 'newer than this build' : (newestKnown?.tag ?? null),
    pending: pendingEntries.map((e) => e.tag),
    skipped,
    unknown,
  };
  if (!applied.size) out.state = journal.length ? 'empty' : 'match';
  else if (skipped.length) out.state = 'skipped';
  else if (unknown) out.state = 'ahead';
  else if (pendingEntries.length) out.state = 'behind';
  return out;
}

/** One line for logs, doctor and Health ("the database is 2 migrations behind this build (0024_retention_rollups)"). */
export function describeSchema(s: SchemaState): { text: string; fix: string | null } {
  const n = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;
  switch (s.state) {
    case 'match':
      return { text: `${s.applied ?? 'no migrations'} applied, as this build ships`, fix: null };
    case 'empty':
      return { text: `no migrations applied yet (this build ships ${n(s.pending.length, 'migration')})`, fix: 'npm run db:migrate' };
    case 'behind':
      return { text: `the database is ${n(s.pending.length, 'migration')} behind this build (it has ${s.applied ?? 'none'}, the build ships ${s.bundled})`, fix: 'npm run update (or npm run db:migrate)' };
    case 'ahead':
      return { text: `the database has ${n(s.unknown, 'migration')} this build doesn't ship (a newer version migrated it)`, fix: 'npm run update, so this install runs the version that migrated it' };
    case 'skipped':
      return {
        text: `${s.skipped.join(', ')} ${s.skipped.length === 1 ? 'was' : 'were'} never applied and never will be: a newer migration was applied first (its journal time is older)`,
        fix: 'report it (Feedback): the release has to give that migration a newer journal time',
      };
  }
}

/** The journal `when` of every applied migration; [] when the database was never migrated. */
export async function readAppliedMigrations(db: DbOrTx): Promise<number[]> {
  try {
    const r = await db.execute<{ at: string }>(sql`select created_at::text as at from drizzle.__drizzle_migrations`);
    return r.rows.map((x) => Number(x.at)).filter((x) => Number.isFinite(x));
  } catch (err) {
    // 42P01 undefined_table / 3F000 invalid_schema_name: nobody migrated this database yet
    const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (code === '42P01' || code === '3F000') return [];
    throw err;
  }
}
