/**
 * Error text a person can read (2026-11-13 audit C6). Pure; used by ApiError (src/client/api.ts) and every error toast.
 *
 * - An HTML-shaped body (a proxy's sign-in page, a gateway's 502 page) never shows as markup: its <title> or first
 *   heading, else its text with the tags stripped, whitespace collapsed.
 * - Shortening never cuts mid-sentence: it ends at the last full sentence that fits, else at a word, with "…".
 */

const HTML = /<(?:!doctype|html|head|body|title|div|p|h[1-6]|span|table|br|script|style)\b/i;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = (s: string) => s.replace(/&(#39|amp|lt|gt|quot|apos|nbsp);/g, (_m, k: string) => ENTITIES[k] ?? _m);
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** True when the text carries HTML markup (a page, not a message). */
export function looksLikeHtml(text: string): boolean {
  return HTML.test(text);
}

/** The readable part of a message that may be (or contain) an HTML page: "HTTP 502: Bad Gateway". */
export function stripHtml(text: string): string {
  if (!looksLikeHtml(text)) return text;
  const start = text.search(/<(?:!doctype|html|head|body)\b/i);
  const lead = start > 0 ? squash(decode(text.slice(0, start))).replace(/[:\s-]+$/, '') : '';
  const page = start >= 0 ? text.slice(start) : text;
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(page)?.[1] ?? /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(page)?.[1];
  const words = squash(
    decode(
      (title ?? page)
        .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' '),
    ),
  );
  return [lead, words].filter(Boolean).join(': ') || 'The server answered with a web page instead of a message';
}

/** At most `max` characters, ending at a sentence (or a word) boundary, never mid-word. */
export function clipSentence(text: string, max = 240): string {
  const s = squash(text);
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const lastStop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('; '));
  if (lastStop > 0) return head.slice(0, lastStop + 1).trim();
  const lastSpace = head.lastIndexOf(' ');
  return `${(lastSpace > max * 0.4 ? head.slice(0, lastSpace) : head.slice(0, max - 1)).replace(/[\s,;:.-]+$/, '')}…`;
}

/** A readable message for any caught error: HTML stripped, shortened at a sentence. */
export function errorText(err: unknown, max = 240): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : 'Something went wrong';
  return clipSentence(stripHtml(raw || 'Something went wrong'), max);
}
