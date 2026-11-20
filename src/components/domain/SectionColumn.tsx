'use client';
/**
 * SectionColumn: one verb-named Home section (DESIGN-V2 principles 2–4; mockup home-1-briefing columns).
 *
 *   Reply & approve 4 ························ [batch action]  (or a faint sub: "next 14 days")
 *   [before: e.g. the AheadStrip]
 *   rows, capped at 3 (5 at 2,400 px and wider)
 *   See all 4 in Outbox →
 *
 * Sections disappear when empty (pass `empty` to keep a calm line instead). Rows are any row components
 * (WorkRow, FitInRow, …); the list gives them j/k focus movement. Rows past the cap are not rendered;
 * rows between `cap` and `capWide` render only at 2,400 px and wider.
 */
import { Children, useId, type ReactNode } from 'react';
import { AppLink } from '@/components/shell/AppLink';
import { cn, LiveCount } from '@/ui';
import { WorkList } from './WorkRow';
import './domain.css';

export interface SectionColumnProps {
  /** A verb: "Do now", "Reply & approve", "Prep", "Log & fix", "Chase", "Think ahead". */
  title: string;
  count?: number;
  /** Faint text on the right of the header ("next 14 days"). */
  sub?: ReactNode;
  /** Batch action in the header (a quiet button, e.g. "Approve 2 ready"). */
  action?: ReactNode;
  /** The rows. */
  children?: ReactNode;
  /** Rows shown under 2,400 px (default 3). */
  cap?: number;
  /** Rows shown at 2,400 px and wider (default 5). */
  capWide?: number;
  /** Total behind "See all N →" (default: `count`, else the number of rows). */
  total?: number;
  onSeeAll?: () => void;
  seeAllHref?: string;
  /** Default "See all N →". */
  seeAllLabel?: string;
  /** Content between the header and the rows (e.g. the 14-day AheadStrip). */
  before?: ReactNode;
  /** Shown when there are no rows; without it the section renders nothing. */
  empty?: ReactNode;
  id?: string;
  className?: string;
}

const CAP = [1, 2, 3, 4, 5, 6] as const;

export function SectionColumn({ title, count, sub, action, children, cap = 3, capWide = 5, total, onSeeAll, seeAllHref, seeAllLabel, before, empty, id, className }: SectionColumnProps) {
  const autoId = useId();
  const hid = `${id ?? autoId}-h`;
  const rows = Children.toArray(children).filter(Boolean);
  if (!rows.length && !empty) return null;
  const c = CAP.includes(cap as (typeof CAP)[number]) ? cap : 3;
  const wide = Math.max(c, Math.min(6, capWide));
  const shown = rows.slice(0, wide);
  const all = total ?? count ?? rows.length;
  const more = all > c;
  const label = seeAllLabel ?? `See all ${all} →`;
  const seeAllCls = cn('mt-auto inline-flex self-start pt-2 text-caption font-bold text-link hover:underline', all <= wide && 'min-[2400px]:hidden');
  return (
    <section id={id} aria-labelledby={hid} className={cn('@container relative flex min-w-0 flex-col px-4 pb-3 pt-4', className)}>
      <div className="flex min-w-0 items-baseline gap-2 pb-1">
        <h2 id={hid} className="shrink-0 whitespace-nowrap text-lead font-bold text-fg-heading">
          {title}
        </h2>
        {count !== undefined ? <span className="shrink-0 text-body text-muted tabular-nums"><LiveCount value={count} /></span> : null}
        {sub ? <span className="ml-auto min-w-0 truncate text-caption text-faint">{sub}</span> : null}
        {action ? <span className={cn('hidden min-w-0 shrink @[22rem]:inline-flex', !sub && 'ml-auto')}>{action}</span> : null}
      </div>
      {before}
      {shown.length ? (
        <WorkList bare label={title} className={cn('-mx-3', `cc-cap-${c}`, `cc-capw-${wide}`)}>
          {shown}
        </WorkList>
      ) : (
        <div className="py-2 text-caption text-faint">{empty}</div>
      )}
      {more ? (
        seeAllHref ? (
          <AppLink href={seeAllHref} className={seeAllCls}>
            {label}
          </AppLink>
        ) : (
          <button type="button" onClick={onSeeAll} className={seeAllCls}>
            {label}
          </button>
        )
      ) : null}
    </section>
  );
}
