/**
 * D-69, the VDP ↔ app ↔ Org62 round trip (docs/EDGE-CASES.md VD-01 to VD-34): the Org62 account hierarchy, the company
 * identity (deterministic evidence, the cached judgment, your mappings), and the push / Outbox guards. Pure engines and
 * fakes only, nothing real is called. Placeholders only.
 */
import { describe, expect, it } from 'vitest';

import type { Draft, VdpCoveragePayload } from '../../src/contract';
import { computeVdpGaps, type GapAccount, type GapOpp } from '../../src/engines/vdp/gaps';
import { identityQueries, overridesOf, withOverride, type IdentityOverride } from '../../src/engines/vdp/identity';
import { judgeIdentityUnits, parseIdentityReply } from '../../src/engines/vdp/identity-judge';
import { goneVdpDrafts, maybeMade } from '../../src/engines/vdp/status';
import { accountNameBase, chainLevels, chainOf, cleanedChainNames, nextHierarchy, parseHierarchyRecords, relation, siblingsOf, unreadParents, type AccountHierarchy } from '../../src/lib/accounts/hierarchy';
import { vdpCapabilities } from '../../src/lib/vdp/capabilities';
import { companyQuery, extendsName, normalizeCompanyName, sameCompanyName } from '../../src/lib/vdp/company-name';
import { vdpActionPayload } from '../../src/lib/vdp/payload';
import type { VdpCompanyLookup, VdpServerInfo, VdpSnapshot } from '../../src/lib/vdp/types';
import { createVdpLimiter, vdpTimeoutFor } from '../../src/connectors/vdp/limiter';
import { SHIPPED_VDP_TOOLS } from '../../src/mock/vdp';
import { siblingFamilies, withOrg62Parents, type MatchAccount } from '../../src/projections/matching';
import { adapterFor } from '../../src/outbox/adapters';
import { deadCompanyIds, removedInVdp, vdpActionForItem } from '../../src/server/vdp/coverage';
import { liveMadeVia, planVdpPush, pushGate } from '../../src/server/vdp/push';
import { NOW, uc, vdp } from './gap-fixtures';

const me = { name: 'Me Placeholder', email: 'me@example.com' };
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const acc = (id: string, name: string, org62: string): GapAccount => ({ id, name, org62AccountId: org62 });
const op = (id: string, accountId: string, org62: string, o: Partial<GapOpp> = {}): GapOpp => ({ id, accountId, name: `Opp ${id}`, org62OpportunityId: org62, isOpen: true, dcSplit: 100, closeDate: '2026-12-15', owner: null, ...o });
const node = (id: string, name: string, parentId: string | null = null) => ({ id: id.slice(0, 15), name, parentId: parentId ? parentId.slice(0, 15) : null });
const tree = (...nodes: ReturnType<typeof node>[]): AccountHierarchy => ({ readAt: NOW, nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), read: nodes.map((n) => n.id) });
const lookup = (query: string, matches: VdpCompanyLookup['matches'] = []): VdpCompanyLookup => ({ query, at: NOW, matches });
const server = (companies: VdpCompanyLookup[]): VdpServerInfo => ({ tools: SHIPPED_VDP_TOOLS, deliverableTypes: null, companies, readAt: NOW });
const gaps = (o: { accounts: GapAccount[]; opps: GapOpp[]; vdps?: VdpSnapshot[]; hierarchy?: AccountHierarchy | null; companies?: VdpCompanyLookup[]; overrides?: IdentityOverride[]; tombstones?: VdpSnapshot[]; judgments?: Parameters<typeof computeVdpGaps>[0]['judgments'] }) => {
  const s = server(o.companies ?? []);
  return computeVdpGaps({ accounts: o.accounts, opps: o.opps, vdps: o.vdps ?? [], me, vdpBaseUrl: 'https://vdp.example.test', now: NOW, server: s, capabilities: vdpCapabilities(s), hierarchy: o.hierarchy ?? null, ...(o.overrides ? { overrides: o.overrides } : {}), ...(o.tombstones ? { tombstones: o.tombstones } : {}), ...(o.judgments ? { judgments: o.judgments } : {}) });
};
const fixOf = (r: ReturnType<typeof computeVdpGaps>, id: string) => [...r.vdps.flatMap((v) => v.gaps), ...r.unlinked].find((g) => g.id === id)?.fix;
const vdpOf = (o: Partial<VdpSnapshot>) => vdp({ aes: [{ email: 'ae@example.com', name: 'AE', placeholder: false }], ...o });

// placeholder Org62 ids (15 characters)
const P = '001PARENT000001';
const C1 = '001CHILD0000001';
const C2 = '001CHILD0000002';

describe('the account hierarchy and VDP’s name rule (pure)', () => {
  it('normalizeCompanyName is vdp-app’s rule: case, accents, . and ,, ONE trailing legal suffix', () => {
    expect(normalizeCompanyName('Élan Corp.')).toBe('elan');
    expect(normalizeCompanyName('Acme, Inc.')).toBe('acme');
    expect(normalizeCompanyName('Acme Holdings Inc')).toBe('acme holdings');
    expect(normalizeCompanyName('  Acme   Retail  Group ')).toBe('acme retail');
    expect(sameCompanyName('ACME Corporation', 'acme')).toBe(true);
    expect(sameCompanyName('Acme Retail', 'Acme')).toBe(false);
  });

  it('cleaned names: " - org/product" segments dropped; the query drops every legal suffix', () => {
    expect(accountNameBase('Acme Corp - Marketing Cloud (EMEA)')).toBe('Acme Corp');
    expect(accountNameBase('Coca-Cola Company')).toBe('Coca-Cola Company');
    expect(companyQuery('Acme Corp, Inc. - EMEA')).toBe('Acme');
    expect(extendsName('Acme Retail Banking', 'Acme')).toBe(true);
    expect(extendsName('Nexus Care', 'Tyrell Holdings')).toBe(false);
  });

  it('the chain (self first, at most five levels), cleaned names, siblings, how two accounts relate', () => {
    const h = tree(node(C1, 'Acme - EMEA', P), node(C2, 'Acme - APAC', P), node(P, 'Acme Corp'));
    expect(chainOf(h, `${C1}AAA`).map((n) => n.name)).toEqual(['Acme - EMEA', 'Acme Corp']);
    expect(cleanedChainNames(h, { name: 'Acme - EMEA', org62AccountId: C1 })).toEqual(['Acme']);
    expect(chainLevels(h, { name: 'Acme - EMEA', org62AccountId: C1 }).map((l) => l.query)).toEqual(['Acme', 'Acme']);
    const book = [{ id: 'a1', name: 'Acme - EMEA', org62AccountId: C1 }, { id: 'a2', name: 'Acme - APAC', org62AccountId: C2 }];
    expect(siblingsOf(h, book, book[0]!).map((a) => a.id)).toEqual(['a2']);
    expect(relation(h, C1, C2)).toBe('sibling');
    expect(relation(h, C1, P)).toBe('ancestor');
    expect(relation(h, P, C1)).toBe('descendant');
    // a cycle stops the walk
    const loop = tree(node(C1, 'A', C2), node(C2, 'B', C1));
    expect(chainOf(loop, C1)).toHaveLength(2);
  });

  it('DC-23 seam: the matcher’s accounts take their Org62 parent from the hierarchy; siblings are a family by parent, whatever their names', () => {
    const h = tree(node(C1, 'Acme - EMEA', P), node(C2, 'Zeta Robotics', P), node(P, 'Acme Corp'));
    const book: MatchAccount[] = [{ id: 'a1', name: 'Acme - EMEA', org62AccountId: C1, aliases: [] }, { id: 'a2', name: 'Zeta Robotics', org62AccountId: C2, aliases: [] }];
    const accs = withOrg62Parents(book, h);
    expect(accs.map((a) => a.parentOrg62AccountId)).toEqual([P, P]);
    expect(siblingFamilies(accs).get('a1')).toBe(siblingFamilies(accs).get('a2'));
    expect(withOrg62Parents(accs, null)).toBe(accs);
  });

  it('the read: records parsed, the next level is the parents not read yet, each read replaces its ids only', () => {
    const recs = parseHierarchyRecords(JSON.stringify({ records: [{ Id: `${C1}AAA`, Name: 'Acme - EMEA', ParentId: `${P}AAA` }, { Id: 'junk', Name: 'x' }] }));
    expect(recs).toEqual([{ id: C1, name: 'Acme - EMEA', parentId: P }]);
    const h1 = nextHierarchy({ readAt: null, nodes: {}, read: [] }, [C1], recs, NOW);
    expect(unreadParents(h1, recs)).toEqual([P]);
    const h2 = nextHierarchy(h1, [P], [{ id: P, name: 'Acme Corp', parentId: null }], NOW);
    expect(Object.keys(h2.nodes).sort()).toEqual([C1, P].sort());
  });
});

describe('company identity (D-69)', () => {
  it('VD-01 a child with a suffix whose parent’s company is in VDP: matched up the chain by VDP’s rule (aliases too), no create', () => {
    const accounts = [acc('K1', 'Globex Placeholder - Marketing Cloud', C1)];
    const opps = [op('Q1', 'K1', '006CHILD0000001')];
    const h = tree(node(C1, 'Globex Placeholder - Marketing Cloud', P), node(P, 'Globex Placeholder, Inc.'));
    // the query is the cleaned name: list_companies returns the parent's company
    expect(identityQueries({ accounts, opps, vdps: [], hierarchy: h })).toEqual(['Globex Placeholder']);
    const r = gaps({ accounts, opps, hierarchy: h, companies: [lookup('Globex Placeholder', [{ id: ID(2), name: 'Globex Placeholder', slug: 'globex' }])] });
    expect(r.unlinked.map((g) => g.fix.kind === 'app' && g.fix.op)).not.toContain('create_company');
    expect(fixOf(r, 'account:K1:company_not_in_vdp')).toMatchObject({ op: 'create_vdp', suggested: ID(2), known: true, unsupported: null });
    // VDP knows it only by an alias: still that company
    const alias = gaps({ accounts, opps, hierarchy: h, companies: [lookup('Globex Placeholder', [{ id: ID(3), name: 'GXP', slug: 'gxp', aliases: ['Globex Placeholder Inc'] }])] });
    expect(fixOf(alias, 'account:K1:company_not_in_vdp')).toMatchObject({ op: 'create_vdp', suggested: ID(3) });
    expect(alias.identity.groups[0]!.identity).toMatchObject({ state: 'resolved', by: 'name', deterministic: true });
  });

  it('VD-02 a name up the chain not looked up yet: the node waits ("Not looked up yet"), nothing pushable under it', () => {
    const accounts = [acc('K1', 'Acme - EMEA', C1)];
    const opps = [op('Q1', 'K1', '006CHILD0000001')];
    const h = tree(node(C1, 'Acme - EMEA', P), node(P, 'Acme Group Global'));
    // level 0 looked up (no match), the parent's name not yet
    const r = gaps({ accounts, opps, hierarchy: h, companies: [lookup('Acme')] });
    expect(r.identity.groups[0]!.identity).toMatchObject({ state: 'not_looked_up' });
    expect(fixOf(r, 'account:K1:company_not_in_vdp')).toMatchObject({ unsupported: 'Not looked up yet: the next VDP read looks the company up in VDP' });
    expect(fixOf(r, 'opp:Q1:opp_without_vdp')).toMatchObject({ unsupported: 'Not looked up yet: the next VDP read looks the company up in VDP' });
  });

  it('VD-03 two child accounts under one parent: one company, one VDP for both (a deterministic create)', () => {
    const accounts = [acc('K1', 'Acme - EMEA', C1), acc('K2', 'Acme - APAC', C2)];
    const opps = [op('Q1', 'K1', '006CHILD0000001'), op('Q2', 'K2', '006CHILD0000002', { closeDate: '2027-01-10' })];
    const h = tree(node(C1, 'Acme - EMEA', P), node(C2, 'Acme - APAC', P), node(P, 'Acme'));
    const r = gaps({ accounts, opps, hierarchy: h, companies: [lookup('Acme')] });
    const creates = r.unlinked.filter((g) => g.fix.kind === 'app' && g.fix.op === 'create_company');
    expect(creates).toHaveLength(1);
    // every name up the chain is "Acme": no alias to send
    expect(creates[0]!.fix).toMatchObject({ suggested: 'Acme', known: true, unsupported: null, values: {} });
    const vdpFix = fixOf(r, 'opp:Q1:opp_without_vdp');
    expect(vdpFix).toMatchObject({ op: 'create_vdp', values: { salesforce_opportunity_ids: ['006CHILD0000001', '006CHILD0000002'], salesforce_account_id: C1 } });
    expect(r.identity.groups).toHaveLength(1);
    expect(r.identity.groups[0]!.accountIds.sort()).toEqual(['K1', 'K2']);
  });

  it('VD-04 a sibling whose opps are already on the other sibling’s VDP: no Create', () => {
    const accounts = [acc('K1', 'Acme - EMEA', C1), acc('K2', 'Acme - APAC', C2)];
    const opps = [op('Q1', 'K1', '006CHILD0000001'), op('Q2', 'K2', '006CHILD0000002')];
    const h = tree(node(C1, 'Acme - EMEA', P), node(C2, 'Acme - APAC', P), node(P, 'Acme'));
    const v = vdpOf({ salesforceAccountId: C1, salesforceOpportunityId: '006CHILD0000001', salesforceOpportunityIds: ['006CHILD0000001', '006CHILD0000002'] });
    const r = gaps({ accounts, opps, vdps: [v], hierarchy: h, companies: [lookup('Acme')] });
    expect(r.unlinked).toEqual([]);
    expect(r.vdps[0]!.gaps.filter((g) => g.code === 'opp_not_on_vdp')).toEqual([]);
  });

  it('VD-05 create_company created:false: one match is the company (its id), several fail (never applied)', () => {
    const a = adapterFor('vdp');
    expect(a.parseWrite({ text: JSON.stringify({ created: false, company: { id: ID(9), name: 'Acme' }, matches: [{ id: ID(9), name: 'Acme' }] }) }, 'send')).toEqual({ externalId: ID(9), link: null, reused: true });
    expect(() => a.parseWrite({ text: JSON.stringify({ created: false, company: null, matches: [{ id: ID(8), name: 'Acme' }, { id: ID(9), name: 'Acme Inc' }] }) }, 'send')).toThrow(/2 companies by that name/);
  });

  it('VD-06 a company merged in VDP: a "not found" create_vdp drops the cached match, the name is looked up again', () => {
    const d = { status: 'failed', destination: { kind: 'action', action: 'vdp.create_vdp', input: { field: 'company_id', value: ID(2), changes: [{ field: 'company_id', value: ID(2) }] } }, attempts: [{ id: '1', at: NOW, mode: 'send', dryRun: false, outcome: 'failed', detail: 'Not found in the destination (merged, archived or deleted there): nothing was sent (not_found). Nothing was sent' }] } as unknown as Draft;
    expect([...deadCompanyIds([d])]).toEqual([ID(2)]);
    // the classifier names it (and does not retry it)
    expect(adapterFor('vdp')).toBeTruthy();
  });

  it('VD-07 VDP holds VDPs for the company that I am not on: "N VDPs you’re not on", never a duplicate create_vdp', () => {
    const accounts = [acc('K1', 'Globex Placeholder', C1)];
    const opps = [op('Q1', 'K1', '006CHILD0000001')];
    const r = gaps({ accounts, opps, hierarchy: tree(node(C1, 'Globex Placeholder')), companies: [lookup('Globex Placeholder', [{ id: ID(2), name: 'Globex Placeholder', slug: 'globex', vdpCount: 2, vdpSlugs: ['g-1', 'g-2'] }])] });
    expect(r.identity.groups[0]!.identity).toMatchObject({ state: 'hidden_vdps', hiddenVdps: 2 });
    expect(fixOf(r, 'account:K1:company_not_in_vdp')).toMatchObject({ op: 'create_vdp', unsupported: expect.stringMatching(/2 VDPs for “Globex Placeholder” that you are not on/) });
  });

  it('VD-10 a VDP made by hand whose header carries the parent’s account id: its plain children re-home there, no Create', () => {
    const accounts = [acc('K1', 'Acme - EMEA', C1)];
    const opps = [op('Q1', 'K1', '006CHILD0000001')];
    const h = tree(node(C1, 'Acme - EMEA', P), node(P, 'Acme'));
    const hand = vdpOf({ salesforceAccountId: P, salesforceOpportunityId: null, salesforceOpportunityIds: [] });
    const r = gaps({ accounts, opps, vdps: [hand], hierarchy: h, companies: [] });
    expect(r.unlinked).toEqual([]);
    expect(r.vdps[0]).toMatchObject({ accountId: 'K1', scope: 'current' });
    expect(r.vdps[0]!.gaps.map((g) => g.id)).toContain('opp:Q1:opp_not_on_vdp');
    // a child with a brand of its own under that parent: never re-homed silently (Needs you, the parent's VDP an option)
    const own = gaps({ accounts: [acc('K2', 'Nexus Care', C2)], opps: [op('Q2', 'K2', '006CHILD0000002')], vdps: [hand], hierarchy: tree(node(C2, 'Nexus Care', P), node(P, 'Acme')), companies: [lookup('Nexus Care')] });
    expect(own.identity.groups.find((g) => g.accountIds.includes('K2'))!.identity).toMatchObject({ state: 'needs_you', pick: { kind: 'create', name: 'Nexus Care' } });
  });

  it('VD-11 a current VDP before my 100% DC: "Waiting for your DC", not Past', () => {
    const accounts = [acc('K1', 'Acme', C1)];
    const opps = [op('Q1', 'K1', '006CHILD0000001', { dcSplit: 50 })];
    const r = gaps({ accounts, opps, vdps: [vdpOf({ salesforceAccountId: C1, salesforceOpportunityIds: ['006CHILD0000001'], salesforceOpportunityId: '006CHILD0000001' })] });
    expect(r.vdps[0]).toMatchObject({ scope: 'waiting_dc', gaps: [] });
  });

  it('VD-12 an opp on two VDPs: create_vdp’s warnings are kept on the item; the later VDP shows a looks-wrong row', async () => {
    const a = adapterFor('vdp');
    const write = a.parseWrite({ text: JSON.stringify({ vdp: { id: ID(5), slug: 'acme-2' }, vdp_url: 'https://vdp.example.test/vdp/acme-2', warnings: ['Opportunity 006X is already on acme-1'] }) }, 'send');
    expect(write).toMatchObject({ externalId: ID(5), warnings: ['Opportunity 006X is already on acme-1'] });
    const payload = vdpActionPayload({ action: 'vdp.create_vdp', input: { vdpSlug: 'account:K1', vdpId: '', field: 'company_id', value: ID(2), changes: [{ field: 'company_id', before: null, value: ID(2) }], itemKey: 'account:K1:create_vdp' } } as never);
    const out = await a.readback(async () => ({ text: JSON.stringify({ vdp: { id: ID(5), company: { id: ID(2) } } }) }), { payload, mode: 'send', write });
    expect(out.detail).toMatch(/VDP warns: Opportunity 006X is already on acme-1/);
  });

  it('VD-13 an opp moved to an account outside the VDP’s company while the header anchors it: flagged (remove, a suggestion)', () => {
    const accounts = [acc('K1', 'Acme', C1), acc('K2', 'Other Placeholder', C2)];
    const opps = [op('Q1', 'K1', '006CHILD0000001'), op('Q2', 'K2', '006CHILD0000002', { dcSplit: null })];
    const v = vdpOf({ salesforceAccountId: C1, salesforceOpportunityId: '006CHILD0000001', salesforceOpportunityIds: ['006CHILD0000001', '006CHILD0000002'] });
    const r = gaps({ accounts, opps, vdps: [v], hierarchy: tree(node(C1, 'Acme'), node(C2, 'Other Placeholder')) });
    expect(r.vdps[0]!.gaps.find((g) => g.id === 'acme:wrong_opp_link:Q2')).toMatchObject({ check: 'wrong', why: 'Opp Q2 is on Other Placeholder, not Acme' });
    // deleted in Org62 (DC-22 tombstoned it): the dead id on the header is flagged, its removal a suggestion
    const s = server([]);
    const dead = computeVdpGaps({ accounts, opps: [opps[0]!], vdps: [v], me, vdpBaseUrl: null, now: NOW, server: s, capabilities: vdpCapabilities(s), hierarchy: tree(node(C1, 'Acme'), node(C2, 'Other Placeholder')), deletedOrg62OppIds: ['006CHILD0000002AAA'] });
    expect(dead.vdps[0]!.gaps.find((g) => g.id === 'acme:wrong_opp_link:gone:006CHILD0000002')).toMatchObject({ check: 'wrong', title: 'Remove a deleted opportunity', fix: { op: 'update_vdp_header', field: 'remove_opportunity_ids', suggested: ['006CHILD0000002'] } });
  });

  it('VD-14 a VDP archived in VDP, or one I am no longer on: tombstoned, Create never comes back', () => {
    const accounts = [acc('K1', 'Acme', C1)];
    const opps = [op('Q1', 'K1', '006CHILD0000001')];
    const gone = vdpOf({ salesforceAccountId: C1, archivedAt: '2026-11-01T00:00:00.000Z' });
    const r = gaps({ accounts, opps, tombstones: [gone], hierarchy: tree(node(C1, 'Acme')), companies: [lookup('Acme', [{ id: ID(1), name: 'Acme', slug: 'acme' }])] });
    expect(r.identity.groups[0]!.identity).toMatchObject({ state: 'tombstoned' });
    expect(fixOf(r, 'account:K1:company_not_in_vdp')).toMatchObject({ unsupported: expect.stringMatching(/^Archived in VDP acme: not created again/) });
  });

  it('VD-01b VDP knows the company by its core ("Northwind" for "Northwind Health, Inc."): looked up, offered as the best guess, never a silent create', () => {
    const accounts = [acc('K1', 'Northwind Health, Inc.', C1)];
    const opps = [op('Q1', 'K1', '006CHILD0000001')];
    const h = tree(node(C1, 'Northwind Health, Inc.'));
    // both texts are looked up: the name list_companies needs, and its core (a substring search never finds the shorter name)
    expect(identityQueries({ accounts, opps, vdps: [], hierarchy: h })).toEqual(['Northwind', 'Northwind Health']);
    // only the long one looked up yet: the node waits
    expect(gaps({ accounts, opps, hierarchy: h, companies: [lookup('Northwind Health')] }).identity.groups[0]!.identity).toMatchObject({ state: 'not_looked_up' });
    const r = gaps({ accounts, opps, hierarchy: h, companies: [lookup('Northwind Health'), lookup('Northwind', [{ id: ID(5), name: 'Northwind', slug: 'northwind' }])] });
    expect(r.identity.groups[0]!.identity).toMatchObject({ state: 'needs_you', pick: { kind: 'match', id: ID(5), name: 'Northwind' } });
    // nothing creates a second company while it is unsure
    expect(r.unlinked.filter((g) => g.fix.kind === 'app' && g.fix.op === 'create_company' && !g.fix.unsupported)).toEqual([]);
  });

  it('VD-01e the core rule stays inside the name family: a subsidiary brand under a parent VDP knows by its core is not guessed as the parent', () => {
    const h = tree(node(C1, 'Carewell', P), node(C2, 'Northwind Health DC/AF', P), node(P, 'Northwind Health, Inc.'));
    const companies = [lookup('Carewell'), lookup('Northwind Health DC/AF'), lookup('Northwind Health'), lookup('Northwind', [{ id: ID(5), name: 'Northwind', slug: 'northwind' }])];
    // a brand of its own under the parent: never pre-selected as the parent's company
    const brand = gaps({ accounts: [acc('K1', 'Carewell', C1)], opps: [op('Q1', 'K1', '006CHILD0000001')], hierarchy: h, companies });
    expect(brand.identity.groups[0]!.identity.pick).toMatchObject({ kind: 'create', name: 'Carewell' });
    // the parent's name with extra words: the parent's core is the best guess
    const variant = gaps({ accounts: [acc('K2', 'Northwind Health DC/AF', C2)], opps: [op('Q2', 'K2', '006CHILD0000002')], hierarchy: h, companies });
    expect(variant.identity.groups[0]!.identity).toMatchObject({ state: 'needs_you', pick: { kind: 'match', id: ID(5) } });
  });

  it('VD-01c a legal name trading as a brand (d/b/a): VDP’s company by the brand is the match, looked up by the brand', () => {
    const accounts = [acc('K1', 'Contoso Physicians Service d/b/a Fabrikam Shield', C1)];
    const opps = [op('Q1', 'K1', '006CHILD0000001')];
    const h = tree(node(C1, 'Contoso Physicians Service d/b/a Fabrikam Shield'));
    expect(identityQueries({ accounts, opps, vdps: [], hierarchy: h })).toContain('Fabrikam Shield');
    const r = gaps({ accounts, opps, hierarchy: h, companies: [lookup('Contoso Physicians Service d/b/a Fabrikam Shield'), lookup('Fabrikam Shield', [{ id: ID(6), name: 'Fabrikam Shield', slug: 'fabrikam' }])] });
    expect(r.identity.groups[0]!.identity).toMatchObject({ state: 'resolved', pick: { kind: 'match', id: ID(6) }, deterministic: true });
    expect(fixOf(r, 'account:K1:company_not_in_vdp')).toMatchObject({ op: 'create_vdp', suggested: ID(6) });
  });

  it('VD-01d a name the judgment would create is looked up first; VDP having it makes it the match, never a duplicate create', async () => {
    const accounts = [acc('K1', 'Nexus Care', C1)];
    const opps = [op('Q1', 'K1', '006CHILD0000001')];
    const h = tree(node(C1, 'Nexus Care', P), node(P, 'Tyrell Holdings'));
    const companies = [lookup('Nexus Care'), lookup('Nexus'), lookup('Tyrell', [{ id: ID(7), name: 'Tyrell Holdings', slug: 'tyrell' }])];
    const unit = gaps({ accounts, opps, hierarchy: h, companies }).identity.pending[0]!;
    const call = async () => ({ ok: true, text: JSON.stringify({ accounts: [{ accountId: 'K1', pick: { kind: 'create', name: 'Nexus Cares' }, level: 0, confidence: 0.9, reason: 'Its public brand' }] }), costUsd: 0.001, inputTokens: 900, outputTokens: 60 });
    const run = await judgeIdentityUnits([unit], call, { now: new Date(NOW), budgetUsd: 0.1 });
    // the proposed name is asked for on the next read, and the node waits for it
    expect(identityQueries({ accounts, opps, vdps: [], hierarchy: h, judgments: run.judgments })).toContain('Nexus Cares');
    expect(gaps({ accounts, opps, hierarchy: h, companies, judgments: run.judgments }).identity.groups[0]!.identity).toMatchObject({ state: 'not_looked_up', pick: { kind: 'create', name: 'Nexus Cares' } });
    // VDP has it: the existing company, not a create
    const has = [...companies, lookup('Nexus Cares', [{ id: ID(8), name: 'Nexus Cares', slug: 'nexus-cares' }])];
    const r = gaps({ accounts, opps, hierarchy: h, companies: has, judgments: run.judgments });
    expect(r.identity.groups[0]!.identity).toMatchObject({ state: 'resolved', by: 'judgment', pick: { kind: 'match', id: ID(8) } });
    expect(r.unlinked.filter((g) => g.fix.kind === 'app' && g.fix.op === 'create_company')).toEqual([]);
  });

  it('the judgment: a sure cached decision is a suggestion (never autopilot’s); an unsure one stays "Needs you" with its pick pre-selected', async () => {
    const accounts = [acc('K1', 'Nexus Care', C1)];
    const opps = [op('Q1', 'K1', '006CHILD0000001')];
    const h = tree(node(C1, 'Nexus Care', P), node(P, 'Tyrell Holdings'));
    // every text a level is looked up with: its name and its core ("Nexus" for "Nexus Care")
    const companies = [lookup('Nexus Care'), lookup('Nexus'), lookup('Tyrell', [{ id: ID(7), name: 'Tyrell Holdings', slug: 'tyrell' }])];
    const before = gaps({ accounts, opps, hierarchy: h, companies });
    expect(before.identity.groups[0]!.identity).toMatchObject({ state: 'needs_you', by: 'rules' });
    expect(before.identity.pending).toHaveLength(1);
    const unit = before.identity.pending[0]!;
    // the model answers through the fake seam; an invented id is refused, a create kept
    const call = async () => ({ ok: true, text: JSON.stringify({ accounts: [{ accountId: 'K1', pick: { kind: 'create', name: 'Nexus Care' }, level: 0, confidence: 0.86, reason: 'Its own brand' }] }), costUsd: 0.001, inputTokens: 900, outputTokens: 60 });
    const run = await judgeIdentityUnits([unit], call, { now: new Date(NOW), budgetUsd: 0.1 });
    expect(run).toMatchObject({ judged: 1, failed: 0 });
    // D0: the batch's content hash (model, skill version, each unit's inputs): the same units hash the same
    expect(run.contentHash).toMatch(/^[0-9a-f]{32}$/);
    expect((await judgeIdentityUnits([unit], call, { now: new Date(Date.parse(NOW) + 60_000), budgetUsd: 0.1 })).contentHash).toBe(run.contentHash);
    const after = gaps({ accounts, opps, hierarchy: h, companies, judgments: run.judgments });
    expect(after.identity.groups[0]!.identity).toMatchObject({ state: 'resolved', by: 'judgment', deterministic: false, pick: { kind: 'create', name: 'Nexus Care' } });
    expect(fixOf(after, 'account:K1:company_not_in_vdp')).toMatchObject({ op: 'create_company', suggested: 'Nexus Care', known: false, unsupported: null });
    expect(after.identity.pending).toEqual([]);
    expect(parseIdentityReply(JSON.stringify({ accounts: [{ accountId: 'K1', pick: { kind: 'match', id: 'invented' }, confidence: 0.9 }] }), unit)).toBeNull();
    const unsure = { ...run.judgments, [unit.key]: { ...run.judgments[unit.key]!, accounts: [{ ...run.judgments[unit.key]!.accounts[0]!, confidence: 0.5 }] } };
    expect(gaps({ accounts, opps, hierarchy: h, companies, judgments: unsure }).identity.groups[0]!.identity).toMatchObject({ state: 'needs_you', by: 'judgment' });
    // a failed reply is remembered for these inputs (never asked in a loop)
    const failed = await judgeIdentityUnits([unit], async () => ({ ok: false, text: '', costUsd: 0, inputTokens: 0, outputTokens: 0 }), { now: new Date(NOW), budgetUsd: 0.1 });
    expect(gaps({ accounts, opps, hierarchy: h, companies, judgments: failed.judgments }).identity.pending).toEqual([]);
  });

  it('several VDP companies with the name: "Needs you", the one with VDPs pre-selected, the others as alternatives', () => {
    const accounts = [acc('K1', 'Cyberdyne Systems - Robotics', C1)];
    const opps = [op('Q1', 'K1', '006CHILD0000001')];
    const r = gaps({ accounts, opps, hierarchy: tree(node(C1, 'Cyberdyne Systems - Robotics')), companies: [lookup('Cyberdyne Systems', [{ id: ID(1), name: 'Cyberdyne Systems', slug: 'c1', vdpCount: 0 }, { id: ID(2), name: 'Cyberdyne Systems, Inc.', slug: 'c2', vdpCount: 3 }])] });
    const id = r.identity.groups[0]!.identity;
    expect(id).toMatchObject({ state: 'needs_you', by: 'name', pick: { kind: 'match', id: ID(2) } });
    expect(id.alternatives.map((a) => a.pick.kind === 'match' && a.pick.id)).toContain(ID(1));
    expect(fixOf(r, 'account:K1:company_not_in_vdp')).toMatchObject({ unsupported: 'Needs you: confirm the VDP company first (Change…)' });
  });

  it('your mapping (Change…) wins every read: a company you picked or typed, the accounts you chose; replacing one moves its accounts', () => {
    const accounts = [acc('K1', 'Soylent Foods', C1), acc('K2', 'Soylent Labs', C2)];
    const opps = [op('Q1', 'K1', '006CHILD0000001'), op('Q2', 'K2', '006CHILD0000002')];
    const mine: IdentityOverride = { key: 'account:K1', accountIds: ['K1', 'K2'], pick: { kind: 'match', id: ID(4), name: 'Soylent Corporation' }, at: NOW };
    const r = gaps({ accounts, opps, hierarchy: tree(node(C1, 'Soylent Foods'), node(C2, 'Soylent Labs')), companies: [lookup('Soylent Foods'), lookup('Soylent Labs')], overrides: [mine] });
    expect(r.identity.groups).toHaveLength(1);
    expect(r.identity.groups[0]!.identity).toMatchObject({ state: 'resolved', by: 'you', deterministic: true, override: { at: NOW } });
    expect(fixOf(r, 'account:K1:company_not_in_vdp')).toMatchObject({ op: 'create_vdp', suggested: ID(4), values: { salesforce_opportunity_ids: ['006CHILD0000001', '006CHILD0000002'] } });
    const next = withOverride([mine], { key: 'account:K2', accountIds: ['K2'], pick: { kind: 'create', name: 'Soylent Labs', aliases: [] }, at: NOW });
    expect(next.map((o) => [o.key, o.accountIds])).toEqual([['account:K2', ['K2']], ['account:K1', ['K1']]]);
    expect(overridesOf({ overrides: next })).toEqual(next);
  });
});

describe('the push and the Outbox (D-69)', () => {
  const cov = (o: Partial<VdpCoveragePayload>) => ({ vdps: [], notInVdp: [], unlinked: [], identities: [], signIn: 'ok', lastReadAt: NOW, ...o }) as unknown as VdpCoveragePayload;

  it('VD-21 the live check before a write: a value changed in VDP refuses it; owners go only while VDP’s list is unchanged', async () => {
    const a = adapterFor('vdp');
    const p = vdpActionPayload({ action: 'vdp.update_use_case', input: { vdpSlug: 'acme', vdpId: 'v1', useCaseId: 'u1', field: 'persona', value: 'Data team', changes: [{ field: 'persona', before: null, value: 'Data team' }], itemKey: 'acme:use_case:u1' } } as never);
    await expect(a.preflight!(async () => ({ text: JSON.stringify({ use_case: { id: 'u1', persona: 'CIO' } }) }), { payload: p, mode: 'send' })).resolves.toMatchObject({ ok: false, code: 'conflict', detail: expect.stringMatching(/Changed in VDP since the last read: persona/) });
    await expect(a.preflight!(async () => ({ text: JSON.stringify({ use_case: { id: 'u1', persona: 'Data team' } }) }), { payload: p, mode: 'send' })).resolves.toMatchObject({ ok: false, code: 'already_in_vdp' });
    await expect(a.preflight!(async () => ({ text: JSON.stringify({ use_case: { id: 'u1', persona: null } }) }), { payload: p, mode: 'send' })).resolves.toEqual({ ok: true });
    const owners = vdpActionPayload({ action: 'vdp.set_vdp_owners', input: { vdpSlug: 'acme', vdpId: 'v1', field: 'technical_architects', value: ['me@example.com'], changes: [{ field: 'technical_architects', before: null, value: ['me@example.com'] }], itemKey: 'acme:owners:ta' } } as never);
    await expect(a.preflight!(async () => ({ text: JSON.stringify({ vdp: { id: 'v1', technicalArchitects: [{ email: 'someone@example.com' }] } }) }), { payload: owners, mode: 'send' })).resolves.toMatchObject({ ok: false, code: 'conflict' });
    await expect(a.preflight!(async () => ({ text: JSON.stringify({ vdp: { id: 'v1', technicalArchitects: [] } }) }), { payload: owners, mode: 'send' })).resolves.toEqual({ ok: true });
  });

  it('VD-22 a live push on a mirror older than 30 minutes is refused (a dry run records); VD-28 so is one while signed out', () => {
    const at = '2026-11-10T19:30:00.000Z';
    expect(pushGate({ signIn: 'ok', lastReadAt: '2026-11-10T19:10:00.000Z' }, Date.parse(at))).toBeNull();
    expect(pushGate({ signIn: 'ok', lastReadAt: NOW }, Date.parse(at))).toMatch(/^The last VDP read is 150 min old/);
    expect(pushGate({ signIn: 'stale', lastReadAt: at }, Date.parse(at))).toMatch(/^Sign in to VDP first/);
    const st = { coverage: cov({ lastReadAt: NOW }), snapshots: [], drafts: new Map() };
    expect(planVdpPush(st, [{ itemKey: 'x' }], { id: 'p', at, dryRun: false }).nodes[0]).toMatchObject({ state: 'failed', detail: 'Not open any more: the VDP view has the latest' });
  });

  it('VD-23 a create that may have reached VDP is "maybe made": never re-sent blind (a single Apply refuses it; a push looks first)', () => {
    const base = { id: 'd1', destination: { kind: 'action', action: 'vdp.create_vdp', input: {} }, updatedAt: NOW, createdAt: NOW };
    expect(maybeMade({ ...base, status: 'failed', attempts: [{ id: '1', at: NOW, mode: 'send', dryRun: false, outcome: 'failed', detail: 'Destination unavailable: retry (transient). Nothing was sent' }] } as never)).toBe(true);
    expect(maybeMade({ ...base, status: 'failed', attempts: [{ id: '1', at: NOW, mode: 'send', dryRun: false, outcome: 'failed', detail: 'Rate limited by the destination: retry shortly (rate_limited)' }] } as never)).toBe(false);
    expect(maybeMade({ ...base, status: 'verify_failed', verification: { state: 'unverified', at: NOW, detail: 'x' }, attempts: [] } as never)).toBe(true);
    expect(maybeMade({ ...base, status: 'verify_failed', verification: { state: 'failed', at: NOW, detail: 'missing' }, attempts: [] } as never)).toBe(false);
    expect(maybeMade({ ...base, destination: { kind: 'action', action: 'vdp.update_vdp_header', input: {} }, status: 'failed', attempts: [{ id: '1', at: NOW, mode: 'send', dryRun: false, outcome: 'failed', detail: '(transient)' }] } as never)).toBe(false);
  });

  it('VD-24 a read landing mid-push withdraws none of the running push’s items', () => {
    const d = { id: 'd1', status: 'ready', destination: { kind: 'action', action: 'vdp.update_vdp_header', input: { itemKey: 'acme:fiscal_period' } }, createdAt: '2026-11-10T16:00:00.000Z' } as unknown as Draft;
    const c = cov({ lastReadAt: NOW });
    expect(goneVdpDrafts(c, [d])).toEqual(['d1']);
    expect(goneVdpDrafts(c, [d], { running: new Set(['d1']) })).toEqual([]);
  });

  it('VD-25 the live check before each create finds what was made by hand: the company, my VDP for the period, the use case', async () => {
    const reads = {
      findCompany: async (q: string) => lookup(q, [{ id: ID(1), name: 'Acme Corp', slug: 'acme', aliases: [] }]),
      vdpsOfCompany: async () => [{ id: ID(5), slug: 'acme-fy27-q4', fiscalYear: 27, fiscalQuarter: 4 }],
      getVdp: async () => vdp({ useCases: [uc('u9', { title: 'Agent – Phase 2' })] }),
    };
    const d = (action: string, changes: Array<{ field: string; value: unknown }>, o: Record<string, unknown> = {}) => ({ destination: { kind: 'action', action, input: { vdpSlug: 'acme', vdpId: 'v1', field: changes[0]!.field, value: changes[0]!.value, changes: changes.map((c) => ({ ...c, before: null })), ...o } } }) as unknown as Draft;
    // VDP's own rule: "ACME Corp." is "Acme Corp" (case, punctuation, one legal suffix)
    await expect(liveMadeVia(reads, { op: 'create_company' }, d('vdp.create_company', [{ field: 'name', value: 'ACME Corp.' }]))).resolves.toEqual({ id: ID(1) });
    await expect(liveMadeVia(reads, { op: 'create_company' }, d('vdp.create_company', [{ field: 'name', value: 'Acme Retail' }]))).resolves.toBeNull();
    await expect(liveMadeVia(reads, { op: 'create_vdp' }, d('vdp.create_vdp', [{ field: 'company_id', value: ID(1) }, { field: 'fiscal_year', value: 27 }, { field: 'fiscal_quarter', value: 4 }]))).resolves.toEqual({ id: ID(5), slug: 'acme-fy27-q4' });
    await expect(liveMadeVia(reads, { op: 'create_vdp' }, d('vdp.create_vdp', [{ field: 'company_id', value: ID(1) }, { field: 'fiscal_year', value: 28 }, { field: 'fiscal_quarter', value: 1 }]))).resolves.toBeNull();
    await expect(liveMadeVia(reads, { op: 'create_use_case' }, d('vdp.create_use_case', [{ field: 'title', value: 'Agent - Phase 1' }]))).resolves.toBeNull();
    await expect(liveMadeVia(reads, { op: 'create_use_case' }, d('vdp.create_use_case', [{ field: 'title', value: 'agent phase 2' }]))).resolves.toEqual({ id: 'u9' });
  });

  it('VD-27 limits: one shared 60/min window, a 120 s timeout for Generate, at most 20 Generates per push', async () => {
    let t = 0;
    const waits: number[] = [];
    const l = createVdpLimiter(2);
    const o = { now: () => t, sleep: async (ms: number) => void (waits.push(ms), (t += ms)) };
    await l.slot(o);
    await l.slot(o);
    await l.slot(o);
    expect(waits).toEqual([60_050]);
    expect(vdpTimeoutFor('generate_use_case')).toBe(120_000);
    expect(vdpTimeoutFor('update_use_case')).toBe(30_000);
  });

  it('VD-30 the Specialist Forecast names an AE the VDP does not list: a looks-wrong row that adds them (never a replace)', () => {
    const accounts = [acc('K1', 'Acme', C1)];
    const opps = [op('Q1', 'K1', '006CHILD0000001')];
    const v = vdpOf({ salesforceAccountId: C1, salesforceOpportunityId: '006CHILD0000001', salesforceOpportunityIds: ['006CHILD0000001'] });
    const s = server([]);
    const r = computeVdpGaps({ accounts, opps, vdps: [v], me, vdpBaseUrl: null, now: NOW, server: s, capabilities: vdpCapabilities(s), aesByOpp: new Map([['Q1', [{ email: 'new.ae@example.com', name: 'New AE', type: 'Data Cloud' }]]]) });
    const g = r.vdps[0]!.gaps.find((x) => x.code === 'ae_not_on_vdp')!;
    expect(g).toMatchObject({ check: 'wrong', fix: { op: 'set_vdp_owners', field: 'account_executives', current: ['ae@example.com'], suggested: ['ae@example.com', 'new.ae@example.com'], known: false } });
  });

  it('VD-31 an asset the app added that VDP no longer shows was removed there: never added again', () => {
    const drafts = new Map([['asset:c1', { id: 'd1', state: 'applied' as const, at: '2026-11-10T15:00:00.000Z' }]]);
    expect([...removedInVdp({ assets: [] }, [{ id: 'c1', url: 'https://docs.example.com/d/1' }], drafts, NOW)]).toEqual(['c1']);
    expect([...removedInVdp({ assets: [{ id: 'a', title: null, url: 'https://docs.example.com/d/1/', type: null, description: null }] }, [{ id: 'c1', url: 'https://docs.example.com/d/1' }], drafts, NOW)]).toEqual([]);
  });

  it('VD-32 a tool that now requires an argument the app never sends turns its items off, the argument named', () => {
    const tools = SHIPPED_VDP_TOOLS.map((t) => (t.name === 'create_vdp' ? { ...t, args: [...t.args, 'website'], required: ['company_id', 'website'] } : t));
    const caps = vdpCapabilities({ tools, deliverableTypes: null, companies: [], readAt: NOW });
    expect(caps).toMatchObject({ createVdp: false, blocked: { create_vdp: "VDP's MCP can't take this yet: create_vdp now requires website" } });
    const accounts = [acc('K1', 'Globex Placeholder', C1)];
    const s: VdpServerInfo = { tools, deliverableTypes: null, companies: [lookup('Globex Placeholder', [{ id: ID(2), name: 'Globex Placeholder', slug: 'g' }])], readAt: NOW };
    const r = computeVdpGaps({ accounts, opps: [op('Q1', 'K1', '006CHILD0000001')], vdps: [], me, vdpBaseUrl: null, now: NOW, server: s, capabilities: caps, hierarchy: tree(node(C1, 'Globex Placeholder')) });
    expect(fixOf(r, 'account:K1:company_not_in_vdp')).toMatchObject({ op: 'create_vdp', unsupported: "VDP's MCP can't take this yet: create_vdp" });
  });

  it('a maybe-made create is refused as a single Apply (only a push, which looks first, sends it again)', () => {
    const c = { vdps: [], notInVdp: [{ key: 'account:K1', accountId: 'K1', opportunityId: null, title: 'Acme is not in VDP', step: { id: 'create_company', kind: 'create_company', title: 'Create Acme in VDP', detail: null, state: 'maybe_made', who: 'app', apply: { key: 'account:K1:create_company', op: 'create_company', fields: [], label: 'Create the company' }, draftId: 'd1', blockedBy: null, blockedReason: null, gaps: [], handoff: null, candidateIds: [], policy: 'auto', suggestion: null, autopilot: null, check: 'missing', requires: [], disabled: null, section: null, parentKey: null }, status: { state: 'open', open: 1, appCanFix: 1, waiting: 0, label: '1 open', nextReadAt: null }, children: [], assetItems: [] }] } as unknown as VdpCoveragePayload;
    expect(() => vdpActionForItem(c, [], { itemKey: 'account:K1:create_company', values: {} })).toThrow(/Maybe made already/);
  });
});
