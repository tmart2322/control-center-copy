/**
 * Company names as VDP compares them (D-69). Pure.
 *
 *   normalizeCompanyName   vdp-app's own rule, ported exactly (lib/services/companyService.ts on origin/main): lower
 *                          case, accents stripped (NFKD, U+0300–U+036F), `.` and `,` removed, whitespace collapsed, ONE
 *                          trailing legal suffix dropped. `create_company` refuses a name (or alias) whose normalized form
 *                          equals an active company's name or alias, so this is the only equality the app trusts.
 *   accountNameBase        an Org62 account name without its " - org/product" segments and a trailing "(…)": the name
 *                          the company would go by ("Acme Corp - Marketing Cloud" → "Acme Corp")
 *   companyQuery           what `list_companies q` searches for (a substring match upstream): the base with every
 *                          trailing legal suffix and the punctuation dropped ("Acme Corp, Inc." → "Acme"), so the parent's
 *                          VDP company shows up in the results even when the account's name carries more words
 */

/** vdp-app `normalizeCompanyName` (origin/main), byte for byte in behavior. */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+(inc|llc|corp|corporation|ltd|limited|company|co|plc|group|holdings)$/i, '')
    .trim();
}

/** Two names VDP treats as one company (its duplicate rule). Empty names never match. */
export function sameCompanyName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeCompanyName(a ?? '');
  return x !== '' && x === normalizeCompanyName(b ?? '');
}

/** A company and its aliases against one name, VDP's rule. */
export const companyMatchesName = (c: { name: string; aliases?: readonly string[] | null }, name: string): boolean => sameCompanyName(c.name, name) || (c.aliases ?? []).some((a) => sameCompanyName(a, name));

/** " - ", " – ", " — " and " | " start an org or product segment in an Org62 account name. */
const SEGMENT = /\s+[-–—|]\s+|\s*\|\s*/;

/** "Acme Corp - Marketing Cloud (EMEA)" → "Acme Corp". Never empty: a name that is only a segment stays as it is. */
export function accountNameBase(name: string): string {
  const t = name.replace(/\s+/g, ' ').trim();
  const first = t.split(SEGMENT)[0]!.replace(/\s*\([^)]*\)\s*$/, '').replace(/[\s,.;:]+$/, '').trim();
  return first || t;
}

const LEGAL = /[\s,]+(inc|incorporated|llc|l\.l\.c|corp|corporation|ltd|limited|company|co|plc|group|holdings|gmbh|ag|sa|s\.a|nv|bv|pty|pte)\.?$/i;
/** Multi-word legal forms ('Kommanditgesellschaft auf Aktien' is KGaA). */
const LEGAL_LONG = /[\s,]+(kommanditgesellschaft auf aktien|kgaa|a mutual legal reserve company|a mutual legal reserve)\.?$/i;

/** "Acme Corp, Inc. - EMEA" → "Acme": the substring `list_companies q` searches for. */
export function companyQuery(name: string): string {
  let t = accountNameBase(name);
  for (let i = 0; i < 4; i++) {
    const next = t.replace(LEGAL_LONG, '').replace(LEGAL, '').trim();
    if (next === t || !next) break;
    t = next;
  }
  return t.replace(/[.,]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || accountNameBase(name).slice(0, 200);
}

/** The words of a normalized name ("acme retail banking" → acme, retail, banking). */
const wordsOf = (s: string) => normalizeCompanyName(s).split(' ').filter(Boolean);

/**
 * The child's name starts with every word of the parent's ("Acme Retail Banking" under "Acme"): a subsidiary that
 * carries the parent's name with extra words. It may still be a company of its own: the judgment decides.
 */
export function extendsName(child: string, parent: string): boolean {
  const c = wordsOf(child);
  const p = wordsOf(parent);
  return p.length > 0 && c.length > p.length && p.every((w, i) => c[i] === w);
}

/** " d/b/a ", " dba ", " doing business as ": the brand a legal name trades under. */
const DBA = /\s+(?:d\/b\/a|dba|doing business as)\s+/i;

/** "Contoso Physicians' Service d/b/a Fabrikam Shield" → "Fabrikam Shield"; null without one. */
export function brandOf(name: string): string | null {
  const parts = accountNameBase(name).split(DBA);
  const b = parts.length > 1 ? parts.slice(1).join(' ').trim() : '';
  return b || null;
}

/** Descriptor words a company's own name often carries after its core ("Northwind Health", "Contoso Corporate Services"). */
const DESCRIPTOR = new Set(['health', 'healthcare', 'care', 'services', 'service', 'solutions', 'systems', 'system', 'alliance', 'network', 'networks', 'management', 'corporate', 'behavioral', 'technologies', 'technology', 'enterprises', 'partners', 'international', 'global', 'plans', 'plan', 'insurance', 'pharmaceuticals', 'pharma', 'sciences', 'science', 'holding', 'holdings', 'group']);

/**
 * The core VDP may know a company by ("Northwind Health" → "Northwind", "Contoso Corporate Services, LLC" → "Contoso"): the
 * search text with its trailing descriptor words dropped. `list_companies` is a substring search, so "Northwind Health"
 * never finds a company named "Northwind"; the core does. Null when nothing is dropped or what is left is too short.
 */
export function coreQuery(name: string): string | null {
  const words = companyQuery(name).split(' ').filter(Boolean);
  let n = words.length;
  while (n > 1 && DESCRIPTOR.has(words[n - 1]!.toLowerCase().replace(/[^a-z]/g, ''))) n -= 1;
  if (n === words.length) return null;
  const core = words.slice(0, n).join(' ');
  return core.replace(/[^\p{L}]/gu, '').length >= 4 && !DESCRIPTOR.has(core.toLowerCase()) ? core : null;
}

/** Every text a name is looked up with: its search text, its brand's (d/b/a), and the cores of both. */
export function companyQueriesFor(name: string): string[] {
  const brand = brandOf(name);
  const out = [companyQuery(name), ...(brand ? [companyQuery(brand)] : []), coreQuery(name), ...(brand ? [coreQuery(brand)] : [])];
  return [...new Set(out.filter((q): q is string => !!q && q.trim() !== ''))];
}
