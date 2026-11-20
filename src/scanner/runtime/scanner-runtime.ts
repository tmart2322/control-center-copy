/**
 * ScannerRuntime (SCANNER.md §2, §5, §7). Runs inside the worker; no DB code.
 *
 *   planJobs(now)        → jobs to enqueue: resume plan on first call (head first, then backfill oldest
 *                          → newest), then due polls per scope (cadence × off-hours × adaptive backoff),
 *                          nightly reconcile, skill-upgrade dry runs. Budget-aware: traversal scopes
 *                          pause at the hard cap.
 *   executeJob(job, sig) → one scan run (or reconcile pass). `store.finishRun` only on success, then
 *                          the ReevaluateEnqueuer; `failRun` + health probe on failure; continuation when
 *                          the agent stopped early; window split on max_turns / cost cap.
 *   runScope(scope, …)   → chat `/rescan` and Health "Rescan": runs now, ahead of the queue.
 *   start() / stop()     → optional standalone loop over an InMemoryJobQueue (dev, tests). BE-1's worker
 *                          instead maps jobs onto Postgres and calls executeJob itself.
 */
import { statusReason } from './status-reason';
import { classifyError, probeFromClassification, retryable, type ErrorClass } from '../../llm/errors';
import type { ScanSkillRunInput } from '../../llm/skill-runner';
import type { ResolvedPersona } from '../../personas/types';
import { loadSkill } from '../../llm/skill-loader';
import type {
  ConnectorId,
  Cursor,
  ReevaluateEnqueuer,
  ScanContext,
  ScannerStore,
  ScanRunStats,
  ScanTrigger,
  ScopeKey,
  SkillRunner,
  TimeWindow,
} from '../types';
import { scopeId } from '../types';
import { isKnownScope, validScopes } from '../scope-catalog';
import { DEFAULT_CADENCE, failureDelayMs, intervalMs, localParts, type CadenceConfig } from './cadence';
import { systemClock, type Clock } from './clock';
import type { ScanSkillRunResult } from './contract-ext';
import { isTraversal, org62AccountIds, type ConnectorSpec, type DeterministicConnectorSpec, type PrecheckResult, type TraversalConnectorSpec } from './connectors';
import { InMemoryJobQueue, KeyedMutex, PRIORITY, retryJobOf, scanJob, type JobOutcome, type JobQueue, type ReconcileJob, type RuntimeJob, type ScanJob, type ScanJobMode } from './jobs';
import { catchUpFraction, planResume } from './resume-planner';
import { FileFirstScanLedger, FirstScan, firstScanFromEnv } from './first-scan';
import { Reconciler, type ReconcileFinding } from '../reconcile/reconciler';
import { annotateTraceContext, flushTrace, trace, withTraceContext } from '../trace';
import { ledgerHash } from '../../db/ledger';
import { runSpend } from './spend';

const MIN = 60_000;
/** Rounds a first-scan scope re-plans its holes before it is done anyway (FS-2). */
const FIRST_SCAN_REPLANS = 3;
/** Longest header cursor handed to the agent verbatim (cc_finish caps cursor.value at 200 chars). */
const HEADER_CURSOR_MAX = 180;
/**
 * Next poll after a scope gave up on a window. The poll re-plans the same window from the unmoved cursor, so a
 * window that always fails was re-run (and re-billed) every 30 minutes forever; now 30 min doubling per ~4 failures,
 * capped at 6 h, until a success resets the count (stress finding LOOP-1).
 */
export function stuckDelayMs(consecutiveFailures: number): number {
  return Math.min(6 * 60 * MIN, 30 * MIN * 2 ** Math.floor(Math.max(0, consecutiveFailures - 1) / 4));
}

export interface RuntimeLogEvent {
  event: 'plan' | 'run_start' | 'run_ok' | 'run_fail' | 'paused' | 'resumed' | 'budget' | 'reconcile' | 'skip';
  connector?: ConnectorId;
  scope?: string;
  runId?: string;
  mode?: string;
  code?: string;
  detail?: string;
  costUsd?: number;
}

export interface ScannerRuntimeDeps {
  store: ScannerStore;
  runner: SkillRunner;
  specs: ConnectorSpec[];
  reevaluate: ReevaluateEnqueuer;
  clock?: Clock;
  /** Where `start()` puts planned jobs and follow-ups. Defaults to an InMemoryJobQueue. */
  queue?: JobQueue;
  cadence?: Partial<CadenceConfig>;
  /** Re-read watch list / channel map for new scopes this often. Default 10 min. */
  scopeRefreshMs?: number;
  /** A planned job not executed within this time is considered lost and re-planned. Default 15 min. */
  leaseMs?: number;
  /** Local hour for the nightly reconcile. Default 2 (02:00). */
  nightlyReconcileHour?: number;
  /** Max concurrent Claude processes across connectors (brief 09 §5.9). Default 3. */
  maxConcurrentLlm?: number;
  /** Re-link window for skill upgrades (SCANNER.md §6.4). Default 3 days. */
  skillUpgradeRelinkMs?: number;
  /** Persist reconcile findings (BE-1: reconcile_findings / app_events). */
  onFinding?: (f: ReconcileFinding) => Promise<void>;
  log?: (e: RuntimeLogEvent) => void;
  repoRoot?: string;
  /** B-080 first-scan lookback + one-time backfill budget. Default: from CC_FIRST_SCAN_* / --lookback-days, else `firstScanDefaultDays`. */
  firstScan?: FirstScan | null;
  /** First-scan lookback when nothing is configured: the worker passes DEFAULT_FIRST_SCAN_DAYS (30); unset = off. */
  firstScanDefaultDays?: number;
}

interface ScopeState {
  key: ScopeKey;
  nextDueAt: number;
  quietLevel: number;
  failures: number;
  transientStreak: number;
  /** `persona` (D-55): the persona dropped this scope or its source; it resumes from its cursor when they come back. */
  paused?: 'auth' | 'budget' | 'config' | 'persona';
  pending: Map<string, number>; // jobId → plannedAt
  /**
   * The catch-up plan being executed: its windows, and which of its jobs (plus their continuations / splits) are
   * still outstanding. Released only when every plan job is done AND the cursor reached now. Tracking the plan
   * (not just the cursor) matters on a cold start, where the head run initializes the cursor at "now" while the
   * lookback backfill still runs behind it (stress finding B-1).
   */
  catchUp?: { planned: TimeWindow[]; jobs: Map<string, TimeWindow>; done: Set<string>; at: number };
  lastOkAt?: number;
  /** Last failure (HEALTH-1: only recent failures of other scopes hold a connector Degraded). */
  lastFailAt?: number;
  /** When the connector was auth-paused. */
  authPausedAt?: number;
  /** The interval the live loop chose at the last planning (a regular poll after it is not a catch-up). */
  lastIntervalMs?: number;
  /** B-080: outstanding first-scan jobs of this scope (plan + follow-ups); empty → the scope's first scan is done. */
  firstScanJobs?: Set<string>;
  /** FS-ORDER: where the first-scan plan ends (its `now`). Live polls during the first scan cover only what came after. */
  firstScanTo?: number;
}

/** A paused non-poll window (backfill, continuation) is retried this long after an auth pause. */
const AUTH_PROBE_MS = 30 * MIN;
/** ORG-7: a held first-scan job checks again after this long; holds end after these bounds whatever happens. */
const HOLD_RETRY_MS = MIN;
const HOLD_ACCOUNTS_MS = 5 * MIN;
const HOLD_MAX_MS = 30 * MIN;

export interface ScopeStatus {
  connector: ConnectorId;
  scope: string;
  nextDueAt: string;
  quietLevel: number;
  failures: number;
  paused?: string;
  catchingUp: boolean;
  catchUpPct?: number;
}

/** Extended reason passed to the ReevaluateEnqueuer (extra fields are optional for BE-3). */
export interface ReevaluateReason {
  runId: string;
  connector: ConnectorId;
  catchingUp?: boolean;
  trigger?: ScanTrigger;
}

/** Traversal and hybrid (watch) specs need the LLM to read the source: they pause at the hard cap. */
function usesTraversalLlm(spec: ConnectorSpec): boolean {
  return isTraversal(spec) || !!spec.allowedTools?.length;
}

/** The skill key a spec runs (`skills/scan-slack.md` → `scan-slack`): llm_calls / llm_decisions `skill_key`. */
export function skillKeyOf(spec: Pick<ConnectorSpec, 'skillPath'>): string {
  return spec.skillPath.replace(/^.*\//, '').replace(/\.md$/, '');
}

export { runOutcome } from './spend';

export class ScannerRuntime {
  readonly store: ScannerStore;
  readonly runner: SkillRunner;
  readonly clock: Clock;
  readonly queue: JobQueue;
  readonly reconciler: Reconciler;
  private readonly deps: ScannerRuntimeDeps;
  private readonly cadence: CadenceConfig;
  private readonly specs = new Map<ConnectorId, ConnectorSpec>();
  private readonly scopes = new Map<string, ScopeState>();
  private readonly connectorLock = new KeyedMutex();
  private llmSlots: number;
  private readonly llmWaiters: Array<() => void> = [];
  private initialized = false;
  private lastScopeRefresh = 0;
  /** D-55: the persona's planning signature at the last scope refresh (a change re-plans scopes at once). */
  private personaSig?: string;
  /** D-55: the sources the persona has active (null: no persona known, every source is planned). */
  private activeConnectors: Set<ConnectorId> | null = null;
  private lastNightly?: string;
  /** First-scan status at the previous plan (FS-RELINK: relink once when it turns done). */
  private lastFirstScanStatus?: string;
  /** 'retry': a planned split or fewer-items retry failed its first attempt (MIN-26): not degraded, but the next success writes ok (resets the failure count). */
  private readonly healthState = new Map<ConnectorId, 'ok' | 'bad' | 'retry'>();
  private loop?: { stop: () => void; done: Promise<void> };
  readonly firstScan?: FirstScan;

  constructor(deps: ScannerRuntimeDeps) {
    this.deps = deps;
    this.store = deps.store;
    this.runner = deps.runner;
    this.clock = deps.clock ?? systemClock;
    this.queue = deps.queue ?? new InMemoryJobQueue();
    this.cadence = { ...DEFAULT_CADENCE, ...deps.cadence, baseMs: { ...DEFAULT_CADENCE.baseMs, ...deps.cadence?.baseMs } };
    for (const s of deps.specs) this.specs.set(s.connector, s);
    this.llmSlots = deps.maxConcurrentLlm ?? 3;
    if (deps.firstScan !== null) {
      const cfg = deps.firstScan ? undefined : firstScanFromEnv(process.env, process.argv, deps.firstScanDefaultDays);
      this.firstScan = deps.firstScan ?? (cfg ? new FirstScan(cfg, new FileFirstScanLedger()) : undefined);
    }
    this.reconciler = new Reconciler({
      store: deps.store,
      runner: deps.runner,
      clock: this.clock,
      specs: deps.specs,
      reevaluate: deps.reevaluate,
      onFinding: deps.onFinding,
      repoRoot: deps.repoRoot,
      withLlmSlot: (fn) => this.withLlmSlot(fn),
      // D-55: sources the persona doesn't scan get no coverage-gap, relink or stale passes.
      connectorActive: (connector) => this.connectorActive(connector),
      relinkMs: deps.skillUpgradeRelinkMs,
      // Reconcile's LLM steps (relink, Sonnet escalation, skill-upgrade dry runs) respect the daily hard cap too.
      llmAllowed: async (connector) => {
        const b = await this.store.recordSpend({ connector, model: 'none', costUsd: 0 });
        return b.todayUsd < b.hardCapUsd;
      },
      // RCN-1: no stale re-reads while the connector's first scan still has scopes pending.
      firstScanActive: (connector) => {
        const fs = this.firstScan?.state();
        return !!fs && fs.status === 'active' && Object.entries(fs.scopes).some(([sid, v]) => v === 'pending' && sid.startsWith(`${connector}:`));
      },
    });
  }

  private log(e: RuntimeLogEvent) {
    this.deps.log?.(e);
  }

  spec(connector: ConnectorId): ConnectorSpec | undefined {
    return this.specs.get(connector);
  }

  // ===================================================================== planning

  /** Jobs to enqueue now. The first call is the resume plan (SCANNER.md §5). Safe to call every tick. */
  async planJobs(now: Date = this.clock.now()): Promise<RuntimeJob[]> {
    const jobs: RuntimeJob[] = [];
    const t = now.getTime();
    const first = !this.initialized;
    let upgrades: NonNullable<ReconcileJob['upgrades']> = [];
    // D-55: the persona is reloaded on every plan pass, so a switch (or a source / feature activated) re-plans scopes
    // now, without a restart or waiting for the 10-minute refresh.
    const personaChanged = await this.reloadPersona();
    if (first || personaChanged || t - this.lastScopeRefresh >= (this.deps.scopeRefreshMs ?? 10 * MIN)) {
      upgrades = await this.refreshScopes(now);
    }
    let anyCatchUp = false;
    const budgets = new Map<ConnectorId, { todayUsd: number; hardCapUsd: number; softCapUsd: number }>();
    for (const st of this.scopes.values()) {
      const spec = this.specs.get(st.key.connector);
      if (!spec) continue;
      this.expireStale(st, t);
      if (st.pending.size) continue;
      // Paused until re-auth (Health "Re-auth" → connector.reauth job, or a manual Rescan; WORKER.md).
      if (st.paused === 'auth') continue;
      // D-55: a scope (or source) the persona does not scan: no runs, no coverage gaps; the cursor waits.
      if (st.paused === 'persona') continue;
      if (usesTraversalLlm(spec)) {
        let b = budgets.get(spec.connector);
        if (!b) {
          b = await this.store.recordSpend({ connector: spec.connector, model: 'none', costUsd: 0 });
          budgets.set(spec.connector, b);
        }
        // First-scan backfill spend (B-080) has its own one-time budget: it never pauses regular scans. BUD-1: the stores'
        // daily figure no longer holds it, so nothing is subtracted here.
        if (b.todayUsd >= b.hardCapUsd && !this.firstScan?.eligible(spec.connector, scopeId(st.key))) {
          if (st.paused !== 'budget') {
            st.paused = 'budget';
            this.log({ event: 'paused', connector: spec.connector, scope: st.key.scope, code: 'budget_hard_cap', costUsd: b.todayUsd });
            await this.store.recordHealth(spec.connector, { state: 'degraded', detail: `paused: daily LLM hard cap $${b.hardCapUsd} reached; traversal resumes tomorrow`, checkedAt: now.toISOString() });
          }
          continue;
        }
        if (st.paused === 'budget') {
          st.paused = undefined;
          st.nextDueAt = t;
          this.log({ event: 'resumed', connector: spec.connector, scope: st.key.scope, code: 'budget' });
        }
      }
      if (t < st.nextDueAt) continue;
      const planned = await this.planScope(st, spec, now, first ? 'catch_up' : 'schedule');
      if (planned.some((j) => j.mode === 'head' || j.mode === 'backfill')) anyCatchUp = true;
      jobs.push(...planned);
    }
    if (first) {
      if (upgrades.length) {
        const j = this.reconcileJob(['skill_upgrade'], 'reconcile', now, 'skill_upgrade');
        j.upgrades = upgrades;
        jobs.push(j);
      }
      if (anyCatchUp) jobs.push(this.reconcileJob(['unlinked', 'stale_active'], 'reconcile', now, 'resume'));
      this.log({ event: 'plan', detail: `startup: ${jobs.length} jobs, ${this.scopes.size} scopes` });
    }
    // FS-RELINK: the first scan just finished. Relink what it parked as unlinked now, not at 02:00, so the first list
    // is whole the same day (Settle judges what the relink proposes on its next pass). Only on the transition this
    // process saw: a restart after the first scan doesn't repeat it.
    const fsStatus = this.firstScan?.state()?.status;
    if (!first && this.lastFirstScanStatus === 'active' && fsStatus === 'done') {
      jobs.push(this.reconcileJob(['unlinked'], 'reconcile', now, 'first_scan_done'));
      this.log({ event: 'plan', detail: 'first scan done: relinking its unlinked items now (FS-RELINK)' });
    }
    this.lastFirstScanStatus = fsStatus;
    // Nightly reconcile (SCANNER.md §6).
    const lp = localParts(now, this.cadence.workHours.timeZone);
    const hour = this.deps.nightlyReconcileHour ?? 2;
    if (first) this.lastNightly = lp.hour >= hour ? lp.date : undefined;
    else if (lp.hour >= hour && this.lastNightly !== lp.date) {
      this.lastNightly = lp.date;
      jobs.push(this.reconcileJob(['coverage_gaps', 'unlinked', 'stale_active'], 'reconcile', now, `nightly:${lp.date}`));
    }
    return jobs;
  }

  /** Register new scopes (watch list / channel map changes). Returns skill upgrades seen at startup. */
  private async refreshScopes(now: Date): Promise<NonNullable<ReconcileJob['upgrades']>> {
    const first = !this.initialized;
    this.lastScopeRefresh = now.getTime();
    const upgrades: NonNullable<ReconcileJob['upgrades']> = [];
    for (const spec of this.specs.values()) {
      // D-55: a source the persona has not activated is not planned at all: its scopes pause where they are.
      if (!this.connectorActive(spec.connector)) {
        this.pauseForPersona(spec.connector, () => true, now);
        continue;
      }
      let names: string[];
      try {
        names = isTraversal(spec)
          ? spec.scopes(await this.store.getContext({ connector: spec.connector, scope: 'inbox' }, { maxOpenItems: 0 }))
          : await spec.fetcher.scopes({ userId: (await this.store.getContext({ connector: spec.connector, scope: '_' }, { maxOpenItems: 0 })).me.userId });
      } catch (err) {
        this.log({ event: 'skip', connector: spec.connector, code: 'scopes_failed', detail: classifyError(err).code });
        continue;
      }
      let versionTag: string | undefined;
      try {
        versionTag = loadSkill(spec.skillPath, this.deps.repoRoot).versionTag;
      } catch {
        versionTag = undefined;
      }
      // D-55: scopes the persona dropped (the AE's `dcs`, `missed_opps`) pause; nothing is deleted, and they resume
      // from their cursor when the persona brings them back.
      const wanted = new Set(names);
      this.pauseForPersona(spec.connector, (scope) => !wanted.has(scope), now);
      // E3: a new scope of an auth-paused connector waits with it; at startup the stored pause counts too
      let authPause: number | undefined | null = null; // null: not looked up yet
      const pausedAt = async (): Promise<number | undefined> => {
        if (authPause !== null) return authPause;
        const live = [...this.scopes.values()].find((o) => o.key.connector === spec.connector && o.paused === 'auth');
        authPause = live ? (live.authPausedAt ?? now.getTime()) : first ? await this.storedAuthPause(spec, now) : undefined;
        return authPause;
      };
      for (const name of names) {
        const key = { connector: spec.connector, scope: name };
        const sid = scopeId(key);
        const known = this.scopes.get(sid);
        if (known) {
          if (known.paused === 'persona') {
            known.paused = undefined;
            known.nextDueAt = now.getTime();
            this.log({ event: 'resumed', connector: spec.connector, scope: name, code: 'persona' });
          }
          continue;
        }
        const paused = await pausedAt();
        this.scopes.set(sid, { key, nextDueAt: now.getTime(), quietLevel: 0, failures: 0, transientStreak: 0, pending: new Map(), ...(paused !== undefined ? { paused: 'auth' as const, authPausedAt: paused } : {}) });
        if (paused !== undefined) this.log({ event: 'paused', connector: spec.connector, scope: name, code: first ? 'auth_stored' : 'auth' });
        if (first && versionTag) {
          const ctx = await this.store.getContext(key, { maxOpenItems: 0 });
          if (ctx.skillVersion && ctx.skillVersion !== versionTag) upgrades.push({ connector: spec.connector, scope: name, fromVersion: ctx.skillVersion, toVersion: versionTag });
        }
      }
    }
    this.initialized = true;
    return upgrades;
  }

  /**
   * E3: the connector's stored "needs re-auth" (a spec that opts in): the time of its last auth failure, or undefined
   * to start unpaused (no stored pause, a store without one, a read that failed, or a sign-in refreshed since).
   */
  private async storedAuthPause(spec: ConnectorSpec, now: Date): Promise<number | undefined> {
    if (!spec.persistAuthPause || !this.store.authPausedSince) return undefined;
    let since: string | null;
    try {
      since = await this.store.authPausedSince(spec.connector);
    } catch (err) {
      this.log({ event: 'skip', connector: spec.connector, code: 'auth_pause_read_failed', detail: classifyError(err).code });
      return undefined;
    }
    if (!since) return undefined;
    const at = Number.isFinite(Date.parse(since)) ? Date.parse(since) : now.getTime();
    if (spec.persistAuthPause.credentialsChangedSince?.(at)) {
      this.log({ event: 'resumed', connector: spec.connector, code: 'credentials_refreshed', detail: 'the stored sign-in is newer than the last refusal' });
      return undefined;
    }
    return at;
  }

  /**
   * D-55: reload the persona (Settings ▸ Role & rules). Returns true when what it plans changed: its active sources or
   * its Org62 scopes and book. A store without personas (tests, the dry-run store) plans every source.
   */
  private async reloadPersona(): Promise<boolean> {
    let p: ResolvedPersona | null = null;
    try {
      p = (await this.store.persona?.()) ?? null;
    } catch (err) {
      this.log({ event: 'skip', code: 'persona_failed', detail: classifyError(err).code });
      return false; // keep the last known persona
    }
    const sig = p ? JSON.stringify([p.id, p.connectors, p.org62Scopes, p.org62Book]) : '';
    this.activeConnectors = p ? new Set(p.connectors) : null;
    if (sig === this.personaSig) return false;
    const changed = this.personaSig !== undefined;
    this.personaSig = sig;
    if (changed) this.log({ event: 'plan', detail: `persona changed (${p?.id ?? 'none'}): re-planning scopes` });
    return changed;
  }

  /** Whether the persona scans this source (no persona known: yes). */
  connectorActive(connector: ConnectorId): boolean {
    return !this.activeConnectors || this.activeConnectors.has(connector);
  }

  private pauseForPersona(connector: ConnectorId, drop: (scope: string) => boolean, now: Date): void {
    for (const st of this.scopes.values()) {
      if (st.key.connector !== connector || st.paused === 'persona' || !drop(st.key.scope)) continue;
      st.paused = 'persona';
      st.catchUp = undefined; // a paused scope isn't catching up (Health, the heartbeat)
      // nor does it hold the first scan open: it has no first-scan work left for this persona
      this.firstScan?.scopeDone(scopeId(st.key), now);
      this.log({ event: 'paused', connector, scope: st.key.scope, code: 'persona' });
    }
  }

  /** Plan one scope from its cursor: incremental, or head + backfill when the gap is large. */
  private async planScope(st: ScopeState, spec: ConnectorSpec, now: Date, trigger: ScanTrigger): Promise<ScanJob[]> {
    const t = now.getTime();
    const cursor = await this.store.getCursor(st.key);
    // FS-ORDER: while first-scan jobs are outstanding, the backfill walks oldest → newest up to where its plan ended, and
    // the cursor trails it. Live polls cover only what came after the plan (the cursor fast-forwards over them once the
    // backfill reaches them, S9). Before, the head hour set the cursor at now and the backfill ran newest first behind it.
    const tail = st.firstScanJobs?.size ? st.firstScanTo : undefined;
    if (st.firstScanJobs?.size && tail === undefined) return [];
    const fs = st.firstScanJobs?.size ? undefined : this.firstScan?.claim(spec.connector, scopeId(st.key), !!cursor, now);
    // The first scan never shortens a connector's own lookback (Org62 keeps 30 d when the setting is 7).
    if (fs) return this.planFirstScan(st, spec, now, new Date(Math.min(Date.parse(fs.floorAt), Date.parse(fs.startedAt) - spec.initialLookbackMs)).toISOString(), fs.baseFloorAt);
    const from = tail !== undefined ? new Date(Math.max(tail, cursor ? Date.parse(cursor.at) : tail)).toISOString() : cursor ? cursor.at : new Date(t - spec.initialLookbackMs).toISOString();
    if (tail !== undefined && Date.parse(from) >= t - 1000) return [];
    const window = { from, to: now.toISOString() };
    const gaps = cursor || tail !== undefined ? await this.store.coverageGaps(st.key, window) : [window];
    // A poll the live loop scheduled itself (slow off-hours / quiet cadence can exceed an hour) is incremental, not a
    // catch-up: only a gap well beyond the interval we chose means downtime. Before, every off-hours poll became
    // head + backfill and the connector reported "catching up" all night and weekend (stress finding CAD-1).
    const headMs = trigger === 'schedule' && st.lastIntervalMs ? Math.max(60 * MIN, Math.ceil(st.lastIntervalMs * 1.5)) : undefined;
    const floorMs = spec.maxBackfillMsFor?.(st.key.scope);
    const plan = planResume({ now, gaps, chunkMs: spec.chunkMsFor?.(st.key.scope) ?? spec.chunkMs, headMs, ...(floorMs ? { maxBackfillMs: floorMs } : {}) });
    const catchUp = plan.some((p) => p.mode !== 'incremental');
    const jobs = plan.map((p) =>
      scanJob({
        connector: spec.connector,
        scope: st.key.scope,
        window: p.window,
        mode: p.mode,
        trigger: catchUp ? 'catch_up' : trigger,
        runAt: new Date(t + p.order).toISOString(),
        model: spec.model,
        vars: this.varsFor(spec, st.key.scope),
      }),
    );
    for (const j of jobs) st.pending.set(j.id, t);
    if (catchUp) st.catchUp = { planned: plan.map((p) => p.window), jobs: new Map(jobs.map((j) => [j.id, j.window])), done: new Set(), at: t };
    st.lastIntervalMs = intervalMs(this.cadence, spec.connector, st.key.scope, now, st.quietLevel);
    st.nextDueAt = t + st.lastIntervalMs;
    return jobs;
  }

  /**
   * B-080 first scan: everything uncovered between the fixed floor and now, backfilled OLDEST → NEWEST with no head hour
   * (FS-ORDER), every job tagged `budget: 'first_scan'`. An ask is then recorded before the replies that settle it, and
   * triage and the completion pass see the conversation in the order it happened. On a restart the same chunks are
   * planned again (ids are deterministic, so queued ones dedupe); covered ones are skipped (the low-watermark clamp of
   * coverageGaps is undone by planning [floor, low) explicitly).
   */
  private async planFirstScan(st: ScopeState, spec: ConnectorSpec, now: Date, floorAt: string, baseFloorAt?: string): Promise<ScanJob[]> {
    const t = now.getTime();
    const window = { from: floorAt, to: now.toISOString() };
    const span = (await this.store.coverageSpan?.(st.key)) ?? null;
    let gaps = span ? await this.store.coverageGaps(st.key, window) : [window];
    if (span && Date.parse(span.from) > Date.parse(floorAt) + 1000) gaps = [{ from: floorAt, to: span.from }, ...gaps];
    const chunkMs = spec.firstScanChunkMsFor?.(st.key.scope) ?? spec.chunkMsFor?.(st.key.scope) ?? spec.chunkMs;
    // FS-DEEP: past the shared floor (a deeper per-scope lookback), the scope may use bigger chunks.
    const base = baseFloorAt ? Date.parse(baseFloorAt) : NaN;
    const deepChunk = Date.parse(floorAt) < base ? spec.firstScanDeepChunkMsFor?.(st.key.scope) : undefined;
    // A deep chunk never straddles the shared floor, so the chunks inside it keep their boundaries. No head hour, except
    // for a scope that reads the current state (its head run is the read).
    const head = !!spec.readsCurrentState?.(st.key.scope);
    const plan = planResume({ now, gaps, chunkMs, maxBackfillMs: t - Date.parse(floorAt) + 1000, head, ...(deepChunk ? { chunkMsAt: (a: number) => (a < base ? Math.min(deepChunk, base - a) : chunkMs) } : {}) });
    const jobs = plan.map((p) =>
      scanJob({
        connector: spec.connector,
        scope: st.key.scope,
        window: p.window,
        mode: p.mode,
        trigger: 'catch_up',
        runAt: new Date(t + p.order).toISOString(),
        model: spec.model,
        vars: this.varsFor(spec, st.key.scope),
        ...(p.mode !== 'incremental' ? { budget: 'first_scan' as const } : {}),
      }),
    );
    for (const j of jobs) st.pending.set(j.id, t);
    st.firstScanJobs = new Set(jobs.filter((j) => j.budget === 'first_scan').map((j) => j.id));
    st.firstScanTo = t;
    if (!st.firstScanJobs.size) this.firstScan?.scopeDone(scopeId(st.key), now);
    if (jobs.some((j) => j.mode !== 'incremental')) st.catchUp = { planned: plan.map((p) => p.window), jobs: new Map(jobs.map((j) => [j.id, j.window])), done: new Set(), at: t };
    this.log({ event: 'plan', connector: spec.connector, scope: st.key.scope, detail: `first scan: ${jobs.length} jobs from ${floorAt} (oldest first)` });
    st.lastIntervalMs = intervalMs(this.cadence, spec.connector, st.key.scope, now, st.quietLevel);
    st.nextDueAt = t + st.lastIntervalMs;
    return jobs;
  }

  /**
   * A first-scan job will not run again: drop it, adopt its first-scan follow-ups. When none are left, the scope is done
   * only if its first-scan span has no holes. Before, a window that failed for good (a tripwire, a stuck agent) still
   * ended the scope, and a done scope never re-plans, so its hole stayed for good: only the nightly 7-day reconcile could
   * find it (FS-2). Now the holes are re-planned after a backoff, at most FIRST_SCAN_REPLANS rounds.
   */
  private async settleFirstScan(st: ScopeState, job: ScanJob, followUps: RuntimeJob[], now: Date, final: boolean) {
    if (job.budget !== 'first_scan' || !st.firstScanJobs) return;
    for (const f of followUps) if (f.kind === 'scan' && f.budget === 'first_scan' && scopeId({ connector: f.connector, scope: f.scope }) === scopeId(st.key)) st.firstScanJobs.add(f.id);
    if (final) st.firstScanJobs.delete(job.id);
    if (st.firstScanJobs.size) return;
    const planEnd = st.firstScanTo;
    st.firstScanJobs = undefined;
    st.firstScanTo = undefined;
    const sid = scopeId(st.key);
    const fsState = this.firstScan?.state();
    // Holes count up to where the first-scan plan ended: past it is the live polls' (Org62 polls every 30 min), not a
    // hole. Before, the unpolled tail made every slow-polling scope look holed and re-plan for nothing (FS-3). The bound
    // is the plan's end, not the cursor: oldest first (FS-ORDER), the cursor stops at a hole, so it would hide every one.
    const cursor = await this.store.getCursor(st.key);
    const bound = planEnd ?? (cursor ? Date.parse(cursor.at) : now.getTime());
    const until = new Date(Math.min(bound, now.getTime() - 5 * MIN));
    const holes = fsState ? await this.firstScanHoles(st, this.firstScan!.floorFor(sid)!, until) : [];
    const rounds = this.firstScan?.replans(sid) ?? 0;
    if (holes.length && rounds < FIRST_SCAN_REPLANS && this.firstScan?.hasBudget()) {
      this.firstScan.noteReplan(sid);
      st.nextDueAt = now.getTime() + 30 * MIN * 2 ** rounds;
      this.log({ event: 'plan', connector: st.key.connector, scope: st.key.scope, detail: `first scan: ${holes.length} hole(s) left; re-plan ${rounds + 1}/${FIRST_SCAN_REPLANS} at ${new Date(st.nextDueAt).toISOString()}` });
      return;
    }
    this.firstScan?.scopeDone(sid, now);
    this.log({ event: 'plan', connector: st.key.connector, scope: st.key.scope, detail: `first scan done (status ${this.firstScan?.state()?.status ?? 'n/a'}${holes.length ? `; ${holes.length} hole(s) left to reconcile` : ''})` });
  }

  /** Uncovered windows of a scope's first-scan span [floor, until), the low-watermark clamp undone (as planFirstScan). */
  private async firstScanHoles(st: ScopeState, floorAt: string, until: Date): Promise<TimeWindow[]> {
    if (until.getTime() <= Date.parse(floorAt)) return [];
    const window = { from: floorAt, to: until.toISOString() };
    const span = (await this.store.coverageSpan?.(st.key)) ?? null;
    if (!span) return [window];
    const gaps = await this.store.coverageGaps(st.key, window);
    const all = Date.parse(span.from) > Date.parse(floorAt) + 1000 ? [{ from: floorAt, to: span.from }, ...gaps] : gaps;
    return all.filter((g) => Date.parse(g.to) - Date.parse(g.from) > MIN);
  }

  /** Next local midnight (+1 min) in the user's zone: when the daily LLM budget resets. */
  private nextBudgetDay(now: Date): number {
    const tz = this.cadence.workHours.timeZone;
    const today = localParts(now, tz).date;
    let t = now.getTime() + 60 * MIN;
    while (localParts(new Date(t), tz).date === today) t += 60 * MIN;
    // Step back to the first minute of the new day.
    while (localParts(new Date(t - MIN), tz).date !== today) t -= MIN;
    return t + MIN;
  }

  private markCatchUpDone(st: ScopeState, jobId: string) {
    st.catchUp?.done.add(jobId);
  }

  private varsFor(spec: ConnectorSpec, scope: string): Record<string, string> | undefined {
    if (!isTraversal(spec)) return undefined;
    // Context-free vars only (channel id/ts); labels are resolved at execution time from the fresh context.
    if (scope.startsWith('channel:')) return { 'channel.id': scope.slice(8) };
    if (scope.startsWith('thread:')) {
      const [, channel, ts] = scope.split(':');
      return { 'thread.channelId': channel ?? '', 'thread.ts': ts ?? '' };
    }
    return undefined;
  }

  private expireStale(st: ScopeState, t: number) {
    const lease = this.deps.leaseMs ?? 15 * MIN;
    for (const [id, at] of st.pending) if (t - at > lease) st.pending.delete(id);
  }

  private reconcileJob(passes: ReconcileJob['passes'], trigger: ScanTrigger, now: Date, tag: string): ReconcileJob {
    const id = `reconcile:${tag}:${passes.join('+')}`;
    return { kind: 'reconcile', id, passes, trigger, priority: PRIORITY.reconcile, runAt: now.toISOString(), dedupeKey: id };
  }

  // ===================================================================== execution

  /** `meta.dbJobId`: the queue row running this job; it lands on the run (`scan_runs.job_id`), so a UI placeholder run is adopted. */
  async executeJob(job: RuntimeJob, signal: AbortSignal = new AbortController().signal, meta: { dbJobId?: number | string } = {}): Promise<JobOutcome> {
    if (job.kind === 'reconcile') return this.executeReconcile(job, signal);
    const spec = this.specs.get(job.connector);
    // HYG-1: a scope neither the connector's scope list nor the catalog knows (a Health scope sent prefixed,
    // `org62:org62:events`) never runs, never says succeeded, and is never registered as a polled scope. Before, it ran
    // the skill with no query, "succeeded" having read nothing, and then re-ran on its own as a catch-up.
    if (!this.scopes.has(scopeId({ connector: job.connector, scope: job.scope })) && !isKnownScope(job.connector, job.scope)) {
      this.log({ event: 'skip', connector: job.connector, scope: job.scope, code: 'unknown_scope' });
      return { status: 'failed', errorClass: 'config', followUps: [], detail: `unknown scope ${scopeId({ connector: job.connector, scope: job.scope })} (valid: ${validScopes(job.connector).join(', ')})` };
    }
    const st = this.scopeState({ connector: job.connector, scope: job.scope });
    st.pending.delete(job.id);
    if (!spec) return { status: 'skipped', followUps: [], detail: `no spec for ${job.connector}` };
    // A paused window that is not a plain poll (backfill, continuation, split, targeted) is retried later instead of
    // dropped: on a cold start it lies behind the cursor, so no later poll would re-plan it (stress finding B-2).
    const keep = job.mode !== 'incremental';
    // D-55: a job queued before the persona dropped this scope or source (a manual Rescan still runs).
    if ((st.paused === 'persona' || !this.connectorActive(job.connector)) && job.trigger !== 'manual' && job.trigger !== 'chat') {
      return { status: 'skipped', followUps: [], detail: 'not scanned for this persona' };
    }
    if (st.paused === 'auth' && job.trigger !== 'manual' && job.trigger !== 'chat') {
      return { status: 'paused', followUps: [], errorClass: 'auth', detail: 'connector needs re-auth', retryAt: keep ? new Date(this.clock.now().getTime() + AUTH_PROBE_MS).toISOString() : undefined };
    }
    const hold = await this.firstScanHold(job, this.clock.now());
    if (hold) {
      this.log({ event: 'skip', connector: spec.connector, scope: job.scope, code: 'first_scan_hold', detail: hold });
      return { status: 'skipped', followUps: [], held: true, detail: hold, retryAt: new Date(this.clock.now().getTime() + HOLD_RETRY_MS).toISOString() };
    }
    const budget = await this.store.recordSpend({ connector: spec.connector, model: 'none', costUsd: 0 });
    // B-080: a first-scan job spends the one-time budget while it lasts; regular jobs ignore first-scan spend.
    const firstScanBudget = job.budget === 'first_scan' && !!this.firstScan?.hasBudget();
    let overBudget = !firstScanBudget && budget.todayUsd >= budget.hardCapUsd;
    const subject = scopeId({ connector: spec.connector, scope: job.scope });
    if (overBudget && usesTraversalLlm(spec)) {
      this.log({ event: 'paused', connector: spec.connector, scope: job.scope, code: 'budget_hard_cap' });
      await this.store.recordDecision?.({ skill: skillKeyOf(spec), kind: 'block', reason: 'hard_cap', trigger: job.trigger, subject, detail: { spentUsd: budget.todayUsd, capUsd: budget.hardCapUsd, mode: job.mode } });
      return { status: 'paused', followUps: [], detail: 'budget_hard_cap', retryAt: keep ? new Date(this.nextBudgetDay(this.clock.now())).toISOString() : undefined };
    }
    if (!firstScanBudget && budget.todayUsd >= budget.softCapUsd) this.log({ event: 'budget', connector: spec.connector, code: 'soft_cap', costUsd: budget.todayUsd });

    const release = await this.connectorLock.acquire(spec.connector, signal);
    // D6: the run's own cost cap is held against today's hard cap while it runs, so parallel scans (and settle, read-ins)
    // can't all pass a check with the last dollar. A refused hold pauses a traversal; a deterministic run records only.
    let reservation: { ok: boolean; release(): Promise<void> } | null = null;
    if (!overBudget && !firstScanBudget && this.store.reserveSpend) {
      const cap = spec.costCapUsd(job.scope, job.mode);
      reservation = await this.store.reserveSpend(cap, { budget: 'daily' }).catch(() => null);
      if (reservation && !reservation.ok) {
        await this.store.recordDecision?.({ skill: skillKeyOf(spec), kind: 'block', reason: 'hard_cap_reserve', trigger: job.trigger, subject, detail: { wantUsd: cap, capUsd: budget.hardCapUsd, mode: job.mode } });
        reservation = null;
        if (usesTraversalLlm(spec)) {
          release();
          this.log({ event: 'paused', connector: spec.connector, scope: job.scope, code: 'budget_hard_cap' });
          return { status: 'paused', followUps: [], detail: 'budget_hard_cap', retryAt: keep ? new Date(this.clock.now().getTime() + 10 * MIN).toISOString() : undefined };
        }
        overBudget = true;
      }
    }
    try {
      // AUDIT: everything this scan does (log lines, spend) carries its connector, scope and budget; the run id once it exists.
      const out = await withTraceContext({ connector: spec.connector, scope: job.scope, budget: firstScanBudget ? 'first_scan' : 'daily' }, () => this.runScanJob(job, spec, st, signal, overBudget, meta.dbJobId, firstScanBudget));
      await this.settleFirstScan(st, job, out.followUps, this.clock.now(), !out.retryAt);
      return out;
    } finally {
      await reservation?.release();
      release();
    }
  }

  /**
   * ORG-7 (MIN-17): in the first scan, `org62:opps` waits for `org62:book`. Its Q2 reads "opps on my accounts" with the
   * account list of the moment, and the accounts come from the book read's projection. Stage 2 ran the newest week
   * before that and read 2 account ids of 37, yet the window counted as covered for every account (a silent gap
   * for each new user). Held until the book scope is done and its accounts are projected (5 more minutes at most for
   * a user with none), and never past 30 minutes from the first scan's start.
   */
  private async firstScanHold(job: ScanJob, now: Date): Promise<string | null> {
    if (job.connector !== 'org62' || job.scope !== 'opps') return null;
    const fs = this.firstScan?.state();
    if (!fs || fs.status !== 'active' || fs.scopes['org62:opps'] === 'done') return null;
    if (now.getTime() - Date.parse(fs.startedAt) > HOLD_MAX_MS) return null;
    if (fs.scopes['org62:book'] !== 'done') return 'waiting for org62:book (the accounts Q2 reads)';
    if (org62AccountIds(await this.store.getContext({ connector: 'org62', scope: 'opps' }))) return null;
    this.bookDoneSeenAt ??= now.getTime();
    return now.getTime() - this.bookDoneSeenAt < HOLD_ACCOUNTS_MS ? 'waiting for the book read\'s accounts to be projected' : null;
  }
  private bookDoneSeenAt?: number;

  private async runScanJob(job: ScanJob, spec: ConnectorSpec, st: ScopeState, signal: AbortSignal, overBudget: boolean, dbJobId?: number | string, firstScanBudget = false): Promise<JobOutcome> {
    const now = this.clock.now();
    const scope = st.key;
    const ctx = await this.store.getContext(scope);
    let versionTag: string | undefined;
    try {
      versionTag = loadSkill(spec.skillPath, this.deps.repoRoot).versionTag;
    } catch {
      versionTag = undefined;
    }
    const { runId } = await this.store.startRun({ scope, trigger: job.trigger, window: job.window, model: job.model ?? spec.model, skillVersion: versionTag, ...(dbJobId != null ? { jobId: dbJobId } : {}) });
    this.log({ event: 'run_start', connector: spec.connector, scope: scope.scope, runId, mode: job.mode });
    annotateTraceContext({ runId });
    const t0 = Date.now();
    trace(runId, 'plan', () => ({
      connector: spec.connector,
      scope: scope.scope,
      mode: job.mode,
      trigger: job.trigger,
      window: job.window,
      windowMin: Math.round((Date.parse(job.window.to) - Date.parse(job.window.from)) / 60_000),
      chunkMin: Math.round((spec.chunkMsFor?.(scope.scope) ?? spec.chunkMs) / 60_000),
      budget: firstScanBudget ? 'first_scan' : 'daily',
      jobBudget: job.budget ?? null,
      overBudget,
      model: job.model ?? spec.model,
      skillVersion: versionTag ?? null,
      kind: isTraversal(spec) ? 'traversal' : 'deterministic',
      maxTurns: spec.maxTurns(job.scope, job.mode),
      costCapUsd: spec.costCapUsd(job.scope, job.mode),
      attempt: job.attempt ?? 0,
      jobId: dbJobId != null ? Number(dbJobId) : null,
      cursorAt: ctx.cursor?.at ?? null,
      vars: job.vars ?? null,
    }));
    // FS-LATE: why this channel got the first scan's lookback (it joined after the first scan had finished).
    const joined = job.budget === 'first_scan' ? this.firstScan?.state()?.late?.[scopeId(scope)] : undefined;
    if (joined) trace(runId, 'first_scan_reopened', () => ({ scope: scopeId(scope), joinedAt: joined, floorAt: this.firstScan?.floorFor(scopeId(scope)) ?? null, lookbackDays: this.firstScan?.state()?.lookbackDays ?? null }));

    let result: ScanSkillRunResult;
    let cursor: Cursor | undefined;
    let complete = true;
    try {
      // D5: a scheduled poll of a quiet scope asks a cheap question first; positively nothing new = no traversal.
      const pre = isTraversal(spec) && spec.precheck && job.trigger === 'schedule' && job.mode === 'incremental' ? await this.precheck(job, spec, ctx, runId, signal, dbJobId) : null;
      if (pre?.empty) {
        await this.store.reportCoverage(runId, pre.coverage);
        result = { ok: true, costUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0, complete: true, proposedCursor: pre.cursor, summary: 'pre-check: nothing new in the window', counts: { recorded: 0, new: 0, changed: 0, linked: 0, proposed: 0, unlinked: 0, coverage: pre.coverage.length } };
        cursor = pre.cursor;
        complete = true;
      } else if (isTraversal(spec)) {
        result = await this.withLlmSlot(async () => this.runner.run({ ...this.traversalInput(job, spec, ctx, runId, signal), ...(await this.triageAllowance(job, spec)) }, this.store) as Promise<ScanSkillRunResult>);
        cursor = result.proposedCursor;
        complete = result.complete ?? true;
      } else {
        const r = await this.runDeterministic(job, spec, ctx, runId, signal, overBudget);
        result = r.result;
        cursor = r.cursor;
        complete = r.complete;
      }
    } catch (err) {
      const c = classifyError(err);
      result = { ok: false, costUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0, error: { message: String(err instanceof Error ? err.message : err).slice(0, 300), errorClass: c.errorClass } };
    }

    // D0: the run's own tokens (per model) for what no pass row covers, and why it ran. A run that never built its
    // prompt (it failed first) is hashed by what it was asked to read.
    if (result.costUsd > 0)
      await this.store.recordSpend(
        runSpend(result, {
          connector: spec.connector,
          model: job.model ?? spec.model,
          runId,
          budget: firstScanBudget ? 'first_scan' : 'daily',
          ...(dbJobId != null && Number.isFinite(Number(dbJobId)) ? { jobId: Number(dbJobId) } : {}),
          trigger: job.trigger,
          modelReason: job.model && job.model !== spec.model ? 'override' : 'default',
          hashOf: [skillKeyOf(spec), scope.connector, scope.scope, job.mode, job.window.from, job.window.to],
        }),
      );
    // SHUT-1: the worker stopped the run (shutdown drain, a cancel, a lost lease): a cancellation, not a connector
    // failure. The job runtime requeues the job, so the window runs again. Before, a kickstart recorded every in-flight
    // run as a transient error and degraded its connector. A job timeout is still a failure.
    const abortReason = signal.aborted ? ((signal.reason as { reason?: string } | undefined)?.reason ?? 'shutdown') : undefined;
    if (abortReason && abortReason !== 'timeout') {
      await this.store.failRun(runId, { error: `cancelled: worker ${abortReason}`, errorClass: 'transient', stats: this.statsOf(result) });
      this.log({ event: 'skip', connector: spec.connector, scope: scope.scope, runId, code: 'cancelled', detail: abortReason });
      trace(runId, 'outcome', { status: 'cancelled', reason: abortReason, costUsd: result.costUsd, ms: Date.now() - t0 });
      void flushTrace();
      return { status: 'skipped', runId, followUps: [], detail: `cancelled: worker ${abortReason}`, costUsd: result.costUsd };
    }
    if (firstScanBudget && result.costUsd > 0) this.firstScan?.charge(result.costUsd, localParts(now, this.cadence.workHours.timeZone).date, now);
    const stats = this.statsOf(result);

    if (result.ok && cursor) {
      try {
        const { touchedWorkItemIds } = await this.store.finishRun(runId, { cursor, summary: result.summary, stats });
        // A continuation that made no progress (cursor not past its own window start) must not spawn another one:
        // an agent that kept answering complete=false at the window start re-read one Slack thread 360 times in a
        // row (~$1.25, and it held the connector lock, starving every other Slack scan; stress finding THR-1). The
        // scope's next poll (or reconcile) re-plans the rest from the cursor.
        // A run that made no progress (cursor not past its window start) gets ONE delayed retry of the rest; a retry
        // that stalls again ends the chain. Behind a cold-start cursor a dropped tail is a hole only the reconcile's
        // coverage-gap pass finds (30-day lookback).
        const stalled = !complete && Date.parse(cursor.at) <= Date.parse(job.window.from) + 1000;
        const continues = !complete && !stalled && Date.parse(cursor.at) < Date.parse(job.window.to) - 1000;
        const retryStalled = stalled && job.mode !== 'retry' && Date.parse(cursor.at) < Date.parse(job.window.to) - 1000;
        if (stalled) this.log({ event: 'skip', connector: spec.connector, scope: scope.scope, runId, code: 'continuation_stalled', detail: `cursor ${cursor.at} did not pass ${job.window.from}${retryStalled ? '; one retry in 30 min' : '; chain ended'}` });
        this.markCatchUpDone(st, job.id);
        if (continues && st.catchUp) st.catchUp.jobs.set(`pending-continuation:${job.id}`, { from: cursor.at, to: job.window.to });
        await this.onSuccess(spec, st, now, stats);
        if (touchedWorkItemIds.length) {
          const reason: ReevaluateReason = { runId, connector: spec.connector, catchingUp: !!st.catchUp, trigger: job.trigger };
          await this.deps.reevaluate(touchedWorkItemIds, reason);
        }
        const followUps: RuntimeJob[] = [];
        if (continues) {
          followUps.push(
            scanJob({ connector: spec.connector, scope: scope.scope, window: { from: cursor.at, to: job.window.to }, mode: 'continuation', trigger: job.trigger, runAt: now.toISOString(), model: job.model, vars: job.vars, ...(job.budget ? { budget: job.budget } : {}) }),
          );
        } else if (retryStalled) {
          followUps.push(
            scanJob({ connector: spec.connector, scope: scope.scope, window: { from: cursor.at, to: job.window.to }, mode: 'retry', trigger: job.trigger, runAt: new Date(now.getTime() + 30 * MIN).toISOString(), model: job.model, vars: job.vars, ...(job.budget ? { budget: job.budget } : {}) }),
          );
        }
        if (st.catchUp) st.catchUp.jobs.delete(`pending-continuation:${job.id}`);
        this.trackFollowUps(st, followUps);
        this.log({ event: 'run_ok', connector: spec.connector, scope: scope.scope, runId, mode: job.mode, costUsd: result.costUsd, detail: `new=${stats.new} linked=${stats.linked} proposed=${stats.proposed}` });
        trace(runId, 'outcome', () => ({ status: 'succeeded', complete, cursorAt: cursor.at, stalled, continues, followUps: followUps.map((f) => (f.kind === 'scan' ? `${f.mode}:${f.window.from}→${f.window.to}` : f.id)), touched: touchedWorkItemIds.length, stats, ms: Date.now() - t0 }));
        void flushTrace();
        return { status: 'succeeded', runId, followUps, touchedWorkItemIds, costUsd: result.costUsd };
      } catch (err) {
        // CoverageError or a store failure: the run must not count as done.
        result = { ...result, ok: false, error: { message: err instanceof Error ? err.message : String(err), errorClass: 'config' } };
      }
    }

    const message = result.error?.message ?? (cursor ? 'run failed' : 'run ended without a cursor (cc_finish)');
    const errorClass: ErrorClass = result.error?.errorClass ?? 'unknown';
    await this.store.failRun(runId, { error: message, errorClass, stats });
    const out = await this.onFailure(job, spec, st, runId, now, message, errorClass, result);
    // AUDIT: what the runtime decided after the failure (split, fewer items, retry later, or give up), then the outcome.
    const action = () => out.followUps.length ? (/window split/.test(out.detail ?? '') ? 'split' : /retrying with/.test(out.detail ?? '') ? 'fewer_items' : 'follow_up') : out.retryAt ? 'retry' : errorClass === 'auth' ? 'auth_pause' : result.error?.disallowedTool ? 'config_pause' : 'next_poll';
    trace(runId, 'retry', () => ({ action: action(), retryAt: out.retryAt ?? null, followUps: out.followUps.map((f) => (f.kind === 'scan' ? `${f.mode}:${f.window.from}→${f.window.to}${f.vars?.maxItems ? ` items=${f.vars.maxItems}` : ''}` : f.id)), failures: st.failures, nextDueAt: new Date(st.nextDueAt).toISOString() }));
    trace(runId, 'outcome', { status: 'failed', errorClass, error: message, disallowedTool: result.error?.disallowedTool ?? null, detail: out.detail ?? null, costUsd: result.costUsd, stats, ms: Date.now() - t0 });
    void flushTrace();
    return out;
  }

  /**
   * D5: run the spec's pre-check, book its spend (skill `<connector>-precheck`) and record what it decided. Fails open:
   * an error or an unclear answer returns null or not-empty, and the traversal runs as before.
   */
  private async precheck(job: ScanJob, spec: TraversalConnectorSpec, ctx: ScanContext, runId: string, signal: AbortSignal, dbJobId?: number | string): Promise<PrecheckResult | null> {
    let pre: PrecheckResult | null;
    try {
      pre = await spec.precheck!({ scope: job.scope, window: job.window, vars: { ...spec.scopeVars(job.scope, ctx), ...(job.vars ?? {}) }, ctx, signal });
    } catch {
      pre = null;
    }
    if (!pre) return null;
    const skill = `${spec.connector}-precheck`;
    if (pre.costUsd > 0)
      await this.store.recordSpend({
        connector: spec.connector,
        model: pre.model,
        costUsd: pre.costUsd,
        runId,
        budget: 'daily',
        ...(dbJobId != null && Number.isFinite(Number(dbJobId)) ? { jobId: Number(dbJobId) } : {}),
        skill,
        inputTokens: pre.inputTokens,
        outputTokens: pre.outputTokens,
        cacheReadTokens: pre.cacheReadTokens,
        cacheWriteTokens: pre.cacheWriteTokens,
        usage: [{ model: pre.model, inputTokens: pre.inputTokens, outputTokens: pre.outputTokens, cacheReadTokens: pre.cacheReadTokens, cacheWriteTokens: pre.cacheWriteTokens, costUsd: pre.costUsd }],
        trigger: job.trigger,
        modelReason: 'default',
        contentHash: pre.contentHash ?? ledgerHash('precheck', spec.connector, job.scope, job.window.from, job.window.to),
        outcome: pre.empty ? 'empty' : pre.why,
      });
    const subject = scopeId({ connector: spec.connector, scope: job.scope });
    trace(runId, 'precheck', () => ({ empty: pre!.empty, why: pre!.why, calls: pre!.calls, costUsd: pre!.costUsd }));
    if (pre.empty) await this.store.recordDecision?.({ skill: skillKeyOf(spec), kind: 'skip', reason: 'precheck_empty', trigger: job.trigger, subject, detail: { calls: pre.calls, precheckUsd: pre.costUsd, window: job.window } });
    return pre;
  }

  /**
   * D6: Slack triage's escalation has a per-day allowance (Settings ▸ Budgets). What is left of it today rides on the
   * triage config; at 0 the runner flags unsure lines for Triage instead of escalating them.
   */
  private async triageAllowance(job: ScanJob, spec: TraversalConnectorSpec): Promise<Partial<ScanSkillRunInput>> {
    const t = spec.triage?.(job.scope, job.mode);
    if (!t?.escalateModel || !this.store.escalationAllowance) return {};
    const a = await this.store.escalationAllowance().catch(() => null);
    if (!a) return {};
    return { triage: { ...t, escalateLeftUsd: Math.max(0, a.capUsd - a.spentUsd) } };
  }

  private traversalInput(job: ScanJob, spec: TraversalConnectorSpec, ctx: ScanContext, runId: string, signal: AbortSignal): ScanSkillRunInput {
    const mode = job.mode === 'manual' || job.mode === 'retry' ? 'incremental' : job.mode;
    return {
      skillPath: spec.skillPath,
      model: job.model ?? spec.model,
      mcpServers: spec.mcpServers(),
      allowedTools: spec.allowedTools,
      runId,
      context: ctx,
      maxTurns: spec.maxTurns(job.scope, job.mode),
      costCapUsd: spec.costCapUsd(job.scope, job.mode),
      ...(spec.timeoutMs ? { timeoutMs: spec.timeoutMs(job.scope, job.mode) } : {}),
      signal,
      window: job.window,
      mode,
      vars: { ...spec.scopeVars(job.scope, ctx), ...(job.vars ?? {}) },
      instruction: job.instruction,
      ...(spec.autoRecord ? { autoRecord: spec.autoRecord } : {}),
      ...(spec.triage?.(job.scope, job.mode) ? { triage: spec.triage(job.scope, job.mode) } : {}),
    };
  }

  private async runDeterministic(
    job: ScanJob,
    spec: DeterministicConnectorSpec,
    ctx: ScanContext,
    runId: string,
    signal: AbortSignal,
    overBudget: boolean,
  ): Promise<{ result: ScanSkillRunResult; cursor?: Cursor; complete: boolean }> {
    const maxItems = Number(job.vars?.['maxItems']);
    const limit = Number.isFinite(maxItems) && maxItems > 0 ? Math.min(maxItems, spec.maxItemsPerRun) : spec.maxItemsPerRun;
    const f0 = Date.now();
    const fetch = await spec.fetcher.fetch(job.scope, ctx.cursor, job.window, { signal, limit });
    const base: ScanSkillRunResult = { ok: true, costUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0 };
    // D3: what the fetcher keeps from the model is recorded deterministically (live state shows now), with its reason.
    const quiet = { recorded: 0, new: 0, changed: 0 };
    if (fetch.quietItems?.length) {
      for (const r of await this.store.recordSourceItems(runId, fetch.quietItems)) {
        quiet.recorded += 1;
        if (r.isNew) quiet.new += 1;
        if (r.changed) quiet.changed += 1;
      }
    }
    for (const d of fetch.decisions ?? []) await this.store.recordDecision?.({ skill: skillKeyOf(spec), kind: 'skip', reason: d.reason, trigger: job.trigger, subject: d.subject, ...(d.detail ? { detail: d.detail } : {}) });
    if (fetch.quietItems?.length || fetch.decisions?.length) trace(runId, 'quiet', () => ({ items: fetch.quietItems?.length ?? 0, reasons: [...new Set((fetch.decisions ?? []).map((d) => d.reason))] }));
    const withQuiet = <T extends ScanSkillRunResult>(r: T): T => (quiet.recorded && r.counts ? { ...r, counts: { ...r.counts, recorded: r.counts.recorded + quiet.recorded, new: r.counts.new + quiet.new, changed: r.counts.changed + quiet.changed } } : r);
    trace(runId, 'prefetch', { items: fetch.items.length, limit, coverage: fetch.coverage.length, complete: fetch.complete, recordOnly: !!fetch.recordOnly, nextCursorAt: fetch.nextCursor.at, ms: Date.now() - f0, agent: !((!fetch.items.length && !spec.alwaysRunAgent) || overBudget || fetch.recordOnly), deferred: overBudget && fetch.items.length > 0 });
    if ((!fetch.items.length && !spec.alwaysRunAgent) || overBudget || fetch.recordOnly) {
      // Cheap path: nothing to interpret (an empty fetch, or record-only history), or linking deferred at the hard cap
      // (SCANNER.md §7).
      const counts = { recorded: 0, new: 0, changed: 0, linked: 0, proposed: 0, unlinked: 0, coverage: fetch.coverage.length };
      if (fetch.items.length) {
        const res = await this.store.recordSourceItems(runId, fetch.items);
        for (const r of res) {
          counts.recorded += 1;
          if (r.isNew) counts.new += 1;
          if (r.changed) counts.changed += 1;
          if ((r.isNew || r.changed) && !fetch.recordOnly) {
            await this.store.flagUnlinked(runId, { sourceItemId: r.sourceItemId, reason: 'deferred: daily LLM hard cap; linking deferred to reconcile' });
            counts.unlinked += 1;
          }
        }
      }
      if (fetch.coverage.length) await this.store.reportCoverage(runId, fetch.coverage);
      return { result: withQuiet({ ...base, counts, complete: fetch.complete }), cursor: fetch.nextCursor, complete: fetch.complete };
    }
    // The worker commits fetch.nextCursor itself (below); the agent's cc_finish echo is never used. Fetcher cursor state
    // grows (per-file offsets, seen ids) past cc_finish's 200-char cursor.value limit, and the agent then refused to
    // alter it and stopped without cc_finish on every run of the scope, forever (stress finding CUR-1). A long cursor
    // is handed to the agent as a short stand-in token instead.
    const agentCursor = fetch.nextCursor.value.length <= HEADER_CURSOR_MAX ? fetch.nextCursor.value : `header:${runId.slice(0, 8)}`;
    const input: ScanSkillRunInput = {
      skillPath: spec.skillPath,
      model: job.model ?? spec.model,
      mcpServers: spec.mcpServers?.() ?? {},
      allowedTools: spec.allowedTools ?? [],
      runId,
      context: ctx,
      prefetched: fetch.items,
      preReportedCoverage: fetch.coverage,
      maxTurns: spec.maxTurns(job.scope, job.mode),
      costCapUsd: spec.costCapUsd(job.scope, job.mode),
      signal,
      window: job.window,
      mode: job.mode === 'manual' || job.mode === 'retry' ? 'incremental' : job.mode,
      vars: { 'header.cursor.value': agentCursor, 'header.cursor.at': fetch.nextCursor.at, 'header.complete': String(fetch.complete), 'header.items': fetch.items.length },
      instruction: `Header: the worker fetched and recorded ${fetch.items.length} item(s) (each has its sourceItemId) and already reported the fetcher coverage. Interpret and link them per the skill, then call cc_finish with the header cursor unchanged: {"value":"${agentCursor}","at":"${fetch.nextCursor.at}"}, complete=${fetch.complete}.`,
    };
    const result = withQuiet((await this.withLlmSlot(() => this.runner.run(input, this.store))) as ScanSkillRunResult);
    return { result, cursor: result.ok ? fetch.nextCursor : undefined, complete: fetch.complete };
  }

  private statsOf(r: ScanSkillRunResult): ScanRunStats {
    const c = r.counts;
    return {
      fetched: c?.recorded ?? 0,
      new: c?.new ?? 0,
      changed: c?.changed ?? 0,
      linked: c?.linked ?? 0,
      proposed: c?.proposed ?? 0,
      unlinked: c?.unlinked ?? 0,
      costUsd: r.costUsd,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      turns: r.turns,
    };
  }

  private async onSuccess(spec: ConnectorSpec, st: ScopeState, now: Date, stats: ScanRunStats) {
    const t = now.getTime();
    st.failures = 0;
    st.transientStreak = 0;
    // A success proves the connector works: lift any auth pause on its other scopes (an auth probe ran unpaused).
    const authPaused = [...this.scopes.values()].filter((o) => o.key.connector === spec.connector && o.paused === 'auth');
    if (st.paused === 'auth' || st.paused === 'config' || authPaused.length) {
      for (const other of authPaused) {
        other.paused = undefined;
        other.authPausedAt = undefined;
        other.nextDueAt = Math.min(other.nextDueAt, t);
      }
      st.paused = undefined;
      st.authPausedAt = undefined;
      this.log({ event: 'resumed', connector: spec.connector, scope: st.key.scope, code: 'auth_ok' });
    }
    st.quietLevel = stats.new + stats.changed > 0 ? 0 : Math.min(st.quietLevel + 1, this.cadence.maxQuietLevel);
    st.lastOkAt = t;
    const next = intervalMs(this.cadence, spec.connector, st.key.scope, now, st.quietLevel);
    if (t + next > st.nextDueAt) {
      st.nextDueAt = t + next;
      st.lastIntervalMs = next;
    }
    await this.maybeReleaseCatchUp(spec, st, now);
    // HEALTH-1: a success makes the connector healthy again (and clears its reason) once none of its other scopes is
    // failing. The in-memory flag starts empty after a restart, so the first success writes ok too. Before, only a
    // connector this process had seen fail was ever reset: a worker restarted after failures left seven connectors
    // Degraded for good, with a fresh last success and 0 failures. A scope that keeps failing keeps it Degraded, with
    // that scope's reason.
    // Only recent failures hold it: a one-off scope (a thread re-read) that failed and is never retried stops counting.
    const failing = [...this.scopes.values()].some((o) => o.key.connector === spec.connector && o !== st && o.failures > 0 && t - (o.lastFailAt ?? 0) < 2 * 60 * MIN);
    if (!failing) {
      if (this.healthState.get(spec.connector) !== 'ok') await this.store.recordHealth(spec.connector, { state: 'ok', checkedAt: now.toISOString() });
      this.healthState.set(spec.connector, 'ok');
    }
  }

  /** Catch-up ends when every job of its plan finished (ok, or failed for good) and the cursor reached now. */
  private async maybeReleaseCatchUp(spec: ConnectorSpec, st: ScopeState, now: Date) {
    if (!st.catchUp) return;
    const outstanding = [...st.catchUp.jobs.keys()].filter((id) => !st.catchUp!.done.has(id));
    // Safety valve: a plan job lost outside the runtime (cancelled or dead-lettered as a job) must not hold the
    // catch-up flag forever; after 6 h only the cursor decides.
    if (outstanding.length && now.getTime() - st.catchUp.at < 6 * 60 * MIN) return;
    const cursor = await this.store.getCursor(st.key);
    const remaining = cursor ? await this.store.coverageGaps(st.key, { from: cursor.at, to: now.toISOString() }) : [];
    const left = remaining.reduce((a, w) => a + Date.parse(w.to) - Date.parse(w.from), 0);
    if (left <= this.cadence.baseMs[spec.connector]! * 2 || left <= MIN) st.catchUp = undefined;
  }

  private async onFailure(job: ScanJob, spec: ConnectorSpec, st: ScopeState, runId: string, now: Date, message: string, errorClass: ErrorClass, result: ScanSkillRunResult): Promise<JobOutcome> {
    const out = await this.onFailureInner(job, spec, st, runId, now, message, errorClass, result);
    // A plan job is done when it will not run again (no retry); splits replace it with tracked follow-ups.
    if (!out.retryAt) {
      this.markCatchUpDone(st, job.id);
      await this.maybeReleaseCatchUp(spec, st, now);
    }
    return out;
  }

  private async onFailureInner(job: ScanJob, spec: ConnectorSpec, st: ScopeState, runId: string, now: Date, message: string, errorClass: ErrorClass, result: ScanSkillRunResult): Promise<JobOutcome> {
    const t = now.getTime();
    // Too much in one window: split it (max_turns / cost cap) instead of retrying the same thing. A prefix tripwire is
    // about the fixed prompt (skill, context pack, tool schemas), not the window: a traversal run's first call holds no
    // fetched data, so splitting time cascaded down to 10-minute windows, one failed first call each (TRIP-3). It backs
    // off and retries the same window instead. A deterministic run still halves its prefetched items.
    const tripwire = /prefix tripwire/i.test(message);
    const splittable = /max_turns|cost cap/i.test(message) || (tripwire && !isTraversal(spec));
    const span = Date.parse(job.window.to) - Date.parse(job.window.from);
    // A deterministic run whose agent stopped before cc_finish usually had too many items to work through (seen with
    // 25 emails in the stress runs): retry with fewer items like a cost-cap failure (stress finding F-1).
    const fewerItems = (splittable || /without cc_finish/i.test(message)) && !isTraversal(spec);
    const limit = isTraversal(spec) ? 0 : Number(job.vars?.['maxItems'] ?? spec.maxItemsPerRun);
    // MIN-26: a planned split or fewer-items retry is the runtime's normal oversize handling (the same window again, in
    // smaller runs; nothing is lost), so it neither degrades the connector nor counts as a failure. Before, Health
    // flipped a connector to Degraded and back on each one (Gemini notes and Gmail on the full first scan). A real
    // failure, and a single item over the budget, still do.
    const planned = errorClass !== 'auth' && (fewerItems ? limit > 1 : splittable && span >= 10 * MIN);
    if (!planned) {
      st.failures += 1;
      st.lastFailAt = t;
    }
    st.transientStreak = errorClass === 'transient' || errorClass === 'rate_limited' ? st.transientStreak + 1 : 0;
    const c = classifyError(message);
    const probe = probeFromClassification(spec.connector, { errorClass, code: result.error?.disallowedTool ? 'disallowed_tool' : c.code, gateway: c.gateway }, now.toISOString(), st.transientStreak, result.error?.disallowedTool ?? undefined);
    const code = probe.detail?.split(':')[0];
    // STAT-1: the status reason names the scope and the cause in plain words, not the classifier's code ("unknown").
    probe.detail = statusReason(spec.connector, st.key.scope, message, errorClass, result.error?.disallowedTool ?? undefined);
    if (planned) {
      if (this.healthState.get(spec.connector) !== 'bad') this.healthState.set(spec.connector, 'retry');
    } else {
      await this.store.recordHealth(spec.connector, probe);
      this.healthState.set(spec.connector, 'bad');
    }
    this.log({ event: 'run_fail', connector: spec.connector, scope: st.key.scope, runId, mode: job.mode, code, costUsd: result.costUsd, ...(planned ? { planned: true } : {}) });

    const followUps: RuntimeJob[] = [];
    if (errorClass === 'auth') {
      for (const other of this.scopes.values()) {
        if (other.key.connector !== spec.connector) continue;
        other.paused = 'auth';
        other.authPausedAt = t;
      }
      return { status: 'failed', runId, errorClass, followUps, detail: probe.detail, costUsd: result.costUsd };
    }
    if (fewerItems) {
      // Deterministic: halve the number of items handed to the agent (snapshot fetchers ignore the window, so a time
      // split repeated the same oversized run down to 10-minute windows; stress finding CAL-1). Bounded: log2(limit).
      if (limit > 1) {
        const half = Math.max(1, Math.floor(limit / 2));
        followUps.push(scanJob({ connector: spec.connector, scope: st.key.scope, window: job.window, mode: 'retry', trigger: job.trigger, runAt: now.toISOString(), model: job.model, vars: { ...(job.vars ?? {}), maxItems: String(half) }, priority: job.priority, ...(job.budget ? { budget: job.budget } : {}) }));
        this.trackFollowUps(st, followUps);
        return { status: 'failed', runId, errorClass, followUps, detail: `${probe.detail}; retrying with ${half} item(s)`, costUsd: result.costUsd };
      }
      st.nextDueAt = t + stuckDelayMs(st.failures);
      return { status: 'failed', runId, errorClass, followUps, detail: `${probe.detail}; a single item exceeds the run budget`, costUsd: result.costUsd };
    }
    if (splittable && span >= 10 * MIN) {
      const mid = new Date(Date.parse(job.window.from) + Math.floor(span / 2)).toISOString();
      for (const w of [{ from: job.window.from, to: mid }, { from: mid, to: job.window.to }]) {
        followUps.push(scanJob({ connector: spec.connector, scope: st.key.scope, window: w, mode: 'retry', trigger: job.trigger, runAt: now.toISOString(), model: job.model, vars: job.vars, priority: job.priority, ...(job.budget ? { budget: job.budget } : {}) }));
      }
      this.trackFollowUps(st, followUps);
      return { status: 'failed', runId, errorClass, followUps, detail: `${probe.detail}; window split`, costUsd: result.costUsd };
    }
    if (result.error?.disallowedTool) {
      st.paused = 'config';
      st.nextDueAt = t + 30 * MIN;
      return { status: 'failed', runId, errorClass: 'config', followUps, detail: probe.detail, costUsd: result.costUsd };
    }
    const delay = failureDelayMs(errorClass, st.failures);
    const attempt = (job.attempt ?? 0) + 1;
    if (delay == null || attempt > 5) {
      st.nextDueAt = t + stuckDelayMs(st.failures);
      return { status: 'failed', runId, errorClass, followUps, detail: `${probe.detail}; no automatic retry`, costUsd: result.costUsd };
    }
    st.nextDueAt = t + delay;
    // An incremental poll is subsumed by the next poll from the unmoved cursor; other windows retry as-is.
    const retryAt = job.mode === 'incremental' ? undefined : new Date(t + delay).toISOString();
    return { status: 'failed', runId, errorClass, retryAt: retryable(errorClass) || errorClass === 'config' ? retryAt : undefined, followUps, detail: probe.detail, costUsd: result.costUsd };
  }

  private trackFollowUps(st: ScopeState, jobs: RuntimeJob[]) {
    const t = this.clock.now().getTime();
    for (const j of jobs) {
      if (j.kind !== 'scan' || scopeId({ connector: j.connector, scope: j.scope }) !== scopeId(st.key)) continue;
      st.pending.set(j.id, t);
      if (st.catchUp) st.catchUp.jobs.set(j.id, j.window);
    }
  }

  private scopeState(key: ScopeKey): ScopeState {
    const sid = scopeId(key);
    let st = this.scopes.get(sid);
    if (!st) {
      st = { key, nextDueAt: this.clock.now().getTime(), quietLevel: 0, failures: 0, transientStreak: 0, pending: new Map() };
      // Ad-hoc scopes (threads, targeted) are not polled; they exist only while a job runs.
      if (!key.scope.startsWith('thread:') && !key.scope.startsWith('reconcile:')) this.scopes.set(sid, st);
    }
    return st;
  }

  private async executeReconcile(job: ReconcileJob, signal: AbortSignal): Promise<JobOutcome> {
    this.log({ event: 'reconcile', detail: job.passes.join(',') });
    const report = await this.reconciler.run(job, signal);
    return { status: report.errors.length ? 'failed' : 'succeeded', followUps: report.jobs, costUsd: report.costUsd, detail: report.summary };
  }

  private async withLlmSlot<T>(fn: () => Promise<T>): Promise<T> {
    while (this.llmSlots <= 0) await new Promise<void>((r) => this.llmWaiters.push(r));
    this.llmSlots -= 1;
    try {
      return await fn();
    } finally {
      this.llmSlots += 1;
      this.llmWaiters.shift()?.();
    }
  }

  // ===================================================================== on-demand API

  /**
   * Chat `/rescan` and Health "Rescan". Runs now (waits for the connector lock), oldest → newest in
   * chunks when the window is large. Default window: from the cursor (or the initial lookback) to now.
   * A successful manual run also clears an auth pause.
   */
  async runScope(scope: ScopeKey, trigger: 'manual' | 'chat' | 'reconcile' = 'manual', window?: TimeWindow, signal?: AbortSignal): Promise<JobOutcome[]> {
    const spec = this.specs.get(scope.connector);
    if (!spec) return [{ status: 'skipped', followUps: [], detail: `no spec for ${scope.connector}` }];
    const now = this.clock.now();
    const cursor = await this.store.getCursor(scope);
    const w = window ?? { from: cursor?.at ?? new Date(now.getTime() - spec.initialLookbackMs).toISOString(), to: now.toISOString() };
    const chunks: TimeWindow[] = [];
    for (let a = Date.parse(w.from), end = Date.parse(w.to); a < end; a += spec.chunkMs) {
      chunks.push({ from: new Date(a).toISOString(), to: new Date(Math.min(a + spec.chunkMs, end)).toISOString() });
    }
    if (!chunks.length) chunks.push(w);
    const outcomes: JobOutcome[] = [];
    const queue: ScanJob[] = chunks.map((c) => scanJob({ connector: scope.connector, scope: scope.scope, window: c, mode: 'manual', trigger, runAt: now.toISOString(), model: spec.model, vars: this.varsFor(spec, scope.scope) }));
    while (queue.length) {
      const job = queue.shift()!;
      const out = await this.executeJob(job, signal);
      outcomes.push(out);
      for (const f of out.followUps) if (f.kind === 'scan') queue.push({ ...f, trigger });
    }
    return outcomes;
  }

  /** Run reconcile passes now (Health / chat). */
  async runReconcile(passes: ReconcileJob['passes'] = ['coverage_gaps', 'unlinked', 'stale_active'], connector?: ConnectorId, signal?: AbortSignal) {
    const job = this.reconcileJob(passes, 'manual', this.clock.now(), `manual:${Date.now()}`);
    job.connector = connector;
    return this.reconciler.run(job, signal ?? new AbortController().signal);
  }

  /**
   * Re-auth done (Health "Re-auth" → `connector.reauth` job, or a successful manual Rescan): clear the auth/config
   * pause of every scope of the connector and make them due now. Returns the scopes resumed.
   */
  resumeConnector(connector: ConnectorId, now: Date = this.clock.now()): string[] {
    const out: string[] = [];
    for (const st of this.scopes.values()) {
      if (st.key.connector !== connector) continue;
      if (st.paused === 'auth' || st.paused === 'config') {
        st.paused = undefined;
        out.push(st.key.scope);
      }
      st.failures = 0;
      st.nextDueAt = Math.min(st.nextDueAt, now.getTime());
    }
    if (out.length) this.log({ event: 'resumed', connector, code: 'reauth', detail: out.join(',') });
    return out;
  }

  /** Known (planned) scope names of a connector. */
  scopesOf(connector: ConnectorId): string[] {
    return [...this.scopes.values()].filter((s) => s.key.connector === connector).map((s) => s.key.scope);
  }

  status(): ScopeStatus[] {
    return [...this.scopes.values()].map((st) => ({
      connector: st.key.connector,
      scope: st.key.scope,
      nextDueAt: new Date(st.nextDueAt).toISOString(),
      quietLevel: st.quietLevel,
      failures: st.failures,
      paused: st.paused,
      catchingUp: !!st.catchUp,
    }));
  }

  /** "Catching up: Slack 60%" (UI-SPEC §10): covered fraction of each connector's catch-up plan. */
  async catchUpProgress(): Promise<Partial<Record<ConnectorId, number>>> {
    const out: Partial<Record<ConnectorId, number>> = {};
    const agg = new Map<ConnectorId, { planned: TimeWindow[]; remaining: TimeWindow[] }>();
    for (const st of this.scopes.values()) {
      if (!st.catchUp) continue;
      const a = agg.get(st.key.connector) ?? { planned: [], remaining: [] };
      a.planned.push(...st.catchUp.planned);
      // Outstanding plan windows (continuations count as what is left of their chunk).
      for (const [id, w] of st.catchUp.jobs) if (!st.catchUp.done.has(id)) a.remaining.push(w);
      agg.set(st.key.connector, a);
    }
    for (const [c, a] of agg) out[c] = Math.round(catchUpFraction(a.planned, a.remaining) * 100);
    return out;
  }

  isCatchingUp(connector?: ConnectorId): boolean {
    return [...this.scopes.values()].some((s) => !!s.catchUp && (!connector || s.key.connector === connector));
  }

  // ===================================================================== standalone loop

  /**
   * Standalone scheduler loop (dev, tests). Requires the default InMemoryJobQueue. BE-1's worker
   * does NOT call this; it calls planJobs() on its tick and executeJob() per dequeued row.
   */
  start(opts: { tickMs?: number; concurrency?: number } = {}): void {
    if (this.loop) return;
    if (!(this.queue instanceof InMemoryJobQueue)) throw new Error('start() needs the in-memory queue; with an external queue call planJobs/executeJob');
    const q = this.queue;
    const ac = new AbortController();
    const tick = opts.tickMs ?? 15_000;
    const running = new Map<string, Promise<void>>();
    const done = (async () => {
      while (!ac.signal.aborted) {
        await q.enqueue(await this.planJobs());
        const busy = new Set<string>([...running.keys()]);
        while (running.size < (opts.concurrency ?? 3)) {
          const job = q.dequeue(this.clock.now(), busy);
          if (!job) break;
          const key = job.kind === 'scan' ? job.connector : `reconcile`;
          busy.add(key);
          const p = this.executeJob(job, ac.signal)
            .then(async (out) => {
              await q.enqueue(out.followUps);
              if (out.retryAt && job.kind === 'scan') await q.enqueue([retryJobOf(job, out)]);
            })
            .catch((err) => this.log({ event: 'run_fail', code: 'execute_threw', detail: classifyError(err).code }))
            .finally(() => running.delete(key));
          running.set(key, p);
        }
        await this.clock.sleep(tick, ac.signal);
      }
      await Promise.allSettled(running.values());
    })();
    this.loop = { stop: () => ac.abort(), done };
  }

  async stop(): Promise<void> {
    if (!this.loop) return;
    this.loop.stop();
    await this.loop.done;
    this.loop = undefined;
  }

  /** Drain the in-memory queue synchronously (tests / scripts): plan, then execute due jobs until empty. */
  async drain(opts: { maxJobs?: number; signal?: AbortSignal } = {}): Promise<JobOutcome[]> {
    if (!(this.queue instanceof InMemoryJobQueue)) throw new Error('drain() needs the in-memory queue');
    const q = this.queue;
    const outcomes: JobOutcome[] = [];
    await q.enqueue(await this.planJobs());
    for (let i = 0; i < (opts.maxJobs ?? 500); i++) {
      const job = q.dequeue(new Date(8.64e15));
      if (!job) break;
      const out = await this.executeJob(job, opts.signal);
      outcomes.push(out);
      await q.enqueue(out.followUps);
    }
    return outcomes;
  }
}

export type { ScanJobMode };
