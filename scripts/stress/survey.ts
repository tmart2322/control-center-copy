/**
 * Step 3 input: real activity volume per local day (counts only), to pick the test days.
 *   npx tsx scripts/stress/survey.ts 2026-09-14 2026-11-05
 * Writes <stress>/reports/survey.json (private). Gmail/Calendar/Drive via devbar (no LLM); Slack via batched
 * recorder calls (first page of `from:me` and `-from:me` DMs per day: ≥20 means "busy").
 */
import path from 'node:path';

import { GoogleWorkspaceClient } from '../../src/connectors/google/client';
import { parseDriveSearch, parseEvents, parseGmailSearch } from '../../src/connectors/google/parse';

import { callKey, execReadCalls, type ReadCall } from './lib/exec-calls';
import { responseText } from './lib/agent';
import { privDir, writePriv } from './lib/paths';
import { dayBounds, daysBetween, unix, weekday } from './lib/time';

const ME_SLACK = process.env.CC_STRESS_ME_SLACK ?? '';
const ME_EMAIL = process.env.CC_STRESS_ME_EMAIL ?? '';

async function gmailCount(g: GoogleWorkspaceClient, q: string): Promise<number> {
  let n = 0;
  let token: string | undefined;
  for (let i = 0; i < 10; i++) {
    const text = await g.call('search_gmail_messages', { query: q, page_size: 100, ...(token ? { page_token: token } : {}) });
    const p = parseGmailSearch(text);
    n += p.hits.length;
    token = p.nextPageToken;
    if (!token || !p.hits.length) break;
  }
  return n;
}

function slackCount(text: string): { n: number; more: boolean } {
  const body = (() => {
    try {
      return JSON.parse(text) as { results?: string; pagination_info?: string };
    } catch {
      return { results: text };
    }
  })();
  const m = body.results?.match(/## Messages \((\d+) results?\)/);
  return { n: m ? Number(m[1]) : 0, more: /cursor/.test(body.pagination_info ?? '') };
}

async function main() {
  const [a = '2026-09-14', b = '2026-11-05'] = process.argv.slice(2);
  const days = daysBetween(a, b);
  const g = new GoogleWorkspaceClient();
  const rows: Record<string, Record<string, unknown>> = {};
  const evText = await g.call('get_events', { time_min: dayBounds(a).from, time_max: dayBounds(b).to, detailed: true, include_attachments: true, max_results: 2500 });
  const events = /^No events found/i.test(evText.trim()) ? [] : parseEvents(evText);
  for (const d of days) {
    const { from, to } = dayBounds(d);
    const ep = `after:${unix(from)} before:${unix(to)}`;
    const inbox = await gmailCount(g, `in:anywhere -in:sent -in:drafts -in:spam -in:trash -category:promotions -category:social ${ep}`);
    const sent = await gmailCount(g, `in:sent ${ep}`);
    const dayEvents = events.filter((e) => e.start >= from && e.start < to && !e.allDay);
    const mine = dayEvents.map((e) => e.attendees.find((x) => x.email === ME_EMAIL.toLowerCase()));
    const notes = parseDriveSearch(
      await g.call('search_drive_files', { query: `name contains 'Notes by Gemini' and modifiedTime > '${from}' and modifiedTime < '${to}' and trashed = false`, detailed: true, page_size: 50, include_items_from_all_drives: true }),
    ).files.length;
    rows[d] = {
      dow: weekday(d),
      inbox,
      sent,
      events: dayEvents.length,
      accepted: mine.filter((x) => x?.response === 'accepted' || x?.organizer).length,
      declinedOrNoResponse: mine.filter((x) => x && (x.response === 'declined' || x.response === 'needsAction')).length,
      geminiNotes: notes,
    };
    process.stdout.write(`${d} `);
  }
  await g.close();
  if (ME_SLACK) {
    const calls: ReadCall[] = [];
    for (const d of days) {
      const { from, to } = dayBounds(d);
      const base = { channel_types: 'public_channel,private_channel,mpim,im', sort: 'timestamp', sort_dir: 'asc', limit: 20, include_context: false, response_format: 'concise', after: String(unix(from)), before: String(unix(to)) };
      calls.push({ tool: 'mcp__slack__slack_search_public_and_private', args: { query: `from:<@${ME_SLACK}>`, ...base } });
      calls.push({ tool: 'mcp__slack__slack_search_public_and_private', args: { query: `-from:<@${ME_SLACK}>`, ...base, channel_types: 'im,mpim' } });
    }
    const res = await execReadCalls('slack', calls, { scenario: 'survey', batch: 10, log: (m) => console.log(m) });
    for (const d of days) {
      const { from, to } = dayBounds(d);
      const base = { channel_types: 'public_channel,private_channel,mpim,im', sort: 'timestamp', sort_dir: 'asc', limit: 20, include_context: false, response_format: 'concise', after: String(unix(from)), before: String(unix(to)) };
      const mine = res.get(callKey('mcp__slack__slack_search_public_and_private', { query: `from:<@${ME_SLACK}>`, ...base }));
      const dms = res.get(callKey('mcp__slack__slack_search_public_and_private', { query: `-from:<@${ME_SLACK}>`, ...base, channel_types: 'im,mpim' }));
      const m = mine ? slackCount(responseText(mine.response)) : null;
      const x = dms ? slackCount(responseText(dms.response)) : null;
      rows[d]!.slackMine = m ? `${m.n}${m.more ? '+' : ''}` : '?';
      rows[d]!.slackDmIn = x ? `${x.n}${x.more ? '+' : ''}` : '?';
    }
  }
  writePriv(path.join(privDir('reports'), 'survey.json'), JSON.stringify(rows, null, 1));
  console.log('\n' + Object.entries(rows).map(([d, r]) => `${d} ${JSON.stringify(r)}`).join('\n'));
}

main().catch((e) => {
  console.error('survey failed', (e as Error).message);
  process.exit(1);
});
