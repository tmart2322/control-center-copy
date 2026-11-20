-- Onsite lane (step 6): calendar event location as a real column (onsite days read it), and the onsite frame block
-- source. No backfill here (calendar_events is audited, so writes need a change set): the projections re-project every
-- event once (PROJECTIONS_VERSION 2), and the week pass falls back to the ext location meanwhile.
ALTER TYPE "public"."time_block_source" ADD VALUE 'onsite';--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "location" text;
