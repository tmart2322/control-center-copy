/**
 * scan.vdp: parsing recorded (placeholder) VDP results, and the fetcher's mirror read: mine only, full use cases,
 * unchanged VDPs reuse the stored detail, history windows make no call, record-only items for provenance.
 */
import { describe, expect, it } from 'vitest';

import { redact } from '../../src/connectors/redact';
import { VdpClient } from '../../src/connectors/vdp/client';
import { VdpFetcher } from '../../src/connectors/vdp/fetcher';
import { isMine, parseGetUseCase, parseGetVdp, parseSearchResult, withUseCaseDetail } from '../../src/connectors/vdp/parse';
import type { VdpMirrorBatch, VdpMirrorSink, VdpSnapshot } from '../../src/lib/vdp/types';
import { SCAN_CONNECTORS } from '../../src/jobs';
import { deterministicSpec } from '../../src/scanner/runtime/connectors';
import { statusReason } from '../../src/scanner/runtime/status-reason';
import { claudeJson, fixture, fixtureVdp, NOW, PAT_VALUE } from './helpers';

describe('parse', () => {
  it('search_vdps → my VDP list', () => {
    const r = parseSearchResult(fixture('search_vdps'));
    expect(r.total).toBe(3);
    expect(r.rows.map((x) => x.slug)).toEqual(['acme-fy27-q4', 'globex-fy27-q4', 'someone-elses-vdp']);
    expect(r.rows[0]).toMatchObject({ companyName: 'Acme Placeholder', fiscalYear: 27, fiscalQuarter: 4, aes: [{ email: 'ae.placeholder@example.com', name: 'AE Placeholder' }] });
  });

  it('get_vdp → snapshot: header, owners, use-case index, assets, stakeholders; redacted; no user row copied', () => {
    const s = parseGetVdp(fixture('get_vdp_acme'))!;
    expect(s).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'acme-fy27-q4',
      url: 'https://vdp.example.test/vdp/acme-fy27-q4',
      company: { name: 'Acme Placeholder', segment: 'Enterprise' },
      fiscalYear: 27,
      fiscalQuarter: 4,
      salesforceAccountId: '001PLACEHOLDER0001',
      salesforceOpportunityId: '006PLACEHOLDER0001',
      lastActivityAt: '2026-11-05T15:30:00.000Z',
      aes: [{ email: 'ae.placeholder@example.com' }],
      tas: [{ email: 'me@example.com' }],
      collaborators: [{ email: 'collab@example.com', name: 'Collab Placeholder', placeholder: false }],
      stakeholders: [{ name: 'Stakeholder Placeholder', role: 'Champion' }],
      assets: [],
    });
    expect(s.useCases.map((u) => [u.id.slice(-1), u.track, u.hasAi, u.detailLoaded])).toEqual([
      ['1', 'd360', true, false],
      ['2', 'agentforce', false, false],
    ]);
    expect(s.useCases[0]).toMatchObject({ executionPhase: 'Discovery', executionTargetDate: '2027-01-15', executionDurationValue: 3, executionDurationUnit: 'months' });
    expect(JSON.stringify(s)).not.toContain('NEVER_COPY_THIS');
    expect(parseGetVdp({ vdp: null })).toBeNull();
  });

  it('get_use_case → every field, AI fields included', () => {
    const u = parseGetUseCase(fixture('get_use_case_1'))!;
    expect(u).toMatchObject({ title: 'Unified customer profile', priority: '3 - High', division: 'Sales', persona: 'Data team', detailsInput: 'Placeholder details for the unified profile.', hasAi: true, detailLoaded: true, generatedFields: { executive_summary: 'Placeholder summary.' } });
    expect(parseGetUseCase(fixture('get_use_case_2'))).toMatchObject({ persona: null, division: null, detailsInput: null, hasAi: false });
    expect(parseGetUseCase({ use_case: null })).toBeNull();
  });

  it('credential-like text found in VDP is redacted at parse time', () => {
    const v = fixture('get_vdp_acme') as { vdp: Record<string, unknown> };
    const s = parseGetVdp({ vdp: { ...v.vdp, executive_summary: `Login: bearer ${PAT_VALUE}. password: hunter2hunter2` } })!;
    expect(s.executiveSummary).not.toContain(PAT_VALUE);
    expect(s.executiveSummary).not.toContain('hunter2hunter2');
    expect(s.executiveSummary).toContain('[REDACTED');
  });

  it('ids stay exact: a UUID that passes the card rule\'s Luhn check is never redacted (the write tools need it)', () => {
    const s = parseGetVdp(fixture('get_vdp_acme'))!;
    expect(redact('11111111-1111-4111-8111-111111111111').redacted).toBe(true); // why ids are not run through redact()
    expect(s.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(s.useCases[0]!.id).toBe('aaaaaaa1-0000-4000-8000-000000000001');
    expect(parseGetUseCase(fixture('get_use_case_1'))!.id).toBe('aaaaaaa1-0000-4000-8000-000000000001');
  });

  it('isMine: creator, AE, TA or collaborator, case-insensitive', () => {
    const s = parseGetVdp(fixture('get_vdp_acme'))!;
    expect(isMine(s, ['ME@example.com'])).toBe(true);
    expect(isMine(s, ['collab@example.com'])).toBe(true);
    expect(isMine(parseGetVdp(fixture('get_vdp_other'))!, ['me@example.com'])).toBe(false);
    expect(isMine(parseGetVdp(fixture('get_vdp_other'))!, [])).toBe(true);
  });

  it('withUseCaseDetail keeps the index order', () => {
    const s = parseGetVdp(fixture('get_vdp_acme'))!;
    const d = new Map([[s.useCases[1]!.id, { ...parseGetUseCase(fixture('get_use_case_2'))!, displayOrder: 9 }]]);
    const m = withUseCaseDetail(s, d);
    expect(m.useCases.map((u) => [u.detailLoaded, u.displayOrder])).toEqual([
      [false, 0],
      [true, 1],
    ]);
  });
});

class MemorySink implements VdpMirrorSink {
  batches: VdpMirrorBatch[] = [];
  stored = new Map<string, { lastActivityAt: string | null; snapshot: VdpSnapshot | null }>();
  async known() {
    return new Map(this.stored);
  }
  async save(b: VdpMirrorBatch) {
    this.batches.push(b);
    for (const s of b.snapshots) this.stored.set(s.id, { lastActivityAt: s.lastActivityAt, snapshot: s });
    return { written: b.snapshots.length, removed: 0 };
  }
}

const live = { from: new Date(NOW - 30 * 60_000).toISOString(), to: new Date(NOW).toISOString() };
const signal = new AbortController().signal;

describe('VdpFetcher', () => {
  const make = (sink = new MemorySink(), vdp = fixtureVdp()) => ({
    sink,
    vdp,
    f: new VdpFetcher({ client: new VdpClient({ claudeJson: claudeJson({ cookieExpSec: NOW / 1000 + 3600 }), fetch: vdp.fetch, now: () => NOW }), sink, myEmails: ['me@example.com'], clock: () => new Date(NOW) }),
  });

  it('mirrors my VDPs with every use-case field and records one record-only snapshot item per VDP', async () => {
    const { f, sink, vdp } = make();
    const r = await f.fetch('mine', null, live, { signal });
    expect(vdp.calls.map((c) => c.tool)).toEqual(['search_vdps', 'get_vdp', 'get_use_case', 'get_use_case', 'get_vdp', 'get_vdp', 'tools/list']); // D-59: one tools/list per read (feature detection)
    expect(vdp.calls.every((c) => !/^(delete|generate|create|update)_/.test(c.tool))).toBe(true);
    expect(sink.batches).toHaveLength(1);
    const b = sink.batches[0]!;
    expect(b.complete).toBe(true);
    expect(b.snapshots.map((s) => s.slug)).toEqual(['acme-fy27-q4', 'globex-fy27-q4']); // the third is not mine
    expect(b.snapshots[0]!.useCases.every((u) => u.detailLoaded)).toBe(true);
    expect(b.snapshots[0]!.useCases[0]!.detailsInput).toBe('Placeholder details for the unified profile.');
    expect(r.recordOnly).toBe(true);
    expect(r.complete).toBe(true);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ connector: 'vdp', kind: 'record_snapshot', dedupeKey: 'vdp:11111111-1111-4111-8111-111111111111', permalink: 'https://vdp.example.test/vdp/acme-fy27-q4', oppHints: ['006PLACEHOLDER0001'] });
    expect(r.items[0]!.excerpt).toContain('use cases 2 (1 with AI)');
    expect(r.coverage[0]).toMatchObject({ kind: 'query_window', ref: 'vdp:mine', from: live.from, to: live.to });
    expect(r.nextCursor.at).toBe(live.to);
    expect(JSON.stringify(r)).not.toContain(PAT_VALUE);
  });

  it('an unchanged VDP reuses its stored use cases (no get_use_case); a changed one is re-read', async () => {
    const { f, vdp, sink } = make();
    await f.fetch('mine', null, live, { signal });
    vdp.calls.length = 0;
    await f.fetch('mine', null, live, { signal });
    expect(vdp.calls.map((c) => c.tool)).toEqual(['search_vdps', 'get_vdp', 'get_vdp', 'get_vdp', 'tools/list']);
    const acme = sink.stored.get('11111111-1111-4111-8111-111111111111')!;
    sink.stored.set('11111111-1111-4111-8111-111111111111', { ...acme, lastActivityAt: '2026-10-01T00:00:00.000Z' });
    vdp.calls.length = 0;
    await f.fetch('mine', null, live, { signal });
    expect(vdp.calls.filter((c) => c.tool === 'get_use_case')).toHaveLength(2);
  });

  it('a history window (backfill, first scan) makes no VDP call', async () => {
    const { f, vdp, sink } = make();
    const old = { from: '2026-10-10T00:00:00.000Z', to: '2026-11-09T00:00:00.000Z' };
    const r = await f.fetch('mine', null, old, { signal });
    expect(vdp.calls).toEqual([]);
    expect(sink.batches).toEqual([]);
    expect(r).toMatchObject({ items: [], recordOnly: true, complete: true, nextCursor: { at: old.to } });
    expect(r.coverage).toEqual([{ kind: 'query_window', ref: 'vdp:mine', from: old.from, to: old.to, meta: { history: true } }]);
  });

  it('a lapsed cookie fails the run as auth (the runtime pauses VDP and Health shows re-auth)', async () => {
    const sink = new MemorySink();
    const vdp = fixtureVdp();
    const f = new VdpFetcher({ client: new VdpClient({ claudeJson: claudeJson({ cookieExpSec: NOW / 1000 - 5 }), fetch: vdp.fetch, now: () => NOW }), sink, myEmails: [], clock: () => new Date(NOW) });
    await expect(f.fetch('mine', null, live, { signal })).rejects.toThrow(/requires re-auth/);
    expect(vdp.calls).toEqual([]);
    expect(await f.health()).toMatchObject({ state: 'auth_required' });
  });

  it('is a scan connector, current-state, record-only, with a plain status label', () => {
    expect(SCAN_CONNECTORS).toContain('vdp');
    const spec = deterministicSpec(make().f);
    expect(spec).toMatchObject({ connector: 'vdp', initialLookbackMs: 30 * 60_000, maxItemsPerRun: 500 });
    expect(spec.readsCurrentState?.('mine')).toBe(true);
    expect(statusReason('vdp', 'mine', 'VDP requires re-auth (sso_html)', 'auth')).toBe('VDP plans: needs re-auth');
  });
});
