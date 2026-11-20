/**
 * The Postgres DataSource (CC_DATA=db): every /api/v1 route served from the DATA-MODEL schema.
 *
 * Reads load the user's read model (model.ts: rows → contract records via store/*.ts) and compose pages
 * (views.ts), with DATA-MODEL §6 statements choosing what they specify (Q1 ranked order, Q6 closed-for-you,
 * Q9 suggested items, Q13 history). Mutations run inside one `withChangeSet` each (actor user, the action
 * name as actor_ref), write columns through the change-set helper (409 on a stale `ifVersion`, user locks)
 * and return the change set id as `auditId`. `POST /audit/:id/undo` is `undoChangeSet`.
 *
 * Border rules: nothing here calls an external system. Dispatch records the intent (draft_send_attempts,
 * honoring dry-run, the default) and, only in live mode, enqueues an `outbox.dispatch` job for BE-4's send
 * adapters. Scans, re-auth, tool runs and enrichment are enqueued for the worker instead of simulated.
 */
import { addDays, isSameDay, setHours, setMinutes } from 'date-fns';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import type {
  AccountDetail,
  AccountRow,
  ActionDestination,
  ClaimMissedRequest,
  DcRequest,
  DealsNeed,
  ActivityEntry,
  OppOption,
  Actor,
  AgentRun,
  Asset,
  Brief,
  BriefHighlight,
  ChatMessage,
  ChatModel,
  ChatPart,
  ChatResource,
  ChatSseEvent,
  ChatThread,
  Draft,
  EntityRef,
  InitiativeDetail,
  LiveEvent,
  MissedOpp,
  NbaCard,
  NbaPayload,
  PolicyPreview,
  PolicyRule,
  PersonView,
  PolicyWeights,
  PriorityPolicy,
  Proposal,
  Receipt,
  Resolution,
  ResolutionDetail,
  ClosingReason,
  RouteInput,
  RouteKey,
  RouteOutput,
  SearchHit,
  Settings,
  SinceDigest,
  TimeWeek,
  TimelineLane,
  ToolRun,
  TriageItem,
  WorkItem,
  WorkItemDetail,
  WorkItemLockableField,
  WorkItemPatch as WorkItemPatchT,
  WorkItemRecord,
} from '@/contract';
import { allowAssistantToday, budgetsForDay, raiseBudgetToday, raiseSummary, dcRoleFor, ItemsQuery, requiredFieldKeys, SETTINGS_SECTION_SCHEMAS, withPromotedAs, WorkItemPatch } from '@/contract';
import { localDay as localDayOf } from '@/engines/activity/time';
import { validateInput } from '@/tools/manifest';
import { actors, applyProposal as applyProposalRow, engineUpdate, proposalStillCurrent, rejectProposal as rejectProposalRow, undoChangeSet, withChangeSet } from '@/db/changeset';
import { createDb, resolveDatabaseUrl, type Db, type DbHandle, type Tx } from '@/db/client';
import { AlreadyUndoneError, ConflictError, ConstraintViolationError, DbError, InvalidStateError, NotFoundError, NotUndoableError, UndoConflictError, ValidationError } from '@/db/errors';
import { enqueueJob } from '@/db/queue';
import { runStatement } from '@/db/queries';
import { accounts as accountsTable, activityEntries, changeProposals, changeSets, connectors, contentRevisions, drafts as draftsTable, opportunities as opportunitiesTable, jobs, priorityPlanSteps, priorityPolicyRules, priorityRuns, reopenDecisions, users, workItemEvidence, workItems, workItemTransitions } from '@/db/schema';
import { applySignal, type ClosureDecision } from '@/engines/closure';
import { buildHome, nextWorkingDay } from '@/engines/home';
import { connectorRowsFor, featureActive, healthForPersona, personaOf } from '@/personas';
import { buildInfo, migrationTagFor, versionPayload } from '@/server/version';
import { guidePayload } from '@/guide/checklist';
import { readReadme } from '@/server/guide';
import { CLOSED_WINDOW_DAYS } from '@/engines/home/closed';
import { DEFAULT_CLOSURE_SETTINGS, type ClosureSettings, type Signal } from '@/engines/types';
import { AppError, conflict, invalid, notFound } from '@/server/errors';
import { eventDetail } from '@/server/calendar/detail';
import { PgRuntimeJobQueue } from '@/jobs/runtime-queue';
import { scanJob } from '@/scanner/runtime/jobs';
import { connectorOfName, normalizeScanScope, ORG62_READBACK_SCOPE, placeholderScopeId } from '@/scanner/scope-catalog';
import { enqueueOrg62Readback, ORG62_READBACK_JOB, ORG62_READBACK_QUEUE } from '@/jobs/handlers/org62-readback';
import { CANVAS_CHECKS_KV, canvasChecksOf, planRecheck, recheckWindow, slotOf, type Org62Reads } from '@/lib/canvas/checks';
import { enqueueEnrich } from '@/jobs/handlers/enrich';
import type { ConnectorId } from '@/scanner/types';
import { workItemChain } from '@/scanner/trace/queries';
import type { Clock } from '@/server/ports';

import type { DataSource } from '../types';
import { docFromText, payloadFor, plainText, previewHtml, renderAll, renditionFor } from '../mock/render';
import { closureItemOf, recordAfterDecision, stateFromEngine } from './closure';
import { auditEntry, closeEntries, itemHistory, receiptFromChangeSet, sinceEntries } from './audit';
import { chatProposalStatus, chatRunnerBackend, contextRefs, mergeThreadContext, notWiredChatBackend, runTurn, type DbChatBackend, type DbChatContext } from './chat';
import { DbChatBe6, type DbChatKit } from './chat-be6';
import type { DbChatOps, DbChatPatchResult } from './chat-ops';
import { chatLlmEnabled, chatRunnerFor } from '@/server/chat/backend';
import { createChatHost } from '@/server/chat/host';
import { withBriefSummary } from '@/server/chat/brief';
import { beginChatRun } from '@/server/chat/registry';
import { PgEventBus } from './events';
import { canon, loadKv } from './ext';
import { loadFirstScanProgress } from './first-scan';
import { sourceFromDb } from './enums';
import { historyDay, historyMonth } from './history';
import { uuidFor } from './ids';
import { upsertAccountFromOrg62, upsertOpportunityFromOrg62 } from './store/projections';
import { buildOppOptions } from '@/lib/opp-options';
import { rowsForModel, storedSuggestionsOf, SUGGEST_LOOKBACK_DAYS, SUGGESTIONS_KV, wantsSuggestion, withSuggestions, type StoredSuggestion, type SuggestContext } from '@/lib/time-suggest';
import { org62OppHit, type Org62Row } from '@/server/chat/org62';
import type { runOneReadLookup } from '@/server/onboarding/identity';
import { org62RecordUrl } from '@/projections/links';
import { loadModel, type ReadModel } from './model';
import * as readin from './readin';
import { DbOnboarding, type DbOnboardingOptions } from './onboarding';
import { DbForecast } from './forecast'; // lane A
import { enginesRanker, priorityFor, storedOrderFrom, todayCapacity, toRankRows, type DbRanker } from './rank';
import { insertSession, insertToolRun, updateSession, updateToolAdapterRecent, updateToolRun, writeAppRun } from './store/agents';
import { markBriefSeen, insertWatch, updateHighlight, updateWatch } from './store/briefs';
import { writeExt, writeKv, type WriteCtx } from './store/common';
import { addTripOverride, applyOnsiteCorrection, daysBetween, ONSITE_OVERRIDES_KEY, onsiteDaysIn, readOnsiteOverrides } from './store/onsite';
import { ensurePeople } from './store/entities';
import { ackEvent as ackEventRow, countJobs, insertScanRun, JOBS_FINISHED_LIMIT, loadJobs, loadScanRuns, requeueJob, updateConnector, writeSpend } from './store/health';
import { appendChatMessage, insertChatThread, NEW_THREAD_TITLE, updateFinding, writeMapping } from './store/misc';
import { engineDraftDoc, insertDraft, updateDraft, updateNba } from './store/nba';
import { deletedOrg62OppIds, loadGapEntities, loadVdpRecords, loadVdpServer } from './store/vdp';
import { assistantDayLeft, backfillRuns, checkTransition, enqueueBackfill, loadCandidates, setCandidateStatus, VDP_ASSETS_QUEUE } from './store/vdp-candidates';
import { candidateKey, effectiveSlug, slugByAccount, vdpDetailFrom } from '@/server/vdp/detail';
import { expectedRunUsd, planFindAssets, vdpDetailCandidate } from '@/server/vdp/find';
import { actionDraftFor, gapEntities, vdpActionFor, vdpActionForItem, vdpCoverageAndQueue, type CoverageAutopilot } from '@/server/vdp/coverage';
import { runVdpAutopilot, type AutopilotApplyResult, type AutopilotPort, type AutopilotRunResult } from '@/server/vdp/autopilot';
import { activePushOf, liveMadeVia, nextPushRuns, publicPushRun, pushRunsOf, pushTimeoutSeconds, runVdpPush, settlePushRuns, startVdpPush, VDP_PUSH_JOB, VDP_PUSH_KV, type PushDelivery, type PushRoutePort, type VdpLiveReads } from '@/server/vdp/push';
import { identityIn, nextOverrides, overrideFrom, searchCompaniesLocal, searchResult, withoutOverride } from '@/server/vdp/identity';
import { judgmentsOf, overridesOf, VDP_IDENTITY_JUDGE_KV, VDP_IDENTITY_KV } from '@/engines/vdp/identity';
import { ACCOUNT_HIERARCHY_KV, hierarchyOf } from '@/lib/accounts/hierarchy';
import { VdpClient } from '@/connectors/vdp/client';
import { vdpCallLimiter } from '@/connectors/vdp/limiter';
import type { AddedOrg62Opp, VdpPushRun } from '@/contract';
import { aeCacheOf, aesByLocalOpp, VDP_AES_KV } from '@/server/vdp/specialist-aes';
import { autopilotHealth, ledgerOf, VDP_AUTOPILOT_KV, type AutopilotItem } from '@/engines/vdp/autopilot';
import { draftSendAttempts as draftAttemptsTable } from '@/db/schema';
import { goneVdpDrafts, VDP_WITHDRAWN_REASON, vdpDraftRefs, vdpHomeOf, vdpNeedYouCount } from '@/engines/vdp/status';
import { diagnoseFeedback, feedbackState, SdkFeedbackAgent, stageFeedback, type FeedbackHost } from '@/server/feedback'; // lane D
import { feedbackBudget, recordFeedbackSpend } from '@/server/feedback/budget-db'; // lane D
import { loadScrubTerms } from '@/server/feedback/terms'; // lane D
import { feedbackHeld } from '@/lib/feedback/payload'; // lane D
import { actionSummary } from '@/lib/actions';
import { dbOutboxPort, DELIVERED_STATUSES, dispatchAttempt, planDispatch, recordDispatch } from './outbox';
import { insertPolicyVersion, writeMeta, writeSection, type Section } from './store/settings';
import { canvasActionFor, canvasHolds, markCanvasHolds } from '@/lib/canvas/payload';
import { isRecordTypeKv, liveOrg62, recordTypeKv, resolveRecordTypeId } from '@/server/chat/record-type';
import { personaSwitched, reseededPolicy, timeWithoutRecordType } from '@/server/persona/switch';
import { loggingProfile, personaTargetH, withPersonaTarget } from '@/engines/activity/persona';
import { batchEventFor, buildLogBatch } from './store/log-batch';
import { loadLandingWorld, syncLandingsDb, writeLandingChanges } from './store/landings';
import { applyChanges } from '@/lib/landings/model';
import { eventUpdatesView, patchEventUpdate, proposeEventUpdates } from '@/lib/landings/updates';
import { canvasWritesView, recordLandingsView, ucLandingsView } from '@/lib/landings/views';
import { fixEdits, labelsFor, pickEdit, UC_LEAVE } from '@/server/landings/ops';
import { batchSelectionOf } from '@/server/time/batch-canvases';
import { loadRowOverrides, loadUseCaseInput, loadUseCaseSync } from './store/use-cases';
import { planUseCases } from '@/engines/activity/use-cases';
import { dcWaitingCount, ucWaitingCount, type WaitingForCanvas } from '@/lib/waiting-work';
import { chatPlansIn, pendingChatCards } from '@/server/chat/outputs';
import { ucDuplicateGuard } from '@/server/deals/use-cases';
import { insertDcRequest, loadDcRequestStatuses, loadDcRequests, loadMyDcs, updateDcRequest } from './store/dc-requests';
import { loadVdpOppIds } from './store/deals-sync';
import { needDecisionsOf, writeNeedDecision } from './store/need-decisions';
import { readTimeDismissRules, TIME_DISMISS_RULES_KEY, withRule } from './store/time-rules';
import { patchedEntry, planDismissFromSource, planRemoveRule, rulesView } from '@/server/time/dismiss';
import { dealsNeedsFor, needDecisionLabel, planNeedDecisions, withMyDcFlag } from '@/server/deals/needs';
import { needDecisionOrder } from '@/lib/need-decisions';
import { buildDealsPipeline, pipelineBasisOf } from '@/server/deals/pipeline';
import { loadForecastRecords } from '@/server/forecast/store';
import { accountDcsOf, assertDcEditable, claimComment, DC_INACTIVE, planWithdrawDcs, dcLiveConflict, dcOppNotFound, dcOppNotInOrg62, dcRequestWords, liveDcRequest, ORG62_OPP_ID, planDcRequest, type DcRequestRecord } from '@/server/deals/dc-requests';
import { updateActivity } from './store/time';
import { recomputeWeeks } from '@/projections/run';
import { insertEvidence, insertScore, insertWorkItem, logTransition, updateEvidence, updateWorkItem, workItemColumns, type WorkLinkTargets } from './store/work';
import { withdrawDraftsOfClosedItems, type WithdrawnDraft } from './store/withdraw';
import { STILL_NEEDED_MARK, staleOnArrival, stillNeededReason } from '@/engines/still-needed';
import { stateFromDb } from './enums';

/** LD-1: the live states a likely-done item can step back to on Not done. */
/** REJECT-1: a draft can be rejected until it starts sending (failed ones too: the user gives up on it). */
const REJECTABLE_DRAFT = new Set<Draft['status']>(['drafting', 'ready', 'scheduled', 'failed']);
const NOT_DONE_BACK = new Set<WorkItemRecord['state']>(['open', 'in_progress', 'waiting_on_me', 'waiting_on_others', 'reopened']);
/** A promoted highlight's one state (in Triage, or a task), from its item. Read-time only, like the mock twin. */
const promotedAs = <B extends Pick<Brief, 'highlights'>>(m: ReadModel, b: B): B => withPromotedAs(b, (wid) => m.get('workItems', wid)?.state);
import { quarterTotal } from './quarter';
import { dbPreflightContextFor } from './store/canvas-preflight';
import { isPendingLogCanvas, preflightDraft, restagedCanvas } from '@/server/time/canvas-preflight';
import { assertReviewable, canvasReviewOf, checkedUpdateValue, checkedUseCaseFields, reviewRowOf, updateLineWith, ucCreateOfRow, withoutRows, withRowReplaced } from '@/server/time/canvas-review';
import { dcAddOf, dcAddRow, dcChangeRows, org62OppIdOf } from '@/server/deals/dc-requests';
import { eventLine } from '@/engines/activity/slackbot';
import { ucCreateLine, withUcOverride } from '@/engines/activity/use-cases';
import { ROW_OVERRIDES_KV, withRowOverride } from '@/lib/canvas/overrides';
import { canvasInputOf as canvasInputOfDest } from '@/lib/canvas/payload';
import { preflightSummary } from '@/lib/canvas/preflight';
import { resolvedEntry, resolvedSummary } from '@/server/time/relog';
import { inTimeWeek, timeWeekBounds, weekTotals } from '@/server/time/week';
import { buildActivityLog } from '../activity-log';
import { buildTimeLedger } from '../time-ledger';
import { logCanvasesOf } from '../log-canvases';
import { buildItems, buildOutbox, buildSince, buildToday, buildTriage, fmtHM, healthSummary, hrefFor, hydrateItem, isLive, isMyOpp, itemRef, nowCardFor, sweptOppIds, topWithoutLikelyDone } from './views';
import { baseCandidates, buildDraftSource, slackLabels } from '../draft-source';
import { evidenceRowNames, loadDraftSourceRows, rowLabels, withSourceRows } from './store/draft-source';
import { buildEvidencePayload, evidenceTexts, inlineNames, unnamedMentions, whyMentionNames, whyTexts } from '../evidence-view';
import { defaultModeFor, mergeSendingPatch, OUTBOX_QUEUE, payloadHash, runOutboxJob, sendingConfirmNeeded, sendingOf, VDP_AUTOPILOT_POLICY, type OutboxGateway } from '@/outbox';
import { loadSpendAudit, loadSpendAuditDetail } from './store/spend-audit';
import { mockSpendAudit, mockSpendAuditDetail } from '../mock/spend-audit';
import { SCHEMA_EVENT_FINGERPRINT } from '@/db/migration-state';

type I<K extends RouteKey> = RouteInput<K>;
type Res<K extends RouteKey> = RouteOutput<K>;

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

const uniq = <T>(xs: T[]) => [...new Set(xs)];

/** UI source → the scanner scope a Health "Rescan" runs (the same map as chat's rescan in chat-be6.ts). */
const RESCAN_SCOPE: Record<string, { connector: ConnectorId; scope: string }> = {
  slack: { connector: 'slack', scope: 'inbox' },
  gmail: { connector: 'gmail', scope: 'inbox' },
  calendar: { connector: 'calendar', scope: 'primary' },
  drive: { connector: 'drive', scope: 'tracked' },
  gemini: { connector: 'gemini_notes', scope: 'poll' },
  claude: { connector: 'claude_sessions', scope: 'all' },
  org62: { connector: 'org62', scope: 'opps' },
  vdp: { connector: 'vdp', scope: 'mine' },
};

/**
 * Connectors that share a source with another scanner (Trainings reads Gmail and Calendar, Watch reads Slack) are
 * targeted by their row name, never by source: before, a Trainings or Watch Rescan rescanned the Gmail or Slack inbox
 * (go-live finding RS-2). `null` = no worker spec yet (Watch, WATCH-1): the Rescan is cancelled as "no scanner".
 */
const RESCAN_BY_NAME: Record<string, Array<{ connector: ConnectorId; scope: string }> | null> = {
  trainings: [
    { connector: 'trainings', scope: 'gmail' },
    { connector: 'trainings', scope: 'calendar' },
  ],
  watch: null,
};

/** A rescan window: everything since the cursor and at least the last hour, at most the last 24 h. */
function rescanWindow(cursorAt: string | null | undefined, now: Date): { from: string; to: string } {
  const t = now.getTime();
  const cur = cursorAt ? Date.parse(cursorAt) : Number.NaN;
  const from = Math.max(t - 24 * 3_600_000, Math.min(Number.isFinite(cur) ? cur : t, t - 3_600_000));
  return { from: new Date(from).toISOString(), to: now.toISOString() };
}
/** Editor session for autosave bursts: one per API process (single user, one browser). */
const EDITOR_SESSION = 'api';

export interface DbDataSourceOptions {
  url?: string;
  handle?: DbHandle;
  /** Process-wide pool, clock and bus (several instances in one server: one per Next route bundle). */
  shared?: boolean;
  /** Defaults to CC_USER_ID, else the one seeded user in the database. */
  userId?: string;
  clock?: Clock;
  /** Defaults to ENGINES-core (`enginesRanker`); the parity suite injects the mock's scorer (`interimRanker`). */
  ranker?: DbRanker;
  /** Chat backend (BE-6). Defaults to "not wired": the turn ends in upstream_unavailable. */
  chatBackend?: DbChatBackend;
  /** Onboarding (B-079): draft store, sources probe, first-scan starter. Tests inject fakes. */
  onboarding?: DbOnboardingOptions;
  /**
   * The one read-only Org62 call of the Time picker's search and pick (default: runOneReadLookup, live behind the
   * Assistant's gate CC_CHAT_LLM=1 + connectors on). Tests inject a fake, which also turns the picker's reads on.
   */
  org62Read?: typeof runOneReadLookup;
}

interface MutMeta {
  action: string;
  summary: string;
  entity?: { type: string; id: string };
  actor?: Actor;
  /** D-60: the change set's actor is this autonomy policy (VDP autopilot), not the user, chat or an engine. */
  policyActor?: string;
  undoable?: boolean;
  /** Autosave: coalesce into one change set per (entity) while idle < 30 s (W5/W6). */
  burst?: boolean;
  /** Rebuild the server's current entity for a 409 (`details.current`). */
  current?: () => Promise<unknown>;
  /** PERF-1: the mutation reads `jobs`/`scanRuns` from its model (`loadModel({ ops: true })`). */
  ops?: boolean;
}

/** CC_DB_NOW: real (default) | seed (the seeded asOf, running) | ISO instant | HH:MM today. */
export class DbClock implements Clock {
  private anchor: number | null = null;
  private started = Date.now();
  constructor(private readonly mode: string = process.env.CC_DB_NOW ?? 'real') {}
  bindSeedAnchor(asOf: string) {
    if (this.anchor !== null) return;
    const m = this.mode.trim();
    if (m === 'seed') this.anchor = Date.parse(asOf);
    else if (/^\d{1,2}:\d{2}$/.test(m)) {
      const [h, mm] = m.split(':').map(Number);
      const d = new Date();
      d.setHours(h!, mm!, 0, 0);
      this.anchor = d.getTime();
    } else if (m !== 'real' && !Number.isNaN(Date.parse(m))) this.anchor = Date.parse(m);
    this.started = Date.now();
  }
  now(): Date {
    return this.anchor === null ? new Date() : new Date(this.anchor + (Date.now() - this.started));
  }
}

function toAppError(e: unknown, current?: unknown): AppError | unknown {
  if (e instanceof AppError) return e;
  if (e instanceof ConflictError) return conflict(e.table.replace(/_/g, ' '), current ?? null);
  if (e instanceof UndoConflictError) return new AppError('conflict', `Changed since: ${e.table} ${e.reason.replace('_', ' ')}; review before undoing`, { current: current ?? null, reason: e.reason });
  if (e instanceof NotFoundError) return notFound(e.table, e.id);
  if (e instanceof NotUndoableError) return invalid('This change cannot be undone');
  if (e instanceof AlreadyUndoneError) return invalid('Already undone');
  if (e instanceof InvalidStateError || e instanceof ValidationError) return invalid(e.message);
  if (e instanceof ConstraintViolationError) return invalid(`Rejected by the database: ${e.message}`, { constraint: e.constraint });
  if (e instanceof DbError) return new AppError('internal', `${e.code}: database error`, undefined, true);
  return e;
}

/** B4: the refusal when a proposal's field changed after it was proposed. */
export const PROPOSAL_CHANGED_SINCE = 'Changed since this was proposed: nothing was applied. Review it: keep what is there now (Not now), or wait for the next update to propose again';

export class DbDataSource implements DataSource {
  readonly kind = 'db' as const;
  readonly handle: DbHandle;
  readonly clock: DbClock | Clock;
  readonly bus: PgEventBus;
  private readonly ranker: DbRanker;
  private readonly chatBackend: DbChatBackend;
  /** BE-CHAT: chat plans (Apply / Dismiss), scans, drafts, sessions and spend for the chat runner. */
  readonly be6: DbChatBe6;
  /** B-079: first-launch onboarding (db/onboarding.ts). */
  readonly onboarding: DbOnboarding;
  /** Lane A: Time ▸ Forecast (db/forecast.ts). */
  readonly forecast: DbForecast;
  private userIdPromise: Promise<string> | null = null;
  private readonly fixedUser: boolean;
  private readonly ownsHandle: boolean;
  private extractorId: string | null = null;
  private readonly org62Read: DbDataSourceOptions['org62Read'];

  constructor(opts: DbDataSourceOptions = {}) {
    const g = globalThis as { __ccDbShared?: { handle: DbHandle; clock: DbClock; bus: PgEventBus } };
    if (opts.shared && !opts.handle) {
      if (!g.__ccDbShared) {
        const clock = new DbClock();
        g.__ccDbShared = { handle: createDb({ url: opts.url, applicationName: 'control-center-web' }), clock, bus: new PgEventBus(resolveDatabaseUrl(opts.url), clock) };
      }
      this.handle = g.__ccDbShared.handle;
      this.ownsHandle = false;
      this.clock = opts.clock ?? g.__ccDbShared.clock;
      this.bus = g.__ccDbShared.bus;
    } else {
      this.handle = opts.handle ?? createDb({ url: opts.url, applicationName: 'control-center-web' });
      this.ownsHandle = !opts.handle;
      this.clock = opts.clock ?? new DbClock();
      this.bus = new PgEventBus(resolveDatabaseUrl(opts.url), this.clock);
    }
    this.ranker = opts.ranker ?? enginesRanker;
    this.chatBackend = opts.chatBackend ?? notWiredChatBackend;
    if (opts.userId) this.userIdPromise = Promise.resolve(opts.userId);
    this.fixedUser = !!opts.userId;
    this.org62Read = opts.org62Read;
    this.be6 = new DbChatBe6(this.chatKit());
    this.onboarding = new DbOnboarding(this.handle.db, () => this.now(), { getSettings: () => this.getSettings({} as I<'getSettings'>), patchSettings: (i) => this.patchSettings(i), applyPolicy: (i) => this.applyPolicy(i) }, opts.onboarding);
    this.forecast = new DbForecast({ db: this.handle.db, now: () => this.now(), userId: () => this.userId(), model: () => this.model(), insertDraft: (d, summary) => this.mutate({ action: 'forecast.stage', summary: summary.slice(0, 200), entity: { type: 'draft', id: d.id }, undoable: false }, (w) => insertDraft(w, d)).then((r) => (this.bus.publishTables(['drafts'], [d.id], 'forecast.stage'), { auditId: r.auditId })), rendered: (dest, doc) => renderAll(dest, doc), publish: (ids, reason) => this.bus.publishTables(['specialist_forecasts'], ids, reason) });
  }

  get db(): Db {
    return this.handle.db;
  }

  failRate(): number {
    return 0;
  }

  async dispose(): Promise<void> {
    await this.bus.stop();
    if (this.ownsHandle) await this.handle.close();
  }

  now(): Date {
    return this.clock.now();
  }

  private userId(): Promise<string> {
    this.userIdPromise ??= (async () => {
      if (process.env.CC_USER_ID) return process.env.CC_USER_ID;
      const rows = await this.db.select({ id: users.id }).from(users).where(eq(users.isActive, true)).limit(2);
      if (!rows.length) throw new AppError('internal', 'CC_DATA=db: no user in this database; set it up: npm run db:bootstrap (or npm run setup)', undefined, false);
      if (rows.length > 1) throw new AppError('internal', 'CC_DATA=db: several users; set CC_USER_ID', undefined, false);
      return rows[0]!.id;
    })().catch((e) => {
      this.userIdPromise = null;
      throw e;
    });
    return this.userIdPromise;
  }

  private async extractor(): Promise<string> {
    if (this.extractorId) return this.extractorId;
    const { ensureExtractor } = await import('./seed');
    this.extractorId = await ensureExtractor(this.db);
    return this.extractorId;
  }

  /**
   * The user's read model. PERF-1: on the pool its loaders run concurrently, and it leaves out the operational ledgers
   * (`jobs`, `scanRuns`) unless `ops` (Health's ledger, the jobs list, a manual scan's run).
   */
  async model(db: Db = this.db, lookAgain = !this.fixedUser, ops = false): Promise<ReadModel> {
    const userId = await this.userId();
    try {
      const m = await loadModel(db, userId, this.now(), { parallel: db === this.db, ops });
      if (this.clock instanceof DbClock) this.clock.bindSeedAnchor(m.meta().asOf);
      return m;
    } catch (e) {
      if ((e as Error).name === 'NotSeededError') {
        // B-079: the user changed under this process (onboarding after a database reset): look it up once more
        if (lookAgain) {
          this.userIdPromise = null;
          if ((await this.userId().catch(() => userId)) !== userId) return this.model(db, false, ops);
        }
        throw new AppError('internal', (e as Error).message, undefined, false);
      }
      throw e;
    }
  }

  /** One mutation = one change set. `fn` gets a write context and the read model loaded inside the transaction. */
  private async mutate<T>(m: MutMeta, fn: (w: WriteCtx, model: ReadModel) => Promise<T>): Promise<{ result: T; auditId: string; undoable: boolean }> {
    const userId = await this.userId();
    const extractorId = await this.extractor();
    const now = this.now();
    const actor = m.policyActor
      ? actors.autonomyPolicy(m.policyActor)
      : m.actor === 'engine' ? actors.engine(m.action) : m.actor === 'system' ? actors.system(m.action) : m.actor === 'connector' ? actors.scanner(m.action) : m.actor === 'chat' ? actors.chat(m.action) : actors.user(m.action);
    try {
      const { result, changeSetId } = await withChangeSet(
        {
          db: this.db,
          userId,
          actor,
          reason: m.summary,
          entity: m.entity,
          undoable: m.undoable,
          ...(m.burst && m.entity ? { kind: 'autosave_burst' as const, editorSessionId: EDITOR_SESSION } : {}),
        },
        async (tx, cs) => {
          const model = await loadModel(tx as unknown as Db, userId, now, { ops: m.ops ?? false });
          const w: WriteCtx = { tx, cs, userId, me: model.ctx.me, now, extractorId, timezone: model.settings().profile.timezone, kv: model.ctx.kv };
          const r = await fn(w, model);
          // audit time follows the logical clock (== wall clock unless CC_DB_NOW pins it)
          if (cs.kind !== 'autosave_burst') await tx.update(changeSets).set({ createdAt: now }).where(eq(changeSets.id, cs.id));
          // proposals the helper created in this transaction (created_at = now() = transaction start)
          await tx.update(changeProposals).set({ createdAt: now }).where(and(eq(changeProposals.ownerUserId, userId), sql`${changeProposals.createdAt} = now()`));
          return r;
        },
      );
      // an empty change set (nothing audited: unaudited tables, or no change at all) is closed undoable = false
      const [cs] = await this.db.select({ undoable: changeSets.undoable }).from(changeSets).where(eq(changeSets.id, changeSetId));
      return { result, auditId: changeSetId, undoable: !!cs?.undoable };
    } catch (e) {
      const current = e instanceof ConflictError && m.current ? await m.current().catch(() => null) : undefined;
      throw toAppError(e, current);
    }
  }

  private links(model: ReadModel): WorkLinkTargets {
    const sessions = new Set(model.all('agentRuns').filter((r) => r.kind === 'claude_session').map((r) => r.id));
    const toolByMirror = new Map(model.all('toolRuns').filter((t) => t.agentRunId).map((t) => [t.agentRunId!, t.id]));
    const assets = new Set(model.all('assets').map((a) => a.id));
    return {
      runLinks: (runIds) =>
        runIds.flatMap((r): { claudeSessionId?: string; toolRunId?: string }[] => (sessions.has(r) ? [{ claudeSessionId: r }] : toolByMirror.has(r) ? [{ toolRunId: toolByMirror.get(r)! }] : [])),
      hasAsset: (a) => assets.has(a),
    };
  }

  private item(model: ReadModel, itemId: string): WorkItemRecord {
    const w = model.get('workItems', itemId);
    if (!w) throw notFound('Work item', itemId);
    return w;
  }

  private checkVersion(cur: { version: number }, ifVersion: number | undefined, what: string, current: unknown) {
    if (ifVersion !== undefined && cur.version !== ifVersion) throw conflict(what, current);
  }

  private async writeItem(w: WriteCtx, model: ReadModel, cur: WorkItemRecord, next: WorkItemRecord, o: { bump: boolean; ifVersion?: number; lock?: WorkItemLockableField[] }) {
    const known = new Set([...model.ctx.people.keys()]);
    await ensurePeople(w, [next.owner, next.counterparty, ...next.people], known);
    const r = await updateWorkItem(w, cur, next, this.links(model), o);
    model.put('workItems', next);
    this.putWithdrawn(model, r.withdrawn, w.now);
    return r;
  }

  /** OUTBOX-W: the drafts a close just withdrew, as the rest of this request's read model sees them. */
  private putWithdrawn(model: ReadModel, withdrawn: readonly WithdrawnDraft[], now: Date) {
    for (const x of withdrawn) {
      const d = model.get('drafts', x.id);
      if (d) model.put('drafts', { ...d, status: 'discarded', rejectedReason: x.reason, version: d.version + 1, updatedAt: now.toISOString() });
    }
  }

  private async hydrated(itemId: string): Promise<WorkItem> {
    const model = await this.model();
    return hydrateItem(model, this.item(model, itemId));
  }

  // =========================================================================
  // Today
  // =========================================================================

  private async rankedIds(): Promise<string[]> {
    const userId = await this.userId();
    const rows = await runStatement<{ id: string }>(this.handle.pool, 'Q1', [userId]);
    return rows.map((r) => r.id);
  }

  /** GET /home: the pure Home engine over the read model, with Today's own capacity (same numbers on both pages). */
  async getHome({ query }: I<'getHome'>): Promise<Res<'getHome'>> {
    const model = await this.model();
    const now = this.now();
    const meta = model.meta();
    const settings = model.settings();
    const spend = model.spend();
    // PERF-1: Today's capacity and the since digest from this request's model (it loaded both twice)
    const sinceP = this.sinceDigest(model, now);
    const timezone = settings.profile.timezone || meta.timezone;
    const day = query?.day ?? 'today';
    // Planning the next working day: the CAPACITY engine at that day's working-hours start (Today's own is today's)
    const planAt = day === 'next' ? new Date(nextWorkingDay(now.getTime(), timezone, settings.profile.workingHours).startMs) : null;
    const [capacity, since] = await Promise.all([planAt ? todayCapacity(model, planAt) : this.todayOf(model, now, sinceP).then((t) => t.header.capacity), sinceP]);
    return buildHome({
      now: now.toISOString(),
      timezone,
      workingHours: settings.profile.workingHours,
      wide: query?.wide ?? false,
      day,
      persona: personaOf(settings),
      items: model.all('workItems').map((w) => hydrateItem(model, w)),
      nbas: model.all('nbas'),
      drafts: model.all('drafts'),
      proposals: model.all('proposals'),
      events: model.all('events'),
      slots: model.all('slots'),
      initiatives: model.all('initiatives'),
      accounts: model.all('accounts'),
      opps: model.all('opps'),
      missedOpps: model.all('missedOpps'),
      activity: model.all('activity'),
      // D-55: Home's footer and Log & fix name only the persona's active sources
      connectors: connectorRowsFor(model.all('connectors'), personaOf(settings)),
      agentRuns: model.all('agentRuns'),
      briefs: model.all('briefs'),
      quarter: meta.quarter,
      canvasLabel: meta.canvas.label,
      since: { changed: since.counts.changed, closed: since.counts.closed, new: since.counts.new, show: since.show },
      spend: { usd: spend.today.usd, softBudgetUsd: spend.today.softBudgetUsd },
      dryRun: settings.sending.dryRun,
      capacity,
      closedSince: settings.closing.tellMeWhatClosed ? meta.lastActiveAt : null,
      forecast: await this.forecast.homeInput(model), // lane A
      vdp: await this.vdpHome(model), // D-59
      decisions: needDecisionsOf(model.ctx.kv), // Log & fix rows set aside (Not now / Not needed)
      dcNeeds: featureActive(personaOf(settings), 'dealContributions') ? (await this.dealsNeeds(model)).filter((n) => n.section === 'fix') : undefined, // DC-31: one count source with Deals
      waitingForCanvas: await this.waitingForCanvas(model), // 2026-11-13 audit C2: never "Nothing missing" while they wait
    });
  }

  /** D-59: Home's and the Time badge's VDP input (the coverage summary), only while VDP is active for the persona. */
  private async vdpHome(model: ReadModel) {
    if (!featureActive(personaOf(model.settings()), 'vdp')) return undefined;
    return vdpHomeOf((await this.vdpState(model)).coverage);
  }

  async getToday(_i: I<'getToday'>): Promise<Res<'getToday'>> {
    const model = await this.model();
    const now = this.now();
    const [t, v, waitingForCanvas] = await Promise.all([this.todayOf(model, now, this.sinceDigest(model, now)), this.vdpHome(model), this.waitingForCanvas(model)]);
    // D-59: the Time badge also counts the VDPs that need you (quiet; only approvals waiting are loud); 2026-11-13 audit
    // C2: and the DCs and use cases waiting for a canvas; C8: the Assistant's staged cards
    return { ...t, navCounts: { ...t.navCounts, vdpOpen: v ? vdpNeedYouCount(v.summary) : 0, waitingForCanvas, assistantPending: pendingChatCards(chatPlansIn(model.ctx.kv)) } };
  }

  /**
   * 2026-11-13 audit C2: DC requests (approved, not on a canvas yet) and VDP use cases (creates, Stage / Go-Live
   * fixes) waiting for a logging canvas, while the persona has each feature: the sidebar badge and Home ▸ Log & fix.
   * The same counts Time ▸ Log it reads from listDcRequests and getUseCaseSync (src/lib/waiting-work.ts).
   */
  private async waitingForCanvas(model: ReadModel): Promise<WaitingForCanvas> {
    const persona = personaOf(model.settings());
    const userId = model.ctx.userId;
    const [dcs, useCases] = await Promise.all([
      featureActive(persona, 'dealContributions') ? loadDcRequests(this.db, userId).then(dcWaitingCount) : 0,
      featureActive(persona, 'vdp') ? loadUseCaseSync(this.db, userId).then((u) => ucWaitingCount(u.counts)) : 0,
    ]);
    return { dcs, useCases };
  }

  /** MIN-27: the latest away-since already applied (or found applied), so repeat headers cost nothing. */
  private awayNoted = 0;

  /**
   * MIN-27: the browser's "when the user last left" (`x-cc-away-since`, ms). `cc.meta.lastActiveAt`, where Home's,
   * Today's and the shell's since-you-left start, moves forward to it (never back, never past now). One small
   * change set per return (actor user, so the digest never lists it; not undoable).
   */
  async notePresence(awaySinceMs: number): Promise<void> {
    if (!(awaySinceMs > this.awayNoted)) return;
    const now = this.now().getTime();
    // a browser ahead of this clock (CC_DB_NOW pins it in the past) says nothing about this timeline
    if (awaySinceMs > now + 60_000) return;
    const at = Math.min(awaySinceMs, now);
    const userId = await this.userId();
    const [row] = await this.db
      .execute<{ at: string | null }>(sql`select value->>'lastActiveAt' as at from user_settings where owner_user_id = ${userId} and key = 'cc.meta'`)
      .then((r) => r.rows);
    const cur = row?.at ? Date.parse(row.at) : NaN;
    if (!row || (Number.isFinite(cur) && cur >= at)) {
      this.awayNoted = Math.max(this.awayNoted, Number.isFinite(cur) ? cur : at, at);
      return;
    }
    const iso = new Date(at).toISOString();
    await withChangeSet({ db: this.db, userId, actor: actors.user('presence.return'), reason: 'Back: since-you-left starts when you left', undoable: false }, async (tx) => {
      await tx.execute(sql`
        update user_settings set value = jsonb_set(value, '{lastActiveAt}', to_jsonb(${iso}::text)), updated_at = now()
         where owner_user_id = ${userId} and key = 'cc.meta'
           and coalesce((value->>'lastActiveAt')::timestamptz < ${iso}::timestamptz, true)`);
    });
    this.awayNoted = at;
    for (const topic of ['home', 'since'] as const) this.bus.publish({ topic, ids: [], reason: 'presence.return' });
  }

  private async sinceDigest(model: ReadModel, now: Date): Promise<SinceDigest> {
    const meta = model.meta();
    return buildSince(model, await sinceEntries(this.db, model.ctx.userId, new Date(meta.lastActiveAt), model, model.ctx.kv), meta.lastActiveAt, now);
  }

  /** Today over one model; its SQL reads (Q1 ranked ids, Q6 closes, the since digest) run concurrently. */
  private async todayOf(model: ReadModel, now: Date, sinceP: Promise<SinceDigest>): Promise<Res<'getToday'>> {
    const meta = model.meta();
    const [rankedIds, closeUndo, since] = await Promise.all([
      this.rankedIds(),
      closeEntries(this.db, model.ctx.userId, new Date(Date.parse(meta.lastActiveAt) - 12 * 3_600_000)),
      sinceP,
    ]);
    const ordered = storedOrderFrom(model, rankedIds);
    // every suggestion counts: the model holds them all (Q9's LIMIT 100 hid the oldest once DEEP-1 filled Triage)
    const triage = buildTriage(model);
    // Top 3 stability: the ranker keeps the stored positions (ENGINES-core `rerank`) and counts what a re-rank would change
    const t = this.ranker.today(model, ordered, now);
    const slots = topWithoutLikelyDone(t.top, t.rest);
    return buildToday(model, { top: slots.top, rest: slots.rest, plan: t.plan, closeUndo, since, rerankReady: t.rerankReady, triageCount: triage.count }, now);
  }

  async rerankToday(_i: I<'rerankToday'>): Promise<Res<'rerankToday'>> {
    const now = this.now();
    const ids = await this.rankedIds();
    const r = await this.mutate({ action: 'today.rerank', summary: 'Applied re-rank', entity: { type: 'policy', id: 'ranking' } }, async (w, model) => this.rerankIn(w, model, model.settings().policy, ids, now));
    return { entity: r.result.result, auditId: r.undoable ? r.auditId : null };
  }

  /**
   * A system re-rank (actor `system`) with this DataSource's ranker: `db:seed` runs it once after loading, so
   * a fresh database starts from ENGINES-core's ranking instead of the seed's (the mock's load-time ranks).
   */
  async systemRerank(reason: string): Promise<{ top3: string[]; auditId: string | null }> {
    const now = this.now();
    const ids = await this.rankedIds();
    const r = await this.mutate({ action: 'system.rerank', summary: reason, entity: { type: 'policy', id: 'ranking' }, actor: 'system' }, async (w, model) => this.rerankIn(w, model, model.settings().policy, ids, now));
    return { top3: r.result.result.top.slice(0, 3).map((t) => t.workItemId), auditId: r.undoable ? r.auditId : null };
  }

  /**
   * Rank (ENGINES-core by default), write a priority run (engine version, policy version row, focus
   * minutes, next meeting) + a priority_scores row per changed item (components, lane, latest_start_at,
   * slack, inputs hash, rule hits) + the plan steps, refresh the work-item rank cache and meta. One
   * change set: undo restores the previous ranks and score pointers.
   */
  private async rerankIn(w: WriteCtx, model: ReadModel, policy: PriorityPolicy, rankedIds: string[], now: Date, policyRowId?: string) {
    const before = storedOrderFrom(model, rankedIds).map((i) => i.id);
    const rowId = policyRowId ?? model.extra.policyRowId;
    if (!rowId) throw new AppError('internal', 'no active priority policy row', undefined, false);
    const ranking = this.ranker.rank(model, policy, now);
    const scored = ranking.ranked;
    const byId = new Map(scored.map((s, i) => [s.id, { ...s, rank: i + 1 }]));
    const [run] = await w.tx
      .insert(priorityRuns)
      .values({
        ownerUserId: w.userId,
        trigger: 'user_reprioritize',
        engineVersion: ranking.engineVersion,
        policyId: rowId,
        startedAt: now,
        finishedAt: now,
        itemsConsidered: ranking.result ? Object.keys(ranking.result.scores).length : scored.length,
        availableFocusMinutes: ranking.result ? Math.round(ranking.result.capacity.focusMinLeft) : null,
        nextMeetingAt: ranking.result?.nextMeeting ? new Date(ranking.result.nextMeeting.start) : null,
      })
      .returning({ id: priorityRuns.id });
    const ruleIds = new Map((await w.tx.select({ id: priorityPolicyRules.id, key: priorityPolicyRules.ruleKey }).from(priorityPolicyRules).where(eq(priorityPolicyRules.policyId, rowId))).map((r) => [r.key, r.id]));
    let changedItems = 0;
    for (const cur of model.all('workItems')) {
      const s = byId.get(cur.id);
      const detail = ranking.details?.get(cur.id);
      // the engine also derives the background lane (R-UI-8); an explicit isBackground stays
      const isBackground = cur.isBackground || detail?.lane === 'background';
      const next: WorkItemRecord = s
        ? { ...cur, rank: s.rank, score: s.score, rankReasons: s.reasons, priority: priorityFor(s.rank), isBackground }
        : { ...cur, rank: null, score: detail && isBackground ? cur.score : null, isBackground };
      const startByChanged = !!detail && !cur.userLockedFields.includes('startBy') && (detail.startBy ?? null) !== (cur.startBy ?? null);
      if (next.rank === cur.rank && next.score === cur.score && next.isBackground === cur.isBackground && JSON.stringify(next.rankReasons) === JSON.stringify(cur.rankReasons) && next.priority === cur.priority && !startByChanged) continue;
      changedItems++;
      const scoreId = await insertScore(w, next, { runId: run!.id, policyId: rowId, detail, ruleIds }, now);
      await updateWorkItem(w, cur, next, this.links(model), { bump: false });
      await w.tx
        .update(workItems)
        .set({ priorityScoreId: scoreId, priorityComputedAt: now, ...(detail ? { priorityLane: s ? detail.lane : isBackground ? 'background' : null } : {}), updatedAt: sql`${workItems.updatedAt}` })
        .where(eq(workItems.id, cur.id));
      model.put('workItems', detail && startByChanged ? { ...next, startBy: detail.startBy } : next);
    }
    await w.tx.update(priorityRuns).set({ itemsChanged: changedItems }).where(eq(priorityRuns.id, run!.id));
    const steps = (ranking.result?.planSteps ?? []).filter((p) => p.workItemId || p.calendarEventId);
    if (steps.length) {
      await w.tx.insert(priorityPlanSteps).values(
        steps.map((p, i) => ({ runId: run!.id, ordinal: i, workItemId: p.workItemId, calendarEventId: p.calendarEventId, mode: p.mode, plannedStartAt: new Date(p.plannedStartAt), plannedEndAt: new Date(p.plannedEndAt), reason: p.reason })),
      );
    }
    await writeMeta(w, { ...model.meta(), rankedAt: now.toISOString(), policyRankVersion: policy.version });
    const top = toRankRows(model, scored, before, 10);
    return { scored, result: { rankedAt: now.toISOString(), changed: top.filter((t) => t.moved !== 0).length, top } };
  }

  // =========================================================================
  // Work items
  // =========================================================================

  async listItems({ query }: I<'listItems'>): Promise<Res<'listItems'>> {
    const model = await this.model();
    const userId = model.ctx.userId;
    // structural filters in SQL; text and source filters over the mapped records
    const where = [eq(workItems.ownerUserId, userId)];
    if (query.account) where.push(eq(workItems.accountId, uuidFor(query.account)));
    if (query.opp) where.push(eq(workItems.opportunityId, uuidFor(query.opp)));
    if (query.initiative) where.push(eq(workItems.initiativeId, uuidFor(query.initiative)));
    let ids: Set<string>;
    try {
      ids = new Set((await this.db.select({ id: workItems.id }).from(workItems).where(and(...where))).map((r) => r.id));
    } catch {
      ids = new Set();
    }
    const filtered = model.all('workItems').filter((i) => {
      if (!ids.has(i.id)) return false;
      if (query.source && !i.sources.some((s) => s.kind === query.source)) return false;
      if (query.kind && i.kind !== query.kind) return false;
      if (query.q && !`${i.title} ${i.purpose ?? ''} ${i.why}`.toLowerCase().includes(query.q.toLowerCase())) return false;
      return true;
    });
    return buildItems(model, filtered, query.tab);
  }

  async getItem({ params }: I<'getItem'>): Promise<Res<'getItem'>> {
    const model = await this.model();
    const d = this.itemDetail(model, params.id);
    // the why line names someone neither the directory nor the texts do: the item's own Slack rows may (read only
    // when needed)
    const texts = whyTexts(d.item, d.nba);
    const people = slackLabels(model.all('people'));
    const evidence = model.all('evidence').filter((e) => e.workItemId === d.item.id);
    if (!unnamedMentions(texts, people, inlineNames([...texts, ...evidenceTexts(evidence)])).length) return d;
    return { ...d, mentions: whyMentionNames(texts, evidence, people, await evidenceRowNames(this.db, model.ctx.userId, d.item.id)) };
  }

  private itemDetail(m: ReadModel, itemId: string): WorkItemDetail {
    const rec = this.item(m, itemId);
    const evidence = m.all('evidence').filter((e) => e.workItemId === rec.id);
    const card = nowCardFor(m, rec);
    const ini = rec.initiativeId ? (m.get('initiatives', rec.initiativeId) ?? null) : null;
    const siblings = ini ? m.all('workItems').filter((w) => w.initiativeId === ini.id && w.id !== rec.id).map((w) => hydrateItem(m, w)) : [];
    return {
      item: card.item,
      nba: card.nba,
      draft: card.draft,
      initiative: ini,
      siblings,
      proposals: card.proposals,
      runs: rec.runIds.map((r) => m.get('agentRuns', r)).filter((r): r is AgentRun => !!r),
      assets: uniq([...rec.assetIds, ...(ini?.assetIds ?? [])]).map((a) => m.get('assets', a)).filter((a): a is Asset => !!a),
      account: rec.accountId ? (m.get('accounts', rec.accountId) ?? null) : null,
      opp: rec.oppId ? (m.get('opps', rec.oppId) ?? null) : null,
      meeting: rec.servesEventId ? (m.get('events', rec.servesEventId) ?? null) : null,
      evidenceCount: evidence.length,
      mentions: whyMentionNames(whyTexts(card.item, card.nba), evidence, slackLabels(m.all('people'))),
    };
  }

  async captureItem({ body }: I<'captureItem'>): Promise<Res<'captureItem'>> {
    const r = await this.captureInternal(body, 'user');
    return { entity: await this.hydrated(r.result), auditId: r.auditId };
  }

  /** Quick capture. Users lock the title they typed; chat captures lock nothing (only user edits lock). */
  private async captureInternal(body: { text: string; accountId?: string; initiativeId?: string; due?: string }, actor: 'user' | 'chat') {
    const byUser = actor === 'user';
    const now = this.now().toISOString();
    let text = body.text.trim();
    let youMin = 15;
    const eff = /~(\d+)\s*(m|min|h)\b/i.exec(text);
    if (eff) {
      youMin = eff[2]!.toLowerCase() === 'h' ? Number(eff[1]) * 60 : Number(eff[1]);
      text = text.replace(eff[0], '').trim();
    }
    const r = await this.mutate({ action: byUser ? 'item.capture' : 'chat.capture', summary: 'Captured', entity: undefined, actor }, async (w, model) => {
      let accountId = body.accountId ?? null;
      const acc = /#([\w-]+)/.exec(text);
      if (acc) {
        const match = model.all('accounts').find((a) => a.name.toLowerCase().startsWith(acc[1]!.toLowerCase()));
        if (match) accountId = match.id;
        text = text.replace(acc[0], match?.name ?? acc[1]!).trim();
      }
      const itemId = crypto.randomUUID();
      const label = byUser ? 'Quick capture' : 'Chat capture';
      const rec: WorkItemRecord = {
        ...blankItem(now, model.ctx.me),
        id: itemId,
        kind: 'task',
        state: 'open',
        title: text.replace(/\s+/g, ' '),
        initiativeId: body.initiativeId ?? null,
        accountId,
        confidence: 'sure',
        why: byUser ? 'Captured by you' : 'Captured from chat',
        sources: [{ kind: 'manual', label, at: now }],
        effort: { youMin, agentMin: 0 },
        due: body.due ?? null,
        signals: { customerFacing: !!accountId, fromManager: false, boost: 0 },
        userLockedFields: byUser ? ['title'] : [],
        reevaluating: false, // derived from the queued enrich job
        seenAt: now,
        enrichment: { status: 'enriching', startedAt: now, chips: [] },
      };
      await w.cs.tx.update(changeSets).set({ summary: `Captured: ${rec.title}`, entityType: 'work_item', entityId: itemId }).where(eq(changeSets.id, w.cs.id));
      await insertWorkItem(w, rec, this.links(model), { locks: byUser ? ['title'] : [] });
      await insertEvidence(w, { id: crypto.randomUUID(), workItemId: itemId, role: 'origin', source: { kind: 'manual', label, at: now }, at: now, summary: rec.why, snippet: null, author: null, isNew: false, confidence: null }, now, actor);
      // enrichment (related sessions, assets, threads → chips, NBA, draft) is the worker's job
      await enqueueEnrich(w.tx, w.userId, itemId); // src/jobs/handlers/enrich.ts (HYG-1: before, no worker handled `enrich`)
      return itemId;
    });
    this.bus.publishTables(['jobs'], [r.result], byUser ? 'item.capture' : 'chat.capture');
    return r;
  }

  async patchItem({ params, body }: I<'patchItem'>): Promise<Res<'patchItem'>> {
    const r = await this.mutate(
      { action: 'item.edit', summary: 'Edited', entity: { type: 'work_item', id: params.id }, burst: true, current: () => this.hydrated(params.id) },
      async (w, model) => {
        const cur = this.item(model, params.id);
        this.checkVersion(cur, body.ifVersion, 'Work item', hydrateItem(model, cur));
        const locks = new Set(cur.userLockedFields);
        const newly: WorkItemLockableField[] = [];
        for (const k of Object.keys(body.patch)) if (ITEM_PATCH_LOCK[k]) {
          locks.add(ITEM_PATCH_LOCK[k]);
          newly.push(ITEM_PATCH_LOCK[k]);
        }
        await w.tx.update(changeSets).set({ summary: `Edited: ${cur.title}` }).where(eq(changeSets.id, w.cs.id));
        const next = { ...cur, ...body.patch, userLockedFields: [...locks] } as WorkItemRecord;
        await this.writeItem(w, model, cur, next, { bump: true, ifVersion: body.ifVersion, lock: newly });
      },
    );
    return { entity: await this.hydrated(params.id), auditId: r.auditId };
  }

  async itemAction({ params, body }: I<'itemAction'>): Promise<Res<'itemAction'>> {
    const r = await this.mutate(
      { action: `item.${params.verb}`, summary: params.verb, entity: { type: 'work_item', id: params.id }, current: () => this.hydrated(params.id) },
      async (w, model) => {
        const cur = this.item(model, params.id);
        this.checkVersion(cur, body.ifVersion, 'Work item', hydrateItem(model, cur));
        const now = w.now.toISOString();
        const done = (reason: string, resolution: Resolution = 'done_by_me'): WorkItemRecord =>
          resolvedRecord(model, cur, { reason, resolution, detail: body.detail ?? {}, involvement: body.involvement, doneBy: 'user', at: now });
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
            next = done(resolutionLabel(body.resolution, body.detail?.personName ?? (body.detail?.personId ? model.get('people', body.detail.personId)?.name : undefined)), body.resolution);
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
          case 'not-done': {
            // LD-1: back to the live state it had before the engine called it likely done (the last transition into
            // likely_done says which; in_progress as the closure machine's own step-back); the evidence stays linked, so the same reply does not flag it again.
            if (cur.state !== 'likely_done') throw invalid('Only likely-done items can be marked not done');
            const [t] = await w.tx
              .select({ from: workItemTransitions.fromStatus })
              .from(workItemTransitions)
              .where(and(eq(workItemTransitions.workItemId, uuidFor(cur.id)), eq(workItemTransitions.toStatus, 'likely_done')))
              .orderBy(desc(workItemTransitions.occurredAt), desc(workItemTransitions.id))
              .limit(1);
            const prior = t?.from ? stateFromDb(t.from, false) : null;
            next = { ...cur, state: prior && NOT_DONE_BACK.has(prior) ? prior : 'in_progress', likelyDone: null };
            label = 'Not done';
            break;
          }
          case 'reopen':
            if (cur.state !== 'done' && cur.state !== 'dismissed') throw invalid('Only done or dismissed items can be reopened');
            // OUTBOX-W: drafts withdrawn when it closed stay discarded (they answered the old state of the thread);
            // the user can draft again. Undo of the close, not a reopen, is what restores them.
            next = { ...cur, state: 'reopened', doneAt: null, doneBy: null, closedReason: null, dismissed: null, resolution: null, resolutionDetail: null, involvement: 'owner', reopened: { reason: body.note ?? 'Reopened by you', at: now } };
            label = 'Reopened';
            break;
          case 'not-now': {
            if (!body.reason) throw invalid('not-now needs a `reason` (done_elsewhere · not_mine · later · wrong_account · other)');
            label = 'Not now';
            if (body.reason === 'done_elsewhere') next = done('Done elsewhere');
            else if (body.reason === 'later') {
              const until = body.until ?? setMinutes(setHours(addDays(w.now, 1), 9), 0).toISOString();
              next = { ...cur, state: 'snoozed', snoozedUntil: until, snoozedFrom: cur.state };
            } else if (body.reason === 'wrong_account') next = { ...cur, accountId: null, oppId: null, notes: `${cur.notes}${cur.notes ? '\n' : ''}Wrong account (not now)` };
            else next = { ...cur, state: 'dismissed', dismissed: { reason: body.reason, note: body.note, at: now } };
            break;
          }
        }
        await w.tx.update(changeSets).set({ summary: `${label}: ${cur.title}` }).where(eq(changeSets.id, w.cs.id));
        await this.writeItem(w, model, cur, next, { bump: true, ifVersion: body.ifVersion });
        await logTransition(w, cur.id, cur.state, next.state, next.closedReason ?? next.dismissed?.note ?? label);
      },
    );
    return { entity: await this.hydrated(params.id), auditId: r.auditId };
  }

  async getItemEvidence({ params }: I<'getItemEvidence'>): Promise<Res<'getItemEvidence'>> {
    const model = await this.model();
    this.item(model, params.id);
    const evidence = model.all('evidence').filter((e) => e.workItemId === params.id);
    const people = slackLabels(model.all('people'));
    // names the directory lacks: the ones the item's own Slack rows carry (read only when a snippet needs them)
    const rows = unnamedMentions(evidenceTexts(evidence), people).length ? await evidenceRowNames(this.db, model.ctx.userId, params.id) : {};
    return buildEvidencePayload(params.id, evidence, people, rows);
  }

  /** AUDIT "why is this here?": evidence → source (link) → the scan run that made it → triage verdict → spend. */
  async getItemTrace({ params }: I<'getItemTrace'>): Promise<Res<'getItemTrace'>> {
    const model = await this.model();
    this.item(model, params.id);
    const userId = await this.userId();
    const chain = await workItemChain(this.db, userId, params.id);
    const evidence = new Map(model.all('evidence').filter((e) => e.workItemId === params.id).map((e) => [e.id, e]));
    return {
      workItemId: params.id,
      createdBy: chain.createdBy,
      steps: chain.steps.map((s) => {
        const ev = evidence.get(s.evidenceId);
        return {
          evidenceId: s.evidenceId,
          role: s.role,
          confidence: s.confidence === 0.5 ? null : s.confidence,
          rationale: s.rationale,
          at: s.createdAt,
          // the evidence chip's own source (label, link) when the model has it, else the chain's
          source: ev?.source ?? (s.source ? { kind: sourceFromDb(s.source.kind as Parameters<typeof sourceFromDb>[0]), label: s.source.title ?? s.source.kind, ...(s.source.url ? { url: s.source.url } : {}), ...(s.source.externalId ? { externalId: s.source.externalId } : {}), ...(s.source.occurredAt ? { at: s.source.occurredAt } : {}) } : null),
          sourceItemId: s.sourceItemId,
          run: s.run ? { id: s.run.id, connector: s.run.connector, scope: s.run.scope, trigger: s.run.trigger, mode: s.run.mode, status: s.run.status, windowStart: s.run.windowStart, windowEnd: s.run.windowEnd, startedAt: s.run.startedAt, finishedAt: s.run.finishedAt, skillVersion: s.run.skillVersion, model: s.run.model, costUsd: s.run.costUsd, via: s.run.via } : null,
          verdict: s.verdict,
          spend: s.spend,
        };
      }),
    };
  }

  async getItemHistory({ params }: I<'getItemHistory'>): Promise<Res<'getItemHistory'>> {
    const model = await this.model();
    const rec = this.item(model, params.id);
    const nba = rec.nbaId ? model.get('nbas', rec.nbaId) : undefined;
    const entries = await itemHistory(this.db, model.ctx.userId, rec.id, model, model.ctx.kv);
    return { workItemId: rec.id, entries, nbaVersions: nba?.versions ?? [] };
  }

  async markItemSeen({ params }: I<'markItemSeen'>): Promise<Res<'markItemSeen'>> {
    await this.mutate({ action: 'item.seen', summary: 'Seen', entity: { type: 'work_item', id: params.id }, undoable: false }, async (w, model) => {
      const cur = this.item(model, params.id);
      const seenAt = w.now.toISOString();
      for (const e of model.all('evidence')) if (e.workItemId === cur.id && e.isNew) await updateEvidence(w, e, { ...e, isNew: false }, seenAt);
      await this.writeItem(w, model, cur, { ...cur, newEvidenceCount: 0, seenAt }, { bump: false });
      for (const e of model.all('evidence')) if (e.workItemId === cur.id && !e.isNew) await updateEvidence(w, e, e, seenAt);
    });
    return { entity: await this.hydrated(params.id), auditId: null };
  }

  async getInitiative({ params }: I<'getInitiative'>): Promise<Res<'getInitiative'>> {
    const m = await this.model();
    const ini = m.get('initiatives', params.id);
    if (!ini) throw notFound('Initiative', params.id);
    const items = m.all('workItems').filter((w) => w.initiativeId === ini.id);
    const detail: InitiativeDetail = {
      initiative: ini,
      items: items.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)).map((w) => hydrateItem(m, w)),
      assets: ini.assetIds.map((a) => m.get('assets', a)).filter((a): a is Asset => !!a),
      runs: m.all('agentRuns').filter((r) => items.some((w) => w.id === r.workItemId)),
      account: ini.accountId ? (m.get('accounts', ini.accountId) ?? null) : null,
      opp: ini.oppId ? (m.get('opps', ini.oppId) ?? null) : null,
      people: ini.people.map((p) => m.get('people', p.id) ?? { ...p, accountId: null }),
    };
    return detail;
  }

  // =========================================================================
  // NBA and proposals
  // =========================================================================

  private nbaPayload(m: ReadModel, itemId: string): NbaPayload {
    const card = nowCardFor(m, this.item(m, itemId));
    return { nba: card.nba, draft: card.draft, proposals: card.proposals };
  }

  async getItemNba({ params }: I<'getItemNba'>): Promise<Res<'getItemNba'>> {
    return this.nbaPayload(await this.model(), params.id);
  }

  private isSession(m: ReadModel) {
    return (runId: string) => m.get('agentRuns', runId)?.kind === 'claude_session';
  }

  async regenerateNba({ params, body }: I<'regenerateNba'>): Promise<Res<'regenerateNba'>> {
    let itemId = '';
    const r = await this.mutate({ action: `nba.${body.instruction}`, summary: 'Regenerated', entity: { type: 'nba', id: params.id }, current: async () => (await this.model()).get('nbas', params.id) ?? null }, async (w, model) => {
      const nba = model.get('nbas', params.id);
      if (!nba) throw notFound('NBA', params.id);
      itemId = nba.workItemId;
      this.checkVersion(nba, body.ifVersion, 'NBA', nba);
      const draft = nba.draftId ? model.get('drafts', nba.draftId) : undefined;
      const reasons = { regenerate: 'Regenerated', shorter: 'Made shorter', more_formal: 'Made more formal', add_detail: 'Added detail' } as const;
      const reason = reasons[body.instruction];
      await w.tx.update(changeSets).set({ summary: `${reason}: ${nba.title}` }).where(eq(changeSets.id, w.cs.id));
      let update: NbaCard['update'] = { at: w.now.toISOString(), reason, kind: 'revised', proposalId: null, diffSummary: null, source: null };
      if (draft) {
        const newDoc = docFromText(rewrite(draft.plainText, body.instruction));
        if (draft.userTouched) {
          // an engine rewrite of a touched draft is a proposal ("Apply / Keep mine"), whatever the request actor
          const res = await engineUpdate(w.tx, draftsTable, draft.id, { docJson: newDoc as unknown as Record<string, unknown> }, { lockAll: true, reason });
          const pid = res.proposals[0]?.proposalId ?? null;
          const groupId = pid ? ((await w.tx.select({ g: changeProposals.groupId }).from(changeProposals).where(eq(changeProposals.id, pid)))[0]?.g ?? pid) : null;
          update = { ...update, kind: 'proposal', proposalId: groupId };
        } else {
          await updateDraft(w, draft, { ...draft, doc: newDoc, plainText: plainText(newDoc), rendered: renderAll(draft.destination, newDoc) }, { bump: true });
        }
      }
      const v = update.kind === 'revised' ? nba.version + 1 : nba.version;
      await updateNba(w, nba, { ...nba, version: v, update, generatedAt: w.now.toISOString(), versions: update.kind === 'revised' ? [...nba.versions, { version: v, at: w.now.toISOString(), reason, diffSummary: null }] : nba.versions }, this.isSession(model));
    });
    return { entity: this.nbaPayload(await this.model(), itemId), auditId: r.auditId };
  }

  private async proposal(m: ReadModel, pid: string): Promise<Proposal> {
    const p = m.get('proposals', pid);
    if (!p) throw notFound('Proposal', pid);
    return p;
  }

  async applyProposal({ params }: I<'applyProposal'>): Promise<Res<'applyProposal'>> {
    const chat = await this.be6.apply(params.id, this); // BE-CHAT: a chat plan → one change set, actor chat (+ D-58 route calls)
    if (chat) return chat;
    const r = await this.mutate({ action: 'proposal.apply', summary: 'Applied proposal', entity: { type: 'proposal', id: params.id } }, async (w, model) => {
      const p = await this.proposal(model, params.id);
      if (p.status !== 'pending') throw invalid(`Proposal is ${p.status}`);
      if (p.entity.type === 'policy') throw invalid('Policy proposals come from chat, which is not wired yet (BE-6)');
      await w.tx.update(changeSets).set({ summary: `Applied: ${p.reason}`, entityType: p.entity.type, entityId: p.entity.id }).where(eq(changeSets.id, w.cs.id));
      const rows = await w.tx.select({ id: changeProposals.id }).from(changeProposals).where(and(eq(changeProposals.groupId, params.id), eq(changeProposals.status, 'pending')));
      // 2026-11-13 audit B4: an old proposal never overwrites newer data: the field must still be what it was proposed over
      for (const row of rows) if (!(await proposalStillCurrent(w.tx, row.id))) throw new AppError('conflict', PROPOSAL_CHANGED_SINCE, { current: p, reason: 'changed_since' });
      if (rows.length === 1) await applyProposalRow(w.tx, rows[0]!.id);
      else await applyProposalGroup(w.tx, rows.map((r) => r.id));
      if (p.entity.type === 'draft') {
        const d = model.get('drafts', p.entity.id);
        if (!d) throw notFound('Draft', p.entity.id);
        const doc = (p.changes.find((c) => c.field === 'doc')?.after as Draft['doc'] | undefined) ?? d.doc;
        // the helper wrote doc_json (and bumped the version); the derived columns follow
        await w.tx.update(draftsTable).set({ plainText: plainText(doc), editedByUser: true, docVersion: sql`${draftsTable.docVersion} + 1` }).where(eq(draftsTable.id, d.id));
        const after: Draft = { ...d, doc, plainText: plainText(doc), rendered: renderAll(d.destination, doc), userTouched: true };
        await updateDraft(w, { ...after, rendered: {} }, after, { bump: false });
        const nba = d.nbaId ? model.get('nbas', d.nbaId) : undefined;
        if (nba && nba.update?.proposalId === p.id) {
          await updateNba(w, nba, { ...nba, version: nba.version + 1, update: { ...nba.update, kind: 'revised', reason: `Applied: ${nba.update.reason}` }, versions: [...nba.versions, { version: nba.version + 1, at: w.now.toISOString(), reason: `Applied: ${p.reason}`, diffSummary: null }] }, this.isSession(model));
        }
      } else if (p.entity.type === 'work_item') {
        await w.tx.update(workItems).set({ updatedAt: w.now }).where(eq(workItems.id, p.entity.id));
        // OUTBOX-W: an applied status proposal that closes the item withdraws its pending drafts (no-op otherwise)
        this.putWithdrawn(model, await withdrawDraftsOfClosedItems(w.tx, w.userId, { itemIds: [p.entity.id], at: w.now }), w.now);
      }
    });
    const m = await this.model();
    return { entity: await this.proposal(m, params.id), auditId: r.auditId };
  }

  async rejectProposal({ params }: I<'rejectProposal'>): Promise<Res<'rejectProposal'>> {
    const chat = await this.be6.reject(params.id); // BE-CHAT: Dismiss a chat plan
    if (chat) return chat;
    const r = await this.mutate({ action: 'proposal.reject', summary: 'Kept mine', entity: { type: 'proposal', id: params.id } }, async (w, model) => {
      const p = await this.proposal(model, params.id);
      if (p.status !== 'pending') throw invalid(`Proposal is ${p.status}`);
      await w.tx.update(changeSets).set({ summary: `Kept mine: ${p.reason}`, entityType: p.entity.type, entityId: p.entity.id }).where(eq(changeSets.id, w.cs.id));
      const rows = await w.tx.select({ id: changeProposals.id }).from(changeProposals).where(and(eq(changeProposals.groupId, params.id), eq(changeProposals.status, 'pending')));
      for (const row of rows) await rejectProposalRow(w.tx, row.id);
      for (const nba of model.all('nbas')) if (nba.update?.proposalId === p.id) await updateNba(w, nba, { ...nba, update: null }, this.isSession(model));
    });
    const m = await this.model();
    return { entity: await this.proposal(m, params.id), auditId: r.auditId };
  }

  // =========================================================================
  // Drafts and Outbox
  // =========================================================================

  private draft(m: ReadModel, did: string): Draft {
    const d = m.get('drafts', did);
    if (!d) throw notFound('Draft', did);
    return d;
  }

  async getDraft({ params }: I<'getDraft'>): Promise<Res<'getDraft'>> {
    return this.draft(await this.model(), params.id);
  }

  /** The message a draft replies to: the model's thread context and evidence, told what the thread's source items know. */
  async getDraftSource({ params }: I<'getDraftSource'>): Promise<Res<'getDraftSource'>> {
    const m = await this.model();
    const d = this.draft(m, params.id);
    const wi = d.workItemId ? m.get('workItems', d.workItemId) : undefined;
    const evidence = wi ? m.all('evidence').filter((e) => e.workItemId === wi.id) : [];
    const rows = await loadDraftSourceRows(this.db, m.ctx.userId, d);
    return buildDraftSource({
      draft: d,
      candidates: withSourceRows(baseCandidates(d, evidence, m.ctx.me), rows, m.ctx.me),
      itemSources: wi?.sources ?? [],
      labels: { ...rowLabels(rows), ...slackLabels(m.all('people')) },
    });
  }

  async patchDraft({ params, body }: I<'patchDraft'>): Promise<Res<'patchDraft'>> {
    const r = await this.mutate(
      { action: 'draft.autosave', summary: 'Draft edited', entity: { type: 'draft', id: params.id }, burst: true, current: async () => this.draft(await this.model(), params.id) },
      async (w, model) => {
        const d = this.draft(model, params.id);
        this.checkVersion(d, body.ifVersion, 'Draft', d);
        if (['sending', 'sent', 'verified', 'staged'].includes(d.status)) throw invalid(`Draft is ${d.status}; it can no longer be edited`);
        // A structured action is read-only once drafted: its body is the exact request the user approves.
        if ((d.destination.kind === 'action' || body.destination?.kind === 'action') && (body.doc || body.destination || (body.mode && body.mode !== d.mode))) {
          throw invalid('Action items are read-only: reject this one and draft the change again');
        }
        const doc = body.doc ?? d.doc;
        const destination = body.destination ?? d.destination;
        const locks = new Set(d.userLockedFields);
        const newly: Draft['userLockedFields'] = [];
        if (body.doc) newly.push('doc');
        if (body.destination) newly.push('destination');
        if (body.mode) newly.push('mode');
        for (const l of newly) locks.add(l);
        const scheduledFor = body.scheduledFor === undefined ? d.scheduledFor : body.scheduledFor;
        const next: Draft = {
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
          savedAt: w.now.toISOString(),
        };
        if (body.doc) await this.saveRevision(w, d, doc);
        await updateDraft(w, d, next, { bump: true, ifVersion: body.ifVersion, lock: newly });
      },
    );
    return { entity: this.draft(await this.model(), params.id), auditId: r.auditId };
  }

  /**
   * W5: autosave revisions. Bodies stay out of the audit images (drafts.doc_json is omitted), so each
   * editor burst keeps its latest doc in content_revisions; the first edit also records the baseline.
   * Undo restores the revision before the burst (undoAudit).
   */
  private async saveRevision(w: WriteCtx, d: Draft, doc: Draft['doc']) {
    const existing = await w.tx.select({ id: contentRevisions.id }).from(contentRevisions).where(and(eq(contentRevisions.entityType, 'drafts'), eq(contentRevisions.entityId, d.id), eq(contentRevisions.field, 'doc_json'))).limit(1);
    if (!existing.length) {
      await w.tx.insert(contentRevisions).values({ ownerUserId: w.userId, entityType: 'drafts', entityId: d.id, field: 'doc_json', revision: 1, docJson: d.doc as unknown as Record<string, unknown>, contentHash: JSON.stringify(d.doc).length.toString(36), actorKind: 'engine', editorSessionId: 'baseline', closedAt: w.now });
    }
    await w.tx.execute(sql`
      INSERT INTO content_revisions AS r
         (owner_user_id, entity_type, entity_id, field, revision, doc_json, content_hash, actor_kind, editor_session_id, change_set_id)
      SELECT ${w.userId}, 'drafts', ${d.id}, 'doc_json', coalesce(max(revision), 0) + 1, ${JSON.stringify(doc)}::jsonb, ${JSON.stringify(doc).length.toString(36)}, 'user', ${EDITOR_SESSION}, ${w.cs.id}
        FROM content_revisions
       WHERE entity_type = 'drafts' AND entity_id = ${d.id} AND field = 'doc_json'
      ON CONFLICT (entity_type, entity_id, field, editor_session_id) WHERE closed_at IS NULL
      DO UPDATE SET doc_json = EXCLUDED.doc_json, content_hash = EXCLUDED.content_hash, last_saved_at = now(), save_count = r.save_count + 1, change_set_id = EXCLUDED.change_set_id`);
  }

  /** Bound to version + mode + the exact payload dispatch would make (one serializer: src/lib/compose). */
  private confirmTokenFor(d: Draft, mode: 'draft' | 'send'): string {
    const payload = JSON.stringify(payloadFor(d.destination, d.doc, mode));
    let h = 0;
    for (let i = 0; i < payload.length; i++) h = (Math.imul(31, h) + payload.charCodeAt(i)) | 0;
    return `ct_${d.id}_${d.version}_${mode}_${(h >>> 0).toString(36)}`;
  }

  /** Add to Outbox (BE-CHAT): drafting → ready (pending approval). Idempotent on ready; any other status is a 409. */
  async queueDraft({ params, body }: I<'queueDraft'>): Promise<Res<'queueDraft'>> {
    const cur = this.draft(await this.model(), params.id);
    if (cur.status === 'ready') return { entity: cur, auditId: null };
    const r = await this.mutate({ action: 'draft.queue', summary: 'Added to the Outbox', entity: { type: 'draft', id: params.id }, current: async () => this.draft(await this.model(), params.id) }, async (w, model) => {
      const d = this.draft(model, params.id);
      if (d.status !== 'drafting') throw new AppError('conflict', `Draft is ${d.status}; only a drafting draft can be added to the Outbox`, { current: d });
      this.checkVersion(d, body.ifVersion, 'Draft', d);
      await updateDraft(w, d, { ...d, status: 'ready', savedAt: w.now.toISOString() }, { bump: true, ifVersion: body.ifVersion });
    });
    this.bus.publishTables(['drafts'], [params.id], 'draft.queue');
    return { entity: this.draft(await this.model(), params.id), auditId: r.undoable ? r.auditId : null };
  }

  /** REJECT-1: the user turns a draft down. It leaves the Outbox; nothing is sent; the work item stays open. Undoable. */
  async rejectDraft({ params, body }: I<'rejectDraft'>): Promise<Res<'rejectDraft'>> {
    const cur = this.draft(await this.model(), params.id);
    if (cur.status === 'rejected') return { entity: cur, auditId: null };
    const r = await this.mutate({ action: 'draft.reject', summary: 'Rejected the draft (nothing sent)', entity: { type: 'draft', id: params.id }, current: async () => this.draft(await this.model(), params.id) }, async (w, model) => {
      const d = this.draft(model, params.id);
      if (!REJECTABLE_DRAFT.has(d.status)) throw new AppError('conflict', `Draft is ${d.status}; only a draft that hasn't been sent can be rejected`, { current: d });
      if (body.ifVersion !== undefined) this.checkVersion(d, body.ifVersion, 'Draft', d);
      await updateDraft(w, d, { ...d, status: 'rejected', rejectedReason: body.reason ?? null, savedAt: w.now.toISOString() }, { bump: true, ...(body.ifVersion !== undefined ? { ifVersion: body.ifVersion } : {}) });
    });
    this.bus.publishTables(['drafts'], [params.id], 'draft.reject');
    // D-70: a rejected canvas's writes are rejected (its rows go back to waiting)
    await this.syncLandingsQuietly('draft.reject');
    return { entity: this.draft(await this.model(), params.id), auditId: r.undoable ? r.auditId : null };
  }

  async previewDraft({ params, body }: I<'previewDraft'>): Promise<Res<'previewDraft'>> {
    const m = await this.model();
    const d = this.draft(m, params.id);
    const mode = body.mode ?? defaultModeFor(d, m.settings().sending);
    // One serializer (src/lib/compose, via the mock's render adapter): byte-identical to what dispatch posts.
    return {
      draftId: d.id,
      version: d.version,
      destination: d.destination,
      mode,
      rendition: renditionFor(d.destination, d.doc),
      payload: payloadFor(d.destination, d.doc, mode),
      confirmToken: this.confirmTokenFor(d, mode),
      dryRun: m.settings().sending.dryRun,
      html: previewHtml(d.destination, d.doc, mentionLabels(m)),
    };
  }

  /**
   * Never calls any external system. Dry-run (default): the delivery engine records the exact payload and
   * would-be tool call ("Dry-run delivered") and returns it. Live: the confirm proof is checked, the approval
   * is recorded (approved_content_hash, payload hash) and `outbox.dispatch` is enqueued for the adapters
   * (src/outbox/job.ts), which re-check the approval before anything leaves.
   */
  async dispatchDraft({ params, body }: I<'dispatchDraft'>): Promise<Res<'dispatchDraft'>> {
    const m0 = await this.model();
    const d0 = this.draft(m0, params.id);
    this.checkVersion(d0, body.ifVersion, 'Draft', d0);
    // D-65 (TL-06, TL-24): a logging canvas is re-checked before anything leaves: re-rendered or refused, never stale
    await this.preflightLogCanvas(m0, d0);
    // Global dry run, and Settings ▸ Feedback "Post live" off for a feedback report (D-56).
    const dryRun = m0.settings().sending.dryRun !== false || feedbackHeld(d0.destination, m0.settings().feedback);
    const where = d0.destination.kind === 'slack' ? d0.destination.channelName : d0.destination.kind === 'action' ? d0.destination.target.label : d0.destination.subject;
    const plan = await planDispatch(d0, { mode: body.mode, confirmToken: body.confirmToken, expectedToken: this.confirmTokenFor(d0, body.mode), dryRun, now: this.now() });
    const { payload, rendition } = plan;
    const r = await this.mutate(
      { action: dryRun ? 'draft.dispatch.dry_run' : `draft.dispatch.${body.mode}`, summary: `${dryRun ? 'Dry run' : body.mode === 'send' ? 'Queued to send' : 'Queued as draft'}: ${where}`, entity: { type: 'draft', id: params.id }, undoable: false, current: async () => this.draft(await this.model(), params.id) },
      async (w, model) => {
        const d = this.draft(model, params.id);
        const attempt = dispatchAttempt(plan, w.now.toISOString());
        const next: Draft = {
          ...d,
          mode: body.mode,
          attempts: [...d.attempts, attempt],
          ...(dryRun ? {} : { status: 'sending' as const, verification: { state: 'pending' as const, at: null, detail: 'Waiting for the send adapter' } }),
        };
        const res = await updateDraft(w, d, next, { bump: true, ifVersion: body.ifVersion });
        const attemptId = res.attemptIds[res.attemptIds.length - 1]!;
        await recordDispatch(w, d.id, attemptId, plan);
        if (!dryRun) {
          // B3: one attempt only: a delivery is never re-run by the queue (a second run could send twice)
          const job = await enqueueJob(w.tx, { ownerUserId: w.userId, kind: 'outbox.dispatch', queue: OUTBOX_QUEUE, payload: { draftId: d.id, attemptId, mode: body.mode, version: d.version + 1, payloadHash: plan.rec.payloadHash }, idempotencyKey: `outbox.dispatch:${d.id}:${attemptId}`, maxAttempts: 1 });
          await w.tx.execute(sql`update draft_send_attempts set job_id = ${job.id} where id = ${Number(attemptId)}`);
        }
        return attemptId;
      },
    );
    if (!dryRun) this.bus.publishTables(['jobs'], [params.id], 'draft.dispatch');
    const d = this.draft(await this.model(), params.id);
    const attempt = d.attempts.find((a) => a.id === r.result) ?? d.attempts[d.attempts.length - 1]!;
    return { draft: d, dryRun, payload, rendition, attempt, auditId: r.auditId };
  }

  /**
   * D-65: the Apply preflight of a logging canvas (src/server/time/canvas-preflight.ts). A row that must not go (logged
   * by hand, declined, cancelled, dismissed, edited, no longer approved) is dropped: the item is re-rendered and Apply
   * refused so you review what goes; an item with nothing left is discarded and refused. Nothing is sent either way.
   */
  private async preflightLogCanvas(m: ReadModel, d: Draft): Promise<void> {
    if (!isPendingLogCanvas(d)) return;
    const ctx = await dbPreflightContextFor(this.db, m.ctx.userId, d, { taskTypeRequired: loggingProfile(personaOf(m.settings())).taskTypeRequired, useCases: true });
    const out = preflightDraft(d, ctx);
    if (!out.next) return;
    await this.mutate(
      { action: out.result.empty ? 'time.canvas.empty' : 'time.canvas.preflight', summary: `${out.result.empty ? 'Canvas discarded' : 'Canvas re-rendered'} at Apply: ${preflightSummary(out.result)}`.slice(0, 200), entity: { type: 'draft', id: d.id }, undoable: false },
      async (w, model) => {
        const cur = this.draft(model, d.id);
        await updateDraft(w, cur, { ...out.next!, version: cur.version }, { bump: true });
      },
    );
    this.bus.publishTables(['drafts'], [d.id], 'time.canvas.preflight');
    throw invalid(out.message!, { draftId: d.id, dropped: out.result.dropped, discarded: out.result.empty });
  }

  async getOutbox(_i: I<'getOutbox'>): Promise<Res<'getOutbox'>> {
    return buildOutbox(await this.model());
  }

  // =========================================================================
  // Calendar
  // =========================================================================

  async getCalendar({ query }: I<'getCalendar'>): Promise<Res<'getCalendar'>> {
    const m = await this.model();
    const now = this.now();
    const from = query.from ? new Date(query.from) : startOfDayLocal(now);
    const to = query.to ? new Date(query.to) : endOfDayLocal(now);
    const within = (s: string) => Date.parse(s) >= from.getTime() && Date.parse(s) <= to.getTime();
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      events: m.all('events').filter((e) => within(e.start)).sort((a, b) => a.start.localeCompare(b.start)),
      slots: m.all('slots').filter((s) => within(s.start)).sort((a, b) => a.start.localeCompare(b.start)),
    };
  }

  async getCalendarEvent({ params }: I<'getCalendarEvent'>): Promise<Res<'getCalendarEvent'>> {
    const m = await this.model();
    const ev = m.get('events', params.id);
    if (!ev) throw notFound('Event', params.id);
    const { readIn } = await readin.getReadInDb(this.db, await this.userId(), { type: 'calendar_event', id: ev.id });
    return eventDetail(ev, {
      items: m.all('workItems'),
      account: ev.accountId ? m.get('accounts', ev.accountId) : null,
      opp: ev.oppId ? m.get('opps', ev.oppId) : null,
      readIn,
    });
  }

  // =========================================================================
  // Agents and tools
  // =========================================================================

  async getAgents(_i: I<'getAgents'>): Promise<Res<'getAgents'>> {
    const m = await this.model();
    const order = ['waiting_on_you', 'running', 'failed', 'stale', 'done_review', 'queued', 'done'];
    const runs = m.all('agentRuns').sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || b.updatedAt.localeCompare(a.updatedAt));
    const counts = { queued: 0, running: 0, waiting_on_you: 0, done_review: 0, done: 0, failed: 0, stale: 0 } as Record<AgentRun['state'], number>;
    for (const r of runs) counts[r.state]++;
    return { runs, counts, needsInputLink: 'claude://code/needs-input' };
  }

  /** Records the launch (a `launching` session the Claude-session watcher picks up); opening Claude is the client's job. */
  async launchAgent({ body }: I<'launchAgent'>): Promise<Res<'launchAgent'>> {
    let url = '';
    const runId = crypto.randomUUID();
    await this.mutate({ action: 'agent.launch', summary: 'Started in Claude', entity: { type: 'agent_run', id: runId } }, async (w, model) => {
      const item = body.workItemId ? this.item(model, body.workItemId) : undefined;
      const folder = body.folder ?? model.meta().repoFolder ?? process.cwd();
      let prompt = body.prompt ?? (item ? buildLaunchPrompt(item, model) : 'New session from Control Center');
      if (item && !prompt.includes(`[cc:${item.id}]`)) prompt = `${prompt}\n\n[cc:${item.id}]`;
      if (prompt.length > 14336) prompt = prompt.slice(0, 14336 - (item ? item.id.length + 8 : 0)) + (item ? `\n[cc:${item.id}]` : '');
      url = `claude://code/new?folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(prompt)}`;
      const run: AgentRun = {
        id: runId,
        kind: 'claude_session',
        title: body.title ?? item?.title ?? 'New Claude session',
        workItemId: item?.id ?? null,
        state: 'queued',
        startedAt: w.now.toISOString(),
        updatedAt: w.now.toISOString(),
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
      await w.tx.update(changeSets).set({ summary: `Started in Claude: ${run.title}` }).where(eq(changeSets.id, w.cs.id));
      await insertSession(w, run, { launchedByApp: true, launchPrompt: prompt });
      model.put('agentRuns', run);
      if (item) {
        const next = { ...item, state: item.state === 'open' || item.state === 'reopened' ? ('in_progress' as const) : item.state, runIds: uniq([...item.runIds, run.id]) };
        await this.writeItem(w, model, item, next, { bump: true });
        await logTransition(w, item.id, item.state, next.state, 'Started in Claude');
      }
    });
    const m = await this.model();
    return { url, run: m.get('agentRuns', runId)! };
  }

  async answerAgent({ params, body }: I<'answerAgent'>): Promise<Res<'answerAgent'>> {
    const r = await this.mutate({ action: 'agent.answer', summary: 'Answered', entity: { type: 'agent_run', id: params.id } }, async (w, model) => {
      const run = model.get('agentRuns', params.id);
      if (!run) throw notFound('Agent run', params.id);
      if (run.kind === 'claude_session') throw invalid('Claude sessions are answered in Claude: use Open in Claude');
      if (run.state !== 'waiting_on_you') throw invalid(`Run is ${run.state}, not waiting on you`);
      const next: AgentRun = { ...run, state: 'running', waiting: null, lastEvent: `You answered: ${body.answer}`, updatedAt: w.now.toISOString() };
      await w.tx.update(changeSets).set({ summary: `Answered: ${run.title}` }).where(eq(changeSets.id, w.cs.id));
      await this.writeRun(w, model, run, next);
      const item = run.workItemId ? model.get('workItems', run.workItemId) : undefined;
      if (item?.state === 'waiting_on_me') {
        await this.writeItem(w, model, item, { ...item, state: 'in_progress', waiting: null }, { bump: true });
        await logTransition(w, item.id, item.state, 'in_progress', 'Answered');
      }
      // HYG-1: the answer is recorded on the run itself. No worker handles an `agent.answer` job (it only dead-lettered).
    });
    const m = await this.model();
    return { entity: m.get('agentRuns', params.id)!, auditId: r.auditId };
  }

  /** Persist an agent run in whichever store it lives (session row, app-run ext, tool-run mirror). */
  private async writeRun(w: WriteCtx, model: ReadModel, cur: AgentRun, next: AgentRun) {
    if (cur.kind === 'claude_session') await updateSession(w, cur, next);
    else if (cur.kind === 'app_run') await writeAppRun(w, next);
    else {
      const tr = model.all('toolRuns').find((t) => t.agentRunId === cur.id);
      if (tr) await updateToolRun(w, tr, tr, next);
    }
    model.put('agentRuns', next);
  }

  async cancelAgent({ params }: I<'cancelAgent'>): Promise<Res<'cancelAgent'>> {
    const r = await this.mutate({ action: 'agent.cancel', summary: 'Cancelled', entity: { type: 'agent_run', id: params.id } }, async (w, model) => {
      const run = model.get('agentRuns', params.id);
      if (!run) throw notFound('Agent run', params.id);
      if (run.kind === 'claude_session') throw invalid('Stop Claude sessions in Claude');
      if (!['queued', 'running', 'waiting_on_you', 'stale'].includes(run.state)) throw invalid(`Run is ${run.state}`);
      const next: AgentRun = { ...run, state: 'failed', error: 'Cancelled by you', lastEvent: 'Cancelled', updatedAt: w.now.toISOString(), finishedAt: w.now.toISOString() };
      await w.tx.update(changeSets).set({ summary: `Cancelled: ${run.title}` }).where(eq(changeSets.id, w.cs.id));
      if (run.toolRunId) {
        const tr = model.get('toolRuns', run.toolRunId);
        if (tr) {
          await updateToolRun(w, tr, { ...tr, status: 'cancelled', finishedAt: w.now.toISOString(), error: 'Cancelled by you' }, next);
          await w.tx.update(jobs).set({ cancelRequestedAt: w.now, cancelReason: 'cancelled by user' }).where(and(eq(jobs.ownerUserId, w.userId), sql`${jobs.payload} ->> 'toolRunId' = ${tr.id}`, inArray(jobs.status, ['queued', 'running'])));
        }
      } else await this.writeRun(w, model, run, next);
    });
    const m = await this.model();
    return { entity: m.get('agentRuns', params.id)!, auditId: r.auditId };
  }

  async getTools(_i: I<'getTools'>): Promise<Res<'getTools'>> {
    const m = await this.model();
    return { adapters: m.all('toolAdapters'), recentRuns: m.all('toolRuns').sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? '')).slice(0, 20) };
  }

  /** Records a queued tool run (+ its Agents mirror) and enqueues `tool.run` for the worker's adapter runner. */
  async startToolRun({ params, body }: I<'startToolRun'>): Promise<Res<'startToolRun'>> {
    const m0 = await this.model();
    const adapter = m0.get('toolAdapters', params.id);
    if (!adapter) throw notFound('Tool', params.id);
    if (!adapter.enabled) throw invalid(`${adapter.name} is disabled`);
    if (adapter.health.state === 'down') throw new AppError('upstream_unavailable', `${adapter.name} is not running (health check failed). Start it from Agents ▸ Tools, then run again.`);
    const missing = requiredFieldKeys(adapter).filter((k) => body.inputs[k] === undefined || body.inputs[k] === '');
    if (missing.length) throw invalid(`Missing inputs: ${missing.join(', ')}`, { missing });
    const checked = validateInput({ input: { fields: adapter.fields } }, body.inputs);
    if (!checked.ok) throw invalid(`Invalid inputs: ${checked.errors.join('; ')}`, { errors: checked.errors });
    const runId = crypto.randomUUID();
    const agentRunId = crypto.randomUUID();
    const r = await this.mutate({ action: 'tool.run', summary: `Ran ${adapter.name}`, entity: { type: 'tool_run', id: runId } }, async (w, model) => {
      const steps = 3;
      const tr: ToolRun = { id: runId, adapterId: adapter.id, workItemId: body.workItemId ?? null, nbaId: body.nbaId ?? null, inputs: body.inputs, status: 'queued', progress: { done: 0, total: steps, label: 'Queued' }, linkUrl: null, linkLabel: null, artifacts: [], startedAt: w.now.toISOString(), finishedAt: null, error: null, agentRunId };
      const ar: AgentRun = { id: agentRunId, kind: 'tool_run', title: `${adapter.name}${body.inputs.name ? `: ${String(body.inputs.name)}` : ''}`, workItemId: body.workItemId ?? null, state: 'queued', startedAt: w.now.toISOString(), updatedAt: w.now.toISOString(), finishedAt: null, lastEvent: 'Queued', waiting: null, deepLink: `/agents?run=${agentRunId}`, sessionId: null, cwd: null, bgAgents: 0, toolRunId: runId, progress: tr.progress, resultUrl: null, error: null, costUsd: null, scheduled: false };
      const adapterRow = model.extra.adapterRowId.get(adapter.id)!;
      await insertToolRun(w, tr, adapterRow, adapter.manifest.capabilities[0] ?? 'run', ar);
      await updateToolAdapterRecent(w, adapterRow, [runId, ...adapter.recentRunIds].slice(0, 10));
      model.put('toolRuns', tr);
      model.put('agentRuns', ar);
      const item = body.workItemId ? model.get('workItems', body.workItemId) : undefined;
      if (item) {
        const next = { ...item, state: item.state === 'open' ? ('in_progress' as const) : item.state, runIds: uniq([...item.runIds, agentRunId]) };
        await this.writeItem(w, model, item, next, { bump: true });
        await logTransition(w, item.id, item.state, next.state, `Ran ${adapter.name}`);
      }
      const job = await enqueueJob(w.tx, { ownerUserId: w.userId, kind: 'tool.run', payload: { toolRunId: runId, adapter: adapter.id } });
      await w.tx.execute(sql`update tool_runs set job_id = ${job.id} where id = ${runId}`);
    });
    this.bus.publishTables(['jobs', 'tool_runs'], [runId], 'tool.run');
    const m = await this.model();
    return { entity: m.get('toolRuns', runId)!, auditId: r.auditId };
  }

  async getToolRun({ params }: I<'getToolRun'>): Promise<Res<'getToolRun'>> {
    const m = await this.model();
    const tr = m.get('toolRuns', params.id);
    if (!tr) throw notFound('Tool run', params.id);
    return tr;
  }

  // =========================================================================
  // Time
  // =========================================================================

  async getTime({ query }: I<'getTime'>): Promise<Res<'getTime'>> {
    const m = await this.model();
    return this.withCanvasProgress(m, this.buildTime(m, query.week));
  }

  /**
   * 2026-11-13 audit C4: each created canvas's own progress (Events, DCs and use cases in Org62, when it was checked,
   * the next re-check). Loads the DC requests and the use cases only when a created canvas carries them.
   */
  private async withCanvasProgress(m: ReadModel, t: TimeWeek): Promise<TimeWeek> {
    const created = t.logCanvases.filter((c) => c.state === 'applied' || c.state === 'verified' || c.state === 'unverified');
    if (!created.length) return t;
    const userId = m.ctx.userId;
    const persona = personaOf(m.settings());
    const [dcRequests, uc, reads] = await Promise.all([
      created.some((c) => c.dcs > 0) && featureActive(persona, 'dealContributions') ? loadDcRequests(this.db, userId) : Promise.resolve([]),
      created.some((c) => c.useCases > 0) && featureActive(persona, 'vdp') ? loadUseCaseSync(this.db, userId) : Promise.resolve(null),
      this.org62Reads(userId),
    ]);
    const logCanvases = logCanvasesOf(m.all('drafts'), m.all('activity'), this.now(), { dcRequests, useCases: uc?.items ?? [], checks: canvasChecksOf(m.ctx.kv.get(CANVAS_CHECKS_KV)), reads });
    return { ...t, logCanvases };
  }

  /** The latest successful Org62 read of each kind a canvas needs (scan_runs): Events, DCs, the use-case read-back. */
  private async org62Reads(userId: string): Promise<Org62Reads> {
    const r = await this.db.execute<{ scope: string; at: Date | string | null }>(sql`
      select scope, max(finished_at) as at from scan_runs
       where owner_user_id = ${userId} and status = 'succeeded' and scope in ('org62:events', 'org62:dcs', ${`org62:${ORG62_READBACK_SCOPE}`})
       group by scope`);
    const at = (scope: string) => {
      const v = r.rows.find((x) => x.scope === scope)?.at;
      return v ? new Date(v).toISOString() : null;
    };
    return { events: at('org62:events'), dcs: at('org62:dcs'), useCases: at(`org62:${ORG62_READBACK_SCOPE}`) };
  }

  /**
   * POST /time/canvases/:id/org62-check (2026-11-13 audit C4): a created logging canvas, read back from Org62 sooner
   * than the scan cadence. `copied` (its Slackbot prompt was just copied) queues checks about 5, 15, 30 and 60 min later;
   * `now` (Slackbot's done) one at once. Each check is the Org62 `events` and `dcs` scans (manual, read only, through
   * the same queue Health's Rescan uses), plus the use-case read-back when use cases ride on it; deduped per minute
   * slot, so two canvases told together share their reads. Nothing external is written. Not undoable (a queue entry).
   */
  async checkCanvasOrg62({ params, body }: I<'checkCanvasOrg62'>): Promise<Res<'checkCanvasOrg62'>> {
    const m0 = await this.model();
    const c = this.buildTime(m0).logCanvases.find((x) => x.draftId === params.id);
    if (!c) throw notFound('Logging canvas', params.id);
    if (c.state !== 'applied' && c.state !== 'verified' && c.state !== 'unverified') throw invalid('This canvas is not in Slack yet: Apply it first, then tell Slackbot');
    const org62 = m0.all('connectors').find((x) => x.source === 'org62');
    if (!org62) return { draftId: c.draftId, queued: [], nextCheckAt: null, note: 'No Org62 connector here: nothing to read' };
    if (org62.state === 'auth_needed') return { draftId: c.draftId, queued: [], nextCheckAt: null, note: 'Org62 needs re-auth (Health ▸ Org62) before the app can read it back' };
    const now = this.now();
    const plan = planRecheck(canvasChecksOf(m0.ctx.kv.get(CANVAS_CHECKS_KV)), c.draftId, body.reason, now);
    const queued: Res<'checkCanvasOrg62'>['queued'] = [];
    const persona = personaOf(m0.settings());
    const withUc = c.useCases > 0 && featureActive(persona, 'vdp');
    const withDcs = c.dcs > 0 && featureActive(persona, 'dealContributions');
    await this.mutate({ action: 'time.canvas.check', summary: `Check Org62 for ${c.title}`.slice(0, 200), entity: { type: 'draft', id: c.draftId }, undoable: false }, async (w) => {
      await writeKv(w, CANVAS_CHECKS_KV, plan.next);
      const q = new PgRuntimeJobQueue(this.db, w.userId);
      for (const at of plan.slots) {
        const window = recheckWindow(at, c.appliedAt);
        const reads: Array<'events' | 'dcs'> = c.rows > 0 || !withDcs ? ['events'] : [];
        if (withDcs) reads.push('dcs');
        await q.enqueue(reads.map((scope) => scanJob({ connector: 'org62', scope, window, mode: 'manual', trigger: 'manual', runAt: at, dedupeKey: `org62-recheck:${scope}:${slotOf(at)}` })), w.tx);
        for (const r of reads) queued.push({ read: r, at });
        if (withUc) {
          await enqueueJob(w.tx, { ownerUserId: w.userId, kind: ORG62_READBACK_JOB, queue: ORG62_READBACK_QUEUE, payload: { trigger: 'manual' }, dedupeKey: `org62.readback:${w.userId}:recheck:${slotOf(at)}`, runAt: new Date(at), maxAttempts: 3, timeoutSeconds: 900 });
          queued.push({ read: 'use_cases', at });
        }
      }
    });
    this.bus.publishTables(['jobs', 'user_settings'], [c.draftId], `time.canvas.check.${body.reason}`);
    const nextCheckAt = plan.next[c.draftId]?.at.find((x) => Date.parse(x) > now.getTime() - 60_000) ?? null;
    return { draftId: c.draftId, queued, nextCheckAt, note: null };
  }

  async getActivityLog({ query = {} }: I<'getActivityLog'>): Promise<Res<'getActivityLog'>> {
    const m = await this.model();
    const { timezone, workingHours } = m.settings().profile;
    return buildActivityLog(this.suggested(m, markCanvasHolds(m.all('activity'), canvasHolds(m.all('drafts')))), query, { meta: withPersonaTarget(m.meta(), personaOf(m.settings())), now: this.now(), tz: timezone, dayEnd: workingHours.end });
  }

  /** What a row that needs an opp is suggested (src/lib/time-suggest.ts, the mock's twin): the rules, and the model's stored answers. */
  suggestContext(m: ReadModel): SuggestContext {
    return {
      opps: m.all('opps'),
      accounts: m.all('accounts'),
      events: m.all('events'),
      people: m.all('people'),
      assets: m.all('assets'),
      runs: m.all('agentRuns'),
      workItems: m.all('workItems'),
      activity: m.all('activity'),
      today: localDayOf(this.now().getTime(), m.settings().profile.timezone),
      stored: storedSuggestionsOf(m.ctx.kv.get(SUGGESTIONS_KV)),
      internalActivity: loggingProfile(personaOf(m.settings())).internalActivity,
    };
  }

  private suggested(m: ReadModel, entries: ActivityEntry[]): ActivityEntry[] {
    return entries.some((e) => !e.oppId && !e.internal) ? withSuggestions(entries, this.suggestContext(m)) : entries;
  }

  /**
   * `activity.suggest` (src/jobs/handlers/activity-suggest.ts): the rows the model would be asked about now (no rules
   * answer that settles them, no stored answer for their inputs), each with its ranked candidates, from the same read
   * model GET /time reads, so the key of every answer stored is the one the read side looks up. `live`: the ids of every
   * row that still wants a suggestion (stored answers for other rows are dropped). Only rows of the last
   * SUGGEST_LOOKBACK_DAYS are asked about (Needs you shows the quarter and the last 3 weeks): an old held row never
   * costs a call on its own.
   */
  async activitySuggestPending(): Promise<{ rows: Array<{ entry: ActivityEntry; candidates: OppOption[] }>; live: string[]; stored: Record<string, StoredSuggestion>; internalActivity: boolean }> {
    const m = await this.model();
    const ctx = this.suggestContext(m);
    const entries = markCanvasHolds(m.all('activity'), canvasHolds(m.all('drafts')));
    const live = entries.filter(wantsSuggestion).map((e) => e.id);
    const since = new Date(Date.parse(`${ctx.today}T12:00:00Z`) - SUGGEST_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
    const rows = rowsForModel(
      entries.filter((e) => e.date >= since),
      ctx,
    ).map((entry) => ({ entry, candidates: buildOppOptions({ entry, opps: ctx.opps, accounts: ctx.accounts, events: ctx.events, people: ctx.people, assets: ctx.assets, runs: ctx.runs, workItems: ctx.workItems, activity: ctx.activity, today: ctx.today }).opps }));
    return { rows, live, stored: ctx.stored, internalActivity: ctx.internalActivity };
  }

  async getTimeLedger({ query = {} }: I<'getTimeLedger'>): Promise<Res<'getTimeLedger'>> {
    const m = await this.model();
    const { timezone, workingHours } = m.settings().profile;
    return buildTimeLedger(m.all('activity'), query, { meta: withPersonaTarget(m.meta(), personaOf(m.settings())), now: this.now(), tz: timezone, dayEnd: workingHours.end });
  }

  private buildTime(m: ReadModel, week?: string): TimeWeek {
    const now = this.now();
    // TL-34: the week in the profile timezone (the projections' week), never the server's
    const wb = timeWeekBounds(week, now, m.settings().profile.timezone);
    const inWeek = (iso: string) => inTimeWeek(wb, iso);
    const meta = m.meta();
    const entries = this.suggested(
      m,
      markCanvasHolds(
        m.all('activity').filter((a) => inWeek(a.start)),
        canvasHolds(m.all('drafts')),
      ),
    ).sort((a, b) => a.start.localeCompare(b.start));
    const lanes: TimelineLane[] = [
      {
        id: 'meetings',
        label: 'Meetings',
        blocks: m
          .all('events')
          // meetings I attend; tentative / unanswered invites are Today's (shown, not blocking), not logged time
          .filter((e) => inWeek(e.start) && e.attendance !== 'cancelled' && e.attendance !== 'declined' && e.myResponse !== 'tentative' && e.myResponse !== 'needs_action')
          .sort((a, b) => a.start.localeCompare(b.start))
          // activity sources point at the meeting by its calendar (external) id
          .map((e) => ({ id: e.id, start: e.start, end: e.end, label: e.title, activityId: entries.find((a) => a.sources.some((s) => s.externalId === (e.source.externalId ?? e.id)))?.id ?? null, hatched: false }))
          // travel and onsite frames sit with the meetings (onsite lane): time with the customer, never "focus"
          .concat(
            m
              .all('timeBlocks')
              .filter((b) => b.lane === 'meetings' && inWeek(b.start))
              .map(({ lane: _l, ...b }) => b),
          )
          .sort((a, b) => a.start.localeCompare(b.start)),
      },
    ];
    for (const lane of ['focus', 'claude', 'drive', 'slack'] as const) {
      const labels = { focus: 'Your focus work', claude: 'Agent time (Claude)', drive: 'Drive edits', slack: 'Slack bursts' };
      lanes.push({
        id: lane,
        label: labels[lane],
        blocks: m
          .all('timeBlocks')
          .filter((b) => b.lane === lane && inWeek(b.start))
          .sort((a, b) => a.start.localeCompare(b.start))
          .map(({ lane: _l, ...b }) => ({ ...b, hatched: lane === 'claude' ? true : b.hatched })),
      });
    }
    // the quarter total counts this fiscal quarter's logged rows only (past quarters' rows stay on their weeks)
    const qt = quarterTotal(meta, m.all('activity'), now, m.settings().profile.timezone, m.settings().profile.workingHours.end);
    const readbacks = entries.filter((e) => e.status === 'logged' || e.status === 'verified').map((e) => e.updatedAt).sort();
    return {
      weekStart: wb.start,
      weekEnd: wb.end,
      timeline: lanes,
      entries,
      onsite: onsiteDaysIn(m.ctx.kv, wb.start, wb.end),
      // TL-45: the one status → count map (a legacy Event, one deleted in Org62, a row not in Org62 never count)
      totals: weekTotals(entries),
      quarter: { label: qt.q.label, loggedH: qt.loggedH, targetH: personaTargetH(personaOf(m.settings()), qt.q.targetH), due: qt.q.due },
      canvas: {
        lastSyncedAt: meta.canvas.lastSyncedAt,
        rowsChangedSince: entries.filter((e) => e.status === 'approved' && (!meta.canvas.lastSyncedAt || e.updatedAt > meta.canvas.lastSyncedAt)).length + meta.canvas.rowsChangedSince,
        confirmRequired: !meta.canvas.lastSyncedAt || !isSameDay(new Date(meta.canvas.lastSyncedAt), now),
        label: meta.canvas.label,
      },
      // a row read from Org62 is confirmed by definition: only rows written from here wait for the read-back
      org62: { lastReadbackAt: readbacks[readbacks.length - 1] ?? null, verified: entries.filter((e) => e.status === 'verified').length, pending: entries.filter((e) => ['approved', 'synced_to_canvas', 'logged'].includes(e.status) && !e.fromOrg62).length },
      // D-47 / D-52: the logging canvases waiting for Apply and the applied ones (receipts, the Confirm step)
      logCanvases: logCanvasesOf(m.all('drafts'), m.all('activity'), now),
    };
  }

  // History (B-081): read model + transitions / activity stamps (db/history.ts)
  async getHistoryMonth({ query }: I<'getHistoryMonth'>): Promise<Res<'getHistoryMonth'>> {
    return historyMonth(this.db, await this.model(), query.month, this.now());
  }

  async getHistoryDay({ params }: I<'getHistoryDay'>): Promise<Res<'getHistoryDay'>> {
    return historyDay(this.db, await this.model(), params.day, this.now());
  }

  // Onsite days (onsite lane): a correction is one undoable change set on the stored overrides; the week it touches
  // is recomputed right away (an engine change set), and the projections tick recomputes after an Undo.
  async correctOnsiteDay({ params, body }: I<'correctOnsiteDay'>): Promise<Res<'correctOnsiteDay'>> {
    const day = params.day;
    const verb = { confirm: 'Confirmed onsite', not_onsite: 'Marked not onsite', change_account: 'Changed the onsite account', adjust_hours: 'Adjusted the onsite hours', clear: 'Cleared the onsite correction' }[body.action];
    const r = await this.mutate({ action: `time.onsite.${body.action}`, summary: `${verb}: ${day}`, entity: { type: 'onsite_day', id: day } }, async (w, model) => {
      const cur = onsiteDaysIn(model.ctx.kv, day, day)[0] ?? null;
      const what = body.action === 'change_account' && body.accountId ? await onsiteWhat(w.tx, w.userId, body.accountId, body.oppId) : null;
      if (body.action === 'change_account' && body.accountId && !what) throw notFound('Account', body.accountId);
      let next;
      try {
        next = applyOnsiteCorrection(readOnsiteOverrides(model.ctx.kv), day, body, { current: cur, what: () => what, now: w.now.toISOString() });
      } catch (e) {
        throw invalid(e instanceof Error ? e.message : 'Invalid onsite correction');
      }
      await writeKv(w, ONSITE_OVERRIDES_KEY, next);
    });
    await recomputeWeeks({ db: this.db, userId: await this.userId(), days: [day], now: this.now() });
    this.bus.publishTables(['activity_entries'], [], 'time.onsite');
    const m = await this.model();
    return { entity: onsiteDaysIn(m.ctx.kv, day, day)[0] ?? null, auditId: r.auditId };
  }

  async markTrip({ body }: I<'markTrip'>): Promise<Res<'markTrip'>> {
    if (body.to < body.from) throw invalid('The trip ends before it starts');
    const days = daysBetween(body.from, body.to);
    if (days.length > 30) throw invalid('A trip is at most 30 days');
    const r = await this.mutate({ action: 'time.onsite.trip', summary: `Marked a trip:  to `, entity: { type: 'onsite_day', id: body.from } }, async (w, model) => {
      const what = await onsiteWhat(w.tx, w.userId, body.accountId, body.oppId);
      if (!what) throw notFound('Account', body.accountId);
      void model;
      const next = addTripOverride(readOnsiteOverrides(model.ctx.kv), { from: body.from, to: body.to, accountKey: body.accountId, whatId: what?.whatId ?? null, whatName: what?.whatName ?? null, city: body.city ?? null, timezone: body.timezone ?? null }, w.now.toISOString());
      await writeKv(w, ONSITE_OVERRIDES_KEY, next);
    });
    await recomputeWeeks({ db: this.db, userId: await this.userId(), days, now: this.now() });
    this.bus.publishTables(['activity_entries'], [], 'time.onsite');
    const m = await this.model();
    return { entity: onsiteDaysIn(m.ctx.kv, body.from, body.to), auditId: r.auditId };
  }

  async patchActivity({ params, body }: I<'patchActivity'>): Promise<Res<'patchActivity'>> {
    const r = await this.mutate(
      { action: 'activity.edit', summary: 'Edited log row', entity: { type: 'activity_entry', id: params.id }, burst: true, current: async () => (await this.model()).get('activity', params.id) ?? null },
      async (w, model) => {
        const cur = model.get('activity', params.id);
        if (!cur) throw notFound('Activity entry', params.id);
        this.checkVersion(cur, body.ifVersion, 'Activity entry', cur);
        // every edited field is locked except `status` (the pipeline's: lockableActivityFields); D-64: internal-ness
        // (src/server/time/dismiss.ts patchedEntry, the mock's too)
        const opp = body.patch.oppId ? model.get('opps', body.patch.oppId) : undefined;
        const { next, newLocks: newly } = patchedEntry(cur, body.patch, opp ? { name: opp.name, accountName: model.get('accounts', opp.accountId)?.name ?? null } : null);
        await w.tx.update(changeSets).set({ summary: `Edited log row: ${cur.description}` }).where(eq(changeSets.id, w.cs.id));
        const oppAccount = next.oppId ? (model.get('accounts', model.get('opps', next.oppId)?.accountId ?? '')?.name ?? null) : null;
        await updateActivity(w, model.extra.vocab, cur, next, { bump: true, ifVersion: body.ifVersion, lock: newly }, oppAccount);
        // D-65 (TL-25): an edit unstages a row a canvas item holds (it goes on the next canvas, as you have it now)
        await this.unstageEdited(w, model, params.id);
      },
    );
    const m = await this.model();
    // the row as GET /time reads it (its suggestion, while it still needs an opp)
    return { entity: this.suggested(m, [m.get('activity', params.id)!])[0]!, auditId: r.auditId };
  }

  /** TL-25: the canvas item holding this row, re-rendered without it (discarded when it was the last row). */
  private async unstageEdited(w: WriteCtx, model: ReadModel, rowId: string): Promise<void> {
    const holder = canvasHolds(model.all('drafts')).rows.get(rowId);
    const d = holder ? model.get('drafts', holder) : null;
    if (!d || !isPendingLogCanvas(d)) return;
    const ctx = await dbPreflightContextFor(w.tx, w.userId, d, { taskTypeRequired: loggingProfile(personaOf(model.settings())).taskTypeRequired, unstage: new Set([rowId]) });
    const out = preflightDraft(d, ctx);
    if (out.next) await updateDraft(w, d, out.next, { bump: true });
  }

  // D-65 (TL-14, TL-20): Log again / Leave out on a row that is not in Org62 after all (src/server/time/relog.ts)
  async resolveActivity({ params, body }: I<'resolveActivity'>): Promise<Res<'resolveActivity'>> {
    const r = await this.mutate(
      { action: `activity.org62.${body.action}`, summary: 'Resolved a row not in Org62', entity: { type: 'activity_entry', id: params.id }, current: async () => (await this.model()).get('activity', params.id) ?? null },
      async (w, model) => {
        const cur = model.get('activity', params.id);
        if (!cur) throw notFound('Activity entry', params.id);
        this.checkVersion(cur, body.ifVersion, 'Activity entry', cur);
        const next = resolvedEntry(cur, body.action);
        await w.tx.update(changeSets).set({ summary: resolvedSummary(cur, body.action) }).where(eq(changeSets.id, w.cs.id));
        const oppAccount = next.oppId ? (model.get('accounts', model.get('opps', next.oppId)?.accountId ?? '')?.name ?? null) : null;
        await updateActivity(w, model.extra.vocab, cur, next, { bump: true, ifVersion: body.ifVersion }, oppAccount);
        // Log again: the old Event link, its verify issue and the canvas stamp go (the next batch takes the row)
        if (body.action === 'log_again') await w.tx.update(activityEntries).set({ org62EventRowId: null, verifyIssue: null, syncedToCanvasAt: null, loggedAt: null, verifiedAt: null }).where(and(eq(activityEntries.id, params.id), eq(activityEntries.ownerUserId, w.userId)));
        else await w.tx.update(activityEntries).set({ verifyIssue: null }).where(and(eq(activityEntries.id, params.id), eq(activityEntries.ownerUserId, w.userId)));
      },
    );
    this.bus.publishTables(['activity_entries'], [params.id], `activity.org62.${body.action}`);
    const m = await this.model();
    return { entity: m.get('activity', params.id)!, auditId: r.auditId };
  }

  // The opportunity picker of a Time row: the ranked list (src/lib/opp-options.ts, shared with the mock), the Org62
  // search (one read-only lookup), and a pick that adds an opp the app lacks.
  async getOppOptions({ query = {} }: I<'getOppOptions'>): Promise<Res<'getOppOptions'>> {
    const m = await this.model();
    const entry = query.entryId ? m.get('activity', query.entryId) : null;
    if (query.entryId && !entry) throw notFound('Activity entry', query.entryId);
    return buildOppOptions({
      entry: entry ?? null,
      opps: m.all('opps'),
      accounts: m.all('accounts'),
      events: m.all('events'),
      people: m.all('people'),
      assets: m.all('assets'),
      runs: m.all('agentRuns'),
      workItems: m.all('workItems'),
      activity: m.all('activity'),
      today: localDayOf(this.now().getTime(), m.settings().profile.timezone),
    });
  }

  async searchOrg62Opps({ body }: I<'searchOrg62Opps'>): Promise<Res<'searchOrg62Opps'>> {
    const r = await this.be6.pickerOrg62({ search: body.q });
    return { q: body.q, hits: r.rows.map(org62OppHit), notes: r.notes, simulated: !r.live, costUsd: r.costUsd ?? 0 };
  }

  /**
   * An Org62 hit picked for a row. An opp the app shows is just set. Otherwise the record is re-read from Org62 by
   * id (read-only; never the client's copy) and written the way the Org62 scan's projection writes it (same
   * upserts, same row ids), with its account when the app lacks that too; then the row's opp, WhatId and lock are
   * set. One change set: Undo removes the added opp and account and restores the row.
   */
  async pickOrg62Opp({ params, body }: I<'pickOrg62Opp'>): Promise<Res<'pickOrg62Opp'>> {
    const m0 = await this.model();
    const cur0 = m0.get('activity', params.id);
    if (!cur0) throw notFound('Activity entry', params.id);
    this.checkVersion(cur0, body.ifVersion, 'Activity entry', cur0);
    if (cur0.status === 'logged' || cur0.status === 'verified') throw invalid('This row is logged in Org62: its opportunity is fixed');
    const userId = await this.userId();
    const key = body.org62Id.slice(0, 15);
    const [have] = await this.db
      .select({ id: opportunitiesTable.id })
      .from(opportunitiesTable)
      .where(and(eq(opportunitiesTable.ownerUserId, userId), sql`left(${opportunitiesTable.org62OpportunityId}, 15) = ${key}`));
    const shown = have ? m0.get('opps', have.id) : undefined;
    let rec: Org62Row | null = null;
    if (!shown) {
      const r = await this.be6.pickerOrg62({ byId: body.org62Id });
      if (!r.live) throw new AppError('upstream_unavailable', r.notes[0] ?? 'Org62 is not available here', undefined, false);
      rec = r.rows.find((x) => x.org62Id.slice(0, 15) === key) ?? null;
      if (!rec) throw notFound('Org62 opportunity', body.org62Id);
    }
    const name = shown?.name ?? rec!.name;
    const r = await this.mutate({ action: 'activity.org62_opp', summary: `Set the opportunity: ${name}${rec ? ' (added from Org62)' : ''}`, entity: { type: 'activity_entry', id: params.id }, current: async () => (await this.model()).get('activity', params.id) ?? null }, async (w, model) => {
      const cur = model.get('activity', params.id)!;
      let oppId = shown?.id ?? null;
      let accountName = shown ? (model.get('accounts', shown.accountId)?.name ?? null) : (rec!.account ?? null);
      if (rec) {
        const added = await this.putOrg62Opp(w, rec);
        oppId = added.id;
        accountName = added.accountName ?? accountName;
      }
      const next: ActivityEntry = {
        ...cur,
        oppId,
        oppName: name,
        accountName: accountName ?? cur.accountName,
        userLockedFields: [...new Set([...cur.userLockedFields, 'oppId' as const])],
        issues: cur.issues.filter((i) => !/opp/i.test(i)),
      };
      await updateActivity(w, model.extra.vocab, cur, next, { bump: true, ifVersion: body.ifVersion, lock: ['oppId'] }, accountName);
    });
    const m = await this.model();
    return { entity: m.get('activity', params.id)!, auditId: r.auditId };
  }

  /**
   * Store one Org62 Opportunity the app doesn't track (and its account, when the app lacks it) inside a change set:
   * an account the app has keeps its own record (an upsert would reset its DC status and hours). The read does not
   * say whether I am on its team: the next Org62 scan turns membership on if I am.
   */
  private async putOrg62Opp(w: WriteCtx, rec: Org62Row): Promise<{ id: string; accountName: string | null }> {
    let accountId: string | null = null;
    let accountName: string | null = rec.account ?? null;
    if (rec.accountOrg62Id) {
      const acctKey = rec.accountOrg62Id.slice(0, 15);
      const [a] = await w.tx
        .select({ id: accountsTable.id, name: accountsTable.name })
        .from(accountsTable)
        .where(and(eq(accountsTable.ownerUserId, w.userId), sql`left(${accountsTable.org62AccountId}, 15) = ${acctKey}`));
      accountId = a?.id ?? (await upsertAccountFromOrg62(w, { org62AccountId: rec.accountOrg62Id, name: rec.account ?? rec.accountOrg62Id, ext: { org62Url: org62RecordUrl('Account', rec.accountOrg62Id)!, dcStatus: 'none', hoursQtd: 0 } }, uuidFor(`proj:account:${w.userId}:${rec.accountOrg62Id}`))).id;
      accountName = a?.name ?? accountName;
    }
    const o = await upsertOpportunityFromOrg62(
      w,
      {
        org62OpportunityId: rec.org62Id,
        accountId,
        name: rec.name,
        stage: rec.stage ?? null,
        amount: rec.amount ?? null,
        closeDate: rec.closeDate ?? null,
        forecastCategory: rec.forecast ?? null,
        type: rec.type ?? null,
        isClosed: rec.open === false,
        isWon: rec.won === true,
        onMyTeam: false,
        myTeamRole: null,
        org62ModifiedAt: null,
        ext: { dcAssigned: false, nextStep: null, org62Url: org62RecordUrl('Opportunity', rec.org62Id)!, hoursQtd: 0 },
      },
      uuidFor(`proj:opportunity:${w.userId}:${rec.org62Id}`),
    );
    return { id: o.id, accountName };
  }

  /** Org62 Opportunities by id, one read (live only behind the Assistant's gate and day budget: pickerOrg62). */
  private async org62OppsByIds(ids: readonly string[]): Promise<Org62Row[]> {
    const r = await this.be6.pickerOrg62({ byIds: ids });
    if (!r.live) throw new AppError('upstream_unavailable', r.notes[0] ?? 'Org62 is not available here', undefined, false);
    if (!r.rows.length && r.notes.some((n) => /did not finish|budget/i.test(n))) throw new AppError('upstream_unavailable', r.notes[0]!, undefined, true);
    return r.rows;
  }

  // D-64: "Dismiss all from <source>": the rule in user_settings (cc.time.dismiss-rules) and the rows it sets aside, one
  // audited change set (Undo reverts both); Remove brings the rows back and recomputes their weeks right away.
  async listTimeDismissRules(_i: I<'listTimeDismissRules'>): Promise<Res<'listTimeDismissRules'>> {
    const m = await this.model();
    return { rules: rulesView(readTimeDismissRules(m.ctx.kv), m.all('activity')) };
  }

  async dismissFromSource({ body }: I<'dismissFromSource'>): Promise<Res<'dismissFromSource'>> {
    const m0 = await this.model();
    if (!m0.get('activity', body.entryId)) throw notFound('Activity entry', body.entryId);
    const plan = planDismissFromSource(markCanvasHolds(m0.all('activity'), canvasHolds(m0.all('drafts'))), body.entryId, this.now().toISOString());
    const r = await this.mutate({ action: 'time.dismiss_rule', summary: `Dismissed all from ${plan.rule.label}: ${plan.changes.length} ${plan.changes.length === 1 ? 'row' : 'rows'}`, entity: { type: 'activity_entry', id: body.entryId } }, async (w, model) => {
      await writeKv(w, TIME_DISMISS_RULES_KEY, withRule(readTimeDismissRules(model.ctx.kv), plan.rule));
      for (const c of plan.changes) {
        const cur = model.get('activity', c.id);
        if (cur) await updateActivity(w, model.extra.vocab, cur, { ...c, canvasDraftId: undefined }, { bump: true }, cur.accountName);
      }
    });
    this.bus.publishTables(['activity_entries'], plan.changes.map((c) => c.id), 'time.dismiss_rule');
    const m = await this.model();
    return { entity: { rule: rulesView([plan.rule], m.all('activity'))[0]!, dismissedIds: plan.changes.map((c) => c.id) }, auditId: r.undoable ? r.auditId : null };
  }

  async removeTimeDismissRule({ body }: I<'removeTimeDismissRule'>): Promise<Res<'removeTimeDismissRule'>> {
    const m0 = await this.model();
    const stored = readTimeDismissRules(m0.ctx.kv);
    const rule = stored.find((x) => x.key === body.key);
    if (!rule) return { entity: { rules: rulesView(stored, m0.all('activity')) }, auditId: null };
    const back = planRemoveRule(m0.all('activity'), body.key, this.now().toISOString(), loggingProfile(personaOf(m0.settings())).taskTypeRequired);
    const r = await this.mutate({ action: 'time.dismiss_rule.remove', summary: `Removed the rule: all from ${rule.label} (${back.length} ${back.length === 1 ? 'row' : 'rows'} back)`, entity: { type: 'activity_entry', id: back[0]?.id ?? body.key } }, async (w, model) => {
      await writeKv(w, TIME_DISMISS_RULES_KEY, withRule(readTimeDismissRules(model.ctx.kv), null, body.key));
      for (const b of back) {
        const cur = model.get('activity', b.id);
        if (cur) await updateActivity(w, model.extra.vocab, cur, b, { bump: true }, cur.accountName);
      }
    });
    // the projection's rows come back as the engine proposes them now (their weeks recompute, as an onsite correction
    // does); a row the projection does not own keeps the status restoredStatus gave it
    const owned = back.length
      ? (await this.db.execute<{ day: string }>(sql`select distinct to_char(starts_at at time zone ${m0.settings().profile.timezone || 'UTC'}, 'YYYY-MM-DD') as day from activity_entries
           where owner_user_id = ${await this.userId()} and id::text = any(array[${sql.join(back.map((b) => sql`${b.id}::text`), sql`, `)}])
             and (dedupe_key like 'wb|%' or dedupe_key like 'cal|%' or dedupe_key like 'onsite|%')`)).rows.map((r) => r.day)
      : [];
    if (owned.length) await recomputeWeeks({ db: this.db, userId: await this.userId(), days: owned, now: this.now() });
    this.bus.publishTables(['activity_entries'], back.map((b) => b.id), 'time.dismiss_rule.remove');
    const m = await this.model();
    return { entity: { rules: rulesView(readTimeDismissRules(m.ctx.kv), m.all('activity')) }, auditId: r.undoable ? r.auditId : null };
  }

  async syncCanvas({ body }: I<'syncCanvas'>): Promise<Res<'syncCanvas'>> {
    const m0 = await this.model();
    const week = this.buildTime(m0);
    if (week.canvas.confirmRequired && !body.confirm) throw invalid('First canvas sync today needs confirm: true', { confirmRequired: true });
    // HYG-1: always the preview. The logging canvas is the Outbox's (D-47: Time ▸ Log stages it, the user Applies it);
    // the old live branch marked rows `synced_to_canvas` with no canvas behind them and queued a `canvas.sync` job no
    // worker handles, so those rows waited for a canvas that never existed.
    const dryRun = true;
    const tz = m0.settings().profile.timezone;
    const rows = week.entries.filter((e) => e.status === 'approved' || e.status === 'synced_to_canvas');
    const payload = [
      `# ${week.canvas.label} · week of ${week.weekStart}`,
      '',
      ...rows.map((e) => `- [ ] ${e.date} ${fmtHM(e.start, tz)}–${fmtHM(e.end, tz)} · ${e.durationH}h · ${e.taskType ?? '?'} · ${e.oppName ?? 'no opp'} · ${e.meetingType ?? ''} · ${e.description}`),
    ].join('\n');
    const now = this.now().toISOString();
    const r = await this.mutate({ action: dryRun ? 'activity.sync_canvas.dry_run' : 'activity.sync_canvas', summary: `${dryRun ? 'Dry run: ' : ''}Synced ${rows.length} rows to canvas`, entity: { type: 'activity_entry', id: 'canvas' }, undoable: !dryRun }, async (w, model) => {
      await writeMeta(w, { ...model.meta(), canvas: { ...model.meta().canvas, lastSyncedAt: now, rowsChangedSince: 0 } });
    });
    return { dryRun, syncedAt: now, rowsSynced: rows.length, payload, entries: this.buildTime(await this.model()).entries, auditId: r.auditId };
  }

  // =========================================================================
  // Deals
  // =========================================================================

  async getDeals(_i: I<'getDeals'>): Promise<Res<'getDeals'>> {
    const m = await this.model();
    const accounts = this.accountRows(m);
    accounts.sort((a, b) => b.pipelineAmount - a.pipelineAmount);
    // the summary and pipeline by quarter (src/server/deals/pipeline.ts: the same function the mock calls)
    const s = m.settings();
    const basis = pipelineBasisOf(personaOf(s));
    const forecasts = basis === 'specialist_forecast' ? await loadForecastRecords(this.handle.db, m.ctx.userId) : [];
    const pipeline = buildDealsPipeline({ now: this.now(), timezone: s.profile.timezone || m.meta().timezone, basis, opps: m.all('opps'), accounts: m.all('accounts'), forecasts });
    return { accounts, missedCount: m.all('missedOpps').filter((x) => x.status === 'new').length, pipeline, needs: await this.dealsNeeds(m, accounts) };
  }

  /** The Deals list rows (my open opps per account), as getDeals returns them. */
  private accountRows(m: ReadModel): AccountRow[] {
    const swept = sweptOppIds(m.all('missedOpps'));
    return m.all('accounts').map((a) => {
      const opps = m.all('opps').filter((o) => o.accountId === a.id && o.isOpen && isMyOpp(o, swept));
      return {
        ...a,
        myDcs: accountDcsOf(m.all('opps'), a.id),
        openOpps: opps.length,
        openTasks: m.all('workItems').filter((w) => w.accountId === a.id && isLive(w)).length,
        pipelineAmount: opps.reduce((s, o) => s + (o.amount ?? 0), 0),
        nextCloseDate: opps.map((o) => o.closeDate).filter((d): d is string => !!d).sort()[0] ?? null,
      };
    });
  }

  /** Deals needs (src/engines/deals/needs.ts via src/server/deals/needs.ts: the same call the mock makes). */
  private async dealsNeeds(m: ReadModel, accounts: AccountRow[] = this.accountRows(m)): Promise<DealsNeed[]> {
    const s = m.settings();
    // DC-32: the VDP mirror's links count only while VDP is active for the persona (dealsFeaturesOf gates it too)
    const vdpOppIds = featureActive(personaOf(s), 'vdp') ? await loadVdpOppIds(this.handle.db, m.ctx.userId) : undefined;
    return dealsNeedsFor({ now: this.now(), timezone: s.profile.timezone || m.meta().timezone, persona: personaOf(s), accounts, opps: m.all('opps').map(withMyDcFlag), missed: m.all('missedOpps'), requests: await loadDcRequestStatuses(this.db, m.ctx.userId), decisions: needDecisionsOf(m.ctx.kv), vdpOppIds });
  }

  // ---- Needs you: Snooze / Not needed decisions (src/contract/needs.ts; user_settings `cc.need/…`) -----------
  async listNeedDecisions(_i: I<'listNeedDecisions'>): Promise<Res<'listNeedDecisions'>> {
    const m = await this.model();
    return { decisions: needDecisionsOf(m.ctx.kv) };
  }

  async decideNeed({ body }: I<'decideNeed'>): Promise<Res<'decideNeed'>> {
    const m = await this.model();
    const ds = planNeedDecisions(body, this.now(), m.all('opps'), m.settings().profile.timezone || m.meta().timezone);
    const r = await this.mutate({ action: 'needs.decide', summary: needDecisionLabel(ds), entity: { type: body.rule === 'dc_gap' ? 'opportunity' : 'account', id: body.subjectIds[0]! } }, async (w) => {
      for (const d of ds) await writeNeedDecision(w, d.rule, d.subjectId, d);
    });
    this.bus.publishTables(['need_decisions'], body.subjectIds, 'needs.decide');
    return { entity: { decisions: ds }, auditId: r.undoable ? r.auditId : null };
  }

  async clearNeedDecision({ body }: I<'clearNeedDecision'>): Promise<Res<'clearNeedDecision'>> {
    const m = await this.model();
    const want = new Set(body.subjectIds);
    const gone = needDecisionsOf(m.ctx.kv).filter((d) => d.rule === body.rule && want.has(d.subjectId));
    if (!gone.length) return { entity: { decisions: [] }, auditId: null };
    const r = await this.mutate({ action: 'needs.clear', summary: `Back on the list: ${gone.map((d) => d.label ?? d.subjectId).join(', ')}`.slice(0, 200), entity: { type: body.rule === 'dc_gap' ? 'opportunity' : 'account', id: gone[0]!.subjectId } }, async (w) => {
      for (const d of gone) await writeNeedDecision(w, d.rule, d.subjectId, null);
    });
    this.bus.publishTables(['need_decisions'], body.subjectIds, 'needs.clear');
    return { entity: { decisions: gone.sort(needDecisionOrder) }, auditId: r.undoable ? r.auditId : null };
  }

  async getMissed(_i: I<'getMissed'>): Promise<Res<'getMissed'>> {
    const m = await this.model();
    const missed = m.all('missedOpps').sort((a, b) => (a.verdict === b.verdict ? (b.amount ?? 0) - (a.amount ?? 0) : a.verdict === 'claim' ? -1 : 1));
    return { missed, lastSweepAt: missed.map((x) => x.foundAt).sort().pop() ?? null };
  }

  // ---- Deal Contribution requests (D-58): ADD rows on the next logging canvas -----------------------------
  /** D-67: my VDP use cases and their Org62 Use_Case__c (read only; the rows ride the next logging canvas). */
  async getUseCaseSync(_i: I<'getUseCaseSync'>): Promise<Res<'getUseCaseSync'>> {
    return loadUseCaseSync(this.db, await this.userId());
  }

  async listDcRequests(_i: I<'listDcRequests'>): Promise<Res<'listDcRequests'>> {
    const userId = await this.userId();
    const mine = await loadMyDcs(this.db, userId);
    return { requests: await loadDcRequests(this.db, userId, undefined, mine.byOpp), myDcs: mine.rows };
  }

  /** The opportunity a DC request names (the app's id or its Org62 006… id), when the app tracks it. */
  private async dcOpp(userId: string, opp: string): Promise<{ id: string; name: string } | null> {
    const want = opp.trim();
    const where = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(want)
      ? eq(opportunitiesTable.id, want)
      : ORG62_OPP_ID.test(want)
        ? sql`left(${opportunitiesTable.org62OpportunityId}, 15) = ${want.slice(0, 15)}`
        : sql`false`;
    const [o] = await this.db.select({ id: opportunitiesTable.id, name: opportunitiesTable.name }).from(opportunitiesTable).where(and(eq(opportunitiesTable.ownerUserId, userId), where)).limit(1);
    return o ?? null;
  }

  /**
   * The opp a DC request names: tracked, or (an Org62 id the app doesn't track) the Org62 record to add with the
   * request, read now. Anything else is not_found.
   */
  private async dcOppOrOrg62(userId: string, opp: string): Promise<{ have: { id: string; name: string } | null; rec: Org62Row | null }> {
    const want = opp.trim();
    const have = await this.dcOpp(userId, want);
    if (have) return { have, rec: null };
    if (!ORG62_OPP_ID.test(want)) throw new AppError('not_found', dcOppNotFound(want));
    const rec = (await this.org62OppsByIds([want])).find((x) => x.org62Id.slice(0, 15) === want.slice(0, 15)) ?? null;
    if (!rec) throw new AppError('not_found', dcOppNotInOrg62(want));
    return { have: null, rec };
  }

  /** Untracked opps (and their accounts) from Org62, one read, one change set (D-58: claim DCs on a teammate's deal). */
  async addOrg62Opps({ body }: I<'addOrg62Opps'>): Promise<Res<'addOrg62Opps'>> {
    const userId = await this.userId();
    const ids = [...new Map(body.org62Ids.map((i) => [i.trim().slice(0, 15), i.trim()] as const)).values()];
    const keys = ids.map((i) => i.slice(0, 15));
    const have = await this.db
      .select({ id: opportunitiesTable.id, name: opportunitiesTable.name, org62: opportunitiesTable.org62OpportunityId, accountId: opportunitiesTable.accountId })
      .from(opportunitiesTable)
      .where(and(eq(opportunitiesTable.ownerUserId, userId), sql`left(${opportunitiesTable.org62OpportunityId}, 15) in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`));
    const m = await this.model();
    const tracked: AddedOrg62Opp[] = have.map((h) => ({ oppId: h.id, org62OpportunityId: h.org62 ?? '', name: h.name, accountName: h.accountId ? (m.get('accounts', h.accountId)?.name ?? null) : null }));
    const haveKeys = new Set(have.map((h) => (h.org62 ?? '').slice(0, 15)));
    const want = ids.filter((i) => !haveKeys.has(i.slice(0, 15)));
    if (!want.length) return { entity: { added: [], tracked, missing: [] }, auditId: null };
    const byKey = new Map((await this.org62OppsByIds(want)).map((r) => [r.org62Id.slice(0, 15), r] as const));
    const found = want.flatMap((i) => {
      const r = byKey.get(i.slice(0, 15));
      return r ? [r] : [];
    });
    const missing = want.filter((i) => !byKey.has(i.slice(0, 15)));
    if (!found.length) return { entity: { added: [], tracked, missing }, auditId: null };
    const added: AddedOrg62Opp[] = [];
    const summary = `Added from Org62: ${found.length === 1 ? found[0]!.name : `${found.length} opportunities`}`.slice(0, 200);
    const r = await this.mutate({ action: 'deals.add_org62_opps', summary, entity: { type: 'opportunity', id: uuidFor(`proj:opportunity:${userId}:${found[0]!.org62Id}`) } }, async (w) => {
      added.length = 0;
      for (const rec of found) {
        const a = await this.putOrg62Opp(w, rec);
        added.push({ oppId: a.id, org62OpportunityId: rec.org62Id, name: rec.name, accountName: a.accountName });
      }
    });
    this.bus.publishTables(['opportunities', 'accounts'], added.map((a) => a.oppId), 'deals.add_org62_opps');
    return { entity: { added, tracked, missing }, auditId: r.undoable ? r.auditId : null };
  }

  /**
   * Store one DC request inside a change set, after the shared rules (src/server/deals/dc-requests.ts): my DC with
   * this split → refused; another split → a change of my DC; one request in flight per opp.
   */
  private async dcRequestIn(w: WriteCtx, model: ReadModel, o: { id: string; name: string }, b: { split: number; comment: string; role?: string }, opts: { missedOppFindingId?: string | null } = {}): Promise<DcRequestRecord> {
    const opp = model.get('opps', o.id);
    const plan = planDcRequest({ name: o.name, dcAssigned: opp?.dcAssigned ?? false, myDc: opp?.myDc ?? null }, b.split);
    const live = (await loadDcRequests(w.tx, w.userId)).find((r) => r.oppId === o.id && liveDcRequest(r));
    if (live) throw dcLiveConflict(o.name, live);
    const at = w.now.toISOString();
    const rec: DcRequestRecord = { id: crypto.randomUUID(), oppId: o.id, kind: plan.kind, role: b.role ?? dcRoleFor(personaOf(model.settings()).id), splitPercent: b.split, fromSplit: plan.fromSplit, comment: b.comment, status: 'approved', approvedAt: at, createdAt: at, updatedAt: at, org62DcId: plan.org62DcId };
    await insertDcRequest(w, rec, opts);
    await w.tx.update(changeSets).set({ summary: `${dcRequestWords({ kind: rec.kind, fromSplit: rec.fromSplit, split: rec.splitPercent })}: ${o.name}`.slice(0, 200) }).where(eq(changeSets.id, w.cs.id));
    return rec;
  }

  private async dcRequestOut(id: string): Promise<DcRequest> {
    const entity = (await loadDcRequests(this.db, await this.userId())).find((x) => x.id === id);
    if (!entity) throw new AppError('internal', 'the DC request was not stored');
    return entity;
  }

  async createDcRequest({ body }: I<'createDcRequest'>): Promise<Res<'createDcRequest'>> {
    const m = await this.model();
    if (!featureActive(personaOf(m.settings()), 'dealContributions')) throw invalid(DC_INACTIVE);
    // an Org62 id the app doesn't track (a teammate's deal): read from Org62 and added with the request, one change set
    const { have, rec } = await this.dcOppOrOrg62(m.ctx.userId, body.opp);
    const name = have?.name ?? rec!.name;
    let id = '';
    const r = await this.mutate({ action: 'dc.request', summary: `DC request: ${name} (${body.split}%)${rec ? ', added from Org62' : ''}`.slice(0, 200), entity: { type: 'opportunity', id: have?.id ?? uuidFor(`proj:opportunity:${m.ctx.userId}:${rec!.org62Id}`) } }, async (w, model) => {
      const o = have ?? { id: (await this.putOrg62Opp(w, rec!)).id, name };
      // DC-31: Claim DC on Deals answers the sweep's open finding on the opp too (as Missed ▸ Claim does)
      const finding = model.all('missedOpps').find((x) => x.oppId === o.id && x.status === 'new');
      id = (await this.dcRequestIn(w, model, o, body, { missedOppFindingId: finding ? uuidFor(finding.id) : null })).id;
      if (finding) await updateFinding(w, finding, { ...finding, status: 'claimed' });
    });
    this.bus.publishTables(['deal_contribution_requests'], [id], 'dc.request');
    return { entity: await this.dcRequestOut(id), auditId: r.undoable ? r.auditId : null };
  }

  async patchDcRequest({ params, body }: I<'patchDcRequest'>): Promise<Res<'patchDcRequest'>> {
    const m = await this.model();
    if (!featureActive(personaOf(m.settings()), 'dealContributions')) throw invalid(DC_INACTIVE);
    const cur = (await loadDcRequests(this.db, m.ctx.userId)).find((x) => x.id === params.id);
    if (!cur) throw notFound('DC request', params.id);
    assertDcEditable(cur, 'edit');
    const opp = m.get('opps', cur.oppId);
    const split = body.split ?? cur.splitPercent;
    const plan = planDcRequest({ name: cur.oppName, dcAssigned: opp?.dcAssigned ?? false, myDc: opp?.myDc ?? null }, split);
    const r = await this.mutate({ action: 'dc.request.edit', summary: `Edited the DC request: ${cur.oppName} (${dcRequestWords({ kind: plan.kind, fromSplit: plan.fromSplit, split })})`.slice(0, 200), entity: { type: 'opportunity', id: cur.oppId } }, async (w) => {
      await updateDcRequest(w, cur.id, { kind: plan.kind, fromSplit: plan.fromSplit, org62DcId: plan.org62DcId, splitPercent: split, ...(body.role !== undefined ? { role: body.role } : {}), ...(body.comment !== undefined ? { comment: body.comment } : {}) });
    });
    this.bus.publishTables(['deal_contribution_requests'], [cur.id], 'dc.request.edit');
    return { entity: await this.dcRequestOut(cur.id), auditId: r.undoable ? r.auditId : null };
  }

  async withdrawDcRequest({ params }: I<'withdrawDcRequest'>): Promise<Res<'withdrawDcRequest'>> {
    const m = await this.model();
    if (!featureActive(personaOf(m.settings()), 'dealContributions')) throw invalid(DC_INACTIVE);
    const cur = (await loadDcRequests(this.db, m.ctx.userId)).find((x) => x.id === params.id);
    if (!cur) throw notFound('DC request', params.id);
    assertDcEditable(cur, 'withdraw');
    const r = await this.mutate({ action: 'dc.request.withdraw', summary: `Withdrew the DC request: ${cur.oppName} (${cur.splitPercent}%)`.slice(0, 200), entity: { type: 'opportunity', id: cur.oppId } }, async (w) => {
      await updateDcRequest(w, cur.id, { status: 'dismissed' });
    });
    this.bus.publishTables(['deal_contribution_requests'], [cur.id], 'dc.request.withdraw');
    return { entity: await this.dcRequestOut(cur.id), auditId: r.undoable ? r.auditId : null };
  }

  /** 2026-11-13 audit C7: withdraw every waiting DC request (or the ids asked) in ONE change set: one Undo. */
  async withdrawDcRequests({ body }: I<'withdrawDcRequests'>): Promise<Res<'withdrawDcRequests'>> {
    const m = await this.model();
    if (!featureActive(personaOf(m.settings()), 'dealContributions')) throw invalid(DC_INACTIVE);
    const plan = planWithdrawDcs(await loadDcRequests(this.db, m.ctx.userId), body?.ids);
    if (!plan.withdraw.length) return { entity: { withdrawn: [], skipped: plan.skipped }, auditId: null };
    const n = plan.withdraw.length;
    const r = await this.mutate({ action: 'dc.request.withdraw_all', summary: `Withdrew ${n} DC ${n === 1 ? 'request' : 'requests'} waiting for a canvas`, entity: { type: 'opportunity', id: plan.withdraw[0]!.oppId } }, async (w) => {
      for (const x of plan.withdraw) await updateDcRequest(w, x.id, { status: 'dismissed' });
    });
    this.bus.publishTables(['deal_contribution_requests'], plan.withdraw.map((x) => x.id), 'dc.request.withdraw_all');
    return { entity: { withdrawn: plan.withdraw.map((x) => x.id), skipped: plan.skipped }, auditId: r.undoable ? r.auditId : null };
  }

  /** Who "me" is for the gap check's copy text (the TA line). */
  private async meContact(userId: string): Promise<{ name: string; email: string | null }> {
    const r = await this.db.execute<{ name: string | null; email: string | null }>(sql`select display_name as name, email from users where id = ${userId}`).catch(() => ({ rows: [] as Array<{ name: string | null; email: string | null }> }));
    return { name: r.rows[0]?.name ?? '', email: r.rows[0]?.email ?? null };
  }

  /** The mirror, my book (with the tables' Org62 ids), the asset candidates, the "Find assets" runs and the budget. */
  /**
   * VDP autopilot's coverage inputs (D-60): the stored setting, its ledger (kv `vdp.autopilot`), VDP's sign-in (the
   * connector's Health, for the page; a run passes the live check) and today in the user's zone.
   */
  private async vdpAutopilotInputs(m: ReadModel, auth?: 'ok' | 'stale' | null): Promise<CoverageAutopilot> {
    const sending = sendingOf(m.settings().sending);
    const tz = m.settings().profile.timezone;
    let a = auth;
    if (a === undefined) {
      const r = await this.db.execute<{ status: string }>(sql`select status from connectors where owner_user_id = ${m.ctx.userId} and kind = 'vdp' order by updated_at desc limit 1`);
      const s = r.rows[0]?.status;
      a = !s ? null : s === 'auth_required' || s === 'disabled' ? 'stale' : 'ok';
    }
    return {
      settings: { on: sending.channels.vdp.autopilot, dryRun: sending.dryRun, cap: sending.channels.vdp.dailyCap },
      ledger: ledgerOf(m.ctx.kv.get(VDP_AUTOPILOT_KV)),
      auth: a,
      today: localDayOf(this.now().getTime(), tz),
      dayOf: (iso) => localDayOf(Date.parse(iso), tz),
    };
  }

  private async vdpState(model?: ReadModel, ap?: CoverageAutopilot) {
    const m = model ?? (await this.model());
    const userId = m.ctx.userId;
    const records = await loadVdpRecords(this.db, userId);
    // Org62 ids from the tables, the same ones the mirror sink linked with.
    const t = await loadGapEntities(this.db, userId);
    const entities = gapEntities(m.all('accounts'), m.all('opps'), { accounts: new Map(t.accounts.map((a) => [a.id, a.org62AccountId])), opps: new Map(t.opps.map((o) => [o.id, o.org62OpportunityId])) });
    const candidates = await loadCandidates(this.db, userId);
    const runs = await backfillRuns(this.db, userId);
    const budget = await assistantDayLeft(this.db, userId, m.settings(), localDayOf(this.now().getTime(), m.settings().profile.timezone));
    const running = [...runs.values()].filter((r) => r.status === 'queued' || r.status === 'running').length;
    const server = await loadVdpServer(this.db, userId);
    const drafts = m.all('drafts');
    const autopilot = ap ?? (await this.vdpAutopilotInputs(m));
    const me = await this.meContact(userId);
    // D-63: who the AE is (the Specialist Forecast cache), seed VDPs I am on (my emails), and the latest push
    const aesByOpp = aesByLocalOpp(aeCacheOf(m.ctx.kv.get(VDP_AES_KV)), entities.opps);
    const myEmails = [me.email, ...(process.env.CC_ME_ALIASES ?? '').split(',').map((s) => s.trim())].filter((e): e is string => !!e && e.includes('@'));
    // 2026-11-16: every recent push, settled against its worker job (a push whose job ended reads as stopped)
    const pushes = (await this.settledPushRuns(pushRunsOf(m.ctx.kv.get(VDP_PUSH_KV)))).map(publicPushRun);
    const push = pushes[0] ?? null;
    // D-69: the Org62 hierarchy, the judgment cache and your mappings (Change…), all kv
    const rawHierarchy = m.ctx.kv.get(ACCOUNT_HIERARCHY_KV);
    const identity = { hierarchy: rawHierarchy ? hierarchyOf(rawHierarchy) : null, judgments: judgmentsOf(m.ctx.kv.get(VDP_IDENTITY_JUDGE_KV)), overrides: overridesOf(m.ctx.kv.get(VDP_IDENTITY_KV)), deletedOrg62OppIds: await deletedOrg62OppIds(this.db, userId) };
    // D-67: the use-case round trip with Org62: its VDP-side items, and the duplicate check before a new use case
    const uc = await loadUseCaseInput(this.db, userId);
    const useCaseGaps = planUseCases(uc).vdpGaps;
    const duplicateOf = ucDuplicateGuard({ vdps: [...uc.vdps, ...(uc.goneVdps ?? [])], records: uc.org62.records, opps: uc.opps, drafts });
    const { coverage, queue, identityPending } = vdpCoverageAndQueue({ records, accounts: m.all('accounts'), opps: m.all('opps'), entities, me, myEmails, now: this.now().toISOString(), assets: { candidates, perRunUsd: budget.perRunUsd, runUsd: expectedRunUsd(runs, budget.perRunUsd), dayLeftUsd: budget.dayLeftUsd, running }, drafts, server, autopilot, aesByOpp, push, pushes, useCaseGaps, ...identity });
    const snapshots = records.filter((r) => r.snapshot && !r.goneAt).map((r) => r.snapshot!);
    return { m, userId, coverage, queue, snapshots, candidates, runs, budget, server, drafts, duplicateOf, identityPending };
  }

  /** D-69: the ambiguous company identities waiting for a judgment, from the very inputs the VDP view uses (the
   *  `vdp.identity` job judges exactly these, so a judgment it stores is always one the view applies). */
  async vdpIdentityPending() {
    return (await this.vdpState()).identityPending;
  }

  /** VDP coverage from the read-only mirror (vdp_records, written by scan.vdp). Never calls VDP. */
  async getVdpCoverage(_i: I<'getVdpCoverage'>): Promise<Res<'getVdpCoverage'>> {
    return (await this.vdpState()).coverage;
  }

  /** One VDP (slug) or one engaged account with no VDP (`account:<id>`): steps, assets to add, what VDP has. */
  async getVdpDetail({ query }: I<'getVdpDetail'>): Promise<Res<'getVdpDetail'>> {
    const st = await this.vdpState();
    return vdpDetailFrom({
      key: query.key,
      coverage: st.coverage,
      snapshots: st.snapshots,
      accounts: st.m.all('accounts'),
      opps: st.m.all('opps'),
      candidates: st.candidates,
      backfill: { last: st.runs.get(query.key) ?? null, perRunUsd: st.budget.perRunUsd, dayLeftUsd: st.budget.dayLeftUsd, available: true, note: null },
      server: st.server,
      assetDrafts: vdpDraftRefs(st.drafts),
    });
  }

  /** The asset candidate an `asset:<id>` item adds, with its Apply (the VDP details view of it). */
  private assetCandidatesFor(st: Awaited<ReturnType<DbDataSource['vdpState']>>, key: string) {
    const c = st.candidates.find((x) => `asset:${x.id}` === key);
    if (!c) return [];
    const slug = effectiveSlug(c, slugByAccount(st.coverage.vdps));
    if (!slug) return [];
    const d = vdpDetailFrom({ key: slug, coverage: st.coverage, snapshots: st.snapshots, accounts: st.m.all('accounts'), opps: st.m.all('opps'), candidates: st.candidates, backfill: { last: null, perRunUsd: 0, dayLeftUsd: 0, available: false, note: null }, server: st.server, assetDrafts: vdpDraftRefs(st.drafts) });
    return d.candidates.filter((x) => x.id === c.id).map((x) => ({ id: x.id, vdpSlug: x.vdpSlug, title: x.title, apply: x.apply, draftId: x.draftId }));
  }

  /** Confirm / mark added / dismiss an asset candidate. Local state: VDP is never written (adding is a handoff). */
  async setVdpCandidate({ params, body }: I<'setVdpCandidate'>): Promise<Res<'setVdpCandidate'>> {
    const st = await this.vdpState();
    const cur = st.candidates.find((c) => c.id === params.id);
    if (!cur) throw notFound('Asset candidate', params.id);
    checkTransition(cur.status, body.status);
    const verb = body.status === 'added' ? 'Marked added' : body.status === 'dismissed' ? 'Dismissed' : cur.status === 'unsure' ? 'Confirmed' : 'Put back';
    const r = await this.mutate({ action: `vdp.candidate.${body.status}`, summary: `${verb}: ${cur.title} (VDP asset)`.slice(0, 200), entity: { type: 'vdp', id: candidateKey(cur, slugByAccount(st.coverage.vdps)) ?? cur.targetKey }, undoable: false }, async (w) => setCandidateStatus(w.tx, st.userId, params.id, body.status, this.now()));
    this.bus.publishTables(['vdp_asset_candidates'], [params.id], `vdp.candidate.${body.status}`);
    const view = vdpDetailCandidate(st, r.result.after);
    return { entity: view, auditId: r.auditId };
  }

  /** "Find assets": queue read-only research runs (the worker's `vdp.assets.find`), within the per-run and total caps. */
  async findVdpAssets({ body }: I<'findVdpAssets'>): Promise<Res<'findVdpAssets'>> {
    let st = await this.vdpState();
    let auditId: string | null = null;
    if (body.allowUsd && !body.estimateOnly) {
      // the user's "Allow $N more today": today's assistant line (and the hard cap when it would bind) goes up first
      const tz = st.m.settings().profile.timezone;
      const day = localDayOf(this.now().getTime(), tz);
      const allowIn = (s: Settings) => {
        try {
          return allowAssistantToday(s.budgets, { day, atIso: this.now().toISOString(), addUsd: body.allowUsd!, lineUsd: st.budget.lineUsd, assistantLeftUsd: st.budget.dayLeftUsd, hardLeftUsd: st.budget.hardLeftUsd, reason: 'Find assets for all' });
        } catch (e) {
          throw invalid(e instanceof Error ? e.message : String(e));
        }
      };
      const first = allowIn(st.m.settings()).raise;
      const r = await this.mutate({ action: 'settings.budgets', summary: raiseSummary(first), entity: { type: 'settings', id: 'budgets' }, current: async () => (await this.model()).settings() }, async (w, model) => {
        const { next: budgets, raise } = allowIn(model.settings());
        await writeSection(w, 'budgets', budgets);
        const sp = model.spend();
        const pct = raise.toSoftUsd > 0 ? Math.round((sp.today.usd / raise.toSoftUsd) * 100) : 0;
        await writeSpend(w, { ...sp, today: { ...sp.today, softBudgetUsd: raise.toSoftUsd, hardCapUsd: raise.toHardUsd, pct }, state: sp.today.usd >= raise.toHardUsd ? 'capped' : pct >= budgets.alertPct ? 'soft_alert' : 'ok' });
      });
      auditId = r.auditId;
      st = await this.vdpState();
    }
    const plan = planFindAssets({ body, coverage: st.coverage, snapshots: st.snapshots, accounts: st.m.all('accounts'), runs: st.runs, perRunUsd: st.budget.perRunUsd, dayLeftUsd: st.budget.dayLeftUsd });
    if (body.estimateOnly || !plan.queued.length) return { entity: { ...plan, started: false }, auditId };
    const batch = plan.queued.length > 1 ? crypto.randomUUID() : null;
    for (const q of plan.queued) await enqueueBackfill(this.db, st.userId, { key: q.key, capUsd: plan.perRunUsd, batch });
    this.bus.publishTables(['vdp_asset_candidates'], plan.queued.map((q) => q.key), 'vdp.assets.queued');
    return { entity: { ...plan, started: true }, auditId: null };
  }

  /**
   * Time ▸ "Log these" (and chat_log_batch stage): approved rows, plus complete proposed ones when asked, become
   * Slackbot work orders, one Outbox canvas item each (ready; sent only on its own Apply). The proposed rows the batch
   * takes are approved in the same change set, so Undo puts them back and removes the items. Rows an earlier batch's
   * item still holds are left out (`waiting`), so clicking twice never stages a row twice.
   */
  async stageLogBatch({ body }: I<'stageLogBatch'>): Promise<Res<'stageLogBatch'>> {
    const m = await this.model();
    const tz = m.settings().profile.timezone;
    const logging = m.settings().time.logging;
    // D-55: the persona's record type (SE: Solutions Event; AE: Sales Events), cached per record type
    const profile = loggingProfile(personaOf(m.settings()));
    const rtKv = recordTypeKv(profile.recordType);
    const recordTypeId = await resolveRecordTypeId({
      setting: logging.org62RecordTypeId,
      cached: (m.ctx.kv.get(rtKv) as string | undefined) ?? null,
      live: liveOrg62(),
      recordType: profile.recordType,
      save: async (id) => void (await this.mutate({ action: 'logging.record_type', summary: `Found the ${profile.recordTypeName} record type in Org62`, entity: { type: 'settings', id: 'logging' }, undoable: false }, async (w) => writeKv(w, rtKv, id))),
    });
    if (!recordTypeId) throw invalid(`The ${profile.recordTypeName} record type is not known yet: it is looked up in Org62 on the first batch (live), or set it in Settings ▸ Time ▸ Logging`);
    const now = this.now();
    // D-70: what you ticked (rows, use cases, Event updates); nothing ticked: everything ready
    const sel = batchSelectionOf(body);
    const b = await buildLogBatch(this.db, m.ctx.userId, { now, timezone: tz, approveComplete: body.includeProposed ?? logging.approveComplete, recordTypeId, held: canvasHolds(m.all('drafts')), logging: profile, ...(body.from ? { from: body.from } : {}), ...(body.to ? { to: body.to } : {}), ...(body.dcOnly ? { dcOnly: true } : {}), ...(sel.rows ? { ids: sel.rows } : {}), useCases: sel.useCases, eventUpdates: sel.updates });
    if (!b.canvases.length) return { entity: { draftIds: [], canvases: [], events: 0, hours: 0, approved: 0, skipped: b.skipped, waiting: b.waiting, useCases: b.useCases, eventUpdates: 0 }, auditId: null };
    if (!b.owner) throw invalid('Your Org62 user id is not set, so Slackbot would not know whose Events to create (onboarding ▸ Sources)');
    const at = now.toISOString();
    const items = b.canvases.map((c) => {
      const dest = canvasActionFor({ title: c.title, markdown: c.markdown, eventIds: c.eventIds, hours: c.hours, updates: c.updates, updateIds: c.updateIds, part: c.part, parts: c.parts });
      return { c, draft: actionDraftFor(dest, { id: crypto.randomUUID(), now: at, rendered: (doc) => renderAll(dest, doc) }) };
    });
    const approve = new Set(b.approveIds);
    const r = await this.mutate({ action: 'time.log_batch', summary: `Logging batch for approval: ${b.events} rows · ${b.hours} h${b.useCases.rows ? ` · ${b.useCases.rows} use case${b.useCases.rows === 1 ? '' : 's'}` : ''} in ${items.length} canvas${items.length === 1 ? '' : 'es'}`, entity: { type: 'draft', id: items[0]!.draft.id } }, async (w, model) => {
      for (const id of approve) {
        const cur = model.get('activity', id);
        if (cur && cur.status === 'proposed') await updateActivity(w, model.extra.vocab, cur, { ...cur, status: 'approved' }, { bump: true }, cur.accountName);
      }
      for (const { draft } of items) await insertDraft(w, draft);
      // D-70: the batch stages one write per canvas row (record_landings / landing_writes), in the same transaction
      await this.landingSyncIn(w, model, items.map((x) => x.draft));
    });
    this.bus.publishTables(['drafts', 'activity_entries', 'landing_writes'], items.map((x) => x.draft.id), 'time.log_batch');
    return {
      entity: {
        draftIds: items.map((x) => x.draft.id),
        canvases: items.map(({ c, draft }) => ({ draftId: draft.id, title: c.title, rows: c.eventIds.length, hours: c.hours, updates: c.updates })),
        events: b.events,
        hours: b.hours,
        approved: approve.size,
        skipped: b.skipped,
        waiting: b.waiting,
        useCases: b.useCases,
        eventUpdates: b.eventUpdates,
      },
      auditId: r.auditId,
    };
  }

  // ---- D-70 landings (docs/design/landings.md): where every record lands, and every write that put it there ----------

  /** One landing sync (the read model → the world → the pure pass → stored) and what the views read. */
  private async landings(o: { model?: ReadModel } = {}) {
    const m = o.model ?? (await this.model());
    const world = await loadLandingWorld(this.db, m.ctx.userId, m, this.now());
    const { store, useCaseByKey } = await syncLandingsDb(this.db, m.ctx.userId, world);
    const draftTitle = (id: string) => {
      const d = m.get('drafts', id);
      return d?.destination.kind === 'action' ? d.destination.target.label : null;
    };
    return { m, world, store, useCaseByKey, labelOf: labelsFor(world, store), draftTitle };
  }

  /** Inside a mutation (a batch staged): the sync runs in its transaction, on a savepoint, so it never fails the batch. */
  private async landingSyncIn(w: WriteCtx, model: ReadModel, drafts: Draft[]): Promise<void> {
    try {
      await w.tx.transaction(async (sp) => {
        const world = await loadLandingWorld(sp, w.userId, model, w.now, { drafts });
        await syncLandingsDb(sp, w.userId, world);
      });
    } catch {
      // the next sync (any landing read) stages them: every sync is the whole pass
    }
  }

  /** After a write elsewhere (a row taken off a canvas, a reject, a VDP push): the landings follow; never fails it. */
  async syncLandingsQuietly(reason: string): Promise<void> {
    try {
      await this.landings();
      this.bus.publishTables(['record_landings', 'landing_writes'], [], `landings.${reason}`);
    } catch {
      // the next sync catches up
    }
  }

  async getCanvasWrites({ params }: I<'getCanvasWrites'>): Promise<Res<'getCanvasWrites'>> {
    const L = await this.landings();
    const d = L.m.get('drafts', params.id) ?? null;
    if (!d && !L.store.writes.some((w) => w.draftId === params.id)) throw notFound('Logging canvas', params.id);
    return canvasWritesView(L.store, params.id, d, L.labelOf, L.draftTitle);
  }

  async getRecordLandings({ query }: I<'getRecordLandings'>): Promise<Res<'getRecordLandings'>> {
    const L = await this.landings();
    return recordLandingsView(L.store, query.kind, query.id, L.labelOf, L.draftTitle);
  }

  async getEventUpdates(_i: I<'getEventUpdates'>): Promise<Res<'getEventUpdates'>> {
    const L = await this.landings();
    return { updates: eventUpdatesView(L.store, (id) => L.m.get('activity', id)) };
  }

  async proposeEventUpdates({ body }: I<'proposeEventUpdates'>): Promise<Res<'proposeEventUpdates'>> {
    const L = await this.landings();
    const r = proposeEventUpdates(L.store, body.candidates, { now: this.now().toISOString(), newId: () => crypto.randomUUID(), activity: (id) => L.m.get('activity', id) });
    await writeLandingChanges(this.db, L.m.ctx.userId, r.changes);
    this.bus.publishTables(['landing_writes'], r.proposed, 'landings.propose');
    return { proposed: r.proposed, skipped: r.skipped };
  }

  async patchEventUpdate({ params, body }: I<'patchEventUpdate'>): Promise<Res<'patchEventUpdate'>> {
    const L = await this.landings();
    const r = patchEventUpdate(L.store, params.id, body.action, this.now().toISOString());
    if ('error' in r) throw r.error === 'not_found' ? notFound('Event update', params.id) : new AppError('conflict', r.why);
    await writeLandingChanges(this.db, L.m.ctx.userId, r.changes);
    this.bus.publishTables(['landing_writes'], [params.id], `landings.${body.action}`);
    const row = eventUpdatesView(applyChanges(L.store, r.changes), (id) => L.m.get('activity', id)).find((x) => x.writeId === params.id)!;
    return { entity: row, auditId: null };
  }

  private useCaseView(L: Awaited<ReturnType<DbDataSource['landings']>>) {
    return ucLandingsView({ store: L.store, world: L.world, useCaseByKey: L.useCaseByKey, accountName: (id) => L.m.get('accounts', id)?.name ?? null, labelOf: L.labelOf, draftTitle: L.draftTitle, readAt: L.world.useCases?.input.org62.readAt ?? null });
  }

  async getUseCaseLandings(_i: I<'getUseCaseLandings'>): Promise<Res<'getUseCaseLandings'>> {
    return this.useCaseView(await this.landings());
  }

  async pickUseCaseValue({ params, body }: I<'pickUseCaseValue'>): Promise<Res<'pickUseCaseValue'>> {
    const L = await this.landings();
    const view = this.useCaseView(L).items.find((x) => x.key === params.key);
    if (!view) throw notFound('Use case', params.key);
    const edit = pickEdit(view, L.world.useCases?.plan.items.find((x) => x.key === params.key), body);
    const label = body.take ? `${body.take === 'org62' ? 'Org62' : 'VDP'}’s ${body.field} is right for ${view.title}` : `Cleared your pick of ${view.title}’s ${body.field}`;
    const r = await this.mutate({ action: 'use_case.pick', summary: label.slice(0, 200), entity: { type: 'settings', id: 'use_cases' } }, async (w) => {
      await writeKv(w, ROW_OVERRIDES_KV, withRowOverride(await loadRowOverrides(w.tx, w.userId), edit.key, edit.fields, w.now.toISOString()));
    });
    this.bus.publishTables(['drafts', 'use_cases'], [params.key], 'use_case.pick');
    const after = this.useCaseView(await this.landings()).items.find((x) => x.key === params.key) ?? view;
    return { entity: after, auditId: r.undoable ? r.auditId : null };
  }

  async fixUseCase({ params, body }: I<'fixUseCase'>): Promise<Res<'fixUseCase'>> {
    const L = await this.landings();
    const view = this.useCaseView(L).items.find((x) => x.key === params.key);
    if (!view) throw notFound('Use case', params.key);
    const opps = (L.world.useCases?.input.opps ?? []).map((o) => ({ org62Id: o.org62Id, open: o.isOpen, mine100: o.dcSplit === 100 }));
    const { edit, leave } = fixEdits(L.world.useCases?.plan.items.find((x) => x.key === params.key), body, opps);
    const tz = L.m.settings().profile.timezone || L.m.meta().timezone;
    const r = await this.mutate({ action: 'use_case.fix', summary: (leave === true ? `Left ${view.title} out of Org62` : leave === false ? `${view.title} goes to Org62 again` : `Answered ${view.title}`).slice(0, 200), entity: { type: 'settings', id: 'use_cases' } }, async (w) => {
      if (edit) await writeKv(w, ROW_OVERRIDES_KV, withRowOverride(await loadRowOverrides(w.tx, w.userId), edit.key, edit.fields, w.now.toISOString()));
      if (leave === true) for (const d of planNeedDecisions({ rule: UC_LEAVE, subjectIds: [params.key], kind: 'not_needed', reason: 'Not for Org62', label: view.title }, w.now, L.m.all('opps'), tz)) await writeNeedDecision(w, d.rule, d.subjectId, d);
      if (leave === false) await writeNeedDecision(w, UC_LEAVE, params.key, null);
    });
    this.bus.publishTables(['drafts', 'use_cases', 'need_decisions'], [params.key], 'use_case.fix');
    const after = this.useCaseView(await this.landings()).items.find((x) => x.key === params.key) ?? view;
    return { entity: after, auditId: r.undoable ? r.auditId : null };
  }

  // ---- 2026-11-13 audit B2: the canvas review before Apply (src/server/time/canvas-review.ts) -----------------------

  private async canvasReview(draftId: string): Promise<Res<'getCanvasReview'>> {
    const m = await this.model();
    const d = this.draft(m, draftId);
    const opp15 = new Map(m.all('opps').flatMap((o) => { const id = org62OppIdOf(o); return id ? [[id.slice(0, 15), o.name] as const] : []; }));
    return canvasReviewOf(d, { entry: (id) => m.get('activity', id), dcRequests: await loadDcRequests(this.db, m.ctx.userId), oppName: (id) => opp15.get(id.slice(0, 15)) ?? null, now: this.now() });
  }

  async getCanvasReview({ params }: I<'getCanvasReview'>): Promise<Res<'getCanvasReview'>> {
    return this.canvasReview(params.id);
  }

  /** Rows off the canvas before Apply: they go back to waiting (nothing holds them any more). One undoable change. */
  async removeCanvasRows({ params, body }: I<'removeCanvasRows'>): Promise<Res<'removeCanvasRows'>> {
    const r = await this.mutate({ action: 'canvas.rows.remove', summary: 'Took rows off a logging canvas', entity: { type: 'draft', id: params.id } }, async (w, model) => {
      const d = this.draft(model, params.id);
      assertReviewable(d, body.ifVersion);
      const { input, removed } = withoutRows(canvasInputOfDest(d.destination as ActionDestination), body.keys);
      await w.tx.update(changeSets).set({ summary: `Took ${removed.length} row${removed.length === 1 ? '' : 's'} off ${d.destination.kind === 'action' ? d.destination.target.label : 'a canvas'}: back to waiting`.slice(0, 200) }).where(eq(changeSets.id, w.cs.id));
      await updateDraft(w, d, restagedCanvas(d, input), { bump: true, ifVersion: body.ifVersion });
    });
    this.bus.publishTables(['drafts', 'activity_entries', 'deal_contribution_requests'], [params.id], 'canvas.rows.remove');
    // D-70: the rows taken off keep their writes, as removed
    await this.syncLandingsQuietly('canvas.rows.remove');
    return { entity: await this.canvasReview(params.id), auditId: r.auditId };
  }

  /** One row edited before Apply: kept on its record, then its line written again. One undoable change. */
  async editCanvasRow({ params, body }: I<'editCanvasRow'>): Promise<Res<'editCanvasRow'>> {
    const m0 = await this.model();
    const profile = loggingProfile(personaOf(m0.settings()));
    const r = await this.mutate({ action: 'canvas.rows.edit', summary: 'Edited a logging canvas row', entity: { type: 'draft', id: params.id } }, async (w, model) => {
      const d = this.draft(model, params.id);
      assertReviewable(d, body.ifVersion);
      const input = canvasInputOfDest(d.destination as ActionDestination);
      const row = reviewRowOf(input, body.key);
      const first = row.rows[0]!;
      let lines: string[];
      let what = 'a row';
      if (row.kind === 'event' && body.event) {
        const id = first.ref;
        const cur = id ? model.get('activity', id) : undefined;
        if (!cur) throw notFound('Activity entry', id ?? body.key);
        this.checkVersion(cur, body.event.entryVersion, 'Activity entry', cur);
        if (body.event.taskType !== undefined && profile.taskTypeRequired && !profile.taskTypes.includes(body.event.taskType)) throw invalid(`Not one of your task types: ${body.event.taskType}`);
        const patch = { ...(body.event.taskType !== undefined ? { taskType: body.event.taskType } : {}), ...(body.event.durationH !== undefined ? { durationH: body.event.durationH } : {}), ...(body.event.oppId !== undefined ? { oppId: body.event.oppId } : {}), ...(body.event.note !== undefined ? { logNote: body.event.note } : {}) };
        const opp = patch.oppId ? model.get('opps', patch.oppId) : undefined;
        if (patch.oppId && !opp) throw notFound('Opportunity', patch.oppId);
        const { next, newLocks } = patchedEntry(cur, patch, opp ? { name: opp.name, accountName: model.get('accounts', opp.accountId)?.name ?? null } : null);
        const oppAccount = next.oppId ? (model.get('accounts', model.get('opps', next.oppId)?.accountId ?? '')?.name ?? null) : null;
        // the row stays on this canvas as edited (not unstaged: TL-25 is for edits made elsewhere)
        await updateActivity(w, model.extra.vocab, cur, next, { bump: true, ifVersion: body.event.entryVersion, lock: newLocks }, oppAccount);
        const ev = await batchEventFor(w.tx, w.userId, cur.id, profile);
        if ('why' in ev) throw invalid(`That edit leaves the row unable to log: it ${ev.why}`);
        lines = [eventLine(Number(first.cells[0]) || 1, ev.event)];
        what = cur.description;
      } else if ((row.kind === 'dc' || row.kind === 'dcchange') && body.dc) {
        const review = canvasReviewOf(d, { entry: (x) => model.get('activity', x), dcRequests: await loadDcRequests(w.tx, w.userId), now: w.now });
        const reqId = review.dcs.find((x) => x.key === body.key)?.requestId;
        const cur = reqId ? (await loadDcRequests(w.tx, w.userId)).find((x) => x.id === reqId) : undefined;
        if (!cur) throw notFound('DC request', body.key);
        if (cur.kind === 'change' && body.dc.split !== undefined && cur.dc?.split === body.dc.split) throw invalid(`Your DC is at ${body.dc.split}% already: remove the row instead`);
        await updateDcRequest(w, cur.id, { ...(body.dc.split !== undefined ? { splitPercent: body.dc.split } : {}), ...(body.dc.role !== undefined ? { role: body.dc.role } : {}), ...(body.dc.comment !== undefined ? { comment: body.dc.comment } : {}) });
        const add = dcAddOf({ ...cur, splitPercent: body.dc.split ?? cur.splitPercent, role: body.dc.role ?? cur.role, comment: body.dc.comment ?? cur.comment, org62OpportunityId: cur.org62OpportunityId ?? first.cells[7] ?? null });
        const n = Number(first.cells[0]) || 1;
        lines = cur.kind === 'change' ? dcChangeRows(add).map((f, k) => f(n + k)) : [dcAddRow(n, add)];
        what = `the DC on ${cur.oppName}`;
      } else if (row.kind === 'use_case' && body.useCase) {
        const fields = checkedUseCaseFields(body.useCase);
        const key = body.key;
        await writeKv(w, ROW_OVERRIDES_KV, withRowOverride(await loadRowOverrides(w.tx, w.userId), key, fields, w.now.toISOString()));
        const c = withUcOverride(ucCreateOfRow(first), { fields });
        lines = [ucCreateLine(Number(first.cells[0]) || 1, c)];
        what = `the use case ${c.name}`;
      } else if (row.kind === 'update' && body.update) {
        const v = checkedUpdateValue(first, body.update.newValue);
        await writeKv(w, ROW_OVERRIDES_KV, withRowOverride(await loadRowOverrides(w.tx, w.userId), body.key, { newValue: v }, w.now.toISOString()));
        lines = [updateLineWith(first, v)];
        what = `${first.cells[3]} on ${first.cells[2]}`;
      } else throw invalid(`That edit does not fit this row (a ${row.kind.replace('dcchange', 'DC change').replace('_', ' ')} row)`);
      await w.tx.update(changeSets).set({ summary: `Edited ${what} on ${d.destination.kind === 'action' ? d.destination.target.label : 'a canvas'}`.slice(0, 200) }).where(eq(changeSets.id, w.cs.id));
      await updateDraft(w, d, restagedCanvas(d, withRowReplaced(input, body.key, lines)), { bump: true, ifVersion: body.ifVersion });
    });
    this.bus.publishTables(['drafts', 'activity_entries', 'deal_contribution_requests'], [params.id], 'canvas.rows.edit');
    await this.syncLandingsQuietly('canvas.rows.edit');
    return { entity: await this.canvasReview(params.id), auditId: r.auditId };
  }

  async draftVdpUpdate({ body }: I<'draftVdpUpdate'>): Promise<Res<'draftVdpUpdate'>> {
    const m = await this.model();
    let dest: ActionDestination;
    if (body.itemKey) {
      // One item's Apply, rebuilt from the mirror (D-59): the call the page shows, never the client's ids.
      const st = await this.vdpState();
      const detail = body.itemKey.startsWith('asset:') ? this.assetCandidatesFor(st, body.itemKey) : [];
      dest = vdpActionForItem(st.coverage, st.snapshots, body, detail, { duplicateOf: st.duplicateOf });
    } else {
      const rec = (await loadVdpRecords(this.db, m.ctx.userId)).find((r) => r.vdpSlug === body.vdpSlug && !r.goneAt);
      if (!rec?.snapshot) throw notFound('VDP', body.vdpSlug ?? '(none)');
      // D-67: a new use case is checked against both systems first
      dest = vdpActionFor(rec.snapshot, body, body.op === 'create_use_case' ? { duplicateOf: (await this.vdpState(m)).duplicateOf } : {});
    }
    const workItemId = body.workItemId && m.get('workItems', body.workItemId) ? body.workItemId : null;
    const draft = actionDraftFor(dest, { id: crypto.randomUUID(), now: this.now().toISOString(), workItemId, rendered: (doc) => renderAll(dest, doc) });
    const r = await this.mutate({ action: 'vdp.update.draft', summary: `VDP change for approval: ${actionSummary(dest)}`.slice(0, 200), entity: { type: 'draft', id: draft.id }, undoable: false }, async (w) => {
      await insertDraft(w, draft);
    });
    this.bus.publishTables(['drafts'], [draft.id], 'vdp.update.draft');
    const saved = (await this.model()).get('drafts', draft.id) ?? draft;
    return { entity: { draft: saved, destination: dest }, auditId: r.auditId };
  }

  /**
   * D-60: withdraw the staged VDP changes whose item is open nowhere after a newer VDP read (VDP already has it): each
   * becomes discarded with "Withdrawn: VDP already has this", in one system change set. Returns the ids. The worker
   * runs it after each VDP read; it never touches an approved or applied item.
   */
  async withdrawGoneVdpDrafts(): Promise<string[]> {
    const st = await this.vdpState();
    // VD-24: the items of a push that is queued or running are its own to finish (a read landing mid-push withdraws none)
    const nowMs = this.now().getTime();
    const running = new Set(pushRunsOf(st.m.ctx.kv.get(VDP_PUSH_KV)).filter((r) => r.state !== 'done' && nowMs - Date.parse(r.at) < 30 * 60_000).flatMap((r) => r.nodes.map((n) => n.draftId).filter((x): x is string => !!x)));
    const ids = goneVdpDrafts(st.coverage, st.drafts, { running });
    if (!ids.length) return [];
    await this.mutate({ action: 'vdp.withdraw', summary: `Withdrew ${ids.length} staged VDP ${ids.length === 1 ? 'change' : 'changes'}: VDP already has ${ids.length === 1 ? 'it' : 'them'}`, entity: { type: 'draft', id: ids[0]! }, actor: 'system', undoable: false }, async (w, model) => {
      for (const id of ids) {
        const d = model.get('drafts', id);
        if (!d || (d.status !== 'ready' && d.status !== 'failed')) continue;
        await updateDraft(w, d, { ...d, status: 'discarded', rejectedReason: VDP_WITHDRAWN_REASON }, { bump: true });
      }
    });
    this.bus.publishTables(['drafts'], ids, 'vdp.withdraw');
    return ids;
  }

  /**
   * D-60, D-63: "Push N to VDP": the ticked items and what they need first, each staged as its own Outbox item now.
   * Dry run records them here (placeholders for ids a parent would create). Live, the worker's `vdp.push` runs them in
   * order (src/server/vdp/push.ts), approved by this click, passing each new id down; the Changes tab follows it.
   */
  async pushVdpChanges({ body }: I<'pushVdpChanges'>): Promise<Res<'pushVdpChanges'>> {
    return startVdpPush(this.vdpPushPort({ route: true }), body);
  }

  /**
   * D-63: the worker's `vdp.push` for one push: its items in order, each approved by the push click (approval method
   * `click`, approved at the push) and delivered by the Outbox job inline through the gateway (read-back included).
   */
  async runVdpPush(deps: { pushId: string; gateway: OutboxGateway | null; signal?: AbortSignal; reads?: VdpLiveReads | null }): Promise<Record<string, unknown>> {
    const run = pushRunsOf((await this.model()).ctx.kv.get(VDP_PUSH_KV)).find((r) => r.id === deps.pushId);
    if (!run) return { skipped: 'push_missing' };
    if (run.state === 'done') return { skipped: 'done' };
    // D-69 (VD-23, VD-25): the live check before each create reads VDP through the read client (the worker, live only)
    const reads = deps.reads !== undefined ? deps.reads : liveOrg62() ? vdpLiveReads(new VdpClient({ limiter: vdpCallLimiter }), deps.signal) : null;
    const out = await runVdpPush(this.vdpPushPort({ route: false, gateway: deps.gateway, ...(deps.signal ? { signal: deps.signal } : {}), reads }), run);
    // D-70: the VDP push → VDP landings (each use-case and asset item a write, sent; the mirror's read verifies it)
    await this.syncLandingsQuietly('vdp.push');
    const count = (s: string) => out.nodes.filter((n) => n.state === s).length;
    return { items: out.nodes.length, applied: count('applied'), failed: count('failed'), skipped: count('skipped'), dryRun: count('dry_run') };
  }

  /** The pushes settled against their `vdp.push` jobs (src/server/vdp/push.ts settlePushRuns): a dead job's push is stopped. */
  private async settledPushRuns(runs: VdpPushRun[]): Promise<VdpPushRun[]> {
    const open = runs.filter((r) => r.state === 'queued' || r.state === 'running').map((r) => r.id);
    const jobs = new Map<string, string>();
    if (open.length) {
      const rows = await this.db.execute<{ push_id: string; status: string }>(
        sql`select distinct on (payload->>'pushId') payload->>'pushId' as push_id, status::text as status from jobs where owner_user_id = ${await this.userId()} and kind = ${VDP_PUSH_JOB} and payload->>'pushId' = any(${`{${open.map((id) => `"${id.replace(/["\\]/g, '\\$&')}"`).join(',')}}`}::text[]) order by payload->>'pushId', id desc`,
      );
      for (const r of rows.rows) jobs.set(r.push_id, r.status);
    }
    return settlePushRuns(runs, jobs, this.now().getTime());
  }

  /** The push's port over this database (D-63). `route`: the web request (dry run only); else the worker (live). */
  private vdpPushPort(o: { route: boolean; gateway?: OutboxGateway | null; signal?: AbortSignal; reads?: VdpLiveReads | null }): PushRoutePort {
    const port: PushRoutePort = {
      ...(o.reads ? { liveMade: (node, draft) => liveMadeVia(o.reads!, node, draft) } : {}),
      now: () => this.now(),
      newId: () => crypto.randomUUID(),
      dryRunNow: async () => sendingOf((await this.model()).settings().sending).dryRun,
      state: async () => {
        const st = await this.vdpState();
        return { coverage: st.coverage, snapshots: st.snapshots, drafts: new Map(st.drafts.filter((d) => d.destination.kind === 'action' && d.destination.action.startsWith('vdp.')).map((d) => [d.id, d] as const)), duplicateOf: st.duplicateOf };
      },
      draft: async (id) => (await this.model()).get('drafts', id) ?? null,
      stage: async (dest, so) => {
        // the worker stages under a fixed id: a push resumed after a restart finds the one it staged
        if (so?.id) {
          const [have] = await this.db.select({ id: draftsTable.id }).from(draftsTable).where(eq(draftsTable.id, so.id)).limit(1);
          if (have) return (await this.model()).get('drafts', so.id)!;
        }
        const draft = actionDraftFor(dest, { id: so?.id ?? crypto.randomUUID(), now: this.now().toISOString(), rendered: (doc) => renderAll(dest, doc) });
        await this.mutate({ action: 'vdp.update.draft', summary: `VDP change for approval: ${actionSummary(dest)}`.slice(0, 200), entity: { type: 'draft', id: draft.id }, undoable: false }, async (w) => {
          await insertDraft(w, draft);
        });
        this.bus.publishTables(['drafts'], [draft.id], 'vdp.update.draft');
        return draft;
      },
      discard: async (id, reason) => {
        await this.mutate({ action: 'vdp.push.withdraw', summary: reason.slice(0, 200), entity: { type: 'draft', id }, actor: 'system', undoable: false }, async (w, model) => {
          const d = model.get('drafts', id);
          if (d && (d.status === 'ready' || d.status === 'failed')) await updateDraft(w, d, { ...d, status: 'discarded', rejectedReason: reason }, { bump: true });
        });
        this.bus.publishTables(['drafts'], [id], 'vdp.push.withdraw');
      },
      // a dry-run push records only, wherever it runs (2026-11-16: the worker runs dry runs too, so the click returns)
      deliver: (draft, x) => (o.route || x.run.dryRun ? this.vdpPushDryRun(draft) : this.vdpPushDeliver(draft, x.run, { gateway: o.gateway ?? null, ...(o.signal ? { signal: o.signal } : {}) })),
      progress: async (run) => {
        await this.mutate({ action: 'vdp.push.progress', summary: `Push to VDP: ${run.nodes.filter((n) => n.state === 'applied' || n.state === 'dry_run').length} of ${run.nodes.length} done`, entity: { type: 'settings', id: VDP_PUSH_KV }, actor: o.route ? 'user' : 'system', undoable: false }, async (w, model) => writeKv(w, VDP_PUSH_KV, nextPushRuns(pushRunsOf(model.ctx.kv.get(VDP_PUSH_KV)), run)));
        this.bus.publishTables(['drafts'], [], 'vdp.push');
      },
      ...(o.route
        ? {
            activePush: async () => activePushOf(await this.settledPushRuns(pushRunsOf((await this.model()).ctx.kv.get(VDP_PUSH_KV)))),
            enqueue: async (run) => {
              await enqueueJob(this.db, { ownerUserId: await this.userId(), kind: VDP_PUSH_JOB, queue: VDP_ASSETS_QUEUE, payload: { pushId: run.id }, idempotencyKey: `vdp.push:${run.id}`, maxAttempts: 1, timeoutSeconds: pushTimeoutSeconds(run.nodes) });
              this.bus.publishTables(['jobs'], [], 'vdp.push');
            },
          }
        : {}),
    };
    return port;
  }

  /** The route's delivery: a dry run only (the record of the payload; the worker makes every live write). */
  private async vdpPushDryRun(draft: Draft): Promise<PushDelivery> {
    try {
      const d0 = this.draft(await this.model(), draft.id);
      const plan = await planDispatch(d0, { mode: 'send', confirmToken: this.confirmTokenFor(d0, 'send'), expectedToken: this.confirmTokenFor(d0, 'send'), dryRun: true, now: this.now() });
      await this.mutate({ action: 'draft.dispatch.dry_run', summary: `Dry run: ${d0.destination.kind === 'action' ? d0.destination.target.label : 'VDP change'}`.slice(0, 200), entity: { type: 'draft', id: d0.id }, undoable: false }, async (w, model) => {
        const d = this.draft(model, d0.id);
        const res = await updateDraft(w, d, { ...d, mode: 'send', attempts: [...d.attempts, dispatchAttempt(plan, w.now.toISOString())] }, { bump: true });
        await recordDispatch(w, d.id, res.attemptIds[res.attemptIds.length - 1]!, plan);
      });
      this.bus.publishTables(['drafts'], [d0.id], 'vdp.push');
      return { outcome: 'dry_run', externalId: null, link: null, detail: 'Dry run: recorded, nothing sent' };
    } catch (err) {
      return { outcome: 'failed', externalId: null, link: null, detail: ((err as Error).message || 'Could not record it').slice(0, 300) };
    }
  }

  /** The worker's delivery of one pushed item: approved by the push click, delivered now by the Outbox job, read back. */
  private async vdpPushDeliver(draft: Draft, run: VdpPushRun, deps: { gateway: OutboxGateway | null; signal?: AbortSignal }): Promise<PushDelivery> {
    const d0 = this.draft(await this.model(), draft.id);
    const at = this.now().toISOString();
    const payload = payloadFor(d0.destination, d0.doc, 'send');
    const hash = payloadHash(payload);
    let attemptId: string;
    try {
      if (d0.destination.kind !== 'action' || !d0.destination.action.startsWith('vdp.')) throw invalid('A push applies VDP items only');
      const what = actionSummary(d0.destination);
      const r = await this.mutate({ action: 'vdp.push.apply', summary: `Pushed to VDP: ${what}`.slice(0, 200), entity: { type: 'draft', id: d0.id }, undoable: false }, async (w, model) => {
        const d = this.draft(model, d0.id);
        if (DELIVERED_STATUSES.has(d.status)) throw invalid(`Draft is ${d.status}: it was already delivered, so nothing was sent again`);
        const attempt = { id: '0', at, mode: 'send' as const, dryRun: false, outcome: 'unconfirmed' as const, detail: `Approved with Push to VDP (${run.at}): on its way to VDP` };
        const res = await updateDraft(w, d, { ...d, mode: 'send', attempts: [...d.attempts, attempt], status: 'sending', verification: { state: 'pending', at: null, detail: 'Waiting for the send adapter' } }, { bump: true });
        const id = res.attemptIds[res.attemptIds.length - 1]!;
        await w.tx.update(draftAttemptsTable).set({ requestHash: hash }).where(eq(draftAttemptsTable.id, Number(id)));
        // the push click is the approval of each item it lists (approval method `click`, at the push)
        await w.tx.update(draftsTable).set({ approvedContentHash: sql`${draftsTable.contentHash}`, approvedAt: new Date(run.at), approvalMethod: 'click' }).where(eq(draftsTable.id, d.id));
        return { id, version: d.version + 1 };
      });
      attemptId = r.result.id;
      this.bus.publishTables(['drafts'], [d0.id], 'vdp.push');
      const userId = await this.userId();
      const out = await runOutboxJob({ draftId: d0.id, attemptId, mode: 'send', version: r.result.version, payloadHash: hash }, dbOutboxPort(this.db, userId, { extractorId: () => this.extractor(), now: () => this.now() }), deps.gateway, { now: () => this.now(), ...(deps.signal ? { signal: deps.signal } : {}) });
      this.bus.publishTables(['drafts'], [d0.id], 'vdp.push');
      const d = (await this.model()).get('drafts', d0.id);
      if (out.state === 'dry_run_delivered') return { outcome: 'dry_run', externalId: null, link: null, detail: 'Dry run came on: recorded, nothing sent' };
      if (out.state !== 'delivered') return { outcome: 'failed', externalId: null, link: null, detail: (d?.attempts.at(-1)?.detail || String(out.code ?? out.state ?? 'not delivered')).slice(0, 300) };
      if (out.readback === 'missing') return { outcome: 'failed', externalId: d?.externalId ?? null, link: d?.resultUrl ?? null, detail: (d?.verification?.detail || 'Read-back: not in VDP').slice(0, 300) };
      return { outcome: 'applied', externalId: d?.externalId ?? null, link: d?.resultUrl ?? null, detail: out.readback === 'confirmed' ? 'Verified in VDP ✓' : (d?.verification?.detail ?? 'Applied; not read back yet').slice(0, 300) };
    } catch (err) {
      return { outcome: 'failed', externalId: null, link: null, detail: ((err as Error).message || 'Not delivered').slice(0, 300) };
    }
  }

  /**
   * D-60: one VDP autopilot run (the worker's `vdp.autopilot`): the shared runner over this database. Each item is
   * staged from the mirror and approved under the autonomy policy (approval_method `autonomy_policy`, the user's
   * `autonomy_policies` row for vdp_update at L4), then delivered by the Outbox job inline, which re-checks the policy,
   * dry run and the payload before the write and reads it back. History: actor = the autonomy policy.
   */
  async runVdpAutopilot(deps: { gateway: OutboxGateway | null; auth: () => Promise<'ok' | 'stale'>; notify?: (why: 'reauth' | 'dry_run' | 'cap') => Promise<void>; signal?: AbortSignal }): Promise<AutopilotRunResult> {
    const port: AutopilotPort = {
      now: () => this.now(),
      settings: async () => {
        const m = await this.model();
        return { sending: m.settings().sending, timezone: m.settings().profile.timezone };
      },
      auth: deps.auth,
      ledger: async () => ledgerOf((await this.model()).ctx.kv.get(VDP_AUTOPILOT_KV)),
      saveLedger: async (next, o) => {
        // an idle run (nothing applied, the pause unchanged) writes nothing: no History entry every half hour
        if (!o.changed) return;
        const summary = o.applied || o.failed ? `VDP autopilot: ${o.applied} applied${o.failed ? `, ${o.failed} failed` : ''}` : next.paused ? `VDP autopilot paused (${next.paused})` : 'VDP autopilot: nothing to apply';
        await this.mutate({ action: 'vdp.autopilot.run', summary, entity: { type: 'settings', id: VDP_AUTOPILOT_KV }, undoable: false, policyActor: VDP_AUTOPILOT_POLICY }, async (w) => writeKv(w, VDP_AUTOPILOT_KV, next));
        this.bus.publishTables(['drafts'], [], 'vdp.autopilot');
      },
      plan: async (ap) => {
        const m = await this.model();
        const st = await this.vdpState(m, { ...ap, auth: ap.auth });
        return { coverage: st.coverage, queue: st.queue, snapshots: st.snapshots };
      },
      apply: (item, dest) => this.autopilotApply(item, dest, deps),
      ...(deps.notify ? { notifyPaused: deps.notify } : {}),
    };
    return runVdpAutopilot(port, { signal: deps.signal });
  }

  /** Stage one autopilot item and deliver it now (the Outbox job, inline): how it ended, for the ledger. */
  private async autopilotApply(item: AutopilotItem, dest: ActionDestination, deps: { gateway: OutboxGateway | null; signal?: AbortSignal }): Promise<AutopilotApplyResult> {
    const m0 = await this.model();
    // dry run is re-read right before staging (and again by the Outbox before the write): switching it on wins
    if (sendingOf(m0.settings().sending).dryRun) return { draftId: null, outcome: 'dry_run', detail: null, url: null };
    const at = this.now().toISOString();
    const draft = { ...actionDraftFor(dest, { id: crypto.randomUUID(), now: at, rendered: (doc) => renderAll(dest, doc) }), appliedBy: 'autopilot' as const };
    const payload = payloadFor(dest, draft.doc, 'send');
    const hash = payloadHash(payload);
    const r = await this.mutate({ action: 'vdp.autopilot.apply', summary: `VDP autopilot applied: ${actionSummary(dest)}`.slice(0, 200), entity: { type: 'draft', id: draft.id }, undoable: false, policyActor: VDP_AUTOPILOT_POLICY }, async (w) => {
      // the user's autonomy policy row for VDP changes (Settings ▸ Sending ▸ VDP autopilot): the approval's anchor
      const pol = await w.tx.execute<{ id: string }>(sql`
        insert into autonomy_policies (owner_user_id, action_type, level, target_external_id, note)
        values (${w.userId}, 'vdp_update', 'L4_auto', null, 'VDP autopilot (D-60): Settings ▸ Sending')
        on conflict (owner_user_id, action_type, target_external_id) do update set level = 'L4_auto', updated_at = now()
        returning id`);
      const policyId = pol.rows[0]!.id;
      await insertDraft(w, draft);
      const attempt = { id: '0', at, mode: 'send' as const, dryRun: false, outcome: 'unconfirmed' as const, detail: 'Applied automatically (VDP autopilot): on its way to VDP' };
      const res = await updateDraft(w, draft, { ...draft, attempts: [attempt], status: 'sending', verification: { state: 'pending', at: null, detail: 'Waiting for the send adapter' } }, { bump: true });
      const attemptId = res.attemptIds[res.attemptIds.length - 1]!;
      await w.tx.update(draftAttemptsTable).set({ requestHash: hash }).where(eq(draftAttemptsTable.id, Number(attemptId)));
      await w.tx
        .update(draftsTable)
        .set({ approvedContentHash: sql`${draftsTable.contentHash}`, approvedAt: new Date(at), approvalMethod: 'autonomy_policy', autonomyPolicyId: policyId, autonomyLevel: 'L4_auto' })
        .where(eq(draftsTable.id, draft.id));
      return attemptId;
    });
    this.bus.publishTables(['drafts'], [draft.id], 'vdp.autopilot');
    const userId = await this.userId();
    const out = await runOutboxJob({ draftId: draft.id, attemptId: r.result, mode: 'send', version: draft.version + 1, payloadHash: hash }, dbOutboxPort(this.db, userId, { extractorId: () => this.extractor(), now: () => this.now() }), deps.gateway, { now: () => this.now(), ...(deps.signal ? { signal: deps.signal } : {}) });
    this.bus.publishTables(['drafts'], [draft.id], 'vdp.autopilot');
    const d = (await this.model()).get('drafts', draft.id);
    if (out.state === 'dry_run_delivered') return { draftId: draft.id, outcome: 'dry_run', detail: null, url: null };
    const ok = out.state === 'delivered' && out.readback === 'confirmed';
    // a failed delivery says why on its attempt; a write that did not read back says so on its verification
    const detail = ok ? 'Verified in VDP ✓' : out.state === 'failed' ? d?.attempts.at(-1)?.detail || String(out.code ?? 'not delivered') : d?.verification?.detail || d?.attempts.at(-1)?.detail || String(out.readback ?? out.state ?? 'not applied');
    return { draftId: draft.id, outcome: ok ? 'applied' : 'failed', detail: detail.slice(0, 300), url: d?.resultUrl ?? null };
  }

  // ---- D-69: company identity (Change… on a company node)

  /** Search VDP companies: the mirror, the stored lookups, and (live, in the launchd app) VDP's own list_companies. */
  async searchVdpCompanies({ query }: I<'searchVdpCompanies'>): Promise<Res<'searchVdpCompanies'>> {
    const userId = await this.userId();
    const records = await loadVdpRecords(this.db, userId);
    const snaps = records.filter((r) => r.snapshot).map((r) => r.snapshot!);
    const server = await loadVdpServer(this.db, userId);
    if (!liveOrg62()) return searchResult(query.q, searchCompaniesLocal(query.q, snaps, server), false, 'From what the app read; VDP is asked live in the running app');
    try {
      const look = await new VdpClient({ limiter: vdpCallLimiter }).findCompany(query.q);
      return searchResult(query.q, searchCompaniesLocal(query.q, snaps, server, look.matches), true);
    } catch (err) {
      return searchResult(query.q, searchCompaniesLocal(query.q, snaps, server), false, `VDP could not be asked now (${(err as Error).name}): from what the app read`);
    }
  }

  async setVdpIdentity({ body }: I<'setVdpIdentity'>): Promise<Res<'setVdpIdentity'>> {
    const m = await this.model();
    const next = overrideFrom(body, m.all('accounts'), this.now().toISOString());
    const label = next.pick.kind === 'match' ? next.pick.name : `create “${next.pick.name}”`;
    const r = await this.mutate({ action: 'vdp.identity.set', summary: `VDP company: ${label} for ${next.accountIds.length} ${next.accountIds.length === 1 ? 'account' : 'accounts'} (yours)`.slice(0, 200), entity: { type: 'vdp', id: next.key } }, async (w, model) => {
      await writeKv(w, VDP_IDENTITY_KV, { overrides: nextOverrides(overridesOf(model.ctx.kv.get(VDP_IDENTITY_KV)), next, body.key ?? null) });
    });
    this.bus.publishTables(['vdp_records'], [next.key], 'vdp.identity.set');
    const st = await this.vdpState();
    return { entity: { identity: identityIn(st.coverage, next.key), overrides: overridesOf(st.m.ctx.kv.get(VDP_IDENTITY_KV)).length }, auditId: r.undoable ? r.auditId : null };
  }

  async clearVdpIdentity({ body }: I<'clearVdpIdentity'>): Promise<Res<'clearVdpIdentity'>> {
    const m0 = await this.model();
    const list = overridesOf(m0.ctx.kv.get(VDP_IDENTITY_KV));
    if (!list.some((o) => o.key === body.key)) {
      const st0 = await this.vdpState(m0);
      return { entity: { identity: identityIn(st0.coverage, body.key), overrides: list.length }, auditId: null };
    }
    const r = await this.mutate({ action: 'vdp.identity.clear', summary: 'VDP company: back to the app’s own decision', entity: { type: 'vdp', id: body.key } }, async (w, model) => {
      await writeKv(w, VDP_IDENTITY_KV, { overrides: withoutOverride(overridesOf(model.ctx.kv.get(VDP_IDENTITY_KV)), body.key) });
    });
    this.bus.publishTables(['vdp_records'], [body.key], 'vdp.identity.clear');
    const st = await this.vdpState();
    return { entity: { identity: identityIn(st.coverage, body.key), overrides: overridesOf(st.m.ctx.kv.get(VDP_IDENTITY_KV)).length }, auditId: r.undoable ? r.auditId : null };
  }

  async getAccount({ params }: I<'getAccount'>): Promise<Res<'getAccount'>> {
    const m = await this.model();
    const account = m.get('accounts', params.accountId);
    if (!account) throw notFound('Account', params.accountId);
    // my DC (split, role) from deal_contributions on each opp (loadOpportunities); dcAssigned = myDc or Org62 says so
    const opps = m.all('opps').filter((o) => o.accountId === account.id).map(withMyDcFlag);
    const items = m.all('workItems').filter((w) => w.accountId === account.id && w.state !== 'dismissed');
    const detail: AccountDetail = {
      account,
      opps,
      needs: (await this.dealsNeeds(m)).filter((n) => n.accountId === account.id),
      initiatives: m.all('initiatives').filter((i) => i.accountId === account.id),
      items: items.map((w) => hydrateItem(m, w)),
      assets: m.all('assets').filter((a) => a.accountId === account.id),
      runs: m.all('agentRuns').filter((r) => items.some((w) => w.id === r.workItemId)),
      briefs: m
        .all('briefs')
        .filter((b) => b.accountId === account.id || (b.oppId && opps.some((o) => o.id === b.oppId)))
        .map((b) => promotedAs(m, b)),
      missed: m.all('missedOpps').filter((x) => x.accountName === account.name),
    };
    return detail;
  }

  /**
   * One Claim verb (Missed ▸ Claim, Triage's Claim): a DC request on the finding's opp, with the createDcRequest rules.
   * Only when the app doesn't know the opp, the old fallback: a task to add the DC by hand.
   */
  private async claimIn(w: WriteCtx, model: ReadModel, mo: MissedOpp, body: ClaimMissedRequest = {}): Promise<{ dcRequestId: string | null; workItemId: string | null }> {
    const opp = mo.oppId ? model.get('opps', mo.oppId) : undefined;
    if (opp && featureActive(personaOf(model.settings()), 'dealContributions')) {
      const rec = await this.dcRequestIn(w, model, { id: opp.id, name: opp.name }, { split: body.split ?? 100, comment: body.comment ?? claimComment(mo.evidence), ...(body.role ? { role: body.role } : {}) }, { missedOppFindingId: uuidFor(mo.id) });
      await updateFinding(w, mo, { ...mo, status: 'claimed' });
      return { dcRequestId: rec.id, workItemId: null };
    }
    return { dcRequestId: null, workItemId: await this.claimTaskIn(w, model, mo) };
  }

  private async claimTaskIn(w: WriteCtx, model: ReadModel, mo: MissedOpp): Promise<string> {
    const now = w.now.toISOString();
    const account = model.all('accounts').find((a) => a.name === mo.accountName);
    const task: WorkItemRecord = {
      ...blankItem(now, model.ctx.me),
      id: crypto.randomUUID(),
      kind: 'task',
      state: 'open',
      title: `Add yourself as DC on ${mo.oppName}`,
      purpose: `Missed-opp sweep: ${mo.accountName}`,
      accountId: account?.id ?? null,
      oppId: mo.oppId && model.get('opps', mo.oppId) ? mo.oppId : null,
      confidence: 'likely',
      why: mo.evidence[0] ?? 'Possible missed opportunity',
      sources: [{ kind: 'org62', label: `Org62 · ${mo.oppName}` }],
      effort: { youMin: 10, agentMin: 0 },
    };
    await insertWorkItem(w, task, this.links(model), { locks: [] });
    await updateFinding(w, mo, { ...mo, status: 'claimed', claimedWorkItemId: task.id });
    return task.id;
  }

  async claimMissed({ params, body }: I<'claimMissed'>): Promise<Res<'claimMissed'>> {
    let oppName = '';
    let dcId = null as string | null;
    const r = await this.mutate({ action: 'missed.claim', summary: 'Claimed', entity: { type: 'missed_opp', id: params.id } }, async (w, model) => {
      const mo = model.get('missedOpps', params.id);
      if (!mo) throw notFound('Missed opp', params.id);
      if (mo.status !== 'new') throw invalid(`Already ${mo.status}`);
      oppName = mo.oppName;
      dcId = (await this.claimIn(w, model, mo, body ?? {})).dcRequestId;
      await w.tx.update(changeSets).set({ summary: `Claimed ${mo.oppName}` }).where(eq(changeSets.id, w.cs.id));
    });
    if (dcId) this.bus.publishTables(['deal_contribution_requests'], [dcId], 'dc.request');
    const m = await this.model();
    return { entity: m.get('missedOpps', params.id)!, auditId: r.auditId, receipt: await receiptFromChangeSet(this.db, r.auditId, m, 'user', `Claimed ${oppName}`, this.now().toISOString()) };
  }

  async dismissMissed({ params, body }: I<'dismissMissed'>): Promise<Res<'dismissMissed'>> {
    const r = await this.mutate({ action: 'missed.dismiss', summary: 'Dismissed', entity: { type: 'missed_opp', id: params.id } }, async (w, model) => {
      const mo = model.get('missedOpps', params.id);
      if (!mo) throw notFound('Missed opp', params.id);
      await w.tx.update(changeSets).set({ summary: `Dismissed ${mo.oppName}: ${body.reason}` }).where(eq(changeSets.id, w.cs.id));
      await updateFinding(w, mo, { ...mo, status: 'dismissed', dismissReason: body.note ? `${body.reason}: ${body.note}` : body.reason });
    });
    const m = await this.model();
    return { entity: m.get('missedOpps', params.id)!, auditId: r.auditId };
  }

  // =========================================================================
  // Briefs and watches
  // =========================================================================

  async getBriefs(_i: I<'getBriefs'>): Promise<Res<'getBriefs'>> {
    const m = await this.model();
    const summary = (b: Brief) => ({ id: b.id, kind: b.kind, title: b.title, unread: b.unread, worthALook: b.highlights.filter((h) => h.status === 'new' || h.status === 'seen').length, through: b.through, status: b.status });
    const briefs = m.all('briefs').sort((a, b) => b.through.localeCompare(a.through));
    const watched = briefs.filter((b) => b.kind !== 'opp').map(summary);
    const opportunities = briefs.filter((b) => b.kind === 'opp').map(summary);
    return { watched, opportunities, watches: m.all('watches'), counts: { unread: briefs.filter((b) => b.unread).length, worthALook: [...watched, ...opportunities].reduce((s, b) => s + b.worthALook, 0) } };
  }

  /** Reading a brief marks it read (a non-undoable marker). */
  async getBrief({ params }: I<'getBrief'>): Promise<Res<'getBrief'>> {
    const m = await this.model();
    const b = m.get('briefs', params.id);
    if (!b) throw notFound('Brief', params.id);
    if (b.unread) {
      await this.mutate({ action: 'brief.read', summary: 'Read', entity: { type: 'brief', id: b.id }, undoable: false }, async (w) => markBriefSeen(w, b.id));
      this.bus.publishTables(['briefs'], [b.id], 'brief.read');
      return promotedAs(m, { ...b, unread: false });
    }
    return promotedAs(m, b);
  }

  private highlight(m: ReadModel, hid: string): { brief: Brief; h: BriefHighlight } {
    for (const brief of m.all('briefs')) {
      const h = brief.highlights.find((x) => x.id === hid);
      if (h) return { brief, h };
    }
    throw notFound('Highlight', hid);
  }

  private async highlightAction(hid: string, ifVersion: number | undefined, kind: 'promote' | 'task' | 'dismiss') {
    const r = await this.mutate({ action: `highlight.${kind}`, summary: kind, entity: { type: 'brief_highlight', id: hid }, current: async () => this.highlight(await this.model(), hid).h }, async (w, model) => {
      const { brief, h } = this.highlight(model, hid);
      this.checkVersion(h, ifVersion, 'Highlight', h);
      if (h.status === 'promoted' || h.status === 'dismissed') throw invalid(`Highlight already ${h.status}`);
      await w.tx.update(changeSets).set({ summary: `${kind === 'dismiss' ? 'Not relevant' : kind === 'task' ? 'Made task' : 'Promoted'}: ${h.title}` }).where(eq(changeSets.id, w.cs.id));
      let workItemId: string | null = null;
      if (kind !== 'dismiss') {
        const now = w.now.toISOString();
        const item: WorkItemRecord = {
          ...blankItem(now, model.ctx.me),
          id: crypto.randomUUID(),
          state: kind === 'task' ? 'open' : 'suggested',
          title: h.title,
          purpose: `From brief: ${brief.title}`,
          accountId: brief.accountId,
          oppId: brief.oppId,
          confidence: h.relevance === 'high' ? 'likely' : 'guess',
          why: h.reasons[0]!,
          whyDetail: h.reasons.join(' · '),
          sources: h.sources,
          signals: { customerFacing: !!brief.accountId || !!brief.oppId, fromManager: false, boost: 0 },
        };
        workItemId = item.id;
        await insertWorkItem(w, item, this.links(model), { locks: [] });
      }
      await updateHighlight(w, h, { ...h, status: kind === 'dismiss' ? 'dismissed' : 'promoted', promotedWorkItemId: workItemId }, ifVersion);
    });
    const m = await this.model();
    return { entity: promotedAs(m, { highlights: [this.highlight(m, hid).h] }).highlights[0]!, auditId: r.auditId };
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
    return { watches: (await this.model()).all('watches') };
  }

  private existsFn(tx: Tx) {
    return async (kind: 'opportunity' | 'account' | 'person', rid: string) => {
      const t = kind === 'opportunity' ? 'opportunities' : kind === 'account' ? 'accounts' : 'people';
      const r = await tx.execute(sql`select 1 from ${sql.identifier(t)} where id = ${rid}::uuid`);
      return r.rows.length > 0;
    };
  }

  async createWatch({ body }: I<'createWatch'>): Promise<Res<'createWatch'>> {
    const wid = crypto.randomUUID();
    const r = await this.mutate({ action: 'watch.create', summary: `Watching ${body.label}`, entity: { type: 'watch', id: wid } }, async (w) => {
      await insertWatch(w, { id: wid, version: 1, ...body, enabled: true, createdAt: w.now.toISOString(), updatedAt: w.now.toISOString() }, this.existsFn(w.tx));
    });
    return { entity: (await this.model()).get('watches', wid)!, auditId: r.auditId };
  }

  async patchWatch({ params, body }: I<'patchWatch'>): Promise<Res<'patchWatch'>> {
    const r = await this.mutate({ action: 'watch.edit', summary: 'Edited watch', entity: { type: 'watch', id: params.id }, current: async () => (await this.model()).get('watches', params.id) ?? null }, async (w, model) => {
      const cur = model.get('watches', params.id);
      if (!cur) throw notFound('Watch', params.id);
      this.checkVersion(cur, body.ifVersion, 'Watch', cur);
      await w.tx.update(changeSets).set({ summary: `Edited watch ${cur.label}` }).where(eq(changeSets.id, w.cs.id));
      await updateWatch(w, cur, { ...cur, ...body.patch }, body.ifVersion, this.existsFn(w.tx));
    });
    return { entity: (await this.model()).get('watches', params.id)!, auditId: r.auditId };
  }

  // =========================================================================
  // Triage
  // =========================================================================

  async getTriage(_i: I<'getTriage'>): Promise<Res<'getTriage'>> {
    const m = await this.model();
    // SETTLE-1: the Closed for you group (last 14 days) takes each close's Undo from the same Q6 lookup Today's rail uses
    const sinceMs = this.now().getTime() - CLOSED_WINDOW_DAYS * 86_400_000;
    const closeUndo = await closeEntries(this.db, m.ctx.userId, new Date(sinceMs));
    // DEEP-1: every suggestion, from the model (Q9 stops at 100 rows, and the Still needed? group can pass that)
    return buildTriage(m, undefined, { sinceMs, undoOf: (id) => closeUndo.get(id) ?? closeUndo.get(uuidFor(id)) ?? null });
  }

  private triageItem(m: ReadModel, tid: string): TriageItem {
    const found = buildTriage(m).groups.flatMap((g) => g.items).find((i) => i.id === tid);
    if (found) return found;
    throw notFound('Triage item', tid);
  }

  private async triageView(tid: string, fallback: TriageItem): Promise<TriageItem> {
    const m = await this.model();
    const w = m.get('workItems', tid);
    const mo = m.get('missedOpps', tid);
    const q = m.get('mappings', tid);
    return { ...fallback, workItem: w ? hydrateItem(m, w) : fallback.workItem, missedOpp: mo ?? fallback.missedOpp, mapping: q ?? fallback.mapping };
  }

  async acceptTriage({ params, body }: I<'acceptTriage'>): Promise<Res<'acceptTriage'>> {
    let t: TriageItem | null = null;
    const r = await this.mutate({ action: 'triage.accept', summary: 'Accepted', entity: { type: 'work_item', id: params.id } }, async (w, model) => {
      t = this.triageItem(model, params.id);
      if (t.kind === 'work_item') {
        const cur = this.item(model, t.id);
        const locks = new Set(cur.userLockedFields);
        const newly: WorkItemLockableField[] = [];
        for (const k of Object.keys(body.edits ?? {})) if (ITEM_PATCH_LOCK[k]) {
          locks.add(ITEM_PATCH_LOCK[k]);
          newly.push(ITEM_PATCH_LOCK[k]);
        }
        await w.tx.update(changeSets).set({ summary: `Accepted: ${cur.title}` }).where(eq(changeSets.id, w.cs.id));
        await this.writeItem(w, model, cur, { ...cur, ...(body.edits ?? {}), state: 'open', userLockedFields: [...locks] } as WorkItemRecord, { bump: true, lock: newly });
        await logTransition(w, cur.id, cur.state, 'open', 'Accepted from triage');
      } else if (t.kind === 'missed_opp') {
        // one Claim verb: a DC request (100%, the role's DC role, the evidence), editable in Deals ▸ DCs
        await this.claimIn(w, model, t.missedOpp!);
        await w.tx.update(changeSets).set({ summary: `Claimed ${t.missedOpp!.oppName}`, entityType: 'missed_opp' }).where(eq(changeSets.id, w.cs.id));
      } else {
        const q = t.mapping!;
        if (!body.choiceId || !q.choices.some((c) => c.id === body.choiceId)) throw invalid('Pick one of the choices (choiceId)', { choices: q.choices });
        await w.tx.update(changeSets).set({ summary: `Mapped ${q.subject.label}`, entityType: 'triage_mapping' }).where(eq(changeSets.id, w.cs.id));
        await writeMapping(w, { ...q, status: 'answered', answerId: body.choiceId });
      }
    });
    return { entity: await this.triageView(params.id, t!), auditId: r.auditId };
  }

  async dismissTriage({ params, body }: I<'dismissTriage'>): Promise<Res<'dismissTriage'>> {
    let t: TriageItem | null = null;
    const r = await this.mutate({ action: 'triage.dismiss', summary: 'Dismissed', entity: { type: 'work_item', id: params.id } }, async (w, model) => {
      t = this.triageItem(model, params.id);
      const now = w.now.toISOString();
      await w.tx.update(changeSets).set({ summary: `Dismissed: ${t.title}`, entityType: t.kind === 'work_item' ? 'work_item' : t.kind === 'missed_opp' ? 'missed_opp' : 'triage_mapping' }).where(eq(changeSets.id, w.cs.id));
      if (t.kind === 'work_item') {
        const cur = this.item(model, t.id);
        await this.writeItem(w, model, cur, { ...cur, state: 'dismissed', dismissed: { reason: 'other', note: body.note ? `${body.reason}: ${body.note}` : body.reason, at: now } }, { bump: true });
        await logTransition(w, cur.id, cur.state, 'dismissed', body.reason);
      } else if (t.kind === 'missed_opp') await updateFinding(w, t.missedOpp!, { ...t.missedOpp!, status: 'dismissed', dismissReason: body.reason });
      else await writeMapping(w, { ...t.mapping!, status: 'dismissed' });
    });
    return { entity: await this.triageView(params.id, t!), auditId: r.auditId };
  }

  /**
   * DEEP-1 backfill (no rescan): open work that was already over 30 days old when first seen (the rule new asks land
   * by, src/engines/still-needed.ts) moves to Triage's "Still needed?" group. Only items you never touched (no
   * transition or edit of yours); work due after it was first seen stays open. One change set (actor system, undoable
   * as a whole). `apply: false` counts only.
   */
  async stillNeededBackfill(opts: { apply: boolean }): Promise<{ candidates: number; moved: number; auditId: string | null }> {
    const userId = await this.userId();
    const rows = await this.db
      .execute<{ id: string; created_at: Date; due_at: Date | null; origin_at: Date | null }>(sql`
        select wi.id, wi.created_at, wi.due_at,
               (select max(s.occurred_at) from work_item_evidence e join source_items s on s.id = e.source_item_id
                 where e.work_item_id = wi.id and e.role = 'origin') as origin_at
          from work_items wi
         where wi.owner_user_id = ${userId} and wi.status in ('open', 'in_progress', 'waiting_on_me')
           and not exists (select 1 from work_item_transitions t where t.work_item_id = wi.id and t.actor_kind = 'user')
           and not exists (select 1 from change_sets c where c.owner_user_id = ${userId} and c.actor_kind = 'user'
                             and c.entity_type in ('work_item', 'work_items') and c.entity_id = wi.id::text)`)
      .then((r) => r.rows);
    const stale = rows.filter((r) => r.origin_at && staleOnArrival({ originAt: new Date(r.origin_at).getTime(), firstSeenAt: new Date(r.created_at).getTime(), dueAt: r.due_at ? new Date(r.due_at).getTime() : null }));
    if (!opts.apply || !stale.length) return { candidates: stale.length, moved: 0, auditId: null };
    let moved = 0;
    const r = await this.mutate({ action: 'items.still_needed', summary: `${stale.length} old asks moved to Triage: still needed?`, actor: 'system' }, async (w, model) => {
      for (const row of stale) {
        const cur = model.get('workItems', row.id);
        if (!cur || !['open', 'in_progress', 'waiting_on_me'].includes(cur.state)) continue;
        const reason = stillNeededReason(new Date(row.origin_at!).getTime(), new Date(row.created_at).getTime(), 'backfill:DEEP-1');
        await this.writeItem(w, model, cur, { ...cur, state: 'suggested', closedReason: reason }, { bump: true });
        await logTransition(w, cur.id, cur.state, 'suggested', reason);
        moved++;
      }
    });
    for (const t of ['today', 'home', 'triage', 'items'] as const) this.bus.publish({ topic: t, ids: [], reason: 'items.still_needed' });
    return { candidates: stale.length, moved, auditId: r.auditId };
  }

  /**
   * SETTLE-1: apply Settle decisions (src/engines/settle/policy.ts). One engine change set per item, so each close
   * has its own Undo in the Auto-closed list. The cited message is linked as evidence (provenance) and the
   * transition does not cite it (Undo deletes the evidence first; a nulled transition would trip the append-only
   * guard). An item whose state moved since it was judged is skipped.
   */
  async settleApply(
    entries: Array<{ itemId: string; expectedState: string; action: 'close' | 'ask_looks_done' | 'ask_still_needed' | 'reopen' | 'wait'; reasonClass: ClosingReason | null; resolution?: Resolution; reason: string; verdict: string; confidence: number; check: string; cite?: { sourceItemId?: string; url?: string; byName?: string; fromMe?: boolean; at?: string }; duplicateOf?: string }>,
  ): Promise<{ applied: Record<string, number>; skipped: number; auditIds: Record<string, string> }> {
    const applied: Record<string, number> = {};
    const auditIds: Record<string, string> = {};
    let skipped = 0;
    for (const e of entries) {
      const summary = e.action === 'close' ? 'Closed for you' : e.action === 'reopen' ? 'Still yours: back to open work' : e.action === 'wait' ? 'Waiting on them: in Chase' : e.action === 'ask_looks_done' ? 'Looks done: confirm' : 'Still needed?';
      try {
        const r = await this.mutate({ action: `settle.${e.action}`, summary, entity: { type: 'work_item', id: e.itemId }, actor: 'engine' }, async (w, model) => {
          const cur = model.get('workItems', e.itemId);
          if (!cur || cur.state !== e.expectedState) return false;
          await w.tx.update(changeSets).set({ summary: `${summary}: ${cur.title}` }).where(eq(changeSets.id, w.cs.id));
          const now = w.now.toISOString();
          let evId: string | null = null;
          if (e.cite?.sourceItemId) {
            const role = e.verdict === 'done_by_you' || e.verdict === 'resolved_by_other' || e.verdict === 'handed_off' ? 'completion' : e.verdict === 'waiting_on_them' ? 'progress' : 'context';
            const ins = await w.tx
              .insert(workItemEvidence)
              .values({ workItemId: uuidFor(cur.id), sourceItemId: e.cite.sourceItemId, role, confidence: Math.max(0, Math.min(1, e.confidence)), extractorId: w.extractorId, rationale: `settle: ${e.verdict}: ${e.reason}`.slice(0, 500), createdBy: 'engine' })
              .onConflictDoNothing()
              .returning({ id: workItemEvidence.id });
            evId = ins[0]?.id ?? null;
          }
          let next: WorkItemRecord;
          if (e.action === 'close') {
            const person = e.resolution === 'done_by_other' || e.resolution === 'handed_off' ? (e.cite && !e.cite.fromMe ? e.cite.byName : undefined) : undefined;
            const resolution: Resolution = e.resolution === 'handed_off' && !person ? 'done_by_me' : (e.resolution ?? 'done_by_me');
            next = {
              ...cur,
              state: 'done',
              doneAt: now,
              doneBy: 'engine',
              closedReason: e.reason,
              likelyDone: null,
              waiting: null,
              snoozedUntil: null,
              resolution,
              resolutionDetail: {
                inferred: true,
                note: e.reason,
                ...(evId ? { evidenceIds: [evId] } : {}),
                ...(person ? { personName: person } : {}),
                ...(e.duplicateOf && (resolution === 'duplicate' || resolution === 'superseded') && model.get('workItems', e.duplicateOf) ? { relatedItemId: e.duplicateOf } : {}),
                ...(e.reasonClass ? { settle: { reason: e.reasonClass, confidence: e.confidence, ...(e.cite?.url ? { sourceUrl: e.cite.url } : {}), check: e.check } } : {}),
              },
              loopedBackIn: null,
            };
          } else if (e.action === 'ask_looks_done') {
            next = { ...cur, state: 'likely_done', likelyDone: { reason: e.reason, evidenceId: evId } };
          } else if (e.action === 'wait') {
            next = { ...cur, state: 'waiting_on_others', closedReason: null, likelyDone: null, waiting: { on: 'others', reason: e.reason, since: e.cite?.at ?? now } };
          } else if (e.action === 'ask_still_needed') {
            next = { ...cur, state: 'suggested', closedReason: `${e.reason}: ${STILL_NEEDED_MARK} (settle)` };
          } else {
            next = { ...cur, state: 'open', closedReason: null };
          }
          await this.writeItem(w, model, cur, next, { bump: true });
          await logTransition(w, cur.id, cur.state, next.state, e.action === 'close' ? `Closed for you · ${e.reason}` : e.action === 'ask_looks_done' ? `Likely done: ${e.reason}` : e.action === 'wait' ? `Waiting on them · ${e.reason}` : e.reason);
          return true;
        });
        if (r.result) {
          applied[e.action] = (applied[e.action] ?? 0) + 1;
          auditIds[e.itemId] = r.auditId;
        } else skipped += 1;
      } catch {
        skipped += 1;
      }
    }
    if (Object.keys(applied).length) for (const t of ['today', 'home', 'triage', 'items'] as const) this.bus.publish({ topic: t, ids: Object.keys(auditIds), reason: 'settle.apply' });
    return { applied, skipped, auditIds };
  }

  async mergeTriage({ params, body }: I<'mergeTriage'>): Promise<Res<'mergeTriage'>> {
    let t: TriageItem | null = null;
    const r = await this.mutate({ action: 'triage.merge', summary: 'Merged', entity: { type: 'work_item', id: params.id } }, async (w, model) => {
      t = this.triageItem(model, params.id);
      if (t.kind !== 'work_item') throw invalid('Only work items can be merged');
      const src = this.item(model, t.id);
      const into = this.item(model, body.intoId);
      if (src.id === into.id) throw invalid('Cannot merge an item into itself');
      await w.tx.update(changeSets).set({ summary: `Merged "${src.title}" into "${into.title}"` }).where(eq(changeSets.id, w.cs.id));
      let moved = 0;
      for (const e of model.all('evidence')) if (e.workItemId === src.id) {
        await updateEvidence(w, e, { ...e, workItemId: into.id, isNew: true }, into.seenAt);
        moved++;
      }
      await this.writeItem(w, model, src, { ...src, state: 'dismissed', dismissed: { reason: 'other', note: `Merged into ${into.title}`, at: w.now.toISOString() } }, { bump: true });
      await logTransition(w, src.id, src.state, 'dismissed', `Merged into ${into.title}`);
      await this.writeItem(w, model, into, { ...into, newEvidenceCount: into.newEvidenceCount + Math.max(1, moved), sources: [...into.sources, ...src.sources.filter((s) => !into.sources.some((x) => x.label === s.label))] }, { bump: true });
    });
    const m = await this.model();
    return { entity: await this.triageView(params.id, t!), auditId: r.auditId, receipt: await receiptFromChangeSet(this.db, r.auditId, m, 'user', 'Merged', this.now().toISOString()) };
  }

  // =========================================================================
  // Health
  // =========================================================================

  async getHealth(_i: I<'getHealth'>): Promise<Res<'getHealth'>> {
    const m = await this.model();
    // PERF-1: queued + retrying (jobStatusFromDb: 'retrying' is a queued job after a failure), counted in SQL
    const [depth] = await this.db.execute<{ n: number }>(sql`select count(*)::int as n from jobs where owner_user_id = ${m.ctx.userId} and status = 'queued'`).then((r) => r.rows);
    const [hb] = await this.db.execute<{ at: Date | null }>(sql`select max(last_beat_at) as at from worker_instances where stopped_at is null`).then((r) => r.rows).catch(() => [{ at: null }]);
    const last = hb?.at ? new Date(hb.at) : null;
    // lane E (E1): the worker's open "waiting for the schema" event (it is global: any owner, or none yet)
    const [wait] = await this.db
      .execute<{ message: string; fix: string | null; since: Date | string }>(sql`
        select message, detail->>'suggestedAction' as fix, first_occurred_at as since from app_events
         where fingerprint = ${SCHEMA_EVENT_FINGERPRINT} and resolved_at is null order by id desc limit 1`)
      .then((r) => r.rows)
      .catch(() => []);
    const health: Res<'getHealth'> = {
      connectors: m.all('connectors'),
      summary: healthSummary(m),
      spend: m.spend(),
      worker: {
        alive: !!last && Date.now() - last.getTime() < 120_000,
        lastHeartbeatAt: last ? last.toISOString() : null,
        queueDepth: depth?.n ?? 0,
        blocked: wait ? { message: wait.message, fix: wait.fix ?? null, since: new Date(wait.since).toISOString() } : null,
      },
      dryRun: m.settings().sending.dryRun,
      // AUDIT: a live install's first-scan progress per scope (a seeded database has no first scan).
      firstScan: (m.meta() as { seedHash?: string }).seedHash ? null : await loadFirstScanProgress(this.db, await this.userId()).catch(() => null),
      // D-60: "VDP autopilot is paused: re-auth VDP" while it is on and VDP's sign-in lapsed
      vdpAutopilot: autopilotHealth(await this.vdpAutopilotInputs(m)),
    };
    // D-55: a source the persona has not activated has no Health row (it is listed in Settings ▸ Role & rules)
    return healthForPersona(health, personaOf(m.settings()));
  }

  async getSpendAudit({ query }: I<'getSpendAudit'>): Promise<Res<'getSpendAudit'>> {
    const m = await this.model();
    const timezone = m.settings().profile.timezone;
    // A seeded database has no ledger: like Health's spend, it shows the seed's numbers (mock parity).
    if ((m.meta() as { seedHash?: string }).seedHash) return mockSpendAudit(m.spend(), query ?? {}, { now: this.now(), timezone });
    return loadSpendAudit(this.db, await this.userId(), query ?? {}, { now: this.now(), timezone });
  }

  async getSpendAuditDetail({ query }: I<'getSpendAuditDetail'>): Promise<Res<'getSpendAuditDetail'>> {
    const m = await this.model();
    if ((m.meta() as { seedHash?: string }).seedHash) return mockSpendAuditDetail(m.spend(), query);
    return loadSpendAuditDetail(this.db, await this.userId(), query);
  }

  async getReadme(_i: I<'getReadme'>): Promise<Res<'getReadme'>> {
    return readReadme();
  }

  async getGuide(_i: I<'getGuide'>): Promise<Res<'getGuide'>> {
    const m = await this.model();
    const settings = m.settings();
    const userId = await this.userId();
    // what the user typed to the Assistant (assistant replies and tool turns don't count)
    const [chat] = await this.db
      .execute<{ n: number }>(sql`select count(*)::int as n from chat_messages cm join chat_threads ct on ct.id = cm.thread_id where ct.owner_user_id = ${userId} and cm.role = 'user'`)
      .then((r) => r.rows)
      .catch(() => [{ n: 0 }]);
    const seeded = Boolean((m.meta() as { seedHash?: string }).seedHash);
    return guidePayload({
      connectors: m.all('connectors'),
      drafts: m.all('drafts'),
      assistantMessages: chat?.n ?? 0,
      firstScan: seeded ? null : await loadFirstScanProgress(this.db, userId).catch(() => null),
      persona: personaOf(settings),
      personaVersion: settings.persona.version,
      guide: settings.guide,
    });
  }

  async getVersion(_i: I<'getVersion'>): Promise<Res<'getVersion'>> {
    const m = await this.model();
    // drizzle records each applied migration's journal `when` as created_at (bigint → text over the wire)
    const [mig] = await this.db.execute<{ at: string | null }>(sql`select max(created_at)::text as at from drizzle.__drizzle_migrations`).then((r) => r.rows).catch(() => [{ at: null }]);
    // the live worker: the newest instance still beating (a crashed one never set stopped_at, so it has to be recent too)
    const [w] = await this.db
      .execute<{ v: string }>(sql`select app_version as v from worker_instances where role = 'worker' and stopped_at is null and last_beat_at > now() - interval '5 minutes' order by last_beat_at desc limit 1`)
      .then((r) => r.rows)
      .catch(() => []);
    return versionPayload({ build: buildInfo(), migration: migrationTagFor(mig?.at ? Number(mig.at) : null), persona: personaOf(m.settings()), workerVersion: w?.v ?? null, dataSource: 'db' });
  }

  async reauthConnector({ params }: I<'reauthConnector'>): Promise<Res<'reauthConnector'>> {
    const m0 = await this.model();
    const c = m0.get('connectors', params.id);
    if (!c) throw notFound('Connector', params.id);
    const action = c.reauth ?? { kind: 'instructions' as const, label: 'No re-auth needed', command: null, instructions: `${c.label} does not need re-auth` };
    const started = action.kind === 'in_app' || action.kind === 'refresh_script' || action.kind === 'terminal_command';
    if (started) {
      await this.mutate({ action: 'connector.reauth', summary: `Re-auth started: ${c.label}`, entity: { type: 'connector', id: c.id }, undoable: false }, async (w, model) => {
        const cur = model.get('connectors', c.id)!;
        await updateConnector(w, cur, { ...cur, state: 'catching_up', since: w.now.toISOString(), catchUpPct: 0, impact: `Catching up ${cur.label}…` });
        // the worker starts the sign-in (VDP: the refresh script; MFA opens Terminal and a browser), then re-probes
        // until it works: 8 tries with backoff outlast a slow MFA (src/reauth/run.ts)
        await enqueueJob(w.tx, { ownerUserId: w.userId, kind: 'connector.reauth', payload: { connectorId: c.id, kind: action.kind }, dedupeKey: `reauth:${c.id}`, maxAttempts: 8 });
      });
      this.bus.publishTables(['jobs'], [c.id], 'connector.reauth');
    }
    return { connector: (await this.model()).get('connectors', c.id)!, action, started };
  }

  async scanConnector({ params, body }: I<'scanConnector'>): Promise<Res<'scanConnector'>> {
    const { run, auditId } = await this.scanInternal(params.id, body.scope ?? 'manual', 'user');
    return { entity: run, auditId };
  }

  /**
   * Health "Rescan" (and the old chat-ops scan): a queued placeholder run the UI shows at once, plus a real manual
   * RuntimeJob on the Postgres queue (as BE-CHAT's `rescan()`), linked by `scan_runs.job_id`. The worker's first
   * run of that job adopts the placeholder, so the UI sees ONE run going queued → running → done. Before, the job
   * carried `{connectorId, scanRunId, scope}`, which the worker's scan handler rejected (`bad_payload`), and the
   * placeholder stayed queued forever. A connector that needs re-auth fails at once (`auth_failed`, no job).
   */
  private async scanInternal(connectorId: string, scope: string, actor: 'user' | 'chat') {
    const scanId = crypto.randomUUID();
    // HYG-1: the scope is checked against the connector's real scope list before anything is written. An optional
    // `<connector>:` prefix is dropped once (`org62:events` = `events`); anything else unknown is a 400 that lists the
    // valid scopes. Before, `org62:events` ran as `org62:org62:events`, read nothing and said succeeded.
    const [row0] = await this.db
      .select({ name: connectors.name, kind: connectors.kind })
      .from(connectors)
      .where(and(eq(connectors.id, uuidFor(connectorId)), eq(connectors.ownerUserId, await this.userId())))
      .limit(1);
    if (!row0) throw notFound('Connector', connectorId);
    const runtime = connectorOfName(row0.name) ?? connectorOfName(row0.kind);
    // chat's `/rescan slack 2d` (ChatOps.scan) labels its scope `chat:<window>`: the connector's default scope(s)
    const check = runtime && !(actor === 'chat' && scope.startsWith('chat:')) ? normalizeScanScope(runtime, scope) : ({ ok: true, scope: null } as const);
    if (!check.ok) throw invalid(`Unknown scope "${check.scope}" for ${row0.name}. Valid scopes: ${check.valid.join(', ')}`, { scope: check.scope, valid: check.valid });
    const r = await this.mutate({ action: actor === 'chat' ? 'chat.scan' : 'connector.scan', summary: 'Scan', entity: { type: 'connector', id: connectorId }, undoable: false, actor }, async (w, model) => {
      const c = model.get('connectors', connectorId);
      if (!c) throw notFound('Connector', connectorId);
      const now = w.now.toISOString();
      const authBroken = c.state === 'auth_needed';
      const [row] = await w.tx.select({ name: connectors.name }).from(connectors).where(eq(connectors.id, uuidFor(c.id))).limit(1);
      const byName = row ? RESCAN_BY_NAME[row.name.toLowerCase()] : undefined;
      const all = byName !== undefined ? (byName ?? []) : RESCAN_SCOPE[c.source] ? [RESCAN_SCOPE[c.source]!] : [];
      // one named scope runs alone (Trainings `gmail` runs its Gmail half only); no scope runs the connector's default(s)
      const targets = check.scope && all.length ? [{ connector: all[0]!.connector, scope: check.scope }] : all;
      const target = targets[0];
      const window = rescanWindow(c.cursor.at, w.now);
      await w.tx.update(changeSets).set({ summary: `Scan ${c.label}` }).where(eq(changeSets.id, w.cs.id));
      await insertScanRun(w, {
        id: scanId,
        connectorId: c.id,
        // the ledger's scope id (`<connector>:<scope>`), as the worker's run writes it: never a bare `dcs` or `manual`
        scope: target ? `${target.connector}:${target.scope}` : runtime ? placeholderScopeId(runtime, check.scope) : scope,
        kind: 'manual',
        windowStart: c.cursor.at ?? now,
        windowEnd: now,
        status: authBroken ? 'auth_failed' : 'queued',
        startedAt: now,
        endedAt: authBroken ? now : null,
        itemsSeen: 0,
        itemsNew: 0,
        itemsChanged: 0,
        costUsd: 0,
        model: c.source === 'slack' || c.source === 'org62' ? 'haiku' : null,
        error: authBroken ? `${c.label} needs re-auth` : null,
      });
      if (!authBroken && target && target.connector === 'org62' && target.scope === ORG62_READBACK_SCOPE) {
        // Health ▸ Org62 ▸ "Re-check Org62 records": the read-back reconcile job (re-reads my logged Events and DCs by Id)
        const job = await enqueueOrg62Readback(w.tx, w.userId, { trigger: actor === 'chat' ? 'chat' : 'manual' });
        await w.tx.execute(sql`update scan_runs set job_id = ${job.id} where id = ${scanId}`);
      } else if (!authBroken && target) {
        const trigger = actor === 'chat' ? 'chat' : 'manual';
        const job = scanJob({ connector: target.connector, scope: target.scope, window, mode: 'manual', trigger, runAt: now });
        const more = targets.slice(1).map((t) => scanJob({ connector: t.connector, scope: t.scope, window, mode: 'manual', trigger, runAt: now }));
        await new PgRuntimeJobQueue(this.db, w.userId).enqueue([job, ...more], w.tx);
        const [row] = await w.tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.ownerUserId, w.userId), eq(jobs.dedupeKey, job.dedupeKey), eq(jobs.status, 'queued'))).orderBy(desc(jobs.id)).limit(1);
        if (!row) throw new AppError('internal', 'scan job was not enqueued');
        await w.tx.execute(sql`update scan_runs set job_id = ${row.id} where id = ${scanId}`);
      } else if (!authBroken) {
        await w.tx.execute(sql`update scan_runs set status = 'cancelled', finished_at = ${now}::timestamptz, error_message = ${`${c.label} has no scanner`} where id = ${scanId}`);
      }
    });
    this.bus.publishTables(['scan_runs', 'jobs'], [scanId], actor === 'chat' ? 'chat.scan' : 'connector.scan');
    const m = await this.model(this.db, !this.fixedUser, true);
    return { run: m.get('scanRuns', scanId)!, auditId: r.auditId };
  }

  // PERF-1: the scan ledger and the jobs list read their own table, not the whole read model
  async getScans({ query }: I<'getScans'>): Promise<Res<'getScans'>> {
    const runs = await loadScanRuns({ db: this.db, userId: await this.userId() });
    return { runs: runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, query.limit) };
  }

  async getJobs(_i: I<'getJobs'>): Promise<Res<'getJobs'>> {
    // MIN-28: succeeded and cancelled come as the latest JOBS_FINISHED_LIMIT (and each kind's newest); counts are full
    const rc = { db: this.db, userId: await this.userId() };
    const [list, counts] = await Promise.all([loadJobs(rc, { finishedLimit: JOBS_FINISHED_LIMIT }), countJobs(rc)]);
    return { jobs: list.sort((a, b) => b.runAt.localeCompare(a.runAt)), counts };
  }

  async retryJob({ params }: I<'retryJob'>): Promise<Res<'retryJob'>> {
    const r = await this.mutate({ action: 'job.retry', summary: 'Requeued', entity: { type: 'job', id: params.id }, ops: true }, async (w, model) => {
      const j = model.get('jobs', params.id);
      if (!j) throw notFound('Job', params.id);
      if (!['dead', 'cancelled', 'retrying'].includes(j.status)) throw invalid(`Job is ${j.status}`);
      // B3: a delivery is never re-run from here (it may have reached the destination): the item's own Apply checks first
      if (j.type.startsWith('outbox.')) throw invalid('An Outbox delivery is never re-run from Health: open the item, check the destination, and Apply it again from there');
      await w.tx.update(changeSets).set({ summary: `Requeued ${j.type}` }).where(eq(changeSets.id, w.cs.id));
      await requeueJob(w, j.id);
    });
    this.bus.publishTables(['jobs'], [params.id], 'job.retry');
    // jobs is not an audited table, so a requeue has no undo (auditId null)
    return { entity: (await this.model(this.db, !this.fixedUser, true)).get('jobs', params.id)!, auditId: r.undoable ? r.auditId : null };
  }

  async getEventLog(_i: I<'getEventLog'>): Promise<Res<'getEventLog'>> {
    const m = await this.model();
    const entries = m.all('eventLog').sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    return { entries, unacknowledged: entries.filter((e) => !e.acknowledged).length };
  }

  async ackEvent({ params }: I<'ackEvent'>): Promise<Res<'ackEvent'>> {
    const r = await this.mutate({ action: 'event.ack', summary: 'Acknowledged', entity: { type: 'event_log', id: params.id } }, async (w, model) => {
      const e = model.get('eventLog', params.id);
      if (!e) throw notFound('Event', params.id);
      await w.tx.update(changeSets).set({ summary: `Acknowledged ${e.code}` }).where(eq(changeSets.id, w.cs.id));
      await ackEventRow(w, e.id);
    });
    this.bus.publishTables(['app_events'], [params.id], 'event.ack');
    // app_events is not an audited table, so an acknowledgement has no undo (auditId null)
    return { entity: (await this.model()).get('eventLog', params.id)!, auditId: r.undoable ? r.auditId : null };
  }

  // =========================================================================
  // Settings and policy
  // =========================================================================

  async getSettings(_i: I<'getSettings'>): Promise<Res<'getSettings'>> {
    return (await this.model()).settings();
  }

  async patchSettings({ params, body }: I<'patchSettings'>): Promise<Res<'patchSettings'>> {
    const section = params.section as Section;
    // D-55: a persona switch reranks under the new role's starter policy (ranked before the change set)
    const rankedIds = section === 'persona' ? await this.rankedIds() : [];
    const r = await this.mutate({ action: `settings.${section}`, summary: `Saved ${section} settings`, entity: { type: 'settings', id: section }, current: async () => (await this.model()).settings() }, async (w, model) => {
      const s = model.settings();
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
        const t = value.today as { softUsd: number; hardUsd: number } | null | undefined;
        if (t && t.softUsd > t.hardUsd) throw invalid("Today's soft budget cannot exceed today's hard cap");
      }
      const merged = section === 'sending' ? mergeSendingPatch(s.sending, value) : section === 'time' ? { ...cur, ...value, onsiteHours: { ...s.time.onsiteHours, ...((value.onsiteHours as object | undefined) ?? {}) } } : { ...cur, ...value };
      const next: Settings = { ...s, [section]: { ...merged, version: cur.version + 1 } };
      await writeSection(w, section, next[section]);
      if (section === 'persona' && personaSwitched(s, next)) {
        // D-55: the new role's starter policy as a new version, and the record-type cache cleared; Undo reverts all
        const at = this.now().toISOString();
        const { policy, obligation } = reseededPolicy(s.policy, personaOf(next), at);
        const rowId = await insertPolicyVersion(w, policy, { at, by: 'user', note: policy.note ?? 'Role pack', activate: true, changeSetId: w.cs.id, obligation });
        await this.rerankIn(w, model, policy, rankedIds, this.now(), rowId);
        const time = timeWithoutRecordType(s.time);
        if (time) await writeSection(w, 'time', time);
        for (const k of [...w.kv.keys()].filter(isRecordTypeKv)) await writeKv(w, k, null);
      }
      if (section === 'budgets') {
        const sp = model.spend();
        const eff = budgetsForDay(next.budgets, localDayOf(this.now().getTime(), s.profile.timezone));
        const pct = eff.softUsd > 0 ? Math.round((sp.today.usd / eff.softUsd) * 100) : 0;
        await writeSpend(w, { ...sp, today: { ...sp.today, softBudgetUsd: eff.softUsd, hardCapUsd: eff.hardUsd, pct }, state: sp.today.usd >= eff.hardUsd ? 'capped' : pct >= next.budgets.alertPct ? 'soft_alert' : 'ok' });
      }
    });
    // Settings ▸ Time changes what onsite days log: the recent weeks (and the next one) recompute in the background
    if (section === 'time') {
      const now = this.now();
      const days = Array.from({ length: 8 }, (_, i) => new Date(now.getTime() + (1 - i) * 7 * 86_400_000).toISOString().slice(0, 10));
      void this.userId()
        .then((userId) => recomputeWeeks({ db: this.db, userId, days, now }))
        .then(() => this.bus.publishTables(['activity_entries'], [], 'settings.time'))
        .catch(() => undefined);
    }
    return { entity: (await this.model()).settings(), auditId: r.auditId };
  }

  /** "Raise today's cap" with a reason: today's override goes up and the raise is kept (raiseBudgetToday, contract). */
  async raiseBudgetToday({ body }: I<'raiseBudgetToday'>): Promise<Res<'raiseBudgetToday'>> {
    const raiseIn = (s: Settings) => {
      try {
        return raiseBudgetToday(s.budgets, body, localDayOf(this.now().getTime(), s.profile.timezone), this.now().toISOString());
      } catch (e) {
        throw invalid(e instanceof Error ? e.message : String(e));
      }
    };
    const first = raiseIn((await this.model()).settings()).raise;
    const r = await this.mutate({ action: 'settings.budgets', summary: raiseSummary(first), entity: { type: 'settings', id: 'budgets' }, current: async () => (await this.model()).settings() }, async (w, model) => {
      const { next: budgets, raise } = raiseIn(model.settings());
      await writeSection(w, 'budgets', budgets);
      const sp = model.spend();
      const pct = raise.toSoftUsd > 0 ? Math.round((sp.today.usd / raise.toSoftUsd) * 100) : 0;
      await writeSpend(w, { ...sp, today: { ...sp.today, softBudgetUsd: raise.toSoftUsd, hardCapUsd: raise.toHardUsd, pct }, state: sp.today.usd >= raise.toHardUsd ? 'capped' : pct >= budgets.alertPct ? 'soft_alert' : 'ok' });
    });
    return { entity: (await this.model()).settings().budgets, auditId: r.auditId };
  }

  private proposedPolicy(m: ReadModel, weights?: PolicyWeights, rules?: PolicyRule[]): PriorityPolicy {
    const pol = m.settings().policy;
    return { ...pol, weights: weights ?? pol.weights, rules: rules ?? pol.rules };
  }

  private preview(m: ReadModel, ordered: WorkItemRecord[], policy: PriorityPolicy): PolicyPreview {
    return this.ranker.preview(m, ordered, policy, this.now());
  }

  async previewPolicy({ body }: I<'previewPolicy'>): Promise<Res<'previewPolicy'>> {
    const m = await this.model();
    const ordered = storedOrderFrom(m, await this.rankedIds());
    return this.preview(m, ordered, this.proposedPolicy(m, body.weights as PolicyWeights | undefined, body.rules));
  }

  private async applyPolicyInternal(weights: PolicyWeights, rules: PolicyRule[], note: string, by: 'user' | 'chat' | 'system', ifVersion: number) {
    const now = this.now();
    const rankedIds = await this.rankedIds();
    let policy: PriorityPolicy | null = null;
    let changed = 0;
    const r = await this.mutate({ action: 'policy.apply', summary: 'Policy applied', entity: { type: 'policy', id: 'policy' }, current: async () => (await this.model()).settings().policy }, async (w, model) => {
      const s = model.settings();
      this.checkVersion(s.policy, ifVersion, 'Priority policy', s.policy);
      const pol: PriorityPolicy = { ...s.policy, version: s.policy.version + 1, weights, rules, updatedAt: now.toISOString(), note };
      policy = pol;
      await w.tx.update(changeSets).set({ summary: `Policy v${pol.version}: ${note}`, entityId: pol.id }).where(eq(changeSets.id, w.cs.id));
      const rowId = await insertPolicyVersion(w, pol, { at: now.toISOString(), by, note, activate: true, changeSetId: w.cs.id });
      const res = await this.rerankIn(w, model, pol, rankedIds, now, rowId);
      changed = res.result.changed;
    });
    const m = await this.model();
    const receipt = await receiptFromChangeSet(this.db, r.auditId, m, by === 'chat' ? 'chat' : 'user', `Policy v${policy!.version} applied: ${changed} of the Top 10 moved`, now.toISOString(), (table, field) => (table === 'work_items' ? field === 'rank' : table === 'priority_policies'));
    return { policy: m.settings().policy, auditId: r.auditId, receipt };
  }

  async applyPolicy({ body }: I<'applyPolicy'>): Promise<Res<'applyPolicy'>> {
    const r = await this.applyPolicyInternal(body.weights as PolicyWeights, body.rules, body.note ?? 'Edited in Settings', 'user', body.ifVersion);
    return { entity: r.policy, auditId: r.auditId, receipt: r.receipt };
  }

  async revertPolicy({ body }: I<'revertPolicy'>): Promise<Res<'revertPolicy'>> {
    const m = await this.model();
    const target = m.get('policyVersions', String(body.toVersion));
    if (!target) throw notFound('Policy version', String(body.toVersion));
    const r = await this.applyPolicyInternal(target.policy.weights, target.policy.rules, `Reverted to v${body.toVersion}`, 'user', body.ifVersion);
    return { entity: r.policy, auditId: r.auditId, receipt: r.receipt };
  }

  async getPolicyVersions(_i: I<'getPolicyVersions'>): Promise<Res<'getPolicyVersions'>> {
    const m = await this.model();
    return { current: m.settings().policy.version, versions: m.all('policyVersions').sort((a, b) => b.version - a.version) };
  }

  // =========================================================================
  // Universal
  // =========================================================================

  /**
   * Universal undo = undoChangeSet (BE-0), inside one outer transaction together with the draft-body
   * restore: doc_json is kept out of the audit images, so a change set that saved a draft revision gets
   * the previous revision back (content_revisions, W5). Undoing an undo is redo.
   */
  async undoAudit({ params }: I<'undoAudit'>): Promise<Res<'undoAudit'>> {
    const userId = await this.userId();
    const m0 = await this.model();
    const target = await auditEntry(this.db, userId, params.id, m0, m0.ctx.kv);
    if (!target) throw notFound('Audit entry', params.id);
    if (!target.undoable) throw invalid('This change cannot be undone');
    if (target.undoneAt) throw invalid('Already undone');
    const now = this.now();
    let undoId = '';
    try {
      await this.db.transaction(async (outer) => {
        const policyRows = await shiftPolicyVersionNumbers(outer, userId, params.id);
        const res = await undoChangeSet(params.id, { db: outer as unknown as Db, actor: actors.user('undo'), reason: `Undo: ${target.summary}` });
        undoId = res.changeSetId;
        await outer.update(changeSets).set({ createdAt: now }).where(eq(changeSets.id, undoId));
        await this.restoreRevisions(outer, userId, params.id, undoId, now);
        await restorePolicyVersionNumbers(outer, userId, policyRows);
      });
    } catch (e) {
      // Redo of an undone policy apply: the rankings computed under that policy version went with it
      // (derived, unaudited output, migration 0006), so the score pointers it would restore are gone.
      if (e instanceof ConstraintViolationError && e.constraint === 'work_items_priority_score_id_priority_scores_id_fk') {
        throw new AppError('conflict', 'This re-rank can’t be redone: its scores were discarded with the undone policy version. Re-apply the policy from Settings ▸ Policy instead.', { current: target, reason: 'not_restorable' });
      }
      throw toAppError(e, target);
    }
    const m = await this.model();
    // an onsite correction (or its redo) moved the overrides: the weeks it touches recompute now (onsite lane)
    const before = readOnsiteOverrides(m0.ctx.kv);
    const after = readOnsiteOverrides(m.ctx.kv);
    if (canon(before) !== canon(after)) {
      const touched = [...before.days, ...after.days].map((d) => d.day).concat([...before.trips, ...after.trips].flatMap((t) => daysBetween(t.from, t.to)));
      await recomputeWeeks({ db: this.db, userId, days: [...new Set(touched)], now });
    }
    const entry = (await auditEntry(this.db, userId, undoId, m, m.ctx.kv))!;
    return { entity: entry, auditId: entry.id, receipt: await receiptFromChangeSet(this.db, undoId, m, 'user', `Undid: ${target.summary}`, now.toISOString()) };
  }

  private async restoreRevisions(tx: Tx, userId: string, targetId: string, undoId: string, now: Date) {
    const revs = await tx.select().from(contentRevisions).where(and(eq(contentRevisions.changeSetId, targetId), eq(contentRevisions.entityType, 'drafts'), eq(contentRevisions.field, 'doc_json')));
    if (!revs.length) return;
    await withChangeSet({ db: tx as unknown as Db, userId, actor: actors.user('undo.revision'), reason: 'Restore draft body', undoable: false }, async (t2) => {
      for (const rev of revs) {
        const [cur] = await t2.select({ doc: draftsTable.docJson }).from(draftsTable).where(eq(draftsTable.id, rev.entityId));
        if (!cur) continue;
        if (JSON.stringify(cur.doc) !== JSON.stringify(rev.docJson)) throw new UndoConflictError(targetId, 'drafts', rev.entityId, 'changed_since');
        const [prev] = await t2
          .select()
          .from(contentRevisions)
          .where(and(eq(contentRevisions.entityType, 'drafts'), eq(contentRevisions.entityId, rev.entityId), eq(contentRevisions.field, 'doc_json'), sql`${contentRevisions.revision} < ${rev.revision}`))
          .orderBy(sql`${contentRevisions.revision} desc`)
          .limit(1);
        if (!prev?.docJson) continue;
        const doc = prev.docJson as unknown as Draft['doc'];
        await t2.update(draftsTable).set({ docJson: prev.docJson, plainText: plainText(doc), updatedAt: now }).where(eq(draftsTable.id, rev.entityId));
        const [max] = await t2.execute<{ n: number }>(sql`select coalesce(max(revision), 0)::int as n from content_revisions where entity_type = 'drafts' and entity_id = ${rev.entityId} and field = 'doc_json'`).then((x) => x.rows);
        await t2.insert(contentRevisions).values({ ownerUserId: userId, entityType: 'drafts', entityId: rev.entityId, field: 'doc_json', revision: (max?.n ?? 0) + 1, docJson: prev.docJson, contentHash: JSON.stringify(prev.docJson).length.toString(36), actorKind: 'user', editorSessionId: `undo:${undoId}`, changeSetId: undoId, closedAt: now });
      }
    });
    // re-render at the restored body (renditions are derived, unaudited)
    const { draftRenditions } = await import('@/db/schema');
    for (const rev of revs) {
      const [d] = await tx.select().from(draftsTable).where(eq(draftsTable.id, rev.entityId));
      if (!d?.docJson) continue;
      const doc = d.docJson as unknown as Draft['doc'];
      const dest = (await this.model(tx as unknown as Db)).get('drafts', d.id)?.destination;
      if (!dest) continue;
      const rendered = renderAll(dest, doc);
      for (const rr of Object.values(rendered)) {
        if (!rr) continue;
        await tx.insert(draftRenditions).values({ draftId: d.id, docVersion: d.docVersion, format: rr.format, body: rr.body, rendererVersion: 'cc-render@1', contentHash: rr.body.length.toString(36), lossy: rr.lossy.length > 0, warnings: rr.lossy }).onConflictDoUpdate({ target: [draftRenditions.draftId, draftRenditions.docVersion, draftRenditions.format], set: { body: rr.body, warnings: rr.lossy } });
      }
    }
  }

  /** ⌘K: FTS + substring over work items in SQL; the other entity types match by name in the read model. */
  async search({ query }: I<'search'>): Promise<Res<'search'>> {
    const q = query.q.trim().toLowerCase();
    if (!q) return { q: query.q, hits: [], total: 0 };
    const m = await this.model();
    const tokens = q.split(/\s+/).filter(Boolean);
    const userId = m.ctx.userId;
    const like = tokens.map((t) => or(ilike(workItems.title, `%${t}%`), ilike(workItems.purpose, `%${t}%`)));
    const fts = await this.db
      .select({ id: workItems.id, ftsHit: sql<boolean>`${workItems.searchTsv} @@ plainto_tsquery('english', ${q})` })
      .from(workItems)
      .where(and(eq(workItems.ownerUserId, userId), or(sql`${workItems.searchTsv} @@ plainto_tsquery('english', ${q})`, ...like, sql`true`)));
    const ftsIds = new Set(fts.filter((r) => r.ftsHit).map((r) => r.id));
    const hits: SearchHit[] = [];
    const score = (hay: string) => {
      const h = hay.toLowerCase();
      let s = 0;
      for (const t of tokens) if (h.includes(t)) s += h.startsWith(t) ? 2 : 1;
      return s === 0 ? 0 : s / tokens.length;
    };
    const add = (ref: EntityRef, title: string, subtitle: string | null, hay: string, extra: Partial<SearchHit> = {}, stemmed = false) => {
      let s = score(hay);
      if (s === 0 && stemmed) s = 0.5;
      if (s > 0) hits.push({ ref: { ...ref, href: ref.href ?? hrefFor(ref) }, title, subtitle, kind: null, state: null, ...extra, score: Math.round(s * 100) / 100 });
    };
    for (const w of m.all('workItems')) add(itemRef(w), w.title, w.purpose, `${w.title} ${w.purpose ?? ''} ${w.why}`, { kind: w.kind, state: w.state }, ftsIds.has(w.id));
    for (const i of m.all('initiatives')) add({ type: 'initiative', id: i.id, label: i.title }, i.title, i.purpose, `${i.title} ${i.purpose} ${i.summary}`);
    for (const a of m.all('accounts')) add({ type: 'account', id: a.id, label: a.name }, a.name, a.industry, a.name);
    for (const o of m.all('opps')) add({ type: 'opportunity', id: o.id, label: o.name }, o.name, o.stage, o.name);
    for (const p of m.all('people')) add({ type: 'person', id: p.id, label: p.name }, p.name, p.role ?? null, `${p.name} ${p.role ?? ''} ${p.title ?? ''}`);
    for (const b of m.all('briefs')) add({ type: 'brief', id: b.id, label: b.title }, b.title, 'Brief', `${b.title} ${b.summary}`);
    for (const r of m.all('agentRuns')) add({ type: 'agent_run', id: r.id, label: r.title }, r.title, r.state.replace(/_/g, ' '), r.title);
    for (const a of m.all('assets')) add({ type: 'asset', id: a.id, label: a.title, href: a.url }, a.title, a.kind, a.title);
    hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    return { q: query.q, hits: hits.slice(0, query.limit), total: hits.length };
  }

  async getSince({ query }: I<'getSince'>): Promise<Res<'getSince'>> {
    const m = await this.model();
    const since = query.ts ?? m.meta().lastActiveAt;
    return buildSince(m, await sinceEntries(this.db, m.ctx.userId, new Date(since), m, m.ctx.kv), since, this.now());
  }

  /** GET /people: @-mentions and recipient pickers (name prefix > word prefix > anywhere), as the mock. */
  async getPeople({ query }: I<'getPeople'>): Promise<Res<'getPeople'>> {
    const m = await this.model();
    const myDomain = m.meta().user.email.split('@')[1]?.toLowerCase() ?? '';
    const tokens = query.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const account = query.account ? uuidFor(query.account) : null; // like listItems: a uuid, or a seed id
    const rows = m
      .all('people')
      .filter((p) => (!account || p.accountId === account) && (query.slack === undefined || !!p.slackHandle === query.slack))
      .map((p) => {
        const account = p.accountId ? m.get('accounts', p.accountId) : undefined;
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
        const name = p.name.toLowerCase();
        const hay = `${name} ${p.email ?? ''} ${p.slackHandle ?? ''} ${p.role ?? ''} ${p.title ?? ''} ${account?.name ?? ''}`.toLowerCase();
        let score = 0;
        for (const t of tokens) {
          if (name.startsWith(t)) score += 3;
          else if (name.split(/\s+/).some((x) => x.startsWith(t))) score += 2;
          else if (hay.includes(t)) score += 1;
          else return null;
        }
        return { view, score };
      })
      .filter((r): r is { view: PersonView; score: number } => !!r)
      .sort((a, b) => b.score - a.score || a.view.name.localeCompare(b.view.name));
    return { q: query.q, people: rows.slice(0, query.limit).map((r) => r.view), total: rows.length };
  }

  // =========================================================================
  // Chat (CONTRACT-1). The backend is BE-6; threads and messages persist in chat_threads / chat_messages.
  // =========================================================================

  /**
   * CHAT-1: the default "Today" thread. Only the example seed wrote one, so a real install (a fresh first scan, a
   * teammate's bootstrap) had no thread: the client's Send had nowhere to post and did nothing, and POST /chat without
   * a thread id failed "Chat thread (default) not found". Idempotent: an advisory lock serializes concurrent callers.
   */
  /** Returns true when the model it checked had no default thread (so the caller reloads). */
  private async ensureDefaultChatThread(loaded?: ReadModel): Promise<boolean> {
    if ((loaded ?? (await this.model())).all('chatThreads').some((t) => t.thread.isDefault)) return false;
    const now = this.now().toISOString();
    const thread: ChatThread = { id: crypto.randomUUID(), title: 'Today', isDefault: true, createdAt: now, updatedAt: now, messageCount: 0, lastMessagePreview: null, context: [] };
    const { result: created } = await this.mutate({ action: 'chat.thread', summary: 'Default chat thread: Today', entity: { type: 'chat_thread', id: thread.id }, undoable: false, actor: 'system' }, async (w) => {
      await w.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cc.chat.default:${w.userId}`}))`);
      const has = await w.tx.execute(sql`select 1 from chat_threads where owner_user_id = ${w.userId} and scope = 'day' limit 1`);
      if (has.rows.length) return false;
      await insertChatThread(w, { thread, messages: [] });
      return true;
    });
    if (created) this.bus.publishTables(['chat_threads'], [thread.id], 'chat.thread');
    // True = the caller's model predates the default thread (made here or by a concurrent caller): reload it.
    return true;
  }

  async listChatThreads(_i: I<'listChatThreads'>): Promise<Res<'listChatThreads'>> {
    let m = await this.model();
    if (await this.ensureDefaultChatThread(m)) m = await this.model(); // CHAT-1: one model build unless a thread was made
    return { threads: m.all('chatThreads').map((t) => t.thread).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.updatedAt.localeCompare(a.updatedAt)) };
  }

  /** A new empty thread. Not undoable (like the mock, which does not audit it); its context rides in ext. */
  async createChatThread({ body }: I<'createChatThread'>): Promise<Res<'createChatThread'>> {
    const now = this.now().toISOString();
    const thread: ChatThread = { id: crypto.randomUUID(), title: body.title ?? NEW_THREAD_TITLE, isDefault: false, createdAt: now, updatedAt: now, messageCount: 0, lastMessagePreview: null, context: contextRefs(body.context, 'auto') };
    await this.mutate({ action: 'chat.thread', summary: `New thread: ${thread.title}`, entity: { type: 'chat_thread', id: thread.id }, undoable: false }, async (w) => {
      await insertChatThread(w, { thread, messages: [] });
    });
    this.bus.publishTables(['chat_threads'], [thread.id], 'chat.thread');
    return (await this.model()).get('chatThreads', thread.id)!.thread;
  }

  // ---- Read-ins (BE-READIN; db/readin.ts: the worker researches, this only reads and enqueues) ----
  async getReadIn({ params }: I<'getReadIn'>): Promise<Res<'getReadIn'>> {
    const userId = await this.userId();
    if (!(await readin.entityExists(this.db, userId, params))) throw notFound(params.type === 'work_item' ? 'Work item' : 'Event', params.id);
    return readin.getReadInDb(this.db, userId, params);
  }
  async requestReadIn({ params, body }: I<'requestReadIn'>): Promise<Res<'requestReadIn'>> {
    const userId = await this.userId();
    if (!(await readin.entityExists(this.db, userId, params))) throw notFound(params.type === 'work_item' ? 'Work item' : 'Event', params.id);
    const r = await readin.enqueueReadIn(this.db, userId, params, { trigger: 'on_demand', priority: 90, force: body.force });
    if (r.action !== 'fresh' && r.action !== 'running') await readin.notifyReadIn(this.db, params, 'readin.queued');
    const p = await readin.getReadInDb(this.db, userId, params);
    return { entity: p.readIn ?? readin.queuedPlaceholder(params, this.now()), auditId: null };
  }

  // ---- lane A: Specialist Forecast (db/forecast.ts) ----
  async getForecast(_i: I<'getForecast'>): Promise<Res<'getForecast'>> { return this.forecast.view(); } // prettier-ignore
  async getForecastRecord({ params }: I<'getForecastRecord'>): Promise<Res<'getForecastRecord'>> { return this.forecast.detail(params.id); } // prettier-ignore
  async syncForecast(_i: I<'syncForecast'>): Promise<Res<'syncForecast'>> { return this.forecast.sync(); } // prettier-ignore
  async draftForecastNotes(i: I<'draftForecastNotes'>): Promise<Res<'draftForecastNotes'>> { return this.forecast.draft(i); } // prettier-ignore
  async patchForecast({ params, body }: I<'patchForecast'>): Promise<Res<'patchForecast'>> { return this.forecast.patch(params.id, body); } // prettier-ignore
  async stageForecast(i: I<'stageForecast'>): Promise<Res<'stageForecast'>> { return this.forecast.stage(i); } // prettier-ignore
  async checkMissingForecast({ params }: I<'checkMissingForecast'>): Promise<Res<'checkMissingForecast'>> { return this.forecast.checkMissing(params.id); } // prettier-ignore

  // ---- Onboarding (B-079; db/onboarding.ts) ----
  async getOnboarding(_i: I<'getOnboarding'>): Promise<Res<'getOnboarding'>> {
    return this.onboarding.state();
  }
  async saveOnboardingStep({ body }: I<'saveOnboardingStep'>): Promise<Res<'saveOnboardingStep'>> {
    return this.onboarding.save(body);
  }
  async getOnboardingSources({ query }: I<'getOnboardingSources'>): Promise<Res<'getOnboardingSources'>> {
    return this.onboarding.sources(query?.refresh ?? false);
  }
  async completeOnboarding(_i: I<'completeOnboarding'>): Promise<Res<'completeOnboarding'>> {
    return this.onboarding.complete();
  }

  async getChatThread({ params }: I<'getChatThread'>): Promise<Res<'getChatThread'>> {
    const m = await this.model();
    const t = m.get('chatThreads', params.id);
    if (!t) throw notFound('Chat thread', params.id);
    // BE-CHAT first: chat plans (status + the applied receipt after the card) and scan cards
    const messages = await Promise.all(t.messages.map(async (msg) => ({ ...msg, parts: await this.be6.hydrate(m, msg.parts) })));
    const ids = messages.flatMap((msg) => msg.parts.flatMap((p) => (p.type === 'receipt' ? p.receipt.changes.map((c) => c.auditId) : [])));
    const undo = await undoStates(this.db, m.ctx.userId, ids);
    return { thread: t.thread, messages: messages.map((msg) => withBriefSummary(hydrateChatMessage(m, msg, undo))) };
  }

  /**
   * One turn: `start` (ids + model = body.model ?? settings.chat.defaultModel), the backend's events, then
   * `done` or `error`. The user message is persisted first; the assistant message exactly once in a
   * `finally` (runTurn). Until BE-6 the backend is not wired: `start`, then the `upstream_unavailable` error.
   */
  async *chat({ body, signal }: I<'chat'> & { signal: AbortSignal }): AsyncGenerator<ChatSseEvent> {
    let m = await this.model();
    if (!body.threadId && (await this.ensureDefaultChatThread(m))) m = await this.model(); // CHAT-1
    const thread = body.threadId ? m.get('chatThreads', body.threadId) : (m.all('chatThreads').find((t) => t.thread.isDefault) ?? m.all('chatThreads')[0]);
    if (!thread) throw notFound('Chat thread', body.threadId ?? '(default)');
    const threadId = thread.thread.id;
    const model: ChatModel = body.model ?? m.settings().chat.defaultModel;
    const userMsg: ChatMessage = { id: crypto.randomUUID(), threadId, role: 'user', at: this.now().toISOString(), text: body.text, parts: [], context: contextRefs(body.context), isMorningBrief: false };
    await appendChatMessage(this.db, threadId, userMsg);
    this.bus.publishTables(['chat_threads'], [threadId], 'chat.message');
    // BE-CHAT: a newer message in this thread (or Stop / the client leaving) cancels this turn.
    const run = beginChatRun(threadId, signal);
    const messageId = crypto.randomUUID();
    const host = createChatHost(this, this.be6.backend({ liveConnectors: chatLlmEnabled() && process.env.CC_CHAT_CONNECTORS !== '0' }), () => this.now());
    const ctx: DbChatContext = { text: body.text, context: mergeThreadContext(userMsg.context, thread.thread.context), threadId, now: this.now(), model, ops: this.chatOps(), signal: run.signal, messageId, userMessageId: userMsg.id, host, ...(body.allowExtraUsd ? { allowExtraUsd: body.allowExtraUsd } : {}) };
    try {
      yield* runTurn({ threadId, messageId, userMessageId: userMsg.id, model }, this.chatBackend(ctx), {
        signal: run.signal,
        now: () => this.now().toISOString(),
        newId: () => crypto.randomUUID(),
        persist: async (msg) => {
          await appendChatMessage(this.db, threadId, msg);
          // the turn's ledger row was written before the message existed: link it now
          await this.db.execute(sql`update llm_calls set chat_message_id = ${msg.id}::uuid where purpose = 'chat' and chat_message_id is null and request_hash like ${`chat:${msg.id}:%`}`).catch(() => undefined);
          this.bus.publishTables(['chat_threads'], [threadId], 'chat.message');
        },
      });
    } finally {
      run.end();
    }
  }

  /** BE-CHAT: the bound helpers chat plans, scans, drafts, sessions and spend use (chat-be6.ts). */
  private chatKit(): DbChatKit {
    return {
      db: this.handle.db,
      now: () => this.now(),
      userId: () => this.userId(),
      model: () => this.model(),
      mutate: (m, fn) => this.mutate({ ...m, actor: 'chat' }, fn),
      writeItem: (w, model, cur, next, o) => this.writeItem(w, model, cur, next, o),
      rankedIds: () => this.rankedIds(),
      rerankIn: (w, model, policy, rankedIds, now, rowId) => this.rerankIn(w, model, policy, rankedIds, now, rowId),
      resolvedRecord: (model, cur, o) => resolvedRecord(model, cur, o),
      blankItem: (now, me) => blankItem(now, me),
      links: (model) => this.links(model),
      rankTop: (model, policy, now) => {
        const top = this.ranker.rank(model, policy, now).ranked[0];
        return top ? { id: top.id, score: top.score } : undefined;
      },
      scoreOf: (model, w, policy, now) => this.ranker.scoreOf(w, model, policy, now),
      receipt: async (auditId, summary, filter) => labelled(await receiptFromChangeSet(this.db, auditId, await this.model(), 'chat', summary, this.now().toISOString(), filter)),
      publish: (tables, ids, reason) => this.bus.publishTables(tables, ids, reason),
      ...(this.org62Read ? { readLookup: this.org62Read } : {}),
      org62Live: !!this.org62Read || (chatLlmEnabled() && process.env.CC_CHAT_CONNECTORS !== '0'),
    };
  }

  /** Chat ops for the backend (actor `chat`; see chat-ops.ts). */
  chatOps(): DbChatOps {
    const hydrate = async (id: string) => this.hydrated(id);
    return {
      topItems: async (n) => {
        const m = await this.model();
        return storedOrderFrom(m, await this.rankedIds()).slice(0, n).map((w) => hydrateItem(m, w));
      },
      findItem: async (q) => {
        const m = await this.model();
        const w = m.get('workItems', q) ?? m.all('workItems').find((x) => x.title.toLowerCase().includes(q.toLowerCase()));
        return w ? hydrateItem(m, w) : null;
      },
      listItems: async (q) => (await this.listItems({ query: ItemsQuery.parse(q ?? {}) })).items,
      calendarToday: async () => (await this.getCalendar({ query: {} })).events,
      settings: async () => (await this.model()).settings(),
      findAssets: async (q) => {
        const tokens = q.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
        return (await this.model()).all('assets').filter((a) => tokens.some((t) => a.title.toLowerCase().includes(t)));
      },
      resourceForAsset: (a): ChatResource => ({ kind: 'asset', id: a.id, label: a.title, href: a.url ?? `/search?q=${encodeURIComponent(a.title)}` }),
      resourceForItem: (w): ChatResource => ({ kind: 'work_item', id: w.id, label: w.title, href: hrefFor({ type: 'work_item', id: w.id }) }),
      moveToTop: async (itemId, reason) => {
        const m0 = await this.model();
        const w0 = this.item(m0, itemId);
        const pol = m0.settings().policy;
        const now = this.now();
        const top = this.ranker.rank(m0, pol, now).ranked[0];
        const boost = top && top.id !== w0.id ? Math.ceil(top.score - this.ranker.scoreOf(w0, m0, pol, now) + 1) : 0;
        const rankedIds = await this.rankedIds();
        const r = await this.mutate({ action: 'chat.move', summary: `Moved to #1: ${w0.title}`, entity: { type: 'work_item', id: itemId }, actor: 'chat' }, async (w, model) => {
          const cur = this.item(model, itemId);
          await this.writeItem(w, model, cur, { ...cur, signals: { ...cur.signals, boost: cur.signals.boost + boost } }, { bump: true });
          await this.rerankIn(w, model, pol, rankedIds, now);
        });
        return labelled(await receiptFromChangeSet(this.db, r.auditId, await this.model(), 'chat', `${w0.title} → #1 (${reason})`, now.toISOString(), (table, f) => table === 'work_items' && (f === 'rank' || f === 'signals')));
      },
      addNote: async (itemId, note) => {
        const r = await this.mutate({ action: 'chat.note', summary: 'Noted', entity: { type: 'work_item', id: itemId }, actor: 'chat' }, async (w, model) => {
          const cur = this.item(model, itemId);
          await w.tx.update(changeSets).set({ summary: `Noted on ${cur.title}` }).where(eq(changeSets.id, w.cs.id));
          await this.writeItem(w, model, cur, { ...cur, notes: cur.notes ? `${cur.notes}\n${note}` : note }, { bump: true });
          return cur.title;
        });
        return labelled(await receiptFromChangeSet(this.db, r.auditId, await this.model(), 'chat', `Added a note to ${r.result}`, this.now().toISOString()));
      },
      patchItem: (itemId, patch, reason) => this.chatPatchItem(itemId, patch, reason),
      resolveItem: (itemId, resolution, detail, note) => this.chatResolveItem(itemId, resolution, detail ?? {}, note),
      capture: async (text, opts = {}) => {
        const r = await this.captureInternal({ text, ...opts }, 'chat');
        const item = await hydrate(r.result);
        return { item, receipt: labelled(await receiptFromChangeSet(this.db, r.auditId, await this.model(), 'chat', `Captured ${item.title}`, this.now().toISOString(), (table, f) => table === 'work_items' && f === 'state')) };
      },
      scan: async (connectorId, scope) => {
        try {
          const { run } = await this.scanInternal(connectorId, scope, 'chat');
          const ok = !['auth_failed', 'transient_failed', 'budget_exceeded', 'aborted'].includes(run.status);
          return { ok, run, summary: ok ? `Scan ${run.id.slice(-6)} queued; it shows in the Health ledger` : (run.error ?? 'Scan failed') };
        } catch (err) {
          return { ok: false, run: null, summary: (err as Error).message };
        }
      },
      policyPreview: async (deltas) => {
        const m = await this.model();
        return this.preview(m, storedOrderFrom(m, await this.rankedIds()), { ...m.settings().policy, weights: weightsWith(m.settings().policy.weights, deltas) });
      },
      policyApply: async (deltas, note) => {
        const m = await this.model();
        const pol = m.settings().policy;
        const weights = weightsWith(pol.weights, deltas);
        const preview = this.preview(m, storedOrderFrom(m, await this.rankedIds()), { ...pol, weights });
        const r = await this.applyPolicyInternal(weights, pol.rules, note, 'chat', pol.version);
        return { receipt: r.receipt, preview };
      },
      proposeItemPatch: async (itemId, patch, reason) => {
        let pid = '';
        await this.mutate({ action: 'chat.propose', summary: reason, entity: { type: 'work_item', id: itemId }, actor: 'chat' }, async (w, model) => {
          pid = await this.chatPropose(w, model, this.item(model, itemId), patch as Record<string, unknown>, reason);
        });
        return this.proposal(await this.model(), pid);
      },
    };
  }

  /** Stage chat field changes as one proposal group (Apply / Keep mine). */
  private async chatPropose(w: WriteCtx, model: ReadModel, cur: WorkItemRecord, patch: Record<string, unknown>, reason: string): Promise<string> {
    const labels = Object.fromEntries(Object.keys(patch).filter((f) => ITEM_FIELD_LABEL[f]).map((f) => [f, ITEM_FIELD_LABEL[f]!]));
    return this.stageRecord(w, model, cur, { ...cur, ...patch } as WorkItemRecord, reason, 'chat', labels);
  }

  /**
   * Stage `next` as one proposal group instead of writing it: the changed columns go through the engine
   * path of the change-set helper with lockAll, so the rows are real change_proposals that applyProposal
   * can apply. Fields with no column of their own (startBy) cannot be staged.
   */
  private async stageRecord(w: WriteCtx, model: ReadModel, cur: WorkItemRecord, next: WorkItemRecord, reason: string, actor: 'chat' | 'engine', labels: Record<string, string> = {}): Promise<string> {
    const a = workItemColumns(cur, w);
    const b = workItemColumns(next, w);
    const cols: Record<string, unknown> = {};
    for (const k of Object.keys(b) as (keyof typeof b)[]) if (k !== 'id' && k !== 'ownerUserId' && k !== 'origin' && JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) cols[k] = b[k];
    if (!Object.keys(cols).length) throw invalid('Nothing to propose: no stored column changes');
    const res = await engineUpdate(w.tx, workItems, cur.id, cols as never, { lockAll: true, reason });
    const pid = res.proposals[0]?.proposalId;
    if (!pid) throw invalid('Nothing to propose: the values are unchanged');
    const [row] = await w.tx.select({ g: changeProposals.groupId }).from(changeProposals).where(eq(changeProposals.id, pid));
    const groupId = row!.g;
    await writeExt(w, 'change_proposals', groupId, { actor: actor === 'engine' ? undefined : actor, label: cur.title, labels: Object.keys(labels).length ? labels : undefined });
    model.remove('proposals', groupId);
    return groupId;
  }

  /**
   * A chat field edit: actor `chat`, undoable, never adds userLockedFields; a field the user already
   * locked does not change and becomes a proposal instead (same change set).
   */
  private async chatPatchItem(itemId: string, patch: WorkItemPatchT, reason: string): Promise<DbChatPatchResult> {
    const parsed = WorkItemPatch.safeParse(patch);
    if (!parsed.success) throw invalid(`Invalid patch: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    let applied: string[] = [];
    const pids: string[] = [];
    let title = '';
    const r = await this.mutate({ action: 'chat.edit', summary: reason, entity: { type: 'work_item', id: itemId }, actor: 'chat' }, async (w, model) => {
      const cur = this.item(model, itemId);
      title = cur.title;
      const locked = new Set<string>(cur.userLockedFields);
      const apply: Record<string, unknown> = {};
      const staged: Record<string, unknown> = {};
      for (const [f, v] of Object.entries(parsed.data)) {
        if (v === undefined) continue;
        if (locked.has(ITEM_PATCH_LOCK[f] ?? f)) staged[f] = v;
        else if (JSON.stringify((cur as Record<string, unknown>)[f] ?? null) !== JSON.stringify(v)) apply[f] = v;
      }
      applied = Object.keys(apply);
      await w.tx.update(changeSets).set({ summary: `${reason}: ${cur.title}` }).where(eq(changeSets.id, w.cs.id));
      let next = cur;
      if (applied.length) {
        next = { ...cur, ...apply } as WorkItemRecord; // userLockedFields unchanged on purpose
        await this.writeItem(w, model, cur, next, { bump: true });
      }
      for (const [f, v] of Object.entries(staged)) pids.push(await this.chatPropose(w, model, next, { [f]: v }, `${reason} (you set ${ITEM_FIELD_LABEL[f] ?? f} yourself)`));
    });
    const m = await this.model();
    const receipt = applied.length && r.undoable ? labelled(await receiptFromChangeSet(this.db, r.auditId, m, 'chat', `${reason}: ${title}`, this.now().toISOString(), (table, f) => table === 'work_items' && applied.includes(f))) : null;
    return { item: hydrateItem(m, this.item(m, itemId)), receipt, proposals: await Promise.all(pids.map((p) => this.proposal(m, p))) };
  }

  /** Chat closes an item with an R-UI-22 resolution (doneBy `chat`). A user-locked state becomes a proposal. */
  private async chatResolveItem(itemId: string, resolution: Resolution, detail: Partial<Omit<ResolutionDetail, 'inferred'>>, note?: string): Promise<DbChatPatchResult> {
    const m0 = await this.model();
    const cur0 = this.item(m0, itemId);
    if (!isLive(cur0) && cur0.state !== 'snoozed' && cur0.state !== 'suggested') throw invalid(`Cannot resolve a ${cur0.state} item`);
    const label = resolutionLabel(resolution, detail.personName ?? (detail.personId ? m0.get('people', detail.personId)?.name : undefined));
    if (cur0.userLockedFields.includes('state')) {
      let pid = '';
      await this.mutate({ action: 'chat.propose', summary: `${label} (asked in chat)`, entity: { type: 'work_item', id: itemId }, actor: 'chat' }, async (w, model) => {
        pid = await this.chatPropose(w, model, this.item(model, itemId), { state: 'done', resolution }, `${label} (asked in chat)`);
      });
      const m = await this.model();
      return { item: hydrateItem(m, this.item(m, itemId)), receipt: null, proposals: [await this.proposal(m, pid)] };
    }
    const summary = `${label}: ${cur0.title}`;
    const r = await this.mutate({ action: 'chat.resolve', summary, entity: { type: 'work_item', id: itemId }, actor: 'chat', current: () => this.hydrated(itemId) }, async (w, model) => {
      const cur = this.item(model, itemId);
      const next = resolvedRecord(model, cur, { reason: label, resolution, detail: note ? { ...detail, note } : detail, doneBy: 'chat', at: w.now.toISOString() });
      await this.writeItem(w, model, cur, next, { bump: true });
      await logTransition(w, cur.id, cur.state, next.state, label);
    });
    const m = await this.model();
    const receipt = labelled(await receiptFromChangeSet(this.db, r.auditId, m, 'chat', summary, this.now().toISOString(), (table, f) => table === 'work_items' && (f === 'state' || f === 'resolution')));
    return { item: hydrateItem(m, this.item(m, itemId)), receipt, proposals: [] };
  }

  // =========================================================================
  // Live events
  // =========================================================================

  events({ signal }: { signal: AbortSignal }): AsyncIterable<LiveEvent> {
    return this.bus.iterate(signal);
  }

  // =========================================================================
  // Feedback (D-56) // lane D: the read-only diagnose agent when the Assistant's model is on, else the fallback
  // =========================================================================

  private feedbackAgent: SdkFeedbackAgent | null | undefined;

  private feedbackHost(): FeedbackHost {
    this.feedbackAgent ??= chatLlmEnabled() ? new SdkFeedbackAgent() : null;
    return {
      ds: this,
      now: () => this.now(),
      terms: async () => loadScrubTerms(this.db, await this.userId()),
      me: async () => (await this.model()).ctx.me.name,
      insertAction: async (dest, audit) => {
        const draft = actionDraftFor(dest, { id: crypto.randomUUID(), now: this.now().toISOString(), workItemId: null, rendered: (doc) => renderAll(dest, doc) });
        const r = await this.mutate({ action: audit.action, summary: audit.summary, entity: { type: 'draft', id: draft.id }, undoable: false }, async (w) => {
          await insertDraft(w, draft);
        });
        this.bus.publishTables(['drafts'], [draft.id], audit.action);
        return { draft: (await this.model()).get('drafts', draft.id) ?? draft, auditId: r.auditId };
      },
      budget: async () => feedbackBudget(this.db, await this.userId(), (await this.model()).settings(), this.now()),
      recordSpend: async (sp) => recordFeedbackSpend(this.db, await this.userId(), (await this.model()).settings().profile.timezone, this.now(), sp),
      agent: this.feedbackAgent,
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
  // Dev routes exist only in mock mode
  // =========================================================================

  private devOnly(): never {
    throw new AppError('not_found', 'Dev routes exist only in mock mode');
  }
  async getScenario(_i: I<'getScenario'>): Promise<Res<'getScenario'>> {
    return this.devOnly();
  }
  async controlScenario(_i: I<'controlScenario'>): Promise<Res<'controlScenario'>> {
    return this.devOnly();
  }
  async getDevFail(_i: I<'getDevFail'>): Promise<Res<'getDevFail'>> {
    return this.devOnly();
  }
  async setDevFail(_i: I<'setDevFail'>): Promise<Res<'setDevFail'>> {
    return this.devOnly();
  }
  async devEngineChange(_i: I<'devEngineChange'>): Promise<Res<'devEngineChange'>> {
    return this.devOnly();
  }

  // =========================================================================
  // Engine seam (not a route): an engine write that respects user locks. Used by the parity tests;
  // ENGINES-core / the worker write the same way (engineUpdate → change_proposals for locked fields).
  // =========================================================================

  async engineUpdateItem(itemId: string, patch: Partial<WorkItemRecord>, reason: string): Promise<{ applied: string[]; proposalIds: string[]; auditId: string }> {
    let applied: string[] = [];
    let proposalIds: string[] = [];
    const r = await this.mutate({ action: 'item.engine_update', summary: reason, entity: { type: 'work_item', id: itemId }, actor: 'engine' }, async (w, model) => {
      const cur = this.item(model, itemId);
      await w.tx.update(changeSets).set({ summary: `${reason}: ${cur.title}` }).where(eq(changeSets.id, w.cs.id));
      const res = await this.writeItem(w, model, cur, { ...cur, ...patch } as WorkItemRecord, { bump: true });
      const groups = new Set<string>();
      for (const p of res.proposals) {
        const [row] = await w.tx.select({ g: changeProposals.groupId }).from(changeProposals).where(eq(changeProposals.id, p.proposalId));
        if (row) groups.add(row.g);
      }
      if (groups.size) await w.tx.update(changeProposals).set({ reason }).where(inArray(changeProposals.groupId, [...groups]));
      proposalIds = [...groups];
      const { WORK_FIELD_COLUMN } = await import('./store/work');
      applied = Object.keys(patch).filter((k) => !res.proposals.some((p) => p.field === (WORK_FIELD_COLUMN[k] ?? k)));
    });
    return { applied, proposalIds, auditId: r.auditId };
  }

  /**
   * Engine seam: one closure signal (scanner evidence, session state, Drive digest, reply, timer,
   * loop-back) decided by ENGINES-core `applySignal()` and written as one engine change set with the same
   * writers user verbs use: a transition row, the fields, proposals when the user locked the status (or a
   * field the target state needs), a sibling item, and the reopen_decisions row. Undo is undoChangeSet.
   */
  async applyClosureSignal(itemId: string, signal: Signal, settings: ClosureSettings = DEFAULT_CLOSURE_SETTINGS): Promise<{ decision: ClosureDecision; auditId: string | null; proposalId: string | null; siblingId: string | null }> {
    const m0 = await this.model();
    const decision = applySignal(closureItemOf(this.item(m0, itemId), m0.ctx.me), signal, settings);
    if (decision.kind === 'none') return { decision, auditId: null, proposalId: null, siblingId: null };
    let proposalId: string | null = null;
    let siblingId: string | null = null;
    const r = await this.mutate({ action: `closure.${signal.type}`, summary: decision.reason, entity: { type: 'work_item', id: itemId }, actor: 'engine' }, async (w, model) => {
      const cur = this.item(model, itemId);
      const d = applySignal(closureItemOf(cur, model.ctx.me), signal, settings); // decided again inside the transaction
      await w.tx.update(changeSets).set({ summary: `${d.reason}: ${cur.title}` }).where(eq(changeSets.id, w.cs.id));
      const at = w.now.toISOString();
      const evidenceId = d.transition?.evidenceId ?? signal.evidenceId ?? null;
      const evidence = evidenceId && model.all('evidence').some((e) => e.id === evidenceId) ? evidenceId : null;
      if (d.kind === 'proposal') {
        // the machine proposes what it would have written: rebuild that decision, stage the whole record
        const st = d.proposals.find((p) => p.field === 'status');
        const wanted: ClosureDecision = {
          ...d,
          transition: st ? { from: st.currentValue as never, to: st.proposedValue as never, actor: 'engine', reason: d.reason, evidenceId: evidence, autonomy: null } : null,
          fieldChanges: d.proposals.filter((p) => p.field !== 'status').map((p) => ({ field: p.field as never, before: p.currentValue, after: p.proposedValue })),
        };
        proposalId = await this.stageRecord(w, model, cur, recordAfterDecision(cur, wanted, at), d.reason, 'engine', st ? { state: 'State' } : {});
        return;
      }
      if (d.kind === 'sibling' && d.sibling) {
        const sib: WorkItemRecord = {
          ...blankItem(at, model.ctx.me),
          id: crypto.randomUUID(),
          kind: d.sibling.kind,
          title: d.sibling.title,
          initiativeId: d.sibling.initiativeId,
          accountId: cur.accountId,
          oppId: cur.oppId,
          why: d.sibling.label.text,
          involvement: d.sibling.involvement,
          sources: cur.sources.slice(0, 1),
        };
        siblingId = sib.id;
        await insertWorkItem(w, sib, this.links(model), { locks: [] });
        await logTransition(w, sib.id, null, 'open', d.sibling.label.text, evidence);
      } else {
        const next = recordAfterDecision(cur, d, at);
        await this.writeItem(w, model, cur, next, { bump: true });
      }
      const transitionId = d.transition ? await logTransition(w, cur.id, cur.state, stateFromEngine(d.transition.to), d.transition.reason, evidence) : null;
      if (d.reopenDecision) {
        await w.tx.insert(reopenDecisions).values({
          ownerUserId: w.userId,
          doneWorkItemId: cur.id,
          triggerEvidenceId: evidence,
          outcome: d.reopenDecision.outcome,
          ruleKey: d.reopenDecision.ruleKey,
          explanation: d.reopenDecision.explanation,
          newWorkItemId: siblingId,
          initiativeId: cur.initiativeId,
          transitionId,
          decidedBy: 'engine',
          changeSetId: w.cs.id,
        });
      }
    });
    return { decision, auditId: r.undoable ? r.auditId : null, proposalId, siblingId };
  }

  /** Engine revision of a draft body (user-touched → a doc proposal). */
  async engineReviseDraft(draftId: string, newText: string, reason: string): Promise<{ proposalIds: string[] }> {
    let ids: string[] = [];
    await this.mutate({ action: 'nba.revise', summary: `NBA updated: ${reason}`, entity: { type: 'draft', id: draftId }, actor: 'engine' }, async (w, model) => {
      const d = this.draft(model, draftId);
      const doc = docFromText(newText);
      if (d.userTouched) ids = (await engineDraftDoc(w, d, doc, reason)).proposalIds;
      else await updateDraft(w, d, { ...d, doc, plainText: plainText(doc), rendered: renderAll(d.destination, doc) }, { bump: true });
    });
    return { proposalIds: ids };
  }

  /** Read-only helper for tests: the change set behind an audit id. */
  async changeSet(csId: string) {
    const [row] = await this.db.select().from(changeSets).where(eq(changeSets.id, csId));
    return row ?? null;
  }

  async rawKv() {
    return loadKv(this.db, await this.userId());
  }

}

// ---------------------------------------------------------------------------
// helpers (presentation rules shared with the mock)
// ---------------------------------------------------------------------------

/**
 * Apply a multi-field proposal group in ONE update. A closure proposal ("Likely done · Confirm?") stages
 * status + done_at + done_by together, and work_items_done_chk rejects any of them alone; BE-0's
 * applyProposal applies one field per statement, so a group goes through here (same SQL, same
 * bookkeeping: version + 1, accepted, decided_by / applied_change_set_id from the change set).
 */
async function applyProposalGroup(tx: Tx, ids: string[]): Promise<void> {
  const props = await tx.select().from(changeProposals).where(inArray(changeProposals.id, ids)).for('update');
  if (!props.length) return;
  const { entityType, entityId } = props[0]!;
  if (props.some((p) => p.entityType !== entityType || p.entityId !== entityId || p.status !== 'pending')) throw invalid('Proposal group spans several rows or is no longer pending');
  const cols = (await tx.execute<{ name: string }>(sql`select attname as name from pg_attribute where attrelid = to_regclass(${`public.${entityType}`}) and attnum > 0 and not attisdropped`)).rows.map((r) => r.name);
  const fields = props.map((p) => p.field);
  for (const f of fields) if (!cols.includes(f) || ['id', 'version', 'owner_user_id', 'created_at', 'updated_at'].includes(f)) throw invalid(`Proposal field ${f} cannot be applied`);
  const image = JSON.stringify(Object.fromEntries(props.map((p) => [p.field, p.proposedValue ?? null])));
  const t = sql.identifier(entityType);
  const sets = fields.map((f) => sql`${sql.identifier(f)} = (jsonb_populate_record(null::${t}, ${image}::jsonb)).${sql.identifier(f)}`);
  if (cols.includes('version')) sets.push(sql`version = version + 1`);
  if (cols.includes('updated_at')) sets.push(sql`updated_at = now()`);
  const res = await tx.execute(sql`update ${t} set ${sql.join(sets, sql`, `)} where id = ${entityId} returning 1`);
  if (!res.rows.length) throw notFound(entityType, entityId);
  await tx
    .update(changeProposals)
    .set({
      status: 'accepted',
      decidedAt: new Date(),
      decidedBy: sql`nullif(current_setting('cc.actor_kind', true), '')::actor_kind`,
      appliedChangeSetId: sql`nullif(current_setting('cc.change_set_id', true), '')::uuid`,
    })
    .where(inArray(changeProposals.id, ids));
}

/**
 * BE-0's undo bumps `version` on every row it restores (OCC bookkeeping everywhere else), but
 * priority_policies.version is the policy's own number (v3, v4…), unique per user. Around an undo or redo
 * of a change set that updated policy rows: first move those rows' numbers out of the way (negative), so
 * the bump cannot collide with a version row the undo re-inserts, then give each its number back. A
 * row's number is the one it was created with (its first audited insert image). Both writes run in
 * non-undoable change sets inside the undo's transaction.
 */
async function shiftPolicyVersionNumbers(tx: Tx, userId: string, targetId: string): Promise<Map<string, number>> {
  const res = await tx.execute<{ row_id: string; v: number | null }>(sql`
    select a.row_id, (select (i.after ->> 'version')::int from audit_events i
                       where i.table_name = 'priority_policies' and i.row_id = a.row_id and i.op = 'insert'
                       order by i.id limit 1) as v
      from audit_events a
     where a.change_set_id = ${targetId} and a.table_name = 'priority_policies' and a.op = 'update'`);
  const out = new Map<string, number>();
  for (const r of res.rows) if (r.v !== null) out.set(r.row_id, r.v);
  if (!out.size) return out;
  await withChangeSet({ db: tx as unknown as Db, userId, actor: actors.system('undo.policy_version'), reason: 'Policy version numbers (before undo)', undoable: false }, async (t2) => {
    for (const [id, v] of out) await t2.execute(sql`update priority_policies set version = ${-100000 - v} where id = ${id}::uuid`);
  });
  return out;
}

async function restorePolicyVersionNumbers(tx: Tx, userId: string, rows: Map<string, number>): Promise<void> {
  if (!rows.size) return;
  await withChangeSet({ db: tx as unknown as Db, userId, actor: actors.system('undo.policy_version'), reason: 'Policy version numbers (after undo)', undoable: false }, async (t2) => {
    for (const [id, v] of rows) await t2.execute(sql`update priority_policies set version = ${v} where id = ${id}::uuid`);
  });
}

/** Current weights plus deltas, each clamped to 0–10 (as the mock). */
function weightsWith(base: PolicyWeights, deltas: Partial<PolicyWeights>): PolicyWeights {
  const weights = { ...base };
  for (const [k, d] of Object.entries(deltas)) weights[k as keyof PolicyWeights] = Math.max(0, Math.min(10, (weights[k as keyof PolicyWeights] ?? 0) + (d ?? 0)));
  return weights;
}

/**
 * Undo state of receipt lines from the audit undo/redo chain: auditId → its undo → that undo's undo
 * (redo) → …, following change_sets.undo_of_change_set_id. The latest link is live; an even chain length
 * means the line is currently undone (same reading as the mock's).
 */
async function undoStates(db: Db, userId: string, auditIds: string[]): Promise<Map<string, { undoneAt: string | null; undoAuditId: string | null }>> {
  const out = new Map<string, { undoneAt: string | null; undoAuditId: string | null }>();
  const ids = [...new Set(auditIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) return out;
  const res = await db.execute<{ root: string; id: string; depth: number; created_at: Date }>(sql`
    with recursive chain as (
      select cs.id as root, cs.id, 1 as depth, cs.created_at from change_sets cs
       where cs.owner_user_id = ${userId} and cs.id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
      union all
      select c.root, n.id, c.depth + 1, n.created_at from chain c join change_sets n on n.undo_of_change_set_id = c.id
       where c.depth < 100
    )
    select distinct on (root) root, id, depth, created_at from chain order by root, depth desc`);
  for (const r of res.rows) {
    if (r.depth === 1) out.set(r.root, { undoneAt: null, undoAuditId: null });
    else out.set(r.root, { undoneAt: r.depth % 2 === 0 ? new Date(r.created_at).toISOString() : null, undoAuditId: r.id });
  }
  return out;
}

/** Persisted parts carry stream-time snapshots; refresh proposal status and receipt undo state on read. */
function hydrateChatMessage(m: ReadModel, msg: ChatMessage, undo: Map<string, { undoneAt: string | null; undoAuditId: string | null }>): ChatMessage {
  if (!msg.parts.some((p) => p.type === 'proposal' || p.type === 'receipt')) return msg;
  return {
    ...msg,
    parts: msg.parts.map((p): ChatPart => {
      if (p.type === 'proposal') {
        const cur = m.get('proposals', p.proposal.id) ?? p.proposal;
        return { ...p, proposal: cur, status: chatProposalStatus(cur.status) };
      }
      if (p.type === 'receipt') return { ...p, receipt: { ...p.receipt, changes: p.receipt.changes.map((c) => ({ ...c, ...(undo.get(c.auditId) ?? { undoneAt: null, undoAuditId: null }) })) } };
      return p;
    }),
  };
}

/** Slack user id → display name, so previews show "@Dana Reyes" for `<@U…>` (same as the mock). */
function mentionLabels(m: ReadModel): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of m.all('people')) if (p.slackHandle) out[p.slackHandle] = p.name;
  return out;
}

function startOfDayLocal(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfDayLocal(now: Date): Date {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** The closed record for done / resolve / confirm-done (user) and chat's resolveItem (same as the mock). */
function resolvedRecord(
  model: ReadModel,
  cur: WorkItemRecord,
  o: { reason: string; resolution: Resolution; detail: Partial<Omit<ResolutionDetail, 'inferred'>>; involvement?: 'watcher' | 'not_involved' | 'contributor'; doneBy: 'user' | 'chat'; at: string },
): WorkItemRecord {
  const { detail, resolution } = o;
  const person = detail.personId ? model.get('people', detail.personId) : detail.personName ? model.all('people').find((p) => p.name === detail.personName) : undefined;
  const personName = detail.personName ?? person?.name;
  if (resolution === 'handed_off' && !personName) throw invalid('handed_off needs detail.personId or detail.personName (who took it over)');
  if ((resolution === 'duplicate' || resolution === 'superseded') && detail.relatedItemId && !model.get('workItems', detail.relatedItemId)) throw notFound('Related work item', detail.relatedItemId);
  return {
    ...cur,
    state: 'done',
    doneAt: o.at,
    doneBy: o.doneBy,
    closedReason: o.reason,
    likelyDone: null,
    waiting: null,
    snoozedUntil: null,
    resolution,
    resolutionDetail: { inferred: false, ...detail, ...(personName ? { personName } : {}), ...(person ? { personId: person.id } : {}) },
    involvement: resolution === 'handed_off' ? (o.involvement ?? 'watcher') : cur.involvement,
    owner: resolution === 'handed_off' && personName ? { id: person?.id ?? uuidFor(`person:${personName}`), name: personName } : cur.owner,
    loopedBackIn: null,
  };
}

/** Human labels for receipt / proposal lines (chat edits), as the mock. */
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

const labelled = (r: Receipt): Receipt => ({ ...r, changes: r.changes.map((c) => (c.label || !ITEM_FIELD_LABEL[c.field] ? c : { ...c, label: ITEM_FIELD_LABEL[c.field] })) });

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

function buildLaunchPrompt(item: WorkItemRecord, m: ReadModel): string {
  const ini = item.initiativeId ? m.get('initiatives', item.initiativeId) : undefined;
  const acc = item.accountId ? m.get('accounts', item.accountId) : undefined;
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

function blankItem(now: string, me: { id: string; name: string }): WorkItemRecord {
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
    owner: { id: me.id, name: me.name },
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

/**
 * The app's db DataSource. BE-CHAT: chat answers with the Agent SDK runner when CC_CHAT_LLM=1, else with
 * the same runner over the deterministic fake model (a bare `new DbDataSource()` keeps "not wired").
 */
export function createDbDataSource(opts?: DbDataSourceOptions): DbDataSource {
  return new DbDataSource({ chatBackend: chatRunnerBackend(chatRunnerFor('db')), ...opts });
}

/** The Org62 id and name an onsite trip logs to: the chosen opp, else the account's default opp (the engine's), else the account. */
async function onsiteWhat(tx: Tx, userId: string, accountId: string, oppId: string | null | undefined): Promise<{ whatId: string | null; whatName: string | null } | null> {
  const [a] = await tx.select({ name: accountsTable.name, org62: accountsTable.org62AccountId }).from(accountsTable).where(and(eq(accountsTable.ownerUserId, userId), eq(accountsTable.id, accountId)));
  if (!a) return null;
  if (oppId) {
    const [o] = await tx.select({ name: opportunitiesTable.name, org62: opportunitiesTable.org62OpportunityId }).from(opportunitiesTable).where(and(eq(opportunitiesTable.ownerUserId, userId), eq(opportunitiesTable.id, oppId)));
    if (o?.org62) return { whatId: o.org62, whatName: o.name };
  }
  // null: the engine picks the account's default opp (Matcher.mappings), like any meeting of the account
  return oppId === undefined ? { whatId: null, whatName: null } : { whatId: a.org62 ?? null, whatName: a.name };
}

/** D-69: the push's live reads over the VDP read client (read tools only). */
function vdpLiveReads(c: VdpClient, signal?: AbortSignal): VdpLiveReads {
  const o = signal ? { signal } : {};
  return { findCompany: (q) => c.findCompany(q, o), vdpsOfCompany: (id) => c.vdpsOfCompany(id, o), getVdp: (slug) => c.getVdp(slug, undefined, o) };
}
