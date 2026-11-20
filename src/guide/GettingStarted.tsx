'use client';
/**
 * Getting started: a small card at the bottom of the sidebar nav with "N of M", and the whole guided path in a
 * popover (GET /guide, src/guide/checklist.ts): the setup steps, each page's tour, the first draft, batch, Assistant
 * and feedback, in one order. What is left comes first; done items fold into "Done · N" at the bottom.
 *
 * Every item's button starts guidance on its page, visited before or not: "Take the tour" plays that page's tour from
 * step 1, "Show me" (and "Open Connectors", "Open Role & rules"…) goes there and spotlights the element to use
 * (request.ts → CoachMarks). Items tick from real state; a tour ticks once it is done. The list refetches when a tour
 * records what you saw, when the popover opens and when the window regains focus.
 *
 * Dismissible (settings.guide.checklistDismissed); Settings ▸ About and ⌘K bring it back. Collapsed sidebar: an icon
 * with the steps left.
 */
import { useQueryClient } from '@tanstack/react-query';
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type MouseEvent } from 'react';
import type { ChecklistItem, ChecklistItemId, GuidePayload } from '@/contract';
import { queryKey } from '@/client/api';
import { useApi } from '@/client/hooks';
import { useLiveFollow } from '@/client/live';
import { AppLink } from '@/components/shell/AppLink';
import { useOpenFeedback } from '@/components/shell/FeedbackButton';
import { isPlainLinkClick } from '@/components/shell/router';
import type { RouteKey } from '@/components/shell/routes';
import { useShellOptional } from '@/components/shell/ShellContext';
import { IconButton } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { Icon } from '@/ui/Icon';
import { Popover } from '@/ui/Popover';
import { Tooltip } from '@/ui/Tooltip';
import { foldChecklist, nextStep, PERSONA_REVIEWED_KEY } from './checklist';
import { requestGuide, type GuideRequest } from './request';
import { useGuideSettings } from './useGuide';

export { nextStep };

/** What an item's button asks CoachMarks for: the page's whole tour, or the item's tip. */
export function guideRequestFor(it: Pick<ChecklistItem, 'id' | 'kind' | 'page'>): GuideRequest {
  return { page: (it.page as RouteKey | null) ?? null, item: it.kind === 'explore' ? null : (it.id as ChecklistItemId) };
}

function StateMark({ state }: { state: ChecklistItem['state'] }) {
  if (state === 'done') return <Icon name="success" size="sm" className="mt-0.5 shrink-0 text-success-700" />;
  if (state === 'waiting') return <span aria-hidden className="mt-1 size-3.5 shrink-0 rounded-full border-2 border-accent border-t-transparent motion-safe:animate-spin" />;
  return <span aria-hidden className="mt-1 size-3.5 shrink-0 rounded-full border-2 border-line-strong" />;
}

function Bar({ done, total }: { done: number; total: number }) {
  const all = total > 0 && done >= total;
  return (
    <span className="block h-1 w-full overflow-hidden rounded-full bg-surface-muted" aria-hidden>
      <span className={cn('block h-full rounded-full transition-[width] duration-(--dur-prompt)', all ? 'bg-success-700' : 'bg-accent')} style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
    </span>
  );
}

const LINK = 'text-link hover:underline focus-visible:outline-none focus-visible:shadow-focus';

/** The item's button: it goes to the item's place (when it has one) and plays its guidance there. */
function GuideButton({ it, close, label }: { it: ChecklistItem; close: () => void; label: string }) {
  const shell = useShellOptional();
  const start = () => requestGuide(guideRequestFor(it));
  if (it.href) {
    return (
      <AppLink
        href={it.href}
        className={cn(LINK, 'font-bold')}
        data-testid={`gs-go-${it.id}`}
        onClick={(e: MouseEvent<HTMLAnchorElement>) => {
          // ⌘-click opens the place in a new tab, without a tip here
          if (!isPlainLinkClick(e, e.currentTarget)) return;
          close();
          start();
        }}
      >
        {label}
      </AppLink>
    );
  }
  return (
    <button
      type="button"
      className={cn(LINK, 'font-bold')}
      data-testid={`gs-go-${it.id}`}
      onClick={() => {
        close();
        if (it.action === 'assistant') shell?.focusChat();
        start();
      }}
    >
      {label}
    </button>
  );
}

function ItemRow({ it, close, confirmRole, report }: { it: ChecklistItem; close: () => void; confirmRole: () => void; report: () => void }) {
  const done = it.state === 'done';
  return (
    <li className="flex gap-2.5" data-testid={`gs-item-${it.id}`} data-state={it.state} data-kind={it.kind}>
      <StateMark state={it.state} />
      <div className="min-w-0 flex-1">
        <div className={cn('font-bold', done ? 'text-muted' : 'text-fg')}>{it.title}</div>
        <p className="text-caption text-muted">{it.detail}</p>
        {!done || it.kind === 'explore' ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption">
            <GuideButton it={it} close={close} label={it.cta} />
            {!done && it.action === 'confirm' ? (
              <button type="button" className={LINK} onClick={confirmRole} data-testid="gs-confirm-persona">
                Looks right
              </button>
            ) : null}
            {!done && it.action === 'feedback' ? (
              <button
                type="button"
                className={LINK}
                data-testid="gs-feedback"
                onClick={() => {
                  close();
                  report();
                }}
              >
                Report one
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function ChecklistList({ g, close }: { g: GuidePayload; close: () => void }) {
  const { markSeen, dismissChecklist } = useGuideSettings();
  const openFeedback = useOpenFeedback();
  const [showDone, setShowDone] = useState(false);
  const { open, done } = foldChecklist(g.items);
  const all = g.total > 0 && g.done >= g.total;
  const row = (it: ChecklistItem) => <ItemRow key={it.id} it={it} close={close} confirmRole={() => markSeen([PERSONA_REVIEWED_KEY])} report={openFeedback} />;
  return (
    <div className="flex max-h-[min(78vh,40rem)] flex-col text-body" data-testid="getting-started-list">
      <div className="shrink-0 px-4 pt-4">
        <div className="flex items-baseline gap-2">
          <h2 className="min-w-0 flex-1 text-body font-bold text-fg-heading">{all ? 'You’re set up' : 'Getting started'}</h2>
          <span className="text-caption text-muted tabular-nums">
            {g.done} of {g.total} done
          </span>
        </div>
        <div className="mt-2">
          <Bar done={g.done} total={g.total} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-1">
        {open.length ? (
          <ol className="mt-3 flex flex-col gap-3" data-testid="gs-open">
            {open.map(row)}
          </ol>
        ) : (
          <p className="mt-3 text-fg">Every step is done. Each page’s ? still explains it and replays its tour.</p>
        )}
        {done.length ? (
          <div className="mt-3 border-t border-line pt-2">
            <button type="button" className="inline-flex items-center gap-1 rounded-sm text-caption font-bold text-muted hover:text-fg focus-visible:outline-none focus-visible:shadow-focus" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)} data-testid="gs-done-toggle">
              <Icon name={showDone ? 'chevrondown' : 'chevronright'} size="xs" />
              Done · {done.length}
            </button>
            {showDone ? (
              <ol className="mt-2 flex flex-col gap-3" data-testid="gs-done">
                {done.map(row)}
              </ol>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-3 text-caption">
        <span className="min-w-0 flex-1 text-muted">{all ? 'You can bring it back from ⌘K or Settings ▸ About.' : 'Steps tick themselves as you use the app.'}</span>
        <button
          type="button"
          className={cn(LINK, all && 'font-bold')}
          data-testid="gs-dismiss"
          onClick={() => {
            close();
            dismissChecklist(true);
          }}
        >
          Hide the checklist
        </button>
      </div>
    </div>
  );
}

/** Two compact rows (it shares the sidebar with the nav); the next step is in its tooltip and the popover. */
const CardTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { g: GuidePayload }>(function CardTrigger({ g, className, ...rest }, ref) {
  const next = nextStep(g);
  const all = g.total > 0 && g.done >= g.total;
  return (
    <Tooltip side="right" content={next ? `Next: ${next.title}` : 'All done: open it to hide the checklist'}>
      <button
        ref={ref}
        type="button"
        data-testid="getting-started"
        data-done={all ? 'true' : undefined}
        aria-label={all ? `You're set up: all ${g.total} done` : `Getting started: ${g.done} of ${g.total} done${next ? `. Next: ${next.title}` : ''}`}
        className={cn('flex w-full flex-col gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-left text-caption transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:shadow-focus aria-expanded:border-line-strong', className)}
        {...rest}
      >
        <span className="flex w-full items-baseline gap-2">
          {all ? <Icon name="success" size="xs" className="shrink-0 self-center text-success-700" /> : null}
          <span className="min-w-0 flex-1 truncate font-bold text-fg">{all ? 'You’re set up' : 'Getting started'}</span>
          <span className={cn('shrink-0 tabular-nums', all ? 'font-bold text-success-700' : 'text-muted')}>{all ? 'Done' : `${g.done}/${g.total}`}</span>
        </span>
        <Bar done={g.done} total={g.total} />
      </button>
    </Tooltip>
  );
});

const RailTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { g: GuidePayload }>(function RailTrigger({ g, ...rest }, ref) {
  const left = g.total - g.done;
  return (
    <Tooltip side="right" content={`Getting started · ${g.done} of ${g.total} done`}>
      <IconButton ref={ref} icon={left > 0 ? 'task' : 'success'} label={left > 0 ? `Getting started: ${left} step${left === 1 ? '' : 's'} left` : 'Getting started: all done'} badge={left > 0 ? left : undefined} data-testid="getting-started" {...rest} />
    </Tooltip>
  );
});

/** A short fingerprint of what was seen: it changes whenever a tour records a step. */
const seenPrint = (seen: Readonly<Record<string, string>> | undefined) => (seen ? Object.keys(seen).sort().join('|') : '');

export function GettingStarted({ collapsed }: { collapsed?: boolean }) {
  // Push, not a poll: the guide's steps tick from connectors (health), drafts, the Assistant (chat) and the first scan.
  const q = useApi('getGuide', undefined, { staleTime: 30_000, refetchOnWindowFocus: true });
  useLiveFollow(queryKey('getGuide'), ['health', 'draft', 'chat', 'scans', 'jobs']);
  const qc = useQueryClient();
  const { guide } = useGuideSettings();
  const [open, setOpen] = useState(false);
  // a tour (or "Looks right") recorded something: the explore items tick without a reload
  const print = seenPrint(guide?.seen);
  const lastPrint = useRef(print);
  useEffect(() => {
    if (lastPrint.current === print) return;
    lastPrint.current = print;
    void qc.invalidateQueries({ queryKey: queryKey('getGuide') });
  }, [print, qc]);
  const refetch = q.refetch;
  useEffect(() => {
    if (open) void refetch();
  }, [open, refetch]);
  const g = q.data;
  if (!g || g.dismissed) return null;
  return (
    <div className={cn('shrink-0', collapsed ? 'flex justify-center pb-2' : 'pt-1 pb-2')}>
      <Popover open={open} onOpenChange={setOpen} placement="right-end" width={380} label="Getting started" trigger={collapsed ? <RailTrigger g={g} /> : <CardTrigger g={g} />}>
        {({ close }) => <ChecklistList g={g} close={close} />}
      </Popover>
    </div>
  );
}
