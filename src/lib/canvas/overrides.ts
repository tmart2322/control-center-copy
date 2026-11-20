/**
 * Your edits on a logging canvas's rows before Apply (the canvas review, 2026-11-13 audit B2), kept so they survive a
 * re-render, a rejected canvas and the next batch. Event and Deal Contribution edits live on their own records (the
 * activity row, the DC request); the rows with no record of the app's own keep theirs here: a VDP use case's Org62
 * fields (`uc:<VDP use case id>`) and an UPDATE row's new value (`update:<Object>:<record id 15>:<field>`).
 *
 * One map per user: the db's kv `canvas.row_overrides`, the mock's `rowOverrides` collection. Pure.
 */

export const ROW_OVERRIDES_KV = 'canvas.row_overrides';

/** One row's edited fields and when you made them. */
export interface RowOverride {
  fields: Record<string, string | string[]>;
  at: string;
}

export type RowOverrides = Readonly<Record<string, RowOverride>>;

export const NO_ROW_OVERRIDES: RowOverrides = Object.freeze({});

/** The review's key of a use-case create row. */
export const ucRowKey = (vdpUseCaseId: string) => `uc:${vdpUseCaseId}`;

/** The review's key of an UPDATE-table row (an Event's Duration__c, a Use_Case__c's Stage__c / Go_Live_Date__c, …). */
export const updateRowKey = (object: string, recordId: string, field: string) => `update:${object}:${recordId.slice(0, 15)}:${field}`;

/** A stored map, read defensively (a bad entry is left out, never thrown). */
export function rowOverridesOf(v: unknown): RowOverrides {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return NO_ROW_OVERRIDES;
  const out: Record<string, RowOverride> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const o = raw as Partial<RowOverride> | null;
    if (!o || typeof o !== 'object' || !o.fields || typeof o.fields !== 'object') continue;
    const fields: Record<string, string | string[]> = {};
    for (const [f, x] of Object.entries(o.fields)) {
      if (typeof x === 'string') fields[f] = x;
      else if (Array.isArray(x) && x.every((y) => typeof y === 'string')) fields[f] = x as string[];
    }
    out[k] = { fields, at: typeof o.at === 'string' ? o.at : '' };
  }
  return out;
}

/** The map with one row's fields merged in (a later edit of the same field wins). */
export function withRowOverride(all: RowOverrides, key: string, fields: Record<string, string | string[]>, at: string): RowOverrides {
  return { ...all, [key]: { fields: { ...(all[key]?.fields ?? {}), ...fields }, at } };
}

/** An UPDATE row's edited new value, if you changed it. */
export function updateOverrideOf(all: RowOverrides, object: string, recordId: string, field: string): string | null {
  const v = all[updateRowKey(object, recordId, field)]?.fields.newValue;
  return typeof v === 'string' ? v : null;
}
