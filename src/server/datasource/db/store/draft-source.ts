/**
 * GET /drafts/:id/source, db side: the thread's own source items (read-only).
 *
 *  - The work item's evidence rows, by evidence id: a scanner row (not an app-written `cc.*` row) tells the evidence
 *    candidate its thread (`external_parent_id`), `from_me`, stored body format and purge state.
 *  - The thread: every Slack / Gmail source item under the destination's thread key (`slack:<channel>:<threadTs>`,
 *    `gmail-thread:<id>`), under the threads of those evidence rows, or with the destination's own ids (a Gmail
 *    `threadId` may name a message: its thread counts). A DM reply with no thread: that DM's latest messages.
 *  - Mention names: the Slack authors and participants these rows carry (`{externalId: U…, name}`).
 *
 * Bodies are the redacted ones ingest stored; nothing here logs or returns anything else.
 */
import { and, desc, eq, inArray, like, notLike, or, type SQL } from 'drizzle-orm';

import type { Draft } from '@/contract';
import type { Db } from '@/db/client';
import { sourceItems, workItemEvidence } from '@/db/schema';
import { sourceItemUrl } from '@/projections/links';

import type { SourceCandidate } from '../../draft-source';
import { iso, isoReq } from './common';

type Row = typeof sourceItems.$inferSelect;

export interface DraftSourceRows {
  /** Scanner rows behind the item's evidence, by evidence id. */
  byEvidence: Map<string, Row>;
  /** The thread's own rows (scanner rows only), newest first. */
  thread: Row[];
}

const MAX_THREAD = 60;
const APP_ROW = 'cc.%'; // app-written rows (evidence, proposals): their bodies are the evidence snippets

const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

interface MetaAuthor {
  name?: unknown;
  email?: unknown;
  externalId?: unknown;
  isMe?: unknown;
}
function authorOf(meta: Record<string, unknown>): { name: string | null; externalId: string | null; isMe: boolean } {
  const a = meta.author;
  if (typeof a === 'string') return { name: s(a), externalId: null, isMe: false };
  if (a && typeof a === 'object') {
    const x = a as MetaAuthor;
    return { name: s(x.name) ?? s(x.email), externalId: s(x.externalId), isMe: x.isMe === true };
  }
  return { name: null, externalId: null, isMe: false };
}

export async function loadDraftSourceRows(db: Db, userId: string, draft: Draft): Promise<DraftSourceRows> {
  const byEvidence = new Map<string, Row>();
  const d = draft.destination;
  if (d.kind === 'action') return { byEvidence, thread: [] };
  if (draft.workItemId) {
    const ev = await db
      .select({ evidenceId: workItemEvidence.id, si: sourceItems })
      .from(workItemEvidence)
      .innerJoin(sourceItems, eq(sourceItems.id, workItemEvidence.sourceItemId))
      .where(and(eq(workItemEvidence.workItemId, draft.workItemId), eq(sourceItems.ownerUserId, userId), notLike(sourceItems.dedupeKey, APP_ROW)))
      .orderBy(desc(sourceItems.occurredAt), desc(sourceItems.id));
    for (const r of ev) byEvidence.set(r.evidenceId, r.si);
  }
  const keys = new Set<string>();
  const ids = new Set<string>();
  if (d.kind === 'slack' && d.threadTs) {
    keys.add(`slack:${d.channelId}:${d.threadTs}`);
    ids.add(`${d.channelId}:${d.threadTs}`);
  }
  if (d.kind === 'email' && d.threadId) {
    keys.add(`gmail-thread:${d.threadId}`);
    ids.add(d.threadId);
  }
  for (const r of byEvidence.values()) if ((r.source === 'slack' || r.source === 'gmail') && r.externalParentId) keys.add(r.externalParentId);

  const mine = and(eq(sourceItems.ownerUserId, userId), inArray(sourceItems.source, ['slack', 'gmail']), notLike(sourceItems.dedupeKey, APP_ROW));
  if (ids.size) {
    // a destination id that names a message: its own thread counts too
    const direct = await db.select({ parent: sourceItems.externalParentId }).from(sourceItems).where(and(mine, inArray(sourceItems.externalId, [...ids])));
    for (const r of direct) if (r.parent) keys.add(r.parent);
  }
  const where: SQL[] = [];
  if (keys.size) where.push(inArray(sourceItems.externalParentId, [...keys]));
  if (ids.size) where.push(inArray(sourceItems.externalId, [...ids]));
  // a DM answered outside a thread: the conversation's latest messages
  if (d.kind === 'slack' && d.target === 'dm' && !d.threadTs && /^D[A-Z0-9]+$/.test(d.channelId)) where.push(like(sourceItems.externalId, `${d.channelId}:%`));
  const thread = where.length
    ? await db
        .select()
        .from(sourceItems)
        .where(and(mine, or(...where)))
        .orderBy(desc(sourceItems.occurredAt), desc(sourceItems.id))
        .limit(MAX_THREAD)
    : [];
  return { byEvidence, thread };
}

function isMeRow(r: Row, me: { name: string }): boolean {
  const a = authorOf((r.meta ?? {}) as Record<string, unknown>);
  return r.fromMe || a.isMe || (!!a.name && a.name.toLowerCase() === me.name.trim().toLowerCase());
}

function emailMeta(r: Row): Pick<SourceCandidate, 'subject' | 'from' | 'to'> {
  if (r.source !== 'gmail') return {};
  const meta = (r.meta ?? {}) as Record<string, unknown>;
  return { subject: s(meta.subject) ?? r.title ?? null, from: s(meta.from), to: s(meta.to) };
}

/** A thread row as a candidate (a stored source item: its body wins over thread context and evidence snippets). */
export function rowCandidate(r: Row, me: { name: string }): SourceCandidate {
  const meta = (r.meta ?? {}) as Record<string, unknown>;
  const kind = r.source === 'slack' ? 'slack' : r.source === 'gmail' ? 'gmail' : 'other';
  const channelName = s(meta.channelName);
  return {
    id: r.id,
    kind,
    externalId: r.externalId,
    thread: r.externalParentId,
    at: isoReq(r.occurredAt),
    author: authorOf(meta).name,
    isMe: isMeRow(r, me),
    body: r.body,
    format: r.bodyFormat,
    purged: !!r.bodyPurgedAt,
    url: sourceItemUrl({ source: r.source, externalId: r.externalId, url: r.url, meta }),
    summary: null,
    label: kind === 'slack' ? (channelName ? `#${channelName.replace(/^#/, '')}` : null) : (r.title ?? null),
    evidence: false,
    role: null,
    inThread: false,
    rank: 2,
    ...emailMeta(r),
  };
}

/** The evidence candidates, told what their scanner rows know; then the thread's own rows. */
export function withSourceRows(base: SourceCandidate[], rows: DraftSourceRows, me: { name: string }): SourceCandidate[] {
  const out = base.map((c) => {
    const r = c.evidence ? rows.byEvidence.get(c.id) : undefined;
    if (!r) return c;
    return {
      ...c,
      thread: r.externalParentId ?? c.thread,
      isMe: c.isMe || isMeRow(r, me),
      format: r.bodyFormat,
      purged: !!r.bodyPurgedAt,
      at: iso(r.occurredAt) ?? c.at,
      rank: 2 as const,
      ...emailMeta(r),
    };
  });
  return [...out, ...rows.thread.map((r) => rowCandidate(r, me))];
}

/** Slack user id → name from the authors and participants these rows' meta carry (`{externalId: U…, name}`). */
export function metaNames(metas: Iterable<unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (x: unknown) => {
    if (!x || typeof x !== 'object') return;
    const a = x as MetaAuthor;
    const id = s(a.externalId);
    const name = s(a.name);
    if (id && name && /^[UW][A-Z0-9]+$/.test(id) && !out[id]) out[id] = name;
  };
  for (const m of metas) {
    const meta = (m ?? {}) as Record<string, unknown>;
    add(meta.author);
    if (Array.isArray(meta.participants)) for (const p of meta.participants) add(p);
  }
  return out;
}

/** Slack user id → name from the authors and participants the rows carry. */
export function rowLabels(rows: DraftSourceRows): Record<string, string> {
  return metaNames([...rows.thread, ...rows.byEvidence.values()].map((r) => r.meta));
}

/**
 * Mention names from a work item's own evidence rows (the scanner's Slack rows behind them): GET /items/:id/evidence
 * and the item detail's why line, when the people directory does not name everyone a text mentions. Read-only.
 */
export async function evidenceRowNames(db: Db, userId: string, workItemId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ meta: sourceItems.meta })
    .from(workItemEvidence)
    .innerJoin(sourceItems, eq(sourceItems.id, workItemEvidence.sourceItemId))
    .where(and(eq(workItemEvidence.workItemId, workItemId), eq(sourceItems.ownerUserId, userId), eq(sourceItems.source, 'slack'), notLike(sourceItems.dedupeKey, APP_ROW)))
    .orderBy(desc(sourceItems.occurredAt), desc(sourceItems.id));
  return metaNames(rows.map((r) => r.meta));
}
