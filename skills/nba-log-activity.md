---
name: nba-log-activity
version: 2
verb: log_activity
model: claude-haiku-5-5
output: plan (activity_rows), Org62 Event rows (the Persona block's record type) for handoff
primary: Log
---

# NBA verb: log_activity

Turn time blocks the time engine has already collected (meetings, focused build time, doc-edit sessions) into Org62 Event rows of the record type the Persona block's activity logging names (an SE logs **Solutions Events**, an AE **Sales Events**), ready for handoff. This verb exists only while activity logging is an active feature. The Org62 connector is read-only, so the rows go to the activity-logging Slackbot skill, the Activity Editor, or a CSV. You classify; you never invent time.

## Hard rules (*Hours are human hours*)

- Use **only** the blocks in `verb_context` ("time blocks to classify"). `blockId` must be one of their ids.
- `start` and `end` come from the block. You may shorten a row (for example, when only the first 30 minutes of a block was customer work, per the evidence). You may never extend it, merge blocks into a longer span, or move it.
- Skip blocks marked `ALREADY LOGGED`, and put them in `skipped` with reason "already logged" (de-dupe on subject + start + owner).
- Claude or agent background time is not his time. A `claude` block is his time only if the block itself says it was hands-on (the time engine already separated active spans).
- Personal blocks are excluded and listed in `skipped`: lunch, OOO, focus with no work evidence, travel without a customer purpose.
- `totalHours` is the sum of row durations, rounded to 0.25.

## Classification

When the Persona block's activity logging says "each with an SE task type", `seTaskType` must be one of the `SE task types (verbatim)` in `verb_context`. Copy the exact string. The counts tag (`CF+CR`, `CR`, `neither`) comes from that list. When it does not (an AE's Sales Events), leave `seTaskType` null and skip the task-type rules below; customer-facing and the hours rules still apply.

Default rules (the team pack's taxonomy wins if it differs):

1. **External attendees present → customer-facing.** Set `customerFacing: true` and use a CF type. Swap a CR-only type to its customer-facing equivalent:
   - Account Planning → Customer Discovery;
   - RFx, Dry Run or Travel → Customer Presentation;
   - Solution Creation → Workshop;
   - BVS - Value Hypothesis → Business Value Assessment.
2. **Recurring internal syncs** → Admin. **Solo prep or build for a specific deal** → Solution Creation. Don't use Solution Creation as a catch-all: a customer demo is Customer Presentation, discovery is Customer Discovery, and a POC is POC.
3. **Events, keynotes and conference booths** → Marketing Support.
4. **Post-sale types** (Post Sale Adoption Support, Post Sale Technical Support, Post Sale Consumption Activation) are only for genuinely post-sale work. Leaders flagged mislabeled post-sale hours.
5. **Related To** (`relatedTo`), in waterfall order:
   1. the **open Opportunity** for presales work (the block's opp hint, if open);
   2. otherwise the **Account**;
   3. then a DSR, a Strategic Initiative, and finally the personal catch-all.

   Presales work goes on the opportunity, not the account. If the opp hint is marked closed, check that the block date is before the close. If you can't tell, use the account and lower the row confidence to `likely`.
6. **Subject:** short and factual, e.g. "ACME discovery: unified profile". No internal jargon or Org62 ids.
7. **Description:** one or two sentences on what was done, drawn from the evidence. It is internal (Org62), so naming the account is fine.

`confidence` per row:

- `sure`: a calendar meeting with an account hint and a clear purpose;
- `likely`: inferred mapping or type;
- `guess`: the account or type is unclear. Also add an ask.

## The plan (`plan.kind: "activity_rows"`)

```json
{
  "kind": "activity_rows",
  "rows": [{
    "blockId": "blk_1", "date": "2026-11-04", "start": "2026-11-04T15:00:00-07:00", "end": "2026-11-04T16:00:00-07:00",
    "subject": "ACME discovery: unified profile", "seTaskType": "Customer Discovery", "customerFacing": true, "counts": "CF+CR",
    "relatedTo": { "type": "opportunity", "id": "opp_1", "name": "ACME Data 360 expansion" },
    "description": "Discovery on unified member profile and agent handoff with ACME architecture team.",
    "evidenceIds": ["blk_1", "ev_31"], "confidence": "sure"
  }],
  "skipped": [{ "blockId": "blk_3", "reason": "already logged" }],
  "handoff": "slackbot_skill",
  "totalHours": 1.0
}
```

`handoff` is `slackbot_skill` by default (batch), `activity_editor` for one or two rows, and `csv` for more than 15 rows.

## The card

- **title:** "Log 4 activities for Tue–Wed (3.5 h)".
- **why:** a deadline or gap, e.g. "Q3 logging closes Fri 12:00 PT; 3.5 h unlogged this week".
- **effort:** `youMin` 3–10 to review the rows; `agentMin` 0. Estimate hands-on minutes only, and err low; agent or background time goes in `agentMin`.
- **startBy:** before the logging deadline in `verb_context` (quarter or weekly), otherwise `null`.
- Only when deal contributions are an active feature in the Persona block: also add an ask when an opportunity has no Deal Contribution for him and the team requires one. The evidence or verb_context will say so.

## Update rule specifics

- New blocks get new rows. A changed opp hint changes `relatedTo`. Put both in `update.diff` with `draftPolicy: "no_draft"`.
- If he edited a row (a locked field in `previous_nba`), keep his value and propose changes only in `update.diff`.

## Worked example (placeholders)

Blocks:

- `[blk_1]` Tue 15:00–16:00 · calendar · "ACME discovery" · external attendees · opp hint ACME Data 360 expansion [opp_1] (open)
- `[blk_2]` Tue 16:00–17:30 · claude · "Build ACME demo org data model" · account hint ACME [acc_1]
- `[blk_3]` Wed 09:00–09:30 · calendar · "Team weekly sync"
- `[blk_4]` Wed 12:00–13:00 · calendar · "Lunch"

Rows:

- `blk_1`: Customer Discovery (CF+CR), on opp_1, sure.
- `blk_2`: Solution Creation (CR), on opp_1. It is presales build for that open opp, so `relatedTo` is the opportunity, with confidence likely.
- `blk_3`: Admin (neither), on the catch-all, sure. Log it only if the team logs "neither" types; otherwise put it in skipped with reason "neither type, not logged by policy".

Skipped: `blk_4`, "personal (lunch)".

`totalHours`: 2.5, or 3.0 if blk_3 is logged.
