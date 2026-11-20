/**
 * Engaged time (2026-11-14, the owner's direction: "grounded in truth", no caps). Solo work is counted from the owner's
 * own actions, never from the length of a session or a burst:
 *
 *  - every own action (a Claude prompt, a Slack message sent, a Drive edit, an email sent, a commit) implies engaged
 *    minutes around it: reading and thinking before it (`leadMin`), reading the result after it (`tailMin`);
 *  - actions within `gapMin` of each other are one stretch, and the time between them counts (reading, thinking,
 *    watching Claude work); a longer gap ends the stretch;
 *  - Claude's own run time counts only in part: after a stretch's last prompt, `agentShare` of the agent's remaining
 *    run (at most `agentMaxMin`) is added. "Often I am sitting there while it's running, but it's not a constant
 *    looking activity." Agent time is never counted otherwise (D-17).
 *
 * Attribution (D-64): each stretch is cut into pieces, one per run of actions that name the same account, else the
 * same repo, else the same internal bucket (unmapped Drive docs, unmapped Slack and email). A Slack message or an email
 * that names no account is a weak signal: inside a stretch with other work it extends that work's time and claims
 * none of its own. The cut between two different attributions is the midpoint of their actions.
 *
 * Calibrated on the owner's live week of 9–15 Nov 2026 (read-only): see `DEFAULT_ENGAGED_PARAMS`. Pure: no I/O, no
 * model calls.
 */
import { MIN } from './time';

export type EngagedKind = 'prompt' | 'slack' | 'email' | 'drive' | 'git' | 'segment';

export interface EngagedParams {
  /** Minutes before each action that count: reading, thinking, typing. */
  leadMin: Readonly<Record<EngagedKind, number>>;
  /** Minutes after each action that count: reading what came back. */
  tailMin: Readonly<Record<EngagedKind, number>>;
  /** Two actions at most this many minutes apart are one stretch (the time between counts). */
  gapMin: number;
  /** Share of Claude's run after a stretch's last prompt that counts (you watch part of it). */
  agentShare: number;
  /** At most this many minutes of that per stretch. */
  agentMaxMin: number;
}

/**
 * Calibration (read-only, the owner's live week of 9–15 Nov 2026: 227 prompts, 306 Slack messages sent, 41 Drive edits,
 * 1 email sent; 27.25 h of meetings on the wall clock). Raw 15-minute blocks with any own signal came to 52 h with
 * meetings (61 h by the owner's count, which also took blocks Claude ran in); the owner put the truth at 45–55 h.
 * Parameters tried (solo hours of the week): leads 5/3 min, gap 20, a third of the run up to 20 min: 27 h; gap 15:
 * 25.5 h; no agent share at all: 21.5 h; these: 22.75 h, so the week logs 54.5 h with the meetings as they log (51 h
 * with overlapping meetings counted once), inside the range.
 *   - a prompt: 4 min before it (reading the last answer, writing the prompt), 1 min after (seeing it start);
 *   - a Slack message: 2 min before (reading, typing), 1 min after;
 *   - an email sent: 8 min before (writing it), 1 min after;
 *   - a Drive edit (Drive keeps the last edit time only): 10 min before it;
 *   - a commit: 10 min before, 2 min after;
 *   - 15 min joins two actions into one stretch: prompting every few minutes while Claude works is one sitting;
 *   - a quarter of Claude's run after a stretch's last prompt counts, at most 15 min: you watch it start, then leave it.
 */
export const DEFAULT_ENGAGED_PARAMS: EngagedParams = {
  leadMin: { prompt: 4, slack: 2, email: 8, drive: 10, git: 10, segment: 0 },
  tailMin: { prompt: 1, slack: 1, email: 1, drive: 0, git: 2, segment: 0 },
  gapMin: 15,
  agentShare: 0.25,
  agentMaxMin: 15,
};

export const engagedParams = (p?: Partial<EngagedParams> | null): EngagedParams => ({
  ...DEFAULT_ENGAGED_PARAMS,
  ...(p ?? {}),
  leadMin: { ...DEFAULT_ENGAGED_PARAMS.leadMin, ...(p?.leadMin ?? {}) },
  tailMin: { ...DEFAULT_ENGAGED_PARAMS.tailMin, ...(p?.tailMin ?? {}) },
});

export interface EngagedAction {
  /** Epoch ms of the action (a span action's start). */
  at: number;
  /** A span action (a known edit session, a derived human segment): its end. */
  until?: number;
  kind: EngagedKind;
  /** The evidence id behind it (session id, message id, file id, commit sha). */
  evidenceId: string;
  /** The account it names (the session's mapping or title, the channel, the file title, the thread's domains). */
  accountKey: string | null;
  /** The repo or project (prompts, commits). */
  repoKey: string | null;
  /** Prompts: when Claude's turn after it ended (its last record before the next prompt). */
  runEndsAt?: number;
}

export interface EngagedPiece {
  start: number;
  end: number;
  /** `acct:<key>` · `repo:<key>` · `docs:unmapped` · `comms:unmapped` */
  bucket: string;
  accountKey: string | null;
  repoKey: string | null;
  /** The kind most of its actions are (the time block's source). */
  kind: EngagedKind;
  evidenceIds: string[];
  /** Actions behind it, per kind. */
  counts: Partial<Record<EngagedKind, number>>;
  /** Minutes of Claude's own run that count in it (the partial share). */
  agentMin: number;
}

export interface EngagedStretch {
  start: number;
  end: number;
  actions: number;
  /** Minutes of Claude's run after the last prompt that count (the partial share). */
  agentMin: number;
  pieces: EngagedPiece[];
}

const WEAK: ReadonlySet<EngagedKind> = new Set(['slack', 'email']);
const weak = (a: EngagedAction): boolean => WEAK.has(a.kind) && !a.accountKey;
const endOf = (a: EngagedAction): number => a.until ?? a.at;

/** The bucket an action's time goes to. */
export function bucketOf(a: Pick<EngagedAction, 'kind' | 'accountKey' | 'repoKey'>): string {
  if (a.accountKey) return `acct:${a.accountKey}`;
  if (a.repoKey) return `repo:${a.repoKey}`;
  return WEAK.has(a.kind) ? 'comms:unmapped' : 'docs:unmapped';
}

const PRIORITY: readonly EngagedKind[] = ['prompt', 'segment', 'git', 'drive', 'slack', 'email'];

function piece(actions: readonly EngagedAction[], start: number, end: number): EngagedPiece {
  const a0 = actions[0]!;
  const counts: Partial<Record<EngagedKind, number>> = {};
  for (const a of actions) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
  const kind = [...PRIORITY].sort((x, y) => (counts[y] ?? 0) - (counts[x] ?? 0) || PRIORITY.indexOf(x) - PRIORITY.indexOf(y))[0]!;
  return {
    start,
    end,
    bucket: bucketOf(a0),
    accountKey: a0.accountKey,
    repoKey: a0.accountKey ? (actions.find((a) => a.repoKey)?.repoKey ?? null) : a0.repoKey,
    kind,
    evidenceIds: [...new Set(actions.map((a) => a.evidenceId))].sort(),
    counts,
    agentMin: 0,
  };
}

/** Cut one stretch into attributed pieces (midpoints between actions of different buckets), merged per bucket run. */
function cut(actions: readonly EngagedAction[], start: number, end: number): EngagedPiece[] {
  const strong = actions.filter((a) => !weak(a));
  const owners = strong.length ? strong : actions;
  // runs of consecutive owners in the same bucket
  const runs: EngagedAction[][] = [];
  for (const a of owners) {
    const last = runs[runs.length - 1];
    if (last && bucketOf(last[0]!) === bucketOf(a)) last.push(a);
    else runs.push([a]);
  }
  const out: EngagedPiece[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    const prev = runs[i - 1];
    const next = runs[i + 1];
    const s = prev ? Math.round((endOf(prev[prev.length - 1]!) + run[0]!.at) / 2) : start;
    const e = next ? Math.round((endOf(run[run.length - 1]!) + next[0]!.at) / 2) : end;
    // the weak actions inside this run's span ride along (their ids are evidence of the time)
    const riders = strong.length ? actions.filter((a) => weak(a) && a.at >= s && a.at < e) : [];
    const p = piece(run, Math.max(start, s), Math.min(end, e));
    if (riders.length) {
      p.evidenceIds = [...new Set([...p.evidenceIds, ...riders.map((a) => a.evidenceId)])].sort();
      for (const r of riders) p.counts[r.kind] = (p.counts[r.kind] ?? 0) + 1;
    }
    if (p.end > p.start) out.push(p);
  }
  return out;
}

/**
 * The engaged stretches of a set of own actions (any day, any source): each is cut into attributed pieces. Pieces
 * never overlap: they are the wall clock of solo work (meetings take their time later, blocks.ts).
 */
export function engagedStretches(input: readonly EngagedAction[], params: EngagedParams = DEFAULT_ENGAGED_PARAMS): EngagedStretch[] {
  const actions = [...input].filter((a) => Number.isFinite(a.at)).sort((a, b) => a.at - b.at || a.evidenceId.localeCompare(b.evidenceId));
  const gap = params.gapMin * MIN;
  const groups: EngagedAction[][] = [];
  let cur: EngagedAction[] | null = null;
  let lastEnd = -Infinity;
  for (const a of actions) {
    if (cur && a.at - lastEnd <= gap) {
      cur.push(a);
      lastEnd = Math.max(lastEnd, endOf(a));
    } else {
      cur = [a];
      groups.push(cur);
      lastEnd = endOf(a);
    }
  }
  const lead = (a: EngagedAction) => (params.leadMin[a.kind] ?? 0) * MIN;
  const tail = (a: EngagedAction) => (params.tailMin[a.kind] ?? 0) * MIN;
  const out: EngagedStretch[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    const nextStart = groups[i + 1] ? Math.min(...groups[i + 1]!.map((a) => a.at - lead(a))) : Infinity;
    const prevEnd = out[out.length - 1]?.end ?? -Infinity;
    const start = Math.max(prevEnd, Math.min(...g.map((a) => a.at - lead(a))));
    let end = Math.min(nextStart, Math.max(...g.map((a) => endOf(a) + tail(a))));
    if (end <= start) continue;
    const pieces = cut(g, start, end);
    // Claude's run after the last prompt: a share of it counts, on the prompt's own bucket
    let agentMin = 0;
    const runner = g.filter((a) => a.kind === 'prompt' && a.runEndsAt !== undefined).sort((a, b) => b.runEndsAt! - a.runEndsAt!)[0];
    if (runner && runner.runEndsAt! > end && params.agentShare > 0) {
      const extra = Math.min(params.agentMaxMin * MIN, params.agentShare * (Math.min(runner.runEndsAt!, nextStart) - end));
      if (extra >= MIN) {
        const e2 = Math.min(nextStart, end + Math.round(extra));
        const last = pieces[pieces.length - 1];
        if (last && last.bucket === bucketOf(runner)) last.end = e2;
        else pieces.push({ ...piece([runner], end, e2), counts: {} });
        pieces[pieces.length - 1]!.agentMin += (e2 - end) / MIN;
        agentMin = (e2 - end) / MIN;
        end = e2;
      }
    }
    out.push({ start, end, actions: g.length, agentMin, pieces });
  }
  return out;
}

/** Minutes of engaged time in a set of stretches. */
export const engagedMinutes = (stretches: readonly EngagedStretch[]): number => stretches.reduce((s, x) => s + (x.end - x.start), 0) / MIN;
