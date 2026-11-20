/**
 * Owner asks, 2026-11-14 (placeholders only):
 *  1. "We're a little too broad in how we're adding assets": only what VDPs actually hold becomes a candidate.
 *  2. "Find assets for all" stopped for almost every VDP: plan at what a run costs, least recently searched first,
 *     and "Allow $N more today" to run past today's line.
 *  3. "The brand name should be searched too": Find assets searches the short brand forms.
 */
import { describe, expect, it } from 'vitest';

import { allowAssistantToday, type BudgetSettings } from '../../src/contract';
import { findAllPlan } from '../../src/components/time/vdp-derive';
import { screenAsset, screenCandidates, screenDrafts, vdpAssetType, type CandidateDraft } from '../../src/engines/vdp/assets';
import { acronymOf, distinctiveFirstWord, parenAcronym, searchNamesFor } from '../../src/lib/vdp/search-names';
import { expectedRunUsd, planFindAssets } from '../../src/server/vdp/find';

const keep = (title: string, kind: CandidateDraft['kind'] = 'doc') => screenAsset({ title, kind });

describe('screenAsset: what is worth a VDP', () => {
  it('keeps the files VDPs hold: decks, estimates, docs, diagrams, canvases', () => {
    for (const t of ['Northwind Data 360 Workshop Readout', 'Northwind D360 Consumption Estimate', 'Contoso Solution Blueprint', 'Globex Business Case', 'Initech QBR']) expect(keep(t)).toEqual({ keep: true, unsure: false });
  });

  it("drops a meeting's Gemini notes, chat log and transcript", () => {
    expect(keep('Northwind Tableau day - 2026/10/29 08:27 EDT - Chat')).toMatchObject({ keep: false });
    expect(keep('Northwind Data POV - 2026/10/22 11:30 EDT - Transcript')).toMatchObject({ keep: false });
    expect(keep('Notes by Gemini')).toMatchObject({ keep: false });
    expect(keep('Watch video recap')).toMatchObject({ keep: false });
  });

  it('drops internal prep, syncs, agendas, account-team calls and 1:1s', () => {
    for (const t of ['INT: Northwind demo prep for 11/2', '[Internal] Contoso Data 360 Use Case Prep', '*Internal* Globex Weekly Team Meeting', '10/29: Atlanta Agenda Draft', 'FY27 Initech Account Team Call', 'Pat / Sam - Northwind Build', 'Alex // Pat: AFD360 for Contoso'])
      expect(keep(t)).toMatchObject({ keep: false });
  });

  it('drops untitled links and bare file ids', () => {
    expect(keep('Document · drive.google.com')).toMatchObject({ keep: false, reason: expect.stringMatching(/untitled/) });
    expect(keep('Google Slides deck · docs.google.com', 'deck')).toMatchObject({ keep: false });
    expect(keep('1Abcdefghijklmnopqrstuvwxyz0123456789')).toMatchObject({ keep: false });
  });

  it('a meeting recording or screen capture is out; a recorded demo stays as a confirm', () => {
    expect(keep('Northwind - Data POV Strategy - 2026/10/27 10:59 PDT - Recording', 'recording')).toMatchObject({ keep: false });
    expect(keep('screenshare - 2026-10-13 5 36 53 pm.mp4')).toMatchObject({ keep: false });
    expect(keep('Salesforce + Northwind: Data 360 Use Case Demo - 2026/11/02 15:58 EST - Recording', 'recording')).toEqual({ keep: true, unsure: true });
    expect(keep('northwind demo v3.mp4')).toEqual({ keep: true, unsure: true });
    // a recording whatever the stamp looks like, and whatever kind the file says it is
    expect(keep('Discuss Northwind - 2026/10/26 Recording')).toMatchObject({ keep: false });
    expect(keep('Northwind strategy and action owners - 2026/10/26 Recording')).toMatchObject({ keep: false });
    expect(keep('Northwind call - Recording 2')).toMatchObject({ keep: false });
    expect(keep('Northwind + Salesforce: Data360 Demonstration | EDW Focus - Recording')).toEqual({ keep: true, unsure: true });
  });

  it("drops meeting notes someone wrote, too: they're not the material behind a use case", () => {
    expect(keep('Notes from mtg w/ Partner & Northwind: Member Portal')).toMatchObject({ keep: false });
    expect(keep('Northwind meeting notes')).toMatchObject({ keep: false });
    expect(keep('Northwind Release Notes Summary')).toEqual({ keep: true, unsure: false });
  });
});

const draft = (title: string, kind: CandidateDraft['kind'], status: CandidateDraft['status'] = 'suggested'): CandidateDraft => ({ targetKey: 'acc-1', vdpSlug: 'northwind', accountId: 'acc-1', companyName: 'Northwind', title, url: `https://docs.google.com/document/d/${title.replace(/\W/g, '').padEnd(25, 'x')}/edit`, assetKey: title, kind, why: 'placeholder', confidence: 0.8, status, sources: [], sourceItemIds: [] });

describe('screenDrafts and screenCandidates', () => {
  it('drafts: noise never becomes a candidate, and a demo video is a confirm, never a suggested step', () => {
    const out = screenDrafts([draft('Northwind Workshop Deck', 'deck'), draft('Northwind sync - 2026/11/02 12:29 EST - Chat', 'doc'), draft('Northwind demo walkthrough', 'recording')]);
    expect(out.map((d) => [d.title, d.status])).toEqual([
      ['Northwind Workshop Deck', 'suggested'],
      ['Northwind demo walkthrough', 'unsure'],
    ]);
  });

  it('stored: open noise is left out, copies collapse to the newest, and added or dismissed ones stay', () => {
    const rec = (id: string, title: string, status: string, firstSeenAt: string, kind: CandidateDraft['kind'] = 'deck') => ({ id, targetKey: 'acc-1', title, kind, status, firstSeenAt });
    const out = screenCandidates([
      rec('a', 'Northwind Pricing Matrix.pdf', 'suggested', '2026-11-01T00:00:00.000Z', 'pdf'),
      rec('b', 'Northwind Pricing Matrix (1).pdf', 'suggested', '2026-11-03T00:00:00.000Z', 'pdf'),
      rec('c', 'Copy of Northwind Pricing Matrix', 'unsure', '2026-11-02T00:00:00.000Z', 'pdf'),
      rec('d', 'Northwind weekly sync - 2026/11/02 12:29 EST - Chat', 'suggested', '2026-11-02T00:00:00.000Z', 'doc'),
      rec('e', 'Northwind weekly sync - 2026/10/02 12:29 EST - Chat', 'added', '2026-10-02T00:00:00.000Z', 'doc'),
      rec('f', 'Deck', 'suggested', '2026-11-01T00:00:00.000Z'),
      rec('g', 'Deck', 'suggested', '2026-11-02T00:00:00.000Z'),
    ]);
    expect(out.map((c) => c.id)).toEqual(['b', 'e', 'f', 'g']);
  });

  it('never overrules you: a candidate you confirmed or put back stays as you set it', () => {
    const base = { targetKey: 'acc-1', kind: 'recording' as const, firstSeenAt: '2026-11-01T00:00:00.000Z' };
    const out = screenCandidates([
      { ...base, id: 'confirmed', title: 'Northwind demo walkthrough', status: 'suggested', statusAt: '2026-11-14T10:00:00.000Z' },
      { ...base, id: 'app', title: 'Northwind demo walkthrough v2', status: 'suggested', statusAt: null },
      { ...base, id: 'kept', title: 'Northwind call - 2026/11/02 12:29 EST - Recording', status: 'suggested', statusAt: '2026-11-14T10:00:00.000Z' },
    ]);
    expect(out.map((c) => [c.id, c.status])).toEqual([
      ['confirmed', 'suggested'],
      ['app', 'unsure'],
      ['kept', 'suggested'],
    ]);
  });
});

describe('vdpAssetType: the types VDPs use', () => {
  it('names estimates, diagrams, BVDs, RFPs, repos and demos by their VDP type', () => {
    expect(vdpAssetType('sheet', 'Northwind D360 Consumption Estimate')).toBe('Estimate Calculator');
    expect(vdpAssetType('sheet', 'Northwind pricing calculator')).toBe('Estimate Calculator');
    expect(vdpAssetType('doc', 'Northwind Solution Blueprint')).toBe('Architecture Diagram');
    expect(vdpAssetType('link', 'EK 101', 'https://lucid.app/lucidchart/placeholder')).toBe('Architecture Diagram');
    expect(vdpAssetType('deck', 'Northwind BVD')).toBe('BVD');
    expect(vdpAssetType('doc', 'Northwind RFP response')).toBe('RFP');
    expect(vdpAssetType('link', 'repo', 'https://github.com/example/placeholder')).toBe('Github Repo');
    expect(vdpAssetType('recording', 'Northwind demo walkthrough')).toBe('Demo Video');
    expect(vdpAssetType('recording', 'Northwind call')).toBe('');
    expect(vdpAssetType('sheet', 'Northwind use case inventory')).toBe('Google Sheets - Planning');
    expect(vdpAssetType('deck', 'Northwind workshop')).toBe('Deck');
    expect(vdpAssetType('demo', 'org')).toBe('Demo Org');
  });
});

describe('searchNamesFor: the brand name is searched too', () => {
  it('adds the short forms people use, most specific first', () => {
    expect(searchNamesFor(['Northwind Corporation'])).toEqual(['Northwind Corporation', 'Northwind']);
    expect(searchNamesFor(['Northwind Health System'])).toContain('Northwind');
    expect(searchNamesFor(['Contoso Health Alliance'])).toContain('Contoso');
    expect(searchNamesFor(['Health Care Example Corporation (HCEC)'])).toContain('HCEC');
    expect(searchNamesFor(['*Fabrikam Shield of Placeholdia'])).toEqual(expect.arrayContaining(['Fabrikam Shield of Placeholdia', 'Fabrikam']));
  });

  it('the acronym people write for a long name, when every short word is ordinary', () => {
    expect(acronymOf('Fabrikam Shield of Placeholdia')).toBe('FSP');
    expect(acronymOf('*Blue Cross & Blue Shield of North Placeholdia')).toBe('BCBSNP');
    expect(acronymOf('Blue Cross Blue Shield of North East Placeholdia')).toBeNull(); // 7 letters: not how it's written
    expect(acronymOf('Northwind Health')).toBeNull();
    expect(searchNamesFor(['*Blue Cross & Blue Shield of North Placeholdia'])).toEqual(['Blue Cross & Blue Shield of North Placeholdia', 'BCBSNP']);
  });

  it('never an ordinary word on its own, and no repeats', () => {
    expect(distinctiveFirstWord('United Placeholder Health')).toBeNull();
    expect(distinctiveFirstWord('Blue Shield of Placeholdia')).toBeNull();
    expect(distinctiveFirstWord('Northwind')).toBeNull();
    expect(distinctiveFirstWord('HCEC Holdings')).toBe('HCEC');
    expect(parenAcronym('Globex (Parent)')).toBeNull();
    const names = searchNamesFor(['Northwind Health', 'Northwind Health']);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
  });
});

describe('Find assets for all: plan at what a run costs, never starve the same VDPs', () => {
  const cov = {
    vdps: [
      { vdpSlug: 'acme', accountId: 'acc-1', companyName: 'ACME', fiscalYear: 27, fiscalQuarter: 4, assetCount: 0, lastActivityAt: null, gaps: [] },
      { vdpSlug: 'globex', accountId: 'acc-2', companyName: 'Globex', fiscalYear: 27, fiscalQuarter: 4, assetCount: 0, lastActivityAt: null, gaps: [] },
      { vdpSlug: 'initech', accountId: 'acc-3', companyName: 'Initech', fiscalYear: 27, fiscalQuarter: 4, assetCount: 0, lastActivityAt: null, gaps: [] },
    ],
    unlinked: [],
  } as never;
  const accounts = [{ id: 'acc-1', name: 'ACME' }, { id: 'acc-2', name: 'Globex' }, { id: 'acc-3', name: 'Initech' }];
  const done = (at: string, costUsd: number) => ({ status: 'done' as const, startedAt: at, finishedAt: at, found: 1, costUsd, note: null });

  it('a run is expected to cost what runs cost (75th percentile), not the per-run ceiling', () => {
    expect(expectedRunUsd(new Map(), 0.5)).toBe(0.2);
    expect(expectedRunUsd(new Map([['a', done('2026-11-13T10:00:00.000Z', 0.1)], ['b', done('2026-11-13T10:00:00.000Z', 0.12)], ['c', done('2026-11-13T10:00:00.000Z', 0.16)], ['d', done('2026-11-13T10:00:00.000Z', 0.22)]]), 0.5)).toBe(0.16);
    expect(expectedRunUsd(new Map([['a', done('2026-11-13T10:00:00.000Z', 0.9)], ['b', done('2026-11-13T10:00:00.000Z', 0.9)], ['c', done('2026-11-13T10:00:00.000Z', 0.9)]]), 0.5)).toBe(0.5);
  });

  it('the never-searched and least recently searched go first, so a cap never re-runs the same ones', () => {
    const runs = new Map([['acme', done('2026-11-14T07:57:00.000Z', 0.14)], ['globex', done('2026-11-13T18:23:00.000Z', 0.14)]]);
    const p = planFindAssets({ body: { all: true }, coverage: cov, snapshots: [], accounts, runs, perRunUsd: 0.5, dayLeftUsd: 0.45 });
    expect(p.queued.map((q) => q.key)).toEqual(['initech', 'globex']);
    expect(p).toMatchObject({ runUsd: 0.2, estimateUsd: 0.4, ceilingUsd: 1, allUsd: 0.6, shortUsd: 0.15, open: 3 });
    expect(p.note).toMatch(/1 left out by the \$0\.45 cap: allow \$0\.15 more today to run them all/);
  });

  it('a lower cap the caller sets has no shortfall to allow', () => {
    const p = planFindAssets({ body: { all: true, capUsd: 0.2 }, coverage: cov, snapshots: [], accounts, runs: new Map(), perRunUsd: 0.5, dayLeftUsd: 3 });
    expect(p.queued).toHaveLength(1);
    expect(p.shortUsd).toBe(0);
  });

  it('the button: how many fit today, and the exact shortfall to allow', () => {
    expect(findAllPlan({ targets: 46, runUsd: 0.14, dayLeftUsd: 4.44, running: 0 })).toEqual({ all: 46, fits: 31, fitsUsd: 4.34, allUsd: 6.44, shortUsd: 2 });
    expect(findAllPlan({ targets: 10, runUsd: 0.14, dayLeftUsd: 4.44, running: 0 })).toMatchObject({ fits: 10, shortUsd: 0 });
    expect(findAllPlan({ targets: 3, runUsd: 0.2, dayLeftUsd: 0, running: 1 })).toMatchObject({ all: 2, fits: 0, shortUsd: 0.4 });
  });
});

describe('allowAssistantToday: "Allow $N more today"', () => {
  const budgets = { version: 3, softUsd: 8, hardUsd: 10, alertPct: 80, readinUsdPerDay: 2, triageEscalationUsdPerDay: 1, today: null, raises: [] } as BudgetSettings;

  it("raises today's assistant line by the amount, the hard cap only when it would bind, and records why", () => {
    const fits = allowAssistantToday(budgets, { day: '2026-11-14', atIso: '2026-11-14T16:00:00.000Z', addUsd: 2, lineUsd: 5, assistantLeftUsd: 4.44, hardLeftUsd: 7.74, reason: 'Find assets for all' });
    expect(fits.next.today).toMatchObject({ day: '2026-11-14', chatUsd: 7, hardUsd: 10, softUsd: 8 });
    expect(fits.raise.reason).toBe('Find assets for all · assistant line $5 → $7');
    expect(fits.next.raises).toHaveLength(1);
    const binds = allowAssistantToday(budgets, { day: '2026-11-14', atIso: '2026-11-14T16:00:00.000Z', addUsd: 2, lineUsd: 5, assistantLeftUsd: 4.44, hardLeftUsd: 5, reason: 'Find assets for all' });
    expect(binds.next.today).toMatchObject({ chatUsd: 7, hardUsd: 11.44, softUsd: 9.44 });
  });

  it('refuses nothing to allow', () => {
    expect(() => allowAssistantToday(budgets, { day: '2026-11-14', atIso: '2026-11-14T16:00:00.000Z', addUsd: 0, lineUsd: 5, assistantLeftUsd: 1, hardLeftUsd: 5, reason: 'x' })).toThrow(/how much/);
  });
});
