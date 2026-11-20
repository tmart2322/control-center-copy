/**
 * `vdp.autopilot` (queue `vdp`, concurrency 1; D-60): VDP autopilot's run. Queued by the worker hook after each VDP read
 * and every 30 minutes while the setting is on (src/worker/vdp-autopilot-hook.ts); a manual run is the same job.
 *
 * The run itself is the DataSource's (`DbDataSource.runVdpAutopilot`, the shared runner in src/server/vdp/autopilot.ts):
 * the shared coverage decides what is app-fixable with known values, each item is staged and applied through the
 * Outbox under the autonomy policy (read-back, History, the daily cap), and the ledger keeps it idempotent. VDP's
 * sign-in is read from the stored config only (no network): a stale cookie or missing PAT pauses it, told once.
 * jobs.result holds counts and codes only.
 */
import type { DbHandle } from '@/db/client';
import { featureActive } from '@/personas';
import type { OutboxGateway } from '@/outbox';
import { DbDataSource } from '@/server/datasource/db';
import { loadPersona } from '@/server/datasource/db/store/persona';
import { VDP_ASSETS_QUEUE } from '@/server/datasource/db/store/vdp-candidates';

import type { JobHandlerDef } from '../types';

export const VDP_AUTOPILOT_JOB = 'vdp.autopilot';

export interface VdpAutopilotDeps {
  handle: DbHandle;
  /** The Outbox gateway over the live transport (the worker's), or a fake in tests. */
  gateway: OutboxGateway | null;
  /** VDP's sign-in: default = the connector's own check of the stored PAT and cookie (no network). */
  auth?: () => Promise<'ok' | 'stale'>;
  /** Tell the user once that autopilot paused (a notification); Health and the VDP view show it meanwhile. */
  notify?: (why: 'reauth' | 'dry_run' | 'cap') => Promise<void>;
}

/** The stored PAT and Okta cookie, checked without a network call: auth_required or disabled = stale. */
export async function liveVdpAuth(): Promise<'ok' | 'stale'> {
  const { VdpClient } = await import('@/connectors/vdp/client');
  const h = new VdpClient().health();
  return h.state === 'ok' || h.state === 'degraded' ? 'ok' : 'stale';
}

export function vdpAutopilotJobDef(deps: VdpAutopilotDeps): JobHandlerDef {
  return {
    kind: VDP_AUTOPILOT_JOB,
    queue: VDP_ASSETS_QUEUE,
    wired: true,
    description: 'VDP autopilot (D-60): apply the VDP items the app can fix with known values, through the Outbox',
    handler: async (ctx) => {
      // D-55: VDP is a persona feature; without it autopilot does nothing
      if (!featureActive(await loadPersona(ctx.db, ctx.userId), 'vdp')) return { skipped: 'vdp_inactive' };
      const ds = new DbDataSource({ handle: deps.handle, userId: ctx.userId, clock: { now: ctx.clock } });
      return ds.runVdpAutopilot({ gateway: deps.gateway, auth: deps.auth ?? liveVdpAuth, ...(deps.notify ? { notify: deps.notify } : {}), signal: ctx.signal });
    },
  };
}
