'use client';
/**
 * Context (UI-SPEC §12, R-UI-20 "every task says what it's for"): the initiative's purpose and summary,
 * the people with their roles, the account and opportunity, the linked meeting and its notes (the
 * Gemini next steps assigned to you), and your notes on the task (autosave).
 */
import { AppLink } from '@/components/shell/AppLink';
import type { WorkItemDetail } from '@/contract';
import { useApi } from '@/client/hooks';
import { Icon, SourceChip, StatePill } from '@/ui';
import { TextField } from '../header/fields';
import { fmtAmount, mergePeople } from '../lib/derive';
import { fmtWhen } from '../lib/tz';
import { GroupLabel, Initials } from '../panel/bits';

function Block({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <div className="flex items-center gap-2">
        <GroupLabel>{title}</GroupLabel>
        {action ? <span className="ml-auto text-caption">{action}</span> : null}
      </div>
      {children}
    </section>
  );
}

const DC_LABEL = { assigned: 'DC assigned', partial: 'DC partial', none: 'No DC', requested: 'DC requested' } as const;

export function ContextTab({ detail, now, tz, saveNotes }: { detail: WorkItemDetail; now: string; tz?: string; saveNotes: (v: string, basis: string) => Promise<unknown> }) {
  const { item, initiative, account, opp, meeting } = detail;
  const evidence = useApi('getItemEvidence', { params: { id: item.id } });
  const notes = (evidence.data?.evidence ?? []).filter((e) => e.source.kind === 'gemini');
  const people = mergePeople(item.counterparty ? [{ ...item.counterparty, role: item.counterparty.role ?? 'Asked' }] : [], item.people, initiative?.people, account?.team);

  return (
    <div className="space-y-6" data-context-tab>
      <Block title="Initiative" action={initiative ? <AppLink href={`/initiatives/${initiative.id}`} className="text-link hover:underline">Open initiative ›</AppLink> : null}>
        {initiative ? (
          <div className="space-y-1.5">
            <p className="flex flex-wrap items-center gap-2">
              <AppLink href={`/initiatives/${initiative.id}`} className="text-body-lg font-bold text-fg-heading hover:underline">
                {initiative.title}
              </AppLink>
              <StatePill tone={initiative.status === 'completed' ? 'ok' : initiative.status === 'proposed' ? 'ai' : 'neutral'} label={initiative.status} size="sm" className="capitalize" />
            </p>
            {initiative.purpose ? (
              <p className="max-w-[68ch] text-body text-fg">
                <span className="font-bold">Purpose:</span> {initiative.purpose}
              </p>
            ) : null}
            {initiative.summary ? <p className="max-w-[68ch] text-body whitespace-pre-line text-fg">{initiative.summary}</p> : null}
            <p className="text-caption text-faint">Summary updated {fmtWhen(initiative.updatedAt, now, tz, { today: true })}</p>
          </div>
        ) : (
          <p className="text-body text-muted">Not part of an initiative yet. Chat can link it (“link this to …”).</p>
        )}
      </Block>

      <Block title={`People · ${people.length}`}>
        {people.length ? (
          <ul className="grid gap-x-4 gap-y-1.5 @md:grid-cols-2">
            {people.map((p) => (
              <li key={p.id} className="flex min-w-0 items-center gap-2">
                <Initials name={p.name} />
                <span className="min-w-0">
                  <span className="block truncate text-body text-fg">
                    {p.name}
                    {p.isManager ? <span className="ml-1 text-caption text-muted">· your manager</span> : null}
                  </span>
                  <span className="block truncate text-caption text-muted">{[p.role, p.isExternal ? 'external' : null].filter(Boolean).join(' · ') || '—'}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-muted">No people linked.</p>
        )}
      </Block>

      {account || opp ? (
        <Block title="Account and opportunity">
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-body">
            {account ? (
              <>
                <dt className="text-caption text-muted">Account</dt>
                <dd className="flex min-w-0 flex-wrap items-center gap-2">
                  <AppLink href={`/deals/${account.id}`} className="font-bold text-fg hover:underline">
                    {account.name}
                  </AppLink>
                  <StatePill tone={account.dcStatus === 'assigned' ? 'ok' : account.dcStatus === 'none' ? 'warn' : 'neutral'} label={DC_LABEL[account.dcStatus]} size="xs" />
                  <span className="text-caption text-muted tabular-nums">{account.hoursQtd} h QTD</span>
                </dd>
              </>
            ) : null}
            {opp ? (
              <>
                <dt className="text-caption text-muted">Opportunity</dt>
                <dd className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-fg">{opp.name}</span>
                    {opp.org62Url ? <SourceChip source="org62" label="Org62" href={opp.org62Url} /> : null}
                  </span>
                  <span className="block text-caption text-muted tabular-nums">
                    {[opp.stage, opp.amount !== null ? fmtAmount(opp.amount) : null, opp.closeDate ? `close ${opp.closeDate}` : null, opp.owner ? `AE ${opp.owner.name}` : null].filter(Boolean).join(' · ')}
                  </span>
                  {opp.nextStep ? <span className="block max-w-[68ch] text-caption text-fg">Next step: {opp.nextStep}</span> : null}
                </dd>
              </>
            ) : null}
          </dl>
        </Block>
      ) : null}

      <Block title="Meeting notes">
        {meeting ? (
          <div className="space-y-1.5">
            <p className="flex flex-wrap items-center gap-2 text-body">
              <Icon name="event" size="sm" className={meeting.attendance === 'missed' ? 'text-danger-700' : 'text-muted'} />
              <span className="font-bold text-fg">{meeting.title}</span>
              <span className="text-caption text-muted tabular-nums">{fmtWhen(meeting.start, now, tz, { today: true })}</span>
              {meeting.attendance !== 'upcoming' ? <StatePill tone={meeting.attendance === 'missed' ? 'risk' : meeting.attendance === 'attended' ? 'ok' : 'neutral'} label={meeting.attendance.replace('_', ' ')} size="xs" className="capitalize" /> : null}
              {meeting.takeaways?.notesUrl ? <SourceChip source="gemini" label="Gemini notes" href={meeting.takeaways.notesUrl} /> : null}
            </p>
            {meeting.attendees.length ? <p className="text-caption text-muted">With {meeting.attendees.map((a) => a.name).join(', ')}</p> : null}
          </div>
        ) : null}
        {notes.length ? (
          <div className="rounded-md border border-line bg-surface-muted px-4 py-3">
            <p className="text-caption font-bold text-fg">Next steps assigned to you</p>
            <ul className="mt-1 space-y-1">
              {notes.map((n) => (
                <li key={n.id} className="flex gap-2 text-body text-fg">
                  <Icon name="summary" size="xs" className="mt-1 text-muted" />
                  <span className="min-w-0">
                    {n.summary}
                    {n.snippet ? <span className="block text-caption text-muted">“{n.snippet}”</span> : null}
                    <span className="block text-caption text-faint">
                      {n.source.label} · {fmtWhen(n.at, now, tz, { today: true })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : !meeting ? (
          <p className="text-body text-muted">No meeting or notes linked.</p>
        ) : null}
      </Block>

      <Block title="Your notes">
        <TextField field="notes" label="Notes" value={item.notes || null} multiline statusBelow placeholder="Private notes on this task (autosaves)" save={(v, b) => saveNotes(v ?? '', b ?? '')} inputClassName="text-body text-fg" maxLength={4000} />
      </Block>
    </div>
  );
}
