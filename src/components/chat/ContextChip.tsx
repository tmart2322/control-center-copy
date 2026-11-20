/**
 * Chat context chip: a thin wrapper over `@/ui` ContextChip. `@/ui`'s chip takes a letter-avatar kind or an
 * icon; chat carries contract entity types and a provenance ("In view" = attached from what's on screen,
 * dashed; explicit = added with @), so this maps type → icon and marks the auto chip.
 */
import { ContextChip as UiContextChip } from '@/ui';

export interface ContextChipProps {
  label: string;
  /** A contract EntityType. */
  kind?: string;
  via?: 'auto' | 'explicit';
  onRemove?: () => void;
  className?: string;
}

const KIND_ICON: Record<string, string> = {
  work_item: 'task',
  account: 'account',
  opportunity: 'opportunity',
  person: 'user',
  initiative: 'flow',
  agent_run: 'agent_session',
  asset: 'file',
  calendar_event: 'event',
  brief: 'summary',
  draft: 'email',
  policy: 'priority',
};

export function ContextChip({ label, kind, via = 'explicit', onRemove, className }: ContextChipProps) {
  const auto = via === 'auto';
  return (
    <span title={auto ? `In view: ${label}. Sent with your message.` : label} className="inline-flex min-w-0 max-w-full">
      <UiContextChip
        label={auto ? `In view: ${label}` : label}
        icon={KIND_ICON[kind ?? ''] ?? 'pin'}
        onRemove={onRemove}
        className={`${auto ? 'border-dashed text-muted' : ''} ${className ?? ''}`}
      />
    </span>
  );
}
