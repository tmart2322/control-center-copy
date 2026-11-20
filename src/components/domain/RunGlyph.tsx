/**
 * Agent/run state glyphs, exactly UI-SPEC §12: queued ○ · running ◐ (violet: the agent is working) · waiting_on_you ⏸ (warning) ·
 * done_review ● (accent: your one action) · done ✓ (success) · failed ✕ (danger) · stale ☾. Design v2: color is the state. Drawn as SVG so they render crisply in
 * Salesforce Sans (which lacks these code points).
 */
import type { RunState } from '@/contract';
import { cn } from '@/ui';

const TONE: Record<RunState, string> = {
  queued: 'text-muted',
  running: 'text-ai-500',
  waiting_on_you: 'text-warning-500',
  done_review: 'text-accent',
  done: 'text-success-500',
  failed: 'text-danger-500',
  stale: 'text-faint',
};

const LABEL: Record<RunState, string> = {
  queued: 'Queued',
  running: 'Running',
  waiting_on_you: 'Waiting on you',
  done_review: 'Done, review',
  done: 'Done',
  failed: 'Failed',
  stale: 'Stale',
};

export function RunGlyph({ state, size = 14, className }: { state: RunState; size?: number; className?: string }) {
  const s = { width: size, height: size };
  const common = { viewBox: '0 0 16 16', 'aria-label': LABEL[state], role: 'img' as const, className: cn('shrink-0', TONE[state], className), ...s };
  switch (state) {
    case 'queued':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case 'running':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 2.5a5.5 5.5 0 0 1 0 11Z" fill="currentColor" />
        </svg>
      );
    case 'waiting_on_you':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.5" fill="currentColor" />
          <rect x="5.6" y="5" width="1.6" height="6" rx="0.4" className="fill-surface" />
          <rect x="8.8" y="5" width="1.6" height="6" rx="0.4" className="fill-surface" />
        </svg>
      );
    case 'done_review':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5" fill="currentColor" />
        </svg>
      );
    case 'done':
      return (
        <svg {...common}>
          <path d="M3.2 8.4 6.5 11.6 12.8 4.6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'failed':
      return (
        <svg {...common}>
          <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      );
    case 'stale':
      return (
        <svg {...common}>
          <path d="M10.6 1.8a6.4 6.4 0 1 0 3.9 9A5.2 5.2 0 0 1 10.6 1.8Z" fill="currentColor" />
        </svg>
      );
  }
}
