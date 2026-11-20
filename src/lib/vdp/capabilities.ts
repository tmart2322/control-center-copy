/**
 * What the app can do in VDP over MCP (D-59, D-63), from the server's own tool list (`tools/list`, read with the
 * mirror). Pure. Once the list is read, a capability is on only when the tool is listed AND its input schema takes
 * every argument the app would send, so a renamed argument turns the item off (disabled, with the reason) instead of
 * failing on Apply.
 *
 *   shipped (upstream main; on while the list is unknown)   create_vdp · update_vdp_header add_opportunity_ids and
 *                                                           remove_opportunity_ids · create_use_case / update_use_case ·
 *                                                           create_company · add_vdp_asset · set_vdp_owners ·
 *                                                           generate_use_case · list_asset_types · list_industries ·
 *                                                           list_companies (reads) · D-69: vdp-app #11 (merged and
 *                                                           deployed 2026-11-12) update_vdp_header / create_vdp
 *                                                           `entitlement_leveraged` · create_company `sales_segment_id`
 *                                                           + list_sales_segments
 *   Once a list is stored it governs: a listed server without one of them turns its items off again (disabled, named).
 *
 * D-63 root cause: the live mirror had never stored a tool list (VDP sign-in lapsed before the first read after
 * vdp_server shipped), and the old default kept create_company, add_vdp_asset, set_vdp_owners and generate_use_case
 * off while the list was unknown, so every one of those was a handoff. They ship upstream: they are on until a stored
 * list says otherwise.
 *
 * `generate_deal_contribution_notes` is never a capability: no decision allows it (D-46 / D-59), and the DC note is an
 * auto-generated field the app no longer tracks (D-63).
 *
 * The argument names are the upstream tools' own (vdp-app lib/mcp/server.ts):
 *   create_company     name; optional website, aliases, industry_category_id (the industry only when
 *                      `list_industries` names the account's industry exactly once, D-60), sales_segment_id (D-63)
 *   add_vdp_asset      vdp_id, url, title; optional asset_type, deliverable_type (id, slug or label), description
 *   set_vdp_owners     vdp_id; account_executives / technical_architects: each the role's FULL list, primary first
 *                      (user ids or emails, at most 20; [] clears it, so the app never sends an empty one)
 *   generate_use_case  vdp_id, use_case_id; optional regenerate (never sent: only a use case with no AI fields)
 *   list_asset_types   no arguments (a read)
 */
import type { VdpServerInfo, VdpServerTool } from './types';

export interface VdpCapabilities {
  /** The server's tool list was read (false: the shipped tools are assumed on, the new D-63 ones off). */
  known: boolean;
  createVdp: boolean;
  addOpportunities: boolean;
  /** update_vdp_header `remove_opportunity_ids` (a closed-lost linked opp, D-63: a suggestion). */
  removeOpportunities: boolean;
  createCompany: boolean;
  addAsset: boolean;
  setOwners: boolean;
  generateUseCase: boolean;
  /** update_vdp_header `entitlement_leveraged` (D-63, new upstream). */
  entitlementHeader: boolean;
  /** create_vdp `entitlement_leveraged` (D-63, new upstream). */
  entitlementCreate: boolean;
  /** create_company `sales_segment_id` with `list_sales_segments` (D-63, new upstream). */
  salesSegment: boolean;
  /**
   * D-69 (VD-32): write tools whose schema now REQUIRES an argument the app never sends, with the reason ("VDP's MCP
   * can't take this yet: create_vdp now requires website"). Their items show disabled; none while the list is unknown.
   */
  blocked?: Partial<Record<string, string>>;
}

/** Every argument the app may send per write tool (D-69, VD-32): a required argument outside this list turns it off. */
export const APP_SENDS: Readonly<Record<string, readonly string[]>> = {
  create_company: ['name', 'aliases', 'industry_category_id', 'sales_segment_id'],
  add_vdp_asset: ['vdp_id', 'url', 'title', 'asset_type', 'deliverable_type', 'description'],
  set_vdp_owners: ['vdp_id', 'account_executives', 'technical_architects'],
  generate_use_case: ['vdp_id', 'use_case_id'],
  create_vdp: ['company_id', 'fiscal_year', 'fiscal_quarter', 'salesforce_account_id', 'salesforce_opportunity_id', 'salesforce_opportunity_ids', 'entitlement_leveraged'],
  update_vdp_header: ['vdp_id', 'fiscal_year', 'fiscal_quarter', 'salesforce_account_id', 'salesforce_opportunity_id', 'add_opportunity_ids', 'remove_opportunity_ids', 'entitlement_leveraged'],
  create_use_case: ['vdp_id', 'track', 'title', 'priority', 'division', 'persona', 'details_input', 'execution_phase', 'execution_start_date', 'execution_target_date', 'execution_duration_value', 'execution_duration_unit'],
  update_use_case: ['id', 'title', 'priority', 'division', 'persona', 'details_input', 'execution_phase', 'execution_start_date', 'execution_target_date', 'execution_duration_value', 'execution_duration_unit'],
};

/** The required arguments of a listed tool the app never sends (VD-32), else []. */
export function unmetRequired(info: VdpServerInfo | null | undefined, name: string): string[] {
  const t = info?.tools?.find((x) => x.name === name);
  const sends = APP_SENDS[name];
  if (!t || !sends || !Array.isArray(t.required)) return [];
  return t.required.filter((a) => !sends.includes(a));
}

/** Arguments each write tool must take (the app sends these); optional ones are sent only when listed. */
export const PENDING_TOOL_ARGS = {
  // D-60: industry_category_id only on an unambiguous list_industries match; D-63: sales_segment_id only when listed
  // D-69: aliases (the other names up the Org62 chain), sent only when listed
  create_company: { required: ['name'], optional: ['aliases', 'industry_category_id', 'sales_segment_id'] },
  add_vdp_asset: { required: ['vdp_id', 'url', 'title'], optional: ['asset_type', 'deliverable_type', 'description'] },
  // both role lists must be listed: an item sets one role
  set_vdp_owners: { required: ['vdp_id', 'account_executives', 'technical_architects'], optional: [] },
  generate_use_case: { required: ['vdp_id', 'use_case_id'], optional: [] },
  create_vdp: { required: ['company_id'], optional: ['entitlement_leveraged'] },
} as const satisfies Record<string, { required: readonly string[]; optional: readonly string[] }>;

export type PendingVdpTool = keyof typeof PENDING_TOOL_ARGS;

const toolOf = (info: VdpServerInfo | null, name: string): VdpServerTool | null => info?.tools?.find((t) => t.name === name) ?? null;

/** The tool is listed and takes every required argument. */
export function hasTool(info: VdpServerInfo | null, name: PendingVdpTool): boolean {
  const t = toolOf(info, name);
  return !!t && PENDING_TOOL_ARGS[name].required.every((a) => t.args.includes(a));
}

/** The tool is listed and its schema takes this argument (false while the list is unknown). */
export function hasArg(info: VdpServerInfo | null | undefined, tool: string, arg: string): boolean {
  const t = toolOf(info ?? null, tool);
  return !!t && t.args.includes(arg);
}

/** The optional arguments of a write tool that the server's schema takes (the rest are left out of the call). */
export function optionalArgs(info: VdpServerInfo | null, name: PendingVdpTool): string[] {
  const t = toolOf(info, name);
  return t ? PENDING_TOOL_ARGS[name].optional.filter((a) => t.args.includes(a)) : [];
}

/**
 * While the tool list is unknown: everything upstream main ships is on (D-63), and since vdp-app #11 shipped (D-69,
 * 2026-11-12) so are the entitlement and the sales segment. A stored list governs once read.
 */
export const NO_SERVER_INFO: VdpCapabilities = {
  known: false,
  createVdp: true,
  addOpportunities: true,
  removeOpportunities: true,
  createCompany: true,
  addAsset: true,
  setOwners: true,
  generateUseCase: true,
  entitlementHeader: true,
  entitlementCreate: true,
  salesSegment: true,
};

export function vdpCapabilities(info: VdpServerInfo | null | undefined): VdpCapabilities {
  if (!info?.tools) return NO_SERVER_INFO;
  const header = toolOf(info, 'update_vdp_header');
  // VD-32: a tool that now requires an argument the app does not send is off, with that argument named
  const blocked: Partial<Record<string, string>> = {};
  for (const name of Object.keys(APP_SENDS)) {
    const miss = unmetRequired(info, name);
    if (miss.length) blocked[name] = unsupportedReason(`${name} now requires ${miss.join(', ')}`);
  }
  const ok = (name: string) => !blocked[name];
  return {
    known: true,
    createVdp: !!toolOf(info, 'create_vdp') && ok('create_vdp'),
    addOpportunities: !!header && header.args.includes('add_opportunity_ids') && ok('update_vdp_header'),
    removeOpportunities: !!header && header.args.includes('remove_opportunity_ids') && ok('update_vdp_header'),
    createCompany: hasTool(info, 'create_company') && ok('create_company'),
    addAsset: hasTool(info, 'add_vdp_asset') && ok('add_vdp_asset'),
    setOwners: hasTool(info, 'set_vdp_owners') && ok('set_vdp_owners'),
    generateUseCase: hasTool(info, 'generate_use_case') && ok('generate_use_case'),
    entitlementHeader: !!header && header.args.includes('entitlement_leveraged') && ok('update_vdp_header'),
    entitlementCreate: hasArg(info, 'create_vdp', 'entitlement_leveraged') && ok('create_vdp'),
    salesSegment: hasArg(info, 'create_company', 'sales_segment_id') && !!toolOf(info, 'list_sales_segments') && ok('create_company'),
    blocked,
  };
}

/** Why an item is shown but can't be pushed yet (D-63): the tool or argument VDP's MCP does not list. */
export const unsupportedReason = (what: string) => `VDP's MCP can't take this yet: ${what}`;
