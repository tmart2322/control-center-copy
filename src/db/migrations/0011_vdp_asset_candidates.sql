-- VDP asset candidates (Time ▸ VDP details ▸ Assets to add): assets found for a VDP or a to-be-created one, with
-- provenance and a status (unsure / suggested / added / in_vdp / dismissed). Local state only; adds one table.
CREATE TABLE "vdp_asset_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"target_key" text NOT NULL,
	"vdp_slug" text,
	"account_id" uuid,
	"company_name" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"asset_key" text NOT NULL,
	"kind" text NOT NULL,
	"why" text NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"origin" text NOT NULL,
	"status" text DEFAULT 'suggested' NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_item_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vdp_asset_candidates_status_chk" CHECK ("vdp_asset_candidates"."status" IN ('unsure', 'suggested', 'added', 'in_vdp', 'dismissed')),
	CONSTRAINT "vdp_asset_candidates_origin_chk" CHECK ("vdp_asset_candidates"."origin" IN ('matcher', 'backfill', 'chat'))
);
--> statement-breakpoint
ALTER TABLE "vdp_asset_candidates" ADD CONSTRAINT "vdp_asset_candidates_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vdp_asset_candidates" ADD CONSTRAINT "vdp_asset_candidates_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vdp_asset_candidates_owner_target_asset_uidx" ON "vdp_asset_candidates" USING btree ("owner_user_id","target_key","asset_key");--> statement-breakpoint
CREATE INDEX "vdp_asset_candidates_owner_slug_idx" ON "vdp_asset_candidates" USING btree ("owner_user_id","vdp_slug");--> statement-breakpoint
CREATE INDEX "vdp_asset_candidates_account_idx" ON "vdp_asset_candidates" USING btree ("account_id");