/**
 * Delivery error classification. Codes and messages are body-free (*tenet: Local data, privacy-safe logs*):
 * they name the failure, never the message, recipients or tool arguments.
 */
import type { DeliveryError } from './types';

interface Sig {
  code: string;
  re: RegExp;
  retryable: boolean;
  message: string;
}

/** Ordered: first match wins. */
const SIGS: Sig[] = [
  // 2026-11-16: the relay ended before it called the tool (RelayNotSentError): nothing reached the destination, so it is
  // safe to send again (a canvas too: never "check Slack first")
  { code: 'not_sent', re: /RelayNotSentError/, retryable: true, message: 'Nothing was sent: the app stopped before it reached the destination. Try again' },
  { code: 'not_confirmed', re: /NotConfirmedError|not_confirmed|no confirm/i, retryable: false, message: 'Not confirmed: nothing was delivered' },
  { code: 'tool_refused', re: /OutboxToolRefusedError|VdpToolRefusedError|not on the outbox/i, retryable: false, message: 'Tool refused by the outbox allowlist' },
  { code: 'live_disabled', re: /OutboxLiveDisabledError|live outbox transport is not enabled/i, retryable: false, message: 'Live delivery is not enabled in this build' },
  { code: 'auth', re: /invalid_auth|not_authed|token_revoked|token_expired|needs[- ]auth|requires re-?auth|unauthori[sz]ed|\b401\b|invalid_grant|re-?authenticat/i, retryable: false, message: 'Not signed in to the destination: re-auth, then retry' },
  { code: 'channel_not_found', re: /channel_not_found/i, retryable: false, message: 'Slack channel not found or not accessible' },
  { code: 'not_in_channel', re: /not_in_channel/i, retryable: false, message: 'You are not a member of that Slack channel' },
  { code: 'is_archived', re: /is_archived/i, retryable: false, message: 'That Slack channel is archived' },
  { code: 'attached_draft_exists', re: /attached_draft_exists/i, retryable: false, message: 'A Slack draft already exists in that channel: send or delete it first' },
  { code: 'msg_too_long', re: /msg_too_long|too long|5000 chars/i, retryable: false, message: 'Message is too long for the destination' },
  // D-69 (VD-06): VDP says the record is gone (a company merged into another, an archived VDP): not sent, and not retried
  { code: 'not_found', re: /\b(?:company|vdp|use[ _]case|asset)s?\b.{0,80}\bnot found\b|no active (?:company|industry)/i, retryable: false, message: 'Not found in the destination (merged, archived or deleted there): nothing was sent' },
  { code: 'rate_limited', re: /ratelimited|rate[_ ]limit|rateLimitExceeded|too many requests|\b429\b|quota/i, retryable: true, message: 'Rate limited by the destination: retry shortly' },
  { code: 'invalid_request', re: /invalid_request|invalid_arguments|invalid (?:params|arguments)|validation error|invalid_blocks|invalid to|bad request|\b400\b/i, retryable: false, message: 'The destination rejected the request' },
  { code: 'transient', re: /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|fetch failed|time(?:d)?[ -]?out|\b5\d\d\b|service unavailable|internal error|overloaded/i, retryable: true, message: 'Destination unavailable: retry' },
  { code: 'failed_to_create_draft', re: /failed_to_create_draft/i, retryable: true, message: 'Slack could not create the draft: retry' },
];

export function classifyDeliveryError(err: unknown): DeliveryError {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? '');
  for (const s of SIGS) if (s.re.test(text)) return { code: s.code, message: s.message, retryable: s.retryable };
  return { code: 'unknown', message: 'Delivery failed for an unknown reason', retryable: true };
}

/**
 * A relayed call (src/llm/one-call.ts) that ended before the tool was called: the destination never saw it. Body-free,
 * like ToolCallError.
 */
export class RelayNotSentError extends Error {
  override name = 'RelayNotSentError';
  constructor(
    readonly tool: string,
    detail: string,
  ) {
    super(`${tool} was not called: ${detail.slice(0, 200)}`);
  }
}

/** A relayed call's failure: not sent when the tool was never called, else the tool's own error (it may have landed). */
export function relayFailure(tool: string, r: { code: string; message: string; called?: boolean }): Error {
  const why = r.code === 'timeout' ? 'timed out' : r.message || r.code;
  return r.called === false && r.code !== 'disallowed_tool' ? new RelayNotSentError(tool, why) : new ToolCallError(tool, why);
}

/** A tool result with the MCP error flag, raised as an error so one classifier handles both paths. */
export class ToolCallError extends Error {
  override name = 'ToolCallError';
  constructor(
    readonly tool: string,
    detail: string,
  ) {
    // Detail comes from the destination's error text: keep it short; it is classified, not stored.
    super(`${tool} returned an error: ${detail.slice(0, 200)}`);
  }
}
