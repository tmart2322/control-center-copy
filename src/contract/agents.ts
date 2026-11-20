/**
 * Agent runs (Claude Code sessions, app runs, tool runs) and the ToolAdapter plugin seam (R-UI-13).
 *
 * CONTRACT-1: the TOOLS lane's `src/tools/manifest.ts` is the source of truth for tool manifests. The
 * contract's `ToolAdapter` is a VIEW derived from it (`src/contract/tools-view.ts`: `toToolView` /
 * `toToolAdapter`). The older manifest shape (`ToolAdapterManifest` below) stays on every row as a
 * deprecated compatibility field; `ToolAdapterSeedRow` (tools-view.ts) maps seed rows onto the same view.
 */
import { z } from 'zod';
import { inputFieldSchema, launchKinds } from '../tools/manifest';
import { Id, IsoDateTime, Progress, RunState, Url } from './common';

// ---------------------------------------------------------------------------
// Agent runs
// ---------------------------------------------------------------------------

export const AgentRunKind = z.enum(['claude_session', 'app_run', 'tool_run']);
export type AgentRunKind = z.infer<typeof AgentRunKind>;

export const AgentRun = z.object({
  id: Id,
  kind: AgentRunKind,
  title: z.string(),
  workItemId: Id.nullable(),
  state: RunState,
  startedAt: IsoDateTime.nullable(),
  updatedAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable().default(null),
  /** One line: the latest step or event. */
  lastEvent: z.string(),
  /** Present when state is waiting_on_you. Claude sessions: answer in Claude; app runs: inline chips. */
  waiting: z
    .object({
      reason: z.string(), // "input needed", "dialog open", "Which org alias?"
      question: z.string().nullable().default(null),
      choices: z.array(z.string()).default([]),
      since: IsoDateTime,
    })
    .nullable()
    .default(null),
  /**
   * Deep link. Claude sessions: claude://code/continue?session=<id>. New: claude://code/new?folder=…&q=…
   * All waiting: claude://code/needs-input. App/tool runs: in-app href.
   */
  deepLink: Url.nullable().default(null),
  sessionId: z.string().nullable().default(null),
  cwd: z.string().nullable().default(null),
  /** Background subagents still writing (a session can be waiting AND have bg agents, brief 10 §1.5). */
  bgAgents: z.number().int().min(0).default(0),
  toolRunId: Id.nullable().default(null),
  progress: Progress.nullable().default(null),
  resultUrl: Url.nullable().default(null),
  error: z.string().nullable().default(null),
  costUsd: z.number().nullable().default(null),
  /** Scheduled (autopilot) sessions are grouped separately and never flagged unless really waiting. */
  scheduled: z.boolean().default(false),
});
export type AgentRun = z.infer<typeof AgentRun>;

export const AgentsPayload = z.object({
  runs: z.array(AgentRun),
  counts: z.record(RunState, z.number().int()),
  /** claude://code/needs-input ("All waiting"). */
  needsInputLink: Url,
});
export type AgentsPayload = z.infer<typeof AgentsPayload>;

export const LaunchResult = z.object({
  url: Url,
  run: AgentRun,
});
export type LaunchResult = z.infer<typeof LaunchResult>;

// ---------------------------------------------------------------------------
// Legacy seed manifest (brief 10 §3.7). DEPRECATED: seeds only. The real manifests are the TOOLS lane's
// tools-registry/*.json, validated by src/tools/manifest.ts.
// ---------------------------------------------------------------------------

export const ToolKind = z.enum(['http', 'cli', 'claude-session', 'skill']);
export type ToolKind = z.infer<typeof ToolKind>;

export const HttpStep = z.object({
  id: z.string(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH']),
  path: z.string(),
  body: z.record(z.string(), z.unknown()).optional(),
  multipart: z.string().optional(),
  save: z.record(z.string(), z.string()).optional(),
});

export const ToolAdapterManifest = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  description: z.string(),
  /** Optional in the legacy shape; the view defaults it to "wrench". */
  icon: z.string().optional(),
  version: z.number().int(),
  kind: ToolKind,
  capabilities: z.array(z.string()),
  match: z.object({ taskTypes: z.array(z.string()).default([]), keywords: z.array(z.string()).default([]) }),
  input: z.object({
    /** JSON Schema (draft 2020-12). Run forms render from it. */
    schema: z.record(z.string(), z.unknown()),
    /** Mustache templates against {task, event, context, account}. */
    prefill: z.record(z.string(), z.unknown()).default({}),
  }),
  launch: z.object({
    http: z.object({ baseUrl: z.string(), steps: z.array(HttpStep) }).optional(),
    cli: z.object({ cwd: z.string(), argv: z.array(z.string()), timeoutSec: z.number().int().optional() }).optional(),
    claudeSession: z
      .object({ cwd: z.string(), prompt: z.string(), model: z.string().optional(), permissionMode: z.string().optional(), mode: z.enum(['interactive', 'headless']).optional() })
      .optional(),
    skill: z.object({ name: z.string(), args: z.string().optional() }).optional(),
  }),
  lifecycle: z
    .object({
      start: z.object({ cwd: z.string(), argv: z.array(z.string()), env: z.record(z.string(), z.string()).optional(), readyUrl: z.string().optional(), readyTimeoutSec: z.number().optional() }).optional(),
      stopAfterIdleMin: z.number().nullable().optional(),
    })
    .optional(),
  progress: z.object({
    type: z.enum(['ndjson', 'sse', 'poll', 'exit-code', 'session', 'none']),
    http: z.object({ path: z.string(), map: z.record(z.string(), z.unknown()).optional() }).optional(),
    session: z.object({ follow: z.string() }).optional(),
  }),
  output: z.object({
    kind: z.enum(['link', 'artifact', 'both']),
    link: z.object({ url: z.string(), label: z.string() }).optional(),
    artifacts: z.array(z.object({ path: z.string(), mime: z.string(), label: z.string(), revealable: z.boolean().optional() })).optional(),
  }),
  health: z.object({
    type: z.enum(['http', 'cli', 'file', 'none']),
    http: z.object({ url: z.string(), expectStatus: z.number().int().optional(), timeoutMs: z.number().int().optional() }).optional(),
    intervalSec: z.number().int().optional(),
    onFail: z.enum(['offer-start', 'warn', 'none']).optional(),
  }),
  safety: z.object({
    network: z.enum(['localhost-only', 'internal', 'none']),
    writes: z.array(z.string()).default([]),
    requiresApproval: z.boolean(),
    dataClass: z.enum(['customer', 'internal', 'public']),
  }),
  /** Escape hatch for tools that need custom logic. */
  handler: z.string().optional(),
  /** Optional in the legacy shape; the view uses null when absent. */
  estimatedDuration: z.object({ minSec: z.number().nonnegative(), maxSec: z.number().positive() }).optional(),
});
export type ToolAdapterManifest = z.infer<typeof ToolAdapterManifest>;

export const ToolRunStatus = z.enum(['queued', 'starting', 'running', 'waiting_user', 'succeeded', 'failed', 'cancelled']);
export type ToolRunStatus = z.infer<typeof ToolRunStatus>;

export const ToolRun = z.object({
  id: Id,
  adapterId: z.string(),
  workItemId: Id.nullable(),
  nbaId: Id.nullable().default(null),
  inputs: z.record(z.string(), z.unknown()),
  status: ToolRunStatus,
  progress: Progress.nullable().default(null),
  linkUrl: Url.nullable().default(null),
  linkLabel: z.string().nullable().default(null),
  artifacts: z.array(z.object({ path: z.string(), mime: z.string(), label: z.string() })).default([]),
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable().default(null),
  error: z.string().nullable().default(null),
  /** The AgentRun row mirroring this tool run on the Agents page. */
  agentRunId: Id.nullable().default(null),
});
export type ToolRun = z.infer<typeof ToolRun>;

export const ToolHealth = z.object({
  state: z.enum(['ok', 'down', 'unknown']),
  checkedAt: IsoDateTime.nullable(),
  message: z.string().nullable().default(null),
});
export type ToolHealth = z.infer<typeof ToolHealth>;

// ---------------------------------------------------------------------------
// ToolAdapter view (derived from src/tools/manifest.ts)
// ---------------------------------------------------------------------------

/** How a tool starts: same values as `launch.kind` in src/tools/manifest.ts. */
export const ToolLaunchKind = z.enum(launchKinds);
export type ToolLaunchKind = z.infer<typeof ToolLaunchKind>;

/**
 * One run-form field: exactly the TOOLS manifest's `input.fields[]` entry (string · text · enum · number ·
 * boolean · file · entity_ref), so the form renders from data and never needs tool-specific UI code.
 */
export const ToolFormField = inputFieldSchema;
export type ToolFormField = z.infer<typeof ToolFormField>;

export const ToolDuration = z.object({ minSec: z.number().nonnegative(), maxSec: z.number().positive() });
export type ToolDuration = z.infer<typeof ToolDuration>;

/** What the UI needs to list, describe and run one tool. Build it with `toToolView()` (tools-view.ts). */
export const ToolView = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** Icon token (lucide name or emoji-free key). */
  icon: z.string(),
  launchKind: ToolLaunchKind,
  /** The run form. `required` fields must be filled before Run. */
  fields: z.array(ToolFormField),
  health: ToolHealth,
  /** Null when the manifest does not say. */
  estimatedDuration: ToolDuration.nullable(),
  /** manifest.privacy.requiresConfirm: Run needs an explicit confirm step (forced on for external writes). */
  requiresConfirm: z.boolean(),
});
export type ToolView = z.infer<typeof ToolView>;

/** A registry row on Agents ▸ Tools: the view plus registry state. */
export const ToolAdapter = ToolView.extend({
  enabled: z.boolean().default(true),
  recentRunIds: z.array(Id).default([]),
  /**
   * DEPRECATED compatibility shape (the pre-CONTRACT-1 manifest). Seeded rows carry their own; rows built
   * from a TOOLS manifest get one synthesized by `toToolAdapter()`. Build new UI on the view fields.
   */
  manifest: ToolAdapterManifest,
});
export type ToolAdapter = z.infer<typeof ToolAdapter>;

export const ToolsPayload = z.object({
  adapters: z.array(ToolAdapter),
  recentRuns: z.array(ToolRun),
});
export type ToolsPayload = z.infer<typeof ToolsPayload>;
