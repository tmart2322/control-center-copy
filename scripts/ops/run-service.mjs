#!/usr/bin/env node
// launchd service wrapper for the web and worker agents.
//   node run-service.mjs --name web|worker --env-file <path> --log-dir <dir> [--no-wait-pg] -- <command> [args...]
// Does: load env file (values never logged) -> wait for Postgres with backoff -> run the command with its
// output going to a size-rotated log (secrets scrubbed) -> forward SIGTERM/SIGINT -> exit with the child's code
// so launchd's KeepAlive + ThrottleInterval handle restarts.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { readEnvFile, secretValues } from './lib/envfile.mjs';
import { RotatingLog } from './lib/logrotate.mjs';
import { waitForPostgres } from './lib/pgwait.mjs';

function parseArgs(argv) {
  const i = argv.indexOf('--');
  const head = i >= 0 ? argv.slice(0, i) : argv;
  const cmd = i >= 0 ? argv.slice(i + 1) : [];
  const opt = {};
  for (let k = 0; k < head.length; k++) {
    if (head[k] === '--no-wait-pg') opt.noWaitPg = true;
    else if (head[k].startsWith('--')) opt[head[k].slice(2)] = head[++k];
  }
  return { opt, cmd };
}

const { opt, cmd } = parseArgs(process.argv.slice(2));
if (!opt.name || !opt['log-dir'] || cmd.length === 0) {
  console.error('usage: run-service.mjs --name <web|worker> --env-file <path> --log-dir <dir> -- <command...>');
  process.exit(64);
}

const fileEnv = (opt['env-file'] && readEnvFile(opt['env-file'])) || {};
const log = new RotatingLog(join(opt['log-dir'], `${opt.name}.log`), {
  maxBytes: Number(process.env.CC_LOG_MAX_BYTES) || 10 * 1024 * 1024,
  keep: Number(process.env.CC_LOG_KEEP) || 5,
  scrub: secretValues(fileEnv),
});
const say = (m) => log.write(`${new Date().toISOString()} [run-service:${opt.name}] ${m}\n`);

say(`starting (env file ${opt['env-file'] ? (Object.keys(fileEnv).length ? `loaded, ${Object.keys(fileEnv).length} keys` : 'missing or empty') : 'not set'})`);

const abort = new AbortController();
let child = null;
let stopping = false;
const onSignal = (sig) => {
  stopping = true;
  abort.abort();
  say(`${sig} received`);
  if (child) child.kill(sig);
  else process.exit(0);
};
process.on('SIGTERM', () => onSignal('SIGTERM'));
process.on('SIGINT', () => onSignal('SIGINT'));

if (!opt.noWaitPg) {
  const ready = await waitForPostgres({ log: say, signal: abort.signal });
  if (!ready) process.exit(0);
  say('postgres ready');
}

child = spawn(cmd[0], cmd.slice(1), { env: { ...process.env, ...fileEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (d) => log.write(d));
child.stderr.on('data', (d) => log.write(d));
child.on('error', (e) => {
  say(`failed to start command: ${e.code ?? e.name}`);
  process.exit(127);
});
child.on('exit', (code, signal) => {
  say(`exited code=${code} signal=${signal ?? 'none'}`);
  log.close();
  // A deliberate stop (launchctl bootout) exits 0 so it is not counted as a crash.
  process.exit(stopping ? 0 : (code ?? 1));
});
