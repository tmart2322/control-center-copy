/** Stand-in for `@/ui` Kbd: a small mono key hint (UI-SPEC §5.3 KbdHint). */
import type { ReactNode } from 'react';
import { cx } from './cx';

export interface KbdProps {
  children: ReactNode;
  /** `inverse` sits on solid brand or dark surfaces. */
  tone?: 'default' | 'inverse';
  className?: string;
}

export function Kbd({ children, tone = 'default', className }: KbdProps) {
  return (
    <kbd
      className={cx(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-sm px-1 font-mono text-micro leading-none tracking-normal',
        tone === 'inverse' ? 'bg-white/20 text-white' : 'border border-line bg-surface-muted text-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
