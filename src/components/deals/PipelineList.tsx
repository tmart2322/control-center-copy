'use client';
/**
 * Deals ▸ the deal list a summary number or a chart segment opens (`/deals?pipe=…`): the same filter over the same
 * rows the number counted (src/lib/pipeline-filter.ts), so its count is the number's. It takes the Accounts pane's
 * place; "All accounts" goes back. A row is one deal: amount and close date, account · stage · category · next step,
 * one state badge at most (red close passed, amber no next step, green won). Click or Enter opens the account in
 * Details; the row's verb (⇧Enter) opens the account page with the opp open.
 */
import type { DealsPipeline, PipelineRow } from '@/contract';
import { pipeRows, sumOf, type PipeFilter } from '@/lib/pipeline-filter';
import { AppLink } from '@/components/shell/AppLink';
import { StatusBadge } from '@/components/domain';
import { Icon, ShowMore, Tooltip, useShowMore } from '@/ui';
import { ContextRow, Pane, QuietLine, SectionHead } from './context-frame';
import { fmtAmount, fmtDate } from './format';
import { dealNoun, pipeFilterTitle, pipeRowHref, pipeRowWhy } from './pipeline-words';

/** The list's row keys (j/k and the resume selection share them). */
export const pipeRowKey = (r: Pick<PipelineRow, 'id'>) => `pipe:${r.id}`;

export function pipelineListRows(p: DealsPipeline, f: PipeFilter): PipelineRow[] {
  return pipeRows(p.rows, f, p.today);
}

function badgeOf(r: PipelineRow) {
  if (r.attention.includes('past_close')) return { tone: 'danger' as const, icon: 'error', words: 'Close passed', edge: 'danger' as const };
  if (r.attention.includes('no_next_step')) return { tone: 'warning' as const, icon: 'warning', words: 'No next step', edge: 'warning' as const };
  if (r.isWon) return { tone: 'success' as const, icon: 'check', words: 'Won', edge: 'none' as const };
  return null;
}

export function PipelineListPane({ p, filter, selected, openId, onSelect, onOpenPage }: { p: DealsPipeline; filter: PipeFilter; selected: string | null; openId: string | null; onSelect: (r: PipelineRow) => void; onOpenPage: (r: PipelineRow) => void }) {
  const rows = pipelineListRows(p, filter);
  const sum = sumOf(rows);
  const title = pipeFilterTitle(filter, p);
  // 2026-11-13 audit C7: 869 open opps render in steps, the count always said ("Show 100 more")
  const sel = selected ? rows.findIndex((r) => pipeRowKey(r) === selected) : -1;
  const page = useShowMore(rows.length, { pinIndex: sel, resetKey: title });
  return (
    <Pane
      as="section"
      aria-label="Deals in the filter"
      data-testid="pipe-list"
      head={
        <SectionHead
          title={title}
          count={rows.length}
          sub={rows.length ? `${fmtAmount(sum.amount)} · ${p.amountField.label}` : undefined}
          action={
            <AppLink href="/deals" className="rounded-sm text-caption font-bold text-link hover:underline focus-visible:outline-none focus-visible:shadow-focus">
              All accounts
            </AppLink>
          }
        />
      }
      bodyClassName="pb-3"
    >
      {rows.length ? (
        <div role="list" aria-label={title}>
          {rows.slice(0, page.shown).map((r) => {
            const key = pipeRowKey(r);
            const b = badgeOf(r);
            const href = pipeRowHref(r);
            return (
              <ContextRow
                key={r.id}
                rowId={key}
                title={r.name}
                meta={
                  <>
                    <span className="text-body text-fg">{fmtAmount(r.amount)}</span>
                    <span className={r.attention.includes('past_close') ? 'text-danger-700' : undefined}>{fmtDate(r.closeDate)}</span>
                  </>
                }
                badge={b ? <StatusBadge tone={b.tone} icon={b.icon}>{b.words}</StatusBadge> : null}
                edge={b?.edge ?? 'none'}
                why={pipeRowWhy(r, p)}
                selected={selected === key}
                inPanel={!!r.accountId && openId === r.accountId && selected === key}
                verb={href ? { label: 'Open opp', kbd: 'shift+enter', onClick: () => onOpenPage(r) } : undefined}
                secondary={
                  r.url ? (
                    <Tooltip content="Open in Org62">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${r.name} in Org62`}
                        className="inline-grid size-7 place-items-center rounded-md text-muted hover:bg-surface-sunken hover:text-fg focus-visible:outline-none focus-visible:shadow-focus"
                      >
                        <Icon name="new_window" size="sm" />
                      </a>
                    </Tooltip>
                  ) : null
                }
                onClick={() => onSelect(r)}
                onDoubleClick={() => onOpenPage(r)}
              />
            );
          })}
          <ShowMore shown={page.shown} total={rows.length} step={page.step} onMore={page.more} onAll={page.all} noun={dealNoun(p, 2).replace(/^2 /, '')} />
        </div>
      ) : (
        <QuietLine>{`No ${dealNoun(p, 2).replace(/^2 /, '')} here.`}</QuietLine>
      )}
    </Pane>
  );
}
