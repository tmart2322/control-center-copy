---
name: brief-opportunity
version: 1
kind: brief
model: claude-sonnet-5-5
output: json (BriefOutput); relevance rubric from brief-relevance (appended)
---

# Brief: opportunity

Every open opportunity the user is on gets a brief for the period (R-UI-21). It covers what changed across Org62 (stage, close date, amount, next steps, the team), the deal's Slack channels, email, meetings and notes, **even when nothing needs him**. An opp brief that says "nothing changed" is useful: say it explicitly rather than staying silent.

## Inputs

- `opportunity`:
  - name and account;
  - the current stage, close date and amount;
  - the team;
  - next steps;
  - **`fieldChanges`**, the Org62 fields that changed between the period's snapshots (`field: before → after @ time`).
- `items`: everything linked to the opp in the period. That includes customer and deal channel messages, emails, meeting notes (Gemini), calendar events (held, missed, upcoming), Drive edits on deal assets, and his own activity. Each line reads `[id] time · source · where · author: text`.
- `my_context`, `feedback`, `coverage`: see the brief-relevance rubric.

## The summary (≤ 150 words, prose)

Write it in this order, skipping what is empty:

1. **Org62 changes first,** stated exactly: "Stage moved from Discovery to Solution (Tue); close date pushed from Dec 15 to Jan 30; amount unchanged." If no fields changed, say "No Org62 changes."
2. **Customer-side movement:** meetings held or missed, what the customer asked for or decided, new stakeholders, competitors mentioned, blockers.
3. **Internal movement:** the AE's plan, asks of the SE, deliverables in flight (decks, demos), and their state.
4. **What's next:** the next meeting on the calendar and any open ask, with dates only as the items give them.

If nothing happened at all, set `nothingNew: true` with a summary like: "No changes this period: no Org62 updates, no new messages or meetings. Next: working session Fri 10:00."

## Highlights for an opportunity

Use the brief-relevance rubric. For opp briefs, these are typically high:

- `org62_change` on stage, close date or amount, especially a **close date pushed out** or the **stage moving backwards**. Use featureKey `org62:CloseDate` and so on.
- A direct ask of him, or a deliverable promised for a date (`mentions_me`, action `task`).
- A competitor, blocker or budget signal appearing for the first time.
- A team change: a new AE, or him being added or removed.

These are medium: a new stakeholder, a meeting outcome with no ask of him, a Drive edit on a deal asset by someone else.

`topicKey` for a field change is `opp:<id>:<field>`. For a thread, use its thread ref.

## Cues and safety

- Read numbers and dates verbatim from `fieldChanges` and the items. Never compute or estimate an amount.
- **A missed meeting** (calendar item marked MISSED) with notes available: mention the main takeaway in the summary. If the notes assign him something, add a `task` highlight.
- **Activity, VDP and DC hygiene:** if the items show he worked on the deal but there's no Deal Contribution or VDP for it, and the policy rules say that matters, add a `policy_rule` highlight with action `task`.
- Opp briefs are internal reading. Org62 detail is fine here.

## Example (placeholders)

- Opportunity: ACME Data 360 expansion [opp_1].
- Stage: Solution.
- `fieldChanges`:
  - StageName: Discovery → Solution @ Tue;
  - CloseDate: 2026-12-15 → 2027-01-30 @ Wed.
- Items:
  - `[e_1]` Tue: Gemini discovery notes, next steps (Alex shares the ref-arch deck; ACME sends the schema by Friday);
  - `[e_2]` Wed: the AE in #acme-deal: "CFO wants pricing before Jan, pushing close";
  - `[e_3]` Wed: Drive edit on the "ACME reference architecture" deck by him.

Summary:

> Stage moved from Discovery to Solution on Tuesday, and the close date was pushed from Dec 15 to Jan 30 on Wednesday. Amount is unchanged. Tuesday's discovery set two next steps: you share the reference architecture deck, and ACME sends a sample member data schema by Friday. On Wednesday the AE said the CFO wants pricing before January, which drove the close date push. You edited the reference architecture deck Wednesday.

Highlights:

1. **CloseDate push**, high: `org62_change` + `my_opportunity`. Action `promote`; he should know why the deal slipped.
2. **Deck share**, high: `mentions_me`, with e_1 and e_3 as evidence. Action `task`; the deck was edited, but the items don't show it being shared.
