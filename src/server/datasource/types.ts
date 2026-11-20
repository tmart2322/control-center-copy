/**
 * The DataSource: one method per route in src/contract/routes.ts (same name).
 *
 * Inputs are already parsed by the route handler (defaults applied); outputs are validated against the
 * route's response schema before they leave the server. Throw AppError (src/server/errors.ts) for
 * typed failures: conflict (stale ifVersion), validation, not_found, upstream_unavailable, …
 *
 * Implementations: `mock` (src/server/datasource/mock, in-memory, the default) and `db` (BE-1).
 */
import type { RouteInput, RouteKey, RouteOutput } from '@/contract';

type In<K extends RouteKey> = RouteInput<K>;
type Out<K extends RouteKey> = Promise<RouteOutput<K>>;
type Stream<K extends RouteKey> = AsyncIterable<RouteOutput<K>>;
type WithSignal<T> = T & { signal: AbortSignal };

export interface DataSource {
  readonly kind: 'mock' | 'db';

  // Today
  getToday(i: In<'getToday'>): Out<'getToday'>;
  rerankToday(i: In<'rerankToday'>): Out<'rerankToday'>;
  getHome(i: In<'getHome'>): Out<'getHome'>;

  // Work items
  listItems(i: In<'listItems'>): Out<'listItems'>;
  captureItem(i: In<'captureItem'>): Out<'captureItem'>;
  getItem(i: In<'getItem'>): Out<'getItem'>;
  patchItem(i: In<'patchItem'>): Out<'patchItem'>;
  itemAction(i: In<'itemAction'>): Out<'itemAction'>;
  getItemEvidence(i: In<'getItemEvidence'>): Out<'getItemEvidence'>;
  /** AUDIT "why is this here?": evidence → source → scan run → triage verdict → spend. The mock has no runs. */
  getItemTrace(i: In<'getItemTrace'>): Out<'getItemTrace'>;
  getItemHistory(i: In<'getItemHistory'>): Out<'getItemHistory'>;
  markItemSeen(i: In<'markItemSeen'>): Out<'markItemSeen'>;
  getInitiative(i: In<'getInitiative'>): Out<'getInitiative'>;

  // NBA and proposals
  getItemNba(i: In<'getItemNba'>): Out<'getItemNba'>;
  regenerateNba(i: In<'regenerateNba'>): Out<'regenerateNba'>;
  applyProposal(i: In<'applyProposal'>): Out<'applyProposal'>;
  rejectProposal(i: In<'rejectProposal'>): Out<'rejectProposal'>;

  // Drafts and Outbox
  getDraft(i: In<'getDraft'>): Out<'getDraft'>;
  /** The message a draft replies to, with up to 5 earlier thread messages (read-only; bodies stay local and redacted). */
  getDraftSource(i: In<'getDraftSource'>): Out<'getDraftSource'>;
  patchDraft(i: In<'patchDraft'>): Out<'patchDraft'>;
  /** Add to Outbox (BE-CHAT): drafting → ready, audited + undoable; idempotent on ready; any other status 409 with the current draft. */
  queueDraft(i: In<'queueDraft'>): Out<'queueDraft'>;
  /** REJECT-1: drafting/ready/scheduled/failed → rejected, audited + undoable; idempotent on rejected; sending or sent 409. Never calls out. */
  rejectDraft(i: In<'rejectDraft'>): Out<'rejectDraft'>;
  previewDraft(i: In<'previewDraft'>): Out<'previewDraft'>;
  /** MUST honor dry-run. MUST NOT call any external system unless dry-run is off AND the user confirmed. */
  dispatchDraft(i: In<'dispatchDraft'>): Out<'dispatchDraft'>;
  getOutbox(i: In<'getOutbox'>): Out<'getOutbox'>;

  // Calendar
  getCalendar(i: In<'getCalendar'>): Out<'getCalendar'>;
  /** One meeting with its prep items, account / opp names and read-in state (the hover card, the meeting panel). */
  getCalendarEvent(i: In<'getCalendarEvent'>): Out<'getCalendarEvent'>;

  // Agents and tools
  getAgents(i: In<'getAgents'>): Out<'getAgents'>;
  launchAgent(i: In<'launchAgent'>): Out<'launchAgent'>;
  answerAgent(i: In<'answerAgent'>): Out<'answerAgent'>;
  cancelAgent(i: In<'cancelAgent'>): Out<'cancelAgent'>;
  getTools(i: In<'getTools'>): Out<'getTools'>;
  startToolRun(i: In<'startToolRun'>): Out<'startToolRun'>;
  getToolRun(i: In<'getToolRun'>): Out<'getToolRun'>;

  // Time
  getTime(i: In<'getTime'>): Out<'getTime'>;
  /** Every activity row in a range, filtered, with week / month / fiscal-quarter totals (the Log view). */
  getActivityLog(i: In<'getActivityLog'>): Out<'getActivityLog'>;
  getTimeLedger(i: In<'getTimeLedger'>): Out<'getTimeLedger'>;
  stageLogBatch(i: In<'stageLogBatch'>): Out<'stageLogBatch'>;
  /** D-70 landings (src/lib/landings): a run's writes, a record's landings, Event updates, use cases in both systems. */
  getCanvasWrites(i: In<'getCanvasWrites'>): Out<'getCanvasWrites'>;
  getRecordLandings(i: In<'getRecordLandings'>): Out<'getRecordLandings'>;
  getEventUpdates(i: In<'getEventUpdates'>): Out<'getEventUpdates'>;
  proposeEventUpdates(i: In<'proposeEventUpdates'>): Out<'proposeEventUpdates'>;
  patchEventUpdate(i: In<'patchEventUpdate'>): Out<'patchEventUpdate'>;
  getUseCaseLandings(i: In<'getUseCaseLandings'>): Out<'getUseCaseLandings'>;
  pickUseCaseValue(i: In<'pickUseCaseValue'>): Out<'pickUseCaseValue'>;
  fixUseCase(i: In<'fixUseCase'>): Out<'fixUseCase'>;
  /** 2026-11-13 audit C4: a created logging canvas, read back from Org62 sooner (after the copied prompt, or now); reads only. */
  checkCanvasOrg62(i: In<'checkCanvasOrg62'>): Out<'checkCanvasOrg62'>;
  /** 2026-11-13 audit B2: a canvas item's rows by kind, and Remove / Edit before Apply (src/server/time/canvas-review.ts). */
  getCanvasReview(i: In<'getCanvasReview'>): Out<'getCanvasReview'>;
  removeCanvasRows(i: In<'removeCanvasRows'>): Out<'removeCanvasRows'>;
  editCanvasRow(i: In<'editCanvasRow'>): Out<'editCanvasRow'>;
  patchActivity(i: In<'patchActivity'>): Out<'patchActivity'>;
  /** A row's opportunity picker: every opp ranked for the row (shared builder: src/server/datasource/opp-options.ts). */
  getOppOptions(i: In<'getOppOptions'>): Out<'getOppOptions'>;
  /** "Search Org62 for '…'": one live, read-only lookup (mock: placeholder rows). */
  searchOrg62Opps(i: In<'searchOrg62Opps'>): Out<'searchOrg62Opps'>;
  /** Set a row's opp from an Org62 hit, adding the opp (and its account) the app lacks: one undoable change set. */
  pickOrg62Opp(i: In<'pickOrg62Opp'>): Out<'pickOrg62Opp'>;
  resolveActivity(i: In<'resolveActivity'>): Out<'resolveActivity'>;
  syncCanvas(i: In<'syncCanvas'>): Out<'syncCanvas'>;
  /** Onsite lane: the day chip's corrections and Mark trip (locked overrides the projections respect). */
  correctOnsiteDay(i: In<'correctOnsiteDay'>): Out<'correctOnsiteDay'>;
  markTrip(i: In<'markTrip'>): Out<'markTrip'>;
  /** D-64: the remembered "Dismiss all from <source>" rules (Settings ▸ Time ▸ Dismissed sources). */
  listTimeDismissRules(i: In<'listTimeDismissRules'>): Out<'listTimeDismissRules'>;
  /** D-64: dismiss every live row of this row's source and remember it (one audited change set, Undo). */
  dismissFromSource(i: In<'dismissFromSource'>): Out<'dismissFromSource'>;
  /** D-64: remove a rule; the rows it set aside come back as proposals (one audited change set, Undo). */
  removeTimeDismissRule(i: In<'removeTimeDismissRule'>): Out<'removeTimeDismissRule'>;

  // History (B-081): what was done on past days, from stored history only (no view snapshots)
  getHistoryMonth(i: In<'getHistoryMonth'>): Out<'getHistoryMonth'>;
  getHistoryDay(i: In<'getHistoryDay'>): Out<'getHistoryDay'>;

  // Deals
  getDeals(i: In<'getDeals'>): Out<'getDeals'>;
  getMissed(i: In<'getMissed'>): Out<'getMissed'>;
  /** VDP coverage + gaps from the read-only mirror (vdp_records); the mock serves placeholder VDPs. Never calls VDP. */
  getVdpCoverage(i: In<'getVdpCoverage'>): Out<'getVdpCoverage'>;
  /** One VDP or one account not in VDP yet: steps, asset candidates, everything the mirror read. Never calls VDP. */
  getVdpDetail(i: In<'getVdpDetail'>): Out<'getVdpDetail'>;
  /** Confirm / mark added / dismiss an asset candidate (local state; VDP is never written). */
  setVdpCandidate(i: In<'setVdpCandidate'>): Out<'setVdpCandidate'>;
  /** Queue read-only research runs that look for a VDP's assets (db: the worker; mock: placeholder candidates). */
  findVdpAssets(i: In<'findVdpAssets'>): Out<'findVdpAssets'>;
  /** One VDP field change as an Outbox item (status `ready`, mode `send` = Apply). Never calls VDP. */
  draftVdpUpdate(i: In<'draftVdpUpdate'>): Out<'draftVdpUpdate'>;
  /** D-60: "Push N to VDP": each ticked item staged and applied on the user's click (dry run records only). */
  pushVdpChanges(i: In<'pushVdpChanges'>): Out<'pushVdpChanges'>;
  /** D-69: search VDP companies for Change… (read-only: the mirror, stored lookups, VDP itself when live). */
  searchVdpCompanies(i: In<'searchVdpCompanies'>): Out<'searchVdpCompanies'>;
  /** D-69: your company mapping for a node (user-locked, undoable, local). */
  setVdpIdentity(i: In<'setVdpIdentity'>): Out<'setVdpIdentity'>;
  /** D-69: reset a node to the app's own decision. */
  clearVdpIdentity(i: In<'clearVdpIdentity'>): Out<'clearVdpIdentity'>;
  getAccount(i: In<'getAccount'>): Out<'getAccount'>;
  /** Needs you: every Snooze / Not needed decision on a needs row (Deals, the account page, Home ▸ Log & fix). */
  listNeedDecisions(i: In<'listNeedDecisions'>): Out<'listNeedDecisions'>;
  /** Set needs rows aside (one decision per subject, one audited change set, Undo); nothing leaves the app. */
  decideNeed(i: In<'decideNeed'>): Out<'decideNeed'>;
  /** Bring set-aside rows back (drop their decisions; audited, Undo). */
  clearNeedDecision(i: In<'clearNeedDecision'>): Out<'clearNeedDecision'>;
  /** D-58: Deal Contribution requests (the DCs to claim on the next logging canvas, with where each one is). */
  getUseCaseSync(i: In<'getUseCaseSync'>): Out<'getUseCaseSync'>;
  listDcRequests(i: In<'listDcRequests'>): Out<'listDcRequests'>;
  /** D-58: claim a DC on an opportunity the app has (app id or Org62 id); approved, audited + undoable; nothing is sent. */
  addOrg62Opps(i: In<'addOrg62Opps'>): Out<'addOrg62Opps'>;
  createDcRequest(i: In<'createDcRequest'>): Out<'createDcRequest'>;
  /** Edit a DC request still waiting for a canvas (re-checked against my DC); refused once on a canvas, with why. */
  patchDcRequest(i: In<'patchDcRequest'>): Out<'patchDcRequest'>;
  /** Withdraw a DC request still waiting for a canvas; refused once on a canvas, with why. */
  withdrawDcRequest(i: In<'withdrawDcRequest'>): Out<'withdrawDcRequest'>;
  /** 2026-11-13 audit C7: withdraw several waiting DC requests in one change set (one Undo); the others are skipped, with why. */
  withdrawDcRequests(i: In<'withdrawDcRequests'>): Out<'withdrawDcRequests'>;
  /** One Claim verb: a DC request on the finding's opp (a task only when the app doesn't know the opp). */
  claimMissed(i: In<'claimMissed'>): Out<'claimMissed'>;
  dismissMissed(i: In<'dismissMissed'>): Out<'dismissMissed'>;

  // Briefs and watches
  getBriefs(i: In<'getBriefs'>): Out<'getBriefs'>;
  getBrief(i: In<'getBrief'>): Out<'getBrief'>;
  promoteHighlight(i: In<'promoteHighlight'>): Out<'promoteHighlight'>;
  taskFromHighlight(i: In<'taskFromHighlight'>): Out<'taskFromHighlight'>;
  dismissHighlight(i: In<'dismissHighlight'>): Out<'dismissHighlight'>;
  listWatches(i: In<'listWatches'>): Out<'listWatches'>;
  createWatch(i: In<'createWatch'>): Out<'createWatch'>;
  patchWatch(i: In<'patchWatch'>): Out<'patchWatch'>;

  // Triage
  getTriage(i: In<'getTriage'>): Out<'getTriage'>;
  acceptTriage(i: In<'acceptTriage'>): Out<'acceptTriage'>;
  dismissTriage(i: In<'dismissTriage'>): Out<'dismissTriage'>;
  mergeTriage(i: In<'mergeTriage'>): Out<'mergeTriage'>;

  // Health
  getHealth(i: In<'getHealth'>): Out<'getHealth'>;
  /** D0: Spend & decisions for a period, and one day's calls and decisions. */
  getSpendAudit(i: In<'getSpendAudit'>): Out<'getSpendAudit'>;
  getSpendAuditDetail(i: In<'getSpendAuditDetail'>): Out<'getSpendAuditDetail'>;
  reauthConnector(i: In<'reauthConnector'>): Out<'reauthConnector'>;
  scanConnector(i: In<'scanConnector'>): Out<'scanConnector'>;
  getScans(i: In<'getScans'>): Out<'getScans'>;
  getJobs(i: In<'getJobs'>): Out<'getJobs'>;
  retryJob(i: In<'retryJob'>): Out<'retryJob'>;
  /** D-57: version, sha, build time, latest applied migration, persona, the worker's version and whether they differ. */
  getVersion(i: In<'getVersion'>): Out<'getVersion'>;
  getEventLog(i: In<'getEventLog'>): Out<'getEventLog'>;
  ackEvent(i: In<'ackEvent'>): Out<'ackEvent'>;

  // Settings and policy
  getSettings(i: In<'getSettings'>): Out<'getSettings'>;
  patchSettings(i: In<'patchSettings'>): Out<'patchSettings'>;
  raiseBudgetToday(i: In<'raiseBudgetToday'>): Out<'raiseBudgetToday'>;
  previewPolicy(i: In<'previewPolicy'>): Out<'previewPolicy'>;
  applyPolicy(i: In<'applyPolicy'>): Out<'applyPolicy'>;
  revertPolicy(i: In<'revertPolicy'>): Out<'revertPolicy'>;
  getPolicyVersions(i: In<'getPolicyVersions'>): Out<'getPolicyVersions'>;

  // Universal
  undoAudit(i: In<'undoAudit'>): Out<'undoAudit'>;
  search(i: In<'search'>): Out<'search'>;
  getSince(i: In<'getSince'>): Out<'getSince'>;
  /**
   * MIN-27: the browser says when the user last left (`x-cc-away-since`, ms). The since-you-left start
   * (`meta.lastActiveAt`) moves forward to it, never back. Optional: the mock keeps its seeded start.
   */
  notePresence?(awaySinceMs: number): Promise<void>;
  /** People search for @-mentions and recipient pickers (q over name, email, Slack id, role, title, account). */
  getPeople(i: In<'getPeople'>): Out<'getPeople'>;

  // Chat
  listChatThreads(i: In<'listChatThreads'>): Out<'listChatThreads'>;
  /** New empty thread (optional title + context). Not audited, like chat messages. */
  createChatThread(i: In<'createChatThread'>): Out<'createChatThread'>;
  getChatThread(i: In<'getChatThread'>): Out<'getChatThread'>;
  /**
   * One turn. Yields `start` first (ids + model = body.model ?? settings.chat.defaultModel), then the
   * script's events, then `done` or `error`. Persists the user and assistant messages with every part
   * (see ChatMessage). Chat-made changes are audited with actor `chat` and never add userLockedFields.
   */
  chat(i: WithSignal<In<'chat'>>): Stream<'chat'>;

  // Read-ins (BE-READIN): research runs in the worker; the suggested reply is an Outbox draft, never sent.
  getReadIn(i: In<'getReadIn'>): Out<'getReadIn'>;
  requestReadIn(i: In<'requestReadIn'>): Out<'requestReadIn'>;

  // Onboarding (B-079): first-launch setup. Mock: reachable, never required. Db: required with no user or an
  // unfinished one; completing runs bootstrapUser(). The Sources step only reads status, never starts auth.
  getOnboarding(i: In<'getOnboarding'>): Out<'getOnboarding'>;
  saveOnboardingStep(i: In<'saveOnboardingStep'>): Out<'saveOnboardingStep'>;
  getOnboardingSources(i: In<'getOnboardingSources'>): Out<'getOnboardingSources'>;
  completeOnboarding(i: In<'completeOnboarding'>): Out<'completeOnboarding'>;

  // lane A: Specialist Forecast (Time ▸ Forecast; persona feature specialistForecast). Never calls Org62.
  getForecast(i: In<'getForecast'>): Out<'getForecast'>;
  getForecastRecord(i: In<'getForecastRecord'>): Out<'getForecastRecord'>;
  syncForecast(i: In<'syncForecast'>): Out<'syncForecast'>;
  draftForecastNotes(i: In<'draftForecastNotes'>): Out<'draftForecastNotes'>;
  patchForecast(i: In<'patchForecast'>): Out<'patchForecast'>;
  stageForecast(i: In<'stageForecast'>): Out<'stageForecast'>;
  checkMissingForecast(i: In<'checkMissingForecast'>): Out<'checkMissingForecast'>;

  // Feedback (D-56) // lane D: Report a bug / idea. Diagnose reads only (spend on the Assistant line); stage makes ONE
  // ready Outbox item (feedback.post) to the server-resolved channel; Send is dispatchDraft (dry run applies).
  getFeedback(i: In<'getFeedback'>): Out<'getFeedback'>;
  diagnoseFeedback(i: In<'diagnoseFeedback'>): Out<'diagnoseFeedback'>;
  stageFeedback(i: In<'stageFeedback'>): Out<'stageFeedback'>;

  // Guide: the Getting started checklist from real state (src/guide/checklist.ts).
  getGuide(i: In<'getGuide'>): Out<'getGuide'>;
  /** README.md from the app's folder, read-only. */
  getReadme(i: In<'getReadme'>): Out<'getReadme'>;

  // Live events (SSE). The route adds `hello` and heartbeats.
  events(i: WithSignal<In<'events'>>): Stream<'events'>;

  // Dev (mock only; the db implementation throws not_found)
  getScenario(i: In<'getScenario'>): Out<'getScenario'>;
  controlScenario(i: In<'controlScenario'>): Out<'controlScenario'>;
  getDevFail(i: In<'getDevFail'>): Out<'getDevFail'>;
  setDevFail(i: In<'setDevFail'>): Out<'setDevFail'>;
  devEngineChange(i: In<'devEngineChange'>): Out<'devEngineChange'>;

  /** Current dev failure rate (0 = off); consulted by the route handler for every non-dev request. */
  failRate(): number;
}

// Compile-time guarantee: the interface has exactly one method per route.
type RouteMethods = Omit<DataSource, 'kind' | 'failRate' | 'notePresence'>;
type AssertExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const DATASOURCE_COVERS_ROUTES: AssertExact<keyof RouteMethods, RouteKey> = true;
