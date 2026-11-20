/**
 * In-process MCP servers that replace the real Slack and Org62 servers during replay. They keep the real
 * server NAMES and tool names (`mcp__slack__slack_search_public_and_private`, `mcp__Org62-Sobject-Read__soqlQuery`),
 * so the production allowlists, `disallowedTools`, guards and skills run unchanged; only the transport differs.
 * Every call goes through the fault injector and the miss/leak accounting. A decoy tool that is NOT on any
 * allowlist (`slack_export_history`) exists so the allowlist-abort path can be exercised end to end.
 */
import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { FAULT_TEXT, FaultInjector, sleepMs } from './faults';
import { ReplayMiss, type SlackReplay } from './slack';
import { runSoql, type SoqlTable } from './soql';

type CallToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

export interface ToolCallLog {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  fault?: string;
  miss?: string;
  bytes: number;
  at: string;
}

const text = (t: string, isError = false): CallToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

async function guarded(
  source: 'slack' | 'org62',
  name: string,
  args: Record<string, unknown>,
  faults: FaultInjector,
  log: ToolCallLog[],
  now: () => number,
  run: (partial: boolean, empty: boolean) => string,
): Promise<CallToolResult> {
  const entry: ToolCallLog = { tool: name, args, ok: true, bytes: 0, at: new Date(now()).toISOString() };
  log.push(entry);
  const f = faults.decide(name);
  if (f?.kind === 'slow') await sleepMs(f.delayMs ?? 5000);
  if (f && f.kind !== 'slow' && f.kind !== 'partial' && f.kind !== 'empty') {
    if (f.kind === 'timeout') await sleepMs(f.delayMs ?? 30_000);
    entry.ok = false;
    entry.fault = f.kind;
    return text(FAULT_TEXT[source][f.kind], true);
  }
  try {
    const out = run(f?.kind === 'partial', f?.kind === 'empty');
    entry.bytes = out.length;
    if (f) entry.fault = f.kind;
    return text(out);
  } catch (e) {
    entry.ok = false;
    if (e instanceof ReplayMiss) {
      entry.miss = e.why;
      // The agent sees a plausible tool error; the harness counts the miss and fails the scenario.
      return text(`Error: ${e.why}`, true);
    }
    return text(`Error: ${(e as Error).message}`, true);
  }
}

export function slackReplayServer(replay: SlackReplay, opts: { faults: FaultInjector; log: ToolCallLog[]; now: () => number }): McpSdkServerConfigWithInstance {
  const g = (name: string, fn: (a: Record<string, unknown>, partial: boolean, empty: boolean) => string) => async (args: Record<string, unknown>) =>
    guarded('slack', name, args, opts.faults, opts.log, opts.now, (partial, empty) => fn(args, partial, empty));
  const searchShape = {
    query: z.string(),
    after: z.union([z.string(), z.number()]).optional(),
    before: z.union([z.string(), z.number()]).optional(),
    channel_types: z.string().optional(),
    content_types: z.string().optional(),
    context_channel_id: z.string().optional(),
    cursor: z.string().optional(),
    include_bots: z.boolean().optional(),
    include_context: z.boolean().optional(),
    limit: z.number().optional(),
    max_context_length: z.number().optional(),
    only_my_channels: z.boolean().optional(),
    response_format: z.enum(['detailed', 'concise']).optional(),
    sort: z.enum(['score', 'timestamp']).optional(),
    sort_dir: z.enum(['asc', 'desc']).optional(),
  };
  return createSdkMcpServer({
    name: 'slack',
    version: '0.0.0-replay',
    tools: [
      tool(
        'slack_search_public_and_private',
        `Searches for messages in ALL Slack channels, including public channels, private channels, DMs, and group DMs. Current logged in user's user_id is ${replay.ix.me}. Search modifiers: in:<#C123>, from:<@U123>, -from:<@U123>, <@U123>. after/before are Unix timestamps (inclusive).`,
        searchShape,
        g('slack_search_public_and_private', (a, partial, empty) => {
          if (empty) return JSON.stringify({ results: `# Search Results for: ${String(a.query)}\n\nNo results found.` });
          const out = replay.search(a);
          if (!partial) return out;
          // Partial page: keep the first result only, but keep the cursor (the real API can return short pages).
          const body = JSON.parse(out) as { results: string; pagination_info?: string };
          const cut = body.results.split(/(?=^### Result 2 of)/m)[0]!;
          return JSON.stringify({ ...body, results: cut });
        }),
      ),
      tool(
        'slack_read_thread',
        'Reads a thread (parent and replies).',
        { channel_id: z.string(), message_ts: z.string(), limit: z.number().optional(), cursor: z.string().optional(), oldest: z.string().optional(), latest: z.string().optional(), response_format: z.enum(['detailed', 'concise']).optional() },
        g('slack_read_thread', (a) => replay.readThread(a)),
      ),
      tool(
        'slack_read_channel',
        'Reads channel history.',
        { channel_id: z.string(), oldest: z.string().optional(), latest: z.string().optional(), limit: z.number().optional(), cursor: z.string().optional(), response_format: z.enum(['detailed', 'concise']).optional() },
        g('slack_read_channel', (a) => replay.readChannel(a)),
      ),
      tool('slack_list_unreads', 'Lists unread conversations.', { channel_types: z.string().optional(), limit: z.number().optional() }, g('slack_list_unreads', () => replay.listUnreads())),
      tool('slack_export_history', 'Exports channel history (decoy: never allowlisted).', { channel_id: z.string().optional() }, async (args) => {
        opts.log.push({ tool: 'slack_export_history', args, ok: false, fault: 'DISALLOWED_TOOL_EXECUTED', bytes: 0, at: new Date(opts.now()).toISOString() });
        return text('Error: this tool must never execute', true);
      }),
    ],
  });
}

export function org62ReplayServer(tables: Record<string, SoqlTable>, opts: { faults: FaultInjector; log: ToolCallLog[]; now: () => number; stats: { calls: number; misses: number; leaks: number; missReasons: string[] } }): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'Org62-Sobject-Read',
    version: '0.0.0-replay',
    tools: [
      tool('soqlQuery', 'Executes a read-only SOQL query against Org62. Argument q: the SOQL string.', { q: z.string() }, async (args) =>
        guarded('org62', 'soqlQuery', args, opts.faults, opts.log, opts.now, (_partial, empty) => {
          opts.stats.calls += 1;
          try {
            const r = runSoql(tables, String(args.q), new Date(opts.now()));
            if (empty) return JSON.stringify({ totalSize: 0, done: true, records: [] });
            return JSON.stringify(r);
          } catch (e) {
            if (e instanceof ReplayMiss) {
              opts.stats.misses += 1;
              if (opts.stats.missReasons.length < 200) opts.stats.missReasons.push(e.why);
            }
            throw e;
          }
        }),
      ),
    ],
  });
}
