/**
 * Record Slack once, read-only, as a per-day SUPERSET for replay (replay/slack.ts):
 *   classes  dm (S1: -from:me, im+mpim) · mentions (S2: <@me>, channels) · mine (S3: from:me, all types)
 *            · ch:<id> (C1: in:<#id>, channels), each fully paged over the whole local day;
 *   threads  detailed `slack_read_thread` of every thread the recorded messages belong to (non-DM), paged.
 *
 *   npx tsx scripts/stress/record/slack.ts inbox    2026-10-08 2026-11-05
 *   npx tsx scripts/stress/record/slack.ts channels 2026-10-08 2026-11-05 C123,C456
 *   npx tsx scripts/stress/record/slack.ts threads  2026-10-08 2026-11-05
 *   npx tsx scripts/stress/record/slack.ts index
 * Raw tool results go to <stress>/recordings/slack/raw/*.jsonl (chmod 600). Only the allowlisted read tools are
 * used (search, read_thread). Prints counts only.
 */
import fs from 'node:fs';
import path from 'node:path';

import { callKey, execReadCalls, type ReadCall } from '../lib/exec-calls';
import { appendPriv, privDir, readJsonl, writePriv } from '../lib/paths';
import { dayBounds, daysBetween, unix } from '../lib/time';
import { addMessage, addThread, emptyIndex, markRecorded, parseSearchResults, parseThreadDetailed, type SlackIndex } from '../replay/slack';

const ME = process.env.CC_STRESS_ME_SLACK ?? '';
/** Channel id → bare Slack name, from the `channels` argument (`C123=name,C456=other`). */
const CHANNEL_NAMES = new Map<string, string>();
const SEARCH = 'mcp__slack__slack_search_public_and_private';
const THREAD = 'mcp__slack__slack_read_thread';

interface RawLine {
  kind: 'search' | 'thread';
  cls?: string;
  day?: string;
  channel?: string;
  threadTs?: string;
  page: number;
  args: Record<string, unknown>;
  response: unknown;
  at: string;
}

const rawDir = () => privDir('recordings', 'slack', 'raw');
const log = (m: string) => console.log(`[record:slack] ${m}`);

function classArgs(cls: string, day: string): Record<string, unknown> {
  const { from, to } = dayBounds(day);
  const base = { sort: 'timestamp', sort_dir: 'asc', limit: 20, include_context: false, response_format: 'detailed', after: String(unix(from)), before: String(unix(to)) };
  if (cls === 'dm') return { query: `-from:<@${ME}>`, channel_types: 'im,mpim', ...base };
  if (cls === 'mentions') return { query: `<@${ME}>`, channel_types: 'public_channel,private_channel', ...base };
  if (cls === 'mine') return { query: `from:<@${ME}>`, channel_types: 'public_channel,private_channel,mpim,im', ...base };
  // `in:<#ID>` returns nothing from the Slack MCP search (finding S-1); the channel NAME form works.
  if (cls.startsWith('ch:')) return { query: `in:#${CHANNEL_NAMES.get(cls.slice(3)) ?? cls.slice(3)}`, channel_types: 'public_channel,private_channel', ...base };
  throw new Error(`unknown class ${cls}`);
}

function done(): Set<string> {
  const s = new Set<string>();
  for (const f of fs.readdirSync(rawDir())) {
    for (const l of readJsonl<RawLine>(path.join(rawDir(), f))) {
      if (l.kind === 'search' && l.cls && l.day) {
        const { cursor } = parseSearchResults(l.response);
        if (!cursor) s.add(`${l.cls}|${l.day}`);
      }
      if (l.kind === 'thread' && l.channel && l.threadTs && !parseThreadDetailed(l.response, l.channel).cursor) s.add(`thread|${l.channel}:${l.threadTs}`);
    }
  }
  return s;
}

async function recordClasses(classes: string[], days: string[], file: string) {
  const finished = done();
  let pending = classes.flatMap((cls) => days.filter((d) => !finished.has(`${cls}|${d}`)).map((day) => ({ cls, day, page: 1, args: classArgs(cls, day) })));
  log(`${pending.length} class-day searches to record`);
  for (let round = 1; pending.length && round <= 15; round++) {
    const calls: ReadCall[] = pending.map((p) => ({ tool: SEARCH, args: p.args }));
    const res = await execReadCalls('slack', calls, { scenario: 'record', batch: 10, log });
    const next: typeof pending = [];
    for (const p of pending) {
      const c = res.get(callKey(SEARCH, p.args));
      if (!c) continue;
      appendPriv(file, JSON.stringify({ kind: 'search', cls: p.cls, day: p.day, page: p.page, args: p.args, response: c.response, at: c.at } satisfies RawLine));
      const { cursor } = parseSearchResults(c.response);
      if (cursor) next.push({ ...p, page: p.page + 1, args: { ...classArgs(p.cls, p.day), cursor } });
    }
    log(`round ${round}: ${pending.length} calls, ${next.length} with more pages`);
    pending = next;
  }
}

function threadRefs(ix: SlackIndex): Array<{ channel: string; ts: string }> {
  const refs = new Map<string, { channel: string; ts: string }>();
  for (const m of Object.values(ix.messages)) {
    const dm = m.channelId.startsWith('D');
    // Replies → their thread; top-level messages only when they are mine or mention me (the skill opens
    // threads for those); other channel top-levels are recorded without their (possible) replies.
    const ts = m.threadTs ?? (dm || !m.classes.some((c) => c === 'mine' || c === 'mentions') ? undefined : m.ts);
    if (!ts) continue;
    refs.set(`${m.channelId}:${ts}`, { channel: m.channelId, ts });
  }
  return [...refs.values()];
}

async function recordThreads(file: string, fromDay: string, toDay: string) {
  const ix = buildIndex();
  const lo = unix(dayBounds(fromDay).from);
  const hi = unix(dayBounds(toDay).to);
  const finished = done();
  let pending = threadRefs(ix)
    .filter((r) => (process.env.CC_STRESS_THREADS_FIRST === '1' ? true : Number(r.ts) >= lo) && Number(r.ts) < hi && !finished.has(`thread|${r.channel}:${r.ts}`))
    .map((r) => ({ ...r, page: 1, args: { channel_id: r.channel, message_ts: r.ts, limit: 100, response_format: 'detailed' } as Record<string, unknown> }));
  log(`${pending.length} threads to record`);
  for (let round = 1; pending.length && round <= 6; round++) {
    const res = await execReadCalls('slack', pending.map((p) => ({ tool: THREAD, args: p.args })), { scenario: 'record', batch: 10, log });
    const next: typeof pending = [];
    for (const p of pending) {
      const c = res.get(callKey(THREAD, p.args));
      if (!c) continue;
      appendPriv(file, JSON.stringify({ kind: 'thread', channel: p.channel, threadTs: p.ts, page: p.page, args: p.args, response: c.response, at: c.at } satisfies RawLine));
      const { cursor } = parseThreadDetailed(c.response, p.channel);
      if (cursor) next.push({ ...p, page: p.page + 1, args: { channel_id: p.channel, message_ts: p.ts, limit: 100, response_format: 'detailed', cursor } });
    }
    pending = next;
  }
}

/** Raw lines → replay index (also written to recordings/slack/index.json). */
export function buildIndex(): SlackIndex {
  const ix = emptyIndex(ME);
  const files = fs.existsSync(rawDir()) ? fs.readdirSync(rawDir()).sort() : [];
  const lines = files.flatMap((f) => readJsonl<RawLine>(path.join(rawDir(), f)));
  // Searches first (they carry channel lines and permalinks), then threads; pages in order.
  const complete = new Map<string, boolean>();
  for (const l of lines.filter((x) => x.kind === 'search')) {
    const { msgs, cursor } = parseSearchResults(l.response);
    for (const m of msgs) addMessage(ix, m, l.cls);
    const k = `${l.cls}|${l.day}`;
    if (!cursor) complete.set(k, true);
    else if (!complete.has(k)) complete.set(k, false);
  }
  for (const [k, ok] of complete) {
    if (!ok) continue;
    const [cls, day] = k.split('|') as [string, string];
    markRecorded(ix, cls, day);
  }
  for (const l of lines.filter((x) => x.kind === 'thread')) {
    const { parent, replies } = parseThreadDetailed(l.response, l.channel!);
    addThread(ix, l.channel!, l.threadTs!, parent, replies);
  }
  return ix;
}

async function main() {
  const [cmd, a = '2026-10-08', b = '2026-11-05', extra] = process.argv.slice(2);
  if (!ME) throw new Error('set CC_STRESS_ME_SLACK');
  const days = daysBetween(a, b);
  const file = path.join(rawDir(), `${cmd}-${a}-${b}-${process.pid}.jsonl`);
  if (cmd === 'inbox') await recordClasses(['dm', 'mentions', 'mine'], days, file);
  else if (cmd === 'channels') {
    const pairs = (extra ?? '').split(',').filter(Boolean).map((c) => c.split('=') as [string, string?]);
    for (const [id, name] of pairs) if (name) CHANNEL_NAMES.set(id, name);
    await recordClasses(pairs.map(([id]) => `ch:${id}`), days, file);
  }
  else if (cmd === 'threads') await recordThreads(file, a, b);
  if (cmd === 'index' || cmd === 'threads' || cmd === 'inbox' || cmd === 'channels') {
    const ix = buildIndex();
    writePriv(path.join(privDir('recordings', 'slack'), 'index.json'), JSON.stringify(ix));
    const byCls: Record<string, number> = {};
    for (const m of Object.values(ix.messages)) for (const c of m.classes) byCls[c] = (byCls[c] ?? 0) + 1;
    log(`index: ${Object.keys(ix.messages).length} messages, ${Object.keys(ix.threads).length} threads, classes ${JSON.stringify(byCls)}, recorded days ${JSON.stringify(Object.fromEntries(Object.entries(ix.recorded).map(([k, v]) => [k, v.length])))}`);
  }
}

const invoked = /record[\\/]slack\.ts$/.test(process.argv[1] ?? '');
if (invoked) {
  main().catch((e) => {
    console.error('[record:slack] failed', (e as Error).message);
    process.exit(1);
  });
}
