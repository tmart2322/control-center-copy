---
skill: scan-org62
version: 1.7.0
connector: org62
server: Org62-Sobject-Read
model: claude-haiku-5-5
effort: low
max_turns: 25
budget_usd_per_run: 0.08
scopes: [opps, events, dcs, book, missed_opps]
allowed_tools:
  - mcp__Org62-Sobject-Read__soqlQuery
never_tools: ["*create*", "*update*", "*delete*", "*upsert*", "*dispatch*", "*write*"]
---

# scan-org62: Org62 traversal scanner

Follow `_scanner-common` (R1–R10) plus this file. The only tool is `mcp__Org62-Sobject-Read__soqlQuery` with one argument, `q` (a SOQL string). It is read-only SOQL. Never attempt DML.

Run-block values used here:
- `{{me.org62UserId}}`: my User Id (`005…`);
- `{{window.fromSoql}}` / `{{window.toSoql}}`: SOQL datetime literals, used **unquoted**;
- `{{org62.accountIds}}`: a comma-separated, single-quoted list of my Account Ids, possibly empty;
- `{{org62.book}}`: whose opportunities are my book, from my role (the Persona block): `team_member` (opp teams I'm on), `owner` (opps I own) or `both`.
- `{{org62.dcs}}`: `on` or `off`, whether my Deal Contributions are part of my role.

## 1. Scope

| Scope | What it covers |
|---|---|
| `org62:opps` | Opportunities where I'm on the opp team, plus opportunities on my accounts (plus opportunities I own when `{{org62.book}}` is `owner` or `both`), that changed in the window (stage, close date, amount, next step, team) |
| `org62:events` | My own Events (the record type my Persona block logs activity with, and other types) changed in the window: activity read-back and evidence of work |
| `org62:dcs` | My `Deal_Contribution__c` rows changed in the window |
| `org62:book` | Daily (and on the first run): every open opportunity in my book (`{{org62.book}}`), and my DCs on open opps, whatever their SystemModstamp (unwindowed, §6) |
| `org62:missed_opps` | Daily sweep for opportunities I logged time on but may be missing a Deal Contribution on (R-UI-14), §6 |

The worker plans only the scopes my role scans (the Persona block's Org62 scopes): `dcs` and `missed_opps` run only when deal contributions and missed opps are active. The sections for a scope apply only when it is `{{scope}}`.

## 2. Exact queries

Page every windowed query by `ORDER BY SystemModstamp, Id` with the LIMIT shown (opps 50, Events 40, DCs 100; never more: a 200-row Event page is about 166K characters and a 100-row Opportunity page about 77K, and both exceed the tool's output cap, stress findings ORG-1 and ORG-4). **If a result says it exceeds the maximum allowed tokens** (or is cut short), you have read none of its rows: run the same query again with half the LIMIT (50 → 25 → 12, never below 10) and keep paging at that size. Never report coverage, or move the cursor, past rows you have not read. If a query returns its LIMIT, run it again with the extra filter `AND (SystemModstamp > <last SystemModstamp> OR (SystemModstamp = <last SystemModstamp> AND Id > '<last Id>'))`. For relationship-filtered queries, use the same prefix as the ORDER BY field. Stop after **2 pages** (a run has about 3 minutes; a bulk-logged week holds hundreds of Events): finish with `complete: false` and `cursor = {value: "<last SystemModstamp>|<last Id>", at: "<last SystemModstamp as ISO>"}`, and the worker continues from there. In mode `continuation` or `retry`, when `{{cursor.value}}` has that `<SystemModstamp>|<Id>` form, the first page already carries the paging filter for that pair.

### `opps`

Q1 (opp teams; ref `soql:OpportunityTeamMember`):
```
SELECT Id, OpportunityId, TeamMemberRole, SystemModstamp, Opportunity.Name, Opportunity.AccountId, Opportunity.Account.Name, Opportunity.StageName, Opportunity.CloseDate, Opportunity.Amount, Opportunity.ForecastCategoryName, Opportunity.NextStep, Opportunity.IsClosed, Opportunity.IsWon, Opportunity.SystemModstamp FROM OpportunityTeamMember WHERE UserId = '{{me.org62UserId}}' AND ((SystemModstamp >= {{window.fromSoql}} AND SystemModstamp < {{window.toSoql}}) OR (Opportunity.SystemModstamp >= {{window.fromSoql}} AND Opportunity.SystemModstamp < {{window.toSoql}})) ORDER BY Opportunity.SystemModstamp, OpportunityId LIMIT 50
```

Q2 (my accounts; ref `soql:Opportunity:accounts`). Run it only if `{{org62.accountIds}}` is not empty:
```
SELECT Id, Name, AccountId, Account.Name, StageName, CloseDate, Amount, ForecastCategoryName, NextStep, Type, IsClosed, IsWon, OwnerId, Owner.Name, SystemModstamp FROM Opportunity WHERE AccountId IN ({{org62.accountIds}}) AND SystemModstamp >= {{window.fromSoql}} AND SystemModstamp < {{window.toSoql}} ORDER BY SystemModstamp, Id LIMIT 50
```

Q3 (opps I own; ref `soql:Opportunity:owned`). Run it only when `{{org62.book}}` is `owner` or `both`:
```
SELECT Id, Name, AccountId, Account.Name, StageName, CloseDate, Amount, ForecastCategoryName, NextStep, Type, IsClosed, IsWon, OwnerId, SystemModstamp FROM Opportunity WHERE OwnerId = '{{me.org62UserId}}' AND SystemModstamp >= {{window.fromSoql}} AND SystemModstamp < {{window.toSoql}} ORDER BY SystemModstamp, Id LIMIT 50
```

### `events` (ref `soql:Event`)
```
SELECT Id, Subject, StartDateTime, EndDateTime, DurationInMinutes, Duration__c, SE_Task_Type__c, Meeting_Type__c, RecordType.Name, WhatId, What.Name, What.Type, AccountId, IsChild, Description, CreatedDate, SystemModstamp FROM Event WHERE OwnerId = '{{me.org62UserId}}' AND IsChild = false AND SystemModstamp >= {{window.fromSoql}} AND SystemModstamp < {{window.toSoql}} ORDER BY SystemModstamp, Id LIMIT 40
```
Events page by **40** (a run has about 3 minutes, each Event row is recorded with its payload, and `Description` makes a row longer). `Description` is read only for the `CC#<key>` the app's work-order rows carry (how the app ties a Slackbot-created Event back to its row): record the key as `ccKey` (the part after `CC#`), never the Description text. `StartDateTime` and `EndDateTime` place the Event on the Time page, and `Meeting_Type__c` is what the Workshop / POC read-back checks: record all three on **every** Event row (§4), even when you record nothing else.

### `dcs` (ref `soql:Deal_Contribution__c`)
```
SELECT Id, Opportunity__c, Opportunity__r.Name, Opportunity__r.AccountId, Opportunity__r.StageName, Opportunity__r.CloseDate, Opportunity__r.IsClosed, Opportunity__r.IsWon, SE_Name__c, Opportunity_Role__c, Split_Percentage__c, SystemModstamp FROM Deal_Contribution__c WHERE SE_Name__c = '{{me.org62UserId}}' AND SystemModstamp >= {{window.fromSoql}} AND SystemModstamp < {{window.toSoql}} ORDER BY SystemModstamp, Id LIMIT 100
```

## 3. Traversal rules

- Run only the queries for `{{scope}}`. For `opps`, run Q1, Q2 and (when it applies) Q3 in parallel.
- **`opps`, `events` and `dcs` always run their queries, in every mode (`backfill` included), and page them (§2).** The no-call rule below is for `book` and `missed_opps` only. A windowed run that makes no query has read nothing, and the runner does not accept it as covered.
- `book` and `missed_opps` are **unwindowed** (they read the current state, not changes). In mode `backfill` (an older chunk of a first run, whose head run already read), make **no** Org62 call: `cc_report_coverage` with one window `{kind: "query_window", ref: "soql:<scope>:skipped", from: "{{window.from}}", to: "{{window.to}}"}` and the note `unwindowed scope: read by the head run`, then `cc_finish` complete with `cursor = {value: "{{cursor.value}}" (or `"unwindowed"` when it is empty), at: "{{window.to}}"}`. Every other mode runs §6.
- Never `SELECT` long-text bodies (`Description`, `Comments__c`) in windowed scans: they're not needed and may hold customer detail.
- On `MALFORMED_QUERY` or `INVALID_FIELD`, don't improvise a different query. Report the failed query in `cc_report_coverage.notes`, cover the window you did complete, and finish with `complete: false`.
- Record references only. Never follow a record to another object unless this file lists that query.

## 4. Recording (one record snapshot per row)

**Windowed scopes (`opps`, `events`, `dcs`): the runner records every row of every page for you**, from the query result itself, before you see it (REC-2), with exactly the fields below. You still run every query and read every page: the runner only does the recording. Don't call `cc_record_source_items` for these rows: spend your turns on paging, §5 and coverage. Cite a row by its externalId (`Opportunity:<Id>@<SystemModstamp>`, `Event:<Id>@<SystemModstamp>`, `Deal_Contribution__c:<Id>@<SystemModstamp>`) wherever a tool asks for a `sourceItemId`. Read the next page as soon as a page is full; after 2 pages, finish incomplete with the cursor at the last row you read (§2). The runner checks the cursor against the rows it recorded.

`book` and `missed_opps` rows are still yours to record (§6): `cc_record_source_items` with exactly as many items as the page returned rows (count them before the call; a call takes ≤ 50, so a 100-row page is two calls). Never sample, summarize or drop rows: a skipped row is a gap no later scan fills. Only then read the next page.

The record shape (the runner's for windowed rows, yours for §6 rows):

- `kind: "record_snapshot"`;
- `externalId: "<Sobject>:<Id>@<SystemModstamp>"`, e.g. `Opportunity:006XX0000000001AAA@2026-11-05T15:42:05.000+0000`. For OpportunityTeamMember rows, use the Opportunity's id and `Opportunity.SystemModstamp`, so that both queries produce the same key for an opp;
- `occurredAt` = `SystemModstamp`;
- `title` = the record name (opp name; event subject; DC: "DC on <opp name>");
- `excerpt` = one compact line, under 300 characters:
  - opps: `stage=<StageName>; close=<CloseDate>; amount=<Amount>; forecast=<ForecastCategoryName>; closed=<IsClosed>; won=<IsWon>; next=<NextStep, first 120 chars>; team_role=<TeamMemberRole>` (for team rows, `IsClosed` / `IsWon` are `Opportunity.IsClosed` / `Opportunity.IsWon`);
  - events: `type=<SE_Task_Type__c>; meeting_type=<Meeting_Type__c>; rt=<RecordType.Name>; hrs=<Duration__c or (End−Start)>; what=<What.Name>` (the times are in the payload);
  - DCs: `role=<Opportunity_Role__c>; split=<Split_Percentage__c>; opp_stage=<…>; close=<…>`;
- `oppHints: [<006 id>]`, `accountHints: [<AccountId>, <Account.Name>]`;
- `payload`: the row's scalar fields, copied verbatim with these keys. No long text.
  - opps: `Id`, `AccountId`, `AccountName` (= Account.Name), `StageName`, `CloseDate`, `Amount`, `ForecastCategoryName`, `Type`, `IsClosed`, `IsWon`, `TeamMemberRole`;
  - **events: `StartDateTime`, `EndDateTime`, `DurationInMinutes`, `Duration__c`, `SE_Task_Type__c`, `Meeting_Type__c`, `RecordTypeName` (= RecordType.Name), `WhatId`, `WhatName` (= What.Name), `CreatedDate`, `ccKey` (the `CC#<key>` in Description, the key only; null without one)**. `StartDateTime` / `EndDateTime` are required on every Event row: without them the Event can't be placed on the Time page. A blank field is `null`, never left out;
  - DCs: `Id`, `Opportunity__c`, `Opportunity_Role__c`, `Split_Percentage__c`, `IsClosed`, `IsWon`.

## 5. Extraction rules

**Opps.** An opp row matters when it shows one of these:
- **newly on the team:** the OpportunityTeamMember `SystemModstamp` is in the window;
- a stage change, a close date pulled in or slipped, an amount change of 20% or more, or a NextStep that mentions me, my role, or the work my duties name (Persona block; for an SE: SE, demo, POC, workshop, sizing, architecture);
- closed won or lost.

Link or propose as follows:
- Find homes with `cc_find_candidates({accounts: [Account.Name, AccountId], text: "<opp name> <next step words>"})`. Link `context` to items on that opp/account with `s ≥ 0.5`.
- If the opp is closed lost, link items about that opp as `contradiction` with `opp_closed_lost: <name>`. Don't decide that they're dead.
- Newly on the team with no candidate: only when `{{scan.oppTeamCatchUps}}` = `on`, propose a `follow_up` "Get up to speed on <opp name>" with `guess` confidence (it goes to Triage). With `off` (the default; Settings ▸ Scanning), propose nothing: the opp is on the Opps page, and the cc tool drops the proposal.
- NextStep names a deliverable of mine (my role's, per the Persona block) with a date, with no candidate: propose an `ask` with `likely` confidence, using `oppId` and the due date.
- Closed won, when `{{org62.dcs}}` is not `off`: link `context` to my DC-related items, with reason `closed_won: DC deadline applies`.

**Events.** These are completion signals for "log activity / log hours for X" items: match on the subject and WhatId, and link `completion` with `sure` confidence. They are also evidence of my work on an opp, used by §6. Record hygiene problems in the excerpt only (blank `Duration__c`, the legacy record type "Sales Engineer Events", and a blank `SE_Task_Type__c` when my activity logging needs a task type, per the Persona block). The activity engine owns them. Don't propose items from events.

**DCs.** A new or changed DC row is a `completion` signal for "add/claim DC on <opp>" items (match `oppId` / opp name) with `sure` confidence. My DC on an opp that is closed lost or named "Dead…" is a **stranded DC**: propose a `follow_up` "Move stranded DC from <opp name>" with `likely` confidence, unless a candidate already exists.

## 6. `book` and `missed_opps`: the book read and the missed-opportunity sweep (R-UI-14)

Both are **unwindowed**: they read the current state, not changes, so `{{window.from}}` / `{{window.to}}` only date the run. Keep every run short (one run has about 3 minutes): records stay lean, as below. Every page stays small (ORG-1): keep the LIMITs.

### `book`: every open opportunity in my book (daily, and on the first run)

The windowed `opps` scan never sees an opp that did not change in its window. This read records my **current book** whatever its SystemModstamp; the app treats the latest complete read as the source of truth for "my book". My book is `{{org62.book}}`: B1 runs for `team_member` and `both`, B1o for `owner` and `both`, and B2 unless `{{org62.dcs}}` is `off`.

**Once a day.** If `{{cursor.value}}` is exactly `book:{{window.toDate}}`, today's book is already read: make no Org62 call, `cc_report_coverage` with one window `{kind: "query_window", ref: "soql:book:skipped", from: "{{window.from}}", to: "{{window.to}}"}`, and `cc_finish` complete with `cursor = {value: "{{cursor.value}}", at: "{{window.to}}"}`. Otherwise:

B1 (ref `soql:book`), paged: if it returns 50 rows, run it again with `AND OpportunityId > '<last OpportunityId>'`. Stop after **8 pages**.
```
SELECT OpportunityId, TeamMemberRole, Opportunity.Name, Opportunity.AccountId, Opportunity.Account.Name, Opportunity.StageName, Opportunity.CloseDate, Opportunity.Amount, Opportunity.ForecastCategoryName, Opportunity.Type, Opportunity.SystemModstamp FROM OpportunityTeamMember WHERE UserId = '{{me.org62UserId}}' AND Opportunity.IsClosed = false ORDER BY OpportunityId LIMIT 50
```
B1o (ref `soql:book:owned`), the open opps I own, paged by `AND Id > '<last Id>'` when it returns 50 rows (≤ 8 pages):
```
SELECT Id, Name, AccountId, Account.Name, StageName, CloseDate, Amount, ForecastCategoryName, Type, SystemModstamp FROM Opportunity WHERE OwnerId = '{{me.org62UserId}}' AND IsClosed = false ORDER BY Id LIMIT 50
```
B2 (ref `soql:book:dcs`), my DCs on open opps, paged by `AND Id > '<last Id>'` when it returns 100 rows (≤ 8 pages):
```
SELECT Id, Opportunity__c, Opportunity_Role__c, Split_Percentage__c, SystemModstamp FROM Deal_Contribution__c WHERE SE_Name__c = '{{me.org62UserId}}' AND Opportunity__r.IsClosed = false ORDER BY Id LIMIT 100
```
Run the book queries that apply in parallel. Record each page right after reading it (one `cc_record_source_items` call per page, ≤ 50 items). The records are lean, **no `payload`**: everything goes in the excerpt, and every row carries this run's stamp `{{window.to}}`, verbatim.
- B1 / B1o row (one per opp: a second team role on the same opp, or an opp I own and am on the team of, is the same row; a B1o row has `team_role=owner`, and its `Id` and own fields stand for `OpportunityId` and the `Opportunity.` fields): `kind: "record_snapshot"`, `externalId: "Book:<OpportunityId>"` (no modstamp), `occurredAt` = `Opportunity.SystemModstamp`, `title` = `Opportunity.Name`, `excerpt: "book_at={{window.to}}; stage=<StageName>; close=<CloseDate>; amount=<Amount>; forecast=<ForecastCategoryName>; type=<Type>; team_role=<TeamMemberRole>"`, `oppHints: [OpportunityId]`, `accountHints: [AccountId, Account.Name]`.
- B2 row: `kind: "record_snapshot"`, `externalId: "BookDc:<Id>"`, `occurredAt` = `SystemModstamp`, `title: "DC"`, `excerpt: "book_at={{window.to}}; role=<Opportunity_Role__c>; split=<Split_Percentage__c>"`, `oppHints: [Opportunity__c]`.
- Then **one** manifest: `kind: "record_snapshot"`, `externalId: "BookRun:{{runId}}"`, `occurredAt: "{{window.to}}"`, `title: "Book read"`, `excerpt: "book_at={{window.to}}; rows=<Book rows recorded>; dcs=<B2 rows recorded, 0 when B2 did not run>; complete=<true|false>"`. `complete=true` only when every query that applies ended before the page cap, with no error, and every row was recorded. The app marks opps that left my book only from a complete manifest whose rows all arrived, so count `rows` exactly.

Book rows are the observation log: don't link or propose from them (the `opps` scan does that for changes). Then `cc_report_coverage` (each ref that ran: `soql:book`, `soql:book:owned`, `soql:book:dcs`, over the full window) and `cc_finish` complete with `cursor = {value: "book:{{window.toDate}}", at: "{{window.to}}"}`.

### `missed_opps`: opportunities I logged time on with no DC of mine (daily)

Window = since the last sweep; the queries below are not windowed. Coverage refs are `soql:missed:<step>`, each with `from: "{{window.from}}"` and `to: "{{window.to}}"`. Run the four steps in order, then record: that is the whole run (about 6 tool calls). Don't propose items and don't call `cc_find_candidates`: the app's deals engine turns these rows, the book and my other evidence (meetings, files, sessions) into the Missed list, where I claim or dismiss.

1. **My logged hours per opportunity (H).**
   ```
   SELECT WhatId w, SUM(Duration__c) h, COUNT(Id) n FROM Event WHERE OwnerId = '{{me.org62UserId}}' AND IsChild = false AND StartDateTime = LAST_N_DAYS:180 AND What.Type = 'Opportunity' GROUP BY WhatId LIMIT 500
   ```
   H = every `w` with its hours `h` (a blank `h` is 0).
2. **Candidates (C): those opps with a D360 signal.** Up to 100 ids of H per query; 2a and 2b in parallel.
   - 2a, a D360 or Flex line item:
     ```
     SELECT Id, Name, AccountId, Account.Name, StageName, CloseDate, Amount, Type, IsClosed, IsWon FROM Opportunity WHERE Id IN (<H ids>) AND Amount > 10000 AND (IsClosed = false OR (IsWon = true AND CloseDate = LAST_N_DAYS:90)) AND Id IN (SELECT OpportunityId FROM OpportunityLineItem WHERE TotalPrice > 0 AND (Product2.Name LIKE '%Data 360%' OR Product2.Name LIKE '%Data Cloud%' OR Product2.Name LIKE '%Data Services%' OR Product2.Name LIKE '%Profiles%' OR Product2.Name LIKE '%Marketing Data Bundle%' OR Product2.Name LIKE '%Private Connect%' OR Product2.Name LIKE '%Flex Credit%')) LIMIT 100
     ```
   - 2b, D360 words in the name:
     ```
     SELECT Id, Name, AccountId, Account.Name, StageName, CloseDate, Amount, Type, IsClosed, IsWon FROM Opportunity WHERE Id IN (<H ids>) AND Amount > 10000 AND (IsClosed = false OR (IsWon = true AND CloseDate = LAST_N_DAYS:90)) AND (Name LIKE '%D360%' OR Name LIKE '%Data 360%' OR Name LIKE '%Data360%' OR Name LIKE '%Data Cloud%' OR Name LIKE '%DataCloud%' OR Name LIKE '%Zero Copy%' OR Name LIKE '%Headless 360%') LIMIT 100
     ```
   C = 2a ∪ 2b. If C is empty, skip to coverage and finish.
3. **Lines and DCs of C**, in parallel (≤ 100 ids per query):
   ```
   SELECT OpportunityId, Product2.Name, TotalPrice FROM OpportunityLineItem WHERE OpportunityId IN (<2a ids>) AND TotalPrice > 0 AND (Product2.Name LIKE '%Data 360%' OR Product2.Name LIKE '%Data Cloud%' OR Product2.Name LIKE '%Data Services%' OR Product2.Name LIKE '%Profiles%' OR Product2.Name LIKE '%Marketing Data Bundle%' OR Product2.Name LIKE '%Private Connect%' OR Product2.Name LIKE '%Flex Credit%') LIMIT 500
   ```
   ```
   SELECT Opportunity__c, SE_Name__c, SE_Name__r.Name, Opportunity_Role__c, Split_Percentage__c FROM Deal_Contribution__c WHERE Opportunity__c IN (<C ids>) LIMIT 500
   ```
   - **`signal`:** `d360` when the opp has a line whose `Product2.Name` contains `Data 360`, `Data Cloud`, `Data Services`, `Profiles`, `Marketing Data Bundle` or `Private Connect` (ignore lines containing `Provisioning` or `Foundations`), or when it came from 2b; `flex_only` when its only lines are Flex Credits (they can be Agentforce or D360). Replace these token lists with `{{missed.productTokens}}` / `{{missed.nameTokens}}` when the Run block gives them.
   - `d360_amount` = the sum of its D360 lines, `flex_amount` = the sum of its Flex lines.
   - Drop every opp that has a DC with `SE_Name__c = '{{me.org62UserId}}'`. For the rest, note other DCs whose `Opportunity_Role__c` is like `AI%Data Architect` ("Name 100%"): a split conversation, not a second 100% claim.
4. **Record** the remaining opps in one `cc_record_source_items` call (≤ 50 per call): `kind: "record_snapshot"`, `externalId: "MissedOpp:<Opp Id>"` (stable, **without** a modstamp, so re-sweeps update rather than duplicate), `occurredAt: "{{window.to}}"`, `title: <opp name>`, `excerpt: "signal=<d360|flex_only>; hours=<h>; d360_amount=<n>; flex_amount=<n>; stage=<StageName>; close=<CloseDate>; amount=<Amount>; closed=<IsClosed>; won=<IsWon>; other_architect_dc=<Name %, …|none>"`, `oppHints: [Id]`, `accountHints: [AccountId, Account.Name]`, `payload: {Id, AccountId, AccountName, StageName, CloseDate, Amount, Type, IsClosed, IsWon, signal, hours, d360Amount, flexAmount, products: [<D360 / Flex product names>], otherArchitectDc: "<Name %, …|none>"}`.

## 7. Linking rules

These are the R5 steps with Org62 joins.
1. **Hard join.** A candidate whose title or why contains the opp id or the exact opp name.
2. **Soft join.** `accounts` + opp-name keywords.

Use `sure` for a hard join or an exact DC/event match, `likely` for an account + keyword match, and `guess` for anything weaker. The R-UI-22 rule applies too: for items handed off, or where I'm a watcher, Org62 changes are `context` only. Org62 rows are never direct asks, so they never loop back.

## 8. Redaction

Org62 rows rarely hold secrets, but still apply R6 to `NextStep` and `Subject`. Never record `Description` or `Comments__c`.

## 9. Stop condition and coverage

Stop when every query for the scope has run with paging and every relevant row is recorded and linked or proposed.
- `cc_report_coverage.windows`: one entry per query ref with `kind: "query_window"`, `from: "{{window.from}}"`, `to: "{{window.to}}"` (or the paged-out end). `book` and `missed_opps` report their refs over the full window (they read the current state); a book that hit the page cap is a `BookRun` with `complete=false`, not a paged-out cursor.
- `cc_finish`:
  - complete: `cursor = {value: "{{window.toSoql}}", at: "{{window.to}}"}`, `complete: true`;
  - paged out: per §2.

## 10. Worked examples (placeholders only)

**O1. Close date pulled in.** Q1 returns `Opportunity:006XX0000000001AAA@…`, "ACME – Data 360 Expansion", close moved from 2027-03-31 to 2026-12-15, NextStep "SE demo of zero copy before 12/1".
- The runner has recorded it: cite `Opportunity:006XX0000000001AAA@…`.
- Candidates: `wi_40` "Build ACME zero-copy demo" (s 0.62, account + keywords) → link `{role: "context", confidence: "likely", reason: "close date pulled in to 2026-12-15; next step: SE demo before 12/1"}`.

**O2. Added to an opp team.** The OpportunityTeamMember `SystemModstamp` is in the window, I'm a "Solutions Engineer" on "GLOBEX – Agentforce Pilot", and there are no candidates. With `{{scan.oppTeamCatchUps}}` = `off` (the default), record the row and propose nothing. With `on`, propose `{kind: "follow_up", title: "Get up to speed on GLOBEX – Agentforce Pilot", oppId, confidence: "guess", evidence: [{role: "origin", reason: "added to opp team"}]}`.

**O3. DC added (completion).** The `dcs` scan returns my new DC on `006XX0000000002AAA`. Candidate `wi_51` "Claim DC on INITECH – Data Cloud Phase 2" is a hard join on the opp name. Link `{role: "completion", confidence: "sure", reason: "Deal_Contribution__c created, AI + Data Architect 100%"}`.

**O4. Missed opp (the sweep records, the app decides).** Step 1 gives 3.5 logged hours on `006XX0000000003AAA`; 2a returns it ("UMBRELLA – Data 360 Flex Credits", $180,000) with a `Data 360 Profiles` line of $120,000; step 3 finds no DC from me and none from another architect. Record `MissedOpp:006XX0000000003AAA` with `excerpt: "signal=d360; hours=3.5; d360_amount=120000; flex_amount=0; stage=Proposal; close=2026-12-31; amount=180000; closed=false; won=false; other_architect_dc=none"` and the payload. Propose nothing: the app lists it under Deals ▸ Missed as Claim, with the evidence.

**O5. Event read-back closes a logging task.** The `events` scan returns a "Solutions Event", "Customer Presentation", WhatId `006XX0000000001AAA`, Subject "ACME – POV readout". The runner records it with `payload: {StartDateTime: "2026-11-05T16:00:00.000+0000", EndDateTime: "2026-11-05T17:00:00.000+0000", DurationInMinutes: 60, Duration__c: 1, SE_Task_Type__c: "Customer Presentation", Meeting_Type__c: null, RecordTypeName: "Solutions Event", WhatId: "006XX0000000001AAA", WhatName: "ACME – Data 360 Expansion", CreatedDate: "2026-11-05T18:02:11.000+0000"}`. Candidate `wi_60` "Log ACME POV readout in Org62" (hard join on the subject) → link `completion` with `sure` confidence.

**O6. The book read.** `book`, mode `head`, `{{cursor.value}}` empty, `{{window.to}}` = `2026-11-06T13:00:00.000Z`. B1 returns 2 rows: "GLOBEX – Agentforce Pilot" (`006XX0000000004AAA`, Solutions Engineer) and "ACME – Data 360 Expansion" (`006XX0000000001AAA`); B2 returns my DC `a0XXX0000000001AAA` on `006XX0000000001AAA`. Record `Book:006XX0000000004AAA` and `Book:006XX0000000001AAA` (`excerpt: "book_at=2026-11-06T13:00:00.000Z; stage=…"`), `BookDc:a0XXX0000000001AAA`, then `BookRun:<runId>` with `excerpt: "book_at=2026-11-06T13:00:00.000Z; rows=2; dcs=1; complete=true"`. Link and propose nothing, and finish with `cursor = {value: "book:2026-11-06", at: "2026-11-06T13:00:00.000Z"}`. The next `book` run that day sees `{{cursor.value}}` = `book:2026-11-06` and makes no Org62 call.
