/**
 * The VDP MCP tool allowlists (vdp-app-fir, research 02 §3). Default deny: a tool on neither list is refused before
 * a byte is sent, so a new or renamed upstream tool never becomes callable by accident.
 *
 *  - READ: everything the connector, the gap check and read-back may call (`list_asset_types` only once the server
 *    lists it: feature detection, src/lib/vdp/capabilities.ts).
 *  - WRITE: the writes the Outbox may make, one call per approved item (*tenet: Nothing leaves without approval*).
 *    D-46 gave it the field writes; D-59 adds `create_vdp`, header `add_opportunity_ids` and whole use cases, plus the
 *    pending upstream tools (`create_company`, `add_vdp_asset`, `set_vdp_owners`, `generate_use_case`), which an item
 *    only names when the server's own tool list has them. Only `src/connectors/vdp/write.ts` passes `kind: 'write'`,
 *    and only `src/outbox/**` imports it (guard test).
 *  - NEVER: deletes and every other AI generation. `generate_deal_contribution_notes` writes on a cache miss, so it
 *    is treated as a write and refused outright, as is every `delete_*` (permanent in VDP). `generate_use_case` is
 *    the one generation D-59 allows (the use case's own Generate, as an Apply). Stakeholder writes are on neither list.
 */

export const VDP_SERVER_NAME = 'vdp-app-fir';

export const VDP_READ_TOOLS = Object.freeze([
  'search_vdps',
  'semantic_search',
  'list_companies',
  'get_company',
  'get_vdp',
  'list_use_cases',
  'get_use_case',
  'get_vdp_assets',
  'search_library',
  // Read-only: builds the Use_Case__c CSV text from stored rows (no AI, no write).
  'export_use_cases_salesforce_csv',
  // Read-only lookup of asset and Deliverable types (pending upstream; called only when the server lists it).
  'list_asset_types',
  // Read-only industry taxonomy (D-60): create_company's industry_category_id, only on an unambiguous match.
  'list_industries',
  // Read-only sales segments (D-63): create_company's sales_segment_id, called only once the server lists it.
  'list_sales_segments',
] as const);
export type VdpReadTool = (typeof VDP_READ_TOOLS)[number];

export const VDP_WRITE_TOOLS = Object.freeze(['update_use_case', 'create_use_case', 'update_vdp_header', 'create_vdp', 'create_company', 'add_vdp_asset', 'set_vdp_owners', 'generate_use_case'] as const);
export type VdpWriteTool = (typeof VDP_WRITE_TOOLS)[number];

/** Never callable from this app, whatever a list says: every delete, and every generation but a use case's (D-59). */
export const VDP_NEVER = /^(?:delete_|generate_(?!use_case$))/;

export type VdpToolKind = 'read' | 'write';

export class VdpToolRefusedError extends Error {
  override name = 'VdpToolRefusedError';
  constructor(
    readonly tool: string,
    reason: string,
  ) {
    super(`vdp: refusing ${tool}: ${reason}`);
  }
}

const READ = new Set<string>(VDP_READ_TOOLS);
const WRITE = new Set<string>(VDP_WRITE_TOOLS);

/** Throws unless `tool` is on the allowlist for that kind of call. Deletes and AI generation always throw. */
export function assertVdpTool(tool: string, kind: VdpToolKind): void {
  if (VDP_NEVER.test(tool)) throw new VdpToolRefusedError(tool, 'deletes and AI generation are never callable');
  const ok = kind === 'read' ? READ.has(tool) : WRITE.has(tool);
  if (!ok) throw new VdpToolRefusedError(tool, `not on the VDP ${kind} allowlist`);
}

export const isVdpReadTool = (tool: string): tool is VdpReadTool => !VDP_NEVER.test(tool) && READ.has(tool);
export const isVdpWriteTool = (tool: string): tool is VdpWriteTool => !VDP_NEVER.test(tool) && WRITE.has(tool);
