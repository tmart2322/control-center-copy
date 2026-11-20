/**
 * D-64: "Dismiss all from <source>" rules in `user_settings` (audited: adding or removing one is one change set, and
 * Undo reverts it with the rows it set aside).
 *
 *   cc.time.dismiss-rules   { rules: [{ key, kind, label, createdAt }] } — `repo:<name>`, `docs:unmapped`,
 *                           `series:<calendar>|<series id>`. The projections write every new row of a covered source
 *                           `dismissed` with the rule's flag (projections/activity.ts planWeek), and revive the ones
 *                           whose rule is gone.
 *
 * Also: the activity rows a canvas item not applied yet holds (a declined meeting's row there is flagged, not removed).
 */
import { sql } from 'drizzle-orm';

import type { Draft, TimeDismissRule } from '@/contract';
import type { DbOrTx } from '@/db/client';
import { canvasHolds } from '@/lib/canvas/payload';

import { draftStatusFromDb, type DbDraftStatus } from '../enums';

export const TIME_DISMISS_RULES_KEY = 'cc.time.dismiss-rules';

type StoredRule = Omit<TimeDismissRule, 'rows'>;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The stored rules (tolerant: a malformed entry is dropped, never thrown), oldest first. */
export function readTimeDismissRules(kv: Map<string, unknown>): StoredRule[] {
  const v = kv.get(TIME_DISMISS_RULES_KEY);
  const list = isObj(v) && Array.isArray(v.rules) ? v.rules : [];
  return list.filter(
    (r): r is StoredRule =>
      isObj(r) && typeof r.key === 'string' && typeof r.label === 'string' && typeof r.createdAt === 'string' && (r.kind === 'repo' || r.kind === 'docs' || r.kind === 'series'),
  );
}

/** The stored value with `rule` added (once per key) or the key removed. */
export function withRule(rules: readonly StoredRule[], add: StoredRule | null, removeKey?: string): { rules: StoredRule[] } | null {
  const next = rules.filter((r) => r.key !== (add?.key ?? removeKey));
  if (add) next.push(add);
  return next.length ? { rules: next } : null;
}

/** Activity row ids a logging canvas item not applied yet (ready, sending, failed) holds. */
export async function heldActivityRows(db: DbOrTx, userId: string): Promise<Set<string>> {
  const r = await db.execute<{ id: string; status: DbDraftStatus; payload: Draft['destination'] | null }>(sql`
    select id::text as id, status::text as status, payload from drafts where owner_user_id = ${userId} and payload ->> 'action' = 'slack_canvas.create'`);
  const holds = canvasHolds(r.rows.filter((x) => x.payload).map((x) => ({ id: x.id, status: draftStatusFromDb(x.status), destination: x.payload! })));
  return new Set(holds.rows.keys());
}
