/**
 * Pure parsers for vdp-app MCP results → the normalized mirror types. Tolerant of both wire spellings (the app's
 * drizzle rows are camelCase, its summaries snake_case) and of missing fields. Free text (titles, inputs, notes,
 * AI fields, summaries) is credential-redacted (SCANNER.md §4.6); identifiers, slugs, urls, dates and enums are not
 * (a UUID can pass the card rule's Luhn check, and an id must stay exact for the write tools). Only the person
 * fields the mirror needs are kept (email, display name, placeholder flag); a collaborator's user row is never copied.
 */
import { redact, redactDeep } from '../redact';
import type { VdpAsset, VdpCompanyLookup, VdpListRow, VdpPerson, VdpServerTool, VdpSnapshot, VdpStakeholder, VdpUseCase } from './types';

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const bool = (v: unknown): boolean => v === true || v === 'true';
/** Free text, redacted. */
const txt = (v: unknown): string | null => {
  const s = str(v);
  return s === null ? null : redact(s).text;
};
/** The first present value of several spellings. */
const get = (o: Obj, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return null;
};
const iso = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
/** A YYYY-MM-DD date (VDP `date` columns), else null. */
const ymd = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

export function personOf(v: unknown): VdpPerson | null {
  const o = obj(v);
  if (!o) return null;
  const email = str(get(o, 'email'));
  const name = txt(get(o, 'displayName', 'display_name', 'name'));
  if (!email && !name) return null;
  return { email: email ? email.toLowerCase() : null, name, placeholder: bool(get(o, 'isPlaceholder', 'is_placeholder')) };
}

const people = (v: unknown): VdpPerson[] => arr(v).map(personOf).filter((p): p is VdpPerson => !!p);

function toUseCase(v: unknown, detail: boolean): VdpUseCase | null {
  const o = obj(v);
  const id = o ? str(get(o, 'id')) : null;
  if (!o || !id) return null;
  const gfRaw = obj(get(o, 'generatedFields', 'generated_fields'));
  const gf = gfRaw ? redactDeep(gfRaw).value : null;
  return {
    id,
    track: str(get(o, 'track')) ?? 'd360',
    displayOrder: num(get(o, 'displayOrder', 'display_order')) ?? 0,
    title: txt(get(o, 'title')),
    priority: str(get(o, 'priority')),
    division: txt(get(o, 'division')),
    persona: txt(get(o, 'persona')),
    detailsInput: txt(get(o, 'detailsInput', 'details_input')),
    executionPhase: str(get(o, 'executionPhase', 'execution_phase')),
    executionStartDate: ymd(get(o, 'executionStartDate', 'execution_start_date')),
    executionTargetDate: ymd(get(o, 'executionTargetDate', 'execution_target_date')),
    executionDurationValue: num(get(o, 'executionDurationValue', 'execution_duration_value')),
    executionDurationUnit: str(get(o, 'executionDurationUnit', 'execution_duration_unit')),
    hasAi: gf !== null || bool(get(o, 'has_ai', 'hasAi')),
    generatedFields: gf,
    painThemeId: str(get(o, 'painThemeId', 'pain_theme_id')),
    sourceLibraryId: str(get(o, 'sourceLibraryId', 'source_library_id')),
    createdAt: iso(get(o, 'createdAt', 'created_at')),
    updatedAt: iso(get(o, 'updatedAt', 'updated_at')),
    detailLoaded: detail,
  };
}

function stakeholderOf(v: unknown): VdpStakeholder | null {
  const o = obj(v);
  const id = o ? str(get(o, 'id')) : null;
  const name = o ? txt(get(o, 'name')) : null;
  if (!o || !id || !name) return null;
  return { id, name, title: txt(get(o, 'title')), role: txt(get(o, 'role')), notes: txt(get(o, 'notes')) };
}

function assetOf(v: unknown): VdpAsset | null {
  const o = obj(v);
  const id = o ? str(get(o, 'id')) : null;
  const url = o ? str(get(o, 'url')) : null;
  if (!o || !id || !url) return null;
  // The Deliverable only when the read carries the field (null = carried, untagged); get_vdp doesn't carry it yet
  const dKey = ['deliverable_type', 'deliverableType', 'deliverableTypeLabel', 'deliverable_type_label', 'deliverable'].find((k) => k in o);
  return { id, title: txt(get(o, 'title')), url, type: str(get(o, 'type', 'assetTypeLabel', 'asset_type')), description: txt(get(o, 'description')), ...(dKey ? { deliverableType: str(o[dKey]) } : {}) };
}

/** An Org62 id list (`salesforceOpportunityIds`): strings only, deduplicated, in VDP's order (primary first). */
const idList = (v: unknown): string[] => [...new Set(arr(v).map(str).filter((x): x is string => !!x))];

/** `search_vdps` → my VDP list (structuredContent `{total, count, results}`). */
export function parseSearchResult(json: unknown): { total: number; rows: VdpListRow[] } {
  const o = obj(json) ?? {};
  const rows: VdpListRow[] = [];
  for (const r of arr(o.results)) {
    const x = obj(r);
    const id = x ? str(x.id) : null;
    const slug = x ? str(x.slug) : null;
    if (!x || !id || !slug) continue;
    rows.push({
      id,
      slug,
      companyName: txt(obj(x.company)?.name),
      fiscalYear: num(x.fiscal_year),
      fiscalQuarter: num(x.fiscal_quarter),
      updatedAt: iso(x.updated_at),
      archived: !!str(x.archived_at),
      aes: people(x.account_executives),
      tas: people(x.technical_architects),
    });
  }
  const total = num(o.total) ?? rows.length;
  return { total, rows };
}

/** `get_vdp` → a snapshot (use cases from the index: `detailLoaded: false`), or null for `{vdp: null}`. */
export function parseGetVdp(json: unknown, list?: Pick<VdpListRow, 'companyName'> & { industry?: string | null; segment?: string | null }): VdpSnapshot | null {
  const v = obj(obj(json)?.vdp);
  const id = v ? str(v.id) : null;
  const slug = v ? str(v.slug) : null;
  if (!v || !id || !slug) return null;
  const company = obj(v.company) ?? {};
  const segment = obj(v.salesSegment);
  const dc = obj(get(v, 'dealContributionNotes', 'deal_contribution_notes'));
  const useCases = arr(get(v, 'use_cases_index', 'useCases', 'use_cases'))
    .map((u) => toUseCase(u, false))
    .filter((u): u is VdpUseCase => !!u)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));
  const snap: VdpSnapshot = {
    id,
    slug,
    url: str(get(v, 'vdp_url', 'url')),
    company: {
      id: str(get(company, 'id')) ?? str(v.companyId),
      name: txt(get(company, 'name')) ?? list?.companyName ?? slug,
      slug: str(get(company, 'slug')),
      industry: str(get(company, 'industryName', 'industry_name', 'industry')) ?? list?.industry ?? null,
      segment: str(segment?.label) ?? list?.segment ?? null,
    },
    fiscalYear: num(get(v, 'fiscalYear', 'fiscal_year')),
    fiscalQuarter: num(get(v, 'fiscalQuarter', 'fiscal_quarter')),
    salesforceAccountId: str(get(v, 'salesforceAccountId', 'salesforce_account_id')),
    salesforceOpportunityId: str(get(v, 'salesforceOpportunityId', 'salesforce_opportunity_id')),
    salesforceOpportunityIds: [],
    isSeed: bool(get(v, 'isSeed', 'is_seed')),
    archivedAt: iso(get(v, 'archivedAt', 'archived_at')),
    createdAt: iso(get(v, 'createdAt', 'created_at')),
    updatedAt: iso(get(v, 'updatedAt', 'updated_at')),
    lastActivityAt: iso(obj(v.lastActivity)?.at) ?? iso(get(v, 'updatedAt', 'updated_at')),
    aes: people(get(v, 'accountExecutives', 'account_executives')),
    tas: people(get(v, 'technicalArchitects', 'technical_architects')),
    createdBy: personOf(v.createdByUser),
    collaborators: arr(v.collaborators)
      .map((c) => personOf(obj(c)?.user ?? c))
      .filter((p): p is VdpPerson => !!p),
    useCases,
    stakeholders: arr(v.stakeholders)
      .map(stakeholderOf)
      .filter((s): s is VdpStakeholder => !!s),
    assets: arr(v.assets)
      .map(assetOf)
      .filter((a): a is VdpAsset => !!a),
    dcNoteCached: !!dc && (!!str(dc.text) || Object.keys(dc).length > 0),
    executiveSummary: txt(get(v, 'executive_summary', 'executiveSummary')),
  };
  // Every opp on the VDP (VDP ≥ multi-opp): the list, primary first; the deprecated single id is its first entry.
  const ids = idList(get(v, 'salesforceOpportunityIds', 'salesforce_opportunity_ids'));
  snap.salesforceOpportunityIds = ids.length ? ids : snap.salesforceOpportunityId ? [snap.salesforceOpportunityId] : [];
  snap.salesforceOpportunityId = snap.salesforceOpportunityIds[0] ?? null;
  // D-63: the entitlement leveraged, only when the read carries the field (an older server leaves it out: no item)
  if ('entitlement_leveraged' in v || 'entitlementLeveraged' in v) snap.entitlementLeveraged = str(get(v, 'entitlement_leveraged', 'entitlementLeveraged'));
  return snap;
}

/** `list_sales_segments` → `{ sales_segments: [{id, slug, label}] }` (D-63), or null when the result carries none. */
export function parseSalesSegments(json: unknown): Array<{ id: string; slug: string | null; label: string }> | null {
  const o = obj(json);
  const out: Array<{ id: string; slug: string | null; label: string }> = [];
  for (const x of o ? arr(get(o, 'sales_segments', 'salesSegments', 'segments')) : Array.isArray(json) ? json : []) {
    const r = obj(x);
    const id = r ? str(get(r, 'id')) : null;
    const label = r ? str(get(r, 'label', 'name')) : null;
    if (!r || !id || !label || bool(get(r, 'archived'))) continue;
    out.push({ id, slug: str(get(r, 'slug')), label });
  }
  return out.length ? out : null;
}

/** `get_use_case` → the full use case (`detailLoaded: true`), or null for `{use_case: null}`. */
export function parseGetUseCase(json: unknown): VdpUseCase | null {
  return toUseCase(obj(json)?.use_case, true);
}

/** Replace index rows with their full detail (same id), keeping the index order. */
export function withUseCaseDetail(snap: VdpSnapshot, details: Map<string, VdpUseCase>): VdpSnapshot {
  return { ...snap, useCases: snap.useCases.map((u) => (details.has(u.id) ? { ...details.get(u.id)!, displayOrder: u.displayOrder } : u)) };
}

/** I am on this VDP: creator, AE, TA or collaborator (emails compared case-insensitively). */
export function isMine(snap: Pick<VdpSnapshot, 'aes' | 'tas' | 'createdBy' | 'collaborators'>, myEmails: string[]): boolean {
  if (!myEmails.length) return true;
  const mine = new Set(myEmails.map((e) => e.toLowerCase()));
  return [...snap.aes, ...snap.tas, ...snap.collaborators, ...(snap.createdBy ? [snap.createdBy] : [])].some((p) => !!p.email && mine.has(p.email));
}

/**
 * `tools/list` → each tool's name and the argument names its input schema takes (feature detection, D-59). Only
 * names are kept: descriptions and schemas are never stored.
 */
export function parseToolList(json: unknown): VdpServerTool[] {
  const out: VdpServerTool[] = [];
  for (const t of arr(obj(json)?.tools)) {
    const o = obj(t);
    const name = o ? str(o.name) : null;
    if (!o || !name || !/^[a-z][a-z0-9_]{0,63}$/.test(name)) continue;
    const schema = obj(get(o, 'inputSchema', 'input_schema'));
    const props = obj(schema?.properties) ?? {};
    // D-69 (VD-32): the arguments the schema requires, so a newly required one turns the tool off instead of failing
    const required = arr(schema?.required).filter((k): k is string => typeof k === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(k)).sort();
    out.push({ name, args: Object.keys(props).filter((k) => /^[a-z][a-z0-9_]{0,63}$/.test(k)).sort(), required });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * `list_companies {q}` → the matches (id, name, slug, aliases), as one lookup for `query`. D-69: the aliases are kept
 * (VDP's duplicate rule checks them, and so does the company identity).
 */
export function parseCompanyLookup(query: string, json: unknown, at: string): VdpCompanyLookup {
  const matches: VdpCompanyLookup['matches'] = [];
  for (const c of arr(obj(json)?.companies)) {
    const o = obj(c);
    const id = o ? str(o.id) : null;
    const name = o ? txt(o.name) : null;
    if (!o || !id || !name) continue;
    const aliases = [...new Set(arr(o.aliases).map(txt).filter((x): x is string => !!x))].slice(0, 50);
    matches.push({ id, name, slug: str(o.slug), aliases });
  }
  return { query, at, matches };
}

/** `get_company {slug}` → its VDP count and slugs (D-69, VD-07: every VDP, also the ones I am not on), or null. */
export function parseCompanyVdps(json: unknown): { id: string | null; vdpCount: number; vdpSlugs: string[] } | null {
  const o = obj(json);
  if (!o || o.company === null) return null;
  const count = num(get(o, 'vdp_count', 'vdpCount'));
  if (count === null) return null;
  return { id: str(obj(o.company)?.id), vdpCount: count, vdpSlugs: arr(get(o, 'vdp_slugs', 'vdpSlugs')).map(str).filter((x): x is string => !!x) };
}

/**
 * `list_industries` → every active industry and subcategory, flat (`parentId` null for a top-level one), or null when
 * the result carries none. Archived entries are left out (the server already drops them).
 */
export function parseIndustries(json: unknown): Array<{ id: string; name: string; slug: string | null; parentId: string | null }> | null {
  const o = obj(json);
  const out: Array<{ id: string; name: string; slug: string | null; parentId: string | null }> = [];
  for (const x of o ? arr(get(o, 'industries')) : []) {
    const r = obj(x);
    const id = r ? str(get(r, 'id')) : null;
    const name = r ? str(get(r, 'name')) : null;
    if (!r || !id || !name || bool(get(r, 'archived'))) continue;
    out.push({ id, name, slug: str(get(r, 'slug')), parentId: null });
    for (const y of arr(get(r, 'subcategories'))) {
      const s = obj(y);
      const sid = s ? str(get(s, 'id')) : null;
      const sname = s ? str(get(s, 'name')) : null;
      if (s && sid && sname && !bool(get(s, 'archived'))) out.push({ id: sid, name: sname, slug: str(get(s, 'slug')), parentId: id });
    }
  }
  return out.length ? out : null;
}

/**
 * `list_asset_types` → the Deliverable labels (VDP's `deliverable_types` lookup, not archived), or null when the
 * result carries none (an older server lists only asset types).
 */
export function parseDeliverableTypes(json: unknown): string[] | null {
  const o = obj(json);
  return lookupLabels(o ? arr(get(o, 'deliverable_types', 'deliverableTypes', 'deliverables')) : []);
}

/**
 * `list_asset_types` → the asset type labels (VDP's `asset_types` lookup, not archived: Deck, Doc, Estimate Calculator,
 * …), or null when the result carries none.
 */
export function parseAssetTypes(json: unknown): string[] | null {
  const o = obj(json);
  return lookupLabels(o ? arr(get(o, 'asset_types', 'assetTypes')) : []);
}

/** A lookup's labels (strings, or rows with a label or name), archived ones left out, each once; null when none. */
function lookupLabels(list: unknown[]): string[] | null {
  const labels = list
    .map((x) => {
      const r = obj(x);
      if (!r) return str(x);
      if (bool(get(r, 'archived'))) return null;
      return str(get(r, 'label', 'name'));
    })
    .filter((x): x is string => !!x);
  return labels.length ? [...new Set(labels)] : null;
}
