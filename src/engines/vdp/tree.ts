/**
 * The Changes tree (D-63, pure): Company → VDP → items, from the coverage rows and the Not-in-VDP rows.
 *
 *   company missing in VDP   the company is the top item (its create_company), the VDP to create under it, and that
 *                            VDP's items under it
 *   company in VDP, no VDP   the VDP is the top item (create_vdp: fiscal period, account id and opps in one call), its
 *                            items under it
 *   both exist               only the missing items, under the VDP
 *
 * A company can have several VDPs: each is its own node under the company. Under a VDP the items sit in sections, in
 * this order: Opportunities, People, Use cases (a Generate under its use case's inputs), Assets, Header. Selection
 * and the push order live elsewhere (src/components/time/vdp-tree-derive.ts, src/server/vdp/push.ts); this only shapes.
 */
import { vdpItemRef, type VdpAssetItem, type VdpCompanyIdentity, type VdpCoverageRow, type VdpNotInVdpRow, type VdpSection, type VdpStep, type VdpTreeCompany, type VdpTreeItem, type VdpTreeLeaf, type VdpTreeSection, type VdpTreeVdp } from '@/contract';

import { companyKey } from './gaps';

export const SECTION_ORDER: readonly VdpSection[] = ['opportunities', 'people', 'use_cases', 'assets', 'header'];

/**
 * The order a push applies in (D-63): company → VDP → header → people → opportunities → use cases → Generate →
 * assets. Parents always rank before what needs them, so sorting by rank respects every `requires`.
 */
export function pushRankOf(i: { op: string; section?: VdpSection | null }): number {
  if (i.op === 'create_company') return 0;
  if (i.op === 'create_vdp') return 1;
  if (i.op === 'generate_use_case') return 6;
  if (i.op === 'add_vdp_asset') return 7;
  if (i.section === 'header') return 2;
  if (i.section === 'people' || i.op === 'set_vdp_owners') return 3;
  if (i.section === 'opportunities') return 4;
  if (i.op === 'create_use_case' || i.op === 'update_use_case') return 5;
  return 8;
}
export const SECTION_TITLE: Record<VdpSection, string> = { opportunities: 'Opportunities', people: 'People', use_cases: 'Use cases', assets: 'Assets', header: 'Header' };

const fiscal = (y: number | null, q: number | null) => (y !== null && y !== undefined ? `FY${String(y).padStart(2, '0').slice(-2)}${q ? ` Q${q}` : ''}` : null);

const leafOf = (detailsKey: string, s: VdpStep): VdpTreeLeaf => ({ ref: vdpItemRef(detailsKey, s.id), key: s.apply?.key ?? null, title: s.title, step: s, asset: null });
const assetLeaf = (detailsKey: string, a: VdpAssetItem): VdpTreeLeaf => ({ ref: vdpItemRef(detailsKey, `asset:${a.candidateId}`), key: a.apply?.key ?? null, title: `Add ${a.title}`, step: null, asset: a });

/** The sections of one VDP's items (steps with a section; a step with a parent nests under it). */
export function sectionsOf(detailsKey: string, steps: readonly VdpStep[], assets: readonly VdpAssetItem[]): VdpTreeSection[] {
  const items = new Map<VdpSection, VdpTreeItem[]>();
  const byKey = new Map<string, VdpTreeItem>();
  const put = (sec: VdpSection, it: VdpTreeItem) => items.set(sec, [...(items.get(sec) ?? []), it]);
  const later: VdpStep[] = [];
  for (const s of steps) {
    if (!s.section) continue;
    if (s.parentKey) {
      later.push(s);
      continue;
    }
    const it: VdpTreeItem = { ...leafOf(detailsKey, s), children: [] };
    if (s.apply?.key) byKey.set(s.apply.key, it);
    put(s.section, it);
  }
  for (const s of later) {
    const parent = byKey.get(s.parentKey!);
    if (parent) parent.children.push(leafOf(detailsKey, s));
    else put(s.section!, { ...leafOf(detailsKey, s), children: [] });
  }
  for (const a of assets) put('assets', { ...assetLeaf(detailsKey, a), children: [] });
  return SECTION_ORDER.filter((k) => items.get(k)?.length).map((k) => ({ kind: k, title: SECTION_TITLE[k], items: items.get(k)! }));
}

/** An item still asks for something: open (todo, staged) or waiting for the next read. */
const live = (s: VdpTreeSection[]) => s.some((x) => x.items.length);

/**
 * D-69: each company node carries its identity (which VDP company, how the app decided it, the alternatives), keyed
 * `account:<primary account id>`, the same key as the node.
 */
export function buildVdpTree(cov: { vdps: readonly VdpCoverageRow[]; notInVdp: readonly VdpNotInVdpRow[]; identities?: readonly VdpCompanyIdentity[] }): VdpTreeCompany[] {
  const companies = new Map<string, VdpTreeCompany>();
  const ids = new Map((cov.identities ?? []).map((i) => [i.key, i]));
  const companyFor = (accountId: string | null, name: string): VdpTreeCompany => {
    const key = accountId ? `account:${accountId}` : `company:${companyKey(name) || name}`;
    let c = companies.get(key);
    if (!c) {
      c = { key, accountId, companyName: name, exists: true, node: null, vdps: [], identity: ids.get(key) ?? null };
      companies.set(key, c);
    }
    return c;
  };

  // the companies and VDPs to create first (they come first in the work), then the VDPs that exist
  for (const r of cov.notInVdp) {
    const c = companyFor(r.accountId, r.title.replace(/ (has no VDP|is not in VDP|has no current VDP)$/, ''));
    const all = [r.step, ...r.children];
    const company = all.find((s) => s.kind === 'create_company') ?? null;
    const create = all.find((s) => s.kind === 'create_vdp') ?? null;
    if (company) {
      c.exists = false;
      c.node = leafOf(r.key, company);
    }
    const period = create?.title.match(/FY\d{2} Q\d/)?.[0] ?? null;
    const rest = all.filter((s) => s !== company && s !== create);
    c.vdps.push({
      key: r.key,
      label: `New VDP${period ? ` · ${period}` : ''}`,
      exists: false,
      url: null,
      status: r.status,
      opportunities: [],
      node: create ? leafOf(r.key, create) : null,
      sections: sectionsOf(r.key, rest, r.assetItems ?? []),
    } satisfies VdpTreeVdp);
  }
  for (const v of cov.vdps) {
    if (v.scope !== 'current') continue;
    const sections = sectionsOf(v.vdpSlug, v.steps, v.assetItems ?? []);
    if (!live(sections)) continue;
    const c = companyFor(v.accountId, v.companyName);
    c.vdps.push({ key: v.vdpSlug, label: fiscal(v.fiscalYear, v.fiscalQuarter) ?? 'No fiscal period', exists: true, url: v.url, status: v.status, opportunities: v.opportunityNames, node: null, sections });
  }
  const rank = (c: VdpTreeCompany) => (!c.exists ? 0 : c.vdps.some((v) => !v.exists) ? 1 : 2);
  return [...companies.values()].filter((c) => c.node || c.vdps.length).sort((a, b) => rank(a) - rank(b) || a.companyName.localeCompare(b.companyName));
}
