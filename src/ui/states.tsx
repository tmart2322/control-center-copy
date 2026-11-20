'use client';
/**
 * Panel states (R-UI-19): Skeleton, EmptyState, Banner, InlineStatus, ChangedElsewhere.
 * v2: status tints (50 bg + 200 hairline + 700 icon) only where something needs attention; calm neutral otherwise.
 * Every panel has calm empty copy (no emoji), a skeleton that mirrors its layout, and an error path.
 */
import type { ReactNode } from 'react';
import { Button } from './Button';
import { useWallClock } from './clock';
import { cn } from './cn';
import { fmtAgo } from './format';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

// ── Skeleton ────────────────────────────────────────────────────────────────────────────────

export interface SkeletonProps {
  /** line: one text line · block: an area · row: a list row · card: an NBA-card silhouette. */
  variant?: 'line' | 'block' | 'row' | 'card';
  /** For rows: how many. */
  count?: number;
  className?: string;
}

const bar = 'rounded-sm bg-surface-sunken';

export function Skeleton({ variant = 'line', count = 1, className }: SkeletonProps) {
  if (variant === 'row') {
    return (
      <div aria-hidden className={cn('animate-pulse', className)}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex h-(--row-h) items-center gap-3 border-b border-line px-4 last:border-b-0">
            <span className="h-5 w-[3px] rounded-full bg-line-strong" />
            <span className={cn(bar, 'h-3')} style={{ width: `${38 + ((i * 17) % 30)}%` }} />
            <span className="flex-1" />
            <span className={cn(bar, 'h-3 w-14')} />
            <span className={cn(bar, 'h-3 w-10')} />
          </div>
        ))}
      </div>
    );
  }
  if (variant === 'card') {
    return (
      <div aria-hidden className={cn('animate-pulse rounded-lg border border-line bg-surface p-(--panel-p)', className)}>
        <div className="flex items-center gap-2">
          <span className={cn(bar, 'size-4 rounded-full')} />
          <span className={cn(bar, 'h-3 w-40')} />
          <span className="flex-1" />
          <span className={cn(bar, 'h-3 w-20')} />
        </div>
        <span className={cn(bar, 'mt-3 block h-4 w-3/4')} />
        <span className={cn(bar, 'mt-2 block h-3 w-1/2')} />
        <span className={cn(bar, 'mt-3 block h-14 w-full rounded-md')} />
        <div className="mt-3 flex gap-2">
          <span className="h-8 w-24 rounded-md bg-line-strong" />
          <span className={cn(bar, 'h-8 w-16 rounded-md')} />
        </div>
      </div>
    );
  }
  if (variant === 'block') return <div aria-hidden className={cn('animate-pulse rounded-md bg-surface-sunken', className ?? 'h-24 w-full')} />;
  return (
    <div aria-hidden className={cn('animate-pulse space-y-2', className)}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={cn(bar, 'block h-3')} style={{ width: i === count - 1 && count > 1 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}

// ── EmptyState ──────────────────────────────────────────────────────────────────────────────

export interface EmptyStateProps {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  icon?: string;
  /** inline: one quiet line · panel: centred in a panel · page: a full empty page. */
  size?: 'inline' | 'panel' | 'page';
  className?: string;
}

export function EmptyState({ title, body, action, icon, size = 'panel', className }: EmptyStateProps) {
  if (size === 'inline') {
    return (
      <p className={cn('flex items-center gap-2 px-3 py-2 text-body text-muted', className)}>
        {icon ? <Icon name={icon} size="sm" className="text-faint" /> : null}
        <span className="font-bold text-fg">{title}</span>
        {body ? <span>{body}</span> : null}
        {action ? <span className="ml-auto">{action}</span> : null}
      </p>
    );
  }
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', size === 'page' ? 'gap-3 px-6 py-16' : 'gap-2 px-4 py-8', className)}>
      {icon ? (
        <span className={cn('grid place-items-center rounded-full bg-surface-muted text-muted', size === 'page' ? 'size-12' : 'size-9')}>
          <Icon name={icon} size={size === 'page' ? 'xl' : 'md'} />
        </span>
      ) : null}
      <p className={cn('text-fg-heading', size === 'page' ? 'text-heading font-bold' : 'text-body-lg font-bold')}>{title}</p>
      {body ? <div className="max-w-[48ch] text-body text-muted">{body}</div> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

// ── Banner ──────────────────────────────────────────────────────────────────────────────────

export type BannerTone = 'info' | 'warn' | 'risk' | 'ok' | 'ai';

const BANNER_TONE: Record<BannerTone, { box: string; icon: string; glyph: string }> = {
  info: { box: 'bg-info-50 border-info-200 text-fg', icon: 'text-info-700', glyph: 'info' },
  warn: { box: 'bg-warning-50 border-warning-200 text-fg', icon: 'text-warning-700', glyph: 'warning' },
  risk: { box: 'bg-danger-50 border-danger-200 text-fg', icon: 'text-danger-700', glyph: 'error' },
  ok: { box: 'bg-success-50 border-success-200 text-fg', icon: 'text-success-700', glyph: 'success' },
  ai: { box: 'bg-ai-50 border-ai-200 text-fg', icon: 'text-ai-700', glyph: 'sparkles' },
};

export interface BannerProps {
  tone?: BannerTone;
  /** page: a full-width strip under the page header · panel: inside a panel. */
  scope?: 'page' | 'panel';
  title: ReactNode;
  body?: ReactNode;
  /** One clear fix ("Re-auth"), plus optional secondary actions. */
  action?: ReactNode;
  onDismiss?: () => void;
  icon?: string;
  className?: string;
}

export function Banner({ tone = 'info', scope = 'panel', title, body, action, onDismiss, icon, className }: BannerProps) {
  const t = BANNER_TONE[tone];
  return (
    <div
      role={tone === 'risk' || tone === 'warn' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 border text-body', t.box, scope === 'page' ? 'border-x-0 border-t-0 px-6 py-2.5' : 'rounded-md px-4 py-3', className)}
    >
      <Icon name={icon ?? t.glyph} size="md" className={cn('mt-1', t.icon)} />
      <div className="min-w-0 flex-1 py-px">
        <span className="font-bold">{title}</span>
        {body ? <span className="text-muted"> {body}</span> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-fg/8 hover:text-fg focus-visible:outline-none focus-visible:shadow-focus">
          <Icon name="close" size="xs" />
        </button>
      ) : null}
    </div>
  );
}

// ── InlineStatus ────────────────────────────────────────────────────────────────────────────

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

export interface InlineStatusProps {
  state: SaveState;
  savedAt?: number | string | Date | null;
  error?: string | null;
  onRetry?: () => void;
  className?: string;
}

/** "Saving…" · "Saved · 2s ago" · "Couldn't save · Retry" beside the field or row (UI-SPEC §8–9). */
export function InlineStatus({ state, savedAt, error, onRetry, className }: InlineStatusProps) {
  const now = useWallClock(state === 'saved' ? 5_000 : 60_000);
  const cls = cn('inline-flex h-5 items-center gap-1 text-caption whitespace-nowrap', className);
  if (state === 'saving')
    return (
      <span role="status" aria-live="polite" className={cn(cls, 'text-muted')}>
        <Spinner size="xs" /> Saving…
      </span>
    );
  if (state === 'dirty')
    return (
      <span role="status" aria-live="polite" className={cn(cls, 'text-faint')}>
        Edited
      </span>
    );
  if (state === 'saved' && savedAt)
    return (
      <span role="status" aria-live="polite" className={cn(cls, 'text-muted')} title={new Date(savedAt).toLocaleString()}>
        <Icon name="check" size="xs" className="text-success-500" /> Saved · {fmtAgo(new Date(savedAt).getTime(), now)}
      </span>
    );
  if (state === 'error' || state === 'conflict')
    return (
      <span role="alert" className={cn(cls, 'text-danger-700')} title={error ?? undefined}>
        <Icon name="error" size="xs" />
        {state === 'conflict' ? 'Changed elsewhere' : "Couldn't save"}
        {onRetry && state === 'error' ? (
          <>
            <span aria-hidden className="text-faint">
              ·
            </span>
            <button type="button" onClick={onRetry} className="font-bold text-link hover:underline focus-visible:outline-none focus-visible:shadow-focus rounded-sm">
              Retry
            </button>
          </>
        ) : null}
      </span>
    );
  return <span aria-hidden className={cls} />;
}

// ── ChangedElsewhere (409 that touched the same field) ──────────────────────────────────────

export interface ConflictField {
  field: string;
  label?: string;
  mine: unknown;
  theirs: unknown;
}

export interface ChangedElsewhereProps {
  fields: ConflictField[];
  onKeepMine: () => void;
  onTakeTheirs: () => void;
  busy?: boolean;
  className?: string;
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/** ProposalDiff-style "Changed elsewhere: keep yours / take theirs" (UI-SPEC §10). */
export function ChangedElsewhere({ fields, onKeepMine, onTakeTheirs, busy, className }: ChangedElsewhereProps) {
  return (
    <div role="alert" className={cn('rounded-md border border-warning-200 bg-warning-50 p-4 text-body', className)}>
      <div className="flex items-center gap-2">
        <Icon name="warning" size="sm" className="text-warning-700" />
        <span className="font-bold text-fg">Changed elsewhere while you were editing</span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-caption">
        {fields.map((f) => (
          <div key={f.field} className="contents">
            <dt className="text-muted">{f.label ?? f.field}</dt>
            <dd className="min-w-0">
              <span className="block truncate">
                <span className="text-muted">Yours </span>
                <span className="font-bold text-fg">{show(f.mine)}</span>
              </span>
              <span className="block truncate">
                <span className="text-muted">Theirs </span>
                <span className="text-fg">{show(f.theirs)}</span>
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex gap-2">
        <Button size="xs" variant="primary" onClick={onKeepMine} loading={busy}>
          Keep yours
        </Button>
        <Button size="xs" variant="secondary" onClick={onTakeTheirs} disabled={busy}>
          Take theirs
        </Button>
      </div>
    </div>
  );
}
