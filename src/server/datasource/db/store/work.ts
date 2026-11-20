/**
 * Work items, evidence (+ their source items), initiatives and change proposals.
 *
 * Column map (WorkItemRecord → work_items unless noted):
 *   kind → kind (follow_up ↔ missed_meeting_followup; deliverable = task + override) · state → status
 *   (reopened = open + override) · title, purpose · notes → description · initiativeId/accountId/oppId →
 *   *_id · servesEventId → deadline_event_id · counterparty → counterparty_person_id · due → due_at ·
 *   effort.youMin → effort_minutes, youMin+agentMin → lead_time_minutes · confidence → numeric ·
 *   priority → importance · snooze/waiting/done/resolution/involvement → their columns · owner →
 *   owner_person_id (null = me) · seenAt → seen_by_user_at · newEvidenceCount → unseen_evidence_count ·
 *   rank/score → priority_rank/priority_score (+ lane cache; isBackground ⇔ lane 'background') ·
 *   why → priority_scores.explanation and startBy → priority_scores.latest_start_at (Q1) · nbaId →
 *   current_nba_id · closedReason → status_reason · userLockedFields → user_locked_fields (column names) ·
 *   people → work_item_links (person, stakeholder) · assetIds → work_item_links (asset) · runIds →
 *   work_item_links (claude_session / tool_run) + ext order · training → work_item_training_details ·
 *   deliverable → work_item_deliverables (+ ext for the judged view).
 * Ext (no column yet): whyDetail, sources, rankReasons, signals, stale, likelyDone, reopened, dismissed,
 *   loopedBackIn, waiting.who/runId, enrichment, deliverable view, training provider/overdue, ageDays,
 *   runIds (they span three run tables), reevaluating, user-set startBy, resolution person name / extra
 *   evidence ids, kind/state overrides.
 */
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import type {
  Evidence,
  FieldChange,
  Initiative,
  PersonRef,
  Proposal,
  SourceRef,
  WorkItemLockableField,
  WorkItemRecord,
} from '@/contract';
import {
  changeProposals,
  initiativeLinks,
  initiatives,
  jobs,
  priorityScoreRuleHits,
  priorityScores,
  sourceItems,
  workItemDeliverables,
  workItemEvidence,
  workItemLinks,
  workItems,
  workItemTrainingDetails,
  workItemTransitions,
} from '@/db/schema';
import { isClosedItemState } from '@/outbox/withdraw';
import { sourceItemUrl } from '@/projections/links';

import {
  applyOverride,
  confToNum,
  kindFromDb,
  kindToDb,
  numToConf,
  originFor,
  overrideIfLossy,
  priorityFromDb,
  priorityToDb,
  sourceFromDb,
  sourceItemKind,
  sourceToDb,
  stateFromDb,
  stateToDb,
  type DbWorkKind,
  type DbWorkStatus,
  type Override,
} from '../enums';
import { hashKey, uuidFor, uuidOrNull } from '../ids';
import type { ScoreDetail } from '../rank';
import { plainText as docPlainText, textDiff } from '../../mock/render';
import { ext, iso, isoReq, personRef, same, toDate, updateRow, writeExt, type ReadCtx, type WriteCtx } from './common';
import { withdrawDraftsOfClosedItems } from './withdraw';

// ---------------------------------------------------------------------------
// Lockable fields: contract name ↔ column name(s)
// ---------------------------------------------------------------------------

export const WORK_LOCK_COLUMNS: Record<WorkItemLockableField, string[]> = {
  title: ['title'],
  purpose: ['purpose'],
  due: ['due_at'],
  startBy: ['start_by'], // ext-backed (no column): a pseudo lock name
  effort: ['effort_minutes', 'lead_time_minutes'],
  notes: ['description'],
  initiativeId: ['initiative_id'],
  accountId: ['account_id'],
  oppId: ['opportunity_id'],
  state: ['status'],
  kind: ['kind'],
};
const COLUMN_LOCK = new Map<string, WorkItemLockableField>();
for (const [f, cs] of Object.entries(WORK_LOCK_COLUMNS)) for (const c of cs) COLUMN_LOCK.set(c, f as WorkItemLockableField);

export const lockColumns = (fields: WorkItemLockableField[]) => [...new Set(fields.flatMap((f) => WORK_LOCK_COLUMNS[f]))];
export function lockFieldsFromColumns(cols: string[]): WorkItemLockableField[] {
  const out: WorkItemLockableField[] = [];
  for (const c of cols) {
    const f = COLUMN_LOCK.get(c);
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}

/** Contract field → column, for proposals (change_proposals.field holds column names). */
export const WORK_FIELD_COLUMN: Record<string, string> = {
  title: 'title',
  purpose: 'purpose',
  due: 'due_at',
  notes: 'description',
  initiativeId: 'initiative_id',
  accountId: 'account_id',
  oppId: 'opportunity_id',
  state: 'status',
  kind: 'kind',
  servesEventId: 'deadline_event_id',
};
const COLUMN_FIELD = Object.fromEntries(Object.entries(WORK_FIELD_COLUMN).map(([f, c]) => [c, f]));
const FIELD_LABEL: Record<string, string> = { title: 'Title', purpose: 'Purpose', due: 'Due', notes: 'Notes', state: 'State', kind: 'Kind', initiativeId: 'Initiative', accountId: 'Account', oppId: 'Opportunity', doc: 'Draft body' };

// ---------------------------------------------------------------------------
// Ext shape
// ---------------------------------------------------------------------------

interface WorkExt {
  /** why for an item without a priority_scores row yet (fresh capture). */
  why: string;
  whyDetail: string;
  sources: SourceRef[];
  rankReasons: WorkItemRecord['rankReasons'];
  signals: WorkItemRecord['signals'];
  stale: WorkItemRecord['stale'];
  likelyDone: WorkItemRecord['likelyDone'];
  reopened: WorkItemRecord['reopened'];
  dismissed: WorkItemRecord['dismissed'];
  loopedBackIn: WorkItemRecord['loopedBackIn'];
  waitingWhoId: string;
  waitingRunId: string;
  enrichment: WorkItemRecord['enrichment'];
  deliverable: WorkItemRecord['deliverable'];
  trainingProvider: string;
  trainingOverdue: boolean;
  /** Whole TrainingInfo while work_item_training_details is unwritable (BLOCKER B1, see upsertTraining). */
  training: WorkItemRecord['training'];
  ageDays: number;
  runIds: string[];
  /** @deprecated derived from queued jobs; older rows may still carry it and it is ignored. */
  reevaluating: boolean;
  startByUser: { value: string | null };
  resolutionPersonName: string;
  resolutionEvidenceIds: string[];
  /** SETTLE-1: why the app closed it for you (reason class, confidence, the message link, the skill version). */
  resolutionSettle: NonNullable<NonNullable<WorkItemRecord['resolutionDetail']>['settle']>;
  kindOverride: Override<WorkItemRecord['kind'], DbWorkKind>;
  stateOverride: Override<WorkItemRecord['state'], DbWorkStatus>;
  /** doneAt/doneBy survive a non-done status in the contract (work_items_done_chk forbids it in the row). */
  keptDone: { doneAt: string | null; doneBy: WorkItemRecord['doneBy'] };
  /** Display copy of who it was handed to when no people row resolves (owner = synthetic person). */
  ownerName: string;
  /** work_items_handoff_chk: a hand-off stores watcher; the contract may say otherwise. */
  involvementOverride: Override<WorkItemRecord['involvement'], 'watcher'>;
}

function workExt(w: WorkItemRecord, dbKind: DbWorkKind, dbStatus: DbWorkStatus): Partial<WorkExt> {
  const signals = w.signals.customerFacing || w.signals.fromManager || w.signals.boost ? w.signals : undefined;
  const resPersonName = w.resolutionDetail?.personName && !w.resolutionDetail.personId ? w.resolutionDetail.personName : undefined;
  const evIds = w.resolutionDetail?.evidenceIds && w.resolutionDetail.evidenceIds.length > 1 ? w.resolutionDetail.evidenceIds : undefined;
  return {
    why: w.why || undefined,
    whyDetail: w.whyDetail ?? undefined,
    sources: w.sources,
    rankReasons: w.rankReasons,
    signals,
    stale: w.stale,
    likelyDone: w.likelyDone,
    reopened: w.reopened,
    dismissed: w.dismissed,
    loopedBackIn: w.loopedBackIn,
    waitingWhoId: w.waiting?.who?.id,
    waitingRunId: w.waiting?.runId,
    enrichment: w.enrichment,
    deliverable: w.deliverable,
    trainingProvider: TRAINING_DETAILS_WRITABLE && w.training && trainingProviderLabel(trainingProviderEnum(w.training.provider)) !== w.training.provider ? w.training.provider : undefined,
    trainingOverdue: TRAINING_DETAILS_WRITABLE ? w.training?.overdue || undefined : undefined,
    training: TRAINING_DETAILS_WRITABLE ? undefined : w.training,
    ageDays: w.ageDays || undefined,
    runIds: w.runIds,
    // reevaluating is derived from queued jobs on every read; never persisted (a stored copy stuck on for good).
    resolutionPersonName: resPersonName,
    resolutionEvidenceIds: evIds,
    resolutionSettle: w.resolutionDetail?.settle ?? undefined,
    kindOverride: overrideIfLossy(w.kind, dbKind, kindFromDb) ?? undefined,
    stateOverride: overrideIfLossy(w.state, dbStatus, (s) => stateFromDb(s, false)) ?? undefined,
    keptDone: w.state !== 'done' && (w.doneAt || w.doneBy) ? { doneAt: w.doneAt, doneBy: w.doneBy } : undefined,
    involvementOverride: handoffInvolvement(w) !== w.involvement ? { value: w.involvement, when: 'watcher' } : undefined,
  };
}

/** A handed-off item must be watcher / not_involved in the row (work_items_handoff_chk). */
function handoffInvolvement(w: WorkItemRecord): WorkItemRecord['involvement'] {
  return w.resolution === 'handed_off' && w.involvement !== 'watcher' && w.involvement !== 'not_involved' ? 'watcher' : w.involvement;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function loadWorkItems(rc: ReadCtx, ids?: string[]): Promise<WorkItemRecord[]> {
  const where = ids ? and(eq(workItems.ownerUserId, rc.userId), inArray(workItems.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])) : eq(workItems.ownerUserId, rc.userId);
  const rows = await rc.db
    .select({ w: workItems, why: priorityScores.explanation, startBy: priorityScores.latestStartAt })
    .from(workItems)
    .leftJoin(priorityScores, eq(priorityScores.id, workItems.priorityScoreId))
    .where(where)
    .orderBy(asc(workItems.createdAt), asc(workItems.id));
  if (!rows.length) return [];
  const itemIds = rows.map((r) => r.w.id);
  const links = await rc.db
    .select()
    .from(workItemLinks)
    .where(inArray(workItemLinks.workItemId, itemIds))
    .orderBy(asc(workItemLinks.createdAt), asc(workItemLinks.id));
  const training = await rc.db.select().from(workItemTrainingDetails).where(inArray(workItemTrainingDetails.workItemId, itemIds));
  // "re-evaluating…": a queued or running job for the item. Re-eval jobs (W2, scanner, BE-3) key the item as
  // `work_item_id`; enrich jobs (captureItem) as `workItemId`.
  const jobItem = sql<string>`coalesce(${jobs.payload} ->> 'work_item_id', ${jobs.payload} ->> 'workItemId')`;
  const busy = await rc.db
    .select({ id: jobItem })
    .from(jobs)
    .where(and(eq(jobs.ownerUserId, rc.userId), inArray(jobs.status, ['queued', 'running']), inArray(jobs.kind, ['enrich', 'reevaluate']), isNotNull(jobItem)));
  const busyIds = new Set(busy.map((b) => b.id));
  // Scanner-made items carry no `sources` of their own: their origin chip is the evidence they were made from (origin
  // first), each linked to the original (tenet: Provenance on everything).
  const bare = rows.filter((r) => ext<WorkExt>(rc, 'work_items', r.w.id).sources === undefined).map((r) => r.w.id);
  const derivedSources = new Map<string, SourceRef[]>();
  if (bare.length) {
    const ev = await rc.db
      .select({ wid: workItemEvidence.workItemId, role: workItemEvidence.role, si: sourceItems })
      .from(workItemEvidence)
      .innerJoin(sourceItems, eq(sourceItems.id, workItemEvidence.sourceItemId))
      .where(and(inArray(workItemEvidence.workItemId, bare), sql`${sourceItems.dedupeKey} not like 'cc.evidence:%'`))
      .orderBy(asc(workItemEvidence.createdAt), asc(workItemEvidence.id));
    const rank = (role: string) => (role === 'origin' ? 0 : role === 'completion' ? 2 : 1);
    for (const e of [...ev].sort((a, b) => rank(a.role) - rank(b.role))) {
      const list = derivedSources.get(e.wid) ?? [];
      const ref = sourceRefOf(e.si);
      if (list.length < 3 && !list.some((x) => (x.url && x.url === ref.url) || (x.externalId && x.externalId === ref.externalId))) list.push(ref);
      derivedSources.set(e.wid, list);
    }
  }
  const trainingBy = new Map(training.map((t) => [t.workItemId, t]));
  const linksBy = new Map<string, (typeof links)[number][]>();
  for (const l of links) {
    if (!linksBy.has(l.workItemId)) linksBy.set(l.workItemId, []);
    linksBy.get(l.workItemId)!.push(l);
  }

  return rows.map(({ w: r, why, startBy }) => {
    const x = ext<WorkExt>(rc, 'work_items', r.id);
    const kind = applyOverride(r.kind, kindFromDb(r.kind), x.kindOverride);
    const state = applyOverride(r.status, stateFromDb(r.status, false), x.stateOverride);
    const ls = linksBy.get(r.id) ?? [];
    const t = trainingBy.get(r.id);
    const owner = r.ownerPersonId ? personRef(rc, r.ownerPersonId) : { id: rc.me.id, name: rc.me.name };
    const resolutionPerson = r.resolutionPersonId ? personRef(rc, r.resolutionPersonId) : null;
    const youMin = r.effortMinutes ?? 0;
    const agentMin = Math.max(0, (r.leadTimeMinutes ?? youMin) - youMin);
    const rec: WorkItemRecord = {
      id: r.id,
      version: r.version,
      kind,
      state,
      title: r.title,
      purpose: r.purpose,
      initiativeId: r.initiativeId,
      accountId: r.accountId,
      oppId: r.opportunityId,
      servesEventId: r.deadlineEventId,
      confidence: numToConf(r.confidence),
      why: why ?? x.why ?? '',
      whyDetail: x.whyDetail ?? null,
      sources: x.sources ?? derivedSources.get(r.id) ?? [],
      effort: { youMin, agentMin },
      startBy: x.startByUser ? x.startByUser.value : iso(startBy),
      due: iso(r.dueAt),
      createdAt: isoReq(r.createdAt),
      updatedAt: isoReq(r.updatedAt),
      ageDays: x.ageDays ?? 0,
      isBackground: r.priorityLane === 'background',
      rank: r.priorityRank,
      rankReasons: x.rankReasons ?? [],
      score: r.priorityScore,
      priority: priorityFromDb(r.importance),
      signals: x.signals ?? { customerFacing: false, fromManager: false, boost: 0 },
      stale: x.stale ?? null,
      userLockedFields: lockFieldsFromColumns(r.userLockedFields),
      newEvidenceCount: r.unseenEvidenceCount,
      reevaluating: busyIds.has(r.id),
      seenAt: iso(r.seenByUserAt),
      nbaId: r.currentNbaId,
      owner,
      people: ls.filter((l) => l.personId && l.role === 'stakeholder').map((l) => personRef(rc, l.personId)!),
      waiting:
        r.waitingReason && r.waitingSince
          ? {
              on: r.status === 'waiting_on_me' ? 'me' : 'others',
              reason: r.waitingReason,
              ...(x.waitingWhoId ? { who: personRef(rc, x.waitingWhoId)! } : {}),
              since: isoReq(r.waitingSince),
              ...(x.waitingRunId ? { runId: x.waitingRunId } : {}),
            }
          : null,
      snoozedUntil: iso(r.snoozedUntil),
      snoozedFrom: r.snoozedFromStatus ? stateFromDb(r.snoozedFromStatus, false) : null,
      doneAt: r.doneAt ? iso(r.doneAt) : (x.keptDone?.doneAt ?? null),
      doneBy: r.doneBy ? (r.doneBy === 'user' || r.doneBy === 'chat' ? r.doneBy : 'engine') : (x.keptDone?.doneBy ?? null),
      closedReason: r.statusReason,
      resolution: r.resolution,
      resolutionDetail: r.resolution
        ? {
            ...(resolutionPerson ? { personId: resolutionPerson.id, personName: resolutionPerson.name } : x.resolutionPersonName ? { personName: x.resolutionPersonName } : {}),
            ...(r.resolutionWorkItemId ? { relatedItemId: r.resolutionWorkItemId } : {}),
            ...(r.resolutionNote ? { note: r.resolutionNote } : {}),
            inferred: r.resolutionInferred,
            ...(x.resolutionEvidenceIds ? { evidenceIds: x.resolutionEvidenceIds } : r.resolutionEvidenceId ? { evidenceIds: [r.resolutionEvidenceId] } : {}),
            ...(x.resolutionSettle ? { settle: x.resolutionSettle } : {}),
          }
        : null,
      involvement: applyOverride(r.involvement as 'watcher', r.involvement, x.involvementOverride as Override<WorkItemRecord['involvement'], 'watcher'> | undefined),
      loopedBackIn: x.loopedBackIn ?? null,
      likelyDone: x.likelyDone ?? null,
      reopened: x.reopened ?? null,
      dismissed: x.dismissed ?? null,
      notes: r.description ?? '',
      enrichment: x.enrichment ?? null,
      deliverable: x.deliverable ?? null,
      training: x.training
        ? x.training
        : t
        ? {
            course: t.courseTitle,
            provider: x.trainingProvider ?? trainingProviderLabel(t.provider),
            minutes: t.estimatedMinutes ?? 0,
            dueDate: t.requiredBy ? isoReq(t.requiredBy).slice(0, 10) : null,
            overdue: !!x.trainingOverdue,
            ...(t.courseUrl ? { url: t.courseUrl } : {}),
          }
        : null,
      runIds: x.runIds ?? [],
      assetIds: ls.filter((l) => l.assetId).map((l) => l.assetId!),
      counterparty: personRef(rc, r.counterpartyPersonId),
    };
    return rec;
  });
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

type WorkRow = typeof workItems.$inferInsert;

const PROVIDER_LABEL = { trailhead: 'Trailhead', workday_learning: 'Workday Learning', internal_lms: 'Internal LMS', slack: 'Slack', email: 'Email', other: 'Other' } as const;
function trainingProviderLabel(p: keyof typeof PROVIDER_LABEL): string {
  return PROVIDER_LABEL[p];
}

function trainingProviderEnum(p: string): 'trailhead' | 'workday_learning' | 'internal_lms' | 'slack' | 'email' | 'other' {
  if (/trailhead/i.test(p)) return 'trailhead';
  if (/workday/i.test(p)) return 'workday_learning';
  if (/slack/i.test(p)) return 'slack';
  if (/mail/i.test(p)) return 'email';
  if (/readiness|lms|clo|compliance/i.test(p)) return 'internal_lms';
  return 'other';
}

/** The work_items columns a contract record implies (everything but bookkeeping and the score pointer). */
export function workItemColumns(w: WorkItemRecord, wc: Pick<WriteCtx, 'userId' | 'me'>): WorkRow {
  const dbStatus = stateToDb(w.state);
  const rd = w.resolutionDetail;
  const done = w.state === 'done';
  return {
    id: uuidFor(w.id),
    ownerUserId: wc.userId,
    kind: kindToDb(w.kind),
    origin: originFor(w.kind, w.sources[0]?.kind),
    status: dbStatus,
    statusReason: w.closedReason,
    title: w.title,
    purpose: w.purpose,
    description: w.notes ? w.notes : null,
    initiativeId: uuidOrNull(w.initiativeId),
    accountId: uuidOrNull(w.accountId),
    opportunityId: uuidOrNull(w.oppId),
    counterpartyPersonId: w.counterparty ? uuidFor(w.counterparty.id) : null,
    dueAt: toDate(w.due),
    deadlineEventId: uuidOrNull(w.servesEventId),
    effortMinutes: w.effort.youMin,
    leadTimeMinutes: w.effort.youMin + w.effort.agentMin,
    backgroundable: w.effort.agentMin > 0,
    importance: priorityToDb(w.priority),
    confidence: confToNum(w.confidence),
    snoozedUntil: w.state === 'snoozed' || w.snoozedUntil ? toDate(w.snoozedUntil) : null,
    snoozedFromStatus: w.snoozedFrom ? stateToDb(w.snoozedFrom) : null,
    waitingReason: w.waiting?.reason ?? null,
    waitingSince: toDate(w.waiting?.since),
    doneAt: done ? toDate(w.doneAt ?? w.updatedAt) : null,
    doneBy: done ? (w.doneBy ?? 'user') : null,
    resolution: w.resolution,
    resolutionPersonId: rd?.personId ? uuidFor(rd.personId) : null,
    resolutionWorkItemId: rd?.relatedItemId ? uuidFor(rd.relatedItemId) : null,
    resolutionNote: rd?.note ?? null,
    resolutionInferred: rd?.inferred ?? false,
    resolutionEvidenceId: rd?.evidenceIds?.[0] ? uuidFor(rd.evidenceIds[0]) : null,
    ownerPersonId: w.owner && w.owner.id !== wc.me.id ? uuidFor(w.owner.id) : null,
    involvement: handoffInvolvement(w),
    seenByUserAt: toDate(w.seenAt),
    unseenEvidenceCount: w.newEvidenceCount,
    priorityRank: w.rank,
    priorityScore: w.score,
    priorityLane: w.isBackground ? 'background' : w.rank === null ? null : w.rank <= 3 ? 'top3' : w.rank <= 15 ? 'now' : w.rank <= 30 ? 'next' : 'later',
    currentNbaId: uuidOrNull(w.nbaId),
  };
}

export interface ScoreInput {
  runId: number;
  policyId: string;
  /**
   * ENGINES-core output for this item: the component columns, lane, latest_start_at, slack, inputs hash
   * and rule hits come from the engine instead of being derived from rankReasons.
   */
  detail?: ScoreDetail;
  /** rule_key → priority_policy_rules.id of the policy version (rule hits reference rule rows). */
  ruleIds?: Map<string, string>;
}

/** A priority_scores row carrying why / startBy / the components (+ rule hits when the engine ranked it). */
export async function insertScore(w: WriteCtx, rec: WorkItemRecord, s: ScoreInput, computedAt: Date): Promise<number> {
  if (s.detail) {
    const d = s.detail;
    const [row] = await w.tx
      .insert(priorityScores)
      .values({
        runId: s.runId,
        workItemId: uuidFor(rec.id),
        policyId: s.policyId,
        total: rec.score ?? 0,
        ...d.components,
        lane: d.lane,
        rank: rec.rank,
        latestStartAt: toDate(d.startBy),
        slackMinutes: d.slackMinutes,
        inputsHash: d.inputsHash,
        explanation: rec.why,
        computedAt,
      })
      .returning({ id: priorityScores.id });
    const hits = d.ruleHits.flatMap((h) => {
      const ruleId = s.ruleIds?.get(h.ruleKey);
      return ruleId ? [{ scoreId: row!.id, ruleId, effect: h.effect, explanation: h.explanation }] : [];
    });
    if (hits.length) await w.tx.insert(priorityScoreRuleHits).values(hits).onConflictDoNothing();
    return row!.id;
  }
  const comp: Record<string, number> = {};
  const COMPONENT: Record<string, string> = {
    customer_facing: 'stakeholderImportance',
    meeting_proximity: 'calendarPressure',
    due_urgency: 'deadlineProximity',
    manager_ask: 'commitmentWeight',
    deal_value: 'dealValue',
    lead_time: 'leadTime',
    age: 'staleness',
    effort_fit: 'effortFit',
    boost: 'userAdjustment',
  };
  for (const r of rec.rankReasons) {
    const col = r.key.startsWith('rule:') ? 'obligationBoost' : COMPONENT[r.key];
    if (col) comp[col] = Math.round(((comp[col] ?? 0) + r.contribution) * 1000) / 1000;
  }
  const lane = rec.isBackground ? 'background' : rec.rank === null ? 'hidden' : rec.rank <= 3 ? 'top3' : rec.rank <= 15 ? 'now' : rec.rank <= 30 ? 'next' : 'later';
  const [row] = await w.tx
    .insert(priorityScores)
    .values({
      runId: s.runId,
      workItemId: uuidFor(rec.id),
      policyId: s.policyId,
      total: rec.score ?? 0,
      ...comp,
      lane,
      rank: rec.rank,
      latestStartAt: toDate(rec.startBy),
      inputsHash: hashKey(rec.rank, rec.score, rec.rankReasons, rec.why),
      explanation: rec.why,
      computedAt,
    })
    .returning({ id: priorityScores.id });
  return row!.id;
}

async function writeLinks(w: WriteCtx, itemId: string, people: PersonRef[], assetIds: string[], runLinks: { claudeSessionId?: string; toolRunId?: string }[], prev?: { people: PersonRef[]; assetIds: string[]; runLinks: { claudeSessionId?: string; toolRunId?: string }[] }) {
  const want: { key: string; values: typeof workItemLinks.$inferInsert }[] = [];
  let i = 0;
  const at = (n: number) => new Date(w.now.getTime() + n);
  for (const p of people) want.push({ key: `p:${uuidFor(p.id)}`, values: { workItemId: itemId, personId: uuidFor(p.id), role: 'stakeholder', confidence: 1, extractorId: w.extractorId, createdAt: at(i++) } });
  for (const a of assetIds) want.push({ key: `a:${uuidFor(a)}`, values: { workItemId: itemId, assetId: uuidFor(a), role: 'related', confidence: 1, extractorId: w.extractorId, createdAt: at(i++) } });
  for (const r of runLinks) {
    if (r.claudeSessionId) want.push({ key: `c:${r.claudeSessionId}`, values: { workItemId: itemId, claudeSessionId: r.claudeSessionId, role: 'working_session', confidence: 1, extractorId: w.extractorId, createdAt: at(i++) } });
    if (r.toolRunId) want.push({ key: `t:${r.toolRunId}`, values: { workItemId: itemId, toolRunId: r.toolRunId, role: 'working_session', confidence: 1, extractorId: w.extractorId, createdAt: at(i++) } });
  }
  if (!prev) {
    if (want.length) await w.tx.insert(workItemLinks).values(want.map((x) => x.values)).onConflictDoNothing();
    return;
  }
  const existing = await w.tx.select().from(workItemLinks).where(eq(workItemLinks.workItemId, itemId));
  const keyOf = (l: (typeof existing)[number]) => (l.personId ? `p:${l.personId}` : l.assetId ? `a:${l.assetId}` : l.claudeSessionId ? `c:${l.claudeSessionId}` : l.toolRunId ? `t:${l.toolRunId}` : `x:${l.id}`);
  const wantKeys = new Set(want.map((x) => x.key));
  const haveKeys = new Set(existing.map(keyOf));
  const managed = (k: string) => k.startsWith('p:') || k.startsWith('a:') || k.startsWith('c:') || k.startsWith('t:');
  const drop = existing.filter((l) => managed(keyOf(l)) && !wantKeys.has(keyOf(l)) && (l.role === 'stakeholder' || l.role === 'related' || l.role === 'working_session'));
  if (drop.length) await w.tx.delete(workItemLinks).where(inArray(workItemLinks.id, drop.map((d) => d.id)));
  const add = want.filter((x) => !haveKeys.has(x.key));
  if (add.length) await w.tx.insert(workItemLinks).values(add.map((x) => x.values)).onConflictDoNothing();
}

export interface WorkLinkTargets {
  /** contract run id → claude session / tool run row ids (the Agents mirror rows have their own ids). */
  runLinks: (runIds: string[]) => { claudeSessionId?: string; toolRunId?: string }[];
  /** Asset ids that exist (deliverables reference assets by FK). */
  hasAsset: (id: string) => boolean;
}

/** Insert a work item with its children and ext. Returns the uuid. */
/**
 * `ordinal` breaks ties between items created in the same millisecond (a seed loads many at once): it is
 * added as microseconds, below the contract's millisecond precision, so `ORDER BY created_at` keeps the
 * seed's order.
 */
export async function insertWorkItem(w: WriteCtx, rec: WorkItemRecord, t: WorkLinkTargets, opts: { createdAt?: string; statusChangedAt?: string; locks?: string[]; ordinal?: number } = {}): Promise<string> {
  const cols = workItemColumns(rec, w);
  const id = cols.id!;
  await w.tx.insert(workItems).values({
    ...cols,
    version: rec.version,
    statusChangedAt: toDate(opts.statusChangedAt ?? rec.updatedAt)!,
    lastReopenedAt: rec.reopened ? toDate(rec.reopened.at) : null,
    reopenedCount: rec.reopened ? 1 : 0,
    likelyDoneAt: rec.state === 'likely_done' ? toDate(rec.updatedAt) : null,
    lastNewInfoAt: rec.newEvidenceCount > 0 ? toDate(rec.updatedAt) : null,
    userLockedFields: opts.locks ?? lockColumns(rec.userLockedFields).sort(),
    createdAt: opts.ordinal ? (sql`${toDate(opts.createdAt ?? rec.createdAt)!.toISOString()}::timestamptz + make_interval(secs => ${opts.ordinal}::float8 / 1000000)` as unknown as Date) : toDate(opts.createdAt ?? rec.createdAt)!,
    updatedAt: toDate(rec.updatedAt)!,
  });
  await writeLinks(w, id, rec.people, rec.assetIds.filter(t.hasAsset), t.runLinks(rec.runIds));
  if (rec.training) await upsertTraining(w, id, rec.training);
  if (rec.deliverable?.assetId && t.hasAsset(rec.deliverable.assetId)) await upsertDeliverable(w, id, rec);
  await writeExt(w, 'work_items', id, workExt(rec, cols.kind!, cols.status!) as Record<string, unknown>);
  return id;
}

/**
 * work_item_training_details (and work_item_travel_details) key on work_item_id and have no `id` column.
 * Migration 0005 (INTEGRATE-1, BE-1b blocker B1) keys their audit rows by that column, so the training view
 * lives in the real table again: course, provider (enum; the display string stays in ext when lossy), url,
 * required-by date, minutes, mandatory. Only `overdue` (a derived flag) stays in ext. Older rows written
 * while the table was unwritable still read from ext (`training`).
 */
const TRAINING_DETAILS_WRITABLE = true;

async function upsertTraining(w: WriteCtx, itemId: string, tr: NonNullable<WorkItemRecord['training']>) {
  if (!TRAINING_DETAILS_WRITABLE) return;
  const values = {
    workItemId: itemId,
    provider: trainingProviderEnum(tr.provider),
    courseTitle: tr.course,
    courseUrl: tr.url ?? null,
    requiredBy: tr.dueDate ? new Date(`${tr.dueDate}T00:00:00.000Z`) : null,
    estimatedMinutes: tr.minutes,
    // the contract has no flag: a training with a required-by date (or already overdue) is mandatory
    mandatory: !!tr.dueDate || tr.overdue,
  };
  await w.tx.insert(workItemTrainingDetails).values(values).onConflictDoUpdate({ target: workItemTrainingDetails.workItemId, set: values });
}

async function upsertDeliverable(w: WriteCtx, itemId: string, rec: WorkItemRecord) {
  const d = rec.deliverable!;
  const verdict = d.judgment?.verdict;
  const status = verdict === 'complete' ? 'complete' : verdict === 'partial' || verdict === 'in_progress' || verdict === 'regressed' ? 'in_progress' : verdict === 'not_started' ? 'not_started' : 'in_progress';
  const kind = d.mimeKind === 'slides' ? 'slides' : d.mimeKind === 'doc' ? 'doc' : d.mimeKind === 'sheet' ? 'sheet' : 'other';
  const existing = await w.tx.select({ id: workItemDeliverables.id }).from(workItemDeliverables).where(eq(workItemDeliverables.workItemId, itemId));
  if (existing.length) {
    await w.tx.update(workItemDeliverables).set({ status, kind }).where(eq(workItemDeliverables.id, existing[0]!.id));
  } else {
    await w.tx.insert(workItemDeliverables).values({ workItemId: itemId, assetId: uuidFor(d.assetId!), kind, baselineAt: toDate(rec.createdAt)!, status, assetHint: d.fileName });
  }
}

export interface WorkUpdateOpts {
  /** Contract version bump (true for every mutation the mock `bump()`s). */
  bump: boolean;
  ifVersion?: number;
  /** Newly user-locked contract fields (patch edits); actions lock nothing. */
  lock?: WorkItemLockableField[];
}

/** Diff two contract records and write the difference. Returns proposals created by an engine write. */
export async function updateWorkItem(w: WriteCtx, cur: WorkItemRecord, next: WorkItemRecord, t: WorkLinkTargets, o: WorkUpdateOpts) {
  const a = workItemColumns(cur, w);
  const b = workItemColumns(next, w);
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(b) as (keyof WorkRow)[]) {
    if (k === 'origin' || k === 'id' || k === 'ownerUserId') continue;
    if (!same(a[k], b[k])) patch[k] = b[k];
  }
  if (patch.status !== undefined || cur.state !== next.state) {
    patch.statusChangedAt = w.now;
    if (next.state === 'reopened' && cur.state !== 'reopened') {
      patch.lastReopenedAt = w.now;
      patch.reopenedCount = sql`${workItems.reopenedCount} + 1`;
    }
    if (next.state === 'likely_done') patch.likelyDoneAt = w.now;
  }
  if (next.newEvidenceCount > cur.newEvidenceCount) patch.lastNewInfoAt = w.now;
  const extA = workExt(cur, a.kind!, a.status!);
  const extB = workExt(next, b.kind!, b.status!);
  const extChanged = !same(extA, extB) || !same(cur.people, next.people) || !same(cur.assetIds, next.assetIds) || !same(cur.training, next.training);
  // startBy edited by the user lives in ext (priority_scores is engine output)
  const extNext: Partial<WorkExt> = { ...extB };
  if (!same(cur.startBy, next.startBy)) extNext.startByUser = { value: next.startBy };
  else {
    const prev = (w.kv.get(`cc.ext/work_items/${b.id}`) as Partial<WorkExt> | undefined)?.startByUser;
    if (prev) extNext.startByUser = prev;
  }
  const r = await updateRow(w, workItems, b.id!, patch, {
    bump: o.bump,
    ifVersion: o.ifVersion,
    lock: o.lock ? lockColumns(o.lock) : false,
    extChanged: extChanged || !same(cur.startBy, next.startBy),
    stampUpdatedAt: o.bump,
  });
  // why lives on the current score row (Q1); an engine rewrite of the line updates it in place
  if (cur.why !== next.why) {
    await w.tx.execute(sql`update priority_scores set explanation = ${next.why}
                            where id = (select priority_score_id from work_items where id = ${b.id})`);
  }
  if (!same(cur.people, next.people) || !same(cur.assetIds, next.assetIds) || !same(cur.runIds, next.runIds)) {
    await writeLinks(w, b.id!, next.people, next.assetIds.filter(t.hasAsset), t.runLinks(next.runIds), {
      people: cur.people,
      assetIds: cur.assetIds,
      runLinks: t.runLinks(cur.runIds),
    });
  }
  if (next.training && !same(cur.training, next.training)) await upsertTraining(w, b.id!, next.training);
  await writeExt(w, 'work_items', b.id!, extNext as Record<string, unknown>);
  // OUTBOX-W: an item that closes here withdraws its pending reply drafts, in this change set. Every closing writer
  // comes through here (user verbs, chat, triage, settle, the closure machine, re-eval). The status the row actually
  // holds decides (a locked status became a proposal: nothing closed); reopening never brings them back.
  const withdrawn = isClosedItemState(next.state) && !isClosedItemState(cur.state) ? await withdrawDraftsOfClosedItems(w.tx, w.userId, { itemIds: [b.id!], at: w.now }) : [];
  return { ...r, withdrawn };
}

/** Status transitions are the state-machine log (Q6 "closed for you", undo stamps them). */
export async function logTransition(w: WriteCtx, itemId: string, from: WorkItemRecord['state'] | null, to: WorkItemRecord['state'], reason: string | null, evidenceId?: string | null): Promise<number | null> {
  const f = from ? stateToDb(from) : null;
  const t = stateToDb(to);
  if (f === t) return null;
  const [row] = await w.tx.insert(workItemTransitions).values({
    workItemId: uuidFor(itemId),
    fromStatus: f,
    toStatus: t,
    actorKind: w.cs.actor.kind,
    actorRef: w.cs.actor.ref ?? null,
    reason,
    evidenceId: evidenceId ? uuidFor(evidenceId) : null,
    changeSetId: w.cs.id,
    occurredAt: w.now,
  }).returning({ id: workItemTransitions.id });
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Evidence (work_item_evidence + one source_items row per evidence)
// ---------------------------------------------------------------------------

interface EvidenceExt {
  isNew: Override<'true' | 'false', 'true' | 'false'>;
}

interface EvidenceMeta {
  label?: string;
  author?: string | { name?: string | null; email?: string | null } | null;
  sourceAt?: string | null;
  externalId?: string | null;
  channelName?: unknown;
  subject?: unknown;
}
const SOURCE_LABEL: Partial<Record<SourceRef['kind'], string>> = { slack: 'Slack message', gmail: 'Email', calendar: 'Calendar event', drive: 'Drive file', gemini: 'Meeting notes', org62: 'Org62 record', claude: 'Claude session', vdp: 'VDP' };
/** The scanner's author is {name, email, externalId, isMe}; the contract shows a name. */
function authorName(a: EvidenceMeta['author']): string | null {
  if (typeof a === 'string') return a || null;
  if (a && typeof a === 'object') return a.name || a.email || null;
  return null;
}
function scannerLabel(m: EvidenceMeta): string | null {
  if (typeof m.channelName === 'string' && m.channelName) return `#${m.channelName.replace(/^#/, '')}`;
  if (typeof m.subject === 'string' && m.subject) return m.subject;
  return null;
}

/** A source item as a source chip, linked to the original (derived from its ids when it has no stored link). */
export function sourceRefOf(si: typeof sourceItems.$inferSelect): SourceRef {
  const meta = (si.meta ?? {}) as EvidenceMeta;
  const kind = sourceFromDb(si.source);
  const externalId = 'externalId' in meta ? meta.externalId : si.externalId;
  const sourceAt = 'sourceAt' in meta ? meta.sourceAt : iso(si.occurredAt);
  const url = sourceItemUrl({ source: si.source, externalId: si.externalId, url: si.url, meta: si.meta as Record<string, unknown> });
  return {
    kind,
    label: meta.label ?? si.title ?? scannerLabel(meta) ?? SOURCE_LABEL[kind] ?? 'Source',
    ...(url ? { url } : {}),
    ...(externalId ? { externalId } : {}),
    ...(sourceAt ? { at: sourceAt } : {}),
  };
}

export async function loadEvidence(rc: ReadCtx): Promise<Evidence[]> {
  const rows = await rc.db
    .select({ e: workItemEvidence, si: sourceItems, seen: workItems.seenByUserAt })
    .from(workItemEvidence)
    .innerJoin(workItems, eq(workItems.id, workItemEvidence.workItemId))
    .leftJoin(sourceItems, eq(sourceItems.id, workItemEvidence.sourceItemId))
    .where(eq(workItems.ownerUserId, rc.userId))
    .orderBy(asc(workItemEvidence.createdAt), asc(workItemEvidence.id));
  return rows.map(({ e, si, seen }) => {
    const meta = (si?.meta ?? {}) as EvidenceMeta;
    const derivedNew = !!seen && e.createdAt.getTime() > seen.getTime();
    const x = ext<EvidenceExt>(rc, 'work_item_evidence', e.id);
    const isNew = applyOverride(derivedNew ? 'true' : 'false', derivedNew ? 'true' : 'false', x.isNew) === 'true';
    const kind = si ? sourceFromDb(si.source) : 'manual';
    // app-written source items carry label / sourceAt / externalId in meta; the scanner's carry its own meta
    // (channelName, subject, author object) and the columns
    const externalId = 'externalId' in meta ? meta.externalId : (si?.externalId ?? null);
    const sourceAt = 'sourceAt' in meta ? meta.sourceAt : si ? iso(si.occurredAt) : null;
    // Rows stored before their source had a link (Org62, Claude sessions) get it derived from their ids.
    const srcUrl = si ? sourceItemUrl({ source: si.source, externalId: si.externalId, url: si.url, meta: si.meta as Record<string, unknown> }) : null;
    const source: SourceRef = {
      kind,
      label: meta.label ?? si?.title ?? scannerLabel(meta) ?? SOURCE_LABEL[kind] ?? 'Source',
      ...(srcUrl ? { url: srcUrl } : {}),
      ...(externalId ? { externalId } : {}),
      ...(sourceAt ? { at: sourceAt } : {}),
    };
    return {
      id: e.id,
      workItemId: e.workItemId,
      role: e.role,
      source,
      at: isoReq(e.createdAt),
      summary: e.rationale ?? '',
      snippet: si?.body ?? null,
      author: authorName(meta.author),
      isNew,
      confidence: e.confidence === 0.5 ? null : numToConf(e.confidence),
    };
  });
}

/** isNew is derived (created after the item was last seen); store an override when it disagrees. */
export function evidenceNewOverride(ev: Evidence, itemSeenAt: string | null): Override<'true' | 'false', 'true' | 'false'> | null {
  const derived = !!itemSeenAt && Date.parse(ev.at) > Date.parse(itemSeenAt);
  return derived === ev.isNew ? null : { value: ev.isNew ? 'true' : 'false', when: derived ? 'true' : 'false' };
}

export async function insertEvidence(w: WriteCtx, ev: Evidence, itemSeenAt: string | null, createdBy: 'user' | 'engine' | 'chat' | 'connector' | 'system' = 'engine'): Promise<string> {
  const id = uuidFor(ev.id);
  const srcId = uuidFor(`source:${ev.id}`);
  await w.tx.insert(sourceItems).values({
    id: srcId,
    ownerUserId: w.userId,
    source: sourceToDb(ev.source.kind),
    kind: sourceItemKind(ev.source.kind),
    externalId: ev.source.externalId ?? `evidence:${ev.id}`,
    dedupeKey: `cc.evidence:${ev.id}`,
    contentHash: hashKey(ev.summary, ev.snippet),
    occurredAt: toDate(ev.source.at ?? ev.at)!,
    title: ev.source.label,
    url: ev.source.url ?? null,
    body: ev.snippet,
    meta: { label: ev.source.label, author: ev.author, sourceAt: ev.source.at ?? null, externalId: ev.source.externalId ?? null },
  });
  await w.tx.insert(workItemEvidence).values({
    id,
    workItemId: uuidFor(ev.workItemId),
    sourceItemId: srcId,
    role: ev.role,
    confidence: ev.confidence ? confToNum(ev.confidence) : 0.5,
    extractorId: w.extractorId,
    rationale: ev.summary,
    createdBy,
    createdAt: toDate(ev.at)!,
    updatedAt: toDate(ev.at)!,
  });
  const o = evidenceNewOverride(ev, itemSeenAt);
  await writeExt(w, 'work_item_evidence', id, o ? { isNew: o } : null);
  return id;
}

export async function updateEvidence(w: WriteCtx, cur: Evidence, next: Evidence, itemSeenAt: string | null) {
  const id = uuidFor(cur.id);
  if (cur.workItemId !== next.workItemId) {
    await w.tx.update(workItemEvidence).set({ workItemId: uuidFor(next.workItemId) }).where(eq(workItemEvidence.id, id));
  }
  const o = evidenceNewOverride(next, itemSeenAt);
  await writeExt(w, 'work_item_evidence', id, o ? { isNew: o } : null);
}

// ---------------------------------------------------------------------------
// Initiatives
// ---------------------------------------------------------------------------

const INI_LOCK: Record<string, string> = { title: 'title', purpose: 'purpose', summary: 'background_summary', status: 'status' };
const INI_LOCK_REV = Object.fromEntries(Object.entries(INI_LOCK).map(([f, c]) => [c, f]));

export async function loadInitiatives(rc: ReadCtx): Promise<Initiative[]> {
  const rows = await rc.db.select().from(initiatives).where(eq(initiatives.ownerUserId, rc.userId)).orderBy(asc(initiatives.createdAt), asc(initiatives.id));
  if (!rows.length) return [];
  const links = await rc.db
    .select()
    .from(initiativeLinks)
    .where(inArray(initiativeLinks.initiativeId, rows.map((r) => r.id)))
    .orderBy(asc(initiativeLinks.createdAt), asc(initiativeLinks.id));
  return rows.map((r) => {
    const x = ext<{ timeline: Initiative['timeline'] }>(rc, 'initiatives', r.id);
    const ls = links.filter((l) => l.initiativeId === r.id);
    return {
      id: r.id,
      version: r.version,
      title: r.title,
      purpose: r.purpose,
      summary: r.backgroundSummary ?? '',
      status: r.status,
      accountId: r.accountId,
      oppId: r.opportunityId,
      targetEventId: r.targetEventId,
      people: ls.filter((l) => l.personId).map((l) => personRef(rc, l.personId)!),
      assetIds: ls.filter((l) => l.assetId).map((l) => l.assetId!),
      timeline: x.timeline ?? [],
      userLockedFields: r.userLockedFields.map((c) => INI_LOCK_REV[c]).filter((f): f is Initiative['userLockedFields'][number] => !!f),
      createdAt: isoReq(r.createdAt),
      updatedAt: isoReq(r.updatedAt),
    };
  });
}

export async function insertInitiative(w: WriteCtx, ini: Initiative, hasAsset: (id: string) => boolean): Promise<string> {
  const id = uuidFor(ini.id);
  await w.tx.insert(initiatives).values({
    id,
    ownerUserId: w.userId,
    title: ini.title,
    purpose: ini.purpose,
    backgroundSummary: ini.summary,
    status: ini.status,
    accountId: uuidOrNull(ini.accountId),
    opportunityId: uuidOrNull(ini.oppId),
    targetEventId: uuidOrNull(ini.targetEventId),
    createdBy: 'engine',
    userLockedFields: ini.userLockedFields.map((f) => INI_LOCK[f]!).sort(),
    version: ini.version,
    createdAt: toDate(ini.createdAt)!,
    updatedAt: toDate(ini.updatedAt)!,
  });
  let i = 0;
  const at = () => new Date(Date.parse(ini.createdAt) + i++);
  const values: (typeof initiativeLinks.$inferInsert)[] = [
    ...ini.people.map((p) => ({ initiativeId: id, personId: uuidFor(p.id), role: 'stakeholder' as const, method: 'user' as const, confidence: 1, createdAt: at() })),
    ...ini.assetIds.filter(hasAsset).map((a) => ({ initiativeId: id, assetId: uuidFor(a), role: 'asset' as const, method: 'user' as const, confidence: 1, createdAt: at() })),
  ];
  if (values.length) await w.tx.insert(initiativeLinks).values(values).onConflictDoNothing();
  await writeExt(w, 'initiatives', id, { timeline: ini.timeline });
  return id;
}

// ---------------------------------------------------------------------------
// Proposals (change_proposals; one row per field, grouped by group_id into one contract Proposal)
// ---------------------------------------------------------------------------

/** Proposal metadata the rows can't carry (source chip, actor, the contract field names). */
interface ProposalExt {
  actor: Proposal['actor'];
  source: SourceRef | null;
  label: string;
  /** Display labels of the changed fields (seeded proposals carry them; engine proposals don't). */
  labels: Record<string, string>;
}

const PROPOSAL_ENTITY: Record<string, Proposal['entity']['type']> = { work_items: 'work_item', drafts: 'draft', initiatives: 'initiative', activity_entries: 'activity_entry', priority_policies: 'policy' };
export const PROPOSAL_TABLE: Record<string, string> = Object.fromEntries(Object.entries(PROPOSAL_ENTITY).map(([t, e]) => [e, t]));

/** db column value → contract value for a proposal line. */
function contractValue(table: string, column: string, v: unknown): { field: string; value: unknown } {
  if (table === 'work_items') {
    const field = COLUMN_FIELD[column] ?? column;
    if (column === 'status' && typeof v === 'string') return { field, value: stateFromDb(v as DbWorkStatus, false) };
    if (column === 'kind' && typeof v === 'string') return { field, value: kindFromDb(v as DbWorkKind) };
    if ((column === 'due_at' || column === 'deadline_event_id') && v) return { field, value: column === 'due_at' ? iso(v as string) : v };
    return { field, value: v ?? null };
  }
  if (table === 'drafts' && column === 'doc_json') return { field: 'doc', value: v };
  return { field: column, value: v ?? null };
}

export async function loadProposals(rc: ReadCtx, labelOf: (type: Proposal['entity']['type'], id: string) => string): Promise<Proposal[]> {
  const rows = await rc.db
    .select({ p: changeProposals, si: sourceItems })
    .from(changeProposals)
    .leftJoin(sourceItems, eq(sourceItems.id, changeProposals.sourceItemId))
    .where(eq(changeProposals.ownerUserId, rc.userId))
    .orderBy(asc(changeProposals.createdAt), asc(changeProposals.field));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!groups.has(r.p.groupId)) groups.set(r.p.groupId, []);
    groups.get(r.p.groupId)!.push(r);
  }
  const out: Proposal[] = [];
  for (const [groupId, rs] of groups) {
    const first = rs[0]!.p;
    const x = ext<ProposalExt>(rc, 'change_proposals', groupId);
    const type = PROPOSAL_ENTITY[first.entityType] ?? 'work_item';
    const changes: FieldChange[] = [];
    for (const { p } of rs) {
      const before = contractValue(p.entityType, p.field, p.currentValue);
      const after = contractValue(p.entityType, p.field, p.proposedValue);
      if (p.field === 'lead_time_minutes') continue; // folded into effort below
      if (p.field === 'effort_minutes') continue;
      const label = x.labels?.[before.field] ?? (before.field === 'doc' ? FIELD_LABEL.doc : undefined);
      changes.push({ field: before.field, ...(label ? { label } : {}), before: before.value, after: after.value });
    }
    if (!changes.length) continue;
    const statuses = rs.map((r) => r.p.status);
    const status: Proposal['status'] = statuses.includes('pending')
      ? 'pending'
      : statuses.includes('accepted')
        ? 'applied'
        : statuses.includes('rejected')
          ? 'rejected'
          : 'superseded';
    const si = rs.find((r) => r.si)?.si;
    const meta = (si?.meta ?? {}) as { label?: string };
    const siUrl = si ? sourceItemUrl({ source: si.source, externalId: si.externalId, url: si.url, meta: si.meta as Record<string, unknown> }) : null;
    const source: SourceRef | null = x.source ?? (si ? { kind: sourceFromDb(si.source), label: meta.label ?? si.title ?? 'Source', ...(siUrl ? { url: siUrl } : {}) } : null);
    out.push({
      id: groupId,
      entity: { type, id: first.entityId, label: x.label ?? labelOf(type, first.entityId) },
      changes,
      reason: first.reason,
      source,
      createdAt: isoReq(first.createdAt),
      status,
      actor: x.actor ?? 'engine',
      baseVersion: first.baseVersion || null,
      textDiff: docDiff(rs.map((r) => r.p)),
      resolvedAt: iso(rs.map((r) => r.p.decidedAt).filter(Boolean).sort().pop() ?? null),
    });
  }
  return out;
}

function docDiff(rows: (typeof changeProposals.$inferSelect)[]): Proposal['textDiff'] {
  const doc = rows.find((r) => r.entityType === 'drafts' && r.field === 'doc_json');
  if (!doc) return null;
  const text = (v: unknown) => (v && typeof v === 'object' ? docPlainText(v as never) : '');
  return textDiff(text(doc.currentValue), text(doc.proposedValue));
}

/** Seed / import a contract proposal verbatim (one row per change, shared group id = proposal id). */
export async function insertProposal(w: WriteCtx, p: Proposal): Promise<string> {
  const groupId = uuidFor(p.id);
  const table = PROPOSAL_TABLE[p.entity.type];
  if (!table) throw new Error(`proposal ${p.id}: unsupported entity ${p.entity.type}`);
  let sourceItemId: string | null = null;
  if (p.source) {
    sourceItemId = uuidFor(`source:${p.id}`);
    await w.tx
      .insert(sourceItems)
      .values({
        id: sourceItemId,
        ownerUserId: w.userId,
        source: sourceToDb(p.source.kind),
        kind: sourceItemKind(p.source.kind),
        externalId: p.source.externalId ?? `proposal:${p.id}`,
        dedupeKey: `cc.proposal:${p.id}`,
        contentHash: hashKey(p.reason),
        occurredAt: toDate(p.source.at ?? p.createdAt)!,
        title: p.source.label,
        url: p.source.url ?? null,
        meta: { label: p.source.label },
      })
      .onConflictDoNothing();
  }
  const status = p.status === 'applied' ? 'accepted' : p.status;
  for (const c of p.changes) {
    const column = table === 'work_items' ? (WORK_FIELD_COLUMN[c.field] ?? c.field) : table === 'drafts' && c.field === 'doc' ? 'doc_json' : c.field;
    const toDb = (v: unknown) => (table === 'work_items' && column === 'status' && typeof v === 'string' ? stateToDb(v as WorkItemRecord['state']) : v);
    await w.tx.insert(changeProposals).values({
      id: p.changes.length === 1 ? groupId : uuidFor(`${p.id}:${c.field}`),
      ownerUserId: w.userId,
      entityType: table,
      entityId: uuidFor(p.entity.id),
      field: column,
      groupId,
      currentValue: (toDb(c.before) ?? null) as never,
      proposedValue: (toDb(c.after) ?? null) as never,
      reason: p.reason,
      sourceItemId,
      baseVersion: p.baseVersion ?? 0,
      status,
      decidedAt: toDate(p.resolvedAt),
      createdAt: toDate(p.createdAt)!,
    });
  }
  const labels = Object.fromEntries(p.changes.filter((c) => c.label).map((c) => [c.field, c.label!]));
  await writeExt(w, 'change_proposals', groupId, { actor: p.actor === 'engine' ? undefined : p.actor, source: null, label: p.entity.label, labels: Object.keys(labels).length ? labels : undefined });
  return groupId;
}

/** Ids of evidence rows for an item (for undo-safe resolution evidence references). */
export async function evidenceIdsFor(w: WriteCtx, itemId: string): Promise<string[]> {
  const rows = await w.tx.select({ id: workItemEvidence.id }).from(workItemEvidence).where(eq(workItemEvidence.workItemId, uuidFor(itemId))).orderBy(desc(workItemEvidence.createdAt));
  return rows.map((r) => r.id);
}
