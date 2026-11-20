'use client';
/**
 * Onsite day chips (onsite lane), shared by Time (one strip per week) and History (the day header).
 *
 *   "Onsite · ACCOUNT (CITY)" — detected (dashed: a suggestion), confirmed (solid, lock), or "Not onsite".
 *   The popover lists the signals the day used (and the ones it saw and ignored, like a stale working location),
 *   the onsite hours and their clock, and the corrections: Confirm · Not onsite · Change account · Adjust hours,
 *   plus Clear once it is yours. "Mark trip" marks a date range onsite at one account.
 * Every correction is a locked override the recompute respects, with Undo on the toast (tenet: Suggest, then learn).
 * Color is an indicator: the chip is neutral; only "yours" carries the lock glyph, nothing is per-account colored.
 */
import { useState } from 'react';
import type { OnsiteCorrection, OnsiteDay } from '@/contract';
import { useApi } from '@/client/hooks';
import { useOptimisticMutation } from '@/client/optimistic';
import { toast } from '@/client/toast';
import { Button, cn, Dialog, Icon, Popover } from '@/ui';

const TOPICS = ['time'];
const fieldCls = 'h-8 rounded-md border border-line-input bg-surface px-2 text-body text-fg focus-visible:outline-none focus-visible:shadow-focus';

/** "Onsite · ACCOUNT (CITY)", "Trip · CITY: onsite?", "Not onsite". */
export function onsiteLabel(d: OnsiteDay): string {
  if (d.status === 'not_onsite') return 'Not onsite';
  const who = d.accountName ?? d.whatName?.split(' - ')[0] ?? null;
  if (!who) return `Trip${d.city ? ` · ${d.city}` : ''}: onsite?`;
  return `Onsite · ${who}${d.city ? ` (${d.city})` : ''}`;
}

const weekday = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

function useOnsiteMutations() {
  const correct = useOptimisticMutation({
    route: 'correctOnsiteDay',
    topics: TOPICS,
    writeBack: false,
    entityId: (i) => i.params.day,
    onError: (e) => toast({ key: 'onsite-err', title: "Couldn't save that onsite change", body: e.message, tone: 'error', durationMs: null }),
    toast: (res, input) => ({ key: `onsite:${input.params.day}`, title: verbOf(input.body?.action ?? 'confirm', input.params.day), body: res.entity ? onsiteLabel(res.entity) : 'Back to what the calendar says.' }),
  });
  const trip = useOptimisticMutation({
    route: 'markTrip',
    topics: TOPICS,
    writeBack: false,
    entityId: (i) => i.body?.from,
    onError: (e) => toast({ key: 'onsite-err', title: "Couldn't mark that trip", body: e.message, tone: 'error', durationMs: null }),
    toast: (res, input) => ({ key: `trip:${input.body?.from}`, title: `Marked a trip: ${input.body?.from} to ${input.body?.to}`, body: `${res.entity.length} onsite day${res.entity.length === 1 ? '' : 's'}` }),
  });
  return { correct, trip };
}

function verbOf(a: OnsiteCorrection['action'], day: string): string {
  const d = `${weekday(day)} ${day.slice(5)}`;
  return { confirm: `Confirmed onsite: ${d}`, not_onsite: `Not onsite: ${d}`, change_account: `Onsite account changed: ${d}`, adjust_hours: `Onsite hours set: ${d}`, clear: `Onsite correction cleared: ${d}` }[a];
}

function AccountSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const deals = useApi('getDeals');
  const accounts = [...(deals.data?.accounts ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <select id={id} className={cn(fieldCls, 'w-full')} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Account">
      <option value="">{deals.isLoading ? 'Loading accounts…' : 'Pick an account'}</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}

/** The hours of the frame in its own clock ("08:00"), for the Adjust hours fields. */
function hm(iso: string | undefined, tz: string, fallback: string): string {
  if (!iso) return fallback;
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

export function OnsiteChip({ day, compact = false }: { day: OnsiteDay; compact?: boolean }) {
  const { correct } = useOnsiteMutations();
  const [mode, setMode] = useState<'view' | 'account' | 'hours'>('view');
  const [account, setAccount] = useState(day.accountId ?? '');
  const [start, setStart] = useState(hm(day.frame?.start, day.timezone, '08:00'));
  const [end, setEnd] = useState(hm(day.frame?.end, day.timezone, '17:00'));
  const run = (body: OnsiteCorrection, close: () => void) => {
    correct.mutate({ params: { day: day.day }, body });
    setMode('view');
    close();
  };
  const suggestion = day.status === 'detected';
  const label = onsiteLabel(day);
  return (
    <Popover
      label={`${label}, ${day.day}`}
      width={360}
      onOpenChange={(o) => !o && setMode('view')}
      trigger={
        <button
          type="button"
          data-testid={`onsite-chip-${day.day}`}
          data-status={day.status}
          className={cn(
            'inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-caption font-semibold text-fg-heading hover:bg-surface-raised focus-visible:outline-none focus-visible:shadow-focus',
            suggestion ? 'border-dashed border-line-strong bg-surface' : day.status === 'confirmed' ? 'border-line-strong bg-surface-sunken' : 'border-line bg-surface text-muted',
          )}
          title={suggestion ? 'Suggested from your calendar: open to confirm or correct' : 'Yours: recomputes keep it'}
        >
          {!compact ? <span className="text-muted">{weekday(day.day)}</span> : null}
          <span className="truncate">{label}</span>
          {day.locked ? <Icon name="lock" size="xs" className="text-muted" title="Your correction" /> : null}
        </button>
      }
    >
      {(api) => (
        <div className="grid gap-3 p-3 text-body">
          <div>
            <div className="text-body-lg font-bold text-fg-heading">{label}</div>
            <div className="text-caption text-muted">
              {weekday(day.day)} {day.day}
              {day.hoursLabel ? ` · ${day.hoursLabel}` : ''}
              {day.trip ? ` · trip ${day.trip.from.slice(5)} to ${day.trip.to.slice(5)}` : ''}
            </div>
          </div>
          {day.signals.length ? (
            <ul className="grid gap-1" aria-label="Signals">
              {day.signals.map((s, i) => (
                <li key={i} className={cn('flex gap-1.5 text-caption', s.used ? 'text-fg' : 'text-muted')}>
                  <span aria-hidden className="w-3 shrink-0 text-center">
                    {s.used ? '✓' : '·'}
                  </span>
                  <span>{s.label}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-caption text-muted">Sessions keep their own rows beside the onsite hours (Settings ▸ Time ▸ Overlapping meetings); never overnight.</p>
          {mode === 'account' ? (
            <div className="grid gap-2">
              <AccountSelect value={account} onChange={setAccount} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="quiet" onClick={() => setMode('view')}>
                  Cancel
                </Button>
                <Button size="sm" disabled={!account} onClick={() => run({ action: 'change_account', accountId: account }, api.close)}>
                  Use this account
                </Button>
              </div>
            </div>
          ) : mode === 'hours' ? (
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <input type="time" className={fieldCls} value={start} onChange={(e) => setStart(e.target.value)} aria-label="Onsite from" />
                <span className="text-muted">to</span>
                <input type="time" className={fieldCls} value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Onsite until" />
                <span className="text-caption text-muted">{day.timezone}</span>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="quiet" onClick={() => setMode('view')}>
                  Cancel
                </Button>
                <Button size="sm" disabled={!start || !end || end <= start} onClick={() => run({ action: 'adjust_hours', start, end }, api.close)}>
                  Set hours
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {day.status !== 'confirmed' ? (
                <Button size="sm" disabled={!day.accountId && day.status !== 'not_onsite'} onClick={() => run({ action: 'confirm' }, api.close)} title={!day.accountId ? 'Pick the account first' : undefined}>
                  Confirm
                </Button>
              ) : null}
              {day.status !== 'not_onsite' ? (
                <Button size="sm" variant="secondary" onClick={() => run({ action: 'not_onsite' }, api.close)}>
                  Not onsite
                </Button>
              ) : null}
              <Button size="sm" variant="secondary" onClick={() => setMode('account')}>
                {day.accountId ? 'Change account' : 'Pick account'}
              </Button>
              {day.status !== 'not_onsite' ? (
                <Button size="sm" variant="secondary" onClick={() => setMode('hours')}>
                  Adjust hours
                </Button>
              ) : null}
              {day.locked ? (
                <Button size="sm" variant="quiet" onClick={() => run({ action: 'clear' }, api.close)}>
                  Clear my correction
                </Button>
              ) : null}
            </div>
          )}
        </div>
      )}
    </Popover>
  );
}

/** "Mark trip": a date range onsite at one account. */
export function MarkTripButton({ defaultFrom, defaultTo }: { defaultFrom: string; defaultTo: string }) {
  const { trip } = useOnsiteMutations();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [account, setAccount] = useState('');
  const [city, setCity] = useState('');
  const ok = !!account && !!from && !!to && to >= from;
  return (
    <>
      <Button size="sm" variant="quiet" onClick={() => setOpen(true)} data-testid="mark-trip">
        Mark trip
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Mark a trip"
        description="These days were onsite at one account. Sessions keep their own rows; flights log as Travel."
        confirmLabel="Mark trip"
        busy={trip.isPending}
        onConfirm={async () => {
          if (!ok) return;
          await trip.mutateAsync({ body: { from, to, accountId: account, city: city.trim() || null } }).catch(() => undefined);
          setOpen(false);
        }}
      >
        <div className="grid gap-3">
          <div className="flex items-center gap-2">
            <label className="grid gap-1 text-caption text-muted">
              From
              <input type="date" className={fieldCls} value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="grid gap-1 text-caption text-muted">
              To
              <input type="date" className={fieldCls} value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          <label className="grid gap-1 text-caption text-muted">
            Account
            <AccountSelect value={account} onChange={setAccount} />
          </label>
          <label className="grid gap-1 text-caption text-muted">
            City (optional)
            <input className={fieldCls} value={city} maxLength={80} onChange={(e) => setCity(e.target.value)} placeholder="Where you were" />
          </label>
          {!ok ? <p className="text-caption text-muted">Pick the account and a range that ends on or after it starts.</p> : null}
        </div>
      </Dialog>
    </>
  );
}

/** The week's chips (Time page): one per onsite day, plus Mark trip. */
export function OnsiteStrip({ days, weekStart, weekEnd }: { days: OnsiteDay[]; weekStart: string; weekEnd: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="onsite-strip" aria-label="Onsite days">
      {days.map((d) => (
        <OnsiteChip key={d.day} day={d} />
      ))}
      <MarkTripButton defaultFrom={days[0]?.trip?.from ?? weekStart} defaultTo={days[0]?.trip?.to ?? weekEnd} />
    </div>
  );
}
