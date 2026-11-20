'use client';
/**
 * Thin domain wrappers for chips. Design v2: sources, accounts and people are neutral (a label, never a
 * color), so these render their own calm marks instead of the tinted `@/ui` chips:
 *  - SourceChip takes a contract `SourceRef` and an `onOpen(source)` callback (the parent decides how to open);
 *  - EntityChip takes contract entity types, an `onOpen` callback and a `bare` (borderless) form;
 *  - StartBy also renders "due" times, an optional "· in 10m" note and a larger headline size.
 */
import type { EntityType, SourceKind, SourceRef } from '@/contract';
import { AppLink } from '@/components/shell/AppLink';
import { cn, Icon, SOURCE_META } from '@/ui';
import { useClock } from './clock';
import { dueLabel, dur, minutesBetween } from './time';

// ── SourceChip ──────────────────────────────────────────────────────────────────────────────

export interface SourceChipProps {
  source: SourceRef | SourceKind;
  href?: string;
  /** Icon-only (dense rows); the label moves to the tooltip. */
  compact?: boolean;
  onOpen?: (source: SourceRef) => void;
  className?: string;
}

/** Neutral source glyph + label. Interactive when it has `onOpen` or a link. */
export function SourceChip({ source, href, compact, onOpen, className }: SourceChipProps) {
  const ref: SourceRef = typeof source === 'string' ? { kind: source, label: SOURCE_META[source].label } : source;
  const url = href ?? ref.url;
  const meta = SOURCE_META[ref.kind] ?? SOURCE_META.manual;
  const title = compact ? `${meta.label} · ${ref.label}` : ref.label;
  const interactive = !!onOpen || !!url;
  const cls = cn(
    'inline-flex h-6 min-w-0 shrink-0 items-center gap-1.5 rounded-sm text-caption text-muted no-underline transition-colors',
    compact ? 'w-6 justify-center' : 'px-1.5',
    interactive && 'hover:bg-surface-muted hover:text-fg hover:no-underline focus-visible:outline-none focus-visible:shadow-focus',
    className,
  );
  const body = (
    <>
      <Icon set={meta.icon.set} name={meta.icon.name} size="xs" className="text-faint" />
      {compact ? <span className="sr-only">{ref.label}</span> : <span className="max-w-[24ch] truncate">{ref.label}</span>}
    </>
  );
  if (onOpen)
    return (
      <button
        type="button"
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          onOpen(ref);
        }}
        className={cls}
      >
        {body}
      </button>
    );
  if (url) {
    const external = /^[a-z]+:\/\//i.test(url);
    return external ? (
      <a href={url} title={title} className={cls} onClick={(e) => e.stopPropagation()} target="_blank" rel="noreferrer">
        {body}
      </a>
    ) : (
      <AppLink href={url} title={title} className={cls} onClick={(e) => e.stopPropagation()}>
        {body}
      </AppLink>
    );
  }
  return (
    <span className={cls} title={title}>
      {body}
    </span>
  );
}

// ── EntityChip ──────────────────────────────────────────────────────────────────────────────

export type EntityKind = Extract<EntityType, 'account' | 'opportunity' | 'initiative' | 'person' | 'calendar_event' | 'asset' | 'agent_run'>;

const KIND_ICON: Record<EntityKind, string> = {
  account: 'company',
  opportunity: 'opportunity',
  initiative: 'target',
  person: 'user',
  calendar_event: 'event',
  asset: 'file',
  agent_run: 'agent_session',
};

export interface EntityChipProps {
  kind: EntityKind;
  label: string;
  href?: string;
  onOpen?: () => void;
  /** Plain inline text (no border), for header rows. */
  bare?: boolean;
  className?: string;
}

/** A neutral reference to an account, opp, initiative, person or meeting. */
export function EntityChip({ kind, label, href, onOpen, bare, className }: EntityChipProps) {
  const cls = cn(
    'inline-flex min-w-0 max-w-full items-center gap-1.5 text-caption',
    bare ? 'text-muted' : 'h-6 rounded-sm border border-line-strong bg-surface-sunken px-2 font-bold text-fg',
    (href || onOpen) && 'hover:text-fg hover:underline hover:underline-offset-2',
    onOpen && 'focus-visible:outline-none focus-visible:shadow-focus',
    className,
  );
  const body = (
    <>
      {bare ? null : <Icon name={KIND_ICON[kind]} size="xs" className="text-muted" />}
      <span className="min-w-0 truncate">{label}</span>
    </>
  );
  if (onOpen) {
    return (
      <button
        type="button"
        className={cls}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        {body}
      </button>
    );
  }
  if (href) {
    return (
      <AppLink className={cn(cls, 'no-underline')} href={href} title={label} onClick={(e) => e.stopPropagation()}>
        {body}
      </AppLink>
    );
  }
  return (
    <span className={cls} title={label}>
      {body}
    </span>
  );
}

// ── StartBy ─────────────────────────────────────────────────────────────────────────────────

export interface StartByProps {
  at: string;
  now?: string;
  kind?: 'start' | 'due';
  size?: 'sm' | 'lg';
  tz?: string;
  /** Show "· in 10m" / "· late 5m" (dense rows turn it off; the tone and tooltip still carry it). */
  note?: boolean;
  className?: string;
}

export function startByTone(at: string, now: string): 'late' | 'soon' | 'calm' {
  const m = minutesBetween(now, at);
  if (m < 0) return 'late';
  if (m <= 15) return 'soon';
  return 'calm';
}

/** "Start by 10:15": amber within 15 min, red once late (UI-SPEC §5.3). Calm times stay muted text. */
export function StartBy({ at, now: nowProp, kind = 'start', size = 'sm', tz: tzProp, note: showNote = true, className }: StartByProps) {
  const { now, tz } = useClock({ now: nowProp, tz: tzProp });
  const tone = startByTone(at, now);
  const left = minutesBetween(now, at);
  const word = kind === 'start' ? 'Start by' : 'Due';
  const toneCls = tone === 'late' ? 'text-danger-700' : tone === 'soon' ? 'text-warning-700' : 'text-muted';
  const note = tone === 'late' ? `late ${dur(-left)}` : tone === 'soon' ? `in ${dur(left)}` : null;
  if (size === 'lg') {
    return (
      <span className={cn('inline-flex flex-col items-end', className)} title={`${word} ${dueLabel(at, now, tz)}`}>
        <span className={cn('text-caption', toneCls)}>
          {word}
          {note ? ` · ${note}` : ''}
        </span>
        <span className={cn('text-title font-bold tabular-nums', tone === 'calm' ? 'text-fg-heading' : toneCls)}>{dueLabel(at, now, tz)}</span>
      </span>
    );
  }
  return (
    <span title={note ? `${word} ${dueLabel(at, now, tz)} · ${note}` : undefined} className={cn('inline-flex items-center gap-1 whitespace-nowrap text-caption tabular-nums', toneCls, className)}>
      {tone !== 'calm' ? <Icon name="clock" size="xs" /> : null}
      {word} <span className={cn('font-bold', tone === 'calm' && 'text-fg')}>{dueLabel(at, now, tz)}</span>
      {note && showNote ? <span>· {note}</span> : null}
    </span>
  );
}
