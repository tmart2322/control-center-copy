/**
 * Pure derivations shared by cards and rows: priority bar tone, age phrases, timing, draft previews,
 * destination labels. No React here.
 */
import type { Destination, Draft, SourceRef, WorkItem } from '@/contract';
import { actionApp, actionIcon } from '@/lib/actions';
import { renderPreview, type Destination as ComposeDestination, type DocNode } from '@/lib/compose';
import type { BarTone } from './lib/tones';
import { age, minutesBetween } from './lib/time';

/** 3 px bar: late → risk, within 60 min → warn, high priority → brand, else neutral. */
export function barTone(item: Pick<WorkItem, 'startBy' | 'due' | 'priority' | 'state' | 'isBackground'>, now: string): BarTone {
  if (item.state === 'done' || item.state === 'dismissed' || item.isBackground) return 'neutral';
  const at = item.startBy ?? item.due;
  if (at) {
    const m = minutesBetween(now, at);
    if (m < 0) return 'risk';
    if (m <= 60) return 'warn';
  }
  return item.priority === 'high' ? 'brand' : 'neutral';
}

/** "asked 2h ago" / "promised 34d ago" / "added 2d ago". */
export function agePhrase(item: Pick<WorkItem, 'kind' | 'createdAt' | 'counterparty' | 'isBackground'>, now: string): string {
  const a = age(item.createdAt, now);
  const when = a === 'now' ? 'just now' : `${a} ago`;
  if (item.kind === 'ask') return `asked ${when}`;
  if (item.kind === 'commitment') return `promised ${when}`;
  return `added ${when}`;
}

/** The timing a card or row leads with: start-by wins over due (lead time beats effort, §1.8). */
export function leadTiming(item: Pick<WorkItem, 'startBy' | 'due'>): { at: string; kind: 'start' | 'due' } | null {
  if (item.startBy) return { at: item.startBy, kind: 'start' };
  if (item.due) return { at: item.due, kind: 'due' };
  return null;
}

/** Union of sources, deduped by kind + label, order kept. */
export function mergeSources(...lists: Array<SourceRef[] | undefined | null>): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const list of lists) {
    for (const s of list ?? []) {
      const k = `${s.kind}|${s.label}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(s);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export function toComposeDestination(d: Destination): ComposeDestination {
  if (d.kind === 'action') return { kind: 'plain' };
  if (d.kind === 'slack') return { kind: 'slack', channelId: d.channelId, threadTs: d.threadTs ?? undefined };
  return {
    kind: 'email',
    to: d.to.map((a) => a.email),
    cc: d.cc.map((a) => a.email),
    subject: d.subject,
    inReplyTo: d.inReplyTo ?? undefined,
  };
}

function mentionLabels(node: DocNode, acc: Record<string, string> = {}): Record<string, string> {
  if (node.type === 'mention' && node.attrs?.id) acc[String(node.attrs.id)] = String(node.attrs.label ?? node.attrs.id);
  for (const c of node.content ?? []) mentionLabels(c, acc);
  return acc;
}

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Preview-as-recipient HTML, derived from the serialized payload (LIB-compose `renderPreview`), so what the
 * card shows is what would be sent. Callers still pass it through SafeHtml (DOMPurify).
 */
export function draftPreviewHtml(draft: Draft): string {
  try {
    const doc = draft.doc as unknown as DocNode;
    return renderPreview(doc, toComposeDestination(draft.destination), { mentionLabels: mentionLabels(doc) });
  } catch {
    const paras = draft.plainText.split(/\n+/).map((p) => `<p>${escapeText(p)}</p>`);
    return `<div class="cc-preview cc-preview-${draft.destination.kind === 'slack' ? 'slack' : draft.destination.kind === 'action' ? 'plain' : 'email'}">${paras.join('')}</div>`;
  }
}

/** First non-empty line of the draft (collapsed cards, rows). */
export function draftFirstLine(draft: Draft): string {
  return draft.plainText.split('\n').find((l) => l.trim())?.trim() ?? '';
}

/** "Slack" + "#acme-ext · thread" / "Gmail" + "reply-all · to Marcus Webb +1 cc". */
export function destinationLabel(d: Destination): { channel: string; detail: string; icon: string } {
  if (d.kind === 'slack') {
    const target = d.target === 'thread' ? 'thread' : d.target === 'dm' ? 'DM' : 'channel';
    return { channel: 'Slack', detail: d.target === 'dm' ? d.channelName : `${d.channelName} · ${target}`, icon: 'slack' };
  }
  if (d.kind === 'action') return { channel: actionApp(d.action), detail: d.target.label, icon: actionIcon(d.action) };
  const target = { reply: 'reply', reply_all: 'reply-all', new: 'new email', forward: 'forward' }[d.target];
  const first = d.to[0];
  const who = first ? first.name ?? first.email : '';
  const more = d.to.length - 1 + d.cc.length;
  return { channel: 'Gmail', detail: `${target} · to ${who}${more > 0 ? ` +${more}` : ''}`, icon: 'email' };
}

/** "talk-track" → "Talk Track". */
export function toolName(id: string | null | undefined): string {
  if (!id) return 'Tool';
  const known: Record<string, string> = { 'talk-track': 'Talk Track', 'pulse-footprint': 'Pulse footprint', 'afd360-estimator': 'D360/AF estimator' };
  return known[id] ?? id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
