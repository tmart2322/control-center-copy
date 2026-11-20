/** B-079 onboarding page helpers: the same checks as the server, summaries and money formatting. Placeholder data. */
import { describe, expect, it } from 'vitest';

import { OnboardingDraft } from '@/contract';
import { activatedLabels, editedCount, fieldErrors, groupSources, localIssues, nextStep, org62IdHint, personaChoice, prevStep, prioritiesFor, readsFor, readSources, roleLabel, sourcesLine, starterOf, stepSummary, templateOf, toggleSource, usd, usdRange } from '@/components/onboarding/derive';
import { personaOf } from '@/personas';
import { buildState, issuesOf, rolePacks } from '@/server/onboarding/core';
import { onboardingCost } from '@/server/onboarding/cost';
import { simulatedSources } from '@/server/onboarding/sources';

const NOW = new Date('2026-11-06T15:00:00.000Z');
const packs = rolePacks(NOW);
const you = { name: 'Ada Placeholder', email: 'ada@example.com', role: 'se_ic' as const, timezone: 'America/Denver', workingHours: { start: '07:30', end: '17:30', days: [1, 2, 3, 4, 5] }, slackUserId: 'U0PLACE001', org62UserId: '' };

describe('onboarding page helpers', () => {
  it('runs the server’s checks for the step you are on', () => {
    const draft = OnboardingDraft.parse({ you: { ...you, slackUserId: 'nope' }, history: { budgetUsd: 1 } });
    const local = { role: personaChoice(draft.persona, draft.you), you: draft.you, priorities: prioritiesFor(draft, packs), history: { lookbackDays: 30 as const, budgetUsd: 1 } };
    expect(localIssues('role', local)).toEqual([]);
    expect(localIssues('you', local)).toEqual([]);
    expect(localIssues('sources', local).map((i) => i.field)).toEqual(['slackUserId']);
    expect(localIssues('history', local).map((i) => i.field)).toEqual(['budgetUsd']);
    const server = issuesOf(draft, packs);
    expect(server.map((i) => `${i.step}.${i.field}`).sort()).toEqual(['history.budgetUsd', 'sources.slackUserId']);
    expect(fieldErrors(server, 'sources')).toEqual({ slackUserId: expect.stringMatching(/start with U or W/) });
  });

  it('steps, priorities and summaries', () => {
    expect([prevStep('role'), nextStep('role'), prevStep('you'), nextStep('you'), prevStep('review'), nextStep('review')]).toEqual([null, 'you', 'role', 'priorities', 'history', null]);
    const p = starterOf(packs.se_ic);
    expect(editedCount(p, packs.se_ic)).toBe(0);
    expect(editedCount({ ...p, weights: { ...p.weights, age: 4 }, rules: p.rules.slice(1) }, packs.se_ic)).toBe(2);
    const state = buildState({ mode: 'mock', required: false, status: 'in_progress', reason: 'mock', stored: null, prefill: you, packs, cost: onboardingCost(15) });
    const local = { role: personaChoice(undefined, you), you, priorities: p, history: { lookbackDays: 30 as const, budgetUsd: 100 } };
    expect(stepSummary('role', state, local)).toBe('Solutions Engineer');
    expect(stepSummary('role', state, { ...local, role: { id: 'ae', level: 'ic' } })).toBe('Specialist AE · Preview');
    expect(stepSummary('role', state, { ...local, role: { id: null, level: 'ic' } })).toBe('SE or Specialist AE');
    expect(stepSummary('you', state, local)).toBe('Ada Placeholder · 07:30–17:30');
    expect(stepSummary('priorities', state, local)).toBe('SE IC starter');
    expect(stepSummary('priorities', state, { ...local, role: { id: 'ae', level: 'ic' }, priorities: starterOf(packs.ae) })).toBe(`${packs.ae.name} starter`);
    expect(stepSummary('history', state, local)).toBe('30 days · about $13–23'); // measured on the first-scan ramp
  });

  it('formats money with one precision per range', () => {
    expect(usdRange({ lowUsd: 0.3686, highUsd: 1.0045 })).toBe('$0.37–1.00');
    expect(usdRange({ lowUsd: 5.16, highUsd: 14.06 })).toBe('$5–14');
    expect(usdRange({ lowUsd: 2, highUsd: 2 })).toBe('$2.00');
    expect([usd(100), usd(5), usd(0.5)]).toEqual(['$100', '$5', '$0.50']);
  });

  it('says which sources still need a sign-in, and which were not checked', () => {
    expect(sourcesLine(undefined)).toBe('Not checked yet.');
    expect(sourcesLine(simulatedSources([], NOW))).toMatch(/^Not checked on this server/);
    const p = simulatedSources([], NOW);
    p.sources = p.sources.map((s) => ({ ...s, state: s.id === 'vdp' ? 'auth_needed' : 'ok' }));
    expect(sourcesLine(p)).toBe('6 of 7 ready. To sign in: VDP.');
  });

  it('the role: a draft from before personas reads as SE at its level; no role = nothing picked', () => {
    expect(personaChoice(undefined, { role: 'se_manager' })).toEqual({ id: 'se', level: 'manager' });
    expect(personaChoice(undefined, {})).toEqual({ id: null, level: 'ic' });
    expect(personaChoice({ id: 'ae' }, { role: 'se_manager' })).toEqual({ id: 'ae', level: 'ic' });
    expect([templateOf({ id: 'se', level: 'ic' }), templateOf({ id: 'se', level: 'manager' }), templateOf({ id: 'ae', level: 'ic' })]).toEqual(['se_ic', 'se_manager', 'ae']);
    expect([roleLabel({ id: 'se', level: 'ic' }), roleLabel({ id: 'se', level: 'manager' }), roleLabel({ id: 'ae', level: 'ic' })]).toEqual(['Solutions Engineer', 'SE manager', 'Specialist AE']);
    const local = { you, priorities: starterOf(packs.se_ic), history: {} };
    expect(localIssues('role', { ...local, role: { id: null, level: 'ic' } })).toEqual([{ step: 'role', field: 'id', message: 'Pick your role to continue.' }]);
    expect(localIssues('role', { ...local, role: { id: 'ae', level: 'manager' } }).map((i) => i.field)).toEqual(['level']);
  });

  it('sources: an AE reads everything but VDP, which sits under Available; activating it turns the VDP feature on', () => {
    const all = simulatedSources([], NOW).sources;
    const ae = { id: 'ae' as const, level: 'ic' as const };
    const none = { features: {}, connectors: {} };
    const g = groupSources(all, ae, none);
    expect(g.active.map((s) => s.id)).toEqual(['slack', 'org62', 'google', 'claude', 'gemini', 'trainings']);
    expect(g.available).toEqual([{ src: expect.objectContaining({ id: 'vdp' }), on: false }]);
    expect(readSources(g).map((s) => s.id)).not.toContain('vdp');

    const on = toggleSource(ae, none, 'vdp', true);
    expect(on).toEqual({ features: { vdp: true }, connectors: {} });
    expect(personaOf({ persona: { id: 'ae', ...on } }).connectors).toContain('vdp');
    expect(groupSources(all, ae, on).available).toEqual([{ src: expect.objectContaining({ id: 'vdp' }), on: true }]);
    expect(activatedLabels(all, ae, on)).toEqual(['VDP']);
    // off again = the preset again (only differences are kept)
    expect(toggleSource(ae, on, 'vdp', false)).toEqual(none);

    // an SE has every source preconfigured: no Available group
    expect(groupSources(all, { id: 'se', level: 'ic' }, none).available).toEqual([]);
  });

  it('copy follows the persona: the Org62 id hint and what Org62 reads', () => {
    const org62 = simulatedSources([], NOW).sources.find((s) => s.id === 'org62')!;
    expect(org62IdHint('se')).toMatch(/DCs/);
    expect(org62IdHint('ae')).not.toMatch(/DC/);
    expect(org62IdHint('ae')).toMatch(/Specialist Forecasts/);
    expect(readsFor(org62, 'se')).toBe(org62.reads);
    expect(readsFor(org62, 'ae')).toMatch(/Specialist Forecasts/);
  });
});
