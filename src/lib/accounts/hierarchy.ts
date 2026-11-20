/**
 * The Org62 account hierarchy (D-69, pure): every account of my book and its ancestors up to five levels, from a
 * read-only `SELECT Id, Name, ParentId FROM Account WHERE Id IN (…)` (src/engines/deals/soql.ts `accounts`), batched
 * by 200 ids and level by level (src/jobs/handlers/account-hierarchy.ts). Ancestors outside my book live here too: the
 * `accounts` table only holds my book (its `parent_account_id` can only point inside it).
 *
 * Where it is kept: the user's kv (`cc.org62.account_hierarchy`), like the Specialist Forecast AE cache. One small
 * JSON object (an id, a name and a parent id per account, a few hundred at most), replaced by each read, read the same
 * way by both DataSources, no migration. Refreshed daily (06:55) and after each Org62 read.
 *
 * Shared helper: the VDP company identity (src/engines/vdp/identity.ts) and the DC evidence matcher (DC-23, the
 * dc-roundtrip lane) read the chain, the cleaned names and the siblings from here. Ids compare on their 15-character
 * case-sensitive form.
 */
import { accountNameBase, brandOf, companyQueriesFor, companyQuery, normalizeCompanyName } from '@/lib/vdp/company-name';

export { accountNameBase, companyQuery, normalizeCompanyName };

/** Where each DataSource keeps the hierarchy (a per-user key-value row). */
export const ACCOUNT_HIERARCHY_KV = 'cc.org62.account_hierarchy';
/** Ancestors read above an account (its parent is level 1). */
export const HIERARCHY_MAX_LEVELS = 5;
/** At most this many ids per query. */
export const HIERARCHY_BATCH = 200;

export interface HierarchyNode {
  /** The Org62 Account id (15 characters). */
  id: string;
  name: string;
  /** The parent's id (15 characters), or null at the top. */
  parentId: string | null;
}

export interface AccountHierarchy {
  /** When the last read finished; null = never read. */
  readAt: string | null;
  /** Every account read, by its 15-character id. */
  nodes: Record<string, HierarchyNode>;
  /** Every id the reads asked about (an id Org62 did not return is "not found", not "not read"). */
  read: string[];
}

export const EMPTY_HIERARCHY: AccountHierarchy = { readAt: null, nodes: {}, read: [] };

const ACCOUNT_ID = /^001[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/;
export const id15 = (s: string | null | undefined): string | null => (s && s.length >= 15 ? s.slice(0, 15) : null);
export const isAccountId = (s: string | null | undefined): s is string => !!s && ACCOUNT_ID.test(s);

/** A stored hierarchy, checked (a missing or odd one reads as empty). */
export function hierarchyOf(raw: unknown): AccountHierarchy {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<AccountHierarchy>;
  const nodes: Record<string, HierarchyNode> = {};
  for (const [k, v] of Object.entries(o.nodes && typeof o.nodes === 'object' ? o.nodes : {})) {
    const n = v as Partial<HierarchyNode> | null;
    if (!n || typeof n.name !== 'string' || !isAccountId(typeof n.id === 'string' ? n.id : k)) continue;
    const id = id15(typeof n.id === 'string' ? n.id : k)!;
    nodes[id] = { id, name: n.name, parentId: isAccountId(n.parentId) ? id15(n.parentId) : null };
  }
  return { readAt: typeof o.readAt === 'string' ? o.readAt : null, nodes, read: Array.isArray(o.read) ? o.read.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 15)) : [] };
}

/**
 * The account and its ancestors, self first, at most `HIERARCHY_MAX_LEVELS` above it. Stops at the top, at an
 * ancestor not read yet, and at a cycle. Empty when the account itself was not read.
 */
export function chainOf(h: AccountHierarchy | null | undefined, org62AccountId: string | null | undefined): HierarchyNode[] {
  const start = id15(org62AccountId);
  if (!h || !start) return [];
  const out: HierarchyNode[] = [];
  const seen = new Set<string>();
  let cur: string | null = start;
  while (cur && !seen.has(cur) && out.length <= HIERARCHY_MAX_LEVELS) {
    const n: HierarchyNode | undefined = h.nodes[cur];
    if (!n) break;
    out.push(n);
    seen.add(cur);
    cur = n.parentId;
  }
  return out;
}

/** The chain is fully known: the read reached the top (no parent), or the five-level limit. */
export function chainComplete(h: AccountHierarchy | null | undefined, org62AccountId: string | null | undefined): boolean {
  const c = chainOf(h, org62AccountId);
  if (!c.length) return false;
  const last = c[c.length - 1]!;
  return !last.parentId || c.length > HIERARCHY_MAX_LEVELS || (!!h && h.read.includes(last.parentId) && !h.nodes[last.parentId]);
}

/** The top of the chain (the account itself when it has no parent read). */
export const topOf = (h: AccountHierarchy | null | undefined, org62AccountId: string | null | undefined): HierarchyNode | null => chainOf(h, org62AccountId).at(-1) ?? null;

/** Is `other` the account or one of its ancestors? */
export function inChain(h: AccountHierarchy | null | undefined, org62AccountId: string | null | undefined, other: string | null | undefined): boolean {
  const k = id15(other);
  return !!k && (id15(org62AccountId) === k || chainOf(h, org62AccountId).some((n) => n.id === k));
}

/** One level of the chain with the names the matching uses. */
export interface ChainLevel {
  level: number;
  id: string;
  name: string;
  /** Without " - org/product" segments ("Acme Corp - EMEA" → "Acme Corp"). */
  base: string;
  /** What `list_companies q` searches ("Acme"). */
  query: string;
  /** Every text this level is looked up with (the query first, then its d/b/a brand's and the cores): a level counts
   *  as looked up only when all are. */
  queries: string[];
  /** The brand a legal name trades under (d/b/a), matched like the base. */
  brand: string | null;
  /** VDP's normalized form of the base ("acme"). */
  key: string;
}

/** The chain as levels, self first; with no read, the account alone (its own name). */
export function chainLevels(h: AccountHierarchy | null | undefined, account: { name: string; org62AccountId: string | null }): ChainLevel[] {
  const c = chainOf(h, account.org62AccountId);
  const nodes = c.length ? c : [{ id: id15(account.org62AccountId) ?? '', name: account.name, parentId: null }];
  return nodes.map((n, level) => {
    // the account's own name as my book has it (the Org62 read may lag a rename)
    const name = level === 0 ? account.name : n.name;
    const base = accountNameBase(name);
    return { level, id: n.id, name, base, query: companyQuery(name), queries: companyQueriesFor(name), brand: brandOf(name), key: normalizeCompanyName(base) };
  });
}

/** The cleaned names up the chain, deduplicated by VDP's rule (self first). */
export function cleanedChainNames(h: AccountHierarchy | null | undefined, account: { name: string; org62AccountId: string | null }): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of chainLevels(h, account)) {
    if (!l.key || seen.has(l.key)) continue;
    seen.add(l.key);
    out.push(l.base);
  }
  return out;
}

export interface BookAccount {
  id: string;
  name: string;
  org62AccountId: string | null;
}

/** Accounts of my book that share the account's parent (not itself). Without a read parent: none. */
export function siblingsOf<A extends BookAccount>(h: AccountHierarchy | null | undefined, book: readonly A[], account: BookAccount): A[] {
  const parent = chainOf(h, account.org62AccountId)[1]?.id ?? null;
  if (!parent) return [];
  return book.filter((a) => a.id !== account.id && chainOf(h, a.org62AccountId)[1]?.id === parent);
}

/** Accounts of my book under the same top ancestor (itself included), by that ancestor's id. */
export function familyOf<A extends BookAccount>(h: AccountHierarchy | null | undefined, book: readonly A[], account: BookAccount): A[] {
  const top = topOf(h, account.org62AccountId)?.id ?? null;
  if (!top) return book.filter((a) => a.id === account.id);
  return book.filter((a) => a.id === account.id || topOf(h, a.org62AccountId)?.id === top);
}

/**
 * How two accounts relate in Org62: the same account, one above the other, siblings (one parent), cousins (one top
 * ancestor), or not at all. For evidence matching (DC-23): a message about a sibling is not about this account.
 */
export function relation(h: AccountHierarchy | null | undefined, a: string | null | undefined, b: string | null | undefined): 'same' | 'ancestor' | 'descendant' | 'sibling' | 'cousin' | null {
  const x = id15(a);
  const y = id15(b);
  if (!x || !y) return null;
  if (x === y) return 'same';
  if (inChain(h, x, y)) return 'ancestor';
  if (inChain(h, y, x)) return 'descendant';
  const px = chainOf(h, x)[1]?.id;
  if (px && px === chainOf(h, y)[1]?.id) return 'sibling';
  const tx = topOf(h, x)?.id;
  return tx && chainOf(h, x).length > 1 && tx === topOf(h, y)?.id ? 'cousin' : null;
}

// ---------------------------------------------------------------------------
// The read: ids to ask about, the records, the next stored hierarchy
// ---------------------------------------------------------------------------

/** Ids in batches of at most 200 (15-character forms deduplicated, Account ids only). */
export function hierarchyBatches(ids: readonly string[]): string[][] {
  const seen = new Set<string>();
  const list = ids.filter((x) => isAccountId(x) && !seen.has(x.slice(0, 15)) && seen.add(x.slice(0, 15)));
  const out: string[][] = [];
  for (let i = 0; i < list.length; i += HIERARCHY_BATCH) out.push(list.slice(i, i + HIERARCHY_BATCH));
  return out;
}

export class HierarchyParseError extends Error {}

/** One query's records (`{records: [{Id, Name, ParentId}]}`) → nodes. Names are kept as Org62 has them. */
export function parseHierarchyRecords(raw: string): HierarchyNode[] {
  const t = raw.trim();
  const at = t.indexOf('{');
  if (at < 0) throw new HierarchyParseError('Org62 answered in a way the app could not read');
  let body: { records?: Array<Record<string, unknown>> };
  try {
    body = JSON.parse(t.slice(at)) as { records?: Array<Record<string, unknown>> };
  } catch {
    throw new HierarchyParseError('Org62 answered in a way the app could not read');
  }
  const out: HierarchyNode[] = [];
  for (const r of body.records ?? []) {
    const id = typeof r.Id === 'string' && isAccountId(r.Id) ? id15(r.Id)! : null;
    const name = typeof r.Name === 'string' && r.Name.trim() ? r.Name.trim().slice(0, 255) : null;
    if (!id || !name) continue;
    out.push({ id, name, parentId: typeof r.ParentId === 'string' && isAccountId(r.ParentId) ? id15(r.ParentId) : null });
  }
  return out;
}

/** The parents the nodes name that were not asked about yet (the next level to read). */
export function unreadParents(h: AccountHierarchy, nodes: readonly HierarchyNode[]): string[] {
  const asked = new Set(h.read);
  return [...new Set(nodes.map((n) => n.parentId).filter((p): p is string => !!p && !asked.has(p) && !h.nodes[p]))];
}

/** The hierarchy after a read of these ids: their records replace what was stored for them; the others stay. */
export function nextHierarchy(prev: AccountHierarchy, read: readonly string[], found: readonly HierarchyNode[], at: string): AccountHierarchy {
  const keys = new Set(read.map((x) => x.slice(0, 15)));
  const nodes: Record<string, HierarchyNode> = {};
  for (const [k, v] of Object.entries(prev.nodes)) if (!keys.has(k)) nodes[k] = v;
  for (const n of found) if (keys.has(n.id)) nodes[n.id] = n;
  return { readAt: at, nodes, read: [...new Set([...prev.read.filter((k) => !keys.has(k)), ...keys])] };
}
