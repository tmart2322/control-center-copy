/**
 * Kit data: real-shaped view models straight from the mock DataSource (the same code the /api/v1 routes
 * call), so every component renders the contract's payloads. Dev only; no writes.
 */
import type { AgentsPayload, Brief, BriefsPayload, HealthPayload, PersonRef, TimeWeek, TodayPayload, TriagePayload, WorkItem, WorkItemDetail, WorkTab } from '@/contract';
import { getDataSource } from '@/server/datasource';

export interface KitData {
  now: string;
  tz: string;
  today: TodayPayload;
  details: WorkItemDetail[];
  agents: AgentsPayload;
  briefs: BriefsPayload;
  brief: Brief | null;
  health: HealthPayload;
  time: TimeWeek;
  triage: TriagePayload;
  people: PersonRef[];
  opps: Array<{ id: string; label: string }>;
  taskTypes: string[];
}

const TABS: WorkTab[] = ['all_open', 'promises', 'trainings', 'snoozed', 'done'];

export async function loadKitData(): Promise<KitData> {
  const ds = getDataSource();
  const [today, agents, briefs, health, time, triage, settings, ...lists] = await Promise.all([
    ds.getToday({}),
    ds.getAgents({}),
    ds.getBriefs({}),
    ds.getHealth({}),
    ds.getTime({ query: {} }),
    ds.getTriage({}),
    ds.getSettings({}),
    ...TABS.map((tab) => ds.listItems({ query: { tab } })),
  ]);

  const items = new Map<string, WorkItem>();
  for (const l of lists) for (const it of l.items) items.set(it.id, it);
  for (const g of triage.groups) for (const t of g.items) if (t.workItem) items.set(t.workItem.id, t.workItem);
  const details = await Promise.all([...items.keys()].map((id) => ds.getItem({ params: { id } })));

  const firstBrief = briefs.watched[0] ?? briefs.opportunities[0];
  const brief = firstBrief ? await ds.getBrief({ params: { id: firstBrief.id } }) : null;

  const people = new Map<string, PersonRef>();
  for (const d of details) for (const p of [...d.item.people, d.item.counterparty, d.item.owner]) if (p) people.set(p.id, p);
  for (const e of today.spine.events) for (const p of e.attendees) people.set(p.id, p);

  const opps = new Map<string, string>();
  for (const d of details) if (d.item.refs.opp) opps.set(d.item.refs.opp.id, d.item.refs.opp.label);
  for (const a of time.entries) if (a.oppId) opps.set(a.oppId, a.oppName ?? a.oppId);

  const taskTypes = [...new Set(time.entries.map((a) => a.taskType).filter((t): t is string => !!t))].sort();

  return {
    now: today.now,
    tz: settings.profile.timezone,
    today,
    details,
    agents,
    briefs,
    brief,
    health,
    time,
    triage,
    people: [...people.values()],
    opps: [...opps].map(([id, label]) => ({ id, label })),
    taskTypes,
  };
}
