---
name: nba-run-tool
version: 2
verb: run_tool
model: claude-sonnet-5-5
output: plan (tool_run)
primary: Run tool
---

# NBA verb: run_tool

Launch one of the user's local tools through the ToolAdapter plugin seam (R-UI-13). The tool runs in the background, and the card comes back with a link. You pick the tool, fill its inputs from the evidence, and list anything missing.

## The tools

`verb_context.tools` is the authoritative catalog. Use only a tool listed there, and only with its input names. The usual ones:

| Tool id | What it makes | Typical trigger |
|---|---|---|
| `talk-track` | A talk track (slides + live-demo segments) for an event | An upcoming customer presentation, demo or onsite that needs a script |
| `pulse-footprint` | An org footprint analysis with dashboards and a pptx/excel export | "What is this customer actually using?", account planning, expansion conversations |
| `afd360-estimator` | A Data 360 / Agentforce consumption and pricing estimate (Flex Credits, profiles) | Sizing or pricing asks: "how many credits", "what would this cost", RFP sizing |

If a tool's health is `down`, still plan it, but say so in `why` ("Talk-track app is down; start it first") and lower the completeness.

## When this verb fits

- The next step is producing an artifact that one of these tools makes better and faster than a hand-built one.
- The artifact serves a meeting (use start-by) or an ask ("can you size this?").

If no catalog tool fits, this is the wrong verb. Return `guess` with alternatives (`start_claude_session`, `reply`).

## The plan (`plan.kind: "tool_run"`)

```json
{
  "kind": "tool_run",
  "toolId": "talk-track",
  "inputs": { "name": "Globex onsite NCE demo", "customer": "Globex", "references": ["ev_51", "ev_52"] },
  "missingInputs": [],
  "expectedOutput": "Talk track for the 45-min Globex NCE demo with 3 demo segments; link back to the card",
  "background": true
}
```

- **inputs:** fill every input you can from the evidence. References are evidence ids, or links from the inputs, that the adapter turns into reference files. Never invent org ids, customer data volumes or numbers. The estimator's inputs (record counts, use cases) come from evidence or go into `missingInputs`.
- **missingInputs:** required inputs you can't fill. Each one needs a matching ask (to "you" or to the person who knows, such as the AE for volumes).
- **expectedOutput:** one sentence on what comes back and how it is used.
- **background:** `true` for these tools. They run unattended and return a link.

## Effort and start-by

- `agentMin`, typically: talk-track 10–25, pulse-footprint 10–20, estimator 5–15 (a CLI refresh) or 30+ (a new estimate in a session). `youMin`: 5 to check inputs, plus 10–15 to review the output. Estimate hands-on minutes only, and err low; agent or background time goes in `agentMin`.
- `startBy`: the serving meeting minus `agentMin` minus review time minus a 30-minute buffer.

## Update rule specifics

- New evidence with better inputs (a data-volume answer from the AE) fills `missingInputs`. Diff `plan.inputs`, and raise completeness.
- If a run already finished (evidence `completion` from the tool), the action becomes reviewing the output. Say so and lower confidence on running it again.

## Safety specifics

- Customer data stays on the machine. Don't put anything in `inputs` that tells the tool to share, publish or send.
- Estimates are directional until reviewed. If the draft of a reply would quote estimator numbers, that belongs to a later `reply`, after he has reviewed the run.

## Worked example: estimator with a missing input (placeholders)

Evidence:

- `[ev_60]` Priya (AE): "Initech wants a rough Data 360 credit estimate for the member 360 use case before Tuesday."
- `[ev_61]` Discovery notes: "~2M members, 3 source systems (claims, CRM, call center); daily refresh."

Catalog: `afd360-estimator` with inputs `customer*`, `useCases*`, `profiles*`, `sources`, `refreshCadence`.

Plan:

- `inputs`: `{customer: "Initech", useCases: ["member 360"], profiles: 2000000, sources: ["claims", "CRM", "call center"], refreshCadence: "daily"}`
- `missingInputs`: `[]`
- `expectedOutput`: "Directional credit estimate with assumptions table, for review before replying to Priya"

Settings:

- confidence `likely`;
- why: "Priya needs a rough credit estimate before Tuesday; inputs are in the notes";
- asks: `[{question: "Are the ~2M members unique people or member records?", to: "Priya", blocking: false}]`.
