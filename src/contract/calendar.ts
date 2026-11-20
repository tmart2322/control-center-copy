/**
 * Calendar events and day-spine slots (Today spine, Time page).
 */
import { z } from 'zod';
import { Id, IsoDateTime, Minutes, PersonRef, SourceRef, Url, WorkState } from './common';
import { ReadInState } from './readin';

export const Attendance = z.enum(['upcoming', 'in_progress', 'attended', 'missed', 'declined', 'cancelled']);
export type Attendance = z.infer<typeof Attendance>;

/** An answer to an invite. `needs_action` = invited, no answer yet; `none` = not known. */
export const InviteResponse = z.enum(['accepted', 'declined', 'tentative', 'needs_action', 'none']);
export type InviteResponse = z.infer<typeof InviteResponse>;

/**
 * One guest on the invite: a PersonRef plus what the invite says about them (additive, all optional).
 * Absent `response` = not known; absent `optional` / `organizer` = no.
 */
export const EventAttendee = PersonRef.extend({
  response: InviteResponse.optional(),
  optional: z.boolean().optional(),
  organizer: z.boolean().optional(),
});
export type EventAttendee = z.infer<typeof EventAttendee>;

/** Who sent the invite. `personId` when they are a known person; `isMe` when it is my own meeting. */
export const EventOrganizer = z.object({
  name: z.string(),
  personId: Id.nullable().default(null),
  isMe: z.boolean().default(false),
  isExternal: z.boolean().default(false),
});
export type EventOrganizer = z.infer<typeof EventOrganizer>;

/** A file attached to the invite (a deck, a doc). `url` opens it; null when the invite gave no file id. */
export const EventAttachment = z.object({
  title: z.string(),
  url: Url.nullable().default(null),
  kind: z.enum(['deck', 'doc', 'sheet', 'pdf', 'other']).default('other'),
});
export type EventAttachment = z.infer<typeof EventAttachment>;

export const CalendarEvent = z.object({
  id: Id,
  title: z.string(),
  start: IsoDateTime,
  end: IsoDateTime,
  attendance: Attendance,
  isCustomerFacing: z.boolean().default(false),
  accountId: Id.nullable().default(null),
  oppId: Id.nullable().default(null),
  /** The other guests (never me), each with their answer when the invite says it. */
  attendees: z.array(EventAttendee).default([]),
  location: z.string().nullable().default(null),
  /**
   * The conference link (Meet, Zoom, Teams, Webex): the invite's conference data, else (db) the first meeting
   * link in the location or the agenda.
   */
  meetingUrl: Url.nullable().default(null),
  /**
   * The invite's description as plain text, redacted as ingest redacted it (credential-like text replaced), at
   * most ~2,000 characters. Never HTML: render it as text (links may be made clickable). Null when the invite
   * has none, or (db) once the source body was purged (90 days).
   */
  agenda: z.string().nullable().default(null),
  organizer: EventOrganizer.nullable().default(null),
  attachments: z.array(EventAttachment).default([]),
  /** "prep ready ›" link under the block. */
  prep: z.object({ ready: z.boolean(), label: z.string(), workItemId: Id.nullable() }).nullable().default(null),
  /** Missed meeting → "2 takeaways → tasks" chip (R-UI-3). */
  takeaways: z.object({ count: z.number().int(), workItemIds: z.array(Id), notesUrl: Url.nullable() }).nullable().default(null),
  source: SourceRef,
  /**
   * My answer to the invite, when `attendance` cannot say it (additive, optional). Absent = derived from
   * `attendance` (declined → declined, otherwise accepted). Tentative and unanswered invites show on Today
   * but never block time (DESIGN-V2 capacity: only accepted meetings block).
   */
  myResponse: z.enum(['accepted', 'declined', 'tentative', 'needs_action', 'none']).optional(),
  /** All-day event (never blocks time). Absent = false. */
  isAllDay: z.boolean().optional(),
  /** Google event type (out of office, focus time, working location never block). Absent = default. */
  eventType: z.enum(['default', 'out_of_office', 'focus_time', 'working_location']).optional(),
});
export type CalendarEvent = z.infer<typeof CalendarEvent>;

/** Labels on the spine for slotted work and gaps. Labels only: they never duplicate cards. */
export const SpineSlot = z.object({
  id: Id,
  kind: z.enum(['work', 'gap', 'fit_in', 'focus']),
  start: IsoDateTime,
  end: IsoDateTime,
  label: z.string(), // "10:05 ▶ Kick off build", "11:30 30m gap: fits Training"
  workItemId: Id.nullable().default(null),
});
export type SpineSlot = z.infer<typeof SpineSlot>;

export const CalendarPayload = z.object({
  from: IsoDateTime,
  to: IsoDateTime,
  events: z.array(CalendarEvent),
  slots: z.array(SpineSlot),
});
export type CalendarPayload = z.infer<typeof CalendarPayload>;

/** A work item that serves the meeting (its prep), as the hover card and the meeting panel list it. */
export const EventPrepItem = z.object({
  id: Id,
  title: z.string(),
  state: WorkState,
  /** My hands-on minutes left (0 once done or waiting on others). */
  youMin: Minutes,
});
export type EventPrepItem = z.infer<typeof EventPrepItem>;

/**
 * GET /calendar/events/:id: one meeting with what the hover card and the meeting panel show beside it.
 * `prep` = the live and done work items that serve it (`servesEventId`, or the invite's prep item), in that order;
 * `account` / `opp` = the names behind `accountId` / `oppId`; `readIn` = its read-in's state (null: none requested).
 */
export const CalendarEventDetail = z.object({
  event: CalendarEvent,
  prep: z.array(EventPrepItem),
  account: z.object({ id: Id, name: z.string() }).nullable(),
  opp: z.object({ id: Id, name: z.string(), stage: z.string().nullable() }).nullable(),
  readIn: z.object({ state: ReadInState, tldr: z.string(), generatedAt: IsoDateTime.nullable() }).nullable(),
});
export type CalendarEventDetail = z.infer<typeof CalendarEventDetail>;
