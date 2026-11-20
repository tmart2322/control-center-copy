/**
 * The guarded door between delivery adapters and an MCP transport. Every outbox tool call goes through it:
 *
 * - `write()` derives the call itself from the confirmed payload (the channel adapter's `toolCall`), so the
 *   arguments can only be what was confirmed. It calls only the one write tool for that channel + mode (VDP: the
 *   item's op, from the channel's short op list), only
 *   when the payload hash equals the proof's, and only with a minted, unused `DeliveryConfirmation`, which it
 *   consumes. Anything else throws before the transport is touched.
 * - `read()` only calls allowlisted read-back tools.
 *
 * The transport is injected. Tests and the mock DataSource use fakes; the live transport is fail-closed in
 * this build (`./transport.ts`).
 */
import type { DispatchMode } from '@/contract';

import { adapterFor } from './adapters';
import { assertConfirmedFor, consumeConfirmation, type DeliveryConfirmation } from './confirm';
import { ToolCallError } from './errors';
import { payloadHash } from './hash';
import { assertOutboxTool, OutboxToolRefusedError, writeToolsFor } from './mcp-config';
import type { OutboxChannel, ToolCall, ToolResult } from './types';

/** What the gateway tells the transport about a write: which channel's adapter made the call, and the spent proof. */
export interface TransportCallOptions {
  signal?: AbortSignal;
  /** Set on writes only: the channel whose adapter derived the call (a relay may carry a tool for one channel only). */
  channel?: OutboxChannel;
  /** Set on writes only: the confirm proof the gateway just spent on this call (`assertSpentOn`). */
  proof?: DeliveryConfirmation;
}

export interface OutboxTransport {
  callTool(call: ToolCall, opts?: TransportCallOptions): Promise<ToolResult>;
}

export interface WriteRequest {
  draftId: string;
  channel: OutboxChannel;
  mode: DispatchMode;
  payload: Record<string, unknown>;
}

export class OutboxGateway {
  constructor(private readonly transport: OutboxTransport) {}

  async write(req: WriteRequest, confirmation: DeliveryConfirmation | unknown, opts: { signal?: AbortSignal } = {}): Promise<{ call: ToolCall; result: ToolResult }> {
    const call = adapterFor(req.channel).toolCall(req.payload, req.mode);
    const expected = writeToolsFor(req.channel, req.mode);
    if (call.server !== expected.server || !expected.tools.includes(call.tool)) {
      throw new OutboxToolRefusedError(`mcp__${call.server}__${call.tool}`, `a ${req.channel} ${req.mode} may only call ${expected.tools.join(' or ')}`);
    }
    assertOutboxTool(call.server, call.tool, 'write');
    assertConfirmedFor(confirmation, { draftId: req.draftId, mode: req.mode, payloadHash: payloadHash(req.payload) });
    opts.signal?.throwIfAborted();
    consumeConfirmation(confirmation, call);
    const result = await this.transport.callTool(call, { ...opts, channel: req.channel, proof: confirmation });
    if (result.isError) throw new ToolCallError(call.tool, result.text);
    return { call, result };
  }

  async read(call: ToolCall, opts: { signal?: AbortSignal } = {}): Promise<ToolResult> {
    assertOutboxTool(call.server, call.tool, 'read');
    opts.signal?.throwIfAborted();
    const result = await this.transport.callTool(call, opts);
    if (result.isError) throw new ToolCallError(call.tool, result.text);
    return result;
  }
}
