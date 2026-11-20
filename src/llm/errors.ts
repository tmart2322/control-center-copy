/**
 * Error classification for scanner runs (brief 09 §5.3 "Errors" and §7 health table).
 * Output feeds `ConnectorHealthProbe.errorClass`, the job queue's backoff, and the Health page.
 * Detail strings carry signature codes only, never message bodies (tenet: Local data, privacy-safe logs).
 */
import { vdpRefreshCommand } from '@/contract';
import type { ConnectorHealthProbe, ConnectorId } from '../scanner/types';
import { safeLogText } from './redact';

export type ErrorClass = NonNullable<ConnectorHealthProbe['errorClass']>;

interface Signature {
  cls: ErrorClass;
  code: string;
  re: RegExp;
  /** True when the auth failure is the LLM gateway (devbar / apiKeyHelper), not the connector. */
  gateway?: boolean;
}

/** Ordered: first match wins. Auth before transient, so "401 … ECONNRESET" reads as auth. */
const SIGNATURES: Signature[] = [
  // a service's maintenance page (devbar's MCP gateway on 2026-11-13): an outage, retried; first, because the page
  // is HTML and would otherwise read as an SSO redirect (auth) or nothing at all
  { cls: 'transient', code: 'maintenance', re: /down for maintenance|under maintenance|\[gateway_down\]/i },
  { cls: 'auth', code: 'gateway_invalid_api_key', re: /invalid api key|fix external api key|authentication_failed|apiKeyHelper/i, gateway: true },
  { cls: 'auth', code: 'needs_auth', re: /needs-auth|needs auth|requires? (?:re-?)?auth(?:entication|orization)?/i },
  { cls: 'auth', code: 'invalid_auth', re: /\b(invalid_auth|not_authed|token_revoked|token_expired|account_inactive|invalid_grant|INVALID_SESSION_ID|INVALID_AUTH_HEADER)\b/i },
  { cls: 'auth', code: 'http_401', re: /\b401\b|unauthori[sz]ed/i },
  { cls: 'auth', code: 'sso_redirect', re: /unexpected content type: text\/html|auth\.herokuapp-internal\.com|okta/i },
  // E5 (lane E): any other failed POST to an MCP gateway ("Streamable HTTP error", "upstream request failed") is its
  // outage: retried, no re-auth. After the sign-in signatures, so a refused sign-in still reads as auth.
  { cls: 'transient', code: 'gateway_error', re: /Streamable HTTP error|upstream request failed|\[gateway_error\]/i },
  { cls: 'rate_limited', code: 'rate_limited', re: /\b(ratelimited|rate[_ ]limit(?:ed|_exceeded)?|rateLimitExceeded|REQUEST_LIMIT_EXCEEDED|too many requests)\b|\b429\b/i },
  { cls: 'config', code: 'disallowed_tool', re: /disallowed tool|not allowlisted|non-allowlisted/i },
  { cls: 'config', code: 'slack_scope', re: /\b(channel_not_found|not_in_channel|missing_scope|is_archived)\b/i },
  { cls: 'config', code: 'soql_invalid', re: /\b(MALFORMED_QUERY|INVALID_FIELD|INVALID_TYPE|INVALID_QUERY_FILTER_OPERATOR)\b/i },
  { cls: 'config', code: 'model_not_found', re: /model_not_found|invalid model|unknown model/i },
  { cls: 'config', code: 'executable_missing', re: /ENOENT|spawn .* not found|claude code executable/i },
  { cls: 'config', code: 'skill_missing', re: /skill file not found|invalid skill frontmatter/i },
  { cls: 'transient', code: 'network', re: /\b(ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|fetch failed|network error)\b/i },
  { cls: 'transient', code: 'overloaded', re: /\b(overloaded|529|server_error|internal server error|bad gateway|service unavailable|gateway timeout)\b|\b5\d\d\b/i },
  { cls: 'transient', code: 'timeout', re: /\btime(?:d)?[ -]?out\b|watchdog|aborted/i },
];

export interface Classification {
  errorClass: ErrorClass;
  code: string;
  gateway: boolean;
}

export function classifyError(err: unknown): Classification {
  const text = errorText(err);
  for (const s of SIGNATURES) {
    if (s.re.test(text)) return { errorClass: s.cls, code: s.code, gateway: s.gateway ?? false };
  }
  return { errorClass: 'unknown', code: 'unknown', gateway: false };
}

/** Init `mcp_servers[].status` → classification (brief 09 §7). */
export function classifyMcpStatus(status: string): Classification | null {
  switch (status) {
    case 'connected':
      return null;
    case 'needs-auth':
      return { errorClass: 'auth', code: 'needs_auth', gateway: false };
    case 'failed':
      return { errorClass: 'transient', code: 'mcp_failed', gateway: false };
    case 'disabled':
      return { errorClass: 'config', code: 'mcp_disabled', gateway: false };
    default:
      return null; // 'pending' resolves later
  }
}

export function errorText(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Server names as declared in ~/.claude.json (OAuth reuse depends on the exact name, brief 09 §5.3). */
export const MCP_SERVER_NAME: Partial<Record<ConnectorId, string>> = {
  slack: 'slack',
  org62: 'Org62-Sobject-Read',
};

export function reauthFor(connector: ConnectorId, c: Classification): ConnectorHealthProbe['reauth'] | undefined {
  if (c.errorClass !== 'auth') return undefined;
  if (c.gateway) {
    return { kind: 'terminal_command', command: 'devbar auth login', instructions: 'Sign in to devbar; all LLM stages pause until it is fixed.' };
  }
  const server = MCP_SERVER_NAME[connector];
  if (server) {
    return {
      kind: 'terminal_command',
      command: `claude mcp login ${server}`,
      instructions: `In any Claude session: /mcp → ${server} → Authenticate.`,
    };
  }
  if (connector === 'vdp') return { kind: 'refresh_script', command: vdpRefreshCommand(null) };
  return { kind: 'instructions', instructions: 'Reconnect this source from Settings → Connectors.' };
}

/** Build the probe recorded on failure. `detail` holds the signature code plus a short redacted hint. */
export function probeFromError(connector: ConnectorId, err: unknown, checkedAt: string, consecutiveTransient = 0): ConnectorHealthProbe {
  const c = classifyError(err);
  return probeFromClassification(connector, c, checkedAt, consecutiveTransient, safeLogText(errorText(err), 160));
}

export function probeFromClassification(
  connector: ConnectorId,
  c: Classification,
  checkedAt: string,
  consecutiveTransient = 0,
  hint?: string,
): ConnectorHealthProbe {
  let state: ConnectorHealthProbe['state'];
  switch (c.errorClass) {
    case 'auth':
      state = 'auth_required';
      break;
    case 'transient':
    case 'rate_limited':
      state = consecutiveTransient >= 6 ? 'down' : 'degraded';
      break;
    default:
      state = 'degraded';
  }
  const probe: ConnectorHealthProbe = { state, errorClass: c.errorClass, detail: hint ? `${c.code}: ${hint}` : c.code, checkedAt };
  const reauth = reauthFor(connector, c);
  if (reauth) probe.reauth = reauth;
  return probe;
}

export function retryable(cls: ErrorClass): boolean {
  return cls === 'transient' || cls === 'rate_limited' || cls === 'unknown';
}
