'use client';
/**
 * Stand-in for `@/ui` Button (FE-1a): Cosmos pill buttons (brief 12 §8.6).
 * One `primary` per card or view.
 */
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from './cx';
import { Kbd } from './Kbd';

export type ButtonVariant = 'primary' | 'neutral' | 'ghost' | 'destructive' | 'inverse';
export type ButtonSize = 'sm' | 'md' | 'icon' | 'icon-sm';

export interface ButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shortcut hint rendered inside the button, e.g. "⌘↵". */
  kbd?: string;
  loading?: boolean;
  children?: ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 hover:-translate-y-0.5 hover:shadow-[0_2px_0_0_var(--color-brand-900)] disabled:bg-ink-200 disabled:text-muted disabled:hover:translate-y-0 disabled:hover:shadow-none',
  neutral: 'border border-line-input bg-surface text-brand-700 hover:bg-brand-50 disabled:border-line disabled:text-ink-400 disabled:hover:bg-surface',
  ghost: 'text-brand-700 hover:bg-brand-50 disabled:text-ink-400 disabled:hover:bg-transparent',
  destructive: 'bg-danger-700 text-white hover:bg-danger-600 disabled:bg-ink-200 disabled:text-muted',
  inverse: 'text-white hover:bg-white/15 disabled:text-white/50',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-3 text-caption',
  md: 'h-8 gap-2 px-4 text-body',
  icon: 'size-8 justify-center',
  'icon-sm': 'size-7 justify-center',
};

export function Button({ variant = 'neutral', size = 'md', kbd, loading = false, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex shrink-0 select-none items-center rounded-full whitespace-nowrap transition duration-(--dur-quick) focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" /> : null}
      {children}
      {kbd ? (
        <Kbd tone={variant === 'primary' || variant === 'destructive' || variant === 'inverse' ? 'inverse' : 'default'} className="ml-0.5">
          {kbd}
        </Kbd>
      ) : null}
    </button>
  );
}
