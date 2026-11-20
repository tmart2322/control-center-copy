'use client';
/**
 * Details renderer for `agent_run` (a Claude Code session, an app run or a tool run), replacing the Agents
 * page's own RunSheet. In order: what it needs from you (hands-on minutes; the run's own time never counts),
 * the question when it waits on you, what it did (latest step, progress, the run log), its output (result,
 * tool inputs and files, folder, cost), and the sticky footer's ONE filled action.
 *
 * Claude sessions are answered in Claude: "Open in Claude" hands off a claude:// deep link ONLY on the click.
 * App runs answer inline (optimistic, Undo). Live: the run repaints from GET /agents (the `agents` topic) and
 * each state change appends a line to the log.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AgentRun, RunState, Tone } from '@/contract';
import { useApi } from '@/client/hooks';
import { needLine, runNeed } from '@/components/agents/needs';
import { useRunActions } from '@/components/agents/actions';
import { openInClaudeUrl, shortPath, startInClaudeUrl } from '@/components/agents/claude';
import { baseLog, mergeLog, transitionLine, type LogLine } from '@/components/agents/log';
import { RunGlyph } from '@/components/domain';
import { clock as hhmm, dayLabel, sameDay } from '@/components/domain/lib/time';
import { Button, cn, Icon, PanelBoundary, serverNow, Skeleton, TONE_BADGE, useNow, useTimeZone } from '@/ui';
import { Facts, openExternal, PanelFrame, PanelLoading, PanelProblem, PanelSection, QuietAction, Tag, type PanelPrimary } from './bits';

const KIND_LABEL: Record<AgentRun['kind'], string> = { claude_session: 'Claude session', app_run: 'App run', tool_run: 'Tool run' };

export const RUN_BADGE: Record<RunState, { tone: Tone; label: string }> = {
  queued: { tone: 'neutral', label: 'Queued' },
  running: { tone: 'ai', label: 'Running' },
  waiting_on_you: { tone: 'warn', label: 'Waiting on you' },
  done_review: { tone: 'brand', label: 'Done, review' },
  done: { tone: 'ok', label: 'Done' },
  failed: { tone: 'risk', label: 'Failed' },
  stale: { tone: 'neutral', label: 'Stale' },
};

/** The run's state as glyph + word on its tint (the glyph is the SVG RunGlyph: Salesforce Sans lacks ◐ ⏸ ☾). */
export function RunBadge({ state }: { state: RunState }) {
  const b = RUN_BADGE[state];
  return (
    <span data-tone={b.tone} className={cn('inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-2 text-caption leading-none font-bold whitespace-nowrap', TONE_BADGE[b.tone])}>
      <RunGlyph state={state} size={12} />
      {b.label}
    </span>
  );
}

const LINE_DOT: Record<LogLine['tone'], string> = { neutral: 'bg-line-strong', warn: 'bg-warning-500', risk: 'bg-danger-500', ok: 'bg-success-500', brand: 'bg-accent' };

export function elapsedLabel(from: string | null, to: Date): string {
  if (!from) return '';
  const s = Math.max(0, Math.round((to.getTime() - new Date(from).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export interface RunPanelProps {
  runId: string;
}

export function RunPanel({ runId }: RunPanelProps) {
  return (
    <PanelBoundary name="agents.run-panel" resetKeys={[runId]}>
      <RunPanelBody runId={runId} />
    </PanelBoundary>
  );
}

function RunPanelBody({ runId }: RunPanelProps) {
  const q = useApi('getAgents');
  const run = q.data?.runs.find((r) => r.id === runId);
  if (q.isLoading) return <PanelLoading label="Loading the run" />;
  if (!run) return <PanelProblem gone={!!q.data} error={q.error} what="run" onRetry={() => void q.refetch()} />;
  return <Loaded run={run} />;
}

/** The run's own timeline plus every transition seen while the panel is open. */
function useRunLog(run: AgentRun): LogLine[] {
  const prev = useRef<AgentRun | null>(null);
  const [live, setLive] = useState<LogLine[]>([]);
  useEffect(() => {
    const p = prev.current;
    prev.current = run;
    if (!p || p.id !== run.id) return;
    const line = transitionLine(p, run, serverNow().toISOString());
    if (line) setLive((l) => [...l, line]);
  }, [run]);
  return mergeLog(baseLog(run), live);
}

function ToolRunFacts({ id }: { id: string }) {
  const q = useApi('getToolRun', { params: { id } });
  if (!q.data) return q.isError ? null : <Skeleton variant="line" count={2} />;
  const inputs = Object.entries(q.data.inputs).filter(([, v]) => v !== '' && v !== undefined && v !== null);
  return (
    <div className="flex flex-col gap-3" data-tool-run-facts>
      {inputs.length ? <Facts rows={inputs.map(([k, v]) => [k, <span key={k} className="break-words">{String(v)}</span>] as [string, ReactNode])} /> : null}
      {q.data.linkUrl ? (
        <Button variant="secondary" size="sm" icon="new_window" className="self-start" onClick={() => openExternal(q.data!.linkUrl!)}>
          {q.data.linkLabel ?? 'Open result'}
        </Button>
      ) : null}
      {q.data.artifacts.length ? (
        <ul className="flex flex-col gap-1">
          {q.data.artifacts.map((a) => (
            <li key={a.path} className="flex min-w-0 items-center gap-2 text-caption text-fg">
              <Icon name="file" size="xs" className="shrink-0 text-muted" />
              <span className="shrink-0 font-bold">{a.label}</span>
              <code className="min-w-0 truncate font-mono text-muted" title={a.path}>
                {shortPath(a.path)}
              </code>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Loaded({ run }: { run: AgentRun }) {
  const now = useNow(1000);
  const tz = useTimeZone();
  const a = useRunActions();
  const log = useRunLog(run);
  const task = useApi('getItem', { params: { id: run.workItemId ?? '' } }, { enabled: !!run.workItemId });
  const taskTitle = task.data?.item.title ?? null;
  const [reply, setReply] = useState('');
  const replyRef = useRef<HTMLInputElement | null>(null);

  const waiting = run.state === 'waiting_on_you';
  const claude = run.kind === 'claude_session';
  const live = run.state === 'running' || waiting;
  const openUrl = openInClaudeUrl(run);
  const startUrl = startInClaudeUrl(run);
  const canCancel = !claude && ['queued', 'running', 'waiting_on_you', 'stale'].includes(run.state);
  const canRetry = run.kind === 'tool_run' && run.state === 'failed' && !!run.toolRunId;
  const pct = run.progress ? Math.round((run.progress.done / Math.max(1, run.progress.total)) * 100) : null;
  const need = runNeed(run);
  const nl = needLine(run);
  const busy = a.answer.isPending || a.cancel.isPending || a.retrying === run.id;
  const nowIso = now.toISOString();
  const clock = (iso: string) => (sameDay(iso, nowIso, tz) ? hhmm(iso, tz) : `${dayLabel(iso, tz)} ${hhmm(iso, tz)}`);
  const since = waiting ? (run.waiting?.since ?? null) : live ? run.startedAt : null;

  // Focus the reply box when the panel opens on a question (Enter on a waiting row lands here).
  useEffect(() => {
    if (waiting && !claude && !run.waiting?.choices.length) replyRef.current?.focus({ preventScroll: true });
  }, [waiting, claude, run.waiting?.choices.length, run.id]);

  const submit = () => {
    const v = reply.trim();
    if (!v) return;
    a.answer.mutate({ params: { id: run.id }, body: { answer: v } });
    setReply('');
  };

  // ── the ONE filled action ──
  let primary: PanelPrimary | null = null;
  if (claude) {
    if (startUrl) primary = { id: 'start_in_claude', label: 'Start in Claude', icon: 'agent_session', run: () => a.requestStart(run) };
    else if (openUrl) primary = { id: 'open_in_claude', label: 'Open in Claude', icon: 'new_window', run: () => a.openInClaude(run) };
  } else if (waiting) {
    primary = { id: 'answer', label: 'Answer', run: submit, disabled: !reply.trim() || busy, hint: 'Type an answer, or pick a choice above' };
  } else if (canRetry) {
    primary = { id: 'retry', label: 'Retry', icon: 'refresh', run: () => void a.retry(run), loading: a.retrying === run.id };
  } else if (run.state === 'done_review' && run.workItemId) {
    primary = { id: 'review', label: 'Review the task', run: () => a.openTask(run.workItemId!, taskTitle ?? undefined) };
  } else if (run.resultUrl && (run.state === 'done_review' || run.state === 'done')) {
    primary = { id: 'open_result', label: 'Open result', icon: 'new_window', run: () => openExternal(run.resultUrl!) };
  }

  const quiet = (
    <>
      {claude && openUrl && primary?.id !== 'open_in_claude' ? (
        <QuietAction icon="new_window" onClick={() => a.openInClaude(run)} data-quiet="open_in_claude">
          Open in Claude
        </QuietAction>
      ) : null}
      {run.workItemId && primary?.id !== 'review' ? (
        <QuietAction onClick={() => a.openTask(run.workItemId!, taskTitle ?? undefined)} data-quiet="open_task">
          Open the task
        </QuietAction>
      ) : null}
      {run.resultUrl && primary?.id !== 'open_result' ? (
        <QuietAction icon="new_window" onClick={() => openExternal(run.resultUrl!)}>
          Open result
        </QuietAction>
      ) : null}
      {canCancel ? (
        <QuietAction onClick={() => a.perform('stop', run)} disabled={busy} data-quiet="cancel">
          {run.state === 'stale' ? 'Stop run' : 'Cancel run'}
        </QuietAction>
      ) : null}
    </>
  );

  return (
    <>
      <PanelFrame
        label={`${KIND_LABEL[run.kind]}: ${run.title}`}
        data-run-panel={run.id}
        data-run-state={run.state}
        context={
          <>
            <span className="shrink-0">Agents</span>
            <Tag>{KIND_LABEL[run.kind]}</Tag>
            <RunBadge state={run.state} />
            {run.scheduled ? <Tag>Scheduled</Tag> : null}
            {since ? (
              <span className="ml-auto shrink-0 tabular-nums" data-testid="run-elapsed">
                {waiting ? 'waiting ' : 'running '}
                {elapsedLabel(since, now)}
              </span>
            ) : null}
          </>
        }
        title={run.title}
        sub={
          <span className="flex flex-col gap-1">
            <span data-run-need={need.youMin}>
              {need.youMin > 0 ? (
                <>
                  Needs <b className="font-bold text-fg">you ~{need.youMin}m</b> {need.purpose}.
                </>
              ) : nl.ai ? (
                <>
                  <span className="font-bold text-ai-700">✦ Runs in the background.</span> It doesn’t count against your day.
                </>
              ) : (
                'Nothing needs you.'
              )}
            </span>
            {run.workItemId ? (
              <span className="line-clamp-2 min-w-0">
                For{' '}
                {/* A real link: it flows with the text, and ⌘-click opens the task's page in a new tab. */}
                <a
                  href={`/work/${run.workItemId}`}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                    e.preventDefault();
                    a.openTask(run.workItemId!, taskTitle ?? undefined);
                  }}
                  className="font-bold text-link hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {taskTitle ?? 'the linked task'}
                </a>
              </span>
            ) : null}
          </span>
        }
        primary={primary}
        quiet={quiet}
      >
        {waiting ? (
          <section className="rounded-lg border border-warning-200 bg-warning-50 p-4" role="group" aria-label="It’s asking you" data-run-question>
            <p className="text-caption font-bold text-warning-700">It’s asking you</p>
            <p className="mt-1 max-w-[68ch] text-body-lg text-fg-heading">{run.waiting?.question ?? run.waiting?.reason ?? 'Waiting on you'}</p>
            {claude ? (
              <p className="mt-2 text-caption text-muted">Claude sessions are answered in Claude.</p>
            ) : (
              <>
                {run.waiting?.choices.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {run.waiting.choices.map((c) => (
                      <Button key={c} variant="secondary" size="sm" disabled={busy} onClick={() => a.answer.mutate({ params: { id: run.id }, body: { answer: c } })}>
                        {c}
                      </Button>
                    ))}
                  </div>
                ) : null}
                <form
                  className="mt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submit();
                  }}
                >
                  <label className="sr-only" htmlFor={`reply-${run.id}`}>
                    Answer {run.title}
                  </label>
                  <input
                    ref={replyRef}
                    id={`reply-${run.id}`}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder={run.waiting?.choices.length ? 'Or answer in one line…' : 'Answer in one line…'}
                    className="h-9 w-full rounded-md border border-line-input bg-surface-input px-3 text-body text-fg placeholder:text-faint focus:border-accent focus:outline-none"
                    data-run-reply
                  />
                </form>
                {a.answer.status === 'error' ? (
                  <p role="alert" className="mt-2 text-caption text-danger-700">
                    Couldn’t send the answer: {a.answer.error?.message}. It’s back to waiting; try again.
                  </p>
                ) : null}
              </>
            )}
          </section>
        ) : null}

        {run.state === 'failed' && run.error ? (
          <p role="alert" className="rounded-md border border-danger-200 bg-danger-50 px-4 py-3 text-body text-danger-700">
            {run.error}
          </p>
        ) : null}

        <PanelSection title="What it did" suffix={run.lastEvent ? undefined : 'nothing recorded yet'}>
          <div className="flex flex-col gap-3">
            {run.lastEvent ? <p className="max-w-[68ch] text-body text-fg">{run.lastEvent}</p> : null}
            {pct !== null ? (
              <div>
                <div className="flex items-center justify-between text-caption text-muted">
                  <span>{run.progress?.label ?? 'Progress'}</span>
                  <span className="tabular-nums">
                    {run.progress!.done}/{run.progress!.total}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-surface-sunken" role="progressbar" aria-label="Run progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-ai-500 transition-[width]" style={{ width: `${pct}%` }} />
                </div>
              </div>
            ) : null}
            {log.length ? (
              <ol className="relative flex flex-col gap-2 border-l border-line pl-4" data-testid="run-log" aria-label="Run log">
                {log.map((l, i) => (
                  <li key={`${l.at}-${i}`} className="relative text-caption">
                    <span aria-hidden className={cn('absolute top-1.5 -left-[20.5px] size-2 rounded-full', LINE_DOT[l.tone])} />
                    <span className="mr-2 text-muted tabular-nums">{clock(l.at)}</span>
                    <span className="text-fg">{l.text}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        </PanelSection>

        <PanelSection title="Output">{run.toolRunId ? <ToolRunFacts id={run.toolRunId} /> : run.resultUrl ? <p className="text-body text-fg">A result is ready to open.</p> : null}</PanelSection>

        <Facts
          rows={[
            run.cwd ? ['Folder', <code key="cwd" className="font-mono text-caption break-all" title={run.cwd}>{shortPath(run.cwd)}</code>] : null,
            run.bgAgents ? ['Sub-agents', `${run.bgAgents} still writing in the background`] : null,
            run.startedAt ? ['Started', clock(run.startedAt)] : null,
            run.finishedAt ? ['Finished', clock(run.finishedAt)] : null,
            run.costUsd !== null ? ['Cost', `$${run.costUsd.toFixed(2)}`] : null,
          ]}
        />
      </PanelFrame>
      {a.dialog}
    </>
  );
}
