import { z } from 'zod';

/**
 * The subset of TipTap / ProseMirror JSON that NBA drafts may use (UI-SPEC §7).
 * The composer (FE-2) owns rendering; this module only validates shape and per-destination
 * capability, and gives the validators a plain-text view.
 */

export type Mark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'strike' }
  | { type: 'code' }
  | { type: 'link'; attrs: { href: string } };

export type InlineNode =
  | { type: 'text'; text: string; marks?: Mark[] }
  | { type: 'hardBreak' }
  | { type: 'mention'; attrs: { id: string; label: string; kind?: 'slack_user' | 'slack_channel' | 'usergroup' | 'email' } };

export type BlockNode =
  | { type: 'paragraph'; content?: InlineNode[] }
  | { type: 'heading'; attrs: { level: number }; content?: InlineNode[] }
  | { type: 'bulletList'; content: ListItemNode[] }
  | { type: 'orderedList'; attrs?: { start?: number }; content: ListItemNode[] }
  | { type: 'blockquote'; content: BlockNode[] }
  | { type: 'codeBlock'; content?: Array<{ type: 'text'; text: string }> }
  | { type: 'horizontalRule' };

export interface ListItemNode {
  type: 'listItem';
  content: BlockNode[];
}

export interface TipTapDoc {
  type: 'doc';
  content: BlockNode[];
}

const markSchema: z.ZodType<Mark> = z.union([
  z.object({ type: z.literal('bold') }),
  z.object({ type: z.literal('italic') }),
  z.object({ type: z.literal('strike') }),
  z.object({ type: z.literal('code') }),
  z.object({ type: z.literal('link'), attrs: z.object({ href: z.string().min(1) }) }),
]);

const textNode = z.object({ type: z.literal('text'), text: z.string(), marks: z.array(markSchema).optional() });

const inlineSchema: z.ZodType<InlineNode> = z.union([
  textNode,
  z.object({ type: z.literal('hardBreak') }),
  z.object({
    type: z.literal('mention'),
    attrs: z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      kind: z.enum(['slack_user', 'slack_channel', 'usergroup', 'email']).optional(),
    }),
  }),
]);

const listItemSchema: z.ZodType<ListItemNode> = z.lazy(() =>
  z.object({ type: z.literal('listItem'), content: z.array(blockSchema).min(1) }),
);

const blockSchema: z.ZodType<BlockNode> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal('paragraph'), content: z.array(inlineSchema).optional() }),
    z.object({
      type: z.literal('heading'),
      attrs: z.object({ level: z.number().int().min(1).max(6) }),
      content: z.array(inlineSchema).optional(),
    }),
    z.object({ type: z.literal('bulletList'), content: z.array(listItemSchema).min(1) }),
    z.object({
      type: z.literal('orderedList'),
      attrs: z.object({ start: z.number().int().optional() }).optional(),
      content: z.array(listItemSchema).min(1),
    }),
    z.object({ type: z.literal('blockquote'), content: z.array(blockSchema).min(1) }),
    z.object({ type: z.literal('codeBlock'), content: z.array(textNode).optional() }),
    z.object({ type: z.literal('horizontalRule') }),
  ]),
);

export const tipTapDocSchema: z.ZodType<TipTapDoc> = z.object({
  type: z.literal('doc'),
  content: z.array(blockSchema).min(1),
});

// ---------- Destination capability profiles (UI-SPEC §7) ----------

export type DocDestination = 'slack' | 'email';

export interface CapabilityIssue {
  path: string;
  issue: string;
}

/** Slack mrkdwn: no headings, no rules. Email HTML: headings h2/h3 only, no code blocks. */
export function checkDocForDestination(doc: TipTapDoc, dest: DocDestination): CapabilityIssue[] {
  const issues: CapabilityIssue[] = [];
  const visitBlocks = (blocks: BlockNode[], path: string) => {
    blocks.forEach((b, i) => {
      const p = `${path}[${i}]`;
      if (dest === 'slack' && b.type === 'heading') issues.push({ path: p, issue: 'Slack drafts cannot contain headings' });
      if (dest === 'slack' && b.type === 'horizontalRule') issues.push({ path: p, issue: 'Slack drafts cannot contain horizontal rules' });
      if (dest === 'email' && b.type === 'heading' && (b.attrs.level < 2 || b.attrs.level > 3))
        issues.push({ path: p, issue: 'Email headings must be level 2 or 3' });
      if (dest === 'email' && b.type === 'codeBlock') issues.push({ path: p, issue: 'Email drafts should not contain code blocks' });
      if (b.type === 'bulletList' || b.type === 'orderedList') b.content.forEach((li, j) => visitBlocks(li.content, `${p}.item[${j}]`));
      if (b.type === 'blockquote') visitBlocks(b.content, `${p}.quote`);
      if ('content' in b && Array.isArray(b.content) && (b.type === 'paragraph' || b.type === 'heading')) {
        for (const n of b.content ?? []) {
          if (n.type === 'mention' && dest === 'email' && n.attrs.kind && n.attrs.kind !== 'email')
            issues.push({ path: p, issue: `Email drafts cannot contain Slack mentions (${n.attrs.label})` });
        }
      }
    });
  };
  visitBlocks(doc.content, 'doc');
  return issues;
}

// ---------- Views used by validators and evals ----------

function inlineText(nodes: InlineNode[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'text') return n.text;
      if (n.type === 'hardBreak') return '\n';
      return `@${n.attrs.label}`;
    })
    .join('');
}

/** Plain-text rendering (Slack-ish), used for length checks, date guards and evals. */
export function docToPlainText(doc: TipTapDoc): string {
  const out: string[] = [];
  const walk = (blocks: BlockNode[], indent: string) => {
    for (const b of blocks) {
      switch (b.type) {
        case 'paragraph':
        case 'heading':
          out.push(indent + inlineText(b.content));
          break;
        case 'bulletList':
          for (const li of b.content) {
            const [first, ...rest] = li.content;
            if (first && (first.type === 'paragraph' || first.type === 'heading')) out.push(`${indent}• ${inlineText(first.content)}`);
            else if (first) walk([first], indent + '  ');
            walk(rest, indent + '  ');
          }
          break;
        case 'orderedList': {
          let n = b.attrs?.start ?? 1;
          for (const li of b.content) {
            const [first, ...rest] = li.content;
            if (first && (first.type === 'paragraph' || first.type === 'heading')) out.push(`${indent}${n}. ${inlineText(first.content)}`);
            else if (first) walk([first], indent + '  ');
            walk(rest, indent + '  ');
            n += 1;
          }
          break;
        }
        case 'blockquote':
          walk(b.content, indent + '> ');
          break;
        case 'codeBlock':
          out.push(indent + (b.content ?? []).map((t) => t.text).join(''));
          break;
        case 'horizontalRule':
          out.push(indent + '---');
          break;
      }
    }
  };
  walk(doc.content, '');
  return out.join('\n').trim();
}

/** Every link href in the doc (validators check these were not invented). */
export function docLinks(doc: TipTapDoc): string[] {
  const hrefs: string[] = [];
  const walk = (blocks: BlockNode[]) => {
    for (const b of blocks) {
      if (b.type === 'paragraph' || b.type === 'heading') {
        for (const n of b.content ?? []) {
          if (n.type === 'text') for (const m of n.marks ?? []) if (m.type === 'link') hrefs.push(m.attrs.href);
        }
      } else if (b.type === 'bulletList' || b.type === 'orderedList') {
        for (const li of b.content) walk(li.content);
      } else if (b.type === 'blockquote') walk(b.content);
    }
  };
  walk(doc.content);
  return hrefs;
}

/** Mentions in the doc (validators check the ids were provided). */
export function docMentions(doc: TipTapDoc): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  const walk = (blocks: BlockNode[]) => {
    for (const b of blocks) {
      if (b.type === 'paragraph' || b.type === 'heading') {
        for (const n of b.content ?? []) if (n.type === 'mention') out.push({ id: n.attrs.id, label: n.attrs.label });
      } else if (b.type === 'bulletList' || b.type === 'orderedList') for (const li of b.content) walk(li.content);
      else if (b.type === 'blockquote') walk(b.content);
    }
  };
  walk(doc.content);
  return out;
}

/** Minimal text → doc conversion for fixtures: blank line = paragraph break, "• "/"- " lines = bullets. */
export function plainTextToDoc(text: string): TipTapDoc {
  const content: BlockNode[] = [];
  const paras = text.split(/\n\s*\n/);
  for (const para of paras) {
    const lines = para.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    if (lines.every((l) => /^\s*([•\-*]|\d+\.)\s+/.test(l))) {
      const ordered = /^\s*\d+\./.test(lines[0] ?? '');
      const items: ListItemNode[] = lines.map((l) => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: l.replace(/^\s*([•\-*]|\d+\.)\s+/, '') }] }],
      }));
      content.push(ordered ? { type: 'orderedList', content: items } : { type: 'bulletList', content: items });
    } else {
      const inline: InlineNode[] = [];
      lines.forEach((l, i) => {
        if (i > 0) inline.push({ type: 'hardBreak' });
        inline.push({ type: 'text', text: l });
      });
      content.push({ type: 'paragraph', content: inline });
    }
  }
  if (content.length === 0) content.push({ type: 'paragraph', content: [] });
  return { type: 'doc', content };
}
