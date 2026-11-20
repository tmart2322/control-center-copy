-- D-68 (dc-roundtrip): why the app closed a DC request by itself, never silently. `not_created`: a canvas handed it to
-- Slackbot and a complete Org62 read since shows no such DC (the opp is a gap again; Ask again makes a new request);
-- `changed_in_org62` / `dc_removed`: a change still waiting whose DC was changed or removed in Org62 (Org62 wins);
-- `opp_deleted`: the opportunity was deleted in Org62. Status stays `dismissed` (not live), so no index changes.
-- Additive, no backfill.
ALTER TABLE "deal_contribution_requests" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "deal_contribution_requests" ADD CONSTRAINT "deal_contribution_requests_outcome_chk" CHECK ("deal_contribution_requests"."outcome" is null or "deal_contribution_requests"."outcome" in ('not_created', 'changed_in_org62', 'dc_removed', 'opp_deleted'));