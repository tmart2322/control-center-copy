/** Basic email HTML -> TipTap JSON. Exact inverse of serializeEmailHtml for the supported subset. */
import type { ComposeDoc, DocMark, DocNode } from './types';
import { docFromBlocks, safeUrl } from './util';
import { parseHtml, textContent, type HElement, type HNode } from './html';

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'center', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol',
  'li', 'blockquote', 'pre', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'hr', 'body', 'html',
]);
const SKIP = new Set(['head', 'script', 'style', 'title', 'meta', 'link', 'noscript', 'template', 'svg']);
const MARK_TAG: Record<string, string> = { strong: 'bold', b: 'bold', em: 'italic', i: 'italic', s: 'strike', strike: 'strike', del: 'strike', code: 'code' };

function inlineNodes(nodes: HNode[], marks: DocMark[], out: DocNode[]): void {
  for (const n of nodes) {
    if (typeof n === 'string') {
      const t = n.replace(/\s+/g, ' ');
      if (t) out.push({ type: 'text', text: t, ...(marks.length ? { marks } : {}) });
      continue;
    }
    if (SKIP.has(n.tag)) continue;
    if (n.tag === 'br') out.push({ type: 'hardBreak' });
    else if (n.tag === 'a') {
      const url = safeUrl(n.attrs.href);
      inlineNodes(n.children, url ? [...marks, { type: 'link', attrs: { href: url } }] : marks, out);
    } else if (MARK_TAG[n.tag]) inlineNodes(n.children, [...marks, { type: MARK_TAG[n.tag]! }], out);
    else if (n.tag === 'img') {
      if (n.attrs.alt) out.push({ type: 'text', text: n.attrs.alt, ...(marks.length ? { marks } : {}) });
    } else inlineNodes(n.children, marks, out);
  }
}

function trimInline(nodes: DocNode[]): DocNode[] {
  const out = nodes.map((n) => ({ ...n }));
  while (out.length) {
    const f = out[0]!;
    if (f.type === 'text') {
      f.text = f.text!.replace(/^\s+/, '');
      if (!f.text) {
        out.shift();
        continue;
      }
    }
    break;
  }
  while (out.length) {
    const l = out[out.length - 1]!;
    if (l.type === 'text') {
      l.text = l.text!.replace(/\s+$/, '');
      if (!l.text) {
        out.pop();
        continue;
      }
    }
    break;
  }
  return out;
}

function flushInline(buf: DocNode[], out: DocNode[]): void {
  const content = trimInline(buf);
  // A lone <br> (Gmail's blank-line spacer) is not content.
  if (content.length && !content.every((n) => n.type === 'hardBreak')) out.push({ type: 'paragraph', content });
  buf.length = 0;
}

function blocks(nodes: HNode[]): DocNode[] {
  const out: DocNode[] = [];
  const buf: DocNode[] = [];
  for (const n of nodes) {
    if (typeof n === 'string' || !BLOCK_TAGS.has(n.tag)) {
      if (typeof n !== 'string' && SKIP.has(n.tag)) continue;
      inlineNodes([n], [], buf);
      continue;
    }
    flushInline(buf, out);
    out.push(...blockEl(n));
  }
  flushInline(buf, out);
  return out;
}

function rows(el: HElement): HElement[] {
  const r: HElement[] = [];
  for (const c of el.children) {
    if (typeof c === 'string') continue;
    if (c.tag === 'tr') r.push(c);
    else if (['thead', 'tbody', 'tfoot'].includes(c.tag)) r.push(...rows(c));
  }
  return r;
}

function blockEl(el: HElement): DocNode[] {
  switch (el.tag) {
    case 'p':
    case 'div':
    case 'section':
    case 'article':
    case 'header':
    case 'footer':
    case 'main':
    case 'center':
    case 'body':
    case 'html':
      return blocks(el.children);
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const buf: DocNode[] = [];
      inlineNodes(el.children, [], buf);
      return [{ type: 'heading', attrs: { level: Number(el.tag[1]) }, content: trimInline(buf) }];
    }
    case 'ul':
    case 'ol': {
      const items = el.children.filter((c): c is HElement => typeof c !== 'string' && c.tag === 'li');
      const start = parseInt(el.attrs.start ?? '1', 10);
      return [
        {
          type: el.tag === 'ul' ? 'bulletList' : 'orderedList',
          ...(el.tag === 'ol' && start !== 1 && Number.isFinite(start) ? { attrs: { start } } : {}),
          content: items.map((li) => {
            const content = blocks(li.children);
            return { type: 'listItem', content: content.length ? content : [{ type: 'paragraph' }] };
          }),
        },
      ];
    }
    case 'li': // stray li outside a list
      return blocks(el.children);
    case 'blockquote':
      return [{ type: 'blockquote', content: blocks(el.children) }];
    case 'pre': {
      let t = textContent(el.children);
      if (t.startsWith('\n')) t = t.slice(1);
      return [{ type: 'codeBlock', ...(t ? { content: [{ type: 'text', text: t }] } : {}) }];
    }
    case 'hr':
      return [{ type: 'horizontalRule' }];
    case 'table':
    case 'thead':
    case 'tbody':
    case 'tfoot':
      return [
        {
          type: 'table',
          content: rows(el).map((tr) => ({
            type: 'tableRow',
            content: tr.children
              .filter((c): c is HElement => typeof c !== 'string' && (c.tag === 'td' || c.tag === 'th'))
              .map((c) => {
                const content = blocks(c.children);
                return { type: c.tag === 'th' ? 'tableHeader' : 'tableCell', content: content.length ? content : [{ type: 'paragraph' }] };
              }),
          })),
        },
      ];
    case 'tr':
    case 'td':
    case 'th':
      return blocks(el.children);
    default:
      return [];
  }
}

export function parseEmailHtml(html: string): ComposeDoc {
  return docFromBlocks(blocks(parseHtml(html)));
}
