/**
 * Kit-only derivations that turn the mock DataSource payloads into what the v2 compositions need: today's
 * hands-on capacity (DESIGN-V2: only today-scoped, hands-on minutes count; agent time never does), Home's
 * verb sections, the 14-day ahead strip, the agent lane, the agent's plan receipt and pull-forward rows.
 * The real versions live in the page lanes (P-HOME, P-TODAY) and the CAPACITY engine; this is a stand-in so
 * the domain components can be judged in place.
 */
import { Receipt, type NbaVerb, type ShelfEntry, type SpineSlot, type WorkItem, type WorkItemDetail } from '@/contract';
import { buildAheadDays, type AgentBlock, type AheadDay } from '@/components/domain';
import { clock, dueLabel, dur, minutesBetween, sameDay, stripClock, ymd, zonedIso } from '@/components/domain/lib/time';
import type { KitData } from './load';

const T = (iso: string) => Date.parse(iso);
const CLOSED = new Set(['done', 'dismissed', 'snoozed', 'suggested']);

export function isTodayScoped(it: WorkItem, now: string, tz?: string): boolean {
  if (CLOSED.has(it.state) || it.isBackground) return false;
  const at = it.startBy ?? it.due;
  return !!at && (sameDay(at, now, tz) || T(at) < T(now));
}

function uniq(items: WorkItem[]): WorkItem[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}

export function dayEnd(data: KitData): string {
  return zonedIso(ymd(data.now, data.tz), '17:30', data.tz);
}

/**
 * Today-scoped hands-on minutes vs free time outside meetings. The numbers come from the CAPACITY engine
 * (`today.header.capacity`, DESIGN-V2 binding); `items` is the kit's own list of today-scoped rows for the
 * run of day.
 */
export function capacity(data: KitData) {
  const { now, tz } = data;
  const t = data.today;
  const c = t.header.capacity;
  const items = uniq([...t.nowStack.cards.map((x) => x.item), ...t.moreToday.items]).filter((i) => isTodayScoped(i, now, tz));
  return { youMin: c.youMinToday, freeMin: c.freeMin, agentMin: c.agentMinBackground, agentRuns: c.agentRunsBackground, items };
}

export interface HomeSections {
  reply: WorkItemDetail[];
  ahead: WorkItemDetail[];
  log: WorkItemDetail[];
  chase: WorkItemDetail[];
  aheadDays: AheadDay[];
}

/** Home's verb sections. Every item lands in at most one section, so nothing is listed twice. */
export function homeSections(data: KitData): HomeSections {
  const { now, tz } = data;
  const lead = new Set(data.today.nowStack.cards.map((c) => c.item.id));
  const open = data.details.filter((d) => !lead.has(d.item.id) && !CLOSED.has(d.item.state) && d.item.state !== 'done');
  const at = (d: WorkItemDetail) => d.item.startBy ?? d.item.due;
  const byAt = (a: WorkItemDetail, b: WorkItemDetail) => (at(a) ? T(at(a)!) : Infinity) - (at(b) ? T(at(b)!) : Infinity);
  const taken = new Set<string>();
  const take = (pred: (d: WorkItemDetail) => boolean) => {
    const out = open.filter((d) => !taken.has(d.item.id) && pred(d)).sort(byAt);
    out.forEach((d) => taken.add(d.item.id));
    return out;
  };
  const chase = take((d) => d.item.state === 'waiting_on_others' || (d.item.kind === 'commitment' && d.item.isBackground));
  const log = take((d) => d.nba?.verb === 'log' || !!d.item.stale || d.nba?.verb === 'review_deliverable' || d.item.kind === 'training');
  const reply = take((d) => !!d.draft || d.nba?.verb === 'send' || d.nba?.verb === 'answer' || d.item.kind === 'ask');
  const horizon = T(now) + 15 * 86_400_000;
  const ahead = take((d) => {
    const a = at(d);
    return !!a && !sameDay(a, now, tz) && T(a) > T(now) && T(a) < horizon;
  });
  const risky = (d: WorkItemDetail) => d.item.state === 'reopened' || (d.item.signals.customerFacing && d.item.priority === 'high');
  const aheadDays = buildAheadDays(
    open.filter((d) => !!at(d)).map((d) => ({ at: at(d)!, atRisk: risky(d), label: d.item.title, big: d.item.signals.customerFacing && d.item.priority === 'high' })),
    { now, tz },
  );
  return { reply, ahead, log, chase, aheadDays };
}

/** Background agent runs for the spine's right lane: beside the work slot they serve, else from now. */
export function agentBlocks(data: KitData): AgentBlock[] {
  const out: AgentBlock[] = [];
  const slots = data.today.spine.slots;
  for (const c of data.today.nowStack.cards) {
    const m = c.item.effort.agentMin ?? 0;
    if (!m) continue;
    const slot = slots.find((s) => s.workItemId === c.item.id && s.kind !== 'gap');
    const start = slot?.start ?? data.now;
    out.push({ id: `agent_${c.item.id}`, start, end: new Date(T(start) + m * 60_000).toISOString(), label: `Agent ~${dur(m)}`, workItemId: c.item.id });
  }
  return out;
}

/** The agent's day plan as a staged receipt (Today's right pane): one line per planned block. */
export function planReceipt(data: KitData) {
  const { tz } = data;
  const work = data.today.spine.slots.filter((s: SpineSlot) => s.kind !== 'gap');
  const promise = data.today.shelves.promises[0]?.item;
  return Receipt.parse({
    id: 'rcpt_kit_plan',
    at: new Date(T(data.now) - 2 * 60_000).toISOString(),
    actor: 'engine',
    summary: `${work.length} blocks planned around your meetings. Nothing moves until you accept.`,
    staged: true,
    changes: [
      ...work.map((s, i) => ({
        auditId: `aud_kit_plan_${i}`,
        entity: { type: 'work_item', id: s.workItemId ?? s.id, label: stripClock(s.label).replace(/^▶\s*/, '') },
        field: 'planned',
        label: 'Planned',
        before: null,
        after: `${clock(s.start, tz)}–${clock(s.end, tz)}`,
      })),
      ...(promise ? [{ auditId: 'aud_kit_plan_defer', entity: { type: 'work_item', id: promise.id, label: promise.title }, field: 'state', label: 'Deferred', before: 'open', after: 'snoozed' }] : []),
    ],
  });
}

/** Run of day: today's hands-on items in order, with their planned start. */
export function runOfDay(data: KitData): Array<{ item: WorkItem; when: { top: string; bottom?: string }; verb: NbaVerb | null }> {
  const { now, tz } = data;
  const { items } = capacity(data);
  const slotFor = (id: string) => data.today.spine.slots.find((s) => s.workItemId === id && s.kind !== 'gap');
  const verbOf = new Map(data.details.map((d) => [d.item.id, d.nba?.verb ?? null] as const));
  return items
    .map((item) => {
      const slot = slotFor(item.id);
      const start = slot?.start ?? item.startBy ?? item.due!;
      const left = minutesBetween(now, start);
      const bottom = left < 0 ? (item.due ? `due ${dueLabel(item.due, now, tz)}` : 'now') : item.due && !slot ? `due ${dueLabel(item.due, now, tz)}` : `in ${dur(left)}`;
      return { item, start, when: { top: clock(start, tz), bottom }, verb: verbOf.get(item.id) ?? null };
    })
    .sort((a, b) => T(a.start) - T(b.start))
    .map(({ item, when, verb }) => ({ item, when, verb }));
}

/** Work that isn't due today, offered because the day has room. */
export function pullForward(data: KitData): ShelfEntry[] {
  const { now, tz } = data;
  const byId = new Map(data.details.map((d) => [d.item.id, d.item] as const));
  for (const i of data.today.moreToday.items) byId.set(i.id, i);
  // The engine's pick (rank order, empty when the day is full); fall back to not-today rows for old payloads.
  const engine = (data.today.header.capacity.pullForward ?? []).map((p) => byId.get(p.itemId)).filter((i): i is WorkItem => !!i);
  const items = engine.length ? engine : data.today.moreToday.items.filter((i) => !isTodayScoped(i, now, tz) && !CLOSED.has(i.state));
  return items.map((item) => ({ item, hint: item.why, action: { label: 'Pull in', verb: 'start' as const } }));
}
