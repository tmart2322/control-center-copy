/**
 * Record the deterministic Google sources once (devbar google_workspace_readonly, read tools only, no LLM) as
 * supersets the replay filters by query, window and simulated now:
 *   gmail     every message id for each base query the fetchers use (inbox, sent, ±has:attachment, the two
 *             training queries) over the span, full content of each, and inbox threads;
 *   calendar  one wide get_events dump (event state is as of today: responses, cancellations);
 *   drive     the modifiedTime feed and the Gemini-notes name search since the span start, plus CURRENT
 *             content of my files, linked files and every Notes-by-Gemini doc (content cannot be time-travelled).
 *   npx tsx scripts/stress/record/google.ts 2026-10-01 2026-11-06
 */
import path from 'node:path';

import { GoogleWorkspaceClient } from '../../../src/connectors/google/client';
import { parseDriveSearch, parseEvents, parseGmailBatch, parseGmailSearch, splitThreadBatch } from '../../../src/connectors/google/parse';
import { TRAINING_QUERIES } from '../../../src/connectors/google/trainings';
import { kindFromMime } from '../../../src/scanner/drive-digest/digest';
import { privDir, readJson, writePriv } from '../lib/paths';
import { dayBounds, unix } from '../lib/time';

export const GMAIL_INBOX = 'in:anywhere -in:sent -in:drafts -in:spam -in:trash -category:promotions -category:social';
export const GMAIL_BASES = [GMAIL_INBOX, `${GMAIL_INBOX} has:attachment`, 'in:sent', 'in:sent has:attachment', ...TRAINING_QUERIES.map((q) => q.q)];

export interface GoogleRecording {
  span: { from: string; to: string };
  gmail: {
    /** base → recorded [from,to) epoch-ms span. */
    bases: Record<string, { from: number; to: number }>;
    /** message id → record. */
    messages: Record<string, { id: string; threadId?: string; webLink?: string; dateMs?: number; bases: string[]; block?: string }>;
    threads: Record<string, string>;
    searchHeaderSample?: string;
  };
  calendar: { from: string; to: string; blocks: string[]; header: string };
  drive: {
    feedFrom: string;
    rows: string[]; // raw `- Name:` lines (modifiedTime feed ∪ gemini search)
    content: Record<string, { tool: string; text: string; extra?: Record<string, string> }>;
  };
}

const log = (m: string) => console.log(`[record:google] ${m}`);

async function listAll(g: GoogleWorkspaceClient, query: string) {
  const out: Array<{ id: string; threadId?: string; webLink?: string }> = [];
  let token: string | undefined;
  let header = '';
  for (let i = 0; i < 60; i++) {
    const text = await g.call('search_gmail_messages', { query, page_size: 100, ...(token ? { page_token: token } : {}) });
    if (!header) header = text.split('\n')[0] ?? '';
    const p = parseGmailSearch(text);
    out.push(...p.hits);
    token = p.nextPageToken;
    if (!token || !p.hits.length) break;
  }
  return { hits: out, header };
}

async function main() {
  const [a = '2026-10-01', b = '2026-11-06'] = process.argv.slice(2);
  const span = { from: dayBounds(a).from, to: dayBounds(b).to };
  const g = new GoogleWorkspaceClient({ timeoutMs: 60_000 });
  const file = path.join(privDir('recordings', 'google'), 'recording.json');
  const rec: GoogleRecording = readJson<GoogleRecording>(file, {
    span,
    gmail: { bases: {}, messages: {}, threads: {} },
    calendar: { from: '', to: '', blocks: [], header: '' },
    drive: { feedFrom: '', rows: [], content: {} },
  });
  const only = new Set((process.env.CC_STRESS_GOOGLE ?? 'gmail,calendar,drive').split(','));

  if (only.has('gmail')) {
    for (const base of GMAIL_BASES) {
      const training = !base.startsWith('in:');
      const from = training ? Date.parse('2026-06-01T00:00:00Z') : Date.parse(span.from);
      const to = Date.parse(span.to);
      const { hits, header } = await listAll(g, `${base} after:${Math.floor(from / 1000)} before:${Math.ceil(to / 1000)}`);
      rec.gmail.searchHeaderSample ??= header;
      rec.gmail.bases[base] = { from, to };
      for (const h of hits) {
        const m = (rec.gmail.messages[h.id] ??= { id: h.id, threadId: h.threadId, webLink: h.webLink, bases: [] });
        if (!m.bases.includes(base)) m.bases.push(base);
      }
      log(`${base.slice(0, 40)}…: ${hits.length}`);
    }
    const need = Object.values(rec.gmail.messages).filter((m) => !m.block);
    for (let i = 0; i < need.length; i += 20) {
      const ids = need.slice(i, i + 20).map((m) => m.id);
      const text = await g.call('get_gmail_messages_content_batch', { message_ids: ids, format: 'full' });
      const parts = text.split(/^(?=Message ID:\s*)/m).filter((p) => /^Message ID:/.test(p));
      for (const part of parts) {
        const [m] = parseGmailBatch(part);
        if (!m || !rec.gmail.messages[m.id]) continue;
        rec.gmail.messages[m.id]!.block = part.replace(/\s+$/, '\n');
        rec.gmail.messages[m.id]!.dateMs = m.dateIso ? Date.parse(m.dateIso) : undefined;
      }
      if (i % 200 === 0) log(`bodies ${i}/${need.length}`);
    }
    const inboxThreads = [...new Set(Object.values(rec.gmail.messages).filter((m) => m.bases.includes(GMAIL_INBOX) && m.threadId).map((m) => m.threadId!))].filter((t) => !rec.gmail.threads[t]);
    for (let i = 0; i < inboxThreads.length; i += 5) {
      const text = await g.call('get_gmail_threads_content_batch', { thread_ids: inboxThreads.slice(i, i + 5) });
      for (const chunk of splitThreadBatch(text)) {
        const id = chunk.match(/^Thread ID:\s*(\S+)/m)?.[1];
        if (id) rec.gmail.threads[id] = chunk;
      }
    }
    log(`gmail: ${Object.keys(rec.gmail.messages).length} messages, ${Object.keys(rec.gmail.threads).length} threads`);
    writePriv(file, JSON.stringify(rec));
  }

  if (only.has('calendar')) {
    const from = new Date(Date.parse(span.from) - 3 * 86400_000).toISOString();
    const to = new Date(Date.parse(span.to) + 20 * 86400_000).toISOString();
    const text = await g.call('get_events', { time_min: from, time_max: to, detailed: true, include_attachments: true, max_results: 2500 });
    const lines = text.split('\n');
    const header = lines.findIndex((l) => l.startsWith('- "'));
    const blocks: string[] = [];
    let cur: string[] | null = null;
    for (const l of lines.slice(Math.max(0, header))) {
      if (l.startsWith('- "')) {
        if (cur) blocks.push(cur.join('\n'));
        cur = [l];
      } else if (cur) cur.push(l);
    }
    if (cur) blocks.push(cur.join('\n'));
    rec.calendar = { from, to, blocks: blocks.map((b) => b.replace(/\s+$/, '')), header: lines.slice(0, Math.max(0, header)).join('\n') };
    log(`calendar: ${blocks.length} events (parsed ${parseEvents(blocks.join('\n')).length})`);
    writePriv(file, JSON.stringify(rec));
  }

  if (only.has('drive')) {
    const feedFrom = process.env.CC_STRESS_DRIVE_FROM ?? new Date(Date.parse(span.from) - 2 * 86400_000).toISOString();
    const rows = new Map<string, string>();
    for (const q of [`modifiedTime > '${feedFrom}' and trashed = false`, `name contains 'Notes by Gemini' and modifiedTime > '${feedFrom}' and trashed = false`]) {
      let token: string | undefined;
      for (let p = 0; p < 80; p++) {
        const text = await g.call('search_drive_files', { query: q, detailed: true, page_size: 100, include_items_from_all_drives: true, ...(token ? { page_token: token } : {}) });
        for (const line of text.split('\n')) if (line.startsWith('- Name: ')) rows.set(parseDriveSearch(line).files[0]!.id, line);
        token = parseDriveSearch(text).nextPageToken;
        if (!token) break;
      }
    }
    rec.drive.feedFrom = feedFrom;
    rec.drive.rows = [...rows.values()];
    const me = (process.env.CC_STRESS_ME_EMAIL ?? '').toLowerCase();
    const files = rec.drive.rows.map((r) => parseDriveSearch(r).files[0]!);
    const want = files.filter((f) => /notes by gemini/i.test(f.name) || (f.lastEditedByEmail === me && kindFromMime(f.mimeType) !== 'other'));
    log(`drive: ${files.length} rows, fetching content of ${want.length}`);
    for (const f of want) {
      if (rec.drive.content[f.id]) continue;
      const k = kindFromMime(f.mimeType);
      try {
        if (k === 'slides') rec.drive.content[f.id] = { tool: 'get_presentation', text: await g.call('get_presentation', { presentation_id: f.id }) };
        else if (k === 'doc') rec.drive.content[f.id] = { tool: 'get_doc_as_markdown', text: await g.call('get_doc_as_markdown', { document_id: f.id, include_comments: false }) };
        else if (k === 'sheet') {
          const info = await g.call('get_spreadsheet_info', { spreadsheet_id: f.id });
          rec.drive.content[f.id] = { tool: 'get_spreadsheet_info', text: info, extra: {} };
        }
      } catch (e) {
        log(`content ${k} failed: ${(e as Error).message.slice(0, 80)}`);
      }
    }
    writePriv(file, JSON.stringify(rec));
    log(`drive: ${Object.keys(rec.drive.content).length} contents`);
  }
  await g.close();
  void unix;
}

main().catch((e) => {
  console.error('[record:google] failed', (e as Error).message);
  process.exit(1);
});
