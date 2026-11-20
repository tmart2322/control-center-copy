/**
 * The first scan as the shell shows it (B-079): per-source progress, time left and what it means, from Health's
 * `firstScan` (the worker's first-scan ledger joined with each scope's committed coverage). Pure; tested in
 * src/components/shell/first-scan.test.ts.
 *
 * Time left: each source on its own pace (elapsed × left / done once it is 10% in and 5 minutes have passed), else the
 * measured duration of that lookback (FIRST-SCAN-RAMP: 7 d ≈ 54 min, 14 d ≈ 114 min, 30 d ≈ 4 h) minus the time so
 * far. The slowest source decides, so a fast Calendar never makes it look nearly done.
 */
import { durationText, firstScanMinutes, type FirstScanProgress } from '@/contract';

const MIN = 60_000;

const LABEL: Record<string, string> = {
  slack: 'Slack',
  gmail: 'Gmail',
  calendar: 'Calendar',
  drive: 'Drive',
  gemini_notes: 'Gemini notes',
  org62: 'Org62',
  claude_sessions: 'Claude sessions',
  trainings: 'Trainings',
  vdp: 'VDP',
  watch: 'Watched channels',
};
export const sourceLabel = (connector: string) => LABEL[connector] ?? connector;

export interface FirstScanSource {
  connector: string;
  label: string;
  pct: number;
  done: boolean;
}

export interface FirstScanView {
  /** 0–100 across every scope. */
  pct: number;
  sources: FirstScanSource[];
  /** null: unknown (the one-time budget ran out, or it's taking longer than usual). */
  leftMs: number | null;
  /** "about 3 h left", "almost done", "taking longer than usual". */
  leftText: string;
  /** "Filling in, about 3 h left" (Home, Work and Deals). */
  fillingText: string;
  /** The one-time budget ran out: the rest continues under the daily cap, slower. */
  exhausted: boolean;
  lookbackDays: number;
  startedAt: string;
}

/** Null when there is no first scan, or it finished: nothing to show. */
export function firstScanView(fs: FirstScanProgress | null | undefined, now: number): FirstScanView | null {
  if (!fs || fs.status === 'done' || !fs.scopes.length) return null;
  if (fs.scopes.every((s) => s.status === 'done')) return null;
  const by = new Map<string, number[]>();
  for (const s of fs.scopes) {
    const p = s.status === 'done' ? 100 : Math.max(0, Math.min(100, s.coveredPct ?? 0));
    by.set(s.connector, [...(by.get(s.connector) ?? []), p]);
  }
  const sources: FirstScanSource[] = [...by].map(([connector, ps]) => {
    const pct = Math.round(ps.reduce((a, b) => a + b, 0) / ps.length);
    return { connector, label: sourceLabel(connector), pct, done: ps.every((p) => p >= 100) };
  });
  // the slowest first, done last: the banner lists what is holding it up
  sources.sort((a, b) => Number(a.done) - Number(b.done) || a.pct - b.pct || a.label.localeCompare(b.label));
  const all = fs.scopes.map((s) => (s.status === 'done' ? 100 : Math.max(0, Math.min(100, s.coveredPct ?? 0))));
  const pct = Math.round(all.reduce((a, b) => a + b, 0) / all.length);

  const elapsed = Math.max(0, now - Date.parse(fs.startedAt));
  const expected = firstScanMinutes(fs.lookbackDays) * MIN;
  const exhausted = fs.status === 'exhausted';
  let leftMs: number | null = null;
  if (!exhausted) {
    const lefts = sources.filter((s) => !s.done).map((s) => (s.pct >= 10 && elapsed >= 5 * MIN ? (elapsed * (100 - s.pct)) / s.pct : expected - elapsed));
    leftMs = lefts.length ? Math.max(...lefts) : 0;
  }
  const late = leftMs !== null && leftMs <= 0;
  const leftText = exhausted ? 'slower now: the one-time budget is spent' : late ? (pct >= 90 ? 'almost done' : 'taking longer than usual') : `${durationText(leftMs! / MIN)} left`;
  const fillingText = exhausted ? 'Filling in, under your daily cap now' : late ? (pct >= 90 ? 'Filling in, almost done' : 'Filling in, taking longer than usual') : `Filling in, ${durationText(leftMs! / MIN)} left`;
  return { pct, sources, leftMs: late || exhausted ? null : Math.round(leftMs!), leftText, fillingText, exhausted, lookbackDays: fs.lookbackDays, startedAt: fs.startedAt };
}
