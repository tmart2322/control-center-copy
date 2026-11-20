/**
 * Time ▸ Ledger (GET /time/ledger), shared by both datasources so the mock and Postgres agree to the hour: one fiscal
 * quarter (or every one) as a report, over the same rows as GET /time/log.
 *
 *   totals     the live rows by the one count map (TL-45): in Org62 (verified by read-back apart), on its way
 *              (approved or handed to a canvas), suggested, needs input, not in Org62 after all; excluded apart
 *   accounts   by account, most hours first, each with its opportunities (and its rows with none); internal-only work
 *              (D-64) and rows with no account or opportunity are their own lines
 *   types      by task type (no type is its own line)
 *   periods    the quarter's weeks (Monday first, clipped to the quarter, the empty ones too), or every quarter
 *
 * Human hours only (tenet: Hours are human hours): every number counts live rows (never excluded or upcoming ones),
 * and agent time is never in these rows. The fiscal year starts on 1 February (Q3 FY27 = Aug–Oct 2026). Each line's
 * drill-down is GET /time/log with the same filters (`matchesSlice`): account, opp (`none`, `internal`), type.
 */
import type { ActivityEntry, TimeLedger, TimeLedgerAccount, TimeLedgerPeriod, TimeLedgerQuery, TimeLedgerSlice } from '@/contract';
import { countBucketOf } from '@/engines/activity/org62-check';
import { mondayOfDay, quarterTotals, type ActivityLogContext } from './activity-log';
import { currentQuarter, fiscalQuarterBounds } from './db/quarter';

const r2 = (n: number) => Math.round(n * 100) / 100;
const isLive = (e: Pick<ActivityEntry, 'status'>) => e.status !== 'dismissed' && e.status !== 'upcoming';
const plusDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

interface Acc {
  rows: number;
  hours: number;
  loggedH: number;
}
const acc = (): Acc => ({ rows: 0, hours: 0, loggedH: 0 });
const add = (a: Acc, e: ActivityEntry) => {
  a.rows += 1;
  a.hours += e.durationH;
  if (countBucketOf(e) === 'logged') a.loggedH += e.durationH;
};

/** GET /time/ledger over every activity row the datasource holds. Pure: same rows, same query, same answer. */
export function buildTimeLedger(all: readonly ActivityEntry[], query: TimeLedgerQuery, ctx: ActivityLogContext): TimeLedger {
  const quarters = quarterTotals(all, ctx);
  const cur = currentQuarter(ctx.meta, ctx.now, ctx.tz, ctx.dayEnd);
  const asked = query.quarter ?? cur.label;
  const bounds = asked === 'all' ? null : (quarters.find((q) => q.label === asked) ?? fiscalQuarterBounds(asked));
  const from = bounds?.start ?? null;
  const to = bounds?.end ?? null;
  const rows = all.filter((e) => (!from || e.date >= from) && (!to || e.date <= to));
  const live = rows.filter(isLive);
  const total = r2(live.reduce((s, e) => s + e.durationH, 0));
  const slice = (a: Acc): TimeLedgerSlice => ({ rows: a.rows, hours: r2(a.hours), loggedH: r2(a.loggedH), share: total > 0 ? Math.round((a.hours / total) * 10_000) / 10_000 : 0 });

  // the one count map over the live rows: they add up to the ledger's hours
  const t = { logged: acc(), verified: acc(), approved: acc(), proposed: acc(), needsInput: acc(), missing: acc(), excluded: acc() };
  for (const e of rows) {
    if (e.status === 'dismissed') {
      add(t.excluded, e);
      continue;
    }
    if (e.status === 'upcoming') continue;
    const b = countBucketOf(e);
    if (b === 'logged') {
      add(t.logged, e);
      if (e.status === 'verified') add(t.verified, e);
    } else if (b === 'approved') add(t.approved, e);
    else if (b === 'proposed') add(e.status === 'needs_input' ? t.needsInput : t.proposed, e);
    else add(t.missing, e);
  }

  // accounts → opportunities; internal and unassigned are lines of their own
  const accounts = new Map<string, { name: string | null; a: Acc; opps: Map<string, { oppId: string | null; name: string; a: Acc }> }>();
  const internal = acc();
  const unassigned = acc();
  const types = new Map<string, { type: string | null; a: Acc }>();
  for (const e of live) {
    const tk = e.taskType ?? '';
    const ty = types.get(tk) ?? { type: e.taskType ?? null, a: acc() };
    types.set(tk, ty);
    add(ty.a, e);
    if (e.internal) {
      add(internal, e);
      continue;
    }
    if (!e.oppId && !e.accountName) {
      add(unassigned, e);
      continue;
    }
    const ak = e.accountName ?? '';
    const g = accounts.get(ak) ?? { name: e.accountName ?? null, a: acc(), opps: new Map() };
    accounts.set(ak, g);
    add(g.a, e);
    const ok = e.oppId ?? '';
    const o = g.opps.get(ok) ?? { oppId: e.oppId ?? null, name: e.oppId ? (e.oppName ?? e.oppId) : 'No opportunity', a: acc() };
    g.opps.set(ok, o);
    add(o.a, e);
  }
  const byHours = <T extends { a: Acc }>(x: T, y: T, name: (v: T) => string) => y.a.hours - x.a.hours || name(x).localeCompare(name(y));

  return {
    quarter: asked,
    from,
    to,
    quarters,
    totals: {
      rows: live.length,
      hours: total,
      loggedH: r2(t.logged.hours),
      verifiedH: r2(t.verified.hours),
      approvedH: r2(t.approved.hours),
      approvedRows: t.approved.rows,
      proposedH: r2(t.proposed.hours),
      proposedRows: t.proposed.rows,
      needsInputH: r2(t.needsInput.hours),
      needsInputRows: t.needsInput.rows,
      missingH: r2(t.missing.hours),
      missingRows: t.missing.rows,
      earlierH: asked === cur.label ? r2(cur.baseH) : 0,
      excludedRows: t.excluded.rows,
      excludedH: r2(t.excluded.hours),
    },
    accounts: [...accounts.values()]
      .sort((x, y) => byHours(x, y, (v) => v.name ?? ''))
      .map(
        (g): TimeLedgerAccount => ({
          ...slice(g.a),
          name: g.name,
          // the account's rows with no opportunity go last
          opps: [...g.opps.values()].sort((x, y) => (x.oppId === null ? 1 : 0) - (y.oppId === null ? 1 : 0) || byHours(x, y, (v) => `${v.name}\u0000${v.oppId ?? ''}`)).map((o) => ({ ...slice(o.a), oppId: o.oppId, name: o.name })),
        }),
      ),
    internal: slice(internal),
    unassigned: slice(unassigned),
    types: [...types.values()].sort((x, y) => (x.type === null ? 1 : 0) - (y.type === null ? 1 : 0) || byHours(x, y, (v) => v.type ?? '')).map((x) => ({ ...slice(x.a), type: x.type })),
    periods: bounds ? { kind: 'week', items: weeksOf(bounds.start, bounds.end, live) } : { kind: 'quarter', items: quarterPeriods(quarters, live) },
  };
}

/** Every Monday-first week that touches [start, end], clipped to it (an empty week is a column too). */
function weeksOf(start: string, end: string, live: readonly ActivityEntry[]): TimeLedgerPeriod[] {
  const out: TimeLedgerPeriod[] = [];
  for (let w = mondayOfDay(start); w <= end; w = plusDays(w, 7)) {
    const s = w < start ? start : w;
    const sunday = plusDays(w, 6);
    const e = sunday > end ? end : sunday;
    const a = acc();
    for (const x of live) if (x.date >= s && x.date <= e) add(a, x);
    out.push({ key: w, label: dayLabel(s), start: s, end: e, rows: a.rows, hours: r2(a.hours), loggedH: r2(a.loggedH) });
  }
  return out;
}

/** Every quarter that has rows (and the current one), oldest first. */
function quarterPeriods(quarters: TimeLedger['quarters'], live: readonly ActivityEntry[]): TimeLedgerPeriod[] {
  return [...quarters].reverse().map((q) => {
    const a = acc();
    for (const x of live) if (x.date >= q.start && x.date <= q.end) add(a, x);
    return { key: q.label, label: q.label, start: q.start, end: q.end, rows: a.rows, hours: r2(a.hours), loggedH: r2(a.loggedH) };
  });
}
