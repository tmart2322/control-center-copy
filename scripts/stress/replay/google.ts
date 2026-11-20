/**
 * Replay of devbar's google_workspace_readonly tools (the `GoogleTools` seam the fetchers depend on) from the
 * recorded superset (record/google.ts). Responses are re-rendered in the tool's own text format, so the
 * production parsers (src/connectors/google/parse.ts) run unchanged. Filters:
 *   - Gmail search: base query must be a recorded base; after/before epochs and the simulated now bound the
 *     message Date; newest first, paged with page_token. Batch/thread content only for visible messages.
 *   - Calendar: events overlapping [time_min, time_max] (state as of today).
 *   - Drive: `modifiedTime > '<iso>'` (+ `name contains '…'`), rows visible once modified ≤ now; content is the
 *     current revision (Drive cannot be time-travelled), served only once the file exists (created ≤ now).
 * A call outside the recording throws `ReplayMiss`. Nothing newer than now leaves (`leaks` stays 0).
 */
import { assertReadTool, GoogleCallError, GoogleWorkspaceClient as RealGoogleClient, type GoogleTools } from '../../../src/connectors/google/client';
import { parseDriveSearch, parseEvents } from '../../../src/connectors/google/parse';
import type { ConnectorHealthProbe } from '../../../src/scanner/types';
import type { GoogleRecording } from '../record/google';

import { FAULT_TEXT, type FaultInjector, sleepMs } from './faults';
import { ReplayMiss, type ReplayStats } from './slack';

export interface GoogleOverlay {
  /** Late arrival: the message only becomes visible (listable) at this time, whatever its Date. */
  visibleAt?: Record<string, number>;
}

type DriveRow = { line: string; id: string; name: string; modified: number; created?: number };

export class GoogleReplay implements GoogleTools {
  readonly stats: ReplayStats = { calls: 0, misses: 0, leaks: 0, byTool: {}, missReasons: [] };
  private readonly events: Array<{ block: string; start: number; end: number }>;
  private readonly driveRows: DriveRow[];

  constructor(
    readonly rec: GoogleRecording,
    private readonly o: { now: () => number; overlay?: GoogleOverlay; onCall?: (tool: string, args: Record<string, unknown>) => void | Promise<void> },
  ) {
    this.events = rec.calendar.blocks.map((b) => {
      const [e] = parseEvents(b);
      return { block: b, start: Date.parse(e!.start), end: Date.parse(e!.end) };
    });
    this.driveRows = rec.drive.rows.map((line) => {
      const f = parseDriveSearch(line).files[0]!;
      return { line, id: f.id, name: f.name, modified: Date.parse(f.modified), created: f.created ? Date.parse(f.created) : undefined };
    });
  }

  private miss(tool: string, why: string): never {
    this.stats.misses += 1;
    if (this.stats.missReasons.length < 200) this.stats.missReasons.push(`${tool}: ${why}`);
    throw new ReplayMiss(tool, why);
  }

  async health(): Promise<ConnectorHealthProbe> {
    return { state: 'ok', checkedAt: new Date(this.o.now()).toISOString() };
  }

  private visibleMsg(id: string, now: number): boolean {
    const m = this.rec.gmail.messages[id];
    if (!m?.dateMs || m.dateMs > now) return false;
    const v = this.o.overlay?.visibleAt?.[id];
    return v === undefined || v <= now;
  }

  async call(tool: string, args: Record<string, unknown>): Promise<string> {
    assertReadTool(tool);
    this.stats.calls += 1;
    this.stats.byTool[tool] = (this.stats.byTool[tool] ?? 0) + 1;
    await this.o.onCall?.(tool, args);
    const now = this.o.now();
    switch (tool) {
      case 'search_gmail_messages':
        return this.gmailSearch(args, now);
      case 'get_gmail_messages_content_batch':
        return this.gmailBatch(args, now);
      case 'get_gmail_threads_content_batch':
        return this.gmailThreads(args, now);
      case 'get_events':
        return this.calendar(args, now);
      case 'list_calendars':
        return 'Calendars:\n- primary';
      case 'search_drive_files':
        return this.driveSearch(args, now);
      case 'get_doc_as_markdown':
      case 'get_presentation':
      case 'get_spreadsheet_info':
        return this.driveContent(tool, String(args.document_id ?? args.presentation_id ?? args.spreadsheet_id ?? ''), now);
      case 'read_sheet_values':
        // Sheet cell values were not recorded (documented gap): an object-scoped "not found", like a sheet you lost access to.
        this.stats.blocked = (this.stats.blocked ?? 0) + 1;
        throw new GoogleCallError(tool, { errorClass: 'unknown', signature: 'not_found', objectScoped: true }, 'sheet values not recorded');
      default:
        return this.miss(tool, 'tool not recorded');
    }
  }

  private gmailSearch(args: Record<string, unknown>, now: number): string {
    const q = String(args.query ?? '');
    const after = Number(q.match(/(?:^|\s)after:(\d+)/)?.[1] ?? NaN) * 1000;
    const before = Number(q.match(/(?:^|\s)before:(\d+)/)?.[1] ?? NaN) * 1000;
    const base = q
      .replace(/(?:^|\s)(after|before):\d+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const span = this.rec.gmail.bases[base];
    if (!span) this.miss('search_gmail_messages', `base query not recorded: ${base.slice(0, 60)}`);
    if (!Number.isFinite(after) || !Number.isFinite(before)) this.miss('search_gmail_messages', 'query without after/before');
    const hi = Math.min(before, now);
    if (after < span.from - 1000 || (hi > span.to + 1000 && hi > after)) this.miss('search_gmail_messages', `window outside the recorded span (${new Date(after).toISOString()} → ${new Date(hi).toISOString()})`);
    const hits = Object.values(this.rec.gmail.messages)
      .filter((m) => m.bases.includes(base) && m.dateMs !== undefined && m.dateMs >= after && m.dateMs < before && this.visibleMsg(m.id, now))
      .sort((a, b) => b.dateMs! - a.dateMs!);
    const size = Math.max(1, Math.min(500, Number(args.page_size ?? 10)));
    const off = args.page_token ? Number(Buffer.from(String(args.page_token), 'base64url').toString('utf8')) || 0 : 0;
    const page = hits.slice(off, off + size);
    if (!page.length) return `No messages found for query: '${q}'`;
    const rows = page.map((m) => `Message ID: ${m.id}\nWeb Link: ${m.webLink ?? `https://mail.google.com/mail/u/0/#all/${m.id}`}\nThread ID: ${m.threadId ?? m.id}\n`);
    const more = off + size < hits.length ? `\n\nTo get the next page, call search_gmail_messages again with page_token='${Buffer.from(String(off + size)).toString('base64url')}'` : '';
    return `Found ${page.length} messages matching '${q}':\n\n${rows.join('\n')}${more}`;
  }

  private gmailBatch(args: Record<string, unknown>, now: number): string {
    const ids = (args.message_ids as string[] | undefined) ?? [];
    const blocks: string[] = [];
    for (const id of ids) {
      const m = this.rec.gmail.messages[id];
      if (!m?.block) this.miss('get_gmail_messages_content_batch', `message ${id} not recorded`);
      if (!this.visibleMsg(id, now)) {
        // Asked for a message it could not have listed yet: never served.
        this.stats.blocked = (this.stats.blocked ?? 0) + 1;
        continue;
      }
      blocks.push(m.block);
    }
    return `Retrieved ${blocks.length} messages:\n\n${blocks.join('\n---\n\n')}`;
  }

  private gmailThreads(args: Record<string, unknown>, now: number): string {
    const ids = (args.thread_ids as string[] | undefined) ?? [];
    const out: string[] = [];
    for (const id of ids) {
      const raw = this.rec.gmail.threads[id];
      if (!raw) this.miss('get_gmail_threads_content_batch', `thread ${id} not recorded`);
      const [head, ...parts] = raw.split(/^(?==== Message \d+ ===\s*$)/m);
      const kept = parts.filter((p) => {
        const d = Date.parse(p.match(/^Date:\s*(.*)$/m)?.[1]?.trim() ?? '');
        return Number.isNaN(d) || d <= now;
      });
      out.push([head!.replace(/Messages: \d+/, `Messages: ${kept.length}`), ...kept.map((p, i) => p.replace(/^=== Message \d+ ===/, `=== Message ${i + 1} ===`))].join(''));
    }
    return out.join('\n');
  }

  private calendar(args: Record<string, unknown>, now: number): string {
    const from = Date.parse(String(args.time_min ?? ''));
    const to = Date.parse(String(args.time_max ?? ''));
    if (!Number.isFinite(from) || !Number.isFinite(to)) this.miss('get_events', 'missing time_min/time_max');
    if (from < Date.parse(this.rec.calendar.from) - 60_000 || to > Date.parse(this.rec.calendar.to) + 60_000) this.miss('get_events', 'range outside the recorded span');
    void now; // Calendar state is as of today (documented limitation); future events are legitimately visible.
    const max = Number(args.max_results ?? 250);
    const evs = this.events.filter((e) => e.end > from && e.start < to).slice(0, max);
    if (!evs.length) return 'No events found in the specified time range.';
    return `${this.rec.calendar.header ? `${this.rec.calendar.header}\n` : ''}${evs.map((e) => this.withoutFutureAttachments(e.block, now)).join('\n')}\n`;
  }

  /** Event state is as of today; an attachment whose Drive file did not exist yet at `now` (e.g. the Gemini notes doc) is removed. */
  private withoutFutureAttachments(block: string, now: number): string {
    const lines = block.split('\n');
    const start = lines.findIndex((l) => /^  Attachments:/.test(l));
    if (start < 0) return block;
    let end = start + 1;
    while (end < lines.length && !/^  [A-Z][\w ]+:/.test(lines[end]!)) end++;
    const head = lines[start]!.replace(/^  Attachments:\s?/, '');
    const body = [head, ...lines.slice(start + 1, end)].filter((l) => l.trim());
    const groups: string[][] = [];
    for (const l of body) {
      if (/^\s*(File URL|File ID|MIME Type):/.test(l) && groups.length) groups[groups.length - 1]!.push(l);
      else groups.push([l]);
    }
    const keep = groups.filter((g) => {
      const id = g.map((l) => l.match(/File ID:\s*(\S+)/)?.[1]).find(Boolean);
      const row = id ? this.driveRows.find((r) => r.id === id) : undefined;
      if (row?.created !== undefined && row.created > now) {
        this.stats.blocked = (this.stats.blocked ?? 0) + 1;
        return false;
      }
      return true;
    });
    if (keep.length === groups.length) return block;
    const att = keep.length ? [`  Attachments: ${keep[0]![0]!.trim()}`, ...keep[0]!.slice(1), ...keep.slice(1).flat()] : ['  Attachments: None'];
    return [...lines.slice(0, start), ...att, ...lines.slice(end)].join('\n');
  }

  private driveSearch(args: Record<string, unknown>, now: number): string {
    const q = String(args.query ?? '');
    const mt = q.match(/modifiedTime > '([^']+)'/)?.[1];
    const name = q.match(/name contains '([^']+)'/)?.[1];
    const rest = q
      .replace(/modifiedTime > '[^']+'/, '')
      .replace(/name contains '[^']+'/, '')
      .replace(/trashed = false/, '')
      .replace(/\band\b/g, '')
      .trim();
    if (!mt || rest) this.miss('search_drive_files', `query shape not recorded: ${q.slice(0, 80)}`);
    const since = Date.parse(mt);
    if (since < Date.parse(this.rec.drive.feedFrom) - 1000) this.miss('search_drive_files', 'modifiedTime before the recorded feed start');
    // Visibility at `now`: a row whose CURRENT modifiedTime is ≤ now as is. A Gemini notes doc edited later is shown
    // as of its creation (its content is written once, right after the meeting; documented approximation). Any other
    // file edited after now is hidden: its earlier revision is unknown and its current content would leak the future.
    const eff = (r: DriveRow) => (r.modified <= now ? r.modified : /notes by gemini/i.test(r.name) && r.created !== undefined && r.created <= now ? r.created : undefined);
    const rows = this.driveRows
      .map((r) => ({ r, m: eff(r) }))
      .filter((x): x is { r: DriveRow; m: number } => x.m !== undefined && x.m > since && (!name || x.r.name.toLowerCase().includes(name.toLowerCase())))
      .sort((a, b) => b.m - a.m)
      .map((x) => (x.m === x.r.modified ? x.r : { ...x.r, line: x.r.line.replace(/Modified: [^,)]+/, `Modified: ${new Date(x.m).toISOString()}`) }));
    const size = Math.max(1, Math.min(1000, Number(args.page_size ?? 10)));
    const off = args.page_token ? Number(Buffer.from(String(args.page_token), 'base64url').toString('utf8')) || 0 : 0;
    const page = rows.slice(off, off + size);
    const tok = off + size < rows.length ? `\nnextPageToken: ${Buffer.from(String(off + size)).toString('base64url')}` : '';
    return `Found ${page.length} files matching '${q}':\n${page.map((r) => r.line).join('\n')}${tok}\n`;
  }

  private driveContent(tool: string, id: string, now: number): string {
    const c = this.rec.drive.content[id];
    const row = this.driveRows.find((r) => r.id === id);
    if (row?.created !== undefined && row.created > now) {
      this.stats.blocked = (this.stats.blocked ?? 0) + 1;
      throw new GoogleCallError(tool, { errorClass: 'unknown', signature: 'not_found', objectScoped: true }, 'File not found (not created yet)');
    }
    if (!c || c.tool !== tool) this.miss(tool, `content of ${id} not recorded for ${tool}`);
    return c.text;
  }
}

/**
 * The real GoogleWorkspaceClient (mutex, per-call timeout, retries, error classification) over the replay:
 * only the MCP transport is swapped, through the client's `clientFactory` seam. Faults are injected here.
 */

export function replayGoogleClient(replay: GoogleReplay, faults?: FaultInjector, opts: { timeoutMs?: number } = {}): RealGoogleClient {
  return new RealGoogleClient({
    timeoutMs: opts.timeoutMs ?? 30_000,
    clientFactory: () => ({
      client: {
        connect: async () => undefined,
        close: async () => undefined,
        listTools: async () => ({ tools: [] }),
        callTool: async (req: { name: string; arguments?: Record<string, unknown> }) => {
          const f = faults?.decide(req.name);
          if (f?.kind === 'slow') await sleepMs(f.delayMs ?? 3000);
          if (f?.kind === 'timeout') {
            await sleepMs(f.delayMs ?? 35_000);
          }
          if (f && (f.kind === 'rate_limit' || f.kind === 'server_error' || f.kind === 'auth')) {
            return { content: [{ type: 'text', text: FAULT_TEXT.google[f.kind] }], isError: true };
          }
          if (f?.kind === 'empty' && req.name === 'search_gmail_messages') return { content: [{ type: 'text', text: `No messages found for query: '${String(req.arguments?.query ?? '')}'` }] };
          const t = await replay.call(req.name, req.arguments ?? {});
          return { content: [{ type: 'text', text: t }] };
        },
      } as never,
    }),
  });
}
