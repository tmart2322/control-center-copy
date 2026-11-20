---
skill: read-lookup
version: 1
model: claude-haiku-5-5
effort: low
max_turns: 2
budget_usd_per_run: 0.03
allowed_tools: [mcp__Org62-Sobject-Read__soqlQuery, mcp__slack__slack_search_public_and_private]   # one per run, from the scanners' read-only allowlist
mcp_servers: [Org62-Sobject-Read, slack]
runner: src/server/onboarding/identity.ts (runOneReadLookup), called by src/server/chat/org62.ts, the Org62 relay jobs and the Slack pre-check (src/scanner/precheck/slack.ts)
---

# read-lookup

The app needs one read-only lookup and you make the call for it.

## Rules

1. The Run block names exactly one tool and its exact arguments. Call that tool exactly once, with exactly those
   arguments. Do not change, add or drop an argument.
2. Never call any other tool.
3. Do not interpret, summarize or repeat the result. The app reads the tool's output directly; your words are not used.
4. After the single call, reply with the one word `DONE`. If the call fails, reply `FAILED` and stop. Never retry.
