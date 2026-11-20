/**
 * Homebrew prefix detection, so the app works on Apple Silicon (/opt/homebrew) and Intel (/usr/local) Macs.
 * Twin of scripts/ops/lib/brew.mjs (the app can't import from scripts/ without bundling it); keep the two in step.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const BREW_CANDIDATES = ['/opt/homebrew', '/usr/local'] as const;
export const DEFAULT_BREW_PREFIX = '/opt/homebrew';

export interface BrewDeps {
  env?: Record<string, string | undefined>;
  /** Returns `brew --prefix` stdout, or throws when brew is missing or fails. */
  run?: () => string;
  exists?: (path: string) => boolean;
}

const runBrewPrefix = (): string => execFileSync('brew', ['--prefix'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
const trimSlash = (p: string): string => p.replace(/\/+$/, '') || '/';

/** Pure resolver: `HOMEBREW_PREFIX` → `brew --prefix` → the first candidate that has `bin/brew` → /opt/homebrew. */
export function resolveBrewPrefix({ env = process.env, run = runBrewPrefix, exists = existsSync }: BrewDeps = {}): string {
  const fromEnv = env.HOMEBREW_PREFIX?.trim();
  if (fromEnv) return trimSlash(fromEnv);
  try {
    const out = String(run() ?? '').trim();
    if (out.startsWith('/')) return trimSlash(out);
  } catch {
    // brew not on PATH, timed out or failed: fall through to the well-known locations
  }
  return BREW_CANDIDATES.find((p) => exists(join(p, 'bin', 'brew'))) ?? DEFAULT_BREW_PREFIX;
}

let cached: string | undefined;
/** The Homebrew prefix for this process (resolved once, then cached). */
export function brewPrefix(): string {
  cached ??= resolveBrewPrefix();
  return cached;
}

/** Postgres 17's bin directory under a Homebrew prefix. */
export const pg17BinFor = (prefix: string): string => join(prefix, 'opt', 'postgresql@17', 'bin');
/** Postgres 17's bin directory under this machine's Homebrew prefix. */
export const pg17Bin = (): string => pg17BinFor(brewPrefix());
