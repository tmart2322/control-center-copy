-- 0022 (0018, 0019 and 0021 are other lanes'). D-65 (2026-11-12, the Time ↔ Org62 round trip; TL-04, TL-07, TL-21): a real Org62 record is never hidden. A second
-- Event in a slot (logged twice by hand, a Slackbot duplicate, a canvas run twice), or a manual Event that overlaps a
-- row the user approved, stays a logged row with a flag ("possible duplicate in Org62", "overlaps … (both log)"),
-- because Org62 counts it. So the no-overlap exclusion no longer covers rows tied to an Org62 Event
-- (org62_event_row_id set: the read-back's own rows and the app rows it logged or verified). It still covers every
-- other counted non-calendar row: evidence guesses, build estimates and approved manual rows never overlap each other.
-- No backfill: PROJECTIONS_VERSION 10 re-projects every week; Org62 rows excluded only as an overlap come back logged.
ALTER TABLE activity_entries DROP CONSTRAINT activity_entries_no_overlap_excl;
--> statement-breakpoint

ALTER TABLE activity_entries ADD CONSTRAINT activity_entries_no_overlap_excl
  EXCLUDE USING gist (owner_user_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (operation = 'create' AND origin <> 'calendar' AND org62_event_row_id IS NULL AND status NOT IN ('excluded', 'dismissed', 'dropped'))
  DEFERRABLE INITIALLY IMMEDIATE;
