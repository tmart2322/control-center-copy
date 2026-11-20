/**
 * Upserts for the projections (src/projections): source items → the domain rows the pages read.
 *
 * Every writer is keyed by the source's natural key (Org62 id, calendar + event id, Drive file id, Claude session
 * id, Org62 Event id, activity / time-block dedupe key) and is idempotent: a re-run with the same input writes
 * nothing (no audit rows). They run inside the caller's change set (`w`), like every store writer.
 *
 * User-owned fields are never overwritten:
 *  - `mapping_locked` keeps account / opportunity / mapping columns (calendar events, assets, Claude sessions);
 *  - activity entries the user approved, or whose fields they edited (`user_locked_fields`), are only moved by
 *    the Org62 read-back (status + stamps), never rewritten or removed;
 *  - ext side-car objects are merged, so fields other writers keep there survive.
 * The read side is the existing loaders (entities.ts, agents.ts, time.ts): rows are written in the shape they read.
 */
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';

import type { Account, CalendarEvent, SourceRef } from '@/contract';
import {
  accounts,
  activityEntries,
  assets,
  calendarEventAttendees,
  calendarEvents,
  claudeSessions,
  meetingNotes,
  opportunities,
  opportunityTeamMembers,
  org62Events,
  timeBlocks,
} from '@/db/schema';

import type { Db, Tx } from '@/db/client';
import { COVERED_MARKER, LOG_AGAIN_FLAG, MANUAL_LOG_NOTE, NOT_IN_ORG62_FLAG } from '@/engines/activity/org62-check';
import { confToNum } from '../enums';
import { extKey } from '../ext';
import { same, toDate, writeExt, type WriteCtx } from './common';
import { ensureTaskType, type Vocab } from './time';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** Merge `patch` into a row's ext object: `undefined` keeps a key, `null` removes it, other keys survive. */
export async function mergeExt(w: WriteCtx, table: string, id: string, patch: Record<string, unknown>): Promise<boolean> {
  const key = extKey(table, id);
  const before = w.kv.get(key);
  const next: Record<string, unknown> = { ...((before as Record<string, unknown> | undefined) ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete next[k];
    else next[k] = v;
  }
  await writeExt(w, table, id, next);
  // writeExt leaves the cached value alone when nothing changed
  return w.kv.get(key) !== before;
}

const MAPPING_PROPS = ['accountId', 'opportunityId', 'mappingMethod', 'mappingConfidence'];

/** Properties of `next` whose value differs from `cur`; mapping columns are skipped when the user locked them. */
function patchOf(cur: Record<string, unknown>, next: Record<string, unknown>, skip: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) if (!skip.includes(k) && !same(cur[k], v)) out[k] = v;
  return out;
}

export interface Mapping {
  accountId: string | null;
  opportunityId: string | null;
  mappingMethod: 'rule' | 'connector' | null;
  mappingConfidence: number | null;
}

export interface Upserted {
  id: string;
  /** Something was inserted or changed (row or ext). */
  written: boolean;
}

// ---------------------------------------------------------------------------
// Accounts, opportunities, my opp-team rows (Org62 is canonical)
// ---------------------------------------------------------------------------

export interface AccountProjection {
  org62AccountId: string;
  name: string;
  ext: { org62Url: string; dcStatus: Account['dcStatus']; hoursQtd: number };
}

export async function upsertAccountFromOrg62(w: WriteCtx, a: AccountProjection, newId: string): Promise<Upserted> {
  const [cur] = await w.tx.select().from(accounts).where(and(eq(accounts.ownerUserId, w.userId), eq(accounts.org62AccountId, a.org62AccountId)));
  let id = cur?.id ?? newId;
  let written = false;
  if (!cur) {
    await w.tx.insert(accounts).values({ id, ownerUserId: w.userId, org62AccountId: a.org62AccountId, name: a.name, isMyBook: true });
    written = true;
  } else {
    id = cur.id;
    const patch = patchOf(cur, { name: a.name, isMyBook: true });
    if (Object.keys(patch).length) {
      await w.tx.update(accounts).set(patch).where(eq(accounts.id, id));
      written = true;
    }
  }
  const ext = await mergeExt(w, 'accounts', id, { org62Url: a.ext.org62Url, dcStatus: a.ext.dcStatus === 'none' ? null : a.ext.dcStatus, hoursQtd: a.ext.hoursQtd || null });
  return { id, written: written || ext };
}

export interface OppProjection {
  org62OpportunityId: string;
  accountId: string | null;
  name: string;
  stage: string | null;
  amount: number | null;
  closeDate: string | null;
  forecastCategory: string | null;
  type: string | null;
  isClosed: boolean;
  isWon: boolean;
  onMyTeam: boolean;
  myTeamRole: string | null;
  org62ModifiedAt: string | null;
  /** nextStepRead: a read that selects NextStep saw the opp (a null nextStep then means none; src/projections/org62.ts). */
  ext: { dcAssigned: boolean; nextStep: string | null; nextStepRead?: boolean; org62Url: string; hoursQtd: number };
  /**
   * The daily book read no longer lists it (I left its team): membership turns off and the row is marked
   * (`ext.leftBookAt`), never deleted. Absent / null = still in my book (the mark is cleared).
   */
  leftBookAt?: string | null;
  /** The complete book read says this open opp is not mine: membership turns off (marked left if it was on). */
  notInBookAt?: string | null;
  /**
   * The complete book read decides membership (an open opp): `onMyTeam` is taken as given, so a stored "on my team"
   * it doesn't support turns off without a left mark (an opp I only hold a DC on). Absent: membership only turns on.
   */
  teamKnown?: boolean;
}

export async function upsertOpportunityFromOrg62(w: WriteCtx, o: OppProjection, newId: string): Promise<Upserted> {
  const [cur] = await w.tx.select().from(opportunities).where(and(eq(opportunities.ownerUserId, w.userId), eq(opportunities.org62OpportunityId, o.org62OpportunityId)));
  const cols = {
    accountId: o.accountId ?? cur?.accountId ?? null,
    name: o.name,
    stage: o.stage ?? cur?.stage ?? null,
    // numeric(14,2): round here, or a fractional amount reads back different and is rewritten every pass
    amount: o.amount !== null ? Math.round(o.amount * 100) / 100 : (cur?.amount ?? null),
    closeDate: o.closeDate ?? cur?.closeDate ?? null,
    forecastCategory: o.forecastCategory ?? cur?.forecastCategory ?? null,
    type: o.type ?? cur?.type ?? null,
    isClosed: o.isClosed,
    isWon: o.isWon,
    // membership only turns on here (Org62 lists current members, and not being listed by a windowed scan is not a
    // removal), except when the complete daily book read says I left the team or decides it (`teamKnown`)
    onMyTeam: o.leftBookAt || o.notInBookAt ? false : o.teamKnown ? o.onMyTeam : o.onMyTeam || !!cur?.onMyTeam,
    myTeamRole: o.myTeamRole ?? cur?.myTeamRole ?? null,
    org62ModifiedAt: toDate(o.org62ModifiedAt) ?? cur?.org62ModifiedAt ?? null,
  };
  let id = cur?.id ?? newId;
  let written = false;
  if (!cur) {
    await w.tx.insert(opportunities).values({ id, ownerUserId: w.userId, org62OpportunityId: o.org62OpportunityId, ...cols, updatedAt: w.now });
    written = true;
  } else {
    id = cur.id;
    const patch = patchOf(cur, cols);
    if (Object.keys(patch).length) {
      await w.tx.update(opportunities).set({ ...patch, updatedAt: w.now }).where(eq(opportunities.id, id));
      written = true;
    }
  }
  // the mark: the first read that left it out; kept while reads still leave it out; cleared once it is back
  const left = !!o.leftBookAt || (!!o.notInBookAt && !!cur?.onMyTeam);
  const prevLeft = (w.kv.get(extKey('opportunities', id)) as { leftBookAt?: string } | undefined)?.leftBookAt;
  const leftMark = left ? (prevLeft ?? o.leftBookAt ?? o.notInBookAt) : o.notInBookAt ? undefined : null;
  const ext = await mergeExt(w, 'opportunities', id, { dcAssigned: o.ext.dcAssigned || null, nextStep: o.ext.nextStep, nextStepRead: o.ext.nextStepRead ? true : o.ext.nextStepRead === false ? null : undefined, org62Url: o.ext.org62Url, hoursQtd: o.ext.hoursQtd || null, findingOnly: null, leftBookAt: leftMark });
  if (left) await removeMyTeamMembership(w, id);
  return { id, written: written || ext };
}

/** I left the opp's team (the book read says): my membership rows get `removed_at` (kept, never deleted). */
export async function removeMyTeamMembership(w: WriteCtx, opportunityId: string): Promise<void> {
  await w.tx.execute(sql`update opportunity_team_members set removed_at = ${w.now.toISOString()}::timestamptz where opportunity_id = ${opportunityId} and is_me and removed_at is null`);
}

/** My opp-team row (opportunity_team_members is not audited). */
export async function upsertMyTeamMembership(w: WriteCtx, opportunityId: string, org62UserId: string, role: string): Promise<void> {
  await w.tx
    .insert(opportunityTeamMembers)
    .values({ opportunityId, personId: w.me.id, org62UserId, teamRole: role, isMe: true })
    .onConflictDoUpdate({
      target: [opportunityTeamMembers.opportunityId, opportunityTeamMembers.org62UserId, opportunityTeamMembers.teamRole],
      set: { removedAt: null },
      setWhere: sql`${opportunityTeamMembers.removedAt} is not null`,
    });
}

// ---------------------------------------------------------------------------
// Calendar events (+ attendees, meeting notes)
// ---------------------------------------------------------------------------

export interface EventProjection extends Mapping {
  calendarId: string;
  externalEventId: string;
  recurringEventId: string | null;
  sourceItemId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  localDay: string;
  isAllDay: boolean;
  eventType: 'default' | 'out_of_office' | 'focus_time' | 'working_location';
  status: 'confirmed' | 'tentative' | 'cancelled';
  myResponse: 'accepted' | 'declined' | 'tentative' | 'needs_action' | 'none';
  iAmOrganizer: boolean;
  attendance: 'unknown' | 'attended' | 'missed' | 'partial' | 'not_applicable';
  hasExternalAttendees: boolean;
  externalDomains: string[];
  conferenceUrl: string | null;
  htmlLink: string | null;
  location: string | null;
  attendees: {
    email: string;
    personId: string | null;
    displayName: string | null;
    responseStatus: EventProjection['myResponse'];
    isOrganizer: boolean;
    isOptional: boolean;
    isSelf: boolean;
    isExternal: boolean;
    domain: string | null;
  }[];
}

export async function upsertCalendarEventFromSource(w: WriteCtx, e: EventProjection, newId: string): Promise<Upserted> {
  const [cur] = await w.tx
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.ownerUserId, w.userId), eq(calendarEvents.calendarId, e.calendarId), eq(calendarEvents.externalEventId, e.externalEventId)));
  const cols = {
    recurringEventId: e.recurringEventId,
    sourceItemId: e.sourceItemId,
    title: e.title,
    startsAt: new Date(e.startsAt),
    endsAt: new Date(e.endsAt),
    localDay: e.localDay,
    isAllDay: e.isAllDay,
    eventType: e.eventType,
    status: e.status,
    iAmOrganizer: e.iAmOrganizer,
    myResponse: e.myResponse,
    attendance: e.attendance,
    attendanceSource: 'calendar_inference' as const,
    hasExternalAttendees: e.hasExternalAttendees,
    externalDomains: e.externalDomains,
    conferenceUrl: e.conferenceUrl,
    htmlLink: e.htmlLink,
    location: e.location,
    accountId: e.accountId,
    opportunityId: e.opportunityId,
    mappingMethod: e.mappingMethod,
    mappingConfidence: e.mappingConfidence,
    deletedUpstreamAt: null,
  };
  let id = cur?.id ?? newId;
  let written = false;
  if (!cur) {
    await w.tx.insert(calendarEvents).values({ id, ownerUserId: w.userId, calendarId: e.calendarId, externalEventId: e.externalEventId, ...cols });
    written = true;
  } else {
    id = cur.id;
    const patch = patchOf(cur, cols, cur.mappingLocked ? MAPPING_PROPS : []);
    if (Object.keys(patch).length) {
      await w.tx.update(calendarEvents).set(patch).where(eq(calendarEvents.id, id));
      written = true;
    }
  }
  // attendees (not audited): exactly the projected set, keyed by email
  const att = await w.tx.select().from(calendarEventAttendees).where(eq(calendarEventAttendees.calendarEventId, id));
  const want = new Set(e.attendees.map((a) => a.email));
  const gone = att.filter((a) => !want.has(a.email)).map((a) => a.id);
  if (gone.length) await w.tx.delete(calendarEventAttendees).where(inArray(calendarEventAttendees.id, gone));
  for (const a of e.attendees) {
    const prev = att.find((x) => x.email === a.email);
    const row = { personId: a.personId, displayName: a.displayName, responseStatus: a.responseStatus, isOrganizer: a.isOrganizer, isOptional: a.isOptional, isSelf: a.isSelf, isExternal: a.isExternal, domain: a.domain };
    if (!prev) await w.tx.insert(calendarEventAttendees).values({ calendarEventId: id, email: a.email, ...row }).onConflictDoNothing();
    else if (Object.keys(patchOf(prev, row)).length) await w.tx.update(calendarEventAttendees).set(row).where(eq(calendarEventAttendees.id, prev.id));
  }
  const ext = await mergeExt(w, 'calendar_events', id, {
    location: e.location,
    source: e.htmlLink ? { kind: 'calendar', label: 'Google Calendar', externalId: e.externalEventId, url: e.htmlLink } : null,
  });
  return { id, written: written || ext };
}

/** Cancelled upstream (the event vanished while still ahead) or deleted at the source. The row stays (history). */
export async function markCalendarEventGone(w: WriteCtx, calendarId: string, externalEventId: string, how: 'cancelled' | 'deleted'): Promise<boolean> {
  const [cur] = await w.tx
    .select({ id: calendarEvents.id, status: calendarEvents.status, deletedUpstreamAt: calendarEvents.deletedUpstreamAt })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.ownerUserId, w.userId), eq(calendarEvents.calendarId, calendarId), eq(calendarEvents.externalEventId, externalEventId)));
  if (!cur) return false;
  if (how === 'cancelled' ? cur.status === 'cancelled' : !!cur.deletedUpstreamAt) return false;
  await w.tx
    .update(calendarEvents)
    .set(how === 'cancelled' ? { status: 'cancelled' } : { deletedUpstreamAt: w.now })
    .where(eq(calendarEvents.id, cur.id));
  return true;
}

/** The takeaways chip of a meeting: the work items the scanner opened from its notes, and the notes link. */
export async function setEventTakeaways(w: WriteCtx, eventId: string, t: CalendarEvent['takeaways']): Promise<boolean> {
  return mergeExt(w, 'calendar_events', eventId, { takeaways: t });
}

export interface NoteProjection {
  sourceItemId: string;
  calendarEventId: string | null;
  docExternalId: string;
  url: string | null;
  arrivedAt: string;
  nextStepCount: number;
  myNextStepCount: number;
}

export async function upsertMeetingNote(w: WriteCtx, n: NoteProjection): Promise<Upserted> {
  const [cur] = await w.tx.select().from(meetingNotes).where(eq(meetingNotes.sourceItemId, n.sourceItemId));
  const cols = {
    calendarEventId: n.calendarEventId,
    kind: 'gemini_notes' as const,
    docExternalId: n.docExternalId,
    url: n.url,
    arrivedAt: new Date(n.arrivedAt),
    matchMethod: n.calendarEventId ? ('calendar_attachment' as const) : null,
    matchConfidence: n.calendarEventId ? 0.95 : null,
    nextStepCount: n.nextStepCount,
    myNextStepCount: n.myNextStepCount,
  };
  if (!cur) {
    const [row] = await w.tx.insert(meetingNotes).values({ ownerUserId: w.userId, sourceItemId: n.sourceItemId, ...cols }).returning({ id: meetingNotes.id });
    return { id: row!.id, written: true };
  }
  const patch = patchOf(cur, cols);
  if (Object.keys(patch).length) await w.tx.update(meetingNotes).set(patch).where(eq(meetingNotes.id, cur.id));
  return { id: cur.id, written: Object.keys(patch).length > 0 };
}

// ---------------------------------------------------------------------------
// Assets (Drive files)
// ---------------------------------------------------------------------------

export interface AssetProjection extends Mapping {
  externalId: string;
  kind: 'deck' | 'doc' | 'sheet' | 'pdf' | 'other';
  title: string;
  url: string | null;
  mimeType: string | null;
  lastModifiedAt: string | null;
  lastModifiedByMe: boolean;
  lastModifierName: string | null;
  workItemIds: string[];
}

export async function upsertDriveAsset(w: WriteCtx, a: AssetProjection, newId: string): Promise<Upserted> {
  const [cur] = await w.tx.select().from(assets).where(and(eq(assets.ownerUserId, w.userId), eq(assets.system, 'drive'), eq(assets.externalId, a.externalId)));
  const modified = toDate(a.lastModifiedAt);
  const cols = {
    kind: a.kind,
    title: a.title,
    url: a.url,
    mimeType: a.mimeType ?? cur?.mimeType ?? null,
    lastModifiedAt: modified ?? cur?.lastModifiedAt ?? null,
    lastModifyingPersonId: modified ? (a.lastModifiedByMe ? w.me.id : null) : (cur?.lastModifyingPersonId ?? null),
    lastModifiedByMeAt: a.lastModifiedByMe && modified ? modified : (cur?.lastModifiedByMeAt ?? null),
    accountId: a.accountId,
    opportunityId: a.opportunityId,
    mappingMethod: a.mappingMethod,
    mappingConfidence: a.mappingConfidence,
  };
  let id = cur?.id ?? newId;
  let written = false;
  if (!cur) {
    await w.tx.insert(assets).values({ id, ownerUserId: w.userId, system: 'drive', externalId: a.externalId, ...cols });
    written = true;
  } else {
    id = cur.id;
    const patch = patchOf(cur, cols, cur.mappingLocked ? MAPPING_PROPS : []);
    if (Object.keys(patch).length) {
      await w.tx.update(assets).set(patch).where(eq(assets.id, id));
      written = true;
    }
  }
  const ext = await mergeExt(w, 'assets', id, {
    updatedBy: a.lastModifiedByMe ? null : (a.lastModifierName ?? undefined),
    workItemIds: a.workItemIds.length ? a.workItemIds : undefined,
  });
  return { id, written: written || ext };
}

// ---------------------------------------------------------------------------
// Claude sessions
// ---------------------------------------------------------------------------

export interface SessionProjection extends Mapping {
  sessionExternalId: string;
  hostSessionId: string | null;
  sourceItemId: string;
  title: string;
  status: 'launching' | 'launch_failed' | 'running' | 'idle' | 'waiting_on_me' | 'completed' | 'errored' | 'abandoned';
  stateOverride: 'done' | null;
  waitingReason: 'permission_prompt' | 'question' | 'plan_approval' | 'error' | 'review_output' | 'input_needed' | null;
  waitingText: string | null;
  waitingSince: string | null;
  entrypoint: 'cli' | 'desktop' | 'vscode' | 'cowork' | 'agent_sdk' | 'scheduled_task' | 'unknown';
  cwd: string | null;
  gitBranch: string | null;
  summary: string | null;
  startedAt: string | null;
  lastActivityAt: string;
  endedAt: string | null;
  promptCount: number;
  filesChangedCount: number;
  costUsd: number | null;
  bgAgents: number;
  error: string | null;
  deepLink: string;
  /** `[cc:<work item id>]`: the app launched it; the launch row (no session id yet) is the one to fill in. */
  ccTag: string | null;
}

export async function upsertSessionFromSource(w: WriteCtx, s: SessionProjection, newId: string): Promise<Upserted> {
  let [cur] = await w.tx.select().from(claudeSessions).where(and(eq(claudeSessions.ownerUserId, w.userId), eq(claudeSessions.sessionExternalId, s.sessionExternalId)));
  if (!cur && s.ccTag) {
    const launched = await w.tx
      .select()
      .from(claudeSessions)
      .where(and(eq(claudeSessions.ownerUserId, w.userId), eq(claudeSessions.launchedByApp, true), eq(claudeSessions.launchWorkItemId, s.ccTag), sql`${claudeSessions.sessionExternalId} is null`))
      .orderBy(sql`${claudeSessions.launchRequestedAt} desc nulls last`)
      .limit(1);
    cur = launched[0];
  }
  const cols = {
    sessionExternalId: s.sessionExternalId,
    desktopSessionId: s.hostSessionId,
    entrypoint: s.entrypoint,
    status: s.status,
    waitingReason: s.waitingReason,
    waitingDetail: null,
    waitingSince: toDate(s.waitingSince),
    cwd: s.cwd,
    gitBranch: s.gitBranch,
    title: s.title,
    summary: s.summary ?? cur?.summary ?? null,
    summaryUpdatedAt: s.summary ? new Date(s.lastActivityAt) : (cur?.summaryUpdatedAt ?? null),
    startedAt: toDate(s.startedAt),
    lastActivityAt: new Date(s.lastActivityAt),
    endedAt: toDate(s.endedAt),
    promptCount: s.promptCount,
    filesChangedCount: s.filesChangedCount,
    costUsd: s.costUsd === null ? null : Math.round(s.costUsd * 1e6) / 1e6, // numeric(12,6)
    accountId: s.accountId,
    opportunityId: s.opportunityId,
    mappingMethod: s.mappingMethod,
    mappingConfidence: s.mappingConfidence,
    sourceItemId: s.sourceItemId,
  };
  let id = cur?.id ?? newId;
  let written = false;
  if (!cur) {
    await w.tx.insert(claudeSessions).values({ id, ownerUserId: w.userId, ...cols, createdAt: toDate(s.startedAt) ?? new Date(s.lastActivityAt) });
    written = true;
  } else {
    id = cur.id;
    const patch = patchOf(cur, cols, cur.mappingLocked ? MAPPING_PROPS : []);
    if (Object.keys(patch).length) {
      await w.tx.update(claudeSessions).set(patch).where(eq(claudeSessions.id, id));
      written = true;
    }
  }
  const launched = !!cur?.launchedByApp || !!s.ccTag;
  const ext = await mergeExt(w, 'claude_sessions', id, {
    // app-launched runs end in done_review (the default map); sessions I started end in done
    stateOverride: s.stateOverride && !(launched && s.status === 'completed') ? { value: s.stateOverride, when: s.status } : null,
    deepLink: s.deepLink,
    bgAgents: s.bgAgents || null,
    error: s.error,
    waitingReason: s.waitingText,
  });
  return { id, written: written || ext };
}

// ---------------------------------------------------------------------------
// Org62 Events (read-back mirror; not audited)
// ---------------------------------------------------------------------------

export interface Org62EventProjection {
  org62EventId: string;
  recordTypeName: string;
  subject: string | null;
  startsAt: string;
  endsAt: string;
  durationField: number | null;
  seTaskTypeName: string | null;
  meetingTypeName: string | null;
  whatOrg62Id: string | null;
  opportunityId: string | null;
  accountId: string | null;
  /** CreatedDate (when it was logged); absent = keep what the row has. */
  org62CreatedAt?: string | null;
  org62ModifiedAt: string | null;
  sourceItemId: string;
}

/** Start times of verified rows whose opp/account no longer matches their Org62 Event: edited in Org62 while the
 *  row's week had no pass, or before a rule that follows the edit existed. Their weeks get a pass (ReadbackMove.adopt). */
export async function driftedLoggedRowStarts(tx: Db | Tx, userId: string): Promise<string[]> {
  const r = await tx.execute<{ s: Date | string }>(sql`
    select distinct e.starts_at as s from activity_entries a join org62_events e on e.id = a.org62_event_row_id
     where a.owner_user_id = ${userId} and a.status = 'verified' and e.deleted_upstream_at is null
       and coalesce(a.what_org62_id, '') <> coalesce(e.what_org62_id, '')`);
  return r.rows.map((x) => new Date(x.s).toISOString()).sort();
}

/** Start times of rows tied to a live Org62 Event that an older rule hid as `excluded: overlap` (a second Event in a
 *  slot, or a manual log beside an approved row). D-65 never hides an Org62 record, but only a pass over the row's
 *  week applies that; a version bump alone re-projects only the weeks whose inputs changed, so these get a pass. */
export async function hiddenOrg62RowStarts(tx: Db | Tx, userId: string): Promise<string[]> {
  const r = await tx.execute<{ s: Date | string }>(sql`
    select distinct a.starts_at as s from activity_entries a join org62_events e on e.id = a.org62_event_row_id
     where a.owner_user_id = ${userId} and a.status = 'excluded' and a.excluded_reason = 'overlap' and e.deleted_upstream_at is null`);
  return r.rows.map((x) => new Date(x.s).toISOString()).sort();
}

export async function upsertOrg62Event(w: WriteCtx, e: Org62EventProjection): Promise<Upserted> {
  const [cur] = await w.tx.select().from(org62Events).where(and(eq(org62Events.ownerUserId, w.userId), eq(org62Events.org62EventId, e.org62EventId)));
  const cols = {
    recordTypeName: e.recordTypeName,
    subject: e.subject,
    startsAt: new Date(e.startsAt),
    endsAt: new Date(e.endsAt),
    durationField: e.durationField === null ? null : Math.round(e.durationField * 100) / 100, // numeric(4,2)
    seTaskTypeName: e.seTaskTypeName,
    meetingTypeName: e.meetingTypeName,
    whatOrg62Id: e.whatOrg62Id,
    opportunityId: e.opportunityId,
    accountId: e.accountId,
    org62CreatedAt: toDate(e.org62CreatedAt ?? null) ?? cur?.org62CreatedAt ?? null,
    org62ModifiedAt: toDate(e.org62ModifiedAt),
    sourceItemId: e.sourceItemId,
    deletedUpstreamAt: null,
  };
  if (!cur) {
    const [row] = await w.tx.insert(org62Events).values({ ownerUserId: w.userId, org62EventId: e.org62EventId, ...cols }).returning({ id: org62Events.id });
    return { id: row!.id, written: true };
  }
  const patch = patchOf(cur, cols);
  if (Object.keys(patch).length) await w.tx.update(org62Events).set({ ...patch, lastSeenAt: w.now }).where(eq(org62Events.id, cur.id));
  return { id: cur.id, written: Object.keys(patch).length > 0 };
}

// ---------------------------------------------------------------------------
// Activity entries and time blocks of one window (a week)
// ---------------------------------------------------------------------------

export type ActivityRow = typeof activityEntries.$inferSelect;

/** Every activity row that overlaps [from, to): the window's own rows plus neighbours the overlap rule sees. */
export async function loadActivityWindow(w: WriteCtx, from: Date, to: Date): Promise<ActivityRow[]> {
  return w.tx
    .select()
    .from(activityEntries)
    .where(and(eq(activityEntries.ownerUserId, w.userId), lt(activityEntries.startsAt, to), sql`${activityEntries.endsAt} > ${from.toISOString()}::timestamptz`));
}

export interface ActivityProjection {
  dedupeKey: string;
  origin: 'calendar' | 'evidence' | 'manual';
  subject: string;
  description: string;
  startsAt: string;
  endsAt: string;
  durationHours: number;
  seTaskType: string | null;
  meetingType: 'CF' | 'CR' | null;
  customerFacing: boolean;
  customerRelated: boolean;
  whatKind: 'opportunity' | 'account' | 'none';
  whatOrg62Id: string | null;
  whatName: string | null;
  opportunityId: string | null;
  accountId: string | null;
  /** Shown on the row when the WhatId is an account, or the opp's account differs. */
  accountName: string | null;
  confidence: 'sure' | 'likely' | 'guess';
  reason: string;
  flags: string[];
  /** `dismissed`: a "Dismiss all from …" rule covers the row's source (D-64); from then on the row is the user's. */
  status: 'upcoming' | 'needs_input' | 'proposed' | 'excluded' | 'logged' | 'dismissed';
  excludedReason: 'neither_type' | 'overlap' | 'ooo' | 'placeholder' | 'cap_trimmed' | 'duplicate' | null;
  org62EventRowId: string | null;
  sources: SourceRef[];
  /** A logged row's real "reached Org62" time (the Event's CreatedDate); absent = when the projection wrote it. */
  loggedAt?: string | null;
  /** false when you were there in person (onsite days, customer dinners, travel). Absent: remote. */
  remote?: boolean;
  /** D-66: the Org62 Description's note and how it was drafted (the row's side-car). Absent: left as it is. */
  logNote?: string | null;
  logNoteBasis?: 'template' | 'summary' | null;
}

function activityCols(a: ActivityProjection, taskTypeId: string | null, meetingTypeId: string | null, now: Date) {
  return {
    origin: a.origin,
    operation: 'create' as const,
    subject: a.subject.slice(0, 255) || '(no subject)',
    startsAt: new Date(a.startsAt),
    endsAt: new Date(a.endsAt),
    durationHours: a.durationHours,
    seTaskTypeId: taskTypeId,
    meetingTypeId,
    whatKind: a.whatKind,
    opportunityId: a.opportunityId,
    accountId: a.accountId,
    whatOrg62Id: a.whatOrg62Id,
    whatName: a.whatName,
    customerFacing: a.customerFacing,
    customerRelated: a.customerRelated,
    remote: a.remote ?? true,
    description: a.description,
    confidence: confToNum(a.confidence),
    reason: a.reason,
    flags: a.flags,
    status: a.status,
    excludedReason: a.status === 'excluded' ? (a.excludedReason ?? 'neither_type') : null,
    org62EventRowId: a.org62EventRowId,
    loggedAt: a.status === 'logged' ? (a.loggedAt ? new Date(a.loggedAt) : now) : null,
  };
}

/**
 * Replace the projection-owned rows of a window with `want` (insert / update / delete by dedupe key) and apply
 * the read-back `moves` to rows the user owns. `owned(row)` says which existing rows the projection may touch.
 * The overlap exclusion is deferred to commit, so a window can be rewritten in any order.
 */
export async function applyActivityWindow(
  w: WriteCtx,
  vocab: Vocab,
  existing: ActivityRow[],
  want: ActivityProjection[],
  moves: {
    rowId: string;
    status: 'logged' | 'verified' | 'verify_failed';
    org62EventRowId: string;
    issues: string[];
    /**
     * Edited in Org62 after it was verified, or logged there by hand (D-65): the row takes Org62's values
     * (activity.ts ReadbackMove.adopt); hours, start, end and subject only where they differ.
     */
    adopt?: {
      whatOrg62Id: string | null;
      seTaskType: string | null;
      meetingType: string | null;
      note: string;
      opportunityId?: string | null;
      accountId?: string | null;
      whatName?: string | null;
      durationHours?: number;
      startsAt?: string;
      endsAt?: string;
      subject?: string;
    };
  }[],
  owned: (r: ActivityRow) => boolean,
  /**
   * Rows that log again, status and flags only, never their fields: overlap-excluded rows the user edited (D-18
   * amended), and (`rule`) rows a "Dismiss all from …" rule had set aside once the rule is gone (D-64: Undo, Remove).
   */
  revives: { rowId: string; status: 'upcoming' | 'needs_input' | 'proposed'; flags: string[]; kind?: 'overlap' | 'rule' }[] = [],
  /** D-64: rows of mine whose meeting I declined: removed, or flagged when handed off (never deleted from Org62). */
  declined: { rowId: string; action: 'remove' | 'flag'; flag?: string }[] = [],
  /**
   * D-66: rows the user owns whose note is still the app's (not edited, not handed off): they take the newer note
   * (only the note: every other field stays theirs).
   */
  noteRefresh: (r: ActivityRow) => boolean = () => false,
  /**
   * D-65: rows whose meeting was rescheduled (re-keyed to the new time, TL-32), approved rows one Org62 Event already
   * covers (TL-03), and the round-trip flags of the user's rows (Not in Org62, a start Slackbot moved, TL-20 / TL-22).
   */
  more: {
    rekeys?: { rowId: string; dedupeKey: string; startsAt: string; endsAt: string; durationHours: number }[];
    covers?: { rowId: string; org62EventRowId: string; flag: string }[];
    flags?: { rowId: string; remove: string[]; add: string[] }[];
  } = {},
): Promise<{ inserted: number; updated: number; deleted: number; moved: number }> {
  await w.tx.execute(sql`set constraints activity_entries_no_overlap_excl deferred`);
  const byKey = new Map(existing.map((r) => [r.dedupeKey, r]));
  const wantKeys = new Set(want.map((a) => a.dedupeKey));
  let inserted = 0;
  let updated = 0;
  let deleted = 0;
  let moved = 0;
  const drop = existing.filter((r) => owned(r) && !wantKeys.has(r.dedupeKey)).map((r) => r.id);
  if (drop.length) {
    await w.tx.delete(activityEntries).where(inArray(activityEntries.id, drop));
    // HYG-1: the row's ext side-car (`cc.ext/activity_entries/<id>`: sources, account name) goes with it. Before, every
    // dropped row left its ext behind for good (79 orphans in the first live database).
    for (const id of drop) await writeExt(w, 'activity_entries', id, null);
    deleted = drop.length;
  }
  // D-66: the note lives in the row's side-car; a changed note is a changed row (version, updated_at: the Time page refetches)
  const noteChanged = (id: string, a: ActivityProjection) => {
    if (a.logNote === undefined) return false;
    const x = (w.kv.get(extKey('activity_entries', id)) ?? {}) as { logNote?: string; logNoteBasis?: string };
    return (x.logNote ?? null) !== (a.logNote ?? null) || (x.logNoteBasis ?? null) !== (a.logNoteBasis ?? null);
  };
  const bump = (id: string) => w.tx.update(activityEntries).set({ version: sql`${activityEntries.version} + 1`, updatedAt: w.now }).where(eq(activityEntries.id, id));
  for (const a of want) {
    if (!(a.durationHours > 0) || Date.parse(a.endsAt) <= Date.parse(a.startsAt)) continue;
    const cur = byKey.get(a.dedupeKey);
    if (cur && !owned(cur)) {
      // the user's row: only read-back moves it, and (D-66) the app's note, until the user edits it or it is handed off
      if (noteRefresh(cur) && noteChanged(cur.id, a)) {
        await mergeExt(w, 'activity_entries', cur.id, { logNote: a.logNote, logNoteBasis: a.logNoteBasis });
        await bump(cur.id);
        updated++;
      }
      continue;
    }
    const tt = a.seTaskType ? await ensureTaskType(w, vocab, a.seTaskType) : null;
    const mt = a.meetingType ? (vocab.meetingTypeByValue.get(a.meetingType) ?? null) : null;
    const cols = activityCols(a, tt, mt, w.now);
    let id: string;
    if (!cur) {
      const [row] = await w.tx
        .insert(activityEntries)
        .values({ ownerUserId: w.userId, dedupeKey: a.dedupeKey, ...cols, updatedAt: w.now })
        .returning({ id: activityEntries.id });
      id = row!.id;
      inserted++;
    } else {
      id = cur.id;
      // a logged row keeps its stamp unless Org62 says when it was logged
      const patch = patchOf(cur, cols, cur.loggedAt && a.status === 'logged' && !a.loggedAt ? ['loggedAt'] : []);
      if (Object.keys(patch).length) {
        await w.tx
          .update(activityEntries)
          .set({ ...patch, version: sql`${activityEntries.version} + 1`, updatedAt: w.now })
          .where(eq(activityEntries.id, id));
        updated++;
      } else if (noteChanged(id, a)) {
        await bump(id);
        updated++;
      }
    }
    await mergeExt(w, 'activity_entries', id, { sources: a.sources.length ? a.sources : null, accountName: a.accountName, ...(a.logNote !== undefined ? { logNote: a.logNote, logNoteBasis: a.logNoteBasis } : {}) });
  }
  // the flags a row carries now (each write below starts from the previous one's)
  const flagsNow = new Map(existing.map((r) => [r.id, [...(r.flags ?? [])]] as const));
  // D-65: a row found in Org62 is no longer "not in Org62", nor waiting to be logged again
  const settled = (id: string) => (flagsNow.get(id) ?? []).filter((f) => f !== NOT_IN_ORG62_FLAG && f !== LOG_AGAIN_FLAG);
  for (const m of moves) {
    const cur = existing.find((r) => r.id === m.rowId);
    if (m.adopt && cur) {
      const ad = m.adopt;
      const tt = ad.seTaskType ? await ensureTaskType(w, vocab, ad.seTaskType) : null;
      const mt = ad.meetingType ? (vocab.meetingTypeByValue.get(ad.meetingType) ?? null) : null;
      const what = ad.whatOrg62Id;
      const flags = [...settled(m.rowId).filter((f) => !f.startsWith('Updated from Org62') && !f.startsWith(MANUAL_LOG_NOTE)), ad.note];
      await w.tx
        .update(activityEntries)
        .set({
          status: 'verified',
          org62EventRowId: m.org62EventRowId,
          verifyIssue: null,
          whatOrg62Id: what,
          // TL-13: Related To cleared in Org62: the row is internal (what_kind none), on no opp and no account
          whatKind: what?.startsWith('006') ? 'opportunity' : what?.startsWith('001') ? 'account' : 'none',
          opportunityId: what ? (ad.opportunityId ?? null) : null,
          accountId: what ? (ad.accountId ?? cur.accountId) : null,
          ...(ad.whatName ? { whatName: ad.whatName } : !what ? { whatName: null } : {}),
          ...(tt ? { seTaskTypeId: tt } : {}),
          ...(mt ? { meetingTypeId: mt } : {}),
          // TL-11 / TL-12: Org62's hours, start, end and subject (only the ones that differ come in)
          ...(ad.durationHours ? { durationHours: ad.durationHours } : {}),
          ...(ad.startsAt ? { startsAt: new Date(ad.startsAt) } : {}),
          ...(ad.endsAt ? { endsAt: new Date(ad.endsAt) } : {}),
          ...(ad.subject ? { subject: ad.subject.slice(0, 255) } : {}),
          flags,
          loggedAt: cur.loggedAt ?? w.now,
          verifiedAt: w.now,
          version: sql`${activityEntries.version} + 1`,
          updatedAt: w.now,
        })
        .where(eq(activityEntries.id, m.rowId));
      flagsNow.set(m.rowId, flags);
      moved++;
      continue;
    }
    if (!cur) continue;
    const issue = m.issues.join('; ') || null;
    // TL-15: verify_failed moves on (verified once it is fixed in Org62); an unchanged status rewrites only a changed issue
    if (cur.status === m.status && (m.status !== 'verify_failed' || (cur.verifyIssue ?? null) === issue)) continue;
    const stamp = m.status === 'verified' ? { loggedAt: cur.loggedAt ?? w.now, verifiedAt: w.now } : { loggedAt: cur.loggedAt ?? w.now };
    const flags = settled(m.rowId);
    await w.tx
      .update(activityEntries)
      .set({ status: m.status, org62EventRowId: m.org62EventRowId, verifyIssue: issue, ...stamp, flags, version: sql`${activityEntries.version} + 1`, updatedAt: w.now })
      .where(eq(activityEntries.id, m.rowId));
    flagsNow.set(m.rowId, flags);
    moved++;
  }
  // TL-03: an approved row one Org62 Event already covers (with another meeting) is closed: never logged twice
  for (const c of more.covers ?? []) {
    const cur = existing.find((r) => r.id === c.rowId);
    if (!cur || cur.status !== 'approved') continue;
    const flags = [...(flagsNow.get(c.rowId) ?? []).filter((f) => !f.startsWith(COVERED_MARKER)), c.flag];
    await w.tx
      .update(activityEntries)
      .set({ status: 'excluded', excludedReason: 'duplicate', org62EventRowId: c.org62EventRowId, flags, version: sql`${activityEntries.version} + 1`, updatedAt: w.now })
      .where(eq(activityEntries.id, c.rowId));
    flagsNow.set(c.rowId, flags);
    moved++;
  }
  // TL-32: a rescheduled meeting's row moves with it (a projection row already at the new key gives way)
  for (const k of more.rekeys ?? []) {
    const cur = existing.find((r) => r.id === k.rowId);
    if (!cur || cur.dedupeKey === k.dedupeKey) continue;
    const taken = await w.tx.select().from(activityEntries).where(and(eq(activityEntries.ownerUserId, w.userId), eq(activityEntries.dedupeKey, k.dedupeKey)));
    if (taken.some((t) => t.id !== cur.id && !owned(t))) continue; // the user has a row there already: theirs stands
    for (const t of taken.filter((x) => x.id !== cur.id)) {
      await w.tx.delete(activityEntries).where(eq(activityEntries.id, t.id));
      await writeExt(w, 'activity_entries', t.id, null);
      deleted++;
    }
    await w.tx
      .update(activityEntries)
      .set({ dedupeKey: k.dedupeKey, startsAt: new Date(k.startsAt), endsAt: new Date(k.endsAt), durationHours: k.durationHours, version: sql`${activityEntries.version} + 1`, updatedAt: w.now })
      .where(eq(activityEntries.id, k.rowId));
    moved++;
  }
  // the round-trip flags: only a change writes
  for (const f of more.flags ?? []) {
    if (!existing.some((r) => r.id === f.rowId)) continue;
    const now = flagsNow.get(f.rowId) ?? [];
    const next = [...now.filter((x) => !f.remove.includes(x)), ...f.add.filter((x) => !now.includes(x))];
    if (next.length === now.length && next.every((x, i) => x === now[i])) continue;
    await w.tx.update(activityEntries).set({ flags: next, version: sql`${activityEntries.version} + 1`, updatedAt: w.now }).where(eq(activityEntries.id, f.rowId));
    flagsNow.set(f.rowId, next);
    moved++;
  }
  for (const v of revives) {
    const cur = existing.find((r) => r.id === v.rowId);
    if (!cur) continue;
    if (v.kind === 'rule' ? cur.status !== 'dismissed' : cur.status !== 'excluded' || cur.excludedReason !== 'overlap') continue;
    await w.tx
      .update(activityEntries)
      .set({ status: v.status, excludedReason: null, flags: v.flags, version: sql`${activityEntries.version} + 1`, updatedAt: w.now })
      .where(eq(activityEntries.id, v.rowId));
    moved++;
  }
  // D-64: a meeting I declined never shows on Time: my row of it goes, unless it is handed off (flagged, kept)
  const gone = declined.filter((d) => d.action === 'remove' && existing.some((r) => r.id === d.rowId)).map((d) => d.rowId);
  if (gone.length) {
    await w.tx.delete(activityEntries).where(inArray(activityEntries.id, gone));
    for (const id of gone) await writeExt(w, 'activity_entries', id, null);
    deleted += gone.length;
  }
  for (const d of declined) {
    const cur = existing.find((r) => r.id === d.rowId);
    if (d.action !== 'flag' || !d.flag || !cur || (cur.flags ?? []).includes(d.flag)) continue;
    await w.tx
      .update(activityEntries)
      .set({ flags: [...(cur.flags ?? []), d.flag], version: sql`${activityEntries.version} + 1`, updatedAt: w.now })
      .where(eq(activityEntries.id, d.rowId));
    moved++;
  }
  return { inserted, updated, deleted, moved };
}

export interface BlockProjection {
  dedupeKey: string;
  source: 'calendar' | 'claude_hands_on' | 'claude_background' | 'doc_edit' | 'slack_burst' | 'git' | 'manual' | 'estimate' | 'travel' | 'onsite';
  startsAt: string;
  endsAt: string;
  localDay: string;
  attention: 'meeting' | 'focused' | 'background' | 'ambient';
  countsAsHumanHours: boolean;
  precedence: number;
  isOverlay: boolean;
  accountId: string | null;
  calendarEventId: string | null;
  label: string;
}

export type BlockRow = typeof timeBlocks.$inferSelect;

export async function loadBlockWindow(w: WriteCtx, from: Date, to: Date): Promise<BlockRow[]> {
  return w.tx
    .select()
    .from(timeBlocks)
    .where(and(eq(timeBlocks.ownerUserId, w.userId), lt(timeBlocks.startsAt, to), gte(timeBlocks.endsAt, from)));
}

/** Replace the blocks `engineVersion` owns in the window with `want` (time_blocks is not audited; labels are ext). */
export async function applyBlockWindow(w: WriteCtx, existing: BlockRow[], want: BlockProjection[], engineVersion: string): Promise<{ inserted: number; updated: number; deleted: number }> {
  await w.tx.execute(sql`set constraints time_blocks_no_double_count_excl deferred`);
  const mine = existing.filter((b) => b.engineVersion === engineVersion);
  const byKey = new Map(mine.map((b) => [b.dedupeKey, b]));
  const wantKeys = new Set(want.map((b) => b.dedupeKey));
  const drop = mine.filter((b) => !wantKeys.has(b.dedupeKey)).map((b) => b.id);
  if (drop.length) await w.tx.delete(timeBlocks).where(inArray(timeBlocks.id, drop));
  for (const id of drop) await writeExt(w, 'time_blocks', id, null); // HYG-1: its label ext goes with it
  let inserted = 0;
  let updated = 0;
  for (const b of want) {
    if (Date.parse(b.endsAt) <= Date.parse(b.startsAt)) continue;
    const cols = {
      source: b.source,
      startsAt: new Date(b.startsAt),
      endsAt: new Date(b.endsAt),
      localDay: b.localDay,
      attention: b.attention,
      countsAsHumanHours: b.countsAsHumanHours,
      precedence: b.precedence,
      isOverlay: b.isOverlay,
      accountId: b.accountId,
      calendarEventId: b.calendarEventId,
      mappingMethod: b.accountId ? ('rule' as const) : null,
    };
    const cur = byKey.get(b.dedupeKey);
    let id: string;
    if (!cur) {
      const [row] = await w.tx
        .insert(timeBlocks)
        .values({ ownerUserId: w.userId, dedupeKey: b.dedupeKey, engineVersion, ...cols })
        // explicit arbiter: the deferrable no-double-count exclusion cannot be one
        .onConflictDoNothing({ target: [timeBlocks.ownerUserId, timeBlocks.dedupeKey] })
        .returning({ id: timeBlocks.id });
      if (!row) continue; // a block another engine owns under the same key
      id = row.id;
      inserted++;
    } else {
      id = cur.id;
      const patch = patchOf(cur, cols);
      if (Object.keys(patch).length) {
        await w.tx.update(timeBlocks).set(patch).where(eq(timeBlocks.id, id));
        updated++;
      }
    }
    await mergeExt(w, 'time_blocks', id, { label: b.label || null });
  }
  // ext of dropped blocks
  for (const id of drop) await writeExt(w, 'time_blocks', id, null);
  return { inserted, updated, deleted: drop.length };
}
