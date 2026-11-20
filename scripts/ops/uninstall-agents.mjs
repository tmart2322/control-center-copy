#!/usr/bin/env node
// Stop and remove the Control Center LaunchAgents. Logs, state and the database are left alone.
//   node scripts/ops/uninstall-agents.mjs [--yes]
import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { WEB_LABEL, WORKER_LABEL } from './lib/plist.mjs';

const dir = process.env.CC_LAUNCH_AGENTS_DIR ?? join(homedir(), 'Library', 'LaunchAgents');
const labels = [WEB_LABEL, WORKER_LABEL];
const present = labels.filter((l) => existsSync(join(dir, `${l}.plist`)));

if (present.length === 0) {
  console.log('No Control Center LaunchAgents are installed.');
  process.exit(0);
}

let go = process.argv.includes('--yes');
if (!go && process.stdin.isTTY) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  go = /^y(es)?$/i.test((await rl.question(`Stop and remove ${present.join(', ')}? [y/N] `)).trim());
  rl.close();
}
if (!go) {
  console.log('Aborted. Nothing was removed.');
  process.exit(1);
}

for (const l of present) {
  try {
    execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${l}`], { stdio: 'pipe' });
  } catch {
    /* was not loaded */
  }
  unlinkSync(join(dir, `${l}.plist`));
  console.log(`removed ${l}`);
}
console.log('Logs (~/Library/Logs/control-center) and state were kept.');
