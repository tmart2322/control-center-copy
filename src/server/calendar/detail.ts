/**
 * Meeting details both DataSources share: the agenda text from an invite's stored body, the conference link
 * found in text, invite attachments as links, and the single-event payload (GET /calendar/events/:id).
 *
 * Text here is the invite's description as ingest stored it: already redacted (credential-like strings replaced),
 * at most ~2,000 characters. It may be HTML (Google invites often are); `agendaText` turns it into plain text, so
 * the UI only ever renders text (links are detected there, never injected as markup).
 */
import type { CalendarEvent, CalendarEventDetail, EventAttachment, EventPrepItem, ReadIn, WorkItem } from '@/contract';
import { handsOnMin } from '@/engines/home/estimate';
import { driveUrl, kindFromMime } from '@/projections/assets';

/** Longest agenda kept (the fetcher stores ≤ 2,000 characters; HTML-to-text only shortens it). */
export const AGENDA_MAX = 2_000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k in ENTITIES) return ENTITIES[k]!;
    if (k.startsWith('#x')) return safeChar(parseInt(k.slice(2), 16), m);
    if (k.startsWith('#')) return safeChar(parseInt(k.slice(1), 10), m);
    return m;
  });
}

function safeChar(code: number, fallback: string): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return fallback;
  // control characters other than tab and newline never reach the text
  if (code < 0x20 && code !== 9 && code !== 10) return ' ';
  return String.fromCodePoint(code);
}

/** Google's own "Join with Google Meet" footer starts after this divider: it repeats the join link. */
const MEET_DIVIDER = /^-::~[:~]+::-$/;

/**
 * An invite description → plain text: tags dropped (one line per block, list items as "• "), a link written as its
 * label plus its address when they differ, entities decoded, blank runs collapsed, Google's Meet footer cut. Plain
 * text comes back unchanged apart from whitespace. Never returns markup meant to be rendered as HTML.
 */
export function agendaText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.replace(/\r\n?/g, '\n');
  // HTML spacing comes from its blocks, not from blank lines: one line per block; plain text keeps its paragraphs
  const html = /<[a-z/!][^>]*>/i.test(s);
  if (html) {
    s = s
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, _q: string, href: string, label: string) => {
        const text = decodeEntities(label.replace(/<[^>]*>/g, '')).trim();
        const url = decodeEntities(href.trim());
        if (!text) return url;
        return text === url || text.includes(url) || !/^(https?:|mailto:)/i.test(url) ? text : `${text} (${url})`;
      })
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|table|blockquote)\s*>/gi, '\n')
      .replace(/<(p|div|ul|ol|h[1-6]|tr|table|blockquote)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, '');
  }
  s = decodeEntities(s);
  const lines: string[] = [];
  for (const line of s.split('\n')) {
    const t = line.replace(/[ \t\u00a0]+/g, ' ').trim();
    if (MEET_DIVIDER.test(t)) break;
    lines.push(t);
  }
  const text = lines
    .join('\n')
    .replace(html ? /\n{2,}/g : /\n{3,}/g, html ? '\n' : '\n\n')
    .trim();
  if (!text) return null;
  return text.length > AGENDA_MAX ? `${text.slice(0, AGENDA_MAX - 1).trimEnd()}…` : text;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The agenda inside a calendar source item's body. Ingest stores the excerpt ("<title> - <description…>", one line)
 * and then, after a blank line, the description itself; an invite without a description stores the excerpt alone.
 */
export function agendaFromBody(body: string | null | undefined, title: string | null | undefined): string | null {
  if (!body) return null;
  const t = squash(title ?? '');
  const cut = body.indexOf('\n\n');
  if (cut >= 0) {
    const head = body.slice(0, cut);
    const isExcerpt = !head.includes('\n') && (!t || squash(head).startsWith(t));
    return agendaText(isExcerpt ? body.slice(cut + 2) : body);
  }
  // One paragraph: the excerpt of an invite with no description (it starts with the title), else the description.
  if (t && squash(body).startsWith(t)) return null;
  return agendaText(body);
}

const CONFERENCE_HOST = /(^|\.)(zoom\.us|zoomgov\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|chime\.aws|gotomeeting\.com|whereby\.com)$/i;
const URL_IN_TEXT = /\bhttps:\/\/[^\s<>"'()[\]]+/gi;

/** The first conference link (Zoom, Meet, Teams, Webex, …) in these texts, in order; null when there is none. */
export function conferenceLinkIn(...texts: Array<string | null | undefined>): string | null {
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(URL_IN_TEXT)) {
      const url = m[0].replace(/[.,;:!?]+$/, '');
      try {
        if (CONFERENCE_HOST.test(new URL(url).hostname)) return url;
      } catch {
        /* not a URL */
      }
    }
  }
  return null;
}

/** Invite attachments as ingest stored them (`{title, fileId, mimeType}`) → titled links. */
export function attachmentsFromMeta(v: unknown): EventAttachment[] {
  if (!Array.isArray(v)) return [];
  const out: EventAttachment[] = [];
  for (const a of v) {
    if (!a || typeof a !== 'object') continue;
    const o = a as Record<string, unknown>;
    const fileId = typeof o.fileId === 'string' && o.fileId ? o.fileId : null;
    const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : fileId ? 'Attachment' : '';
    if (!title) continue;
    const kind = kindFromMime(typeof o.mimeType === 'string' ? o.mimeType : null);
    out.push({ title, url: fileId ? driveUrl(fileId, kind) : null, kind });
  }
  return out;
}

const LIVE = new Set<WorkItem['state']>(['open', 'in_progress', 'waiting_on_me', 'waiting_on_others', 'likely_done', 'reopened']);
const READY = new Set<WorkItem['state']>(['done', 'likely_done']);

type PrepSource = Pick<WorkItem, 'id' | 'title' | 'state' | 'kind' | 'effort'> & { servesEventId?: string | null };

/**
 * The work items that serve a meeting: the invite's prep item first, then live ones, then done ones (title order).
 * The same set the meeting panel's Prep section lists (open + done items with `servesEventId`).
 */
export function prepItemsFor(ev: Pick<CalendarEvent, 'id' | 'prep'>, items: readonly PrepSource[]): EventPrepItem[] {
  const prepId = ev.prep?.workItemId ?? null;
  const rank = (i: PrepSource) => (i.id === prepId ? 0 : i.state === 'done' ? 2 : 1);
  return items
    .filter((i) => (i.servesEventId === ev.id || i.id === prepId) && (LIVE.has(i.state) || i.state === 'done'))
    .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
    .map((i) => ({ id: i.id, title: i.title, state: i.state, youMin: READY.has(i.state) ? 0 : handsOnMin(i) }));
}

export interface EventDetailInput {
  items: readonly PrepSource[];
  account: { id: string; name: string } | null | undefined;
  opp: { id: string; name: string; stage?: string | null } | null | undefined;
  readIn: Pick<ReadIn, 'state' | 'tldr' | 'generatedAt'> | null | undefined;
}

/** GET /calendar/events/:id from an event and what both DataSources hold beside it. */
export function eventDetail(ev: CalendarEvent, x: EventDetailInput): CalendarEventDetail {
  return {
    event: ev,
    prep: prepItemsFor(ev, x.items),
    account: x.account ? { id: x.account.id, name: x.account.name } : null,
    opp: x.opp ? { id: x.opp.id, name: x.opp.name, stage: x.opp.stage ?? null } : null,
    readIn: x.readIn ? { state: x.readIn.state, tldr: x.readIn.tldr, generatedAt: x.readIn.generatedAt } : null,
  };
}
