'use client';
/**
 * Capture enrichment (UI-SPEC §13, R-UI-9): right after a quick capture the item shows "enriching…",
 * then related-work chips arrive over live events, each with its reason and Accept / Reject.
 * Accepting links it to the task and fills the NBA: a chip with a link is added to the ready draft.
 * Guesses look different from facts (§1.4): suggested chips use the dashed AI treatment.
 */
import type { EnrichmentChip, WorkItem } from '@/contract';
import { toast } from '@/client/toast';
import { Button, cn, Icon, Skeleton, Spinner, useNow } from '@/ui';
import { decideChip, useChipDecisions, type ChipDecision } from './lib/enrichment-store';
import { enrichmentView } from './lib/enrichment-state';

const KIND_ICON: Record<EnrichmentChip['kind'], string> = {
  claude_session: 'agent_session',
  asset: 'file',
  slack_thread: 'slack',
  email_thread: 'email',
  opportunity: 'opportunity',
  account: 'account',
  person: 'user',
  meeting: 'event',
};

export interface EnrichmentProps {
  item: WorkItem;
  /** Fill the NBA: add the accepted chip's link to the draft (returns false when there's no draft). */
  onFill?: (chip: EnrichmentChip) => boolean;
}

export function Enrichment({ item, onFill }: EnrichmentProps) {
  const decisions = useChipDecisions(item.id);
  const nowMs = useNow(10_000).getTime();
  const view = enrichmentView(item.enrichment, nowMs);
  // Past the wait (an enrich job no worker ran) the capture is simply added: no spinner, no "nothing found" claim.
  const raw = item.enrichment;
  const e = raw && view === 'stale' ? { ...raw, status: 'done' as const } : raw;
  if (!e || e.status === 'idle' || (view === 'stale' && !e.chips.length)) return null;
  const chips = e.chips.map((c) => ({ ...c, status: (decisions[c.id] as ChipDecision | undefined) ?? c.status }) as EnrichmentChip);
  const pending = chips.filter((c) => c.status === 'suggested');
  const accepted = chips.filter((c) => c.status === 'accepted');
  const rejected = chips.filter((c) => c.status === 'rejected');
  if (e.status === 'done' && !chips.length) {
    return (
      <p className="flex items-center gap-1.5 rounded-md bg-surface-muted px-3 py-2 text-caption text-muted" data-enrichment="none">
        <Icon name="search" size="xs" /> No related work found for this capture.
      </p>
    );
  }

  const decide = (c: EnrichmentChip, d: 'accepted' | 'rejected') => {
    const prev = decideChip(item.id, c.id, d);
    const filled = d === 'accepted' ? onFill?.(c) ?? false : false;
    toast({
      key: `chip:${c.id}`,
      title: d === 'accepted' ? `Linked: ${c.label}` : `Rejected: ${c.label}`,
      body: d === 'accepted' ? (filled ? 'Added to the draft.' : 'Linked to this task.') : undefined,
      undo: { run: () => decideChip(item.id, c.id, prev) },
    });
  };

  return (
    <section aria-label="Related work found" data-enrichment={e.status} className="rounded-lg border-agentic bg-surface px-4 py-3">
      <div className="flex items-center gap-1.5">
        <Icon name="sparkles" size="xs" className="text-ai-700" />
        <span className="text-caption font-bold text-ai-700">Related work found</span>
        {e.status === 'enriching' ? (
          <span className="inline-flex items-center gap-1.5 text-caption text-ai-700" role="status">
            <Spinner size="xs" /> enriching…
          </span>
        ) : (
          <span className="text-caption text-muted">
            {pending.length ? `${pending.length} to review` : 'all reviewed'}
            {accepted.length ? ` · ${accepted.length} linked` : ''}
          </span>
        )}
      </div>
      {e.status === 'enriching' && !chips.length ? (
        <div className="mt-2 space-y-1.5" aria-hidden>
          <p className="text-body text-muted">Looking for the Claude sessions, docs and threads behind this capture…</p>
          <Skeleton variant="line" count={2} className="max-w-md" />
        </div>
      ) : null}
      {chips.length ? (
        <ul className="mt-2 space-y-1.5">
          {[...pending, ...accepted].map((c) => (
            <li
              key={c.id}
              data-chip-id={c.id}
              data-chip-status={c.status}
              className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-2', c.status === 'suggested' ? 'border border-dashed border-ai-200 bg-ai-50' : 'border border-line bg-surface-muted')}
            >
              <Icon name={c.status === 'accepted' ? 'check' : KIND_ICON[c.kind]} size="sm" className={c.status === 'accepted' ? 'text-success-700' : 'text-muted'} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-fg" title={c.label}>
                  {c.label}
                </span>
                <span className="block truncate text-caption text-muted">{c.reason}</span>
              </span>
              {c.status === 'suggested' ? (
                <span className="flex shrink-0 items-center gap-1">
                  <Button size="xs" variant="secondary" icon="check" onClick={() => decide(c, 'accepted')} data-chip-accept>
                    Accept
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => decide(c, 'rejected')} data-chip-reject>
                    Reject
                  </Button>
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-2 text-caption">
                  <span className="font-bold text-success-700">Linked</span>
                  <button type="button" className="text-link hover:underline" onClick={() => decideChip(item.id, c.id, null)}>
                    Undo
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {rejected.length ? (
        <p className="mt-1.5 text-caption text-faint">
          {rejected.length} rejected ·{' '}
          <button type="button" className="text-link hover:underline" onClick={() => rejected.forEach((c) => decideChip(item.id, c.id, null))}>
            show again
          </button>
        </p>
      ) : null}
    </section>
  );
}
