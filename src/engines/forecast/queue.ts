/**
 * The Specialist Forecast duty as rules over the mirror (pure; Time ▸ Forecast and Home ▸ Log & fix read the same):
 *
 *   notes     an in-quarter record of at least `staleNotesMinAmountUsd` whose ForecastNotes__c will be at least
 *             `staleNotesDays` old at the next deadline (`notesDueWeekday` `notesDueAt`) is due; one already that old
 *             at the last deadline is overdue. Closed and dead records need none. Biggest and furthest along first.
 *   roles     Deal_Role__c None (or empty) on a record with ACV of at least `dealRoleMinAcvUsd`: set it to at least
 *             Aware (Aware unless you pick another)
 *   missing   an open opportunity of mine closing this or next quarter with Data 360 or Flex work (the missed-opp
 *             classifier's signals, src/engines/deals/classify.ts) but no Specialist Forecast: a handoff to its
 *             Forecast tab
 */
import type { ForecastNotesState, ForecastThresholds, Opportunity, SpecialistForecast } from '@/contract';
import { AE_PERSONA, type ResolvedPersona } from '@/personas';
import { classifyLineItems } from '@/engines/deals/classify';
import { DAY_MS, toMs } from '@/engines/home/time';
import { ageDays, normalizeQuarter, sfrQuarterBounds, sfrQuarterOfDay } from './time';

const DEFAULTS = Object.fromEntries(AE_PERSONA.thresholds.map((t) => [t.key, t.default])) as Record<string, number | string>;

const num = (v: unknown, d: number, min = 0) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? Math.max(min, n) : d;
};

/** The persona's thresholds (the AE preset's defaults where a value is missing or unreadable). */
export function forecastThresholds(p: Pick<ResolvedPersona, 'thresholds'> | null | undefined): ForecastThresholds {
  const t = p?.thresholds ?? {};
  const pick = (k: string) => (k in t ? t[k] : DEFAULTS[k]);
  const weekday = Math.round(num(pick('notesDueWeekday'), 1));
  const dueAt = String(pick('notesDueAt') ?? '09:00');
  return {
    minAmountUsd: num(pick('staleNotesMinAmountUsd'), 100_000),
    staleDays: Math.max(1, Math.round(num(pick('staleNotesDays'), 7, 1))),
    dealRoleMinAcvUsd: num(pick('dealRoleMinAcvUsd'), 1),
    dueWeekday: weekday >= 0 && weekday <= 6 ? weekday : 1,
    dueAt: /^\d{1,2}:\d{2}$/.test(dueAt.trim()) ? dueAt.trim() : '09:00',
    template: String(pick('forecastNoteTemplate') ?? DEFAULTS.forecastNoteTemplate ?? ''),
  };
}

const CLOSED_STATUS = /^closed\s+(won|lost)$/i;
const DEAD = /^(dead\b|closed\s*-\s*out|08\b)/i;
const LOST = /^(dead\b|closed\s*-\s*out)/i;

/** Closed won or lost, dead, or stage 08: no weekly notes. */
export function isClosedRecord(r: Pick<SpecialistForecast, 'forecastStatus' | 'stage'>): boolean {
  return CLOSED_STATUS.test(r.forecastStatus ?? '') || DEAD.test((r.stage ?? '').trim());
}

/** Lost or dead (Deal Role no longer matters); a closed-won deal still needs its role. */
export function isLostRecord(r: Pick<SpecialistForecast, 'forecastStatus' | 'stage'>): boolean {
  return /^closed\s+lost$/i.test(r.forecastStatus ?? '') || LOST.test((r.stage ?? '').trim());
}

/** The record's fiscal quarter ("FY27 Q4"), from FiscalQuarter__c, else its close date. */
export function quarterOfRecord(r: Pick<SpecialistForecast, 'fiscalQuarter' | 'closeDate'>): string | null {
  return normalizeQuarter(r.fiscalQuarter) ?? (r.closeDate ? sfrQuarterOfDay(r.closeDate) : null);
}

/** "05 - Negotiating $$ & Mutual Plan" → 5; unknown → null. */
export function stageNumber(stage: string | null): number | null {
  const m = /^\s*0?([1-8])\b/.exec(stage ?? '');
  return m ? Number(m[1]) : null;
}

const STATUS_WEIGHT: Record<string, number> = { commit: 1.3, 'best case': 1.15, pipeline: 1, omitted: 0.8 };

/** Queue order: amount × how far along (stage 1–7 of 7; Commit and Best Case a little ahead). */
export function queueScore(r: Pick<SpecialistForecast, 'amount' | 'stage' | 'forecastStatus'>): number {
  const n = stageNumber(r.stage);
  const along = n ? Math.min(7, n) / 7 : 0.3;
  return (r.amount ?? 0) * along * (STATUS_WEIGHT[(r.forecastStatus ?? '').toLowerCase()] ?? 1);
}

export interface NotesVerdict {
  state: ForecastNotesState;
  ageDays: number | null;
  inQuarter: boolean;
}

/**
 * Due when the notes will be at least `staleDays` old at the next deadline; overdue when they already were at the
 * last one. No change on record (History empty) counts as due.
 */
export function notesVerdict(r: SpecialistForecast, t: ForecastThresholds, o: { nowMs: number; currentQuarter: string; prevDueMs: number; nextDueMs: number }): NotesVerdict {
  const inQuarter = quarterOfRecord(r) === o.currentQuarter;
  const age = ageDays(r.notesUpdatedAt, o.nowMs);
  if (r.goneAt || !inQuarter || isClosedRecord(r) || (r.amount ?? 0) < t.minAmountUsd || (r.amount ?? 0) <= 0) return { state: 'not_required', ageDays: age, inQuarter };
  if (!r.notesUpdatedAt) return { state: 'due', ageDays: null, inQuarter };
  const last = toMs(r.notesUpdatedAt);
  const stale = t.staleDays * DAY_MS;
  if (o.prevDueMs - last >= stale) return { state: 'overdue', ageDays: age, inQuarter };
  if (o.nextDueMs - last >= stale) return { state: 'due', ageDays: age, inQuarter };
  return { state: 'fresh', ageDays: age, inQuarter };
}

/** Deal Role None (or empty) on a deal with ACV of at least the minimum, and not lost. */
export function needsRoleFix(r: SpecialistForecast, t: ForecastThresholds): boolean {
  if (r.goneAt || isLostRecord(r)) return false;
  const role = (r.dealRole ?? '').trim();
  const amt = r.amount ?? 0;
  return (role === '' || role.toLowerCase() === 'none') && amt > 0 && amt >= t.dealRoleMinAcvUsd;
}

/** The 15-character form of an Org62 id (18-character ids carry a case suffix). */
export const id15 = (id: string | null | undefined) => (id ? id.slice(0, 15) : '');

/** An Org62 opp id inside an app opp's org62Url. */
export function org62IdOfOpp(o: Pick<Opportunity, 'org62Url'>): string | null {
  return /\b(006[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?)\b/.exec(o.org62Url ?? '')?.[1] ?? null;
}

export interface MissingCandidate {
  opp: Opportunity;
  signal: 'd360_line' | 'name_token' | 'flex_only';
}

/**
 * Open opportunities of mine closing this or next quarter (the window the sync reads, so "no record" is known) with
 * Data 360 or Flex work and no Specialist Forecast linked to them. Products carry no price here, so $0 entitlement
 * lines (Provisioning, Foundations) are left out, as the classifier does.
 */
export function missingForecasts(opps: readonly Opportunity[], records: readonly SpecialistForecast[], window: { current: string; next: string }): MissingCandidate[] {
  const a = sfrQuarterBounds(window.current);
  const b = sfrQuarterBounds(window.next);
  if (!a || !b) return [];
  const linked = new Set<string>();
  const linkedOrg62 = new Set<string>();
  for (const r of records) {
    if (r.goneAt) continue;
    if (r.opportunityId) linked.add(r.opportunityId);
    if (r.org62OpportunityId) linkedOrg62.add(id15(r.org62OpportunityId));
  }
  const out: MissingCandidate[] = [];
  for (const o of opps) {
    if (!o.isOpen || !(o.isMine || o.dcAssigned) || !o.closeDate || o.closeDate < a.start || o.closeDate > b.end) continue;
    if (linked.has(o.id)) continue;
    const oid = org62IdOfOpp(o);
    if (oid && linkedOrg62.has(id15(oid))) continue;
    const c = classifyLineItems(o, o.products.map((p) => ({ oppId: o.id, productName: p, totalPrice: 0 })));
    if (c.signal === 'none') continue;
    out.push({ opp: o, signal: c.signal });
  }
  return out.sort((x, y) => (y.opp.amount ?? 0) - (x.opp.amount ?? 0) || x.opp.id.localeCompare(y.opp.id));
}
