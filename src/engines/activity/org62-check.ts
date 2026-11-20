/**
 * D-65: the Time ↔ Org62 round trip, as the rows say it. One place for the flags the read-back and the projections
 * write, how a row reads against Org62 (`org62CheckOf`), and ONE status → count map (`countBucketOf`) that Time, the
 * quarter totals, the canvas receipts and Home all use (TL-45). Pure; shared by both DataSources and the UI.
 *
 *   logged     in Org62: logged, verified, and verify_failed while its Event exists (it differs, but Org62 has the
 *              hours). Not a legacy record-type Event (TL-41: re-create to count), not one deleted in Org62.
 *   approved   on its way: approved or handed to a canvas, and not found missing in Org62 yet
 *   proposed   the app's suggestions (proposed, needs input)
 *   none       not counted: upcoming, dismissed, deleted in Org62, not in Org62 after the canvas ran, legacy
 */
import { localHm } from './time';

/** The verify issue of an app row whose Org62 Event was deleted there. */
export const DELETED_IN_ORG62 = 'Deleted in Org62';
/** Issues the read side derives from the row's verify issue start with this (`Org62 check: Deleted in Org62`). */
export const ORG62_CHECK_PREFIX = 'Org62 check: ';
/** TL-20: handed to a canvas that ran (Org62 shows later Events of mine), and still no Event for this row. */
export const NOT_IN_ORG62_FLAG = 'Not in Org62: the canvas ran, but Org62 has no Event for this row (Slackbot skipped or failed it)';
/** TL-04 / TL-21: a second Org62 Event in a slot another Event already logs. Both stay logged; this one is flagged. */
export const DUPLICATE_MARKER = 'possible duplicate in Org62';
export const duplicateFlag = (other: string, from: number, to: number, tz: string): string => `${DUPLICATE_MARKER}: '${other.slice(0, 80)}' ${localHm(from, tz)}–${localHm(to, tz)} is the same slot; delete one there if it is`;
/** TL-41: an Event of the legacy record type (locked): it closes the proposal but is not counted until re-created. */
export const LEGACY_MARKER = '(legacy, locked)';
export const legacyFlag = (recordType: string, want: string): string => `Org62 record type is ${recordType} ${LEGACY_MARKER}: re-create as a ${want} to count`;
/** TL-08: a customer task type logged with Related To empty. */
export const RELATED_TO_EMPTY_FLAG = 'Related To empty in Org62: set the opportunity there';
/** TL-22: joined on its CC# key, but Slackbot wrote another start (UTC written as local). Information. */
export const START_DIFFERS_MARKER = 'Org62 start differs';
export const startDiffersFlag = (minutes: number, at: number, tz: string): string => `${START_DIFFERS_MARKER} by ${minutes} min (Org62 starts ${localHm(at, tz)}); fix it there if it is wrong`;
/** TL-14 / TL-20: Log again: back to approved, on the next canvas. Cleared once a canvas carries it. */
export const LOG_AGAIN_FLAG = 'Log again: you put it back on the next canvas';
/** TL-14 / TL-20: Leave out: dismissed by you, never logged again. */
export const LEFT_OUT_FLAG = 'Left out: you chose not to log it again';
/** TL-03: one Org62 Event covers this meeting and another. */
export const COVERED_MARKER = 'Logged in Org62 inside';
export const coveredFlag = (subject: string): string => `${COVERED_MARKER} '${subject.slice(0, 80)}' (one Event covers it and another meeting)`;
/** TL-05: an approved row the user then logged by hand: Org62 is the record, the row takes its values. */
export const MANUAL_LOG_NOTE = 'Logged in Org62 by hand: the row takes its values';
/** TL-32: the meeting moved in Calendar after it was handed off: the row stays where it was logged. */
export const RESCHEDULED_MARKER = 'Rescheduled in Calendar';
export const rescheduledFlag = (day: string, hm: string): string => `${RESCHEDULED_MARKER} to ${day} ${hm} after it was handed off: its Org62 Event keeps the old time; fix it there if it should move`;
/** TL-31: a meeting cancelled after approve or stage (the D-64 decline path). */
export const CANCELLED_MARKER = 'This meeting was cancelled';
export const CANCELLED_LOGGED_FLAG = `${CANCELLED_MARKER} after it was handed off: its Org62 Event stays (the app never deletes one); delete it in Org62 if it should not count`;
export const CANCELLED_HELD_FLAG = `${CANCELLED_MARKER}: it waits on a canvas you have not applied; the canvas drops it at Apply`;

/** Every flag the round trip owns and rewrites (a later pass replaces its own, never the user's). */
const ROUND_TRIP_FLAG = [NOT_IN_ORG62_FLAG, DUPLICATE_MARKER, START_DIFFERS_MARKER, RELATED_TO_EMPTY_FLAG];
export const isRoundTripFlag = (f: string): boolean => ROUND_TRIP_FLAG.some((p) => f.startsWith(p));

export type Org62Check = 'deleted' | 'not_in_org62' | 'differs' | 'duplicate' | 'legacy' | 'related_to_empty';

type Row = { status: string; issues?: readonly string[] | null; flags?: readonly string[] | null };
const notesOf = (e: Row): readonly string[] => e.issues ?? e.flags ?? [];

/** How a row reads against Org62 (null: nothing to say). The strongest first: gone, missing, differs, then flags. */
export function org62CheckOf(e: Row): Org62Check | null {
  const n = notesOf(e);
  if (e.status === 'verify_failed' && n.some((x) => x === DELETED_IN_ORG62 || x === `${ORG62_CHECK_PREFIX}${DELETED_IN_ORG62}`)) return 'deleted';
  if (e.status === 'synced_to_canvas' && n.includes(NOT_IN_ORG62_FLAG)) return 'not_in_org62';
  if (e.status === 'verify_failed') return 'differs';
  if (n.some((x) => x.includes(LEGACY_MARKER))) return 'legacy';
  if (n.some((x) => x.startsWith(DUPLICATE_MARKER))) return 'duplicate';
  if (n.includes(RELATED_TO_EMPTY_FLAG)) return 'related_to_empty';
  return null;
}

/** Deleted in Org62, or missing after its canvas ran: the row offers Log again / Leave out (TL-14, TL-20). */
export const needsRelog = (e: Row): boolean => {
  const c = org62CheckOf(e);
  return c === 'deleted' || c === 'not_in_org62';
};

export type CountBucket = 'logged' | 'approved' | 'proposed' | 'none';

/** TL-45: the one status → count map. */
export function countBucketOf(e: Row): CountBucket {
  const check = org62CheckOf(e);
  if (check === 'legacy' || check === 'deleted' || check === 'not_in_org62') return 'none';
  if (e.status === 'logged' || e.status === 'verified' || e.status === 'verify_failed') return 'logged';
  if (e.status === 'approved' || e.status === 'synced_to_canvas') return 'approved';
  if (e.status === 'proposed' || e.status === 'needs_input') return 'proposed';
  return 'none';
}

/** Counted in logged hours (Time's week, the quarter, Home, the receipts' "in Org62"). */
export const countsAsLogged = (e: Row): boolean => countBucketOf(e) === 'logged';

/** TL-23: the `CC#<key>` a work-order row's Description carries (the app row id: a UUID; older rows a short id). */
export const CC_KEY_RE = /CC#([A-Za-z0-9][A-Za-z0-9_-]*)/;
export const ccKeyOf = (text: string | null | undefined): string | null => CC_KEY_RE.exec(text ?? '')?.[1] ?? null;
