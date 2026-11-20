/**
 * Run the Settle check on items: build each context pack, make one tool-less model call per item (the completion
 * pass's seam, src/scanner/completion/llm.ts), parse and validate the reply. A failed call is retried once; an unclear
 * verdict can go to a stronger model (`escalate`). Writes nothing: callers decide (a dry run saves JSON; the job
 * applies the policy through the datasource).
 */
import { loadSkill } from '@/engines/nba/prompt/skills';
import type { CompletionModel } from '@/scanner/completion/types';

import { buildSettleContext, type BuildOptions, type SettleRaw } from './context';
import { parseSettleReply, renderSettlePrompt } from './prompt';
import type { SettleContext, SettleResult } from './types';

export const SETTLE_SKILL = 'settle-item';
export const SETTLE_STRONG_MODEL = 'claude-sonnet-5-5';

export interface SettleEscalation {
  model: string;
  /** Which first verdicts go to the stronger model. Default: `unclearVerdict`. */
  when?: (r: SettleResult) => boolean;
  /** Stop escalating once the stronger model has spent this much in the run. */
  maxUsd: number;
}

export interface SettleRunOptions extends Omit<BuildOptions, 'now'> {
  now: Date;
  model?: string;
  maxBudgetUsdPerCall?: number;
  concurrency?: number;
  signal?: AbortSignal;
  escalate?: SettleEscalation | null;
  /** Called after each item (progress, incremental save). */
  onResult?: (r: SettleResult, ctx: SettleContext) => void | Promise<void>;
}

/** The cheap model's verdicts worth a second look: failed or invalid, still mine, gone quiet, or a weak settle. */
export const unclearVerdict = (r: SettleResult): boolean => !r.valid || r.verdict === 'still_yours' || r.verdict === 'gone_quiet' || r.confidence < 0.6;

const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length >= 4));

/**
 * A calendar event in the pack that is still ahead and clearly about this item, the ask itself is an invite for a
 * meeting still ahead, or the item is due later.
 */
export function hasUpcomingMatch(ctx: SettleContext, keywords: string[]): boolean {
  const kw = new Set(keywords.map((k) => k.toLowerCase()));
  const now = Date.parse(ctx.now);
  if (ctx.item.due && Date.parse(ctx.item.due) > now) return true;
  if (ctx.ask?.where?.startsWith('calendar') && ctx.ask.at && Date.parse(ctx.ask.at) > now) return true;
  return ctx.events.some((e) => {
    if (e.passed !== false) return false;
    const ws = words(e.text);
    let n = 0;
    for (const k of kw) if (ws.has(k)) n += 1;
    return n >= 2;
  });
}

/**
 * The loop is still open: the asker wrote last in the conversation, after my last line, within the last week, or
 * within two weeks when they chased and I never replied after the ask.
 */
export function hasOpenLoop(ctx: SettleContext): boolean {
  const asker = ctx.ask && !ctx.ask.fromMe ? ctx.ask.by.trim().toLowerCase() : null;
  const last = ctx.after[ctx.after.length - 1];
  if (!asker || !last || last.fromMe || last.by.trim().toLowerCase() !== asker || !last.at) return false;
  const age = Date.parse(ctx.now) - Date.parse(last.at);
  return age <= 7 * 86_400_000 || (ctx.hints.myRepliesAfterAsk === 0 && age <= 14 * 86_400_000);
}

async function judge(ctx: SettleContext, call: CompletionModel, model: string, o: SettleRunOptions, base: Pick<SettleResult, 'workItemId' | 'skill' | 'upcomingEvent' | 'openLoop'>): Promise<SettleResult> {
  const skill = loadSkill(SETTLE_SKILL);
  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await call({ system: skill.body, user: renderSettlePrompt(ctx), model, effort: 'medium', maxBudgetUsd: o.maxBudgetUsdPerCall ?? Number(skill.meta.budget_usd_per_call ?? 0.05), signal: o.signal, tag: base.workItemId });
    costUsd += res.costUsd;
    inputTokens += res.inputTokens;
    outputTokens += res.outputTokens;
    const spend = { costUsd, inputTokens, outputTokens, model };
    if (!res.ok) {
      if (attempt === 0 && !o.signal?.aborted && res.error?.errorClass !== 'auth' && res.error?.errorClass !== 'config') continue;
      return { ...base, ...spend, verdict: 'still_yours', confidence: 0, reason: '', valid: false, invalidWhy: 'model call failed', error: res.error?.message ?? 'failed' };
    }
    const p = parseSettleReply(res.text, ctx);
    if ('error' in p) {
      if (attempt === 0) continue;
      return { ...base, ...spend, verdict: 'still_yours', confidence: 0, reason: '', valid: false, invalidWhy: 'unparseable reply', error: p.error };
    }
    return { ...base, ...spend, ...p };
  }
  return { ...base, costUsd, inputTokens, outputTokens, model, verdict: 'still_yours', confidence: 0, reason: '', valid: false, invalidWhy: 'no verdict' };
}

export async function settleOne(raw: SettleRaw, call: CompletionModel, o: SettleRunOptions, escalationLeft?: { usd: number }): Promise<{ result: SettleResult; ctx: SettleContext }> {
  const skill = loadSkill(SETTLE_SKILL);
  const model = o.model ?? skill.meta.model ?? 'claude-haiku-5-5';
  const ctx = buildSettleContext(raw, o);
  const base = { workItemId: raw.item.id, skill: `${skill.name}@${skill.version}`, ...(hasUpcomingMatch(ctx, raw.keywords ?? []) ? { upcomingEvent: true } : {}), ...(hasOpenLoop(ctx) ? { openLoop: true } : {}), ...(ctx.hints.askCutOff ? { askCutOff: true } : {}) };
  const first = await judge(ctx, call, model, o, base);
  const esc = o.escalate;
  if (!esc || !escalationLeft || escalationLeft.usd <= 0 || !(esc.when ?? unclearVerdict)(first) || o.signal?.aborted) return { ctx, result: first };
  const second = await judge(ctx, call, esc.model, o, base);
  escalationLeft.usd -= second.costUsd;
  // The stronger verdict wins when it is valid; the cost is both calls.
  const pick = second.valid ? second : first;
  return {
    ctx,
    result: {
      ...pick,
      costUsd: first.costUsd + second.costUsd,
      inputTokens: first.inputTokens + second.inputTokens,
      outputTokens: first.outputTokens + second.outputTokens,
      escalatedFrom: first.verdict,
      escalatedFromConfidence: first.confidence,
      strongerValid: second.valid,
      escalationUsd: second.costUsd,
    },
  };
}

/** Judge many items with bounded concurrency. `load` reads one item's raw rows (null: skip). */
export async function settleMany(ids: string[], load: (id: string) => Promise<SettleRaw | null>, call: CompletionModel, o: SettleRunOptions): Promise<SettleResult[]> {
  const out: SettleResult[] = [];
  const escalationLeft = { usd: o.escalate?.maxUsd ?? 0 };
  let next = 0;
  const worker = async () => {
    while (next < ids.length && !o.signal?.aborted) {
      const id = ids[next++]!;
      const raw = await load(id);
      if (!raw) continue;
      const { result, ctx } = await settleOne(raw, call, o, escalationLeft);
      out.push(result);
      await o.onResult?.(result, ctx);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 4, 12)) }, worker));
  return out;
}
