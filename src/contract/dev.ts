/**
 * Mock-mode dev surface: the scenario clock (UI-SPEC §15) and the failure switch.
 * These routes exist only while CC_DATA=mock; the db DataSource returns not_found for them.
 */
import { z } from 'zod';
import { ConnectorState, Id, RunState, SourceRef, WorkState } from './common';
import { Resolution } from './work';

/** The store collections the live-pass scenario steps copy or change. */
export const ScenarioCollection = z.enum(['drafts', 'workItems', 'activity', 'agentRuns']);
export type ScenarioCollection = z.infer<typeof ScenarioCollection>;

/**
 * Data-driven scenario steps. Each op mutates the store the way an engine/connector would and emits
 * LiveEvents. Engine writes respect user locks (they become Proposals).
 */
export const ScenarioAction = z.discriminatedUnion('op', [
  /** New info revises an NBA's draft: in place if untouched, else a Proposal ("Update draft? Apply / Keep mine"). */
  z.object({ op: z.literal('nba_update'), nbaId: Id, reason: z.string(), appendText: z.string(), source: SourceRef.optional() }),
  /** An agent run changes state (e.g. a Claude session goes waiting). Linked item follows (waiting_on_me ⇄ in_progress). */
  z.object({
    op: z.literal('run_state'),
    runId: Id,
    state: RunState,
    lastEvent: z.string(),
    waiting: z.object({ reason: z.string(), question: z.string().nullable().optional(), choices: z.array(z.string()).optional() }).optional(),
  }),
  /** An engine closes an item from completion evidence (Closed for you, undoable). Resolution defaults to done_by_me (inferred). */
  z.object({
    op: z.literal('close_item'),
    itemId: Id,
    reason: z.string(),
    evidence: SourceRef,
    resolution: Resolution.optional(),
    personName: z.string().optional(),
  }),
  /** R-UI-22: a direct ask of me on a handed-off item → it reopens as "Looped back in: <person> asked you directly". */
  z.object({ op: z.literal('loop_back'), itemId: Id, byPersonName: z.string(), reason: z.string(), source: SourceRef }),
  /** A generic engine write to a work item (locked fields → Proposal). */
  z.object({
    op: z.literal('engine_patch'),
    itemId: Id,
    patch: z.record(z.string(), z.unknown()),
    reason: z.string(),
    state: WorkState.optional(),
    evidence: SourceRef.optional(),
  }),
  /** A connector changes state (e.g. Gmail breaks → banner, stale marks, health dot). */
  z.object({
    op: z.literal('connector_state'),
    connectorId: Id,
    state: ConnectorState,
    error: z.string().optional(),
    impact: z.string().optional(),
  }),
  /** New requirements reopen a done item. */
  z.object({ op: z.literal('reopen'), itemId: Id, reason: z.string(), source: SourceRef }),
  /** New info changes ranking inputs; the NOW header shows "Re-rank ready · n" until applied. */
  z.object({ op: z.literal('rerank_ready'), itemId: Id, boost: z.number(), reason: z.string() }),
  /**
   * Live pass (docs/UX.md "Live updates"): something new comes in, as a copy of a seeded record with a new id, stamped
   * now (a draft in the Outbox, a suggestion in Triage, a Needs-you row, an agent run). Placeholders only.
   */
  z.object({ op: z.literal('arrive'), collection: ScenarioCollection, fromId: Id, newId: Id.optional(), patch: z.record(z.string(), z.unknown()).optional(), reason: z.string() }),
  /** A record changes elsewhere (a draft sent from another tab, a logging canvas applied in Slack): the open panel says so. */
  z.object({ op: z.literal('elsewhere'), collection: ScenarioCollection, id: Id, patch: z.record(z.string(), z.unknown()), reason: z.string() }),
]);
export type ScenarioAction = z.infer<typeof ScenarioAction>;

export const ScenarioEvent = z.object({
  id: z.string(),
  /** Seconds after play. */
  at: z.number().min(0),
  label: z.string(),
  exercises: z.string(),
  actions: z.array(ScenarioAction).min(1),
});
export type ScenarioEvent = z.infer<typeof ScenarioEvent>;

export const ScenarioStatus = z.object({
  state: z.enum(['idle', 'playing', 'paused', 'finished']),
  /** Scenario time in seconds. */
  t: z.number(),
  durationSec: z.number(),
  autoplay: z.boolean(),
  source: z.enum(['seed', 'default']),
  events: z.array(z.object({ id: z.string(), at: z.number(), label: z.string(), exercises: z.string(), fired: z.boolean() })),
  fired: z.array(z.string()),
});
export type ScenarioStatus = z.infer<typeof ScenarioStatus>;

export const DevScenarioRequest = z.object({
  action: z.enum(['play', 'pause', 'reset', 'seek']),
  /** seek: jump to this scenario time (resets, then fires every event with at ≤ seconds). */
  seconds: z.number().min(0).optional(),
});
export type DevScenarioRequest = z.infer<typeof DevScenarioRequest>;

export const DevFailRequest = z.object({ rate: z.number().min(0).max(1) });
export type DevFailRequest = z.infer<typeof DevFailRequest>;
export const DevFailStatus = z.object({ rate: z.number() });
export type DevFailStatus = z.infer<typeof DevFailStatus>;

/** Simulate an engine write (tests ProposalDiff / update strips from the dev toolbar). */
export const DevEngineChangeRequest = z.object({
  entityType: z.enum(['work_item', 'draft']),
  id: Id,
  patch: z.record(z.string(), z.unknown()),
  reason: z.string().default('Engine update (dev)'),
});
export type DevEngineChangeRequest = z.infer<typeof DevEngineChangeRequest>;

export const DevEngineChangeResult = z.object({
  applied: z.array(z.string()),
  proposalIds: z.array(Id),
});
export type DevEngineChangeResult = z.infer<typeof DevEngineChangeResult>;
