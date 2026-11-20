/**
 * The Org62 Event record type id the work order needs (the persona's: an SE's Solutions Event, an AE's Sales Events,
 * D-55): found once with one read-only soqlQuery (runOneReadLookup, the scanners' allowlist) and kept in the user's
 * kv under a key per record type, so a cached id is never used for another persona's type. A value in Settings ▸
 * Time ▸ Logging wins; a persona switch clears both (patchSettings('persona')).
 */
import type { PersonaLogging } from '@/personas/types';
import { runOneReadLookup, type OneLookupResult } from '@/server/onboarding/identity';

type RecordTypeRef = PersonaLogging['recordType'];

/** The SE's record type: the lookup and cache key from before personas (kept, so an SE's cached id stays valid). */
const SE_RECORD_TYPE: RecordTypeRef = { field: 'Name', value: 'Solutions Event' };
const isSe = (rt: RecordTypeRef) => rt.field === SE_RECORD_TYPE.field && rt.value === SE_RECORD_TYPE.value;

/** The SE's kv key (unchanged); other record types get their own key under it. */
export const RECORD_TYPE_KV = 'cc.logging/org62_record_type';

export function recordTypeKv(rt: RecordTypeRef = SE_RECORD_TYPE): string {
  return isSe(rt) ? RECORD_TYPE_KV : `${RECORD_TYPE_KV}/${rt.field}:${rt.value}`;
}

/** Every kv key a cached record type id can live under (cleared on a persona switch). */
export const isRecordTypeKv = (key: string) => key === RECORD_TYPE_KV || key.startsWith(`${RECORD_TYPE_KV}/`);

const SOQL_VALUE = /^[A-Za-z0-9 _-]{1,80}$/;

/** The read-only lookup for a record type, by Name or DeveloperName. The SE's query is the one from before personas. */
export function recordTypeSoql(rt: RecordTypeRef = SE_RECORD_TYPE): string {
  if (!SOQL_VALUE.test(rt.value)) throw new Error('record type: not a record type name');
  return `SELECT Id, Name FROM RecordType WHERE SobjectType = 'Event' AND ${rt.field === 'DeveloperName' ? 'DeveloperName' : 'Name'} = '${rt.value}' AND IsActive = true LIMIT 2`;
}

export const RECORD_TYPE_SOQL = recordTypeSoql();

const RT_ID = /^012[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/;

/** The one id from the lookup's output, or null (none, more than one, or unreadable). */
export function parseRecordTypeId(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const t = raw.trim();
    const body = JSON.parse(t.slice(t.indexOf('{'))) as { records?: Array<{ Id?: unknown }> };
    const ids = (body.records ?? []).map((r) => r.Id).filter((x): x is string => typeof x === 'string' && RT_ID.test(x));
    return ids.length === 1 ? ids[0]! : null;
  } catch {
    return null;
  }
}

export async function lookupRecordTypeId(
  run: (look: Parameters<typeof runOneReadLookup>[0], o: Parameters<typeof runOneReadLookup>[1]) => Promise<OneLookupResult> = runOneReadLookup,
  rt: RecordTypeRef = SE_RECORD_TYPE,
): Promise<{ id: string | null; result: OneLookupResult }> {
  const result = await run({ connector: 'org62', tool: 'soqlQuery', args: { q: recordTypeSoql(rt) } }, { skillPath: 'skills/read-lookup.md', timeoutMs: 60_000 });
  return { id: parseRecordTypeId(result.text), result };
}

/**
 * The record type id in force: Settings ▸ Time ▸ Logging, else the cached lookup, else (live only) one read-only
 * lookup now, cached through `save`. null when it can't be known yet (mock, or Org62 not reachable).
 */
export async function resolveRecordTypeId(o: {
  setting: string | null;
  cached: string | null;
  live: boolean;
  save: (id: string) => Promise<void>;
  spend?: (r: OneLookupResult) => Promise<void>;
  lookup?: (rt: RecordTypeRef) => Promise<{ id: string | null; result: OneLookupResult }>;
  recordType?: RecordTypeRef;
}): Promise<string | null> {
  if (o.setting) return o.setting;
  if (o.cached) return o.cached;
  if (!o.live) return null;
  const rt = o.recordType ?? SE_RECORD_TYPE;
  const r = await (o.lookup ?? ((x: RecordTypeRef) => lookupRecordTypeId(runOneReadLookup, x)))(rt);
  if (r.result.model) await o.spend?.(r.result).catch(() => undefined);
  if (r.id) await o.save(r.id);
  return r.id;
}

/** Live Org62 calls are allowed (the app runs against real connectors), as the read-in and Google clients decide. */
export const liveOrg62 = (env: NodeJS.ProcessEnv = process.env) => env.CC_LIVE === '1' || (env.CC_LIVE === undefined && env.NODE_ENV === 'production');
