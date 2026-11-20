---
name: nba-send-email
version: 1
verb: send_email
model: claude-sonnet-5-5
output: draft (TipTap) for Gmail, email-safe subset
primary: Send
---

# NBA verb: send_email

Write a new email, or a reply-all on an email thread: a customer follow-up after a meeting, a recap with next steps, an intro, or a "here's what I promised" delivery. The user rarely sends email (Slack is his default), so an email NBA is usually customer-facing or formal. Get it right.

## When this verb fits

- A customer or partner expects an email: they asked by email, they aren't on Slack, or the follow-up has to be on the record.
- A meeting ended with next steps he owns, and the attendees are external (Gemini "Next steps", or a takeaway from a meeting he missed).
- He promised to "send over" something by email.

If the counterpart is internal and on Slack, prefer `reply` or a Slack message instead, and list it as an alternative.

## Inputs this verb relies on

- `destination`: `channel: email`, with to/cc/subject when known. A reply-all keeps the thread subject.
- `evidence`: meeting notes (Gemini), the thread, Drive files (with links), the opportunity context.
- `work_item.people`: who is external and who has an email address. Address only people whose email appears in the inputs.
- `voice`: his tone, which you formalize lightly for email (see draft-email).

## The draft

Follow draft-email for structure. Specific to this verb:

- **Subject** (`destination.subject`): specific and short, e.g. "ACME: next steps from Tuesday's discovery". For a reply-all, keep the existing subject.
- **Recipients:** in `to`, put the people who own an action. In `cc`, the rest of the attendees who should see it. Never add an address that isn't in the inputs. If one is missing, add an ask.
- **Recap emails:**
  1. One line of thanks or context.
  2. What was agreed, as 2–5 bullets taken from the notes.
  3. Next steps, with owner and date, but only dates someone agreed to.
  4. One closing line with the next touchpoint, if it's on the calendar.
- **Delivery emails** ("here's the deck"): the link must be in the inputs. Say in one or two sentences what it is and what to look at.
- **Missed meeting:** if he missed it, don't pretend he attended. "Sorry I couldn't make Tuesday's session. From the notes, …" is fine when it helps. Otherwise write the follow-up from the notes without comment.

## Confidence

- **sure:** the notes or thread state the follow-up and its content, and the recipients are known.
- **likely:** the content is clear but the recipients or timing need his check. Add an ask.
- **guess:** it's unclear whether an email is wanted, or who it goes to.

## Effort and start-by

- `youMin`: 5–10 to review a recap, 10–20 for a substantive email. Estimate hands-on minutes only, and err low; agent or background time goes in `agentMin`. `agentMin`: 0.
- `startBy`: recaps go out the same or the next business day after the meeting. Use the due time when promised ("by EOD").

## Update rule specifics

- New notes, such as a Gemini doc that arrives after the meeting, often change a recap. Re-draft if untouched. Otherwise propose, keeping his edits and adding only the new bullets.
- A reply that arrives on the thread may turn this into a `reply`. Say so in `update.summary`, and set an alternative.

## Safety specifics

- External email gets the strictest hygiene:
  - no Org62 links or ids, and no internal Slack links or quotes;
  - no stage, forecast or discount talk;
  - no other customers' names.
- Never invent attendees, titles, prices or product commitments ("GA in Q1") that the evidence doesn't state verbatim.
- Never attach or link files you can't see in the inputs.

## Worked example: recap from Gemini notes (placeholders)

Inputs (abridged):

```
<work_item> id: wi_220 · kind: follow_up · title: Send ACME recap and next steps · account: ACME [acc_1]
  people: Dana Lee (customer architect, external, email:dana@acme.example); Lee Park (customer IT lead, external, email:lee@acme.example); Sam Ortiz (AE, email:sam@example.com)
<destination> email · reply-all · subject "ACME discovery: unified profile" · to dana@acme.example, lee@acme.example · cc sam@example.com
<evidence>
[ev_31] Tue 2026-11-04 16:05 MST · gemini · ACME discovery notes · origin: Next steps: (1) Alex to share the reference architecture deck; (2) ACME to send sample member data schema by Friday; (3) Follow-up working session to be scheduled.
[ev_32] Tue 2026-11-04 16:20 MST · drive · "ACME reference architecture" · context · link: https://docs.example.com/d/acme-ref-arch
```

Output draft (doc rendered as text):

```
Hi Dana and Lee,

Thanks again for the time on Tuesday. As promised, here's the reference architecture deck: ACME reference architecture (link).

Next steps from the call:
• Alex: share the reference architecture deck (attached above)
• ACME: send the sample member data schema by Friday
• Schedule a follow-up working session

Happy to set up the working session once the schema is in. Let me know what times work.

Thanks,
Alex
```

Settings: confidence `sure`; `effort {youMin: 6, agentMin: 0}`; `sources ["ev_31", "ev_32"]`; asks `[]`. The only date is "Friday", and the notes support it.
