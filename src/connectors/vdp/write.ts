/**
 * The VDP write transport, for the Outbox only (*tenet: Nothing leaves without approval*). Only `src/outbox/**`
 * imports this file (tests/beoutbox/guard.test.ts); the scanner side never does.
 *
 * It is a plain `callTool({server, tool, args})` transport over the same JSON-RPC core as the read client:
 *  - writes: VDP_WRITE_TOOLS (the field writes, `create_vdp`, and the D-59 tools once VDP lists them), nothing else;
 *  - read-back: `get_use_case`, `get_vdp`, `get_vdp_assets`, `list_companies` (reads).
 * The Outbox gateway calls it only with a consumed, single-use confirm proof for that exact payload, and only when
 * dry-run is off (dry-run never reaches a transport). A delete or generate tool is refused here as everywhere.
 */
import { callVdpTool, type VdpHttpOptions } from './http';
import { vdpTimeoutFor, type VdpLimiter } from './limiter';
import { isVdpWriteTool, VDP_SERVER_NAME, VdpToolRefusedError } from './tools';

export interface VdpToolCall {
  server: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface VdpWriteTransport {
  callTool(call: VdpToolCall, opts?: { signal?: AbortSignal }): Promise<{ text: string; isError?: boolean }>;
}

/** Read tools the Outbox's read-back and its live check before each write (D-69, VD-21) may use (not widened). */
export const VDP_READBACK_TOOLS = Object.freeze(['get_use_case', 'get_vdp', 'get_vdp_assets', 'list_companies'] as const);

/**
 * D-69 (VD-27): `limiter` is the window this transport shares with the read client (60 calls a minute per user upstream);
 * Generate gets a 120 s timeout (it takes 30-90 s), every other call the usual 30 s.
 */
export function vdpWriteTransport(o: VdpHttpOptions & { limiter?: VdpLimiter } = {}): VdpWriteTransport {
  return {
    async callTool(call, opts = {}) {
      if (call.server !== VDP_SERVER_NAME) throw new VdpToolRefusedError(`${call.server}/${call.tool}`, `the VDP transport only serves ${VDP_SERVER_NAME}`);
      const kind = isVdpWriteTool(call.tool) ? 'write' : (VDP_READBACK_TOOLS as readonly string[]).includes(call.tool) ? 'read' : null;
      if (!kind) throw new VdpToolRefusedError(call.tool, 'not a VDP Outbox write or read-back tool');
      await o.limiter?.slot(opts.signal ? { signal: opts.signal } : {});
      const r = await callVdpTool(call.tool, call.args, kind, { ...o, timeoutMs: vdpTimeoutFor(call.tool, o.timeoutMs), signal: opts.signal });
      // list_companies (create_company's read-back) answers in markdown text with its data in structuredContent: the
      // adapter reads JSON, so hand it the structured result whenever the tool sent one (D-63)
      return { text: r.json !== null && r.json !== undefined && typeof r.json === 'object' ? JSON.stringify(r.json) : r.text };
    },
  };
}
