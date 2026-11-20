/**
 * HYG-1: every scope a scan can run, per connector, in one place. Pure (no DB, no runtime), so the web process (Health
 * "Rescan" validation), the worker (ScannerRuntime.executeJob) and the hygiene sweep (scan_runs with unknown scopes)
 * all ask the same question.
 *
 * Why: `POST /connectors/:id/scan {scope: "org62:events"}` used to run scope `events` prefixed a second time
 * (`org62:org62:events`). The Org62 skill had no query for that scope, so the run read nothing and still said
 * "succeeded"; the runtime then registered the bogus scope as a polled one and re-ran it on its own (startup catch-up,
 * head and backfill chunks). Now an unknown scope is a 400 that lists the valid ones, and the runtime refuses to run
 * (or register) a scope that is not in this catalog.
 *
 *   requestable  what a user (Health, chat) may ask a scan for, with an optional `<connector>:` prefix
 *   internal     scopes only the app itself runs (targeted thread reads, reconcile relinks, the completion pass, the
 *                Org62 read-back); valid in the ledger, never requestable as a scan
 */
import { ALL_ORG62_SCOPES } from '../personas/types';
import type { ConnectorId } from './types';

interface CatalogEntry {
  /** Fixed scope names a scan may be asked for. */
  fixed: readonly string[];
  /** Dynamic requestable scopes (Slack channels, Watch subscriptions). */
  patterns?: readonly RegExp[];
  /** How the patterns read in an error message. */
  patternLabels?: readonly string[];
  /** The scope a bare "Rescan" runs (Health's RESCAN_SCOPE, chat's /rescan). */
  default: string | null;
}

/** The Org62 read-back reconcile (src/jobs/handlers/org62-readback.ts): re-reads my logged Events and my DCs by Id. */
export const ORG62_READBACK_SCOPE = 'readback';

export const SCOPE_CATALOG: Readonly<Record<ConnectorId, CatalogEntry>> = {
  slack: { fixed: ['inbox'], patterns: [/^channel:\S+$/], patternLabels: ['channel:<id>'], default: 'inbox' },
  org62: { fixed: [...ALL_ORG62_SCOPES, ORG62_READBACK_SCOPE], default: 'opps' },
  gmail: { fixed: ['inbox', 'sent'], default: 'inbox' },
  calendar: { fixed: ['primary'], default: 'primary' },
  drive: { fixed: ['tracked'], default: 'tracked' },
  gemini_notes: { fixed: ['poll'], default: 'poll' },
  claude_sessions: { fixed: ['all'], default: 'all' },
  trainings: { fixed: ['gmail', 'calendar'], default: null },
  watch: { fixed: [], patterns: [/^[a-z_]+:\S+$/], patternLabels: ['<kind>:<ref>'], default: null },
  vdp: { fixed: ['mine'], default: 'mine' },
};

/** Scopes the app runs itself: valid in the ledger and for runtime jobs, never requestable. */
const INTERNAL: Readonly<Partial<Record<ConnectorId, readonly RegExp[]>>> = {
  slack: [/^thread:[A-Z0-9]+:\d+(\.\d+)?$/],
};
const INTERNAL_ANY = [/^reconcile:[a-z_]+$/, /^completion:check$/, /^rescan$/];

/** UI source names (Connector.source) that differ from the connector id. */
const SOURCE_ALIAS: Readonly<Record<string, ConnectorId>> = { gemini: 'gemini_notes', claude: 'claude_sessions' };

export const CATALOG_CONNECTORS = Object.keys(SCOPE_CATALOG) as ConnectorId[];

export function connectorOfName(name: string | null | undefined): ConnectorId | null {
  const n = (name ?? '').trim().toLowerCase();
  if (!n) return null;
  if ((CATALOG_CONNECTORS as string[]).includes(n)) return n as ConnectorId;
  return SOURCE_ALIAS[n] ?? null;
}

/** Whether `scope` (bare, no connector prefix) is one a scan of `connector` may be asked for. */
export function isRequestableScope(connector: ConnectorId, scope: string): boolean {
  const e = SCOPE_CATALOG[connector];
  return !!e && (e.fixed.includes(scope) || (e.patterns ?? []).some((p) => p.test(scope)));
}

/** Whether a runtime job or a ledger row may carry `scope` (bare): requestable, or one the app runs itself. */
export function isKnownScope(connector: ConnectorId, scope: string): boolean {
  if (!SCOPE_CATALOG[connector]) return false;
  return isRequestableScope(connector, scope) || (INTERNAL[connector] ?? []).some((p) => p.test(scope)) || INTERNAL_ANY.some((p) => p.test(scope));
}

/** Whether a stored scope id (`scan_runs.scope`, `scan_cursors.scope`: `<connector>:<scope>`) names a known scope. */
export function isKnownScopeId(scopeIdText: string): boolean {
  const i = scopeIdText.indexOf(':');
  if (i <= 0) return false;
  const c = connectorOfName(scopeIdText.slice(0, i));
  return !!c && isKnownScope(c, scopeIdText.slice(i + 1));
}

/** The valid scopes as an error message lists them. */
export function validScopes(connector: ConnectorId): string[] {
  const e = SCOPE_CATALOG[connector];
  return e ? [...e.fixed, ...(e.patternLabels ?? [])] : [];
}

export type ScopeCheck = { ok: true; scope: string | null } | { ok: false; scope: string; valid: string[] };

/**
 * A scope from a request: empty or `manual` = the connector's default (null: "every scope", the caller decides); an
 * optional `<connector>:` prefix (the connector id or its UI source name) is dropped ONCE, so `org62:events` is
 * `events` and `org62:org62:events` stays unknown. Anything not in the catalog is `{ok: false}` with the valid list.
 */
export function normalizeScanScope(connector: ConnectorId, raw: string | null | undefined): ScopeCheck {
  const t = (raw ?? '').trim();
  if (!t || t === 'manual') return { ok: true, scope: null };
  let bare = t;
  const i = t.indexOf(':');
  if (i > 0 && connectorOfName(t.slice(0, i)) === connector && !isRequestableScope(connector, t)) bare = t.slice(i + 1);
  return isRequestableScope(connector, bare) ? { ok: true, scope: bare } : { ok: false, scope: t, valid: validScopes(connector) };
}

/**
 * A ledger scope repaired: `dcs` (an unprefixed Health placeholder) → `org62:dcs`; `manual` → the connector's default
 * scope; a known prefixed scope stays. Null when it names no known scope (`org62:org62:events`).
 */
export function repairScopeId(connector: ConnectorId, stored: string): string | null {
  if (stored.startsWith(`${connector}:`) && isKnownScopeId(stored)) return stored;
  if (stored === 'manual' || stored === '') return SCOPE_CATALOG[connector]?.default ? `${connector}:${SCOPE_CATALOG[connector].default}` : null;
  return isKnownScope(connector, stored) ? `${connector}:${stored}` : null;
}

/**
 * The scope id a Health "Rescan" placeholder run carries before the worker adopts it: the scope it runs, else the
 * connector's default, else `rescan` (a connector with no scanner yet, cancelled at once). Never a bare `dcs` or `manual`.
 */
export function placeholderScopeId(connector: ConnectorId, scope: string | null): string {
  return `${connector}:${scope ?? SCOPE_CATALOG[connector]?.default ?? 'rescan'}`;
}
