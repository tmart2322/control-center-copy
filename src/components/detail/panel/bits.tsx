'use client';
/**
 * Small v2 building blocks for the item detail (docked panel, sheet, page) and the initiative page.
 * DESIGN-V2: sentence-case headings (no ALL-CAPS eyebrows), 16 px base, color only as an indicator
 * (accounts, people and sources are neutral), prose ≤ 68ch. Token names only (src/styles/brand.css).
 */
import { AppLink } from '@/components/shell/AppLink';
import { useId, useState, type ReactNode } from 'react';
import type { SourceRef, Tone } from '@/contract';
import { cn, Icon, SOURCE_META, StatePill, TONE_BADGE } from '@/ui';
import type { Badge } from '../lib/panel-derive';
import { openDeepLink } from '../nba/ClaudeLaunchPanel';

/** A section heading: bold 16 px, an optional muted suffix ("· you ~20m, agent ~20m in background"). */
export function SectionHeading({ children, suffix, action, as: As = 'h3', id }: { children: ReactNode; suffix?: ReactNode; action?: ReactNode; as?: 'h2' | 'h3'; id?: string }) {
  return (
    <div className="mb-2 flex min-w-0 items-baseline gap-2">
      <As id={id} className="min-w-0 text-body font-bold text-fg-heading">
        {children}
        {suffix ? <span className="text-caption font-normal text-muted"> · {suffix}</span> : null}
      </As>
      {action ? <span className="ml-auto shrink-0 text-caption">{action}</span> : null}
    </div>
  );
}

/** A labelled section that disappears when it has nothing to say. */
export function DetailSection({ title, suffix, action, children, className, ...rest }: { title: ReactNode; suffix?: ReactNode; action?: ReactNode; children: ReactNode; className?: string } & Record<`data-${string}`, unknown>) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('min-w-0', className)} {...rest}>
      <SectionHeading id={id} suffix={suffix} action={action}>
        {title}
      </SectionHeading>
      {children}
    </section>
  );
}

/** The state badge: glyph + word on a tint, one color signal. */
export function StateBadge({ badge, className }: { badge: Badge; className?: string }) {
  return <StatePill tone={badge.tone} icon={false} label={`${badge.glyph} ${badge.label}`} size="md" className={className} />;
}

/** Account / initiative / category tag: neutral, never a per-account hue. */
export function NeutralTag({ children, href, title }: { children: ReactNode; href?: string; title?: string }) {
  const cls = 'inline-flex h-6 max-w-[24ch] min-w-0 shrink items-center truncate rounded-sm border border-line-strong bg-surface-sunken px-2 text-caption font-bold text-fg';
  return href ? (
    <AppLink href={href} title={title} className={cn(cls, 'hover:border-line-input hover:no-underline')}>
      <span className="truncate">{children}</span>
    </AppLink>
  ) : (
    <span title={title} className={cls}>
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Evidence chip: "Source · label", neutral, opens the source. */
export function EvidenceChip({ source }: { source: SourceRef }) {
  const meta = SOURCE_META[source.kind] ?? SOURCE_META.manual;
  // Labels often repeat the source ("Calendar · Review"): show the kind once.
  const label = source.label.replace(new RegExp(`^${meta.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[·:-]\\s*`, 'i'), '') || source.label;
  const body = (
    <>
      <span className="shrink-0 text-muted">{meta.label}</span>
      <span aria-hidden className="text-faint">
        ·
      </span>
      <span className="min-w-0 truncate font-bold text-fg">{label}</span>
      {source.url ? <Icon name="new_window" size="xs" className="shrink-0 text-faint" /> : null}
    </>
  );
  const cls = 'inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-caption whitespace-nowrap';
  if (!source.url) return <span className={cls}>{body}</span>;
  return (
    <button
      type="button"
      onClick={() => openDeepLink(source.url!)}
      title={`Open in ${meta.label}: ${source.label}`}
      data-evidence-chip={source.kind}
      data-href={source.url}
      className={cn(cls, 'transition-colors hover:border-line-input hover:bg-surface-muted focus-visible:shadow-focus focus-visible:outline-none')}
    >
      {body}
    </button>
  );
}

export function EvidenceChips({ sources }: { sources: SourceRef[] }) {
  if (!sources.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2" data-evidence-chips>
      {sources.map((s) => (
        <EvidenceChip key={`${s.kind}|${s.label}`} source={s} />
      ))}
    </div>
  );
}

const DOT: Record<Tone, string> = {
  ok: 'bg-success-500',
  warn: 'bg-warning-500',
  risk: 'bg-danger-500',
  brand: 'bg-accent',
  ai: 'bg-ai-500',
  neutral: 'bg-faint',
};

export function ToneDot({ tone, className, label }: { tone: Tone; className?: string; label?: string }) {
  return <span aria-label={label} aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} className={cn('inline-block size-2 shrink-0 rounded-full', DOT[tone], className)} />;
}

/** ✓ green / ○ amber readiness check (word + glyph, never color alone). */
export function ReadyBadge({ ready, label, onOpen }: { ready: boolean; label: string; onOpen?: () => void }) {
  // Its own badge (not StatePill): a long prep title wraps here instead of being cut (one class per property).
  const pill = (
    <span className={cn('inline-flex max-w-full items-start gap-1.5 rounded-sm px-2 py-0.5 text-caption font-bold', TONE_BADGE[ready ? 'ok' : 'warn'])}>
      <span aria-hidden>{ready ? '✓' : '○'}</span>
      <span className="min-w-0">
        <span className="sr-only">{ready ? 'Ready: ' : 'Not ready: '}</span>
        {label}
      </span>
    </span>
  );
  if (!onOpen) return pill;
  return (
    <button type="button" onClick={onOpen} className="max-w-full rounded-sm text-left focus-visible:shadow-focus focus-visible:outline-none">
      {pill}
    </button>
  );
}

/**
 * A collapsed group ("Evidence · 2 new", "History"): a quiet disclosure row, the content mounts only
 * while open (so Evidence marks itself seen when you open it).
 */
export function Collapsible({
  title,
  meta,
  open,
  onToggle,
  children,
  id,
}: {
  title: string;
  meta?: ReactNode;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
  id: string;
}) {
  const panelId = `${id}-panel`;
  return (
    <section className="border-t border-line first:border-t-0" data-collapsible={id} data-open={open || undefined}>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onToggle(!open)}
          className="flex h-12 w-full items-center gap-2 rounded-md px-1 text-left text-body font-bold text-fg-heading transition-colors hover:bg-surface-muted focus-visible:shadow-focus focus-visible:outline-none"
        >
          <Icon name={open ? 'chevrondown' : 'chevronright'} size="xs" className="shrink-0 text-muted" />
          <span className="min-w-0 truncate">{title}</span>
          {meta ? <span className="ml-auto shrink-0 text-caption font-normal text-muted">{meta}</span> : null}
        </button>
      </h3>
      {open ? (
        <div id={panelId} className="pt-1 pb-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** Local open/closed state for a set of collapsibles. */
export function useOpenSet(initial: readonly string[]) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(initial));
  return {
    isOpen: (k: string) => open.has(k),
    toggle: (k: string, v: boolean) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (v) next.add(k);
        else next.delete(k);
        return next;
      }),
    open: (k: string) => setOpen((prev) => (prev.has(k) ? prev : new Set([...prev, k]))),
  };
}

/** A small sentence-case group label with an optional count (replaces the v1 ALL-CAPS eyebrow). */
export function GroupLabel({ children, count, tone = 'muted', className }: { children: ReactNode; count?: number | string; tone?: 'muted' | 'ai'; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-baseline gap-1.5 text-caption font-bold', tone === 'ai' ? 'text-ai-700' : 'text-fg-heading', className)}>
      <span className="truncate">{children}</span>
      {count !== undefined && count !== '' ? <span className="font-normal text-muted tabular-nums">{count}</span> : null}
    </span>
  );
}

/** Initials in a neutral circle: people are never color-coded (DESIGN-V2 principle 8). */
export function Initials({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <span aria-hidden className={cn('inline-grid shrink-0 place-items-center rounded-full border border-line bg-surface-sunken font-bold text-muted', size === 'sm' ? 'size-6 text-micro' : 'size-8 text-caption')}>
      {letters}
    </span>
  );
}

/** A quiet "Open" link-button for assets and links. */
export function OpenButton({ url, label }: { url: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => openDeepLink(url)}
      aria-label={`Open ${label}`}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-caption font-bold text-link hover:bg-surface-muted focus-visible:shadow-focus focus-visible:outline-none"
    >
      <Icon name="new_window" size="xs" /> Open
    </button>
  );
}

/** The quiet trust line ("Nothing sends until you approve…"). */
export function TrustLine({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('max-w-[68ch] text-caption text-muted', className)}>{children}</p>;
}
