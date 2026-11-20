/**
 * D-65 (TL-14, TL-20): every stuck state has a way out. A row that is not in Org62 after all (its Event was deleted
 * there: verify_failed "Deleted in Org62"; or its canvas ran without it: synced_to_canvas "Not in Org62") offers
 *
 *   Log again   back to approved, flagged so the next batch takes it although a sent canvas listed it before; the
 *               flag goes once a new canvas carries it (the Outbox delivery), and the read-back confirms it as usual
 *   Leave out   dismissed by you, never logged again (Restore brings it back like any dismissal)
 *
 * Pure: the DataSources persist the row (the db also clears its old Event link, verify issue and canvas stamp).
 */
import type { ActivityEntry, ResolveActivityRequest } from '@/contract';
import { isRoundTripFlag, LEFT_OUT_FLAG, LOG_AGAIN_FLAG, needsRelog, ORG62_CHECK_PREFIX } from '@/engines/activity/org62-check';
import { invalid } from '@/server/errors';

export function resolvedEntry(cur: ActivityEntry, action: ResolveActivityRequest['action']): ActivityEntry {
  if (!needsRelog(cur)) throw invalid('Only a row deleted in Org62, or missing in Org62 after its canvas ran, can be logged again or left out');
  const issues = cur.issues.filter((f) => !isRoundTripFlag(f) && !f.startsWith(ORG62_CHECK_PREFIX) && f !== LOG_AGAIN_FLAG && f !== LEFT_OUT_FLAG);
  if (action === 'log_again') return { ...cur, status: 'approved', issues: [...issues, LOG_AGAIN_FLAG], loggedAt: null, verifiedAt: null };
  return { ...cur, status: 'dismissed', excludedReason: 'dismissed', issues: [...issues, LEFT_OUT_FLAG] };
}

/** The receipt line. */
export const resolvedSummary = (cur: Pick<ActivityEntry, 'description'>, action: ResolveActivityRequest['action']): string =>
  `${action === 'log_again' ? 'Log again (next canvas)' : 'Left out'}: ${cur.description}`.slice(0, 200);
