-- DC requests know what they are: `add` (claim a DC I don't hold) or `change` (the split of the DC I hold, from
-- `from_split`, an UPDATE row on deal_contribution_id). Existing rows are adds. A confirmed (verified) request no
-- longer blocks the next request on the same opp. No backfill.
DROP INDEX "deal_contribution_requests_live_uidx";--> statement-breakpoint
ALTER TABLE "deal_contribution_requests" ADD COLUMN "kind" text DEFAULT 'add' NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_contribution_requests" ADD COLUMN "from_split" numeric(5, 2);--> statement-breakpoint
CREATE UNIQUE INDEX "deal_contribution_requests_live_uidx" ON "deal_contribution_requests" USING btree ("owner_user_id","opportunity_id","role") WHERE "deal_contribution_requests"."status" not in ('dismissed', 'verified');--> statement-breakpoint
ALTER TABLE "deal_contribution_requests" ADD CONSTRAINT "deal_contribution_requests_kind_chk" CHECK ("deal_contribution_requests"."kind" in ('add', 'change'));