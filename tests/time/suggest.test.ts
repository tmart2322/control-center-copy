/**
 * Time rows that need an opportunity: the plain-English issues (src/lib/time-issues.ts), the suggestion (src/lib/
 * time-suggest.ts: the rules first, the model's stored answer for what they can't settle), the cheap model's prompt and
 * its parse (src/engines/activity/suggest-prompt.ts), and both DataSources attaching the same suggestion on read
 * (placeholders only: the example seed's ACME, Globex, Initech, Hooli).
 */
import { describe, expect, it } from 'vitest';

import type { ActivityEntry, OppOption } from '../../src/contract';
import { parseSuggestAnswer, suggestCandidates, suggestRequest } from '../../src/engines/activity/suggest-prompt';
import { plainIssue, plainIssues } from '../../src/lib/time-issues';
import { RULES_SETTLE, rowsForModel, ruleSuggestion, storedSuggestion, storedSuggestionsOf, suggestionFor, suggestKey, wantsSuggestion, type SuggestContext } from '../../src/lib/time-suggest';
import { createMockDataSource } from '../../src/server/datasource/mock';

const row = (o: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: 'r1',
  version: 1,
  date: '2026-11-10',
  start: '2026-11-10T16:00:00.000Z',
  end: '2026-11-10T17:00:00.000Z',
  durationH: 1,
  taskType: 'Solution Design',
  oppId: null,
  oppName: null,
  accountName: null,
  meetingType: 'CR',
  description: 'Slack: data share thread',
  status: 'needs_input',
  confidence: 'guess',
  sources: [{ kind: 'slack', label: 'Slack · #initech-pilot' }],
  userLockedFields: [],
  issues: ['NEEDS WhatId: which account/opp was this for? write `=> 006…` or `=> skip`'],
  updatedAt: '2026-11-10T17:00:00.000Z',
  fromOrg62: false,
  excludedReason: null,
  loggedAt: null,
  verifiedAt: null,
  internal: false,
  dismissSource: null,
  logNote: null,
  logNoteBasis: null,
  why: null,
  suggestion: null,
  ...o,
});

const opp = (id: string, accountId: string, name: string, o: Record<string, unknown> = {}) => ({ id, accountId, name, stage: 'Discovery', amount: null, closeDate: '2026-12-15', isOpen: true, isMine: true, dcAssigned: false, vdpLinked: false, hoursQtd: 0, nextStep: null, nextStepRead: true, products: [], owner: null, org62Url: null, myDc: null, forecastCategory: null, isWon: false, updatedAt: '2026-11-01T00:00:00.000Z', ...o });
const acct = (id: string, name: string) => ({ id, name, industry: null, dcStatus: 'none' as const, vdpStatus: 'none' as const, hoursQtd: 0, team: [], org62Url: null, notes: '' });

function ctx(o: Partial<SuggestContext> = {}): SuggestContext {
  return {
    opps: [opp('o_ini', 'a_ini', 'Initech · D360 Pilot'), opp('o_glx', 'a_glx', 'Globex · Data 360 Expansion'), opp('o_glx2', 'a_glx', 'Globex · Renewal FY27', { closeDate: '2027-01-15' }), opp('o_glxmc', 'a_glxmc', 'Globex MC · Activation')],
    accounts: [acct('a_ini', 'Initech'), acct('a_glx', 'Globex'), acct('a_glxmc', 'Globex - Marketing Cloud')],
    events: [],
    people: [{ id: 'p1', name: 'Marcus', email: 'marcus@globex.example', accountId: 'a_glx' }],
    assets: [],
    runs: [],
    workItems: [],
    activity: [],
    today: '2026-11-12',
    stored: {},
    internalActivity: true,
    ...o,
  };
}

describe('plain-English issues', () => {
  it('never shows the canvas grammar: each known note is one sentence that says what to do', () => {
    const slack = row();
    expect(plainIssue(slack.issues[0]!, slack)).toBe('Slack work with no account: which opportunity, or internal?');
    expect(plainIssue('NEEDS WhatId: pick an opp from candidates', row({ sources: [{ kind: 'calendar', label: 'Calendar · x' }] }))).toBe('A meeting with no account: which opportunity, or internal?');
    expect(plainIssue('CF forced: external attendee (x.example); Neither type -> Customer Discovery, review')).toBe('Someone from x.example was there, so it counts as customer-facing (Customer Discovery). Check the type.');
    expect(plainIssue('CF forced: external attendee (a.example, b.example); Account Planning -> Customer Discovery')).toBe('Someone from a.example, b.example was there, so it counts as customer-facing: Account Planning became Customer Discovery.');
    expect(plainIssue('GUESS: hours estimated from evidence; adjust with `=> 1.5h`')).toBe('Hours estimated from the evidence: change them if they are off.');
    expect(plainIssue("overlaps OOO 'Dentist' (10:00); trim or drop")).toBe('Overlaps your time off “Dentist” (10:00): trim the hours or dismiss it.');
    expect(plainIssue('WhatId = account fallback (no single obvious opp)')).toMatch(/^Logs to the account for now/);
    expect(plainIssue('Org62 check: Deleted in Org62')).toBe('Deleted in Org62.');
    // an unknown note loses its canvas syntax
    const odd = plainIssue('NEEDS something odd; write `=> 006…` or `=> skip`')!;
    expect(odd).toBe('Needs something odd');
    for (const i of [...slack.issues, 'CF forced: external attendee (x.example); Neither type -> Customer Discovery, review', odd]) expect(plainIssue(i, slack)).not.toMatch(/=>|`|WhatId|NEEDS/);
  });

  it('a row’s issues read once each, in order', () => {
    expect(plainIssues(row({ issues: ['NEEDS WhatId: x', 'NEEDS WhatId: y', 'GUESS: hours'] }))).toEqual(['Slack work with no account: which opportunity, or internal?', 'Hours estimated from the evidence: change them if they are off.']);
  });
});

describe('suggestions: the rules', () => {
  it('a Slack channel that names one account: its only open opp, sure enough to settle the row', () => {
    const s = ruleSuggestion(row(), ctx())!;
    expect(s).toMatchObject({ kind: 'opp', oppId: 'o_ini', basis: 'rules', reason: '#initech-pilot reads as Initech’s channel: its only open opportunity' });
    expect(s.confidence).toBeGreaterThanOrEqual(RULES_SETTLE);
  });

  it('an attendee’s domain: the account the app’s people there are on (never the part that shares its name)', () => {
    const e = row({ sources: [{ kind: 'calendar', label: 'Calendar · Roadmap call' }], issues: ['CF forced: external attendee (globex.example); Neither type -> Customer Discovery, review'] });
    const s = ruleSuggestion(e, ctx())!;
    expect(s.accountName).toBe('Globex');
    expect(['o_glx', 'o_glx2']).toContain(s.oppId);
    // two open opps on it and none used lately: a low confidence, so the model may still weigh in
    expect(s.confidence).toBeLessThan(RULES_SETTLE);
    // no one known at the domain: the domain's own name, the whole-name account first
    const byName = ruleSuggestion(e, ctx({ people: [] }))!;
    expect(byName.accountName).toBe('Globex');
  });

  it('the row’s own account: its only open opp, or the one you logged to last', () => {
    const one = ruleSuggestion(row({ accountName: 'Initech', sources: [] }), ctx())!;
    expect(one).toMatchObject({ oppId: 'o_ini', reason: 'The only open opportunity on Initech' });
    const used = row({ id: 'used', oppId: 'o_glx2', status: 'approved', date: '2026-11-11' });
    const last = ruleSuggestion(row({ accountName: 'Globex', sources: [] }), ctx({ activity: [used] }))!;
    expect(last.oppId).toBe('o_glx2');
    expect(last.reason).toMatch(/you logged to last/);
  });

  it('nothing to go on: no rules suggestion, and the row is the model’s to ask', () => {
    const e = row({ sources: [{ kind: 'claude', label: 'Claude · Member data model draft' }] });
    expect(ruleSuggestion(e, ctx())).toBeNull();
    expect(rowsForModel([e], ctx()).map((x) => x.id)).toEqual(['r1']);
    // a settled row never costs a call
    expect(rowsForModel([row()], ctx())).toEqual([]);
  });

  it('only rows that need an opportunity', () => {
    expect(wantsSuggestion(row())).toBe(true);
    expect(wantsSuggestion(row({ oppId: 'o_ini' }))).toBe(false);
    expect(wantsSuggestion(row({ internal: true }))).toBe(false);
    expect(wantsSuggestion(row({ canvasDraftId: 'd1' }))).toBe(false);
    expect(wantsSuggestion(row({ status: 'logged' }))).toBe(false);
    expect(suggestionFor(row({ oppId: 'o_ini' }), ctx())).toBeNull();
  });
});

describe('suggestions: the model’s stored answer', () => {
  const e = row({ sources: [{ kind: 'claude', label: 'Claude · Member data model draft' }] });
  const at = '2026-11-12T10:00:00.000Z';
  it('is shown for the row as it was asked, its opp named as the app has it now', () => {
    const stored = storedSuggestionsOf({ rows: { r1: { key: suggestKey(e), kind: 'opp', oppId: 'o_glx', confidence: 0.7, reason: 'Member data is Globex’s pilot topic', model: 'claude-haiku-5-5', at } } });
    expect(suggestionFor(e, ctx({ stored }))).toMatchObject({ kind: 'opp', oppId: 'o_glx', oppName: 'Globex · Data 360 Expansion', accountName: 'Globex', basis: 'ai', confidence: 0.7 });
    // the row changed since: the answer no longer applies (and the row is asked again)
    const changed = { ...e, description: 'Claude: something else' };
    expect(storedSuggestion(changed, ctx({ stored }))).toBeNull();
    expect(rowsForModel([changed], ctx({ stored }))).toHaveLength(1);
    expect(rowsForModel([e], ctx({ stored }))).toHaveLength(0);
  });

  it('internal, only for a role that logs internal work; a none (unusable answer) shows nothing', () => {
    const stored = storedSuggestionsOf({ rows: { r1: { key: suggestKey(e), kind: 'internal', oppId: null, taskType: 'Asset Creation', confidence: 0.8, reason: 'A demo build, no customer named', model: 'm', at } } });
    expect(suggestionFor(e, ctx({ stored }))).toMatchObject({ kind: 'internal', taskType: 'Asset Creation', basis: 'ai' });
    expect(suggestionFor(e, ctx({ stored, internalActivity: false }))).toBeNull();
    const none = storedSuggestionsOf({ rows: { r1: { key: suggestKey(e), kind: 'opp', oppId: null, confidence: 0, reason: '', model: 'm', at } } });
    expect(suggestionFor(e, ctx({ stored: none }))).toBeNull();
    expect(rowsForModel([e], ctx({ stored: none }))).toHaveLength(0);
  });

  it('a rules answer that settles the row wins over the model', () => {
    const stored = storedSuggestionsOf({ rows: { r1: { key: suggestKey(row()), kind: 'internal', oppId: null, confidence: 0.99, reason: 'x', model: 'm', at } } });
    expect(suggestionFor(row(), ctx({ stored }))).toMatchObject({ basis: 'rules', oppId: 'o_ini' });
  });
});

describe('the model’s prompt and answer', () => {
  const candidates = [{ id: 'o1', name: 'Initech · D360 Pilot', accountName: 'Initech', stage: 'Discovery', closeDate: '2026-12-20', isOpen: true, lastUsed: null, why: ['related'] }] as unknown as OppOption[];
  const facts = { entry: row({ description: 'Slack: share with dana@x.example +1 303 555 0100' }), candidates, internalActivity: true };
  it('names the row, its sources, its issues in plain English and the numbered candidates; no emails or phone numbers', () => {
    const r = suggestRequest(facts);
    expect(r.user).toContain('Row: Slack: share with');
    expect(r.user).not.toMatch(/dana@|555 0100/);
    expect(r.user).toContain('1. Initech · D360 Pilot (account: Initech)');
    expect(r.user).toContain('Note: Slack work with no account: which opportunity, or internal?');
    expect(r.user).toMatch(/^internal\. Internal work/m);
    expect(r.system).toMatch(/ONE line of JSON/);
  });
  it('parses a pick or internal, clamps the confidence, and refuses anything else', () => {
    expect(parseSuggestAnswer('{"choice": 1, "confidence": 1.4, "reason": "The channel names Initech"}', facts)).toEqual({ kind: 'opp', oppId: 'o1', confidence: 1, reason: 'The channel names Initech' });
    expect(parseSuggestAnswer('```json\n{"choice": "internal", "confidence": 0.6, "reason": "Tooling"}\n```', facts)).toEqual({ kind: 'internal', oppId: null, confidence: 0.6, reason: 'Tooling' });
    expect(parseSuggestAnswer('{"choice": "internal", "confidence": 0.6}', { ...facts, internalActivity: false })).toBeNull();
    expect(parseSuggestAnswer('{"choice": 7, "confidence": 0.6}', facts)).toBeNull();
    expect(parseSuggestAnswer('I cannot tell', facts)).toBeNull();
  });
  it('lists open opportunities first, at most 15', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `o${i}`, name: `Opp ${i}`, accountName: null, stage: '', closeDate: null, isOpen: i % 2 === 0, lastUsed: null, why: i === 1 ? ['related'] : [] })) as unknown as OppOption[];
    const c = suggestCandidates(many);
    expect(c).toHaveLength(15);
    expect(c.every((o) => o.isOpen)).toBe(true);
  });
});

describe('both DataSources attach the suggestion on read', () => {
  it('the mock: the seed’s rows that need an opp carry the rules’ suggestion; a stored model answer shows for the rest', async () => {
    const ds = createMockDataSource({ autoplay: false });
    ds.resetStore();
    const log = await ds.getActivityLog({ query: {} } as never);
    const by = new Map(log.entries.map((e) => [e.id, e] as const));
    expect(by.get('ac_wed_hooli')?.suggestion).toMatchObject({ kind: 'opp', oppId: 'opp_hooli_nce', basis: 'rules' });
    expect(by.get('ac_tue_slack_initech')?.suggestion).toMatchObject({ kind: 'opp', oppId: 'opp_initech_pilot', basis: 'rules' });
    expect(by.get('ac_wed_roadmap')?.suggestion?.accountName).toBe('Globex');
    expect(by.get('ac_mon_claude_model')?.suggestion).toBeNull();
    // rows that have an opp, or are internal, never carry one
    expect(log.entries.filter((e) => e.oppId || e.internal).every((e) => e.suggestion === null)).toBe(true);
    const claude = by.get('ac_mon_claude_model')!;
    ds.putStoredSuggestions({ [claude.id]: { key: suggestKey(claude), kind: 'internal', oppId: null, taskType: 'Asset Creation', confidence: 0.8, reason: 'A data model draft with no customer named', model: 'claude-haiku-5-5', at: '2026-11-05T12:00:00.000Z' } });
    const again = await ds.getActivityLog({ query: {} } as never);
    expect(again.entries.find((e) => e.id === claude.id)?.suggestion).toMatchObject({ kind: 'internal', basis: 'ai', taskType: 'Asset Creation' });
    // accepting it (PATCH internal) takes the row out of Needs you; the answer reads null on it now
    const r = await ds.patchActivity({ params: { id: claude.id }, body: { ifVersion: claude.version, patch: { internal: true, status: 'approved' } } } as never);
    expect(r.entity.suggestion).toBeNull();
    ds.dispose();
  });

  it('the mock stages only the rows you ticked (POST /time/log/batches ids)', async () => {
    const ds = createMockDataSource({ autoplay: false });
    ds.resetStore();
    const r = await ds.stageLogBatch({ body: { ids: ['ac_tue_sow'] } } as never);
    expect(r.entity.events).toBe(1);
    expect(r.entity.approved).toBe(0);
    ds.dispose();
  });
});
