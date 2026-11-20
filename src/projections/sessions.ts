/**
 * Claude session source items → claude_sessions rows (the Agents page).
 *
 * Input: the Claude-sessions fetcher's `claude:<sessionId>` items (payload in meta: status derived from the live
 * registry + transcript, waitingFor, cwd, branch, timestamps, counts; the redacted recap is the body). One row per
 * session, updated in place as the item changes.
 *
 * Status map (fetcher → db → contract): busy → running → running · waiting → waiting_on_me → waiting_on_you ·
 * errored → errored → failed · done → completed → done (sessions I started) / done_review (app-launched) ·
 * idle → idle → done (the turn ended, the session is open) · archived → abandoned → stale.
 */
import type { ClaudeEntrypoint, ProjectedSession, SourceRow, WaitingReason } from './types';
import { claudeSessionLink } from './links';
import { bool, num, obj, str } from './util';

export function waitingReasonOf(text: string | null): WaitingReason {
  const t = text ?? '';
  if (/permission|dialog|approve tool/i.test(t)) return 'permission_prompt';
  if (/plan/i.test(t)) return 'plan_approval';
  if (/error/i.test(t)) return 'error';
  if (/review/i.test(t)) return 'review_output';
  if (/input/i.test(t)) return 'input_needed';
  return 'question';
}

function entrypointOf(v: unknown, scheduled: boolean): ClaudeEntrypoint {
  if (scheduled) return 'scheduled_task';
  const e = (str(v) ?? '').toLowerCase();
  if (/desktop/.test(e)) return 'desktop';
  if (/vscode|ide|jetbrains/.test(e)) return 'vscode';
  if (/cowork/.test(e)) return 'cowork';
  if (/sdk/.test(e)) return 'agent_sdk';
  if (/cli/.test(e)) return 'cli';
  return 'unknown';
}

export function projectClaudeSession(si: SourceRow): ProjectedSession | null {
  if (si.source !== 'claude' || si.kind !== 'claude_session') return null;
  const m = si.meta;
  const sessionId = str(m.sessionId) ?? (si.dedupeKey.startsWith('claude:') ? si.externalId : null);
  if (!sessionId) return null;
  const last = str(m.lastActivityAt) ?? si.occurredAt;
  const archived = bool(m.archived) === true;
  const raw = str(m.status);
  const waitingText = raw === 'waiting' ? (str(m.waitingFor) ?? 'input needed') : null;
  const status: ProjectedSession['status'] = archived
    ? 'abandoned'
    : raw === 'busy'
      ? 'running'
      : raw === 'waiting'
        ? 'waiting_on_me'
        : raw === 'errored'
          ? 'errored'
          : raw === 'done'
            ? 'completed'
            : 'idle';
  const tag = obj(m.ccTag);
  const scheduled = bool(m.scheduled) === true;
  // The body holds the payload's text parts in payload order: the first prompt, then the recap. The recap is last.
  const parts = (si.body ?? '').split(/\n{2,}/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const summary = parts[parts.length - 1] ?? '';
  return {
    sessionExternalId: sessionId,
    hostSessionId: str(m.hostSessionId),
    sourceItemId: si.id,
    title: str(m.title) ?? si.title ?? 'Claude session',
    status,
    stateOverride: status === 'idle' || (status === 'completed' && !tag) ? 'done' : null,
    waitingReason: waitingText ? waitingReasonOf(waitingText) : null,
    waitingText,
    waitingSince: waitingText ? last : null,
    entrypoint: entrypointOf(m.entrypoint, scheduled),
    cwd: str(m.cwd),
    repo: str(m.repo),
    gitBranch: str(m.branch),
    summary: summary ? summary.slice(0, 400) : null,
    startedAt: str(m.startedAt),
    lastActivityAt: last,
    lastHumanPromptAt: str(m.lastHumanPromptAt),
    endedAt: status === 'completed' || status === 'errored' || status === 'abandoned' ? last : null,
    promptCount: Math.max(0, Math.trunc(num(m.humanPromptCount) ?? 0)),
    filesChangedCount: Math.max(0, Math.trunc(num(m.filesTouchedCount) ?? 0)),
    costUsd: num(m.costUsd),
    bgAgents: Math.max(0, Math.trunc(num(m.backgroundAgents) ?? 0)),
    error: str(m.error),
    ccTag: tag ? str(tag.id) : null,
    archived,
  };
}

/**
 * A session's human turns from its source item (the scanner's `humanTurns`: `[promptAt, turnEndAt]` pairs, ISO, oldest
 * first; 2026-11-14): each prompt with the end of Claude's turn after it. Malformed entries are skipped.
 */
export function humanTurnsOf(meta: Record<string, unknown> | null | undefined): { at: string; runEndsAt: string }[] {
  const raw = meta?.humanTurns;
  if (!Array.isArray(raw)) return [];
  const out: { at: string; runEndsAt: string }[] = [];
  for (const t of raw) {
    if (!Array.isArray(t) || typeof t[0] !== 'string' || Number.isNaN(Date.parse(t[0]))) continue;
    const end = typeof t[1] === 'string' && !Number.isNaN(Date.parse(t[1])) && Date.parse(t[1]) >= Date.parse(t[0]) ? t[1] : t[0];
    out.push({ at: t[0], runEndsAt: end });
  }
  return out;
}

/** The desktop deep link accepts the host (`local_…`) id; the CLI id is the fallback. */
export const sessionDeepLink = (s: Pick<ProjectedSession, 'hostSessionId' | 'sessionExternalId'>) => claudeSessionLink(s.sessionExternalId, s.hostSessionId);
