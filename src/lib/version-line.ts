/**
 * How the app's version reads in the sidebar footer and Settings ▸ About (D-57). Pure, so the kit and tests can
 * render every state.
 */
import type { VersionPayload } from '@/contract';

export interface VersionLine {
  /** "v1.0.0 · abc1234" */
  text: string;
  /** Something needs a restart or a migrate. */
  warn: string | null;
  /** The short word after the version when it warns. */
  action: 'restart' | 'migrate' | null;
}

export function versionLabel(v: Pick<VersionPayload, 'version' | 'sha'>): string {
  return `v${v.version}${v.sha ? ` · ${v.sha}` : ''}`;
}

export function versionWarning(v: Pick<VersionPayload, 'version' | 'workerVersion' | 'mismatch' | 'migrationPending' | 'bundledMigration'>): string | null {
  if (v.mismatch && v.workerVersion) return `The worker runs v${v.workerVersion.replace(/^v/, '')}, the app v${v.version}. Run npm run update to restart both.`;
  if (v.migrationPending) return `This build ships migration ${v.bundledMigration ?? 'updates'} the database hasn't applied. Run npm run update (or npm run db:migrate).`;
  return null;
}

export function versionLine(v: VersionPayload): VersionLine {
  const warn = versionWarning(v);
  return { text: versionLabel(v), warn, action: !warn ? null : v.mismatch ? 'restart' : 'migrate' };
}
