# Control Center — UX

The goal is that you spend your day here and only leave through a one-click handoff. The bar is *tenet-level*: if a screen makes you think "where do I start?", it's a bug.

## Principles

1. **Top 3 first.** The landing screen leads with three things to do now. Everything else is collapsed into counts ("12 more today · 4 waiting on others · 9 in triage").
2. **Every row is actionable in place.** Each row offers Reply, Draft, Approve, Log, Snooze, Done or Dismiss without leaving the app. The source link is always present as `↗ Slack` / `↗ Gmail` / `↗ Org62`.
3. **Why, on hover.** Every rank, mapping and "likely done" shows its reasoning and its evidence links.
4. **Suggestions are separate from commitments.** Auto-detected items land in **Triage** until you accept them, or auto-accept when confidence is high. Your **Today** list is never polluted by guesses.
5. **Batch the boring.** Logging hours, VDP gaps and triage are designed as 5-minute *rituals* (Friday log, Monday plan) with keyboard flow: `j/k`, `a` approve, `e` edit, `s` snooze.
6. **Calm notifications.** One morning brief, a pre-meeting nudge 10 min before customer calls, deadline alarms, and urgent DMs from your watch-list. Nothing else.
7. **Keyboard-first plus a command palette.** `⌘K` searches everything and runs commands ("log last meeting to ACME", "draft reply", "what did I promise Dana").
8. **Live, never jarring.** Every page updates on its own as things happen (push, not polling), and nothing moves under you. See "Live updates" below.

## Live updates (2026-11-14)

You never refresh. Sitting on any page, you see real things come in: the backend pushes what changed and each view applies it in place. The bar is that nothing ever jumps under your cursor or your eyes.

**Push, not polling.** One `EventSource` per tab (`GET /api/v1/events`, `src/client/live.ts`) carries `{topic, ids, reason}`. Every database change publishes: the audit trigger for audited tables, `0026_live_notify` for the bookkeeping tables (jobs, scan runs, tool runs, app events, worker instances, the VDP / Forecast / Org62 / landing mirrors), the worker's own events for its catch-up progress, and the web app notices a worker that stopped beating. One table → topic map (`src/server/events/topics.ts`) serves both buses.
- A burst refetches once: a topic's events within 120 ms make one refetch, and chatty topics (jobs, scans, health, tool runs) refetch at most every 1.5 s, always with a last one after the burst.
- A view built from other topics follows them (`useLiveFollow`: Home follows items, outbox, health, deals…; a VDP push, a backfill and a Forecast sync follow `jobs` while they run).
- The clock is an event too: Home and Today refetch right after a meeting start or end, or a due time, they show (`useRefetchAtBoundaries`).
- Polling is only a safety net where push can't see a change: Today, Health and Home every 5 minutes (worker heartbeat, "in 10 min" labels). Nothing polls every few seconds.
- When the stream drops (sleep, a deploy, a restart), the sidebar's status line says "Reconnecting…" in grey after a few seconds, never at once. When it's back, every view refetches once, so nothing is stale after a wake. A silent connection (no frame for 45 s, or a timer gap that means the Mac slept) is reopened.

**One pattern, every list** (`src/components/lists/live-list.ts`, `useLiveList`; the merge is pure, `live-merge.ts`):
- **Stable order.** Rows already on screen never move because of a background refresh. A re-sort by the server waits until you change tab, filter or page. Ranked lists (Today's run of the day, Agents' groups) keep their own explicit apply: "Re-rank ready · N" and "N changed · Re-group".
- **Arrivals enter at their natural place** (before the next row the server puts after them; the top of a newest-first list), with a short tint that settles in about 3 s: blue for something new, violet for what the AI made (drafts, Triage and Needs-you suggestions). Never a flash, never a toast.
- **The pill.** When more than three arrive at once, or you are scrolled down or interacting (the pointer moving over the list, a button pressed, typing in a field in it), arrivals wait behind a calm "N new · Show" pill at the top of the list. A few that waited only for your pointer to rest slide in on their own; Show places them all and brings the first into view. A list that can hold always draws the pill (tests/live/held-pill.test.ts: a held row with no pill is a row you cannot see). Lists of what waits on you (Log it ▸ Ready to log, Needs you) never hold a burst: rows you approve or that come in for you show at once, and only typing in a row holds them, behind the pill; Log it's button always counts every row it takes, held or not.
- **Departures fade in place.** A row done, sent or applied elsewhere fades where it is, then collapses (under 2 s). A row you removed yourself leaves at once (the app tells yours from elsewhere: `src/client/intent.ts`). Undo puts a row back where it was.
- **Selection, focus and scroll survive.** The selected row stays selected when rows arrive above it; a section's cap grows to keep it in view. If it leaves, the selection moves to its neighbour (j/k keep their row), never back to the top.
- **The open panel stays on its item.** Fresh data updates its fields in place. If the item leaves its list because of something elsewhere, the panel does not close or jump: it says so ("Sent or applied elsewhere", "Handled elsewhere", "Changed elsewhere") with Next and Close, and its row stays, dimmed, until you move on. When you acted on it here, the panel moves on to the next one as before.
- **A field you are editing keeps your text.** If it changed elsewhere meanwhile, the field says "Changed elsewhere: <their value> · Keep mine · Take theirs" (detail fields, Activity hours). Untouched fields update in place.
- **No loading flashes.** A background refresh never shows a skeleton, an empty state or an error over data you can see (a failed refresh keeps the last data; the lists that can say "Couldn't refresh"). Counts and badges update in place with a small tick.
- **Toasts only for what you did** (a send you approved verified, a run you started finished) or must act on (a new build to reload). Background events never toast.

Per page: **Home** (cards and rows arrive marked, Do now keeps three while one fades out), **Today** (arrivals join below with "N new ↓", "Re-rank ready" applies a new order), **Triage**, **Outbox** (a new draft lands above the one you selected), **Work**, **Deals** (needs and accounts), **Briefs**, **Agents** (runs live; the layout holds while you hover or have one open), **Activity** (Log it's ready rows and runs, Needs you's suggestions, VDP push progress), **Health** (connectors keep their place; a state change repaints the row) and the sidebar counts all follow the pattern. The mock scenario clock (`CC_SCENARIO=1`) plays arrivals in the first minute: a draft, a Triage suggestion, a Needs-you row, an agent run, then a draft sent elsewhere and a canvas applied in Slack.

## Views

| View | What it answers | Key elements |
|---|---|---|
| **Today** (home) | "What do I do now?" | Top 3 cards; Now / Next / Later; today's meetings with prep briefs and "after" capture; deadline banner (e.g. *Q3 log due Fri 12 PT: 8 days, 0 / ~N h logged*); waiting-on-others strip |
| **Triage** | "What came in that might be a task?" | Auto-detected asks, promises and meeting next steps; accept / edit / dismiss; mapping questions ("Is this ACME or Globex?") |
| **Commitments** | "What did I say I'd do, and did I?" | Said-by-me ledger: promise → due → status → evidence; on-time rate; drafts of "sorry, by X instead" when slipping |
| **Deals** | "Where does each opportunity stand from my side?" | Summary tiles (open pipeline, this quarter, won, closing in 30 days, needs attention) and pipeline by fiscal quarter, each number a link to its deals; per-opp page: stage, close, my hours QTD, VDP status (checklist from the VDP owner's rules), DC status, open tasks, notes timeline, decks, Slack channel, Claude sessions |
| **Activity** (was Time; `/activity`, `/time` redirects) | "What goes to Org62 and VDP, where did it land, and is it logged?" | Two main tabs, **Org62** and **VDP** (D-70). Org62, one job per tab: **Log it** (only logging: the quarter header (in Org62 vs target, waiting on you, pace, where a canvas's hours landed), then Ready to log: the rows, the updates to Events already in Org62 ("update · Duration 2 h → 3 h", approvable like a row) and the use cases ready for Org62, each ticked the same way, one button naming them all; then Logging runs: each canvas its own item, Staged → Apply → Tell Slackbot → In Org62, with **Its writes** exactly as sent) · **Needs you** (only what needs you, across the quarter: rows grouped by what is missing with the app's suggestion and Accept, multi-select, how it came in (D-71); then the use cases with a question: the opp it goes on, a name, a value to pick) · **Weeks** (a week picker: the quarter's weeks and the one before, each with the hours found and how much is in Org62; then that week's Suggested, onsite days, Week at a glance and its rows) · **Ledger** (a report, rows one click deeper: pick a fiscal quarter (the current one by default) or All; how it's tracking; where the hours went by account and opportunity, task type and week; a line or week opens its rows, `docs/ui/time-redesign.md`) · **Use cases** (each use case with its account and opp, "Org62 ✓ · VDP —" for neither, one or both, what goes on the next canvas; open one for both landings, the fields that differ with which side changed and Use Org62's / Use VDP's (the other side is corrected on the next canvas or push), its assets (VDP only) and every write) · Forecast (the AE's) |
| **Activity ▸ VDP** (D-59, D-60, D-63) | "What has to go into VDP, and can the app push it?" | **Changes**: a tree, Company → VDP → items. A company VDP lacks is the top item (create it), then the VDP to create under it, then that VDP's items; a company VDP knows with no VDP starts at the VDP; a VDP that exists lists only what is missing, in sections: Opportunities, People (the AE from the Specialist Forecast, the TA = you), Use cases (Generate under its inputs), Assets (each strong candidate, else Find assets), Header. Only open opps where your DC is 100% count. A checkbox on every item the app can push now; ticking a node ticks what is under it, a child of a company or VDP that does not exist yet ticks those too; items that need values (use-case inputs, an AE no forecast names, the entitlement) fill in inline. "Push N to VDP" runs them in order and passes each new id down; a confirm lists them first; a row's own Apply is the same push. What VDP's MCP can't take yet is shown disabled, with the reason, and turns pushable once VDP lists the tool. No Copy, no handoffs: "Open in VDP ↗" only views a VDP. **My VDPs**: who is on each VDP, its use cases and assets, "N missing"; past ones folded, and a current VDP whose account has no 100% DC of yours yet reads "Waiting for your DC" (D-69). **Company identity (D-69)**: each company node says which VDP company it is and how the app decided ("VDP has “Globex” · by VDP's own name rule, up the Org62 chain · 2 Org62 accounts"): a badge for its state (Needs you in the act color; Suggested · 86% in the AI color for the judgment; Yours for your mapping; Not looked up yet; N VDPs you're not on; Archived in VDP) and its one-line reason. **Change…** (or **Confirm or change…** on Needs you) opens one dialog: the current pick pre-selected (the best guess when it needs you) and the alternatives, a search over VDP's companies (read-only), "Create a company with this name" with a name you type, and the Org62 accounts in it (its own checked, its relatives and your other engaged accounts to add). Save keeps your mapping on every read and everywhere (the tree, the linking, the push), with Undo in the toast and **Reset** on the node. A node that needs you, or whose names are not looked up yet, keeps everything under it disabled with the reason. The push bar says "Sign in to VDP first" and keeps Push off while VDP's sign-in is stale (a dry run still records). An item that may already be in VDP reads "maybe made: a push looks in VDP first". Color marks state only (act, staged and waiting neutral, failed, AI for suggestions) |
| **Outbox** | "What's ready to go out?" | Drafts by destination; approve / edit / reject; handoff cards with deep links and copy payloads; verified / unverified status |
| **Goals** | "Am I on track for the big stuff?" | Quarterly targets, deal milestones, personal deliverables; burn-down; capacity vs commitments for the next 3 weeks (from your OOO after-action artifact) |
| **Search** | "Find that thing" | FTS across all items, tasks and drafts |
| **Settings / Health** | "Is everything connected?" | Per-connector status, last sync, auth actions (refresh cookie, `/mcp` hints), autonomy levels, watch-lists |

## Activity (was Time): internal-only activity and declined meetings (D-64)

- **Work for no customer never asks for an opportunity.** A repo or Drive docs no account matches, or a meeting with no customer, account or opp that names internal work (a certification, an enablement session, a demo build), is internal-only activity: a Solutions Event with Related To empty and an internal type (Asset Creation, Personal Development, Sales Enablement, Travel). It is never in Needs you, Home or the sidebar.
- **Log it ▸ Internal (no opportunity)** is a quiet group under the Log it steps (no warning color: nothing is wrong). Each row: its day and hours, what it was (with its sources), its type (the internal types), **Log** (it goes on the next canvas like any approved row), **Dismiss** (Dismissed by you), and **More** ▸ *Dismiss all from <source>* (a repo, unmapped Drive docs, a recurring meeting) or *Log to an opportunity instead*. Header: **Log all** · **Dismiss all**, one toast with one Undo.
- **A row the app can't classify** stays in Needs you; the opportunity pickers (the row's and the bulk "Set opp for these N rows") offer **Internal (no opportunity)**, which completes the row (it moves to Ready to log). A row can switch to internal and back.
- **Dismiss all from <source>** is remembered: today's rows and every new one of that source are *Dismissed by your rule*. Settings ▸ Time ▸ **Dismissed sources** lists each rule with **Remove**; the rows come back as proposals.
- The **Ledger** shows internal rows as *Internal*; the type pickers offer your role's real SE Task Types.
- **A meeting you declined never shows on Time.** Declined after you accepted: its row goes; one already handed off or in Org62 stays, flagged ("You declined this meeting…"), and the app never deletes the Org62 Event.

## Activity (was Time): the Org62 round trip (D-65)

- **Not in Org62** is the first group of Time ▸ **Needs you** (`/time?view=needs`): rows handed to Slackbot that Org62 does not have after all. "Deleted in Org62" (its Event was deleted there) or "Not in Org62: the canvas ran without it" (Org62 shows later Events of yours, none for this row). Each row: **Log again** (back to approved; the next *Log these* puts it on a canvas, the Org62 check confirms it) and **Leave out** (dismissed by you; Restore from the Ledger). The row's details panel offers the same two. These rows never count as logged hours.
- **The week's rows and the Ledger** say where a row stands against Org62: *Not in Org62*, *Deleted in Org62* (danger), *Differs from Org62* (in Org62 with other values: it counts, its issue says what differs), *Unconfirmed*. A second Org62 Event in a slot shows as its own logged row, flagged "possible duplicate in Org62: '…' is the same slot; delete one there"; a manual Event that overlaps one of your rows logs too ("overlaps … (both log)"). A customer type with Related To empty says so. Nothing is hidden.
- **Logged by hand, the app follows.** A row you approved and then logged yourself in Org62 (another subject, another start) closes as verified with Org62's values ("Logged in Org62 by hand: the row takes its values"); it never goes on a canvas. An Event you edit in Org62 (hours, start, end, opp) updates the row once. One Event that covers two meetings closes both.
- **Apply re-checks the canvas.** When a row on a staged canvas was logged by hand, declined, cancelled, dismissed or edited since, Apply refuses with "The canvas changed since you staged it: N rows left out: …. Review it and Apply again": the item is re-rendered without them, and you Apply what you now see. With nothing left, the item is discarded ("Nothing left to log …"). Editing a row a canvas item holds takes it off that canvas (it goes on the next one, as edited). A canvas item never applied for 14 days expires with a Health notice.
- **Weeks are your timezone's weeks** (Monday 00:00 local), the same as the projections.

## Deals: the DC round trip with Org62 (D-68)

- **Org62 wins, and the app says what it closed.** A DC you asked for and then made by hand in Org62, at any split, shows **Confirmed in Org62** on Deals ▸ DCs; it never goes on a canvas. A change still waiting whose DC someone changed in Org62 is **Withdrawn** with the reason on the row ("Org62 now shows your DC at 75% … never overwrites it"), as is a change whose DC was removed. Nothing the app closes is silent.
- **Not created in Org62** (a group of its own at the top of Deals ▸ DCs, amber "Not created" badge): a canvas handed the request to Slackbot and a complete Org62 read since shows no such DC. The row says so and offers **Ask again** (the claim form, prefilled; the new request waits for your next canvas). The opp is a DC gap on Deals again, and its account page says "DC request not created in Org62".
- **Chase** lists a DC request that went to Slackbot and isn't in Org62 yet ("Umbrella Health: DC requested on <opp> · With Slackbot since 10 Nov, not in Org62 yet"), Snooze 1 week or Not needed as before.
- **Log & fix** counts the same opps on Home and Deals: Home's row is "Claim DC on N opps" and opens Deals (one account: its Claim DC). Claim DC on Deals also marks the opp's Missed finding claimed.
- **Why an opp is a gap** gains "on a VDP you're on" (a VDP where you are AE, TA, a collaborator or its creator links the open opp); the claim form's evidence line says "A VDP you're on links it".
- **Two DCs of yours on one opp** read as their sum ("Your DC: 100%"); a change request there is refused with why (change them on the opp in Org62).
- A Not needed DC gap names its quarter: in a new quarter, 2 h of that quarter's work bring it back.

## Composer (Phase 4)

- **Rich editor** (TipTap) with round-trip to Slack mrkdwn and Gmail HTML. It supports @mentions resolved via Slack, emoji, links and code.
- **Draft panel:** an AI draft in your voice, with alternatives (shorter / more formal) and sources quoted alongside.
- **Send options:** Send now (L3), Push as Slack/Gmail draft (L2), Schedule.
- **Thread context** is shown above the editor, so you never need to open Slack to reply.

## Starting point

Your artifact `~/Claude/Artifacts/ooo-slack-after-action-report/index.html` (P0–P2 priorities, RAG status, capacity model, your-hours vs Claude-hours split) is the visual seed for **Today** and **Goals**. Reuse its information design and replace localStorage with the real store.

## Activity: where every record lands (D-70)

- **Landings, not guesses.** Every record the app writes or reads back has a landing per system (Org62, VDP): not sent,
  staged, sent, in it (verified), differs, missing. A use case has both, so "Org62 ✓ · VDP —" says neither, one or both.
- **Writes are history.** Every create, update or delete a canvas or VDP item carries is kept with what it sent (an
  update: before → after) and its state (waiting for Apply, sent, in Org62, taken off before Apply, rejected). A run's
  writes, a row's "Where it landed" and a use case's writes all read the same way. Nothing is ever rewritten: a later
  canvas that changes an Event is a second write, "update · Duration 2 h → 3 h".
- **Differences are yours to settle.** Where Org62 and VDP disagree on a use case's name, product, stage or go-live,
  both values show with the side that changed since they agreed; you pick the right one, and the wrong side is
  corrected the next time you log (Org62) or push (VDP). Nothing is merged on its own.
