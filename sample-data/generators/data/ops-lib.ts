/** Shared helpers for domain 03 (ops/telemetry): time math, cost formula, connector profiles, text banks. */
import { NOW, OWNER, at, readTable, sha, slackChannel, uid } from '../../lib/kit';

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const tms = (isoStr: string) => Date.parse(isoStr);
export const iso = (ms: number) => new Date(ms).toISOString();
export const NOW_MS = tms(NOW);
export const r2 = (x: number) => Math.round(x * 100) / 100;
export const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
export const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
/** ms epoch of day offset (vs 2026-11-18) at local MT clock time. */
export const atMs = (offset: number, hhmm: string) => tms(at(offset, hhmm));
/** Local (MT, UTC-7) calendar day of an instant, 'YYYY-MM-DD'. */
export const mtDay = (ms: number) => new Date(ms - 7 * HOUR).toISOString().slice(0, 10);
/** Day offset (vs 2026-11-18) of a local MT day string. */
export const dayOffsetOf = (d: string) => Math.round((Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - Date.UTC(2026, 10, 18)) / DAY);
export const dowOf = (offset: number) => new Date(Date.UTC(2026, 10, 18 + offset)).getUTCDay();
export const isWeekdayOff = (offset: number) => dowOf(offset) >= 1 && dowOf(offset) <= 5;

// ── model prices (copy of src/llm/models.ts; USD per million tokens) ────────────────────────────
export const HAIKU = 'claude-haiku-5-5';
export const SONNET = 'claude-sonnet-5-5';
const PRICES: Record<string, { input: number; output: number; cw: number; cr: number; longThr?: number; longIn?: number; longOut?: number }> = {
  [HAIKU]: { input: 0.1, output: 0.5, cw: 0.125, cr: 0.01, longThr: 100_000, longIn: 0.5, longOut: 2.5 },
  [SONNET]: { input: 2, output: 10, cw: 2.5, cr: 0.2 },
};
export interface Tok { in: number; out: number; cr: number; cw: number }
export function callCost(model: string, u: Tok): number {
  const p = PRICES[model]!;
  const prompt = u.in + u.cw + u.cr;
  const long = p.longThr != null && prompt > p.longThr;
  const inRate = long ? p.longIn! : p.input;
  const outRate = long ? p.longOut! : p.output;
  const scale = long ? inRate / p.input : 1;
  return r6((u.in * inRate + u.out * outRate + u.cw * p.cw * scale + u.cr * p.cr * scale) / 1e6);
}

// ── connectors (core rows by name) ───────────────────────────────────────────────────────────────
export type ConnKey = 'slack' | 'gmail-work' | 'gmail-shared' | 'drive' | 'calendar' | 'gemini-notes' | 'org62' | 'claude' | 'vdp';
export interface ConnDef {
  key: ConnKey; name: string; kind: string; scanKind: string; skill: string | null; ver: string | null; probe: string; label: string;
  tier: 'haiku' | 'none'; staleS: number;
}
const CONN_DEFS: ConnDef[] = [
  { key: 'slack', name: 'Slack', kind: 'slack', scanKind: 'slack', skill: 'scan-slack', ver: '1.7.0', probe: 'slack_search_users', label: 'Slack', tier: 'haiku', staleS: 900 },
  { key: 'gmail-work', name: 'Gmail (work)', kind: 'gmail', scanKind: 'gmail', skill: 'scan-gmail', ver: '3', probe: 'list_labels', label: 'Gmail (work)', tier: 'haiku', staleS: 3600 },
  { key: 'gmail-shared', name: 'Gmail (customer alias)', kind: 'gmail', scanKind: 'gmail', skill: 'scan-gmail', ver: '3', probe: 'list_labels', label: 'Gmail (customer alias)', tier: 'haiku', staleS: 3600 },
  { key: 'drive', name: 'Drive', kind: 'drive', scanKind: 'drive', skill: 'scan-drive', ver: '1', probe: 'list_recent_files', label: 'Drive', tier: 'haiku', staleS: 3600 },
  { key: 'calendar', name: 'Calendar', kind: 'calendar', scanKind: 'calendar', skill: 'scan-calendar', ver: '2', probe: 'list_calendars', label: 'Calendar', tier: 'haiku', staleS: 3600 },
  { key: 'gemini-notes', name: 'Gemini notes', kind: 'gemini_notes', scanKind: 'gemini_notes', skill: 'scan-gemini-notes', ver: '3', probe: 'search_files', label: 'Gemini notes', tier: 'haiku', staleS: 3600 },
  { key: 'org62', name: 'Org62', kind: 'org62', scanKind: 'org62', skill: 'scan-org62', ver: '1.7.0', probe: 'getUserInfo', label: 'Org62', tier: 'haiku', staleS: 7200 },
  { key: 'claude', name: 'Claude sessions', kind: 'claude', scanKind: 'claude_sessions', skill: 'scan-claude-sessions', ver: '2', probe: 'read_sessions_dir', label: 'Claude sessions', tier: 'haiku', staleS: 3600 },
  { key: 'vdp', name: 'VDP', kind: 'vdp', scanKind: 'vdp', skill: null, ver: null, probe: 'get_server_info', label: 'VDP', tier: 'none', staleS: 3600 },
];
const connRows = readTable('connectors') as Array<Record<string, any>>;
export const CONN: Record<ConnKey, ConnDef & { id: string }> = Object.fromEntries(
  CONN_DEFS.map((d) => {
    const row = connRows.find((r) => r.name === d.name);
    if (!row) throw new Error(`connector ${d.name} missing from core`);
    return [d.key, { ...d, id: row.id as string }];
  }),
) as any;
export const CONN_KEYS = CONN_DEFS.map((d) => d.key);
export const skillVersion = (skill: string | null, ver: string | null) => (skill && ver ? `${ver}+${sha(`${skill}@${ver}`).slice(0, 8)}` : null);

// ── channels the Slack scanner works through ────────────────────────────────────────────────────
export const SLACK_CHANNELS: Array<{ n: number; name: string; w: number }> = [
  { n: 1, name: 'saltmere-poc', w: 5 }, { n: 2, name: 'saltmere-team', w: 3 }, { n: 3, name: 'elderglen-outdoors-deal', w: 4 },
  { n: 4, name: 'elderglen-outdoors-ext', w: 3 }, { n: 5, name: 'yarrowdale-team', w: 2 }, { n: 6, name: 'halvergate-freight', w: 2 },
  { n: 7, name: 'se-team', w: 2 }, { n: 13, name: 'cascadia-onsite', w: 1 }, { n: 14, name: 'ferrowpay-pursuit', w: 2 },
];
export const slackScope = (n: number) => `channel:${slackChannel(n)}`;

// ── text banks ──────────────────────────────────────────────────────────────────────────────────
export type ErrClass = 'transient' | 'rate_limited' | 'auth' | 'config' | 'unknown';
export const ERR_TEXT: Record<string, Array<{ msg: string; cause: string }>> = {
  'transient:slack': [
    { msg: 'watchdog: scan exceeded 900s (timed out)', cause: 'timeout' },
    { msg: 'MCP server "slack" connection reset (ECONNRESET) after 3 retries', cause: 'error' },
    { msg: 'run ended without cc_finish (max_turns 30 reached)', cause: 'max_turns' },
  ],
  'transient:org62': [
    { msg: 'Org62 soqlQuery: request timed out after 60s', cause: 'timeout' },
    { msg: 'Org62 soqlQuery: 503 Service Unavailable (server busy), 2 retries used', cause: 'error' },
  ],
  'transient:drive': [
    { msg: 'drive search_files returned 503 backendError', cause: 'error' },
    { msg: 'stalled: no tool call for 180s (watchdog timeout)', cause: 'timeout' },
  ],
  'transient:gmail': [
    { msg: 'gmail search_threads: 502 bad gateway from the MCP wrapper', cause: 'error' },
    { msg: 'watchdog: prefetch exceeded 120s (timed out)', cause: 'timeout' },
  ],
  'transient:calendar': [{ msg: 'calendar list_events: request timed out after 30s', cause: 'timeout' }],
  'transient:gemini_notes': [{ msg: 'stalled: no tool call for 180s (watchdog timeout)', cause: 'timeout' }],
  'transient:claude_sessions': [{ msg: 'transcript read failed: file changed while reading (retry)', cause: 'error' }],
  'transient:vdp': [{ msg: 'VDP list_vdps: upstream gateway timeout (504)', cause: 'timeout' }],
  'rate_limited:slack': [{ msg: 'Slack: rate limited (429), retry after 62s', cause: 'rate_limited' }],
  'rate_limited:org62': [{ msg: 'Org62: REQUEST_LIMIT_EXCEEDED (ConcurrentPerOrgLongTxn), backing off', cause: 'rate_limited' }],
  'auth:vdp': [{ msg: 'VDP: 401 unauthorized (central_proxy_session expired), sign-in required', cause: 'auth' }],
  'auth:drive': [{ msg: 'Drive: 401 invalid_grant, sign-in required (token revoked or expired)', cause: 'auth' }],
  'config:slack': [{ msg: 'run stopped at its cost cap ($2.50); the window will be split and retried', cause: 'cost_cap' }],
  'unknown:gemini_notes': [{ msg: 'unexpected tool result shape from read_file_content (no text field)', cause: 'error' }],
  'unknown:gmail': [{ msg: 'unexpected tool result shape from get_thread (messages missing)', cause: 'error' }],
};
export const errText = (cls: ErrClass, scanKind: string, i = 0) => {
  const list = ERR_TEXT[`${cls}:${scanKind}`] ?? ERR_TEXT[`${cls}:slack`]!;
  return { cls, ...list[i % list.length]! };
};

/** Stable fake provider id for a ledger object. */
export const hex = (s: string, n = 8) => sha(s).slice(0, n);
export const OWNER_ID = OWNER;
export const U = uid;
