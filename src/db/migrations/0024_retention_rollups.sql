-- 0024 (lane E, audit 2026-11-13, E4): the LLM audit trail's daily rollups. llm_calls and llm_decisions are kept
-- at least 400 days; past that, the nightly retention job (retention.scrub) rolls each day up into these tables and
-- deletes the same rows in one transaction, so nothing is ever deleted unrolled. New tables only: nothing is backfilled
-- and nothing existing changes.
CREATE TABLE "llm_call_days" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"purpose" "llm_purpose" NOT NULL,
	"model" text NOT NULL,
	"model_tier" "model_tier" NOT NULL,
	"skill_key" text DEFAULT '' NOT NULL,
	"budget" text DEFAULT 'daily' NOT NULL,
	"trigger" text DEFAULT '' NOT NULL,
	"model_reason" text DEFAULT '' NOT NULL,
	"status" "llm_call_status" NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_write_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"estimated_calls" integer DEFAULT 0 NOT NULL,
	"latency_ms_total" bigint DEFAULT 0 NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"rolled_up_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_call_days_uq" UNIQUE("owner_user_id","day","purpose","model","model_tier","skill_key","budget","trigger","model_reason","status")
);
--> statement-breakpoint
CREATE TABLE "llm_decision_days" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"skill_key" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"trigger" text DEFAULT '' NOT NULL,
	"decisions" integer DEFAULT 0 NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"rolled_up_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_decision_days_uq" UNIQUE("owner_user_id","day","skill_key","kind","reason","trigger"),
	CONSTRAINT "llm_decision_days_kind_chk" CHECK ("llm_decision_days"."kind" IN ('skip', 'escalate', 'block'))
);
--> statement-breakpoint
ALTER TABLE "llm_call_days" ADD CONSTRAINT "llm_call_days_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_decision_days" ADD CONSTRAINT "llm_decision_days_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_call_days_owner_day_idx" ON "llm_call_days" USING btree ("owner_user_id","day");--> statement-breakpoint
CREATE INDEX "llm_decision_days_owner_day_idx" ON "llm_decision_days" USING btree ("owner_user_id","day");