/**
 * Batched, verbatim read calls through an Agent SDK child (the only way to reach the OAuth'd Slack and Org62
 * MCP servers without touching tokens). The harness decides every call; Haiku only issues them, in parallel,
 * and the PostToolUse hook captures `(tool, args) → response`. Calls the model skipped or altered are retried.
 */
import { traversalMcpServers } from '../../../src/llm/mcp-config';
import { SCANNER_MODEL } from '../../../src/llm/models';

import { runAgent, type CapturedCall } from './agent';
import { assertBudget, recordSpend } from './ledger';

export interface ReadCall {
  tool: string; // full name, e.g. mcp__slack__slack_search_public_and_private
  args: Record<string, unknown>;
}

const canon = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  // The model sometimes sends numbers as strings (or back): compare as strings.
  return JSON.stringify(v === undefined || v === null ? null : String(v));
};

export const callKey = (tool: string, args: Record<string, unknown>) => `${tool}|${canon(args)}`;

export async function execReadCalls(
  connector: 'slack' | 'org62',
  calls: ReadCall[],
  opts: { scenario: string; batch?: number; maxAttempts?: number; log?: (m: string) => void } = { scenario: 'record' },
): Promise<Map<string, CapturedCall>> {
  const out = new Map<string, CapturedCall>();
  const servers = traversalMcpServers(connector);
  const tools = [...new Set(calls.map((c) => c.tool))];
  let todo = [...calls];
  const batch = opts.batch ?? 8;
  for (let attempt = 0; attempt < (opts.maxAttempts ?? 3) && todo.length; attempt++) {
    const next: ReadCall[] = [];
    for (let i = 0; i < todo.length; i += batch) {
      const chunk = todo.slice(i, i + batch);
      assertBudget(0.02);
      const list = chunk.map((c, n) => `${n + 1}. tool \`${c.tool}\` with arguments ${JSON.stringify(c.args)}`).join('\n');
      const r = await runAgent({
        model: SCANNER_MODEL,
        mcpServers: servers as never,
        allowedTools: tools,
        maxTurns: 4,
        timeoutMs: 240_000,
        prompt: `You are a read-only data recorder. Make ALL of these ${chunk.length} tool calls in ONE turn, in parallel, with the arguments copied VERBATIM (same keys, same string values, nothing added or removed):\n${list}\n\nDo not make any other call. Do not repeat a call. After the results arrive, reply with the single word DONE. Never summarize the results.`,
      });
      recordSpend({ scenario: opts.scenario, kind: 'recorder', model: SCANNER_MODEL, costUsd: r.costUsd, note: `${connector} x${chunk.length}` });
      const got = new Map(r.calls.map((c) => [callKey(c.tool, c.input), c]));
      for (const c of chunk) {
        const k = callKey(c.tool, c.args);
        const hit = got.get(k);
        if (hit) out.set(k, hit);
        else next.push(c);
      }
      if (r.error) opts.log?.(`batch error: ${r.error.slice(0, 160)}`);
    }
    if (next.length) opts.log?.(`retrying ${next.length} call(s) the model skipped or altered`);
    todo = next;
  }
  if (todo.length) opts.log?.(`gave up on ${todo.length} call(s)`);
  return out;
}
