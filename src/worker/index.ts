/**
 * `npm run worker`: the always-on background process (R-UI-7, R-BE-4). See docs/ui/WORKER.md.
 *
 * Startup: single-instance lock (pid file + Postgres advisory lock), heartbeat file, user, stores, live
 * events, scanner, job runtime; then the resume plan (reaper → ScannerRuntime head-first catch-up → claims).
 * Shutdown (SIGTERM/SIGINT): stop claiming, abort runs, release leases, final "stopped" heartbeat.
 * Wake from sleep (clock jump): extend own leases, reap, re-plan immediately, plus a reconcile pass.
 */
import { hostname } from 'node:os';

import { Client } from 'pg';
import { sql } from 'drizzle-orm';

import { ClaudeSessionWatcher } from '@/connectors/claude/watcher';
import { GoogleWorkspaceClient } from '@/connectors/google/client';
import { closeIdleBursts } from '@/db/changeset';
import { createDb, databaseName, type Db } from '@/db/client';
import { createDefaultRegistry } from '@/jobs';
import { allHandlers, realDeps as realReauthDeps, reauthStarter } from '@/reauth';
import { reevaluateHandler } from '@/jobs/handlers/reevaluate';
import { readInPlanHook } from '@/llm/readin/planner';
import { HeartbeatWriter, type Heartbeat } from '@/ops/heartbeat';
import { Lifecycle, SingleInstanceLock, WakeDetector } from '@/ops/lifecycle';
import { Notifier } from '@/ops/notify';
import { liveOutboxTransport, OutboxGateway, outboxJobDef, parseJobPayload, runOutboxJob } from '@/outbox';
import { feedbackChannelFor } from '@/server/feedback/channel';
import { projectionsHook } from '@/projections';
import { firstScanFor } from './first-scan-config';
import { firstScanRerankHook } from './first-scan-rerank';
import { settleHook } from './settle-hook';
import { activityNotesHook } from '@/jobs/handlers/activity-notes';
import { activitySuggestHook, configureActivitySuggest } from '@/jobs/handlers/activity-suggest';
import { vdpAssetsHook } from '@/server/datasource/db/store/vdp-assets';
import { vdpAutopilotJobDef } from '@/jobs/handlers/vdp-autopilot';
import { vdpAesHook, vdpAutopilotHook, vdpHierarchyHook, vdpIdentityHook, vdpWithdrawHook } from './vdp-autopilot-hook';
import { vdpPushJobDef } from '@/jobs/handlers/vdp-push';
import { configureVdpIdentityJob } from '@/jobs/handlers/vdp-identity';
import { activitySyncJobDef } from '@/jobs/handlers/activity-sync';
import { settleJobDef } from '@/jobs/handlers/settle';
import { enqueueHygieneSweep } from '@/jobs/handlers/hygiene';
import { systemClock } from '@/scanner/runtime/clock';
import { DbScannerStore } from '@/scanner/store-db';
import { flushTrace, installDbTraceSink, logFields } from '@/scanner/trace';
import { catchUpSignature, writeCatchUpFile } from '@/server/datasource/db/catch-up';
import { dbOutboxPort } from '@/server/datasource/db/outbox';
import { ensureExtractor } from '@/server/datasource/db/seed';
import { withdrawClosedItemDrafts } from '@/server/datasource/db/store/withdraw';
import { closeLiveEventBus, getLiveEventBus } from '@/server/events';

import { loadWorkerConfig, type WorkerConfig } from './config';
import { connectorHealthNotifier, notifyDeadTop3, NullNotifier, type NotifierLike } from './notify';
import { WorkerRuntime } from './runtime';
import { buildLiveFetchers, buildScanning, loadWorkHours } from './scanning';
import { DEFAULT_FIRST_SCAN_DAYS } from '../scanner/runtime/first-scan';
import { ensureSchedules, tickSchedules } from './schedules';
import { guardOwner, SchemaGuard } from './schema-guard';

/**
 * One line per event: `[worker] <msg> {json}`. Inside a job the JSON carries its correlation fields (runId, jobId,
 * connector, scope; AUDIT), so every line about a run can be grepped by run or job. Ids and codes only.
 */
const log = (msg: string, detail?: Record<string, unknown>) => {
  const d = { ...logFields(), ...detail };
  console.log(`[worker] ${msg}${Object.keys(d).length ? ` ${JSON.stringify(d)}` : ''}`);
};

/** The user this worker scans for: CC_USER_EMAIL (created if missing), else the first active user. */
export async function resolveUser(db: Db, cfg: Pick<WorkerConfig, 'userEmail' | 'userName'>): Promise<{ id: string; email: string; name: string } | null> {
  if (cfg.userEmail) {
    await db.execute(sql`
      insert into users (email, display_name, timezone)
      values (${cfg.userEmail.toLowerCase()}, ${cfg.userName ?? null}, ${Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Denver'})
      on conflict (email) do nothing`);
  }
  const r = await db.execute<{ id: string; email: string; name: string | null }>(sql`
    select id, email, display_name as name from users
     where is_active ${cfg.userEmail ? sql`and lower(email) = ${cfg.userEmail.toLowerCase()}` : sql``}
     order by created_at limit 1`);
  const u = r.rows[0];
  return u ? { id: u.id, email: u.email, name: u.name ?? cfg.userName ?? u.email } : null;
}

async function main(): Promise<void> {
  const cfg = loadWorkerConfig();
  const life = new Lifecycle({ log: (m) => log(m) });
  life.installSignalHandlers();

  const handle = createDb({ url: cfg.databaseUrl, applicationName: 'control-center-worker' });
  const db = handle.db;
  const lockClient = new Client({ connectionString: cfg.databaseUrl, application_name: 'control-center-worker-lock' });
  await lockClient.connect();
  const lock = new SingleInstanceLock({ client: lockClient });
  const got = await lock.acquire();
  if (!got.acquired) {
    log('another worker is running; exiting', { reason: got.reason, holderPid: got.holderPid });
    await lockClient.end().catch(() => undefined);
    await handle.close();
    process.exit(0);
  }

  const hb = new HeartbeatWriter({
    appVersion: cfg.appVersion,
    onBeat: (b: Heartbeat) => db.execute(sql`update worker_instances set last_beat_at = now() where id = ${b.instance_id}`).then(() => undefined),
  });
  hb.setState('starting');

  // Lane E (E1): nothing below runs on a schema this build wasn't made for. Wait (heartbeat `blocked`, one Health
  // event) instead of exiting, so launchd's KeepAlive never turns a pending migration into a crash loop.
  const schema = new SchemaGuard({ db, log, ownerUserId: () => guardOwner(db, cfg.userEmail) });
  let started = false;
  life.onShutdown('release (still waiting for the schema)', async () => {
    if (started) return; // the full shutdown below releases everything
    hb.stop();
    await lock.release();
    await lockClient.end().catch(() => undefined);
    await handle.close();
  });
  const blocked = () => {
    hb.state = 'blocked';
    hb.lastErrorCode = 'schema_mismatch';
    hb.beat();
  };
  if (!(await schema.waitForMatch({ stopping: () => life.stopping, onBlocked: blocked }))) return;
  started = true;
  hb.lastErrorCode = null;
  const prev = await db.execute<{ last: string | null }>(sql`select max(last_beat_at) as last from worker_instances where role = 'worker'`);
  await db.execute(sql`
    insert into worker_instances (id, role, hostname, pid, app_version) values (${hb.instanceId}, 'worker', ${hostname()}, ${process.pid}, ${cfg.appVersion})
    on conflict (id) do nothing`);
  log('started', { db: databaseName(cfg.databaseUrl), live: cfg.live, llm: cfg.llm, lastBeat: prev.rows[0]?.last ?? null });

  let user = await resolveUser(db, cfg);
  while (!user && !life.stopping) {
    log('no user yet (run npm run setup or set CC_USER_EMAIL); waiting');
    await new Promise((r) => setTimeout(r, 60_000));
    user = await resolveUser(db, cfg);
  }
  if (!user) return;

  // AUDIT: the scan run trace (scan_run_events), written in the background; a trace failure never fails a run.
  installDbTraceSink(db, { log });
  const notifier: NotifierLike = cfg.notify ? new Notifier() : new NullNotifier();
  const store = new DbScannerStore({ db, userId: user.id, onHealthChange: connectorHealthNotifier(notifier) });
  getLiveEventBus({ db, url: cfg.databaseUrl }); // LISTEN + publish every change-set commit from this process
  const google = cfg.live ? new GoogleWorkspaceClient() : undefined;
  const fetchers = google ? buildLiveFetchers({ google, me: { email: user.email, name: user.name, aliases: cfg.meAliases }, store, only: cfg.sources, vdp: { db, userId: user.id } }) : [];
  const workHours = await loadWorkHours(db, user.id);
  const scanning = buildScanning({ db, userId: user.id, store, clock: systemClock, fetchers, llm: cfg.llm, workHours, notifier, log, firstScanDefaultDays: DEFAULT_FIRST_SCAN_DAYS, firstScan: await firstScanFor(db, user.id, { log, stopping: () => life.stopping }) });
  // Health ▸ re-auth: the job starts the sign-in itself (VDP: the refresh script; MFA opens Terminal), then re-probes
  const reauth = reauthStarter((vdp) => allHandlers(realReauthDeps(), { vdp }));
  const registry = createDefaultRegistry({ scan: scanning.handlerDeps, reauth });
  registry.wire('reevaluate', reevaluateHandler(), 'work item re-evaluation: closure machine + re-eval planner (BE-3)');
  // Outbox delivery after the user's confirm. The live transport is fail-closed for Slack and Gmail in this build
  // (BE-OUTBOX); VDP items go to vdp-app-fir after the user's Apply with dry-run off (approved 2026-11-10).
  // D-56: the one live Slack post is the feedback report, to the configured channel only (re-read at the post).
  const feedbackUser = user.id;
  const outboxGateway = new OutboxGateway(liveOutboxTransport({ feedback: { channel: () => feedbackChannelFor(db, feedbackUser) } }));
  registry.register(outboxJobDef({ port: (ctx) => dbOutboxPort(ctx.db, ctx.userId, { extractorId: () => ensureExtractor(ctx.db), now: ctx.clock }), gateway: outboxGateway }));
  // D-60: VDP autopilot, only while Settings ▸ Sending ▸ VDP autopilot is on; through the same Outbox gateway
  // told once per pause (the change of reason); Health and the VDP view keep showing it
  registry.register(
    vdpAutopilotJobDef({
      handle,
      gateway: outboxGateway,
      notify: async (why) =>
        void (await notifier
          .notify({ kind: 'connector_broken', entityId: 'vdp.autopilot', transition: `paused:${why}`, title: why === 'reauth' ? 'VDP autopilot is paused: re-auth VDP' : 'VDP autopilot is paused', body: why === 'reauth' ? 'Health ▸ VDP ▸ Run refresh signs you in again; what it would apply waits.' : why === 'dry_run' ? 'Dry run is on (Settings ▸ Sending).' : "Today's cap is reached; the rest waits for tomorrow.", url: '/activity?view=vdp' })
          .catch(() => undefined)),
    }),
  );
  // D-63: "Push N to VDP" in order (each item approved by the push, new ids passed down), through the same gateway
  registry.register(vdpPushJobDef({ handle, gateway: outboxGateway }));
  // SETTLE-1: the Settle pass (queue `settle`, concurrency 1), queued by settleHook below.
  registry.register(settleJobDef({ handle }));
  // D-69: the identity judgment reads its pending units through the VDP view's own computation (same keys and hashes)
  configureVdpIdentityJob({ handle });
  configureActivitySuggest({ handle }); // the rows' opportunity suggestions read the same read model as GET /time
  // Logging (D-48): in automatic mode the weekday 17:30 run stages the batch for Apply; on demand it does nothing.
  registry.register(activitySyncJobDef({ handle }));
  await ensureSchedules(db, user.id, registry, workHours.timeZone, new Date());
  // HYG-1: one dead-data sweep a minute after every start (the first worker after a deploy cleans what is there)
  await enqueueHygieneSweep(db, user.id, 'start').catch((err: unknown) => log('queueing the hygiene sweep failed', { code: (err as { code?: string }).code ?? (err as Error).name }));
  const dropped = await scanning.dropStalePlans();
  if (dropped) log('dropped stale scan plans from a previous run', { dropped });
  // OUTBOX-W: pending drafts of to-dos that closed before closing withdrew them (or that raced a close) leave the Outbox
  const withdrawn = await withdrawClosedItemDrafts(db, user.id, { ref: 'worker.start' }).catch((err: unknown) => {
    log('withdrawing drafts of closed to-dos failed', { code: (err as { code?: string }).code ?? (err as Error).name });
    return [];
  });
  if (withdrawn.length) log('withdrew drafts of closed to-dos', { drafts: withdrawn.length });

  const userId = user.id;
  let lastCatchUp = '';
  /** B3: resolve stopped Outbox deliveries (recoverOnly: never a write): "check before you try again", or "nothing was sent". */
  const recoverOutbox = async (jobs: ReadonlyArray<{ ownerUserId: string; payload: Record<string, unknown> }>) => {
    for (const j of jobs) {
      const p = parseJobPayload(j.payload);
      if (!p) continue;
      const out = await runOutboxJob(p, dbOutboxPort(db, j.ownerUserId, { extractorId: () => ensureExtractor(db), now: () => new Date() }), null, { now: () => new Date(), recoverOnly: true }).catch((err: unknown) => ({ error: (err as Error).name }));
      log('resolved a stopped Outbox delivery', { draftId: p.draftId, ...out });
    }
  };
  const runtime: WorkerRuntime = new WorkerRuntime({
    db,
    userId,
    workerId: hb.instanceId,
    registry,
    services: { store, scanning },
    listenUrl: cfg.databaseUrl,
    log,
    hooks: [
      // Lane E (E1): someone migrated while this worker ran (or rolled the build back): hold claims until they match.
      {
        name: 'schema',
        everyMs: 60_000,
        whileHeld: true,
        run: async () => {
          const s = await schema.check();
          if (!s) return;
          if (s.state === 'match') runtime.release();
          else runtime.hold('schema_mismatch');
        },
      },
      scanning.planHook,
      { name: 'schedules', everyMs: 30_000, run: async (now) => void (await tickSchedules(db, userId, now)) },
      projectionsHook(db, userId, log), // source items → calendar events, deals, sessions, assets, time (src/projections)
      { name: 'bursts', everyMs: 30_000, run: async () => void (await closeIdleBursts(db)) },
      readInPlanHook(db, userId, log), // BE-READIN: automatic read-in triggers (direct asks, top N, meeting prep)
      firstScanRerankHook(handle, userId, log), // HOME-1b: one initial ranking when the first scan completes
      settleHook(db, userId, log), // SETTLE-1: judge items with their whole conversation; close for you, ask or leave
      vdpAssetsHook(db, userId, log), // new Drive files, Slack / Gmail links, meeting attachments → VDP asset candidates (no model call)
      vdpAutopilotHook(db, userId, log), // D-60: after each VDP read and every 30 min, while VDP autopilot is on
      vdpWithdrawHook(handle, userId, log), // D-60: after each VDP read, staged VDP changes VDP already has are withdrawn
      vdpAesHook(db, userId, log), // D-63: after an Org62 read, who the VDP AEs are (the Specialist Forecasts of my 100%-DC opps)
      vdpHierarchyHook(db, userId, log), // D-69: after an Org62 read, the account hierarchy (parents up to five levels)
      vdpIdentityHook(db, userId, log, { handle }), // D-69: after a VDP or hierarchy read, the judgment for ambiguous company identities (the view's own units)
      activityNotesHook(db, userId, log), // D-66: after new meeting notes, the cheap model's Org62 Description note for their rows
      activitySuggestHook(db, userId, log), // Time: after the rows change, the cheap model's suggestion (internal, or which opp) for rows the rules can't place
      {
        name: 'heartbeat',
        everyMs: 15_000,
        whileHeld: true,
        run: async () => {
          const s = runtime.status();
          hb.activeJobs = s.activeJobs;
          hb.state = s.state === 'draining' ? 'draining' : runtime.held ? 'blocked' : scanning.scanner.isCatchingUp() ? 'catching_up' : s.state === 'running' ? 'running' : 'idle';
          hb.lastErrorCode = runtime.held ? 'schema_mismatch' : null;
          hb.beat();
          const progress = await scanning.scanner.catchUpProgress();
          writeCatchUpFile(progress); // B-079: Health's catching_up + catchUpPct (db/catch-up.ts)
          // Live pass: the file is read on each Health read, so say when it moved (per 5 %, and when it ends): the
          // sidebar's "Catching up · Gmail 40 %" follows without polling.
          const sig = catchUpSignature(progress);
          if (sig !== lastCatchUp) {
            lastCatchUp = sig;
            getLiveEventBus().publish({ topic: 'health', ids: [], reason: 'catchup.progress' });
          }
        },
      },
    ],
    onDead: async (job) => {
      await notifyDeadTop3(db, typeof job.payload.work_item_id === 'string' ? job.payload.work_item_id : undefined, job.kind, notifier);
      // B3: an Outbox delivery that died (its one attempt) is resolved without writing, never left "sending"
      if (job.kind.startsWith('outbox.')) await recoverOutbox([{ ownerUserId: job.ownerUserId, payload: job.payload }]);
    },
    // B3: the reaper never requeues an Outbox delivery; its item is resolved here without writing again
    onReapedOutbox: (jobs) => recoverOutbox(jobs),
  });
  await runtime.start();
  hb.setState(scanning.scanner.isCatchingUp() ? 'catching_up' : 'idle');

  const wake = new WakeDetector(
    (e) =>
      void (async () => {
        await runtime.onWake(e.gapMs);
        if (e.gapMs > 30 * 60_000) await scanning.enqueueResumeReconcile(`wake:${new Date().toISOString().slice(0, 13)}`);
      })().catch((err) => log('wake handling failed', { code: (err as Error).name })),
    { intervalMs: 5000, thresholdMs: 60_000 },
  );
  wake.start();

  const watcher = cfg.live && fetchers.some((f) => f.connector === 'claude_sessions')
    ? new ClaudeSessionWatcher({ onChange: () => void scanning.enqueueFileWatch().then((queued) => (queued ? runtime.pollOnce() : 0)).catch(() => undefined) })
    : undefined;
  watcher?.start();

  life.onShutdown('stop timers', () => {
    wake.stop();
    watcher?.stop();
    hb.setState('draining');
  });
  life.onShutdown('drain jobs', async (reason) => {
    const r = await runtime.stop(reason);
    log('drained', r);
  });
  life.onShutdown('release', async (reason) => {
    hb.stop();
    await flushTrace();
    await db.execute(sql`update worker_instances set stopped_at = now(), stop_reason = ${reason.slice(0, 60)} where id = ${hb.instanceId}`).catch(() => undefined);
    await closeLiveEventBus();
    await (google as GoogleWorkspaceClient | undefined)?.close().catch(() => undefined);
    await lock.release();
    await lockClient.end().catch(() => undefined);
    await handle.close();
  });
  if (cfg.runForMs) {
    setTimeout(() => void life.shutdown('run_for elapsed').then((code) => process.exit(code)), cfg.runForMs).unref();
  }
}

const invokedDirectly = /(^|[\\/])worker[\\/]index\.(ts|js|mjs|cjs)$/.test(process.argv[1] ?? '');
if (invokedDirectly) {
  main().catch((err: unknown) => {
    log('fatal', { code: (err as { code?: string }).code ?? (err as Error).name });
    process.exitCode = 1;
  });
}
