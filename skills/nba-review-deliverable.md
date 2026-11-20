---
name: nba-review-deliverable
version: 2
verb: review_deliverable
model: claude-sonnet-5-5
output: plan (deliverable_review), plus an optional "done, here it is" message
primary: Review
---

# NBA verb: review_deliverable

The item is a **deliverable**: slides, a doc, or a whitepaper with requested changes (R-UI-15). Drive is forward-sampled, so you see the file's last edit, who made it, and a digest diff since the item was created. Judge whether each requested change was made, and recommend the next step: finish it, confirm it's done, or tell the requester.

## Inputs this verb relies on

- `verb_context.deliverable`:
  - the file (title, link, last modified, by whom, whether it was modified since the item was created);
  - `requestedChanges`;
  - `observed diff since item created`: one line per changed slide or section.
- `work_item.expected.changes`: the same expectations, stored on the item.
- `evidence`:
  - the ask (origin);
  - Drive edit samples (progress);
  - Slack messages that may say "done" (completion).

  Either Drive or Slack can drive status, and both count as evidence.

## Judging requested vs made

For each requested change, one checklist row:

| status | When |
|---|---|
| `made` | The diff shows a change that clearly satisfies the request (the right slide or section, the right content) |
| `partial` | Related edits exist, but part of the request is missing (the logo changed on 3 of 5 slides; pricing slide added but no numbers) |
| `missing` | The file changed, but nothing addresses this request, or the file didn't change at all |
| `unknown` | The diff can't tell (for example, an image swap with no text digest). Say what would confirm it |

- `evidence` gives the diff line or message that supports the status, in at most 240 characters. `evidenceIds` gives the ids.
- An edit by someone other than the user still counts: the work got done. Say who made it.
- **Verdict:**
  - `likely_done` only when every row is `made`;
  - `in_progress` when some are made or partial;
  - `not_started` when nothing relevant changed;
  - `unknown` when the diff is uninformative.

## The plan (`plan.kind: "deliverable_review"`)

```json
{
  "kind": "deliverable_review",
  "file": { "id": "file_9", "title": "Globex NCE pitch", "url": "https://docs.example.com/p/globex-nce" },
  "checklist": [
    { "requested": "Add the claims-status use case slide", "status": "made", "evidence": "Slide 6 added: 'Claims status in one view'", "evidenceIds": ["ev_91"] },
    { "requested": "Replace ACME logo with Globex", "status": "partial", "evidence": "Logo changed on slides 1–3; slides 7–9 unchanged", "evidenceIds": ["ev_91"] }
  ],
  "verdict": "in_progress",
  "nextStep": "Swap the logo on slides 7–9, then tell Kim it's ready"
}
```

## The card and optional draft

- **title**:
  - "Review Globex deck: 1 of 2 changes left" for in-progress work;
  - "Confirm done: Globex deck updated" when likely done.
- **why:** the evidence in one line ("Drive edits Tue 16:40 by you; no Slack update yet").
- **Drive edits but no Slack message, and all changes made** (the *Drive-edit-only* case):
  - the verdict is `likely_done`;
  - the primary action is to confirm done;
  - add an optional short `draft` to the requester, with the file title linked to the file's URL from the inputs ("Updated the Globex NCE pitch with the claims slide and Globex branding").
- **Changes remaining:** no draft. The `nextStep` is the remaining work, and `effort.youMin` is your estimate for it. Estimate hands-on minutes only, and err low; agent or background time goes in `agentMin`.
- **Slack says "done" but the diff disagrees:** the verdict is `in_progress`. Say so in `why` ("Said done in Slack, but slides 7–9 still show the old logo"). Trust the file, but show both pieces of evidence.
- **confidence:**
  - `sure` when the diff is explicit;
  - `likely` when it's inferred from section names;
  - `guess` when the digest is uninformative.

## Update rule specifics

- A new Drive sample changes checklist rows. Diff them by `requested`.
- A new requested change in Slack adds a row. If the item was done, say "New requirement after done" in `update.summary`.

## Safety specifics

- Never say a change was made because it "probably" was. That is what `unknown` is for.
- Don't quote slide content to an external requester beyond what they asked for.
