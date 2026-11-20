/**
 * A connector's status reason in plain words: which scope failed and why. It is written to `connectors.status_reason`
 * (Health's impact line, Settings ▸ Connectors). Before, it was the classifier's code, and a tripwire, a cost cap or a
 * stuck run all came out as "unknown" (STAT-1).
 */
import { GATEWAY_DOWN_WORDS, GATEWAY_ERROR, GATEWAY_ERROR_WORDS } from '../../connectors/google/gateway';
import type { ConnectorId } from '../types';
import type { ErrorClass } from '../../llm/errors';

const SCOPE_LABEL: Partial<Record<ConnectorId, (scope: string) => string>> = {
  slack: (s) => (s === 'inbox' ? 'Slack inbox' : s.startsWith('channel:') ? 'Channel scans' : s.startsWith('thread:') ? 'Thread re-reads' : 'Slack'),
  org62: (s) => ({ opps: 'Org62 opportunities', events: 'Org62 events', dcs: 'Org62 deal contributions', book: 'Org62 book', missed_opps: 'Missed-opportunity sweep' })[s] ?? 'Org62',
  gmail: (s) => (s === 'sent' ? 'Sent mail' : s === 'inbox' ? 'Inbox' : 'Gmail'),
  calendar: () => 'Calendar',
  drive: () => 'Drive files',
  gemini_notes: () => 'Meeting notes',
  claude_sessions: () => 'Claude sessions',
  trainings: () => 'Trainings',
  watch: () => 'Channel briefs',
  vdp: () => 'VDP plans',
};

/** The connectors that read Google through devbar's MCP gateway. */
const GOOGLE: ReadonlySet<ConnectorId> = new Set<ConnectorId>(['gmail', 'calendar', 'drive', 'gemini_notes', 'trainings']);

/** "Channel scans: prompt over the size limit" (at most 240 characters; no ids or message text, only a blocked tool's name). */
export function statusReason(connector: ConnectorId, scope: string, message: string, errorClass: ErrorClass, blockedTool?: string): string {
  const label = SCOPE_LABEL[connector]?.(scope) ?? connector;
  const reason = (() => {
    if (/prefix tripwire/i.test(message)) return 'prompt over the size limit';
    if (/cost cap/i.test(message)) return 'a run hit its cost cap';
    if (/max_turns|max turns/i.test(message)) return 'a run hit its turn limit';
    if (/watchdog|run exceeded \d+ ?ms/i.test(message)) return 'a run took longer than its time limit';
    if (/without (?:a cursor|cc_finish)/i.test(message)) return 'a run stopped before finishing';
    if (blockedTool || /disallowed tool/i.test(message)) return `a tool call outside the read-only allowlist was blocked${blockedTool ? ` (${blockedTool})` : ''}`;
    // a maintenance page: the service is down, not the user's sign-in (Google reads go through devbar's MCP gateway)
    if (/\[gateway_down\]|down for maintenance|under maintenance/i.test(message)) return GOOGLE.has(connector) ? GATEWAY_DOWN_WORDS : 'the service is down for maintenance (not your sign-in), retrying';
    if (errorClass === 'auth') return 'needs re-auth';
    // E5: any other failed POST to the gateway is its outage too, whatever the run was classified as when it failed
    if (GATEWAY_ERROR.test(message)) return GOOGLE.has(connector) ? GATEWAY_ERROR_WORDS : "the service's gateway isn't answering (not your sign-in), retrying";
    if (errorClass === 'rate_limited') return 'rate limited, retrying';
    if (errorClass === 'transient') return 'temporarily unavailable, retrying';
    const g = /\[(not_found|no_access|bad_request)\]/.exec(message)?.[1];
    if (g === 'not_found') return "a file couldn't be found";
    if (g === 'no_access') return "a file isn't shared with you";
    if (g === 'bad_request') return "a file couldn't be read";
    if (/coverage/i.test(message)) return "a run's coverage didn't reach its cursor";
    return 'a run failed';
  })();
  return `${label}: ${reason}`.slice(0, 240);
}
