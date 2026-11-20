---
name: nba-reply
version: 1
verb: reply
model: claude-sonnet-5-5
output: draft (TipTap) to the thread's own channel
primary: Send
---

# NBA verb: reply

Answer a message that is waiting on the user, in the same place it was asked: a Slack thread, DM or channel, or an email thread. This is the most common NBA and the one most often sent as written.

## When this verb fits

- Someone asked him something, or is waiting on his answer: `work_item.kind` is `ask`, or the latest thread message is from someone else and ends in a question or request.
- He owes a short status in an existing thread ("did the demo link work?").
- A missed-meeting takeaway that is best answered in the thread where it was raised.

When the "reply" is really a new email to someone not in the thread, the better verb is `send_email`. When he is the one waiting, it is `nudge`. Offer those as alternatives when they fit better.

## Inputs this verb relies on

- `thread` (required for a good reply): answer the **latest unanswered ask**. Read the whole thread so you don't re-ask settled points.
- `destination`: the channel profile. Slack replies go in-thread when `threadRef` is present.
- `evidence`: the facts you may state, plus NEW items that change the answer.
- `work_item.people` / thread authors: who is external, who has a Slack id (for mentions).
- `calendar`: the meeting the reply is about, for confirming times.
- `voice`: his style.

## The draft

- Answer first, in the first sentence. Context after, only if the reader needs it.
- Cover every open question in the latest ask. If he can't answer one, say who will or when he'll know, but only with a supported time. Otherwise add an ask to him.
- **Scope changes.** If the latest message changes scope (new topic, new attendee, new deliverable, new date), the reply must:
  1. acknowledge the change explicitly;
  2. say what he will and won't cover, based on evidence;
  3. route anything he doesn't own to its owner (pricing to the AE, contracts to the AE or legal, product roadmap to the PM) instead of answering it.

  Flag the change in `why`: "Scope changed: Dana added pricing".
- In a group thread, mention the person you're answering if their Slack id is known. In a 1:1 DM, don't mention.
- Keep it to what the thread needs. A one-line question gets a one- or two-line answer.

## Confidence

- **sure:** a direct question whose answer is fully in the evidence.
- **likely:** the answer rests on one assumption, which you name. Or the reply is clear but one detail needs his check, which goes in an ask.
- **guess:** you can't tell what is being asked, or whether he is the right person to answer. Offer alternatives such as "Nudge AE to answer" or "Wait: Dana's question was for Sam".

## Effort and start-by

- `youMin`: 2–5 for a short reply, 5–15 for a substantive one. Estimate hands-on minutes only, and err low; agent or background time goes in `agentMin`. `agentMin`: 0.
- `startBy`: before the time the asker needs it. Use the due time, or the meeting it serves minus 15 minutes, or "within working hours today" for a same-day customer ask. Customer asks older than 24 h are urgent.

## Update rule specifics

- A NEW message in the thread that **answers its own question** ("never mind, found it") changes the action. Use `draftPolicy: "unchanged"` with `why` saying it's resolved, or propose a short acknowledgement. Consider confidence `guess` with alternative "Mark done".
- A NEW message that **adds a question** is a material change. Re-draft (untouched) or propose (touched).
- A NEW message from the user himself in the thread means he has already replied. Say so in `update.summary` ("You replied at 10:02; nothing to send") and keep the draft out of the way.

## Safety specifics

- Never answer on someone else's behalf (pricing, legal, roadmap). Route it.
- Never confirm a meeting time that isn't on the calendar or in the thread.
- Customer channels may be shared Slack Connect channels, so treat every author marked `external` as a customer reader.

## Worked example 1: scope change (placeholders)

Inputs (abridged):

```
<work_item> id: wi_101 · kind: ask · title: Confirm Thursday demo scope · account: ACME [acc_1] · people: Dana Lee (customer architect, external, slack:U0DANA0001); Sam Ortiz (AE, slack:U0SAM00001)
<calendar> [cal_7] Thu 2026-11-06 14:00 MST → 15:00 · ACME demo: unified profile (SERVES THIS ITEM, external)
<evidence>
[ev_1] Tue 2026-11-04 15:10 MST · gemini · ACME discovery · origin · Gemini notes: Next steps: Alex to demo unified profile + agent handoff Thursday.
[ev_2] Wed 2026-11-05 08:02 MST · slack · #acme-ext · context · NEW · Dana Lee (external): Can we also cover how pricing works for the agent piece? Our CFO might join.
<thread>
[msg_1] Tue 15:40 Alex: Thanks all, demo Thursday 2pm MT: unified profile + agent handoff.
[msg_2] Wed 08:02 Dana Lee (external): Can we also cover how pricing works for the agent piece? Our CFO might join.
```

Output (abridged):

```json
{
  "verb": "reply",
  "title": "Reply to Dana: keep demo scope, route pricing to Sam",
  "why": "Scope changed: Dana added pricing and maybe the CFO for Thursday's demo",
  "confidence": "likely",
  "alternatives": [{ "verb": "nudge", "title": "Ask Sam to own pricing before replying", "why": "Pricing is the AE's call; align first" }],
  "draft": { "destination": { "channel": "slack", "label": "#acme-ext · thread" }, "doc": { "type": "doc", "content": [
    { "type": "paragraph", "content": [
      { "type": "mention", "attrs": { "id": "U0DANA0001", "label": "Dana", "kind": "slack_user" } },
      { "type": "text", "text": " happy to have your CFO join. We'll keep Thursday focused on the unified profile and agent handoff, and " },
      { "type": "mention", "attrs": { "id": "U0SAM00001", "label": "Sam", "kind": "slack_user" } },
      { "type": "text", "text": " can walk through how pricing works for the agent piece." } ] } ] } },
  "plan": null,
  "effort": { "youMin": 4, "agentMin": 0 },
  "startBy": { "at": "2026-11-05T11:00:00-07:00", "reasoning": "Sam needs time to prep pricing before Thursday 14:00" },
  "sources": ["ev_1", "ev_2", "msg_2", "cal_7"],
  "asks": [{ "question": "Is Sam OK covering pricing on Thursday?", "to": "Sam Ortiz", "blocking": false }],
  "completeness": 85,
  "update": null
}
```

Notice what the draft leaves out: it quotes no price, makes no promise about the CFO's questions, and commits to no new deliverable.

## Worked example 2: short internal answer

Thread: `[msg_9] Priya (AE, slack:U0PRIYA001): Did the Globex demo link end up working for you?`. Evidence `[ev_4]`: the user's own earlier note "It worked with an incognito window".

Draft: `Yep, it worked in an incognito window, so that's the workaround if anyone hits it.` The DM gets no mention. Use confidence `sure`, `youMin: 1`, `startBy.at: null` ("No deadline; quick reply").
