---
name: nba-start-claude-session
version: 2
verb: start_claude_session
model: claude-sonnet-5-5
output: plan (claude_session)
primary: Start in Claude
---

# NBA verb: start_claude_session

Big builds (a demo app, an org build, a packaging job, a long analysis) run in a new Claude Code session that the user watches in the Claude desktop app. One click opens `claude://code/new?folder=<folder>&q=<prompt>`. Your job is to write the context-packed prompt, so the session starts with everything it needs and he doesn't have to re-explain.

## When this verb fits

- The work is hands-on build or research that takes an agent 30 minutes or more: a demo build, rebranding an app, standing up an org, packaging a tool, a multi-file analysis.
- A long build serves an upcoming meeting. This is the *kick off the long build first* case: start-by is driven by agent time.
- A background promise can be advanced by an agent ("package the app as a desktop installer").

If an existing session already covers the work (`verb_context.session.relatedSessions` with state `waiting_on_you`, `running` or `idle`), resuming it beats starting over. Say so in `why`, and add an alternative or ask ("Resume 'NCE demo build' session instead?").

## Inputs this verb relies on

- `work_item` (purpose, due, account, people) and `initiative` (summary, assets).
- `calendar`: the meeting this serves (`SERVES THIS ITEM`) and free gaps.
- `verb_context.session`:
  - `folder`, the absolute repo path, when known;
  - the repo description;
  - related sessions;
  - constraints.
- `evidence`: what was asked, what exists already, and the requested changes.

## The plan (`plan.kind: "claude_session"`)

```json
{
  "kind": "claude_session",
  "folder": "/Users/<user>/Projects/<repo>",
  "prompt": "[cc:wi_123] …",
  "successCriteria": ["…"],
  "contextPack": [{ "label": "Discovery notes", "ref": "https://…" }],
  "background": true,
  "checkpoints": ["Ask before deploying", "Ask before pushing to main"]
}
```

- **folder:** the absolute path from `verb_context.session.folder`, or an initiative asset that is a local path. If neither exists, use `null` and add a blocking ask ("Which repo should this run in?").
- **prompt:** at most 14,336 characters, and in practice under 4,000. Write it to Claude Code, in the user's first person, in this order:
  1. **First line:** `[cc:<work_item.id>] <one-sentence goal>`. The tag is mandatory: the app uses it to link the session to the item.
  2. **Why and when:** the meeting or person it serves, with the local date and time from the calendar.
  3. **Definition of done:** 3–6 checkable outcomes, matching `successCriteria`.
  4. **What exists already:** related sessions, assets and repo state, with links from the inputs. "Start from the existing X; don't rebuild Y."
  5. **Specifics from the evidence:** requested changes, use case, persona, branding. Facts only, quoted or closely paraphrased.
  6. **Constraints:**
     - the repo's own CLAUDE.md and conventions win;
     - don't deploy, push or post anywhere without asking;
     - no secrets in code or chat (ask me for credentials in the session if needed);
     - any constraint listed in `verb_context.session.constraints`.
  7. **Checkpoints:** when to stop and ask, and what to report back at the end (a link, or a short summary of what changed and how to demo it).
- **successCriteria:** the same outcomes, as short strings.
- **contextPack:** the links and refs the prompt cites (inputs only).
- **background:** `true` when the session can run while he does other things. Set `false` when he must be present throughout, such as for a live pairing.

## Effort and start-by

- `agentMin`: an honest estimate, usually 45–180 minutes for a demo build. `youMin`: 5 to kick off, plus 10–20 to review and present-check. Estimate hands-on minutes only, and err low; agent or background time goes in `agentMin`. The session's run time is never `youMin`: it runs in the background while he does other work.
- `startBy.at`: the serving meeting's start minus `agentMin`, minus `youMin`, minus a 30-minute buffer. If that is already past, start now and say so: "Start now: 2 h build, demo at 14:00". In `why`, make the sequencing explicit: "Kick off first; prep the easy 11:00 meeting while it runs".

## Update rule specifics

- New requested changes (NEW evidence) get appended to the prompt's specifics. Use `draftPolicy: "no_draft"`, with `update.diff` on `plan.prompt` and `plan.successCriteria`.
- If a related session has started or finished since (evidence role `progress` or `completion`), the action may change to review or resume. Say so in `update.summary` and lower the confidence.

## Safety specifics

- Never put credentials, tokens or `[redacted:…]` text in the prompt.
- Customer names may appear in the prompt: it runs locally in his own Claude. Keep customer data minimal, and never paste whole transcripts. Summarize and link instead.
- Don't tell the session to send, post, email or deploy anything. Its job ends at a link he reviews.

## Worked example: kick off the long build first (placeholders)

Inputs (abridged):

```
<now> Thu 2026-11-05 08:40 MST
<work_item> id: wi_310 · kind: task · title: Rebrand the NCE demo for Globex and add the claims flow · purpose: Globex onsite demo · due: Thu 2026-11-05 14:00 MST
<calendar>
[cal_1] Thu 11:00 → 11:30 · Initech weekly sync (external, 4 attendees)
[cal_2] Thu 14:00 → 15:00 · Globex onsite: NCE demo (SERVES THIS ITEM, external)
<verb_context> repo folder: /Users/alex/Projects/demos · related Claude sessions: "NCE demo for ACME" [sess_9] done, last Tue 2026-11-03
<evidence>
[ev_40] Wed 16:12 · slack · DM · origin · Kim (AE, slack:U0KIM00001): Can we show the claims-status flow for Globex tomorrow? Their logo + colors would be great.
[ev_41] Wed 16:30 · slack · DM · context · me: Yep, I'll get it rebranded and add claims status.
```

Output (abridged):

```json
{
  "verb": "start_claude_session",
  "title": "Start build: Globex NCE demo rebrand + claims flow",
  "why": "2 h build for the 14:00 Globex demo; kick off before the 11:00 sync",
  "confidence": "sure",
  "alternatives": [],
  "draft": null,
  "plan": {
    "kind": "claude_session",
    "folder": "/Users/alex/Projects/demos",
    "prompt": "[cc:wi_310] Rebrand the NCE demo for Globex and add a claims-status flow for today's 14:00 MT onsite.\n\nWhy: Kim (AE) asked for it yesterday; I said I'd do it.\n\nDone when:\n1. Globex logo and colors replace ACME's across the demo.\n2. A claims-status flow works end to end with mocked calls.\n3. The demo script tab covers the new flow.\n4. It runs locally and the existing ACME flow still works.\n\nStart from the ACME NCE demo built in the session 'NCE demo for ACME' (Tue); reuse its structure, don't rebuild.\n\nConstraints: follow the repo's CLAUDE.md; don't deploy or push without asking me; no secrets in code; ask me for credentials if needed.\n\nCheckpoints: show me the rebrand before building the claims flow. At the end, give me the local URL and a 5-line demo walkthrough.",
    "successCriteria": ["Globex branding applied", "Claims-status flow works with mocked calls", "Script tab updated", "ACME flow unaffected"],
    "contextPack": [],
    "background": true,
    "checkpoints": ["Rebrand review before claims flow", "Ask before deploy or push"]
  },
  "effort": { "youMin": 20, "agentMin": 120 },
  "startBy": { "at": "2026-11-05T09:10:00-07:00", "reasoning": "120 min build + 20 min review + 30 min buffer before 14:00, around the 11:00 sync" },
  "sources": ["ev_40", "ev_41", "cal_2", "cal_1", "sess_9"],
  "asks": [{ "question": "Do you have Globex's logo file, or should the session use a text logo?", "to": "you", "blocking": false }],
  "completeness": 85,
  "update": null
}
```
