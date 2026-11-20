-- 0002_extras.sql (custom; runs after the generated schema)
-- Verbatim from docs/ui/DATA-MODEL.md §3.2 except where marked "BE-0 deviation" (see docs/ui/DB-NOTES.md).
-- Holds what Drizzle can't model: exclusion constraints, the audit trigger and where it attaches,
-- the append-only guards, the NOTIFY triggers, and the degradation view.

-- 1. Tenet "Hours are human hours": counted time never overlaps, in blocks or in log entries.
ALTER TABLE time_blocks ADD CONSTRAINT time_blocks_no_double_count_excl
  EXCLUDE USING gist (owner_user_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (counts_as_human_hours)
  DEFERRABLE INITIALLY IMMEDIATE;  -- the time engine rewrites a day with SET CONSTRAINTS ... DEFERRED
--> statement-breakpoint

ALTER TABLE activity_entries ADD CONSTRAINT activity_entries_no_overlap_excl
  EXCLUDE USING gist (owner_user_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (operation = 'create' AND status NOT IN ('excluded', 'dismissed', 'dropped'))
  DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint

-- 2. Audit trigger: every change to curated tables, by any actor, coalesced per change set.
--    Writers must run inside withChangeSet(), which does:
--      SELECT set_config('cc.change_set_id', $1, true), set_config('cc.actor_kind', $2, true),
--             set_config('cc.actor_ref', $3, true);
CREATE OR REPLACE FUNCTION cc_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_cs          uuid := nullif(current_setting('cc.change_set_id', true), '')::uuid;
  v_actor       actor_kind := nullif(current_setting('cc.actor_kind', true), '')::actor_kind;
  v_actor_ref   text := nullif(current_setting('cc.actor_ref', true), '');
  v_entity_type text := TG_ARGV[0];
  v_entity_col  text := TG_ARGV[1];
  v_omit        text[] := coalesce(TG_ARGV[2], '{}')::text[] || ARRAY['search_tsv'];
  v_owner       uuid;
  v_closed      timestamptz;
  v_old         jsonb;
  v_new         jsonb;
  v_changed     text[];
BEGIN
  IF v_cs IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'cc_audit: % on % outside a change set', TG_OP, TG_TABLE_NAME
      USING HINT = 'wrap the write in withChangeSet(actor, fn)';
  END IF;
  SELECT owner_user_id, closed_at INTO v_owner, v_closed FROM change_sets WHERE id = v_cs;
  IF NOT FOUND THEN RAISE EXCEPTION 'cc_audit: change set % does not exist', v_cs; END IF;
  IF v_closed IS NOT NULL THEN RAISE EXCEPTION 'cc_audit: change set % is closed', v_cs; END IF;

  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD) - v_omit; END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW) - v_omit; END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(n.key ORDER BY n.key) INTO v_changed
      FROM jsonb_each(v_new) n
     WHERE n.value IS DISTINCT FROM v_old -> n.key AND n.key NOT IN ('updated_at', 'version');
    IF v_changed IS NULL THEN RETURN NULL; END IF;  -- no-op re-sync: nothing to audit
  END IF;

  INSERT INTO audit_events AS a
    (owner_user_id, change_set_id, actor_kind, actor_ref, table_name, row_id, entity_type, entity_id,
     op, changed_fields, before, after)
  VALUES
    (v_owner, v_cs, v_actor, v_actor_ref, TG_TABLE_NAME,
     coalesce(v_new, v_old) ->> 'id',
     v_entity_type, coalesce(v_new, v_old) ->> v_entity_col,
     lower(TG_OP)::audit_op, coalesce(v_changed, '{}'), v_old, v_new)
  ON CONFLICT (change_set_id, table_name, row_id) DO UPDATE SET
    -- before stays the first image (the undo payload); after becomes the latest image
    after           = EXCLUDED.after,
    op              = CASE WHEN a.op = 'insert' AND EXCLUDED.op = 'update' THEN 'insert'::audit_op
                           ELSE EXCLUDED.op END,
    changed_fields  = (SELECT coalesce(array_agg(DISTINCT f ORDER BY f), '{}')
                         FROM unnest(a.changed_fields || EXCLUDED.changed_fields) AS f),
    coalesced_count = a.coalesced_count + 1,
    updated_at      = now();
  -- Live updates (R-UI-20): delivered at COMMIT, so views never see uncommitted state.
  PERFORM pg_notify('cc_change', json_build_object(
    'cs', v_cs, 'entity_type', v_entity_type, 'entity_id', coalesce(v_new, v_old) ->> v_entity_col,
    'table', TG_TABLE_NAME, 'op', lower(TG_OP))::text);
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cc_audit_kv() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_cs    uuid := nullif(current_setting('cc.change_set_id', true), '')::uuid;
  v_actor actor_kind := nullif(current_setting('cc.actor_kind', true), '')::actor_kind;
  v_owner uuid;
  v_old   jsonb;
  v_new   jsonb;
  v_row   jsonb;
BEGIN
  IF v_cs IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'cc_audit_kv: % on % outside a change set', TG_OP, TG_TABLE_NAME;
  END IF;
  SELECT owner_user_id INTO v_owner FROM change_sets WHERE id = v_cs AND closed_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'cc_audit_kv: change set % missing or closed', v_cs; END IF;
  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;
  v_row := coalesce(v_new, v_old);
  INSERT INTO audit_events AS a
    (owner_user_id, change_set_id, actor_kind, actor_ref, table_name, row_id, entity_type, entity_id,
     op, before, after)
  VALUES
    (v_owner, v_cs, v_actor, nullif(current_setting('cc.actor_ref', true), ''), TG_TABLE_NAME,
     (v_row ->> TG_ARGV[1]) || '|' || (v_row ->> TG_ARGV[2]),
     TG_ARGV[0], v_row ->> TG_ARGV[1], lower(TG_OP)::audit_op, v_old, v_new)
  ON CONFLICT (change_set_id, table_name, row_id) DO UPDATE SET
    after = EXCLUDED.after, op = EXCLUDED.op,
    coalesced_count = a.coalesced_count + 1, updated_at = now();
  RETURN NULL;
END $$;
--> statement-breakpoint

-- Attach: (table, root entity type, root id column, columns kept out of images)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('work_items',                 'work_items',              'id',                '{}'),
    ('work_item_evidence',         'work_items',              'work_item_id',      '{}'),
    ('work_item_links',            'work_items',              'work_item_id',      '{}'),
    ('work_item_relations',        'work_items',              'from_work_item_id', '{}'),
    ('work_item_deliverables',     'work_items',              'work_item_id',      '{}'),
    ('deliverable_requirements',   'work_item_deliverables',  'deliverable_id',    '{}'),
    ('work_item_training_details', 'work_items',              'work_item_id',      '{}'),
    ('work_item_travel_details',   'work_items',              'work_item_id',      '{}'),
    ('next_best_actions',          'work_items',              'work_item_id',      '{}'),
    ('extraction_candidates',      'source_items',            'source_item_id',    '{}'),
    ('source_item_links',          'source_items',            'source_item_id',    '{}'),
    ('drafts',                     'drafts',                  'id',                '{doc_json,plain_text}'),
    ('draft_recipients',           'drafts',                  'draft_id',          '{}'),
    ('activity_entries',           'activity_entries',        'id',                '{}'),
    ('deal_contribution_requests', 'deal_contribution_requests', 'id',             '{}'),
    ('missed_opp_findings',        'missed_opp_findings',     'id',                '{}'),
    ('accounts',                   'accounts',                'id',                '{}'),
    ('account_aliases',            'accounts',                'account_id',        '{}'),
    ('opportunities',              'opportunities',           'id',                '{}'),
    ('people',                     'people',                  'id',                '{}'),
    ('person_identities',          'people',                  'person_id',         '{}'),
    ('channels',                   'channels',                'id',                '{}'),
    ('channel_account_maps',       'channels',                'channel_id',        '{}'),
    ('repos',                      'repos',                   'id',                '{}'),
    ('assets',                     'assets',                  'id',                '{}'),
    ('calendar_events',            'calendar_events',         'id',                '{}'),
    ('meeting_notes',              'meeting_notes',           'id',                '{}'),
    ('claude_sessions',            'claude_sessions',         'id',                '{}'),
    ('mapping_rules',              'mapping_rules',           'id',                '{}'),
    ('autonomy_policies',          'users',                   'owner_user_id',     '{}'),
    ('priority_policies',          'priority_policies',       'id',                '{}'),
    ('priority_policy_rules',      'priority_policies',       'policy_id',         '{}'),
    ('task_capture_rules',         'users',                   'owner_user_id',     '{}'),
    ('voice_profiles',             'voice_profiles',          'id',                '{}'),
    ('connectors',                 'connectors',              'id',                '{}'),
    ('job_schedules',              'job_schedules',           'id',                '{}'),
    ('tool_adapters',              'tool_adapters',           'id',                '{}'),
    ('canvases',                   'canvases',                'id',                '{}'),
    ('llm_budgets',                'users',                   'owner_user_id',     '{}'),
    ('initiatives',                'initiatives',             'id',                '{}'),
    ('initiative_links',           'initiatives',             'initiative_id',     '{}'),
    ('change_proposals',           'change_proposals',        'id',                '{}'),
    ('watch_subscriptions',        'watch_subscriptions',     'id',                '{}'),
    ('brief_highlights',           'briefs',                  'brief_id',          '{}'),
    ('user_interests',             'users',                   'owner_user_id',     '{}')
  ) AS t(tbl, entity_type, entity_col, omit) LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION cc_audit(%L, %L, %L)',
      r.tbl || '_audit_trg', r.tbl, r.entity_type, r.entity_col, r.omit);
  END LOOP;
END $$;
--> statement-breakpoint

-- Manual notes are the only user-edited source items (bodies live in content_revisions).
CREATE TRIGGER source_items_manual_audit_trg AFTER INSERT OR UPDATE ON source_items
  FOR EACH ROW WHEN (NEW.kind = 'manual_note')
  EXECUTE FUNCTION cc_audit('source_items', 'id', '{body,meta}');
--> statement-breakpoint
CREATE TRIGGER source_items_manual_audit_del_trg AFTER DELETE ON source_items
  FOR EACH ROW WHEN (OLD.kind = 'manual_note')
  EXECUTE FUNCTION cc_audit('source_items', 'id', '{body,meta}');
--> statement-breakpoint

-- Composite-key tables.
CREATE TRIGGER activity_entry_time_blocks_audit_trg AFTER INSERT OR UPDATE OR DELETE ON activity_entry_time_blocks
  FOR EACH ROW EXECUTE FUNCTION cc_audit_kv('activity_entries', 'activity_entry_id', 'time_block_id');
--> statement-breakpoint
CREATE TRIGGER user_settings_audit_trg AFTER INSERT OR UPDATE OR DELETE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION cc_audit_kv('users', 'owner_user_id', 'key');
--> statement-breakpoint

-- 3. Append-only guards.
CREATE OR REPLACE FUNCTION cc_audit_events_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('cc.retention', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'audit_events is append-only';
  END IF;
  IF EXISTS (SELECT 1 FROM change_sets WHERE id = OLD.change_set_id AND closed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'audit_events: change set % is closed', OLD.change_set_id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_events_guard_trg BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION cc_audit_events_guard();
--> statement-breakpoint

-- BE-0 deviation: a DELETE is allowed only as the FK cascade of its work item being deleted
-- (e.g. undoing the change set that created the item). Any direct delete still raises.
CREATE OR REPLACE FUNCTION cc_transitions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM work_items WHERE id = OLD.work_item_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'work_item_transitions is append-only';
  END IF;
  IF (to_jsonb(NEW) - '{undone_at,undone_by_change_set_id}'::text[])
     IS DISTINCT FROM (to_jsonb(OLD) - '{undone_at,undone_by_change_set_id}'::text[]) THEN
    RAISE EXCEPTION 'work_item_transitions: only undone_at / undone_by_change_set_id may change';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER work_item_transitions_guard_trg BEFORE UPDATE OR DELETE ON work_item_transitions
  FOR EACH ROW EXECUTE FUNCTION cc_transitions_guard();
--> statement-breakpoint

-- 4. Derived "stale/degraded because connector X is broken" marker (R-UI-19).
CREATE VIEW work_item_degradations AS
WITH deps AS (
  -- evidence that came from a connector (Slack thread, Gmail thread, Drive file, ...)
  SELECT e.work_item_id, si.connector_id, 'evidence'::text AS dependency
    FROM work_item_evidence e
    JOIN source_items si ON si.id = e.source_item_id
   WHERE si.connector_id IS NOT NULL
  UNION
  SELECT e.work_item_id, si.connector_id, 'drive_evidence'
    FROM work_item_evidence e
    JOIN asset_snapshot_diffs d ON d.id = e.asset_diff_id
    JOIN asset_snapshots s ON s.id = d.to_snapshot_id
    JOIN source_items si ON si.id = s.source_item_id
   WHERE si.connector_id IS NOT NULL
  UNION
  -- the connector the closure test needs to see "done"
  SELECT wi.id, c.id, 'closure_test'
    FROM work_items wi
    JOIN connectors c ON c.owner_user_id = wi.owner_user_id AND c.enabled
     AND c.kind = (CASE wi.closure_kind
                     WHEN 'email_sent'               THEN 'gmail'
                     WHEN 'claude_session_completed' THEN 'claude'
                     WHEN 'org62_readback'           THEN 'org62'
                     WHEN 'vdp_readback'             THEN 'vdp'
                     WHEN 'deliverable_judged'       THEN 'drive'
                   END)::source_system
)
SELECT DISTINCT ON (d.work_item_id, c.id)
       d.work_item_id, wi.owner_user_id, c.id AS connector_id, c.kind AS connector_kind,
       c.status AS connector_status, d.dependency, c.status_reason,
       CASE WHEN c.status <> 'healthy' THEN c.status_changed_at ELSE c.last_success_at END AS degraded_since
  FROM deps d
  JOIN work_items wi ON wi.id = d.work_item_id
  JOIN connectors c ON c.id = d.connector_id
 WHERE wi.status NOT IN ('done', 'dismissed', 'merged')
   AND (c.status <> 'healthy'
        OR c.last_success_at < now() - make_interval(secs => c.stale_after_seconds))
 ORDER BY d.work_item_id, c.id, d.dependency;
--> statement-breakpoint

-- 5. Cooperative job cancel (R-UI-20): the worker LISTENs on cc_job_cancel and aborts the
--    AbortController of that job; jobs also re-check cancel_requested_at between steps.
CREATE OR REPLACE FUNCTION cc_job_cancel_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('cc_job_cancel', NEW.id::text);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER jobs_cancel_notify_trg AFTER UPDATE OF cancel_requested_at ON jobs
  FOR EACH ROW WHEN (OLD.cancel_requested_at IS NULL AND NEW.cancel_requested_at IS NOT NULL)
  EXECUTE FUNCTION cc_job_cancel_notify();
