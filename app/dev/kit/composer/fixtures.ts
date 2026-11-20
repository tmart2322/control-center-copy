/**
 * Kit fixtures: small TipTap docs used to put seeded mock drafts into the states the gallery shows.
 * Placeholder names only (the committed example seed); nothing here is real customer data.
 */
import type { Destination, TipTapDoc, TipTapNode } from '@/contract';

const t = (text: string, ...marks: string[]): TipTapNode => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((m) => ({ type: m })) } : {}) });
const p = (...c: TipTapNode[]): TipTapNode => ({ type: 'paragraph', content: c });
const li = (...c: TipTapNode[]): TipTapNode => ({ type: 'listItem', content: [p(...c)] });
const ul = (...items: TipTapNode[]): TipTapNode => ({ type: 'bulletList', content: items });
const h = (level: number, text: string): TipTapNode => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const mention = (id: string, label: string, kind = 'user', email?: string): TipTapNode => ({ type: 'mention', attrs: { id, label, kind, ...(email ? { email } : {}) } });

/** Slack DM to the manager with a real bullet list: the payload switches to rich_text blocks. */
export const PRIYA_LIST_DOC: TipTapDoc = {
  type: 'doc',
  content: [
    p(t('Q4 forecast notes for our 1:1:')),
    ul(
      li(t('Globex D360 expansion: '), t('commit', 'bold'), t(', pricing goes out today')),
      li(t('ACME Phase 2: best case, demo at 13:00')),
      li(t('Umbrella Patient 360: technical validation this week')),
    ),
    p(t('Can we spend five minutes on the ACME risk? '), mention('U0RAJ', 'Raj Mehta'), t(' has the latest.')),
  ],
};

/** An email with a heading, a list and an email mention: switching it to Slack is lossy. */
export const ONEPAGER_RICH_DOC: TipTapDoc = {
  type: 'doc',
  content: [
    p(t('Hi Dana,')),
    h(2, 'Phase 2 architecture'),
    p(t('As promised, here is the one-pager. It covers:')),
    ul(li(t('Unified profiles grounding the agent answers')), li(t('Headless rendering in your React portal'))),
    p(mention('raj.mehta@example.com', 'Raj Mehta', 'user', 'raj.mehta@example.com'), t(' will follow up on pricing after the demo.')),
  ],
};

export const ONEPAGER_DEST: Destination = {
  kind: 'email',
  target: 'new',
  to: [{ name: 'Dana Reyes', email: 'dana.reyes@acme.example' }],
  cc: [],
  subject: 'ACME Phase 2: architecture one-pager',
  threadId: null,
  inReplyTo: null,
};

export const DANA_DM: Destination = { kind: 'slack', target: 'dm', channelId: 'U0DANA', channelName: '@Dana Reyes', threadTs: null };

/** A top-level channel post with @here: the composer warns before anyone is notified. */
export const INITECH_BROADCAST_DOC: TipTapDoc = {
  type: 'doc',
  content: [
    p(mention('here', 'here', 'special'), t(' quick reminder about the data-source inventory for today’s call. A rough list is fine.')),
  ],
};

/** "Someone else" edits a draft (another tab) to produce a 409 in the composer. */
export function theirEdit(doc: TipTapDoc): TipTapDoc {
  return { ...doc, content: [...doc.content, p(t('PS: legal asked us to hold the attachment until Friday.'))] };
}

export function appendParagraph(doc: TipTapDoc, text: string): TipTapDoc {
  return { ...doc, content: [...doc.content, p(t(text))] };
}
