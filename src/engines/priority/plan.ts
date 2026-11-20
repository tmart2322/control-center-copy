/**
 * Day plan: gaps between today's meetings, spine slots (what to do in each gap) and fit-ins. The plan
 * holds today's load (today-scoped items, then chores) in rank order, then fit-in suggestions in what is
 * left; capacity (capacity.ts) is computed from the same gaps and the same today-scoped set.
 * Internal re-planning only: nothing here ever writes to the calendar (UI-SPEC §4.2).
 */
import type { Meeting, PlanStepMode, TimeWindow } from '@/engines/types';
import type { PriorityPolicy } from './policy';
import type { Prepared } from './score';
import {
  DAY_MS,
  formatDuration,
  formatLocalHHMM,
  formatLocalWhen,
  freeIntervals,
  isBusy,
  localDayStart,
  MINUTE_MS,
  minutesBetween,
  toIso,
  toMs,
  type Interval,
} from './time';
import type { FitInEntry, Gap, PlanStep, PlannedChore, SpineSlot } from './types';

/** Small items are never split across gaps; bigger focus work may be. */
const SPLIT_THRESHOLD_MIN = 30;
const MIN_GAP_LABEL_MIN = 10;

interface FreeSlot {
  /** The original gap ("your 11:30 gap"). */
  gapStartMs: number;
  gapEndMs: number;
  /** Remaining free capacity inside the gap. */
  startMs: number;
  endMs: number;
}

export interface PlanInput {
  nowMs: number;
  utcOffsetMinutes: number;
  windows: TimeWindow[];
  meetings: Meeting[];
  policy: PriorityPolicy;
  /** Today-scoped items (today's load), in final rank order. */
  today: Prepared[];
  /** Today's chores (approvals, re-auth), planned after the items. */
  chores: PlannedChore[];
  /** Items that would rather sit on the Fit-ins shelf, in rank order (never today's load). */
  fitInCandidates: Prepared[];
}

export interface PlanOutput {
  gaps: Gap[];
  spine: SpineSlot[];
  planSteps: PlanStep[];
  fitIns: FitInEntry[];
  fitInOverflow: string[];
  /** Free minutes left today after meetings (Σ gaps). */
  freeMin: number;
}

function modeOf(p: Prepared): PlanStepMode {
  if (p.agentRemainingMin > 0 && p.item.status === 'open') return 'kickoff_background';
  if (p.meeting) return 'meeting_prep';
  if (p.youMin <= 15) return 'quick_win';
  return 'focus';
}

function take(slots: FreeSlot[], needMin: number, allowSplit: boolean): Array<{ slot: FreeSlot; startMs: number; endMs: number }> {
  const need = needMin * MINUTE_MS;
  if (!allowSplit) {
    const s = slots.find((x) => x.endMs - x.startMs >= need);
    if (!s) return [];
    const startMs = s.startMs;
    s.startMs += need;
    return [{ slot: s, startMs, endMs: startMs + need }];
  }
  const total = slots.reduce((sum, x) => sum + (x.endMs - x.startMs), 0);
  if (total <= 0) return [];
  let left = Math.min(need, total);
  const out: Array<{ slot: FreeSlot; startMs: number; endMs: number }> = [];
  for (const s of slots) {
    if (left <= 0) break;
    const avail = s.endMs - s.startMs;
    if (avail <= 0) continue;
    const use = Math.min(avail, left);
    out.push({ slot: s, startMs: s.startMs, endMs: s.startMs + use });
    s.startMs += use;
    left -= use;
  }
  return out;
}

export function planDay(input: PlanInput): PlanOutput {
  const { nowMs, utcOffsetMinutes: off } = input;
  const dayStart = localDayStart(nowMs, off);
  const dayEnd = dayStart + DAY_MS;
  const todayWindows = input.windows.filter((w) => toMs(w.start) < dayEnd && toMs(w.end) > dayStart);
  const busyMeetings = input.meetings.filter(isBusy);
  const busy: Interval[] = busyMeetings.map((m) => ({ startMs: toMs(m.start), endMs: toMs(m.end) }));
  const free = freeIntervals(todayWindows, busy, nowMs, 5);

  const gaps: Gap[] = free.map((i) => ({ start: toIso(i.startMs), end: toIso(i.endMs), minutes: Math.round(minutesBetween(i.startMs, i.endMs)) }));
  const freeMin = gaps.reduce((s, g) => s + g.minutes, 0);
  const slots: FreeSlot[] = free.map((i) => ({ gapStartMs: i.startMs, gapEndMs: i.endMs, startMs: i.startMs, endMs: i.endMs }));

  const spine: SpineSlot[] = [];
  const steps: Array<Omit<PlanStep, 'ordinal'>> = [];

  for (const p of input.today) {
    const you = p.youMin;
    if (you <= 0) continue;
    const mode = modeOf(p);
    const chunks = take(slots, you, you > SPLIT_THRESHOLD_MIN);
    chunks.forEach((c, i) => {
      const at = formatLocalHHMM(c.startMs, off);
      const title = p.item.title;
      const label =
        mode === 'kickoff_background'
          ? `${at} ▶ Kick off: ${title}`
          : mode === 'meeting_prep'
            ? `${at} Prep: ${title}`
            : mode === 'focus'
              ? `${at} Focus: ${title}${chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ''}`
              : `${at} ${title}`;
      spine.push({
        id: `slot:${p.item.id}:${i}`,
        kind: mode === 'focus' ? 'focus' : 'work',
        start: toIso(c.startMs),
        end: toIso(c.endMs),
        label,
        workItemId: p.item.id,
        mode,
      });
      const late = p.startByMs !== null && c.startMs > p.startByMs;
      let reason: string;
      if (mode === 'kickoff_background') {
        const agentDone = c.endMs + p.agentRemainingMin * MINUTE_MS;
        reason = `Kick off now: agent ~${formatDuration(p.agentRemainingMin)} finishes ~${formatLocalWhen(agentDone, nowMs, off)}${p.deadline ? `, before ${p.deadline.label}` : ''}`;
      } else if (mode === 'meeting_prep' && p.meeting) {
        reason = `Ready before ${p.meeting.title} ${formatLocalWhen(toMs(p.meeting.start), nowMs, off)}`;
      } else {
        reason = p.deadline ? `Done before ${p.deadline.label}` : 'Fits the plan';
      }
      if (late) reason += ' (at risk: past its start-by)';
      steps.push({ workItemId: p.item.id, calendarEventId: null, mode, plannedStartAt: toIso(c.startMs), plannedEndAt: toIso(c.endMs), reason });
    });
  }

  for (const c of input.chores) {
    const chunks = take(slots, c.youMin, c.youMin > SPLIT_THRESHOLD_MIN);
    chunks.forEach((ch, i) => {
      const at = formatLocalHHMM(ch.startMs, off);
      spine.push({ id: `slot:${c.id}:${i}`, kind: 'work', start: toIso(ch.startMs), end: toIso(ch.endMs), label: `${at} ${c.title}`, workItemId: null, mode: 'quick_win' });
      steps.push({ workItemId: null, calendarEventId: null, mode: 'quick_win', plannedStartAt: toIso(ch.startMs), plannedEndAt: toIso(ch.endMs), reason: `${c.title} (you ${formatDuration(c.youMin)})` });
    });
  }

  const fitIns: FitInEntry[] = [];
  const fitInOverflow: string[] = [];
  for (const p of input.fitInCandidates) {
    const you = p.youMin;
    const [chunk] = take(slots, you, false);
    if (!chunk) {
      fitInOverflow.push(p.item.id);
      continue;
    }
    const gapAt = formatLocalHHMM(chunk.slot.gapStartMs, off);
    const gapMin = Math.round(minutesBetween(chunk.slot.gapStartMs, chunk.slot.gapEndMs));
    const gap: Gap = { start: toIso(chunk.slot.gapStartMs), end: toIso(chunk.slot.gapEndMs), minutes: gapMin };
    fitIns.push({
      workItemId: p.item.id,
      title: p.item.title,
      hint: `fits your ${gapAt} gap`,
      gap,
      plannedStart: toIso(chunk.startMs),
      plannedEnd: toIso(chunk.endMs),
      youMin: you,
      action: { label: 'Start', verb: 'start' },
    });
    spine.push({
      id: `slot:${p.item.id}:fit`,
      kind: 'fit_in',
      start: toIso(chunk.startMs),
      end: toIso(chunk.endMs),
      label: `${gapAt} ${formatDuration(gapMin)} gap: fits ${p.item.title}`,
      workItemId: p.item.id,
      mode: 'quick_win',
    });
    steps.push({
      workItemId: p.item.id,
      calendarEventId: null,
      mode: 'quick_win',
      plannedStartAt: toIso(chunk.startMs),
      plannedEndAt: toIso(chunk.endMs),
      reason: `Fit-in: fits your ${gapAt} gap (you ${formatDuration(you)})`,
    });
  }

  for (const s of slots) {
    const m = Math.round(minutesBetween(s.startMs, s.endMs));
    if (m < MIN_GAP_LABEL_MIN) continue;
    spine.push({
      id: `gap:${toIso(s.startMs)}`,
      kind: 'gap',
      start: toIso(s.startMs),
      end: toIso(s.endMs),
      label: `${formatLocalHHMM(s.startMs, off)} ${formatDuration(m)} gap`,
      workItemId: null,
      mode: null,
    });
  }

  for (const m of busyMeetings) {
    const s = toMs(m.start);
    const e = toMs(m.end);
    if (e <= nowMs || s >= dayEnd) continue;
    steps.push({ workItemId: null, calendarEventId: m.id, mode: 'meeting', plannedStartAt: m.start, plannedEndAt: m.end, reason: m.title });
  }

  spine.sort((a, b) => toMs(a.start) - toMs(b.start) || a.id.localeCompare(b.id));
  steps.sort(
    (a, b) =>
      toMs(a.plannedStartAt) - toMs(b.plannedStartAt) ||
      (a.calendarEventId ? 0 : 1) - (b.calendarEventId ? 0 : 1) ||
      (a.workItemId ?? a.calendarEventId ?? '').localeCompare(b.workItemId ?? b.calendarEventId ?? ''),
  );
  const planSteps: PlanStep[] = steps.map((s, i) => ({ ordinal: i + 1, ...s }));

  return { gaps, spine, planSteps, fitIns, fitInOverflow, freeMin };
}
