/**
 * AgentSdkSkillRunner: one Agent SDK `query()` per scan step (SCANNER.md §2, §3, §7; brief 09 §3–§5).
 *
 * Guarantees:
 *  - Loads ONLY the given MCP server(s) plus the in-process `cc` server (`strictMcpConfig`, `tools: []`).
 *  - Exact allowlist, enforced by the `canUseTool` gate: no bare `allowedTools` (they auto-approve a tool before the
 *    callback runs; the SDK warned CLAUDE_SDK_CAN_USE_TOOL_SHADOWED) and no hook `allow`, so every call reaches the
 *    gate. Any call to anything else aborts the whole run with `error.disallowedTool`, via the PreToolUse hook
 *    (deny only, fires first), the gate, a scan of assistant `tool_use` blocks, and the result's `permission_denials`.
 *    Everything outside the allowlist is also in `disallowedTools`, so it is never in the model's context.
 *  - `permissionMode: 'default'` with the gate as the only approver: the user's default `auto` classifier never runs.
 *  - Budget: `maxTurns`, `maxBudgetUsd` (SDK) plus a running estimate from per-message usage that aborts
 *    as soon as the cap is crossed, a prefix tripwire (first-call prompt > 40 K tokens plus the prefetched payload), a watchdog.
 *  - AbortSignal propagation; clean env (never inherits CLAUDE_CODE_* from a parent Claude).
 *  - Skill text + context pack go in the system prompt (cacheable), the Run block in the user prompt.
 *  - Cost and tokens come from the result message (`total_cost_usd`, `modelUsage`).
 *  - Errors are classified auth | transient | rate_limited | config | unknown (brief 09 signatures).
 *  - Logs carry ids, tool names and codes only; no bodies, no secrets.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  BUILTIN_TOOL_NAMES,
  query as sdkQuery,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  type CanUseTool,
  type EffortLevel,
  type HookCallback,
  type McpServerConfig,
  type Options,
  type SDKMessage,
  type SettingSource,
} from '@anthropic-ai/claude-agent-sdk';
import type { CoverageObject, ScannerStore, SkillRunInput, SkillRunner, TimeWindow } from '../scanner/types';
import type { ScanSkillRunResult, ScannerStoreWithBriefs } from '../scanner/runtime/contract-ext';
import { buildCcServer, CC_SERVER_NAME, CC_TOOL_NAMES, CC_TRIAGE_TOOL_NAMES, ccToolFullName, createCcHandlers, createRunState, parseHighlightsBlock, type CcRunState, type CcToolName } from './cc-tools';
import { conversationRefs, renderTriageBatch, selectSlackTriage, TRIAGE_CONTEXT, triageConversationKey, type PriorVerdict, type TriageBatch, type TriageConfig, type TriageLine } from '../scanner/triage/slack-triage';
import { bareToolName, SlackAutoRecorder } from './slack-rec';
import { Org62AutoRecorder } from './org62-rec';
import { Org62PageObserver } from './org62-pages';
import { ownCoverageHole } from './cc-tools/handlers';
import { claudeGatewayConfig, scannerEnv, type GatewayConfig } from './claude-env';
import { defaultClaudeExecutable, defaultScannerCwd } from './env';
import { classifyError, classifyMcpStatus, errorText, type ErrorClass } from './errors';
import { assertReadOnly, disallowedFor, ORG62_ALL_TOOLS, SLACK_ALL_TOOLS } from './mcp-config';
import { estimateCallCostUsd } from './models';
import { addUsage, usageFromBlock, usageFromModelUsage, type UsageTotals } from './usage';
import { ledgerHash } from '../db/ledger';
import { safeLogText } from './redact';
import { commonSkillPathFor, loadSkill, renderPrefetched, renderRunBlock, scannerSystemPrompt, soqlDateTime } from './skill-loader';
import { trace } from '../scanner/trace';

/**
 * Prefix tripwire (TRIP-2). The first call's prompt is what we send (common rules + skill + context pack + run block +
 * prefetched payload) plus what we do not see: the SDK system prompt and the tool schemas (cc tools + the restricted MCP
 * server's read tools). Measured on the first live day: Org62 events sent 75.7 K characters and the first call was
 * 43.0 K tokens; a Slack channel sent 68.4 K and was 41.9 K. So the hidden part is about 13-19 K tokens and our text
 * about 2.5-3 characters per token (prose about 3.5, JSON about 2.1). The limit is that allowance plus our prose at 2 and
 * our data at 1.8 characters per token, which leaves 15-20 K tokens of headroom on real prompts (a full 25-email Gmail
 * run was 78.6 K tokens live; its limit is now about 97 K) and still trips when the restricted config fails and every MCP tool loads
 * (tens of thousands of tokens of schemas). Before, a flat 40 K base (plus the payload, G-3) was calibrated on stress
 * databases: a real user's growing list and today's larger skills put Slack channels, Org62 events, Claude sessions and
 * Calendar over it on every run (CTX-1, TRIP-2).
 */
/** ORG-3: the windowed Org62 scopes (SystemModstamp windows paged by LIMIT). */
const ORG62_WINDOWED = new Set(['opps', 'events', 'dcs']);

export const TOOL_OVERHEAD_TOKENS = 24_000;
/** Prose (common rules + skill) tokenizes at about 3.5 characters per token, JSON data (pack, payload) at about 2.1. */
const PROSE_CHARS_PER_TOKEN = 2;
const DATA_CHARS_PER_TOKEN = 1.8;

export function prefixTripwireLimit(sent: { proseChars: number; dataChars: number }, overheadTokens = TOOL_OVERHEAD_TOKENS): number {
  return overheadTokens + Math.ceil(sent.proseChars / PROSE_CHARS_PER_TOKEN + sent.dataChars / DATA_CHARS_PER_TOKEN);
}

/** SkillRunInput plus what the runtime knows about the step. All extra fields are optional. */
export interface ScanSkillRunInput extends SkillRunInput {
  window?: TimeWindow;
  /** incremental | head | backfill | continuation | reconcile | relink | targeted */
  mode?: string;
  /** Extra Run-block substitutions (channel id, thread ref, opp ids…). */
  vars?: Record<string, string | number | boolean | undefined>;
  /** Free-form step instruction appended to the user prompt (e.g. which unlinked items to relink). */
  instruction?: string;
  effort?: EffortLevel;
  /**
   * Deterministic sources: coverage the fetcher already established. The runner stages it on the run
   * (and in the cc state, so `cc_finish` validates against it); the agent does not report it again.
   */
  preReportedCoverage?: CoverageObject[];
  /** REC-1: record every message the Slack read tools return (src/llm/slack-rec.ts). */
  autoRecord?: 'slack' | 'org62';
  /** After a successful traversal: the Slack triage pass (+ escalation of unsure verdicts). */
  triage?: TriageConfig;
  /** Internal: this run is a post-traversal pass on the parent's run (no recording, no coverage, no cc_finish). */
  pass?: 'triage' | 'escalate';
}

/** Per-pass accounting of one scan run (traversal, triage batches, escalation batches). */
export interface SkillPassStat {
  pass: 'traversal' | 'triage' | 'escalate';
  model: string;
  runs: number;
  costUsd: number;
  /** Messages that needed a verdict (triage) / were escalated (escalate). */
  messages?: number;
  verdicts?: { act: number; noise: number; unsure: number; missing: number };
  proposed?: number;
  linked?: number;
  /** REC-1 (traversal): messages recorded from tool results / parse failures. */
  autoRecorded?: number;
  recErrors?: number;
  errors?: string[];
}

export type ScanSkillRunResultWithPasses = ScanSkillRunResult & { passes?: SkillPassStat[] };

export type QueryFn = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage> & { close?: () => void };

export interface RunnerLogEvent {
  runId: string;
  event: 'start' | 'init' | 'tool' | 'denied' | 'cost' | 'result' | 'error';
  tool?: string;
  code?: string;
  detail?: string;
  costUsd?: number;
}

export interface AgentSdkSkillRunnerOptions {
  repoRoot?: string;
  queryFn?: QueryFn;
  pathToClaudeCodeExecutable?: string;
  cwd?: string;
  env?: Record<string, string>;
  effort?: EffortLevel;
  settingSources?: SettingSource[];
  /** Watchdog per run (ms). Default 180 s. */
  timeoutMs?: number;
  /** Tool-schema + SDK allowance of the prefix tripwire, added to the size of what is sent (TRIP-2). Default TOOL_OVERHEAD_TOKENS. */
  prefixTripwireTokens?: number;
  logger?: (e: RunnerLogEvent) => void;
  /** Gateway env + apiKeyHelper (default: read from ~/.claude/settings.json; see claude-env.ts). */
  gateway?: GatewayConfig;
}

interface ErrorState {
  message: string;
  errorClass: ErrorClass;
  disallowedTool?: string;
  code: string;
}

export class AgentSdkSkillRunner implements SkillRunner {
  private readonly o: Required<Pick<AgentSdkSkillRunnerOptions, 'timeoutMs' | 'prefixTripwireTokens'>> & AgentSdkSkillRunnerOptions;

  constructor(opts: AgentSdkSkillRunnerOptions = {}) {
    // 40 K: the fixed prefix (skill + bounded context pack + tool schemas) is ~34 K for Calendar with a real-sized
    // context pack, so 32 K tripped every Calendar run once (stress finding TRIP-1). A real blow-up is far larger.
    this.o = { timeoutMs: 180_000, prefixTripwireTokens: TOOL_OVERHEAD_TOKENS, ...opts };
  }

  async run(input: ScanSkillRunInput, store: ScannerStore): Promise<ScanSkillRunResultWithPasses> {
    const { result, state, rec } = await this.runOnce(input, store);
    const out: ScanSkillRunResultWithPasses = result;
    out.passes = [{ pass: 'traversal', model: input.model, runs: 1, costUsd: result.costUsd, ...(rec ? { autoRecorded: rec.stats.recorded, recErrors: rec.stats.errors } : {}) }];
    if (!result.ok || !input.triage || input.pass || input.signal.aborted) return out;
    try {
      await this.runTriage(input, store, state, out);
    } catch (err) {
      // A triage failure never fails the traversal run: its writes so far stay, the rest is the traversal's outcome.
      this.o.logger?.({ runId: input.runId, event: 'error', code: 'triage_failed', detail: safeLogText(errorText(err), 200) });
    }
    return out;
  }

  /**
   * Triage pass: batches of this run's messages to / from me (DMs, group DMs, my threads), each message one verdict.
   * `unsure` verdicts (and messages left without any verdict or outcome) go to the escalation model; without one
   * they are flagged unlinked so they surface in Triage instead of vanishing.
   */
  private async runTriage(input: ScanSkillRunInput, store: ScannerStore, state: CcRunState, out: ScanSkillRunResultWithPasses): Promise<void> {
    const cfg = input.triage!;
    const log = (e: Omit<RunnerLogEvent, 'runId'>) => this.o.logger?.({ runId: input.runId, ...e });
    const sel = await this.selectWithContext(input, store, state, cfg);
    const tri: SkillPassStat = { pass: 'triage', model: cfg.model, runs: 0, costUsd: 0, messages: sel.needing - sel.dropped, verdicts: { act: 0, noise: 0, unsure: 0, missing: 0 }, proposed: 0, linked: 0, errors: [] };
    out.passes!.push(tri);
    log({ event: 'start', code: 'triage', detail: `qualifying=${sel.qualifying} needing=${sel.needing} trivial=${sel.trivial} handled=${sel.handled} batches=${sel.batches.length} dropped=${sel.dropped}` });
    const ids = (xs: string[] | undefined) => (xs ?? []).slice(0, 200);
    trace(input.runId, 'triage_select', () => ({ qualifying: sel.qualifying, needing: sel.needing, trivial: sel.trivial, handled: sel.handled, batches: sel.batches.length, dropped: sel.dropped, model: cfg.model, escalateModel: cfg.escalateModel ?? null, trivialIds: ids(sel.decisions?.trivial), handledIds: ids(sel.decisions?.handled), skippedIds: ids(sel.decisions?.skipped), droppedIds: ids(sel.decisions?.dropped) }));
    if (!sel.batches.length) return;
    const unsure: Array<{ batch: TriageBatch; lines: Map<string, string | undefined> }> = [];
    const passInput = (pass: 'triage' | 'escalate', model: string, cap: number, instruction: string): ScanSkillRunInput => ({
      skillPath: cfg.skillPath,
      model,
      mcpServers: {},
      allowedTools: [],
      runId: input.runId,
      context: input.context,
      maxTurns: cfg.maxTurns,
      costCapUsd: cap,
      signal: input.signal,
      window: input.window,
      mode: pass,
      vars: input.vars,
      instruction,
      pass,
    });
    const absorb = (s: SkillPassStat, r: ScanSkillRunResult) => {
      s.runs += 1;
      s.costUsd += r.costUsd;
      s.proposed! += r.counts?.proposed ?? 0;
      s.linked! += r.counts?.linked ?? 0;
      if (!r.ok && r.error) s.errors!.push(safeLogText(r.error.message, 120));
      out.costUsd += r.costUsd;
      out.inputTokens += r.inputTokens;
      out.outputTokens += r.outputTokens;
      out.cacheReadTokens = (out.cacheReadTokens ?? 0) + (r.cacheReadTokens ?? 0);
      out.cacheWriteTokens = (out.cacheWriteTokens ?? 0) + (r.cacheWriteTokens ?? 0);
      out.usage = addUsage({ ...EMPTY_ROW, byModel: out.usage ?? [] }, { ...EMPTY_ROW, byModel: r.usage ?? [] }).byModel;
      out.turns += r.turns;
      if (out.counts && r.counts) {
        out.counts.proposed += r.counts.proposed;
        out.counts.linked += r.counts.linked;
        out.counts.unlinked += r.counts.unlinked;
      }
    };
    const needing = (b: TriageBatch) => b.conversations.flatMap((c) => c.lines.filter((l) => l.needs));
    for (const [i, b] of sel.batches.entries()) {
      if (input.signal.aborted) return;
      const r = await this.runOnce(passInput('triage', cfg.model, cfg.costCapUsdPerBatch, renderTriageBatch(b, input.context, { index: i + 1, total: sel.batches.length })), store, state);
      absorb(tri, r.result);
      const left = new Map<string, string | undefined>();
      for (const l of needing(b)) {
        const v = r.state.verdicts.get(l.sourceItemId);
        const acted = state.outcomes.get(l.sourceItemId)?.some((d) => !d.startsWith('context:'));
        if (v) tri.verdicts![v.v] += 1;
        else if (acted) tri.verdicts!.act += 1;
        else tri.verdicts!.missing += 1;
        if (v?.v === 'unsure' || (!v && !acted)) left.set(l.sourceItemId, v?.why);
        trace(input.runId, 'verdict', () => ({ pass: 'triage', batch: i + 1, ref: l.ref, v: v?.v ?? (acted ? 'act' : 'missing'), why: v?.why ?? null, acted: actedOn(state, l.sourceItemId), escalate: left.has(l.sourceItemId) && !!cfg.escalateModel, ok: r.result.ok }), { sourceItemId: l.sourceItemId });
      }
      if (left.size) unsure.push({ batch: b, lines: left });
      await this.saveVerdicts(store, r.state.verdicts, log);
    }
    const pending = unsure.reduce((a, u) => a + u.lines.size, 0);
    if (!pending) return;
    // D6: past today's escalation allowance, unsure lines go to Triage (flagged) instead of the stronger model.
    const overAllowance = !!cfg.escalateModel && cfg.escalateLeftUsd !== undefined && cfg.escalateLeftUsd < cfg.escalateCostCapUsd;
    if (overAllowance) {
      trace(input.runId, 'triage_select', () => ({ escalation: 'day_cap', leftUsd: cfg.escalateLeftUsd ?? null, pending }));
      await store.recordDecision?.({ skill: triageSkillKeyOf(cfg), kind: 'block', reason: 'escalation_day_cap', trigger: input.mode ?? null, subject: `${input.context.scope.connector}:${input.context.scope.scope}`, count: pending, detail: { leftUsd: cfg.escalateLeftUsd ?? null, runId: input.runId } });
    }
    if (!cfg.escalateModel || overAllowance) {
      const flag = createCcHandlers(store, { ...createRunState({ runId: input.runId, connector: state.connector, window: state.window, context: input.context }), pass: 'triage' } as CcRunState);
      for (const u of unsure) {
        for (const [sid, why] of u.lines) {
          await flag.cc_flag_unlinked({ sourceItemId: sid, reason: `unsure: ${why ?? 'triage could not tell whether this asks or promises something'}` }).catch(() => undefined);
          if (out.counts) out.counts.unlinked += 1;
        }
      }
      return;
    }
    // Escalation: the same conversations, only the unsure lines need a verdict, packed into batches again.
    const esc: SkillPassStat = { pass: 'escalate', model: cfg.escalateModel, runs: 0, costUsd: 0, messages: pending, verdicts: { act: 0, noise: 0, unsure: 0, missing: 0 }, proposed: 0, linked: 0, errors: [] };
    out.passes!.push(esc);
    const escBatches: TriageBatch[] = [];
    for (const u of unsure) {
      const conversations = u.batch.conversations
        .map((c) => ({ ...c, lines: c.lines.map((l): TriageLine => (u.lines.has(l.sourceItemId) ? { ...l, needs: true, unsureWhy: u.lines.get(l.sourceItemId) } : { ...l, needs: false })) }))
        .filter((c) => c.lines.some((l) => l.needs));
      const n = conversations.reduce((a, c) => a + c.lines.filter((l) => l.needs).length, 0);
      const last = escBatches[escBatches.length - 1];
      if (last && last.needs + n <= cfg.batchSize) {
        last.conversations.push(...conversations);
        last.needs += n;
      } else escBatches.push({ conversations, needs: n });
    }
    let escLeft = cfg.escalateLeftUsd ?? Infinity;
    for (const [i, b] of escBatches.entries()) {
      if (input.signal.aborted) return;
      if (escLeft < cfg.escalateCostCapUsd) {
        // D6: the allowance ran out mid-run: the remaining unsure lines go to Triage.
        const rest = escBatches.slice(i);
        const n = rest.reduce((a, x) => a + needing(x).length, 0);
        await store.recordDecision?.({ skill: triageSkillKeyOf(cfg), kind: 'block', reason: 'escalation_day_cap', trigger: input.mode ?? null, subject: `${input.context.scope.connector}:${input.context.scope.scope}`, count: n, detail: { leftUsd: escLeft, runId: input.runId } });
        const flag = createCcHandlers(store, { ...createRunState({ runId: input.runId, connector: state.connector, window: state.window, context: input.context }), pass: 'triage' } as CcRunState);
        for (const x of rest) for (const l of needing(x)) await flag.cc_flag_unlinked({ sourceItemId: l.sourceItemId, reason: `unsure: ${l.unsureWhy ?? 'triage could not tell whether this asks or promises something'}` }).catch(() => undefined);
        if (out.counts) out.counts.unlinked += n;
        break;
      }
      const r = await this.runOnce(passInput('escalate', cfg.escalateModel, Math.min(cfg.escalateCostCapUsd, escLeft), renderTriageBatch(b, input.context, { index: i + 1, total: escBatches.length, escalate: true })), store, state);
      absorb(esc, r.result);
      escLeft -= r.result.costUsd;
      for (const l of needing(b)) {
        const v = r.state.verdicts.get(l.sourceItemId);
        const acted = state.outcomes.get(l.sourceItemId)?.some((d) => !d.startsWith('context:'));
        if (v) esc.verdicts![v.v] += 1;
        else if (acted) esc.verdicts!.act += 1;
        else esc.verdicts!.missing += 1;
        trace(input.runId, 'verdict', () => ({ pass: 'escalate', batch: i + 1, ref: l.ref, v: v?.v ?? (acted ? 'act' : 'missing'), why: v?.why ?? null, acted: actedOn(state, l.sourceItemId), final: true, ok: r.result.ok }), { sourceItemId: l.sourceItemId });
      }
      await this.saveVerdicts(store, r.state.verdicts, log);
    }
    log({ event: 'result', code: 'escalate', detail: `escalated=${pending} batches=${escBatches.length}`, costUsd: esc.costUsd });
  }

  /**
   * TRI-NOISE + TRI-CTX: select with earlier runs' verdicts carried forward (a message called noise before is context
   * now), then add each selected conversation's lines from earlier runs (the last few before this run's first line and
   * the replies after its last, any window) and select again. A store without these reads gives the plain selection.
   */
  private async selectWithContext(input: ScanSkillRunInput, store: ScannerStore, state: CcRunState, cfg: TriageConfig) {
    const ids = [...state.items.entries()].filter(([, it]) => it.connector === 'slack' && it.kind === 'message').map(([k]) => state.recorded.get(k)).filter((x): x is string => !!x);
    let prior: Map<string, PriorVerdict> | undefined;
    try {
      prior = ids.length ? await store.triageVerdicts?.(ids) : undefined;
    } catch {
      prior = undefined;
    }
    const first = selectSlackTriage(state.items, state.recorded, state.outcomes, input.context, cfg, { prior });
    if (!store.conversationLines || !first.batches.length) return first;
    const extra = new Map<string, TriageLine[]>();
    for (const c of conversationRefs(first)) {
      try {
        const rows = await store.conversationLines({ channelId: c.channelId, threadRef: c.threadRef, before: { at: c.firstAt, limit: TRIAGE_CONTEXT.before }, after: { at: c.lastAt, limit: TRIAGE_CONTEXT.after } });
        const lines = rows.filter((r) => triageConversationKey(r.item) === c.key).map((r): TriageLine => ({ ref: r.item.externalId, sourceItemId: r.sourceItemId, item: r.item, needs: false, earlier: true }));
        if (lines.length) extra.set(c.key, lines);
      } catch {
        /* context is best effort: the batch still has this run's lines */
      }
    }
    if (!extra.size) return first;
    trace(input.runId, 'triage_context', () => ({ conversations: extra.size, lines: [...extra.values()].reduce((a, l) => a + l.length, 0) }));
    return selectSlackTriage(state.items, state.recorded, state.outcomes, input.context, cfg, { prior, extra });
  }

  /** TRI-NOISE: a pass's verdicts go onto their messages (best effort: a failure never fails the run). */
  private async saveVerdicts(store: ScannerStore, verdicts: Map<string, { v: 'act' | 'noise' | 'unsure'; why?: string }>, log: (e: Omit<RunnerLogEvent, 'runId'>) => void) {
    if (!store.recordTriageVerdicts || !verdicts.size) return;
    try {
      await store.recordTriageVerdicts([...verdicts].map(([sourceItemId, v]) => ({ sourceItemId, v: v.v, ...(v.why ? { why: v.why } : {}) })));
    } catch (err) {
      log({ event: 'error', code: 'triage_verdicts_not_saved', detail: safeLogText(errorText(err), 160) });
    }
  }

  /** One Agent SDK query, traced as a `pass` (model, outcome, cost, tokens, counts). */
  private async runOnce(input: ScanSkillRunInput, store: ScannerStore, parent?: CcRunState): Promise<{ result: ScanSkillRunResult; state: CcRunState; rec?: SlackAutoRecorder | Org62AutoRecorder }> {
    const t0 = Date.now();
    const out = await this.runOnceInner(input, store, parent);
    const r = out.result;
    trace(input.runId, 'pass', () => ({ pass: input.pass ?? 'traversal', mode: input.mode ?? 'incremental', model: input.model, ok: r.ok, errorClass: r.error?.errorClass ?? null, error: r.error ? r.error.message : null, costUsd: r.costUsd, inputTokens: r.inputTokens, outputTokens: r.outputTokens, cacheReadTokens: r.cacheReadTokens ?? 0, cacheWriteTokens: r.cacheWriteTokens ?? 0, contentHash: r.contentHash ?? null, ...(r.usage && r.usage.length > 1 ? { usage: r.usage } : {}), turns: r.turns, ms: Date.now() - t0, counts: r.counts ?? null, ...(out.rec ? { rec: { ...out.rec.stats } } : {}), finished: !!out.state.finished, complete: r.complete ?? null }));
    return out;
  }

  /** One Agent SDK query. `parent`: a post-traversal pass shares the traversal's recorded items and outcomes. */
  private async runOnceInner(input: ScanSkillRunInput, store: ScannerStore, parent?: CcRunState): Promise<{ result: ScanSkillRunResult; state: CcRunState; rec?: SlackAutoRecorder | Org62AutoRecorder }> {
    const log = (e: Omit<RunnerLogEvent, 'runId'>) => this.o.logger?.({ runId: input.runId, ...e });
    const window: TimeWindow = input.window ?? { from: input.context.cursor?.at ?? new Date(Date.now() - 3_600_000).toISOString(), to: new Date().toISOString() };
    const state = createRunState({ runId: input.runId, connector: input.context.scope.connector, window, context: input.context, prefetched: input.prefetched });
    if (parent) {
      state.recorded = parent.recorded;
      state.items = parent.items;
      state.auto = parent.auto;
      state.outcomes = parent.outcomes;
      state.resolution = parent.resolution;
    }
    if (input.pass) state.pass = input.pass;
    // ORG-7: Q2 (opps on my accounts) covers only the accounts it was given: its coverage says how many.
    if (input.context.scope.connector === 'org62' && input.context.scope.scope === 'opps') {
      const accounts = String(input.vars?.['org62.accountIds'] ?? '').split(',').filter((x: string) => x.trim()).length;
      state.coverageMeta = (o) => (o.ref === 'soql:Opportunity:accounts' ? { accounts } : undefined);
    }
    const rec =
      input.autoRecord === 'slack' && !input.pass
        ? new SlackAutoRecorder(store, state, input.context)
        : input.autoRecord === 'org62' && !input.pass && ORG62_WINDOWED.has(input.context.scope.scope)
          ? new Org62AutoRecorder(store, state)
          : undefined;
    // ORG-3: what each SOQL query returned, to judge a finish the agent called incomplete by the paging rule.
    const org62Pages = input.context.scope.connector === 'org62' && !input.pass ? new Org62PageObserver() : undefined;
    const ccNames: readonly CcToolName[] = input.pass ? CC_TRIAGE_TOOL_NAMES : CC_TOOL_NAMES;
    const base: ScanSkillRunResult = { ok: false, costUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0 };

    // ---- skill + prompt
    let systemPrompt: string[];
    let prompt: string;
    let sent = { proseChars: 0, dataChars: 0 };
    let skillVersion: string | null = null;
    try {
      const skill = loadSkill(input.skillPath, this.o.repoRoot);
      const common = loadSkill(commonSkillPathFor(input.skillPath), this.o.repoRoot);
      skillVersion = skill.versionTag ?? null;
      assertReadOnly(input.allowedTools);
      if (input.prefetched?.length) {
        const res = await store.recordSourceItems(input.runId, input.prefetched);
        const byKey = new Map(input.prefetched.map((it) => [it.dedupeKey, it]));
        for (const r of res) {
          state.recorded.set(r.dedupeKey, r.sourceItemId);
          const it = byKey.get(r.dedupeKey);
          if (it) state.items.set(r.dedupeKey, it);
          state.counts.recorded += 1;
          if (r.isNew) state.counts.new += 1;
          if (r.changed) state.counts.changed += 1;
        }
      }
      if (input.preReportedCoverage?.length) {
        await store.reportCoverage(input.runId, input.preReportedCoverage);
        state.coverage.push(...input.preReportedCoverage);
        state.counts.coverage += input.preReportedCoverage.length;
      }
      systemPrompt = scannerSystemPrompt(common.body, skill.body, input.context, SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
      const prefetchedBlock = renderPrefetched(input.prefetched, state.recorded);
      prompt = [
        renderRunBlock({ runId: input.runId, mode: input.mode ?? 'incremental', window, ctx: input.context, vars: rec ? { ...input.vars, 'slack.rec': 'auto' } : input.vars, coverage: input.preReportedCoverage }),
        prefetchedBlock,
        input.instruction ? `## Step\n${input.instruction}` : '',
        input.pass
          ? `Follow the skill for mode "${input.pass}". Propose or link what needs it, then give every VERDICT message one verdict with cc_triage_verdicts, then stop (no cc_finish).`
          : `Follow the skill for mode "${input.mode ?? 'incremental'}". Record, link, report coverage, then call cc_finish exactly once.`,
      ]
        .filter(Boolean)
        .join('\n\n');
      const proseChars = systemPrompt[0]!.length;
      sent = { proseChars, dataChars: systemPrompt.reduce((a, x) => a + x.length, 0) - proseChars + prompt.length };
      // D0: identical calls (same model, skill version, prompt and input) share this hash, so repeats are visible.
      base.contentHash = ledgerHash(input.model, skillVersion, ...systemPrompt, prompt);
    } catch (err) {
      const c = classifyError(err);
      log({ event: 'error', code: c.code, detail: safeLogText(errorText(err), 200) });
      return { result: { ...base, error: { message: safeLogText(errorText(err), 300), errorClass: c.errorClass === 'unknown' ? 'config' : c.errorClass } }, state, rec };
    }

    // ---- guards
    const ccServer = buildCcServer(createCcHandlers(store, state), state, ccNames);
    const allowed = [...new Set([...input.allowedTools, ...ccNames.map(ccToolFullName)])];
    const allowSet = new Set(allowed);
    const ac = new AbortController();
    let error: ErrorState | undefined;
    const fail = (e: ErrorState) => {
      if (!error) error = e;
      if (!ac.signal.aborted) ac.abort();
    };
    const denyTool = (tool: string, where: string) => {
      log({ event: 'denied', tool, code: where });
      fail({ message: `disallowed tool call: ${tool}`, errorClass: 'config', disallowedTool: tool, code: 'disallowed_tool' });
    };
    /**
     * A real tool that is not on the allowlist aborts the run. A name that matches no tool at all (a
     * model naming slip such as a bare `cc_…` name) cannot execute: the CLI rejects it and the model
     * retries, so it is logged, not fatal.
     */
    const guard = (tool: string, where: string): 'allow' | 'abort' | 'unknown' => {
      if (allowSet.has(tool)) return 'allow';
      if (isRealTool(tool)) {
        denyTool(tool, where);
        return 'abort';
      }
      log({ event: 'denied', tool, code: `unknown_tool_name:${where}` });
      return 'unknown';
    };
    const onExternalAbort = () => fail({ message: 'aborted by caller', errorClass: 'transient', code: 'aborted' });
    if (input.signal.aborted) onExternalAbort();
    input.signal.addEventListener('abort', onExternalAbort, { once: true });
    const timeoutMs = input.timeoutMs ?? this.o.timeoutMs;
    const watchdog = setTimeout(() => fail({ message: `watchdog: run exceeded ${timeoutMs} ms`, errorClass: 'transient', code: 'timeout' }), timeoutMs);

    const preToolUse: HookCallback = async (hookInput) => {
      if (hookInput.hook_event_name !== 'PreToolUse') return {};
      const g = guard(hookInput.tool_name, 'pre_tool_use');
      if (g === 'allow') {
        // No decision: an `allow` here would skip the canUseTool gate (SDK-1). The gate approves.
        log({ event: 'tool', tool: hookInput.tool_name });
        return {};
      }
      const deny = { hookEventName: 'PreToolUse' as const, permissionDecision: 'deny' as const, permissionDecisionReason: 'not on the scanner allowlist' };
      return g === 'abort' ? { continue: false, stopReason: 'disallowed tool', hookSpecificOutput: deny } : { hookSpecificOutput: deny };
    };
    // REC-1: record what the read tools returned before the model sees it (the CLI awaits the hook).
    const postToolUse: HookCallback = async (hookInput) => {
      if (rec && hookInput.hook_event_name === 'PostToolUse') await rec.onToolResult(hookInput.tool_name, hookInput.tool_input, hookInput.tool_response, hookInput.tool_use_id);
      if (org62Pages && hookInput.hook_event_name === 'PostToolUse') org62Pages.onToolResult(hookInput.tool_name, hookInput.tool_input, hookInput.tool_response);
      return {};
    };
    /** The allowlist gate: every tool call is decided here (SDK-1). */
    const canUseTool: CanUseTool = async (toolName, toolInput) => {
      const g = guard(toolName, 'can_use_tool');
      if (g !== 'allow') return { behavior: 'deny', message: 'not on the scanner allowlist', interrupt: g === 'abort' };
      // REC-1 needs message ts: the concise thread/channel formats carry none, so reads are made detailed.
      const bare = bareToolName(toolName);
      const ti = (toolInput ?? {}) as Record<string, unknown>;
      if (rec && (bare === 'slack_read_thread' || bare === 'slack_read_channel') && ti.response_format !== 'detailed') return { behavior: 'allow', updatedInput: { ...ti, response_format: 'detailed' } };
      return { behavior: 'allow', updatedInput: ti };
    };

    const cwd = this.o.cwd ?? defaultScannerCwd();
    const gateway = this.o.gateway ?? (this.o.queryFn ? { env: {} } : claudeGatewayConfig());
    if (!this.o.queryFn) fs.mkdirSync(cwd, { recursive: true });
    let stderrTail = '';
    const options: Options = {
      model: input.model,
      effort: input.effort ?? this.o.effort ?? 'low',
      tools: [],
      mcpServers: { ...(input.mcpServers as Record<string, McpServerConfig>), [CC_SERVER_NAME]: ccServer },
      strictMcpConfig: true,
      // No `allowedTools`: bare entries would auto-approve before the gate (SDK-1).
      disallowedTools: disallowedFor(allowed),
      permissionMode: 'default',
      canUseTool,
      hooks: { PreToolUse: [{ hooks: [preToolUse] }], ...(rec || org62Pages ? { PostToolUse: [{ hooks: [postToolUse] }] } : {}) },
      settingSources: this.o.settingSources ?? ['user'],
      // Hide the CLI's skill listing: scanners never use the Skill tool, and the listing costs prompt tokens.
      skills: [],
      persistSession: false,
      maxTurns: input.maxTurns,
      maxBudgetUsd: input.costCapUsd,
      systemPrompt,
      env: this.o.env ?? scannerEnv(gateway.env),
      ...(gateway.apiKeyHelper ? { settings: { apiKeyHelper: gateway.apiKeyHelper } } : {}),
      cwd,
      pathToClaudeCodeExecutable: this.o.pathToClaudeCodeExecutable ?? defaultClaudeExecutable(),
      abortController: ac,
      stderr: (d: string) => {
        stderrTail = (stderrTail + d).slice(-4000);
      },
    };

    // ---- run
    const usageByMsg = new Map<string, { model: string; cost: number; prompt: number; usage: UsageTotals }>();
    let firstPromptChecked = false;
    const result: ScanSkillRunResult = { ...base };
    let sawResult = false;
    let lastText = ''; // the agent's last prose reply: says why a run ended without cc_finish (redacted, truncated)
    const toolUses = new Map<string, { name: string; input: unknown }>(); // REC-1 fallback when hooks do not fire
    const traced = new Map<string, { name: string; input: unknown; t0: number }>(); // the trace: every tool call, from the stream
    log({ event: 'start', detail: `${path.basename(input.skillPath)} model=${input.model} tools=${allowed.length}` });
    const q = (this.o.queryFn ?? (sdkQuery as unknown as QueryFn))({ prompt, options });
    try {
      for await (const msg of q) {
        if (msg.type === 'system' && msg.subtype === 'init') {
          for (const s of msg.mcp_servers ?? []) {
            if (s.name === CC_SERVER_NAME) continue;
            const c = classifyMcpStatus(s.status);
            if (c) {
              log({ event: 'init', code: c.code, detail: s.name });
              fail({ message: `mcp server ${s.name} status ${s.status}`, errorClass: c.errorClass, code: c.code });
            }
          }
          const unexpected = (msg.tools ?? []).filter((t) => t.startsWith('mcp__') && !allowSet.has(t));
          if (unexpected.length) log({ event: 'init', code: 'unexpected_tools_loaded', detail: unexpected.slice(0, 10).join(',') });
        } else if (msg.type === 'assistant') {
          const m = msg.message as unknown as { id?: string; model?: string; content?: Array<{ type: string; name?: string; text?: string }>; usage?: Record<string, number | null> };
          for (const block of m.content ?? []) {
            if (block.type === 'tool_use' && block.name) guard(block.name, 'assistant_tool_use');
            if (rec && block.type === 'tool_use' && block.name) toolUses.set((block as { id?: string }).id ?? '', { name: block.name, input: (block as { input?: unknown }).input });
            if (block.type === 'tool_use' && block.name) traced.set((block as { id?: string }).id ?? '', { name: block.name, input: (block as { input?: unknown }).input, t0: Date.now() });
            if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) lastText = block.text;
          }
          const errCode = (msg as { error?: string }).error;
          if (errCode) {
            const cls: ErrorClass = errCode === 'authentication_failed' || errCode === 'oauth_org_not_allowed' ? 'auth' : errCode === 'rate_limit' ? 'rate_limited' : errCode === 'overloaded' || errCode === 'server_error' ? 'transient' : errCode === 'model_not_found' || errCode === 'invalid_request' ? 'config' : 'unknown';
            fail({ message: `assistant error ${errCode}`, errorClass: cls, code: errCode });
          }
          if (m.usage) {
            const model = m.model ?? input.model;
            const promptTokens = (m.usage.input_tokens ?? 0) + (m.usage.cache_read_input_tokens ?? 0) + (m.usage.cache_creation_input_tokens ?? 0);
            usageByMsg.set(m.id ?? `anon-${usageByMsg.size}`, { model, cost: estimateCallCostUsd(model, m.usage), prompt: promptTokens, usage: usageFromBlock(model, m.usage) });
            if (!firstPromptChecked) {
              firstPromptChecked = true;
              // The tripwire guards what we do not send ourselves (SDK prompt + tool schemas): everything we send,
              // the prefetched payload included (G-3), is counted at 2 characters per token (TRIP-2).
              const limit = prefixTripwireLimit(sent, this.o.prefixTripwireTokens);
              trace(input.runId, 'prompt', { pass: input.pass ?? 'traversal', model, tokens: promptTokens, limit, headroom: limit - promptTokens, proseChars: sent.proseChars, dataChars: sent.dataChars });
              if (promptTokens > limit) {
                trace(input.runId, 'tripwire', { pass: input.pass ?? 'traversal', tokens: promptTokens, limit });
                fail({ message: `prefix tripwire: first call prompt ${promptTokens} tokens > ${limit}`, errorClass: 'config', code: 'prefix_tripwire' });
              }
            }
            const est = [...usageByMsg.values()].reduce((a, u) => a + u.cost, 0);
            if (est > input.costCapUsd) {
              log({ event: 'cost', code: 'cost_cap', costUsd: est });
              trace(input.runId, 'cost_cap', { pass: input.pass ?? 'traversal', estUsd: est, capUsd: input.costCapUsd, source: 'estimate' });
              fail({ message: `cost cap exceeded: est $${est.toFixed(4)} > $${input.costCapUsd}`, errorClass: 'config', code: 'cost_cap' });
            }
          }
        } else if (msg.type === 'user') {
          const content = (msg.message as { content?: unknown }).content;
          for (const b of Array.isArray(content) ? (content as Array<{ type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }>) : []) {
            const tc = b.type === 'tool_result' && b.tool_use_id ? traced.get(b.tool_use_id) : undefined;
            if (tc) {
              traced.delete(b.tool_use_id!);
              trace(input.runId, 'tool_call', () => ({ pass: input.pass ?? 'traversal', tool: bareToolName(tc.name), server: tc.name.startsWith('mcp__') ? (tc.name.split('__')[1] ?? null) : null, args: traceArgs(tc.name, tc.input), ms: Date.now() - tc.t0, ...traceResult(b.content), error: b.is_error ? traceError(b.content) : null }));
            }
            if (!rec) continue;
            const tu = b.type === 'tool_result' && !b.is_error && b.tool_use_id ? toolUses.get(b.tool_use_id) : undefined;
            if (tu) await rec.onToolResult(tu.name, tu.input, b.content, b.tool_use_id);
          }
        } else if (msg.type === 'result') {
          sawResult = true;
          result.costUsd = msg.total_cost_usd ?? 0;
          result.turns = msg.num_turns ?? 0;
          // D0: uncached input, output, cache reads and writes, per model (cache is no longer folded into input).
          const usage = usageFromModelUsage(msg.modelUsage as Record<string, unknown> | undefined) ?? usageFromBlock(input.model, msg.usage as unknown as Record<string, number | undefined>);
          setUsage(result, usage);
          for (const d of msg.permission_denials ?? []) guard(d.tool_name, 'permission_denial');
          if (msg.subtype === 'success') {
            if (msg.is_error) {
              const c = classifyError(msg.result);
              fail({ message: safeLogText(msg.result, 300), errorClass: c.errorClass, code: c.code });
            }
          } else if (msg.subtype === 'error_max_budget_usd') {
            trace(input.runId, 'cost_cap', { pass: input.pass ?? 'traversal', estUsd: msg.total_cost_usd ?? null, capUsd: input.costCapUsd, source: 'sdk' });
            fail({ message: 'cost cap exceeded (SDK maxBudgetUsd)', errorClass: 'config', code: 'cost_cap' });
          } else if (msg.subtype === 'error_max_turns') {
            if (!state.finished) fail({ message: `max_turns (${input.maxTurns}) reached before cc_finish`, errorClass: 'unknown', code: 'max_turns' });
          } else {
            const text = (msg.errors ?? []).join(' | ') || stderrTail;
            const c = classifyError(text);
            fail({ message: safeLogText(text || msg.subtype, 300), errorClass: c.errorClass, code: c.code });
          }
          log({ event: 'result', code: msg.subtype, costUsd: result.costUsd });
        }
      }
    } catch (err) {
      if (!error) {
        const text = `${errorText(err)} ${stderrTail}`;
        const c = classifyError(text);
        fail({ message: safeLogText(errorText(err), 300), errorClass: c.errorClass, code: c.code });
      }
    } finally {
      clearTimeout(watchdog);
      input.signal.removeEventListener('abort', onExternalAbort);
      try {
        q.close?.();
      } catch {
        /* already closed */
      }
    }

    if (!sawResult && !result.costUsd) {
      result.costUsd = [...usageByMsg.values()].reduce((a, u) => a + u.cost, 0);
    }
    // A run that died before its result message: its tokens come from the per-message usage blocks.
    if (!sawResult && usageByMsg.size) setUsage(result, addUsage(...[...usageByMsg.values()].map((u) => u.usage)));
    result.counts = { ...state.counts };
    if (state.finished) {
      result.proposedCursor = state.finished.cursor;
      result.summary = state.finished.summary;
      result.complete = state.finished.complete;
      // ORG-3: the agent called a windowed Org62 run incomplete, yet no query reached its LIMIT and its own coverage
      // reaches the window end: by the skill's paging rule the window was read whole. Without this, the store clamps
      // the run's coverage to its (wrong) cursor and the weeks become holes.
      if (org62Pages && !error && !state.finished.complete && ORG62_WINDOWED.has(input.context.scope.scope) && org62Pages.readWhole()) {
        // The agent believed it paged out, so it reported its query windows only up to its cursor. Every query ran
        // under its LIMIT, so each one read the whole window: restate their coverage over it.
        if (ownCoverageHole(state.coverage, window.from, window.to)) {
          const refs = [...new Set(state.coverage.filter((c) => c.kind === 'query_window').map((c) => c.ref))];
          const whole = refs.map((ref) => ({ kind: 'query_window' as const, ref, from: window.from, to: window.to, meta: { restated: 'org62 paging rule (ORG-3)' } }));
          if (whole.length) {
            await store.reportCoverage(input.runId, whole);
            state.coverage.push(...whole);
          }
        }
        if (!ownCoverageHole(state.coverage, window.from, window.to)) {
          result.complete = true;
          result.proposedCursor = { value: soqlDateTime(window.to), at: new Date(window.to).toISOString() };
          log({ event: 'tool', code: 'org62_complete_by_paging_rule' });
        }
      }
      // ORG-5 (REC-2): the runner recorded every row it saw and knows where each query got to. A finish that left a
      // full page behind (incomplete with its cursor at the window start, or "complete" without paging on) resumes
      // from the earliest last row among the queries whose page was full, with coverage up to it: the window always
      // moves on, and no row past the cursor is claimed.
      const resume = rec instanceof Org62AutoRecorder && !error ? rec.resumePoint() : null;
      if (resume && Date.parse(resume.stamp) >= Date.parse(window.from) && Date.parse(resume.stamp) < Date.parse(window.to)) {
        const at = new Date(resume.stamp).toISOString();
        const agentAt = result.complete ? Date.parse(window.to) : Date.parse(result.proposedCursor?.at ?? window.from);
        if (result.complete || !(agentAt > Date.parse(at))) {
          const refs = [...new Set([...state.coverage.filter((c) => c.kind === 'query_window').map((c) => c.ref), ...(rec as Org62AutoRecorder).queriedRefs()])];
          const upTo = refs.map((ref) => ({ kind: 'query_window' as const, ref, from: window.from, to: at, meta: { restated: 'org62 rows read (ORG-5)', ...(state.coverageMeta?.({ kind: 'query_window', ref, from: window.from, to: at }) ?? {}) } }));
          await store.reportCoverage(input.runId, upTo);
          state.coverage.push(...upTo);
          result.complete = false;
          result.proposedCursor = { value: `${resume.stamp}|${resume.id}`, at };
          log({ event: 'tool', code: 'org62_resume_from_rows_read' });
        }
      }
      // ORG-6: a windowed scope that ran no SOQL query read nothing, whatever it reports. Stage 1 attempt 7: in mode
      // backfill the agent applied the unwindowed skip (§3) to `opps`, reported `soql:org62:opps:skipped` over the
      // window and finished complete over a 1,148-row week. The run stays incomplete at the window start (no coverage,
      // so the store keeps the hole and the runtime retries).
      if (org62Pages && !error && ORG62_WINDOWED.has(input.context.scope.scope) && org62Pages.queries === 0) {
        result.complete = false;
        result.proposedCursor = { value: soqlDateTime(window.from), at: new Date(window.from).toISOString() };
        log({ event: 'tool', code: 'org62_windowed_without_query' });
      }
    }
    if (error) {
      log({ event: 'error', code: error.code, tool: error.disallowedTool, detail: error.message });
      result.ok = false;
      result.error = { message: error.message, errorClass: error.errorClass, ...(error.disallowedTool ? { disallowedTool: error.disallowedTool } : {}) };
      return { result, state, rec };
    }
    if (input.pass) {
      result.ok = true;
      return { result, state, rec };
    }
    if (!state.finished) {
      result.ok = false;
      const why = lastText ? ` (last reply: ${safeLogText(lastText, 160)})` : '';
      result.error = { message: `run ended without cc_finish${why}`, errorClass: 'unknown' };
      return { result, state, rec };
    }
    // Brief fallback (scan-watch): a HIGHLIGHTS v1 block in the summary when the tool was not used.
    const briefStore = store as ScannerStoreWithBriefs;
    if (!state.brief && briefStore.recordBriefHighlights && state.briefDefaults.subscription) {
      const parsed = parseHighlightsBlock(state.finished.summary, state.recorded);
      if (parsed) {
        try {
          const r = await briefStore.recordBriefHighlights(input.runId, { subscription: state.briefDefaults.subscription, period: state.briefDefaults.period, summary: parsed.summary, highlights: parsed.highlights });
          state.brief = { briefId: r.briefId, highlights: parsed.highlights.length };
        } catch (err) {
          log({ event: 'error', code: 'brief_fallback_failed', detail: safeLogText(errorText(err), 160) });
        }
      }
    }
    result.ok = true;
    return { result, state, rec };
  }
}

/** What the run did with a message, for the trace (`proposed:<wi>:<kind>`, `origin:<wi>`, `flagged`; context links left out). */
function actedOn(state: CcRunState, sourceItemId: string): string[] {
  return (state.outcomes.get(sourceItemId) ?? []).filter((d) => !d.startsWith('context:')).slice(0, 6);
}

/** A tool call's arguments for the trace: Slack and Org62 queries and ids; cc tools by their ids only (no titles or reasons). */
function traceArgs(tool: string, input: unknown): Record<string, unknown> {
  const a = (input ?? {}) as Record<string, unknown>;
  const bare = bareToolName(tool);
  const out: Record<string, unknown> = {};
  if (bare.startsWith('cc_')) {
    for (const k of ['workItemId', 'sourceItemId', 'role', 'confidence', 'kind', 'initiativeId']) if (typeof a[k] === 'string') out[k] = a[k];
    for (const k of ['items', 'evidence', 'verdicts', 'windows', 'objects']) if (Array.isArray(a[k])) out[`${k}N`] = (a[k] as unknown[]).length;
    if (bare === 'cc_finish') out.complete = a.complete ?? null;
    return out;
  }
  for (const k of ['query', 'filters', 'keywords', 'channel_types', 'only_my_channels', 'q', 'channel_id', 'message_ts', 'limit', 'response_format', 'sort', 'oldest', 'latest', 'user_id', 'file_id', 'canvas_id']) if (a[k] !== undefined) out[k] = a[k];
  if (a.cursor !== undefined) out.page = a.cursor ? 'next' : 'first';
  return out;
}

/** Result size and, when the result is a JSON record list (SOQL), its row count and whether more pages remain. */
function traceResult(content: unknown): { size: number; count?: number; more?: boolean } {
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) text = content.map((c) => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : '')).join('\n');
  else if (content !== undefined) text = JSON.stringify(content) ?? '';
  const out: { size: number; count?: number; more?: boolean } = { size: text.length };
  const t = text.trim();
  if (t.startsWith('{') && t.length < 2_000_000) {
    try {
      const j = JSON.parse(t) as { records?: unknown[]; done?: boolean; messages?: unknown[] };
      if (Array.isArray(j.records)) out.count = j.records.length;
      else if (Array.isArray(j.messages)) out.count = j.messages.length;
      if (j.done === false) out.more = true;
    } catch {
      /* not JSON */
    }
  }
  return out;
}

/** A tool error for the trace: a code-sized, redacted head of the error text. */
function traceError(content: unknown): string {
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string })?.text ?? '').join(' ') : JSON.stringify(content ?? '');
  return safeLogText(text, 120);
}

/** Exposed for tests and the scripted runner. */
export type { CcRunState };

const BUILTINS = new Set<string>(BUILTIN_TOOL_NAMES as readonly string[]);
const KNOWN_BARE = new Set<string>([...SLACK_ALL_TOOLS, ...ORG62_ALL_TOOLS]);

/** Any MCP tool, any Claude Code built-in, or a known server tool by its bare name. */
export function isRealTool(name: string): boolean {
  return name.startsWith('mcp__') || BUILTINS.has(name) || KNOWN_BARE.has(name);
}

const EMPTY_ROW = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** D0: a run's tokens, split (uncached input / output / cache read / cache write) and per model. */
function setUsage(r: ScanSkillRunResult, u: UsageTotals): void {
  r.inputTokens = u.inputTokens;
  r.outputTokens = u.outputTokens;
  r.cacheReadTokens = u.cacheReadTokens;
  r.cacheWriteTokens = u.cacheWriteTokens;
  r.usage = u.byModel;
}

/** The triage skill key (`skills/triage-slack.md` → `triage-slack`). */
function triageSkillKeyOf(cfg: TriageConfig): string {
  return cfg.skillPath.replace(/^.*\//, '').replace(/\.md$/, '');
}
