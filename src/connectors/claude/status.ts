/**
 * Claude session status derivation (brief 10 §1.5). First match wins. Pure.
 *
 * Output vocabulary (R-UI-1): busy | idle | waiting (+ waitingFor) | done | errored.
 * `interrupted` (crashed or killed mid-turn, resumable) is reported as `errored` with `errorKind: 'interrupted'`.
 */
import type { TranscriptState } from './transcript';

export type SessionStatus = 'busy' | 'idle' | 'waiting' | 'done' | 'errored';

export interface RegistryEntry {
  pid: number;
  sessionId: string;
  hostSessionId?: string;
  cwd?: string;
  entrypoint?: string;
  kind?: string;
  name?: string;
  status?: 'busy' | 'idle' | 'waiting' | string;
  waitingFor?: string | null;
  statusUpdatedAt?: number;
  updatedAt?: number;
  startedAt?: number;
  procStart?: string;
  version?: string;
  /** Set by the fetcher after the liveness check (pid exists and procStart matches). */
  alive: boolean;
}

export interface DesktopMeta {
  sessionId?: string; // local_<uuid>
  cliSessionId?: string;
  title?: string;
  titleSource?: string;
  isArchived?: boolean;
  error?: string;
  errorAt?: number;
  lastTurnCutShort?: boolean;
  writtenBranches?: string[];
  forkedFromSessionId?: string;
  scheduledTaskId?: string;
  originCwd?: string;
}

export interface Derived {
  status: SessionStatus;
  waitingFor?: string;
  /** Machine-readable reason (which rule fired). */
  reason: string;
  confidence: 'certain' | 'high' | 'medium' | 'low';
  /** True for the question-regex heuristic: the Haiku tier should confirm it before the UI surfaces it as "blocked". */
  soft?: boolean;
  errorKind?: 'api_error' | 'interrupted' | 'desktop_error';
  resumable?: boolean;
}

export const FRESH_MS = 90_000;

const QUESTION_TAIL = /(\?\s*$|want me to|should i|shall i|would you like|let me know|which (?:one|option)|do you want|ok to proceed|confirm)/i;

/** A trailing courtesy line ("Let me know if you need anything else.") is not a request for a decision (brief 10 §1.7 false positives). */
const COURTESY = /(?:^|[.!?]\s+|\n)(?:let me know if (?:you|there)|feel free to|happy to|i(?:'|’)m happy to|don(?:'|’)t hesitate)[^?\n]*[.!]?\s*$/i;

export function endsWithQuestion(text: string | undefined): boolean {
  if (!text) return false;
  const tail = text.slice(-300).trim().replace(COURTESY, '').trim();
  return QUESTION_TAIL.test(tail);
}

export function deriveStatus(i: { reg?: RegistryEntry; t: TranscriptState; desktop?: DesktopMeta; mtimeMs: number; nowMs: number }): Derived {
  const { reg, t, desktop, nowMs } = i;
  const live = !!reg?.alive;
  const pendingNames = Object.values(t.pending);
  const askPending = pendingNames.find((n) => n === 'AskUserQuestion' || n === 'ExitPlanMode');
  // 1. Unanswered question or plan approval.
  if (askPending) {
    return { status: 'waiting', waitingFor: askPending === 'ExitPlanMode' ? 'plan approval' : 'input needed', reason: `pending ${askPending}`, confidence: 'certain', resumable: !live };
  }
  // 2. Live process registry.
  if (live && reg) {
    if (reg.status === 'busy') return { status: 'busy', reason: 'registry busy', confidence: 'certain' };
    if (reg.status === 'waiting') return { status: 'waiting', waitingFor: reg.waitingFor || 'input needed', reason: 'registry waiting', confidence: 'certain' };
  }
  // 3. Errored.
  if (desktop?.error && desktop.lastTurnCutShort) return { status: 'errored', reason: 'desktop error with cut-short turn', confidence: 'high', errorKind: 'desktop_error', resumable: true };
  if (t.trailingApiError && !live) return { status: 'errored', reason: 'trailing api_error', confidence: 'high', errorKind: 'api_error', resumable: true };
  // 4. No live process but a tool call never returned.
  const fresh = nowMs - i.mtimeMs < FRESH_MS;
  if (!live && pendingNames.length > 0) {
    if (fresh) return { status: 'busy', reason: 'unregistered run with fresh pending tool call', confidence: 'medium' };
    return { status: 'errored', reason: 'pending tool call, process gone', confidence: 'high', errorKind: 'interrupted', resumable: true };
  }
  // 5. Last record is an assistant message.
  if (t.lastConv === 'assistant') {
    if (endsWithQuestion(t.lastAssistantText)) {
      return { status: 'waiting', waitingFor: 'question', reason: 'final message asks the user', confidence: 'medium', soft: true, resumable: !live };
    }
    return live ? { status: 'idle', reason: 'live process idle after assistant turn', confidence: 'high' } : { status: 'done', reason: 'assistant turn ended', confidence: 'high', resumable: true };
  }
  // 6. Last record is a human prompt or tool_result with no live process.
  if (!live && (t.lastConv === 'human' || t.lastConv === 'tool_result')) {
    if (fresh) return { status: 'busy', reason: 'recent prompt, no registry', confidence: 'low' };
    return { status: 'errored', reason: 'prompt or tool result unanswered, process gone', confidence: 'medium', errorKind: 'interrupted', resumable: true };
  }
  // 7. Else.
  return { status: 'idle', reason: live ? 'live process idle' : 'no signal', confidence: 'low' };
}
