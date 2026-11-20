/** Placeholder fixtures (ACME, Globex, Dana…). Thu 2026-11-05, UTC, working hours 09:00–18:00 Mon–Fri. */
import { SE_IC_POLICY, type PriorityPolicy } from '@/engines/priority/policy';
import type { PriorityInputs } from '@/engines/priority/types';
import type { Meeting, PriorityItem, WorkingHours } from '@/engines/types';

export const DAY = '2026-11-05';
export const at = (hhmm: string, day = DAY): string => `${day}T${hhmm}:00.000Z`;

export const HOURS: WorkingHours = { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5], utcOffsetMinutes: 0 };

export function item(id: string, over: Partial<PriorityItem> = {}): PriorityItem {
  return {
    id,
    title: over.title ?? id,
    kind: 'task',
    status: 'open',
    effort: { youMin: 30, agentMin: 0 },
    createdAt: at('08:00'),
    ...over,
  };
}

export function meeting(id: string, start: string, end: string, over: Partial<Meeting> = {}): Meeting {
  return { id, title: over.title ?? id, start, end, ...over };
}

export function inputs(over: Partial<PriorityInputs> = {}): PriorityInputs {
  return { now: at('09:00'), items: [], meetings: [], policy: SE_IC_POLICY, workingHours: HOURS, ...over };
}

/** A policy variant (new id + version) for previews and "scores favor the other item" setups. */
export function withPolicy(over: Partial<PriorityPolicy>, version = 2): PriorityPolicy {
  return { ...SE_IC_POLICY, id: `policy:test@${version}`, version, ...over };
}

/** Deterministic PRNG for hand-rolled property tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
export const int = (r: () => number, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));

export function shuffle<T>(r: () => number, xs: T[]): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
