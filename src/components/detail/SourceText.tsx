'use client';
/**
 * A source text (an evidence excerpt, the why line) as its source shows it: Slack mrkdwn with bold, links, code,
 * lists, quotes and mentions by name ("@Dana Reyes"; an id nobody knows reads "@someone"), an HTML email through the
 * allowlist sanitizer, plain text with its paragraphs and links. Rendered by the compose library's `renderSourceBody`
 * (allowlist-sanitized, never raw HTML), then DOMPurify right before injection, the same two gates as the Outbox's
 * "Replying to" block. The texts arrive redacted (the server redacts them again before they leave).
 *
 * A long body folds to a few lines with "Show all", so one email does not push the rest of the timeline away.
 */
import { useId, useMemo, useState } from 'react';
import { renderSourceBody, type SourceBodyFormat } from '@/lib/compose';
import { purify } from '@/components/composer/preview';
import { SLACK_BODY_RULES } from '@/components/composer/styles';
import { cn } from '@/ui';

/** Sanitized-email structure (blockquotes without the Slack class, plain lists) on top of the Slack rules. */
const EMAIL_RULES = [
  '[&_p+blockquote]:mt-2 [&_blockquote+p]:mt-2',
  '[&_blockquote]:border-l-[3px] [&_blockquote]:border-line-strong [&_blockquote]:pl-3',
  '[&_a]:underline [&_a]:underline-offset-2',
].join(' ');

/** Past this a body folds (the "Replying to" block's thresholds). */
const isLong = (text: string) => text.length > 700 || text.split('\n').length > 12;

export interface SourceTextProps {
  text: string;
  format: SourceBodyFormat;
  /** Slack user id → name (the payload's `mentions`). */
  mentions?: Record<string, string>;
  /** Fold a long body behind "Show all". */
  fold?: boolean;
  className?: string;
}

export function SourceText({ text, format, mentions, fold, className }: SourceTextProps) {
  const html = useMemo(() => purify(renderSourceBody(text, format, { labels: mentions }).html), [text, format, mentions]);
  const [all, setAll] = useState(false);
  const id = useId();
  const long = !!fold && isLong(text);
  if (!html) return null;
  return (
    <>
      <div
        id={id}
        data-source-text={format}
        className={cn('min-w-0', SLACK_BODY_RULES, format === 'html' && EMAIL_RULES, long && !all && 'max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]', className)}
        // renderSourceBody allowlist-sanitized it; DOMPurify is the last gate before injection.
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {long ? (
        <button
          type="button"
          aria-expanded={all}
          aria-controls={id}
          onClick={() => setAll((v) => !v)}
          className="mt-1 rounded-sm text-caption font-bold text-link hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {all ? 'Show less' : 'Show all'}
        </button>
      ) : null}
    </>
  );
}
