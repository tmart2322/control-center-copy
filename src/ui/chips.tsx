'use client';
/**
 * Interactive and reference chips: SourceChip, EntityChip, ContextChip, plus StartBy and StaleMark.
 * v2 (DESIGN-V2 principle 8): sources, accounts and people are neutral. No hue by entity or source: a glyph or a
 * letter avatar on a neutral fill, label text in fg/muted. Linked chips get a hairline and a hover fill.
 */
import { AppLink } from '@/components/shell/AppLink';
import type { ReactNode } from 'react';
import type { SourceKind } from '@/contract';
import { useNow, useTimeZone } from './clock';
import { cn } from './cn';
import { fmtClock, fmtMinutes, initials, minutesBetween } from './format';
import { Icon, type IconSet } from './Icon';
import { Tooltip } from './Tooltip';

// ── SourceChip ──────────────────────────────────────────────────────────────────────────────

export type { SourceKind };

/** `tone` stays for type compat; in v2 every source is 'neutral' (a source is a label, not a colour). */
export const SOURCE_META: Record<SourceKind, { label: string; icon: { set: IconSet; name: string }; tone: 'source' | 'brand' | 'neutral' }> = {
  slack: { label: 'Slack', icon: { set: 'utility', name: 'slack' }, tone: 'neutral' },
  gmail: { label: 'Gmail', icon: { set: 'utility', name: 'email' }, tone: 'neutral' },
  calendar: { label: 'Calendar', icon: { set: 'utility', name: 'event' }, tone: 'neutral' },
  drive: { label: 'Drive', icon: { set: 'utility', name: 'file' }, tone: 'neutral' },
  gemini: { label: 'Gemini notes', icon: { set: 'utility', name: 'summary' }, tone: 'neutral' },
  org62: { label: 'Org62', icon: { set: 'utility', name: 'salesforce1' }, tone: 'neutral' },
  vdp: { label: 'VDP', icon: { set: 'utility', name: 'knowledge_base' }, tone: 'neutral' },
  claude: { label: 'Claude', icon: { set: 'utility', name: 'agent_session' }, tone: 'neutral' },
  manual: { label: 'Manual', icon: { set: 'utility', name: 'edit' }, tone: 'neutral' },
};

/** Linked chip: hairline on the surface, hover fill; never a hue. */
const LINK_CHIP =
  'inline-flex h-6 min-w-0 shrink-0 items-center gap-1.5 rounded-sm border border-line bg-surface text-caption text-fg no-underline transition-colors ' +
  'hover:border-line-strong hover:bg-surface-muted hover:text-fg-heading hover:no-underline focus-visible:outline-none focus-visible:shadow-focus';

export interface SourceChipProps {
  source: SourceKind;
  /** Opens the source (`o`). External links open in a new tab. */
  href?: string;
  /** "#acme-ext · thread". Defaults to the source name. */
  label?: string;
  /** Icon only (label becomes the tooltip). */
  compact?: boolean;
  className?: string;
}

export function SourceChip({ source, href, label, compact, className }: SourceChipProps) {
  const meta = SOURCE_META[source] ?? SOURCE_META.manual;
  const text = label ?? meta.label;
  const body = (
    <>
      <Icon set={meta.icon.set} name={meta.icon.name} size="sm" className="text-muted" />
      {compact ? <span className="sr-only">{text}</span> : <span className="max-w-[24ch] truncate" title={text}>{text}</span>}
    </>
  );
  if (href) {
    const external = /^[a-z]+:\/\//i.test(href) && !href.startsWith('/');
    const cls = cn(LINK_CHIP, compact ? 'w-6 justify-center px-0' : 'px-2', className);
    const el = external ? (
      <a href={href} target="_blank" rel="noreferrer" className={cls} aria-label={`Open in ${meta.label}: ${text}`}>
        {body}
      </a>
    ) : (
      <AppLink href={href} className={cls}>
        {body}
      </AppLink>
    );
    return compact ? <Tooltip content={`${meta.label} · ${text}`}>{el}</Tooltip> : el;
  }
  // A plain reference is a muted label with its glyph: a source, not a colour (mockup `.src`).
  const el = <span className={cn('inline-flex h-6 min-w-0 shrink-0 items-center gap-1.5 text-caption text-muted', compact && 'w-6 justify-center', className)}>{body}</span>;
  return compact ? <Tooltip content={text}>{el}</Tooltip> : el;
}

// ── EntityChip ──────────────────────────────────────────────────────────────────────────────

export type EntityKind = 'account' | 'opp' | 'initiative' | 'person' | 'session' | 'file';

/** Neutral letter avatars: the shape says the kind (people round, things square), never a hue. No favicon fetches (privacy). */
const ENTITY_AVATAR: Record<EntityKind, string> = {
  account: 'rounded-sm',
  opp: 'rounded-sm',
  initiative: 'rounded-sm',
  person: 'rounded-full',
  session: 'rounded-sm',
  file: 'rounded-sm',
};

const ENTITY_NOUN: Record<EntityKind, string> = {
  account: 'Account',
  opp: 'Opportunity',
  initiative: 'Initiative',
  person: 'Person',
  session: 'Claude session',
  file: 'File',
};

export interface EntityChipProps {
  kind: EntityKind;
  label: string;
  href?: string;
  className?: string;
  /** Avatar only (label in tooltip). */
  compact?: boolean;
}

export function LetterAvatar({ kind, label, size = 'sm' }: { kind: EntityKind; label: string; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-grid shrink-0 place-items-center bg-surface-sunken leading-none font-bold text-muted',
        size === 'sm' ? 'size-5 text-micro' : 'size-7 text-caption',
        ENTITY_AVATAR[kind],
      )}
    >
      {initials(label, kind === 'person' ? 2 : 1)}
    </span>
  );
}

export function EntityChip({ kind, label, href, className, compact }: EntityChipProps) {
  const body = (
    <>
      <LetterAvatar kind={kind} label={label} />
      {compact ? <span className="sr-only">{label}</span> : <span className="min-w-0 truncate">{label}</span>}
    </>
  );
  const title = `${ENTITY_NOUN[kind]}: ${label}`;
  if (href) {
    const el = (
      <AppLink href={href} title={compact ? undefined : title} className={cn(LINK_CHIP, 'max-w-[28ch] shrink py-0 pr-2 pl-0.5', compact && 'w-6 justify-center px-0', className)}>
        {body}
      </AppLink>
    );
    return compact ? <Tooltip content={title}>{el}</Tooltip> : el;
  }
  return (
    <span title={title} className={cn('inline-flex h-6 min-w-0 max-w-[28ch] shrink items-center gap-1.5 text-caption text-fg', className)}>
      {body}
    </span>
  );
}

// ── ContextChip ─────────────────────────────────────────────────────────────────────────────

export interface ContextChipProps {
  label: string;
  /** Leading entity avatar. */
  kind?: EntityKind;
  icon?: string;
  onRemove?: () => void;
  className?: string;
}

/** Chat context ("Context: Reply to Dana"); removable (mockup `.ctx-chip`). */
export function ContextChip({ label, kind, icon, onRemove, className }: ContextChipProps) {
  return (
    <span className={cn('inline-flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md border border-line bg-surface-muted pr-0.5 pl-2 text-caption text-fg', !onRemove && 'pr-2.5', className)}>
      {kind ? <LetterAvatar kind={kind} label={label} /> : icon ? <Icon name={icon} size="sm" className="text-muted" /> : null}
      <span className="min-w-0 truncate">{label}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove context ${label}`}
          className="grid size-6 shrink-0 place-items-center rounded-sm text-muted hover:bg-fg/8 hover:text-fg focus-visible:outline-none focus-visible:shadow-focus"
        >
          <Icon name="close" size="xs" />
        </button>
      ) : null}
    </span>
  );
}

// ── StartBy ─────────────────────────────────────────────────────────────────────────────────

export interface StartByProps {
  at: string | Date;
  /** Override the clock (tests, kit). Defaults to the server-aligned clock. */
  now?: string | Date;
  /** Larger figure for the #1 card. */
  emphasis?: boolean;
  className?: string;
}

/** "start by 10:15": calm (muted) when there's time, amber + ▲ within 15 min, red + "late 5m" once late. */
export function StartBy({ at, now, emphasis, className }: StartByProps) {
  const clock = useNow(15_000);
  const tz = useTimeZone();
  const current = now ? new Date(now) : clock;
  const left = minutesBetween(current, at);
  const state = left < 0 ? 'late' : left <= 15 ? 'soon' : 'ok';
  const time = fmtClock(at, tz);
  return (
    <span
      title={state === 'late' ? `Late by ${fmtMinutes(-left)}` : `Starts in ${fmtMinutes(left)}`}
      data-state={state}
      className={cn(
        'inline-flex items-baseline gap-1 whitespace-nowrap tabular-nums',
        emphasis ? 'text-body' : 'text-caption',
        state === 'ok' && 'text-muted',
        state === 'soon' && 'font-bold text-warning-700',
        state === 'late' && 'font-bold text-danger-700',
        className,
      )}
    >
      {state === 'soon' ? <Icon name="warning" size="xs" className="self-center" /> : state === 'late' ? <Icon name="error" size="xs" className="self-center" /> : null}
      start by <span className={cn('font-bold', state === 'ok' && 'text-fg', emphasis && 'text-title leading-none')}>{time}</span>
      {state === 'late' ? <span className="text-caption">· late {fmtMinutes(-left)}</span> : null}
    </span>
  );
}

// ── StaleMark ───────────────────────────────────────────────────────────────────────────────

export interface StaleMarkProps {
  /** "Gmail needs re-auth since 09:40; this may be out of date." */
  reason: string;
  className?: string;
  children?: ReactNode;
}

/** ☾ on items whose source connector is broken or behind (UI-SPEC §5.3). Amber glyph + tooltip; never the only signal on a row. */
export function StaleMark({ reason, className, children }: StaleMarkProps) {
  return (
    <Tooltip content={reason}>
      <span
        tabIndex={0}
        role="img"
        aria-label={`Possibly stale: ${reason}`}
        className={cn('inline-flex shrink-0 cursor-help items-center gap-1 rounded-sm text-caption leading-none font-bold text-warning-700 focus-visible:outline-none focus-visible:shadow-focus', className)}
      >
        <span aria-hidden className="text-body leading-none">
          ☾
        </span>
        {children}
      </span>
    </Tooltip>
  );
}
