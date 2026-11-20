/**
 * D-59: one status per VDP (Done · N open · Waiting for VDP to refresh · Past) from its open items, the same everywhere;
 * staged and applied Outbox items matched back to their item; the page's summary and sentence; "Not in VDP yet"; and
 * staging ONE call per item (a whole use case, the fiscal period, a new VDP, an added opp) from the mirror, never from
 * the client's ids. Also: the multi-opp parse, tools/list feature detection and the company lookups. Placeholders only.
 */
import { describe, expect, it } from 'vitest';

import type { Account, Draft, Opportunity } from '../../src/contract';
import { VdpClient } from '../../src/connectors/vdp/client';
import { VdpFetcher } from '../../src/connectors/vdp/fetcher';
import { parseDeliverableTypes, parseGetVdp, parseToolList } from '../../src/connectors/vdp/parse';
import type { VdpMirrorBatch, VdpServerInfo, VdpSnapshot } from '../../src/connectors/vdp/types';
import { vdpDraftRefs, vdpHomeOf, vdpItemKeyOf, vdpStatusOf, vdpStatusSentence, vdpSummary } from '../../src/engines/vdp/status';
import { vdpActionPayload } from '../../src/lib/vdp/payload';
import { oppIdsOf } from '../../src/lib/vdp/types';
import { SHIPPED_VDP_TOOLS } from '../../src/mock/vdp';
import { vdpActionForItem, vdpCoverageFrom } from '../../src/server/vdp/coverage';
import { candidateApply } from '../../src/server/vdp/detail';
import { NOW, uc, vdp } from './gap-fixtures';
import { claudeJson, fixture, fixtureVdp, listed, NOW as CLIENT_NOW } from './helpers';

const READ = '2026-11-10T16:00:00.000Z';

const account = (id: string, name: string, org62: string): Account => ({ id, name, industry: null, dcStatus: 'none', vdpStatus: 'none', hoursQtd: 0, team: [], org62Url: `https://org62.example.test/lightning/r/Account/${org62}/view`, notes: '' }) as unknown as Account;
const opportunity = (id: string, accountId: string, org62: string, o: Partial<Opportunity> = {}): Opportunity =>
  ({ id, accountId, name: `Opp ${id}`, isOpen: true, isMine: true, dcAssigned: true, myDc: { split: 100, role: null, org62DcId: null, lastSeenAt: null }, closeDate: '2026-12-15', owner: { name: 'Owner Placeholder' }, org62Url: `https://org62.example.test/lightning/r/Opportunity/${org62}/view`, ...o }) as unknown as Opportunity;

const accounts = [account('A1', 'Acme Placeholder', '001AAAAAAAAAAAA'), account('A2', 'Globex Placeholder', '001BBBBBBBBBBBB')];
const opps = [opportunity('O1', 'A1', '006AAAAAAAAAAAA'), opportunity('O2', 'A2', '006BBBBBBBBBBBB'), opportunity('O5', 'A1', '006EEEEEEEEEEEE')];
const me = { name: 'Me Placeholder', email: 'me@example.com' };
const server = (o: Partial<VdpServerInfo> = {}): VdpServerInfo => ({ tools: SHIPPED_VDP_TOOLS, deliverableTypes: null, companies: [{ query: 'Globex Placeholder', at: NOW, matches: [{ id: '00000000-0000-4000-8000-0000000000c2', name: 'Globex Placeholder', slug: 'globex' }] }], readAt: NOW, ...o });

const draft = (id: string, action: string, input: Record<string, unknown>, o: Partial<Draft> = {}): Draft =>
  ({ id, status: 'ready', createdAt: NOW, updatedAt: NOW, attempts: [], destination: { kind: 'action', action, target: { label: 'x', url: null }, input, changes: [], text: null }, ...o }) as unknown as Draft;

const cover = (vdps: VdpSnapshot[], drafts: Draft[] = [], o: { server?: VdpServerInfo | null; candidates?: Parameters<typeof vdpCoverageFrom>[0]['assets'] } = {}) =>
  vdpCoverageFrom({ records: vdps.map((s) => ({ snapshot: s, goneAt: null, lastSeenAt: READ })), accounts, opps, me, now: NOW, vdpBaseUrl: 'https://vdp.example.test', drafts, server: o.server === undefined ? server() : o.server, ...(o.candidates ? { assets: o.candidates } : {}) });

const complete = vdp({ salesforceOpportunityIds: ['006AAAAAAAAAAAA', '006EEEEEEEEEEEE'] });

describe('status: one per VDP', () => {
  it('done when nothing is open; N open; waiting once everything left was applied after the last read; past', () => {
    expect(vdpStatusOf([], 'current', READ)).toEqual({ state: 'done', open: 0, appCanFix: 0, waiting: 0, missing: 0, toCheck: 0, label: 'Done', nextReadAt: '2026-11-10T16:30:00.000Z' });
    expect(vdpStatusOf([{ state: 'todo', who: 'app' }, { state: 'staged', who: 'app' }, { state: 'blocked', who: 'you' }, { state: 'waiting', who: 'app' }], 'current', READ)).toMatchObject({ state: 'open', open: 3, appCanFix: 2, waiting: 1, label: '3 open' });
    expect(vdpStatusOf([{ state: 'waiting', who: 'app' }], 'current', READ)).toMatchObject({ state: 'waiting', label: 'Waiting for VDP to refresh', nextReadAt: '2026-11-10T16:30:00.000Z' });
    expect(vdpStatusOf([{ state: 'todo', who: 'you' }], 'past', READ)).toMatchObject({ state: 'past', open: 0, label: 'Past' });
  });

  it('a complete VDP is Done; a missing persona is 1 open the app can fix; staged, then applied → waiting, then the read closes it', () => {
    expect(cover([complete]).vdps[0]!.status).toMatchObject({ state: 'done', label: 'Done' });
    const gap = vdp({ salesforceOpportunityIds: ['006AAAAAAAAAAAA', '006EEEEEEEEEEEE'], useCases: [uc('u1', { persona: null, division: null })] });
    const open = cover([gap]).vdps[0]!;
    expect(open.status).toMatchObject({ state: 'open', open: 1, appCanFix: 1, label: '1 open' });
    expect(open.steps).toMatchObject([{ kind: 'use_case_fields', who: 'app', state: 'todo', apply: { key: 'acme:use_case:u1', op: 'update_use_case' } }]);
    const input = { vdpSlug: 'acme', useCaseId: 'u1', field: 'persona', itemKey: 'acme:use_case:u1' };
    expect(cover([gap], [draft('d1', 'vdp.update_use_case', input)]).vdps[0]!.steps[0]).toMatchObject({ state: 'staged', draftId: 'd1' });
    // a dry-run Apply leaves it staged (nothing reached VDP)
    expect(cover([gap], [draft('d1', 'vdp.update_use_case', input, { attempts: [{ id: 'a', at: NOW, mode: 'send', dryRun: true, outcome: 'rendered' }] })]).vdps[0]!.steps[0]!.state).toBe('staged');
    const applied = draft('d1', 'vdp.update_use_case', input, { status: 'verified', attempts: [{ id: 'a', at: '2026-11-10T16:10:00.000Z', mode: 'send', dryRun: false, outcome: 'sent' }] });
    expect(cover([gap], [applied]).vdps[0]!.status).toMatchObject({ state: 'waiting', label: 'Waiting for VDP to refresh' });
    // applied before the last read and the gap is still there: it didn't take, open again
    const before = draft('d1', 'vdp.update_use_case', input, { status: 'verified', attempts: [{ id: 'a', at: '2026-11-10T15:00:00.000Z', mode: 'send', dryRun: false, outcome: 'sent' }] });
    expect(cover([gap], [before]).vdps[0]!.status.state).toBe('open');
  });

  it('items staged before D-59 (one field, no itemKey) match their item by op, VDP, use case and field', () => {
    expect(vdpItemKeyOf('vdp.update_use_case', { vdpSlug: 'acme', useCaseId: 'u1', field: 'persona' })).toBe('acme:use_case:u1');
    expect(vdpItemKeyOf('vdp.update_vdp_header', { vdpSlug: 'acme', field: 'fiscal_quarter' })).toBe('acme:fiscal_period');
    expect(vdpItemKeyOf('vdp.update_vdp_header', { vdpSlug: 'acme', field: 'salesforce_opportunity_id' })).toBe('acme:link_opp');
    expect(vdpItemKeyOf('vdp.create_use_case', { vdpSlug: 'acme', field: 'title' })).toBe('acme:create_use_case');
    const refs = vdpDraftRefs([draft('d1', 'vdp.update_use_case', { vdpSlug: 'acme', useCaseId: 'u1', field: 'persona' }), draft('d2', 'vdp.update_use_case', { vdpSlug: 'acme', useCaseId: 'u2', field: 'persona' }, { status: 'rejected' }), draft('d3', 'slack_canvas.create', {})]);
    expect([...refs.keys()]).toEqual(['acme:use_case:u1']);
  });

  it('the summary, the head sentence and Home read the same rows', () => {
    const past = vdp({ id: 'v2', slug: 'acme-old', fiscalYear: 26, fiscalQuarter: 2, salesforceOpportunityId: null, salesforceOpportunityIds: [], aes: [] });
    const c = cover([complete, vdp({ id: 'v3', slug: 'acme-q1', fiscalYear: 28, fiscalQuarter: 1, salesforceOpportunityIds: ['006AAAAAAAAAAAA'], tas: [] }), past]);
    expect(c.vdps.map((v) => [v.vdpSlug, v.status.state])).toEqual([
      ['acme-q1', 'open'],
      ['acme', 'done'],
      ['acme-old', 'past'],
    ]);
    // acme-q1 (FY28 Q1) links O1, which closes FY27 Q4: its period looks wrong too (D-60), a second fix the app can make;
    // D-63: Globex's VDP to create and the four items under it that have a call (Find assets is in-app)
    // VD-12: acme-q1 links O1, which acme links too: one opportunity on two VDPs looks wrong on the later one (one more fix)
    expect(c.summary).toEqual({ needYou: 1, waiting: 0, done: 1, past: 1, waitingDc: 0, notInVdp: 1, appCanFix: 8 });
    expect(c.vdps.find((v) => v.vdpSlug === 'acme-q1')!.steps.find((x) => x.kind === 'remove_opp')).toMatchObject({ check: 'wrong', detail: 'Opp O1 is also on acme: one opportunity, one VDP' });
    expect(vdpSummary(c)).toEqual(c.summary);
    expect(vdpStatusSentence(c.summary)).toBe('1 VDP needs you · 1 done · 1 not in VDP yet');
    expect(vdpStatusSentence({ needYou: 3, waiting: 2, done: 9, past: 0, notInVdp: 0, appCanFix: 0 })).toBe('3 VDPs need you · 2 waiting · 9 done');
    expect(vdpHomeOf(c)).toEqual({ summary: c.summary, first: { key: 'acme-q1', label: 'Acme Placeholder' } });
    // a past VDP lists nothing open
    expect(c.vdps.find((v) => v.vdpSlug === 'acme-old')!.steps).toEqual([]);
  });
});

describe('D-63: Not in VDP yet: the VDP (or the company) to create, and what comes under it; an opp to add sits under its VDP', () => {
  it('Globex (company in VDP): create_vdp, then the new VDP’s AE, TA, use case and its Generate; O5 is an "Add" under Acme’s VDP', () => {
    const c = cover([vdp()]); // the VDP links O1 only
    expect(c.notInVdp.map((r) => [r.key, r.step.kind, r.step.apply?.key ?? null])).toEqual([['account:A2', 'create_vdp', 'account:A2:create_vdp']]);
    const row = c.notInVdp[0]!;
    expect(row.children.map((s) => [s.kind, s.apply?.key ?? null, s.requires])).toEqual([
      ['ae', 'account:A2:new_vdp:owners:ae', ['account:A2:create_vdp']],
      ['ta', 'account:A2:new_vdp:owners:ta', ['account:A2:create_vdp']],
      ['create_use_case', 'account:A2:new_vdp:create_use_case', ['account:A2:create_vdp']],
      ['ai_fields', 'account:A2:new_vdp:create_use_case:generate', ['account:A2:create_vdp', 'account:A2:new_vdp:create_use_case']],
      ['find_assets', null, ['account:A2:create_vdp']],
    ]);
    const create = row.step.apply!;
    expect(create.fields.map((f) => [f.field, f.suggested, f.fixed])).toEqual([
      ['company_id', '00000000-0000-4000-8000-0000000000c2', true],
      ['fiscal_year', 27, false],
      ['fiscal_quarter', 4, false],
      ['salesforce_account_id', '001BBBBBBBBBBBB', true],
      ['salesforce_opportunity_ids', ['006BBBBBBBBBBBB'], true],
      // D-69: vdp-app #11 shipped create_vdp's entitlement_leveraged: an optional input on the new VDP
      ['entitlement_leveraged', null, false],
    ]);
    const add = c.vdps[0]!.steps.find((s) => s.kind === 'add_opp')!;
    expect(add).toMatchObject({ title: 'Add Opp O5', section: 'opportunities', apply: { key: 'opp:O5:add' } });
  });

  it('VD-02 no company lookup yet: create_company first, shown disabled ("Not looked up yet") until a read looks it up', () => {
    const c = cover([vdp()], [], { server: null });
    const row = c.notInVdp.find((r) => r.key === 'account:A2')!;
    expect(row.step).toMatchObject({ kind: 'create_company', apply: { key: 'account:A2:create_company', op: 'create_company' }, disabled: 'Not looked up yet: the next VDP read looks the company up in VDP' });
    expect(row.children[0]).toMatchObject({ kind: 'create_vdp', requires: ['account:A2:create_company'], apply: { key: 'account:A2:create_vdp' } });
    expect(c.automation).toMatchObject({ toolsKnown: false, createVdp: true, addOpportunities: true, addAsset: true, setOwners: true });
  });
});

describe('staging: ONE call per item, rebuilt from the mirror', () => {
  const gap = vdp({ salesforceOpportunityIds: ['006AAAAAAAAAAAA', '006EEEEEEEEEEEE'], useCases: [uc('u1', { persona: null, division: null })] });

  it('a use case: every missing input in one update_use_case, each one needed (D-63: no guessed values); a typed value wins', () => {
    const c = cover([gap]);
    const dest = vdpActionForItem(c, [gap], { itemKey: 'acme:use_case:u1', values: { persona: 'Data team', division: 'Service' } });
    expect(dest).toMatchObject({ action: 'vdp.update_use_case', changes: [{ label: 'Division', after: 'Service' }, { label: 'Persona', after: 'Data team' }] });
    const p = vdpActionPayload(dest);
    expect(p).toMatchObject({ item_key: 'acme:use_case:u1', args: { id: 'u1', division: 'Service', persona: 'Data team' } });
    expect(() => vdpActionForItem(c, [gap], { itemKey: 'acme:use_case:u1', values: { persona: 'Data team' } })).toThrow(/Division is needed/);
    expect(() => vdpActionForItem(c, [gap], { itemKey: 'acme:use_case:u1', values: {} })).toThrow(/is needed/);
  });

  it('a new use case: create_use_case with all five inputs and the track; the title is required', () => {
    const none = vdp({ salesforceOpportunityIds: ['006AAAAAAAAAAAA', '006EEEEEEEEEEEE'], useCases: [] });
    const c = cover([none]);
    const p = vdpActionPayload(vdpActionForItem(c, [none], { itemKey: 'acme:create_use_case', values: { track: 'agentforce', title: 'Order status agent', priority: 'high', division: 'Service', persona: 'Agents', details_input: 'Placeholder details.' } }));
    expect(p.args).toEqual({ vdp_id: 'v1', track: 'agentforce', title: 'Order status agent', priority: '3 - High', division: 'Service', persona: 'Agents', details_input: 'Placeholder details.' });
    expect(() => vdpActionForItem(c, [none], { itemKey: 'acme:create_use_case', values: { priority: 'high' } })).toThrow(/Title is needed/);
  });

  it('create_vdp: the company, account, opps and period from the mirror (fixed ids ignore what was typed)', () => {
    const c = cover([vdp()]);
    const dest = vdpActionForItem(c, [vdp()], { itemKey: 'account:A2:create_vdp', values: { salesforce_account_id: '001ZZZZZZZZZZZZ', fiscal_quarter: '1', fiscal_year: '28' } });
    expect(dest.input).toMatchObject({ vdpSlug: 'account:A2', vdpId: '', itemKey: 'account:A2:create_vdp' });
    expect(vdpActionPayload(dest).args).toEqual({ company_id: '00000000-0000-4000-8000-0000000000c2', fiscal_year: 28, fiscal_quarter: 1, salesforce_account_id: '001BBBBBBBBBBBB', salesforce_opportunity_ids: ['006BBBBBBBBBBBB'] });
  });

  it('add the opp: update_vdp_header add_opportunity_ids on the account\'s current VDP; staged twice is refused', () => {
    const c = cover([vdp()]);
    const dest = vdpActionForItem(c, [vdp()], { itemKey: 'opp:O5:add' });
    expect(vdpActionPayload(dest)).toMatchObject({ tool: 'update_vdp_header', vdp_slug: 'acme', args: { vdp_id: 'v1', add_opportunity_ids: ['006EEEEEEEEEEEE'] } });
    const staged = cover([vdp()], [draft('d9', 'vdp.update_vdp_header', dest.input as Record<string, unknown>)]);
    expect(staged.vdps[0]!.steps.find((s) => s.kind === 'add_opp')).toMatchObject({ state: 'staged', draftId: 'd9' });
    expect(() => vdpActionForItem(staged, [vdp()], { itemKey: 'opp:O5:add' })).toThrow(/Already staged/);
    expect(() => vdpActionForItem(c, [vdp()], { itemKey: 'acme:nothing' })).toThrow(/not found/);
  });

  it('the fiscal period is one update_vdp_header with both fields', () => {
    const v = vdp({ fiscalYear: null, fiscalQuarter: null, salesforceOpportunityIds: ['006AAAAAAAAAAAA', '006EEEEEEEEEEEE'] });
    const c = cover([v]);
    expect(vdpActionPayload(vdpActionForItem(c, [v], { itemKey: 'acme:fiscal_period' })).args).toEqual({ vdp_id: 'v1', fiscal_year: 27, fiscal_quarter: 4 });
  });
});

describe('feature detection on and off: asset candidates and owners', () => {
  // the PR's own argument names (vdp-app lib/mcp/server.ts, #10); add_vdp_asset here lists no asset_type
  const pending = { tools: [...SHIPPED_VDP_TOOLS.filter((t) => t.name !== 'add_vdp_asset' && t.name !== 'set_vdp_owners'), { name: 'add_vdp_asset', args: ['deliverable_type', 'description', 'title', 'url', 'vdp_id'] }, { name: 'set_vdp_owners', args: ['account_executives', 'technical_architects', 'vdp_id'] }] };

  it('add_vdp_asset listed: a suggested candidate is its own Apply (only the arguments the schema takes); else none', () => {
    const c = { id: 'c1', status: 'suggested' as const, title: 'ACME deck', url: 'https://docs.google.com/presentation/d/PLACEHOLDER0DECK0000000000001/edit', kind: 'deck' as const, why: 'Shared in #acme-ext' };
    const a = candidateApply(c, { slug: 'acme', server: server(pending), addAsset: true })!;
    expect(a).toMatchObject({ key: 'asset:c1', op: 'add_vdp_asset' });
    expect(a.fields.map((f) => [f.field, f.fixed, f.required])).toEqual([
      ['url', true, true],
      ['title', false, true],
      ['description', false, false],
    ]); // no asset_type: this schema doesn't list it
    expect(candidateApply(c, { slug: 'acme', server: server(), addAsset: false })).toBeNull();
    expect(candidateApply({ ...c, status: 'unsure' }, { slug: 'acme', server: server(pending), addAsset: true })).toBeNull();
    expect(candidateApply(c, { slug: null, server: server(pending), addAsset: true })).toBeNull();
  });

  it('D-63: the AE and the TA are one item each (each set_vdp_owners sends that role only); a server without the tool: disabled', () => {
    const v = vdp({ salesforceOpportunityIds: ['006AAAAAAAAAAAA', '006EEEEEEEEEEEE'], aes: [], tas: [] });
    const c = cover([v], [], { server: server(pending) });
    const steps = c.vdps[0]!.steps;
    expect(steps.filter((s) => s.section === 'people').map((s) => [s.kind, s.apply?.key])).toEqual([
      ['ae', 'acme:owners:ae'],
      ['ta', 'acme:owners:ta'],
    ]);
    // the role's FULL list (the VDP has none), never an empty one; the TA is me
    expect(vdpActionPayload(vdpActionForItem(c, [v], { itemKey: 'acme:owners:ae', values: { account_executives: 'ae.placeholder@example.com, AE2.Placeholder@example.com' } })).args).toEqual({ vdp_id: 'v1', account_executives: ['ae.placeholder@example.com', 'ae2.placeholder@example.com'] });
    expect(vdpActionPayload(vdpActionForItem(c, [v], { itemKey: 'acme:owners:ta' })).args).toEqual({ vdp_id: 'v1', technical_architects: ['me@example.com'] });
    expect(() => vdpActionForItem(c, [v], { itemKey: 'acme:owners:ae' })).toThrow(/AE is needed/);
    const off = cover([v], [], { server: server({ tools: SHIPPED_VDP_TOOLS.filter((t) => t.name !== 'set_vdp_owners') }) }).vdps[0]!.steps.find((s) => s.kind === 'ta')!;
    expect(off).toMatchObject({ apply: { key: 'acme:owners:ta' }, disabled: "VDP's MCP can't take this yet: set_vdp_owners", handoff: null });
    expect(() => vdpActionForItem(cover([v], [], { server: server({ tools: SHIPPED_VDP_TOOLS.filter((t) => t.name !== 'set_vdp_owners') }) }), [v], { itemKey: 'acme:owners:ta' })).toThrow(/can't take this yet/);
  });
});

describe('the connector: multi-opp parse, tools/list, Deliverable types, company lookups', () => {
  it('get_vdp salesforceOpportunityIds → every opp, primary first; the single id falls back', () => {
    const raw = fixture('get_vdp_acme') as { vdp: Record<string, unknown> };
    const multi = parseGetVdp({ vdp: { ...raw.vdp, salesforceOpportunityId: '006PLACEHOLDER0001', salesforceOpportunityIds: ['006PLACEHOLDER0001', '006PLACEHOLDER0007', '006PLACEHOLDER0001'] } })!;
    expect(multi.salesforceOpportunityIds).toEqual(['006PLACEHOLDER0001', '006PLACEHOLDER0007']);
    expect(oppIdsOf(multi)).toEqual(['006PLACEHOLDER0001', '006PLACEHOLDER0007']);
    const single = parseGetVdp(raw)!;
    expect(single.salesforceOpportunityIds).toEqual(['006PLACEHOLDER0001']);
    expect(oppIdsOf({ salesforceOpportunityId: null })).toEqual([]);
  });

  it('tools/list keeps names and argument names only; list_asset_types gives the live Deliverable labels', () => {
    expect(parseToolList({ tools: [listed('get_vdp', ['slug']), { name: 'Bad Name!' }, listed('set_vdp_owners', ['vdp_id', 'account_executives'])] })).toEqual([
      { name: 'get_vdp', args: ['slug'], required: [] },
      { name: 'set_vdp_owners', args: ['account_executives', 'vdp_id'], required: [] },
    ]);
    expect(parseDeliverableTypes({ deliverable_types: [{ label: 'Use Case' }, { label: 'Old', archived: true }, 'Consumption'] })).toEqual(['Use Case', 'Consumption']);
    expect(parseDeliverableTypes({ asset_types: [{ label: 'Deck' }] })).toBeNull();
  });

  it('the read records the server info: tools, Deliverable types once listed, and a lookup per engaged company with no VDP', async () => {
    const vdp = fixtureVdp({ tools: [...SHIPPED_VDP_TOOLS.map((t) => listed(t.name, t.args)), listed('list_asset_types', [])], companies: { 'Initech Placeholder': [{ id: '00000000-0000-4000-8000-0000000000c9', name: 'Initech Placeholder', slug: 'initech' }] } });
    const batches: VdpMirrorBatch[] = [];
    const sink = { known: async () => new Map(), save: async (b: VdpMirrorBatch) => (batches.push(b), { written: b.snapshots.length, removed: 0 }), server: async () => null, companyQueries: async () => ['Initech Placeholder', 'Hooli Placeholder'] };
    const f = new VdpFetcher({ client: new VdpClient({ claudeJson: claudeJson({ cookieExpSec: CLIENT_NOW / 1000 + 3600 }), fetch: vdp.fetch, now: () => CLIENT_NOW }), sink, myEmails: ['me@example.com'], clock: () => new Date(CLIENT_NOW) });
    await f.fetch('mine', null, { from: new Date(CLIENT_NOW - 30 * 60_000).toISOString(), to: new Date(CLIENT_NOW).toISOString() }, { signal: new AbortController().signal });
    const s = batches[0]!.server!;
    expect(s.tools!.map((t) => t.name)).toContain('create_vdp');
    expect(s.deliverableTypes).toEqual(['Use Case', 'Consumption']);
    expect(s.assetTypes).toEqual(['Deck']);
    // D-69: never-asked names first, in name order; up to 10 rows each (a parent's company next to its namesakes)
    expect(s.companies.map((c) => [c.query, c.matches.map((m) => m.id)])).toEqual([
      ['Hooli Placeholder', []],
      ['Initech Placeholder', ['00000000-0000-4000-8000-0000000000c9']],
    ]);
    expect(vdp.calls.filter((c) => c.tool === 'list_companies').map((c) => c.args)).toEqual([
      { q: 'Hooli Placeholder', limit: 10 },
      { q: 'Initech Placeholder', limit: 10 },
    ]);
    // VD-07: the matching company's VDP count is asked (get_company; this fake has none, so the match keeps no count)
    expect(vdp.calls.filter((c) => c.tool === 'get_company').map((c) => c.args)).toEqual([{ slug: 'initech' }]);
    expect(vdp.calls.every((c) => !/^(delete|generate|create|update|add|set)_/.test(c.tool))).toBe(true);
  });

  it('VD-02 lookups: a miss is cached with a TTL, a stale or never-asked name is asked oldest first, within the cap', async () => {
    const vdp = fixtureVdp({ tools: [listed('list_companies', ['q', 'limit']), listed('get_company', ['slug'])], companies: { Gamma: [{ id: '00000000-0000-4000-8000-0000000000d3', name: 'Gamma', slug: 'gamma' }] } });
    const ago = (h: number) => new Date(CLIENT_NOW - h * 3_600_000).toISOString();
    const stored: VdpServerInfo = {
      tools: null,
      deliverableTypes: null,
      readAt: ago(1),
      companies: [
        { query: 'Alpha', at: ago(2), matches: [] }, // a miss 2 h old: fresh (6 h), kept
        { query: 'Beta', at: ago(7), matches: [] }, // a miss 7 h old: stale, asked again
        { query: 'Gamma', at: ago(13), matches: [{ id: '00000000-0000-4000-8000-0000000000d3', name: 'Gamma', slug: 'gamma' }] }, // a match 13 h old: stale
      ],
    };
    const batches: VdpMirrorBatch[] = [];
    const sink = { known: async () => new Map(), save: async (b: VdpMirrorBatch) => (batches.push(b), { written: 0, removed: 0 }), server: async () => stored, companyQueries: async () => ['Alpha', 'Beta', 'Delta', 'Gamma'] };
    const f = new VdpFetcher({ client: new VdpClient({ claudeJson: claudeJson({ cookieExpSec: CLIENT_NOW / 1000 + 3600 }), fetch: vdp.fetch, now: () => CLIENT_NOW }), sink, myEmails: [], clock: () => new Date(CLIENT_NOW), maxCompanyLookups: 2 });
    await f.fetch('mine', null, { from: new Date(CLIENT_NOW - 30 * 60_000).toISOString(), to: new Date(CLIENT_NOW).toISOString() }, { signal: new AbortController().signal });
    // the never-asked one first (Delta), then the oldest stale one (Gamma, 13 h); Beta waits for the next read
    expect(vdp.calls.filter((c) => c.tool === 'list_companies').map((c) => c.args.q)).toEqual(['Delta', 'Gamma']);
    expect(vdp.calls.filter((c) => c.tool === 'get_company' || c.tool === 'list_companies').length).toBe(2);
    const s = batches[0]!.server!;
    // everything known stays (a stale one too, until its turn): no node flips back to "Not looked up yet"
    expect(s.companies.map((c) => c.query).sort()).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
    expect(s.companies.find((c) => c.query === 'Alpha')!.at).toBe(ago(2));
  });

  it('a server without tools/list (an error) keeps the stored info and never fails the read', async () => {
    const vdp = fixtureVdp();
    const failing: typeof fetch = async (u, init) => (JSON.parse(String(init?.body)).method === 'tools/list' ? new Response('nope', { status: 500 }) : vdp.fetch(u, init));
    const stored: VdpServerInfo = { tools: [{ name: 'create_vdp', args: ['company_id'] }], deliverableTypes: null, companies: [], readAt: NOW };
    const batches: VdpMirrorBatch[] = [];
    const sink = { known: async () => new Map(), save: async (b: VdpMirrorBatch) => (batches.push(b), { written: 0, removed: 0 }), server: async () => stored };
    const f = new VdpFetcher({ client: new VdpClient({ claudeJson: claudeJson({ cookieExpSec: CLIENT_NOW / 1000 + 3600 }), fetch: failing, now: () => CLIENT_NOW }), sink, myEmails: [], clock: () => new Date(CLIENT_NOW) });
    await f.fetch('mine', null, { from: new Date(CLIENT_NOW - 30 * 60_000).toISOString(), to: new Date(CLIENT_NOW).toISOString() }, { signal: new AbortController().signal });
    expect(batches[0]!.server!.tools).toEqual(stored.tools);
  });
});
