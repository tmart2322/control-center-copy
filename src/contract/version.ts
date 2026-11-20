/**
 * The running app's version (D-57): what a teammate reads off the sidebar footer or Settings ▸ About when someone
 * asks "which version are you on?". Versions follow semver (docs/RELEASING.md); the build embeds the short git sha
 * and the build time, and the worker records its own version in `worker_instances.app_version`.
 */
import { z } from 'zod';
import { IsoDateTime } from './common';
import { PersonaId, PersonaLevel } from './persona';

export const VersionPayload = z.object({
  /** package.json version at build time ("1.0.0"). */
  version: z.string(),
  /** Short git sha the build came from; null outside a git checkout. */
  sha: z.string().nullable(),
  /** When this build was made (dev: when the dev server started). */
  builtAt: IsoDateTime.nullable(),
  /** The latest database migration applied ("0011_vdp_asset_candidates"); null in mock mode or before the first migrate. */
  migration: z.string().nullable(),
  /** The latest migration this build ships; differs from `migration` until `npm run db:migrate` runs. */
  bundledMigration: z.string().nullable(),
  persona: z.object({ id: PersonaId, level: PersonaLevel, label: z.string() }),
  /** The running worker's version (worker_instances.app_version); null when no worker is running. */
  workerVersion: z.string().nullable(),
  /** The web app and the worker run different versions (restart both: `npm run update`). */
  mismatch: z.boolean(),
  /** The build ships migrations the database has not applied yet. */
  migrationPending: z.boolean(),
  dataSource: z.enum(['mock', 'db']),
});
export type VersionPayload = z.infer<typeof VersionPayload>;
