-- D-67 (VDP use cases → Org62 Use_Case__c): the Use_Case__c records on my opps as the Org62 read-back reads them,
-- linked to the VDP use case each one is, plus one row per user saying when that read last ran. Read-only state of an
-- external system plus the link, so not audited (like org62_events / vdp_records). Additive; no backfill: the next
-- read-back (daily 06:40, or Health ▸ Org62 ▸ Re-check Org62 records) fills it, and creates wait for that first read.
CREATE TABLE "org62_use_case_reads" (
	"owner_user_id" uuid PRIMARY KEY NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"opps" integer DEFAULT 0 NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org62_use_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"org62_use_case_id" text NOT NULL,
	"org62_opportunity_id" text,
	"org62_account_id" text,
	"name" text,
	"product" text,
	"stage" text,
	"go_live_date" text,
	"owner_org62_id" text,
	"created_by_org62_id" text,
	"org62_created_at" timestamp with time zone,
	"org62_modified_at" timestamp with time zone,
	"vdp_use_case_id" text,
	"link_origin" text,
	"synced_stage" text,
	"synced_go_live" text,
	"synced_name" text,
	"linked_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gone_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org62_use_case_reads" ADD CONSTRAINT "org62_use_case_reads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org62_use_cases" ADD CONSTRAINT "org62_use_cases_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org62_use_cases_owner_record_uidx" ON "org62_use_cases" USING btree ("owner_user_id","org62_use_case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org62_use_cases_owner_vdp_uc_uidx" ON "org62_use_cases" USING btree ("owner_user_id","vdp_use_case_id") WHERE "org62_use_cases"."vdp_use_case_id" is not null;--> statement-breakpoint
CREATE INDEX "org62_use_cases_owner_opp_idx" ON "org62_use_cases" USING btree ("owner_user_id","org62_opportunity_id");