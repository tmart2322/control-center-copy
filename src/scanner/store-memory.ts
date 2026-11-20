/**
 * InMemoryScannerStore: the reference implementation of `ScannerStore` (src/scanner/types.ts).
 *
 * Every scanner test runs against it, and BE-1's Postgres store must mirror these semantics exactly.
 * The rules, in one place (numbers are referenced from the BE-2a return notes):
 *
 *  S1  Runs. `startRun` opens a run in status `running`. Only a running run accepts writes; any write to
 *      a finished/failed/unknown run throws `RunStateError`.
 *  S2  Source items are keyed by `dedupeKey` (one owner). Insert → `isNew`. Same key + different
 *      `contentHash` → update in place, `changed` (revision + 1). Same key + same hash → no-op. The
 *      `sourceItemId` for a key never changes. The connector must match the run's connector.
 *      Excerpts are capped at 1000 chars.
 *  S3  Evidence is unique on (workItemId, sourceItemId, role). A repeat returns the existing
 *      `evidenceId` and creates nothing. Evidence updates the work item's digest (people, accounts,
 *      threadRefs, fileRefs, lastEvidenceAt).
 *  S4  `proposeItem` is idempotent on (kind, sorted sourceItemIds of `origin` evidence, or of all
 *      evidence when none is `origin`). A repeat returns the existing item and only adds missing
 *      evidence rows. Landing: `sure` → open; `likely` → open + new badge; `guess` → suggested (Triage).
 *  S5  `proposeInitiative` is idempotent on (normalized title, sorted workItemIds); it sets
 *      `initiativeId` on member items that have none.
 *  S6  `flagUnlinked`: one row per source item. Attempts = failed linking attempts. A non-reconcile run
 *      sets attempts = max(attempts, 1) (rescans never escalate); a `reconcile` run adds 1, at most once
 *      per run. Reasons starting with `deferred:` (budget pause) never count as an attempt. An item with
 *      any evidence row is no longer unlinked.
 *  S7  Coverage reported during a run is STAGED on the run. `finishRun` commits it; `failRun` keeps it
 *      with outcome `error`, and error coverage never counts for gaps, cursors or objects.
 *  S8  `finishRun` (one atomic step): (a) the run must be running; (b) `cursor.at` must lie within
 *      [window.from, window.to] (±1 s); (c) committed coverage of the scope plus this run's staged
 *      coverage must span [window.from, cursor.at) with no hole longer than the tolerance (1 s), else
 *      `CoverageError` and nothing changes (the caller then calls failRun); (d) commit staged coverage,
 *      mark the run succeeded, store the proposed cursor on the run; (e) advance the scope cursor
 *      (S9); (f) return and clear the scope's pending re-evaluation set (S10).
 *  S9  The cursor only moves forward and only over contiguous committed coverage. From the current
 *      cursor (or, for a first run, the scope's low watermark = earliest committed coverage start),
 *      find the end of the contiguous covered interval. The new cursor is the proposed cursor, among
 *      this run and earlier succeeded runs of the scope, with the greatest `at` that is > the current
 *      `at` and ≤ that end. A head run during catch-up therefore commits coverage but leaves the cursor
 *      where it is; when backfill closes the hole, the cursor fast-forwards to the head run's cursor.
 *  S10 Work items that get NEW evidence or are newly proposed join the scope's pending re-evaluation
 *      set, whether or not the run later fails. The next successful `finishRun` of that scope returns
 *      them as `touchedWorkItemIds`, so a killed run's touches are never lost and an idempotent re-run
 *      that creates nothing still fans out.
 *  S11 `coverageGaps(scope, window)` = parts of `window` not covered by committed coverage, clipped
 *      below at the scope's low watermark. A scope with no committed coverage returns [window].
 *  S12 `uncoveredObjects`: a listed object is covered by committed coverage of the scope with the same
 *      kind and ref whose `to` ≥ the listed `to` (when given), or, when the listed object carries
 *      `meta.parentRef` and `from`, by a committed range on that parent ref containing `from`.
 *  S13 `recordSpend` with costUsd ≤ 0 is a pure read (no row). Totals are per local day (`dayKey`).
 *  S14 `getContext` returns the seeded profile, the scope cursor, the gaps of the last 7 days, open
 *      work items plus items done within the reopen window (14 days, so requirement changes can link
 *      `contradiction`), and `skillVersion` = the skill version of the scope's latest succeeded run.
 *  S15 R-UI-22: work items carry optional `resolution` and `involvement`; digests and candidates
 *      expose them so linking can treat handed-off/watcher items as context-only. Digests also carry
 *      `expected` (R-UI-15 deliverable expectations).
 *  S16 `watch` runs may record items of the watched source (`slack`, `org62`) besides their own
 *      `watch` plan notes, so a Slack message has ONE row (`slack:<channel>:<ts>`) whoever saw it.
 *  S17 Thread joins are exact string matches. A thread ref `cc:<workItemId>` (sessions the app
 *      launched for an item) joins that work item directly (score 1.0).
 *  S18 `recordBriefHighlights` is idempotent on (subscription kind, ref, period.from, period.to): a
 *      repeat replaces the summary and highlights and returns the same `briefId`. Every cited
 *      `sourceItemId` must exist.
 */
import { deliveryMatch } from './delivery';
import { personaOf } from '../personas';
import type { ResolvedPersona } from '../personas/types';
import { traceContext } from './trace';
import { noteLedgerGaps } from '../db/ledger';
import type {
  Candidate,
  ConnectorHealthProbe,
  ConnectorId,
  Confidence,
  ConversationLine,
  CoverageObject,
  Cursor,
  EvidenceRole,
  NormalizedSourceItem,
  OpenItemDigest,
  ProposeItemInput,
  ScanContext,
  ScannerStore,
  ScanningPrefs,
  ScanRunStats,
  ScanTrigger,
  ScopeKey,
  SpendBooked,
  SpendRead,
  TimeWindow,
} from './types';
import { DEFAULT_SCANNING_PREFS, scopeId } from './types';
import type { BriefHighlightsInput, CandidateExt, Involvement, OpenItemDigestExt, Resolution, UnlinkedSourceItemDetail } from './runtime/contract-ext';
import type { CompletionEvidence, CompletionItem, CompletionSource } from './completion/types';
import { pastDueOnArrival, pastDueReason, staleOnArrival, stillNeededReason } from '@/engines/still-needed';
import { nameWords, parseDue, sameDeliverable } from './propose-rules';

/** Completion pass: live statuses it checks (mirrors completion/types LIVE_STATUSES; a type-only import keeps this file free of a cycle). */
const COMPLETION_LIVE = ['open', 'in_progress', 'waiting_on_me', 'waiting_on_others', 'likely_done', 'suggested'] as const; // CMP-SUG: as store-db

export class RunStateError extends Error {
  override name = 'RunStateError';
}
export class CoverageError extends Error {
  override name = 'CoverageError';
}
export class NotFoundError extends Error {
  override name = 'NotFoundError';
}

export interface StoreClock {
  now(): Date;
}

export interface StoreProfile {
  me: ScanContext['me'];
  watchList?: ScanContext['watchList'];
  aliases?: ScanContext['aliases'];
  /** Settings ▸ Scanning (absent: the defaults). */
  scanning?: ScanningPrefs;
  /** D-55: the resolved persona (absent: none in the context, which reads as the SE persona). */
  persona?: ResolvedPersona;
}

export interface InMemoryStoreOptions {
  clock?: StoreClock;
  profile?: StoreProfile;
  softCapUsd?: number;
  hardCapUsd?: number;
  /** Max hole (ms) still treated as contiguous. Default 1000. */
  toleranceMs?: number;
  /** Local-day key for spend totals. Default: UTC date. */
  dayKey?: (d: Date) => string;
  /** Done items stay link candidates this long (requirement changes → contradiction). Default 14 d. */
  reopenWindowMs?: number;
  /** The user's timezone: a bare due date is 17:00 there (DUE-1). Default UTC. */
  timeZone?: string;
}

type WorkState = 'open' | 'suggested' | 'in_progress' | 'waiting_on_me' | 'done' | 'dismissed' | 'merged' | string;

interface SourceItemRow extends NormalizedSourceItem {
  id: string;
  revision: number;
  firstRunId: string;
  lastRunId: string;
}

interface WorkItemRow {
  id: string;
  kind: string;
  title: string;
  purpose?: string;
  state: WorkState;
  landedAs: 'open' | 'suggested';
  newBadge: boolean;
  confidence: Confidence;
  due?: string;
  effort?: ProposeItemInput['effort'];
  initiativeId?: string;
  accountId?: string;
  oppId?: string;
  expected?: ProposeItemInput['expected'];
  /** Why it landed where it did (DEEP-1 / PAST-1 "Still needed?"). */
  statusReason?: string;
  people: Set<string>;
  accounts: Set<string>;
  keywords: Set<string>;
  threadRefs: Set<string>;
  fileRefs: Set<string>;
  lastEvidenceAt?: string;
  doneAt?: string;
  resolution?: Resolution;
  involvement?: Involvement;
  handedOffTo?: string;
  originKey: string;
  createdRunId?: string;
}

interface EvidenceRow {
  id: string;
  workItemId: string;
  sourceItemId: string;
  role: EvidenceRole;
  confidence: Confidence;
  reason: string;
  runId: string;
  skillVersion?: string;
}

interface InitiativeRow {
  id: string;
  key: string;
  title: string;
  purpose: string;
  accountId?: string;
  oppId?: string;
  workItemIds: string[];
  accounts: string[];
  keywords: string[];
}

interface RunRow {
  id: string;
  scope: ScopeKey;
  scopeId: string;
  trigger: ScanTrigger;
  window: TimeWindow;
  model?: string;
  skillVersion?: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: string;
  finishedAt?: string;
  cursorBefore: Cursor | null;
  cursorAfter?: Cursor;
  stats?: ScanRunStats | Partial<ScanRunStats>;
  summary?: string;
  error?: string;
  errorClass?: ConnectorHealthProbe['errorClass'];
  staged: CoverageObject[];
  flagged: Set<string>;
  seen: Map<string, 'new' | 'changed' | 'unchanged'>;
}

export interface LedgerRow {
  runId: string;
  scopeId: string;
  object: CoverageObject;
  fromMs?: number;
  toMs?: number;
  outcome: 'complete' | 'error';
}

interface UnlinkedRow {
  sourceItemId: string;
  attempts: number;
  reason: string;
  hints: string[];
  deferred: boolean;
  lastFlaggedAt: string;
  /** MAP-1: no mapping question (not an ask or commitment of mine): never listed again. */
  ignored?: string;
}

const DAY = 86_400_000;
const STOP = new Set(
  'the and for with that this from have will your you are was were but not all any can our out about into over then them they their there what when where which while would could should just also than been being does done its it’s i’ll ill lets let send sent please thanks thank hey team need needs more some'.split(
    ' ',
  ),
);

export function tokenize(text: string | undefined): string[] {
  if (!text) return [];
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, ' ')
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3 && !STOP.has(t)),
    ),
  ];
}

const normPerson = (s: string) => s.trim().toLowerCase();

/** Parse an ISO string, a Slack ts ("1730812345.000100") or epoch seconds/millis into ms. */
export function toMs(v: string | undefined): number | undefined {
  if (v == null || v === '') return undefined;
  if (/^\d{9,11}(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  if (/^\d{12,14}$/.test(v)) return Number(v);
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

const iso = (ms: number) => new Date(ms).toISOString();

interface Range {
  from: number;
  to: number;
}

/** Time-range coverage kinds (queries over a window), as opposed to objects (threads, files, records). */
const TIME_RANGE_KINDS = new Set<CoverageObject['kind']>(['query_window', 'channel_range', 'mailbox_range', 'calendar_range']);

/**
 * S8c: an INCOMPLETE run (cursor.at before window.to) covered its window only up to its cursor. Time ranges that
 * claim more are clamped to the cursor before commit, so one query's full window cannot mask another query's
 * paged-out end (stress finding C-1: the rest of the window would otherwise vanish from coverageGaps when the
 * continuation is lost). Objects keep their own ranges.
 */
export function clampToCursor(objects: CoverageObject[], cursorAtMs: number): CoverageObject[] {
  return objects.map((o) => {
    if (!TIME_RANGE_KINDS.has(o.kind)) return o;
    const from = toMs(o.from);
    const to = toMs(o.to);
    if (from == null || to == null || to <= cursorAtMs) return o;
    return { ...o, to: new Date(Math.max(from, cursorAtMs)).toISOString(), meta: { ...(o.meta ?? {}), clampedFrom: o.to } };
  });
}

export function mergeRanges(ranges: Range[], tol: number): Range[] {
  const sorted = ranges.filter((r) => r.to > r.from).sort((a, b) => a.from - b.from);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to + tol) last.to = Math.max(last.to, r.to);
    else out.push({ ...r });
  }
  return out;
}

export class InMemoryScannerStore implements ScannerStore {
  private readonly clock: StoreClock;
  private readonly tol: number;
  private readonly reopenWindowMs: number;
  private readonly dayKey: (d: Date) => string;
  private readonly timeZone: string;
  softCapUsd: number;
  hardCapUsd: number;
  profile: StoreProfile;

  private seq = 0;
  private readonly sourceItems = new Map<string, SourceItemRow>(); // by id
  private readonly byDedupe = new Map<string, string>(); // dedupeKey → id
  private readonly workItems = new Map<string, WorkItemRow>();
  private readonly byOriginKey = new Map<string, string>();
  private readonly evidence = new Map<string, EvidenceRow>(); // by `${w}|${s}|${role}`
  private readonly initiatives = new Map<string, InitiativeRow>();
  private readonly runs = new Map<string, RunRow>();
  private readonly cursors = new Map<string, Cursor>();
  private readonly ledgerRows: LedgerRow[] = [];
  private readonly unlinked = new Map<string, UnlinkedRow>();
  /** TRI-NOISE: the latest triage verdict per source item (cleared when its content changes). */
  private readonly verdicts = new Map<string, { v: 'act' | 'noise' | 'unsure'; why?: string }>();
  private readonly pendingReeval = new Map<string, Set<string>>();
  private readonly healthLog = new Map<ConnectorId, ConnectorHealthProbe[]>();
  private readonly spend: Array<{ day: string; connector: string; model: string; costUsd: number; runId?: string; budget: 'daily' | 'first_scan' }> = [];
  private readonly briefs = new Map<string, BriefHighlightsInput & { briefId: string; runId: string }>();

  constructor(opts: InMemoryStoreOptions = {}) {
    this.clock = opts.clock ?? { now: () => new Date() };
    this.tol = opts.toleranceMs ?? 1000;
    this.reopenWindowMs = opts.reopenWindowMs ?? 14 * DAY;
    this.timeZone = opts.timeZone ?? 'UTC';
    this.dayKey = opts.dayKey ?? ((d) => d.toISOString().slice(0, 10));
    this.softCapUsd = opts.softCapUsd ?? 12;
    this.hardCapUsd = opts.hardCapUsd ?? 15;
    this.profile = opts.profile ?? { me: { userId: 'user_1', name: 'ME' } };
  }

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  private nowIso(): string {
    return this.clock.now().toISOString();
  }

  // ------------------------------------------------------------------ seeding / inspection (tests, dev)

  seedProfile(p: StoreProfile): void {
    this.profile = p;
  }

  /** Insert an existing work item (as BE-1 data would hold). Returns its id. */
  seedWorkItem(w: {
    id?: string;
    kind: string;
    title: string;
    purpose?: string;
    state?: WorkState;
    people?: string[];
    accounts?: string[];
    keywords?: string[];
    threadRefs?: string[];
    fileRefs?: string[];
    initiativeId?: string;
    lastEvidenceAt?: string;
    doneAt?: string;
    resolution?: Resolution;
    involvement?: Involvement;
    handedOffTo?: string;
  }): string {
    const id = w.id ?? this.id('wi');
    const row: WorkItemRow = {
      id,
      kind: w.kind,
      title: w.title,
      purpose: w.purpose,
      state: w.state ?? 'open',
      landedAs: 'open',
      newBadge: false,
      confidence: 'sure',
      people: new Set((w.people ?? []).map(normPerson)),
      accounts: new Set(w.accounts ?? []),
      keywords: new Set([...(w.keywords ?? []).map((k) => k.toLowerCase()), ...tokenize(w.title)]),
      threadRefs: new Set(w.threadRefs ?? []),
      fileRefs: new Set(w.fileRefs ?? []),
      initiativeId: w.initiativeId,
      lastEvidenceAt: w.lastEvidenceAt,
      doneAt: w.doneAt,
      resolution: w.resolution,
      involvement: w.involvement,
      handedOffTo: w.handedOffTo,
      originKey: `seed|${id}`,
    };
    this.workItems.set(id, row);
    this.byOriginKey.set(row.originKey, id);
    return id;
  }

  seedInitiative(i: { id?: string; title: string; purpose?: string; accounts?: string[]; keywords?: string[] }): string {
    const id = i.id ?? this.id('ini');
    this.initiatives.set(id, {
      id,
      key: `seed|${id}`,
      title: i.title,
      purpose: i.purpose ?? '',
      workItemIds: [],
      accounts: i.accounts ?? [],
      keywords: (i.keywords ?? []).map((k) => k.toLowerCase()),
    });
    return id;
  }

  /** Simulates BE-3 / the user changing state (e.g. marking done, handing off). */
  setWorkItemState(id: string, state: WorkState, extra: { resolution?: Resolution; involvement?: Involvement; handedOffTo?: string } = {}): void {
    const w = this.mustWork(id);
    w.state = state;
    if (state === 'done') w.doneAt = this.nowIso();
    Object.assign(w, extra);
  }

  getSourceItem(id: string): SourceItemRow | undefined {
    return this.sourceItems.get(id);
  }
  getSourceItemByDedupe(key: string): SourceItemRow | undefined {
    const id = this.byDedupe.get(key);
    return id ? this.sourceItems.get(id) : undefined;
  }
  getWorkItem(id: string) {
    const w = this.workItems.get(id);
    return w ? this.digest(w) : undefined;
  }
  listWorkItems() {
    return [...this.workItems.values()].map((w) => ({ ...this.digest(w), landedAs: w.landedAs, newBadge: w.newBadge, confidence: w.confidence, due: w.due, ...(w.statusReason ? { statusReason: w.statusReason } : {}) }));
  }
  evidenceFor(workItemId: string): EvidenceRow[] {
    return [...this.evidence.values()].filter((e) => e.workItemId === workItemId);
  }
  allEvidence(): EvidenceRow[] {
    return [...this.evidence.values()];
  }
  listRuns(scope?: ScopeKey): RunRow[] {
    const sid = scope ? scopeId(scope) : undefined;
    return [...this.runs.values()].filter((r) => !sid || r.scopeId === sid);
  }
  getRun(id: string): RunRow | undefined {
    return this.runs.get(id);
  }
  ledger(scope?: ScopeKey): LedgerRow[] {
    const sid = scope ? scopeId(scope) : undefined;
    return this.ledgerRows.filter((l) => !sid || l.scopeId === sid);
  }
  latestHealth(connector: ConnectorId): ConnectorHealthProbe | undefined {
    const h = this.healthLog.get(connector);
    return h?.[h.length - 1];
  }
  healthHistory(connector: ConnectorId): ConnectorHealthProbe[] {
    return this.healthLog.get(connector) ?? [];
  }
  spendToday(): number {
    const day = this.dayKey(this.clock.now());
    return this.spend.filter((s) => s.day === day).reduce((a, s) => a + s.costUsd, 0);
  }
  listBriefs() {
    return [...this.briefs.values()];
  }
  unlinkedRow(sourceItemId: string): UnlinkedRow | undefined {
    return this.unlinked.get(sourceItemId);
  }
  counts() {
    return {
      sourceItems: this.sourceItems.size,
      workItems: this.workItems.size,
      evidence: this.evidence.size,
      initiatives: this.initiatives.size,
      runs: this.runs.size,
      ledger: this.ledgerRows.length,
      unlinked: [...this.unlinked.values()].filter((u) => !this.hasEvidence(u.sourceItemId)).length,
    };
  }

  /**
   * Id-agnostic canonical dump of the durable state, for "same final state" assertions: source items by
   * dedupeKey, work items by origin key, evidence by (item origin key, source dedupeKey, role), cursors.
   */
  stateDigest(): string {
    const siKey = (id: string) => this.sourceItems.get(id)?.dedupeKey ?? id;
    const wiKey = (id: string) => {
      const w = this.workItems.get(id);
      return w ? w.originKey.replace(/si_\d+/g, (m) => siKey(m)) : id;
    };
    const items = [...this.sourceItems.values()].map((s) => [s.dedupeKey, s.contentHash, s.revision]).sort();
    const works = [...this.workItems.values()].map((w) => [wiKey(w.id), w.kind, w.title, w.state, w.landedAs]).sort();
    const ev = [...this.evidence.values()].map((e) => [wiKey(e.workItemId), siKey(e.sourceItemId), e.role]).sort();
    const cur = [...this.cursors.entries()].sort();
    const unl = [...this.unlinked.values()]
      .filter((u) => !this.hasEvidence(u.sourceItemId))
      .map((u) => [siKey(u.sourceItemId), u.attempts])
      .sort();
    return JSON.stringify({ items, works, ev, cur, unl });
  }

  // ------------------------------------------------------------------ ScannerStore

  async getContext(scope: ScopeKey, opts: { maxOpenItems?: number } = {}): Promise<ScanContext> {
    const now = this.clock.now().getTime();
    const sid = scopeId(scope);
    const hasCoverage = this.committedRanges(sid).length > 0;
    const gaps = hasCoverage ? await this.coverageGaps(scope, { from: iso(now - 7 * DAY), to: iso(now) }) : [];
    const lastOk = [...this.runs.values()]
      .filter((r) => r.scopeId === sid && r.status === 'succeeded')
      .sort((a, b) => (a.finishedAt ?? '').localeCompare(b.finishedAt ?? ''))
      .pop();
    const openItems = [...this.workItems.values()]
      .filter((w) => this.isLinkable(w, now))
      .sort((a, b) => (b.lastEvidenceAt ?? '').localeCompare(a.lastEvidenceAt ?? ''))
      .slice(0, opts.maxOpenItems ?? 60)
      .map((w) => this.digest(w));
    return {
      scope,
      cursor: this.cursors.get(sid) ?? null,
      gaps,
      me: this.profile.me,
      watchList: this.profile.watchList ?? [],
      aliases: this.profile.aliases ?? { accounts: [], channels: [] },
      openItems,
      initiatives: [...this.initiatives.values()].map((i) => ({
        initiativeId: i.id,
        title: i.title,
        purpose: i.purpose,
        accounts: i.accounts,
        keywords: i.keywords,
      })),
      skillVersion: lastOk?.skillVersion ?? '',
      scanning: { ...DEFAULT_SCANNING_PREFS, ...(this.profile.scanning ?? {}) },
      ...(this.profile.persona ? { persona: this.profile.persona } : {}),
    };
  }

  /** D-55: the persona (absent in the profile: the SE persona). */
  async persona(): Promise<ResolvedPersona> {
    return this.profile.persona ?? personaOf({});
  }

  /** Tests: switch the persona (the runtime picks it up on its next plan pass). */
  setPersona(p: ResolvedPersona | undefined): void {
    this.profile = { ...this.profile, persona: p };
  }

  async startRun(input: { scope: ScopeKey; trigger: ScanTrigger; window: TimeWindow; model?: string; skillVersion?: string }): Promise<{ runId: string }> {
    const sid = scopeId(input.scope);
    if (toMs(input.window.from) == null || toMs(input.window.to) == null) throw new RangeError('startRun: invalid window');
    const id = this.id('run');
    this.runs.set(id, {
      id,
      scope: input.scope,
      scopeId: sid,
      trigger: input.trigger,
      window: { ...input.window },
      model: input.model,
      skillVersion: input.skillVersion,
      status: 'running',
      startedAt: this.nowIso(),
      cursorBefore: this.cursors.get(sid) ?? null,
      staged: [],
      flagged: new Set(),
      seen: new Map(),
    });
    return { runId: id };
  }

  async recordSourceItems(runId: string, items: NormalizedSourceItem[]) {
    const run = this.mustRunning(runId);
    const out: Array<{ sourceItemId: string; dedupeKey: string; isNew: boolean; changed: boolean }> = [];
    for (const raw of items) {
      if (!raw.dedupeKey || !raw.contentHash || !raw.externalId) throw new RangeError('recordSourceItems: dedupeKey, contentHash and externalId are required');
      const watchOk = run.scope.connector === 'watch' && (raw.connector === 'slack' || raw.connector === 'org62');
      if (raw.connector !== run.scope.connector && !watchOk) throw new RangeError(`recordSourceItems: item connector ${raw.connector} ≠ run connector ${run.scope.connector}`);
      const item = { ...raw, excerpt: raw.excerpt && raw.excerpt.length > 1000 ? raw.excerpt.slice(0, 1000) : raw.excerpt };
      const existingId = this.byDedupe.get(item.dedupeKey);
      if (!existingId) {
        const id = this.id('si');
        this.sourceItems.set(id, { ...item, id, revision: 1, firstRunId: runId, lastRunId: runId });
        this.byDedupe.set(item.dedupeKey, id);
        run.seen.set(item.dedupeKey, 'new');
        out.push({ sourceItemId: id, dedupeKey: item.dedupeKey, isNew: true, changed: false });
        continue;
      }
      const prev = this.sourceItems.get(existingId)!;
      if (prev.contentHash !== item.contentHash) {
        this.sourceItems.set(existingId, { ...prev, ...item, id: existingId, revision: prev.revision + 1, firstRunId: prev.firstRunId, lastRunId: runId });
        this.verdicts.delete(existingId); // an edited message is judged again
        run.seen.set(item.dedupeKey, 'changed');
        out.push({ sourceItemId: existingId, dedupeKey: item.dedupeKey, isNew: false, changed: true });
      } else {
        prev.lastRunId = runId;
        if (!run.seen.has(item.dedupeKey)) run.seen.set(item.dedupeKey, 'unchanged');
        out.push({ sourceItemId: existingId, dedupeKey: item.dedupeKey, isNew: false, changed: false });
      }
    }
    return out;
  }

  async findCandidates(q: { text?: string; people?: string[]; accounts?: string[]; threadRefs?: string[]; fileRefs?: string[]; limit?: number }): Promise<Candidate[]> {
    const now = this.clock.now().getTime();
    const tokens = new Set(tokenize(q.text));
    const people = new Set((q.people ?? []).map(normPerson).filter(Boolean));
    const accounts = new Set(this.resolveAccounts(q.accounts ?? []));
    const threads = new Set(q.threadRefs ?? []);
    const files = new Set(q.fileRefs ?? []);
    const out: CandidateExt[] = [];
    const launched = new Set([...threads].filter((t) => t.startsWith('cc:')).map((t) => t.slice(3)));

    for (const w of this.workItems.values()) {
      if (!this.isLinkable(w, now)) continue;
      if (launched.has(w.id)) {
        out.push({ workItemId: w.id, initiativeId: w.initiativeId, title: w.title, score: 1, why: 'same thread; launched from this item', state: w.state, ...(w.resolution ? { resolution: w.resolution } : {}), ...(w.involvement ? { involvement: w.involvement } : {}) });
        continue;
      }
      let score = 0;
      const why: string[] = [];
      if ([...threads].some((t) => w.threadRefs.has(t))) {
        score += 0.6;
        why.push('same thread');
      }
      if ([...files].some((f) => w.fileRefs.has(f))) {
        score += 0.5;
        why.push('same file');
      }
      const pHits = [...people].filter((p) => [...w.people].some((wp) => wp === p || wp.includes(p) || p.includes(wp)));
      if (pHits.length) {
        score += Math.min(0.3, 0.15 * pHits.length);
        why.push(`people: ${pHits.slice(0, 3).join(', ')}`);
      }
      const aHits = [...accounts].filter((a) => w.accounts.has(a));
      if (aHits.length) {
        score += 0.25;
        why.push(`account: ${aHits[0]}`);
      }
      const itemTokens = new Set([...w.keywords, ...tokenize(w.title), ...tokenize(w.purpose)]);
      const kHits = [...tokens].filter((t) => itemTokens.has(t));
      if (kHits.length) {
        score += Math.min(0.35, (0.35 * kHits.length) / Math.max(2, Math.min(tokens.size, itemTokens.size)));
        why.push(`keywords: ${kHits.slice(0, 4).join(', ')}`);
      }
      if (score >= 0.15) {
        out.push({
          workItemId: w.id,
          initiativeId: w.initiativeId,
          title: w.title,
          score: Math.min(1, Math.round(score * 100) / 100),
          why: why.join('; '),
          state: w.state,
          ...(w.resolution ? { resolution: w.resolution } : {}),
          ...(w.involvement ? { involvement: w.involvement } : {}),
        });
      }
    }
    for (const i of this.initiatives.values()) {
      let score = 0;
      const why: string[] = [];
      const aHits = [...accounts].filter((a) => i.accounts.includes(a));
      if (aHits.length) {
        score += 0.3;
        why.push(`account: ${aHits[0]}`);
      }
      const it = new Set([...i.keywords, ...tokenize(i.title), ...tokenize(i.purpose)]);
      const kHits = [...tokens].filter((t) => it.has(t));
      if (kHits.length) {
        score += Math.min(0.4, (0.4 * kHits.length) / Math.max(2, Math.min(tokens.size, it.size)));
        why.push(`keywords: ${kHits.slice(0, 4).join(', ')}`);
      }
      if (score >= 0.2) out.push({ initiativeId: i.id, title: i.title, score: Math.min(1, Math.round(score * 100) / 100), why: why.join('; ') });
    }
    return out.sort((a, b) => b.score - a.score || (a.workItemId ?? a.initiativeId ?? '').localeCompare(b.workItemId ?? b.initiativeId ?? '')).slice(0, q.limit ?? 5);
  }

  async linkEvidence(runId: string, input: { workItemId: string; sourceItemId: string; role: EvidenceRole; confidence: Confidence; reason: string }) {
    const run = this.mustRunning(runId);
    const w = this.mustWork(input.workItemId);
    const s = this.mustSource(input.sourceItemId);
    let { confidence, reason } = input;
    // DLV-1 (as the db store): my reply in the ask's own conversation, after it, carrying what was asked → Sure.
    if (input.role === 'completion' && confidence !== 'sure' && s.connector === 'slack' && s.author?.isMe) {
      const origins = this.evidenceFor(w.id).filter((e) => e.role === 'origin').map((e) => this.sourceItems.get(e.sourceItemId)).filter((o): o is SourceItemRow => !!o && o.connector === 'slack');
      const p = (s.payload ?? {}) as { channelId?: string; channelType?: string; files?: { name?: string; mimetype?: string }[]; hasFile?: boolean };
      const same = origins.some((o) => Date.parse(o.occurredAt) < Date.parse(s.occurredAt) && (o.threadRef === s.threadRef || ((o.payload as { channelId?: string } | undefined)?.channelId === p.channelId && (p.channelType === 'im' || p.channelType === 'mpim'))));
      const urls = [...(s.excerpt ?? '').matchAll(/https?:\/\/[^\s|>)]+/g)].map((x) => x[0]);
      const what = same ? deliveryMatch({ title: w.title, purpose: w.purpose }, { files: p.files, hasFile: p.hasFile === true, urls }) : null;
      if (what) {
        confidence = 'sure';
        reason = `delivered_with_attachment: ${what}; ${reason}`;
      }
    }
    const created = this.addEvidence(run, w, s, input.role, confidence, reason);
    return { evidenceId: created.id, touchedWorkItemId: w.id };
  }

  async proposeItem(runId: string, input: ProposeItemInput) {
    const run = this.mustRunning(runId);
    if (!input.evidence.length) throw new RangeError('proposeItem: at least one evidence row is required');
    const sources = input.evidence.map((e) => this.mustSource(e.sourceItemId));
    const origins = input.evidence.filter((e) => e.role === 'origin').map((e) => e.sourceItemId);
    const keyIds = (origins.length ? origins : input.evidence.map((e) => e.sourceItemId)).slice().sort();
    const originKey = `${input.kind}|${keyIds.join(',')}`;
    const existing = this.byOriginKey.get(originKey);
    if (existing) {
      const w = this.workItems.get(existing)!;
      input.evidence.forEach((e, i) => this.addEvidence(run, w, sources[i]!, e.role, input.confidence, e.reason));
      return { workItemId: w.id, landedAs: w.landedAs };
    }
    if (input.initiativeId && !this.initiatives.has(input.initiativeId)) throw new NotFoundError(`initiative ${input.initiativeId}`);
    // DUP-1 (as the db store): same conversation, same person, same deliverable → the item already there.
    const dup = this.conversationDuplicate(origins, input.title);
    if (dup) {
      const closed = ['done', 'dismissed', 'merged'].includes(dup.state);
      input.evidence.forEach((e, i) => this.addEvidence(run, dup, sources[i]!, closed ? 'context' : e.role, input.confidence, `duplicate_of_existing: ${e.reason}`));
      return { workItemId: dup.id, landedAs: dup.state === 'suggested' ? ('suggested' as const) : ('open' as const) };
    }
    // TRAIN-1 (as the db store): a training first seen two weeks past its due date, from a notice that old, goes to Triage.
    const DAY = 86_400_000;
    const nowMs = this.clock.now().getTime();
    const dueMs = parseDue(input.due, this.timeZone);
    const due = Number.isFinite(dueMs) ? new Date(dueMs).toISOString() : undefined;
    const originAt = input.evidence.filter((e) => e.role === 'origin').map((e) => Date.parse(this.sourceItems.get(e.sourceItemId)?.occurredAt ?? '')).filter(Number.isFinite);
    const trainingStale = originAt.length > 0 && input.kind === 'training' && (due ? Date.parse(due) < nowMs - 14 * DAY && Math.max(...originAt) < nowMs - 14 * DAY : Math.max(...originAt) < nowMs - 30 * DAY); // MIN-9: no date, over 30 days old
    const deep = !trainingStale && originAt.length > 0 && staleOnArrival({ originAt: Math.max(...originAt), firstSeenAt: nowMs, dueAt: due ?? null }); // DEEP-1: any ask that old
    const pastDue = !trainingStale && !deep && input.kind !== 'training' && !!due && pastDueOnArrival({ dueAt: due, firstSeenAt: nowMs }); // PAST-1
    const staleOverdue = trainingStale || deep || pastDue;
    const statusReason = deep ? stillNeededReason(Math.max(...originAt), nowMs, `scanner:${run.scope.connector}`) : pastDue ? pastDueReason(due!, `scanner:${run.scope.connector}`, this.timeZone) : undefined;
    const landedAs: 'open' | 'suggested' = input.confidence === 'guess' || staleOverdue ? 'suggested' : 'open';
    const id = this.id('wi');
    const w: WorkItemRow = {
      id,
      kind: input.kind,
      title: input.title,
      purpose: input.purpose,
      state: landedAs,
      landedAs,
      newBadge: input.confidence === 'likely',
      confidence: input.confidence,
      due,
      ...(statusReason ? { statusReason } : {}),
      effort: input.effort,
      initiativeId: input.initiativeId,
      accountId: input.accountId,
      oppId: input.oppId,
      expected: input.expected,
      people: new Set(),
      accounts: new Set(input.accountId ? [input.accountId] : []),
      keywords: new Set([...tokenize(input.title), ...tokenize(input.purpose)]),
      threadRefs: new Set(),
      fileRefs: new Set(input.expected?.fileId ? [input.expected.fileId] : []),
      originKey,
      createdRunId: runId,
    };
    this.workItems.set(id, w);
    this.byOriginKey.set(originKey, id);
    this.markPending(run, id);
    input.evidence.forEach((e, i) => this.addEvidence(run, w, sources[i]!, e.role, input.confidence, e.reason));
    return { workItemId: id, landedAs };
  }

  /** DUP-1: an item whose origin shares the conversation and the person of these origins, with the same deliverable. */
  private conversationDuplicate(originIds: string[], title: string): WorkItemRow | undefined {
    const convOf = (s: SourceItemRow) => {
      const p = (s.payload ?? {}) as { channelId?: string; channelType?: string };
      return (p.channelType === 'im' || p.channelType === 'mpim') && p.channelId ? `dm:${p.channelId}` : s.threadRef;
    };
    const whoOf = (s: SourceItemRow) => (s.author?.isMe ? 'me' : (s.author?.email ?? s.author?.externalId ?? s.author?.name ?? '').toLowerCase());
    const mine = originIds.map((id) => this.sourceItems.get(id)).filter((x): x is SourceItemRow => !!x);
    const keys = new Set(mine.flatMap((s) => (convOf(s) && whoOf(s) ? [`${convOf(s)}|${whoOf(s)}`] : [])));
    if (!keys.size) return undefined;
    const at = Math.max(...mine.map((s) => Date.parse(s.occurredAt)));
    const closed = (w: WorkItemRow) => ['done', 'dismissed', 'merged'].includes(w.state);
    const hits: WorkItemRow[] = [];
    for (const e of this.evidence.values()) {
      if (e.role !== 'origin' || originIds.includes(e.sourceItemId)) continue;
      const o = this.sourceItems.get(e.sourceItemId);
      const w = this.workItems.get(e.workItemId);
      if (!o || !w || !keys.has(`${convOf(o)}|${whoOf(o)}`)) continue;
      if (closed(w) && Math.abs(Date.parse(o.occurredAt) - at) > 14 * 86_400_000) continue;
      if (sameDeliverable(title, w.title, nameWords(...mine.map((s) => s.author?.name)))) hits.push(w);
    }
    return hits.sort((a, b) => Number(closed(a)) - Number(closed(b)))[0];
  }

  async proposeInitiative(runId: string, input: { title: string; purpose: string; accountId?: string; oppId?: string; workItemIds: string[] }) {
    this.mustRunning(runId);
    input.workItemIds.forEach((id) => this.mustWork(id));
    const key = `${input.title.trim().toLowerCase()}|${[...input.workItemIds].sort().join(',')}`;
    const existing = [...this.initiatives.values()].find((i) => i.key === key);
    if (existing) return { initiativeId: existing.id };
    const id = this.id('ini');
    const members = input.workItemIds.map((m) => this.workItems.get(m)!);
    this.initiatives.set(id, {
      id,
      key,
      title: input.title,
      purpose: input.purpose,
      accountId: input.accountId,
      oppId: input.oppId,
      workItemIds: [...input.workItemIds],
      accounts: [...new Set([...(input.accountId ? [input.accountId] : []), ...members.flatMap((m) => [...m.accounts])])],
      keywords: [...new Set(tokenize(`${input.title} ${input.purpose}`))],
    });
    for (const m of members) if (!m.initiativeId) m.initiativeId = id;
    return { initiativeId: id };
  }

  async flagUnlinked(runId: string, input: { sourceItemId: string; reason: string; hints?: string[] }) {
    const run = this.mustRunning(runId);
    this.mustSource(input.sourceItemId);
    const prev = this.unlinked.get(input.sourceItemId);
    const row: UnlinkedRow = prev ?? { sourceItemId: input.sourceItemId, attempts: 0, reason: input.reason, hints: [], deferred: false, lastFlaggedAt: this.nowIso() };
    const deferred = input.reason.startsWith('deferred:');
    if (deferred) row.deferred = true;
    else if (!run.flagged.has(input.sourceItemId)) {
      row.attempts = run.trigger === 'reconcile' ? row.attempts + 1 : Math.max(row.attempts, 1);
      row.deferred = false;
    }
    run.flagged.add(input.sourceItemId);
    row.reason = input.reason;
    if (input.hints?.length) row.hints = [...new Set([...row.hints, ...input.hints])].slice(0, 20);
    row.lastFlaggedAt = this.nowIso();
    this.unlinked.set(input.sourceItemId, row);
  }

  async reportCoverage(runId: string, objects: CoverageObject[]) {
    const run = this.mustRunning(runId);
    for (const o of objects) {
      if (!o.kind || !o.ref) throw new RangeError('reportCoverage: kind and ref are required');
      run.staged.push({ ...o });
    }
  }

  async recordBriefHighlights(runId: string, input: BriefHighlightsInput): Promise<{ briefId: string }> {
    this.mustRunning(runId);
    for (const h of input.highlights) for (const id of h.sourceItemIds) this.mustSource(id);
    const key = `${input.subscription.kind}|${input.subscription.ref}|${input.period.from}|${input.period.to}`;
    const prev = this.briefs.get(key);
    const briefId = prev?.briefId ?? this.id('brief');
    this.briefs.set(key, { ...structuredClone(input), briefId, runId });
    return { briefId };
  }

  async finishRun(runId: string, input: { cursor: Cursor; summary?: string; stats: ScanRunStats }) {
    const run = this.mustRunning(runId);
    const wFrom = toMs(run.window.from)!;
    const wTo = toMs(run.window.to)!;
    const at = toMs(input.cursor.at);
    if (at == null) throw new CoverageError('finishRun: cursor.at is not a timestamp');
    if (at < wFrom - this.tol || at > wTo + this.tol) throw new CoverageError(`finishRun: cursor.at ${input.cursor.at} is outside the run window`);

    // (c) coverage must span [window.from, cursor.at); an incomplete run claims nothing past its cursor (S8c)
    if (at < wTo - this.tol) run.staged = clampToCursor(run.staged, at);
    const ranges = mergeRanges([...this.committedRanges(run.scopeId), ...run.staged.map(rangeOf).filter(isRange)], this.tol);
    const hole = firstHole(ranges, wFrom, at, this.tol);
    if (hole) throw new CoverageError(`finishRun: coverage does not span up to the cursor (hole ${iso(hole.from)} → ${iso(hole.to)})`);

    // (d) commit
    for (const o of run.staged) this.ledgerRows.push({ runId, scopeId: run.scopeId, object: o, ...rangeFields(o), outcome: 'complete' });
    run.staged = [];
    run.status = 'succeeded';
    run.finishedAt = this.nowIso();
    run.cursorAfter = { ...input.cursor };
    run.stats = input.stats;
    run.summary = input.summary;

    // (e) cursor (S9)
    this.advanceCursor(run.scopeId);

    // (f) fan-out set (S10)
    const pending = this.pendingReeval.get(run.scopeId) ?? new Set<string>();
    this.pendingReeval.delete(run.scopeId);
    return { touchedWorkItemIds: [...pending].sort() };
  }

  async failRun(runId: string, input: { error: string; errorClass?: ConnectorHealthProbe['errorClass']; stats?: Partial<ScanRunStats> }) {
    const run = this.runs.get(runId);
    if (!run) throw new RunStateError(`failRun: unknown run ${runId}`);
    if (run.status !== 'running') return; // idempotent
    for (const o of run.staged) this.ledgerRows.push({ runId, scopeId: run.scopeId, object: o, ...rangeFields(o), outcome: 'error' });
    run.staged = [];
    run.status = 'failed';
    run.finishedAt = this.nowIso();
    run.error = input.error;
    run.errorClass = input.errorClass;
    run.stats = input.stats;
  }

  async getCursor(scope: ScopeKey) {
    return this.cursors.get(scopeId(scope)) ?? null;
  }

  /** Extension used by reconcile: [first committed coverage start, last committed coverage end] of a scope. */
  async coverageSpan(scope: ScopeKey): Promise<{ from: string; to: string } | null> {
    const r = this.committedRanges(scopeId(scope));
    if (!r.length) return null;
    return { from: iso(Math.min(...r.map((x) => x.from))), to: iso(Math.max(...r.map((x) => x.to))) };
  }

  async coverageGaps(scope: ScopeKey, window: TimeWindow): Promise<TimeWindow[]> {
    const sid = scopeId(scope);
    const committed = this.committedRanges(sid);
    if (!committed.length) return [{ ...window }];
    const low = Math.min(...committed.map((r) => r.from));
    const from = Math.max(toMs(window.from)!, low);
    const to = toMs(window.to)!;
    if (to <= from) return [];
    const merged = mergeRanges(committed, this.tol);
    const holes: TimeWindow[] = [];
    let at = from;
    for (const r of merged) {
      if (r.to <= at) continue;
      if (r.from > at + this.tol) holes.push({ from: iso(at), to: iso(Math.min(r.from, to)) });
      at = Math.max(at, r.to);
      if (at >= to) break;
    }
    if (at < to - this.tol) holes.push({ from: iso(at), to: iso(to) });
    return holes.filter((h) => toMs(h.to)! > toMs(h.from)!);
  }

  async uncoveredObjects(scope: ScopeKey, listed: CoverageObject[]): Promise<CoverageObject[]> {
    const sid = scopeId(scope);
    const committed = this.ledgerRows.filter((l) => l.scopeId === sid && l.outcome === 'complete');
    return listed.filter((L) => {
      const direct = committed.some((c) => c.object.kind === L.kind && c.object.ref === L.ref && (L.to == null || (c.object.to != null && cmpPos(c.object.to, L.to) >= 0)));
      if (direct) return false;
      const parent = typeof L.meta?.parentRef === 'string' ? (L.meta.parentRef as string) : undefined;
      const at = toMs(L.from);
      if (parent && at != null) {
        const inRange = committed.some((c) => c.object.ref === parent && c.fromMs != null && c.toMs != null && c.fromMs <= at && at < c.toMs);
        if (inRange) return false;
      }
      return true;
    });
  }

  async unlinkedSourceItems(opts: { connector?: ConnectorId; minAttempts?: number; maxAttempts?: number; limit?: number }): Promise<UnlinkedSourceItemDetail[]> {
    const min = opts.minAttempts ?? 0;
    const max = opts.maxAttempts ?? Number.POSITIVE_INFINITY;
    return [...this.unlinked.values()]
      .filter((u) => !u.ignored && !this.hasEvidence(u.sourceItemId))
      .filter((u) => u.attempts >= min && u.attempts <= max)
      .map((u) => ({ u, s: this.sourceItems.get(u.sourceItemId)! }))
      .filter(({ s }) => !opts.connector || s.connector === opts.connector)
      .sort((a, b) => a.u.lastFlaggedAt.localeCompare(b.u.lastFlaggedAt) || a.u.sourceItemId.localeCompare(b.u.sourceItemId))
      .slice(0, opts.limit ?? 50)
      .map(({ u, s }) => ({
        sourceItemId: u.sourceItemId,
        attempts: u.attempts,
        reason: u.reason,
        hints: u.hints,
        connector: s.connector,
        excerpt: s.excerpt,
        title: s.title,
        threadRef: s.threadRef,
        occurredAt: s.occurredAt,
        fromMe: s.author?.isMe === true,
        toMe: (s.participants ?? []).some((x) => x.isMe) || (s.payload as { toMe?: boolean } | undefined)?.toMe === true,
      }));
  }

  async ignoreUnlinked(sourceItemId: string, note: string): Promise<void> {
    const row = this.unlinked.get(sourceItemId);
    if (row) row.ignored = note;
  }

  async recordTriageVerdicts(verdicts: Array<{ sourceItemId: string; v: 'act' | 'noise' | 'unsure'; why?: string }>): Promise<void> {
    for (const x of verdicts) if (this.sourceItems.has(x.sourceItemId)) this.verdicts.set(x.sourceItemId, { v: x.v, ...(x.why ? { why: x.why } : {}) });
  }

  /** Stored verdicts; a message with non-context evidence reads as `act` / `linked` (an earlier run linked it). */
  async triageVerdicts(sourceItemIds: string[]): Promise<Map<string, { v: 'act' | 'noise' | 'unsure'; why?: string }>> {
    const linked = (id: string) => [...this.evidence.values()].some((e) => e.sourceItemId === id && e.role !== 'context');
    return new Map(sourceItemIds.flatMap((id) => (linked(id) ? [[id, { v: 'act' as const, why: 'linked' }] as const] : this.verdicts.has(id) ? [[id, this.verdicts.get(id)!] as const] : [])));
  }

  async conversationLines(q: { channelId?: string; threadRef?: string; before: { at: string; limit: number }; after: { at: string; limit: number } }): Promise<ConversationLine[]> {
    const inConv = (s: SourceItemRow) =>
      s.connector === 'slack' && s.kind === 'message' && (q.threadRef ? s.threadRef === q.threadRef : !!q.channelId && (s.externalId.startsWith(`${q.channelId}:`) || (s.payload as { channelId?: string } | undefined)?.channelId === q.channelId));
    const all = [...this.sourceItems.values()].filter(inConv).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const b = toMs(q.before.at)!;
    const a = toMs(q.after.at)!;
    const before = all.filter((s) => toMs(s.occurredAt)! < b).slice(-Math.max(0, q.before.limit));
    const after = all.filter((s) => toMs(s.occurredAt)! > a).slice(0, Math.max(0, q.after.limit));
    return [...before, ...after].map(({ id, revision: _r, firstRunId: _f, lastRunId: _l, ...item }) => ({ sourceItemId: id, item }));
  }

  async recordHealth(connector: ConnectorId, probe: ConnectorHealthProbe) {
    const list = this.healthLog.get(connector) ?? [];
    list.push({ ...probe });
    this.healthLog.set(connector, list);
  }

  /** E3: the last recorded health is "needs re-auth": since its last auth failure (like the DB store's last_error_at). */
  async authPausedSince(connector: ConnectorId): Promise<string | null> {
    const last = this.healthLog.get(connector)?.at(-1);
    return last?.state === 'auth_required' ? last.checkedAt : null;
  }

  async recordSpend(input: SpendRead | SpendBooked) {
    const day = this.dayKey(this.clock.now());
    // D0: a booked call must carry its audit fields and tokens, like the DB store (tests fail on a gap).
    if (input.costUsd > 0) noteLedgerGaps(`memory.recordSpend:${input.connector}`, input as SpendBooked);
    // BUD-1: like the DB store, each call spends the budget its job runs under (the trace context), and the daily cap
    // counts daily spend only.
    const budget = input.budget ?? traceContext()?.budget ?? 'daily';
    if (input.costUsd > 0) this.spend.push({ day, connector: input.connector, model: input.model, costUsd: input.costUsd, runId: input.runId, budget });
    return { todayUsd: this.dailySpendToday(), softCapUsd: this.softCapUsd, hardCapUsd: this.hardCapUsd };
  }

  /** BUD-1: today's spend on the daily budget (the caps' measure). `spendToday()` is every budget. */
  dailySpendToday(): number {
    const day = this.dayKey(this.clock.now());
    return this.spend.filter((s) => s.day === day && s.budget === 'daily').reduce((a, s) => a + s.costUsd, 0);
  }

  // ------------------------------------------------------------------ completion pass read helpers (CMP-1)

  /** Today's spend vs the caps, in the DB store's shape (completion pass budget gate). */
  async budgetStatus(): Promise<{ todayUsd: number; softCapUsd: number; hardCapUsd: number; state: 'ok' | 'soft_alert' | 'capped' }> {
    const todayUsd = this.dailySpendToday();
    const state = todayUsd >= this.hardCapUsd ? 'capped' : this.softCapUsd > 0 && todayUsd >= this.softCapUsd * 0.8 ? 'soft_alert' : 'ok';
    return { todayUsd, softCapUsd: this.softCapUsd, hardCapUsd: this.hardCapUsd, state };
  }

  /** Open items that are mine (completion LIVE_STATUSES, involvement owner/contributor), with their evidence. */
  async completionItems(opts: { asOf?: string; limit?: number; statuses?: readonly string[] } = {}): Promise<CompletionItem[]> {
    const asOf = toMs(opts.asOf) ?? this.clock.now().getTime();
    const statuses: readonly string[] = opts.statuses?.length ? opts.statuses : COMPLETION_LIVE;
    const runAt = (runId: string | undefined) => toMs(runId ? this.runs.get(runId)?.startedAt : undefined);
    const out: CompletionItem[] = [];
    for (const w of this.workItems.values()) {
      if (!statuses.includes(w.state)) continue;
      if (w.involvement && w.involvement !== 'owner' && w.involvement !== 'contributor') continue;
      if (w.resolution) continue;
      const ev = [...this.evidence.values()].filter((e) => e.workItemId === w.id && (runAt(e.runId) ?? 0) <= asOf);
      const created = runAt(w.createdRunId) ?? Math.min(...ev.map((e) => toMs(this.sourceItems.get(e.sourceItemId)?.occurredAt) ?? asOf), asOf);
      if (created > asOf) continue;
      out.push({
        workItemId: w.id,
        kind: w.kind,
        title: w.title,
        ...(w.purpose ? { purpose: w.purpose } : {}),
        status: w.state,
        ...(w.due ? { due: w.due } : {}),
        createdAt: iso(created),
        ...(w.involvement ? { involvement: w.involvement } : {}),
        ...(w.accountId ? { accountId: w.accountId } : {}),
        accountNames: w.accountId ? (this.profile.aliases?.accounts.find((a) => a.accountId === w.accountId)?.names ?? []) : [],
        fileRefs: [...new Set([...(w.expected?.fileId ? [w.expected.fileId] : [])])],
        evidence: ev.flatMap((e) => {
          const s = this.sourceItems.get(e.sourceItemId);
          return s ? [{ sourceItemId: s.id, role: e.role, ...completionFields(s), ...(e.reason ? { reason: e.reason } : {}) }] : [];
        }),
      });
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, opts.limit ?? 400);
  }

  /** Source items that arrived (first recorded, or last changed) in (seenAfter, seenUntil], newest first. */
  async completionSources(opts: { seenAfter: string; seenUntil: string; limit?: number }): Promise<CompletionSource[]> {
    const after = toMs(opts.seenAfter) ?? 0;
    const until = toMs(opts.seenUntil) ?? Number.POSITIVE_INFINITY;
    const out: CompletionSource[] = [];
    for (const s of this.sourceItems.values()) {
      const seen = toMs(this.runs.get(s.revision > 1 ? s.lastRunId : s.firstRunId)?.startedAt);
      if (seen == null || seen <= after || seen > until) continue;
      out.push({
        sourceItemId: s.id,
        ...completionFields(s),
        ...(s.excerpt ? { text: s.excerpt.slice(0, 1200) } : {}),
        seenAt: iso(seen),
        ...(s.title ? { title: s.title } : {}),
        ...(s.permalink ? { url: s.permalink } : {}),
      });
    }
    return out.sort((a, b) => b.seenAt.localeCompare(a.seenAt)).slice(0, opts.limit ?? 4000);
  }

  // ------------------------------------------------------------------ internals

  private mustRunning(runId: string): RunRow {
    const run = this.runs.get(runId);
    if (!run) throw new RunStateError(`unknown run ${runId}`);
    if (run.status !== 'running') throw new RunStateError(`run ${runId} is ${run.status}`);
    return run;
  }
  private mustWork(id: string): WorkItemRow {
    const w = this.workItems.get(id);
    if (!w) throw new NotFoundError(`work item ${id}`);
    return w;
  }
  private mustSource(id: string): SourceItemRow {
    const s = this.sourceItems.get(id);
    if (!s) throw new NotFoundError(`source item ${id}`);
    return s;
  }
  private hasEvidence(sourceItemId: string): boolean {
    for (const e of this.evidence.values()) if (e.sourceItemId === sourceItemId) return true;
    return false;
  }
  private isLinkable(w: WorkItemRow, now: number): boolean {
    if (w.state === 'dismissed' || w.state === 'merged') return false;
    if (w.state === 'done') {
      const doneAt = toMs(w.doneAt ?? w.lastEvidenceAt);
      return doneAt == null || now - doneAt <= this.reopenWindowMs;
    }
    return true;
  }
  private markPending(run: RunRow, workItemId: string) {
    const set = this.pendingReeval.get(run.scopeId) ?? new Set<string>();
    set.add(workItemId);
    this.pendingReeval.set(run.scopeId, set);
  }
  private addEvidence(run: RunRow, w: WorkItemRow, s: SourceItemRow, role: EvidenceRole, confidence: Confidence, reason: string): EvidenceRow {
    const key = `${w.id}|${s.id}|${role}`;
    const existing = this.evidence.get(key);
    if (existing) return existing;
    const row: EvidenceRow = { id: this.id('ev'), workItemId: w.id, sourceItemId: s.id, role, confidence, reason, runId: run.id, skillVersion: run.skillVersion };
    this.evidence.set(key, row);
    // digest update
    if (s.author) for (const p of personKeys(s.author)) w.people.add(p);
    for (const p of s.participants ?? []) for (const k of personKeys(p)) w.people.add(k);
    if (s.threadRef) w.threadRefs.add(s.threadRef);
    for (const f of s.fileRefs ?? []) w.fileRefs.add(f);
    for (const a of this.resolveAccounts(s.accountHints ?? [])) w.accounts.add(a);
    if (!w.lastEvidenceAt || s.occurredAt > w.lastEvidenceAt) w.lastEvidenceAt = s.occurredAt;
    this.markPending(run, w.id);
    return row;
  }
  private resolveAccounts(hints: string[]): string[] {
    const out = new Set<string>();
    const aliases = this.profile.aliases?.accounts ?? [];
    for (const h of hints) {
      const lower = h.toLowerCase();
      const hit = aliases.find((a) => a.accountId === h || a.names.some((n) => n.toLowerCase() === lower));
      out.add(hit ? hit.accountId : h);
    }
    return [...out];
  }
  private committedRanges(sid: string): Range[] {
    return this.ledgerRows
      .filter((l) => l.scopeId === sid && l.outcome === 'complete' && l.fromMs != null && l.toMs != null)
      .map((l) => ({ from: l.fromMs!, to: l.toMs! }));
  }
  private advanceCursor(sid: string) {
    const current = this.cursors.get(sid);
    const merged = mergeRanges(this.committedRanges(sid), this.tol);
    if (!merged.length) {
      // No ranged coverage (e.g. record-only scopes): accept the newest proposed cursor that moves forward.
      const latest = this.latestProposed(sid, current, Number.POSITIVE_INFINITY);
      if (latest) this.cursors.set(sid, latest);
      return;
    }
    const base = current ? toMs(current.at)! : merged[0]!.from;
    const seg = merged.find((r) => r.from <= base + this.tol && base <= r.to + this.tol);
    const reach = seg ? seg.to : base;
    const next = this.latestProposed(sid, current, reach);
    if (next) this.cursors.set(sid, next);
  }
  private latestProposed(sid: string, current: Cursor | undefined, reach: number): Cursor | undefined {
    const curAt = current ? toMs(current.at)! : Number.NEGATIVE_INFINITY;
    let best: Cursor | undefined;
    let bestAt = curAt;
    for (const r of this.runs.values()) {
      if (r.scopeId !== sid || r.status !== 'succeeded' || !r.cursorAfter) continue;
      const at = toMs(r.cursorAfter.at)!;
      if (at > bestAt && at <= reach + this.tol) {
        best = r.cursorAfter;
        bestAt = at;
      }
    }
    return best ? { ...best } : undefined;
  }
  private digest(w: WorkItemRow): OpenItemDigestExt {
    const d: OpenItemDigest = {
      workItemId: w.id,
      initiativeId: w.initiativeId,
      kind: w.kind,
      title: w.title,
      purpose: w.purpose,
      state: w.state,
      people: [...w.people],
      accounts: [...w.accounts],
      keywords: [...w.keywords].slice(0, 12),
      threadRefs: [...w.threadRefs],
      fileRefs: [...w.fileRefs],
      lastEvidenceAt: w.lastEvidenceAt,
    };
    return {
      ...d,
      ...(w.resolution ? { resolution: w.resolution } : {}),
      ...(w.involvement ? { involvement: w.involvement } : {}),
      ...(w.handedOffTo ? { handedOffTo: w.handedOffTo } : {}),
      ...(w.expected ? { expected: w.expected } : {}),
    };
  }
}

/** The source-item fields the completion pass reads (shared by its evidence and candidate rows). */
function completionFields(s: NormalizedSourceItem): Omit<CompletionEvidence, 'sourceItemId' | 'role'> {
  return {
    connector: s.connector,
    kind: s.kind,
    externalId: s.externalId,
    ...(s.threadRef ? { threadRef: s.threadRef } : {}),
    occurredAt: s.occurredAt,
    fromMe: s.author?.isMe === true,
    ...(s.author ? { author: s.author } : {}),
    ...(s.participants?.length ? { participants: s.participants } : {}),
    fileRefs: s.fileRefs ?? [],
    accountHints: s.accountHints ?? [],
    ...(s.excerpt || s.title ? { text: [s.title, s.excerpt].filter(Boolean).join('\n').slice(0, 1200) } : {}),
  };
}

function personKeys(p: { name?: string; email?: string; externalId?: string; isMe?: boolean }): string[] {
  if (p.isMe) return [];
  return [p.externalId, p.email, p.name].filter((x): x is string => !!x).map(normPerson);
}

function rangeOf(o: CoverageObject): Range | undefined {
  const from = toMs(o.from);
  const to = toMs(o.to);
  return from != null && to != null && to >= from ? { from, to } : undefined;
}
const isRange = (r: Range | undefined): r is Range => !!r;

function rangeFields(o: CoverageObject): { fromMs?: number; toMs?: number } {
  const r = rangeOf(o);
  return r ? { fromMs: r.from, toMs: r.to } : {};
}

function firstHole(merged: Range[], from: number, to: number, tol: number): Range | undefined {
  if (to <= from + tol) return undefined;
  let at = from;
  for (const r of merged) {
    if (r.to <= at) continue;
    if (r.from > at + tol) return { from: at, to: Math.min(r.from, to) };
    at = Math.max(at, r.to);
    if (at >= to - tol) return undefined;
  }
  return at >= to - tol ? undefined : { from: at, to };
}

/** Two ledger positions: as instants when both read as times, else as text (also lane E's ledger compaction). */
export function cmpPos(a: string, b: string): number {
  const ta = toMs(a);
  const tb = toMs(b);
  if (ta != null && tb != null) return ta - tb;
  return a.localeCompare(b);
}
