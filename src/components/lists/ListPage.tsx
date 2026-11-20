'use client';
/**
 * The page frame the four list pages share (brief 12 §8.4, UI-SPEC §3): a compact page header with an
 * object tile, optional tabs and toolbar, and ONE scrolling body. The page itself never scrolls.
 */
import type { ReactNode, Ref } from 'react';
import { cn, Eyebrow, ObjectTile } from '@/ui';

export interface ListPageProps {
  /** SLDS standard object for the header tile ("task", "event", "email", "report"). */
  tile: string;
  eyebrow: string;
  title: string;
  /** One quiet line beside the title ("34 open · 6 done"). */
  meta?: ReactNode;
  /** Right side: the page's actions (one primary at most). */
  actions?: ReactNode;
  tabs?: ReactNode;
  toolbar?: ReactNode;
  /** Page-scoped banners (stale connector, dry run). */
  banner?: ReactNode;
  children: ReactNode;
  bodyRef?: Ref<HTMLDivElement>;
  bodyClassName?: string;
  /** false: the body doesn't scroll or pad; the page lays out its own scrolling panes (Briefs). */
  bodyScroll?: boolean;
  /** Pin below the body (bulk bar). */
  footer?: ReactNode;
}

export function ListPage({ tile, eyebrow, title, meta, actions, tabs, toolbar, banner, children, bodyRef, bodyClassName, bodyScroll = true, footer }: ListPageProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-muted">
      <header className="shrink-0 border-b border-line bg-surface">
        <div className="flex h-12 items-center gap-3 px-4">
          <ObjectTile name={tile} size="lg" />
          <div className="flex min-w-0 flex-col justify-center">
            <Eyebrow className="leading-3">{eyebrow}</Eyebrow>
            <h1 className="truncate text-heading font-bold leading-6 text-fg-heading">{title}</h1>
          </div>
          {meta ? <div className="min-w-0 pl-1 text-body text-muted">{meta}</div> : null}
          {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
        {tabs}
      </header>
      {toolbar ? <div className="shrink-0 border-b border-line bg-surface px-4 py-2">{toolbar}</div> : null}
      {banner}
      <div ref={bodyRef} className={cn('relative min-h-0 flex-1', bodyScroll ? 'cc-scroll overflow-y-auto overscroll-contain p-4' : 'flex overflow-hidden', bodyClassName)}>
        {children}
      </div>
      {footer}
    </div>
  );
}
