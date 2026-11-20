'use client';
/**
 * AI rewrite chips: Shorter · More formal · Add detail · Regenerate (POST /nba/:id/regenerate).
 * An untouched draft is rewritten in place; a touched one gets a proposal (Apply / Keep mine).
 * ⌘/ focuses the first chip; arrow keys move between them.
 */
import { useRef, type KeyboardEvent, type Ref } from 'react';
import type { RegenerateNbaRequest } from '@/contract';
import { Icon, Kbd } from '@/ui';
import { Tooltip, cx } from './_bits';

export type RewriteInstruction = RegenerateNbaRequest['instruction'];

export const REWRITES: Array<{ id: RewriteInstruction; label: string }> = [
  { id: 'shorter', label: 'Shorter' },
  { id: 'more_formal', label: 'More formal' },
  { id: 'add_detail', label: 'Add detail' },
  { id: 'regenerate', label: 'Regenerate' },
];

export interface AiChipsProps {
  pending: RewriteInstruction | null;
  onRewrite: (i: RewriteInstruction) => void;
  disabled?: boolean;
  disabledReason?: string;
  error?: string | null;
  onRetry?: () => void;
  firstRef?: Ref<HTMLButtonElement>;
  compact?: boolean;
}

export function AiChips({ pending, onRewrite, disabled, disabledReason, error, onRetry, firstRef, compact }: AiChipsProps) {
  const group = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const btns = [...(group.current?.querySelectorAll<HTMLButtonElement>('button[data-chip]') ?? [])];
    const i = btns.indexOf(e.currentTarget);
    btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length]?.focus();
  };
  return (
    <div ref={group} role="group" aria-label="Rewrite with AI" className="flex min-h-8 flex-wrap items-center gap-1.5 px-3 py-1">
      <span className="mr-0.5 text-caption text-ai-700">Rewrite</span>
      {REWRITES.map((r, i) => {
        const chip = (
          <button
            key={r.id}
            ref={i === 0 ? firstRef : undefined}
            data-chip
            type="button"
            disabled={disabled || (pending != null && pending !== r.id)}
            aria-busy={pending === r.id || undefined}
            onClick={() => onRewrite(r.id)}
            onKeyDown={onKey}
            className={cx(
              // One class per property and state: the pending chip and the resting chip don't share colors.
              'inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-caption transition-colors duration-(--dur-quick)',
              'focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed',
              pending === r.id ? 'border-ai-200 bg-ai-50 text-ai-700' : 'border-line text-fg enabled:hover:border-ai-200 enabled:hover:bg-ai-50 disabled:text-disabled',
            )}
          >
            {pending === r.id ? <span aria-hidden className="size-2.5 animate-spin rounded-full border-[1.5px] border-current border-r-transparent" /> : null}
            {r.label}
          </button>
        );
        return disabled && disabledReason ? (
          <Tooltip key={r.id} content={disabledReason}>
            {chip}
          </Tooltip>
        ) : (
          chip
        );
      })}
      {error ? (
        <span role="status" className="inline-flex items-center gap-1 text-caption text-danger-700">
          <Icon name="error" size="xs" />
          {error}
          {onRetry ? (
            <button type="button" onClick={onRetry} className="font-bold hover:underline">
              Retry
            </button>
          ) : null}
        </span>
      ) : null}
      {!compact ? (
        <span className="ml-auto hidden items-center gap-1 text-caption text-faint @[34rem]:inline-flex">
          <Kbd>⌘/</Kbd>
        </span>
      ) : null}
    </div>
  );
}
