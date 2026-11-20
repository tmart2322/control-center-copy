/**
 * Retention scrub (D-7, DATA-MODEL §1.7 + decision 4 / OQ-5), nightly.
 *
 *  1. W7: source_items bodies past `body_expires_at` (90 days) are nulled (`body_purged_at` set) and any text
 *     keys in `meta` dropped; re-ingest never brings them back (W1). Drive section texts past their expiry are
 *     nulled too, except the baseline snapshot of a deliverable still being worked on (OQ-9).
 *  2. Audit images older than 90 days: source-derived text inside `before`/`after` is replaced with
 *     "[scrubbed]" (keys, ids, enums, timestamps, titles and structure are kept) and the image gets a
 *     `_retention` marker. audit_events is append-only; the guard only lets a delete through under
 *     `cc.retention = on`, so a scrub is delete + re-insert of the same row (same id) in one transaction.
 *  3. Closed content revisions older than 90 days that are not the latest of their field: text is scrubbed.
 *  4. Read-ins (`user_settings` key `readin/<type>/<id>`, BE-READIN) not refreshed for 90 days are deleted: they
 *     hold text derived from sources. The delete's own audit images are scrubbed in the same transaction, and old
 *     audit images of read-in rows get their `value` deep-scrubbed like any other source-derived jsonb.
 *  5. The scan run trace (`scan_run_events`, AUDIT) older than 30 days is deleted: it is a decision log (ids, counts,
 *     short reasons), kept long enough to answer "why wasn't this picked up?" for last month's scans.
 *  6. Table retention (lane E, E4; ./retention-tables.ts): jobs, scan runs (their coverage ledger compacted first),
 *     connector health checks, and the LLM audit trail past 400 days rolled up per day. The handler runs it after 1–5.
 * Undo of a change older than 90 days can then only restore structure (it reports "changed since").
 */
import { sql, type SQL } from 'drizzle-orm';

import { actors, withChangeSet } from '@/db/changeset';
import type { Db, Tx } from '@/db/client';
import { TEXT_KEYS } from '@/scanner/store-db';

import type { JobHandler } from '../types';
import { runTableRetention } from './retention-tables';

export const SCRUBBED = '[scrubbed]';
export const RETENTION_MARKER = '_retention';

/** Audit-image columns that hold free text derived from sources (titles are kept by policy). */
export const AUDIT_TEXT_COLUMNS = new Set([
  'description',
  'purpose',
  'status_reason',
  'resolution_note',
  'rationale',
  'merge_rationale',
  'due_text',
  'assignee_text',
  'body',
  'summary',
  'background_summary',
  'plain_text',
  'text',
  'notes',
  'note',
  'reason',
  'explanation',
  'excerpt',
  'snippet',
  'transcript',
  'comment',
  'error',
  'error_message',
  'message',
  'subject',
  'waiting_reason',
  'dismiss_reason',
  'first_prompt',
  'last_assistant_text',
  'away_summary',
  'user_instruction',
]);
/** jsonb columns whose string leaves may hold source text. */
export const AUDIT_JSON_TEXT_COLUMNS = new Set([
  'payload',
  'meta',
  'doc_json',
  'current_value',
  'proposed_value',
  'content_blocks',
  'input',
  'output',
  'diff',
  'changes',
  'requirement_verdicts',
  'detail',
]);
const LONG = 200;
/** Short machine tokens (ids, enums, timestamps, URLs) are structure, not prose. */
const TOKEN = /^[^\s]{1,120}$/;

function scrubDeep(v: unknown): unknown {
  if (typeof v === 'string') return v === SCRUBBED || (TOKEN.test(v) && v.length <= LONG) ? v : SCRUBBED;
  if (Array.isArray(v)) return v.map(scrubDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, scrubDeep(x)]));
  return v;
}

/** Scrub one audit image. Returns the new image and whether anything changed (the marker is always added). */
/** `user_settings` keys whose `value` is source-derived text (read-ins). */
export const READIN_KEY_PREFIX = 'readin/';

export function scrubImage(img: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!img) return img;
  const readIn = typeof img.key === 'string' && img.key.startsWith(READIN_KEY_PREFIX);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(img)) {
    if (typeof v === 'string') out[k] = AUDIT_TEXT_COLUMNS.has(k) || v.length > LONG ? (v ? SCRUBBED : v) : v;
    else if (v && typeof v === 'object' && (AUDIT_JSON_TEXT_COLUMNS.has(k) || (readIn && k === 'value'))) out[k] = scrubDeep(v);
    else out[k] = v;
  }
  out[RETENTION_MARKER] = 'scrubbed';
  return out;
}

/** ProseMirror / TipTap doc: replace text node content, keep the node tree. */
function scrubDoc(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrubDoc);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = k === 'text' && typeof x === 'string' ? SCRUBBED : scrubDoc(x);
    return o;
  }
  return v;
}

export interface RetentionResult {
  bodiesPurged: number;
  sectionTextsPurged: number;
  auditRowsScrubbed: number;
  revisionsScrubbed: number;
  readInsPurged: number;
  traceEventsPurged: number;
}

export interface RetentionOptions {
  now?: Date;
  days?: number;
  /** Scan run trace retention (days). Default 30. */
  traceDays?: number;
  batch?: number;
  maxBatches?: number;
  signal?: AbortSignal;
}

const textKeys = [...TEXT_KEYS];

/** Scrub up to `limit` audit rows matching `where` (delete + re-insert under `cc.retention`; audit_events is append-only). */
async function scrubAuditRows(tx: Tx, where: SQL, limit: number): Promise<number> {
  const rows = await tx.execute<{
    id: string;
    owner_user_id: string | null;
    change_set_id: string;
    actor_kind: string;
    actor_ref: string | null;
    table_name: string;
    row_id: string;
    entity_type: string;
    entity_id: string;
    op: string;
    changed_fields: string[];
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    coalesced_count: number;
    destination: string | null;
    payload_hash: string | null;
    created_at: string;
    updated_at: string;
  }>(sql`
    select * from audit_events
     where ${where}
       and not (coalesce(after, before, '{}'::jsonb) ? ${RETENTION_MARKER})
     order by id limit ${limit}
     for update skip locked`);
  if (!rows.rows.length) return 0;
  await tx.execute(sql`select set_config('cc.retention', 'on', true)`);
  for (const r of rows.rows) {
    const before = scrubImage(r.before);
    const after = scrubImage(r.after);
    await tx.execute(sql`delete from audit_events where id = ${r.id}`);
    await tx.execute(sql`
      insert into audit_events (id, owner_user_id, change_set_id, actor_kind, actor_ref, table_name, row_id, entity_type, entity_id,
                                op, changed_fields, before, after, coalesced_count, destination, payload_hash, created_at, updated_at)
      values (${r.id}, ${r.owner_user_id}, ${r.change_set_id}, ${r.actor_kind}, ${r.actor_ref}, ${r.table_name}, ${r.row_id},
              ${r.entity_type}, ${r.entity_id}, ${r.op},
              ${r.changed_fields.length ? sql`array[${sql.join(r.changed_fields.map((f) => sql`${f}::text`), sql`, `)}]` : sql`'{}'::text[]`},
              ${before ? JSON.stringify(before) : null}::jsonb, ${after ? JSON.stringify(after) : null}::jsonb, ${r.coalesced_count},
              ${r.destination}, ${r.payload_hash}, ${new Date(r.created_at).toISOString()}::timestamptz, ${new Date(r.updated_at).toISOString()}::timestamptz)`);
  }
  await tx.execute(sql`select set_config('cc.retention', 'off', true)`);
  return rows.rows.length;
}

export async function runRetentionScrub(db: Db, userId: string, opts: RetentionOptions = {}): Promise<RetentionResult> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.days ?? 90) * 86_400_000).toISOString();
  const batch = opts.batch ?? 500;
  const maxBatches = opts.maxBatches ?? 50;
  const cs = <T,>(reason: string, fn: (tx: Tx) => Promise<T>) =>
    withChangeSet({ db, userId, actor: actors.system('retention'), reason, undoable: false }, fn).then((r) => r.result);
  const keys = sql`array[${sql.join(
    textKeys.map((k) => sql`${k}::text`),
    sql`, `,
  )}]`;

  // 1. W7 (with the injectable clock) + meta text keys
  const w7 = await cs('retention: purge expired bodies', async (tx) => {
    const s = await tx.execute<{ n: string }>(sql`
      with s as (
        update source_items set body = null, body_purged_at = ${now.toISOString()}::timestamptz, meta = meta - ${keys}
         where owner_user_id = ${userId} and body is not null and body_expires_at < ${now.toISOString()}::timestamptz
        returning id)
      select count(*) as n from s`);
    const sec = await tx.execute<{ n: string }>(sql`
      with sec as (
        update asset_snapshot_sections x set text = null
          from asset_snapshots s, assets a
         where x.snapshot_id = s.id and s.asset_id = a.id and a.owner_user_id = ${userId}
           and x.text is not null and x.text_expires_at < ${now.toISOString()}::timestamptz
           and not exists (select 1 from work_item_deliverables d
                            where d.baseline_snapshot_id = s.id and d.status not in ('complete', 'abandoned'))
        returning x.id)
      select count(*) as n from sec`);
    return { bodies: Number(s.rows[0]!.n), sections: Number(sec.rows[0]!.n) };
  });

  // 2. audit images
  let auditRowsScrubbed = 0;
  for (let i = 0; i < maxBatches && !opts.signal?.aborted; i++) {
    const n = await cs('retention: scrub audit images', async (tx) => {
      return scrubAuditRows(tx, sql`owner_user_id = ${userId} and created_at < ${cutoff}::timestamptz`, batch);
    });
    auditRowsScrubbed += n;
    if (n < batch) break;
  }

  // 3. superseded content revisions
  let revisionsScrubbed = 0;
  for (let i = 0; i < maxBatches && !opts.signal?.aborted; i++) {
    const n = await cs('retention: scrub old content revisions', async (tx) => {
      const rows = await tx.execute<{ id: string; doc_json: Record<string, unknown> | null; text: string | null }>(sql`
        select r.id, r.doc_json, r.text from content_revisions r
         where r.owner_user_id = ${userId} and r.closed_at is not null and r.closed_at < ${cutoff}::timestamptz
           and exists (select 1 from content_revisions n where n.entity_type = r.entity_type and n.entity_id = r.entity_id
                          and n.field = r.field and n.revision > r.revision)
           and ((r.text is not null and r.text <> ${SCRUBBED}) or (r.doc_json is not null and not (r.doc_json ? ${RETENTION_MARKER})))
         order by r.id limit ${batch}
         for update skip locked`);
      for (const r of rows.rows) {
        if (r.doc_json) {
          const doc = { ...(scrubDoc(r.doc_json) as Record<string, unknown>), [RETENTION_MARKER]: 'scrubbed' };
          await tx.execute(sql`update content_revisions set doc_json = ${JSON.stringify(doc)}::jsonb where id = ${r.id}`);
        } else {
          await tx.execute(sql`update content_revisions set text = ${SCRUBBED} where id = ${r.id}`);
        }
      }
      return rows.rows.length;
    });
    revisionsScrubbed += n;
    if (n < batch) break;
  }

  // 4. read-ins not refreshed for 90 days; their delete images are scrubbed in the same transaction
  const readInsPurged = await cs('retention: purge old read-ins', async (tx) => {
    const del = await tx.execute<{ key: string }>(sql`
      delete from user_settings
       where owner_user_id = ${userId} and key like ${READIN_KEY_PREFIX + '%'} and updated_at < ${cutoff}::timestamptz
      returning key`);
    if (!del.rows.length) return 0;
    const csId = (await tx.execute<{ id: string }>(sql`select current_setting('cc.change_set_id', true) as id`)).rows[0]!.id;
    for (let n = batch; n === batch; ) n = await scrubAuditRows(tx, sql`change_set_id = ${csId}::uuid and table_name = 'user_settings'`, batch);
    return del.rows.length;
  });

  // 5. the scan run trace (append-only log, not audited: a plain delete, in batches), only this user's runs
  const traceCutoff = new Date(now.getTime() - (opts.traceDays ?? 30) * 86_400_000).toISOString();
  let traceEventsPurged = 0;
  for (let i = 0; i < maxBatches && !opts.signal?.aborted; i++) {
    const del = await db.execute(sql`
      delete from scan_run_events where id in (
        select e.id from scan_run_events e join scan_runs r on r.id = e.run_id
         where r.owner_user_id = ${userId} and e.ts < ${traceCutoff}::timestamptz
         order by e.id limit ${batch * 10})`);
    traceEventsPurged += del.rowCount ?? 0;
    if ((del.rowCount ?? 0) < batch * 10) break;
  }

  return { bodiesPurged: w7.bodies, sectionTextsPurged: w7.sections, auditRowsScrubbed, revisionsScrubbed, readInsPurged, traceEventsPurged };
}

export const retentionHandler: JobHandler = async (ctx) => {
  const r = await runRetentionScrub(ctx.db, ctx.userId, { now: ctx.clock(), signal: ctx.signal });
  ctx.log('retention scrub done', { ...r });
  // lane E (E4): jobs, scan runs (their ledger compacted first), health checks, and the LLM audit trail's rollup
  const t = await runTableRetention(ctx.db, ctx.userId, { now: ctx.clock(), signal: ctx.signal });
  ctx.log('table retention done', { ...t, errors: t.errors.length });
  return { ...r, ...t };
};
