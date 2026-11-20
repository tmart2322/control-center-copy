/**
 * Company identity (D-69, pure): which VDP company each engaged account belongs to, and which accounts go together
 * (one company = one node in the Changes tree = one VDP per period). The steps run in this order:
 *
 *   you          a mapping you made with Change… (user-locked: survives every read; Undo / Reset drops it)
 *   by id        a VDP of mine links one of the account's opps, or carries its Org62 account id (an ancestor's id
 *                too, when the account is that ancestor's plain " - org/product" child: VD-10)
 *   by name      up the Org62 chain (self first, at most five levels), VDP's own rule (normalizeCompanyName, aliases
 *                too) against what `list_companies` returned for each level and the companies my VDPs name. The first
 *                level with a hit decides. Deterministic when exactly one company matches the account's own name, or
 *                the hit is an ancestor whose name is the account's without its suffix ("Acme - EMEA" under "Acme")
 *   create       no level matched: the closest plain parent's name ("Acme Corp - EMEA" under "Acme Corp" → "Acme
 *                Corp"), the other names as aliases. Deterministic only when every level was looked up and returned
 *                no row at all and the whole chain carries one name
 *   judgment     everything else is ambiguous (several companies with the name; a match only higher up the chain
 *                while the account has a name of its own, like a subsidiary brand; a parent with another name above
 *                an account with none to match; near matches): the `vdp-company-identity` skill's cached decision
 *                applies when its inputs are unchanged. Sure (≥ 0.75) → a suggestion; else, or not run yet, "Needs
 *                you" with the best guess pre-selected and the alternatives. Never a silent create
 *   VDP count    VD-07: a matched company with more VDPs in VDP (`get_company` vdp_count) than I can see: "N VDPs you
 *                are not on", never a duplicate create_vdp
 *
 * Accounts that decide on the same company form one group (VD-03); a sibling whose opps are on the other's VDP joins
 * it (VD-04). A name not looked up yet keeps the node "Not looked up yet" (VD-02). Only a deterministic identity (or
 * yours) lets VDP autopilot create anything (D-60).
 */
import type { VdpCompanyIdentity, VdpIdentityAlternative, VdpIdentityPick } from '@/contract';
import { chainComplete, chainLevels, chainOf, familyOf, id15, siblingsOf, type AccountHierarchy, type ChainLevel } from '@/lib/accounts/hierarchy';
import { companyMatchesName, companyQueriesFor, coreQuery, extendsName, normalizeCompanyName } from '@/lib/vdp/company-name';
import { oppIdsOf, type VdpCompanyLookup, type VdpCompanyMatch, type VdpSnapshot } from '@/lib/vdp/types';

/** The parts of the gap engine's entities identity reads (src/engines/vdp/gaps.ts GapAccount / GapOpp). */
export interface IdentityAccount {
  id: string;
  name: string;
  org62AccountId: string | null;
}
export interface IdentityOpp {
  id: string;
  accountId: string | null;
  org62OpportunityId: string | null;
  isOpen: boolean;
  dcSplit: number | null;
}

/** Your mapping (Change…): these accounts are this company. Kept in kv `cc.vdp.identity`. */
export interface IdentityOverride {
  /** The node it made (`account:<accountIds[0]>`). */
  key: string;
  accountIds: string[];
  pick: VdpIdentityPick;
  at: string;
}

/** One account's decision from the judgment skill (src/engines/vdp/identity-judge.ts). */
export interface JudgedAccount {
  accountId: string;
  pick: VdpIdentityPick;
  /** The chain level the company sits at (0 = the account itself). */
  level: number;
  confidence: number;
  reason: string;
}

/** The cached judgment of one ambiguity unit (an account and its relatives in my book), valid for `hash`. */
export interface IdentityJudgment {
  hash: string;
  at: string;
  model: string;
  accounts: JudgedAccount[];
}

export const VDP_IDENTITY_KV = 'cc.vdp.identity';
export const VDP_IDENTITY_JUDGE_KV = 'cc.vdp.identity.judgments';
/** A judgment at least this sure is a suggestion; below it, "Needs you". */
export const JUDGMENT_SURE = 0.75;

export interface IdentityInput {
  accounts: readonly IdentityAccount[];
  opps: readonly IdentityOpp[];
  /** My VDPs (listed, not archived). */
  vdps: readonly VdpSnapshot[];
  /** VD-14: VDPs archived in VDP or no longer mine (the mirror keeps their last read). */
  tombstones?: readonly VdpSnapshot[];
  hierarchy: AccountHierarchy | null;
  lookups: readonly VdpCompanyLookup[];
  judgments?: Readonly<Record<string, IdentityJudgment>>;
  overrides?: readonly IdentityOverride[];
}

export interface CompanyGroup {
  key: string;
  primaryAccountId: string;
  accountIds: string[];
  identity: VdpCompanyIdentity;
  /** My listed VDPs in the group (by VDP id). */
  vdpIds: string[];
}

/** One unit the judgment step looks at: an ambiguous account and its relatives, and what VDP returned up its chain. */
export interface JudgmentRequest {
  key: string;
  hash: string;
  accounts: Array<{ id: string; name: string; chain: Array<{ level: number; name: string; base: string }>; siblings: string[] }>;
  /** Per account, the VDP companies its chain names matched or nearly matched (id, name, aliases, VDP count, level). */
  options: Array<{ accountId: string; level: number; id: string; name: string; aliases: string[]; vdpCount: number | null; exact: boolean }>;
  /** Why it is ambiguous, per account ("several", "higher", "create_level", "near"). */
  kinds: Record<string, string>;
}

export interface IdentityResult {
  groups: CompanyGroup[];
  groupOfAccount: Map<string, CompanyGroup>;
  groupOfVdp: Map<string, CompanyGroup>;
  /** The units the judgment step should decide (no cached decision for their current inputs). */
  pending: JudgmentRequest[];
  /** Every ambiguous unit (judged or not), by key. */
  units: Map<string, JudgmentRequest>;
}

type State = VdpCompanyIdentity['state'];
type By = VdpCompanyIdentity['by'];

interface Decision {
  accountId: string;
  pick: VdpIdentityPick;
  state: State;
  by: By;
  confidence: number;
  deterministic: boolean;
  reason: string;
  alternatives: VdpIdentityAlternative[];
  /** A VDP of mine decided it (by id). */
  vdpIds: string[];
  /** Why the evidence is ambiguous (judgment input), when it is. */
  ambiguity: string | null;
  /** VD-07: VDP count of the matched company, when read. */
  vdpCount: number | null;
  /** VD-14: the tombstoned VDP that covers it. */
  tombstone: { slug: string; why: string } | null;
}

const engagedOf = (o: IdentityOpp) => o.isOpen && o.dcSplit === 100;
const key15 = (s: string | null | undefined) => id15(s);
const djb2 = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};
const matchPick = (m: { id: string; name: string }): VdpIdentityPick => ({ kind: 'match', id: m.id, name: m.name });
/** A company to create: the name, and the other names it goes by (one per VDP-normalized form, never the name's own). */
function createPick(name: string, aliases: readonly string[] = []): Extract<VdpIdentityPick, { kind: 'create' }> {
  const seen = new Set([normalizeCompanyName(name)]);
  const out: string[] = [];
  for (const a of aliases) {
    const k = normalizeCompanyName(a);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(a.trim().slice(0, 200));
  }
  return { kind: 'create', name, aliases: out.slice(0, 50) };
}
const pickKey = (p: VdpIdentityPick) => (p.kind === 'match' ? `c:${p.id}` : `n:${normalizeCompanyName(p.name)}`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The text each level is looked up with (the fetcher's queries). */
export function identityQueries(i: Pick<IdentityInput, 'accounts' | 'opps' | 'vdps' | 'hierarchy' | 'overrides'> & Partial<Pick<IdentityInput, 'judgments'>>): string[] {
  const linked = linkedAccounts(i);
  const engaged = new Set(i.opps.filter((o) => engagedOf(o) && o.accountId).map((o) => o.accountId!));
  const overridden = new Set((i.overrides ?? []).filter((o) => o.pick.kind === 'match').flatMap((o) => o.accountIds));
  const out = new Set<string>();
  for (const a of i.accounts) {
    if (!engaged.has(a.id) || linked.has(a.id) || overridden.has(a.id)) continue;
    for (const l of chainLevels(i.hierarchy, a)) for (const q of l.queries) out.add(q);
  }
  // a name the judgment would create is looked up before it is ever proposed (VDP may have it under that name)
  for (const j of Object.values(i.judgments ?? {})) for (const x of j.accounts) if (x.pick.kind === 'create') for (const q of companyQueriesFor(x.pick.name)) out.add(q);
  return [...out].sort();
}

/** Accounts a VDP of mine links (one of its opps, or its own Org62 account id on the header). */
function linkedAccounts(i: Pick<IdentityInput, 'accounts' | 'opps' | 'vdps'>): Set<string> {
  const out = new Set<string>();
  const byOpp = new Map(i.opps.filter((o) => o.org62OpportunityId).map((o) => [key15(o.org62OpportunityId)!, o]));
  for (const v of i.vdps) {
    for (const id of oppIdsOf(v)) {
      const o = byOpp.get(key15(id) ?? '');
      if (o?.accountId) out.add(o.accountId);
    }
    const h = key15(v.salesforceAccountId);
    if (h) for (const a of i.accounts) if (key15(a.org62AccountId) === h) out.add(a.id);
  }
  return out;
}

/** What a level's lookup says: the companies that match its name by VDP's rule, and the near rows. */
function levelHits(l: ChainLevel, lookups: readonly VdpCompanyLookup[], mirrored: readonly VdpCompanyMatch[]): { looked: boolean; exact: VdpCompanyMatch[]; near: VdpCompanyMatch[]; rows: number } {
  const queries = l.queries?.length ? l.queries : [l.query];
  const found = queries.map((q) => lookups.find((x) => x.query === q) ?? null);
  const rows = [...new Map(found.flatMap((lk) => lk?.matches ?? []).map((m) => [m.id, m])).values()];
  const byId = new Map<string, VdpCompanyMatch>();
  const named = (m: VdpCompanyMatch) => companyMatchesName(m, l.base) || (!!l.brand && companyMatchesName(m, l.brand));
  for (const m of [...rows, ...mirrored]) if (named(m) && !byId.has(m.id)) byId.set(m.id, { ...m });
  const exact = [...byId.values()];
  // the VDP count only lookups carry: keep it on a mirrored company found by name
  for (const e of exact) if (e.vdpCount === undefined) e.vdpCount = rows.find((r) => r.id === e.id)?.vdpCount;
  return { looked: found.every((x) => !!x), exact, near: rows.filter((m) => !byId.has(m.id)), rows: rows.length };
}

const altOf = (m: VdpCompanyMatch, why: string): VdpIdentityAlternative => ({ pick: matchPick(m), why, vdpCount: m.vdpCount ?? null });

/** One engaged account's decision (no override). */
function decide(a: IdentityAccount, i: IdentityInput, ctx: { mirrored: VdpCompanyMatch[]; oppVdps: Map<string, VdpSnapshot[]> }): Decision {
  const levels = chainLevels(i.hierarchy, a);
  const known = chainOf(i.hierarchy, a.org62AccountId).length > 0;
  const complete = known && chainComplete(i.hierarchy, a.org62AccountId);
  const base: Omit<Decision, 'pick' | 'state' | 'by' | 'confidence' | 'deterministic' | 'reason'> = { accountId: a.id, alternatives: [], vdpIds: [], ambiguity: null, vdpCount: null, tombstone: null };
  const own = levels[0]!;

  // ---- by id: a VDP of mine links one of its opps, or carries its account id (or a plain parent's: VD-10)
  const viaOpp = ctx.oppVdps.get(a.id) ?? [];
  const mine = key15(a.org62AccountId);
  const viaHeader = i.vdps.filter((v) => !!mine && key15(v.salesforceAccountId) === mine);
  const direct = [...new Map([...viaOpp, ...viaHeader].map((v) => [v.id, v])).values()];
  if (direct.length) {
    const v = direct[0]!;
    return { ...base, vdpIds: direct.map((x) => x.id), pick: v.company.id ? matchPick({ id: v.company.id, name: v.company.name }) : createPick(v.company.name), state: 'resolved', by: 'vdp', confidence: 1, deterministic: !!v.company.id, reason: viaOpp.length ? `Your VDP ${v.slug} links its opportunity` : `Your VDP ${v.slug} carries its Org62 account id` };
  }
  for (const l of levels.slice(1)) {
    const up = i.vdps.filter((v) => key15(v.salesforceAccountId) === l.id);
    if (!up.length) continue;
    const v = up[0]!;
    const pick = v.company.id ? matchPick({ id: v.company.id, name: v.company.name }) : createPick(v.company.name);
    if (l.key === own.key) return { ...base, vdpIds: up.map((x) => x.id), pick, state: 'resolved', by: 'vdp', confidence: 0.95, deterministic: !!v.company.id, reason: `Your VDP ${v.slug} carries its parent's account id (${l.base}), the same name without its suffix` };
    // a parent's VDP while the account has a name of its own: judgment (a subsidiary brand may stay separate)
    return { ...base, pick: extendsName(own.base, l.base) ? pick : createPick(own.base), state: 'needs_you', by: 'rules', confidence: 0.5, deterministic: false, ambiguity: 'higher', alternatives: [{ pick, why: `Your VDP ${v.slug} is for its parent ${l.base}`, vdpCount: null }, { pick: createPick(own.base), why: `Its own name: a company of its own`, vdpCount: null }], reason: `Your VDP ${v.slug} is for its parent ${l.base}; ${own.base} may be a company of its own` };
  }

  // ---- by name, up the chain: the first level with a hit decides
  const hits = levels.map((l) => ({ l, ...levelHits(l, i.lookups, ctx.mirrored) }));
  const first = hits.findIndex((h) => h.exact.length > 0);
  const missing = hits.filter((h, idx) => !h.looked && (first < 0 || idx < first));
  if (first >= 0 && !missing.length) {
    const h = hits[first]!;
    const ranked = [...h.exact].sort((x, y) => (y.vdpCount ?? -1) - (x.vdpCount ?? -1) || x.name.localeCompare(y.name));
    const alts = [...ranked.map((m) => altOf(m, `VDP has “${m.name}”${m.vdpCount ? ` (${plural(m.vdpCount, 'VDP')})` : ''}${first ? `, its ${first === 1 ? 'parent' : 'ancestor'}'s name` : ''}`)), ...(first > 0 && own.key !== h.l.key ? [{ pick: createPick(own.base), why: 'Its own name: a company of its own', vdpCount: null }] : [])];
    if (ranked.length > 1) return { ...base, pick: matchPick(ranked[0]!), vdpCount: ranked[0]!.vdpCount ?? null, state: 'needs_you', by: 'name', confidence: 0.4, deterministic: false, ambiguity: 'several', alternatives: alts, reason: `${ranked.length} VDP companies match “${h.l.base}”: pick one` };
    const m = ranked[0]!;
    if (first === 0) return { ...base, pick: matchPick(m), vdpCount: m.vdpCount ?? null, state: 'resolved', by: 'name', confidence: 1, deterministic: true, alternatives: alts, reason: `VDP has “${m.name}”, its name by VDP's own rule` };
    if (h.l.key === own.key) return { ...base, pick: matchPick(m), vdpCount: m.vdpCount ?? null, state: 'resolved', by: 'name', confidence: 0.95, deterministic: true, alternatives: alts, reason: `VDP has “${m.name}”: its ${first === 1 ? 'parent' : 'ancestor'} ${h.l.base}, the same name without “${own.name.slice(own.base.length).replace(/^[\s\-–—|]+/, '') || 'its suffix'}”` };
    // a match only higher up while the account has a name of its own: maybe a subsidiary that stays separate
    const guess = extendsName(own.base, h.l.base) ? matchPick(m) : createPick(own.base);
    return { ...base, pick: guess, vdpCount: guess.kind === 'match' ? (m.vdpCount ?? null) : null, state: 'needs_you', by: 'rules', confidence: 0.5, deterministic: false, ambiguity: 'higher', alternatives: alts, reason: `VDP has its ${first === 1 ? 'parent' : 'ancestor'} “${m.name}”; ${own.base} has a name of its own` };
  }
  if (missing.length) {
    return { ...base, pick: createPick(own.base), state: 'not_looked_up', by: 'rules', confidence: 0, deterministic: false, reason: `Not looked up in VDP yet: ${missing.map((h) => `“${h.l.query}”`).join(', ')} (the next VDP read does)` };
  }

  // ---- VDP knows it by its core ("Northwind" for "Northwind Health"): the best guess, never a silent create
  // only the account's own name family: its own level, a plain parent with its name, or a parent whose name it carries
  // ("Acme Health DC/AF" under "Acme Health"); a parent with another name (a subsidiary's brand) never lends its core
  const family = levels.filter((l) => l.key === own.key || extendsName(own.base, l.base));
  const cores = new Set(family.map((l) => coreQuery(l.brand ?? l.base) ?? coreQuery(l.base)).filter((c): c is string => !!c).map((c) => normalizeCompanyName(c)));
  const coreHit = cores.size ? hits.flatMap((h) => h.near).find((m) => [m.name, ...(m.aliases ?? [])].some((n) => cores.has(normalizeCompanyName(n)))) : undefined;
  if (coreHit) {
    const alts = [altOf(coreHit, `VDP has “${coreHit.name}”${coreHit.vdpCount ? ` (${plural(coreHit.vdpCount, 'VDP')})` : ''}: ${own.base} under a shorter name?`), { pick: createPick(own.base), why: 'Its own name: a company of its own', vdpCount: null }];
    return { ...base, pick: matchPick(coreHit), vdpCount: coreHit.vdpCount ?? null, state: 'needs_you', by: 'name', confidence: 0.6, deterministic: false, ambiguity: 'near', alternatives: alts, reason: `VDP has “${coreHit.name}”: the same company as ${own.base}? Pick it, or create ${own.base}` };
  }

  // ---- no level matched: create, at the closest plain parent
  let plainTop = 0;
  while (plainTop + 1 < levels.length && levels[plainTop + 1]!.key === own.key) plainTop += 1;
  const name = levels[plainTop]!.base;
  const aliases = levels.slice(0, plainTop + 1).map((l) => l.base);
  const distinct = levels.some((l) => l.key !== own.key);
  const rows = hits.reduce((t, h) => t + h.rows, 0);
  const near = hits.flatMap((h) => h.near.map((m) => altOf(m, `VDP has “${m.name}” (a near match for “${h.l.query}”)`)));
  const nearAlts = [...new Map(near.map((x) => [pickKey(x.pick), x])).values()].slice(0, 6);
  const pick = createPick(name, aliases);
  if (!known) return { ...base, pick, state: 'resolved', by: 'rules', confidence: 0.7, deterministic: false, alternatives: nearAlts, ambiguity: rows ? 'near' : null, reason: `VDP has no company by that name; its Org62 parent is not read yet` };
  if (!distinct) {
    if (!rows && complete) return { ...base, pick, state: 'resolved', by: 'rules', confidence: 1, deterministic: true, reason: levels.length > 1 ? `VDP has no company by that name or its parent's: create “${name}”` : `VDP has no company by that name: create “${name}”` };
    return { ...base, pick, state: 'resolved', by: 'rules', confidence: 0.8, deterministic: false, alternatives: nearAlts, ambiguity: rows ? 'near' : null, reason: rows ? `No exact match; VDP has similar names: check them first` : `VDP has no company by that name (its Org62 chain is not complete)` };
  }
  if (plainTop > 0) {
    const top = levels[levels.length - 1]!;
    return { ...base, pick, state: 'resolved', by: 'rules', confidence: 0.8, deterministic: false, alternatives: [...nearAlts, { pick: createPick(top.base), why: `Its top parent: ${top.base}`, vdpCount: null }], ambiguity: rows ? 'near' : null, reason: `Create “${name}”: the closest parent with its name; ${top.base} above it has another name` };
  }
  // its own name, a parent with another name above it: a company of its own, or part of the parent?
  const parent = levels[1]!;
  const guess = extendsName(own.base, parent.base) ? createPick(parent.base, [own.base]) : pick;
  return { ...base, pick: guess, state: 'needs_you', by: 'rules', confidence: 0.5, deterministic: false, ambiguity: 'create_level', alternatives: [{ pick, why: `Its own name: a company of its own`, vdpCount: null }, { pick: createPick(parent.base, [own.base]), why: `Its parent's: ${parent.base}`, vdpCount: null }, ...nearAlts], reason: `VDP has neither name: is ${own.base} its own company, or part of ${parent.base}?` };
}

/** The judgment's decision for an account, when its unit was judged on these inputs. */
function judged(d: Decision, unit: JudgmentRequest | undefined, j: IdentityJudgment | undefined, vdpKnows: { lookups: readonly VdpCompanyLookup[]; mirrored: readonly VdpCompanyMatch[] } = { lookups: [], mirrored: [] }): Decision {
  if (!unit || !j || j.hash !== unit.hash) return d;
  const x = j.accounts.find((y) => y.accountId === d.accountId);
  if (!x) return d;
  // a name to create is one VDP must not already have: an existing company by VDP's rule is the match instead, and a
  // name not looked up yet waits for the lookup (the next read asks for it: identityQueries)
  if (x.pick.kind === 'create' && x.pick.name.trim()) {
    const name = x.pick.name;
    const all = [...vdpKnows.lookups.flatMap((l) => l.matches), ...vdpKnows.mirrored];
    const has = all.find((m) => companyMatchesName(m, name));
    if (has) return { ...d, pick: matchPick(has), vdpCount: has.vdpCount ?? null, state: x.confidence >= JUDGMENT_SURE ? 'resolved' : 'needs_you', by: 'judgment', confidence: Math.max(0, Math.min(1, x.confidence)), deterministic: false, reason: `VDP already has “${has.name}”: ${x.reason || d.reason}` };
    const unread = companyQueriesFor(name).filter((q) => !vdpKnows.lookups.some((l) => l.query === q));
    if (unread.length) return { ...d, pick: createPick(name, x.pick.aliases), state: 'not_looked_up', by: 'judgment', confidence: 0, deterministic: false, reason: `Looking up “${name}” in VDP before creating it (the next VDP read does)` };
  }
  // a match must be one the evidence named; a create needs a name
  const known = new Set(unit.options.filter((o) => o.accountId === d.accountId).map((o) => o.id));
  if (x.pick.kind === 'match' && !known.has(x.pick.id) && !d.alternatives.some((a) => a.pick.kind === 'match' && a.pick.id === (x.pick as { id: string }).id)) return d;
  if (x.pick.kind === 'create' && !x.pick.name.trim()) return d;
  const sure = x.confidence >= JUDGMENT_SURE;
  const vdpCount = x.pick.kind === 'match' ? (unit.options.find((o) => o.id === (x.pick as { id: string }).id)?.vdpCount ?? null) : null;
  return { ...d, pick: x.pick, vdpCount, state: sure ? 'resolved' : 'needs_you', by: 'judgment', confidence: Math.max(0, Math.min(1, x.confidence)), deterministic: false, reason: x.reason || d.reason };
}

const STATE_RANK: Record<State, number> = { not_looked_up: 0, needs_you: 1, tombstoned: 2, hidden_vdps: 3, resolved: 4 };

/** Resolve every engaged account's company and group them. */
export function resolveCompanyIdentity(i: IdentityInput): IdentityResult {
  const accById = new Map(i.accounts.map((a) => [a.id, a]));
  const engaged = new Set(i.opps.filter((o) => engagedOf(o) && o.accountId && accById.has(o.accountId)).map((o) => o.accountId!));
  const mirrored: VdpCompanyMatch[] = [...new Map(i.vdps.filter((v) => v.company.id).map((v) => [v.company.id!, { id: v.company.id!, name: v.company.name, slug: v.company.slug }])).values()];
  const byOpp = new Map(i.opps.filter((o) => o.org62OpportunityId).map((o) => [key15(o.org62OpportunityId)!, o]));
  const oppVdps = new Map<string, VdpSnapshot[]>();
  for (const v of i.vdps) {
    for (const id of oppIdsOf(v)) {
      const o = byOpp.get(key15(id) ?? '');
      if (o?.accountId) oppVdps.set(o.accountId, [...(oppVdps.get(o.accountId) ?? []).filter((x) => x.id !== v.id), v]);
    }
  }

  // ---- your mappings first (the latest one wins an account)
  const overrides = [...(i.overrides ?? [])].sort((x, y) => y.at.localeCompare(x.at));
  const ownedBy = new Map<string, IdentityOverride>();
  for (const o of overrides) for (const a of o.accountIds) if (accById.has(a) && !ownedBy.has(a)) ownedBy.set(a, o);

  // ---- each engaged account's decision
  const decisions = new Map<string, Decision>();
  for (const id of engaged) {
    if (ownedBy.has(id)) continue;
    decisions.set(id, decide(accById.get(id)!, i, { mirrored, oppVdps }));
  }

  // ---- the ambiguous ones, in units (an account and its relatives in my book), for the judgment
  const units = new Map<string, JudgmentRequest>();
  const unitOf = new Map<string, string>();
  const book = i.accounts.filter((a) => engaged.has(a.id));
  for (const d of decisions.values()) {
    if (!d.ambiguity) continue;
    const a = accById.get(d.accountId)!;
    const fam = familyOf(i.hierarchy, book, a).filter((x) => decisions.get(x.id)?.ambiguity);
    const ukey = `unit:${[...fam.map((x) => x.id)].sort().join('+')}`;
    for (const x of fam) unitOf.set(x.id, ukey);
    if (units.has(ukey)) continue;
    const accountsIn = fam.map((x) => ({ id: x.id, name: x.name, chain: chainLevels(i.hierarchy, x).map((l) => ({ level: l.level, name: l.name, base: l.base })), siblings: siblingsOf(i.hierarchy, i.accounts, x).map((s) => s.name) }));
    const options = fam.flatMap((x) =>
      chainLevels(i.hierarchy, x).flatMap((l) => {
        const h = levelHits(l, i.lookups, mirrored);
        return [...h.exact.map((m) => ({ m, exact: true })), ...h.near.map((m) => ({ m, exact: false }))].map(({ m, exact }) => ({ accountId: x.id, level: l.level, id: m.id, name: m.name, aliases: m.aliases ?? [], vdpCount: m.vdpCount ?? null, exact }));
      }),
    );
    const kinds = Object.fromEntries(fam.map((x) => [x.id, decisions.get(x.id)!.ambiguity!]));
    const hash = djb2(JSON.stringify({ accountsIn, options: options.map((o) => [o.accountId, o.level, o.id, o.name, o.aliases, o.vdpCount, o.exact]), kinds }));
    units.set(ukey, { key: ukey, hash, accounts: accountsIn, options, kinds });
  }
  const pending: JudgmentRequest[] = [];
  for (const [id, d] of decisions) {
    const ukey = unitOf.get(id);
    if (!ukey) continue;
    const unit = units.get(ukey)!;
    const j = i.judgments?.[ukey];
    if (!j || j.hash !== unit.hash) {
      if (!pending.includes(unit)) pending.push(unit);
      continue;
    }
    decisions.set(id, judged(d, unit, j, { lookups: i.lookups, mirrored }));
  }

  // ---- VD-07 hidden VDPs and VD-14 tombstones, per decision
  const visible = (companyId: string) => i.vdps.filter((v) => v.company.id === companyId).length;
  for (const [id, d] of decisions) {
    if (d.state !== 'resolved' || d.pick.kind !== 'match' || d.vdpIds.length) continue;
    const hidden = Math.max(0, (d.vdpCount ?? 0) - visible(d.pick.id));
    if (hidden > 0 && !visible(d.pick.id)) decisions.set(id, { ...d, state: 'hidden_vdps', reason: `VDP holds ${plural(hidden, 'VDP')} for “${d.pick.name}” that you are not on: ask its owner to add you (no new VDP)` });
  }
  for (const [id, d] of decisions) {
    if (d.vdpIds.length) continue;
    const a = accById.get(id)!;
    const t = (i.tombstones ?? []).find((v) => (d.pick.kind === 'match' && v.company.id === d.pick.id) || (!!key15(v.salesforceAccountId) && key15(v.salesforceAccountId) === key15(a.org62AccountId)) || oppIdsOf(v).some((x) => byOpp.get(key15(x) ?? '')?.accountId === id));
    if (t) decisions.set(id, { ...d, state: 'tombstoned', tombstone: { slug: t.slug, why: t.archivedAt ? 'Archived in VDP' : 'You are no longer on it' }, reason: `${t.archivedAt ? 'Archived in VDP' : 'You are no longer on'} ${t.slug}: not created again (Change… to pick another company)` });
  }

  // ---- groups: one per company decided (yours, then each match or name to create; an unsure account alone)
  const groups: CompanyGroup[] = [];
  const groupOfAccount = new Map<string, CompanyGroup>();
  const depth = (id: string) => chainOf(i.hierarchy, accById.get(id)?.org62AccountId).length || 1;
  const primaryOf = (ids: string[]) => [...ids].sort((x, y) => depth(x) - depth(y) || accById.get(x)!.name.localeCompare(accById.get(y)!.name) || x.localeCompare(y))[0]!;
  const accountsView = (ids: string[]) => ids.map((x) => ({ id: x, name: accById.get(x)!.name, chain: chainLevels(i.hierarchy, accById.get(x)!).map((l) => l.base) }));
  for (const o of overrides) {
    const ids = o.accountIds.filter((a) => accById.has(a) && ownedBy.get(a) === o);
    if (!ids.some((a) => engaged.has(a))) continue;
    const primary = ids[0]!;
    const g: CompanyGroup = {
      key: `account:${primary}`,
      primaryAccountId: primary,
      accountIds: ids,
      vdpIds: i.vdps.filter((v) => (o.pick.kind === 'match' && v.company.id === o.pick.id) || ids.some((a) => (oppVdps.get(a) ?? []).some((x) => x.id === v.id))).map((v) => v.id),
      identity: { key: `account:${primary}`, state: 'resolved', by: 'you', pick: o.pick, confidence: 1, deterministic: true, reason: o.pick.kind === 'match' ? `You picked “${o.pick.name}” in Change…` : `You chose to create “${o.pick.name}” in Change…`, alternatives: [], accounts: accountsView(ids), candidates: [], hiddenVdps: 0, override: { at: o.at } },
    };
    groups.push(g);
    for (const a of ids) groupOfAccount.set(a, g);
  }
  const buckets = new Map<string, Decision[]>();
  for (const d of decisions.values()) {
    const k = d.state === 'resolved' || d.state === 'hidden_vdps' || d.state === 'tombstoned' ? `${pickKey(d.pick)}${d.state === 'tombstoned' ? ':t' : ''}` : `a:${d.accountId}`;
    buckets.set(k, [...(buckets.get(k) ?? []), d]);
  }
  for (const ds of buckets.values()) {
    const ids = ds.map((d) => d.accountId);
    const primary = primaryOf(ids);
    const lead = [...ds].sort((x, y) => STATE_RANK[x.state] - STATE_RANK[y.state] || (x.accountId === primary ? -1 : y.accountId === primary ? 1 : 0))[0]!;
    const alternatives = [...new Map(ds.flatMap((d) => d.alternatives).map((x) => [pickKey(x.pick), x])).values()].filter((x) => pickKey(x.pick) !== pickKey(lead.pick));
    const aliases = lead.pick.kind === 'create' ? createPick(lead.pick.name, [...lead.pick.aliases, ...ds.flatMap((d) => (d.pick.kind === 'create' ? [d.pick.name, ...d.pick.aliases] : [])), ...ids.map((x) => chainLevels(i.hierarchy, accById.get(x)!)[0]!.base)]).aliases : [];
    const pick: VdpIdentityPick = lead.pick.kind === 'create' ? { ...lead.pick, aliases } : lead.pick;
    const hidden = lead.state === 'hidden_vdps' && pick.kind === 'match' ? Math.max(0, (lead.vdpCount ?? 0) - visible(pick.id)) : 0;
    const g: CompanyGroup = {
      key: `account:${primary}`,
      primaryAccountId: primary,
      accountIds: [primary, ...ids.filter((x) => x !== primary)],
      vdpIds: [...new Set(ds.flatMap((d) => d.vdpIds))],
      identity: {
        key: `account:${primary}`,
        state: lead.state,
        by: lead.by,
        pick,
        confidence: Math.min(...ds.map((d) => d.confidence)),
        deterministic: ds.every((d) => d.deterministic) && lead.state === 'resolved',
        reason: ids.length > 1 ? `${lead.reason} · ${plural(ids.length, 'account')} under it` : lead.reason,
        alternatives,
        accounts: accountsView([primary, ...ids.filter((x) => x !== primary)]),
        candidates: [],
        hiddenVdps: hidden,
        override: null,
      },
    };
    groups.push(g);
    for (const a of ids) groupOfAccount.set(a, g);
  }

  // in my book's order (the primary account's), so the tree and the items keep a stable order
  const order = new Map(i.accounts.map((a, n) => [a.id, n]));
  groups.sort((x, y) => (order.get(x.primaryAccountId) ?? 0) - (order.get(y.primaryAccountId) ?? 0));

  // ---- the VDPs of mine in each group: by its opps, its account id, then its company
  const groupOfVdp = new Map<string, CompanyGroup>();
  for (const v of i.vdps) {
    const viaOpp = oppIdsOf(v).map((x) => byOpp.get(key15(x) ?? '')?.accountId).find((a): a is string => !!a && groupOfAccount.has(a));
    const h = key15(v.salesforceAccountId);
    const viaHeader = h ? i.accounts.find((a) => key15(a.org62AccountId) === h && groupOfAccount.has(a.id))?.id : undefined;
    const viaCompany = v.company.id ? groups.find((g) => g.identity.pick.kind === 'match' && g.identity.pick.id === v.company.id && g.identity.state !== 'needs_you') : undefined;
    const viaVdp = groups.find((g) => g.vdpIds.includes(v.id));
    const g = (viaOpp ? groupOfAccount.get(viaOpp) : undefined) ?? (viaHeader ? groupOfAccount.get(viaHeader) : undefined) ?? viaVdp ?? viaCompany;
    if (!g) continue;
    groupOfVdp.set(v.id, g);
    if (!g.vdpIds.includes(v.id)) g.vdpIds.push(v.id);
  }

  // ---- what Change… offers: the other engaged accounts, relatives first
  for (const g of groups) {
    const fam = new Set(g.accountIds.flatMap((x) => familyOf(i.hierarchy, book, accById.get(x)!).map((y) => y.id)));
    g.identity.candidates = book
      .filter((a) => !g.accountIds.includes(a.id))
      .map((a) => ({ id: a.id, name: a.name, why: fam.has(a.id) ? 'Same Org62 parent' : 'Another engaged account of yours' }))
      .sort((x, y) => (x.why === y.why ? x.name.localeCompare(y.name) : x.why === 'Same Org62 parent' ? -1 : 1));
  }
  return { groups, groupOfAccount, groupOfVdp, pending, units };
}

/**
 * VD-07, for any caller (the Use_Case__c duplicate guard too): how many VDPs VDP holds for this company that I can't
 * see (`get_company` vdp_count, stored with the lookups, minus my listed VDPs of it); null when the count was not read.
 */
export function hiddenVdpCount(companyId: string, lookups: readonly VdpCompanyLookup[], vdps: readonly Pick<VdpSnapshot, 'company'>[]): number | null {
  const counts = lookups.flatMap((l) => l.matches).filter((m) => m.id === companyId && typeof m.vdpCount === 'number').map((m) => m.vdpCount!);
  if (!counts.length) return null;
  return Math.max(0, Math.max(...counts) - vdps.filter((v) => v.company.id === companyId).length);
}

/** A stored set of mappings, checked (a missing or odd one reads as none). */
export function overridesOf(raw: unknown): IdentityOverride[] {
  const list = Array.isArray((raw as { overrides?: unknown } | null)?.overrides) ? ((raw as { overrides: unknown[] }).overrides as unknown[]) : [];
  const out: IdentityOverride[] = [];
  for (const x of list) {
    const o = x as Partial<IdentityOverride> | null;
    if (!o || typeof o.key !== 'string' || typeof o.at !== 'string' || !Array.isArray(o.accountIds) || !o.pick || typeof o.pick !== 'object') continue;
    const p = o.pick as Partial<VdpIdentityPick> & { kind?: string; id?: unknown; name?: unknown; aliases?: unknown };
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    if (!name) continue;
    const pick: VdpIdentityPick | null = p.kind === 'match' && typeof p.id === 'string' ? { kind: 'match', id: p.id, name } : p.kind === 'create' ? { kind: 'create', name, aliases: Array.isArray(p.aliases) ? p.aliases.filter((a): a is string => typeof a === 'string') : [] } : null;
    if (!pick) continue;
    out.push({ key: o.key, accountIds: o.accountIds.filter((a): a is string => typeof a === 'string'), pick, at: o.at });
  }
  return out;
}

/** The mappings after Change… on a node: the new one replaces the node's and takes its accounts from the others. */
export function withOverride(list: readonly IdentityOverride[], next: IdentityOverride, replaces?: string | null): IdentityOverride[] {
  const taken = new Set(next.accountIds);
  return [next, ...list.filter((o) => o.key !== next.key && o.key !== replaces).map((o) => ({ ...o, accountIds: o.accountIds.filter((a) => !taken.has(a)) })).filter((o) => o.accountIds.length)];
}

/** A stored judgment cache, checked. */
export function judgmentsOf(raw: unknown): Record<string, IdentityJudgment> {
  const o = (raw && typeof raw === 'object' ? (raw as { units?: unknown }).units : null) as Record<string, unknown> | null;
  const out: Record<string, IdentityJudgment> = {};
  for (const [k, v] of Object.entries(o && typeof o === 'object' ? o : {})) {
    const j = v as Partial<IdentityJudgment> | null;
    if (!j || typeof j.hash !== 'string' || typeof j.at !== 'string' || !Array.isArray(j.accounts)) continue;
    out[k] = { hash: j.hash, at: j.at, model: typeof j.model === 'string' ? j.model : '', accounts: j.accounts.filter((a): a is JudgedAccount => !!a && typeof a.accountId === 'string' && !!a.pick && typeof a.confidence === 'number') };
  }
  return out;
}
