-- 0023 (lane D, audit 2026-11-13, D0): the LLM ledger is auditable. Every llm_calls row can say what started it
-- (trigger), why that model (model_reason), what came of it (outcome) and a hash of its prompt + input (content_hash,
-- so identical repeats are visible; never the prompt). llm_decisions records every decision NOT to call the model, to
-- escalate, or a call a budget refused, with its reason, counted per (day, skill, kind, reason, trigger, subject).
-- No backfill: rows from before this migration keep null trigger / model_reason (the view says "not recorded").
-- Retention (for lane E): keep llm_calls and llm_decisions >= 400 days, then roll up to daily aggregates.
CREATE TABLE "llm_decisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"skill_key" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"trigger" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"llm_call_id" bigint,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_decisions_uq" UNIQUE("owner_user_id","day","skill_key","kind","reason","trigger","subject"),
	CONSTRAINT "llm_decisions_kind_chk" CHECK ("llm_decisions"."kind" IN ('skip', 'escalate', 'block'))
);
--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "trigger" text;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "model_reason" text;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "llm_decisions" ADD CONSTRAINT "llm_decisions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_decisions" ADD CONSTRAINT "llm_decisions_llm_call_id_llm_calls_id_fk" FOREIGN KEY ("llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_decisions_owner_day_idx" ON "llm_decisions" USING btree ("owner_user_id","day");--> statement-breakpoint
CREATE INDEX "llm_calls_owner_content_idx" ON "llm_calls" USING btree ("owner_user_id","content_hash") WHERE "llm_calls"."content_hash" IS NOT NULL;