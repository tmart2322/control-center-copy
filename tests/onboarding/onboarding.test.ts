/**
 * B-079 onboarding: the shared core (steps, checks, Back/forward), the cost estimate, the read-only Sources probe
 * (fake commands: nothing runs, no auth starts), the draft file, and the mock DataSource's flow. Placeholder data only.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync as read } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingCompleteResult, OnboardingSourcesPayload, OnboardingState, Seed, type SaveOnboardingStepRequest } from '@/contract';
import type { ExecFn, ExecResult } from '@/ops/exec';
import { MockDataSource } from '@/server/datasource/mock';
import { AppError } from '@/server/errors';
import { applyStep, blockingStep, finalChoices, freshStored, issuesOf, personaChoice, personaPatch, prefillPersona, prefillYou, prioritiesFor, rolePacks, starterPriorities, templateOf } from '@/server/onboarding/core';
import { estimateFirstScan, FIRST_SCAN_COST, onboardingCost, perDayCost } from '@/server/onboarding/cost';
import { FileDraftStore } from '@/server/onboarding/drafts';
import { recordOnlyFirstScan, savedFirstScan } from '@/server/onboarding/first-scan';
import { simulatedFirstScan } from '@/server/datasource/mock/onboarding';
import { firstScanView } from '@/components/shell/first-scan';
import { personaOf } from '@/personas';
import { probeSources, SourceProbe, simulatedSources } from '@/server/onboarding/sources';

const NOW = new Date('2026-11-06T15:00:00.000Z');
const packs = rolePacks(NOW);
const YOU = {
  name: 'Ada Placeholder',
  email: 'ada@example.com',
  role: 'se_ic' as const,
  timezone: 'America/Denver',
  workingHours: { start: '07:30', end: '17:30', days: [1, 2, 3, 4, 5] },
  slackUserId: 'U0PLACE001',
  org62UserId: '',
};

const step = (r: SaveOnboardingStepRequest) => r;

describe('steps and checks', () => {
  it('a fresh draft starts at Role and blocks there (pick one), at You (name, email) and Sources (the Slack id); History has defaults', () => {
    const s = freshStored('x', prefillYou({ timezone: 'America/Denver' }), NOW);
    expect([s.step, s.reached]).toEqual(['role', 'role']);
    const issues = issuesOf(s.draft, packs);
    expect(new Set(issues.map((i) => i.step))).toEqual(new Set(['role', 'you', 'sources']));
    expect(issues.map((i) => `${i.step}.${i.field}`).sort()).toEqual(['role.id', 'sources.slackUserId', 'you.email', 'you.name']);
    expect(blockingStep(issues, 'you')).toBe('role');
    expect(blockingStep(issues, 'priorities')).toBe('role');
    expect(blockingStep(issues, 'role')).toBeNull();
  });

  it('forward needs the step to check out; Back always works; reached only grows', () => {
    let s = freshStored('x', prefillYou({}), NOW);
    expect(() => applyStep(s, step({ step: 'role', value: {}, goTo: 'you' }), { now: NOW, packs })).toThrow(AppError);
    s = applyStep(s, step({ step: 'role', value: { id: 'se', level: 'ic' }, goTo: 'you' }), { now: NOW, packs });
    expect([s.step, s.reached]).toEqual(['you', 'you']);
    expect(() => applyStep(s, step({ step: 'you', value: { name: 'Ada' }, goTo: 'priorities' }), { now: NOW, packs })).toThrow(AppError);
    s = applyStep(s, step({ step: 'you', value: YOU, goTo: 'priorities' }), { now: NOW, packs });
    expect([s.step, s.reached]).toEqual(['priorities', 'priorities']);
    s = applyStep(s, step({ step: 'priorities', value: starterPriorities('se_ic', packs), goTo: 'sources' }), { now: NOW, packs });
    s = applyStep(s, step({ step: 'sources', value: {}, goTo: 'history' }), { now: NOW, packs });
    expect(s.draft.sourcesSeenAt).toBe(NOW.toISOString());
    // Back with a half-typed field keeps it and moves
    s = applyStep(s, step({ step: 'history', value: { budgetUsd: 2 }, goTo: 'sources' }), { now: NOW, packs });
    expect([s.step, s.reached, s.draft.history.budgetUsd]).toEqual(['sources', 'history', 2]);
    // forward past the bad budget is refused, with the field
    try {
      applyStep(s, step({ step: 'history', value: {}, goTo: 'review' }), { now: NOW, packs });
      throw new Error('expected a 400');
    } catch (e) {
      expect((e as AppError).code).toBe('validation');
      expect((e as AppError).details).toMatchObject({ step: 'history', issues: [{ field: 'budgetUsd' }] });
    }
    s = applyStep(s, step({ step: 'history', value: { lookbackDays: 90, budgetUsd: 100 }, goTo: 'review' }), { now: NOW, packs });
    expect([s.step, s.reached]).toEqual(['review', 'review']);
  });

  it('checks the ids the scanners use', () => {
    const bad = issuesOf({ ...freshStored('x', {}, NOW).draft, you: { ...YOU, slackUserId: 'ada', org62UserId: '0051' } }, packs);
    expect(bad.map((i) => `${i.step}.${i.field}`).sort()).toEqual(['sources.org62UserId', 'sources.slackUserId']);
    const hours = issuesOf({ ...freshStored('x', {}, NOW).draft, you: { ...YOU, workingHours: { start: '18:00', end: '09:00', days: [] } } }, packs);
    expect(hours.map((i) => i.field).sort()).toEqual(['workingHours.days', 'workingHours.end']);
    expect(issuesOf({ ...freshStored('x', {}, NOW).draft, you: { ...YOU, slackUserId: ' u0place001 ' } }, packs)).toEqual([]);
  });

  it('an existing user keeps their email', () => {
    const s = applyStep(freshStored('x', {}, NOW), step({ step: 'you', value: { ...YOU, email: 'other@example.com' } }), { now: NOW, packs, lockedEmail: 'ada@example.com' });
    expect(s.draft.you.email).toBe('ada@example.com');
  });

  it('priorities follow the role: edits for another role give way to the new starter', () => {
    const edited = { ...starterPriorities('se_ic', packs), weights: { ...packs.se_ic.weights, deal_value: 9 } };
    const d = { ...freshStored('x', {}, NOW).draft, you: { ...YOU }, priorities: edited };
    expect(prioritiesFor(d, packs).weights.deal_value).toBe(9);
    expect(prioritiesFor({ ...d, you: { ...YOU, role: 'se_manager' } }, packs)).toEqual(starterPriorities('se_manager', packs));
    expect(packs.se_ic.rules.map((r) => r.id)).toContain('never_rank_trainings_above_customer_prep');
  });

  it('prefill: an unfinished user, then setup’s profile.json, then defaults (no role unless this machine knows it)', () => {
    expect(prefillYou({ user: { email: 'ada@example.com', name: 'Ada', timezone: 'Europe/Paris' }, setupProfile: { name: 'Other', timezone: 'UTC' } })).toMatchObject({ email: 'ada@example.com', name: 'Ada', timezone: 'Europe/Paris' });
    expect(prefillYou({ setupProfile: { name: 'Ada', role: 'se_manager', workingHours: { start: '07:30', end: '17:30' } }, timezone: 'UTC' })).toMatchObject({ name: 'Ada', role: 'se_manager', timezone: 'UTC', workingHours: { start: '07:30', end: '17:30', days: [1, 2, 3, 4, 5] } });
    const bare = prefillYou({ timezone: 'UTC' });
    expect(bare).toMatchObject({ name: '', email: '', workingHours: { start: '09:00', end: '18:00' } });
    expect(bare.role).toBeUndefined();
    expect(prefillPersona({ persona: 'ae' })).toEqual({ id: 'ae', level: 'ic', features: {}, connectors: {} });
    expect(prefillPersona({ persona: 'se', role: 'se_manager' })).toMatchObject({ id: 'se', level: 'manager' });
    expect(prefillPersona({})).toEqual({ features: {}, connectors: {} });
  });
});

describe('cost estimate', () => {
  it('per day = the stress figures plus 30–60% on Slack’s share; N days = N × per day unless measured', () => {
    expect(perDayCost()).toEqual({ lowUsd: 0.37, highUsd: 1 });
    expect(estimateFirstScan(30)).toEqual({ days: 30, lowUsd: 13, highUsd: 23, basis: 'measured', minutes: 240 });
    expect(estimateFirstScan(90)).toMatchObject({ days: 90, basis: 'per_day' });
    const c = onboardingCost(15);
    expect(c.options.map((o) => o.days)).toEqual([7, 14, 30, 90]);
    // D6: the $25 default covers the recommended 30 days and everything shorter; 90 days needs a higher ceiling (the
    // History step says so next to the field).
    expect(c.options.filter((o) => o.days <= c.defaultDays).every((o) => o.highUsd < c.defaultBudgetUsd)).toBe(true);
    expect(c.options.find((o) => o.days === 90)!.highUsd).toBeGreaterThan(c.defaultBudgetUsd);
    expect([c.defaultDays, c.defaultBudgetUsd]).toEqual([30, 25]);
    const measured = { ...FIRST_SCAN_COST, measured: { 90: { lowUsd: 20, highUsd: 41.5 } } };
    expect(estimateFirstScan(90, measured)).toEqual({ days: 90, lowUsd: 20, highUsd: 41.5, basis: 'measured', minutes: 720 });
    // the first-scan ramp's measured 7, 14 and 30 days ($4.42, $7.18 and $16.24 net on real data; 54 min, 114 min, 4 h) ship
    expect(estimateFirstScan(7)).toEqual({ days: 7, lowUsd: 3.5, highUsd: 6, basis: 'measured', minutes: 54 });
    expect(estimateFirstScan(14)).toEqual({ days: 14, lowUsd: 6, highUsd: 10, basis: 'measured', minutes: 114 });
  });

  it('mock records the first-scan request; db saves it for the worker (started), unless its env sets its own lookback', async () => {
    const r = await recordOnlyFirstScan.startFirstScan({ lookbackDays: 30, budgetUsd: 100, at: NOW });
    expect(r).toMatchObject({ lookbackDays: 30, budgetUsd: 100, status: 'recorded', requestedAt: NOW.toISOString() });
    const started = await savedFirstScan({}).startFirstScan({ lookbackDays: 14, budgetUsd: 60, at: NOW });
    expect(started).toMatchObject({ lookbackDays: 14, budgetUsd: 60, status: 'started' });
    expect(started.message).toMatch(/14 days of history, up to \$60.*about 2 h/);
    const env = await savedFirstScan({ CC_FIRST_SCAN_LOOKBACK_DAYS: '7' }).startFirstScan({ lookbackDays: 14, budgetUsd: 60, at: NOW });
    expect(env).toMatchObject({ status: 'recorded' });
    expect(env.message).toMatch(/sets the first scan to 7 days/);
  });
});

describe('sources probe (read-only; fake commands)', () => {
  let dir: string;
  beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'cc-onb-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const res = (over: Partial<ExecResult> = {}): ExecResult => ({ code: 0, stdout: '', stderr: '', timedOut: false, ...over });

  it('reads status only, shares one `claude mcp list`, and shows the exact fix per source', async () => {
    const exec = vi.fn<ExecFn>(async (cmd, args) => {
      if (cmd === 'claude') return res({ stdout: 'slack: https://x (HTTP) - ✔ Connected\nOrg62-Sobject-Read: https://y (HTTP) - ⚠ Needs authentication\n' });
      if (cmd === 'devbar' && args[0] === 'auth') return res({ stdout: JSON.stringify({ authenticated: false }) });
      return res({ code: 1 });
    });
    const openTerminal = vi.fn();
    const spawnDetached = vi.fn();
    const p = await probeSources({ reauth: { exec, openTerminal, spawnDetached, now: () => NOW.getTime(), home: dir, claudeJson: join(dir, 'claude.json') }, claudeProjectsDir: join(dir, 'projects'), exists: () => false }, () => NOW);
    expect(OnboardingSourcesPayload.safeParse(p).success).toBe(true);
    expect(exec.mock.calls.filter(([c]) => c === 'claude')).toHaveLength(1);
    expect(exec.mock.calls.map(([c, a]) => `${c} ${a.join(' ')}`).every((c) => /^(claude mcp list|devbar auth status --json|devbar mcpgw status --json)$/.test(c))).toBe(true);
    expect(openTerminal).not.toHaveBeenCalled();
    expect(spawnDetached).not.toHaveBeenCalled();
    const by = Object.fromEntries(p.sources.map((s) => [s.id, s]));
    expect(p.sources.map((s) => s.id)).toEqual(['slack', 'org62', 'google', 'vdp', 'claude', 'gemini', 'trainings']);
    expect(by.slack).toMatchObject({ state: 'ok', command: null });
    expect(by.org62).toMatchObject({ state: 'auth_needed', command: 'claude mcp login Org62-Sobject-Read' });
    expect(by.google).toMatchObject({ state: 'auth_needed', command: 'devbar auth login' });
    expect(by.vdp!.state).toBe('auth_needed');
    expect(by.vdp!.command).toMatch(/refresh_vdp_fir_cookie\.py$/);
    expect(by.gemini).toMatchObject({ state: 'auth_needed', via: 'google', command: null });
    expect(by.claude!.state).toBe('unknown');
    expect(JSON.stringify(p)).not.toMatch(/secret|Bearer/i);
  });

  it('one probe at a time, kept for 2 minutes, refresh on demand', async () => {
    let t = 0;
    const run = vi.fn(async () => simulatedSources([], NOW, dir));
    const probe = new SourceProbe(run, () => t);
    await Promise.all([probe.get(), probe.get()]);
    expect(run).toHaveBeenCalledTimes(1);
    t = 60_000;
    await probe.get();
    expect(run).toHaveBeenCalledTimes(1);
    await probe.get(true);
    expect(run).toHaveBeenCalledTimes(2);
    t = 5 * 60_000;
    await probe.get();
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('the draft file is 0600, per database, and cleared only for its own database', () => {
    const file = join(dir, 'state', 'onboarding.json');
    const a = new FileDraftStore('db_a', file);
    a.save(freshStored('db_a', { name: 'Ada' }, NOW));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(a.load()?.draft.you.name).toBe('Ada');
    const b = new FileDraftStore('db_b', file);
    expect(b.load()).toBeNull();
    b.clear();
    expect(a.load()).not.toBeNull();
    // a half-typed budget (out of range, or cleared) is kept and flagged, never a reason to lose the draft
    for (const budgetUsd of [2, null]) {
      const s = freshStored('db_a', YOU, NOW);
      a.save({ ...s, draft: { ...s.draft, history: { budgetUsd } } });
      const back = a.load();
      expect(back?.draft.history.budgetUsd).toBe(budgetUsd);
      expect(issuesOf(back!.draft, packs).map((i) => `${i.step}.${i.field}`)).toEqual(['history.budgetUsd']);
    }
    writeFileSync(file, 'not json');
    expect(a.load()).toBeNull();
    a.save(freshStored('db_a', {}, NOW));
    a.clear();
    expect(() => readFileSync(file)).toThrow();
  });
});

describe('mock DataSource onboarding', () => {
  const seed = Seed.parse(JSON.parse(read(path.resolve(__dirname, '../../src/mock/seed.example.json'), 'utf8')));
  let ds: MockDataSource;
  beforeEach(() => {
    ds = new MockDataSource({ seed: structuredClone(seed), delays: { enrichMs: 5, stepMs: 5, chatTokenMs: 0, verifyMs: 5, reevalMs: 5 }, autoplay: false, clockMode: 'seed' });
  });
  afterEach(() => ds.dispose());

  it('is reachable but never required, resumes, and finishing saves profile, policy and the first-scan request', async () => {
    const s0 = OnboardingState.parse(await ds.getOnboarding({} as never));
    // the mock's own persona is what "this machine knows": the role step is prefilled
    expect(s0).toMatchObject({ mode: 'mock', required: false, status: 'not_started', step: 'role', draft: { persona: { id: 'se' } } });
    expect(s0.draft.you.name).toBe(ds.store.settings().profile.name);
    const sources = OnboardingSourcesPayload.parse(await ds.getOnboardingSources({ query: { refresh: false } }));
    expect(sources.simulated).toBe(true);

    await ds.saveOnboardingStep({ body: { step: 'you', value: { ...YOU, role: 'se_manager' }, goTo: 'priorities' } });
    const pri = { ...starterPriorities('se_manager', packs), weights: { ...packs.se_manager.weights, deal_value: 7 } };
    await ds.saveOnboardingStep({ body: { step: 'priorities', value: pri, goTo: 'sources' } });
    const s1 = await ds.getOnboarding({} as never);
    expect([s1.status, s1.step, s1.reached]).toEqual(['in_progress', 'sources', 'sources']);
    await ds.saveOnboardingStep({ body: { step: 'sources', value: {}, goTo: 'history' } });
    await ds.saveOnboardingStep({ body: { step: 'history', value: { lookbackDays: 14, budgetUsd: 50 }, goTo: 'review' } });
    const v0 = ds.store.settings().policy.version;

    const r = OnboardingCompleteResult.parse(await ds.completeOnboarding({ body: {} }));
    expect(r).toMatchObject({ bootstrap: 'mock', redirect: '/', firstScan: { lookbackDays: 14, budgetUsd: 50, status: 'recorded' } });
    expect(r.state).toMatchObject({ status: 'complete', required: false });
    const st = ds.store.settings();
    expect(st.profile).toMatchObject({ name: 'Ada Placeholder', role: 'se_manager', timezone: 'America/Denver', workingHours: { start: '07:30', end: '17:30' } });
    expect(st.policy.version).toBe(v0 + 1);
    expect(st.policy.weights.deal_value).toBe(7);
    expect(st.policy.note).toBe('Set during onboarding');

    // finishing twice changes nothing; a restart (mock only) starts over
    expect((await ds.completeOnboarding({ body: {} })).wrote).toEqual([]);
    const again = await ds.saveOnboardingStep({ body: { step: 'role', value: {}, goTo: 'role', restart: true } });
    expect([again.status, again.step]).toEqual(['in_progress', 'role']);
  });

  it('refuses to finish with an unfinished step', async () => {
    await expect(ds.completeOnboarding({ body: {} })).rejects.toMatchObject({ code: 'validation', details: { step: 'sources' } });
  });

  it('as a Specialist AE: VDP is not read until activated; finishing writes persona ae, the activation and the AE policy', async () => {
    await ds.saveOnboardingStep({ body: { step: 'role', value: { id: 'ae' }, goTo: 'you' } });
    await ds.saveOnboardingStep({ body: { step: 'you', value: YOU, goTo: 'priorities' } });
    const s1 = await ds.getOnboarding({} as never);
    expect(s1.draft.persona).toMatchObject({ id: 'ae', level: 'ic' });
    expect(s1.draft.you.role).toBe('se_ic');
    // the priorities step starts from the AE template
    await ds.saveOnboardingStep({ body: { step: 'priorities', value: starterPriorities('ae', packs), goTo: 'sources' } });
    await ds.saveOnboardingStep({ body: { step: 'sources', value: { features: { vdp: true, bogus: true }, connectors: { not_a_source: true } }, goTo: 'history' } });
    const s2 = await ds.getOnboarding({} as never);
    expect(s2.draft.persona).toEqual({ id: 'ae', level: 'ic', features: { vdp: true }, connectors: {} });
    await ds.saveOnboardingStep({ body: { step: 'history', value: { lookbackDays: 7, budgetUsd: 25 }, goTo: 'review' } });
    const r = await ds.completeOnboarding({ body: {} });
    // the persona switch (mock starts as SE) reseeds the AE starter policy itself, so onboarding has no policy of its own to write
    expect(r.wrote).toEqual(expect.arrayContaining(['settings.persona']));
    const st = ds.store.settings();
    expect(st.persona).toMatchObject({ id: 'ae', level: 'ic', features: { vdp: true } });
    expect(st.policy.weights).toEqual(packs.ae.weights);
    expect(personaOf(st).connectors).toContain('vdp');

    // the simulated first scan: Health's firstScan, so the banner shows (wall clock, measured pace)
    const h = await ds.getHealth({} as never);
    expect(h.firstScan).toMatchObject({ status: 'active', lookbackDays: 7, budgetUsd: 25 });
    expect(h.firstScan!.scopes.map((x) => x.connector)).not.toContain('vdp');
    expect(firstScanView(h.firstScan, Date.now())).toMatchObject({ lookbackDays: 7 });
  });

  it('switching persona drops the activations made for the other one', async () => {
    await ds.saveOnboardingStep({ body: { step: 'role', value: { id: 'ae' }, goTo: 'role' } });
    await ds.saveOnboardingStep({ body: { step: 'sources', value: { features: { vdp: true } } } });
    const s = await ds.saveOnboardingStep({ body: { step: 'role', value: { id: 'se', level: 'manager' }, goTo: 'role' } });
    expect(s.draft.persona).toEqual({ id: 'se', level: 'manager', features: {}, connectors: {} });
    expect(s.draft.you.role).toBe('se_manager');
  });
});

describe('the role step (D-55)', () => {
  const base = () => freshStored('x', { ...YOU, role: undefined }, NOW);
  it('validates: a persona must be picked, and the level must be one it has', () => {
    expect(issuesOf(base().draft, packs).filter((i) => i.step === 'role')).toEqual([{ step: 'role', field: 'id', message: 'Pick your role to continue.' }]);
    const ae = applyStep(base(), step({ step: 'role', value: { id: 'ae', level: 'manager' } }), { now: NOW, packs });
    expect(issuesOf(ae.draft, packs).filter((i) => i.step === 'role').map((i) => i.field)).toEqual(['level']);
    expect(() => applyStep(ae, step({ step: 'role', value: {}, goTo: 'you' }), { now: NOW, packs })).toThrow(AppError);
    const ok = applyStep(ae, step({ step: 'role', value: { level: 'ic' }, goTo: 'you' }), { now: NOW, packs });
    expect([ok.step, ok.draft.persona.id, ok.draft.persona.level]).toEqual(['you', 'ae', 'ic']);
  });

  it('a draft from before personas (only you.role) reads as SE at that level and needs no new choice', () => {
    const old = { ...freshStored('x', YOU, NOW).draft, you: { ...YOU, role: 'se_manager' as const } };
    expect(personaChoice(old)).toEqual({ id: 'se', level: 'manager' });
    expect(templateOf(old)).toBe('se_manager');
    expect(issuesOf(old, packs)).toEqual([]);
    expect(finalChoices(old, packs)).toMatchObject({ role: { id: 'se', level: 'manager' }, you: { role: 'se_manager' } });
  });

  it('the starter policy comes from the persona’s template', () => {
    const ae = applyStep(base(), step({ step: 'role', value: { id: 'ae' } }), { now: NOW, packs });
    expect(templateOf(ae.draft)).toBe('ae');
    expect(prioritiesFor(ae.draft, packs)).toEqual(starterPriorities('ae', packs));
    expect(Object.keys(packs)).toEqual(['se_ic', 'se_manager', 'ae']);
    expect(packs.ae.weights).not.toEqual(packs.se_ic.weights);
  });

  it('finishing patches the persona section only where it differs', () => {
    const role = { id: 'ae' as const, level: 'ic' as const, features: { vdp: true }, connectors: {} };
    expect(personaPatch({ id: 'ae', level: 'ic', features: {}, connectors: {} }, role)).toEqual({ features: { vdp: true } });
    expect(personaPatch({ id: 'se', level: 'manager', features: {}, connectors: {} }, role)).toEqual({ id: 'ae', level: 'ic', features: { vdp: true } });
    expect(personaPatch({ id: 'ae', level: 'ic', features: { vdp: true }, connectors: {} }, role)).toEqual({});
  });
});

describe('simulated first scan (mock parity with Health firstScan)', () => {
  it('moves at the measured pace of the lookback, Slack last; done when every scope is', () => {
    const connectors = personaOf({ persona: { id: 'se' } }).connectors;
    const at = (min: number) => simulatedFirstScan({ lookbackDays: 7, budgetUsd: 50, startedAt: NOW.toISOString(), elapsedMs: min * 60_000, connectors });
    expect(at(0).scopes.every((s) => s.coveredPct === null)).toBe(true);
    const mid = at(27);
    expect(mid.status).toBe('active');
    expect(mid.scopes.find((s) => s.scope === 'calendar:primary')!.status).toBe('done');
    expect(mid.scopes.find((s) => s.scope === 'slack:inbox')!.coveredPct).toBe(50);
    expect(at(60)).toMatchObject({ status: 'done' });
  });
});
