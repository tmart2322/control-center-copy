# Scanner spec (binding for BE-1, BE-2 and BE-3)

**Status:** v1, 2026-11-05. The orchestrator owns this file. It implements R-BE-2…4 as the owner described them. Where it differs from research brief 09, **this file wins**. Brief 09 is still the reference for measured costs, tool names, auth and the restricted-MCP technique: `~/Projects/control-center/docs/research/09-headless-sources-spike.md`.

## 1. What the owner asked for

The scanner is mostly **Haiku**, driven by **very prescriptive skills**. Each skill says exactly how to traverse its app, find new information, and **record it against the right thing in the database**.

The scanner:
- knows **when it last scanned and what it scanned**, so it can resume, notice misses, and fix things that weren't connected;
- runs **as part of the app** (the worker), not as a scheduled Claude task;
- is often up, and **when it restarts, it picks up where it left off**.

Smarter work (NBA, drafts) uses a higher tier.

## 2. Shape

```
worker (always-on Node process, part of the app)
 └─ Scheduler ── due? ──► ScanJob(connector, scope)   (Postgres job queue, one active job per connector)
                           │
                           ├─ 1. Context pack (deterministic): cursor, coverage gaps, watch list,
                           │     account/channel alias map, compact digest of OPEN items + initiatives
                           │
                           ├─ 2. Fetch
                           │     • traversal sources (Slack, Org62): the Haiku agent calls the source's READ tools itself
                           │     • deterministic sources (Gmail/Calendar/Drive via devbar google_workspace_readonly,
                           │       Claude sessions via local files): code fetches; the agent gets normalized items
                           │
                           ├─ 3. Haiku scanner agent (Agent SDK, skill = skills/scan-<source>.md)
                           │     tools = that source's read tools (traversal sources only) + in-process `cc` tools
                           │     records everything through `cc` tools (validated, audited, idempotent)
                           │
                           ├─ 4. Commit: coverage + cursor advance in ONE transaction (only on success)
                           │
                           └─ 5. Fan-out: each touched work item → enqueue reevaluate(item) (BE-3; generation/cancel)
```

### 2.1 Why the fetch is hybrid

Slack and Org62 need **judgment while traversing**:
- which threads to open;
- whether to follow a link to a Drive file or email;
- when a thread reply is a completion signal;
- which opp changed in a way that matters.

So the Haiku agent drives those tools, as the owner described. The Google sources and Claude sessions have no OAuth hop through Claude. Listing "changed since the cursor" there is mechanical, so code fetches them, which is cheaper and exact. The **same skill-driven Haiku agent** still does the reading, extraction and linking for every source. No source bypasses the agent's judgment about what the information means and where it belongs.

## 3. The `cc` tools: how the agent writes to the database

These are in-process MCP tools (`createSdkMcpServer`) in `src/llm/cc-tools/`.
- Every input is **zod-validated**.
- Every write runs inside a **change set** (DATA-MODEL §3.3) with actor `scanner:<connector>`, so it's audited and undoable.
- Every write is **idempotent**, keyed by the source's dedupe key.

The agent never writes SQL and never sees other users' data.

| Tool | Purpose |
|---|---|
| `cc_get_context()` | Cursor, coverage gaps, watch list, alias maps, and a compact digest of open work items and initiatives (id, title, purpose, people, accounts, keywords, last evidence). Cached per run |
| `cc_record_source_items(items[])` | Upsert normalized raw items (source, external id, dedupe key, content hash, timestamps, author, permalink, redacted excerpt, raw payload ref). Returns `{id, isNew, changed}` |
| `cc_find_candidates({text, people, accounts, files, threadRefs})` | Ranked candidate work items and initiatives to link to (FTS + alias + thread/file joins) |
| `cc_link_evidence({workItemId, sourceItemId, role, confidence, reason})` | Role is one of `origin`, `progress`, `completion`, `context`, `contradiction`. **The scanner emits signals. It never sets item state.** BE-3's closure and state machine turn signals into transitions |
| `cc_propose_item({kind, title, purpose, due?, effort?, initiativeId?, accountId?, oppId?, evidence[], confidence})` | A new ask, commitment, follow-up, training or deliverable. `sure` lands open, `likely` lands open with a "new" badge, and `guess` goes to Triage (as `suggested`) |
| `cc_propose_initiative({...})` | Only when nothing matches and three or more items cluster |
| `cc_flag_unlinked({sourceItemId, reason, hints})` | Relevant but no confident home. Feeds reconcile (§6) and Triage mapping questions |
| `cc_report_coverage({windows[], objects[], notes})` | **What was scanned**: channel/thread ids with ts ranges, message ids, file ids with modifiedTime, SOQL windows. Written to the scan ledger |
| `cc_finish({cursor, summary, stats})` | Proposes the new cursor. **The worker commits cursor + coverage atomically after validating** that coverage spans up to the cursor |

Budget and safety guards:
- `maxTurns` per run;
- per-run cost cap;
- read-only tool allowlist;
- the run aborts on any attempt to call a non-allowlisted tool.

## 4. Skills: prescriptive and versioned

Each skill is a markdown file at `skills/scan-<source>.md` with a `version` in its frontmatter. The version is stored on every scan run and evidence row, so improved skills can trigger re-linking. Every skill **must** spell out:

1. **Scope:** exactly which objects to look at, for example Slack:
   - DMs and group DMs;
   - @mentions;
   - threads the owner is in;
   - his own messages;
   - channels on the watch list;
   - customer channels mapped to his accounts.
2. **Exact tool calls:** the tool names, parameters and query strings, with the cursor substituted (e.g. `from:<@me> after:<date>`, and how to page).
3. **Traversal rules:**
   - when to open a thread;
   - when to follow a link to Drive or Gmail (record a reference only, don't fetch, unless the skill says so);
   - depth limits;
   - what to skip (bots, noisy channels, unless watched).
4. **Extraction rules:**
   - what counts as an **ask of me**;
   - what counts as **my commitment**, with phrase patterns ("I'll", "I will", "let me", "on it", "will send", "by EOD");
   - what counts as a **completion signal** (my reply after an ask, "sent", "done", a file shared, a deck link);
   - what counts as a **requirements change** (reopen / new sibling, R-UI-20);
   - meeting takeaways and training notices.
5. **Linking rules:** how to pick the work item or initiative. **Handed-off items (R-UI-22):** if the candidate is resolved as `handed_off`, or my involvement is watcher or not involved, link new evidence as `context` only and propose nothing. **Exception:** a **direct ask of me** (DM, @mention or explicit question to me) gets a `loop_back` signal. Record it with `cc_link_evidence` role `origin` and reason prefix `loop_back:`. BE-3 then reopens the item or opens a sibling labeled "Looped back in". The candidate digest therefore includes `resolution` and `involvement`.
   1. thread/file join;
   2. people + account + keyword match from `cc_find_candidates`;
   3. otherwise propose, or flag unlinked.

   Include confidence wording.
6. **Redaction:** mask credential-like text before it goes into `cc_record_source_items`.
7. **Stop condition and coverage:** report exactly what was covered.
8. **Worked examples:** 3–5 real-shaped examples with placeholders, including a Slack promise later closed by email and a "said done in Slack → completion" case.

The required skills are:
- `scan-slack`
- `scan-org62` (opp changes on my accounts, my Solutions Events, DCs, and the missed-opp candidates for R-UI-14)
- `scan-gmail`
- `scan-calendar` (attendance: attended or missed, and meetings that just ended, which schedules the Gemini-notes poll)
- `scan-gemini-notes`
- `scan-drive` (forward sampling: digest per slide or section, diff, then "were the requested updates made" against each linked deliverable's `expected changes`, R-UI-15)
- `scan-claude-sessions` (registry status plus transcript tail; the `[cc:<id>]` tag links sessions the app launched)
- `scan-trainings`
- `scan-watch` (channel briefs input, R-UI-21)
- `triage-slack` (the Slack triage pass below; not a traversal)

### 4.10 Slack: record from the tool result, then triage (STRESS-2)

- **REC-1, record what the tools return.** For Slack traversal runs the runner (`src/llm/slack-rec.ts`) parses every search page, thread read and channel read the agent gets back. It records each message, deduped by channel and ts, before the model sees the result: a PostToolUse hook, with a stream fallback. Thread and channel reads are forced to the detailed format, because the concise one has no ts. The Run block says `slack.rec = auto`, and scan-slack 1.3.0 then makes no `cc_record_source_items` calls. The agent cites a message as `<channelId>:<ts>` wherever a `sourceItemId` is expected. An agent re-record of a recorded message returns the same id and keeps the verbatim version. Redaction (R6) and the 1000-character excerpt cap still apply. This adds no model cost: the agent no longer transcribes messages.
- **Triage pass.** After a successful Slack traversal, `src/scanner/triage/slack-triage.ts` selects every message recorded in the run that is to me, from me, or in a DM, group DM or thread I'm in. It drops trivial acknowledgements and emoji, and messages the traversal already proposed or linked; those stay as context. The selected messages are grouped by conversation, in time order, into batches of 10 that need a verdict, at most 12 batches per run. Each batch is one Haiku run of `skills/triage-slack.md`. It gets no Slack tools and only these cc tools: `cc_find_candidates`, `cc_link_evidence`, `cc_propose_item`, `cc_flag_unlinked` and `cc_triage_verdicts`. It does no recording, reports no coverage and makes no `cc_finish` call. It gives every listed message one verdict: `act` (proposed or linked), `noise` or `unsure`. The checklist and examples come from the real misses: indirect asks (a pasted error, "a PR you can merge"), group-DM asks, takeaways in group DMs, my promises in channel thread replies, and direct questions. It also lists the noise to leave alone: musings like "maybe we should…" or "it would be cool if…", asks of someone else, and thanks. Since 1.1.0 (TRI-1), each line carries its addressee: `→ me` for a 1:1 DM, an @-mention or my name, and `→ NAME (not me)` when the message opens with someone else's name or @-mention. Group-DM messages count as to me only when they mention me. In a group DM or channel, an ask is mine only if it addresses me. Chat pings, quick logistics, favors and agenda lines are noise. When torn between act and noise, the pass says `unsure`. Version 1.2.0 adds two more noise cases: live meeting chatter (a hand-off during a demo, "what is at 3pm?") and someone's status on their own blocker when they ask nothing of me.
- **Escalation.** `unsure` lines, and lines left with neither a verdict nor an outcome, go to Sonnet in the same conversation batches, with the first pass's reason. The verdict there is final: `act` or `noise`. When escalation is off, those lines are flagged unlinked instead, with reason `triage: unsure: …`. Writes are tagged in their reason (`triage:` / `escalate:`), and the runner returns per-pass stats (`passes`: runs, cost, messages, verdicts, proposed, linked). A triage failure never fails the traversal run.
- **Switches** (all on by default): `CC_SLACK_REC=0`, `CC_SLACK_TRIAGE=0` and `CC_SLACK_ESCALATE=0`. The spec fields are `autoRecord` and `triage`.
- **Context, addressees and carried verdicts (triage-slack 1.3.0, scan-slack 1.4.0).** See §4.11.

### 4.11 First-scan noise fixes (lane 5 of the settle plan)

A 30-day first scan passed every coverage check, but only 26% of its open items were real and live. These rules cut what creates the noise. Placeholder tests: `tests/stress/scanner-noise.test.ts`, `tests/stress/rec1-triage.test.ts`, `tests/stress/first-scan.test.ts`.

- **Order (FS-ORDER).** The first scan backfills oldest to newest with no head hour (§5.6), so an ask is recorded before the reply that settles it.
- **Triage sees the conversation (TRI-CTX).** Besides this run's lines, each conversation in a batch gets up to 6 earlier lines (before this run's first one) and up to 4 later replies from `source_items`, whatever run or window recorded them (`conversationLines`). They show as `context (earlier)`, never as `VERDICT`.
- **Addressee continuation (TRI-2).** Who a message is for is read over the conversation, not one message at a time: explicit addressing wins; an unaddressed reply right after someone addressed its author goes back to that person, and an unaddressed follow-on by the same author keeps that author's addressee. So a follow-on in someone else's two-way exchange shows `→ NAME (not me: continues their exchange)`, and a reply right after my message shows `→ me (replies to my message)`. 1:1 DMs are always between me and them.
- **Group asks (TRI-3).** `<!channel>`, `<!here>`, `<!everyone>` and lists (me among three or more @-mentions) show as `→ everyone` or `→ me and N others (a list)`. Settings ▸ Scanning decides what they become (below).
- **Carried verdicts (TRI-NOISE).** Each triage verdict is stored on its message (`source_items.meta.triage`; an edit replaces the meta, so an edited message is judged again). A later run treats a message an earlier run called noise, or one already linked by non-context evidence, as handled (`done: noise:earlier run`, `done: linked:earlier run`).
- **Skill rules.** An ask I clearly answered or delivered in the same thread or DM is not a new item (link my answer as `completion` to an open item, else nothing). My own asks of others are not my items. An unaddressed follow-on in someone else's exchange is theirs (checklist 3, worked example T3). `_scanner-common` 1.1.0: my clear answer in the ask's own thread or DM is `sure`, not `likely`; `cc_flag_unlinked` is for asks and commitments of mine only. Gemini notes 2: no keyword-only "Catch up:" items. Org62 1.5.0 and Calendar 2: "Get up to speed" and missed-meeting catch-ups only when switched on.
- **Enforced in the cc tools (`proposalGate`).** Whatever the model does: an `ask` whose origin is my own message is skipped (NOT-MINE); a group ask lands `guess` (Triage) under "Ask me", is skipped under "Ignore"; "Catch up…" (Gemini notes, Calendar) and "Get up to speed…" (Org62) proposals are skipped while their setting is off. A skipped proposal returns `{w: null, skipped: <why>}`.
- **Due dates (DUE-1).** A bare date (`2026-11-04`) is 17:00 in my timezone, and a date-time without a zone is read there too (`src/scanner/propose-rules.ts`). Before, it was UTC midnight: the evening before, so items were due before they were asked.
- **Due already past when found (PAST-1).** An item whose due date was more than 2 h past when it was first seen lands like DEEP-1, in Triage as "Still needed?", with the reason "Due 2026-10-20, already past when it was found: still needed?". Trainings keep TRAIN-1's rule.
- **Duplicates (DUP-1).** Besides an identical origin, a proposal is the item already there when its origin is in the same conversation (DM or group DM, else thread), from the same person (me for my commitments), and the titles share at least two words covering half of the shorter one (the person's name aside). Open items match at any age; done, dismissed and merged ones only within 14 days, and those get the new evidence as `context` only.
- **Completion pass over suggested items (CMP-SUG).** `completionItems` now includes `suggested`, so an ask already answered can be found settled without a click. The closure engine keeps a suggested item in Triage with the evidence attached; the Settle pass decides what closes.
- **People (PPL-1).** Recording resolves each author to a person: me; a known Slack or email identity; a directory email. A Slack author nobody knows yet gets a person row with the Slack identity, hidden from the directory (`synthetic`, like any referenced person outside it). `source_items.actor_person_id` was empty on every Slack item before.
- **Redaction (RED-1, tenet: Local data, privacy-safe logs).** Both redactors mask password-manager share links (1Password, Bitwarden Send, Keeper, One-Time Secret, Password Pusher, Privnote, LastPass, Dashlane) and login lines ("login: x / secret", "username: x" then "p: y" on the next line). A ref that redaction would change is never stored in `source_item_refs` nor passed on as a file ref. `scripts/db/scrub-credentials.ts` re-redacts existing rows: dry run by default (counts only), `--apply` writes one undoable change set.
- **Settings ▸ Scanning (SCAN-SET).** `settings.scanning`, read on every context and shown to the skills as `{{scan.channelAsks}}`, `{{scan.meetingCatchUps}}` and `{{scan.oppTeamCatchUps}}`:
  - asks to a whole channel or a list: **Ask me** (default, Triage), Treat as mine, Ignore;
  - missed-meeting catch-ups: **off**;
  - "Get up to speed" on opp-team adds: **off**;
  - "Where does this belong?": **only my asks and commitments** (default), anything unlinked, or never (§6).

### 4.9 Completion pass (CMP-1)

The scanning skills almost never emit `completion` (stress finding CMP-1, `docs/ui/STRESS.md`: 0–1 correct completion links per run against 10–11 expected, and rewording `scan-slack` did not move it). So completion is judged by a **separate pass, a model check per item**, after the scans. Code: `src/scanner/completion/`, the job `src/jobs/handlers/completion.ts`, the skill `skills/check-completion.md`.

1. **Candidates (deterministic, no model).** For each open item that is mine (open, in progress, waiting, likely done; involvement owner or contributor; not owned by someone else), the source items that **arrived since its last check** (first seen, or edited) and **happened after the ask**:

   | Relation | What | Strength |
   |---|---|---|
   | `same_thread` · `same_dm` · `same_email_thread` | the Slack thread, Slack DM or group DM, or Gmail thread of its non-context evidence | strong |
   | `to_asker` · `from_asker` | my message or email to the asker anywhere; the asker writing in one of those places or to me directly | medium |
   | `same_channel` · `context_thread` | my or the asker's message in the same channel; a thread the item has only context evidence in | medium |
   | `same_file` · `same_event` | a revision of, or a link to, a Drive file it references; its calendar event changing, or an event I scheduled with the asker | medium |
   | `same_account` | my message on its account that shares two title keywords | weak |

   Only Slack, Gmail, Calendar and Drive items are candidates (notes, Org62 and sessions have their own signals), at most 6 per item, strongest first. **Items without candidates cost nothing**: most passes make no call.
2. **Model check.** One tool-less, one-turn call per batch of up to 6 items on the cheapest tier (Haiku 5.5; `check-completion` 1.2.0 runs at medium effort; about 3 K input tokens and $0.0009 a call). Per item it gets the title, kind, purpose, due date, asker, the ask itself, and each candidate's author (me / name), time, relation and text; ids are aliases (`w1`, `s1`), so a reply can only cite a candidate of the same item. It first names the one outcome the **title** needs, then answers `done`, `partial` or `not_done` with the cited candidate, a **basis** (`delivered`, `confirmed`, `done_by_other`, `pointer`, `partial`, `none`), a confidence and a reason of at most 15 words. Promises and offers ("I'll", "I can", "on it") are never done; a message that finishes another ask of the same person is not done for this item.
3. **Gate, then write.** The pass emits signals and never sets item state.

   | Verdict | Evidence |
   |---|---|
   | done, basis `delivered`, the cited message is **mine**, in the item's **own conversation** (strong), confidence ≥ the skill's `sure_min_confidence` (1.2.0: 0.8) | `completion`, **Sure** |
   | done otherwise (basis not `none` / `partial`), confidence ≥ 0.7 | `completion`, Likely |
   | partial, confidence ≥ 0.6 | `progress`, Likely |
   | anything else | nothing |

   One message judged to finish two items (the same person often has several asks in one DM) is never Sure for either. Each skill version carries its own calibration in its frontmatter (`sure_basis`, `sure_min_confidence`, `likely_min_confidence`, `partial_min_confidence`): Haiku 5.5 rarely states more than 0.85, so 1.0.0's bare 0.9 never fired, and the categorical basis is what makes a lower number safe. Evidence is written with `linkEvidence` (`cc_link_evidence` semantics) inside a zero-length run on `<connector>:completion:check` of the cited source (trigger `reconcile`, like reconcile's relink runs; the run and its extractor carry `check-completion@<version>`), with the reason prefix **`done_check:`**. The W2 bump queues `reevaluate`, and the closure machine decides under its usual rules (ENGINES §3): Sure → done ("Closed for you · Undo"), Likely → "Likely done · Confirm", progress → in progress; a Drive source never closes on its own.
4. **Scheduling.** Job `completion.check` on queue `completion` (concurrency 1), one queued job per user (`completion.check:<user>`). It is queued after a scan run that stored new or changed items or touched work items (the scan `afterRun` hook in `src/worker/scanning.ts`; on by default only with LLM linking and the real skill runner), at worker start and on wake (catch-up after downtime). It reads its window when it runs: from the last pass's watermark (`jobs.result.watermark`: `through` = now − 60 s, so a scan still committing is not skipped, plus items left pending) to now. An item never checked looks back to its own ask (at most 14 days). A pass sends at most 48 items and spends at most $0.40; the rest stay pending and a follow-up pass is queued.
5. **Budget and spend.** Before every call the global daily hard cap is checked (`budgetStatus`: `user_settings.budgets`, else the `llm_budgets` total). At the cap nothing is called and the items stay pending for the next budget day. Each call is recorded with `recordSpend` against its completion run. `jobs.result` holds counts, ids and codes; message texts and model reasons never enter logs or job results.

Measured on the stress blocks: `docs/ui/STRESS.md` §4.6.

### 4.11 Settle pass (SETTLE-1)

The scanner judges one window at a time, so on a first scan most items arrive already settled: the 30-day scan of
Nov 6 left 308 items open or suggested, of which the answer key (§ FIRST-SCAN-RAMP §7) says 16 were still owed. The
Settle pass judges each item **once, with everything recorded around it**, and closes what is finished.

1. **When.** After the first scan is done (`first-scan.json` status `done`), one pass judges every live or suggested
   item (budget `first_scan`). Afterwards a pass every ten minutes (`settle` hook → `settle.check`, queue `settle`,
   concurrency 1) judges only what changed since the last one: new non-engine evidence, new messages in the item's
   Slack conversation or email thread, a due date that passed. The watermark is the latest succeeded job's
   `result.through`; a pass stopped by its cost cap ($5 first pass, $1 later) keeps the old watermark.
2. **Context pack** (`src/engines/settle/load-db.ts`, `context.ts`; deterministic, no tools, no live reads):
   - the ask (earliest origin), up to six lines before it in the same conversation (who was talking to whom), and
     every line after it in the same thread / DM / email thread, **oldest first**. A long DM keeps its first 20, last
     8, and the middle lines that mention the topic or come from me or the asker;
   - `elsewhere`: up to 14 lines after the ask outside the conversation, scored by topic words, DMs with the people
     involved (the asker, the counterparty, people named in the title, small-group participants; names come from Slack
     authors and participants, emails from email senders and calendar attendees), my first messages to them, and
     nearness to the ask;
   - `events`: up to 8 calendar events from a day before the ask to two days ahead, on the topic or with those people,
     each marked passed or not, with my response;
   - `siblings`: items from the same conversation and items with a similar title within three weeks;
   - hints computed in code (age when first seen, due before first seen, my replies after the ask, the asker's, the
     first reply's delay, mass mail, my invite response).
3. **Model.** `skills/settle-item.md`, one tool-less Haiku call per item (`agentSdkCompletionModel`, the completion
   pass's seam), about $0.0015 an item. Output: one verdict of `duplicate`, `not_an_ask`, `not_yours`, `done_by_you`,
   `resolved_by_other`, `handed_off`, `superseded`, `moment_passed`, `gone_quiet`, `still_yours`; a confidence; one cited
   line; a reason under 20 words in the second person. The parser enforces the citation rules (`done_by_you` cites my
   line after the ask, `resolved_by_other` someone else's, `duplicate` a sibling); a broken rule makes the verdict
   invalid, and the policy never acts on it.
4. **Policy** (`src/engines/settle/policy.ts`, Settings ▸ Closing work, `ClosingSettings`): per reason Close for me / Ask
   me / Leave open, a strictness (minimum confidence), ask-first lists (external commitments, people, channels) and the
   user's own rules (added to the prompt; the skill itself is fixed and versioned). An item the user reopened is never
   closed again; one the user touched is only asked about. Ask = Looks done (done kinds) or Still needed? (the rest); a
   suggestion that is confidently still mine goes back to open work.
5. **Writes** (`DbDataSource.settleApply`): one engine change set per item, so each close has its own Undo. The cited
   message is linked as evidence (`settle: <verdict>: <reason>`, role `completion` for the done kinds, `context`
   otherwise); `resolutionDetail.settle` keeps the reason class, confidence, the message link and the skill version
   for the Auto-closed list. Spend is recorded in `llm_calls` (purpose `done_match`, skill `settle-item`).
6. **Tools.** `scripts/settle/dry-run.ts` (judge, save JSON, write nothing), `scripts/settle/score.ts` (against the
   private answer key: buckets, per-reason precision by threshold, and a policy simulation counting wrong closes and
   the clicks left), `scripts/settle/context-check.ts` (does the pack include the deciding message; no model calls).

## 5. Cursors, ledger and resume

- **Cursor** per `(connector, scope)`. The scope is, for example, `slack:dm`, `slack:mentions`, `slack:channel:<id>`, `gmail:inbox`, `drive:tracked`, `org62:opps`. Semantics per source follow brief 09 §4. The cursor only moves forward, and only in the same transaction as coverage.
- **Scan run** rows record:
  - window `[from, to]`, status, trigger (schedule, catch-up, reconcile, manual or chat `/rescan`);
  - model and skill version;
  - tokens and cost;
  - counts: fetched, new, changed, linked, proposed, unlinked.
- **Coverage ledger** rows record which objects or ranges were scanned per run. "What did we look at on Tuesday between 2 and 4 pm in #acme?" must be answerable with a single query.
- **Resume after downtime** (for example a laptop shut all weekend):
  1. On worker start, compute each scope's gap (now minus cursor).
  2. Run the **newest hour first**, so Monday morning is right quickly.
  3. Backfill older windows in chunks, for example 6 h, oldest to newest, until the gap is closed.
  4. Health shows "catching up: Slack 60%", and the UI holds re-ranks until catch-up settles (UI-SPEC §10).
  5. Interrupted runs are idempotent and simply re-run. At worker start, queued plan jobs from the cursor to now are dropped and re-planned, but queued backfill and continuation windows that lie **behind** the cursor stay queued: on a cold start the cursor is at now after the head run, so the new plan would never see them (stress finding RS-1).
  6. **First scan (B-080).** The worker's first scan covers **30 days** by default. `CC_FIRST_SCAN_LOOKBACK_DAYS` (or the worker flag `--lookback-days`) changes that, and `0` turns it off, leaving the per-connector lookback. Onboarding (B-079) will offer 7, 14, 30 or 90 days, with the estimated costs in `docs/ui/STRESS.md`. `CC_FIRST_SCAN_BUDGET_USD` (or `--backfill-budget`, default $25 since 2026-11-13, was $100) caps that backfill's one-time budget. A first scan never shortens a connector's own lookback: Org62 keeps 30 d at a 7-day setting. Older items known by hand are injected separately after go-live. `CC_FIRST_SCAN_CONNECTORS` defaults to Slack, Gmail, Drive, Gemini notes, Org62 and Calendar.
     - **Planning (FS-ORDER).** A scope with no cursor plans from one fixed floor (first plan's `now − lookback`), past the 14-day planner cap. There is no head hour: the backfill runs **oldest → newest** up to the plan's `now`, each gap chunked forward from its start. Re-plans therefore keep the same chunk ids. An ask is recorded before the reply that settles it, so triage and the completion pass see each conversation in the order it happened; before, the backfill ran newest first and my answer was recorded before its ask existed. The cursor trails the backfill. While the first scan runs, the live loop polls only what came after the plan's end (incremental, ahead of the backfill in the queue), and the cursor fast-forwards over those polls once the backfill reaches them (S9). Slack channels backfill in 24 h chunks during the first scan.
     - **Budget.** These jobs carry `budget: 'first_scan'`, and their continuations, retries and splits keep it. They spend the one-time budget instead of the daily cap, and their spend does not count against the daily cap of regular scans.
     - **End of the budget.** It ends for good once every scope planned under it has no first-scan work left (`done`), or once it is spent (`exhausted`). After it is spent, the remaining chunks continue under the daily cap.
     - **Restarts.** State lives in `<CC_STATE_DIR>/first-scan.json` and survives restarts. A restart re-plans only the uncovered chunks (`[floor, low watermark)` plus the holes), with the same ids.
     - **Scope.** A user with history never starts a first scan, and a scope added later joins it only while the first scan is still active.
     - **Deeper per-scope lookback (FS-DEEP).** `CC_FIRST_SCAN_SCOPE_DAYS` (or `--scope-days`), for example `slack:inbox=90,gmail:inbox=90`, gives named scopes their own floor (`startedAt - days`), fixed when the scope is first claimed and kept in `first-scan.json` (`floors`). Everything else keeps the lookback. Past the shared floor the Slack inbox backfills in 6 h chunks (2 h inside it), so 60 extra days are 240 runs. Since STRESS-2's triage pass, every message gets a verdict whatever the window holds. Onboarding can offer it as a choice; the config field is `FirstScanConfig.scopeDays`.
     - **Holes (FS-2).** A scope is done only when its first-scan span (floor to the plan's end) has no holes. A window that failed for good leaves the scope pending, and its holes are re-planned under the first-scan budget after 30 min, 1 h and 2 h; after three rounds the scope is done and the rest is left to reconcile.
     - **Calendar (FS-CAL-1).** The Calendar fetch is a snapshot of `[now - 2 d, now + 14 d]` and ignores windows, so before this the first scan never planned it and the Time page saw only two days of past meetings. Now it backfills in 24 h chunks. A chunk that ends before the live range is **history**: the fetcher lists exactly that window and returns every event, oldest first, tagged `history`, with `recordOnly`. The runtime records the items and the coverage, runs no agent and flags nothing unlinked. Past meetings feed the calendar projection (Time, History) and the completion pass's `same_event` candidates, and a skill pass over weeks-old meetings could only propose stale prep asks and catch-ups. History runs detect no cancellations and hand the live cursor value back unchanged. A full page (250 events) claims coverage only up to its last start, and the continuation lists the rest.
     - **Drive (DRV-1).** Drive samples forward: the first sample of a file is a silent baseline, so the first scan used to store no Drive items at all, and the first feed stopped at 4 pages (200 rows) while a real 30-day feed held over 500, a third of them folders and shortcuts. Now the feed query leaves out folders and shortcuts, the first feed (no feed cursor) reads up to 20 pages, and the first run emits one record-only `file_revision` per Google editor file I last edited in the 30-day lookback (its last edit only: the feed has no revision history), tagged `history`. They feed the assets and the Time page's Drive evidence. Later runs are unchanged.
     - **Drive behind the frontier (FS-DRIVE-1).** The feed reads forward from its frontier (the last feed time − 2 min), and the window clamp cuts each run's coverage at its window end. Oldest first, the first run is the oldest window, so every later backfill window read only the last minutes and failed with a hole the size of its window. Now a window that ended a day or more behind the frontier lists exactly itself (`modifiedTime` bounded both ends, up to 20 pages), records my editor files in it as the same `history` items (a repeat is unchanged), and hands the cursor back unchanged, so the feed state never moves backwards. Any other window that starts behind the frontier (the last backfill window, a late poll) reads the feed from its own start. Test: `first-scan.test.ts` FS-DRIVE-1.
  7. **Catch-up follows its plan** (stress campaign, `docs/ui/STRESS.md`). A scope is "catching up" until every job of its plan (head, backfill chunks, their continuations and splits) has finished and the cursor has reached now. On a cold start without a first scan the head run initializes the cursor at now while the lookback backfill still runs behind it, so the cursor alone would report "caught up" after the first hour. A paused backfill, continuation or targeted window (auth or budget pause) is retried later: after 30 min for an auth pause, or at the next budget day. It is never dropped, because on a cold start no later poll would plan it again.
- **Per-object errors (DRV-2, GEM-1).** A Google error about one file (404 not found, 403 no access, 400 an unsupported document) skips that file, which the coverage marks with the error. The run goes on, and the connector is not degraded.
- **Status reasons (STAT-1).** A failed run writes a plain reason to `connectors.status_reason`: the failing scope and the cause, for example "Channel scans: prompt over the size limit" or "Meeting notes: a file couldn't be found" (`src/scanner/runtime/status-reason.ts`). Before, it was the classifier's code, which read "unknown".
- **Work items get their account (ACC-1).** The scan skills propose items without an account, so the projections pass (`src/projections/work-accounts.ts`) gives each item with none the account its title and purpose name, through the same Matcher as calendar events. The Matcher now also knows short names derived from Org62 legal names: a distinctive first word ("Northwind"), letters run into digits ("Contoso42"), and acronyms ("BSP", "HCEC"). When several accounts claim a name, the one with my open opps wins, then an opp word in the text; a tie that remains matches nothing. An account the user set or cleared is never touched. On the first live day this took the matched items from 0 to 15 of 50.
- **Recovery and shutdowns (HEALTH-1, SHUT-1).** A success makes a connector healthy again and clears its reason once none of its other scopes failed in the last 2 h; the first success after a worker start always writes it, because the in-memory state starts empty. The failure count resets on that recovery, not on any success, so a Degraded connector never shows 0 failures. A run the worker stops itself (shutdown drain, cancel, lost lease) is recorded as cancelled, with no health write, and the job runtime requeues it; a job timeout is still a failure. Settings shows the plain reason as the last error's message.
- **Incomplete runs claim nothing past their cursor (S8c).** When `cursor.at` is before `window.to`, the store clamps the run's time ranges (`query_window`, `channel_range`, `mailbox_range`, `calendar_range`) to the cursor before commit. Otherwise one query's full window (Slack S1/S2) masks another query's paged-out end (S3), and if the continuation is lost, the rest of the window disappears from `coverageGaps`.
- **Deterministic runs are bounded.** Each fetcher hands the agent at most `maxItemsPerRun` items; Calendar and Gemini notes (snapshot fetchers) emit the items nearest to now first, and leave the rest for the next polls. Prefetched items are rendered compactly: an email body appears once, as `payload.bodyNew` (≤ 1500 chars). The prefix tripwire is sized from the run itself (TRIP-2): everything the runner sends (common rules and skill at 2 characters per token; context pack, run block and prefetched payload at 1.8), plus 24 K tokens for what it does not send itself (the SDK prompt and the tool schemas). On the first live day, Org62 events sent 75.7 K characters for a 43.0 K-token first call and a Slack channel 68.4 K for 41.9 K, so real prompts have 15–20 K tokens of headroom, and a failed restricted config (every MCP tool loaded) still trips. Before, a flat 40 K base calibrated on stress databases (G-3, TRIP-1) failed every Slack channel, Org62 events, Claude sessions and Calendar run once the real list and today's skills grew the prompt. `tests/stress/regressions.test.ts` (TRIP-2) checks every shipped scan skill against its own limit with a real-sized list. The context pack shows at most 60 open items and 25 initiatives, and never a fetcher cursor longer than 180 characters (CTX-1). A traversal tripwire retries the same window after a backoff instead of splitting time, because the first call holds no fetched data (TRIP-3). A cost-cap or tripwire failure of a deterministic run retries **the same window with half the items**, and never splits time: snapshot fetchers ignore the window, so a time split repeated the same oversized run. The worker commits the fetcher's `nextCursor` itself; when it is longer than 180 characters (fetcher state grows: per-file offsets, seen ids), the agent gets a short stand-in header cursor to echo, because `cc_finish` caps `cursor.value` at 200 characters (stress finding CUR-1). A scope that gives up on a window backs off before the next poll re-plans it: 30 min, doubling per about four failures, capped at 6 h, reset by a success (LOOP-1). A continuation whose cursor did not pass its own window start ends the chain instead of spawning another one over the same window (THR-1).
- **Live cadence while the app is up** (configurable per user; adaptive backoff when nothing changes; budget-aware):

  | Scanner | Cadence |
  |---|---|
  | Slack | 2 min |
  | Gmail | 3 min |
  | Calendar | 5 min |
  | Claude sessions | file watch (near real time) |
  | Drive | 10 min |
  | Gemini notes | every 10 min for 120 min after a meeting ends |
  | Org62 | 30 min |
  | Trainings | daily |
  | Watch briefs | per subscription |

  Off-hours cadence is ×6 slower. Off-hours are outside the user's working hours.

## 6. Finding misses and unconnected items (reconcile)

These jobs run **nightly, on resume, and on demand** (chat `/rescan` and the Health page Rescan):
1. **Coverage gaps.** List source objects in the last 7 days (cheap listing calls) and diff them against the coverage ledger. Only objects inside the scope's scanned span count: after its first scan and before its cursor. Objects older than the initial lookback were never in scope, and objects after the cursor belong to the next poll. All uncovered objects of a scope get **one** targeted scan, whose window spans them. Calendar's listing is identity-only (no `to`), because a scan clamps an event's coverage to its own window, so a multi-day event would otherwise look uncovered every night.
2. **Unlinked items.** Source items flagged unlinked, or with no evidence links but relevant, are re-run through linking with fresh open-item context. On the second failure, escalate once to **Sonnet**. On the third, it becomes a Triage mapping question, but only for an ask of me or a commitment of mine: a Slack message or email addressed to me or from me (MAP-1, Settings ▸ Scanning). Anything else stops being retried (its findings are `ignored`). Before, 34 questions from one first scan held about 4 real items.
3. **Stale-but-active.** Open items with no new evidence while their source thread or file has changed are re-scanned.
4. **Skill upgrades.** When a skill version bumps, re-link the last N days for that source, behind a dry-run diff report on Health.

## 7. Models and cost

- **Haiku** (`claude-haiku-5-5`, low effort) for every scanner run and reconcile step.
- **Sonnet** only for the reconcile escalation (§6.2), the Slack triage escalation of `unsure` verdicts (§4.10) and in BE-3/BE-4 (NBA, drafts).
- One Claude process per connector at a time.
- Each scanner loads **only** its own MCP server plus the `cc` tools. This is the restricted config from brief 09, and it's the biggest cost lever.
- Prompt-cache the skill text and the context pack.
- Measured target: about $0.50/day for scanning (brief 09). Health shows per-scanner spend.
- At the hard cap ($15/day), the traversal scanners pause. The deterministic fetches and file watch keep running, with linking deferred. Reconcile's LLM steps (relinks, the Sonnet escalation, skill-upgrade dry runs) defer too, until the next budget day.

## 8. Correctness tests (required before "built")

All tests use fixtures from **recorded tool results with placeholders**. Each test is real-shaped.
- Running the same window twice gives zero new rows (idempotency).
- A killed run mid-way leaves the cursor unmoved, and re-running produces the same final state.
- A weekend gap gives the newest hour first, then a backfill that ends with full coverage and no holes in the ledger.
- "I'll send the deck" in Slack, then an email with the deck attached, links to the same item, as `origin` then `completion`.
- A Drive edit on the linked deck with no Slack message produces a `progress` signal.
- "Done, see deck" in Slack produces a `completion` signal.
- New requirements arriving after done produce a `contradiction` or requirements-change signal, and BE-3 then reopens the item or creates a sibling.
- An unlinked item is retried, then escalated, then becomes a Triage question.
- The stress harness (`scripts/stress/**`, `docs/ui/STRESS.md`) replays recorded real days through the production worker, and checks these invariants after every scenario.
- A non-allowlisted tool call aborts the run.
- Over budget, traversal pauses.

## 9. Audit trail: what a run did and why (AUDIT)

Every scan run keeps an ordered, append-only decision trail in `scan_run_events` (`run_id`, `seq`, `ts`, `kind`, a small JSON payload, optional `source_item_id` / `work_item_id`). Code: `src/scanner/trace/`.

| Kind | Written by | Carries |
|---|---|---|
| `plan` | runtime | connector, scope, mode, trigger, window, chunk, budget (daily / first-scan), model, skill version, caps, job id |
| `prefetch` | runtime (deterministic) | items fetched, limit, coverage, record-only, agent or deferred |
| `tool_call` | runner (from the message stream) | tool, server, the query or ids (cc tools: ids only), duration, result size and row count, error head |
| `rec` | REC-1 | per tool result: parsed, recorded, new, duplicates |
| `recorded` | store | source item ids seen (new / changed / unchanged) |
| `prompt` · `tripwire` · `cost_cap` | runner | first-call tokens against the tripwire limit; the estimate or SDK stop against the cap |
| `pass` | runner | traversal / triage / escalate: model, ok, error, cost, tokens, turns, counts |
| `triage_select` · `verdict` | runner | why each message did or did not get a verdict (trivial, handled, skipped, dropped); act / noise / unsure, the short reason, escalated, the final call |
| `proposal` · `link` · `unlinked` · `coverage` | store | work item, evidence ids, role, confidence, the model's short reason |
| `spend` · `commit` · `failed` · `retry` · `outcome` | store, runtime | cost and budget; cursor; failure cause; what the runtime did next (split, fewer items, retry, next poll); the final status |

Rules: ids, counts, codes and short reasons only (strings redacted and clipped to 160 characters, a query to 300); message text stays in `source_items`. The worker writes it in the background (`DbTraceSink`): a trace failure drops events and never fails, slows or changes a run. Retention: 30 days (the nightly retention job). Worker log lines inside a job carry `runId`, `jobId`, `connector` and `scope`; every `llm_calls` row carries its run or job and its budget (`daily` / `first_scan`). A failed run, a tripwire hit or a cost-cap stop opens one `app_events` row per scope and cause (repeats bump its count; the scope's next success resolves it); a scope paused at the daily hard cap opens `budget_hard_cap`.

```bash
npm run scan:trace -- <runId>                 # the ordered trace (or --last [connector] [--failed])
npm run scan:explain -- --url <permalink>     # was it fetched, recorded, triaged (verdict and why), linked? (or --source-item <id>)
npm run scan:report -- --since 24h            # per scope: runs, failures by code, coverage holes, spend by budget, triage
```

Health shows the error feed and the first scan's progress per scope (read from `first-scan.json`), and a work item's Details panel answers "Why is this here?": the origin message and its link → the scan run (time, skill version) → the triage verdict and its reason → that run's model cost.
