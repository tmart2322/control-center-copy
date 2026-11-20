/**
 * Hands-on estimates (DESIGN-V2 "Capacity and estimates"): estimate low, then learn.
 *
 * - Only YOUR minutes are estimated here. Agent and Claude-session time runs in the background and is
 *   never part of a hands-on estimate (UI-SPEC §1.8: you vs agent, never summed).
 * - `DEFAULT_HANDS_ON` holds the per-kind defaults used when an item has no estimate of its own
 *   (`effort.youMin` missing, zero or not a number). They err low on purpose.
 * - `calibrate(actuals)` learns a per-kind multiplier (and the median of the actuals) from recorded
 *   hands-on minutes: completed items with recorded minutes and the user's one-click corrections.
 *   Calibration only adjusts the defaults; an item's own estimate is used as given.
 *
 * Pure and deterministic: no I/O, no clock.
 */
import type { Effort, WorkItemKind } from '@/engines/types';

/** The estimate kinds the defaults and the calibration are keyed by. */
export type EstimateKind = 'reply' | 'post' | 'approve' | 'review' | 'reauth' | 'build' | 'training' | 'other';

export const ESTIMATE_KINDS: readonly EstimateKind[] = ['reply', 'post', 'approve', 'review', 'reauth', 'build', 'training', 'other'];

export interface HandsOnDefaults {
  /** Reply to an ask: 5–15. */
  reply: number;
  /** Post a status or a follow-up: 5–15. */
  post: number;
  /** Approve one draft: 2–5. */
  approve: number;
  /** Each further draft approved in the same batch ("Approve 3 drafts" = 3 + 1 + 1). */
  approveEachExtra: number;
  /** Review a deliverable, rows or an agent's output: 10–20. */
  review: number;
  /** Re-authenticate a connector. */
  reauth: number;
  /** A build is kickoff plus review, never the build's own duration (that is agent time). */
  buildKickoff: number;
  buildReview: number;
  /** A training without a stated LOE. */
  training: number;
  /** Anything else. */
  other: number;
}

/** The configurable defaults (minutes). Err low: calibration raises them when actuals say so. */
export const DEFAULT_HANDS_ON: Readonly<HandsOnDefaults> = Object.freeze({
  reply: 10,
  post: 10,
  approve: 3,
  approveEachExtra: 1,
  review: 15,
  reauth: 2,
  buildKickoff: 10,
  buildReview: 20,
  training: 30,
  other: 15,
});

/** Calibration knobs. */
export const CALIBRATION = Object.freeze({
  /** Pseudo-samples at multiplier 1: few actuals move the default only part of the way. */
  priorWeight: 2,
  /** With at least this many actuals the default becomes their median. */
  medianAfter: 5,
  minMultiplier: 0.25,
  maxMultiplier: 4,
});

/** The default hands-on minutes for one estimate kind. */
export function defaultYouMin(kind: EstimateKind, defaults: HandsOnDefaults = DEFAULT_HANDS_ON): number {
  switch (kind) {
    case 'build':
      return defaults.buildKickoff + defaults.buildReview;
    case 'approve':
      return defaults.approve;
    default:
      return defaults[kind];
  }
}

export interface EstimateSubject {
  kind: WorkItemKind;
  title: string;
  effort: Partial<Effort>;
}

const RX: Array<[RegExp, EstimateKind]> = [
  [/\bre-?auth/i, 'reauth'],
  [/^\s*approve\b/i, 'approve'],
  [/^\s*(reply|answer|respond|confirm\b.*\bto\b|tell|ask|nudge|ping)\b/i, 'reply'],
  [/^\s*(post|send|share|schedule|follow up|update\b.*\b(thread|channel)\b)/i, 'post'],
  [/^\s*(review|check|confirm|verify|smoke-?test|test)\b/i, 'review'],
];

/** The estimate kind of an item, from its verb-first title, kind and agent split. */
export function estimateKindOf(s: EstimateSubject): EstimateKind {
  for (const [rx, kind] of RX) if (rx.test(s.title)) return kind;
  if (s.kind === 'training') return 'training';
  if ((s.effort.agentMin ?? 0) > 0) return 'build';
  if (s.kind === 'ask') return 'reply';
  if (s.kind === 'follow_up') return 'post';
  return 'other';
}

/** One recorded hands-on duration: a completed item's recorded minutes, or a user correction ("took 10m"). */
export interface EffortActual {
  estimateKind: EstimateKind;
  youMin: number;
  source?: 'completed' | 'correction' | 'time';
  at?: string;
}

export interface KindCalibration {
  kind: EstimateKind;
  /** Actuals behind it. */
  n: number;
  /** Median of the actual minutes. */
  median: number;
  /** Applied to the default (after shrinking toward 1 for few samples). */
  multiplier: number;
  /** The calibrated default this kind now uses. */
  youMin: number;
}

export type Calibration = Partial<Record<EstimateKind, KindCalibration>>;

function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Per-kind calibration from recent actuals. Kinds without actuals are absent (the default applies).
 * Few samples shrink the multiplier toward 1; from `medianAfter` samples on, the median is the default.
 */
export function calibrate(actuals: readonly EffortActual[], defaults: HandsOnDefaults = DEFAULT_HANDS_ON): Calibration {
  const byKind = new Map<EstimateKind, number[]>();
  for (const a of actuals) {
    if (!Number.isFinite(a.youMin) || a.youMin <= 0 || !ESTIMATE_KINDS.includes(a.estimateKind)) continue;
    const xs = byKind.get(a.estimateKind) ?? [];
    xs.push(a.youMin);
    byKind.set(a.estimateKind, xs);
  }
  const out: Calibration = {};
  for (const kind of ESTIMATE_KINDS) {
    const xs = byKind.get(kind);
    if (!xs?.length) continue;
    const base = defaultYouMin(kind, defaults);
    const med = median(xs);
    const n = xs.length;
    let multiplier: number;
    if (n >= CALIBRATION.medianAfter) multiplier = med / base;
    else multiplier = 1 + (med / base - 1) * (n / (n + CALIBRATION.priorWeight));
    multiplier = Math.min(CALIBRATION.maxMultiplier, Math.max(CALIBRATION.minMultiplier, multiplier));
    out[kind] = { kind, n, median: round2(med), multiplier: round2(multiplier), youMin: Math.max(1, Math.round(base * multiplier)) };
  }
  return out;
}

export interface Estimator {
  defaults: HandsOnDefaults;
  calibration: Calibration;
}

export function makeEstimator(opts: { defaults?: Partial<HandsOnDefaults>; actuals?: readonly EffortActual[] } = {}): Estimator {
  const defaults = { ...DEFAULT_HANDS_ON, ...(opts.defaults ?? {}) };
  return { defaults, calibration: calibrate(opts.actuals ?? [], defaults) };
}

/** The (calibrated) default for one kind. */
export function kindYouMin(kind: EstimateKind, est: Estimator): number {
  return est.calibration[kind]?.youMin ?? defaultYouMin(kind, est.defaults);
}

export type EstimateSource = 'item' | 'default' | 'calibrated';

/** Does the item carry its own hands-on estimate? */
export const hasOwnEstimate = (effort: Partial<Effort>): boolean => typeof effort.youMin === 'number' && Number.isFinite(effort.youMin) && effort.youMin > 0;

/** Hands-on minutes for an item: its own estimate, else the (calibrated) default for its kind. */
export function estimateYouMin(s: EstimateSubject, est: Estimator): { youMin: number; source: EstimateSource; kind: EstimateKind } {
  const kind = estimateKindOf(s);
  if (hasOwnEstimate(s.effort)) return { youMin: Math.round(s.effort.youMin!), source: 'item', kind };
  return { youMin: kindYouMin(kind, est), source: est.calibration[kind] ? 'calibrated' : 'default', kind };
}

/** Hands-on minutes to approve `count` drafts in one sitting. */
export function approveBatchMin(count: number, est: Estimator): number {
  if (count <= 0) return 0;
  const one = kindYouMin('approve', est);
  const extra = est.calibration.approve ? est.defaults.approveEachExtra * est.calibration.approve.multiplier : est.defaults.approveEachExtra;
  return Math.max(1, Math.round(one + (count - 1) * extra));
}
