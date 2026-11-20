/**
 * Change… on a VDP company node (D-69), shared by both DataSources. Pure: callers load the mirror, the stored lookups
 * and the mappings, and persist the result (kv `cc.vdp.identity` on the db; the store's `vdpIdentity` in the mock),
 * each change one undoable change set. Nothing here calls VDP: a live `list_companies` (read-only) is the caller's.
 *
 *   search     the companies the mirror names (my VDPs'), the stored list_companies results, and VDP's own answer
 *              when live; by name or alias (a substring, case and accents ignored), exact names (VDP's rule) first
 *   set        a user-locked mapping: these Org62 accounts are this company (one VDP has, or one to create with the
 *              name you typed). It replaces the node's mapping and takes its accounts from any other one
 *   clear      the node goes back to the app's own decision
 */
import type { SearchVdpCompaniesResult, SetVdpIdentityRequest, VdpCompanyHit, VdpCoveragePayload } from '@/contract';
import { withOverride, type IdentityOverride } from '@/engines/vdp/identity';
import { normalizeCompanyName, sameCompanyName } from '@/lib/vdp/company-name';
import type { VdpCompanyMatch, VdpServerInfo, VdpSnapshot } from '@/lib/vdp/types';
import { invalid } from '@/server/errors';

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

/** The companies the app already knows that match `q` (the mirror's and the stored lookups'), exact names first. */
export function searchCompaniesLocal(q: string, snaps: readonly VdpSnapshot[], server: VdpServerInfo | null | undefined, live: readonly VdpCompanyMatch[] = []): VdpCompanyHit[] {
  const k = fold(q.trim());
  const out = new Map<string, VdpCompanyHit>();
  const hit = (m: { id: string; name: string; slug?: string | null; aliases?: string[]; vdpCount?: number | null }, source: VdpCompanyHit['source']) => {
    const names = [m.name, ...(m.aliases ?? [])];
    if (!k || !names.some((n) => fold(n).includes(k))) return;
    const cur = out.get(m.id);
    out.set(m.id, { id: m.id, name: m.name, slug: m.slug ?? cur?.slug ?? null, aliases: [...new Set([...(cur?.aliases ?? []), ...(m.aliases ?? [])])], vdpCount: m.vdpCount ?? cur?.vdpCount ?? null, source: cur && cur.source === 'live' ? 'live' : source });
  };
  for (const m of live) hit(m, 'live');
  for (const c of server?.companies ?? []) for (const m of c.matches) hit(m, 'lookup');
  for (const s of snaps) if (s.company.id) hit({ id: s.company.id, name: s.company.name, slug: s.company.slug }, 'mirror');
  return [...out.values()].sort((a, b) => Number(sameCompanyName(b.name, q)) - Number(sameCompanyName(a.name, q)) || (b.vdpCount ?? -1) - (a.vdpCount ?? -1) || a.name.localeCompare(b.name)).slice(0, 25);
}

export function searchResult(q: string, companies: VdpCompanyHit[], live: boolean, note: string | null = null): SearchVdpCompaniesResult {
  return { q, companies, live, note };
}

/**
 * The mapping a Change… makes: the accounts must be my book's; a match needs VDP's id and name; a create the name you
 * typed. Its key is the node it makes (`account:<first account>`).
 */
export function overrideFrom(req: SetVdpIdentityRequest, accounts: ReadonlyArray<{ id: string; name: string }>, now: string): IdentityOverride {
  const known = new Set(accounts.map((a) => a.id));
  const ids = [...new Set(req.accountIds)];
  const missing = ids.filter((a) => !known.has(a));
  if (missing.length) throw invalid(`Not an account of yours: ${missing.join(', ')}`);
  if (req.pick.kind === 'create' && !normalizeCompanyName(req.pick.name)) throw invalid('Type the company name');
  const pick = req.pick.kind === 'match' ? { kind: 'match' as const, id: req.pick.id.trim(), name: req.pick.name.trim() } : { kind: 'create' as const, name: req.pick.name.trim(), aliases: [...new Set(req.pick.aliases.map((a) => a.trim()).filter(Boolean))] };
  return { key: `account:${ids[0]!}`, accountIds: ids, pick, at: now };
}

/** The mappings after a Change…. */
export const nextOverrides = (list: readonly IdentityOverride[], next: IdentityOverride, replaces?: string | null) => withOverride(list, next, replaces);

/** The mappings after Reset on a node (its mapping dropped). */
export const withoutOverride = (list: readonly IdentityOverride[], key: string) => list.filter((o) => o.key !== key);

/** A node's identity as the coverage reads now. */
export const identityIn = (cov: Pick<VdpCoveragePayload, 'identities'>, key: string) => cov.identities.find((i) => i.key === key) ?? null;
