/**
 * Feedback delivery adapter (D-56, approved 2026-11-11): Send on a `feedback.post` item posts ONE message to the team's
 * feedback channel.
 *
 *   send / draft (Send) → slack_send_message { channel_id, message }    (both modes: a report has no Slack draft)
 *   read-back           → slack_read_thread { channel_id, message_ts }: the post is there and starts with the report
 *
 * The adapter re-derives the call from the payload and refuses it when the payload is not a feedback post, names no
 * valid channel, carries a thread (a report is always top-level) or is marked invalid. The live relay
 * (src/outbox/transport.ts) checks the channel again against the configured one, and the confirm proof again.
 */
import type { DispatchMode } from '@/contract';
import { FEEDBACK_CHANNEL_ID } from '@/lib/feedback/payload';

import { OUTBOX_SERVER, OUTBOX_TOOLS } from '../mcp-config';
import type { ToolCall, ToolResult, WriteOutcome } from '../types';
import type { OutboxAdapter, ReadbackContext, ReadFn } from './index';
import { mrkdwnToMarkdown, slackAdapter } from './slack';
import { str } from './text';

const SERVER = OUTBOX_SERVER.feedback;

function toolCall(payload: Record<string, unknown>, _mode: DispatchMode): ToolCall {
  if (str(payload.tool) !== 'slack_send_message') throw new Error('invalid_request: a feedback item only posts one message');
  if (typeof payload.invalid === 'string') throw new Error(`invalid_request: ${payload.invalid}`);
  const channel = str(payload.channel);
  const text = str(payload.text);
  if (!channel || !FEEDBACK_CHANNEL_ID.test(channel)) throw new Error('invalid_request: a feedback post needs the configured channel id');
  if (!text?.trim()) throw new Error('invalid_request: the report is empty');
  if (payload.thread_ts !== undefined) throw new Error('invalid_request: a feedback post is top-level, never a thread reply');
  return { server: SERVER, tool: OUTBOX_TOOLS.feedback.write.send, args: { channel_id: channel, message: mrkdwnToMarkdown(text) } };
}

function parseWrite(result: ToolResult): WriteOutcome {
  return slackAdapter.parseWrite(result, 'send');
}

/** The Slack adapter's read-back of a sent message, always as a send. */
function readback(read: ReadFn, ctx: ReadbackContext) {
  return slackAdapter.readback(read, { ...ctx, mode: 'send' });
}

export const feedbackAdapter: OutboxAdapter = { channel: 'feedback', toolCall, parseWrite, readback };
