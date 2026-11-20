import type { Audience, VoiceProfile } from './types';

/**
 * Render the profile as a compact prompt block (~250–450 tokens). The NBA builder puts it in
 * the `<voice>` section; exemplars are filtered to the draft's audience so tone matches.
 */

export type DraftAudience = 'internal' | 'customer';

const AUDIENCE_PREF: Record<DraftAudience, Audience[]> = {
  internal: ['dm', 'group', 'channel'],
  customer: ['external', 'account_channel', 'group'],
};

export function renderVoiceForPrompt(p: VoiceProfile, opts: { audience?: DraftAudience; maxExemplars?: number; channel?: 'slack' | 'email' } = {}): string {
  const audience = opts.audience ?? 'internal';
  const s = p.stats;
  const lines: string[] = [];
  lines.push(`Voice of ${p.userLabel} (learned from ${p.learnedFromMessageCount} sent Slack messages${p.source === 'example' ? ', EXAMPLE PROFILE' : ''}).`);
  lines.push(`- tone: ${p.tone}`);
  lines.push(`- scales: formality ${p.formality}/5 · verbosity ${p.verbosity}/5 · emoji ${p.emojiUse}/3`);
  lines.push(`- length: median ${s.words.median} words, p75 ${s.words.p75}, p90 ${s.words.p90}; one-liners ${Math.round(s.shareOneLine * 100)}%`);
  lines.push(`- greeting: ${p.greeting ?? 'none; starts with the answer'} · sign-off: ${p.signoff ?? 'none on Slack'}`);
  lines.push(`- style: ${p.styleGuide}`);
  if (opts.channel !== 'email') lines.push(`- slack: ${p.slackGuide}`);
  if (opts.channel === 'email') lines.push(`- email: ${p.emailGuide}`);
  if (audience === 'customer') lines.push(`- customer-facing: ${p.customerGuide}`);
  if (p.openers.length) lines.push(`- common openers: ${p.openers.slice(0, 6).map((o) => `"${o.word}"`).join(', ')}`);
  if (p.phrasesToUse.length) lines.push(`- phrases he uses: ${p.phrasesToUse.slice(0, 10).join('; ')}`);
  if (p.commonPhrases.length) lines.push(`- frequent wording: ${p.commonPhrases.slice(0, 10).map((c) => `"${c.phrase}"`).join(', ')}`);
  if (p.phrasesToAvoid.length) lines.push(`- never: ${p.phrasesToAvoid.join('; ')}`);
  const pref = AUDIENCE_PREF[audience];
  const ex = [...p.exemplars].sort((a, b) => pref.indexOf(a.audience) - pref.indexOf(b.audience)).filter((e) => pref.includes(e.audience));
  const pick = ex.slice(0, opts.maxExemplars ?? 4);
  if (pick.length) {
    lines.push('- examples (style only; never reuse their facts, names or links):');
    for (const e of pick) lines.push(`  > [${e.audience}] ${e.text.replace(/\n+/g, ' / ')}`);
  }
  return lines.join('\n');
}
