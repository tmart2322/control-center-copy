/**
 * A scripted stand-in for the Agent SDK `query()` (no model, no network). It drives the REAL SdkResearchAgent
 * guards: each step is emitted as an assistant `tool_use` block, then passed through the agent's PreToolUse hook
 * (the allowlist + progress), then executed against the real in-process `cc_readin` handlers when it is one of
 * them; external tools (Slack, Org62) answer with a canned, placeholder-only result.
 */
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import type { ReadInQueryFn } from '../../src/llm/readin/agent';
import { callReadInTool, READIN_SERVER } from '../../src/llm/readin/tools';

export interface Step {
  tool: string;
  input?: Record<string, unknown>;
  /** Canned result for an external tool. */
  result?: string;
}

export interface FakeOptions {
  steps: Step[] | ((n: number) => Step[]);
  costUsd?: number;
  /** Per-assistant-message usage (drives the agent's running cost estimate). */
  usage?: { input_tokens: number; output_tokens: number };
  /** Block after this many steps until the run is aborted (supersede tests). */
  blockAfter?: number;
  onBlocked?: () => void;
  mcpStatus?: string;
}

let calls = 0;
export const fakeCalls = () => calls;

export function fakeQuery(o: FakeOptions): ReadInQueryFn {
  return ({ options, handlers, state }) => {
    calls += 1;
    const steps = typeof o.steps === 'function' ? o.steps(calls) : o.steps;
    const signal = (options as Options).abortController!.signal;
    const hook = (options as Options).hooks!.PreToolUse![0]!.hooks[0]!;
    let closed = false;
    async function* gen(): AsyncGenerator<SDKMessage> {
      yield { type: 'system', subtype: 'init', mcp_servers: Object.keys(options.mcpServers ?? {}).map((name) => ({ name, status: o.mcpStatus ?? 'connected' })), tools: [] } as unknown as SDKMessage;
      let turn = 0;
      for (const s of steps) {
        if (signal.aborted || closed) return;
        if (o.blockAfter !== undefined && turn >= o.blockAfter) {
          o.onBlocked?.();
          await new Promise<void>((resolve) => (signal.aborted ? resolve() : signal.addEventListener('abort', () => resolve(), { once: true })));
          return;
        }
        turn += 1;
        const id = `toolu_${turn}`;
        yield { type: 'assistant', message: { id: `msg_${turn}`, model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', id, name: s.tool, input: s.input ?? {} }], usage: o.usage ?? { input_tokens: 900, output_tokens: 120 } } } as unknown as SDKMessage;
        if (signal.aborted) return;
        const decision = (await hook({ hook_event_name: 'PreToolUse', tool_name: s.tool, tool_input: s.input ?? {} } as never, id, { signal })) as { continue?: boolean; hookSpecificOutput?: { permissionDecision?: string } };
        if (decision.continue === false || signal.aborted) return;
        const d = decision.hookSpecificOutput?.permissionDecision;
        if (d === 'deny') continue;
        if (d !== 'allow') {
          // Like the SDK: with no hook decision, the canUseTool gate decides (READIN-1).
          const gate = await (options as Options).canUseTool!(s.tool, s.input ?? {}, { signal, toolUseID: id } as never);
          if (signal.aborted) return;
          if (gate?.behavior !== 'allow') continue;
        }
        const prefix = `mcp__${READIN_SERVER}__`;
        const text = s.tool.startsWith(prefix) ? (await callReadInTool(handlers, state, s.tool.slice(prefix.length), s.input ?? {})).text : (s.result ?? 'ok');
        yield { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } } as unknown as SDKMessage;
      }
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
        num_turns: turn,
        total_cost_usd: o.costUsd ?? 0.04,
        usage: { input_tokens: 1000, output_tokens: 200 },
        modelUsage: { 'claude-sonnet-5-5': { inputTokens: 1000 * Math.max(1, turn), outputTokens: 200, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: o.costUsd ?? 0.04, contextWindow: 200000 } },
        permission_denials: [],
      } as unknown as SDKMessage;
    }
    const it = gen();
    return Object.assign(it, { close: () => void (closed = true) });
  };
}

/** A valid readin_finish payload (placeholders only). */
export function finishInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tldr: 'Dana wants Thursday’s demo to also cover how agent pricing works.',
    background: [
      { text: 'Sam (AE) offered to join Thursday and owns pricing.', source: 'slack', label: '#acme-ext · thread', permalink: 'https://example.slack.com/archives/C0ACME0001/p1793893334322509' },
      { text: 'A link the agent was never shown must be dropped.', source: 'slack', label: 'invented', permalink: 'https://example.slack.com/archives/C0FAKE/p1' },
      { text: 'The token is api_key=abcd1234efgh5678ijkl and must not survive.', source: 'gmail', label: 'Gmail · Dana Lee' },
    ],
    history: [{ text: 'You said pricing stays with Sam.', at: '2026-10-30T16:02:00Z', commitment: false, source: 'ledger', label: 'Command Center' }],
    openQuestions: [{ text: 'Will the CFO join?', to: 'Dana Lee' }],
    suggestedReply: { channel: 'slack', text: 'Happy to have your CFO join. Sam will walk through pricing for the agent piece.' },
    confidence: 'likely',
    ...over,
  };
}

export const T = {
  ledger: `mcp__${READIN_SERVER}__readin_ledger_search`,
  gmailSearch: `mcp__${READIN_SERVER}__readin_gmail_search`,
  gmailThread: `mcp__${READIN_SERVER}__readin_gmail_thread`,
  driveSearch: `mcp__${READIN_SERVER}__readin_drive_search`,
  finish: `mcp__${READIN_SERVER}__readin_finish`,
  slackRead: 'mcp__slack__slack_read_thread',
  slackSearch: 'mcp__slack__slack_search_public_and_private',
  slackSend: 'mcp__slack__slack_send_message',
  soql: 'mcp__Org62-Sobject-Read__soqlQuery',
} as const;

/** Canned Slack thread result: carries the permalink the output may cite. */
export const SLACK_THREAD_RESULT = 'Thread in #acme-ext\n- Dana Lee: Can we also cover pricing? https://example.slack.com/archives/C0ACME0001/p1793893334322509\n- Sam Ortiz: I can join Thursday.';
