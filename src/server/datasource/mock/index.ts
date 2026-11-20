/**
 * The in-memory mock DataSource (CC_DATA=mock, the default until the wiring wave).
 *
 * Behaves like the real backend will: optimistic-concurrency versions (409 conflict), an audit log with
 * inverse payloads + universal undo, user-locked fields (engine writes become Proposals), capture with
 * delayed enrichment, autosave, dry-run dispatch (never any external call), deterministic policy re-rank,
 * live SSE invalidation, and the scenario clock.
 */
import { nanoid } from 'nanoid';
import { eventLine, eventRow, type WorkOrderEvent } from '@/engines/activity/slackbot';
import { heldNotOnTeam, NOT_ON_TEAM_SKIP } from '@/engines/activity/classify';
import { loggingProfile, personaTargetH, withPersonaTarget } from '@/engines/activity/persona';
import { healthForPersona, personaOf } from '@/personas';
import { personaSwitched, reseededPolicy, timeWithoutRecordType } from '@/server/persona/switch';
import { canvasActionFor, canvasHolds, canvasInputOf, markCanvasHolds } from '@/lib/canvas/payload';
import { batchCanvases, batchSelectionOf, batchSpan } from '@/server/time/batch-canvases';
import { applyChanges, EMPTY_STORE, type LandingStore } from '@/lib/landings/model';
import { syncLandings, type LandingWorld } from '@/lib/landings/sync';
import { eventUpdatesForBatch, eventUpdatesView, patchEventUpdate, proposeEventUpdates } from '@/lib/landings/updates';
import { canvasWritesView, recordLandingsView, ucLandingsView } from '@/lib/landings/views';
import { fixEdits, labelsFor, pickEdit, UC_LEAVE } from '@/server/landings/ops';
import { withReauthCommand } from '@/server/datasource/reauth-command';
import { addDays, format, isSameDay, parseISO, setHours, setMinutes } from 'date-fns';
import type {
  AccountDetail,
  ActivityEntry,
  AccountRow,
  AddedOrg62Opp,
  ActionDestination,
  ClaimMissedRequest,
  Actor,
  AgentRun,
  Asset,
  AuditEntry,
  Brief,
  BriefHighlight,
  ChatMessage,
  ChatModel,
  ChatPart,
  ChatProposalStatus,
  ChatResource,
  ChatSseEvent,
  ChatThread,
  ContextRef,
  Connector,
  DispatchMode,
  Draft,
  EntityRef,
  EntityType,
  Evidence,
  EvidenceRole,
  InitiativeDetail,
  LiveEvent,
  LiveNotify,
  LiveTopic,
  MissedOpp,
  DcRequest,
  DealsNeed,
  NeedDecision,
  Opportunity,
  NbaCard,
  NbaPayload,
  PersonView,
  PolicyPreview,
  PolicyRule,
  PolicyWeights,
  PriorityPolicy,
  Proposal,
  Receipt,
  ReceiptChange,
  Resolution,
  ResolutionDetail,
  RouteInput,
  RouteKey,
  RouteOutput,
  ScenarioAction,
  ScenarioStatus,
  SearchHit,
  Seed,
  Settings,
  OnsiteDay,
  SourceRef,
  TimeWeek,
  TimelineLane,
  TipTapDoc,
  ToolRun,
  TriageItem,
  VdpBackfillRun,
  WorkItem,
  WorkItemDetail,
  WorkItemLockableField,
  WorkItemPatch as WorkItemPatchT,
  WorkItemRecord,
  WorkState,
} from '@/contract';
import { allowAssistantToday, budgetsForDay, raiseBudgetToday, raiseSummary, dcRoleFor, EntityType as EntityTypeSchema, ItemsQuery, requiredFieldKeys, SETTINGS_SECTION_SCHEMAS, vdpRefreshCommand, withPromotedAs, WorkItemPatch } from '@/contract';
import { validateInput } from '@/tools/manifest';
import { pickChatScript } from '@/mock/chat-script';
import { buildDefaultScenario, ScenarioPlayer, withLiveArrivals, type ScenarioHost } from '@/mock/scenario';
import type { ChatTurnRunner } from '@/llm/chat/types';
import { chatRunnerFor, mockWantsRunner } from '@/server/chat/backend';
import { createChatHost } from '@/server/chat/host';
import { withBriefSummary } from '@/server/chat/brief';
import { beginChatRun } from '@/server/chat/registry';
import { runTurn } from '@/server/chat/turn';
import { AppError, conflict, invalid, notFound } from '@/server/errors';
import { connectorOfName, normalizeScanScope, placeholderScopeId } from '@/scanner/scope-catalog';
import { featureActive } from '@/personas';
import { buildDealsPipeline, pipelineBasisOf } from '@/server/deals/pipeline';
import { dealsNeedsFor, needDecisionLabel, planNeedDecisions, vdpOppIdsOf, withMyDcFlag } from '@/server/deals/needs';
import { needDecisionOrder, needKey } from '@/lib/need-decisions';
import { patchedEntry, planDismissFromSource, planRemoveRule, rulesView } from '@/server/time/dismiss';
import { ucDecisionsOf, ucDuplicateGuard, ucHolds, ucSyncView } from '@/server/deals/use-cases';
import { planUseCases, type Org62UseCase, type UseCaseLink, type UseCasePlanInput } from '@/engines/activity/use-cases';
import { dcWaitingCount, ucWaitingCount, type WaitingForCanvas } from '@/lib/waiting-work';
import { planRecheck, type CanvasChecks } from '@/lib/canvas/checks';
import { pendingChatCards } from '@/server/chat/outputs';
import { linkVdp, onVdp } from '@/engines/vdp/gaps';
import { accountDcsOf, assertDcEditable, planWithdrawDcs, dcAddOf, dcAddRow, dcChangeRows, claimComment, DC_INACTIVE, dcHolds, dcLiveConflict, dcOppNotFound, dcOppNotInOrg62, dcRequestOrder, dcRequestView, dcRequestWords, liveDcRequest, myDcRowsOf, myDcsByOpp, ORG62_OPP_ID, org62OppIdOf, pendingDcAdds, planDcRequest, reconcileDcRequests, resolveDcOpp, spendNotCreated, type DcAdd, type DcRequestRecord } from '@/server/deals/dc-requests';
import type { DataSource } from '../types';
import { MemoryEventBus } from './bus';
import { getHomeMock } from './home';
import type { ChatOps, ChatPatchResult, ChatScriptContext } from './chat-runtime';
import { MockChatBe6, type MockChatKit } from './chat-be6';
import { MockClock } from './clock';
import { MockOutbox, mockPreflightContext } from './outbox';
import { LOG_AGAIN_FLAG } from '@/engines/activity/org62-check';
import { inTimeWeek, timeWeekBounds, weekTotals } from '@/server/time/week';
import { resolvedEntry, resolvedSummary } from '@/server/time/relog';
import { isPendingLogCanvas, preflightDraft, preflightUseCases, restagedCanvas } from '@/server/time/canvas-preflight';
import { assertReviewable, canvasReviewOf, checkedUpdateValue, checkedUseCaseFields, reviewRowOf, updateLineWith, ucCreateOfRow, withoutRows, withRowReplaced } from '@/server/time/canvas-review';
import { ucCreateLine, withUcOverride } from '@/engines/activity/use-cases';
import { rowOverridesOf } from '@/lib/canvas/overrides';
import { isClosedItemState, isWithdrawableDraft, withdrawnReason } from '@/outbox/withdraw';
import { sendingConfirmNeeded } from '@/outbox/settings';
import { docFromText, payloadFor, plainText, previewHtml, renderAll, renditionFor, textDiff } from './render';
import { MOCK_VDP_BASE, mockAccountHierarchy, mockBackfillFinds, mockCompanySearch, mockIdentityJudgments, mockIdentityOverrides, mockOrg62UseCaseDemo, mockSpecialistAes, mockVdpCandidates, mockVdpServer, mockVdpSnapshots } from '@/mock/vdp';
import { identityIn, nextOverrides, overrideFrom, searchCompaniesLocal, searchResult, withoutOverride } from '@/server/vdp/identity';
import { resolveCompanyIdentity } from '@/engines/vdp/identity';
import type { AccountHierarchy } from '@/lib/accounts/hierarchy';
import { vdpDraftRefs, vdpHomeOf, vdpNeedYouCount } from '@/engines/vdp/status';
import { inVdp, screenCandidates } from '@/engines/vdp/assets';
import { assetTargets, candidateKey, checkTransition, effectiveSlug, slugByAccount, vdpDetailFrom, type CandidateRecord } from '@/server/vdp/detail';
import { expectedRunUsd, planFindAssets, targetForKey, vdpDetailCandidate } from '@/server/vdp/find';
import { chatLimitsFromEnv } from '@/server/chat/outputs';
import type { VdpServerInfo, VdpSnapshot } from '@/lib/vdp/types';
import { actionDraftFor, gapEntities, vdpActionFor, vdpActionForItem, vdpCoverageAndQueue, vdpCoverageFrom, type CoverageAutopilot } from '@/server/vdp/coverage';
import { runVdpAutopilot, type AutopilotPort, type AutopilotRunResult } from '@/server/vdp/autopilot';
import { startVdpPush, type PushRoutePort } from '@/server/vdp/push';
import type { VdpPushRun } from '@/contract';
import { autopilotHealth, EMPTY_LEDGER, type AutopilotLedger } from '@/engines/vdp/autopilot';
import { localDay as vdpLocalDay } from '@/engines/activity/time';
import { sendingOf as sendingSection } from '@/outbox/settings';
import { actionSummary } from '@/lib/actions';
import { diagnoseFeedback, feedbackState, stageFeedback, type FeedbackHost } from '@/server/feedback'; // lane D
import { scrubTermsFrom } from '@/server/feedback/scrub'; // lane D
import { computeRanking, priorityFor, scoreItem, storedOrder, toRankRows } from './rank';
import { MockReadIns } from './readin';
import { mockHistorySources } from './history';
import { composeHistoryDay, composeHistoryMonth } from '@/server/history/compose';
import { eventDetail } from '@/server/calendar/detail';
import { MockOnboarding } from './onboarding';
import { MockForecast } from './forecast'; // lane A
import { buildInfo, versionPayload } from '@/server/version';
import { guidePayload } from '@/guide/checklist';
import { readReadme } from '@/server/guide';
import { loadSeed, type LoadedSeed } from './seed-loader';
import { COLLECTION_TOPICS, MockAuditLog, planUndo, Store, Tx, type CollectionName, type Collections, type RowOp } from './store';
import { CLOSED_WINDOW_DAYS } from '@/engines/home/closed';
import { activityStamps, buildActivityLog } from '../activity-log';
import { buildTimeLedger } from '../time-ledger';
import { appliedAtOf, logCanvasesOf } from '../log-canvases';
import { buildOppOptions } from '@/lib/opp-options';
import { withSuggestions, type StoredSuggestion, type SuggestContext } from '@/lib/time-suggest';
import { MOCK_ORG62_OPPS, mockAccountIdFor, mockOppIdFor, mockOrg62IdFor, searchMockOrg62Opps } from '@/mock/org62-opps';
import { org62RecordUrl } from '@/projections/links';
import { quarterTotal } from '../db/quarter';
import { buildItems, buildOutbox, buildSince, buildToday, buildTriage, fmtHM, healthSummary, hrefFor, hydrateItem, isLive, isMyOpp, itemRef, nowCardFor, sweptOppIds, windowOrToday } from './views';
import { baseCandidates, buildDraftSource, slackLabels } from '../draft-source';
import { buildEvidencePayload, whyMentionNames, whyTexts } from '../evidence-view';
import { mockSpendAudit, mockSpendAuditDetail } from './spend-audit';

type I<K extends RouteKey> = RouteInput<K>;
type Res<K extends RouteKey> = RouteOutput<K>;

export interface MockDelays {
  /** Capture → enrichment chips. */
  enrichMs: number;
  /** Tool run / agent simulation steps. */
  stepMs: number;
  /** Chat text-delta cadence. */
  chatTokenMs: number;
  /** Simulated send → read-back verification. */
  verifyMs: number;
  /** Re-evaluation shimmer duration. */
  reevalMs: number;
}

const DEFAULT_DELAYS: MockDelays = { enrichMs: 3000, stepMs: 1500, chatTokenMs: 18, verifyMs: 2000, reevalMs: 1500 };

export interface MockOptions {
  seed?: Seed;
  seedPath?: string;
  delays?: Partial<MockDelays>;
  /** Overrides CC_SCENARIO=1. */
  autoplay?: boolean;
  /** BE-READIN: seed the demo read-ins (the app's DataSource turns it on; tests and db:seed leave it off). */
  readinDemo?: boolean;
  /** D-70: a placeholder Org62 read-back of use cases (src/mock/vdp.ts mockOrg62UseCaseDemo; the app's turns it on). */
  useCaseDemo?: boolean;
  clockMode?: string;
  /** BE-CHAT: the runner for the chat intents (default: the deterministic fake model). */
  chatRunner?: ChatTurnRunner;
}

interface TxMeta {
  actor: Actor;
  action: string;
  summary: string;
  entity: EntityRef;
  related?: EntityRef[];
  undoable?: boolean;
  /** false: no audit entry (read markers, simulations). */
  audit?: boolean;
  coalesceKey?: string;
  undoOf?: string | null;
  stepId?: string;
  notify?: LiveNotify;
}

const COL_TYPE: Record<CollectionName, EntityType> = {
  meta: 'settings',
  settings: 'settings',
  spend: 'settings',
  people: 'person',
  accounts: 'account',
  opps: 'opportunity',
  missedOpps: 'missed_opp',
  initiatives: 'initiative',
  workItems: 'work_item',
  evidence: 'work_item',
  nbas: 'nba',
  drafts: 'draft',
  proposals: 'proposal',
  assets: 'asset',
  events: 'calendar_event',
  slots: 'calendar_event',
  agentRuns: 'agent_run',
  toolAdapters: 'tool_adapter',
  toolRuns: 'tool_run',
  activity: 'activity_entry',
  timeBlocks: 'calendar_event',
  briefs: 'brief',
  watches: 'watch',
  connectors: 'connector',
  scanRuns: 'connector',
  jobs: 'job',
  eventLog: 'event_log',
  chatThreads: 'chat_thread',
  mappings: 'triage_mapping',
  policyVersions: 'policy',
  dcRequests: 'opportunity',
  needDecisions: 'opportunity',
  timeDismissRules: 'activity_entry',
  vdpIdentity: 'vdp',
  rowOverrides: 'draft',
};

const ITEM_PATCH_LOCK: Record<string, WorkItemLockableField> = {
  title: 'title',
  purpose: 'purpose',
  due: 'due',
  startBy: 'startBy',
  effort: 'effort',
  notes: 'notes',
  initiativeId: 'initiativeId',
  accountId: 'accountId',
  oppId: 'oppId',
  kind: 'kind',
};

/** Human labels for receipt / proposal lines (chat edits). */
const ITEM_FIELD_LABEL: Record<string, string> = {
  title: 'Title',
  purpose: 'Purpose',
  due: 'Due',
  startBy: 'Start by',
  effort: 'Effort',
  notes: 'Notes',
  initiativeId: 'Initiative',
  accountId: 'Account',
  oppId: 'Opportunity',
  kind: 'Kind',
  state: 'State',
  resolution: 'Resolution',
};

const id = (prefix: string) => `${prefix}_${nanoid(10)}`;
/** Scenario patches say '__now__' for "the scenario clock's now". */
const nowIn = (patch: Record<string, unknown>, now: string): Record<string, unknown> => Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === '__now__' ? now : v]));
const uniq = <T>(xs: T[]) => [...new Set(xs)];

function labelOf(v: unknown): string {
  const o = v as Record<string, unknown> | null;
  if (!o) return '';
  return String(o.title ?? o.name ?? o.label ?? (o.thread as { title?: string } | undefined)?.title ?? (o.manifest as { name?: string } | undefined)?.name ?? o.id ?? '');
}

export class MockDataSource implements DataSource, ScenarioHost {
  readonly kind = 'mock' as const;
  readonly bus: MemoryEventBus;
  readonly clock: MockClock;
  readonly delays: MockDelays;
  readonly loaded: LoadedSeed;
  store!: Store;
  audit!: MockAuditLog;
  scenario: ScenarioPlayer;
  /** BE-OUTBOX: delivery (dry-run record, or the simulated adapters with dry-run off). */
  readonly outbox: MockOutbox = this.createOutbox();
  private snapshot: Seed;
  /** BE-READIN: deterministic read-ins (mock/readin.ts). */
  readins: MockReadIns | null = null;
  /** B-079: onboarding, reachable for development and never required (mock/onboarding.ts). */
  readonly onboarding = new MockOnboarding({
    now: () => this.now(),
    settings: () => this.store.settings(),
    connectors: () => this.store.all('connectors'),
    patchSettings: (i) => this.patchSettings(i),
    applyPolicy: (i) => this.applyPolicy(i),
  });
  /** Lane A: Time ▸ Forecast over placeholder Specialist Forecasts (mock/forecast.ts). */
  readonly forecast = new MockForecast({ now: () => this.now(), store: () => this.store, newId: (p) => id(p), putDraft: (d, summary) => ({ auditId: this.tx({ actor: 'user', action: 'forecast.stage', summary: summary.slice(0, 200), entity: { type: 'draft', id: d.id, label: d.destination.kind === 'action' ? d.destination.target.label : 'Forecast canvas' } }, (tx) => tx.put('drafts', d)).entry?.id ?? null }), rendered: (dest, doc) => renderAll(dest, doc), publish: (ids, reason) => this.publish(['time', 'home'], ids, reason), later: (ms, fn) => this.later(ms, fn), checkMs: () => this.delays.stepMs });
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private devFailRate = 0;
  /** BE-CHAT: chat plans, scans, drafts, sessions and spend for the chat runner. */
  readonly be6: MockChatBe6;
  private readonly chatRunner: ChatTurnRunner;

  constructor(opts: MockOptions = {}) {
    this.loaded = opts.seed ? { seed: opts.seed, path: '(inline)', shiftedDays: 0 } : loadSeed({ path: opts.seedPath });
    this.snapshot = structuredClone(this.loaded.seed);
    // the read-side stamps (why a row is excluded, when it was logged / verified), as the db columns hold them
    this.snapshot.activity = this.snapshot.activity.map(activityStamps);
    this.clock = new MockClock(new Date(this.snapshot.meta.asOf), opts.clockMode);
    this.bus = new MemoryEventBus(this.clock);
    this.delays = { ...DEFAULT_DELAYS, ...opts.delays };
    this.be6 = new MockChatBe6(this.chatKit());
    this.chatRunner = opts.chatRunner ?? chatRunnerFor('mock');
    this.resetStore();
    this.readins = new MockReadIns(this, { demo: opts.readinDemo ?? false });
    this.useCaseDemo = opts.useCaseDemo ?? false;
    if (this.useCaseDemo) this.applyUseCaseDemo();
    this.readins.reset();
    // the live pass's arrivals (a draft, a suggestion, a Needs-you row, a run…) play with every scenario
    const events = withLiveArrivals(this.snapshot.scenario ?? buildDefaultScenario(this.store), this.store);
    const autoplay = opts.autoplay ?? process.env.CC_SCENARIO === '1';
    this.scenario = new ScenarioPlayer(this, events, this.snapshot.scenario ? 'seed' : 'default', autoplay);
    if (autoplay) this.scenario.play();
  }

  // =========================================================================
  // Infrastructure
  // =========================================================================

  dispose(): void {
    this.scenario.dispose();
    this.readins?.dispose();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  now(): Date {
    return this.clock.now();
  }
  private nowIso(): string {
    return this.now().toISOString();
  }

  failRate(): number {
    return this.devFailRate;
  }

  /** Reload the store from the seed snapshot (scenario reset/seek). Keeps the event bus and its seq. */
  resetStore(): void {
    this.store = new Store(structuredClone(this.snapshot));
    this.vdpCands = null;
    this.vdpServerInfo = null;
    this.vdpRuns = new Map();
    this.vdpLedger = EMPTY_LEDGER;
    this.vdpPush = null;
    this.vdpHierarchy = null;
    this.canvasChecks = {};
    // D-70: the landings start empty with the store; the first read backfills them from it (like the db's first sync)
    this.landingStore = EMPTY_STORE;
    // D-69: the placeholder mapping you made with Change… (Soylent Foods → Soylent Corporation), not an audited change
    for (const o of mockIdentityOverrides(this.store.all('accounts'), this.nowIso())) this.store.c.vdpIdentity.set(o.key, o);
    this.audit = new MockAuditLog();
    this.be6?.reset();
    for (const e of this.snapshot.audit) this.audit.importEntry({ ...e, undoable: false });
    // Engine closes in the seed become real, undoable audit entries (Closed for you → Undo).
    for (const w of this.store.all('workItems')) {
      if (w.state !== 'done' || w.doneBy !== 'engine') continue;
      const before = { ...w, state: 'open' as WorkState, doneAt: null, doneBy: null, closedReason: null };
      this.audit.importEntry(
        {
          id: `aud_seed_${w.id}`,
          at: w.doneAt ?? w.updatedAt,
          actor: 'engine',
          action: 'item.close',
          summary: `Closed for you: ${w.title}`,
          entity: itemRef(w),
          related: [],
          changes: [
            { field: 'state', before: 'open', after: 'done' },
            { field: 'closedReason', before: null, after: w.closedReason },
          ],
          undoable: true,
          undoneAt: null,
          undoOf: null,
        },
        [{ col: 'workItems', id: w.id, before, after: w, fields: ['state', 'doneAt', 'doneBy', 'closedReason'] }],
      );
    }
    this.audit.entries.sort((a, b) => a.at.localeCompare(b.at));
    this.rankAllDirect();
    this.readins?.reset();
  }

  private rankAllDirect() {
    const now = this.now();
    const policy = this.store.settings().policy;
    const scored = computeRanking(this.store, policy, now);
    const byId = new Map(scored.map((s, i) => [s.id, { ...s, rank: i + 1 }]));
    for (const w of this.store.all('workItems')) {
      const s = byId.get(w.id);
      this.store._set('workItems', s ? { ...w, rank: s.rank, score: s.score, rankReasons: s.reasons, priority: priorityFor(s.rank) } : { ...w, rank: null, score: null });
    }
    const meta = this.store.meta();
    this.store._set('meta', { ...meta, rankedAt: now.toISOString(), policyRankVersion: policy.version });
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      try {
        fn();
      } catch (err) {
        console.error('[mock] deferred task failed:', (err as Error).message);
      }
    }, Math.max(0, ms));
    (t as { unref?: () => void }).unref?.();
    this.timers.add(t);
  }

  private refFor(col: CollectionName, v: unknown): EntityRef {
    const o = v as Record<string, unknown>;
    const type = COL_TYPE[col];
    const rid = col === 'evidence' ? String(o.workItemId) : col === 'chatThreads' ? String((o.thread as { id: string }).id) : String(o.id ?? 'current');
    return { type, id: rid, label: labelOf(v) || rid, href: hrefFor({ type, id: rid }) };
  }

  /** Unit of work: apply fn, record audit (with inverse row images), publish live events. Rolls back on throw. */
  private tx<R>(m: TxMeta, fn: (tx: Tx) => R): { result: R; entry: AuditEntry | null; ops: RowOp[] } {
    const tx = new Tx(this.store);
    let result: R;
    try {
      result = fn(tx);
      // Undo / redo restore row images exactly (the db's undoChangeSet does too): no withdrawal there.
      if (!m.undoOf) this.withdrawClosedDrafts(tx);
    } catch (err) {
      for (const op of tx.ops().reverse()) {
        if (op.before === null) this.store._delete(op.col, op.id);
        else this.store._set(op.col, op.before as never);
      }
      throw err;
    }
    const ops = tx.ops();
    if (!ops.length) return { result, entry: null, ops };
    const entry =
      m.audit === false
        ? null
        : this.audit.record({
            at: this.nowIso(),
            actor: m.actor,
            action: m.action,
            summary: m.summary,
            entity: m.entity,
            related: m.related ?? uniq(ops.map((o) => `${o.col}:${o.id}`)).slice(0, 12).map((k) => {
              const op = ops.find((o) => `${o.col}:${o.id}` === k)!;
              return this.refFor(op.col, op.after ?? op.before);
            }).filter((r) => !(r.type === m.entity.type && r.id === m.entity.id)),
            ops,
            undoable: m.undoable ?? true,
            undoOf: m.undoOf ?? null,
            coalesceKey: m.coalesceKey,
          });
    this.publishOps(ops, m.action, m.stepId, m.notify, !!entry);
    return { result, entry, ops };
  }

  /**
   * OUTBOX-W (parity with the db's updateWorkItem): an item this unit of work moved into done / dismissed withdraws its
   * pending reply drafts in the same entry (src/outbox/withdraw.ts). Reopening does not bring them back.
   */
  private withdrawClosedDrafts(tx: Tx): void {
    const closed = tx
      .ops()
      .filter((o) => o.col === 'workItems' && o.before && o.after && isClosedItemState((o.after as WorkItemRecord).state) && !isClosedItemState((o.before as WorkItemRecord).state))
      .map((o) => o.after as WorkItemRecord);
    if (!closed.length) return;
    const now = this.nowIso();
    for (const item of closed) {
      const reason = withdrawnReason(item);
      for (const d of this.store.all('drafts')) {
        if (d.workItemId === item.id && isWithdrawableDraft(d)) tx.put('drafts', { ...d, status: 'discarded', rejectedReason: reason, version: d.version + 1, updatedAt: now });
      }
    }
  }

  private publishOps(ops: RowOp[], reason: string, stepId?: string, notify?: LiveNotify, audited?: boolean) {
    const byTopic = new Map<LiveTopic, Set<string>>();
    for (const op of ops) {
      const ref = this.refFor(op.col, op.after ?? op.before);
      for (const topic of COLLECTION_TOPICS[op.col]) {
        if (!byTopic.has(topic)) byTopic.set(topic, new Set());
        byTopic.get(topic)!.add(ref.id);
      }
    }
    if (audited) byTopic.set('audit', new Set(ops.map((o) => o.id)));
    let first = true;
    for (const [topic, ids] of byTopic) {
      this.bus.publish({ topic, ids: [...ids], reason, ...(stepId ? { scenarioStepId: stepId } : {}), ...(first && notify ? { notify } : {}) });
      first = false;
    }
  }

  private publish(topics: LiveTopic[], ids: string[], reason: string) {
    for (const topic of topics) this.bus.publish({ topic, ids, reason });
  }

  private receiptFrom(entry: AuditEntry | null, ops: RowOp[], actor: Actor, summary: string, filter?: (op: RowOp, field: string) => boolean): Receipt | undefined {
    if (!entry) return undefined;
    const changes: ReceiptChange[] = [];
    for (const op of ops) {
      if (!op.before || !op.after) continue;
      for (const f of op.fields) {
        if (['version', 'updatedAt', 'savedAt', 'rendered', 'doc', 'rankReasons', 'score', 'priority'].includes(f)) continue;
        if (filter && !filter(op, f)) continue;
        changes.push({
          auditId: entry.id,
          entity: this.refFor(op.col, op.after),
          field: f,
          before: (op.before as Record<string, unknown>)[f] ?? null,
          after: (op.after as Record<string, unknown>)[f] ?? null,
        });
      }
    }
    return { id: id('rcpt'), at: entry.at, actor, summary, changes, staged: false };
  }

  private checkVersion(cur: { version: number }, ifVersion: number | undefined, what: string, current: unknown) {
    if (ifVersion !== undefined && cur.version !== ifVersion) throw conflict(what, current);
  }

  private item(id: string): WorkItemRecord {
    return this.store.must('workItems', id, 'Work item');
  }

  private addEvidence(tx: Tx, workItemId: string, role: EvidenceRole, source: SourceRef, summary: string, isNew = true): Evidence {
    const ev: Evidence = {
      id: id('ev'),
      workItemId,
      role,
      source: { ...source, at: source.at ?? this.nowIso() },
      at: this.nowIso(),
      summary,
      snippet: null,
      author: null,
      isNew,
      confidence: null,
    };
    return tx.put('evidence', ev);
  }

  private flashReevaluating(itemId: string) {
    this.tx({ actor: 'engine', action: 'item.reevaluate', summary: 'Re-evaluating', entity: { type: 'work_item', id: itemId, label: itemId }, audit: false }, (tx) =>
      tx.update('workItems', itemId, (w) => ({ ...w, reevaluating: true })),
    );
    this.later(this.delays.reevalMs, () => {
      if (!this.store.get('workItems', itemId)) return;
      this.tx({ actor: 'engine', action: 'item.reevaluated', summary: 'Re-evaluated', entity: { type: 'work_item', id: itemId, label: itemId }, audit: false }, (tx) =>
        tx.update('workItems', itemId, (w) => ({ ...w, reevaluating: false })),
      );
    });
  }

  private bump<T extends { version: number; updatedAt?: string }>(v: T): T {
    return { ...v, version: v.version + 1, ...('updatedAt' in v ? { updatedAt: this.nowIso() } : {}) };
  }

  // =========================================================================
  // Engine-style writes (scenario, chat, dev) — respect user locks
  // =========================================================================

  /** Apply an engine patch to a work item; locked fields become Proposals. */
  engineUpdateItem(itemId: string, patch: Record<string, unknown>, reason: string, opts: { actor?: Actor; state?: WorkState; evidence?: SourceRef; stepId?: string } = {}) {
    const cur = this.item(itemId);
    const actor = opts.actor ?? 'engine';
    const applied: string[] = [];
    const proposalIds: string[] = [];
    const locked = new Set<string>(cur.userLockedFields);
    const { entry } = this.tx({ actor, action: 'item.engine_update', summary: `${reason}: ${cur.title}`, entity: itemRef(cur), stepId: opts.stepId }, (tx) => {
      let next: WorkItemRecord = { ...cur };
      const fields: Record<string, unknown> = { ...patch, ...(opts.state ? { state: opts.state } : {}) };
      for (const [f, v] of Object.entries(fields)) {
        if (locked.has(f)) {
          proposalIds.push(this.propose(tx, { type: 'work_item', id: cur.id, label: cur.title }, [{ field: f, before: (cur as Record<string, unknown>)[f] ?? null, after: v }], reason, cur.version, actor, opts.evidence ?? null));
        } else {
          next = { ...next, [f]: v } as WorkItemRecord;
          applied.push(f);
        }
      }
      if (opts.state === 'in_progress' && next.deliverable) {
        next = {
          ...next,
          deliverable: {
            ...next.deliverable,
            lastEditedAt: this.nowIso(),
            lastEditedBy: this.store.meta().user.name,
            changedSinceCreated: true,
            diffSummary: reason,
            judgment: next.deliverable.judgment ? { ...next.deliverable.judgment, verdict: 'in_progress' } : null,
          },
        };
      }
      if (opts.evidence) {
        this.addEvidence(tx, cur.id, opts.state === 'done' ? 'completion' : 'progress', opts.evidence, reason);
        next = { ...next, newEvidenceCount: next.newEvidenceCount + 1 };
      }
      if (applied.length || opts.evidence) tx.put('workItems', this.bump(next));
    });
    if (opts.evidence) this.flashReevaluating(itemId);
    return { applied, proposalIds, auditId: entry?.id ?? null };
  }

  private propose(tx: Tx, entity: EntityRef, changes: Proposal['changes'], reason: string, baseVersion: number | null, actor: Proposal['actor'] | Actor, source: SourceRef | null, textDiffOps?: Proposal['textDiff']): string {
    for (const p of this.store.all('proposals')) {
      if (p.status === 'pending' && p.entity.type === entity.type && p.entity.id === entity.id && p.changes.some((c) => changes.some((n) => n.field === c.field))) {
        tx.put('proposals', { ...p, status: 'superseded', resolvedAt: this.nowIso() });
      }
    }
    const pActor: Proposal['actor'] = actor === 'chat' || actor === 'connector' || actor === 'scenario' ? actor : 'engine';
    const p: Proposal = {
      id: id('prop'),
      entity,
      changes,
      reason,
      source,
      createdAt: this.nowIso(),
      status: 'pending',
      actor: pActor,
      baseVersion,
      textDiff: textDiffOps ?? null,
      resolvedAt: null,
    };
    tx.put('proposals', p);
    return p.id;
  }

  /** New info revises an NBA's draft (in place if untouched, else a Proposal). */
  engineReviseDraft(nbaId: string, appendText: string, reason: string, source: SourceRef | undefined, opts: { actor?: Actor; stepId?: string } = {}) {
    const nba = this.store.must('nbas', nbaId, 'NBA');
    const draft = nba.draftId ? this.store.get('drafts', nba.draftId) : undefined;
    const actor = opts.actor ?? 'engine';
    this.tx({ actor, action: 'nba.revise', summary: `NBA updated: ${reason}`, entity: { type: 'nba', id: nba.id, label: nba.title }, stepId: opts.stepId }, (tx) => {
      let update: NbaCard['update'] = { at: this.nowIso(), reason, kind: 'revised', proposalId: null, diffSummary: `+ ${appendText}`, source: source ?? null };
      if (draft) {
        const newText = `${draft.plainText}\n\n${appendText}`;
        const newDoc = docFromText(newText);
        if (draft.userTouched) {
          const pid = this.propose(tx, { type: 'draft', id: draft.id, label: 'Draft body' }, [{ field: 'doc', label: 'Draft body', before: draft.doc, after: newDoc }], `New info: ${reason}`, draft.version, actor, source ?? null, textDiff(draft.plainText, newText));
          update = { ...update, kind: 'proposal', proposalId: pid };
        } else {
          tx.put('drafts', this.bump({ ...draft, doc: newDoc, plainText: plainText(newDoc), rendered: renderAll(draft.destination, newDoc) }));
        }
      }
      const nextVersion = update.kind === 'revised' ? nba.version + 1 : nba.version;
      tx.put('nbas', {
        ...nba,
        version: nextVersion,
        update,
        versions: update.kind === 'revised' ? [...nba.versions, { version: nextVersion, at: this.nowIso(), reason, diffSummary: update.diffSummary }] : nba.versions,
      });
      const item = this.store.get('workItems', nba.workItemId);
      if (item) {
        if (source) this.addEvidence(tx, item.id, 'context', source, reason);
        tx.put('workItems', this.bump({ ...item, newEvidenceCount: item.newEvidenceCount + 1 }));
      }
    });
    this.flashReevaluating(nba.workItemId);
  }

  engineCloseItem(itemId: string, reason: string, evidence: SourceRef, opts: { actor?: Actor; stepId?: string; resolution?: Resolution; personName?: string } = {}) {
    const cur = this.item(itemId);
    if (cur.userLockedFields.includes('state')) return this.engineUpdateItem(itemId, {}, reason, { ...opts, state: 'done', evidence });
    const { entry } = this.tx({ actor: opts.actor ?? 'engine', action: 'item.close', summary: `Closed for you: ${cur.title}`, entity: itemRef(cur), stepId: opts.stepId }, (tx) => {
      const ev = this.addEvidence(tx, cur.id, 'completion', evidence, reason);
      const resolution = opts.resolution ?? 'done_by_me';
      const person = opts.personName ? this.store.all('people').find((p) => p.name === opts.personName) : undefined;
      tx.put('workItems', this.bump({
        ...cur,
        state: 'done',
        doneAt: this.nowIso(),
        doneBy: 'engine',
        closedReason: reason,
        likelyDone: null,
        waiting: null,
        resolution,
        resolutionDetail: { inferred: true, evidenceIds: [ev.id], ...(opts.personName ? { personName: opts.personName } : {}), ...(person ? { personId: person.id } : {}) },
        involvement: resolution === 'handed_off' ? 'watcher' : cur.involvement,
      }));
    });
    return { applied: ['state'], proposalIds: [], auditId: entry?.id ?? null };
  }

  engineReopen(itemId: string, reason: string, source: SourceRef, opts: { actor?: Actor; stepId?: string } = {}) {
    const cur = this.item(itemId);
    this.tx({ actor: opts.actor ?? 'engine', action: 'item.reopen', summary: `Reopened: ${cur.title}`, entity: itemRef(cur), stepId: opts.stepId }, (tx) => {
      this.addEvidence(tx, cur.id, 'origin', source, reason);
      tx.put('workItems', this.bump({ ...cur, state: 'reopened', doneAt: null, doneBy: null, closedReason: null, resolution: null, resolutionDetail: null, reopened: { reason, at: this.nowIso(), from: source }, newEvidenceCount: cur.newEvidenceCount + 1 }));
    });
  }

  /** R-UI-22: a direct ask of me on a handed-off item reopens it and re-involves me. */
  engineLoopBack(itemId: string, byPersonName: string, reason: string, source: SourceRef, opts: { actor?: Actor; stepId?: string } = {}) {
    const cur = this.item(itemId);
    if (cur.resolution !== 'handed_off' && cur.involvement !== 'watcher' && cur.involvement !== 'not_involved') {
      throw invalid('Loop-back applies to handed-off items (resolution handed_off or involvement watcher/not_involved)');
    }
    const label = `Looped back in: ${byPersonName} asked you directly`;
    this.tx({ actor: opts.actor ?? 'engine', action: 'item.loop_back', summary: `${label}: ${cur.title}`, entity: itemRef(cur), stepId: opts.stepId, notify: { channel: 'rail', title: label, body: cur.title, tone: 'warn', href: hrefFor({ type: 'work_item', id: cur.id }) } }, (tx) => {
      const ev = this.addEvidence(tx, cur.id, 'origin', source, reason);
      tx.put('workItems', this.bump({
        ...cur,
        state: 'reopened',
        doneAt: null,
        doneBy: null,
        closedReason: null,
        resolution: null,
        resolutionDetail: null,
        involvement: 'owner',
        owner: { id: this.store.meta().user.id, name: this.store.meta().user.name },
        loopedBackIn: { at: this.nowIso(), byPersonName, evidenceId: ev.id },
        reopened: { reason: label, at: this.nowIso(), from: source },
        newEvidenceCount: cur.newEvidenceCount + 1,
      }));
    });
  }

  engineRunState(runId: string, state: AgentRun['state'], lastEvent: string, waiting: { reason: string; question?: string | null; choices?: string[] } | undefined, opts: { actor?: Actor; stepId?: string } = {}) {
    const run = this.store.must('agentRuns', runId, 'Agent run');
    const notify: LiveNotify | undefined =
      state === 'waiting_on_you'
        ? { channel: 'os', title: `${run.kind === 'claude_session' ? 'Claude session' : 'Run'} needs you`, body: waiting?.question ?? waiting?.reason ?? run.title, tone: 'warn', href: run.deepLink ?? undefined }
        : state === 'failed'
          ? { channel: 'os', title: 'Run failed', body: run.title, tone: 'risk' }
          : undefined;
    this.tx({ actor: opts.actor ?? 'engine', action: `run.${state}`, summary: `${run.title}: ${state.replace(/_/g, ' ')}`, entity: { type: 'agent_run', id: run.id, label: run.title }, stepId: opts.stepId, notify }, (tx) => {
      tx.put('agentRuns', {
        ...run,
        state,
        lastEvent,
        updatedAt: this.nowIso(),
        waiting: state === 'waiting_on_you' ? { reason: waiting?.reason ?? 'input needed', question: waiting?.question ?? null, choices: waiting?.choices ?? [], since: this.nowIso() } : null,
        finishedAt: state === 'done' || state === 'done_review' || state === 'failed' ? this.nowIso() : run.finishedAt,
      });
      const item = run.workItemId ? this.store.get('workItems', run.workItemId) : undefined;
      if (item && isLive(item)) {
        if (state === 'waiting_on_you') {
          tx.put('workItems', this.bump({ ...item, state: 'waiting_on_me', waiting: { on: 'me', reason: waiting?.question ?? waiting?.reason ?? 'Session needs input', since: this.nowIso(), runId: run.id } }));
        } else if (item.state === 'waiting_on_me') {
          tx.put('workItems', this.bump({ ...item, state: 'in_progress', waiting: null }));
        }
      }
    });
  }

  engineConnectorState(connectorId: string, state: Connector['state'], error?: string, impact?: string, opts: { actor?: Actor; stepId?: string } = {}) {
    const c = this.store.must('connectors', connectorId, 'Connector');
    const broken = ['auth_needed', 'error', 'offline'].includes(state);
    const notify: LiveNotify | undefined = broken ? { channel: 'os', title: `${c.label} ${state === 'auth_needed' ? 'needs re-auth' : 'is down'}`, body: impact ?? error, tone: 'risk', href: '/health' } : undefined;
    this.tx({ actor: opts.actor ?? 'connector', action: broken ? 'connector.fail' : 'connector.recover', summary: `${c.label}: ${state.replace('_', ' ')}`, entity: { type: 'connector', id: c.id, label: c.label }, stepId: opts.stepId, notify }, (tx) => {
      tx.put('connectors', {
        ...c,
        state,
        since: this.nowIso(),
        lastSuccessAt: state === 'ok' ? this.nowIso() : c.lastSuccessAt,
        lastError: error ? { class: state === 'auth_needed' ? 'auth' : state === 'offline' ? 'offline' : 'transient', message: error, at: this.nowIso(), count: (c.lastError?.count ?? 0) + 1 } : state === 'ok' ? null : c.lastError,
        impact: broken ? (impact ?? `${c.label} items may be stale`) : null,
        catchUpPct: state === 'catching_up' ? (c.catchUpPct ?? 0) : null,
      });
      for (const w of this.store.all('workItems')) {
        const affected = isLive(w) && w.sources.some((s) => s.kind === c.source);
        if (broken && affected) tx.put('workItems', { ...w, stale: { connectorId: c.id, reason: impact ?? `${c.label} is disconnected`, since: this.nowIso() } });
        if (!broken && w.stale?.connectorId === c.id) tx.put('workItems', { ...w, stale: null });
      }
      if (broken) {
        tx.put('eventLog', {
          id: id('evt'),
          at: this.nowIso(),
          level: 'error',
          source: c.id,
          code: state,
          message: error ?? `${c.label} ${state}`,
          count: 1,
          lastSeenAt: this.nowIso(),
          suggestedAction: c.reauth?.label ?? null,
          acknowledged: false,
          acknowledgedAt: null,
        });
      }
    });
  }

  engineRerankSignal(itemId: string, boost: number, reason: string, opts: { actor?: Actor; stepId?: string } = {}) {
    const cur = this.item(itemId);
    this.tx({ actor: opts.actor ?? 'engine', action: 'item.signal', summary: `${reason}: ${cur.title}`, entity: itemRef(cur), stepId: opts.stepId }, (tx) => {
      this.addEvidence(tx, cur.id, 'context', { kind: 'calendar', label: 'Calendar · change' }, reason);
      tx.put('workItems', this.bump({ ...cur, signals: { ...cur.signals, boost: cur.signals.boost + boost }, newEvidenceCount: cur.newEvidenceCount + 1 }));
    });
  }

  // ScenarioHost ------------------------------------------------------------

  applyScenarioAction(a: ScenarioAction, stepId: string): void {
    const o = { stepId };
    switch (a.op) {
      case 'nba_update':
        return this.engineReviseDraft(a.nbaId, a.appendText, a.reason, a.source, o);
      case 'run_state':
        return this.engineRunState(a.runId, a.state, a.lastEvent, a.waiting, o);
      case 'close_item':
        this.engineCloseItem(a.itemId, a.reason, a.evidence, { ...o, resolution: a.resolution, personName: a.personName });
        return;
      case 'loop_back':
        return this.engineLoopBack(a.itemId, a.byPersonName, a.reason, a.source, o);
      case 'engine_patch':
        this.engineUpdateItem(a.itemId, a.patch, a.reason, { ...o, state: a.state, evidence: a.evidence });
        return;
      case 'connector_state':
        return this.engineConnectorState(a.connectorId, a.state, a.error, a.impact, o);
      case 'reopen':
        return this.engineReopen(a.itemId, a.reason, a.source, o);
      case 'rerank_ready':
        return this.engineRerankSignal(a.itemId, a.boost, a.reason, o);
      case 'arrive':
        return this.scenarioArrive(a, o);
      case 'elsewhere':
        return this.scenarioElsewhere(a, o);
    }
  }

  /** Live pass: a copy of a seeded record arrives with a new id, stamped now (what a scan or an engine would add). */
  private scenarioArrive(a: Extract<ScenarioAction, { op: 'arrive' }>, o: { stepId: string }) {
    const src = this.store.get(a.collection, a.fromId) as unknown as Record<string, unknown> | undefined;
    if (!src) return;
    const now = this.nowIso();
    const stamp: Record<string, unknown> = {};
    for (const k of ['createdAt', 'updatedAt', 'startedAt', 'detectedAt', 'firstSeenAt']) if (k in src) stamp[k] = now;
    const prefix = { drafts: 'd', workItems: 'w', activity: 'act', agentRuns: 'run' }[a.collection];
    const rec = { ...src, ...stamp, ...nowIn(a.patch ?? {}, now), id: a.newId ?? id(prefix), version: 1 };
    if (this.store.get(a.collection, rec.id as string)) return; // replayed: arrived already
    this.tx({ actor: 'engine', action: 'scenario.arrive', summary: a.reason, entity: this.refFor(a.collection, rec), stepId: o.stepId, undoable: false }, (tx) => tx.put(a.collection, rec as never));
  }

  /** Live pass: a record changes elsewhere (another tab, Slack, autopilot): no toast, the views follow. */
  private scenarioElsewhere(a: Extract<ScenarioAction, { op: 'elsewhere' }>, o: { stepId: string }) {
    const cur = this.store.get(a.collection, a.id) as unknown as Record<string, unknown> | undefined;
    if (!cur) return;
    const rec = { ...cur, ...nowIn(a.patch, this.nowIso()), version: Number(cur.version ?? 0) + 1, ...('updatedAt' in cur ? { updatedAt: this.nowIso() } : {}) };
    this.tx({ actor: 'engine', action: 'scenario.elsewhere', summary: a.reason, entity: this.refFor(a.collection, rec), stepId: o.stepId, undoable: false }, (tx) => tx.put(a.collection, rec as never));
  }

  resetForScenario(offsetSec: number): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.clock.reset(offsetSec);
    this.resetStore();
    const all: LiveTopic[] = ['today', 'items', 'item', 'initiative', 'nba', 'draft', 'outbox', 'calendar', 'agents', 'tools', 'tool_run', 'time', 'deals', 'briefs', 'watches', 'triage', 'health', 'scans', 'jobs', 'event_log', 'settings', 'policy', 'chat', 'since', 'search', 'audit'];
    this.publish(all, [], 'scenario.reset');
  }

  scenarioChanged(status: ScenarioStatus): void {
    this.bus.publish({ topic: 'scenario', ids: status.fired, reason: `scenario.${status.state}` });
  }

  // =========================================================================
  // Today
  // =========================================================================

  async getToday(_i: I<'getToday'>): Promise<Res<'getToday'>> {
    const t = buildToday(this.store, this.audit, this.now());
    // D-59: the Time badge also counts the VDPs that need you (quiet; only approvals waiting are loud); 2026-11-13 audit
    // C2: and the DCs and use cases waiting for a canvas; C8: the Assistant's staged cards
    const v = this.vdpHome();
    return { ...t, navCounts: { ...t.navCounts, vdpOpen: v ? vdpNeedYouCount(v.summary) : 0, waitingForCanvas: this.waitingForCanvas(), assistantPending: pendingChatCards(this.be6.plans.values()) } };
  }

  /** 2026-11-13 audit C2: DC requests and VDP use cases waiting for a canvas (the db's rule; src/lib/waiting-work.ts). */
  waitingForCanvas(): WaitingForCanvas {
    const persona = personaOf(this.store.settings());
    return {
      dcs: featureActive(persona, 'dealContributions') ? dcWaitingCount(this.dcRequests()) : 0,
      useCases: featureActive(persona, 'vdp') ? ucWaitingCount(ucSyncView(planUseCases(this.ucPlanInput()), null).counts) : 0,
    };
  }

  /** DC-31: Home's DC row reads the Deals Log & fix rows (one count source), while deal contributions are active. */
  dcNeeds() {
    if (!featureActive(personaOf(this.store.settings()), 'dealContributions')) return undefined;
    return this.dealsNeeds().filter((n) => n.section === 'fix');
  }

  /** D-59: Home's and the Time badge's VDP input (the coverage summary), only while VDP is active for the persona. */
  vdpHome() {
    if (!featureActive(personaOf(this.store.settings()), 'vdp')) return undefined;
    return vdpHomeOf(this.vdpCoverageNow());
  }

  async getHome(i: I<'getHome'>): Promise<Res<'getHome'>> { return getHomeMock(this, i); } // prettier-ignore

  async rerankToday(_i: I<'rerankToday'>): Promise<Res<'rerankToday'>> {
    const { entry, result } = this.rerankAll('user', 'today.rerank', 'Applied re-rank');
    return { entity: result, auditId: entry?.id ?? null };
  }

  private rerankAll(actor: Actor, action: string, summary: string, policy?: PriorityPolicy, extra?: (tx: Tx) => void, entity?: { type: 'settings' | 'policy'; id: string; label: string }) {
    const now = this.now();
    const before = storedOrder(this.store).map((i) => i.id);
    const label = policy ?? this.store.settings().policy;
    let scored: ReturnType<typeof computeRanking> = [];
    const r = this.tx({ actor, action, summary, entity: entity ?? { type: 'policy', id: label.id, label: `Ranking (policy v${label.version})` } }, (tx) => {
      extra?.(tx);
      const pol = policy ?? this.store.settings().policy;
      scored = computeRanking(this.store, pol, now);
      const byId = new Map(scored.map((s, i) => [s.id, { ...s, rank: i + 1 }]));
      for (const w of this.store.all('workItems')) {
        const s = byId.get(w.id);
        const next = s ? { ...w, rank: s.rank, score: s.score, rankReasons: s.reasons, priority: priorityFor(s.rank) } : { ...w, rank: null, score: null };
        if (next.rank !== w.rank || next.score !== w.score || JSON.stringify(next.rankReasons) !== JSON.stringify(w.rankReasons)) tx.put('workItems', next);
      }
      tx.put('meta', { ...this.store.meta(), rankedAt: now.toISOString(), policyRankVersion: pol.version });
    });
    const top = toRankRows(this.store, scored, before, 10);
    return { ...r, result: { rankedAt: now.toISOString(), changed: top.filter((t) => t.moved !== 0).length, top } };
  }

  // =========================================================================
  // Work items
  // =========================================================================

  async listItems({ query }: I<'listItems'>): Promise<Res<'listItems'>> {
    return buildItems(this.store, query);
  }

  async getItem({ params }: I<'getItem'>): Promise<Res<'getItem'>> {
    return this.itemDetail(params.id);
  }

  private itemDetail(itemId: string): WorkItemDetail {
    const rec = this.item(itemId);
    const evidence = this.store.all('evidence').filter((e) => e.workItemId === rec.id);
    const card = nowCardFor(this.store, rec);
    const ini = rec.initiativeId ? this.store.get('initiatives', rec.initiativeId) ?? null : null;
    const siblings = ini ? this.store.all('workItems').filter((w) => w.initiativeId === ini.id && w.id !== rec.id).map((w) => hydrateItem(this.store, w)) : [];
    const meeting = rec.servesEventId ? this.store.get('events', rec.servesEventId) ?? null : null;
    return {
      item: card.item,
      nba: card.nba,
      draft: card.draft,
      initiative: ini,
      siblings,
      proposals: card.proposals,
      runs: rec.runIds.map((r) => this.store.get('agentRuns', r)).filter((r): r is AgentRun => !!r),
      assets: uniq([...rec.assetIds, ...(ini?.assetIds ?? [])]).map((a) => this.store.get('assets', a)).filter((a): a is Asset => !!a),
      account: rec.accountId ? this.store.get('accounts', rec.accountId) ?? null : null,
      opp: rec.oppId ? this.store.get('opps', rec.oppId) ?? null : null,
      meeting,
      evidenceCount: evidence.length,
      mentions: whyMentionNames(whyTexts(card.item, card.nba), evidence, slackLabels(this.store.all('people'))),
    };
  }

  async captureItem({ body }: I<'captureItem'>): Promise<Res<'captureItem'>> {
    const { item, entry } = this.captureInternal(body, 'user');
    return { entity: item, auditId: entry?.id ?? null };
  }

  /** Quick capture. Users lock the title they typed; chat captures lock nothing (only user edits lock). */
  private captureInternal(body: { text: string; accountId?: string; initiativeId?: string; due?: string }, actor: 'user' | 'chat') {
    const byUser = actor === 'user';
    const now = this.nowIso();
    let text = body.text.trim();
    let youMin = 15;
    const eff = /~(\d+)\s*(m|min|h)\b/i.exec(text);
    if (eff) {
      youMin = eff[2].toLowerCase() === 'h' ? Number(eff[1]) * 60 : Number(eff[1]);
      text = text.replace(eff[0], '').trim();
    }
    let accountId = body.accountId ?? null;
    const acc = /#([\w-]+)/.exec(text);
    if (acc) {
      const match = this.store.all('accounts').find((a) => a.name.toLowerCase().startsWith(acc[1].toLowerCase()));
      if (match) accountId = match.id;
      text = text.replace(acc[0], match?.name ?? acc[1]).trim();
    }
    const rec: WorkItemRecord = {
      id: id('w'),
      version: 1,
      kind: 'task',
      state: 'open',
      title: text.replace(/\s+/g, ' '),
      purpose: null,
      initiativeId: body.initiativeId ?? null,
      accountId,
      oppId: null,
      servesEventId: null,
      confidence: 'sure',
      why: byUser ? 'Captured by you' : 'Captured from chat',
      whyDetail: null,
      sources: [{ kind: 'manual', label: byUser ? 'Quick capture' : 'Chat capture', at: now }],
      effort: { youMin, agentMin: 0 },
      startBy: null,
      due: body.due ?? null,
      createdAt: now,
      updatedAt: now,
      ageDays: 0,
      isBackground: false,
      rank: null,
      rankReasons: [],
      score: null,
      priority: 'medium',
      signals: { customerFacing: !!accountId, fromManager: false, boost: 0 },
      stale: null,
      userLockedFields: byUser ? ['title'] : [],
      newEvidenceCount: 0,
      reevaluating: true,
      seenAt: now,
      nbaId: null,
      owner: { id: this.store.meta().user.id, name: this.store.meta().user.name },
      people: [],
      waiting: null,
      snoozedUntil: null,
      snoozedFrom: null,
      doneAt: null,
      doneBy: null,
      closedReason: null,
      resolution: null,
      resolutionDetail: null,
      involvement: 'owner',
      loopedBackIn: null,
      likelyDone: null,
      reopened: null,
      dismissed: null,
      notes: '',
      enrichment: { status: 'enriching', startedAt: now, chips: [] },
      deliverable: null,
      training: null,
      runIds: [],
      assetIds: [],
      counterparty: null,
    };
    const { entry, ops } = this.tx({ actor, action: byUser ? 'item.capture' : 'chat.capture', summary: `Captured: ${rec.title}`, entity: itemRef(rec) }, (tx) => {
      tx.put('workItems', rec);
      this.addEvidence(tx, rec.id, 'origin', { kind: 'manual', label: byUser ? 'Quick capture' : 'Chat capture' }, rec.why, false);
    });
    this.later(this.delays.enrichMs, () => this.enrich(rec.id));
    return { item: hydrateItem(this.store, rec), entry, ops };
  }

  private enrich(itemId: string) {
    const cur = this.store.get('workItems', itemId);
    if (!cur) return;
    const words = cur.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !['the', 'and', 'for', 'with', 'about', 'talk', 'team'].includes(w));
    const hit = (s: string) => words.find((w) => s.toLowerCase().includes(w));
    const chips: NonNullable<WorkItemRecord['enrichment']>['chips'] = [];
    for (const r of this.store.all('agentRuns')) {
      const w = r.kind === 'claude_session' ? hit(r.title) : undefined;
      if (w && chips.length < 4) chips.push({ id: id('chip'), kind: 'claude_session', label: `Claude session '${r.title}'`, reason: `Mentions "${w}"`, ref: { type: 'agent_run', id: r.id, label: r.title }, url: r.deepLink ?? undefined, status: 'suggested' });
    }
    for (const a of this.store.all('assets')) {
      const w = hit(a.title);
      if (w && chips.length < 4) chips.push({ id: id('chip'), kind: 'asset', label: `${a.kind === 'doc' ? 'Doc' : a.kind === 'slides' ? 'Deck' : 'File'} '${a.title}' (${a.source === 'drive' ? 'Drive' : a.source})`, reason: `Title matches "${w}"`, ref: { type: 'asset', id: a.id, label: a.title }, url: a.url, status: 'suggested' });
    }
    for (const b of this.store.all('briefs')) {
      const w = hit(b.title) ?? hit(b.summary);
      if (w && chips.length < 4) chips.push({ id: id('chip'), kind: 'slack_thread', label: `Slack thread in ${b.title}`, reason: `Discusses "${w}"`, ref: { type: 'brief', id: b.id, label: b.title }, status: 'suggested' });
    }
    const person = this.store.all('people').find((p) => hit(p.name) || (p.role && hit(p.role)));
    const asset = chips.find((c) => c.kind === 'asset');
    const nbaId = id('nba');
    let draft: Draft | null = null;
    // OUTBOX-W: closed before enrichment finished: no reply draft for a closed to-do (like the db's read-in commit)
    if (person && !isClosedItemState(cur.state)) {
      const txt = `Hi ${person.name.split(' ')[0]}, following up on: ${cur.title}.${asset ? `\n\nHere is the doc I mentioned: ${asset.label}` : ''}\n\nDo you have 15 minutes this week?`;
      const doc = docFromText(txt);
      const dest = { kind: 'slack' as const, target: 'dm' as const, channelId: person.slackHandle ?? person.id, channelName: `@${person.name}`, threadTs: null };
      draft = {
        id: id('dr'),
        version: 1,
        workItemId: cur.id,
        nbaId,
        destination: dest,
        mode: this.store.settings().sending.defaultMode,
        doc,
        plainText: plainText(doc),
        rendered: renderAll(dest, doc),
        userTouched: false,
        userLockedFields: [],
        status: 'drafting',
        threadContext: [],
        createdAt: this.nowIso(),
        updatedAt: this.nowIso(),
        savedAt: null,
        scheduledFor: null,
        attempts: [],
        verification: null,
        rejectedReason: null,
        resultUrl: null,
      };
    }
    const nba: NbaCard = {
      id: nbaId,
      workItemId: cur.id,
      version: 1,
      verb: draft ? 'send' : 'review',
      primaryLabel: draft ? 'Send' : 'Review related work',
      confidence: chips.length ? 'likely' : 'guess',
      title: draft && person ? `Message ${person.name}: ${cur.title}` : `Review ${chips.length} related item${chips.length === 1 ? '' : 's'}`,
      why: chips.length ? `Found ${chips.length} related item${chips.length === 1 ? '' : 's'} after capture` : 'No related work found yet',
      whyDetail: null,
      sources: [{ kind: 'manual', label: 'Quick capture' }],
      status: 'ready',
      draftId: draft?.id ?? null,
      alternatives: [],
      toolAdapterId: null,
      toolInputs: null,
      claudeLaunch: null,
      runId: null,
      update: null,
      versions: [{ version: 1, at: this.nowIso(), reason: 'Generated after enrichment', diffSummary: null }],
      generatedAt: this.nowIso(),
      model: 'mock',
    };
    this.tx({ actor: 'engine', action: 'item.enrich', summary: `Enriched: ${cur.title}`, entity: itemRef(cur) }, (tx) => {
      if (draft) tx.put('drafts', draft);
      tx.put('nbas', nba);
      tx.put('workItems', this.bump({ ...cur, reevaluating: false, enrichment: { status: 'done', startedAt: cur.enrichment?.startedAt ?? null, chips }, nbaId: nba.id, people: person ? [{ id: person.id, name: person.name, role: person.role }] : cur.people }));
    });
  }

  async patchItem({ params, body }: I<'patchItem'>): Promise<Res<'patchItem'>> {
    const cur = this.item(params.id);
    this.checkVersion(cur, body.ifVersion, 'Work item', hydrateItem(this.store, cur));
    const locks = new Set(cur.userLockedFields);
    for (const k of Object.keys(body.patch)) if (ITEM_PATCH_LOCK[k]) locks.add(ITEM_PATCH_LOCK[k]);
    const next = this.bump({ ...cur, ...body.patch, userLockedFields: [...locks] } as WorkItemRecord);
    const { entry } = this.tx({ actor: 'user', action: 'item.edit', summary: `Edited: ${cur.title}`, entity: itemRef(cur), coalesceKey: `item:${cur.id}` }, (tx) => tx.put('workItems', next));
    return { entity: hydrateItem(this.store, next), auditId: entry?.id ?? null };
  }

  async itemAction({ params, body }: I<'itemAction'>): Promise<Res<'itemAction'>> {
    const cur = this.item(params.id);
    this.checkVersion(cur, body.ifVersion, 'Work item', hydrateItem(this.store, cur));
    const now = this.nowIso();
    const done = (reason: string, resolution: Resolution = 'done_by_me'): WorkItemRecord =>
      this.resolvedRecord(cur, { reason, resolution, detail: body.detail ?? {}, involvement: body.involvement, doneBy: 'user' });
    let next: WorkItemRecord;
    let label: string;
    switch (params.verb) {
      case 'done':
        if (!isLive(cur) && cur.state !== 'snoozed' && cur.state !== 'suggested') throw invalid(`Cannot mark a ${cur.state} item done`);
        next = done(body.resolution && body.resolution !== 'done_by_me' ? resolutionLabel(body.resolution, body.detail?.personName) : 'Marked done by you', body.resolution ?? 'done_by_me');
        label = 'Done';
        break;
      case 'resolve':
        if (!body.resolution) throw invalid('resolve needs a `resolution`');
        if (!isLive(cur) && cur.state !== 'snoozed' && cur.state !== 'suggested' && cur.state !== 'done') throw invalid(`Cannot resolve a ${cur.state} item`);
        next = done(resolutionLabel(body.resolution, body.detail?.personName ?? (body.detail?.personId ? this.store.get('people', body.detail.personId)?.name : undefined)), body.resolution);
        label = 'Resolved';
        break;
      case 'snooze':
        if (!body.until) throw invalid('snooze needs `until`');
        if (!isLive(cur) && cur.state !== 'snoozed') throw invalid(`Cannot snooze a ${cur.state} item`);
        next = { ...cur, state: 'snoozed', snoozedUntil: body.until, snoozedFrom: cur.state === 'snoozed' ? cur.snoozedFrom : cur.state };
        label = 'Snoozed';
        break;
      case 'accept':
        if (cur.state !== 'suggested') throw invalid('Only suggested items can be accepted');
        next = { ...cur, state: 'open', confidence: cur.confidence === 'guess' ? 'likely' : cur.confidence };
        label = 'Accepted';
        break;
      case 'dismiss':
        next = { ...cur, state: 'dismissed', dismissed: { reason: body.reason ?? 'other', note: body.note, at: now } };
        label = 'Dismissed';
        break;
      case 'confirm-done':
        if (cur.state !== 'likely_done') throw invalid('Only likely-done items can be confirmed');
        next = done(cur.likelyDone?.reason ?? 'Confirmed done');
        label = 'Confirmed done';
        break;
      case 'not-done':
        // LD-1: the mock keeps no transition log; in_progress is the closure machine's own step-back.
        if (cur.state !== 'likely_done') throw invalid('Only likely-done items can be marked not done');
        next = { ...cur, state: 'in_progress', likelyDone: null };
        label = 'Not done';
        break;
      case 'reopen':
        if (cur.state !== 'done' && cur.state !== 'dismissed') throw invalid('Only done or dismissed items can be reopened');
        // OUTBOX-W: drafts withdrawn when it closed stay discarded; the user can draft again (Undo of the close restores them).
        next = { ...cur, state: 'reopened', doneAt: null, doneBy: null, closedReason: null, dismissed: null, resolution: null, resolutionDetail: null, involvement: 'owner', reopened: { reason: body.note ?? 'Reopened by you', at: now } };
        label = 'Reopened';
        break;
      case 'not-now': {
        if (!body.reason) throw invalid('not-now needs a `reason` (done_elsewhere · not_mine · later · wrong_account · other)');
        label = 'Not now';
        if (body.reason === 'done_elsewhere') next = done('Done elsewhere');
        else if (body.reason === 'later') {
          const until = body.until ?? setMinutes(setHours(addDays(this.now(), 1), 9), 0).toISOString();
          next = { ...cur, state: 'snoozed', snoozedUntil: until, snoozedFrom: cur.state };
        } else if (body.reason === 'wrong_account') next = { ...cur, accountId: null, oppId: null, notes: `${cur.notes}${cur.notes ? '\n' : ''}Wrong account (not now)` };
        else next = { ...cur, state: 'dismissed', dismissed: { reason: body.reason, note: body.note, at: now } };
        break;
      }
    }
    next = this.bump(next);
    const { entry } = this.tx({ actor: 'user', action: `item.${params.verb}`, summary: `${label}: ${cur.title}`, entity: itemRef(cur) }, (tx) => tx.put('workItems', next));
    return { entity: hydrateItem(this.store, next), auditId: entry?.id ?? null };
  }

  /** The closed record for done / resolve / confirm-done (user) and chat's resolveItem. */
  private resolvedRecord(
    cur: WorkItemRecord,
    o: { reason: string; resolution: Resolution; detail: Partial<Omit<ResolutionDetail, 'inferred'>>; involvement?: 'watcher' | 'not_involved' | 'contributor'; doneBy: 'user' | 'chat' },
  ): WorkItemRecord {
    const { detail, resolution } = o;
    const person = detail.personId ? this.store.get('people', detail.personId) : detail.personName ? this.store.all('people').find((p) => p.name === detail.personName) : undefined;
    const personName = detail.personName ?? person?.name;
    if (resolution === 'handed_off' && !personName) throw invalid('handed_off needs detail.personId or detail.personName (who took it over)');
    if ((resolution === 'duplicate' || resolution === 'superseded') && detail.relatedItemId && !this.store.get('workItems', detail.relatedItemId)) throw notFound('Related work item', detail.relatedItemId);
    return {
      ...cur,
      state: 'done',
      doneAt: this.nowIso(),
      doneBy: o.doneBy,
      closedReason: o.reason,
      likelyDone: null,
      waiting: null,
      snoozedUntil: null,
      resolution,
      resolutionDetail: { inferred: false, ...detail, ...(personName ? { personName } : {}), ...(person ? { personId: person.id } : {}) },
      involvement: resolution === 'handed_off' ? (o.involvement ?? 'watcher') : cur.involvement,
      owner: resolution === 'handed_off' && personName ? { id: person?.id ?? `person:${personName}`, name: personName } : cur.owner,
      loopedBackIn: null,
    };
  }

  async getItemEvidence({ params }: I<'getItemEvidence'>): Promise<Res<'getItemEvidence'>> {
    this.item(params.id);
    const evidence = this.store.all('evidence').filter((e) => e.workItemId === params.id);
    return buildEvidencePayload(params.id, evidence, slackLabels(this.store.all('people')));
  }

  async getItemTrace({ params }: I<'getItemTrace'>): Promise<Res<'getItemTrace'>> {
    this.item(params.id);
    // The mock has no scan runs: the chain stops at each source (with its link).
    const steps = this.store
      .all('evidence')
      .filter((e) => e.workItemId === params.id)
      .sort((a, b) => (a.role === 'origin' ? -1 : 0) - (b.role === 'origin' ? -1 : 0) || a.at.localeCompare(b.at))
      .map((e) => ({ evidenceId: e.id, role: e.role, confidence: e.confidence === 'sure' ? 0.95 : e.confidence === 'likely' ? 0.75 : e.confidence === 'guess' ? 0.45 : null, rationale: e.summary || null, at: e.at, source: e.source, sourceItemId: null, run: null, verdict: null, spend: null }));
    return { workItemId: params.id, steps, createdBy: null };
  }

  async getItemHistory({ params }: I<'getItemHistory'>): Promise<Res<'getItemHistory'>> {
    const rec = this.item(params.id);
    const nba = rec.nbaId ? this.store.get('nbas', rec.nbaId) : undefined;
    const entries = this.audit.forEntity('work_item', rec.id);
    if (nba) entries.push(...this.audit.forEntity('nba', nba.id).filter((e) => !entries.includes(e)));
    return { workItemId: rec.id, entries: entries.sort((a, b) => b.at.localeCompare(a.at)), nbaVersions: nba?.versions ?? [] };
  }

  async markItemSeen({ params }: I<'markItemSeen'>): Promise<Res<'markItemSeen'>> {
    const cur = this.item(params.id);
    const { result } = this.tx({ actor: 'user', action: 'item.seen', summary: 'Seen', entity: itemRef(cur), audit: false }, (tx) => {
      for (const e of this.store.all('evidence')) if (e.workItemId === cur.id && e.isNew) tx.put('evidence', { ...e, isNew: false });
      return tx.put('workItems', { ...cur, newEvidenceCount: 0, seenAt: this.nowIso() });
    });
    return { entity: hydrateItem(this.store, result), auditId: null };
  }

  async getInitiative({ params }: I<'getInitiative'>): Promise<Res<'getInitiative'>> {
    const ini = this.store.must('initiatives', params.id, 'Initiative');
    const items = this.store.all('workItems').filter((w) => w.initiativeId === ini.id);
    const detail: InitiativeDetail = {
      initiative: ini,
      items: items.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)).map((w) => hydrateItem(this.store, w)),
      assets: ini.assetIds.map((a) => this.store.get('assets', a)).filter((a): a is Asset => !!a),
      runs: this.store.all('agentRuns').filter((r) => items.some((w) => w.id === r.workItemId)),
      account: ini.accountId ? this.store.get('accounts', ini.accountId) ?? null : null,
      opp: ini.oppId ? this.store.get('opps', ini.oppId) ?? null : null,
      people: ini.people.map((p) => this.store.get('people', p.id) ?? { ...p, accountId: null }),
    };
    return detail;
  }

  // =========================================================================
  // NBA and proposals
  // =========================================================================

  private nbaPayload(itemId: string): NbaPayload {
    const card = nowCardFor(this.store, this.item(itemId));
    return { nba: card.nba, draft: card.draft, proposals: card.proposals };
  }

  async getItemNba({ params }: I<'getItemNba'>): Promise<Res<'getItemNba'>> {
    return this.nbaPayload(params.id);
  }

  async regenerateNba({ params, body }: I<'regenerateNba'>): Promise<Res<'regenerateNba'>> {
    const nba = this.store.must('nbas', params.id, 'NBA');
    this.checkVersion(nba, body.ifVersion, 'NBA', nba);
    const draft = nba.draftId ? this.store.get('drafts', nba.draftId) : undefined;
    const reasons = { regenerate: 'Regenerated', shorter: 'Made shorter', more_formal: 'Made more formal', add_detail: 'Added detail' } as const;
    const reason = reasons[body.instruction];
    const { entry } = this.tx({ actor: 'user', action: `nba.${body.instruction}`, summary: `${reason}: ${nba.title}`, entity: { type: 'nba', id: nba.id, label: nba.title } }, (tx) => {
      let update: NbaCard['update'] = { at: this.nowIso(), reason, kind: 'revised', proposalId: null, diffSummary: null, source: null };
      if (draft) {
        const newText = rewrite(draft.plainText, body.instruction);
        const newDoc = docFromText(newText);
        if (draft.userTouched) {
          const pid = this.propose(tx, { type: 'draft', id: draft.id, label: 'Draft body' }, [{ field: 'doc', label: 'Draft body', before: draft.doc, after: newDoc }], reason, draft.version, 'engine', null, textDiff(draft.plainText, newText));
          update = { ...update, kind: 'proposal', proposalId: pid };
        } else {
          tx.put('drafts', this.bump({ ...draft, doc: newDoc, plainText: plainText(newDoc), rendered: renderAll(draft.destination, newDoc) }));
        }
      }
      const v = update.kind === 'revised' ? nba.version + 1 : nba.version;
      tx.put('nbas', { ...nba, version: v, update, generatedAt: this.nowIso(), versions: update.kind === 'revised' ? [...nba.versions, { version: v, at: this.nowIso(), reason, diffSummary: null }] : nba.versions });
    });
    return { entity: this.nbaPayload(nba.workItemId), auditId: entry?.id ?? null };
  }

  /** B4: the entity is still at the proposal's base version, or every field it changes still holds the value it was proposed over. */
  private proposalStillCurrent(p: Proposal): boolean {
    const cur = p.entity.type === 'work_item' ? this.store.get('workItems', p.entity.id) : p.entity.type === 'draft' ? this.store.get('drafts', p.entity.id) : undefined;
    if (!cur) return true;
    if ((cur as { version?: number }).version === p.baseVersion) return true;
    const rec = cur as unknown as Record<string, unknown>;
    return p.changes.every((c) => JSON.stringify(rec[c.field] ?? null) === JSON.stringify(c.before ?? null));
  }

  async applyProposal({ params }: I<'applyProposal'>): Promise<Res<'applyProposal'>> {
    const chat = await this.be6.apply(params.id, this); // BE-CHAT: a chat plan → one change set, actor chat (+ D-58 route calls)
    if (chat) return chat;
    const p = this.store.must('proposals', params.id, 'Proposal');
    if (p.status !== 'pending') throw invalid(`Proposal is ${p.status}`);
    if (p.entity.type === 'policy') {
      const pol = this.store.settings().policy;
      const weights = { ...pol.weights } as PolicyWeights;
      for (const c of p.changes) if (c.field.startsWith('weights.')) weights[c.field.slice(8) as keyof PolicyWeights] = Number(c.after);
      const res = this.applyPolicyInternal(weights, pol.rules, `Applied from chat: ${p.reason}`, 'chat', (tx) => tx.put('proposals', { ...p, status: 'applied', resolvedAt: this.nowIso() }));
      return { entity: this.store.get('proposals', p.id)!, auditId: res.entry?.id ?? null, receipt: res.receipt };
    }
    // 2026-11-13 audit B4 (the db's proposalStillCurrent): an old proposal never overwrites newer data
    if (p.baseVersion !== null && !this.proposalStillCurrent(p)) throw new AppError('conflict', 'Changed since this was proposed: nothing was applied. Review it: keep what is there now (Not now), or wait for the next update to propose again', { current: p, reason: 'changed_since' });
    const { entry } = this.tx({ actor: 'user', action: 'proposal.apply', summary: `Applied: ${p.reason}`, entity: p.entity }, (tx) => {
      if (p.entity.type === 'work_item') {
        const cur = this.item(p.entity.id);
        const patch: Record<string, unknown> = {};
        for (const c of p.changes) patch[c.field] = c.after;
        tx.put('workItems', this.bump({ ...cur, ...patch } as WorkItemRecord));
      } else if (p.entity.type === 'draft') {
        const d = this.store.must('drafts', p.entity.id, 'Draft');
        const docChange = p.changes.find((c) => c.field === 'doc');
        const doc = (docChange?.after as TipTapDoc | undefined) ?? d.doc;
        tx.put('drafts', this.bump({ ...d, doc, plainText: plainText(doc), rendered: renderAll(d.destination, doc), userTouched: true }));
        const nba = d.nbaId ? this.store.get('nbas', d.nbaId) : undefined;
        if (nba && nba.update?.proposalId === p.id) {
          tx.put('nbas', { ...nba, version: nba.version + 1, update: { ...nba.update, kind: 'revised', reason: `Applied: ${nba.update.reason}` }, versions: [...nba.versions, { version: nba.version + 1, at: this.nowIso(), reason: `Applied: ${p.reason}`, diffSummary: null }] });
        }
      } else {
        throw invalid(`Proposals on ${p.entity.type} are not supported in mock mode`);
      }
      tx.put('proposals', { ...p, status: 'applied', resolvedAt: this.nowIso() });
    });
    return { entity: this.store.get('proposals', p.id)!, auditId: entry?.id ?? null };
  }

  async rejectProposal({ params }: I<'rejectProposal'>): Promise<Res<'rejectProposal'>> {
    const chat = this.be6.reject(params.id); // BE-CHAT: Dismiss a chat plan
    if (chat) return chat;
    const p = this.store.must('proposals', params.id, 'Proposal');
    if (p.status !== 'pending') throw invalid(`Proposal is ${p.status}`);
    const { entry } = this.tx({ actor: 'user', action: 'proposal.reject', summary: `Kept mine: ${p.reason}`, entity: p.entity }, (tx) => {
      tx.put('proposals', { ...p, status: 'rejected', resolvedAt: this.nowIso() });
      for (const nba of this.store.all('nbas')) if (nba.update?.proposalId === p.id) tx.put('nbas', { ...nba, update: null });
    });
    return { entity: this.store.get('proposals', p.id)!, auditId: entry?.id ?? null };
  }

  // =========================================================================
  // Drafts and Outbox
  // =========================================================================

  async getDraft({ params }: I<'getDraft'>): Promise<Res<'getDraft'>> {
    return this.store.must('drafts', params.id, 'Draft');
  }

  /** The message a draft replies to: its thread context and its work item's evidence (the mock has no source items). */
  async getDraftSource({ params }: I<'getDraftSource'>): Promise<Res<'getDraftSource'>> {
    const d = this.store.must('drafts', params.id, 'Draft');
    const wi = d.workItemId ? this.store.get('workItems', d.workItemId) : undefined;
    const evidence = wi ? this.store.all('evidence').filter((e) => e.workItemId === wi.id) : [];
    return buildDraftSource({ draft: d, candidates: baseCandidates(d, evidence, this.store.meta().user), itemSources: wi?.sources ?? [], labels: slackLabels(this.store.all('people')) });
  }

  async patchDraft({ params, body }: I<'patchDraft'>): Promise<Res<'patchDraft'>> {
    const d = this.store.must('drafts', params.id, 'Draft');
    this.checkVersion(d, body.ifVersion, 'Draft', d);
    if (['sending', 'sent', 'verified', 'staged'].includes(d.status)) throw invalid(`Draft is ${d.status}; it can no longer be edited`);
    // A structured action is read-only once drafted: its body is the exact request the user approves.
    if ((d.destination.kind === 'action' || body.destination?.kind === 'action') && (body.doc || body.destination || (body.mode && body.mode !== d.mode))) {
      throw invalid('Action items are read-only: reject this one and draft the change again');
    }
    const doc = body.doc ?? d.doc;
    const destination = body.destination ?? d.destination;
    const locks = new Set(d.userLockedFields);
    if (body.doc) locks.add('doc');
    if (body.destination) locks.add('destination');
    if (body.mode) locks.add('mode');
    const scheduledFor = body.scheduledFor === undefined ? d.scheduledFor : body.scheduledFor;
    const next: Draft = this.bump({
      ...d,
      doc,
      destination,
      mode: body.mode ?? d.mode,
      plainText: plainText(doc),
      rendered: renderAll(destination, doc),
      userTouched: true,
      userLockedFields: [...locks],
      scheduledFor,
      status: scheduledFor ? 'scheduled' : d.status === 'scheduled' ? 'ready' : d.status === 'failed' ? 'drafting' : d.status,
      savedAt: this.nowIso(),
    });
    const { entry } = this.tx({ actor: 'user', action: 'draft.autosave', summary: 'Draft edited', entity: { type: 'draft', id: d.id, label: 'Draft' }, coalesceKey: `draft:${d.id}` }, (tx) => tx.put('drafts', next));
    return { entity: next, auditId: entry?.id ?? null };
  }

  private confirmTokenFor(d: Draft, mode: DispatchMode): string {
    const payload = JSON.stringify(payloadFor(d.destination, d.doc, mode));
    let h = 0;
    for (let i = 0; i < payload.length; i++) h = (Math.imul(31, h) + payload.charCodeAt(i)) | 0;
    return `ct_${d.id}_${d.version}_${mode}_${(h >>> 0).toString(36)}`;
  }

  /** Add to Outbox (BE-CHAT): drafting → ready (pending approval). Idempotent on ready; any other status is a 409. */
  async queueDraft({ params, body }: I<'queueDraft'>): Promise<Res<'queueDraft'>> {
    const d = this.store.must('drafts', params.id, 'Draft');
    if (d.status === 'ready') return { entity: d, auditId: null };
    if (d.status !== 'drafting') throw new AppError('conflict', `Draft is ${d.status}; only a drafting draft can be added to the Outbox`, { current: d });
    this.checkVersion(d, body.ifVersion, 'Draft', d);
    const next: Draft = this.bump({ ...d, status: 'ready', savedAt: this.nowIso() });
    const { entry } = this.tx({ actor: 'user', action: 'draft.queue', summary: 'Added to the Outbox', entity: { type: 'draft', id: d.id, label: 'Draft' } }, (tx) => tx.put('drafts', next));
    return { entity: next, auditId: entry?.id ?? null };
  }

  /** REJECT-1: the user turns a draft down. It leaves the Outbox; nothing is sent; the work item stays open. Undoable. */
  async rejectDraft({ params, body }: I<'rejectDraft'>): Promise<Res<'rejectDraft'>> {
    const d = this.store.must('drafts', params.id, 'Draft');
    if (d.status === 'rejected') return { entity: d, auditId: null };
    if (!['drafting', 'ready', 'scheduled', 'failed'].includes(d.status)) throw new AppError('conflict', `Draft is ${d.status}; only a draft that hasn't been sent can be rejected`, { current: d });
    if (body.ifVersion !== undefined) this.checkVersion(d, body.ifVersion, 'Draft', d);
    const next: Draft = this.bump({ ...d, status: 'rejected', rejectedReason: body.reason ?? null, savedAt: this.nowIso() });
    const { entry } = this.tx({ actor: 'user', action: 'draft.reject', summary: 'Rejected the draft (nothing sent)', entity: { type: 'draft', id: d.id, label: 'Draft' } }, (tx) => tx.put('drafts', next));
    // D-70: a rejected canvas's writes are rejected (its rows go back to waiting)
    this.landings();
    return { entity: next, auditId: entry?.id ?? null };
  }

  async previewDraft({ params, body }: I<'previewDraft'>): Promise<Res<'previewDraft'>> {
    const d = this.store.must('drafts', params.id, 'Draft');
    const mode = body.mode ?? this.outbox.defaultMode(d);
    // One serializer (src/lib/compose): the payload here is byte-identical to what dispatch posts.
    return {
      draftId: d.id,
      version: d.version,
      destination: d.destination,
      mode,
      rendition: renditionFor(d.destination, d.doc),
      payload: payloadFor(d.destination, d.doc, mode),
      confirmToken: this.confirmTokenFor(d, mode),
      dryRun: this.store.settings().sending.dryRun,
      html: previewHtml(d.destination, d.doc, this.mentionLabels()),
    };
  }

  /** Slack user id → display name, so previews show "@Dana Reyes" for `<@U…>`. */
  private mentionLabels(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const p of this.store.all('people')) if (p.slackHandle) out[p.slackHandle] = p.name;
    return out;
  }

  /** Never calls any external system: dry-run records the payload; live mode runs the adapters on a simulated transport. */
  async dispatchDraft(i: I<'dispatchDraft'>): Promise<Res<'dispatchDraft'>> {
    return this.outbox.dispatch(i);
  }

  private createOutbox(): MockOutbox {
    return new MockOutbox({
      store: () => this.store,
      now: () => this.now(),
      checkVersion: (cur, v, what, current) => this.checkVersion(cur, v, what, current),
      confirmTokenFor: (d, mode) => this.confirmTokenFor(d, mode),
      tx: (meta, fn) => this.tx(meta, fn),
      bump: (v) => this.bump(v),
      later: (ms, fn) => this.later(ms, fn),
      verifyMs: () => this.delays.verifyMs,
      newId: (prefix) => id(prefix),
      // D-65: the Apply preflight's DC (D-68) and use-case (D-67) state, the db's rule over the mock's store
      preflightExtra: () => ({
        dcLive: { requests: this.dcRequests(), myDcs: myDcRowsOf(this.store.all('opps'), (aid) => this.store.get('accounts', aid)?.name ?? null) },
        ...preflightUseCases(planUseCases(this.ucPlanInput()).items),
      }),
      onVerifiedSend: (d) => {
        if (!d.workItemId || !this.store.get('workItems', d.workItemId) || !isLive(this.item(d.workItemId))) return;
        const dest = d.destination.kind === 'slack' ? 'Slack' : 'Gmail';
        this.engineCloseItem(d.workItemId, `Reply verified in ${dest}`, { kind: d.destination.kind === 'slack' ? 'slack' : 'gmail', label: `${dest} · sent by you` });
      },
    });
  }

  async getOutbox(_i: I<'getOutbox'>): Promise<Res<'getOutbox'>> {
    return buildOutbox(this.store);
  }

  // =========================================================================
  // Calendar
  // =========================================================================

  async getCalendar({ query }: I<'getCalendar'>): Promise<Res<'getCalendar'>> {
    const { from, to } = windowOrToday(this.now(), query.from, query.to);
    const within = (s: string) => Date.parse(s) >= from.getTime() && Date.parse(s) <= to.getTime();
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      events: this.store.all('events').filter((e) => within(e.start)).sort((a, b) => a.start.localeCompare(b.start)),
      slots: this.store.all('slots').filter((s) => within(s.start)).sort((a, b) => a.start.localeCompare(b.start)),
    };
  }

  async getCalendarEvent({ params }: I<'getCalendarEvent'>): Promise<Res<'getCalendarEvent'>> {
    const ev = this.store.get('events', params.id);
    if (!ev) throw notFound('Event', params.id);
    const { readIn } = await this.readins!.get({ type: 'calendar_event', id: ev.id });
    return eventDetail(ev, {
      items: this.store.all('workItems'),
      account: ev.accountId ? this.store.get('accounts', ev.accountId) : null,
      opp: ev.oppId ? this.store.get('opps', ev.oppId) : null,
      readIn,
    });
  }

  // =========================================================================
  // Agents and tools
  // =========================================================================

  async getAgents(_i: I<'getAgents'>): Promise<Res<'getAgents'>> {
    const order = ['waiting_on_you', 'running', 'failed', 'stale', 'done_review', 'queued', 'done'];
    const runs = this.store.all('agentRuns').sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || b.updatedAt.localeCompare(a.updatedAt));
    const counts = { queued: 0, running: 0, waiting_on_you: 0, done_review: 0, done: 0, failed: 0, stale: 0 } as Record<AgentRun['state'], number>;
    for (const r of runs) counts[r.state]++;
    return { runs, counts, needsInputLink: 'claude://code/needs-input' };
  }

  async launchAgent({ body }: I<'launchAgent'>): Promise<Res<'launchAgent'>> {
    const item = body.workItemId ? this.item(body.workItemId) : undefined;
    const folder = body.folder ?? this.store.meta().repoFolder ?? process.cwd();
    let prompt = body.prompt ?? (item ? buildLaunchPrompt(item, this.store) : 'New session from Control Center');
    if (item && !prompt.includes(`[cc:${item.id}]`)) prompt = `${prompt}\n\n[cc:${item.id}]`;
    if (prompt.length > 14336) prompt = prompt.slice(0, 14336 - (item ? item.id.length + 8 : 0)) + (item ? `\n[cc:${item.id}]` : '');
    const url = `claude://code/new?folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(prompt)}`;
    const run: AgentRun = {
      id: id('run'),
      kind: 'claude_session',
      title: body.title ?? item?.title ?? 'New Claude session',
      workItemId: item?.id ?? null,
      state: 'queued',
      startedAt: this.nowIso(),
      updatedAt: this.nowIso(),
      finishedAt: null,
      lastEvent: 'Opening in Claude…',
      waiting: null,
      deepLink: url,
      sessionId: null,
      cwd: folder,
      bgAgents: 0,
      toolRunId: null,
      progress: null,
      resultUrl: null,
      error: null,
      costUsd: null,
      scheduled: false,
    };
    this.tx({ actor: 'user', action: 'agent.launch', summary: `Started in Claude: ${run.title}`, entity: { type: 'agent_run', id: run.id, label: run.title } }, (tx) => {
      tx.put('agentRuns', run);
      if (item) tx.put('workItems', this.bump({ ...item, state: item.state === 'open' || item.state === 'reopened' ? 'in_progress' : item.state, runIds: uniq([...item.runIds, run.id]) }));
    });
    this.later(this.delays.stepMs, () => {
      const cur = this.store.get('agentRuns', run.id);
      if (!cur || cur.state !== 'queued') return;
      const sessionId = `mock-${nanoid(8)}`;
      this.tx({ actor: 'system', action: 'run.running', summary: `${run.title}: running`, entity: { type: 'agent_run', id: run.id, label: run.title }, audit: false }, (tx) =>
        tx.put('agentRuns', { ...cur, state: 'running', sessionId, deepLink: `claude://code/continue?session=${sessionId}`, lastEvent: 'Session registered (mock)', updatedAt: this.nowIso() }),
      );
    });
    return { url, run };
  }

  async answerAgent({ params, body }: I<'answerAgent'>): Promise<Res<'answerAgent'>> {
    const run = this.store.must('agentRuns', params.id, 'Agent run');
    if (run.kind === 'claude_session') throw invalid('Claude sessions are answered in Claude: use Open in Claude');
    if (run.state !== 'waiting_on_you') throw invalid(`Run is ${run.state}, not waiting on you`);
    const next: AgentRun = { ...run, state: 'running', waiting: null, lastEvent: `You answered: ${body.answer}`, updatedAt: this.nowIso() };
    const { entry } = this.tx({ actor: 'user', action: 'agent.answer', summary: `Answered: ${run.title}`, entity: { type: 'agent_run', id: run.id, label: run.title } }, (tx) => {
      tx.put('agentRuns', next);
      const item = run.workItemId ? this.store.get('workItems', run.workItemId) : undefined;
      if (item?.state === 'waiting_on_me') tx.put('workItems', this.bump({ ...item, state: 'in_progress', waiting: null }));
    });
    this.later(this.delays.stepMs * 2, () => {
      const cur = this.store.get('agentRuns', run.id);
      if (cur?.state === 'running') this.engineRunState(run.id, 'done_review', 'Finished · ready for review', undefined, { actor: 'system' });
    });
    return { entity: next, auditId: entry?.id ?? null };
  }

  async cancelAgent({ params }: I<'cancelAgent'>): Promise<Res<'cancelAgent'>> {
    const run = this.store.must('agentRuns', params.id, 'Agent run');
    if (run.kind === 'claude_session') throw invalid('Stop Claude sessions in Claude');
    if (!['queued', 'running', 'waiting_on_you', 'stale'].includes(run.state)) throw invalid(`Run is ${run.state}`);
    const next: AgentRun = { ...run, state: 'failed', error: 'Cancelled by you', lastEvent: 'Cancelled', updatedAt: this.nowIso(), finishedAt: this.nowIso() };
    const { entry } = this.tx({ actor: 'user', action: 'agent.cancel', summary: `Cancelled: ${run.title}`, entity: { type: 'agent_run', id: run.id, label: run.title } }, (tx) => {
      tx.put('agentRuns', next);
      if (run.toolRunId) {
        const tr = this.store.get('toolRuns', run.toolRunId);
        if (tr) tx.put('toolRuns', { ...tr, status: 'cancelled', finishedAt: this.nowIso(), error: 'Cancelled by you' });
      }
    });
    return { entity: next, auditId: entry?.id ?? null };
  }

  async getTools(_i: I<'getTools'>): Promise<Res<'getTools'>> {
    return { adapters: this.store.all('toolAdapters'), recentRuns: this.store.all('toolRuns').sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '')).slice(0, 20) };
  }

  async startToolRun({ params, body }: I<'startToolRun'>): Promise<Res<'startToolRun'>> {
    const adapter = this.store.must('toolAdapters', params.id, 'Tool');
    if (!adapter.enabled) throw invalid(`${adapter.name} is disabled`);
    if (adapter.health.state === 'down') throw new AppError('upstream_unavailable', `${adapter.name} is not running (health check failed). Start it from Agents ▸ Tools, then run again.`);
    const missing = requiredFieldKeys(adapter).filter((k) => body.inputs[k] === undefined || body.inputs[k] === '');
    if (missing.length) throw invalid(`Missing inputs: ${missing.join(', ')}`, { missing });
    const checked = validateInput({ input: { fields: adapter.fields } }, body.inputs);
    if (!checked.ok) throw invalid(`Invalid inputs: ${checked.errors.join('; ')}`, { errors: checked.errors });
    const runId = id('tr');
    const agentRunId = id('run');
    const steps = 3;
    const tr: ToolRun = { id: runId, adapterId: adapter.id, workItemId: body.workItemId ?? null, nbaId: body.nbaId ?? null, inputs: body.inputs, status: 'queued', progress: { done: 0, total: steps, label: 'Queued' }, linkUrl: null, linkLabel: null, artifacts: [], startedAt: this.nowIso(), finishedAt: null, error: null, agentRunId };
    const ar: AgentRun = { id: agentRunId, kind: 'tool_run', title: `${adapter.name}${body.inputs.name ? `: ${String(body.inputs.name)}` : ''}`, workItemId: body.workItemId ?? null, state: 'queued', startedAt: this.nowIso(), updatedAt: this.nowIso(), finishedAt: null, lastEvent: 'Queued', waiting: null, deepLink: `/agents?run=${agentRunId}`, sessionId: null, cwd: null, bgAgents: 0, toolRunId: runId, progress: tr.progress, resultUrl: null, error: null, costUsd: null, scheduled: false };
    const { entry } = this.tx({ actor: 'user', action: 'tool.run', summary: `Ran ${adapter.name}`, entity: { type: 'tool_run', id: runId, label: ar.title } }, (tx) => {
      tx.put('toolRuns', tr);
      tx.put('agentRuns', ar);
      tx.put('toolAdapters', { ...adapter, recentRunIds: [runId, ...adapter.recentRunIds].slice(0, 10) });
      const item = body.workItemId ? this.store.get('workItems', body.workItemId) : undefined;
      if (item) tx.put('workItems', this.bump({ ...item, state: item.state === 'open' ? 'in_progress' : item.state, runIds: uniq([...item.runIds, agentRunId]) }));
    });
    const step = (n: number) => {
      const cur = this.store.get('toolRuns', runId);
      const run = this.store.get('agentRuns', agentRunId);
      if (!cur || !run || cur.status === 'cancelled' || cur.status === 'failed') return;
      const done = n >= steps;
      // The (compatibility) manifest's link template, else an in-app link to the run.
      const tpl = adapter.manifest.output.link;
      const link = tpl ? { url: tpl.url.replace(/\{\{\s*[\w.]+\s*\}\}/g, runId), label: tpl.label } : { url: `/agents?toolRun=${runId}`, label: 'Open run' };
      const progress = { done: n, total: steps, label: done ? 'Done' : `Step ${n} of ${steps}` };
      this.tx({ actor: 'system', action: done ? 'tool.succeeded' : 'tool.progress', summary: `${ar.title}: ${progress.label}`, entity: { type: 'tool_run', id: runId, label: ar.title }, audit: false, notify: done ? { channel: 'toast', title: `${adapter.name} finished`, tone: 'ok', href: link.url } : undefined }, (tx) => {
        tx.put('toolRuns', { ...cur, status: done ? 'succeeded' : n === 0 ? 'starting' : 'running', progress, ...(done ? { finishedAt: this.nowIso(), linkUrl: link.url, linkLabel: link.label } : {}) });
        tx.put('agentRuns', { ...run, state: done ? 'done_review' : 'running', progress, lastEvent: progress.label, updatedAt: this.nowIso(), ...(done ? { finishedAt: this.nowIso(), resultUrl: link.url } : {}) });
      });
      if (!done) this.later(this.delays.stepMs, () => step(n + 1));
    };
    this.later(this.delays.stepMs / 3, () => step(0));
    return { entity: tr, auditId: entry?.id ?? null };
  }

  async getToolRun({ params }: I<'getToolRun'>): Promise<Res<'getToolRun'>> {
    return this.store.must('toolRuns', params.id, 'Tool run');
  }

  // =========================================================================
  // Time
  // =========================================================================

  async getTime({ query }: I<'getTime'>): Promise<Res<'getTime'>> {
    return this.buildTime(query.week);
  }

  async getActivityLog({ query = {} }: I<'getActivityLog'>): Promise<Res<'getActivityLog'>> {
    const { timezone, workingHours } = this.store.settings().profile;
    return buildActivityLog(this.suggested(markCanvasHolds(this.store.all('activity'), canvasHolds(this.store.all('drafts')))), query, { meta: withPersonaTarget(this.store.meta(), personaOf(this.store.settings())), now: this.now(), tz: timezone, dayEnd: workingHours.end });
  }

  async getTimeLedger({ query = {} }: I<'getTimeLedger'>): Promise<Res<'getTimeLedger'>> {
    const { timezone, workingHours } = this.store.settings().profile;
    return buildTimeLedger(this.store.all('activity'), query, { meta: withPersonaTarget(this.store.meta(), personaOf(this.store.settings())), now: this.now(), tz: timezone, dayEnd: workingHours.end });
  }

  private buildTime(week?: string): TimeWeek {
    const now = this.now();
    // TL-34: the week in the profile timezone (the db's rule), never the server's
    const wb = timeWeekBounds(week, now, this.store.settings().profile.timezone);
    const inWeek = (iso: string) => inTimeWeek(wb, iso);
    const meta = this.store.meta();
    const entries = this.suggested(
      markCanvasHolds(
        this.store.all('activity').filter((a) => inWeek(a.start)),
        canvasHolds(this.store.all('drafts')),
      ),
    ).sort((a, b) => a.start.localeCompare(b.start));
    const lanes: TimelineLane[] = [
      {
        id: 'meetings',
        label: 'Meetings',
        blocks: this.store
          .all('events')
          .filter((e) => inWeek(e.start) && e.attendance !== 'cancelled' && e.attendance !== 'declined')
          .sort((a, b) => a.start.localeCompare(b.start))
          .map((e) => ({ id: e.id, start: e.start, end: e.end, label: e.title, activityId: entries.find((a) => a.sources.some((s) => s.externalId === e.id))?.id ?? null, hatched: false })),
      },
    ];
    for (const lane of ['focus', 'claude', 'drive', 'slack'] as const) {
      const labels = { focus: 'Your focus work', claude: 'Agent time (Claude)', drive: 'Drive edits', slack: 'Slack bursts' };
      lanes.push({
        id: lane,
        label: labels[lane],
        blocks: this.store
          .all('timeBlocks')
          .filter((b) => b.lane === lane && inWeek(b.start))
          .sort((a, b) => a.start.localeCompare(b.start))
          .map(({ lane: _l, ...b }) => ({ ...b, hatched: lane === 'claude' ? true : b.hatched })),
      });
    }
    // the current fiscal quarter's logged rows only, the db's rule (db/quarter.ts): past quarters stay on their weeks
    const profile = this.store.settings().profile;
    const qt = quarterTotal(meta, this.store.all('activity'), now, profile.timezone, profile.workingHours.end);
    const readbacks = entries.filter((e) => e.status === 'logged' || e.status === 'verified').map((e) => e.updatedAt).sort();
    return {
      weekStart: wb.start,
      weekEnd: wb.end,
      timeline: lanes,
      entries,
      onsite: [...this.onsite.values()].filter((d) => d.day >= wb.start && d.day <= wb.end).sort((a, b) => a.day.localeCompare(b.day)),
      // TL-45: the one status → count map (a legacy Event, one deleted in Org62, a row not in Org62 never count)
      totals: weekTotals(entries),
      quarter: { label: qt.q.label, loggedH: qt.loggedH, targetH: personaTargetH(personaOf(this.store.settings()), qt.q.targetH), due: qt.q.due },
      canvas: {
        lastSyncedAt: meta.canvas.lastSyncedAt,
        rowsChangedSince: entries.filter((e) => e.status === 'approved' && (!meta.canvas.lastSyncedAt || e.updatedAt > meta.canvas.lastSyncedAt)).length + meta.canvas.rowsChangedSince,
        confirmRequired: !meta.canvas.lastSyncedAt || !isSameDay(new Date(meta.canvas.lastSyncedAt), now),
        label: meta.canvas.label,
      },
      org62: { lastReadbackAt: readbacks[readbacks.length - 1] ?? null, verified: entries.filter((e) => e.status === 'verified').length, pending: entries.filter((e) => ['approved', 'synced_to_canvas', 'logged'].includes(e.status) && !e.fromOrg62).length },
      // D-47 / D-52: the logging canvases waiting for Apply and the applied ones (receipts, the Confirm step)
      logCanvases: logCanvasesOf(this.store.all('drafts'), this.store.all('activity'), now, this.canvasProgressSources(now)),
    };
  }

  /** 2026-11-13 audit C4: per-canvas checks (when you told Slackbot, the queued re-checks); the db keeps them in kv. */
  private canvasChecks: CanvasChecks = {};

  /**
   * The model's stored answers for rows that need an opp (the db's kv `cc.time.suggestions`). The mock never calls a
   * model, so it has none unless a test puts some (`putStoredSuggestions`): its rows show the rules' suggestions.
   */
  private storedSuggestions: Record<string, StoredSuggestion> = {};

  /** Tests: the model's answers, as the `activity.suggest` job stores them on the db. */
  putStoredSuggestions(rows: Record<string, StoredSuggestion>): void {
    this.storedSuggestions = { ...rows };
    this.bus.publish({ topic: 'time', ids: Object.keys(rows), reason: 'time.suggestions' });
  }

  /** What a row that needs an opp is suggested (src/lib/time-suggest.ts, the db's twin). */
  private suggestContext(): SuggestContext {
    const tz = this.store.settings().profile.timezone;
    return {
      opps: this.store.all('opps'),
      accounts: this.store.all('accounts'),
      events: this.store.all('events'),
      people: this.store.all('people'),
      assets: this.store.all('assets'),
      runs: this.store.all('agentRuns'),
      workItems: this.store.all('workItems'),
      activity: this.store.all('activity'),
      today: new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(this.now()),
      stored: this.storedSuggestions,
      internalActivity: loggingProfile(personaOf(this.store.settings())).internalActivity,
    };
  }

  private suggested(entries: ActivityEntry[]): ActivityEntry[] {
    return entries.some((e) => !e.oppId && !e.internal) ? withSuggestions(entries, this.suggestContext()) : entries;
  }

  /** What each created canvas's progress line reads (the db's sources; the mock's reads are its connector's last success and the checks that came due). */
  private canvasProgressSources(now: Date) {
    const persona = personaOf(this.store.settings());
    const due = Object.values(this.canvasChecks).flatMap((c) => c.at).filter((x) => Date.parse(x) <= now.getTime()).sort().at(-1) ?? null;
    const org62 = this.store.all('connectors').find((c) => c.source === 'org62')?.lastSuccessAt ?? null;
    const read = [due, org62].filter((x): x is string => !!x).sort().at(-1) ?? null;
    return {
      dcRequests: featureActive(persona, 'dealContributions') ? this.dcRequests() : [],
      useCases: featureActive(persona, 'vdp') ? ucSyncView(planUseCases(this.ucPlanInput()), null).items : [],
      checks: this.canvasChecks,
      reads: { events: read, dcs: read, useCases: read },
    };
  }

  /** The db's checkCanvasOrg62 (2026-11-13 audit C4): the mock records the checks; nothing runs (no Org62 here). */
  async checkCanvasOrg62({ params, body }: I<'checkCanvasOrg62'>): Promise<Res<'checkCanvasOrg62'>> {
    const c = this.buildTime().logCanvases.find((x) => x.draftId === params.id);
    if (!c) throw notFound('Logging canvas', params.id);
    if (c.state !== 'applied' && c.state !== 'verified' && c.state !== 'unverified') throw invalid('This canvas is not in Slack yet: Apply it first, then tell Slackbot');
    const now = this.now();
    const plan = planRecheck(this.canvasChecks, c.draftId, body.reason, now);
    this.canvasChecks = plan.next;
    const persona = personaOf(this.store.settings());
    const reads: Array<'events' | 'dcs' | 'use_cases'> = ['events', ...(c.dcs > 0 && featureActive(persona, 'dealContributions') ? (['dcs'] as const) : []), ...(c.useCases > 0 && featureActive(persona, 'vdp') ? (['use_cases'] as const) : [])];
    this.bus.publish({ topic: 'time', ids: [c.draftId], reason: `time.canvas.check.${body.reason}` });
    return { draftId: c.draftId, queued: plan.slots.flatMap((at) => reads.map((read) => ({ read, at }))), nextCheckAt: plan.next[c.draftId]?.at.find((x) => Date.parse(x) > now.getTime() - 60_000) ?? null, note: 'Mock data: the checks are recorded, nothing reads Org62 here' };
  }

  async patchActivity({ params, body }: I<'patchActivity'>): Promise<Res<'patchActivity'>> {
    const cur = this.store.must('activity', params.id, 'Activity entry');
    this.checkVersion(cur, body.ifVersion, 'Activity entry', cur);
    // every edited field is locked except `status`: the pipeline's (a created canvas, the Org62 check) to move;
    // D-64: internal-ness (patchedEntry, the db's too)
    const opp = body.patch.oppId ? this.store.get('opps', body.patch.oppId) : undefined;
    const { next: edited } = patchedEntry(cur, body.patch, opp ? { name: opp.name, accountName: this.store.get('accounts', opp.accountId)?.name ?? null } : null);
    const next = activityStamps(this.bump(edited));
    // D-65 (TL-25): an edit unstages a row a canvas item holds (the db's rule): the item is re-rendered without it
    const holder = canvasHolds(this.store.all('drafts')).rows.get(cur.id);
    const held = holder ? this.store.get('drafts', holder) : undefined;
    const { entry } = this.tx({ actor: 'user', action: 'activity.edit', summary: `Edited log row: ${cur.description}`, entity: { type: 'activity_entry', id: cur.id, label: cur.description }, coalesceKey: `activity:${cur.id}` }, (tx) => {
      tx.put('activity', next);
      if (held && isPendingLogCanvas(held)) {
        const out = preflightDraft(held, mockPreflightContext(this.store, new Set([cur.id])));
        if (out.next) tx.put('drafts', this.bump(out.next));
      }
    });
    // the row as GET /time reads it (its suggestion, while it still needs an opp)
    return { entity: this.suggested([next])[0]!, auditId: entry?.id ?? null };
  }

  // D-65 (TL-14, TL-20): Log again / Leave out on a row that is not in Org62 after all (the db's rule, relog.ts)
  async resolveActivity({ params, body }: I<'resolveActivity'>): Promise<Res<'resolveActivity'>> {
    const cur = this.store.must('activity', params.id, 'Activity entry');
    this.checkVersion(cur, body.ifVersion, 'Activity entry', cur);
    const next = activityStamps(this.bump(resolvedEntry(cur, body.action)));
    const { entry } = this.tx({ actor: 'user', action: `activity.org62.${body.action}`, summary: resolvedSummary(cur, body.action), entity: { type: 'activity_entry', id: cur.id, label: cur.description } }, (tx) => tx.put('activity', next));
    return { entity: next, auditId: entry?.id ?? null };
  }

  // The opportunity picker of a Time row (the db's twin: same ranking, src/lib/opp-options.ts).
  async getOppOptions({ query = {} }: I<'getOppOptions'>): Promise<Res<'getOppOptions'>> {
    const entry = query.entryId ? this.store.must('activity', query.entryId, 'Activity entry') : null;
    const tz = this.store.settings().profile.timezone;
    return buildOppOptions({
      entry,
      opps: this.store.all('opps'),
      accounts: this.store.all('accounts'),
      events: this.store.all('events'),
      people: this.store.all('people'),
      assets: this.store.all('assets'),
      runs: this.store.all('agentRuns'),
      workItems: this.store.all('workItems'),
      activity: this.store.all('activity'),
      today: new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(this.now()),
    });
  }

  /**
   * "Search Org62" in mock mode: nothing is looked up. The placeholder records (src/mock/org62-opps.ts) the words
   * match, plus the app's own opps the words match (as hits already in the app, under placeholder Org62 ids).
   */
  async searchOrg62Opps({ body }: I<'searchOrg62Opps'>): Promise<Res<'searchOrg62Opps'>> {
    const accounts = this.store.all('accounts');
    const opps = this.store.all('opps');
    const acctByName = new Map(accounts.map((a) => [a.name.toLowerCase(), a]));
    const words = body.q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
    const inApp = opps
      .filter((o) => o.isOpen && words.length && words.every((w) => `${o.name} ${this.store.get('accounts', o.accountId)?.name ?? ''}`.toLowerCase().includes(w)))
      .map((o) => ({
        org62Id: mockOrg62IdFor(o.id),
        name: o.name,
        accountName: this.store.get('accounts', o.accountId)?.name ?? null,
        accountOrg62Id: null,
        stage: o.stage || null,
        closeDate: o.closeDate,
        amount: o.amount,
        owner: o.owner?.name ?? null,
        isOpen: o.isOpen,
        oppId: o.id,
        accountId: o.accountId || null,
      }));
    const placeholders = searchMockOrg62Opps(body.q).map((r) => {
      const url = org62RecordUrl('Opportunity', r.Id);
      const imported = opps.find((o) => o.id === mockOppIdFor(r.Id) || (!!url && o.org62Url === url));
      const acct = accounts.find((a) => a.id === mockAccountIdFor(r.AccountId)) ?? acctByName.get(r.Account.Name.toLowerCase());
      return { org62Id: r.Id, name: r.Name, accountName: r.Account.Name, accountOrg62Id: r.AccountId, stage: r.StageName, closeDate: r.CloseDate, amount: r.Amount, owner: r.Owner.Name, isOpen: !r.IsClosed, oppId: imported?.id ?? null, accountId: imported?.accountId ?? acct?.id ?? null };
    });
    const hits = [...placeholders, ...inApp.filter((h) => !placeholders.some((p) => p.oppId === h.oppId))].slice(0, 10);
    return { q: body.q, hits, notes: ['Mock mode: placeholder Org62 records; nothing was looked up.', ...(hits.length ? [] : ['Nothing in Org62 matches.'])], simulated: true, costUsd: 0 };
  }

  /** A picked Org62 hit in mock mode: the app's opp, or the placeholder record added (with its account) in one undoable change. */
  /** Store one placeholder Org62 Opportunity the app doesn't track (and its account, when the app lacks it), inside a tx. */
  private putMockOrg62Opp(tx: Tx, rec: (typeof MOCK_ORG62_OPPS)[number], at: string): Opportunity {
    const acct =
      this.store.get('accounts', mockAccountIdFor(rec.AccountId)) ??
      this.store.all('accounts').find((a) => a.name.toLowerCase() === rec.Account.Name.toLowerCase()) ??
      tx.put('accounts', { id: mockAccountIdFor(rec.AccountId), name: rec.Account.Name, industry: null, dcStatus: 'none', vdpStatus: 'none', hoursQtd: 0, team: [], org62Url: org62RecordUrl('Account', rec.AccountId), notes: '' });
    return tx.put('opps', {
      id: mockOppIdFor(rec.Id),
      accountId: acct.id,
      name: rec.Name,
      stage: rec.StageName,
      amount: rec.Amount,
      closeDate: rec.CloseDate,
      isOpen: !rec.IsClosed,
      isMine: false,
      dcAssigned: false,
      vdpLinked: false,
      hoursQtd: 0,
      nextStep: null,
      // added from a one-opp read, like the db's (no NextStep): no next step is unknown, not missing
      nextStepRead: false,
      products: [],
      owner: null,
      org62Url: org62RecordUrl('Opportunity', rec.Id),
      myDc: null,
      forecastCategory: rec.ForecastCategoryName,
      isWon: rec.IsWon,
      updatedAt: at,
    });
  }

  /** The placeholder Org62 record with this id (15 or 18 characters), when there is one. */
  private mockOrg62Opp(org62Id: string) {
    const key = org62Id.trim().slice(0, 15);
    return MOCK_ORG62_OPPS.find((r) => r.Id.slice(0, 15) === key) ?? null;
  }

  async pickOrg62Opp({ params, body }: I<'pickOrg62Opp'>): Promise<Res<'pickOrg62Opp'>> {
    const cur = this.store.must('activity', params.id, 'Activity entry');
    this.checkVersion(cur, body.ifVersion, 'Activity entry', cur);
    if (cur.status === 'logged' || cur.status === 'verified') throw invalid('This row is logged in Org62: its opportunity is fixed');
    const key = body.org62Id.slice(0, 15);
    const opps = this.store.all('opps');
    const shown = opps.find((o) => mockOrg62IdFor(o.id).slice(0, 15) === key || o.id === mockOppIdFor(body.org62Id) || (o.org62Url ?? '').includes(`/${body.org62Id}/`));
    const rec = shown ? null : MOCK_ORG62_OPPS.find((r) => r.Id.slice(0, 15) === key);
    if (!shown && !rec) throw notFound('Org62 opportunity', body.org62Id);
    const at = this.nowIso();
    const { entry, result } = this.tx({ actor: 'user', action: 'activity.org62_opp', summary: `Set the opportunity: ${shown?.name ?? rec!.Name}${rec ? ' (added from Org62)' : ''}`, entity: { type: 'activity_entry', id: cur.id, label: cur.description } }, (tx) => {
      const opp = shown ?? this.putMockOrg62Opp(tx, rec!, at);
      const next = activityStamps(
        this.bump({
          ...cur,
          oppId: opp!.id,
          oppName: opp!.name,
          accountName: this.store.get('accounts', opp!.accountId)?.name ?? cur.accountName,
          userLockedFields: [...new Set([...cur.userLockedFields, 'oppId' as const])],
          issues: cur.issues.filter((i) => !/opp/i.test(i)),
        }),
      );
      return tx.put('activity', next);
    });
    return { entity: result, auditId: entry?.id ?? null };
  }

  /**
   * Onsite days in mock mode (onsite lane): there is no detection here (the seed has no trips), so a correction is
   * the chip; kept in memory, not audited.
   */
  private readonly onsite = new Map<string, OnsiteDay>();

  private onsiteChip(day: string, accountId: string | null, status: OnsiteDay['status']): OnsiteDay {
    const tz = this.store.settings().profile.timezone;
    const acct = accountId ? this.store.get('accounts', accountId) : undefined;
    return { day, status, accountId, accountName: acct?.name ?? null, whatOrg62Id: null, whatName: null, city: null, timezone: tz, frame: null, hoursLabel: '', signals: [{ kind: 'correction', label: status === 'not_onsite' ? 'You marked this day: not onsite' : 'You confirmed this day', used: true }], trip: null, locked: true };
  }

  async correctOnsiteDay({ params, body }: I<'correctOnsiteDay'>): Promise<Res<'correctOnsiteDay'>> {
    const cur = this.onsite.get(params.day) ?? null;
    if (body.action === 'clear') {
      this.onsite.delete(params.day);
      return { entity: null, auditId: null };
    }
    if (body.action === 'change_account' && body.accountId) this.store.must('accounts', body.accountId, 'Account');
    if (body.action === 'adjust_hours' && (!body.start || !body.end || body.end <= body.start)) throw invalid('adjust_hours needs start < end (HH:MM)');
    const next = this.onsiteChip(params.day, body.action === 'change_account' ? (body.accountId ?? null) : (cur?.accountId ?? null), body.action === 'not_onsite' ? 'not_onsite' : 'confirmed');
    if (body.action === 'adjust_hours') next.hoursLabel = `${body.start}–${body.end} · your hours`;
    this.onsite.set(params.day, next);
    return { entity: next, auditId: null };
  }

  async markTrip({ body }: I<'markTrip'>): Promise<Res<'markTrip'>> {
    if (body.to < body.from) throw invalid('The trip ends before it starts');
    this.store.must('accounts', body.accountId, 'Account');
    const out: OnsiteDay[] = [];
    for (let d = body.from; d <= body.to && out.length < 31; d = format(addDays(parseISO(d), 1), 'yyyy-MM-dd')) {
      const chip = { ...this.onsiteChip(d, body.accountId, 'confirmed'), city: body.city ?? null, trip: { from: body.from, to: body.to } };
      this.onsite.set(d, chip);
      out.push(chip);
    }
    return { entity: out, auditId: null };
  }

  // D-64: "Dismiss all from <source>" (src/server/time/dismiss.ts plans it; the db's twin)
  async listTimeDismissRules(_i: I<'listTimeDismissRules'>): Promise<Res<'listTimeDismissRules'>> {
    return { rules: rulesView(this.store.all('timeDismissRules'), this.store.all('activity')) };
  }

  async dismissFromSource({ body }: I<'dismissFromSource'>): Promise<Res<'dismissFromSource'>> {
    this.store.must('activity', body.entryId, 'Activity entry');
    const entries = markCanvasHolds(this.store.all('activity'), canvasHolds(this.store.all('drafts')));
    const { rule, changes } = planDismissFromSource(entries, body.entryId, this.nowIso());
    const { entry } = this.tx({ actor: 'user', action: 'time.dismiss_rule', summary: `Dismissed all from ${rule.label}: ${changes.length} ${changes.length === 1 ? 'row' : 'rows'}`, entity: { type: 'activity_entry', id: body.entryId, label: rule.label } }, (tx) => {
      tx.put('timeDismissRules', rule);
      for (const c of changes) {
        const { canvasDraftId: _held, ...row } = c;
        tx.put('activity', this.bump(row));
      }
    });
    return { entity: { rule: rulesView([rule], this.store.all('activity'))[0]!, dismissedIds: changes.map((c) => c.id) }, auditId: entry?.id ?? null };
  }

  async removeTimeDismissRule({ body }: I<'removeTimeDismissRule'>): Promise<Res<'removeTimeDismissRule'>> {
    const rule = this.store.get('timeDismissRules', body.key);
    if (!rule) return { entity: { rules: rulesView(this.store.all('timeDismissRules'), this.store.all('activity')) }, auditId: null };
    const back = planRemoveRule(this.store.all('activity'), body.key, this.nowIso(), loggingProfile(personaOf(this.store.settings())).taskTypeRequired);
    const { entry } = this.tx({ actor: 'user', action: 'time.dismiss_rule.remove', summary: `Removed the rule: all from ${rule.label} (${back.length} ${back.length === 1 ? 'row' : 'rows'} back)`, entity: { type: 'activity_entry', id: back[0]?.id ?? body.key, label: rule.label } }, (tx) => {
      tx.remove('timeDismissRules', body.key);
      for (const r of back) tx.put('activity', this.bump(r));
    });
    return { entity: { rules: rulesView(this.store.all('timeDismissRules'), this.store.all('activity')) }, auditId: entry?.id ?? null };
  }

  async syncCanvas({ body }: I<'syncCanvas'>): Promise<Res<'syncCanvas'>> {
    const week = this.buildTime();
    if (week.canvas.confirmRequired && !body.confirm) throw invalid('First canvas sync today needs confirm: true', { confirmRequired: true });
    const dryRun = this.store.settings().sending.dryRun;
    const tz = this.store.settings().profile.timezone;
    const rows = week.entries.filter((e) => e.status === 'approved' || e.status === 'synced_to_canvas');
    const payload = [
      `# ${week.canvas.label} · week of ${week.weekStart}`,
      '',
      ...rows.map((e) => `- [ ] ${e.date} ${fmtHM(e.start, tz)}–${fmtHM(e.end, tz)} · ${e.durationH}h · ${e.taskType ?? '?'} · ${e.oppName ?? 'no opp'} · ${e.meetingType ?? ''} · ${e.description}`),
    ].join('\n');
    const now = this.nowIso();
    const { entry } = this.tx({ actor: 'user', action: dryRun ? 'activity.sync_canvas.dry_run' : 'activity.sync_canvas', summary: `${dryRun ? 'Dry run: ' : ''}Synced ${rows.length} rows to canvas`, entity: { type: 'activity_entry', id: 'canvas', label: week.canvas.label }, undoable: !dryRun }, (tx) => {
      if (!dryRun) for (const e of rows) if (e.status === 'approved') tx.put('activity', this.bump({ ...e, status: 'synced_to_canvas' }));
      tx.put('meta', { ...this.store.meta(), canvas: { ...this.store.meta().canvas, lastSyncedAt: now, rowsChangedSince: 0 } });
    });
    return { dryRun, syncedAt: now, rowsSynced: rows.length, payload, entries: this.buildTime().entries, auditId: entry?.id ?? id('aud_noop') };
  }

  // =========================================================================
  // History (B-081): stored history only, composed by src/server/history/compose.ts
  // =========================================================================

  async getHistoryMonth({ query }: I<'getHistoryMonth'>): Promise<Res<'getHistoryMonth'>> {
    return composeHistoryMonth(mockHistorySources(this.store, this.audit, this.now()), query.month);
  }

  async getHistoryDay({ params }: I<'getHistoryDay'>): Promise<Res<'getHistoryDay'>> {
    return composeHistoryDay({ ...mockHistorySources(this.store, this.audit, this.now()), onsite: [...this.onsite.values()] }, params.day);
  }

  // =========================================================================
  // Deals
  // =========================================================================

  async getDeals(_i: I<'getDeals'>): Promise<Res<'getDeals'>> {
    const accounts = this.accountRows();
    accounts.sort((a, b) => b.pipelineAmount - a.pipelineAmount);
    // the summary and pipeline by quarter (src/server/deals/pipeline.ts: the same function the db calls)
    const s = this.store.settings();
    const basis = pipelineBasisOf(personaOf(s));
    const pipeline = buildDealsPipeline({ now: this.now(), timezone: s.profile.timezone || this.store.meta().timezone, basis, opps: this.store.all('opps'), accounts: this.store.all('accounts'), forecasts: basis === 'specialist_forecast' ? this.forecast.all() : [] });
    return { accounts, missedCount: this.store.all('missedOpps').filter((m) => m.status === 'new').length, pipeline, needs: this.dealsNeeds(accounts) };
  }

  /** The Deals list rows (my open opps per account), as getDeals returns them. */
  private accountRows(): AccountRow[] {
    const swept = sweptOppIds(this.store.all('missedOpps'));
    return this.store.all('accounts').map((a) => {
      const opps = this.store.all('opps').filter((o) => o.accountId === a.id && o.isOpen && isMyOpp(o, swept));
      return {
        ...a,
        myDcs: accountDcsOf(this.store.all('opps'), a.id),
        openOpps: opps.length,
        openTasks: this.store.all('workItems').filter((w) => w.accountId === a.id && isLive(w)).length,
        pipelineAmount: opps.reduce((s, o) => s + (o.amount ?? 0), 0),
        nextCloseDate: opps.map((o) => o.closeDate).filter((d): d is string => !!d).sort()[0] ?? null,
      };
    });
  }

  /** Deals needs (src/engines/deals/needs.ts via src/server/deals/needs.ts: the same call the db makes). */
  private dealsNeeds(accounts: AccountRow[] = this.accountRows()): DealsNeed[] {
    const s = this.store.settings();
    return dealsNeedsFor({ now: this.now(), timezone: s.profile.timezone || this.store.meta().timezone, persona: personaOf(s), accounts, opps: this.store.all('opps').map(withMyDcFlag), missed: this.store.all('missedOpps'), requests: this.dcRequests(), decisions: this.store.all('needDecisions'), vdpOppIds: this.vdpOppIds() });
  }

  /** DC-32: open opps a VDP I'm on links (the placeholder mirror; the db reads vdp_records). */
  private vdpOppIds(): Set<string> | undefined {
    if (!featureActive(personaOf(this.store.settings()), 'vdp')) return undefined;
    const ents = gapEntities(this.store.all('accounts'), this.store.all('opps'));
    const me = this.store.meta().user.email;
    const open = new Set(this.store.all('opps').filter((o) => o.isOpen).map((o) => o.id));
    return vdpOppIdsOf(
      this.vdpSnapshots().map((v) => ({ linkedOppIds: linkVdp(v, ents.accounts, ents.opps).opportunityIds, onIt: !me || onVdp(v, [me]), live: !v.archivedAt })),
      open,
    );
  }

  // ---- Needs you: Snooze / Not needed decisions (src/contract/needs.ts) ------------------------------------
  async listNeedDecisions(_i: I<'listNeedDecisions'>): Promise<Res<'listNeedDecisions'>> {
    return { decisions: this.store.all('needDecisions').sort(needDecisionOrder) };
  }

  async decideNeed({ body }: I<'decideNeed'>): Promise<Res<'decideNeed'>> {
    const ds = planNeedDecisions(body, this.now(), this.store.all('opps'), this.store.settings().profile.timezone || this.store.meta().timezone);
    const { entry } = this.tx({ actor: 'user', action: 'needs.decide', summary: needDecisionLabel(ds), entity: { type: body.rule === 'dc_gap' ? 'opportunity' : 'account', id: body.subjectIds[0]!, label: ds[0]?.label ?? body.subjectIds[0]! } }, (tx) => {
      for (const d of ds) tx.put('needDecisions', d);
    });
    return { entity: { decisions: ds }, auditId: entry?.id ?? null };
  }

  async clearNeedDecision({ body }: I<'clearNeedDecision'>): Promise<Res<'clearNeedDecision'>> {
    const gone = [...new Set(body.subjectIds)].map((sid) => this.store.get('needDecisions', needKey(body.rule, sid))).filter((d): d is NeedDecision => !!d);
    if (!gone.length) return { entity: { decisions: [] }, auditId: null };
    const { entry } = this.tx({ actor: 'user', action: 'needs.clear', summary: `Back on the list: ${gone.map((d) => d.label ?? d.subjectId).join(', ')}`.slice(0, 200), entity: { type: body.rule === 'dc_gap' ? 'opportunity' : 'account', id: gone[0]!.subjectId, label: gone[0]!.label ?? gone[0]!.subjectId } }, (tx) => {
      for (const d of gone) tx.remove('needDecisions', needKey(d.rule, d.subjectId));
    });
    return { entity: { decisions: gone.sort(needDecisionOrder) }, auditId: entry?.id ?? null };
  }

  async getMissed(_i: I<'getMissed'>): Promise<Res<'getMissed'>> {
    const missed = this.store.all('missedOpps').sort((a, b) => (a.verdict === b.verdict ? (b.amount ?? 0) - (a.amount ?? 0) : a.verdict === 'claim' ? -1 : 1));
    return { missed, lastSweepAt: missed.map((m) => m.foundAt).sort().pop() ?? null };
  }

  /** Placeholder VDPs (src/mock/vdp.ts), built once from the seed's accounts and opps. The mock never calls VDP. */
  private vdpMirror: VdpSnapshot[] | null = null;
  private vdpSnapshots(): VdpSnapshot[] {
    this.vdpMirror ??= mockVdpSnapshots(this.store.all('accounts'), this.store.all('opps'), this.store.meta().user, this.nowIso());
    return this.vdpMirror;
  }

  /** What the placeholder VDP server lists (src/mock/vdp.ts mockVdpServer), built once like the mirror. */
  private vdpServerInfo: VdpServerInfo | null = null;
  private vdpServer(): VdpServerInfo {
    this.vdpServerInfo ??= mockVdpServer(this.store.all('accounts'), this.store.all('opps'), this.vdpSnapshots(), this.nowIso());
    return this.vdpServerInfo;
  }

  /** Placeholder asset candidates (src/mock/vdp.ts) and the simulated "Find assets" runs, per store reset. */
  private vdpCands: CandidateRecord[] | null = null;
  private vdpRuns = new Map<string, VdpBackfillRun>();
  private vdpRunSeq = 0;
  private vdpCandidates(): CandidateRecord[] {
    if (!this.vdpCands) {
      const cov = this.vdpCoverageBase();
      this.vdpCands = screenCandidates(mockVdpCandidates(this.vdpSnapshots(), assetTargets(cov, this.vdpSnapshots(), this.store.all('accounts')), this.nowIso()));
    }
    return this.vdpCands;
  }
  /** The research budget, as the db reads it (per run, the assistant's day line; the mock spends nothing on research). */
  private vdpBudget() {
    const s = this.store.settings();
    const lim = chatLimitsFromEnv(process.env, 'sonnet', s.chat);
    const eff = budgetsForDay(s.budgets, this.mockDay());
    const line = eff.chatUsd != null && process.env.CC_CHAT_DAILY_USD === undefined ? eff.chatUsd : lim.chatDailyUsd;
    return { perRunUsd: lim.researchUsd, dayLeftUsd: line, lineUsd: line, hardLeftUsd: Math.max(0, eff.hardUsd - this.store.spend().today.usd) };
  }
  private mockDay(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.store.settings().profile.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(this.now());
  }
  /** VDP autopilot's ledger (D-60), per store reset like the mirror. */
  private vdpLedger: AutopilotLedger = EMPTY_LEDGER;
  /** VDP's sign-in in mock mode: always fine unless a test says otherwise. */
  private vdpAuth: 'ok' | 'stale' = 'ok';
  private vdpAutopilotInputs(): CoverageAutopilot {
    const sending = sendingSection(this.store.settings().sending);
    const tz = this.store.settings().profile.timezone;
    return { settings: { on: sending.channels.vdp.autopilot, dryRun: sending.dryRun, cap: sending.channels.vdp.dailyCap }, ledger: this.vdpLedger, auth: this.vdpAuth, today: vdpLocalDay(this.now().getTime(), tz), dayOf: (iso) => vdpLocalDay(Date.parse(iso), tz) };
  }
  private vdpCoverageBase(assets?: Parameters<typeof vdpCoverageFrom>[0]['assets'], ap?: CoverageAutopilot) {
    return this.vdpCoverageAndQueueBase(assets, ap).coverage;
  }
  /** D-63: the latest "Push N to VDP" (its progress), per store reset like the mirror. */
  private vdpPush: VdpPushRun | null = null;
  /** D-69: the placeholder Org62 hierarchy (src/mock/vdp.ts), built once per store reset like the mirror. */
  private vdpHierarchy: AccountHierarchy | null = null;
  private vdpIdentityInputs() {
    this.vdpHierarchy ??= mockAccountHierarchy(this.store.all('accounts'), this.nowIso());
    const ents = gapEntities(this.store.all('accounts'), this.store.all('opps'));
    const overrides = this.store.all('vdpIdentity');
    // the placeholder judgment is made for the units as they read now (its hash is theirs), like a cached decision
    const units = resolveCompanyIdentity({ accounts: ents.accounts, opps: ents.opps, vdps: this.vdpSnapshots(), hierarchy: this.vdpHierarchy, lookups: this.vdpServer().companies, overrides }).units;
    return { hierarchy: this.vdpHierarchy, overrides, judgments: mockIdentityJudgments(units, this.nowIso()) };
  }
  private vdpCoverageAndQueueBase(assets?: Parameters<typeof vdpCoverageFrom>[0]['assets'], ap?: CoverageAutopilot) {
    const user = this.store.meta().user;
    const at = this.nowIso();
    return vdpCoverageAndQueue({
      ...this.vdpIdentityInputs(),
      // D-63: the placeholder Specialist Forecast AEs (the db reads Org62's, src/server/vdp/specialist-aes.ts)
      aesByOpp: mockSpecialistAes(this.store.all('accounts'), this.store.all('opps')),
      push: this.vdpPush,
      autopilot: ap ?? this.vdpAutopilotInputs(),
      records: this.vdpSnapshots().map((s) => ({ snapshot: s, goneAt: null, lastSeenAt: s.lastActivityAt ?? at })),
      accounts: this.store.all('accounts'),
      opps: this.store.all('opps'),
      me: { name: user.name, email: user.email },
      now: at,
      vdpBaseUrl: MOCK_VDP_BASE,
      drafts: this.store.all('drafts'),
      server: this.vdpServer(),
      ...(assets ? { assets } : {}),
      // D-67: the use-case round trip's VDP-side items
      useCaseGaps: planUseCases(this.ucPlanInput()).vdpGaps,
    });
  }
  private vdpCoverageNow() {
    const b = this.vdpBudget();
    const running = [...this.vdpRuns.values()].filter((r) => r.status === 'queued' || r.status === 'running').length;
    return this.vdpCoverageBase({ candidates: this.vdpCandidates(), perRunUsd: b.perRunUsd, runUsd: expectedRunUsd(this.vdpRuns, b.perRunUsd), dayLeftUsd: b.dayLeftUsd, running });
  }

  async getVdpCoverage(_i: I<'getVdpCoverage'>): Promise<Res<'getVdpCoverage'>> {
    return this.vdpCoverageNow();
  }

  async getVdpDetail({ query }: I<'getVdpDetail'>): Promise<Res<'getVdpDetail'>> {
    const b = this.vdpBudget();
    return vdpDetailFrom({
      key: query.key,
      coverage: this.vdpCoverageNow(),
      snapshots: this.vdpSnapshots(),
      accounts: this.store.all('accounts'),
      opps: this.store.all('opps'),
      candidates: this.vdpCandidates(),
      backfill: { last: this.vdpRuns.get(query.key) ?? null, perRunUsd: b.perRunUsd, dayLeftUsd: b.dayLeftUsd, available: true, note: null },
      server: this.vdpServer(),
      assetDrafts: vdpDraftRefs(this.store.all('drafts')),
    });
  }

  async setVdpCandidate({ params, body }: I<'setVdpCandidate'>): Promise<Res<'setVdpCandidate'>> {
    const list = this.vdpCandidates();
    const i = list.findIndex((c) => c.id === params.id);
    if (i < 0) throw notFound('Asset candidate', params.id);
    const cur = list[i]!;
    checkTransition(cur.status, body.status);
    const next = cur.status === body.status ? cur : { ...cur, status: body.status, statusAt: this.nowIso() };
    list[i] = next;
    const cov = this.vdpCoverageNow();
    const key = candidateKey(next, slugByAccount(cov.vdps)) ?? next.targetKey;
    const verb = body.status === 'added' ? 'Marked added' : body.status === 'dismissed' ? 'Dismissed' : cur.status === 'unsure' ? 'Confirmed' : 'Put back';
    const entry = this.audit.record({ at: this.nowIso(), actor: 'user', action: `vdp.candidate.${body.status}`, summary: `${verb}: ${next.title} (VDP asset)`.slice(0, 200), entity: { type: 'vdp', id: key, label: next.companyName }, related: [], ops: [], undoable: false, undoOf: null });
    this.publish(['deals', 'audit'], [key], `vdp.candidate.${body.status}`);
    return { entity: vdpDetailCandidate({ coverage: cov, snapshots: this.vdpSnapshots() }, next), auditId: entry.id };
  }

  /** "Find assets" in mock mode: queued → running → done after a few seconds, with placeholder finds. Never calls anything. */
  async findVdpAssets({ body }: I<'findVdpAssets'>): Promise<Res<'findVdpAssets'>> {
    let b = this.vdpBudget();
    let auditId: string | null = null;
    if (body.allowUsd && !body.estimateOnly) {
      const s = this.store.settings();
      let out: ReturnType<typeof allowAssistantToday>;
      try {
        out = allowAssistantToday(s.budgets, { day: this.mockDay(), atIso: this.nowIso(), addUsd: body.allowUsd, lineUsd: b.lineUsd, assistantLeftUsd: b.dayLeftUsd, hardLeftUsd: b.hardLeftUsd, reason: 'Find assets for all' });
      } catch (e) {
        throw invalid(e instanceof Error ? e.message : String(e));
      }
      const { next: budgets, raise } = out;
      const { entry } = this.tx({ actor: 'user', action: 'settings.budgets', summary: raiseSummary(raise), entity: { type: 'settings', id: 'budgets', label: 'Settings · budgets' } }, (tx) => {
        tx.put('settings', { ...s, budgets });
        const sp = this.store.spend();
        const pct = raise.toSoftUsd > 0 ? Math.round((sp.today.usd / raise.toSoftUsd) * 100) : 0;
        tx.put('spend', { ...sp, today: { ...sp.today, softBudgetUsd: raise.toSoftUsd, hardCapUsd: raise.toHardUsd, pct }, state: sp.today.usd >= raise.toHardUsd ? 'capped' : pct >= budgets.alertPct ? 'soft_alert' : 'ok' });
      });
      auditId = entry?.id ?? null;
      b = this.vdpBudget();
    }
    const cov = this.vdpCoverageNow();
    const plan = planFindAssets({ body, coverage: cov, snapshots: this.vdpSnapshots(), accounts: this.store.all('accounts'), runs: this.vdpRuns, perRunUsd: b.perRunUsd, dayLeftUsd: b.dayLeftUsd });
    if (body.estimateOnly || !plan.queued.length) return { entity: { ...plan, started: false }, auditId };
    plan.queued.forEach((q, n) => {
      const t = targetForKey(q.key, cov, this.vdpSnapshots(), this.store.all('accounts'))!;
      const run = ++this.vdpRunSeq;
      const at = this.nowIso();
      this.vdpRuns.set(q.key, { status: 'queued', startedAt: at, finishedAt: null, found: 0, costUsd: null, note: null });
      const step = Math.max(20, this.delays.stepMs);
      this.later(step * (n + 1), () => {
        const r = this.vdpRuns.get(q.key);
        if (r?.status === 'queued') this.vdpRuns.set(q.key, { ...r, status: 'running' });
        this.publish(['deals'], [q.key], 'vdp.assets.running');
      });
      this.later(step * (n + 2), () => {
        const list = this.vdpCandidates();
        const finds = mockBackfillFinds(t, run, this.nowIso()).filter((f) => !list.some((c) => c.targetKey === f.targetKey && c.assetKey === f.assetKey) && !inVdp(f, t.inVdp));
        list.push(...finds);
        this.vdpRuns.set(q.key, { status: 'done', startedAt: at, finishedAt: this.nowIso(), found: finds.length, costUsd: 0, note: 'Simulated in mock mode: placeholder finds' });
        this.publish(['deals'], [q.key], 'vdp.assets.done');
      });
    });
    this.publish(['deals'], plan.queued.map((q) => q.key), 'vdp.assets.queued');
    return { entity: { ...plan, started: true }, auditId };
  }

  /**
   * Time ▸ "Log these" in mock mode: the same work orders and Outbox canvas items as the db, over the store's rows,
   * with placeholder Org62 ids (the seed has none). Nothing leaves: the simulated transport answers an Apply.
   */
  async stageLogBatch({ body }: I<'stageLogBatch'>): Promise<Res<'stageLogBatch'>> {
    const s = this.store.settings();
    const tz = s.profile.timezone;
    const logging = s.time.logging ?? { approveComplete: true };
    const takeProposed = body.includeProposed ?? logging.approveComplete;
    const profile = loggingProfile(personaOf(s));
    const now = this.now();
    const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
    const events: WorkOrderEvent[] = [];
    const approve: string[] = [];
    const skipped: Array<{ id: string; date: string; description: string; why: string }> = [];
    const held = canvasHolds(this.store.all('drafts'));
    const waiting = { rows: 0, hours: 0, draftIds: new Set<string>() };
    // D-70: what you ticked (rows, use cases, Event updates); nothing ticked: everything ready
    const sel = batchSelectionOf(body);
    const only = sel.rows;
    for (const e of body.dcOnly ? [] : [...this.store.all('activity')].sort((a, b) => a.start.localeCompare(b.start))) {
      if (Date.parse(e.end) > now.getTime() || !(e.status === 'approved' || (takeProposed && e.status === 'proposed'))) continue;
      // Log it ▸ the rows you ticked: only those (each still has to be ready)
      if (only && !only.has(e.id)) continue;
      const date = dayOf(e.start);
      if ((body.from && date < body.from) || (body.to && date > body.to)) continue;
      // already handed off by a sent canvas (the db also skips a row whose synced_to_canvas_at is set)
      // D-65: unless you put it back with Log again (not in Org62 after all, TL-14 / TL-20)
      if (held.sent?.has(e.id) && !e.issues.includes(LOG_AGAIN_FLAG)) continue;
      const holder = held.rows.get(e.id);
      if (holder) {
        waiting.rows += 1;
        waiting.hours += e.durationH;
        waiting.draftIds.add(holder);
        continue;
      }
      // a proposed row on an opp I'm not on waits for the user's own Approve (the db's buildLogBatch, same rule)
      if (e.status === 'proposed' && heldNotOnTeam(e.issues)) {
        skipped.push({ id: e.id, date, description: e.description, why: NOT_ON_TEAM_SKIP });
        continue;
      }
      // D-64: an internal row waits for your own Log; once approved it logs with Related To empty
      if (e.status === 'proposed' && e.internal) continue;
      // D-55: only a persona whose logging needs one (the SE's Solutions Events) asks for an SE task type
      const needsType = profile.taskTypeRequired && !e.taskType;
      if (needsType || (!e.oppId && !e.internal)) {
        skipped.push({ id: e.id, date, description: e.description, why: `needs ${[needsType ? 'an SE task type' : null, !e.oppId ? 'a WhatId (opportunity or account)' : null].filter(Boolean).join(' and ')}` });
        continue;
      }
      if (e.status === 'proposed') approve.push(e.id);
      events.push(this.workOrderEventOf(e, profile.taskTypeRequired));
    }
    const wait = { rows: waiting.rows, hours: waiting.hours, draftIds: [...waiting.draftIds] };
    // D-58: pending Deal Contribution requests ride on the batch as ADD rows (src/server/deals/dc-requests.ts)
    // ...on a canvas with rows; a canvas of their own only when asked (dcOnly: Log DCs now)
    const dcAdds = this.pendingDcAdds();
    // D-70: use cases are rows (they log on their own; the ticked ones only when you ticked some), and approved Event
    // updates ride in the UPDATE table ("update · Duration 2 h → 3 h")
    const planAll = !body.dcOnly && featureActive(personaOf(s), 'vdp') ? planUseCases(this.ucPlanInput()) : { creates: [], updates: [] };
    const ucOnly = sel.useCases;
    const plan = ucOnly ? { creates: planAll.creates.filter((c) => ucOnly.has(`uc:${c.vdpUseCaseId}`)), updates: planAll.updates.filter((u) => ucOnly.has(`uc:${u.vdpUseCaseId}`)) } : planAll;
    const evUpdates = body.dcOnly ? [] : eventUpdatesForBatch(this.landingStore, { approveComplete: takeProposed, only: sel.updates }).filter((u) => !held.updates.has(u.recordId));
    const updates = evUpdates.map(({ writeId: _w, ...u }) => u);
    const none = { entity: { draftIds: [], canvases: [], events: 0, hours: 0, approved: 0, skipped, waiting: wait, useCases: { rows: 0, later: 0 }, eventUpdates: 0 }, auditId: null };
    if (!events.length && !updates.length && !plan.creates.length && !plan.updates.length && !(body.dcOnly && dcAdds.length)) return none;
    const base = { ownerName: s.profile.name, ownerOrg62Id: '005XX0000000MOCKAA', recordTypeId: '012XX0000000MOCKAA', generatedAt: now.toISOString(), sourceLabel: 'Control Center (mock)', logging: { recordTypeName: profile.recordTypeName, taskTypeRequired: profile.taskTypeRequired } };
    // 2026-11-13 (B1): ONE canvas per batch: the rows, the DCs and (D-67) the VDP use cases; parts only past Slack's limit
    const span = batchSpan(events.map((e) => dayOf(e.startUtc))) ?? (updates.length ? 'Duration fixes' : null);
    const b = batchCanvases(base, { events, updates, dcs: dcAdds, ucCreates: plan.creates, ucUpdates: plan.updates }, { span, ...(body.dcOnly ? { dcOnly: true } : {}) });
    const uc = b.useCases;
    const canvases = b.canvases;
    if (!canvases.length) return none;
    const items = canvases.map((c) => {
      const dest = canvasActionFor({ title: c.title, markdown: c.markdown, eventIds: c.eventIds, hours: c.hours, updates: c.updates, updateIds: c.updateIds, part: c.part, parts: c.parts });
      return { title: c.title, hours: c.hours, rows: c.eventIds.length, updates: c.updates, draft: actionDraftFor(dest, { id: id('d'), now: this.nowIso(), rendered: (doc) => renderAll(dest, doc) }) };
    });
    const { entry } = this.tx({ actor: 'user', action: 'time.log_batch', summary: `Logging batch for approval: ${events.length} rows${dcAdds.length ? ` · ${dcAdds.length} DC${dcAdds.length === 1 ? '' : 's'}` : ''}${uc.rows ? ` · ${uc.rows} use case${uc.rows === 1 ? '' : 's'}` : ''}`, entity: { type: 'draft', id: items[0]!.draft.id, label: items[0]!.title } }, (tx) => {
      for (const aid of approve) {
        const cur = this.store.get('activity', aid);
        if (cur) tx.put('activity', this.bump({ ...cur, status: 'approved' }));
      }
      for (const x of items) tx.put('drafts', x.draft);
    });
    // D-70: the batch stages one write per canvas row (the db does it in the batch's transaction)
    this.landings();
    return {
      entity: { draftIds: items.map((x) => x.draft.id), canvases: items.map((x) => ({ draftId: x.draft.id, title: x.title, rows: x.rows, hours: x.hours, updates: x.updates })), events: events.length, hours: events.reduce((t, e) => t + e.durationH, 0), approved: approve.length, skipped, waiting: wait, useCases: { rows: uc.rows, later: uc.later }, eventUpdates: evUpdates.length },
      auditId: entry?.id ?? null,
    };
  }

  // ---- D-70 landings (docs/design/landings.md): the db's twin over memory (src/lib/landings) -------------------------

  /** The landings (not part of the undoable store, like the db's unaudited tables): reset with the store. */
  private landingStore: LandingStore = EMPTY_STORE;
  private landingWorld(): LandingWorld {
    const persona = personaOf(this.store.settings());
    const vdp = featureActive(persona, 'vdp');
    const input = vdp ? this.ucPlanInput() : null;
    return {
      now: this.nowIso(),
      drafts: this.store.all('drafts'),
      activity: this.store.all('activity'),
      dcRequests: featureActive(persona, 'dealContributions') ? this.dcRequests() : [],
      useCases: input ? { plan: planUseCases(input), input } : null,
      candidates: vdp ? this.vdpCandidates() : [],
    };
  }
  /** One landing sync over the store, and what the views read. */
  private landings() {
    const world = this.landingWorld();
    const r = syncLandings(this.landingStore, world, { newId: () => globalThis.crypto.randomUUID() });
    this.landingStore = applyChanges(this.landingStore, r.changes);
    const store = this.landingStore;
    const draftTitle = (did: string) => {
      const d = this.store.get('drafts', did);
      return d?.destination.kind === 'action' ? d.destination.target.label : null;
    };
    return { world, store, useCaseByKey: r.useCaseByKey, labelOf: labelsFor(world, store), draftTitle };
  }
  private useCaseView(L: ReturnType<MockDataSource['landings']>) {
    return ucLandingsView({ store: L.store, world: L.world, useCaseByKey: L.useCaseByKey, accountName: (aid) => this.store.get('accounts', aid)?.name ?? null, labelOf: L.labelOf, draftTitle: L.draftTitle, readAt: L.world.useCases?.input.org62.readAt ?? null });
  }

  async getCanvasWrites({ params }: I<'getCanvasWrites'>): Promise<Res<'getCanvasWrites'>> {
    const L = this.landings();
    const d = this.store.get('drafts', params.id) ?? null;
    if (!d && !L.store.writes.some((w) => w.draftId === params.id)) throw notFound('Logging canvas', params.id);
    return canvasWritesView(L.store, params.id, d, L.labelOf, L.draftTitle);
  }

  async getRecordLandings({ query }: I<'getRecordLandings'>): Promise<Res<'getRecordLandings'>> {
    const L = this.landings();
    return recordLandingsView(L.store, query.kind, query.id, L.labelOf, L.draftTitle);
  }

  async getEventUpdates(_i: I<'getEventUpdates'>): Promise<Res<'getEventUpdates'>> {
    const L = this.landings();
    return { updates: eventUpdatesView(L.store, (aid) => this.store.get('activity', aid)) };
  }

  async proposeEventUpdates({ body }: I<'proposeEventUpdates'>): Promise<Res<'proposeEventUpdates'>> {
    const L = this.landings();
    const r = proposeEventUpdates(L.store, body.candidates, { now: this.nowIso(), newId: () => globalThis.crypto.randomUUID(), activity: (aid) => this.store.get('activity', aid) });
    this.landingStore = applyChanges(this.landingStore, r.changes);
    this.publish(['time', 'deals'], r.proposed, 'landings.propose');
    return { proposed: r.proposed, skipped: r.skipped };
  }

  async patchEventUpdate({ params, body }: I<'patchEventUpdate'>): Promise<Res<'patchEventUpdate'>> {
    const L = this.landings();
    const r = patchEventUpdate(L.store, params.id, body.action, this.nowIso());
    if ('error' in r) throw r.error === 'not_found' ? notFound('Event update', params.id) : new AppError('conflict', r.why);
    this.landingStore = applyChanges(this.landingStore, r.changes);
    this.publish(['time', 'deals'], [params.id], `landings.${body.action}`);
    const row = eventUpdatesView(this.landingStore, (aid) => this.store.get('activity', aid)).find((x) => x.writeId === params.id)!;
    return { entity: row, auditId: null };
  }

  async getUseCaseLandings(_i: I<'getUseCaseLandings'>): Promise<Res<'getUseCaseLandings'>> {
    return this.useCaseView(this.landings());
  }

  async pickUseCaseValue({ params, body }: I<'pickUseCaseValue'>): Promise<Res<'pickUseCaseValue'>> {
    const L = this.landings();
    const view = this.useCaseView(L).items.find((x) => x.key === params.key);
    if (!view) throw notFound('Use case', params.key);
    const edit = pickEdit(view, L.world.useCases?.plan.items.find((x) => x.key === params.key), body);
    const label = body.take ? `${body.take === 'org62' ? 'Org62' : 'VDP'}’s ${body.field} is right for ${view.title}` : `Cleared your pick of ${view.title}’s ${body.field}`;
    const had = this.store.get('rowOverrides', edit.key);
    const { entry } = this.tx({ actor: 'user', action: 'use_case.pick', summary: label.slice(0, 200), entity: { type: 'settings', id: 'use_cases', label: view.title } }, (tx) => tx.put('rowOverrides', { key: edit.key, fields: { ...(had?.fields ?? {}), ...edit.fields }, at: this.nowIso() }));
    const after = this.useCaseView(this.landings()).items.find((x) => x.key === params.key) ?? view;
    return { entity: after, auditId: entry?.id ?? null };
  }

  async fixUseCase({ params, body }: I<'fixUseCase'>): Promise<Res<'fixUseCase'>> {
    const L = this.landings();
    const view = this.useCaseView(L).items.find((x) => x.key === params.key);
    if (!view) throw notFound('Use case', params.key);
    const opps = (L.world.useCases?.input.opps ?? []).map((o) => ({ org62Id: o.org62Id, open: o.isOpen, mine100: o.dcSplit === 100 }));
    const { edit, leave } = fixEdits(L.world.useCases?.plan.items.find((x) => x.key === params.key), body, opps);
    const tz = this.store.settings().profile.timezone || this.store.meta().timezone;
    const decisions = leave === true ? planNeedDecisions({ rule: UC_LEAVE, subjectIds: [params.key], kind: 'not_needed', reason: 'Not for Org62', label: view.title }, this.now(), this.store.all('opps'), tz) : [];
    const had = edit ? this.store.get('rowOverrides', edit.key) : undefined;
    const { entry } = this.tx({ actor: 'user', action: 'use_case.fix', summary: (leave === true ? `Left ${view.title} out of Org62` : leave === false ? `${view.title} goes to Org62 again` : `Answered ${view.title}`).slice(0, 200), entity: { type: 'settings', id: 'use_cases', label: view.title } }, (tx) => {
      if (edit) tx.put('rowOverrides', { key: edit.key, fields: { ...(had?.fields ?? {}), ...edit.fields }, at: this.nowIso() });
      for (const d of decisions) tx.put('needDecisions', d);
      if (leave === false && this.store.get('needDecisions', needKey(UC_LEAVE, params.key))) tx.remove('needDecisions', needKey(UC_LEAVE, params.key));
    });
    const after = this.useCaseView(this.landings()).items.find((x) => x.key === params.key) ?? view;
    return { entity: after, auditId: entry?.id ?? null };
  }

  /** A Time row's Event as a batch writes it (the db's batchEventOf): its note then the CC# key, the opp's placeholder id. */
  private workOrderEventOf(e: Collections['activity'], taskTypeRequired: boolean): WorkOrderEvent {
    // D-66: the row's note (yours, or the seed's draft), then the CC# key; none: one from the row's fields
    const origin = e.sources.some((x) => x.kind === 'calendar') || !e.sources.length ? 'calendar' : 'evidence';
    return eventRow({ id: e.id, subject: e.description, start: e.start, end: e.end, durationH: e.durationH, taskType: taskTypeRequired ? (e.taskType ?? '') : '', whatOrg62Id: !e.oppId ? '' : (this.store.get('opps', e.oppId)?.org62Url?.match(/\/(006\w{12,15})\//)?.[1] ?? mockOrg62IdFor(e.oppId)), origin, note: e.logNote, customer: e.accountName });
  }

  // ---- 2026-11-13 audit B2: the canvas review before Apply (the db's twin; src/server/time/canvas-review.ts) -------

  private canvasReview(draftId: string): Res<'getCanvasReview'> {
    const d = this.store.must('drafts', draftId, 'Draft');
    const names = new Map(this.store.all('opps').map((o) => [this.org62OppIdOf(o).slice(0, 15), o.name] as const));
    return canvasReviewOf(d, { entry: (id) => this.store.get('activity', id), dcRequests: this.dcRequests(), oppName: (id) => names.get(id.slice(0, 15)) ?? null, now: this.now() });
  }

  async getCanvasReview({ params }: I<'getCanvasReview'>): Promise<Res<'getCanvasReview'>> {
    return this.canvasReview(params.id);
  }

  async removeCanvasRows({ params, body }: I<'removeCanvasRows'>): Promise<Res<'removeCanvasRows'>> {
    const d = this.store.must('drafts', params.id, 'Draft');
    assertReviewable(d, body.ifVersion);
    const { input, removed } = withoutRows(canvasInputOf(d.destination as ActionDestination), body.keys);
    const label = (d.destination as ActionDestination).target.label;
    const { entry } = this.tx({ actor: 'user', action: 'canvas.rows.remove', summary: `Took ${removed.length} row${removed.length === 1 ? '' : 's'} off ${label}: back to waiting`.slice(0, 200), entity: { type: 'draft', id: d.id, label } }, (tx) => tx.put('drafts', this.bump(restagedCanvas(d, input))));
    // D-70: the rows taken off keep their writes, as removed
    this.landings();
    return { entity: this.canvasReview(d.id), auditId: entry?.id ?? null };
  }

  async editCanvasRow({ params, body }: I<'editCanvasRow'>): Promise<Res<'editCanvasRow'>> {
    const d = this.store.must('drafts', params.id, 'Draft');
    assertReviewable(d, body.ifVersion);
    const profile = loggingProfile(personaOf(this.store.settings()));
    const input = canvasInputOf(d.destination as ActionDestination);
    const row = reviewRowOf(input, body.key);
    const first = row.rows[0]!;
    const n = Number(first.cells[0]) || 1;
    const label = (d.destination as ActionDestination).target.label;
    const puts: Array<(tx: Parameters<Parameters<typeof this.tx>[1]>[0]) => void> = [];
    let lines: string[];
    let what = 'a row';
    if (row.kind === 'event' && body.event) {
      const cur = this.store.must('activity', first.ref ?? body.key, 'Activity entry');
      this.checkVersion(cur, body.event.entryVersion, 'Activity entry', cur);
      if (body.event.taskType !== undefined && profile.taskTypeRequired && !profile.taskTypes.includes(body.event.taskType)) throw invalid(`Not one of your task types: ${body.event.taskType}`);
      const patch = { ...(body.event.taskType !== undefined ? { taskType: body.event.taskType } : {}), ...(body.event.durationH !== undefined ? { durationH: body.event.durationH } : {}), ...(body.event.oppId !== undefined ? { oppId: body.event.oppId } : {}), ...(body.event.note !== undefined ? { logNote: body.event.note } : {}) };
      const opp = patch.oppId ? this.store.must('opps', patch.oppId, 'Opportunity') : undefined;
      const next = activityStamps(this.bump(patchedEntry(cur, patch, opp ? { name: opp.name, accountName: this.store.get('accounts', opp.accountId)?.name ?? null } : null).next));
      if ((profile.taskTypeRequired && !next.taskType) || (!next.oppId && !next.internal)) throw invalid(`That edit leaves the row unable to log: it needs ${profile.taskTypeRequired && !next.taskType ? 'an SE task type' : 'a WhatId (opportunity or account)'}`);
      // the row stays on this canvas as edited (not unstaged: TL-25 is for edits made elsewhere)
      puts.push((tx) => tx.put('activity', next));
      lines = [eventLine(n, this.workOrderEventOf(next, profile.taskTypeRequired))];
      what = cur.description;
    } else if ((row.kind === 'dc' || row.kind === 'dcchange') && body.dc) {
      const reqId = this.canvasReview(d.id).dcs.find((x) => x.key === body.key)?.requestId;
      const rec = reqId ? this.store.get('dcRequests', reqId) : undefined;
      const view = reqId ? this.dcRequests().find((x) => x.id === reqId) : undefined;
      if (!rec || !view) throw notFound('DC request', body.key);
      if (view.kind === 'change' && body.dc.split !== undefined && view.dc?.split === body.dc.split) throw invalid(`Your DC is at ${body.dc.split}% already: remove the row instead`);
      const next: DcRequestRecord = { ...rec, ...(body.dc.split !== undefined ? { splitPercent: body.dc.split } : {}), ...(body.dc.role !== undefined ? { role: body.dc.role } : {}), ...(body.dc.comment !== undefined ? { comment: body.dc.comment } : {}), updatedAt: this.nowIso() };
      puts.push((tx) => tx.put('dcRequests', next));
      const add = dcAddOf({ ...view, splitPercent: next.splitPercent, role: next.role, comment: next.comment, org62OpportunityId: view.org62OpportunityId ?? mockOrg62IdFor(view.oppId) });
      lines = view.kind === 'change' ? dcChangeRows(add).map((f, k) => f(n + k)) : [dcAddRow(n, add)];
      what = `the DC on ${view.oppName}`;
    } else if (row.kind === 'use_case' && body.useCase) {
      const fields = checkedUseCaseFields(body.useCase);
      const had = this.store.get('rowOverrides', body.key);
      puts.push((tx) => tx.put('rowOverrides', { key: body.key, fields: { ...(had?.fields ?? {}), ...fields }, at: this.nowIso() }));
      const c = withUcOverride(ucCreateOfRow(first), { fields });
      lines = [ucCreateLine(n, c)];
      what = `the use case ${c.name}`;
    } else if (row.kind === 'update' && body.update) {
      const v = checkedUpdateValue(first, body.update.newValue);
      puts.push((tx) => tx.put('rowOverrides', { key: body.key, fields: { newValue: v }, at: this.nowIso() }));
      lines = [updateLineWith(first, v)];
      what = `${first.cells[3]} on ${first.cells[2]}`;
    } else throw invalid(`That edit does not fit this row (a ${row.kind.replace('dcchange', 'DC change').replace('_', ' ')} row)`);
    const draft = this.bump(restagedCanvas(d, withRowReplaced(input, body.key, lines)));
    const { entry } = this.tx({ actor: 'user', action: 'canvas.rows.edit', summary: `Edited ${what} on ${label}`.slice(0, 200), entity: { type: 'draft', id: d.id, label } }, (tx) => {
      for (const p of puts) p(tx);
      tx.put('drafts', draft);
    });
    this.landings();
    return { entity: this.canvasReview(d.id), auditId: entry?.id ?? null };
  }

  async draftVdpUpdate({ body }: I<'draftVdpUpdate'>): Promise<Res<'draftVdpUpdate'>> {
    let dest: ActionDestination;
    if (body.itemKey) {
      // One item's Apply, rebuilt from the mirror (D-59): the call the page shows, never the client's ids.
      const cov = this.vdpCoverageNow();
      const c = body.itemKey.startsWith('asset:') ? this.vdpCandidates().find((x) => `asset:${x.id}` === body.itemKey) : undefined;
      const slug = c ? effectiveSlug(c, slugByAccount(cov.vdps)) : null;
      const views = slug ? (await this.getVdpDetail({ query: { key: slug } } as I<'getVdpDetail'>)).candidates.filter((x) => x.id === c!.id).map((x) => ({ id: x.id, vdpSlug: x.vdpSlug, title: x.title, apply: x.apply, draftId: x.draftId })) : [];
      dest = vdpActionForItem(cov, this.vdpSnapshots(), body, views, { duplicateOf: this.ucGuard() });
    } else {
      const snap = this.vdpSnapshots().find((s) => s.slug === body.vdpSlug);
      if (!snap) throw notFound('VDP', body.vdpSlug ?? '(none)');
      dest = vdpActionFor(snap, body, { duplicateOf: this.ucGuard() });
    }
    const draft = actionDraftFor(dest, { id: id('d'), now: this.nowIso(), workItemId: body.workItemId ?? null, rendered: (doc) => renderAll(dest, doc) });
    const { entry } = this.tx({ actor: 'user', action: 'vdp.update.draft', summary: `VDP change for approval: ${actionSummary(dest)}`.slice(0, 200), entity: { type: 'draft', id: draft.id, label: dest.target.label } }, (tx) => tx.put('drafts', draft));
    return { entity: { draft, destination: dest }, auditId: entry?.id ?? null };
  }

  /**
   * D-60, D-63: "Push N to VDP": the ticked items and what they need first, staged and applied in order on this click,
   * each new id passed down (the simulated transport; dry run records only). The mock has no worker: it runs here.
   */
  async pushVdpChanges({ body }: I<'pushVdpChanges'>): Promise<Res<'pushVdpChanges'>> {
    return startVdpPush(this.vdpPushPort(), body);
  }

  // ---- D-69: company identity (Change… on a company node); the mock never calls VDP

  async searchVdpCompanies({ query }: I<'searchVdpCompanies'>): Promise<Res<'searchVdpCompanies'>> {
    return searchResult(query.q, searchCompaniesLocal(query.q, this.vdpSnapshots(), this.vdpServer(), mockCompanySearch(query.q)), false, 'Placeholder companies (mock data)');
  }

  async setVdpIdentity({ body }: I<'setVdpIdentity'>): Promise<Res<'setVdpIdentity'>> {
    const next = overrideFrom(body, this.store.all('accounts'), this.nowIso());
    const all = nextOverrides(this.store.all('vdpIdentity'), next, body.key ?? null);
    const label = next.pick.kind === 'match' ? next.pick.name : `create “${next.pick.name}”`;
    const { entry } = this.tx({ actor: 'user', action: 'vdp.identity.set', summary: `VDP company: ${label} for ${next.accountIds.length} ${next.accountIds.length === 1 ? 'account' : 'accounts'} (yours)`.slice(0, 200), entity: { type: 'vdp', id: next.key, label } }, (tx) => {
      for (const o of this.store.all('vdpIdentity')) if (!all.some((x) => x.key === o.key)) tx.remove('vdpIdentity', o.key);
      for (const o of all) tx.put('vdpIdentity', o);
    });
    return { entity: { identity: identityIn(this.vdpCoverageNow(), next.key), overrides: this.store.all('vdpIdentity').length }, auditId: entry?.id ?? null };
  }

  async clearVdpIdentity({ body }: I<'clearVdpIdentity'>): Promise<Res<'clearVdpIdentity'>> {
    const cur = this.store.get('vdpIdentity', body.key);
    if (!cur) return { entity: { identity: identityIn(this.vdpCoverageNow(), body.key), overrides: this.store.all('vdpIdentity').length }, auditId: null };
    const rest = withoutOverride(this.store.all('vdpIdentity'), body.key);
    const { entry } = this.tx({ actor: 'user', action: 'vdp.identity.clear', summary: 'VDP company: back to the app’s own decision', entity: { type: 'vdp', id: body.key, label: cur.pick.name } }, (tx) => {
      tx.remove('vdpIdentity', body.key);
      for (const o of rest) tx.put('vdpIdentity', o);
    });
    return { entity: { identity: identityIn(this.vdpCoverageNow(), body.key), overrides: this.store.all('vdpIdentity').length }, auditId: entry?.id ?? null };
  }

  /** The push's port over the mock store (stage, withdraw, the simulated Outbox delivery, progress). */
  private vdpPushPort(): PushRoutePort {
    const vdpDrafts = () => new Map(this.store.all('drafts').filter((d) => d.destination.kind === 'action' && d.destination.action.startsWith('vdp.')).map((d) => [d.id, d] as const));
    return {
      now: () => this.now(),
      newId: () => id('push'),
      dryRunNow: async () => sendingSection(this.store.settings().sending).dryRun,
      // the mock's mirror is VDP itself (always current): a live push never waits for a read here (D-69 VD-22)
      state: async () => {
        const coverage = this.vdpCoverageNow();
        return { coverage: { ...coverage, lastReadAt: coverage.lastReadAt ? this.nowIso() : null }, snapshots: this.vdpSnapshots(), drafts: vdpDrafts(), duplicateOf: this.ucGuard() };
      },
      draft: async (draftId) => this.store.get('drafts', draftId) ?? null,
      stage: async (dest) => {
        const draft = actionDraftFor(dest, { id: id('d'), now: this.nowIso(), rendered: (doc) => renderAll(dest, doc) });
        this.tx({ actor: 'user', action: 'vdp.update.draft', summary: `VDP change for approval: ${actionSummary(dest)}`.slice(0, 200), entity: { type: 'draft', id: draft.id, label: dest.target.label } }, (tx) => tx.put('drafts', draft));
        return draft;
      },
      discard: async (draftId, reason) => {
        const d = this.store.get('drafts', draftId);
        if (!d || (d.status !== 'ready' && d.status !== 'failed')) return;
        this.tx({ actor: 'system', action: 'vdp.push.withdraw', summary: `${reason}: ${d.destination.kind === 'action' ? d.destination.target.label : 'VDP change'}`.slice(0, 200), entity: { type: 'draft', id: d.id, label: 'VDP change' }, undoable: false }, (tx) => tx.put('drafts', this.bump({ ...d, status: 'discarded', rejectedReason: reason })));
      },
      deliver: async (draft) => {
        try {
          const cur = this.store.get('drafts', draft.id) ?? draft;
          const r = await this.outbox.dispatch({ params: { id: cur.id }, body: { ifVersion: cur.version, mode: 'send', confirmToken: this.confirmTokenFor(cur, 'send') } } as I<'dispatchDraft'>);
          if (r.dryRun) return { outcome: 'dry_run', externalId: null, link: null, detail: 'Dry run: recorded, nothing sent' };
          return { outcome: 'applied', externalId: r.draft.externalId ?? null, link: r.draft.resultUrl ?? null, detail: 'Applied (simulated)' };
        } catch (err) {
          return { outcome: 'failed', externalId: null, link: null, detail: ((err as Error).message || 'Delivery failed').slice(0, 300) };
        }
      },
      progress: async (run) => {
        this.vdpPush = run;
        this.publish(['deals', 'outbox'], [], 'vdp.push');
      },
    };
  }

  /**
   * D-60: one VDP autopilot run in mock mode: the shared runner, staging each item from the placeholder mirror and
   * applying it through the simulated Outbox (never anything real). `auth` lets a test make VDP's sign-in stale.
   */
  async runVdpAutopilot(deps: { auth?: 'ok' | 'stale' } = {}): Promise<AutopilotRunResult> {
    if (deps.auth) this.vdpAuth = deps.auth;
    const port: AutopilotPort = {
      now: () => this.now(),
      settings: async () => ({ sending: this.store.settings().sending, timezone: this.store.settings().profile.timezone }),
      auth: async () => this.vdpAuth,
      ledger: async () => this.vdpLedger,
      saveLedger: async (next) => {
        this.vdpLedger = next;
        this.publish(['deals', 'outbox'], [], 'vdp.autopilot');
      },
      plan: async (ap) => {
        const b = this.vdpBudget();
        const r = this.vdpCoverageAndQueueBase({ candidates: this.vdpCandidates(), perRunUsd: b.perRunUsd, runUsd: expectedRunUsd(this.vdpRuns, b.perRunUsd), dayLeftUsd: b.dayLeftUsd, running: 0 }, ap);
        return { coverage: r.coverage, queue: r.queue, snapshots: this.vdpSnapshots() };
      },
      apply: async (_item, dest) => {
        if (sendingSection(this.store.settings().sending).dryRun) return { draftId: null, outcome: 'dry_run', detail: null, url: null };
        const draft = { ...actionDraftFor(dest, { id: id('d'), now: this.nowIso(), rendered: (doc) => renderAll(dest, doc) }), appliedBy: 'autopilot' as const };
        this.tx({ actor: 'system', action: 'vdp.autopilot.apply', summary: `VDP autopilot applied: ${actionSummary(dest)}`.slice(0, 200), entity: { type: 'draft', id: draft.id, label: dest.target.label } }, (tx) => tx.put('drafts', draft));
        try {
          const r = await this.outbox.dispatch({ params: { id: draft.id }, body: { ifVersion: draft.version, mode: 'send', confirmToken: this.confirmTokenFor(draft, 'send') } } as I<'dispatchDraft'>);
          // the draft keeps appliedBy: 'autopilot' through the dispatch (Outbox ▸ Sent: "Applied automatically")
          return r.dryRun ? { draftId: draft.id, outcome: 'dry_run', detail: null, url: null } : { draftId: draft.id, outcome: 'applied', detail: 'Applied (simulated)', url: r.draft.resultUrl };
        } catch (err) {
          return { draftId: draft.id, outcome: 'failed', detail: ((err as Error).message || 'Delivery failed').slice(0, 300), url: null };
        }
      },
    };
    return runVdpAutopilot(port);
  }

  async getAccount({ params }: I<'getAccount'>): Promise<Res<'getAccount'>> {
    const account = this.store.must('accounts', params.accountId, 'Account');
    // my DC (split, role) on each opp; dcAssigned = myDc held or Org62 says so (never a DC with no split shown)
    const opps = this.store.all('opps').filter((o) => o.accountId === account.id).map(withMyDcFlag);
    const items = this.store.all('workItems').filter((w) => w.accountId === account.id && w.state !== 'dismissed');
    const detail: AccountDetail = {
      account,
      opps,
      needs: this.dealsNeeds().filter((n) => n.accountId === account.id),
      initiatives: this.store.all('initiatives').filter((i) => i.accountId === account.id),
      items: items.map((w) => hydrateItem(this.store, w)),
      assets: this.store.all('assets').filter((a) => a.accountId === account.id),
      runs: this.store.all('agentRuns').filter((r) => items.some((w) => w.id === r.workItemId)),
      briefs: this.store
        .all('briefs')
        .filter((b) => b.accountId === account.id || (b.oppId && opps.some((o) => o.id === b.oppId)))
        .map((b) => this.promotedAs(b)),
      missed: this.store.all('missedOpps').filter((m) => m.accountName === account.name),
    };
    return detail;
  }

  // ---- Deal Contribution requests (D-58): ADD rows on the next logging canvas -----------------------------
  /** The requests as the contract shows them (where each one is: waiting, in a canvas item, handed off). */
  private dcRequests(): DcRequest[] {
    const recs = this.store.all('dcRequests');
    const holds = spendNotCreated(
      dcHolds(this.store.all('drafts')),
      recs.map((r) => {
        const o = this.store.get('opps', r.oppId);
        return { r, org62OppId: o ? this.org62OppIdOf(o) : null };
      }),
    );
    return recs
      .map((r) => {
        const o = this.store.get('opps', r.oppId);
        // the Org62 id the db would have (null without a link); the canvas row carries the placeholder the Time rows use
        return dcRequestView(r, o ? { name: o.name, accountId: o.accountId, accountName: this.store.get('accounts', o.accountId)?.name ?? null, org62OpportunityId: org62OppIdOf(o) } : null, holds, o ? this.org62OppIdOf(o) : null, o?.myDc ?? null);
      })
      .sort(dcRequestOrder);
  }

  /** The 006… id the mock uses for an opp (its link, else the placeholder the Time rows' WhatId uses). */
  private org62OppIdOf(o: Opportunity): string {
    return org62OppIdOf(o) ?? mockOrg62IdFor(o.id);
  }

  /**
   * D-67 in mock mode: the placeholder VDPs, the seed's opps and accounts (placeholder Org62 ids where the seed has
   * none, as the Time rows' WhatId), the canvases in the store, and a placeholder read of Org62 at the mock's clock
   * that found no use case (the mock never calls Org62).
   */
  /**
   * D-67 in mock mode: the placeholder Org62 use cases a read would have found and their links (none unless a test
   * sets them: the mock never calls Org62), at a placeholder read time (the mock's clock).
   */
  private ucRecords: Org62UseCase[] = [];
  private ucLinks: UseCaseLink[] = [];
  private useCaseDemo = false;
  /** D-70: the app's placeholder Org62 read-back (MockOptions.useCaseDemo). */
  private applyUseCaseDemo() {
    const d = mockOrg62UseCaseDemo(this.vdpSnapshots(), '005XX0000000MOCKAA', this.nowIso());
    this.ucRecords = d.records;
    this.ucLinks = d.links;
  }
  private ucPlanInput(): UseCasePlanInput {
    const accounts = this.store.all('accounts');
    const ents = gapEntities(accounts, this.store.all('opps'));
    const byId = new Map(accounts.map((a) => [a.id, a] as const));
    const accOrg62 = (id: string) => byId.get(id)?.org62Url?.match(/\/(001[A-Za-z0-9]{12,15})(?:\/|$|\?)/)?.[1] ?? `001XX${id.replace(/[^A-Za-z0-9]/g, '').slice(0, 10).padEnd(10, '0')}AAA`;
    return {
      vdps: this.vdpSnapshots().map((snapshot) => ({ snapshot, accountId: linkVdp(snapshot, ents.accounts, ents.opps).accountId })),
      opps: this.store.all('opps').map((o) => ({ id: o.id, org62Id: this.org62OppIdOf(o), name: o.name, accountId: o.accountId, accountOrg62Id: accOrg62(o.accountId), isOpen: o.isOpen, dcSplit: o.myDc?.split ?? null, closeDate: o.closeDate })),
      org62: { readAt: this.nowIso(), records: this.ucRecords },
      links: this.ucLinks,
      holds: ucHolds(this.store.all('drafts').map((d) => ({ ...d, sentAt: appliedAtOf(d) }))),
      me: '005XX0000000MOCKAA',
      decisions: ucDecisionsOf(this.store.all('needDecisions'), this.now()),
      overrides: rowOverridesOf(Object.fromEntries(this.store.all('rowOverrides').map((o) => [o.key, { fields: o.fields, at: o.at }] as const))),
    };
  }

  /** D-67: the duplicate check before a new use case is staged (both systems and what is on its way). */
  private ucGuard() {
    const i = this.ucPlanInput();
    return ucDuplicateGuard({ vdps: i.vdps, records: i.org62.records, opps: i.opps, drafts: this.store.all('drafts') });
  }

  async getUseCaseSync(_i: I<'getUseCaseSync'>): Promise<Res<'getUseCaseSync'>> {
    const input = this.ucPlanInput();
    return ucSyncView(planUseCases(input), input.org62.readAt);
  }

  async listDcRequests(_i: I<'listDcRequests'>): Promise<Res<'listDcRequests'>> {
    return { requests: this.dcRequests(), myDcs: myDcRowsOf(this.store.all('opps'), (aid) => this.store.get('accounts', aid)?.name ?? null) };
  }

  /**
   * A DC request record for an opp, after the shared rules (src/server/deals/dc-requests.ts): my DC with this split →
   * refused; another split → a change of my DC; one request in flight per opp. Stored by the caller's tx.
   */
  private dcRequestRecord(o: Opportunity, b: { split: number; comment: string; role?: string }): DcRequestRecord {
    const plan = planDcRequest({ name: o.name, dcAssigned: o.dcAssigned, myDc: o.myDc ?? null }, b.split);
    const live = this.dcRequests().find((r) => r.oppId === o.id && liveDcRequest(r));
    if (live) throw dcLiveConflict(o.name, live);
    const at = this.nowIso();
    return { id: id('dcr'), oppId: o.id, kind: plan.kind, role: b.role ?? dcRoleFor(personaOf(this.store.settings()).id), splitPercent: b.split, fromSplit: plan.fromSplit, comment: b.comment, status: 'approved', approvedAt: at, createdAt: at, updatedAt: at, org62DcId: plan.org62DcId };
  }

  async addOrg62Opps({ body }: I<'addOrg62Opps'>): Promise<Res<'addOrg62Opps'>> {
    const ids = [...new Map(body.org62Ids.map((i) => [i.trim().slice(0, 15), i.trim()] as const)).values()];
    const opps = this.store.all('opps');
    const view = (o: Opportunity): AddedOrg62Opp => ({ oppId: o.id, org62OpportunityId: this.org62OppIdOf(o), name: o.name, accountName: this.store.get('accounts', o.accountId)?.name ?? null });
    const tracked: AddedOrg62Opp[] = [];
    const want: string[] = [];
    for (const i of ids) {
      const o = resolveDcOpp(opps, i, (x) => this.org62OppIdOf(x));
      if (o) tracked.push(view(o));
      else want.push(i);
    }
    const found = want.flatMap((i) => {
      const r = this.mockOrg62Opp(i);
      return r ? [r] : [];
    });
    const missing = want.filter((i) => !this.mockOrg62Opp(i));
    if (!found.length) return { entity: { added: [], tracked, missing }, auditId: null };
    const at = this.nowIso();
    const { entry, result } = this.tx({ actor: 'user', action: 'deals.add_org62_opps', summary: `Added from Org62: ${found.length === 1 ? found[0]!.Name : `${found.length} opportunities`}`.slice(0, 200), entity: { type: 'opportunity', id: mockOppIdFor(found[0]!.Id), label: found[0]!.Name } }, (tx) => found.map((r) => this.putMockOrg62Opp(tx, r, at)));
    return { entity: { added: result.map((o) => ({ ...view(o), org62OpportunityId: this.org62OppIdOf(o) })), tracked, missing }, auditId: entry?.id ?? null };
  }

  async createDcRequest({ body }: I<'createDcRequest'>): Promise<Res<'createDcRequest'>> {
    if (!featureActive(personaOf(this.store.settings()), 'dealContributions')) throw invalid(DC_INACTIVE);
    const want = body.opp.trim();
    const have = resolveDcOpp(this.store.all('opps'), want, (x) => this.org62OppIdOf(x));
    // an Org62 id the app doesn't track (a teammate's deal): read from Org62 and added with the request, one change set
    const org62 = have ? null : ORG62_OPP_ID.test(want) ? this.mockOrg62Opp(want) : null;
    if (!have && !ORG62_OPP_ID.test(want)) throw new AppError('not_found', dcOppNotFound(want));
    if (!have && !org62) throw new AppError('not_found', dcOppNotInOrg62(want));
    const at = this.nowIso();
    const o: Opportunity = have ?? { id: mockOppIdFor(org62!.Id), accountId: '', name: org62!.Name, stage: org62!.StageName, amount: org62!.Amount, closeDate: org62!.CloseDate, isOpen: !org62!.IsClosed, isMine: false, dcAssigned: false, vdpLinked: false, hoursQtd: 0, nextStep: null, nextStepRead: false, products: [], owner: null, org62Url: org62RecordUrl('Opportunity', org62!.Id), myDc: null, forecastCategory: org62!.ForecastCategoryName, isWon: org62!.IsWon, updatedAt: at };
    const rec = this.dcRequestRecord(o, body);
    // DC-31: Claim DC on Deals answers the sweep's open finding on the opp too (as Missed ▸ Claim does)
    const finding = this.store.all('missedOpps').find((m) => m.oppId === o.id && m.status === 'new');
    const { entry } = this.tx({ actor: 'user', action: 'dc.request', summary: `${dcRequestWords({ kind: rec.kind, fromSplit: rec.fromSplit, split: rec.splitPercent })}: ${o.name}${org62 ? ', added from Org62' : ''}`.slice(0, 200), entity: { type: 'opportunity', id: o.id, label: o.name } }, (tx) => {
      if (org62) this.putMockOrg62Opp(tx, org62, at);
      tx.put('dcRequests', rec);
      if (finding) tx.put('missedOpps', { ...finding, status: 'claimed', dcRequestId: rec.id });
    });
    return { entity: this.dcRequests().find((x) => x.id === rec.id)!, auditId: entry?.id ?? null };
  }

  async patchDcRequest({ params, body }: I<'patchDcRequest'>): Promise<Res<'patchDcRequest'>> {
    if (!featureActive(personaOf(this.store.settings()), 'dealContributions')) throw invalid(DC_INACTIVE);
    const rec = this.store.must('dcRequests', params.id, 'DC request');
    const cur = this.dcRequests().find((x) => x.id === rec.id)!;
    assertDcEditable(cur, 'edit');
    const o = this.store.get('opps', rec.oppId);
    const split = body.split ?? rec.splitPercent;
    const plan = planDcRequest({ name: cur.oppName, dcAssigned: o?.dcAssigned ?? false, myDc: o?.myDc ?? null }, split);
    const next: DcRequestRecord = { ...rec, kind: plan.kind, fromSplit: plan.fromSplit, org62DcId: plan.org62DcId, splitPercent: split, ...(body.role !== undefined ? { role: body.role } : {}), ...(body.comment !== undefined ? { comment: body.comment } : {}), updatedAt: this.nowIso() };
    const { entry } = this.tx({ actor: 'user', action: 'dc.request.edit', summary: `Edited the DC request: ${cur.oppName} (${dcRequestWords({ kind: plan.kind, fromSplit: plan.fromSplit, split })})`.slice(0, 200), entity: { type: 'opportunity', id: rec.oppId, label: cur.oppName } }, (tx) => tx.put('dcRequests', next));
    return { entity: this.dcRequests().find((x) => x.id === rec.id)!, auditId: entry?.id ?? null };
  }

  async withdrawDcRequest({ params }: I<'withdrawDcRequest'>): Promise<Res<'withdrawDcRequest'>> {
    if (!featureActive(personaOf(this.store.settings()), 'dealContributions')) throw invalid(DC_INACTIVE);
    const rec = this.store.must('dcRequests', params.id, 'DC request');
    const cur = this.dcRequests().find((x) => x.id === rec.id)!;
    assertDcEditable(cur, 'withdraw');
    const { entry } = this.tx({ actor: 'user', action: 'dc.request.withdraw', summary: `Withdrew the DC request: ${cur.oppName} (${rec.splitPercent}%)`.slice(0, 200), entity: { type: 'opportunity', id: rec.oppId, label: cur.oppName } }, (tx) => tx.put('dcRequests', { ...rec, status: 'dismissed', updatedAt: this.nowIso() }));
    return { entity: this.dcRequests().find((x) => x.id === rec.id)!, auditId: entry?.id ?? null };
  }

  /** 2026-11-13 audit C7: the db's withdrawDcRequests: every waiting one (or the ids asked) in one change set, one Undo. */
  async withdrawDcRequests({ body }: I<'withdrawDcRequests'>): Promise<Res<'withdrawDcRequests'>> {
    if (!featureActive(personaOf(this.store.settings()), 'dealContributions')) throw invalid(DC_INACTIVE);
    const plan = planWithdrawDcs(this.dcRequests(), body?.ids);
    if (!plan.withdraw.length) return { entity: { withdrawn: [], skipped: plan.skipped }, auditId: null };
    const n = plan.withdraw.length;
    const at = this.nowIso();
    const first = plan.withdraw[0]!;
    const { entry } = this.tx({ actor: 'user', action: 'dc.request.withdraw_all', summary: `Withdrew ${n} DC ${n === 1 ? 'request' : 'requests'} waiting for a canvas`, entity: { type: 'opportunity', id: first.oppId, label: first.oppName } }, (tx) => {
      for (const x of plan.withdraw) {
        const rec = this.store.must('dcRequests', x.id, 'DC request');
        tx.put('dcRequests', { ...rec, status: 'dismissed', updatedAt: at });
      }
    });
    return { entity: { withdrawn: plan.withdraw.map((x) => x.id), skipped: plan.skipped }, auditId: entry?.id ?? null };
  }

  /**
   * What an Org62 scan read of my DCs does here (the db's projection: deal_contributions + syncMyDcs): each opp's
   * `myDc` (split, role; DC-14: two of mine on one opp summed) and `dcAssigned`, then the reconcile (D-68): requests
   * confirmed, withdrawn or `not_created` (`reconcileDcRequests`). `complete`: the list is every DC of mine (a complete
   * book read at now): an opp it leaves out loses its DC and flag (DC-11), and "not created" can be decided. Tests call
   * it; nothing else writes my DCs in the mock. Returns the requests it confirmed.
   */
  recordMyDcs(dcs: ReadonlyArray<{ oppId: string; split: number | null; role: string | null; org62DcId: string }>, o: { complete?: boolean } = {}): number {
    const at = this.nowIso();
    const byOpp = myDcsByOpp(dcs.map((d) => ({ split: d.split, role: d.role, org62DcId: d.org62DcId, lastSeenAt: at, oppId: d.oppId })));
    let confirmed = 0;
    this.tx({ actor: 'connector', action: 'org62.dcs', summary: `Org62 scan: ${dcs.length} DC${dcs.length === 1 ? '' : 's'} of mine`, entity: { type: 'opportunity', id: dcs[0]?.oppId ?? 'none', label: 'My DCs' } }, (tx) => {
      for (const [oppId, dc] of byOpp) {
        const opp = this.store.get('opps', oppId);
        if (opp) tx.put('opps', { ...opp, myDc: dc, dcAssigned: true });
      }
      // DC-11: a complete read without my DC on an opp: the DC was removed in Org62, and the flag goes with it
      if (o.complete) for (const opp of this.store.all('opps')) if ((opp.myDc || opp.dcAssigned) && !byOpp.has(opp.id)) tx.put('opps', { ...opp, myDc: null, dcAssigned: false });
    });
    const plan = reconcileDcRequests({
      requests: this.dcRequests(),
      read: o.complete ? { at, complete: true } : null,
      deliveredAt: new Map(this.store.all('drafts').map((d) => [d.id, d.updatedAt] as const)),
      openOppIds: new Set(this.store.all('opps').filter((x) => x.isOpen).map((x) => x.id)),
    });
    if (plan.confirm.length || plan.close.length) {
      this.tx({ actor: 'connector', action: 'org62.dcs.reconcile', summary: `Org62 scan: ${plan.confirm.length} DC request${plan.confirm.length === 1 ? '' : 's'} confirmed, ${plan.close.length} closed`, entity: { type: 'opportunity', id: (plan.confirm[0] ?? plan.close[0]?.request)!.oppId, label: 'DC requests' } }, (tx) => {
        for (const r of plan.confirm) {
          const rec = this.store.get('dcRequests', r.id);
          if (rec) tx.put('dcRequests', { ...rec, status: 'verified', org62DcId: r.dc?.org62DcId ?? rec.org62DcId, updatedAt: at });
        }
        for (const { request, outcome } of plan.close) {
          const rec = this.store.get('dcRequests', request.id);
          if (rec) tx.put('dcRequests', { ...rec, status: 'dismissed', outcome, updatedAt: at });
          // not created: the finding it claimed is open again
          if (outcome === 'not_created') for (const m of this.store.all('missedOpps')) if (m.dcRequestId === request.id && m.status === 'claimed') tx.put('missedOpps', { ...m, status: 'new' });
        }
      });
      confirmed = plan.confirm.length;
    }
    return confirmed;
  }

  /** The pending DC rows a logging batch takes (when the role has deal contributions). */
  private pendingDcAdds(): DcAdd[] {
    if (!featureActive(personaOf(this.store.settings()), 'dealContributions')) return [];
    // placeholder Org62 ids for opps the seed has no link for (as the Time rows' WhatId), so the mock canvas shows them
    return pendingDcAdds(this.dcRequests().map((r) => ({ ...r, org62OpportunityId: r.org62OpportunityId ?? mockOrg62IdFor(r.oppId) })));
  }

  async claimMissed({ params, body }: I<'claimMissed'>): Promise<Res<'claimMissed'>> {
    const m = this.store.must('missedOpps', params.id, 'Missed opp');
    if (m.status !== 'new') throw invalid(`Already ${m.status}`);
    const r = this.claimMissedTx(m, body ?? {});
    return { entity: this.store.get('missedOpps', m.id)!, auditId: r.entry?.id ?? null, receipt: this.receiptFrom(r.entry, r.ops, 'user', `Claimed ${m.oppName}`) };
  }

  /**
   * One Claim verb (Missed ▸ Claim, Triage's Claim): a DC request on the finding's opp, with the createDcRequest rules.
   * Only when the app doesn't know the opp, the old fallback: a task to add the DC by hand.
   */
  private claimMissedTx(m: MissedOpp, body: ClaimMissedRequest = {}) {
    const opp = m.oppId ? this.store.get('opps', m.oppId) : undefined;
    if (opp && featureActive(personaOf(this.store.settings()), 'dealContributions')) {
      const rec = this.dcRequestRecord(opp, { split: body.split ?? 100, comment: body.comment ?? claimComment(m.evidence), ...(body.role ? { role: body.role } : {}) });
      return this.tx({ actor: 'user', action: 'missed.claim', summary: `Claimed ${m.oppName}`, entity: { type: 'missed_opp', id: m.id, label: m.oppName } }, (tx) => {
        tx.put('dcRequests', rec);
        tx.put('missedOpps', { ...m, status: 'claimed', dcRequestId: rec.id });
      });
    }
    return this.claimTaskTx(m);
  }

  private claimTaskTx(m: MissedOpp) {
    const now = this.nowIso();
    const account = this.store.all('accounts').find((a) => a.name === m.accountName);
    const task: WorkItemRecord = {
      ...blankItem(now, this.store.meta().user),
      id: id('w'),
      kind: 'task',
      state: 'open',
      title: `Add yourself as DC on ${m.oppName}`,
      purpose: `Missed-opp sweep: ${m.accountName}`,
      accountId: account?.id ?? null,
      oppId: m.oppId,
      confidence: 'likely',
      why: m.evidence[0] ?? 'Possible missed opportunity',
      sources: [{ kind: 'org62', label: `Org62 · ${m.oppName}` }],
      effort: { youMin: 10, agentMin: 0 },
      signals: { customerFacing: false, fromManager: false, boost: 0 },
    };
    return this.tx({ actor: 'user', action: 'missed.claim', summary: `Claimed ${m.oppName}`, entity: { type: 'missed_opp', id: m.id, label: m.oppName } }, (tx) => {
      tx.put('workItems', task);
      tx.put('missedOpps', { ...m, status: 'claimed', claimedWorkItemId: task.id });
    });
  }

  async dismissMissed({ params, body }: I<'dismissMissed'>): Promise<Res<'dismissMissed'>> {
    const m = this.store.must('missedOpps', params.id, 'Missed opp');
    const { entry, result } = this.tx({ actor: 'user', action: 'missed.dismiss', summary: `Dismissed ${m.oppName}: ${body.reason}`, entity: { type: 'missed_opp', id: m.id, label: m.oppName } }, (tx) =>
      tx.put('missedOpps', { ...m, status: 'dismissed', dismissReason: body.note ? `${body.reason}: ${body.note}` : body.reason }),
    );
    return { entity: result, auditId: entry?.id ?? null };
  }

  // =========================================================================
  // Briefs and watches
  // =========================================================================

  async getBriefs(_i: I<'getBriefs'>): Promise<Res<'getBriefs'>> {
    const summary = (b: Brief) => ({ id: b.id, kind: b.kind, title: b.title, unread: b.unread, worthALook: b.highlights.filter((h) => h.status === 'new' || h.status === 'seen').length, through: b.through, status: b.status });
    const briefs = this.store.all('briefs').sort((a, b) => b.through.localeCompare(a.through));
    const watched = briefs.filter((b) => b.kind !== 'opp').map(summary);
    const opportunities = briefs.filter((b) => b.kind === 'opp').map(summary);
    return {
      watched,
      opportunities,
      watches: this.store.all('watches'),
      counts: { unread: briefs.filter((b) => b.unread).length, worthALook: [...watched, ...opportunities].reduce((s, b) => s + b.worthALook, 0) },
    };
  }

  /** Reading a brief marks it read (no audit). */
  async getBrief({ params }: I<'getBrief'>): Promise<Res<'getBrief'>> {
    const b = this.store.must('briefs', params.id, 'Brief');
    if (b.unread) this.tx({ actor: 'user', action: 'brief.read', summary: 'Read', entity: { type: 'brief', id: b.id, label: b.title }, audit: false }, (tx) => tx.put('briefs', { ...b, unread: false }));
    return this.promotedAs(this.store.get('briefs', b.id)!);
  }

  /** A promoted highlight's one state (in Triage, or a task), from its item. Read-time only, like the db twin. */
  private promotedAs<B extends Pick<Brief, 'highlights'>>(b: B): B {
    return withPromotedAs(b, (wid) => this.store.get('workItems', wid)?.state);
  }

  private highlight(hid: string): { brief: Brief; h: BriefHighlight } {
    for (const brief of this.store.all('briefs')) {
      const h = brief.highlights.find((x) => x.id === hid);
      if (h) return { brief, h };
    }
    throw notFound('Highlight', hid);
  }

  private highlightAction(hid: string, ifVersion: number | undefined, kind: 'promote' | 'task' | 'dismiss') {
    const { brief, h } = this.highlight(hid);
    this.checkVersion(h, ifVersion, 'Highlight', h);
    if (h.status === 'promoted' || h.status === 'dismissed') throw invalid(`Highlight already ${h.status}`);
    const now = this.nowIso();
    let workItemId: string | null = null;
    const r = this.tx({ actor: 'user', action: `highlight.${kind}`, summary: `${kind === 'dismiss' ? 'Not relevant' : kind === 'task' ? 'Made task' : 'Promoted'}: ${h.title}`, entity: { type: 'brief_highlight', id: h.id, label: h.title } }, (tx) => {
      if (kind !== 'dismiss') {
        const item: WorkItemRecord = {
          ...blankItem(now, this.store.meta().user),
          id: id('w'),
          state: kind === 'task' ? 'open' : 'suggested',
          title: h.title,
          purpose: `From brief: ${brief.title}`,
          accountId: brief.accountId,
          oppId: brief.oppId,
          confidence: h.relevance === 'high' ? 'likely' : 'guess',
          why: h.reasons[0],
          whyDetail: h.reasons.join(' · '),
          sources: h.sources,
          signals: { customerFacing: !!brief.accountId || !!brief.oppId, fromManager: false, boost: 0 },
        };
        workItemId = item.id;
        tx.put('workItems', item);
      }
      const next: BriefHighlight = { ...h, version: h.version + 1, status: kind === 'dismiss' ? 'dismissed' : 'promoted', promotedWorkItemId: workItemId };
      tx.put('briefs', { ...brief, highlights: brief.highlights.map((x) => (x.id === h.id ? next : x)) });
      return next;
    });
    return { entity: this.promotedAs({ highlights: [r.result] }).highlights[0]!, auditId: r.entry?.id ?? null };
  }

  async promoteHighlight({ params, body }: I<'promoteHighlight'>): Promise<Res<'promoteHighlight'>> {
    return this.highlightAction(params.id, body.ifVersion, 'promote');
  }
  async taskFromHighlight({ params, body }: I<'taskFromHighlight'>): Promise<Res<'taskFromHighlight'>> {
    return this.highlightAction(params.id, body.ifVersion, 'task');
  }
  async dismissHighlight({ params, body }: I<'dismissHighlight'>): Promise<Res<'dismissHighlight'>> {
    return this.highlightAction(params.id, body.ifVersion, 'dismiss');
  }

  async listWatches(_i: I<'listWatches'>): Promise<Res<'listWatches'>> {
    return { watches: this.store.all('watches') };
  }

  async createWatch({ body }: I<'createWatch'>): Promise<Res<'createWatch'>> {
    const w = { id: id('watch'), version: 1, ...body, enabled: true, createdAt: this.nowIso(), updatedAt: this.nowIso() };
    const { entry } = this.tx({ actor: 'user', action: 'watch.create', summary: `Watching ${w.label}`, entity: { type: 'watch', id: w.id, label: w.label } }, (tx) => tx.put('watches', w));
    return { entity: w, auditId: entry?.id ?? null };
  }

  async patchWatch({ params, body }: I<'patchWatch'>): Promise<Res<'patchWatch'>> {
    const w = this.store.must('watches', params.id, 'Watch');
    this.checkVersion(w, body.ifVersion, 'Watch', w);
    const next = this.bump({ ...w, ...body.patch });
    const { entry } = this.tx({ actor: 'user', action: 'watch.edit', summary: `Edited watch ${w.label}`, entity: { type: 'watch', id: w.id, label: w.label } }, (tx) => tx.put('watches', next));
    return { entity: next, auditId: entry?.id ?? null };
  }

  // =========================================================================
  // Triage
  // =========================================================================

  async getTriage(_i: I<'getTriage'>): Promise<Res<'getTriage'>> {
    // SETTLE-1: the Closed for you group (last 14 days), each with the undo id of its latest close (as Today's rail)
    const closes = this.audit.entries.filter((e) => e.action === 'item.close' && !e.undoneAt);
    return buildTriage(this.store, {
      sinceMs: this.now().getTime() - CLOSED_WINDOW_DAYS * 86_400_000,
      undoOf: (id) => closes.findLast((e) => e.entity.id === id)?.id ?? null,
    });
  }

  private triageItem(tid: string): TriageItem {
    const found = buildTriage(this.store).groups.flatMap((g) => g.items).find((i) => i.id === tid);
    if (found) return found;
    throw notFound('Triage item', tid);
  }

  private triageView(tid: string, fallback: TriageItem): TriageItem {
    const w = this.store.get('workItems', tid);
    const m = this.store.get('missedOpps', tid);
    const q = this.store.get('mappings', tid);
    return { ...fallback, workItem: w ? hydrateItem(this.store, w) : fallback.workItem, missedOpp: m ?? fallback.missedOpp, mapping: q ?? fallback.mapping };
  }

  async acceptTriage({ params, body }: I<'acceptTriage'>): Promise<Res<'acceptTriage'>> {
    const t = this.triageItem(params.id);
    let auditId: string | null = null;
    if (t.kind === 'work_item') {
      const cur = this.item(t.id);
      const locks = new Set(cur.userLockedFields);
      for (const k of Object.keys(body.edits ?? {})) if (ITEM_PATCH_LOCK[k]) locks.add(ITEM_PATCH_LOCK[k]);
      const next = this.bump({ ...cur, ...(body.edits ?? {}), state: 'open', userLockedFields: [...locks] } as WorkItemRecord);
      auditId = this.tx({ actor: 'user', action: 'triage.accept', summary: `Accepted: ${cur.title}`, entity: itemRef(cur) }, (tx) => tx.put('workItems', next)).entry?.id ?? null;
    } else if (t.kind === 'missed_opp') {
      auditId = this.claimMissedTx(t.missedOpp!).entry?.id ?? null;
    } else {
      const q = t.mapping!;
      if (!body.choiceId || !q.choices.some((c) => c.id === body.choiceId)) throw invalid('Pick one of the choices (choiceId)', { choices: q.choices });
      auditId = this.tx({ actor: 'user', action: 'triage.map', summary: `Mapped ${q.subject.label}`, entity: { type: 'triage_mapping', id: q.id, label: q.question } }, (tx) => tx.put('mappings', { ...q, status: 'answered', answerId: body.choiceId! })).entry?.id ?? null;
    }
    return { entity: this.triageView(t.id, t), auditId };
  }

  async dismissTriage({ params, body }: I<'dismissTriage'>): Promise<Res<'dismissTriage'>> {
    const t = this.triageItem(params.id);
    const now = this.nowIso();
    const r = this.tx({ actor: 'user', action: 'triage.dismiss', summary: `Dismissed: ${t.title}`, entity: { type: t.kind === 'work_item' ? 'work_item' : t.kind === 'missed_opp' ? 'missed_opp' : 'triage_mapping', id: t.id, label: t.title } }, (tx) => {
      if (t.kind === 'work_item') {
        const cur = this.item(t.id);
        tx.put('workItems', this.bump({ ...cur, state: 'dismissed', dismissed: { reason: 'other', note: body.note ? `${body.reason}: ${body.note}` : body.reason, at: now } }));
      } else if (t.kind === 'missed_opp') tx.put('missedOpps', { ...t.missedOpp!, status: 'dismissed', dismissReason: body.reason });
      else tx.put('mappings', { ...t.mapping!, status: 'dismissed' });
    });
    return { entity: this.triageView(t.id, t), auditId: r.entry?.id ?? null };
  }

  async mergeTriage({ params, body }: I<'mergeTriage'>): Promise<Res<'mergeTriage'>> {
    const t = this.triageItem(params.id);
    if (t.kind !== 'work_item') throw invalid('Only work items can be merged');
    const src = this.item(t.id);
    const into = this.item(body.intoId);
    if (src.id === into.id) throw invalid('Cannot merge an item into itself');
    const r = this.tx({ actor: 'user', action: 'triage.merge', summary: `Merged "${src.title}" into "${into.title}"`, entity: itemRef(src), related: [itemRef(into)] }, (tx) => {
      let moved = 0;
      for (const e of this.store.all('evidence')) if (e.workItemId === src.id) {
        tx.put('evidence', { ...e, workItemId: into.id, isNew: true });
        moved++;
      }
      tx.put('workItems', this.bump({ ...src, state: 'dismissed', dismissed: { reason: 'other', note: `Merged into ${into.title}`, at: this.nowIso() } }));
      tx.put('workItems', this.bump({ ...into, newEvidenceCount: into.newEvidenceCount + Math.max(1, moved), sources: [...into.sources, ...src.sources.filter((s) => !into.sources.some((x) => x.label === s.label))] }));
    });
    return { entity: this.triageView(t.id, t), auditId: r.entry?.id ?? null, receipt: this.receiptFrom(r.entry, r.ops, 'user', 'Merged') };
  }

  // =========================================================================
  // Health
  // =========================================================================

  async getHealth(_i: I<'getHealth'>): Promise<Res<'getHealth'>> {
    const jobs = this.store.all('jobs');
    const vdpCommand = vdpRefreshCommand(this.store.settings().scanning);
    const health: Res<'getHealth'> = {
      connectors: this.store.all('connectors').map((c) => withReauthCommand(c, vdpCommand)),
      summary: healthSummary(this.store),
      spend: this.store.spend(),
      worker: { alive: true, lastHeartbeatAt: this.nowIso(), queueDepth: jobs.filter((j) => j.status === 'queued' || j.status === 'retrying').length },
      dryRun: this.store.settings().sending.dryRun,
      firstScan: this.onboarding.firstScanProgress(), // B-079: the simulated first scan after mock onboarding
      vdpAutopilot: autopilotHealth(this.vdpAutopilotInputs()), // D-60
    };
    // D-55: a source the persona has not activated has no Health row (it is listed in Settings ▸ Role & rules)
    return healthForPersona(health, personaOf(this.store.settings()));
  }

  async getSpendAudit({ query }: I<'getSpendAudit'>): Promise<Res<'getSpendAudit'>> {
    return mockSpendAudit(this.store.spend(), query ?? {}, { now: new Date(this.nowIso()), timezone: this.store.settings().profile.timezone });
  }

  async getSpendAuditDetail({ query }: I<'getSpendAuditDetail'>): Promise<Res<'getSpendAuditDetail'>> {
    return mockSpendAuditDetail(this.store.spend(), query);
  }

  async getReadme(_i: I<'getReadme'>): Promise<Res<'getReadme'>> {
    return readReadme();
  }

  async getGuide(_i: I<'getGuide'>): Promise<Res<'getGuide'>> {
    const settings = this.store.settings();
    const threads = this.store.all('chatThreads').map((t) => t.thread);
    return guidePayload({
      connectors: this.store.all('connectors'),
      drafts: this.store.all('drafts'),
      assistantMessages: threads.reduce((n, t) => n + t.messageCount, 0),
      firstScan: null,
      persona: personaOf(settings),
      personaVersion: settings.persona.version,
      guide: settings.guide,
    });
  }

  async getVersion(_i: I<'getVersion'>): Promise<Res<'getVersion'>> {
    // Mock: no database and no worker process; the persona is the mock settings'.
    return versionPayload({ build: buildInfo(), migration: null, persona: personaOf(this.store.settings()), workerVersion: null, dataSource: 'mock' });
  }

  async reauthConnector({ params }: I<'reauthConnector'>): Promise<Res<'reauthConnector'>> {
    const vdpCommand = vdpRefreshCommand(this.store.settings().scanning);
    const c = withReauthCommand(this.store.must('connectors', params.id, 'Connector'), vdpCommand);
    const action = c.reauth ?? { kind: 'instructions' as const, label: 'No re-auth needed', command: null, instructions: `${c.label} does not need re-auth` };
    const started = action.kind === 'in_app' || action.kind === 'refresh_script' || action.kind === 'terminal_command';
    if (started) {
      this.tx({ actor: 'user', action: 'connector.reauth', summary: `Re-auth started: ${c.label}`, entity: { type: 'connector', id: c.id, label: c.label }, audit: false }, (tx) => tx.put('connectors', { ...c, state: 'catching_up', since: this.nowIso(), catchUpPct: 0, impact: `Catching up ${c.label}…` }));
      const steps = [35, 70, 100];
      steps.forEach((pct, i) =>
        this.later(this.delays.stepMs * (i + 1), () => {
          const cur = this.store.get('connectors', c.id);
          if (!cur || cur.state !== 'catching_up') return;
          if (pct === 100) this.engineConnectorState(c.id, 'ok', undefined, undefined, { actor: 'connector' });
          else this.tx({ actor: 'connector', action: 'connector.catch_up', summary: `${c.label} ${pct}%`, entity: { type: 'connector', id: c.id, label: c.label }, audit: false }, (tx) => tx.put('connectors', { ...cur, catchUpPct: pct }));
        }),
      );
    }
    return { connector: withReauthCommand(this.store.get('connectors', c.id)!, vdpCommand), action, started };
  }

  async scanConnector({ params, body }: I<'scanConnector'>): Promise<Res<'scanConnector'>> {
    const { run, entry } = this.scanInternal(params.id, body.scope ?? 'manual', 'user');
    return { entity: run, auditId: entry?.id ?? null };
  }

  private scanInternal(connectorId: string, scope: string, actor: 'user' | 'chat') {
    const c = this.store.must('connectors', connectorId, 'Connector');
    // HYG-1: the same scope check as db mode (an optional `<connector>:` prefix; an unknown scope is a 400)
    const runtime = connectorOfName(c.id) ?? connectorOfName(c.source);
    // chat's `/rescan slack 2d` labels its run `chat:<window>`: the connector's default scope over that window
    const chatWindow = actor === 'chat' && scope.startsWith('chat:');
    const check = runtime && !chatWindow ? normalizeScanScope(runtime, scope) : ({ ok: true, scope: null } as const);
    if (!check.ok) throw invalid(`Unknown scope "${check.scope}" for ${c.id}. Valid scopes: ${check.valid.join(', ')}`, { scope: check.scope, valid: check.valid });
    const now = this.nowIso();
    const authBroken = c.state === 'auth_needed';
    const run = {
      id: id('scan'),
      connectorId: c.id,
      scope: chatWindow || !runtime ? scope : placeholderScopeId(runtime, check.scope),
      kind: 'manual' as const,
      windowStart: c.cursor.at ?? now,
      windowEnd: now,
      status: authBroken ? ('auth_failed' as const) : ('running' as const),
      startedAt: now,
      endedAt: authBroken ? now : null,
      itemsSeen: 0,
      itemsNew: 0,
      itemsChanged: 0,
      costUsd: 0,
      model: c.source === 'slack' || c.source === 'org62' ? 'haiku' : null,
      error: authBroken ? `${c.label} needs re-auth` : null,
    };
    const { entry } = this.tx({ actor, action: actor === 'chat' ? 'chat.scan' : 'connector.scan', summary: `Scan ${c.label}`, entity: { type: 'connector', id: c.id, label: c.label }, undoable: false }, (tx) => tx.put('scanRuns', run));
    if (!authBroken) {
      this.later(this.delays.stepMs, () => {
        const cur = this.store.get('scanRuns', run.id);
        const conn = this.store.get('connectors', c.id);
        if (!cur || !conn) return;
        this.tx({ actor: 'connector', action: 'scan.ok', summary: `Scan ${c.label} ok`, entity: { type: 'connector', id: c.id, label: c.label }, audit: false }, (tx) => {
          tx.put('scanRuns', { ...cur, status: 'ok', endedAt: this.nowIso(), itemsSeen: 12, itemsNew: 1, itemsChanged: 2, costUsd: cur.model ? 0.004 : 0 });
          tx.put('connectors', { ...conn, lastSuccessAt: this.nowIso(), cursor: { label: `${conn.label} through ${fmtHM(this.now(), this.store.settings().profile.timezone)}`, at: this.nowIso() }, itemsToday: conn.itemsToday + 1 });
        });
      });
    }
    return { run, entry, connector: c };
  }

  async getScans({ query }: I<'getScans'>): Promise<Res<'getScans'>> {
    return { runs: this.store.all('scanRuns').sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, query.limit) };
  }

  async getJobs(_i: I<'getJobs'>): Promise<Res<'getJobs'>> {
    const jobs = this.store.all('jobs').sort((a, b) => b.runAt.localeCompare(a.runAt));
    const counts = { queued: 0, running: 0, retrying: 0, succeeded: 0, dead: 0, cancelled: 0 };
    for (const j of jobs) counts[j.status]++;
    return { jobs, counts };
  }

  async retryJob({ params }: I<'retryJob'>): Promise<Res<'retryJob'>> {
    const j = this.store.must('jobs', params.id, 'Job');
    if (!['dead', 'cancelled', 'retrying'].includes(j.status)) throw invalid(`Job is ${j.status}`);
    const next = { ...j, status: 'queued' as const, attempts: 0, error: null, runAt: this.nowIso(), finishedAt: null };
    const { entry } = this.tx({ actor: 'user', action: 'job.retry', summary: `Requeued ${j.type}`, entity: { type: 'job', id: j.id, label: j.type } }, (tx) => tx.put('jobs', next));
    this.later(this.delays.stepMs, () => {
      const cur = this.store.get('jobs', j.id);
      if (cur?.status !== 'queued') return;
      this.tx({ actor: 'system', action: 'job.succeeded', summary: `${j.type} succeeded`, entity: { type: 'job', id: j.id, label: j.type }, audit: false }, (tx) =>
        tx.put('jobs', { ...cur, status: 'succeeded', attempts: 1, startedAt: this.nowIso(), finishedAt: this.nowIso() }),
      );
    });
    return { entity: next, auditId: entry?.id ?? null };
  }

  async getEventLog(_i: I<'getEventLog'>): Promise<Res<'getEventLog'>> {
    const entries = this.store.all('eventLog').sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    return { entries, unacknowledged: entries.filter((e) => !e.acknowledged).length };
  }

  async ackEvent({ params }: I<'ackEvent'>): Promise<Res<'ackEvent'>> {
    const e = this.store.must('eventLog', params.id, 'Event');
    const next = { ...e, acknowledged: true, acknowledgedAt: this.nowIso() };
    const { entry } = this.tx({ actor: 'user', action: 'event.ack', summary: `Acknowledged ${e.code}`, entity: { type: 'event_log', id: e.id, label: e.code } }, (tx) => tx.put('eventLog', next));
    return { entity: next, auditId: entry?.id ?? null };
  }

  // =========================================================================
  // Settings and policy
  // =========================================================================

  async getSettings(_i: I<'getSettings'>): Promise<Res<'getSettings'>> {
    return this.store.settings();
  }

  async patchSettings({ params, body }: I<'patchSettings'>): Promise<Res<'patchSettings'>> {
    const s = this.store.settings();
    const section = params.section;
    const cur = s[section];
    this.checkVersion(cur, body.ifVersion, `Settings (${section})`, s);
    const parsed = SETTINGS_SECTION_SCHEMAS[section].safeParse(body.value);
    if (!parsed.success) throw invalid(`Invalid ${section} settings: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`, { issues: parsed.error.issues });
    const value = parsed.data as Record<string, unknown>;
    if (section === 'sending' && !body.confirm) {
      const need = sendingConfirmNeeded(s.sending, value);
      if (need) throw invalid(need, { confirmRequired: true });
    }
    if (section === 'budgets') {
      const soft = (value.softUsd as number | undefined) ?? s.budgets.softUsd;
      const hard = (value.hardUsd as number | undefined) ?? s.budgets.hardUsd;
      if (soft > hard) throw invalid('Soft budget cannot exceed the hard cap');
    }
    const merged = section === 'sending' ? this.outbox.mergeSending(s.sending, value) : { ...cur, ...value };
    const next: Settings = { ...s, [section]: { ...merged, version: cur.version + 1 } };
    if (section === 'persona' && personaSwitched(s, next)) {
      // D-55: the new role's starter policy as a new version (reranked), and the record-type override cleared, in one
      // audit entry: Undo puts the persona, the policy and the ranking back
      const at = this.nowIso();
      const { policy } = reseededPolicy(s.policy, personaOf(next), at);
      const time = timeWithoutRecordType(s.time);
      const after: Settings = { ...next, policy, ...(time ? { time } : {}) };
      const r = this.rerankAll('user', `settings.${section}`, `Saved ${section} settings`, policy, (tx) => {
        tx.put('settings', after);
        tx.put('policyVersions', { version: policy.version, at, by: 'user', note: policy.note ?? 'Role pack', policy });
      }, { type: 'settings', id: section, label: `Settings · ${section}` });
      return { entity: after, auditId: r.entry?.id ?? null };
    }
    const { entry } = this.tx({ actor: 'user', action: `settings.${section}`, summary: `Saved ${section} settings`, entity: { type: 'settings', id: section, label: `Settings · ${section}` } }, (tx) => {
      tx.put('settings', next);
      if (section === 'budgets') {
        const sp = this.store.spend();
        const eff = budgetsForDay(next.budgets, new Intl.DateTimeFormat('en-CA', { timeZone: next.profile.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(this.now()));
        const pct = eff.softUsd > 0 ? Math.round((sp.today.usd / eff.softUsd) * 100) : 0;
        tx.put('spend', { ...sp, today: { ...sp.today, softBudgetUsd: eff.softUsd, hardCapUsd: eff.hardUsd, pct }, state: sp.today.usd >= eff.hardUsd ? 'capped' : pct >= next.budgets.alertPct ? 'soft_alert' : 'ok' });
      }
    });
    return { entity: next, auditId: entry?.id ?? null };
  }

  /** "Raise today's cap" with a reason: today's override goes up and the raise is kept (raiseBudgetToday, contract). */
  async raiseBudgetToday({ body }: I<'raiseBudgetToday'>): Promise<Res<'raiseBudgetToday'>> {
    const s = this.store.settings();
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: s.profile.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(this.now());
    let out: ReturnType<typeof raiseBudgetToday>;
    try {
      out = raiseBudgetToday(s.budgets, body, day, this.nowIso());
    } catch (e) {
      throw invalid(e instanceof Error ? e.message : String(e));
    }
    const { next: budgets, raise } = out;
    const { entry } = this.tx({ actor: 'user', action: 'settings.budgets', summary: raiseSummary(raise), entity: { type: 'settings', id: 'budgets', label: 'Settings · budgets' } }, (tx) => {
      tx.put('settings', { ...s, budgets });
      const sp = this.store.spend();
      const pct = raise.toSoftUsd > 0 ? Math.round((sp.today.usd / raise.toSoftUsd) * 100) : 0;
      tx.put('spend', { ...sp, today: { ...sp.today, softBudgetUsd: raise.toSoftUsd, hardCapUsd: raise.toHardUsd, pct }, state: sp.today.usd >= raise.toHardUsd ? 'capped' : pct >= budgets.alertPct ? 'soft_alert' : 'ok' });
    });
    return { entity: budgets, auditId: entry?.id ?? null };
  }

  private proposedPolicy(weights?: PolicyWeights, rules?: PolicyRule[]): PriorityPolicy {
    const pol = this.store.settings().policy;
    return { ...pol, weights: weights ?? pol.weights, rules: rules ?? pol.rules };
  }

  private preview(policy: PriorityPolicy): PolicyPreview {
    const now = this.now();
    const current = storedOrder(this.store);
    const baseline = current.map((i) => i.id);
    const currentPolicy = this.store.settings().policy;
    const before = current.slice(0, 10).map((w, i) => {
      const s = scoreItem(w, this.store, currentPolicy, now);
      return { workItemId: w.id, title: w.title, rank: i + 1, score: s.score, moved: 0, topReason: s.reasons[0]?.label ?? null };
    });
    const after = toRankRows(this.store, computeRanking(this.store, policy, now), baseline, 10);
    const changedCount = after.filter((r, i) => before[i]?.workItemId !== r.workItemId).length;
    const lead = after[0];
    return {
      basedOnVersion: currentPolicy.version,
      before,
      after,
      changedCount,
      summary: changedCount ? `${changedCount} of the Top 10 move${lead && lead.workItemId !== before[0]?.workItemId ? `; "${lead.title}" takes #1` : ''}` : 'No change to the Top 10',
    };
  }

  async previewPolicy({ body }: I<'previewPolicy'>): Promise<Res<'previewPolicy'>> {
    return this.preview(this.proposedPolicy(body.weights as PolicyWeights | undefined, body.rules));
  }

  private applyPolicyInternal(weights: PolicyWeights, rules: PolicyRule[], note: string, by: 'user' | 'chat' | 'system', extra?: (tx: Tx) => void) {
    const s = this.store.settings();
    const pol: PriorityPolicy = { ...s.policy, version: s.policy.version + 1, weights, rules, updatedAt: this.nowIso(), note };
    const r = this.rerankAll(by === 'system' ? 'system' : by, 'policy.apply', `Policy v${pol.version}: ${note}`, pol, (tx) => {
      tx.put('settings', { ...s, policy: pol });
      tx.put('policyVersions', { version: pol.version, at: this.nowIso(), by, note, policy: pol });
      extra?.(tx);
    });
    const receipt = this.receiptFrom(r.entry, r.ops, by === 'chat' ? 'chat' : 'user', `Policy v${pol.version} applied: ${r.result.changed} of the Top 10 moved`, (op, f) => (op.col === 'workItems' ? f === 'rank' : op.col === 'settings'));
    return { ...r, policy: pol, receipt };
  }

  async applyPolicy({ body }: I<'applyPolicy'>): Promise<Res<'applyPolicy'>> {
    const cur = this.store.settings().policy;
    this.checkVersion(cur, body.ifVersion, 'Priority policy', cur);
    const r = this.applyPolicyInternal(body.weights as PolicyWeights, body.rules, body.note ?? 'Edited in Settings', 'user');
    return { entity: r.policy, auditId: r.entry?.id ?? null, receipt: r.receipt };
  }

  async revertPolicy({ body }: I<'revertPolicy'>): Promise<Res<'revertPolicy'>> {
    const cur = this.store.settings().policy;
    this.checkVersion(cur, body.ifVersion, 'Priority policy', cur);
    const target = this.store.get('policyVersions', String(body.toVersion));
    if (!target) throw notFound('Policy version', String(body.toVersion));
    const r = this.applyPolicyInternal(target.policy.weights, target.policy.rules, `Reverted to v${body.toVersion}`, 'user');
    return { entity: r.policy, auditId: r.entry?.id ?? null, receipt: r.receipt };
  }

  async getPolicyVersions(_i: I<'getPolicyVersions'>): Promise<Res<'getPolicyVersions'>> {
    return { current: this.store.settings().policy.version, versions: this.store.all('policyVersions').sort((a, b) => b.version - a.version) };
  }

  // =========================================================================
  // Universal
  // =========================================================================

  async undoAudit({ params }: I<'undoAudit'>): Promise<Res<'undoAudit'>> {
    const target = this.audit.get(params.id);
    if (!target) throw notFound('Audit entry', params.id);
    if (!target.undoable) throw invalid('This change cannot be undone');
    if (target.undoneAt) throw invalid('Already undone');
    const ops = this.audit.inverseOf(target.id);
    if (!ops) throw invalid('No inverse recorded for this change');
    const at = this.nowIso();
    const plan = planUndo(this.store, ops, at);
    const r = this.tx({ actor: 'user', action: 'undo', summary: `Undo: ${target.summary}`, entity: target.entity, related: target.related, undoOf: target.id }, (tx) => {
      for (const p of plan) {
        if (p.next === null) tx.remove(p.col, p.id);
        else tx.put(p.col, p.next as never);
      }
    });
    this.audit.markUndone(target.id, at);
    const entry = r.entry ?? this.audit.record({ at, actor: 'user', action: 'undo', summary: `Undo: ${target.summary}`, entity: target.entity, ops: [], undoable: false, undoOf: target.id });
    return { entity: entry, auditId: entry.id, receipt: this.receiptFrom(entry, r.ops, 'user', `Undid: ${target.summary}`) };
  }

  async search({ query }: I<'search'>): Promise<Res<'search'>> {
    const q = query.q.trim().toLowerCase();
    if (!q) return { q: query.q, hits: [], total: 0 };
    const tokens = q.split(/\s+/).filter(Boolean);
    const hits: SearchHit[] = [];
    const score = (hay: string) => {
      const h = hay.toLowerCase();
      let s = 0;
      for (const t of tokens) if (h.includes(t)) s += h.startsWith(t) ? 2 : 1;
      return s === 0 ? 0 : s / tokens.length;
    };
    const add = (ref: EntityRef, title: string, subtitle: string | null, hay: string, extra: Partial<SearchHit> = {}) => {
      const s = score(hay);
      if (s > 0) hits.push({ ref: { ...ref, href: ref.href ?? hrefFor(ref) }, title, subtitle, kind: null, state: null, ...extra, score: Math.round(s * 100) / 100 });
    };
    for (const w of this.store.all('workItems')) add(itemRef(w), w.title, w.purpose, `${w.title} ${w.purpose ?? ''} ${w.why}`, { kind: w.kind, state: w.state });
    for (const i of this.store.all('initiatives')) add({ type: 'initiative', id: i.id, label: i.title }, i.title, i.purpose, `${i.title} ${i.purpose} ${i.summary}`);
    for (const a of this.store.all('accounts')) add({ type: 'account', id: a.id, label: a.name }, a.name, a.industry, a.name);
    for (const o of this.store.all('opps')) add({ type: 'opportunity', id: o.id, label: o.name }, o.name, o.stage, o.name);
    for (const p of this.store.all('people')) add({ type: 'person', id: p.id, label: p.name }, p.name, p.role ?? null, `${p.name} ${p.role ?? ''} ${p.title ?? ''}`);
    for (const b of this.store.all('briefs')) add({ type: 'brief', id: b.id, label: b.title }, b.title, 'Brief', `${b.title} ${b.summary}`);
    for (const r of this.store.all('agentRuns')) add({ type: 'agent_run', id: r.id, label: r.title }, r.title, r.state.replace(/_/g, ' '), r.title);
    for (const a of this.store.all('assets')) add({ type: 'asset', id: a.id, label: a.title, href: a.url }, a.title, a.kind, a.title);
    hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    return { q: query.q, hits: hits.slice(0, query.limit), total: hits.length };
  }

  async getPeople({ query }: I<'getPeople'>): Promise<Res<'getPeople'>> {
    const myDomain = this.store.meta().user.email.split('@')[1]?.toLowerCase() ?? '';
    const tokens = query.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows = this.store
      .all('people')
      .filter((p) => (!query.account || p.accountId === query.account) && (query.slack === undefined || !!p.slackHandle === query.slack))
      .map((p) => {
        const account = p.accountId ? this.store.get('accounts', p.accountId) : undefined;
        const domain = p.email?.split('@')[1]?.toLowerCase() ?? '';
        const view: PersonView = {
          id: p.id,
          name: p.name,
          email: p.email ?? null,
          slackId: p.slackHandle ?? null,
          role: p.role ?? null,
          title: p.title ?? null,
          account: account ? { type: 'account', id: account.id, label: account.name, href: hrefFor({ type: 'account', id: account.id }) } : null,
          isExternal: p.isExternal ?? (!!domain && !!myDomain && domain !== myDomain),
          isManager: p.isManager ?? false,
        };
        // Name prefix > word prefix > anywhere (name, email, Slack id, role, title, account).
        const name = p.name.toLowerCase();
        const hay = `${name} ${p.email ?? ''} ${p.slackHandle ?? ''} ${p.role ?? ''} ${p.title ?? ''} ${account?.name ?? ''}`.toLowerCase();
        let score = 0;
        for (const t of tokens) {
          if (name.startsWith(t)) score += 3;
          else if (name.split(/\s+/).some((w) => w.startsWith(t))) score += 2;
          else if (hay.includes(t)) score += 1;
          else return null;
        }
        return { view, score };
      })
      .filter((r): r is { view: PersonView; score: number } => !!r)
      .sort((a, b) => b.score - a.score || a.view.name.localeCompare(b.view.name));
    return { q: query.q, people: rows.slice(0, query.limit).map((r) => r.view), total: rows.length };
  }

  async getSince({ query }: I<'getSince'>): Promise<Res<'getSince'>> {
    return buildSince(this.store, this.audit, query.ts ?? this.store.meta().lastActiveAt, this.now());
  }

  // =========================================================================
  // Chat
  // =========================================================================

  async listChatThreads(_i: I<'listChatThreads'>): Promise<Res<'listChatThreads'>> {
    return { threads: this.store.all('chatThreads').map((t) => t.thread).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.updatedAt.localeCompare(a.updatedAt)) };
  }

  async createChatThread({ body }: I<'createChatThread'>): Promise<Res<'createChatThread'>> {
    const now = this.nowIso();
    const thread: ChatThread = {
      id: id('thread'),
      title: body.title ?? NEW_THREAD_TITLE,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      lastMessagePreview: null,
      context: this.contextRefs(body.context, 'auto'),
    };
    // Not audited (like chat messages): there is nothing to undo in an empty thread.
    this.tx({ actor: 'user', action: 'chat.thread', summary: `New thread: ${thread.title}`, entity: { type: 'chat_thread', id: thread.id, label: thread.title }, audit: false }, (tx) => tx.put('chatThreads', { thread, messages: [] }));
    return thread;
  }

  // ---- Read-ins (BE-READIN; mock/readin.ts: deterministic, never calls out) ----
  async getReadIn({ params }: I<'getReadIn'>): Promise<Res<'getReadIn'>> {
    return this.readins!.get(params);
  }
  async requestReadIn({ params, body }: I<'requestReadIn'>): Promise<Res<'requestReadIn'>> {
    return this.readins!.request(params, body.force);
  }

  // ---- lane A: Specialist Forecast (mock/forecast.ts) ----
  async getForecast(_i: I<'getForecast'>): Promise<Res<'getForecast'>> { return this.forecast.view(); } // prettier-ignore
  async getForecastRecord({ params }: I<'getForecastRecord'>): Promise<Res<'getForecastRecord'>> { return this.forecast.detail(params.id); } // prettier-ignore
  async syncForecast(_i: I<'syncForecast'>): Promise<Res<'syncForecast'>> { return this.forecast.sync(); } // prettier-ignore
  async draftForecastNotes(i: I<'draftForecastNotes'>): Promise<Res<'draftForecastNotes'>> { return this.forecast.draft(i); } // prettier-ignore
  async patchForecast({ params, body }: I<'patchForecast'>): Promise<Res<'patchForecast'>> { return this.forecast.patch(params.id, body); } // prettier-ignore
  async stageForecast(i: I<'stageForecast'>): Promise<Res<'stageForecast'>> { return this.forecast.stage(i); } // prettier-ignore
  async checkMissingForecast({ params }: I<'checkMissingForecast'>): Promise<Res<'checkMissingForecast'>> { return this.forecast.checkMissing(params.id); } // prettier-ignore

  // ---- Onboarding (B-079; mock/onboarding.ts) ----
  async getOnboarding(_i: I<'getOnboarding'>): Promise<Res<'getOnboarding'>> {
    return this.onboarding.state();
  }
  async saveOnboardingStep({ body }: I<'saveOnboardingStep'>): Promise<Res<'saveOnboardingStep'>> {
    return this.onboarding.save(body);
  }
  async getOnboardingSources(_i: I<'getOnboardingSources'>): Promise<Res<'getOnboardingSources'>> {
    return this.onboarding.sources();
  }
  async completeOnboarding(_i: I<'completeOnboarding'>): Promise<Res<'completeOnboarding'>> {
    return this.onboarding.complete();
  }

  async getChatThread({ params }: I<'getChatThread'>): Promise<Res<'getChatThread'>> {
    const t = this.store.must('chatThreads', params.id, 'Chat thread');
    return { thread: t.thread, messages: t.messages.map((m) => withBriefSummary(this.hydrateChatMessage(m))) };
  }

  /** Persisted parts carry stream-time snapshots; refresh what changed since (proposal status, receipt undo state). */
  private hydrateChatMessage(m: ChatMessage): ChatMessage {
    if (!m.parts.some((p) => p.type === 'proposal' || p.type === 'receipt' || p.type === 'tool')) return m;
    return {
      ...m,
      // BE-CHAT first: chat plans (status + the applied receipt after the card) and scan cards
      parts: this.be6.hydrate(m.parts).map((p): ChatPart => {
        if (p.type === 'proposal' && this.be6.plans.has(p.proposal.id)) return p;
        if (p.type === 'proposal') {
          const cur = this.store.get('proposals', p.proposal.id) ?? p.proposal;
          return { ...p, proposal: cur, status: chatProposalStatus(cur.status) };
        }
        if (p.type === 'receipt') return { ...p, receipt: { ...p.receipt, changes: p.receipt.changes.map((c) => ({ ...c, ...this.undoStateOf(c.auditId) })) } };
        return p;
      }),
    };
  }

  /**
   * Undo state of one receipt line from the audit log. The undo/redo chain is auditId → its undo → that
   * undo's undo (redo) → …; the last entry is the live one. An even-length chain means the line is undone.
   */
  private undoStateOf(auditId: string): { undoneAt: string | null; undoAuditId: string | null } {
    let cur = this.audit.get(auditId);
    if (!cur) return { undoneAt: null, undoAuditId: null };
    let length = 1;
    while (cur.undoneAt) {
      const curId: string = cur.id;
      const next: AuditEntry | undefined = this.audit.entries.find((e) => e.undoOf === curId);
      if (!next) break;
      cur = next;
      length++;
    }
    if (length === 1) return { undoneAt: null, undoAuditId: null };
    return { undoneAt: length % 2 === 0 ? cur.at : null, undoAuditId: cur.id };
  }

  /** Chat context chips from a request. Unknown entity types are dropped (the stored message must stay contract-valid). */
  private contextRefs(input: Array<{ type: string; id: string; label: string; via?: 'auto' | 'explicit' }>, via?: 'auto' | 'explicit'): ContextRef[] {
    const out: ContextRef[] = [];
    for (const c of input) {
      const t = EntityTypeSchema.safeParse(c.type);
      if (t.success) out.push({ type: t.data, id: c.id, label: c.label, via: via ?? c.via ?? 'explicit' });
    }
    return out;
  }

  private appendMessage(threadId: string, msg: ChatMessage) {
    const t = this.store.must('chatThreads', threadId, 'Chat thread');
    // An untitled thread takes its title from the first thing you asked.
    const title = msg.role === 'user' && t.messages.length === 0 && t.thread.title === NEW_THREAD_TITLE && !t.thread.isDefault ? threadTitleFrom(msg.text) : t.thread.title;
    this.tx({ actor: msg.role === 'user' ? 'user' : 'chat', action: 'chat.message', summary: 'Message', entity: { type: 'chat_thread', id: threadId, label: title }, audit: false }, (tx) =>
      tx.put('chatThreads', {
        thread: { ...t.thread, title, updatedAt: msg.at, messageCount: t.messages.length + 1, lastMessagePreview: msg.text.slice(0, 120) || t.thread.lastMessagePreview },
        messages: [...t.messages, msg],
      }),
    );
  }

  private chatOps(): ChatOps {
    return {
      topItems: (n) => storedOrder(this.store).slice(0, n).map((w) => hydrateItem(this.store, w)),
      findItem: (q) => {
        const byId = this.store.get('workItems', q);
        if (byId) return hydrateItem(this.store, byId);
        const ql = q.toLowerCase();
        const w = this.store.all('workItems').find((x) => x.title.toLowerCase().includes(ql));
        return w ? hydrateItem(this.store, w) : null;
      },
      listItems: (q) => buildItems(this.store, ItemsQuery.parse(q ?? {})).items,
      calendarToday: () => {
        const { from, to } = windowOrToday(this.now());
        return this.store
          .all('events')
          .filter((e) => Date.parse(e.start) >= from.getTime() && Date.parse(e.start) <= to.getTime())
          .sort((a, b) => a.start.localeCompare(b.start));
      },
      settings: () => this.store.settings(),
      moveToTop: (itemId, reason) => {
        const w = this.item(itemId);
        const pol = this.store.settings().policy;
        const now = this.now();
        const top = computeRanking(this.store, pol, now)[0];
        const mine = scoreItem(w, this.store, pol, now).score;
        const boost = top && top.id !== w.id ? Math.ceil(top.score - mine + 1) : 0;
        const r = this.rerankAll('chat', 'chat.move', `Moved to #1: ${w.title}`, undefined, (tx) => {
          tx.put('workItems', this.bump({ ...w, signals: { ...w.signals, boost: w.signals.boost + boost } }));
        });
        return this.receiptFrom(r.entry, r.ops, 'chat', `${w.title} → #1 (${reason})`, (op, f) => op.col === 'workItems' && (f === 'rank' || f === 'signals'))!;
      },
      addNote: (itemId, note) => {
        const w = this.item(itemId);
        const r = this.tx({ actor: 'chat', action: 'chat.note', summary: `Noted on ${w.title}`, entity: itemRef(w) }, (tx) => tx.put('workItems', this.bump({ ...w, notes: w.notes ? `${w.notes}\n${note}` : note })));
        return this.labelled(this.receiptFrom(r.entry, r.ops, 'chat', `Added a note to ${w.title}`))!;
      },
      patchItem: (itemId, patch, reason) => this.chatPatchItem(itemId, patch, reason),
      resolveItem: (itemId, resolution, detail, note) => this.chatResolveItem(itemId, resolution, detail ?? {}, note),
      capture: (text, opts = {}) => {
        const { item, entry } = this.captureInternal({ text, ...opts }, 'chat');
        const line: ReceiptChange = { auditId: entry!.id, entity: itemRef(item), field: 'state', label: 'Captured', before: null, after: item.state };
        return { item, receipt: { id: id('rcpt'), at: entry!.at, actor: 'chat', summary: `Captured ${item.title}`, changes: [line], staged: false } };
      },
      scan: (connectorId, scope) => {
        try {
          const { run } = this.scanInternal(connectorId, scope, 'chat');
          const ok = !['auth_failed', 'transient_failed', 'budget_exceeded', 'aborted'].includes(run.status);
          return { ok, run, summary: ok ? `Scan ${run.id.slice(-6)} started (${run.kind}); it shows in the Health ledger` : (run.error ?? 'Scan failed') };
        } catch (err) {
          return { ok: false, run: null, summary: (err as Error).message };
        }
      },
      policyPreview: (deltas) => this.preview({ ...this.store.settings().policy, weights: this.weightsWith(deltas) }),
      policyApply: (deltas, note) => {
        const pol = this.store.settings().policy;
        const weights = this.weightsWith(deltas);
        const preview = this.preview({ ...pol, weights });
        const r = this.applyPolicyInternal(weights, pol.rules, note, 'chat');
        return { receipt: r.receipt!, preview };
      },
      proposeItemPatch: (itemId, patch, reason) => this.chatPropose(this.item(itemId), patch, reason),
      proposePolicy: (deltas, note) => {
        const pol = this.store.settings().policy;
        const weights = this.weightsWith(deltas);
        const preview = this.preview({ ...pol, weights });
        let pid = '';
        this.tx({ actor: 'chat', action: 'chat.propose_policy', summary: note, entity: { type: 'policy', id: pol.id, label: pol.name }, audit: false }, (tx) => {
          pid = this.propose(
            tx,
            { type: 'policy', id: pol.id, label: pol.name },
            Object.keys(deltas).map((k) => ({ field: `weights.${k}`, label: k.replace(/_/g, ' '), before: pol.weights[k as keyof PolicyWeights], after: weights[k as keyof PolicyWeights] })),
            note,
            pol.version,
            'chat',
            null,
          );
        });
        return { proposal: this.store.get('proposals', pid)!, preview };
      },
      findAssets: (q) => {
        const tokens = q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
        return this.store.all('assets').filter((a) => tokens.some((t) => a.title.toLowerCase().includes(t)));
      },
      resourceForAsset: (a): ChatResource => ({ kind: 'asset', id: a.id, label: a.title, href: a.url ?? `/search?q=${encodeURIComponent(a.title)}` }),
      resourceForItem: (w: WorkItem): ChatResource => ({ kind: 'work_item', id: w.id, label: w.title, href: hrefFor({ type: 'work_item', id: w.id }) }),
    };
  }

  /** Current weights plus deltas, each clamped to 0–10. */
  private weightsWith(deltas: Partial<PolicyWeights>): PolicyWeights {
    const weights = { ...this.store.settings().policy.weights } as PolicyWeights;
    for (const [k, d] of Object.entries(deltas)) weights[k as keyof PolicyWeights] = Math.max(0, Math.min(10, (weights[k as keyof PolicyWeights] ?? 0) + (d ?? 0)));
    return weights;
  }

  /** Add human labels to receipt lines. */
  private labelled(r: Receipt | null | undefined): Receipt | null {
    if (!r) return null;
    return { ...r, changes: r.changes.map((c) => (c.label || !ITEM_FIELD_LABEL[c.field] ? c : { ...c, label: ITEM_FIELD_LABEL[c.field] })) };
  }

  /** Stage a chat field change (Apply / Keep mine). Not audited until applied. */
  private chatPropose(w: WorkItemRecord, patch: Record<string, unknown>, reason: string): Proposal {
    let pid = '';
    this.tx({ actor: 'chat', action: 'chat.propose', summary: reason, entity: itemRef(w), audit: false }, (tx) => {
      pid = this.propose(tx, itemRef(w), Object.entries(patch).map(([f, v]) => ({ field: f, ...(ITEM_FIELD_LABEL[f] ? { label: ITEM_FIELD_LABEL[f] } : {}), before: (w as Record<string, unknown>)[f] ?? null, after: v })), reason, w.version, 'chat', null);
    });
    return this.store.get('proposals', pid)!;
  }

  /**
   * A chat field edit. Audited as actor `chat` and undoable; it never adds `userLockedFields` (only user
   * edits lock). A field the user already locked does not change: it becomes a proposal instead.
   */
  private chatPatchItem(itemId: string, patch: WorkItemPatchT, reason: string): ChatPatchResult {
    const parsed = WorkItemPatch.safeParse(patch);
    if (!parsed.success) throw invalid(`Invalid patch: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    const cur = this.item(itemId);
    const locked = new Set<string>(cur.userLockedFields);
    const apply: Record<string, unknown> = {};
    const staged: Record<string, unknown> = {};
    for (const [f, v] of Object.entries(parsed.data)) {
      if (v === undefined) continue;
      if (locked.has(ITEM_PATCH_LOCK[f] ?? f)) staged[f] = v;
      else if (JSON.stringify((cur as Record<string, unknown>)[f] ?? null) !== JSON.stringify(v)) apply[f] = v;
    }
    let receipt: Receipt | null = null;
    let next = cur;
    if (Object.keys(apply).length) {
      next = this.bump({ ...cur, ...apply } as WorkItemRecord); // userLockedFields unchanged on purpose
      const summary = `${reason}: ${cur.title}`;
      const r = this.tx({ actor: 'chat', action: 'chat.edit', summary, entity: itemRef(cur) }, (tx) => tx.put('workItems', next));
      receipt = this.labelled(this.receiptFrom(r.entry, r.ops, 'chat', summary, (op, f) => op.col === 'workItems' && f in apply));
    }
    const proposals = Object.entries(staged).map(([f, v]) => this.chatPropose(next, { [f]: v }, `${reason} (you set ${ITEM_FIELD_LABEL[f] ?? f} yourself)`));
    return { item: hydrateItem(this.store, this.item(itemId)), receipt, proposals };
  }

  /** Chat closes an item with an R-UI-22 resolution (doneBy `chat`). A user-locked state becomes a proposal. */
  private chatResolveItem(itemId: string, resolution: Resolution, detail: Partial<Omit<ResolutionDetail, 'inferred'>>, note?: string): ChatPatchResult {
    const cur = this.item(itemId);
    if (!isLive(cur) && cur.state !== 'snoozed' && cur.state !== 'suggested') throw invalid(`Cannot resolve a ${cur.state} item`);
    const label = resolutionLabel(resolution, detail.personName ?? (detail.personId ? this.store.get('people', detail.personId)?.name : undefined));
    if (cur.userLockedFields.includes('state')) {
      return { item: hydrateItem(this.store, cur), receipt: null, proposals: [this.chatPropose(cur, { state: 'done', resolution }, `${label} (asked in chat)`)] };
    }
    const next = this.bump(this.resolvedRecord(cur, { reason: label, resolution, detail: note ? { ...detail, note } : detail, doneBy: 'chat' }));
    const summary = `${label}: ${cur.title}`;
    const r = this.tx({ actor: 'chat', action: 'chat.resolve', summary, entity: itemRef(cur) }, (tx) => tx.put('workItems', next));
    const receipt = this.labelled(this.receiptFrom(r.entry, r.ops, 'chat', summary, (op, f) => op.col === 'workItems' && (f === 'state' || f === 'resolution')));
    return { item: hydrateItem(this.store, next), receipt, proposals: [] };
  }

  async *chat({ body, signal }: I<'chat'> & { signal: AbortSignal }): AsyncGenerator<ChatSseEvent> {
    const thread = body.threadId ? this.store.get('chatThreads', body.threadId) : this.store.all('chatThreads').find((t) => t.thread.isDefault) ?? this.store.all('chatThreads')[0];
    if (!thread) throw notFound('Chat thread', body.threadId ?? '(default)');
    const threadId = thread.thread.id;
    const model: ChatModel = body.model ?? this.store.settings().chat.defaultModel;
    const userMsg: ChatMessage = { id: id('msg'), threadId, role: 'user', at: this.nowIso(), text: body.text, parts: [], context: this.contextRefs(body.context), isMorningBrief: false };
    this.appendMessage(threadId, userMsg);
    const messageId = id('msg');
    const threadContext = (thread.thread.context ?? []).filter((c) => !userMsg.context.some((u) => u.type === c.type && u.id === c.id)).map((c) => ({ ...c, via: 'auto' as const }));
    const context = [...userMsg.context, ...threadContext];
    // BE-CHAT: a newer message in this thread (or Stop / the client leaving) cancels this turn.
    const run = beginChatRun(threadId, signal);
    // BE-CHAT intents (proposals, scans, drafts, sessions) go to the runner over the fake model; the rest keep the scripted demos.
    const scriptCtx: ChatScriptContext = { text: body.text, context, threadId, now: this.now(), model, ops: this.chatOps() };
    const steps = mockWantsRunner(body.text)
      ? this.chatRunner({ threadId, messageId, userMessageId: userMsg.id, text: body.text, context, model, signal: run.signal, ...(body.allowExtraUsd ? { allowExtraUsd: body.allowExtraUsd } : {}) }, createChatHost(this, this.be6.backend(), () => this.now()))
      : pickChatScript(body.text, scriptCtx).run(scriptCtx);
    try {
      yield* runTurn({ threadId, messageId, userMessageId: userMsg.id, model }, steps, {
        signal: run.signal,
        now: () => this.nowIso(),
        newId: () => id('tool'),
        persist: (m) => this.appendMessage(threadId, m),
        chunkText: true,
        textChunkMs: this.delays.chatTokenMs,
        toolPauseMs: this.delays.chatTokenMs * 12,
      });
    } finally {
      run.end();
    }
  }

  /** BE-CHAT: the bound helpers the chat plans, scans, drafts and sessions use (chat-be6.ts). */
  private chatKit(): MockChatKit {
    return {
      store: () => this.store,
      now: () => this.now(),
      stepMs: this.delays.stepMs,
      tx: (m, fn) => this.tx(m, fn),
      rerankAll: (actor, action, summary, policy, extra) => this.rerankAll(actor, action, summary, policy, extra),
      receiptFrom: (entry, ops, actor, summary, filter) => this.receiptFrom(entry, ops, actor, summary, filter),
      labelled: (r) => this.labelled(r),
      bump: (v) => this.bump(v),
      resolvedRecord: (cur, o) => this.resolvedRecord(cur, o),
      addEvidence: (tx, wid, role, source, summary, isNew) => this.addEvidence(tx, wid, role, source, summary, isNew),
      blankItem: (now) => blankItem(now, this.store.meta().user),
      topBoost: (w) => {
        const pol = this.store.settings().policy;
        const now = this.now();
        const top = computeRanking(this.store, pol, now)[0];
        const mine = scoreItem(w, this.store, pol, now).score;
        return top && top.id !== w.id ? Math.ceil(top.score - mine + 1) : 0;
      },
      undoStateOf: (auditId) => this.undoStateOf(auditId),
      later: (ms, fn) => this.later(ms, fn),
      enrich: (itemId) => this.enrich(itemId),
      publish: (topics, ids, reason) => this.publish(topics, ids, reason),
      history: (threadId, exclude) => (this.store.get('chatThreads', threadId)?.messages ?? []).filter((m) => !exclude.includes(m.id)).map((m) => this.hydrateChatMessage(m)),
    };
  }

  // =========================================================================
  // Live events
  // =========================================================================

  events({ signal }: { signal: AbortSignal }): AsyncIterable<LiveEvent> {
    return this.bus.iterate(signal);
  }

  // =========================================================================
  // Feedback (D-56) // lane D: the deterministic report (no model call), placeholders only
  // =========================================================================

  private feedbackHost(): FeedbackHost {
    return {
      ds: this,
      now: () => this.now(),
      terms: async () => {
        // The user is a person row on Postgres; here only meta knows them (same term list, same numbering).
        const me = this.store.meta().user;
        const people = this.store.all('people');
        const all = people.some((p) => p.id === me.id || p.name === me.name) ? people : [...people, { id: me.id, name: me.name, email: me.email }];
        return scrubTermsFrom({ accounts: this.store.all('accounts'), people: all, opps: this.store.all('opps') });
      },
      me: async () => this.store.meta().user.name,
      insertAction: async (dest, audit) => {
        const draft = actionDraftFor(dest, { id: id('d'), now: this.nowIso(), workItemId: null, rendered: (doc) => renderAll(dest, doc) });
        const { entry } = this.tx({ actor: 'user', action: audit.action, summary: audit.summary, entity: { type: 'draft', id: draft.id, label: dest.target.label }, undoable: false }, (tx) => tx.put('drafts', draft));
        return { draft, auditId: entry?.id ?? null };
      },
      budget: async () => ({ capUsd: 0, note: null }),
      recordSpend: async () => undefined,
      agent: null,
    };
  }

  async getFeedback(_i: I<'getFeedback'>): Promise<Res<'getFeedback'>> {
    return feedbackState(this.feedbackHost());
  }

  async diagnoseFeedback({ body }: I<'diagnoseFeedback'>): Promise<Res<'diagnoseFeedback'>> {
    return diagnoseFeedback(this.feedbackHost(), body);
  }

  async stageFeedback({ body }: I<'stageFeedback'>): Promise<Res<'stageFeedback'>> {
    return stageFeedback(this.feedbackHost(), body);
  }

  // =========================================================================
  // Dev
  // =========================================================================

  async getScenario(_i: I<'getScenario'>): Promise<Res<'getScenario'>> {
    return this.scenario.status();
  }

  async controlScenario({ body }: I<'controlScenario'>): Promise<Res<'controlScenario'>> {
    switch (body.action) {
      case 'play':
        return this.scenario.play();
      case 'pause':
        return this.scenario.pause();
      case 'reset':
        return this.scenario.reset();
      case 'seek':
        if (body.seconds === undefined) throw invalid('seek needs `seconds`');
        return this.scenario.seek(body.seconds);
    }
  }

  async getDevFail(_i: I<'getDevFail'>): Promise<Res<'getDevFail'>> {
    return { rate: this.devFailRate };
  }

  async setDevFail({ body }: I<'setDevFail'>): Promise<Res<'setDevFail'>> {
    this.devFailRate = body.rate;
    return { rate: this.devFailRate };
  }

  async devEngineChange({ body }: I<'devEngineChange'>): Promise<Res<'devEngineChange'>> {
    if (body.entityType === 'work_item') {
      const r = this.engineUpdateItem(body.id, body.patch, body.reason);
      return { applied: r.applied, proposalIds: r.proposalIds };
    }
    const d = this.store.must('drafts', body.id, 'Draft');
    const text = typeof body.patch.text === 'string' ? body.patch.text : null;
    if (!text) throw invalid('Draft engine change needs patch.text (the new body)');
    if (!d.nbaId) throw invalid('Draft has no NBA');
    const before = this.store.all('proposals').length;
    this.engineReviseDraft(d.nbaId, text, body.reason, { kind: 'slack', label: 'Dev engine change' });
    const created = this.store.all('proposals').slice(before).map((p) => p.id);
    return { applied: created.length ? [] : ['doc'], proposalIds: created };
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const NEW_THREAD_TITLE = 'New thread';

/** "move Globex prep after lunch and find the deck…" → "move Globex prep after lunch and find the…" */
function threadTitleFrom(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length <= 48 ? one || NEW_THREAD_TITLE : `${one.slice(0, 47).replace(/\s+\S*$/, '')}…`;
}

/** Chat card state: rejected and superseded both read as dismissed. */
function chatProposalStatus(s: Proposal['status']): ChatProposalStatus {
  return s === 'pending' ? 'pending' : s === 'applied' ? 'applied' : 'dismissed';
}

export function resolutionLabel(r: Resolution, personName?: string): string {
  switch (r) {
    case 'done_by_me':
      return 'Done by you';
    case 'handed_off':
      return personName ? `Handed off → ${personName}` : 'Handed off';
    case 'done_by_other':
      return personName ? `Done by ${personName}` : 'Done by someone else';
    case 'not_needed':
      return 'Not needed';
    case 'duplicate':
      return 'Duplicate';
    case 'declined':
      return 'Declined';
    case 'superseded':
      return 'Superseded';
  }
}

function rewrite(text: string, instruction: 'regenerate' | 'shorter' | 'more_formal' | 'add_detail'): string {
  switch (instruction) {
    case 'shorter': {
      const sentences = text.split(/(?<=[.!?])\s+/);
      return sentences.slice(0, Math.max(1, Math.ceil(sentences.length / 2))).join(' ');
    }
    case 'more_formal':
      return `${text.replace(/^Hi\b/, 'Hello').replace(/\bthanks\b/gi, 'thank you')}\n\nKind regards`;
    case 'add_detail':
      return `${text}\n\nFor context: this follows our last call and the notes in the shared doc.`;
    case 'regenerate':
      return text.replace(/^(Hi|Hello) (\w+),?/, (_m, _g, name) => `Hey ${name},`);
  }
}

function buildLaunchPrompt(item: WorkItemRecord, store: Store): string {
  const ini = item.initiativeId ? store.get('initiatives', item.initiativeId) : undefined;
  const acc = item.accountId ? store.get('accounts', item.accountId) : undefined;
  return [
    `Task: ${item.title}`,
    item.purpose ? `Purpose: ${item.purpose}` : null,
    ini ? `Initiative: ${ini.title} — ${ini.summary}` : null,
    acc ? `Account: ${acc.name}` : null,
    `Why now: ${item.why}`,
    item.sources.length ? `Sources: ${item.sources.map((s) => s.label).join('; ')}` : null,
    item.notes ? `Notes: ${item.notes}` : null,
    'Read-only research is fine. Do not send, post or write to any external system.',
  ]
    .filter(Boolean)
    .join('\n');
}

function blankItem(now: string, user: { id: string; name: string }): WorkItemRecord {
  return {
    id: '',
    version: 1,
    kind: 'task',
    state: 'open',
    title: '',
    purpose: null,
    initiativeId: null,
    accountId: null,
    oppId: null,
    servesEventId: null,
    confidence: 'likely',
    why: '',
    whyDetail: null,
    sources: [],
    effort: { youMin: 15, agentMin: 0 },
    startBy: null,
    due: null,
    createdAt: now,
    updatedAt: now,
    ageDays: 0,
    isBackground: false,
    rank: null,
    rankReasons: [],
    score: null,
    priority: 'medium',
    signals: { customerFacing: false, fromManager: false, boost: 0 },
    stale: null,
    userLockedFields: [],
    newEvidenceCount: 0,
    reevaluating: false,
    seenAt: null,
    nbaId: null,
    owner: { id: user.id, name: user.name },
    people: [],
    waiting: null,
    snoozedUntil: null,
    snoozedFrom: null,
    doneAt: null,
    doneBy: null,
    closedReason: null,
    resolution: null,
    resolutionDetail: null,
    involvement: 'owner',
    loopedBackIn: null,
    likelyDone: null,
    reopened: null,
    dismissed: null,
    notes: '',
    enrichment: null,
    deliverable: null,
    training: null,
    runIds: [],
    assetIds: [],
    counterparty: null,
  };
}

export function createMockDataSource(opts?: MockOptions): MockDataSource {
  return new MockDataSource(opts);
}

