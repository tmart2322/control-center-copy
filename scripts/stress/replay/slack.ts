/**
 * Slack replay at the MCP tool-call boundary.
 *
 * Recording (record/slack.ts) captures, per local day, a SUPERSET: the skill's query classes over the whole day
 * (S1 DMs to me, S2 @mentions, S3 my messages, C1 per watched/customer channel), every page, plus detailed
 * `slack_read_thread` reads of the threads those messages belong to. This module parses those raw tool results
 * into a message index and answers the scanner's calls for ANY window:
 *   - search: the query is classified (dm | mentions | mine | channel:<id>); results are the recorded members
 *     of that class with after ≤ ts ≤ before, ordered and paged like the real tool;
 *   - read_thread / read_channel: recorded replies/messages, filtered the same way.
 * Nothing newer than the simulated now is ever returned (ts AND visibility time ≤ now), and every response is
 * checked again before it leaves (`leaks` must stay 0). A call the recordings cannot answer faithfully throws
 * `ReplayMiss` (counted as a harness bug, never as a scanner pass).
 */
import { localDay } from '../lib/time';

export class ReplayMiss extends Error {
  constructor(
    public readonly tool: string,
    public readonly why: string,
  ) {
    super(`replay miss: ${tool}: ${why}`);
    this.name = 'ReplayMiss';
  }
}

export interface SlackMsg {
  key: string; // `${channelId}:${ts}`
  channelId: string;
  /** Raw `Channel: …` line of search results (e.g. `DM (ID: D…)`, `#name (ID: C…)`, `Group DM (ID: C…)`). */
  channelLine?: string;
  participantsLine?: string;
  authorId?: string;
  authorName?: string;
  authorEmail?: string;
  /** Raw `Time:` value as the tool renders it (user zone). */
  time?: string;
  ts: string;
  permalink?: string;
  threadTs?: string;
  text: string;
  /** Detailed-format extra lines (Files:, Reactions:). */
  extra?: string[];
  classes: string[];
  /** Scenario overlays (late arrivals, edits, deletes). Epoch ms. */
  visibleAt?: number;
  edits?: Array<{ at: number; text: string }>;
  deletedAt?: number;
}

export interface SlackThread {
  channelId: string;
  threadTs: string;
  parentKey: string;
  replyKeys: string[];
}

export interface SlackIndex {
  me: string;
  messages: Record<string, SlackMsg>;
  threads: Record<string, SlackThread>;
  /** class → recorded local days (the class was fully paged for that day). */
  recorded: Record<string, string[]>;
}

export const tsMs = (ts: string) => Math.round(Number(ts) * 1000);

// ------------------------------------------------------------------ parsing recorded tool results

export function unwrap(raw: unknown): Record<string, unknown> {
  const text = Array.isArray(raw) ? ((raw[0] as { text?: string })?.text ?? '') : typeof raw === 'string' ? raw : ((raw as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? JSON.stringify(raw));
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { results: text };
  }
}

const PERMA_THREAD = /[?&]thread_ts=(\d+\.\d+)/;

export function parseSearchResults(raw: unknown): { msgs: Omit<SlackMsg, 'key' | 'classes'>[]; cursor?: string } {
  const body = unwrap(raw);
  const results = String(body.results ?? '');
  const cursor = String(body.pagination_info ?? '').match(/cursor `([^`]+)`/)?.[1];
  const out: Omit<SlackMsg, 'key' | 'classes'>[] = [];
  const blocks = results.split(/^### Result \d+ of \d+\s*$/m).slice(1);
  for (const b of blocks) {
    const body2 = b.replace(/\n---\s*\n*$/, '').replace(/\n---\s*$/, '');
    const line = (name: string) => body2.match(new RegExp(`^${name}: (.*)$`, 'm'))?.[1];
    const channelLine = line('Channel');
    const channelId = channelLine?.match(/\(ID: ([A-Z0-9]+)\)/)?.[1];
    const ts = line('Message_ts')?.trim();
    if (!channelId || !ts) continue;
    const from = line('From') ?? '';
    const fm = from.match(/^(.*?)\s*(?:<([^>]+)>)?\s*\(ID: ([A-Z0-9]+)\)/);
    const permalink = line('Permalink')?.match(/\((https?:[^)]+)\)/)?.[1];
    const textAt = body2.search(/^Text: /m);
    const text = textAt >= 0 ? body2.slice(textAt + 6).replace(/\s+$/, '') : '';
    out.push({
      channelId,
      channelLine,
      participantsLine: line('Participants'),
      authorId: fm?.[3],
      authorName: fm?.[1]?.trim(),
      authorEmail: fm?.[2],
      time: line('Time'),
      ts,
      permalink,
      threadTs: permalink?.match(PERMA_THREAD)?.[1],
      text,
    });
  }
  return { msgs: out, cursor };
}

/** Detailed `slack_read_thread` page: parent + replies with From / Time / Message TS. */
export function parseThreadDetailed(raw: unknown, channelId: string): { parent?: Omit<SlackMsg, 'key' | 'classes'>; replies: Omit<SlackMsg, 'key' | 'classes'>[]; cursor?: string } {
  const body = unwrap(raw);
  const text = String(body.messages ?? body.results ?? '');
  const cursor = String(body.pagination_info ?? '').match(/cursor: `([^`]+)`/)?.[1];
  const parse = (chunk: string): Omit<SlackMsg, 'key' | 'classes'> | undefined => {
    const lines = chunk.split('\n');
    let i = 0;
    while (i < lines.length && !lines[i]!.startsWith('From: ')) i++;
    if (i >= lines.length) return undefined;
    const from = lines[i]!.slice(6);
    const fm = from.match(/^(.*?)\s*(?:<([^>]+)>)?\s*\(([A-Z0-9]+)\)\s*$/);
    const time = lines[i + 1]?.match(/^Time: (.*)$/)?.[1];
    const ts = lines[i + 2]?.match(/^Message TS: (\S+)/)?.[1];
    if (!ts) return undefined;
    const rest = lines.slice(i + 3);
    const extra: string[] = [];
    while (rest.length && /^(Reactions|Files|Replies): /.test(rest[rest.length - 1]!.trim() || '')) extra.unshift(rest.pop()!.trim());
    while (rest.length && !rest[rest.length - 1]!.trim()) rest.pop();
    return { channelId, authorId: fm?.[3], authorName: fm?.[1]?.trim(), authorEmail: fm?.[2], time, ts, text: rest.join('\n'), extra };
  };
  const [parentPart, repliesPart = ''] = text.split(/^=== THREAD REPLIES.*===\s*$/m);
  const parent = parseParentSection(parentPart ?? '', parse);
  const replies = repliesPart
    .split(/^--- Reply \d+ of \d+ ---\s*$/m)
    .slice(1)
    .map(parse)
    .filter((x): x is Omit<SlackMsg, 'key' | 'classes'> => !!x);
  return { parent, replies, cursor };
}

function parseParentSection(s: string, parse: (c: string) => Omit<SlackMsg, 'key' | 'classes'> | undefined) {
  const at = s.indexOf('=== THREAD PARENT MESSAGE ===');
  return at >= 0 ? parse(s.slice(at)) : undefined;
}

// ------------------------------------------------------------------ index building

export function emptyIndex(me: string): SlackIndex {
  return { me, messages: {}, threads: {}, recorded: {} };
}

export function addMessage(ix: SlackIndex, m: Omit<SlackMsg, 'key' | 'classes'>, cls?: string): SlackMsg {
  const key = `${m.channelId}:${m.ts}`;
  const cur = ix.messages[key];
  if (cur) {
    // Search rows carry channel/participants/permalink; thread rows carry extras. Merge, never lose a field.
    for (const [k, v] of Object.entries(m)) if (v !== undefined && v !== '' && (cur as unknown as Record<string, unknown>)[k] === undefined) (cur as unknown as Record<string, unknown>)[k] = v;
    if (cls && !cur.classes.includes(cls)) cur.classes.push(cls);
    return cur;
  }
  const msg: SlackMsg = { ...m, key, classes: cls ? [cls] : [] };
  ix.messages[key] = msg;
  return msg;
}

export function markRecorded(ix: SlackIndex, cls: string, day: string): void {
  const days = (ix.recorded[cls] ??= []);
  if (!days.includes(day)) days.push(day);
  days.sort();
}

export function addThread(ix: SlackIndex, channelId: string, threadTs: string, parent: Omit<SlackMsg, 'key' | 'classes'> | undefined, replies: Omit<SlackMsg, 'key' | 'classes'>[]): void {
  const key = `${channelId}:${threadTs}`;
  const t = (ix.threads[key] ??= { channelId, threadTs, parentKey: key, replyKeys: [] });
  if (parent) addMessage(ix, { ...parent, channelId, ts: parent.ts });
  for (const r of replies) {
    const m = addMessage(ix, { ...r, channelId, threadTs });
    if (!t.replyKeys.includes(m.key)) t.replyKeys.push(m.key);
  }
  t.replyKeys.sort((a, b) => tsMs(a.split(':')[1]!) - tsMs(b.split(':')[1]!));
}

// ------------------------------------------------------------------ query classification

/**
 * Real-tool behavior (finding S-1, verified live on 2026-11-05): `in:<#C…>` matches NOTHING in this Slack MCP's
 * search, while `in:#channel-name` works. Replay reproduces both, so skill versions are scored faithfully.
 */
export const BROKEN_ID_CHANNEL_FILTER = 'ch-id:';

export function channelNameMap(ix: SlackIndex): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of Object.values(ix.messages)) {
    const mm = m.channelLine?.match(/^#(\S+) \(ID: ([A-Z0-9]+)\)$/);
    if (mm) out[mm[1]!.toLowerCase()] = mm[2]!;
  }
  return out;
}

export function classifyQuery(query: string, me: string, names: Record<string, string> = {}): { cls: string; extra: string[] } {
  const q = query.trim();
  const toks = q.split(/\s+/).filter(Boolean);
  const meMention = `<@${me}>`;
  let cls: string | undefined;
  const extra: string[] = [];
  for (const t of toks) {
    if (t === `-from:${meMention}` || t === `-from:@me`) cls = cls ?? 'dm';
    else if (t === `from:${meMention}` || t === 'from:@me' || t === 'from:me') cls = cls ?? 'mine';
    else if (t === meMention || t === `to:${meMention}` || t === 'to:me') cls = cls ?? 'mentions';
    else if (/^in:<#([A-Z0-9]+)(\|[^>]*)?>$/.test(t)) cls = cls ?? `${BROKEN_ID_CHANNEL_FILTER}${t.match(/^in:<#([A-Z0-9]+)/)![1]}`;
    else if (/^in:#[a-z0-9_-]+$/i.test(t)) {
      const id = names[t.slice(4).toLowerCase()];
      if (!id) throw new ReplayMiss('slack_search_public_and_private', `channel name ${t.slice(4)} not recorded`);
      cls = cls ?? `ch:${id}`;
    }
    else extra.push(t);
  }
  if (!cls) throw new ReplayMiss('slack_search_public_and_private', `unrecognized query shape "${q.slice(0, 80)}"`);
  return { cls, extra };
}

function channelType(m: SlackMsg): 'im' | 'mpim' | 'channel' {
  const l = m.channelLine ?? '';
  if (/^Group DM\b/i.test(l)) return 'mpim';
  if (/^DM\b|^Direct Message/i.test(l) || m.channelId.startsWith('D')) return 'im';
  return 'channel';
}

export function typeAllowed(m: SlackMsg, types: string | undefined): boolean {
  const set = new Set((types ?? 'public_channel,private_channel,mpim,im').split(',').map((s) => s.trim()));
  const t = channelType(m);
  if (t === 'channel') return set.has('public_channel') || set.has('private_channel');
  return set.has(t);
}

// ------------------------------------------------------------------ replay

export interface ReplayStats {
  calls: number;
  misses: number;
  /** Data newer than the simulated now that LEFT the replay (must stay 0). */
  leaks: number;
  /** Requests for not-yet-existing data that the replay refused (expected; e.g. today's calendar attachments). */
  blocked?: number;
  byTool: Record<string, number>;
  missReasons: string[];
}

export interface SlackReplayOptions {
  now: () => number;
  /** Local zone of the recorded `Time:` strings and of "recorded day" bookkeeping. */
  zone?: string;
}

export class SlackReplay {
  readonly stats: ReplayStats = { calls: 0, misses: 0, leaks: 0, byTool: {}, missReasons: [] };
  private readonly names: Record<string, string>;
  constructor(
    readonly ix: SlackIndex,
    private readonly o: SlackReplayOptions,
  ) {
    this.names = channelNameMap(ix);
  }

  private visible(m: SlackMsg, now: number): boolean {
    if (tsMs(m.ts) > now) return false;
    if (m.visibleAt !== undefined && m.visibleAt > now) return false;
    if (m.deletedAt !== undefined && m.deletedAt <= now) return false;
    return true;
  }

  private textAt(m: SlackMsg, now: number): string {
    let t = m.text;
    for (const e of m.edits ?? []) if (e.at <= now) t = e.text;
    return t;
  }

  private miss(tool: string, why: string): never {
    this.stats.misses += 1;
    if (this.stats.missReasons.length < 200) this.stats.missReasons.push(`${tool}: ${why}`);
    throw new ReplayMiss(tool, why);
  }

  private count(tool: string) {
    this.stats.calls += 1;
    this.stats.byTool[tool] = (this.stats.byTool[tool] ?? 0) + 1;
  }

  /** Every local day overlapping [fromMs, toMs] must have been recorded for the class. */
  private assertRecorded(tool: string, cls: string, fromMs: number, toMs: number) {
    const days = new Set(this.ix.recorded[cls] ?? []);
    for (let t = fromMs; t <= toMs; t += 3600_000) {
      const d = localDay(t, this.o.zone);
      if (!days.has(d)) this.miss(tool, `class ${cls} not recorded for ${d}`);
    }
    if (!days.has(localDay(toMs, this.o.zone))) this.miss(tool, `class ${cls} not recorded for ${localDay(toMs, this.o.zone)}`);
  }

  private guard(tool: string, out: SlackMsg[], now: number) {
    for (const m of out) if (!this.visible(m, now)) this.stats.leaks += 1;
    void tool;
  }

  search(args: Record<string, unknown>): string {
    const tool = 'slack_search_public_and_private';
    this.count(tool);
    const now = this.o.now();
    const kw = Array.isArray(args.keywords) ? args.keywords.map(String) : [];
    const query = [args.query, args.filters, ...kw].filter((x) => typeof x === 'string' && x).join(' ');
    let cls: string;
    let extra: string[];
    try {
      ({ cls, extra } = classifyQuery(query, this.ix.me, this.names));
    } catch (e) {
      return this.miss(tool, e instanceof ReplayMiss ? e.why : String(e));
    }
    if (extra.length) this.miss(tool, `free-text terms are not replayable: ${extra.join(' ').slice(0, 60)}`);
    if (args.content_types && !String(args.content_types).includes('messages')) this.miss(tool, 'file search is not recorded');
    const after = args.after !== undefined ? Number(args.after) * 1000 : Number.NEGATIVE_INFINITY;
    const before = args.before !== undefined ? Number(args.before) * 1000 : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(after)) this.miss(tool, 'unbounded search (no after)');
    const hi = Math.min(before, now);
    if (cls.startsWith(BROKEN_ID_CHANNEL_FILTER)) {
      // Faithful to the real tool: the ID form of in: returns no results.
      return JSON.stringify({ results: `# Search Results for: ${query}\n\nNo results found.`, pagination_info: 'End of results - No more pages available.\n' });
    }
    if (hi >= after) this.assertRecorded(tool, cls, after, hi);
    const types = args.channel_types as string | undefined;
    let rows = Object.values(this.ix.messages).filter((m) => {
      if (!this.visible(m, now)) return false;
      const t = tsMs(m.ts);
      if (t < after || t > before) return false;
      if (!typeAllowed(m, types)) return false;
      if (cls.startsWith('ch:')) return m.channelId === cls.slice(3) && m.classes.some((c) => c === cls || c === 'mine' || c === 'mentions' || c === 'dm');
      return m.classes.includes(cls);
    });
    if (cls === 'dm' && types && /public|private/.test(types)) this.miss(tool, 'dm class recorded for im,mpim only');
    const asc = String(args.sort_dir ?? 'desc') === 'asc';
    rows.sort((a, b) => (asc ? 1 : -1) * (tsMs(a.ts) - tsMs(b.ts)));
    const limit = Math.max(1, Math.min(20, Number(args.limit ?? 20)));
    const page = args.cursor ? Number(Buffer.from(String(args.cursor), 'base64').toString('utf8').replace(/^CURRENT_PAGE:/, '')) || 1 : 1;
    const total = rows.length;
    rows = rows.slice((page - 1) * limit, page * limit);
    this.guard(tool, rows, now);
    // Like the real tool: a full page always offers a cursor (the next page may be empty).
    const more = rows.length === limit && page * limit <= total;
    const detailed = String(args.response_format ?? 'detailed') !== 'concise';
    const blocks = rows.map((m, i) => this.renderSearchRow(m, i + 1, rows.length, detailed, now));
    const results = `# Search Results for: ${query}\n\n## Messages (${rows.length} results)\n${blocks.join('')}`;
    const out: Record<string, string> = { results: rows.length ? results : `# Search Results for: ${query}\n\nNo results found.` };
    if (more) out.pagination_info = `For the next page of results use cursor \`${Buffer.from(`CURRENT_PAGE:${page + 1}`).toString('base64')}\``;
    return JSON.stringify(out);
  }

  private renderSearchRow(m: SlackMsg, i: number, n: number, detailed: boolean, now: number): string {
    const lines = [`### Result ${i} of ${n}`, `Channel: ${m.channelLine ?? `#${m.channelId} (ID: ${m.channelId})`}`];
    if (detailed && m.participantsLine) lines.push(`Participants: ${m.participantsLine}`);
    lines.push(`From: ${m.authorName ?? 'unknown'}${m.authorEmail ? ` <${m.authorEmail}>` : ''} (ID: ${m.authorId ?? 'U0'}) `);
    lines.push(`Time: ${m.time ?? new Date(tsMs(m.ts)).toISOString()}`, `Message_ts: ${m.ts}`);
    if (m.permalink) lines.push(`Permalink: [link](${m.permalink})`);
    lines.push(`Text: ${this.textAt(m, now)}`, '', '---', '', '');
    return lines.join('\n');
  }

  readThread(args: Record<string, unknown>): string {
    const tool = 'slack_read_thread';
    this.count(tool);
    const now = this.o.now();
    const ch = String(args.channel_id ?? '');
    const ts = String(args.message_ts ?? '');
    let t = this.ix.threads[`${ch}:${ts}`];
    if (!t) {
      // A reply's ts → its thread.
      const m = this.ix.messages[`${ch}:${ts}`];
      if (m?.threadTs) t = this.ix.threads[`${ch}:${m.threadTs}`];
    }
    if (!t) this.miss(tool, `thread ${ch}:${ts} not recorded`);
    const parent = this.ix.messages[t.parentKey];
    if (!parent || !this.visible(parent, now)) {
      return JSON.stringify({ messages: 'Error: thread_not_found' });
    }
    const oldest = args.oldest !== undefined ? Number(args.oldest) * 1000 : Number.NEGATIVE_INFINITY;
    let replies = t.replyKeys.map((k) => this.ix.messages[k]!).filter((m) => m && this.visible(m, now) && tsMs(m.ts) >= oldest);
    const limit = Math.max(1, Math.min(200, Number(args.limit ?? 100)));
    const start = args.cursor ? Number(Buffer.from(String(args.cursor), 'base64').toString('utf8').replace(/^offset:/, '')) || 0 : 0;
    const total = replies.length;
    replies = replies.slice(start, start + limit);
    this.guard(tool, [parent, ...replies], now);
    const detailed = String(args.response_format ?? 'detailed') !== 'concise';
    const body = detailed ? this.renderThreadDetailed(parent, replies, now) : this.renderThreadConcise(parent, replies, now);
    const out: Record<string, string> = { messages: body };
    if (start + limit < total) out.pagination_info = `There are more messages in this thread. To view the next page, use cursor: \`${Buffer.from(`offset:${start + limit}`).toString('base64')}\``;
    return JSON.stringify(out);
  }

  private who(m: SlackMsg) {
    return `${m.authorName ?? 'unknown'}${m.authorEmail ? ` <${m.authorEmail}>` : ''}`;
  }

  private renderThreadDetailed(p: SlackMsg, rs: SlackMsg[], now: number): string {
    const one = (m: SlackMsg) => [`From: ${this.who(m)} (${m.authorId ?? 'U0'})`, `Time: ${m.time ?? new Date(tsMs(m.ts)).toISOString()}`, `Message TS: ${m.ts}`, this.textAt(m, now), ...(m.extra ?? [])].join('\n');
    return [`=== THREAD PARENT MESSAGE ===`, one(p), '', `=== THREAD REPLIES (${rs.length} total) ===`, '', ...rs.map((r, i) => `--- Reply ${i + 1} of ${rs.length} ---\n${one(r)}\n`)].join('\n');
  }

  private renderThreadConcise(p: SlackMsg, rs: SlackMsg[], now: number): string {
    return [`THREAD: ${this.textAt(p, now)}`, ` [${this.who(p)}]`, ...rs.map((r) => `> ${this.who(r)}: ${this.textAt(r, now)}`)].join('\n');
  }

  readChannel(args: Record<string, unknown>): string {
    const tool = 'slack_read_channel';
    this.count(tool);
    const now = this.o.now();
    const ch = String(args.channel_id ?? '');
    const oldest = args.oldest !== undefined ? Number(args.oldest) * 1000 : now - 86400_000;
    const latest = Math.min(args.latest !== undefined ? Number(args.latest) * 1000 : now, now);
    const cls = `ch:${ch}`;
    const known = (this.ix.recorded[cls] ?? []).length ? cls : undefined;
    if (!known) this.miss(tool, `channel ${ch} history not recorded`);
    this.assertRecorded(tool, cls, oldest, latest);
    let rows = Object.values(this.ix.messages).filter((m) => m.channelId === ch && !m.threadTs && this.visible(m, now) && tsMs(m.ts) >= oldest && tsMs(m.ts) <= latest);
    rows.sort((a, b) => tsMs(b.ts) - tsMs(a.ts));
    const limit = Math.max(1, Math.min(100, Number(args.limit ?? 100)));
    rows = rows.slice(0, limit);
    this.guard(tool, rows, now);
    const detailed = String(args.response_format ?? 'detailed') !== 'concise';
    const head = `Channel: ${rows[0]?.channelLine?.replace(/\(ID: /, '(').replace(/\)$/, ')') ?? ch}\n`;
    const body = rows
      .map((m) =>
        detailed
          ? `=== Message from ${this.who(m)} (${m.authorId ?? 'U0'}) at ${m.time ?? ''} === \nMessage TS: ${m.ts}\n${this.textAt(m, now)}`
          : `${this.who(m)}: ${this.textAt(m, now)} [${m.time ?? ''}]`,
      )
      .join('\n\n');
    return JSON.stringify({ messages: `${head}\n${body}` });
  }

  listUnreads(): string {
    this.count('slack_list_unreads');
    return this.miss('slack_list_unreads', 'unread state cannot be time-travelled');
  }
}
