-- D-18 amended (2026-11-11, Settings ▸ Time ▸ Overlapping meetings, default "log every accepted meeting"): an accepted
-- meeting always logs, two overlapping accepted meetings both log, and an onsite day logs in full with the meetings
-- during it. Those rows are all calendar rows (origin = 'calendar': meetings, onsite frames, travel), so the
-- no-overlap exclusion now covers every other counted row: evidence guesses, build estimates, manual and Org62 rows
-- still never overlap each other. The engine and the projections keep calendar rows from overlapping where the user
-- chose "count overlapping time once", and keep estimates off real events in both modes. time_blocks (the wall clock)
-- is unchanged. No backfill: the next recompute turns rows excluded only for an overlap back into proposals.
ALTER TABLE activity_entries DROP CONSTRAINT activity_entries_no_overlap_excl;
--> statement-breakpoint

ALTER TABLE activity_entries ADD CONSTRAINT activity_entries_no_overlap_excl
  EXCLUDE USING gist (owner_user_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (operation = 'create' AND origin <> 'calendar' AND status NOT IN ('excluded', 'dismissed', 'dropped'))
  DEFERRABLE INITIALLY IMMEDIATE;
