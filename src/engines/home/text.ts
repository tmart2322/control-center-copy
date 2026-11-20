/** Pure text helpers for Home labels (short names, sentence fragments). */

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const ACCOUNT_SUFFIX = /\s+(corporation|corp\.?|incorporated|inc\.?|company|co\.|llc|ltd\.?|plc|holdings|group|management|services|health|healthcare|master account record|master|account record|- us|us)$/i;

/** "Acme Corporation" → "Acme", "Globex Inc." → "Globex", "X d/b/a Initech Health" → "Initech Health". */
export function shortAccount(name: string | null | undefined): string {
  if (!name) return '';
  let s = name.trim();
  const dba = /\bd\/b\/a\s+/i.exec(s);
  if (dba) s = s.slice(dba.index + dba[0].length);
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  s = s.split(/\s+[-–|]\s+|,\s*/)[0]!.trim();
  for (let i = 0; i < 3; i++) {
    const next = s.replace(ACCOUNT_SUFFIX, '').trim();
    if (!next || next === s) break;
    s = next;
  }
  return s;
}

export function firstName(name: string | null | undefined): string {
  if (!name) return '';
  const clean = name.replace(/^@/, '').trim();
  return clean.split(/\s+/)[0] ?? clean;
}

/** Lowercase the first letter of a verb-first phrase unless the first word is an acronym ("SOW review"). */
export function lowerFirst(s: string): string {
  if (!s) return s;
  const first = s.split(/[\s:]/)[0] ?? '';
  if (/^[A-Z0-9]{2,}/.test(first)) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * The core verb phrase of a title, for sentences: drops the "for/before/against …" tail, a ": …" question,
 * and parentheticals. "Smoke-test both Acme demos before the 13:30 review" → "Smoke-test both Acme demos".
 */
export function corePhrase(title: string): string {
  let s = title.replace(/\s*\([^)]*\)/g, '').trim();
  s = s.split(/:\s/)[0]!.trim();
  s = s.replace(/\s+(before|against|after|ahead of|so that|once|until)\s.*$/i, '').trim();
  return s.replace(/[.?!]+$/, '');
}

/** Short meeting label: drops "[Internal]"/"*Internal*" prefixes, vendor "X | " prefixes and tails. */
export function shortEvent(title: string): string {
  let s = title.trim();
  s = s.replace(/^(\[[^\]]*\]|\*[^*]*\*)\s*/g, '').trim();
  if (s.includes(' | ')) s = s.split(' | ').pop()!.trim();
  s = s.replace(/\s*\([^)]*\)/g, '').trim();
  s = s.split(/:\s|\s+[-–]\s+/)[0]!.trim();
  return s || title;
}

/** Truncate to n chars on a word boundary with an ellipsis. */
export function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:\s]+$/, '')}…`;
}

/** First clause of a sentence ("VDP linkage … since 10/26; Q3 …" → "VDP linkage … since 10/26"). */
export function firstClause(s: string | null | undefined): string {
  if (!s) return '';
  return s.split(/;\s|\.\s/)[0]!.replace(/\.$/, '').trim();
}

/** "a, b and c" */
export function joinAnd(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
}
