'use client';
/**
 * The last few messages of the thread being answered, above the editor (the full composer). Each message is rendered
 * from its text as the source shows it (Slack mrkdwn: bold, links, mentions by name; email: plain text) by the compose
 * library's `renderSourceBody` (allowlist-sanitized), then DOMPurify right before injection.
 */
import { useMemo, useState } from 'react';
import type { ThreadMessage } from '@/contract';
import { renderSourceBody } from '@/lib/compose';
import { cx } from './_bits';
import { purify } from './preview';
import { SLACK_BODY } from './styles';

export interface ThreadContextProps {
  messages: ThreadMessage[];
  channelLabel: string;
  timezone?: string;
  /** How many of the latest messages show before "Show earlier" (3–5). */
  visible?: number;
  /** How the texts are written: Slack mrkdwn (default) or plain email text. */
  format?: 'slack_mrkdwn' | 'plain';
  /** Slack id → name, for mentions. */
  labels?: Record<string, string>;
  className?: string;
}

function MessageText({ text, format, labels }: { text: string; format: 'slack_mrkdwn' | 'plain'; labels?: Record<string, string> }) {
  const html = useMemo(() => purify(renderSourceBody(text, format, { labels }).html), [text, format, labels]);
  return <div className={cx(SLACK_BODY, 'text-body')} dangerouslySetInnerHTML={{ __html: html }} />;
}

function fmtTime(iso: string, tz?: string): string {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

export function ThreadContext({ messages, channelLabel, timezone, visible = 3, format = 'slack_mrkdwn', labels, className }: ThreadContextProps) {
  const [expanded, setExpanded] = useState(false);
  if (!messages.length) return null;
  const sorted = [...messages].sort((a, b) => a.at.localeCompare(b.at));
  const cap = Math.min(Math.max(visible, 3), 5);
  const shown = expanded ? sorted.slice(-5) : sorted.slice(-cap);
  const hidden = Math.min(sorted.length, 5) - shown.length;

  return (
    <section aria-label={`Recent messages in ${channelLabel}`} className={cx('border-b border-line bg-surface-muted px-4 py-2.5', className)}>
      <div className="mb-1.5 flex items-center gap-2 text-caption text-muted">
        <span>
          Replying in <span className="text-fg">{channelLabel}</span> · last {shown.length} of {sorted.length}
        </span>
        {hidden > 0 || expanded ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="ml-auto text-link hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {expanded ? 'Show fewer' : `Show ${hidden} earlier`}
          </button>
        ) : null}
      </div>
      <ol className="space-y-1.5">
        {shown.map((m) => (
          <li key={m.id} className="flex gap-2">
            <span
              aria-hidden
              className={cx(
                'mt-0.5 grid size-5 shrink-0 place-items-center rounded-sm text-micro font-bold',
                m.isMe ? 'bg-selected text-fg-heading' : 'bg-surface-sunken text-fg', // people are neutral (DESIGN-V2: color = indicator)
              )}
            >
              {m.author.name.charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline gap-1.5 text-caption">
                <span className="font-bold text-fg">{m.isMe ? 'You' : m.author.name}</span>
                {m.author.role && !m.isMe ? <span className="truncate text-muted">{m.author.role}</span> : null}
                <span className="ml-auto shrink-0 text-faint tabular-nums">{fmtTime(m.at, timezone)}</span>
              </p>
              <MessageText text={m.text} format={format} labels={labels} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
