/**
 * Re-derive a date range (2026-11-14): compare the rows the engine would propose now (the engaged-time model, no caps,
 * internal meetings logged, Travel buffers 120/60) with the rows Time holds, per local day. Pure; the database side is
 * `rederiveWeeks` (src/projections/run.ts) and the command `npm run time:rederive` (scripts/time-rederive.ts).
 *
 * What a re-derive may change (`--apply` runs the same week pass the worker runs): only rows the projections own (the
 * engine's statuses, no locked fields). The user's rows (approved and later, edited, on a canvas, in Org62) stand. A
 * row already in Org62 whose hours the model would change is never edited in place: it is an update candidate
 * (`durationUpdateCandidates`), the seam the landings model (D-70) carries to the next canvas.
 */

/** Statuses whose rows count toward the hours a day holds (what Time totals, Org62's included). */
export const COUNTED_STATUSES: ReadonlySet<string> = new Set(['upcoming', 'needs_input', 'proposed', 'approved', 'synced_to_canvas', 'logged', 'verified', 'verify_failed']);
/** A user's row that is in Org62 (its Event exists there). */
export const IN_ORG62_STATUSES: ReadonlySet<string> = new Set(['logged', 'verified', 'verify_failed']);

export interface RederiveRow {
  /** The row's id (existing rows). */
  id?: string;
  dedupeKey: string;
  startsAt: string;
  durationHours: number;
  status: string;
  seTaskType: string | null;
  whatOrg62Id: string | null;
  subject: string;
}

export interface RowChange {
  from: RederiveRow;
  to: RederiveRow;
  /** What differs: hours, status, task type, Related To. */
  fields: string[];
}

export interface RowDiff {
  added: RederiveRow[];
  changed: RowChange[];
  removed: RederiveRow[];
}

const counts = (r: Pick<RederiveRow, 'status'>) => COUNTED_STATUSES.has(r.status);

/**
 * The window's rows now (`existing`) against what the engine wants (`want`). `owned` says which existing rows the
 * re-derive may touch; a wanted row whose key is a row the user owns is not written (the user's row stands).
 */
export function diffRows(existing: readonly RederiveRow[], want: readonly RederiveRow[], owned: (r: RederiveRow) => boolean): RowDiff {
  const byKey = new Map(existing.map((r) => [r.dedupeKey, r]));
  const wantKeys = new Set(want.map((r) => r.dedupeKey));
  const added: RederiveRow[] = [];
  const changed: RowChange[] = [];
  for (const w of want) {
    const cur = byKey.get(w.dedupeKey);
    if (!cur) {
      added.push(w);
      continue;
    }
    if (!owned(cur)) continue;
    const fields: string[] = [];
    if (Math.abs(cur.durationHours - w.durationHours) > 1e-6) fields.push('hours');
    if (cur.status !== w.status) fields.push('status');
    if ((cur.seTaskType ?? '') !== (w.seTaskType ?? '')) fields.push('task type');
    if ((cur.whatOrg62Id ?? '') !== (w.whatOrg62Id ?? '')) fields.push('Related To');
    if (fields.length) changed.push({ from: cur, to: w, fields });
  }
  const removed = existing.filter((r) => owned(r) && !wantKeys.has(r.dedupeKey));
  return { added, changed, removed };
}

/** Hours that count, per local day (a row's day is its start's). */
export function hoursByDay(rows: readonly RederiveRow[], dayOf: (iso: string) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) if (counts(r)) out.set(dayOf(r.startsAt), (out.get(dayOf(r.startsAt)) ?? 0) + r.durationHours);
  return out;
}

/** The hours a window would hold after the re-derive: the user's rows as they are, every other row as the engine wants it. */
export function rowsAfter(existing: readonly RederiveRow[], want: readonly RederiveRow[], owned: (r: RederiveRow) => boolean): RederiveRow[] {
  const userKeys = new Set(existing.filter((r) => !owned(r)).map((r) => r.dedupeKey));
  return [...existing.filter((r) => !owned(r)), ...want.filter((w) => !userKeys.has(w.dedupeKey))];
}

/** The landing seam (D-70): an Org62 Event field the model would change; never edited in place. */
export interface UpdateCandidate {
  activityEntryId: string;
  org62EventId: string;
  field: 'Duration__c';
  from: number;
  to: number;
  reason: string;
}

/** A user's row not in Org62 yet (approved, on a canvas, edited) whose hours the model would change: reported only. */
export interface HeldChange {
  activityEntryId: string;
  dedupeKey: string;
  status: string;
  from: number;
  to: number;
  reason: string;
}

export interface FixedForCandidates {
  rowId: string;
  dedupeKey: string;
  status: string;
  durationHours: number;
  /** The Salesforce id of the Org62 Event the row is tied to (logged, verified). */
  org62EventId: string | null;
  /** The columns the user edited: an edited Duration is the user's, never a candidate. */
  lockedFields?: readonly string[];
}

export interface ShadowedProposal {
  dedupeKey: string;
  /** The user's row it stands behind (`wb|<day>|<bucket>` without `#n`). */
  baseKey: string;
  durationHours: number;
  reason: string;
  evidence: string;
}

const HOURS_LOCKS = new Set(['duration_hours', 'durationHours']);

/**
 * The rows the user owns whose hours the engine would now give differently: the sum of its proposals for that row's
 * key and their continuations (`#2` …) against the row's Duration. In Org62 → `candidates` (the landing seam); not yet
 * (approved, on a canvas) → `held`. A Duration the user edited is theirs (never either). A row the model no longer
 * backs at all is left alone: the app never suggests deleting an Org62 Event.
 */
export function durationUpdateCandidates(fixed: readonly FixedForCandidates[], shadowed: readonly ShadowedProposal[]): { candidates: UpdateCandidate[]; held: HeldChange[] } {
  const byBase = new Map<string, ShadowedProposal[]>();
  for (const s of shadowed) byBase.set(s.baseKey, [...(byBase.get(s.baseKey) ?? []), s]);
  const candidates: UpdateCandidate[] = [];
  const held: HeldChange[] = [];
  for (const f of fixed) {
    const props = byBase.get(f.dedupeKey);
    if (!props?.length || !COUNTED_STATUSES.has(f.status)) continue;
    if ((f.lockedFields ?? []).some((c) => HOURS_LOCKS.has(c))) continue;
    const to = Math.round(props.reduce((s, p) => s + p.durationHours, 0) * 4) / 4;
    if (Math.abs(to - f.durationHours) < 1e-6 || to <= 0) continue;
    const main = props.find((p) => p.dedupeKey === f.dedupeKey) ?? props[0]!;
    const reason = `re-derived: ${main.evidence || main.reason}`.slice(0, 300);
    if (f.org62EventId && IN_ORG62_STATUSES.has(f.status)) candidates.push({ activityEntryId: f.rowId, org62EventId: f.org62EventId, field: 'Duration__c', from: f.durationHours, to, reason });
    else held.push({ activityEntryId: f.rowId, dedupeKey: f.dedupeKey, status: f.status, from: f.durationHours, to, reason });
  }
  return { candidates, held };
}
