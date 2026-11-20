'use client';
/**
 * The first-scan banner (B-079): one line under the topbar on every page while the first scan runs. It says how far
 * it got per source, about how long is left, and why it is worth waiting ("items may be missing or look undone until
 * it finishes"), so a quiet Home on day one reads as "filling in", not "nothing to do". Data: Health's `firstScan`
 * (the chrome's 30-second Health poll), shaped by first-scan.ts. Gone once the first scan is done.
 *
 * Colour is an indicator: the bars are neutral while a source fills in and "ready" once it is done; the strip itself
 * is the info tint (in progress).
 */
import { useMemo } from 'react';
import { AppLink } from './AppLink';
import { useChromeData } from './data';
import { firstScanView, type FirstScanView } from './first-scan';
import { cn, Icon, Tooltip, useWallClock } from '@/ui';

/** The first scan as the shell shows it, or null when none is running. Shared by the banner and <FillingIn>. */
export function useFirstScan(): FirstScanView | null {
  const { health } = useChromeData();
  const now = useWallClock(60_000);
  const fs = health.data?.firstScan;
  return useMemo(() => firstScanView(fs, now), [fs, now]);
}

function Bar({ pct, done, label }: { pct: number; done: boolean; label: string }) {
  return (
    <span className="inline-block h-1.5 w-10 shrink-0 rounded-full bg-surface-sunken align-middle" role="progressbar" aria-label={`${label} first scan`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span className={cn('block h-full rounded-full', done ? 'bg-success-500' : 'bg-faint')} style={{ width: `${Math.max(4, pct)}%` }} />
    </span>
  );
}

/** The slowest unfinished sources the strip names; the rest are counted (all of them are in the tooltip). */
const SHOWN = 3;

export function FirstScanBanner() {
  const v = useFirstScan();
  if (!v) return null;
  const detail = v.sources.map((s) => `${s.label} ${s.done ? 'done' : `${s.pct}%`}`).join(' · ');
  const open = v.sources.filter((s) => !s.done);
  const done = v.sources.length - open.length;
  const more = Math.max(0, open.length - SHOWN);
  return (
    <div role="status" aria-live="polite" data-testid="first-scan-banner" className="flex min-w-0 shrink-0 items-center gap-x-4 gap-y-1 border-b border-info-200 bg-info-50 px-6 py-2 text-body text-fg">
      <Icon name="sync" size="sm" className="shrink-0 text-info-700" />
      {/* the why wraps rather than truncates: it is the point of the strip */}
      <p className="min-w-[16rem] flex-1">
        <span className="font-bold">
          First scan {v.pct}% · {v.leftText}.
        </span>{' '}
        <span className="text-muted">Items may be missing or look undone until it finishes.</span>
      </p>
      <Tooltip content={detail}>
        <ul className="hidden shrink-0 items-center gap-4 lg:flex" aria-label="First scan by source" data-testid="first-scan-sources">
          {open.slice(0, SHOWN).map((s) => (
            <li key={s.connector} className="flex shrink-0 items-center gap-1.5 text-caption text-muted tabular-nums" data-source={s.connector}>
              <span className="text-fg">{s.label}</span>
              <Bar pct={s.pct} done={false} label={s.label} />
              <span>{s.pct}%</span>
            </li>
          ))}
          {more ? <li className="shrink-0 text-caption text-muted">+{more} more</li> : null}
          {done ? (
            <li className="flex shrink-0 items-center gap-1 text-caption text-muted" data-testid="first-scan-done">
              <Icon name="check" size="xs" className="text-success-700" />
              {done} done
            </li>
          ) : null}
        </ul>
      </Tooltip>
      <AppLink href="/health" className="shrink-0 rounded-sm text-caption font-bold text-link hover:underline focus-visible:shadow-focus focus-visible:outline-none">
        Details
      </AppLink>
    </div>
  );
}
