CREATE TABLE "scan_run_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_item_id" uuid,
	"work_item_id" uuid
);
--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "budget" text DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_run_events" ADD CONSTRAINT "scan_run_events_run_id_scan_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scan_run_events_run_seq_uidx" ON "scan_run_events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "scan_run_events_source_item_idx" ON "scan_run_events" USING btree ("source_item_id") WHERE "scan_run_events"."source_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "scan_run_events_work_item_idx" ON "scan_run_events" USING btree ("work_item_id") WHERE "scan_run_events"."work_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "scan_run_events_ts_idx" ON "scan_run_events" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "scan_run_events_kind_ts_idx" ON "scan_run_events" USING btree ("kind","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "llm_calls_job_idx" ON "llm_calls" USING btree ("job_id") WHERE "llm_calls"."job_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_budget_chk" CHECK ("llm_calls"."budget" IN ('daily', 'first_scan'));--> statement-breakpoint
-- Spend attribution backfill (AUDIT): a scan run's spend belongs to the job that ran it, and a first-scan job's spend to
-- the one-time first-scan budget (B-080). Approximate for runs after that budget ran out (they spent the daily cap).
UPDATE "llm_calls" c SET "job_id" = r."job_id"
  FROM "scan_runs" r
 WHERE c."scan_run_id" = r."id" AND c."job_id" IS NULL AND r."job_id" IS NOT NULL;--> statement-breakpoint
UPDATE "llm_calls" c SET "budget" = 'first_scan'
  FROM "scan_runs" r JOIN "jobs" j ON j."id" = r."job_id"
 WHERE c."scan_run_id" = r."id" AND j."payload"->>'budget' = 'first_scan';
