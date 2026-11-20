/** Slack mrkdwn -> TipTap JSON (quoting thread context, editing an imported draft). Inverse of serializeSlackMrkdwn. */
import type { ComposeDoc, DocMark, DocNode } from './types';
import { ZWSP, docFromBlocks } from './util';

export interface ParseSlackOptions {
  /** Resolve display labels for mentions, keyed by Slack id (U…, C…, S…). */
  labels?: Record<string, string>;
}

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

const DELIMS: Record<string, string> = { '*': 'bold', _: 'italic', '~': 'strike' };

function textNode(t: string, marks: DocMark[]): DocNode[] {
  const clean = t.split(ZWSP).join('');
  return clean ? [{ type: 'text', text: clean, ...(marks.length ? { marks } : {}) }] : [];
}

/** Find the closing delimiter for an opener at `i`, skipping code spans and <...> tokens. */
function findCloser(s: string, i: number, d: string): number {
  for (let j = i + 1; j < s.length; j++) {
    const c = s[j];
    if (c === '`') {
      const e = s.indexOf('`', j + 1);
      if (e === -1) return -1;
      j = e;
    } else if (c === '<') {
      const e = s.indexOf('>', j + 1);
      if (e !== -1) j = e;
    } else if (c === d && j > i + 1) {
      const prev = s[j - 1];
      const next = s[j + 1];
      if (!isSpace(prev) && prev !== ZWSP && next !== ZWSP && !isWord(next)) return j;
    }
  }
  return -1;
}

function parseToken(inner: string, marks: DocMark[], opts: ParseSlackOptions): DocNode[] | null {
  const pipe = inner.indexOf('|');
  const target = pipe === -1 ? inner : inner.slice(0, pipe);
  const label = pipe === -1 ? undefined : inner.slice(pipe + 1);
  const mark = (extra?: DocMark) => (extra ? [...marks.filter((m) => m.type !== 'link'), extra] : marks);
  const labels = opts.labels ?? {};
  let m: RegExpExecArray | null;
  if ((m = /^@([UW][A-Z0-9]+)$/.exec(target))) {
    const id = m[1]!;
    return [{ type: 'mention', attrs: { id, label: labels[id] ?? label ?? id, kind: 'user' }, ...(marks.length ? { marks: mark() } : {}) }];
  }
  if ((m = /^#([CG][A-Z0-9]+)$/.exec(target))) {
    const id = m[1]!;
    return [{ type: 'mention', attrs: { id, label: labels[id] ?? label ?? id, kind: 'channel' }, ...(marks.length ? { marks: mark() } : {}) }];
  }
  if ((m = /^!subteam\^(S[A-Z0-9]+)$/.exec(target))) {
    const id = m[1]!;
    const lbl = (labels[id] ?? label ?? id).replace(/^@/, '');
    return [{ type: 'mention', attrs: { id, label: lbl, kind: 'usergroup' }, ...(marks.length ? { marks: mark() } : {}) }];
  }
  if ((m = /^!(here|channel|everyone)$/.exec(target))) {
    const id = m[1]!;
    return [{ type: 'mention', attrs: { id, label: id, kind: 'special' }, ...(marks.length ? { marks: mark() } : {}) }];
  }
  if (/^(https?:|mailto:|tel:)/i.test(target)) {
    const url = unescape(target);
    const shown = label === undefined || label === '' ? url : unescape(label);
    return textNode(shown, mark({ type: 'link', attrs: { href: url } }));
  }
  return null;
}

export function parseInline(s: string, marks: DocMark[] = [], opts: ParseSlackOptions = {}): DocNode[] {
  const out: DocNode[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push(...textNode(unescape(buf), marks));
    buf = '';
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '\n') {
      flush();
      out.push({ type: 'hardBreak' });
    } else if (c === '`') {
      const e = s.indexOf('`', i + 1);
      if (e > i + 1 && s[i + 1] !== ZWSP) {
        flush();
        out.push(...textNode(unescape(s.slice(i + 1, e)), [...marks, { type: 'code' }]));
        i = e;
      } else buf += c;
    } else if (c === '<') {
      const e = s.indexOf('>', i + 1);
      const node = e === -1 ? null : parseToken(s.slice(i + 1, e), marks, opts);
      if (node) {
        flush();
        out.push(...node);
        i = e;
      } else buf += c;
    } else if (DELIMS[c] && !isWord(s[i - 1] === ZWSP ? undefined : s[i - 1]) && !isSpace(s[i + 1]) && s[i + 1] !== ZWSP && s[i + 1] !== c) {
      const e = findCloser(s, i, c);
      if (e !== -1) {
        flush();
        out.push(...parseInline(s.slice(i + 1, e), [...marks, { type: DELIMS[c]! }], opts));
        i = e;
      } else buf += c;
    } else buf += c;
  }
  flush();
  return out;
}

/**
 * List lines are the markers our serializer emits (and Slack's own exports use): bullets `•◦▪‣` and `1.`.
 * NOT "- ": Slack mrkdwn has no hyphen lists and shows the hyphen literally, so a "- " line stays text
 * (CONTRACT-1 fix; the preview must match what Slack renders).
 */
const LIST_RE = /^( *)(•|◦|▪|‣|\d+\.) (.*)$/;
const FENCE_RE = /^```/;

interface Item {
  indent: number;
  ordered: boolean;
  num: number;
  lines: string[];
}

function buildLists(items: Item[], opts: ParseSlackOptions): DocNode[] {
  const make = (i: number, indent: number): { nodes: DocNode[]; i: number } => {
    const nodes: DocNode[] = [];
    let cur: DocNode | null = null;
    while (i < items.length) {
      const it = items[i]!;
      if (it.indent < indent) break;
      if (it.indent > indent) {
        const sub = make(i, it.indent);
        const last = cur?.content?.[cur.content.length - 1];
        if (last) last.content = [...(last.content ?? []), ...sub.nodes];
        i = sub.i;
        continue;
      }
      const type = it.ordered ? 'orderedList' : 'bulletList';
      if (!cur || cur.type !== type) {
        cur = { type, ...(it.ordered && it.num !== 1 ? { attrs: { start: it.num } } : {}), content: [] };
        nodes.push(cur);
      }
      cur.content!.push({
        type: 'listItem',
        content: [{ type: 'paragraph', content: parseInline(it.lines.join('\n'), [], opts) }],
      });
      i++;
    }
    return { nodes, i };
  };
  return make(0, items[0]!.indent).nodes;
}

function parseBlocks(lines: string[], opts: ParseSlackOptions): DocNode[] {
  const blocks: DocNode[] = [];
  let i = 0;
  const startsBlock = (l: string) => FENCE_RE.test(l) || /^>/.test(l) || LIST_RE.test(l);
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
    } else if (FENCE_RE.test(line)) {
      const body: string[] = [];
      const first = line.slice(3);
      if (first.endsWith('```') && first.length >= 3) {
        blocks.push({ type: 'codeBlock', content: [{ type: 'text', text: unescape(first.slice(0, -3)) }] });
        i++;
        continue;
      }
      if (first.trim()) body.push(first);
      i++;
      while (i < lines.length && !lines[i]!.trimEnd().endsWith('```')) body.push(lines[i++]!);
      if (i < lines.length) {
        const tail = lines[i]!.trimEnd().slice(0, -3);
        if (tail) body.push(tail);
        i++;
      }
      const code = unescape(body.join('\n'));
      blocks.push({ type: 'codeBlock', ...(code ? { content: [{ type: 'text', text: code }] } : {}) });
    } else if (line.startsWith('>')) {
      const inner: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) inner.push(lines[i++]!.replace(/^> ?/, ''));
      blocks.push({ type: 'blockquote', content: parseBlocks(inner, opts) });
    } else if (LIST_RE.test(line)) {
      const items: Item[] = [];
      while (i < lines.length) {
        const l = lines[i]!;
        const m = LIST_RE.exec(l);
        if (m) {
          items.push({ indent: m[1]!.length, ordered: /\d/.test(m[2]!), num: parseInt(m[2]!, 10) || 1, lines: [m[3]!] });
          i++;
        } else if (/^ +\S/.test(l) && items.length) {
          items[items.length - 1]!.lines.push(l.trim());
          i++;
        } else break;
      }
      blocks.push(...buildLists(items, opts));
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== '' && (para.length === 0 || !startsBlock(lines[i]!))) para.push(lines[i++]!);
      blocks.push({ type: 'paragraph', content: parseInline(para.join('\n'), [], opts) });
    }
  }
  return blocks;
}

export function parseSlackMrkdwn(text: string, opts: ParseSlackOptions = {}): ComposeDoc {
  return docFromBlocks(parseBlocks(text.replace(/\r\n?/g, '\n').split('\n'), opts));
}
