/** TipTap JSON -> Slack mrkdwn text (and the shared block walker used by the plain/blocks fallbacks). */
import type { ComposeDoc, DocMark, DocNode, SerializeResult, SlackPayload } from './types';
import { SLACK_TEXT_LIMIT } from './types';
import { Collector, ZWSP, inlineItems, safeUrl, type InlineItem, type MentionInfo, utf8Bytes } from './util';

export const BULLET = '•';
export const INDENT = '    ';

export function escapeMrkdwn(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const isWord = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}]/u.test(c);

/** Insert a ZWSP after literal formatting characters that Slack could mistake for delimiters. */
function guardLiteral(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    out += c;
    if (c === '`') out += ZWSP;
    else if (c === '*' || c === '_' || c === '~') {
      if (!(isWord(s[i - 1]) && isWord(s[i + 1]))) out += ZWSP;
    }
  }
  return out;
}

export function mentionToMrkdwn(m: MentionInfo, col: Collector): string {
  switch (m.kind) {
    case 'user':
      return `<@${m.id}>`;
    case 'channel':
      return `<#${m.id}>`;
    case 'usergroup':
      return `<!subteam^${m.id}>`;
    case 'special':
      col.warn({
        code: 'broadcast_mention',
        message: `@${m.id} notifies everyone in the conversation`,
      });
      return `<!${m.id}>`;
  }
}

interface Run {
  text: string; // already escaped mrkdwn for this atom
  styles: string[]; // outer -> inner among strike, italic, bold
  link?: string;
}

const STYLE_CH: Record<string, string> = { strike: '~', italic: '_', bold: '*' };
const STYLE_ORDER = ['strike', 'italic', 'bold'];

function toRuns(items: InlineItem[], col: Collector): (Run | { br: true })[] {
  const runs: (Run | { br: true })[] = [];
  const push = (text: string, marks: DocMark[], link?: string) => {
    const styles = STYLE_ORDER.filter((s) => marks.some((m) => m.type === s));
    runs.push({ text, styles, ...(link ? { link } : {}) });
  };
  for (const it of items) {
    if (it.t === 'br') {
      runs.push({ br: true });
      continue;
    }
    if (it.t === 'mention') {
      const marks = it.marks.filter((m) => m.type !== 'link' && m.type !== 'code');
      push(mentionToMrkdwn(it.info, col), marks);
      continue;
    }
    const hasCode = it.marks.some((m) => m.type === 'code');
    if (hasCode) {
      for (const m of it.marks) {
        if (m.type === 'code') continue;
        if (m.type === 'link') col.note('mark', 'link on code', 'code');
        else col.note('mark', `${m.type} on code`, 'code');
      }
      const body = it.text.replace(/`/g, `'`);
      if (body !== it.text) col.note('node', 'backtick in code', 'apostrophe');
      runs.push({ text: '`' + escapeMrkdwn(body) + '`', styles: [] });
      continue;
    }
    const link = it.marks.find((x) => x.type === 'link')?.attrs?.href;
    const safe = typeof link === 'string' ? safeUrl(link) : null;
    if (typeof link === 'string' && !safe) {
      col.note('link', 'unsafe link', 'text');
      col.warn({ code: 'unsafe_link', message: 'A link with an unsupported scheme was sent as plain text' });
    }
    if (safe) {
      // Link labels are literal in Slack: no formatting guard needed.
      push(escapeMrkdwn(it.text), it.marks, safe);
    } else {
      push(guardLiteral(escapeMrkdwn(it.text)), it.marks);
    }
  }
  // Whitespace-only runs keep only the styles shared with both neighbours, so delimiters never wrap bare spaces.
  runs.forEach((r, i) => {
    if ('br' in r || r.link || !/^\s+$/.test(r.text)) return;
    const prev = runs[i - 1];
    const next = runs[i + 1];
    r.styles = prev && next && !('br' in prev) && !('br' in next) ? r.styles.filter((x) => prev.styles.includes(x) && next.styles.includes(x)) : [];
  });
  // merge adjacent runs with identical style+link so delimiters are not repeated
  const merged: (Run | { br: true })[] = [];
  for (const r of runs) {
    const p = merged[merged.length - 1];
    if (p && !('br' in p) && !('br' in r) && p.link === r.link && p.styles.join() === r.styles.join()) {
      p.text += r.text;
    } else merged.push({ ...r });
  }
  return merged;
}

/** Serialize inline content to mrkdwn using a delimiter stack so nested marks stay well-formed. */
export function inlineToMrkdwn(content: DocNode[] | undefined, col: Collector, extra: DocMark[] = []): string {
  const runs = toRuns(inlineItems(content, extra), col);
  let out = '';
  const stack: string[] = [];
  const closeTo = (n: number) => {
    while (stack.length > n) {
      const ch = STYLE_CH[stack.pop()!]!;
      const ws = /\s*$/.exec(out)![0];
      out = out.slice(0, out.length - ws.length) + ch + ws; // closing delimiter hugs the text
    }
  };
  runs.forEach((r, idx) => {
    if ('br' in r) {
      closeTo(0);
      out += '\n';
      return;
    }
    let k = 0;
    while (k < stack.length && r.styles.includes(stack[k]!)) k++;
    closeTo(k);
    // Open the longest-lived marks first so adjacent runs can share delimiters.
    const lifetime = (st: string) => {
      let n = 0;
      for (let j = idx; j < runs.length; j++) {
        const x = runs[j]!;
        if ('br' in x || !x.styles.includes(st)) break;
        n++;
      }
      return n;
    };
    const rem = r.styles.filter((st) => !stack.includes(st));
    rem.sort((a, b) => lifetime(b) - lifetime(a) || STYLE_ORDER.indexOf(a) - STYLE_ORDER.indexOf(b));
    let body = r.text;
    if (rem.length && !r.link) {
      const lead = /^\s*/.exec(body)![0];
      out += lead;
      body = body.slice(lead.length);
    }
    for (const st of rem) {
      out += STYLE_CH[st];
      stack.push(st);
    }
    if (r.link) {
      const url = escapeMrkdwn(r.link);
      out += body === url ? `<${url}>` : `<${url}|${body}>`;
    } else out += body;
  });
  closeTo(0);
  return out;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function boldAll(): DocMark[] {
  return [{ type: 'bold' }];
}

export function cellText(cell: DocNode, col: Collector): string {
  const parts = (cell.content ?? []).map((b) => inlineToMrkdwn(b.content, col));
  return parts.join(' ').replace(/\n/g, ' ');
}

function tableToBullets(table: DocNode, col: Collector): string {
  col.note('node', 'table', 'bullets');
  const rows = (table.content ?? []).filter((r) => r.type === 'tableRow');
  const first = rows[0];
  const hasHeader = !!first && (first.content ?? []).some((c) => c.type === 'tableHeader');
  const headers = hasHeader ? (first!.content ?? []).map((c) => cellText(c, col)) : [];
  return rows
    .slice(hasHeader ? 1 : 0)
    .map((r) => {
      const cells = (r.content ?? []).map((c) => cellText(c, col));
      const body = hasHeader
        ? cells.map((c, i) => (headers[i] ? `${headers[i]}: ${c}` : c)).join('; ')
        : cells.join(' | ');
      return `${BULLET} ${body}`;
    })
    .join('\n');
}

function listToLines(list: DocNode, depth: number, col: Collector): string[] {
  const lines: string[] = [];
  const ordered = list.type === 'orderedList';
  const start = Number(list.attrs?.start ?? 1);
  (list.content ?? []).forEach((item, idx) => {
    const marker = ordered ? `${start + idx}.` : BULLET;
    const indent = INDENT.repeat(depth);
    const pad = indent + ' '.repeat(marker.length + 1);
    let first = true;
    for (const child of item.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        if (first) {
          lines.push(`${indent}${marker} `.trimEnd());
          first = false;
        }
        lines.push(...listToLines(child, depth + 1, col));
        continue;
      }
      const body = blockToMrkdwn(child, col);
      if (first) {
        const [head = '', ...rest] = body.split('\n');
        lines.push(`${indent}${marker} ${head}`.trimEnd(), ...rest.map((l) => pad + l));
        first = false;
      } else {
        lines.push(...body.split('\n').map((l) => pad + l));
      }
    }
    if (first) lines.push(`${indent}${marker}`);
  });
  return lines;
}

export function blockToMrkdwn(node: DocNode, col: Collector): string {
  switch (node.type) {
    case 'paragraph':
      return inlineToMrkdwn(node.content, col);
    case 'heading':
      col.note('node', 'heading', 'bold line');
      return inlineToMrkdwn(node.content, col, boldAll());
    case 'bulletList':
    case 'orderedList':
      return listToLines(node, 0, col).join('\n');
    case 'blockquote': {
      const inner = blocksToMrkdwn(node.content ?? [], col);
      return inner
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n');
    }
    case 'codeBlock': {
      const raw = (node.content ?? []).map((c) => c.text ?? '').join('');
      let body = escapeMrkdwn(raw);
      if (body.includes('```')) {
        body = body.replace(/```/g, '`' + ZWSP + '``');
        col.note('node', 'fence in code', 'broken fence');
      }
      return '```\n' + body + '\n```';
    }
    case 'table':
      return tableToBullets(node, col);
    case 'horizontalRule':
      col.note('node', 'horizontal rule', 'line');
      return '———';
    default: {
      if (node.content?.length) {
        col.note('node', node.type, 'text');
        const hasBlocks = node.content.some((c) => c.type !== 'text' && c.type !== 'hardBreak' && c.type !== 'mention');
        return hasBlocks ? blocksToMrkdwn(node.content, col) : inlineToMrkdwn(node.content, col);
      }
      return '';
    }
  }
}

export function blocksToMrkdwn(blocks: DocNode[], col: Collector): string {
  return blocks
    .map((b) => blockToMrkdwn(b, col))
    .filter((s) => s !== '')
    .join('\n\n');
}

export function serializeSlackMrkdwn(doc: DocNode): SerializeResult<SlackPayload> {
  const col = new Collector();
  const text = blocksToMrkdwn(doc.content ?? [], col);
  if (utf8Bytes(text) > SLACK_TEXT_LIMIT) {
    col.warn({ code: 'size_exceeded', message: `Message is over Slack's ${SLACK_TEXT_LIMIT.toLocaleString('en-US')} character limit` });
  }
  return { payload: { text }, lossy: col.notes(), warnings: col.warnings };
}

export type { ComposeDoc };
