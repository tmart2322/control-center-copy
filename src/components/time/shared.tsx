'use client';
/** Small layout pieces shared by the Time, Health and Settings pages (P5). Tokens only. */
import type { ReactNode } from 'react';
import { cn, Eyebrow } from '@/ui';

export function PageHeader({ title, subtitle, actions, className }: { title: string; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn('flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2', className)}>
      <div className="min-w-0">
        <h1 className="text-heading text-fg-heading">{title}</h1>
        {subtitle ? <p className="text-caption text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({ eyebrow, title, trailing, children, className, bodyClassName }: { eyebrow?: string; title?: ReactNode; trailing?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn('flex min-h-0 min-w-0 flex-col rounded-lg border border-line bg-surface', className)}>
      {eyebrow || title || trailing ? (
        <div className="flex min-h-9 items-center gap-2 border-b border-line px-3 py-1.5">
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          {title ? <h2 className="text-body-lg font-bold text-fg-heading">{title}</h2> : null}
          {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
        </div>
      ) : null}
      <div className={cn('min-h-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Copy text; falls back to a hidden textarea when the async clipboard is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
