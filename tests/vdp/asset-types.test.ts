/**
 * The owner, 2026-11-14: "I can't change the asset type for certain things. It's literally not clickable as a
 * dropdown." An asset's Type and Deliverable are VDP's own lookups (`list_asset_types`): the Apply carries them as
 * choices (the editor's select), the app's suggestion preselected in VDP's spelling, the app's list standing in until
 * the server's is read; a typed value outside the lookup is refused before anything is staged. Placeholders only.
 */
import { describe, expect, it } from 'vitest';

import { parseAssetTypes, parseDeliverableTypes } from '../../src/connectors/vdp/parse';
import { assetTypeOptions, matchLookup, VDP_ASSET_TYPES, vdpAssetType } from '../../src/engines/vdp/assets';
import { vdpActionPayload } from '../../src/lib/vdp/payload';
import type { VdpServerInfo } from '../../src/lib/vdp/types';
import { MOCK_DELIVERABLE_TYPES, mockVdpServer, SHIPPED_VDP_TOOLS } from '../../src/mock/vdp';
import { vdpActionForItem, vdpCoverageFrom } from '../../src/server/vdp/coverage';
import { candidateApply } from '../../src/server/vdp/detail';
import { NOW, vdp } from './gap-fixtures';

const server = (o: Partial<VdpServerInfo> = {}): VdpServerInfo => ({ tools: SHIPPED_VDP_TOOLS, deliverableTypes: null, companies: [], readAt: NOW, ...o });
const cand = (o: Partial<Parameters<typeof candidateApply>[0]> = {}): Parameters<typeof candidateApply>[0] => ({ id: 'c1', status: 'suggested', title: 'Placeholder solution overview', url: 'https://docs.google.com/presentation/d/PLACEHOLDER0DECK0000000000001/edit', kind: 'deck', why: 'Shared in the placeholder channel', ...o });
const fieldOf = (a: ReturnType<typeof candidateApply>, f: string) => a?.fields.find((x) => x.field === f);

/** VDP's lookup as `list_asset_types` serves it (one label in VDP's own spelling, one archived). */
const LISTED = ['Deck', 'Doc', 'Estimate Calculator', 'Architecture DIagram', 'Consumption Card'];

describe('the asset type is a choice among VDP’s types', () => {
  it('parses both lookups of list_asset_types', () => {
    const json = { asset_types: [{ label: 'Deck' }, { label: 'Old type', archived: true }, 'Doc', { name: 'Demo Org' }], deliverable_types: [{ label: 'Use Case' }] };
    expect(parseAssetTypes(json)).toEqual(['Deck', 'Doc', 'Demo Org']);
    expect(parseDeliverableTypes(json)).toEqual(['Use Case']);
    expect(parseAssetTypes({ deliverable_types: [{ label: 'Use Case' }] })).toBeNull();
  });

  it('the Type field carries VDP’s list as its options and preselects the suggestion in VDP’s spelling', () => {
    const a = candidateApply(cand({ title: 'Placeholder architecture diagram', kind: 'doc' }), { slug: 'acme', server: server({ assetTypes: LISTED }), addAsset: true });
    expect(fieldOf(a, 'asset_type')).toMatchObject({ options: LISTED, suggested: 'Architecture DIagram', fixed: false, required: false });
  });

  it('before the server’s list is read, the app’s own list stands in (every type it suggests is on it)', () => {
    const a = candidateApply(cand(), { slug: 'acme', server: server(), addAsset: true });
    expect(fieldOf(a, 'asset_type')).toMatchObject({ options: [...VDP_ASSET_TYPES], suggested: 'Deck' });
    expect(assetTypeOptions(null)).toEqual([...VDP_ASSET_TYPES]);
    for (const [kind, title, url] of [
      ['deck', 'Deck', null],
      ['sheet', 'Consumption card', null],
      ['sheet', 'Pricing estimate', null],
      ['sheet', 'Rollout planning', null],
      ['doc', 'BVD', null],
      ['doc', 'RFP response', null],
      ['link', 'Repo', 'https://github.com/placeholder/repo'],
      ['demo', 'Demo', null],
      ['recording', 'Demo walkthrough', null],
      ['canvas', 'Canvas', null],
    ] as const) {
      const t = vdpAssetType(kind, title, url);
      expect(matchLookup(t, VDP_ASSET_TYPES), `${kind} ${title} → ${t}`).toBe(t);
    }
  });

  it('a link the app can’t type still gets the Type choice, with nothing preselected', () => {
    const a = candidateApply(cand({ kind: 'link', title: 'Placeholder page', url: 'https://example.com/page' }), { slug: 'acme', server: server({ assetTypes: LISTED }), addAsset: true });
    expect(fieldOf(a, 'asset_type')).toMatchObject({ options: LISTED, suggested: null });
  });

  it('a type VDP doesn’t list is not preselected (you pick one of VDP’s)', () => {
    const a = candidateApply(cand({ kind: 'canvas', title: 'Placeholder canvas' }), { slug: 'acme', server: server({ assetTypes: ['Deck', 'Doc'] }), addAsset: true });
    expect(fieldOf(a, 'asset_type')).toMatchObject({ options: ['Deck', 'Doc'], suggested: null });
  });

  it('the Deliverable is a choice once VDP lists its types (preselected when the candidate knows it); none without the list', () => {
    const deliverables = ['Use Case', 'Solution/Technical', 'QBR'];
    const a = candidateApply({ ...cand(), deliverableType: 'qbr' }, { slug: 'acme', server: server({ assetTypes: LISTED, deliverableTypes: deliverables }), addAsset: true });
    expect(fieldOf(a, 'deliverable_type')).toMatchObject({ options: deliverables, suggested: 'QBR' });
    expect(fieldOf(candidateApply(cand(), { slug: 'acme', server: server({ deliverableTypes: deliverables }), addAsset: true }), 'deliverable_type')).toMatchObject({ suggested: null, options: deliverables });
    expect(fieldOf(candidateApply(cand(), { slug: 'acme', server: server(), addAsset: true }), 'deliverable_type')).toBeUndefined();
  });

  it('the mock server lists placeholder asset and Deliverable types, so the mock shows the same selects', () => {
    const s = mockVdpServer([], [], [], NOW);
    expect(s.assetTypes).toEqual([...VDP_ASSET_TYPES]);
    expect(s.deliverableTypes).toEqual([...MOCK_DELIVERABLE_TYPES]);
  });
});

describe('staging an asset: the Type you pick is sent as VDP spells it; anything else is refused', () => {
  const snap = vdp();
  const cov = vdpCoverageFrom({ records: [{ snapshot: snap, goneAt: null, lastSeenAt: NOW }], accounts: [], opps: [], me: { name: 'Me Placeholder', email: 'me@example.com' }, now: NOW, vdpBaseUrl: 'https://vdp.example.test', drafts: [], server: server({ assetTypes: LISTED }) });
  const apply = candidateApply(cand(), { slug: snap.slug, server: server({ assetTypes: LISTED }), addAsset: true })!;
  const views = [{ id: 'c1', vdpSlug: snap.slug, title: 'Placeholder solution overview', apply, draftId: null }];
  const args = (values: Record<string, string>) => vdpActionPayload(vdpActionForItem(cov, [snap], { itemKey: 'asset:c1', values }, views)).args;

  it('the suggestion goes as is; a changed one goes in VDP’s spelling', () => {
    expect(args({})).toMatchObject({ vdp_id: snap.id, asset_type: 'Deck' });
    expect(args({ asset_type: 'architecture diagram' })).toMatchObject({ asset_type: 'Architecture DIagram' });
    expect(args({ asset_type: 'Estimate Calculator' })).toMatchObject({ asset_type: 'Estimate Calculator' });
  });

  it('a type VDP does not list is refused before anything is staged', () => {
    expect(() => args({ asset_type: 'Spreadsheet' })).toThrow(/Type is one of VDP's: Deck, Doc/);
  });
});
