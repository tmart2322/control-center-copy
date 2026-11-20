/**
 * VDP delivery adapter (vdp-app-fir MCP, through src/connectors/vdp/write.ts; approved 2026-11-10, widened by D-59).
 *
 *   send (Apply) → update_use_case   {id, <each field>}                   (a use case's missing inputs, one call)
 *                  create_use_case   {vdp_id, track, <each input>}        (a whole new use case)
 *                  update_vdp_header {vdp_id, <fields>}                   (fiscal period, account id, add_opportunity_ids)
 *                  create_vdp        {company_id, fiscal period, account id, salesforce_opportunity_ids}
 *                  create_company · add_vdp_asset · set_vdp_owners · generate_use_case (only once VDP lists them)
 *   draft        → refused: VDP has no drafts (the item itself is the draft, on Time)
 *
 * The payload is `payloadFor()` of a `vdp.*` action (src/lib/vdp/payload.ts `vdpActionPayload`): `tool`, `args`, and
 * each field's before → after. The adapter re-derives the arguments from the payload's own fields with the same
 * mapping and refuses the item when they differ, when a value failed its field's rules (`invalid`), when it still waits
 * for a parent's new id (D-63 `pending`: a dry run records it with the placeholder, a live write refuses it), or when
 * the tool is not one of the channel's ops. Deletes and other AI generation can never be expressed here; taking a
 * closed-lost opp off the header (`remove_opportunity_ids`, D-63) is a header update the user approves.
 *
 * Read-back, compared on every field the item set: `get_use_case` (a use case, its Generate), `get_vdp` (the header,
 * a new VDP, its owners), `get_vdp_assets` (an asset), `list_companies` (a new company).
 *
 * D-69 live check before each write (VD-21, the read-back tools only, never in a dry run): `get_use_case` / `get_vdp` /
 * `get_vdp_assets` read the target now, and the write is refused (nothing sent) when a value the item
 * changes is no longer what the mirror read (`conflict`: a person changed it in VDP), or VDP already holds what it would
 * set (`already_in_vdp`). set_vdp_owners sends the role's full list (it replaces it): it goes only while VDP's list is
 * still the one the item was built on, so the list sent is the live one plus the new people. A new use case whose
 * title VDP already has, an asset already linked, a Generate on a use case that has AI fields: refused. (A create_vdp's
 * live check, VD-25, is the push's: src/server/vdp/push.ts, through the read client.)
 *
 * create_company's duplicate refusal (`created: false`, VD-05): ONE match is the company: its id is used (the items under
 * it get it); several matches fail the item (nothing created, you pick in Change…). create_vdp's warnings (an opp on
 * another VDP, an account id that differs) are kept on the item (VD-12).
 */
import type { DispatchMode } from '@/contract';
import { coerceVdpValue, isListField, isVdpOp, pendingOf, vdpArgsFor, type VdpOp, type VdpValue } from '@/lib/vdp/payload';

import { classifyDeliveryError } from '../errors';
import { canonicalJson } from '../hash';
import { OUTBOX_SERVER, OUTBOX_TOOLS } from '../mcp-config';
import type { ReadbackOutcome, ToolCall, ToolResult, WriteOutcome } from '../types';
import { sameUseCaseTitle } from '@/engines/vdp/gaps';

import type { OutboxAdapter, PreflightOutcome, ReadbackContext, ReadFn } from './index';
import { str } from './text';

const SERVER = OUTBOX_SERVER.vdp;

const isOp = (t: string | null): t is VdpOp => !!t && isVdpOp(t) && (OUTBOX_TOOLS.vdp.ops ?? []).includes(t);

/** The fields an item sets (`fields`), or the one field of an item staged before D-59. */
function fieldsOf(payload: Record<string, unknown>): Array<{ field: string; after: VdpValue }> {
  if (Array.isArray(payload.fields) && payload.fields.length) {
    return payload.fields.map((f) => {
      const o = (f ?? {}) as { field?: unknown; after?: unknown };
      return { field: typeof o.field === 'string' ? o.field : '', after: (Array.isArray(o.after) ? o.after.map(String) : typeof o.after === 'number' ? o.after : String(o.after ?? '')) as VdpValue };
    });
  }
  const field = str(payload.field);
  return field ? [{ field, after: (typeof payload.after === 'number' ? payload.after : Array.isArray(payload.after) ? payload.after.map(String) : String(payload.after ?? '')) as VdpValue }] : [];
}

/**
 * The call for a payload. Strict (every live write): a payload that waits for a parent's new id (D-63 `pending`) is
 * refused. `allowPending` (a dry run's record only): the placeholder fields are kept as they are.
 */
function callOf(payload: Record<string, unknown>, mode: DispatchMode, allowPending: boolean): ToolCall {
  if (mode !== 'send') throw new Error('invalid_request: VDP has no drafts: Apply sends the change');
  const tool = str(payload.tool);
  if (!isOp(tool)) throw new Error(`invalid_request: ${tool ?? 'no tool'} is not a VDP Outbox op`);
  if (typeof payload.invalid === 'string') throw new Error(`invalid_request: ${payload.invalid}`);
  const pending = new Set(pendingOf(payload));
  if (pending.size && !allowPending) throw new Error(`invalid_request: it waits for an earlier item (${[...pending].join(', ')} comes from it): push them together`);
  const fields = fieldsOf(payload);
  if (!fields.length || fields.some((f) => !f.field)) throw new Error('invalid_request: VDP payload names no field');
  const values: Array<readonly [string, VdpValue]> = [];
  for (const f of fields) {
    if (pending.has(f.field)) {
      values.push([f.field, f.after]);
      continue;
    }
    const c = coerceVdpValue(tool, f.field, f.after);
    if (!c.ok) throw new Error(`invalid_request: ${c.error}`);
    values.push([f.field, c.value]);
  }
  const args = vdpArgsFor(tool, { vdpId: str(payload.vdp_id), useCaseId: str(payload.use_case_id), track: str(payload.track) }, values);
  if (canonicalJson(args) !== canonicalJson(payload.args ?? null)) throw new Error('invalid_request: VDP payload arguments do not match its change');
  return { server: SERVER, tool, args };
}

const toolCall = (payload: Record<string, unknown>, mode: DispatchMode): ToolCall => callOf(payload, mode, false);
const dryRunCall = (payload: Record<string, unknown>, mode: DispatchMode): ToolCall => callOf(payload, mode, true);

function json(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function parseWrite(result: ToolResult): WriteOutcome {
  const j = json(result.text);
  // VD-05: create_company refused a likely duplicate (created: false, the matches). One match IS the company: use its
  // id (nothing was created, and the items under it take it). Several: the item fails, nothing was created, and the
  // app never picks one for you (Change… on the company node)
  if (j && j.created === false && Array.isArray(j.matches) && !obj(j.asset)) {
    const matches = (j.matches as unknown[]).map(obj).filter((m): m is Record<string, unknown> => !!m && typeof m.id === 'string');
    if (matches.length === 1) return { externalId: matches[0]!.id as string, link: null, reused: true };
    const names = matches.map((m) => (typeof m.name === 'string' ? m.name : null)).filter((x): x is string => !!x);
    throw new Error(`invalid_request: VDP already has ${matches.length || 'several'} companies by that name${names.length ? ` (${names.map((n) => `"${n}"`).join(', ')})` : ''}: nothing was created. Pick one with Change… on the company`);
  }
  const rec = obj(j?.use_case) ?? obj(j?.vdp) ?? obj(j?.company) ?? obj(j?.asset);
  const id = rec && typeof rec.id === 'string' ? rec.id : null;
  const link = typeof j?.vdp_url === 'string' ? j.vdp_url : typeof rec?.vdp_url === 'string' ? (rec.vdp_url as string) : null;
  // VD-12: create_vdp saves and warns (an opp already on another VDP, an account id that differs): kept on the item
  const warnings = Array.isArray(j?.warnings) ? (j!.warnings as unknown[]).map((w) => (typeof w === 'string' ? w : typeof obj(w)?.message === 'string' ? (obj(w)!.message as string) : null)).filter((x): x is string => !!x).map((x) => x.slice(0, 200)).slice(0, 5) : [];
  return { externalId: id, link, ...(warnings.length ? { warnings } : {}) };
}

/** `details_input` → `detailsInput`. VDP's rows are camelCase; some summaries also carry the wire name. */
const camel = (f: string) => f.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** The field's value on a read row, for comparison: trimmed text, or a number. */
export function readField(row: Record<string, unknown>, field: string): string | number | null {
  const v = row[field] ?? row[camel(field)];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return field.endsWith('_date') ? v.slice(0, 10) : v.trim();
  return null;
}

/** Salesforce ids compare on their case-sensitive 15-character form (an 18-character id adds a checksum). */
const id15 = (s: string) => s.slice(0, 15);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The opportunity ids a read VDP row holds (the list, else the deprecated single id). */
function oppIdsOnRow(row: Record<string, unknown>): string[] {
  const list = strings(row.salesforceOpportunityIds ?? row.salesforce_opportunity_ids);
  const one = readField(row, 'salesforce_opportunity_id');
  return list.length ? list : typeof one === 'string' && one ? [one] : [];
}

/** Owner emails on a read VDP row (`accountExecutives` / `technicalArchitects`, people or plain emails). */
function emailsOnRow(row: Record<string, unknown>, field: 'account_executives' | 'technical_architects'): string[] {
  const list = (field === 'account_executives' ? (row.accountExecutives ?? row.account_executives) : (row.technicalArchitects ?? row.technical_architects)) as unknown;
  return (Array.isArray(list) ? list : []).map((p) => (typeof p === 'string' ? p : typeof obj(p)?.email === 'string' ? (obj(p)!.email as string) : '')).filter(Boolean).map((e) => e.toLowerCase());
}

/** Does the read row hold this field's value? Lists: every id or email is present (adds never remove). */
function holds(row: Record<string, unknown>, field: string, expected: VdpValue): boolean {
  if (field === 'add_opportunity_ids' || field === 'salesforce_opportunity_ids' || field === 'salesforce_opportunity_id') {
    const on = new Set(oppIdsOnRow(row).map(id15));
    return (Array.isArray(expected) ? expected : [String(expected)]).every((x) => on.has(id15(x)));
  }
  // D-63: a removed opportunity is no longer on the header
  if (field === 'remove_opportunity_ids') {
    const on = new Set(oppIdsOnRow(row).map(id15));
    return (Array.isArray(expected) ? expected : [String(expected)]).every((x) => !on.has(id15(x)));
  }
  if (field === 'account_executives' || field === 'technical_architects') {
    const on = new Set(emailsOnRow(row, field));
    return (Array.isArray(expected) ? expected : [String(expected)]).every((x) => on.has(x.toLowerCase()));
  }
  if (field === 'company_id') return String(obj(row.company)?.id ?? row.companyId ?? row.company_id ?? '') === String(expected);
  if (isListField(field)) return false;
  const got = readField(row, field);
  return got !== null && String(got) === String(expected);
}

/** The slug of a new VDP, from the write's link (`…/vdp/<slug>`). */
const slugOfLink = (link: string | null): string | null => (link ? (/\/vdp\/([^/?#]+)/.exec(link)?.[1] ?? null) : null);

async function readback(read: ReadFn, ctx: ReadbackContext): Promise<ReadbackOutcome> {
  const out = await readbackOf(read, ctx);
  const warn = ctx.write.warnings?.length ? ` · VDP warns: ${ctx.write.warnings.join('; ')}` : '';
  const reused = ctx.write.reused ? ' · VDP already had this company: its id is used, nothing was created' : '';
  return warn || reused ? { ...out, detail: `${out.detail}${reused}${warn}`.slice(0, 600) } : out;
}

async function readbackOf(read: ReadFn, ctx: ReadbackContext): Promise<ReadbackOutcome> {
  const tool = str(ctx.payload.tool);
  if (ctx.write.note) return { readback: 'unconfirmed', detail: ctx.write.note, matchedExternalId: null };
  const fields = fieldsOf(ctx.payload);
  const slug = tool === 'create_vdp' ? slugOfLink(ctx.write.link) : str(ctx.payload.vdp_slug);
  const useCaseId = tool === 'create_use_case' ? ctx.write.externalId : str(ctx.payload.use_case_id);
  let call: ToolCall | null = null;
  let what = 'the use case';
  let pick: (j: Record<string, unknown> | null) => Record<string, unknown> | null = (j) => obj(j?.use_case);
  switch (tool) {
    case 'update_vdp_header':
    case 'create_vdp':
    case 'set_vdp_owners':
      what = 'the VDP';
      call = slug ? { server: SERVER, tool: 'get_vdp', args: { slug } } : null;
      pick = (j) => obj(j?.vdp);
      break;
    case 'add_vdp_asset': {
      what = 'the asset';
      const url = fields.find((f) => f.field === 'url')?.after;
      call = str(ctx.payload.vdp_id) ? { server: SERVER, tool: 'get_vdp_assets', args: { vdp_id: str(ctx.payload.vdp_id) } } : null;
      pick = (j) => (Array.isArray(j?.assets) ? ((j.assets as unknown[]).map(obj).find((a) => a && a.url === url) ?? null) : null);
      break;
    }
    case 'create_company': {
      what = 'the company';
      const name = String(fields.find((f) => f.field === 'name')?.after ?? '');
      call = name ? { server: SERVER, tool: 'list_companies', args: { q: name, limit: 5 } } : null;
      pick = (j) => (Array.isArray(j?.companies) ? ((j.companies as unknown[]).map(obj).find((c) => c && (ctx.write.externalId ? c.id === ctx.write.externalId : String(c.name ?? '').toLowerCase() === name.toLowerCase())) ?? null) : null);
      break;
    }
    default:
      call = useCaseId ? { server: SERVER, tool: 'get_use_case', args: { id: useCaseId } } : null;
  }
  if (!call) return { readback: 'unconfirmed', detail: `VDP did not return what it made, so ${what} could not be read back`, matchedExternalId: ctx.write.externalId };
  let text: string;
  try {
    text = (await read(call)).text;
  } catch (err) {
    return { readback: 'unconfirmed', detail: `Read-back failed (${classifyDeliveryError(err).code})`, matchedExternalId: null };
  }
  const row = pick(json(text));
  if (!row) return { readback: 'missing', detail: `Read-back: ${what} is not in VDP`, matchedExternalId: null };
  const id = typeof row.id === 'string' ? row.id : null;
  if (tool === 'generate_use_case') {
    const gf = obj(row.generated_fields ?? row.generatedFields);
    return gf && Object.keys(gf).length ? { readback: 'confirmed', detail: 'Verified in VDP ✓', matchedExternalId: id } : { readback: 'unconfirmed', detail: 'Read-back found the use case but no AI fields yet', matchedExternalId: id };
  }
  // add_vdp_asset / create_company: found by its url / id is the check; the rest compare each field
  const checked = tool === 'add_vdp_asset' || tool === 'create_company' ? [] : fields;
  const off = checked.filter((f) => !holds(row, f.field, f.after)).map((f) => f.field);
  if (!off.length) return { readback: 'confirmed', detail: 'Verified in VDP ✓', matchedExternalId: id };
  return { readback: 'unconfirmed', detail: `Read-back found ${what} but its ${off.join(', ')} differ${off.length === 1 ? 's' : ''}`, matchedExternalId: id };
}

// ---------------------------------------------------------------------------
// D-69 (VD-21): the live check right before each write
// ---------------------------------------------------------------------------

const go: PreflightOutcome = { ok: true };
const refuse = (code: 'conflict' | 'already_in_vdp', detail: string): PreflightOutcome => ({ ok: false, code, detail });
const empty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && !v.length);
const same = (a: unknown, b: unknown) => String(Array.isArray(a) ? a.join(',') : (a ?? '')).trim() === String(Array.isArray(b) ? b.join(',') : (b ?? '')).trim();
const label = (f: string) => f.replace(/_/g, ' ');

/** The payload's fields with what the mirror read before each (`before`) and what the item sets (`after`). */
function changesOf(payload: Record<string, unknown>): Array<{ field: string; before: unknown; after: unknown }> {
  return (Array.isArray(payload.fields) ? payload.fields : []).map((f) => {
    const o = (f ?? {}) as { field?: unknown; before?: unknown; after?: unknown };
    return { field: typeof o.field === 'string' ? o.field : '', before: o.before ?? null, after: o.after ?? null };
  });
}

async function readJson(read: ReadFn, tool: string, args: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  return json((await read({ server: SERVER, tool, args })).text);
}

/**
 * Before a live write: read the target and refuse a conflict (a value a person changed since the mirror's read) or a
 * no-op (VDP already has it). Throws only when the read itself fails (the delivery then refuses, nothing sent).
 */
async function preflight(read: ReadFn, ctx: { payload: Record<string, unknown> }): Promise<PreflightOutcome> {
  const p = ctx.payload;
  const tool = str(p.tool);
  const changes = changesOf(p);
  const slug = str(p.vdp_slug);
  const vdpRow = async () => (slug && !slug.startsWith('account:') ? obj((await readJson(read, 'get_vdp', { slug }))?.vdp) : null);
  switch (tool) {
    case 'update_use_case': {
      const id = str(p.use_case_id);
      if (!id) return go;
      const row = obj((await readJson(read, 'get_use_case', { id }))?.use_case);
      // not there: the write itself says so (not_found); nothing to compare
      if (!row) return go;
      const changed = changes.filter((c) => { const live = readField(row, c.field); return !empty(live) && !same(live, c.before) && !same(live, c.after); });
      if (changed.length) return refuse('conflict', `Changed in VDP since the last read: ${changed.map((c) => label(c.field)).join(', ')}. Nothing was sent; the next read shows it`);
      if (changes.every((c) => same(readField(row, c.field), c.after))) return refuse('already_in_vdp', 'VDP already has these values: nothing was sent');
      return go;
    }
    case 'generate_use_case': {
      const id = str(p.use_case_id);
      if (!id) return go;
      const row = obj((await readJson(read, 'get_use_case', { id }))?.use_case);
      const gf = obj(row?.generated_fields ?? row?.generatedFields);
      return gf && Object.keys(gf).length ? refuse('already_in_vdp', 'The use case has its AI fields already: not generated again') : go;
    }
    case 'create_use_case': {
      const row = await vdpRow();
      if (!row) return go;
      const title = changes.find((c) => c.field === 'title')?.after;
      const index = (Array.isArray(row.use_cases_index) ? row.use_cases_index : Array.isArray(row.useCases) ? row.useCases : Array.isArray(row.use_cases) ? row.use_cases : []) as unknown[];
      const twin = index.map(obj).find((u) => !!u && sameUseCaseTitle(typeof u.title === 'string' ? u.title : null, typeof title === 'string' ? title : null));
      return twin ? refuse('already_in_vdp', 'VDP already has a use case with this title: not created twice') : go;
    }
    case 'update_vdp_header': {
      const row = await vdpRow();
      if (!row) return go;
      const live = new Set(oppIdsOnRow(row).map(id15));
      const conflicts: string[] = [];
      let todo = 0;
      for (const c of changes) {
        if (c.field === 'add_opportunity_ids' || c.field === 'remove_opportunity_ids') {
          const ids = (Array.isArray(c.after) ? c.after : [c.after]).map((x) => id15(String(x)));
          if (c.field === 'add_opportunity_ids' ? ids.some((x) => !live.has(x)) : ids.some((x) => live.has(x))) todo += 1;
          continue;
        }
        const v = readField(row, c.field);
        if (same(v, c.after)) continue;
        todo += 1;
        if (!empty(v) && !same(v, c.before)) conflicts.push(c.field);
      }
      if (conflicts.length) return refuse('conflict', `Changed in VDP since the last read: ${conflicts.map(label).join(', ')}. Nothing was sent; the next read shows it`);
      return todo ? go : refuse('already_in_vdp', 'VDP already has this: nothing was sent');
    }
    case 'set_vdp_owners': {
      const row = await vdpRow();
      if (!row) return go;
      for (const c of changes) {
        if (c.field !== 'account_executives' && c.field !== 'technical_architects') continue;
        // the role's full list is sent (it replaces VDP's): only while VDP still lists who the item was built on
        const live = new Set(emailsOnRow(row, c.field));
        const before = new Set((Array.isArray(c.before) ? c.before : []).map((x) => String(x).toLowerCase()));
        const after = (Array.isArray(c.after) ? c.after : [c.after]).map((x) => String(x).toLowerCase());
        if (after.every((x) => live.has(x))) return refuse('already_in_vdp', `VDP already lists them as ${c.field === 'account_executives' ? 'AE' : 'TA'}: nothing was sent`);
        if (live.size !== before.size || [...live].some((x) => !before.has(x))) return refuse('conflict', `The ${c.field === 'account_executives' ? 'AE' : 'TA'} list changed in VDP since the last read: nothing was sent (setting it would replace who is there). The next read shows it`);
      }
      return go;
    }
    case 'add_vdp_asset': {
      const id = str(p.vdp_id);
      const url = changes.find((c) => c.field === 'url')?.after;
      if (!id || typeof url !== 'string') return go;
      const j = await readJson(read, 'get_vdp_assets', { vdp_id: id });
      const has = (Array.isArray(j?.assets) ? (j!.assets as unknown[]) : []).map(obj).some((a) => !!a && typeof a.url === 'string' && a.url.trim().toLowerCase() === url.trim().toLowerCase());
      return has ? refuse('already_in_vdp', 'The VDP links this asset already: not added twice') : go;
    }
    default:
      return go;
  }
}

export const vdpAdapter: OutboxAdapter = { channel: 'vdp', toolCall, dryRunCall, parseWrite, readback, preflight };
