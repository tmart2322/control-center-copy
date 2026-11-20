-- 0025 (D-70, docs/design/landings.md): where every record lands and every write that put it there.
--   record_landings  one row per record kind x record id x destination (external id, state, remote values)
--   landing_writes   one immutable row per create / update / delete a logging canvas, a VDP item or a proposed Event
--                    update carries (before, after, state, reason); only its state moves
--   use_cases        the app's own use case: one id per use case, whichever system it came from
-- New tables only, not audited (like org62_use_cases): the landing sync (src/server/landings/sync.ts) writes them, and
-- its first pass backfills from the drafts, rows, DC requests, Org62 use cases and the VDP mirror (reason 'backfill').
-- Nothing existing changes.
CREATE TABLE "landing_writes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"landing_id" uuid NOT NULL,
	"draft_id" uuid,
	"row_key" text NOT NULL,
	"op" text NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"state" text NOT NULL,
	"origin" text DEFAULT 'canvas' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"sent_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "landing_writes_op_chk" CHECK ("landing_writes"."op" IN ('create', 'update', 'delete')),
	CONSTRAINT "landing_writes_state_chk" CHECK ("landing_writes"."state" IN ('proposed', 'approved', 'dismissed', 'staged', 'sent', 'verified', 'failed', 'removed', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "record_landings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"record_kind" text NOT NULL,
	"record_id" text NOT NULL,
	"destination" text NOT NULL,
	"external_id" text,
	"state" text DEFAULT 'not_sent' NOT NULL,
	"remote_values" jsonb,
	"verified_at" timestamp with time zone,
	"last_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_landings_state_chk" CHECK ("record_landings"."state" IN ('not_sent', 'staged', 'sent', 'verified', 'differs', 'missing'))
);
--> statement-breakpoint
CREATE TABLE "use_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"vdp_use_case_id" text,
	"org62_use_case_id" text,
	"vdp_slug" text,
	"title" text DEFAULT '' NOT NULL,
	"account_id" uuid,
	"opportunity_id" uuid,
	"org62_opportunity_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "landing_writes" ADD CONSTRAINT "landing_writes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landing_writes" ADD CONSTRAINT "landing_writes_landing_id_record_landings_id_fk" FOREIGN KEY ("landing_id") REFERENCES "public"."record_landings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_landings" ADD CONSTRAINT "record_landings_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "use_cases" ADD CONSTRAINT "use_cases_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "landing_writes_landing_idx" ON "landing_writes" USING btree ("landing_id");--> statement-breakpoint
CREATE INDEX "landing_writes_draft_idx" ON "landing_writes" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "landing_writes_owner_state_idx" ON "landing_writes" USING btree ("owner_user_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "landing_writes_owner_draft_row_uidx" ON "landing_writes" USING btree ("owner_user_id","draft_id","row_key") WHERE "landing_writes"."draft_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "record_landings_owner_record_dest_uidx" ON "record_landings" USING btree ("owner_user_id","record_kind","record_id","destination");--> statement-breakpoint
CREATE INDEX "record_landings_owner_state_idx" ON "record_landings" USING btree ("owner_user_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "use_cases_owner_vdp_uidx" ON "use_cases" USING btree ("owner_user_id","vdp_use_case_id") WHERE "use_cases"."vdp_use_case_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "use_cases_owner_org62_uidx" ON "use_cases" USING btree ("owner_user_id","org62_use_case_id") WHERE "use_cases"."org62_use_case_id" is not null;