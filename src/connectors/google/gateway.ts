/**
 * devbar's MCP gateway errors that aren't about you. Its own module (no MCP client), so the scanner runtime's wording
 * (status-reason.ts) shares the words without loading the Google client.
 */

/**
 * The MCP gateway behind devbar answering with its maintenance page (HTTP 503, "This application is down for
 * maintenance"): an outage of the gateway, not your sign-in. Seen for an hour on 2026-11-13, when every Google read
 * (and every other server behind the gateway) got it on most calls; it read as "a run failed".
 */
export const GATEWAY_DOWN = /down for maintenance|under maintenance|we['’]ll be back shortly/i;
export const GATEWAY_DOWN_WORDS = "devbar's MCP gateway is down for maintenance (not your sign-in), retrying";

/** An HTML error page's text (tags and runs of space dropped), so the cause fits the 300-character detail. */
export function htmlPageText(detail: string): string {
  if (!/<(?:html|body|table|center|div|span)\b/i.test(detail)) return detail;
  return detail
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lane E (E5, audit 2026-11-13): any other failed POST to the gateway (the MCP SDK's "Streamable HTTP error: Error
 * POSTing to endpoint: …", an error page, "upstream request failed") is the gateway's outage too: retried, no re-auth.
 * Checked after the sign-in signatures, so a 401 or a sign-in page still reads as auth. Before, these ran as
 * "[unknown]" ("a run failed"): about 50 failed runs in the week to 2026-11-13.
 */
export const GATEWAY_ERROR = /Streamable HTTP error|upstream request failed|\[gateway_error\]/i;
export const GATEWAY_ERROR_WORDS = "devbar's MCP gateway isn't answering (not your sign-in), retrying";
