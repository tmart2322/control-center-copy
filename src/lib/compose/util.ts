/** Shared helpers: doc normalization, mention resolution, URL safety, lossy collection. */
import type { ComposeDoc, ComposeWarning, DocMark, DocNode, LossyNote } from './types';

export const ZWSP = '\u200b';

// ---------------------------------------------------------------------------
// Lossy / warning collectors
// ---------------------------------------------------------------------------

export class Collector {
  private lossy = new Map<string, LossyNote>();
  readonly warnings: ComposeWarning[] = [];

  note(kind: LossyNote['kind'], from: string, to: string, count = 1): void {
    const key = `${kind}|${from}|${to}`;
    const cur = this.lossy.get(key);
    if (cur) cur.count += count;
    else this.lossy.set(key, { kind, from, to, count });
  }
  warn(w: ComposeWarning): void {
    const cur = this.warnings.find((x) => x.code === w.code && x.message === w.message);
    if (cur) cur.count = (cur.count ?? 1) + (w.count ?? 1);
    else this.warnings.push({ ...w });
  }
  notes(): LossyNote[] {
    return [...this.lossy.values()];
  }
}

// ---------------------------------------------------------------------------
// Marks, text, normalization
// ---------------------------------------------------------------------------

export const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'code'] as const;
const MARK_ALIASES: Record<string, string> = { b: 'bold', strong: 'bold', i: 'italic', em: 'italic', s: 'strike' };

function canonMark(m: DocMark): DocMark {
  const type = MARK_ALIASES[m.type] ?? m.type;
  if (type === 'link') {
    const href = typeof m.attrs?.href === 'string' ? m.attrs.href : '';
    return { type, attrs: { href } };
  }
  return { type };
}

function marksKey(marks: DocMark[] | undefined): string {
  return JSON.stringify((marks ?? []).map((m) => [m.type, m.attrs?.href ?? null]));
}

function sortMarks(marks: DocMark[]): DocMark[] {
  const rank = (t: string) => {
    const i = (MARK_ORDER as readonly string[]).indexOf(t);
    return i === -1 ? 99 : i;
  };
  const seen = new Set<string>();
  return marks
    .map(canonMark)
    .filter((m) => {
      const k = m.type === 'link' ? `link:${m.attrs?.href}` : m.type;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => rank(a.type) - rank(b.type));
}

export type MentionKind = 'user' | 'channel' | 'usergroup' | 'special';
export interface MentionInfo {
  kind: MentionKind;
  id: string;
  label: string;
  email?: string;
}

/** Interpret a TipTap `mention` node (attrs: id, label, optional kind/email). */
export function mentionInfo(node: DocNode): MentionInfo {
  const a = node.attrs ?? {};
  const id = String(a.id ?? '');
  const label = String(a.label ?? id);
  const email = typeof a.email === 'string' && a.email ? a.email : undefined;
  let kind = a.kind as MentionKind | undefined;
  if (kind !== 'user' && kind !== 'channel' && kind !== 'usergroup' && kind !== 'special') {
    if (['here', 'channel', 'everyone'].includes(id)) kind = 'special';
    else if (/^S[A-Z0-9]+$/.test(id)) kind = 'usergroup';
    else if (/^[CG][A-Z0-9]+$/.test(id)) kind = 'channel';
    else kind = 'user';
  }
  return { kind, id, label, ...(email ? { email } : {}) };
}

const BLOCK_DEFAULTS = (n: DocNode): Record<string, unknown> | undefined => {
  const a = n.attrs ?? {};
  switch (n.type) {
    case 'heading':
      return { level: Number(a.level ?? 1) };
    case 'orderedList': {
      const start = Number(a.start ?? 1);
      return start === 1 ? undefined : { start };
    }
    case 'codeBlock':
      return typeof a.language === 'string' && a.language ? { language: a.language } : undefined;
    case 'mention': {
      const m = mentionInfo(n);
      return { id: m.id, label: m.label, kind: m.kind, ...(m.email ? { email: m.email } : {}) };
    }
    case 'tableHeader':
    case 'tableCell':
      return undefined;
    default:
      return undefined;
  }
};

function normNodes(nodes: DocNode[], dropEmptyParagraphs: boolean): DocNode[] {
  const out: DocNode[] = [];
  for (const n of nodes) {
    if (n.type === 'text') {
      if (!n.text) continue;
      const marks = sortMarks(n.marks ?? []);
      const prev = out[out.length - 1];
      if (prev && prev.type === 'text' && marksKey(prev.marks) === marksKey(marks)) {
        prev.text += n.text;
      } else {
        out.push({ type: 'text', text: n.text, ...(marks.length ? { marks } : {}) });
      }
      continue;
    }
    const attrs = BLOCK_DEFAULTS(n);
    const node: DocNode = { type: n.type };
    if (attrs) node.attrs = attrs;
    if (n.marks?.length) node.marks = sortMarks(n.marks);
    if (n.content) {
      const keepEmpty = !(n.type === 'blockquote' || n.type === 'doc');
      node.content = normNodes(n.content, !keepEmpty);
    }
    if (dropEmptyParagraphs && n.type === 'paragraph' && !(node.content && node.content.length)) continue;
    out.push(node);
  }
  return out;
}

/** Canonical form of a doc: merged text runs, ordered marks, default attrs removed, top-level empties dropped. */
export function normalizeDoc(doc: DocNode): ComposeDoc {
  return { type: 'doc', content: normNodes(doc.content ?? [], true) };
}

export function docFromBlocks(blocks: DocNode[]): ComposeDoc {
  return normalizeDoc({ type: 'doc', content: blocks });
}

export const text = (t: string, marks?: DocMark[]): DocNode => ({ type: 'text', text: t, ...(marks?.length ? { marks } : {}) });
export const paragraph = (...content: DocNode[]): DocNode => ({ type: 'paragraph', content });

// ---------------------------------------------------------------------------
// Inline flattening
// ---------------------------------------------------------------------------

export type InlineItem =
  | { t: 'text'; text: string; marks: DocMark[] }
  | { t: 'br' }
  | { t: 'mention'; info: MentionInfo; marks: DocMark[] };

/** Flatten the inline children of a block into text/br/mention items with canonical marks. */
export function inlineItems(content: DocNode[] | undefined, extraMarks: DocMark[] = []): InlineItem[] {
  const out: InlineItem[] = [];
  const walk = (nodes: DocNode[], inherited: DocMark[]) => {
    for (const n of nodes) {
      if (n.type === 'text') {
        if (n.text) out.push({ t: 'text', text: n.text, marks: sortMarks([...inherited, ...(n.marks ?? [])]) });
      } else if (n.type === 'hardBreak') out.push({ t: 'br' });
      else if (n.type === 'mention') out.push({ t: 'mention', info: mentionInfo(n), marks: sortMarks([...inherited, ...(n.marks ?? [])]) });
      else if (n.content) walk(n.content, inherited); // unknown inline wrapper: keep its text
    }
  };
  walk(content ?? [], extraMarks);
  return out;
}

export function plainOfInline(content: DocNode[] | undefined): string {
  return inlineItems(content)
    .map((i) => (i.t === 'text' ? i.text : i.t === 'br' ? '\n' : i.info.label))
    .join('');
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

/** Returns a normalized safe URL or null (only http, https, mailto, tel). Encodes chars that break wrappers. */
export function safeUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const href = raw.trim();
  if (!/^(https?:|mailto:|tel:)/i.test(href)) return null;
  if (/[\u0000-\u001f\u007f]/.test(href)) return null;
  return href.replace(/ /g, '%20').replace(/\|/g, '%7C').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/"/g, '%22');
}

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Deterministic JSON (sorted keys) for "View payload" / hashing. */
export function stableStringify(v: unknown, space?: number): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === 'object') {
      return Object.fromEntries(
        Object.entries(x as Record<string, unknown>)
          .filter(([, val]) => val !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, sort(val)]),
      );
    }
    return x;
  };
  return JSON.stringify(sort(v), null, space);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
