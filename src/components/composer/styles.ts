/**
 * Class strings for rich content (editor + recipient previews). Written as Tailwind arbitrary variants on the
 * container so they only use brand.css tokens and need no extra stylesheet in globals.css.
 */

/** ProseMirror editor body: reading text at 16/24, ≤ 68ch (DESIGN-V2). Mentions are pills; placeholder via data-placeholder. */
export const EDITOR_PROSE = [
  'cc-editor max-w-[68ch] text-body text-fg outline-none',
  '[&_p]:my-0 [&_p+p]:mt-2',
  '[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_li>p]:my-0',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-[3px] [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted',
  '[&_code]:rounded-sm [&_code]:bg-surface-sunken [&_code]:px-1 [&_code]:font-mono [&_code]:text-caption',
  '[&_pre]:my-2 [&_pre]:rounded-md [&_pre]:border [&_pre]:border-line [&_pre]:bg-surface-muted [&_pre]:px-3 [&_pre]:py-2 [&_pre]:font-mono [&_pre]:text-caption [&_pre]:whitespace-pre-wrap [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-title [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-body-lg',
  '[&_a]:text-link [&_a]:underline [&_a]:underline-offset-2',
  '[&_.cc-pill]:inline-flex [&_.cc-pill]:items-center [&_.cc-pill]:rounded-sm [&_.cc-pill]:bg-info-50 [&_.cc-pill]:px-1 [&_.cc-pill]:text-info-700 [&_.cc-pill]:leading-tight',
  '[&_.cc-pill[data-kind=special]]:bg-warning-50 [&_.cc-pill[data-kind=special]]:text-warning-700',
  '[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-faint [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]',
].join(' ');

/**
 * The structure of rendered Slack text (paragraphs, lists, quotes, code, links, mentions) without its type size and
 * colour, for surfaces that set their own (an evidence excerpt, the why line).
 */
export const SLACK_BODY_RULES = [
  'break-words',
  '[&_p]:my-0 [&_p+p]:mt-1.5 [&_p:empty]:h-2',
  '[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-0',
  '[&_.cc-indent-1]:pl-12 [&_.cc-indent-2]:pl-18',
  '[&_.cc-quote]:my-1 [&_.cc-quote]:border-l-4 [&_.cc-quote]:border-line-strong [&_.cc-quote]:pl-3',
  '[&_.cc-code]:rounded-sm [&_.cc-code]:border [&_.cc-code]:border-line [&_.cc-code]:bg-surface-muted [&_.cc-code]:px-1 [&_.cc-code]:font-mono [&_.cc-code]:text-caption',
  '[&_.cc-pre]:my-1 [&_.cc-pre]:rounded-sm [&_.cc-pre]:border [&_.cc-pre]:border-line [&_.cc-pre]:bg-surface-muted [&_.cc-pre]:p-2 [&_.cc-pre]:font-mono [&_.cc-pre]:text-caption [&_.cc-pre]:whitespace-pre-wrap',
  '[&_a]:text-info-700 [&_a:hover]:underline',
  '[&_.cc-mention]:rounded-sm [&_.cc-mention]:bg-info-50 [&_.cc-mention]:px-0.5 [&_.cc-mention]:text-info-700',
  '[&_.cc-mention-broadcast]:bg-warning-100 [&_.cc-mention-broadcast]:text-warning-700',
].join(' ');

/** Slack message body as Slack renders it (rendered from the payload by the compose library). */
export const SLACK_BODY = ['text-[0.9375rem] leading-[1.4667] text-fg', SLACK_BODY_RULES].join(' ');

/** Gmail body: the payload carries its own inline email styles; this only sets the frame. */
export const EMAIL_BODY = ['text-body-lg text-fg break-words', '[&_p]:my-0'].join(' ');
