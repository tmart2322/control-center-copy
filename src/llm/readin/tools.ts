/**
 * The read-in agent's in-process tools (server `cc_readin`), all read-only:
 *
 *   readin_ledger_search   the internal ledger: my earlier messages, prior work items, what I said or promised
 *   readin_gmail_search    Gmail search      → devbar google_workspace_readonly `search_gmail_messages`
 *   readin_gmail_thread    one Gmail thread  → `get_gmail_thread_content`
 *   readin_drive_search    Drive search      → `search_drive_files` (metadata)
 *   readin_drive_read      one Drive file    → `get_drive_file_content` (excerpt only)
 *   readin_finish          the structured result (zod-validated); the run ends after it
 *
 * Google calls go through `GoogleWorkspaceClient`, whose code-level read allowlist refuses anything else; the four
 * names below are a subset of it (never widened). Every result is redacted (credential-like text masked) and capped
 * before the model sees it, and every URL in it is remembered so the output may only cite links it was shown.
 * Slack and Org62 are not here: the agent reaches them through their own restricted MCP servers (agent.ts).
 */
import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { assertReadTool, type GoogleTools } from '@/connectors/google/client';
import { redactText } from '@/llm/redact';

import { READIN_OUTPUT_SHAPE, ReadInOutput } from './types';

export const READIN_SERVER = 'cc_readin';
export const readinToolName = (bare: string) => `mcp__${READIN_SERVER}__${bare}`;

export const READIN_TOOL_NAMES = ['readin_ledger_search', 'readin_gmail_search', 'readin_gmail_thread', 'readin_drive_search', 'readin_drive_read', 'readin_finish'] as const;
export type ReadInToolName = (typeof READIN_TOOL_NAMES)[number];
export const READIN_ALLOWED_TOOLS = READIN_TOOL_NAMES.map(readinToolName);

/** The Google read tools a read-in may use: a subset of GOOGLE_READ_TOOLS (src/connectors/google/client.ts). */
export const READIN_GOOGLE_TOOLS = ['search_gmail_messages', 'get_gmail_thread_content', 'search_drive_files', 'get_drive_file_content'] as const;
for (const t of READIN_GOOGLE_TOOLS) assertReadTool(t); // throws at import if the allowlist ever drops one

export interface LedgerHit {
  kind: 'message' | 'work_item';
  at: string;
  label: string;
  text: string;
  fromMe: boolean;
  permalink?: string;
  workItemId?: string;
}

/** Internal ledger search (Postgres FTS over my source items and work items in the db implementation). */
export interface LedgerSearch {
  search(q: { text: string; limit: number; signal?: AbortSignal }): Promise<LedgerHit[]>;
}

export interface ReadInToolDeps {
  google?: GoogleTools | null;
  ledger?: LedgerSearch | null;
  signal?: AbortSignal;
  /** Characters per page of a Drive file read (default LIMITS.file). */
  filePage?: number;
  /**
   * Characters per page of a Gmail thread read (the Assistant's, A6): the thread pages by an `offset` arg instead of
   * being cut at LIMITS.thread. Absent (read-ins, research runs): cut as before.
   */
  threadPage?: number;
}

export interface ReadInToolState {
  output: ReadInOutput | null;
  finishCalls: number;
  /** Every URL the agent was shown (context pack + tool results); cited links must be in here. */
  seenUrls: Set<string>;
  calls: string[];
}

export function createToolState(seed: Iterable<string> = []): ReadInToolState {
  return { output: null, finishCalls: 0, seenUrls: new Set(seed), calls: [] };
}

export type ToolResult = { text: string; isError?: boolean };
export type ToolHandler = (args: unknown) => Promise<ToolResult>;
/** Keyed by bare tool name (`readin_finish`). */
export type ToolHandlerMap = Record<ReadInToolName, ToolHandler>;

const LIMITS = { search: 4000, thread: 8000, file: 6000, ledger: 4000 } as const;

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

/** Remember every URL in a tool result: the output may only cite links the agent was shown. */
export function rememberUrls(text: string, state: ReadInToolState): void {
  for (const m of text.matchAll(URL_RE)) state.seenUrls.add(m[0].replace(/[.,;:]+$/, ''));
}

/**
 * One page of a long text (a Drive file): `offset` on, at most `max` characters, ending at a line break when one is in
 * the page's second half (a sheet's rows stay whole). Says where it is and the offset to read next, so a reader can
 * page through a 40,000-character sheet instead of stopping at its first rows. Redacted before paging.
 */
export function pageForModel(text: string, max: number, offset: number, state: ReadInToolState): string {
  const red = redactText(text).replace(/\n{3,}/g, '\n\n');
  if (offset >= red.length && offset > 0) return `(offset ${offset} is past the end: the file has ${red.length} characters)`;
  let end = Math.min(red.length, offset + max);
  if (end < red.length) {
    const nl = red.lastIndexOf('\n', end);
    if (nl > offset + max / 2) end = nl + 1;
  }
  const page = red.slice(offset, end);
  rememberUrls(page, state);
  const head = offset > 0 ? `[characters ${offset}–${end} of ${red.length}]\n` : '';
  const more = end < red.length ? `\n… [${red.length - end} more characters: read again with offset=${end}]` : '';
  return `${head}${page}${more}`;
}

/** Redact, collapse blank runs, cap, and remember URLs. */
export function sanitizeForModel(text: string, max: number, state: ReadInToolState): string {
  const red = redactText(text).replace(/\n{3,}/g, '\n\n');
  rememberUrls(red, state);
  return red.length > max ? `${red.slice(0, max)}\n… [truncated ${red.length - max} chars]` : red;
}

const schemas = {
  readin_ledger_search: { text: z.string().min(2).max(200).describe('Words to look for: a person, account, topic or phrase'), limit: z.number().int().min(1).max(12).optional() },
  readin_gmail_search: { query: z.string().min(2).max(300).describe('Gmail search syntax, e.g. from:dana@example.com newer_than:30d'), max: z.number().int().min(1).max(10).optional() },
  readin_gmail_thread: { thread_id: z.string().min(4).max(80) },
  readin_drive_search: { query: z.string().min(2).max(300).describe("Drive query, e.g. name contains 'ACME' and modifiedTime > '2026-10-01'"), max: z.number().int().min(1).max(10).optional() },
  readin_drive_read: { file_id: z.string().min(4).max(120), offset: z.number().int().min(0).max(5_000_000).optional().describe('Where to start, in characters (a long file says the offset to read next)') },
  readin_finish: READIN_OUTPUT_SHAPE,
} as const;

const descriptions: Record<ReadInToolName, string> = {
  readin_ledger_search: 'Search the internal ledger (your earlier messages, prior work items, commitments). Read-only.',
  readin_gmail_search: 'Search Gmail (read-only). Returns message ids, thread ids and web links.',
  readin_gmail_thread: 'Read one Gmail thread (read-only, redacted, capped).',
  readin_drive_search: 'Search Drive files by name/content (read-only). Returns metadata and links.',
  readin_drive_read: 'Read one Drive file (read-only, redacted), a page at a time: a long file ends with the offset to read next.',
  readin_finish: 'Submit the read-in. Call exactly once, last. Every bullet cites a permalink you were shown or a workItemId from the context pack.',
};

const unavailable = (what: string): ToolResult => ({ text: `${what} is not available in this run; continue with the other sources.` });

export function createReadInTools(deps: ReadInToolDeps, state: ReadInToolState): ToolHandlerMap {
  const g = deps.google ?? null;
  const call = async (tool: (typeof READIN_GOOGLE_TOOLS)[number], args: Record<string, unknown>, max: number): Promise<ToolResult> => {
    if (!g) return unavailable('Google (Gmail/Drive)');
    try {
      const text = await g.call(tool, args, { signal: deps.signal, timeoutMs: 30_000 });
      return { text: sanitizeForModel(text || '(no results)', max, state) };
    } catch (err) {
      // Error text never carries the arguments (GoogleCallError), and is redacted again here.
      return { text: `error: ${redactText(err instanceof Error ? err.message : String(err)).slice(0, 200)}`, isError: true };
    }
  };
  const parse = <T extends z.ZodRawShape>(shape: T, args: unknown): z.infer<z.ZodObject<T>> => z.object(shape).parse(args);
  return {
    readin_ledger_search: async (args) => {
      const a = parse(schemas.readin_ledger_search, args);
      if (!deps.ledger) return unavailable('The ledger search');
      const hits = await deps.ledger.search({ text: a.text, limit: a.limit ?? 8, signal: deps.signal });
      if (!hits.length) return { text: 'No ledger matches.' };
      const lines = hits.map((h) => `- [${h.kind}${h.workItemId ? ` workItemId=${h.workItemId}` : ''}] ${h.at.slice(0, 16)} · ${h.label}${h.fromMe ? ' · YOU' : ''}: ${h.text}${h.permalink ? ` (${h.permalink})` : ''}`);
      return { text: sanitizeForModel(lines.join('\n'), LIMITS.ledger, state) };
    },
    readin_gmail_search: async (args) => {
      const a = parse(schemas.readin_gmail_search, args);
      return call('search_gmail_messages', { query: a.query, page_size: a.max ?? 8 }, LIMITS.search);
    },
    readin_gmail_thread: async (args) => {
      const a = parse(schemas.readin_gmail_thread, args);
      if (!deps.threadPage) return call('get_gmail_thread_content', { thread_id: a.thread_id }, LIMITS.thread);
      if (!g) return unavailable('Google (Gmail/Drive)');
      const offset = z.number().int().min(0).max(5_000_000).optional().parse((args as { offset?: unknown } | null)?.offset) ?? 0;
      try {
        const text = await g.call('get_gmail_thread_content', { thread_id: a.thread_id }, { signal: deps.signal, timeoutMs: 30_000 });
        return { text: pageForModel(text || '(no results)', deps.threadPage, offset, state) };
      } catch (err) {
        return { text: `error: ${redactText(err instanceof Error ? err.message : String(err)).slice(0, 200)}`, isError: true };
      }
    },
    readin_drive_search: async (args) => {
      const a = parse(schemas.readin_drive_search, args);
      return call('search_drive_files', { query: a.query, page_size: a.max ?? 8 }, LIMITS.search);
    },
    readin_drive_read: async (args) => {
      const a = parse(schemas.readin_drive_read, args);
      if (!g) return unavailable('Google (Gmail/Drive)');
      try {
        const text = await g.call('get_drive_file_content', { file_id: a.file_id }, { signal: deps.signal, timeoutMs: 30_000 });
        return { text: pageForModel(text || '(no results)', deps.filePage ?? LIMITS.file, a.offset ?? 0, state) };
      } catch (err) {
        return { text: `error: ${redactText(err instanceof Error ? err.message : String(err)).slice(0, 200)}`, isError: true };
      }
    },
    readin_finish: async (args) => {
      state.finishCalls += 1;
      const r = ReadInOutput.safeParse(args);
      if (!r.success) {
        const issues = r.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
        return { text: `Invalid read-in; fix these and call readin_finish again:\n${issues.join('\n')}`, isError: true };
      }
      state.output = r.data;
      return { text: 'Recorded. You are done; stop now.' };
    },
  };
}

/** Dispatch one call by bare name (used by the SDK server and the fake runners in tests). */
export async function callReadInTool(handlers: ToolHandlerMap, state: ReadInToolState, name: string, args: unknown): Promise<ToolResult> {
  const h = handlers[name as ReadInToolName];
  if (!h) return { text: `unknown tool ${name}`, isError: true };
  state.calls.push(name);
  try {
    return await h(args);
  } catch (err) {
    if (err instanceof z.ZodError) return { text: `invalid arguments: ${err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, isError: true };
    return { text: `error: ${redactText(err instanceof Error ? err.message : String(err)).slice(0, 200)}`, isError: true };
  }
}

export function buildReadInServer(handlers: ToolHandlerMap, state: ReadInToolState): McpSdkServerConfigWithInstance {
  const tools = READIN_TOOL_NAMES.map((name) =>
    tool(name, descriptions[name], schemas[name], async (args: unknown) => {
      const r = await callReadInTool(handlers, state, name, args);
      return { content: [{ type: 'text' as const, text: r.text }], ...(r.isError ? { isError: true } : {}) };
    }),
  );
  return createSdkMcpServer({ name: READIN_SERVER, version: '1.0.0', tools, alwaysLoad: true, timeout: 45_000 });
}
