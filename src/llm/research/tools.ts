/**
 * Chat research (`chat_research`): the in-process read-only tools of a question-scoped research run (server
 * `cc_research`). The ledger, Gmail and Drive tools are the read-in handlers (src/llm/readin/tools.ts) under research
 * names; Calendar search is new (any date range, over the devbar read client's `get_events`). Slack and Org62 come from
 * their own restricted MCP servers (src/server/chat/research.ts), exactly as for a read-in.
 *
 * `research_finish` validates the answer and refuses a link the run was never shown, so every finding is traceable.
 */
import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { listEvents } from '@/connectors/google/calendar';
import type { GoogleTools } from '@/connectors/google/client';
import { redactText } from '@/llm/redact';
import { READIN_SOURCE_KINDS } from '@/llm/readin/types';
import { createReadInTools, createToolState, rememberUrls, sanitizeForModel, type LedgerSearch, type ReadInToolState, type ToolResult } from '@/llm/readin/tools';

export const RESEARCH_SERVER = 'cc_research';
export const researchToolName = (bare: string) => `mcp__${RESEARCH_SERVER}__${bare}`;

export const RESEARCH_TOOL_NAMES = ['research_ledger_search', 'research_gmail_search', 'research_gmail_thread', 'research_drive_search', 'research_drive_read', 'research_calendar_search', 'research_finish'] as const;
export type ResearchToolName = (typeof RESEARCH_TOOL_NAMES)[number];
export const RESEARCH_ALLOWED_TOOLS = RESEARCH_TOOL_NAMES.map(researchToolName);

const Link = z
  .string()
  .max(600)
  .regex(/^https?:\/\//, 'must be an http(s) link from a tool result');

export const RESEARCH_OUTPUT_SHAPE = {
  answer: z.string().min(3).max(1500).describe('The direct answer to the question, plain text, 1-6 sentences. Say plainly when nothing was found.'),
  findings: z
    .array(
      z.object({
        text: z.string().min(3).max(320),
        source: z.enum(READIN_SOURCE_KINDS).optional(),
        /** "#acme-ext · thread", "Gmail · Dana Lee", "Calendar · ACME QBR", "Org62 · Event" */
        label: z.string().max(120).optional(),
        at: z.string().max(40).optional(),
        permalink: Link.optional(),
      }),
    )
    .max(12)
    .describe('What you found, newest first, each with its link when the tool result had one'),
  searched: z
    .array(z.object({ source: z.enum(READIN_SOURCE_KINDS), query: z.string().max(200), hits: z.number().int().min(0) }))
    .max(16)
    .describe('Every search you ran: where, what, how many hits'),
  notFound: z.array(z.string().max(200)).max(6).describe('What you looked for and did not find'),
  confidence: z.enum(['sure', 'likely', 'guess']),
};
export const ResearchOutput = z.object(RESEARCH_OUTPUT_SHAPE);
export type ResearchOutput = z.infer<typeof ResearchOutput>;

export interface ResearchToolState extends Omit<ReadInToolState, 'output'> {
  output: ResearchOutput | null;
  /** The read-in handlers' state (shares seenUrls and calls with this one). */
  inner: ReadInToolState;
}

export function createResearchState(seed: Iterable<string> = []): ResearchToolState {
  const inner = createToolState(seed);
  return { output: null, finishCalls: 0, seenUrls: inner.seenUrls, calls: inner.calls, inner };
}

export interface ResearchToolDeps {
  google?: GoogleTools | null;
  ledger?: LedgerSearch | null;
  signal?: AbortSignal;
  now?: () => Date;
  /** Characters per page of a Drive file read (the readin default when absent). */
  filePage?: number;
  /** Characters per page of a Gmail thread read, paged by `offset` (the Assistant's; absent: the readin cap). */
  threadPage?: number;
}

export type ResearchHandlerMap = Record<ResearchToolName, (args: unknown) => Promise<ToolResult>>;

const calendarShape = {
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').describe('First day to search (inclusive)'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').describe('Last day to search (inclusive); at most 366 days after from'),
  words: z.string().max(120).optional().describe('Words that must appear in the title, attendees, location or description, e.g. an account or a person'),
};

const SCHEMAS = {
  research_ledger_search: { text: z.string().min(2).max(200).describe('Words to look for: a person, account, topic or phrase'), limit: z.number().int().min(1).max(12).optional() },
  research_gmail_search: { query: z.string().min(2).max(300).describe('Gmail search syntax, e.g. globex OR "Globex Health" newer_than:2y'), max: z.number().int().min(1).max(10).optional() },
  research_gmail_thread: { thread_id: z.string().min(4).max(80) },
  research_drive_search: { query: z.string().min(2).max(300).describe("Drive query, e.g. fullText contains 'Globex'"), max: z.number().int().min(1).max(10).optional() },
  research_drive_read: { file_id: z.string().min(4).max(120), offset: z.number().int().min(0).max(5_000_000).optional().describe('Where to start, in characters (a long file says the offset to read next)') },
  research_calendar_search: calendarShape,
  research_finish: RESEARCH_OUTPUT_SHAPE,
} as const;

const DESCRIPTIONS: Record<ResearchToolName, string> = {
  research_ledger_search: "Search what the app already recorded (your messages, earlier work items, commitments). Read-only. Start here; it's free and fast.",
  research_gmail_search: 'Search Gmail live (read-only), any age. Returns message and thread ids and links.',
  research_gmail_thread: 'Read one Gmail thread (read-only, redacted, capped).',
  research_drive_search: 'Search Drive live by name or content (read-only). Returns metadata and links.',
  research_drive_read: 'Read one Drive file (read-only, redacted), a page at a time: a long file ends with the offset to read next.',
  research_calendar_search: 'Search your Calendar live over any date range (up to a year per call), optionally only events mentioning some words. Read-only.',
  research_finish: 'Submit the answer. Call exactly once, last. Every link must be one a tool result showed you.',
};

const MAX_CAL_DAYS = 366;

/** One line per event that mentions `words` (all of them, case-insensitive). */
export function calendarLines(events: Awaited<ReturnType<typeof listEvents>>, words?: string): string[] {
  const terms = (words ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  return events
    .filter((e) => {
      if (!terms.length) return true;
      const hay = `${e.title} ${e.location} ${e.description} ${e.attendeeEmails.join(' ')} ${e.organizerEmail ?? ''}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    })
    .map((e) => {
      const domains = [...new Set(e.attendeeEmails.map((m) => m.split('@')[1] ?? '').filter(Boolean))].slice(0, 6).join(', ');
      return `- ${e.start.slice(0, 16)} · ${e.title}${domains ? ` · with ${domains}` : ''}${e.link ? ` (${e.link})` : ''}`;
    });
}

export function createResearchTools(deps: ResearchToolDeps, state: ResearchToolState): ResearchHandlerMap {
  const inner = createReadInTools({ google: deps.google ?? null, ledger: deps.ledger ?? null, signal: deps.signal, ...(deps.filePage ? { filePage: deps.filePage } : {}), ...(deps.threadPage ? { threadPage: deps.threadPage } : {}) }, state.inner);
  const parse = <T extends z.ZodRawShape>(shape: T, args: unknown): z.infer<z.ZodObject<T>> => z.object(shape).parse(args);
  return {
    research_ledger_search: (a) => inner.readin_ledger_search(a),
    research_gmail_search: (a) => inner.readin_gmail_search(a),
    research_gmail_thread: (a) => inner.readin_gmail_thread(a),
    research_drive_search: (a) => inner.readin_drive_search(a),
    research_drive_read: (a) => inner.readin_drive_read(a),
    research_calendar_search: async (args) => {
      const a = parse(calendarShape, args);
      if (!deps.google) return { text: 'Calendar is not available in this run; continue with the other sources.' };
      const from = new Date(`${a.from}T00:00:00Z`);
      const to = new Date(`${a.to}T23:59:59Z`);
      if (!(to > from)) return { text: 'error: to must be on or after from', isError: true };
      if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_CAL_DAYS) return { text: `error: search at most ${MAX_CAL_DAYS} days per call; split the range`, isError: true };
      try {
        const lines = calendarLines(await listEvents(deps.google, from, to, 250, deps.signal), a.words);
        if (!lines.length) return { text: `No events${a.words ? ` mentioning "${a.words}"` : ''} between ${a.from} and ${a.to}.` };
        return { text: sanitizeForModel(`${lines.length} event(s):\n${lines.join('\n')}`, 6000, state.inner) };
      } catch (err) {
        return { text: `error: ${redactText(err instanceof Error ? err.message : String(err)).slice(0, 200)}`, isError: true };
      }
    },
    research_finish: async (args) => {
      state.finishCalls += 1;
      const r = ResearchOutput.safeParse(args);
      if (!r.success) {
        const issues = r.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
        return { text: `Invalid answer; fix these and call research_finish again:\n${issues.join('\n')}`, isError: true };
      }
      const unseen = r.data.findings.map((f) => f.permalink).filter((u): u is string => !!u && !state.seenUrls.has(u));
      if (unseen.length) return { text: `These links never appeared in a tool result; use only links you were shown (or drop them):\n${unseen.slice(0, 5).join('\n')}`, isError: true };
      state.output = r.data;
      return { text: 'Recorded. You are done; stop now.' };
    },
  };
}

/** Dispatch one call by bare name (the SDK server and fake runners in tests). */
export async function callResearchTool(handlers: ResearchHandlerMap, state: ResearchToolState, name: string, args: unknown): Promise<ToolResult> {
  const h = handlers[name as ResearchToolName];
  if (!h) return { text: `unknown tool ${name}`, isError: true };
  state.calls.push(name);
  try {
    return await h(args);
  } catch (err) {
    if (err instanceof z.ZodError) return { text: `invalid arguments: ${err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, isError: true };
    return { text: `error: ${redactText(err instanceof Error ? err.message : String(err)).slice(0, 200)}`, isError: true };
  }
}

export function buildResearchServer(handlers: ResearchHandlerMap, state: ResearchToolState): McpSdkServerConfigWithInstance {
  const tools = RESEARCH_TOOL_NAMES.map((name) =>
    tool(name, DESCRIPTIONS[name], SCHEMAS[name], async (args: unknown) => {
      const r = await callResearchTool(handlers, state, name, args);
      return { content: [{ type: 'text' as const, text: r.text }], ...(r.isError ? { isError: true } : {}) };
    }),
  );
  return createSdkMcpServer({ name: RESEARCH_SERVER, version: '1.0.0', tools, alwaysLoad: true, timeout: 45_000 });
}

export { rememberUrls };
