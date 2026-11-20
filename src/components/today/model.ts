/**
 * Today page model (P1): pure helpers, no React. Unit-tested in tests/p1.
 *
 * - reconcileOrder: keeps the NOW stack and "more today" rows stable under live updates
 *   (UI-SPEC §1.7, §10: nothing moves under the cursor; rank changes go to the pill).
 * - claudeIntent: Start in Claude vs Open in Claude (a claude:// link opens only on an explicit click).
 * - local plan: spine re-plans and fit-in slotting (no contract route; internal only, never the calendar).
 * - snooze presets in the profile timezone.
 */
import type { NowCard, SpineSlot, WorkItem, WorkState } from '@/contract';

// ---------------------------------------------------------------------------
// Actionable items
// ---------------------------------------------------------------------------

/** States that belong in NOW / more today (mirrors the ranker's rankable set). */
export const NOW_STATES: ReadonlySet<WorkState> = new Set(['open', 'in_progress', 'waiting_on_me', 'likely_done', 'reopened']);

export function isActionable(item: Pick<WorkItem, 'state' | 'isBackground'>): boolean {
  return NOW_STATES.has(item.state) && !item.isBackground;
}

// ---------------------------------------------------------------------------
// Stable order
// ---------------------------------------------------------------------------

export interface ReconcileInput {
  /** What is on screen now (null on first data). */
  prev: string[] | null;
  /** The server's order, already filtered to actionable items. */
  server: string[];
  /** Cap (3 for the NOW stack). */
  max?: number;
  /** The id under the cursor: never removed by a live update (only by the user's own action). */
  pinned?: string | null;
  /** Ids the user acted on (done, snooze…): they may leave even when pinned. */
  removedByUser?: ReadonlySet<string>;
  /** Re-insert positions for ids coming back (undo, rollback). */
  restore?: ReadonlyMap<string, number>;
  /** Explicit re-rank: take the server order as is. */
  adopt?: boolean;
}

export interface ReconcileResult {
  order: string[];
  /** Ids appended at the end (arrivals). */
  added: string[];
  /** Ids kept on screen although the server dropped them (under the cursor). */
  held: string[];
  /** Positions where the shown order differs from the server's (feeds the re-rank pill). */
  outOfOrder: number;
}

export function reconcileOrder({ prev, server, max, pinned = null, removedByUser, restore, adopt }: ReconcileInput): ReconcileResult {
  const cap = (ids: string[]) => (max ? ids.slice(0, max) : ids);
  if (!prev || adopt) return { order: cap([...server]), added: [], held: [], outOfOrder: 0 };
  const serverSet = new Set(server);
  const kept = prev.filter((id) => serverSet.has(id) || (id === pinned && !removedByUser?.has(id)));
  const held = kept.filter((id) => !serverSet.has(id));
  const keptSet = new Set(kept);
  const order = [...kept];
  const added: string[] = [];
  for (const id of server) {
    if (keptSet.has(id)) continue;
    const at = restore?.get(id);
    if (at !== undefined) order.splice(Math.max(0, Math.min(at, order.length)), 0, id);
    else {
      order.push(id);
      added.push(id);
    }
    keptSet.add(id);
  }
  if (max) {
    while (order.length > max) {
      // Drop from the end, never the pinned id.
      let i = order.length - 1;
      while (i >= 0 && order[i] === pinned) i--;
      if (i < 0) break;
      const [gone] = order.splice(i, 1);
      const a = added.indexOf(gone!);
      if (a >= 0) added.splice(a, 1);
    }
  }
  const target = cap(server);
  let outOfOrder = 0;
  for (let i = 0; i < Math.max(order.length, target.length); i++) if (order[i] !== target[i]) outOfOrder++;
  return { order, added, held, outOfOrder };
}

/**
 * A restore slot is spent only when its id actually comes back (it was off screen and is now shown).
 * Renders between the user's action and the optimistic patch still show the id and must not spend it.
 */
export function consumeReentries(prev: string[] | null, order: string[], restore: Map<string, number>, removed: Set<string> | null): void {
  const before = new Set(prev ?? []);
  for (const id of order) {
    if (before.has(id)) continue;
    restore.delete(id);
    removed?.delete(id);
  }
}

/** Arrivals worth a "n new ↓" marker: created, reopened or looped back in after `since`. */
export function isFreshArrival(item: WorkItem, sinceIso: string): boolean {
  const since = Date.parse(sinceIso);
  const times = [item.createdAt, item.reopened?.at, item.loopedBackIn?.at].filter((t): t is string => !!t).map((t) => Date.parse(t));
  return times.some((t) => t > since);
}

// ---------------------------------------------------------------------------
// Claude deep links
// ---------------------------------------------------------------------------

export type ClaudeIntent = { kind: 'open'; url: string } | { kind: 'launch' };

/**
 * An existing session (the item's run has a continue/needs-input link) opens directly; otherwise the
 * server builds the context-packed `claude://code/new` link and records the run (POST /agents/launch).
 */
export function claudeIntent(card: Pick<NowCard, 'run'>, url: string | null): ClaudeIntent {
  const link = card.run?.kind === 'claude_session' ? card.run.deepLink : null;
  const existing = link && /^claude:\/\/code\/(continue|needs-input)/.test(link) ? link : null;
  if (existing) return { kind: 'open', url: existing };
  if (url && /^claude:\/\/code\/(continue|needs-input)/.test(url)) return { kind: 'open', url };
  return { kind: 'launch' };
}

export function isClaudeUrl(url: string | null | undefined): url is string {
  return !!url && /^claude:\/\//.test(url);
}

// ---------------------------------------------------------------------------
// Local plan (spine re-plans, fit-in slotting)
// ---------------------------------------------------------------------------

/** slotId → new start; `fit:<itemId>` → a new work slot placed into a gap. */
export interface LocalPlan {
  moves: Record<string, string>;
  fits: Record<string, { start: string; end: string; label: string; gapId: string }>;
}

export const EMPTY_PLAN: LocalPlan = { moves: {}, fits: {} };

const T = (iso: string) => Date.parse(iso);

/** Apply the local plan to the server's slots: moved slots shift, covered gaps shrink or vanish. */
export function applyPlan(slots: SpineSlot[], plan: LocalPlan | null | undefined): SpineSlot[] {
  if (!plan) return slots;
  let out = slots.map((s) => {
    const to = plan.moves[s.id];
    if (!to) return s;
    const len = T(s.end) - T(s.start);
    return { ...s, start: to, end: new Date(T(to) + len).toISOString() };
  });
  for (const [itemId, f] of Object.entries(plan.fits)) {
    out.push({ id: `fit:${itemId}`, kind: 'work', start: f.start, end: f.end, label: f.label, workItemId: itemId });
  }
  // Work placed into a gap takes that time out of the gap.
  const work = out.filter((s) => s.kind !== 'gap');
  out = out.flatMap((g) => {
    if (g.kind !== 'gap') return [g];
    const inside = work.filter((w) => T(w.start) >= T(g.start) && T(w.start) < T(g.end) && (plan.moves[w.id] || w.id.startsWith('fit:')));
    if (!inside.length) return [g];
    const end = Math.max(...inside.map((w) => T(w.end)));
    if (end >= T(g.end)) return [];
    const mins = Math.round((T(g.end) - end) / 60_000);
    return [{ ...g, start: new Date(end).toISOString(), label: `${mins}m gap` }];
  });
  return out.sort((a, b) => T(a.start) - T(b.start));
}

// ---------------------------------------------------------------------------
// Time in the profile timezone
// ---------------------------------------------------------------------------

function zoneParts(ms: number, tz?: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), min: Number(p.minute), wd: String(p.weekday) };
}

/** The instant whose wall clock in `tz` reads y-m-d hh:mm. */
export function zonedInstant(y: number, m: number, d: number, hh: number, mm: number, tz?: string): Date {
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    const p = zoneParts(guess, tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    guess += Date.UTC(y, m - 1, d, hh, mm) - asUtc;
  }
  return new Date(guess);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface SnoozePreset {
  id: 'later' | 'tomorrow' | 'next_week';
  label: string;
  until: string;
}

/** Later today (+3 h, rounded to the quarter) · Tomorrow 09:00 · Monday 09:00, in the profile timezone. */
export function snoozePresets(nowIso: string, tz?: string): SnoozePreset[] {
  const now = T(nowIso);
  const later = Math.ceil((now + 3 * 3_600_000) / 900_000) * 900_000;
  const p = zoneParts(now, tz);
  const base = Date.UTC(p.y, p.m - 1, p.d);
  const dayAt = (addDays: number) => {
    const d = new Date(base + addDays * 86_400_000);
    return zonedInstant(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 9, 0, tz);
  };
  const wd = WEEKDAYS.indexOf(p.wd);
  const toMonday = ((8 - (wd < 0 ? 1 : wd)) % 7) || 7;
  return [
    { id: 'later', label: 'Later today', until: new Date(later).toISOString() },
    { id: 'tomorrow', label: 'Tomorrow morning', until: dayAt(1).toISOString() },
    { id: 'next_week', label: 'Next week', until: dayAt(toMonday).toISOString() },
  ];
}

// ---------------------------------------------------------------------------
// Card labels
// ---------------------------------------------------------------------------

/**
 * Pre-emption label above a card (ENGINES.md: "now late unless started"; UI-SPEC §4.3 promotion).
 * - promoted: a waiting run linked to an item ranked below the Top 3.
 * - preempt: start-by within 5 min (or passed) while the deadline is still ahead.
 */
export function preemptLabel(card: NowCard, nowIso: string, graceMin = 5): { kind: 'promoted' | 'preempt'; text: string } | null {
  const { item, run } = card;
  if (item.state === 'waiting_on_me' && run?.state === 'waiting_on_you' && (item.rank === null || item.rank > 3)) {
    return { kind: 'promoted', text: `Moved up: ${run.kind === 'claude_session' ? 'the Claude session' : 'the run'} is waiting on you` };
  }
  if (!item.startBy || !['open', 'reopened'].includes(item.state)) return null;
  const now = T(nowIso);
  const startBy = T(item.startBy);
  const due = item.due ? T(item.due) : null;
  if (startBy <= now + graceMin * 60_000 && (due === null || due > now)) return { kind: 'preempt', text: 'Late unless you start it now' };
  return null;
}
