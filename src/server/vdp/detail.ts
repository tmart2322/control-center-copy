/**
 * Shared by the mock and db DataSources: one VDP's details (`getVdpDetail`), the asset candidates as the UI and the
 * Assistant read them (each with its "Add <asset> to <VDP>" handoff, and its Apply once VDP lists `add_vdp_asset`),
 * the targets the matcher and "Find assets" work on, and the coverage page's asset summary. Pure: callers load the
 * mirror, the candidates and the budget. The panel's items are the coverage row's own (one source for the card and
 * the panel). Nothing here calls VDP (*tenet: Every handoff is one click away*).
 */
import { accountOfVdpKey, parseVdpRef, vdpKeyOfAccount, type Account, type Opportunity, type VdpApply, type VdpAssetCandidate, type VdpBackfillRun, type VdpBackfillState, type VdpCandidateSource, type VdpCandidateStatus, type VdpCoveragePayload, type VdpCoverageRow, type VdpDetailPayload, type VdpDetailUseCase, type VdpDetailVdp, type VdpAssetKind, type VdpCandidateOrigin } from '@/contract';
import { assetTypeOptions, matchLookup, vdpAssetType, type AssetTarget } from '@/engines/vdp/assets';
import { DEFAULT_REQUIRED_FIELDS, vdpLabel } from '@/engines/vdp/gaps';
import { vdpStatusOf } from '@/engines/vdp/status';
import { itemKey, vdpSteps } from '@/engines/vdp/steps';
import { optionalArgs } from '@/lib/vdp/capabilities';
import { isHttpUrl, VDP_FIELD_LABEL } from '@/lib/vdp/payload';
import { oppIdsOf, type VdpPerson, type VdpServerInfo, type VdpSnapshot, type VdpUseCase } from '@/lib/vdp/types';
import { invalid, notFound } from '@/server/errors';

/** A stored candidate (db row or mock record), before its handoff is built. */
export interface CandidateRecord {
  id: string;
  targetKey: string;
  vdpSlug: string | null;
  accountId: string | null;
  companyName: string;
  title: string;
  url: string;
  assetKey: string;
  kind: VdpAssetKind;
  why: string;
  confidence: number;
  origin: VdpCandidateOrigin;
  status: VdpCandidateStatus;
  sources: VdpCandidateSource[];
  firstSeenAt: string;
  statusAt: string | null;
}

const base = (url: string | null) => (url ? url.replace(/\/+$/, '') : '');
export const newVdpUrlOf = (vdpBaseUrl: string | null) => `${base(vdpBaseUrl)}/vdp/new`;
const tab = (url: string, t: string) => `${url}${url.includes('?') ? '&' : '?'}tab=${t}`;

type SlugRow = Pick<VdpCoverageRow, 'accountId' | 'vdpSlug' | 'fiscalYear' | 'fiscalQuarter' | 'lastActivityAt'> & Partial<Pick<VdpCoverageRow, 'accountIds'>>;

/** Coverage rows with or without their items (the gap engine's rows, or the page's). */
export type CoverageRows = { vdps: readonly Omit<VdpCoverageRow, 'steps' | 'status' | 'summary' | 'assetItems'>[]; unlinked: VdpCoveragePayload['unlinked'] };

/** The VDP each account's candidates go on: its newest live VDP (fiscal period, then last activity). */
export function slugByAccount(rows: readonly SlugRow[]): Map<string, string> {
  const best = new Map<string, SlugRow>();
  const rank = (r: SlugRow) => (r.fiscalYear ?? 0) * 10 + (r.fiscalQuarter ?? 0);
  for (const r of rows) {
    // D-69: every account of the VDP's company group, not only its primary
    for (const a of new Set([...(r.accountId ? [r.accountId] : []), ...(r.accountIds ?? [])])) {
      const cur = best.get(a);
      if (!cur || rank(r) > rank(cur) || (rank(r) === rank(cur) && (r.lastActivityAt ?? '') > (cur.lastActivityAt ?? ''))) best.set(a, r);
    }
  }
  return new Map([...best].map(([a, r]) => [a, r.vdpSlug]));
}

/** The VDP a candidate belongs to now: its own, else its account's newest VDP (one created after it was found). */
export const effectiveSlug = (c: Pick<CandidateRecord, 'vdpSlug' | 'accountId'>, byAccount: ReadonlyMap<string, string>): string | null => c.vdpSlug ?? (c.accountId ? (byAccount.get(c.accountId) ?? null) : null);

/** The details key a candidate shows under. */
export const candidateKey = (c: Pick<CandidateRecord, 'vdpSlug' | 'accountId'>, byAccount: ReadonlyMap<string, string>): string | null => effectiveSlug(c, byAccount) ?? (c.accountId ? vdpKeyOfAccount(c.accountId) : null);

/** The text to paste on the VDP's Assets tab (its form: Type, Title, Link, Description). */
export function assetCopyText(c: Pick<CandidateRecord, 'title' | 'url' | 'kind' | 'why'>): string {
  const type = vdpAssetType(c.kind, c.title, c.url);
  return [`Title: ${c.title}`, `Link (URL): ${c.url}`, type ? `Type: ${type}` : null, `Description: ${c.why}`].filter(Boolean).join('\n');
}

/**
 * The Apply that adds a candidate (`add_vdp_asset`, D-59): the link (fixed), its title, type and description, and only
 * the optional arguments the server's schema lists. Null until VDP lists the tool, for an unsure one, or with no VDP.
 *
 * Type and Deliverable are choices among VDP's own lookups (`list_asset_types`; the type list stands in until it is
 * read), so the editor shows a select: the type the app suggests is preselected, an unknown one is left for you to
 * pick. The Deliverable shows only when VDP lists its types (preselected when the candidate knows it).
 */
export function candidateApply(c: Pick<CandidateRecord, 'id' | 'status' | 'title' | 'url' | 'kind' | 'why'> & { deliverableType?: string | null }, o: { slug: string | null; server: VdpServerInfo | null | undefined; addAsset: boolean }): VdpApply | null {
  // VDP takes absolute http(s) links only (D-60): any other link has no Apply (it is flagged instead)
  if (!o.addAsset || !o.slug || c.status !== 'suggested' || !isHttpUrl(c.url)) return null;
  const opt = new Set(optionalArgs(o.server ?? null, 'add_vdp_asset'));
  const f = (field: string, suggested: string | null, more: { fixed?: boolean; required?: boolean; multiline?: boolean; options?: string[] } = {}) => ({ field, label: VDP_FIELD_LABEL[field] ?? field, current: null, suggested, options: more.options ?? [], required: more.required ?? false, multiline: more.multiline ?? false, fixed: more.fixed ?? false });
  const types = assetTypeOptions(o.server);
  const type = matchLookup(vdpAssetType(c.kind, c.title, c.url), types);
  const deliverables = o.server?.deliverableTypes ?? [];
  const deliverable = matchLookup(c.deliverableType, deliverables);
  return {
    key: itemKey.asset(c.id),
    op: 'add_vdp_asset',
    fields: [
      f('url', c.url, { fixed: true, required: true }),
      f('title', c.title, { required: true }),
      ...(opt.has('asset_type') ? [f('asset_type', type, { options: types })] : []),
      ...(opt.has('deliverable_type') && deliverables.length ? [f('deliverable_type', deliverable, { options: [...deliverables] })] : []),
      ...(opt.has('description') ? [f('description', c.why, { multiline: true })] : []),
    ],
    label: 'Add it to VDP',
  };
}

export function candidateView(c: CandidateRecord, o: { slug: string | null; vdpUrl: string | null; vdpLabel: string | null; vdpBaseUrl: string | null; apply?: VdpApply | null; draftId?: string | null }): VdpAssetCandidate {
  const handoff = o.slug && o.vdpUrl
    ? { kind: 'handoff' as const, label: `Add it on ${o.vdpLabel ?? 'the VDP'}'s Assets tab`, url: tab(o.vdpUrl, 'assets'), copyText: assetCopyText(c) }
    : { kind: 'handoff' as const, label: 'Create the VDP first (New VDP)', url: newVdpUrlOf(o.vdpBaseUrl), copyText: assetCopyText(c) };
  return {
    id: c.id,
    vdpSlug: o.slug,
    accountId: c.accountId,
    companyName: c.companyName,
    title: c.title,
    url: c.url,
    kind: c.kind,
    why: c.why,
    confidence: c.confidence,
    origin: c.origin,
    status: c.status,
    sources: c.sources,
    firstSeenAt: c.firstSeenAt,
    statusAt: c.statusAt,
    handoff,
    apply: o.apply ?? null,
    draftId: o.draftId ?? null,
  };
}

/** unsure → suggested (confirm) | dismissed; suggested → added | dismissed; added → suggested (undo) | dismissed; dismissed → suggested. */
const ALLOWED: Record<VdpCandidateStatus, readonly VdpCandidateStatus[]> = {
  unsure: ['suggested', 'dismissed'],
  suggested: ['added', 'dismissed'],
  added: ['suggested', 'dismissed'],
  dismissed: ['suggested'],
  in_vdp: [],
};

export function checkTransition(from: VdpCandidateStatus, to: VdpCandidateStatus): void {
  if (from === to) return;
  if (from === 'in_vdp') throw invalid('VDP already shows this asset: nothing to change');
  if (!ALLOWED[from].includes(to)) throw invalid(`An asset that is ${from} can't become ${to}`);
}

const ORDER: Record<VdpCandidateStatus, number> = { suggested: 0, unsure: 1, added: 2, in_vdp: 3, dismissed: 4 };
export const sortCandidates = <T extends Pick<CandidateRecord, 'status' | 'confidence' | 'firstSeenAt' | 'title'>>(xs: readonly T[]): T[] =>
  [...xs].sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.confidence - a.confidence || b.firstSeenAt.localeCompare(a.firstSeenAt) || a.title.localeCompare(b.title));

// ---------------------------------------------------------------------------
// Targets: where candidates go (the matcher and "Find assets for all")
// ---------------------------------------------------------------------------

export interface DetailTarget extends AssetTarget {
  /** The details key (VDP slug, or `account:<id>`). */
  detailKey: string;
  /** Names a research run tries (company, account, short forms). */
  names: string[];
}

/** Every VDP of mine (by account when linked) and every engaged account without one. */
export function assetTargets(cov: CoverageRows, snaps: readonly VdpSnapshot[], accounts: ReadonlyArray<Pick<Account, 'id' | 'name'>>): DetailTarget[] {
  const byAccount = slugByAccount(cov.vdps);
  const out = new Map<string, DetailTarget>();
  const snapOf = new Map(snaps.map((s) => [s.slug, s]));
  const assetsOf = (slug: string) => (snapOf.get(slug)?.assets ?? []).map((a) => ({ url: a.url, title: a.title }));
  for (const v of cov.vdps) {
    const key = v.accountId ?? `vdp:${v.vdpSlug}`;
    if (v.accountId && byAccount.get(v.accountId) !== v.vdpSlug) continue; // an older VDP of the account: the newest takes its assets
    const acc = v.accountId ? accounts.find((a) => a.id === v.accountId) : undefined;
    out.set(key, { key, detailKey: v.vdpSlug, accountId: v.accountId, vdpSlug: v.vdpSlug, companyName: v.companyName, inVdp: assetsOf(v.vdpSlug), names: [...new Set([v.companyName, acc?.name].filter((x): x is string => !!x))] });
  }
  for (const g of cov.unlinked) {
    if (g.code !== 'company_not_in_vdp' || !g.accountId || out.has(g.accountId)) continue;
    const acc = accounts.find((a) => a.id === g.accountId);
    const name = acc?.name ?? g.title.replace(/ has no VDP$/, '');
    out.set(g.accountId, { key: g.accountId, detailKey: vdpKeyOfAccount(g.accountId), accountId: g.accountId, vdpSlug: null, companyName: name, inVdp: [], names: [name] });
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// The coverage page's asset summary
// ---------------------------------------------------------------------------

export function assetsSummary(cov: CoverageRows, cands: readonly CandidateRecord[], o: { targets: number; perRunUsd: number; runUsd: number; dayLeftUsd: number; running: number }): VdpCoveragePayload['assets'] {
  const byAccount = slugByAccount(cov.vdps);
  const byKey: Record<string, { toAdd: number; toConfirm: number }> = {};
  let toAdd = 0;
  let toConfirm = 0;
  for (const c of cands) {
    if (c.status !== 'suggested' && c.status !== 'unsure') continue;
    const k = candidateKey(c, byAccount);
    if (!k) continue;
    const t = (byKey[k] ??= { toAdd: 0, toConfirm: 0 });
    if (c.status === 'suggested') {
      t.toAdd += 1;
      toAdd += 1;
    } else {
      t.toConfirm += 1;
      toConfirm += 1;
    }
  }
  return { byKey, toAdd, toConfirm, targets: o.targets, perRunUsd: o.perRunUsd, runUsd: o.runUsd, dayLeftUsd: Math.max(0, Math.round(o.dayLeftUsd * 100) / 100), running: o.running };
}

// ---------------------------------------------------------------------------
// One VDP's details
// ---------------------------------------------------------------------------

const personView = (p: VdpPerson) => ({ name: p.name, email: p.email });
const ucTitle = (u: VdpUseCase) => u.title?.trim() || `Untitled ${u.track === 'agentforce' ? 'Agentforce' : 'D360'} use case`;
const UC_VALUE: Record<string, (u: VdpUseCase) => unknown> = { title: (u) => u.title, priority: (u) => u.priority, division: (u) => u.division, persona: (u) => u.persona, details_input: (u) => u.detailsInput, execution_phase: (u) => u.executionPhase, execution_target_date: (u) => u.executionTargetDate };

function useCaseView(u: VdpUseCase): VdpDetailUseCase {
  const missing = DEFAULT_REQUIRED_FIELDS.filter((f) => !(f === 'details_input' && !u.detailLoaded)).filter((f) => {
    const v = UC_VALUE[f]?.(u);
    return v === null || v === undefined || String(v).trim() === '';
  });
  return {
    id: u.id,
    track: u.track,
    title: ucTitle(u),
    priority: u.priority,
    division: u.division,
    persona: u.persona,
    details: u.detailsInput,
    executionPhase: u.executionPhase,
    executionStartDate: u.executionStartDate,
    executionTargetDate: u.executionTargetDate,
    duration: u.executionDurationValue !== null && u.executionDurationValue !== undefined ? `${u.executionDurationValue} ${u.executionDurationUnit ?? ''}`.trim() : null,
    hasAi: u.hasAi,
    aiFields: Object.keys(u.generatedFields ?? {}).sort(),
    missing: missing.map((f) => VDP_FIELD_LABEL[f] ?? f),
    detailLoaded: u.detailLoaded,
  };
}

export function vdpView(s: VdpSnapshot, url: string | null): VdpDetailVdp {
  return {
    slug: s.slug,
    id: s.id,
    url,
    companyName: s.company.name,
    industry: s.company.industry,
    fiscalYear: s.fiscalYear,
    fiscalQuarter: s.fiscalQuarter,
    salesforceAccountId: s.salesforceAccountId,
    salesforceOpportunityId: s.salesforceOpportunityId,
    salesforceOpportunityIds: oppIdsOf(s),
    isSeed: s.isSeed,
    lastActivityAt: s.lastActivityAt,
    executiveSummary: s.executiveSummary,
    aes: s.aes.map(personView),
    tas: s.tas.map(personView),
    collaborators: s.collaborators.map(personView),
    createdBy: s.createdBy ? personView(s.createdBy) : null,
    useCases: [...s.useCases].sort((a, b) => a.displayOrder - b.displayOrder).map(useCaseView),
    assets: s.assets.map((a) => ({ id: a.id, title: a.title, url: a.url, type: a.type, description: a.description })),
    stakeholders: s.stakeholders.map((x) => ({ name: x.name, title: x.title, role: x.role })),
  };
}

export interface DetailInput {
  key: string;
  coverage: VdpCoveragePayload;
  snapshots: readonly VdpSnapshot[];
  accounts: readonly Account[];
  opps: readonly Opportunity[];
  candidates: readonly CandidateRecord[];
  backfill: { last: VdpBackfillRun | null } & Omit<VdpBackfillState, 'last'>;
  /** The server info (add_vdp_asset's optional arguments) and the staged / applied asset items by item key. */
  server?: VdpServerInfo | null;
  assetDrafts?: ReadonlyMap<string, { id: string }>;
}

export function vdpDetailFrom(i: DetailInput): VdpDetailPayload {
  const cov = i.coverage;
  const byAccount = slugByAccount(cov.vdps);
  // D-60: `<key>#<item id>` names one item (a Changes row, the Assistant's ref): the same panel, that item first
  const ref = parseVdpRef(i.key);
  const key = ref.key;
  const accountId = accountOfVdpKey(key);
  const backfill: VdpDetailPayload['backfill'] = { last: i.backfill.last, perRunUsd: i.backfill.perRunUsd, dayLeftUsd: Math.max(0, Math.round(i.backfill.dayLeftUsd * 100) / 100), available: i.backfill.available, note: i.backfill.note };
  const accountRef = (id: string | null) => {
    const a = id ? i.accounts.find((x) => x.id === id) : undefined;
    return a ? { id: a.id, name: a.name } : null;
  };
  const oppRef = (id: string | null) => {
    const o = id ? i.opps.find((x) => x.id === id) : undefined;
    return o ? { id: o.id, name: o.name } : null;
  };

  if (accountId) {
    const account = accountRef(accountId);
    const gaps = cov.unlinked.filter((g) => g.accountId === accountId);
    if (!account && !gaps.length) throw notFound('Account', accountId);
    const companyName = account?.name ?? gaps[0]!.title.replace(/ has no VDP$/, '');
    const mine = sortCandidates(i.candidates.filter((c) => c.accountId === accountId && !effectiveSlug(c, byAccount)));
    const views = mine.map((c) => candidateView(c, { slug: null, vdpUrl: null, vdpLabel: null, vdpBaseUrl: cov.vdpBaseUrl }));
    // The same items as the page's Not-in-VDP row (D-63: the company or VDP to create, and what comes under it)
    const row = cov.notInVdp.find((r) => r.key === key);
    const steps = row ? [row.step, ...(row.children ?? [])] : vdpSteps({ key, companyName, vdpLabel: null, gaps, candidates: [], useCases: [], newVdpUrl: newVdpUrlOf(cov.vdpBaseUrl) });
    return {
      key,
      companyName,
      account,
      opportunity: oppRef(gaps[0]?.opportunityId ?? null),
      vdp: null,
      gaps,
      steps,
      status: vdpStatusOf(steps, 'current', cov.lastReadAt),
      candidates: views,
      backfill,
      lastReadAt: cov.lastReadAt,
      vdpBaseUrl: cov.vdpBaseUrl,
      focus: ref.stepId && steps.some((s) => s.id === ref.stepId) ? ref.stepId : null,
      summary: null,
      autopilot: cov.autopilot,
    };
  }

  const row = cov.vdps.find((v) => v.vdpSlug === key);
  const snap = i.snapshots.find((s) => s.slug === key);
  if (!row || !snap) throw notFound('VDP', key);
  const label = vdpLabel(snap);
  const mine = sortCandidates(i.candidates.filter((c) => effectiveSlug(c, byAccount) === row.vdpSlug));
  // D-63: a seed VDP listed here is one I am on: writable like any other
  const addAsset = cov.automation.addAsset && row.scope === 'current';
  const views = mine.map((c) => candidateView(c, { slug: row.vdpSlug, vdpUrl: row.url, vdpLabel: label, vdpBaseUrl: cov.vdpBaseUrl, apply: candidateApply(c, { slug: row.vdpSlug, server: i.server, addAsset }), draftId: i.assetDrafts?.get(itemKey.asset(c.id))?.id ?? null }));
  const view = vdpView(snap, row.url);
  return {
    key,
    companyName: row.companyName,
    account: accountRef(row.accountId),
    opportunity: oppRef(row.opportunityId),
    vdp: view,
    gaps: row.gaps,
    // the coverage row's own items: the card and the panel list the same things
    steps: row.steps,
    status: row.status,
    candidates: views,
    backfill,
    lastReadAt: cov.lastReadAt,
    vdpBaseUrl: cov.vdpBaseUrl,
    focus: ref.stepId && (row.steps.some((s) => s.id === ref.stepId) || (row.assetItems ?? []).some((a) => `asset:${a.candidateId}` === ref.stepId)) ? ref.stepId : null,
    summary: row.summary ?? null,
    autopilot: cov.autopilot,
  };
}
