/**
 * Token usage of one Agent SDK run, split the way the ledger books it (D0, audit 2026-11-13): uncached input, output,
 * cache reads and cache writes, per model. Before, every caller summed cache reads and writes into `inputTokens`, so
 * the ledger could not show a cache hit rate or what caching saved.
 *
 * The authority is the result message's `modelUsage` (one entry per model the run used, with its own cost). Without
 * it (an older CLI, a run that died before its result), the per-message usage blocks are summed.
 */
import { estimateCallCostUsd } from './models';

export interface ModelUsageRow {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface UsageTotals {
  /** Uncached input only. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Per model, largest cost first. */
  byModel: ModelUsageRow[];
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0);

export const EMPTY_USAGE: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, byModel: [] };

function totals(byModel: ModelUsageRow[]): UsageTotals {
  return {
    inputTokens: byModel.reduce((a, u) => a + u.inputTokens, 0),
    outputTokens: byModel.reduce((a, u) => a + u.outputTokens, 0),
    cacheReadTokens: byModel.reduce((a, u) => a + u.cacheReadTokens, 0),
    cacheWriteTokens: byModel.reduce((a, u) => a + u.cacheWriteTokens, 0),
    byModel: [...byModel].sort((a, b) => b.costUsd - a.costUsd || a.model.localeCompare(b.model)),
  };
}

/** From the SDK result's `modelUsage` (keyed by model id). */
export function usageFromModelUsage(mu: Record<string, unknown> | null | undefined): UsageTotals | null {
  const entries = Object.entries(mu ?? {});
  if (!entries.length) return null;
  return totals(
    entries.map(([model, raw]) => {
      const u = (raw ?? {}) as Record<string, unknown>;
      return { model, inputTokens: n(u.inputTokens), outputTokens: n(u.outputTokens), cacheReadTokens: n(u.cacheReadInputTokens), cacheWriteTokens: n(u.cacheCreationInputTokens), costUsd: n(u.costUSD) };
    }),
  );
}

/** From one Messages API usage block (`input_tokens`, `cache_read_input_tokens`, …) on `model`. */
export function usageFromBlock(model: string, u: Record<string, number | null | undefined> | null | undefined): UsageTotals {
  const b = u ?? {};
  return totals([
    {
      model,
      inputTokens: n(b.input_tokens),
      outputTokens: n(b.output_tokens),
      cacheReadTokens: n(b.cache_read_input_tokens),
      cacheWriteTokens: n(b.cache_creation_input_tokens),
      costUsd: estimateCallCostUsd(model, b),
    },
  ]);
}

/** Sum usages (several messages, several passes). */
export function addUsage(...us: Array<UsageTotals | null | undefined>): UsageTotals {
  const m = new Map<string, ModelUsageRow>();
  for (const u of us) {
    for (const r of u?.byModel ?? []) {
      const c = m.get(r.model) ?? { model: r.model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
      c.inputTokens += r.inputTokens;
      c.outputTokens += r.outputTokens;
      c.cacheReadTokens += r.cacheReadTokens;
      c.cacheWriteTokens += r.cacheWriteTokens;
      c.costUsd += r.costUsd;
      m.set(r.model, c);
    }
  }
  return totals([...m.values()]);
}

/** Prompt tokens of a usage (uncached + cache read + cache write): what the long-prompt price threshold counts. */
export const promptTokens = (u: Pick<UsageTotals, 'inputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>) => u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
