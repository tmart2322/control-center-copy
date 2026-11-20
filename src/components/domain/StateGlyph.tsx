/** Work-item state glyph for dense rows (UI-SPEC §11 vocabulary). */
import type { WorkState } from '@/contract';
import { cn, Icon } from '@/ui';
import { RunGlyph } from './RunGlyph';

const TITLE: Record<WorkState, string> = {
  suggested: 'Suggested',
  open: 'Open',
  in_progress: 'In progress',
  waiting_on_me: 'Waiting on you',
  waiting_on_others: 'Waiting on others',
  likely_done: 'Likely done',
  done: 'Done',
  reopened: 'Reopened',
  snoozed: 'Snoozed',
  dismissed: 'Dismissed',
};

export function StateGlyph({ state, size = 14, className }: { state: WorkState; size?: number; className?: string }) {
  const box = cn('inline-grid shrink-0 place-items-center', className);
  const s = { width: size, height: size };
  const iconSize = size <= 12 ? 'xs' : size <= 14 ? 'sm' : size <= 16 ? 'md' : 'lg';
  switch (state) {
    case 'open':
      return (
        <span className={box} style={s} title={TITLE[state]}>
          <svg viewBox="0 0 16 16" {...s} className="text-faint" aria-hidden>
            <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </span>
      );
    case 'suggested':
    case 'likely_done':
      return (
        <span className={box} style={s} title={TITLE[state]}>
          <svg viewBox="0 0 16 16" {...s} className="text-ai-700" aria-hidden>
            <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.2 1.8" />
            {state === 'likely_done' ? <path d="M5.4 8.2 7.3 10 10.8 6.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /> : null}
          </svg>
        </span>
      );
    case 'in_progress':
      // Your own work in progress: the "now" accent, not the agent violet RunGlyph uses for running runs.
      return (
        <span className={box} style={s} title={TITLE[state]}>
          <svg viewBox="0 0 16 16" {...s} className="text-link" aria-hidden>
            <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 2.5a5.5 5.5 0 0 1 0 11Z" fill="currentColor" />
          </svg>
        </span>
      );
    case 'waiting_on_me':
      return <RunGlyph state="waiting_on_you" size={size} className={className} />;
    case 'done':
      return <RunGlyph state="done" size={size} className={className} />;
    case 'waiting_on_others':
      return <Icon name="away" size={iconSize} className={cn('text-muted', className)} title={TITLE[state]} />;
    case 'reopened':
      return <Icon name="rotate" size={iconSize} className={cn('text-warning-500', className)} title={TITLE[state]} />;
    case 'snoozed':
      return <Icon name="clock" size={iconSize} className={cn('text-muted', className)} title={TITLE[state]} />;
    case 'dismissed':
      return <Icon name="ban" size={iconSize} className={cn('text-faint', className)} title={TITLE[state]} />;
  }
}
