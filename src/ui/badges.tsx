/**
 * Non-interactive status marks: StatePill, CountBadge, Eyebrow, ConfidenceWord, EffortSplit.
 * v2 (mockup `.badge`): an icon plus a word on a tinted background, status colours only, 6 px corners.
 * Colour is never the only signal: every status tone pairs with an icon (TONE_ICON) or a dot.
 */
import type { ElementType, ReactNode } from 'react';
import { cn } from './cn';
import { fmtMinutes } from './format';
import { Icon } from './Icon';
import { TONE_BADGE, TONE_DASHED, TONE_DOT, TONE_ICON, type Tone } from './tones';

export type PillSize = 'xs' | 'sm' | 'md';

const PILL_SIZE: Record<PillSize, string> = {
  xs: 'h-5 gap-1 px-1.5 text-micro',
  sm: 'h-6 gap-1.5 px-2 text-caption',
  md: 'h-7 gap-1.5 px-2.5 text-caption',
};

export interface StatePillProps {
  tone: Tone;
  label: string;
  size?: PillSize;
  /** Leading tone dot instead of the icon (health, "draft ready"). */
  dot?: boolean;
  /** Suggested / pending-approval treatment: nothing looks done before it is. */
  dashed?: boolean;
  /** Leading icon. Defaults to the tone's status icon (check / warning / error / sparkles); `false` hides it. */
  icon?: string | false;
  title?: string;
  className?: string;
}

export function StatePill({ tone, label, size = 'sm', dot, dashed, icon, title, className }: StatePillProps) {
  const glyph = icon === false || dot ? null : (icon ?? TONE_ICON[tone]);
  return (
    <span
      title={title}
      data-tone={tone}
      className={cn(
        'inline-flex shrink-0 items-center rounded-sm leading-none font-bold whitespace-nowrap',
        PILL_SIZE[size],
        dashed ? TONE_DASHED[tone] : TONE_BADGE[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden className={cn('size-2 shrink-0 rounded-full', TONE_DOT[tone])} /> : null}
      {glyph ? <Icon name={glyph} size="xs" /> : null}
      {label}
    </span>
  );
}

export interface CountBadgeProps {
  count: number;
  /** brand: must act (Triage, Agents waiting, Outbox) · risk: overdue/broken · neutral: reading (Briefs). */
  tone?: 'brand' | 'risk' | 'neutral';
  max?: number;
  className?: string;
  label?: string;
}

export function CountBadge({ count, tone = 'brand', max = 99, className, label }: CountBadgeProps) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={label ?? `${count}`}
      className={cn(
        'inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-micro leading-none font-bold tabular-nums',
        tone === 'brand' && 'bg-accent text-on-accent',
        tone === 'risk' && 'bg-danger-600 text-on-solid',
        tone === 'neutral' && 'bg-surface-sunken text-fg',
        className,
      )}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}

export interface EyebrowProps {
  children: ReactNode;
  count?: number | string;
  as?: ElementType;
  tone?: 'muted' | 'brand' | 'ai' | 'warn' | 'risk';
  className?: string;
  id?: string;
}

/** A sentence-case section label ("Waiting on you  2"): 14 px bold, muted. No ALL-CAPS in v2. */
export function Eyebrow({ children, count, as: Tag = 'span', tone = 'muted', className, id }: EyebrowProps) {
  return (
    <Tag
      id={id}
      className={cn(
        'eyebrow inline-flex items-center gap-1.5',
        tone === 'brand' && 'text-link',
        tone === 'ai' && 'text-ai-700',
        tone === 'warn' && 'text-warning-700',
        tone === 'risk' && 'text-danger-700',
        className,
      )}
    >
      {children}
      {count !== undefined ? <span className="font-normal text-muted tabular-nums">{count}</span> : null}
    </Tag>
  );
}

export type ConfidenceValue = 'sure' | 'likely' | 'guess';

const CONFIDENCE: Record<ConfidenceValue, { label: string; cls: string; hint: string }> = {
  sure: { label: 'Sure', cls: 'text-success-700', hint: 'Strong evidence from the source' },
  likely: { label: 'Likely', cls: 'text-muted', hint: 'Good evidence; check before it leaves the machine' },
  guess: { label: 'Guess', cls: 'text-warning-700 underline decoration-dashed decoration-1 underline-offset-2', hint: 'Weak evidence; stays in Triage until you confirm' },
};

/** Categorical confidence: a word, never a percentage (UI-SPEC §1.4). Green only when it's sure, amber when it's a guess. */
export function ConfidenceWord({ value, className }: { value: ConfidenceValue; className?: string }) {
  const c = CONFIDENCE[value];
  return (
    <span title={c.hint} className={cn('text-caption font-bold whitespace-nowrap', c.cls, className)}>
      {c.label}
    </span>
  );
}

export interface EffortSplitProps {
  youMin: number;
  agentMin?: number | null;
  className?: string;
  /** Drop the "in background" tail where space is tight. */
  compact?: boolean;
}

/**
 * "you ~20m · ✦ agent ~20m in background": hands-on minutes and agent minutes, never summed (UI-SPEC §1.8,
 * DESIGN-V2 capacity). Agent time runs in parallel, so it reads as a background lane, not load.
 */
export function EffortSplit({ youMin, agentMin, className, compact }: EffortSplitProps) {
  return (
    <span className={cn('inline-flex items-baseline gap-1.5 text-caption whitespace-nowrap text-muted tabular-nums', className)}>
      <span>
        you <span className="font-bold text-fg">~{fmtMinutes(youMin)}</span>
      </span>
      {agentMin ? (
        <>
          <span aria-hidden>·</span>
          <span>
            <span aria-hidden className="text-ai-700">
              ✦{' '}
            </span>
            agent <span className="font-bold text-fg">~{fmtMinutes(agentMin)}</span>
            {compact ? null : ' in background'}
          </span>
        </>
      ) : null}
    </span>
  );
}
