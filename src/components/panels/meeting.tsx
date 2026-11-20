'use client';
/**
 * The meeting hover card (Home's ribbon, Today's spine) and the pieces it shares with the meeting panel.
 *
 *   <MeetingHover eventId initial?>  wraps a meeting block: after a short hover or focus it shows the card; the data
 *                                    (GET /calendar/events/:id) is fetched the moment hover starts. Never blocks the
 *                                    block's own click (the click opens the meeting panel and closes the card).
 *   <MeetingCard>                    time and length, title, account · opp, who's coming (count, key external
 *                                    people, my answer, everyone's answers when not all are named), join link, prep
 *                                    state, read-in state, the agenda's first lines.
 *   <AgendaText>                     the agenda as text with clickable links: text nodes and anchors only, never HTML.
 *
 * Color marks state only: prep not ready (warning), ready (success), now (brand). Everything else is neutral.
 */
import { useMemo, useState, type ReactElement } from 'react';
import type { CalendarEvent, CalendarEventDetail } from '@/contract';
import { useApi } from '@/client/hooks';
import { clock } from '@/components/domain/lib/time';
import { cn, HoverCard, Skeleton, useNow, useTimeZone } from '@/ui';
import { agendaLines, answersLine, durationLabel, eventPhase, eventWhen, guestSummary, linkParts, myAnswer, prepChecks, prepLine, readInLine, responseWord, type PrepCheck } from './derive';

/** Hover cards keep their data this long before refetching on the next hover. */
const CARD_STALE_MS = 30_000;

/** The agenda (plain text) with its links clickable. `lines` caps how many lines show. */
export function AgendaText({ text, className, lines }: { text: string; className?: string; lines?: number }) {
  const shown = lines ? text.split('\n').slice(0, lines).join('\n') : text;
  const parts = useMemo(() => linkParts(shown), [shown]);
  return (
    <p className={cn('min-w-0 break-words whitespace-pre-line text-body text-fg', className)} data-agenda>
      {parts.map((p, i) =>
        'href' in p ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="text-link underline-offset-2 hover:underline">
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}

/** Prep checks from the detail payload (the items that serve the meeting), as the panel computes them. */
export function detailChecks(ev: CalendarEvent, d: CalendarEventDetail | undefined): PrepCheck[] {
  if (!d) return [];
  const youMin = new Map(d.prep.map((p) => [p.id, p.youMin]));
  return prepChecks(
    ev,
    d.prep.map((p) => ({ ...p, servesEventId: ev.id })),
    (id) => youMin.get(id) ?? 0,
  );
}

export function MeetingCard({ ev, detail, loading }: { ev: CalendarEvent; detail?: CalendarEventDetail; loading?: boolean }) {
  const now = useNow(30_000).toISOString();
  const tz = useTimeZone();
  const phase = eventPhase(ev, now);
  const guests = guestSummary(ev);
  // each named guest shows their own answer; the tally covers the ones under "+N more"
  const answers = guests.count > guests.key.length ? answersLine(guests.answers) : null;
  const prep = detail ? prepLine(detailChecks(ev, detail)) : null;
  const readIn = detail ? readInLine(detail.readIn) : null;
  const agenda = agendaLines(ev.agenda, 3);
  const where = [detail?.account?.name, detail?.opp?.name].filter(Boolean).join(' · ');
  const span = `${clock(ev.start, tz)}–${clock(ev.end, tz)} · ${durationLabel(ev.start, ev.end)}`;
  const when =
    phase === 'now' ? `● now, until ${clock(ev.end, tz)}` : phase === 'soon' || phase === 'later' ? eventWhen(ev, now, tz).replace(/^.*· /, '') : phase === 'off' ? (ev.attendance === 'declined' ? 'declined' : 'cancelled') : ev.attendance === 'missed' ? 'missed' : 'ended';
  const join = ev.meetingUrl && phase !== 'past' && phase !== 'off' ? ev.meetingUrl : null;
  const organizerLine = ev.organizer && !ev.organizer.isMe && !ev.attendees.some((p) => p.organizer) ? `Organizer: ${ev.organizer.name}` : null;
  return (
    <div className="flex min-w-0 flex-col gap-2" data-meeting-card={ev.id} data-phase={phase}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="flex min-w-0 items-baseline gap-1.5 text-caption text-muted tabular-nums">
          <span className="shrink-0">{span}</span>
          <span aria-hidden>·</span>
          <span className={cn('min-w-0 truncate', phase === 'now' ? 'font-bold text-brand-700' : null)} data-card-when>
            {when}
          </span>
        </p>
        <p className="min-w-0 text-body font-bold text-fg-heading" data-card-title>
          {ev.title}
        </p>
        {where ? (
          <p className="min-w-0 truncate text-caption text-muted" data-card-where>
            {where}
          </p>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-1 text-caption" data-card-people>
        <p className="min-w-0 text-fg">
          {guests.count ? `${guests.count} ${guests.count === 1 ? 'guest' : 'guests'}${guests.external ? ` · ${guests.external} external` : ''}` : 'Just you'}
          <span className="text-muted"> · {myAnswer(ev)}</span>
        </p>
        {answers ? (
          <p className="min-w-0 truncate text-muted tabular-nums" data-card-answers>
            {answers}
          </p>
        ) : null}
        {guests.key.length ? (
          <ul className="flex min-w-0 flex-col">
            {guests.key.map((p) => (
              <li key={p.id} className="flex min-w-0 items-baseline gap-1.5" data-card-person={p.id}>
                <span className="min-w-0 shrink-0 truncate text-fg">{p.name}</span>
                <span className="min-w-0 truncate text-muted">{[p.organizer ? 'organizer' : null, p.isExternal ? 'external' : null, responseWord(p.response)].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
            {guests.count > guests.key.length ? <li className="text-muted">+{guests.count - guests.key.length} more</li> : null}
          </ul>
        ) : null}
        {organizerLine ? <p className="min-w-0 truncate text-muted">{organizerLine}</p> : null}
      </div>

      <div className="flex min-w-0 flex-col gap-1 text-caption">
        {loading && !detail ? (
          <Skeleton variant="line" count={2} />
        ) : (
          <>
            <p className={cn('min-w-0', prep ? (prep.ready ? 'text-success-700' : 'text-warning-700') : 'text-muted')} data-card-prep={prep ? (prep.ready ? 'ready' : 'todo') : 'none'}>
              {prep ? `${prep.ready ? '✓' : '○'} ${prep.label}` : 'No prep linked'}
            </p>
            <p className="min-w-0 truncate text-muted" data-card-readin={detail?.readIn?.state ?? 'none'}>
              ✦ {readIn ? (readIn.tldr ? `${readIn.label}: ${readIn.tldr}` : readIn.label) : 'No read-in yet'}
            </p>
          </>
        )}
      </div>

      {agenda.lines.length ? (
        <div className="min-w-0 border-t border-line pt-2" data-card-agenda>
          <AgendaText text={agenda.lines.join('\n')} className="text-caption" />
          {agenda.more ? <p className="text-caption text-muted">…</p> : null}
        </div>
      ) : null}

      <div className="flex min-w-0 items-center justify-between gap-3 border-t border-line pt-2 text-caption">
        {join ? (
          <a href={join} target="_blank" rel="noopener noreferrer" className="font-bold text-link hover:underline" data-card-join>
            Join ↗
          </a>
        ) : (
          <span />
        )}
        <span className="text-muted">Click for the meeting</span>
      </div>
    </div>
  );
}

/** Wraps a meeting block with the hover card. `initial` renders at once (the spine already has the event). */
export function MeetingHover({ eventId, initial, title, children, disabled }: { eventId: string; initial?: CalendarEvent; title?: string; children: ReactElement; disabled?: boolean }) {
  const [want, setWant] = useState(false);
  const q = useApi('getCalendarEvent', { params: { id: eventId } }, { enabled: want, staleTime: CARD_STALE_MS });
  const ev = q.data?.event ?? initial;
  return (
    <HoverCard
      disabled={disabled}
      onIntent={() => setWant(true)}
      label={`Meeting: ${ev?.title ?? title ?? 'details'}`}
      content={() =>
        ev ? (
          <MeetingCard ev={ev} detail={q.data} loading={q.isLoading} />
        ) : q.isError ? (
          <p className="text-caption text-muted">Couldn’t load this meeting. Click to open it.</p>
        ) : (
          <div className="flex flex-col gap-2" data-meeting-card-loading>
            {title ? <p className="text-body font-bold text-fg-heading">{title}</p> : null}
            <Skeleton variant="line" count={3} />
          </div>
        )
      }
    >
      {children}
    </HoverCard>
  );
}
