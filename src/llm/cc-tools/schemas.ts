/**
 * zod input schemas for the in-process `cc` tools (SCANNER.md §3).
 * Raw shapes (for the Agent SDK `tool()`) plus `z.object` wrappers (for direct validation by the fake
 * runner and by `callCcTool`). Written against the zod API common to v3 and v4.
 */
import { z } from 'zod';

const iso = z.string().min(4).max(40);
const id = z.string().min(1).max(200);
const shortText = (n: number) => z.string().max(n);

export const SOURCE_ITEM_KINDS = [
  'message',
  'thread',
  'email',
  'calendar_event',
  'file_revision',
  'meeting_notes',
  'record_snapshot',
  'claude_session',
  'training_notice',
  'manual_note',
] as const;

export const EVIDENCE_ROLES = ['origin', 'progress', 'completion', 'context', 'contradiction'] as const;
export const CONFIDENCE = ['sure', 'likely', 'guess'] as const;
export const ITEM_KINDS = ['task', 'commitment', 'ask', 'training', 'follow_up', 'travel', 'deliverable'] as const;
export const COVERAGE_KINDS = [
  'channel_range',
  'thread',
  'message',
  'mailbox_range',
  'email',
  'calendar_range',
  'file',
  'query_window',
  'session',
  'record',
] as const;

export const personRef = z.object({
  name: shortText(120).optional(),
  email: shortText(200).optional(),
  externalId: shortText(80).optional(),
  isMe: z.boolean().optional(),
  isExternal: z.boolean().optional(),
});

export const sourceItemInput = z.object({
  kind: z.enum(SOURCE_ITEM_KINDS),
  /** Slack `channel:ts`, Org62 `Sobject:Id@SystemModstamp`, … */
  externalId: id,
  /** Ignored: the tool derives `<connector>:<externalId>` so idempotency never depends on the model. */
  dedupeKey: shortText(300).optional(),
  /** Ignored: the tool hashes the normalized excerpt + title. */
  contentHash: shortText(100).optional(),
  occurredAt: iso,
  author: personRef.optional(),
  participants: z.array(personRef).max(30).optional(),
  permalink: shortText(500).optional(),
  title: shortText(300).optional(),
  excerpt: shortText(4000).optional(),
  threadRef: shortText(200).optional(),
  fileRefs: z.array(shortText(500)).max(20).optional(),
  accountHints: z.array(shortText(120)).max(10).optional(),
  oppHints: z.array(shortText(40)).max(10).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const shapes = {
  cc_get_context: {},
  cc_record_source_items: {
    items: z.array(sourceItemInput).min(1).max(50),
  },
  cc_find_candidates: {
    text: shortText(600).optional(),
    people: z.array(shortText(120)).max(10).optional(),
    accounts: z.array(shortText(120)).max(5).optional(),
    files: z.array(shortText(500)).max(10).optional(),
    threadRefs: z.array(shortText(200)).max(5).optional(),
    limit: z.number().int().min(1).max(8).optional(),
  },
  cc_link_evidence: {
    workItemId: id,
    sourceItemId: id,
    role: z.enum(EVIDENCE_ROLES),
    confidence: z.enum(CONFIDENCE),
    reason: shortText(400).min(3),
  },
  cc_propose_item: {
    kind: z.enum(ITEM_KINDS),
    title: shortText(160).min(3),
    purpose: shortText(300).optional(),
    due: iso.optional(),
    effort: z.object({ youMin: z.number().min(0).max(6000).optional(), agentMin: z.number().min(0).max(6000).optional() }).optional(),
    initiativeId: id.optional(),
    accountId: id.optional(),
    oppId: id.optional(),
    expected: z.object({ fileId: shortText(500).optional(), changes: z.array(shortText(300)).max(12).optional() }).optional(),
    evidence: z
      .array(z.object({ sourceItemId: id, role: z.enum(EVIDENCE_ROLES), reason: shortText(400).min(3) }))
      .min(1)
      .max(6),
    confidence: z.enum(CONFIDENCE),
  },
  cc_propose_initiative: {
    title: shortText(160).min(3),
    purpose: shortText(400).min(3),
    accountId: id.optional(),
    oppId: id.optional(),
    workItemIds: z.array(id).min(3).max(20),
  },
  cc_flag_unlinked: {
    sourceItemId: id,
    reason: shortText(400).min(3),
    hints: z.array(shortText(160)).max(10).optional(),
  },
  cc_report_coverage: {
    windows: z
      .array(
        z.object({
          kind: z.enum(COVERAGE_KINDS).optional(),
          ref: shortText(300).min(1),
          from: shortText(40),
          to: shortText(40),
          meta: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .max(60)
      .optional(),
    objects: z
      .array(
        z.object({
          kind: z.enum(COVERAGE_KINDS),
          ref: shortText(300).min(1),
          from: shortText(40).optional(),
          to: shortText(40).optional(),
          meta: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .max(200)
      .optional(),
    notes: shortText(500).optional(),
  },
  cc_record_brief_highlights: {
    subscription: z.object({ kind: z.enum(['channel', 'opp', 'account', 'person', 'search']), ref: shortText(200).min(1) }).optional(),
    period: z.object({ from: iso, to: iso }).optional(),
    summary: shortText(2000).min(1),
    highlights: z
      .array(
        z.object({
          title: shortText(240).min(3),
          relevance: z.enum(['high', 'medium', 'low']),
          reasons: z.array(shortText(300)).min(1).max(6),
          sourceItemIds: z.array(id).max(10),
          suggestedAction: z.enum(['promote', 'task', 'ignore']).optional(),
        }),
      )
      .max(12),
  },
  /** Triage passes only (skills/triage-slack.md): one verdict per listed message. */
  cc_triage_verdicts: {
    verdicts: z
      .array(z.object({ id: id, v: z.enum(['act', 'noise', 'unsure']), why: shortText(200).optional() }))
      .min(1)
      .max(40),
  },
  cc_finish: {
    cursor: z.object({ value: shortText(200).min(1), at: iso }),
    complete: z.boolean().optional(),
    /** Room for scan-watch's `HIGHLIGHTS v1` fallback block. */
    summary: shortText(4000).optional(),
    stats: z
      .object({
        fetched: z.number().int().min(0).optional(),
        new: z.number().int().min(0).optional(),
        linked: z.number().int().min(0).optional(),
        proposed: z.number().int().min(0).optional(),
        unlinked: z.number().int().min(0).optional(),
      })
      .optional(),
  },
} as const;

export type CcToolName = keyof typeof shapes;
/** Tools of a scan run. The triage-only verdict tool is not offered to traversal agents (prompt tokens). */
export const CC_TOOL_NAMES = (Object.keys(shapes) as CcToolName[]).filter((n) => n !== 'cc_triage_verdicts');
/** Tools of a triage / escalation pass: read candidates, link or propose, flag, give verdicts. No recording, no coverage. */
export const CC_TRIAGE_TOOL_NAMES: CcToolName[] = ['cc_find_candidates', 'cc_link_evidence', 'cc_propose_item', 'cc_flag_unlinked', 'cc_triage_verdicts'];

export const schemas = Object.fromEntries(Object.entries(shapes).map(([k, v]) => [k, z.object(v as z.ZodRawShape)])) as {
  [K in CcToolName]: z.ZodObject<(typeof shapes)[K]>;
};

export type CcInput<K extends CcToolName> = z.infer<z.ZodObject<(typeof shapes)[K]>>;

export const CC_TOOL_DESCRIPTIONS: Record<CcToolName, string> = {
  cc_get_context: 'Return the cached context pack for this run (cursor, gaps, watch list, aliases, open items, initiatives). Usually not needed: it is already in the system prompt.',
  cc_record_source_items:
    'Upsert normalized raw items you read (one per Slack message / Org62 record snapshot). Excerpts must already be credential-redacted, verbatim text, ≤1000 chars. Returns [{id, ext, new, chg}] — use id as sourceItemId.',
  cc_find_candidates: 'Ranked existing work items / initiatives to link a source item to. Pass people, accounts, file ids, thread refs and key words. Returns [{w|i, t, s, why, st, res?, inv?}].',
  cc_link_evidence:
    'Attach a recorded source item to a work item as a signal: origin | progress | completion | context | contradiction. You never set item state. Use reason prefix "loop_back:" with role origin for a direct ask on a handed-off item.',
  cc_propose_item: 'Create a new ask / commitment / follow-up / training / deliverable with evidence. sure → open, likely → open + new badge, guess → Triage.',
  cc_propose_initiative: 'Only when nothing matches and 3+ work items cluster around one goal.',
  cc_flag_unlinked:
    'A relevant source item with no confident home. reason = one self-contained redacted line (who, what, account); hints = people, accounts, keywords, refs.',
  cc_report_coverage:
    'Report exactly what you scanned: windows (search/channel/thread ref + from/to as ISO or Slack ts) and objects (thread refs, record ids). Report every executed query, including those with 0 results.',
  cc_record_brief_highlights:
    'Watch/brief runs only (R-UI-21): record the "worth a closer look" highlights for this subscription and period. subscription/period default to the run scope and window. Cite recorded sourceItemIds.',
  cc_triage_verdicts:
    'Triage passes only: one verdict per listed message id (sourceItemId or <channelId>:<ts>). act = you proposed or linked it (do that first); noise = nothing to do; unsure = could be an ask/commitment but you cannot tell (a stronger model decides).',
  cc_finish: 'Call once, last. cursor = {value, at}; complete=false if you stopped before the window end (paging limit). The worker commits cursor + coverage atomically.',
};
