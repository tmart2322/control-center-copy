/**
 * Needs-you decisions in Postgres (src/contract/needs.ts): one `user_settings` key per (rule, subject),
 * `cc.need/<rule>/<subjectId>`, the decision as its jsonb value. user_settings is audited (cc_audit_kv), so a decision
 * is one change set with Undo, like the mock's `needDecisions` collection. No migration: the key-value store is the
 * schema's place for small per-user state.
 */
import { NeedDecision } from '@/contract';
import { needDecisionOrder } from '@/lib/need-decisions';

import { writeKv, type WriteCtx } from './common';

export const NEED_KV_PREFIX = 'cc.need/';
export const needKvKey = (rule: string, subjectId: string) => `${NEED_KV_PREFIX}${rule}/${subjectId}`;

/** Every stored decision (newest first); a value that no longer parses is left out, never thrown on. */
export function needDecisionsOf(kv: ReadonlyMap<string, unknown>): NeedDecision[] {
  const out: NeedDecision[] = [];
  for (const [k, v] of kv) {
    if (!k.startsWith(NEED_KV_PREFIX)) continue;
    const d = NeedDecision.safeParse(v);
    if (d.success) out.push(d.data);
  }
  return out.sort(needDecisionOrder);
}

/** Store (or, with null, drop) one decision inside a change set. */
export async function writeNeedDecision(w: WriteCtx, rule: string, subjectId: string, d: NeedDecision | null): Promise<void> {
  await writeKv(w, needKvKey(rule, subjectId), d);
}
