/**
 * The opportunity picker's list (./OppPicker.tsx), in groups, top match first. Pure (tested in ./rows.test.ts).
 *
 * Nothing typed:
 *   Suggested                    the row's suggestion (an opp, or internal work), with its reason
 *   Internal                     "Internal (no opportunity)": a first-class choice near the top, not the list's end
 *   <Account> opportunities      the account the app thinks the row is for (its own, the suggestion's, its evidence's)
 *   Used lately                  opps you logged to in the last 30 days
 *   Other opportunities          the rest that are open
 * Typed: the matches (the row's account first), Internal when the words say so, and "Search Org62 for …" (first when
 * nothing here matches, so Enter runs it) with the hits in place under "From Org62".
 */
import type { ActivityEntry, OppOption } from '@/contract';
import { filterOppOptions, tierOf } from '@/lib/opp-options';

/** At most this many in-app opps are listed (typing narrows them). */
export const MAX_LISTED = 60;

export type PickerItem =
  | { key: string; label: string; group?: string; disabled?: boolean; kind: 'opp'; opp: OppOption; suggested?: boolean }
  | { key: string; label: string; group?: string; disabled?: boolean; kind: 'internal'; suggested?: boolean }
  | { key: string; label: string; group?: string; disabled?: boolean; kind: 'search'; q: string }
  | { key: string; label: string; group?: string; disabled?: boolean; kind: 'clear' }
  | { key: string; label: string; group?: string; disabled?: boolean; kind: 'more'; n: number; total: number };

export const INTERNAL_LABEL = 'Internal (no opportunity)';

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const optLabel = (o: OppOption) => `${o.name}${o.accountName ? `, ${o.accountName}` : ''}`;

export interface PickerListInput {
  opps: OppOption[];
  q: string;
  entry: Pick<ActivityEntry, 'oppId' | 'internal' | 'accountName' | 'suggestion'>;
  /** The caller offers "Internal (no opportunity)". */
  internal: boolean;
  /** A bulk pick (Set the opportunity for N rows): no "No opportunity", and Internal even when the first row is internal. */
  bulk?: boolean;
  /** The Org62 search for this term has answered (its hits are listed by the caller under "From Org62"). */
  searched?: boolean;
  /** An Org62 search for this term is running. */
  searching?: boolean;
}

/** The account the app thinks the row is for: the row's own, else its suggestion's. */
export function likelyAccount(entry: PickerListInput['entry']): string | null {
  return entry.accountName ?? entry.suggestion?.accountName ?? null;
}

export function pickerList(i: PickerListInput): PickerItem[] {
  const term = i.q.trim();
  const s = i.entry.suggestion;
  const acct = norm(likelyAccount(i.entry));
  const wantsInternal = i.internal && (i.bulk || !i.entry.internal);
  const internalItem = (group: string, suggested = false): PickerItem => ({ key: 'internal', label: INTERNAL_LABEL, kind: 'internal', group, suggested });
  const out: PickerItem[] = [];
  // 2026-11-13 audit C7: the list never stops silently: it says how many more match
  const more = (all: number): PickerItem[] => (all > MAX_LISTED ? [{ key: 'more', label: `${all - MAX_LISTED} more match`, kind: 'more', n: all - MAX_LISTED, total: all, disabled: true }] : []);
  if (!term) {
    const all = filterOppOptions(i.opps, '', i.entry.oppId);
    const opps = all.slice(0, MAX_LISTED);
    const seen = new Set<string>();
    if (s && !i.bulk) {
      if (s.kind === 'internal' && wantsInternal) out.push(internalItem('Suggested', true));
      else if (s.kind === 'opp' && s.oppId) {
        const o = i.opps.find((x) => x.id === s.oppId);
        if (o) {
          out.push({ key: `opp:${o.id}`, label: optLabel(o), kind: 'opp', opp: o, group: 'Suggested', suggested: true });
          seen.add(o.id);
        }
      }
    }
    if (wantsInternal && !out.some((x) => x.kind === 'internal')) out.push(internalItem('Internal work'));
    const onAccount = (o: OppOption) => o.why.includes('account') || o.why.includes('evidence') || (!!acct && norm(o.accountName) === acct);
    const near = opps.filter((o) => !seen.has(o.id) && onAccount(o));
    const nearName = likelyAccount(i.entry) ?? (near.length && near.every((o) => o.accountName === near[0]!.accountName) ? near[0]!.accountName : null);
    for (const o of near) {
      seen.add(o.id);
      out.push({ key: `opp:${o.id}`, label: optLabel(o), kind: 'opp', opp: o, group: nearName ? `${nearName} opportunities` : 'For this row' });
    }
    const related = opps.filter((o) => !seen.has(o.id) && o.why.includes('related'));
    for (const o of related) {
      seen.add(o.id);
      out.push({ key: `opp:${o.id}`, label: optLabel(o), kind: 'opp', opp: o, group: 'Accounts in its evidence' });
    }
    for (const o of opps.filter((x) => !seen.has(x.id) && x.why.includes('recent'))) {
      seen.add(o.id);
      out.push({ key: `opp:${o.id}`, label: optLabel(o), kind: 'opp', opp: o, group: 'Used lately' });
    }
    for (const o of opps.filter((x) => !seen.has(x.id))) out.push({ key: `opp:${o.id}`, label: optLabel(o), kind: 'opp', opp: o, group: 'Other opportunities' });
    out.push(...more(all.length));
    if (i.entry.oppId && !i.bulk) out.push({ key: 'clear', label: 'No opportunity', kind: 'clear', group: 'Other' });
    return out;
  }
  // typed: the row's account first among the matches (filterOppOptions keeps tier first), then the rest
  const allMatches = filterOppOptions(i.opps, term, i.entry.oppId);
  const matches = allMatches.slice(0, MAX_LISTED);
  const lower = term.toLowerCase();
  const internalHit = wantsInternal && ('internal'.startsWith(lower) || /^(no opp|internal|none)/i.test(term));
  if (internalHit) out.push(internalItem('Internal work'));
  const search: PickerItem | null = term.length >= 2 && !i.searched ? { key: 'search', label: `Search Org62 for “${term}”`, kind: 'search', q: term, disabled: !!i.searching, group: matches.length ? 'Not here?' : 'Not in the app' } : null;
  // nothing in the app matches: the Org62 search is the first choice (Enter runs it)
  if (search && !matches.length) out.push(search);
  const forRow = (o: OppOption) => tierOf(o.why) >= 4 || (!!acct && norm(o.accountName) === acct);
  for (const o of [...matches.filter(forRow), ...matches.filter((x) => !forRow(x))]) out.push({ key: `opp:${o.id}`, label: optLabel(o), kind: 'opp', opp: o, group: forRow(o) ? 'For this row' : 'Matches' });
  out.push(...more(allMatches.length));
  if (search && matches.length) out.push(search);
  return out;
}
