/**
 * Activity's views (pure, tested in ./views.test.ts). Two main tabs, each with its sub-tabs (D-60 shell; D-70 renamed
 * Time to Activity; the sub-views' contents are docs/ui/time-redesign.md's):
 *
 *   Org62  Log it (?view=week, the SE's default: the quarter header, Ready to log, Logging runs, Internal) · Needs you
 *          (?view=needs: only what needs you, across the quarter: rows and use cases) · Weeks (?view=weeks: pick any week;
 *          what the app found that week, onsite days, Week at a glance, the week's rows) · Ledger (?view=log: a quarter
 *          as a report, then its rows) · Use cases (?view=usecases: each use case in Org62 and VDP, neither, one or
 *          both, where they differ, its assets) · Forecast (?view=forecast, the AE's default)
 *   VDP    Changes (?view=vdp: what goes to VDP, pushed with checkboxes; what autopilot applied) · My VDPs
 *          (?view=vdp&sub=mine: who is on each VDP, its use cases and assets, "N missing" / "N to check")
 *
 * The page lives at /activity; /time (any query) redirects there (src/components/shell/routes.ts), and the old `view`
 * values are unchanged, so every link still lands. A `?week=` deep link opens Weeks on that week (the week-scoped parts
 * moved there). A view that belongs to a persona feature (D-55) shows only while that feature is active: VDP and Use
 * cases are the SE's (available, not preconfigured, for an AE). Inactive means no daily surface: its tab is hidden, and
 * a direct link shows that it is available to activate instead.
 */
import type { PersonaFeature } from '@/contract';
import { allows } from '@/personas/gates';
import type { ResolvedPersona } from '@/personas/types';

export type TimeView = 'week' | 'needs' | 'weeks' | 'log' | 'usecases' | 'vdp' | 'forecast';
export type TimeArea = 'org62' | 'vdp';
export type VdpSub = 'changes' | 'mine';

export const ACTIVITY_PATH = '/activity';

export const TIME_VIEWS: Array<{ value: TimeView; label: string; area: TimeArea; feature?: PersonaFeature }> = [
  { value: 'week', label: 'Log it', area: 'org62' },
  { value: 'needs', label: 'Needs you', area: 'org62' },
  { value: 'weeks', label: 'Weeks', area: 'org62' },
  { value: 'log', label: 'Ledger', area: 'org62' },
  // D-70: use cases in Org62 and VDP (the use cases come from VDP: the SE's feature)
  { value: 'usecases', label: 'Use cases', area: 'org62', feature: 'vdp' },
  // lane A: Specialist Forecast, the AE's default view
  { value: 'forecast', label: 'Forecast', area: 'org62', feature: 'specialistForecast' },
  { value: 'vdp', label: 'VDP', area: 'vdp', feature: 'vdp' },
];

export const TIME_AREAS: Array<{ value: TimeArea; label: string; feature?: PersonaFeature }> = [
  { value: 'org62', label: 'Org62' },
  { value: 'vdp', label: 'VDP', feature: 'vdp' },
];

export const VDP_SUBS: Array<{ value: VdpSub; label: string }> = [
  { value: 'changes', label: 'Changes' },
  { value: 'mine', label: 'My VDPs' },
];

/** The views a `?week=` belongs to now: Log it and Needs you no longer show a week (Weeks does). */
const WEEK_LINKED: ReadonlySet<string> = new Set(['week', 'needs']);

/**
 * `?view=` → the view. Without one (or an unknown one): the persona's default, Forecast for an AE with Specialist
 * Forecast active (their weekly duty), else Log it (`week`). A `?week=` with no view, or with Log it's or Needs you's
 * (the old deep links), opens Weeks on that week.
 */
export function timeViewOf(param: string | null | undefined, persona?: ResolvedPersona | null, week?: string | null): TimeView {
  if (week && (!param || WEEK_LINKED.has(param))) return 'weeks';
  const known = TIME_VIEWS.find((t) => t.value === param);
  if (known) return known.value;
  return persona && persona.id === 'ae' && allows(persona, { feature: 'specialistForecast' }) ? 'forecast' : 'week';
}

/** The main tab a view belongs to. */
export const timeAreaOf = (view: TimeView): TimeArea => TIME_VIEWS.find((t) => t.value === view)?.area ?? 'org62';

/** `?sub=` under VDP: My VDPs (`mine`), else Changes. */
export const vdpSubOf = (param: string | null | undefined): VdpSub => (param === 'mine' ? 'mine' : 'changes');

/** The Org62 sub-tabs this persona sees, in order. While it loads (null) gated views stay hidden. */
export function timeTabsFor(persona: ResolvedPersona | null | undefined): Array<{ value: TimeView; label: string }> {
  return TIME_VIEWS.filter((t) => t.area === 'org62' && allows(persona, t.feature ? { feature: t.feature } : undefined)).map(({ value, label }) => ({ value, label }));
}

/** The main tabs (Org62, VDP) this persona sees: an AE without VDP sees Org62 only. */
export function areaTabsFor(persona: ResolvedPersona | null | undefined): Array<{ value: TimeArea; label: string }> {
  return TIME_AREAS.filter((t) => allows(persona, t.feature ? { feature: t.feature } : undefined)).map(({ value, label }) => ({ value, label }));
}

/** Where a main tab goes: Org62 → the persona's default Org62 view, VDP → Changes. */
export function hrefForArea(area: TimeArea, persona: ResolvedPersona | null | undefined): string {
  if (area === 'vdp') return `${ACTIVITY_PATH}?view=vdp`;
  const v = timeViewOf(null, persona);
  return v === 'week' ? ACTIVITY_PATH : `${ACTIVITY_PATH}?view=${v}`;
}

/** Where an Org62 sub-tab goes (the persona's default is the bare /activity). */
export const hrefForView = (v: TimeView, persona: ResolvedPersona | null | undefined): string => (v === timeViewOf(null, persona) ? ACTIVITY_PATH : `${ACTIVITY_PATH}?view=${v}`);

/** Where a VDP sub-tab goes. */
export const hrefForVdpSub = (s: VdpSub): string => (s === 'mine' ? `${ACTIVITY_PATH}?view=vdp&sub=mine` : `${ACTIVITY_PATH}?view=vdp`);

/** Weeks on one week (its Monday), or the current one. */
export const hrefForWeek = (monday: string | null): string => `${ACTIVITY_PATH}?view=weeks${monday ? `&week=${encodeURIComponent(monday)}` : ''}`;

/**
 * What a view renders for this persona: the view itself, a neutral loading frame while the persona loads (a gated
 * view's words never flash), or the feature that is not active (shown as available to activate).
 */
export function timeViewAccess(view: TimeView, persona: ResolvedPersona | null | undefined): { state: 'show' } | { state: 'loading' } | { state: 'inactive'; feature: PersonaFeature } {
  const feature = TIME_VIEWS.find((t) => t.value === view)?.feature;
  if (!feature) return { state: 'show' };
  if (!persona) return { state: 'loading' };
  return allows(persona, { feature }) ? { state: 'show' } : { state: 'inactive', feature };
}
