'use client';
/** Kit scaffolding: a section card and labelled specimen rows (tokens only, sentence case). */
import { createContext, useContext, type ReactNode } from 'react';
import { cn } from '@/ui';

/** The island a section renders in, so ids stay unique when the same section shows twice (dark + light). */
export const IslandContext = createContext<string | null>(null);

export function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  const island = useContext(IslandContext);
  const domId = island && island !== 'dark' ? `${id}-${island}` : id;
  return (
    <section id={domId} data-kit-section={id} className="scroll-mt-4 rounded-lg border border-line bg-surface">
      <header className="border-b border-line px-6 pt-4 pb-3">
        <h2 className="text-body-lg text-fg-heading">{title}</h2>
        {intro ? <p className="mt-0.5 max-w-measure text-caption text-muted">{intro}</p> : null}
      </header>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

export function Specimen({ label, note, children, className, stack }: { label: string; note?: string; children: ReactNode; className?: string; stack?: boolean }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-4 px-6 py-4">
      <div className="pt-1">
        <p className="text-caption font-bold text-fg">{label}</p>
        {note ? <p className="text-caption text-muted">{note}</p> : null}
      </div>
      {/* No flex-wrap when stacked: a wrapping column sizes each line to max-content, so wide lists would overflow. */}
      <div className={cn('flex min-w-0 gap-3', stack ? 'flex-col items-stretch' : 'flex-wrap items-center', className)}>{children}</div>
    </div>
  );
}

export function Cell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-start gap-1.5', className)}>
      {children}
      <span className="text-micro text-muted">{label}</span>
    </div>
  );
}
