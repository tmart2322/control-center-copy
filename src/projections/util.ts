/** Small, pure helpers shared by the projection mappers. */
import { localDay as engineLocalDay } from '@/engines/activity/time';

import { org62Host, org62RecordUrl as linkOf } from './links';

export const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
export const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = v.replace(/[$,\s]/g, '').replace(/(usd|h|hrs?)$/i, '');
    if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
    return Number(t);
  }
  return null;
};
export const bool = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (/^(true|yes|1)$/i.test(v.trim())) return true;
    if (/^(false|no|0)$/i.test(v.trim())) return false;
  }
  return null;
};
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** First non-null of several meta keys (agent payloads spell fields inconsistently). */
export function pick<T>(get: (v: unknown) => T | null, ...vals: unknown[]): T | null {
  for (const v of vals) {
    const x = get(v);
    if (x !== null) return x;
  }
  return null;
}

/** `k=v; k2=v2` (the Org62 excerpt line) → map. Values keep inner `=`; empty values are dropped. */
export function excerptFields(body: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!body) return out;
  const line = body.split('\n')[0] ?? '';
  for (const part of line.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part.slice(i + 1).trim();
    if (k && v && !out.has(k) && !/^(null|none|n\/a|-)$/i.test(v)) out.set(k, v);
  }
  return out;
}

/** `Opportunity:006…@2026-11-05T15:42:05.000+0000` → parts. `MissedOpp:006…` has no modstamp. */
export function org62Ref(externalId: string): { sobject: string; id: string; modstamp: string | null } | null {
  const i = externalId.indexOf(':');
  if (i <= 0) return null;
  const sobject = externalId.slice(0, i);
  const rest = externalId.slice(i + 1);
  const at = rest.indexOf('@');
  const id = (at >= 0 ? rest.slice(0, at) : rest).trim();
  if (!id) return null;
  return { sobject, id, modstamp: at >= 0 ? rest.slice(at + 1).trim() || null : null };
}

const SF_ID = /^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$/;
export const isSfId = (v: unknown, prefix?: string): v is string => typeof v === 'string' && SF_ID.test(v) && (!prefix || v.startsWith(prefix));
/** Salesforce ids compare on their first 15 characters (the 18-char form adds a case checksum). */
export const id15 = (v: string | null | undefined): string => (v ?? '').slice(0, 15);

/** Salesforce datetimes come as `2026-11-05T15:42:05.000+0000`; Date.parse needs `+00:00`. */
export function sfDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const fixed = s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const t = Date.parse(fixed);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export const ymd = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

export const domainOf = (email: string | null | undefined): string | null => {
  const m = /@([^@\s>]+)$/.exec((email ?? '').trim().toLowerCase());
  return m ? m[1]!.replace(/^www\./, '') : null;
};

/** Resource rooms and Google group calendars are never people. */
export const DEFAULT_IGNORE_DOMAINS = ['resource.calendar.google.com', 'group.calendar.google.com', 'calendar.google.com', 'group.v.calendar.google.com'];

export function domainClass(domain: string | null, rules: { internal: string[]; partner: string[]; ignore: string[] }): 'internal' | 'partner' | 'ignore' | 'external' | null {
  if (!domain) return null;
  const is = (list: string[]) => list.some((d) => domain === d || domain.endsWith(`.${d}`));
  if (is(rules.ignore)) return 'ignore';
  if (is(rules.internal)) return 'internal';
  if (is(rules.partner)) return 'partner';
  return 'external';
}

export const localDay = (iso: string, tz: string): string => engineLocalDay(Date.parse(iso), tz);

export const maxIso = (...v: (string | null | undefined)[]): string | null =>
  v.filter((x): x is string => !!x && !Number.isNaN(Date.parse(x))).reduce<string | null>((m, x) => (m === null || Date.parse(x) > Date.parse(m) ? x : m), null);

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The Org62 record page (`CC_ORG62_HOST`, default the org62 Lightning host); see ./links. */
export const org62RecordUrl = (sobject: 'Account' | 'Opportunity' | 'Event' | 'Deal_Contribution__c', id: string) => linkOf(sobject, id) ?? `${org62Host()}/lightning/r/${sobject}/${id}/view`;
