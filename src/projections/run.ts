/**
 * The projections tick (worker hook `projections`, every minute): source items changed since the stored watermark
 * → domain rows, through the idempotent upserts in store/projections.ts.
 *
 *  - Watermark: `user_settings` key `cc.projections` holds the newest `changed_at` processed. Each tick re-reads
 *    from 10 min before it (a scanner transaction that started earlier but committed later is still seen); the
 *    upserts make the overlap free. No watermark (first run, or a new projection version) = everything: so a
 *    worker that was down catches up by itself, and nothing depends on scan internals.
 *  - Stage A, one change set: Org62 → my book (accounts, opps, my team rows) and my Org62 Events; calendar items →
 *    events (+ attendees, cancellations); Claude sessions; Drive files → assets; Gemini notes → meeting notes and
 *    the event's takeaways. When the book changes, recent events / sessions / assets are re-matched.
 *  - Stage B, one change set per affected week: time blocks and activity entries (activity.ts).
 *  - A pass that changes nothing commits nothing (no empty change sets, no audit rows).
 * Logs carry counts and codes only, never titles or bodies (tenet: Local data, privacy-safe logs).
 */
import { loggingProfile, personaTargetH, type LoggingProfile } from '@/engines/activity/persona';
import { loadPersona } from '@/server/datasource/db/store/persona';
import { basename } from 'node:path';

import { and, eq, inArray, sql } from 'drizzle-orm';

import type { SourceRef } from '@/contract';
import { actors, withChangeSet, type ChangeSetContext } from '@/db/changeset';
import type { Db, Tx } from '@/db/client';
import { activityEntries, calendarEvents, claudeSessions, missedOppFindings, missedOppSweeps, people, personIdentities, teamPacks, userSettings, users } from '@/db/schema';
import { airportBuffers, type EngagedParams, COUNTED_STATUSES, diffRows, durationUpdateCandidates, rowsAfter, type HeldChange, type RederiveRow, type RowChange, type UpdateCandidate, DEFAULT_EVIDENCE_CONFIG, DEFAULT_ONSITE_CONFIG, DELETED_IN_ORG62, addDays as addLocalDays, type ActivityConfig, type OnsiteConfig, type OnsiteOverrides, type OverlapMode } from '@/engines/activity';
import { canon, loadKv } from '@/server/datasource/db/ext';
import { uuidFor } from '@/server/datasource/db/ids';
import { ensureExtractor } from '@/server/datasource/db/seed';
import { writeKv, type WriteCtx } from '@/server/datasource/db/store/common';
import { ONSITE_OVERRIDES_KEY, onsiteWeekKey, overridesForWeek, overridesHash, readOnsiteOverrides, type OnsiteWeekRecord } from '@/server/datasource/db/store/onsite';
import { heldActivityRows, readTimeDismissRules } from '@/server/datasource/db/store/time-rules';
import {
  applyActivityWindow,
  applyBlockWindow,
  loadActivityWindow,
  loadBlockWindow,
  markCalendarEventGone,
  mergeExt,
  setEventTakeaways,
  driftedLoggedRowStarts,
  hiddenOrg62RowStarts,
  upsertAccountFromOrg62,
  upsertCalendarEventFromSource,
  upsertDriveAsset,
  upsertMeetingNote,
  upsertMyTeamMembership,
  upsertOpportunityFromOrg62,
  upsertOrg62Event,
  upsertSessionFromSource,
  type ActivityProjection,
  type ActivityRow,
  type Mapping,
} from '@/server/datasource/db/store/projections';
import { loadVocab } from '@/server/datasource/db/store/time';
import { syncMyDcs } from '@/server/datasource/db/store/dc-requests';

import { ENGINE_STATUSES, ENGINE_VERSION, OWNED_ACTIVITY_PREFIXES, planWeek, weekOf, type DesiredEntry, type FixedEntry, type WeekEmail, type WeekEvent, type WeekInput, type WeekPlan } from './activity';
import { assetsFromDrive, assetsFromEvents, driveEdit, mergeAssets, projectGeminiNote } from './assets';
import { calendarKey, isGone, projectCalendarEvent, resolveCalendarItems } from './calendar';
import { Matcher, withOrg62Parents, type MatchAccount, type MatchOpp } from './matching';
import { matchWorkItemAccounts } from './work-accounts';
import { missedOpps, type MissedEvidence, type MissedResult } from './missed';
import { missedSlackEvidence } from './missed-slack';
import { oppsInBook, projectOrg62 } from './org62';
import { claudeSessionLink, sourceItemUrl } from './links';
import { humanTurnsOf, projectClaudeSession, sessionDeepLink } from './sessions';
import type { BookRead, DomainRules, Me, Org62Book, ProjectedEvent, SourceRow } from './types';
import { DEFAULT_IGNORE_DOMAINS, domainOf, id15, isSfId, localDay, maxIso, org62RecordUrl } from './util';
import { oppIdsOf, type VdpSnapshot } from '@/lib/vdp/types';
import type { UseCaseOption } from '@/engines/activity/note';
import { ACCOUNT_HIERARCHY_KV, hierarchyOf } from '@/lib/accounts/hierarchy';

/**
 * 2: onsite lane (calendar location column, all-day events at local midnight): one full re-projection.
 * 3: D-18 amended (every accepted meeting logs; onsite days log in full): one full re-projection, so rows excluded only
 *    for an overlap come back as proposals (the user's own dismissals are theirs and stay).
 * 4: my DCs mirrored into deal_contributions (split, role): one full re-projection, so the DCs already in stored Org62
 *    snapshots land without waiting for each one to change in Org62 (an incremental read only sees changed DCs).
 * 5: Deals pipeline (forecast category, won, next step seen on opps): one full re-projection, so opps already in
 *    stored snapshots get them without waiting to change in Org62.
 * 6: (a) `oppFor` ignores generic words ("call", "team", "renewal", "FY27") and weak hits on opps I'm not on, and a
 *    meeting on an opp I'm not on waits for my Approve: one full re-projection, so unlocked, not-yet-logged rows
 *    re-resolve (rows I approved, synced, logged or verified keep their opp: they are mine, or Org62's); (b) my DCs
 *    re-link to their opp row by Org62 id, so `myDc` (split, role) is filled on every opp I hold a DC on.
 * 7: D-64 (SE persona): work for no customer is internal-only activity (repo and Drive work no account or opp matched,
 *    meetings with no customer, account or opp that name internal work): what_kind none, no WhatId, CF / CR off, an
 *    internal task type (Asset Creation, Personal Development, Sales Enablement, Travel), `proposed`; a meeting I
 *    declined has no row, also one I organize; "Dismiss all from …" rules. One full re-projection, so the rows waiting
 *    under "No opportunity" re-classify; rows I approved, edited, dismissed, logged or verified are mine and stay.
 * 8: D-66: every row carries its Org62 Description note (`logNote` in its side-car: the template over its evidence,
 *    the cheap model's over the meeting notes where `activity.notes` made one). One full re-projection, so the rows
 *    of the last weeks get one; a row waiting to be logged whose note you have not edited takes the newer note too.
 * 9: D-68: sibling-aware account matching (a child account matched by its full name; a shared " - " head maps to no
 *    child unless an attendee domain or an opp word points at exactly one) and Slack as missed-opp evidence. One full
 *    re-projection, so calendar and activity rows re-map; rows I approved, edited, dismissed, logged or verified stay.
 * 10: D-65: the Time ↔ Org62 round trip. A row pairs with its Event by the link, then its CC# key, then the slot rule;
 *     a real Org62 record is never hidden (duplicates and overlapping manual Events log, flagged); a legacy record type
 *     stops counting. One full re-projection, so the live hidden duplicates and excluded overlaps come back as logged
 *     rows; your approvals, edits, dismissals and dismiss rules stay yours.
 */
export const PROJECTIONS_VERSION = 10;
export const STATE_KEY = 'cc.projections';
const SLACK_MS = 10 * 60_000;
const WEEK_REFRESH_MS = 15 * 60_000;
const REMATCH_BACK_DAYS = 45;
const REMATCH_AHEAD_DAYS = 30;
const SOURCES = ['calendar', 'org62', 'claude', 'drive', 'gemini_notes', 'slack'];

/** Company domains per team pack when the pack does not list its own (`team_packs.raw.internalDomains`). */
const PACK_INTERNAL_DOMAINS: Record<string, string[]> = {
  'salesforce-se': ['salesforce.com', 'slack.com', 'slack-corp.com', 'tableau.com', 'mulesoft.com', 'salesforce.org', 'heroku.com', 'quip.com', 'exacttarget.com', 'demandware.com', 'clicksoftware.com'],
};

interface State {
  version: number;
  watermark: string | null;
  weekRefreshedAt: string | null;
  /** Weeks whose pass failed: retried on the next ticks, without holding the watermark back. */
  pendingWeeks?: string[];
}

export interface ProjectionCounts {
  calendar_events: number;
  cancelled_events: number;
  accounts: number;
  opportunities: number;
  org62_events: number;
  claude_sessions: number;
  assets: number;
  meeting_notes: number;
  activity_entries: number;
  time_blocks: number;
  missed_findings: number;
  /** My DCs mirrored into deal_contributions, and the DC requests they confirmed. */
  deal_contributions: number;
  /** Work items given the account their title names (ACC-1). */
  work_item_accounts: number;
}

export interface ProjectionResult {
  skipped: boolean;
  changedItems: number;
  weeks: string[];
  written: ProjectionCounts;
  /** Org62 Events the skill recorded without a start time (counted, not projected). */
  org62EventsWithoutStart: number;
  /** The latest complete book read (counts only), when Stage A re-read Org62. */
  book?: (BookRead & { openTeamOpps: number; left: number }) | null;
  /** Missed-opp findings the deals engine produced this pass (written or unchanged). */
  missedFindings?: number;
  errors: string[];
}

export interface ProjectionOptions {
  db: Db;
  userId: string;
  now?: Date;
  /** Recompute everything (ignores the watermark). */
  full?: boolean;
  log?: (msg: string, detail?: Record<string, unknown>) => void;
}

const zero = (): ProjectionCounts => ({ calendar_events: 0, cancelled_events: 0, accounts: 0, opportunities: 0, org62_events: 0, claude_sessions: 0, assets: 0, meeting_notes: 0, activity_entries: 0, time_blocks: 0, missed_findings: 0, deal_contributions: 0, work_item_accounts: 0 });

class NothingToWrite extends Error {}

/** A loggable error code: the Postgres / DbError code or the error class, never a message (it may quote data). */
const errCode = (e: unknown): string => {
  const x = e as { code?: unknown; constraint?: unknown; name?: string; cause?: { code?: unknown; constraint?: unknown } };
  const code = typeof x.code === 'string' ? x.code : typeof x.cause?.code === 'string' ? x.cause.code : (x.name ?? 'Error');
  const constraint = typeof x.constraint === 'string' ? x.constraint : typeof x.cause?.constraint === 'string' ? x.cause.constraint : null;
  return [code, constraint].filter(Boolean).join(':');
};

/** One change set that commits only when something was written. */
async function maybeChangeSet<T>(db: Db, userId: string, reason: string, fn: (tx: Tx, cs: ChangeSetContext) => Promise<{ result: T; wrote: boolean }>): Promise<T | null> {
  let out: T | null = null;
  try {
    await withChangeSet({ db, userId, actor: actors.engine(`projections@${PROJECTIONS_VERSION}`), reason, undoable: false }, async (tx, cs) => {
      const r = await fn(tx, cs);
      out = r.result;
      if (!r.wrote) throw new NothingToWrite();
    });
  } catch (e) {
    if (!(e instanceof NothingToWrite)) throw e;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

type Raw = {
  id: string;
  source: string;
  kind: string;
  external_id: string;
  external_parent_id: string | null;
  external_container_id: string | null;
  dedupe_key: string;
  occurred_at: Date | string;
  title: string | null;
  url: string | null;
  body: string | null;
  meta: Record<string, unknown> | null;
  from_me: boolean;
  deleted_upstream_at: Date | string | null;
  changed_at: Date | string;
};
const iso = (v: Date | string) => (v instanceof Date ? v : new Date(v)).toISOString();
const toRow = (r: Raw): SourceRow => ({
  id: r.id,
  source: r.source,
  kind: r.kind,
  externalId: r.external_id,
  externalParentId: r.external_parent_id,
  externalContainerId: r.external_container_id,
  dedupeKey: r.dedupe_key,
  occurredAt: iso(r.occurred_at),
  title: r.title,
  url: r.url,
  body: r.body,
  meta: r.meta ?? {},
  fromMe: r.from_me,
  deletedUpstreamAt: r.deleted_upstream_at ? iso(r.deleted_upstream_at) : null,
  changedAt: iso(r.changed_at),
});

const CHANGED_AT = sql`greatest(si.created_at, coalesce(si.content_changed_at, si.created_at), si.updated_at, coalesce(si.deleted_upstream_at, si.created_at))`;
/** Bodies are read only where a mapper needs them (Org62 excerpt fields, the Claude recap), and never logged. */
const BODY = sql`case when si.source in ('org62', 'claude') then left(si.body, 2000) end`;

async function loadSources(db: Db | Tx, userId: string, where: ReturnType<typeof sql>): Promise<SourceRow[]> {
  const r = await db.execute<Raw>(sql`
    select si.id, si.source, si.kind, si.external_id, si.external_parent_id, si.external_container_id, si.dedupe_key, si.occurred_at,
           si.title, si.url, ${BODY} as body, si.meta, si.from_me, si.deleted_upstream_at, ${CHANGED_AT} as changed_at
      from source_items si
     where si.owner_user_id = ${userId} and ${where}
     order by changed_at, si.id`);
  return r.rows.map(toRow);
}

async function loadMe(db: Db, userId: string): Promise<{ me: Me; workday: { start: string; end: string }; packSlug: string | null; packRaw: Record<string, unknown>; quarterTargetH: number; logging: LoggingProfile }> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new Error('projections: user not found');
  const persona = await loadPersona(db, userId);
  const kv = await db
    .select({ key: userSettings.key, value: userSettings.value })
    .from(userSettings)
    .where(and(eq(userSettings.ownerUserId, userId), inArray(userSettings.key, ['settings.profile', 'cc.meta'])));
  const profile = (kv.find((k) => k.key === 'settings.profile')?.value ?? {}) as { name?: string; timezone?: string; workingHours?: { start: string; end: string } };
  const meta = (kv.find((k) => k.key === 'cc.meta')?.value ?? {}) as { quarter?: { targetH?: number } };
  const [mePerson] = u.personId
    ? await db.select({ id: people.id, name: people.displayName }).from(people).where(eq(people.id, u.personId))
    : await db.select({ id: people.id, name: people.displayName }).from(people).where(and(eq(people.ownerUserId, userId), eq(people.isMe, true))).limit(1);
  const ids = mePerson ? await db.select({ system: personIdentities.system, externalId: personIdentities.externalId }).from(personIdentities).where(eq(personIdentities.personId, mePerson.id)) : [];
  const [pack] = u.teamPackId ? await db.select({ slug: teamPacks.slug, raw: teamPacks.raw }).from(teamPacks).where(eq(teamPacks.id, u.teamPackId)) : [];
  return {
    me: {
      userId,
      personId: mePerson?.id ?? userId,
      name: profile.name ?? u.displayName ?? u.email,
      email: u.email.toLowerCase(),
      org62UserId: ids.find((i) => i.system === 'org62_user')?.externalId ?? null,
      slackUserId: ids.find((i) => i.system === 'slack')?.externalId ?? null,
      timezone: profile.timezone || u.timezone || 'UTC',
    },
    workday: profile.workingHours ?? { start: '09:00', end: '18:00' },
    packSlug: pack?.slug ?? null,
    packRaw: (pack?.raw ?? {}) as Record<string, unknown>,
    // D-55: a persona with no hours target (the AE) has none; otherwise the stored quarter's (bootstrap: 250 h)
    quarterTargetH: personaTargetH(persona, meta.quarter?.targetH ?? 250),
    logging: loggingProfile(persona),
  };
}

function domainRules(me: Me, packSlug: string | null, raw: Record<string, unknown>): DomainRules {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase()) : null);
  const mine = domainOf(me.email);
  const internal = list(raw.internalDomains) ?? (packSlug ? (PACK_INTERNAL_DOMAINS[packSlug] ?? []) : []);
  return {
    internal: [...new Set([...(mine ? [mine] : []), ...internal])],
    partner: list(raw.partnerDomains) ?? [],
    ignore: [...new Set([...DEFAULT_IGNORE_DOMAINS, ...(list(raw.ignoreDomains) ?? [])])],
  };
}

async function readState(db: Db, userId: string): Promise<State | null> {
  const [r] = await db.select({ value: userSettings.value }).from(userSettings).where(and(eq(userSettings.ownerUserId, userId), eq(userSettings.key, STATE_KEY)));
  const v = r?.value as State | undefined;
  return v && v.version === PROJECTIONS_VERSION ? v : null;
}

async function writeState(tx: Tx, userId: string, s: State): Promise<void> {
  await tx
    .insert(userSettings)
    .values({ ownerUserId: userId, key: STATE_KEY, value: s })
    .onConflictDoUpdate({ target: [userSettings.ownerUserId, userSettings.key], set: { value: sql`excluded.value`, updatedAt: sql`now()` }, setWhere: sql`${userSettings.value} is distinct from excluded.value` });
}

async function writeCtx(tx: Tx, cs: WriteCtx['cs'], me: Me, now: Date, extractorId: string): Promise<WriteCtx> {
  return { tx, cs, userId: me.userId, me: { id: me.personId, name: me.name }, now, extractorId, timezone: me.timezone, kv: await loadKv(tx, me.userId) };
}

async function loadMatcher(tx: Tx | Db, userId: string, rules: DomainRules): Promise<Matcher> {
  const a = await tx.execute<{ id: string; name: string; org62: string | null; aliases: { kind: string; value: string }[] | null }>(sql`
    select a.id, a.name, a.org62_account_id as org62,
           coalesce(json_agg(json_build_object('kind', al.kind, 'value', al.value)) filter (where al.id is not null), '[]') as aliases
      from accounts a left join account_aliases al on al.account_id = a.id
     where a.owner_user_id = ${userId} and a.archived_at is null
     group by a.id, a.name, a.org62_account_id`);
  const o = await tx.execute<{ id: string; account_id: string | null; org62: string; name: string; is_closed: boolean; on_my_team: boolean; dc: boolean }>(sql`
    select o.id, o.account_id, o.org62_opportunity_id as org62, o.name, o.is_closed, o.on_my_team,
           (coalesce((select (s.value->>'dcAssigned')::boolean from user_settings s where s.owner_user_id = ${userId} and s.key = 'cc.ext/opportunities/' || o.id), false)
             or exists (select 1 from deal_contributions dc where dc.owner_user_id = ${userId} and dc.opportunity_id = o.id and dc.is_mine and dc.deleted_upstream_at is null)) as dc
      from opportunities o
     where o.owner_user_id = ${userId} and o.archived_at is null`);
  // D-69 (DC-23): the Org62 parents, from the account hierarchy once it is read (siblings by parent, not by name)
  const hv = await tx.execute<{ value: unknown }>(sql`select value from user_settings where owner_user_id = ${userId} and key = ${ACCOUNT_HIERARCHY_KV}`);
  const accounts: MatchAccount[] = withOrg62Parents(
    a.rows.map((r) => ({ id: r.id, name: r.name, org62AccountId: r.org62, aliases: r.aliases ?? [] })),
    hv.rows[0]?.value ? hierarchyOf(hv.rows[0].value) : null,
  );
  const opps: MatchOpp[] = o.rows.map((r) => ({ id: r.id, accountId: r.account_id, org62OpportunityId: r.org62, name: r.name, isClosed: r.is_closed, onMyTeam: r.on_my_team, myDc: r.dc }));
  const m = new Matcher(accounts, opps, rules);
  // domains of meetings whose title already names an account (the last 60 days of projected events)
  const ev = await tx.execute<{ title: string | null; external_domains: string[] | null }>(sql`
    select title, external_domains from calendar_events
     where owner_user_id = ${userId} and starts_at > now() - interval '60 days' and cardinality(coalesce(external_domains, '{}')) > 0`);
  m.learnDomains(ev.rows.map((r) => ({ title: r.title ?? '', domains: r.external_domains ?? [] })));
  return m;
}

/** Per user: the database time the last work-item account pass started (ACC-1). */
const lastWorkItemPass = new Map<string, Date>();

async function workItemAccountsPass(db: Db, userId: string, rules: DomainRules, since: Date | null): Promise<number> {
  const start = (await db.execute<{ t: string }>(sql`select now() as t`)).rows[0]!.t;
  const c = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from work_items
     where owner_user_id = ${userId} and account_id is null and merged_into_id is null
       and not ('account_id' = any(coalesce(user_locked_fields, '{}')))
       ${since ? sql`and updated_at > ${since.toISOString()}::timestamptz` : sql``}`);
  let n = 0;
  if (c.rows[0]!.n) {
    n =
      (await maybeChangeSet(db, userId, 'Projections: work item accounts', async (tx) => {
        const k = await matchWorkItemAccounts(tx, userId, await loadMatcher(tx, userId, rules), { since });
        return { result: k, wrote: k > 0 };
      })) ?? 0;
  }
  lastWorkItemPass.set(userId, new Date(start));
  return n;
}

const mappingOf = (m: { accountId: string; oppId: string | null; confidence: number } | null): Mapping =>
  m ? { accountId: m.accountId, opportunityId: m.oppId, mappingMethod: 'rule', mappingConfidence: m.confidence } : { accountId: null, opportunityId: null, mappingMethod: null, mappingConfidence: null };

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

export async function runProjections(o: ProjectionOptions): Promise<ProjectionResult> {
  const { db, userId } = o;
  const now = o.now ?? new Date();
  const log = o.log ?? (() => {});
  const written = zero();
  const errors: string[] = [];
  const state = o.full ? null : await readState(db, userId);
  const { me, workday, packSlug, packRaw, quarterTargetH, logging } = await loadMe(db, userId);
  const rules = domainRules(me, packSlug, packRaw);
  const extractorId = await ensureExtractor(db);

  const since = state?.watermark ? new Date(Date.parse(state.watermark) - SLACK_MS) : null;
  const changed = await loadSources(
    db,
    userId,
    sql`si.source in (${sql.join(SOURCES.map((s) => sql`${s}`), sql`, `)}) and (si.source <> 'slack' or si.from_me)${since ? sql` and ${CHANGED_AT} > ${since.toISOString()}::timestamptz` : sql``}`,
  );
  const refreshDue = !state?.weekRefreshedAt || now.getTime() - Date.parse(state.weekRefreshedAt) >= WEEK_REFRESH_MS;
  const newMark = maxIso(state?.watermark, ...changed.map((c) => c.changedAt));
  const markMoved = !!newMark && (!state?.watermark || Date.parse(newMark) - Date.parse(state.watermark) >= SLACK_MS);
  // items inside the re-read slack were already projected: nothing new unless something changed after the mark
  const fresh = state?.watermark ? changed.filter((c) => c.changedAt > state.watermark!) : changed;
  // ACC-1: new or changed work items get the account their title names, also on a pass with no new source items (a
  // quick capture, an edit). Its own watermark (this process, database clock): a restart sweeps the unmatched once.
  try {
    written.work_item_accounts += await workItemAccountsPass(db, userId, rules, o.full ? null : (lastWorkItemPass.get(userId) ?? null));
  } catch (e) {
    errors.push(`work_item_accounts:${errCode(e)}`);
  }
  if (!fresh.length && !refreshDue && !state?.pendingWeeks?.length) return { skipped: true, changedItems: 0, weeks: [], written, org62EventsWithoutStart: 0, errors };

  const bySource = (s: string) => changed.filter((c) => c.source === s);
  const weeks = new Set<string>();
  const addWeek = (at: string | null | undefined) => {
    if (at && !Number.isNaN(Date.parse(at))) weeks.add(weekOf(at, me.timezone).start);
  };
  let org62WithoutStart = 0;
  let bookSeen: ProjectionResult['book'] = null;
  let missedSeen = 0;
  let entitiesFailed = false;
  const failedWeeks: string[] = [];

  // ---------------- Stage A: entities
  try {
    await maybeChangeSet(db, userId, 'Projections: calendar, deals, sessions, assets', async (tx, cs) => {
      const w = await writeCtx(tx, cs, me, now, extractorId);
      let wrote = false;
      let bookChanged = false;

      // Org62 → my book and my Events (a full recompute over every Org62 snapshot: the book is an aggregate)
      if (bySource('org62').length || !state) {
        const all = await loadSources(tx, userId, sql`si.source = 'org62'`);
        const book = projectOrg62(all, { me: me.org62UserId }); // DC-13: a DC another SE holds now is not mine
        org62WithoutStart = book.eventsWithoutStart;
        bookSeen = book.bookRead ? { ...book.bookRead, openTeamOpps: book.opps.filter((o) => o.inBook).length, left: book.opps.filter((o) => o.leftBookAt).length } : null;
        const inBook = oppsInBook(book);
        const hours = new Map<string, number>(); // org62 opp/account id (15) → my logged hours this quarter
        const qStart = fiscalQuarterStart(now, me.timezone);
        for (const e of book.events) {
          if (!e.whatOrg62Id || localDay(e.startsAt, me.timezone) < qStart) continue;
          const h = e.durationField ?? (Date.parse(e.endsAt) - Date.parse(e.startsAt)) / 3_600_000;
          hours.set(id15(e.whatOrg62Id), (hours.get(id15(e.whatOrg62Id)) ?? 0) + h);
        }
        const acctIds = new Map<string, string>();
        for (const a of book.accounts) {
          const opps = inBook.filter((x) => id15(x.org62AccountId) === id15(a.org62AccountId));
          // DEALS-1: the DC status is about my open opps (team, DC, or my hours), not every opp on the account.
          const open = opps.filter((x) => !x.isClosed && (x.onMyTeam || x.myDc || x.inBook || (x.sweep?.hours ?? 0) > 0 || (hours.get(id15(x.org62OpportunityId)) ?? 0) > 0));
          const dcOpen = open.filter((x) => x.myDc).length;
          const acctHours = opps.reduce((s, x) => s + (hours.get(id15(x.org62OpportunityId)) ?? 0), hours.get(id15(a.org62AccountId)) ?? 0);
          const r = await upsertAccountFromOrg62(
            w,
            {
              org62AccountId: a.org62AccountId,
              name: a.name,
              ext: { org62Url: org62RecordUrl('Account', a.org62AccountId), dcStatus: !open.length || !dcOpen ? 'none' : dcOpen === open.length ? 'assigned' : 'partial', hoursQtd: Math.round(acctHours * 100) / 100 },
            },
            uuidFor(`proj:account:${userId}:${a.org62AccountId}`),
          );
          acctIds.set(id15(a.org62AccountId), r.id);
          if (r.written) {
            written.accounts++;
            bookChanged = true;
          }
        }
        // Opps that left my book (the complete daily book read no longer lists them) are marked, never deleted;
        // one whose account is no longer in my book is only marked when it already has a row.
        const projectedIds = new Set(inBook.map((o) => id15(o.org62OpportunityId)));
        const leftOut = book.opps.filter((o) => (o.leftBookAt || o.notInBookAt) && !projectedIds.has(id15(o.org62OpportunityId)));
        const leftRows = leftOut.length
          ? new Set(
              (
                await tx.execute<{ org62: string }>(sql`
                  select org62_opportunity_id as org62 from opportunities
                   where owner_user_id = ${userId} and on_my_team and org62_opportunity_id in (${sql.join(leftOut.map((o) => sql`${o.org62OpportunityId}`), sql`, `)})`)
              ).rows.map((x) => id15(x.org62)),
            )
          : new Set<string>();
        const oppIds = new Map<string, string>(); // org62 opp id (15) → app opportunity id
        for (const op of [...inBook, ...leftOut.filter((o) => leftRows.has(id15(o.org62OpportunityId)))]) {
          const r = await upsertOpportunityFromOrg62(
            w,
            {
              org62OpportunityId: op.org62OpportunityId,
              accountId: op.org62AccountId ? (acctIds.get(id15(op.org62AccountId)) ?? null) : null,
              name: op.name,
              stage: op.stage,
              amount: op.amount,
              closeDate: op.closeDate,
              forecastCategory: op.forecastCategory,
              type: op.type,
              isClosed: op.isClosed,
              isWon: op.isWon,
              // holding a DC is not being on the team (myDc / ext.dcAssigned and deal_contributions say that)
              onMyTeam: !op.leftBookAt && op.onMyTeam,
              teamKnown: op.teamKnown,
              myTeamRole: op.myTeamRole,
              org62ModifiedAt: op.org62ModifiedAt,
              ext: { dcAssigned: op.myDc, nextStep: op.nextStep, nextStepRead: op.nextStepRead, org62Url: org62RecordUrl('Opportunity', op.org62OpportunityId), hoursQtd: Math.round((hours.get(id15(op.org62OpportunityId)) ?? 0) * 100) / 100 },
              leftBookAt: op.leftBookAt,
              notInBookAt: op.notInBookAt,
            },
            uuidFor(`proj:opportunity:${userId}:${op.org62OpportunityId}`),
          );
          oppIds.set(id15(op.org62OpportunityId), r.id);
          if (op.myTeamRole && me.org62UserId && op.onMyTeam && !op.leftBookAt && !op.notInBookAt) await upsertMyTeamMembership(w, r.id, me.org62UserId, op.myTeamRole);
          if (r.written) {
            written.opportunities++;
            bookChanged = true;
          }
        }
        // My DCs (split, role) into deal_contributions, and the DC requests they confirm (Deals ▸ DCs). A DC on an opp
        // this pass did not project (its account is outside the book read, or it was stored by another read) links to
        // the opp row the app already has for that Org62 id (15 characters), so `myDc` shows its split on that opp
        // instead of "assigned, split not read" (PROJECTIONS_VERSION 6 re-links the DCs already stored).
        const unlinked = [...new Set(book.dcs.map((d) => (d.org62OpportunityId ? id15(d.org62OpportunityId) : null)).filter((k): k is string => !!k && !oppIds.has(k)))];
        if (unlinked.length) {
          const rows = await tx.execute<{ id: string; org62: string }>(sql`
            select id, org62_opportunity_id as org62 from opportunities
             where owner_user_id = ${userId} and archived_at is null and left(org62_opportunity_id, 15) in (${sql.join(unlinked.map((k) => sql`${k}`), sql`, `)})
             order by created_at, id`);
          for (const r of rows.rows) if (!oppIds.has(id15(r.org62))) oppIds.set(id15(r.org62), r.id);
        }
        const dcRows = await syncMyDcs(
          w,
          book.dcs.map((d) => ({ org62DcId: d.org62DcId, opportunityId: d.org62OpportunityId ? (oppIds.get(id15(d.org62OpportunityId)) ?? null) : null, role: d.role, splitPercent: d.splitPercent, seenAt: d.seenAt, sourceItemId: d.sourceItemId })),
          me.org62UserId ?? null,
          { book }, // D-68: the complete read, the accounts that left the book or were merged
        );
        if (dcRows) {
          written.deal_contributions += dcRows;
          wrote = true;
        }
        wrote ||= bookChanged;
        const matcher0 = await loadMatcher(tx, userId, rules);
        // D-65 (TL-13): a snapshot the runner recorded (REC-2 `rec: auto`: every field, a blank one as null) says what
        // Org62 has now, also a Related To cleared there (the merge across snapshots would bring an older WhatId back)
        const snapById = new Map(all.map((s) => [s.id, s.meta] as const));
        for (const e of book.events) {
          const snap = snapById.get(e.sourceItemId);
          if (snap?.rec === 'auto' && 'WhatId' in snap && !isSfId(snap.WhatId)) {
            e.whatOrg62Id = null;
            e.whatName = null;
          }
        }
        for (const e of book.events) {
          const opp = matcher0.oppByOrg62(e.whatOrg62Id);
          const acct = opp?.accountId ?? matcher0.accountByOrg62(e.whatOrg62Id)?.id ?? null;
          const r = await upsertOrg62Event(w, { ...e, opportunityId: opp?.id ?? null, accountId: acct });
          if (r.written) {
            written.org62_events++;
            wrote = true;
            addWeek(e.startsAt);
          }
        }
        // Logged rows are kept for every quarter (past weeks and History show them; the pages total only this
        // quarter's). Weeks of Org62 Events with no logged row yet (an older pass skipped other quarters) get a pass.
        const unlogged = await tx.execute<{ s: Date | string }>(sql`
          select e.starts_at as s from org62_events e
           where e.owner_user_id = ${userId} and e.deleted_upstream_at is null
             and not exists (select 1 from activity_entries a where a.owner_user_id = e.owner_user_id and a.org62_event_row_id = e.id)`);
        for (const x of unlogged.rows) addWeek(iso(x.s));
        // Drift: a verified row whose opp no longer matches its Org62 Event gets a pass, so it follows Org62
        for (const s0 of await driftedLoggedRowStarts(tx, userId)) addWeek(s0);
        // D-65: a row on a live Org62 Event that an older rule hid as overlap gets a pass, so it shows (flagged) again
        for (const s0 of await hiddenOrg62RowStarts(tx, userId)) addWeek(s0);
        // HYG-1: a row still verified or logged on an Event deleted in Org62 gets a pass, so it says "Deleted in Org62"
        const gone = await tx.execute<{ s: Date | string }>(sql`
          select distinct a.starts_at as s from activity_entries a join org62_events e on e.id = a.org62_event_row_id
           where a.owner_user_id = ${userId} and e.deleted_upstream_at is not null and a.status in ('approved', 'synced_to_canvas', 'logged', 'verified')`);
        for (const x of gone.rows) addWeek(iso(x.s));

        // Missed opportunities (Deals ▸ Missed): the deals engine over the stored Org62 data. Read only: claiming
        // and dismissing stay the user's (drafts and dry runs, invariant 1).
        if (me.org62UserId) {
          const res = missedOpps({
            book,
            me: { org62UserId: me.org62UserId, name: me.name },
            evidence: { ...(await missedEvidence(tx, userId, now)), slack: await missedSlackEvidence(tx, userId, now) }, // DC-33
            today: localDay(now.toISOString(), me.timezone),
            quarter: { start: qStart, end: addDays(addMonths(qStart, 3), -1) },
          });
          const n = await writeMissedFindings(w, tx, res, book);
          missedSeen = res.findings.length;
          if (n) {
            written.missed_findings += n;
            wrote = true;
          }
        }
      }

      const matcher = await loadMatcher(tx, userId, rules);
      const windowFrom = new Date(now.getTime() - REMATCH_BACK_DAYS * 86_400_000).toISOString();
      const windowTo = new Date(now.getTime() + REMATCH_AHEAD_DAYS * 86_400_000).toISOString();

      // Calendar → events (all of an event's items, so a cancellation marker and the event row are weighed together)
      const calKeys = new Set(bySource('calendar').map((si) => calendarKey(si)?.externalEventId).filter((x): x is string => !!x));
      const calItems = bookChanged || !state
        ? await loadSources(tx, userId, sql`si.source = 'calendar' and si.occurred_at between ${windowFrom}::timestamptz - interval '1 day' and ${windowTo}::timestamptz`)
        : calKeys.size
          ? await loadSources(tx, userId, sql`si.source = 'calendar' and (si.meta->>'eventId' in (${sql.join([...calKeys].map((k) => sql`${k}`), sql`, `)}) or si.external_id in (${sql.join([...calKeys].map((k) => sql`${k}`), sql`, `)}))`)
          : [];
      const projected: ProjectedEvent[] = [];
      const eventIds = new Map<string, string>(); // externalEventId → row id
      const personByEmail = await emailDirectory(tx, userId);
      for (const [, r] of resolveCalendarItems(calItems)) {
        const key = calendarKey((r.event ?? r.cancelled)!)!;
        const gone = isGone(r);
        if (gone && (!!r.event?.deletedUpstreamAt || !r.event)) {
          // deleted at the source, or a marker for an event we never saw: flag the row we have, if any
          if (await markCalendarEventGone(w, key.calendarId, key.externalEventId, r.event?.deletedUpstreamAt ? 'deleted' : 'cancelled')) {
            written.cancelled_events++;
            wrote = true;
          }
          addWeek(r.event?.occurredAt ?? (r.cancelled?.meta.start as string | undefined));
          continue;
        }
        const projectedEv = projectCalendarEvent(r.event!, me, rules);
        if (!projectedEv) continue;
        // cancelled upstream: the event stays, as cancelled (Today labels it; it never blocks time)
        const ev: ProjectedEvent = gone ? { ...projectedEv, status: 'cancelled' } : projectedEv;
        if (!gone) projected.push(ev);
        const match = matcher.resolve(ev.title, ev.externalDomains);
        const up = await upsertCalendarEventFromSource(
          w,
          {
            ...ev,
            ...mappingOf(match),
            attendees: ev.attendees.map((a) => ({ ...a, personId: personByEmail.get(a.email) ?? (a.isSelf ? me.personId : null), displayName: null })),
          },
          uuidFor(`proj:calendar_event:${userId}:${ev.calendarId}:${ev.externalEventId}`),
        );
        eventIds.set(ev.externalEventId, up.id);
        if (up.written) {
          if (gone) written.cancelled_events++;
          else written.calendar_events++;
          wrote = true;
          addWeek(ev.startsAt);
        }
      }

      // Claude sessions
      const sessItems = bookChanged || !state ? await loadSources(tx, userId, sql`si.source = 'claude'`) : bySource('claude');
      for (const si of sessItems) {
        const s = projectClaudeSession(si);
        if (!s) continue;
        const match = matcher.resolve([s.repo, s.cwd ? s.cwd.split('/').slice(-3).join(' ') : null, s.gitBranch, s.title].filter(Boolean).join(' '));
        const up = await upsertSessionFromSource(w, { ...s, ...mappingOf(match), deepLink: sessionDeepLink(s) }, uuidFor(`proj:claude_session:${userId}:${s.sessionExternalId}`));
        if (up.written) {
          written.claude_sessions++;
          wrote = true;
          addWeek(s.lastActivityAt);
          addWeek(s.startedAt);
        }
        // its prompts (engaged time, 2026-11-14): every week they fall in recomputes, also when only they changed
        for (const t of humanTurnsOf(si.meta)) addWeek(t.at);
      }

      // Drive files → assets (all revisions of every changed file, plus invite attachments)
      const driveChanged = bookChanged || !state ? await loadSources(tx, userId, sql`si.source = 'drive'`) : bySource('drive');
      const fileIds = [...new Set(driveChanged.map((si) => driveEdit(si)?.fileId).filter((x): x is string => !!x))];
      const driveAll = fileIds.length && state && !bookChanged ? await loadSources(tx, userId, sql`si.source = 'drive' and si.meta->>'fileId' in (${sql.join(fileIds.map((f) => sql`${f}`), sql`, `)})`) : driveChanged;
      for (const si of driveChanged) {
        const e = driveEdit(si);
        if (e?.byMe) addWeek(e.at);
      }
      const assetList = mergeAssets(assetsFromDrive(driveAll), assetsFromEvents(projected));
      const workByFile = await workItemsByFile(tx, userId, assetList.map((a) => a.externalId));
      for (const a of assetList) {
        const evRow = a.eventExternalId ? eventIds.get(a.eventExternalId) : undefined;
        const evMatch = evRow ? await tx.select({ accountId: calendarEvents.accountId, opportunityId: calendarEvents.opportunityId }).from(calendarEvents).where(eq(calendarEvents.id, evRow)) : [];
        const match = matcher.resolve(a.title) ?? (evMatch[0]?.accountId ? { accountId: evMatch[0].accountId, oppId: evMatch[0].opportunityId, via: 'title' as const, confidence: 0.6 } : null);
        const up = await upsertDriveAsset(w, { ...a, ...mappingOf(match), workItemIds: workByFile.get(a.externalId) ?? [] }, uuidFor(`proj:asset:${userId}:drive:${a.externalId}`));
        if (up.written) {
          written.assets++;
          wrote = true;
        }
      }

      // Gemini notes → meeting notes + the event's takeaways
      const noteItems = state && !bookChanged ? bySource('gemini_notes') : await loadSources(tx, userId, sql`si.source = 'gemini_notes'`);
      for (const si of noteItems) {
        const n = projectGeminiNote(si);
        if (!n) continue;
        const eventId = n.eventExternalId ? (eventIds.get(n.eventExternalId) ?? (await eventRowId(tx, userId, n.eventExternalId))) : null;
        const up = await upsertMeetingNote(w, { ...n, calendarEventId: eventId });
        if (up.written) {
          written.meeting_notes++;
          wrote = true;
        }
        if (eventId) {
          const items = await workItemsFromSource(tx, si.id);
          if (await setEventTakeaways(w, eventId, { count: items.length, workItemIds: items, notesUrl: n.url })) wrote = true;
          addWeek(si.occurredAt);
        }
      }

      // Work items → the account their title names (ACC-1): new or changed items, and all of them when the book changed.
      const named = await matchWorkItemAccounts(tx, userId, matcher, { since: bookChanged || !state ? null : since });
      if (named) {
        written.work_item_accounts += named;
        wrote = true;
      }

      for (const si of bySource('slack')) addWeek(si.occurredAt);
      return { result: null, wrote };
    });
  } catch (e) {
    entitiesFailed = true;
    errors.push(`entities:${errCode(e)}`);
    log('projections: entities stage failed', { code: errCode(e) });
    if (process.env.CC_PROJECTIONS_DEBUG === '1') console.error(e);
  }

  // ---------------- Stage B: the Time page, per affected week
  if (refreshDue) addWeek(now.toISOString());
  for (const p of state?.pendingWeeks ?? []) weeks.add(p);
  if (!state) {
    for (let i = 1; i <= 5; i++) addWeek(new Date(now.getTime() - i * 7 * 86_400_000).toISOString());
    addWeek(new Date(now.getTime() + 7 * 86_400_000).toISOString());
  }
  // Onsite corrections (day chips, Mark trip, an Undo of either): the weeks they touch recompute until their stored
  // onsite record carries the corrections' hash.
  for (const ws of await onsiteWeeksDue(db, userId)) weeks.add(ws);
  const weekList = [...weeks].sort();
  const vocab = await loadVocab(db, userId);
  const cfg: ActivityConfig = {
    timezone: me.timezone,
    ownerId: me.org62UserId ?? '',
    recordTypeId: '',
    lightningHost: 'https://org62.lightning.force.com',
    workday,
    hoursTarget: quarterTargetH,
    liveFrom: '1970-01-01',
    // D-55: the persona's record type and task-type rule (the SE's: Solutions Event, required). No hour caps (2026-11-14).
    recordTypeName: logging.recordTypeName,
    taskTypeRequired: logging.taskTypeRequired,
    // D-64: the persona's internal-only activity (the SE's)
    internalActivity: logging.internalActivity,
    evidence: DEFAULT_EVIDENCE_CONFIG,
    quarters: [],
    ...(await loadTimeConfig(db, userId, logging.overlaps)),
  };
  for (const ws of weekList) {
    try {
      const n = await maybeChangeSet(db, userId, `Projections: time, week of ${ws}`, async (tx, cs) => {
        const w = await writeCtx(tx, cs, me, now, extractorId);
        const r = await projectWeek(w, tx, ws, { me, rules, cfg, vocab });
        return { result: r, wrote: r.entries + r.blocks > 0 };
      });
      if (n) {
        written.activity_entries += n.entries;
        written.time_blocks += n.blocks;
      }
    } catch (e) {
      failedWeeks.push(ws);
      errors.push(`week:${ws}:${errCode(e)}`);
      log('projections: week failed', { week: ws, code: errCode(e) });
      if (process.env.CC_PROJECTIONS_DEBUG === '1') console.error(e);
    }
  }

  // ---------------- state: the mark moves only past what Stage A projected; failed weeks are retried next tick
  const pendingChanged = (state?.pendingWeeks ?? []).join() !== failedWeeks.join();
  if (!entitiesFailed && (fresh.length || markMoved || refreshDue || !state || pendingChanged)) {
    await withChangeSet({ db, userId, actor: actors.engine(`projections@${PROJECTIONS_VERSION}`), reason: 'Projections: watermark', undoable: false }, async (tx) => {
      await writeState(tx, userId, {
        version: PROJECTIONS_VERSION,
        watermark: newMark ?? state?.watermark ?? null,
        weekRefreshedAt: refreshDue ? now.toISOString() : (state?.weekRefreshedAt ?? null),
        ...(failedWeeks.length ? { pendingWeeks: failedWeeks } : {}),
      });
    });
  }

  const total = Object.values(written).reduce((s, n) => s + n, 0);
  if (total || errors.length) {
    // counts only (tenet: Local data, privacy-safe logs)
    const bs = bookSeen as ProjectionResult['book']; // assigned inside the change-set callback
    const b = bs ? { book_rows: bs.seen, book_expected: bs.expected, book_authoritative: bs.authoritative, book_left: bs.left } : {};
    log('projections', { changed: fresh.length, weeks: weekList.length, ...written, ...b, missed: missedSeen, errors: errors.length });
  }
  return { skipped: false, changedItems: fresh.length, weeks: weekList, written, org62EventsWithoutStart: org62WithoutStart, book: bookSeen, missedFindings: missedSeen, errors };
}

// ---------------------------------------------------------------------------
// Stage B: one week
// ---------------------------------------------------------------------------

interface WeekCtx {
  me: Me;
  rules: DomainRules;
  cfg: ActivityConfig;
  vocab: Awaited<ReturnType<typeof loadVocab>>;
}

/** The verify issue of an app row whose Org62 Event was deleted there (org62.readback; Time shows it on the row). */
export const DELETED_IN_ORG62_ISSUE = DELETED_IN_ORG62;

/** A text[] / uuid[] literal of these values (never empty: callers check). */
const textArr = (vals: readonly string[]) => sql`array[${sql.join(vals.map((v) => sql`${v}::text`), sql`, `)}]`;
const uuidArr = (vals: readonly string[]) => sql`array[${sql.join(vals.map((v) => sql`${v}::uuid`), sql`, `)}]`;

const ownedRow = (r: ActivityRow) => OWNED_ACTIVITY_PREFIXES.some((p) => r.dedupeKey.startsWith(p)) && ENGINE_STATUSES.has(r.status) && !(r.userLockedFields ?? []).length;

/** Options of a week's load: the re-derive's read-only stand-ins (rederive.ts). */
export interface LoadWeekOptions {
  /**
   * A session's human turns when its source item has none yet (a transcript the scanner has not re-read since the
   * prompts were stored, 2026-11-14): the dry run reads them from the local transcript, read-only.
   */
  turnsOf?: (sessionExternalId: string) => { at: string; runEndsAt: string }[] | null;
}

/** One week, loaded and planned (no writes): what `projectWeek` applies and the re-derive compares. */
export interface LoadedWeek {
  weekStart: string;
  from: Date;
  end: Date;
  input: WeekInput;
  plan: WeekPlan;
  want: ActivityProjection[];
  moves: (WeekPlan['moves'][number] & { adopt?: WeekPlan['moves'][number]['adopt'] & { opportunityId?: string | null; accountId?: string | null; whatName?: string | null } })[];
  /** The week's rows, and my rows of its meetings that sit in another week (TL-32). */
  mine: ActivityRow[];
  sameMeeting: ActivityRow[];
  held: Set<string>;
  blocksExisting: Awaited<ReturnType<typeof loadBlockWindow>>;
  overrides: OnsiteOverrides;
  matcher: Matcher;
  /** Org62 Events by their row id: the Salesforce id of the Event a row is tied to. */
  org62Ids: Map<string, string>;
}

async function loadWeek(w: WriteCtx, tx: Tx, weekStart: string, c: WeekCtx, opts: LoadWeekOptions = {}): Promise<LoadedWeek> {
  const tz = c.me.timezone;
  const from = new Date(zoned(weekStart, tz));
  const to = new Date(from.getTime() + 7 * 86_400_000 + 2 * 3_600_000); // DST-safe: next Monday 00:00 local, recomputed below
  const nextMon = new Date(zoned(addDays(weekStart, 7), tz));
  const end = nextMon.getTime() < to.getTime() ? nextMon : to;
  const inWin = (iso: string | null | undefined) => !!iso && Date.parse(iso) >= from.getTime() && Date.parse(iso) < end.getTime();
  const userId = c.me.userId;

  const matcher = await loadMatcher(tx, userId, c.rules);
  const eventsIn = async (lo: Date, hi: Date, notIn?: { lo: Date; hi: Date }): Promise<WeekEvent[]> => {
    const r = await tx.execute<{
      id: string; calendar_id: string; external_event_id: string; title: string | null; starts_at: Date; ends_at: Date; is_all_day: boolean; event_type: string; status: string;
      my_response: string; i_am_organizer: boolean; attendance: string; external_domains: string[] | null; recurring_event_id: string | null; html_link: string | null;
      account_id: string | null; opp_org62: string | null; has_notes: boolean; local_day: string; location: string | null;
    }>(sql`
      select e.id, e.calendar_id, e.external_event_id, e.title, e.starts_at, e.ends_at, e.is_all_day, e.event_type, e.status, e.my_response, e.i_am_organizer,
             e.attendance, e.external_domains, e.recurring_event_id, e.html_link, e.account_id, o.org62_opportunity_id as opp_org62, e.local_day::text as local_day,
             -- the column (0009); rows not re-projected since still carry it in ext
             coalesce(e.location, x.value->>'location') as location,
             exists (select 1 from meeting_notes n where n.calendar_event_id = e.id) as has_notes
        from calendar_events e
        left join opportunities o on o.id = e.opportunity_id
        left join user_settings x on x.owner_user_id = e.owner_user_id and x.key = 'cc.ext/calendar_events/' || e.id::text
       where e.owner_user_id = ${userId} and e.deleted_upstream_at is null
         and e.starts_at >= ${lo.toISOString()}::timestamptz and e.starts_at < ${hi.toISOString()}::timestamptz
         ${notIn ? sql`and not (e.starts_at >= ${notIn.lo.toISOString()}::timestamptz and e.starts_at < ${notIn.hi.toISOString()}::timestamptz)` : sql``}`);
    return r.rows.map((r) => {
      const endIso = iso(r.ends_at);
      return {
        rowId: r.id,
        calendarId: r.calendar_id,
        externalEventId: r.external_event_id,
        title: r.title ?? '',
        startsAt: iso(r.starts_at),
        endsAt: endIso,
        isAllDay: r.is_all_day,
        eventType: r.event_type,
        cancelled: r.status === 'cancelled',
        myResponse: r.my_response,
        iAmOrganizer: r.i_am_organizer,
        attendance: r.attendance,
        attendeeDomains: r.external_domains ?? [],
        recurring: !!r.recurring_event_id,
        hasNotes: r.has_notes,
        url: r.html_link,
        accountId: r.account_id,
        oppOrg62Id: r.opp_org62,
        location: r.location,
        // all-day: dates; rows stored before 0009 sit at UTC midnight, newer ones at local midnight
        allDayFrom: r.is_all_day ? r.local_day : null,
        allDayTo: r.is_all_day ? (endIso.endsWith('T00:00:00.000Z') ? endIso.slice(0, 10) : localDay(endIso, tz)) : null,
      };
    });
  };
  const events = await eventsIn(from, end);
  // a week each side: hotel stays, flights and onsite markers decide the trips this week's days belong to
  const context = await eventsIn(new Date(from.getTime() - 8 * 86_400_000), new Date(end.getTime() + 8 * 86_400_000), { lo: from, hi: end });
  const overrides = readOnsiteOverrides(w.kv);

  const sessRows = await tx
    .select({ id: claudeSessions.id, title: claudeSessions.title, cwd: claudeSessions.cwd, startedAt: claudeSessions.startedAt, lastActivityAt: claudeSessions.lastActivityAt, accountId: claudeSessions.accountId, sourceItemId: claudeSessions.sourceItemId, sessionExternalId: claudeSessions.sessionExternalId, desktopSessionId: claudeSessions.desktopSessionId })
    .from(claudeSessions)
    .where(and(eq(claudeSessions.ownerUserId, userId), sql`${claudeSessions.lastActivityAt} >= ${from.toISOString()}::timestamptz`, sql`coalesce(${claudeSessions.startedAt}, ${claudeSessions.lastActivityAt}) < ${end.toISOString()}::timestamptz`));
  const lastPrompt = new Map<string, string | null>();
  const turnsBySource = new Map<string, { at: string; runEndsAt: string }[]>();
  const sourceIds = sessRows.map((s) => s.sourceItemId).filter((x): x is string => !!x);
  if (sourceIds.length) {
    const lp = await tx.execute<{ id: string; at: string | null; turns: unknown }>(sql`select id, meta->>'lastHumanPromptAt' as at, meta->'humanTurns' as turns from source_items where id in (${sql.join(sourceIds.map((x) => sql`${x}::uuid`), sql`, `)})`);
    for (const r of lp.rows) {
      lastPrompt.set(r.id, r.at);
      const t = humanTurnsOf({ humanTurns: r.turns });
      if (t.length) turnsBySource.set(r.id, t);
    }
  }
  const repos: Record<string, string> = {};
  const sessions = sessRows
    .filter((s) => !!s.lastActivityAt)
    .map((s) => {
      const repoKey = s.cwd ? basename(s.cwd) || 'claude' : 'claude';
      if (s.accountId && !repos[repoKey]) repos[repoKey] = s.accountId;
      return {
        rowId: s.id,
        title: s.title ?? 'Claude session',
        url: s.sessionExternalId ? claudeSessionLink(s.sessionExternalId, s.desktopSessionId) : null,
        repoKey,
        startedAt: s.startedAt ? s.startedAt.toISOString() : null,
        lastActivityAt: s.lastActivityAt!.toISOString(),
        lastHumanPromptAt: s.sourceItemId ? (lastPrompt.get(s.sourceItemId) ?? null) : null,
        accountId: s.accountId,
        turns: (s.sourceItemId ? turnsBySource.get(s.sourceItemId) : undefined) ?? (s.sessionExternalId ? (opts.turnsOf?.(s.sessionExternalId) ?? null) : null),
      };
    });

  const winSql = sql`si.occurred_at >= ${from.toISOString()}::timestamptz and si.occurred_at < ${end.toISOString()}::timestamptz`;
  const driveRows = await loadSources(tx, userId, sql`si.source = 'drive' and ${winSql}`);
  const driveUrlOf = new Map(driveRows.map((si) => [si.id, sourceItemUrl(si)]));
  const drive = driveRows
    .map(driveEdit)
    .filter((d): d is NonNullable<typeof d> => !!d && d.byMe && inWin(d.at))
    .map((d) => ({ fileId: d.fileId, title: d.title, at: d.at, url: driveUrlOf.get(d.sourceItemId) ?? null }));
  const slack = (await loadSources(tx, userId, sql`si.source = 'slack' and si.from_me and ${winSql}`)).map((si) => ({
    id: si.id,
    channelId: si.externalId.split(':')[0] ?? 'slack',
    at: si.occurredAt,
    url: sourceItemUrl(si),
    externalId: si.externalId,
    channelName: typeof si.meta.channelName === 'string' ? si.meta.channelName : null,
  }));
  // the emails I sent: recipients' domains only (never addresses)
  const emails: WeekEmail[] = (await loadSources(tx, userId, sql`si.source = 'gmail' and si.from_me and ${winSql}`)).map((si) => ({
    id: si.id,
    subject: si.title,
    domains: emailDomains(si.meta),
    at: si.occurredAt,
  }));

  const existingWin = await loadActivityWindow(w, new Date(from.getTime() - 86_400_000), new Date(end.getTime() + 86_400_000));
  // D-65 (TL-32): my rows of this week's meetings that sit at another time (rescheduled across a week boundary): they
  // follow their meeting, and its new time opens no proposal
  const winIds = new Set(existingWin.map((r) => r.id));
  const idents = [...new Set(events.map((e) => `cal|${e.calendarId}|${e.externalEventId}|`))];
  const sameMeeting = idents.length
    ? (
        await tx
          .select()
          .from(activityEntries)
          .where(and(eq(activityEntries.ownerUserId, userId), sql`split_part(${activityEntries.dedupeKey}, '|', 1) = 'cal' and ('cal|' || split_part(${activityEntries.dedupeKey}, '|', 2) || '|' || split_part(${activityEntries.dedupeKey}, '|', 3) || '|') = any(${textArr(idents)})`))
      ).filter((r) => !winIds.has(r.id) && !ownedRow(r))
    : [];
  const existing = [...existingWin, ...sameMeeting];

  // D-65 (TL-12, TL-23): the week's Org62 Events, the ones my rows are tied to wherever they moved, and the CC# key each
  // carries (read from its newest snapshot: the scans read Description for it, never store its text)
  const linkedIds = [...new Set(existing.filter((r) => !ownedRow(r) && r.org62EventRowId).map((r) => r.org62EventRowId!))];
  const o62 = await tx.execute<{ id: string; org62_event_id: string; record_type_name: string; subject: string | null; starts_at: Date; ends_at: Date; duration_field: number | string | null; se_task_type_name: string | null; meeting_type_name: string | null; what_org62_id: string | null; logged_at: Date | string | null; cc_key: string | null }>(sql`
    select e.id, e.org62_event_id, e.record_type_name, e.subject, e.starts_at, e.ends_at, e.duration_field, e.se_task_type_name, e.meeting_type_name, e.what_org62_id,
           coalesce(e.org62_created_at, e.org62_modified_at) as logged_at, si.meta->>'ccKey' as cc_key
      from org62_events e left join source_items si on si.id = e.source_item_id
     where e.owner_user_id = ${userId} and e.deleted_upstream_at is null
       and ((e.starts_at >= ${from.toISOString()}::timestamptz and e.starts_at < ${end.toISOString()}::timestamptz)
            ${linkedIds.length ? sql`or e.id = any(${uuidArr(linkedIds)})` : sql``})`);
  const org62 = o62.rows.map((r) => ({
    rowId: r.id,
    org62EventId: r.org62_event_id,
    recordTypeName: r.record_type_name,
    subject: r.subject,
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    durationField: r.duration_field === null ? null : Number(r.duration_field),
    seTaskTypeName: r.se_task_type_name,
    meetingTypeName: r.meeting_type_name,
    whatOrg62Id: r.what_org62_id,
    ownerId: c.me.org62UserId,
    whatName: null as string | null,
    ccKey: r.cc_key && /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(r.cc_key) ? r.cc_key : null,
  }));

  // fixed = the user's rows, and the neighbouring weeks' rows (their own pass owns them; ours must not overlap them)
  const fixed: FixedEntry[] = existing
    .filter((r) => !ownedRow(r) || !inWin(r.startsAt.toISOString()))
    .map((r) => ({
      rowId: r.id,
      dedupeKey: r.dedupeKey,
      subject: r.subject,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      durationHours: Number(r.durationHours),
      seTaskType: r.seTaskTypeId ? (c.vocab.taskTypeById.get(r.seTaskTypeId) ?? null) : null,
      whatOrg62Id: r.whatOrg62Id,
      meetingType: null,
      status: r.status,
      excludedReason: r.excludedReason,
      operation: r.operation,
      targetOrg62EventId: r.targetOrg62EventId,
      flags: r.flags ?? [],
      org62EventRowId: r.org62EventRowId,
      lockedFields: r.userLockedFields ?? [],
    }));
  // D-65 (TL-12): an Event of this week that a row outside this pass is tied to is that row's (never a second row here)
  const fixedIds = new Set(fixed.map((f) => f.rowId));
  const winEventRows = o62.rows.map((r) => r.id);
  const tiedElsewhere = winEventRows.length
    ? (
        await tx.execute<{ id: string; ev: string; dedupe_key: string; status: string; locks: string[] | null }>(sql`
          select a.id, e.org62_event_id as ev, a.dedupe_key, a.status::text as status, a.user_locked_fields as locks
            from activity_entries a join org62_events e on e.id = a.org62_event_row_id
           where a.owner_user_id = ${userId} and a.org62_event_row_id = any(${uuidArr(winEventRows)})
             and a.status in ('approved', 'synced_to_canvas', 'logged', 'verified', 'verify_failed')`)
      ).rows.filter((x) => !fixedIds.has(x.id) && !ownedRow({ dedupeKey: x.dedupe_key, status: x.status, userLockedFields: x.locks } as ActivityRow))
    : [];
  const linkedElsewhere = new Set(tiedElsewhere.map((x) => x.ev));
  const blocksExisting = await loadBlockWindow(w, from, end);
  const fixedBlocks = blocksExisting.filter((b) => b.engineVersion !== ENGINE_VERSION && b.countsAsHumanHours).map((b) => ({ startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString() }));

  const names = (id: string) => {
    const o = matcher.oppByOrg62(id);
    // mine: on the team or my DC (a meeting the resolver put on someone else's opp waits for the user's Approve)
    if (o) return { name: o.name, mine: o.onMyTeam || o.myDc };
    const a = matcher.accountByOrg62(id);
    return a ? { name: a.name } : null;
  };
  const held = await heldActivityRows(tx, userId);
  const notesByEvent = await meetingNoteFacts(tx, userId, events.filter((e) => e.hasNotes).map((e) => e.rowId));
  const useCases = await vdpUseCases(tx, userId);
  // every quarter's Org62 Events are logged rows (past weeks and History show them; the pages total this quarter's)
  const input: WeekInput = {
    now: w.now.toISOString(),
    from: from.toISOString(),
    to: end.toISOString(),
    cfg: c.cfg,
    mappings: matcher.mappings({ internalDomains: c.rules.internal, partnerDomains: c.rules.partner, ignoreDomains: c.rules.ignore }, { repos }),
    events,
    sessions,
    drive,
    slack,
    emails,
    org62,
    fixed,
    fixedBlocks,
    names,
    context,
    onsiteOverrides: overrides,
    // D-64: "Dismiss all from …" rules, and the rows a canvas item not applied yet holds
    dismissRules: readTimeDismissRules(w.kv),
    held,
    // D-66: the rows' notes: the meetings' notes (the cheap model's note, the next step) and the opps' VDP use cases
    meetingNotes: (id) => notesByEvent.get(id) ?? null,
    useCases: (opp) => useCases.get(id15(opp)) ?? [],
    // D-65: the slot rule's "same account" (an opp → its account), and the Events rows of other passes are tied to
    accountOf: (id) => {
      const o = matcher.oppByOrg62(id);
      return o?.accountId ? (matcher.accounts.get(o.accountId)?.org62AccountId ?? null) : null;
    },
    linkedElsewhere,
  };
  const plan = planWeek(input);

  // planWeek returns this week's rows only; neighbours belong to their own pass
  const mine = existing.filter((r) => inWin(r.startsAt.toISOString()));
  // a logged row reached Org62 when its Event was created there (History places it on that day)
  const loggedAt = new Map(o62.rows.map((r) => [r.id, r.logged_at ? iso(r.logged_at) : null]));
  const want: ActivityProjection[] = plan.entries.map((e) => ({ ...toProjection(e, matcher), ...(e.status === 'logged' && e.org62EventRowId && loggedAt.get(e.org62EventRowId) ? { loggedAt: loggedAt.get(e.org62EventRowId)! } : {}) }));
  // an Org62 edit adopted on a verified row (activity.ts ReadbackMove.adopt): its WhatId as the app's opp / account
  const moves = plan.moves.map((mv) => {
    if (!mv.adopt) return mv;
    const what = mv.adopt.whatOrg62Id;
    const opp = what?.startsWith('006') ? matcher.oppByOrg62(what) : null;
    // TL-13: Related To cleared in Org62: no opp, no account (what_kind none, applyActivityWindow)
    const acct = opp?.accountId ? (matcher.accounts.get(opp.accountId) ?? null) : what?.startsWith('001') ? matcher.accountByOrg62(what) : null;
    return { ...mv, adopt: { ...mv.adopt, opportunityId: opp?.id ?? null, accountId: acct?.id ?? null, whatName: opp?.name ?? acct?.name ?? null } };
  });
  // HYG-1: an Event deleted in Org62 (the org62.readback job marks it): the app row it logged or verified says so,
  // `verify_failed` "Deleted in Org62", never silently "verified". Projection-owned mirror rows simply drop out
  // with the Event (it is no longer in `org62` above).
  const gone = await tx.execute<{ id: string; row: string }>(sql`
    select a.id, a.org62_event_row_id as row
      from activity_entries a join org62_events e on e.id = a.org62_event_row_id
     where a.owner_user_id = ${userId} and e.deleted_upstream_at is not null
       and a.status in ('approved', 'synced_to_canvas', 'logged', 'verified', 'verify_failed')
       and a.starts_at >= ${from.toISOString()}::timestamptz and a.starts_at < ${end.toISOString()}::timestamptz`);
  for (const g of gone.rows) {
    const r = mine.find((x) => x.id === g.id);
    if (!r || ownedRow(r) || moves.some((mv) => mv.rowId === g.id)) continue;
    moves.push({ rowId: g.id, status: 'verify_failed', org62EventRowId: g.row, issues: [DELETED_IN_ORG62_ISSUE] });
  }
  return { weekStart, from, end, input, plan, want, moves, mine, sameMeeting, held, blocksExisting, overrides, matcher, org62Ids: new Map(o62.rows.map((r) => [r.id, r.org62_event_id])) };
}

async function projectWeek(w: WriteCtx, tx: Tx, weekStart: string, c: WeekCtx, opts: LoadWeekOptions = {}): Promise<{ entries: number; blocks: number }> {
  // one pass per week at a time (the worker's tick, a Settings ▸ Time save's recompute, a Remove's): a second waits here
  // and then reads what the first wrote, instead of inserting the same rows again (unique_violation on the dedupe key)
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cc.projections.week|${c.me.userId}|${weekStart}`}))`);
  const { from, end, plan, want, moves, mine, sameMeeting, held, blocksExisting, overrides, matcher } = await loadWeek(w, tx, weekStart, c, opts);
  const inWin = (iso: string | null | undefined) => !!iso && Date.parse(iso) >= from.getTime() && Date.parse(iso) < end.getTime();
  // D-66: a row you own still takes the app's newer note until you edit the note, while it waits to be logged
  const noteRefresh = (r: ActivityRow) => NOTE_REFRESH_STATUSES.has(r.status) && !r.syncedToCanvasAt && !held.has(r.id) && !(r.userLockedFields ?? []).includes(NOTE_LOCK);
  // the rows a move may touch: this week's, and my rows of this week's meetings elsewhere (a reschedule, TL-32)
  const a = await applyActivityWindow(w, c.vocab, [...mine, ...sameMeeting], want, moves, ownedRow, plan.revives, plan.declined, noteRefresh, { rekeys: plan.rekeys, covers: plan.covers, flags: plan.flagMoves });
  const b = await applyBlockWindow(w, blocksExisting.filter((x) => inWin(x.startsAt.toISOString())), plan.blocks, ENGINE_VERSION);
  // the week's onsite days, for the day chips (Time, History) and the read side's attendance (onsite lane)
  const record: OnsiteWeekRecord = {
    version: 1,
    weekStart,
    overridesHash: overridesHash(overridesForWeek(overrides, weekStart)),
    days: plan.onsite.map((d) => ({ ...d, accountName: d.accountKey ? (matcher.accounts.get(d.accountKey)?.name ?? null) : null })),
  };
  const key = onsiteWeekKey(weekStart);
  const prev = w.kv.get(key);
  const nextVal = record.days.length || prev ? record : null;
  const onsiteWrote = canon(prev ?? null) !== canon(nextVal) ? 1 : 0;
  if (onsiteWrote) await writeKv(w, key, nextVal);
  return { entries: a.inserted + a.updated + a.deleted + a.moved + onsiteWrote, blocks: b.inserted + b.updated + b.deleted };
}

/**
 * Settings ▸ Time: the saved section over the defaults. Onsite days, and how overlapping meetings log (D-18 amended):
 * a row saved before the setting existed reads the persona's preset (`log_all_accepted` for every persona).
 */
async function loadTimeConfig(db: Db, userId: string, presetOverlaps: OverlapMode): Promise<{ onsite: OnsiteConfig; overlaps: OverlapMode }> {
  const [r] = await db.select({ value: userSettings.value }).from(userSettings).where(and(eq(userSettings.ownerUserId, userId), eq(userSettings.key, 'settings.time')));
  const v = (r?.value ?? {}) as Partial<{ detectOnsite: boolean; onsiteHours: { start: string; end: string }; airportBufferMin: number; airportBufferBeforeMin: number; airportBufferAfterMin: number; dinnersCustomerFacing: boolean; overlaps: string }>;
  // 2026-11-14: 120 min before a flight, 60 after; the legacy symmetric field is still read (airportBuffers)
  const buf = airportBuffers(v);
  return {
    onsite: {
      enabled: v.detectOnsite ?? DEFAULT_ONSITE_CONFIG.enabled,
      hours: v.onsiteHours ?? DEFAULT_ONSITE_CONFIG.hours,
      airportBufferBeforeMin: buf.beforeMin,
      airportBufferAfterMin: buf.afterMin,
      dinnersCustomerFacing: v.dinnersCustomerFacing ?? DEFAULT_ONSITE_CONFIG.dinnersCustomerFacing,
    },
    overlaps: v.overlaps === 'count_once' || v.overlaps === 'log_all_accepted' ? v.overlaps : presetOverlaps,
  };
}

/** Weeks an onsite correction touches whose stored record was computed without it (or before an Undo). */
async function onsiteWeeksDue(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ key: userSettings.key, value: userSettings.value })
    .from(userSettings)
    .where(and(eq(userSettings.ownerUserId, userId), sql`(${userSettings.key} = ${ONSITE_OVERRIDES_KEY} or ${userSettings.key} like 'cc.onsite.week/%')`));
  const overrides = (rows.find((r) => r.key === ONSITE_OVERRIDES_KEY)?.value ?? null) as OnsiteOverrides | null;
  const records = new Map(rows.filter((r) => r.key !== ONSITE_OVERRIDES_KEY).map((r) => [r.key, r.value as OnsiteWeekRecord]));
  const weeks = new Set<string>();
  const touch = (day: string) => weeks.add(weekOf(`${day}T12:00:00Z`, 'UTC').start);
  for (const d of overrides?.days ?? []) touch(d.day);
  for (const t of overrides?.trips ?? []) for (let d = t.from; d <= t.to && d <= addLocalDays(t.from, 60); d = addLocalDays(d, 1)) touch(d);
  // a week whose record saw corrections that are gone now (an Undo)
  for (const [, r] of records) if (r?.overridesHash && r.overridesHash !== overridesHash(overridesForWeek(overrides, r.weekStart))) weeks.add(r.weekStart);
  return [...weeks].filter((ws) => records.get(onsiteWeekKey(ws))?.overridesHash !== overridesHash(overridesForWeek(overrides, ws))).sort();
}

/**
 * Recompute the Time weeks of these local days now (an onsite correction from the day chip): the same Stage B pass
 * the tick runs, so the page shows the new rows without waiting for the worker.
 */
export async function recomputeWeeks(o: { db: Db; userId: string; days: string[]; now?: Date } & LoadWeekOptions): Promise<{ weeks: string[]; errors: string[] }> {
  const { db, userId } = o;
  const now = o.now ?? new Date();
  const { me, workday, packSlug, packRaw, quarterTargetH, logging } = await loadMe(db, userId);
  const rules = domainRules(me, packSlug, packRaw);
  const extractorId = await ensureExtractor(db);
  const vocab = await loadVocab(db, userId);
  const cfg: ActivityConfig = {
    timezone: me.timezone,
    ownerId: me.org62UserId ?? '',
    recordTypeId: '',
    lightningHost: 'https://org62.lightning.force.com',
    workday,
    hoursTarget: quarterTargetH,
    liveFrom: '1970-01-01',
    // D-55: the persona's record type and task-type rule (the SE's: Solutions Event, required). No hour caps (2026-11-14).
    recordTypeName: logging.recordTypeName,
    taskTypeRequired: logging.taskTypeRequired,
    // D-64: the persona's internal-only activity (the SE's)
    internalActivity: logging.internalActivity,
    evidence: DEFAULT_EVIDENCE_CONFIG,
    quarters: [],
    ...(await loadTimeConfig(db, userId, logging.overlaps)),
  };
  const weeks = [...new Set(o.days.map((d) => weekOf(`${d}T12:00:00Z`, 'UTC').start))].sort();
  const errors: string[] = [];
  for (const ws of weeks) {
    try {
      await maybeChangeSet(db, userId, `Projections: time, week of ${ws}`, async (tx, cs) => {
        const w = await writeCtx(tx, cs, me, now, extractorId);
        const r = await projectWeek(w, tx, ws, { me, rules, cfg, vocab }, o.turnsOf ? { turnsOf: o.turnsOf } : {});
        return { result: r, wrote: r.entries + r.blocks > 0 };
      });
    } catch (e) {
      errors.push(`week:${ws}:${errCode(e)}`);
    }
  }
  return { weeks, errors };
}

/** One day of a re-derive: hours before (as Time holds them) and after (the re-derive applied, update candidates landed). */
export interface RederiveDay {
  day: string;
  before: number;
  /** After `--apply`: the user's rows as they are, every other row as the engine wants it. */
  after: number;
  /** `after` plus the update candidates' and held changes' differences (the model's view, once they land). */
  afterModel: number;
  /** Of `afterModel`: meetings (calendar rows), solo work (evidence rows), travel, onsite, Org62's own rows. */
  split: { meetings: number; solo: number; travel: number; onsite: number; org62: number; internal: number };
}

export interface RederiveReport {
  from: string;
  to: string;
  days: RederiveDay[];
  totals: { before: number; after: number; afterModel: number };
  added: (RederiveRow & { week: string })[];
  changed: (RowChange & { week: string })[];
  removed: (RederiveRow & { week: string })[];
  candidates: UpdateCandidate[];
  held: HeldChange[];
  errors: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Re-derive [from, to] (local days), read-only: every week loaded and planned exactly as the week pass does it, inside
 * one READ ONLY transaction, then compared with what Time holds (rederive.ts). Writes nothing; `--apply` is
 * `recomputeWeeks` over the same days (the worker's own pass: it touches only the rows the projections own).
 */
export async function rederiveWeeks(o: { db: Db; userId: string; from: string; to: string; now?: Date; engaged?: Partial<EngagedParams> } & LoadWeekOptions): Promise<RederiveReport> {
  const { db, userId } = o;
  const now = o.now ?? new Date();
  const { me, workday, packSlug, packRaw, quarterTargetH, logging } = await loadMe(db, userId);
  const rules = domainRules(me, packSlug, packRaw);
  const tz = me.timezone;
  const dayOf = (isoAt: string) => localDay(isoAt, tz);
  const report: RederiveReport = { from: o.from, to: o.to, days: [], totals: { before: 0, after: 0, afterModel: 0 }, added: [], changed: [], removed: [], candidates: [], held: [], errors: [] };
  const weeks: string[] = [];
  for (let d = o.from; d <= o.to && weeks.length < 60; d = addDays(d, 7)) weeks.push(weekOf(`${d}T12:00:00Z`, 'UTC').start);
  const lastWeek = weekOf(`${o.to}T12:00:00Z`, 'UTC').start;
  if (!weeks.includes(lastWeek)) weeks.push(lastWeek);
  const inRange = (isoAt: string) => dayOf(isoAt) >= o.from && dayOf(isoAt) <= o.to;
  const before = new Map<string, number>();
  const after = new Map<string, number>();
  const model = new Map<string, number>();
  const split = new Map<string, RederiveDay['split']>();
  const add = (m: Map<string, number>, day: string, h: number) => m.set(day, (m.get(day) ?? 0) + h);
  await db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    const vocab = await loadVocab(tx, userId);
    const cfg: ActivityConfig = {
      timezone: me.timezone,
      ownerId: me.org62UserId ?? '',
      recordTypeId: '',
      lightningHost: 'https://org62.lightning.force.com',
      workday,
      hoursTarget: quarterTargetH,
      liveFrom: '1970-01-01',
      recordTypeName: logging.recordTypeName,
      taskTypeRequired: logging.taskTypeRequired,
      internalActivity: logging.internalActivity,
      // the engaged-time model's calibrated defaults, or the parameters a calibration run tries (`--engaged`)
      evidence: o.engaged ? { ...DEFAULT_EVIDENCE_CONFIG, engaged: o.engaged } : DEFAULT_EVIDENCE_CONFIG,
      quarters: [],
      ...(await loadTimeConfig(db, userId, logging.overlaps)),
    };
    // a read-only context: the loaders read through it, nothing writes (the transaction is READ ONLY besides)
    const w: WriteCtx = { tx, cs: null as unknown as WriteCtx['cs'], userId, me: { id: me.personId, name: me.name }, now, extractorId: '', timezone: tz, kv: await loadKv(tx, userId) };
    for (const ws of weeks) {
      let L: LoadedWeek;
      try {
        L = await loadWeek(w, tx, ws, { me, rules, cfg, vocab }, o.turnsOf ? { turnsOf: o.turnsOf } : {});
      } catch (e) {
        report.errors.push(`week:${ws}:${errCode(e)}`);
        continue;
      }
      const vocabName = (id: string | null) => (id ? (vocab.taskTypeById.get(id) ?? null) : null);
      const existing: (RederiveRow & { owned: boolean })[] = L.mine
        .filter((r) => r.operation === 'create')
        .map((r) => ({ id: r.id, dedupeKey: r.dedupeKey, startsAt: r.startsAt.toISOString(), durationHours: Number(r.durationHours), status: r.status, seTaskType: vocabName(r.seTaskTypeId), whatOrg62Id: r.whatOrg62Id, subject: r.subject, owned: ownedRow(r) }));
      const want: RederiveRow[] = L.want.map((a) => ({ dedupeKey: a.dedupeKey, startsAt: a.startsAt, durationHours: a.durationHours, status: a.status, seTaskType: a.seTaskType, whatOrg62Id: a.whatOrg62Id, subject: a.subject }));
      const owned = (r: RederiveRow) => (r as RederiveRow & { owned?: boolean }).owned === true;
      const diff = diffRows(existing, want, owned);
      report.added.push(...diff.added.filter((r) => inRange(r.startsAt)).map((r) => ({ ...r, week: ws })));
      report.changed.push(...diff.changed.filter((c) => inRange(c.to.startsAt)).map((c) => ({ ...c, week: ws })));
      report.removed.push(...diff.removed.filter((r) => inRange(r.startsAt)).map((r) => ({ ...r, week: ws })));
      for (const r of existing) if (inRange(r.startsAt) && COUNTED_STATUSES.has(r.status)) add(before, dayOf(r.startsAt), r.durationHours);
      const afterRows = rowsAfter(existing, want, owned).filter((r) => inRange(r.startsAt) && COUNTED_STATUSES.has(r.status));
      for (const r of afterRows) {
        const day = dayOf(r.startsAt);
        add(after, day, r.durationHours);
        add(model, day, r.durationHours);
        const sp = split.get(day) ?? { meetings: 0, solo: 0, travel: 0, onsite: 0, org62: 0, internal: 0 };
        split.set(day, sp);
        const k = r.dedupeKey;
        if (k.startsWith('org62|')) sp.org62 += r.durationHours;
        else if (k.startsWith('onsite|')) sp.onsite += r.durationHours;
        else if (k.startsWith('wb|')) sp.solo += r.durationHours;
        else if (r.seTaskType === 'Travel') sp.travel += r.durationHours;
        else sp.meetings += r.durationHours;
        const wantRow = L.want.find((x) => x.dedupeKey === k);
        if (wantRow && !wantRow.whatOrg62Id && !wantRow.customerRelated && !wantRow.customerFacing) sp.internal += r.durationHours;
      }
      const fixed = L.input.fixed.map((f) => ({ rowId: f.rowId, dedupeKey: f.dedupeKey, status: f.status, durationHours: f.durationHours, org62EventId: f.org62EventRowId ? (L.org62Ids.get(f.org62EventRowId) ?? null) : null, lockedFields: f.lockedFields ?? [] }));
      const { candidates, held } = durationUpdateCandidates(fixed, L.plan.shadowed);
      const startOf = new Map(L.input.fixed.map((f) => [f.rowId, f.startsAt]));
      for (const c of [...candidates, ...held]) {
        const s0 = startOf.get(c.activityEntryId);
        if (!s0 || !inRange(s0)) continue;
        add(model, dayOf(s0), c.to - c.from);
        const sp = split.get(dayOf(s0));
        if (sp) sp.solo += c.to - c.from;
      }
      report.candidates.push(...candidates.filter((c) => inRange(startOf.get(c.activityEntryId) ?? '')));
      report.held.push(...held.filter((c) => inRange(startOf.get(c.activityEntryId) ?? '')));
    }
  });
  for (let d = o.from; d <= o.to; d = addDays(d, 1)) {
    const sp = split.get(d) ?? { meetings: 0, solo: 0, travel: 0, onsite: 0, org62: 0, internal: 0 };
    const day: RederiveDay = { day: d, before: r2(before.get(d) ?? 0), after: r2(after.get(d) ?? 0), afterModel: r2(model.get(d) ?? 0), split: { meetings: r2(sp.meetings), solo: r2(sp.solo), travel: r2(sp.travel), onsite: r2(sp.onsite), org62: r2(sp.org62), internal: r2(sp.internal) } };
    report.days.push(day);
    report.totals.before += day.before;
    report.totals.after += day.after;
    report.totals.afterModel += day.afterModel;
  }
  report.totals = { before: r2(report.totals.before), after: r2(report.totals.after), afterModel: r2(report.totals.afterModel) };
  return report;
}

/** The recipients' email domains of a message I sent (to, cc), lower-cased; never the addresses. */
export function emailDomains(meta: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === 'string') for (const m of v.toLowerCase().matchAll(/@([a-z0-9.-]+\.[a-z]{2,})/g)) out.add(m[1]!);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(add);
  };
  add(meta.to);
  add(meta.cc);
  return [...out].sort();
}

function toProjection(e: DesiredEntry, m: Matcher): ActivityProjection {
  const opp = e.whatOrg62Id?.startsWith('006') ? m.oppByOrg62(e.whatOrg62Id) : null;
  const acct = opp?.accountId ? (m.accounts.get(opp.accountId) ?? null) : e.whatOrg62Id?.startsWith('001') ? m.accountByOrg62(e.whatOrg62Id) : null;
  return {
    dedupeKey: e.dedupeKey,
    origin: e.origin,
    subject: e.subject,
    description: e.description,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    durationHours: e.durationHours,
    seTaskType: e.seTaskType,
    meetingType: e.meetingType,
    customerFacing: e.customerFacing,
    customerRelated: e.customerRelated,
    whatKind: e.whatKind,
    whatOrg62Id: e.whatOrg62Id,
    whatName: e.whatName ?? opp?.name ?? acct?.name ?? null,
    opportunityId: opp?.id ?? null,
    accountId: acct?.id ?? null,
    // the loader takes the account from the opp; the ext name is for account-level WhatIds and unknown opps
    accountName: opp ? null : (acct?.name ?? null),
    confidence: e.confidence,
    reason: e.reason,
    flags: e.flags,
    status: e.status,
    excludedReason: e.excludedReason,
    org62EventRowId: e.org62EventRowId,
    sources: e.sources as SourceRef[],
    remote: e.remote,
    logNote: e.logNote,
    logNoteBasis: e.logNoteBasis,
  };
}

/** D-66: the lock a note you edited carries (src/server/datasource/db/store/time.ts LOCK_COL.logNote). */
const NOTE_LOCK = 'log_note';
/** Rows that wait to be logged: their note is still the app's to redraft (until you edit it). */
const NOTE_REFRESH_STATUSES = new Set(['upcoming', 'needs_input', 'proposed', 'approved']);

/** The key of a meeting note's side-car, where `activity.notes` keeps the cheap model's note (`logSummary`). */
export const meetingNoteExtKey = (meetingNoteId: string) => `cc.ext/meeting_notes/${meetingNoteId}`;

/**
 * D-66: per calendar event row, its notes' facts for the row's note: the cheap model's note (`activity.notes` keeps it
 * on the meeting note's side-car) and the next step (the first to-do the scanner took from the notes; never the
 * notes' text itself).
 */
async function meetingNoteFacts(tx: Tx, userId: string, eventIds: string[]): Promise<Map<string, { summary: string | null; nextStep: string | null }>> {
  const out = new Map<string, { summary: string | null; nextStep: string | null }>();
  if (!eventIds.length) return out;
  const r = await tx.execute<{ event_id: string; summary: string | null; next_step: string | null }>(sql`
    select n.calendar_event_id as event_id, x.value -> 'logSummary' ->> 'note' as summary,
           (select w.title from work_item_evidence we join work_items w on w.id = we.work_item_id
             where we.source_item_id = n.source_item_id and we.role = 'origin' and w.status not in ('dismissed', 'merged')
             order by we.created_at, w.id limit 1) as next_step
      from meeting_notes n
      left join user_settings x on x.owner_user_id = n.owner_user_id and x.key = 'cc.ext/meeting_notes/' || n.id::text
     where n.owner_user_id = ${userId} and n.calendar_event_id in (${sql.join(eventIds.map((id) => sql`${id}::uuid`), sql`, `)})
     order by n.arrived_at desc`);
  for (const row of r.rows) {
    const cur = out.get(row.event_id);
    // the newest notes win; an older notes doc still fills what the newer one lacks
    out.set(row.event_id, { summary: cur?.summary ?? row.summary, nextStep: cur?.nextStep ?? row.next_step });
  }
  return out;
}

/** D-66: every opp's VDP use cases (the mirror's live VDPs), by 15-char Org62 opp id. */
async function vdpUseCases(tx: Tx, userId: string): Promise<Map<string, UseCaseOption[]>> {
  const out = new Map<string, UseCaseOption[]>();
  const r = await tx.execute<{ detail: VdpSnapshot | null }>(sql`select detail from vdp_records where owner_user_id = ${userId} and gone_at is null and not archived and detail is not null`);
  for (const { detail } of r.rows) {
    if (!detail) continue;
    const ucs = (detail.useCases ?? []).map((u) => ({ title: u.title, priority: u.priority }));
    if (!ucs.length) continue;
    for (const opp of oppIdsOf(detail)) out.set(id15(opp), [...(out.get(id15(opp)) ?? []), ...ucs]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Missed opportunities: evidence in, findings out
// ---------------------------------------------------------------------------

/** My evidence of the last 180 days, reduced to titles (never bodies): meetings, files, Claude sessions. */
async function missedEvidence(tx: Tx, userId: string, now: Date): Promise<MissedEvidence> {
  const since = new Date(now.getTime() - 180 * 86_400_000).toISOString();
  const cal = await tx.execute<{ id: string; title: string | null; s: Date | string; my_response: string; org: boolean; attendance: string; recurring: string | null; ext: boolean; opp: string | null; acct: string | null }>(sql`
    select e.id, e.title, e.starts_at as s, e.my_response, e.i_am_organizer as org, e.attendance, e.recurring_event_id as recurring, e.has_external_attendees as ext,
           o.org62_opportunity_id as opp, a.org62_account_id as acct
      from calendar_events e
      left join opportunities o on o.id = e.opportunity_id
      left join accounts a on a.id = coalesce(e.account_id, o.account_id)
     where e.owner_user_id = ${userId} and e.deleted_upstream_at is null and e.status <> 'cancelled'
       and e.starts_at >= ${since}::timestamptz and e.starts_at < ${now.toISOString()}::timestamptz`);
  const drive = await tx.execute<{ id: string; title: string | null; at: Date | string | null; owned: boolean; acct: string | null }>(sql`
    select s.id, s.title, s.last_modified_at as at, (s.i_own or s.last_modified_by_me_at is not null) as owned, a.org62_account_id as acct
      from assets s left join accounts a on a.id = s.account_id
     where s.owner_user_id = ${userId} and coalesce(s.last_modified_at, ${now.toISOString()}::timestamptz) >= ${since}::timestamptz`);
  const sess = await tx.execute<{ id: string; title: string | null; at: Date | string; acct: string | null }>(sql`
    select s.id, s.title, s.last_activity_at as at, a.org62_account_id as acct
      from claude_sessions s left join accounts a on a.id = s.account_id
     where s.owner_user_id = ${userId} and s.last_activity_at >= ${since}::timestamptz`);
  return {
    calendar: cal.rows.map((r) => ({
      id: r.id,
      title: r.title ?? '',
      at: iso(r.s),
      oppOrg62Id: r.opp,
      accountOrg62Id: r.acct,
      owned: (r.my_response === 'accepted' || r.org) && r.attendance !== 'missed',
      recurring: !!r.recurring,
      internalOnly: !r.ext,
    })),
    drive: drive.rows.map((r) => ({ id: r.id, title: r.title ?? '', at: r.at ? iso(r.at) : null, owned: r.owned, accountOrg62Id: r.acct })),
    // a session's span is not hands-on time: it only ever makes a "some" signal (hours 0)
    sessions: sess.rows.map((r) => ({ id: r.id, title: r.title ?? '', at: iso(r.at), accountOrg62Id: r.acct, hours: 0 })),
  };
}

const money = (v: number) => Math.round(v * 100) / 100;

/**
 * One `missed_opp_findings` row per opp (the engine's tier, verdict and evidence), refreshed each pass unless the
 * user locked it. Status is the user's: never changed, except a new or claimed finding whose opp now carries my DC
 * becomes `resolved`. A pass that changes nothing writes nothing (no sweep row either).
 */
async function writeMissedFindings(w: WriteCtx, tx: Tx, res: MissedResult, book: Org62Book): Promise<number> {
  const userId = w.userId;
  const oppRows = new Map(
    (await tx.execute<{ id: string; org62: string }>(sql`select id, org62_opportunity_id as org62 from opportunities where owner_user_id = ${userId} and archived_at is null`)).rows.map((r) => [id15(r.org62), r.id]),
  );
  const existing = await tx.select().from(missedOppFindings).where(eq(missedOppFindings.ownerUserId, userId));
  const curByOpp = new Map(existing.map((f) => [f.opportunityId, f]));
  const org62ByRow = new Map([...oppRows].map(([k, v]) => [v, k]));
  const stamp = book.bookRead?.at ?? book.opps.map((o) => o.sweep?.at).filter((x): x is string => !!x).sort().at(-1) ?? 'none';
  const sweepId = uuidFor(`proj:missed_sweep:${userId}:${stamp}`);
  let sweepReady = false;
  const ensureSweep = async () => {
    if (sweepReady) return;
    await tx
      .insert(missedOppSweeps)
      .values({ id: sweepId, ownerUserId: userId, status: 'succeeded', criteria: { source: 'projections', engine: 'deals', stamp }, accountsConsidered: res.considered.accounts, oppsConsidered: res.considered.opps, startedAt: w.now, finishedAt: w.now })
      .onConflictDoNothing();
    sweepReady = true;
  };
  let created = 0;
  let changed = 0;
  for (const f of res.findings) {
    const oppRow = oppRows.get(f.opportunityId);
    if (!oppRow) continue; // an opp outside the projected book has no row to anchor a finding
    const cols = {
      tier: f.tier,
      verdict: f.verdict,
      evidenceStrength: f.evidenceStrength,
      hasD360Line: f.hasD360Line,
      d360LineAmount: money(f.d360LineAmount),
      flexLineAmount: money(f.flexLineAmount),
      myOrg62Hours: money(f.myOrg62Hours),
      myDcExists: f.myDcExists,
      otherArchitectDcCount: f.otherArchitectDcCount,
      evidenceSummary: (res.lines.get(f.opportunityId) ?? [f.evidenceSummary]).join('\n'),
    };
    const cur = curByOpp.get(oppRow);
    let id: string;
    if (!cur) {
      await ensureSweep();
      id = uuidFor(`proj:missed:${userId}:${f.opportunityId}`);
      await tx.insert(missedOppFindings).values({ id, ownerUserId: userId, opportunityId: oppRow, firstSweepId: sweepId, lastSweepId: sweepId, status: 'new', ...cols });
      created++;
    } else {
      id = cur.id;
      if (cur.userLocked) continue;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(cols)) if (String((cur as Record<string, unknown>)[k] ?? '') !== String(v ?? '')) patch[k] = v;
      if (Object.keys(patch).length) {
        await ensureSweep();
        await tx.update(missedOppFindings).set({ ...patch, lastSweepId: sweepId, updatedAt: w.now }).where(eq(missedOppFindings.id, id));
        changed++;
      }
    }
    if (await mergeExt(w, 'missed_opp_findings', id, { otherDcs: res.otherDcs.get(f.opportunityId) ?? null })) changed += cur ? 1 : 0;
  }
  // my DC is on the opp now: the question is settled
  for (const cur of existing) {
    const org62 = org62ByRow.get(cur.opportunityId);
    if (!org62 || !res.covered.has(org62) || cur.userLocked || !['new', 'reviewing', 'actioned'].includes(cur.status)) continue;
    await tx.update(missedOppFindings).set({ status: 'resolved', updatedAt: w.now }).where(eq(missedOppFindings.id, cur.id));
    changed++;
  }
  if (sweepReady) await tx.update(missedOppSweeps).set({ findingsNew: created, findingsChanged: changed }).where(eq(missedOppSweeps.id, sweepId));
  return created + changed;
}

// ---------------------------------------------------------------------------
// Small lookups
// ---------------------------------------------------------------------------

async function emailDirectory(tx: Tx, userId: string): Promise<Map<string, string>> {
  const r = await tx.execute<{ email: string; person_id: string }>(sql`
    select lower(external_id) as email, person_id from person_identities where owner_user_id = ${userId} and system = 'email'
    union
    select lower(primary_email), id from people where owner_user_id = ${userId} and primary_email is not null`);
  return new Map(r.rows.map((x) => [x.email, x.person_id]));
}

async function eventRowId(tx: Tx, userId: string, externalEventId: string): Promise<string | null> {
  const [r] = await tx.select({ id: calendarEvents.id }).from(calendarEvents).where(and(eq(calendarEvents.ownerUserId, userId), eq(calendarEvents.externalEventId, externalEventId))).limit(1);
  return r?.id ?? null;
}

/** Work items the scanner linked to a source item (any evidence role), newest first. */
async function workItemsFromSource(tx: Tx, sourceItemId: string): Promise<string[]> {
  const r = await tx.execute<{ id: string }>(sql`
    select e.work_item_id as id from work_item_evidence e join work_items w on w.id = e.work_item_id
     where e.source_item_id = ${sourceItemId} group by e.work_item_id order by max(e.created_at) desc limit 20`);
  return r.rows.map((x) => x.id);
}

/** Work items whose evidence references a Drive file (source_item_refs), per file id. */
async function workItemsByFile(tx: Tx, userId: string, fileIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!fileIds.length) return out;
  const r = await tx.execute<{ file: string; id: string }>(sql`
    select distinct r.value as file, e.work_item_id as id
      from source_item_refs r
      join source_items si on si.id = r.source_item_id and si.owner_user_id = ${userId}
      join work_item_evidence e on e.source_item_id = r.source_item_id
     where r.kind = 'drive_file' and r.value in (${sql.join(fileIds.map((f) => sql`${f}`), sql`, `)})
     order by 1, 2`);
  for (const x of r.rows) out.set(x.file, [...(out.get(x.file) ?? []), x.id]);
  return out;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}

/** `2026-11-01` + 3 months → `2027-02-01` (first-of-month days only, as the fiscal quarters use). */
function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10);
}

/** Epoch ms of local midnight of `day` in `tz`. */
function zoned(day: string, tz: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  const off = (ms: number) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(ms / 1000) * 1000;
  };
  let ms = guess - off(guess);
  ms = guess - off(ms);
  return ms;
}

/** First day (local) of the Salesforce fiscal quarter containing `now` (FY starts 1 Feb: Feb, May, Aug, Nov). */
export function fiscalQuarterStart(now: Date, tz: string): string {
  const day = localDay(now.toISOString(), tz);
  const [y, m] = day.split('-').map(Number) as [number, number];
  const qStartMonth = [2, 5, 8, 11].filter((q) => q <= m).pop() ?? 11;
  const year = m < 2 ? y - 1 : y;
  return `${year}-${String(qStartMonth).padStart(2, '0')}-01`;
}

export { isSfId };

/**
 * The projections' account matcher (names, aliases, short names, learned meeting domains) for other deterministic
 * passes: the VDP asset matcher (src/server/datasource/db/store/vdp-assets.ts) resolves new files and links with it.
 */
export async function accountMatcher(db: Db, userId: string): Promise<{ matcher: Matcher; rules: DomainRules; myDomain: string | null }> {
  const { me, packSlug, packRaw } = await loadMe(db, userId);
  const rules = domainRules(me, packSlug, packRaw);
  return { matcher: await loadMatcher(db, userId, rules), rules, myDomain: domainOf(me.email) };
}
