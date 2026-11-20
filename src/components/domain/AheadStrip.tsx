'use client';
/**
 * AheadStrip: the 14-day load strip in Home's "Think ahead" (DESIGN-V2; mockup home-1-briefing).
 * One column per day: a stack of 4 px bars, one per item (capped), with the amber bars first for items
 * missing prep or at risk; the day of month underneath. Weekends are fainter; a `big` day (a QBR, a
 * workshop) gets a bold label. In narrow containers only the first day, Mondays, big days and the last day
 * keep their label. Color is the indicator only: amber = prep missing, everything else neutral.
 */
import { cn } from '@/ui';
import { useClock } from './lib';
import { dayLabel, weekday, ymd, zonedIso } from './lib/time';

export interface AheadDay {
  /** The local day: `YYYY-MM-DD`, or any ISO instant on that day. */
  date: string;
  /** Items that day. */
  count: number;
  /** Of those, items missing prep or at risk (amber). */
  atRisk?: number;
  /** Tooltip text: what's on the day ("Globex QBR (at risk) · Initech workshop"). */
  summary?: string;
  /** An important day: bold label. */
  big?: boolean;
}

export interface AheadStripProps {
  days: AheadDay[];
  /** Bars drawn per day before the stack caps (default 5). */
  maxBars?: number;
  selectedDate?: string | null;
  onSelectDay?: (day: AheadDay) => void;
  /** Show the first and last day as a caption row under the strip. */
  caption?: boolean;
  now?: string;
  className?: string;
  /** Accessible name for the strip (default "Items per day"). */
  label?: string;
}

function parts(date: string, tz?: string) {
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const iso = isDate ? `${date}T12:00:00Z` : date;
  const z = isDate ? 'UTC' : tz;
  const [wd = '', dom = '', mon = ''] = dayLabel(iso, z).split(' ');
  const w = weekday(iso, z);
  return { key: isDate ? date : ymd(iso, z), wd, dom, mon, weekend: w === 'Sat' || w === 'Sun', monday: w === 'Mon', long: `${wd} ${dom} ${mon}` };
}

export function AheadStrip({ days, maxBars = 5, selectedDate, onSelectDay, caption, now: nowProp, className, label = 'Items per day' }: AheadStripProps) {
  const { tz } = useClock({ now: nowProp });
  const meta = days.map((d) => ({ d, p: parts(d.date, tz) }));
  const first = meta[0]?.p;
  const last = meta[meta.length - 1]?.p;
  return (
    <div className={cn('@container min-w-0', className)}>
      <div role="list" aria-label={first && last ? `${label}, ${first.long} to ${last.long}` : label} className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${Math.max(1, days.length)}, minmax(0, 1fr))` }}>
        {meta.map(({ d, p }, i) => {
          const risk = Math.min(d.atRisk ?? 0, d.count);
          const shown = Math.min(d.count, maxBars);
          const riskShown = Math.min(risk, shown);
          const major = i === 0 || i === meta.length - 1 || p.monday || d.big;
          const sel = !!selectedDate && parts(selectedDate, tz).key === p.key;
          const title = `${p.long}: ${d.count ? `${d.count} item${d.count === 1 ? '' : 's'}${risk ? `, ${risk} missing prep` : ''}` : 'nothing'}${d.summary ? ` · ${d.summary}` : ''}`;
          const Cell = onSelectDay ? 'button' : 'div';
          return (
            <Cell
              key={p.key}
              role="listitem"
              {...(onSelectDay ? { type: 'button' as const, onClick: () => onSelectDay(d), 'aria-pressed': sel } : {})}
              title={title}
              aria-label={title}
              data-day={p.key}
              className={cn('flex min-w-0 flex-col items-stretch gap-0.5 rounded-sm px-px pb-0.5', onSelectDay && 'hover:bg-surface-muted focus-visible:outline-none focus-visible:shadow-focus', sel && 'bg-selected')}
            >
              <span aria-hidden className={cn('flex h-[23px] flex-col-reverse gap-0.5', p.weekend && 'opacity-70')}>
                {Array.from({ length: shown }, (_, k) => (
                  <i key={k} className={cn('block h-1 rounded-[2px]', k < riskShown ? 'bg-warning-500' : 'bg-line-strong')} />
                ))}
              </span>
              <span
                aria-hidden
                className={cn(
                  'text-center text-micro tabular-nums',
                  d.big ? 'font-bold text-fg-heading' : p.weekend ? 'text-faint' : 'text-muted',
                  !major && 'invisible @2xs:visible',
                )}
              >
                {p.dom}
              </span>
            </Cell>
          );
        })}
      </div>
      {caption && first && last ? (
        <div className="mt-0.5 flex justify-between text-micro text-faint">
          <span>
            {first.wd} {first.dom} {first.mon}
          </span>
          <span>
            {last.wd} {last.dom} {last.mon}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export interface AheadInput {
  /** When it happens or is due. */
  at: string;
  /** Missing prep or at risk. */
  atRisk?: boolean;
  /** For the tooltip. */
  label?: string;
  /** Marks the day big (an important meeting). */
  big?: boolean;
}

/**
 * Bucket items into the next `days` local days (default 14, starting tomorrow) for AheadStrip. Items
 * outside the window are ignored. Pure: pass `now` and the profile timezone.
 */
export function buildAheadDays(items: AheadInput[], opts: { now: string; tz?: string; days?: number; startToday?: boolean }): AheadDay[] {
  const n = opts.days ?? 14;
  const noon = Date.parse(zonedIso(ymd(opts.now, opts.tz), '12:00', opts.tz));
  const keys = Array.from({ length: n }, (_, k) => ymd(new Date(noon + (k + (opts.startToday ? 0 : 1)) * 86_400_000).toISOString(), opts.tz));
  const by = new Map<string, AheadDay & { labels: string[] }>(keys.map((k) => [k, { date: k, count: 0, atRisk: 0, labels: [] }]));
  for (const it of items) {
    const d = by.get(ymd(it.at, opts.tz));
    if (!d) continue;
    d.count += 1;
    if (it.atRisk) d.atRisk = (d.atRisk ?? 0) + 1;
    if (it.big) d.big = true;
    if (it.label) d.labels.push(it.atRisk ? `${it.label} (at risk)` : it.label);
  }
  return keys.map((k) => {
    const { labels, ...d } = by.get(k)!;
    return { ...d, summary: labels.join(' · ') || undefined };
  });
}
