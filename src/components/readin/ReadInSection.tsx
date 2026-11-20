'use client';
/**
 * ReadInSection (BE-READIN): the "✦ Read-in" block at the top of the Details panel (the orchestrator mounts it).
 *
 * Shows the TL;DR (18 px), background bullets with neutral source chips, "You said before", open questions, the
 * suggested reply (an Outbox draft: Open draft never sends) with Regenerate, the state (researching with progress,
 * stale with Refresh, failed with Retry) and the cost in faint text. Violet marks it as AI; color is used only for
 * state (amber = stale, red = failed), never for sources. Updates live on the `readin` topic.
 *
 * Keyboard and ⌘K: "Read me in" / "Refresh read-in" / "Open suggested reply" are registered as commands.
 * "Read me in" is optimistic (queued at once) with rollback and an inline error on failure.
 */
import { useCallback, useId, useMemo } from 'react';
import type { ReadIn, ReadInBullet, ReadInEntityType, ReadInHistoryEntry, ReadInPayload, SourceRef } from '@/contract';
import { queryKey, type ApiError } from '@/client/api';
import { useApi } from '@/client/hooks';
import { useCommands } from '@/client/keyboard';
import { useOptimisticMutation } from '@/client/optimistic';
import { Button, cn, fmtClock, fmtUsd, Skeleton, Spinner, useTimeZone } from '@/ui';
import { navigate } from '@/components/shell/router';

export interface ReadInSectionProps {
  entityType?: ReadInEntityType;
  entityId: string;
  /** Default: navigate to the Outbox with the draft selected. Opening never sends. */
  onOpenDraft?: (draftId: string) => void;
  /** Register ⌘K commands (on while the section is the panel's content). */
  commands?: boolean;
  className?: string;
}

const STATE_LABEL: Record<ReadIn['state'], string> = {
  queued: 'Queued',
  researching: 'Researching',
  ready: 'Ready',
  stale: 'New info since',
  failed: "Couldn't finish",
};

function SourceTag({ source, fallback }: { source: SourceRef | null; fallback?: string }) {
  const label = source?.label ?? fallback;
  if (!label) return null;
  const cls = 'inline-flex h-6 max-w-[28ch] shrink-0 items-center rounded-md border border-line bg-surface px-2 text-caption text-muted no-underline';
  if (source?.url) {
    return (
      <a href={source.url} target="_blank" rel="noreferrer" className={cn(cls, 'hover:border-line-strong hover:text-fg focus-visible:outline-none focus-visible:shadow-focus')} title={`Open ${label}`}>
        <span className="truncate">{label}</span>
      </a>
    );
  }
  return (
    <span className={cls}>
      <span className="truncate">{label}</span>
    </span>
  );
}

function refLabel(b: ReadInBullet | ReadInHistoryEntry): { source: SourceRef | null; fallback?: string } {
  if (b.source) return { source: b.source };
  if (b.ref) return { source: { kind: 'manual', label: b.ref.label, ...(b.ref.href ? { url: b.ref.href } : {}) } };
  return { source: null };
}

function Progress({ r }: { r: ReadIn }) {
  const p = r.progress;
  const pct = p ? Math.min(100, Math.round(((p.step === 'queued' ? 0 : p.done + 0.5) / p.total) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5" role="status" aria-live="polite" data-readin-progress>
      <div className="flex items-center gap-2 text-caption text-muted">
        <Spinner size="xs" />
        <span>{p?.step === 'queued' || r.state === 'queued' ? 'Queued for research' : (p?.label ?? 'Researching')}</span>
        {p && p.step !== 'queued' ? <span className="text-faint">· step {Math.min(p.done + 1, p.total)} of {p.total}</span> : null}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
        <i className="block h-full rounded-full bg-ai-500 transition-[width] duration-(--dur-slow)" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ReadInSection({ entityType = 'work_item', entityId, onOpenDraft, commands = true, className }: ReadInSectionProps) {
  const tz = useTimeZone();
  const headingId = useId();
  const input = useMemo(() => ({ params: { type: entityType, id: entityId } }), [entityType, entityId]);
  const q = useApi('getReadIn', input);
  const request = useOptimisticMutation({
    route: 'requestReadIn',
    topics: ['readin'],
    writeBack: false,
    entityId: () => undefined,
    rebase: false,
    optimistic: (_i, cache) =>
      cache.setQuery<ReadInPayload>(queryKey('getReadIn', input), (old) => {
        const at = new Date().toISOString();
        const base: ReadIn = old?.readIn ?? { entity: { type: entityType, id: entityId }, state: 'queued', tldr: '', background: [], history: [], openQuestions: [], suggestedReply: null, confidence: null, generatedAt: null, generation: 0, costUsd: 0, sources: [], trigger: 'on_demand', model: null, skillVersion: null, evidenceHash: null, progress: null, error: null, staleReason: null, updatedAt: at };
        return { entity: { type: entityType, id: entityId }, readIn: { ...base, state: 'queued', error: null, staleReason: null, progress: { step: 'queued', label: 'Queued', done: 0, total: 6 }, updatedAt: at } };
      }),
  });
  const r = q.data?.readIn ?? null;
  const busy = r?.state === 'queued' || r?.state === 'researching' || request.isPending;
  const readMeIn = useCallback((force: boolean) => request.mutate({ ...input, body: { force } }), [request, input]);
  const openDraft = useCallback(
    (draftId: string) => (onOpenDraft ? onOpenDraft(draftId) : navigate(`/outbox?draft=${encodeURIComponent(draftId)}`)),
    [onOpenDraft],
  );

  useCommands(
    [
      { id: `readin.request.${entityId}`, title: r && r.state !== 'failed' ? 'Refresh read-in' : 'Read me in', group: 'Item', keywords: ['read-in', 'research', 'background', 'brief me'], disabled: busy, run: () => readMeIn(!!r && r.state === 'ready') },
      ...(r?.suggestedReply ? [{ id: `readin.draft.${entityId}`, title: 'Open suggested reply (Outbox draft)', group: 'Item', keywords: ['read-in', 'reply', 'draft'], run: () => openDraft(r.suggestedReply!.draftId) }] : []),
    ],
    { enabled: commands },
  );

  const err = request.error as ApiError | null;
  const header = (
    <div className="flex items-center gap-2">
      <h3 id={headingId} className="flex items-center gap-1.5 text-body font-bold text-fg-heading">
        <span aria-hidden className="text-ai-700">✦</span> Read-in
      </h3>
      {r ? (
        <span className={cn('text-caption', r.state === 'stale' ? 'text-warning-700' : r.state === 'failed' ? 'text-danger-700' : 'text-muted')} data-readin-state={r.state}>
          · {r.state === 'stale' ? (r.staleReason ?? 'New info since this read-in') : STATE_LABEL[r.state]}
        </span>
      ) : null}
      <span className="flex-1" />
      {r && r.state !== 'queued' && r.state !== 'researching' ? (
        <Button size="xs" variant={r.state === 'stale' || r.state === 'failed' ? 'secondary' : 'ghost'} disabled={busy} onClick={() => readMeIn(r.state === 'ready')}>
          {r.state === 'failed' ? 'Retry' : 'Refresh'}
        </Button>
      ) : null}
    </div>
  );

  if (q.isLoading) {
    return (
      <section aria-labelledby={headingId} className={cn('flex flex-col gap-3', className)} data-readin>
        {header}
        <Skeleton count={3} />
      </section>
    );
  }
  if (q.error && !q.data) {
    return (
      <section aria-labelledby={headingId} className={cn('flex flex-col gap-2', className)} data-readin>
        {header}
        <p className="text-body text-danger-700">
          Couldn&apos;t load the read-in.{' '}
          <button type="button" className="text-link underline-offset-2 hover:underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId} className={cn('flex flex-col gap-4', className)} data-readin data-readin-state={r?.state ?? 'none'}>
      {header}
      {err ? (
        <p role="alert" className="text-caption text-danger-700">
          {err.message || "Couldn't start the read-in."}{' '}
          <button type="button" className="text-link hover:underline" onClick={request.retry}>
            Retry
          </button>
        </p>
      ) : null}

      {!r ? (
        <div className="flex flex-col items-start gap-2">
          <p className="max-w-[68ch] text-body text-muted">Not researched yet. Claude can read Slack, email, Drive and Org62 (read-only) and draft a reply for the Outbox.</p>
          <Button variant="ai" size="sm" loading={request.isPending} onClick={() => readMeIn(false)}>
            Read me in
          </Button>
        </div>
      ) : null}

      {r && (r.state === 'queued' || r.state === 'researching') ? <Progress r={r} /> : null}
      {r?.error && r.state !== 'failed' ? <p className="text-caption text-muted">{r.error.message}</p> : null}
      {r?.state === 'failed' && !r.tldr ? <p className="max-w-[68ch] text-body text-danger-700">{r.error?.message ?? "The research couldn't finish."}</p> : null}

      {r?.tldr ? (
        <p className={cn('max-w-[68ch] text-[1.125rem] leading-[1.625rem] text-fg', (r.state === 'queued' || r.state === 'researching') && 'opacity-70')} data-readin-tldr>
          {r.tldr}
        </p>
      ) : null}

      {r && r.background.length ? (
        <ul className="flex max-w-[76ch] flex-col gap-2" aria-label="Background">
          {r.background.map((b, i) => (
            <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 text-body text-fg">
              <span aria-hidden className="mt-2 h-1 w-1 rounded-full bg-ink-400" />
              <span>{b.text}</span>
              <SourceTag {...refLabel(b)} />
            </li>
          ))}
        </ul>
      ) : null}

      {r && r.history.length ? (
        <div className="flex flex-col gap-2">
          <h4 className="text-body font-bold text-fg-heading">You said before</h4>
          <ul className="flex max-w-[76ch] flex-col gap-2">
            {r.history.map((h, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 border-l-2 border-line pl-3 text-body text-fg">
                <span>
                  {h.commitment ? <span className="mr-1.5 text-caption font-bold text-muted">Promised</span> : null}
                  {h.text}
                  {h.at ? <span className="ml-1.5 text-caption text-faint">{fmtClock(h.at, tz)} · {new Date(h.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(tz ? { timeZone: tz } : {}) })}</span> : null}
                </span>
                <SourceTag {...refLabel(h)} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {r && r.openQuestions.length ? (
        <div className="flex flex-col gap-2">
          <h4 className="text-body font-bold text-fg-heading">Open questions</h4>
          <ul className="flex max-w-[76ch] flex-col gap-1.5">
            {r.openQuestions.map((oq, i) => (
              <li key={i} className="text-body text-fg">
                {oq.text}
                {oq.to ? <span className="ml-1.5 text-caption text-muted">→ {oq.to}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {r?.suggestedReply ? (
        <div className="flex flex-col gap-2" data-readin-reply>
          <h4 className="flex items-center gap-2 text-body font-bold text-fg-heading">
            Suggested reply <span className="text-caption font-normal text-muted">· {r.suggestedReply.destinationLabel}</span>
          </h4>
          <p className="max-w-[68ch] whitespace-pre-line rounded-sm border-l-[3px] border-ai-200 bg-surface-muted px-3 py-2 text-body text-fg">{r.suggestedReply.preview}</p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => openDraft(r.suggestedReply!.draftId)}>
              Open draft
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => readMeIn(true)}>
              Regenerate
            </Button>
            <span className="text-caption text-muted">In the Outbox; nothing sends until you approve.</span>
          </div>
        </div>
      ) : null}

      {r?.generatedAt ? (
        <p className="text-caption text-faint" data-readin-meta>
          Researched {fmtClock(r.generatedAt, tz)} · {fmtUsd(r.costUsd)}
          {r.sources.length ? ` · ${[...new Set(r.sources.map((s) => s.kind === 'manual' ? 'ledger' : s.kind))].join(', ')}` : ''}
          {r.confidence ? ` · ${r.confidence}` : ''}
        </p>
      ) : null}
    </section>
  );
}
