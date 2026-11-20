---
name: nba-nudge
version: 1
verb: nudge
model: claude-haiku-5-5
output: draft (TipTap), a short follow-up to the person he is waiting on
primary: Send
---

# NBA verb: nudge

The user is **waiting on someone else** (`work_item.state` `waiting_on_others`, or the last message in the thread is his and asks for something). Draft a short, friendly follow-up that makes it easy for them to answer.

## When this verb fits

- He asked for something (a schema, an approval, a link, a decision) and the other person hasn't answered within a reasonable time:
  - internal: 1–2 business days;
  - customer: 2–3 business days;
  - sooner when a meeting depends on it.
- A deadline is approaching that depends on their answer.

When it's too early, return `confidence: "guess"` with the alternative "Wait until <supported time>" and completeness ≤ 40. Don't nag. Only name a wait-until time the calendar or due date supports. If nothing supports one, use "Wait" with no time.

## The draft

- Keep it to one or two sentences. Restate the ask in a few words, and add why it matters now if the evidence says so ("so we can prep for Thursday").
- Make answering easy:
  - offer a default ("If it's easier, the sample from last quarter works too");
  - offer a smaller ask;
  - or offer a quick call, but only if the calendar shows a free gap.
- In a Slack thread, reply in the original thread so the context is right there. Mention the person only in group channels.
- Tone: warm, never passive-aggressive. Avoid "just following up", "per my last message", "gentle reminder", "circling back". Use his own phrases from the voice profile instead.
- For a customer, keep the polite register of draft-email or draft-slack.

## Effort and start-by

- `youMin`: 1–2. Estimate hands-on minutes only, and err low; agent or background time goes in `agentMin`. `agentMin`: 0.
- `startBy`: when the dependency becomes urgent. That's the start of the working day before the serving meeting, or now if the meeting is within 24 h.

## Update rule specifics

- A NEW reply from the person changes everything: the nudge is moot. Set `update.summary` to "Dana replied at 09:12; nothing to nudge", use `draftPolicy: "unchanged"` with `confidence: "guess"`, and give the alternative "Reply to Dana" or "Mark done".
- Repeated nudges escalate gently. A second nudge can offer the smaller ask or loop in the AE, but only if the AE is in the inputs.

## Safety specifics

- Never invent a deadline to create urgency. If the inputs give no real date, don't claim one.

## Worked example (placeholders)

Evidence:

- `[ev_70]` Mon · email · his message to Lee (ACME, external): "Could you send the sample member data schema? It'll help us prep the working session."
- `[ev_71]` calendar: `[cal_9]` Fri 10:00 ACME working session (SERVES THIS ITEM).

Now: Wed 09:00.

Draft (email reply on the same thread):

```
Hi Lee, quick check on the sample member data schema. Having it before Friday's working session would let us map it ahead of time. Even a partial extract or the column list works.

Thanks,
Alex
```

Settings:

- confidence `sure`;
- why: "Asked Lee Monday; Friday's session depends on the schema";
- `startBy.at`: Wed 10:00 ("Give Lee two days before Friday");
- `youMin`: 1.
