/**
 * Step 1: one cheap, read-only probe per connector, through the same paths the worker uses.
 *   - Slack / Org62: an Agent SDK child (pinned CLI, scanner env, restricted single-server MCP config from
 *     ~/.claude.json, OAuth reused) making ONE allowlisted read call.
 *   - Google (Gmail, Calendar, Drive, Gemini, trainings): the devbar MCP client the fetchers use.
 *   - Claude sessions: the local-file fetcher.
 * Prints statuses, sizes and costs only (no content). Usage:
 *   CC_STRESS_ME_SLACK=U… CC_STRESS_ME_ORG62=005… npx tsx scripts/stress/probe.ts
 */
import { ClaudeSessionsFetcher, MemorySessionStateStore } from '../../src/connectors/claude/sessions';
import { GoogleWorkspaceClient } from '../../src/connectors/google/client';
import { traversalMcpServers } from '../../src/llm/mcp-config';
import { SCANNER_MODEL } from '../../src/llm/models';
import { recordSpend } from './lib/ledger';
import { responseText, runAgent } from './lib/agent';

type Row = Record<string, unknown>;

async function probeTraversal(connector: 'slack' | 'org62', tool: string, args: Record<string, unknown>): Promise<Row> {
  const t0 = Date.now();
  let servers: Record<string, unknown>;
  try {
    servers = traversalMcpServers(connector);
  } catch (e) {
    return { connector, ok: false, stage: 'config', error: (e as Error).message };
  }
  const r = await runAgent({
    model: SCANNER_MODEL,
    mcpServers: servers as never,
    allowedTools: [tool],
    maxTurns: 3,
    timeoutMs: 120_000,
    prompt: `Call the tool ${tool} exactly once with these arguments (verbatim JSON): ${JSON.stringify(args)}. Then reply with the single word DONE. Do not summarize the result.`,
  });
  recordSpend({ scenario: 'probe', kind: 'probe', model: SCANNER_MODEL, costUsd: r.costUsd, note: connector });
  const resp = r.calls[0] ? responseText(r.calls[0].response) : '';
  return {
    connector,
    ok: r.ok && r.calls.length === 1 && !/error|unauthori|needs.auth/i.test(resp.slice(0, 200)),
    mcp: r.mcpStatus,
    calls: r.calls.map((c) => c.tool),
    responseBytes: resp.length,
    responseHead: resp.slice(0, 60).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '<email>'),
    costUsd: Number(r.costUsd.toFixed(4)),
    turns: r.turns,
    ms: Date.now() - t0,
    error: r.error,
  };
}

async function main() {
  const slackId = process.env.CC_STRESS_ME_SLACK ?? '';
  const org62Id = process.env.CC_STRESS_ME_ORG62 ?? '';
  const rows: Row[] = [];
  const only = new Set((process.env.CC_STRESS_PROBE ?? 'google,claude,slack,org62').split(','));

  if (only.has('google')) {
    const g = new GoogleWorkspaceClient();
    const t0 = Date.now();
    const h = await g.health();
    rows.push({ connector: 'google.health', state: h.state, detail: h.detail, ms: Date.now() - t0 });
    for (const [tool, args] of [
      ['search_gmail_messages', { query: `after:${Math.floor(Date.now() / 1000) - 86400}`, page_size: 2 }],
      ['get_events', { time_min: new Date(Date.now() - 86400_000).toISOString(), time_max: new Date().toISOString(), max_results: 2 }],
      ['search_drive_files', { query: `modifiedTime > '${new Date(Date.now() - 86400_000).toISOString()}'`, page_size: 2 }],
    ] as const) {
      const t1 = Date.now();
      try {
        const text = await g.call(tool, args as Record<string, unknown>);
        rows.push({ connector: `google.${tool}`, ok: true, bytes: text.length, ms: Date.now() - t1 });
      } catch (e) {
        rows.push({ connector: `google.${tool}`, ok: false, error: (e as Error).message.slice(0, 160), ms: Date.now() - t1 });
      }
    }
    await g.close();
  }
  if (only.has('claude')) {
    const f = new ClaudeSessionsFetcher({ stateStore: new MemorySessionStateStore(), recentDays: 1 });
    const t0 = Date.now();
    const now = new Date();
    const r = await f.fetch('all', null, { from: new Date(now.getTime() - 3600_000).toISOString(), to: now.toISOString() }, { signal: new AbortController().signal, limit: 5 });
    rows.push({ connector: 'claude_sessions', ok: true, items: r.items.length, coverage: r.coverage.length, ms: Date.now() - t0 });
  }
  if (only.has('slack')) {
    rows.push(
      await probeTraversal('slack', 'mcp__slack__slack_search_public_and_private', {
        query: `from:<@${slackId}>`,
        channel_types: 'public_channel,private_channel,mpim,im',
        sort: 'timestamp',
        sort_dir: 'desc',
        limit: 1,
        include_context: false,
        response_format: 'concise',
      }),
    );
  }
  if (only.has('org62')) {
    rows.push(await probeTraversal('org62', 'mcp__Org62-Sobject-Read__soqlQuery', { q: `SELECT Id FROM User WHERE Id = '${org62Id}' LIMIT 1` }));
  }
  console.log(JSON.stringify(rows, null, 1));
}

main().catch((e) => {
  console.error('probe failed', (e as Error).message);
  process.exit(1);
});
