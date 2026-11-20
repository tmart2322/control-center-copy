'use client';
/**
 * "✦ Read-in ready" for Home and list rows: reads `item.readInState` (no extra request). Violet = AI made it.
 * Renders nothing unless a read-in is ready or researching, so rows stay quiet.
 */
import type { ReadInState } from '@/contract';
import { cn } from '@/ui';

export interface ReadInBadgeProps {
  state: ReadInState | undefined | null;
  className?: string;
}

export function ReadInBadge({ state, className }: ReadInBadgeProps) {
  if (state !== 'ready' && state !== 'researching') return null;
  return (
    <span className={cn('inline-flex items-center gap-1 text-caption font-bold text-ai-700', className)} data-readin-badge={state}>
      <span aria-hidden>✦</span>
      {state === 'ready' ? 'Read-in ready' : 'Reading in…'}
    </span>
  );
}
