/** TipTap JSON -> plain text (preview fallback, and the text/plain part of an email). */
import type { DocNode, PlainPayload, SerializeResult } from './types';
import { Collector, inlineItems, safeUrl } from './util';

const LIST_INDENT = '  ';

export function inlineToPlain(content: DocNode[] | undefined, col: Collector, reportMarks: boolean): string {
  let out = '';
  for (const it of inlineItems(content)) {
    if (it.t === 'br') {
      out += '\n';
      continue;
    }
    if (it.t === 'mention') {
      const m = it.info;
      out += m.kind === 'channel' ? `#${m.label}` : m.kind === 'special' ? `@${m.id}` : m.kind === 'usergroup' ? `@${m.label}` : `@${m.label}`;
      continue;
    }
    if (reportMarks) {
      for (const mk of it.marks) if (mk.type !== 'link') col.note('mark', mk.type, 'plain text');
    }
    const href = it.marks.find((m) => m.type === 'link')?.attrs?.href;
    const url = typeof href === 'string' ? safeUrl(href) : null;
    if (url && it.text.trim() !== url && it.text.trim() !== url.replace(/^mailto:/i, '')) {
      out += `${it.text} (${url})`;
      if (reportMarks) col.note('link', 'link', 'text (url)');
    } else out += it.text;
  }
  return out;
}

function listLines(list: DocNode, depth: number, col: Collector, report: boolean): string[] {
  const lines: string[] = [];
  const ordered = list.type === 'orderedList';
  const start = Number(list.attrs?.start ?? 1);
  (list.content ?? []).forEach((item, idx) => {
    const marker = ordered ? `${start + idx}.` : '-';
    const indent = LIST_INDENT.repeat(depth);
    const pad = indent + ' '.repeat(marker.length + 1);
    let first = true;
    for (const c of item.content ?? []) {
      if (c.type === 'bulletList' || c.type === 'orderedList') {
        if (first) {
          lines.push(`${indent}${marker}`);
          first = false;
        }
        lines.push(...listLines(c, depth + 1, col, report));
        continue;
      }
      const [head = '', ...rest] = blockToPlain(c, col, report).split('\n');
      if (first) {
        lines.push(`${indent}${marker} ${head}`.trimEnd(), ...rest.map((l) => pad + l));
        first = false;
      } else lines.push(...[head, ...rest].map((l) => pad + l));
    }
    if (first) lines.push(`${indent}${marker}`);
  });
  return lines;
}

export function blockToPlain(node: DocNode, col: Collector, report: boolean): string {
  switch (node.type) {
    case 'paragraph':
      return inlineToPlain(node.content, col, report);
    case 'heading':
      if (report) col.note('node', 'heading', 'text');
      return inlineToPlain(node.content, col, false);
    case 'bulletList':
    case 'orderedList':
      return listLines(node, 0, col, report).join('\n');
    case 'blockquote':
      return blocksToPlain(node.content ?? [], col, report)
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n');
    case 'codeBlock':
      return (node.content ?? []).map((c) => c.text ?? '').join('');
    case 'table': {
      if (report) col.note('node', 'table', 'text rows');
      return (node.content ?? [])
        .filter((r) => r.type === 'tableRow')
        .map((r) =>
          (r.content ?? [])
            .map((c) => (c.content ?? []).map((b) => inlineToPlain(b.content, col, false)).join(' ').replace(/\n/g, ' '))
            .join(' | '),
        )
        .join('\n');
    }
    case 'horizontalRule':
      return '---';
    default:
      if (node.content?.length) {
        if (report) col.note('node', node.type, 'text');
        return blocksToPlain(node.content, col, report) || inlineToPlain(node.content, col, false);
      }
      return '';
  }
}

export function blocksToPlain(blocks: DocNode[], col: Collector, report: boolean): string {
  return blocks
    .map((b) => blockToPlain(b, col, report))
    .filter((s) => s !== '')
    .join('\n\n');
}

export function serializePlain(doc: DocNode): SerializeResult<PlainPayload> {
  const col = new Collector();
  const text = blocksToPlain(doc.content ?? [], col, true);
  return { payload: { text }, lossy: col.notes(), warnings: col.warnings };
}

/** text/plain part for an email (no lossy reporting; the HTML is the primary body). */
export function plainTextOf(doc: DocNode): string {
  return blocksToPlain(doc.content ?? [], new Collector(), false);
}
