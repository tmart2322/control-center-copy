-- 0026 (2026-11-14 live pass, docs/UX.md "Live updates"): push for the tables the UI used to poll.
-- The cc_audit trigger notifies `cc_change` for every audited write. Jobs, scan runs, tool runs, app events, worker
-- instances and the read mirrors (VDP, Specialist Forecasts, Org62 use cases, landings) are not audited: they are
-- bookkeeping, not undoable, and mostly written by the worker. So Health, the tool run panel, the VDP push and the
-- Forecast sync polled every few seconds, and a VDP or Org62 read refreshed nothing until a reload.
-- These triggers send the same `cc_change` notice ({cs, entity_type, entity_id, table, op}) under a `tx:<txid>` change
-- set, delivered at COMMIT: per row on the transitions a view shows (an insert, a status change, a resolve), and once
-- per statement for the bulk-written mirrors (no ids: the views refetch by topic). Both buses map the table to its
-- topics (src/server/events/topics.ts TABLE_TOPICS); tests/events/topics.test.ts checks every table here resolves.
-- Nothing is written; no existing trigger changes.
CREATE OR REPLACE FUNCTION cc_live_notify() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_id := OLD.id::text; ELSE v_id := NEW.id::text; END IF;
  PERFORM pg_notify('cc_change', json_build_object(
    'cs', 'tx:' || txid_current()::text, 'entity_type', TG_TABLE_NAME, 'entity_id', v_id,
    'table', TG_TABLE_NAME, 'op', lower(TG_OP))::text);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cc_live_notify_stmt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('cc_change', json_build_object(
    'cs', 'tx:' || txid_current()::text, 'entity_type', TG_TABLE_NAME, 'entity_id', '',
    'table', TG_TABLE_NAME, 'op', lower(TG_OP))::text);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER jobs_live_ins_trg AFTER INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION cc_live_notify();
--> statement-breakpoint
CREATE TRIGGER jobs_live_upd_trg AFTER UPDATE ON jobs FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION cc_live_notify();
--> statement-breakpoint
CREATE TRIGGER scan_runs_live_ins_trg AFTER INSERT ON scan_runs FOR EACH ROW EXECUTE FUNCTION cc_live_notify();
--> statement-breakpoint
CREATE TRIGGER scan_runs_live_upd_trg AFTER UPDATE ON scan_runs FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION cc_live_notify();
--> statement-breakpoint
CREATE TRIGGER tool_runs_live_ins_trg AFTER INSERT ON tool_runs FOR EACH ROW EXECUTE FUNCTION cc_live_notify();
--> statement-breakpoint
CREATE TRIGGER tool_runs_live_upd_trg AFTER UPDATE ON tool_runs FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.output_summary IS DISTINCT FROM NEW.output_summary) EXECUTE FUNCTION cc_live_notify();
--> statement-breakpoint
CREATE TRIGGER app_events_live_ins_trg AFTER INSERT ON app_events FOR EACH ROW EXECUTE FUNCTION cc_live_notify();
--> statement-breakpoint
CREATE TRIGGER app_events_live_upd_trg AFTER UPDATE ON app_events FOR EACH ROW
  WHEN (OLD.resolved_at IS DISTINCT FROM NEW.resolved_at OR OLD.acknowledged_at IS DISTINCT FROM NEW.acknowledged_at) EXECUTE FUNCTION cc_live_notify();
--> statement-breakpoint
CREATE TRIGGER worker_instances_live_ins_trg AFTER INSERT ON worker_instances FOR EACH ROW EXECUTE FUNCTION cc_live_notify();
--> statement-breakpoint
CREATE TRIGGER worker_instances_live_upd_trg AFTER UPDATE ON worker_instances FOR EACH ROW
  WHEN (OLD.stopped_at IS DISTINCT FROM NEW.stopped_at) EXECUTE FUNCTION cc_live_notify();
--> statement-breakpoint
CREATE TRIGGER vdp_records_live_trg AFTER INSERT OR UPDATE OR DELETE ON vdp_records FOR EACH STATEMENT EXECUTE FUNCTION cc_live_notify_stmt();
--> statement-breakpoint
CREATE TRIGGER specialist_forecasts_live_trg AFTER INSERT OR UPDATE OR DELETE ON specialist_forecasts FOR EACH STATEMENT EXECUTE FUNCTION cc_live_notify_stmt();
--> statement-breakpoint
CREATE TRIGGER vdp_asset_candidates_live_trg AFTER INSERT OR UPDATE OR DELETE ON vdp_asset_candidates FOR EACH STATEMENT EXECUTE FUNCTION cc_live_notify_stmt();
--> statement-breakpoint
CREATE TRIGGER org62_use_cases_live_trg AFTER INSERT OR UPDATE OR DELETE ON org62_use_cases FOR EACH STATEMENT EXECUTE FUNCTION cc_live_notify_stmt();
--> statement-breakpoint
CREATE TRIGGER record_landings_live_trg AFTER INSERT OR UPDATE OR DELETE ON record_landings FOR EACH STATEMENT EXECUTE FUNCTION cc_live_notify_stmt();
--> statement-breakpoint
CREATE TRIGGER landing_writes_live_trg AFTER INSERT OR UPDATE OR DELETE ON landing_writes FOR EACH STATEMENT EXECUTE FUNCTION cc_live_notify_stmt();
--> statement-breakpoint
CREATE TRIGGER use_cases_live_trg AFTER INSERT OR UPDATE OR DELETE ON use_cases FOR EACH STATEMENT EXECUTE FUNCTION cc_live_notify_stmt();
