import { cn } from './cn';

const SIZE = { xs: 'size-3', sm: 'size-3.5', md: 'size-4', lg: 'size-5' } as const;

/** A quiet ring spinner (used inside buttons and InlineStatus only; panels use Skeleton). */
export function Spinner({ size = 'md', className, label }: { size?: keyof typeof SIZE; className?: string; label?: string }) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('inline-block shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent opacity-80', SIZE[size], className)}
    />
  );
}
