/**
 * The guide's "seen" bookkeeping (settings.guide.seen: id → when). Pure, so the merge rules are tested: a mark the
 * user already saw keeps its first time, and a stale write (409) re-sends the union with the server's copy, so two
 * tabs never lose each other's marks.
 */
import type { GuideSettings } from '@/contract';

export function mergeSeen(server: GuideSettings['seen'], ids: readonly string[], at: string): GuideSettings['seen'] {
  const out = { ...server };
  for (const id of ids) if (!out[id]) out[id] = at;
  return out;
}

/** Ids not in `seen` yet, in order. */
export function unseen<T extends { id: string }>(marks: readonly T[], seen: GuideSettings['seen'], local: ReadonlySet<string> = new Set()): T[] {
  return marks.filter((m) => !seen[m.id] && !local.has(m.id));
}

/** Every coach mark and tip on, checklist back: what Settings ▸ About's "Show the guide again" writes. */
export const GUIDE_RESET: Pick<GuideSettings, 'checklistDismissed' | 'seen'> = { checklistDismissed: false, seen: {} };
