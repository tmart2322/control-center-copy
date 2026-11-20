/**
 * Pure view logic for the v2 detail (docked panel, restyled sheet and page). No React.
 *
 * DESIGN-V2 principle 8: color is an indicator, never identity, and a row carries at most one color
 * signal. Every helper here returns a tone from {risk, warn, ok, ai, brand, neutral} plus a glyph and a
 * word, so the color is never the only cue.
 */
import type { AgentRun, CalendarEvent, NbaCard, NbaVerb, SourceRef, Tone, WorkItem, WorkItemDetail } from '@/contract';
import { CLOSED_STATES, fmtMin, judgmentWord } from './derive';
import { fmtWhen } from './tz';

export interface Badge {
  tone: Tone;
  glyph: string;
  label: string;
}

const HOUR = 3_600_000;

/**
 * The header's one state badge: closed → green, overdue / expired start-by → red, needs you / start-by
 * today / due soon → amber, AI-proposed states → violet. Null when nothing needs a signal.
 */
export function stateBadge(item: WorkItem, now: string, tz?: string): Badge | null {
  const t = Date.parse(now);
  if (item.state === 'done') return { tone: 'ok', glyph: '✓', label: 'Done' };
  if (item.state === 'dismissed') return { tone: 'neutral', glyph: '–', label: 'Dismissed' };
  if (item.state === 'snoozed') return { tone: 'neutral', glyph: '◷', label: item.snoozedUntil ? `Snoozed until ${fmtWhen(item.snoozedUntil, now, tz)}` : 'Snoozed' };
  // LD-1: likely done wins over the clock (it waits for Confirm, not for work); green = ready.
  if (item.state === 'likely_done') return { tone: 'ok', glyph: '✓', label: 'Looks done' };
  if (item.due && Date.parse(item.due) < t) return { tone: 'risk', glyph: '✕', label: `Overdue · ${fmtWhen(item.due, now, tz)}` };
  const started = item.state === 'in_progress';
  if (item.startBy && !started && Date.parse(item.startBy) < t) return { tone: 'risk', glyph: '✕', label: `Expired · start by ${fmtWhen(item.startBy, now, tz)}` };
  if (item.state === 'waiting_on_me') return { tone: 'warn', glyph: '◷', label: 'Waiting on you' };
  if (item.state === 'reopened') return { tone: 'warn', glyph: '↺', label: item.loopedBackIn ? 'Looped back in' : 'Reopened' };
  if (item.startBy && !started && Date.parse(item.startBy) - t < 12 * HOUR) return { tone: 'warn', glyph: '◷', label: `Start by ${fmtWhen(item.startBy, now, tz)}` };
  if (item.due && Date.parse(item.due) - t < 72 * HOUR) return { tone: 'warn', glyph: '◷', label: `Due ${fmtWhen(item.due, now, tz)}` };
  if (item.state === 'suggested') return { tone: 'ai', glyph: '✦', label: 'Suggested' };
  if (item.state === 'in_progress') return { tone: 'brand', glyph: '●', label: 'In progress' };
  if (item.state === 'waiting_on_others') return { tone: 'neutral', glyph: '…', label: `Waiting on ${item.waiting?.who?.name?.split(' ')[0] ?? 'others'}` };
  return null;
}

const REPLY_VERBS: ReadonlySet<NbaVerb> = new Set(['send', 'nudge', 'answer']);

/**
 * "Do now · 1 of 3", "Reply and approve", "Chase"…: the verb-named section the item lives in on Home.
 * `nowIds` is the NOW stack (Today/Home cache) when the host has it; otherwise the rank decides.
 */
export function sectionLine(item: WorkItem, nba: Pick<NbaCard, 'verb'> | null, nowIds?: readonly string[] | null): string {
  const i = nowIds ? nowIds.indexOf(item.id) : -1;
  if (i >= 0) return `Do now · ${i + 1} of ${nowIds!.length}`;
  if (CLOSED_STATES.has(item.state)) return 'Closed';
  if (item.rank && item.rank <= 3) return `Do now · #${item.rank}`;
  if (item.state === 'suggested') return 'Triage';
  if (item.state === 'waiting_on_others') return 'Chase';
  if (nba && REPLY_VERBS.has(nba.verb)) return 'Reply and approve';
  if (nba?.verb === 'log') return 'Log and fix';
  if (item.refs.meeting) return 'Prep';
  return 'Think ahead';
}

/** "Why it's first" for #1, "Why it's here" for the rest of the NOW stack, else "Why". */
export function whyHeading(line: string): string {
  if (/^Do now · (1 of|#1$)/.test(line)) return "Why it's first";
  if (line.startsWith('Do now')) return "Why it's here";
  return 'Why';
}

/** Item + NBA sources, deduplicated by kind and label (the NBA's first: it explains the next step). */
export function evidenceSources(item: Pick<WorkItem, 'sources'>, nba?: Pick<NbaCard, 'sources'> | null, max = 6): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const s of [...(nba?.sources ?? []), ...item.sources]) {
    const k = `${s.kind}|${s.label}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out.slice(0, max);
}

// ── Plan: your steps vs agent steps ───────────────────────────────────────────────────────

export interface PlanStep {
  who: 'you' | 'agent';
  label: string;
  minutes: number;
  sub?: string;
  run?: AgentRun | null;
}

export const AGENT_LANE_NOTE = "Runs in the background; doesn't count against your day.";

/**
 * Agent work first (it starts in the background), then yours. Effort stays split: your minutes and agent
 * minutes are never summed (UI-SPEC §1.8, DESIGN-V2 capacity).
 */
export function planSteps(item: WorkItem, nba: NbaCard | null, runs: AgentRun[]): PlanStep[] {
  const steps: PlanStep[] = [];
  const agentVerb = nba?.verb === 'start_in_claude' || nba?.verb === 'run_tool';
  const run = runs.find((r) => r.state !== 'done' && r.state !== 'stale') ?? null;
  if (item.effort.agentMin > 0 || agentVerb || run) {
    const label =
      nba?.verb === 'start_in_claude'
        ? 'Agent works it in a Claude session'
        : nba?.verb === 'run_tool'
          ? `Agent runs ${nba.primaryLabel.replace(/^Run\s+/i, '') || 'the tool'}`
          : run
            ? `Agent: ${run.title}`
            : 'Agent prepares it';
    // The Claude context pack shows its own session state; don't repeat it on the step.
    steps.push({ who: 'agent', label, minutes: item.effort.agentMin, sub: AGENT_LANE_NOTE, run: nba?.verb === 'start_in_claude' ? null : run });
  }
  const you = nba?.title ?? item.title;
  const review = steps.length && nba?.verb === 'start_in_claude' ? `You review what the session made: ${you.replace(/^Start in Claude:\s*/i, '')}` : you;
  steps.push({ who: 'you', label: review, minutes: item.effort.youMin });
  return steps;
}

/** "you ~20m, agent ~20m in background" (agent omitted when there's none). */
export function planSummary(item: Pick<WorkItem, 'effort'>, hasAgent: boolean): string {
  const you = item.effort.youMin ? `you ~${fmtMin(item.effort.youMin)}` : 'you —';
  return hasAgent && item.effort.agentMin ? `${you}, agent ~${fmtMin(item.effort.agentMin)} in background` : you;
}

// ── Readiness: the prep checklist for the meeting this item serves ────────────────────────────

export interface ReadyCheck {
  id: string;
  ready: boolean;
  label: string;
  /** The open item behind the check (opens it). */
  itemId?: string;
  self?: boolean;
}

export function readiness(detail: Pick<WorkItemDetail, 'item' | 'siblings' | 'meeting'>): { title: string; checks: ReadyCheck[] } | null {
  const { item, siblings, meeting } = detail;
  const m = item.refs.meeting;
  const checks: ReadyCheck[] = [];
  if (m) {
    for (const s of siblings) {
      if (s.id === item.id || s.refs.meeting?.id !== m.id) continue;
      checks.push({ id: s.id, ready: CLOSED_STATES.has(s.state), label: s.title, itemId: s.id });
    }
    checks.push({ id: item.id, ready: CLOSED_STATES.has(item.state), label: `${item.title}, this one`, self: true });
  }
  const prep = (meeting as CalendarEvent | null)?.prep;
  if (prep && prep.workItemId !== item.id && !checks.some((c) => c.itemId && c.itemId === prep.workItemId)) {
    checks.unshift({ id: `prep:${meeting!.id}`, ready: prep.ready, label: prep.label, itemId: prep.workItemId ?? undefined });
  }
  if (item.deliverable) {
    const j = judgmentWord(item.deliverable);
    checks.push({ id: 'deliverable', ready: j.word === 'Yes', label: `${item.deliverable.fileName}: ${j.label.toLowerCase()}` });
  }
  if (!checks.length) return null;
  const title = m ? `Readiness for ${m.label}` : 'Readiness';
  return { title, checks: checks.sort((a, b) => Number(b.ready) - Number(a.ready)) };
}

// ── Same initiative ──────────────────────────────────────────────────────────────────────────

/** One dot per sibling: blue now, red overdue, amber needs you, green done, neutral otherwise. */
export function siblingTone(s: WorkItem, now: string): Tone {
  const t = Date.parse(now);
  if (CLOSED_STATES.has(s.state)) return 'ok';
  if (s.due && Date.parse(s.due) < t) return 'risk';
  if (s.state === 'in_progress' || (s.refs.meeting && Math.abs(Date.parse(s.refs.meeting.start) - t) < 30 * 60_000)) return 'brand';
  if (s.state === 'waiting_on_me' || s.state === 'reopened' || s.stale) return 'warn';
  return 'neutral';
}

/** The right-hand date for a sibling: its meeting, due or start by; "no date" otherwise. */
export function siblingWhen(s: WorkItem, now: string, tz?: string): string {
  if (CLOSED_STATES.has(s.state)) return s.doneAt ? `done ${fmtWhen(s.doneAt, now, tz)}` : 'done';
  if (s.refs.meeting) return fmtWhen(s.refs.meeting.start, now, tz, { today: true });
  if (s.due) return `due ${fmtWhen(s.due, now, tz)}`;
  if (s.startBy) return `start ${fmtWhen(s.startBy, now, tz)}`;
  return 'no date';
}

/** Open siblings first (stable), then closed; capped for the panel with the rest behind "See all". */
export function siblingsForPanel(siblings: WorkItem[], selfId: string, cap: number): { shown: WorkItem[]; more: number } {
  const others = siblings.filter((s) => s.id !== selfId);
  const open = others.filter((s) => !CLOSED_STATES.has(s.state));
  const closed = others.filter((s) => CLOSED_STATES.has(s.state));
  const all = [...open, ...closed];
  return { shown: all.slice(0, cap), more: Math.max(0, all.length - cap) };
}
