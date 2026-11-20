/**
 * Time ▸ Forecast as one pure function over the mirror, the opps and the Outbox items: the table, the weekly notes
 * queue, Deal Role fixes, opps with no record, and where each record's update is (drafted → approved → staged in a
 * canvas → handed off → landed, or didn't land). Both DataSources call it with their own data, so mock and db agree.
 *
 * "Landed" is read from the mirror: a note landed when Org62 shows the same text (whitespace aside) or a newer note
 * than the canvas; a Deal Role when Org62 shows the value. A read at least LAND_GRACE_MS after the canvas was created
 * that shows neither flags it as not landed; it can be staged again.
 */
import type { Account, Draft, ForecastCanvas, ForecastCheck, ForecastPayload, ForecastRow, ForecastSyncState, ForecastUpdateState, MissingForecast, Opportunity, SpecialistForecast } from '@/contract';
import type { ResolvedPersona } from '@/personas';
import { featureActive } from '@/personas';
import { CANVAS_HOLDING } from '@/lib/canvas/payload';
import { toMs, whenLabel } from '@/engines/home/time';
import { deliveredAt, forecastCanvasIndex, forecastUpdatesOf, NOTES_FIELD, ROLE_FIELD, updateKey, type CanvasMark } from './canvas';
import { forecastThresholds, id15, missingForecasts, needsRoleFix, notesVerdict, org62IdOfOpp, queueScore } from './queue';
import { notesDue, quarterPair } from './time';

/** A read this long after the canvas was created that does not show the change flags it (Slackbot had time to run). */
export const LAND_GRACE_MS = 15 * 60_000;
/** The cap of one draft run (Settings never raises it above this). */
export const DRAFT_CAP_USD = 0.25;
/** "I created it, check now": the full read that follows a check this long after (the mirror otherwise reads once a day). */
export const CHECK_FOLLOW_UP_MS = 30 * 60_000;
/** A check that found its record stays listed (Found ✓) this long. */
export const CHECK_FOUND_SHOW_MS = 12 * 3_600_000;

/** One "I created it, check now" as the DataSource knows it (the db: a `forecast.sync` job of scope `opp`). */
export interface ForecastCheckInput {
  opportunityId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';
  askedAt: string;
  finishedAt: string | null;
  /** Why it failed or was skipped (codes and plain words, never names). */
  note: string | null;
}

export interface ForecastViewInput {
  now: string;
  timezone: string;
  persona: ResolvedPersona | null | undefined;
  mode: 'live' | 'mock';
  records: readonly SpecialistForecast[];
  opps: readonly Opportunity[];
  accounts: readonly Pick<Account, 'id' | 'name'>[];
  drafts: ReadonlyArray<Pick<Draft, 'id' | 'status' | 'destination' | 'attempts' | 'updatedAt' | 'createdAt'> & { resultUrl?: string | null }>;
  sync: ForecastSyncState;
  /** Record ids with a draft run queued or running. */
  drafting?: readonly string[];
  perDraftUsd?: number;
  dayLeftUsd?: number;
  /** "I created it, check now" checks (any order; the latest per opp counts). */
  checks?: readonly ForecastCheckInput[];
}

/** The latest check per opp. */
function latestChecks(checks: readonly ForecastCheckInput[] | undefined): Map<string, ForecastCheckInput> {
  const out = new Map<string, ForecastCheckInput>();
  for (const c of checks ?? []) {
    const cur = out.get(c.opportunityId);
    if (!cur || c.askedAt > cur.askedAt) out.set(c.opportunityId, c);
  }
  return out;
}

/**
 * Where one check is, for an opp still missing its record: checking while the read is queued or running; otherwise
 * what the read found, dated by the later of the check and any full read after it.
 */
export function checkState(c: ForecastCheckInput, o: { opportunityName: string | null; syncedAt: string | null }): ForecastCheck {
  const base = { opportunityId: c.opportunityId, opportunityName: o.opportunityName, recordId: null };
  if (c.status === 'queued' || c.status === 'running') return { ...base, status: 'checking', at: c.askedAt, note: null };
  const done = c.finishedAt ?? c.askedAt;
  if (c.status === 'failed') return { ...base, status: 'failed', at: done, note: c.note ?? 'The read did not finish' };
  if (c.status === 'skipped') return { ...base, status: 'skipped', at: done, note: c.note };
  const at = o.syncedAt && o.syncedAt > done ? o.syncedAt : done;
  return { ...base, status: 'not_found', at, note: null };
}

const norm = (s: string | null | undefined) =>
  (s ?? '')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** A pending note is current while Org62 still shows the notes it was written against (or a canvas carried it). */
function pendingNotes(r: SpecialistForecast, mark: CanvasMark | undefined) {
  const p = r.pending.notes;
  if (!p) return null;
  if (p.basedOnNotesAt === r.notesUpdatedAt) return p;
  if (mark && toMs(mark.at) >= toMs(p.at)) return p;
  return null;
}

function landedState(mark: CanvasMark, landed: boolean, syncedAt: string): ForecastUpdateState {
  if (mark.kind === 'held') return 'staged';
  if (landed) return 'landed';
  return toMs(syncedAt) - toMs(mark.at) >= LAND_GRACE_MS ? 'not_landed' : 'handed_off';
}

export interface RecordState {
  notes: ForecastRow['notes'];
  role: ForecastRow['role'];
  roleFix: ForecastRow['roleFix'];
}

/** Where one record's note and Deal Role update are. */
export function recordState(r: SpecialistForecast, marks: ReadonlyMap<string, CanvasMark>, o: { drafting: boolean; roleFixNeeded: boolean; notesDue: boolean }): RecordState {
  const nMark = marks.get(updateKey(r.org62Id, NOTES_FIELD));
  const p = pendingNotes(r, nMark);
  let nState: ForecastUpdateState = 'none';
  let draftId: string | null = null;
  // a canvas counts for the current note only when it came after the note's last edit
  const nCanvas = nMark && p && (nMark.kind === 'held' || toMs(nMark.at) >= toMs(p.at)) ? nMark : undefined;
  if (nCanvas) {
    const landed = norm(r.notes) === norm(nCanvas.value) || (!!r.notesUpdatedAt && toMs(r.notesUpdatedAt) > toMs(nCanvas.at));
    nState = landedState(nCanvas, landed, r.syncedAt);
    draftId = nCanvas.draftId;
  } else if (p) nState = p.state;
  // a note that landed in an earlier week: the record is due again, so that update is over
  const over = nState === 'landed' && o.notesDue;
  if (over) nState = 'none';
  if (o.drafting && (nState === 'none' || nState === 'drafted' || nState === 'landed')) nState = 'drafting';

  const rp = r.pending.dealRole;
  const rMark = marks.get(updateKey(r.org62Id, ROLE_FIELD));
  const rCanvas = rMark && rp && (rMark.kind === 'held' || toMs(rMark.at) >= toMs(rp.at)) ? rMark : undefined;
  let rState: ForecastUpdateState = 'none';
  if (rCanvas) rState = landedState(rCanvas, (r.dealRole ?? '') === rCanvas.value, r.syncedAt);
  else if (rp && o.roleFixNeeded) rState = 'approved';
  const roleFix = o.roleFixNeeded ? { from: r.dealRole, to: rp?.value ?? ('Aware' as const), approved: !!rp } : null;

  return {
    notes: {
      state: nState,
      text: over ? null : (p?.text ?? null),
      origin: over ? null : (p?.origin ?? null),
      at: over ? null : (p?.at ?? null),
      costUsd: over ? 0 : (p?.costUsd ?? 0),
      sources: over ? [] : (p?.sources ?? []),
      draftId: over ? null : draftId,
      error: r.pending.draftError && nState === 'none' ? r.pending.draftError.message : null,
    },
    role: { state: rState, draftId: rCanvas?.draftId ?? null },
    roleFix,
  };
}

/** The persona with the feature on: a direct read of one record (the details panel) ignores the gate. */
export const withForecast = <P extends ResolvedPersona>(p: P): P => ({ ...p, features: { ...p.features, specialistForecast: true } });

/** Updates ready to stage: approved and not in a canvas, or handed off and didn't land. */
export const STAGEABLE: ReadonlySet<ForecastUpdateState> = new Set(['approved', 'not_landed']);

export function buildForecastView(i: ForecastViewInput): ForecastPayload {
  const nowMs = toMs(i.now);
  const t = forecastThresholds(i.persona);
  const q = quarterPair(nowMs, i.timezone);
  const due = notesDue(nowMs, i.timezone, t.dueWeekday, t.dueAt);
  const active = featureActive(i.persona, 'specialistForecast');
  const base = {
    active,
    mode: i.mode,
    quarter: q,
    thresholds: t,
    due: { at: new Date(due.nextMs).toISOString(), prevAt: new Date(due.prevMs).toISOString(), label: whenLabel(due.nextMs, nowMs, i.timezone) },
    sync: i.sync,
    drafting: { running: [...(i.drafting ?? [])], perDraftUsd: i.perDraftUsd ?? DRAFT_CAP_USD, dayLeftUsd: Math.max(0, i.dayLeftUsd ?? 0) },
  };
  if (!active) return { ...base, rows: [], queue: { notes: [], roles: [], missing: [] }, counts: { due: 0, overdue: 0, drafted: 0, ready: 0, staged: 0, handedOff: 0, notLanded: 0, roles: 0, missing: 0 }, canvases: [], withSlackbot: [], found: [] };

  const marks = forecastCanvasIndex(i.drafts);
  const drafting = new Set(i.drafting ?? []);
  const accName = new Map(i.accounts.map((a) => [a.id, a.name] as const));
  const oppById = new Map(i.opps.map((o) => [o.id, o] as const));
  const rows: Array<ForecastRow & { score: number }> = [];
  for (const r of i.records) {
    const v = notesVerdict(r, t, { nowMs, currentQuarter: q.current, prevDueMs: due.prevMs, nextDueMs: due.nextMs });
    const st = recordState(r, marks, { drafting: drafting.has(r.id), roleFixNeeded: needsRoleFix(r, t), notesDue: v.state === 'due' || v.state === 'overdue' });
    const opp = r.opportunityId ? oppById.get(r.opportunityId) : undefined;
    rows.push({
      id: r.id,
      org62Id: r.org62Id,
      name: r.name,
      url: r.url,
      opportunityId: r.opportunityId,
      accountId: r.accountId,
      opportunityName: r.opportunityName ?? opp?.name ?? null,
      accountName: r.accountName ?? (r.accountId ? (accName.get(r.accountId) ?? null) : null),
      amount: r.amount,
      stage: r.stage,
      forecastStatus: r.forecastStatus,
      judgement: r.judgement,
      dealRole: r.dealRole,
      closeDate: r.closeDate,
      fiscalQuarter: r.fiscalQuarter,
      inQuarter: v.inQuarter,
      notesAgeDays: v.ageDays,
      notesUpdatedAt: r.notesUpdatedAt,
      notesState: v.state,
      rank: null,
      currentNotes: r.notes,
      mgrNotes: r.mgrNotes,
      roleFix: st.roleFix,
      notes: st.notes,
      role: st.role,
      gone: !!r.goneAt,
      score: queueScore(r),
    });
  }
  const byScore = (a: { score: number; org62Id: string }, b: { score: number; org62Id: string }) => b.score - a.score || a.org62Id.localeCompare(b.org62Id);
  const queued = rows.filter((r) => r.notesState === 'due' || r.notesState === 'overdue').sort(byScore);
  queued.forEach((r, n) => (r.rank = n + 1));
  const rest = rows.filter((r) => r.rank === null).sort((a, b) => Number(a.gone) - Number(b.gone) || (b.amount ?? 0) - (a.amount ?? 0) || a.org62Id.localeCompare(b.org62Id));
  const roles = rows.filter((r) => r.roleFix).sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0) || a.org62Id.localeCompare(b.org62Id));

  const checks = latestChecks(i.checks);
  const missing: MissingForecast[] = missingForecasts(i.opps, i.records, q).map(({ opp, signal }) => {
    const c = checks.get(opp.id);
    return {
      opportunityId: opp.id,
      accountId: opp.accountId,
      opportunityName: opp.name,
      accountName: accName.get(opp.accountId) ?? null,
      amount: opp.amount,
      closeDate: opp.closeDate,
      signal,
      products: [...opp.products],
      url: opp.org62Url,
      check: c ? checkState(c, { opportunityName: opp.name, syncedAt: i.sync.lastAt }) : null,
    };
  });
  // a check whose opp has its record now: Found ✓ (for a while), with the record to open
  const missingIds = new Set(missing.map((m) => m.opportunityId));
  const found: ForecastCheck[] = [];
  for (const c of checks.values()) {
    if (missingIds.has(c.opportunityId) || nowMs - toMs(c.askedAt) > CHECK_FOUND_SHOW_MS) continue;
    const opp = oppById.get(c.opportunityId);
    const oid = opp ? org62IdOfOpp(opp) : null;
    const rec = i.records.find((r) => !r.goneAt && (r.opportunityId === c.opportunityId || (!!oid && !!r.org62OpportunityId && id15(r.org62OpportunityId) === id15(oid))));
    if (!rec) continue;
    found.push({ opportunityId: c.opportunityId, opportunityName: opp?.name ?? rec.opportunityName ?? rec.name, status: 'found', at: c.finishedAt ?? c.askedAt, note: null, recordId: rec.id });
  }
  found.sort((a, b) => b.at.localeCompare(a.at) || a.opportunityId.localeCompare(b.opportunityId));

  const canvases: ForecastCanvas[] = i.drafts
    .filter((d) => CANVAS_HOLDING.has(d.status))
    .flatMap((d) => {
      const ups = forecastUpdatesOf(d);
      if (!ups) return [];
      const notes = ups.filter((u) => u.field === NOTES_FIELD).length;
      return [{ draftId: d.id, title: d.destination.kind === 'action' ? d.destination.target.label : 'Forecast canvas', status: d.status, notes, roles: ups.length - notes, at: d.createdAt, url: null, waiting: 0 }];
    })
    .sort((a, b) => b.at.localeCompare(a.at) || a.draftId.localeCompare(b.draftId));

  const all = [...queued, ...rest].map(({ score: _s, ...r }) => r);
  // With Slackbot: applied canvases the sync has not seen land yet (handed off), with the link, until the notes land
  const handedOff = new Map<string, number>();
  for (const r of all) {
    if (r.notes.state === 'handed_off' && r.notes.draftId) handedOff.set(r.notes.draftId, (handedOff.get(r.notes.draftId) ?? 0) + 1);
    if (r.role.state === 'handed_off' && r.role.draftId) handedOff.set(r.role.draftId, (handedOff.get(r.role.draftId) ?? 0) + 1);
  }
  const withSlackbot: ForecastCanvas[] = i.drafts
    .filter((d) => handedOff.has(d.id) && !CANVAS_HOLDING.has(d.status))
    .flatMap((d) => {
      const ups = forecastUpdatesOf(d);
      if (!ups) return [];
      const notes = ups.filter((u) => u.field === NOTES_FIELD).length;
      return [{ draftId: d.id, title: d.destination.kind === 'action' ? d.destination.target.label : 'Forecast canvas', status: d.status, notes, roles: ups.length - notes, at: deliveredAt(d), url: d.resultUrl ?? null, waiting: handedOff.get(d.id) ?? 0 }];
    })
    .sort((a, b) => b.at.localeCompare(a.at) || a.draftId.localeCompare(b.draftId));
  const count = (f: (r: ForecastRow) => boolean) => all.filter(f).length;
  return {
    ...base,
    rows: all,
    queue: { notes: queued.map((r) => r.id), roles: roles.map((r) => r.id), missing },
    counts: {
      due: queued.length,
      overdue: queued.filter((r) => r.notesState === 'overdue').length,
      drafted: count((r) => r.notes.state === 'drafted'),
      ready: count((r) => STAGEABLE.has(r.notes.state)) + count((r) => STAGEABLE.has(r.role.state)),
      staged: count((r) => r.notes.state === 'staged') + count((r) => r.role.state === 'staged'),
      handedOff: count((r) => r.notes.state === 'handed_off') + count((r) => r.role.state === 'handed_off'),
      notLanded: count((r) => r.notes.state === 'not_landed') + count((r) => r.role.state === 'not_landed'),
      roles: roles.length,
      missing: missing.length,
    },
    canvases,
    withSlackbot,
    found,
  };
}

/** The approved updates "Stage N notes" stages, in queue order (notes, then Deal Roles), skipping anything held. */
export function stageableUpdates(view: Pick<ForecastPayload, 'rows'>, ids?: readonly string[]): Array<{ recordId: string; org62Id: string; notes: string | null; dealRole: string | null }> {
  const want = ids?.length ? new Set(ids) : null;
  const out: Array<{ recordId: string; org62Id: string; notes: string | null; dealRole: string | null }> = [];
  for (const r of view.rows) {
    if (want && !want.has(r.id)) continue;
    const notes = STAGEABLE.has(r.notes.state) && r.notes.text ? r.notes.text : null;
    const dealRole = STAGEABLE.has(r.role.state) && r.roleFix ? r.roleFix.to : null;
    if (notes || dealRole) out.push({ recordId: r.id, org62Id: r.org62Id, notes, dealRole });
  }
  return out;
}
