/**
 * Meeting details (hover card, meeting panel): the additive contract fields, the shared text helpers both
 * DataSources use (agenda from the stored body, HTML to text, the conference link, attachments, prep items), and
 * GET /calendar/events/:id on the mock through the generated route handler. Placeholder data only.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ApiErrorEnvelope, CalendarEvent, CalendarEventDetail, EventAttendee, routes, type WorkItem } from '@/contract';
import { resetDataSourceForTests } from '@/server/datasource';
import { AGENDA_MAX, agendaFromBody, agendaText, attachmentsFromMeta, conferenceLinkIn, eventDetail, prepItemsFor } from '@/server/calendar/detail';
import * as eventRoute from '../../app/api/v1/calendar/events/[id]/route';

const base = 'http://localhost/api/v1';
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

afterEach(() => resetDataSourceForTests());

const OLD_SHAPE = {
  id: 'ev_1',
  title: 'ACME review',
  start: '2026-11-05T20:00:00.000Z',
  end: '2026-11-05T21:00:00.000Z',
  attendance: 'upcoming',
  attendees: [{ id: 'p_dana', name: 'Dana Reyes', isExternal: true }],
  source: { kind: 'calendar', label: 'Google Calendar' },
};

describe('contract: CalendarEvent details (additive)', () => {
  it('an event without the new fields parses with defaults: no agenda, no organizer, no attachments, attendees as they were', () => {
    const ev = CalendarEvent.parse(OLD_SHAPE);
    expect(ev.agenda).toBeNull();
    expect(ev.organizer).toBeNull();
    expect(ev.attachments).toEqual([]);
    expect(ev.attendees).toEqual([{ id: 'p_dana', name: 'Dana Reyes', isExternal: true }]);
  });

  it('attendees carry their answer, optional and organizer flags; the organizer and attachments get defaults', () => {
    const ev = CalendarEvent.parse({
      ...OLD_SHAPE,
      attendees: [{ id: 'p_dana', name: 'Dana Reyes', isExternal: true, response: 'accepted', organizer: true }, { id: 'p_raj', name: 'Raj Mehta', response: 'needs_action', optional: true }],
      organizer: { name: 'Dana Reyes', personId: 'p_dana', isExternal: true },
      attachments: [{ title: 'Demo script', url: 'https://docs.example.com/script' }],
    });
    expect(ev.attendees[1]).toEqual({ id: 'p_raj', name: 'Raj Mehta', response: 'needs_action', optional: true });
    expect(ev.organizer).toEqual({ name: 'Dana Reyes', personId: 'p_dana', isMe: false, isExternal: true });
    expect(ev.attachments).toEqual([{ title: 'Demo script', url: 'https://docs.example.com/script', kind: 'other' }]);
    expect(EventAttendee.safeParse({ id: 'p', name: 'P', response: 'maybe' }).success).toBe(false);
  });

  it('GET /calendar/events/:id is a calendar read answering CalendarEventDetail', () => {
    const r = routes.getCalendarEvent;
    expect([r.method, r.path, r.topic]).toEqual(['GET', '/calendar/events/:id', 'calendar']);
    expect(r.response).toBe(CalendarEventDetail);
  });
});

describe('agendaText: an invite description as plain text', () => {
  it('leaves plain text alone (whitespace aside)', () => {
    expect(agendaText('Goals\n\n  Timeline  \r\nNext steps')).toBe('Goals\n\nTimeline\nNext steps');
    expect(agendaText('')).toBeNull();
    expect(agendaText('   \n ')).toBeNull();
    expect(agendaText(null)).toBeNull();
  });

  it('turns HTML into lines: list items, links with their address, entities decoded, one line per block', () => {
    const html = '<p>Agenda:</p><ul><li>Scope &amp; timeline</li><li>Open <b>questions</b></li></ul><a href="https://docs.example.com/a?x=1&amp;y=2">Review doc</a><br><a href="https://docs.example.com/b">https://docs.example.com/b</a>';
    expect(agendaText(html)).toBe('Agenda:\n• Scope & timeline\n• Open questions\nReview doc (https://docs.example.com/a?x=1&y=2)\nhttps://docs.example.com/b');
  });

  it('drops scripts, styles, comments and tags; markup-looking entities stay text; cuts Google’s Meet footer', () => {
    expect(agendaText('<script>alert(1)</script><style>p{}</style><!-- note -->Hello<br>World')).toBe('Hello\nWorld');
    expect(agendaText('Use &lt;b&gt; for bold &#39;quoted&#39; &#x2014; done')).toBe("Use <b> for bold 'quoted' — done");
    expect(agendaText('Agenda<br>-::~:~::~:~:~:~:~:~::~:~::-<br>Join with Google Meet: https://meet.example/abc')).toBe('Agenda');
  });

  it('clips at the agenda limit', () => {
    const t = agendaText('x'.repeat(AGENDA_MAX + 50))!;
    expect(t.length).toBe(AGENDA_MAX);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('agendaFromBody: the agenda inside a stored calendar body', () => {
  it('skips the one-line excerpt ingest puts before the description', () => {
    expect(agendaFromBody('ACME review - Goals Timeline\n\nGoals\nTimeline', 'ACME review')).toBe('Goals\nTimeline');
    // the excerpt is compared without case or spacing
    expect(agendaFromBody('acme  REVIEW - Goals\n\n<p>Goals</p>', 'ACME review')).toBe('Goals');
  });

  it('an invite with no description stored only its excerpt: no agenda', () => {
    expect(agendaFromBody('ACME review', 'ACME review')).toBeNull();
    expect(agendaFromBody(null, 'ACME review')).toBeNull();
  });

  it('a body that does not start with the excerpt is all agenda', () => {
    expect(agendaFromBody('Goals\nTimeline\n\nNotes', 'ACME review')).toBe('Goals\nTimeline\n\nNotes');
    expect(agendaFromBody('Untitled agenda', '')).toBe('Untitled agenda');
  });
});

describe('conferenceLinkIn, attachmentsFromMeta', () => {
  it('finds the first Zoom, Meet, Teams or Webex link, in the order given; other links are not join links', () => {
    expect(conferenceLinkIn('Room 4', 'Join: https://acme.zoom.us/j/123?pwd=x. Thanks')).toBe('https://acme.zoom.us/j/123?pwd=x');
    expect(conferenceLinkIn('https://teams.microsoft.com/l/meetup-join/abc', 'https://meet.google.com/abc-defg-hij')).toBe('https://teams.microsoft.com/l/meetup-join/abc');
    expect(conferenceLinkIn('Deck: https://docs.example.com/deck', null, undefined)).toBeNull();
    expect(conferenceLinkIn('https://evil.example/zoom.us')).toBeNull();
  });

  it('turns stored attachments into titled links by file kind; no file id means no link; junk is skipped', () => {
    expect(
      attachmentsFromMeta([
        { title: 'Review deck', fileId: 'F1', mimeType: 'application/vnd.google-apps.presentation' },
        { title: 'Notes', fileId: 'F2', mimeType: 'application/vnd.google-apps.document' },
        { title: 'Budget', fileId: 'F3', mimeType: 'application/vnd.google-apps.spreadsheet' },
        { title: 'Contract.pdf', fileId: 'F4', mimeType: 'application/pdf' },
        { title: 'Loose file' },
        { fileId: 'F5' },
        null,
        'x',
        { title: '  ' },
      ]),
    ).toEqual([
      { title: 'Review deck', url: 'https://docs.google.com/presentation/d/F1/edit', kind: 'deck' },
      { title: 'Notes', url: 'https://docs.google.com/document/d/F2/edit', kind: 'doc' },
      { title: 'Budget', url: 'https://docs.google.com/spreadsheets/d/F3/edit', kind: 'sheet' },
      { title: 'Contract.pdf', url: 'https://drive.google.com/file/d/F4/view', kind: 'pdf' },
      { title: 'Loose file', url: null, kind: 'other' },
      { title: 'Attachment', url: 'https://drive.google.com/file/d/F5/view', kind: 'other' },
    ]);
    expect(attachmentsFromMeta(undefined)).toEqual([]);
  });
});

describe('prepItemsFor, eventDetail', () => {
  const it_ = (id: string, state: WorkItem['state'], servesEventId: string | null, title = `Task ${id}`): Pick<WorkItem, 'id' | 'title' | 'state' | 'kind' | 'effort' | 'servesEventId'> => ({ id, title, state, kind: 'task', effort: { youMin: 20, agentMin: 0 }, servesEventId });
  const ev = CalendarEvent.parse({ ...OLD_SHAPE, prep: { ready: false, label: 'demo ›', workItemId: 'w_prep' } });

  it('lists the prep item first, then live items, then done ones; suggested, snoozed and dismissed are not prep', () => {
    const items = [it_('w_done', 'done', 'ev_1', 'A done'), it_('w_b', 'open', 'ev_1', 'B open'), it_('w_prep', 'in_progress', null, 'Z prep'), it_('w_a', 'likely_done', 'ev_1', 'A likely'), it_('w_sug', 'suggested', 'ev_1'), it_('w_snz', 'snoozed', 'ev_1'), it_('w_dis', 'dismissed', 'ev_1'), it_('w_other', 'open', 'ev_2')];
    const out = prepItemsFor(ev, items);
    expect(out.map((p) => p.id)).toEqual(['w_prep', 'w_a', 'w_b', 'w_done']);
    expect(out.find((p) => p.id === 'w_done')!.youMin).toBe(0);
    expect(out.find((p) => p.id === 'w_a')!.youMin).toBe(0);
    expect(out.find((p) => p.id === 'w_b')!.youMin).toBeGreaterThan(0);
  });

  it('names the account and opp, and keeps only the read-in state', () => {
    const d = eventDetail(ev, { items: [], account: { id: 'acc', name: 'ACME Corp', extra: 1 } as never, opp: { id: 'opp', name: 'ACME · Phase 2', stage: 'Validation' }, readIn: { state: 'ready', tldr: 'Scope moved', generatedAt: '2026-11-05T15:00:00.000Z' } });
    expect(CalendarEventDetail.parse(d)).toEqual(d);
    expect(d.account).toEqual({ id: 'acc', name: 'ACME Corp' });
    expect(d.opp).toEqual({ id: 'opp', name: 'ACME · Phase 2', stage: 'Validation' });
    expect(d.readIn).toEqual({ state: 'ready', tldr: 'Scope moved', generatedAt: '2026-11-05T15:00:00.000Z' });
    expect(eventDetail(ev, { items: [], account: null, opp: undefined, readIn: null })).toMatchObject({ account: null, opp: null, readIn: null, prep: [] });
  });
});

describe('GET /calendar/events/:id (mock, through the route handler)', () => {
  it('answers one meeting with its agenda, organizer, answers, attachments, prep items, account and opp', async () => {
    const res = await eventRoute.GET(new Request(`${base}/calendar/events/ev_acme_demo`), ctx({ id: 'ev_acme_demo' }));
    expect(res.status).toBe(200);
    const d = CalendarEventDetail.parse(await res.json());
    expect(d.event.id).toBe('ev_acme_demo');
    expect(d.event.agenda).toContain('Headless portal walkthrough');
    expect(d.event.organizer).toEqual({ name: 'Dana Reyes', personId: 'p_dana', isMe: false, isExternal: true });
    expect(d.event.attendees.map((a) => [a.id, a.response, !!a.organizer, !!a.isExternal])).toEqual([
      ['p_dana', 'accepted', true, true],
      ['p_raj', 'tentative', false, false],
    ]);
    expect(d.event.attachments).toEqual([{ title: 'ACME Phase 2 demo script', url: 'https://docs.example.com/acme-demo-script', kind: 'doc' }]);
    expect(d.event.meetingUrl).toBe('https://meet.example.com/acme');
    // the prep item first (the ribbon's itemId), then the other items that serve the demo
    expect(d.prep[0]!.id).toBe('w_acme_build');
    expect(d.prep.map((p) => p.id)).toContain('w_dana_reply');
    expect(d.account?.name).toBe('ACME Corp');
    expect(d.opp?.id).toBe('opp_acme_p2');
  });

  it('404s an unknown meeting with the error envelope', async () => {
    const res = await eventRoute.GET(new Request(`${base}/calendar/events/ev_nope`), ctx({ id: 'ev_nope' }));
    expect(res.status).toBe(404);
    expect(ApiErrorEnvelope.parse(await res.json()).error.code).toBe('not_found');
  });

  it('my own meeting says so; a guest who has not answered says no answer', async () => {
    const res = await eventRoute.GET(new Request(`${base}/calendar/events/ev_umbrella`), ctx({ id: 'ev_umbrella' }));
    const d = CalendarEventDetail.parse(await res.json());
    expect(d.event.organizer).toMatchObject({ isMe: true, personId: null });
    expect(d.event.attendees[0]).toMatchObject({ id: 'p_alice', response: 'needs_action' });
    expect(d.event.attachments[0]).toMatchObject({ kind: 'deck' });
  });
});
