'use client';
/**
 * v1 right-rail compatibility. The rail is gone (DESIGN-V2: one docked right panel, see RightPanel.tsx);
 * AssistantTile stays because the primitives kit still renders it.
 */
import { cn } from '@/ui/cn';
import { Icon } from '@/ui/Icon';

/** Assistant identity tile: the one bg-agentic element. */
export function AssistantTile({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <span className={cn('grid shrink-0 place-items-center rounded-full bg-agentic', size === 'md' ? 'size-7' : 'size-5')}>
      <Icon name="sparkles" size={size === 'md' ? 'md' : 'xs'} className="text-white" />
    </span>
  );
}
