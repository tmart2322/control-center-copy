-- VDP mirror (scan.vdp): the VDP id, company, raw Org62 ids, archive/gone marks, last activity and the full normalized
-- VDP (`detail` jsonb: header, owners, every use-case field, stakeholders, assets). Read-only mirror; no backfill.
ALTER TABLE "vdp_records" ADD COLUMN "vdp_id" text;--> statement-breakpoint
ALTER TABLE "vdp_records" ADD COLUMN "company_name" text;--> statement-breakpoint
ALTER TABLE "vdp_records" ADD COLUMN "salesforce_account_id" text;--> statement-breakpoint
ALTER TABLE "vdp_records" ADD COLUMN "salesforce_opportunity_id" text;--> statement-breakpoint
ALTER TABLE "vdp_records" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vdp_records" ADD COLUMN "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vdp_records" ADD COLUMN "gone_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vdp_records" ADD COLUMN "detail" jsonb;