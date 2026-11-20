/**
 * The normalized VDP mirror (shared by src/connectors/vdp, the gap engine and the DataSource): one `VdpSnapshot` per VDP I am on (creator, AE, TA or collaborator), with every
 * use-case field, the stakeholders and the asset list. Pure data (camelCase), credential-redacted at parse time.
 * Shapes follow vdp-app's `get_vdp` / `get_use_case` / `search_vdps` results (research 02 §2-3).
 */

export interface VdpPerson {
  email: string | null;
  name: string | null;
  /** A placeholder user (imported, never signed in). */
  placeholder: boolean;
}

/** The ten human-editable fields `update_use_case` accepts, as VDP names them on the wire. */
export const VDP_USE_CASE_FIELDS = [
  'title',
  'priority',
  'division',
  'persona',
  'details_input',
  'execution_phase',
  'execution_start_date',
  'execution_target_date',
  'execution_duration_value',
  'execution_duration_unit',
] as const;
export type VdpUseCaseField = (typeof VDP_USE_CASE_FIELDS)[number];

/** The header fields `update_vdp_header` accepts. */
export const VDP_HEADER_FIELDS = ['fiscal_year', 'fiscal_quarter', 'salesforce_account_id', 'salesforce_opportunity_id'] as const;
export type VdpHeaderField = (typeof VDP_HEADER_FIELDS)[number];

export const VDP_PRIORITIES = ['3 - High', '2 - Medium', '1 - Low'] as const;
export const VDP_EXECUTION_PHASES = ['Not Started', 'Discovery', 'Build', 'Live', 'On Hold'] as const;
export const VDP_DURATION_UNITS = ['days', 'weeks', 'months'] as const;
export const VDP_TRACKS = ['d360', 'agentforce'] as const;

export interface VdpUseCase {
  id: string;
  track: string;
  displayOrder: number;
  title: string | null;
  priority: string | null;
  division: string | null;
  persona: string | null;
  detailsInput: string | null;
  executionPhase: string | null;
  executionStartDate: string | null;
  executionTargetDate: string | null;
  executionDurationValue: number | null;
  executionDurationUnit: string | null;
  /** AI fields exist (generated in the VDP UI; MCP cannot generate them). */
  hasAi: boolean;
  /** The full AI-generated fields (get_use_case), null until read or when none exist. */
  generatedFields: Record<string, unknown> | null;
  painThemeId: string | null;
  sourceLibraryId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** True once `get_use_case` was read for this version; false = only the get_vdp index row. */
  detailLoaded: boolean;
}

export interface VdpStakeholder {
  id: string;
  name: string;
  title: string | null;
  role: string | null;
  notes: string | null;
}

export interface VdpAsset {
  id: string;
  title: string | null;
  url: string;
  type: string | null;
  description: string | null;
  /**
   * The asset's Deliverable (VDP's lookup: Use Case, Solution/Technical, Consumption…): absent when the read doesn't
   * carry the field (get_vdp today), null when it does and the asset is untagged.
   */
  deliverableType?: string | null;
}

export interface VdpCompany {
  id: string | null;
  name: string;
  slug: string | null;
  industry: string | null;
  segment: string | null;
}

export interface VdpSnapshot {
  id: string;
  slug: string;
  url: string | null;
  company: VdpCompany;
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  salesforceAccountId: string | null;
  /** Deprecated upstream: the first of `salesforceOpportunityIds` (or null). Kept for rows read before the list. */
  salesforceOpportunityId: string | null;
  /**
   * Every Org62 opportunity id on the VDP, primary first (`get_vdp` salesforceOpportunityIds, up to 20). Absent on
   * rows the mirror stored before it read the list: read it through `oppIdsOf`, never directly.
   */
  salesforceOpportunityIds?: string[];
  isSeed: boolean;
  archivedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Newest audit event on the VDP or anything under it (use-case edits included); null when unknown. */
  lastActivityAt: string | null;
  aes: VdpPerson[];
  tas: VdpPerson[];
  createdBy: VdpPerson | null;
  collaborators: VdpPerson[];
  useCases: VdpUseCase[];
  stakeholders: VdpStakeholder[];
  assets: VdpAsset[];
  /** A Deal Contribution note is cached on the VDP (read only; generating one is never called). */
  dcNoteCached: boolean;
  executiveSummary: string | null;
  /**
   * D-63: the entitlement the VDP leverages ('Data Services' | 'Flex' | 'Conversations'), as `get_vdp` returns it.
   * Absent when the read doesn't carry the field (an older server), null when it does and it is empty.
   */
  entitlementLeveraged?: string | null;
}

/** One row of `search_vdps` (my VDP list). */
export interface VdpListRow {
  id: string;
  slug: string;
  companyName: string | null;
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  updatedAt: string | null;
  archived: boolean;
  aes: VdpPerson[];
  tas: VdpPerson[];
}

/** Every Org62 opportunity id on a VDP, primary first: the list when the read carried it, else the single id. */
export function oppIdsOf(v: Pick<VdpSnapshot, 'salesforceOpportunityId'> & { salesforceOpportunityIds?: string[] | null }): string[] {
  const list = (v.salesforceOpportunityIds ?? []).filter((x) => typeof x === 'string' && x.trim() !== '');
  if (list.length) return [...new Set(list)];
  return v.salesforceOpportunityId ? [v.salesforceOpportunityId] : [];
}

/** One tool the VDP MCP server lists (`tools/list`): its name and the argument names its input schema takes. */
export interface VdpServerTool {
  name: string;
  args: string[];
  /**
   * D-69 (VD-32): the arguments its schema requires (`inputSchema.required`). Absent on lists stored before it was
   * kept. A tool that now requires an argument the app does not send is off (disabled with the argument named).
   */
  required?: string[];
}

/** One company `list_companies` returned (substring of the name, slug or an alias, active companies only). */
export interface VdpCompanyMatch {
  id: string;
  name: string;
  slug: string | null;
  /** D-69: the company's other names (VDP's duplicate rule checks them too). Absent on lookups stored before. */
  aliases?: string[];
  /** D-69 (VD-07): `get_company` vdp_count: every VDP VDP holds for it, also the ones I am not on. Absent = not read. */
  vdpCount?: number | null;
  vdpSlugs?: string[];
}

/** One `list_companies` lookup for a name up an engaged account's Org62 chain: does VDP know the company? */
export interface VdpCompanyLookup {
  /** The text searched (D-69: a chain name without its segments and legal suffixes, `companyQuery`). */
  query: string;
  at: string;
  matches: VdpCompanyMatch[];
}

/**
 * What the mirror knows about the VDP server itself (feature detection, D-59), read with the VDPs: the tools it
 * offers (so a newer write tool turns a handoff into an Apply only once VDP has it), the Deliverable lookup when the
 * server exposes one, and which engaged companies exist in VDP. `tools: null` = not read (a failed `tools/list`).
 */
export interface VdpServerInfo {
  tools: VdpServerTool[] | null;
  /** The Deliverable types an asset can carry (labels), from VDP's lookup; null = the server has no such lookup. */
  deliverableTypes: string[] | null;
  /**
   * The asset types an asset can carry (labels: Deck, Doc, Estimate Calculator, …), from the same `list_asset_types`
   * read; an asset's Type is a choice among them. Absent or null = not read (the app's own list stands in).
   */
  assetTypes?: string[] | null;
  companies: VdpCompanyLookup[];
  /**
   * VDP's industry taxonomy, flat (`list_industries`, D-60): a new company carries `industry_category_id` only when the
   * account's industry names exactly one. Absent or null = not read.
   */
  industries?: VdpIndustry[] | null;
  /** D-63: VDP's sales segments (`list_sales_segments`), for a new company's `sales_segment_id`. Absent or null = not read. */
  salesSegments?: VdpSalesSegment[] | null;
  readAt: string;
}

/** One sales segment VDP offers (`list_sales_segments`). */
export interface VdpSalesSegment {
  id: string;
  slug: string | null;
  label: string;
}

/** The values VDP takes for `entitlement_leveraged` (D-63). */
export const VDP_ENTITLEMENTS = ['Data Services', 'Flex', 'Conversations'] as const;

/** One active industry or subcategory (`parentId` null for a top-level one). */
export interface VdpIndustry {
  id: string;
  name: string;
  slug: string | null;
  parentId: string | null;
}

/** What the mirror sink receives after a live read. */
export interface VdpMirrorBatch {
  snapshots: VdpSnapshot[];
  /** Every VDP of mine was read (no page or call limit hit): VDPs missing from it are gone or no longer mine. */
  complete: boolean;
  readAt: string;
  /** The server's tools, lookups and company matches, read with the VDPs; absent = keep what is stored. */
  server?: VdpServerInfo | null;
}

/** The mirror's persistence port (db: src/server/datasource/db/store/vdp.ts). */
export interface VdpMirrorSink {
  /** Last stored activity stamp per VDP id, so unchanged VDPs skip their per-use-case reads. */
  known(): Promise<Map<string, { lastActivityAt: string | null; snapshot: VdpSnapshot | null }>>;
  save(batch: VdpMirrorBatch): Promise<{ written: number; removed: number }>;
  /** The server info stored by the last read (company lookups are reused for a while). */
  server?(): Promise<VdpServerInfo | null>;
  /** D-69: the names up the Org62 chains of my engaged accounts with no VDP, to look up in VDP's company list. */
  companyQueries?(): Promise<string[]>;
}
