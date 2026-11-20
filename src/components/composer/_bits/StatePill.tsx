/** Stand-in for `@/ui` StatePill: a non-interactive status badge (UI-SPEC §5.3, brief 12 §8.6). */
import type { ReactNode } from 'react';
import type { Tone } from '@/contract';
import { cx } from './cx';
import { Icon } from './Icon';

export interface StatePillProps {
  tone?: Tone;
  /** Dashed treatment for suggestions and pending items (UI-SPEC §1.4). */
  dashed?: boolean;
  icon?: string;
  children: ReactNode;
  className?: string;
  title?: string;
}

const TONE: Record<Tone, string> = {
  ok: 'bg-success-50 text-success-700',
  warn: 'bg-warning-50 text-warning-700',
  risk: 'bg-danger-50 text-danger-700',
  brand: 'bg-brand-50 text-brand-800',
  neutral: 'bg-surface-sunken text-fg',
  ai: 'bg-ai-50 text-ai-700',
};

export function StatePill({ tone = 'neutral', dashed, icon, children, className, title }: StatePillProps) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-px text-caption whitespace-nowrap',
        TONE[tone],
        dashed && 'border border-dashed border-current',
        className,
      )}
    >
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}
