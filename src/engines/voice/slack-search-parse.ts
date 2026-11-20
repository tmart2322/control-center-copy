import type { ChannelType, SentMessage } from './types';

/**
 * Parse the text output of the Slack MCP search tools (`slack_search_public_and_private`,
 * detailed format) into SentMessage records. Accepts either the raw tool JSON
 * (`{"results": "...", "pagination_info": "..."}`) or the markdown inside it.
 *
 * Shape of one result block:
 *   ### Result 3 of 20
 *   Channel: Group DM (ID: C0…)            | DM (ID: D0…) | #channel-name (ID: C0…)
 *   Participants: Name (ID: U…), …          (DMs and group DMs only)
 *   From: Name <email> (ID: U…)             (the name can be empty)
 *   Time: 2026-11-05 08:28:56 MST
 *   Message_ts: 1793892536.322889
 *   Reply count: 1                          (optional)
 *   Permalink: [link](https://…?thread_ts=…&cid=…)
 *   Text:
 *   …message, possibly multi-line…
 *
 *   ---
 */

export function unwrapSearchOutput(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t) as { results?: unknown };
      if (typeof j.results === 'string') return j.results;
    } catch {
      /* fall through: treat as markdown */
    }
  }
  return raw;
}

function field(block: string, name: string): string | undefined {
  const m = new RegExp(`^${name}:[ \\t]*(.*)$`, 'm').exec(block);
  return m?.[1]?.trim();
}

export function parseSlackSearchResults(raw: string): SentMessage[] {
  const md = unwrapSearchOutput(raw);
  const blocks = md.split(/^### Result \d+ of \d+\s*$/m).slice(1);
  const out: SentMessage[] = [];
  for (const block of blocks) {
    const channelLine = field(block, 'Channel') ?? '';
    const cm = /^(.*?)\s*\(ID:\s*([A-Z0-9]+)\)\s*$/.exec(channelLine);
    const label = (cm?.[1] ?? channelLine).trim();
    const channelId = cm?.[2] ?? 'unknown';
    let channelType: ChannelType = 'channel';
    let channelName: string | undefined;
    if (/^DM$/i.test(label)) channelType = 'dm';
    else if (/^Group DM$/i.test(label)) channelType = 'group_dm';
    else channelName = label.replace(/^#/, '');

    const participants = (field(block, 'Participants') ?? '')
      .split(/\),\s*/)
      .map((p) => /^(.*?)\s*\(ID:\s*([A-Z0-9]+)\)?$/.exec(p.trim()))
      .filter((m): m is RegExpExecArray => !!m && !!m[2])
      .map((m) => ({ name: (m[1] ?? '').trim(), id: m[2] ?? '' }));

    const fromLine = field(block, 'From') ?? '';
    const authorId = /\(ID:\s*([A-Z0-9]+)\)/.exec(fromLine)?.[1];
    const ts = field(block, 'Message_ts') ?? '';
    const permalink = /\((https?:[^)]+)\)/.exec(field(block, 'Permalink') ?? '')?.[1]?.replace(/\\\//g, '/');
    const threadTs = permalink ? /[?&]thread_ts=([0-9.]+)/.exec(permalink)?.[1] : undefined;
    const replyCount = Number(field(block, 'Reply count') ?? '') || undefined;

    const textStart = block.search(/^Text:[ \t]*$/m);
    let text = '';
    if (textStart >= 0) {
      text = block.slice(textStart).replace(/^Text:[ \t]*\n?/, '');
      // drop the block separator and anything after it (pagination footer on the last block)
      const sep = text.search(/\n\s*\n---\s*(\n|$)/);
      if (sep >= 0) text = text.slice(0, sep);
      text = text.replace(/\s+$/, '');
    }
    const tsNum = Number(ts);
    const at = ts && Number.isFinite(tsNum) ? new Date(tsNum * 1000).toISOString() : '';
    out.push({
      ts,
      at,
      channelId,
      channelType,
      ...(channelName ? { channelName } : {}),
      ...(participants.length ? { participants } : {}),
      ...(authorId ? { authorId } : {}),
      text,
      ...(threadTs ? { threadTs } : {}),
      ...(permalink ? { permalink } : {}),
      ...(replyCount ? { replyCount } : {}),
    });
  }
  return out;
}

/** Parse many tool outputs, keep only the user's own messages, de-duplicate by channel+ts. */
export function collectSentMessages(raws: string[], meId?: string): SentMessage[] {
  const seen = new Set<string>();
  const out: SentMessage[] = [];
  for (const raw of raws) {
    for (const m of parseSlackSearchResults(raw)) {
      if (meId && m.authorId && m.authorId !== meId) continue;
      const key = `${m.channelId}:${m.ts}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
