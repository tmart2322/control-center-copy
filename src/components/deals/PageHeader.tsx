'use client';
/**
 * Lightning page header (brief 12 §8.4): ObjectTile, eyebrow, title, actions; up to 6 highlight fields;
 * tabs below. Used by Deals, Account and Agents. Sticky at the top of the scrolling main region.
 */
import type { ReactNode } from 'react';
import { Eyebrow, ObjectTile, cn } from '@/ui';

export interface Highlight {
  label: string;
  value: ReactNode;
}

export interface PageHeaderProps {
  tile: string;
  eyebrow: string;
  title: ReactNode;
  /** Pill button group on the right (one primary at most). */
  actions?: ReactNode;
  /** Up to 6 fields; extras are dropped. */
  highlights?: Highlight[];
  /** A <Tabs> row. */
  tabs?: ReactNode;
  /** A line under the title (breadcrumb, subtitle). */
  sub?: ReactNode;
  className?: string;
}

export function PageHeader({ tile, eyebrow, title, actions, highlights, tabs, sub, className }: PageHeaderProps) {
  const fields = (highlights ?? []).slice(0, 6);
  return (
    <header className={cn('@container sticky top-0 z-10 border-b border-line bg-surface', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3 pb-2">
        <ObjectTile name={tile} size="lg" />
        <div className="min-w-0 flex-1">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="truncate text-heading font-bold text-fg-heading">{title}</h1>
          {sub ? <div className="text-caption text-muted">{sub}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {fields.length ? (
        <dl className="flex flex-wrap gap-x-6 gap-y-1.5 px-4 pb-3">
          {fields.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-caption text-muted">{f.label}</dt>
              <dd className="max-w-[28ch] truncate text-body text-fg">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {tabs ? <div className="px-4">{tabs}</div> : null}
    </header>
  );
}
