/**
 * Health: connectors (state, cursor, re-auth), scan ledger, jobs, event log, spend (R-UI-12, R-BE-3).
 */
import { z } from 'zod';
import { ConnectorState, Id, IsoDate, IsoDateTime, ReauthKind, SourceKind } from './common';

export const ReauthAffordance = z.object({
  kind: ReauthKind,
  label: z.string(), // "Re-auth Slack", "Reconnect Google", "Connect Zscaler"
  /** For terminal_command / refresh_script: the exact command (never contains secrets). */
  command: z.string().nullable().default(null),
  instructions: z.string().nullable().default(null),
});
export type ReauthAffordance = z.infer<typeof ReauthAffordance>;

export const Connector = z.object({
  id: Id, // "slack", "gmail", "calendar", "drive", "gemini", "org62", "vdp", "claude"
  label: z.string(),
  source: SourceKind,
  state: ConnectorState,
  since: IsoDateTime,
  lastSuccessAt: IsoDateTime.nullable(),
  /** "Slack through 10:41" */
  cursor: z.object({ label: z.string(), at: IsoDateTime.nullable() }),
  backlog: z.number().int().default(0),
  itemsToday: z.number().int().default(0),
  /** 0–100 while catching_up (header "Catching up: Slack 60%"). */
  catchUpPct: z.number().min(0).max(100).nullable().default(null),
  lastError: z
    .object({ class: z.enum(['auth', 'transient', 'rate_limited', 'bug', 'offline']), message: z.string(), at: IsoDateTime, count: z.number().int() })
    .nullable()
    .default(null),
  /** What today's data is affected, for banners ("Email items after 09:40 may be missing"). */
  impact: z.string().nullable().default(null),
  reauth: ReauthAffordance.nullable().default(null),
  /** Panels/topics whose items get StaleMarks when this connector breaks. */
  affects: z.array(z.string()).default([]),
});
export type Connector = z.infer<typeof Connector>;

export const ScanRunStatus = z.enum(['queued', 'running', 'ok', 'partial', 'auth_failed', 'transient_failed', 'budget_exceeded', 'aborted']);
export type ScanRunStatus = z.infer<typeof ScanRunStatus>;

export const ScanRun = z.object({
  id: Id,
  connectorId: Id,
  scope: z.string(), // "dms_to_me", "#acme-ext", "inbox"
  kind: z.enum(['poll', 'head', 'backfill', 'reconcile', 'manual']),
  windowStart: IsoDateTime,
  windowEnd: IsoDateTime,
  status: ScanRunStatus,
  startedAt: IsoDateTime,
  endedAt: IsoDateTime.nullable(),
  itemsSeen: z.number().int(),
  itemsNew: z.number().int(),
  itemsChanged: z.number().int(),
  costUsd: z.number(),
  model: z.string().nullable(),
  error: z.string().nullable().default(null),
});
export type ScanRun = z.infer<typeof ScanRun>;

export const JobStatus = z.enum(['queued', 'running', 'retrying', 'succeeded', 'dead', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatus>;

export const Job = z.object({
  id: Id,
  type: z.string(), // "reevaluate", "scan.slack", "nba.generate", "brief.generate"
  status: JobStatus,
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  runAt: IsoDateTime,
  startedAt: IsoDateTime.nullable().default(null),
  finishedAt: IsoDateTime.nullable().default(null),
  dedupeKey: z.string().nullable().default(null),
  generation: z.number().int().nullable().default(null),
  entity: z.object({ type: z.string(), id: Id, label: z.string() }).nullable().default(null),
  error: z.string().nullable().default(null),
});
export type Job = z.infer<typeof Job>;

export const EventLogEntry = z.object({
  id: Id,
  at: IsoDateTime,
  level: z.enum(['info', 'warn', 'error']),
  source: z.string(), // connector id, "worker", "nba", …
  code: z.string(), // "auth_needed", "job_dead_lettered", "parse_drift"
  message: z.string(),
  count: z.number().int().default(1),
  lastSeenAt: IsoDateTime,
  suggestedAction: z.string().nullable().default(null),
  acknowledged: z.boolean().default(false),
  acknowledgedAt: IsoDateTime.nullable().default(null),
});
export type EventLogEntry = z.infer<typeof EventLogEntry>;

export const SpendSummary = z.object({
  today: z.object({
    usd: z.number(),
    softBudgetUsd: z.number(),
    hardCapUsd: z.number(),
    pct: z.number(), // of soft budget
  }),
  /** ok < 80% · soft_alert ≥ 80% (header chip) · capped ≥ hard cap (banner; scanners deterministic-only). */
  state: z.enum(['ok', 'soft_alert', 'capped']),
  last7d: z.array(z.object({ day: IsoDate, usd: z.number() })),
  byScanner: z.array(z.object({ name: z.string(), usd: z.number() })),
  byModel: z.array(z.object({ model: z.string(), usd: z.number() })),
});
export type SpendSummary = z.infer<typeof SpendSummary>;

export const HealthSummary = z.object({
  ok: z.number().int(),
  total: z.number().int(),
  /** Worst state across connectors drives the health-dot colour. */
  worst: ConnectorState,
  broken: z.array(z.object({ id: Id, label: z.string(), state: ConnectorState })),
});
export type HealthSummary = z.infer<typeof HealthSummary>;

/** One scope of the first scan (B-080): its own floor, whether its backfill is done, and how much of it is covered. */
export const FirstScanScope = z.object({
  scope: z.string(), // "slack:inbox", "gmail:inbox", "org62:opps"
  connector: z.string(),
  status: z.enum(['pending', 'done']),
  floorAt: IsoDateTime,
  /** Committed coverage of [floor, first-scan start), 0–100; null before the scope's first run. */
  coveredPct: z.number().min(0).max(100).nullable(),
  replans: z.number().int().default(0),
  /** FS-LATE: when a channel joined the first scan after it had finished (its coverage counts from here); null otherwise. */
  joinedAt: IsoDateTime.nullable().default(null),
  /** One-time (first-scan budget) spend of this scope's runs. */
  spentUsd: z.number().default(0),
});
export type FirstScanScope = z.infer<typeof FirstScanScope>;

/** The first scan's progress (worker state file `first-scan.json`, read server-side). */
export const FirstScanProgress = z.object({
  status: z.enum(['active', 'done', 'exhausted']),
  lookbackDays: z.number(),
  startedAt: IsoDateTime,
  floorAt: IsoDateTime,
  budgetUsd: z.number(),
  spentUsd: z.number(),
  doneAt: IsoDateTime.nullable().default(null),
  scopes: z.array(FirstScanScope),
});
export type FirstScanProgress = z.infer<typeof FirstScanProgress>;

export const HealthPayload = z.object({
  connectors: z.array(Connector),
  summary: HealthSummary,
  spend: SpendSummary,
  worker: z.object({
    alive: z.boolean(),
    lastHeartbeatAt: IsoDateTime.nullable(),
    queueDepth: z.number().int(),
    /**
     * Lane E (E1): the worker runs but claims nothing, because the database schema differs from its build (a pending
     * migration, a newer version's, one drizzle skipped). Null or absent when it isn't waiting.
     */
    blocked: z.object({ message: z.string(), fix: z.string().nullable(), since: IsoDateTime }).nullable().optional(),
  }),
  dryRun: z.boolean(),
  /** First-scan progress per scope while one ran on this install; null otherwise. */
  firstScan: FirstScanProgress.nullable().default(null),
  /**
   * D-60: VDP autopilot while it is on (null when off): paused why ("VDP autopilot is paused: re-auth VDP") and its
   * one line ("Autopilot: on · 12 applied today").
   */
  vdpAutopilot: z.object({ paused: z.enum(['reauth', 'dry_run', 'cap']).nullable(), line: z.string() }).nullable().optional(),
});
export type HealthPayload = z.infer<typeof HealthPayload>;

export const ReauthResult = z.object({
  connector: Connector,
  /** in_app: simulated/handled in-app · terminal_command: the command to open in Terminal · instructions: text only. */
  action: ReauthAffordance,
  started: z.boolean(),
});
export type ReauthResult = z.infer<typeof ReauthResult>;

export const ScansPayload = z.object({ runs: z.array(ScanRun) });
export const JobsPayload = z.object({ jobs: z.array(Job), counts: z.record(JobStatus, z.number().int()) });
export const EventLogPayload = z.object({ entries: z.array(EventLogEntry), unacknowledged: z.number().int() });
export type ScansPayload = z.infer<typeof ScansPayload>;
export type JobsPayload = z.infer<typeof JobsPayload>;
export type EventLogPayload = z.infer<typeof EventLogPayload>;
