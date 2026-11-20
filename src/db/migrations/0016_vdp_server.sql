-- D-59 (VDP automation): what the VDP server can do, read with the mirror every 30 min. One row per user holding the
-- server's tool names and argument names (tools/list), the Deliverable types when it has that lookup, and
-- list_companies matches for engaged accounts with no VDP. Names and ids only; replaced by each read, so not audited
-- (like vdp_records). No backfill: the next VDP read fills it; until then the shipped tools are assumed.
CREATE TABLE "vdp_server" (
	"owner_user_id" uuid PRIMARY KEY NOT NULL,
	"info" jsonb NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vdp_server" ADD CONSTRAINT "vdp_server_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;