/**
 * One assistant turn, shared by the mock and db DataSources (CONTRACT-1 + BE-CHAT): `start` first, then
 * the backend's steps as stream events, then exactly one `done` or `error`. The assistant message is
 * persisted exactly once, in a `finally`, whatever ends the turn (done, error, Stop, a newer message in
 * the thread, or the client leaving), with its model, status, usage and every part: tool rows with
 * credential-redacted args/results, receipts, proposals (+ structured changes), resources, errors.
 *
 * BE-CHAT cards (scan, draft, session) are `resource` parts/events with a `card` (ChatCard): older clients
 * show the link, newer ones the card. A scan card is one part, replaced as the scan progresses.
 */
import type { ApiErrorCode, ChatCard, ChatMessage, ChatModel, ChatPart, ChatResource, ChatSseEvent, ChatUsage, Proposal } from '@/contract';
import { redactPayload, redactText } from '@/llm/redact';
import type { ChatRunStep } from '@/llm/chat/types';
import { AppError, isAppError } from '@/server/errors';

/** The link a card's resource carries (what a client without card support shows). */
export function resourceForCard(card: ChatCard): ChatResource {
  switch (card.kind) {
    case 'draft':
      return { kind: 'draft', id: card.draft.draftId, label: `Draft for ${card.draft.to} (not sent)`, href: card.draft.href };
    case 'session':
      // the in-app run page: a client without card support never navigates to claude:// by itself
      return { kind: 'agent_run', id: card.session.id, label: `Claude session ready: ${card.session.title}`, href: `/agents?run=${encodeURIComponent(card.session.id)}` };
  }
}

/** The scan id a `<source>.scan` tool row carries in its result (null for other rows). */
export function scanIdOfPart(p: ChatPart): string | null {
  if (p.type !== 'tool' || !/(^|\.)scan$/.test(p.name) || !p.result) return null;
  return /"scanId":"([^"]+)"/.exec(p.result)?.[1] ?? null;
}

/** A persisted scan row refreshed from the scan's current state (summary, ok, progress). */
export function refreshScanPart(p: Extract<ChatPart, { type: 'tool' }>, scan: { status: string; done: boolean; summary: string; itemsSeen: number }): ChatPart {
  const done = scan.done ? 3 : scan.status === 'running' ? (scan.itemsSeen > 0 ? 2 : 1) : 0;
  return { ...p, summary: scan.done ? scan.summary : `${scan.summary}; it continues in the background (Health)`, ok: scan.done ? scan.status === 'ok' || scan.status === 'partial' : true, progress: { done, total: 3 } };
}

const sameCard = (p: ChatPart, card: ChatCard) => p.type === 'resource' && p.card?.kind === card.kind && resourceForCard(p.card).id === resourceForCard(card).id;

export interface TurnIds {
  threadId: string;
  messageId: string;
  userMessageId: string;
  model: ChatModel;
}

export interface TurnOptions {
  signal: AbortSignal;
  now: () => string;
  newId: () => string;
  persist: (m: ChatMessage) => Promise<void> | void;
  /** Mock pacing: stream text word by word, `textChunkMs` apart (the scripted demos' cadence). */
  chunkText?: boolean;
  textChunkMs?: number;
  /** Mock pacing: pause after a tool row starts. */
  toolPauseMs?: number;
}

/** Chat card state: rejected and superseded both read as dismissed. */
export function chatProposalStatus(s: Proposal['status']): 'pending' | 'applied' | 'dismissed' {
  return s === 'pending' ? 'pending' : s === 'applied' ? 'applied' : 'dismissed';
}

/** Tool args/results as persisted: credential-redacted text, capped. */
export function redactedText(v: unknown): string {
  const s = typeof v === 'string' ? redactText(v) : (JSON.stringify(redactPayload(v).value) ?? '');
  return s.length > 2000 ? `${s.slice(0, 1999)}…` : s;
}

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

export async function* runTurn(ids: TurnIds, steps: AsyncIterable<ChatRunStep>, o: TurnOptions): AsyncGenerator<ChatSseEvent> {
  const { threadId, messageId, userMessageId, model } = ids;
  const parts: ChatPart[] = [];
  let text = '';
  let usage: ChatUsage | undefined;
  const toolStack: string[] = [];
  const toolIds = new Map<string, string>();
  let finished = false;
  const finish = async (status: 'complete' | 'error' | 'stopped') => {
    if (finished) return;
    finished = true;
    await o.persist({ id: messageId, threadId, role: 'assistant', at: o.now(), text, parts, context: [], isMorningBrief: false, model, status, ...(usage ? { usage } : {}) });
  };
  const fail = async (error: { code: ApiErrorCode; message: string; retryable: boolean; details?: unknown }) => {
    const e = { ...error, message: redactText(error.message) };
    parts.push({ type: 'error', error: e });
    await finish('error');
    return e;
  };
  const upsert = <T extends ChatPart>(p: T, same: (x: ChatPart) => boolean) => {
    const i = parts.findIndex(same);
    if (i >= 0) parts[i] = p;
    else parts.push(p);
  };
  try {
    yield { type: 'start', threadId, messageId, userMessageId, model };
    try {
      for await (const step of steps) {
        if (o.signal.aborted) break;
        switch (step.type) {
          case 'text': {
            if (o.chunkText) {
              for (const chunk of step.text.match(/\S+\s*|\s+/g) ?? []) {
                if (o.signal.aborted) break;
                await sleep(o.textChunkMs ?? 0);
                text += chunk;
                yield { type: 'text-delta', messageId, delta: chunk };
              }
            } else {
              text += step.text;
              yield { type: 'text-delta', messageId, delta: step.text };
            }
            break;
          }
          case 'tool-start': {
            const tid = o.newId();
            if (step.id) toolIds.set(step.id, tid);
            else toolStack.push(tid);
            const summary = redactText(step.summary);
            const args = step.args === undefined ? undefined : redactedText(step.args);
            parts.push({ type: 'tool', id: tid, name: step.name, summary, ok: null, args: args ?? summary, result: null });
            yield { type: 'tool-start', id: tid, name: step.name, summary, ...(args !== undefined ? { args } : {}) };
            if (o.toolPauseMs !== undefined) await sleep(o.toolPauseMs);
            break;
          }
          case 'tool-result': {
            const tid = (step.id ? toolIds.get(step.id) : undefined) ?? toolStack.pop() ?? o.newId();
            const ok = step.ok ?? true;
            const summary = redactText(step.summary);
            const result = step.result === undefined ? undefined : redactedText(step.result);
            const i = parts.findIndex((p) => p.type === 'tool' && p.id === tid);
            if (i >= 0) parts[i] = { ...(parts[i] as Extract<ChatPart, { type: 'tool' }>), summary, ok, result: result ?? summary };
            yield { type: 'tool-result', id: tid, summary, ok, ...(result !== undefined ? { result } : {}) };
            break;
          }
          case 'receipt':
            parts.push({ type: 'receipt', receipt: step.receipt });
            yield { type: 'receipt', receipt: step.receipt };
            break;
          case 'proposal':
            parts.push({ type: 'proposal', proposal: step.proposal, summary: step.summary, status: chatProposalStatus(step.proposal.status), ...(step.changes ? { changes: step.changes } : {}) });
            yield { type: 'proposal', id: step.proposal.id, proposal: step.proposal, summary: step.summary };
            break;
          case 'resource':
            parts.push({ type: 'resource', resource: step.resource });
            yield { type: 'resource', resource: step.resource };
            break;
          case 'tool-progress': {
            const tid = toolIds.get(step.id) ?? step.id;
            const i = parts.findIndex((p) => p.type === 'tool' && p.id === tid);
            if (i < 0) break;
            parts[i] = { ...(parts[i] as Extract<ChatPart, { type: 'tool' }>), progress: { done: step.done, total: step.total } };
            yield { type: 'tool-progress', id: tid, done: step.done, total: step.total };
            break;
          }
          case 'draft':
          case 'session': {
            const card: ChatCard = step.type === 'draft' ? { kind: 'draft', draft: step.draft } : { kind: 'session', session: step.session };
            const resource = resourceForCard(card);
            upsert({ type: 'resource', resource, card }, (p) => sameCard(p, card));
            yield { type: 'resource', resource, card };
            break;
          }
          case 'usage':
            usage = step.usage;
            break;
          case 'error':
            yield { type: 'error', error: await fail({ code: step.code, message: step.message, retryable: step.retryable ?? step.code !== 'validation', ...(step.details ? { details: step.details } : {}) }) };
            return;
        }
      }
    } catch (err) {
      const e = isAppError(err) ? err : new AppError('internal', (err as Error).message);
      yield { type: 'error', error: await fail(e.toBody()) };
      return;
    }
    if (o.signal.aborted) return;
    await finish('complete');
    yield { type: 'done', threadId, messageId, userMessageId };
  } finally {
    await finish('stopped');
  }
}
