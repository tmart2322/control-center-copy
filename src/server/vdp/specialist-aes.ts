/**
 * The VDP's specialist AE (D-63): the owner of the opp's Org62 Specialist Forecast of a VDP type. A fixed, read-only
 * SOQL (shape checked read-only 2026-11-12: SpecialistForecast__c with Opportunity__c, ForecastType__c, OwnerId,
 * Owner.Name, Owner.Email), run as ONE `soqlQuery` call per batch of at most 200 opps through runOneReadLookup (the
 * scanners' Org62 read allowlist, not widened), the same way `forecast.sync` reads (src/server/forecast/soql.ts). The
 * model makes the one call; nothing here asks it to judge anything.
 *
 * Only the four VDP types count: Data Cloud, BtL Data Cloud, Agentforce, BtL Agentforce (Analytics, Marketing Cloud,
 * Service Cloud, Slack and the rest are not VDP AEs). The AE list is Data Cloud owners first, then Agentforce,
 * deduplicated by email (src/engines/vdp/gaps.ts `specialistAesFor`).
 *
 * Cached per opp in the user's kv (`cc.vdp.specialist_aes`), refreshed by the worker's `vdp.specialist_aes` daily and
 * after an Org62 opportunities read. It works for every persona with VDP (the SE persona has no Specialist Forecast
 * feature of its own: this read is VDP's).
 */
import type { GapOpp, SpecialistAe } from '@/engines/vdp/gaps';

/** Where each DataSource keeps the cache (a per-user key-value row). */
export const VDP_AES_KV = 'cc.vdp.specialist_aes';

/** ForecastType__c values whose owner is a VDP AE. */
export const VDP_AE_FORECAST_TYPES = ['Data Cloud', 'BtL Data Cloud', 'Agentforce', 'BtL Agentforce'] as const;

/** At most this many opps per query (`Opportunity__c IN (…)`). */
export const AES_BATCH = 200;

const OPP_ID = /^006[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/;

export class SpecialistAeSoqlError extends Error {}

/** One batch's query: the VDP-type Specialist Forecasts on these opps, with their owners. */
export function specialistAesSoql(oppIds: readonly string[]): string {
  if (!oppIds.length || oppIds.length > AES_BATCH) throw new SpecialistAeSoqlError(`1 to ${AES_BATCH} opportunities per query`);
  const bad = oppIds.find((x) => !OPP_ID.test(x));
  if (bad !== undefined) throw new SpecialistAeSoqlError('not an Org62 opportunity id');
  const ids = [...new Set(oppIds)].map((x) => `'${x}'`).join(', ');
  const types = VDP_AE_FORECAST_TYPES.map((t) => `'${t}'`).join(', ');
  return `SELECT Opportunity__c, ForecastType__c, OwnerId, Owner.Name, Owner.Email FROM SpecialistForecast__c WHERE Opportunity__c IN (${ids}) AND ForecastType__c IN (${types}) ORDER BY Opportunity__c LIMIT 2000`;
}

/** The opp ids to read, in batches of at most 200 (15-character forms deduplicated). */
export function aeBatches(oppIds: readonly string[]): string[][] {
  const seen = new Set<string>();
  const ids = oppIds.filter((x) => OPP_ID.test(x) && !seen.has(x.slice(0, 15)) && seen.add(x.slice(0, 15)));
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += AES_BATCH) out.push(ids.slice(i, i + AES_BATCH));
  return out;
}

export class SpecialistAeParseError extends Error {}

const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** One query's records → per opp (15-character id) its VDP AEs, in the order Org62 returned them. */
export function parseSpecialistAes(raw: string): Map<string, SpecialistAe[]> {
  const t = raw.trim();
  const at = t.indexOf('{');
  if (at < 0) throw new SpecialistAeParseError('Org62 answered in a way the app could not read');
  let body: { records?: Array<Record<string, unknown>> };
  try {
    body = JSON.parse(t.slice(at)) as { records?: Array<Record<string, unknown>> };
  } catch {
    throw new SpecialistAeParseError('Org62 answered in a way the app could not read');
  }
  const out = new Map<string, SpecialistAe[]>();
  for (const r of body.records ?? []) {
    const opp = str(r.Opportunity__c);
    const type = str(r.ForecastType__c);
    const owner = (r.Owner ?? null) as Record<string, unknown> | null;
    const email = str(owner?.Email)?.toLowerCase() ?? null;
    if (!opp || !OPP_ID.test(opp) || !type || !(VDP_AE_FORECAST_TYPES as readonly string[]).includes(type) || !email || !EMAIL.test(email)) continue;
    const k = opp.slice(0, 15);
    out.set(k, [...(out.get(k) ?? []), { email, name: str(owner?.Name), type }]);
  }
  return out;
}

/** The stored cache: per Org62 opp (15 characters) its AEs, and which opps the last read asked about. */
export interface SpecialistAeCache {
  readAt: string | null;
  byOpp: Record<string, SpecialistAe[]>;
  /** The opps the last read covered (an opp read with no record is "no Specialist Forecast", not "not read"). */
  read: string[];
}

export const EMPTY_AE_CACHE: SpecialistAeCache = { readAt: null, byOpp: {}, read: [] };

/** A stored cache, checked (a missing or odd one reads as empty). */
export function aeCacheOf(raw: unknown): SpecialistAeCache {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<SpecialistAeCache>;
  const byOpp: Record<string, SpecialistAe[]> = {};
  for (const [k, v] of Object.entries(o.byOpp && typeof o.byOpp === 'object' ? o.byOpp : {})) {
    if (!Array.isArray(v)) continue;
    const list = v.filter((x): x is SpecialistAe => !!x && typeof x.email === 'string' && typeof x.type === 'string').map((x) => ({ email: x.email, name: typeof x.name === 'string' ? x.name : null, type: x.type }));
    if (list.length) byOpp[k.slice(0, 15)] = list;
  }
  return { readAt: typeof o.readAt === 'string' ? o.readAt : null, byOpp, read: Array.isArray(o.read) ? o.read.filter((x): x is string => typeof x === 'string') : [] };
}

/** The cache after a read of these opps: their records replace what was stored for them; the others stay. */
export function nextAeCache(prev: SpecialistAeCache, read: readonly string[], found: ReadonlyMap<string, SpecialistAe[]>, at: string): SpecialistAeCache {
  const keys = new Set(read.map((x) => x.slice(0, 15)));
  const byOpp: Record<string, SpecialistAe[]> = {};
  for (const [k, v] of Object.entries(prev.byOpp)) if (!keys.has(k)) byOpp[k] = v;
  for (const [k, v] of found) if (keys.has(k)) byOpp[k] = v;
  return { readAt: at, byOpp, read: [...new Set([...prev.read.filter((k) => !keys.has(k)), ...keys])] };
}

/** The gap engine's view: local opp id → its AEs, through each opp's Org62 id. */
export function aesByLocalOpp(cache: SpecialistAeCache, opps: readonly Pick<GapOpp, 'id' | 'org62OpportunityId'>[]): Map<string, SpecialistAe[]> {
  const out = new Map<string, SpecialistAe[]>();
  for (const o of opps) {
    const k = o.org62OpportunityId?.slice(0, 15);
    const list = k ? cache.byOpp[k] : undefined;
    if (list?.length) out.set(o.id, list);
  }
  return out;
}

/** The opps the read asks about: my open opps where my DC is 100% (D-63), by Org62 id. */
export const aeTargets = (opps: readonly Pick<GapOpp, 'org62OpportunityId' | 'isOpen' | 'dcSplit'>[]): string[] => opps.filter((o) => o.isOpen && o.dcSplit === 100 && !!o.org62OpportunityId).map((o) => o.org62OpportunityId!);
