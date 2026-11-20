-- Specialist Forecasts (lane A, D-55 feature specialistForecast): a read-only mirror of the SpecialistForecast__c records I
-- own for this and next fiscal quarter (forecast.sync), linked to the local opp and account, plus the local review state
-- (`pending`). Adds one table; no backfill.
CREATE TABLE "specialist_forecasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"org62_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"org62_opportunity_id" text,
	"opportunity_id" uuid,
	"account_id" uuid,
	"opportunity_name" text,
	"account_name" text,
	"opp_stage" text,
	"opp_next_step" text,
	"opp_close_date" date,
	"notes" text,
	"prev_notes" text,
	"mgr_notes" text,
	"deal_role" text,
	"judgement" text,
	"forecast_status" text,
	"amount" numeric(14, 2),
	"stage" text,
	"close_date" date,
	"fiscal_quarter" text,
	"owner_org62_id" text,
	"last_modified_at" timestamp with time zone,
	"notes_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gone_at" timestamp with time zone,
	"pending" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "specialist_forecasts_org62_id_chk" CHECK ("specialist_forecasts"."org62_id" ~ '^[A-Za-z0-9]{15,18}$')
);
--> statement-breakpoint
ALTER TABLE "specialist_forecasts" ADD CONSTRAINT "specialist_forecasts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialist_forecasts" ADD CONSTRAINT "specialist_forecasts_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialist_forecasts" ADD CONSTRAINT "specialist_forecasts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "specialist_forecasts_owner_org62_uidx" ON "specialist_forecasts" USING btree ("owner_user_id","org62_id");--> statement-breakpoint
CREATE INDEX "specialist_forecasts_opportunity_idx" ON "specialist_forecasts" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "specialist_forecasts_owner_quarter_idx" ON "specialist_forecasts" USING btree ("owner_user_id","fiscal_quarter");