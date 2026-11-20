/**
 * The write helper every mutation goes through (DATA-MODEL §1.3, §1.4, §3.3).
 *
 *   const { result, changeSetId } = await withChangeSet(
 *     { userId, actor: actors.user(), reason: 'Rename task' },
 *     async (tx, cs) => cs.updateVersioned(workItems, id, ifVersion, { title }),
 *   );
 *
 * - withChangeSet() opens a transaction, a `change_sets` row and the transaction-local GUCs the
 *   cc_audit trigger requires (cc.change_set_id, cc.actor_kind, cc.actor_ref, plus cc.user_id).
 *   A write to a curated table outside it is refused by the database (ChangeSetRequiredError).
 * - The change set id is the Undo target: undoChangeSet(id) reverts it from the audit images.
 * - Versioned rows use optimistic concurrency (ConflictError on a stale version, W4).
 * - User edits lock the fields they touch; engine writes to locked fields become
 *   change_proposals ("New info -> update?") instead of overwriting (R-UI-20).
 * - Re-eval writes can fence on work_items.reeval_generation (StaleGenerationError, W3).
 */
import { and, eq, getTableColumns, getTableName, inArray, isTable, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';

import { getDb, type Db, type DbOrTx, type Tx } from './client';
import {
  AlreadyUndoneError,
  ConflictError,
  ConstraintViolationError,
  InvalidStateError,
  mapPgError,
  NotFoundError,
  NotUndoableError,
  StaleGenerationError,
  UndoConflictError,
  ValidationError,
} from './errors';
import * as schema from './schema';
import { changeProposals, changeSets } from './schema';
import type { actorKind, changeSetKind } from './schema/enums';

export type ActorKind = (typeof actorKind.enumValues)[number];
export type ChangeSetKind = (typeof changeSetKind.enumValues)[number];

export interface Actor {
  kind: ActorKind;
  /** Engine key@version, `scanner:<connector>`, chat tool-call id, or UI action name. */
  ref?: string;
}

export const actors = {
  user: (ref?: string): Actor => ({ kind: 'user', ref }),
  chat: (toolCallId: string): Actor => ({ kind: 'chat', ref: toolCallId }),
  engine: (keyAtVersion: string): Actor => ({ kind: 'engine', ref: keyAtVersion }),
  /** SCANNER.md §3: every `cc` tool write runs as actor `scanner:<connector>`. */
  scanner: (connector: string): Actor => ({ kind: 'connector', ref: `scanner:${connector}` }),
  system: (ref: string): Actor => ({ kind: 'system', ref }),
  autonomyPolicy: (policyId: string): Actor => ({ kind: 'autonomy_policy', ref: policyId }),
} as const;

const DEFAULT_KIND: Record<ActorKind, ChangeSetKind> = {
  user: 'user_edit',
  chat: 'chat_tool_call',
  engine: 'engine_pass',
  connector: 'connector_sync',
  system: 'system',
  autonomy_policy: 'engine_pass',
};

/** User and chat edits lock what they touch; everything else writes as an engine. */
const isHumanActor = (a: Actor) => a.kind === 'user' || a.kind === 'chat';

export interface ChangeSetOptions {
  userId: string;
  actor: Actor | ActorKind;
  /** change_sets.summary: shown in per-item history and the Undo toast. */
  reason: string;
  /** Defaults from the actor (user -> user_edit, engine -> engine_pass, connector -> connector_sync, ...). */
  kind?: ChangeSetKind;
  /** Primary entity, for the Undo toast and history. Required for autosave bursts. */
  entity?: { type: string; id: string };
  /** Browser tab / chat thread owning an autosave burst. Required for kind 'autosave_burst'. */
  editorSessionId?: string;
  /** A burst keeps absorbing writes until this long after its latest write (default 30 s). */
  burstIdleSeconds?: number;
  undoable?: boolean;
  /** Internal: set by undoChangeSet(). */
  undoOf?: string;
  db?: Db;
}

export interface ProposalRef {
  field: string;
  proposalId: string;
}

export interface WriteResult<Row> {
  /** The row after the write (unchanged when everything became a proposal). */
  row: Row;
  /** Column names written. */
  applied: string[];
  /** Locked columns that became change_proposals instead. */
  proposals: ProposalRef[];
}

export interface Provenance {
  sourceItemId?: string;
  evidenceId?: string;
  extractorId?: string;
  llmCallId?: number;
  confidence?: number;
}

export interface WriteOptions {
  /** Optimistic concurrency: the version the caller read (versioned tables only). */
  ifVersion?: number;
  /** Re-eval fence: the work item generation the job was enqueued for (W3). */
  generation?: number;
  /**
   * Human writes: which applied columns to add to user_locked_fields. Default true (all of them);
   * pass false for bookkeeping writes such as seen_by_user_at.
   */
  lock?: boolean | string[];
  /** Engine writes: treat every column as locked (e.g. an approved activity entry is frozen). */
  lockAll?: boolean;
  /** Engine writes: why, shown on the proposal card. Defaults to the change set reason. */
  reason?: string;
  provenance?: Provenance;
  /** Groups the proposals of one piece of new info into one card. */
  groupId?: string;
}

/** Any table with a uuid `id` primary key. */
export type IdTable = PgTable & { id: AnyPgColumn };
export type VersionedTable = IdTable & { version: AnyPgColumn };
type Row<T extends PgTable> = T['$inferSelect'];
export type Patch<T extends PgTable> = Partial<T['$inferInsert']>;

export interface ChangeSetContext {
  readonly id: string;
  readonly userId: string;
  readonly actor: Actor;
  readonly kind: ChangeSetKind;
  readonly reason: string;
  readonly tx: Tx;
  /**
   * W4. Human actors: OCC update that locks the touched fields. Engine actors: lock-aware update
   * (locked fields become proposals). Throws ConflictError when `ifVersion` is stale.
   */
  updateVersioned<T extends VersionedTable>(
    table: T,
    id: string,
    ifVersion: number,
    patch: Patch<T>,
    opts?: Omit<WriteOptions, 'ifVersion'>,
  ): Promise<WriteResult<Row<T>>>;
  /** Same, with optional OCC (unversioned tables such as calendar_events). */
  update<T extends IdTable>(table: T, id: string, patch: Patch<T>, opts?: WriteOptions): Promise<WriteResult<Row<T>>>;
}

export interface ChangeSetResult<T> {
  result: T;
  /** The Undo target. */
  changeSetId: string;
}

// ---------------------------------------------------------------------------
// Commit hook (BE-1a addition, backward compatible): listeners run in-process right after a
// change set's transaction COMMITS (never on rollback). The live-event layer
// (src/server/events) uses it to publish `{topic, ids, reason}` for every commit. Listeners must
// not throw (errors are swallowed) and must not block: they are called synchronously.
// ---------------------------------------------------------------------------

export interface CommittedChangeSet {
  id: string;
  userId: string;
  actor: Actor;
  kind: ChangeSetKind;
  reason: string;
  entity?: { type: string; id: string };
}

const commitListeners = new Set<(cs: CommittedChangeSet) => void>();

/** Subscribe to committed change sets in this process. Returns the unsubscribe function. */
export function onChangeSetCommitted(listener: (cs: CommittedChangeSet) => void): () => void {
  commitListeners.add(listener);
  return () => {
    commitListeners.delete(listener);
  };
}

function emitCommitted(cs: CommittedChangeSet): void {
  for (const l of [...commitListeners]) {
    try {
      l(cs);
    } catch {
      /* a listener must never break the writer */
    }
  }
}

/** The only way to write a curated table. Don't nest: pass `tx` / `cs` down instead. */
export async function withChangeSet<T>(
  opts: ChangeSetOptions,
  fn: (tx: Tx, cs: ChangeSetContext) => Promise<T>,
): Promise<ChangeSetResult<T>> {
  const db = opts.db ?? getDb();
  const actor: Actor = typeof opts.actor === 'string' ? { kind: opts.actor } : opts.actor;
  const kind = opts.kind ?? DEFAULT_KIND[actor.kind];
  if (!opts.reason.trim()) throw new ValidationError('withChangeSet: reason is required');
  try {
    const out = await runChangeSet(db, actor, kind, opts, fn);
    if (commitListeners.size) {
      emitCommitted({ id: out.changeSetId, userId: opts.userId, actor, kind, reason: opts.reason, entity: opts.entity });
    }
    return out;
  } catch (e) {
    throw mapPgError(e);
  }
}

async function runChangeSet<T>(
  db: Db,
  actor: Actor,
  kind: ChangeSetKind,
  opts: ChangeSetOptions,
  fn: (tx: Tx, cs: ChangeSetContext) => Promise<T>,
): Promise<ChangeSetResult<T>> {
  return db.transaction(async (tx) => {
    const id = kind === 'autosave_burst' ? await openOrReuseBurst(tx, actor, opts) : await openChangeSet(tx, actor, kind, opts);
    await tx.execute(sql`select set_config('cc.change_set_id', ${id}, true),
                                set_config('cc.actor_kind', ${actor.kind}, true),
                                set_config('cc.actor_ref', ${actor.ref ?? ''}, true),
                                set_config('cc.user_id', ${opts.userId}, true)`);
    const cs: ChangeSetContext = {
      id,
      userId: opts.userId,
      actor,
      kind,
      reason: opts.reason,
      tx,
      updateVersioned: (table, rowId, ifVersion, patch, o) =>
        writeRow(tx, table, rowId, patch, { reason: opts.reason, ...o, ifVersion }, isHumanActor(actor) ? 'user' : 'engine'),
      update: (table, rowId, patch, o) =>
        writeRow(tx, table, rowId, patch, { reason: opts.reason, ...o }, isHumanActor(actor) ? 'user' : 'engine'),
    };
    const result = await fn(tx, cs);
    // Non-autosave change sets close at commit (immutable from then on); bursts close via
    // closeIdleBursts() (W6). An empty change set stays off the ⌘Z stack.
    if (kind !== 'autosave_burst') {
      await tx.execute(sql`update change_sets
                              set closed_at = now(),
                                  undoable = undoable and exists (select 1 from audit_events where change_set_id = ${id})
                            where id = ${id}`);
    }
    return { result, changeSetId: id };
  });
}

async function openChangeSet(tx: Tx, actor: Actor, kind: ChangeSetKind, opts: ChangeSetOptions): Promise<string> {
  const [row] = await tx
    .insert(changeSets)
    .values({
      ownerUserId: opts.userId,
      kind,
      actorKind: actor.kind,
      actorRef: actor.ref,
      summary: opts.reason,
      entityType: opts.entity?.type,
      entityId: opts.entity?.id,
      editorSessionId: opts.editorSessionId,
      undoable: opts.undoable ?? true,
      undoOfChangeSetId: opts.undoOf,
    })
    .returning({ id: changeSets.id });
  return row!.id;
}

/** Autosave: one change set per (editor session, entity) until it has been idle ~30 s. */
async function openOrReuseBurst(tx: Tx, actor: Actor, opts: ChangeSetOptions): Promise<string> {
  if (!opts.editorSessionId || !opts.entity) {
    throw new ValidationError('autosave_burst change sets need editorSessionId and entity');
  }
  const idle = opts.burstIdleSeconds ?? 30;
  // A burst whose window has passed is closed now rather than extended (W6 may not have run yet).
  await tx.execute(sql`update change_sets set closed_at = now()
                        where kind = 'autosave_burst' and closed_at is null
                          and editor_session_id = ${opts.editorSessionId}
                          and entity_type = ${opts.entity.type} and entity_id = ${opts.entity.id}
                          and coalesce_until < now()`);
  const res = await tx.execute<{ id: string }>(sql`
    insert into change_sets (owner_user_id, kind, actor_kind, actor_ref, editor_session_id, entity_type, entity_id,
                             summary, undoable, coalesce_until)
    values (${opts.userId}, 'autosave_burst', ${actor.kind}, ${actor.ref ?? null}, ${opts.editorSessionId},
            ${opts.entity.type}, ${opts.entity.id}, ${opts.reason}, ${opts.undoable ?? true},
            now() + make_interval(secs => ${idle}))
    on conflict (editor_session_id, entity_type, entity_id) where kind = 'autosave_burst' and closed_at is null
    do update set coalesce_until = excluded.coalesce_until
    returning id`);
  return res.rows[0]!.id;
}

/** W6: close autosave bursts idle for `idleSeconds` past their window. Returns the closed ids. */
export async function closeIdleBursts(db: DbOrTx = getDb(), idleSeconds = 0): Promise<string[]> {
  const res = await db.execute<{ id: string }>(sql`
    update change_sets set closed_at = now()
     where kind = 'autosave_burst' and closed_at is null
       and coalesce(coalesce_until, created_at) < now() - make_interval(secs => ${idleSeconds})
    returning id`);
  return res.rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Row writes: OCC, field locks, proposals, generation fence
// ---------------------------------------------------------------------------

/** Columns no helper patch may set directly. */
const PROTECTED = new Set([
  'id',
  'owner_user_id',
  'version',
  'created_at',
  'updated_at',
  'user_locked_fields',
  'mapping_locked',
  'reeval_generation',
  'search_tsv',
]);
/** With mapping_locked = true these belong to the user (calendar_events, assets, claude_sessions). */
const MAPPING_COLUMNS = ['account_id', 'opportunity_id', 'mapping_method', 'mapping_confidence'];

type Cols = Record<string, AnyPgColumn>;

const normalize = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (x instanceof Date ? x.toISOString() : x)) ?? 'undefined';
const sameValue = (a: unknown, b: unknown) =>
  normalize(a instanceof Date ? a.toISOString() : a) === normalize(b instanceof Date ? b.toISOString() : b);

function lockedColumns(row: Record<string, unknown>, cols: Cols): Set<string> {
  const locked = new Set<string>((row.userLockedFields as string[] | undefined) ?? []);
  if (cols.mappingLocked && row.mappingLocked === true) MAPPING_COLUMNS.forEach((c) => locked.add(c));
  return locked;
}

async function writeRow<T extends IdTable>(
  tx: DbOrTx,
  table: T,
  id: string,
  patch: Patch<T>,
  o: WriteOptions,
  mode: 'user' | 'engine',
): Promise<WriteResult<Row<T>>> {
  const name = getTableName(table);
  const cols = getTableColumns(table) as Cols;
  const entries = Object.entries(patch as Record<string, unknown>).filter(([, v]) => v !== undefined);
  for (const [prop] of entries) {
    const col = cols[prop];
    if (!col) throw new ValidationError(`${name}: unknown column property '${prop}'`);
    if (PROTECTED.has(col.name)) throw new ValidationError(`${name}: '${col.name}' cannot be patched directly`);
  }
  if (o.ifVersion !== undefined && !cols.version) throw new ValidationError(`${name} has no version column`);
  if (o.generation !== undefined && !cols.reevalGeneration) {
    throw new ValidationError(`${name} has no reeval_generation column`);
  }

  try {
    const t = table as unknown as PgTable;
    const [current] = (await tx
      .select()
      .from(t)
      .where(eq(cols.id!, id))
      .for('update')) as Record<string, unknown>[];
    if (!current) throw new NotFoundError(name, id);
    if (o.ifVersion !== undefined && current.version !== o.ifVersion) {
      throw new ConflictError(name, id, o.ifVersion, current.version as number);
    }
    if (o.generation !== undefined && current.reevalGeneration !== o.generation) {
      throw new StaleGenerationError(name, id, o.generation, current.reevalGeneration as number);
    }

    const locked = mode === 'engine' ? lockedColumns(current, cols) : new Set<string>();
    const apply: Record<string, unknown> = {};
    const propose: { prop: string; col: string; value: unknown }[] = [];
    for (const [prop, value] of entries) {
      const col = cols[prop]!.name;
      if (mode === 'engine' && (o.lockAll || locked.has(col))) {
        if (!sameValue(current[prop], value)) propose.push({ prop, col, value });
      } else {
        apply[prop] = value;
      }
    }

    let row = current;
    const applied = Object.keys(apply).map((p) => cols[p]!.name);
    if (applied.length) {
      const set: Record<string, unknown> = { ...apply };
      if (cols.version) set.version = sql`${cols.version} + 1`;
      if (mode === 'user' && o.lock !== false) {
        const toLock = Array.isArray(o.lock) ? o.lock : applied;
        if (cols.userLockedFields && toLock.length) {
          set.userLockedFields = sql`array(select distinct f from unnest(${cols.userLockedFields} || array[${sql.join(
            toLock.map((f) => sql`${f}`),
            sql`, `,
          )}]::text[]) as f order by f)`;
        }
        if (cols.mappingLocked && applied.some((c) => MAPPING_COLUMNS.includes(c))) set.mappingLocked = true;
      }
      const where: SQL[] = [eq(cols.id!, id)];
      if (cols.version) where.push(eq(cols.version, current.version));
      if (o.generation !== undefined) where.push(eq(cols.reevalGeneration!, o.generation));
      const [updated] = (await tx
        .update(t)
        .set(set as never)
        .where(and(...where))
        .returning()) as Record<string, unknown>[];
      row = updated!; // the row is locked FOR UPDATE, so the fenced UPDATE cannot miss
    }

    const proposals: ProposalRef[] = [];
    if (propose.length) {
      const groupId = o.groupId ?? crypto.randomUUID();
      for (const p of propose) {
        proposals.push({
          field: p.col,
          proposalId: await createProposal(tx, {
            ownerUserId: current.ownerUserId as string,
            entityType: name,
            entityId: id,
            field: p.col,
            currentValue: current[p.prop],
            proposedValue: p.value,
            reason: o.reason ?? 'engine update',
            baseVersion: (row.version as number | undefined) ?? 0,
            groupId,
            provenance: o.provenance,
          }),
        });
      }
    }
    return { row: row as Row<T>, applied, proposals };
  } catch (e) {
    throw mapPgError(e);
  }
}

/** W4 as a function. Human mode (default) locks the touched fields; engine mode proposes instead. */
export function updateVersioned<T extends VersionedTable>(
  tx: DbOrTx,
  table: T,
  id: string,
  ifVersion: number,
  patch: Patch<T>,
  opts: Omit<WriteOptions, 'ifVersion'> & { as?: 'user' | 'engine' } = {},
): Promise<WriteResult<Row<T>>> {
  return writeRow(tx, table, id, patch, { ...opts, ifVersion }, opts.as ?? 'user');
}

/** Engine write: unlocked fields apply, user-locked fields become change_proposals. */
export function engineUpdate<T extends IdTable>(
  tx: DbOrTx,
  table: T,
  id: string,
  patch: Patch<T>,
  opts: WriteOptions = {},
): Promise<WriteResult<Row<T>>> {
  return writeRow(tx, table, id, patch, opts, 'engine');
}

/** Human write without OCC (unversioned tables, e.g. a calendar mapping correction). */
export function userUpdate<T extends IdTable>(
  tx: DbOrTx,
  table: T,
  id: string,
  patch: Patch<T>,
  opts: WriteOptions = {},
): Promise<WriteResult<Row<T>>> {
  return writeRow(tx, table, id, patch, opts, 'user');
}

interface NewProposal {
  ownerUserId: string;
  entityType: string;
  entityId: string;
  field: string;
  currentValue: unknown;
  proposedValue: unknown;
  reason: string;
  baseVersion: number;
  groupId: string;
  provenance?: Provenance;
}

const jsonb = (v: unknown) => sql`${normalize(v ?? null)}::jsonb`;

/** One pending proposal per (entity, field): a newer one supersedes the older. */
async function createProposal(tx: DbOrTx, p: NewProposal): Promise<string> {
  const superseded = await tx
    .update(changeProposals)
    .set({
      status: 'superseded',
      decidedAt: new Date(),
      decidedBy: sql`nullif(current_setting('cc.actor_kind', true), '')::actor_kind`,
    })
    .where(
      and(
        eq(changeProposals.entityType, p.entityType),
        eq(changeProposals.entityId, p.entityId),
        eq(changeProposals.field, p.field),
        eq(changeProposals.status, 'pending'),
      ),
    )
    .returning({ id: changeProposals.id });
  const [created] = await tx
    .insert(changeProposals)
    .values({
      ownerUserId: p.ownerUserId,
      entityType: p.entityType,
      entityId: p.entityId,
      field: p.field,
      groupId: p.groupId,
      currentValue: jsonb(p.currentValue),
      proposedValue: jsonb(p.proposedValue),
      reason: p.reason,
      sourceItemId: p.provenance?.sourceItemId,
      evidenceId: p.provenance?.evidenceId,
      extractorId: p.provenance?.extractorId,
      llmCallId: p.provenance?.llmCallId,
      confidence: p.provenance?.confidence,
      baseVersion: p.baseVersion,
    })
    .returning({ id: changeProposals.id });
  if (superseded.length) {
    await tx
      .update(changeProposals)
      .set({ supersededById: created!.id })
      .where(
        inArray(
          changeProposals.id,
          superseded.map((s) => s.id),
        ),
      );
  }
  return created!.id;
}

const tablesByName = new Map<string, PgTable>();
for (const v of Object.values(schema) as unknown[]) {
  if (isTable(v)) tablesByName.set(getTableName(v), v as PgTable);
}

/**
 * 2026-11-13 audit B4: whether a pending proposal still applies to what it was proposed against: the row is still at
 * its `base_version`, or (the row moved on for another field) the proposal's field still holds the value it was
 * proposed over, compared after the same jsonb → column conversion the apply uses. False means the field changed
 * since, so applying would overwrite newer data. A missing proposal or row is left to the apply to report.
 */
export async function proposalStillCurrent(tx: DbOrTx, proposalId: string): Promise<boolean> {
  try {
    const [p] = await tx.select().from(changeProposals).where(eq(changeProposals.id, proposalId));
    if (!p) return true;
    const table = tablesByName.get(p.entityType);
    if (!table) return true;
    const cols = Object.values(getTableColumns(table)).map((c) => c.name);
    if (!cols.includes(p.field)) return true;
    const t = sql.identifier(p.entityType);
    const f = sql.identifier(p.field);
    const version = cols.includes('version') ? sql`version` : sql`null::int`;
    const res = await tx.execute<{ version: number | null; same: boolean }>(sql`
      select ${version} as version,
             (${f} is not distinct from (jsonb_populate_record(null::${t}, jsonb_build_object(${p.field}::text, ${normalize(p.currentValue ?? null)}::jsonb))).${f}) as same
        from ${t} where id = ${p.entityId}`);
    const row = res.rows[0];
    if (!row) return true;
    return (row.version !== null && Number(row.version) === p.baseVersion) || row.same === true;
  } catch (e) {
    throw mapPgError(e);
  }
}

/** "New info -> update?" accepted: apply the proposed value (the field stays locked). */
export async function applyProposal(
  tx: DbOrTx,
  proposalId: string,
  opts: { ifVersion?: number } = {},
): Promise<{ entityType: string; entityId: string; field: string; version: number | null }> {
  try {
    const [p] = await tx.select().from(changeProposals).where(eq(changeProposals.id, proposalId)).for('update');
    if (!p) throw new NotFoundError('change_proposals', proposalId);
    if (p.status !== 'pending') throw new InvalidStateError(`proposal ${proposalId} is ${p.status}, not pending`);
    const table = tablesByName.get(p.entityType);
    if (!table) throw new ValidationError(`proposal ${proposalId}: unknown table ${p.entityType}`);
    const cols = Object.values(getTableColumns(table)).map((c) => c.name);
    if (!cols.includes(p.field) || PROTECTED.has(p.field)) {
      throw new ValidationError(`proposal ${proposalId}: field ${p.field} cannot be applied`);
    }
    const t = sql.identifier(p.entityType);
    const f = sql.identifier(p.field);
    const extra: SQL[] = [];
    if (cols.includes('version')) extra.push(sql`, version = version + 1`);
    if (cols.includes('updated_at')) extra.push(sql`, updated_at = now()`);
    const versionGuard = opts.ifVersion !== undefined ? sql` and version = ${opts.ifVersion}` : sql``;
    const res = await tx.execute<{ version: number | null }>(sql`
      update ${t} set ${f} = (jsonb_populate_record(null::${t}, jsonb_build_object(${p.field}::text, ${normalize(p.proposedValue)}::jsonb))).${f}
             ${sql.join(extra, sql``)}
       where id = ${p.entityId}${versionGuard}
      returning ${cols.includes('version') ? sql`version` : sql`null::int as version`}`);
    if (!res.rows.length) {
      if (opts.ifVersion === undefined) throw new NotFoundError(p.entityType, p.entityId);
      const cur = await tx.execute<{ version: number }>(sql`select version from ${t} where id = ${p.entityId}`);
      if (!cur.rows.length) throw new NotFoundError(p.entityType, p.entityId);
      throw new ConflictError(p.entityType, p.entityId, opts.ifVersion, cur.rows[0]!.version);
    }
    await tx
      .update(changeProposals)
      .set({
        status: 'accepted',
        decidedAt: new Date(),
        decidedBy: sql`nullif(current_setting('cc.actor_kind', true), '')::actor_kind`,
        appliedChangeSetId: sql`nullif(current_setting('cc.change_set_id', true), '')::uuid`,
      })
      .where(eq(changeProposals.id, proposalId));
    return { entityType: p.entityType, entityId: p.entityId, field: p.field, version: res.rows[0]!.version };
  } catch (e) {
    throw mapPgError(e);
  }
}

/** "Not now": a learning signal; the field keeps the user's value. */
export async function rejectProposal(tx: DbOrTx, proposalId: string): Promise<void> {
  try {
    const res = await tx
      .update(changeProposals)
      .set({
        status: 'rejected',
        decidedAt: new Date(),
        decidedBy: sql`nullif(current_setting('cc.actor_kind', true), '')::actor_kind`,
      })
      .where(and(eq(changeProposals.id, proposalId), eq(changeProposals.status, 'pending')))
      .returning({ id: changeProposals.id });
    if (!res.length) throw new InvalidStateError(`proposal ${proposalId} is not pending`);
  } catch (e) {
    throw mapPgError(e);
  }
}

// ---------------------------------------------------------------------------
// Undo / redo (DATA-MODEL §1.3)
// ---------------------------------------------------------------------------

/** Monotonic bookkeeping: never restored, never compared ("changed since" ignores it). */
const NEVER_RESTORE = new Set(['updated_at', 'version', 'reeval_generation']);

interface TableMeta {
  columns: Set<string>;
  insertable: Set<string>;
  pk: string[];
}
const metaCache = new Map<string, TableMeta>();

async function tableMeta(tx: DbOrTx, table: string): Promise<TableMeta> {
  const hit = metaCache.get(table);
  if (hit) return hit;
  const res = await tx.execute<{ name: string; generated: boolean; pk: boolean }>(sql`
    select a.attname as name, a.attgenerated <> '' as generated,
           coalesce(a.attnum = any(i.indkey), false) as pk
      from pg_attribute a
      left join pg_index i on i.indrelid = a.attrelid and i.indisprimary
     where a.attrelid = to_regclass(${`public.${table}`}) and a.attnum > 0 and not a.attisdropped
     order by a.attnum`);
  if (!res.rows.length) throw new ValidationError(`undo: unknown table ${table}`);
  const meta: TableMeta = {
    columns: new Set(res.rows.map((r) => r.name)),
    insertable: new Set(res.rows.filter((r) => !r.generated).map((r) => r.name)),
    pk: res.rows.filter((r) => r.pk).map((r) => r.name),
  };
  metaCache.set(table, meta);
  return meta;
}

interface AuditRow extends Record<string, unknown> {
  id: string;
  table_name: string;
  row_id: string;
  op: 'insert' | 'update' | 'delete';
  changed_fields: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const ident = (c: string) => sql.identifier(c);
/**
 * `left` still matches image `right` on `cols`. Columns in `nullable` also match when `left` is NULL:
 * they pointed at a row this same undo already deleted, and the FK's ON DELETE SET NULL cleared them.
 */
const sameCols = (cols: string[], left: string, right: string, nullable: Set<string> = new Set()): SQL =>
  cols.length
    ? sql.join(
        cols.map((c) => {
          const eq = sql`${sql.raw(left)}.${ident(c)} is not distinct from ${sql.raw(right)}.${ident(c)}`;
          return nullable.has(c) ? sql`(${sql.raw(left)}.${ident(c)} is null or ${eq})` : eq;
        }),
        sql` and `,
      )
    : sql`true`;
const pkMatch = (pk: string[], left: string, right: string): SQL =>
  sql.join(
    pk.map((c) => sql`${sql.raw(left)}.${ident(c)} = ${sql.raw(right)}.${ident(c)}`),
    sql` and `,
  );
const diffKeys = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => normalize(a[k]) !== normalize(b[k]));

export interface UndoOptions {
  actor?: Actor | ActorKind;
  reason?: string;
  db?: Db;
}

/**
 * Reverts change set `changeSetId` as a new change set of kind 'undo' (or 'redo' when the target
 * is itself an undo), walking its audit rows newest first:
 *   insert -> delete the row; update -> restore `before` for the changed fields; delete -> re-insert.
 * Each step first checks the row still matches the change set's `after` image; if not, nothing is
 * undone and UndoConflictError ("changed since: review") is thrown.
 */
export async function undoChangeSet(changeSetId: string, opts: UndoOptions = {}): Promise<ChangeSetResult<{ rows: number }>> {
  const db = opts.db ?? getDb();
  const [target] = await db.select().from(changeSets).where(eq(changeSets.id, changeSetId));
  if (!target) throw new NotFoundError('change_sets', changeSetId);
  if (target.undoneAt) throw new AlreadyUndoneError(changeSetId);
  if (!target.undoable) throw new NotUndoableError(changeSetId);

  return withChangeSet(
    {
      userId: target.ownerUserId,
      actor: opts.actor ?? 'user',
      kind: target.kind === 'undo' ? 'redo' : 'undo',
      reason: opts.reason ?? `Undo: ${target.summary}`,
      entity: target.entityType && target.entityId ? { type: target.entityType, id: target.entityId } : undefined,
      undoOf: changeSetId,
      db,
    },
    async (tx, cs) => {
      // Re-check under lock: a concurrent undo of the same change set loses here.
      const locked = await tx.execute<{ undone_at: string | null; closed_at: string | null }>(
        sql`select undone_at, closed_at from change_sets where id = ${changeSetId} for update`,
      );
      if (locked.rows[0]?.undone_at) throw new AlreadyUndoneError(changeSetId);
      if (!locked.rows[0]?.closed_at) {
        await tx.execute(sql`update change_sets set closed_at = now() where id = ${changeSetId}`);
      }

      const audit = await tx.execute<AuditRow>(sql`
        select id, table_name, row_id, op, changed_fields, before, after
          from audit_events where change_set_id = ${changeSetId} order by id desc`);
      const deleted = new Set<string>();
      for (const a of audit.rows) await revertAuditRow(tx, changeSetId, a, deleted);

      await markUndoChain(tx, changeSetId, cs.id);
      return { rows: audit.rows.length };
    },
  );
}

async function revertAuditRow(tx: Tx, changeSetId: string, a: AuditRow, deleted: Set<string>): Promise<void> {
  const meta = await tableMeta(tx, a.table_name);
  const clearedBy = (img: Record<string, unknown>, cols: string[]) =>
    new Set(cols.filter((c) => typeof img[c] === 'string' && deleted.has(img[c] as string)));
  const t = ident(a.table_name);
  const conflict = (reason: UndoConflictError['reason']) => new UndoConflictError(changeSetId, a.table_name, a.row_id, reason);
  const exists = async (img: Record<string, unknown>) =>
    (
      await tx.execute(sql`select 1 from ${t} cur, jsonb_populate_record(null::${t}, ${normalize(img)}::jsonb) img
                            where ${pkMatch(meta.pk, 'cur', 'img')}`)
    ).rows.length > 0;

  if (!a.before && a.after) {
    // undo an insert: delete it, if it is still exactly what this change set left behind
    const cmp = Object.keys(a.after).filter((k) => meta.columns.has(k) && !NEVER_RESTORE.has(k) && !meta.pk.includes(k));
    let res;
    try {
      res = await tx.execute(sql`
        delete from ${t} as cur using jsonb_populate_record(null::${t}, ${normalize(a.after)}::jsonb) as img
         where ${pkMatch(meta.pk, 'cur', 'img')} and ${sameCols(cmp, 'cur', 'img', clearedBy(a.after, cmp))}
        returning 1`);
    } catch (e) {
      const mapped = mapPgError(e);
      // e.g. a later row references it through an ON DELETE RESTRICT FK
      if (mapped instanceof ConstraintViolationError) throw conflict('not_restorable');
      throw mapped;
    }
    if (!res.rows.length) throw conflict((await exists(a.after)) ? 'changed_since' : 'row_missing');
    deleted.add(a.row_id);
  } else if (a.before && !a.after) {
    // undo a delete: re-insert the before image
    if (await exists(a.before)) throw conflict('row_exists');
    const cols = Object.keys(a.before).filter((k) => meta.insertable.has(k));
    const list = sql.join(cols.map(ident), sql`, `);
    try {
      await tx.execute(sql`insert into ${t} (${list})
                           select ${list} from jsonb_populate_record(null::${t}, ${normalize(a.before)}::jsonb)`);
    } catch (e) {
      const mapped = mapPgError(e);
      if (mapped instanceof ConstraintViolationError) throw conflict('not_restorable');
      throw mapped;
    }
  } else if (a.before && a.after) {
    // undo an update: restore `before` for the fields this change set changed
    const changed = a.changed_fields.length ? a.changed_fields : diffKeys(a.before, a.after);
    const fields = changed.filter((k) => meta.columns.has(k) && meta.insertable.has(k) && !NEVER_RESTORE.has(k));
    if (!fields.length) return;
    const sets = fields.map((f) => sql`${ident(f)} = b.${ident(f)}`);
    if (meta.columns.has('version')) sets.push(sql`version = cur.version + 1`);
    if (meta.columns.has('updated_at')) sets.push(sql`updated_at = now()`);
    const res = await tx.execute(sql`
      update ${t} as cur set ${sql.join(sets, sql`, `)}
        from jsonb_populate_record(null::${t}, ${normalize(a.before)}::jsonb) as b,
             jsonb_populate_record(null::${t}, ${normalize(a.after)}::jsonb) as a
       where ${pkMatch(meta.pk, 'cur', 'a')} and ${sameCols(fields, 'cur', 'a', clearedBy(a.after, fields))}
      returning 1`);
    if (!res.rows.length) throw conflict((await exists(a.after)) ? 'changed_since' : 'row_missing');
  }
  // before and after both null: created and deleted inside one change set, nothing to revert.
}

/**
 * undone_at means "this change set's effects are currently reverted". Undoing X reverts X; if X was
 * an undo/redo of Y, Y is in effect again, Y's own target reverted again, and so on down the chain.
 * Work-item transitions and reopen decisions carried by those change sets follow the same state.
 */
async function markUndoChain(tx: Tx, targetId: string, undoChangeSetId: string): Promise<void> {
  let id: string | null = targetId;
  let reverted = true;
  for (let guard = 0; id && guard < 100; guard++) {
    const by = reverted ? sql`${undoChangeSetId}::uuid` : sql`null::uuid`;
    const at = reverted ? sql`now()` : sql`null::timestamptz`;
    const res: { rows: { undo_of_change_set_id: string | null }[] } = await tx.execute<{
      undo_of_change_set_id: string | null;
    }>(sql`update change_sets set undone_at = ${at}, undone_by_change_set_id = ${by}
                   where id = ${id} returning undo_of_change_set_id`);
    await tx.execute(sql`update work_item_transitions set undone_at = ${at}, undone_by_change_set_id = ${by}
                          where change_set_id = ${id}`);
    await tx.execute(sql`update reopen_decisions set undone_at = ${at}, undone_by_change_set_id = ${by}
                          where change_set_id = ${id}`);
    id = res.rows[0]?.undo_of_change_set_id ?? null;
    reverted = !reverted;
  }
}
