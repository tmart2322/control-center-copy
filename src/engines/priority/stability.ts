/**
 * Rank stability (UI-SPEC §1.7, brief 08 §3.7 #1): Top 3 positions change only when the user acts,
 * an urgent pre-emption happens ("now late unless started"), or the user explicitly applies (`r` / ↻).
 * Everything else is announced as "Re-rank ready · n" with a diff for the pill.
 */
import type { RankingResult } from './types';

export interface RerankOptions {
  /** Items the user just acted on (done, snooze, dismiss, not now…): their slots free up. */
  actedOn?: string[];
  /** The user pressed `r` / ↻ or applied the pill: take the new Top 3 as-is. */
  explicitApply?: boolean;
}

export interface RerankMove {
  workItemId: string;
  title: string;
  /** 1-based position shown now (null = not shown). */
  from: number | null;
  /** 1-based position in the new ranking (null = drops out of the Top 3). */
  to: number | null;
  reason: string;
}

export interface RerankResult {
  /** What the NOW stack shows after this call. */
  top3: string[];
  applied: boolean;
  /** Items forced in by an urgent pre-emption, with "↑ moved up" reasons. */
  preempted: Array<{ workItemId: string; reason: string }>;
  /** Items that took a slot freed by the user's action or by an item leaving (closed for you…). */
  filled: string[];
  /** "Re-rank ready · n": how many positions would change if applied. 0 hides the pill. */
  rerankReady: number;
  diff: RerankMove[];
}

export function rerank(previousTop3: string[], next: RankingResult, opts: RerankOptions = {}): RerankResult {
  const target = next.top3;
  if (opts.explicitApply) {
    return { top3: [...target], applied: true, preempted: [], filled: [], rerankReady: 0, diff: diffOf(previousTop3, target, next) };
  }

  const size = next.top3Size;
  const byId = new Map(next.ranked.map((s) => [s.workItemId, s]));
  const acted = new Set(opts.actedOn ?? []);
  const keep = (id: string): boolean => !acted.has(id) && byId.get(id)?.top3Eligible === true;

  // 1. Keep positions; an item the user acted on, or that left the ranking, leaves a hole.
  const shown: Array<string | null> = previousTop3.map((id) => (keep(id) ? id : null));

  // 2. Urgent pre-emption: a "late unless started" item of the new Top 3 takes its new position.
  const preempted: RerankResult['preempted'] = [];
  for (const id of target) {
    const s = byId.get(id)!;
    if (!s.preempt || shown.includes(id)) continue;
    shown.splice(Math.min(target.indexOf(id), shown.length), 0, id);
    preempted.push({ workItemId: id, reason: `↑ moved up: now late unless started (start by ${s.startByLabel ?? 'now'})` });
  }

  // 3. Fill holes in place, then empty tail slots, from the new ranking in order.
  const filled: string[] = [];
  const candidates = next.ranked.filter((s) => s.top3Eligible).map((s) => s.workItemId);
  const nextCandidate = (): string | null => candidates.find((id) => !shown.includes(id)) ?? null;
  for (let i = 0; i < shown.length; i++) {
    if (shown[i] !== null) continue;
    const id = nextCandidate();
    if (!id) break;
    shown[i] = id;
    filled.push(id);
  }
  let top3 = shown.filter((x): x is string => x !== null);
  while (top3.length < size) {
    const id = candidates.find((c) => !top3.includes(c));
    if (!id) break;
    top3.push(id);
    filled.push(id);
  }
  top3 = top3.slice(0, size);

  return { top3, applied: false, preempted, filled: filled.filter((id) => top3.includes(id)), rerankReady: countPositionChanges(top3, target), diff: diffOf(top3, target, next) };
}

function countPositionChanges(shown: string[], target: string[]): number {
  const n = Math.max(shown.length, target.length);
  let changes = 0;
  for (let i = 0; i < n; i++) if (shown[i] !== target[i]) changes++;
  return changes;
}

function diffOf(shown: string[], target: string[], next: RankingResult): RerankMove[] {
  const ids = [...new Set([...shown, ...target])];
  const moves: RerankMove[] = [];
  for (const id of ids) {
    const from = shown.indexOf(id);
    const to = target.indexOf(id);
    if (from === to) continue;
    const s = next.scores[id];
    moves.push({
      workItemId: id,
      title: s?.title ?? id,
      from: from < 0 ? null : from + 1,
      to: to < 0 ? null : to + 1,
      reason: to < 0 ? (s ? `drops to #${s.rank ?? '—'}: ${s.explanation}` : 'No longer ranked') : (s?.explanation ?? ''),
    });
  }
  return moves.sort((a, b) => (a.to ?? 99) - (b.to ?? 99) || a.workItemId.localeCompare(b.workItemId));
}
