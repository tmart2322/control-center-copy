/**
 * D5 (audit 2026-11-13): the Slack no-op pre-check. About half of the scheduled Slack polls found nothing and still
 * paid for a full traversal (~$0.008 each). Before a scheduled incremental poll, the runtime asks Slack the scope's
 * own searches, newest first, one result each, over the poll's window. Only a positive "No results found." on every one
 * of them skips the traversal; the run then records the same coverage the skill would have and moves the cursor.
 *
 *   inbox          S1 DMs to me · S2 @mentions · S3 my messages (S4, my messages with a file, is a subset of S3)
 *   channel:<id>   C1 `in:#<name>` (a channel without a usable name has no pre-check: the skill reads it)
 *
 * Fails open: a failed or unclear lookup, a message found, or any other scope runs the traversal as before. Each lookup
 * is one relay call through the scanners' read allowlist (runOneReadLookup, skills/read-lookup.md); never a write.
 */
import { ledgerHash } from '../../db/ledger';
import { parseSlackSearch } from '../../connectors/slack/parse';
import type { OneLookupResult } from '../../server/onboarding/identity';
import type { PrecheckInput, PrecheckResult } from '../runtime/connectors';
import type { CoverageObject } from '../types';

export const SLACK_PRECHECK_TOOL = 'slack_search_public_and_private';

export interface PrecheckQuery {
  ref: string;
  kind: CoverageObject['kind'];
  args: Record<string, unknown>;
  /** Coverage refs this query vouches for (S3 also covers S4's `search:mine:files`). */
  covers: string[];
}

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** The searches that would show anything new in the window, or null when the scope has no pre-check. */
export function slackPrecheckQueries(i: Pick<PrecheckInput, 'scope' | 'window' | 'vars' | 'ctx'>): PrecheckQuery[] | null {
  const base = { sort: 'timestamp', sort_dir: 'desc', limit: 1, include_context: false, response_format: 'detailed', after: String(unix(i.window.from) - 120), before: String(unix(i.window.to)) };
  if (i.scope === 'inbox') {
    const me = i.ctx.me.slackId;
    if (!me) return null;
    return [
      { ref: 'search:dm', kind: 'query_window', covers: ['search:dm'], args: { ...base, filters: `-from:<@${me}>`, channel_types: 'im,mpim' } },
      { ref: 'search:mentions', kind: 'query_window', covers: ['search:mentions'], args: { ...base, keywords: [`<@${me}>`], channel_types: 'public_channel,private_channel' } },
      { ref: 'search:mine', kind: 'query_window', covers: ['search:mine', 'search:mine:files'], args: { ...base, filters: `from:<@${me}>`, channel_types: 'public_channel,private_channel,mpim,im' } },
    ];
  }
  if (i.scope.startsWith('channel:')) {
    const id = i.scope.slice('channel:'.length);
    const label = (i.vars['channel.label'] ?? '').trim();
    if (!id || !label) return null;
    return [{ ref: `search:channel:${id}`, kind: 'channel_range', covers: [`search:channel:${id}`], args: { ...base, filters: `in:#${label}`, channel_types: 'public_channel,private_channel' } }];
  }
  return null;
}

/** `found`: a message in it; `empty`: Slack said "No results found."; `unclear`: anything else (fail open). */
export function classifySearch(text: string): 'found' | 'empty' | 'unclear' {
  if (parseSlackSearch(text).messages.length) return 'found';
  let results = text;
  try {
    const j = JSON.parse(text) as { results?: unknown };
    if (typeof j.results === 'string') results = j.results;
  } catch {
    /* plain text */
  }
  if (/###\s*Result/i.test(results)) return 'unclear';
  return /\bNo results found\b/i.test(results) ? 'empty' : 'unclear';
}

export type SlackLookup = (look: { connector: 'slack'; tool: string; args: Record<string, unknown> }) => Promise<OneLookupResult>;

export async function runSlackPrecheck(i: PrecheckInput, lookup: SlackLookup): Promise<PrecheckResult | null> {
  const queries = slackPrecheckQueries(i);
  if (!queries) return null;
  const out: PrecheckResult = {
    empty: false,
    coverage: [],
    cursor: { value: `${unix(i.window.to)}.000000`, at: new Date(i.window.to).toISOString() },
    costUsd: 0,
    calls: 0,
    model: '',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    contentHash: ledgerHash('slack-precheck/v1', i.scope, i.window.from, i.window.to),
    why: 'unclear',
  };
  for (const q of queries) {
    if (i.signal.aborted) return { ...out, why: 'aborted' };
    const r = await lookup({ connector: 'slack', tool: SLACK_PRECHECK_TOOL, args: q.args });
    out.calls += 1;
    out.costUsd += r.costUsd;
    out.model ||= r.model;
    out.inputTokens += r.inputTokens;
    out.outputTokens += r.outputTokens;
    out.cacheReadTokens += r.cacheReadTokens ?? 0;
    out.cacheWriteTokens += r.cacheWriteTokens ?? 0;
    if (r.text === null) return { ...out, why: `error:${r.code}` };
    const c = classifySearch(r.text);
    if (c !== 'empty') return { ...out, why: c === 'found' ? `found:${q.ref}` : 'unclear' };
  }
  const coverage: CoverageObject[] = queries.flatMap((q) => q.covers.map((ref) => ({ kind: q.kind, ref, from: i.window.from, to: i.window.to, meta: { precheck: true } })));
  return { ...out, empty: true, coverage, why: 'empty' };
}
