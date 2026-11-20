/** TipTap JSON -> Slack `rich_text` block (real lists, code, quotes) plus an mrkdwn fallback `text`. */
import type {
  DocMark,
  DocNode,
  RichTextBlockElement,
  RichTextElement,
  RichTextSection,
  RichTextStyle,
  SerializeResult,
  SlackPayload,
} from './types';
import { SLACK_TEXT_LIMIT } from './types';
import { Collector, inlineItems, plainOfInline, safeUrl, utf8Bytes, type InlineItem } from './util';
import { blocksToMrkdwn } from './slack-mrkdwn';

function styleOf(marks: DocMark[]): RichTextStyle | undefined {
  const s: RichTextStyle = {};
  if (marks.some((m) => m.type === 'bold')) s.bold = true;
  if (marks.some((m) => m.type === 'italic')) s.italic = true;
  if (marks.some((m) => m.type === 'strike')) s.strike = true;
  if (marks.some((m) => m.type === 'code')) s.code = true;
  return Object.keys(s).length ? s : undefined;
}

const sameStyle = (a?: RichTextStyle, b?: RichTextStyle) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
const withStyle = <T extends object>(el: T, style?: RichTextStyle): T => (style ? { ...el, style } : el);

export function inlineToElements(content: DocNode[] | undefined, col: Collector, extra: DocMark[] = []): RichTextElement[] {
  const out: RichTextElement[] = [];
  const pushText = (t: string, style?: RichTextStyle) => {
    const last = out[out.length - 1];
    if (last && last.type === 'text' && sameStyle(last.style, style)) last.text += t;
    else out.push(withStyle({ type: 'text' as const, text: t }, style));
  };
  for (const it of inlineItems(content, extra) as InlineItem[]) {
    if (it.t === 'br') {
      pushText('\n');
      continue;
    }
    if (it.t === 'text') {
      const style = styleOf(it.marks);
      const href = it.marks.find((m) => m.type === 'link')?.attrs?.href;
      if (typeof href === 'string') {
        const url = safeUrl(href);
        if (url) {
          out.push(withStyle({ type: 'link' as const, url, ...(it.text !== url ? { text: it.text } : {}) }, style));
          continue;
        }
        col.note('link', 'unsafe link', 'text');
        col.warn({ code: 'unsafe_link', message: 'A link with an unsupported scheme was sent as plain text' });
      }
      pushText(it.text, style);
      continue;
    }
    const m = it.info;
    const style = styleOf(it.marks.filter((x) => x.type !== 'link'));
    switch (m.kind) {
      case 'user':
        out.push(withStyle({ type: 'user' as const, user_id: m.id }, style));
        break;
      case 'channel':
        out.push(withStyle({ type: 'channel' as const, channel_id: m.id }, style));
        break;
      case 'usergroup':
        out.push(withStyle({ type: 'usergroup' as const, usergroup_id: m.id }, style));
        break;
      case 'special':
        col.warn({ code: 'broadcast_mention', message: `@${m.id} notifies everyone in the conversation` });
        out.push({ type: 'broadcast', range: m.id as 'here' | 'channel' | 'everyone' });
        break;
    }
  }
  return out;
}

const textEl = (text: string, style?: RichTextStyle): RichTextElement => withStyle({ type: 'text' as const, text }, style);

function sectionTextBlocks(node: DocNode, col: Collector): RichTextElement[] {
  switch (node.type) {
    case 'paragraph':
      return inlineToElements(node.content, col);
    case 'heading':
      col.note('node', 'heading', 'bold line');
      return inlineToElements(node.content, col, [{ type: 'bold' }]);
    case 'horizontalRule':
      col.note('node', 'horizontal rule', 'line');
      return [textEl('———')];
    default:
      col.note('node', node.type, 'text');
      return [textEl(plainOfInline(node.content))];
  }
}

function flattenText(node: DocNode, col: Collector): RichTextElement[] {
  // Quote contents: paragraphs kept; other nested blocks reduced to their text.
  const out: RichTextElement[] = [];
  (node.content ?? []).forEach((b, i) => {
    if (i > 0) out.push(textEl('\n\n'));
    if (b.type === 'paragraph') out.push(...inlineToElements(b.content, col));
    else if (b.type === 'heading') out.push(...sectionTextBlocks(b, col));
    else {
      col.note('node', `${b.type} in quote`, 'text');
      out.push(textEl(blocksToMrkdwn([b], new Collector())));
    }
  });
  return mergeText(out);
}

function mergeText(els: RichTextElement[]): RichTextElement[] {
  const out: RichTextElement[] = [];
  for (const e of els) {
    const last = out[out.length - 1];
    if (last && last.type === 'text' && e.type === 'text' && sameStyle(last.style, e.style)) last.text += e.text;
    else out.push({ ...e });
  }
  return out;
}

function emitList(list: DocNode, indent: number, col: Collector, out: RichTextBlockElement[]): void {
  const ordered = list.type === 'orderedList';
  const style = ordered ? 'ordered' : 'bullet';
  let count = ordered ? Number(list.attrs?.start ?? 1) - 1 : 0;
  let chunk: Extract<RichTextBlockElement, { type: 'rich_text_list' }> | null = null;
  const flush = () => {
    if (chunk && chunk.elements.length) out.push(chunk);
    chunk = null;
  };
  const begin = () => {
    chunk = { type: 'rich_text_list', style, indent, ...(ordered && count > 0 ? { offset: count } : {}), elements: [] };
  };
  for (const item of list.content ?? []) {
    if (!chunk) begin();
    const els: RichTextElement[] = [];
    const nested: DocNode[] = [];
    (item.content ?? []).forEach((c) => {
      if (c.type === 'bulletList' || c.type === 'orderedList') nested.push(c);
      else {
        if (els.length) els.push(textEl('\n'));
        els.push(...sectionTextBlocks(c, col));
      }
    });
    const section: RichTextSection = { type: 'rich_text_section', elements: mergeText(els) };
    chunk!.elements.push(section);
    count++;
    if (nested.length) {
      flush();
      for (const n of nested) emitList(n, indent + 1, col, out);
    }
  }
  flush();
}

function tableAsList(table: DocNode, col: Collector): DocNode {
  col.note('node', 'table', 'bullets');
  const rows = (table.content ?? []).filter((r) => r.type === 'tableRow');
  const hasHeader = !!rows[0] && (rows[0].content ?? []).some((c) => c.type === 'tableHeader');
  const cellTxt = (c: DocNode) => (c.content ?? []).map((b) => plainOfInline(b.content)).join(' ');
  const headers = hasHeader ? (rows[0]!.content ?? []).map(cellTxt) : [];
  return {
    type: 'bulletList',
    content: rows.slice(hasHeader ? 1 : 0).map((r) => {
      const cells = (r.content ?? []).map(cellTxt);
      const body = hasHeader ? cells.map((c, i) => (headers[i] ? `${headers[i]}: ${c}` : c)).join('; ') : cells.join(' | ');
      return { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }] };
    }),
  };
}

export function serializeSlackBlocks(doc: DocNode): SerializeResult<SlackPayload> {
  const col = new Collector();
  const elements: RichTextBlockElement[] = [];
  let pending: RichTextElement[] | null = null; // consecutive textual blocks merge into one section

  const flushSection = (followedByOther: boolean) => {
    if (!pending) return;
    const els = mergeText(followedByOther ? [...pending, textEl('\n')] : pending);
    elements.push({ type: 'rich_text_section', elements: els });
    pending = null;
  };

  for (const node of doc.content ?? []) {
    switch (node.type) {
      case 'paragraph':
      case 'heading':
      case 'horizontalRule': {
        const els = sectionTextBlocks(node, col);
        if (!els.length) break;
        pending = pending ? [...pending, textEl('\n\n'), ...els] : els;
        break;
      }
      case 'bulletList':
      case 'orderedList':
        flushSection(true);
        emitList(node, 0, col, elements);
        break;
      case 'table':
        flushSection(true);
        emitList(tableAsList(node, col), 0, col, elements);
        break;
      case 'blockquote':
        flushSection(true);
        elements.push({ type: 'rich_text_quote', elements: flattenText(node, col) });
        break;
      case 'codeBlock':
        flushSection(true);
        elements.push({
          type: 'rich_text_preformatted',
          elements: [textEl((node.content ?? []).map((c) => c.text ?? '').join(''))],
        });
        break;
      default: {
        const els = sectionTextBlocks(node, col);
        if (els.length) pending = pending ? [...pending, textEl('\n\n'), ...els] : els;
      }
    }
  }
  flushSection(false);

  // Fallback text: same doc as mrkdwn (its lossy notes are subsumed by the block pass).
  const fallback = blocksToMrkdwn(doc.content ?? [], new Collector());
  if (utf8Bytes(fallback) > SLACK_TEXT_LIMIT) {
    col.warn({ code: 'size_exceeded', message: `Message is over Slack's ${SLACK_TEXT_LIMIT.toLocaleString('en-US')} character limit` });
  }
  const payload: SlackPayload = elements.length ? { text: fallback, blocks: [{ type: 'rich_text', elements }] } : { text: fallback };
  return { payload, lossy: col.notes(), warnings: col.warnings };
}
