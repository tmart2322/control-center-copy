'use client';
/**
 * Details renderer for `calendar_event`: a meeting brief (Today's spine, Home's ribbon and 14-day strip open it).
 *
 *   head    Meeting · customer-facing · one readiness badge / time and countdown / location / account · opp
 *   body    Prep (each check, with your minutes left; a check opens its task) · ✦ Read-in · Agenda (text, links
 *           clickable) · Attendees (organizer, each guest's answer, externals marked) · Attachments ·
 *           Takeaways (missed meetings) · source
 *   footer  ONE filled action: Join (on now or within 10 min) · Start prep · Review takeaways · Join · Open in Calendar
 *
 * Data: GET /calendar/events/:id (the event, the items that serve it, account / opp names, read-in state); until it
 * answers, the event from any calendar or Today payload already cached. Prep also reads GET /items (open + done),
 * which live events keep fresh. Links open only on a click; nothing here writes anywhere.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { CalendarEvent, CalendarEventDetail, CalendarPayload, TodayPayload, WorkItem } from '@/contract';
import { useApi } from '@/client/hooks';
import { notifyDetailsSpy } from '@/components/agents/actions';
import { ReadInSection } from '@/components/readin';
import { AppLink } from '@/components/shell/AppLink';
import { getDetailRenderer, useRightPanel } from '@/components/shell/panel';
import { handsOnMin } from '@/engines/home/estimate';
import { cn, PanelBoundary, Skeleton, SOURCE_META, useNow, useTimeZone } from '@/ui';
import { Check, openExternal, PanelFrame, PanelLoading, PanelProblem, PanelSection, QuietAction, StateBadge, Tag, type PanelPrimary } from './bits';
import { eventPhase, eventPrimary, eventWhen, prepChecks, responseWord } from './derive';
import { AgendaText } from './meeting';

function useEvent(id: string) {
  const qc = useQueryClient();
  const q = useApi('getCalendarEvent', { params: { id } });
  const fresh = q.data?.event;
  const cached = useMemo<CalendarEvent | undefined>(() => {
    if (fresh) return undefined;
    for (const [, d] of qc.getQueriesData<CalendarPayload>({ queryKey: ['calendar', 'getCalendar'] })) {
      const e = d?.events.find((x) => x.id === id);
      if (e) return e;
    }
    for (const [, d] of qc.getQueriesData<TodayPayload>({ queryKey: ['today', 'getToday'] })) {
      const e = d?.spine.events.find((x) => x.id === id);
      if (e) return e;
    }
    return undefined;
  }, [qc, id, fresh]);
  return { ev: fresh ?? cached, detail: q.data, q };
}

export interface EventPanelProps {
  eventId: string;
  label?: string;
}

export function EventPanel(props: EventPanelProps) {
  return (
    <PanelBoundary name="event.panel" resetKeys={[props.eventId]}>
      <EventPanelBody {...props} />
    </PanelBoundary>
  );
}

function EventPanelBody({ eventId }: EventPanelProps) {
  const { ev, detail, q } = useEvent(eventId);
  if (!ev && q.isLoading) return <PanelLoading label="Loading the meeting" />;
  const gone = q.error?.code === 'not_found';
  if (!ev) return <PanelProblem gone={gone} error={gone ? null : q.error} what="meeting" onRetry={() => void q.refetch()} />;
  return <Loaded ev={ev} detail={detail} />;
}

const ATTENDEE_CAP = 6;
/** Agendas longer than this many lines fold behind "Show all". */
const AGENDA_LINES = 12;
const KIND_WORD: Record<CalendarEvent['attachments'][number]['kind'], string> = { deck: 'Deck', doc: 'Doc', sheet: 'Sheet', pdf: 'PDF', other: 'File' };

type PrepItem = Pick<WorkItem, 'id' | 'title' | 'state' | 'servesEventId'> & { youMin?: number; full?: WorkItem };

function Loaded({ ev, detail }: { ev: CalendarEvent; detail?: CalendarEventDetail }) {
  const now = useNow(30_000).toISOString();
  const tzCtx = useTimeZone();
  const settings = useApi('getSettings', undefined, { enabled: !tzCtx });
  const tz = tzCtx ?? settings.data?.profile.timezone;
  const panel = useRightPanel();
  const open = useApi('listItems', { query: { tab: 'all_open' } });
  const done = useApi('listItems', { query: { tab: 'done' } });
  const [allPeople, setAllPeople] = useState(false);
  const [allAgenda, setAllAgenda] = useState(false);

  // The lists (kept fresh by live events) once both are in; until then the detail's prep items, so prep shows at once.
  const items = useMemo(() => {
    const m = new Map<string, PrepItem>();
    if (open.data && done.data) for (const i of [...done.data.items, ...open.data.items]) m.set(i.id, { ...i, full: i });
    else for (const p of detail?.prep ?? []) m.set(p.id, { ...p, servesEventId: ev.id });
    return m;
  }, [open.data, done.data, detail, ev.id]);
  const checks = useMemo(
    () =>
      prepChecks(ev, [...items.values()], (id) => {
        const it = items.get(id);
        return it?.full ? handsOnMin(it.full) : (it?.youMin ?? 0);
      }),
    [ev, items],
  );
  const primarySpec = eventPrimary(ev, checks, now);
  const phase = eventPhase(ev, now);
  const left = checks.filter((c) => !c.ready);
  const leftMin = left.reduce((s, c) => s + c.youMin, 0);
  const itemsLoading = (open.isLoading || done.isLoading) && !detail;

  const openItem = (id: string, label?: string) => {
    const e = { kind: 'work_item' as const, id, label: label ?? items.get(id)?.title };
    notifyDetailsSpy(e);
    panel.openDetails(e);
  };
  // The read-in's suggested reply opens in the panel's composer once the draft renderer is registered;
  // until then ReadInSection's default (the Outbox, draft selected) applies. Opening never sends.
  const openDraft = getDetailRenderer('draft')
    ? (draftId: string) => {
        const e = { kind: 'draft' as const, id: draftId, label: 'Suggested reply' };
        notifyDetailsSpy(e);
        panel.openDetails(e);
      }
    : undefined;

  const primary: PanelPrimary | null = primarySpec
    ? {
        id: primarySpec.kind,
        label: primarySpec.label,
        icon: primarySpec.kind === 'join' || primarySpec.kind === 'calendar' ? 'new_window' : undefined,
        run: () => (primarySpec.url ? openExternal(primarySpec.url) : primarySpec.itemId ? openItem(primarySpec.itemId) : undefined),
      }
    : null;

  const readiness =
    phase === 'off' ? (
      <StateBadge tone="neutral" label={ev.attendance === 'declined' ? 'Declined' : 'Cancelled'} />
    ) : ev.attendance === 'missed' ? (
      <StateBadge tone="neutral" label="✕ Missed" />
    ) : phase === 'now' ? (
      <StateBadge tone="brand" label="● Now" />
    ) : checks.length && phase !== 'past' ? (
      left.length ? <StateBadge tone="warn" label={`○ Prep ${checks.length - left.length} of ${checks.length}`} /> : <StateBadge tone="ok" label="✓ Prep ready" />
    ) : null;

  // the organizer first, then externals, then the rest (invite order inside each)
  const ordered = ev.attendees
    .map((p, i) => ({ p, i }))
    .sort((a, b) => Number(!!b.p.organizer) - Number(!!a.p.organizer) || Number(!!b.p.isExternal) - Number(!!a.p.isExternal) || a.i - b.i)
    .map((x) => x.p);
  const people = allPeople ? ordered : ordered.slice(0, ATTENDEE_CAP);
  const accepted = ev.attendees.filter((p) => p.response === 'accepted').length;
  const agendaLong = (ev.agenda ?? '').split('\n').length > AGENDA_LINES;
  const organizer = ev.organizer;
  const organizerLine = organizer && (organizer.isMe || !ev.attendees.some((p) => p.organizer)) ? (organizer.isMe ? 'You organized this meeting' : `Organized by ${organizer.name}${organizer.isExternal ? ' (external)' : ''}`) : null;
  const src = SOURCE_META[ev.source.kind] ?? SOURCE_META.manual;
  // Labels often repeat the source ("Calendar · Review"): show the kind once.
  const srcLabel = ev.source.label.replace(new RegExp(`^${src.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[·:-]\\s*`, 'i'), '') || ev.source.label;

  return (
    <PanelFrame
      label={`Meeting brief: ${ev.title}`}
      data-event-panel={ev.id}
      data-event-phase={phase}
      context={
        <>
          <span className="shrink-0">Meeting</span>
          {ev.isCustomerFacing ? <Tag>Customer-facing</Tag> : <Tag>Internal</Tag>}
          {readiness}
        </>
      }
      title={ev.title}
      sub={
        <span className="flex flex-col gap-0.5">
          <span className={cn('tabular-nums', phase === 'now' ? 'font-bold text-fg' : null)} data-event-when>
            {eventWhen(ev, now, tz)}
          </span>
          {ev.location ? <span className="truncate">{ev.location}</span> : null}
          {detail?.account || detail?.opp ? (
            <span className="flex min-w-0 items-baseline gap-1.5" data-event-deal>
              {detail.account ? (
                <AppLink href={`/deals/${detail.account.id}`} className="min-w-0 truncate font-bold text-fg hover:underline">
                  {detail.account.name}
                </AppLink>
              ) : null}
              {detail.account && detail.opp ? <span aria-hidden>·</span> : null}
              {detail.opp ? (
                <span className="min-w-0 truncate" title={detail.opp.stage ? `${detail.opp.name} · ${detail.opp.stage}` : detail.opp.name}>
                  {detail.opp.name}
                  {detail.opp.stage ? <span className="text-muted"> · {detail.opp.stage}</span> : null}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      }
      primary={primary}
      quiet={
        <>
          {ev.meetingUrl && primarySpec?.kind !== 'join' && phase !== 'past' && phase !== 'off' ? (
            <QuietAction icon="new_window" onClick={() => openExternal(ev.meetingUrl!)}>
              Join link
            </QuietAction>
          ) : null}
          {ev.source.url && primarySpec?.kind !== 'calendar' ? (
            <QuietAction icon="new_window" onClick={() => openExternal(ev.source.url!)}>
              Open in {src.label}
            </QuietAction>
          ) : null}
        </>
      }
    >
      <PanelSection
        title={phase === 'past' || ev.attendance === 'missed' ? 'Prep it had' : 'Prep'}
        suffix={checks.length ? (left.length ? `${left.length} not ready${leftMin ? ` · you ~${leftMin}m` : ''}` : 'all ready') : undefined}
        data-event-prep={checks.length - left.length}
      >
        {itemsLoading ? (
          <Skeleton variant="line" count={2} />
        ) : checks.length ? (
          <ul className="-mx-2 flex flex-col">
            {checks.map((c) => {
              const it = c.itemId ? items.get(c.itemId) : undefined;
              const meta = [c.ready ? (it?.state === 'likely_done' ? 'likely done' : 'done') : it ? (it.state === 'in_progress' ? 'in progress' : 'not started') : 'from the invite', !c.ready && c.youMin ? `you ~${c.youMin}m` : null].filter(Boolean).join(' · ');
              return (
                <li key={c.id} data-check={c.ready ? 'ready' : 'todo'}>
                  <Check ready={c.ready} meta={meta} onOpen={c.itemId && items.has(c.itemId) ? () => openItem(c.itemId!, c.label) : undefined}>
                    {c.label}
                  </Check>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-body text-muted">Nothing is linked to this meeting. Tasks that serve it show up here.</p>
        )}
      </PanelSection>

      <ReadInSection entityType="calendar_event" entityId={ev.id} onOpenDraft={openDraft} />

      {ev.agenda ? (
        <PanelSection title="Agenda" suffix="from the invite" data-event-agenda>
          <AgendaText text={ev.agenda} lines={allAgenda ? undefined : AGENDA_LINES} />
          {agendaLong ? (
            <button type="button" onClick={() => setAllAgenda((v) => !v)} className="mt-1 text-caption font-bold text-link hover:underline focus-visible:shadow-focus focus-visible:outline-none">
              {allAgenda ? 'Show less' : 'Show all'}
            </button>
          ) : null}
        </PanelSection>
      ) : null}

      {ev.attendance === 'missed' && ev.takeaways?.count ? (
        <PanelSection title="Takeaways" suffix={`${ev.takeaways.count} became tasks`}>
          <ul className="-mx-2 flex flex-col">
            {ev.takeaways.workItemIds.map((id) => (
              <li key={id}>
                <Check ready={items.get(id)?.state === 'done'} onOpen={items.has(id) ? () => openItem(id) : undefined}>
                  {items.get(id)?.title ?? 'Takeaway task'}
                </Check>
              </li>
            ))}
          </ul>
          {ev.takeaways.notesUrl ? (
            <QuietAction icon="new_window" onClick={() => openExternal(ev.takeaways!.notesUrl!)}>
              Open the meeting notes
            </QuietAction>
          ) : null}
        </PanelSection>
      ) : null}

      {ev.attendees.length || organizerLine ? (
        <PanelSection
          title="Attendees"
          suffix={[ev.attendees.length ? `${ev.attendees.length}` : null, ev.attendees.some((p) => p.isExternal) ? `${ev.attendees.filter((p) => p.isExternal).length} external` : null, ev.attendees.some((p) => p.response) ? `${accepted} accepted` : null].filter(Boolean).join(' · ')}
        >
          {organizerLine ? (
            <p className="mb-1 text-caption text-muted" data-event-organizer={organizer?.isMe ? 'me' : 'other'}>
              {organizerLine}
            </p>
          ) : null}
          <ul className="grid grid-cols-1 gap-x-6 gap-y-1 @min-[30rem]/panel:grid-cols-2" data-attendees>
            {people.map((p) => {
              const answer = responseWord(p.response);
              const facts = [p.organizer ? 'organizer' : null, p.isExternal ? 'external' : null, p.optional ? 'optional' : null, p.isManager ? 'your manager' : null, p.role ?? null].filter(Boolean);
              return (
                <li key={p.id} className="flex min-w-0 flex-col py-1" data-attendee={p.id} data-response={p.response ?? undefined} data-external={p.isExternal || undefined}>
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className={cn('min-w-0 truncate text-body', p.response === 'declined' ? 'text-muted line-through' : 'text-fg')} title={p.name}>
                      {p.name}
                    </span>
                    {answer ? <span className="shrink-0 text-caption text-muted">{answer}</span> : null}
                  </span>
                  {facts.length ? <span className="min-w-0 truncate text-caption text-muted">{facts.join(' · ')}</span> : null}
                </li>
              );
            })}
          </ul>
          {ev.attendees.length > ATTENDEE_CAP ? (
            <button type="button" onClick={() => setAllPeople((v) => !v)} className="mt-1 text-caption font-bold text-link hover:underline focus-visible:shadow-focus focus-visible:outline-none">
              {allPeople ? 'Show fewer' : `Show ${ev.attendees.length - ATTENDEE_CAP} more`}
            </button>
          ) : null}
        </PanelSection>
      ) : null}

      {ev.attachments.length ? (
        <PanelSection title="Attachments" suffix={`${ev.attachments.length}`} data-event-attachments>
          <ul className="-mx-2 flex flex-col">
            {ev.attachments.map((a, i) => (
              <li key={`${a.url ?? a.title}:${i}`} className="flex min-w-0 items-baseline gap-2 rounded-md px-2 py-1">
                <span className="w-10 shrink-0 text-caption text-muted">{KIND_WORD[a.kind]}</span>
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-body text-link hover:underline" title={a.title}>
                    {a.title} ↗
                  </a>
                ) : (
                  <span className="min-w-0 truncate text-body text-fg" title={a.title}>
                    {a.title}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </PanelSection>
      ) : null}

      <p className="flex min-w-0 items-center gap-1.5 text-caption text-muted">
        <span className="shrink-0">From {src.label}</span>
        <span aria-hidden>·</span>
        <span className="min-w-0 truncate" title={ev.source.label}>
          {srcLabel}
        </span>
      </p>
    </PanelFrame>
  );
}
