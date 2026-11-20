/**
 * World: one scenario's simulated worker. It wires the PRODUCTION pieces exactly as `src/worker/index.ts`
 * does (DbScannerStore, buildLiveFetchers, buildScanning → ScannerRuntime + PgRuntimeJobQueue, the job
 * registry, WorkerRuntime with real claims/leases/reaper, the wake handler) over:
 *   - a cloned scenario DB whose `now()` is the simulated clock;
 *   - replayed sources (Slack/Org62 in-process MCP servers under the real names, the real Google client over
 *     a replay transport, Claude transcripts materialized to the simulated now);
 *   - the real Haiku SkillRunner (`runner: 'live'`, spend ledgered and capped) or the scripted stand-in.
 * The driver steps time: plan → claim → wait, then fast-forwards idle time to the next due poll.
 */
import fs from 'node:fs';
import path from 'node:path';

import { sql } from 'drizzle-orm';

import type { DbHandle } from '../../../src/db/client';
import { actors, closeIdleBursts, withChangeSet } from '../../../src/db/changeset';
import { createDefaultRegistry } from '../../../src/jobs';
import { COMPLETION_JOB_KIND, completionHandler } from '../../../src/jobs/handlers/completion';
import { reevaluateHandler } from '../../../src/jobs/handlers/reevaluate';
import { agentSdkCompletionModel, type CompletionModel } from '../../../src/scanner/completion';
import { AgentSdkSkillRunner, type RunnerLogEvent, type ScanSkillRunInput } from '../../../src/llm/skill-runner';
import { WakeDetector } from '../../../src/ops/lifecycle';
import type { ScanSkillRunResult } from '../../../src/scanner/runtime/contract-ext';
import { DbScannerStore } from '../../../src/scanner/store-db';
import type { ConnectorId, ScannerStore, SkillRunner } from '../../../src/scanner/types';
import type { TraversalConnectorSpec } from '../../../src/scanner/runtime/connectors';
import type { SkillPassStat } from '../../../src/llm/skill-runner';
import { WorkerRuntime } from '../../../src/worker/runtime';
import { buildLiveFetchers, buildScanning, loadWorkHours, type Scanning } from '../../../src/worker/scanning';

import { cloneScenarioDb, openStressDb } from '../lib/db';
import { assertBudget, recordSpend } from '../lib/ledger';
import { privDir, readJson, writePriv } from '../lib/paths';
import { loadProfileIntoDb, type StressProfile } from '../lib/profile';
import { SimClock } from '../lib/sim-clock';
import { loadTranscriptIndex, materialize, type TranscriptIndex } from '../replay/claude';
import { FaultInjector, type FaultRule } from '../replay/faults';
import { GoogleReplay, replayGoogleClient, type GoogleOverlay } from '../replay/google';
import { org62ReplayServer, slackReplayServer, type ToolCallLog } from '../replay/servers';
import { SlackReplay, channelNameMap, type SlackIndex } from '../replay/slack';
import type { SoqlTable } from '../replay/soql';
import type { GoogleRecording } from '../record/google';

import { ScriptedSkillRunner, type ScriptedHooks } from './scripted-runner';

export interface WorldOptions {
  scenario: string;
  start: string;
  sources: ConnectorId[];
  runner: 'live' | 'scripted';
  profile: StressProfile;
  channels?: string[];
  faults?: { slack?: FaultRule[]; org62?: FaultRule[]; google?: FaultRule[] };
  slackOverlay?: (ix: SlackIndex) => void;
  googleOverlay?: GoogleOverlay;
  budgets?: { softUsd: number; hardUsd: number };
  repoRoot?: string;
  /** Override the Slack inbox backfill chunk (hours), e.g. to compare against the pre-SLK-1 6 h. */
  slackInboxChunkH?: number;
  /** STRESS-2 variants: REC-1 and the triage pass (+ escalation) for Slack; given = replaces the env defaults. */
  slackRecall?: Pick<TraversalConnectorSpec, 'autoRecord' | 'triage'>;
  hooks?: ScriptedHooks;
  /** Campaign ledger estimate per live run (pre-flight cap check). */
  liveRunEstimateUsd?: number;
  /**
   * CMP-1: run the completion pass (`completion.check` after scans, live Haiku, ledgered as `completion`) and the
   * real `reevaluate` job (closure machine), as the production worker does. Off: neither runs (earlier scenarios).
   */
  completion?: boolean;
  log?: (m: string) => void;
  /** Reuse an existing scenario DB instead of cloning (child processes). */
  reuseDb?: { name: string; url: string };
  /** With reuseDb: this process owns the simulated clock (a resumed run), so its jumps are written to the DB. */
  ownClock?: boolean;
  recordings?: { slack?: SlackIndex; google?: GoogleRecording; org62?: Record<string, SoqlTable>; claude?: TranscriptIndex };
}

export interface RunLogRow {
  at: string;
  connector?: string;
  scope?: string;
  mode?: string;
  event: string;
  code?: string;
  costUsd?: number;
}

export function loadRecordings(need: ConnectorId[]): NonNullable<WorldOptions['recordings']> {
  const r: NonNullable<WorldOptions['recordings']> = {};
  const root = privDir('recordings');
  if (need.includes('slack') || need.includes('watch')) r.slack = readJson<SlackIndex>(path.join(root, 'slack', 'index.json'));
  if (need.some((c) => ['gmail', 'calendar', 'drive', 'gemini_notes', 'trainings'].includes(c))) r.google = readJson<GoogleRecording>(path.join(root, 'google', 'recording.json'));
  if (need.includes('org62')) r.org62 = readJson<Record<string, SoqlTable>>(path.join(root, 'org62', 'tables.json'));
  if (need.includes('claude_sessions')) r.claude = loadTranscriptIndex();
  return r;
}

export class World {
  readonly o: WorldOptions;
  readonly clock: SimClock;
  handle!: DbHandle;
  dbName!: string;
  dbUrl!: string;
  userId!: string;
  store!: DbScannerStore;
  scanning!: Scanning;
  runtime!: WorkerRuntime<unknown>;
  wake!: WakeDetector;
  slack?: SlackReplay;
  google?: GoogleReplay;
  org62Stats = { calls: 0, misses: 0, leaks: 0, missReasons: [] as string[] };
  readonly toolLog: ToolCallLog[] = [];
  readonly runLog: RunLogRow[] = [];
  readonly faults: { slack: FaultInjector; org62: FaultInjector; google: FaultInjector };
  readonly scripted?: ScriptedSkillRunner;
  private live?: AgentSdkSkillRunner;
  readonly stateDir: string;
  private claudeSnap?: string;
  private recs: NonNullable<WorldOptions['recordings']>;
  boots = 0;
  costUsd = 0;
  /** Per-run pass stats (traversal / triage / escalate) of live runs. */
  readonly passLog: Array<{ at: string; runId: string; scope: string; ms?: number; passes: SkillPassStat[] }> = [];
  /** CMP-1 completion pass spend (also included in costUsd). */
  completionUsd = 0;
  completionCalls = 0;
  private completionModel?: CompletionModel;

  constructor(o: WorldOptions) {
    this.o = o;
    this.clock = new SimClock(o.start);
    const now = () => this.clock.nowMs();
    this.faults = { slack: new FaultInjector(o.faults?.slack, 7, now), org62: new FaultInjector(o.faults?.org62, 11, now), google: new FaultInjector(o.faults?.google, 13, now) };
    this.recs = o.recordings ?? loadRecordings(o.sources);
    if (this.recs.slack) {
      const ix = structuredClone(this.recs.slack);
      o.slackOverlay?.(ix);
      this.slack = new SlackReplay(ix, { now });
    }
    if (this.recs.google) this.google = new GoogleReplay(this.recs.google, { now, overlay: o.googleOverlay });
    if (o.runner === 'scripted') {
      this.scripted = new ScriptedSkillRunner({ slack: this.slack, org62: this.recs.org62, now, hooks: { faults: this.faults.slack, channelNames: this.channelNames(), ...o.hooks } });
    }
    this.stateDir = privDir('state', o.scenario.replace(/[^a-z0-9_-]/gi, '_'));
  }

  log(m: string) {
    this.o.log?.(`[${this.o.scenario} ${this.clock.now().toISOString().slice(0, 16)}] ${m}`);
  }

  private channelNames(): Record<string, string> {
    const out: Record<string, string> = {};
    if (!this.slack) return out;
    for (const [name, id] of Object.entries(channelNameMap(this.slack.ix))) out[id] = name;
    for (const c of this.o.profile.channels) if (!out[c.id]) out[c.id] = c.name.replace(/^#/, '');
    return out;
  }

  /** Create the scenario DB, bind the clock, load the profile. */
  async init(): Promise<void> {
    const db = this.o.reuseDb ?? (await cloneScenarioDb(this.o.scenario));
    this.dbName = db.name;
    this.dbUrl = db.url;
    this.handle = openStressDb(db.url, `stress-${this.o.scenario}`);
    if (this.o.reuseDb) {
      await this.clock.syncFromDb(this.handle.db);
      if (this.o.ownClock) await this.clock.bindDb(this.handle.db);
    } else await this.clock.bindDb(this.handle.db);
    if (!this.o.reuseDb) {
      this.userId = await loadProfileIntoDb(this.handle.db, this.o.profile, { channels: this.o.channels });
      if (this.o.budgets) {
        const b = this.o.budgets;
        await withChangeSet({ db: this.handle.db, userId: this.userId, actor: actors.system('stress-budgets'), reason: 'stress budgets' }, async (tx) => {
          await tx.execute(sql`update user_settings set value = ${JSON.stringify({ version: 1, ...b, alertPct: 80 })}::jsonb where owner_user_id = ${this.userId} and key = 'settings.budgets'`);
        });
      }
    } else {
      const r = await this.handle.db.execute<{ id: string }>(sql`select id from users order by created_at limit 1`);
      this.userId = r.rows[0]!.id;
    }
    if (this.o.sources.includes('claude_sessions')) {
      this.claudeSnap = path.join(this.stateDir, 'claude-projects');
      fs.mkdirSync(this.claudeSnap, { recursive: true, mode: 0o700 });
      fs.mkdirSync(path.join(this.stateDir, 'claude-sessions-registry'), { recursive: true, mode: 0o700 });
    }
  }

  private runner(): SkillRunner {
    if (this.scripted) return this.scripted;
    if (!this.live) {
      this.live = new AgentSdkSkillRunner({
        repoRoot: this.o.repoRoot,
        timeoutMs: 280_000,
        logger: (e: RunnerLogEvent) => {
          if (e.event === 'error' || e.event === 'denied' || e.event === 'tool' || e.event === 'result') this.runLog.push({ at: this.clock.now().toISOString(), event: `skill_${e.event}:${e.runId}`, code: e.code ?? e.tool, costUsd: e.costUsd });
        },
      });
    }
    const live = this.live;
    const est = this.o.liveRunEstimateUsd ?? 0.15;
    return {
      run: async (input: ScanSkillRunInput, store: ScannerStore): Promise<ScanSkillRunResult> => {
        assertBudget(est);
        const t0 = Date.now();
        const r = (await live.run(input, store)) as ScanSkillRunResult & { passes?: SkillPassStat[] };
        const ms = Date.now() - t0;
        this.costUsd += r.costUsd;
        const note = `${input.context.scope.connector}:${input.context.scope.scope}:${input.mode ?? ''}`;
        const passes = r.passes?.length ? r.passes : [{ pass: 'traversal' as const, model: input.model, costUsd: r.costUsd }];
        for (const p of passes) recordSpend({ scenario: this.o.scenario, kind: p.pass === 'triage' ? 'triage' : p.pass === 'escalate' || p.model.includes('sonnet') ? 'escalation' : 'scanner', model: p.model, costUsd: p.costUsd, runId: input.runId, note });
        this.passLog.push({ at: this.clock.now().toISOString(), runId: input.runId, scope: note, ms, passes: r.passes ?? [] });
        return r;
      },
    };
  }

  /** The completion check's model, with the campaign's pre-flight cap and spend ledger (kind `completion`). */
  private ledgeredCompletionModel(): CompletionModel {
    const real = (this.completionModel ??= agentSdkCompletionModel({ timeoutMs: 120_000 }));
    return async (req) => {
      assertBudget(0.02);
      const r = await real(req);
      this.costUsd += r.costUsd;
      this.completionUsd += r.costUsd;
      this.completionCalls += 1;
      recordSpend({ scenario: this.o.scenario, kind: 'completion', model: req.model, costUsd: r.costUsd, note: `completion.check ok=${r.ok}` });
      this.runLog.push({ at: this.clock.now().toISOString(), event: `completion_call:${r.ok ? 'ok' : (r.error?.errorClass ?? 'error')}`, costUsd: r.costUsd });
      return r;
    };
  }

  /** "Worker start": a fresh ScannerRuntime + WorkerRuntime over the same DB (what a restart does). */
  /** `idle`: build the scanner and worker but plan and claim nothing (scenarios that drive single jobs). */
  async boot(opts: { idle?: boolean } = {}): Promise<void> {
    this.boots += 1;
    const now = () => this.clock.now();
    this.store = new DbScannerStore({ db: this.handle.db, userId: this.userId, clock: now });
    const profile = this.o.profile;
    const me = { email: profile.me.email, name: profile.me.name, aliases: profile.me.aliases ?? [] };
    const google = this.google ? replayGoogleClient(this.google, this.faults.google, { timeoutMs: 20_000 }) : undefined;
    const want = new Set(this.o.sources);
    const fetchers = google
      ? buildLiveFetchers({
          google,
          me,
          store: this.store,
          only: want,
          dir: this.stateDir,
          clock: this.clock,
          claude: this.claudeSnap
            ? { projectsDir: this.claudeSnap, sessionsDir: path.join(this.stateDir, 'claude-sessions-registry'), desktopDir: null, listProcesses: async () => new Map() }
            : undefined,
        })
      : [];
    if (!google && want.has('claude_sessions')) {
      // Claude sessions without Google: build the same fetcher list (buildLiveFetchers needs a google client).
      fetchers.push(
        ...buildLiveFetchers({
          google: replayGoogleClient(new GoogleReplay({ span: { from: '', to: '' }, gmail: { bases: {}, messages: {}, threads: {} }, calendar: { from: '', to: '', blocks: [], header: '' }, drive: { feedFrom: '', rows: [], content: {} } }, { now: () => this.clock.nowMs() })),
          me,
          store: this.store,
          only: new Set(['claude_sessions']),
          dir: this.stateDir,
          clock: this.clock,
          claude: { projectsDir: this.claudeSnap!, sessionsDir: path.join(this.stateDir, 'claude-sessions-registry'), desktopDir: null, listProcesses: async () => new Map() },
        }),
      );
    }
    if (this.claudeSnap) this.materializeClaude();
    const workHours = await loadWorkHours(this.handle.db, this.userId);
    const nowMs = () => this.clock.nowMs();
    const traversal = want.has('slack') || want.has('org62');
    this.scanning = buildScanning({
      db: this.handle.db,
      userId: this.userId,
      store: this.store,
      clock: this.clock,
      fetchers,
      llm: traversal,
      runner: this.runner(),
      workHours,
      specOverrides: {
        slack: {
          mcpServers: () => (this.slack ? { slack: slackReplayServer(this.slack, { faults: this.faults.slack, log: this.toolLog, now: nowMs }) } : {}),
          ...(this.o.slackInboxChunkH ? { chunkMsFor: (scope: string) => (scope === 'inbox' ? this.o.slackInboxChunkH! : 6) * 3_600_000 } : {}),
          ...(this.o.slackRecall ? { autoRecord: this.o.slackRecall.autoRecord, triage: this.o.slackRecall.triage } : {}),
        },
        org62: { mcpServers: () => (this.recs.org62 ? { 'Org62-Sobject-Read': org62ReplayServer(this.recs.org62, { faults: this.faults.org62, log: this.toolLog, now: nowMs, stats: this.org62Stats }) } : {}) },
        ...(this.o.repoRoot ? {} : {}),
      },
      completionCheck: !!this.o.completion,
      log: (msg, d) => this.runLog.push({ at: this.clock.now().toISOString(), event: msg, connector: d?.connector as string | undefined, scope: d?.scope as string | undefined, code: d?.code as string | undefined }),
    });
    if (!want.has('slack') || !want.has('org62')) {
      // buildScanning adds both traversal specs together; drop the one this scenario does not run.
      const keep = this.scanning.specs.filter((s) => s.type !== 'traversal' || want.has(s.connector));
      if (keep.length !== this.scanning.specs.length) {
        const sc = this.scanning.scanner as unknown as { specs: Map<ConnectorId, unknown> };
        for (const s of this.scanning.specs) if (!keep.includes(s)) sc.specs.delete(s.connector);
      }
    }
    if (this.o.repoRoot) {
      (this.scanning.scanner as unknown as { deps: { repoRoot?: string } }).deps.repoRoot = this.o.repoRoot;
      (this.scanning.scanner.reconciler as unknown as { d: { repoRoot?: string } }).d.repoRoot = this.o.repoRoot;
    }
    const registry = createDefaultRegistry({ scan: this.scanning.handlerDeps });
    if (this.o.completion) {
      registry.wire(COMPLETION_JOB_KIND, completionHandler({ model: this.ledgeredCompletionModel(), repoRoot: this.o.repoRoot }));
      registry.wire('reevaluate', reevaluateHandler(), 'work item re-evaluation: closure machine (as in src/worker/index.ts)');
    }
    const dropped = await this.scanning.dropStalePlans();
    if (dropped) this.log(`dropped ${dropped} stale plans`);
    this.runtime = new WorkerRuntime({
      db: this.handle.db,
      userId: this.userId,
      workerId: `stress-${this.o.scenario}-${process.pid}-${this.boots}`,
      registry,
      services: { store: this.store, scanning: this.scanning },
      clock: now,
      listenUrl: null,
      log: (m, d) => this.runLog.push({ at: this.clock.now().toISOString(), event: m, code: d ? JSON.stringify(d).slice(0, 160) : undefined }),
      hooks: [this.scanning.planHook, { name: 'bursts', everyMs: 30_000, run: async () => void (await closeIdleBursts(this.handle.db)) }],
    });
    if (opts.idle) return;
    // WorkerRuntime.start() minus the real timers: reap, plan, claim. The driver steps the loop.
    (this.runtime as unknown as { started: boolean; state: string }).started = true;
    (this.runtime as unknown as { state: string }).state = 'idle';
    await this.runtime.reap();
    await this.runtime.runHooks();
    await this.runtime.pollOnce();
    this.wake = new WakeDetector((e) => void this.onWake(e.gapMs), { intervalMs: 5000, thresholdMs: 60_000, now: nowMs });
    this.log(`boot #${this.boots}: ${this.scanning.specs.map((s) => s.connector).join(',')}`);
  }

  /** Same as src/worker/index.ts: extend leases, reap, re-plan, claim; a gap over 30 min also queues reconcile. */
  async onWake(gapMs: number): Promise<void> {
    await this.runtime.onWake(gapMs);
    if (gapMs > 30 * 60_000) await this.scanning.enqueueResumeReconcile(`wake:${this.clock.now().toISOString().slice(0, 13)}`);
  }

  materializeClaude(): void {
    if (this.claudeSnap && this.recs.claude) materialize(this.recs.claude, this.claudeSnap, this.clock.nowMs());
  }

  /** One loop pass: reap, plan, claim, then wait for the claimed jobs (and their follow-ups) to settle. */
  async step(opts: { maxWaitMs?: number } = {}): Promise<number> {
    this.materializeClaude();
    await this.runtime.reap();
    await this.runtime.heartbeatOnce();
    await this.runtime.runHooks();
    let started = await this.runtime.pollOnce();
    const t0 = Date.now();
    while (this.runtime.activeCount > 0) {
      await new Promise((r) => setTimeout(r, 250));
      await this.runtime.heartbeatOnce();
      started += await this.runtime.pollOnce();
      if (Date.now() - t0 > (opts.maxWaitMs ?? 900_000)) break;
    }
    return started;
  }

  /** Earliest moment something is due: a queued job's run_at or a scope's next poll. */
  async nextDueMs(): Promise<number> {
    const q = await this.handle.db.execute<{ t: string | null }>(sql`select min(run_at) as t from jobs where status = 'queued'`);
    const jobAt = q.rows[0]?.t ? Date.parse(new Date(q.rows[0].t).toISOString()) : Infinity;
    const scopes = this.scanning.scanner.status().filter((s) => !s.paused).map((s) => Date.parse(s.nextDueAt));
    return Math.min(jobAt, ...scopes, Infinity);
  }

  /** Run the live loop until `untilIso`, fast-forwarding idle gaps (time still flows during runs). */
  async runUntil(untilIso: string, opts: { maxSteps?: number; onStep?: (w: World) => Promise<void>; maxJumpMs?: number } = {}): Promise<void> {
    const until = Date.parse(untilIso);
    for (let i = 0; i < (opts.maxSteps ?? 100_000) && this.clock.nowMs() < until; i++) {
      const started = await this.step();
      await opts.onStep?.(this);
      if (started) continue;
      const next = await this.nextDueMs();
      const target = Math.min(Math.max(next, this.clock.nowMs() + 1000), until, this.clock.nowMs() + (opts.maxJumpMs ?? Number.POSITIVE_INFINITY));
      if (target > this.clock.nowMs()) await this.clock.jumpTo(target);
    }
  }

  /** Graceful stop (SIGTERM path): abort runs, release leases. */
  async shutdown(reason = 'scenario shutdown'): Promise<void> {
    await this.runtime.stop(reason);
  }

  /** In-process crash: drop the runtime without releasing anything (its leases expire like a dead worker's). */
  crash(): void {
    for (const a of (this.runtime as unknown as { active: Map<number, { ac: AbortController }> }).active.values()) a.ac.abort(new Error('crash'));
    (this.runtime as unknown as { stopping: boolean }).stopping = true;
  }

  replayStats() {
    return {
      slack: this.slack?.stats,
      google: this.google?.stats,
      org62: this.org62Stats,
      faults: { slack: this.faults.slack.fired, org62: this.faults.org62.fired, google: this.faults.google.fired },
    };
  }

  async close(): Promise<void> {
    await this.handle.close().catch(() => undefined);
  }

  saveArtifacts(extra: Record<string, unknown> = {}): string {
    const dir = privDir('runs', this.o.scenario.replace(/[^a-z0-9_-]/gi, '_'));
    writePriv(path.join(dir, 'tool-log.json'), JSON.stringify(this.toolLog));
    writePriv(path.join(dir, 'run-log.json'), JSON.stringify(this.runLog));
    if (this.passLog.length) writePriv(path.join(dir, 'pass-log.json'), JSON.stringify(this.passLog));
    writePriv(path.join(dir, 'summary.json'), JSON.stringify({ scenario: this.o.scenario, db: this.dbName, costUsd: this.costUsd, completionUsd: this.completionUsd, completionCalls: this.completionCalls, boots: this.boots, replay: this.replayStats(), ...extra }, null, 1));
    return dir;
  }
}
