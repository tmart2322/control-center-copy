/** Closure fixtures: placeholder people (Dana, Kim, Sam, Omar), Thu 2026-11-05 15:00Z. */
import type { ClosureItem, Signal } from '@/engines/types';

export const T0 = '2026-11-05T15:00:00.000Z';
const DAY = 86_400_000;
export const daysBefore = (n: number, from = T0): string => new Date(Date.parse(from) - n * DAY).toISOString();
export const plus = (minutes: number, from = T0): string => new Date(Date.parse(from) + minutes * 60_000).toISOString();

export const DANA = { id: 'p-dana', name: 'Dana', isExternal: true };
export const SAM = { id: 'p-sam', name: 'Sam' };
export const ME = { id: 'p-me', name: 'Tristan', isMe: true };

export function citem(over: Partial<ClosureItem> = {}): ClosureItem {
  return {
    id: 'w1',
    version: 3,
    kind: 'ask',
    status: 'open',
    title: 'Send ACME the updated pilot deck',
    initiativeId: 'ini-acme-p2',
    parentId: 'w0',
    involvement: 'owner',
    closureKind: 'reply_in_thread',
    closureTarget: 'slack:C1:1730.1',
    deliverableRefs: ['file-deck'],
    ...over,
  };
}

/** One canonical instance of every signal (columns of the transition table). */
export const SIGNALS: Record<string, Signal> = {
  origin: { type: 'evidence', role: 'origin', confidence: 'sure', evidenceId: 'ev-origin', at: T0, source: 'slack', actor: DANA, reason: 'Dana asked in #acme-ext' },
  progress: { type: 'evidence', role: 'progress', confidence: 'likely', evidenceId: 'ev-progress', at: T0, source: 'slack', actor: ME, reason: 'you said "on it"' },
  done_sure: { type: 'evidence', role: 'completion', confidence: 'sure', evidenceId: 'ev-done', at: T0, source: 'slack', actor: ME, reason: 'you posted "done, see deck" in #acme-ext' },
  done_likely: { type: 'evidence', role: 'completion', confidence: 'likely', evidenceId: 'ev-done-l', at: T0, source: 'slack', actor: ME, reason: 'you shared a deck link' },
  done_guess: { type: 'evidence', role: 'completion', confidence: 'guess', evidenceId: 'ev-done-g', at: T0, source: 'slack', actor: ME, reason: 'a thumbs-up on the thread' },
  context: { type: 'evidence', role: 'context', confidence: 'likely', evidenceId: 'ev-ctx', at: T0, source: 'slack', actor: SAM, reason: 'Sam discussed timelines' },
  contradiction: { type: 'evidence', role: 'contradiction', confidence: 'likely', evidenceId: 'ev-contra', at: T0, source: 'slack', actor: DANA, reason: 'Dana: the pricing slide is still old' },
  requirement: { type: 'requirements_change', confidence: 'likely', evidenceId: 'ev-req', at: T0, source: 'slack', actor: SAM, summary: 'Add the pricing slide' },
  loop_back: { type: 'loop_back', evidenceId: 'ev-loop', at: T0, source: 'slack', from: DANA, actor: DANA, summary: 'Can you walk me through the pricing?' },
  session_waiting: { type: 'session', sessionId: 's1', status: 'waiting', waitingReason: 'Session asked: approve the plan?', launchedByApp: true, evidenceId: 'ev-s-wait', at: T0, source: 'claude' },
  session_running: { type: 'session', sessionId: 's1', status: 'running', launchedByApp: true, evidenceId: 'ev-s-run', at: T0, source: 'claude' },
  session_done: { type: 'session', sessionId: 's1', status: 'done', launchedByApp: true, evidenceId: 'ev-s-done', at: T0, source: 'claude' },
  session_failed: { type: 'session', sessionId: 's1', status: 'failed', launchedByApp: true, evidenceId: 'ev-s-fail', at: T0, source: 'claude' },
  drive_edit: { type: 'drive_digest', fileId: 'file-deck', updatesMade: 'unknown', editedByMe: true, evidenceId: 'ev-drive-e', at: T0, source: 'drive' },
  drive_partial: { type: 'drive_digest', fileId: 'file-deck', updatesMade: 'partial', editedByMe: true, evidenceId: 'ev-drive-p', at: T0, source: 'drive' },
  drive_yes: { type: 'drive_digest', fileId: 'file-deck', updatesMade: 'yes', editedByMe: true, evidenceId: 'ev-drive-y', at: T0, source: 'drive' },
  reply_me: { type: 'reply', by: 'me', threadRef: 'slack:C1:1730.1', evidenceId: 'ev-reply-me', at: T0, source: 'slack', actor: ME },
  reply_them: { type: 'reply', by: 'counterparty', threadRef: 'slack:C1:1730.1', evidenceId: 'ev-reply-them', at: T0, source: 'slack', actor: DANA },
  email_sent: { type: 'email_sent', confidence: 'sure', hasAttachment: true, attachmentRefs: ['file-deck'], evidenceId: 'ev-email', at: T0, source: 'gmail', actor: ME },
  timer: { type: 'timer', evidenceId: null, at: plus(120) },
};

/** One canonical item per state (rows of the transition table). */
export const ROWS: Record<string, ClosureItem> = {
  suggested: citem({ status: 'suggested' }),
  open: citem({ status: 'open' }),
  'open (status locked)': citem({ status: 'open', userLockedFields: ['status'] }),
  in_progress: citem({ status: 'in_progress' }),
  waiting_on_others: citem({ status: 'waiting_on_others', waitingSince: daysBefore(2), waitingReason: 'Waiting on Dana for the SOW', nudgeAt: plus(60) }),
  waiting_on_me: citem({ status: 'waiting_on_me', waitingReason: 'Session asked: which org alias?', waitingSince: plus(-30), linkedSessionIds: ['s1'] }),
  likely_done: citem({ status: 'likely_done', likelyDoneAt: plus(-60), likelyDoneFromStatus: 'in_progress', likelyDone: { reason: 'you shared a deck link', evidenceId: 'ev-old' } }),
  'done (mine, 3d)': citem({ status: 'done', doneAt: daysBefore(3), doneBy: 'user', resolution: 'done_by_me', resolutionDetail: { inferred: false } }),
  'done (mine, 20d)': citem({ status: 'done', doneAt: daysBefore(20), doneBy: 'user', resolution: 'done_by_me', resolutionDetail: { inferred: false } }),
  'done (handed off, 3d)': citem({ status: 'done', doneAt: daysBefore(3), doneBy: 'user', resolution: 'handed_off', resolutionDetail: { inferred: false, personName: 'Kim' }, involvement: 'watcher' }),
  'done (handed off, 20d)': citem({ status: 'done', doneAt: daysBefore(20), doneBy: 'user', resolution: 'handed_off', resolutionDetail: { inferred: false, personName: 'Kim' }, involvement: 'not_involved' }),
  snoozed: citem({ status: 'snoozed', snoozedUntil: plus(60), snoozedFromStatus: 'in_progress' }),
  'dismissed (3d)': citem({ status: 'dismissed', dismissedAt: daysBefore(3) }),
  merged: citem({ status: 'merged', mergedIntoId: 'w9' }),
};
