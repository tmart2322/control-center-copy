/**
 * Deterministic parsers for the text the devbar `google_workspace_readonly` tools return.
 * Formats were recorded 2026-11-05 (brief 09, this chunk's fixtures). Parsers are tolerant: unknown lines are
 * ignored, and a payload that yields nothing from non-empty input is reported via `ParseDrift` so health can warn.
 */

export class ParseDrift extends Error {
  constructor(
    public readonly parser: string,
    detail: string,
  ) {
    super(`parser drift in ${parser}: ${detail}`);
    this.name = 'ParseDrift';
  }
}

// ------------------------------------------------------------------ Gmail

export interface GmailSearchHit {
  id: string;
  threadId?: string;
  webLink?: string;
}

export interface GmailSearchPage {
  hits: GmailSearchHit[];
  nextPageToken?: string;
}

export function parseGmailSearch(text: string): GmailSearchPage {
  const hits: GmailSearchHit[] = [];
  const re = /Message ID:\s*(\S+)\s*\n(?:\s*Web Link:\s*(\S+)\s*\n)?(?:\s*Thread ID:\s*(\S+))?/g;
  for (const m of text.matchAll(re)) hits.push({ id: m[1]!, webLink: m[2], threadId: m[3] });
  const tok = text.match(/page_token='([^']+)'/);
  if (hits.length === 0 && /Found [1-9]\d* messages/.test(text)) throw new ParseDrift('gmail.search', 'header says messages found but none parsed');
  return { hits, nextPageToken: tok?.[1] };
}

export interface GmailMessage {
  id: string;
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: string; // raw Date header
  dateIso?: string;
  messageIdHeader?: string;
  inReplyTo?: string;
  webLink?: string;
  body: string;
}

export function parseGmailBatch(text: string): GmailMessage[] {
  const out: GmailMessage[] = [];
  // Split on "Message ID:" at line start.
  const parts = text.split(/^Message ID:\s*/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const id = part.slice(0, nl < 0 ? undefined : nl).trim();
    const rest = nl < 0 ? '' : part.slice(nl + 1);
    const bodyAt = rest.indexOf('--- BODY ---');
    const head = bodyAt >= 0 ? rest.slice(0, bodyAt) : rest;
    let body = bodyAt >= 0 ? rest.slice(bodyAt + '--- BODY ---'.length) : '';
    body = body.replace(/\n---\s*\n*$/, '').replace(/^\n/, '').trimEnd();
    const hdr = (name: string): string => {
      const m = head.match(new RegExp(`^${name}:\\s*(.*(?:\\n[ \\t]+.*)*)`, 'mi'));
      return m ? m[1]!.replace(/\s*\n\s*/g, ' ').trim() : '';
    };
    const date = hdr('Date');
    const t = Date.parse(date);
    out.push({
      id,
      subject: hdr('Subject'),
      from: hdr('From'),
      to: hdr('To'),
      cc: hdr('Cc'),
      date,
      dateIso: Number.isNaN(t) ? undefined : new Date(t).toISOString(),
      messageIdHeader: hdr('Message-ID') || undefined,
      inReplyTo: hdr('In-Reply-To') || undefined,
      webLink: hdr('Web Link') || undefined,
      body,
    });
  }
  if (out.length === 0 && /Retrieved [1-9]\d* messages?/.test(text)) throw new ParseDrift('gmail.batch', 'header says messages retrieved but none parsed');
  return out;
}

export interface GmailThreadMessage {
  from: string;
  date: string;
  dateIso?: string;
  body: string;
}

export function parseGmailThread(text: string): { threadId?: string; subject?: string; messages: GmailThreadMessage[] } {
  const threadId = text.match(/^Thread ID:\s*(\S+)/m)?.[1];
  const subject = text.match(/^Subject:\s*(.*)$/m)?.[1]?.trim();
  const parts = text.split(/^=== Message \d+ ===\s*$/m).slice(1);
  const messages: GmailThreadMessage[] = parts.map((p) => {
    const from = p.match(/^From:\s*(.*)$/m)?.[1]?.trim() ?? '';
    const date = p.match(/^Date:\s*(.*)$/m)?.[1]?.trim() ?? '';
    const t = Date.parse(date);
    const bodyStart = p.search(/\n\s*\n/);
    return { from, date, dateIso: Number.isNaN(t) ? undefined : new Date(t).toISOString(), body: bodyStart >= 0 ? p.slice(bodyStart).trim() : '' };
  });
  return { threadId, subject, messages };
}

/** Splits a thread-batch response into per-thread chunks (each starts with "Thread ID:"). */
export function splitThreadBatch(text: string): string[] {
  const chunks = text.split(/^(?=Thread ID:\s*\S+)/m).filter((c) => /^Thread ID:/.test(c));
  return chunks;
}

// ------------------------------------------------------------------ Calendar

export interface ParsedAttendee {
  email: string;
  response: 'accepted' | 'declined' | 'tentative' | 'needsAction' | string;
  optional?: boolean;
  organizer?: boolean;
}

export interface ParsedAttachment {
  title: string;
  url?: string;
  fileId?: string;
  mimeType?: string;
}

export interface ParsedEvent {
  id: string;
  title: string;
  startsRaw: string;
  endsRaw: string;
  start: string; // ISO (all-day: local midnight UTC of that date)
  end: string;
  allDay: boolean;
  description: string;
  location: string;
  creator?: string;
  organizerRaw?: string;
  organizerEmail?: string;
  meetingLink?: string;
  attendeeEmails: string[];
  attendees: ParsedAttendee[];
  attachments: ParsedAttachment[];
  link?: string;
}

const EVENT_LABELS = ['Description', 'Location', 'Creator', 'Organizer', 'Meeting Link', 'Attendees', 'Attendee Details', 'Attachments'] as const;
const LABEL_RE = new RegExp(`^  (${EVENT_LABELS.join('|')}):\\s?(.*)$`);

function parseEventTime(raw: string): { iso: string; allDay: boolean } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { iso: `${raw}T00:00:00.000Z`, allDay: true };
  const t = Date.parse(raw);
  return { iso: Number.isNaN(t) ? raw : new Date(t).toISOString(), allDay: false };
}

export function parseEvents(text: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  let cur: (ParsedEvent & { _field?: string; _buf: Record<string, string[]> }) | null = null;
  const flush = () => {
    if (!cur) return;
    const b = cur._buf;
    const join = (k: string) => (b[k] ?? []).join('\n').trim();
    cur.description = join('Description') === 'No Description' ? '' : join('Description');
    cur.location = join('Location') === 'No Location' ? '' : join('Location');
    cur.creator = join('Creator') || undefined;
    cur.organizerRaw = join('Organizer') || undefined;
    cur.organizerEmail = cur.organizerRaw?.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1]?.toLowerCase();
    cur.meetingLink = join('Meeting Link') || undefined;
    cur.attendeeEmails = join('Attendees')
      .split(/[,\s]+/)
      .filter((x) => x.includes('@'))
      .map((x) => x.toLowerCase());
    cur.attendees = [];
    for (const line of (b['Attendee Details'] ?? []).join('\n').split('\n')) {
      const m = line.trim().match(/^([^\s:]+@[^\s:]+):\s*(\w+)\s*(?:\(([^)]*)\))?/);
      if (m) cur.attendees.push({ email: m[1]!.toLowerCase(), response: m[2]!, optional: /optional/.test(m[3] ?? ''), organizer: /organizer/.test(m[3] ?? '') });
    }
    cur.attachments = [];
    let att: ParsedAttachment | null = null;
    for (const [i, line] of (b['Attachments'] ?? []).entries()) {
      const t = line.trim();
      if (!t || (i === 0 && t === 'None')) continue;
      const kv = t.match(/^(File URL|File ID|MIME Type):\s*(.*)$/);
      if (kv && att) {
        if (kv[1] === 'File URL') att.url = kv[2];
        else if (kv[1] === 'File ID') att.fileId = kv[2];
        else att.mimeType = kv[2];
      } else {
        att = { title: t };
        cur.attachments.push(att);
      }
    }
    const { _field, _buf, ...clean } = cur;
    void _field;
    void _buf;
    events.push(clean);
    cur = null;
  };

  for (const line of text.split('\n')) {
    const head = line.match(/^- "(.*)" \(Starts: (.+?), Ends: (.+?)\)\s*$/);
    if (head) {
      flush();
      const s = parseEventTime(head[2]!);
      const e = parseEventTime(head[3]!);
      cur = {
        id: '',
        title: head[1]!,
        startsRaw: head[2]!,
        endsRaw: head[3]!,
        start: s.iso,
        end: e.iso,
        allDay: s.allDay,
        description: '',
        location: '',
        attendeeEmails: [],
        attendees: [],
        attachments: [],
        _buf: {},
      };
      continue;
    }
    if (!cur) continue;
    const idm = line.match(/^  ID:\s*(\S+)\s*\|\s*Link:\s*(\S+)/);
    if (idm) {
      cur.id = idm[1]!;
      cur.link = idm[2];
      cur._field = undefined;
      continue;
    }
    const lm = line.match(LABEL_RE);
    if (lm) {
      cur._field = lm[1]!;
      cur._buf[cur._field] = [lm[2] ?? ''];
      continue;
    }
    if (cur._field) (cur._buf[cur._field] ??= []).push(line);
  }
  flush();
  const bad = events.filter((e) => !e.id);
  if (bad.length) throw new ParseDrift('calendar.events', `${bad.length} event(s) without an ID line`);
  return events;
}

// ------------------------------------------------------------------ Drive

export interface DriveFileRow {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  created?: string;
  modified: string;
  lastEditedByName?: string;
  lastEditedByEmail?: string;
  link?: string;
}

export interface DriveSearchPage {
  files: DriveFileRow[];
  nextPageToken?: string;
}

export function parseDriveSearch(text: string): DriveSearchPage {
  const files: DriveFileRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('- Name: ')) continue;
    const m = line.match(/^- Name: "(.*)" \(ID: ([^,]+), Type: ([^,]+),(?: Size: (\d+),)? Created: ([^,]+), Modified: ([^,)]+)(?:, Last Edited By: ([^)]*))?\)(?: Link: (\S+))?/);
    if (!m) throw new ParseDrift('drive.search', 'unrecognized file row');
    const who = m[7]?.match(/^(.*?)\s*<([^<>]+)>\s*$/);
    files.push({
      name: m[1]!,
      id: m[2]!.trim(),
      mimeType: m[3]!.trim(),
      size: m[4] ? Number(m[4]) : undefined,
      created: m[5],
      modified: m[6]!,
      lastEditedByName: who ? who[1] : m[7]?.trim() || undefined,
      lastEditedByEmail: who?.[2]?.toLowerCase(),
      link: m[8],
    });
  }
  const tok = text.match(/^nextPageToken:\s*(\S+)/m);
  return { files, nextPageToken: tok?.[1] };
}

// ------------------------------------------------------------------ Slides

export interface ParsedSlide {
  n: number;
  objectId: string;
  elementCount: number;
  lines: string[];
}

export function parsePresentation(text: string): { title?: string; totalSlides?: number; slides: ParsedSlide[] } {
  const title = text.match(/^- Title:\s*(.*)$/m)?.[1]?.trim();
  const total = text.match(/^- Total Slides:\s*(\d+)/m)?.[1];
  const slides: ParsedSlide[] = [];
  let cur: ParsedSlide | null = null;
  for (const line of text.split('\n')) {
    const h = line.match(/^\s*Slide (\d+): ID (\S+), (\d+) element\(s\), text:\s*(.*)$/);
    if (h) {
      cur = { n: Number(h[1]), objectId: h[2]!, elementCount: Number(h[3]), lines: [] };
      slides.push(cur);
      if (h[4]) cur.lines.push(h[4]);
      continue;
    }
    const t = line.match(/^\s*> ?(.*)$/);
    if (t && cur) cur.lines.push(t[1]!);
  }
  if (slides.length === 0 && total && Number(total) > 0) throw new ParseDrift('slides.presentation', 'Total Slides > 0 but no slides parsed');
  return { title, totalSlides: total ? Number(total) : undefined, slides };
}

// ------------------------------------------------------------------ Docs

export interface DocSection {
  heading: string;
  level: number;
  text: string;
}

/** Splits markdown into sections at ATX headings. `cutAtTranscript` drops everything from `# Transcript`. */
export function parseDocSections(markdown: string, cutAtTranscript = true): DocSection[] {
  let md = markdown;
  if (cutAtTranscript) {
    const i = md.search(/^# Transcript\s*$/m);
    if (i >= 0) md = md.slice(0, i);
  }
  const sections: DocSection[] = [];
  let cur: DocSection = { heading: '', level: 0, text: '' };
  let inFence = false;
  for (const line of md.split('\n')) {
    if (/^```/.test(line)) inFence = !inFence;
    const h = !inFence ? line.match(/^(#{1,6})\s+(.*)$/) : null;
    if (h) {
      if (cur.heading || cur.text.trim()) sections.push(cur);
      cur = { heading: h[2]!.trim(), level: h[1]!.length, text: '' };
    } else cur.text += line + '\n';
  }
  if (cur.heading || cur.text.trim()) sections.push(cur);
  return sections.map((s) => ({ ...s, text: s.text.trim() }));
}

// ------------------------------------------------------------------ Sheets

/** `get_spreadsheet_info` lists `  - "Tab name" (ID: 123) | Size: 1007x24 | …` under `Sheets (n):`. */
export function parseSpreadsheetSheets(text: string): Array<{ name: string; size?: string }> {
  const out: Array<{ name: string; size?: string }> = [];
  for (const m of text.matchAll(/^\s*-\s*"([^"]+)"\s*\(ID:\s*\d+\)(?:\s*\|\s*Size:\s*(\S+))?/gm)) out.push({ name: m[1]!, size: m[2] });
  return out;
}
