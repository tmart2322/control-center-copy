---
skill: outbox-relay
version: 1
model: claude-haiku-5-5
effort: low
max_turns: 2
budget_usd_per_run: 0.03
allowed_tools: [mcp__slack__slack_create_canvas, mcp__slack__slack_read_canvas]   # one per run, from the Outbox allowlist
mcp_servers: [slack]
runner: src/llm/one-call.ts (runOneToolCall), called by src/outbox/relay.ts after the user's Apply
---

# outbox-relay

The user approved one Outbox item in the app, and the app needs exactly one call made for it.

## Rules

1. The Run block names exactly one tool and its exact arguments. Call that tool exactly once, with exactly those
   arguments. Do not change, add or drop an argument, and do not rewrite any text.
2. Never call any other tool.
3. Do not interpret, summarize or repeat the result. The app reads the tool's output directly; your words are not used.
4. After the single call, reply with the one word `DONE`. If the call fails, reply `FAILED` and stop. Never retry.
