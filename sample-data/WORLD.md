# World: who, when, how big, who builds what

Read `BRIEF.md` first (privacy rules, mechanics). This file fixes the shared facts so independently written
generators join up. `CAST.md` (written by the core generator) names every person, account, opportunity and storyline key.

## The owner and the moment
- One app user: a fictional **Solutions Engineer** ("SE" persona, `src/personas`), Mountain Time, fiscal calendar where
  Nov–Jan is Q4 (FY27 Q4 right now). Manager, a paired Account Executive (AE) per deal, a few SE peers, a Data/AI
  specialist, customer champions and executives (invented, `@<customer>.example`).
- "Now" is **Wed 2026-11-18 09:00 MST**. History 2026-10-19 → now; calendar to 2026-11-25. The app has been scanning
  for about 30 days (ramp: first scan 24h → 30d), so older items are sparser than recent ones.
- The vendor sells a data + AI platform (Data 360, Agentforce); never name the employer.

## Domains, owners, order (generators run in this order; a later domain may read any earlier domain's JSON)
| # | file | tables |
|---|---|---|
| 01 | `01-core.ts` | users, people, person_identities, accounts, account_aliases, opportunities, opportunity_team_members, team_packs, role_templates, se_task_types, fiscal_periods, org62_picklist_values, channels, connectors, user_settings, repos, org62_use_cases, org62_use_case_reads, use_cases, specialist_forecasts, user_interests, channel_account_maps, mapping_rules, task_capture_rules, team_rules, vdp_server, autonomy_policies, voice_profiles, priority_policies, priority_policy_rules, role/team config of any kind |
| 02 | `02-sources.ts` | source_items, source_item_refs, source_item_links, calendar_events, calendar_event_attendees, meeting_notes, assets, asset_snapshots, asset_snapshot_sections, asset_snapshot_diffs, opportunity_snapshots, vdp_records, vdp_asset_candidates, org62_events |
| 03 | `03-ops.ts` | jobs, job_schedules, worker_instances, scan_runs, scan_run_events, scan_ledger_entries, scan_cursors, connector_health_checks, connector_auth_events, reauth_attempts, app_events, notifications, llm_budgets, llm_budget_days, llm_calls, llm_call_days, llm_decisions, llm_decision_days, audit_events, change_sets, content_revisions |
| 04 | `04-work.ts` | work_items, work_item_evidence, work_item_transitions, work_item_relations, work_item_links, work_item_deliverables, work_item_training_details, work_item_travel_details, deliverable_requirements, deliverable_judgments, extractors, extraction_candidates, change_proposals, reopen_decisions, initiatives, initiative_links, priority_runs, priority_plan_steps, priority_scores, priority_score_rule_hits, next_best_actions |
| 05 | `05-outbox-time.ts` | drafts, draft_recipients, draft_renditions, draft_send_attempts, draft_verifications, activity_entries, activity_entry_time_blocks, time_blocks, canvases, canvas_sync_runs, canvas_lines, record_landings, landing_writes, deal_contributions, deal_contribution_requests, missed_opp_sweeps, missed_opp_findings, claude_sessions, claude_session_segments, tool_adapters, tool_runs, tool_run_outputs |
| 06 | `06-intel-chat.ts` | briefs, brief_highlights, brief_highlight_reasons, brief_scan_runs, watch_subscriptions, relevance_feedback, relevance_weights, chat_threads, chat_messages, chat_tool_calls, provenance_links, reconcile_findings |

`work_item_degradations` is a view; `__drizzle_migrations` is migration bookkeeping. Skip both. Every other one of the
120 base tables belongs to exactly one row above; **no table may be left empty** unless its CAST/WORLD note says why
(then say so in the final report).

## Fixed id ranges (so earlier domains can point at later ones without `ref()`)
Domain 03 guarantees these rows exist; any domain may reference them directly:
- `scan_runs`: `uid('scan_runs', n)` for n = 1..160 (runs are ordered by time; low n = oldest). Each run belongs to a connector.
- `jobs` (bigint): ids 1..500. `llm_calls` (bigint): ids 1..700. `change_sets`: `uid('change_sets', n)` for n = 1..500
  (the app writes every change through a change set: actor kinds user, engine, connector, chat, system).
Domain 02 guarantees `source_items` keys `si-001`…`si-NNN` (contiguous, count in its report/CAST addendum).
Domain 04 guarantees `work_items` keys `wi-001`…`wi-NNN`. Everything else: read the earlier JSON or use `ref()`.

## Volumes (floor; go higher where the story needs it)
users 1 · people ~45 · person_identities ~90 · accounts ~14 (≥2 families) · opportunities ~50 (open and closed) ·
opportunity_team_members ~70 · channels ~16 · connectors 9 · user_settings every key the app writes (see shapes) ·
source_items ~450 · calendar_events ~140 (+ attendees ~500) · meeting_notes ~30 · assets ~120 · vdp_records ~12 ·
jobs 500 · scan_runs 160 · scan_run_events ~1,200 · scan_ledger_entries ~1,500 · app_events ~150 · llm_calls 700 ·
change_sets 500 · audit_events ~1,500 · work_items ~100 (+ evidence ~380, transitions ~220) · next_best_actions ~60 ·
drafts ~90 (+ renditions, recipients, verifications, send attempts) · activity_entries ~120 · time_blocks ~250 ·
claude_sessions ~30 · briefs 8 (+ highlights ~30) · chat_threads 6 (+ messages ~60) · reconcile_findings ~40 ·
provenance_links ~120. Small config/log tables: at least 3 rows, ideally 5–15.

## Storylines every domain should help realize (CAST.md assigns each to accounts, people and keys)
1. **Hot deal:** Data 360 + Agentforce proof of concept for a health plan; heavy Slack/email/meetings; a solution blueprint due Friday; VDP exists but is missing items.
2. **Expansion demo:** retailer renewal; AE asks the SE for a demo in Slack; a reply draft waits in the Outbox, unapproved.
3. **Gone quiet:** a deal with overdue next steps and an at-risk signal; work items aging; a nudge draft expired.
4. **Account family:** parent + two subsidiaries (company-identity judgment for VDP, aliases, mapping rules).
5. **Missed opportunity:** work the owner did on an opp where they are not on the team → missed-opp finding → deal-contribution (DC) request pending on a logging canvas.
6. **Training and travel:** mandatory training due; a customer onsite with travel details; calendar holds.
7. **Time logging:** internal meetings and customer work logged to Org62 via activity entries; statuses proposed → verified → logged; one `needs_input`; one deleted-in-Org62 case; a logging canvas batch.
8. **Pipeline failures:** a connector degraded then healthy again; auth expiry + reauth attempt; Slack rate limit; one day hitting the LLM budget hard cap; dead-lettered jobs; failed scan runs mostly transient.
9. **Auto-close then reopen:** the engine closes finished work; a late reply reopens it (reopen_decisions).
10. **Identity mess:** one person under two identities (Slack + email) merged; an external contact with no account yet.
11. **Claude sessions:** the owner builds a demo with Claude; tool runs; session segments → time blocks (engaged time, not run time).
12. **Meeting → work:** Gemini notes → extraction candidates → change proposals → new work items with evidence.
13. **Priorities:** today's priority run, Top 3 with rule hits, plan steps around calendar conflicts; capacity looks realistic, never "overbooked".
14. **Briefs and watches:** weekly brief with must-read/worth-a-look highlights for a watched account; relevance feedback.
15. **Chat:** the owner asks the assistant what is due this week; tool calls; a read-in of a thread.
16. **VDP assets:** candidate assets found across Drive/Slack/Gmail with keep / unsure / drop screening; recordings rare.
17. **Drafts lifecycle:** drafted → edited → approved → sent → verified; one rejected; one superseded; one send attempt that failed and retried.
18. **Noise:** newsletters, bot posts, ignored items, watches; relevance learning from dismissals.
19. **Org62 events:** activity logs created, one deleted remotely, picklist/task-type mapping.
20. **Specialist view:** a couple of `specialist_forecasts` rows only if the schema allows without a second persona; otherwise skip and say so.
