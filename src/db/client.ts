/**
 * Postgres pool + Drizzle instance (node-postgres), after vdp-app's lib/db/client.ts.
 *
 * - DATABASE_URL, defaulting to postgres://localhost:5432/control_center (CLAUDE.md invariant 6:
 *   state lives in Postgres, never in the repo).
 * - Pool max 5 for both web and worker (DATA-MODEL §3.3).
 * - Every session runs with TimeZone=UTC, so timestamps inside audit images (to_jsonb) render
 *   identically whichever process wrote them.
 * - Created lazily: importing this module never opens a connection, so typecheck, drizzle-kit and
 *   tests that build their own pool via createDb() don't need a database.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema';

export const DEFAULT_DATABASE_URL = 'postgres://localhost:5432/control_center';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
/** The transaction handle drizzle passes to `db.transaction(fn)`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export interface DbHandle {
  db: Db;
  pool: Pool;
  /** Drains the pool. Safe to call more than once. */
  close(): Promise<void>;
}

export interface CreateDbOptions {
  url?: string;
  max?: number;
  applicationName?: string;
  pool?: Omit<PoolConfig, 'connectionString'>;
}

export function resolveDatabaseUrl(url?: string): string {
  return url ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

/** Database name of a connection URL, for logs (never print the URL: it may carry a password). */
export function databaseName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) || '(default)';
  } catch {
    return '(unparseable url)';
  }
}

export function createDb(opts: CreateDbOptions = {}): DbHandle {
  const pool = new Pool({
    connectionString: resolveDatabaseUrl(opts.url),
    max: opts.max ?? 5,
    application_name: opts.applicationName ?? 'control-center',
    options: '-c TimeZone=UTC',
    ...opts.pool,
  });
  // An idle client erroring (server restart) must not crash the process; the next query reconnects.
  pool.on('error', (err) => {
    console.error(`[db] idle client error: ${err.message}`);
  });
  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  let closed: Promise<void> | undefined;
  return {
    db,
    pool,
    close: () => (closed ??= pool.end()),
  };
}

let shared: DbHandle | undefined;

/** The process-wide handle (web or worker). */
export function getDbHandle(): DbHandle {
  return (shared ??= createDb());
}

export function getDb(): Db {
  return getDbHandle().db;
}

/** Graceful shutdown: drain the shared pool. The next getDb() opens a fresh one. */
export async function closeDb(): Promise<void> {
  const handle = shared;
  shared = undefined;
  await handle?.close();
}
