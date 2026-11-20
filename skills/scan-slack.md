---
skill: scan-slack
version: 1.7.0
connector: slack
server: slack
model: claude-haiku-5-5
effort: low
max_turns: 30
budget_usd_per_run: 0.08
scopes: [inbox, "channel:<id>", "thread:<channelId>:<ts>"]
allowed_tools:
  - mcp__slack__slack_search_public_and_private
  - mcp__slack__slack_read_thread
  - mcp__slack__slack_read_channel
  - mcp__slack__slack_list_unreads
never_tools: ["*send_message*", "*schedule_message", "*add_reaction", "*mark_read", "*create_*", "*update_*", "*upload*", "*add_list_*", "*canvas*"]
---

# scan-slack: Slack traversal scanner

Follow `_scanner-common` (R1–R10) plus this file. `me.slackId` is the user's Slack id. All times are Unix seconds unless noted.

## 1. Scope

| Scope (Run `{{scope}}`) | What it covers |
|---|---|
| `slack:inbox` | (a) DMs and group DMs written to me by others; (b) @mentions of me in channels; (c) **my own messages** everywhere (commitments and completion signals); (d) threads I'm in, opened per §3 |
| `slack:channel:<id>` | One channel from the watch list (e.g. `#team-updates`) or a **customer channel** mapped to an account (`{{channel.kind}}` = `watched` or `customer`, `{{channel.accountId}}`) |
| `slack:thread:<channelId>:<ts>` | `targeted` mode: one thread whose open item may have moved |

Out of scope: canvases and lists (record a reference only), bot and app messages (skipped by the search defaults), and channels not listed above.

## 2. Exact tool calls

Use these parameters **verbatim** with the Run-block values. The search tool takes `keywords` (an array of words or phrases), `filters` (one string of Slack modifiers such as `from:`, `in:` and `has:`) and `channel_types`. It has no `query` argument: text put there is ignored, and the search returns the latest messages of the whole workspace. **Never put a mention (`<@…>`) in `filters`**: Slack ignores it there. Always pass `channel_types`. Every search uses `sort: "timestamp"`, `sort_dir: "asc"`, `limit: 20`, `include_context: false`, `response_format: "detailed"`, `after: "{{window.afterUnix}}"` and `before: "{{window.toUnix}}"`.

### Scope `inbox`: issue S1, S2, S3 and S4 in parallel, in one turn

| Step | Tool | `filters` / `keywords` | `channel_types` | Coverage `ref` |
|---|---|---|---|---|
| S1 DMs/MPIMs to me | `mcp__slack__slack_search_public_and_private` | `filters: "-from:<@{{me.slackId}}>"` | `im,mpim` | `search:dm` |
| S2 @mentions | `mcp__slack__slack_search_public_and_private` | `keywords: ["<@{{me.slackId}}>"]` | `public_channel,private_channel` | `search:mentions` |
| S3 my messages | `mcp__slack__slack_search_public_and_private` | `filters: "from:<@{{me.slackId}}>"` | `public_channel,private_channel,mpim,im` | `search:mine` |
| S4 my messages with a file | `mcp__slack__slack_search_public_and_private` | `filters: "from:<@{{me.slackId}}> has:file"` | `public_channel,private_channel,mpim,im` | `search:mine:files` |

S4 returns a subset of S3: the messages of mine that carry an attachment (search results show no file names). The runner marks them; you don't record anything extra. A short reply of mine in the ask's own DM or thread that S4 returns ("here you go") delivers a file: link it as `completion`.

### Scope `channel:<id>`

| Step | Tool | `filters` / `keywords` | `channel_types` | Coverage `ref` |
|---|---|---|---|---|
| C1 channel messages | `mcp__slack__slack_search_public_and_private` | `filters: "in:#{{channel.label}}"` | `public_channel,private_channel` | `search:channel:{{channel.id}}` (kind `channel_range`) |

`{{channel.label}}` is the channel's bare **name** (no `#`). Never write `in:<#{{channel.id}}>`: this search matches nothing with the id form. If `{{channel.label}}` is empty, use C1′ instead: `mcp__slack__slack_read_channel` with `{channel_id: "{{channel.id}}", oldest: "{{window.afterUnix}}", latest: "{{window.toUnix}}", limit: 100, response_format: "detailed"}`, paging with `cursor` like a search (same 3-page cap, same coverage ref and kind). C1′ returns top-level messages only; open threads per §3.

### Scope `thread:<channelId>:<ts>` (`targeted`)

T1. `mcp__slack__slack_read_thread` with `{channel_id: "{{thread.channelId}}", message_ts: "{{thread.ts}}", limit: 100, response_format: "detailed"}`. Coverage: object `{kind: "thread", ref: "slack:{{thread.channelId}}:{{thread.ts}}", from: "{{window.from}}", to: "{{window.to}}"}`. In `targeted` mode, record and link only the replies newer than `{{window.from}}`.

### Paging (all searches)

If the result's `pagination_info` contains a cursor, call the **same** tool again with identical arguments plus `cursor: "<that cursor>"`. That's at most **3 pages per query per run**. If a query still has more pages after 3:
- stop that query;
- report its coverage `to` = the `Time` of the last result you processed;
- finish with `complete: false` and `cursor = {value: "<that Message_ts>", at: "<that Time as ISO>"}` (when several queries paged out, use the earliest one).

### Reading the results

Each search result block has `Channel: <name> (ID: <C|D|G…>)`, `Participants:` (DMs), `From: <name> <email> (ID: <U…>)`, `Time:`, `Message_ts:`, `Permalink:` and `Text:`. The permalink ends in `?thread_ts=<ts>` when the message is a **thread reply**.

## 3. Traversal rules

- **Opening threads** (`mcp__slack__slack_read_thread`, `limit: 30`, `response_format: "detailed"`, no `oldest`). Do this only when one of these holds, and at most **5 thread reads per run**:
  1. a hit is a thread reply (its permalink has `thread_ts`) addressed to me, or written by me, and you can't tell what is being asked or delivered without the parent;
  2. my message says done / sent / here's (a completion signal), and you need the thread to find what was asked;
  3. in `head` or `backfill` mode: a Slack `threads` ref of an open item in the context pack whose `last` is older than the window. At most 3 of these.

  Its messages are recorded like search hits (§4). Add each thread you read to coverage `objects` as `{kind: "thread", ref: "slack:<channelId>:<thread_ts>"}`.
- **Links.** Record references; don't fetch.
  - Google Docs/Slides/Sheets/Drive URLs (`docs.google.com/<type>/d/<ID>/…`, `drive.google.com/file/d/<ID>/…`) → `fileRefs: ["drive:<ID>"]`.
  - Other URLs → `fileRefs: ["url:<url>"]`, capped at 3.
  - Org62 ids in text: `006…` (15/18 chars) → `oppHints`; `001…` → `accountHints`.
- **Depth.** No more than one hop: never open a thread from inside a thread, and never read whole channels in `inbox` mode.
- **Skip.** Messages from bots/apps, channel joins, and emoji-only messages are recorded (if they came back) but never linked. In `channel:` scopes with `{{channel.kind}}` = `watched`, record everything (it feeds briefs), but only link or propose when the message involves me or my accounts/initiatives.
- **DM list fallback.** Use `mcp__slack__slack_list_unreads` with `{channel_types: "im,mpim", limit: 50}` only if S1 returned an error. Then stop the run with `complete: false`.

## 4. Recording (one item per message)

**When the Run block has a `slack.rec` line set to `auto`** (the default), the runner has already recorded every message that your searches, thread reads and channel reads returned, verbatim and redacted, with the fields below. This overrides R3 step 2: **don't call `cc_record_source_items` for them.** Wherever a tool wants a `sourceItemId`, cite a message as `<channelId>:<Message_ts>` (e.g. `D0DM00001:1793800000.000100`). Spend the turns on extraction and linking instead.

Only when the Run block has no `slack.rec` line, record with `cc_record_source_items`. Its items are:
- `kind: "message"`;
- `externalId: "<channelId>:<Message_ts>"`;
- `occurredAt: "<Message_ts>"` (the tool converts Slack ts);
- `author: {name, email, externalId: <U…>, isMe: <id == {{me.slackId}}>}`;
- `participants` from `Participants:` (DMs/MPIMs);
- `permalink`;
- `excerpt` = the message `Text`, verbatim, redacted per R6, first 1000 characters;
- `threadRef: "slack:<channelId>:<thread_ts or Message_ts>"`;
- `fileRefs`, `oppHints`, `accountHints` per §3;
- in a customer channel, add `{{channel.accountId}}` to `accountHints`;
- `payload: {channelId, channelName, ts, threadTs, isReply, query: "dm"|"mentions"|"mine"|"channel"|"thread"|"other"}`.

Skip `title` for messages.

## 5. Extraction rules (Slack specifics on top of R4/R7)

- **Ask of me.** S1 and S2 hits, and replies in a thread to my message, that match the R7 ask patterns. A plain question to me in a DM counts. In a **group DM or channel**, the ask must address me: my @-mention or name, or a reply to my message. A message that opens with someone else's name or @-mention ("Good morning PERSON_J! can the team do 3:30?", "@PERSON_S can we connect?") is their ask, even in a thread I'm in. So is an unaddressed follow-on in someone else's two-way exchange (PERSON_B asked PERSON_C, PERSON_C answered, PERSON_B follows up), even if I spoke earlier. Chat pings ("have a minute?"), quick logistics ("are you in ET?"), favors, live meeting chatter ("I'll hand it off to you", "what is at 3pm?") and agenda lines naming me as a presenter of something happening now are not asks.
- **Asks of a group.** An ask to a whole channel (`<!channel>`, `<!here>`, `<!everyone>`) or to a list of people (me among three or more @-mentions) is not mine alone. `{{scan.channelAsks}}` decides: `ask` → propose it at most `guess` (it lands in Triage), and only if it asks for something I would do; `mine` → like an ask of me; `ignore` → record only. The cc tool enforces the same.
- **My own asks of others are not my items.** S3 hits where I ask someone else ("can you send me…", "<@PERSON> could you review…"): theirs to do. Record only; never propose kind `ask` from my own message.
- **My commitment.** S3 hits that match the R7 commitment patterns. The beneficiary is the DM counterpart or the person I replied to (for an MPIM, the person whose question I answered). Phrases can be an aside at the end of a longer message: read the whole text.
- **Completion signal.** An S3 hit with R7 completion words or a Drive link, in the same thread or DM as an earlier ask or commitment, or addressed to the same person.
- **Requirements change.** A non-me message in the thread or DM of a candidate with `st: done` that asks for more or different ("can you also…", "one more thing", "actually they want…", "change X to Y", "they need it by…") → `contradiction` with `requirements_change: <what changed>`. On an open item, link it as `context` with reason `requirements_update: <what changed>`.
- **Meeting takeaways.** "Action items / next steps / takeaways" lists. Propose one `follow_up` for each bullet assigned to me or to my role by its short name (the Persona block's role: "SE" for an SE, "AE" for an AE), with evidence `origin`.
- **Training notices.** A human telling me to complete a training by a date → propose kind `training` (the bot tracker belongs to `scan-trainings`).
- **Hand-offs (R-UI-22).** My message handing work to a teammate ("PERSON will take this", "handing to PERSON") on a known item → `context` with reason `handoff: to PERSON`.

## 6. Linking rules (Slack order of preference)

1. `threadRefs: ["slack:<channelId>:<thread_ts or ts>"]` plus any `fileRefs`. A `same thread` or `same file` candidate wins.
2. For DMs: `people: [counterpart name, counterpart U… id]` + `text`. For customer channels, add `accounts: [{{channel.accountId}}]`.
3. Otherwise propose (asks, commitments, takeaways): no matching item means a new one. Flag unlinked only when a candidate might be the same deliverable and you can't confirm it (R5 step 3); an FYI with no home is recorded only.

Then apply R5's **handed-off / watcher rule**, with the Slack meaning of a **direct ask of me**: a DM (S1), an @mention of me (S2), or a reply in a thread that asks me by name. If someone else in a handed-off thread @mentions me and asks me to do something, that's a loop-back (`origin`, `loop_back: …`). An FYI in that thread is `context`.

**Confidence:** a thread/file join, or a strong commitment/direct ask, is `sure`. A people + keyword match, or a medium commitment, is `likely`. A weak commitment, or a channel message that only might be for me, is `guess`.

## 7. Redaction

Apply R6 before recording. Slack-specific risks are shared demo-org logins ("user / pass"), passwords pasted in DMs, tokens in code blocks, and webhook URLs (`hooks.slack.com/services/…` → `[REDACTED]`).

## 8. Stop condition and coverage

Stop when every step for the scope has run (with paging) and every relevant item is linked, proposed or flagged.

**Triage pass (before `cc_report_coverage`).** Go through every S1, S2 and S3 hit you recorded, oldest first, and give each exactly one outcome: proposed, linked, flagged unlinked, or skipped as noise (bots, joins, emoji-only, greetings, thanks). A question or request to me in a DM or group DM is an ask (propose it, or link it if it matches a candidate). But an ask I clearly answered or delivered in the same thread or DM ("added you", "here's the deck", the file, a direct answer) is done, not a new item: link my answer as `completion` (`sure`) to a matching open item, or propose nothing. A partial answer or a promise is not done: propose, then link my reply as `progress`. A message of mine that promises something ("let me look at that", "I'll answer when I'm back", "working on it today") is a commitment. Busy windows are where asks hide: don't stop after the first few.

Then:
- `cc_report_coverage`:
  - **inbox:** windows `search:dm`, `search:mentions` and `search:mine`, each `{kind: "query_window", from: "{{window.from}}", to: "{{window.to}}" or its paged-out end}`, plus thread objects;
  - **channel:** window `{kind: "channel_range", ref: "search:channel:{{channel.id}}", …}`;
  - **thread:** the T1 object.
- `cc_finish`:
  - complete: `cursor = {value: "{{window.toUnix}}.000000", at: "{{window.to}}"}`, `complete: true`;
  - paged out: per §2.

## 9. Worked examples (placeholders only)

**E1. Background promise with no "I'll" (the background-promise case, SCANNER.md §4.8).** S3 returns my DM to PERSON_B (`D0DM00001`): "No worries, we can get it working next week. I'm going to figure out how to distribute as a desktop app so it's easier for others to use as well." Earlier in the DM, PERSON_B said the APP_X install times out.
- It's recorded already (by the runner; by you only when the Run block has no `slack.rec` line).
- `cc_find_candidates({people: ["PERSON_B", "U0PERSONB"], text: "APP_X desktop app distribute package install"})` → nothing ≥ 0.5.
- `cc_propose_item({kind: "commitment", title: "Package APP_X as a desktop app for PERSON_B", purpose: "PERSON_B (and others) can install APP_X without running a node project", confidence: "likely", evidence: [{sourceItemId: "D0DM00001:<Message_ts>", role: "origin", reason: "medium commitment: 'I'm going to figure out how to distribute as a desktop app'"}]})`.
- Medium strength, so `likely`. The beneficiary is the DM counterpart, PERSON_B.

**E2. "I'll send the deck" (cross-source completion).** S3: in DM `D0DM00002`, I tell PERSON_D: "I'll send the ACME demo deck tonight."
- No candidate. Propose `{kind: "commitment", title: "Send ACME demo deck to PERSON_D", due: "<message day>T17:00 local as ISO", confidence: "sure", evidence: [{role: "origin", reason: "strong commitment with deadline"}]}`.
- Later, `scan-gmail` sees my email to PERSON_D with the deck attached and links `completion` to this item. People and deck keywords are what connect them, so keep the title's nouns specific.

**E3. "Done, see deck" (completion).** In `#acme-account` (`C0ACME001`), PERSON_C asked in thread `1793800000.000100`: "can you update the pricing slide in the ACME POV deck?" (an existing item `wi_12`, same thread). S3 returns my reply in that thread: "Done, see deck https://docs.google.com/presentation/d/FILE_ACME_POV/edit".
- Its record carries `threadRef: "slack:C0ACME001:1793800000.000100"` and `fileRefs: ["drive:FILE_ACME_POV"]`.
- `cc_find_candidates({threadRefs: [...], files: ["drive:FILE_ACME_POV"]})` → `wi_12` (`same thread; same file`, s 1.0).
- `cc_link_evidence({workItemId: "wi_12", role: "completion", confidence: "sure", reason: "my reply 'Done, see deck' with the deck link in the request thread"})`.

**E4. New requirements after done (contradiction).** Two days later, PERSON_C writes in the same thread: "Thanks! Can you also add a slide on data residency?" The candidate `wi_12` now shows `st: done`.
- `cc_link_evidence({workItemId: "wi_12", role: "contradiction", confidence: "sure", reason: "requirements_change: new data-residency slide requested after done"})`.
- Don't propose a new item: the engine decides between reopening it and creating a sibling.

**E5. Handed-off item: context vs loop-back (R-UI-22).** Item `wi_30` "ACME sizing workbook" shows `res: handed_off`, `inv: watcher` (I handed it to PERSON_E).
- (a) In its thread, PERSON_E posts: "FYI customer moved the review to Friday." Link `{role: "context", confidence: "sure", reason: "status update on handed-off item"}` and propose nothing.
- (b) PERSON_E DMs me (S1): "Can you join Friday's review to cover the architecture section?" That's a direct ask of me: `cc_link_evidence({workItemId: "wi_30", role: "origin", confidence: "sure", reason: "loop_back: PERSON_E asked me directly to join Friday's review for the architecture section"})`.

**E6. Noise.** A DM saying "thanks!! 🙌" → record only.
