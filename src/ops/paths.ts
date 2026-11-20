/**
 * Filesystem locations for local state, logs and LaunchAgents.
 * Everything honours env overrides so tests never touch the real directories.
 * State lives outside the repo (CLAUDE.md invariant 6).
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import { pg17Bin } from './brew';

export const APP_PORT = 4327;
export const WEB_LABEL = 'com.controlcenter.web';
export const WORKER_LABEL = 'com.controlcenter.worker';
export const DB_NAME = 'control_center';
/** Homebrew's Postgres 17 binaries (`<brew prefix>/opt/postgresql@17/bin`; Apple Silicon or Intel). */
export const PG17_BIN: string = pg17Bin();

type Env = Record<string, string | undefined>;

export function stateDir(env: Env = process.env): string {
  return env.CC_STATE_DIR ?? join(homedir(), 'Library', 'Application Support', 'control-center');
}
export function logDir(env: Env = process.env): string {
  return env.CC_LOG_DIR ?? join(homedir(), 'Library', 'Logs', 'control-center');
}
export function launchAgentsDir(env: Env = process.env): string {
  return env.CC_LAUNCH_AGENTS_DIR ?? join(homedir(), 'Library', 'LaunchAgents');
}
export const envFilePath = (env: Env = process.env) => join(stateDir(env), 'env');
export const heartbeatPath = (env: Env = process.env) => join(stateDir(env), 'worker.heartbeat');
export const workerPidPath = (env: Env = process.env) => join(stateDir(env), 'worker.pid');
export const backupsDir = (env: Env = process.env) => join(stateDir(env), 'backups');
export const profilePath = (env: Env = process.env) => join(stateDir(env), 'profile.json');
export const notifyStatePath = (env: Env = process.env) => join(stateDir(env), 'notify-state.json');
export const reauthLockPath = (env: Env = process.env) => join(stateDir(env), 'reauth.lock');
export const plistPath = (label: string, env: Env = process.env) => join(launchAgentsDir(env), `${label}.plist`);
