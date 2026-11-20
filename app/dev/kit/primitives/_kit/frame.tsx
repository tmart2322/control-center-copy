'use client';
/** Kit gallery scaffolding: a section panel and labelled specimen rows. */
import type { ReactNode } from 'react';
import { cn } from '@/ui/cn';
import { Eyebrow } from '@/ui/badges';

export function KitSection({ id, title, eyebrow, intro, children }: { id: string; title: string; eyebrow?: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} data-kit-section={id} className="scroll-mt-4 rounded-lg border border-line bg-surface">
      <header className="border-b border-line px-4 py-3">
        {eyebrow ? <Eyebrow as="p">{eyebrow}</Eyebrow> : null}
        <h2 className="text-title text-fg-heading">{title}</h2>
        {intro ? <p className="mt-0.5 max-w-[90ch] text-caption text-muted">{intro}</p> : null}
      </header>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

export function Specimen({ label, note, children, className, stack }: { label: string; note?: string; children: ReactNode; className?: string; stack?: boolean }) {
  return (
    <div className="grid grid-cols-[11rem_1fr] gap-4 px-4 py-3 @max-3xl/main:grid-cols-1 @max-3xl/main:gap-2">
      <div className="pt-1">
        <p className="text-caption font-bold text-fg">{label}</p>
        {note ? <p className="text-caption text-muted">{note}</p> : null}
      </div>
      <div className={cn('flex min-w-0 flex-wrap gap-3', stack ? 'flex-col items-stretch' : !className?.includes('items-') && 'items-center', className)}>{children}</div>
    </div>
  );
}

export function Cell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-start gap-1.5', className)}>
      {children}
      <span className="text-micro text-faint">{label}</span>
    </div>
  );
}
