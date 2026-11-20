'use client';
/**
 * AgentRunRow: title (linked task) · state glyph · elapsed · last event · ONE action (UI-SPEC §12,
 * brief 08 §2.6). DESIGN-V2: calm. The glyph carries the state color (violet = the agent is working,
 * amber = waiting on you, accent = review, red = failed); the action stays quiet unless the row is selected. Deep links (claude://code/continue?session=…, claude://code/new?…) come from the
 * contract and are passed to onOpenDeepLink; the row never opens anything itself.
 */
import type { AgentRun, RunState } from '@/contract';
import { useState } from 'react';
import { Button, cn, Icon } from '@/ui';
import { useClock } from './lib';
import { age, dur, minutesBetween } from './lib/time';
import { RunGlyph } from './RunGlyph';
import { RUN_META } from './vocab';

export type AgentRunActionKey = 'cancel' | 'open_log' | 'open_in_claude' | 'answer' | 'review' | 'retry' | 'nudge' | 'stop';

const ACTION: Record<RunState, { key: AgentRunActionKey; label: string } | null> = {
  queued: { key: 'cancel', label: 'Cancel' },
  running: { key: 'open_log', label: 'Open log' },
  waiting_on_you: { key: 'open_in_claude', label: 'Open in Claude' },
  done_review: { key: 'review', label: 'Review' },
  done: null,
  failed: { key: 'retry', label: 'Retry' },
  stale: { key: 'nudge', label: 'Nudge' },
};

export interface AgentRunRowProps {
  run: AgentRun;
  /** Linked task title (shown as a chip). */
  taskTitle?: string | null;
  now?: string;
  className?: string;
  onAction?: (key: AgentRunActionKey, run: AgentRun) => void;
  /** claude:// deep link for Open in Claude (sessions) — the parent opens it. */
  onOpenDeepLink?: (url: string, run: AgentRun) => void;
  onOpenTask?: (workItemId: string, run: AgentRun) => void;
  /** Inline answer for app runs waiting on you. */
  onAnswer?: (run: AgentRun, answer: string) => void;
  /** v2: the selected row: its one action is filled. */
  selected?: boolean;
}

export function AgentRunRow({ run, taskTitle, className, onAction, onOpenDeepLink, onOpenTask, onAnswer, selected, ...rest }: AgentRunRowProps) {
  const { now } = useClock({ now: rest.now });
  const [reply, setReply] = useState('');
  const meta = RUN_META[run.state];
  let action = ACTION[run.state];
  // Claude sessions open in Claude; app/tool runs answer inline or open their log.
  if (run.state === 'running' && run.kind === 'claude_session') action = { key: 'open_in_claude', label: 'Open in Claude' };
  if (run.state === 'waiting_on_you' && run.kind !== 'claude_session') action = run.waiting?.choices.length ? null : { key: 'answer', label: 'Answer' };
  if (run.state === 'failed' && run.kind === 'claude_session') action = { key: 'open_in_claude', label: 'Open in Claude' };
  // Live states show elapsed time; settled ones show how long ago they settled.
  const live = run.state === 'running' || run.state === 'waiting_on_you';
  const from = run.state === 'waiting_on_you' ? run.waiting?.since : run.state === 'running' ? run.startedAt : run.finishedAt ?? run.updatedAt;
  const elapsed = from ? (live ? dur(Math.max(0, minutesBetween(from, now))) : age(from, now)) : null;
  const pct = run.progress ? Math.round((run.progress.done / Math.max(1, run.progress.total)) * 100) : null;
  const choices = run.state === 'waiting_on_you' && run.kind !== 'claude_session' ? run.waiting?.choices ?? [] : [];

  const fire = () => {
    if (!action) return;
    if (action.key === 'open_in_claude' && run.deepLink) onOpenDeepLink?.(run.deepLink, run);
    else onAction?.(action.key, run);
  };

  const needsYou = run.state === 'waiting_on_you' || run.state === 'done_review' || run.state === 'failed';
  return (
    <div
      tabIndex={0}
      data-row
      data-run-id={run.id}
      data-selected={selected || undefined}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) fire();
      }}
      className={cn(
        '@container group/run border-b border-line px-4 py-3 last:border-b-0 focus-visible:shadow-[inset_0_0_0_2px_var(--color-focus)] focus-visible:outline-none',
        selected ? 'bg-selected' : 'hover:bg-surface-muted',
        run.state === 'done' && 'opacity-80',
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <RunGlyph state={run.state} size={16} />
        <span className="min-w-0 flex-1 truncate text-body font-bold text-fg-heading" title={run.title}>
          {run.title}
        </span>
        {run.scheduled ? <span className="hidden shrink-0 text-caption text-muted @md:inline">Scheduled</span> : null}
        <span className={cn('hidden shrink-0 text-caption @md:inline', run.state === 'waiting_on_you' ? 'font-bold text-warning-700' : run.state === 'failed' ? 'font-bold text-danger-700' : run.state === 'running' ? 'text-ai-700' : 'text-muted')}>{meta.label}</span>
        {elapsed ? <span className="w-12 shrink-0 text-right text-caption tabular-nums text-muted">{elapsed}</span> : null}
        <span className="flex min-w-28 shrink-0 justify-end">
          {action ? (
            <Button size="sm" variant={selected ? 'primary' : needsYou ? 'secondary' : 'ghost'} onClick={fire} data-row-verb={selected ? 'filled' : 'quiet'}>
              {action.label}
            </Button>
          ) : null}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-2.5 pl-[1.625rem]">
        <p className={cn('min-w-0 flex-1 truncate text-caption', run.state === 'failed' ? 'text-danger-700' : 'text-muted')} title={run.error ?? run.lastEvent}>
          {run.state === 'waiting_on_you' && run.waiting?.question ? run.waiting.question : run.lastEvent}
        </p>
        {pct !== null ? (
          <span className="h-1.5 w-16 shrink-0 rounded-full bg-surface-sunken" title={`${run.progress!.done}/${run.progress!.total} ${run.progress!.label ?? ''}`}>
            <span className="block h-full rounded-full bg-ai-500" style={{ width: `${pct}%` }} />
          </span>
        ) : null}
        {run.bgAgents ? <span className="shrink-0 text-caption text-muted">+{run.bgAgents} in background</span> : null}
        {taskTitle && run.workItemId ? (
          <button
            type="button"
            onClick={() => onOpenTask?.(run.workItemId!, run)}
            className="hidden h-6 max-w-64 shrink-0 items-center gap-1.5 truncate rounded-sm border border-line-strong bg-surface-sunken px-2 text-caption font-bold text-fg hover:underline @2xl:inline-flex"
          >
            <Icon name="task" size="xs" className="text-muted" />
            <span className="truncate">{taskTitle}</span>
          </button>
        ) : null}
      </div>
      {choices.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[1.625rem]">
          {choices.map((c) => (
            <button key={c} type="button" onClick={() => onAnswer?.(run, c)} className="h-8 rounded-md border border-line-input bg-surface px-3 text-caption text-fg hover:border-accent hover:bg-selected">
              {c}
            </button>
          ))}
          <form
            className="flex min-w-40 max-w-80 flex-1 items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (reply.trim()) onAnswer?.(run, reply.trim());
              setReply('');
            }}
          >
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Or reply in one line…"
              aria-label={`Reply to ${run.title}`}
              className="h-8 min-w-0 flex-1 rounded-md border border-line-input bg-surface-input px-2.5 text-caption placeholder:text-faint focus:border-accent focus:outline-none"
            />
          </form>
        </div>
      ) : null}
    </div>
  );
}
