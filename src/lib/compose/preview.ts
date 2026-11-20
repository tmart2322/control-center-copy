/**
 * Preview as recipient. Always derived from the SERIALIZED PAYLOAD (payloadFor), never from the editor doc,
 * so what the user sees is what gets sent. Output goes through the allowlist sanitizer.
 */
import { payloadFor } from './payload';
import { sanitizeHtml } from './html';
import { parseSlackMrkdwn } from './parse-slack';
import type {
  Destination,
  DocNode,
  EmailPayload,
  PlainPayload,
  RichTextElement,
  RichTextBlockElement,
  SlackPayload,
} from './types';
import { escapeHtml, safeUrl } from './util';

export interface PreviewOptions {
  /** id -> display name for Slack mentions (the payload carries ids only). */
  mentionLabels?: Record<string, string>;
}

const esc = (s: string) => escapeHtml(s).replace(/&quot;/g, '"');

/** A TipTap doc as Slack would show it (inner HTML, not yet sanitized: wrap it and run `sanitizeHtml`). */
export function docToSlackHtml(node: DocNode, labels: Record<string, string>): string {
  const kids = (n: DocNode) => (n.content ?? []).map((c) => docToSlackHtml(c, labels)).join('');
  switch (node.type) {
    case 'doc':
      return kids(node);
    case 'paragraph':
      return `<p>${kids(node)}</p>`;
    case 'text': {
      let h = esc(node.text ?? '');
      const marks = node.marks ?? [];
      const has = (t: string) => marks.some((m) => m.type === t);
      if (has('code')) h = `<code class="cc-code">${h}</code>`;
      if (has('strike')) h = `<s>${h}</s>`;
      if (has('italic')) h = `<em>${h}</em>`;
      if (has('bold')) h = `<strong>${h}</strong>`;
      const href = marks.find((m) => m.type === 'link')?.attrs?.href;
      const url = typeof href === 'string' ? safeUrl(href) : null;
      return url ? `<a href="${esc(url)}">${h}</a>` : h;
    }
    case 'hardBreak':
      return '<br>';
    case 'mention': {
      const a = node.attrs ?? {};
      const id = String(a.id ?? '');
      const kind = String(a.kind ?? 'user');
      const label = labels[id] ?? String(a.label ?? id);
      const shown = kind === 'channel' ? `#${label}` : `@${label}`;
      const cls = kind === 'special' ? 'cc-mention cc-mention-broadcast' : 'cc-mention';
      return `<span class="${cls}">${esc(shown)}</span>`;
    }
    case 'bulletList':
      return `<ul>${kids(node)}</ul>`;
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1);
      return `<ol${start !== 1 ? ` start="${start}"` : ''}>${kids(node)}</ol>`;
    }
    case 'listItem':
      return `<li>${(node.content ?? []).map((c) => (c.type === 'paragraph' ? kids(c) : docToSlackHtml(c, labels))).join('')}</li>`;
    case 'blockquote':
      return `<blockquote class="cc-quote">${kids(node)}</blockquote>`;
    case 'codeBlock':
      return `<pre class="cc-pre">${esc((node.content ?? []).map((c) => c.text ?? '').join(''))}</pre>`;
    default:
      return kids(node);
  }
}

function elementsToHtml(els: RichTextElement[], labels: Record<string, string>): string {
  return els
    .map((e) => {
      let h: string;
      switch (e.type) {
        case 'text':
          h = esc(e.text).replace(/\n/g, '<br>');
          break;
        case 'link': {
          const u = safeUrl(e.url);
          h = u ? `<a href="${esc(u)}">${esc(e.text ?? e.url)}</a>` : esc(e.text ?? e.url);
          break;
        }
        case 'user':
          h = `<span class="cc-mention">@${esc(labels[e.user_id] ?? e.user_id)}</span>`;
          break;
        case 'channel':
          h = `<span class="cc-mention">#${esc(labels[e.channel_id] ?? e.channel_id)}</span>`;
          break;
        case 'usergroup':
          h = `<span class="cc-mention">@${esc(labels[e.usergroup_id] ?? e.usergroup_id)}</span>`;
          break;
        case 'broadcast':
          return `<span class="cc-mention cc-mention-broadcast">@${e.range}</span>`;
      }
      const s = 'style' in e ? e.style : undefined;
      if (s?.code) h = `<code class="cc-code">${h}</code>`;
      if (s?.strike) h = `<s>${h}</s>`;
      if (s?.italic) h = `<em>${h}</em>`;
      if (s?.bold) h = `<strong>${h}</strong>`;
      return h;
    })
    .join('');
}

function blocksToHtml(blocks: NonNullable<SlackPayload['blocks']>, labels: Record<string, string>): string {
  return blocks
    .map((b) =>
      b.elements
        .map((el: RichTextBlockElement) => {
          switch (el.type) {
            case 'rich_text_section':
              return `<p>${elementsToHtml(el.elements, labels)}</p>`;
            case 'rich_text_quote':
              return `<blockquote class="cc-quote">${elementsToHtml(el.elements, labels)}</blockquote>`;
            case 'rich_text_preformatted':
              return `<pre class="cc-pre">${elementsToHtml(el.elements, labels)}</pre>`;
            case 'rich_text_list': {
              const tag = el.style === 'ordered' ? 'ol' : 'ul';
              const start = el.style === 'ordered' && el.offset ? ` start="${el.offset + 1}"` : '';
              const items = el.elements.map((s) => `<li>${elementsToHtml(s.elements, labels)}</li>`).join('');
              return `<${tag} class="cc-indent-${Math.min(el.indent, 8)}"${start}>${items}</${tag}>`;
            }
          }
        })
        .join(''),
    )
    .join('');
}

export function renderPreview(doc: DocNode, destination: Destination, opts: PreviewOptions = {}): string {
  const labels = opts.mentionLabels ?? {};
  const payload = payloadFor(doc, destination);
  if (destination.kind === 'slack') {
    const p = payload as SlackPayload;
    const inner = p.blocks ? blocksToHtml(p.blocks, labels) : docToSlackHtml(parseSlackMrkdwn(p.text, { labels }), labels);
    return sanitizeHtml(`<div class="cc-preview cc-preview-slack">${inner}</div>`);
  }
  if (destination.kind === 'email') {
    return sanitizeHtml(`<div class="cc-preview cc-preview-email">${(payload as EmailPayload).html}</div>`);
  }
  return sanitizeHtml(`<div class="cc-preview cc-preview-plain"><pre>${esc((payload as PlainPayload).text)}</pre></div>`);
}
