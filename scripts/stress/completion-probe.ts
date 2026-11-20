/**
 * CMP-1 live probe: one real completion-check call (skills/check-completion.md, the skill's cheap model) on a
 * PLACEHOLDER batch, ledgered as a probe. Prints the verdicts, tokens and cost (no real data involved).
 *   npx tsx scripts/stress/completion-probe.ts
 */
import { agentSdkCompletionModel, collectCandidates, itemFacts, parseVerdicts, renderBatch } from '../../src/scanner/completion';
import type { CompletionItem, CompletionSource } from '../../src/scanner/completion';
import { loadSkill } from '../../src/llm/skill-loader';

import { assertBudget, recordSpend } from './lib/ledger';

const T0 = Date.parse('2026-11-02T16:00:00.000Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const ts = (min: number) => ((T0 + min * 60_000) / 1000).toFixed(6);
const A = { name: 'PERSON_A', externalId: 'U0PERSONA' };
const ME = { name: 'ME', externalId: 'U0ME00001', isMe: true };

const dm = (min: number, text: string, fromMe: boolean, ch = 'D0DM00001'): CompletionSource => ({
  sourceItemId: `s-${ch}-${min}`,
  connector: 'slack',
  kind: 'message',
  externalId: `${ch}:${ts(min)}`,
  threadRef: `slack:${ch}:${ts(min)}`,
  occurredAt: at(min),
  seenAt: at(min),
  fromMe,
  author: fromMe ? ME : A,
  participants: [A, ME],
  text,
  fileRefs: [],
  accountHints: [],
});

const ask = (id: string, title: string, origin: CompletionSource): CompletionItem => ({
  workItemId: id,
  kind: 'ask',
  title,
  status: 'open',
  createdAt: at(1),
  accountNames: [],
  fileRefs: [],
  evidence: [{ ...origin, role: 'origin' }],
});

async function main() {
  const o1 = dm(0, 'Can you send me the ACME pilot deck?', false);
  const o2 = dm(2, 'Also, can you check whether ACE memory is HIPAA eligible?', false);
  const items = [ask('wi-deck', 'Send PERSON_A the ACME pilot deck', o1), ask('wi-hipaa', 'Find out if ACE memory is HIPAA eligible for PERSON_A', o2)];
  const sources = [
    dm(5, "On it, I'll check with the PM on the HIPAA question", true),
    dm(30, 'Here you go: https://docs.google.com/presentation/d/FILE_ACME_PILOT_0001/edit', true),
    dm(31, 'Thanks!', false),
  ];
  const entries = items.map((item) => {
    const facts = itemFacts(item);
    return { item, facts, candidates: collectCandidates(item, sources, { seenAfter: 0, seenUntil: T0 + 3_600_000 }, facts) };
  });
  const skill = loadSkill('skills/check-completion.md');
  const { user, ids } = renderBatch(entries, { now: at(40), meName: 'ME' });
  assertBudget(0.05);
  const model = agentSdkCompletionModel();
  const t0 = Date.now();
  const r = await model({ system: skill.body, user, model: String(skill.frontmatter.model), effort: 'low', maxBudgetUsd: 0.05 });
  recordSpend({ scenario: 'completion-probe', kind: 'probe', model: String(skill.frontmatter.model), costUsd: r.costUsd, note: 'placeholder batch' });
  const parsed = parseVerdicts(r.text, ids);
  console.log(JSON.stringify({ ok: r.ok, error: r.error, ms: Date.now() - t0, costUsd: r.costUsd, inputTokens: r.inputTokens, outputTokens: r.outputTokens, promptChars: user.length, verdicts: parsed.verdicts.map((v) => ({ item: v.workItemId, verdict: v.verdict, source: v.sourceItemId, confidence: v.confidence, reason: v.reason })), invalid: parsed.invalid, parseError: parsed.error }, null, 1));
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
