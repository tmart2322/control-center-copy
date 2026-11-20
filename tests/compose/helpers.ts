import type { ComposeDoc, DocMark, DocNode } from '@/lib/compose/types';

export const t = (text: string, ...marks: (string | DocMark)[]): DocNode => ({
  type: 'text',
  text,
  ...(marks.length ? { marks: marks.map((m) => (typeof m === 'string' ? { type: m } : m)) } : {}),
});
export const link = (href: string): DocMark => ({ type: 'link', attrs: { href } });
export const p = (...c: DocNode[]): DocNode => ({ type: 'paragraph', content: c });
export const h = (level: number, ...c: DocNode[]): DocNode => ({ type: 'heading', attrs: { level }, content: c });
export const li = (...c: DocNode[]): DocNode => ({ type: 'listItem', content: c });
export const ul = (...items: DocNode[]): DocNode => ({ type: 'bulletList', content: items });
export const ol = (items: DocNode[], start = 1): DocNode => ({ type: 'orderedList', attrs: { start }, content: items });
export const bq = (...c: DocNode[]): DocNode => ({ type: 'blockquote', content: c });
export const code = (src: string, language?: string): DocNode => ({
  type: 'codeBlock',
  ...(language ? { attrs: { language } } : {}),
  content: [{ type: 'text', text: src }],
});
export const br = (): DocNode => ({ type: 'hardBreak' });
export const mention = (id: string, label = id, extra: Record<string, unknown> = {}): DocNode => ({
  type: 'mention',
  attrs: { id, label, ...extra },
});
export const cell = (txt: string, header = false): DocNode => ({
  type: header ? 'tableHeader' : 'tableCell',
  content: [p(t(txt))],
});
export const table = (...rows: DocNode[][]): DocNode => ({
  type: 'table',
  content: rows.map((r) => ({ type: 'tableRow', content: r })),
});
export const doc = (...c: DocNode[]): ComposeDoc => ({ type: 'doc', content: c });

export const SLACK = { kind: 'slack' as const, channelId: 'C123', format: 'mrkdwn' as const };
export const SLACK_BLOCKS = { kind: 'slack' as const, channelId: 'C123', format: 'blocks' as const };
export const SLACK_AUTO = { kind: 'slack' as const, channelId: 'C123' };
export const EMAIL = { kind: 'email' as const, to: ['dana@example.com'], subject: 'Hi' };
export const PLAIN = { kind: 'plain' as const };
