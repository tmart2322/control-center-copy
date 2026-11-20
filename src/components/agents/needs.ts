/**
 * What a run needs from you, and its one verb (pure). DESIGN-V2 "Capacity and estimates": only hands-on
 * minutes count, estimated low; the run's own time is a background lane and never counts against the day.
 * The minutes come from the priority engine's defaults (CAPACITY owns them), so Agents, Home and Today agree:
 *   answer a question      → approve (3)        "you ~3m to answer"
 *   review finished work   → review (15)        "you ~15m to review"
 *   retry · nudge · start  → reauth (2)         a click and a glance
 *   running · queued · done → 0                 "✦ in the background"
 */
import type { AgentRun, RunState } from '@/contract';
import { DEFAULT_HANDS_ON } from '@/engines/priority/estimate';
import { openInClaudeUrl, startInClaudeUrl } from './claude';
import { groupRuns, type GroupKey } from './groups';

export const ANSWER_MIN = DEFAULT_HANDS_ON.approve;
export const REVIEW_MIN = DEFAULT_HANDS_ON.review;
export const CLICK_MIN = DEFAULT_HANDS_ON.reauth;

export interface RunNeed {
  /** Your hands-on minutes (0 = nothing needs you). */
  youMin: number;
  /** "to answer", "to review" … (after "you ~3m"). */
  purpose: string | null;
}

export function runNeed(run: Pick<AgentRun, 'state' | 'kind' | 'deepLink'>): RunNeed {
  switch (run.state) {
    case 'waiting_on_you':
      return { youMin: ANSWER_MIN, purpose: 'to answer' };
    case 'done_review':
      return { youMin: REVIEW_MIN, purpose: 'to review' };
    case 'failed':
      return { youMin: CLICK_MIN, purpose: run.kind === 'tool_run' ? 'to retry' : 'to check' };
    case 'stale':
      return { youMin: CLICK_MIN, purpose: 'to nudge' };
    case 'queued':
      return startInClaudeUrl(run as AgentRun) ? { youMin: CLICK_MIN, purpose: 'to start' } : { youMin: 0, purpose: null };
    default:
      return { youMin: 0, purpose: null };
  }
}

/** "you ~3m to answer" · "✦ in the background" · "" (done). */
export function needLine(run: AgentRun): { text: string; ai: boolean } {
  const n = runNeed(run);
  if (n.youMin > 0) return { text: `you ~${n.youMin}m ${n.purpose}`, ai: false };
  if (run.state === 'running' || run.state === 'queued') return { text: run.bgAgents ? `✦ in the background · ${run.bgAgents} sub-agents` : '✦ in the background', ai: true };
  return { text: '', ai: false };
}

export type RunVerbKey = 'open_in_claude' | 'start_in_claude' | 'review' | 'answer' | 'open_log' | 'retry' | 'nudge' | 'cancel';

export interface RunVerb {
  key: RunVerbKey;
  label: string;
}

/**
 * The row's ONE verb (UI-SPEC §12 state table, design v2 wording). Cancel stays quiet and is never the ⌘↵ default;
 * Claude sessions open in Claude (click only), app and tool runs answer and show their log in the panel.
 */
export function runVerb(run: AgentRun): RunVerb | null {
  if (run.kind === 'claude_session') {
    if (run.state === 'queued') return startInClaudeUrl(run) ? { key: 'start_in_claude', label: 'Start in Claude' } : null;
    if (run.state === 'done_review') return { key: 'review', label: 'Review' };
    if (run.state === 'done') return openInClaudeUrl(run) ? { key: 'open_in_claude', label: 'Open in Claude' } : null;
    return openInClaudeUrl(run) ? { key: 'open_in_claude', label: 'Open in Claude' } : { key: 'open_log', label: 'Open log' };
  }
  switch (run.state) {
    case 'waiting_on_you':
      return { key: 'answer', label: 'Answer' };
    case 'done_review':
      return { key: 'review', label: 'Review' };
    case 'failed':
      return run.kind === 'tool_run' && run.toolRunId ? { key: 'retry', label: 'Retry' } : { key: 'open_log', label: 'Open log' };
    case 'stale':
      return { key: 'nudge', label: 'Nudge' };
    case 'queued':
      return { key: 'cancel', label: 'Cancel' };
    case 'running':
      return { key: 'open_log', label: 'Open log' };
    default:
      return null;
  }
}

// ── sections ───────────────────────────────────────────────────────────────────────────────

export type SectionKey = 'running' | 'review' | 'stale';

export const SECTIONS: Array<{ key: SectionKey; title: string; sub: string; groups: GroupKey[] }> = [
  { key: 'running', title: 'Running now', sub: 'waiting on you first', groups: ['waiting_on_you', 'running'] },
  { key: 'review', title: 'Review what’s done', sub: 'finished or failed', groups: ['failed', 'done_review'] },
  { key: 'stale', title: 'Nudge or stop', sub: 'no activity for a while', groups: ['stale'] },
];

export interface RunSection {
  key: SectionKey;
  title: string;
  sub: string;
  runs: AgentRun[];
  /** Hands-on minutes across the section. */
  youMin: number;
}

export interface AgentsLayout {
  sections: RunSection[];
  done: AgentRun[];
  scheduled: AgentRun[];
  youMin: number;
  background: number;
}

/**
 * Sections in focus order (each disappears when empty). Held layouts (the user is working in the list) keep a
 * row in its old group, so nothing moves under the cursor; "n changed · Re-group" releases it.
 */
export function agentsLayout(runs: AgentRun[], held?: Readonly<Record<string, GroupKey>>): AgentsLayout {
  const groups = new Map(groupRuns(runs, held).map((g) => [g.key, g.runs] as const));
  const sections = SECTIONS.map((s) => {
    const list = s.groups.flatMap((g) => groups.get(g) ?? []);
    return { key: s.key, title: s.title, sub: s.sub, runs: list, youMin: list.reduce((n, r) => n + runNeed(r).youMin, 0) };
  }).filter((s) => s.runs.length > 0);
  const scheduled = groups.get('scheduled') ?? [];
  return {
    sections,
    done: groups.get('done') ?? [],
    scheduled,
    youMin: sections.reduce((n, s) => n + s.youMin, 0),
    background: runs.filter((r) => (r.state === 'running' || r.state === 'queued') && !r.scheduled).length,
  };
}

/** The focal row: the longest-waiting question, else the first failure, else the first finished run to review. */
export function focalRunId(layout: AgentsLayout): string | null {
  const all = layout.sections.flatMap((s) => s.runs);
  const pick = (st: RunState) => all.find((r) => r.state === st)?.id;
  return pick('waiting_on_you') ?? pick('failed') ?? pick('done_review') ?? null;
}

/** The masthead sentence parts: "About 32m of your time: answer 1, review 3, nudge 2". */
export function summaryParts(layout: AgentsLayout): { you: string | null; parts: string[]; background: string | null } {
  const all = layout.sections.flatMap((s) => s.runs);
  const count = (st: RunState) => all.filter((r) => r.state === st).length;
  const parts = [
    count('waiting_on_you') ? `answer ${count('waiting_on_you')}` : null,
    count('failed') ? `retry ${count('failed')}` : null,
    count('done_review') ? `review ${count('done_review')}` : null,
    count('stale') ? `nudge ${count('stale')}` : null,
  ].filter((p): p is string => !!p);
  return {
    you: layout.youMin > 0 ? fmtYou(layout.youMin) : null,
    parts,
    background: layout.background ? `${layout.background} run${layout.background === 1 ? '' : 's'} in the background` : null,
  };
}

function fmtYou(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
