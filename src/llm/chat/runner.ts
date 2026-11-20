/**
 * The chat runner (BE-CHAT): one Agent SDK `query()` per chat turn.
 *
 * - Model from the thread's choice (sonnet by default, CONTRACT-1 `ChatModel`), skill
 *   `skills/chat-assistant.md` + the per-turn context pack in the system prompt, the thread so far and the
 *   message in the user prompt.
 * - Tools: the in-process `chat` MCP server (`tools: []`, `strictMcpConfig`), filtered by the persona (D-55), plus,
 *   with live connectors (db), the scanners' restricted Slack and Org62 servers exactly as the scanners load them
 *   (`traversalMcpServers` + `restrictedTools`, read tools only, `assertReadOnly`; D-58). Exact allowlist enforced by
 *   a PreToolUse hook, `canUseTool` and a scan of assistant `tool_use` blocks: a call to any other real tool aborts
 *   the turn with an error. Every SOQL query passes the guardrails in ./soql.ts first (SELECT only, LIMIT ≤ 200, the
 *   persona's object allowlist).
 * - Streams assistant text (partial messages) and tool rows; tool cards (proposal, scan, draft, session)
 *   come from the tool handlers. Scans are followed (polled) until done or `scanFollowMs` after the answer.
 * - Budget: `maxTurns`, the SDK's `maxBudgetUsd`, plus a running estimate that aborts as soon as the
 *   per-message cap is crossed; the day's chat line and the hard cap are checked before the call. Sub-runs a tool
 *   starts (research, Org62 lookups, Find assets) spend inside the same cap (D-58).
 *   Tokens and cost are recorded through `host.recordUsage` (purpose `chat`) however the turn ends.
 * - Abortable: the turn's signal (Stop, a new message in the thread, the client leaving) aborts the query.
 * - Clean child env (gateway env + apiKeyHelper from the user's settings; never host-session vars).
 * - Logs carry ids, tool names and codes only; no bodies, no secrets.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { query as sdkQuery, SYSTEM_PROMPT_DYNAMIC_BOUNDARY, type CanUseTool, type EffortLevel, type HookCallback, type Options, type SDKMessage, type SettingSource } from '@anthropic-ai/claude-agent-sdk';
import type { ChatModel } from '@/contract';
import { claudeGatewayConfig, scannerEnv, type GatewayConfig } from '../claude-env';
import { defaultClaudeExecutable } from '../env';
import { classifyError, errorText } from '../errors';
import { restrictedTools, traversalMcpServers } from '../mcp-config';
import { estimateCallCostUsd } from '../models';
import { safeLogText } from '../redact';
import { isRealTool } from '../skill-runner';
import { connectorActive, type ResolvedPersona } from '@/personas';
import type { ConnectorId } from '@/scanner/types';
import { buildChatPrompt, loadChatSkill } from './prompt';
import { buildChatMcpServer, chatAllowedToolsFor } from './server';
import { guardSoql } from './soql';
import { CHAT_SERVER_NAME, newToolState, scanProgress, type ChatToolCtx } from './tools';
import type { ChatHost, ChatRunStep, ChatTurnInput, ChatTurnRunner, ChatUsageRecord } from './types';

/** ChatModel → model id (src/llm/models.ts prices them). */
export const CHAT_MODEL_IDS: Record<ChatModel, string> = { sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' };

export type ChatQueryFn = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage> & { close?: () => void };

export interface ChatRunnerLogEvent {
  messageId: string;
  event: 'start' | 'tool' | 'denied' | 'cost' | 'result' | 'error' | 'scan';
  tool?: string;
  code?: string;
  costUsd?: number;
  detail?: string;
}

export interface ChatRunnerOptions {
  queryFn?: ChatQueryFn;
  repoRoot?: string;
  skillPath?: string;
  pathToClaudeCodeExecutable?: string;
  cwd?: string;
  env?: Record<string, string>;
  gateway?: GatewayConfig;
  settingSources?: SettingSource[];
  effort?: EffortLevel;
  /** Watchdog per turn (ms). Default 180 s. */
  timeoutMs?: number;
  /** Scan follow: poll interval and how long to keep following after the answer. */
  scanPollMs?: number;
  scanFollowMs?: number;
  logger?: (e: ChatRunnerLogEvent) => void;
  /** The scanners' restricted servers for live reads (tests inject; default: traversalMcpServers from ~/.claude.json). */
  externalReads?: (connectors: ConnectorId[]) => ExternalReads;
}

/** The scanners' Slack / Org62 MCP servers a chat turn loads (D-58): read tools only, exactly the scan allowlists. */
export interface ExternalReads {
  servers: Record<string, unknown>;
  allowedTools: string[];
  disallowedTools: string[];
  /** Sources that couldn't load (not declared in the Claude config): the prompt says so. */
  unavailable: string[];
}

/** The external read connectors of a chat turn, in a fixed order. */
export const CHAT_EXTERNAL_CONNECTORS: readonly ConnectorId[] = ['slack', 'org62'];

/** Load the restricted servers for these connectors as the scanners do; a missing declaration skips that source. */
export function scannerReads(connectors: ConnectorId[], configPath?: string): ExternalReads {
  const out: ExternalReads = { servers: {}, allowedTools: [], disallowedTools: [], unavailable: [] };
  for (const c of connectors) {
    try {
      const servers = traversalMcpServers(c, configPath);
      const t = restrictedTools(c);
      Object.assign(out.servers, servers);
      out.allowedTools.push(...t.allowedTools);
      out.disallowedTools.push(...t.disallowedTools);
    } catch {
      out.unavailable.push(c);
    }
  }
  return out;
}

/** The Org62 soqlQuery tool's wire name (its input gets the SOQL guardrails). */
const isSoqlTool = (name: string) => /^mcp__Org62-Sobject-Read__soqlQuery$/.test(name);

/** Fixed chat cwd under the app's state dir, so the Claude-sessions watcher can tell chat runs apart. */
export function defaultChatCwd(source: NodeJS.ProcessEnv = process.env): string {
  return source.CC_CHAT_CWD ?? path.join(os.homedir(), 'Library/Application Support/control-center/chat-cwd');
}

/** A tiny async queue: producers push steps, the turn generator drains them in order. */
class StepQueue {
  private items: ChatRunStep[] = [];
  private waiters: Array<(r: IteratorResult<ChatRunStep>) => void> = [];
  private closed = false;
  push(s: ChatRunStep) {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: s, done: false });
    else this.items.push(s);
  }
  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
  }
  next(): Promise<IteratorResult<ChatRunStep>> {
    const s = this.items.shift();
    if (s) return Promise.resolve({ value: s, done: false });
    if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
    return new Promise((r) => this.waiters.push(r));
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });

type ErrorStep = Extract<ChatRunStep, { type: 'error' }>;

export function createAgentSdkChatRunner(opts: ChatRunnerOptions = {}): ChatTurnRunner {
  return (input, host) => runChatTurn(input, host, opts);
}

export async function* runChatTurn(input: ChatTurnInput, host: ChatHost, o: ChatRunnerOptions = {}): AsyncGenerator<ChatRunStep> {
  const log = (e: Omit<ChatRunnerLogEvent, 'messageId'>) => o.logger?.({ messageId: input.messageId, ...e });
  const started = Date.now();
  const modelId = CHAT_MODEL_IDS[input.model] ?? CHAT_MODEL_IDS.sonnet;

  // ---- budget gate (before any model call). Chat is interactive: its own daily line gates it (the
  // global hard cap stops non-interactive calls such as scanners), and every message has its own cap.
  const budget = await host.budget(input.model);
  // "Allow more" on a capped message: a one-time raise of this message's cap, which may also go past the
  // assistant's daily line by the same amount (the user approved it for this message only).
  const extra = Math.max(0, Math.min(5, input.allowExtraUsd ?? 0));
  const dayLeft = budget.chatDailyUsd - budget.chatTodayUsd + extra;
  const offer = (scope: 'message' | 'day') => ({ allowMore: { usd: Math.round(Math.max(0.05, budget.perMessageUsd) * 100) / 100, scope } });
  if (dayLeft <= 0) {
    yield { type: 'error', code: 'budget_exceeded', message: `The assistant's daily limit ($${budget.chatDailyUsd.toFixed(2)}) is used up for today. Allow more for this message, or raise it in Settings > Budgets.`, retryable: false, details: offer('day') };
    return;
  }
  const capUsd = Math.max(0.0001, Math.min(budget.perMessageUsd + extra, dayLeft));

  // ---- prompt
  let systemPrompt: string[];
  let prompt: string;
  let skillTag = 'chat-assistant';
  let persona: ResolvedPersona | null = null;
  /** undefined: the host has no persona (every tool, as before personas); null: it failed to load (gated tools left out). */
  let personaForTools: ResolvedPersona | null | undefined;
  let external: ExternalReads = { servers: {}, allowedTools: [], disallowedTools: [], unavailable: [] };
  try {
    const [pack, history, tz, p] = await Promise.all([host.contextPack(), host.history(input.threadId, [input.userMessageId, input.messageId]), host.timezone(), host.persona ? host.persona().catch(() => null) : Promise.resolve(undefined)]);
    persona = p ?? null;
    personaForTools = p;
    const skill = loadChatSkill(o.repoRoot, o.skillPath);
    skillTag = skill.versionTag;
    // D-58: the scanners' live reads (db + live connectors), for the persona's active sources only.
    const wanted = CHAT_EXTERNAL_CONNECTORS.filter((c) => connectorActive(persona, c));
    if (host.liveReads) external = (o.externalReads ?? scannerReads)(wanted);
    const reads = { live: host.liveReads, slack: external.allowedTools.filter((t) => t.startsWith('mcp__slack__')), org62: external.allowedTools.filter((t) => t.startsWith('mcp__Org62-Sobject-Read__')), unavailable: external.unavailable };
    ({ systemPrompt, prompt } = buildChatPrompt({ skillBody: skill.body, pack, history, context: input.context, text: input.text, now: host.now(), timezone: tz, persona, reads }, SYSTEM_PROMPT_DYNAMIC_BOUNDARY));
  } catch (err) {
    log({ event: 'error', code: 'prompt', detail: safeLogText(errorText(err), 200) });
    yield { type: 'error', code: 'internal', message: `Chat could not build its context: ${safeLogText(errorText(err), 200)}`, retryable: true };
    return;
  }

  // ---- run state
  const queue = new StepQueue();
  const state = newToolState();
  const ac = new AbortController();
  let stop: ErrorStep | null = null;
  const fail = (e: ErrorStep) => {
    if (!stop) stop = e;
    if (!ac.signal.aborted) ac.abort();
  };
  const onUserAbort = () => {
    if (!ac.signal.aborted) ac.abort();
  };
  if (input.signal.aborted) onUserAbort();
  input.signal.addEventListener('abort', onUserAbort, { once: true });

  // The turn's deadline: 180 s, extended by a long tool (chat_research) while it reports progress, never past 7 min.
  const baseMs = o.timeoutMs ?? 180_000;
  const t0 = Date.now();
  let deadline = t0 + baseMs;
  const hardDeadline = t0 + Math.max(baseMs, 420_000);
  const extend = (ms: number) => {
    deadline = Math.min(hardDeadline, Math.max(deadline, Date.now() + ms));
  };
  // ---- spend inside the message cap: the model's messages plus the sub-runs tools start (research, lookups, Find assets)
  let subCost = 0;
  const usageCost = () => [...usageByMsg.values()].reduce((a, u) => a + u.cost, 0);
  const overCap = (what: string) => {
    const est = usageCost() + subCost;
    if (est <= capUsd) return;
    log({ event: 'cost', code: 'cost_cap', costUsd: est, detail: what });
    errorCode = 'cost_cap';
    fail({ type: 'error', code: 'budget_exceeded', message: `Stopped at this message's cost limit ($${capUsd.toFixed(2)}) before it finished.`, retryable: false, details: offer(capUsd < budget.perMessageUsd + extra ? 'day' : 'message') });
  };
  const toolCtx: ChatToolCtx = {
    host,
    input,
    emit: (s) => queue.push(s),
    state,
    signal: ac.signal,
    extend,
    persona,
    budgetLeft: () => capUsd - usageCost() - subCost,
    dayLeft: () => dayLeft - usageCost() - subCost,
    spend: (usd, what) => {
      if (!(usd > 0)) return;
      subCost += usd;
      overCap(what);
    },
    needMore: (usd, what, scope) => {
      log({ event: 'cost', code: 'needs_more', costUsd: usd, detail: what });
      errorCode = 'cost_cap';
      const need = Math.min(5, Math.max(0.05, Math.ceil(usd * 20) / 20));
      const message = scope === 'day' ? `This needs up to $${need.toFixed(2)} more than the assistant's limit for today has left (${what}).` : `This needs up to $${need.toFixed(2)} more than this message's limit ($${capUsd.toFixed(2)}) has left (${what}).`;
      fail({ type: 'error', code: 'budget_exceeded', message, retryable: false, details: { allowMore: { usd: need, scope: scope ?? (capUsd < budget.perMessageUsd + extra ? 'day' : 'message') } } });
    },
  };
  // D-55: the persona's tools and pages only (one stable tool prefix per persona); no persona read: every tool
  const server = buildChatMcpServer(toolCtx, personaForTools);
  // D-58: the scanners' live reads (db + live connectors), for the persona's active sources only.
  const allowedTools = [...chatAllowedToolsFor(personaForTools), ...external.allowedTools];
  const allow = new Set(allowedTools);
  /** The SOQL guardrails on an Org62 query: null = run it as is; a reason = refuse; updatedInput = run the capped one. */
  const soqlCheck = (name: string, input: Record<string, unknown>): { deny: string } | { updatedInput: Record<string, unknown> } | null => {
    if (!isSoqlTool(name)) return null;
    const v = guardSoql(input.q, persona);
    if (!v.ok) {
      log({ event: 'denied', tool: name, code: 'soql_guard', detail: v.reason });
      return { deny: `SOQL refused: ${v.reason}` };
    }
    return v.capped ? { updatedInput: { ...input, q: v.q } } : null;
  };
  const guard = (tool: string, where: string): 'allow' | 'abort' | 'unknown' => {
    if (allow.has(tool)) return 'allow';
    if (isRealTool(tool)) {
      log({ event: 'denied', tool, code: where });
      fail({ type: 'error', code: 'internal', message: `Stopped: the assistant tried a tool outside the chat allowlist (${tool}). Nothing was changed.`, retryable: false });
      return 'abort';
    }
    log({ event: 'denied', tool, code: `unknown_tool_name:${where}` });
    return 'unknown';
  };
  const preToolUse: HookCallback = async (h) => {
    if (h.hook_event_name !== 'PreToolUse') return {};
    const g = guard(h.tool_name, 'pre_tool_use');
    if (g === 'allow') {
      log({ event: 'tool', tool: h.tool_name });
      const sq = soqlCheck(h.tool_name, (h.tool_input ?? {}) as Record<string, unknown>);
      if (sq && 'deny' in sq) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: sq.deny } };
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', ...(sq ? { updatedInput: sq.updatedInput } : {}) } };
    }
    const deny = { hookEventName: 'PreToolUse' as const, permissionDecision: 'deny' as const, permissionDecisionReason: 'not on the chat allowlist' };
    return g === 'abort' ? { continue: false, stopReason: 'disallowed tool', hookSpecificOutput: deny } : { hookSpecificOutput: deny };
  };
  const canUseTool: CanUseTool = async (name, toolInput) => {
    const g = guard(name, 'can_use_tool');
    if (g !== 'allow') return { behavior: 'deny', message: 'not on the chat allowlist', interrupt: g === 'abort' };
    const sq = soqlCheck(name, toolInput);
    if (sq && 'deny' in sq) return { behavior: 'deny', message: sq.deny };
    return sq ? { behavior: 'allow', updatedInput: sq.updatedInput } : { behavior: 'allow' };
  };

  const cwd = o.cwd ?? defaultChatCwd();
  const gateway = o.gateway ?? (o.queryFn ? { env: {} } : claudeGatewayConfig());
  if (!o.queryFn) fs.mkdirSync(cwd, { recursive: true });
  let stderrTail = '';
  const options: Options = {
    model: modelId,
    effort: o.effort ?? 'low',
    tools: [],
    mcpServers: { [CHAT_SERVER_NAME]: server, ...(external.servers as Options['mcpServers']) },
    strictMcpConfig: true,
    allowedTools,
    ...(external.disallowedTools.length ? { disallowedTools: external.disallowedTools } : {}),
    permissionMode: 'dontAsk',
    canUseTool,
    hooks: { PreToolUse: [{ hooks: [preToolUse] }] },
    settingSources: o.settingSources ?? ['user'],
    skills: [],
    persistSession: false,
    includePartialMessages: true,
    maxTurns: budget.maxTurns,
    maxBudgetUsd: capUsd,
    systemPrompt,
    env: o.env ?? scannerEnv(gateway.env, process.env, { CLAUDE_AGENT_SDK_CLIENT_APP: 'control-center-chat/1' }),
    ...(gateway.apiKeyHelper ? { settings: { apiKeyHelper: gateway.apiKeyHelper } } : {}),
    cwd,
    pathToClaudeCodeExecutable: o.pathToClaudeCodeExecutable ?? defaultClaudeExecutable(),
    abortController: ac,
    stderr: (d: string) => {
      stderrTail = (stderrTail + d).slice(-4000);
    },
  };

  // ---- usage accounting
  const usageByMsg = new Map<string, { cost: number; input: number; output: number; cacheRead: number; cacheWrite: number }>();
  const final = { costUsd: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, turns: 0, fromResult: false };
  const estimate = () => [...usageByMsg.values()].reduce((a, u) => ({ cost: a.cost + u.cost, input: a.input + u.input, output: a.output + u.output, cacheRead: a.cacheRead + u.cacheRead, cacheWrite: a.cacheWrite + u.cacheWrite }), { cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

  // ---- text streaming (partial messages; full assistant messages only when nothing streamed)
  const streamed = new Set<string>();
  let curStreamMsg: string | null = null;
  let lastTextMsg: string | null = null;
  let textSoFar = '';
  const pushText = (msgId: string, t: string) => {
    if (!t) return;
    if (lastTextMsg && lastTextMsg !== msgId && textSoFar && !textSoFar.endsWith('\n')) {
      queue.push({ type: 'text', text: '\n\n' });
      textSoFar += '\n\n';
    }
    lastTextMsg = msgId;
    textSoFar += t;
    queue.push({ type: 'text', text: t });
  };

  // ---- scan follow
  let modelDone = false;
  const followScans = async () => {
    const seen = new Map<string, string>();
    let deadline = Number.POSITIVE_INFINITY;
    for (;;) {
      if (ac.signal.aborted && stop) return;
      if (input.signal.aborted) return;
      const pending = [...state.scans.values()].filter((s) => !s.done);
      if (modelDone) {
        if (!pending.length) return;
        if (deadline === Number.POSITIVE_INFINITY) deadline = Date.now() + (o.scanFollowMs ?? 15_000);
        if (Date.now() >= deadline) return;
      }
      for (const s of pending) {
        try {
          const cur = await host.scanStatus(s.id);
          if (!cur) continue;
          const key = `${cur.status}|${cur.itemsSeen}|${cur.itemsNew}|${cur.itemsChanged}`;
          if (seen.get(s.id) !== key) {
            seen.set(s.id, key);
            if (key !== `${s.status}|${s.itemsSeen}|${s.itemsNew}|${s.itemsChanged}`) {
              state.scans.set(cur.id, cur);
              const row = state.scanRows.get(cur.id);
              if (row) {
                queue.push({ type: 'tool-progress', id: row, ...scanProgress(cur) });
                if (cur.done) {
                  queue.push({ type: 'tool-result', id: row, summary: cur.summary, ok: cur.status === 'ok' || cur.status === 'partial', result: JSON.stringify({ scanId: cur.id, status: cur.status, itemsSeen: cur.itemsSeen, itemsNew: cur.itemsNew, itemsChanged: cur.itemsChanged }) });
                  state.scanRows.delete(cur.id);
                }
              }
              log({ event: 'scan', code: cur.status });
            }
          }
        } catch {
          /* a failed poll is retried next tick */
        }
      }
      await sleep(o.scanPollMs ?? 1500, modelDone ? input.signal : undefined);
    }
  };

  const watchdog = setInterval(() => {
    if (Date.now() > deadline) fail({ type: 'error', code: 'upstream_unavailable', message: `The assistant took longer than ${Math.round((deadline - t0) / 1000)} s and was stopped.`, retryable: true });
  }, Math.min(1000, Math.max(10, Math.floor(baseMs / 4))));
  log({ event: 'start', detail: `model=${modelId} cap=$${capUsd.toFixed(4)} turns=${budget.maxTurns}` });
  const q = (o.queryFn ?? (sdkQuery as unknown as ChatQueryFn))({ prompt, options });
  let errorCode: string | undefined;

  const pump = (async () => {
    const follower = followScans();
    try {
      for await (const msg of q) {
        if (msg.type === 'stream_event') {
          const ev = msg.event as { type: string; message?: { id?: string }; delta?: { type: string; text?: string } };
          if (ev.type === 'message_start') curStreamMsg = ev.message?.id ?? `stream-${streamed.size}`;
          else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text && msg.parent_tool_use_id == null) {
            const id = curStreamMsg ?? 'stream';
            streamed.add(id);
            pushText(id, ev.delta.text);
          }
        } else if (msg.type === 'assistant') {
          const m = msg.message as unknown as { id?: string; model?: string; content?: Array<{ type: string; name?: string; text?: string }>; usage?: Record<string, number | null> };
          const mid = m.id ?? `anon-${usageByMsg.size}`;
          for (const b of m.content ?? []) {
            if (b.type === 'tool_use' && b.name) guard(b.name, 'assistant_tool_use');
            else if (b.type === 'text' && b.text && !streamed.has(mid) && msg.parent_tool_use_id == null) pushText(mid, b.text);
          }
          const errCode = (msg as { error?: string }).error;
          if (errCode) fail({ type: 'error', code: 'upstream_unavailable', message: errCode === 'authentication_failed' ? 'The LLM gateway rejected the key (re-auth the gateway)' : `The model returned an error (${errCode})`, retryable: errCode !== 'authentication_failed' });
          if (m.usage) {
            const u = m.usage;
            usageByMsg.set(mid, { cost: estimateCallCostUsd(m.model ?? modelId, u), input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 });
            overCap('model');
          }
        } else if (msg.type === 'result') {
          final.fromResult = true;
          final.costUsd = msg.total_cost_usd ?? 0;
          final.turns = msg.num_turns ?? 0;
          const mu = Object.values(msg.modelUsage ?? {});
          if (mu.length) {
            final.inputTokens = mu.reduce((a, u) => a + u.inputTokens, 0);
            final.outputTokens = mu.reduce((a, u) => a + u.outputTokens, 0);
            final.cacheRead = mu.reduce((a, u) => a + u.cacheReadInputTokens, 0);
            final.cacheWrite = mu.reduce((a, u) => a + u.cacheCreationInputTokens, 0);
          } else {
            const u = msg.usage as unknown as Record<string, number | undefined>;
            final.inputTokens = u?.input_tokens ?? 0;
            final.outputTokens = u?.output_tokens ?? 0;
            final.cacheRead = u?.cache_read_input_tokens ?? 0;
            final.cacheWrite = u?.cache_creation_input_tokens ?? 0;
          }
          for (const d of msg.permission_denials ?? []) guard(d.tool_name, 'permission_denial');
          if (msg.subtype === 'success') {
            if (msg.is_error) {
              const c = classifyError(msg.result);
              errorCode = c.code;
              fail({ type: 'error', code: 'upstream_unavailable', message: c.errorClass === 'auth' ? 'The LLM gateway rejected the request (auth). Check the gateway / apiKeyHelper.' : `The model call failed (${c.code}).`, retryable: c.errorClass !== 'auth' });
            }
          } else if (msg.subtype === 'error_max_budget_usd') {
            errorCode = 'cost_cap';
            fail({ type: 'error', code: 'budget_exceeded', message: `Stopped at this message's cost limit ($${capUsd.toFixed(2)}) before it finished.`, retryable: false, details: offer(capUsd < budget.perMessageUsd + extra ? 'day' : 'message') });
          } else if (msg.subtype === 'error_max_turns') {
            errorCode = 'max_turns';
            fail({ type: 'error', code: 'internal', message: `Stopped after ${budget.maxTurns} steps without finishing. Ask a narrower question.`, retryable: true });
          } else {
            const text = (msg.errors ?? []).join(' | ') || stderrTail;
            const c = classifyError(text);
            errorCode = c.code;
            fail({ type: 'error', code: 'upstream_unavailable', message: `The assistant failed (${c.code}).`, retryable: true });
          }
          log({ event: 'result', code: msg.subtype, costUsd: final.costUsd });
        }
      }
    } catch (err) {
      if (!stop && !input.signal.aborted) {
        const c = classifyError(`${errorText(err)} ${stderrTail}`);
        errorCode = c.code;
        const message =
          c.code === 'executable_missing' ? 'The Claude CLI was not found (set CC_CLAUDE_BIN).' : c.errorClass === 'auth' ? 'The LLM gateway rejected the request (auth).' : `The assistant is unavailable (${c.code}).`;
        fail({ type: 'error', code: 'upstream_unavailable', message, retryable: c.errorClass !== 'auth' && c.errorClass !== 'config' });
      }
    } finally {
      modelDone = true;
      clearInterval(watchdog);
      try {
        q.close?.();
      } catch {
        /* already closed */
      }
      await follower.catch(() => undefined);
      // scans still running when the turn ends: close their rows (they continue; the thread read refreshes them)
      if (!input.signal.aborted) {
        for (const [scanId, row] of state.scanRows) {
          const s = state.scans.get(scanId);
          queue.push({ type: 'tool-result', id: row, summary: `${s?.summary ?? 'Scan queued'}; it continues in the background (Health)`, ok: true, result: JSON.stringify({ scanId, status: s?.status ?? 'queued' }) });
        }
        state.scanRows.clear();
      }
      const est = estimate();
      const usage: ChatUsageRecord = {
        threadId: input.threadId,
        messageId: input.messageId,
        model: modelId,
        inputTokens: final.fromResult ? final.inputTokens : est.input,
        outputTokens: final.fromResult ? final.outputTokens : est.output,
        cacheReadTokens: final.fromResult ? final.cacheRead : est.cacheRead,
        cacheWriteTokens: final.fromResult ? final.cacheWrite : est.cacheWrite,
        costUsd: final.fromResult && final.costUsd > 0 ? final.costUsd : est.cost,
        estimated: !(final.fromResult && final.costUsd > 0),
        status: stop ? ((stop as ErrorStep).code === 'budget_exceeded' ? 'budget_blocked' : 'error') : input.signal.aborted ? 'error' : 'ok',
        ...(errorCode ? { errorCode } : input.signal.aborted ? { errorCode: 'aborted' } : {}),
        latencyMs: Date.now() - started,
        skill: skillTag,
      };
      try {
        await host.recordUsage(usage);
      } catch (err) {
        log({ event: 'error', code: 'record_usage', detail: safeLogText(errorText(err), 160) });
      }
      if (!input.signal.aborted) {
        queue.push({ type: 'usage', usage: { model: modelId, inputTokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens, outputTokens: usage.outputTokens, costUsd: Math.round(usage.costUsd * 1e6) / 1e6, turns: final.turns } });
        if (stop) queue.push(stop);
      }
      input.signal.removeEventListener('abort', onUserAbort);
      queue.close();
    }
  })();

  try {
    for (;;) {
      const r = await queue.next();
      if (r.done) break;
      yield r.value;
    }
  } finally {
    // The consumer left early (Stop / new message / client gone): abort the query; the pump records usage.
    if (!ac.signal.aborted) ac.abort();
    await pump.catch(() => undefined);
  }
}
