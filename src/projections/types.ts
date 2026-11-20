/**
 * Projections: source items → the domain rows the pages read (calendar events, accounts, opportunities,
 * Org62 events, Claude sessions, assets, meeting notes, time blocks, activity entries).
 *
 * The mappers in this folder are pure: they take `SourceRow`s (a read-only slice of `source_items`) plus a
 * small context and return projected records. `run.ts` loads the rows changed since the stored watermark,
 * runs the mappers and writes through the upsert helpers in `src/server/datasource/db/store/*.ts`.
 */

/** The columns of `source_items` the projections read. `body` is loaded only where a mapper needs it. */
export interface SourceRow {
  id: string;
  source: string;
  kind: string;
  externalId: string;
  externalParentId: string | null;
  externalContainerId: string | null;
  dedupeKey: string;
  occurredAt: string;
  title: string | null;
  url: string | null;
  /** Redacted excerpt (Org62 rows: `stage=…; close=…`); null when not loaded or purged. */
  body: string | null;
  meta: Record<string, unknown>;
  fromMe: boolean;
  deletedUpstreamAt: string | null;
  /** greatest(created_at, content_changed_at, updated_at, deleted_upstream_at): the watermark column. */
  changedAt: string;
}

export interface Me {
  /** users.id */
  userId: string;
  /** people.id of "me". */
  personId: string;
  name: string;
  email: string;
  org62UserId: string | null;
  slackUserId: string | null;
  timezone: string;
}

/** Domains that are never customers: my company (team pack), plus resource calendars. */
export interface DomainRules {
  internal: string[];
  partner: string[];
  ignore: string[];
}

export type ResponseStatus = 'accepted' | 'declined' | 'tentative' | 'needs_action' | 'none';
export type DbAttendance = 'unknown' | 'attended' | 'missed' | 'partial' | 'not_applicable';
export type EventType = 'default' | 'out_of_office' | 'focus_time' | 'working_location';

export interface ProjectedAttendee {
  email: string;
  responseStatus: ResponseStatus;
  isOrganizer: boolean;
  isOptional: boolean;
  isSelf: boolean;
  isExternal: boolean;
  domain: string | null;
}

export interface ProjectedEvent {
  calendarId: string;
  externalEventId: string;
  recurringEventId: string | null;
  sourceItemId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  localDay: string;
  isAllDay: boolean;
  eventType: EventType;
  status: 'confirmed' | 'tentative' | 'cancelled';
  myResponse: ResponseStatus;
  iAmOrganizer: boolean;
  attendance: DbAttendance;
  hasExternalAttendees: boolean;
  externalDomains: string[];
  /** Every attendee domain (lower-cased, without me): the activity engine's input. */
  attendeeDomains: string[];
  /** Other attendees (not me) on the event: 0 = a solo block. */
  otherAttendeeCount: number;
  conferenceUrl: string | null;
  htmlLink: string | null;
  location: string | null;
  attendees: ProjectedAttendee[];
  attachments: { title: string; fileId: string | null; mimeType: string | null }[];
  geminiNotesDocId: string | null;
  ended: boolean;
}

export interface ProjectedAccount {
  org62AccountId: string;
  name: string;
  /** Why it is in my book (opp team, my DC, my logged Org62 time). */
  via: ('opp_team' | 'dc' | 'org62_event' | 'sweep')[];
  isMyBook: boolean;
}

export interface ProjectedOpp {
  org62OpportunityId: string;
  org62AccountId: string | null;
  accountName: string | null;
  name: string;
  stage: string | null;
  amount: number | null;
  closeDate: string | null;
  forecastCategory: string | null;
  type: string | null;
  isClosed: boolean;
  isWon: boolean;
  /** On the opp team (or the owner, for an owner book). Never true for a DC alone: that is `myDc`. */
  onMyTeam: boolean;
  /**
   * The latest complete book read decides membership of this (open) opp: `onMyTeam` is exact, so a stored "on my
   * team" it no longer supports turns off (an opp I only hold a DC on). False: membership only turns on.
   */
  teamKnown: boolean;
  myTeamRole: string | null;
  nextStep: string | null;
  /**
   * A row whose query selects NextStep (the windowed Opportunity / OpportunityTeamMember reads) has seen the opp, so
   * a null `nextStep` means none. False when only the daily book read (no NextStep) or a DC row has: unknown.
   */
  nextStepRead: boolean;
  /** My Deal Contribution on it. */
  myDc: boolean;
  /** My DC's role / split, when a DC row says. */
  myDcRole: string | null;
  myDcSplit: number | null;
  /** In the latest complete book read (open opps I am on the team of): the source of truth for "my book". */
  inBook: boolean;
  /** I was on its team, but the latest complete book read no longer lists it: marked, never deleted. */
  leftBookAt: string | null;
  /** The latest complete book read says this open opp is not mine (whatever older rows said): its stamp. */
  notInBookAt: string | null;
  /** What the daily missed-opp sweep recorded about it (classification, my logged hours, other architects). */
  sweep: SweepFacts | null;
  org62ModifiedAt: string | null;
  sourceItemId: string;
}

export interface SweepFacts {
  /** `d360` (a D360 line or name token) / `flex_only`; null when the sweep did not say. */
  signal: 'd360' | 'flex_only' | null;
  /** My logged Org62 Event hours on the opp (the sweep's 180-day aggregate). */
  hours: number | null;
  d360Amount: number | null;
  flexAmount: number | null;
  /** D360 / Flex product names on its lines. */
  products: string[];
  /** Other AI + Data Architect DCs ("Name 100%"). */
  otherArchitectDcs: { name: string; split: number }[];
  /** When the sweep recorded it. */
  at: string;
}

/** The latest book read (scan-org62 §6 `book`): which run, how many rows it reported, and whether it is whole. */
export interface BookRead {
  at: string;
  /** Rows the run reported reading. */
  expected: number;
  /** Book rows recorded with this run's stamp. */
  seen: number;
  /** Complete and every reported row recorded: opps it does not list left my book. */
  authoritative: boolean;
}

export interface ProjectedOrg62Event {
  org62EventId: string;
  recordTypeName: string;
  subject: string | null;
  startsAt: string;
  endsAt: string;
  /** Raw Duration__c (hours); null = never filled in. */
  durationField: number | null;
  seTaskTypeName: string | null;
  meetingTypeName: string | null;
  whatOrg62Id: string | null;
  whatName: string | null;
  /** CreatedDate: when it was logged in Org62 (History places the "Logged in Org62" row there). */
  org62CreatedAt: string | null;
  org62ModifiedAt: string | null;
  sourceItemId: string;
}

export interface ProjectedDc {
  org62DcId: string;
  org62OpportunityId: string | null;
  role: string | null;
  splitPercent: number | null;
  org62ModifiedAt: string | null;
  /** When a scan last read it: the newest book read that listed it, else its newest snapshot. */
  seenAt: string | null;
  sourceItemId: string;
}

export interface Org62Book {
  accounts: ProjectedAccount[];
  opps: ProjectedOpp[];
  events: ProjectedOrg62Event[];
  /** Org62 events seen without a usable start time (the skill did not record one): counted, not projected. */
  eventsWithoutStart: number;
  dcs: ProjectedDc[];
  /** The newest book read with a complete manifest, or null (no book read yet). */
  bookRead: BookRead | null;
  /**
   * DC-21 / DC-24: opps whose older snapshots name another account than the newest one (the opp moved, or its account
   * was merged into another). Absent on books built before D-68.
   */
  accountMoves?: AccountMove[];
}

/** An opp an older Org62 snapshot put on account `from`, now on `to` (Org62 Account ids). */
export interface AccountMove {
  org62OpportunityId: string;
  from: string;
  to: string;
}

export type DbSessionStatus = 'launching' | 'launch_failed' | 'running' | 'idle' | 'waiting_on_me' | 'completed' | 'errored' | 'abandoned';
export type WaitingReason = 'permission_prompt' | 'question' | 'plan_approval' | 'error' | 'review_output' | 'input_needed';
export type ClaudeEntrypoint = 'cli' | 'desktop' | 'vscode' | 'cowork' | 'agent_sdk' | 'scheduled_task' | 'unknown';

export interface ProjectedSession {
  sessionExternalId: string;
  hostSessionId: string | null;
  sourceItemId: string;
  title: string;
  status: DbSessionStatus;
  /** Contract state when the db status alone maps to something else (idle/completed → done). */
  stateOverride: 'done' | null;
  waitingReason: WaitingReason | null;
  waitingText: string | null;
  waitingSince: string | null;
  entrypoint: ClaudeEntrypoint;
  cwd: string | null;
  repo: string | null;
  gitBranch: string | null;
  summary: string | null;
  startedAt: string | null;
  lastActivityAt: string;
  lastHumanPromptAt: string | null;
  endedAt: string | null;
  promptCount: number;
  filesChangedCount: number;
  costUsd: number | null;
  bgAgents: number;
  error: string | null;
  /** `[cc:<work item id>]` tag of a session the app launched. */
  ccTag: string | null;
  archived: boolean;
}

export interface ProjectedAsset {
  externalId: string;
  kind: 'deck' | 'doc' | 'sheet' | 'pdf' | 'other';
  title: string;
  url: string | null;
  mimeType: string | null;
  lastModifiedAt: string | null;
  lastModifiedByMe: boolean;
  lastModifierName: string | null;
  /** Calendar event (externalEventId) it is attached to, when it came from an invite. */
  eventExternalId: string | null;
  sourceItemIds: string[];
}

export interface ProjectedNote {
  sourceItemId: string;
  docExternalId: string;
  url: string | null;
  eventExternalId: string | null;
  arrivedAt: string;
  nextStepCount: number;
  myNextStepCount: number;
}

/** One of my Slack messages, for burst detection. */
export interface SlackMessage {
  id: string;
  channelId: string;
  at: string;
  /** The message's permalink (a burst links to its first message). */
  url?: string | null;
  /** `<channelId>:<ts>` */
  externalId?: string;
  channelName?: string | null;
}
