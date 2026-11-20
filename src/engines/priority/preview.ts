/**
 * Policy preview (UI-SPEC §8 "Explicit Apply, with a preview of the re-rank first"; R-UI-16).
 * Ranks the same inputs under the old and the new policy and explains the before/after Top 10.
 * Shapes mirror W0 `PolicyPreview` / `RankRow`, plus per-row reasons and the policy diff.
 */
import type { PolicyRule, PolicyWeights, PriorityPolicy } from './policy';
import { rankWork } from './rank';
import type { PriorityInputs, RankingResult, ScoredItem } from './types';

export interface PreviewRow {
  workItemId: string;
  title: string;
  rank: number;
  score: number;
  /** Positive = moved up vs the current (old-policy) ranking. 0 on `before` rows. */
  moved: number;
  topReason: string | null;
  /** Rule hits and components that explain the row, in the new policy's terms. */
  reasons: string[];
  policyVersion: number;
}

export interface PolicyChange {
  kind: 'rule_added' | 'rule_removed' | 'rule_changed' | 'rule_enabled' | 'rule_disabled' | 'weight_changed' | 'top3_size_changed' | 'tuning_changed';
  key: string;
  label: string;
}

export interface PolicyPreview {
  basedOnVersion: number;
  newVersion: number;
  before: PreviewRow[];
  after: PreviewRow[];
  changedCount: number;
  /** "3 items move; 'Prep ACME demo' takes #1" */
  summary: string;
  changes: PolicyChange[];
}

const WEIGHT_LABEL: Record<keyof PolicyWeights, string> = {
  deadlineProximity: 'deadline proximity',
  calendarPressure: 'calendar pressure',
  leadTime: 'lead time',
  effortFit: 'effort fit',
  stakeholderImportance: 'stakeholder importance',
  dealValue: 'deal value',
  commitment: 'commitment',
  staleness: 'staleness',
  obligation: 'obligation',
};

export function diffPolicies(a: PriorityPolicy, b: PriorityPolicy): PolicyChange[] {
  const out: PolicyChange[] = [];
  for (const k of Object.keys(WEIGHT_LABEL) as Array<keyof PolicyWeights>) {
    if (a.weights[k] !== b.weights[k])
      out.push({ kind: 'weight_changed', key: `weight:${k}`, label: `Weight ${WEIGHT_LABEL[k]} ${a.weights[k]} → ${b.weights[k]}` });
  }
  const ra = new Map(a.rules.map((r) => [r.ruleKey, r]));
  const rb = new Map(b.rules.map((r) => [r.ruleKey, r]));
  const same = (x: PolicyRule, y: PolicyRule) => JSON.stringify({ ...x, enabled: true }) === JSON.stringify({ ...y, enabled: true });
  for (const [key, r] of rb) {
    const old = ra.get(key);
    if (!old) out.push({ kind: 'rule_added', key, label: `Added rule '${r.label}'` });
    else if (old.enabled !== r.enabled) out.push({ kind: r.enabled ? 'rule_enabled' : 'rule_disabled', key, label: `${r.enabled ? 'Enabled' : 'Disabled'} rule '${r.label}'` });
    else if (!same(old, r)) out.push({ kind: 'rule_changed', key, label: `Changed rule '${r.label}'` });
  }
  for (const [key, r] of ra) if (!rb.has(key)) out.push({ kind: 'rule_removed', key, label: `Removed rule '${r.label}'` });
  if (a.top3Size !== b.top3Size) out.push({ kind: 'top3_size_changed', key: 'top3Size', label: `Top ${a.top3Size} → Top ${b.top3Size}` });
  if (JSON.stringify(a.tuning) !== JSON.stringify(b.tuning)) out.push({ kind: 'tuning_changed', key: 'tuning', label: 'Changed engine thresholds' });
  return out;
}

function rowsOf(r: RankingResult, limit: number, movedFrom?: RankingResult): PreviewRow[] {
  return r.ranked.slice(0, limit).map((s: ScoredItem) => {
    const prev = movedFrom?.scores[s.workItemId];
    const prevRank = prev?.rank ?? null;
    return {
      workItemId: s.workItemId,
      title: s.title,
      rank: s.rank!,
      score: s.total,
      // Not ranked before (background/hidden): count it as entering from just below the last row.
      moved: movedFrom ? (prevRank ?? movedFrom.ranked.length + 1) - s.rank! : 0,
      topReason: s.reasons[0]?.label ?? null,
      reasons: [...s.ruleHits.map((h) => h.explanation), ...s.reasons.filter((x) => !x.key.startsWith('rule:')).slice(0, 2).map((x) => x.label)],
      policyVersion: s.policyVersion,
    };
  });
}

export function previewPolicy(
  oldPolicy: PriorityPolicy,
  newPolicy: PriorityPolicy,
  inputs: Omit<PriorityInputs, 'policy'>,
  opts: { limit?: number } = {},
): PolicyPreview {
  const limit = opts.limit ?? 10;
  const before = rankWork({ ...inputs, policy: oldPolicy });
  const after = rankWork({ ...inputs, policy: newPolicy });
  const beforeRows = rowsOf(before, limit);
  const afterRows = rowsOf(after, limit, before);

  const ids = new Set([...beforeRows, ...afterRows].map((r) => r.workItemId));
  let changedCount = 0;
  for (const id of ids) if ((before.scores[id]?.rank ?? null) !== (after.scores[id]?.rank ?? null)) changedCount++;

  const first = afterRows[0];
  const firstChanged = first && beforeRows[0]?.workItemId !== first.workItemId;
  const summary =
    changedCount === 0
      ? `No change in the Top ${limit}`
      : `${changedCount} item${changedCount === 1 ? '' : 's'} move${changedCount === 1 ? 's' : ''}${firstChanged ? `; '${first.title}' takes #1` : ''}`;

  return {
    basedOnVersion: oldPolicy.version,
    newVersion: newPolicy.version,
    before: beforeRows,
    after: afterRows,
    changedCount,
    summary,
    changes: diffPolicies(oldPolicy, newPolicy),
  };
}
