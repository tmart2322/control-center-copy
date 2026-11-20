/** Agents list grouping (pure): waiting on you first, then running, done-review, failed, stale, done. */
import type { AgentRun, RunState } from '@/contract';

export type GroupKey = 'waiting_on_you' | 'running' | 'done_review' | 'failed' | 'stale' | 'done' | 'scheduled';

export const GROUPS: Array<{ key: GroupKey; label: string; hint?: string }> = [
  { key: 'waiting_on_you', label: 'Waiting on you', hint: 'Needs an answer before it can continue' },
  { key: 'running', label: 'Running', hint: 'Including queued' },
  { key: 'done_review', label: 'Done, review', hint: 'Finished; check the result' },
  { key: 'failed', label: 'Failed' },
  { key: 'stale', label: 'Stale', hint: 'No activity for a while' },
  { key: 'done', label: 'Done' },
  { key: 'scheduled', label: 'Scheduled', hint: 'Autopilot sessions; flagged only when really waiting' },
];

const BY_STATE: Record<RunState, GroupKey> = {
  waiting_on_you: 'waiting_on_you',
  running: 'running',
  queued: 'running',
  done_review: 'done_review',
  failed: 'failed',
  stale: 'stale',
  done: 'done',
};

export function groupOf(run: Pick<AgentRun, 'state' | 'scheduled'>): GroupKey {
  if (run.scheduled && run.state !== 'waiting_on_you') return 'scheduled';
  return BY_STATE[run.state];
}

/** Stable order inside a group (never by `updatedAt`, so live updates don't reorder rows). */
export function compareInGroup(a: AgentRun, b: AgentRun, key?: GroupKey): number {
  if (key === 'waiting_on_you') return (a.waiting?.since ?? '').localeCompare(b.waiting?.since ?? '') || a.id.localeCompare(b.id); // longest-waiting first
  return (b.startedAt ?? '').localeCompare(a.startedAt ?? '') || a.id.localeCompare(b.id);
}

export interface RunGroup {
  key: GroupKey;
  label: string;
  hint?: string;
  runs: AgentRun[];
}

/**
 * Group runs. `held` maps run id → the group it had when the layout was last settled; while the user is
 * working in the list the caller passes it so a state change repaints the row in place instead of moving it.
 */
export function groupRuns(runs: AgentRun[], held?: Readonly<Record<string, GroupKey>>): RunGroup[] {
  const buckets = new Map<GroupKey, AgentRun[]>();
  for (const r of runs) {
    const key = held?.[r.id] ?? groupOf(r);
    buckets.set(key, [...(buckets.get(key) ?? []), r]);
  }
  // While a layout is held, runs that arrived after it was taken go below the held rows ("n new ↓"), not into sort position.
  const order = (list: AgentRun[], key: GroupKey) => {
    const cmp = (a: AgentRun, b: AgentRun) => compareInGroup(a, b, key);
    if (!held) return list.slice().sort(cmp);
    const known = list.filter((r) => held[r.id] !== undefined).sort(cmp);
    const fresh = list.filter((r) => held[r.id] === undefined).sort(cmp);
    return [...known, ...fresh];
  };
  return GROUPS.map((g) => ({ ...g, runs: order(buckets.get(g.key) ?? [], g.key) })).filter((g) => g.runs.length > 0);
}

export function layoutOf(runs: AgentRun[]): Record<string, GroupKey> {
  return Object.fromEntries(runs.map((r) => [r.id, groupOf(r)]));
}

/** How many runs would change group if the held layout were released. */
export function pendingMoves(runs: AgentRun[], held: Readonly<Record<string, GroupKey>>): number {
  return runs.filter((r) => held[r.id] !== undefined && held[r.id] !== groupOf(r)).length;
}

/** Runs that just became waiting on me (for the live announcement). */
export function newlyWaiting(prev: ReadonlyMap<string, RunState>, runs: AgentRun[]): AgentRun[] {
  return runs.filter((r) => r.state === 'waiting_on_you' && prev.has(r.id) && prev.get(r.id) !== 'waiting_on_you');
}
