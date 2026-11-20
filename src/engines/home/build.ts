/**
 * Home aggregation (design v2): a pure function from the store's entities to the HomePayload contract
 * (src/contract/home.ts). No I/O, no clock: `input.now` is the only "now". The mock DataSource calls it
 * today; the db DataSource can call it with its read model later.
 *
 * Rules (each is named so a row can say why it is there):
 * - Today scope: due today, start-by today, or pinned to today (a `work`/`focus` spine slot). Overdue and
 *   later work is never load; it goes to Think ahead or "pull forward".
 * - A meeting holds its work: an item that is the ready prep of one of today's meetings costs no hands-on time.
 * - Blocked: an item whose NBA offers wait / nudge while one of its people owes you an answer (a live
 *   waiting_on_others item). It never takes a Do now slot; it shows in Reply & approve as Blocked.
 * - Capacity counts hands-on minutes only (estimate.ts) and "fits" = youMinToday ≤ freeMin.
 * - Do now: ranked today work, with the Outbox approvals as #2 (minutes of work that unblock others).
 * - Nothing is listed twice: Do now → Log & fix (gap rules consume their items) → Reply & approve →
 *   Chase → Think ahead.
 * - Planning ahead (`input.day = 'next'`): Home as the next working day starts (its working-hours start is "now"):
 *   that day's meetings and capacity, what is due or starts then, plus today's open work carried over and anything
 *   moved there (a snooze that wakes by its end). No now line, no since-you-left, no Outbox card (approvals are for
 *   now; Reply & approve still offers them). Every day label names that day ("Tomorrow turns on…").
 */
import type {
  CalendarEvent,
  Draft,
  HomeAheadDay,
  HomeCapacity,
  HomeCard,
  HomeDayRef,
  HomeDraftLine,
  HomeEntity,
  HomeFooter,
  HomeMasthead,
  HomeNextDay,
  HomePayload,
  HomeRibbon,
  HomeRibbonBlock,
  HomeRow,
  HomeSection,
  HomeSectionId,
  HomeSegment,
  HomeState,
  HomeVerb,
  Initiative,
  NbaCard,
  NowCard,
  WorkItem,
} from '@/contract';
import { HOME_GAP_REASONS, isAdminDraft, type NeedDecision, type NeedResolve } from '@/contract';
import { agentMin, approveMin, handsOnMin, reauthMin } from './estimate';
import { closedForYouSince } from './closed';
import { looksDoneEvidence } from './looks-done';
import { clip, corePhrase, firstClause, firstName, lowerFirst, plural, shortAccount, shortEvent } from './text';
import { addLocalDays, atLocal, daysBetween, dayKey, dayStart, dur, HOUR_MS, hm, isWorkingDay, md, MIN_MS, nextWorkingDay, parseHM, toMs, tzShort, wd, whenLabel, workingDayAt, zoned, type WorkingDay } from './time';
import { connectorRowsFor, type GapRuleId, type ResolvedPersona } from '@/personas';
import type { PersonaFeature } from '@/contract';
import { loggingProfile } from '@/engines/activity/persona';
import { countsAsLogged } from '@/engines/activity/org62-check';
import { personaGaps } from './persona-gaps';
import { decisionIndex, isSetAside, subjectList } from '@/lib/need-decisions';
import type { HomeInput } from './types';
import { actionApp, actionSource } from '@/lib/actions';
import { plainIssue } from '@/lib/time-issues';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Time ▸ Week (the quarter log's steps): never bare `/time`, which opens Forecast for an AE (timeViewOf). */
export const TIME_WEEK = '/activity?view=week';

export const HOME_CAPS = { rows: 3, rowsWide: 5, initiatives: 5, initiativesWide: 10, pullForward: 5, aheadDays: 14, looksDone: 1, looksDoneWide: 2 } as const;
/** Promises: undated commitments at least this old (background promises always count). */
export const PROMISE_MIN_AGE_D = 5;
/** Undated commitments in one initiative fold into one Chase row from this many. */
export const FOLD_AT = 3;
/** A promise this old is amber. */
export const PROMISE_RISK_AGE_D = 30;
/** Open blocks shorter than this stay plain track on the ribbon. */
export const OPEN_BLOCK_MIN = 60;
/** Done prep counts as "ready" in the card's prep line for this long. */
const PREP_DONE_WINDOW_MS = 36 * HOUR_MS;

const LIVE = new Set(['open', 'in_progress', 'waiting_on_me', 'waiting_on_others', 'likely_done', 'reopened']);
/**
 * LD-1: the work Home ranks, sections and counts. A likely-done item is not open work: it waits for one click
 * (Confirm or Not done) in its own "Looks done: confirm" group, never in Do now, the top slots or the sections.
 * It still counts as a meeting's linked prep (LIVE above).
 */
const WORK_LIVE = new Set([...LIVE].filter((s) => s !== 'likely_done'));
const FINAL_DRAFT = new Set(['sent', 'verified', 'discarded', 'rejected', 'staged']);
const REPLY_TITLE = /^(reply|answer|respond|confirm|send|email|tell|let)\b/i;

export const SECTION_TITLE: Record<HomeSectionId, string> = {
  reply: 'Reply & approve',
  ahead: 'Think ahead',
  fix: 'Log & fix',
  chase: 'Chase',
  initiatives: 'Initiatives',
};

const SECTION_EMPTY: Record<HomeSectionId, string> = {
  reply: 'Nothing waiting on your reply.',
  ahead: 'Nothing dated in the next 14 days.',
  fix: 'Nothing missing. Logs and connectors are current.',
  chase: 'Nobody owes you anything.',
  initiatives: 'No active initiatives.',
};

// ---------------------------------------------------------------------------
// Small constructors (contract defaults spelled out)
// ---------------------------------------------------------------------------

const seg = (text: string, em = false, mark: HomeSegment['mark'] = null): HomeSegment => ({ text, em, mark });
const verb = (label: string, action: HomeVerb['action'], href: string | null = null, targetId: string | null = null): HomeVerb => ({ label, action, href, targetId });
const itemHref = (id: string) => `/work/${id}`;
const workEntity = (w: WorkItem): HomeEntity => ({ kind: 'work_item', id: w.id, label: w.title });

function row(r: Omit<HomeRow, 'item' | 'progress' | 'heat' | 'dateLabel' | 'resolve'> & Partial<Pick<HomeRow, 'item' | 'progress' | 'heat' | 'dateLabel' | 'resolve'>>): HomeRow {
  return { item: null, progress: null, heat: null, dateLabel: null, resolve: null, ...r };
}

// Whole millions from $10M up keep their zeros ($50M, not "$5M"); below that, two decimals with trailing zeros dropped.
const usdShort = (n: number) => (n >= 1_000_000 ? `$${n >= 10_000_000 ? Math.round(n / 1_000_000) : (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`);
const round1 = (n: number) => Math.round(n * 10) / 10;
const fmtH = (n: number) => (Number.isInteger(n) ? String(n) : String(round1(n)));

// ---------------------------------------------------------------------------
// Context: lookups and derived per-item facts
// ---------------------------------------------------------------------------

interface Ctx {
  input: HomeInput;
  tz: string;
  /** "Now" for every rule: the real now, or the planned day's working-hours start. */
  nowMs: number;
  /** The real clock (the nudge, what counts as today's work when planning). */
  realNowMs: number;
  /** The working day being planned (`day = 'next'`); null on today. */
  plan: WorkingDay | null;
  /** Planning: cards on the day without being due then (today's open work, moved there). */
  carried: Map<string, NonNullable<HomeCard['carried']>>;
  todayStart: number;
  todayEnd: number;
  wStart: number;
  wEnd: number;
  live: WorkItem[];
  byId: Map<string, WorkItem>;
  nbaOf: (w: WorkItem) => NbaCard | null;
  draftOf: (w: WorkItem) => Draft | null;
  eventById: Map<string, CalendarEvent>;
  iniById: Map<string, Initiative>;
  todayEvents: CalendarEvent[];
  heldByMeeting: (w: WorkItem) => CalendarEvent | null;
  blockedBy: (w: WorkItem) => WorkItem | null;
  todayScoped: (w: WorkItem) => boolean;
  handsOn: (w: WorkItem) => number;
  readyDrafts: Draft[];
}

function isToday(ms: number | null, c: Pick<Ctx, 'todayStart' | 'todayEnd'>) {
  return ms !== null && ms >= c.todayStart && ms < c.todayEnd;
}
const msOrNull = (iso: string | null | undefined) => (iso ? toMs(iso) : null);

function makeCtx(raw: HomeInput): Ctx {
  const tz = raw.timezone;
  const realNowMs = toMs(raw.now);
  const plan = raw.day === 'next' ? nextWorkingDay(realNowMs, tz, raw.workingHours) : null;
  const nowMs = plan ? plan.startMs : realNowMs;
  const todayStart = dayStart(nowMs, tz);
  const todayEnd = addLocalDays(nowMs, 1, tz);
  const p = zoned(nowMs, tz);
  const wh = raw.workingHours;
  const sMin = parseHM(wh.start);
  const eMin = parseHM(wh.end);
  const wStart = atLocal(p.y, p.m, p.d, Math.floor(sMin / 60), sMin % 60, tz);
  const wEnd = atLocal(p.y, p.m, p.d, Math.floor(eMin / 60), eMin % 60, tz);

  // Planning: a snooze that wakes by the planned day's end is awake that day (it was moved there).
  const carried = new Map<string, NonNullable<HomeCard['carried']>>();
  const input: HomeInput = plan
    ? {
        ...raw,
        items: raw.items.map((w) => {
          if (w.state !== 'snoozed' || !w.snoozedUntil || toMs(w.snoozedUntil) >= todayEnd) return w;
          carried.set(w.id, 'moved');
          return { ...w, state: w.snoozedFrom && WORK_LIVE.has(w.snoozedFrom) ? w.snoozedFrom : 'open' };
        }),
      }
    : raw;

  const nbaById = new Map(input.nbas.map((n) => [n.id, n]));
  const draftById = new Map(input.drafts.map((d) => [d.id, d]));
  const eventById = new Map(input.events.map((e) => [e.id, e]));
  const iniById = new Map(input.initiatives.map((i) => [i.id, i]));
  const live = input.items.filter((w) => WORK_LIVE.has(w.state));
  const byId = new Map(input.items.map((w) => [w.id, w]));

  const nbaOf = (w: WorkItem) => {
    const n = w.nbaId ? nbaById.get(w.nbaId) : undefined;
    return n && !['dismissed', 'completed'].includes(n.status) ? n : null;
  };
  const draftOf = (w: WorkItem) => {
    const n = nbaOf(w);
    const d = n?.draftId ? draftById.get(n.draftId) : input.drafts.find((x) => x.workItemId === w.id && !FINAL_DRAFT.has(x.status));
    return d && !FINAL_DRAFT.has(d.status) ? d : null;
  };
  const todayEvents = input.events
    .filter((e) => toMs(e.end) > todayStart && toMs(e.start) < todayEnd)
    .sort((a, b) => a.start.localeCompare(b.start));
  const heldByMeeting = (w: WorkItem) =>
    todayEvents.find((e) => e.prep?.workItemId === w.id && e.prep.ready && !['declined', 'cancelled'].includes(e.attendance)) ?? null;

  const waiting = live.filter((w) => w.state === 'waiting_on_others' && w.waiting?.who);
  const blockedBy = (w: WorkItem) => {
    if (w.state === 'waiting_on_others') return null;
    const n = nbaOf(w);
    if (!n || !n.alternatives.some((a) => a.verb === 'wait' || a.verb === 'nudge')) return null;
    const ids = new Set([...w.people.map((x) => x.id), ...(w.counterparty ? [w.counterparty.id] : [])]);
    return waiting.find((x) => x.id !== w.id && ids.has(x.waiting!.who!.id)) ?? null;
  };

  const pinnedIn = (b: Pick<Ctx, 'todayStart' | 'todayEnd'>) =>
    new Set(input.slots.filter((s) => (s.kind === 'work' || s.kind === 'focus') && s.workItemId && isToday(toMs(s.start), b)).map((s) => s.workItemId!));
  const pinned = pinnedIn({ todayStart, todayEnd });
  const scopedIn = (w: WorkItem, b: Pick<Ctx, 'todayStart' | 'todayEnd'>, pins: Set<string>) =>
    WORK_LIVE.has(w.state) && !w.isBackground && w.state !== 'waiting_on_others' && (isToday(msOrNull(w.due), b) || isToday(msOrNull(w.startBy), b) || pins.has(w.id));
  // Planning: today's work still open carries over (today-scoped from today until the planned day starts).
  if (plan) {
    const today = { todayStart: dayStart(realNowMs, tz), todayEnd: todayStart };
    const pins = pinnedIn(today);
    for (const w of live) if (!carried.has(w.id) && !scopedIn(w, { todayStart, todayEnd }, pinned) && scopedIn(w, today, pins)) carried.set(w.id, 'from_today');
  }
  const todayScoped = (w: WorkItem) => scopedIn(w, { todayStart, todayEnd }, pinned) || (carried.has(w.id) && WORK_LIVE.has(w.state) && !w.isBackground && w.state !== 'waiting_on_others');
  const handsOn = (w: WorkItem) => handsOnMin(w);

  // The Outbox's pending-approval order (most recently updated first), so the card's queue and the Outbox agree.
  // D-52: admin items (logging canvases, VDP changes) are applied on Time; the card approves messages
  const readyDrafts = input.drafts.filter((d) => d.status === 'ready' && !isAdminDraft(d)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return { input, tz, nowMs, realNowMs, plan, carried, todayStart, todayEnd, wStart, wEnd, live, byId, nbaOf, draftOf, eventById, iniById, todayEvents, heldByMeeting, blockedBy, todayScoped, handsOn, readyDrafts };
}

const byRank = (a: WorkItem, b: WorkItem) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || (a.due ?? '9').localeCompare(b.due ?? '9') || a.id.localeCompare(b.id);
/** `Q4 FY27` → its local days (the fiscal year starts 1 February: FY27 = Feb 2026 to Jan 2027); null otherwise. */
function quarterDays(label: string): { start: string; end: string } | null {
  const m = /^Q([1-4])\s+FY(\d{2})$/.exec(label.trim());
  if (!m) return null;
  const fy = 2000 + Number(m[2]);
  const startMonth = 1 + (Number(m[1]) - 1) * 3;
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return { start: day(new Date(Date.UTC(fy - 1, startMonth, 1))), end: day(new Date(Date.UTC(fy - 1, startMonth + 3, 0))) };
}

/** Only accepted meetings block time (DESIGN-V2 capacity; the priority engine's `isBusy`). */
const isBusyEvent = (e: CalendarEvent) =>
  !['declined', 'cancelled', 'missed'].includes(e.attendance) && e.myResponse !== 'tentative' && e.myResponse !== 'needs_action' && !e.isAllDay && (e.eventType ?? 'default') === 'default';

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

interface Interval {
  s: number;
  e: number;
}

function freeIntervals(c: Ctx): Interval[] {
  const from = Math.max(c.nowMs, c.wStart);
  if (from >= c.wEnd) return [];
  const busy = c.todayEvents.filter(isBusyEvent).map((e) => ({ s: toMs(e.start), e: toMs(e.end) })).sort((a, b) => a.s - b.s);
  const out: Interval[] = [];
  let cur = from;
  for (const b of busy) {
    if (b.e <= cur || b.s >= c.wEnd) continue;
    if (b.s > cur) out.push({ s: cur, e: Math.min(b.s, c.wEnd) });
    cur = Math.max(cur, b.e);
    if (cur >= c.wEnd) break;
  }
  if (cur < c.wEnd) out.push({ s: cur, e: c.wEnd });
  return out.filter((i) => i.e - i.s >= MIN_MS);
}

/** Today's ranked hands-on work for Do now (the day's totals come from `input.capacity`). */
function todayItems(c: Ctx): WorkItem[] {
  return c.live.filter((w) => c.todayScoped(w) && !c.heldByMeeting(w)).sort(byRank);
}

// ---------------------------------------------------------------------------
// Gap rules (Log & fix)
// ---------------------------------------------------------------------------

interface Gap {
  rule: GapRuleId;
  row: HomeRow;
  /** Items this gap stands for (not listed again elsewhere, also while the row is set aside). */
  consumes: string[];
  /** What the row stands for (missed opps, deal roles): a Not needed row comes back when a new one appears. */
  subjects?: string[];
  /** Set aside (Not now until a date, or Not needed): not drawn, still consumes its items. */
  hidden?: boolean;
}

/**
 * Every Log & fix row can be set aside, through the one needs-you mechanism (src/contract/needs.ts, rule
 * `home:<gap rule>`, subject = the row id). Rows that are real outstanding work (rows to log, a broken source, notes
 * due, expenses, VDP steps) get Not now only: they come back on the date. A missed-opp claim, a deal role to set or a
 * missing Specialist Forecast can also be Not needed with a reason, until a new subject appears in the row.
 */
const HOME_NOT_NEEDED: ReadonlySet<GapRuleId> = new Set(['missed_dc', 'deal_role', 'missing_sfr']);

function withResolve(g: Gap, decisions: ReadonlyMap<string, NeedDecision>, nowIso: string): Gap {
  const notNeeded = HOME_NOT_NEEDED.has(g.rule);
  const resolve: NeedResolve = { rule: `home:${g.rule}`, subjectIds: [g.row.id], snooze: true, reasons: notNeeded ? [...HOME_GAP_REASONS] : [], baseline: notNeeded ? { subjects: subjectList(g.subjects ?? []) } : {}, label: g.row.title };
  return { ...g, row: { ...g.row, resolve }, hidden: isSetAside(decisions, resolve.rule, g.row.id, nowIso, resolve.baseline) };
}

/**
 * D-55: what a Log & fix rule needs from the persona beyond being preconfigured. A rule outside the preset comes back
 * when the feature it belongs to is activated (an AE who activates deal contributions gets "Request DC").
 */
const GAP_NEEDS: Partial<Record<GapRuleId, (p: ResolvedPersona) => boolean>> = {
  missed_dc: (p) => p.features.dealContributions,
  quarter_log: (p) => p.features.activityLogging && p.logging.hoursTargetH !== null,
  org62_unlogged: (p) => p.features.activityLogging,
  // 2026-11-13 audit C2: DCs and use cases ride on logging canvases
  canvas_waiting: (p) => p.features.activityLogging && (p.features.dealContributions || p.features.vdp),
  needs_input: (p) => p.features.activityLogging,
  vdp_open: (p) => p.features.vdp,
};
const GAP_FEATURE: Partial<Record<GapRuleId, PersonaFeature>> = { missed_dc: 'dealContributions', vdp_open: 'vdp', forecast_notes: 'specialistForecast', deal_role: 'specialistForecast', missing_sfr: 'specialistForecast' };

/** "Solutions Events" (SE), "Sales Events" (AE): the persona's logged record type, plural. */
const loggedEvents = (p: ResolvedPersona | undefined) => {
  const n = loggingProfile(p).recordTypeName;
  return n.endsWith('s') ? n : `${n}s`;
};

/** Whether a Log & fix rule runs for this persona (no persona: every SE rule, as before personas). */
export function gapRuleOn(rule: GapRuleId, p: ResolvedPersona | undefined): boolean {
  if (!p) return true;
  const f = GAP_FEATURE[rule];
  const preconfigured = p.gapRules.includes(rule) || (!!f && p.changedFeatures.includes(f) && p.features[f]);
  return preconfigured && (GAP_NEEDS[rule]?.(p) ?? true);
}

function gapRules(c: Ctx): Gap[] {
  const { input, tz, nowMs } = c;
  const gaps: Gap[] = [];
  const on = (rule: GapRuleId) => gapRuleOn(rule, input.persona);
  const findItem = (pred: (w: WorkItem) => boolean) => c.live.filter(pred).sort(byRank)[0] ?? null;

  // 1. A connector that needs auth.
  for (const k of on('connector_auth') ? input.connectors.filter((x) => x.state === 'auth_needed' || x.state === 'error') : []) {
    const label = k.reauth?.label ?? `Re-auth ${k.label}`;
    gaps.push({
      rule: 'connector_auth',
      consumes: [],
      row: row({
        id: `gap:connector:${k.id}`,
        kind: 'gap',
        title: label,
        why: clip(firstClause(k.impact) || k.lastError?.message || `${k.label} is not syncing`, 60),
        state: 'overdue',
        stateLabel: k.state === 'auth_needed' ? `Expired ${md(toMs(k.since), tz)}` : 'Broken',
        due: null,
        youMin: reauthMin(),
        verb: verb(k.reauth?.kind === 'instructions' ? 'How to fix' : 'Re-auth', 'reauth', `/health?connector=${k.id}`, k.id),
        href: `/health?connector=${k.id}`,
        entity: { kind: 'connector', id: k.id, label: k.label },
      }),
    });
  }

  // 2. The quarter's activity log vs its target, with its deadline.
  const q = input.quarter;
  const qDue = toMs(q.due);
  // this fiscal quarter's rows only: projections keep logged rows of every quarter (past weeks, History)
  const qb = quarterDays(q.label);
  // TL-45: the one status → count map (Time, the quarter totals and the receipts read the same)
  const logged = input.activity.filter((a) => countsAsLogged(a) && (!qb || (a.date >= qb.start && a.date <= qb.end)));
  const loggedH = round1(q.loggedH + logged.reduce((s, a) => s + a.durationH, 0));
  // Oldest first (start, then end): the row links to the earliest handed-off entry whatever order the DataSource returns.
  // D-64: an internal row the app suggests (proposed) is a quiet suggestion on Time, not a row to confirm here
  const handedOff = input.activity
    .filter((a) => a.status === 'synced_to_canvas' || a.status === 'approved' || (a.status === 'proposed' && !a.internal))
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const handedOffH = round1(handedOff.reduce((s, a) => s + a.durationH, 0));
  const logItem = findItem((w) => (w.due === q.due && /log/i.test(w.title)) || /activity log/i.test(w.title));
  const confirmItem = findItem((w) => /org62/i.test(w.title) && /(confirm|handed-off|approve)/i.test(w.title));
  const lastLogged = input.activity.filter((a) => a.status === 'logged' || a.status === 'verified').map((a) => a.date).sort().at(-1) ?? null;
  const canvasWord = input.canvasLabel.replace(/^Slackbot /i, '').toLowerCase() || 'canvas';
  const quarterRow = on('quarter_log') && qDue >= c.todayStart && loggedH < q.targetH;
  // The quarter row and the Org62 row would list the same handed-off rows twice: with both on, the quarter row
  // carries the Org62 detail (rows, hours on the canvas, the last day logged) and the Org62 row is not drawn.
  const mergeOrg62 = quarterRow && on('org62_unlogged') && handedOff.length > 0;
  if (quarterRow) {
    const daysLeft = daysBetween(nowMs, qDue, tz);
    const confirmMin = confirmItem ? c.handsOn(confirmItem) : handedOff.length ? 30 : 0;
    const org62Since = lastLogged ? `none in Org62 after ${md(toMs(`${lastLogged}T12:00:00Z`), 'UTC')}` : 'nothing in Org62 yet';
    const lead = logItem ?? (mergeOrg62 ? confirmItem : null);
    gaps.push({
      rule: 'quarter_log',
      consumes: [...new Set([logItem?.id, mergeOrg62 ? confirmItem?.id : undefined].filter((id): id is string => !!id))],
      row: row({
        id: 'gap:quarter_log',
        kind: 'gap',
        title: `${q.label.split(' ')[0]} activity log: ${fmtH(loggedH)} of ${fmtH(q.targetH)} h`,
        why: mergeOrg62
          ? `You ~${dur(Math.max(confirmMin, 30))} to confirm ${plural(handedOff.length, 'handed-off row')} (~${fmtH(handedOffH)} h on the ${canvasWord}) · ${org62Since}`
          : handedOff.length
            ? `You ~${dur(Math.max(confirmMin, 30))} to confirm ${handedOff.length} rows`
            : `${fmtH(round1(q.targetH - loggedH))} h to go`,
        state: daysLeft <= 3 ? 'risk' : null,
        stateLabel: `Due ${whenLabel(qDue, nowMs, tz)}`,
        due: q.due,
        youMin: lead ? c.handsOn(lead) : null,
        verb: verb(handedOff.length ? `Confirm ${handedOff.length}` : 'Open Activity', 'confirm', TIME_WEEK),
        href: TIME_WEEK,
        entity: lead ? workEntity(lead) : { kind: 'activity_entry', id: logged[0]?.id ?? 'quarter', label: `${q.label} log` },
        item: lead ? { id: lead.id, version: lead.version } : null,
        progress: { done: loggedH, total: q.targetH, label: 'h' },
      }),
    });
  }

  // 3. Org62 Solutions Events not logged since a date (folded into the quarter row when that one is drawn).
  if (on('org62_unlogged') && handedOff.length && !mergeOrg62) {
    gaps.push({
      rule: 'org62_unlogged',
      consumes: confirmItem ? [confirmItem.id] : [],
      row: row({
        id: 'gap:org62_unlogged',
        kind: 'gap',
        title: lastLogged ? `Org62 ${loggedEvents(input.persona)}: none after ${md(toMs(`${lastLogged}T12:00:00Z`), 'UTC')}` : `Org62 ${loggedEvents(input.persona)}: nothing logged`,
        why: `${plural(handedOff.length, 'handed-off row')} · ~${fmtH(handedOffH)} h on the ${canvasWord}`,
        state: null,
        stateLabel: null,
        due: null,
        youMin: confirmItem ? c.handsOn(confirmItem) : null,
        verb: verb('Review', 'confirm', TIME_WEEK),
        href: TIME_WEEK,
        entity: confirmItem ? workEntity(confirmItem) : { kind: 'activity_entry', id: handedOff[0]!.id, label: 'Handed-off rows' },
        item: confirmItem ? { id: confirmItem.id, version: confirmItem.version } : null,
      }),
    });
  }

  // 3b. 2026-11-13 audit C2: DC requests and VDP use cases waiting for a logging canvas. They are not rows, so the
  // quarter and Org62 rows never count them; without this row, Log & fix read "Nothing missing" over 55 waiting claims.
  const wait = on('canvas_waiting') ? input.waitingForCanvas : undefined;
  if (wait && (wait.dcs > 0 || wait.useCases > 0)) {
    const what = [wait.dcs ? plural(wait.dcs, 'DC request') : null, wait.useCases ? plural(wait.useCases, 'VDP use case') : null].filter(Boolean).join(' and ');
    gaps.push({
      rule: 'canvas_waiting',
      consumes: [],
      row: row({
        id: 'gap:canvas_waiting',
        kind: 'gap',
        title: `Log ${what}`,
        why: wait.dcs && !wait.useCases ? 'Waiting for your next logging canvas with rows, or Log DCs now on Activity' : 'Waiting for your next logging canvas with rows (Activity ▸ Log it)',
        state: null,
        stateLabel: null,
        due: null,
        youMin: null,
        verb: verb('Open Activity', 'open', TIME_WEEK),
        href: TIME_WEEK,
        entity: { kind: 'activity_entry', id: 'canvas_waiting', label: 'Waiting for a canvas' },
      }),
    });
  }

  // 4. DC gaps. DC-31: exactly the Deals Log & fix rows (getDeals `needs`: open opps with strong evidence and no DC of
  // mine, set-asides applied), so Home and Deals count the same opps. Without them (an older caller), the missed-opp
  // findings with no DC request, as before.
  const dcNeeds = on('missed_dc') ? input.dcNeeds : undefined;
  const gapOpps = (dcNeeds ?? []).flatMap((n) => n.opps.map((g) => ({ n, g })));
  if (dcNeeds && gapOpps.length) {
    const dcItems = c.live.filter((w) => /\brequest (a )?dc\b/i.test(w.title));
    const first = dcNeeds[0]!;
    const top = [...new Set(dcNeeds.map((n) => shortAccount(n.accountName)))].slice(0, 3);
    const href = dcNeeds.length === 1 ? first.verb.href : '/deals';
    gaps.push({
      rule: 'missed_dc',
      consumes: dcItems.map((w) => w.id),
      subjects: gapOpps.map((x) => x.g.oppId),
      row: row({
        id: 'gap:missed_dc',
        kind: 'gap',
        title: gapOpps.length === 1 ? `Claim DC on ${gapOpps[0]!.g.oppName}` : `Claim DC on ${plural(gapOpps.length, 'opp')}`,
        why: dcNeeds.length === 1 ? first.why : `${plural(gapOpps.length, 'opp')} without your DC · ${top.join(', ')}`,
        state: null,
        stateLabel: null,
        due: null,
        youMin: null,
        verb: verb('Review', 'open', href),
        href,
        entity: dcItems[0] ? workEntity(dcItems.sort(byRank)[0]!) : { kind: 'opportunity', id: gapOpps[0]!.g.oppId, label: 'DC gaps' },
      }),
    });
  }
  const missed = on('missed_dc') && !dcNeeds ? input.missedOpps.filter((m) => m.status === 'new') : [];
  if (missed.length) {
    const claims = missed.filter((m) => m.verdict === 'claim').sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
    const top = [...new Set(claims.map((m) => shortAccount(m.accountName)))].slice(0, 3);
    const dcItems = c.live.filter((w) => /\brequest (a )?dc\b/i.test(w.title));
    gaps.push({
      rule: 'missed_dc',
      consumes: dcItems.map((w) => w.id),
      subjects: missed.map((m) => m.id),
      row: row({
        id: 'gap:missed_dc',
        kind: 'gap',
        title: `Request DC on ${plural(missed.length, 'missed opp')}`,
        why: top.length ? `Top Claim opps: ${top.join(', ')}` : `${plural(missed.length, 'opp')} with no DC request`,
        state: null,
        stateLabel: null,
        due: null,
        youMin: null,
        verb: verb('Review', 'open', '/deals/missed'),
        href: '/deals/missed',
        entity: dcItems[0] ? workEntity(dcItems.sort(byRank)[0]!) : { kind: 'missed_opp', id: (claims[0] ?? missed[0])!.id, label: 'Missed opps' },
      }),
    });
  }

  // 5. Activity rows that need your input.
  // oldest first, the same order on every DataSource; their issues in plain English (never the engine's canvas notes)
  const needs = on('needs_input') ? input.activity.filter((a) => a.status === 'needs_input').sort((a, b) => a.start.localeCompare(b.start) || a.description.localeCompare(b.description)) : [];
  if (needs.length) {
    const it = findItem((w) => /needs-input/i.test(w.title));
    gaps.push({
      rule: 'needs_input',
      consumes: it ? [it.id] : [],
      row: row({
        id: 'gap:needs_input',
        kind: 'gap',
        title: `Resolve ${plural(needs.length, 'needs-input row')}`,
        why: clip(needs.map((a) => (a.issues[0] ? (plainIssue(a.issues[0], a) ?? a.description) : a.description)).filter((v, i, xs) => xs.indexOf(v) === i).join(' · '), 70),
        state: null,
        stateLabel: null,
        due: null,
        youMin: it ? c.handsOn(it) : needs.length * 3,
        verb: verb('Map', 'map', TIME_WEEK),
        href: TIME_WEEK,
        entity: it ? workEntity(it) : { kind: 'activity_entry', id: needs[0]!.id, label: 'Needs-input rows' },
        item: it ? { id: it.id, version: it.version } : null,
      }),
    });
  }

  // 6. Unsubmitted expenses (travel items).
  for (const w of on('expenses') ? c.live.filter((x) => x.kind === 'travel' && /(expense|concur|reimburs)/i.test(`${x.title} ${x.why}`)).sort(byRank) : []) {
    gaps.push({
      rule: 'expenses',
      consumes: [w.id],
      row: row({
        id: `gap:expenses:${w.id}`,
        kind: 'gap',
        title: w.title,
        why: clip(w.why || 'Not submitted yet', 60),
        state: w.due && toMs(w.due) < c.todayStart ? 'overdue' : null,
        stateLabel: w.due && toMs(w.due) < c.todayStart ? 'Overdue' : null,
        due: w.due,
        youMin: c.handsOn(w),
        verb: verb(/concur/i.test(w.title) ? 'Open Concur' : 'Open', 'open', w.sources.find((s) => s.url)?.url ?? itemHref(w.id)),
        href: itemHref(w.id),
        entity: workEntity(w),
        item: { id: w.id, version: w.version },
      }),
    });
  }

  // D-55: the persona's own Log & fix rows (the AE's forecast notes, deal roles, missing Specialist Forecasts)
  gaps.push(...personaGaps(input, nowMs).filter((g) => on(g.rule)));

  // the state first (overdue, blocked, at risk), then the persona's own rule order (an AE's forecast duty before
  // logging, so the rows a capped section hides are the Week ones "See all" opens); rules outside the preset last
  const order: Record<string, number> = { overdue: 0, blocked: 1, risk: 2 };
  const ruleAt = (r: GapRuleId) => {
    const i = input.persona?.gapRules.indexOf(r) ?? -1;
    return i < 0 ? 99 : i;
  };
  const decisions = decisionIndex(input.decisions);
  return gaps.map((g) => withResolve(g, decisions, input.now)).sort((a, b) => (order[a.row.state ?? ''] ?? 9) - (order[b.row.state ?? ''] ?? 9) || ruleAt(a.rule) - ruleAt(b.rule));
}

// ---------------------------------------------------------------------------
// Do now
// ---------------------------------------------------------------------------

function draftLine(d: Draft): HomeDraftLine {
  const dest = d.destination;
  let who: string;
  let text: string;
  if (dest.kind === 'email') {
    who = firstName(dest.to[0]?.name ?? dest.to[0]?.email.split('@')[0] ?? 'Email');
    text = dest.subject;
  } else if (dest.kind === 'action') {
    who = actionApp(dest.action);
    text = dest.target.label;
  } else {
    const name = dest.channelName;
    who = name.startsWith('#') ? name : firstName(name.replace(/^Group DM\s*·\s*/i, '').split(',')[0] ?? name);
    text = (d.plainText.split('\n').find((l) => l.trim()) ?? '').replace(/^@[\w .'-]+?:\s*/, '');
  }
  return { draftId: d.id, who, source: dest.kind === 'email' ? 'gmail' : dest.kind === 'action' ? actionSource(dest.action) : 'slack', text: clip(text, 90), at: d.createdAt, ready: d.status === 'ready' };
}

function eventNoun(title: string): string {
  const m = /\b(QBR|review|demo|workshop|presentation|readout|walkthrough|kickoff|onsite|call|sync|session|meeting)\b/i.exec(title);
  if (!m) return 'meeting';
  return m[1] === 'QBR' ? 'QBR' : m[1]!.toLowerCase();
}

function accountOfEvent(c: Ctx, e: CalendarEvent): string {
  const acc = e.accountId ? c.input.accounts.find((a) => a.id === e.accountId) : undefined;
  if (acc) return shortAccount(acc.name);
  const ini = c.input.initiatives.find((i) => i.targetEventId === e.id);
  const iacc = ini?.accountId ? c.input.accounts.find((a) => a.id === ini.accountId) : undefined;
  return iacc ? shortAccount(iacc.name) : '';
}

function prepFor(c: Ctx, w: WorkItem): HomeCard['prep'] {
  const e = w.servesEventId ? c.eventById.get(w.servesEventId) : undefined;
  if (!e) return null;
  const ini = w.initiativeId ? c.iniById.get(w.initiativeId) : undefined;
  const done = c.input.items
    .filter((x) => x.id !== w.id && x.state === 'done' && x.doneAt && (x.servesEventId === e.id || (ini && x.initiativeId === ini.id)) && c.nowMs - toMs(x.doneAt) <= PREP_DONE_WINDOW_MS)
    .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))
    .slice(0, 2);
  const steps = [...done.map((x) => ({ label: corePhrase(x.title), done: true })), { label: corePhrase(c.nbaOf(w)?.title ?? w.title), done: false }];
  const noun = eventNoun(e.title);
  return { label: `${noun === 'QBR' ? 'QBR' : noun.charAt(0).toUpperCase() + noun.slice(1)} prep`, steps };
}

function itemVerb(c: Ctx, w: WorkItem): HomeVerb {
  const n = c.nbaOf(w);
  const d = c.draftOf(w);
  if (n?.verb === 'start_in_claude') return verb(n.primaryLabel || 'Open in Claude', 'open_in_claude', null, w.id);
  if (d) return d.status === 'ready' ? verb('Review draft', 'review', `/outbox?draft=${d.id}`, d.id) : verb('Send draft', 'send', itemHref(w.id), d.id);
  if (n?.verb === 'nudge') return verb('Nudge', 'nudge', itemHref(w.id), w.id);
  if (n?.verb === 'review' || n?.verb === 'review_deliverable') return verb(n.primaryLabel || 'Review', 'open', itemHref(w.id), w.id);
  if (n?.verb === 'log') return verb(n.primaryLabel || 'Log', 'confirm', TIME_WEEK, w.id);
  if (n?.verb === 'run_tool') return verb(n.primaryLabel || 'Run tool', 'open', itemHref(w.id), w.id);
  if (n?.verb === 'schedule') return verb(n.primaryLabel || 'Schedule', 'plan', itemHref(w.id), w.id);
  if (w.kind === 'ask' || REPLY_TITLE.test(w.title)) return verb('Draft reply', 'draft', itemHref(w.id), w.id);
  return verb('Open', 'open', itemHref(w.id), w.id);
}

function nowCard(c: Ctx, w: WorkItem): NowCard {
  const runs = w.runIds.map((id) => c.input.agentRuns.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r);
  const order = ['waiting_on_you', 'running', 'failed', 'done_review', 'queued', 'stale', 'done'];
  runs.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  const draft = c.draftOf(w);
  return {
    item: w,
    nba: c.nbaOf(w),
    draft,
    run: runs[0] ?? null,
    proposals: c.input.proposals.filter((p) => p.status === 'pending' && ((p.entity.type === 'work_item' && p.entity.id === w.id) || (draft && p.entity.type === 'draft' && p.entity.id === draft.id))),
  };
}

function itemCard(c: Ctx, w: WorkItem, rank: number): HomeCard {
  const n = c.nbaOf(w);
  const d = c.draftOf(w);
  const sb = msOrNull(w.startBy);
  const due = msOrNull(w.due);
  const prep = prepFor(c, w);
  const ini = w.initiativeId ? c.iniById.get(w.initiativeId) : undefined;
  let state: HomeState | null = null;
  let stateLabel: string | null = null;
  // At most one color signal per card: an AI-drafted card keeps its violet marker unless it is late.
  if (sb !== null && isToday(sb, c) && w.state !== 'in_progress' && (!d || sb <= c.nowMs)) {
    state = sb > c.nowMs ? 'risk' : 'overdue';
    stateLabel = sb > c.nowMs ? `Start by ${hm(sb, c.tz)}` : `Start now (${hm(sb, c.tz)})`;
  } else if (due !== null && due < c.nowMs) {
    state = 'overdue';
    stateLabel = `Due ${whenLabel(due, c.nowMs, c.tz)}`;
  }
  return {
    rank,
    kind: 'item',
    id: w.id,
    entity: workEntity(w),
    tag: shortAccount(w.refs.account?.label) || (ini ? clip(ini.title.replace(/\s*\([^)]*\)/g, ''), 28) : null),
    title: n?.status === 'ready' ? n.title : w.title,
    why: n?.why ?? w.why ?? null,
    state,
    stateLabel,
    aiLabel: d ? (d.status === 'ready' ? 'Drafted for you' : 'Draft ready') : null,
    prep,
    context: prep ? null : ini ? `Initiative: ${ini.title.replace(/\s*\([^)]*\)/g, '')}` : null,
    drafts: [],
    draftIds: [],
    youMin: c.handsOn(w),
    agentMin: agentMin(w),
    due: w.due,
    foot: due !== null ? `Due ${whenLabel(due, c.nowMs, c.tz)}` : null,
    verb: itemVerb(c, w),
    now: nowCard(c, w),
    carried: c.carried.get(w.id) ?? null,
  };
}

function outboxCard(drafts: Draft[], rank: number): HomeCard {
  const n = drafts.length;
  return {
    rank,
    kind: 'outbox',
    id: 'outbox',
    entity: { kind: 'draft', id: drafts[0]!.id, label: `Approve ${plural(n, 'draft')}` },
    tag: 'Outbox',
    title: `Approve ${plural(n, 'draft')}`,
    why: null,
    state: null,
    stateLabel: null,
    aiLabel: 'Drafted for you',
    prep: null,
    context: null,
    drafts: drafts.slice(0, 3).map(draftLine),
    draftIds: drafts.map((d) => d.id),
    youMin: approveMin(n),
    agentMin: 0,
    due: null,
    foot: 'Nothing sends until you approve',
    verb: verb(`Review ${n}`, 'review', '/outbox'),
    now: null,
    carried: null,
  };
}

type Need = { kind: 'item'; item: WorkItem } | { kind: 'outbox'; drafts: Draft[] } | { kind: 'gap'; gap: Gap };

// ---------------------------------------------------------------------------
// Rows for sections
// ---------------------------------------------------------------------------

function replyRows(c: Ctx, taken: Set<string>, outboxDraftIds: Set<string>): HomeRow[] {
  const horizon = addLocalDays(c.nowMs, HOME_CAPS.aheadDays + 1, c.tz);
  const rows = c.live
    .filter((w) => !taken.has(w.id) && !w.isBackground && w.state !== 'waiting_on_others')
    .filter((w) => {
      const n = c.nbaOf(w);
      const d = c.draftOf(w);
      if (d && outboxDraftIds.has(d.id)) return false;
      const replyish = ['send', 'answer', 'review', 'review_deliverable'].includes(n?.verb ?? '') || w.kind === 'ask' || !!d || REPLY_TITLE.test(w.title);
      const due = msOrNull(w.due);
      return replyish && (due === null || due < horizon);
    })
    .sort((a, b) => {
      const ba = c.blockedBy(a) ? 0 : 1;
      const bb = c.blockedBy(b) ? 0 : 1;
      return (a.due ?? '9').localeCompare(b.due ?? '9') || ba - bb || byRank(a, b);
    });
  return rows.map((w) => {
    const blocker = c.blockedBy(w);
    const d = c.draftOf(w);
    const due = msOrNull(w.due);
    const overdue = due !== null && due < c.nowMs;
    let state: HomeState | null = null;
    let stateLabel: string | null = null;
    let why = due !== null ? `Due ${whenLabel(due, c.nowMs, c.tz)}` : clip(w.why, 60);
    if (blocker) {
      state = 'blocked';
      stateLabel = 'Blocked';
      why = `~${dur(c.handsOn(w))} once ${firstName(blocker.waiting?.who?.name) || 'they'} answers`;
    } else if (overdue) {
      state = 'overdue';
      stateLabel = 'Overdue';
    } else if (d?.status === 'ready') {
      state = 'ai';
      stateLabel = 'Drafted';
    }
    return row({
      id: w.id,
      kind: d ? 'draft' : 'item',
      title: w.title,
      why,
      state,
      stateLabel,
      due: w.due,
      youMin: c.handsOn(w),
      verb: itemVerb(c, w),
      href: itemHref(w.id),
      entity: workEntity(w),
      item: { id: w.id, version: w.version },
    });
  });
}

interface Dated {
  row: HomeRow;
  at: number;
  cf: boolean;
  /** A meeting whose prep is not ready yet. */
  prepMissing?: boolean;
}

function aheadRows(c: Ctx, taken: Set<string>, outboxDraftIds: Set<string>): Dated[] {
  const { tz, nowMs } = c;
  const winEnd = addLocalDays(nowMs, HOME_CAPS.aheadDays + 1, tz);
  const out: Dated[] = [];
  const merged = new Set<string>();
  const notStarted = (w: WorkItem) => (w.state === 'open' || w.state === 'reopened') && (w.deliverable?.judgment?.verdict ?? 'not_started') === 'not_started';

  // Meetings that matter in the next 14 days (linked: prep, a served item, or an initiative's target).
  const targets = new Set(c.input.initiatives.map((i) => i.targetEventId).filter(Boolean));
  const servedBy = new Map<string, WorkItem[]>();
  for (const w of c.live) if (w.servesEventId) servedBy.set(w.servesEventId, [...(servedBy.get(w.servesEventId) ?? []), w]);
  for (const e of c.input.events) {
    const s = toMs(e.start);
    if (s < c.todayEnd || s >= winEnd || !isBusyEvent(e)) continue;
    const linked = [...(e.prep?.workItemId ? [c.byId.get(e.prep.workItemId)] : []), ...(servedBy.get(e.id) ?? [])].filter((w): w is WorkItem => !!w && LIVE.has(w.state));
    if (!e.prep && !targets.has(e.id) && !linked.length) continue;
    if (linked.length && linked.every((w) => taken.has(w.id)) && !e.isCustomerFacing && !targets.has(e.id)) continue;
    const prepItem = linked.find((w) => !taken.has(w.id)) ?? linked[0] ?? null;
    for (const w of linked) if (!taken.has(w.id)) merged.add(w.id);
    const days = daysBetween(nowMs, s, tz);
    let state: HomeState | null = null;
    let stateLabel: string | null = null;
    let note = e.prep?.label?.replace(/\s*›\s*$/, '') ?? '';
    if (prepItem?.state === 'waiting_on_others') note = `${note ? `${note}, ` : ''}waiting on ${firstName(prepItem.waiting?.who?.name) || 'others'}`;
    else if (prepItem && !taken.has(prepItem.id) && notStarted(prepItem) && !e.prep?.ready && days <= 7) {
      state = 'risk';
      stateLabel = 'Not started';
    }
    out.push({
      at: s,
      cf: e.isCustomerFacing,
      prepMissing: !!e.prep && !e.prep.ready,
      row: row({
        id: `event:${e.id}`,
        kind: 'event',
        title: e.title,
        why: [`${wd(s, tz)} ${md(s, tz)}`, note].filter(Boolean).join(' · '),
        state,
        stateLabel,
        due: e.start,
        youMin: prepItem ? c.handsOn(prepItem) : null,
        verb: prepItem ? (state === 'risk' ? verb(c.nbaOf(prepItem)?.primaryLabel || 'Start prep', prepItem && c.nbaOf(prepItem)?.verb === 'start_in_claude' ? 'open_in_claude' : 'plan', itemHref(prepItem.id), prepItem.id) : verb('Open', 'open', itemHref(prepItem.id), prepItem.id)) : verb('Open', 'open', '/today'),
        href: prepItem ? itemHref(prepItem.id) : '/today',
        entity: prepItem ? workEntity(prepItem) : { kind: 'calendar_event', id: e.id, label: e.title },
        item: prepItem && prepItem.state !== 'waiting_on_others' ? { id: prepItem.id, version: prepItem.version } : null,
      }),
    });
  }

  // Dated work (and overdue work) not listed anywhere else.
  for (const w of c.live) {
    if (taken.has(w.id) || merged.has(w.id) || w.isBackground || w.state === 'waiting_on_others') continue;
    const d = c.draftOf(w);
    if (d && outboxDraftIds.has(d.id)) continue;
    const due = msOrNull(w.due);
    if (due === null || due >= winEnd || (due >= c.todayStart && due < c.todayEnd)) continue;
    const overdue = due < c.todayStart;
    const days = daysBetween(nowMs, due, tz);
    const risky = !overdue && notStarted(w) && days <= 7 && (w.kind === 'deliverable' || !!w.servesEventId || c.handsOn(w) >= 30);
    const ini = w.initiativeId ? c.iniById.get(w.initiativeId) : undefined;
    const ctxLabel = shortAccount(w.refs.account?.label) || (ini ? clip(ini.title.replace(/\s*\([^)]*\)/g, ''), 30) : '');
    out.push({
      at: due,
      cf: w.signals.customerFacing,
      row: row({
        id: w.id,
        kind: 'item',
        title: w.title,
        why: [overdue ? `Was due ${whenLabel(due, nowMs, tz)}` : whenLabel(due, nowMs, tz), ctxLabel].filter(Boolean).join(' · '),
        state: overdue ? 'overdue' : risky ? 'risk' : null,
        stateLabel: overdue ? 'Overdue' : risky ? 'Not started' : null,
        due: w.due,
        youMin: c.handsOn(w),
        verb: risky && w.kind === 'deliverable' ? verb('Plan', 'plan', itemHref(w.id), w.id) : itemVerb(c, w),
        href: itemHref(w.id),
        entity: workEntity(w),
        item: { id: w.id, version: w.version },
      }),
    });
  }

  // Deals closing in the window.
  for (const o of c.input.opps) {
    if (!o.isOpen || !(o.isMine || o.dcAssigned) || !o.closeDate) continue; // mine: on the team or holding a DC
    const at = toMs(`${o.closeDate}T12:00:00Z`);
    if (at < c.todayEnd || at >= winEnd) continue;
    const stage = /^(\d{2})/.exec(o.stage)?.[1];
    out.push({
      at,
      cf: true,
      row: row({
        id: `opp:${o.id}`,
        kind: 'event',
        title: o.name.replace(/\s+-\s+/, ': '),
        why: [`Closes ${wd(at, 'UTC')} ${md(at, 'UTC')}`, o.amount ? usdShort(o.amount) : null, stage ? `stage ${stage}` : null].filter(Boolean).join(' · '),
        state: null,
        stateLabel: null,
        due: new Date(at).toISOString(),
        youMin: null,
        verb: verb('Open deal', 'open', `/deals/${o.accountId}`),
        href: `/deals/${o.accountId}`,
        entity: { kind: 'opportunity', id: o.id, label: o.name },
      }),
    });
  }

  const rank = (r: HomeRow) => (r.state === 'overdue' ? 0 : r.state === 'risk' ? 1 : 2);
  return out.sort((a, b) => rank(a.row) - rank(b.row) || a.at - b.at || a.row.id.localeCompare(b.row.id));
}

function chaseRows(c: Ctx, taken: Set<string>, blocks: Map<string, WorkItem>): { rows: HomeRow[]; count: number; names: string[] } {
  const { tz, nowMs } = c;
  const rows: HomeRow[] = [];
  const names: string[] = [];
  let count = 0;
  const waiting = c.live.filter((w) => w.state === 'waiting_on_others' && !taken.has(w.id)).sort((a, b) => (a.waiting?.since ?? a.updatedAt).localeCompare(b.waiting?.since ?? b.updatedAt));
  for (const w of waiting) {
    count++;
    const who = firstName(w.waiting?.who?.name ?? w.counterparty?.name);
    if (who && !names.includes(who)) names.push(who);
    const since = msOrNull(w.waiting?.since ?? null);
    const blocked = blocks.get(w.id);
    const due = msOrNull(w.due);
    const parts = [since !== null ? `Asked ${daysBetween(since, nowMs, tz) === 0 ? hm(since, tz) : `${wd(since, tz)} ${md(since, tz)}`}` : null];
    if (blocked) parts.push(blocked.counterparty ? `blocks your ${firstName(blocked.counterparty.name)} answer` : `blocks ${lowerFirst(clip(corePhrase(blocked.title), 32))}`);
    else if (due !== null && isToday(due, c)) parts.push('due today');
    else if (due !== null) parts.push(`due ${whenLabel(due, nowMs, tz)}`);
    const n = c.nbaOf(w);
    const d = c.draftOf(w);
    rows.push(
      row({
        id: w.id,
        kind: 'waiting',
        title: w.title,
        why: parts.filter(Boolean).join(' · ') || clip(w.waiting?.reason ?? w.why, 60),
        state: due !== null && due < nowMs ? 'overdue' : null,
        stateLabel: due !== null && due < nowMs ? 'Late' : null,
        due: w.due,
        youMin: d ? 2 : null,
        verb: d ? verb('Nudge', 'nudge', d.status === 'ready' ? `/outbox?draft=${d.id}` : itemHref(w.id), d.id) : verb(n?.verb === 'nudge' ? n.primaryLabel || 'Nudge' : 'Nudge', 'nudge', itemHref(w.id), w.id),
        href: itemHref(w.id),
        entity: workEntity(w),
        item: { id: w.id, version: w.version },
      }),
    );
  }

  // Promises going stale: undated commitments, oldest first; ≥ FOLD_AT in one initiative fold into one row.
  const promises = c.live
    .filter((w) => !taken.has(w.id) && w.kind === 'commitment' && !w.due && w.state !== 'waiting_on_others' && (w.isBackground || w.ageDays >= PROMISE_MIN_AGE_D))
    .sort((a, b) => b.ageDays - a.ageDays || a.id.localeCompare(b.id));
  const byIni = new Map<string, WorkItem[]>();
  for (const w of promises) if (w.initiativeId && !w.isBackground) byIni.set(w.initiativeId, [...(byIni.get(w.initiativeId) ?? []), w]);
  const folded = new Set<string>();
  const promiseRows: Array<{ age: number; row: HomeRow }> = [];
  for (const [iniId, ws] of byIni) {
    if (ws.length < FOLD_AT) continue;
    const ini = c.iniById.get(iniId);
    for (const w of ws) folded.add(w.id);
    const acc = shortAccount(ws[0]!.refs.account?.label) || (ini ? clip(ini.title, 24) : '');
    promiseRows.push({
      age: Math.max(...ws.map((w) => w.ageDays)),
      row: row({
        id: `fold:${iniId}`,
        kind: 'promise',
        title: `${ws.length} ${acc ? `${acc} ` : ''}commitments, no dates`,
        why: clip(ws.map((w) => lowerFirst(clip(corePhrase(w.title), 32))).join(', '), 80),
        state: null,
        stateLabel: null,
        due: null,
        youMin: null,
        verb: verb('Set dates', 'open', ini ? `/initiatives/${iniId}` : '/work?tab=promises'),
        href: ini ? `/initiatives/${iniId}` : '/work?tab=promises',
        entity: ini ? { kind: 'initiative', id: ini.id, label: ini.title } : workEntity(ws[0]!),
        dateLabel: 'no dates',
      }),
    });
  }
  for (const w of promises) {
    if (folded.has(w.id)) continue;
    const to = firstName(w.counterparty?.name);
    promiseRows.push({
      age: w.ageDays,
      row: row({
        id: w.id,
        kind: 'promise',
        title: w.title,
        why: to ? `You said you would · to ${to}` : 'You said you would',
        state: w.ageDays >= PROMISE_RISK_AGE_D ? 'risk' : null,
        stateLabel: w.ageDays >= PROMISE_RISK_AGE_D ? `${w.ageDays} d` : null,
        due: null,
        youMin: c.handsOn(w),
        verb: verb('Do or drop', 'open', itemHref(w.id), w.id),
        href: itemHref(w.id),
        entity: workEntity(w),
        item: { id: w.id, version: w.version },
        dateLabel: `${w.ageDays} d`,
      }),
    });
  }
  promiseRows.sort((a, b) => b.age - a.age);
  for (const p of promiseRows) {
    rows.push(p.row);
    count += p.row.id.startsWith('fold:') ? Number(p.row.title.split(' ')[0]) || 1 : 1;
  }
  return { rows, count, names };
}

function initiativeRows(c: Ctx, riskItems: Set<string>): HomeRow[] {
  const { tz, nowMs } = c;
  const out: Array<{ order: number; at: number; row: HomeRow }> = [];
  for (const ini of c.input.initiatives) {
    if (ini.status !== 'active' && ini.status !== 'paused') continue;
    const items = c.live.filter((w) => w.initiativeId === ini.id);
    const target = ini.targetEventId ? c.eventById.get(ini.targetEventId) : undefined;
    const todayItems = items.filter((w) => !w.isBackground && c.todayScoped(w) && !c.blockedBy(w) && !c.heldByMeeting(w));
    const targetToday = !!target && target.isCustomerFacing && isToday(toMs(target.start), c) && toMs(target.end) > nowMs;
    const undated = items.filter((w) => w.kind === 'commitment' && !w.due && !w.isBackground);
    const nextItem = items.filter((w) => w.due && !w.isBackground).sort((a, b) => a.due!.localeCompare(b.due!))[0] ?? null;
    let heat: HomeRow['heat'] = null;
    if (ini.status === 'paused') heat = 'paused';
    else if (todayItems.length || targetToday) heat = 'hot';
    else if (items.some((w) => riskItems.has(w.id))) heat = 'at_risk';
    else if (undated.length >= FOLD_AT) heat = 'drifting';
    const label = { hot: 'Today', at_risk: 'At risk', drifting: 'Drifting', paused: 'Paused' } as const;
    let dateLabel: string;
    let at = Number.MAX_SAFE_INTEGER;
    if (heat === 'hot') {
      const t = targetToday ? toMs(target!.start) : Math.min(...todayItems.map((w) => msOrNull(w.due) ?? msOrNull(w.startBy) ?? c.todayEnd));
      dateLabel = hm(t, tz);
      at = t;
    } else if (heat === 'paused') {
      const oldest = Math.max(0, ...items.map((w) => w.ageDays));
      dateLabel = oldest ? `${oldest} d` : 'paused';
    } else if (nextItem) {
      at = toMs(nextItem.due!);
      dateLabel = daysBetween(nowMs, at, tz) < 7 ? wd(at, tz) : md(at, tz);
      if (at < c.todayStart) dateLabel = md(at, tz);
    } else dateLabel = 'no date';
    const next = heat === 'paused' ? 'stale promise' : nextItem ? clip(lowerFirst(corePhrase(c.nbaOf(nextItem)?.title ?? nextItem.title)), 34) : undated.length ? `${plural(undated.length, 'undated commitment')}` : clip(ini.purpose, 34);
    const order = heat === 'hot' ? 0 : heat === 'at_risk' ? 1 : heat === 'drifting' ? 3 : heat === 'paused' ? 4 : 2;
    out.push({
      order,
      at,
      row: row({
        id: `ini:${ini.id}`,
        kind: 'initiative',
        title: ini.title.replace(/\s*\([^)]*\)/g, ''),
        why: next,
        state: heat === 'hot' ? 'now' : heat === 'at_risk' || heat === 'drifting' ? 'risk' : null,
        stateLabel: heat ? label[heat] : null,
        due: nextItem?.due ?? null,
        youMin: null,
        verb: verb('Open', 'open', `/initiatives/${ini.id}`),
        href: `/initiatives/${ini.id}`,
        entity: { kind: 'initiative', id: ini.id, label: ini.title },
        heat,
        dateLabel,
      }),
    });
  }
  return out.sort((a, b) => a.order - b.order || a.at - b.at || a.row.title.localeCompare(b.row.title)).map((x) => x.row);
}

// ---------------------------------------------------------------------------
// Ribbon, strip, masthead, footer
// ---------------------------------------------------------------------------

function buildRibbon(c: Ctx, cap: { free: Interval[]; youMinToday: number; pullForward: HomeCapacity['pullForward'] }): HomeRibbon {
  const { tz, nowMs } = c;
  const targets = new Set(c.input.initiatives.map((i) => i.targetEventId).filter(Boolean));
  const evs = c.todayEvents.filter((e) => e.attendance !== 'cancelled');
  const firstEv = evs.find((e) => isBusyEvent(e) || e.attendance === 'declined');
  const floorHour = (ms: number) => ms - (((ms - dayStart(ms, tz)) % HOUR_MS) + HOUR_MS) % HOUR_MS;
  let start = floorHour(Math.min(nowMs, firstEv ? toMs(firstEv.start) : nowMs));
  start = Math.max(start, floorHour(c.wStart));
  if (start >= c.wEnd) start = floorHour(c.wStart);
  const lastEnd = Math.max(c.wEnd, ...evs.filter(isBusyEvent).map((e) => toMs(e.end)).filter((e) => e < c.todayEnd));
  const end = lastEnd;
  const blocks: HomeRibbonBlock[] = [];
  for (const e of evs) {
    const s = toMs(e.start);
    const en = toMs(e.end);
    if (en <= start || s >= end) continue;
    if (e.attendance === 'declined') {
      blocks.push({ id: e.id, kind: 'declined', start: e.start, end: e.end, title: 'declined', fullTitle: `${hm(s, tz)} ${e.title} · declined`, itemId: null, eventId: e.id, state: null, note: null, star: false });
      continue;
    }
    const nowIn = !c.plan && s <= nowMs && nowMs < en;
    const prepMissing = !!e.prep && !e.prep.ready && e.isCustomerFacing && en > nowMs;
    const note = nowIn ? e.prep?.label?.replace(/\s*›\s*$/, '') ?? null : prepMissing ? 'prep' : null;
    blocks.push({
      id: e.id,
      kind: 'meeting',
      start: e.start,
      end: e.end,
      title: shortEvent(e.title),
      fullTitle: `${hm(s, tz)} ${e.title} · ${dur((en - s) / MIN_MS)}${e.prep ? ` · prep: ${e.prep.label.replace(/\s*›\s*$/, '')}${e.prep.ready ? ' (ready)' : ''}` : ''}`,
      itemId: e.prep?.workItemId ?? null,
      eventId: e.id,
      state: nowIn ? 'now' : prepMissing ? 'risk' : null,
      note,
      star: targets.has(e.id),
    });
  }
  // Open blocks: free time left after today's hands-on work, in order. The biggest one carries the pull-forward hint.
  let need = cap.youMinToday * MIN_MS;
  const open: Interval[] = [];
  for (const f of cap.free) {
    const take = Math.min(need, f.e - f.s);
    need -= take;
    const s = f.s + take;
    if (f.e - s >= OPEN_BLOCK_MIN * MIN_MS) open.push({ s: Math.ceil(s / (5 * MIN_MS)) * 5 * MIN_MS, e: f.e });
  }
  const biggest = open.reduce<Interval | null>((b, i) => (!b || i.e - i.s >= b.e - b.s ? i : b), null);
  // Only one open block is drawn: the biggest (latest on ties), which suggests the pull-forward work.
  for (const o of biggest ? [biggest] : []) {
    const pf = o === biggest ? cap.pullForward[0] : undefined;
    blocks.push({
      id: `open:${o.s}`,
      kind: 'open',
      start: new Date(o.s).toISOString(),
      end: new Date(o.e).toISOString(),
      title: `${hm(o.s, tz)}–${hm(o.e, tz)} open`,
      fullTitle: `${hm(o.s, tz)}–${hm(o.e, tz)} open${pf ? `. Pull forward if you like: ${pf.title} (~${dur(pf.youMin)})` : ''}`,
      itemId: pf?.itemId ?? null,
      eventId: null,
      state: null,
      note: pf ? `Pull forward: ${clip(corePhrase(pf.title), 40)} ~${dur(pf.youMin)}` : null,
      star: false,
    });
  }
  blocks.sort((a, b) => a.start.localeCompare(b.start));
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), now: new Date(nowMs).toISOString(), blocks };
}

function buildStrip(c: Ctx, dated: Array<{ at: number; label: string; risk: boolean; cf: boolean; meeting: boolean }>): HomeAheadDay[] {
  const { tz, nowMs } = c;
  const days: HomeAheadDay[] = [];
  const keys: string[] = [];
  for (let i = 1; i <= HOME_CAPS.aheadDays; i++) {
    const s = addLocalDays(nowMs, i, tz);
    keys.push(dayKey(s, tz));
    const list = dated.filter((d) => dayKey(d.at, tz) === dayKey(s, tz));
    const weekday = zoned(s, tz).weekday;
    days.push({
      date: dayKey(s, tz),
      count: list.length,
      risk: list.filter((d) => d.risk).length,
      weekend: weekday === 0 || weekday === 6,
      big: false,
      summary: `${wd(s, tz)} ${md(s, tz)}: ${list.length ? list.map((d) => `${clip(d.label, 48)}${d.risk ? ' (at risk)' : ''}`).join(' · ') : 'nothing'}`,
    });
  }
  // The big day: most customer-facing things, then most at risk, then earliest (needs ≥ 2 things).
  let best = -1;
  let bestScore = 0;
  days.forEach((d, i) => {
    const cf = dated.filter((x) => x.cf && x.meeting && dayKey(x.at, tz) === d.date).length;
    const score = cf * 100 + d.risk * 10 + d.count;
    if (d.count >= 2 && score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  if (best >= 0) days[best]!.big = true;
  return days;
}

function buildMasthead(c: Ctx, cards: HomeCard[], gaps: Gap[], ahead: Dated[], strip: HomeAheadDay[]): HomeMasthead {
  const { tz, nowMs, input } = c;
  const targets = new Set(input.initiatives.map((i) => i.targetEventId).filter(Boolean));
  // The focal meeting: today's remaining meeting that matters most.
  const scored = c.todayEvents
    .filter((e) => isBusyEvent(e) && toMs(e.end) > nowMs)
    .map((e) => ({ e, score: (e.isCustomerFacing ? 2 : 0) + (targets.has(e.id) ? 2 : 0) + (e.prep ? 1 : 0) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score || a.e.start.localeCompare(b.e.start));
  const focal = scored[0]?.e ?? null;
  const focalAcc = focal ? accountOfEvent(c, focal) : '';

  const dayWord = c.plan ? c.plan.label : 'Today';
  const sentence: HomeSegment[] = [];
  if (focal) {
    sentence.push(seg(`${dayWord} turns on the `), seg(hm(toMs(focal.start), tz), true), seg(' '));
    if (focalAcc) sentence.push(seg(focalAcc, true), seg(' '));
    sentence.push(seg(`${eventNoun(focal.title)}`));
  } else sentence.push(seg(dayWord));

  const clauses: HomeSegment[][] = [];
  let carriedN = 0;
  for (const card of cards) {
    if (card.kind === 'outbox') {
      // MIN-20: the card lists three drafts; the sentence counts every ready one, as the card's title does.
      clauses.push([seg(`approve ${plural(c.readyDrafts.length || card.drafts.length || 1, 'draft')}`)]);
      continue;
    }
    const w = card.now!.item;
    let phrase = lowerFirst(corePhrase(w.title));
    if (focalAcc) phrase = phrase.replace(new RegExp(`\\b${focalAcc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i'), '');
    const acc = shortAccount(w.refs.account?.label);
    const parts: HomeSegment[] = [];
    const idx = acc && acc !== focalAcc ? phrase.indexOf(acc) : -1;
    if (idx >= 0) parts.push(seg(phrase.slice(0, idx)), seg(acc, true), seg(phrase.slice(idx + acc.length)));
    else parts.push(seg(phrase));
    const sb = msOrNull(w.startBy);
    const due = msOrNull(w.due);
    // A meeting is the real deadline of prep work, so its start-by is what matters; otherwise the due time.
    const by = w.servesEventId && sb !== null && isToday(sb, c) && sb > nowMs ? sb : due !== null && isToday(due, c) ? due : null;
    // carried-over work is said once, after the list ("…, all carried over from today.")
    if (card.carried === 'from_today') carriedN++;
    else if (by !== null) parts.push(seg(' by '), seg(hm(by, tz), true, card.state === 'overdue' ? 'overdue' : null));
    // MIN-21: a past due date is overdue, never "by" (it read like a deadline still ahead).
    else if (due !== null && due < nowMs) parts.push(seg(', overdue since '), seg(whenLabel(due, nowMs, tz), true, 'overdue'));
    else if (due !== null) parts.push(seg(` by ${whenLabel(due, nowMs, tz)}`));
    clauses.push(parts);
  }
  const dayLower = c.plan ? (c.plan.label === 'Tomorrow' ? 'tomorrow' : c.plan.label) : 'today';
  if (!clauses.length && !focal && c.plan) sentence.splice(0, sentence.length, seg(`Nothing is lined up for ${dayLower} yet. `), seg('Think ahead', true), seg(' shows what is coming.'));
  else if (!clauses.length && !focal) sentence.splice(0, sentence.length, seg('Nothing needs you right now. '), seg('Think ahead', true), seg(' is a good use of the day.'));
  else if (!clauses.length) sentence.push(seg(c.plan ? ', and nothing else is lined up yet.' : ', and nothing else needs you today.'));
  else {
    sentence.push(seg(focal ? ': ' : ': '));
    clauses.forEach((cl, i) => {
      if (i > 0) sentence.push(seg(i === clauses.length - 1 ? (clauses.length > 2 ? ', and ' : ' and ') : ', '));
      sentence.push(...cl);
    });
    if (carriedN && carriedN === clauses.length) sentence.push(seg(clauses.length > 1 ? ', all carried over from today.' : ', carried over from today.'));
    else sentence.push(seg(carriedN ? `. ${carriedN === 1 ? 'One is' : `${carriedN} are`} carried over from today.` : '.'));
  }

  // Ahead: tomorrow, then the next big day.
  const aheadSegs: HomeSegment[] = [];
  const tomorrow = addLocalDays(nowMs, 1, tz);
  const tKey = dayKey(tomorrow, tz);
  const tGaps = gaps.filter((g) => g.row.due && dayKey(toMs(g.row.due), tz) === tKey);
  const tAhead = ahead.filter((a) => dayKey(a.at, tz) === tKey && (a.row.state === 'risk' || a.cf));
  const tParts: string[] = [];
  for (const g of tGaps.slice(0, 1)) {
    const p = g.row.progress;
    const name = g.rule === 'quarter_log' ? `${input.quarter.label.split(' ')[0]} log` : g.row.title;
    tParts.push(`${name} due ${hm(toMs(g.row.due!), tz)}${p ? `, ${fmtH(p.done)} of ${fmtH(p.total)} ${p.label ?? ''} in`.trimEnd() : ''}`);
  }
  for (const a of tAhead.slice(0, tParts.length ? 0 : 2)) tParts.push(`${a.row.kind === 'event' ? shortEvent(a.row.title) : clip(corePhrase(a.row.title), 40)}${a.row.kind === 'event' ? ` at ${hm(a.at, tz)}` : ''}`);
  // Planning, "tomorrow" is the day after the planned one: name it by its date so it never reads as the planned day.
  const tLabel = c.plan ? `${wd(tomorrow, tz)} ${md(tomorrow, tz)}:` : zoned(tomorrow, tz).weekday === 6 ? 'Saturday:' : 'Tomorrow:';
  if (tParts.length) aheadSegs.push(seg(tLabel, true), seg(` ${tParts.join('; ').replace(/…$/, '')}.`));
  const big = strip.find((d) => d.big && d.date !== tKey);
  if (big) {
    const bigMs = atLocal(Number(big.date.slice(0, 4)), Number(big.date.slice(5, 7)), Number(big.date.slice(8, 10)), 12, 0, tz);
    const evs = ahead.filter((a) => a.row.kind === 'event' && a.cf && dayKey(a.at, tz) === big.date).slice(0, 2);
    const list = evs.length ? evs : ahead.filter((a) => dayKey(a.at, tz) === big.date).slice(0, 2);
    if (list.length) {
      if (aheadSegs.length) aheadSegs.push(seg(' '));
      aheadSegs.push(seg(`${wd(bigMs, tz)} ${md(bigMs, tz)}:`, true), seg(' '));
      // "the Initech QBR and the Initech workshop": account + meeting noun reads best; else a short title.
      const names = list.map((a) => {
        if (a.row.kind !== 'event') return clip(corePhrase(a.row.title), 36);
        const ev = a.row.id.startsWith('event:') ? c.eventById.get(a.row.id.slice(6)) : undefined;
        const acc = ev ? accountOfEvent(c, ev) : '';
        return acc ? `${acc} ${eventNoun(a.row.title)}` : shortEvent(a.row.title);
      });
      names.forEach((n, i) => {
        if (i > 0) aheadSegs.push(seg(i === names.length - 1 ? ' and the ' : ', the '));
        const acc = input.accounts.map((x) => shortAccount(x.name)).find((a) => a && n.startsWith(a));
        if (acc) aheadSegs.push(seg(acc, true), seg(n.slice(acc.length)));
        else aheadSegs.push(seg(n));
      });
      const needPrep = list.filter((a) => a.prepMissing || a.row.state === 'risk').length;
      const last = aheadSegs.at(-1)!;
      last.text = last.text.replace(/…$/, '');
      aheadSegs.push(seg(needPrep === list.length && needPrep > 0 ? (list.length > 1 ? ', both still need prep.' : ', still needs prep.') : '.'));
    }
  }

  return {
    sentence,
    date: new Date(nowMs).toISOString(),
    timezone: tz,
    tzLabel: tzShort(tz, nowMs),
    since: c.plan ? { ...input.since, show: false } : input.since,
    ahead: aheadSegs,
  };
}

function buildFooter(c: Ctx, chase: { count: number; names: string[] }): HomeFooter {
  const { input } = c;
  const live = input.connectors.filter((k) => k.state === 'ok' || k.state === 'catching_up').length;
  const alerts = input.connectors
    .filter((k) => ['auth_needed', 'error', 'offline', 'degraded'].includes(k.state))
    .map((k) => ({ id: k.id, label: k.state === 'auth_needed' ? `${k.label} needs re-auth` : `${k.label} ${k.state.replace('_', ' ')}`, href: `/health?connector=${k.id}` }));
  const briefs = input.briefs.filter((b) => b.highlights.some((h) => h.status === 'new' && h.relevance === 'high')).length;
  return {
    sources: { live, total: input.connectors.length },
    alerts,
    spend: { usd: input.spend.usd, budgetUsd: input.spend.softBudgetUsd },
    dryRun: input.dryRun,
    briefs: { count: briefs, href: '/briefs' },
    agentRuns: { count: input.agentRuns.filter((r) => r.state === 'done_review').length, href: '/agents?state=done_review' },
    chase: { count: chase.count, names: chase.names.slice(0, 2), href: '/work?tab=all_open&state=waiting_on_others' },
  };
}

/** Read-in state rides on the item it researches (cards and rows); `WorkItemRecord.readInState` from BE-READIN. */
function attachReadIns(c: Ctx, cards: HomeCard[], sections: HomeSection[]) {
  for (const card of cards) {
    const st = card.kind === 'item' ? c.byId.get(card.id)?.readInState : undefined;
    if (st) card.readInState = st;
  }
  for (const s of sections)
    for (const row of s.rows) {
      const id = row.item?.id ?? (row.entity.kind === 'work_item' ? row.entity.id : null);
      const st = id ? c.byId.get(id)?.readInState : undefined;
      if (st) row.readInState = st;
    }
}

/** "#4 is in Reply & approve, #5 in Log & fix." · "#4 and #5 are in Reply & approve." */
function elsewhereText(list: Array<{ rank: number; label: string }>): string {
  if (!list.length) return '';
  if (list.length === 2 && list[0]!.label === list[1]!.label) return `#${list[0]!.rank} and #${list[1]!.rank} are in ${list[0]!.label}.`;
  return `${list.map((e, i) => (i === 0 ? `#${e.rank} is in ${e.label}` : `#${e.rank} in ${e.label}`)).join(', ')}.`;
}

// ---------------------------------------------------------------------------
// The whole page
// ---------------------------------------------------------------------------

export function buildHome(raw: HomeInput): HomePayload {
  // D-55: only the sources the persona has active have a daily surface (re-auth rows, the footer's source count)
  const input: HomeInput = raw.persona ? { ...raw, connectors: connectorRowsFor(raw.connectors, raw.persona) } : raw;
  const c = makeCtx(input);
  const cap = input.wide ? HOME_CAPS.rowsWide : HOME_CAPS.rows;

  // 1. Log & fix first: gap rules claim the items they stand for.
  // A row set aside (Not now, Not needed) is not drawn but keeps its items, so they don't pop up elsewhere.
  const allGaps = gapRules(c);
  const consumed = new Set(allGaps.flatMap((g) => g.consumes));
  const gaps = allGaps.filter((g) => !g.hidden);

  // 2. Today's needs, ranked across every tab: ranked today work, Outbox approvals as #2, then broken connectors.
  const today = todayItems(c).filter((w) => !consumed.has(w.id));
  const needs: Need[] = today.map((item) => ({ kind: 'item', item }));
  // Approvals are for now: a planned day leaves them in Reply & approve ("Approve N").
  if (c.readyDrafts.length && !c.plan) needs.splice(Math.min(1, needs.length), 0, { kind: 'outbox', drafts: c.readyDrafts });
  for (const g of gaps.filter((x) => x.rule === 'connector_auth')) needs.push({ kind: 'gap', gap: g });

  const cards: HomeCard[] = [];
  const elsewhereNeeds: Need[] = [];
  for (const n of needs) {
    if (cards.length < 3 && n.kind === 'item' && !c.blockedBy(n.item)) cards.push(itemCard(c, n.item, cards.length + 1));
    else if (cards.length < 3 && n.kind === 'outbox') cards.push(outboxCard(n.drafts, cards.length + 1));
    else elsewhereNeeds.push(n);
  }
  // Fewer than 3 today: fill with the next ranked work (never blocked, waiting or background). HOME-1: work the ranker
  // has not ranked yet (a fresh first scan ranks nothing until a re-rank) follows the ranked work by its due date, as
  // Today's fallback order does: before, a new user's Do now said "Nothing else needs you now" over 29 open replies.
  if (cards.length < 3) {
    const inCards = new Set(cards.map((k) => k.id));
    for (const w of c.live.filter((x) => !inCards.has(x.id) && !consumed.has(x.id) && !x.isBackground && x.state !== 'waiting_on_others' && !c.blockedBy(x) && !c.heldByMeeting(x) && !today.includes(x)).sort(byRank)) {
      if (cards.length >= 3) break;
      cards.push(itemCard(c, w, cards.length + 1));
    }
  }
  const taken = new Set<string>([...consumed, ...cards.filter((k) => k.kind === 'item').map((k) => k.id)]);
  // Items the meetings hold are covered by the ribbon.
  for (const w of c.live) if (c.heldByMeeting(w)) taken.add(w.id);
  const outboxIds = new Set(cards.some((k) => k.kind === 'outbox') ? c.readyDrafts.map((d) => d.id) : []);

  // 3. Reply & approve.
  const reply = replyRows(c, taken, outboxIds);
  for (const r of reply) taken.add(r.id);

  // 4. Chase (waiting on others + promises).
  const blocks = new Map<string, WorkItem>();
  for (const w of c.live) {
    const b = c.blockedBy(w);
    if (b) blocks.set(b.id, w);
  }
  const chase = chaseRows(c, taken, blocks);
  for (const r of chase.rows) taken.add(r.id);
  for (const r of chase.rows) if (r.id.startsWith('fold:')) for (const w of c.live) if (w.initiativeId === r.entity.id && w.kind === 'commitment' && !w.due) taken.add(w.id);

  // 5. Think ahead (14 days).
  const ahead = aheadRows(c, taken, outboxIds);

  // 6. Initiatives.
  const riskItems = new Set<string>([
    ...ahead.filter((a) => a.row.state === 'risk' || a.row.state === 'overdue').map((a) => a.row.item?.id ?? a.row.entity.id),
    ...gaps.filter((g) => g.row.state === 'risk' || g.row.state === 'overdue').flatMap((g) => g.consumes),
  ]);
  const inis = initiativeRows(c, riskItems);

  // 7. Capacity (from the CAPACITY engine, the same numbers as Today) and the ribbon.
  const capacity = input.capacity;
  const ribbon = buildRibbon(c, { free: freeIntervals(c), youMinToday: capacity.youMinToday, pullForward: capacity.pullForward });

  // 8. Strip + masthead.
  const dated = [
    ...ahead.map((a) => ({ at: a.at, label: a.row.title, risk: a.row.state === 'risk' || a.row.state === 'overdue', cf: a.cf, meeting: a.row.id.startsWith('event:') })),
    ...gaps.filter((g) => g.row.due).map((g) => ({ at: toMs(g.row.due!), label: g.row.title, risk: g.row.state === 'risk', cf: false, meeting: false })),
    ...reply.filter((r) => r.due).map((r) => ({ at: toMs(r.due!), label: r.title, risk: r.state === 'blocked' || r.state === 'overdue', cf: false, meeting: false })),
  ].filter((d) => d.at >= c.todayEnd);
  const aheadStrip = buildStrip(c, dated);
  const masthead = buildMasthead(c, cards, gaps, ahead, aheadStrip);

  // 9. Sections (rows capped), and where the next ranks live.
  const section = (id: HomeSectionId, rows: HomeRow[], count: number, seeAllHref: string, extra: Partial<HomeSection> = {}): HomeSection => ({
    id,
    title: SECTION_TITLE[id],
    count,
    sub: null,
    rows: rows.slice(0, id === 'initiatives' ? (input.wide ? HOME_CAPS.initiativesWide : HOME_CAPS.initiatives) : cap),
    seeAllHref,
    seeAllLabel: `See all ${count}`,
    batch: null,
    empty: SECTION_EMPTY[id],
    ...extra,
  });
  const sections: HomeSection[] = [
    // HOME-3: these rows are replies with no draft in the Outbox yet, so "See all 152 in Outbox" led to 18 drafts. The
    // link goes where the asks live (Work ▸ Asked of me) and says that tab's own count; Approve N still opens the Outbox.
    section('reply', reply, reply.length, '/work?tab=asked_of_me', { seeAllLabel: `See all ${input.items.filter((w) => w.kind === 'ask' && LIVE.has(w.state)).length} asks`, batch: !outboxIds.size && c.readyDrafts.length > 1 ? { label: `Approve ${c.readyDrafts.length}`, href: '/outbox' } : null }),
    section('ahead', ahead.map((a) => a.row), ahead.length, '/work?tab=all_open', { sub: `next ${HOME_CAPS.aheadDays} days` }),
    // 2026-11-13 audit C2: rows set aside (Not now) are still work: the empty line never says "Nothing missing" over them
    section('fix', gaps.map((g) => g.row), gaps.length, TIME_WEEK, allGaps.length > gaps.length && !gaps.length ? { empty: `Nothing to fix now · ${plural(allGaps.length - gaps.length, 'row')} set aside (back on its date)` } : {}),
    section('chase', chase.rows, chase.count, '/work?tab=all_open&state=waiting_on_others'),
    section('initiatives', inis, inis.length, '/work'),
  ];

  const sectionOf = (entityId: string, rowId: string): HomeSectionId | null => {
    for (const s of [{ id: 'reply' as const, rows: reply }, { id: 'fix' as const, rows: gaps.map((g) => g.row) }, { id: 'chase' as const, rows: chase.rows }, { id: 'ahead' as const, rows: ahead.map((a) => a.row) }]) {
      if (s.rows.some((r) => r.id === rowId || r.entity.id === entityId || r.item?.id === entityId)) return s.id;
    }
    return null;
  };
  const elsewhere = elsewhereNeeds
    .map((n, i) => {
      const rank = cards.length + i + 1;
      const sec = n.kind === 'item' ? sectionOf(n.item.id, n.item.id) : n.kind === 'gap' ? 'fix' : 'reply';
      return sec ? { rank, section: sec, label: SECTION_TITLE[sec] } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .slice(0, 2);
  const elsewhereNote = elsewhereText(elsewhere);

  attachReadIns(c, cards, sections);
  const looksDone = looksDoneGroup(c);
  const closedForYou = c.plan ? null : closedLine(input);
  const days = dayRefs(c);
  return {
    now: new Date(c.realNowMs).toISOString(),
    wide: input.wide,
    day: c.plan ? 'next' : 'today',
    nextDay: days.nextDay,
    moveTo: days.moveTo,
    masthead,
    ribbon,
    // planning: the planned day's capacity (the datasource computed it at that day's start), named for that day
    capacity: { day: c.plan ? 'next' : capacity.day, dayLabel: c.plan ? (c.plan.label === 'Tomorrow' ? 'tomorrow' : c.plan.label) : capacity.dayLabel, youMinToday: capacity.youMinToday, freeMin: capacity.freeMin, openMin: capacity.openMin, fits: capacity.fits, agentMinBackground: capacity.agentMinBackground, agentRunsBackground: capacity.agentRunsBackground, pullForward: capacity.pullForward.slice(0, HOME_CAPS.pullForward) },
    doNow: { total: Math.max(needs.length, cards.length), cards, elsewhere, elsewhereNote },
    sections,
    looksDone,
    closedForYou,
    aheadStrip,
    footer: buildFooter(c, chase),
  };
}

const dayRef = (d: WorkingDay): HomeDayRef => ({ date: d.date, label: d.label, short: d.short, startsAt: new Date(d.startMs).toISOString() });

/**
 * The next working day (the toggle, and the nudge from an hour before today's working hours end, after them, or on a
 * day off), and where "Move to …" sends an item: the working day after the day shown.
 */
function dayRefs(c: Ctx): { nextDay: HomeNextDay; moveTo: HomeDayRef } {
  const wh = c.input.workingHours;
  const next = c.plan ?? nextWorkingDay(c.realNowMs, c.tz, wh);
  const today = workingDayAt(c.realNowMs, c.tz, wh);
  const nudge = !isWorkingDay(c.realNowMs, c.tz, wh.days) || c.realNowMs >= today.endMs - HOUR_MS;
  return { nextDay: { ...dayRef(next), nudge }, moveTo: dayRef(c.plan ? nextWorkingDay(c.plan.startMs, c.tz, wh) : next) };
}

/** SETTLE-1: engine closes since you left, for the "Closed N for you since you left · Review" line. */
function closedLine(input: HomeInput): HomePayload['closedForYou'] {
  const since = input.closedSince ? Date.parse(input.closedSince) : NaN;
  if (!Number.isFinite(since)) return null;
  const n = closedForYouSince(input.items, since).length;
  return n ? { count: n, since: new Date(since).toISOString(), href: '/triage#closed_for_you' } : null;
}

/** LD-1: likely-done work, newest first, a few rows (the rest are one click away in Triage). */
function looksDoneGroup(c: Ctx): HomePayload['looksDone'] {
  const all = c.input.items.filter((w) => w.state === 'likely_done').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const cap = c.input.wide ? HOME_CAPS.looksDoneWide : HOME_CAPS.looksDone;
  return {
    count: all.length,
    rows: all.slice(0, cap).map((w) => ({ id: w.id, title: w.title, evidence: looksDoneEvidence(w), href: itemHref(w.id), item: { id: w.id, version: w.version } })),
  };
}

