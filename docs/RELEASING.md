# Releasing Control Center

Control Center runs on each person's own Mac. When a teammate reports a bug, the first question is "which version are you on?", and the answer has to mean something. So every shared build has a [semantic version](https://semver.org/) (D-57), a changelog section, and a git tag.

## What each bump means

| Bump | When | What a teammate does |
|---|---|---|
| **major** (`2.0.0`) | A migration or settings reset that needs a **manual step**, or a **breaking change to the API contract** (`src/contract/**`: a route removed or renamed, a response field removed or retyped, a request field made required). | Reads the version's changelog section **before** updating, does the step it names, then runs `npm run update`. |
| **minor** (`1.3.0`) | New features, and **additive migrations that apply on their own** (new tables, new nullable columns, new settings fields with defaults). | `npm run update` whenever convenient. |
| **patch** (`1.2.1`) | Fixes only: no new features, no migration. | `npm run update`. |

Rules of thumb:
- A settings field added with a default is **minor**. Renaming or removing one, or a default that changes behavior someone relies on, is **major**.
- A migration that rewrites or deletes data, or needs `npm run db:migrate` plus something else (a rescan, a re-auth, a re-onboard), is **major**. Write the step in the changelog under the version heading.
- If in doubt between two bumps, take the bigger one.

## Cutting a release

From a clean `main`, with `npm run check` passing:

```bash
npm run release -- minor --dry      # preview the CHANGELOG section; changes nothing
npm run release -- minor            # bump, write CHANGELOG.md, commit, tag v1.3.0 (local only)
```

`npm run release -- patch|minor|major`:
1. Refuses a dirty working tree.
2. Bumps `package.json` and `package-lock.json`.
3. Writes the next `CHANGELOG.md` section:
   - It folds in the hand-written `## [Unreleased]` entries.
   - It adds the commit subjects since the last `v*` tag: `feat` → Added, `fix` → Fixed, `perf`/`refactor` → Changed, `type!:` → Changed (breaking). Merge, `chore`, `test`, `ci` and `build` commits are skipped.
   - For the first release (no tag yet), only the Unreleased entries go in. `--all` adds every commit; `--since <ref>` picks a start.
4. Commits `chore(release): vX.Y.Z` and creates the annotated tag `vX.Y.Z`.

It **never pushes**. Review the section. To reword it, amend the commit and move the tag (`git commit --amend`, then `git tag -fa vX.Y.Z`) before you push.

Commit subjects end up in a shared file. Keep them free of customer names, and run `npm run scan:private` before pushing.

## Changelog entries while you work

Every change that a teammate would notice gets a line under `## [Unreleased]` in `CHANGELOG.md`, under `### Added`, `### Changed`, `### Fixed` or `### Removed`. The release script keeps these hand-written lines ahead of the commit subjects. For a major change, say what the person has to do.

## How versions reach people

- **The build embeds** the version, the short git sha and the build time (`next.config.ts` → `CC_APP_VERSION`, `CC_GIT_SHA`, `CC_BUILT_AT`).
- **The worker** records its version in `worker_instances.app_version` when it starts.
- **`GET /api/v1/version`** returns `{version, sha, builtAt, migration, bundledMigration, persona, workerVersion, mismatch, migrationPending, dataSource}`. `mismatch` means the web app and the worker run different versions: one was restarted and the other wasn't.
- **The sidebar footer** shows `v1.3.0 · abc1234` and turns amber on a mismatch or a pending migration. Settings ▸ About shows everything plus a "Copy version line" button for bug reports.
- **`npm run update`** fetches, and for a major version prints its changelog sections and asks first (`--yes` answers). It then fast-forwards and stops both LaunchAgents (`com.controlcenter.web`, `com.controlcenter.worker`). It installs, builds (the previous build is kept until this one succeeds), backs up the database, migrates and starts both agents again. It prints `old → new` with the changelog sections in between. A failed install, build, backup or migration leaves the schema alone, puts the previous build back and starts the agents again (lane E, E1; `scripts/ops/lib/update.mjs`). Run from a checkout other than the one the installed agents run (their plist's `WorkingDirectory`), it refuses before changing anything: never run it from a lane worktree.
- **Migrations:** every new journal entry must have a newer `when` than the one before it, or drizzle skips it on every database that already migrated. `tests/ops/migrations-journal.test.ts` fails the merge otherwise, and also checks files, snapshots, numbering and the snapshot chain. `npm run db:migrate` fails on a skipped migration. `drizzle-kit generate` numbers from the journal's last `idx` (0023 after `0023_llm_audit`), so rename its output (SQL file, snapshot, journal tag) to the next free number and restore the snapshot it overwrote.

## Before the first push to a remote

The repository had no remote while it was built, and its early history holds private material: customer names, Org62 ids, a work-order canvas, an owner fixture. Before connecting one:

1. Run `npm run scan:private`. It reads your real account, people and opportunity names from your local database. It checks every tracked file and every commit for those names, for Org62 and Slack ids your database knows, for id-shaped values and for salesforce.com emails. It prints **paths and counts only**.
2. If tracked files have hits, move them to `~/Library/Application Support/control-center/private/` or replace the values with placeholders. Then commit.
3. If **history** has hits, don't push this history. Push a fresh-history snapshot instead (README ▸ Sharing the repo).
