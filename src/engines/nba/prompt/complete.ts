
/**
 * The single LLM seam the judgment layer needs: system + user in, text + cost out.
 * Engines take a `Complete` so tests stay offline; `agentSdkComplete` is the real one
 * (Agent SDK, no tools, no filesystem settings, one turn). BE-4's runtime can swap in the
 * shared `src/llm` runner when it lands; the contract is the same.
 */

export interface CompleteRequest {
  system: string;
  user: string;
  model: string;
  maxOutputTokens?: number;
  /** Hard stop for this call (Agent SDK maxBudgetUsd). */
  maxBudgetUsd?: number;
  effort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
}

export interface CompleteResult {
  text: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
  ok: boolean;
  error?: string;
}

export type Complete = (req: CompleteRequest) => Promise<CompleteResult>;

interface ResultLike {
  type: string;
  subtype?: string;
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  errors?: string[];
}

/** Host-session variables a child Claude process must not inherit (they point at the parent's auth channel). */
// Gateway env + host-var stripping live in the shared module (also used by the scanner SkillRunner).
export { claudeGatewayConfig, childEnv } from '@/llm/claude-env';
import { claudeGatewayConfig, childEnv } from '@/llm/claude-env';

export const agentSdkComplete: Complete = async (req) => {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const gw = claudeGatewayConfig();
  const abort = new AbortController();
  if (req.signal) req.signal.addEventListener('abort', () => abort.abort(), { once: true });
  let last: ResultLike | undefined;
  const q = query({
    prompt: req.user,
    options: {
      model: req.model,
      systemPrompt: req.system,
      tools: [],
      settingSources: [],
      maxTurns: 1,
      persistSession: false,
      permissionMode: 'dontAsk',
      abortController: abort,
      ...(req.maxBudgetUsd ? { maxBudgetUsd: req.maxBudgetUsd } : {}),
      ...(req.effort ? { effort: req.effort } : {}),
      ...(gw.apiKeyHelper ? { settings: { apiKeyHelper: gw.apiKeyHelper } } : {}),
      env: childEnv(gw.env),
    },
  });
  for await (const msg of q as AsyncIterable<ResultLike>) {
    if (msg.type === 'result') last = msg;
  }
  const u = last?.usage ?? {};
  const inputTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const ok = last?.subtype === 'success' && !last.is_error;
  return {
    text: ok ? (last?.result ?? '') : '',
    costUsd: last?.total_cost_usd ?? 0,
    inputTokens,
    outputTokens: u.output_tokens ?? 0,
    model: req.model,
    ok,
    ...(ok ? {} : { error: last?.errors?.join('; ') ?? last?.result ?? last?.subtype ?? 'no result' }),
  };
};
