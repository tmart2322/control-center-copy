/**
 * Run log for the side sheet. The contract has no log lines, so the log is the run's own timeline
 * (started, waiting since, last event, finished, error) plus the transitions this page saw live.
 * TODO(contract): `GET /agents/:id/log` would replace this.
 */
import type { AgentRun, RunState } from '@/contract';

export interface LogLine {
  at: string;
  text: string;
  tone: 'neutral' | 'warn' | 'risk' | 'ok' | 'brand';
}

export const STATE_LABEL: Record<RunState, string> = {
  queued: 'Queued',
  running: 'Running',
  waiting_on_you: 'Waiting on you',
  done_review: 'Done, review',
  done: 'Done',
  failed: 'Failed',
  stale: 'Stale',
};

const STATE_TONE: Record<RunState, LogLine['tone']> = {
  queued: 'neutral',
  running: 'brand',
  waiting_on_you: 'warn',
  done_review: 'brand',
  done: 'ok',
  failed: 'risk',
  stale: 'neutral',
};

/** What the run record alone tells us, oldest first. */
export function baseLog(run: AgentRun): LogLine[] {
  const lines: LogLine[] = [];
  if (run.startedAt) lines.push({ at: run.startedAt, text: run.kind === 'claude_session' ? 'Session started' : run.kind === 'tool_run' ? 'Tool run started' : 'Run started', tone: 'neutral' });
  if (run.waiting) lines.push({ at: run.waiting.since, text: `Waiting on you: ${run.waiting.question ?? run.waiting.reason}`, tone: 'warn' });
  if (run.lastEvent && (!run.waiting || run.updatedAt > run.waiting.since)) lines.push({ at: run.updatedAt, text: run.lastEvent, tone: STATE_TONE[run.state] });
  if (run.finishedAt) lines.push({ at: run.finishedAt, text: run.state === 'failed' ? `Failed${run.error ? `: ${run.error}` : ''}` : run.state === 'done_review' ? 'Finished, ready for review' : 'Finished', tone: STATE_TONE[run.state] });
  else if (run.error) lines.push({ at: run.updatedAt, text: `Error: ${run.error}`, tone: 'risk' });
  return lines.sort((a, b) => a.at.localeCompare(b.at));
}

/** The line to append when `next` differs from `prev` (or null if nothing user-visible changed). */
export function transitionLine(prev: AgentRun, next: AgentRun, at: string): LogLine | null {
  if (prev.state !== next.state) return { at, text: `${STATE_LABEL[prev.state]} → ${STATE_LABEL[next.state]}${next.lastEvent ? `: ${next.lastEvent}` : ''}`, tone: STATE_TONE[next.state] };
  if (prev.lastEvent !== next.lastEvent && next.lastEvent) return { at, text: next.lastEvent, tone: STATE_TONE[next.state] };
  return null;
}

/** Merge the base timeline with live lines, dropping repeats of the same text. */
export function mergeLog(base: LogLine[], live: LogLine[]): LogLine[] {
  const seen = new Set<string>();
  return [...base, ...live]
    .sort((a, b) => a.at.localeCompare(b.at))
    .filter((l) => {
      const k = l.text;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}
