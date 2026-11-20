import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findDatePhrases, supportKeysForIso, unsupportedDatePhrases } from '../../src/engines/nba/prompt/dates';
import { extractJsonObject } from '../../src/engines/nba/prompt/json';
import { containsSecret, redactSecrets } from '../../src/engines/nba/prompt/redact';
import { checkDocForDestination, docToPlainText, plainTextToDoc } from '../../src/engines/nba/prompt/tiptap';
import type { NbaInput } from '../../src/engines/nba/prompt/types';
import { parseNbaReply, validateNbaOutput } from '../../src/engines/nba/prompt/validate';
import { REPO, TZ } from './eval-kit';
import { SCENARIOS } from './scenarios';

const golden = (name: string) => JSON.parse(readFileSync(resolve(REPO, 'tests/fixtures/skills/golden', `${name}.json`), 'utf8'));
const input = (id: string) => (SCENARIOS.find((s) => s.id === id) as { input: NbaInput }).input;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const codes = (r: { errors: Array<{ code: string }> }) => r.errors.map((e) => e.code);

describe('validateNbaOutput: golden outputs pass', () => {
  it.each([
    ['reply-scope-change', 'reply-scope-change'],
    ['user-touched-draft-new-info', 'user-touched-draft-new-info'],
    ['log-activity-week', 'log-activity-week'],
  ])('%s', (fixture, scenario) => {
    const r = validateNbaOutput(golden(fixture), input(scenario));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe('validateNbaOutput: trust rules', () => {
  const ok = () => clone(golden('reply-scope-change'));
  const inp = input('reply-scope-change');

  it('rejects unknown sources', () => {
    const o = ok();
    o.sources.push('ev_imaginary');
    expect(codes(validateNbaOutput(o, inp))).toContain('unknown_source');
  });

  it('rejects invented links and mentions', () => {
    const o = ok();
    o.draft.doc.content[0].content.push({ type: 'text', text: 'deck', marks: [{ type: 'link', attrs: { href: 'https://made-up.example.com/deck' } }] });
    o.draft.doc.content[0].content.push({ type: 'mention', attrs: { id: 'U0NOBODY01', label: 'Nobody', kind: 'slack_user' } });
    const c = codes(validateNbaOutput(o, inp));
    expect(c).toContain('invented_link');
    expect(c).toContain('invented_mention');
  });

  it('rejects headings in Slack drafts', () => {
    const o = ok();
    o.draft.doc.content.unshift({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Update' }] });
    expect(codes(validateNbaOutput(o, inp))).toContain('destination_capability');
  });

  it('enforces confidence / alternatives', () => {
    const sure = ok();
    sure.confidence = 'sure';
    expect(codes(validateNbaOutput(sure, inp))).toContain('alternatives_when_sure');
    const guess = ok();
    guess.confidence = 'guess';
    guess.alternatives = [];
    expect(codes(validateNbaOutput(guess, inp))).toContain('guess_without_alternatives');
  });

  it('rejects multi-line why and over-long titles at the schema layer', () => {
    const o = ok();
    o.why = 'line one\nline two';
    expect(codes(validateNbaOutput(o, inp))).toContain('why_multiline');
    const t = ok();
    t.title = 'x'.repeat(120);
    expect(codes(validateNbaOutput(t, inp))).toContain('schema');
  });

  it('requires a draft for reply unless a blocking ask exists', () => {
    const o = ok();
    o.draft = null;
    expect(codes(validateNbaOutput(o, inp))).toContain('missing_draft');
    o.asks = [{ question: 'Who owns pricing for this?', to: 'you', blocking: true }];
    expect(codes(validateNbaOutput(o, inp))).not.toContain('missing_draft');
  });

  it('rejects secrets and placeholders in drafts', () => {
    const o = ok();
    o.draft.doc.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'password: Hunter2Secret' }] });
    expect(codes(validateNbaOutput(o, inp))).toContain('secret_in_draft');
    const p = ok();
    p.draft.doc.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'See [TODO link]' }] });
    expect(codes(validateNbaOutput(p, inp))).toContain('placeholder_in_draft');
  });

  it('warns on unsupported dates', () => {
    const o = ok();
    o.draft.doc.content.push({ type: 'paragraph', content: [{ type: 'text', text: "I'll send the pricing deck by Tuesday." }] });
    const r = validateNbaOutput(o, inp);
    expect(r.warnings.map((w) => w.code)).toContain('unsupported_date');
    expect(r.ok).toBe(true);
  });

  it('tolerates null startBy and null destination fields (seen in the live eval)', () => {
    const o = ok();
    o.startBy = null;
    o.draft.destination.threadRef = null;
    o.draft.destination.subject = null;
    const r = validateNbaOutput(o, inp);
    expect(r.errors).toEqual([]);
    expect(r.output?.startBy).toEqual({ at: null, reasoning: 'No time pressure in the inputs' });
  });

  it('rejects an update when there is no previous version', () => {
    const o = ok();
    o.update = { summary: 'x changed', triggeredBy: [], diff: [], draftPolicy: 'unchanged', proposal: null };
    expect(codes(validateNbaOutput(o, inp))).toContain('update_without_previous');
  });
});

describe('the update rule', () => {
  const inp = input('user-touched-draft-new-info');
  it('rejects overwriting a user-touched draft', () => {
    const o = clone(golden('user-touched-draft-new-info'));
    o.draft = { destination: { channel: 'slack', label: '#acme-ext' }, doc: o.update.proposal.doc };
    expect(codes(validateNbaOutput(o, inp))).toContain('overwrote_user_draft');
  });
  it('rejects replaced_untouched on a touched draft', () => {
    const o = clone(golden('user-touched-draft-new-info'));
    o.update.draftPolicy = 'replaced_untouched';
    expect(codes(validateNbaOutput(o, inp))).toContain('bad_draft_policy');
  });
  it('requires a proposal for draftPolicy proposal', () => {
    const o = clone(golden('user-touched-draft-new-info'));
    o.update.proposal = null;
    expect(codes(validateNbaOutput(o, inp))).toContain('proposal_missing');
  });
  it('requires update when a previous version exists', () => {
    const o = clone(golden('user-touched-draft-new-info'));
    o.update = null;
    expect(codes(validateNbaOutput(o, inp))).toContain('missing_update');
  });
  it('rejects unknown trigger ids', () => {
    const o = clone(golden('user-touched-draft-new-info'));
    o.update.triggeredBy = ['ev_nope'];
    expect(codes(validateNbaOutput(o, inp))).toContain('unknown_trigger');
  });
});

describe('plan checks', () => {
  it('activity rows cannot stretch hours, double-log or skip the CF rule', () => {
    const inp = input('log-activity-week');
    const stretch = clone(golden('log-activity-week'));
    stretch.plan.rows[1].end = '2026-11-03T18:30:00-07:00';
    expect(codes(validateNbaOutput(stretch, inp))).toContain('hours_outside_block');
    const dbl = clone(golden('log-activity-week'));
    dbl.plan.rows.push({ ...dbl.plan.rows[0], blockId: 'blk_logged', start: '2026-11-04T14:00:00-07:00', end: '2026-11-04T15:00:00-07:00', evidenceIds: ['blk_logged'] });
    expect(codes(validateNbaOutput(dbl, inp))).toContain('double_log');
    const cf = clone(golden('log-activity-week'));
    cf.plan.rows[0].customerFacing = false;
    expect(codes(validateNbaOutput(cf, inp))).toContain('cf_rule');
    const tax = clone(golden('log-activity-week'));
    tax.plan.rows[0].seTaskType = 'Customer Hangout';
    expect(codes(validateNbaOutput(tax, inp))).toContain('unknown_task_type');
  });

  it('claude session prompts need the cc tag', () => {
    const inp = input('kickoff-long-build-first');
    const o = {
      verb: 'start_claude_session',
      title: 'Start build: Globex NCE demo',
      why: 'Long build for the 14:00 demo',
      confidence: 'sure',
      alternatives: [],
      draft: null,
      plan: { kind: 'claude_session', folder: '/Users/alex/Projects/demos', prompt: 'Rebrand the NCE demo for Globex and add the claims-status flow. Ask before deploying.', successCriteria: ['Branded'], contextPack: [], background: true, checkpoints: [] },
      effort: { youMin: 20, agentMin: 120 },
      startBy: { at: '2026-11-05T09:00:00-07:00', reasoning: 'Before the 14:00 demo' },
      sources: ['ev_ask'],
      asks: [],
      completeness: 90,
      update: null,
    };
    expect(codes(validateNbaOutput(o, inp))).toContain('missing_cc_tag');
    o.plan.prompt = `[cc:wi_build] ${o.plan.prompt}`;
    expect(validateNbaOutput(o, inp).ok).toBe(true);
  });

  it('tool runs must use the catalog and list missing inputs as asks', () => {
    const inp = input('run-tool-talk-track');
    const o = {
      verb: 'run_tool',
      title: 'Run talk track for the Globex exec briefing',
      why: 'Kim needs a 30-min exec talk track for tomorrow 9am',
      confidence: 'sure',
      alternatives: [],
      draft: null,
      plan: { kind: 'tool_run', toolId: 'slides-o-matic', inputs: {}, missingInputs: [], expectedOutput: 'A talk track', background: true },
      effort: { youMin: 15, agentMin: 20 },
      startBy: { at: '2026-11-05T15:00:00-07:00', reasoning: 'Leave time to review' },
      sources: ['ev_kim'],
      asks: [],
      completeness: 80,
      update: null,
    };
    expect(codes(validateNbaOutput(o, inp))).toContain('unknown_tool');
    o.plan.toolId = 'talk-track';
    expect(codes(validateNbaOutput(o, inp))).toContain('tool_inputs_incomplete');
    o.plan.inputs = { name: 'Globex exec briefing', customer: 'Globex', references: ['ev_kim', 'ev_ref'] } as never;
    expect(validateNbaOutput(o, inp).ok).toBe(true);
  });

  it('deliverable verdicts must match the checklist', () => {
    const inp = input('deliverable-said-done-but-partial');
    const o = {
      verb: 'review_deliverable',
      title: 'Review Globex deck: 2 of 3 changes left',
      why: 'Said done in Slack, but slides 4-12 still show the old logo',
      confidence: 'sure',
      alternatives: [],
      draft: null,
      plan: {
        kind: 'deliverable_review',
        file: { id: 'file_globex_deck', title: 'Globex NCE pitch' },
        checklist: [
          { requested: 'Add a claims-status use case slide', status: 'made', evidence: 'Slide 6 added', evidenceIds: ['ev_drive2'] },
          { requested: 'Replace the ACME logo with the Globex logo', status: 'partial', evidence: 'Slides 1-3 only', evidenceIds: ['ev_drive2'] },
          { requested: 'Remove the pricing slide', status: 'missing', evidence: 'Slide 9 unchanged', evidenceIds: ['ev_drive2'] },
        ],
        verdict: 'likely_done',
        nextStep: 'Swap the logo on slides 4-12 and remove slide 9',
      },
      effort: { youMin: 15, agentMin: 0 },
      startBy: { at: null, reasoning: 'No deadline given' },
      sources: ['ev_drive2', 'ev_done'],
      asks: [],
      completeness: 85,
      update: null,
    };
    expect(codes(validateNbaOutput(o, inp))).toContain('verdict_inconsistent');
    o.plan.verdict = 'in_progress';
    expect(validateNbaOutput(o, inp).ok).toBe(true);
  });
});

describe('parsing replies', () => {
  it('extracts JSON from fences and prose', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```').value).toEqual({ a: 1 });
    expect(extractJsonObject('Here you go: {"a":{"b":"}"}} trailing').value).toEqual({ a: { b: '}' } });
    expect(extractJsonObject('{"a": 1').error).toMatch(/unterminated/);
    expect(extractJsonObject('no json').error).toBeTruthy();
  });
  it('parseNbaReply validates end to end', () => {
    const raw = `\`\`\`json\n${JSON.stringify(golden('reply-scope-change'))}\n\`\`\``;
    expect(parseNbaReply(raw, input('reply-scope-change')).ok).toBe(true);
  });
});

describe('redaction', () => {
  it('masks common credential shapes', () => {
    for (const s of [
      'password: hunter2!!',
      'the password is S3cretPass',
      'token=abcd1234efgh',
      'https://share.1password.com/s#AbCdEfGh',
      'xoxb-1234567890-abcdefghij',
      'sk-ant-api03-abcdefghijklmnop',
      'postgres://user:pa55word@db.example.com/x',
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
    ])
      expect(containsSecret(s), s).toBe(true);
    expect(containsSecret("I'll send the deck by EOD")).toBe(false);
    expect(redactSecrets('pw: hunter22 ok').text).toBe('[redacted:labeled_secret] ok');
  });
});

describe('dates', () => {
  it('finds weekday, month-day, numeric and relative phrases', () => {
    const keys = findDatePhrases('Friday works, or Nov 7th, 11/9, 2026-11-10, or tomorrow by EOD').map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(['friday', '11-07', '11-09', '11-10', 'tomorrow', 'eod']));
  });
  it('derives support from ISO dates relative to now', () => {
    const keys = supportKeysForIso('2026-11-06T14:00:00-07:00', TZ, '2026-11-05T08:40:00-07:00');
    expect(keys).toEqual(expect.arrayContaining(['friday', '11-06', 'tomorrow', 'this week']));
  });
  it('reports only unsupported phrases', () => {
    const un = unsupportedDatePhrases('See you Friday; deck by Tuesday.', new Set(['friday']));
    expect(un.map((p) => p.key)).toEqual(['tuesday']);
  });
});

describe('tiptap', () => {
  it('round-trips plain text with bullets', () => {
    const doc = plainTextToDoc('Hi Dana,\n\nNext steps:\n\n• one\n• two');
    expect(docToPlainText(doc)).toBe('Hi Dana,\nNext steps:\n• one\n• two');
    expect(checkDocForDestination(doc, 'slack')).toEqual([]);
  });
  it('flags slack mentions in email', () => {
    const doc = { type: 'doc' as const, content: [{ type: 'paragraph' as const, content: [{ type: 'mention' as const, attrs: { id: 'U1', label: 'Dana', kind: 'slack_user' as const } }] }] };
    expect(checkDocForDestination(doc, 'email')).toHaveLength(1);
  });
});
