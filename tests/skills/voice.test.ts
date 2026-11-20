import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildVoiceProfile, classifyAudience, isLongForm } from '../../src/engines/voice/build';
import { normalizeSlackText } from '../../src/engines/voice/normalize';
import { renderVoiceForPrompt } from '../../src/engines/voice/render';
import { collectSentMessages, parseSlackSearchResults } from '../../src/engines/voice/slack-search-parse';
import { fileMode, loadVoiceProfile, saveVoiceProfile } from '../../src/engines/voice/store';
import { buildSynthesisUser, synthesizeVoiceGuides } from '../../src/engines/voice/synthesize';
import { voiceProfileSchema } from '../../src/engines/voice/types';
import { REPO } from './eval-kit';

const raw = readFileSync(resolve(REPO, 'tests/fixtures/skills/slack-search-sample.txt'), 'utf8');

describe('slack search parsing', () => {
  it('parses detailed results, wrapped or not', () => {
    const md = parseSlackSearchResults(raw);
    expect(md).toHaveLength(24);
    const wrapped = parseSlackSearchResults(JSON.stringify({ results: raw, pagination_info: 'next' }));
    expect(wrapped).toHaveLength(24);
    const first = md[0]!;
    expect(first.channelType).toBe('dm');
    expect(first.authorId).toBe('U0ALEX0001');
    expect(first.text).toBe("Yep got it, I'll send the deck over by EOD.");
    expect(first.at).toBe(new Date(1793806670.026889 * 1000).toISOString());
    const group = md[1]!;
    expect(group.channelType).toBe('group_dm');
    expect(group.threadTs).toBe('1793800000.000100');
    expect(group.participants?.map((p) => p.id)).toContain('U0SAM00001');
    const ch = md[4]!;
    expect(ch.channelType).toBe('channel');
    expect(ch.channelName).toBe('ZC:C0ACMECH01:ACME - Data Foundations');
    expect(md[5]!.text).toContain('• Graphs materialize');
    expect(md[5]!.text).toContain('Happy to go into more detail');
  });
  it('keeps only my messages and de-duplicates', () => {
    const msgs = collectSentMessages([raw, raw], 'U0ALEX0001');
    expect(msgs).toHaveLength(23);
    expect(msgs.every((m) => m.authorId === 'U0ALEX0001')).toBe(true);
    expect(msgs[0]!.at < msgs[msgs.length - 1]!.at).toBe(true);
  });
});

describe('normalization', () => {
  it('reduces mentions and links, counts emoji, masks secrets', () => {
    const n = normalizeSlackText('<@U0SAM00001|Sam Ortiz> see <https://x.example.com/a|the demo> &amp; <https://y.example.com> :tada:');
    expect(n.text).toBe('@Sam see the demo & <link> :tada:');
    expect(n.startsWithMention).toBe(true);
    expect(n.linkCount).toBe(2);
    expect(n.emoji).toEqual(['tada']);
    expect(normalizeSlackText('creds: <https://share.1password.com/s#abc|share.1password.com/s#…>').hadSecret).toBe(true);
  });
  it('classifies audiences and long-form pastes', () => {
    expect(classifyAudience({ ts: '1', at: '', channelId: 'D1', channelType: 'dm', text: '' }, { userLabel: 'x' })).toBe('dm');
    expect(classifyAudience({ ts: '1', at: '', channelId: 'C1', channelType: 'channel', channelName: 'ZC:C1:ACME', text: '' }, { userLabel: 'x' })).toBe('account_channel');
    expect(classifyAudience({ ts: '1', at: '', channelId: 'C2', channelType: 'channel', channelName: 'acme-ext', text: '' }, { userLabel: 'x' })).toBe('external');
    expect(isLongForm('short')).toBe(false);
    expect(isLongForm('x'.repeat(1300))).toBe(true);
    expect(isLongForm(`Overview:\n${'a'.repeat(300)}\nDetails:\n${'b'.repeat(320)} — c — d`)).toBe(true);
  });
});

describe('buildVoiceProfile', () => {
  const msgs = collectSentMessages([raw], 'U0ALEX0001');
  const p = buildVoiceProfile(msgs, { userLabel: 'Alex', now: '2026-11-05T16:00:00.000Z' });

  it('produces a valid, explainable profile', () => {
    expect(voiceProfileSchema.safeParse(p).success).toBe(true);
    expect(p.learnedFromMessageCount).toBe(22);
    expect(p.excluded.empty).toBe(1);
    expect(p.excluded.secrets).toBe(1);
    expect(p.verbosity).toBe(2);
    expect(p.formality).toBeLessThanOrEqual(2);
    expect(p.emojiUse).toBe(1);
    expect(p.stats.words.median).toBeGreaterThan(5);
    expect(p.audiences.dm?.count).toBeGreaterThan(5);
    expect(p.signatures.map((s) => s.phrase)).toContain("I'll … (commitment)");
  });
  it('keeps secrets, links and names out of exemplars', () => {
    expect(p.exemplars.length).toBeGreaterThan(2);
    for (const e of p.exemplars) {
      expect(e.text).not.toMatch(/1password|redacted|https?:|<link>/);
      expect(e.text).not.toMatch(/\bACME\b/);
    }
  });
  it('renders a compact prompt block per audience', () => {
    const internal = renderVoiceForPrompt(p, { audience: 'internal' });
    expect(internal).toContain('Voice of Alex');
    expect(internal).toContain('never reuse their facts');
    expect(internal.length).toBeLessThan(2600);
    const customer = renderVoiceForPrompt(p, { audience: 'customer', channel: 'email' });
    expect(customer).toContain('customer-facing:');
    expect(customer).toContain('email:');
  });
  it('the committed example profile is a valid placeholder', () => {
    const ex = voiceProfileSchema.parse(JSON.parse(readFileSync(resolve(REPO, 'src/engines/voice/example-profile.json'), 'utf8')));
    expect(ex.source).toBe('example');
    expect(ex.userLabel).toBe('Alex');
  });
});

describe('synthesis (offline, fake LLM)', () => {
  const msgs = collectSentMessages([raw], 'U0ALEX0001');
  const p = buildVoiceProfile(msgs, { userLabel: 'Alex', now: '2026-11-05T16:00:00.000Z' });
  it('sends no links or secrets to the model', () => {
    const u = buildSynthesisUser(p, msgs);
    expect(u).not.toMatch(/https?:|1password/);
    expect(u).toContain('<messages>');
  });
  it('merges a valid synthesis and rejects junk', async () => {
    const good = {
      tone: 'Direct, friendly, practical.',
      styleGuide: 'Lead with the answer; keep it to one or two sentences.',
      slackGuide: 'No greeting in replies; mention the person first in group threads.',
      emailGuide: 'Add Hi <first name>, keep it short, sign off Thanks + first name.',
      customerGuide: 'Complete sentences, no shorthand; the sample is thin.',
      phrasesToUse: ['Mind sending over …?', 'Happy to …', "I'll … by EOD"],
      phrasesToAvoid: ['Kindly …'],
      greeting: 'Hey <first name>',
    };
    const fake = async () => ({ text: JSON.stringify(good), costUsd: 0.01, inputTokens: 1, outputTokens: 1, model: 'fake', ok: true });
    const r = await synthesizeVoiceGuides(p, msgs, fake);
    expect(r.ok).toBe(true);
    expect(r.profile.tone).toBe(good.tone);
    expect(r.profile.synthesized?.model).toBe('claude-sonnet-5-5');
    const junk = async () => ({ text: 'not json', costUsd: 0, inputTokens: 0, outputTokens: 0, model: 'fake', ok: true });
    const bad = await synthesizeVoiceGuides(p, msgs, junk);
    expect(bad.ok).toBe(false);
    expect(bad.profile).toBe(p);
  });
});

describe('store', () => {
  it('writes 0600 in a 0700 dir and round-trips', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-voice-'));
    const path = join(dir, 'voice', 'profile.json');
    const p = buildVoiceProfile(collectSentMessages([raw], 'U0ALEX0001'), { userLabel: 'Alex', now: '2026-11-05T16:00:00.000Z' });
    saveVoiceProfile(p, path);
    expect(fileMode(path)).toBe(0o600);
    expect(fileMode(join(dir, 'voice'))).toBe(0o700);
    expect(loadVoiceProfile(path)?.userLabel).toBe('Alex');
    expect(loadVoiceProfile(join(dir, 'nope.json'))).toBeNull();
  });
  it('refuses to write inside a git checkout', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-repo-'));
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const p = voiceProfileSchema.parse(JSON.parse(readFileSync(resolve(REPO, 'src/engines/voice/example-profile.json'), 'utf8')));
    expect(() => saveVoiceProfile(p, join(dir, 'sub', 'profile.json'))).toThrow(/git checkout/);
  });
});
