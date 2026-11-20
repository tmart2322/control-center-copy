/**
 * Minimal dependency-free HTML tokenizer/tree + allowlist sanitizer.
 * Output is always rebuilt from the tree (never filtered in place), so unknown tags/attrs cannot survive.
 * Runs identically on server and browser (no DOM needed).
 */
import { escapeHtml, safeUrl } from './util';

export interface HElement {
  tag: string;
  attrs: Record<string, string>;
  children: HNode[];
}
export type HNode = HElement | string;

const VOID = new Set(['br', 'hr', 'img', 'meta', 'link', 'input', 'col', 'wbr', 'area', 'base', 'source']);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);
const IMPLIED_CLOSE: Record<string, string[]> = {
  p: ['p'],
  li: ['li'],
  tr: ['tr', 'td', 'th'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  thead: ['tbody', 'tfoot'],
  tbody: ['thead', 'tbody', 'tfoot'],
};

const BOUNDARY = new Set(['ul', 'ol', 'table', 'blockquote', 'div', 'td', 'th']);

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      return String.fromCodePoint(code);
    }
    return NAMED[e.toLowerCase()] ?? all;
  });
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const name = m[1]!.toLowerCase();
    if (!(name in attrs)) attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

export function parseHtml(html: string): HNode[] {
  const root: HElement = { tag: '#root', attrs: {}, children: [] };
  const stack: HElement[] = [root];
  const top = () => stack[stack.length - 1]!;
  const TAG_RE = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[^>]*>|<\/([a-zA-Z][^\s>\/]*)[^>]*>|<([a-zA-Z][^\s>\/]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const text = (t: string) => {
    if (t) top().children.push(decodeEntities(t));
  };
  while ((m = TAG_RE.exec(html))) {
    text(html.slice(last, m.index));
    last = TAG_RE.lastIndex;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.tag === tag) {
          stack.length = i;
          break;
        }
      }
    } else if (m[2]) {
      const tag = m[2].toLowerCase();
      const closes = IMPLIED_CLOSE[tag];
      if (closes) {
        // close an open sibling of the same family, but never cross a container boundary
        for (let i = stack.length - 1; i > 0; i--) {
          const t = stack[i]!.tag;
          if (closes.includes(t)) {
            stack.length = i;
            break;
          }
          if (BOUNDARY.has(t)) break;
        }
      }
      const el: HElement = { tag, attrs: parseAttrs(m[3] ?? ''), children: [] };
      top().children.push(el);
      const selfClosed = /\/\s*$/.test(m[3] ?? '');
      if (VOID.has(tag) || selfClosed) continue;
      if (RAW_TEXT.has(tag)) {
        const close = new RegExp(`</${tag}\\s*>`, 'i');
        const rest = html.slice(last);
        const c = close.exec(rest);
        const end = c ? c.index : rest.length;
        el.children.push(rest.slice(0, end));
        last += end + (c ? c[0].length : 0);
        TAG_RE.lastIndex = last;
        continue;
      }
      stack.push(el);
    }
  }
  text(html.slice(last));
  return root.children;
}

export function textContent(nodes: HNode[]): string {
  return nodes.map((n) => (typeof n === 'string' ? n : n.tag === 'br' ? '\n' : textContent(n.children))).join('');
}

// ---------------------------------------------------------------------------
// Sanitizer
// ---------------------------------------------------------------------------

const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'head', 'title',
  'textarea', 'select', 'option', 'button', 'input', 'form', 'img', 'video', 'audio', 'link', 'meta', 'base', 'canvas',
]);

const GLOBAL_ATTRS = ['style', 'class', 'title', 'dir', 'lang'];
const ALLOWED: Record<string, string[]> = {
  a: ['href'],
  p: ['align'], div: ['align'], span: [], strong: [], b: [], em: [], i: [], s: [], strike: [], del: [], u: [], code: [], pre: [], br: [], hr: [],
  ul: [], ol: ['start', 'type'], li: [], blockquote: [], h1: [], h2: [], h3: [], h4: [], h5: [], h6: [], sub: [], sup: [], small: [],
  table: ['cellpadding', 'cellspacing', 'border', 'width', 'align'],
  thead: [], tbody: [], tfoot: [], tr: ['align', 'valign'],
  th: ['colspan', 'rowspan', 'align', 'valign', 'width'], td: ['colspan', 'rowspan', 'align', 'valign', 'width'],
};

const STYLE_PROPS = new Set([
  'color', 'background', 'background-color', 'font', 'font-family', 'font-size', 'font-style', 'font-weight', 'line-height',
  'text-align', 'text-decoration', 'text-indent', 'letter-spacing', 'white-space', 'word-break', 'margin', 'margin-top',
  'margin-right', 'margin-bottom', 'margin-left', 'padding', 'padding-top', 'padding-right', 'padding-bottom',
  'padding-left', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-collapse', 'border-spacing',
  'border-color', 'border-style', 'border-width', 'width', 'max-width', 'height', 'vertical-align', 'list-style-type',
]);

export function sanitizeStyle(style: string): string {
  const out: string[] = [];
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':');
    if (i === -1) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (!STYLE_PROPS.has(prop) || !val) continue;
    if (/url\s*\(|expression|javascript|@import|behaviou?r|binding|\\|[<>{}]|\/\*/i.test(val)) continue;
    out.push(`${prop}:${val}`);
  }
  return out.length ? out.join(';') + ';' : '';
}

function renderSafe(nodes: HNode[]): string {
  let out = '';
  for (const n of nodes) {
    if (typeof n === 'string') {
      out += escapeHtml(n).replace(/&quot;/g, '"');
      continue;
    }
    if (DROP_WITH_CONTENT.has(n.tag)) continue;
    const allowed = ALLOWED[n.tag];
    if (!allowed) {
      out += renderSafe(n.children); // unwrap unknown tags, keep their text
      continue;
    }
    let attrs = '';
    for (const [k, v] of Object.entries(n.attrs)) {
      if (k === 'style') {
        const s = sanitizeStyle(v);
        if (s) attrs += ` style="${escapeHtml(s)}"`;
      } else if (k === 'class') {
        const cls = v.split(/\s+/).filter((c) => /^cc-[\w-]+$/.test(c));
        if (cls.length) attrs += ` class="${cls.join(' ')}"`;
      } else if (k === 'title' || k === 'dir' || k === 'lang') {
        if (GLOBAL_ATTRS.includes(k) && /^[\w .,:;!?'()-]{0,200}$/.test(v)) attrs += ` ${k}="${escapeHtml(v)}"`;
      } else if (k === 'href' && n.tag === 'a') {
        const url = safeUrl(decodeEntities(v));
        if (url) attrs += ` href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"`;
      } else if (allowed.includes(k) && /^[\w%.#-]{0,20}$/.test(v)) {
        attrs += ` ${k}="${escapeHtml(v)}"`;
      }
    }
    if (n.tag === 'br' || n.tag === 'hr') out += `<${n.tag}${attrs}>`;
    else out += `<${n.tag}${attrs}>${renderSafe(n.children)}</${n.tag}>`;
  }
  return out;
}

/** Sanitize arbitrary HTML to an allowlisted, script-free, network-free subset. */
export function sanitizeHtml(html: string): string {
  return renderSafe(parseHtml(html));
}
