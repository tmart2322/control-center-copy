/**
 * The only place domain components inject HTML. Everything passes through DOMPurify with a tight
 * allowlist first (security rule: never dangerouslySetInnerHTML without DOMPurify). Inline `style` is
 * dropped; channel look comes from our own classes.
 */
import DOMPurify from 'isomorphic-dompurify';
import { cn } from '@/ui';

const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 's', 'del', 'u', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'a', 'span', 'div'];
const ALLOWED_ATTR = ['href', 'class', 'start', 'title'];

let hooked = false;
function ensureHook() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noreferrer noopener');
    }
  });
}

export function sanitize(html: string): string {
  ensureHook();
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false, ALLOWED_URI_REGEXP: /^(?:https?|mailto|slack):/i });
}

export function SafeHtml({ html, className, id }: { html: string; className?: string; id?: string }) {
  return <div id={id} className={cn(className)} dangerouslySetInnerHTML={{ __html: sanitize(html) }} />;
}
