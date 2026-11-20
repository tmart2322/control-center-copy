/**
 * The spellings a company is searched by in Drive, Slack, Gmail and Calendar (Find assets). Pure.
 *
 * Owner, 2026-11-14: "if Northwind comes up, we should look up just Northwind and not Northwind Health: the brand name
 * should be searched too." Files and channels are named the way people talk ("Northwind D360 deck", "#northwind-ext"), not
 * the Org62 legal name, so a search for the full name alone misses most of them. Each name yields:
 *  - the name itself, and its search text without legal suffixes or " - org" segments ("Acme Corp - EMEA" → "Acme");
 *  - its d/b/a brand ("Contoso Physicians d/b/a Fabrikam Shield" → "Fabrikam Shield");
 *  - its core, descriptor words dropped ("Northwind Health System" → "Northwind");
 *  - a parenthetical acronym ("Health Care Example Corporation (HCEC)" → "HCEC");
 *  - a distinctive first word ("Northwind Health Alliance" → "Northwind"), never an ordinary word on its own
 *    ("United", "Blue", "First"), which would match half the drive;
 *  - the acronym of a three-word-or-longer name, 3–6 letters ("Fabrikam Shield of Placeholdia" → "FSP").
 * The research model still judges every hit: a broader search finds more, it does not add more (owner: "if we push too
 * much non-helpful stuff in there then the value goes down").
 */
import { isOrdinaryNameWord } from '@/projections/matching';

import { accountNameBase, brandOf, companyQueriesFor } from './company-name';

/** "Health Care Example Corporation (HCEC)" → "HCEC" (2–8 capitals, digits or &). */
export function parenAcronym(name: string): string | null {
  const m = /\(([A-Z][A-Z0-9&]{1,7})\)/.exec(name);
  return m ? m[1]! : null;
}

/** The first word of a multi-word name when it can stand for the company on its own ("Northwind Health" → "Northwind"). */
export function distinctiveFirstWord(name: string): string | null {
  const words = accountNameBase(name.replace(/^[*\s]+/, '')).replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first || words.length < 2) return null;
  const letters = first.replace(/[^\p{L}]/gu, '');
  const acronym = /^[A-Z]{3,6}$/.test(first);
  if (!acronym && letters.length < 4) return null;
  if (isOrdinaryNameWord(first)) return null;
  return first;
}

/** Words an acronym skips (the matcher's ACRONYM_SKIP, src/projections/matching.ts). */
const ACRONYM_SKIP = new Set(['of', 'the', 'and', 'inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited', 'plc', 'co']);

/**
 * The acronym of a name of three or more words, 3–6 letters: "Fabrikam Shield of Placeholdia" → "FSP", "Contoso Cross &
 * Contoso Shield of North Placeholdia" → "CCCSNP" is 6: kept; longer ones are not how people write it. A name whose
 * short forms are all ordinary words ("Blue …") is searched by this.
 */
export function acronymOf(name: string): string | null {
  const words = accountNameBase(name.replace(/^[*\s]+/, ''))
    .replace(/\([^)]*\)/g, ' ')
    .split(/[\s,.&/+-]+/)
    .filter((w) => /^\p{L}/u.test(w) && !ACRONYM_SKIP.has(w.toLowerCase()));
  if (words.length < 3) return null;
  const ac = words.map((w) => w[0]!.toUpperCase()).join('');
  return ac.length >= 3 && ac.length <= 6 ? ac : null;
}

/** Every spelling to search with, most specific first, without repeats (case-insensitive). At most `max`. */
export function searchNamesFor(names: readonly string[], max = 10): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string | null | undefined) => {
    const v = (s ?? '').replace(/^[*\s]+/, '').replace(/\s+/g, ' ').trim();
    if (v.length < 2) return;
    const k = v.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(v);
  };
  for (const n of names) add(n);
  for (const n of names) {
    for (const q of companyQueriesFor(n.replace(/^[*\s]+/, ''))) add(q);
    const brand = brandOf(n);
    if (brand) add(distinctiveFirstWord(brand));
    add(parenAcronym(n));
    add(distinctiveFirstWord(n));
    add(acronymOf(n));
  }
  return out.slice(0, max);
}
