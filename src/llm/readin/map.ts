/**
 * Agent output → contract `ReadIn` (pure). Defense in depth on the way in:
 *  - every string is redacted again (credential-like text masked);
 *  - a permalink is kept only if the agent was actually shown it (context pack or a tool result), so it cannot
 *    invent links; a work-item reference only if that id is in the context pack;
 *  - the suggested reply becomes a TipTap doc for an Outbox draft (src/server/datasource/db/readin.ts writes it).
 */
import type { Confidence, Draft, EntityRef, ReadIn, ReadInBullet, ReadInHistoryEntry, ReadInSuggestedReply, ReadInTrigger, SourceKind, SourceRef, TipTapDoc } from '@/contract';
import { redactText } from '@/llm/redact';

import type { ReadInContext, ReadInOutput, ReplyTarget } from './types';
import { actionApp } from '@/lib/actions';

const KIND: Record<string, SourceKind> = { ledger: 'manual' };
const LABEL: Partial<Record<SourceKind, string>> = { slack: 'Slack', gmail: 'Gmail', drive: 'Drive', org62: 'Org62', calendar: 'Calendar', gemini: 'Gemini notes', vdp: 'VDP', claude: 'Claude', manual: 'Command Center' };

const red = (s: string) => redactText(s).trim();

function knownItems(ctx: ReadInContext): Map<string, string> {
  const m = new Map<string, string>();
  if (ctx.item) m.set(ctx.item.id, ctx.item.title);
  for (const w of [...ctx.siblings, ...ctx.related, ...(ctx.event?.linkedItems ?? [])]) m.set(w.id, w.title);
  for (const s of ctx.saidBefore) if (s.workItemId && !m.has(s.workItemId)) m.set(s.workItemId, s.text);
  return m;
}

function kindFromUrl(url: string): SourceKind | null {
  if (/slack\.com\//.test(url)) return 'slack';
  if (/mail\.google\.com\//.test(url)) return 'gmail';
  if (/(docs|drive)\.google\.com\//.test(url)) return 'drive';
  if (/calendar\.google\.com\//.test(url)) return 'calendar';
  if (/lightning\.force\.com|my\.salesforce\.com|\.salesforce\.com\//.test(url)) return 'org62';
  return null;
}

interface Cited {
  source?: string;
  label?: string;
  permalink?: string;
  workItemId?: string;
}

function cite(c: Cited, seen: Set<string>, items: Map<string, string>): { source: SourceRef | null; ref: EntityRef | null } {
  const url = c.permalink && seen.has(c.permalink) ? c.permalink : undefined;
  const raw = (c.source ?? (url ? kindFromUrl(url) : null) ?? (c.workItemId ? 'ledger' : null)) as string | null;
  const kind: SourceKind | null = raw ? (KIND[raw] ?? (raw as SourceKind)) : null;
  const title = c.workItemId ? items.get(c.workItemId) : undefined;
  const ref: EntityRef | null = c.workItemId && title !== undefined ? { type: 'work_item', id: c.workItemId, label: title, href: `/work/${encodeURIComponent(c.workItemId)}` } : null;
  if (!kind || (!url && !c.label && !ref)) return { source: null, ref };
  const label = red(c.label ?? (ref ? `Command Center · ${ref.label}` : (LABEL[kind] ?? kind))).slice(0, 120);
  return { source: { kind, label, ...(url ? { url } : {}) }, ref };
}

export interface MapMeta {
  trigger: ReadInTrigger;
  generatedAt: string;
  costUsd: number;
  model: string;
  skillVersion: string;
  seenUrls: Set<string>;
  suggestedReply: ReadInSuggestedReply | null;
}

/** The content part of a ReadIn (state and progress are derived when it is read). */
export function toReadIn(output: ReadInOutput, ctx: ReadInContext, m: MapMeta): ReadIn {
  const items = knownItems(ctx);
  const background: ReadInBullet[] = output.background.map((b) => ({ text: red(b.text), ...cite(b, m.seenUrls, items) }));
  const history: ReadInHistoryEntry[] = output.history.map((h) => ({
    text: red(h.text),
    at: h.at && !Number.isNaN(Date.parse(h.at)) ? new Date(h.at).toISOString() : null,
    commitment: !!h.commitment,
    ...cite(h, m.seenUrls, items),
  }));
  const sources = new Map<string, SourceRef>();
  for (const s of [...background, ...history].map((x) => x.source).filter((x): x is SourceRef => !!x)) sources.set(s.url ?? `${s.kind}:${s.label}`, s);
  return {
    entity: ctx.entity,
    state: 'ready',
    tldr: red(output.tldr),
    background,
    history,
    openQuestions: output.openQuestions.map((q) => ({ text: red(q.text), to: q.to ? red(q.to) : null })),
    suggestedReply: m.suggestedReply,
    confidence: output.confidence as Confidence,
    generatedAt: m.generatedAt,
    generation: ctx.generation,
    costUsd: Math.round(m.costUsd * 10000) / 10000,
    sources: [...sources.values()].slice(0, 20),
    trigger: m.trigger,
    model: m.model,
    skillVersion: m.skillVersion,
    evidenceHash: null,
    progress: null,
    error: null,
    staleReason: null,
    updatedAt: m.generatedAt,
  };
}

/** Plain text → TipTap doc (paragraphs; "- " / "• " lines become a bullet list). */
export function docFromReplyText(text: string): TipTapDoc {
  const blocks: TipTapDoc['content'] = [];
  const paras = red(text).split(/\n{2,}/);
  for (const p of paras) {
    const lines = p.split('\n').map((l) => l.trimEnd()).filter(Boolean);
    if (!lines.length) continue;
    if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) {
      blocks.push({ type: 'bulletList', content: lines.map((l) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: l.replace(/^\s*[-•*]\s+/, '') }] }] })) });
      continue;
    }
    const content: Array<{ type: string; text?: string }> = [];
    lines.forEach((l, i) => {
      if (i > 0) content.push({ type: 'hardBreak' });
      content.push({ type: 'text', text: l });
    });
    blocks.push({ type: 'paragraph', content });
  }
  return { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] };
}

/** The Outbox destination for the suggested reply, from the context's reply target. */
export function destinationFor(target: ReplyTarget, subject?: string): Draft['destination'] {
  if (target.kind === 'slack') return { kind: 'slack', target: target.target, channelId: target.channelId, channelName: target.channelName, threadTs: target.threadTs };
  return { kind: 'email', target: target.threadId ? 'reply' : 'new', to: target.to, cc: [], subject: subject ?? target.subject, threadId: target.threadId, inReplyTo: target.inReplyTo };
}

export function destinationLabel(d: Draft['destination']): string {
  if (d.kind === 'slack') return d.target === 'dm' ? `DM · ${d.channelName.replace(/^@/, '')}` : `${d.channelName}${d.target === 'thread' ? ' · thread' : ''}`;
  if (d.kind === 'action') return `${actionApp(d.action)} · ${d.target.label}`;
  return `Email · ${d.to.map((t) => t.name ?? t.email).join(', ')}`;
}

export function previewOf(text: string, n = 280): string {
  const t = red(text).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
