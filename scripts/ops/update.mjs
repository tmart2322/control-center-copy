#!/usr/bin/env node
// npm run update [-- --no-pull] [--no-restart] [--no-backup] [--yes] [--dry]
//
// Brings this install to the latest version (D-57, README "Updating"; audit 2026-11-13, lane E: E1). The steps and
// what happens when one fails are in scripts/ops/lib/update.mjs; this file wires them to git, npm, launchctl and
// pg_dump:
//   git fetch → (a MAJOR jump: its changelog, then "migrate now?") → git merge --ff-only → stop both LaunchAgents
//   (com.controlcenter.web, com.controlcenter.worker) → npm install → npm run build → back up the database →
//   npm run db:migrate → start the agents again → old → new and the changelog in between.
// A failed build, backup or migration leaves the schema as it was, puts the previous build back and starts the app
// again. --yes answers the major-update question; --no-backup skips the backup (not advised).
// Nothing here writes outside this folder, the database, the backups folder (and its copy) and the two agents.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, constants, existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { sectionsBetween } from '../lib/release.mjs';
import { backupCopyDir, configuredDbName, defaultBackupDir, runBackup } from './lib/backup.mjs';
import { readEnvFile } from './lib/envfile.mjs';
import { WEB_LABEL, WORKER_LABEL } from './lib/plist.mjs';
import { runUpdate } from './lib/update.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const say = (m) => console.log(`[update] ${m}`);
const uid = process.getuid?.() ?? 0;
const agentsDir = process.env.CC_LAUNCH_AGENTS_DIR ?? join(homedir(), 'Library', 'LaunchAgents');
const stateDir = process.env.CC_STATE_DIR ?? join(homedir(), 'Library', 'Application Support', 'control-center');

const gitOut = (args) => {
  try {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};
/** A command with its output on this terminal. `env` adds the env file's values (migrate: the database the agents use). */
const sh = (cmd, args, env) => spawnSync(cmd, args, { cwd: repo, stdio: 'inherit', env: env ? { ...process.env, ...env } : process.env }).status === 0;
const fileEnv = () => readEnvFile(join(stateDir, 'env')) ?? {};

const agents = {
  /** Installed and loaded now (launchctl print exits 0 for a loaded service). */
  running: () =>
    [WEB_LABEL, WORKER_LABEL].filter(
      (l) => existsSync(join(agentsDir, `${l}.plist`)) && spawnSync('/bin/launchctl', ['print', `gui/${uid}/${l}`], { stdio: 'ignore' }).status === 0,
    ),
  // bootout stops it for good (KeepAlive would restart a plain kill) and waits for it to exit: the worker drains
  stop: async (l) => spawnSync('/bin/launchctl', ['bootout', `gui/${uid}/${l}`], { stdio: 'ignore' }).status === 0,
  start: async (l) => spawnSync('/bin/launchctl', ['bootstrap', `gui/${uid}`, join(agentsDir, `${l}.plist`)], { stdio: 'inherit' }).status === 0,
  /** Installed agents whose WorkingDirectory is another checkout (their plist says which). */
  elsewhere: () =>
    [
      ...new Set(
        [WEB_LABEL, WORKER_LABEL]
          .map((l) => join(agentsDir, `${l}.plist`))
          .filter((f) => existsSync(f))
          .map((f) => /<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/.exec(readFileSync(f, 'utf8'))?.[1]?.replace(/&amp;/g, '&') ?? null)
          .filter((d) => d && resolve(d) !== repo),
      ),
    ],
};

const nextDir = join(repo, '.next');
const snapDir = join(repo, '.next-before-update');

async function runningVersion() {
  const port = Number(process.env.PORT || 4327);
  try {
    const res = await fetch(`http://localhost:${port}/api/v1/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok ? ((await res.json()).version ?? null) : null;
  } catch {
    return null;
  }
}

async function waitForApp() {
  for (let i = 0; i < 30; i++) {
    const port = Number(process.env.PORT || 4327);
    try {
      const res = await fetch(`http://localhost:${port}/api/v1/version`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return await res.json();
    } catch {
      /* still starting */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

async function confirm(q) {
  if (!process.stdin.isTTY) {
    say('not a terminal, so nothing to answer with: run it again with --yes to accept');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`[update] ${q} [y/N] `)).trim().toLowerCase();
  rl.close();
  return a === 'y' || a === 'yes';
}

const result = await runUpdate(
  {
    say,
    version: () => JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version,
    runningVersion,
    git: {
      sha: () => gitOut(['rev-parse', '--short=7', 'HEAD']) ?? '',
      hasUpstream: () => gitOut(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']) !== null,
      fetch: async () => sh('git', ['fetch', '--quiet']),
      incoming: () => Number(gitOut(['rev-list', '--count', 'HEAD..@{u}']) ?? 0),
      upstreamFile: (p) => gitOut(['show', `@{u}:${p}`]),
      mergeFfOnly: async () => sh('git', ['merge', '--ff-only', '--quiet', '@{u}']),
    },
    changelog: (text, from, to) => sectionsBetween(text, from, to),
    readLocal: (p) => (existsSync(join(repo, p)) ? readFileSync(join(repo, p), 'utf8') : null),
    confirm,
    agents,
    install: async () => sh('npm', ['install', '--no-audit', '--no-fund']),
    build: async () => sh('npm', ['run', 'build']),
    migrate: async () => sh('npm', ['run', 'db:migrate'], fileEnv()),
    // The current build, copied (APFS clones it: instant, no extra space), so a failed step can put it back. The
    // cache is left out: next build keeps it, and it can be large.
    snapshot: async () => {
      if (!existsSync(join(nextDir, 'BUILD_ID'))) return null;
      rmSync(snapDir, { recursive: true, force: true });
      cpSync(nextDir, snapDir, { recursive: true, mode: constants.COPYFILE_FICLONE, filter: (src) => !src.startsWith(join(nextDir, 'cache')) });
      return snapDir;
    },
    restore: async (dir) => {
      const cache = join(nextDir, 'cache');
      const keepCache = existsSync(cache) ? `${dir}-cache` : null;
      if (keepCache) renameSync(cache, keepCache);
      rmSync(nextDir, { recursive: true, force: true });
      renameSync(dir, nextDir);
      if (keepCache) renameSync(keepCache, cache);
    },
    drop: async (dir) => rmSync(dir, { recursive: true, force: true }),
    backup: async () => {
      const env = { ...fileEnv(), ...process.env };
      const r = await runBackup({ db: configuredDbName(env), dir: defaultBackupDir(env) });
      const c = backupCopyDir(env);
      if (r.copy?.error) say(r.copy.error === 'refused_cloud_synced' ? `not copied: ${c.refused}` : `the copy to ${r.copy.dir} failed (${r.copy.error}); the backup itself is fine`);
      return { name: r.file.split('/').pop(), bytes: r.bytes, copied: r.copy?.file ? r.copy.dir : null };
    },
  },
  { pull: !flag('--no-pull'), restart: !flag('--no-restart'), backup: !flag('--no-backup'), yes: flag('--yes'), dry: flag('--dry') },
);

if (result.status === 'failed') process.exit(1);
if (result.status === 'declined') process.exit(0);
if (result.restarted?.length) {
  const v = await waitForApp();
  if (!v) say(`the app didn't answer yet; check npm run doctor`);
  else if (v.mismatch) say(`the worker still runs v${v.workerVersion}; it restarts within a minute, or run: launchctl kickstart -k gui/${uid}/${WORKER_LABEL}`);
  else say(`running: v${v.version}${v.sha ? ` · ${v.sha}` : ''}${v.workerVersion ? `, worker v${v.workerVersion}` : ''}`);
}
