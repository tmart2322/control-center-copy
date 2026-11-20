/**
 * Typed database errors (R-UI-19). Every helper in src/db throws one of these, never a raw pg
 * error, so callers can map them to HTTP statuses and job `error_class` without string matching.
 *
 * Messages carry table names, ids and constraint names only: never row contents or secrets.
 */

export type JobErrorClass = 'transient' | 'rate_limited' | 'auth' | 'validation' | 'not_found' | 'budget' | 'bug' | 'unknown';

export class DbError extends Error {
  /** Stable machine code, e.g. 'version_conflict'. */
  readonly code: string;
  /** Suggested HTTP status for API routes. */
  readonly status: number;
  /** Suggested jobs.last_error_class when this aborts a job. */
  readonly errorClass: JobErrorClass;

  constructor(code: string, message: string, opts: { status: number; errorClass: JobErrorClass; cause?: unknown }) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = opts.status;
    this.errorClass = opts.errorClass;
  }
}

/** Optimistic concurrency: the row's version moved (W4). The client refetches, rebases, retries. */
export class ConflictError extends DbError {
  constructor(
    readonly table: string,
    readonly id: string,
    readonly expectedVersion: number,
    readonly currentVersion: number,
  ) {
    super('version_conflict', `${table} ${id}: expected version ${expectedVersion}, found ${currentVersion}`, {
      status: 409,
      errorClass: 'transient',
    });
  }
}

/** A re-eval job's fenced write lost to newer info (W3): it must write nothing and stop. */
export class StaleGenerationError extends DbError {
  constructor(
    readonly table: string,
    readonly id: string,
    readonly expectedGeneration: number,
    readonly currentGeneration: number,
  ) {
    super(
      'stale_generation',
      `${table} ${id}: job generation ${expectedGeneration} is superseded by ${currentGeneration}`,
      { status: 409, errorClass: 'validation' },
    );
  }
}

export class NotFoundError extends DbError {
  constructor(
    readonly table: string,
    readonly id: string,
  ) {
    super('not_found', `${table} ${id} not found`, { status: 404, errorClass: 'not_found' });
  }
}

/** Bad input to a helper (unknown column, patching id/version, missing burst keys...). A bug. */
export class ValidationError extends DbError {
  constructor(message: string) {
    super('invalid_input', message, { status: 400, errorClass: 'bug' });
  }
}

/** The row is not in a state that allows this (e.g. a proposal that is no longer pending). */
export class InvalidStateError extends DbError {
  constructor(message: string) {
    super('invalid_state', message, { status: 409, errorClass: 'validation' });
  }
}

/** cc_audit refused a write to a curated table outside withChangeSet(). Always a bug. */
export class ChangeSetRequiredError extends DbError {
  constructor(message: string, cause?: unknown) {
    super('change_set_required', message, { status: 500, errorClass: 'bug', cause });
  }
}

/** A write targeted a closed (immutable) change set. */
export class ChangeSetClosedError extends DbError {
  constructor(message: string, cause?: unknown) {
    super('change_set_closed', message, { status: 409, errorClass: 'bug', cause });
  }
}

/** An append-only guard fired (audit_events, work_item_transitions). */
export class AppendOnlyError extends DbError {
  constructor(message: string, cause?: unknown) {
    super('append_only', message, { status: 500, errorClass: 'bug', cause });
  }
}

/** Undo found the row changed since the change set ("changed since: review"). Nothing was undone. */
export class UndoConflictError extends DbError {
  constructor(
    readonly changeSetId: string,
    readonly table: string,
    readonly rowId: string,
    readonly reason: 'changed_since' | 'row_missing' | 'row_exists' | 'not_restorable',
  ) {
    super('undo_conflict', `undo of change set ${changeSetId}: ${table} ${rowId} ${reason.replace('_', ' ')}`, {
      status: 409,
      errorClass: 'validation',
    });
  }
}

export class AlreadyUndoneError extends DbError {
  constructor(readonly changeSetId: string) {
    super('already_undone', `change set ${changeSetId} is already undone`, { status: 409, errorClass: 'validation' });
  }
}

export class NotUndoableError extends DbError {
  constructor(readonly changeSetId: string) {
    super('not_undoable', `change set ${changeSetId} is not undoable`, { status: 422, errorClass: 'validation' });
  }
}

/** A scan cursor may only move forward, and only as far as the recorded coverage reaches. */
export class CursorError extends DbError {
  constructor(
    readonly reason: 'regression' | 'coverage_gap',
    message: string,
  ) {
    super(`cursor_${reason}`, message, { status: 409, errorClass: 'validation' });
  }
}

export type ConstraintKind = 'unique' | 'check' | 'foreign_key' | 'exclusion' | 'not_null';

/** A DB constraint rejected the write; `constraint` is its name (e.g. drafts_approval_chk). */
export class ConstraintViolationError extends DbError {
  constructor(
    readonly kind: ConstraintKind,
    readonly constraint: string | undefined,
    readonly table: string | undefined,
    cause?: unknown,
  ) {
    super(`${kind}_violation`, `${kind} violation${constraint ? ` (${constraint})` : ''}${table ? ` on ${table}` : ''}`, {
      status: kind === 'unique' || kind === 'exclusion' ? 409 : 422,
      errorClass: 'validation',
      cause,
    });
  }
}

/** Serialization failure, deadlock, lock timeout or lost connection: safe to retry with backoff. */
export class TransientDbError extends DbError {
  constructor(message: string, cause?: unknown) {
    super('transient', message, { status: 503, errorClass: 'transient', cause });
  }
}

export const isDbError = (e: unknown): e is DbError => e instanceof DbError;

interface PgLikeError {
  code: string;
  message: string;
  constraint?: string;
  table?: string;
}

/** Drizzle 0.45 wraps driver errors (DrizzleQueryError.cause); find the pg error underneath. */
function findPgError(e: unknown): PgLikeError | undefined {
  let cur: unknown = e;
  for (let depth = 0; cur && depth < 5; depth++) {
    const c = cur as Partial<PgLikeError> & { cause?: unknown };
    if (typeof c.code === 'string' && /^[0-9A-Z]{5}$/.test(c.code) && typeof c.message === 'string') {
      return c as PgLikeError;
    }
    cur = c.cause;
  }
  return undefined;
}

const TRANSIENT_CODES = new Set(['40001', '40P01', '55P03', '57P01', '57P02', '57P03', '08000', '08003', '08006']);
const TRANSIENT_NODE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE']);

/** Translate a thrown value into a typed DbError where we know it; otherwise return it unchanged. */
export function mapPgError(e: unknown): unknown {
  if (e instanceof DbError) return e;
  const pg = findPgError(e);
  if (!pg) {
    const node = (e as { code?: unknown; cause?: { code?: unknown } } | undefined) ?? {};
    const code = typeof node.code === 'string' ? node.code : node.cause?.code;
    if (typeof code === 'string' && TRANSIENT_NODE_CODES.has(code)) {
      return new TransientDbError(`database unreachable (${code})`, e);
    }
    return e;
  }
  switch (pg.code) {
    case 'P0001': {
      if (/outside a change set/.test(pg.message)) return new ChangeSetRequiredError(pg.message, e);
      if (/change set .* (is closed|missing or closed|does not exist)/.test(pg.message)) {
        return new ChangeSetClosedError(pg.message, e);
      }
      if (/append-only|may change/.test(pg.message)) return new AppendOnlyError(pg.message, e);
      return e;
    }
    case '23505':
      return new ConstraintViolationError('unique', pg.constraint, pg.table, e);
    case '23514':
      return new ConstraintViolationError('check', pg.constraint, pg.table, e);
    case '23503':
      return new ConstraintViolationError('foreign_key', pg.constraint, pg.table, e);
    case '23P01':
      return new ConstraintViolationError('exclusion', pg.constraint, pg.table, e);
    case '23502':
      return new ConstraintViolationError('not_null', pg.constraint, pg.table, e);
    default:
      if (TRANSIENT_CODES.has(pg.code)) return new TransientDbError(`transient database error ${pg.code}`, e);
      // Class 22 = data exception (bad uuid/enum/date text, numeric overflow): the caller passed it.
      if (pg.code.startsWith('22')) return new ValidationError(`invalid value (${pg.code})`);
      return e;
  }
}
