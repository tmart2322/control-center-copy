/** Text helpers for read-back matching: compare words, not formatting. */

/** Lowercased words with markup, links, entities and punctuation removed. */
export function plainWords(s: string): string[] {
  return s
    .replace(/<[^>|]+\|([^>]+)>/g, '$1') // Slack <url|label>
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // markdown [label](url)
    .replace(/<[^>]*>/g, ' ') // html tags, Slack <@U…>
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, ' ')
    .replace(/[*_~`>#•◦▪‣|\\]/g, ' ')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** True when the first `n` words of `expected` appear in order, contiguously, in `actual`. */
export function containsLead(actual: string, expected: string, n = 12): boolean {
  const want = plainWords(expected).slice(0, n);
  if (!want.length) return false;
  const have = plainWords(actual);
  outer: for (let i = 0; i + want.length <= have.length; i++) {
    for (let j = 0; j < want.length; j++) if (have[i + j] !== want[j]) continue outer;
    return true;
  }
  return false;
}

export const str = (v: unknown): string | null => (typeof v === 'string' && v.length ? v : null);
export const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []);
