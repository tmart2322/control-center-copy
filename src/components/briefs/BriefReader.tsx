'use client';
/**
 * One brief, read (UI-SPEC §12 Briefs, design v2). Shared by the Briefs reading pane and the account page's Brief tab.
 *
 *   header    kind · title · period · "through 10:41" · source chips
 *   summary   ✦ written by AI (the violet marker is for AI-written summaries only) · prose capped at 68ch
 *   worth a closer look   highlight rows: title, the why line (reasons tied to your accounts and policy), the
 *             summary, sources. Verb: Promote → Triage (quiet; filled when the highlight is selected). Make task and
 *             Not relevant on hover or selection; a promoted or dismissed highlight keeps its own Undo.
 *   everything else       collapsed, grouped by thread
 *
 * `wide` puts the highlights in their own column beside the prose (width becomes panes, not longer lines).
 * Click or Enter on a highlight opens it in the docked panel (kind 'brief_highlight').
 */
import { useMemo, useState, type Ref } from 'react';
import type { Brief, BriefHighlight } from '@/contract';
import { renderMarkdown } from '@/components/chat/markdown';
import { AiMark, DomainClock, RelevanceWord, StatusBadge } from '@/components/domain';
import { isOpenHighlight } from '@/components/lists/cache-patches';
import { Button, cn, fmtClock, fmtDay, Icon, SourceChip } from '@/ui';
import { highlightChangeOf } from './highlight-undo';
import { promotedState } from './promoted';
import { ContextRow } from '@/components/deals/context-frame';

export interface HighlightHandlers {
  onPromote: (h: BriefHighlight) => void;
  onMakeTask: (h: BriefHighlight) => void;
  onDismiss: (h: BriefHighlight) => void;
  onUndo: (h: BriefHighlight) => void;
  onOpenTask: (h: BriefHighlight) => void;
  onOpenSource: (url: string) => void;
  /** Click or Enter: Details in the docked panel. */
  onOpen: (h: BriefHighlight) => void;
}

export interface BriefReaderProps extends HighlightHandlers {
  brief: Brief;
  tz?: string;
  now: string;
  /** Highlights beside the prose. */
  wide?: boolean;
  /** Compact header (the account page already names the account). */
  compact?: boolean;
  selectedHighlight: string | null;
  openId?: string | null;
  highlightsRef?: Ref<HTMLDivElement>;
  className?: string;
}

const KIND: Record<Brief['kind'], string> = { channel: 'Channel brief', opp: 'Opportunity brief', account: 'Account brief', person: 'Person brief', search: 'Search brief' };

function periodLabel(b: Brief, tz?: string): string {
  const from = new Date(b.period.from);
  const to = new Date(b.period.to);
  const sameDay = fmtDay(from, tz) === fmtDay(to, tz);
  return sameDay ? `${fmtDay(from, tz)}, ${fmtClock(from, tz)} to ${fmtClock(to, tz)}` : `${fmtDay(from, tz)} ${fmtClock(from, tz)} to ${fmtDay(to, tz)} ${fmtClock(to, tz)}`;
}

export function HighlightRow({ h, selected, inPanel, tz, ...p }: { h: BriefHighlight; selected: boolean; inPanel: boolean; tz?: string } & HighlightHandlers) {
  const promoted = h.status === 'promoted';
  const dismissed = h.status === 'dismissed';
  const live = isOpenHighlight(h.status);
  // One state once handled: "In Triage" (Open in Triage) or "Task made" (Open task), never Promoted beside a task.
  const st = promotedState(h, highlightChangeOf(h.id)?.kind);
  const verb = live
    ? { label: 'Promote → Triage', kbd: 'p', onClick: () => p.onPromote(h) }
    : st?.open
      ? { label: st.open.label, onClick: () => p.onOpenTask(h) }
      : { label: 'Undo', icon: 'undo', onClick: () => p.onUndo(h) };
  return (
    <ContextRow
      rowId={h.id}
      data-highlight-id={h.id}
      aria-label={h.title}
      title={<span className={cn(dismissed && 'text-muted line-through decoration-line-strong')}>{h.title}</span>}
      meta={
        <>
          {h.status === 'new' ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-accent" aria-hidden />
              New
            </span>
          ) : null}
          <RelevanceWord value={h.relevance} />
        </>
      }
      badge={
        promoted ? (
          <StatusBadge tone="success" icon="check">
            {st?.word ?? 'Promoted'}
          </StatusBadge>
        ) : dismissed ? (
          <StatusBadge tone="neutral">Not relevant · tuned</StatusBadge>
        ) : null
      }
      why={h.reasons.join(' · ')}
      selected={selected}
      inPanel={inPanel}
      dimmed={dismissed}
      verb={verb}
      secondary={
        live ? (
          <>
            <Button size="xs" variant="quiet" onClick={() => p.onMakeTask(h)} title="Make task (t)">
              Make task
            </Button>
            <Button size="xs" variant="quiet" onClick={() => p.onDismiss(h)} title="Not relevant (n)">
              Not relevant
            </Button>
          </>
        ) : promoted ? (
          <Button size="xs" variant="quiet" icon="undo" onClick={() => p.onUndo(h)}>
            Undo
          </Button>
        ) : null
      }
      below={
        <>
          <p className={cn('mt-1.5 line-clamp-2 max-w-[68ch] text-body', dismissed ? 'text-muted' : 'text-fg')}>{h.summary}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            {h.sources.map((s) => (
              <SourceChip key={`${s.kind}${s.label}`} source={s.kind} label={s.label} href={s.url ?? undefined} />
            ))}
            <span className="text-caption text-muted tabular-nums">{fmtClock(h.at, tz)}</span>
          </div>
        </>
      }
      onClick={() => p.onOpen(h)}
    />
  );
}

export function BriefReader({ brief: b, tz, now, wide, compact, selectedHighlight, openId, highlightsRef, className, ...handlers }: BriefReaderProps) {
  const html = useMemo(() => renderMarkdown(b.summary), [b.summary]);
  const [showAll, setShowAll] = useState(false);
  const open = b.highlights.filter((h) => isOpenHighlight(h.status));
  const totalMsgs = b.everythingElse.reduce((n, t) => n + t.items.length, 0);

  const highlights = (
    <section aria-label="Worth a closer look" className={cn(wide ? 'min-w-0' : 'mt-8')}>
      <div className="flex items-baseline gap-2 pb-2">
        <h3 className="text-lead font-bold text-fg-heading">Worth a closer look</h3>
        <span className="text-body text-muted tabular-nums">{open.length}</span>
        <span className="min-w-0 truncate text-caption text-muted">ranked for your accounts, opps and policy</span>
      </div>
      {b.highlights.length ? (
        <div ref={highlightsRef} role="list" aria-label="Highlights" data-testid="highlights" className="-mx-2">
          {b.highlights.map((h) => (
            <HighlightRow key={h.id} h={h} tz={tz} selected={selectedHighlight === h.id} inPanel={openId === h.id} {...handlers} />
          ))}
        </div>
      ) : (
        <p className="py-2 text-body text-muted">Nothing here needs a closer look. The rest is under Everything else.</p>
      )}
    </section>
  );

  return (
    <DomainClock now={now} tz={tz}>
      <article aria-label={b.title} data-testid="brief-pane" className={cn('min-w-0', className)}>
        <header className="min-w-0">
          {!compact ? <p className="text-caption text-muted">{KIND[b.kind]}</p> : null}
          <h2 className={cn('font-bold text-fg-heading', compact ? 'text-body-lg' : 'text-title')}>{b.title}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted">
            <span className="tabular-nums" data-testid="brief-period">
              {periodLabel(b, tz)}
            </span>
            <span className="tabular-nums" data-testid="brief-through">
              through {fmtClock(b.through, tz)}
            </span>
            <span className="inline-flex flex-wrap items-center gap-1.5">
              {b.sources.map((s) => (
                <SourceChip key={`${s.kind}${s.label}`} source={s.kind} href={s.url ?? undefined} label={s.label} />
              ))}
            </span>
          </p>
        </header>

        <div className={cn(wide ? 'mt-5 grid grid-cols-[minmax(0,68ch)_minmax(22rem,1fr)] items-start gap-10' : 'mt-5')}>
          <div className="min-w-0">
            <section aria-label="Summary">
              <div className="mb-2 flex items-center gap-3">
                {b.status === 'generating' ? (
                  <AiMark className="cc-reeval">Writing the summary…</AiMark>
                ) : b.status === 'failed' ? (
                  <StatusBadge tone="danger" icon="error">
                    Summary failed to generate
                  </StatusBadge>
                ) : (
                  <AiMark>Summary written by AI</AiMark>
                )}
              </div>
              {html ? <div className="cx-prose" data-testid="brief-summary" dangerouslySetInnerHTML={{ __html: html }} /> : <p className="text-body text-muted">No summary yet.</p>}
            </section>

            {!wide ? highlights : null}

            {b.everythingElse.length === 0 ? (
              <p className="mt-8 text-caption text-muted">Nothing else in this period.</p>
            ) : (
              <section className="mt-8" aria-label="Everything else">
                <button
                  type="button"
                  aria-expanded={showAll}
                  onClick={() => setShowAll((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-sm text-body-lg font-bold text-fg-heading focus-visible:outline-none focus-visible:shadow-focus"
                  data-testid="everything-else-toggle"
                >
                  <Icon name={showAll ? 'chevrondown' : 'chevronright'} size="sm" className="text-muted" />
                  Everything else
                  <span className="text-caption font-normal text-muted tabular-nums">
                    {totalMsgs} {totalMsgs === 1 ? 'message' : 'messages'} in {b.everythingElse.length} {b.everythingElse.length === 1 ? 'thread' : 'threads'}
                  </span>
                </button>
                {showAll ? (
                  <div className="mt-3 max-w-[80ch] space-y-3" data-testid="everything-else">
                    {b.everythingElse.map((t) => (
                      <div key={t.thread} className="rounded-md border border-line">
                        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                          <Icon name="chat" size="xs" className="text-muted" />
                          <span className="min-w-0 truncate text-body font-bold text-fg">{t.thread}</span>
                          {t.url ? (
                            <button type="button" onClick={() => handlers.onOpenSource(t.url!)} className="ml-auto inline-flex items-center gap-1 rounded-sm text-caption text-link hover:underline focus-visible:outline-none focus-visible:shadow-focus">
                              Open <Icon name="new_window" size="xs" />
                            </button>
                          ) : null}
                        </div>
                        <ul>
                          {t.items.map((m, i) => (
                            <li key={`${m.at}-${i}`} className="flex gap-3 border-b border-line px-3 py-2 text-body last:border-b-0">
                              <span className="w-12 shrink-0 text-caption text-muted tabular-nums">{fmtClock(m.at, tz)}</span>
                              <span className="w-32 shrink-0 truncate text-caption font-bold text-fg">{m.author}</span>
                              <span className="min-w-0 text-fg">{m.text}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            )}
          </div>
          {wide ? highlights : null}
        </div>
      </article>
    </DomainClock>
  );
}
