/**
 * Sanitized markdown for chat bubbles (VDP's renderMarkdown pattern): `marked` passes raw HTML through, so
 * every render goes through DOMPurify. External links open in a new tab with rel=noopener.
 */
import DOMPurify from 'isomorphic-dompurify';
import { marked } from 'marked';

const g = globalThis as { __ccChatPurifyHook?: boolean };
if (!g.__ccChatPurifyHook) {
  g.__ccChatPurifyHook = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? '';
      if (/^https?:\/\//i.test(href)) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }
  });
}

export function renderMarkdown(md: string | null | undefined): string {
  if (!md) return '';
  const raw = marked.parse(md, { async: false, gfm: true, breaks: false }) as string;
  return DOMPurify.sanitize(raw, { FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe'], FORBID_ATTR: ['style'] });
}

/**
 * Put the streaming caret inside the last text block, so it trails the words instead of dropping to its
 * own line. `caretHtml` is trusted markup built by the caller (never model output).
 */
export function withCaret(html: string, caretHtml: string): string {
  if (!html) return `<p>${caretHtml}</p>`;
  const m = /(<\/(?:p|li|h[1-6]|td|th|code|blockquote)>)((?:\s*<\/(?:ul|ol|pre|table|tbody|thead|tr|blockquote)>)*\s*)$/.exec(html);
  if (!m) return html + caretHtml;
  return html.slice(0, m.index) + caretHtml + html.slice(m.index);
}
