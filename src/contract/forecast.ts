/**
 * Specialist Forecast (the Specialist AE's Org62 duty, D-55 feature `specialistForecast`). `SpecialistForecast__c` is a
 * child of the core opportunity, created when Flex or Data 360 SKUs attach (Flex splits 50/50 into two records). Every
 * week the AE writes fresh `ForecastNotes__c` on in-quarter deals, keeps `Deal_Role__c` off None on any deal with ACV,
 * and creates a record for every opportunity with Data 360 or Flex work.
 *
 *   read    the worker's `forecast.sync` (fixed SOQL, read-only) mirrors my records for this and next fiscal quarter
 *           into `specialist_forecasts`; note age comes from `SpecialistForecast__History` (no notes-updated field)
 *   draft   one record's note on demand (a read-only research run; a fake on mock and in tests), $0.25 cap per draft
 *   apply   approved notes and Deal Role fixes → ONE Slackbot canvas of UPDATE rows (the `slack_canvas.create` Outbox
 *           action), applied on Time (D-52); the user tells Slackbot "Execute this canvas"; the next sync checks it
 *
 * The app never writes to Org62 itself.
 */
import { z } from 'zod';
import { Id, IsoDate, IsoDateTime, Url } from './common';

/** `Deal_Role__c` picklist values (Org62). */
export const DEAL_ROLES = ['None', 'Lead', 'Assist', 'Aware', 'Portfolio', 'Accelerate', 'Incremental', 'Originate'] as const;
export const DealRole = z.enum(DEAL_ROLES);
export type DealRole = z.infer<typeof DealRole>;

/** `Management_Forecast_Judgement__c` picklist values. */
export const FORECAST_JUDGEMENTS = ['IN', 'OUT', 'UP+', 'UP -'] as const;
/** `ForecastStatus__c` picklist values. */
export const FORECAST_STATUSES = ['Omitted', 'Pipeline', 'Best Case', 'Commit', 'Closed Won', 'Closed Lost'] as const;

/** Where a drafted note's facts came from (shown under the draft; links only from tool results). */
export const ForecastDraftSource = z.object({
  source: z.enum(['slack', 'gmail', 'calendar', 'drive', 'gemini', 'org62', 'app', 'other']),
  label: z.string().min(1).max(160),
  url: z.string().max(600).nullable().default(null),
  at: z.string().max(40).nullable().default(null),
});
export type ForecastDraftSource = z.infer<typeof ForecastDraftSource>;

/** The note waiting to go to Org62: drafted (by the model or you), then approved. */
export const ForecastPendingNotes = z.object({
  text: z.string().trim().min(1).max(4000),
  state: z.enum(['drafted', 'approved']),
  /** model = drafted and untouched · edited = drafted, then changed by you · manual = written by you. */
  origin: z.enum(['model', 'edited', 'manual']),
  at: IsoDateTime,
  /** The record's notes-updated time it was written against: a newer note in Org62 makes it obsolete. */
  basedOnNotesAt: IsoDateTime.nullable(),
  model: z.string().nullable().default(null),
  costUsd: z.number().min(0).default(0),
  sources: z.array(ForecastDraftSource).max(12).default([]),
});
export type ForecastPendingNotes = z.infer<typeof ForecastPendingNotes>;

/** An approved Deal Role fix (the value Slackbot sets). */
export const ForecastPendingRole = z.object({ value: DealRole.exclude(['None']), state: z.literal('approved'), at: IsoDateTime });
export type ForecastPendingRole = z.infer<typeof ForecastPendingRole>;

/** Local review state of one record (never sent anywhere by itself). */
export const ForecastPending = z.object({
  notes: ForecastPendingNotes.nullable().default(null),
  dealRole: ForecastPendingRole.nullable().default(null),
  /** The last draft run that did not finish (codes only). */
  draftError: z.object({ code: z.string().max(60), message: z.string().max(300), at: IsoDateTime }).nullable().default(null),
});
export type ForecastPending = z.infer<typeof ForecastPending>;
export const EMPTY_FORECAST_PENDING: ForecastPending = { notes: null, dealRole: null, draftError: null };

/** One mirrored `SpecialistForecast__c` I own (this or next fiscal quarter). */
export const SpecialistForecast = z.object({
  id: Id,
  /** SpecialistForecast__c.Id */
  org62Id: z.string().min(15).max(18),
  name: z.string(),
  url: Url.nullable(),
  /** Opportunity__c, and the app's opp and account it links to. */
  org62OpportunityId: z.string().nullable(),
  opportunityId: Id.nullable(),
  accountId: Id.nullable(),
  opportunityName: z.string().nullable(),
  accountName: z.string().nullable(),
  /** Opportunity.StageName / NextStep / CloseDate (the core opp). */
  oppStage: z.string().nullable(),
  oppNextStep: z.string().nullable(),
  oppCloseDate: IsoDate.nullable(),
  /** ForecastNotes__c, and the notes before the last change a sync saw (History keeps no long-text values). */
  notes: z.string().nullable(),
  prevNotes: z.string().nullable(),
  /** MgrForecastNotes__c (core AE / RVP). */
  mgrNotes: z.string().nullable(),
  dealRole: z.string().nullable(),
  judgement: z.string().nullable(),
  forecastStatus: z.string().nullable(),
  /** ForecastAmount__c (the deal's ACV for the specialist). */
  amount: z.number().nullable(),
  stage: z.string().nullable(),
  closeDate: IsoDate.nullable(),
  /** FiscalQuarter__c: "FY27 Q4". */
  fiscalQuarter: z.string().nullable(),
  ownerOrg62Id: z.string().nullable(),
  lastModifiedAt: IsoDateTime.nullable(),
  /** The newest ForecastNotes__c change in SpecialistForecast__History; null = none recorded. */
  notesUpdatedAt: IsoDateTime.nullable(),
  syncedAt: IsoDateTime,
  /** A complete read no longer listed it (closed out of the window, or no longer mine). Kept, never deleted. */
  goneAt: IsoDateTime.nullable(),
  pending: ForecastPending,
});
export type SpecialistForecast = z.infer<typeof SpecialistForecast>;

// ---------------------------------------------------------------------------
// Time ▸ Forecast
// ---------------------------------------------------------------------------

/** fresh · due (needs notes by the next due time) · overdue (missed the last one) · not_required (out of quarter, small, closed). */
export const ForecastNotesState = z.enum(['fresh', 'due', 'overdue', 'not_required']);
export type ForecastNotesState = z.infer<typeof ForecastNotesState>;

/**
 * Where a record's update is: none · drafting (a run is queued or running) · drafted · approved (ready to stage) ·
 * staged (in a canvas waiting for Apply) · handed_off (the canvas exists; Slackbot runs it) · landed (Org62 shows it) ·
 * not_landed (a sync after the canvas does not show it: stage it again).
 */
export const ForecastUpdateState = z.enum(['none', 'drafting', 'drafted', 'approved', 'staged', 'handed_off', 'landed', 'not_landed']);
export type ForecastUpdateState = z.infer<typeof ForecastUpdateState>;

export const ForecastRow = z.object({
  id: Id,
  org62Id: z.string(),
  name: z.string(),
  url: Url.nullable(),
  opportunityId: Id.nullable(),
  accountId: Id.nullable(),
  opportunityName: z.string().nullable(),
  accountName: z.string().nullable(),
  amount: z.number().nullable(),
  stage: z.string().nullable(),
  forecastStatus: z.string().nullable(),
  judgement: z.string().nullable(),
  dealRole: z.string().nullable(),
  closeDate: IsoDate.nullable(),
  fiscalQuarter: z.string().nullable(),
  inQuarter: z.boolean(),
  /** Whole days since ForecastNotes__c last changed; null = no change on record. */
  notesAgeDays: z.number().int().min(0).nullable(),
  notesUpdatedAt: IsoDateTime.nullable(),
  notesState: ForecastNotesState,
  /** Position in the weekly notes queue (1 = first); null when not queued. */
  rank: z.number().int().min(1).nullable(),
  currentNotes: z.string().nullable(),
  mgrNotes: z.string().nullable(),
  /** Deal Role None on a deal with ACV: the fix (Aware unless you picked another). */
  roleFix: z.object({ from: z.string().nullable(), to: DealRole.exclude(['None']), approved: z.boolean() }).nullable(),
  notes: z.object({
    state: ForecastUpdateState,
    text: z.string().nullable(),
    origin: z.enum(['model', 'edited', 'manual']).nullable(),
    at: IsoDateTime.nullable(),
    costUsd: z.number().min(0),
    sources: z.array(ForecastDraftSource),
    /** The canvas item holding it (staged) or that handed it off. */
    draftId: Id.nullable(),
    error: z.string().nullable(),
  }),
  role: z.object({ state: ForecastUpdateState, draftId: Id.nullable() }),
  gone: z.boolean(),
});
export type ForecastRow = z.infer<typeof ForecastRow>;

/**
 * "I created it, check now" on a missing record: where the re-read of that one opp's Specialist Forecast is. The read
 * is a `forecast.sync` job the worker runs (scope `opp`, read-only, fixed SOQL), never a live call from the web.
 *
 *   checking   the read is queued or running
 *   found      the mirror has a record for the opp now (it left the missing list)
 *   not_found  the read finished and Org62 shows no record of yours for this or next quarter yet
 *   failed     the read did not finish (`note` says why); skipped: it could not run (`note`: no Org62 id, not live…)
 */
export const ForecastCheck = z.object({
  opportunityId: Id,
  opportunityName: z.string().nullable(),
  status: z.enum(['checking', 'found', 'not_found', 'failed', 'skipped']),
  /** When it was asked (checking), else when Org62 was last read for it (the check, or a later full read). */
  at: IsoDateTime,
  note: z.string().nullable(),
  /** found: the mirrored record (opens its details). */
  recordId: Id.nullable(),
});
export type ForecastCheck = z.infer<typeof ForecastCheck>;

/** An opportunity with Data 360 or Flex work but no Specialist Forecast: create one from its Forecast tab (a handoff). */
export const MissingForecast = z.object({
  opportunityId: Id,
  accountId: Id,
  opportunityName: z.string(),
  accountName: z.string().nullable(),
  amount: z.number().nullable(),
  closeDate: IsoDate.nullable(),
  signal: z.enum(['d360_line', 'name_token', 'flex_only']),
  products: z.array(z.string()),
  /** The opportunity in Org62 (its Forecast tab has "New Specialist Forecast"). */
  url: Url.nullable(),
  /** The latest "I created it, check now" for this opp (last 24 h), else null. */
  check: ForecastCheck.nullable().default(null),
});
export type MissingForecast = z.infer<typeof MissingForecast>;

export const ForecastThresholds = z.object({
  minAmountUsd: z.number().min(0),
  staleDays: z.number().int().min(1),
  dealRoleMinAcvUsd: z.number().min(0),
  /** 0 = Sunday … 6 = Saturday. */
  dueWeekday: z.number().int().min(0).max(6),
  /** "09:00" local. */
  dueAt: z.string(),
  template: z.string(),
});
export type ForecastThresholds = z.infer<typeof ForecastThresholds>;

export const ForecastSyncState = z.object({
  status: z.enum(['never', 'queued', 'running', 'ok', 'partial', 'failed', 'skipped', 'mock']),
  /** The last read that finished. */
  lastAt: IsoDateTime.nullable(),
  note: z.string().nullable(),
  records: z.number().int().min(0),
  /** A full read already scheduled for later (the one after an "I created it, check now"), else null. */
  nextAt: IsoDateTime.nullable().default(null),
});
export type ForecastSyncState = z.infer<typeof ForecastSyncState>;

export const ForecastCanvas = z.object({
  draftId: Id,
  title: z.string(),
  status: z.string(),
  notes: z.number().int().min(0),
  roles: z.number().int().min(0),
  /** Staged (waiting for Apply): when it was staged. With Slackbot: when it was applied. */
  at: IsoDateTime,
  /** The canvas in Slack once it exists (With Slackbot), else null. */
  url: z.string().nullable().default(null),
  /** With Slackbot: the updates the next sync has not seen land yet. */
  waiting: z.number().int().min(0).default(0),
});
export type ForecastCanvas = z.infer<typeof ForecastCanvas>;

export const ForecastPayload = z.object({
  /** The feature is active for your persona (inactive: an empty payload; the tab is hidden). */
  active: z.boolean(),
  mode: z.enum(['live', 'mock']),
  quarter: z.object({ current: z.string(), next: z.string() }),
  thresholds: ForecastThresholds,
  /** The next notes deadline (and the one before it, after which due notes are overdue). */
  due: z.object({ at: IsoDateTime, prevAt: IsoDateTime, label: z.string() }),
  sync: ForecastSyncState,
  /** Every mirrored record, biggest first (queued ones in queue order first). */
  rows: z.array(ForecastRow),
  queue: z.object({
    /** Record ids in queue order: biggest and furthest along first. */
    notes: z.array(Id),
    roles: z.array(Id),
    missing: z.array(MissingForecast),
  }),
  counts: z.object({
    due: z.number().int().min(0),
    overdue: z.number().int().min(0),
    drafted: z.number().int().min(0),
    /** Approved notes and Deal Role fixes not in a canvas yet (what "Stage N notes" stages). */
    ready: z.number().int().min(0),
    staged: z.number().int().min(0),
    handedOff: z.number().int().min(0),
    notLanded: z.number().int().min(0),
    roles: z.number().int().min(0),
    missing: z.number().int().min(0),
  }),
  /** Forecast canvases waiting for Apply (or failed): Apply them here. */
  canvases: z.array(ForecastCanvas),
  /**
   * Applied forecast canvases whose updates the sync has not seen land yet (With Slackbot), newest first: Open ↗ and
   * the Slackbot prompt until the next read finds the notes and Deal Roles in Org62.
   */
  withSlackbot: z.array(ForecastCanvas).default([]),
  /** "I created it, check now" checks of the last 12 hours that found their record: shown under No Specialist Forecast. */
  found: z.array(ForecastCheck).default([]),
  drafting: z.object({ running: z.array(Id), perDraftUsd: z.number().min(0), dayLeftUsd: z.number().min(0) }),
});
export type ForecastPayload = z.infer<typeof ForecastPayload>;

/** One record for the details panel: the row, the full mirror and what a draft would read. */
export const ForecastRecordDetail = z.object({
  row: ForecastRow,
  record: SpecialistForecast,
  /** The core opp's next step and products, from the app. */
  opportunity: z.object({ id: Id, name: z.string(), stage: z.string(), nextStep: z.string().nullable(), products: z.array(z.string()), url: Url.nullable() }).nullable(),
  /** Meetings with the account since the notes last changed (what a draft reads first). */
  meetingsSince: z.array(z.object({ id: Id, title: z.string(), start: IsoDateTime })),
  thresholds: ForecastThresholds,
});
export type ForecastRecordDetail = z.infer<typeof ForecastRecordDetail>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const ForecastRecordParams = z.object({ id: Id });

export const SyncForecastResult = z.object({ queued: z.boolean(), note: z.string() });
export type SyncForecastResult = z.infer<typeof SyncForecastResult>;

/** Draft one record's note (`ids: [id]`) or "Draft all" (no ids: every queued record without a current draft). */
export const DraftForecastNotesRequest = z.object({ ids: z.array(Id).optional() });
export const DraftForecastNotesResult = z.object({
  queued: z.array(Id),
  /** Drafted at once (mock: the placeholder drafter). */
  drafted: z.array(Id),
  skipped: z.array(z.object({ id: Id, why: z.string() })),
  capUsd: z.number().min(0),
});
export type DraftForecastNotesResult = z.infer<typeof DraftForecastNotesResult>;

/**
 * Edit one record's update: the note text (an edit of a draft, or your own), approve or un-approve it, discard it,
 * approve a Deal Role fix (Aware unless you pick another) or drop it.
 */
export const PatchForecastRequest = z
  .object({
    notes: z.string().trim().min(1).max(4000).optional(),
    notesState: z.enum(['drafted', 'approved']).optional(),
    discardNotes: z.boolean().optional(),
    dealRole: DealRole.exclude(['None']).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'nothing to change');
export type PatchForecastRequest = z.infer<typeof PatchForecastRequest>;

/**
 * "I created it, check now" (POST /time/forecast/missing/:id/check, `id` = the app's opportunity): one read-only
 * re-read of that opp's Specialist Forecast, queued for the worker, and a full read FOLLOW_UP later.
 */
export const CheckMissingForecastResult = z.object({
  queued: z.boolean(),
  note: z.string(),
  check: ForecastCheck,
  /** When the full read after it runs (the mirror otherwise reads once a day). */
  followUpAt: IsoDateTime.nullable(),
});
export type CheckMissingForecastResult = z.infer<typeof CheckMissingForecastResult>;

/** "Stage N notes": the approved updates not in a canvas yet → ONE Outbox canvas item, previewed for its one Apply. */
export const StageForecastRequest = z.object({ ids: z.array(Id).optional() }).default({});
export const StageForecastResult = z.object({
  draftId: Id.nullable(),
  title: z.string().nullable(),
  notes: z.number().int().min(0),
  roles: z.number().int().min(0),
  /** Already in a canvas waiting for Apply: not staged again. */
  waiting: z.object({ updates: z.number().int().min(0), draftIds: z.array(Id) }),
  /** Approved but left for the next canvas (one canvas holds at most 12,000 characters). */
  deferred: z.array(Id),
});
export type StageForecastResult = z.infer<typeof StageForecastResult>;
