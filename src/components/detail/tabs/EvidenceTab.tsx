'use client';
/**
 * Evidence (UI-SPEC §12): a timeline of sources grouped by role — origin · progress · completion ·
 * context · contradiction — each with its source chip, time, excerpt and link. New entries are marked;
 * viewing the tab clears the markers (POST /items/:id/seen) but keeps them visible for this visit.
 *
 * The excerpt reads as its source shows it (`SourceText`): a Slack message with bold, links and mentions by name
 * (the payload's `mentions`), an email as sanitized HTML or text; a long one folds behind "Show all".
 */
import { useEffect, useState } from 'react';
import type { Evidence } from '@/contract';
import { useApi } from '@/client/hooks';
import { hasSlackMarkup, snippetFormat } from '@/lib/compose';
import { cn, ConfidenceWord, EmptyState, Icon, PanelError, Skeleton, usePanelState } from '@/ui';
import { groupEvidence, ROLE_META } from '../lib/derive';
import { useMarkSeen } from '../lib/mutations';
import { fmtWhen } from '../lib/tz';
import { EvidenceChip, GroupLabel } from '../panel/bits';
import { SourceText } from '../SourceText';

/** Only the roles that are a signal get a color: completion (ready) and contradiction (broken). */
const ROLE_DOT: Record<string, string> = {
  origin: 'bg-faint',
  progress: 'bg-faint',
  completion: 'bg-success-500',
  context: 'bg-line-strong',
  contradiction: 'bg-danger-500',
};

function Entry({ e, isNew, now, tz, mentions }: { e: Evidence; isNew: boolean; now: string; tz?: string; mentions: Record<string, string> }) {
  return (
    <li className="relative ml-1 border-l border-line pb-4 pl-5 last:pb-1" data-evidence-id={e.id} data-new={isNew || undefined}>
      <span aria-hidden className={cn('absolute top-2 -left-[5px] size-2 rounded-full ring-2 ring-surface', ROLE_DOT[e.role])} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
        <EvidenceChip source={e.source} />
        <time dateTime={e.at} className="tabular-nums">
          {fmtWhen(e.at, now, tz, { today: true })}
        </time>
        {e.author ? <span>· {e.author}</span> : null}
        {e.confidence ? <ConfidenceWord value={e.confidence} /> : null}
        {isNew ? (
          <span className="inline-flex items-center gap-1.5 font-bold text-link">
            <span aria-hidden className="size-1.5 rounded-full bg-accent" /> New
          </span>
        ) : null}
      </div>
      {hasSlackMarkup(e.summary) ? (
        <SourceText text={e.summary} format="slack_mrkdwn" mentions={mentions} className="mt-1 max-w-[68ch] text-body text-fg" />
      ) : (
        <p className="mt-1 max-w-[68ch] text-body text-fg">{e.summary}</p>
      )}
      {e.snippet?.trim() ? (
        <blockquote className="mt-1 max-w-[68ch] border-l-2 border-line-strong pl-3 text-body text-muted" data-evidence-snippet>
          <SourceText text={e.snippet} format={snippetFormat(e.source.kind, e.snippet)} mentions={mentions} fold />
        </blockquote>
      ) : null}
      {e.source.url ? (
        <a href={e.source.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-caption text-link hover:underline">
          <Icon name="new_window" size="xs" /> Open in {e.source.kind === 'gmail' ? 'Gmail' : e.source.kind === 'gemini' ? 'notes' : e.source.label.split(' · ')[0]}
        </a>
      ) : null}
    </li>
  );
}

export function EvidenceTab({ itemId, active, now, tz }: { itemId: string; active: boolean; now: string; tz?: string }) {
  const q = useApi('getItemEvidence', { params: { id: itemId } });
  const seen = useMarkSeen();
  const [shownNew, setShownNew] = useState<ReadonlySet<string>>(new Set());
  const state = usePanelState('item.evidence', { loading: q.isLoading, error: q.data ? null : q.error, empty: !!q.data && q.data.evidence.length === 0 });

  useEffect(() => {
    if (!active || !q.data) return;
    const fresh = q.data.evidence.filter((e) => e.isNew).map((e) => e.id);
    if (!fresh.length) return;
    setShownNew((prev) => new Set([...prev, ...fresh]));
    seen.mutate({ params: { id: itemId }, body: {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, q.data, itemId]);

  if (state === 'loading') return <Skeleton count={6} className="py-2" />;
  if (state === 'error') return <PanelError title="Evidence failed to load" error={q.error} onRetry={() => void q.refetch()} compact />;
  if (state === 'empty' || !q.data) return <EmptyState size="panel" icon="search" title="No evidence yet" body="Sources that created, moved or closed this task show up here." />;

  const groups = groupEvidence(q.data.evidence);
  return (
    <div className="space-y-6" data-evidence-groups={groups.length}>
      {groups.map((g) => (
        <section key={g.role} aria-label={`${g.label} evidence`}>
          <div className="mb-2 flex items-baseline gap-2">
            <GroupLabel count={g.items.length}>{g.label}</GroupLabel>
            <span className="truncate text-caption text-muted">{ROLE_META[g.role].hint}</span>
          </div>
          <ol>
            {g.items.map((e) => (
              <Entry key={e.id} e={e} isNew={shownNew.has(e.id) || e.isNew} now={now} tz={tz} mentions={q.data!.mentions} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
