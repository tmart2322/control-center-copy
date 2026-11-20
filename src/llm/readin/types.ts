/**
 * Read-in engine types (BE-READIN). The agent researches with read tools only and returns its result through
 * `readin_finish`, validated here; code maps it to the contract `ReadIn` (src/contract/readin.ts).
 */
import { z } from 'zod';
import type { ReadInEntity, ReadInTrigger, SourceKind } from '@/contract';

/** Links must be http(s) permalinks that appeared in the inputs or tool results (checked again in code). */
const Link = z
  .string()
  .max(600)
  .regex(/^https?:\/\//, 'must be an http(s) permalink from the inputs');

export const READIN_SOURCE_KINDS = ['slack', 'gmail', 'calendar', 'drive', 'gemini', 'org62', 'vdp', 'claude', 'manual', 'ledger'] as const;
const SourceKindIn = z.enum(READIN_SOURCE_KINDS);

/** Field shapes of `readin_finish` (raw shape for the SDK `tool()` helper, and the object schema below). */
export const READIN_OUTPUT_SHAPE = {
  tldr: z.string().min(3).max(320).describe('What they are asking or what the meeting needs, 1-2 lines, plain text'),
  background: z
    .array(
      z.object({
        text: z.string().min(3).max(320),
        source: SourceKindIn.optional(),
        /** "#acme-ext · thread", "Gmail · Dana Lee", "Opp · ACME Phase 2" */
        label: z.string().max(120).optional(),
        permalink: Link.optional(),
        /** Internal ledger reference (a work item id from the context pack). */
        workItemId: z.string().max(80).optional(),
      }),
    )
    .max(8)
    .describe('Background bullets, each with its source (permalink from a tool result, or workItemId from the context pack)'),
  history: z
    .array(
      z.object({
        text: z.string().min(3).max(320),
        at: z.string().max(40).optional(),
        commitment: z.boolean().optional(),
        source: SourceKindIn.optional(),
        label: z.string().max(120).optional(),
        permalink: Link.optional(),
        workItemId: z.string().max(80).optional(),
      }),
    )
    .max(6)
    .describe('What the user said or committed before on this topic'),
  openQuestions: z.array(z.object({ text: z.string().min(3).max(240), to: z.string().max(80).optional() })).max(5),
  suggestedReply: z
    .object({
      channel: z.enum(['slack', 'email']),
      text: z.string().min(1).max(2000),
      subject: z.string().max(160).optional(),
    })
    .nullable()
    .describe('A reply in the user voice, for the thread the ask came from. null when no reply is needed'),
  confidence: z.enum(['sure', 'likely', 'guess']),
};

export const ReadInOutput = z.object(READIN_OUTPUT_SHAPE);
export type ReadInOutput = z.infer<typeof ReadInOutput>;

export type ReadInSkillKey = 'readin-ask' | 'readin-meeting';

/** A source the context pack knows about (thread to answer, evidence, docs). */
export interface ContextSource {
  kind: SourceKind;
  label: string;
  url?: string;
  externalId?: string;
  at?: string;
}

export interface ContextEvidence {
  id: string;
  role: string;
  at: string;
  source: ContextSource;
  author: string | null;
  fromMe: boolean;
  /** Redacted, capped. */
  text: string;
}

export interface ContextItemRef {
  id: string;
  title: string;
  kind: string;
  state: string;
  due: string | null;
  doneAt?: string | null;
  why?: string;
}

/** Where the suggested reply goes: the thread the ask came from. */
export type ReplyTarget =
  | { kind: 'slack'; target: 'thread' | 'channel' | 'dm'; channelId: string; channelName: string; threadTs: string | null; permalink?: string }
  | { kind: 'email'; to: Array<{ name?: string; email: string }>; subject: string; threadId: string | null; inReplyTo: string | null };

export interface ContextPerson {
  name: string;
  role?: string;
  email?: string;
  slackId?: string;
  external?: boolean;
}

/** The deterministic context pack: everything the ledger already knows, so the agent only researches the rest. */
export interface ReadInContext {
  entity: ReadInEntity;
  skill: ReadInSkillKey;
  generation: number;
  trigger: ReadInTrigger;
  now: string;
  timezone: string;
  me: { name: string; email?: string; slackId?: string };
  item?: {
    id: string;
    title: string;
    purpose: string | null;
    kind: string;
    state: string;
    due: string | null;
    createdAt: string;
    rank: number | null;
    why: string;
    counterparty: ContextPerson | null;
    people: ContextPerson[];
  };
  event?: {
    id: string;
    title: string;
    start: string;
    end: string;
    attendees: ContextPerson[];
    linkedItems: ContextItemRef[];
    url?: string;
  };
  account?: { id: string; name: string; org62Id?: string | null } | null;
  opp?: { id: string; name: string; stage?: string | null; amount?: number | null; closeDate?: string | null; org62Id?: string | null } | null;
  initiative?: { id: string; title: string; purpose: string; summary: string } | null;
  evidence: ContextEvidence[];
  siblings: ContextItemRef[];
  related: ContextItemRef[];
  /** My own earlier messages and commitments on this topic (ledger). */
  saidBefore: Array<{ text: string; at: string; source: ContextSource; commitment: boolean; workItemId?: string }>;
  reply: ReplyTarget | null;
  /** Rendered voice block (src/engines/voice), or null when there is no profile. */
  voice: string | null;
}

/** Spend line written per read-in (llm_calls). */
export interface ReadInSpend {
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  status: 'ok' | 'error' | 'timeout' | 'budget_blocked';
  errorCode?: string;
}
