/** Calendar events, attendees and meeting notes (section 6). */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstz, createdAt, updatedAt, ownerUserId, confidence, textArray } from './columns';
import {
  linkMethod,
  calendarEventType,
  calendarEventStatus,
  responseStatus,
  attendance,
  attendanceSource,
  meetingNoteKind,
  noteMatchMethod,
} from './enums';
import { connectors } from './connectors';
import { sourceItems } from './sources';
import { accounts, opportunities, people } from './entities';

export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    connectorId: uuid('connector_id').references(() => connectors.id, { onDelete: 'set null' }),
    calendarId: text('calendar_id').notNull(),
    /** Instance id (recurring instances carry the _YYYYMMDDTHHMMSSZ suffix). */
    externalEventId: text('external_event_id').notNull(),
    recurringEventId: text('recurring_event_id'),
    icalUid: text('ical_uid'),
    /** Latest raw snapshot. */
    sourceItemId: uuid('source_item_id').references(() => sourceItems.id, { onDelete: 'set null' }),
    title: text('title'),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    /** Start date in the owner's timezone (app-computed). */
    localDay: date('local_day', { mode: 'string' }).notNull(),
    isAllDay: boolean('is_all_day').notNull().default(false),
    timezone: text('timezone'),
    eventType: calendarEventType('event_type').notNull().default('default'),
    status: calendarEventStatus('status').notNull().default('confirmed'),
    organizerPersonId: uuid('organizer_person_id').references(() => people.id, { onDelete: 'set null' }),
    iAmOrganizer: boolean('i_am_organizer').notNull().default(false),
    myResponse: responseStatus('my_response').notNull().default('none'),
    attendance: attendance('attendance').notNull().default('unknown'),
    attendanceSource: attendanceSource('attendance_source'),
    attendanceConfidence: confidence('attendance_confidence'),
    /** From the transcript ("Transcription ended after 01:05:13"). */
    actualStartedAt: tstz('actual_started_at'),
    actualEndedAt: tstz('actual_ended_at'),
    hasExternalAttendees: boolean('has_external_attendees').notNull().default(false),
    externalDomains: textArray('external_domains'),
    conferenceUrl: text('conference_url'),
    htmlLink: text('html_link'),
    /** Where it is, as the calendar says (street address, room, airport): onsite days read it (onsite lane). */
    location: text('location'),
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    opportunityId: uuid('opportunity_id').references(() => opportunities.id, { onDelete: 'set null' }),
    mappingMethod: linkMethod('mapping_method'),
    mappingConfidence: confidence('mapping_confidence'),
    /** User corrected the mapping; engines must not overwrite. */
    mappingLocked: boolean('mapping_locked').notNull().default(false),
    deletedUpstreamAt: tstz('deleted_upstream_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('calendar_events_owner_cal_event_uidx').on(t.ownerUserId, t.calendarId, t.externalEventId),
    index('calendar_events_owner_starts_idx').on(t.ownerUserId, t.startsAt),
    index('calendar_events_owner_day_idx').on(t.ownerUserId, t.localDay),
    index('calendar_events_opportunity_idx').on(t.opportunityId),
    index('calendar_events_missed_idx').on(t.ownerUserId, t.startsAt.desc()).where(sql`${t.attendance} = 'missed'`),
    check('calendar_events_range_chk', sql`${t.endsAt} >= ${t.startsAt}`),
  ],
);

export const calendarEventAttendees = pgTable(
  'calendar_event_attendees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    calendarEventId: uuid('calendar_event_id').notNull(),
    personId: uuid('person_id').references(() => people.id, { onDelete: 'set null' }),
    email: text('email').notNull(),
    displayName: text('display_name'),
    responseStatus: responseStatus('response_status').notNull().default('none'),
    isOrganizer: boolean('is_organizer').notNull().default(false),
    isOptional: boolean('is_optional').notNull().default(false),
    isSelf: boolean('is_self').notNull().default(false),
    isExternal: boolean('is_external').notNull().default(false),
    domain: text('domain'),
  },
  (t) => [
    foreignKey({
      name: 'calendar_event_attendees_calendar_event_id_fk',
      columns: [t.calendarEventId],
      foreignColumns: [calendarEvents.id],
    }).onDelete('cascade'),
    uniqueIndex('calendar_event_attendees_event_email_uidx').on(t.calendarEventId, t.email),
    index('calendar_event_attendees_person_idx').on(t.personId),
  ],
);

export const meetingNotes = pgTable(
  'meeting_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: ownerUserId(),
    calendarEventId: uuid('calendar_event_id').references(() => calendarEvents.id, { onDelete: 'set null' }),
    sourceItemId: uuid('source_item_id')
      .notNull()
      .references(() => sourceItems.id, { onDelete: 'cascade' }),
    kind: meetingNoteKind('kind').notNull(),
    docExternalId: text('doc_external_id'),
    url: text('url'),
    arrivedAt: tstz('arrived_at').notNull(),
    matchMethod: noteMatchMethod('match_method'),
    matchConfidence: confidence('match_confidence'),
    actualDurationSeconds: integer('actual_duration_seconds'),
    nextStepsParsedAt: tstz('next_steps_parsed_at'),
    nextStepCount: smallint('next_step_count').notNull().default(0),
    myNextStepCount: smallint('my_next_step_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('meeting_notes_source_item_uidx').on(t.sourceItemId),
    index('meeting_notes_event_idx').on(t.calendarEventId),
    index('meeting_notes_unmatched_idx').on(t.ownerUserId, t.arrivedAt.desc()).where(sql`${t.calendarEventId} IS NULL`),
  ],
);

export type CalendarEvent = typeof calendarEvents.$inferSelect;
