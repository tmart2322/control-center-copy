/**
 * Cursor + coverage commit (SCANNER.md §5, DATA-MODEL §1.2 "cursors move with the data").
 *
 * commitScanPage() writes the run's coverage ledger rows and advances the (connector, scope) cursor
 * in the caller's transaction. Call it in the same transaction that writes that page's source
 * items (usually inside withChangeSet with a `scanner:<connector>` actor): a crash or rollback then
 * leaves the cursor, the ledger and the items all unmoved, and the next run re-reads the page.
 *
 * Guards: the cursor only moves forward, and the ledger (this page plus earlier complete entries)
 * must cover [previous high watermark, new high watermark) with no hole.
 */
import { sql } from 'drizzle-orm';

import type { DbOrTx } from './client';
import { CursorError, mapPgError, ValidationError } from './errors';
import type { cursorKind, ledgerObjectKind, ledgerOutcome } from './schema/enums';

export interface LedgerEntryInput {
  objectKind: (typeof ledgerObjectKind.enumValues)[number];
  objectExternalId?: string;
  coveredFrom?: Date;
  coveredTo?: Date;
  startToken?: string;
  endToken?: string;
  itemCount?: number;
  newItemCount?: number;
  resultHash?: string;
  outcome: (typeof ledgerOutcome.enumValues)[number];
}

export interface CommitScanPageInput {
  ownerUserId: string;
  connectorId: string;
  scope: string;
  scanRunId: string;
  cursorKind: (typeof cursorKind.enumValues)[number];
  cursorValue?: string | null;
  cursorJson?: Record<string, unknown> | null;
  /** Everything before this instant is now fully scanned. */
  highWatermarkAt: Date;
  ledger: LedgerEntryInput[];
}

export interface CommitScanPageResult {
  cursorId: string;
  previousHighWatermarkAt: Date | null;
  highWatermarkAt: Date;
  ledgerEntryIds: number[];
}

export async function commitScanPage(tx: DbOrTx, input: CommitScanPageInput): Promise<CommitScanPageResult> {
  if (!input.ledger.length) throw new ValidationError('commitScanPage: a cursor advance needs coverage rows');
  try {
    // Lock (or create) the cursor row first so concurrent commits for one scope serialize.
    await tx.execute(sql`
      insert into scan_cursors (owner_user_id, connector_id, scope, cursor_kind)
      values (${input.ownerUserId}, ${input.connectorId}, ${input.scope}, ${input.cursorKind})
      on conflict (connector_id, scope) do nothing`);
    const cur = await tx.execute<{ id: string; high_watermark_at: string | null; low_watermark_at: string | null }>(sql`
      select id, high_watermark_at, low_watermark_at from scan_cursors
       where connector_id = ${input.connectorId} and scope = ${input.scope} for update`);
    const cursor = cur.rows[0]!;
    const prev = cursor.high_watermark_at ? new Date(cursor.high_watermark_at) : null;
    if (prev && input.highWatermarkAt < prev) {
      throw new CursorError(
        'regression',
        `scan cursor ${input.scope}: ${input.highWatermarkAt.toISOString()} is before ${prev.toISOString()}`,
      );
    }

    const ids: number[] = [];
    for (const e of input.ledger) {
      const res = await tx.execute<{ id: string }>(sql`
        insert into scan_ledger_entries (scan_run_id, connector_id, scope, object_kind, object_external_id,
                                         covered_from, covered_to, start_token, end_token, item_count,
                                         new_item_count, result_hash, outcome)
        values (${input.scanRunId}, ${input.connectorId}, ${input.scope}, ${e.objectKind}, ${e.objectExternalId ?? null},
                ${e.coveredFrom?.toISOString() ?? null}, ${e.coveredTo?.toISOString() ?? null}, ${e.startToken ?? null},
                ${e.endToken ?? null}, ${e.itemCount ?? 0}, ${e.newItemCount ?? 0}, ${e.resultHash ?? null}, ${e.outcome})
        returning id`);
      ids.push(Number(res.rows[0]!.id));
    }

    // Coverage must span [from, new watermark): from = previous watermark, else the low watermark,
    // else the earliest start this page reports (first run).
    const pageStart = input.ledger
      .map((e) => e.coveredFrom)
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const from = prev ?? (cursor.low_watermark_at ? new Date(cursor.low_watermark_at) : pageStart);
    if (!from) throw new CursorError('coverage_gap', `scan cursor ${input.scope}: no time coverage reported`);
    if (from < input.highWatermarkAt) {
      const covered = await tx.execute<{ ok: boolean; gaps: string | null }>(sql`
        with want as (select tstzmultirange(tstzrange(${from.toISOString()}::timestamptz,
                                                      ${input.highWatermarkAt.toISOString()}::timestamptz, '[)')) as m),
             have as (select coalesce(range_agg(covered), '{}'::tstzmultirange) as m
                        from scan_ledger_entries
                       where connector_id = ${input.connectorId} and scope = ${input.scope}
                         and outcome = 'complete' and covered is not null)
        select have.m @> want.m as ok, (want.m - have.m)::text as gaps from want, have`);
      if (!covered.rows[0]?.ok) {
        throw new CursorError('coverage_gap', `scan cursor ${input.scope}: uncovered ${covered.rows[0]?.gaps ?? ''}`);
      }
    }

    await tx.execute(sql`
      update scan_cursors
         set cursor_kind       = ${input.cursorKind},
             cursor_value      = ${input.cursorValue ?? null},
             cursor_json       = ${input.cursorJson === undefined || input.cursorJson === null ? null : JSON.stringify(input.cursorJson)}::jsonb,
             high_watermark_at = ${input.highWatermarkAt.toISOString()}::timestamptz,
             last_run_id       = ${input.scanRunId},
             last_advanced_at  = now(),
             updated_at        = now()
       where id = ${cursor.id}`);
    return { cursorId: cursor.id, previousHighWatermarkAt: prev, highWatermarkAt: input.highWatermarkAt, ledgerEntryIds: ids };
  } catch (e) {
    throw mapPgError(e);
  }
}
