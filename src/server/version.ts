/**
 * GET /version (D-57): the build's version, sha and build time (embedded by next.config.ts `env`), the database's
 * latest applied migration, the persona, and the worker's version. Pure helpers; the DataSources read the database
 * and the persona and call `versionPayload`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { VersionPayload } from '@/contract';
import journal from '@/db/migrations/meta/_journal.json';
import type { ResolvedPersona } from '@/personas';

export interface BuildInfo {
  version: string;
  sha: string | null;
  builtAt: string | null;
}

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

const ENTRIES = [...(journal as { entries: JournalEntry[] }).entries].sort((a, b) => a.idx - b.idx);

function packageVersion(): string {
  try {
    return (JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * The build's identity. Next inlines `process.env.CC_*` at build time (next.config.ts); scripts and tests that run
 * outside Next fall back to package.json and no sha.
 */
export function buildInfo(env: { CC_APP_VERSION?: string; CC_GIT_SHA?: string; CC_BUILT_AT?: string } = {
  CC_APP_VERSION: process.env.CC_APP_VERSION,
  CC_GIT_SHA: process.env.CC_GIT_SHA,
  CC_BUILT_AT: process.env.CC_BUILT_AT,
}): BuildInfo {
  const builtAt = env.CC_BUILT_AT && !Number.isNaN(Date.parse(env.CC_BUILT_AT)) ? new Date(env.CC_BUILT_AT).toISOString() : null;
  return { version: env.CC_APP_VERSION || packageVersion(), sha: env.CC_GIT_SHA || null, builtAt };
}

/** The newest migration this build ships ("0011_vdp_asset_candidates"). */
export function bundledMigration(): string | null {
  return ENTRIES.at(-1)?.tag ?? null;
}

/**
 * The tag of the newest applied migration, from drizzle's `created_at` (the journal's `when`). An applied
 * migration this build does not know (a newer build ran migrate) reads as "newer than this build".
 */
export function migrationTagFor(createdAtMs: number | null): string | null {
  if (createdAtMs === null || !Number.isFinite(createdAtMs)) return null;
  const hit = ENTRIES.find((e) => e.when === createdAtMs);
  if (hit) return hit.tag;
  const last = ENTRIES.at(-1);
  return last && createdAtMs > last.when ? 'newer than this build' : null;
}

/** "1.2.0+abc1234" and "v1.2.0" compare as "1.2.0". */
export function coreVersion(v: string): string {
  return v.trim().replace(/^v/, '').split('+')[0]!;
}

export function versionPayload(input: {
  build: BuildInfo;
  migration: string | null;
  persona: Pick<ResolvedPersona, 'id' | 'level' | 'label'>;
  workerVersion: string | null;
  dataSource: 'mock' | 'db';
}): VersionPayload {
  const bundled = bundledMigration();
  const { build, migration, persona, workerVersion, dataSource } = input;
  return {
    version: build.version,
    sha: build.sha,
    builtAt: build.builtAt,
    migration,
    bundledMigration: bundled,
    persona: { id: persona.id, level: persona.level, label: persona.label },
    workerVersion,
    mismatch: workerVersion !== null && coreVersion(workerVersion) !== coreVersion(build.version),
    migrationPending: dataSource === 'db' && bundled !== null && migration !== bundled && migration !== 'newer than this build',
    dataSource,
  };
}
