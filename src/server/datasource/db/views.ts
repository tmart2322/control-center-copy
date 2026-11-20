/**
 * Page compositions for the db DataSource: pure functions of (read model, SQL-selected inputs, now).
 *
 * The presentation rules (labels, lane summaries, shelf hints) follow the mock (src/server/datasource/mock/
 * views.ts) so both data sources render the same page from the same data. What SQL decides is passed in:
 * the ranked order (Q1), "closed for you" undo targets (Q6), triage's suggested items (Q9), and the
 * since-you-left audit entries (change_sets).
 */
import { personaTargetH } from '@/engines/activity/persona';
import { endOfDay, startOfDay } from 'date-fns';

import type {
  AgentRun,
  ConnectorState,
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

import { closedTriageItem, fmtHM, hrefFor, isLive, itemRef, looksDoneTriageItem, outboxGroupOf, suggestionGroup, tabMatch, triageCount, TRIAGE_LABELS, TRIAGE_ORDER, type ClosedInputs } from '../mock/views';
import { closedForYouSince } from '@/engines/home/closed';
export { isMyOpp, sweptOppIds, topWithoutLikelyDone } from '../mock/views';
import type { SinceSource } from './audit';
import type { ReadModel } from './model';
import { quarterTotal } from './quarter';
import { todayCapacity, type TodayRank } from './rank';
import { actionApp, actionSummary } from '@/lib/actions';

export { fmtHM, hrefFor, isLive, itemRef };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function hydrateItem(m: ReadModel, rec: WorkItemRecord): WorkItem {
  const ini = rec.initiativeId ? m.get('initiatives', rec.initiativeId) : undefined;
  const acc = rec.accountId ? m.get('accounts', rec.accountId) : undefined;
  const opp = rec.oppId ? m.get('opps', rec.oppId) : undefined;
  const ev = rec.servesEventId ? m.get('events', rec.servesEventId) : undefined;
  return {
    ...rec,
    // D-55: a broken source the persona hasn't activated (VDP for an AE) never marks an item stale
    stale: rec.stale ? staleFor(rec.stale, m.all('connectors'), personaOf(m.settings())) : rec.stale,
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

export function healthSummary(m: ReadModel): HealthSummary {
  // D-55: only the sources active for the persona (Today's Health line, Home's footer)
  const cs = connectorRowsFor(m.all('connectors'), personaOf(m.settings()));
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

const OUTBOX_LABEL: Record<OutboxGroup, string> = { pending_approval: 'Pending approval', scheduled: 'Scheduled', sent: 'Sent', failed: 'Failed' };

/** D-75: the applied admin items the payload carries for the assistant (newest first); Activity has the full history. */
const ADMIN_APPLIED_KEEP = 50;

export function buildOutbox(m: ReadModel): OutboxPayload {
  const groups: Record<OutboxGroup, OutboxItem[]> = { pending_approval: [], scheduled: [], sent: [], failed: [] };
  const evidenceOf = groupBy(m.all('evidence'), (e) => e.workItemId);
  // D-52, D-75: admin items (logging and forecast canvases, VDP changes) are Activity's, never the Outbox page's: the
  // ones to act on are `admin.items` (Activity reads them), the applied ones `admin.applied` (the assistant's history).
  // Messages and the feedback post (D-56) are the Outbox's own.
  const admin: OutboxItem[] = [];
  const applied: OutboxItem[] = [];
  // D-55: an inactive feature's items have no daily surface (VDP changes without VDP)
  const persona = personaOf(m.settings());
  for (const d of m.all('drafts').filter((x) => draftHasSurface(x, persona))) {
    const g = outboxGroupOf(d.status);
    if (!g) continue;
    const into = isAdminDraft(d) ? (g === 'pending_approval' || g === 'failed' ? admin : applied) : groups[g];
    const wi = d.workItemId ? m.get('workItems', d.workItemId) : undefined;
    into.push({
      draft: d,
      group: g,
      workItem: wi ? { id: wi.id, title: wi.title } : null,
      // the row's "Open in Slack / Gmail" from what the model has (thread context, evidence); the panel reads the thread
      source: draftSourceLink({ draft: d, candidates: baseCandidates(d, wi ? (evidenceOf.get(wi.id) ?? []) : [], m.ctx.me), itemSources: wi?.sources ?? [] }),
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
    dryRun: m.settings().sending.dryRun,
    admin: {
      items: admin.sort((a, b) => b.draft.updatedAt.localeCompare(a.draft.updatedAt)),
      pending: admin.filter((i) => i.group === 'pending_approval').length,
      failed: admin.filter((i) => i.group === 'failed').length,
      applied: applied.sort((a, b) => b.draft.updatedAt.localeCompare(a.draft.updatedAt)).slice(0, ADMIN_APPLIED_KEEP),
    },
  };
}

// ---------------------------------------------------------------------------
// Triage (every suggested item; missed opps and mapping questions join them)
// ---------------------------------------------------------------------------

export function buildTriage(m: ReadModel, suggestedIds?: string[], closed?: ClosedInputs): TriagePayload {
  const items: TriageItem[] = [];
  const suggested = suggestedIds ? suggestedIds.map((id) => m.get('workItems', id)).filter((w): w is WorkItemRecord => !!w && w.state === 'suggested') : m.all('workItems').filter((w) => w.state === 'suggested');
  for (const w of suggested) {
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
      workItem: hydrateItem(m, w),
      missedOpp: null,
      mapping: null,
    });
  }
  for (const w of m.all('workItems')) if (w.state === 'likely_done') items.push(looksDoneTriageItem(w, hydrateItem(m, w)));
  // D-55: missed opps (deal contributions) only while the persona has them active
  for (const mo of featureActive(personaOf(m.settings()), 'missedOpps') ? m.all('missedOpps') : []) {
    if (mo.status !== 'new') continue;
    const oppUrl = mo.oppId ? m.get('opps', mo.oppId)?.org62Url : null;
    items.push({
      id: mo.id,
      group: 'missed_opps',
      kind: 'missed_opp',
      title: `${mo.verdict === 'claim' ? 'Claim' : 'Check'}: ${mo.oppName}`,
      why: mo.evidence[0] ?? 'Possible missed opportunity',
      confidence: mo.verdict === 'claim' ? 'likely' : 'guess',
      sources: [{ kind: 'org62', label: `Org62 · ${mo.accountName}`, ...(oppUrl ? { url: oppUrl } : {}) }],
      createdAt: mo.foundAt,
      workItem: null,
      missedOpp: mo,
      mapping: null,
    });
  }
  for (const q of m.all('mappings')) {
    if (q.status !== 'open') continue;
    items.push({ id: q.id, group: 'mappings', kind: 'mapping', title: q.question, why: `About ${q.subject.label}`, confidence: 'guess', sources: [q.source], createdAt: q.createdAt, workItem: null, missedOpp: null, mapping: q });
  }
  // SETTLE-1: what closed for you in the window (a record, never counted)
  if (closed) {
    const evidence = m.all('evidence');
    for (const w of closedForYouSince(m.all('workItems'), closed.sinceMs)) items.push(closedTriageItem(w, hydrateItem(m, w), evidence, closed.undoOf(w.id)));
  }
  return {
    groups: TRIAGE_ORDER.map((g) => ({ group: g, label: TRIAGE_LABELS[g], items: items.filter((i) => i.group === g).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) })),
    count: triageCount(items),
  };
}

// ---------------------------------------------------------------------------
// Work lists (the SQL side filters; this orders and counts per tab)
// ---------------------------------------------------------------------------

const TABS: WorkTab[] = ['all_open', 'said_by_me', 'asked_of_me', 'promises', 'trainings', 'snoozed', 'done'];

export function buildItems(m: ReadModel, filtered: WorkItemRecord[], tab: WorkTab): ItemsPayload {
  const counts = Object.fromEntries(TABS.map((t) => [t, filtered.filter((i) => tabMatch(t, i)).length])) as Record<WorkTab, number>;
  const items = filtered
    .filter((i) => tabMatch(tab, i))
    .sort((a, b) => {
      if (tab === 'done') return (b.doneAt ?? '').localeCompare(a.doneAt ?? '');
      if (tab === 'promises') return b.ageDays - a.ageDays;
      const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
      const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
      return ra - rb || (a.due ?? '9').localeCompare(b.due ?? '9') || a.id.localeCompare(b.id);
    })
    .map((i) => hydrateItem(m, i));
  return { tab, items, counts, total: items.length };
}

// ---------------------------------------------------------------------------
// Since you left
// ---------------------------------------------------------------------------

export function buildSince(m: ReadModel, entriesAfter: readonly SinceSource[], sinceIso: string, now: Date): SinceDigest {
  const sinceMs = Date.parse(sinceIso);
  const entries: SinceEntry[] = [];
  for (const e of entriesAfter) {
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
  const isNew = new Set(entries.filter((x) => x.kind === 'new').map((x) => x.ref.id));
  for (const w of m.all('workItems')) {
    if (Date.parse(w.createdAt) > sinceMs && Date.parse(w.createdAt) <= now.getTime() && !isNew.has(w.id)) {
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

function runForItem(m: ReadModel, item: WorkItemRecord): AgentRun | null {
  const runs = item.runIds.map((id) => m.get('agentRuns', id)).filter((r): r is AgentRun => !!r);
  const order = ['waiting_on_you', 'running', 'failed', 'done_review', 'queued', 'stale', 'done'];
  runs.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  return runs[0] ?? null;
}

export function nowCardFor(m: ReadModel, rec: WorkItemRecord): NowCard {
  const nba = rec.nbaId ? (m.get('nbas', rec.nbaId) ?? null) : null;
  const draft = nba?.draftId ? (m.get('drafts', nba.draftId) ?? null) : null;
  const proposals = m
    .all('proposals')
    .filter((p) => p.status === 'pending' && ((p.entity.type === 'work_item' && p.entity.id === rec.id) || (draft && p.entity.type === 'draft' && p.entity.id === draft.id)));
  return { item: hydrateItem(m, rec), nba, draft, run: runForItem(m, rec), proposals };
}

export interface TodayInputs {
  /** The NOW stack and the rest of the stored order (Q1 ranked lanes + unranked rankable items), from DbRanker.today. */
  top: WorkItemRecord[];
  rest: WorkItemRecord[];
  /** ENGINES-core plan: spine slots, capacity and shelves (else the seeded slots and the mock's shelf rules). */
  plan?: TodayRank['plan'];
  /** work item id → undo change set of its latest engine close (Q6). */
  closeUndo: Map<string, string>;
  since: SinceDigest;
  rerankReady: number;
  triageCount: number;
}

export function buildToday(m: ReadModel, inp: TodayInputs, now: Date): TodayPayload {
  const meta = m.meta();
  const settings = m.settings();
  const policy = settings.policy;
  const nowIso = now.toISOString();
  const dayStart = startOfDay(now).getTime();
  const dayEnd = endOfDay(now).getTime();

  const events = m
    .all('events')
    .filter((e) => Date.parse(e.start) >= dayStart && Date.parse(e.start) <= dayEnd)
    .sort((a, b) => a.start.localeCompare(b.start));
  const plan = inp.plan;
  const seededSlots = m
    .all('slots')
    .filter((s) => Date.parse(s.start) >= dayStart && Date.parse(s.start) <= dayEnd)
    .sort((a, b) => a.start.localeCompare(b.start));
  const slots = plan ? plan.slots : seededSlots;

  const top = inp.top;
  const topIds = new Set(top.map((i) => i.id));
  const cards = top.map((i) => nowCardFor(m, i));
  const restRanked = inp.rest;
  const moreTodayItems = restRanked.slice(0, 12);

  const gaps = slots.filter((s) => s.kind === 'gap' && Date.parse(s.end) > now.getTime());
  const listed = new Set([...topIds, ...moreTodayItems.map((i) => i.id)]);
  const tz = settings.profile.timezone;
  const planned = (xs: { id: string; hint: string }[], action: (x: { id: string; hint: string }) => ShelfEntry['action']): ShelfEntry[] =>
    xs.flatMap((x) => {
      const w = m.get('workItems', x.id);
      return w ? [{ item: hydrateItem(m, w), hint: x.hint, action: action(x) }] : [];
    });
  const fitIns: ShelfEntry[] = plan
    ? planned(plan.fitIns, () => ({ label: 'Start', verb: 'start' }))
    : m
    .all('workItems')
    .filter((i) => isLive(i) && !listed.has(i.id) && !i.isBackground && (i.kind === 'training' || (i.effort.youMin <= 30 && i.priority === 'high')))
    .sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9'))
    .map((i) => {
      const gap = gaps.find((g) => minutesBetween(g.start, g.end) >= i.effort.youMin);
      const hint = gap ? `fits your ${fmtHM(gap.start, tz)} gap` : i.training?.overdue ? 'overdue' : `${i.effort.youMin}m`;
      return { item: hydrateItem(m, i), hint, action: { label: 'Start', verb: 'start' as const } };
    });
  const promises: ShelfEntry[] = plan
    ? planned(plan.promises, (x) => ((x as { verb?: string }).verb === 'renegotiate' ? { label: 'Renegotiate', verb: 'renegotiate' } : { label: 'Kick off', verb: 'kick_off' }))
    : m
    .all('workItems')
    .filter((i) => isLive(i) && i.isBackground)
    .sort((a, b) => b.ageDays - a.ageDays)
    .map((i) => ({ item: hydrateItem(m, i), hint: `promised ${i.ageDays}d ago`, action: { label: 'Kick off', verb: 'kick_off' as const } }));

  // tentative / unanswered invites show on the spine but are not "your next meeting" (they never block time)
  const upcoming = events.filter((e) => Date.parse(e.start) > now.getTime() && e.attendance === 'upcoming' && e.myResponse !== 'tentative' && e.myResponse !== 'needs_action');
  const next = upcoming[0];
  const activity = m.all('activity');
  // this fiscal quarter's logged rows only (projections keep every quarter's rows for past weeks and History)
  const { q: quarter, loggedH } = quarterTotal(meta, activity, now, tz, settings.profile.workingHours.end);
  // D-55: only the persona's active sources show as catching up
  const catching = connectorRowsFor(m.all('connectors'), personaOf(m.settings())).filter((c) => c.state === 'catching_up');

  const rail: RailLane[] = [];
  const since = inp.since;
  rail.push({
    lane: 'since_you_left',
    label: 'SINCE YOU LEFT',
    count: since.entries.length,
    summary: `${since.counts.changed} changed · ${since.counts.closed} closed · ${since.counts.new} new`,
    entries: since.entries.slice(0, 2).map((e, i) => ({ id: `since-${i}`, ref: e.ref, title: e.title, detail: e.detail, at: e.at, tone: 'neutral', action: null, evidence: null })),
    href: '/?sheet=since',
    visible: since.show,
  });

  const waitingRuns = m.all('agentRuns').filter((r) => r.state === 'waiting_on_you');
  const pendingDrafts = m.all('drafts').filter((d) => d.status === 'ready' && draftHasSurface(d, personaOf(m.settings())));
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

  const runs = m.all('agentRuns');
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

  const waitingOthers = m
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

  const closed = m
    .all('workItems')
    .filter((i) => i.state === 'done' && i.doneBy === 'engine' && i.doneAt && Date.parse(i.doneAt) >= Date.parse(meta.lastActiveAt) - 12 * 3_600_000)
    .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  rail.push({
    lane: 'closed_for_you',
    label: 'CLOSED FOR YOU',
    count: closed.length,
    summary: `${closed.length} closed · undo z`,
    entries: closed.map((i) => {
      const auditId = inp.closeUndo.get(i.id);
      const ev = m.all('evidence').find((e) => e.workItemId === i.id && e.role === 'completion');
      return {
        id: i.id,
        ref: itemRef(i),
        title: i.title,
        detail: i.closedReason,
        at: i.doneAt,
        tone: 'ok' as const,
        action: auditId ? { kind: 'undo' as const, label: 'Undo', href: null, auditId, choices: [] } : null,
        evidence: ev?.source ?? null,
      };
    }),
    href: '/work?tab=done',
    visible: true,
  });

  const health = healthSummary(m);
  const brokenConn = m.all('connectors').filter((c) => health.broken.some((b) => b.id === c.id));
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

  const briefs = m.all('briefs');
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

  const spend = m.spend();
  const pulseConn = m.all('connectors').find((c) => c.source === 'slack') ?? m.all('connectors')[0];
  const deadline = quarter;

  return {
    now: nowIso,
    header: {
      date: nowIso,
      nextMeeting: next ? { eventId: next.id, title: next.title, start: next.start, minutesUntil: Math.max(0, minutesBetween(now, next.start)) } : null,
      capacity: plan ? plan.capacity : todayCapacity(m, now),
      nearestDeadline: { label: `${deadline.label} log`, due: deadline.due, progress: { done: loggedH, total: personaTargetH(personaOf(m.settings()), deadline.targetH), label: 'h' } },
      catchUp: catching.length ? { sources: catching.map((c) => ({ connectorId: c.id, label: c.label, pct: c.catchUpPct, done: false })) } : null,
    },
    spine: { events, slots, later: { fitIns: fitIns.length, promises: promises.length } },
    nowStack: { rankedAt: meta.rankedAt, rerankReady: inp.rerankReady, cards },
    moreToday: { count: restRanked.length, items: moreTodayItems.map((i) => hydrateItem(m, i)) },
    triageCount: inp.triageCount,
    shelves: { fitIns: fitIns.slice(0, 2), promises: promises.slice(0, 2) },
    rail,
    rankMeta: { policyVersion: policy.version, policyName: policy.name, rankedAt: meta.rankedAt },
    health,
    spend: { today: spend.today, state: spend.state },
    dryRun: settings.sending.dryRun,
    navCounts: {
      triage: inp.triageCount,
      agentsWaiting: waitingRuns.length,
      outbox: m.all('drafts').filter((d) => (d.status === 'ready' || d.status === 'failed') && !isAdminDraft(d)).length,
      // the items Time shows (D-52): logging canvases, forecast canvases and VDP changes while the persona has them
      adminWaiting: adminWaitingBySurface(m.all('drafts'), personaOf(m.settings())).total,
      // D-60: by the tab that holds them, so the badge lands where its items are
      adminBySurface: (({ log, forecast, vdp }) => ({ log, forecast, vdp }))(adminWaitingBySurface(m.all('drafts'), personaOf(m.settings()))),
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
