CREATE TYPE "public"."activity_origin" AS ENUM('calendar', 'evidence', 'build_estimate', 'manual', 'chat', 'legacy_recreate', 'duration_backfill');--> statement-breakpoint
CREATE TYPE "public"."activity_status" AS ENUM('upcoming', 'needs_input', 'proposed', 'approved', 'synced_to_canvas', 'logged', 'verified', 'verify_failed', 'excluded', 'dismissed', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."actor_kind" AS ENUM('user', 'engine', 'chat', 'connector', 'system', 'autonomy_policy');--> statement-breakpoint
CREATE TYPE "public"."alias_kind" AS ENUM('name', 'short_name', 'domain', 'title_token', 'channel_pattern', 'repo_path', 'regex');--> statement-breakpoint
CREATE TYPE "public"."approval_method" AS ENUM('click', 'keyboard', 'chat_confirm', 'autonomy_policy');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('deck', 'doc', 'sheet', 'pdf', 'demo_org', 'repo_artifact', 'recording', 'talk_track', 'estimate', 'link', 'other');--> statement-breakpoint
CREATE TYPE "public"."asset_system" AS ENUM('drive', 'local_fs', 'slack_file', 'vdp', 'tool');--> statement-breakpoint
CREATE TYPE "public"."asset_tracking_tier" AS ENUM('none', 'inventory', 'watched');--> statement-breakpoint
CREATE TYPE "public"."attendance" AS ENUM('unknown', 'attended', 'missed', 'partial', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."attendance_source" AS ENUM('calendar_inference', 'transcript', 'notes_attendees', 'user');--> statement-breakpoint
CREATE TYPE "public"."attention_kind" AS ENUM('meeting', 'focused', 'background', 'ambient');--> statement-breakpoint
CREATE TYPE "public"."audit_op" AS ENUM('insert', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."auth_event_kind" AS ENUM('expiring_soon', 'expired', 'refreshed', 'revoked', 'mfa_required', 'reauth_requested', 'reauth_succeeded', 'reauth_failed');--> statement-breakpoint
CREATE TYPE "public"."autonomy_level" AS ENUM('L0_suggest', 'L1_draft', 'L2_stage', 'L3_one_click', 'L4_auto');--> statement-breakpoint
CREATE TYPE "public"."body_format" AS ENUM('plain', 'slack_mrkdwn', 'html', 'markdown');--> statement-breakpoint
CREATE TYPE "public"."brief_cadence" AS ENUM('since_last', 'daily', 'weekly', 'on_demand');--> statement-breakpoint
CREATE TYPE "public"."brief_status" AS ENUM('generating', 'ready', 'failed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."brief_style" AS ENUM('digest', 'narrative', 'changes_only');--> statement-breakpoint
CREATE TYPE "public"."budget_scope" AS ENUM('total', 'purpose', 'model_tier');--> statement-breakpoint
CREATE TYPE "public"."calendar_event_status" AS ENUM('confirmed', 'tentative', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."calendar_event_type" AS ENUM('default', 'out_of_office', 'focus_time', 'working_location');--> statement-breakpoint
CREATE TYPE "public"."candidate_decision" AS ENUM('pending', 'created', 'merged', 'needs_triage', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."canvas_purpose" AS ENUM('review_dashboard', 'slackbot_work_order');--> statement-breakpoint
CREATE TYPE "public"."canvas_section" AS ENUM('add_events', 'add_deal_contributions', 'update_fields', 'delete_events', 'needs_input', 'ready_to_load', 'upcoming', 'recently_logged');--> statement-breakpoint
CREATE TYPE "public"."canvas_sync_status" AS ENUM('in_sync', 'dirty', 'syncing', 'error');--> statement-breakpoint
CREATE TYPE "public"."capture_action" AS ENUM('auto_accept', 'triage', 'ignore');--> statement-breakpoint
CREATE TYPE "public"."catch_up_policy" AS ENUM('run_once', 'backfill_window', 'skip_missed');--> statement-breakpoint
CREATE TYPE "public"."change_set_kind" AS ENUM('user_edit', 'autosave_burst', 'engine_pass', 'chat_tool_call', 'connector_sync', 'undo', 'redo', 'rollback', 'system');--> statement-breakpoint
CREATE TYPE "public"."channel_kind" AS ENUM('public', 'private', 'dm', 'group_dm', 'shared_external');--> statement-breakpoint
CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant', 'system', 'tool');--> statement-breakpoint
CREATE TYPE "public"."chat_scope" AS ENUM('global', 'day', 'work_item', 'account', 'opportunity');--> statement-breakpoint
CREATE TYPE "public"."claude_entrypoint" AS ENUM('cli', 'desktop', 'vscode', 'cowork', 'agent_sdk', 'scheduled_task', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."claude_session_status" AS ENUM('launching', 'launch_failed', 'running', 'idle', 'waiting_on_me', 'completed', 'errored', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."closure_kind" AS ENUM('manual_only', 'reply_in_thread', 'email_sent', 'claude_session_completed', 'asset_delivered', 'deliverable_judged', 'org62_readback', 'vdp_readback', 'tool_run_succeeded', 'training_completed', 'llm_match');--> statement-breakpoint
CREATE TYPE "public"."config_source" AS ENUM('role_template', 'team_pack', 'user', 'chat', 'learned');--> statement-breakpoint
CREATE TYPE "public"."connector_status" AS ENUM('healthy', 'degraded', 'stale', 'auth_required', 'paused', 'disabled', 'error');--> statement-breakpoint
CREATE TYPE "public"."connector_transport" AS ENUM('mcp_http', 'mcp_stdio', 'claude_headless', 'agent_sdk', 'local_files', 'local_api', 'cli');--> statement-breakpoint
CREATE TYPE "public"."cursor_kind" AS ENUM('timestamp', 'page_token', 'sync_token', 'history_id', 'byte_offset', 'record_modstamp', 'composite');--> statement-breakpoint
CREATE TYPE "public"."cursor_status" AS ENUM('active', 'backfilling', 'paused', 'retired');--> statement-breakpoint
CREATE TYPE "public"."dc_request_status" AS ENUM('proposed', 'approved', 'synced_to_canvas', 'logged', 'verified', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."deliverable_kind" AS ENUM('slides', 'doc', 'whitepaper', 'sheet', 'other');--> statement-breakpoint
CREATE TYPE "public"."deliverable_status" AS ENUM('file_unresolved', 'not_started', 'in_progress', 'likely_complete', 'complete', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."delivery_mode" AS ENUM('send', 'stage', 'handoff');--> statement-breakpoint
CREATE TYPE "public"."diff_kind" AS ENUM('consecutive', 'since_baseline', 'ad_hoc');--> statement-breakpoint
CREATE TYPE "public"."draft_action_type" AS ENUM('slack_message', 'slack_reply', 'email_message', 'email_reply', 'vdp_update', 'org62_activity_batch', 'org62_deal_contribution', 'calendar_hold', 'canvas_rewrite', 'handoff');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('drafting', 'ready', 'approved', 'scheduled', 'sending', 'unconfirmed', 'sent', 'staged', 'handed_off', 'verified', 'verify_failed', 'failed', 'rejected', 'discarded', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."due_kind" AS ENUM('hard', 'soft', 'inferred');--> statement-breakpoint
CREATE TYPE "public"."effort_source" AS ENUM('default', 'llm', 'history', 'user');--> statement-breakpoint
CREATE TYPE "public"."entity_link_role" AS ENUM('about', 'from', 'to', 'mentions', 'attachment', 'container');--> statement-breakpoint
CREATE TYPE "public"."error_class" AS ENUM('transient', 'rate_limited', 'auth', 'validation', 'not_found', 'budget', 'bug', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."evidence_role" AS ENUM('origin', 'progress', 'completion', 'context', 'contradiction');--> statement-breakpoint
CREATE TYPE "public"."evidence_strength" AS ENUM('strong', 'some', 'none');--> statement-breakpoint
CREATE TYPE "public"."excluded_reason" AS ENUM('neither_type', 'overlap', 'ooo', 'placeholder', 'cap_trimmed', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."extractor_kind" AS ENUM('parser', 'rule', 'llm', 'user', 'chat');--> statement-breakpoint
CREATE TYPE "public"."highlight_level" AS ENUM('must_read', 'worth_a_look', 'fyi');--> statement-breakpoint
CREATE TYPE "public"."highlight_reason_kind" AS ENUM('my_account', 'my_opportunity', 'my_initiative', 'mentions_me', 'my_interest', 'policy_rule', 'stakeholder', 'keyword', 'similar_to_promoted', 'org62_change');--> statement-breakpoint
CREATE TYPE "public"."highlight_status" AS ENUM('new', 'seen', 'promoted', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."identity_system" AS ENUM('slack', 'email', 'org62_user', 'org62_contact', 'google', 'github', 'vdp');--> statement-breakpoint
CREATE TYPE "public"."importance_level" AS ENUM('critical', 'high', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."initiative_link_role" AS ENUM('stakeholder', 'asset', 'working_session', 'milestone_meeting', 'channel', 'related_opportunity', 'repo');--> statement-breakpoint
CREATE TYPE "public"."initiative_status" AS ENUM('proposed', 'active', 'paused', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."interest_kind" AS ENUM('skill', 'product', 'topic', 'keyword');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'dead', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."judgment_verdict" AS ENUM('complete', 'partial', 'no_change', 'regressed', 'unclear');--> statement-breakpoint
CREATE TYPE "public"."launch_mode" AS ENUM('desktop_session', 'agent_sdk', 'cli_headless');--> statement-breakpoint
CREATE TYPE "public"."ledger_object_kind" AS ENUM('channel_history', 'thread', 'dm', 'search_query', 'mailbox_page', 'calendar_range', 'drive_query', 'file', 'transcript_file', 'soql_query', 'vdp_list', 'git_log', 'canvas');--> statement-breakpoint
CREATE TYPE "public"."ledger_outcome" AS ENUM('complete', 'truncated', 'error', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."link_method" AS ENUM('connector', 'rule', 'llm', 'user', 'chat');--> statement-breakpoint
CREATE TYPE "public"."llm_call_status" AS ENUM('ok', 'error', 'refused', 'timeout', 'budget_blocked');--> statement-breakpoint
CREATE TYPE "public"."llm_purpose" AS ENUM('scan_extract', 'classify', 'commitment_extract', 'merge_check', 'done_match', 'resolve_entity', 'enrich', 'priority_explain', 'nba_generate', 'draft_generate', 'summarize', 'chat', 'other');--> statement-breakpoint
CREATE TYPE "public"."mapping_rule_kind" AS ENUM('domain_to_account', 'channel_to_account', 'repo_path_to_account', 'title_token_to_account', 'sender_to_person', 'keyword_to_task_type', 'meeting_to_opportunity', 'ignore_sender', 'ignore_channel');--> statement-breakpoint
CREATE TYPE "public"."meeting_note_kind" AS ENUM('gemini_notes', 'transcript', 'zoom_summary', 'pasted_notes', 'manual');--> statement-breakpoint
CREATE TYPE "public"."missed_opp_tier" AS ENUM('won_no_dc', 'strong_evidence_no_dc', 'core_account_no_dc', 'core_account_flex_only', 'renewal', 'light_touch', 'light_touch_flex_only', 'stranded_dc', 'already_covered');--> statement-breakpoint
CREATE TYPE "public"."missed_opp_verdict" AS ENUM('claim', 'check', 'skip');--> statement-breakpoint
CREATE TYPE "public"."model_tier" AS ENUM('none', 'haiku', 'sonnet', 'opus');--> statement-breakpoint
CREATE TYPE "public"."nba_status" AS ENUM('generating', 'ready', 'needs_input', 'stale', 'accepted', 'executing', 'completed', 'failed', 'superseded', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."nba_type" AS ENUM('reply', 'send_email', 'draft_doc', 'start_claude_session', 'run_tool', 'log_activity', 'update_vdp', 'schedule', 'nudge', 'confirm_done');--> statement-breakpoint
CREATE TYPE "public"."note_match_method" AS ENUM('calendar_attachment', 'title_and_date', 'email_subject', 'user');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('connector_auth_required', 'connector_degraded', 'job_dead_lettered', 'send_failed', 'verify_failed', 'deadline_approaching', 'budget_alert', 'budget_blocked', 'claude_waiting_on_me', 'likely_done_review', 'auto_closed', 'missed_meeting_followup', 'reconcile_gap', 'app_error');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('open', 'seen', 'snoozed', 'acknowledged', 'resolved', 'expired');--> statement-breakpoint
CREATE TYPE "public"."opp_finding_status" AS ENUM('new', 'reviewing', 'actioned', 'dismissed', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."org62_operation" AS ENUM('create', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."outbound_channel" AS ENUM('slack', 'email', 'vdp', 'org62', 'calendar', 'slack_canvas');--> statement-breakpoint
CREATE TYPE "public"."person_affiliation" AS ENUM('internal', 'customer', 'partner', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."plan_step_mode" AS ENUM('kickoff_background', 'meeting_prep', 'focus', 'quick_win', 'meeting', 'buffer');--> statement-breakpoint
CREATE TYPE "public"."policy_rule_kind" AS ENUM('boost', 'penalty', 'sla', 'lane_floor', 'lane_cap', 'never_above', 'exclude');--> statement-breakpoint
CREATE TYPE "public"."policy_status" AS ENUM('draft', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."priority_lane" AS ENUM('top3', 'now', 'next', 'later', 'background', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."priority_trigger" AS ENUM('schedule', 'new_info', 'calendar_change', 'user_reprioritize', 'chat', 'startup');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'accepted', 'rejected', 'superseded', 'expired');--> statement-breakpoint
CREATE TYPE "public"."provenance_role" AS ENUM('trigger', 'context', 'quoted', 'basis');--> statement-breakpoint
CREATE TYPE "public"."reauth_method" AS ENUM('refresh_script', 'mcp_oauth', 'devbar_login', 'manual_instructions');--> statement-breakpoint
CREATE TYPE "public"."reauth_status" AS ENUM('requested', 'running', 'needs_user', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."recipient_role" AS ENUM('to', 'cc', 'bcc', 'channel', 'mention');--> statement-breakpoint
CREATE TYPE "public"."reconcile_kind" AS ENUM('coverage_gap', 'unlinked_item', 'missed_item', 'stale_cursor', 'count_mismatch', 'deleted_upstream', 'duplicate_suspect', 'orphan_evidence');--> statement-breakpoint
CREATE TYPE "public"."reconcile_status" AS ENUM('open', 'rescan_queued', 'resolved', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."ref_kind" AS ENUM('person_mention', 'email_address', 'url', 'drive_file', 'slack_permalink', 'org62_id', 'vdp_slug', 'repo_path', 'file_path', 'git_sha', 'calendar_event');--> statement-breakpoint
CREATE TYPE "public"."relevance_feedback_kind" AS ENUM('promoted_to_triage', 'promoted_to_work_item', 'dismissed_not_relevant', 'marked_useful', 'opened');--> statement-breakpoint
CREATE TYPE "public"."rendition_format" AS ENUM('slack_mrkdwn', 'slack_blocks', 'email_html', 'email_text', 'canvas_markdown', 'plain_text');--> statement-breakpoint
CREATE TYPE "public"."reopen_outcome" AS ENUM('reopened', 'new_sibling', 'attached_as_context', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."repo_kind" AS ENUM('customer', 'demo_shared', 'tool', 'internal', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."requirement_status" AS ENUM('pending', 'addressed', 'partially_addressed', 'not_addressed', 'unclear', 'waived');--> statement-breakpoint
CREATE TYPE "public"."response_status" AS ENUM('accepted', 'declined', 'tentative', 'needs_action', 'none');--> statement-breakpoint
CREATE TYPE "public"."rule_source" AS ENUM('seed', 'team_pack', 'user_correction', 'llm_suggested');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."scan_mode" AS ENUM('incremental', 'backfill', 'reconcile', 'probe');--> statement-breakpoint
CREATE TYPE "public"."scan_trigger" AS ENUM('schedule', 'startup_catchup', 'manual', 'chat', 'hook', 'reconcile');--> statement-breakpoint
CREATE TYPE "public"."section_kind" AS ENUM('slide', 'heading_section', 'doc_tab', 'sheet_tab', 'page', 'whole_file');--> statement-breakpoint
CREATE TYPE "public"."send_attempt_status" AS ENUM('started', 'succeeded', 'failed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('debug', 'info', 'warn', 'error', 'critical');--> statement-breakpoint
CREATE TYPE "public"."snapshot_status" AS ENUM('ok', 'unreadable', 'permission_denied', 'too_large', 'unsupported');--> statement-breakpoint
CREATE TYPE "public"."source_item_kind" AS ENUM('slack_message', 'slack_canvas_snapshot', 'email_message', 'calendar_event', 'drive_file_revision', 'gemini_note', 'meeting_transcript', 'org62_record_snapshot', 'vdp_record_snapshot', 'claude_session', 'git_commit', 'manual_note', 'tool_output');--> statement-breakpoint
CREATE TYPE "public"."source_system" AS ENUM('slack', 'gmail', 'calendar', 'drive', 'gemini_notes', 'org62', 'vdp', 'claude', 'git', 'manual', 'chat', 'tool', 'app');--> statement-breakpoint
CREATE TYPE "public"."stakeholder_tier" AS ENUM('leader', 'manager', 'ae', 'teammate', 'customer_exec', 'customer', 'partner', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."supersede_reason" AS ENUM('new_source_item', 'work_item_changed', 'entity_changed', 'calendar_changed', 'user_feedback', 'model_or_prompt_upgrade', 'manual_refresh', 'expired');--> statement-breakpoint
CREATE TYPE "public"."task_type_bucket" AS ENUM('pre_sale', 'post_sale', 'enablement', 'neither', 'pto');--> statement-breakpoint
CREATE TYPE "public"."team_rule_kind" AS ENUM('recurring_task', 'deadline_task', 'coverage_check', 'logging_rule', 'classification_rule');--> statement-breakpoint
CREATE TYPE "public"."time_block_source" AS ENUM('calendar', 'claude_hands_on', 'claude_background', 'doc_edit', 'slack_burst', 'git', 'manual', 'estimate', 'travel');--> statement-breakpoint
CREATE TYPE "public"."title_source" AS ENUM('custom', 'ai', 'first_prompt', 'app');--> statement-breakpoint
CREATE TYPE "public"."tool_adapter_kind" AS ENUM('http_local', 'cli', 'skill', 'claude_session', 'mcp');--> statement-breakpoint
CREATE TYPE "public"."tool_call_status" AS ENUM('proposed', 'awaiting_confirmation', 'running', 'succeeded', 'failed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."tool_output_kind" AS ENUM('url', 'asset', 'file', 'text');--> statement-breakpoint
CREATE TYPE "public"."tool_run_status" AS ENUM('queued', 'running', 'waiting_on_me', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."training_provider" AS ENUM('trailhead', 'workday_learning', 'internal_lms', 'slack', 'email', 'other');--> statement-breakpoint
CREATE TYPE "public"."travel_step_status" AS ENUM('not_started', 'submitted', 'approved', 'rejected', 'done', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."user_verdict" AS ENUM('confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."verification_method" AS ENUM('slack_read', 'gmail_read', 'org62_soql', 'vdp_read', 'canvas_read', 'calendar_read', 'user_confirmed');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'matched', 'mismatch', 'not_found', 'error');--> statement-breakpoint
CREATE TYPE "public"."waiting_on_me_reason" AS ENUM('permission_prompt', 'question', 'plan_approval', 'error', 'review_output', 'input_needed');--> statement-breakpoint
CREATE TYPE "public"."watch_mode" AS ENUM('items', 'digest', 'ignore');--> statement-breakpoint
CREATE TYPE "public"."watch_scope_kind" AS ENUM('channel', 'opportunity', 'account', 'person', 'initiative', 'search_query');--> statement-breakpoint
CREATE TYPE "public"."what_kind" AS ENUM('opportunity', 'account', 'dsr', 'strategic_initiative', 'none');--> statement-breakpoint
CREATE TYPE "public"."work_item_kind" AS ENUM('task', 'commitment', 'ask', 'training', 'background_promise', 'travel', 'missed_meeting_followup');--> statement-breakpoint
CREATE TYPE "public"."work_item_link_role" AS ENUM('stakeholder', 'deliverable', 'working_session', 'missed_meeting', 'prep_for', 'related');--> statement-breakpoint
CREATE TYPE "public"."work_item_origin" AS ENUM('manual', 'said_by_me', 'asked_of_me', 'meeting_next_step', 'system_rule', 'chat', 'missed_opp_scan', 'reconcile', 'tool');--> statement-breakpoint
CREATE TYPE "public"."work_item_relation_kind" AS ENUM('blocks', 'related', 'duplicate_of', 'follow_up_of');--> statement-breakpoint
CREATE TYPE "public"."work_item_status" AS ENUM('suggested', 'open', 'in_progress', 'waiting_on_others', 'waiting_on_me', 'likely_done', 'done', 'snoozed', 'dismissed', 'merged');--> statement-breakpoint
CREATE TABLE "account_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "alias_kind" NOT NULL,
	"value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"source" "rule_source" NOT NULL,
	"confidence" numeric(4, 3) DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"org62_account_id" text,
	"name" text NOT NULL,
	"parent_account_id" uuid,
	"family" text,
	"industry" text,
	"is_my_book" boolean DEFAULT false NOT NULL,
	"is_watched" boolean DEFAULT false NOT NULL,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"dedupe_key" text NOT NULL,
	"origin" "activity_origin" NOT NULL,
	"operation" "org62_operation" DEFAULT 'create' NOT NULL,
	"target_org62_event_id" text,
	"subject" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"duration_hours" numeric(4, 2) NOT NULL,
	"se_task_type_id" uuid,
	"meeting_type_id" uuid,
	"what_kind" "what_kind" DEFAULT 'none' NOT NULL,
	"opportunity_id" uuid,
	"account_id" uuid,
	"what_org62_id" text,
	"what_name" text,
	"customer_facing" boolean DEFAULT false NOT NULL,
	"customer_related" boolean DEFAULT false NOT NULL,
	"remote" boolean DEFAULT true NOT NULL,
	"description" text,
	"confidence" numeric(4, 3),
	"reason" text,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "activity_status" DEFAULT 'proposed' NOT NULL,
	"excluded_reason" "excluded_reason",
	"approved_at" timestamp with time zone,
	"approval_method" "approval_method",
	"synced_to_canvas_at" timestamp with time zone,
	"org62_event_row_id" uuid,
	"logged_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"verify_issue" text,
	"fiscal_period_id" uuid,
	"user_locked_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_entries_range_chk" CHECK ("activity_entries"."ends_at" > "activity_entries"."starts_at"),
	CONSTRAINT "activity_entries_duration_chk" CHECK ("activity_entries"."duration_hours" > 0 AND "activity_entries"."duration_hours" <= 99.99 AND "activity_entries"."duration_hours" * 4 = trunc("activity_entries"."duration_hours" * 4)),
	CONSTRAINT "activity_entries_operation_chk" CHECK ("activity_entries"."operation" = 'create' OR "activity_entries"."target_org62_event_id" IS NOT NULL),
	CONSTRAINT "activity_entries_approval_chk" CHECK ("activity_entries"."status" NOT IN ('approved', 'synced_to_canvas') OR "activity_entries"."approved_at" IS NOT NULL),
	CONSTRAINT "activity_entries_excluded_chk" CHECK (("activity_entries"."status" = 'excluded') = ("activity_entries"."excluded_reason" IS NOT NULL)),
	CONSTRAINT "activity_entries_ready_chk" CHECK ("activity_entries"."status" NOT IN ('approved', 'synced_to_canvas') OR "activity_entries"."operation" <> 'create' OR "activity_entries"."se_task_type_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "activity_entry_time_blocks" (
	"activity_entry_id" uuid NOT NULL,
	"time_block_id" uuid NOT NULL,
	"allocated_minutes" integer NOT NULL,
	CONSTRAINT "activity_entry_time_blocks_activity_entry_id_time_block_id_pk" PRIMARY KEY("activity_entry_id","time_block_id"),
	CONSTRAINT "activity_entry_time_blocks_minutes_chk" CHECK ("activity_entry_time_blocks"."allocated_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "app_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_user_id" uuid,
	"severity" "severity" NOT NULL,
	"component" text NOT NULL,
	"code" text NOT NULL,
	"error_class" "error_class",
	"message" text NOT NULL,
	"connector_id" uuid,
	"job_id" bigint,
	"scan_run_id" uuid,
	"entity_type" text,
	"entity_id" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"first_occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "asset_snapshot_diffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"from_snapshot_id" uuid NOT NULL,
	"to_snapshot_id" uuid NOT NULL,
	"kind" "diff_kind" NOT NULL,
	"sections_added" smallint DEFAULT 0 NOT NULL,
	"sections_removed" smallint DEFAULT 0 NOT NULL,
	"sections_modified" smallint DEFAULT 0 NOT NULL,
	"sections_moved" smallint DEFAULT 0 NOT NULL,
	"words_added" integer DEFAULT 0 NOT NULL,
	"words_removed" integer DEFAULT 0 NOT NULL,
	"changed_section_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"modified_by_me_only" boolean DEFAULT false NOT NULL,
	"modifier_person_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"summary" text,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary_llm_call_id" bigint,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_snapshot_diffs_distinct_chk" CHECK ("asset_snapshot_diffs"."from_snapshot_id" <> "asset_snapshot_diffs"."to_snapshot_id")
);
--> statement-breakpoint
CREATE TABLE "asset_snapshot_sections" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"ordinal" smallint NOT NULL,
	"section_key" text NOT NULL,
	"kind" "section_kind" NOT NULL,
	"title" text,
	"content_hash" text NOT NULL,
	"speaker_notes_hash" text,
	"word_count" integer DEFAULT 0 NOT NULL,
	"text" text,
	"text_expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "asset_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"source_item_id" uuid NOT NULL,
	"scan_run_id" uuid,
	"sampled_at" timestamp with time zone NOT NULL,
	"modified_time" timestamp with time zone NOT NULL,
	"last_modifying_person_id" uuid,
	"last_modifying_identity" text,
	"modified_by_me" boolean DEFAULT false NOT NULL,
	"head_revision_id" text,
	"drive_version" bigint,
	"title" text,
	"content_hash" text NOT NULL,
	"section_count" smallint DEFAULT 0 NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"extractor" text NOT NULL,
	"status" "snapshot_status" DEFAULT 'ok' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"system" "asset_system" NOT NULL,
	"external_id" text NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"title" text,
	"url" text,
	"mime_type" text,
	"owner_person_id" uuid,
	"i_own" boolean DEFAULT false NOT NULL,
	"last_modified_at" timestamp with time zone,
	"last_modifying_person_id" uuid,
	"last_modified_by_me_at" timestamp with time zone,
	"head_revision_id" text,
	"drive_version" bigint,
	"tracking_tier" "asset_tracking_tier" DEFAULT 'inventory' NOT NULL,
	"watched_until" timestamp with time zone,
	"latest_snapshot_id" uuid,
	"account_id" uuid,
	"opportunity_id" uuid,
	"mapping_method" "link_method",
	"mapping_confidence" numeric(4, 3),
	"mapping_locked" boolean DEFAULT false NOT NULL,
	"repo_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_user_id" uuid,
	"change_set_id" uuid NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_ref" text,
	"table_name" text NOT NULL,
	"row_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"op" "audit_op" NOT NULL,
	"changed_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"coalesced_count" integer DEFAULT 1 NOT NULL,
	"destination" text,
	"payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autonomy_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"action_type" "draft_action_type" NOT NULL,
	"level" "autonomy_level" DEFAULT 'L1_draft' NOT NULL,
	"target_external_id" text,
	"note" text,
	"set_by_user_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autonomy_policies_owner_action_target_uq" UNIQUE NULLS NOT DISTINCT("owner_user_id","action_type","target_external_id")
);
--> statement-breakpoint
CREATE TABLE "brief_highlight_reasons" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"highlight_id" uuid NOT NULL,
	"kind" "highlight_reason_kind" NOT NULL,
	"feature_key" text NOT NULL,
	"policy_rule_id" uuid,
	"weight" numeric(6, 3) NOT NULL,
	"explanation" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brief_highlights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"brief_id" uuid NOT NULL,
	"ordinal" smallint NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"relevance_score" numeric(4, 3) NOT NULL,
	"level" "highlight_level" NOT NULL,
	"account_id" uuid,
	"opportunity_id" uuid,
	"initiative_id" uuid,
	"topic_key" text NOT NULL,
	"status" "highlight_status" DEFAULT 'new' NOT NULL,
	"seen_at" timestamp with time zone,
	"promoted_at" timestamp with time zone,
	"promoted_work_item_id" uuid,
	"dismissed_at" timestamp with time zone,
	"dismiss_reason" text,
	"extractor_id" uuid,
	"llm_call_id" bigint,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brief_highlights_promoted_chk" CHECK (("brief_highlights"."status" = 'promoted') = ("brief_highlights"."promoted_work_item_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "brief_scan_runs" (
	"brief_id" uuid NOT NULL,
	"scan_run_id" uuid NOT NULL,
	CONSTRAINT "brief_scan_runs_brief_id_scan_run_id_pk" PRIMARY KEY("brief_id","scan_run_id")
);
--> statement-breakpoint
CREATE TABLE "briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" "brief_status" DEFAULT 'generating' NOT NULL,
	"summary" text,
	"from_opportunity_snapshot_id" uuid,
	"to_opportunity_snapshot_id" uuid,
	"source_item_count" integer DEFAULT 0 NOT NULL,
	"highlight_count" smallint DEFAULT 0 NOT NULL,
	"nothing_new" boolean DEFAULT false NOT NULL,
	"coverage_complete" boolean DEFAULT true NOT NULL,
	"coverage_note" text,
	"model" text,
	"model_tier" "model_tier" DEFAULT 'haiku' NOT NULL,
	"llm_call_id" bigint,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"inputs_hash" text,
	"job_id" bigint,
	"generated_at" timestamp with time zone,
	"seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "briefs_period_chk" CHECK ("briefs"."period_end" > "briefs"."period_start")
);
--> statement-breakpoint
CREATE TABLE "calendar_event_attendees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"calendar_event_id" uuid NOT NULL,
	"person_id" uuid,
	"email" text NOT NULL,
	"display_name" text,
	"response_status" "response_status" DEFAULT 'none' NOT NULL,
	"is_organizer" boolean DEFAULT false NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"is_self" boolean DEFAULT false NOT NULL,
	"is_external" boolean DEFAULT false NOT NULL,
	"domain" text
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"connector_id" uuid,
	"calendar_id" text NOT NULL,
	"external_event_id" text NOT NULL,
	"recurring_event_id" text,
	"ical_uid" text,
	"source_item_id" uuid,
	"title" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"local_day" date NOT NULL,
	"is_all_day" boolean DEFAULT false NOT NULL,
	"timezone" text,
	"event_type" "calendar_event_type" DEFAULT 'default' NOT NULL,
	"status" "calendar_event_status" DEFAULT 'confirmed' NOT NULL,
	"organizer_person_id" uuid,
	"i_am_organizer" boolean DEFAULT false NOT NULL,
	"my_response" "response_status" DEFAULT 'none' NOT NULL,
	"attendance" "attendance" DEFAULT 'unknown' NOT NULL,
	"attendance_source" "attendance_source",
	"attendance_confidence" numeric(4, 3),
	"actual_started_at" timestamp with time zone,
	"actual_ended_at" timestamp with time zone,
	"has_external_attendees" boolean DEFAULT false NOT NULL,
	"external_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"conference_url" text,
	"html_link" text,
	"account_id" uuid,
	"opportunity_id" uuid,
	"mapping_method" "link_method",
	"mapping_confidence" numeric(4, 3),
	"mapping_locked" boolean DEFAULT false NOT NULL,
	"deleted_upstream_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_events_range_chk" CHECK ("calendar_events"."ends_at" >= "calendar_events"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "canvas_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"line_key" text NOT NULL,
	"section" "canvas_section" NOT NULL,
	"activity_entry_id" uuid,
	"dc_request_id" uuid,
	"rendered" text NOT NULL,
	"checked_on_read" boolean,
	"mark_text" text,
	"mark_applied_at" timestamp with time zone,
	"change_set_id" uuid
);
--> statement-breakpoint
CREATE TABLE "canvas_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canvas_id" uuid NOT NULL,
	"draft_id" uuid,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"marks_source_item_id" uuid,
	"marks_applied" integer DEFAULT 0 NOT NULL,
	"rendered_hash" text,
	"skipped_unchanged" boolean DEFAULT false NOT NULL,
	"line_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error_code" text
);
--> statement-breakpoint
CREATE TABLE "canvases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"purpose" "canvas_purpose" NOT NULL,
	"title" text,
	"url" text,
	"write_approved_at" timestamp with time zone,
	"write_approval_note" text,
	"sync_status" "canvas_sync_status" DEFAULT 'dirty' NOT NULL,
	"last_rendered_hash" text,
	"last_written_at" timestamp with time zone,
	"last_read_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"field" text NOT NULL,
	"group_id" uuid NOT NULL,
	"current_value" jsonb,
	"proposed_value" jsonb NOT NULL,
	"reason" text NOT NULL,
	"source_item_id" uuid,
	"evidence_id" uuid,
	"extractor_id" uuid,
	"llm_call_id" bigint,
	"confidence" numeric(4, 3),
	"base_version" integer NOT NULL,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" "actor_kind",
	"applied_change_set_id" uuid,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" "change_set_kind" NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_ref" text,
	"editor_session_id" text,
	"entity_type" text,
	"entity_id" text,
	"summary" text NOT NULL,
	"undoable" boolean DEFAULT true NOT NULL,
	"coalesce_until" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"undo_of_change_set_id" uuid,
	"rollback_to_at" timestamp with time zone,
	"undone_at" timestamp with time zone,
	"undone_by_change_set_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_sets_undo_chk" CHECK ("change_sets"."kind" NOT IN ('undo', 'redo') OR "change_sets"."undo_of_change_set_id" IS NOT NULL),
	CONSTRAINT "change_sets_rollback_chk" CHECK ("change_sets"."kind" <> 'rollback' OR "change_sets"."rollback_to_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "channel_account_maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"method" "link_method" NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"mapping_rule_id" uuid,
	"user_verdict" "user_verdict",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"system" "source_system" DEFAULT 'slack' NOT NULL,
	"external_id" text NOT NULL,
	"name" text,
	"kind" "channel_kind" NOT NULL,
	"watch_mode" "watch_mode" DEFAULT 'items' NOT NULL,
	"is_customer_channel" boolean DEFAULT false NOT NULL,
	"is_member" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" "chat_role" NOT NULL,
	"content" text,
	"content_blocks" jsonb,
	"model" text,
	"llm_call_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"title" text,
	"scope" "chat_scope" DEFAULT 'global' NOT NULL,
	"work_item_id" uuid,
	"account_id" uuid,
	"opportunity_id" uuid,
	"sdk_session_id" text,
	"model" text,
	"last_message_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"tool_use_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"is_mutation" boolean DEFAULT false NOT NULL,
	"requires_confirmation" boolean DEFAULT false NOT NULL,
	"status" "tool_call_status" DEFAULT 'proposed' NOT NULL,
	"change_set_id" uuid,
	"job_id" bigint,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_code" text
);
--> statement-breakpoint
CREATE TABLE "claude_session_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claude_session_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"active_ms" bigint DEFAULT 0 NOT NULL,
	"human_ms" bigint DEFAULT 0 NOT NULL,
	"background_ms" bigint DEFAULT 0 NOT NULL,
	"prompt_count" integer DEFAULT 0 NOT NULL,
	"account_id" uuid,
	"opportunity_id" uuid,
	"mapping_method" "link_method",
	"mapping_confidence" numeric(4, 3),
	CONSTRAINT "claude_session_segments_range_chk" CHECK ("claude_session_segments"."ended_at" >= "claude_session_segments"."started_at")
);
--> statement-breakpoint
CREATE TABLE "claude_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"connector_id" uuid,
	"session_external_id" text,
	"desktop_session_id" text,
	"entrypoint" "claude_entrypoint" DEFAULT 'unknown' NOT NULL,
	"status" "claude_session_status" DEFAULT 'running' NOT NULL,
	"waiting_reason" "waiting_on_me_reason",
	"waiting_detail" text,
	"waiting_since" timestamp with time zone,
	"transcript_path" text,
	"cwd" text,
	"repo_id" uuid,
	"git_branch" text,
	"plan_slug" text,
	"title" text,
	"title_source" "title_source",
	"summary" text,
	"summary_updated_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"active_ms" bigint DEFAULT 0 NOT NULL,
	"human_ms" bigint DEFAULT 0 NOT NULL,
	"background_ms" bigint DEFAULT 0 NOT NULL,
	"prompt_count" integer DEFAULT 0 NOT NULL,
	"files_changed_count" integer DEFAULT 0 NOT NULL,
	"lines_added" integer DEFAULT 0 NOT NULL,
	"lines_removed" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6),
	"primary_model" text,
	"account_id" uuid,
	"opportunity_id" uuid,
	"mapping_method" "link_method",
	"mapping_confidence" numeric(4, 3),
	"mapping_locked" boolean DEFAULT false NOT NULL,
	"source_item_id" uuid,
	"launched_by_app" boolean DEFAULT false NOT NULL,
	"launch_mode" "launch_mode",
	"launch_work_item_id" uuid,
	"launch_nba_id" uuid,
	"launch_prompt" text,
	"launch_job_id" bigint,
	"launch_requested_at" timestamp with time zone,
	"live_pid" integer,
	"live_status_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claude_sessions_waiting_chk" CHECK ("claude_sessions"."status" <> 'waiting_on_me' OR "claude_sessions"."waiting_reason" IS NOT NULL),
	CONSTRAINT "claude_sessions_launch_chk" CHECK (NOT "claude_sessions"."launched_by_app" OR "claude_sessions"."launch_mode" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "connector_auth_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"connector_id" uuid NOT NULL,
	"kind" "auth_event_kind" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" "actor_kind" DEFAULT 'system' NOT NULL,
	"reauth_attempt_id" uuid,
	"expires_at" timestamp with time zone,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "connector_health_checks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"connector_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ok" boolean NOT NULL,
	"status" "connector_status" NOT NULL,
	"probe" text NOT NULL,
	"latency_ms" integer,
	"error_code" text,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" "source_system" NOT NULL,
	"name" text NOT NULL,
	"transport" "connector_transport" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_tool_allowlist" text[] DEFAULT '{}'::text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" "connector_status" DEFAULT 'healthy' NOT NULL,
	"status_reason" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_code" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"stale_after_seconds" integer DEFAULT 3600 NOT NULL,
	"auth_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_revisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"field" text NOT NULL,
	"revision" integer NOT NULL,
	"doc_json" jsonb,
	"text" text,
	"content_hash" text NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"editor_session_id" text,
	"change_set_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"save_count" integer DEFAULT 1 NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "content_revisions_payload_chk" CHECK (num_nonnulls("content_revisions"."doc_json", "content_revisions"."text") = 1)
);
--> statement-breakpoint
CREATE TABLE "deal_contribution_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"role" text NOT NULL,
	"split_percent" numeric(5, 2) NOT NULL,
	"comment" text,
	"vdp_url" text,
	"status" "dc_request_status" DEFAULT 'proposed' NOT NULL,
	"approved_at" timestamp with time zone,
	"approval_method" "approval_method",
	"deal_contribution_id" uuid,
	"missed_opp_finding_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_contribution_requests_split_chk" CHECK ("deal_contribution_requests"."split_percent" > 0 AND "deal_contribution_requests"."split_percent" <= 100)
);
--> statement-breakpoint
CREATE TABLE "deal_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"org62_dc_id" text NOT NULL,
	"opportunity_id" uuid,
	"contributor_person_id" uuid,
	"contributor_org62_user_id" text,
	"is_mine" boolean DEFAULT false NOT NULL,
	"role" text,
	"split_percent" numeric(5, 2),
	"has_comments" boolean DEFAULT false NOT NULL,
	"vdp_link" text,
	"source_item_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_upstream_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deliverable_judgments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"diff_id" uuid,
	"snapshot_id" uuid,
	"verdict" "judgment_verdict" NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"rationale" text,
	"requirement_verdicts" jsonb NOT NULL,
	"model" text,
	"llm_call_id" bigint,
	"judged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliverable_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"ordinal" smallint NOT NULL,
	"description" text NOT NULL,
	"section_hint" text,
	"requested_by_source_item_id" uuid,
	"extractor_id" uuid NOT NULL,
	"status" "requirement_status" DEFAULT 'pending' NOT NULL,
	"confidence" numeric(4, 3),
	"matched_section_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_judged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"role" "recipient_role" NOT NULL,
	"person_id" uuid,
	"address" text NOT NULL,
	"display_name" text
);
--> statement-breakpoint
CREATE TABLE "draft_renditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"doc_version" integer NOT NULL,
	"format" "rendition_format" NOT NULL,
	"body" text NOT NULL,
	"renderer_version" text NOT NULL,
	"content_hash" text NOT NULL,
	"lossy" boolean DEFAULT false NOT NULL,
	"warnings" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_send_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"draft_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"dry_run" boolean NOT NULL,
	"rendition_id" uuid,
	"adapter" text NOT NULL,
	"job_id" bigint,
	"request_hash" text NOT NULL,
	"status" "send_attempt_status" DEFAULT 'started' NOT NULL,
	"external_id" text,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "draft_verifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"draft_id" uuid NOT NULL,
	"send_attempt_id" bigint,
	"method" "verification_method" NOT NULL,
	"status" "verification_status" DEFAULT 'pending' NOT NULL,
	"matched_external_id" text,
	"matched_source_item_id" uuid,
	"diff_summary" text,
	"checked_at" timestamp with time zone,
	"next_check_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"work_item_id" uuid,
	"nba_id" uuid,
	"action_type" "draft_action_type" NOT NULL,
	"channel" "outbound_channel" NOT NULL,
	"delivery_mode" "delivery_mode" DEFAULT 'stage' NOT NULL,
	"autonomy_level" "autonomy_level" DEFAULT 'L1_draft' NOT NULL,
	"status" "draft_status" DEFAULT 'drafting' NOT NULL,
	"title" text,
	"doc_json" jsonb,
	"doc_version" integer DEFAULT 1 NOT NULL,
	"plain_text" text,
	"payload" jsonb,
	"content_hash" text NOT NULL,
	"target_external_id" text,
	"target_thread_external_id" text,
	"in_reply_to_source_item_id" uuid,
	"subject" text,
	"scheduled_for" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"approval_method" "approval_method",
	"approved_content_hash" text,
	"autonomy_policy_id" uuid,
	"rejected_at" timestamp with time zone,
	"reject_reason" text,
	"sent_external_id" text,
	"sent_at" timestamp with time zone,
	"staged_at" timestamp with time zone,
	"handed_off_at" timestamp with time zone,
	"handoff_url" text,
	"verified_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"created_by" "actor_kind" NOT NULL,
	"model" text,
	"llm_call_id" bigint,
	"voice_profile_id" uuid,
	"edited_by_user" boolean DEFAULT false NOT NULL,
	"user_locked_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drafts_content_chk" CHECK (num_nonnulls("drafts"."doc_json", "drafts"."payload") >= 1),
	CONSTRAINT "drafts_approval_chk" CHECK ("drafts"."status" NOT IN ('approved', 'scheduled', 'sending', 'unconfirmed', 'sent', 'staged', 'handed_off', 'verified', 'verify_failed') OR ("drafts"."approved_at" IS NOT NULL AND "drafts"."approval_method" IS NOT NULL AND "drafts"."approved_content_hash" = "drafts"."content_hash")),
	CONSTRAINT "drafts_scheduled_chk" CHECK ("drafts"."status" <> 'scheduled' OR "drafts"."scheduled_for" IS NOT NULL),
	CONSTRAINT "drafts_autonomy_chk" CHECK ("drafts"."approval_method" IS DISTINCT FROM 'autonomy_policy' OR "drafts"."autonomy_policy_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "extraction_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"source_item_id" uuid NOT NULL,
	"extractor_id" uuid NOT NULL,
	"ordinal" smallint DEFAULT 0 NOT NULL,
	"proposed_kind" "work_item_kind" NOT NULL,
	"proposed_title" text NOT NULL,
	"proposed_due_at" timestamp with time zone,
	"due_text" text,
	"assignee_text" text,
	"assigned_to_me" boolean DEFAULT false NOT NULL,
	"shared_assignment" boolean DEFAULT false NOT NULL,
	"counterparty_person_id" uuid,
	"confidence" numeric(4, 3) NOT NULL,
	"decision" "candidate_decision" DEFAULT 'pending' NOT NULL,
	"work_item_id" uuid,
	"merge_score" numeric(4, 3),
	"merge_rationale" text,
	"llm_call_id" bigint,
	"decided_at" timestamp with time zone,
	"decided_by" "actor_kind",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extractors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"version" text NOT NULL,
	"kind" "extractor_kind" NOT NULL,
	"model_tier" "model_tier" DEFAULT 'none' NOT NULL,
	"model" text,
	"skill_key" text,
	"prompt_hash" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_pack_id" uuid NOT NULL,
	"name" text NOT NULL,
	"fiscal_year" smallint NOT NULL,
	"fiscal_quarter" smallint NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"logging_deadline_at" timestamp with time zone,
	"deadline_assumed" boolean DEFAULT false NOT NULL,
	"deadline_note" text,
	"hours_target" numeric(6, 2),
	CONSTRAINT "fiscal_periods_quarter_chk" CHECK ("fiscal_periods"."fiscal_quarter" BETWEEN 1 AND 4),
	CONSTRAINT "fiscal_periods_range_chk" CHECK ("fiscal_periods"."ends_on" >= "fiscal_periods"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "initiative_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"initiative_id" uuid NOT NULL,
	"person_id" uuid,
	"asset_id" uuid,
	"claude_session_id" uuid,
	"calendar_event_id" uuid,
	"channel_id" uuid,
	"opportunity_id" uuid,
	"repo_id" uuid,
	"role" "initiative_link_role" NOT NULL,
	"method" "link_method" NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"user_verdict" "user_verdict",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "initiative_links_target_uq" UNIQUE NULLS NOT DISTINCT("initiative_id","role","person_id","asset_id","claude_session_id","calendar_event_id","channel_id","opportunity_id","repo_id"),
	CONSTRAINT "initiative_links_one_target_chk" CHECK (num_nonnulls("initiative_links"."person_id", "initiative_links"."asset_id", "initiative_links"."claude_session_id", "initiative_links"."calendar_event_id", "initiative_links"."channel_id", "initiative_links"."opportunity_id", "initiative_links"."repo_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "initiatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"purpose" text NOT NULL,
	"background_summary" text,
	"summary_generated_at" timestamp with time zone,
	"summary_inputs_hash" text,
	"summary_llm_call_id" bigint,
	"status" "initiative_status" DEFAULT 'active' NOT NULL,
	"account_id" uuid,
	"opportunity_id" uuid,
	"target_event_id" uuid,
	"target_at" timestamp with time zone,
	"created_by" "actor_kind" NOT NULL,
	"confidence" numeric(4, 3),
	"user_locked_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"queue" text DEFAULT 'default' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"interval_seconds" integer,
	"cron_expr" text,
	"timezone" text DEFAULT 'America/Denver' NOT NULL,
	"jitter_seconds" integer DEFAULT 0 NOT NULL,
	"catch_up" "catch_up_policy" DEFAULT 'backfill_window' NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"connector_id" uuid,
	"paused_reason" text,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_enqueued_at" timestamp with time zone,
	"last_job_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_schedules_cadence_chk" CHECK (num_nonnulls("job_schedules"."interval_seconds", "job_schedules"."cron_expr") = 1)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"queue" text DEFAULT 'default' NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"backoff_base_seconds" integer DEFAULT 30 NOT NULL,
	"backoff_max_seconds" integer DEFAULT 3600 NOT NULL,
	"timeout_seconds" integer DEFAULT 600 NOT NULL,
	"last_error_class" "error_class",
	"last_failed_at" timestamp with time zone,
	"dead_at" timestamp with time zone,
	"dead_reason" text,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"dedupe_key" text,
	"generation" bigint,
	"supersedes_running" boolean DEFAULT false NOT NULL,
	"cancel_requested_at" timestamp with time zone,
	"cancel_reason" text,
	"superseded_by_id" bigint,
	"idempotency_key" text,
	"schedule_id" uuid,
	"parent_job_id" bigint,
	"correlation_id" uuid,
	"last_error_code" text,
	"last_error" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_attempts_chk" CHECK ("jobs"."attempts" >= 0 AND "jobs"."attempts" <= "jobs"."max_attempts"),
	CONSTRAINT "jobs_running_lease_chk" CHECK ("jobs"."status" <> 'running' OR ("jobs"."locked_by" IS NOT NULL AND "jobs"."lease_expires_at" IS NOT NULL)),
	CONSTRAINT "jobs_dead_chk" CHECK (("jobs"."status" = 'dead') = ("jobs"."dead_at" IS NOT NULL)),
	CONSTRAINT "jobs_backoff_chk" CHECK ("jobs"."backoff_base_seconds" > 0 AND "jobs"."backoff_max_seconds" >= "jobs"."backoff_base_seconds")
);
--> statement-breakpoint
CREATE TABLE "llm_budget_days" (
	"budget_id" uuid NOT NULL,
	"day" date NOT NULL,
	"reserved_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"spent_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"call_count" integer DEFAULT 0 NOT NULL,
	"alerted_at" timestamp with time zone,
	"blocked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_budget_days_budget_id_day_pk" PRIMARY KEY("budget_id","day")
);
--> statement-breakpoint
CREATE TABLE "llm_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"scope" "budget_scope" NOT NULL,
	"scope_value" text,
	"daily_limit_usd" numeric(10, 2) NOT NULL,
	"alert_at_pct" smallint DEFAULT 80 NOT NULL,
	"hard_stop" boolean DEFAULT false NOT NULL,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_budgets_owner_scope_uq" UNIQUE NULLS NOT DISTINCT("owner_user_id","scope","scope_value"),
	CONSTRAINT "llm_budgets_scope_value_chk" CHECK (("llm_budgets"."scope" = 'total') = ("llm_budgets"."scope_value" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"purpose" "llm_purpose" NOT NULL,
	"model" text NOT NULL,
	"model_tier" "model_tier" NOT NULL,
	"skill_key" text,
	"prompt_version" text,
	"request_hash" text NOT NULL,
	"job_id" bigint,
	"scan_run_id" uuid,
	"chat_message_id" uuid,
	"status" "llm_call_status" NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"cost_estimated" boolean DEFAULT false NOT NULL,
	"latency_ms" integer,
	"error_code" text,
	"budget_day" date NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mapping_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" "mapping_rule_kind" NOT NULL,
	"pattern" text NOT NULL,
	"is_regex" boolean DEFAULT false NOT NULL,
	"account_id" uuid,
	"opportunity_id" uuid,
	"person_id" uuid,
	"se_task_type_id" uuid,
	"target_value" text,
	"priority" integer DEFAULT 100 NOT NULL,
	"source" "rule_source" NOT NULL,
	"created_from_change_set_id" uuid,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mapping_rules_target_chk" CHECK ("mapping_rules"."kind" IN ('ignore_sender', 'ignore_channel') OR num_nonnulls("mapping_rules"."account_id", "mapping_rules"."opportunity_id", "mapping_rules"."person_id", "mapping_rules"."se_task_type_id", "mapping_rules"."target_value") >= 1)
);
--> statement-breakpoint
CREATE TABLE "meeting_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"calendar_event_id" uuid,
	"source_item_id" uuid NOT NULL,
	"kind" "meeting_note_kind" NOT NULL,
	"doc_external_id" text,
	"url" text,
	"arrived_at" timestamp with time zone NOT NULL,
	"match_method" "note_match_method",
	"match_confidence" numeric(4, 3),
	"actual_duration_seconds" integer,
	"next_steps_parsed_at" timestamp with time zone,
	"next_step_count" smallint DEFAULT 0 NOT NULL,
	"my_next_step_count" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "missed_opp_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"first_sweep_id" uuid NOT NULL,
	"last_sweep_id" uuid NOT NULL,
	"tier" "missed_opp_tier" NOT NULL,
	"verdict" "missed_opp_verdict" NOT NULL,
	"evidence_strength" "evidence_strength" DEFAULT 'none' NOT NULL,
	"has_d360_line" boolean DEFAULT false NOT NULL,
	"d360_line_amount" numeric(14, 2),
	"flex_line_amount" numeric(14, 2),
	"my_org62_hours" numeric(6, 2) DEFAULT 0 NOT NULL,
	"my_dc_exists" boolean DEFAULT false NOT NULL,
	"other_architect_dc_count" smallint DEFAULT 0 NOT NULL,
	"stranded_dc_id" uuid,
	"evidence_summary" text,
	"status" "opp_finding_status" DEFAULT 'new' NOT NULL,
	"user_locked" boolean DEFAULT false NOT NULL,
	"work_item_id" uuid,
	"dismissed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "missed_opp_sweeps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"scan_run_id" uuid,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"criteria" jsonb NOT NULL,
	"accounts_considered" integer DEFAULT 0 NOT NULL,
	"opps_considered" integer DEFAULT 0 NOT NULL,
	"findings_new" integer DEFAULT 0 NOT NULL,
	"findings_changed" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "next_best_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"nba_version" integer NOT NULL,
	"work_item_generation" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "nba_status" DEFAULT 'generating' NOT NULL,
	"type" "nba_type" NOT NULL,
	"title" text NOT NULL,
	"rationale" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completeness" smallint DEFAULT 0 NOT NULL,
	"confidence" numeric(4, 3),
	"model" text,
	"model_tier" "model_tier" DEFAULT 'none' NOT NULL,
	"llm_call_id" bigint,
	"prompt_version" text,
	"inputs_hash" text NOT NULL,
	"supersedes_id" uuid,
	"supersede_reason" "supersede_reason",
	"trigger_source_item_id" uuid,
	"diff_summary" text,
	"diff" jsonb,
	"draft_id" uuid,
	"tool_run_id" uuid,
	"claude_session_id" uuid,
	"activity_entry_id" uuid,
	"ready_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"dismiss_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "next_best_actions_completeness_chk" CHECK ("next_best_actions"."completeness" BETWEEN 0 AND 100),
	CONSTRAINT "next_best_actions_version_chain_chk" CHECK (("next_best_actions"."nba_version" = 1) = ("next_best_actions"."supersedes_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"severity" "severity" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"entity_type" text,
	"entity_id" text,
	"connector_id" uuid,
	"app_event_id" bigint,
	"job_id" bigint,
	"change_set_id" uuid,
	"action_route" text,
	"action_kind" text,
	"dedupe_key" text NOT NULL,
	"status" "notification_status" DEFAULT 'open' NOT NULL,
	"seen_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolved_by" "actor_kind",
	"expires_at" timestamp with time zone,
	"os_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_snooze_chk" CHECK ("notifications"."status" <> 'snoozed' OR "notifications"."snoozed_until" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"account_id" uuid,
	"org62_opportunity_id" text NOT NULL,
	"name" text NOT NULL,
	"stage" text,
	"amount" numeric(14, 2),
	"currency_code" text DEFAULT 'USD' NOT NULL,
	"close_date" date,
	"forecast_category" text,
	"type" text,
	"is_closed" boolean DEFAULT false NOT NULL,
	"is_won" boolean DEFAULT false NOT NULL,
	"last_activity_date" date,
	"on_my_team" boolean DEFAULT false NOT NULL,
	"my_team_role" text,
	"is_watched" boolean DEFAULT false NOT NULL,
	"latest_snapshot_id" uuid,
	"org62_modified_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"source_item_id" uuid,
	"captured_at" timestamp with time zone NOT NULL,
	"fields_hash" text NOT NULL,
	"stage" text,
	"amount" numeric(14, 2),
	"close_date" date,
	"forecast_category" text,
	"is_closed" boolean,
	"is_won" boolean,
	"next_step" text,
	"product_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"d360_line_amount" numeric(14, 2),
	"flex_line_amount" numeric(14, 2),
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"person_id" uuid,
	"org62_user_id" text NOT NULL,
	"team_role" text NOT NULL,
	"is_me" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "org62_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"org62_event_id" text NOT NULL,
	"record_type_name" text NOT NULL,
	"subject" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"duration_field" numeric(4, 2),
	"se_task_type_name" text,
	"meeting_type_name" text,
	"what_org62_id" text,
	"opportunity_id" uuid,
	"account_id" uuid,
	"org62_created_at" timestamp with time zone,
	"org62_modified_at" timestamp with time zone,
	"source_item_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_upstream_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "org62_picklist_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_pack_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"primary_email" text,
	"title" text,
	"affiliation" "person_affiliation" DEFAULT 'unknown' NOT NULL,
	"account_id" uuid,
	"tier" "stakeholder_tier" DEFAULT 'normal' NOT NULL,
	"is_me" boolean DEFAULT false NOT NULL,
	"merged_into_person_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"system" "identity_system" NOT NULL,
	"external_id" text NOT NULL,
	"handle" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"method" "link_method" NOT NULL,
	"confidence" numeric(4, 3) DEFAULT 1 NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "priority_plan_steps" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" bigint NOT NULL,
	"ordinal" smallint NOT NULL,
	"work_item_id" uuid,
	"calendar_event_id" uuid,
	"mode" "plan_step_mode" NOT NULL,
	"planned_start_at" timestamp with time zone,
	"planned_end_at" timestamp with time zone,
	"reason" text NOT NULL,
	CONSTRAINT "priority_plan_steps_target_chk" CHECK (num_nonnulls("priority_plan_steps"."work_item_id", "priority_plan_steps"."calendar_event_id") >= 1)
);
--> statement-breakpoint
CREATE TABLE "priority_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "policy_status" DEFAULT 'draft' NOT NULL,
	"based_on_policy_id" uuid,
	"role_template_id" uuid,
	"weight_deadline_proximity" numeric(5, 3) DEFAULT 1 NOT NULL,
	"weight_calendar_pressure" numeric(5, 3) DEFAULT 1 NOT NULL,
	"weight_lead_time" numeric(5, 3) DEFAULT 1 NOT NULL,
	"weight_effort_fit" numeric(5, 3) DEFAULT 1 NOT NULL,
	"weight_stakeholder_importance" numeric(5, 3) DEFAULT 1 NOT NULL,
	"weight_deal_value" numeric(5, 3) DEFAULT 1 NOT NULL,
	"weight_commitment" numeric(5, 3) DEFAULT 1 NOT NULL,
	"weight_staleness" numeric(5, 3) DEFAULT 1 NOT NULL,
	"weight_obligation" numeric(5, 3) DEFAULT 1 NOT NULL,
	"top3_size" smallint DEFAULT 3 NOT NULL,
	"change_summary" text NOT NULL,
	"source" "config_source" NOT NULL,
	"change_set_id" uuid,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "priority_policies_active_chk" CHECK ("priority_policies"."status" <> 'active' OR "priority_policies"."activated_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "priority_policy_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"ordinal" smallint NOT NULL,
	"rule_key" text NOT NULL,
	"label" text NOT NULL,
	"explanation" text NOT NULL,
	"kind" "policy_rule_kind" NOT NULL,
	"condition" jsonb NOT NULL,
	"other_condition" jsonb,
	"effect_value" numeric(7, 3),
	"effect_lane" "priority_lane",
	"sla_hours" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"source" "config_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "priority_policy_rules_effect_chk" CHECK (("priority_policy_rules"."kind" NOT IN ('boost', 'penalty') OR "priority_policy_rules"."effect_value" IS NOT NULL)
        AND ("priority_policy_rules"."kind" <> 'sla' OR "priority_policy_rules"."sla_hours" IS NOT NULL)
        AND ("priority_policy_rules"."kind" NOT IN ('lane_floor', 'lane_cap') OR "priority_policy_rules"."effect_lane" IS NOT NULL)
        AND ("priority_policy_rules"."kind" <> 'never_above' OR "priority_policy_rules"."other_condition" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "priority_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"trigger" "priority_trigger" NOT NULL,
	"engine_version" text NOT NULL,
	"policy_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"items_considered" integer DEFAULT 0 NOT NULL,
	"items_changed" integer DEFAULT 0 NOT NULL,
	"available_focus_minutes" integer,
	"next_meeting_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "priority_score_rule_hits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"score_id" bigint NOT NULL,
	"rule_id" uuid NOT NULL,
	"effect" numeric(7, 3),
	"explanation" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "priority_scores" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" bigint NOT NULL,
	"work_item_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"total" numeric(8, 3) NOT NULL,
	"deadline_proximity" numeric(7, 3) DEFAULT 0 NOT NULL,
	"calendar_pressure" numeric(7, 3) DEFAULT 0 NOT NULL,
	"lead_time" numeric(7, 3) DEFAULT 0 NOT NULL,
	"effort_fit" numeric(7, 3) DEFAULT 0 NOT NULL,
	"stakeholder_importance" numeric(7, 3) DEFAULT 0 NOT NULL,
	"deal_value" numeric(7, 3) DEFAULT 0 NOT NULL,
	"commitment_weight" numeric(7, 3) DEFAULT 0 NOT NULL,
	"staleness" numeric(7, 3) DEFAULT 0 NOT NULL,
	"obligation_boost" numeric(7, 3) DEFAULT 0 NOT NULL,
	"user_adjustment" numeric(7, 3) DEFAULT 0 NOT NULL,
	"penalty" numeric(7, 3) DEFAULT 0 NOT NULL,
	"lane" "priority_lane" NOT NULL,
	"rank" integer,
	"latest_start_at" timestamp with time zone,
	"slack_minutes" integer,
	"inputs_hash" text NOT NULL,
	"explanation" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provenance_links" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_item_id" uuid NOT NULL,
	"nba_id" uuid,
	"draft_id" uuid,
	"activity_entry_id" uuid,
	"tool_run_id" uuid,
	"missed_opp_finding_id" uuid,
	"chat_message_id" uuid,
	"brief_id" uuid,
	"brief_highlight_id" uuid,
	"role" "provenance_role" NOT NULL,
	"extractor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provenance_links_target_uq" UNIQUE NULLS NOT DISTINCT("source_item_id","role","nba_id","draft_id","activity_entry_id","tool_run_id","missed_opp_finding_id","chat_message_id","brief_id","brief_highlight_id"),
	CONSTRAINT "provenance_links_one_target_chk" CHECK (num_nonnulls("provenance_links"."nba_id", "provenance_links"."draft_id", "provenance_links"."activity_entry_id", "provenance_links"."tool_run_id", "provenance_links"."missed_opp_finding_id", "provenance_links"."chat_message_id", "provenance_links"."brief_id", "provenance_links"."brief_highlight_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "reauth_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" uuid NOT NULL,
	"method" "reauth_method" NOT NULL,
	"status" "reauth_status" DEFAULT 'requested' NOT NULL,
	"requested_by" "actor_kind" NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"job_id" bigint,
	"user_instruction" text,
	"error_code" text
);
--> statement-breakpoint
CREATE TABLE "reconcile_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"connector_id" uuid,
	"scan_run_id" uuid,
	"kind" "reconcile_kind" NOT NULL,
	"scope" text,
	"gap_from" timestamp with time zone,
	"gap_to" timestamp with time zone,
	"source_item_id" uuid,
	"work_item_id" uuid,
	"chat_message_id" uuid,
	"detail" text,
	"status" "reconcile_status" DEFAULT 'open' NOT NULL,
	"resolution_job_id" bigint,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relevance_feedback" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"highlight_id" uuid NOT NULL,
	"subscription_id" uuid,
	"kind" "relevance_feedback_kind" NOT NULL,
	"feature_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"change_set_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relevance_weights" (
	"owner_user_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"weight" numeric(6, 3) DEFAULT 0 NOT NULL,
	"positive_count" integer DEFAULT 0 NOT NULL,
	"negative_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relevance_weights_owner_user_id_feature_key_pk" PRIMARY KEY("owner_user_id","feature_key")
);
--> statement-breakpoint
CREATE TABLE "reopen_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"done_work_item_id" uuid NOT NULL,
	"trigger_source_item_id" uuid,
	"trigger_evidence_id" uuid,
	"outcome" "reopen_outcome" NOT NULL,
	"rule_key" text NOT NULL,
	"explanation" text NOT NULL,
	"new_work_item_id" uuid,
	"initiative_id" uuid,
	"transition_id" bigint,
	"confidence" numeric(4, 3),
	"decided_by" "actor_kind" NOT NULL,
	"change_set_id" uuid NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by_change_set_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reopen_decisions_outcome_chk" CHECK ("reopen_decisions"."outcome" <> 'new_sibling' OR "reopen_decisions"."new_work_item_id" IS NOT NULL),
	CONSTRAINT "reopen_decisions_reopen_chk" CHECK ("reopen_decisions"."outcome" <> 'reopened' OR "reopen_decisions"."transition_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"path" text NOT NULL,
	"name" text NOT NULL,
	"remote_url" text,
	"kind" "repo_kind" DEFAULT 'unknown' NOT NULL,
	"default_account_id" uuid,
	"ignored" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_pack_id" uuid,
	"key" text NOT NULL,
	"version" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"priority_policy_seed" jsonb NOT NULL,
	"agent_preference_seed" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"cursor_kind" "cursor_kind" NOT NULL,
	"cursor_value" text,
	"cursor_json" jsonb,
	"high_watermark_at" timestamp with time zone,
	"low_watermark_at" timestamp with time zone,
	"status" "cursor_status" DEFAULT 'active' NOT NULL,
	"last_run_id" uuid,
	"last_advanced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"scan_run_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"object_kind" "ledger_object_kind" NOT NULL,
	"object_external_id" text,
	"covered_from" timestamp with time zone,
	"covered_to" timestamp with time zone,
	"covered" "tstzrange" GENERATED ALWAYS AS (CASE WHEN covered_from IS NOT NULL AND covered_to IS NOT NULL THEN tstzrange(covered_from, covered_to, '[)') END) STORED,
	"start_token" text,
	"end_token" text,
	"item_count" integer DEFAULT 0 NOT NULL,
	"new_item_count" integer DEFAULT 0 NOT NULL,
	"result_hash" text,
	"outcome" "ledger_outcome" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_ledger_entries_range_chk" CHECK ("scan_ledger_entries"."covered_from" IS NULL OR "scan_ledger_entries"."covered_to" IS NULL OR "scan_ledger_entries"."covered_to" >= "scan_ledger_entries"."covered_from")
);
--> statement-breakpoint
CREATE TABLE "scan_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"scope" text,
	"trigger" "scan_trigger" NOT NULL,
	"mode" "scan_mode" NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"job_id" bigint,
	"skill_key" text,
	"skill_version" text,
	"model_tier" "model_tier" DEFAULT 'none' NOT NULL,
	"cursor_before" jsonb,
	"cursor_after" jsonb,
	"items_seen" integer DEFAULT 0 NOT NULL,
	"items_new" integer DEFAULT 0 NOT NULL,
	"items_updated" integer DEFAULT 0 NOT NULL,
	"items_unchanged" integer DEFAULT 0 NOT NULL,
	"items_skipped" integer DEFAULT 0 NOT NULL,
	"links_created" integer DEFAULT 0 NOT NULL,
	"candidates_created" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "se_task_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_pack_id" uuid NOT NULL,
	"name" text NOT NULL,
	"counts_customer_related" boolean NOT NULL,
	"counts_customer_facing" boolean NOT NULL,
	"bucket" "task_type_bucket" NOT NULL,
	"external_swap_to_id" uuid,
	"internal_downgrade_to_id" uuid,
	"requires_meeting_type" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_item_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_item_id" uuid NOT NULL,
	"account_id" uuid,
	"opportunity_id" uuid,
	"person_id" uuid,
	"asset_id" uuid,
	"calendar_event_id" uuid,
	"role" "entity_link_role" DEFAULT 'about' NOT NULL,
	"method" "link_method" NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"extractor_id" uuid,
	"mapping_rule_id" uuid,
	"user_verdict" "user_verdict",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_item_links_target_uq" UNIQUE NULLS NOT DISTINCT("source_item_id","role","account_id","opportunity_id","person_id","asset_id","calendar_event_id"),
	CONSTRAINT "source_item_links_one_target_chk" CHECK (num_nonnulls("source_item_links"."account_id", "source_item_links"."opportunity_id", "source_item_links"."person_id", "source_item_links"."asset_id", "source_item_links"."calendar_event_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "source_item_refs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_item_id" uuid NOT NULL,
	"kind" "ref_kind" NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"connector_id" uuid,
	"source" "source_system" NOT NULL,
	"kind" "source_item_kind" NOT NULL,
	"external_id" text NOT NULL,
	"external_parent_id" text,
	"external_container_id" text,
	"dedupe_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source_updated_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_changed_at" timestamp with time zone,
	"first_scan_run_id" uuid,
	"last_scan_run_id" uuid,
	"actor_person_id" uuid,
	"actor_external_id" text,
	"from_me" boolean DEFAULT false NOT NULL,
	"addressed_to_me" boolean DEFAULT false NOT NULL,
	"channel_id" uuid,
	"asset_id" uuid,
	"repo_id" uuid,
	"title" text,
	"url" text,
	"body" text,
	"body_format" "body_format" DEFAULT 'plain' NOT NULL,
	"body_expires_at" timestamp with time zone,
	"body_purged_at" timestamp with time zone,
	"redacted" boolean DEFAULT false NOT NULL,
	"redaction_count" integer DEFAULT 0 NOT NULL,
	"redaction_kinds" text[] DEFAULT '{}'::text[] NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_upstream_at" timestamp with time zone,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_items_redaction_chk" CHECK ("source_items"."redacted" = ("source_items"."redaction_count" > 0))
);
--> statement-breakpoint
CREATE TABLE "task_capture_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"label" text NOT NULL,
	"explanation" text NOT NULL,
	"source_scope" "source_system",
	"condition" jsonb NOT NULL,
	"action" "capture_action" NOT NULL,
	"min_confidence" numeric(4, 3),
	"target_kind" "work_item_kind",
	"ordinal" smallint DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"source" "config_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"version" text NOT NULL,
	"name" text NOT NULL,
	"source_path" text NOT NULL,
	"content_hash" text NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_pack_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" "team_rule_kind" NOT NULL,
	"schedule" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"source" time_block_source NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"local_day" date NOT NULL,
	"attention" "attention_kind" NOT NULL,
	"counts_as_human_hours" boolean NOT NULL,
	"precedence" smallint NOT NULL,
	"is_overlay" boolean DEFAULT false NOT NULL,
	"source_item_id" uuid,
	"calendar_event_id" uuid,
	"claude_session_segment_id" uuid,
	"asset_id" uuid,
	"repo_id" uuid,
	"account_id" uuid,
	"opportunity_id" uuid,
	"mapping_method" "link_method",
	"mapping_confidence" numeric(4, 3),
	"dedupe_key" text NOT NULL,
	"engine_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_blocks_range_chk" CHECK ("time_blocks"."ends_at" > "time_blocks"."starts_at"),
	CONSTRAINT "time_blocks_human_hours_chk" CHECK (NOT "time_blocks"."counts_as_human_hours" OR ("time_blocks"."source" <> 'claude_background' AND "time_blocks"."attention" <> 'background' AND NOT "time_blocks"."is_overlay"))
);
--> statement-breakpoint
CREATE TABLE "tool_adapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" "tool_adapter_kind" NOT NULL,
	"base_url" text,
	"health_path" text,
	"launch_command" text,
	"capabilities" text[] DEFAULT '{}'::text[] NOT NULL,
	"input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_health_at" timestamp with time zone,
	"last_health_ok" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_run_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tool_run_id" uuid NOT NULL,
	"kind" "tool_output_kind" NOT NULL,
	"label" text NOT NULL,
	"url" text,
	"asset_id" uuid,
	"local_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_run_outputs_target_chk" CHECK (num_nonnulls("tool_run_outputs"."url", "tool_run_outputs"."asset_id", "tool_run_outputs"."local_path") >= 1)
);
--> statement-breakpoint
CREATE TABLE "tool_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"adapter_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"work_item_id" uuid,
	"nba_id" uuid,
	"status" "tool_run_status" DEFAULT 'queued' NOT NULL,
	"input" jsonb NOT NULL,
	"external_run_id" text,
	"job_id" bigint,
	"claude_session_id" uuid,
	"output_summary" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" "interest_kind" NOT NULL,
	"value" text NOT NULL,
	"weight" numeric(5, 3) DEFAULT 1 NOT NULL,
	"source" "config_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"owner_user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_owner_user_id_key_pk" PRIMARY KEY("owner_user_id","key")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"timezone" text DEFAULT 'America/Denver' NOT NULL,
	"person_id" uuid,
	"team_pack_id" uuid,
	"role_template_id" uuid,
	"manager_person_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vdp_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"vdp_slug" text NOT NULL,
	"url" text,
	"opportunity_id" uuid,
	"account_id" uuid,
	"fiscal_year" smallint,
	"fiscal_quarter" smallint,
	"has_ae" boolean DEFAULT false NOT NULL,
	"has_ta" boolean DEFAULT false NOT NULL,
	"use_case_count" integer DEFAULT 0 NOT NULL,
	"use_case_with_ai_count" integer DEFAULT 0 NOT NULL,
	"asset_count" integer DEFAULT 0 NOT NULL,
	"dc_note_cached" boolean DEFAULT false NOT NULL,
	"missing_items" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_item_id" uuid,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "policy_status" DEFAULT 'draft' NOT NULL,
	"source" "config_source" NOT NULL,
	"tone" text,
	"formality" smallint DEFAULT 2 NOT NULL,
	"verbosity" smallint DEFAULT 2 NOT NULL,
	"emoji_use" smallint DEFAULT 1 NOT NULL,
	"greeting" text,
	"signoff" text,
	"phrases_to_use" text[] DEFAULT '{}'::text[] NOT NULL,
	"phrases_to_avoid" text[] DEFAULT '{}'::text[] NOT NULL,
	"style_guide" text,
	"slack_guide" text,
	"email_guide" text,
	"learned_from_message_count" integer DEFAULT 0 NOT NULL,
	"change_summary" text NOT NULL,
	"change_set_id" uuid,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_profiles_scales_chk" CHECK ("voice_profiles"."formality" BETWEEN 1 AND 5 AND "voice_profiles"."verbosity" BETWEEN 1 AND 5 AND "voice_profiles"."emoji_use" BETWEEN 0 AND 3)
);
--> statement-breakpoint
CREATE TABLE "watch_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"scope_kind" "watch_scope_kind" NOT NULL,
	"channel_id" uuid,
	"opportunity_id" uuid,
	"account_id" uuid,
	"person_id" uuid,
	"initiative_id" uuid,
	"search_query" text,
	"source_systems" "source_system"[] DEFAULT '{}'::source_system[] NOT NULL,
	"label" text NOT NULL,
	"cadence" "brief_cadence" DEFAULT 'daily' NOT NULL,
	"style" "brief_style" DEFAULT 'digest' NOT NULL,
	"detail_level" smallint DEFAULT 2 NOT NULL,
	"max_highlights" smallint DEFAULT 5 NOT NULL,
	"min_relevance" numeric(4, 3) DEFAULT 0.5 NOT NULL,
	"auto_managed" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"schedule_id" uuid,
	"last_period_end" timestamp with time zone,
	"last_brief_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watch_subscriptions_scope_uq" UNIQUE NULLS NOT DISTINCT("owner_user_id","scope_kind","channel_id","opportunity_id","account_id","person_id","initiative_id","search_query"),
	CONSTRAINT "watch_subscriptions_scope_chk" CHECK (num_nonnulls("watch_subscriptions"."channel_id", "watch_subscriptions"."opportunity_id", "watch_subscriptions"."account_id", "watch_subscriptions"."person_id", "watch_subscriptions"."initiative_id", "watch_subscriptions"."search_query") = 1
        AND ("watch_subscriptions"."scope_kind" <> 'channel' OR "watch_subscriptions"."channel_id" IS NOT NULL)
        AND ("watch_subscriptions"."scope_kind" <> 'opportunity' OR "watch_subscriptions"."opportunity_id" IS NOT NULL)
        AND ("watch_subscriptions"."scope_kind" <> 'account' OR "watch_subscriptions"."account_id" IS NOT NULL)
        AND ("watch_subscriptions"."scope_kind" <> 'person' OR "watch_subscriptions"."person_id" IS NOT NULL)
        AND ("watch_subscriptions"."scope_kind" <> 'initiative' OR "watch_subscriptions"."initiative_id" IS NOT NULL)
        AND ("watch_subscriptions"."scope_kind" <> 'search_query' OR "watch_subscriptions"."search_query" IS NOT NULL)),
	CONSTRAINT "watch_subscriptions_detail_chk" CHECK ("watch_subscriptions"."detail_level" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "work_item_deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"asset_id" uuid,
	"asset_hint" text,
	"kind" "deliverable_kind" NOT NULL,
	"baseline_snapshot_id" uuid,
	"baseline_at" timestamp with time zone NOT NULL,
	"status" "deliverable_status" DEFAULT 'file_unresolved' NOT NULL,
	"latest_judgment_id" uuid,
	"last_judged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_deliverables_target_chk" CHECK (num_nonnulls("work_item_deliverables"."asset_id", "work_item_deliverables"."asset_hint") >= 1),
	CONSTRAINT "work_item_deliverables_resolved_chk" CHECK ("work_item_deliverables"."asset_id" IS NOT NULL OR "work_item_deliverables"."status" IN ('file_unresolved', 'abandoned'))
);
--> statement-breakpoint
CREATE TABLE "work_item_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"source_item_id" uuid,
	"asset_snapshot_id" uuid,
	"asset_diff_id" uuid,
	"deliverable_judgment_id" uuid,
	"role" "evidence_role" NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"extractor_id" uuid NOT NULL,
	"llm_call_id" bigint,
	"rationale" text,
	"user_verdict" "user_verdict",
	"created_by" "actor_kind" DEFAULT 'engine' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_evidence_target_uq" UNIQUE NULLS NOT DISTINCT("work_item_id","role","source_item_id","asset_snapshot_id","asset_diff_id"),
	CONSTRAINT "work_item_evidence_one_target_chk" CHECK (num_nonnulls("work_item_evidence"."source_item_id", "work_item_evidence"."asset_snapshot_id", "work_item_evidence"."asset_diff_id") = 1),
	CONSTRAINT "work_item_evidence_confidence_chk" CHECK ("work_item_evidence"."confidence" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "work_item_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"person_id" uuid,
	"asset_id" uuid,
	"claude_session_id" uuid,
	"calendar_event_id" uuid,
	"repo_id" uuid,
	"tool_run_id" uuid,
	"role" "work_item_link_role" NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"extractor_id" uuid NOT NULL,
	"user_verdict" "user_verdict",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_links_target_uq" UNIQUE NULLS NOT DISTINCT("work_item_id","role","person_id","asset_id","claude_session_id","calendar_event_id","repo_id","tool_run_id"),
	CONSTRAINT "work_item_links_one_target_chk" CHECK (num_nonnulls("work_item_links"."person_id", "work_item_links"."asset_id", "work_item_links"."claude_session_id", "work_item_links"."calendar_event_id", "work_item_links"."repo_id", "work_item_links"."tool_run_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "work_item_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_work_item_id" uuid NOT NULL,
	"to_work_item_id" uuid NOT NULL,
	"kind" "work_item_relation_kind" NOT NULL,
	"created_by" "actor_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_relations_no_self_chk" CHECK ("work_item_relations"."from_work_item_id" <> "work_item_relations"."to_work_item_id")
);
--> statement-breakpoint
CREATE TABLE "work_item_training_details" (
	"work_item_id" uuid PRIMARY KEY NOT NULL,
	"provider" "training_provider" NOT NULL,
	"course_title" text NOT NULL,
	"course_url" text,
	"external_course_id" text,
	"mandatory" boolean DEFAULT false NOT NULL,
	"required_by" timestamp with time zone,
	"estimated_minutes" integer,
	"progress_pct" smallint DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"completion_source_item_id" uuid,
	CONSTRAINT "work_item_training_details_progress_chk" CHECK ("work_item_training_details"."progress_pct" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "work_item_transitions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"work_item_id" uuid NOT NULL,
	"from_status" "work_item_status",
	"to_status" "work_item_status" NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_ref" text,
	"reason" text,
	"evidence_id" uuid,
	"change_set_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by_change_set_id" uuid
);
--> statement-breakpoint
CREATE TABLE "work_item_travel_details" (
	"work_item_id" uuid PRIMARY KEY NOT NULL,
	"destination" text NOT NULL,
	"departs_at" timestamp with time zone,
	"returns_at" timestamp with time zone,
	"purpose_event_id" uuid,
	"approval_status" "travel_step_status" DEFAULT 'not_started' NOT NULL,
	"approval_ref" text,
	"booking_status" "travel_step_status" DEFAULT 'not_started' NOT NULL,
	"expense_status" "travel_step_status" DEFAULT 'not_started' NOT NULL,
	"expense_due_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" "work_item_kind" NOT NULL,
	"origin" "work_item_origin" NOT NULL,
	"status" "work_item_status" DEFAULT 'suggested' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_reason" text,
	"title" text NOT NULL,
	"purpose" text,
	"description" text,
	"initiative_id" uuid,
	"account_id" uuid,
	"opportunity_id" uuid,
	"counterparty_person_id" uuid,
	"parent_id" uuid,
	"merged_into_id" uuid,
	"due_at" timestamp with time zone,
	"due_kind" "due_kind",
	"deadline_event_id" uuid,
	"effort_minutes" integer,
	"lead_time_minutes" integer,
	"effort_source" "effort_source" DEFAULT 'default' NOT NULL,
	"backgroundable" boolean DEFAULT false NOT NULL,
	"importance" "importance_level" DEFAULT 'normal' NOT NULL,
	"confidence" numeric(4, 3),
	"closure_kind" "closure_kind" DEFAULT 'manual_only' NOT NULL,
	"closure_target" text,
	"closure_params" jsonb,
	"auto_close_allowed" boolean DEFAULT false NOT NULL,
	"snoozed_until" timestamp with time zone,
	"snoozed_from_status" "work_item_status",
	"waiting_reason" text,
	"waiting_since" timestamp with time zone,
	"likely_done_at" timestamp with time zone,
	"likely_done_confidence" numeric(4, 3),
	"done_at" timestamp with time zone,
	"done_by" "actor_kind",
	"reopened_count" integer DEFAULT 0 NOT NULL,
	"last_reopened_at" timestamp with time zone,
	"seen_by_user_at" timestamp with time zone,
	"last_new_info_at" timestamp with time zone,
	"unseen_evidence_count" integer DEFAULT 0 NOT NULL,
	"reeval_generation" bigint DEFAULT 0 NOT NULL,
	"priority_score" numeric(8, 3),
	"priority_lane" "priority_lane",
	"priority_rank" integer,
	"priority_score_id" bigint,
	"priority_computed_at" timestamp with time zone,
	"current_nba_id" uuid,
	"created_by_extractor_id" uuid,
	"user_locked_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_items_snooze_chk" CHECK ("work_items"."status" <> 'snoozed' OR ("work_items"."snoozed_until" IS NOT NULL AND "work_items"."snoozed_from_status" IS NOT NULL AND "work_items"."snoozed_from_status" NOT IN ('snoozed', 'done', 'dismissed', 'merged'))),
	CONSTRAINT "work_items_done_chk" CHECK (("work_items"."status" = 'done') = ("work_items"."done_at" IS NOT NULL AND "work_items"."done_by" IS NOT NULL)),
	CONSTRAINT "work_items_merged_chk" CHECK (("work_items"."status" = 'merged') = ("work_items"."merged_into_id" IS NOT NULL)),
	CONSTRAINT "work_items_waiting_on_me_chk" CHECK ("work_items"."status" <> 'waiting_on_me' OR "work_items"."waiting_reason" IS NOT NULL),
	CONSTRAINT "work_items_no_self_ref_chk" CHECK ("work_items"."parent_id" IS DISTINCT FROM "work_items"."id" AND "work_items"."merged_into_id" IS DISTINCT FROM "work_items"."id"),
	CONSTRAINT "work_items_effort_chk" CHECK (("work_items"."effort_minutes" IS NULL OR "work_items"."effort_minutes" >= 0) AND ("work_items"."lead_time_minutes" IS NULL OR "work_items"."effort_minutes" IS NULL OR "work_items"."lead_time_minutes" >= "work_items"."effort_minutes"))
);
--> statement-breakpoint
CREATE TABLE "worker_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"hostname" text NOT NULL,
	"pid" integer NOT NULL,
	"app_version" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_beat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	"stop_reason" text
);
--> statement-breakpoint
ALTER TABLE "account_aliases" ADD CONSTRAINT "account_aliases_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_account_id_accounts_id_fk" FOREIGN KEY ("parent_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_entries" ADD CONSTRAINT "activity_entries_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_entries" ADD CONSTRAINT "activity_entries_se_task_type_id_se_task_types_id_fk" FOREIGN KEY ("se_task_type_id") REFERENCES "public"."se_task_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_entries" ADD CONSTRAINT "activity_entries_meeting_type_id_org62_picklist_values_id_fk" FOREIGN KEY ("meeting_type_id") REFERENCES "public"."org62_picklist_values"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_entries" ADD CONSTRAINT "activity_entries_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_entries" ADD CONSTRAINT "activity_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_entries" ADD CONSTRAINT "activity_entries_org62_event_row_id_org62_events_id_fk" FOREIGN KEY ("org62_event_row_id") REFERENCES "public"."org62_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_entries" ADD CONSTRAINT "activity_entries_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_entry_time_blocks" ADD CONSTRAINT "activity_entry_time_blocks_time_block_id_time_blocks_id_fk" FOREIGN KEY ("time_block_id") REFERENCES "public"."time_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_entry_time_blocks" ADD CONSTRAINT "activity_entry_time_blocks_activity_entry_id_fk" FOREIGN KEY ("activity_entry_id") REFERENCES "public"."activity_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_events" ADD CONSTRAINT "app_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_events" ADD CONSTRAINT "app_events_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_events" ADD CONSTRAINT "app_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_events" ADD CONSTRAINT "app_events_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_snapshot_diffs" ADD CONSTRAINT "asset_snapshot_diffs_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_snapshot_diffs" ADD CONSTRAINT "asset_snapshot_diffs_from_snapshot_id_asset_snapshots_id_fk" FOREIGN KEY ("from_snapshot_id") REFERENCES "public"."asset_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_snapshot_diffs" ADD CONSTRAINT "asset_snapshot_diffs_to_snapshot_id_asset_snapshots_id_fk" FOREIGN KEY ("to_snapshot_id") REFERENCES "public"."asset_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_snapshot_diffs" ADD CONSTRAINT "asset_snapshot_diffs_summary_llm_call_id_llm_calls_id_fk" FOREIGN KEY ("summary_llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_snapshot_sections" ADD CONSTRAINT "asset_snapshot_sections_snapshot_id_asset_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."asset_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_snapshots" ADD CONSTRAINT "asset_snapshots_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_snapshots" ADD CONSTRAINT "asset_snapshots_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_snapshots" ADD CONSTRAINT "asset_snapshots_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_snapshots" ADD CONSTRAINT "asset_snapshots_last_modifying_person_id_people_id_fk" FOREIGN KEY ("last_modifying_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_last_modifying_person_id_people_id_fk" FOREIGN KEY ("last_modifying_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_latest_snapshot_id_asset_snapshots_id_fk" FOREIGN KEY ("latest_snapshot_id") REFERENCES "public"."asset_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_change_set_id_change_sets_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."change_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autonomy_policies" ADD CONSTRAINT "autonomy_policies_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_highlight_reasons" ADD CONSTRAINT "brief_highlight_reasons_highlight_id_brief_highlights_id_fk" FOREIGN KEY ("highlight_id") REFERENCES "public"."brief_highlights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_highlight_reasons" ADD CONSTRAINT "brief_highlight_reasons_policy_rule_id_fk" FOREIGN KEY ("policy_rule_id") REFERENCES "public"."priority_policy_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_highlights" ADD CONSTRAINT "brief_highlights_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_highlights" ADD CONSTRAINT "brief_highlights_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_highlights" ADD CONSTRAINT "brief_highlights_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_highlights" ADD CONSTRAINT "brief_highlights_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_highlights" ADD CONSTRAINT "brief_highlights_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_highlights" ADD CONSTRAINT "brief_highlights_promoted_work_item_id_work_items_id_fk" FOREIGN KEY ("promoted_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_highlights" ADD CONSTRAINT "brief_highlights_extractor_id_extractors_id_fk" FOREIGN KEY ("extractor_id") REFERENCES "public"."extractors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_highlights" ADD CONSTRAINT "brief_highlights_llm_call_id_llm_calls_id_fk" FOREIGN KEY ("llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_scan_runs" ADD CONSTRAINT "brief_scan_runs_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_scan_runs" ADD CONSTRAINT "brief_scan_runs_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_subscription_id_watch_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."watch_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_from_opportunity_snapshot_id_opportunity_snapshots_id_fk" FOREIGN KEY ("from_opportunity_snapshot_id") REFERENCES "public"."opportunity_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_to_opportunity_snapshot_id_opportunity_snapshots_id_fk" FOREIGN KEY ("to_opportunity_snapshot_id") REFERENCES "public"."opportunity_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_llm_call_id_llm_calls_id_fk" FOREIGN KEY ("llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_attendees" ADD CONSTRAINT "calendar_event_attendees_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_attendees" ADD CONSTRAINT "calendar_event_attendees_calendar_event_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_organizer_person_id_people_id_fk" FOREIGN KEY ("organizer_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_lines" ADD CONSTRAINT "canvas_lines_sync_run_id_canvas_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."canvas_sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_lines" ADD CONSTRAINT "canvas_lines_activity_entry_id_activity_entries_id_fk" FOREIGN KEY ("activity_entry_id") REFERENCES "public"."activity_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_lines" ADD CONSTRAINT "canvas_lines_dc_request_id_deal_contribution_requests_id_fk" FOREIGN KEY ("dc_request_id") REFERENCES "public"."deal_contribution_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_lines" ADD CONSTRAINT "canvas_lines_change_set_id_change_sets_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."change_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_sync_runs" ADD CONSTRAINT "canvas_sync_runs_canvas_id_canvases_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_sync_runs" ADD CONSTRAINT "canvas_sync_runs_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_sync_runs" ADD CONSTRAINT "canvas_sync_runs_marks_source_item_id_source_items_id_fk" FOREIGN KEY ("marks_source_item_id") REFERENCES "public"."source_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_evidence_id_work_item_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."work_item_evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_extractor_id_extractors_id_fk" FOREIGN KEY ("extractor_id") REFERENCES "public"."extractors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_llm_call_id_llm_calls_id_fk" FOREIGN KEY ("llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_applied_change_set_id_change_sets_id_fk" FOREIGN KEY ("applied_change_set_id") REFERENCES "public"."change_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_superseded_by_id_change_proposals_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."change_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_sets" ADD CONSTRAINT "change_sets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_sets" ADD CONSTRAINT "change_sets_undo_of_change_set_id_change_sets_id_fk" FOREIGN KEY ("undo_of_change_set_id") REFERENCES "public"."change_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_sets" ADD CONSTRAINT "change_sets_undone_by_change_set_id_change_sets_id_fk" FOREIGN KEY ("undone_by_change_set_id") REFERENCES "public"."change_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_account_maps" ADD CONSTRAINT "channel_account_maps_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_account_maps" ADD CONSTRAINT "channel_account_maps_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_account_maps" ADD CONSTRAINT "channel_account_maps_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_account_maps" ADD CONSTRAINT "channel_account_maps_mapping_rule_id_mapping_rules_id_fk" FOREIGN KEY ("mapping_rule_id") REFERENCES "public"."mapping_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_llm_call_id_llm_calls_id_fk" FOREIGN KEY ("llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_tool_calls" ADD CONSTRAINT "chat_tool_calls_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_tool_calls" ADD CONSTRAINT "chat_tool_calls_change_set_id_change_sets_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."change_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_tool_calls" ADD CONSTRAINT "chat_tool_calls_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_session_segments" ADD CONSTRAINT "claude_session_segments_claude_session_id_claude_sessions_id_fk" FOREIGN KEY ("claude_session_id") REFERENCES "public"."claude_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_session_segments" ADD CONSTRAINT "claude_session_segments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_session_segments" ADD CONSTRAINT "claude_session_segments_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_sessions" ADD CONSTRAINT "claude_sessions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_sessions" ADD CONSTRAINT "claude_sessions_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_sessions" ADD CONSTRAINT "claude_sessions_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_sessions" ADD CONSTRAINT "claude_sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_sessions" ADD CONSTRAINT "claude_sessions_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_sessions" ADD CONSTRAINT "claude_sessions_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_sessions" ADD CONSTRAINT "claude_sessions_launch_work_item_id_work_items_id_fk" FOREIGN KEY ("launch_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_sessions" ADD CONSTRAINT "claude_sessions_launch_nba_id_next_best_actions_id_fk" FOREIGN KEY ("launch_nba_id") REFERENCES "public"."next_best_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_sessions" ADD CONSTRAINT "claude_sessions_launch_job_id_jobs_id_fk" FOREIGN KEY ("launch_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_auth_events" ADD CONSTRAINT "connector_auth_events_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_auth_events" ADD CONSTRAINT "connector_auth_events_reauth_attempt_id_reauth_attempts_id_fk" FOREIGN KEY ("reauth_attempt_id") REFERENCES "public"."reauth_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_health_checks" ADD CONSTRAINT "connector_health_checks_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_change_set_id_change_sets_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."change_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_contribution_requests" ADD CONSTRAINT "deal_contribution_requests_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_contribution_requests" ADD CONSTRAINT "deal_contribution_requests_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_contribution_requests" ADD CONSTRAINT "deal_contribution_requests_missed_opp_finding_id_fk" FOREIGN KEY ("missed_opp_finding_id") REFERENCES "public"."missed_opp_findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_contribution_requests" ADD CONSTRAINT "deal_contribution_requests_deal_contribution_id_fk" FOREIGN KEY ("deal_contribution_id") REFERENCES "public"."deal_contributions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_contributions" ADD CONSTRAINT "deal_contributions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_contributions" ADD CONSTRAINT "deal_contributions_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_contributions" ADD CONSTRAINT "deal_contributions_contributor_person_id_people_id_fk" FOREIGN KEY ("contributor_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_contributions" ADD CONSTRAINT "deal_contributions_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_judgments" ADD CONSTRAINT "deliverable_judgments_diff_id_asset_snapshot_diffs_id_fk" FOREIGN KEY ("diff_id") REFERENCES "public"."asset_snapshot_diffs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_judgments" ADD CONSTRAINT "deliverable_judgments_snapshot_id_asset_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."asset_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_judgments" ADD CONSTRAINT "deliverable_judgments_llm_call_id_llm_calls_id_fk" FOREIGN KEY ("llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_judgments" ADD CONSTRAINT "deliverable_judgments_deliverable_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."work_item_deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_requirements" ADD CONSTRAINT "deliverable_requirements_extractor_id_extractors_id_fk" FOREIGN KEY ("extractor_id") REFERENCES "public"."extractors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_requirements" ADD CONSTRAINT "deliverable_requirements_requested_by_source_item_id_fk" FOREIGN KEY ("requested_by_source_item_id") REFERENCES "public"."source_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_requirements" ADD CONSTRAINT "deliverable_requirements_deliverable_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."work_item_deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_recipients" ADD CONSTRAINT "draft_recipients_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_recipients" ADD CONSTRAINT "draft_recipients_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_renditions" ADD CONSTRAINT "draft_renditions_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_send_attempts" ADD CONSTRAINT "draft_send_attempts_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_send_attempts" ADD CONSTRAINT "draft_send_attempts_rendition_id_draft_renditions_id_fk" FOREIGN KEY ("rendition_id") REFERENCES "public"."draft_renditions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_send_attempts" ADD CONSTRAINT "draft_send_attempts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_verifications" ADD CONSTRAINT "draft_verifications_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_verifications" ADD CONSTRAINT "draft_verifications_send_attempt_id_draft_send_attempts_id_fk" FOREIGN KEY ("send_attempt_id") REFERENCES "public"."draft_send_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_verifications" ADD CONSTRAINT "draft_verifications_matched_source_item_id_source_items_id_fk" FOREIGN KEY ("matched_source_item_id") REFERENCES "public"."source_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_nba_id_next_best_actions_id_fk" FOREIGN KEY ("nba_id") REFERENCES "public"."next_best_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_in_reply_to_source_item_id_source_items_id_fk" FOREIGN KEY ("in_reply_to_source_item_id") REFERENCES "public"."source_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_autonomy_policy_id_autonomy_policies_id_fk" FOREIGN KEY ("autonomy_policy_id") REFERENCES "public"."autonomy_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_llm_call_id_llm_calls_id_fk" FOREIGN KEY ("llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_voice_profile_id_voice_profiles_id_fk" FOREIGN KEY ("voice_profile_id") REFERENCES "public"."voice_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_candidates" ADD CONSTRAINT "extraction_candidates_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_candidates" ADD CONSTRAINT "extraction_candidates_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_candidates" ADD CONSTRAINT "extraction_candidates_extractor_id_extractors_id_fk" FOREIGN KEY ("extractor_id") REFERENCES "public"."extractors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_candidates" ADD CONSTRAINT "extraction_candidates_counterparty_person_id_people_id_fk" FOREIGN KEY ("counterparty_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_candidates" ADD CONSTRAINT "extraction_candidates_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_candidates" ADD CONSTRAINT "extraction_candidates_llm_call_id_llm_calls_id_fk" FOREIGN KEY ("llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_team_pack_id_team_packs_id_fk" FOREIGN KEY ("team_pack_id") REFERENCES "public"."team_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_links" ADD CONSTRAINT "initiative_links_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_links" ADD CONSTRAINT "initiative_links_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_links" ADD CONSTRAINT "initiative_links_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_links" ADD CONSTRAINT "initiative_links_claude_session_id_claude_sessions_id_fk" FOREIGN KEY ("claude_session_id") REFERENCES "public"."claude_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_links" ADD CONSTRAINT "initiative_links_calendar_event_id_calendar_events_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_links" ADD CONSTRAINT "initiative_links_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_links" ADD CONSTRAINT "initiative_links_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_links" ADD CONSTRAINT "initiative_links_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_summary_llm_call_id_llm_calls_id_fk" FOREIGN KEY ("summary_llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_target_event_id_calendar_events_id_fk" FOREIGN KEY ("target_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_schedules" ADD CONSTRAINT "job_schedules_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_schedules" ADD CONSTRAINT "job_schedules_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_schedules" ADD CONSTRAINT "job_schedules_last_job_id_jobs_id_fk" FOREIGN KEY ("last_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_superseded_by_id_jobs_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_schedule_id_job_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."job_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_parent_job_id_jobs_id_fk" FOREIGN KEY ("parent_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_budget_days" ADD CONSTRAINT "llm_budget_days_budget_id_llm_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."llm_budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_budgets" ADD CONSTRAINT "llm_budgets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_chat_message_id_chat_messages_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_rules" ADD CONSTRAINT "mapping_rules_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_rules" ADD CONSTRAINT "mapping_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_rules" ADD CONSTRAINT "mapping_rules_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_rules" ADD CONSTRAINT "mapping_rules_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_rules" ADD CONSTRAINT "mapping_rules_se_task_type_id_se_task_types_id_fk" FOREIGN KEY ("se_task_type_id") REFERENCES "public"."se_task_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_rules" ADD CONSTRAINT "mapping_rules_created_from_change_set_id_change_sets_id_fk" FOREIGN KEY ("created_from_change_set_id") REFERENCES "public"."change_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_notes" ADD CONSTRAINT "meeting_notes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_notes" ADD CONSTRAINT "meeting_notes_calendar_event_id_calendar_events_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_notes" ADD CONSTRAINT "meeting_notes_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missed_opp_findings" ADD CONSTRAINT "missed_opp_findings_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missed_opp_findings" ADD CONSTRAINT "missed_opp_findings_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missed_opp_findings" ADD CONSTRAINT "missed_opp_findings_first_sweep_id_missed_opp_sweeps_id_fk" FOREIGN KEY ("first_sweep_id") REFERENCES "public"."missed_opp_sweeps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missed_opp_findings" ADD CONSTRAINT "missed_opp_findings_last_sweep_id_missed_opp_sweeps_id_fk" FOREIGN KEY ("last_sweep_id") REFERENCES "public"."missed_opp_sweeps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missed_opp_findings" ADD CONSTRAINT "missed_opp_findings_stranded_dc_id_deal_contributions_id_fk" FOREIGN KEY ("stranded_dc_id") REFERENCES "public"."deal_contributions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missed_opp_findings" ADD CONSTRAINT "missed_opp_findings_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missed_opp_sweeps" ADD CONSTRAINT "missed_opp_sweeps_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missed_opp_sweeps" ADD CONSTRAINT "missed_opp_sweeps_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_best_actions" ADD CONSTRAINT "next_best_actions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_best_actions" ADD CONSTRAINT "next_best_actions_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_best_actions" ADD CONSTRAINT "next_best_actions_llm_call_id_llm_calls_id_fk" FOREIGN KEY ("llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_best_actions" ADD CONSTRAINT "next_best_actions_supersedes_id_next_best_actions_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."next_best_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_best_actions" ADD CONSTRAINT "next_best_actions_trigger_source_item_id_source_items_id_fk" FOREIGN KEY ("trigger_source_item_id") REFERENCES "public"."source_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_best_actions" ADD CONSTRAINT "next_best_actions_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_best_actions" ADD CONSTRAINT "next_best_actions_tool_run_id_tool_runs_id_fk" FOREIGN KEY ("tool_run_id") REFERENCES "public"."tool_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_best_actions" ADD CONSTRAINT "next_best_actions_claude_session_id_claude_sessions_id_fk" FOREIGN KEY ("claude_session_id") REFERENCES "public"."claude_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_best_actions" ADD CONSTRAINT "next_best_actions_activity_entry_id_activity_entries_id_fk" FOREIGN KEY ("activity_entry_id") REFERENCES "public"."activity_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_app_event_id_app_events_id_fk" FOREIGN KEY ("app_event_id") REFERENCES "public"."app_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_change_set_id_change_sets_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."change_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_latest_snapshot_id_opportunity_snapshots_id_fk" FOREIGN KEY ("latest_snapshot_id") REFERENCES "public"."opportunity_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_snapshots" ADD CONSTRAINT "opportunity_snapshots_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_snapshots" ADD CONSTRAINT "opportunity_snapshots_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_team_members" ADD CONSTRAINT "opportunity_team_members_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_team_members" ADD CONSTRAINT "opportunity_team_members_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org62_events" ADD CONSTRAINT "org62_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org62_events" ADD CONSTRAINT "org62_events_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org62_events" ADD CONSTRAINT "org62_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org62_events" ADD CONSTRAINT "org62_events_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org62_picklist_values" ADD CONSTRAINT "org62_picklist_values_team_pack_id_team_packs_id_fk" FOREIGN KEY ("team_pack_id") REFERENCES "public"."team_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_merged_into_person_id_people_id_fk" FOREIGN KEY ("merged_into_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_identities" ADD CONSTRAINT "person_identities_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_identities" ADD CONSTRAINT "person_identities_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_plan_steps" ADD CONSTRAINT "priority_plan_steps_run_id_priority_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."priority_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_plan_steps" ADD CONSTRAINT "priority_plan_steps_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_plan_steps" ADD CONSTRAINT "priority_plan_steps_calendar_event_id_calendar_events_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_policies" ADD CONSTRAINT "priority_policies_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_policies" ADD CONSTRAINT "priority_policies_based_on_policy_id_priority_policies_id_fk" FOREIGN KEY ("based_on_policy_id") REFERENCES "public"."priority_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_policies" ADD CONSTRAINT "priority_policies_role_template_id_role_templates_id_fk" FOREIGN KEY ("role_template_id") REFERENCES "public"."role_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_policies" ADD CONSTRAINT "priority_policies_change_set_id_change_sets_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."change_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_policy_rules" ADD CONSTRAINT "priority_policy_rules_policy_id_priority_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."priority_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_runs" ADD CONSTRAINT "priority_runs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_runs" ADD CONSTRAINT "priority_runs_policy_id_priority_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."priority_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_score_rule_hits" ADD CONSTRAINT "priority_score_rule_hits_score_id_priority_scores_id_fk" FOREIGN KEY ("score_id") REFERENCES "public"."priority_scores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_score_rule_hits" ADD CONSTRAINT "priority_score_rule_hits_rule_id_priority_policy_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."priority_policy_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_scores" ADD CONSTRAINT "priority_scores_run_id_priority_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."priority_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_scores" ADD CONSTRAINT "priority_scores_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priority_scores" ADD CONSTRAINT "priority_scores_policy_id_priority_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."priority_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance_links" ADD CONSTRAINT "provenance_links_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance_links" ADD CONSTRAINT "provenance_links_nba_id_next_best_actions_id_fk" FOREIGN KEY ("nba_id") REFERENCES "public"."next_best_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance_links" ADD CONSTRAINT "provenance_links_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance_links" ADD CONSTRAINT "provenance_links_activity_entry_id_activity_entries_id_fk" FOREIGN KEY ("activity_entry_id") REFERENCES "public"."activity_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance_links" ADD CONSTRAINT "provenance_links_tool_run_id_tool_runs_id_fk" FOREIGN KEY ("tool_run_id") REFERENCES "public"."tool_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance_links" ADD CONSTRAINT "provenance_links_chat_message_id_chat_messages_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance_links" ADD CONSTRAINT "provenance_links_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance_links" ADD CONSTRAINT "provenance_links_brief_highlight_id_brief_highlights_id_fk" FOREIGN KEY ("brief_highlight_id") REFERENCES "public"."brief_highlights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance_links" ADD CONSTRAINT "provenance_links_extractor_id_extractors_id_fk" FOREIGN KEY ("extractor_id") REFERENCES "public"."extractors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance_links" ADD CONSTRAINT "provenance_links_missed_opp_finding_id_fk" FOREIGN KEY ("missed_opp_finding_id") REFERENCES "public"."missed_opp_findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reauth_attempts" ADD CONSTRAINT "reauth_attempts_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reauth_attempts" ADD CONSTRAINT "reauth_attempts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconcile_findings" ADD CONSTRAINT "reconcile_findings_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconcile_findings" ADD CONSTRAINT "reconcile_findings_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconcile_findings" ADD CONSTRAINT "reconcile_findings_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconcile_findings" ADD CONSTRAINT "reconcile_findings_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconcile_findings" ADD CONSTRAINT "reconcile_findings_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconcile_findings" ADD CONSTRAINT "reconcile_findings_chat_message_id_chat_messages_id_fk" FOREIGN KEY ("chat_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconcile_findings" ADD CONSTRAINT "reconcile_findings_resolution_job_id_jobs_id_fk" FOREIGN KEY ("resolution_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relevance_feedback" ADD CONSTRAINT "relevance_feedback_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relevance_feedback" ADD CONSTRAINT "relevance_feedback_highlight_id_brief_highlights_id_fk" FOREIGN KEY ("highlight_id") REFERENCES "public"."brief_highlights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relevance_feedback" ADD CONSTRAINT "relevance_feedback_subscription_id_watch_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."watch_subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relevance_feedback" ADD CONSTRAINT "relevance_feedback_change_set_id_change_sets_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."change_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relevance_weights" ADD CONSTRAINT "relevance_weights_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reopen_decisions" ADD CONSTRAINT "reopen_decisions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reopen_decisions" ADD CONSTRAINT "reopen_decisions_done_work_item_id_work_items_id_fk" FOREIGN KEY ("done_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reopen_decisions" ADD CONSTRAINT "reopen_decisions_trigger_source_item_id_source_items_id_fk" FOREIGN KEY ("trigger_source_item_id") REFERENCES "public"."source_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reopen_decisions" ADD CONSTRAINT "reopen_decisions_trigger_evidence_id_work_item_evidence_id_fk" FOREIGN KEY ("trigger_evidence_id") REFERENCES "public"."work_item_evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reopen_decisions" ADD CONSTRAINT "reopen_decisions_new_work_item_id_work_items_id_fk" FOREIGN KEY ("new_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reopen_decisions" ADD CONSTRAINT "reopen_decisions_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reopen_decisions" ADD CONSTRAINT "reopen_decisions_transition_id_work_item_transitions_id_fk" FOREIGN KEY ("transition_id") REFERENCES "public"."work_item_transitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reopen_decisions" ADD CONSTRAINT "reopen_decisions_change_set_id_change_sets_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."change_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reopen_decisions" ADD CONSTRAINT "reopen_decisions_undone_by_change_set_id_change_sets_id_fk" FOREIGN KEY ("undone_by_change_set_id") REFERENCES "public"."change_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_default_account_id_accounts_id_fk" FOREIGN KEY ("default_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_templates" ADD CONSTRAINT "role_templates_team_pack_id_team_packs_id_fk" FOREIGN KEY ("team_pack_id") REFERENCES "public"."team_packs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_cursors" ADD CONSTRAINT "scan_cursors_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_cursors" ADD CONSTRAINT "scan_cursors_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_cursors" ADD CONSTRAINT "scan_cursors_last_run_id_scan_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_ledger_entries" ADD CONSTRAINT "scan_ledger_entries_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_ledger_entries" ADD CONSTRAINT "scan_ledger_entries_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "se_task_types" ADD CONSTRAINT "se_task_types_team_pack_id_team_packs_id_fk" FOREIGN KEY ("team_pack_id") REFERENCES "public"."team_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "se_task_types" ADD CONSTRAINT "se_task_types_external_swap_to_id_se_task_types_id_fk" FOREIGN KEY ("external_swap_to_id") REFERENCES "public"."se_task_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "se_task_types" ADD CONSTRAINT "se_task_types_internal_downgrade_to_id_se_task_types_id_fk" FOREIGN KEY ("internal_downgrade_to_id") REFERENCES "public"."se_task_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_links" ADD CONSTRAINT "source_item_links_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_links" ADD CONSTRAINT "source_item_links_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_links" ADD CONSTRAINT "source_item_links_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_links" ADD CONSTRAINT "source_item_links_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_links" ADD CONSTRAINT "source_item_links_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_links" ADD CONSTRAINT "source_item_links_calendar_event_id_calendar_events_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_links" ADD CONSTRAINT "source_item_links_extractor_id_extractors_id_fk" FOREIGN KEY ("extractor_id") REFERENCES "public"."extractors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_links" ADD CONSTRAINT "source_item_links_mapping_rule_id_mapping_rules_id_fk" FOREIGN KEY ("mapping_rule_id") REFERENCES "public"."mapping_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_refs" ADD CONSTRAINT "source_item_refs_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_first_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("first_scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_last_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("last_scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_actor_person_id_people_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_capture_rules" ADD CONSTRAINT "task_capture_rules_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_rules" ADD CONSTRAINT "team_rules_team_pack_id_team_packs_id_fk" FOREIGN KEY ("team_pack_id") REFERENCES "public"."team_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_calendar_event_id_calendar_events_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_claude_session_segment_id_fk" FOREIGN KEY ("claude_session_segment_id") REFERENCES "public"."claude_session_segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_adapters" ADD CONSTRAINT "tool_adapters_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_run_outputs" ADD CONSTRAINT "tool_run_outputs_tool_run_id_tool_runs_id_fk" FOREIGN KEY ("tool_run_id") REFERENCES "public"."tool_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_run_outputs" ADD CONSTRAINT "tool_run_outputs_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_runs" ADD CONSTRAINT "tool_runs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_runs" ADD CONSTRAINT "tool_runs_adapter_id_tool_adapters_id_fk" FOREIGN KEY ("adapter_id") REFERENCES "public"."tool_adapters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_runs" ADD CONSTRAINT "tool_runs_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_runs" ADD CONSTRAINT "tool_runs_nba_id_next_best_actions_id_fk" FOREIGN KEY ("nba_id") REFERENCES "public"."next_best_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_runs" ADD CONSTRAINT "tool_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_runs" ADD CONSTRAINT "tool_runs_claude_session_id_claude_sessions_id_fk" FOREIGN KEY ("claude_session_id") REFERENCES "public"."claude_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_team_pack_id_team_packs_id_fk" FOREIGN KEY ("team_pack_id") REFERENCES "public"."team_packs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_template_id_role_templates_id_fk" FOREIGN KEY ("role_template_id") REFERENCES "public"."role_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_manager_person_id_people_id_fk" FOREIGN KEY ("manager_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vdp_records" ADD CONSTRAINT "vdp_records_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vdp_records" ADD CONSTRAINT "vdp_records_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vdp_records" ADD CONSTRAINT "vdp_records_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vdp_records" ADD CONSTRAINT "vdp_records_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_change_set_id_change_sets_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."change_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_subscriptions" ADD CONSTRAINT "watch_subscriptions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_subscriptions" ADD CONSTRAINT "watch_subscriptions_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_subscriptions" ADD CONSTRAINT "watch_subscriptions_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_subscriptions" ADD CONSTRAINT "watch_subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_subscriptions" ADD CONSTRAINT "watch_subscriptions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_subscriptions" ADD CONSTRAINT "watch_subscriptions_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_subscriptions" ADD CONSTRAINT "watch_subscriptions_schedule_id_job_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."job_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_subscriptions" ADD CONSTRAINT "watch_subscriptions_last_brief_id_briefs_id_fk" FOREIGN KEY ("last_brief_id") REFERENCES "public"."briefs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_deliverables" ADD CONSTRAINT "work_item_deliverables_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_deliverables" ADD CONSTRAINT "work_item_deliverables_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_deliverables" ADD CONSTRAINT "work_item_deliverables_latest_judgment_id_fk" FOREIGN KEY ("latest_judgment_id") REFERENCES "public"."deliverable_judgments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_deliverables" ADD CONSTRAINT "work_item_deliverables_baseline_snapshot_id_fk" FOREIGN KEY ("baseline_snapshot_id") REFERENCES "public"."asset_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_evidence" ADD CONSTRAINT "work_item_evidence_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_evidence" ADD CONSTRAINT "work_item_evidence_source_item_id_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_evidence" ADD CONSTRAINT "work_item_evidence_asset_snapshot_id_asset_snapshots_id_fk" FOREIGN KEY ("asset_snapshot_id") REFERENCES "public"."asset_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_evidence" ADD CONSTRAINT "work_item_evidence_asset_diff_id_asset_snapshot_diffs_id_fk" FOREIGN KEY ("asset_diff_id") REFERENCES "public"."asset_snapshot_diffs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_evidence" ADD CONSTRAINT "work_item_evidence_extractor_id_extractors_id_fk" FOREIGN KEY ("extractor_id") REFERENCES "public"."extractors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_evidence" ADD CONSTRAINT "work_item_evidence_llm_call_id_llm_calls_id_fk" FOREIGN KEY ("llm_call_id") REFERENCES "public"."llm_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_evidence" ADD CONSTRAINT "work_item_evidence_deliverable_judgment_id_fk" FOREIGN KEY ("deliverable_judgment_id") REFERENCES "public"."deliverable_judgments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_links" ADD CONSTRAINT "work_item_links_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_links" ADD CONSTRAINT "work_item_links_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_links" ADD CONSTRAINT "work_item_links_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_links" ADD CONSTRAINT "work_item_links_claude_session_id_claude_sessions_id_fk" FOREIGN KEY ("claude_session_id") REFERENCES "public"."claude_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_links" ADD CONSTRAINT "work_item_links_calendar_event_id_calendar_events_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_links" ADD CONSTRAINT "work_item_links_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_links" ADD CONSTRAINT "work_item_links_tool_run_id_tool_runs_id_fk" FOREIGN KEY ("tool_run_id") REFERENCES "public"."tool_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_links" ADD CONSTRAINT "work_item_links_extractor_id_extractors_id_fk" FOREIGN KEY ("extractor_id") REFERENCES "public"."extractors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_relations" ADD CONSTRAINT "work_item_relations_from_work_item_id_work_items_id_fk" FOREIGN KEY ("from_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_relations" ADD CONSTRAINT "work_item_relations_to_work_item_id_work_items_id_fk" FOREIGN KEY ("to_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_training_details" ADD CONSTRAINT "work_item_training_details_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_training_details" ADD CONSTRAINT "work_item_training_details_completion_source_item_id_fk" FOREIGN KEY ("completion_source_item_id") REFERENCES "public"."source_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_transitions" ADD CONSTRAINT "work_item_transitions_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_transitions" ADD CONSTRAINT "work_item_transitions_evidence_id_work_item_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."work_item_evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_transitions" ADD CONSTRAINT "work_item_transitions_change_set_id_change_sets_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."change_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_transitions" ADD CONSTRAINT "work_item_transitions_undone_by_change_set_id_change_sets_id_fk" FOREIGN KEY ("undone_by_change_set_id") REFERENCES "public"."change_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_travel_details" ADD CONSTRAINT "work_item_travel_details_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_travel_details" ADD CONSTRAINT "work_item_travel_details_purpose_event_id_calendar_events_id_fk" FOREIGN KEY ("purpose_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_counterparty_person_id_people_id_fk" FOREIGN KEY ("counterparty_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_parent_id_work_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_merged_into_id_work_items_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_deadline_event_id_calendar_events_id_fk" FOREIGN KEY ("deadline_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_priority_score_id_priority_scores_id_fk" FOREIGN KEY ("priority_score_id") REFERENCES "public"."priority_scores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_current_nba_id_next_best_actions_id_fk" FOREIGN KEY ("current_nba_id") REFERENCES "public"."next_best_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_created_by_extractor_id_extractors_id_fk" FOREIGN KEY ("created_by_extractor_id") REFERENCES "public"."extractors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_aliases_account_kind_value_uidx" ON "account_aliases" USING btree ("account_id","kind","normalized_value");--> statement-breakpoint
CREATE INDEX "account_aliases_kind_value_idx" ON "account_aliases" USING btree ("kind","normalized_value");--> statement-breakpoint
CREATE INDEX "account_aliases_value_trgm_idx" ON "account_aliases" USING gin (normalized_value gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_owner_org62_uidx" ON "accounts" USING btree ("owner_user_id","org62_account_id") WHERE "accounts"."org62_account_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "accounts_name_trgm_idx" ON "accounts" USING gin (lower(name) gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "activity_entries_owner_dedupe_uidx" ON "activity_entries" USING btree ("owner_user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "activity_entries_owner_status_idx" ON "activity_entries" USING btree ("owner_user_id","status","starts_at");--> statement-breakpoint
CREATE INDEX "activity_entries_owner_period_idx" ON "activity_entries" USING btree ("owner_user_id","fiscal_period_id","status");--> statement-breakpoint
CREATE INDEX "activity_entries_opportunity_idx" ON "activity_entries" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "activity_entry_time_blocks_block_idx" ON "activity_entry_time_blocks" USING btree ("time_block_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_events_open_fingerprint_uidx" ON "app_events" USING btree ("fingerprint") WHERE "app_events"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "app_events_owner_unacked_idx" ON "app_events" USING btree ("owner_user_id","severity","last_occurred_at" DESC NULLS LAST) WHERE "app_events"."acknowledged_at" IS NULL AND "app_events"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "app_events_component_idx" ON "app_events" USING btree ("component","last_occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "app_events_entity_idx" ON "app_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_snapshot_diffs_from_to_uidx" ON "asset_snapshot_diffs" USING btree ("from_snapshot_id","to_snapshot_id");--> statement-breakpoint
CREATE INDEX "asset_snapshot_diffs_asset_computed_idx" ON "asset_snapshot_diffs" USING btree ("asset_id","computed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "asset_snapshot_sections_snapshot_ordinal_uidx" ON "asset_snapshot_sections" USING btree ("snapshot_id","ordinal");--> statement-breakpoint
CREATE INDEX "asset_snapshot_sections_snapshot_key_idx" ON "asset_snapshot_sections" USING btree ("snapshot_id","section_key");--> statement-breakpoint
CREATE INDEX "asset_snapshot_sections_text_expiry_idx" ON "asset_snapshot_sections" USING btree ("text_expires_at") WHERE "asset_snapshot_sections"."text" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_snapshots_asset_modified_uidx" ON "asset_snapshots" USING btree ("asset_id","modified_time");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_snapshots_source_item_uidx" ON "asset_snapshots" USING btree ("source_item_id");--> statement-breakpoint
CREATE INDEX "asset_snapshots_asset_sampled_idx" ON "asset_snapshots" USING btree ("asset_id","sampled_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "assets_owner_system_external_uidx" ON "assets" USING btree ("owner_user_id","system","external_id");--> statement-breakpoint
CREATE INDEX "assets_owner_my_edits_idx" ON "assets" USING btree ("owner_user_id","last_modified_by_me_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "assets_watched_idx" ON "assets" USING btree ("owner_user_id","watched_until") WHERE "assets"."tracking_tier" = 'watched';--> statement-breakpoint
CREATE INDEX "assets_account_idx" ON "assets" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "assets_opportunity_idx" ON "assets" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "assets_title_trgm_idx" ON "assets" USING gin (lower(coalesce(title, '')) gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_change_set_row_uidx" ON "audit_events" USING btree ("change_set_id","table_name","row_id");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_row_idx" ON "audit_events" USING btree ("table_name","row_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_owner_created_idx" ON "audit_events" USING btree ("owner_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "brief_highlight_reasons_highlight_feature_uidx" ON "brief_highlight_reasons" USING btree ("highlight_id","feature_key");--> statement-breakpoint
CREATE INDEX "brief_highlight_reasons_feature_idx" ON "brief_highlight_reasons" USING btree ("feature_key");--> statement-breakpoint
CREATE UNIQUE INDEX "brief_highlights_brief_ordinal_uidx" ON "brief_highlights" USING btree ("brief_id","ordinal");--> statement-breakpoint
CREATE INDEX "brief_highlights_owner_new_idx" ON "brief_highlights" USING btree ("owner_user_id","relevance_score" DESC NULLS LAST) WHERE "brief_highlights"."status" = 'new';--> statement-breakpoint
CREATE INDEX "brief_highlights_owner_topic_idx" ON "brief_highlights" USING btree ("owner_user_id","topic_key");--> statement-breakpoint
CREATE INDEX "brief_scan_runs_run_idx" ON "brief_scan_runs" USING btree ("scan_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "briefs_subscription_period_uidx" ON "briefs" USING btree ("subscription_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "briefs_owner_generated_idx" ON "briefs" USING btree ("owner_user_id","generated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "briefs_owner_unseen_idx" ON "briefs" USING btree ("owner_user_id","generated_at" DESC NULLS LAST) WHERE "briefs"."status" = 'ready' AND "briefs"."seen_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_event_attendees_event_email_uidx" ON "calendar_event_attendees" USING btree ("calendar_event_id","email");--> statement-breakpoint
CREATE INDEX "calendar_event_attendees_person_idx" ON "calendar_event_attendees" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_owner_cal_event_uidx" ON "calendar_events" USING btree ("owner_user_id","calendar_id","external_event_id");--> statement-breakpoint
CREATE INDEX "calendar_events_owner_starts_idx" ON "calendar_events" USING btree ("owner_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "calendar_events_owner_day_idx" ON "calendar_events" USING btree ("owner_user_id","local_day");--> statement-breakpoint
CREATE INDEX "calendar_events_opportunity_idx" ON "calendar_events" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "calendar_events_missed_idx" ON "calendar_events" USING btree ("owner_user_id","starts_at" DESC NULLS LAST) WHERE "calendar_events"."attendance" = 'missed';--> statement-breakpoint
CREATE UNIQUE INDEX "canvas_lines_run_key_uidx" ON "canvas_lines" USING btree ("sync_run_id","line_key");--> statement-breakpoint
CREATE INDEX "canvas_lines_activity_idx" ON "canvas_lines" USING btree ("activity_entry_id");--> statement-breakpoint
CREATE INDEX "canvas_lines_dc_request_idx" ON "canvas_lines" USING btree ("dc_request_id");--> statement-breakpoint
CREATE INDEX "canvas_sync_runs_canvas_started_idx" ON "canvas_sync_runs" USING btree ("canvas_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "canvases_owner_external_uidx" ON "canvases" USING btree ("owner_user_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "change_proposals_pending_field_uidx" ON "change_proposals" USING btree ("entity_type","entity_id","field") WHERE "change_proposals"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "change_proposals_owner_pending_idx" ON "change_proposals" USING btree ("owner_user_id","created_at" DESC NULLS LAST) WHERE "change_proposals"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "change_proposals_group_idx" ON "change_proposals" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "change_sets_owner_created_idx" ON "change_sets" USING btree ("owner_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "change_sets_undo_stack_idx" ON "change_sets" USING btree ("owner_user_id","actor_kind","created_at" DESC NULLS LAST) WHERE "change_sets"."undoable" AND "change_sets"."undone_at" IS NULL;--> statement-breakpoint
CREATE INDEX "change_sets_entity_idx" ON "change_sets" USING btree ("entity_type","entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "change_sets_open_burst_uidx" ON "change_sets" USING btree ("editor_session_id","entity_type","entity_id") WHERE "change_sets"."kind" = 'autosave_burst' AND "change_sets"."closed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_account_maps_channel_account_uidx" ON "channel_account_maps" USING btree ("channel_id","account_id");--> statement-breakpoint
CREATE INDEX "channel_account_maps_account_idx" ON "channel_account_maps" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_owner_system_external_uidx" ON "channels" USING btree ("owner_user_id","system","external_id");--> statement-breakpoint
CREATE INDEX "channels_owner_watch_idx" ON "channels" USING btree ("owner_user_id","watch_mode");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_thread_seq_uidx" ON "chat_messages" USING btree ("thread_id","seq");--> statement-breakpoint
CREATE INDEX "chat_threads_owner_last_idx" ON "chat_threads" USING btree ("owner_user_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "chat_tool_calls_message_tool_use_uidx" ON "chat_tool_calls" USING btree ("message_id","tool_use_id");--> statement-breakpoint
CREATE INDEX "chat_tool_calls_change_set_idx" ON "chat_tool_calls" USING btree ("change_set_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claude_session_segments_session_ordinal_uidx" ON "claude_session_segments" USING btree ("claude_session_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "claude_sessions_owner_external_uidx" ON "claude_sessions" USING btree ("owner_user_id","session_external_id") WHERE "claude_sessions"."session_external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "claude_sessions_owner_status_idx" ON "claude_sessions" USING btree ("owner_user_id","status","last_activity_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "claude_sessions_repo_idx" ON "claude_sessions" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "claude_sessions_launch_work_item_idx" ON "claude_sessions" USING btree ("launch_work_item_id");--> statement-breakpoint
CREATE INDEX "connector_auth_events_connector_occurred_idx" ON "connector_auth_events" USING btree ("connector_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "connector_health_checks_connector_checked_idx" ON "connector_health_checks" USING btree ("connector_id","checked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "connectors_owner_kind_name_uidx" ON "connectors" USING btree ("owner_user_id","kind","name");--> statement-breakpoint
CREATE INDEX "connectors_owner_unhealthy_idx" ON "connectors" USING btree ("owner_user_id") WHERE "connectors"."status" <> 'healthy';--> statement-breakpoint
CREATE UNIQUE INDEX "content_revisions_entity_field_revision_uidx" ON "content_revisions" USING btree ("entity_type","entity_id","field","revision");--> statement-breakpoint
CREATE INDEX "content_revisions_entity_saved_idx" ON "content_revisions" USING btree ("entity_type","entity_id","last_saved_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "content_revisions_open_burst_uidx" ON "content_revisions" USING btree ("entity_type","entity_id","field","editor_session_id") WHERE "content_revisions"."closed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "deal_contribution_requests_live_uidx" ON "deal_contribution_requests" USING btree ("owner_user_id","opportunity_id","role") WHERE "deal_contribution_requests"."status" <> 'dismissed';--> statement-breakpoint
CREATE UNIQUE INDEX "deal_contributions_owner_dc_uidx" ON "deal_contributions" USING btree ("owner_user_id","org62_dc_id");--> statement-breakpoint
CREATE INDEX "deal_contributions_opportunity_idx" ON "deal_contributions" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "deal_contributions_mine_idx" ON "deal_contributions" USING btree ("owner_user_id") WHERE "deal_contributions"."is_mine";--> statement-breakpoint
CREATE INDEX "deliverable_judgments_deliverable_judged_idx" ON "deliverable_judgments" USING btree ("deliverable_id","judged_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "deliverable_requirements_deliverable_ordinal_uidx" ON "deliverable_requirements" USING btree ("deliverable_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_recipients_draft_role_address_uidx" ON "draft_recipients" USING btree ("draft_id","role","address");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_renditions_draft_version_format_uidx" ON "draft_renditions" USING btree ("draft_id","doc_version","format");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_send_attempts_draft_attempt_uidx" ON "draft_send_attempts" USING btree ("draft_id","attempt_no");--> statement-breakpoint
CREATE INDEX "draft_verifications_draft_idx" ON "draft_verifications" USING btree ("draft_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "draft_verifications_due_idx" ON "draft_verifications" USING btree ("next_check_at") WHERE "draft_verifications"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_idempotency_key_uidx" ON "drafts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "drafts_owner_status_idx" ON "drafts" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "drafts_work_item_idx" ON "drafts" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "drafts_nba_idx" ON "drafts" USING btree ("nba_id");--> statement-breakpoint
CREATE INDEX "drafts_scheduled_idx" ON "drafts" USING btree ("scheduled_for") WHERE "drafts"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "drafts_awaiting_verify_idx" ON "drafts" USING btree ("owner_user_id","updated_at") WHERE "drafts"."status" IN ('sent', 'staged', 'handed_off', 'unconfirmed');--> statement-breakpoint
CREATE UNIQUE INDEX "extraction_candidates_item_extractor_ordinal_uidx" ON "extraction_candidates" USING btree ("source_item_id","extractor_id","ordinal");--> statement-breakpoint
CREATE INDEX "extraction_candidates_open_idx" ON "extraction_candidates" USING btree ("owner_user_id","decision","created_at") WHERE "extraction_candidates"."decision" IN ('pending', 'needs_triage');--> statement-breakpoint
CREATE INDEX "extraction_candidates_work_item_idx" ON "extraction_candidates" USING btree ("work_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "extractors_key_version_uidx" ON "extractors" USING btree ("key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_periods_pack_fy_q_uidx" ON "fiscal_periods" USING btree ("team_pack_id","fiscal_year","fiscal_quarter");--> statement-breakpoint
CREATE INDEX "initiative_links_asset_idx" ON "initiative_links" USING btree ("asset_id") WHERE "initiative_links"."asset_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "initiative_links_session_idx" ON "initiative_links" USING btree ("claude_session_id") WHERE "initiative_links"."claude_session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "initiatives_owner_status_idx" ON "initiatives" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "initiatives_opportunity_idx" ON "initiatives" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "initiatives_title_trgm_idx" ON "initiatives" USING gin (lower(title) gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "job_schedules_owner_key_uidx" ON "job_schedules" USING btree ("owner_user_id","key");--> statement-breakpoint
CREATE INDEX "job_schedules_due_idx" ON "job_schedules" USING btree ("next_run_at") WHERE "job_schedules"."enabled" AND "job_schedules"."paused_reason" IS NULL;--> statement-breakpoint
CREATE INDEX "jobs_dequeue_idx" ON "jobs" USING btree ("queue","priority" DESC NULLS LAST,"run_at","id") WHERE "jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "jobs_lease_idx" ON "jobs" USING btree ("lease_expires_at") WHERE "jobs"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_queued_uidx" ON "jobs" USING btree ("dedupe_key") WHERE "jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "jobs_dedupe_running_idx" ON "jobs" USING btree ("dedupe_key") WHERE "jobs"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_uidx" ON "jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_owner_kind_created_idx" ON "jobs" USING btree ("owner_user_id","kind","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_dead_letter_idx" ON "jobs" USING btree ("owner_user_id","dead_at" DESC NULLS LAST) WHERE "jobs"."status" = 'dead';--> statement-breakpoint
CREATE INDEX "llm_calls_owner_day_idx" ON "llm_calls" USING btree ("owner_user_id","budget_day");--> statement-breakpoint
CREATE INDEX "llm_calls_scan_run_idx" ON "llm_calls" USING btree ("scan_run_id") WHERE "llm_calls"."scan_run_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "llm_calls_purpose_started_idx" ON "llm_calls" USING btree ("purpose","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "llm_calls_request_hash_idx" ON "llm_calls" USING btree ("request_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "mapping_rules_owner_kind_pattern_uidx" ON "mapping_rules" USING btree ("owner_user_id","kind","pattern");--> statement-breakpoint
CREATE INDEX "mapping_rules_owner_kind_priority_idx" ON "mapping_rules" USING btree ("owner_user_id","kind","priority") WHERE "mapping_rules"."enabled";--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_notes_source_item_uidx" ON "meeting_notes" USING btree ("source_item_id");--> statement-breakpoint
CREATE INDEX "meeting_notes_event_idx" ON "meeting_notes" USING btree ("calendar_event_id");--> statement-breakpoint
CREATE INDEX "meeting_notes_unmatched_idx" ON "meeting_notes" USING btree ("owner_user_id","arrived_at" DESC NULLS LAST) WHERE "meeting_notes"."calendar_event_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "missed_opp_findings_owner_opp_uidx" ON "missed_opp_findings" USING btree ("owner_user_id","opportunity_id");--> statement-breakpoint
CREATE INDEX "missed_opp_findings_owner_status_idx" ON "missed_opp_findings" USING btree ("owner_user_id","status","tier");--> statement-breakpoint
CREATE UNIQUE INDEX "next_best_actions_item_version_uidx" ON "next_best_actions" USING btree ("work_item_id","nba_version");--> statement-breakpoint
CREATE UNIQUE INDEX "next_best_actions_one_live_uidx" ON "next_best_actions" USING btree ("work_item_id") WHERE "next_best_actions"."status" IN ('ready', 'needs_input', 'stale', 'accepted', 'executing');--> statement-breakpoint
CREATE INDEX "next_best_actions_owner_status_idx" ON "next_best_actions" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_live_dedupe_uidx" ON "notifications" USING btree ("owner_user_id","dedupe_key") WHERE "notifications"."status" IN ('open', 'seen', 'snoozed');--> statement-breakpoint
CREATE INDEX "notifications_owner_live_idx" ON "notifications" USING btree ("owner_user_id","severity","created_at" DESC NULLS LAST) WHERE "notifications"."status" IN ('open', 'seen', 'snoozed');--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_owner_org62_uidx" ON "opportunities" USING btree ("owner_user_id","org62_opportunity_id");--> statement-breakpoint
CREATE INDEX "opportunities_account_idx" ON "opportunities" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "opportunities_owner_open_close_idx" ON "opportunities" USING btree ("owner_user_id","close_date") WHERE NOT "opportunities"."is_closed";--> statement-breakpoint
CREATE INDEX "opportunities_name_trgm_idx" ON "opportunities" USING gin (lower(name) gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_snapshots_opp_captured_uidx" ON "opportunity_snapshots" USING btree ("opportunity_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_team_members_opp_user_role_uidx" ON "opportunity_team_members" USING btree ("opportunity_id","org62_user_id","team_role");--> statement-breakpoint
CREATE INDEX "opportunity_team_members_person_idx" ON "opportunity_team_members" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org62_events_owner_event_uidx" ON "org62_events" USING btree ("owner_user_id","org62_event_id");--> statement-breakpoint
CREATE INDEX "org62_events_owner_starts_idx" ON "org62_events" USING btree ("owner_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "org62_events_owner_subject_start_idx" ON "org62_events" USING btree ("owner_user_id","subject","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "org62_picklist_values_pack_field_value_uidx" ON "org62_picklist_values" USING btree ("team_pack_id","field","value");--> statement-breakpoint
CREATE UNIQUE INDEX "people_owner_me_uidx" ON "people" USING btree ("owner_user_id") WHERE "people"."is_me";--> statement-breakpoint
CREATE INDEX "people_account_idx" ON "people" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "people_name_trgm_idx" ON "people" USING gin (lower(display_name) gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "person_identities_owner_system_external_uidx" ON "person_identities" USING btree ("owner_user_id","system","external_id");--> statement-breakpoint
CREATE INDEX "person_identities_person_idx" ON "person_identities" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "priority_plan_steps_run_ordinal_uidx" ON "priority_plan_steps" USING btree ("run_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "priority_policies_owner_version_uidx" ON "priority_policies" USING btree ("owner_user_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "priority_policies_owner_active_uidx" ON "priority_policies" USING btree ("owner_user_id") WHERE "priority_policies"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "priority_policy_rules_policy_key_uidx" ON "priority_policy_rules" USING btree ("policy_id","rule_key");--> statement-breakpoint
CREATE UNIQUE INDEX "priority_policy_rules_policy_ordinal_uidx" ON "priority_policy_rules" USING btree ("policy_id","ordinal");--> statement-breakpoint
CREATE INDEX "priority_runs_owner_finished_idx" ON "priority_runs" USING btree ("owner_user_id","finished_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "priority_score_rule_hits_score_rule_uidx" ON "priority_score_rule_hits" USING btree ("score_id","rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "priority_scores_run_item_uidx" ON "priority_scores" USING btree ("run_id","work_item_id");--> statement-breakpoint
CREATE INDEX "priority_scores_item_computed_idx" ON "priority_scores" USING btree ("work_item_id","computed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "provenance_links_nba_idx" ON "provenance_links" USING btree ("nba_id") WHERE "provenance_links"."nba_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "provenance_links_draft_idx" ON "provenance_links" USING btree ("draft_id") WHERE "provenance_links"."draft_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "provenance_links_activity_idx" ON "provenance_links" USING btree ("activity_entry_id") WHERE "provenance_links"."activity_entry_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "provenance_links_finding_idx" ON "provenance_links" USING btree ("missed_opp_finding_id") WHERE "provenance_links"."missed_opp_finding_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "provenance_links_brief_idx" ON "provenance_links" USING btree ("brief_id") WHERE "provenance_links"."brief_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "provenance_links_highlight_idx" ON "provenance_links" USING btree ("brief_highlight_id") WHERE "provenance_links"."brief_highlight_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "provenance_links_source_item_idx" ON "provenance_links" USING btree ("source_item_id");--> statement-breakpoint
CREATE INDEX "reauth_attempts_connector_requested_idx" ON "reauth_attempts" USING btree ("connector_id","requested_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reconcile_findings_owner_open_idx" ON "reconcile_findings" USING btree ("owner_user_id","kind") WHERE "reconcile_findings"."status" = 'open';--> statement-breakpoint
CREATE INDEX "reconcile_findings_source_item_idx" ON "reconcile_findings" USING btree ("source_item_id");--> statement-breakpoint
CREATE INDEX "relevance_feedback_owner_created_idx" ON "relevance_feedback" USING btree ("owner_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reopen_decisions_done_item_idx" ON "reopen_decisions" USING btree ("done_work_item_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "repos_owner_path_uidx" ON "repos" USING btree ("owner_user_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "role_templates_key_version_uidx" ON "role_templates" USING btree ("key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "scan_cursors_connector_scope_uidx" ON "scan_cursors" USING btree ("connector_id","scope");--> statement-breakpoint
CREATE INDEX "scan_ledger_entries_scope_from_idx" ON "scan_ledger_entries" USING btree ("connector_id","scope","covered_from");--> statement-breakpoint
CREATE INDEX "scan_ledger_entries_object_idx" ON "scan_ledger_entries" USING btree ("object_kind","object_external_id");--> statement-breakpoint
CREATE INDEX "scan_ledger_entries_covered_gist_idx" ON "scan_ledger_entries" USING gist ("connector_id","scope","covered");--> statement-breakpoint
CREATE INDEX "scan_ledger_entries_run_idx" ON "scan_ledger_entries" USING btree ("scan_run_id");--> statement-breakpoint
CREATE INDEX "scan_runs_connector_started_idx" ON "scan_runs" USING btree ("connector_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scan_runs_owner_started_idx" ON "scan_runs" USING btree ("owner_user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "se_task_types_pack_name_uidx" ON "se_task_types" USING btree ("team_pack_id","name");--> statement-breakpoint
CREATE INDEX "source_item_links_account_idx" ON "source_item_links" USING btree ("account_id") WHERE "source_item_links"."account_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "source_item_links_opportunity_idx" ON "source_item_links" USING btree ("opportunity_id") WHERE "source_item_links"."opportunity_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "source_item_links_person_idx" ON "source_item_links" USING btree ("person_id") WHERE "source_item_links"."person_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "source_item_links_asset_idx" ON "source_item_links" USING btree ("asset_id") WHERE "source_item_links"."asset_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "source_item_links_event_idx" ON "source_item_links" USING btree ("calendar_event_id") WHERE "source_item_links"."calendar_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "source_item_links_unconfirmed_idx" ON "source_item_links" USING btree ("confidence") WHERE "source_item_links"."user_verdict" IS NULL AND "source_item_links"."method" = 'llm';--> statement-breakpoint
CREATE UNIQUE INDEX "source_item_refs_item_kind_value_uidx" ON "source_item_refs" USING btree ("source_item_id","kind","value");--> statement-breakpoint
CREATE INDEX "source_item_refs_kind_value_idx" ON "source_item_refs" USING btree ("kind","value");--> statement-breakpoint
CREATE UNIQUE INDEX "source_items_owner_dedupe_key_uidx" ON "source_items" USING btree ("owner_user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "source_items_owner_source_external_idx" ON "source_items" USING btree ("owner_user_id","source","external_id");--> statement-breakpoint
CREATE INDEX "source_items_thread_idx" ON "source_items" USING btree ("owner_user_id","source","external_parent_id","occurred_at");--> statement-breakpoint
CREATE INDEX "source_items_my_thread_replies_idx" ON "source_items" USING btree ("owner_user_id","external_parent_id","occurred_at") WHERE "source_items"."from_me";--> statement-breakpoint
CREATE INDEX "source_items_inbound_to_me_idx" ON "source_items" USING btree ("owner_user_id","occurred_at" DESC NULLS LAST) WHERE "source_items"."addressed_to_me" AND NOT "source_items"."from_me";--> statement-breakpoint
CREATE INDEX "source_items_owner_kind_occurred_idx" ON "source_items" USING btree ("owner_user_id","kind","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "source_items_body_expiry_idx" ON "source_items" USING btree ("body_expires_at") WHERE "source_items"."body" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "source_items_search_tsv_idx" ON "source_items" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "source_items_actor_idx" ON "source_items" USING btree ("actor_person_id");--> statement-breakpoint
CREATE INDEX "source_items_asset_idx" ON "source_items" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "source_items_channel_idx" ON "source_items" USING btree ("channel_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "task_capture_rules_owner_key_uidx" ON "task_capture_rules" USING btree ("owner_user_id","rule_key");--> statement-breakpoint
CREATE INDEX "task_capture_rules_owner_ordinal_idx" ON "task_capture_rules" USING btree ("owner_user_id","ordinal") WHERE "task_capture_rules"."enabled";--> statement-breakpoint
CREATE UNIQUE INDEX "team_packs_slug_version_uidx" ON "team_packs" USING btree ("slug","version");--> statement-breakpoint
CREATE UNIQUE INDEX "team_rules_pack_key_uidx" ON "team_rules" USING btree ("team_pack_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "time_blocks_owner_dedupe_uidx" ON "time_blocks" USING btree ("owner_user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "time_blocks_owner_starts_idx" ON "time_blocks" USING btree ("owner_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "time_blocks_owner_day_idx" ON "time_blocks" USING btree ("owner_user_id","local_day");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_adapters_owner_key_uidx" ON "tool_adapters" USING btree ("owner_user_id","key");--> statement-breakpoint
CREATE INDEX "tool_run_outputs_run_idx" ON "tool_run_outputs" USING btree ("tool_run_id");--> statement-breakpoint
CREATE INDEX "tool_runs_owner_status_idx" ON "tool_runs" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "tool_runs_work_item_idx" ON "tool_runs" USING btree ("work_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_interests_owner_kind_value_uidx" ON "user_interests" USING btree ("owner_user_id","kind",lower(value));--> statement-breakpoint
CREATE UNIQUE INDEX "vdp_records_owner_slug_uidx" ON "vdp_records" USING btree ("owner_user_id","vdp_slug");--> statement-breakpoint
CREATE INDEX "vdp_records_opportunity_idx" ON "vdp_records" USING btree ("opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_profiles_owner_version_uidx" ON "voice_profiles" USING btree ("owner_user_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_profiles_owner_active_uidx" ON "voice_profiles" USING btree ("owner_user_id") WHERE "voice_profiles"."status" = 'active';--> statement-breakpoint
CREATE INDEX "watch_subscriptions_owner_enabled_idx" ON "watch_subscriptions" USING btree ("owner_user_id") WHERE "watch_subscriptions"."enabled";--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_deliverables_item_asset_uidx" ON "work_item_deliverables" USING btree ("work_item_id","asset_id") WHERE "work_item_deliverables"."asset_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "work_item_deliverables_asset_idx" ON "work_item_deliverables" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "work_item_evidence_source_item_idx" ON "work_item_evidence" USING btree ("source_item_id") WHERE "work_item_evidence"."source_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "work_item_evidence_snapshot_idx" ON "work_item_evidence" USING btree ("asset_snapshot_id") WHERE "work_item_evidence"."asset_snapshot_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "work_item_evidence_diff_idx" ON "work_item_evidence" USING btree ("asset_diff_id") WHERE "work_item_evidence"."asset_diff_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "work_item_evidence_item_role_idx" ON "work_item_evidence" USING btree ("work_item_id","role");--> statement-breakpoint
CREATE INDEX "work_item_links_claude_session_idx" ON "work_item_links" USING btree ("claude_session_id") WHERE "work_item_links"."claude_session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "work_item_links_asset_idx" ON "work_item_links" USING btree ("asset_id") WHERE "work_item_links"."asset_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "work_item_links_event_idx" ON "work_item_links" USING btree ("calendar_event_id") WHERE "work_item_links"."calendar_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "work_item_links_tool_run_idx" ON "work_item_links" USING btree ("tool_run_id") WHERE "work_item_links"."tool_run_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "work_item_links_person_idx" ON "work_item_links" USING btree ("person_id") WHERE "work_item_links"."person_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_relations_from_to_kind_uidx" ON "work_item_relations" USING btree ("from_work_item_id","to_work_item_id","kind");--> statement-breakpoint
CREATE INDEX "work_item_relations_to_idx" ON "work_item_relations" USING btree ("to_work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_transitions_item_occurred_idx" ON "work_item_transitions" USING btree ("work_item_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "work_item_transitions_auto_done_idx" ON "work_item_transitions" USING btree ("occurred_at" DESC NULLS LAST) WHERE "work_item_transitions"."to_status" = 'done' AND "work_item_transitions"."actor_kind" = 'engine';--> statement-breakpoint
CREATE INDEX "work_items_owner_status_idx" ON "work_items" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "work_items_home_lane_rank_idx" ON "work_items" USING btree ("owner_user_id","priority_lane","priority_rank") WHERE "work_items"."status" IN ('open', 'in_progress', 'waiting_on_me', 'likely_done');--> statement-breakpoint
CREATE INDEX "work_items_triage_idx" ON "work_items" USING btree ("owner_user_id","created_at") WHERE "work_items"."status" = 'suggested';--> statement-breakpoint
CREATE INDEX "work_items_snooze_wake_idx" ON "work_items" USING btree ("snoozed_until") WHERE "work_items"."status" = 'snoozed';--> statement-breakpoint
CREATE INDEX "work_items_open_due_idx" ON "work_items" USING btree ("owner_user_id","due_at") WHERE "work_items"."status" NOT IN ('done', 'dismissed', 'merged');--> statement-breakpoint
CREATE INDEX "work_items_deadline_event_idx" ON "work_items" USING btree ("deadline_event_id") WHERE "work_items"."deadline_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "work_items_opportunity_idx" ON "work_items" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "work_items_account_idx" ON "work_items" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "work_items_counterparty_idx" ON "work_items" USING btree ("counterparty_person_id");--> statement-breakpoint
CREATE INDEX "work_items_parent_idx" ON "work_items" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "work_items_initiative_idx" ON "work_items" USING btree ("initiative_id","status");--> statement-breakpoint
CREATE INDEX "work_items_new_info_idx" ON "work_items" USING btree ("owner_user_id","last_new_info_at" DESC NULLS LAST) WHERE "work_items"."last_new_info_at" IS NOT NULL AND ("work_items"."seen_by_user_at" IS NULL OR "work_items"."last_new_info_at" > "work_items"."seen_by_user_at");--> statement-breakpoint
CREATE INDEX "work_items_title_trgm_idx" ON "work_items" USING gin (lower(title) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "work_items_search_tsv_idx" ON "work_items" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "worker_instances_last_beat_idx" ON "worker_instances" USING btree ("last_beat_at" DESC NULLS LAST);