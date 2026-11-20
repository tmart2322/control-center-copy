/**
 * Build the voice profile from saved Slack search outputs.
 *
 *   npx vite-node src/engines/voice/cli.ts -- --input <raw.json> --me <SLACK_USER_ID> --label <first name> [--synthesize] [--out <path>]
 *
 * <raw.json> is a JSON array of raw `slack_search_public_and_private` outputs (from:me, read-only).
 * Prints only aggregate stats, never message bodies. Writes the profile outside the repo (0600).
 */
import { readFileSync } from 'node:fs';
import { agentSdkComplete } from '../nba/prompt/complete';
import { buildVoiceProfile } from './build';
import { collectSentMessages } from './slack-search-parse';
import { saveVoiceProfile, voiceProfilePath } from './store';
import { synthesizeVoiceGuides } from './synthesize';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const input = arg('input');
  const me = arg('me');
  const label = arg('label') ?? 'Me';
  if (!input) throw new Error('--input is required');
  const raws = JSON.parse(readFileSync(input, 'utf8')) as string[];
  const messages = collectSentMessages(raws, me);
  let profile = buildVoiceProfile(messages, { userLabel: label });
  let cost = 0;
  if (process.argv.includes('--synthesize')) {
    const r = await synthesizeVoiceGuides(profile, messages, agentSdkComplete, { maxBudgetUsd: 0.3 });
    cost = r.costUsd;
    if (r.ok) profile = r.profile;
    else console.error(`synthesis skipped: ${r.error}`);
  }
  const out = saveVoiceProfile(profile, arg('out') ?? voiceProfilePath());
  console.log(
    JSON.stringify(
      {
        saved: out,
        parsed: messages.length,
        learnedFrom: profile.learnedFromMessageCount,
        excluded: profile.excluded,
        scales: { formality: profile.formality, verbosity: profile.verbosity, emojiUse: profile.emojiUse },
        medianWords: profile.stats.words.median,
        audiences: Object.fromEntries(Object.entries(profile.audiences).map(([k, v]) => [k, v.count])),
        exemplars: profile.exemplars.length,
        synthesized: !!profile.synthesized,
        costUsd: Math.round(cost * 10000) / 10000,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
