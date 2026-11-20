---
name: nba-schedule
version: 1
verb: schedule
model: claude-haiku-5-5
output: plan (calendar_hold), plus an optional short message proposing times
primary: Schedule
---

# NBA verb: schedule

Put something on the calendar. Either:

- a **private focus hold** for the user himself: a training fit-in, prep time, a build block;
- or a **meeting request** with other people: a working session, a dry run, a follow-up.

The outbox creates the hold or invite only after approval. A calendar change is outbound.

## When this verb fits

- **Fit-ins:** a training or small task (≤ 30–45 min) that is due or overdue and fits a real free gap today or tomorrow (R-UI-2). These stay low-level work, but are recommended for today.
- **Prep time:** a meeting needs prep, and he has no time blocked before it.
- **A meeting someone asked for** ("can we set up time next week?"), or one he promised ("I'll set up time with you Monday").

## Inputs this verb relies on

- `calendar.gaps`: the only valid places for a private hold. `calendar.upcoming` and `workingHours` show what to avoid.
- `verb_context.schedule`: duration, attendees, and a window end.
- `work_item.due` and `effort`: how long it takes and by when.

## The plan (`plan.kind: "calendar_hold"`)

```json
{
  "kind": "calendar_hold",
  "title": "Trailhead cert maintenance (Data Cloud)",
  "durationMin": 30,
  "attendees": [],
  "candidateSlots": [{ "start": "2026-11-05T11:30:00-07:00", "end": "2026-11-05T12:00:00-07:00", "why": "30-min gap between the 11:00 sync and 12:00 lunch" }],
  "hold": "private_focus",
  "notes": "Module link in the training notice; Okta sign-in first."
}
```

- **candidateSlots:** one to three options, each inside a listed gap (for a private hold) or inside working hours and before `windowEnd` (for a meeting). Never in the past, never overlapping an upcoming event. Order them best first.
- For **meeting requests**, attendees are names or emails from the inputs. You can't see their calendars, so slots are proposals. Optionally add a short `draft` message offering them ("Would Tue 10:00 or Wed 14:00 MT work for a 45-min working session?"), following the draft style skill.
- **title:** what the time is for. A private hold's title is for him. An invite's title is customer-safe.
- **notes:** links or prep needed, taken from the inputs.

## The card

- **title:** "Schedule 30 min: cert maintenance in your 11:30 gap", or "Schedule working session with ACME".
- **why:** name the gap and the deadline ("Due Dec 4; fits your 11:30 gap today").
- **effort:** `youMin` is the duration of the held time (for fit-ins, the task itself) plus 1 to approve; `agentMin` 0. Estimate hands-on minutes only, and err low; agent or background time goes in `agentMin`.
- **startBy.at:** the first candidate slot's start.
- **confidence:**
  - `sure` when a gap fits and the due date makes it timely;
  - `likely` when you are proposing times to others;
  - `guess` when no gap fits. Then give alternatives: "Snooze to tomorrow", or "Do it in the 16:00 gap, shortened to 20 min".

## Fit-in policy

- Never schedule a training over customer prep or a customer meeting. Customer-facing work wins unless the training is due within 48 h.
- Respect working hours. Don't book lunch-hour gaps unless they are the only option before a hard due date, and then say so.

## Update rule specifics

- If the chosen gap disappears (a NEW calendar event overlaps it), pick the next gap. Diff `plan.candidateSlots` and `startBy`, with `draftPolicy` `no_draft`, or `proposal` for a touched message.

## Worked example: training fit-in (placeholders)

- now: Thu 09:00
- gaps: `[11:30–12:00, 30m]`, `[16:00–16:45, 45m]`
- upcoming: `[cal_3]` 10:00–11:30 ACME prep (external), `[cal_4]` 12:00–13:00 Globex call (external)
- evidence:
  - `[ev_80]` Trailhead notice: "Data Cloud certification maintenance … Completion Due Date: December 4, 2026", LOE 25 min;
  - `[ev_81]` "1 Maintenance Behind".

The plan holds 11:30–12:00, a private focus block titled "Cert maintenance: Data Cloud".

Settings:

- why: "Overdue maintenance (25 min) fits your 11:30 gap";
- confidence `sure`;
- `youMin`: 26;
- second slot: 16:00–16:30.
