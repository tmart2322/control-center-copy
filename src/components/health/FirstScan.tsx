'use client';
/**
 * First-scan progress on Health (AUDIT, B-080): while the first scan runs (and after, until it is dismissed by being
 * done for a day), one quiet line plus a row per scope: its coverage of [floor, start), pending or done, hole re-plans,
 * its one-time spend, and "added later" for a channel that joined after the first scan had finished (FS-LATE).
 * Color is an indicator only: a done scope's bar is "ready" (success), a pending one neutral. Collapsed when done.
 */
import { useState } from 'react';
import type { FirstScanProgress } from '@/contract';
import { cn, Icon } from '@/ui';
import { usd } from './derive';

const DAY = 86_400_000;

export function FirstScanCard({ fs, now }: { fs: FirstScanProgress | null | undefined; now: string }) {
  const done = fs?.status !== 'active';
  const [open, setOpen] = useState(!done);
  if (!fs || !fs.scopes.length) return null;
  // A first scan finished over a day ago is history: nothing to show.
  if (done && fs.doneAt && Date.parse(now) - Date.parse(fs.doneAt) > DAY) return null;
  const pending = fs.scopes.filter((s) => s.status === 'pending').length;
  const known = fs.scopes.filter((s) => s.coveredPct !== null);
  const avg = known.length ? Math.round(known.reduce((a, s) => a + (s.coveredPct ?? 0), 0) / known.length) : null;
  const statusWord = fs.status === 'active' ? 'running' : fs.status === 'exhausted' ? 'budget spent; the rest runs under the daily cap' : 'done';
  return (
    <section aria-label="First scan" className="rounded-lg border border-line bg-surface px-5 py-3" data-first-scan={fs.status}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 rounded-sm text-left focus-visible:shadow-focus focus-visible:outline-none">
        <Icon name={open ? 'chevrondown' : 'chevronright'} size="xs" className="shrink-0 self-center text-muted" />
        <h2 className="text-body font-bold text-fg-heading">
          First scan · {fs.lookbackDays} day{fs.lookbackDays === 1 ? '' : 's'}
        </h2>
        <span className="text-caption text-muted tabular-nums">
          {statusWord} · {fs.scopes.length - pending}/{fs.scopes.length} scopes done{avg !== null ? ` · ${avg}% covered` : ''} · {usd(fs.spentUsd)} of {usd(fs.budgetUsd)}
        </span>
      </button>
      {open ? (
        <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 @min-[56rem]/main:grid-cols-2 @min-[110rem]/main:grid-cols-3" role="list" aria-label="First-scan scopes">
          {fs.scopes.map((s) => {
            const pct = s.coveredPct ?? 0;
            return (
              <div key={s.scope} role="listitem" className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_7rem] items-center gap-3 text-caption" data-first-scan-scope={s.scope} data-status={s.status}>
                <span className="min-w-0 truncate text-fg" title={s.joinedAt ? `${s.scope}: joined ${s.joinedAt.slice(0, 10)}, after the first scan (FS-LATE)` : s.scope}>
                  {s.scope}
                  {s.joinedAt ? <span className="text-muted"> · added later</span> : null}
                </span>
                <span className="h-1.5 rounded-full bg-surface-sunken" role="progressbar" aria-label={`${s.scope} coverage`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                  <span className={cn('block h-full rounded-full', s.status === 'done' ? 'bg-success-500' : 'bg-faint')} style={{ width: `${Math.max(2, pct)}%` }} />
                </span>
                <span className="text-right text-muted tabular-nums whitespace-nowrap">
                  {s.coveredPct === null ? 'not yet' : `${Math.round(pct)}%`}
                  {s.status === 'done' ? <span className="sr-only"> done</span> : null}
                  {s.replans ? <span title="Hole re-plans used"> · ↻{s.replans}</span> : null}
                  {s.spentUsd > 0 ? <span title="One-time spend of this scope"> · {usd(s.spentUsd)}</span> : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
