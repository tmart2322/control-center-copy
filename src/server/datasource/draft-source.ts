/**
 * GET /drafts/:id/source and the Outbox row's "Open in Slack / Gmail": the message a draft answers, shared by both
 * DataSources (pure). Each side gathers `SourceCandidate`s and this module picks the thread, the message and its link:
 *
 *  - mock and db: the draft's `threadContext` (messages known to be in the thread) and its work item's evidence;
 *  - db only: the thread's own `source_items` (the scanner's Slack / Gmail rows, with their stored body format,
 *    `from_me`, the purge state and the authors' Slack ids), and the evidence rows enriched from theirs.
 *
 * Which thread: a reply (Slack thread or DM, email reply / reply all / forward) is about the destination's thread; a
 * new message (a Slack channel post, a new email) about the work item's origin message, wherever it lives.
 * Which message: a reply answers the latest message from someone else in the thread (else the latest); a new message
 * shows its origin. Before it: up to 5 earlier messages, oldest first. Duplicates (the same message as thread context
 * and as evidence) merge by source id, then by minute and author; the stored source body wins over thread context,
 * which wins over a short evidence snippet.
 *
 * Bodies stay local: they are redacted again here (ingest already redacted them) and rendered by
 * `renderSourceBody` (sanitized). After the 90-day purge the evidence line stands in, with the link.
 */
import type { Draft, DraftSource, EvidenceRole, SourceMessage, SourceRef } from '@/contract';
import { redact } from '@/connectors/redact';
import { renderSourceBody, type SourceBodyFormat } from '@/lib/compose';
import { slackArchiveLink } from '@/projections/links';

export type SourceChannel = 'slack' | 'gmail';

export interface SourceCandidate {
  /** Stable id: the source item, evidence or thread-message id. */
  id: string;
  kind: SourceChannel | 'other';
  /** Slack `C…:ts`, or the Gmail message id. */
  externalId: string | null;
  /** Thread key when known: `slack:<channel>:<threadTs>` / `gmail-thread:<id>`. */
  thread: string | null;
  at: string;
  author: string | null;
  isMe: boolean;
  /** Redacted body; null when it was purged or never stored. */
  body: string | null;
  format: SourceBodyFormat;
  purged: boolean;
  url: string | null;
  /** The evidence line ("Dana: …"), shown when there is no body. */
  summary: string | null;
  /** The source label ("#acme-ext · thread", "Gmail · Marcus Webb"). */
  label: string | null;
  /** Linked to the draft's work item as evidence (and its role there). */
  evidence: boolean;
  role: EvidenceRole | null;
  /** Known to be in the draft's thread (the draft's own thread context). */
  inThread: boolean;
  /** How trustworthy the body is: 2 a stored source item, 1 thread context, 0 a short evidence snippet. */
  rank: 0 | 1 | 2;
  subject?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface DraftSourceInput {
  draft: Draft;
  candidates: SourceCandidate[];
  /** The work item's own sources: the link when no message carries one. */
  itemSources: readonly SourceRef[];
  /** Slack id → display name (mentions by name). */
  labels: Record<string, string>;
}

const SLACK_EXT = /^([CDG][A-Z0-9]+):(\d+\.\d+)$/;
const SLACK_THREAD = /^slack:([CDG][A-Z0-9]+):(\d+\.\d+)$/;
const CHANNEL_ID = /^[CDG][A-Z0-9]+$/;
const MAX_EARLIER = 5;

/** Slack permalink → channel + ts (+ thread_ts): `…/archives/C0…/p1793893334322509?thread_ts=…`. */
export function slackPermalinkParts(url: string | null | undefined): { channel: string; ts: string; threadTs: string | null } | null {
  const m = url ? /\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})(?:\?(?:.*&)?thread_ts=(\d+\.\d+))?/.exec(url) : null;
  return m ? { channel: m[1]!, ts: `${m[2]}.${m[3]}`, threadTs: m[4] ?? null } : null;
}

/** Where a Slack candidate sits: its channel, its own ts, and its thread's ts when known. */
function slackPos(c: Pick<SourceCandidate, 'externalId' | 'url' | 'thread'>): { channel: string | null; ts: string | null; threadTs: string | null } {
  let channel: string | null = null;
  let ts: string | null = null;
  let threadTs: string | null = null;
  const e = c.externalId ? SLACK_EXT.exec(c.externalId) : null;
  if (e) [channel, ts] = [e[1]!, e[2]!];
  const p = slackPermalinkParts(c.url);
  if (p) {
    channel ??= p.channel;
    ts ??= p.ts;
    threadTs = p.threadTs;
  }
  const t = c.thread ? SLACK_THREAD.exec(c.thread) : null;
  if (t) {
    channel ??= t[1]!;
    threadTs = t[2]!;
  }
  return { channel, ts, threadTs };
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
/** Something to show: a body, the evidence line, or a purged body (its author, time and link still tell you where to look). */
const hasContent = (c: SourceCandidate) => !!(c.body?.trim() || c.summary?.trim() || c.purged);
const byTime = (a: SourceCandidate, b: SourceCandidate) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id);

/** Is the draft a reply (its thread is the destination's) or a new message (its source is the item's origin)? */
export function isReply(d: Draft['destination']): boolean {
  if (d.kind === 'slack') return d.target !== 'channel' || !!d.threadTs;
  if (d.kind === 'email') return d.target !== 'new';
  return false;
}

interface Scope {
  kind: SourceChannel;
  /** The message to show when it is fixed (a new message's origin); else the latest from someone else. */
  pinned: SourceCandidate | null;
  inScope: (c: SourceCandidate) => boolean;
}

function slackScope(channel: string | null, threadTs: string | null, opts: { dm: boolean }): (c: SourceCandidate) => boolean {
  const key = channel && threadTs ? `slack:${channel}:${threadTs}` : null;
  return (c) => {
    if (c.kind !== 'slack') return false;
    if (c.inThread) return true;
    const p = slackPos(c);
    if (channel && p.channel && p.channel !== channel) return false;
    if (!p.channel && !c.evidence) return false;
    if (threadTs) {
      if (p.ts === threadTs || p.threadTs === threadTs || (key && c.thread === key)) return true;
      if (p.threadTs) return false; // another thread
      return c.evidence; // the item's own message in this channel, thread unknown
    }
    return opts.dm || c.evidence;
  };
}

function emailScope(threadId: string | null, all: SourceCandidate[]): (c: SourceCandidate) => boolean {
  const ids = new Set(threadId ? [threadId] : []);
  const keys = new Set(threadId ? [`gmail-thread:${threadId}`] : []);
  // a thread id may name a message (the read-in passes the origin's message id): its thread counts too
  for (const c of all) if (c.kind === 'gmail' && c.externalId && ids.has(c.externalId) && c.thread) keys.add(c.thread);
  return (c) => {
    if (c.kind !== 'gmail') return false;
    if (c.inThread || (c.externalId && ids.has(c.externalId))) return true;
    if (c.thread && keys.size) return keys.has(c.thread);
    return c.evidence;
  };
}

function scopeFor(d: Draft['destination'], all: SourceCandidate[]): Scope | null {
  if (d.kind === 'action') return null;
  if (isReply(d)) {
    if (d.kind === 'slack') {
      const channel = CHANNEL_ID.test(d.channelId) ? d.channelId : null; // a DM addressed to a user id names no channel
      return { kind: 'slack', pinned: null, inScope: slackScope(channel, d.threadTs, { dm: d.target === 'dm' }) };
    }
    return { kind: 'gmail', pinned: null, inScope: emailScope(d.threadId, all) };
  }
  // A new message: the item's origin message (else its latest message evidence that is not a reply closing it), and
  // that message's thread.
  const msgs = all.filter((c) => c.evidence && c.kind !== 'other' && hasContent(c) && c.role !== 'completion' && c.role !== 'contradiction').sort(byTime);
  const origin = [...msgs].reverse().find((c) => c.role === 'origin') ?? msgs[msgs.length - 1] ?? null;
  if (!origin) return null;
  if (origin.kind === 'slack') {
    const p = slackPos(origin);
    return { kind: 'slack', pinned: origin, inScope: slackScope(p.channel, p.threadTs ?? p.ts, { dm: !!p.channel?.startsWith('D') }) };
  }
  return { kind: 'gmail', pinned: origin, inScope: emailScope(origin.externalId, all) };
}

/** Same message twice (thread context and evidence, or two evidence rows): keep the best body, fill the gaps. */
function merge(list: SourceCandidate[]): SourceCandidate[] {
  const out: SourceCandidate[] = [];
  const minuteKey = (c: SourceCandidate) => (c.author ? `${c.at.slice(0, 16)}|${norm(c.author)}` : null);
  for (const c of [...list].sort((a, b) => b.rank - a.rank || byTime(a, b))) {
    const twin = out.find((o) => (o.externalId && c.externalId && o.externalId === c.externalId) || (!(o.externalId && c.externalId) && minuteKey(o) && minuteKey(o) === minuteKey(c)));
    if (!twin) {
      out.push({ ...c });
      continue;
    }
    if (!twin.body && c.body) Object.assign(twin, { body: c.body, format: c.format });
    twin.externalId ??= c.externalId;
    twin.thread ??= c.thread;
    twin.url ??= c.url;
    twin.summary ??= c.summary;
    twin.label ??= c.label;
    twin.subject ??= c.subject;
    twin.from ??= c.from;
    twin.to ??= c.to;
    twin.isMe ||= c.isMe;
    twin.purged ||= c.purged;
    twin.evidence ||= c.evidence;
    twin.role ??= c.role;
    twin.inThread ||= c.inThread;
  }
  return out.sort(byTime);
}

export interface SourceSelection {
  kind: SourceChannel | null;
  reply: boolean;
  where: string;
  url: string | null;
  message: SourceCandidate | null;
  earlier: SourceCandidate[];
  earlierTotal: number;
}

/** The thread, the message and the link (no rendering: the Outbox list uses this for its rows' links). */
export function selectSource({ draft, candidates, itemSources }: Omit<DraftSourceInput, 'labels'>): SourceSelection {
  const d = draft.destination;
  const scope = scopeFor(d, candidates);
  const reply = isReply(d);
  const baseWhere = d.kind === 'slack' ? d.channelName : d.kind === 'email' ? d.subject : d.target.label;
  if (!scope) return { kind: d.kind === 'slack' ? 'slack' : d.kind === 'email' ? 'gmail' : null, reply, where: baseWhere, url: null, message: null, earlier: [], earlierTotal: 0 };
  const thread = merge(candidates.filter(scope.inScope));
  const msgs = thread.filter(hasContent);
  const pinned = scope.pinned ? (msgs.find((m) => m.id === scope.pinned!.id || (!!m.externalId && m.externalId === scope.pinned!.externalId)) ?? null) : null;
  const message = pinned ?? [...msgs].reverse().find((m) => !m.isMe) ?? msgs[msgs.length - 1] ?? null;
  const idx = message ? msgs.indexOf(message) : -1;
  const earlier = idx > 0 ? msgs.slice(Math.max(0, idx - MAX_EARLIER), idx) : [];
  // a new message's source lives elsewhere: its channel ("#acme-ext · thread" → "#acme-ext"), or the email's subject
  const where = reply || !message ? baseWhere : scope.kind === 'slack' ? (message.label?.split(' · ')[0] ?? baseWhere) : (message.subject ?? message.label ?? baseWhere);
  return { kind: scope.kind, reply, where, url: linkFor(d, scope.kind, reply, message, thread, itemSources), message, earlier, earlierTotal: Math.max(0, idx) };
}

/** The channel a Slack permalink points into (`…/archives/C0…/…`). */
const urlChannel = (url: string) => /\/archives\/([A-Z0-9]+)/.exec(url)?.[1] ?? null;

/** The message's permalink, else the newest one in the thread, else the item's own source of this kind, else derived. */
function linkFor(d: Draft['destination'], kind: SourceChannel, reply: boolean, message: SourceCandidate | null, thread: SourceCandidate[], itemSources: readonly SourceRef[]): string | null {
  if (message?.url) return message.url;
  const inThread = [...thread].reverse().find((c) => !!c.url)?.url;
  if (inThread) return inThread;
  const channel = kind !== 'slack' ? null : reply && d.kind === 'slack' ? d.channelId : message ? slackPos(message).channel : null;
  const own = itemSources.find((s) => s.kind === kind && !!s.url && (!channel || !urlChannel(s.url) || urlChannel(s.url) === channel));
  if (own?.url) return own.url;
  if (reply && d.kind === 'slack' && d.threadTs) return slackArchiveLink(d.channelId, d.threadTs);
  return null;
}

/** The Outbox row's deep link (a SourceRef the row shows as "Open in Slack" / "Open in Gmail"). */
export function draftSourceLink(input: Omit<DraftSourceInput, 'labels'>): SourceRef | null {
  if (input.draft.destination.kind === 'action') return null;
  const s = selectSource(input);
  return s.kind && s.url ? { kind: s.kind, label: s.where, url: s.url } : null;
}

function messageOf(c: SourceCandidate, labels: Record<string, string>, kind: SourceChannel, fallbackSubject: string | null): SourceMessage {
  const body = c.body?.trim() ? redact(c.body).text : null;
  const state = body ? 'full' : c.purged ? 'purged' : 'none';
  const format: SourceBodyFormat = c.kind === 'slack' && (c.format === 'plain' || c.format === 'markdown') ? 'slack_mrkdwn' : c.format;
  const r = body ? renderSourceBody(body, format, { labels }) : renderSourceBody(c.summary ? redact(c.summary).text : '', 'plain');
  return {
    id: c.id,
    author: c.author,
    isMe: c.isMe,
    at: c.at,
    html: r.html,
    text: r.text,
    body: state,
    url: c.url,
    subject: kind === 'gmail' ? (c.subject ?? fallbackSubject) : null,
    from: kind === 'gmail' ? (c.from ?? null) : null,
    to: kind === 'gmail' ? (c.to ?? null) : null,
  };
}

/** GET /drafts/:id/source. */
export function buildDraftSource(input: DraftSourceInput): DraftSource {
  const s = selectSource(input);
  const d = input.draft.destination;
  const subject = d.kind === 'email' && s.reply ? d.subject.replace(/^((re|fwd?|aw|wg)\s*:\s*)+/i, '') || null : null;
  return {
    draftId: input.draft.id,
    kind: d.kind === 'action' ? null : s.kind,
    relation: s.reply ? 'reply' : 'source',
    where: s.where,
    url: s.url,
    message: s.message && s.kind ? messageOf(s.message, input.labels, s.kind, subject) : null,
    earlier: s.kind ? s.earlier.map((m) => messageOf(m, input.labels, s.kind!, null)) : [],
    earlierTotal: s.earlierTotal,
  };
}

// ---------------------------------------------------------------------------
// Candidates both DataSources build the same way
// ---------------------------------------------------------------------------

/** The draft's own thread context: messages known to be in its thread (Slack mrkdwn / plain email text). */
export function threadCandidates(draft: Draft): SourceCandidate[] {
  const kind: SourceChannel | null = draft.destination.kind === 'slack' ? 'slack' : draft.destination.kind === 'email' ? 'gmail' : null;
  if (!kind) return [];
  return draft.threadContext.map((m) => ({
    id: m.id,
    kind,
    externalId: null,
    thread: null,
    at: m.at,
    author: m.author.name,
    isMe: m.isMe,
    body: m.text,
    format: kind === 'slack' ? 'slack_mrkdwn' : 'plain',
    purged: false,
    url: null,
    summary: null,
    label: null,
    evidence: false,
    role: null,
    inThread: true,
    rank: 1,
  }));
}

export interface EvidenceLike {
  id: string;
  role: EvidenceRole;
  source: SourceRef;
  at: string;
  summary: string;
  snippet: string | null;
  author: string | null;
}

/** A work item's evidence as candidates (`me`: the user's name, to tell their own messages apart). */
export function evidenceCandidates(evidence: readonly EvidenceLike[], me: { name: string }): SourceCandidate[] {
  return evidence.map((e) => {
    const kind: SourceCandidate['kind'] = e.source.kind === 'slack' ? 'slack' : e.source.kind === 'gmail' ? 'gmail' : 'other';
    return {
      id: e.id,
      kind,
      externalId: e.source.externalId ?? null,
      thread: null,
      at: e.source.at ?? e.at,
      author: e.author,
      isMe: !!e.author && norm(e.author) === norm(me.name),
      body: e.snippet,
      format: kind === 'slack' ? 'slack_mrkdwn' : 'plain',
      purged: false,
      url: e.source.url ?? null,
      summary: e.summary || null,
      label: e.source.label,
      evidence: true,
      role: e.role,
      inThread: false,
      rank: 0,
    };
  });
}

/** What both DataSources know of every draft: its thread context and its work item's evidence. */
export function baseCandidates(draft: Draft, itemEvidence: readonly EvidenceLike[], me: { name: string }): SourceCandidate[] {
  return [...threadCandidates(draft), ...evidenceCandidates(itemEvidence, me)];
}

/** Group a list by key (the evidence of every work item, once per Outbox read). */
export function groupBy<T>(list: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const k = key(x);
    const at = m.get(k);
    if (at) at.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/** Slack user id → name from the directory (people whose Slack handle is a user id). */
export function slackLabels(people: ReadonlyArray<{ name: string; slackHandle?: string | null }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of people) if (p.slackHandle && /^[UW][A-Z0-9]+$/.test(p.slackHandle)) out[p.slackHandle] = p.name;
  return out;
}
