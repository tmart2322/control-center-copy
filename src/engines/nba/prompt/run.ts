import { buildNbaPrompt, type BuildOptions, type BuiltPrompt } from './build';
import type { Complete } from './complete';
import type { Issue } from './json';
import type { NbaOutput } from './schema';
import type { NbaInput } from './types';
import { parseNbaReply } from './validate';

export interface GenerateResult {
  ok: boolean;
  output?: NbaOutput;
  errors: Issue[];
  warnings: Issue[];
  prompt: BuiltPrompt;
  attempts: number;
  costUsd: number;
  raw: string[];
}

/** Repair prompt: same system, the original context, the failed attempt and the exact errors. */
export function repairUserMessage(user: string, raw: string, errors: Issue[]): string {
  return `${user}\n\n<previous_attempt>\n${raw.slice(0, 12000)}\n</previous_attempt>\n\n<validation_errors>\n${errors
    .map((e) => `- ${e.code}: ${e.message}`)
    .join('\n')}\n</validation_errors>\n\nThe previous attempt failed validation. Fix every error above and return ONLY the corrected JSON object.`;
}

/** build → complete → validate, with at most `repairs` repair attempts. Nothing is written anywhere. */
export async function generateNba(
  input: NbaInput,
  complete: Complete,
  opts: BuildOptions & { repairs?: number; maxBudgetUsd?: number } = {},
): Promise<GenerateResult> {
  const prompt = buildNbaPrompt(input, opts);
  const raws: string[] = [];
  let cost = 0;
  let user = prompt.user;
  const repairs = opts.repairs ?? 1;
  let last: ReturnType<typeof parseNbaReply> = { ok: false, errors: [{ code: 'not_run', message: 'not run' }], warnings: [] };
  for (let attempt = 0; attempt <= repairs; attempt++) {
    const res = await complete({
      system: prompt.system,
      user,
      model: prompt.model,
      maxOutputTokens: prompt.maxOutputTokens,
      ...(opts.maxBudgetUsd ? { maxBudgetUsd: opts.maxBudgetUsd } : {}),
    });
    cost += res.costUsd;
    raws.push(res.text);
    if (!res.ok) {
      last = { ok: false, errors: [{ code: 'llm', message: res.error ?? 'LLM call failed' }], warnings: [] };
      break;
    }
    last = parseNbaReply(res.text, input);
    if (last.ok) return { ok: true, ...(last.output ? { output: last.output } : {}), errors: [], warnings: last.warnings, prompt, attempts: attempt + 1, costUsd: cost, raw: raws };
    user = repairUserMessage(prompt.user, res.text, last.errors);
  }
  return { ok: false, ...(last.output ? { output: last.output } : {}), errors: last.errors, warnings: last.warnings, prompt, attempts: raws.length, costUsd: cost, raw: raws };
}
