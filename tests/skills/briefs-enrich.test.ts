import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBriefPrompt, validateBriefOutput } from '../../src/engines/briefs/prompt/build';
import type { BriefInput } from '../../src/engines/briefs/prompt/types';
import { buildIntentsPrompt, buildRankPrompt, parseIntentsReply, parseRankReply, type Candidate, type CaptureInput, type IntentsOutput } from '../../src/engines/nba/prompt/enrich';
import { REPO } from './eval-kit';
import { SCENARIOS } from './scenarios';

const golden = (name: string) => JSON.parse(readFileSync(resolve(REPO, 'tests/fixtures/skills/golden', `${name}.json`), 'utf8'));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const brief = (id: string) => (SCENARIOS.find((s) => s.id === id) as { input: BriefInput }).input;
const rankScenario = SCENARIOS.find((s) => s.id === 'enrich-capture-rank') as { input: CaptureInput; parsed: IntentsOutput['parsed']; candidates: Candidate[] };
const codes = (r: { errors: Array<{ code: string }> }) => r.errors.map((e) => e.code);

describe('brief prompts', () => {
  it('channel briefs use Haiku and include the relevance rubric and negatives', () => {
    const p = buildBriefPrompt(brief('channel-brief-negatives'));
    expect(p.model).toBe('claude-haiku-5-5');
    expect(p.promptVersion).toBe('brief-channel@2+brief-relevance@2');
    expect(p.user).toContain('NOT RELEVANT');
    expect(p.user).toContain('keyword:pricing');
    expect(p.user).toContain('[rule:manager_24h]');
    // interests render as the featureKey form the rubric asks for (live eval regression)
    expect(p.user).toContain('[interest:Nimbus Context Engine] (product)');
  });
  it('opportunity briefs use Sonnet and render field changes', () => {
    const p = buildBriefPrompt(brief('opp-brief-one-high'));
    expect(p.model).toBe('claude-sonnet-5-5');
    expect(p.user).toMatch(/NextStep: Discovery follow-up → Pricing call with CFO/);
  });
  it('empty periods still render an items section', () => {
    const p = buildBriefPrompt(brief('opp-brief-nothing-new'));
    expect(p.user).toContain('(no items in this period)');
    expect(p.user).toContain('fieldChanges: none');
  });
});

describe('validateBriefOutput', () => {
  const inp = brief('opp-brief-one-high');
  it('accepts the golden opp brief', () => {
    const r = validateBriefOutput(golden('opp-brief-one-high'), inp);
    expect(r.errors).toEqual([]);
  });
  it('enforces the 150-word prose summary', () => {
    const o = clone(golden('opp-brief-one-high'));
    o.summary = 'word '.repeat(160);
    expect(codes(validateBriefOutput(o, inp))).toContain('summary_too_long');
    o.summary = '- a bullet\n- another';
    expect(codes(validateBriefOutput(o, inp))).toContain('summary_not_prose');
  });
  it('rejects unknown evidence, feature keys and entities', () => {
    const o = clone(golden('opp-brief-one-high'));
    o.highlights[0].evidenceIds = ['o_99'];
    o.highlights[0].reasons.push({ kind: 'my_account', featureKey: 'account:acc_nope', explanation: 'x is mine' });
    o.highlights[0].entity.initiativeId = 'init_nope';
    const c = codes(validateBriefOutput(o, inp));
    expect(c).toEqual(expect.arrayContaining(['unknown_evidence', 'unknown_feature', 'unknown_entity']));
  });
  it('rejects a high highlight with only weak reasons', () => {
    const o = clone(golden('opp-brief-one-high'));
    o.highlights[0].reasons = [{ kind: 'keyword', featureKey: 'keyword:deck', explanation: 'mentions a deck' }];
    expect(codes(validateBriefOutput(o, inp))).toContain('weak_high');
  });
  it('requires field changes to be reported in opportunity briefs', () => {
    const o = clone(golden('opp-brief-one-high'));
    o.summary = 'Sam asked for the deck by Friday.';
    o.highlights = o.highlights.filter((h: { level: string }) => h.level === 'high');
    expect(codes(validateBriefOutput(o, inp))).toContain('field_changes_missing');
  });
  it('requires nothingNew for an empty period', () => {
    const empty = brief('opp-brief-nothing-new');
    const o = { summary: 'Quiet period.', nothingNew: false, highlights: [], everythingElse: [], coverageNote: null };
    expect(codes(validateBriefOutput(o, empty))).toContain('nothing_new_flag');
    o.nothingNew = true;
    expect(validateBriefOutput(o, empty).ok).toBe(true);
  });
  it('warns when a highlight resembles a dismissed one', () => {
    const ch = brief('channel-brief-negatives');
    const o = {
      summary: 'Tableau pricing changed.',
      nothingNew: false,
      highlights: [
        {
          title: 'Tableau Next pricing changed',
          body: 'Bundles are cheaper.',
          level: 'medium',
          reasons: [{ kind: 'keyword', featureKey: 'keyword:pricing', explanation: 'pricing topic' }],
          evidenceIds: ['t_5'],
          suggestedAction: 'ignore',
          topicKey: 'slack:C0TEAM:5',
          entity: { accountId: null, opportunityId: null, initiativeId: null },
        },
      ],
      everythingElse: [],
      coverageNote: null,
    };
    const r = validateBriefOutput(o, ch);
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain('similar_to_dismissed');
  });
});

describe('capture enrichment', () => {
  it('intents prompt runs on Haiku and carries the capture verbatim', () => {
    const p = buildIntentsPrompt(rankScenario.input);
    expect(p.model).toBe('claude-haiku-5-5');
    expect(p.user).toContain("talk to product about NCE gaps + team's open questions");
    expect(p.user).toContain('MODE: intents');
  });
  it('parses intents and flags narrow searches', () => {
    const ok = parseIntentsReply(
      JSON.stringify({
        parsed: { verbGuess: 'reply', counterpart: { name: null, role: 'product manager' }, topic: 'NCE gaps', keywords: ['NCE'], accountId: null, initiativeId: null, due: null },
        intents: [
          { source: 'drive', query: 'NCE open questions', why: 'doc may exist', after: null },
          { source: 'drive', query: 'Nimbus Context Engine', why: 'alias', after: null },
        ],
      }),
    );
    expect(ok.ok).toBe(true);
    expect(ok.warnings.map((w) => w.code)).toContain('narrow_search');
  });
  it('rank prompt includes candidates and the NBA contract', () => {
    const p = buildRankPrompt(rankScenario.input, rankScenario.parsed, rankScenario.candidates);
    expect(p.model).toBe('claude-sonnet-5-5');
    expect(p.system).toContain('Next best action: shared contract');
    expect(p.user).toContain('[c_doc]');
    expect(p.user).toContain('https://docs.example.com/d/nce-open-questions');
  });
  it('accepts the golden rank output', () => {
    const r = parseRankReply(JSON.stringify(golden('enrich-capture-rank')), rankScenario.input, rankScenario.parsed, rankScenario.candidates);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it('maps relation synonyms the model reaches for', () => {
    const o = clone(golden('enrich-capture-rank'));
    o.related[2].relation = 'meeting';
    const r = parseRankReply(JSON.stringify(o), rankScenario.input, rankScenario.parsed, rankScenario.candidates);
    expect(r.ok).toBe(true);
    expect(r.output?.related[2]?.relation).toBe('meeting_notes');
  });

  it('rejects unknown candidates and invented links inside the NBA', () => {
    const o = clone(golden('enrich-capture-rank'));
    o.related.push({ candidateId: 'c_ghost', relation: 'asset', strength: 'strong', reason: 'not real at all' });
    o.nba.draft.doc.content[0].content[1].marks[0].attrs.href = 'https://docs.example.com/d/made-up';
    const r = parseRankReply(JSON.stringify(o), rankScenario.input, rankScenario.parsed, rankScenario.candidates);
    expect(codes(r)).toEqual(expect.arrayContaining(['unknown_candidate', 'invented_link']));
  });
});
