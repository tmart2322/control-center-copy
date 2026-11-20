/**
 * `vdp.push` (queue `vdp`, concurrency 1; D-63): one "Push N to VDP", in order. Queued by the route
 * (`POST /deals/vdp/push`, dry run off) with the push's id; the items, already staged as Outbox items and listed in kv
 * `cc.vdp.push`, are applied one after the other by the DataSource (`DbDataSource.runVdpPush`, the shared runner in
 * src/server/vdp/push.ts): each approved by the push click and delivered by the Outbox job inline through the gateway
 * (allowlist, single-use proof, dry run re-read, read-back), the new company's, VDP's or use case's id passed to the
 * items under it, a failure stopping only its branch. Never retried (maxAttempts 1): an ambiguous write could repeat.
 * jobs.result holds counts only.
 */
import type { DbHandle } from '@/db/client';
import type { OutboxGateway } from '@/outbox';
import { featureActive } from '@/personas';
import { DbDataSource } from '@/server/datasource/db';
import { loadPersona } from '@/server/datasource/db/store/persona';
import { VDP_ASSETS_QUEUE } from '@/server/datasource/db/store/vdp-candidates';
import { VDP_PUSH_JOB } from '@/server/vdp/push';

import type { JobHandlerDef } from '../types';

export { VDP_PUSH_JOB };

export interface VdpPushDeps {
  handle: DbHandle;
  /** The Outbox gateway over the live transport (the worker's), or a fake in tests. */
  gateway: OutboxGateway | null;
}

export function vdpPushJobDef(deps: VdpPushDeps): JobHandlerDef {
  return {
    kind: VDP_PUSH_JOB,
    queue: VDP_ASSETS_QUEUE,
    wired: true,
    description: 'Push to VDP (D-63): the ticked VDP items in order, each approved by your push, new ids passed down, through the Outbox',
    handler: async (ctx) => {
      if (!featureActive(await loadPersona(ctx.db, ctx.userId), 'vdp')) return { skipped: 'vdp_inactive' };
      const pushId = typeof ctx.job.payload.pushId === 'string' ? ctx.job.payload.pushId : null;
      if (!pushId) return { skipped: 'bad_payload' };
      const ds = new DbDataSource({ handle: deps.handle, userId: ctx.userId, clock: { now: ctx.clock } });
      return ds.runVdpPush({ pushId, gateway: deps.gateway, signal: ctx.signal });
    },
  };
}
