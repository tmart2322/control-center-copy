/**
 * The read model: every contract collection of one user, mapped from Postgres rows (store/*.ts).
 *
 * Pages are compositions over several collections (Today touches nearly all of them), and this is a
 * single-user, local database of a few thousand rows, so a request loads the user's collections once
 * and composes from memory. Selection and ordering that DATA-MODEL §6 specifies (Q1 ranked lanes, Q6
 * closed-for-you, Q9 triage, Q13 history, Q16 briefs, …) run as SQL in views.ts / audit.ts against
 * the same transaction snapshot.
 */
import { eq } from 'drizzle-orm';

import type {
  Account,
  ActivityEntry,
  AgentRun,
  Asset,
  Brief,
  CalendarEvent,
  ChatThreadDetail,
  Connector,
  Draft,
  EventLogEntry,
  Evidence,
  Initiative,
  Job,
  MappingQuestion,
  MissedOpp,
  NbaCard,
  Opportunity,
  Person,
  PolicyVersion,
  Proposal,
  ScanRun,
  Settings,
  SpendSummary,
  SpineSlot,
  ToolAdapter,
  ToolRun,
  WatchSubscription,
  WorkItemRecord,
} from '@/contract';
import { ClosingSettings, FeedbackSettings, GuideSettings, PersonaSettings, DEFAULT_CHAT_SETTINGS, DEFAULT_CLOSING_SETTINGS, DEFAULT_SCANNING_SETTINGS, vdpRefreshCommand, DEFAULT_TIME_SETTINGS, DisplaySettings, ScanningSettings, TimeSettings } from '@/contract';
import type { Db } from '@/db/client';
import { users } from '@/db/schema';

import { loadKv } from './ext';
import { readInStates, withReadInStates } from './readin';
import { loadAppRuns, loadSessions, loadToolAdapters, loadToolRuns } from './store/agents';
import { loadBriefs, loadWatches } from './store/briefs';
import type { ReadCtx } from './store/common';
import { loadAccounts, loadAssets, loadCalendarEvents, loadOpportunities, loadPeople, loadPersonRefs } from './store/entities';
import { loadConnectors, loadEventLog, loadJobs, loadScanRuns, loadSpend } from './store/health';
import { loadChat, loadMappings, loadMissed, loadSlots } from './store/misc';
import { loadDrafts, loadNbas } from './store/nba';
import { loadPolicies, loadSettingsSections, readMeta, type MetaState, type PolicyEngineState } from './store/settings';
import { loadActivity, loadTimeBlocks, loadVocab, type TimeBlockRec, type Vocab } from './store/time';
import { loadEvidence, loadInitiatives, loadProposals, loadWorkItems } from './store/work';
import { sendingOf } from '@/outbox/settings';

export interface Collections {
  people: Person;
  accounts: Account;
  opps: Opportunity;
  missedOpps: MissedOpp;
  initiatives: Initiative;
  workItems: WorkItemRecord;
  evidence: Evidence;
  nbas: NbaCard;
  drafts: Draft;
  proposals: Proposal;
  assets: Asset;
  events: CalendarEvent;
  slots: SpineSlot;
  agentRuns: AgentRun;
  toolAdapters: ToolAdapter;
  toolRuns: ToolRun;
  activity: ActivityEntry;
  timeBlocks: TimeBlockRec;
  briefs: Brief;
  watches: WatchSubscription;
  connectors: Connector;
  scanRuns: ScanRun;
  jobs: Job;
  eventLog: EventLogEntry;
  chatThreads: ChatThreadDetail;
  mappings: MappingQuestion;
  policyVersions: PolicyVersion;
}
export type CollectionName = keyof Collections;

const KEY: { [K in CollectionName]: (v: Collections[K]) => string } = {
  people: (v) => v.id,
  accounts: (v) => v.id,
  opps: (v) => v.id,
  missedOpps: (v) => v.id,
  initiatives: (v) => v.id,
  workItems: (v) => v.id,
  evidence: (v) => v.id,
  nbas: (v) => v.id,
  drafts: (v) => v.id,
  proposals: (v) => v.id,
  assets: (v) => v.id,
  events: (v) => v.id,
  slots: (v) => v.id,
  agentRuns: (v) => v.id,
  toolAdapters: (v) => v.id,
  toolRuns: (v) => v.id,
  activity: (v) => v.id,
  timeBlocks: (v) => v.id,
  briefs: (v) => v.id,
  watches: (v) => v.id,
  connectors: (v) => v.id,
  scanRuns: (v) => v.id,
  jobs: (v) => v.id,
  eventLog: (v) => v.id,
  chatThreads: (v) => v.thread.id,
  mappings: (v) => v.id,
  policyVersions: (v) => String(v.version),
};

export class ReadModel {
  private readonly maps: { [K in CollectionName]: Map<string, Collections[K]> };

  constructor(
    readonly ctx: ReadCtx,
    data: { [K in CollectionName]: Collections[K][] },
    private readonly _meta: MetaState,
    private readonly _settings: Settings,
    private readonly _spend: SpendSummary,
    readonly extra: {
      vocab: Vocab;
      /** Tool adapter key → tool_adapters row id. */
      adapterRowId: Map<string, string>;
      /** Current priority policy row id. */
      policyRowId: string | null;
      /** Engine-only knobs of the current policy row (obligation weight, Top 3 size). */
      policyEngine: PolicyEngineState;
      /** Watches the user doesn't see (auto-managed subscriptions behind opportunity briefs). */
      autoWatchIds: Set<string>;
      /** opportunities rows that only anchor a finding. */
      findingOpps: Map<string, { name: string; accountId: string | null }>;
      connectorByKind: Map<string, string>;
    },
    /** Collections this model did not load (`loadModel({ ops: false })`): reading one throws. */
    unloaded: readonly CollectionName[] = [],
  ) {
    this.unloaded = new Set(unloaded);
    const maps = {} as { [K in CollectionName]: Map<string, Collections[K]> };
    for (const k of Object.keys(KEY) as CollectionName[]) {
      const m = new Map<string, unknown>();
      for (const v of data[k] as unknown[]) m.set((KEY[k] as (x: unknown) => string)(v), v);
      (maps as Record<string, Map<string, unknown>>)[k] = m;
    }
    this.maps = maps;
  }

  private readonly unloaded: ReadonlySet<CollectionName>;
  private col<K extends CollectionName>(col: K): Map<string, Collections[K]> {
    if (this.unloaded.has(col)) throw new Error(`read model: ${col} was not loaded (load the model with { ops: true })`);
    return this.maps[col];
  }

  get<K extends CollectionName>(col: K, id: string): Collections[K] | undefined {
    return this.col(col).get(id);
  }
  all<K extends CollectionName>(col: K): Collections[K][] {
    return [...this.col(col).values()];
  }
  meta(): MetaState {
    return this._meta;
  }
  settings(): Settings {
    return this._settings;
  }
  spend(): SpendSummary {
    return this._spend;
  }
  /** Replace one record in memory (writers re-read after commit; this keeps a mutation's own view current). */
  put<K extends CollectionName>(col: K, v: Collections[K]) {
    this.col(col).set(KEY[col](v), v);
  }
  remove<K extends CollectionName>(col: K, id: string) {
    this.col(col).delete(id);
  }
}

export class NotSeededError extends Error {
  constructor(what: string) {
    super(`CC_DATA=db: ${what}. Set the database up first: npm run db:bootstrap (or npm run setup)`);
    this.name = 'NotSeededError';
  }
}

export interface LoadModelOptions {
  /**
   * PERF-1: run the independent loaders concurrently on the pool. Only for a pool handle: a transaction is one client,
   * and pg deprecates concurrent queries on one client (they would queue anyway).
   */
  parallel?: boolean;
  /**
   * PERF-1: load the operational ledgers (`jobs`, `scanRuns`). They grow with every scan (thousands of rows within a
   * day of a first scan) and only Health's ledger, the jobs list, job retry and a manual scan read them, so pages skip
   * them. Reading an unloaded collection throws (a missed caller fails loudly instead of seeing an empty list).
   */
  ops?: boolean;
}

/** The collections `ops: false` leaves out. */
export const OPS_COLLECTIONS = ['scanRuns', 'jobs'] as const satisfies readonly CollectionName[];

/** A stored `settings.scanning` (any shape) as the contract section; a bad row never breaks the model: defaults. */
function scanningOf(v: unknown): ScanningSettings {
  const p = v ? ScanningSettings.safeParse(v) : undefined;
  return p?.success ? p.data : { ...DEFAULT_SCANNING_SETTINGS };
}

export async function loadModel(db: Db, userId: string, now: Date, opts: LoadModelOptions = {}): Promise<ReadModel> {
  const ops = opts.ops ?? true;
  // Concurrent on the pool, in order on a transaction (same results either way: the loaders share no state).
  const all = opts.parallel ? <T extends readonly unknown[]>(fns: { [K in keyof T]: () => Promise<T[K]> }) => Promise.all(fns.map((f) => f())) as unknown as Promise<T> : async <T extends readonly unknown[]>(fns: { [K in keyof T]: () => Promise<T[K]> }) => {
    const out: unknown[] = [];
    for (const f of fns) out.push(await f());
    return out as unknown as T;
  };
  const kv = await loadKv(db, userId);
  const meta = readMeta({ kv });
  if (!meta) throw new NotSeededError('no meta for this user');
  const base = { db, userId, kv };
  const [[u], { people, managerId }, sections, pol] = await all([() => db.select().from(users).where(eq(users.id, userId)), () => loadPeople(base), () => loadSettingsSections(base), () => loadPolicies(base)] as const);
  if (!u) throw new NotSeededError(`user ${userId} does not exist`);
  const personRefs = await loadPersonRefs(base, managerId);
  if (!pol.current || !sections.profile || !sections.sending || !sections.budgets || !sections.display || !sections.agentBehavior) throw new NotSeededError('settings are incomplete');
  const settings: Settings = { profile: sections.profile, policy: pol.current, agentBehavior: sections.agentBehavior, sending: sendingOf(sections.sending), budgets: sections.budgets, display: DisplaySettings.parse(sections.display), chat: sections.chat ?? { ...DEFAULT_CHAT_SETTINGS }, time: timeSettingsOf(sections.time), scanning: scanningOf(sections.scanning), closing: sections.closing ? ClosingSettings.parse(sections.closing) : { ...DEFAULT_CLOSING_SETTINGS }, persona: PersonaSettings.parse(sections.persona ?? { version: 1 }), feedback: FeedbackSettings.parse(sections.feedback ?? { version: 1 }), guide: GuideSettings.parse(sections.guide ?? { version: 1 }) };
  const rc: ReadCtx = {
    db,
    userId,
    me: { id: u.personId ?? userId, name: u.displayName ?? meta.user.name },
    timezone: settings.profile.timezone,
    kv,
    people: personRefs,
    now,
  };

  const none = async () => [] as never[];
  const [accounts, { opps, findingOnly }, vocab, adapters, sessions, appRuns, watchRows, connectors, rawItems, readIns, initiatives, drafts, evidence, nbas, assets, events, timeBlocks, scanRunRows, jobRows, eventLog, chatThreads, spend] = await all([
    () => loadAccounts(rc),
    () => loadOpportunities(rc),
    () => loadVocab(db, userId),
    () => loadToolAdapters(rc),
    () => loadSessions(rc),
    () => loadAppRuns(rc),
    () => loadWatches(rc),
    () => loadConnectors(rc, { vdpCommand: vdpRefreshCommand(settings.scanning) }),
    () => loadWorkItems(rc),
    () => readInStates(db, userId), // BE-READIN
    () => loadInitiatives(rc),
    () => loadDrafts(rc),
    () => loadEvidence(rc),
    () => loadNbas(rc),
    () => loadAssets(rc),
    () => loadCalendarEvents(rc),
    () => loadTimeBlocks(rc),
    ops ? () => loadScanRuns(rc) : none,
    ops ? () => loadJobs(rc) : none,
    () => loadEventLog(rc),
    () => loadChat(rc),
    () => loadSpend(rc, settings.budgets, !!(meta as MetaState & { seedHash?: string }).seedHash),
  ] as const);
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const oppById = new Map(opps.map((o) => [o.id, o]));
  const oppInfo = (id: string) => {
    const o = oppById.get(id);
    if (o) return { name: o.name, stage: o.stage, amount: o.amount, closeDate: o.closeDate, accountName: accountName.get(o.accountId) ?? null };
    const f = findingOnly.get(id);
    return f ? { name: f.name, stage: f.stage, amount: f.amount, closeDate: f.closeDate, accountName: f.accountId ? (accountName.get(f.accountId) ?? null) : null } : null;
  };
  const adapterKey = new Map(adapters.map((a) => [a.rowId, a.manifest.id]));
  const watchInfo = new Map(watchRows.map((w) => [w.id, { targetKind: w.targetKind, label: w.label, accountId: null, oppId: null }]));
  const workItems = withReadInStates(rawItems, readIns);
  const itemTitle = new Map(workItems.map((w) => [w.id, w.title]));
  const initiativeTitle = new Map(initiatives.map((i) => [i.id, i.title]));
  const labelOf = (type: string, id: string) => {
    if (type === 'work_item') return itemTitle.get(id) ?? id;
    if (type === 'draft') return 'Draft body';
    if (type === 'initiative') return initiativeTitle.get(id) ?? id;
    return id;
  };
  const [{ runs: toolRuns, mirrors }, missedOpps, proposals, activity, briefs] = await all([
    () => loadToolRuns(rc, adapterKey),
    () => loadMissed(rc, oppInfo),
    () => loadProposals(rc, labelOf),
    () => loadActivity(rc, vocab, oppInfo),
    () => loadBriefs(rc, watchInfo),
  ] as const);

  const data: { [K in CollectionName]: Collections[K][] } = {
    people,
    accounts,
    opps,
    missedOpps,
    initiatives,
    workItems,
    evidence,
    nbas,
    drafts,
    proposals,
    assets,
    events,
    slots: loadSlots(rc),
    agentRuns: [...sessions, ...appRuns, ...mirrors],
    toolAdapters: adapters.map(({ rowId: _r, ...a }) => a),
    toolRuns,
    activity,
    timeBlocks,
    briefs,
    watches: watchRows.filter((w) => !w.autoManaged).map(({ autoManaged: _a, ...w }) => w),
    connectors,
    scanRuns: scanRunRows,
    jobs: jobRows,
    eventLog,
    chatThreads,
    mappings: loadMappings(rc),
    policyVersions: pol.versions,
  };
  return new ReadModel(rc, data, meta, settings, spend, {
    vocab,
    adapterRowId: new Map(adapters.map((a) => [a.manifest.id, a.rowId])),
    policyRowId: pol.currentRowId,
    policyEngine: pol.engine,
    autoWatchIds: new Set(watchRows.filter((w) => w.autoManaged).map((w) => w.id)),
    findingOpps: new Map([...findingOnly].map(([id, r]) => [id, { name: r.name, accountId: r.accountId }])),
    connectorByKind: new Map(connectors.map((c) => [c.source, c.id])),
  }, ops ? [] : OPS_COLLECTIONS);
}

/** Settings ▸ Time (onsite lane): the saved section over the defaults (older users have none). */
function timeSettingsOf(v: unknown): Settings['time'] {
  const r = TimeSettings.safeParse(v);
  return r.success ? r.data : { ...DEFAULT_TIME_SETTINGS, onsiteHours: { ...DEFAULT_TIME_SETTINGS.onsiteHours } };
}
