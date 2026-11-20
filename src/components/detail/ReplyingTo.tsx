'use client';
/**
 * "Replying to": the message a draft answers, at the top of the draft panel and in an Outbox row's preview, so you
 * can read it without opening Slack or Gmail, and open it there in one click (tenets: Provenance on everything;
 * Every handoff is one click away).
 *
 *   Replying to Dana Reyes in #acme-ext · Today 07:55 ··················· ↗ Open in Slack
 *   the message as Slack shows it: bold, links, @mentions by name, code, lists
 *   ▸ 2 earlier messages
 *
 * An email shows its subject, sender, recipients and date, then the body. A new message (a channel post, a new
 * email) shows the work item's origin message as "Source". The body is GET /drafts/:id/source's `html` (rendered
 * and allowlist-sanitized by the server), run through DOMPurify right before injection. After the 90-day purge the
 * evidence line stands in, with the link. Neutral surfaces: people and sources carry no colour (DESIGN-V2).
 */
import { useId, useState } from 'react';
import type { DraftSource, SourceMessage } from '@/contract';
import { useApi } from '@/client/hooks';
import { purify } from '@/components/composer/preview';
import { SLACK_BODY } from '@/components/composer/styles';
import { useClock } from '@/components/domain/lib/clock';
import { openInLabel } from '@/components/domain/lib/source-link';
import { cn, Icon, Skeleton } from '@/ui';
import { fmtWhen } from './lib/tz';

export interface ReplyingToProps {
  draftId: string;
  className?: string;
  /** Tighter padding (an Outbox row's expansion). */
  compact?: boolean;
}

/** Fetches the draft's source and shows it; nothing at all for an admin item or a draft with no source. */
export function ReplyingTo({ draftId, className, compact }: ReplyingToProps) {
  const q = useApi('getDraftSource', { params: { id: draftId } });
  if (q.isLoading)
    return (
      <div className={cn('space-y-2 rounded-lg border border-line bg-surface-muted px-4 py-3', className)} aria-busy aria-label="Loading the message this replies to">
        <Skeleton variant="line" className="w-56" />
        <Skeleton variant="line" className="w-3/4" />
      </div>
    );
  if (q.error && !q.data)
    return (
      <p role="status" className={cn('flex flex-wrap items-center gap-x-2 text-caption text-muted', className)} data-replying-to="error">
        The message this replies to failed to load.
        <button type="button" onClick={() => void q.refetch()} className="rounded-sm font-bold text-link hover:underline focus-visible:shadow-focus focus-visible:outline-none">
          Retry
        </button>
      </p>
    );
  if (!q.data) return null;
  return <ReplyingToView source={q.data} className={className} compact={compact} />;
}

const appOf = (kind: DraftSource['kind']) => (kind === 'gmail' ? 'Gmail' : 'Slack');

/** An email body (plain text or sanitized HTML): reading text, paragraphs spaced, quoted history muted. */
const EMAIL_SOURCE_BODY = [
  'text-body text-fg break-words',
  '[&_p]:my-0 [&_p+p]:mt-2 [&_p+blockquote]:mt-2 [&_blockquote+p]:mt-2',
  '[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-6',
  '[&_blockquote]:border-l-[3px] [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted',
  '[&_.cc-code]:rounded-sm [&_.cc-code]:bg-surface-sunken [&_.cc-code]:px-1 [&_.cc-code]:font-mono [&_.cc-code]:text-caption',
  '[&_a]:text-link [&_a]:underline [&_a]:underline-offset-2',
].join(' ');

function who(m: SourceMessage | null): string {
  if (!m) return 'a message';
  if (m.isMe) return 'you';
  return m.author ?? 'a message';
}

/** "Replying to Dana Reyes in #acme-ext" · "Source: you in #acme-ext" · "Replying to Marcus Webb". */
export function replyingToLine(s: DraftSource): { lead: string; who: string; where: string | null } {
  const lead = s.relation === 'reply' ? 'Replying to' : 'Source:';
  const where = s.kind === 'slack' ? s.where : null;
  return { lead, who: who(s.message), where };
}

export function ReplyingToView({ source, className, compact }: { source: DraftSource; className?: string; compact?: boolean }) {
  const { now, tz } = useClock();
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (!source.kind || (!source.message && !source.url)) return null;
  const m = source.message;
  const line = replyingToLine(source);
  const app = appOf(source.kind);
  const label = `${line.lead.replace(/:$/, '')} ${line.who}${line.where ? ` in ${line.where}` : ''}`;
  const earlierHidden = source.earlierTotal - source.earlier.length;
  return (
    <section
      aria-label={label}
      data-replying-to={source.relation}
      data-kind={source.kind}
      className={cn('min-w-0 rounded-lg border border-line bg-surface-muted', compact ? 'px-3 py-2.5' : 'px-4 py-3', className)}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
        <span className="min-w-0">
          {line.lead} <b className="font-bold text-fg">{line.who === 'you' ? 'You' : line.who}</b>
          {line.where ? (
            <>
              {' '}
              in <span className="text-fg">{line.where}</span>
            </>
          ) : null}
          {m ? (
            <>
              {' · '}
              <time dateTime={m.at} className="tabular-nums">
                {fmtWhen(m.at, now, tz, { today: true })}
              </time>
            </>
          ) : null}
        </span>
        {source.url ? (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="open-source"
            title={`${openInLabel(source.kind)}: the original ${source.kind === 'gmail' ? 'email' : 'message'}`}
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-sm font-bold text-link hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            <Icon name="new_window" size="xs" />
            {openInLabel(source.kind)}
          </a>
        ) : null}
      </header>
      {m ? <MessageBody m={m} kind={source.kind} app={app} className="mt-2" /> : <p className="mt-1.5 text-body text-muted">The message itself is not stored here. Open it in {app} to read it.</p>}
      {source.earlier.length ? (
        <div className="mt-2.5 border-t border-line pt-2">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((v) => !v)}
            data-testid="earlier-toggle"
            className="inline-flex items-center gap-1 rounded-sm text-caption font-bold text-link hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            <Icon name={open ? 'chevrondown' : 'chevronright'} size="xs" />
            {open ? 'Hide' : 'Show'} {source.earlier.length} earlier {source.earlier.length === 1 ? 'message' : 'messages'}
            {earlierHidden > 0 ? <span className="font-normal text-muted"> (of {source.earlierTotal})</span> : null}
          </button>
          {open ? (
            <ol id={listId} className="mt-2 space-y-3" data-testid="earlier-messages">
              {source.earlier.map((e) => (
                <li key={e.id} className="min-w-0">
                  <p className="flex items-baseline gap-1.5 text-caption">
                    <span className="font-bold text-fg">{e.isMe ? 'You' : (e.author ?? 'Someone')}</span>
                    <time dateTime={e.at} className="text-muted tabular-nums">
                      {fmtWhen(e.at, now, tz, { today: true })}
                    </time>
                  </p>
                  <MessageBody m={e} kind={source.kind!} app={app} className="mt-0.5" />
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** A body this long folds to ~10 lines with "Show all", so the draft below stays in view. */
const isLong = (m: SourceMessage) => m.text.length > 700 || m.text.split('\n').length > 12;

function MessageBody({ m, kind, app, className }: { m: SourceMessage; kind: 'slack' | 'gmail'; app: string; className?: string }) {
  const email = kind === 'gmail';
  const long = isLong(m);
  const [all, setAll] = useState(false);
  const bodyId = useId();
  return (
    <div className={cn('min-w-0', className)}>
      {email && (m.subject || m.from || m.to) ? (
        <dl className="mb-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-caption" data-testid="email-headers">
          {m.subject ? (
            <>
              <dt className="text-muted">Subject</dt>
              <dd className="truncate font-bold text-fg">{m.subject}</dd>
            </>
          ) : null}
          {m.from || m.author ? (
            <>
              <dt className="text-muted">From</dt>
              <dd className="truncate text-fg">{m.from ?? (m.isMe ? 'You' : m.author)}</dd>
            </>
          ) : null}
          {m.to ? (
            <>
              <dt className="text-muted">To</dt>
              <dd className="truncate text-fg">{m.to}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {m.html ? (
        <div
          id={bodyId}
          data-testid="source-body"
          data-body={m.body}
          className={cn('max-w-[68ch]', email ? EMAIL_SOURCE_BODY : SLACK_BODY, m.body !== 'full' && 'text-muted italic', long && !all && 'max-h-60 overflow-hidden [mask-image:linear-gradient(to_bottom,black_75%,transparent)]')}
          // The server rendered and allowlist-sanitized it; DOMPurify is the last gate before injection.
          dangerouslySetInnerHTML={{ __html: purify(m.html) }}
        />
      ) : null}
      {m.html && long ? (
        <button
          type="button"
          aria-expanded={all}
          aria-controls={bodyId}
          onClick={() => setAll((v) => !v)}
          className="mt-1 rounded-sm text-caption font-bold text-link hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {all ? 'Show less' : 'Show all'}
        </button>
      ) : null}
      {m.body === 'purged' ? (
        <p className="mt-1 text-caption text-muted" data-testid="source-purged">
          The full text was cleared after 90 days, as every stored message is. Open it in {app} to read it all.
        </p>
      ) : null}
    </div>
  );
}
