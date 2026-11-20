import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBriefPrompt, validateBriefOutput } from '../../src/engines/briefs/prompt/build';
import { buildIntentsPrompt, buildRankPrompt, parseRankReply } from '../../src/engines/nba/prompt/enrich';
import { buildNbaPrompt } from '../../src/engines/nba/prompt/build';
import { docToPlainText } from '../../src/engines/nba/prompt/tiptap';
import { validateNbaOutput } from '../../src/engines/nba/prompt/validate';
import { nbaCtx, REPO, type Check } from './eval-kit';
import { SCENARIOS } from './scenarios';

const golden = (name: string) => JSON.parse(readFileSync(resolve(REPO, 'tests/fixtures/skills/golden', `${name}.json`), 'utf8'));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function failures<C>(checks: Check<C>[], ctx: C): string[] {
  return checks.map((ch) => ({ n: ch.name, r: ch.fn(ctx) })).filter((x) => x.r !== true).map((x) => `${x.n}: ${String(x.r)}`);
}

describe('eval set', () => {
  it('has 15-20 uniquely named, placeholder-only scenarios', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(15);
    expect(SCENARIOS.length).toBeLessThanOrEqual(20);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    const text = readFileSync(resolve(REPO, 'tests/skills/scenarios.ts'), 'utf8');
    expect(text).not.toMatch(/salesforce\.enterprise\.slack\.com|org62\.lightning|herokuapp/);
  });

  it('covers every required case', () => {
    const ids = SCENARIOS.map((s) => s.id);
    for (const id of [
      'reply-scope-change',
      'kickoff-long-build-first',
      'deliverable-drive-edit-only',
      'user-touched-draft-new-info',
      'low-confidence-alternatives',
      'training-fit-in',
      'background-promise-70d',
      'missed-meeting-takeaway',
      'opp-brief-one-high',
    ])
      expect(ids).toContain(id);
  });

  it('the 70-day promise really is 70 days old', () => {
    const s = SCENARIOS.find((x) => x.id === 'background-promise-70d') as { input: { now: string; workItem: { createdAt: string } } };
    expect(Math.floor((new Date(s.input.now).getTime() - new Date(s.input.workItem.createdAt).getTime()) / 86_400_000)).toBe(70);
  });

  it('every scenario builds its prompt offline', () => {
    for (const s of SCENARIOS) {
      if (s.kind === 'nba') expect(buildNbaPrompt(s.input).user.length).toBeGreaterThan(200);
      else if (s.kind === 'brief') expect(buildBriefPrompt(s.input).user.length).toBeGreaterThan(200);
      else if (s.kind === 'enrich_intents') expect(buildIntentsPrompt(s.input).user).toContain('MODE: intents');
      else expect(buildRankPrompt(s.input, s.parsed, s.candidates).user).toContain('MODE: rank');
    }
  });
});

describe('scenario checks against golden answers', () => {
  it('reply-scope-change: golden passes, a pricing quote fails', () => {
    const s = SCENARIOS.find((x) => x.id === 'reply-scope-change')!;
    if (s.kind !== 'nba') throw new Error('kind');
    const o = golden('reply-scope-change');
    const v = validateNbaOutput(o, s.input);
    expect(failures(s.checks, nbaCtx(s.input, v.output!, v))).toEqual([]);
    const bad = clone(o);
    bad.draft.doc.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'Pricing is $2 per conversation.' }] });
    const v2 = validateNbaOutput(bad, s.input);
    expect(failures(s.checks, nbaCtx(s.input, v2.output!, v2)).join(' ')).toMatch(/no prices/);
  });

  it('user-touched: golden passes, an overwrite fails', () => {
    const s = SCENARIOS.find((x) => x.id === 'user-touched-draft-new-info')!;
    if (s.kind !== 'nba') throw new Error('kind');
    const o = golden('user-touched-draft-new-info');
    const v = validateNbaOutput(o, s.input);
    expect(failures(s.checks, nbaCtx(s.input, v.output!, v))).toEqual([]);
    const bad = clone(o);
    bad.draft = { destination: { channel: 'slack', label: '#acme-ext' }, doc: bad.update.proposal.doc };
    const v2 = validateNbaOutput(bad, s.input);
    expect(failures(s.checks, nbaCtx(s.input, v2.output!, v2)).length).toBeGreaterThan(0);
  });

  it('log-activity: golden passes', () => {
    const s = SCENARIOS.find((x) => x.id === 'log-activity-week')!;
    if (s.kind !== 'nba') throw new Error('kind');
    const v = validateNbaOutput(golden('log-activity-week'), s.input);
    expect(failures(s.checks, nbaCtx(s.input, v.output!, v))).toEqual([]);
  });

  it('opp-brief-one-high: golden passes, a second high fails', () => {
    const s = SCENARIOS.find((x) => x.id === 'opp-brief-one-high')!;
    if (s.kind !== 'brief') throw new Error('kind');
    const o = golden('opp-brief-one-high');
    const v = validateBriefOutput(o, s.input);
    expect(failures(s.checks, { input: s.input, output: v.output!, validation: v })).toEqual([]);
    const bad = clone(o);
    bad.highlights[1].level = 'high';
    const v2 = validateBriefOutput(bad, s.input);
    expect(failures(s.checks, { input: s.input, output: v2.output!, validation: v2 }).join(' ')).toMatch(/exactly one high/);
  });

  it('enrich-capture-rank: golden passes', () => {
    const s = SCENARIOS.find((x) => x.id === 'enrich-capture-rank')!;
    if (s.kind !== 'enrich_rank') throw new Error('kind');
    const r = parseRankReply(JSON.stringify(golden('enrich-capture-rank')), s.input, s.parsed, s.candidates);
    expect(r.ok).toBe(true);
    const ctx = { input: s.input, output: r.output!, candidates: s.candidates, draftText: docToPlainText(r.output!.nba.draft!.doc) };
    expect(failures(s.checks, ctx)).toEqual([]);
  });
});
