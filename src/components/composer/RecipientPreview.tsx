'use client';
/**
 * "Preview as recipient": the message as Slack or Gmail would show it, rendered from the SERIALIZED PAYLOAD
 * (client `payloadFor` via `renderPreview`, or the server's preview payload) and passed through DOMPurify
 * right before injection. Never rendered from the editor DOM.
 */
import { useMemo } from 'react';
import type { Destination, DraftPreview } from '@/contract';
import type { DocNode } from '@/lib/compose';
import { cx } from './_bits';
import { previewHtml, serverPreviewHtml } from './preview';
import { EMAIL_BODY, SLACK_BODY } from './styles';
import { ActionPreview } from './ActionPreview';

interface Common {
  destination: Destination;
  senderName?: string;
  senderEmail?: string;
  /** Mention id → display name (payloads carry ids only). */
  labels?: Record<string, string>;
  /** Clock label shown in the header ("2:04 PM"). */
  timeLabel?: string;
  className?: string;
  /** Hide the frame header (used inside the confirm dialog). */
  bare?: boolean;
}

export type RecipientPreviewProps = Common & ({ doc: DocNode; preview?: undefined } | { preview: DraftPreview; doc?: undefined });

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export function RecipientPreview(props: RecipientPreviewProps) {
  const { destination, senderName = 'You', senderEmail, labels, timeLabel = 'now', className, bare } = props;
  const docOrPreview = props.preview ?? props.doc;
  const html = useMemo(
    () => (props.preview ? serverPreviewHtml(props.preview, labels) : previewHtml(props.doc as DocNode, destination, labels)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docOrPreview, destination, labels],
  );

  // A structured action has no recipient: the one action preview (changes, target, long text).
  if (destination.kind === 'action') return <ActionPreview destination={destination} className={className} bare={bare} />;

  if (destination.kind === 'slack') {
    const where = destination.target === 'dm' ? `Direct message with ${destination.channelName.replace(/^@/, '')}` : destination.channelName;
    return (
      <figure data-testid="recipient-preview" data-channel="slack" className={cx('overflow-hidden rounded-md border border-line bg-surface', className)}>
        {!bare ? (
          <figcaption className="flex h-8 items-center gap-1.5 border-b border-line bg-surface-muted px-3 text-caption text-muted">
            <span className="font-bold text-fg">{where}</span>
            {destination.threadTs ? <span>› Thread</span> : null}
            <span className="ml-auto">As it will appear in Slack</span>
          </figcaption>
        ) : null}
        <div className="flex gap-2.5 px-4 py-3">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-sunken text-caption font-bold text-fg">
            {initials(senderName)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[0.9375rem] font-bold text-fg">{senderName}</span>
              <span className="text-caption text-muted">{timeLabel}</span>
            </div>
            <div className={SLACK_BODY} dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
      </figure>
    );
  }

  const to = destination.to.map((a) => a.name ?? a.email).join(', ');
  const cc = destination.cc.map((a) => a.name ?? a.email).join(', ');
  return (
    <figure data-testid="recipient-preview" data-channel="email" className={cx('overflow-hidden rounded-md border border-line bg-surface', className)}>
      {!bare ? (
        <figcaption className="flex h-8 items-center border-b border-line bg-surface-muted px-3 text-caption text-muted">
          <span className="font-bold text-fg">Gmail</span>
          <span className="ml-auto">As it will appear in the recipient’s inbox</span>
        </figcaption>
      ) : null}
      <div className="px-4 pt-3 pb-4">
        <p className="text-heading text-fg">{destination.subject || '(no subject)'}</p>
        <div className="mt-3 flex gap-3">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-sunken text-caption font-bold text-fg">
            {initials(senderName)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-body-lg font-bold text-fg">{senderName}</span>
              {senderEmail ? <span className="truncate text-caption text-muted">&lt;{senderEmail}&gt;</span> : null}
              <span className="ml-auto shrink-0 text-caption text-muted">{timeLabel}</span>
            </div>
            <p className="truncate text-caption text-muted">
              to {to}
              {cc ? `, cc ${cc}` : ''}
            </p>
            <div className={cx('mt-3', EMAIL_BODY)} dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        </div>
      </div>
    </figure>
  );
}
