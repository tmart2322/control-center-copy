'use client';
/**
 * Time ▸ Log hours: the quarter header, the page's focal point (docs/ui/time-redesign.md). It tells the truth
 * plainly, in one card:
 *
 *   left   logged in Org62 against the target (verified by read-back as a quiet caption), hours to go, the meter
 *          and the pace; the deadline as a badge only when it is close or past
 *   right  waiting on you this quarter (hours, rows, by stage, each a jump to its section), what is on its way, and
 *          where a canvas's hours went when its rows span quarters ("31.8 h landed in Q3 FY27")
 *
 * "Human hours only" is a quiet last line, not a headline. A role without a quarter target (the AE) shows the
 * hours alone: no meter, no pace.
 */
import { StatusBadge } from '@/components/domain';
import { clock, dayLabel } from '@/components/domain/lib/time';
import { cn, Icon } from '@/ui';
import { fmtH, loggingGapLine, ymdIn, type LoggingGap } from './derive';
import { rowsWord, spillLine, type QuarterPart, type QuarterTruth } from './path-derive';

function dueLabel(due: string | null, nowIso: string, tz?: string): string | null {
  if (!due) return null;
  const today = ymdIn(nowIso, tz);
  const day = ymdIn(due, tz);
  const tomorrow = ymdIn(new Date(Date.parse(nowIso) + 86_400_000).toISOString(), tz);
  const when = day === today ? 'today' : day === tomorrow ? 'tomorrow' : dayLabel(due, tz);
  return `Due ${when} ${clock(due, tz)}`;
}

export interface QuarterHeaderProps {
  truth: QuarterTruth;
  due: string | null;
  now: string;
  tz?: string;
  /** Scroll to the section a part lives in (Needs you, or Log it). */
  onJump: (part: QuarterPart['id']) => void;
  /** 2026-11-13 audit C3: approved hours Org62 has not confirmed, and rows missing there (derive.ts loggingGap). */
  gap?: LoggingGap | null;
  /** Show the gap's rows in the week (Time scrolls to the first). */
  onShowGap?: (ids: string[]) => void;
  /** DC requests and VDP use cases waiting for a canvas (they are not rows, so they never show as hours). */
  queued?: { dcs: number; useCases: number };
}

/** "55 DC requests and 3 VDP use cases wait for a canvas" (null: none). */
export function queuedLine(q: { dcs: number; useCases: number } | undefined): string | null {
  if (!q || (!q.dcs && !q.useCases)) return null;
  const parts = [q.dcs ? `${q.dcs} DC ${q.dcs === 1 ? 'request' : 'requests'}` : null, q.useCases ? `${q.useCases} VDP use ${q.useCases === 1 ? 'case' : 'cases'}` : null].filter(Boolean);
  return `${parts.join(' and ')} ${q.dcs + q.useCases === 1 ? 'waits' : 'wait'} for a canvas`;
}

export function QuarterHeader({ truth: t, due, now, tz, onJump, gap, onShowGap, queued }: QuarterHeaderProps) {
  const queuedText = queuedLine(queued);
  const dueText = dueLabel(due, now, tz);
  const target = t.targetH > 0;
  return (
    <section aria-labelledby="q4-h" data-testid="q4-log" className="@container/qh flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="grid min-w-0 gap-x-10 gap-y-5 @min-[50rem]/qh:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id="q4-h" className="text-lead font-bold text-fg-heading">
              {t.label}
            </h2>
            {dueText ? (
              t.tone === 'none' ? (
                <span className="text-caption text-muted">{dueText}</span>
              ) : (
                <StatusBadge tone={t.tone} icon="clock">
                  {t.tone === 'danger' ? `Past due · ${dueText.replace(/^Due /, '')}` : dueText}
                </StatusBadge>
              )
            ) : null}
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-2 tabular-nums" data-testid="q4-logged">
            <span className="text-heading font-bold text-fg-heading">{Math.round(t.loggedH * 10) / 10} h</span>
            <span className="text-body text-muted">{target ? `logged in Org62 of ${t.targetH} h` : 'logged in Org62 this quarter'}</span>
          </div>
          {target ? (
            <div className="cx-meter mt-2" data-tone={t.tone === 'none' ? undefined : t.tone} role="meter" aria-label={`${t.loggedH} of ${t.targetH} hours logged`} aria-valuenow={Math.round(t.pct)} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${t.pct}%` }} />
            </div>
          ) : null}
          <p className="mt-1.5 text-caption text-muted tabular-nums">
            {[t.verifiedH !== null ? `${fmtH(t.verifiedH)} verified by read-back` : null, target ? (t.leftH > 0 ? `${t.leftH} h to go` : 'Target met') : null].filter(Boolean).join(' · ') || 'Read back from Org62'}
          </p>
          {t.pace ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted tabular-nums" data-pace={t.pace.state}>
              {t.pace.state === 'behind' ? (
                <StatusBadge tone="warning" icon="clock">{`${Math.abs(t.pace.deltaH)} h behind pace`}</StatusBadge>
              ) : (
                <span className="font-bold text-fg">{t.pace.state === 'ahead' ? `${t.pace.deltaH} h ahead of pace` : 'On pace'}</span>
              )}
              <span>{`${t.pace.expectedH} h expected by today · ${t.pace.workdaysLeft} workdays left`}</span>
            </p>
          ) : null}
        </div>

        <div className="min-w-0" data-testid="q4-waiting">
          <h3 className="text-caption font-bold text-muted">Waiting on you this quarter</h3>
          {t.waiting.rows ? (
            <>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 tabular-nums">
                <span className="text-title font-bold text-fg-heading">{fmtH(t.waiting.hours)}</span>
                <span className="text-body text-muted">{rowsWord(t.waiting.rows)}</span>
              </div>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-caption tabular-nums" aria-label="Where they wait">
                {t.waiting.parts.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => onJump(p.id)} data-part={p.id} className="rounded-sm font-bold text-link hover:underline focus-visible:outline-none focus-visible:shadow-focus">
                      {`${fmtH(p.hours)} ${p.label}`}
                    </button>
                    <span className="text-muted">{` · ${rowsWord(p.rows)}`}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : queuedText ? null : (
            <p className="mt-1 text-body text-fg">Nothing: every row of {t.label} is in Org62 or on its way.</p>
          )}
          {queuedText ? (
            // 2026-11-13 audit C2: DCs and use cases waiting are work too, never "Nothing"
            <p className="mt-1 text-caption tabular-nums" data-testid="q4-queued">
              <button type="button" onClick={() => onJump('ready')} className="rounded-sm font-bold text-link hover:underline focus-visible:outline-none focus-visible:shadow-focus">
                {queuedText}
              </button>
              <span className="text-muted"> · in Log it ▸ Ready to log, for your next canvas</span>
            </p>
          ) : null}
          {t.onItsWay.rows ? <p className="mt-1 text-caption text-muted tabular-nums">{`${fmtH(t.onItsWay.hours)} on its way to Org62 · ${rowsWord(t.onItsWay.rows)}`}</p> : null}
          {t.spill.length ? (
            <ul className="mt-3 flex flex-col gap-1.5" aria-label="Canvas hours in other quarters" data-testid="q4-spill">
              {t.spill.map((s) => (
                <li key={s.draftId} className="flex min-w-0 items-start gap-2 text-caption text-fg">
                  <Icon name="info" size="xs" className="mt-0.5 shrink-0 text-muted" />
                  <span className="min-w-0 break-words">
                    <span className="font-bold">{`${s.title} (${dayLabel(s.at, tz)}, ${fmtH(s.hours)})`}</span>
                    {`: ${spillLine(s)}`}
                    {s.hereH ? `, ${fmtH(s.hereH)} in ${t.label}` : `, none in ${t.label}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      {gap?.show ? (
        // 2026-11-13 audit C3: the logging gap, drawn where the quarter's truth is told (it was computed and never shown)
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-surface-muted px-3 py-2 text-caption" role="status" data-testid="q4-gap">
          <StatusBadge tone={gap.missingRows ? 'danger' : 'warning'} icon="warning">
            {gap.missingRows && !gap.unconfirmedRows ? 'Missing in Org62' : 'Not in Org62 yet'}
          </StatusBadge>
          <span className="min-w-0 break-words text-fg tabular-nums">{loggingGapLine(gap)}</span>
          <span className="text-muted tabular-nums">
            {[gap.lastReadbackAt ? `last read back from Org62 ${dayLabel(gap.lastReadbackAt, tz)} ${clock(gap.lastReadbackAt, tz)}` : 'nothing read back from Org62 yet', gap.workOrderPending ? 'no read-back since your last canvas' : null].filter(Boolean).join(' · ')}
          </span>
          {onShowGap && gap.ids.length ? (
            <button type="button" onClick={() => onShowGap(gap.ids)} className="ml-auto rounded-sm font-bold text-link hover:underline focus-visible:outline-none focus-visible:shadow-focus" data-testid="q4-gap-show">
              Show {gap.ids.length === 1 ? 'it' : 'them'}
            </button>
          ) : null}
        </div>
      ) : null}
      <p className={cn('text-caption text-faint')}>Human hours only; agent time never counts.</p>
    </section>
  );
}
