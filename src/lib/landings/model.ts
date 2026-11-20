/**
 * D-70: the landing rows as both DataSources keep them (the db's record_landings / landing_writes / use_cases, the
 * mock's memory), and the keys that find them again. Pure.
 */
import type { LandingDestination, LandingState, RecordKind, WriteOp, WriteOrigin, WriteState } from '@/contract';

export type Values = Record<string, string | null>;

export interface LandingRow {
  id: string;
  recordKind: RecordKind;
  recordId: string;
  destination: LandingDestination;
  externalId: string | null;
  state: LandingState;
  remoteValues: Values | null;
  verifiedAt: string | null;
  lastReadAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WriteRow {
  id: string;
  landingId: string;
  draftId: string | null;
  rowKey: string;
  op: WriteOp;
  before: Values | null;
  after: Values;
  state: WriteState;
  origin: WriteOrigin;
  reason: string;
  sentAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The app's own use case: one id per use case, whichever system it came from. */
export interface UseCaseRow {
  id: string;
  vdpUseCaseId: string | null;
  /** The Use_Case__c's 15-character id. */
  org62UseCaseId: string | null;
  vdpSlug: string | null;
  title: string;
  accountId: string | null;
  opportunityId: string | null;
  org62OpportunityId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LandingStore {
  landings: readonly LandingRow[];
  writes: readonly WriteRow[];
  useCases: readonly UseCaseRow[];
}

export const EMPTY_STORE: LandingStore = { landings: [], writes: [], useCases: [] };

export const landingKey = (kind: RecordKind, recordId: string, dest: LandingDestination) => `${kind}|${recordId}|${dest}`;
export const keyOfLanding = (l: Pick<LandingRow, 'recordKind' | 'recordId' | 'destination'>) => landingKey(l.recordKind, l.recordId, l.destination);

export const id15 = (s: string | null | undefined) => (s ?? '').slice(0, 15);

/** A canvas UPDATE row's key: the object, the record (15) and the field. */
export const updateWriteKey = (object: string, recordId: string, field: string) => `upd:${object}:${id15(recordId)}:${field}`;

/** Write states that are still waiting for a canvas (no draft yet). */
export const OPEN_WRITE: ReadonlySet<WriteState> = new Set(['proposed', 'approved']);
/** Write states on a canvas or item not applied yet. */
export const PENDING_WRITE: ReadonlySet<WriteState> = new Set(['staged', 'failed']);
/** Write states that went out. */
export const SENT_WRITE: ReadonlySet<WriteState> = new Set(['sent', 'verified']);

/** What changed in one sync: rows to insert and rows whose fields moved (the whole new row). */
export interface StoreChanges {
  landings: { insert: LandingRow[]; update: LandingRow[]; remove: string[] };
  writes: { insert: WriteRow[]; update: WriteRow[] };
  useCases: { insert: UseCaseRow[]; update: UseCaseRow[]; remove: string[] };
}

export const noChanges = (c: StoreChanges) =>
  !c.landings.insert.length && !c.landings.update.length && !c.landings.remove.length && !c.writes.insert.length && !c.writes.update.length && !c.useCases.insert.length && !c.useCases.update.length && !c.useCases.remove.length;

/** The store after the changes (the mock keeps this; the db writes the changes). */
export function applyChanges(s: LandingStore, c: StoreChanges): LandingStore {
  const upd = <T extends { id: string }>(rows: readonly T[], ch: { insert: T[]; update: T[]; remove?: string[] }): T[] => {
    const gone = new Set(ch.remove ?? []);
    const next = new Map(ch.update.map((r) => [r.id, r] as const));
    return [...rows.filter((r) => !gone.has(r.id)).map((r) => next.get(r.id) ?? r), ...ch.insert];
  };
  return { landings: upd(s.landings, c.landings), writes: upd(s.writes, c.writes), useCases: upd(s.useCases, c.useCases) };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** Two rows hold the same values (updatedAt aside). */
export function sameRow<T extends { updatedAt: string }>(a: T, b: T): boolean {
  const { updatedAt: _a, ...x } = a;
  const { updatedAt: _b, ...y } = b;
  return same(sortKeys(x), sortKeys(y));
}
function sortKeys(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(sortKeys);
  if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortKeys(v)]));
  return o;
}
