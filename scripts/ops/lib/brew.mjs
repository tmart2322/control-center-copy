// Homebrew prefix detection, so the ops scripts work on Apple Silicon (/opt/homebrew) and Intel (/usr/local) Macs.
// Twin of src/ops/brew.ts (the app can't import from scripts/ without bundling it); keep the two in step.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const BREW_CANDIDATES = ['/opt/homebrew', '/usr/local'];
export const DEFAULT_BREW_PREFIX = '/opt/homebrew';

const runBrewPrefix = () => execFileSync('brew', ['--prefix'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * Pure resolver: `HOMEBREW_PREFIX` → `brew --prefix` → the first candidate that has `bin/brew` → /opt/homebrew.
 * `run` returns brew's stdout (or throws); `exists` checks a path. Both injectable for tests.
 * @param {{env?: Record<string, string | undefined>, run?: () => string, exists?: (p: string) => boolean}} [deps]
 * @returns {string}
 */
export function resolveBrewPrefix({ env = process.env, run = runBrewPrefix, exists = existsSync } = {}) {
  const fromEnv = env.HOMEBREW_PREFIX?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '') || '/';
  try {
    const out = String(run() ?? '').trim();
    if (out.startsWith('/')) return out.replace(/\/+$/, '') || '/';
  } catch {
    // brew not on PATH, timed out or failed: fall through to the well-known locations
  }
  return BREW_CANDIDATES.find((p) => exists(join(p, 'bin', 'brew'))) ?? DEFAULT_BREW_PREFIX;
}

let cached;
/** The Homebrew prefix for this process (resolved once, then cached). */
export function brewPrefix() {
  cached ??= resolveBrewPrefix();
  return cached;
}

/** Postgres 17's bin directory under a Homebrew prefix. */
export const pg17BinFor = (prefix) => join(prefix, 'opt', 'postgresql@17', 'bin');
/** Postgres 17's bin directory under this machine's Homebrew prefix. */
export const pg17Bin = () => pg17BinFor(brewPrefix());
