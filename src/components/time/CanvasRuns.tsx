'use client';
/**
 * Time ▸ Log it ▸ Logging runs: each logging canvas (an Outbox `slack_canvas.create` item, D-47 / D-52) is its own item
 * with its own status, read from GET /time's `logCanvases` (./rows-derive.ts canvasRun): Staged → Applied → Slackbot
 * told → In Org62, its counts, its Org62 progress ("4 of 4 Events · 55 of 55 DCs in Org62 · checked …", 2026-11-13
 * audit C4), why its rows are read only, and the one thing it waits on (Review & apply, Copy Slackbot prompt, Check
 * now). A click on the item opens it in the docked panel (the canvas review: its rows, Remove and Edit while it waits
 * for Apply, and this same status). Runs everything of which is in Org62 go under "Show N finished", still clickable.
 *
 * D-70: each run's writes open under it ("Its writes"): every create, update and delete it carries exactly as sent
 * ("update · Duration 2 h → 3 h"), with the rows taken off before Apply kept as removed (GET /time/canvases/:id/writes).
 *
 * `CanvasRunStatus` is the same status for the draft panel (src/components/detail/DraftPanel.tsx), for the canvas it
 * shows, with the same writes.
 */
import { useState, type ReactNode } from 'react';
import type { LogCanvas } from '@/contract';
import { useApi } from '@/client/hooks';
import { StatusBadge } from '@/components/domain';
import { copySlackbotPrompt, CopyPromptButton, OpenResult, usePromptWording } from '@/components/domain/ResultLinks';
import { clock, dayLabel } from '@/components/domain/lib/time';
import { progressLine } from '@/lib/canvas/checks';
import { Button, cn, Icon } from '@/ui';
import { canvasPrompt } from './derive';
import { WriteList } from './LandingParts';
import { runWritesLine } from './landing-derive';
import { canvasRun, type CanvasRun, type RunStep } from './rows-derive';
import { quarterSplitLine } from './path-derive';

const TONE: Record<CanvasRun['tone'], 'now' | 'neutral' | 'danger' | 'warning' | 'success'> = { act: 'now', waiting: 'neutral', danger: 'danger', warning: 'warning', done: 'success' };

/** Staged ✓ — Applied ✓ — Slackbot told ● — In Org62 ○ */
export function RunTrack({ steps }: { steps: RunStep[] }) {
  return (
    <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-caption" aria-label="Where it is">
      {steps.map((s, i) => (
        <li key={s.id} className="inline-flex items-center gap-1.5" data-run-step={s.id} data-state={s.state}>
          {i > 0 ? <span aria-hidden className={cn('h-px w-4', s.state === 'todo' ? 'bg-line' : 'bg-line-strong')} /> : null}
          <span
            aria-hidden
            className={cn(
              'grid size-4 shrink-0 place-items-center rounded-full',
              s.state === 'done' ? 'bg-surface-sunken text-success-700' : s.state === 'current' ? 'bg-accent text-on-accent' : s.state === 'problem' ? 'bg-surface-sunken text-danger-700' : 'border border-line-strong',
            )}
          >
            {s.state === 'done' ? <Icon name="check" size="xs" /> : s.state === 'problem' ? <Icon name="warning" size="xs" /> : null}
          </span>
          <span className={cn(s.state === 'todo' ? 'text-muted' : s.state === 'problem' ? 'font-bold text-danger-700' : s.state === 'current' ? 'font-bold text-fg-heading' : 'text-fg')}>{s.label}</span>
          <span className="sr-only">{s.state === 'done' ? ': done' : s.state === 'current' ? ': now' : s.state === 'problem' ? ': needs you' : ': not yet'}</span>
        </li>
      ))}
    </ol>
  );
}

/** "4 of 4 Events · 55 of 55 DCs in Org62 · checked Wed 17:49 · next check 18:20" */
export function RunProgress({ c, tz }: { c: LogCanvas; tz?: string }) {
  const p = c.progress;
  const at = (iso: string) => `${dayLabel(iso, tz)} ${clock(iso, tz)}`;
  if (!p) {
    if (!c.org62 || !c.rows) return null;
    return <span className={cn('tabular-nums', c.org62.missing ? 'font-bold text-danger-700' : 'text-fg')}>{c.org62.logged === c.rows ? 'All rows in Org62' : `${c.org62.logged} of ${c.rows} rows in Org62${c.org62.missing ? ` · ${c.org62.missing} missing` : ''}`}</span>;
  }
  const line = progressLine(p);
  const checked = p.checkedAt ? `checked ${at(p.checkedAt)}` : 'not checked since it was applied';
  const next = p.nextCheckAt && p.state !== 'in_org62' ? `next check ${at(p.nextCheckAt)}` : null;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 tabular-nums" data-testid="canvas-progress" data-progress-state={p.state}>
      {line ? <span className={p.state === 'missing' ? 'font-bold text-danger-700' : 'text-fg'}>{line}</span> : null}
      <span className="text-muted">{[p.toldAt ? `Slackbot told ${at(p.toldAt)}` : null, checked, next].filter(Boolean).join(' · ')}</span>
    </span>
  );
}

export interface RunActions {
  /** Open the canvas item in the docked panel (its review, Apply). */
  onOpen: (draftId: string) => void;
  /** Its Slackbot prompt was copied (queue the Org62 re-checks), or "Slackbot's done: check now". */
  onCheck: (c: LogCanvas, reason: 'copied' | 'now') => void;
  checkingId?: string | null;
  /** A run with rows missing in Org62: show them (Needs you ▸ Not in Org62). */
  onMissing?: () => void;
  /** The run that has the page's one filled button. */
  primaryId?: string | null;
}

/** The one thing a run waits on, as its button. */
function RunNextAction({ run, a, prompt }: { run: CanvasRun; a: RunActions; prompt: string }) {
  const c = run.canvas;
  const primary = a.primaryId === c.draftId;
  switch (run.next) {
    case 'apply':
    case 'check_slack':
      return (
        <Button size="sm" variant={primary ? 'primary' : 'secondary'} onClick={() => a.onOpen(c.draftId)} data-testid="run-apply" kbd={primary ? 'mod+enter' : undefined}>
          {run.next === 'check_slack' ? 'Check Slack, then review' : c.state === 'retry' ? 'Review & apply again' : 'Review & apply'}
        </Button>
      );
    case 'tell':
      return (
        <Button size="sm" variant={primary ? 'primary' : 'secondary'} kbd={primary ? 'mod+enter' : undefined} data-testid="run-copy-prompt" title="Copies this canvas’s Slackbot prompt; paste it to Slackbot yourself (nothing is sent from here)" onClick={() => void copySlackbotPrompt(prompt, c.title).then((ok) => ok && a.onCheck(c, 'copied'))}>
          Copy Slackbot prompt
        </Button>
      );
    case 'check':
      return (
        <Button size="sm" variant="secondary" loading={a.checkingId === c.draftId} onClick={() => a.onCheck(c, 'now')} title="Read Org62 for this canvas now (read only)" data-testid="run-check-now">
          Slackbot’s done: check now
        </Button>
      );
    case 'relog':
      return a.onMissing ? (
        <Button size="sm" variant="secondary" onClick={a.onMissing} data-testid="run-missing">
          See what is missing
        </Button>
      ) : null;
    default:
      return null;
  }
}

/** D-70: a run's writes exactly as sent, loaded when opened. */
export function RunWrites({ draftId, tz, defaultOpen = false }: { draftId: string; tz?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const q = useApi('getCanvasWrites', { params: { id: draftId } }, { enabled: open });
  return (
    <div className="min-w-0" data-testid="run-writes">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-caption font-bold text-link hover:underline focus-visible:outline-none focus-visible:shadow-focus" data-testid="run-writes-toggle">
        <Icon name={open ? 'chevrondown' : 'chevronright'} size="xs" />
        {open && q.data ? `Its writes: ${runWritesLine(q.data.counts)}` : 'Its writes'}
      </button>
      {open ? <div className="mt-1 rounded-md bg-surface-muted px-3 py-1">{q.isLoading ? <p className="py-2 text-caption text-muted">Loading…</p> : q.data ? <WriteList writes={q.data.writes} tz={tz} empty="No writes recorded for this canvas." /> : <p className="py-2 text-caption text-muted">Couldn’t read its writes.</p>}</div> : null}
    </div>
  );
}

/** One logging run, as a list item: status, track, counts and progress, read-only note, its next action. */
export function RunItem({ run, tz, a }: { run: CanvasRun; tz?: string; a: RunActions }) {
  const wording = usePromptWording();
  const c = run.canvas;
  const prompt = canvasPrompt(c, wording);
  const split = quarterSplitLine(c);
  const created = c.state === 'applied' || c.state === 'verified' || c.state === 'unverified';
  return (
    <li
      className="group min-w-0 cursor-pointer px-4 py-3 hover:bg-surface-muted"
      data-canvas-id={c.draftId}
      data-canvas-state={c.state}
      data-run-tone={run.tone}
      onClick={(ev) => {
        if ((ev.target as HTMLElement).closest('a,button,input,select,textarea')) return;
        a.onOpen(c.draftId);
      }}
    >
      <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-80 space-y-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <StatusBadge tone={TONE[run.tone]} icon={run.tone === 'danger' || run.tone === 'warning' ? 'warning' : run.tone === 'done' ? 'check' : undefined}>
              {run.status}
            </StatusBadge>
            <button type="button" className="min-w-0 text-left text-body font-bold break-words text-fg-heading hover:underline" onClick={() => a.onOpen(c.draftId)} title="Open it: its rows, and where it is">
              {c.title}
            </button>
          </div>
          <RunTrack steps={run.steps} />
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-muted tabular-nums">
            <span className="text-fg">{run.counts}</span>
            {c.appliedAt ? <span>{`applied ${dayLabel(c.appliedAt, tz)} ${clock(c.appliedAt, tz)}`}</span> : <span>{`staged ${dayLabel(c.createdAt, tz)} ${clock(c.createdAt, tz)}`}</span>}
            <RunProgress c={c} tz={tz} />
            {split ? <span data-testid="canvas-quarters">{split}</span> : null}
          </div>
          <p className="flex min-w-0 items-start gap-1.5 text-caption text-muted" data-testid="run-rows-note">
            <Icon name={c.state === 'pending' ? 'edit' : 'lock'} size="xs" className="mt-0.5 shrink-0" />
            <span className="min-w-0">{run.rowsNote}</span>
          </p>
          <RunWrites draftId={c.draftId} tz={tz} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-caption">
          <RunNextAction run={run} a={a} prompt={prompt} />
          {created && run.next !== 'tell' ? <CopyPromptButton prompt={prompt} title={c.title} testId="canvas-prompt" onCopied={() => a.onCheck(c, 'copied')} /> : null}
          {c.url ? <OpenResult href={c.url} title="Open the canvas in Slack" testId="canvas-open" /> : null}
        </div>
      </div>
    </li>
  );
}

/** The runs still going, then "Show N finished" (each still clickable). */
export function CanvasRuns({ active, finished, tz, a, empty }: { active: CanvasRun[]; finished: CanvasRun[]; tz?: string; a: RunActions; empty?: ReactNode }) {
  const [more, setMore] = useState(false);
  return (
    <div className="flex min-w-0 flex-col" data-testid="log-runs">
      {active.length ? (
        <ul className="min-w-0 divide-y divide-line" aria-label="Logging runs in progress">
          {active.map((r) => (
            <RunItem key={r.canvas.draftId} run={r} tz={tz} a={a} />
          ))}
        </ul>
      ) : (
        (empty ?? null)
      )}
      {finished.length ? (
        <div className="min-w-0 border-t border-line">
          <button type="button" aria-expanded={more} onClick={() => setMore((v) => !v)} className="inline-flex items-center gap-1.5 px-4 py-2.5 text-caption font-bold text-link hover:underline focus-visible:outline-none focus-visible:shadow-focus" data-testid="runs-finished-toggle">
            <Icon name={more ? 'chevrondown' : 'chevronright'} size="xs" />
            {more ? 'Hide the finished runs' : `Show ${finished.length} finished ${finished.length === 1 ? 'run' : 'runs'} (everything in Org62)`}
          </button>
          {more ? (
            <ul className="min-w-0 divide-y divide-line" aria-label="Finished logging runs" data-testid="runs-finished">
              {finished.map((r) => (
                <RunItem key={r.canvas.draftId} run={r} tz={tz} a={a} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The status of the logging canvas a draft panel shows: the same run as Log it lists (its track, status, progress, why
 * its rows are read only). Null when it is not a logging canvas Time knows (a forecast canvas, an old one).
 */
export function CanvasRunStatus({ draftId, tz }: { draftId: string; tz?: string }) {
  const week = useApi('getTime', { query: { week: undefined } }, { staleTime: 30_000 });
  const c = week.data?.logCanvases.find((x) => x.draftId === draftId);
  if (!c) return null;
  const run = canvasRun(c, tz);
  return (
    <section className="mb-4 space-y-1.5 rounded-md border border-line px-3 py-2.5" data-testid="canvas-run-status" aria-label="Where this logging canvas is">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <StatusBadge tone={TONE[run.tone]} icon={run.tone === 'danger' || run.tone === 'warning' ? 'warning' : run.tone === 'done' ? 'check' : undefined}>
          {run.status}
        </StatusBadge>
        <span className="text-caption text-fg tabular-nums">{run.counts}</span>
      </div>
      <RunTrack steps={run.steps} />
      <div className="text-caption">
        <RunProgress c={c} tz={tz} />
      </div>
      <p className="flex min-w-0 items-start gap-1.5 text-caption text-muted">
        <Icon name={c.state === 'pending' ? 'edit' : 'lock'} size="xs" className="mt-0.5 shrink-0" />
        <span className="min-w-0">{run.rowsNote}</span>
      </p>
      <RunWrites draftId={draftId} tz={tz} defaultOpen={c.state !== 'pending' && c.state !== 'retry'} />
    </section>
  );
}
