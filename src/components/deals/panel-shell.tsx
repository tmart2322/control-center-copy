'use client';
/**
 * Details renderers for the context pages share one shape (the docked panel gives them a full-height flex column):
 * a header (where it's from, the title, one muted line), a body that scrolls on its own, and a pinned footer with the
 * ONE filled action plus quiet ones. `useCachedFind` reads an entity that a page already loaded (opps live inside an
 * account payload, highlights inside a brief, log rows inside a week) and re-renders when the cache changes.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useReducer, type ReactNode } from 'react';
import { cn } from '@/ui';

export function PanelShell({ from, title, sub, badge, children, footer, testId }: { from: ReactNode; title: ReactNode; sub?: ReactNode; badge?: ReactNode; children: ReactNode; footer?: ReactNode; testId?: string }) {
  return (
    <div className="@container/panel flex h-full min-h-0 flex-col bg-surface" data-context-page="" data-testid={testId}>
      <header className="shrink-0 space-y-2 border-b border-line px-6 pt-4 pb-4">
        <div className="flex min-w-0 items-center gap-2 text-caption text-muted">
          <span className="min-w-0 truncate">{from}</span>
          {badge ? <span className="shrink-0">{badge}</span> : null}
        </div>
        <h2 className="text-title font-bold text-balance text-fg-heading">{title}</h2>
        {sub ? <p className="max-w-[68ch] text-body text-muted">{sub}</p> : null}
      </header>
      <div className="cc-scroll min-h-0 flex-1 space-y-6 overflow-y-auto px-6 pt-5 pb-6 [scrollbar-gutter:stable]">{children}</div>
      {footer ? (
        <footer className="flex shrink-0 flex-wrap items-center gap-x-1 gap-y-2 border-t border-line bg-surface px-6 py-4" data-panel-footer>
          {footer}
        </footer>
      ) : null}
    </div>
  );
}

export function PanelSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0', className)}>
      <h3 className="mb-2 text-body-lg font-bold text-fg-heading">{title}</h3>
      {children}
    </section>
  );
}

/** Label-left facts (Settings' row language). */
export function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-body">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-caption leading-6 text-muted">{k}</dt>
          <dd className="min-w-0 text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A cache event that changes what `useCachedFind` reads: a query added, removed, or its data set. Never an observer's
 * own bookkeeping (`observerOptionsUpdated`, `observerResultsUpdated`, …). Every useQuery render emits those, so a
 * panel that both reads a topic through useCachedFind and queries that topic itself re-rendered itself forever:
 * about 3,000 renders a second, and "Page Unresponsive" on a busy machine (2026-11-14, the activity row's details).
 */
export function isCacheDataEvent(ev: { type: string; action?: { type: string } }): boolean {
  if (ev.type === 'added' || ev.type === 'removed') return true;
  return ev.type === 'updated' && (ev.action?.type === 'success' || ev.action?.type === 'setState');
}

/** Scan cached queries under `topic` for something `find` recognises; re-renders when that data changes. */
export function useCachedFind<T>(topic: string, find: (data: unknown, key: readonly unknown[]) => T | null | undefined): T | null {
  const qc = useQueryClient();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let queued = false;
    // Cache events can fire while another component renders (a query is created during its render), so the
    // re-render is deferred to a microtask instead of setting state inside someone else's render.
    return qc.getQueryCache().subscribe((ev) => {
      if (queued || ev.query.queryKey[0] !== topic || !isCacheDataEvent(ev as { type: string; action?: { type: string } })) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        bump();
      });
    });
  }, [qc, topic]);
  for (const [key, data] of qc.getQueriesData({ queryKey: [topic] })) {
    if (data === undefined) continue;
    const hit = find(data, key);
    if (hit) return hit;
  }
  return null;
}
