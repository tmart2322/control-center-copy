/** Weekly rollups, quarter progress (CF, CR, CC) and the "ready to submit" check. Pure. */
import { isCF, isCR, roundQuarter } from './taxonomy';
import { HOUR, localDay, toMs, weekStart } from './time';
import type { ActivityConfig, ActivityEntry, Org62EventRow } from './types';
import type { ReadbackResult } from './readback';

export interface CrCf {
  cr: number;
  cf: number;
}
const zero = (): CrCf => ({ cr: 0, cf: 0 });
const r2 = (n: number) => Math.round(n * 100) / 100;
const add = (a: CrCf, type: string | null, h: number) => {
  if (type && isCR(type)) a.cr += h;
  if (type && isCF(type)) a.cf += h;
};

const loggedH = (r: Org62EventRow) => roundQuarter(r.durationField ?? (toMs(r.endsAt) - toMs(r.startsAt)) / HOUR);
const solutions = (org62: readonly Org62EventRow[]) => org62.filter((r) => r.recordTypeName === 'Solutions Event');

export interface WeekRollup {
  /** Monday (local) of the week. */
  week: string;
  logged: CrCf;
  approved: CrCf;
  toReview: CrCf;
  /** All hours the week would hold if everything counted lands (no cap: the signals are the bound). */
  totalHours: number;
}

const BUCKET: Record<string, 'approved' | 'toReview' | undefined> = {
  approved: 'approved',
  synced_to_canvas: 'approved',
  proposed: 'toReview',
  needs_input: 'toReview',
};

export function weeklyRollup(entries: readonly ActivityEntry[], org62: readonly Org62EventRow[], cfg: Pick<ActivityConfig, 'timezone'>): WeekRollup[] {
  const weeks = new Map<string, WeekRollup>();
  const wk = (iso: string) => weekStart(localDay(toMs(iso), cfg.timezone));
  const slot = (k: string) => {
    let w = weeks.get(k);
    if (!w) weeks.set(k, (w = { week: k, logged: zero(), approved: zero(), toReview: zero(), totalHours: 0 }));
    return w;
  };
  for (const r of solutions(org62)) {
    const w = slot(wk(r.startsAt));
    const h = loggedH(r);
    add(w.logged, r.seTaskTypeName, h);
    w.totalHours += h;
  }
  for (const e of entries) {
    const b = BUCKET[e.status];
    if (!b || e.operation !== 'create') continue;
    const w = slot(wk(e.startsAt));
    add(w[b], e.seTaskType, e.durationHours);
    w.totalHours += e.durationHours;
  }
  return [...weeks.values()]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((w) => ({ ...w, logged: { cr: r2(w.logged.cr), cf: r2(w.logged.cf) }, approved: { cr: r2(w.approved.cr), cf: r2(w.approved.cf) }, toReview: { cr: r2(w.toReview.cr), cf: r2(w.toReview.cf) }, totalHours: r2(w.totalHours) }));
}

export interface QuarterProgress {
  quarter: string;
  start: string;
  end: string;
  deadline: string;
  target: number;
  logged: CrCf;
  /** CC (customer-centric) tracks CR: "CR (= CC)". */
  loggedCC: number;
  approved: CrCf;
  toReview: CrCf;
  needsInput: CrCf;
  upcoming: CrCf;
  /** target - logged CC. */
  gapToTarget: number;
  /** logged + approved + to review, as a share of target. */
  projectedPct: number;
  legacyUncountedHours: number;
  daysToDeadline: number;
}

export function currentQuarter(cfg: Pick<ActivityConfig, 'quarters'>, nowIso: string): ActivityConfig['quarters'][number] | undefined {
  const day = nowIso.slice(0, 10);
  return cfg.quarters.find((q) => q.start <= day && day <= q.end) ?? cfg.quarters[cfg.quarters.length - 1];
}

export function quarterProgress(entries: readonly ActivityEntry[], org62: readonly Org62EventRow[], cfg: ActivityConfig, nowIso: string): QuarterProgress {
  const q = currentQuarter(cfg, nowIso);
  if (!q) throw new Error('no quarter configured');
  const inQ = (iso: string) => {
    const d = localDay(toMs(iso), cfg.timezone);
    return q.start <= d && d <= q.end;
  };
  const out = { logged: zero(), approved: zero(), toReview: zero(), needsInput: zero(), upcoming: zero() };
  for (const r of solutions(org62)) if (inQ(r.startsAt)) add(out.logged, r.seTaskTypeName, loggedH(r));
  const legacy = org62.filter((r) => r.recordTypeName !== 'Solutions Event' && inQ(r.startsAt)).reduce((s, r) => s + (r.durationField ?? (toMs(r.endsAt) - toMs(r.startsAt)) / HOUR), 0);
  for (const e of entries) {
    if (e.operation !== 'create' || !inQ(e.startsAt)) continue;
    const k = e.status === 'approved' || e.status === 'synced_to_canvas' ? 'approved' : e.status === 'proposed' ? 'toReview' : e.status === 'needs_input' ? 'needsInput' : e.status === 'upcoming' ? 'upcoming' : null;
    if (k) add(out[k], e.seTaskType, e.durationHours);
  }
  const fix = (x: CrCf): CrCf => ({ cr: r2(x.cr), cf: r2(x.cf) });
  const logged = fix(out.logged);
  const proj = out.logged.cr + out.approved.cr + out.toReview.cr;
  return {
    quarter: q.name,
    start: q.start,
    end: q.end,
    deadline: q.deadline,
    target: cfg.hoursTarget,
    logged,
    loggedCC: logged.cr,
    approved: fix(out.approved),
    toReview: fix(out.toReview),
    needsInput: fix(out.needsInput),
    upcoming: fix(out.upcoming),
    gapToTarget: r2(cfg.hoursTarget - logged.cr),
    projectedPct: r2((proj / cfg.hoursTarget) * 100),
    legacyUncountedHours: r2(legacy),
    daysToDeadline: Math.floor((Date.parse(q.deadline) - Date.parse(nowIso)) / (24 * HOUR)),
  };
}

export interface Blocker {
  code: 'needs_input' | 'to_review' | 'unconfirmed' | 'missing' | 'verify_failed' | 'blank_duration' | 'legacy_events' | 'overlap';
  message: string;
  count: number;
}

export interface ReadyToSubmit {
  ready: boolean;
  blockers: Blocker[];
}

/**
 * "Ready to submit" for a quarter: nothing waiting on input, every approved row confirmed in Org62
 * with matching fields, no blank Duration__c, no locked legacy-type Events left (no hour caps since 2026-11-14).
 */
export function readyToSubmit(args: {
  entries: readonly ActivityEntry[];
  org62: readonly Org62EventRow[];
  readback: ReadbackResult;
  cfg: ActivityConfig;
  nowIso: string;
}): ReadyToSubmit {
  const { entries, org62, readback, cfg } = args;
  const q = currentQuarter(cfg, args.nowIso);
  const now = toMs(args.nowIso);
  const blockers: Blocker[] = [];
  const push = (code: Blocker['code'], message: string, count: number) => count > 0 && blockers.push({ code, message, count });

  const past = entries.filter((e) => e.operation === 'create' && toMs(e.endsAt) <= now && (!q || e.startsAt.slice(0, 10) >= q.start));
  push('needs_input', 'rows still need a Related To or other input', past.filter((e) => e.status === 'needs_input').length);
  push('to_review', 'rows are proposed but not approved', past.filter((e) => e.status === 'proposed').length);
  push('unconfirmed', 'approved rows are not confirmed in Org62 (not logged)', readback.byStatus.unconfirmed);
  push('missing', 'approved rows are missing in Org62 although later events exist', readback.byStatus.missing);
  push('verify_failed', 'Org62 events differ from what was proposed', readback.byStatus.verify_failed);
  const inQ = (r: Org62EventRow) => !q || (r.startsAt.slice(0, 10) >= q.start && r.startsAt.slice(0, 10) <= q.end);
  push('blank_duration', 'Solutions Events have a blank Duration__c', solutions(org62).filter((r) => inQ(r) && r.durationField === null).length);
  push('legacy_events', 'legacy-record-type Events still exist (locked; re-create)', org62.filter((r) => r.recordTypeName !== 'Solutions Event' && inQ(r)).length);
  return { ready: blockers.length === 0, blockers };
}
