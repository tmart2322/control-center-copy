/**
 * A worker in its own process (for SIGKILL and restart-storm scenarios). The parent owns the simulated clock
 * (it writes `stress.clock`); the child follows it, runs the same World loop, and exits 0 on SIGTERM after a
 * graceful drain (the production shutdown path). SIGKILL leaves everything as a dead worker would.
 *   tsx scripts/stress/driver/child.ts <config.json>
 */
import fs from 'node:fs';

import { loadProfile } from '../lib/profile';

import { World, type WorldOptions } from './world';

interface ChildConfig {
  scenario: string;
  db: { name: string; url: string };
  sources: WorldOptions['sources'];
  runner: WorldOptions['runner'];
  channels?: string[];
  stallMs?: number;
}

async function main() {
  const cfg = JSON.parse(fs.readFileSync(process.argv[2]!, 'utf8')) as ChildConfig;
  const w = new World({
    scenario: cfg.scenario,
    start: new Date().toISOString(),
    sources: cfg.sources,
    runner: cfg.runner,
    channels: cfg.channels,
    profile: loadProfile(),
    reuseDb: cfg.db,
    // Slow the scripted traversal down so a kill lands mid-run.
    hooks: cfg.stallMs ? { beforeCall: async () => void (await new Promise((r) => setTimeout(r, cfg.stallMs))) } : undefined,
    log: (m) => process.stdout.write(`${m}\n`),
  });
  await w.init();
  let stopping = false;
  let loopDone: () => void = () => undefined;
  const loopFinished = new Promise<void>((r) => (loopDone = r));
  process.on('SIGTERM', () => {
    stopping = true;
    void (async () => {
      // Production shutdown order: stop claiming and drain, then let the loop exit, then close the pool.
      await w.shutdown('SIGTERM');
      await loopFinished;
      await w.close();
      process.exit(0);
    })();
  });
  await w.boot();
  process.stdout.write('READY\n');
  try {
    while (!stopping) {
      await w.clock.syncFromDb(w.handle.db);
      await w.step({ maxWaitMs: 5000 });
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch (e) {
    if (!stopping) throw e; // an error while draining is the shutdown racing the loop, not a failure
  } finally {
    loopDone();
  }
}

main().catch((e) => {
  process.stderr.write(`child failed: ${(e as Error).stack}\n`);
  process.exit(1);
});
