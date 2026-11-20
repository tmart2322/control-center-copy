/**
 * Settle policy (pure): a verdict, its confidence and the user's Closing settings → close for you, ask (Looks done /
 * Still needed?), reopen (a suggestion that is still yours), or leave it. Corrections win: an item the user reopened,
 * kept or edited is never closed again by the check (*tenet: Suggest, then learn*).
 */
import type { ClosingAction, ClosingReason, ClosingSettings, ClosingStrictness, Resolution } from '@/contract';

import type { SettleResult, SettleVerdict } from './types';

/**
 * Minimum confidence to close, per strictness, calibrated on the answer key (docs/ui/FIRST-SCAN-RAMP.md §7): on one
 * honest pass over 445 items, 0.5 closed 248 with none still owed; 0.7 closed 202. Haiku bunches its confidence near
 * 0.55–0.6, so a high bar mostly throws away right answers.
 */
export const SETTLE_THRESHOLDS: Record<ClosingStrictness, number> = { cautious: 0.7, balanced: 0.5, eager: 0.4 };
/** Below this, a verdict doesn't even ask: it is too unsure to bother the user. */
export const SETTLE_ASK_MIN = 0.4;

/** Which setting governs a verdict. */
export const REASON_OF: Partial<Record<SettleVerdict, ClosingReason>> = {
  done_by_you: 'done_by_you',
  resolved_by_other: 'resolved_by_other',
  handed_off: 'not_yours',
  not_yours: 'not_yours',
  not_an_ask: 'not_an_ask',
  moment_passed: 'moment_passed',
  duplicate: 'duplicate',
  superseded: 'superseded',
  gone_quiet: 'gone_quiet',
};

export const RESOLUTION_OF: Record<Exclude<SettleVerdict, 'still_yours' | 'gone_quiet' | 'waiting_on_them'>, Resolution> = {
  done_by_you: 'done_by_me',
  resolved_by_other: 'done_by_other',
  handed_off: 'handed_off',
  not_yours: 'not_needed',
  not_an_ask: 'not_needed',
  moment_passed: 'not_needed',
  duplicate: 'duplicate',
  superseded: 'superseded',
};

/** "Done" kinds ask through Looks done; the rest ask through Still needed?. */
const LOOKS_DONE: ReadonlySet<ClosingReason> = new Set(['done_by_you', 'resolved_by_other', 'duplicate', 'superseded']);

export interface PolicyItem {
  id: string;
  kind: string;
  status: string;
  /** The user changed its state or fields since it was created (Keep, Not done, Reopen, an edit, a snooze). */
  userTouched: boolean;
  /** The user reopened it after a close (or marked it Not done after Looks done). */
  userReopened: boolean;
  /** A commitment to someone outside the company. */
  externalCommitment: boolean;
  /** People and channels it involves (names, `#channel`), for the ask-first lists. */
  people: string[];
  channels: string[];
  /** Source of the item's origin (org62, slack, gmail…): record-derived work closes only on evidence. */
  originSource?: string | null;
}

/** `wait`: still mine, but my last line asked them for what I need first: it moves to Chase (waiting on others). */
export type SettleAction = 'close' | 'ask_looks_done' | 'ask_still_needed' | 'reopen' | 'wait' | 'leave';

export interface SettleDecision {
  action: SettleAction;
  reason: ClosingReason | null;
  resolution?: Resolution;
  /** Why the policy chose this (audit, never shown as the reason itself). */
  why: string;
}

const LIVE = new Set(['open', 'in_progress', 'waiting_on_me', 'waiting_on_others', 'likely_done', 'reopened']);

export function decideSettle(r: SettleResult, item: PolicyItem, s: ClosingSettings): SettleDecision {
  const leave = (why: string): SettleDecision => ({ action: 'leave', reason: REASON_OF[r.verdict] ?? null, why });
  if (r.error || !r.valid) return leave(r.error ? `check failed: ${r.error}` : `invalid verdict: ${r.invalidWhy ?? 'citation rules'}`);
  if (item.status === 'done' || item.status === 'dismissed' || item.status === 'merged' || item.status === 'snoozed') return leave(`item is ${item.status}`);
  const threshold = SETTLE_THRESHOLDS[s.strictness];

  if (r.verdict === 'still_yours') {
    if (item.status === 'suggested' && r.confidence >= threshold && !item.userTouched) return { action: 'reopen', reason: null, why: 'still yours: back to open work' };
    return leave('still yours');
  }
  // Waiting on them: not a close, so a reopen or an edit doesn't block it (it stays live, in Chase).
  if (r.verdict === 'waiting_on_them') {
    if (item.status === 'waiting_on_others') return leave('already waiting on them');
    if (r.confidence < threshold) return leave(`confidence ${r.confidence} below ${threshold}`);
    return { action: 'wait', reason: null, why: 'waiting on their answer: moved to Chase' };
  }
  const reason = REASON_OF[r.verdict]!;
  if (r.confidence < SETTLE_ASK_MIN) return leave(`confidence ${r.confidence} below ${SETTLE_ASK_MIN}`);
  if (item.userReopened) return leave('you reopened it: the check never closes it again');

  let action: ClosingAction = s.enabled ? s.reasons[reason] : 'ask';
  if (action === 'leave') return leave(`${reason} is set to leave open`);
  const notes: string[] = [];
  if (action === 'close' && r.confidence < threshold) {
    action = 'ask';
    notes.push(`confidence ${r.confidence} below ${threshold}`);
  }
  const passive = reason === 'not_an_ask' || reason === 'moment_passed' || reason === 'gone_quiet';
  if (action === 'close' && r.upcomingEvent && passive) {
    action = 'ask';
    notes.push('a matching meeting is still ahead');
  }
  if (action === 'close' && r.askCutOff && (reason === 'not_an_ask' || reason === 'not_yours')) {
    action = 'ask';
    notes.push('the message was cut off before the part the item is about');
  }
  const fromRecord = item.kind === 'training' || item.originSource === 'org62' || item.originSource === 'vdp';
  if (action === 'close' && fromRecord && reason !== 'done_by_you' && reason !== 'resolved_by_other') {
    action = 'ask';
    notes.push('work derived from a record (training, Org62) closes only on evidence it was done');
  }
  if (action === 'close' && r.openLoop && passive) {
    action = 'ask';
    notes.push('the asker wrote last, this week');
  }
  if (action === 'close' && item.userTouched) {
    action = 'ask';
    notes.push('you changed it before');
  }
  if (action === 'close' && s.askFirstExternalCommitments && item.externalCommitment) {
    action = 'ask';
    notes.push('commitment to someone outside the company');
  }
  const lc = (x: string) => x.trim().toLowerCase().replace(/^#/, '');
  if (action === 'close' && s.askFirstPeople.some((p) => item.people.some((q) => lc(q) === lc(p)))) {
    action = 'ask';
    notes.push('a person on your ask-first list');
  }
  if (action === 'close' && s.askFirstChannels.some((c) => item.channels.some((q) => lc(q) === lc(c)))) {
    action = 'ask';
    notes.push('a channel on your ask-first list');
  }

  if (action === 'close') {
    if (r.verdict === 'gone_quiet') return { action: 'close', reason, resolution: 'not_needed', why: 'gone quiet, set to close' };
    return { action: 'close', reason, resolution: RESOLUTION_OF[r.verdict as keyof typeof RESOLUTION_OF], why: `${reason} at ${r.confidence}` };
  }
  // Ask: a live item goes to Looks done or Still needed?; a suggestion already sits in Triage, so it stays.
  if (item.status === 'suggested') return leave(`ask, already in Triage${notes.length ? ` (${notes.join('; ')})` : ''}`);
  if (!LIVE.has(item.status)) return leave(`item is ${item.status}`);
  return { action: LOOKS_DONE.has(reason) ? 'ask_looks_done' : 'ask_still_needed', reason, why: notes.join('; ') || `${reason} is set to ask` };
}
