/**
 * Model ids and list prices used for the running cost estimate (SCANNER.md §7, brief 09 §4.1).
 * The authoritative cost is the SDK result's `total_cost_usd` / `modelUsage`; this table only lets the
 * runner abort mid-run when the per-run cap is crossed, before the result message arrives.
 */

export const SCANNER_MODEL = 'claude-haiku-5-5';
export const ESCALATION_MODEL = 'claude-sonnet-5-5';

export interface ModelPrice {
  /** USD per million tokens. */
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheRead: number;
  /** Haiku 5.5 switches to a higher tier above 100K prompt tokens. */
  longPromptThreshold?: number;
  longInput?: number;
  longOutput?: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite5m: 0.125, cacheRead: 0.01, longPromptThreshold: 100_000, longInput: 0.5, longOutput: 2.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite5m: 2.5, cacheRead: 0.2 },
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite5m: 5, cacheRead: 0.2 },
};

export interface TokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Estimate the cost of one API call from its usage block. Unknown models are priced as Sonnet (conservative). */
export function estimateCallCostUsd(model: string, u: TokenUsage): number {
  const p = MODEL_PRICES[model] ?? MODEL_PRICES['claude-sonnet-5-5']!;
  const inp = u.input_tokens ?? 0;
  const out = u.output_tokens ?? 0;
  const cw = u.cache_creation_input_tokens ?? 0;
  const cr = u.cache_read_input_tokens ?? 0;
  const prompt = inp + cw + cr;
  const long = p.longPromptThreshold != null && prompt > p.longPromptThreshold;
  const inRate = long ? (p.longInput ?? p.input) : p.input;
  const outRate = long ? (p.longOutput ?? p.output) : p.output;
  const scale = long ? inRate / p.input : 1;
  return (inp * inRate + out * outRate + cw * p.cacheWrite5m * scale + cr * p.cacheRead * scale) / 1_000_000;
}
