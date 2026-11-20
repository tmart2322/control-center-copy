'use client';
/**
 * Channel-accurate draft preview, in place (UI-SPEC §5.1, §7). HTML is derived from the serialized payload
 * (LIB-compose renderPreview) and always passes DOMPurify (SafeHtml). Collapsed shows 3 lines; Space or
 * the toggle expands. An AI-drafted region gets the agentic border and ONE sparkle; once the user edits
 * it, the border goes neutral and the glyph becomes "edit" (brief 12 §8.6). DESIGN-V2: the channel is a
 * neutral label, never a source color.
 */
import type { Draft } from '@/contract';
import { useMemo } from 'react';
import { cn, Icon, Kbd } from '@/ui';
import { ActionPreview } from '@/components/composer/ActionPreview';
import { SafeHtml } from './lib';
import { destinationLabel, draftPreviewHtml } from './derive';

const SLACK_BODY =
  'text-body-lg text-fg [&_p]:m-0 [&_ul]:my-0.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_.cc-mention]:rounded-sm [&_.cc-mention]:bg-info-50 [&_.cc-mention]:px-0.5 [&_.cc-mention]:text-info-700 [&_.cc-quote]:border-l-4 [&_.cc-quote]:border-line-strong [&_.cc-quote]:pl-2 [&_.cc-code]:rounded-sm [&_.cc-code]:bg-surface-muted [&_.cc-code]:px-1 [&_.cc-code]:font-mono [&_.cc-code]:text-caption [&_.cc-code]:text-danger-700 [&_.cc-pre]:rounded-sm [&_.cc-pre]:bg-surface-muted [&_.cc-pre]:p-2 [&_.cc-pre]:font-mono [&_.cc-pre]:text-caption [&_a]:text-link';
const EMAIL_BODY =
  'font-[Arial,Helvetica,sans-serif] text-body text-fg [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_a]:text-link [&_a]:underline';

export interface DraftPreviewBlockProps {
  draft: Draft;
  /** Override HTML (e.g. a server preview rendition). Still sanitized. */
  html?: string;
  open: boolean;
  onToggle?: () => void;
  className?: string;
}

export function DraftPreviewBlock({ draft, html, open, onToggle, className }: DraftPreviewBlockProps) {
  const previewHtml = useMemo(() => html ?? draftPreviewHtml(draft), [html, draft]);
  const dest = destinationLabel(draft.destination);
  const isSlack = draft.destination.kind === 'slack';
  const touched = draft.userTouched;
  const bodyId = `draft-${draft.id}`;

  return (
    <div className={cn('rounded-md p-3', touched ? 'border border-line bg-surface' : 'border-agentic', className)}>
      <div className="mb-1.5 flex items-center gap-2">
        {touched ? <Icon name="edit" size="xs" className="text-faint" /> : <span aria-hidden className="text-caption text-ai-700">✦</span>}
        <span className={cn('text-caption font-bold', touched ? 'text-fg' : 'text-ai-700')}>{touched ? 'Your draft' : 'Draft'}</span>
        <span className="inline-flex min-w-0 items-center gap-1.5 text-caption text-muted">
          <Icon name={dest.icon} size="xs" className="text-faint" />
          <span className="font-bold text-fg">{dest.channel}</span>
          <span className="truncate">· {dest.detail}</span>
        </span>
        {draft.destination.kind === 'email' ? <span className="hidden truncate text-caption text-muted @lg:inline">· {draft.destination.subject}</span> : null}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.();
          }}
          className="ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-1.5 text-caption text-muted hover:bg-surface-muted hover:text-fg"
        >
          <Kbd>Space</Kbd>
          <Icon name={open ? 'chevronup' : 'chevrondown'} size="xs" />
        </button>
      </div>
      {draft.destination.kind === 'action' ? (
        <div id={bodyId} className={cn('max-w-[68ch] overflow-hidden', open ? 'max-h-none' : 'max-h-[9rem]')}>
          <ActionPreview destination={draft.destination} bare />
        </div>
      ) : (
      <SafeHtml
        id={bodyId}
        html={previewHtml}
        className={cn(
          'max-w-[68ch] overflow-hidden',
          isSlack ? SLACK_BODY : EMAIL_BODY,
          !isSlack && (open ? '[&_p]:mb-3 [&_p:last-child]:mb-0' : '[&_p]:m-0'),
          open ? 'max-h-none' : isSlack ? 'max-h-[5.25rem]' : 'max-h-[4.5rem]',
        )}
      />
      )}
    </div>
  );
}
