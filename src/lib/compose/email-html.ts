/** TipTap JSON -> email-safe HTML (inline styles, no flex/grid, table layout only for real tables). */
import type { DocNode, EmailPayload, SerializeResult } from './types';
import { GMAIL_CLIP_BYTES } from './types';
import { Collector, escapeHtml, inlineItems, safeUrl, utf8Bytes } from './util';
import { plainTextOf } from './plain';

export const EMAIL_STYLES = {
  wrapper: 'font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222;',
  p: 'margin:0 0 12px 0;',
  list: 'margin:0 0 12px 0;padding-left:24px;',
  li: 'margin:0 0 4px 0;',
  quote: 'margin:0 0 12px 0;padding:0 0 0 12px;border-left:3px solid #d0d7de;color:#57606a;',
  pre: "margin:0 0 12px 0;padding:10px 12px;background:#f6f8fa;border:1px solid #d0d7de;font-family:Menlo,Consolas,'Courier New',monospace;font-size:13px;white-space:pre-wrap;",
  code: "font-family:Menlo,Consolas,'Courier New',monospace;font-size:13px;background:#f6f8fa;padding:1px 4px;",
  a: 'color:#1155cc;',
  table: 'border-collapse:collapse;margin:0 0 12px 0;',
  th: 'border:1px solid #d0d7de;padding:6px 10px;text-align:left;background:#f6f8fa;',
  td: 'border:1px solid #d0d7de;padding:6px 10px;text-align:left;',
  hr: 'border:0;border-top:1px solid #d0d7de;margin:12px 0;',
} as const;

const HEADING_SIZE: Record<number, string> = { 1: '22px', 2: '18px', 3: '16px', 4: '14px', 5: '14px', 6: '14px' };

function inlineToHtml(content: DocNode[] | undefined, col: Collector): string {
  let out = '';
  for (const it of inlineItems(content)) {
    if (it.t === 'br') {
      out += '<br>';
      continue;
    }
    if (it.t === 'mention') {
      const m = it.info;
      if (m.email) {
        out += `<a href="mailto:${escapeHtml(m.email)}" style="${EMAIL_STYLES.a}">${escapeHtml(m.label)}</a>`;
      } else {
        col.note('mention', `${m.kind} mention`, 'plain name');
        out += escapeHtml(m.kind === 'channel' ? `#${m.label}` : m.kind === 'special' ? `@${m.id}` : m.label);
      }
      continue;
    }
    let html = escapeHtml(it.text);
    const marks = new Set(it.marks.map((m) => m.type));
    if (marks.has('code')) html = `<code style="${EMAIL_STYLES.code}">${html}</code>`;
    if (marks.has('strike')) html = `<s>${html}</s>`;
    if (marks.has('italic')) html = `<em>${html}</em>`;
    if (marks.has('bold')) html = `<strong>${html}</strong>`;
    const href = it.marks.find((m) => m.type === 'link')?.attrs?.href;
    if (typeof href === 'string') {
      const url = safeUrl(href);
      if (url) html = `<a href="${escapeHtml(url)}" style="${EMAIL_STYLES.a}">${html}</a>`;
      else {
        col.note('link', 'unsafe link', 'text');
        col.warn({ code: 'unsafe_link', message: 'A link with an unsupported scheme was sent as plain text' });
      }
    }
    out += html;
  }
  return out;
}

/** Inline-only content (single paragraph) renders bare; anything else keeps its blocks. */
function containerContent(children: DocNode[], col: Collector): string {
  const real = children.filter((c) => !(c.type === 'paragraph' && !(c.content ?? []).length));
  if (real.length === 1 && real[0]!.type === 'paragraph') return inlineToHtml(real[0]!.content, col);
  return real.map((c) => blockToHtml(c, col)).join('');
}

function listToHtml(list: DocNode, col: Collector): string {
  const ordered = list.type === 'orderedList';
  const tag = ordered ? 'ol' : 'ul';
  const start = Number(list.attrs?.start ?? 1);
  const items = (list.content ?? [])
    .map((li) => {
      // Mixed content: leading paragraph inline, then nested blocks.
      const kids = li.content ?? [];
      const head = kids[0];
      if (head && head.type === 'paragraph' && kids.slice(1).every((k) => k.type === 'bulletList' || k.type === 'orderedList')) {
        return `<li style="${EMAIL_STYLES.li}">${inlineToHtml(head.content, col)}${kids.slice(1).map((k) => listToHtml(k, col)).join('')}</li>`;
      }
      return `<li style="${EMAIL_STYLES.li}">${containerContent(kids, col)}</li>`;
    })
    .join('');
  return `<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''} style="${EMAIL_STYLES.list}">${items}</${tag}>`;
}

function blockToHtml(node: DocNode, col: Collector): string {
  switch (node.type) {
    case 'paragraph': {
      if (!(node.content ?? []).length) return '';
      return `<p style="${EMAIL_STYLES.p}">${inlineToHtml(node.content, col)}</p>`;
    }
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
      return `<h${level} style="margin:0 0 12px 0;font-size:${HEADING_SIZE[level]};line-height:1.3;">${inlineToHtml(node.content, col)}</h${level}>`;
    }
    case 'bulletList':
    case 'orderedList':
      return listToHtml(node, col);
    case 'blockquote':
      return `<blockquote style="${EMAIL_STYLES.quote}">${(node.content ?? []).map((c) => blockToHtml(c, col)).join('')}</blockquote>`;
    case 'codeBlock': {
      const raw = (node.content ?? []).map((c) => c.text ?? '').join('');
      return `<pre style="${EMAIL_STYLES.pre}"><code>${escapeHtml(raw)}</code></pre>`;
    }
    case 'table': {
      const rows = (node.content ?? [])
        .filter((r) => r.type === 'tableRow')
        .map((r) => {
          const cells = (r.content ?? [])
            .map((c) => {
              const tag = c.type === 'tableHeader' ? 'th' : 'td';
              return `<${tag} style="${tag === 'th' ? EMAIL_STYLES.th : EMAIL_STYLES.td}">${containerContent(c.content ?? [], col)}</${tag}>`;
            })
            .join('');
          return `<tr>${cells}</tr>`;
        })
        .join('');
      return `<table cellpadding="0" cellspacing="0" border="0" style="${EMAIL_STYLES.table}">${rows}</table>`;
    }
    case 'horizontalRule':
      return `<hr style="${EMAIL_STYLES.hr}">`;
    default:
      if (node.content?.length) {
        col.note('node', node.type, 'text');
        return node.content.some((c) => c.type === 'text' || c.type === 'mention' || c.type === 'hardBreak')
          ? `<p style="${EMAIL_STYLES.p}">${inlineToHtml(node.content, col)}</p>`
          : node.content.map((c) => blockToHtml(c, col)).join('');
      }
      return '';
  }
}

export function serializeEmailHtml(doc: DocNode): SerializeResult<EmailPayload> {
  const col = new Collector();
  const body = (doc.content ?? []).map((b) => blockToHtml(b, col)).join('');
  const html = `<div style="${EMAIL_STYLES.wrapper}">${body}</div>`;
  const bytes = utf8Bytes(html);
  if (bytes > GMAIL_CLIP_BYTES) {
    col.warn({
      code: 'size_exceeded',
      message: `HTML is ${Math.round(bytes / 1024)} KB; Gmail clips messages over 102 KB`,
    });
  }
  return { payload: { html, text: plainTextOf(doc) }, lossy: col.notes(), warnings: col.warnings };
}
