# Control Center

A locally run personal-ops cockpit for Salesforce sellers (Solutions Engineers and Specialist AEs). It ingests Slack, Gmail, Calendar, Drive, Gemini notes, Org62, VDP and Claude sessions. From those it builds a prioritized to-do list, tracks time, and drafts replies, VDP updates and Org62 activity logs. **Nothing leaves without approval.**

**Status:** in daily use on Postgres (db DataSource, worker, live scanners). Personas (SE, Specialist AE; `src/personas`, D-55) drive what each user's scanners, Home, Time and Assistant do.

## Read first
- `docs/TENETS.md`: north stars and design tenets. Cite them by name, and flag any conflict as a blocker.
- `docs/ARCHITECTURE.md`: processes, connector matrix, data model, engines, Outbox/autonomy ladder.
- `docs/PLAN.md`: phases, chunks, orchestration rules.
- `docs/UX.md`, `docs/BACKLOG.md`, `docs/DECISIONS.md`.
- `README.md` (setup, personas, updating, where state lives) and `docs/RELEASING.md` (semver rules, D-57).
- `docs/research/*`: background evidence. It is **not shared**: Org62 IDs and customer names.

## Hard invariants for every agent
1. Never send, post, submit or write to a real external system: Slack, Gmail, VDP, Org62, Calendar or Drive. Outbound work stops at a draft or dry-run payload. The **app** may write only through Outbox actions, each a decision: the ones the user Applies (the logging canvas, D-47; VDP changes, D-49; the feedback post to the team channel, D-56), and **VDP autopilot** (D-60), which applies only the VDP items it can fix with known values, and only while the user has it on in Settings ▸ Sending, under its autonomy policy, the daily cap, dry run and read-back. Agents never trigger any of them, never turn autopilot on, and never push; tests use fakes.
2. Connectors call **read tools only**. The MCP wrapper enforces an allowlist, and nobody widens it.
3. Never print, log, commit or copy tokens, cookies or passwords. Redact credential-like text found in sources.
4. Stay inside your chunk's `files:` glob. If you need a contract change, stop and raise a `blocker`.
5. "Validated" means the real path ran to terminal success with the user-visible result present. A 200 or exit 0 is not enough.
6. Port **4327** (registered in `~/Projects/PORTS.md`). State lives in `~/Library/Application Support/control-center/`, never in the repo.

## Commands
| Task | Command |
|---|---|
| Dev | `npm run dev` (web :4327 + worker; `predev` syncs brand assets) |
| Web only | `PORT=<lane port> npm run dev:web` (worktree lanes use 4345–4352) |
| Worker | `npm run worker` (scanners, jobs, heartbeat; `tsx watch`) |
| Check | `npm run check` (typecheck + lint + test) |
| Screenshot | `npm run shot -- <route> [--widths 1280,1440,1920,2560] [--port 4327] [--scenario <s>] [--wait <sel>]` (needs a running server; writes `.shots/`) |
| Build / start | `npm run build` · `npm run start` |
| Routes | `npm run gen:routes` (regenerates `app/api/v1/**/route.ts` from `src/contract/routes.ts`) |
| Example seed | `npm run seed:example` (regenerates `src/mock/seed.example.json`, placeholders only) |
| DB | `npm run db:generate` · `db:migrate` · `db:studio` (studio on :4985) |
| Doctor | `npm run doctor` (Postgres, migrations, sources and auth, worker heartbeat, disk; says what to fix) |
| Scan audit | `npm run scan:trace -- <runId>` · `scan:explain -- --url <permalink>` · `scan:report -- --since 24h` (read-only; `DATABASE_URL`) |
| VDP mirror | `npm run vdp:scan [-- --dry]` (one read of my VDPs into `vdp_records`; reads only, counts only; needs a fresh Okta cookie) |
| Release | `npm run release -- patch\|minor\|major [--dry]` (bump, CHANGELOG section, commit, local tag; never pushes; `docs/RELEASING.md`). Don't run it from a lane |
| Update | `npm run update [-- --yes] [--no-backup]` (fetch, ask on a major, stop both LaunchAgents, install, build, back up, migrate, start them, print old → new; a failure puts the old build back). It refuses outside the checkout the agents run, so never run it from a lane |
| Private scan | `npm run scan:private` (DB names + id patterns over tracked files and history; paths and counts only; run before any push) |

Mock mode: `CC_DATA=mock` (default) · `CC_SCENARIO=1` autoplays the scenario clock · `CC_MOCK_NOW=seed|real|<ISO>|HH:MM` · `CC_SEED_PATH=<file>`.

## Builder return format
`{chunk, status: built|failed, sha, files, verify: "<cmd + result>", blockers: []}`
