-- INTEGRATE-1 (BE-1b blocker B1): audit rows of tables without an `id` column.
--
-- cc_audit() recorded `row ->> 'id'` as audit_events.row_id (NOT NULL). work_item_training_details and
-- work_item_travel_details are 1:1 children keyed by work_item_id (their primary key, and also the trigger's
-- entity column), so every insert into them failed inside a change set.
--
-- Fix: the row key is `id`, else the trigger's entity column. Every other audited table has an `id`, so
-- nothing else changes. Chosen over a surrogate `id` because the detail tables stay keyed by their parent
-- (upserts stay `ON CONFLICT (work_item_id)`), there is no schema or snapshot change, and undo already
-- matches rows by the real primary key (pg_index), which for these tables is that same column.
-- Only the row_id expression differs from 0002_extras.
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
     coalesce(coalesce(v_new, v_old) ->> 'id', coalesce(v_new, v_old) ->> v_entity_col),
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
