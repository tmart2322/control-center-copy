/**
 * HOME-1b: one system re-rank when a new user's first scan completes.
 *
 * Nothing ranks work after a scan: ranking runs on Today's "re-rank", a chat or policy change, or `db:seed`
 * (`systemRerank`). A fresh first scan therefore left every open item unranked (stage 4: 74 of 74), so Today's order
 * was the due-date fallback and Home's Do now had nothing to fill with (HOME-1 fixed the fill). This hook ranks once,
 * with the deterministic priority engine (no LLM, no cost), when:
 *  - the worker's first scan (`first-scan.json`) is done,
 *  - nothing was ever ranked (no `priority_runs` row: any re-rank, the user's included, writes one),
 *  - and there is rankable work.
 * It is idempotent by those rules, so a restart never ranks twice, and never over the user's own ranking.
 */
import { sql } from 'drizzle-orm';

import type { DbHandle } from '@/db/client';
import { DbDataSource } from '@/server/datasource/db';
import { readFirstScanFile } from '@/server/datasource/db/first-scan';

export interface FirstScanRerankDeps {
  readState?: () => { status?: string } | null;
  rerank?: () => Promise<{ top3: string[] }>;
}

const RANKABLE = `('open', 'in_progress', 'waiting_on_me', 'likely_done')`;

/** Ranks once if the rules above hold; returns whether it ranked. */
export async function firstScanRerankOnce(handle: DbHandle, userId: string, deps: FirstScanRerankDeps = {}): Promise<boolean> {
  const st = (deps.readState ?? readFirstScanFile)();
  if (st?.status !== 'done') return false;
  const r = await handle.db.execute<{ runs: number; rankable: number }>(sql`
    select (select count(*)::int from priority_runs where owner_user_id = ${userId}) as runs,
           (select count(*)::int from work_items where owner_user_id = ${userId} and status::text in ${sql.raw(RANKABLE)}) as rankable`);
  const row = r.rows[0];
  if (!row || row.runs > 0 || row.rankable === 0) return false;
  const rerank = deps.rerank ?? (async () => new DbDataSource({ handle, userId }).systemRerank('First scan complete: initial ranking'));
  await rerank();
  return true;
}

export function firstScanRerankHook(handle: DbHandle, userId: string, log: (msg: string, f?: Record<string, unknown>) => void, deps: FirstScanRerankDeps = {}) {
  let done = false;
  return {
    name: 'first-scan.rerank',
    everyMs: 60_000,
    run: async () => {
      if (done) return;
      try {
        if (await firstScanRerankOnce(handle, userId, deps)) {
          done = true;
          log('first scan complete: ranked open work once (HOME-1b)');
        }
      } catch (err) {
        log('first-scan re-rank failed', { code: (err as Error).name });
      }
    },
  };
}
