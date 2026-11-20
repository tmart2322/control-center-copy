/**
 * SETTLE-1: how a closed-for-you item reads wherever it appears (Triage's "Closed for you" group, Home's line). Pure,
 * so the server views and the client rows share it.
 *
 * The badge names the reason class (`resolutionDetail.settle.reason`; older engine closes carry only a resolution,
 * which maps to the nearest class). The why line is the plain reason the engine wrote ("You sent the deck"), plus how
 * long after the ask the settling message came when both times are known.
 */
import type { ClosingReason, Evidence, Resolution, ResolutionDetail } from '@/contract';
import { gapLabel } from './looks-done';

/** The window the Triage group covers. */
export const CLOSED_WINDOW_DAYS = 14;

export const CLOSING_REASON_LABEL: Record<ClosingReason, string> = {
  done_by_you: 'Done by you',
  resolved_by_other: 'Resolved by someone else',
  moment_passed: 'Moment passed',
  not_yours: 'Not yours',
  not_an_ask: 'Not an ask',
  duplicate: 'Duplicate',
  superseded: 'Superseded',
  gone_quiet: 'Gone quiet',
};

/** Done and resolved say "finished" (the success tone); the rest only say why it left. */
export const CLOSING_REASON_TONE: Record<ClosingReason, 'success' | 'neutral'> = {
  done_by_you: 'success',
  resolved_by_other: 'success',
  moment_passed: 'neutral',
  not_yours: 'neutral',
  not_an_ask: 'neutral',
  duplicate: 'neutral',
  superseded: 'neutral',
  gone_quiet: 'neutral',
};

const FROM_RESOLUTION: Partial<Record<Resolution, ClosingReason>> = {
  done_by_me: 'done_by_you',
  done_by_other: 'resolved_by_other',
  handed_off: 'not_yours',
  duplicate: 'duplicate',
  superseded: 'superseded',
};

interface ClosedLike {
  resolution: Resolution | null;
  resolutionDetail: ResolutionDetail | null;
}

/** The reason class: the Settle check's own, else the nearest one for the resolution (null: no class to name). */
export function closedReasonClass(w: ClosedLike): ClosingReason | null {
  return w.resolutionDetail?.settle?.reason ?? (w.resolution ? (FROM_RESOLUTION[w.resolution] ?? null) : null);
}

/** "Done by you", "Resolved by PERSON", "Moment passed"…, with its tone. A class-less close reads "Closed". */
export function closedBadge(w: ClosedLike): { label: string; tone: 'success' | 'neutral' } {
  const r = closedReasonClass(w);
  if (!r) return { label: 'Closed', tone: 'neutral' };
  const name = w.resolutionDetail?.personName?.trim();
  if (r === 'resolved_by_other' && name) return { label: `Resolved by ${name}`, tone: 'success' };
  return { label: CLOSING_REASON_LABEL[r], tone: CLOSING_REASON_TONE[r] };
}

/** The evidence the why line reads: its role, and when its message was posted. */
export type ClosedEvidence = Pick<Evidence, 'id' | 'workItemId' | 'role' | 'at'> & { source?: { at?: string } };

interface WhyInput extends ClosedLike {
  id: string;
  closedReason: string | null;
  sources: Array<{ at?: string }>;
}

/**
 * The why line: the plain reason, plus "· 2 h after the ask" when the ask (the origin evidence, else the earliest
 * source time) and the settling message (the cited evidence, else the completion evidence) both carry a time.
 */
/** The badge already names the class: a reason that starts with it ("Done by you: your reply…") drops the prefix. */
const CLASS_PREFIX = /^(?:done by (?:you|me)|resolved by [^:]{1,80}|handed off(?: to [^:]{1,80})?|moment passed|not yours|not an ask|not needed|duplicate|superseded|gone quiet)\s*:\s*/i;

export function closedWhy(w: WhyInput, evidence: ReadonlyArray<ClosedEvidence>): string {
  const raw = (w.closedReason ?? '').trim();
  const stripped = raw.replace(CLASS_PREFIX, '');
  const line = (stripped ? stripped.charAt(0).toUpperCase() + stripped.slice(1) : raw) || 'Closed for you';
  if (/after the ask/i.test(line)) return line;
  const mine = evidence.filter((e) => e.workItemId === w.id);
  const ms = (iso: string | undefined | null) => (iso ? Date.parse(iso) : NaN);
  // when the message was posted (the source's time), not when the evidence was linked (the row's `at` in the db)
  const posted = (e: ClosedEvidence | undefined) => ms(e?.source?.at ?? e?.at);
  const origins = mine.filter((e) => e.role === 'origin').map(posted);
  const sourceTimes = w.sources.map((s) => ms(s.at));
  const askAt = Math.min(...[...origins, ...sourceTimes].filter(Number.isFinite));
  const cited = w.resolutionDetail?.evidenceIds?.map((id) => mine.find((e) => e.id === id)).find(Boolean) ?? mine.find((e) => e.role === 'completion');
  const settledAt = posted(cited);
  if (!Number.isFinite(askAt) || !Number.isFinite(settledAt)) return line;
  const gap = settledAt - askAt;
  return gap >= 60_000 && gap <= 60 * 86_400_000 ? `${line} · ${gapLabel(gap)} after the ask` : line;
}

/** Closed by the engine at or after `sinceMs` (Home's "since you left", Triage's 14 days). */
export function closedForYouSince<T extends { state: string; doneBy: string | null; doneAt: string | null }>(items: readonly T[], sinceMs: number): T[] {
  return items.filter((w) => w.state === 'done' && w.doneBy === 'engine' && !!w.doneAt && Date.parse(w.doneAt) >= sinceMs);
}
