/**
 * The whole activity log (GET /time/log), shared by both datasources so the mock and Postgres agree to the row:
 * every activity row in a range of local days, history included (the Org62 read-back rows of past quarters),
 * filtered by status bucket, search, account, opp and task type (the Ledger's drill-down: `matchesSlice`), with
 * totals per week, calendar month and fiscal quarter.
 *
 * Human hours only (tenet: Hours are human hours): `hours` counts live rows (never excluded or upcoming ones),
 * `loggedH` the logged and verified ones. The quarter totals use the same rule as Time's quarter log
 * (db/quarter.ts): logged / verified rows whose local day falls in the quarter, plus the seeded base hours for
 * the current quarter only. The fiscal year starts on 1 February (Q3 FY27 = Aug–Oct 2026).
 */
import { activityLogStatus, ActivityLogStatus, type ActivityEntry, type ActivityLog, type ActivityLogQuery, type ActivityLogTotal, type SeedMeta } from '@/contract';
import { countsAsLogged } from '@/engines/activity/org62-check';
import { currentQuarter, fiscalQuarterBounds } from './db/quarter';

const r2 = (n: number) => Math.round(n * 100) / 100;
const isLogged = (e: Pick<ActivityEntry, 'status'>) => e.status === 'logged' || e.status === 'verified';
const isLive = (e: Pick<ActivityEntry, 'status'>) => e.status !== 'dismissed' && e.status !== 'upcoming';

/**
 * The read-side stamps of a row the store holds without them (seed rows, mock edits): `excludedReason` only on
 * dismissed rows (`dismissed` = you, when nothing says otherwise), `loggedAt` / `verifiedAt` only on rows in
 * those states (their updatedAt when no stamp was kept). The db stores the same rule in its columns
 * (store/time.ts activityColumns), so a seed reads back the same on both sides.
 */
export function activityStamps<T extends ActivityEntry>(e: T): T {
  const excludedReason = e.status === 'dismissed' ? (e.excludedReason ?? 'dismissed') : null;
  const loggedAt = isLogged(e) ? (e.loggedAt ?? e.updatedAt) : null;
  const verifiedAt = e.status === 'verified' ? (e.verifiedAt ?? e.updatedAt) : null;
  if (excludedReason === e.excludedReason && loggedAt === e.loggedAt && verifiedAt === e.verifiedAt) return e;
  return { ...e, excludedReason, loggedAt, verifiedAt };
}

/** Monday (YYYY-MM-DD) of the week a local day is in. */
export function mondayOfDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d);
  const wd = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - wd * 86_400_000).toISOString().slice(0, 10);
}

const plusDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** The Salesforce fiscal quarter a local day is in: 2026-08-14 → "Q3 FY27", 2027-01-05 → "Q4 FY27". */
export function fiscalQuarterOfDay(day: string): string {
  const [y, mo] = day.split('-').map(Number) as [number, number];
  const fy = mo >= 2 ? y + 1 : y;
  const q = Math.floor(((mo + 10) % 12) / 3) + 1; // Feb → Q1 … Jan → Q4
  return `Q${q} FY${String(fy % 100).padStart(2, '0')}`;
}

/** The status buckets in a `status=` list (comma separated, unknown words ignored); null = no status filter. */
export function parseLogStatuses(raw: string | undefined): Set<ActivityLogStatus> | null {
  if (!raw) return null;
  const out = new Set<ActivityLogStatus>();
  for (const w of raw.split(',')) {
    const r = ActivityLogStatus.safeParse(w.trim());
    if (r.success) out.add(r.data);
  }
  return out.size ? out : null;
}

/**
 * The Ledger's drill-down filters on a row (GET /time/log `account`, `opp`, `type`; null = any). `account`: a name
 * (case-insensitive) or `none` (no account); `opp`: an id, `none` (no opportunity and not internal) or `internal`
 * (D-64: internal-only work); `type`: a task type (case-insensitive) or `none` (no type).
 */
export function matchesSlice(e: Pick<ActivityEntry, 'accountName' | 'oppId' | 'internal' | 'taskType'>, f: { account?: string | null; opp?: string | null; type?: string | null }): boolean {
  const account = f.account?.trim().toLowerCase() || null;
  const type = f.type?.trim().toLowerCase() || null;
  if (account === 'none' ? !!e.accountName : account !== null && (e.accountName ?? '').toLowerCase() !== account) return false;
  if (f.opp === 'internal' ? !e.internal : f.opp === 'none' ? !!e.oppId || e.internal : !!f.opp && e.oppId !== f.opp) return false;
  if (type === 'none' ? !!e.taskType : type !== null && (e.taskType ?? '').toLowerCase() !== type) return false;
  return true;
}

function matchesSearch(e: ActivityEntry, tokens: string[]): boolean {
  if (!tokens.length) return true;
  const hay = [e.description, e.taskType, e.oppName, e.accountName, e.meetingType].filter(Boolean).join(' ').toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

function total(rows: readonly ActivityEntry[]): ActivityLogTotal {
  let hours = 0;
  let loggedH = 0;
  for (const e of rows) {
    if (isLive(e)) hours += e.durationH;
    if (countsAsLogged(e)) loggedH += e.durationH; // TL-45: the one count map
  }
  return { rows: rows.length, hours: r2(hours), loggedH: r2(loggedH) };
}

function groupBy<K extends string>(rows: readonly ActivityEntry[], key: (e: ActivityEntry) => K): Map<K, ActivityEntry[]> {
  const out = new Map<K, ActivityEntry[]>();
  for (const e of rows) {
    const k = key(e);
    const g = out.get(k);
    if (g) g.push(e);
    else out.set(k, [e]);
  }
  return out;
}

export interface ActivityLogContext {
  meta: Pick<SeedMeta, 'quarter'>;
  now: Date;
  /** Profile timezone and day end (the quarter deadline). */
  tz: string;
  dayEnd?: string;
}

/** GET /time/log over every activity row the datasource holds. Pure: same rows, same query, same answer. */
export function buildActivityLog(all: readonly ActivityEntry[], query: ActivityLogQuery, ctx: ActivityLogContext): ActivityLog {
  const from = query.from ?? null;
  const to = query.to ?? null;
  const statuses = parseLogStatuses(query.status);
  const tokens = (query.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const slice = { account: query.account ?? null, opp: query.opp ?? null, type: query.type ?? null };

  const inRange = all.filter((e) => (!from || e.date >= from) && (!to || e.date <= to) && matchesSearch(e, tokens));
  const byAccount = (e: ActivityEntry) => matchesSlice(e, slice);
  const byStatus = (e: ActivityEntry) => !statuses || statuses.has(activityLogStatus(e.status));

  // newest day first; a day's rows in clock order (ties by end and text before ids, which differ per datasource)
  const entries = inRange
    .filter((e) => byAccount(e) && byStatus(e))
    .sort((a, b) => b.date.localeCompare(a.date) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.description.localeCompare(b.description) || a.id.localeCompare(b.id));

  const counts = Object.fromEntries(ActivityLogStatus.options.map((s) => [s, 0])) as ActivityLog['counts'];
  for (const e of inRange) if (byAccount(e)) counts[activityLogStatus(e.status)] += 1;

  const accounts = new Map<string, number>();
  const opps = new Map<string, { name: string; accountName: string | null; rows: number }>();
  const types = new Map<string | null, number>();
  for (const e of inRange) {
    if (!byStatus(e)) continue;
    if (e.accountName) accounts.set(e.accountName, (accounts.get(e.accountName) ?? 0) + 1);
    if (e.oppId) {
      const o = opps.get(e.oppId);
      if (o) o.rows += 1;
      else opps.set(e.oppId, { name: e.oppName ?? e.oppId, accountName: e.accountName, rows: 1 });
    }
    // the type menu: the rows the account and opp filters keep
    if (matchesSlice(e, { account: slice.account, opp: slice.opp })) types.set(e.taskType ?? null, (types.get(e.taskType ?? null) ?? 0) + 1);
  }

  const weeks = [...groupBy(entries, (e) => mondayOfDay(e.date))].sort(([a], [b]) => b.localeCompare(a)).map(([weekStart, rows]) => ({ weekStart, weekEnd: plusDays(weekStart, 6), ...total(rows) }));
  const months = [...groupBy(entries, (e) => e.date.slice(0, 7))].sort(([a], [b]) => b.localeCompare(a)).map(([month, rows]) => ({ month, ...total(rows) }));

  return {
    from,
    to,
    entries,
    total: total(entries),
    counts,
    weeks,
    months,
    quarters: quarterTotals(all, ctx),
    facets: {
      accounts: [...accounts].map(([name, rows]) => ({ name, rows })).sort((a, b) => a.name.localeCompare(b.name)),
      opps: [...opps].map(([id, o]) => ({ id, ...o })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      // no type last
      types: [...types].map(([name, rows]) => ({ name, rows })).sort((a, b) => (a.name === null ? 1 : 0) - (b.name === null ? 1 : 0) || (a.name ?? '').localeCompare(b.name ?? '')),
    },
  };
}

/** Every fiscal quarter that has rows, plus the current one (newest first): logged vs target, whatever the filters. */
export function quarterTotals(all: readonly ActivityEntry[], ctx: ActivityLogContext): ActivityLog['quarters'] {
  const cur = currentQuarter(ctx.meta, ctx.now, ctx.tz, ctx.dayEnd);
  const windows = new Map<string, { label: string; start: string; end: string; current: boolean }>();
  windows.set(`${cur.start}|${cur.end}`, { label: cur.label, start: cur.start, end: cur.end, current: true });
  for (const e of all) {
    const label = fiscalQuarterOfDay(e.date);
    const b = fiscalQuarterBounds(label)!;
    const k = `${b.start}|${b.end}`;
    if (!windows.has(k)) windows.set(k, { label, ...b, current: false });
  }
  return [...windows.values()]
    .sort((a, b) => b.start.localeCompare(a.start))
    .map((w) => {
      const rows = all.filter((e) => e.date >= w.start && e.date <= w.end);
      const logged = rows.filter(countsAsLogged).reduce((s, e) => s + e.durationH, 0); // TL-45
      const verified = rows.filter((e) => e.status === 'verified').reduce((s, e) => s + e.durationH, 0);
      return {
        label: w.label,
        start: w.start,
        end: w.end,
        loggedH: r2((w.current ? cur.baseH : 0) + logged),
        verifiedH: r2(verified),
        targetH: cur.targetH,
        due: w.current ? cur.due : null,
        current: w.current,
        rows: rows.length,
      };
    });
}
