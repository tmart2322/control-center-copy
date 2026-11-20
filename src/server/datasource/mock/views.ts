/**
 * Read models for the mock: pure functions of (store, now). Mutations live in ./index.ts.
 */
import { personaTargetH } from '@/engines/activity/persona';
import { endOfDay, startOfDay } from 'date-fns';
import type {
  AgentRun,
  ConnectorState,
  EntityRef,
  HealthSummary,
  ItemsPayload,
  NowCard,
  OutboxGroup,
  OutboxItem,
  OutboxPayload,
  RailEntry,
  RailLane,
  ShelfEntry,
  SinceDigest,
  SinceEntry,
  TodayPayload,
  TriageItem,
  TriagePayload,
  WorkItem,
  WorkItemRecord,
  WorkTab,
} from '@/contract';
import { adminDraftHref, isAdminDraft } from '@/contract';
import { adminWaitingBySurface, connectorRowsFor, draftHasSurface, featureActive, personaOf, staleFor } from '@/personas';
import { baseCandidates, draftSourceLink, groupBy } from '../draft-source';
import { closedForYouSince, closedWhy, type ClosedEvidence } from '@/engines/home/closed';
import { looksDoneEvidence } from '@/engines/home/looks-done';
import { isStillNeeded, stillNeededWhy } from '@/engines/still-needed';
import { todayCapacity } from '../db/rank';
import { DEFAULT_OBLIGATION_WEIGHT } from '../db/policy-map';
import type { ReadModel } from '../db/model';
import { pendingRerank, storedOrder } from './rank';
import { countsAsLogged } from '@/engines/activity/org62-check';
import type { Store } from './store';
import type { MockAuditLog } from './store';
import { actionApp, actionSummary } from '@/lib/actions';

/** HH:mm in the user's profile timezone (server-rendered labels must not depend on the host tz). */
export function fmtHM(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const LIVE_STATES = new Set(['open', 'in_progress', 'waiting_on_me', 'waiting_on_others', 'likely_done', 'reopened']);

export function isLive(i: WorkItemRecord): boolean {
  return LIVE_STATES.has(i.state);
}

export function hrefFor(ref: { type: string; id: string }): string {
  switch (ref.type) {
    case 'work_item':
      return `/work/${ref.id}`;
    case 'initiative':
      return `/initiatives/${ref.id}`;
    case 'account':
      return `/deals/${ref.id}`;
    case 'opportunity':
      return `/deals?opp=${ref.id}`;
    case 'brief':
      return `/briefs?brief=${ref.id}`;
    case 'agent_run':
      return `/agents?run=${ref.id}`;
    case 'draft':
      return `/outbox?draft=${ref.id}`;
    case 'connector':
      return `/health?connector=${ref.id}`;
    case 'missed_opp':
      return `/deals/missed?id=${ref.id}`;
    default:
      return '/';
  }
}

export function itemRef(i: WorkItemRecord): EntityRef {
  return { type: 'work_item', id: i.id, label: i.title, href: hrefFor({ type: 'work_item', id: i.id }) };
}

export function hydrateItem(store: Store, rec: WorkItemRecord): WorkItem {
  const ini = rec.initiativeId ? store.get('initiatives', rec.initiativeId) : undefined;
  const acc = rec.accountId ? store.get('accounts', rec.accountId) : undefined;
  const opp = rec.oppId ? store.get('opps', rec.oppId) : undefined;
  const ev = rec.servesEventId ? store.get('events', rec.servesEventId) : undefined;
  return {
    ...rec,
    // D-55: a broken source the persona hasn't activated (VDP for an AE) never marks an item stale
    stale: rec.stale ? staleFor(rec.stale, store.all('connectors'), personaOf(store.settings())) : rec.stale,
    refs: {
      initiative: ini ? { type: 'initiative', id: ini.id, label: ini.title, href: hrefFor({ type: 'initiative', id: ini.id }) } : null,
      account: acc ? { type: 'account', id: acc.id, label: acc.name, href: hrefFor({ type: 'account', id: acc.id }) } : null,
      opp: opp ? { type: 'opportunity', id: opp.id, label: opp.name, href: hrefFor({ type: 'opportunity', id: opp.id }) } : null,
      meeting: ev ? { type: 'calendar_event', id: ev.id, label: ev.title, start: ev.start } : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

const STATE_SEVERITY: Record<ConnectorState, number> = { ok: 0, paused: 1, catching_up: 2, degraded: 3, offline: 4, error: 5, auth_needed: 6 };

export function healthSummary(store: Store): HealthSummary {
  // D-55: only the sources active for the persona (Today's Health line, Home's footer)
  const cs = connectorRowsFor(store.all('connectors'), personaOf(store.settings()));
  const worst = cs.reduce<ConnectorState>((w, c) => (STATE_SEVERITY[c.state] > STATE_SEVERITY[w] ? c.state : w), 'ok');
  return {
    ok: cs.filter((c) => c.state === 'ok' || c.state === 'catching_up').length,
    total: cs.length,
    worst,
    broken: cs.filter((c) => STATE_SEVERITY[c.state] >= 3).map((c) => ({ id: c.id, label: c.label, state: c.state })),
  };
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

export function outboxGroupOf(status: string): OutboxGroup | null {
  if (status === 'ready') return 'pending_approval';
  if (status === 'scheduled') return 'scheduled';
  if (['sending', 'sent', 'staged', 'verified', 'verify_failed'].includes(status)) return 'sent';
  if (status === 'failed') return 'failed';
  return null;
}

const OUTBOX_LABEL: Record<OutboxGroup, string> = {
  pending_approval: 'Pending approval',
  scheduled: 'Scheduled',
  sent: 'Sent',
  failed: 'Failed',
};

/** D-75: the applied admin items the payload carries for the assistant (newest first); Activity has the full history. */
const ADMIN_APPLIED_KEEP = 50;

export function buildOutbox(store: Store): OutboxPayload {
  const groups: Record<OutboxGroup, OutboxItem[]> = { pending_approval: [], scheduled: [], sent: [], failed: [] };
  const me = store.meta().user;
  const evidenceOf = groupBy(store.all('evidence'), (e) => e.workItemId);
  // D-52, D-75: admin items (logging and forecast canvases, VDP changes) are Activity's, never the Outbox page's: the
  // ones to act on are `admin.items` (Activity reads them), the applied ones `admin.applied` (the assistant's history).
  // Messages and the feedback post (D-56) are the Outbox's own.
  const admin: OutboxItem[] = [];
  const applied: OutboxItem[] = [];
  // D-55: an inactive feature's items have no daily surface (VDP changes without VDP)
  const persona = personaOf(store.settings());
  for (const d of store.all('drafts').filter((x) => draftHasSurface(x, persona))) {
    const g = outboxGroupOf(d.status);
    if (!g) continue;
    const into = isAdminDraft(d) ? (g === 'pending_approval' || g === 'failed' ? admin : applied) : groups[g];
    const wi = d.workItemId ? store.get('workItems', d.workItemId) : undefined;
    into.push({
      draft: d,
      group: g,
      workItem: wi ? { id: wi.id, title: wi.title } : null,
      source: draftSourceLink({ draft: d, candidates: baseCandidates(d, wi ? (evidenceOf.get(wi.id) ?? []) : [], me), itemSources: wi?.sources ?? [] }),
      // A structured action previews its changes, before → after.
      previewText: d.destination.kind === 'action' ? actionSummary(d.destination) : d.plainText.split('\n').slice(0, 3).join('\n'),
      history: [
        { at: d.createdAt, label: 'Drafted' },
        ...d.attempts.map((a) => ({ at: a.at, label: `${a.dryRun ? 'Dry run' : a.mode === 'send' ? 'Sent' : 'Draft pushed'} · ${a.outcome}` })),
        ...(d.verification?.at ? [{ at: d.verification.at, label: d.verification.detail }] : []),
      ],
    });
  }
  for (const g of Object.keys(groups) as OutboxGroup[]) groups[g].sort((a, b) => b.draft.updatedAt.localeCompare(a.draft.updatedAt));
  return {
    groups: (Object.keys(groups) as OutboxGroup[]).map((g) => ({ group: g, label: OUTBOX_LABEL[g], items: groups[g] })),
    counts: { pending_approval: groups.pending_approval.length, scheduled: groups.scheduled.length, sent: groups.sent.length, failed: groups.failed.length },
    dryRun: store.settings().sending.dryRun,
    admin: {
      items: admin.sort((a, b) => b.draft.updatedAt.localeCompare(a.draft.updatedAt)),
      pending: admin.filter((i) => i.group === 'pending_approval').length,
      failed: admin.filter((i) => i.group === 'failed').length,
      applied: applied.sort((a, b) => b.draft.updatedAt.localeCompare(a.draft.updatedAt)).slice(0, ADMIN_APPLIED_KEEP),
    },
  };
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

/**
 * DEALS-1: an opp is mine when I'm on its team, hold a DC on it, or logged time on it this quarter. Deals counts,
 * pipeline, next close and DC gaps are about my opps; every other opp on the account (REC-2 records them all: 1,098
 * changed in one week on big accounts) stays context on the account page.
 */
export const isMyOpp = (o: { id: string; isMine: boolean; dcAssigned: boolean; hoursQtd: number }, swept: ReadonlySet<string> = new Set()) =>
  o.isMine || o.dcAssigned || o.hoursQtd > 0 || swept.has(o.id);
/** DEALS-1: opps the missed-opp sweep found my logged time on (open findings): mine for the DC-gap counts. */
export const sweptOppIds = (missed: Array<{ oppId: string | null; status: string }>) => new Set(missed.filter((x) => x.oppId && x.status !== 'dismissed').map((x) => x.oppId!));

/** LD-1: the Top 3 without likely-done items, refilled from the rest in order (they stay in the rest). */
export function topWithoutLikelyDone<T extends { id: string; state: string }>(top: T[], rest: T[]): { top: T[]; rest: T[] } {
  if (!top.some((w) => w.state === 'likely_done')) return { top, rest };
  const kept = top.filter((w) => w.state !== 'likely_done');
  const fill = rest.filter((w) => w.state !== 'likely_done').slice(0, Math.max(0, top.length - kept.length));
  const fillIds = new Set(fill.map((w) => w.id));
  return { top: [...kept, ...fill], rest: [...top.filter((w) => w.state === 'likely_done'), ...rest.filter((w) => !fillIds.has(w.id))] };
}

/** Triage's groups in focus order (LD-1: likely-done work first, one click each; SETTLE-1: what closed for you, last). */
export const TRIAGE_ORDER = ['looks_done', 'asks_promises', 'meeting_takeaways', 'missed_opps', 'mappings', 'still_needed', 'closed_for_you'] as const;
export const TRIAGE_LABELS = { looks_done: 'Looks done', asks_promises: 'Asks & promises', meeting_takeaways: 'Meeting takeaways', missed_opps: 'Missed opps', mappings: 'Mappings', still_needed: 'Still needed?', closed_for_you: 'Closed for you' };

/** SETTLE-1: the groups that hold guesses to confirm (`TriagePayload.count`, the nav badge); Closed for you is a record. */
export const triageCount = (items: ReadonlyArray<Pick<TriageItem, 'group'>>) => items.filter((i) => i.group !== 'closed_for_you').length;

/** SETTLE-1: what the Closed for you group needs: the window's start, and item id → the undo audit id of its close. */
export interface ClosedInputs {
  sinceMs: number;
  undoOf: (itemId: string) => string | null;
}

/**
 * SETTLE-1: an engine close as a Triage row, newest first (`createdAt` = when it closed). Its why is the plain reason
 * and how long after the ask; Undo is the close's audit id (null: Reopen instead).
 */
export function closedTriageItem(w: WorkItemRecord, workItem: WorkItem, evidence: ReadonlyArray<ClosedEvidence>, undoAuditId: string | null): TriageItem {
  return { id: w.id, group: 'closed_for_you', kind: 'work_item', title: w.title, why: closedWhy(w, evidence), confidence: w.confidence, sources: w.sources, createdAt: w.doneAt ?? w.updatedAt, workItem, missedOpp: null, mapping: null, undoAuditId };
}

/** A suggestion's Triage group and why (DEEP-1: an old ask waits as "Still needed?", its why says how old). */
export function suggestionGroup(w: Pick<WorkItemRecord, 'kind' | 'state' | 'closedReason' | 'why'>): { group: 'still_needed' | 'meeting_takeaways' | 'asks_promises'; why: string } {
  if (isStillNeeded(w)) return { group: 'still_needed', why: stillNeededWhy(w.closedReason!) };
  return { group: w.kind === 'follow_up' ? 'meeting_takeaways' : 'asks_promises', why: w.why };
}

/** LD-1: a likely-done item as a Triage row: Confirm or Not done, with the evidence line as its why. */
export function looksDoneTriageItem(w: WorkItemRecord, workItem: WorkItem): TriageItem {
  return { id: w.id, group: 'looks_done', kind: 'work_item', title: w.title, why: looksDoneEvidence(workItem), confidence: w.confidence, sources: w.sources, createdAt: w.updatedAt, workItem, missedOpp: null, mapping: null };
}

export function buildTriage(store: Store, closed?: ClosedInputs): TriagePayload {
  const items: TriageItem[] = [];
  for (const w of store.all('workItems')) {
    if (w.state === 'likely_done') {
      items.push(looksDoneTriageItem(w, hydrateItem(store, w)));
      continue;
    }
    if (w.state !== 'suggested') continue;
    const sg = suggestionGroup(w);
    items.push({
      id: w.id,
      group: sg.group,
      kind: 'work_item',
      title: w.title,
      why: sg.why,
      confidence: w.confidence,
      sources: w.sources,
      createdAt: w.createdAt,
      workItem: hydrateItem(store, w),
      missedOpp: null,
      mapping: null,
    });
  }
  // D-55: missed opps (deal contributions) only while the persona has them active
  for (const m of featureActive(personaOf(store.settings()), 'missedOpps') ? store.all('missedOpps') : []) {
    if (m.status !== 'new') continue;
    items.push({
      id: m.id,
      group: 'missed_opps',
      kind: 'missed_opp',
      title: `${m.verdict === 'claim' ? 'Claim' : 'Check'}: ${m.oppName}`,
      why: m.evidence[0] ?? 'Possible missed opportunity',
      confidence: m.verdict === 'claim' ? 'likely' : 'guess',
      sources: [{ kind: 'org62', label: `Org62 · ${m.accountName}` }],
      createdAt: m.foundAt,
      workItem: null,
      missedOpp: m,
      mapping: null,
    });
  }
  for (const q of store.all('mappings')) {
    if (q.status !== 'open') continue;
    items.push({
      id: q.id,
      group: 'mappings',
      kind: 'mapping',
      title: q.question,
      why: `About ${q.subject.label}`,
      confidence: 'guess',
      sources: [q.source],
      createdAt: q.createdAt,
      workItem: null,
      missedOpp: null,
      mapping: q,
    });
  }
  if (closed) {
    const evidence = store.all('evidence');
    for (const w of closedForYouSince(store.all('workItems'), closed.sinceMs)) items.push(closedTriageItem(w, hydrateItem(store, w), evidence, closed.undoOf(w.id)));
  }
  return {
    groups: TRIAGE_ORDER.map((g) => ({ group: g, label: TRIAGE_LABELS[g], items: items.filter((i) => i.group === g).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) })),
    count: triageCount(items),
  };
}

// ---------------------------------------------------------------------------
// Work lists
// ---------------------------------------------------------------------------

export function tabMatch(tab: WorkTab, i: WorkItemRecord): boolean {
  switch (tab) {
    case 'all_open':
      return isLive(i);
    case 'said_by_me':
      return isLive(i) && i.kind === 'commitment';
    case 'asked_of_me':
      return isLive(i) && i.kind === 'ask';
    case 'promises':
      return isLive(i) && i.kind === 'commitment' && i.isBackground;
    case 'trainings':
      return isLive(i) && i.kind === 'training';
    case 'snoozed':
      return i.state === 'snoozed';
    case 'done':
      return i.state === 'done';
  }
}

const TABS: WorkTab[] = ['all_open', 'said_by_me', 'asked_of_me', 'promises', 'trainings', 'snoozed', 'done'];

export function buildItems(store: Store, q: { tab: WorkTab; account?: string; opp?: string; initiative?: string; source?: string; kind?: string; q?: string }): ItemsPayload {
  const all = store.all('workItems');
  const filtered = all.filter((i) => {
    if (q.account && i.accountId !== q.account) return false;
    if (q.opp && i.oppId !== q.opp) return false;
    if (q.initiative && i.initiativeId !== q.initiative) return false;
    if (q.source && !i.sources.some((s) => s.kind === q.source)) return false;
    if (q.kind && i.kind !== q.kind) return false;
    if (q.q && !`${i.title} ${i.purpose ?? ''} ${i.why}`.toLowerCase().includes(q.q.toLowerCase())) return false;
    return true;
  });
  const counts = Object.fromEntries(TABS.map((t) => [t, filtered.filter((i) => tabMatch(t, i)).length])) as Record<WorkTab, number>;
  const items = filtered
    .filter((i) => tabMatch(q.tab, i))
    .sort((a, b) => {
      if (q.tab === 'done') return (b.doneAt ?? '').localeCompare(a.doneAt ?? '');
      if (q.tab === 'promises') return b.ageDays - a.ageDays;
      const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
      const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
      return ra - rb || (a.due ?? '9').localeCompare(b.due ?? '9') || a.id.localeCompare(b.id);
    })
    .map((i) => hydrateItem(store, i));
  return { tab: q.tab, items, counts, total: items.length };
}

// ---------------------------------------------------------------------------
// Since you left
// ---------------------------------------------------------------------------

export function buildSince(store: Store, audit: MockAuditLog, sinceIso: string, now: Date): SinceDigest {
  const sinceMs = Date.parse(sinceIso);
  const entries: SinceEntry[] = [];
  for (const e of audit.entries) {
    if (Date.parse(e.at) <= sinceMs || e.actor === 'user' || e.undoneAt) continue;
    const kind: SinceEntry['kind'] = e.action.includes('close')
      ? 'closed'
      : e.action.includes('reopen')
        ? 'reopened'
        : e.action.includes('create') || e.action.includes('capture')
          ? 'new'
          : e.action.includes('fail')
            ? 'failed'
            : e.action.includes('waiting')
              ? 'waiting'
              : e.action.startsWith('brief')
                ? 'brief'
                : 'changed';
    entries.push({ at: e.at, kind, title: e.summary, detail: e.entity.label, ref: e.entity, auditId: e.undoable ? e.id : null });
  }
  for (const w of store.all('workItems')) {
    if (Date.parse(w.createdAt) > sinceMs && Date.parse(w.createdAt) <= now.getTime() && !entries.some((x) => x.ref.id === w.id && x.kind === 'new')) {
      entries.push({ at: w.createdAt, kind: 'new', title: `New: ${w.title}`, detail: w.why, ref: itemRef(w), auditId: null });
    }
  }
  entries.sort((a, b) => b.at.localeCompare(a.at));
  const awayMinutes = Math.max(0, Math.round((now.getTime() - sinceMs) / 60_000));
  return {
    since: new Date(sinceMs).toISOString(),
    until: now.toISOString(),
    awayMinutes,
    show: awayMinutes >= 120,
    counts: {
      changed: entries.filter((e) => e.kind === 'changed').length,
      closed: entries.filter((e) => e.kind === 'closed').length,
      new: entries.filter((e) => e.kind === 'new').length,
      reopened: entries.filter((e) => e.kind === 'reopened').length,
    },
    entries,
  };
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

function minutesBetween(a: string | Date, b: string | Date): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);
}

function runForItem(store: Store, item: WorkItemRecord): AgentRun | null {
  const runs = item.runIds.map((id) => store.get('agentRuns', id)).filter((r): r is AgentRun => !!r);
  const order = ['waiting_on_you', 'running', 'failed', 'done_review', 'queued', 'stale', 'done'];
  runs.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  return runs[0] ?? null;
}

export function nowCardFor(store: Store, rec: WorkItemRecord): NowCard {
  const nba = rec.nbaId ? store.get('nbas', rec.nbaId) ?? null : null;
  const draft = nba?.draftId ? store.get('drafts', nba.draftId) ?? null : null;
  const proposals = store
    .all('proposals')
    .filter((p) => p.status === 'pending' && ((p.entity.type === 'work_item' && p.entity.id === rec.id) || (draft && p.entity.type === 'draft' && p.entity.id === draft.id)));
  return { item: hydrateItem(store, rec), nba, draft, run: runForItem(store, rec), proposals };
}

/**
 * The engine's capacity over the mock store (DESIGN-V2: today-scoped, hands-on only), computed exactly as
 * the db DataSource computes it. The store is read through the read-model surface the engine inputs use.
 */
export function mockCapacity(store: Store, now: Date): TodayPayload['header']['capacity'] {
  const model = {
    all: (col: string) => store.all(col as never),
    get: (col: string, id: string) => store.get(col as never, id),
    settings: () => store.settings(),
    extra: { policyRowId: null, policyEngine: { obligation: DEFAULT_OBLIGATION_WEIGHT, top3Size: 3 } },
  } as unknown as ReadModel;
  return todayCapacity(model, now);
}

export function buildToday(store: Store, audit: MockAuditLog, now: Date): TodayPayload {
  const meta = store.meta();
  const settings = store.settings();
  const policy = settings.policy;
  const nowIso = now.toISOString();
  const dayStart = startOfDay(now).getTime();
  const dayEnd = endOfDay(now).getTime();

  // ---- spine
  const events = store
    .all('events')
    .filter((e) => Date.parse(e.start) >= dayStart && Date.parse(e.start) <= dayEnd)
    .sort((a, b) => a.start.localeCompare(b.start));
  const slots = store
    .all('slots')
    .filter((s) => Date.parse(s.start) >= dayStart && Date.parse(s.start) <= dayEnd)
    .sort((a, b) => a.start.localeCompare(b.start));

  // ---- ranking / NOW
  const ordered = storedOrder(store);
  // LD-1: a likely-done item never takes a NOW slot (it waits for Confirm in Home's and Triage's Looks done group).
  let top = ordered.filter((i) => i.state !== 'likely_done').slice(0, 3);
  // A waiting run feeding a meeting within 3 h is promoted into NOW (UI-SPEC §4.3).
  const promote = ordered.filter((i) => !top.includes(i)).find((i) => {
    if (i.state !== 'waiting_on_me' || !i.servesEventId) return false;
    const ev = store.get('events', i.servesEventId);
    return ev ? (Date.parse(ev.start) - now.getTime()) / 3_600_000 <= 3 && Date.parse(ev.start) > now.getTime() : false;
  });
  if (promote && top.length === 3) top = [top[0], top[1], promote];
  const topIds = new Set(top.map((i) => i.id));
  const cards = top.map((i) => nowCardFor(store, i));
  const restRanked = ordered.filter((i) => !topIds.has(i.id));
  const moreTodayItems = restRanked.slice(0, 12);

  // ---- shelves
  const gaps = slots.filter((s) => s.kind === 'gap' && Date.parse(s.end) > now.getTime());
  const listed = new Set([...topIds, ...moreTodayItems.map((i) => i.id)]);
  const tz = settings.profile.timezone;
  const fitIns: ShelfEntry[] = store
    .all('workItems')
    .filter((i) => isLive(i) && !listed.has(i.id) && !i.isBackground && (i.kind === 'training' || (i.effort.youMin <= 30 && i.priority === 'high')))
    .sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9'))
    .map((i) => {
      const gap = gaps.find((g) => minutesBetween(g.start, g.end) >= i.effort.youMin);
      const hint = gap ? `fits your ${fmtHM(gap.start, tz)} gap` : i.training?.overdue ? 'overdue' : `${i.effort.youMin}m`;
      return { item: hydrateItem(store, i), hint, action: { label: 'Start', verb: 'start' as const } };
    });
  const promises: ShelfEntry[] = store
    .all('workItems')
    .filter((i) => isLive(i) && i.isBackground)
    .sort((a, b) => b.ageDays - a.ageDays)
    .map((i) => ({ item: hydrateItem(store, i), hint: `promised ${i.ageDays}d ago`, action: { label: 'Kick off', verb: 'kick_off' as const } }));

  // ---- header
  const upcoming = events.filter((e) => Date.parse(e.start) > now.getTime() && e.attendance === 'upcoming');
  const next = upcoming[0];
  const activity = store.all('activity');
  // TL-45: the one status → count map (the db's quarterTotal reads it too)
  const loggedThisWeek = activity.filter(countsAsLogged).reduce((s, a) => s + a.durationH, 0);
  const loggedH = Math.round((meta.quarter.loggedH + loggedThisWeek) * 100) / 100;
  // D-55: only the persona's active sources show as catching up
  const catching = connectorRowsFor(store.all('connectors'), personaOf(store.settings())).filter((c) => c.state === 'catching_up');

  // ---- rail
  const rail: RailLane[] = [];
  const since = buildSince(store, audit, meta.lastActiveAt, now);
  rail.push({
    lane: 'since_you_left',
    label: 'SINCE YOU LEFT',
    count: since.entries.length,
    summary: `${since.counts.changed} changed · ${since.counts.closed} closed · ${since.counts.new} new`,
    entries: since.entries.slice(0, 2).map((e, i) => ({ id: `since-${i}`, ref: e.ref, title: e.title, detail: e.detail, at: e.at, tone: 'neutral', action: null, evidence: null })),
    href: '/?sheet=since',
    visible: since.show,
  });

  const waitingRuns = store.all('agentRuns').filter((r) => r.state === 'waiting_on_you');
  const pendingDrafts = store.all('drafts').filter((d) => d.status === 'ready' && draftHasSurface(d, personaOf(store.settings())));
  const waitingEntries: RailEntry[] = [
    ...waitingRuns.map((r) => ({
      id: r.id,
      ref: { type: 'agent_run' as const, id: r.id, label: r.title, href: hrefFor({ type: 'agent_run', id: r.id }) },
      title: r.title,
      detail: r.waiting?.question ?? r.waiting?.reason ?? r.lastEvent,
      at: r.waiting?.since ?? r.updatedAt,
      tone: 'warn' as const,
      action:
        r.kind === 'claude_session'
          ? { kind: 'open_in_claude' as const, label: 'Open in Claude', href: r.deepLink, auditId: null, choices: [] }
          : { kind: 'answer' as const, label: 'Answer', href: null, auditId: null, choices: r.waiting?.choices ?? [] },
      evidence: null,
    })),
    ...pendingDrafts.map((d) => ({
      id: d.id,
      ref: { type: 'draft' as const, id: d.id, label: d.plainText.slice(0, 60), href: isAdminDraft(d) ? adminDraftHref(d) : hrefFor({ type: 'draft', id: d.id }) },
      title: `${isAdminDraft(d) ? 'Apply' : 'Approve'}: ${d.destination.kind === 'slack' ? d.destination.channelName : d.destination.kind === 'action' ? `${actionApp(d.destination.action)} · ${d.destination.target.label}` : d.destination.subject}`,
      detail: d.plainText.split('\n')[0] ?? null,
      at: d.updatedAt,
      tone: 'brand' as const,
      action: { kind: 'approve' as const, label: 'Review', href: isAdminDraft(d) ? adminDraftHref(d) : hrefFor({ type: 'draft', id: d.id }), auditId: null, choices: [] },
      evidence: null,
    })),
  ];
  rail.push({
    lane: 'waiting_on_you',
    label: 'WAITING ON YOU',
    count: waitingEntries.length,
    summary: `${plural(waitingRuns.length, 'session')} · ${plural(pendingDrafts.length, 'approval')}`,
    entries: waitingEntries,
    href: '/agents?state=waiting_on_you',
    visible: true,
  });

  const runs = store.all('agentRuns');
  const running = runs.filter((r) => r.state === 'running');
  const review = runs.filter((r) => r.state === 'done_review');
  const latest = [...running, ...review].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  rail.push({
    lane: 'agents',
    label: 'AGENTS',
    count: running.length + review.length,
    summary: `${running.length} running · ${review.length} to review`,
    entries: latest.slice(0, 2).map((r) => ({
      id: r.id,
      ref: { type: 'agent_run', id: r.id, label: r.title, href: hrefFor({ type: 'agent_run', id: r.id }) },
      title: r.title,
      detail: r.lastEvent,
      at: r.updatedAt,
      tone: r.state === 'running' ? 'brand' : 'ai',
      action: r.state === 'done_review' ? { kind: 'review', label: 'Review', href: hrefFor({ type: 'agent_run', id: r.id }), auditId: null, choices: [] } : null,
      evidence: null,
    })),
    href: '/agents',
    visible: true,
  });

  const waitingOthers = store
    .all('workItems')
    .filter((i) => i.state === 'waiting_on_others')
    .sort((a, b) => (a.waiting?.since ?? a.updatedAt).localeCompare(b.waiting?.since ?? b.updatedAt));
  rail.push({
    lane: 'waiting_on_others',
    label: 'WAITING ON OTHERS',
    count: waitingOthers.length,
    summary: waitingOthers[0] ? `oldest: ${waitingOthers[0].title} · ${Math.max(0, Math.round((now.getTime() - Date.parse(waitingOthers[0].waiting?.since ?? waitingOthers[0].updatedAt)) / 86_400_000))}d` : 'nothing pending',
    entries: waitingOthers.slice(0, 2).map((i) => ({
      id: i.id,
      ref: itemRef(i),
      title: i.title,
      detail: i.waiting?.reason ?? null,
      at: i.waiting?.since ?? null,
      tone: 'neutral',
      action: { kind: 'nudge', label: 'Nudge', href: null, auditId: null, choices: [] },
      evidence: null,
    })),
    href: '/work?tab=all_open&state=waiting_on_others',
    visible: true,
  });

  const closed = store
    .all('workItems')
    .filter((i) => i.state === 'done' && i.doneBy === 'engine' && i.doneAt && Date.parse(i.doneAt) >= Date.parse(meta.lastActiveAt) - 12 * 3_600_000)
    .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  rail.push({
    lane: 'closed_for_you',
    label: 'CLOSED FOR YOU',
    count: closed.length,
    summary: `${closed.length} closed · undo z`,
    entries: closed.map((i) => {
      const entry = [...audit.entries].reverse().find((e) => e.entity.id === i.id && e.action === 'item.close' && !e.undoneAt);
      const ev = store.all('evidence').find((e) => e.workItemId === i.id && e.role === 'completion');
      return {
        id: i.id,
        ref: itemRef(i),
        title: i.title,
        detail: i.closedReason,
        at: i.doneAt,
        tone: 'ok' as const,
        action: entry ? { kind: 'undo' as const, label: 'Undo', href: null, auditId: entry.id, choices: [] } : null,
        evidence: ev?.source ?? null,
      };
    }),
    href: '/work?tab=done',
    visible: true,
  });

  const health = healthSummary(store);
  const brokenConn = store.all('connectors').filter((c) => health.broken.some((b) => b.id === c.id));
  rail.push({
    lane: 'health',
    label: 'HEALTH',
    count: health.broken.length,
    summary: health.broken.length ? `${health.broken.map((b) => b.label).join(', ')} needs attention` : `● ${health.ok}/${health.total}`,
    entries: brokenConn.map((c) => ({
      id: c.id,
      ref: { type: 'connector', id: c.id, label: c.label, href: hrefFor({ type: 'connector', id: c.id }) },
      title: `${c.label}: ${c.state.replace('_', ' ')}`,
      detail: c.impact ?? c.lastError?.message ?? null,
      at: c.since,
      tone: c.state === 'auth_needed' || c.state === 'error' ? 'risk' : 'warn',
      action: c.reauth ? { kind: 'reauth', label: c.reauth.label, href: null, auditId: null, choices: [] } : null,
      evidence: null,
    })),
    href: '/health',
    visible: true,
  });

  const briefs = store.all('briefs');
  const unreadBriefs = briefs.filter((b) => b.unread);
  const worth = briefs.reduce((s, b) => s + b.highlights.filter((h) => h.status === 'new' || h.status === 'seen').length, 0);
  rail.push({
    lane: 'briefs',
    label: 'BRIEFS',
    count: unreadBriefs.length,
    summary: `${unreadBriefs.length} new · ${worth} worth a look`,
    entries: unreadBriefs.slice(0, 2).map((b) => ({
      id: b.id,
      ref: { type: 'brief', id: b.id, label: b.title, href: hrefFor({ type: 'brief', id: b.id }) },
      title: b.title,
      detail: `${b.highlights.length} highlights`,
      at: b.through,
      tone: 'neutral',
      action: { kind: 'open', label: 'Read', href: hrefFor({ type: 'brief', id: b.id }), auditId: null, choices: [] },
      evidence: null,
    })),
    href: '/briefs',
    visible: true,
  });

  const triage = buildTriage(store);
  const spend = store.spend();
  const pulseConn = store.all('connectors').find((c) => c.id === 'slack') ?? store.all('connectors')[0];
  const deadline = meta.quarter;
  const rerankAt = new Date(meta.rankedAt);

  return {
    now: nowIso,
    header: {
      date: nowIso,
      nextMeeting: next ? { eventId: next.id, title: next.title, start: next.start, minutesUntil: Math.max(0, minutesBetween(now, next.start)) } : null,
      capacity: mockCapacity(store, now),
      nearestDeadline: { label: `${deadline.label} log`, due: deadline.due, progress: { done: loggedH, total: personaTargetH(personaOf(store.settings()), deadline.targetH), label: 'h' } },
      catchUp: catching.length ? { sources: catching.map((c) => ({ connectorId: c.id, label: c.label, pct: c.catchUpPct, done: false })) } : null,
    },
    spine: {
      events,
      slots,
      later: { fitIns: fitIns.length, promises: promises.length },
    },
    nowStack: {
      rankedAt: meta.rankedAt,
      rerankReady: pendingRerank(store, policy, rerankAt),
      cards,
    },
    moreToday: { count: restRanked.length, items: moreTodayItems.map((i) => hydrateItem(store, i)) },
    triageCount: triage.count,
    shelves: { fitIns: fitIns.slice(0, 2), promises: promises.slice(0, 2) },
    rail,
    rankMeta: { policyVersion: policy.version, policyName: policy.name, rankedAt: meta.rankedAt },
    health,
    spend: { today: spend.today, state: spend.state },
    dryRun: settings.sending.dryRun,
    navCounts: {
      triage: triage.count,
      agentsWaiting: waitingRuns.length,
      outbox: store.all('drafts').filter((d) => (d.status === 'ready' || d.status === 'failed') && !isAdminDraft(d)).length,
      // the items Time shows (D-52): logging canvases, forecast canvases and VDP changes while the persona has them
      adminWaiting: adminWaitingBySurface(store.all('drafts'), personaOf(store.settings())).total,
      // D-60: by the tab that holds them, so the badge lands where its items are
      adminBySurface: (({ log, forecast, vdp }) => ({ log, forecast, vdp }))(adminWaitingBySurface(store.all('drafts'), personaOf(store.settings()))),
      briefsUnread: unreadBriefs.length,
      // D-59: getToday fills it from the VDP coverage summary
      vdpOpen: 0,
      // 2026-11-13 audit C2, C8: getToday fills them (DC requests and use cases waiting for a canvas; staged Assistant cards)
      waitingForCanvas: { dcs: 0, useCases: 0 },
      assistantPending: 0,
    },
    scannerPulse: pulseConn
      ? { label: pulseConn.state === 'catching_up' ? `Catching up · ${pulseConn.catchUpPct ?? 0}%` : `Live · ${Math.max(0, Math.round((now.getTime() - Date.parse(pulseConn.lastSuccessAt ?? nowIso)) / 1000))}s`, state: pulseConn.state }
      : { label: 'Idle', state: 'ok' },
  };
}

export function windowOrToday(now: Date, from?: string, to?: string): { from: Date; to: Date } {
  return { from: from ? new Date(from) : startOfDay(now), to: to ? new Date(to) : endOfDay(now) };
}
