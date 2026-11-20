/**
 * Time ▸ Forecast words that are pure functions of the payload (tested in tests/forecast/ae-pass.test.ts):
 *
 *   stageButton    "Stage 2 notes + 1 Deal Role": the ONE button that builds the canvas. It stages; the canvas preview
 *                  it opens holds the one Apply (nothing reaches Org62 before it)
 *   checkLine      where an "I created it, check now" is: "Checking Org62…", "Not in Org62 yet · read 10:42 · reads
 *                  again 11:12", or why it did not finish
 *   checkButton    the row's button: "I created it, check now", "Checking…", "Check again"
 *   checkOutcome   the toast when a check finishes (found, not yet, failed)
 */
import type { ForecastCheck, ForecastPayload, MissingForecast } from '@/contract';
import { STAGEABLE } from '@/engines/forecast/view';
import { clock, dayLabel } from '@/components/domain/lib/time';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** What "Stage N notes" stages: approved notes and Deal Role fixes not in a canvas yet. */
export function stageButton(v: Pick<ForecastPayload, 'rows'>): { label: string; notes: number; roles: number } {
  const notes = v.rows.filter((r) => STAGEABLE.has(r.notes.state) && !!r.notes.text).length;
  const roles = v.rows.filter((r) => STAGEABLE.has(r.role.state) && !!r.roleFix).length;
  if (!notes && !roles) return { label: 'Stage notes', notes, roles };
  return { label: `Stage ${[notes ? plural(notes, 'note') : null, roles ? plural(roles, 'Deal Role') : null].filter(Boolean).join(' + ')}`, notes, roles };
}

const when = (iso: string, tz?: string, nowIso?: string) => (nowIso && dayLabel(iso, tz) === dayLabel(nowIso, tz) ? clock(iso, tz) : `${dayLabel(iso, tz)} ${clock(iso, tz)}`);

/** The caption under a missing row once it was checked (null: never checked). */
export function checkLine(c: ForecastCheck | null, o: { nextAt?: string | null; tz?: string; now?: string } = {}): string | null {
  if (!c) return null;
  if (c.status === 'checking') return 'Checking Org62 for its Specialist Forecast (read-only)…';
  if (c.status === 'found') return `Found · read ${when(c.at, o.tz, o.now)}`;
  if (c.status === 'failed' || c.status === 'skipped') return c.note ?? 'The check did not finish';
  const again = o.nextAt && o.nextAt > c.at ? ` · reads again ${when(o.nextAt, o.tz, o.now)}` : '';
  return `Not in Org62 yet · read ${when(c.at, o.tz, o.now)}${again}`;
}

export function checkButton(m: Pick<MissingForecast, 'check'>, pending = false): { label: string; busy: boolean } {
  if (pending || m.check?.status === 'checking') return { label: 'Checking…', busy: true };
  return { label: m.check ? 'Check again' : 'I created it, check now', busy: false };
}

/** Each check that finished since the last payload: what to tell the user. */
export function checkOutcomes(prev: ReadonlyMap<string, ForecastCheck['status']> | null, v: Pick<ForecastPayload, 'queue' | 'found' | 'sync'>, tz?: string): { statuses: Map<string, ForecastCheck['status']>; toasts: Array<{ key: string; tone: 'success' | 'info' | 'error'; title: string; body: string }> } {
  const statuses = new Map<string, ForecastCheck['status']>();
  const named = new Map<string, string>();
  for (const m of v.queue.missing) {
    named.set(m.opportunityId, m.opportunityName);
    if (m.check) statuses.set(m.opportunityId, m.check.status);
  }
  for (const f of v.found) {
    statuses.set(f.opportunityId, 'found');
    if (f.opportunityName) named.set(f.opportunityId, f.opportunityName);
  }
  const toasts: Array<{ key: string; tone: 'success' | 'info' | 'error'; title: string; body: string }> = [];
  if (prev) {
    for (const [id, st] of statuses) {
      if (prev.get(id) !== 'checking' || st === 'checking') continue;
      const name = named.get(id) ?? 'The opp';
      const key = `forecast-check:${id}`;
      if (st === 'found') toasts.push({ key, tone: 'success', title: 'Found its Specialist Forecast', body: `${name} is in your list now, with its notes and Deal Role to do.` });
      else if (st === 'not_found') toasts.push({ key, tone: 'info', title: 'Not in Org62 yet', body: `${name}: no Specialist Forecast of yours this or next quarter yet.${v.sync.nextAt ? ` The app reads Org62 again at ${clock(v.sync.nextAt, tz)}.` : ''}` });
      else toasts.push({ key, tone: 'error', title: "The check didn't finish", body: v.queue.missing.find((m) => m.opportunityId === id)?.check?.note ?? 'Check again in a moment.' });
    }
  }
  return { statuses, toasts };
}
