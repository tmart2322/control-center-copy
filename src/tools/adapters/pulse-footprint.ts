/**
 * pulse-footprint adapter (http + SSE). Next.js app (greg-playground) on :4318.
 *
 * POST /api/orgs/<orgId15>/run -> SSE (start | progress | done | error).
 * The run reads Pulse (Superset) with a cookie the tool itself obtains; this adapter never
 * sees or forwards it. Because the endpoint calls an external service, the manifest sets
 * requiresConfirm and BaseAdapter refuses to start without `confirm: true`.
 */
import type { ToolManifest } from '../manifest';
import { BaseAdapter, ToolError, expandHome, readSse, render, toolFetch, type RunCtx, type ToolResult } from './base';

export const normalizeOrgId = (id: string) => id.trim().slice(0, 15);

export class PulseFootprintAdapter extends BaseAdapter {
  constructor(manifest: ToolManifest) {
    super(manifest);
    if (manifest.launch.kind !== 'http') throw new Error('pulse-footprint adapter needs an http manifest');
  }

  private get base(): string {
    return (this.manifest.launch as { baseUrl: string }).baseUrl.replace(/\/$/, '');
  }

  private body(input: Record<string, unknown>) {
    const b: Record<string, unknown> = {};
    if (input.windowDays !== undefined) b.windowDays = input.windowDays;
    if (input.asOf !== undefined) b.asOf = input.asOf;
    if (input.dryRun === true) b.dryRun = true;
    return b;
  }

  protected plan(input: Record<string, unknown>): string[] {
    const id = normalizeOrgId(String(input.orgId));
    return [
      `GET ${this.base}/api/orgs (health)`,
      `POST ${this.base}/api/orgs/${id}/run ${JSON.stringify(this.body(input))} (SSE)`,
      'External read: Pulse Superset via the tool (requires confirm)',
    ];
  }

  protected async execute(input: Record<string, unknown>, ctx: RunCtx): Promise<ToolResult> {
    const orgId15 = normalizeOrgId(String(input.orgId));
    const http = { fetch: ctx.fetch, signal: ctx.signal, startCommand: this.startCommand };
    ctx.emit(`starting Pulse run for ${orgId15}${input.dryRun ? ' (tool dry run)' : ''}`, 1);
    const res = await toolFetch(http, `${this.base}/api/orgs/${encodeURIComponent(orgId15)}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(this.body(input)),
    });

    let families = 0;
    let rows = 0;
    let status: { ok?: boolean; exitCode?: number; message?: string; stderrTail?: string } | undefined;
    for await (const ev of readSse(res, ctx.signal)) {
      const d = (ev.data ?? {}) as Record<string, unknown>;
      if (ev.event === 'progress') {
        if (d.kind === 'family-done') { families += 1; rows += Number(d.rows ?? 0); }
        ctx.emit(String(d.text ?? d.kind ?? 'progress'));
      } else if (ev.event === 'done') {
        status = (d.status ?? {}) as typeof status;
        break;
      } else if (ev.event === 'error') {
        throw classifyRunFailure(String(d.message ?? 'Pulse run error'));
      }
    }
    if (!status) throw new ToolError('failed', 'Pulse stream ended before a done event', 'stream_incomplete');
    if (!status.ok) {
      throw classifyRunFailure(status.message || `Pulse run finished with exit code ${status.exitCode ?? '?'}${status.stderrTail ? `: ${status.stderrTail.slice(-300)}` : ''}`);
    }
    ctx.emit('Pulse run complete', 100);

    const tpl = { orgId15, orgId: String(input.orgId) };
    const out = this.manifest.output;
    const links = out.link ? [{ url: render(out.link.urlTemplate, tpl), label: out.link.label }] : [];
    if (!input.dryRun) links.push({ url: `${this.base}/api/orgs/${orgId15}/pptx?download=1`, label: 'Download PowerPoint (glance)' });
    return {
      links,
      artifacts: input.dryRun ? [] : out.artifacts.map((a) => ({ path: expandHome(render(a.pathTemplate, tpl)), label: a.label, mime: a.mime })),
      summary: input.dryRun
        ? `Pulse tool dry run for ${orgId15} finished (no Superset queries).`
        : `Pulse footprint for ${orgId15} reconstructed: ${families} metric families, ${rows} rows.`,
    };
  }
}

function classifyRunFailure(message: string): ToolError {
  if (/no superset session cookie/i.test(message)) {
    return new ToolError('failed', `No Superset session: reopen Pulse Superset in Chrome, then retry. (${message.slice(0, 200)})`, 'no_superset_session');
  }
  return new ToolError('failed', message.slice(0, 500), 'run_failed');
}
