/**
 * A SOURCE message's body (the Slack message or email a draft replies to) → safe rich HTML + plain text, from its
 * stored format (`source_items.body_format`). Pure and isomorphic: the server renders it, the client still runs
 * DOMPurify before injecting (src/components/composer/preview.ts `purify`).
 *
 *  - slack_mrkdwn: `parseSlackMrkdwn` → the same Slack rendering as the recipient preview: bold, italics, strike,
 *    links (`<url|label>`), mentions by name (`<@U…>` → "@Dana Reyes"; an id nobody knows → "@someone"), channels,
 *    inline code and code blocks, bullet / numbered lists, quotes. Emoji shortcodes (`:eyes:`) stay as text.
 *    Slack's escaped quote marker (`&gt; ` at a line start) is a quote; `<!date^…|fallback>` shows its fallback.
 *  - html: the compose allowlist sanitizer (no scripts, handlers, images, styles that load anything).
 *  - plain / markdown: escaped text, paragraphs and line breaks kept, http(s) links made clickable, `>` lines as a
 *    quote; markdown adds `[label](url)` links, `**bold**`, `*italic*` and `` `code` ``.
 *
 * Every link goes through `safeUrl` (http, https, mailto, tel only). Never returns unsanitized HTML.
 */
import { parseEmailHtml } from './parse-email';
import { parseSlackMrkdwn } from './parse-slack';
import { plainTextOf } from './plain';
import { docToSlackHtml } from './preview';
import { sanitizeHtml } from './html';
import { escapeHtml, safeUrl } from './util';

export type SourceBodyFormat = 'plain' | 'slack_mrkdwn' | 'html' | 'markdown';

export interface RenderSourceOptions {
  /** Slack id (U…, W…, C…, S…) → display name. */
  labels?: Record<string, string>;
  /** Shown for a user mention nobody knows (default "someone"). */
  unknownLabel?: string;
  /** Longest body rendered, in characters (default 20,000); the rest is cut with "…". */
  maxChars?: number;
}

export interface RenderedSource {
  html: string;
  text: string;
}

const MAX_CHARS = 20_000;
const MENTION_RE = /<@([UW][A-Z0-9]+)(\|[^>]*)?>/g;

/** The user ids a Slack body mentions (to look their names up). */
export function sourceMentionIds(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION_RE)].map((m) => m[1]!))];
}

function cut(body: string, max: number): string {
  return body.length > max ? `${body.slice(0, max).trimEnd()}…` : body;
}

/** Markup the body was cut inside of (ingest caps stored Slack bodies): `<@U…|label`, `<url|label`, `<#C…` at the end. */
const DANGLING = /<((?:[@#!][^<>\s|]+|(?:https?|mailto):[^<>\s|]+)(\|[^<>]*)?)$/;

/**
 * A body cut mid-token keeps its meaning instead of showing the raw bracket: a mention or channel (or a link with its
 * label started) is closed, so it reads "@Dana…" / "the Phase…"; a bare URL cut short stays text, since its address
 * is incomplete. Either way the "…" says the text goes on.
 */
export function closeCutMarkup(body: string): string {
  const trimmed = body.replace(/\s*…$/, '');
  const m = DANGLING.exec(trimmed);
  if (!m) return body;
  const head = trimmed.slice(0, m.index);
  const [, inner, label] = m;
  if (label !== undefined || /^[@#!]/.test(inner!)) return `${head}<${inner!.replace(/\|$/, '')}>…`;
  return `${head}${inner}…`;
}

function slack(raw: string, opts: RenderSourceOptions): RenderedSource {
  const body = closeCutMarkup(raw);
  const labels: Record<string, string> = { ...(opts.labels ?? {}) };
  // A mention without an inline label whose id nobody knows reads "@someone", never a raw id.
  for (const m of body.matchAll(MENTION_RE)) if (!m[2] && !labels[m[1]!]) labels[m[1]!] = opts.unknownLabel ?? 'someone';
  const text = body
    .replace(/\r\n?/g, '\n')
    .replace(/<!date\^[^|>]*\|([^>]*)>/g, '$1')
    .replace(/^&gt;[ \t]?/gm, '> ');
  const doc = parseSlackMrkdwn(text, { labels });
  return { html: sanitizeHtml(`<div class="cc-source cc-source-slack">${docToSlackHtml(doc, labels)}</div>`), text: plainTextOf(doc) };
}

function email(body: string): RenderedSource {
  return { html: sanitizeHtml(`<div class="cc-source cc-source-email">${body}</div>`), text: plainTextOf(parseEmailHtml(body)) };
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/g;
const TRAILING = /[.,;:!?)\]}'"]+$/;

function link(url: string, label: string): string {
  const u = safeUrl(url);
  return u ? `<a href="${escapeHtml(u)}">${label}</a>` : label;
}

/** One line of plain text (or markdown) as HTML: escaped, URLs linked. */
function inline(line: string, markdown: boolean): string {
  let out = '';
  let last = 0;
  const tokens: Array<{ start: number; end: number; html: string }> = [];
  if (markdown) {
    for (const m of line.matchAll(/\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)]+)\)/g)) tokens.push({ start: m.index!, end: m.index! + m[0].length, html: link(m[2]!, escapeHtml(m[1]!)) });
  }
  for (const m of line.matchAll(URL_RE)) {
    const start = m.index!;
    if (tokens.some((t) => start >= t.start && start < t.end)) continue;
    const url = m[0].replace(TRAILING, '');
    tokens.push({ start, end: start + url.length, html: link(url, escapeHtml(url)) });
  }
  tokens.sort((a, b) => a.start - b.start);
  const rest = (s: string) => {
    let h = escapeHtml(s);
    if (markdown) {
      h = h
        .replace(/`([^`\n]+)`/g, '<code class="cc-code">$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=$|[\s.,;:!?)])/g, '$1<em>$2</em>');
    }
    return h;
  };
  for (const t of tokens) {
    if (t.start < last) continue;
    out += rest(line.slice(last, t.start)) + t.html;
    last = t.end;
  }
  return out + rest(line.slice(last));
}

function plain(body: string, markdown: boolean): RenderedSource {
  const text = body.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const blocks: string[] = [];
  for (const para of text.split(/\n\s*\n/)) {
    const lines = para.split('\n');
    let i = 0;
    let html = '';
    while (i < lines.length) {
      if (/^\s*>/.test(lines[i]!)) {
        const q: string[] = [];
        while (i < lines.length && /^\s*>/.test(lines[i]!)) q.push(lines[i++]!.replace(/^\s*>\s?/, ''));
        html += `<blockquote class="cc-quote">${q.map((l) => inline(l, markdown)).join('<br>')}</blockquote>`;
      } else {
        const p: string[] = [];
        while (i < lines.length && !/^\s*>/.test(lines[i]!)) p.push(lines[i++]!);
        html += `<p>${p.map((l) => inline(l, markdown)).join('<br>')}</p>`;
      }
    }
    blocks.push(html);
  }
  return { html: sanitizeHtml(`<div class="cc-source cc-source-plain">${blocks.join('')}</div>`), text };
}

/** Render a stored source body by its format. `slack` forces Slack mrkdwn (Slack bodies are stored as `plain`). */
export function renderSourceBody(body: string | null | undefined, format: SourceBodyFormat, opts: RenderSourceOptions = {}): RenderedSource {
  const raw = cut(body ?? '', opts.maxChars ?? MAX_CHARS);
  if (!raw.trim()) return { html: '', text: '' };
  switch (format) {
    case 'slack_mrkdwn':
      return slack(raw, opts);
    case 'html':
      return email(raw);
    case 'markdown':
      return plain(raw, true);
    default:
      return plain(raw, false);
  }
}

// ---------------------------------------------------------------------------
// Which format a text is written in (when the stored format is not at hand)
// ---------------------------------------------------------------------------

/** Tags that make an email body HTML rather than text with a stray `<`. */
const HTML_TAG = /<\/?(?:p|div|br|span|a|b|strong|i|em|u|ul|ol|li|table|tr|td|blockquote|h[1-6]|html|body|font|img|hr|pre)\b[^>]*>/i;

/**
 * An evidence snippet's format from its source: a Slack body is mrkdwn (stored as `plain`, read the same way as
 * above), an email body is HTML when it is HTML, else plain text; notes, docs, calendar and CRM text are plain.
 */
export function snippetFormat(kind: string, body: string | null | undefined): SourceBodyFormat {
  if (kind === 'slack') return 'slack_mrkdwn';
  if (kind === 'gmail' && body && HTML_TAG.test(body)) return 'html';
  return 'plain';
}

/** Slack's angle-bracket markup (mentions, channels, `<!here>`, `<url|label>`) or its emphasis markers. */
const SLACK_MARKUP = /<(?:[@#!][^>\s]*|(?:https?|mailto|tel):[^>\s]+)>|(?:^|[\s(])([*_~`])[^\s*_~`](?:[^\n]*?[^\s])?\1(?=$|[\s.,;:!?)'"])/;

/**
 * Does an engine-written line (a why, an evidence summary) quote Slack markup? Such lines are plain sentences and
 * render as mrkdwn only when they do, so ordinary text never turns into a list or a quote by accident.
 */
export function hasSlackMarkup(text: string | null | undefined): boolean {
  return !!text && SLACK_MARKUP.test(text);
}
