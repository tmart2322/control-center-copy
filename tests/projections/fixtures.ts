/**
 * Placeholder source items shaped like the real fetchers' and the scan-org62 skill's (ACME / Globex / Initech,
 * example.com addresses, 001/005/006 PLACEHOLDER ids). No real names, ids or amounts.
 */
import type { DomainRules, Me, SourceRow } from '@/projections/types';

export const TZ = 'America/Denver';
export const ME: Me = { userId: 'u1', personId: 'p1', name: 'Ada Example', email: 'ada@corp.example', org62UserId: '005XX0000000001AAA', slackUserId: 'U0PLACEHOLD', timezone: TZ };
export const RULES: DomainRules = { internal: ['corp.example'], partner: ['partner.example'], ignore: ['resource.calendar.google.com'] };

export const ACCT_ACME = '001XX0000000001AAA';
export const ACCT_GLOBEX = '001XX0000000002AAA';
export const OPP_ACME = '006XX0000000001AAA';
export const OPP_ACME_2 = '006XX0000000003AAA';
export const OPP_GLOBEX = '006XX0000000002AAA';

let n = 0;
export function row(p: Partial<SourceRow> & Pick<SourceRow, 'source' | 'kind' | 'externalId' | 'dedupeKey'>): SourceRow {
  n++;
  return {
    id: p.id ?? `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    externalParentId: null,
    externalContainerId: null,
    occurredAt: '2026-11-05T15:00:00.000Z',
    title: null,
    url: null,
    body: null,
    meta: {},
    fromMe: false,
    deletedUpstreamAt: null,
    changedAt: '2026-11-05T15:00:00.000Z',
    ...p,
  };
}

/** A Calendar fetcher item (`cal:<eventId>`), today 09:00–10:00 Denver unless overridden. */
export function calItem(eventId: string, o: { title?: string; start?: string; end?: string; myResponse?: string; organizer?: string; attendees?: { email: string; response?: string }[]; attendance?: string; ended?: boolean; allDay?: boolean; changedAt?: string; attachments?: unknown[] } = {}): SourceRow {
  const start = o.start ?? '2026-11-05T16:00:00.000Z';
  const end = o.end ?? '2026-11-05T17:00:00.000Z';
  const attendees = o.attendees ?? [
    { email: ME.email, response: o.myResponse ?? 'accepted' },
    { email: 'dana@acme.example', response: 'accepted' },
  ];
  return row({
    source: 'calendar',
    kind: 'calendar_event',
    externalId: eventId,
    dedupeKey: `cal:${eventId}`,
    externalContainerId: 'primary',
    externalParentId: `calendar:${eventId}`,
    occurredAt: start,
    title: o.title ?? 'ACME discovery',
    url: `https://calendar.example/event?eid=${eventId}`,
    changedAt: o.changedAt ?? '2026-11-05T15:00:00.000Z',
    meta: {
      eventId,
      start,
      end,
      allDay: o.allDay ?? false,
      meetingLink: 'https://meet.example/abc',
      organizerEmail: o.organizer ?? 'dana@acme.example',
      iAmOrganizer: (o.organizer ?? 'dana@acme.example') === ME.email,
      responses: attendees.map((a) => ({ email: a.email, response: a.response ?? 'needsAction', optional: false, organizer: a.email === (o.organizer ?? 'dana@acme.example') })),
      participants: attendees.map((a) => ({ email: a.email, isMe: a.email === ME.email })),
      myResponse: o.myResponse ?? 'accepted',
      attendance: o.attendance ?? 'upcoming',
      ended: o.ended ?? false,
      attachments: o.attachments ?? [],
      itemKind: 'calendar_event',
      connector: 'calendar',
    },
  });
}

export function cancelItem(eventId: string, start: string, changedAt: string): SourceRow {
  return row({
    source: 'calendar',
    kind: 'calendar_event',
    externalId: eventId,
    dedupeKey: `cal:${eventId}:cancelled`,
    externalContainerId: 'primary',
    occurredAt: changedAt,
    title: '(cancelled event)',
    changedAt,
    meta: { eventId, status: 'cancelled', start },
  });
}

/** A scan-org62 record snapshot as the agent records it (payload → meta, excerpt → body). */
export function org62Item(externalId: string, o: { title?: string; meta?: Record<string, unknown>; body?: string; accountHints?: string[]; oppHints?: string[]; changedAt?: string } = {}): SourceRow {
  return row({
    source: 'org62',
    kind: 'org62_record_snapshot',
    externalId,
    dedupeKey: `org62:${externalId}`,
    title: o.title ?? null,
    body: o.body ?? null,
    occurredAt: externalId.split('@')[1]?.replace('+0000', 'Z') ?? '2026-11-05T15:00:00.000Z',
    changedAt: o.changedAt ?? '2026-11-05T15:00:00.000Z',
    meta: { ...(o.meta ?? {}), accountHints: o.accountHints ?? [], oppHints: o.oppHints ?? [], connector: 'org62' },
  });
}

export function sessionItem(sessionId: string, o: { status?: string; waitingFor?: string; title?: string; cwd?: string; startedAt?: string; lastActivityAt?: string; lastHumanPromptAt?: string; ccTag?: string; body?: string } = {}): SourceRow {
  return row({
    source: 'claude',
    kind: 'claude_session',
    externalId: sessionId,
    dedupeKey: `claude:${sessionId}`,
    title: o.title ?? 'Build ACME demo',
    body: o.body ?? 'first prompt text\n\nBuilt the demo flow and pushed it.',
    occurredAt: o.lastActivityAt ?? '2026-11-05T15:30:00.000Z',
    meta: {
      sessionId,
      hostSessionId: `local_${sessionId}`,
      status: o.status ?? 'done',
      waitingFor: o.waitingFor,
      title: o.title ?? 'Build ACME demo',
      cwd: o.cwd ?? '/Users/example/Projects/client-demos/acme-demo',
      repo: 'acme-demo',
      branch: 'main',
      startedAt: o.startedAt ?? '2026-11-05T14:00:00.000Z',
      lastActivityAt: o.lastActivityAt ?? '2026-11-05T15:30:00.000Z',
      lastHumanPromptAt: o.lastHumanPromptAt ?? '2026-11-05T15:20:00.000Z',
      humanPromptCount: 4,
      filesTouchedCount: 3,
      backgroundAgents: 0,
      costUsd: 1.2345678,
      ...(o.ccTag ? { ccTag: { id: o.ccTag, source: 'first_prompt' } } : {}),
    },
  });
}

export function driveItem(fileId: string, modifiedTime: string, o: { title?: string; byMe?: boolean; kind?: string } = {}): SourceRow {
  return row({
    source: 'drive',
    kind: 'drive_file_revision',
    externalId: `${fileId}@${modifiedTime}`,
    dedupeKey: `drive:${fileId}@${modifiedTime}`,
    occurredAt: modifiedTime,
    title: o.title ?? 'ACME POV deck',
    fromMe: o.byMe ?? true,
    url: `https://docs.google.com/presentation/d/${fileId}/edit`,
    meta: { fileId, fileKind: o.kind ?? 'slides', modifiedTime, lastModifyingUser: o.byMe === false ? { name: 'Sam Example', email: 'sam@corp.example' } : { name: ME.name, email: ME.email, isMe: true }, editedByMe: o.byMe ?? true },
  });
}

export function geminiItem(docId: string, eventId: string, mine = 2, others = 1): SourceRow {
  return row({
    source: 'gemini_notes',
    kind: 'gemini_note',
    externalId: docId,
    dedupeKey: `gemini:${docId}`,
    externalParentId: `calendar:${eventId}`,
    title: 'ACME discovery',
    url: `https://docs.google.com/document/d/${docId}/edit`,
    occurredAt: '2026-11-05T17:00:00.000Z',
    meta: { eventId, myNextSteps: Array.from({ length: mine }, (_, i) => ({ title: `Mine ${i}` })), othersNextSteps: Array.from({ length: others }, (_, i) => ({ title: `Other ${i}` })) },
  });
}
