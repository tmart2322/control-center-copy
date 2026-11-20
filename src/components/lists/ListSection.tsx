'use client';
/**
 * One verb-named section of a list page (DESIGN-V2 principles 2–4; the Home mockup's `.sec`):
 *
 *   Approve 3 ························································ [batch action]
 *   rows: 3 (5 at 2,400 px and wider) · See all 12 →  /  Show fewer
 *
 * Empty sections render nothing. The page decides how many rows are shown (`shownCount`) so its j/k ids
 * match what is on screen; this component just draws them and the disclosure link, which names what it
 * reveals.
 */
import { useId, type ReactNode } from 'react';
import { cn, LiveCount } from '@/ui';
import './lists.css';

export interface ListSectionProps {
  /** A verb: "Approve", "Do now", "Confirm asks and promises". */
  title: string;
  count?: number;
  /** Quiet text after the count (an initiative's purpose, "✦ from meetings"). */
  sub?: ReactNode;
  /** The batch action, quiet ("Approve all 3", "Select 3"). */
  action?: ReactNode;
  /** The rows to draw (already capped by the page). */
  children: ReactNode;
  /** Rows in the section (behind "See all N"). */
  total: number;
  /** How many rows are drawn. */
  shown: number;
  expanded?: boolean;
  onExpand?: (expanded: boolean) => void;
  /** Noun for the disclosure ("missed opps"). */
  noun?: string;
  id?: string;
  className?: string;
  'data-section'?: string;
}

export function ListSection({ title, count, sub, action, children, total, shown, expanded, onExpand, noun, id, className, ...rest }: ListSectionProps) {
  const auto = useId();
  const hid = `${id ?? auto}-h`;
  if (total <= 0) return null;
  const hidden = total - shown;
  return (
    <section id={id} aria-labelledby={hid} className={cn('cc-sec', className)} data-section={rest['data-section']}>
      <div className="cc-sec-head">
        <h2 id={hid} title={title}>
          {title}
        </h2>
        {count !== undefined ? <span className="cc-sec-count"><LiveCount value={count} /></span> : null}
        {sub ? <span className="cc-sec-sub">{sub}</span> : null}
        {action ? <span className="cc-sec-action">{action}</span> : null}
      </div>
      <div role="grid" aria-label={title} aria-rowcount={total} className="cc-sec-rows">
        {children}
      </div>
      {hidden > 0 && onExpand ? (
        <button type="button" className="cc-sec-more" onClick={() => onExpand(true)} data-testid="see-all" aria-label={`See all ${total} ${noun ?? title.toLowerCase()}`}>
          See all {total}
          {noun ? ` ${noun}` : ''} →
        </button>
      ) : expanded && onExpand && total > 3 ? (
        <button type="button" className="cc-sec-more" onClick={() => onExpand(false)} data-testid="show-fewer">
          Show fewer
        </button>
      ) : null}
    </section>
  );
}

/** Quiet batch action for a section header: link-coloured text, never a filled button. */
export function SectionAction({ children, onClick, disabled, title, testId }: { children: ReactNode; onClick: () => void; disabled?: boolean; title?: string; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testId}
      className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-caption font-bold text-link hover:bg-surface-muted focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-default disabled:text-muted disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
