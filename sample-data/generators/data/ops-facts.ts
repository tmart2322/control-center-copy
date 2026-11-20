/** Domain 03: per-run windows, cursors and counters (so jobs, runs, events, ledger and calls all agree). */
import { rng, slackTs } from '../../lib/kit';
import { CONN, DAY, HOUR, MIN, iso, type ConnKey } from './ops-lib';
import type { RunT } from './ops-runs';

export interface Facts { seen: number; nw: number; upd: number; unch: number; skipped: number; links: number; cands: number; errors: number; turns: number; unlinked: number }
export interface RunX extends RunT {
  n: number;
  winFrom: number;
  winTo: number;
  cursorBeforeAt: number | null;
  cursorAfterAt: number | null;
  cursorValue: string | null;
  f: Facts;
  attempt: number;
  endMs: number;
}
const R = rng('ops-facts');

const PROFILE: Record<ConnKey, { seen: [number, number]; nw: [number, number]; upd: [number, number]; skip: [number, number]; links: [number, number]; cands: [number, number]; turns: [number, number] }> = {
  slack: { seen: [20, 110], nw: [3, 22], upd: [0, 4], skip: [2, 12], links: [2, 12], cands: [0, 3], turns: [8, 26] },
  'gmail-work': { seen: [10, 45], nw: [2, 14], upd: [0, 3], skip: [3, 15], links: [1, 8], cands: [0, 2], turns: [4, 14] },
  'gmail-shared': { seen: [3, 18], nw: [0, 6], upd: [0, 2], skip: [0, 4], links: [0, 4], cands: [0, 2], turns: [3, 9] },
  drive: { seen: [12, 60], nw: [0, 6], upd: [1, 9], skip: [4, 25], links: [0, 5], cands: [0, 3], turns: [4, 14] },
  calendar: { seen: [8, 32], nw: [0, 5], upd: [1, 7], skip: [0, 3], links: [1, 6], cands: [0, 2], turns: [3, 8] },
  'gemini-notes': { seen: [1, 5], nw: [0, 2], upd: [0, 1], skip: [0, 1], links: [1, 5], cands: [1, 4], turns: [6, 18] },
  org62: { seen: [20, 85], nw: [0, 4], upd: [3, 16], skip: [0, 6], links: [0, 6], cands: [0, 2], turns: [3, 12] },
  claude: { seen: [5, 40], nw: [0, 6], upd: [3, 14], skip: [1, 14], links: [0, 6], cands: [0, 2], turns: [3, 10] },
  vdp: { seen: [8, 14], nw: [0, 0], upd: [0, 3], skip: [0, 1], links: [0, 0], cands: [0, 1], turns: [0, 0] },
};

export function enrichRuns(runs: RunT[]): RunX[] {
  const lowPtr = new Map<string, number>(); // (conn|scope) -> oldest covered instant
  const lastTo = new Map<string, number>(); // (conn|scope) -> newest covered instant
  const out: RunX[] = [];
  const attempts = new Map<string, number>();
  runs.forEach((r, i) => {
    const key = `${r.conn}|${r.scope ?? 'reconcile'}`;
    const p = PROFILE[r.conn];
    const startMs = r.startMs;
    const endMs = r.finishPin ?? r.startMs + r.durMs;
    let winFrom: number; let winTo: number;
    const prevTo = lastTo.get(key);
    if (r.mode === 'backfill') {
      const deep = r.story?.startsWith('slack-backfill');
      const span = deep ? 14 * DAY : 7 * DAY;
      const low = lowPtr.get(key) ?? startMs - DAY;
      winTo = low; winFrom = low - span;
      if (r.status === 'succeeded') lowPtr.set(key, winFrom);
    } else if (r.mode === 'reconcile') {
      winFrom = startMs - 3 * DAY; winTo = startMs;
    } else if (r.pmode === 'head' && !prevTo) {
      winTo = startMs; winFrom = startMs - DAY;
    } else {
      winTo = startMs; winFrom = prevTo ?? startMs - (r.conn === 'slack' ? 15 : 30) * MIN;
      if (winFrom > winTo - MIN) winFrom = winTo - 15 * MIN;
    }
    if (r.mode !== 'backfill' && r.mode !== 'reconcile') {
      if (!lowPtr.has(key)) lowPtr.set(key, winFrom);
    }
    const ok = r.status === 'succeeded';
    const big = r.mode === 'backfill' ? 4 : r.pmode === 'head' && !prevTo ? 3 : 1;
    const gap = Math.min(4, Math.max(1, (winTo - winFrom) / HOUR / 3)); // longer window since last poll sees more
    const mul = r.mode === 'reconcile' ? 0.25 : big * (r.mode === 'backfill' ? 1 : Math.sqrt(gap));
    const seen = ok || r.status === 'partial' ? Math.round(R.int(...p.seen) * mul) : r.status === 'failed' && r.err?.cause === 'cost_cap' ? Math.round(R.int(...p.seen) * mul * 0.7) : r.status === 'failed' && r.err?.cause !== 'auth' && r.err?.cls !== 'rate_limited' && R.chance(0.35) ? R.int(2, 14) : 0;
    const nw = Math.min(seen, Math.round(R.int(...p.nw) * (r.mode === 'backfill' ? 3 : mul / 1.4)));
    const upd = Math.min(seen - nw, ok ? R.int(...p.upd) : 0);
    const skipped = Math.min(Math.max(0, seen - nw - upd), seen ? R.int(...p.skip) : 0);
    const unch = Math.max(0, seen - nw - upd - skipped);
    const links = ok ? Math.min(nw + upd, R.int(...p.links)) : Math.min(nw, 1);
    const cands = ok ? R.int(...p.cands) : 0;
    const errors = ok ? 0 : r.status === 'cancelled' ? 0 : r.status === 'partial' ? 1 : 1;
    const turns = r.conn === 'vdp' ? 0 : ok ? R.int(...p.turns) : R.int(2, 9);
    const unlinked = ok ? Math.max(0, nw - links) : 0;
    const f: Facts = { seen, nw, upd, unch, skipped, links, cands, errors, turns, unlinked };
    // cursors
    let cBefore: number | null = null;
    let cAfter: number | null = null;
    let cval: string | null = null;
    if (r.mode !== 'reconcile') {
      cBefore = prevTo ?? null;
      if (ok || r.status === 'partial') {
        cAfter = r.mode === 'backfill' ? winTo : winTo;
        if (r.mode !== 'backfill') lastTo.set(key, winTo);
        cval = r.conn === 'slack' ? slackTs(iso(winTo), i % 90) : r.conn.startsWith('gmail') ? `hist-${String(4_810_000 + Math.floor((winTo - 1_792_000_000_000) / 60_000)).slice(0, 7)}` : iso(winTo);
      } else if (r.mode !== 'backfill' && !prevTo) lastTo.set(key, winFrom); // head run failed: nothing advances
    }
    const att = (attempts.get(r.retryOfKey ?? '') ?? 0) + (r.retryOfKey ? 1 : 0);
    attempts.set(r.key, att);
    out.push({ ...r, n: i + 1, winFrom, winTo, cursorBeforeAt: cBefore, cursorAfterAt: cAfter, cursorValue: cval, f, attempt: att, endMs });
    void CONN;
  });
  return out;
}
