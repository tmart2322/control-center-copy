/**
 * docs/UX.md "Live updates": arrivals may wait behind the "N new · Show" pill, never out of sight. A list that can
 * hold arrivals (useArrivalHold, or the default burst of 3) and never draws <LivePill> hides rows with no way to see
 * them (2026-11-16: Log it showed 1 of 71 rows ready, Needs you and Deals could do the same).
 *
 * Every useLiveList caller either draws the pill (itself, or the page that uses its hook), or holds nothing:
 * `burst: Infinity` and no `hold`.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/** A hook module that calls useLiveList → the page that draws its pill. */
const PILL_DRAWN_BY: Record<string, string> = {
  'src/components/home/live.ts': 'src/components/home/HomePage.tsx',
};

const callers = execFileSync('git', ['grep', '-l', 'useLiveList(', '--', 'src'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !f.startsWith('src/components/lists/') && !/\.test\.tsx?$/.test(f));

/** The options object of each useLiveList(...) call in a file (as text, up to the closing parenthesis). */
function callOptions(src: string): string[] {
  const out: string[] = [];
  let at = src.indexOf('useLiveList(');
  while (at >= 0) {
    let depth = 0;
    let end = at + 'useLiveList'.length;
    for (; end < src.length; end++) {
      if (src[end] === '(') depth++;
      else if (src[end] === ')' && --depth === 0) break;
    }
    out.push(src.slice(at, end + 1));
    at = src.indexOf('useLiveList(', end);
  }
  return out;
}

describe('live lists never hide held arrivals', () => {
  it('finds the callers', () => {
    expect(callers.length).toBeGreaterThan(3);
  });

  it.each(callers)('%s draws the pill or holds nothing', (file) => {
    const src = readFileSync(file, 'utf8');
    const drawn = /<LivePill\b/.test(src) || (PILL_DRAWN_BY[file] ? /<LivePill\b/.test(readFileSync(PILL_DRAWN_BY[file]!, 'utf8')) : false);
    if (drawn) return;
    for (const call of callOptions(src)) {
      expect(call, `${file}: draw <LivePill count={x.held.length} onShow={x.showHeld} />, or pass burst: Infinity and no hold`).toMatch(/burst:\s*Infinity/);
      expect(call).not.toMatch(/\bhold\b/);
    }
  });
});
