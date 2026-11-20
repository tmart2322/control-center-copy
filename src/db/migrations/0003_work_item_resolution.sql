CREATE TYPE "public"."work_item_involvement" AS ENUM('owner', 'contributor', 'watcher', 'not_involved');--> statement-breakpoint
CREATE TYPE "public"."work_item_resolution" AS ENUM('done_by_me', 'handed_off', 'done_by_other', 'not_needed', 'duplicate', 'declined', 'superseded');--> statement-breakpoint
ALTER TABLE "reopen_decisions" ADD COLUMN "trigger_person_id" uuid;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "resolution" "work_item_resolution";--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "resolution_person_id" uuid;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "resolution_work_item_id" uuid;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "resolution_inferred" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "resolution_evidence_id" uuid;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "owner_person_id" uuid;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "involvement" "work_item_involvement" DEFAULT 'owner' NOT NULL;--> statement-breakpoint
ALTER TABLE "reopen_decisions" ADD CONSTRAINT "reopen_decisions_trigger_person_id_people_id_fk" FOREIGN KEY ("trigger_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_resolution_person_id_people_id_fk" FOREIGN KEY ("resolution_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_resolution_work_item_id_work_items_id_fk" FOREIGN KEY ("resolution_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_resolution_evidence_id_work_item_evidence_id_fk" FOREIGN KEY ("resolution_evidence_id") REFERENCES "public"."work_item_evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_items_owner_person_idx" ON "work_items" USING btree ("owner_person_id") WHERE "work_items"."owner_person_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_resolution_chk" CHECK (("work_items"."resolution" IS NULL OR "work_items"."status" IN ('done', 'dismissed', 'merged')) AND "work_items"."resolution_work_item_id" IS DISTINCT FROM "work_items"."id");--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_handoff_chk" CHECK ("work_items"."resolution" IS DISTINCT FROM 'handed_off' OR "work_items"."involvement" IN ('watcher', 'not_involved'));