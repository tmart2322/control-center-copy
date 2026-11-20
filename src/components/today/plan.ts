/**
 * The agent's plan as a diff (pattern 8, pure). Built from what the Today payload already carries:
 * - added: the engine's work slots for today (spine.slots), grouped per item;
 * - moved / updated: pending engine proposals on today's cards (a startBy / due change reads as "moved");
 * - deferred: shelf fit-ins that aren't today-scoped (the old plan counted them as today's load);
 * - re-order: a pending re-rank (nowStack.rerankReady).
 * Gap: there is no server route that stores an accepted day plan. Slot changes stay a local plan (never the
 * calendar), proposals go through /proposals/:id/apply|reject and the re-order through /today/rerank.
 */
import type { FieldChange, NowCard, Proposal, ShelfEntry, SpineSlot, WorkItem } from '@/contract';
import { dueLabel, hhmm, minuteOfDay, msOf, sameLocalDay } from './time';

export type PlanChangeKind = 'added' | 'moved' | 'updated' | 'deferred' | 'rerank';

export interface PlanChange {
  id: string;
  kind: PlanChangeKind;
  title: string;
  /** "Added · 08:35–09:05" (before is struck through when present). */
  when: { label: string; before: string | null; after: string | null; note: string | null };
  why: string;
  itemId: string | null;
  slotIds: string[];
  proposal: Proposal | null;
}

export interface PlanInput {
  nowIso: string;
  tz?: string;
  slots: SpineSlot[];
  cards: NowCard[];
  items: Map<string, WorkItem>;
  /** Items whose NBA runs an agent alongside (their "Added" line says so). */
  agentAlongside: ReadonlySet<string>;
  deferred: ShelfEntry[];
  rerankReady: number;
  todayIds: ReadonlySet<string>;
  /** Items listed under "Pull forward" (a deferred one says so). */
  pullIds?: ReadonlySet<string>;
}

const TIME_FIELDS = new Set(['startBy', 'due']);

function fmtValue(v: unknown, c: FieldChange, nowIso: string, tz?: string): string {
  if (v === null || v === undefined || v === '') return 'none';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return sameLocalDay(v, nowIso, tz) ? hhmm(minuteOfDay(v, tz)) : dueLabel(v, nowIso, tz, { withTime: true });
  if (c.field === 'effort' && v && typeof v === 'object' && 'youMin' in (v as object)) return `${(v as { youMin: number }).youMin}m`;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function planChanges(input: PlanInput): PlanChange[] {
  const { nowIso, tz } = input;
  const now = msOf(nowIso);
  const out: PlanChange[] = [];

  // Added: today's engine slots that haven't ended, one change per item (or per loose slot).
  const groups = new Map<string, SpineSlot[]>();
  for (const s of input.slots) {
    if (s.kind === 'gap' || s.id.startsWith('fit:') || !sameLocalDay(s.start, nowIso, tz) || msOf(s.end) <= now) continue;
    const k = s.workItemId ?? s.id;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  for (const [k, slots] of groups) {
    slots.sort((a, b) => msOf(a.start) - msOf(b.start));
    const item = slots[0]!.workItemId ? input.items.get(slots[0]!.workItemId!) : undefined;
    const card = input.cards.find((c) => c.item.id === item?.id);
    const ranges = slots.map((s) => `${hhmm(minuteOfDay(s.start, tz))}–${hhmm(minuteOfDay(s.end, tz))}`).join(', ');
    out.push({
      id: `add:${k}`,
      kind: 'added',
      title: card?.nba?.title ?? item?.title ?? slots[0]!.label.replace(/^\d{1,2}:\d{2}\s*/, '').replace(/^▶\s*/, ''),
      when: { label: 'Added', before: null, after: ranges, note: item && input.agentAlongside.has(item.id) ? 'agent checks alongside' : null },
      why: item?.why ?? '',
      itemId: item?.id ?? null,
      slotIds: slots.map((s) => s.id),
      proposal: null,
    });
  }

  // Moved / updated: pending engine proposals on today's cards.
  for (const c of input.cards) {
    for (const p of c.proposals) {
      if (p.status !== 'pending') continue;
      const time = p.changes.find((x) => TIME_FIELDS.has(x.field));
      const ch = time ?? p.changes[0]!;
      out.push({
        id: `prop:${p.id}`,
        kind: time ? 'moved' : 'updated',
        title: c.nba?.title ?? c.item.title,
        when: { label: time ? 'Moved' : `Update ${ch.label ?? ch.field}`, before: fmtValue(ch.before, ch, nowIso, tz), after: fmtValue(ch.after, ch, nowIso, tz), note: null },
        why: p.reason,
        itemId: c.item.id,
        slotIds: [],
        proposal: p,
      });
    }
  }

  // Deferred: shelf fit-ins the old plan put into today that aren't due today.
  for (const s of input.deferred) {
    if (input.todayIds.has(s.item.id)) continue;
    const due = s.item.training?.dueDate ?? s.item.due;
    out.push({
      id: `defer:${s.item.id}`,
      kind: 'deferred',
      title: s.item.title,
      when: { label: 'Deferred', before: 'today', after: due ? `before ${dueLabel(due.length === 10 ? `${due}T12:00:00Z` : due, nowIso, tz)}` : 'later', note: null },
      why: input.pullIds?.has(s.item.id) ? `Not due today. Still in Pull forward if you want ${s.item.training ? 'one' : 'it'} today.` : 'Not due today, so it doesn’t count against today. Undo keeps it today.',
      itemId: s.item.id,
      slotIds: [],
      proposal: null,
    });
  }

  if (input.rerankReady > 0) {
    out.push({
      id: 'rerank',
      kind: 'rerank',
      title: 'Re-order the run of day',
      when: { label: 'Re-order', before: null, after: `${input.rerankReady} would move`, note: null },
      why: 'New info changes the order. Nothing moves until you accept.',
      itemId: null,
      slotIds: [],
      proposal: null,
    });
  }
  return out;
}

export interface PlanSummary {
  added: number;
  moved: number;
  updated: number;
  deferred: number;
  rerank: number;
}

export function summarize(changes: PlanChange[], excluded: ReadonlySet<string>): PlanSummary {
  const s: PlanSummary = { added: 0, moved: 0, updated: 0, deferred: 0, rerank: 0 };
  for (const c of changes) if (!excluded.has(c.id)) s[c.kind]++;
  return s;
}

/** Local agent-plan state (resume extra): staged exclusions, acceptance, and what to undo after it. */
export interface AgentPlanState {
  /** Changes the user took out (struck through; not applied). */
  excluded: string[];
  acceptedAt: string | null;
  /** change id → audit id of the server mutation that applied it (proposal apply, re-rank). */
  audits: Record<string, string>;
  /** The day this state belongs to (a new day starts clean). */
  day: string | null;
}

export const EMPTY_AGENT_PLAN: AgentPlanState = { excluded: [], acceptedAt: null, audits: {}, day: null };
