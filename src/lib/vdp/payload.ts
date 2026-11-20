/**
 * The ONE mapping from a `vdp.*` Outbox action (its structured input) to the exact VDP MCP call. Shared by
 * `payloadFor()` (what the preview and the dry run record) and the Outbox `vdp` adapter (what a live Apply calls), so
 * the previewed payload and the call can never differ. Pure; no clock, no ids, no I/O.
 *
 * One item = ONE call, with every field it sets (D-59): a whole use case (`update_use_case` with each missing input,
 * or `create_use_case` with all of them), the fiscal period in one `update_vdp_header`, opps added with
 * `add_opportunity_ids` (or, D-63, a closed-lost one removed with `remove_opportunity_ids`), the entitlement leveraged,
 * a new VDP (`create_vdp` with company, account, opps and period), `create_company`, `add_vdp_asset`, `set_vdp_owners`
 * and `generate_use_case`. Items staged before D-59 carry one field (`field`/`value`) and map exactly as before.
 *
 * D-63 chained push: an item under a parent that does not exist yet (a VDP under a new company, a use case under a new
 * VDP, a Generate under a new use case) names the parent's item in `pending`. Its payload carries a placeholder
 * ("(new company id)", "(new VDP id)", "(new use case id)") and `pending`: a dry run records it as is, and the adapter
 * refuses to send it. The push fills the real id in once the parent is applied (a new Outbox item, same values).
 *
 * Values follow vdp-app's MCP input schemas (research 02 §3; lib/mcp/server.ts): priority is one of "3 - High",
 * "2 - Medium", "1 - Low" (plain words are normalized); execution phase, duration unit, track and entitlement are
 * enums; dates are YYYY-MM-DD; Salesforce ids are 15 or 18 characters; a list holds at most 20 ids. An empty value is
 * refused: an item fills or changes a field, it never clears one, and nothing here can delete anything.
 */
import { VdpActionInput, type ActionDestination, type OutboxAction, type VdpFieldChange } from '@/contract';

/** The VDP MCP write an action makes: `vdp.update_use_case` → `update_use_case`. */
export type VdpOp = 'update_use_case' | 'create_use_case' | 'update_vdp_header' | 'create_vdp' | 'create_company' | 'add_vdp_asset' | 'set_vdp_owners' | 'generate_use_case';
export const VDP_OPS: readonly VdpOp[] = ['update_use_case', 'create_use_case', 'update_vdp_header', 'create_vdp', 'create_company', 'add_vdp_asset', 'set_vdp_owners', 'generate_use_case'];
export const vdpOpOf = (a: OutboxAction): VdpOp => a.slice(a.indexOf('.') + 1) as VdpOp;
export const isVdpOp = (t: unknown): t is VdpOp => typeof t === 'string' && (VDP_OPS as readonly string[]).includes(t);

export const VDP_PRIORITY_VALUES = ['3 - High', '2 - Medium', '1 - Low'] as const;
export const VDP_PHASE_VALUES = ['Not Started', 'Discovery', 'Build', 'Live', 'On Hold'] as const;
export const VDP_UNIT_VALUES = ['days', 'weeks', 'months'] as const;
/** VDP keeps at most 20 opportunity ids on a VDP. */
export const VDP_MAX_OPPORTUNITIES = 20;

/** Fields `update_use_case` accepts (wire names). */
export const VDP_UPDATE_USE_CASE_FIELDS = [
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
/** The five human inputs, in VDP's order: what `create_use_case` takes in one call. */
export const VDP_CREATE_USE_CASE_FIELDS = ['title', 'priority', 'division', 'persona', 'details_input'] as const;
/** `salesforce_opportunity_id` is VDP's deprecated single add; new items use `add_opportunity_ids`. */
export const VDP_HEADER_FIELDS = ['fiscal_year', 'fiscal_quarter', 'salesforce_account_id', 'salesforce_opportunity_id', 'add_opportunity_ids', 'remove_opportunity_ids', 'entitlement_leveraged'] as const;
export const VDP_CREATE_VDP_FIELDS = ['company_id', 'fiscal_year', 'fiscal_quarter', 'salesforce_account_id', 'salesforce_opportunity_ids', 'entitlement_leveraged'] as const;
/** D-63: the entitlement a VDP leverages (`entitlement_leveraged`). */
export const VDP_ENTITLEMENT_VALUES = ['Data Services', 'Flex', 'Conversations'] as const;

/** Every field each op may set, and the ones it needs. */
export const VDP_OP_FIELDS: Record<VdpOp, readonly string[]> = {
  update_use_case: VDP_UPDATE_USE_CASE_FIELDS,
  create_use_case: VDP_CREATE_USE_CASE_FIELDS,
  update_vdp_header: VDP_HEADER_FIELDS,
  create_vdp: VDP_CREATE_VDP_FIELDS,
  // D-69: aliases (the account names it goes by up the Org62 chain), only once VDP's schema lists the argument
  create_company: ['name', 'aliases', 'industry_category_id', 'sales_segment_id'],
  add_vdp_asset: ['url', 'title', 'asset_type', 'description', 'deliverable_type'],
  set_vdp_owners: ['account_executives', 'technical_architects'],
  generate_use_case: ['ai_fields'],
};
const REQUIRED: Record<VdpOp, readonly string[]> = {
  update_use_case: [],
  create_use_case: ['title'],
  update_vdp_header: [],
  create_vdp: ['company_id'],
  create_company: ['name'],
  add_vdp_asset: ['url', 'title'],
  set_vdp_owners: [],
  generate_use_case: ['ai_fields'],
};

export const VDP_FIELD_LABEL: Record<string, string> = {
  title: 'Title',
  priority: 'Priority',
  division: 'Division',
  persona: 'Persona',
  details_input: 'Details',
  execution_phase: 'Execution phase',
  execution_start_date: 'Start date',
  execution_target_date: 'Target date',
  execution_duration_value: 'Duration',
  execution_duration_unit: 'Duration unit',
  fiscal_year: 'Fiscal year',
  fiscal_quarter: 'Fiscal quarter',
  salesforce_account_id: 'Org62 account id',
  salesforce_opportunity_id: 'Org62 opportunity id',
  add_opportunity_ids: 'Org62 opportunities to add',
  remove_opportunity_ids: 'Org62 opportunities to remove',
  entitlement_leveraged: 'Entitlement leveraged',
  sales_segment_id: 'Sales segment',
  salesforce_opportunity_ids: 'Org62 opportunity ids',
  company_id: 'VDP company',
  name: 'Company name',
  aliases: 'Also known as',
  industry_category_id: 'Industry',
  url: 'Link (URL)',
  asset_type: 'Type',
  description: 'Description',
  deliverable_type: 'Deliverable',
  account_executives: 'AE',
  technical_architects: 'TA',
  ai_fields: 'AI fields',
};

/** Enum fields and their allowed values (the gap check offers these). */
export const VDP_FIELD_OPTIONS: Record<string, readonly string[]> = {
  priority: VDP_PRIORITY_VALUES,
  execution_phase: VDP_PHASE_VALUES,
  execution_duration_unit: VDP_UNIT_VALUES,
  fiscal_quarter: ['1', '2', '3', '4'],
  entitlement_leveraged: VDP_ENTITLEMENT_VALUES,
};

const MAX_LEN: Record<string, number> = { title: 500, division: 500, persona: 500, details_input: 10_000, name: 200, asset_type: 200, deliverable_type: 200, description: 5000 };
const LIST_FIELDS = new Set(['add_opportunity_ids', 'remove_opportunity_ids', 'salesforce_opportunity_ids', 'account_executives', 'technical_architects', 'aliases']);
/** A role's list on set_vdp_owners: the FULL new list (it replaces the current one), at most 20 people. */
export const VDP_MAX_OWNERS = 20;
export const isListField = (field: string) => LIST_FIELDS.has(field);

export type VdpValue = string | number | string[];
export type Coerced = { ok: true; value: VdpValue } | { ok: false; error: string };

const bad = (error: string): Coerced => ({ ok: false, error });
const SF_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** VDP takes absolute http(s) links only (add_vdp_asset); anything else is skipped and flagged (D-60). */
export const isHttpUrl = (v: string): boolean => /^https?:\/\/[^\s/]+\S*$/i.test(v.trim()) && v.trim().length <= 2000;

function priorityOf(v: string): string | null {
  const s = v.trim().toLowerCase();
  const exact = VDP_PRIORITY_VALUES.find((p) => p.toLowerCase() === s);
  if (exact) return exact;
  if (/^(3|high|hi|p1|critical|urgent)$/.test(s)) return '3 - High';
  if (/^(2|med|medium|mid|normal|p2)$/.test(s)) return '2 - Medium';
  if (/^(1|low|lo|p3|minor)$/.test(s)) return '1 - Low';
  return null;
}

const oneOf = (v: string, values: readonly string[]) => values.find((x) => x.toLowerCase() === v.trim().toLowerCase()) ?? null;

function isDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** A list value from text ("006A…, 006B…" or one per line) or an array; trimmed, deduplicated, order kept. */
function listOf(v: VdpValue): string[] {
  const parts = Array.isArray(v) ? v : String(v).split(/[\s,;]+/);
  return [...new Set(parts.map((x) => String(x).trim()).filter(Boolean))];
}

/**
 * A list field, checked: Salesforce ids (at most 20) or owner emails (lowercased). An owner list is the role's full
 * new list (set_vdp_owners replaces, and [] would clear it), so an empty one is refused.
 */
function coerceList(field: string, v: VdpValue): Coerced {
  const label = VDP_FIELD_LABEL[field] ?? field;
  if (field === 'aliases') {
    // D-69: other names a new company goes by (create_company checks each for duplicates too): 1 to 200 characters each
    const xs = [...new Set((Array.isArray(v) ? v.map(String) : String(v).split(/\s*[\n;]\s*/)).map((x) => x.trim()).filter(Boolean))];
    if (!xs.length) return bad(`${label} is empty`);
    if (xs.length > 50) return bad(`${label}: at most 50`);
    return xs.some((x) => x.length > 200) ? bad(`${label}: each at most 200 characters`) : { ok: true, value: xs };
  }
  if (field === 'account_executives' || field === 'technical_architects') {
    const xs = [...new Set(listOf(v).map((x) => x.replace(/^.*<([^>]+)>.*$/, '$1').toLowerCase()))];
    if (!xs.length) return bad(`${label} is empty: an item fills or changes a field, it never clears one`);
    if (xs.length > VDP_MAX_OWNERS) return bad(`${label}: at most ${VDP_MAX_OWNERS} people`);
    const wrong = xs.find((x) => !EMAIL.test(x));
    return wrong ? bad(`${label}: ${wrong} is not an email`) : { ok: true, value: xs };
  }
  const xs = listOf(v);
  if (!xs.length) return bad(`${label} is empty: name at least one opportunity`);
  if (xs.length > VDP_MAX_OPPORTUNITIES) return bad(`${label}: at most ${VDP_MAX_OPPORTUNITIES} opportunities`);
  const wrong = xs.find((x) => !SF_ID.test(x) || !x.startsWith('006'));
  return wrong ? bad(`${label}: ${wrong} is not a 15- or 18-character Org62 opportunity id`) : { ok: true, value: xs };
}

/** The value of one field, checked and normalized for the wire. */
export function coerceVdpValue(op: VdpOp, field: string, input: VdpValue): Coerced {
  if (!VDP_OP_FIELDS[op]?.includes(field)) return bad(op === 'create_use_case' ? `A new use case takes ${VDP_CREATE_USE_CASE_FIELDS.join(', ')}` : `${op} has no field ${field}`);
  if (LIST_FIELDS.has(field)) return coerceList(field, input);
  const text = Array.isArray(input) ? input.join(', ') : String(input);
  const raw = text.trim();
  const label = VDP_FIELD_LABEL[field] ?? field;
  if (!raw) return bad(`${label} is empty: an item fills or changes a field, it never clears one`);
  switch (field) {
    case 'title':
    case 'division':
    case 'persona':
    case 'details_input':
    case 'name':
    case 'asset_type':
    case 'deliverable_type':
    case 'description':
      return raw.length <= MAX_LEN[field]! ? { ok: true, value: field === 'details_input' || field === 'description' ? text.trim() : raw } : bad(`${label} is over ${MAX_LEN[field]} characters`);
    case 'priority': {
      const p = priorityOf(raw);
      return p ? { ok: true, value: p } : bad(`Priority is one of ${VDP_PRIORITY_VALUES.join(', ')}`);
    }
    case 'execution_phase': {
      const p = oneOf(raw, VDP_PHASE_VALUES);
      return p ? { ok: true, value: p } : bad(`Execution phase is one of ${VDP_PHASE_VALUES.join(', ')}`);
    }
    case 'execution_duration_unit': {
      const u = oneOf(raw, VDP_UNIT_VALUES);
      return u ? { ok: true, value: u } : bad(`Duration unit is one of ${VDP_UNIT_VALUES.join(', ')}`);
    }
    case 'execution_start_date':
    case 'execution_target_date':
      return isDate(raw) ? { ok: true, value: raw } : bad(`${label} is a date, YYYY-MM-DD`);
    case 'execution_duration_value': {
      const n = Number(raw);
      return Number.isInteger(n) && n >= 1 && n <= 3650 ? { ok: true, value: n } : bad('Duration is a whole number from 1 to 3650');
    }
    case 'fiscal_year': {
      const m = /^(?:FY)?\s*(\d{2}|\d{4})$/i.exec(raw);
      const n = m ? Number(m[1]!.length === 4 ? m[1]!.slice(2) : m[1]) : NaN;
      return Number.isInteger(n) && n >= 0 && n <= 99 ? { ok: true, value: n } : bad('Fiscal year is a 2-digit year (27 for FY27)');
    }
    case 'fiscal_quarter': {
      const n = Number(/^(?:Q)?\s*([1-4])$/i.exec(raw)?.[1] ?? NaN);
      return Number.isInteger(n) ? { ok: true, value: n } : bad('Fiscal quarter is 1 to 4');
    }
    case 'salesforce_account_id':
    case 'salesforce_opportunity_id':
      return SF_ID.test(raw) ? { ok: true, value: raw } : bad(`${label} must be a 15- or 18-character Salesforce id`);
    case 'company_id':
      return UUID.test(raw) ? { ok: true, value: raw.toLowerCase() } : bad('The VDP company id is a uuid (list_companies)');
    case 'industry_category_id':
      return UUID.test(raw) ? { ok: true, value: raw.toLowerCase() } : bad('The industry is a uuid (list_industries)');
    case 'url':
      return isHttpUrl(raw) ? { ok: true, value: raw } : bad('The link is an http(s) URL');
    case 'entitlement_leveraged': {
      const e = oneOf(raw, VDP_ENTITLEMENT_VALUES);
      return e ? { ok: true, value: e } : bad(`Entitlement leveraged is one of ${VDP_ENTITLEMENT_VALUES.join(', ')}`);
    }
    case 'sales_segment_id':
      return raw.length <= 100 && /^[\p{L}\p{N} _&/.-]+$/u.test(raw) ? { ok: true, value: raw } : bad('The sales segment is an id, slug or label from list_sales_segments');
    case 'ai_fields':
      return raw === 'generate' ? { ok: true, value: raw } : bad('Generate takes no value');
    default:
      return bad(`${op} has no field ${field}`);
  }
}

/** Every field change of an item: `changes`, or (an item staged before D-59) its one `field`/`value`. */
export function changesOf(i: Pick<VdpActionInput, 'field' | 'before' | 'value' | 'changes'>): VdpFieldChange[] {
  return i.changes?.length ? i.changes : [{ field: i.field, before: i.before ?? null, value: i.value }];
}

/**
 * The tool arguments for one call: the ids the op needs, then each field. Throws when the input is missing an id or
 * a value its op needs.
 */
export function vdpArgsFor(op: VdpOp, i: { vdpId?: string | null; useCaseId?: string | null; track?: string | null }, values: ReadonlyArray<readonly [string, VdpValue]>): Record<string, unknown> {
  const fields = Object.fromEntries(values);
  for (const f of REQUIRED[op]) if (!(f in fields)) throw new Error(`invalid_request: ${op} needs ${VDP_FIELD_LABEL[f] ?? f}`);
  if (!values.length) throw new Error(`invalid_request: ${op} sets nothing`);
  switch (op) {
    case 'update_use_case':
      if (!i.useCaseId) throw new Error('invalid_request: a use-case update needs the use case id');
      return { id: i.useCaseId, ...fields };
    case 'create_use_case':
      if (!i.vdpId || !i.track) throw new Error('invalid_request: a new use case needs the VDP id and a track');
      return { vdp_id: i.vdpId, track: i.track, ...fields };
    case 'update_vdp_header':
    case 'add_vdp_asset':
    case 'set_vdp_owners':
      if (!i.vdpId) throw new Error(`invalid_request: ${op === 'update_vdp_header' ? 'a header update' : op === 'add_vdp_asset' ? 'an asset' : 'owners'} need${op === 'set_vdp_owners' ? '' : 's'} the VDP id`);
      return { vdp_id: i.vdpId, ...fields };
    case 'create_vdp':
    case 'create_company':
      return { ...fields };
    case 'generate_use_case':
      // never `regenerate`: only a use case with no AI fields is generated from here
      if (!i.vdpId || !i.useCaseId) throw new Error('invalid_request: Generate needs the VDP id and the use case id');
      return { vdp_id: i.vdpId, use_case_id: i.useCaseId };
  }
}

/** D-63: the placeholder a payload carries for an id its parent item creates (recorded by a dry run, never sent). */
export const VDP_PENDING_TEXT = { vdpId: '(new VDP id)', companyId: '(new company id)', useCaseId: '(new use case id)' } as const;
/** The wire fields a pending id fills. */
export const VDP_PENDING_FIELD = { vdpId: 'vdp_id', companyId: 'company_id', useCaseId: 'use_case_id' } as const;

/** The payload's fields that wait for a parent's new id (D-63), or [] when it can be sent. */
export const pendingOf = (payload: Record<string, unknown>): string[] => (Array.isArray(payload.pending) ? payload.pending.filter((x): x is string => typeof x === 'string') : []);

/**
 * The exact payload a `vdp.*` action records and (on Apply, dry-run off) sends: the call (`tool`, `args`) plus each
 * field's before → after. `invalid` is set (and `args` null) when the input or a value fails its rules; such an item
 * can be previewed but never sent. `pending` (D-63) names the ids a parent item still has to create: the payload
 * carries placeholders, a dry run records it, the adapter never sends it.
 */
export function vdpActionPayload(dest: Pick<ActionDestination, 'action' | 'input'>): Record<string, unknown> {
  const op = vdpOpOf(dest.action);
  const base = { api: `vdp.${op}`, server: 'vdp-app-fir', tool: op };
  const parsed = VdpActionInput.safeParse(dest.input);
  if (!parsed.success) return { ...base, args: null, invalid: 'The VDP item is malformed: draft the change again' };
  const i = parsed.data;
  const pend = i.pending ?? null;
  const pending: string[] = [];
  const vdpId = pend?.vdpId ? (pending.push(VDP_PENDING_FIELD.vdpId), VDP_PENDING_TEXT.vdpId) : i.vdpId;
  const useCaseId = pend?.useCaseId ? (pending.push(VDP_PENDING_FIELD.useCaseId), VDP_PENDING_TEXT.useCaseId) : i.useCaseId;
  const changes = changesOf(i);
  let invalid: string | null = null;
  const fields: Array<{ field: string; before: VdpValue | null; after: VdpValue }> = [];
  const seen = new Set<string>();
  for (const c of changes) {
    if (seen.has(c.field)) invalid ??= `${VDP_FIELD_LABEL[c.field] ?? c.field} is set twice`;
    seen.add(c.field);
    if (pend?.companyId && c.field === 'company_id') {
      pending.push(VDP_PENDING_FIELD.companyId);
      fields.push({ field: c.field, before: null, after: VDP_PENDING_TEXT.companyId });
      continue;
    }
    const v = coerceVdpValue(op, c.field, c.value);
    if (!v.ok) invalid ??= v.error;
    fields.push({ field: c.field, before: c.before ?? null, after: v.ok ? v.value : c.value });
  }
  let args: Record<string, unknown> | null = null;
  if (!invalid) {
    try {
      args = vdpArgsFor(op, { vdpId, useCaseId, track: i.track }, fields.map((f) => [f.field, f.after] as const));
    } catch (e) {
      invalid = (e as Error).message.replace(/^invalid_request: /, '');
    }
  }
  const first = fields[0]!;
  const waits = [...new Set(Object.values(pend ?? {}).filter((x): x is string => typeof x === 'string' && x !== ''))];
  return {
    ...base,
    vdp_slug: i.vdpSlug,
    vdp_id: vdpId,
    ...(useCaseId ? { use_case_id: useCaseId } : {}),
    ...(i.track ? { track: i.track } : {}),
    ...(i.itemKey ? { item_key: i.itemKey } : {}),
    ...(i.candidateId ? { candidate_id: i.candidateId } : {}),
    field: first.field,
    before: first.before,
    after: first.after,
    fields,
    args: invalid ? null : args,
    ...(invalid ? { invalid } : {}),
    ...(pending.length ? { pending, waits_for: waits } : {}),
  };
}

/** A value for a preview line: a list joined, else as is. */
export const showVdpValue = (v: VdpValue | null | undefined): string | number | null => (v === null || v === undefined ? null : Array.isArray(v) ? v.join(', ') : v);
