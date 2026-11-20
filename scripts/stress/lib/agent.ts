/**
 * Minimal Agent SDK driver for the stress campaign's own agents (probe, recorder, answer key, adjudication).
 * It mirrors the scanner SkillRunner's process settings exactly (pinned CLI, scanner env + gateway config,
 * strict MCP config, `dontAsk`, exact allowlist enforced by a PreToolUse hook) so a probe that passes here
 * proves the worker's own path. A PostToolUse hook captures every `(tool, input) → response` for recording.
 *
 * Read-only by construction: `assertReadOnly` on the allowlist, and every other tool is denied and aborts.
 */
import fs from 'node:fs';

import { query, type HookCallback, type McpServerConfig, type Options } from '@anthropic-ai/claude-agent-sdk';

import { claudeGatewayConfig, scannerEnv } from '../../../src/llm/claude-env';
import { defaultClaudeExecutable, defaultScannerCwd } from '../../../src/llm/env';
import { assertReadOnly, disallowedFor } from '../../../src/llm/mcp-config';

export interface CapturedCall {
  tool: string;
  input: Record<string, unknown>;
  response: unknown;
  at: string;
}

export interface AgentRunResult {
  ok: boolean;
  text: string;
  costUsd: number;
  turns: number;
  calls: CapturedCall[];
  mcpStatus: Array<{ name: string; status: string }>;
  error?: string;
  denied: string[];
  inputTokens: number;
  outputTokens: number;
}

export interface AgentRunInput {
  model: string;
  prompt: string;
  systemPrompt?: string;
  mcpServers?: Record<string, McpServerConfig>;
  allowedTools?: string[];
  maxTurns?: number;
  maxBudgetUsd?: number;
  timeoutMs?: number;
  effort?: Options['effort'];
  onCall?: (c: CapturedCall) => void;
}

/** Text of an MCP tool response (content blocks → joined text). */
export function responseText(r: unknown): string {
  if (typeof r === 'string') return r;
  const blocks = Array.isArray(r) ? r : ((r as { content?: unknown })?.content as unknown[] | undefined);
  if (Array.isArray(blocks)) return blocks.map((b) => (typeof b === 'string' ? b : ((b as { text?: string }).text ?? ''))).join('\n');
  try {
    return JSON.stringify(r);
  } catch {
    return String(r);
  }
}

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const allowed = input.allowedTools ?? [];
  assertReadOnly(allowed);
  const allowSet = new Set(allowed);
  const calls: CapturedCall[] = [];
  const denied: string[] = [];
  const ac = new AbortController();
  let error: string | undefined;
  const pre: HookCallback = async (h) => {
    if (h.hook_event_name !== 'PreToolUse') return {};
    if (allowSet.has(h.tool_name)) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } };
    denied.push(h.tool_name);
    error = `disallowed tool ${h.tool_name}`;
    ac.abort();
    return { continue: false, hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'not allowlisted' } };
  };
  const post: HookCallback = async (h) => {
    if (h.hook_event_name !== 'PostToolUse') return {};
    const c: CapturedCall = { tool: h.tool_name, input: (h.tool_input ?? {}) as Record<string, unknown>, response: h.tool_response, at: new Date().toISOString() };
    calls.push(c);
    input.onCall?.(c);
    return {};
  };
  const gw = claudeGatewayConfig();
  const cwd = defaultScannerCwd();
  fs.mkdirSync(cwd, { recursive: true });
  const options: Options = {
    model: input.model,
    effort: input.effort ?? 'low',
    tools: [],
    mcpServers: input.mcpServers ?? {},
    strictMcpConfig: true,
    allowedTools: allowed,
    disallowedTools: disallowedFor(allowed),
    permissionMode: 'dontAsk',
    canUseTool: async (name) => (allowSet.has(name) ? { behavior: 'allow' } : { behavior: 'deny', message: 'not allowlisted', interrupt: true }),
    hooks: { PreToolUse: [{ hooks: [pre] }], PostToolUse: [{ hooks: [post] }] },
    settingSources: ['user'],
    skills: [],
    persistSession: false,
    maxTurns: input.maxTurns ?? 10,
    ...(input.maxBudgetUsd ? { maxBudgetUsd: input.maxBudgetUsd } : {}),
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    env: scannerEnv(gw.env),
    ...(gw.apiKeyHelper ? { settings: { apiKeyHelper: gw.apiKeyHelper } } : {}),
    cwd,
    pathToClaudeCodeExecutable: defaultClaudeExecutable(),
    abortController: ac,
  };
  const out: AgentRunResult = { ok: false, text: '', costUsd: 0, turns: 0, calls, mcpStatus: [], denied, inputTokens: 0, outputTokens: 0 };
  const timer = setTimeout(() => {
    error = error ?? `timeout after ${input.timeoutMs ?? 300_000} ms`;
    ac.abort();
  }, input.timeoutMs ?? 300_000);
  try {
    for await (const msg of query({ prompt: input.prompt, options })) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        out.mcpStatus = (msg.mcp_servers ?? []).map((s) => ({ name: s.name, status: s.status }));
      } else if (msg.type === 'assistant') {
        const m = msg.message as unknown as { content?: Array<{ type: string; text?: string }> };
        for (const b of m.content ?? []) if (b.type === 'text' && b.text) out.text += b.text;
      } else if (msg.type === 'result') {
        out.costUsd = msg.total_cost_usd ?? 0;
        out.turns = msg.num_turns ?? 0;
        const mu = Object.values(msg.modelUsage ?? {});
        out.inputTokens = mu.reduce((a, u) => a + u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens, 0);
        out.outputTokens = mu.reduce((a, u) => a + u.outputTokens, 0);
        if (msg.subtype === 'success' && !msg.is_error) {
          out.ok = !error;
          if (typeof msg.result === 'string' && msg.result.length > out.text.length) out.text = msg.result;
        } else {
          error = error ?? `${msg.subtype}${'errors' in msg && msg.errors?.length ? `: ${msg.errors.join(' | ').slice(0, 300)}` : ''}`;
        }
      }
    }
  } catch (e) {
    error = error ?? (e instanceof Error ? e.message : String(e)).slice(0, 300);
  } finally {
    clearTimeout(timer);
  }
  if (error) {
    out.ok = false;
    out.error = error;
  }
  return out;
}
