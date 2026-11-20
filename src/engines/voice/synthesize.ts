import { z } from 'zod';
import type { Complete } from '../nba/prompt/complete';
import { extractJsonObject } from '../nba/prompt/json';
import { containsSecret } from '../nba/prompt/redact';
import { normalizeSlackText, scrubExemplar } from './normalize';
import { isLongForm } from './build';
import { voiceProfileSchema, type SentMessage, type VoiceProfile } from './types';

/**
 * Optional LLM pass: read a sample of normalized messages plus the computed stats and write
 * better prose guides. The deterministic stats stay authoritative; the model only refines
 * wording-level fields, and its output is validated before it's merged.
 */

export const synthesisSchema = z.object({
  tone: z.string().min(10).max(300),
  styleGuide: z.string().min(20).max(1500),
  slackGuide: z.string().min(20).max(1500),
  emailGuide: z.string().min(20).max(1500),
  customerGuide: z.string().min(20).max(1000),
  phrasesToUse: z.array(z.string().min(2).max(80)).min(3).max(14),
  phrasesToAvoid: z.array(z.string().min(2).max(80)).max(10),
  greeting: z.string().max(160).nullable(),
});

export const SYNTHESIS_SYSTEM = `You analyze how one person writes on Slack so an assistant can draft messages in their voice.
You get computed statistics and a sample of their sent messages (mentions reduced to first names, links replaced by <link>).
Return ONLY a JSON object with: tone, styleGuide, slackGuide, emailGuide, customerGuide, phrasesToUse, phrasesToAvoid, greeting.
Rules:
- Describe patterns, not content. Never include customer names, people's names, product facts, numbers, links or anything from a specific conversation.
- phrasesToUse: 6-12 short reusable phrasings he actually uses (e.g. "Mind sending over …?", "Happy to …"), with "…" for the variable part.
- phrasesToAvoid: phrasings that would sound unlike him (generic AI or corporate filler).
- styleGuide/slackGuide: concrete, imperative guidance ("Lead with the answer; one or two sentences; …"), each under 900 characters.
- emailGuide: how to adapt his Slack voice to email (he rarely emails).
- customerGuide: how he sounds with customers and account teams versus close teammates, as far as the sample shows; say when the sample is thin.
- greeting: his usual greeting form when he opens a conversation, or null.
- Be faithful to the statistics; do not exaggerate quirks into a caricature.`;

export function buildSynthesisUser(profile: VoiceProfile, messages: SentMessage[], maxMessages = 120): string {
  const sample = messages
    .map((m) => ({ m, n: normalizeSlackText(m.text) }))
    .filter(({ n }) => n.text.length > 0 && !n.hadSecret && !isLongForm(n.text))
    .slice(-maxMessages)
    .map(({ m, n }) => `[${m.channelType}${m.channelName ? ` #${m.channelName.slice(0, 2) === 'ZC' ? 'account-channel' : 'channel'}` : ''}] ${scrubExemplar(n.text).replace(/\n+/g, ' / ').slice(0, 400)}`);
  const { exemplars, ...statsOnly } = profile;
  void exemplars;
  return `<stats>\n${JSON.stringify({ tone: statsOnly.tone, formality: statsOnly.formality, verbosity: statsOnly.verbosity, emojiUse: statsOnly.emojiUse, stats: statsOnly.stats, greetings: statsOnly.greetings, openers: statsOnly.openers, signatures: statsOnly.signatures, commonPhrases: statsOnly.commonPhrases, audiences: statsOnly.audiences })}\n</stats>\n\n<messages>\n${sample.join('\n')}\n</messages>\n\nReturn ONLY the JSON object.`;
}

export async function synthesizeVoiceGuides(
  profile: VoiceProfile,
  messages: SentMessage[],
  complete: Complete,
  opts: { model?: string; maxBudgetUsd?: number } = {},
): Promise<{ profile: VoiceProfile; costUsd: number; ok: boolean; error?: string }> {
  const model = opts.model ?? 'claude-sonnet-5-5';
  const res = await complete({ system: SYNTHESIS_SYSTEM, user: buildSynthesisUser(profile, messages), model, maxBudgetUsd: opts.maxBudgetUsd ?? 0.3 });
  if (!res.ok) return { profile, costUsd: res.costUsd, ok: false, error: res.error ?? 'LLM call failed' };
  const j = extractJsonObject(res.text);
  if (j.error) return { profile, costUsd: res.costUsd, ok: false, error: j.error };
  const parsed = synthesisSchema.safeParse(j.value);
  if (!parsed.success) return { profile, costUsd: res.costUsd, ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') };
  const s = parsed.data;
  if (containsSecret(JSON.stringify(s))) return { profile, costUsd: res.costUsd, ok: false, error: 'synthesis contained credential-like text' };
  const merged = voiceProfileSchema.parse({
    ...profile,
    tone: s.tone,
    styleGuide: s.styleGuide,
    slackGuide: s.slackGuide,
    emailGuide: s.emailGuide,
    customerGuide: s.customerGuide,
    phrasesToUse: s.phrasesToUse,
    phrasesToAvoid: [...new Set([...s.phrasesToAvoid, ...profile.phrasesToAvoid])].slice(0, 20),
    greeting: s.greeting ?? profile.greeting,
    synthesized: { model, at: new Date().toISOString() },
  });
  return { profile: merged, costUsd: res.costUsd, ok: true };
}
